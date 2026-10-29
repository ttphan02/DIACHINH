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
  const declRes = await fetchJson('https://diachinh.phantruc0210.workers.dev/api/declarations');
  const decls = declRes.declarationsMap || {};
  
  console.log('--- TÌM KIẾM DƯƠNG VĂN QUANG / QUẢNG TRONG DECLARATIONSMAP ---');
  for (const [maThua, d] of Object.entries(decls)) {
    const name = (d.chu_dat_ten || d.chu_ho || '').toLowerCase();
    if (name.includes('quang') || name.includes('quảng')) {
      console.log(`Mã thửa: ${maThua}`);
      console.log(`  Tên chủ đất: ${d.chu_dat_ten}`);
      console.log(`  Năm sinh: ${d.chu_dat_nam_sinh}`);
      console.log(`  CCCD: ${d.chu_dat_cccd}`);
      console.log(`  Địa chỉ: ${d.chu_dat_dia_chi}`);
      console.log(`  Device: ${d.device_id}`);
      console.log(`  Created at: ${d.created_at}`);
      console.log(`  Thửa kèm theo: ${JSON.stringify(d.thua_kem_theo || [])}`);
    }
  }

  console.log('\n--- TÌM KIẾM TRONG GGS CACHE ---');
  const ggsRes = await s3.send(new GetObjectCommand({ Bucket: 'diachinh-storage', Key: 'cache/ggs.json' }));
  const ggsData = JSON.parse(await ggsRes.Body.transformToString());
  const ggsPeople = ggsData.people || {};
  const ggsParcels = ggsData.parcels || {};

  console.log('Trong ggsPeople:');
  for (const [k, p] of Object.entries(ggsPeople)) {
    if (k.includes('quang') || (p.full_name && p.full_name.toLowerCase().includes('quang'))) {
      console.log(`  Key: [${k}] -> Full: [${p.full_name}], CCCD: [${p.cccd}], NamSinh: [${p.nam_sinh}], DiaChi: [${p.dia_chi}]`);
    }
  }

  console.log('\nTrong ggsParcels:');
  for (const [code, p] of Object.entries(ggsParcels)) {
    if (p.chu_ho && (p.chu_ho.toLowerCase().includes('quang') || p.chu_ho.toLowerCase().includes('quảng'))) {
      console.log(`  Mã thửa: ${code} -> ChuHo: [${p.chu_ho}], CCCD: [${p.cccd}]`);
    }
  }
}

main().catch(console.error);
