const fs = require('fs');

async function checkExact() {
  const [declRes, cccdRes] = await Promise.all([
    fetch('http://localhost:3000/api/declarations'),
    fetch('http://localhost:3000/api/cccd?list_only=1')
  ]);

  const declData = await declRes.json();
  const cccdData = await cccdRes.json();

  const declMap = declData.declarationsMap || {};
  const existingCccdSet = new Set(cccdData.cccdList || []);
  const r2Filenames = cccdData.filenames || [];

  function cleanCccd(raw) {
    if (!raw) return '';
    return String(raw).replace(/\D/g, '').trim();
  }

  function stripAccents(str) {
    if (!str) return '';
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }

  function hasCccdInR2(decl, personName) {
    if (decl.cccd_url || decl.file_cccd_pdf || decl.cccd_file) return true;
    const rawCccd = decl.chu_dat_cccd || decl.cccd_chu_ho || decl.cccd || '';
    const cccdClean = cleanCccd(rawCccd);
    if ((cccdClean.length === 12 || cccdClean.length === 9) && existingCccdSet.has(cccdClean)) return true;
    if (personName && r2Filenames.length > 0) {
      const normName = stripAccents(personName).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normName.length >= 4) {
        const matched = r2Filenames.some((fn) => {
          const normFn = stripAccents(fn).toLowerCase().replace(/[^a-z0-9]/g, '');
          return normFn.includes(normName);
        });
        if (matched) return true;
      }
    }
    return false;
  }

  // 1. Phân loại theo THỬA ĐẤT (giống syncGoogleSheets)
  let totalDeclaredParcels = 0;
  let parcelsWithR2Cccd = [];
  let parcelsMissingCccd = [];

  for (const [code, decl] of Object.entries(declMap)) {
    totalDeclaredParcels++;
    const name = String(decl.chu_dat_ten || decl.chu_ho || '').trim();
    if (hasCccdInR2(decl, name)) {
      parcelsWithR2Cccd.push(code);
    } else {
      parcelsMissingCccd.push({ code, decl, name });
    }
  }

  // 2. Phân loại theo NGƯỜI (giống CccdCollectPanel)
  const peopleMap = new Map();
  for (const item of parcelsMissingCccd) {
    const name = item.name;
    if (!name || name === 'Chưa có tên') continue;
    const village = item.decl.thon_xa || item.decl.dia_chi_thua_dat || 'Chưa xác định';
    const groupKey = `${name.toLowerCase()}___${village.toLowerCase()}`;
    if (!peopleMap.has(groupKey)) {
      peopleMap.set(groupKey, {
        name,
        village,
        parcels: []
      });
    }
    peopleMap.get(groupKey).parcels.push(item.code);
  }

  console.log('=== KẾT QUẢ ĐỐI CHIẾU CHÍNH XÁC ===');
  console.log(`1. Tổng số thửa đất đã kê khai: ${totalDeclaredParcels} thửa`);
  console.log(`2. Số thửa đã có CCCD trên R2: ${parcelsWithR2Cccd.length} thửa`);
  console.log(`3. Số THỬA ĐẤT chưa có CCCD: ${parcelsMissingCccd.length} THỬA (Con số 536 trên báo cáo chính là SỐ THỬA ĐẤT!)`);
  console.log(`4. Số CÔNG DÂN (NGƯỜI) trong danh sách thu thập: ${peopleMap.size} NGƯỜI (Con số 418 chính là SỐ NGƯỜI!)`);
  console.log(`\n=> Chênh lệch: ${parcelsMissingCccd.length} thửa - ${peopleMap.size} người = ${parcelsMissingCccd.length - peopleMap.size} thửa dôi dư.`);
  console.log(`Lý do: 1 người có thể đứng tên từ 2 đến nhiều thửa đất khác nhau! Khi thu thập CCCD, 1 người chỉ cần thu 1 thẻ CCCD cho tất cả các thửa đất của họ.`);

  let multiOwners = [];
  for (const [k, v] of peopleMap.entries()) {
    if (v.parcels.length > 1) {
      multiOwners.push(v);
    }
  }
  console.log(`\nCó tổng cộng ${multiOwners.length} người sở hữu từ 2 thửa đất trở lên!`);
  console.log(`Tổng số thửa đất thuộc nhóm người này là: ${multiOwners.reduce((s, o) => s + o.parcels.length, 0)} thửa.`);
}

checkExact();
