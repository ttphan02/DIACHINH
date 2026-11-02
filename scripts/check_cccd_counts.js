const fs = require('fs');
const path = require('path');

// Đọc declarations nếu có file local cache hoặc test
async function analyze() {
  console.log('--- PHÂN TÍCH SỰ CHÊNH LỆCH GIỮA 536 THỬA VÀ 418 NGƯỜI ---');
  
  // Kiểm tra xem có file declarations local không
  const possiblePaths = [
    'd:/DIACHINH/all_declarations.json',
    'd:/Documents/Xiaohongshu_video/FB_UPLOADER/diachinh-web/declarations.json',
  ];

  let declMap = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log('Tìm thấy file declarations tại:', p);
      const content = fs.readFileSync(p, 'utf-8');
      const json = JSON.parse(content);
      declMap = json.declarationsMap || json;
      break;
    }
  }

  // Nếu không có file local, fetch từ local dev server hoặc API
  if (!declMap) {
    try {
      console.log('Đang lấy dữ liệu từ http://localhost:3000/api/declarations ...');
      const res = await fetch('http://localhost:3000/api/declarations');
      if (res.ok) {
        const json = await res.json();
        declMap = json.declarationsMap || {};
        console.log('Lấy thành công declarationsMap từ localhost, số lượng thửa kê khai:', Object.keys(declMap).length);
      }
    } catch (e) {
      console.log('Không kết nối được localhost, thử Cloudflare API...');
      try {
        const res = await fetch('https://diachinh.pages.dev/api/declarations');
        if (res.ok) {
          const json = await res.json();
          declMap = json.declarationsMap || {};
          console.log('Lấy thành công declarationsMap từ production, số lượng thửa kê khai:', Object.keys(declMap).length);
        }
      } catch (err) {
        console.error('Lỗi fetch:', err.message);
      }
    }
  }

  if (!declMap) {
    console.log('Không lấy được declarationsMap. Kiểm tra file briefs...');
    return;
  }

  // Tải danh sách CCCD R2
  let existingCccdSet = new Set();
  let r2Filenames = [];
  try {
    const cccdRes = await fetch('https://diachinh.pages.dev/api/cccd?list_only=1');
    if (cccdRes.ok) {
      const cData = await cccdRes.json();
      existingCccdSet = new Set(cData.cccdList || []);
      r2Filenames = cData.filenames || [];
      console.log(`Số CCCD trên R2: ${existingCccdSet.size}, Số file: ${r2Filenames.length}`);
    }
  } catch (e) {
    console.log('Lỗi lấy cccd list:', e.message);
  }

  // Giả lập logic phân loại của syncGoogleSheets & CccdCollectPanel
  const allParcelsCount = Object.keys(declMap).length;
  console.log(`Tổng số thửa đã kê khai: ${allParcelsCount}`);

  // Thống kê số thửa theo từng điều kiện
  let parcelsWithFileInR2 = 0;
  let parcelsWithCccdNumberInR2 = 0;
  let parcelsNoName = 0;
  let parcelsMissingCccd = [];

  for (const [code, decl] of Object.entries(declMap)) {
    const name = String(decl.chu_dat_ten || decl.chu_ho || '').trim();
    if (!name || name === 'Chưa có tên') {
      parcelsNoName++;
      continue;
    }

    const hasFile = Boolean(decl.cccd_url || decl.file_cccd_pdf || decl.cccd_file);
    if (hasFile) {
      parcelsWithFileInR2++;
      continue;
    }

    const rawCccd = String(decl.chu_dat_cccd || decl.cccd_chu_ho || decl.cccd || '').replace(/\D/g, '');
    if ((rawCccd.length === 12 || rawCccd.length === 9) && existingCccdSet.has(rawCccd)) {
      parcelsWithCccdNumberInR2++;
      continue;
    }

    parcelsMissingCccd.push({
      code,
      name,
      thonXa: decl.thon_xa || decl.dia_chi_thua_dat || 'Chưa xác định',
    });
  }

  console.log(`\n--- KẾT QUẢ THỐNG KÊ THỬA ĐẤT ---`);
  console.log(`- Số thửa không có tên / 'Chưa có tên': ${parcelsNoName}`);
  console.log(`- Số thửa đã có file CCCD (R2): ${parcelsWithFileInR2}`);
  console.log(`- Số thửa có số CCCD trùng khớp trên R2: ${parcelsWithCccdNumberInR2}`);
  console.log(`- Số THỬA ĐẤT chưa có CCCD: ${parcelsMissingCccd.length}`);

  // Bây giờ gom nhóm theo người (Tên + Thôn)
  const peopleMap = new Map();
  for (const p of parcelsMissingCccd) {
    const key = `${p.name.toLowerCase()}___${p.thonXa.toLowerCase()}`;
    if (!peopleMap.has(key)) {
      peopleMap.set(key, {
        name: p.name,
        thonXa: p.thonXa,
        parcels: [],
      });
    }
    peopleMap.get(key).parcels.push(p.code);
  }

  console.log(`\n--- KẾT QUẢ GOM NHÓM THEO CÔNG DÂN (NGƯỜI) ---`);
  console.log(`- Tổng số CÔNG DÂN (người) cần thu thập CCCD: ${peopleMap.size}`);

  // Phân tích những người có nhiều thửa đất
  let singleParcelCount = 0;
  let multiParcelCount = 0;
  let multiParcelsTotal = 0;
  const multiOwners = [];

  for (const [key, val] of peopleMap.entries()) {
    if (val.parcels.length === 1) {
      singleParcelCount++;
    } else {
      multiParcelCount++;
      multiParcelsTotal += val.parcels.length;
      multiOwners.push(val);
    }
  }

  console.log(`- Số người chỉ có 1 thửa đất: ${singleParcelCount} người (= ${singleParcelCount} thửa)`);
  console.log(`- Số người có TỪ 2 THỬA ĐẤT TRỞ LÊN: ${multiParcelCount} người (sở hữu tổng cộng ${multiParcelsTotal} thửa)`);
  console.log(`- Độ chênh lệch giữa số thửa và số người: ${parcelsMissingCccd.length} thửa - ${peopleMap.size} người = ${parcelsMissingCccd.length - peopleMap.size} thửa dôi dư do người sở hữu nhiều thửa!`);

  console.log(`\nVí dụ 5 người sở hữu nhiều thửa đất nhất trong nhóm cần thu CCCD:`);
  multiOwners.sort((a, b) => b.parcels.length - a.parcels.length);
  multiOwners.slice(0, 5).forEach((o, i) => {
    console.log(`  ${i+1}. ${o.name} (${o.thonXa}): sở hữu ${o.parcels.length} thửa đất [${o.parcels.join(', ')}]`);
  });
}

analyze();
