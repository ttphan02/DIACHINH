const fs = require('fs');
const https = require('https');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: 'https://0c2efc5ecc976a3e83c4d593c0a800d0.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: 'f7f23fdd9f5274a538df6137912bca4a',
    secretAccessKey: 'ba58bd9ac40b2c2fffc245c62f8f4478310f2176afa634c4e0b1053c292b4310',
  }
});

function normalizeName(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHonorifics(norm) {
  if (!norm) return '';
  return norm
    .replace(/^(ho ong va ba|ho ong ba|ho va ten|ho gia dinh|vo chong ong ba|vo chong|ho ong|ho ba|ong ba|ong|ba|chu|bac|anh|chi|chau)\s+/, '')
    .trim();
}

function cleanCccd(val) {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length === 12 || digits.length === 9) return digits;
  return '';
}

function isPersonName(name) {
  if (!name) return false;
  const s = String(name).trim();
  if (s.length < 3) return false;
  // Loại trừ các tên tổ chức, công cộng
  if (/^(đất|ubnd|ban|công ty|hội|trường|trạm|chùa|nhà thờ|suối|đường|giao thông|thủy lợi|nghĩa trang|khu dân cư|chưa xác định)/i.test(s)) {
    return false;
  }
  // Tên người thông thường có ít nhất 2 từ
  const words = s.split(/\s+/).filter(w => w.length > 0);
  return words.length >= 2;
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

async function listAllR2Objects(prefix) {
  const objects = [];
  let token = undefined;
  let page = 0;
  do {
    page++;
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: 'diachinh-storage',
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: token,
    }));
    if (res.Contents) objects.push(...res.Contents);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function run() {
  console.log('=== BẮT ĐẦU ĐỐI SOÁT TÊN VỚI THƯ MỤC CCCD TRÊN CLOUDFLARE R2 ===\n');

  // 1. Quét toàn bộ file trong cccd/ trên R2
  console.log('1. Đang quét toàn bộ file trong thư mục cccd/ trên R2...');
  const r2Objects = await listAllR2Objects('cccd/');
  console.log(`-> Tìm thấy tổng cộng: ${r2Objects.length} files trong cccd/\n`);

  // Phân tích tên file trên R2
  const r2Files = [];
  const r2ByName = new Map(); // normWithoutHonorific -> [{ filename, cccd, rawName }]
  const r2ByCccd = new Map(); // cccd -> [{ filename, rawName }]

  for (const obj of r2Objects) {
    const filename = obj.Key.replace(/^cccd\//, '');
    if (!filename.toLowerCase().endsWith('.pdf') && !filename.toLowerCase().endsWith('.jpg') && !filename.toLowerCase().endsWith('.png')) continue;
    
    const base = filename.replace(/\.(pdf|jpg|png)$/i, '');
    // Tách số CCCD và tên chủ hộ
    const m = base.match(/^(\d{9,12})(?:_(.*))?$/);
    let cccdNum = '';
    let rawName = '';

    if (m) {
      cccdNum = m[1];
      rawName = m[2] ? m[2].replace(/[_-]+/g, ' ').trim() : '';
    } else {
      const m2 = base.match(/\b\d{9,12}\b/);
      if (m2) {
        cccdNum = m2[0];
        rawName = base.replace(cccdNum, '').replace(/[_-]+/g, ' ').trim();
      } else {
        // Tên file chỉ là họ tên không có số CCCD
        rawName = base.replace(/[_-]+/g, ' ').trim();
      }
    }

    const norm = normalizeName(rawName);
    const cleanNorm = stripHonorifics(norm);

    const item = { filename, cccd: cccdNum, rawName, norm, cleanNorm, size: obj.Size };
    r2Files.push(item);

    if (cccdNum) {
      if (!r2ByCccd.has(cccdNum)) r2ByCccd.set(cccdNum, []);
      r2ByCccd.get(cccdNum).push(item);
    }

    if (cleanNorm && cleanNorm.length >= 3) {
      if (!r2ByName.has(cleanNorm)) r2ByName.set(cleanNorm, []);
      r2ByName.get(cleanNorm).push(item);
    }
  }

  console.log(`-> Đã phân loại được ${r2ByName.size} họ tên khác nhau trong kho CCCD R2.`);
  console.log(`-> Đã phân loại được ${r2ByCccd.size} số CCCD khác nhau trong kho CCCD R2.\n`);

  // 2. Tải danh sách cấu hình và dữ liệu
  console.log('2. Đang đọc dữ liệu các thửa đất...');
  const hiddenParcels = new Set(JSON.parse(fs.readFileSync('src/data/hidden_parcels.json', 'utf8')));
  const digitizedParcels = new Set(JSON.parse(fs.readFileSync('src/data/digitized_parcels.json', 'utf8')));
  const kh2959Nhom1 = new Set(JSON.parse(fs.readFileSync('src/data/kh2959_nhom1.json', 'utf8')));
  const allParcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));

  // Tải declarationsMap & sync_sheets
  const [declRes, syncSheetsRes] = await Promise.all([
    fetchJSON('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/declarations/all.json'),
    fetchJSON('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/cache/sync_sheets.json'),
  ]);

  const declarationsMap = declRes?.declarationsMap || {};
  const declaredCodesSet = new Set(Object.keys(declarationsMap));

  console.log(`-> Parcels tổng: ${allParcels.length}`);
  console.log(`-> Ẩn: ${hiddenParcels.size}, Số hóa: ${digitizedParcels.size}, Nhóm 1: ${kh2959Nhom1.size}, Đã kê khai: ${declaredCodesSet.size}\n`);

  // 3. Gom danh sách NHÓM 1: ĐANG KÊ KHAI CHƯA CÓ CCCD
  // Lấy từ sheet 'THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)' của sync_sheets
  const missingCccdSheet = syncSheetsRes?.sheetsData?.['THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)'] || [];
  const groupDangKeKhai = [];

  for (let i = 1; i < missingCccdSheet.length; i++) {
    const row = missingCccdSheet[i];
    const maThua = String(row[1] || '').trim();
    if (!maThua || hiddenParcels.has(maThua)) continue;

    const thon = String(row[2] || '').trim();
    const chuHo = String(row[3] || '').trim();
    const cccd = cleanCccd(row[6] || '');
    const dienTich = String(row[7] || '').trim();
    const loaiDat = String(row[8] || '').trim();

    groupDangKeKhai.push({
      maThua,
      thon,
      chuHo,
      cccd,
      dienTich,
      loaiDat,
      normName: stripHonorifics(normalizeName(chuHo)),
    });
  }

  // 4. Gom danh sách NHÓM 2: CHƯA LÀM
  const groupChuaLam = [];
  for (const p of allParcels) {
    const ma = p.ma_thua;
    if (!ma) continue;
    if (hiddenParcels.has(ma)) continue;
    if (digitizedParcels.has(ma)) continue;
    if (kh2959Nhom1.has(ma)) continue;
    if (declaredCodesSet.has(ma)) continue;

    const chuHo = String(p.chu_ho || '').trim();
    const cccd = cleanCccd(p.cccd || '');
    const norm = stripHonorifics(normalizeName(chuHo));

    // Chỉ xét các thửa có tên người sử dụng
    if (isPersonName(chuHo)) {
      groupChuaLam.push({
        maThua: ma,
        toBanDo: p.to_ban_do,
        soThua: p.so_thua,
        thon: p.thon_xa,
        chuHo,
        cccd,
        dienTich: p.dien_tich,
        loaiDat: p.loai_dat,
        normName: norm,
      });
    }
  }

  console.log(`Số lượng bản ghi cần kiểm tra:`);
  console.log(`- Nhóm 'Đang kê khai chưa có CCCD': ${groupDangKeKhai.length} thửa`);
  console.log(`- Nhóm 'Chưa làm' có tên người: ${groupChuaLam.length} thửa\n`);

  // Hàm so khớp với R2
  function findR2Match(normName, existingCccd) {
    if (existingCccd && r2ByCccd.has(existingCccd)) {
      return { matchType: 'EXACT_CCCD', files: r2ByCccd.get(existingCccd) };
    }
    if (!normName || normName.length < 3) return null;

    // 1. Khớp chính xác tên chuẩn hóa (đã bỏ danh xưng)
    if (r2ByName.has(normName)) {
      return { matchType: 'EXACT_NAME', files: r2ByName.get(normName) };
    }

    // 2. Thử tìm kiếm đảo thứ tự từ hoặc substring nếu tên dài >= 6 ký tự
    const nameWords = normName.split(' ').sort().join(' ');
    for (const [r2Key, files] of r2ByName.entries()) {
      const r2Words = r2Key.split(' ').sort().join(' ');
      if (nameWords === r2Words) {
        return { matchType: 'PERMUTED_NAME', files };
      }
      // Substring nếu cả 2 đều dài
      if (normName.length >= 8 && r2Key.length >= 8) {
        if (r2Key.includes(normName) || normName.includes(r2Key)) {
          return { matchType: 'SUBSTRING_NAME', files };
        }
      }
    }

    return null;
  }

  // Đối soát NHÓM 1: Đang kê khai chưa có CCCD
  const matchedDangKeKhai = [];
  for (const item of groupDangKeKhai) {
    const match = findR2Match(item.normName, item.cccd);
    if (match) {
      matchedDangKeKhai.push({
        ...item,
        matchType: match.matchType,
        r2Files: match.files.map(f => ({
          filename: f.filename,
          cccd: f.cccd,
          rawNameInFile: f.rawName
        }))
      });
    }
  }

  // Đối soát NHÓM 2: Chưa làm
  const matchedChuaLam = [];
  for (const item of groupChuaLam) {
    const match = findR2Match(item.normName, item.cccd);
    if (match) {
      matchedChuaLam.push({
        ...item,
        matchType: match.matchType,
        r2Files: match.files.map(f => ({
          filename: f.filename,
          cccd: f.cccd,
          rawNameInFile: f.rawName
        }))
      });
    }
  }

  console.log(`=======================================================`);
  console.log(`🎉 KẾT QUẢ ĐỐI SOÁT TRÙNG KHỚP VỚI THƯ MỤC CCCD R2:`);
  console.log(`=======================================================`);
  console.log(`1. NHÓM ĐANG KÊ KHAI CHƯA CÓ CCCD:`);
  console.log(`   - Khớp được: ${matchedDangKeKhai.length} / ${groupDangKeKhai.length} thửa đất!`);
  
  // Gom theo chủ hộ
  const dangKeKhaiByPerson = new Map();
  for (const m of matchedDangKeKhai) {
    if (!dangKeKhaiByPerson.has(m.normName)) dangKeKhaiByPerson.set(m.normName, { chuHo: m.chuHo, thon: m.thon, parcels: [], r2Files: m.r2Files });
    dangKeKhaiByPerson.get(m.normName).parcels.push(m.maThua);
  }
  console.log(`   - Tương ứng với: ${dangKeKhaiByPerson.size} chủ hộ riêng biệt.\n`);

  console.log(`2. NHÓM CHƯA LÀM:`);
  console.log(`   - Khớp được: ${matchedChuaLam.length} / ${groupChuaLam.length} thửa đất!`);

  // Gom theo chủ hộ
  const chuaLamByPerson = new Map();
  for (const m of matchedChuaLam) {
    if (!chuaLamByPerson.has(m.normName)) chuaLamByPerson.set(m.normName, { chuHo: m.chuHo, thon: m.thon, parcels: [], r2Files: m.r2Files });
    chuaLamByPerson.get(m.normName).parcels.push(m.maThua);
  }
  console.log(`   - Tương ứng với: ${chuaLamByPerson.size} chủ hộ riêng biệt.\n`);

  // Lưu file kết quả
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalR2Files: r2Objects.length,
      dangKeKhai: {
        total: groupDangKeKhai.length,
        matchedParcels: matchedDangKeKhai.length,
        matchedPersons: dangKeKhaiByPerson.size,
      },
      chuaLam: {
        total: groupChuaLam.length,
        matchedParcels: matchedChuaLam.length,
        matchedPersons: chuaLamByPerson.size,
      }
    },
    dangKeKhaiPersons: Array.from(dangKeKhaiByPerson.entries()).map(([norm, val]) => ({
      normName: norm,
      chuHo: val.chuHo,
      thon: val.thon,
      parcelCount: val.parcels.length,
      parcels: val.parcels,
      r2Files: val.r2Files
    })),
    chuaLamPersons: Array.from(chuaLamByPerson.entries()).map(([norm, val]) => ({
      normName: norm,
      chuHo: val.chuHo,
      thon: val.thon,
      parcelCount: val.parcels.length,
      parcels: val.parcels,
      r2Files: val.r2Files
    }))
  };

  fs.writeFileSync('scripts/audit_r2_matched_result.json', JSON.stringify(report, null, 2), 'utf8');
  console.log('-> Đã lưu kết quả chi tiết vào scripts/audit_r2_matched_result.json');
}

run().catch(console.error);
