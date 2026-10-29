const https = require('https');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

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
  console.log('--- ĐỐI SOÁT TOÀN BỘ 901 ĐƠN KÊ KHAI VỚI CCCD GỐC TRÊN GGS VÀ R2 ---');
  
  // 1. Lấy declarations từ API
  const declRes = await fetchJson('https://diachinh.phantruc0210.workers.dev/api/declarations');
  const decls = declRes.declarationsMap || {};

  // 2. Lấy ggs.json
  const ggsRes = await s3.send(new GetObjectCommand({ Bucket: 'diachinh-storage', Key: 'cache/ggs.json' }));
  const ggsData = JSON.parse(await ggsRes.Body.transformToString());
  const ggsPeople = ggsData.people || {};
  
  // Xây dựng cccd -> person info từ GGS
  const cccdToGgsPerson = new Map();
  for (const [k, p] of Object.entries(ggsPeople)) {
    const c = cleanCccd(p.cccd);
    if (c) {
      cccdToGgsPerson.set(c, p);
    }
  }

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

  const cccdToR2File = new Map();
  for (const o of r2Objects) {
    const fn = o.Key.replace(/^cccd\//, '').replace(/\.pdf$/i, '');
    const m = fn.match(/^(\d{9,12})(?:_(.*))?$/);
    if (m) {
      const c = cleanCccd(m[1]);
      if (c && m[2]) {
        cccdToR2File.set(c, m[2].trim());
      }
    }
  }

  console.log(`Số CCCD có tên trên GGS: ${cccdToGgsPerson.size}`);
  console.log(`Số CCCD có tên trên R2 file: ${cccdToR2File.size}`);

  const mismatches = [];
  const exactMatches = [];
  const noCccd = [];

  for (const [maThua, d] of Object.entries(decls)) {
    const cccd = cleanCccd(d.chu_dat_cccd || d.cccd || d.cccd_chu_ho);
    const declName = (d.chu_dat_ten || d.chu_ho || '').trim();

    if (!cccd) {
      noCccd.push({ maThua, declName });
      continue;
    }

    // Tìm tên chính chủ của CCCD này
    const ggsP = cccdToGgsPerson.get(cccd);
    const r2Owner = cccdToR2File.get(cccd);

    const realName = (ggsP ? ggsP.full_name : '') || r2Owner || '';

    if (!realName) {
      // CCCD không có tên đối chiếu trên GGS lẫn R2
      continue;
    }

    const sDecl = cleanStrict(declName);
    const sReal = cleanStrict(realName);

    if (sDecl !== sReal) {
      mismatches.push({
        maThua,
        declName,
        realName,
        cccd,
        source: ggsP ? 'GGS' : 'R2',
        namSinh: d.chu_dat_nam_sinh,
        realNamSinh: ggsP ? ggsP.nam_sinh : ''
      });
    } else {
      exactMatches.push({ maThua, declName, cccd });
    }
  }

  console.log(`\n=== TỔNG KẾT PHÂN TÍCH ===`);
  console.log(`- Thửa khớp CHÍNH XÁC 100% tên với CCCD: ${exactMatches.length}`);
  console.log(`- Thửa chưa có số CCCD: ${noCccd.length}`);
  console.log(`- Thửa BỊ SAI LỆCH TÊN VỚI CCCD (CẦN XỬ LÝ): ${mismatches.length}`);

  console.log(`\n=== CHI TIẾT CÁC THỬA BỊ SAI LỆCH TÊN VỚI CCCD ===`);
  mismatches.forEach((m, idx) => {
    console.log(`${idx + 1}. Thửa [${m.maThua}]:`);
    console.log(`   - Tên trên phiếu kê khai: "${m.declName}"`);
    console.log(`   - Tên thực tế của số CCCD (${m.cccd}): "${m.realName}" (Nguồn ${m.source})`);
    if (m.namSinh || m.realNamSinh) {
      console.log(`   - Năm sinh phiếu: ${m.namSinh} | Năm sinh CCCD: ${m.realNamSinh}`);
    }
  });
}

main().catch(console.error);
