const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: 'https://0c2efc5ecc976a3e83c4d593c0a800d0.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: 'f7f23fdd9f5274a538df6137912bca4a',
    secretAccessKey: 'ba58bd9ac40b2c2fffc245c62f8f4478310f2176afa634c4e0b1053c292b4310',
  }
});

const BUCKET = 'diachinh-storage';
const KEY = 'declarations/all.json';

async function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function main() {
  console.log('Fetching declarations/all.json from R2...');
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
  const jsonStr = await streamToString(res.Body);
  const data = JSON.parse(jsonStr);

  const decl = data.declarationsMap['162_330'] || {};
  console.log('Current decl for 162_330:', decl);

  decl.chu_dat_ten = 'Bà Trinh';
  decl.chu_ho = 'Bà Trinh';
  decl.ho_va_ten_chu_ho = 'Bà Trinh';
  decl.nguon_goc_su_dung = 'Thừa Kế';
  decl.nguon_goc = 'Thừa kế';
  decl.thon_xa = 'Buôn Bhung';
  decl.dia_chi_thua_dat = 'Buôn Bhung';
  decl.updated_at = new Date().toISOString();

  data.declarationsMap['162_330'] = decl;

  if (!data.cellEdits) data.cellEdits = {};
  data.cellEdits['162_330'] = { '0': 'Bà Trinh', '2': 'Buôn Bhung' };
  data.updatedAt = new Date().toISOString();

  console.log('Updating to R2...');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: KEY,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }));

  console.log('Successfully updated 162_330 on R2 declarations/all.json!');
}

main().catch(console.error);
