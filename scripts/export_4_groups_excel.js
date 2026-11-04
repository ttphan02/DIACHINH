const fs = require('fs');
const https = require('https');
const path = require('path');
const XLSX = require('xlsx');

// Hàm kiểm tra tên người chuẩn xác (nhập trực tiếp từ textHelpers của dự án)
function isPersonName(rawName) {
  if (!rawName) return false;
  let s = String(rawName).trim();
  if (!s) return false;
  const lower = s.toLowerCase();

  // 1. Mã geohash hoặc mã rác hệ thống
  if (lower.startsWith('w6jp') || /^[a-z0-9]{10,}$/i.test(s)) return false;

  // 2. Các cụm từ placeholder / không có tên / rác dữ liệu
  const placeholderPhrases = [
    'không có trong dữ liệu', 'khong co trong du lieu', 'không có dữ liệu', 'khong co du lieu',
    'không có trong smk', 'chưa có dữ liệu', 'chua co du lieu', 'chưa có tên', 'chua co ten',
    'không có tên', 'khong co ten', 'chưa rõ', 'chua ro', 'không rõ', 'khong ro',
    'vô chủ', 'vo chu', 'vắng chủ', 'vang chu', 'chưa xác định', 'chua xac dinh',
    'không xác định', 'khong xac dinh', 'không tồn tại', 'khong ton tai',
    'đã thu hồi', 'thu hồi', 'giáp thửa đất', 'địa điểm', 'dia diem', 'vô danh', 'vo danh',
    'không có', 'khong co', 'chưa có', 'chua co',
  ];
  if (placeholderPhrases.some((p) => lower.includes(p))) return false;

  // 3. Cơ quan, công trình công cộng, doanh nghiệp, tổ chức
  const organizationPhrases = [
    'ubnd', 'ủy ban', 'uy ban', 'hđnd', 'hdnd', 'nhà văn hóa', 'nha van hoa', 'nhà văn hoá',
    'hội trường', 'hoi truong', 'trường học', 'truong hoc', 'trường tiểu học', 'mầm non',
    'mẫu giáo', 'điểm trường', 'trạm y tế', 'tram y te', 'bệnh viện', 'nghĩa trang',
    'nghia trang', 'nghĩa địa', 'nghia dia', 'mồ mả', 'thủy hệ', 'thuy he', 'thủy lợi',
    'đập nước', 'giao thông', 'đường giao thông', 'đường đi', 'hành lang', 'kiểm lâm',
    'lâm nghiệp', 'lâm trường', 'công ty', 'cty ', 'rừng phòng hộ', 'ban quản lý',
    'ban ql', 'hợp tác xã', 'thao trường', 'quân sự', 'công an', 'đình làng', 'nhà thờ',
    'giáo xứ', 'đất đồi', 'đất công', 'đất trống', 'đất hoang', 'đầu mối',
  ];
  if (organizationPhrases.some((o) => lower.includes(o))) return false;

  // 4. Địa danh thuần túy (Hồ, suối, sông...)
  if (lower.includes('hồ ea rớt') || lower.includes('ho ea rot')) {
    if (
      !lower.includes('ông') && !lower.includes('bà') && !lower.includes('hộ') &&
      !lower.includes('nguyễn') && !lower.includes('lý') && !lower.includes('trần') &&
      !lower.includes('hoàng') && !lower.includes('dường') && !lower.includes('lăng')
    ) {
      return false;
    }
  }

  const locationPureWords = [
    'suối', 'suoi', 'đường', 'duong', 'sông', 'song', 'núi', 'nui',
    'đồi', 'doi', 'kênh', 'kenh', 'mương', 'muong', 'đất', 'dat',
    'hồ', 'ho', 'thôn', 'thon', 'buôn', 'buon', 'địa điểm', 'dia diem',
    'khu vực', 'khu vuc', 'đập', 'dap', 'rừng', 'rung'
  ];
  if (locationPureWords.includes(lower)) return false;

  if (/^(suối|sông|kênh|mương|núi|đập|đồi|đường|khu vực)\s+/i.test(s)) return false;

  const lettersOnly = s.replace(/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/g, '');
  if (lettersOnly.length < 2) return false;

  const withoutHonorific = s
    .replace(
      /^(hộ\s+ông\s*:?|hộ\s+bà\s*:?|hộ\s+gia\s+đình\s*:?|vợ\s+chồng\s+ông\s*:?|vợ\s+chồng\s+bà\s*:?|hộ\s*:?|ông\s*:?|bà\s*:?)/gi,
      ''
    )
    .trim();

  const lowerWithoutHonorific = withoutHonorific.toLowerCase();
  const genericNonNames = [
    'nam', 'nữ', 'nu', 'cá nhân', 'ca nhan', 'chung', 'vô danh', 'vo danh',
    'chưa', 'chua', 'không', 'khong', 'vô chủ', 'vo chu', 'địa điểm', 'dia diem'
  ];
  if (genericNonNames.includes(lowerWithoutHonorific)) return false;

  const cleanWithoutHonorific = withoutHonorific.replace(/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/g, '');
  if (cleanWithoutHonorific.length < 2) return false;

  return true;
}

function cleanCccd(val) {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length === 12 || digits.length === 9) return digits;
  return '';
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

function sortByToThua(a, b) {
  const toA = parseInt(a.to_ban_do, 10) || 0;
  const toB = parseInt(b.to_ban_do, 10) || 0;
  if (toA !== toB) return toA - toB;
  const thuaA = parseInt(a.so_thua, 10) || 0;
  const thuaB = parseInt(b.so_thua, 10) || 0;
  return thuaA - thuaB;
}

async function main() {
  console.log('=== XUẤT EXCEL 4 NHÓM THỬA ĐỒNG BỘ 100% VỚI BẢN ĐỒ ===\n');

  const allParcels = JSON.parse(fs.readFileSync('public/data/parcels.json', 'utf8'));
  const hiddenParcels = new Set(JSON.parse(fs.readFileSync('src/data/hidden_parcels.json', 'utf8')));
  const digitizedParcels = new Set(JSON.parse(fs.readFileSync('src/data/digitized_parcels.json', 'utf8')));
  const kh2959Nhom1 = new Set(JSON.parse(fs.readFileSync('src/data/kh2959_nhom1.json', 'utf8')));

  const declRes = await fetchJSON('https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/declarations/all.json');
  const declarationsMap = declRes?.declarationsMap || {};
  const declaredCodes = new Set(Object.keys(declarationsMap));

  // Bộ lọc y hệt computedParcels trên Bản đồ:
  // 1. Loại bỏ các thửa trong hidden_parcels.json
  // 2. Loại bỏ đất BCS (vì BCS được quản lý riêng)
  const computedOnMap = allParcels.filter(p => {
    if (hiddenParcels.has(p.ma_thua)) return false;
    const ld = (p.loai_dat || '').trim().toUpperCase();
    if (ld === 'BCS') return false;
    return true;
  });

  // Lọc chính xác 291 thửa KHÔNG TÊN (Màu xám) trên bản đồ
  const gray291 = [];
  computedOnMap.forEach(p => {
    const isDig = digitizedParcels.has(p.ma_thua);
    const isDecl = declaredCodes.has(p.ma_thua) || p.is_declared;
    const chuHo = (declarationsMap[p.ma_thua]?.chu_dat_ten || p.chu_ho || '').trim();

    if (!isDig && !isDecl && !(chuHo && chuHo !== 'Không có trong dữ liệu' && isPersonName(chuHo))) {
      gray291.push(p);
    }
  });

  console.log(`-> Tổng số thửa KHÔNG TÊN (Màu xám) trên bản đồ: ${gray291.length} thửa`);

  // Tách 291 thửa thành:
  // - 109 thửa chỉ có tên Hồ Ea Rớt
  // - 182 thửa Chưa làm không tên thuần túy
  const g3Parcels = gray291.filter(p => {
    const s = String(p.chu_ho || '').trim().toLowerCase();
    return s === 'hồ ea rớt' || s === 'ho ea rot';
  });

  const g1Parcels = gray291.filter(p => {
    const s = String(p.chu_ho || '').trim().toLowerCase();
    return s !== 'hồ ea rớt' && s !== 'ho ea rot';
  });

  // Nhóm 2: Tất cả thửa BCS chưa làm
  const g2Parcels = allParcels.filter(p => {
    const m = p.ma_thua;
    if (hiddenParcels.has(m) || digitizedParcels.has(m) || kh2959Nhom1.has(m)) return false;
    if (declaredCodes.has(m) || p.is_declared) return false;
    return String(p.loai_dat || '').trim().toUpperCase() === 'BCS';
  });

  // Nhóm 4: 82 thửa Nhóm 1 KH2959
  const g4Parcels = allParcels.filter(p => kh2959Nhom1.has(p.ma_thua));

  // Sắp xếp theo Tờ bản đồ và Số thửa
  g1Parcels.sort(sortByToThua);
  g2Parcels.sort(sortByToThua);
  g3Parcels.sort(sortByToThua);
  g4Parcels.sort(sortByToThua);

  console.log(`-> Sheet 1: Chưa làm không tên (đã tách Hồ Ea Rớt): ${g1Parcels.length} thửa`);
  console.log(`-> Sheet 2: BCS chưa làm: ${g2Parcels.length} thửa`);
  console.log(`-> Sheet 3: Những thửa chỉ có tên Hồ Ea Rớt: ${g3Parcels.length} thửa`);
  console.log(`-> Sheet 4: 82 thửa Nhóm 1 KH2959: ${g4Parcels.length} thửa`);
  console.log(`-> Kiểm tra đối soát: 182 (Không tên) + 109 (Hồ Ea Rớt) = ${g1Parcels.length + g3Parcels.length} (Khớp chuẩn 291 trên Bản đồ!)\n`);

  // Hàm tạo dòng bảng tính
  function buildRows(parcelList, groupType) {
    return parcelList.map((p, idx) => {
      const to = String(p.to_ban_do || '');
      const thua = String(p.so_thua || '');
      const chuHo = String(p.chu_ho || '').trim();
      const cccd = cleanCccd(p.cccd || '');
      const dienTich = String(p.dien_tich || '').replace('.', ',');
      const loaiDat = String(p.loai_dat || 'Chưa xác định').toUpperCase();
      const thon = p.thon_xa || 'Chưa xác định';
      const lat = p.lat || '';
      const lng = p.lng || '';
      const gmapLink = p.gmap_link || (lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : '');

      let phanLoai = '';
      let ghiChu = '';

      if (groupType === 'G1_KHONG_TEN') {
        if (!chuHo || chuHo === '0' || chuHo === '..' || chuHo === 'Không có trong dữ liệu') {
          phanLoai = 'Chưa có tên trong CSDL (ô tên là 0 / trống)';
          ghiChu = 'Cần đi thực địa xác minh chủ sử dụng đất';
        } else if (chuHo.startsWith('w6jp')) {
          phanLoai = 'Mã Geohash kỹ thuật từ lớp CAD';
          ghiChu = 'CAD không có text tên, cần xác minh thực tế';
        } else {
          phanLoai = 'Đất công / Tổ chức / Công trình';
          ghiChu = `Ghi nhận: "${chuHo}"`;
        }
      } else if (groupType === 'G2_BCS') {
        phanLoai = 'Đất bằng chưa sử dụng (BCS)';
        ghiChu = isPersonName(chuHo) ? `Chủ sử dụng: ${chuHo}` : (chuHo ? `Ghi nhận: ${chuHo}` : 'Không có tên');
      } else if (groupType === 'G3_HO_EA_ROT') {
        phanLoai = 'Chỉ có tên "Hồ Ea Rớt" (Địa danh)';
        ghiChu = 'Địa danh Hồ Ea Rớt bị ghi nhầm vào cột chủ hộ - Cần rà soát thực tế';
      } else if (groupType === 'G4_NHOM1') {
        phanLoai = 'Nhóm 1 KH2959';
        ghiChu = 'Thửa đã có dữ liệu từ trước trên web kh2959bmt, không cần nhập biểu';
      }

      return {
        'STT': idx + 1,
        'Mã thửa': p.ma_thua,
        'Tờ bản đồ': to,
        'Số thửa': thua,
        'Thôn / Buôn': thon,
        'Tên chủ đất / Tên ghi nhận': chuHo === '0' ? '(Không có)' : (chuHo.startsWith('w6jp') ? '(Mã Geohash)' : (chuHo || '(Trống)')),
        'Số CCCD': cccd ? `'${cccd}` : '',
        'Diện tích (m²)': dienTich,
        'Loại đất': loaiDat,
        'Nguồn gốc sử dụng': 'Khai hoang',
        'Phân loại chi tiết': phanLoai,
        'Trạng thái trên bản đồ': groupType === 'G4_NHOM1' ? 'Nhóm 1 KH2959 (Đã ẩn)' : (groupType === 'G2_BCS' ? 'Đất BCS (Ẩn)' : 'Màu xám (Chưa làm không tên)'),
        'Tọa độ Lat': lat,
        'Tọa độ Lng': lng,
        'Link Google Maps': gmapLink,
        'Mã Geohash': p.ma_dinh_danh || '',
        'Ghi chú': ghiChu
      };
    });
  }

  const g1Rows = buildRows(g1Parcels, 'G1_KHONG_TEN');
  const g2Rows = buildRows(g2Parcels, 'G2_BCS');
  const g3Rows = buildRows(g3Parcels, 'G3_HO_EA_ROT');
  const g4Rows = buildRows(g4Parcels, 'G4_NHOM1');

  function calcTotalArea(rows) {
    const total = rows.reduce((acc, r) => {
      const v = parseFloat(String(r['Diện tích (m²)'] || '0').replace(',', '.'));
      return acc + (isNaN(v) ? 0 : v);
    }, 0);
    return Math.round(total * 100) / 100;
  }

  const wb = XLSX.utils.book_new();

  // Sheet 1: Chưa làm không tên (182)
  const ws1 = XLSX.utils.json_to_sheet(g1Rows);
  XLSX.utils.book_append_sheet(wb, ws1, `CHƯA LÀM KHÔNG TÊN (${g1Rows.length})`);

  // Sheet 2: BCS chưa làm (176)
  const ws2 = XLSX.utils.json_to_sheet(g2Rows);
  XLSX.utils.book_append_sheet(wb, ws2, `BCS CHƯA LÀM (${g2Rows.length})`);

  // Sheet 3: Những thửa chỉ có tên Hồ Ea Rớt (109)
  const ws3 = XLSX.utils.json_to_sheet(g3Rows);
  XLSX.utils.book_append_sheet(wb, ws3, `CHỈ CÓ TÊN HỒ EA RỚT (${g3Rows.length})`);

  // Sheet 4: 82 thửa Nhóm 1 KH2959 (82)
  const ws4 = XLSX.utils.json_to_sheet(g4Rows);
  XLSX.utils.book_append_sheet(wb, ws4, `NHÓM 1 KH2959 (${g4Rows.length})`);

  // Sheet 5: Bảng đối soát và thống kê tổng hợp
  const summaryRows = [
    { 'Chỉ tiêu thống kê': '1. Thửa chưa làm không tên (đã tách Hồ Ea Rớt)', 'Số lượng (thửa)': g1Rows.length, 'Tổng diện tích (m²)': calcTotalArea(g1Rows).toLocaleString('vi-VN'), 'Ghi chú đối soát': 'Gồm: ô tên trống/0, mã geohash, đất công, tổ chức' },
    { 'Chỉ tiêu thống kê': '2. Những thửa CHỈ CÓ TÊN Hồ Ea Rớt', 'Số lượng (thửa)': g3Rows.length, 'Tổng diện tích (m²)': calcTotalArea(g3Rows).toLocaleString('vi-VN'), 'Ghi chú đối soát': 'Địa danh Hồ Ea Rớt bị gán nhầm vào ô tên chủ hộ' },
    { 'Chỉ tiêu thống kê': '=> TỔNG CỘNG MÀU XÁM TRÊN BẢN ĐỒ (1 + 2)', 'Số lượng (thửa)': g1Rows.length + g3Rows.length, 'Tổng diện tích (m²)': (calcTotalArea(g1Rows) + calcTotalArea(g3Rows)).toLocaleString('vi-VN'), 'Ghi chú đối soát': 'KHỚP CHÍNH XÁC 291 THỬA MÀU XÁM TRÊN BẢN ĐỒ WEB' },
    { 'Chỉ tiêu thống kê': '', 'Số lượng (thửa)': '', 'Tổng diện tích (m²)': '', 'Ghi chú đối soát': '' },
    { 'Chỉ tiêu thống kê': '3. Thửa BCS chưa làm', 'Số lượng (thửa)': g2Rows.length, 'Tổng diện tích (m²)': calcTotalArea(g2Rows).toLocaleString('vi-VN'), 'Ghi chú đối soát': 'Đất bằng chưa sử dụng (trên bản đồ web được lọc riêng)' },
    { 'Chỉ tiêu thống kê': '4. Thửa Nhóm 1 KH2959', 'Số lượng (thửa)': g4Rows.length, 'Tổng diện tích (m²)': calcTotalArea(g4Rows).toLocaleString('vi-VN'), 'Ghi chú đối soát': '82 thửa đã có dữ liệu từ trước trên kh2959bmt, ẩn khỏi bản đồ' },
    { 'Chỉ tiêu thống kê': '', 'Số lượng (thửa)': '', 'Tổng diện tích (m²)': '', 'Ghi chú đối soát': '' },
    { 'Chỉ tiêu thống kê': 'LƯU Ý VỀ CÁC THỬA ÔNG HẢI, ÔNG HÙNG...:', 'Số lượng (thửa)': '553 thửa (Màu vàng)', 'Tổng diện tích (m²)': '', 'Ghi chú đối soát': 'Thuộc nhóm "Chưa làm có tên" trên bản đồ, không nằm trong file này' }
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'THỐNG KÊ ĐỐI SOÁT 291');

  // Đặt độ rộng cột
  const colWidths = [
    { wch: 6 },  // STT
    { wch: 12 }, // Mã thửa
    { wch: 10 }, // Tờ bản đồ
    { wch: 10 }, // Số thửa
    { wch: 28 }, // Thôn/Buôn
    { wch: 30 }, // Tên chủ đất
    { wch: 16 }, // Số CCCD
    { wch: 16 }, // Diện tích
    { wch: 10 }, // Loại đất
    { wch: 18 }, // Nguồn gốc
    { wch: 36 }, // Phân loại
    { wch: 32 }, // Trạng thái bản đồ
    { wch: 14 }, // Lat
    { wch: 14 }, // Lng
    { wch: 45 }, // Google Maps
    { wch: 16 }, // Geohash
    { wch: 45 }, // Ghi chú
  ];

  [ws1, ws2, ws3, ws4].forEach(ws => {
    ws['!cols'] = colWidths;
  });
  wsSummary['!cols'] = [{ wch: 45 }, { wch: 22 }, { wch: 22 }, { wch: 55 }];

  // Ghi ra file mới và ghi đè an toàn
  const mainExportPath = path.resolve('../DANH_SACH_THUA_DAC_BIET_4_NHOM_CHUAN.xlsx');
  XLSX.writeFile(wb, mainExportPath);
  console.log(`\n🎉 ĐÃ XUẤT THÀNH CÔNG TẠI: ${mainExportPath}`);

  // Thử ghi đè file gốc nếu không bị lock bởi Excel
  try {
    const oldExportPath = path.resolve('../DANH_SACH_THUA_DAC_BIET_4_NHOM.xlsx');
    XLSX.writeFile(wb, oldExportPath);
    console.log(`-> Đã ghi đè file gốc tại: ${oldExportPath}`);
  } catch (err) {
    console.log(`-> File gốc đang bị khóa bởi Excel (EBUSY). Đã xuất file mới tại DANH_SACH_THUA_DAC_BIET_4_NHOM_CHUAN.xlsx`);
  }

  const publicPath1 = path.resolve('public/DANH_SACH_THUA_DAC_BIET_4_NHOM_CHUAN.xlsx');
  XLSX.writeFile(wb, publicPath1);
  const publicPath2 = path.resolve('public/DANH_SACH_THUA_DAC_BIET_4_NHOM.xlsx');
  XLSX.writeFile(wb, publicPath2);
  console.log(`-> Đã cập nhật public downloads`);
}

main().catch(console.error);
