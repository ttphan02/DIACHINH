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
    .replace(/^(ho ong va ba|ho ong ba|ho va ten|ho gia dinh|vo chong ong ba|vo chong|ho ong|ho ba|ong ba|ong|ba|chu|bac|anh|chi|chau)\s*:?\s*/, '')
    .trim();
}

function cleanStrictName(str) {
  if (!str) return '';
  return str
    .replace(/^(Hộ ông và bà|Hộ ông bà|Hộ và tên|Hộ gia đình|Vợ chồng ông bà|Vợ chồng|Hộ ông|Hộ bà|Ông bà|Ông|Bà|Chú|Bác|Anh|Chị)\s*:?\s*/i, '')
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
  if (/^(đất|ubnd|ban|công ty|hội|trường|trạm|chùa|nhà thờ|suối|đường|giao thông|thủy lợi|nghĩa trang|khu dân cư|chưa xác định)/i.test(s)) {
    return false;
  }
  const clean = stripHonorifics(normalizeName(s));
  const words = clean.split(/\s+/).filter(w => w.length > 0);
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
  do {
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
  console.log('=== BẮT ĐẦU ĐỐI SOÁT CHÍNH XÁC TÊN VỚI THƯ MỤC CCCD TRÊN R2 ===\n');

  console.log('1. Đang quét toàn bộ file trong thư mục cccd/ trên R2...');
  const r2Objects = await listAllR2Objects('cccd/');
  console.log(`-> Đã quét: ${r2Objects.length} files trong cccd/\n`);

  const r2ByName = new Map(); // exact cleanNorm -> [{ filename, cccd, rawName }]
  const r2ByCccd = new Map(); // cccd -> [{ filename, rawName }]

  for (const obj of r2Objects) {
    const filename = obj.Key.replace(/^cccd\//, '');
    if (!filename.toLowerCase().endsWith('.pdf') && !filename.toLowerCase().endsWith('.jpg') && !filename.toLowerCase().endsWith('.png')) continue;
    
    const base = filename.replace(/\.(pdf|jpg|png)$/i, '');
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
        rawName = base.replace(/[_-]+/g, ' ').trim();
      }
    }

    const norm = normalizeName(rawName);
    const cleanNorm = stripHonorifics(norm);

    const item = { filename, cccd: cccdNum, rawName, norm, cleanNorm, size: obj.Size };

    if (cccdNum) {
      if (!r2ByCccd.has(cccdNum)) r2ByCccd.set(cccdNum, []);
      r2ByCccd.get(cccdNum).push(item);
    }

    if (cleanNorm && cleanNorm.length >= 3) {
      if (!r2ByName.has(cleanNorm)) r2ByName.set(cleanNorm, []);
      r2ByName.get(cleanNorm).push(item);
    }
  }

  console.log('2. Đang đọc dữ liệu thửa đất...');
  const hiddenParcels = new Set(JSON.parse(fs.readFileSync('src/data/hidden_parcels.json', 'utf8')));
  const digitizedParcels = new Set(JSON.parse(fs.readFileSync('src/data/digitized_parcels.json', 'utf8')));
  const kh2959Nhom1 = new Set(JSON.parse(fs.readFileSync('src/data/kh2959_nhom1.json', 'utf8')));
  const allParcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));

  const [declRes, syncSheetsRes] = await Promise.all([
    fetchJSON('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/declarations/all.json'),
    fetchJSON('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/cache/sync_sheets.json'),
  ]);

  const declarationsMap = declRes?.declarationsMap || {};
  const declaredCodesSet = new Set(Object.keys(declarationsMap));

  // Nhóm 1: ĐANG KÊ KHAI CHƯA CÓ CCCD
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
      cleanChuHo: cleanStrictName(chuHo),
      cccd,
      dienTich,
      loaiDat,
      normName: stripHonorifics(normalizeName(chuHo)),
    });
  }

  // Nhóm 2: CHƯA LÀM
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

    if (isPersonName(chuHo)) {
      groupChuaLam.push({
        maThua: ma,
        toBanDo: p.to_ban_do,
        soThua: p.so_thua,
        thon: p.thon_xa,
        chuHo,
        cleanChuHo: cleanStrictName(chuHo),
        cccd,
        dienTich: p.dien_tich,
        loaiDat: p.loai_dat,
        normName: norm,
      });
    }
  }

  // Hàm so khớp CHÍNH XÁC:
  // Chỉ chấp nhận:
  // 1. Trùng CCCD nếu có sẵn
  // 2. Trùng 100% các từ trong họ và tên sau khi bỏ danh xưng
  function matchExact(normName, existingCccd) {
    if (existingCccd && r2ByCccd.has(existingCccd)) {
      return { matchType: 'KHỚP_CCCD', files: r2ByCccd.get(existingCccd) };
    }
    if (!normName || normName.length < 3) return null;

    if (r2ByName.has(normName)) {
      return { matchType: 'KHỚP_CHÍNH_XÁC_TÊN', files: r2ByName.get(normName) };
    }

    return null;
  }

  // 1. Đối soát Nhóm Đang kê khai chưa có CCCD
  const matchedDangKeKhai = [];
  for (const item of groupDangKeKhai) {
    const m = matchExact(item.normName, item.cccd);
    if (m) {
      matchedDangKeKhai.push({
        ...item,
        matchType: m.matchType,
        r2Files: m.files.map(f => ({
          filename: f.filename,
          cccd: f.cccd,
          nameInFile: f.rawName
        }))
      });
    }
  }

  // 2. Đối soát Nhóm Chưa làm
  const matchedChuaLam = [];
  for (const item of groupChuaLam) {
    const m = matchExact(item.normName, item.cccd);
    if (m) {
      matchedChuaLam.push({
        ...item,
        matchType: m.matchType,
        r2Files: m.files.map(f => ({
          filename: f.filename,
          cccd: f.cccd,
          nameInFile: f.rawName
        }))
      });
    }
  }

  // Gom nhóm theo chủ hộ
  function groupByOwner(matchedList) {
    const map = new Map();
    for (const item of matchedList) {
      const key = item.normName;
      if (!map.has(key)) {
        map.set(key, {
          chuHo: item.cleanChuHo || item.chuHo,
          normName: key,
          thon: item.thon,
          matchType: item.matchType,
          parcels: [],
          r2Files: item.r2Files
        });
      }
      map.get(key).parcels.push(item.maThua);
    }
    return Array.from(map.values());
  }

  const dkkPersons = groupByOwner(matchedDangKeKhai);
  const clPersons = groupByOwner(matchedChuaLam);

  console.log(`\n========================================================================`);
  console.log(`BÁO CÁO KẾT QUẢ ĐỐI SOÁT CHÍNH XÁC 100% VỚI THƯ MỤC CCCD TRÊN R2`);
  console.log(`========================================================================\n`);

  console.log(`1. NHÓM ĐANG KÊ KHAI CHƯA CÓ CCCD:`);
  console.log(`   - Tổng số thửa trong danh sách: ${groupDangKeKhai.length} thửa`);
  console.log(`   - Số thửa ĐÃ CÓ FILE TRÊN R2: ${matchedDangKeKhai.length} thửa`);
  console.log(`   - Số chủ hộ ĐÃ CÓ FILE TRÊN R2: ${dkkPersons.length} chủ hộ\n`);

  console.log(`2. NHÓM CHƯA LÀM (có tên chủ sử dụng):`);
  console.log(`   - Tổng số thửa chưa làm có tên người: ${groupChuaLam.length} thửa`);
  console.log(`   - Số thửa ĐÃ CÓ FILE TRÊN R2: ${matchedChuaLam.length} thửa`);
  console.log(`   - Số chủ hộ ĐÃ CÓ FILE TRÊN R2: ${clPersons.length} chủ hộ\n`);

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      dangKeKhai: {
        totalParcels: groupDangKeKhai.length,
        matchedParcels: matchedDangKeKhai.length,
        matchedPersons: dkkPersons.length,
      },
      chuaLam: {
        totalParcels: groupChuaLam.length,
        matchedParcels: matchedChuaLam.length,
        matchedPersons: clPersons.length,
      }
    },
    dangKeKhaiPersons: dkkPersons,
    chuaLamPersons: clPersons,
  };

  fs.writeFileSync('scripts/audit_r2_exact_result.json', JSON.stringify(report, null, 2), 'utf8');
}

run().catch(console.error);
