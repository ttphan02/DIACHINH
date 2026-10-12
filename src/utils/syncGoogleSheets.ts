import villageStatsData from '@/data/village_stats.json';
import parcelsData from '@/data/parcels.json';

const GGS_MAIN_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0';

const URL_GGS_WEBHOOK =
  'https://script.google.com/macros/s/AKfycbz_eRd1wHajwLecXAiy8QvhbZebmkgPnPCB4PM8z4tMNjZ16hCO_ZTpW0Q93KnwFZn8/exec';

const R2_PUBLIC_BASE = 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

// Chuẩn hóa CCCD (12 chữ số)
export function cleanCccd(val: any): string {
  if (!val) return '';
  let s = String(val).trim().replace(/\.0$/, '');
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 9 && digits.length <= 12) {
    return digits.padStart(12, '0');
  }
  return digits;
}

// Chuẩn hóa tên (bỏ dấu cách thừa, viết hoa chữ cái đầu)
export function cleanName(name: any): string {
  if (!name) return '';
  return String(name)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Chuẩn hóa địa chỉ thôn/buôn
export function normalizeAddress(addr: string): string {
  if (!addr) return 'xã Cư Pui';
  const a = addr.trim().toLowerCase();
  if (['thôn 1', 'thôn 2', 'cẩm phong'].some((k) => a.includes(k))) return 'Thôn Cẩm Phong, xã Cư Pui';
  if (['thôn 3', 'thôn 4', 'thôn hòa phong', 'thôn hoà phong'].some((k) => a.includes(k))) return 'Thôn Hòa Phong, xã Cư Pui';
  if (['thôn 5', 'thôn 6', 'ba phường', 'ba phường'].some((k) => a.includes(k))) return 'Thôn Ba Phường, xã Cư Pui';
  if (a.includes('ea uôl') || a.includes('ea uol')) return 'Thôn Ea Uôl, xã Cư Pui';
  if (a.includes('noh prông') || a.includes('noh prong')) return 'Thôn Noh Prông, xã Cư Pui';
  if (a.includes('ea khiêm')) return 'Thôn Ea Khiêm, xã Cư Pui';
  if (a.includes('cư tê')) return 'Thôn Cư Tê, xã Cư Pui';
  if (a.includes('cư rang')) return 'Thôn Cư Rang, xã Cư Pui';
  if (a.includes('ea lang')) return 'Thôn Ea Lang, xã Cư Pui';
  if (a.includes('ea bar')) return 'Thôn Ea Bar, xã Cư Pui';
  if (a.includes('rớt') || a.includes('rot')) return 'Thôn Ea Rớt, xã Cư Pui';
  if (['buôn tliêr', 'buôn t liêr', 'tliêr', 'tlier'].some((k) => a.includes(k))) return 'Buôn Tliêr, xã Cư Pui';
  if (a.includes('buôn ngô')) return 'Buôn Ngô, xã Cư Pui';
  if (['cư phiang', 'cư phiăng'].some((k) => a.includes(k))) return 'Buôn Cư Phiang, xã Cư Pui';
  if (a.includes('buôn khanh')) return 'Buôn Khanh, xã Cư Pui';
  if (a.includes('buôn khóa') || a.includes('buôn khoá')) return 'Buôn Khóa, xã Cư Pui';
  if (a.includes('đắk tuôr') || a.includes('đăk tuôr')) return 'Buôn Đắk Tuôr, xã Cư Pui';
  if (a.includes('buôn bhung')) return 'Buôn Bhung, xã Cư Pui';
  if (a.includes('buôn blăk')) return 'Buôn Blăk, xã Cư Pui';
  if (a.includes('hòa phong') || a.includes('hoà phong') || a.includes('cư pui')) return 'xã Cư Pui';
  return addr.trim();
}

function parseNameAndType(rawName: string) {
  let name = String(rawName || '').trim();
  let isHo = false;
  if (/^(hộ ông\s*:?|hộ bà\s*:?|hộ\s+)/i.test(name)) {
    isHo = true;
    name = name.replace(/^(hộ ông\s*:?|hộ bà\s*:?|hộ\s+)/i, '').trim();
  } else if (/^(ông\s*:?|bà\s*:?)/i.test(name)) {
    name = name.replace(/^(ông\s*:?|bà\s*:?)/i, '').trim();
  }
  const clean = cleanName(name);
  const subjType = isHo ? 'Hộ gia đình' : 'Cá nhân';
  return { cleanName: clean, subjType };
}

function build57ColRow(
  toMoi: any,
  thuaMoi: any,
  addrRaw: string,
  nameRaw: string,
  dobRaw: string,
  genderRaw: string,
  cccdRaw: string,
  loaiDat: string,
  dtRaw: any,
  originRaw: string,
  attachedFile?: string
): string[] {
  const addrNorm = normalizeAddress(addrRaw);
  const { cleanName: cName, subjType } = parseNameAndType(nameRaw);
  const dob = String(dobRaw || '').trim();
  const gender = String(genderRaw || '').toLowerCase().includes('nam') ? 'Nam' : 'Nữ';
  const cccd = cleanCccd(cccdRaw);
  const area = String(dtRaw || '').trim().replace('.', ',');
  const origin = String(originRaw || '').trim() || 'Khai hoang';
  const maGcn = `CHUACOGIAY_24478_${toMoi}_${thuaMoi}`;
  const fileName = attachedFile || `CHUACOGIAY_24478_${toMoi}_${thuaMoi}_DDK.pdf`;

  const row = new Array(57).fill('');
  row[0] = '24478';
  row[1] = maGcn;
  row[6] = cName;
  row[7] = dob;
  row[8] = gender;
  row[9] = cccd;
  row[10] = addrNorm;
  row[11] = subjType;
  row[12] = subjType;
  row[20] = String(toMoi);
  row[21] = String(thuaMoi);
  row[22] = addrNorm;
  row[24] = area;
  row[25] = area;
  row[27] = loaiDat || 'DGT';
  row[28] = area;
  row[30] = 'Sử dụng riêng';
  row[31] = 'Lâu dài';
  row[32] = 'Nhà nước công nhận QSDĐ như giao đất không thu tiền sử dụng đất';
  row[33] = origin;
  row[40] = 'Đủ điều kiện cấp GCN';
  row[41] = '0';
  row[42] = 'Không';
  row[51] = fileName;
  return row;
}

// Tải và lập chỉ mục Google Sheet chính
async function fetchGgsIndex(): Promise<{
  ggsCodes: Set<string>;
  nameToCccd: Map<string, string>;
  cccdToName: Map<string, string>;
}> {
  const ggsCodes = new Set<string>();
  const nameToCccd = new Map<string, string>();
  const cccdToName = new Map<string, string>();

  try {
    const res = await fetch(GGS_MAIN_CSV_URL, { next: { revalidate: 300 } });
    if (!res.ok) return { ggsCodes, nameToCccd, cccdToName };
    const text = await res.text();
    const lines = text.split('\n');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // Trích xuất tối đa 25 cột
      const parts = line.split(',');
      if (parts.length < 9) continue;

      const toMoi = parts[7]?.replace(/["\r]/g, '').trim();
      const thuaMoi = parts[8]?.replace(/["\r]/g, '').trim();
      if (toMoi && thuaMoi) {
        ggsCodes.add(`${toMoi}_${thuaMoi}`);
      }

      const nameClean = cleanName(parts[2]?.replace(/["\r]/g, ''));
      const cccdClean = cleanCccd(parts[5]?.replace(/["\r]/g, ''));
      if (nameClean && cccdClean) {
        if (!nameToCccd.has(nameClean)) nameToCccd.set(nameClean, cccdClean);
        if (!cccdToName.has(cccdClean)) cccdToName.set(cccdClean, nameClean);
      }
    }
  } catch (e) {
    console.warn('Lỗi khi fetch GGS CSV:', e);
  }

  return { ggsCodes, nameToCccd, cccdToName };
}

// Lấy danh sách file CCCD và SCAN từ R2
async function getR2FileLists(r2Bucket?: any): Promise<{
  cccdFiles: Set<string>;
  scanFiles: Set<string>;
}> {
  const cccdFiles = new Set<string>();
  const scanFiles = new Set<string>();

  if (r2Bucket) {
    try {
      let cursor: string | undefined = undefined;
      do {
        const listRes: any = await r2Bucket.list({ prefix: 'cccd/', cursor });
        for (const obj of listRes.objects || []) {
          const name = obj.key.replace(/^cccd\//, '');
          if (name) cccdFiles.add(name);
        }
        cursor = listRes.truncated ? listRes.cursor : undefined;
      } while (cursor);

      cursor = undefined;
      do {
        const listRes: any = await r2Bucket.list({ prefix: 'scanhoso/', cursor });
        for (const obj of listRes.objects || []) {
          const name = obj.key.replace(/^scanhoso\//, '');
          if (name) scanFiles.add(name);
        }
        cursor = listRes.truncated ? listRes.cursor : undefined;
      } while (cursor);
    } catch (e) {
      console.warn('Lỗi khi list R2 files:', e);
    }
  }

  return { cccdFiles, scanFiles };
}

// Hàm chính đồng bộ toàn bộ bảng tính
export async function executeSyncToGoogleSheet(
  declarationsMap: Record<string, any>,
  r2Bucket?: any
): Promise<{ success: boolean; message: string }> {
  try {
    console.log('>>> Bắt đầu tiến trình Cloudflare Sync sang Google Sheet...');

    // 1. Lấy chỉ mục GGS & Danh sách file R2
    const [{ ggsCodes, nameToCccd, cccdToName }, { cccdFiles, scanFiles }] = await Promise.all([
      fetchGgsIndex(),
      getR2FileLists(r2Bucket),
    ]);

    // 2. Lập bản đồ tra cứu thửa từ 11.280 thửa gốc
    const parcelIndex = new Map<string, any>();
    for (const p of parcelsData as any[]) {
      parcelIndex.set(p.ma_thua, p);
    }

    // 3. Phân loại 4 giai đoạn
    const stage4DaGiaiQuyet: any[] = [];
    const stage3NhapGgs: any[] = [];
    const stage2DaDongTap: any[] = [];
    const stage1CanTimCccd: any[] = [];
    const stage1KhongCoCccd: any[] = [];

    const processedParcels = new Set<string>();

    for (const [maThua, decl] of Object.entries(declarationsMap)) {
      if (!maThua || processedParcels.has(maThua)) continue;
      processedParcels.add(maThua);

      const toMoi = decl.to_ban_do || maThua.split('_')[0] || '';
      const thuaMoi = decl.so_thua || maThua.split('_')[1] || '';
      const baseP = parcelIndex.get(maThua) || {};

      const chuHo = cleanName(decl.ho_va_ten_chu_ho || decl.chu_ho || baseP.chu_ho || '');
      let cccd = cleanCccd(decl.cccd_chu_ho || decl.cccd || baseP.cccd || '');
      let cccdSource = cccd ? 'Kê khai web' : '';

      if (!cccd && chuHo && nameToCccd.has(chuHo)) {
        cccd = nameToCccd.get(chuHo)!;
        cccdSource = 'Khớp tên GGS';
      }

      const thonXa = normalizeAddress(decl.dia_chi_thua_dat || decl.thon_xa || baseP.thon_xa || '');
      const dienTich = decl.dien_tich || baseP.dien_tich || '';
      const loaiDat = decl.loai_dat || baseP.loai_dat || '';

      const item = {
        ma_thua: maThua,
        to_ban_do: toMoi,
        so_thua: thuaMoi,
        thon_xa: thonXa,
        chu_ho: chuHo,
        cccd,
        cccd_source: cccdSource,
        dien_tich: dienTich,
        loai_dat: loaiDat,
        dob: decl.nam_sinh_chu_ho || '',
        gender: decl.gioi_tinh_chu_ho || '',
        nguon_goc: decl.nguon_goc_su_dung || '',
        scan_file: '',
        cccd_file: '',
      };

      // GIAI ĐOẠN 4: ĐÃ LÊN GGS CHÍNH
      if (ggsCodes.has(maThua)) {
        stage4DaGiaiQuyet.push(item);
        continue;
      }

      // GIAI ĐOẠN 3: ĐÃ SCAN HỒ SƠ
      let foundScan = '';
      for (const sf of scanFiles) {
        if (sf.includes(`${toMoi}_${thuaMoi}`)) {
          foundScan = sf;
          break;
        }
      }
      if (foundScan) {
        item.scan_file = foundScan;
        stage3NhapGgs.push(item);
        continue;
      }

      // GIAI ĐOẠN 2: CÓ CCCD TRÊN R2
      let foundCccd = '';
      if (cccd) {
        const expectedPdf = `${cccd}.pdf`;
        if (cccdFiles.has(expectedPdf)) {
          foundCccd = expectedPdf;
        }
      }
      if (!foundCccd) {
        // Tìm xem có file ảnh hoặc PDF theo mã thửa
        for (const cf of cccdFiles) {
          if (cf.startsWith(`${maThua}.`) || (cccd && cf.startsWith(`${cccd}.`))) {
            foundCccd = cf;
            break;
          }
        }
      }

      if (foundCccd) {
        item.cccd_file = foundCccd;
        stage2DaDongTap.push(item);
        continue;
      }

      // GIAI ĐOẠN 1: ĐANG KÊ KHAI (THIẾU CCCD)
      if (cccd) {
        stage1CanTimCccd.push({
          ...item,
          phan_loai: 'CẦN TÌM CCCD',
          ghi_chu: `Đã có số CCCD (${cccdSource}) - Cần tìm file scan/ảnh tải lên R2`,
        });
      } else {
        stage1KhongCoCccd.push({
          ...item,
          phan_loai: 'KHÔNG CÓ CCCD',
          ghi_chu: 'Chưa có thông tin số CCCD lẫn file CCCD',
        });
      }
    }

    // 4. Xây dựng cấu trúc các Sheet để gửi lên Webhook
    const sheetsData: Record<string, string[][]> = {};

    // SHEET 4: THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)
    const headersPack = [
      'STT', 'Mã thửa', 'Tờ BĐ', 'Số thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
      'Số CCCD', 'Nguồn CCCD', 'Diện tích (m²)', 'Loại đất', 'Xem file PDF CCCD (Bấm vào xem)', 'Trạng thái đóng tập'
    ];
    const rowsPack: string[][] = [headersPack];
    stage2DaDongTap.forEach((it, idx) => {
      const cccdLink = `${R2_PUBLIC_BASE}/cccd/${it.cccd_file}`;
      const cccdFormula = `=HYPERLINK("${cccdLink}"; "${it.cccd_file}")`;
      rowsPack.push([
        String(idx + 1), it.ma_thua, it.to_ban_do, it.so_thua, it.thon_xa,
        it.chu_ho, it.cccd, it.cccd_source, String(it.dien_tich), it.loai_dat,
        cccdFormula, 'ĐỦ HỒ SƠ - SẴN SÀNG ĐÓNG TẬP'
      ]);
    });
    sheetsData['THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'] = rowsPack;

    // SHEET 5: THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)
    const headersUnpack = [
      'STT', 'Mã thửa', 'Tờ BĐ', 'Số thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
      'Số CCCD', 'Nguồn CCCD', 'Diện tích (m²)', 'Loại đất', 'Phân loại trạng thái', 'Ghi chú & Hướng dẫn xử lý'
    ];
    const rowsUnpack: string[][] = [headersUnpack];
    const orderedStage1 = [...stage1CanTimCccd, ...stage1KhongCoCccd];
    orderedStage1.forEach((it, idx) => {
      rowsUnpack.push([
        String(idx + 1), it.ma_thua, it.to_ban_do, it.so_thua, it.thon_xa,
        it.chu_ho, it.cccd || 'Chưa có', it.cccd_source, String(it.dien_tich), it.loai_dat,
        it.phan_loai, it.ghi_chu
      ]);
    });
    sheetsData['THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)'] = rowsUnpack;

    // SHEET 2: ĐÃ GIẢI QUYẾT
    const headersDone = [
      'STT', 'Mã thửa', 'Tờ BĐ', 'Số thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
      'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Trạng thái xử lý', 'Ghi chú'
    ];
    const rowsDone: string[][] = [headersDone];
    stage4DaGiaiQuyet.forEach((it, idx) => {
      rowsDone.push([
        String(idx + 1), it.ma_thua, it.to_ban_do, it.so_thua, it.thon_xa,
        it.chu_ho, it.cccd, String(it.dien_tich), it.loai_dat,
        'ĐÃ GIẢI QUYẾT (ĐÃ LÊN GGS CHÍNH)', 'Đã hoàn tất toàn bộ quy trình'
      ]);
    });
    sheetsData['ĐÃ GIẢI QUYẾT'] = rowsDone;

    // SHEET 3: NHẬP GGS (57 cột)
    const headers57 = [
      'Mã Xã', 'Mã GCN', 'Loại ĐT', 'Tên Vợ/Chồng', 'Năm Sinh VC', 'CCCD VC',
      'Họ và Tên Chủ', 'Năm Sinh', 'Giới Tính', 'Số CCCD', 'Địa Chỉ Chủ',
      'Loại Chủ', 'Hình Thức', 'Mã Giấy', 'Số Seri', 'Số Vào Sổ', 'Ngày Cấp',
      'Người Ký', 'Cơ Quan Ký', 'Tờ Cũ', 'Tờ Mới', 'Thửa Mới', 'Địa Chỉ Thửa',
      'Thửa Cũ', 'Diện Tích', 'DT Phù Hợp', 'DT Không Phù Hợp', 'Mục Đích SD',
      'DT Mục Đích', 'Thời Hạn', 'Nguồn Gốc', 'Hạn Mức', 'Hình Thức SD',
      'Nguồn Gốc SD', 'Ghi Chú', 'Sơ Đồ', 'Tọa Độ', 'Chiều Dài', 'Giáp Ranh',
      'Hiện Trạng', 'Kết Quả', 'Số Tiền', 'Nợ Nghĩa Vụ', 'Lý Do Nợ',
      'Số Quyết Định', 'Ngày QĐ', 'Cơ Quan QĐ', 'Nội Dung QĐ', 'Loại Biến Động',
      'Ngày Biến Động', 'Nội Dung BĐ', 'Tên File Đính Kèm', 'Đường Dẫn',
      'Mã Vạch', 'Loại Đất Khác', 'Ghi Chú Khác', 'Trạng Thái'
    ];
    const rows57: string[][] = [headers57];
    stage3NhapGgs.forEach((it) => {
      const r = build57ColRow(
        it.to_ban_do, it.so_thua, it.thon_xa, it.chu_ho, it.dob,
        it.gender, it.cccd, it.loai_dat, it.dien_tich, it.nguon_goc, it.scan_file
      );
      rows57.push(r);
    });
    sheetsData['NHẬP GGS'] = rows57;

    // SHEET 1: THỐNG KÊ (Bảng chỉ số tổng quan & Bảng 16 thôn buôn)
    const totalDeclared = processedParcels.size;
    const rowsTk: string[][] = [
      ['BÁO CÁO THỐNG KÊ TIẾN ĐỘ THỦ CÔNG & REALTIME ĐỊA CHÍNH XÃ CƯ PUI'],
      ['Hệ thống tự động đồng bộ trực tiếp từ Cloudflare R2 & Google Sheets Cloud'],
      [],
      ['CHỈ SỐ TIẾN ĐỘ TỔNG THỂ', '', 'SỐ LƯỢNG', 'TỶ LỆ % / GHI CHÚ'],
      ['TỔNG SỐ PHIẾU KÊ KHAI ĐÃ NỘP TRÊN HỆ THỐNG', '', String(totalDeclared), '100%'],
      ['  • GIAI ĐOẠN 4: ĐÃ GIẢI QUYẾT (ĐÃ LÊN GGS CHÍNH)', '', String(stage4DaGiaiQuyet.length), `${((stage4DaGiaiQuyet.length / (totalDeclared || 1)) * 100).toFixed(1)}%`],
      ['  • GIAI ĐOẠN 3: ĐÃ SCAN HỒ SƠ (CHỜ NHẬP GGS)', '', String(stage3NhapGgs.length), `${((stage3NhapGgs.length / (totalDeclared || 1)) * 100).toFixed(1)}%`],
      ['  • GIAI ĐOẠN 2: ĐÃ ĐÓNG TẬP (ĐÃ CÓ FILE PDF CCCD R2)', '', String(stage2DaDongTap.length), `${((stage2DaDongTap.length / (totalDeclared || 1)) * 100).toFixed(1)}%`],
      ['  • GIAI ĐOẠN 1: ĐANG KÊ KHAI (ĐANG THIẾU FILE CCCD R2)', '', String(orderedStage1.length), `${((orderedStage1.length / (totalDeclared || 1)) * 100).toFixed(1)}%`],
      ['      - Nhóm 1: CẦN TÌM CCCD (Có trên GGS nhưng thiếu PDF)', '', String(stage1CanTimCccd.length), `${stage1CanTimCccd.length} hồ sơ`],
      ['      - Nhóm 2: KHÔNG CÓ CCCD (Chưa có trên GGS lẫn R2)', '', String(stage1KhongCoCccd.length), `${stage1KhongCoCccd.length} hồ sơ`],
      [],
      [],
      [],
      [],
      [],
      [],
      ['BẢNG TIẾN ĐỘ CHI TIẾT THEO 16 THÔN / BUÔN & CÁC GIAI ĐOẠN'],
      [
        'STT', 'Tên thôn / buôn', 'Tổng (Có tên)', 'Đã có GGS', 'Tỷ lệ (%)',
        'Tổng (Không tên)', 'Đã có GGS', 'Tỷ lệ (%)', 'Kê khai Web',
        'GĐ 4: Đã giải quyết', 'GĐ 3: Đã scan', 'GĐ 2: Có CCCD đóng tập', 'GĐ 1: Cần tìm CCCD', 'GĐ 1: Không có CCCD'
      ]
    ];

    const villageStats = villageStatsData as any;
    const cotenByThon = villageStats.coten || {};
    const khongtenByThon = villageStats.khongten || {};
    const allThons = Object.keys(cotenByThon);
    for (const t of Object.keys(khongtenByThon)) {
      if (!allThons.includes(t) && t !== 'chưa sát định') allThons.push(t);
    }
    allThons.push('chưa sát định');

    let sumCtTot = 0, sumCtDa = 0, sumKtTot = 0, sumKtDa = 0;
    let sumDecl = 0, sumS4 = 0, sumS3 = 0, sumS2 = 0, sumS1Can = 0, sumS1Khong = 0;

    allThons.forEach((thon, idx) => {
      const ct = cotenByThon[thon] || { total: 0, daco: 0, rate: '0.0%' };
      const kt = khongtenByThon[thon] || { total: 0, daco: 0, rate: '0.0%' };
      const tKey = thon.toLowerCase().replace('thôn ', '').replace('buôn ', '');

      const matchesThon = (it: any) => normalizeAddress(it.thon_xa || '').toLowerCase().includes(tKey);

      const nDecl = Object.values(declarationsMap).filter((d: any) =>
        normalizeAddress(d.dia_chi_thua_dat || '').toLowerCase().includes(tKey)
      ).length;
      const nS4 = stage4DaGiaiQuyet.filter(matchesThon).length;
      const nS3 = stage3NhapGgs.filter(matchesThon).length;
      const nS2 = stage2DaDongTap.filter(matchesThon).length;
      const nS1Can = stage1CanTimCccd.filter(matchesThon).length;
      const nS1Khong = stage1KhongCoCccd.filter(matchesThon).length;

      const ctRate = ct.total ? `${((ct.daco / ct.total) * 100).toFixed(1)}%` : '0.0%';
      const ktRate = kt.total ? `${((kt.daco / kt.total) * 100).toFixed(1)}%` : '0.0%';

      rowsTk.push([
        String(idx + 1), thon, String(ct.total), String(ct.daco), ctRate,
        String(kt.total), String(kt.daco), ktRate, String(nDecl),
        String(nS4), String(nS3), String(nS2), String(nS1Can), String(nS1Khong)
      ]);

      sumCtTot += ct.total;
      sumCtDa += ct.daco;
      sumKtTot += kt.total;
      sumKtDa += kt.daco;
      sumDecl += nDecl;
      sumS4 += nS4;
      sumS3 += nS3;
      sumS2 += nS2;
      sumS1Can += nS1Can;
      sumS1Khong += nS1Khong;
    });

    const ctTotRate = sumCtTot ? `${((sumCtDa / sumCtTot) * 100).toFixed(1)}%` : '0.0%';
    const ktTotRate = sumKtTot ? `${((sumKtDa / sumKtTot) * 100).toFixed(1)}%` : '0.0%';
    rowsTk.push([
      'TỔNG', 'TOÀN XÃ CƯ PUI', String(sumCtTot), String(sumCtDa), ctTotRate,
      String(sumKtTot), String(sumKtDa), ktTotRate, String(sumDecl),
      String(sumS4), String(sumS3), String(sumS2), String(sumS1Can), String(sumS1Khong)
    ]);

    sheetsData['THỐNG KÊ'] = rowsTk;

    // 5. Gửi lên Google Apps Script Webhook
    const payloadStr = JSON.stringify(sheetsData);
    console.log(`>>> Gửi payload (${payloadStr.length} bytes) lên Google Sheet Webhook...`);

    const resp = await fetch(URL_GGS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payloadStr,
    });

    const respText = await resp.text();
    console.log('>>> Phản hồi từ Google Sheet Webhook:', respText);

    return { success: true, message: respText };
  } catch (error: any) {
    console.error('Lỗi khi thực hiện executeSyncToGoogleSheet:', error);
    return { success: false, message: error.message || 'Lỗi đồng bộ' };
  }
}
