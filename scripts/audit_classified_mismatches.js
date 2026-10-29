const https = require('https');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: 'https://0c2efc5ecc976a3e83c4d593c0a800d0.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: 'f7f23fdd9f5274a538df6137912bca4a',
    secretAccessKey: 'ba58bd9ac40b2c2fffc245c62f8f4478310f2176afa634c4e0b1053c292b4310',
  }
});

function cleanCccd(val) {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length === 12 || digits.length === 9) return digits.padStart(12, '0');
  return '';
}

function normalizeUnaccent(s) {
  if (!s) return '';
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanStrict(name) {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/^(ông|bà|ong|ba|hộ|ho)\s+/i, '').replace(/\s+/g, ' ');
}

async function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    });
  });
}

async function main() {
  const declRes = await fetchJson('https://diachinh.phantruc0210.workers.dev/api/declarations');
  const decls = declRes.declarationsMap || {};

  const ggsRes = await s3.send(new GetObjectCommand({ Bucket: 'diachinh-storage', Key: 'cache/ggs.json' }));
  const ggsData = JSON.parse(await ggsRes.Body.transformToString());
  const ggsPeople = ggsData.people || {};
  
  const cccdToGgsPerson = new Map();
  for (const [k, p] of Object.entries(ggsPeople)) {
    const c = cleanCccd(p.cccd);
    if (c) cccdToGgsPerson.set(c, p);
  }

  const falseFills = [];
  const toneMismatches = [];
  const spellingVariants = [];

  for (const [maThua, d] of Object.entries(decls)) {
    const cccd = cleanCccd(d.chu_dat_cccd || d.cccd || d.cccd_chu_ho);
    const declName = (d.chu_dat_ten || d.chu_ho || '').trim();
    if (!cccd || !declName) continue;

    const ggsP = cccdToGgsPerson.get(cccd);
    if (!ggsP) continue;

    const realName = ggsP.full_name;
    const sDecl = cleanStrict(declName);
    const sReal = cleanStrict(realName);

    if (sDecl !== sReal) {
      const uDecl = normalizeUnaccent(declName);
      const uReal = normalizeUnaccent(realName);

      if (uDecl === uReal) {
        // Cùng không dấu: Kiểm tra xem có phải là biến thể viết hoa/thường hay dấu thanh
        // Ví dụ: ayun vs ayŭn, khoẻ vs khỏe
        const isMinor = (sDecl.replace(/[ŭăâêôơư]/g, '') === sReal.replace(/[ŭăâêôơư]/g, '')) &&
          (Math.abs(sDecl.length - sReal.length) <= 1);

        if (
          (sDecl.includes('quang') && sReal.includes('quảng')) ||
          (sDecl.includes('quảng') && sReal.includes('quang')) ||
          (sDecl.includes('vàng') && sReal.includes('vang')) ||
          (sDecl.includes('tiểu') && sReal.includes('tiếu')) ||
          (sDecl.includes('nó') && sReal.includes('nô')) ||
          (sDecl.includes('sành') && sReal.includes('sảnh')) ||
          (sDecl.includes('thánh thành') && sReal.includes('thanh thanh')) ||
          (sDecl.includes('dân') && sReal.includes('đan'))
        ) {
          toneMismatches.push({
            maThua,
            declName,
            realName,
            cccd,
            namSinh: d.chu_dat_nam_sinh,
            realNamSinh: ggsP.nam_sinh
          });
        } else {
          spellingVariants.push({
            maThua,
            declName,
            realName,
            cccd
          });
        }
      } else {
        // KHÁC HẲN NHAU (Nhầm người hoàn toàn)
        falseFills.push({
          maThua,
          declName,
          realName,
          cccd,
          namSinh: d.chu_dat_nam_sinh,
          realNamSinh: ggsP.nam_sinh
        });
      }
    }
  }

  console.log('=== PHÂN LOẠI CHI TIẾT CÁC TRƯỜNG HỢP LỆCH TÊN ===');
  console.log(`\n1. NHẦM DO KHÁC DẤU THANH (Ví dụ điển hình: Quang vs Quảng): ${toneMismatches.length} thửa`);
  toneMismatches.forEach((t, i) => {
    console.log(`   ${i+1}. Thửa [${t.maThua}]: Kê khai "${t.declName}" -> nhưng bị gán CCCD ${t.cccd} của "${t.realName}"`);
  });

  console.log(`\n2. NHẦM NGƯỜI HOÀN TOÀN (Tên không liên quan): ${falseFills.length} thửa`);
  falseFills.forEach((f, i) => {
    console.log(`   ${i+1}. Thửa [${f.maThua}]: Kê khai "${f.declName}" -> nhưng bị gán CCCD ${f.cccd} của "${f.realName}" (Năm sinh: ${f.namSinh} vs ${f.realNamSinh})`);
  });

  console.log(`\n3. BIẾN THỂ CHÍNH TẢ / CÁCH GÕ (Cùng 1 người, chỉ khác cách viết): ${spellingVariants.length} thửa`);
  spellingVariants.slice(0, 15).forEach((v, i) => {
    console.log(`   ${i+1}. Thửa [${v.maThua}]: "${v.declName}" <=> "${v.realName}"`);
  });
  if (spellingVariants.length > 15) {
    console.log(`   ... và ${spellingVariants.length - 15} trường hợp biến thể khác.`);
  }
}

main().catch(console.error);
