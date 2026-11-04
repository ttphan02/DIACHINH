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

function cleanCccd(val) {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length === 12 || digits.length === 9) return digits;
  return '';
}

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

function stripHonorifics(norm) {
  if (!norm) return '';
  return norm
    .replace(/^(ho ong va ba|ho ong ba|ho va ten|ho gia dinh|vo chong ong ba|vo chong|ho ong|ho ba|ong ba|ong|ba|chu|bac|anh|chi|chau)\s*:?\s*/, '')
    .trim();
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

async function generateExcel() {
  console.log('=== BẮT ĐẦU XUẤT EXCEL DANH SÁCH THỬA ĐẤT THÔN EA RỚT ===\n');

  // 1. Lấy dữ liệu cơ bản
  console.log('1. Đang nạp dữ liệu parcels.json & declarations...');
  const allParcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));
  const hiddenParcels = new Set(JSON.parse(fs.readFileSync('src/data/hidden_parcels.json', 'utf8')));
  const digitizedParcels = new Set(JSON.parse(fs.readFileSync('src/data/digitized_parcels.json', 'utf8')));
  const kh2959Nhom1 = new Set(JSON.parse(fs.readFileSync('src/data/kh2959_nhom1.json', 'utf8')));
  const ggsSnapshot = JSON.parse(fs.readFileSync('src/data/ggs_snapshot.json', 'utf8'));
  const ggsParcels = ggsSnapshot?.parcels || {};

  const declRes = await fetchJSON('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/declarations/all.json');
  const declarationsMap = declRes?.declarationsMap || {};

  // 2. Lấy danh sách file CCCD và file scan trên R2
  console.log('2. Đang quét danh sách file CCCD và hồ sơ scan trên Cloudflare R2...');
  const [cccdObjs, fileScanObjs] = await Promise.all([
    listAllR2Objects('cccd/'),
    listAllR2Objects('filescan/'),
  ]);

  const r2CccdByNumber = new Map();
  const r2CccdByName = new Map();
  for (const obj of cccdObjs) {
    const filename = obj.Key.replace(/^cccd\//, '');
    const base = filename.replace(/\.(pdf|jpg|png)$/i, '');
    const m = base.match(/^(\d{9,12})(?:_(.*))?$/);
    let cccdNum = '';
    let rawName = '';
    if (m) {
      cccdNum = m[1];
      rawName = m[2] ? m[2].replace(/[_-]+/g, ' ').trim() : '';
    } else {
      const m2 = base.match(/\b\d{9,12}\b/);
      if (m2) {
        cccdNum = m2[0];
        rawName = base.replace(cccdNum, '').replace(/[_-]+/g, ' ').trim();
      } else {
        rawName = base.replace(/[_-]+/g, ' ').trim();
      }
    }
    if (cccdNum) r2CccdByNumber.set(cccdNum, filename);
    const norm = stripHonorifics(normalizeName(rawName));
    if (norm && norm.length >= 3) {
      if (!r2CccdByName.has(norm)) r2CccdByName.set(norm, []);
      r2CccdByName.get(norm).push({ filename, cccd: cccdNum });
    }
  }

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

  // 3. Lọc danh sách thửa đất Thôn Ea Rớt
  console.log('3. Đang lọc và hợp nhất thông tin các thửa đất Thôn Ea Rớt...');
  const eaRotTos = new Set(['42', '43', '45', '46', '47', '50']);
  const eaRotParcels = allParcels.filter(p => {
    const to = String(p.to_ban_do || '');
    return eaRotTos.has(to) || /ea r[oớ]t/i.test(p.thon_xa || '');
  });

  // Sắp xếp theo Tờ bản đồ và Số thửa tăng dần
  eaRotParcels.sort((a, b) => {
    const toA = parseInt(a.to_ban_do, 10) || 0;
    const toB = parseInt(b.to_ban_do, 10) || 0;
    if (toA !== toB) return toA - toB;
    const thuaA = parseInt(a.so_thua, 10) || 0;
    const thuaB = parseInt(b.so_thua, 10) || 0;
    return thuaA - thuaB;
  });

  console.log(`-> Tổng số thửa Thôn Ea Rớt: ${eaRotParcels.length} thửa`);

  // 4. Xây dựng danh sách bản ghi đầy đủ thông tin
  const allRows = [];
  const chuaLamRows = [];
  const daKeKhaiRows = [];
  const daSoHoaRows = [];

  const stats = {
    total: eaRotParcels.length,
    daSoHoa: 0,
    daKeKhaiCoCccd: 0,
    dangKeKhaiChuaCccd: 0,
    chuaLam: 0,
    byTo: {},
    byLoaiDat: {},
  };

  eaRotParcels.forEach((p, idx) => {
    const maThua = p.ma_thua;
    const to = String(p.to_ban_do || '');
    const thua = String(p.so_thua || '');
    const decl = declarationsMap[maThua];
    const ggs = ggsParcels[maThua];

    // Xác định chủ hộ
    let chuHo = '';
    if (decl && (decl.chu_dat_ten || decl.chu_ho || decl.ho_va_ten_chu_ho)) {
      chuHo = decl.chu_dat_ten || decl.chu_ho || decl.ho_va_ten_chu_ho;
    } else if (ggs && ggs.chu_ho) {
      chuHo = ggs.chu_ho;
    } else {
      chuHo = p.chu_ho || '';
    }

    // Xác định CCCD
    let cccd = '';
    if (decl && (decl.chu_dat_cccd || decl.cccd || decl.cccd_chu_ho)) {
      cccd = cleanCccd(decl.chu_dat_cccd || decl.cccd || decl.cccd_chu_ho);
    } else if (ggs && ggs.cccd) {
      cccd = cleanCccd(ggs.cccd);
    } else if (p.cccd) {
      cccd = cleanCccd(p.cccd);
    }

    // Năm sinh & Giới tính & Địa chỉ
    const namSinh = (decl && decl.chu_dat_nam_sinh) || (ggs && ggs.nam_sinh) || '';
    const gioiTinh = (decl && decl.chu_dat_gioi_tinh) || (ggs && ggs.gioi_tinh) || '';
    const diaChi = (decl && (decl.chu_dat_dia_chi || decl.dia_chi_thua_dat)) || (ggs && ggs.thon_xa) || p.thon_xa || 'Thôn Ea Rớt, xã Cư Pui';

    // Nguồn gốc sử dụng
    let nguonGoc = '';
    if (decl && (decl.nguon_goc || decl.nguon_goc_su_dung)) {
      nguonGoc = decl.nguon_goc || decl.nguon_goc_su_dung;
    } else if (ggs && ggs.loai_dat && !['ONT','CLN','BHK','HNK','RSX','BCS'].includes(ggs.loai_dat.toUpperCase())) {
      nguonGoc = ggs.loai_dat;
    } else {
      nguonGoc = 'Khai hoang';
    }

    // Diện tích & Loại đất
    const dienTich = String((decl && decl.dien_tich) || (ggs && ggs.dien_tich) || p.dien_tich || '').replace('.', ',');
    const loaiDat = String((decl && decl.loai_dat) || p.loai_dat || (ggs && ggs.loai_dat) || '').toUpperCase();

    // File CCCD trên R2
    let fileCccd = '';
    let cccdFromR2 = '';
    if (cccd && r2CccdByNumber.has(cccd)) {
      fileCccd = r2CccdByNumber.get(cccd);
      cccdFromR2 = cccd;
    } else if (decl && decl.file_cccd_pdf) {
      fileCccd = decl.file_cccd_pdf;
    } else {
      const norm = stripHonorifics(normalizeName(chuHo));
      if (norm && r2CccdByName.has(norm)) {
        const match = r2CccdByName.get(norm)[0];
        fileCccd = match.filename;
        if (!cccd && match.cccd) {
          cccd = match.cccd;
          cccdFromR2 = match.cccd;
        }
      }
    }

    // File Scan trên R2
    const fileScan = r2ScanByToThua.get(`${to}_${thua}`) || '';

    // Trạng thái hồ sơ
    let trangThai = '';
    const isDig = digitizedParcels.has(maThua);
    const isNhom1 = kh2959Nhom1.has(maThua);

    if (isDig) {
      trangThai = 'Đã số hóa (màu xanh)';
      stats.daSoHoa++;
    } else if (isNhom1) {
      trangThai = 'Nhóm 1 KH2959 (đã có từ trước)';
    } else if (decl) {
      if (cccd) {
        trangThai = 'Sẵn sàng đóng tập (Có CCCD)';
        stats.daKeKhaiCoCccd++;
      } else {
        trangThai = 'Đang kê khai (Chưa có CCCD)';
        stats.dangKeKhaiChuaCccd++;
      }
    } else {
      trangThai = 'Chưa làm (Chưa kê khai)';
      stats.chuaLam++;
    }

    // Thống kê
    stats.byTo[to] = (stats.byTo[to] || 0) + 1;
    stats.byLoaiDat[loaiDat] = (stats.byLoaiDat[loaiDat] || 0) + 1;

    // Tọa độ & Google Maps
    const lat = p.lat || '';
    const lng = p.lng || '';
    const gmapLink = p.gmap_link || (lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : '');

    const row = {
      'STT': idx + 1,
      'Mã thửa': maThua,
      'Tờ bản đồ': to,
      'Số thửa': thua,
      'Thôn / Buôn': 'Thôn Ea Rớt, xã Cư Pui',
      'Họ và tên chủ đất / Chủ hộ': chuHo,
      'Số CCCD': cccd ? `'${cccd}` : '',
      'Năm sinh': namSinh,
      'Giới tính': gioiTinh,
      'Địa chỉ thường trú': diaChi,
      'Diện tích (m²)': dienTich,
      'Loại đất': loaiDat,
      'Nguồn gốc sử dụng': nguonGoc,
      'Trạng thái hồ sơ': trangThai,
      'File CCCD (R2)': fileCccd,
      'File Scan hồ sơ': fileScan,
      'Tọa độ Lat': lat,
      'Tọa độ Lng': lng,
      'Link Google Maps': gmapLink,
      'Ghi chú': cccdFromR2 ? `CCCD tìm thấy từ file R2: ${cccdFromR2}` : (ggs ? 'Có thông tin trên Google Sheet' : '')
    };

    allRows.push(row);

    if (isDig) {
      daSoHoaRows.push(row);
    } else if (decl) {
      daKeKhaiRows.push(row);
    } else {
      chuaLamRows.push(row);
    }
  });

  // Đánh lại STT cho từng nhóm
  chuaLamRows.forEach((r, i) => r['STT'] = i + 1);
  daSoHoaRows.forEach((r, i) => r['STT'] = i + 1);
  daKeKhaiRows.forEach((r, i) => r['STT'] = i + 1);

  // 5. Tạo các sheet trong Workbook
  console.log('4. Đang tạo các Sheet và bảng tính Excel...');
  const wb = XLSX.utils.book_new();

  // Sheet 1: Toàn bộ thửa đất Thôn Ea Rớt
  const wsAll = XLSX.utils.json_to_sheet(allRows);
  XLSX.utils.book_append_sheet(wb, wsAll, 'TẤT CẢ EA RỚT (208)');

  // Sheet 2: Chưa làm
  const wsChuaLam = XLSX.utils.json_to_sheet(chuaLamRows);
  XLSX.utils.book_append_sheet(wb, wsChuaLam, `CHƯA LÀM (${chuaLamRows.length})`);

  // Sheet 3: Đã số hóa
  const wsDaSoHoa = XLSX.utils.json_to_sheet(daSoHoaRows);
  XLSX.utils.book_append_sheet(wb, wsDaSoHoa, `ĐÃ SỐ HÓA (${daSoHoaRows.length})`);

  // Sheet 4: Đã kê khai
  const wsDaKeKhai = XLSX.utils.json_to_sheet(daKeKhaiRows);
  XLSX.utils.book_append_sheet(wb, wsDaKeKhai, `ĐÃ KÊ KHAI (${daKeKhaiRows.length})`);

  // Sheet 5: Bảng thống kê tổng hợp
  const summaryRows = [
    { 'Chỉ tiêu': 'TỔNG SỐ THỬA ĐẤT THÔN EA RỚT', 'Số lượng (thửa)': stats.total, 'Ghi chú': 'Gồm các tờ bản đồ: 42, 43, 45, 46, 47, 50' },
    { 'Chỉ tiêu': '- Chưa làm (Chưa kê khai)', 'Số lượng (thửa)': stats.chuaLam, 'Ghi chú': 'Cần tiếp tục thu thập hồ sơ và CCCD' },
    { 'Chỉ tiêu': '- Đã số hóa (màu xanh)', 'Số lượng (thửa)': stats.daSoHoa, 'Ghi chú': 'Đã có Giấy chứng nhận quyền sử dụng đất' },
    { 'Chỉ tiêu': '- Sẵn sàng đóng tập (Có đủ CCCD)', 'Số lượng (thửa)': stats.daKeKhaiCoCccd, 'Ghi chú': 'Đã hoàn thiện hồ sơ trên web' },
    { 'Chỉ tiêu': '- Đang kê khai (Chưa có CCCD)', 'Số lượng (thửa)': stats.dangKeKhaiChuaCccd, 'Ghi chú': 'Cần thu thập bổ sung CCCD' },
    { 'Chỉ tiêu': '', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    { 'Chỉ tiêu': '--- PHÂN BỐ THEO TỜ BẢN ĐỒ ---', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    ...Object.entries(stats.byTo).map(([to, count]) => ({
      'Chỉ tiêu': `Tờ bản đồ ${to}`,
      'Số lượng (thửa)': count,
      'Ghi chú': `Thôn Ea Rớt`
    })),
    { 'Chỉ tiêu': '', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    { 'Chỉ tiêu': '--- PHÂN BỐ THEO LOẠI ĐẤT ---', 'Số lượng (thửa)': '', 'Ghi chú': '' },
    ...Object.entries(stats.byLoaiDat).map(([ld, count]) => ({
      'Chỉ tiêu': `Đất ${ld || 'Chưa xác định'}`,
      'Số lượng (thửa)': count,
      'Ghi chú': ''
    }))
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'THỐNG KÊ TỔNG HỢP');

  // Đặt độ rộng cột tự động cho các sheet
  const colWidths = [
    { wch: 6 },  // STT
    { wch: 12 }, // Mã thửa
    { wch: 10 }, // Tờ bản đồ
    { wch: 10 }, // Số thửa
    { wch: 25 }, // Thôn/Buôn
    { wch: 28 }, // Họ và tên chủ đất
    { wch: 16 }, // Số CCCD
    { wch: 10 }, // Năm sinh
    { wch: 10 }, // Giới tính
    { wch: 26 }, // Địa chỉ
    { wch: 14 }, // Diện tích
    { wch: 10 }, // Loại đất
    { wch: 24 }, // Nguồn gốc
    { wch: 28 }, // Trạng thái
    { wch: 35 }, // File CCCD
    { wch: 32 }, // File Scan
    { wch: 14 }, // Lat
    { wch: 14 }, // Lng
    { wch: 45 }, // Google Maps
    { wch: 35 }, // Ghi chú
  ];

  [wsAll, wsChuaLam, wsDaSoHoa, wsDaKeKhai].forEach(ws => {
    ws['!cols'] = colWidths;
  });
  wsSummary['!cols'] = [{ wch: 35 }, { wch: 18 }, { wch: 45 }];

  // 6. Ghi file Excel ra đĩa
  const exportPath = path.resolve('../DANH_SACH_THUA_DAT_THON_EA_ROT.xlsx');
  XLSX.writeFile(wb, exportPath);
  console.log(`\n🎉 ĐÃ XUẤT THÀNH CÔNG FILE EXCEL TẠI:`);
  console.log(`-> ${exportPath}`);

  // Cũng sao chép 1 bản vào public để tải qua web nếu cần
  const publicPath = path.resolve('public/DANH_SACH_THUA_DAT_THON_EA_ROT.xlsx');
  XLSX.writeFile(wb, publicPath);
  console.log(`-> Bản tải trực tiếp qua web: ${publicPath}\n`);
}

generateExcel().catch(console.error);
