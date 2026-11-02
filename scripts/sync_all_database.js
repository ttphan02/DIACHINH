const https = require('https');
const fs = require('fs');

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, r2 => {
          let data = '';
          r2.on('data', chunk => data += chunk);
          r2.on('end', () => resolve(data));
        });
      } else {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }
    }).on('error', reject);
  });
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

function parseCSVLine(line) {
  let values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  values.push(current);
  return values;
}

async function run() {
  console.log('1. Loading Sheet CSV...');
  const csvText = await fetchText('https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0');
  const lines = csvText.split(/\r?\n/);
  console.log('Total sheet lines:', lines.length);

  console.log('2. Loading declarations from R2...');
  const declData = await fetchJSON('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/declarations/all.json');
  const declMap = declData?.declarationsMap || {};
  console.log('Total declarations in R2:', Object.keys(declMap).length);

  console.log('3. Loading parcels.json...');
  const originalParcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));
  console.log('Total parcels currently:', originalParcels.length);

  // --- BƯỚC 1: XÁC ĐỊNH DANH SÁCH ẨN (HIDDEN PARCELS) ---
  // A. Thửa có STT Cột A từ 7916 đến 9250 trên Google Sheet
  const hiddenColA = new Set();
  const ggsBfCodes = new Set();
  const ggsParcelsMap = {};

  for (let r = 1; r < lines.length; r++) {
    const line = lines[r];
    if (!line.trim()) continue;
    const row = parseCSVLine(line);
    const colA = parseInt(row[0]?.trim(), 10);
    const colBF = row[57]?.trim(); // Cột BF
    const colC = row[2]?.trim();   // Cột C (CHUACOGIAY_24478_to_thua)

    let maThua = '';
    if (colBF && colBF.includes('_') && /^\d+_\d+$/.test(colBF)) {
      maThua = colBF;
    } else if (colC) {
      const m = colC.match(/(\d+)_(\d+)$/);
      if (m) maThua = m[1] + '_' + m[2];
    }

    if (!isNaN(colA) && colA >= 7916 && colA <= 9250) {
      if (maThua) hiddenColA.add(maThua);
    } else {
      if (maThua) {
        ggsBfCodes.add(maThua);
        ggsParcelsMap[maThua] = {
          chu_ho: row[7]?.trim() || '',
          cccd: row[10]?.trim() || '',
          to_ban_do: row[20]?.trim() || maThua.split('_')[0],
          so_thua: row[21]?.trim() || maThua.split('_')[1],
          dien_tich: row[24]?.trim() || '',
          loai_dat: row[27]?.trim() || '',
          thon_xa: row[11]?.trim() || row[22]?.trim() || '',
        };
      }
    }
  }

  // B. Thửa thuộc loại đất BCS có diện tích dưới 100m2
  const hiddenBcs = new Set();
  originalParcels.forEach((p) => {
    const ld = (p.loai_dat || '').trim().toUpperCase();
    const dt = parseFloat(String(p.dien_tich || '').replace(',', '.'));
    if (ld === 'BCS' && !isNaN(dt) && dt < 100) {
      hiddenBcs.add(p.ma_thua);
    }
  });

  // Tổng hợp Hidden Set
  const hiddenSet = new Set([...hiddenColA, ...hiddenBcs]);
  console.log(`Hidden: Col A [7916..9250] = ${hiddenColA.size}, BCS < 100m2 = ${hiddenBcs.size}`);
  console.log(`Total combined hidden parcels = ${hiddenSet.size}`);

  // --- BƯỚC 2: XÁC ĐỊNH DANH SÁCH ĐÃ SỐ HÓA (DIGITIZED PARCELS) ---
  // 1. Mã thửa trên Cột BF Trang tính 1
  // 2. Thửa nằm trong Nhập dữ liệu (đã có scan file)
  // 3. Thửa nằm trong GCN - ONT
  const digitizedSet = new Set();

  for (const code of ggsBfCodes) {
    if (!hiddenSet.has(code)) {
      digitizedSet.add(code);
    }
  }

  // Quét các thửa có file scan hoặc là ONT từ declarationsMap
  let scanCount = 0;
  let ontCount = 0;
  for (const [maThua, decl] of Object.entries(declMap)) {
    if (hiddenSet.has(maThua)) continue;
    const hasScan = Boolean(decl.file_scan_pdf || decl.anh_ho_so_pdf || decl.scan_file);
    const isOnt = /ONT/i.test(String(decl.loai_dat || ''));
    if (hasScan) {
      digitizedSet.add(maThua);
      scanCount++;
    }
    if (isOnt) {
      digitizedSet.add(maThua);
      ontCount++;
    }
  }

  console.log(`Digitized: GGS BF = ${ggsBfCodes.size}, Has Scan = ${scanCount}, ONT = ${ontCount}`);
  console.log(`Total DIGITIZED set (excluding hidden) = ${digitizedSet.size}`);

  // --- BƯỚC 3: ĐỒNG BỘ VÀO DATA BASE / DATA FILES ---
  // 1. Ghi hidden_parcels.json
  const hiddenArray = Array.from(hiddenSet).sort();
  fs.writeFileSync('src/data/hidden_parcels.json', JSON.stringify(hiddenArray, null, 2), 'utf8');
  fs.writeFileSync('public/data/hidden_parcels.json', JSON.stringify(hiddenArray, null, 2), 'utf8');
  console.log('✓ Updated src/data/hidden_parcels.json & public/data/hidden_parcels.json');

  // 2. Ghi digitized_parcels.json
  const digitizedArray = Array.from(digitizedSet).sort();
  fs.writeFileSync('src/data/digitized_parcels.json', JSON.stringify(digitizedArray, null, 2), 'utf8');
  fs.writeFileSync('public/data/digitized_parcels.json', JSON.stringify(digitizedArray, null, 2), 'utf8');
  console.log('✓ Updated src/data/digitized_parcels.json & public/data/digitized_parcels.json');

  // 3. Ghi ggs_snapshot.json
  // Lọc bỏ toàn bộ thửa ẩn khỏi snapshot
  const cleanGgsCodes = Array.from(ggsBfCodes).filter(c => !hiddenSet.has(c)).sort();
  const cleanGgsParcels = {};
  for (const code of cleanGgsCodes) {
    cleanGgsParcels[code] = ggsParcelsMap[code] || {};
  }
  const snapshotData = {
    updated_at: new Date().toISOString(),
    total_parcels: cleanGgsCodes.length,
    codes: cleanGgsCodes,
    parcels: cleanGgsParcels
  };
  fs.writeFileSync('public/data/ggs_snapshot.json', JSON.stringify(snapshotData, null, 2), 'utf8');
  if (fs.existsSync('src/data/ggs_snapshot.json')) {
    fs.writeFileSync('src/data/ggs_snapshot.json', JSON.stringify(snapshotData, null, 2), 'utf8');
  }
  console.log(`✓ Updated ggs_snapshot.json (${cleanGgsCodes.length} codes)`);

  // 4. Cập nhật parcels.json:
  // LỌC BỎ HOÀN TOÀN các thửa ẩn ra khỏi parcels.json!
  // Đồng thời cập nhật trạng thái DA_SO_HOA_XANH cho toàn bộ thửa trong digitizedSet!
  const updatedParcels = [];
  let greenCount = 0;
  let blueCount = 0;
  let yellowCount = 0;
  let grayCount = 0;

  for (const p of originalParcels) {
    // Ẩn triệt để: Nếu nằm trong hiddenSet thì BỎ QUA hoàn toàn khỏi database hiển thị!
    if (hiddenSet.has(p.ma_thua)) continue;

    const isDigitized = digitizedSet.has(p.ma_thua);
    const decl = declMap[p.ma_thua];
    const isDeclared = Boolean(decl);

    let trang_thai = p.trang_thai;
    if (isDigitized) {
      trang_thai = 'DA_SO_HOA_XANH';
      greenCount++;
    } else if (isDeclared) {
      trang_thai = 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
      blueCount++;
    } else if (p.chu_ho && p.chu_ho !== 'Chưa có tên' && p.chu_ho !== 'Không có dữ liệu' && p.chu_ho !== 'Không có trong SMK') {
      trang_thai = 'CO_TEN_CHUA_SO_HOA_VANG';
      yellowCount++;
    } else {
      trang_thai = 'KHONG_TEN_CHUA_SO_HOA_XAM';
      grayCount++;
    }

    const ggsInfo = ggsParcelsMap[p.ma_thua];

    updatedParcels.push({
      ...p,
      chu_ho: ggsInfo?.chu_ho || decl?.chu_dat_ten || p.chu_ho,
      cccd: ggsInfo?.cccd || decl?.chu_dat_cccd || p.cccd,
      trang_thai,
      is_on_ggs: isDigitized,
      is_declared: isDeclared,
    });
  }

  console.log(`Database parcels count after removing hidden: ${updatedParcels.length}`);
  console.log(`  • Đã số hóa (Xanh): ${greenCount}`);
  console.log(`  • Đã kê khai (Lam): ${blueCount}`);
  console.log(`  • Có tên (Vàng): ${yellowCount}`);
  console.log(`  • Không tên (Xám): ${grayCount}`);

  fs.writeFileSync('public/data/parcels.json', JSON.stringify(updatedParcels), 'utf8');
  fs.writeFileSync('src/data/parcels.json', JSON.stringify(updatedParcels), 'utf8');
  console.log('✓ Updated public/data/parcels.json & src/data/parcels.json');

  // 5. Cập nhật parcels_brief.json:
  // ma_thua -> [dien_tich, loai_dat, thon_xa, statusFlag (0: KHONG_TEN, 1: CO_TEN, 2: DA_SO_HOA)]
  const updatedBrief = {};
  for (const p of updatedParcels) {
    let flag = 0;
    if (p.trang_thai === 'DA_SO_HOA_XANH') flag = 2;
    else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG' || p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') flag = 1;
    updatedBrief[p.ma_thua] = [p.dien_tich || '', p.loai_dat || '', p.thon_xa || '', flag];
  }
  fs.writeFileSync('src/data/parcels_brief.json', JSON.stringify(updatedBrief), 'utf8');
  console.log(`✓ Updated src/data/parcels_brief.json (${Object.keys(updatedBrief).length} parcels)`);
}

run().catch(console.error);
