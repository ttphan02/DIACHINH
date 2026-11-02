const https = require('https');
const fs = require('fs');

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

async function main() {
  console.log('--- Loading declarations from R2 ---');
  const declData = await fetchJSON('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/declarations/all.json');
  const declMap = declData?.declarationsMap || {};
  console.log('Total declarations in R2:', Object.keys(declMap).length);
  
  console.log('--- Loading Google Sheet CSV ---');
  const csvText = await fetchText('https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0');
  const lines = csvText.split(/\r?\n/);
  console.log('Total lines in Sheet:', lines.length);
  
  // 1. Quét Cột A [7916..9250]
  const hiddenColA = new Set();
  const ggsBfCodes = new Set();
  const ggsParcels = {};
  
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r];
    if (!line.trim()) continue;
    const row = parseCSVLine(line);
    const colA = parseInt(row[0]?.trim(), 10);
    const colBF = row[57]?.trim();
    const colC = row[2]?.trim();
    
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
        ggsParcels[maThua] = {
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
  
  // 2. Quét BCS < 100m2
  const parcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));
  const hiddenBcs = new Set();
  parcels.forEach(p => {
    const ld = (p.loai_dat || '').trim().toUpperCase();
    const dt = parseFloat(String(p.dien_tich || '').replace(',', '.'));
    if (ld === 'BCS' && !isNaN(dt) && dt < 100) {
      hiddenBcs.add(p.ma_thua);
    }
  });
  
  const allHidden = new Set([...hiddenColA, ...hiddenBcs]);
  console.log('Hidden Col A [7916..9250]:', hiddenColA.size);
  console.log('Hidden BCS < 100m2:', hiddenBcs.size);
  console.log('Total combined hidden parcels:', allHidden.size);
  
  // 3. Quét các thửa đã có file scan PDF (Nhập dữ liệu)
  // Lấy danh sách filescan từ API hoặc R2
  // Ta có thể kiểm tra danh sách scan file từ declMap hoặc check filescan list
  let scanParcels = new Set();
  for (const [maThua, decl] of Object.entries(declMap)) {
    if (decl.file_scan_pdf || decl.anh_ho_so_pdf || decl.scan_file) {
      scanParcels.add(maThua);
    }
  }
  console.log('Parcels with scan files in declMap:', scanParcels.size);
  
  // 4. Quét các thửa GCN - ONT
  let gcnOntParcels = new Set();
  for (const [maThua, decl] of Object.entries(declMap)) {
    const ld = String(decl.loai_dat || '').trim().toUpperCase();
    if (/ONT/.test(ld)) {
      gcnOntParcels.add(maThua);
    }
  }
  console.log('Parcels with ONT in declMap:', gcnOntParcels.size);
  
  // 5. Tổng hợp DIGITIZED SET = (ggsBfCodes + scanParcels + gcnOntParcels) trừ allHidden
  const digitizedSet = new Set();
  for (const code of ggsBfCodes) {
    if (!allHidden.has(code)) digitizedSet.add(code);
  }
  for (const code of scanParcels) {
    if (!allHidden.has(code)) digitizedSet.add(code);
  }
  for (const code of gcnOntParcels) {
    if (!allHidden.has(code)) digitizedSet.add(code);
  }
  
  console.log('Total DIGITIZED parcels (GGS + Scan + ONT - Hidden):', digitizedSet.size);
  console.log('Is 162_361 in digitizedSet?', digitizedSet.has('162_361'));
  console.log('Is 162_388 in allHidden?', allHidden.has('162_388'));
  console.log('Is 162_388 in digitizedSet?', digitizedSet.has('162_388'));
}

main().catch(console.error);
