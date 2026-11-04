const fs = require('fs');
const data = JSON.parse(fs.readFileSync('scripts/audit_r2_exact_result.json', 'utf8'));

console.log('--- 1. CHI TIẾT NHÓM ĐANG KÊ KHAI CHƯA CÓ CCCD (18 CHỦ HỘ / 34 THỬA) ---');
data.dangKeKhaiPersons.forEach((p, idx) => {
  const f = p.r2Files[0];
  console.log(`${idx + 1}. Chủ hộ: ${p.chuHo} | Thôn: ${p.thon}`);
  console.log(`   - Thửa đất (${p.parcels.length}): ${p.parcels.join(', ')}`);
  console.log(`   - File CCCD trên R2: ${f.filename} ${f.cccd ? '| Số CCCD: ' + f.cccd : ''}`);
});

console.log('\n--- 2. CHI TIẾT NHÓM CHƯA LÀM (7 CHỦ HỘ / 8 THỬA) ---');
data.chuaLamPersons.forEach((p, idx) => {
  const f = p.r2Files[0];
  console.log(`${idx + 1}. Chủ hộ: ${p.chuHo} | Thôn: ${p.thon}`);
  console.log(`   - Thửa đất (${p.parcels.length}): ${p.parcels.join(', ')}`);
  console.log(`   - File CCCD trên R2: ${f.filename} ${f.cccd ? '| Số CCCD: ' + f.cccd : ''}`);
});
