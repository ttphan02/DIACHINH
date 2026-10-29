const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const https = require('https');

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

function cleanCccd(val) {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length === 12) return digits;
  if (digits.length === 9) return digits;
  return '';
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function listAllR2Cccd() {
  const objects = [];
  let token = undefined;
  let it = 0;
  do {
    it++;
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: 'diachinh-storage',
      Prefix: 'cccd/',
      MaxKeys: 1000,
      ContinuationToken: token,
    }));
    if (res.Contents) objects.push(...res.Contents);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token && it < 10);
  return objects;
}

async function main() {
  console.log('--- ĐANG TẢI DANH SÁCH FILE TRÊN R2 VÀ PHIẾU KÊ KHAI ---');
  
  // 1. Lấy toàn bộ declarations từ Worker API
  const declRes = await fetchJson('https://diachinh.phantruc0210.workers.dev/api/declarations');
  const declarationsMap = declRes.declarationsMap || {};
  const totalDecls = Object.keys(declarationsMap).length;
  console.log(`Tổng số phiếu kê khai trên hệ thống: ${totalDecls}`);

  // 2. Lấy toàn bộ file CCCD trên R2
  const r2Objects = await listAllR2Cccd();
  console.log(`Tổng số object trong thư mục cccd/ trên R2: ${r2Objects.length}`);

  const r2CccdByNumber = new Map(); // cccd -> filename
  const r2CccdByName = new Map(); // normalizedName -> [{ cccd, filename, rawName }]
  const r2AllFiles = [];

  for (const obj of r2Objects) {
    const filename = obj.Key.replace(/^cccd\//, '');
    if (!filename.toLowerCase().endsWith('.pdf')) continue;
    
    const base = filename.replace(/\.pdf$/i, '');
    const m = base.match(/^(\d{9,12})(?:_(.*))?$/);
    let cccdNum = '';
    let ownerName = '';

    if (m) {
      cccdNum = m[1];
      ownerName = m[2] ? m[2].trim() : '';
    } else {
      const m2 = base.match(/\b\d{9,12}\b/);
      if (m2) {
        cccdNum = m2[0];
        ownerName = base.replace(cccdNum, '').replace(/^[-_]+|[-_]+$/g, '').trim();
      }
    }

    if (cccdNum) {
      r2CccdByNumber.set(cccdNum, filename);
    }

    if (ownerName) {
      const norm = normalizeName(ownerName);
      if (norm) {
        if (!r2CccdByName.has(norm)) r2CccdByName.set(norm, []);
        r2CccdByName.get(norm).push({ cccd: cccdNum, filename, rawName: ownerName });
      }
    }

    r2AllFiles.push({ filename, cccd: cccdNum, ownerName, normName: normalizeName(ownerName) });
  }

  console.log(`Số CCCD riêng biệt trên R2: ${r2CccdByNumber.size}`);
  console.log(`Số tên chủ hộ có trong tên file CCCD trên R2: ${r2CccdByName.size}`);

  // 3. Phân loại các phiếu kê khai:
  const withCccd = [];
  const missingCccd = [];

  for (const [maThua, decl] of Object.entries(declarationsMap)) {
    const cccd = cleanCccd(decl.chu_dat_cccd || decl.cccd || decl.cccd_chu_ho);
    const owner = (decl.chu_dat_ten || decl.chu_ho || decl.ho_va_ten_chu_ho || '').trim();
    
    if (cccd) {
      withCccd.push({ maThua, owner, cccd, thon: decl.thon_xa });
    } else {
      missingCccd.push({ maThua, owner, thon: decl.thon_xa, decl });
    }
  }

  console.log(`\n--- THỐNG KÊ PHIẾU KÊ KHAI ---`);
  console.log(`- Đã có số CCCD hợp lệ: ${withCccd.length}`);
  console.log(`- Chưa có / Bị mất số CCCD: ${missingCccd.length}`);

  // Gom nhóm theo chủ hộ (để biết có bao nhiêu người bị mất CCCD)
  const missingByPerson = new Map(); // normName -> { rawNames: Set, parcels: [] }

  for (const item of missingCccd) {
    let clean = item.owner;
    const norm = normalizeName(clean);
    if (!norm) {
      if (!missingByPerson.has('__KHONG_TEN__')) missingByPerson.set('__KHONG_TEN__', { rawNames: new Set(['(Không có tên)']), parcels: [] });
      missingByPerson.get('__KHONG_TEN__').parcels.push(item);
      continue;
    }

    if (!missingByPerson.has(norm)) {
      missingByPerson.set(norm, { rawNames: new Set(), parcels: [] });
    }
    missingByPerson.get(norm).rawNames.add(clean);
    missingByPerson.get(norm).parcels.push(item);
  }

  console.log(`Tổng số chủ hộ / người khác nhau bị thiếu CCCD: ${missingByPerson.size}`);

  // 4. Kiểm tra đối chiếu xem trong số các chủ hộ bị thiếu CCCD này, ai có file trên R2
  const matchedR2 = [];
  const notFoundR2 = [];

  for (const [norm, pData] of missingByPerson.entries()) {
    if (norm === '__KHONG_TEN__') {
      notFoundR2.push({ ...pData, reason: 'Không có tên chủ hộ' });
      continue;
    }

    // Thử khớp chính xác theo normName
    let r2Match = r2CccdByName.get(norm);

    // Nếu không khớp chính xác, thử tìm kiếm gần đúng (chứa từ hoặc bỏ tiền tố)
    if (!r2Match || r2Match.length === 0) {
      const strippedNorm = norm
        .replace(/^(cha cua|con cua|vo cua|me cua|ong|ba|anh|chi|chu|bac|chau|son|bao)\s+/, '')
        .trim();
      if (strippedNorm && strippedNorm !== norm) {
        r2Match = r2CccdByName.get(strippedNorm);
      }
    }

    // Thử tìm substring hoặc khớp 2 chiều
    if (!r2Match || r2Match.length === 0) {
      for (const [r2Norm, files] of r2CccdByName.entries()) {
        if (r2Norm.length >= 6 && norm.length >= 6) {
          if (r2Norm.includes(norm) || norm.includes(r2Norm)) {
            r2Match = files;
            break;
          }
        }
      }
    }

    const rawNameStr = Array.from(pData.rawNames).join(' / ');
    const parcelCodes = pData.parcels.map(p => p.maThua);

    if (r2Match && r2Match.length > 0) {
      matchedR2.push({
        rawName: rawNameStr,
        norm,
        parcels: parcelCodes,
        r2Files: r2Match
      });
    } else {
      notFoundR2.push({
        rawName: rawNameStr,
        norm,
        parcels: parcelCodes
      });
    }
  }

  console.log(`\n=== KẾT QUẢ ĐỐI SOÁT VỚI KHO CCCD R2 ===`);
  console.log(`✅ Số người CÓ FILE CCCD trên R2: ${matchedR2.length} người (tương ứng với ${matchedR2.reduce((acc, x) => acc + x.parcels.length, 0)} thửa đất)`);
  console.log(`❌ Số người KHÔNG TÌM THẤY FILE CCCD trên R2: ${notFoundR2.length} người (tương ứng với ${notFoundR2.reduce((acc, x) => acc + x.parcels.length, 0)} thửa đất)`);

  console.log(`\n--- DANH SÁCH NGƯỜI CÓ THỂ KHÔI PHỤC NGAY TỪ R2 (CÓ FILE CCCD R2) ---`);
  matchedR2.forEach((m, idx) => {
    const fileInfo = m.r2Files.map(f => `${f.filename} (CCCD: ${f.cccd || 'chưa rõ'})`).join(', ');
    console.log(`${idx + 1}. [${m.rawName}] -> Các thửa: ${m.parcels.join(', ')} -> File R2: ${fileInfo}`);
  });

  console.log(`\n--- DANH SÁCH NGƯỜI CHƯA CÓ FILE TRÊN R2 (CẦN THU THẬP THÊM) (Hiện tối đa 40) ---`);
  notFoundR2.slice(0, 40).forEach((nf, idx) => {
    console.log(`${idx + 1}. [${nf.rawName}] -> Các thửa: ${nf.parcels.join(', ')}`);
  });
  if (notFoundR2.length > 40) {
    console.log(`... và ${notFoundR2.length - 40} người khác.`);
  }
}

main().catch(console.error);
