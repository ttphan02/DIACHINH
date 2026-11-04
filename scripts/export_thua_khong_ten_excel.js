const fs = require('fs');
const https = require('https');
const path = require('path');
const XLSX = require('xlsx');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: 'https://0c2efc5ecc976a3e83c4d593c0a800d0.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: 'f7f23fdd9f5274a538df6137912bca4a',
    secretAccessKey: 'ba58bd9ac40b2c2fffc245c62f8f4478310f2176afa634c4e0b1053c292b4310',
  }
});

function isPersonName(name) {
  if (!name) return false;
  const s = String(name).trim();
  if (s.length < 3 || s === '0' || s === '..' || s.startsWith('w6jp')) return false;
  if (/^(đất|ubnd|ban|công ty|hội|trường|trạm|chùa|nhà thờ|suối|đường|giao thông|thủy lợi|nghĩa trang|khu dân cư|chưa xác định)/i.test(s)) {
    return false;
  }
  const clean = s.replace(/^(hộ ông và bà|hộ ông bà|hộ và tên|hộ gia đình|vợ chồng ông bà|vợ chồng|hộ ông|hộ bà|ông bà|ông|bà|chú|bác|anh|chị|cháu)\s*:?\s*/i, '').trim();
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  return words.length >= 2;
}

function classifyNameType(name) {
  if (!name) return 'Chưa có tên trong CSDL';
  const s = String(name).trim();
  if (s === '0' || s === '' || s === '..' || s.startsWith('w6jp') || s === 'Không có trong dữ liệu') {
    return 'Chưa có tên trong CSDL';
  }
  if (/^(đất|ubnd|ban|công ty|hội|trường|trạm|chùa|nhà thờ|suối|đường|giao thông|thủy lợi|nghĩa trang|khu dân cư|chưa xác định)/i.test(s)) {
    return 'Đất công / Tổ chức';
  }
  const clean = s.replace(/^(hộ ông và bà|hộ ông bà|hộ và tên|hộ gia đình|vợ chồng ông bà|vợ chồng|hộ ông|hộ bà|ông bà|ông|bà|chú|bác|anh|chị|cháu)\s*:?\s*/i, '').trim();
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2) {
    return 'Tên chưa đầy đủ (1 từ - cần xác minh)';
  }
  return 'Tên người';
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

async function generateKhongTenExcel() {
  console.log('=== BẮT ĐẦU XUẤT EXCEL DANH SÁCH THỬA CHƯA KÊ KHAI KHÔNG TÊN ===\n');

  // 1. Nạp dữ liệu cơ sở
  console.log('1. Đang nạp dữ liệu địa chính và declarations...');
  const allParcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));
  const hiddenParcels = new Set(JSON.parse(fs.readFileSync('src/data/hidden_parcels.json', 'utf8')));
  const digitizedParcels = new Set(JSON.parse(fs.readFileSync('src/data/digitized_parcels.json', 'utf8')));
  const kh2959Nhom1 = new Set(JSON.parse(fs.readFileSync('src/data/kh2959_nhom1.json', 'utf8')));

  const declRes = await fetchJSON('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/declarations/all.json');
  const declarationsMap = declRes?.declarationsMap || {};
  const declaredCodes = new Set(Object.keys(declarationsMap));

  // 2. Lấy danh sách file scan hồ sơ trên R2
  console.log('2. Đang quét danh sách file scan hồ sơ trên R2...');
  const fileScanObjs = await listAllR2Objects('filescan/');
  const r2ScanByToThua = new Map();
  for (const obj of fileScanObjs) {
    const filename = obj.Key.replace(/^filescan\//, '');
    const cleanSf = filename.replace(/^CHUACOGIAY_\d+_/i, '').replace(/[-_]DDK(\.pdf)?$/i, '');
    const mtMatch = cleanSf.match(/(\d+)[_-](\d+)/);
    if (mtMatch) {
      const toNum = String(parseInt(mtMatch[1], 10) || mtMatch[1]);
      const thuaNum = String(parseInt(mtMatch[2], 10) || mtMatch[2]);
      r2ScanByToThua.set(`${toNum}_${thuaNum}`, filename);
    }
  }

  // 3. Lọc danh sách Chưa kê khai không tên
  console.log('3. Đang lọc danh sách các thửa Chưa kê khai không tên...');
  const khongTenParcels = [];

  for (const p of allParcels) {
    const ma = p.ma_thua;
    if (!ma) continue;
    if (hiddenParcels.has(ma) || digitizedParcels.has(ma) || kh2959Nhom1.has(ma)) continue;
    if (declaredCodes.has(ma) || p.is_declared) continue;

    const chuHo = String(p.chu_ho || '').trim();
    if (!chuHo || chuHo === '0' || chuHo === 'Không có trong dữ liệu' || !isPersonName(chuHo)) {
      khongTenParcels.push(p);
    }
  }

  // Sắp xếp theo Tờ bản đồ và Số thửa tăng dần
  khongTenParcels.sort((a, b) => {
    const toA = parseInt(a.to_ban_do, 10) || 0;
    const toB = parseInt(b.to_ban_do, 10) || 0;
    if (toA !== toB) return toA - toB;
    const thuaA = parseInt(a.so_thua, 10) || 0;
    const thuaB = parseInt(b.so_thua, 10) || 0;
    return thuaA - thuaB;
  });

  console.log(`-> Tìm thấy tổng cộng: ${khongTenParcels.length} thửa đất chưa kê khai không tên!\n`);

  // 4. Xây dựng các nhóm dữ liệu
  const allRows = [];
  const chuaCoTenRows = [];
  const tenChuaDayDuRows = [];
  const datCongRows = [];

  const stats = {
    total: khongTenParcels.length,
    chuaCoTen: 0,
    tenChuaDayDu: 0,
    datCong: 0,
    byThon: {},
    byTo: {},
    byLoaiDat: {},
  };

  khongTenParcels.forEach((p, idx) => {
    const to = String(p.to_ban_do || '');
    const thua = String(p.so_thua || '');
    const chuHo = String(p.chu_ho || '').trim();
    const phanLoai = classifyNameType(chuHo);
    const thon = p.thon_xa || 'Chưa xác định';
    const dienTich = String(p.dien_tich || '').replace('.', ',');
    const loaiDat = String(p.loai_dat || 'Chưa xác định').toUpperCase();
    const fileScan = r2ScanByToThua.get(`${to}_${thua}`) || '';
    const lat = p.lat || '';
    const lng = p.lng || '';
    const gmapLink = p.gmap_link || (lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : '');

    // Cập nhật thống kê
    stats.byThon[thon] = (stats.byThon[thon] || 0) + 1;
    stats.byTo[to] = (stats.byTo[to] || 0) + 1;
    stats.byLoaiDat[loaiDat] = (stats.byLoaiDat[loaiDat] || 0) + 1;

    let ghiChuChiTiet = '';
    if (phanLoai === 'Chưa có tên trong CSDL') {
      stats.chuaCoTen++;
      ghiChuChiTiet = chuHo && chuHo.startsWith('w6jp') ? 'Mã Geohash CAD không có tên' : 'Ô tên trống / 0';
    } else if (phanLoai === 'Tên chưa đầy đủ (1 từ - cần xác minh)') {
      stats.tenChuaDayDu++;
      ghiChuChiTiet = `Ghi nhận tạm: "${chuHo}" (cần xác minh họ tên đầy đủ)`;
    } else if (phanLoai === 'Đất công / Tổ chức') {
      stats.datCong++;
      ghiChuChiTiet = `Tổ chức / Đất công: ${chuHo}`;
    }

    const row = {
      'STT': idx + 1,
      'Mã thửa': p.ma_thua,
      'Tờ bản đồ': to,
      'Số thửa': thua,
      'Thôn / Buôn': thon,
      'Ghi nhận tên trong CSDL': chuHo === '0' ? '(Không có)' : (chuHo.startsWith('w6jp') ? '(Mã Geohash)' : (chuHo || '(Trống)')),
      'Phân loại hiện trạng': phanLoai,
      'Diện tích (m²)': dienTich,
      'Loại đất': loaiDat,
      'Nguồn gốc sử dụng': 'Khai hoang',
      'Trạng thái hồ sơ': 'Chưa kê khai (Không có tên)',
      'File Scan hồ sơ': fileScan,
      'Tọa độ Lat': lat,
      'Tọa độ Lng': lng,
      'Link Google Maps': gmapLink,
      'Mã định danh Geohash': p.ma_dinh_danh || '',
      'Ghi chú xác minh': ghiChuChiTiet
    };

    allRows.push(row);

    if (phanLoai === 'Chưa có tên trong CSDL') {
      chuaCoTenRows.push({ ...row });
    } else if (phanLoai === 'Tên chưa đầy đủ (1 từ - cần xác minh)') {
      tenChuaDayDuRows.push({ ...row });
    } else if (phanLoai === 'Đất công / Tổ chức') {
      datCongRows.push({ ...row });
    }
  });

  // Đánh lại STT cho từng Sheet con
  chuaCoTenRows.forEach((r, i) => r['STT'] = i + 1);
  tenChuaDayDuRows.forEach((r, i) => r['STT'] = i + 1);
  datCongRows.forEach((r, i) => r['STT'] = i + 1);

  // 5. Tạo Workbook Excel
  console.log('4. Đang tạo các bảng tính và bố cục file Excel...');
  const wb = XLSX.utils.book_new();

  // Sheet 1: Tổng hợp toàn bộ
  const wsAll = XLSX.utils.json_to_sheet(allRows);
  XLSX.utils.book_append_sheet(wb, wsAll, `TẤT CẢ KHÔNG TÊN (${allRows.length})`);

  // Sheet 2: Chưa có tên
  const wsChuaCoTen = XLSX.utils.json_to_sheet(chuaCoTenRows);
  XLSX.utils.book_append_sheet(wb, wsChuaCoTen, `HOÀN TOÀN CHƯA CÓ TÊN (${chuaCoTenRows.length})`);

  // Sheet 3: Tên chưa đầy đủ (cần xác minh)
  const wsTenChuaDayDu = XLSX.utils.json_to_sheet(tenChuaDayDuRows);
  XLSX.utils.book_append_sheet(wb, wsTenChuaDayDu, `TÊN 1 TỪ CẦN XÁC MINH (${tenChuaDayDuRows.length})`);

  // Sheet 4: Đất công / Tổ chức
  const wsDatCong = XLSX.utils.json_to_sheet(datCongRows);
  XLSX.utils.book_append_sheet(wb, wsDatCong, `ĐẤT CÔNG - TỔ CHỨC (${datCongRows.length})`);

  // Sheet 5: Báo cáo thống kê
  const summaryRows = [
    { 'Chỉ tiêu': 'TỔNG SỐ THỬA CHƯA KÊ KHAI KHÔNG TÊN', 'Số lượng (thửa)': stats.total, 'Ghi chú': 'Toàn bộ địa bàn xã Cư Pui' },
    { 'Chỉ tiêu': '- Hoàn toàn chưa có tên (0, trống, geohash)', 'Số lượng (thửa)': stats.chuaCoTen, 'Ghi chú': 'Cần đi thực địa xác định chủ sở hữu' },
    { 'Chỉ tiêu': '- Tên chưa đầy đủ (chỉ có Ông A, Ông B...)', 'Số lượng (thửa)': stats.tenChuaDayDu, 'Ghi chú': 'Cần xác minh họ tên đầy đủ, CCCD' },
    { 'Chỉ tiêu': '- Đất công / Tổ chức (UBND, Trường, Kiểm lâm...)', 'Số lượng (thửa)': stats.datCong, 'Ghi chú': 'Đất của tổ chức/nhà nước' },
    { 'Chỉ tiêu': '', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    { 'Chỉ tiêu': '--- PHÂN BỐ THEO THÔN / BUÔN ---', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    ...Object.entries(stats.byThon)
      .sort((a, b) => b[1] - a[1])
      .map(([thon, count]) => ({
        'Chỉ tiêu': thon,
        'Số lượng (thửa)': count,
        'Ghi chú': ''
      })),
    { 'Chỉ tiêu': '', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    { 'Chỉ tiêu': '--- PHÂN BỐ THEO LOẠI ĐẤT ---', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    ...Object.entries(stats.byLoaiDat)
      .sort((a, b) => b[1] - a[1])
      .map(([ld, count]) => ({
        'Chỉ tiêu': `Đất ${ld}`,
        'Số lượng (thửa)': count,
        'Ghi chú': ''
      })),
    { 'Chỉ tiêu': '', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    { 'Chỉ tiêu': '--- PHÂN BỐ THEO TỜ BẢN ĐỒ ---', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    ...Object.entries(stats.byTo)
      .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
      .map(([to, count]) => ({
        'Chỉ tiêu': `Tờ bản đồ ${to}`,
        'Số lượng (thửa)': count,
        'Ghi chú': ''
      }))
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'THỐNG KÊ TỔNG HỢP');

  // Đặt chiều rộng cột tự động
  const colWidths = [
    { wch: 6 },  // STT
    { wch: 12 }, // Mã thửa
    { wch: 10 }, // Tờ bản đồ
    { wch: 10 }, // Số thửa
    { wch: 28 }, // Thôn/Buôn
    { wch: 26 }, // Ghi nhận tên
    { wch: 32 }, // Phân loại
    { wch: 14 }, // Diện tích
    { wch: 10 }, // Loại đất
    { wch: 18 }, // Nguồn gốc
    { wch: 26 }, // Trạng thái
    { wch: 32 }, // File scan
    { wch: 14 }, // Lat
    { wch: 14 }, // Lng
    { wch: 45 }, // Google Maps
    { wch: 16 }, // Geohash
    { wch: 38 }, // Ghi chú xác minh
  ];

  [wsAll, wsChuaCoTen, wsTenChuaDayDu, wsDatCong].forEach(ws => {
    ws['!cols'] = colWidths;
  });
  wsSummary['!cols'] = [{ wch: 42 }, { wch: 18 }, { wch: 35 }];

  // 6. Ghi file Excel
  const exportPath = path.resolve('../DANH_SACH_THUA_CHUA_KE_KHAI_KHONG_TEN.xlsx');
  XLSX.writeFile(wb, exportPath);
  console.log(`\n🎉 ĐÃ XUẤT THÀNH CÔNG FILE EXCEL TẠI:`);
  console.log(`-> ${exportPath}`);

  const publicPath = path.resolve('public/DANH_SACH_THUA_CHUA_KE_KHAI_KHONG_TEN.xlsx');
  XLSX.writeFile(wb, publicPath);
  console.log(`-> Bản tải trực tiếp qua web: ${publicPath}\n`);
}

generateKhongTenExcel().catch(console.error);
