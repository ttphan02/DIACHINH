const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
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
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
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
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  // 1. Lấy declarations
  const declRes = await fetchJson('https://diachinh.phantruc0210.workers.dev/api/declarations');
  const decls = declRes.declarationsMap || {};

  // 2. Lấy cache/ggs.json
  const ggsRes = await s3.send(new GetObjectCommand({ Bucket: 'diachinh-storage', Key: 'cache/ggs.json' }));
  const ggsData = JSON.parse(await ggsRes.Body.transformToString());
  const ggsParcels = ggsData.parcels || {};
  const ggsPeople = ggsData.people || {};

  // 3. Lấy tất cả file cccd/ trên R2
  const r2Objects = [];
  let token = undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: 'diachinh-storage',
      Prefix: 'cccd/',
      MaxKeys: 1000,
      ContinuationToken: token,
    }));
    if (res.Contents) r2Objects.push(...res.Contents);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  const r2CccdSet = new Set();
  const r2FilesByName = new Map();
  for (const o of r2Objects) {
    const fn = o.Key.replace(/^cccd\//, '').replace(/\.pdf$/i, '');
    const m = fn.match(/^(\d{9,12})(?:_(.*))?$/);
    if (m) {
      r2CccdSet.add(m[1]);
      if (m[2]) {
        const n = normalizeName(m[2]);
        if (!r2FilesByName.has(n)) r2FilesByName.set(n, []);
        r2FilesByName.get(n).push({ cccd: m[1], file: o.Key });
      }
    } else {
      const m2 = fn.match(/\b\d{9,12}\b/);
      if (m2) r2CccdSet.add(m2[0]);
    }
  }

  console.log('Tổng số CCCD trên R2:', r2CccdSet.size);

  // 4. Kiểm tra 254 thửa bị thiếu CCCD
  let hasFileInR2 = 0;
  const recoverableList = [];
  const trulyMissingList = [];

  for (const [maThua, d] of Object.entries(decls)) {
    const currentCccd = cleanCccd(d.chu_dat_cccd || d.cccd || d.cccd_chu_ho);
    if (currentCccd) continue; // Đã có CCCD

    const owner = (d.chu_dat_ten || d.chu_ho || d.ho_va_ten_chu_ho || '').trim();
    const normOwner = normalizeName(owner);

    let foundCccd = '';
    let foundSource = '';

    // A. Thử tìm theo mã thửa trong GGS
    const ggsP = ggsParcels[maThua];
    if (ggsP && cleanCccd(ggsP.cccd)) {
      foundCccd = cleanCccd(ggsP.cccd);
      foundSource = 'GGS Parcel (thửa có CCCD trên GGS)';
    }

    // B. Thử tìm theo tên người trong GGS
    if (!foundCccd && normOwner) {
      const p = ggsPeople[normOwner];
      if (p && cleanCccd(p.cccd)) {
        foundCccd = cleanCccd(p.cccd);
        foundSource = 'GGS Person (tìm theo tên)';
      } else {
        // Thử tìm gần đúng trong ggsPeople
        for (const [k, v] of Object.entries(ggsPeople)) {
          if (normalizeName(k) === normOwner || normalizeName(v.full_name) === normOwner) {
            if (cleanCccd(v.cccd)) {
              foundCccd = cleanCccd(v.cccd);
              foundSource = 'GGS Person (tìm gần đúng)';
              break;
            }
          }
        }
      }
    }

    // C. Thử tìm theo tên trong file R2
    if (!foundCccd && normOwner) {
      const matches = r2FilesByName.get(normOwner);
      if (matches && matches.length > 0) {
        foundCccd = matches[0].cccd;
        foundSource = 'R2 Filename (tên file trên R2)';
      }
    }

    // Kiểm tra xem số CCCD tìm được có file PDF trên R2 không
    let inR2 = false;
    if (foundCccd && r2CccdSet.has(foundCccd)) {
      inR2 = true;
      hasFileInR2++;
    }

    if (foundCccd) {
      recoverableList.push({
        maThua,
        owner,
        foundCccd,
        foundSource,
        hasFileInR2: inR2
      });
    } else {
      trulyMissingList.push({
        maThua,
        owner,
        thon: d.thon_xa
      });
    }
  }

  console.log('\n--- KẾT QUẢ PHÂN TÍCH KHÔI PHỤC ---');
  console.log('Tổng số thửa thiếu CCCD:', recoverableList.length + trulyMissingList.length);
  console.log(`Tìm được số CCCD (có thể khôi phục): ${recoverableList.length} thửa`);
  console.log(`  -> Trong đó ĐÃ CÓ FILE PDF TRÊN R2: ${hasFileInR2} thửa`);
  console.log(`  -> Số CCCD có nhưng chưa có PDF trên R2: ${recoverableList.length - hasFileInR2} thửa`);
  console.log(`Hoàn toàn không tìm thấy CCCD (chưa từng có): ${trulyMissingList.length} thửa`);

  console.log('\n--- MẪU 25 THỬA CÓ THỂ KHÔI PHỤC ĐƯỢC ---');
  recoverableList.slice(0, 25).forEach(r => {
    console.log(`- Mã thửa ${r.maThua} (${r.owner}): CCCD ${r.foundCccd} [${r.foundSource}] (File PDF R2: ${r.hasFileInR2 ? 'CÓ' : 'CHƯA'})`);
  });

  console.log('\n--- MẪU 25 THỬA THẬT SỰ CHƯA CÓ TRÊN HỆ THỐNG ---');
  trulyMissingList.slice(0, 25).forEach(r => {
    console.log(`- Mã thửa ${r.maThua} (${r.owner}) - ${r.thon || 'Chưa rõ thôn'}`);
  });
}
main().catch(console.error);
