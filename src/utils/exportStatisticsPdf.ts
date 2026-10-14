import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Parcel } from '@/types';
import { CANONICAL_VILLAGES, getCanonicalVillage } from '@/utils/syncGoogleSheets';

export interface VillageStatsItem {
  stt: number;
  name: string;
  tongConLai: number;
  khongTen: number;
  coTen: number;
  daKeKhai: number;
}

export interface OwnerGroupItem {
  stt: number;
  name: string;
  parcelCount: number;
}

export interface VillageDetailGroup {
  villageName: string;
  totalOwners: number;
  totalParcels: number;
  owners: OwnerGroupItem[];
}

async function loadBuffer(urlOrPath: string): Promise<ArrayBuffer> {
  const resp = await fetch(urlOrPath);
  if (!resp.ok) {
    throw new Error(`Không thể tải tài nguyên: ${urlOrPath} (${resp.status})`);
  }
  return await resp.arrayBuffer();
}

function formatPrefixOwner(rawName?: string, gender?: string): string {
  if (!rawName) return 'Chưa có tên';
  let clean = rawName.trim();
  if (/^(ông|bà|hộ ông|hộ bà|hộ)\s*:?/i.test(clean)) {
    return clean;
  }
  const isFemale =
    gender?.toLowerCase() === 'nữ' ||
    clean.startsWith('H ') ||
    clean.startsWith('H’') ||
    clean.startsWith("H'") ||
    clean.startsWith('H`');
  if (isFemale) return `Bà: ${clean}`;
  return `Ông: ${clean}`;
}

export async function generateStatisticsPdf(
  syncSheetsData: Record<string, string[][]> | null,
  computedParcels: Parcel[],
  onProgress?: (msg: string) => void
): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
  onProgress?.('Đang tải font chữ tiếng Việt...');

  const [fontRegularBytes, fontBoldBytes] = await Promise.all([
    loadBuffer('/fonts/times.ttf'),
    loadBuffer('/fonts/timesbd.ttf'),
  ]);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontRegular = await doc.embedFont(fontRegularBytes);
  const fontBold = await doc.embedFont(fontBoldBytes);

  const W = 595.28;
  const H = 841.89;
  const marginX = 36;
  const contentW = W - marginX * 2; // 523.28 pt

  onProgress?.('Đang tính toán số liệu thống kê 16 thôn buôn...');

  // 1. TÍNH TOÁN BẢNG SỐ LIỆU 16 THÔN BUÔN
  const villageStats: VillageStatsItem[] = [];
  let sumTongConLai = 0;
  let sumKhongTen = 0;
  let sumCoTen = 0;
  let sumDaKeKhai = 0;

  // Kiểm tra xem syncSheetsData['THỐNG KÊ'] có sẵn không
  const rawTkRows = syncSheetsData?.['THỐNG KÊ'] || [];
  const headerIdx = rawTkRows.findIndex((r) => Array.isArray(r) && r[0] === 'STT' && r[1] === 'Tên thôn / buôn');
  const tkDataRows = headerIdx >= 0 ? rawTkRows.slice(headerIdx + 1) : [];

  if (tkDataRows.length >= 16) {
    CANONICAL_VILLAGES.forEach((vName, idx) => {
      const match = tkDataRows.find((r) => String(r[1] || '').trim().toLowerCase() === vName.toLowerCase());
      const tongConLai = match ? parseInt(String(match[2] || '0').replace(/\D/g, ''), 10) || 0 : 0;
      const coTen = match ? parseInt(String(match[3] || '0').replace(/\D/g, ''), 10) || 0 : 0;
      const khongTen = match ? parseInt(String(match[4] || '0').replace(/\D/g, ''), 10) || 0 : 0;
      const daKeKhai = match ? parseInt(String(match[5] || '0').replace(/\D/g, ''), 10) || 0 : 0;

      villageStats.push({
        stt: idx + 1,
        name: vName,
        tongConLai,
        khongTen,
        coTen,
        daKeKhai,
      });

      sumTongConLai += tongConLai;
      sumKhongTen += khongTen;
      sumCoTen += coTen;
      sumDaKeKhai += daKeKhai;
    });
  } else {
    // Tự tính toán từ computedParcels nếu chưa có syncSheetsData
    const vMap: Record<string, { tongConLai: number; khongTen: number; coTen: number; daKeKhai: number }> = {};
    CANONICAL_VILLAGES.forEach((v) => {
      vMap[v] = { tongConLai: 0, khongTen: 0, coTen: 0, daKeKhai: 0 };
    });

    computedParcels.forEach((p) => {
      const v = getCanonicalVillage(p.thon_xa);
      const row = vMap[v] || vMap['Chưa xác định'];
      if (!row) return;

      const statusStr = (p.trang_thai || '') as string;
      if (statusStr.includes('DA_KE_KHAI') || statusStr === 'DA_SO_HOA_LAM') {
        row.daKeKhai++;
      } else if (statusStr === 'CO_TEN_CHUA_SO_HOA_VANG') {
        row.coTen++;
        row.tongConLai++;
      } else if (statusStr === 'CHUA_CO_TEN_CHUA_SO_HOA_TIM') {
        row.khongTen++;
        row.tongConLai++;
      } else if (p.chu_ho && p.chu_ho.trim() && !p.chu_ho.toLowerCase().includes('chưa có tên')) {
        row.coTen++;
        row.tongConLai++;
      } else {
        row.khongTen++;
        row.tongConLai++;
      }
    });

    CANONICAL_VILLAGES.forEach((vName, idx) => {
      const row = vMap[vName] || { tongConLai: 0, khongTen: 0, coTen: 0, daKeKhai: 0 };
      villageStats.push({
        stt: idx + 1,
        name: vName,
        tongConLai: row.tongConLai,
        khongTen: row.khongTen,
        coTen: row.coTen,
        daKeKhai: row.daKeKhai,
      });
      sumTongConLai += row.tongConLai;
      sumKhongTen += row.khongTen;
      sumCoTen += row.coTen;
      sumDaKeKhai += row.daKeKhai;
    });
  }

  // 2. GOM NHÓM DANH SÁCH "CÓ TÊN CHƯA THỰC HIỆN" THEO TỪNG THÔN BUÔN
  onProgress?.('Đang tổng hợp danh sách chủ hộ có tên chưa thực hiện...');
  const villageDetailGroups: VillageDetailGroup[] = [];

  CANONICAL_VILLAGES.forEach((vName) => {
    // Lấy các thửa đất thuộc thôn này và thuộc trạng thái có tên chưa thực hiện
    const parcelsInVillage = computedParcels.filter((p) => {
      const v = getCanonicalVillage(p.thon_xa);
      if (v !== vName) return false;
      const statusStr = String(p.trang_thai || '');
      const isNamedUndeclared =
        statusStr === 'CO_TEN_CHUA_SO_HOA_VANG' ||
        (!statusStr.includes('DA_KE_KHAI') &&
          statusStr !== 'DA_SO_HOA_XANH' &&
          p.chu_ho &&
          p.chu_ho.trim() &&
          !p.chu_ho.toLowerCase().includes('chưa có tên') &&
          !p.chu_ho.toLowerCase().includes('vô chủ'));
      return Boolean(isNamedUndeclared);
    });

    if (parcelsInVillage.length === 0) return;

    // Gom theo chủ hộ
    const ownerMap: Record<string, { displayName: string; count: number }> = {};
    parcelsInVillage.forEach((p) => {
      const rawName = String(p.chu_ho || '').trim();
      const normKey = rawName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^(ông|bà|hộ ông|hộ bà|hộ)\s*:?/i, '')
        .replace(/[^a-z0-9]/g, '');

      if (!ownerMap[normKey]) {
        ownerMap[normKey] = {
          displayName: formatPrefixOwner(rawName, p.chu_ho?.includes('Nữ') ? 'Nữ' : undefined),
          count: 0,
        };
      }
      ownerMap[normKey].count++;
    });

    // Sắp xếp giảm dần theo số thửa đất, sau đó theo tên A->Z
    const sortedOwners = Object.values(ownerMap).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.displayName.localeCompare(b.displayName, 'vi');
    });

    villageDetailGroups.push({
      villageName: vName,
      totalOwners: sortedOwners.length,
      totalParcels: parcelsInVillage.length,
      owners: sortedOwners.map((o, idx) => ({
        stt: idx + 1,
        name: o.displayName,
        parcelCount: o.count,
      })),
    });
  });

  // ==========================================================
  // TRANG 1: 4 PHẦN TỔNG QUAN VÀ BẢNG THỐNG KÊ 16 THÔN BUÔN
  // ==========================================================
  onProgress?.('Đang tạo Trang 1 (Bảng tổng hợp & 4 chỉ số thống kê)...');
  const page1 = doc.addPage([W, H]);

  let y = H - 36;

  // Header cơ quan
  page1.drawText('ỦY BAN NHÂN DÂN XÃ CƯ PUI', {
    x: marginX,
    y,
    size: 10,
    font: fontBold,
    color: rgb(0.15, 0.25, 0.45),
  });
  page1.drawText('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', {
    x: W - marginX - 210,
    y,
    size: 9.5,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 12;
  page1.drawText('HỘI ĐỒNG ĐĂNG KÝ ĐẤT ĐAI & KÊ KHAI ĐỊA CHÍNH', {
    x: marginX,
    y,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });
  page1.drawText('Độc lập - Tự do - Hạnh phúc', {
    x: W - marginX - 165,
    y,
    size: 9,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });

  y -= 22;
  // Tiêu đề chính
  const mainTitle = 'BÁO CÁO THỐNG KÊ TIẾN ĐỘ THỬA ĐẤT & KÊ KHAI ĐỊA CHÍNH';
  const titleW = fontBold.widthOfTextAtSize(mainTitle, 13);
  page1.drawText(mainTitle, {
    x: (W - titleW) / 2,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0.08, 0.2, 0.45),
  });

  y -= 14;
  const nowStr = new Date().toLocaleString('vi-VN');
  const subTitle = `Thời điểm thống kê: ${nowStr} • Đồng bộ realtime trực tiếp từ Cloudflare R2`;
  const subTitleW = fontRegular.widthOfTextAtSize(subTitle, 8.5);
  page1.drawText(subTitle, {
    x: (W - subTitleW) / 2,
    y,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.45, 0.45, 0.45),
  });

  // 4 KHỐI KPI TỔNG THỂ (Trang đầu gồm 4 phần: Tổng còn lại, Không có tên, Có tên, Đã kê khai)
  y -= 22;
  const cardGap = 6;
  const cardW = (contentW - cardGap * 3) / 4;
  const cardH = 50;
  const kpiCards = [
    {
      title: '1. TỔNG CÒN LẠI',
      count: `${sumTongConLai.toLocaleString('vi-VN')}`,
      desc: 'Toàn bộ chưa thực hiện',
      border: rgb(0.85, 0.2, 0.2),
      bg: rgb(0.99, 0.94, 0.94),
      titleColor: rgb(0.75, 0.1, 0.1),
    },
    {
      title: '2. KHÔNG CÓ TÊN',
      count: `${sumKhongTen.toLocaleString('vi-VN')}`,
      desc: 'Chưa có thông tin chủ',
      border: rgb(0.65, 0.2, 0.8),
      bg: rgb(0.97, 0.94, 0.99),
      titleColor: rgb(0.55, 0.1, 0.7),
    },
    {
      title: '3. CÓ TÊN CÒN LẠI',
      count: `${sumCoTen.toLocaleString('vi-VN')}`,
      desc: 'Chưa thu thập kê khai',
      border: rgb(0.85, 0.5, 0.1),
      bg: rgb(0.99, 0.96, 0.91),
      titleColor: rgb(0.8, 0.4, 0.05),
    },
    {
      title: '4. TỔNG ĐÃ KÊ KHAI',
      count: `${sumDaKeKhai.toLocaleString('vi-VN')}`,
      desc: 'Đã nộp phiếu trên web',
      border: rgb(0.15, 0.6, 0.25),
      bg: rgb(0.93, 0.98, 0.94),
      titleColor: rgb(0.1, 0.5, 0.2),
    },
  ];

  kpiCards.forEach((c, idx) => {
    const cx = marginX + idx * (cardW + cardGap);
    page1.drawRectangle({
      x: cx,
      y: y - cardH,
      width: cardW,
      height: cardH,
      color: c.bg,
      borderColor: c.border,
      borderWidth: 1,
    });
    page1.drawText(c.title, {
      x: cx + 7,
      y: y - 13,
      size: 7.5,
      font: fontBold,
      color: c.titleColor,
    });
    page1.drawText(c.count, {
      x: cx + 7,
      y: y - 31,
      size: 14,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    page1.drawText(c.desc, {
      x: cx + 7,
      y: y - 43,
      size: 6.5,
      font: fontRegular,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  y -= cardH + 18;

  // Tiêu đề bảng 16 thôn buôn
  page1.drawText('BẢNG TIẾN ĐỘ THỐNG KÊ CHI TIẾT 16 THÔN / BUÔN XÃ CƯ PUI', {
    x: marginX,
    y,
    size: 9.5,
    font: fontBold,
    color: rgb(0.12, 0.25, 0.5),
  });

  y -= 16;
  // Bảng số liệu
  const tableCols = [
    { label: 'STT', w: 34, align: 'center' },
    { label: 'Tên Thôn / Buôn', w: 145, align: 'left' },
    { label: '1. Tổng Còn Lại', w: 86, align: 'center' },
    { label: '2. Không Tên', w: 86, align: 'center' },
    { label: '3. Có Tên Còn Lại', w: 86, align: 'center' },
    { label: '4. Đã Kê Khai', w: 86.28, align: 'center' },
  ];

  // Vẽ tiêu đề cột
  const thH = 22;
  page1.drawRectangle({
    x: marginX,
    y: y - thH,
    width: contentW,
    height: thH,
    color: rgb(0.12, 0.28, 0.55),
  });

  let thX = marginX;
  tableCols.forEach((col) => {
    const textW = fontBold.widthOfTextAtSize(col.label, 8);
    const drawX = col.align === 'center' ? thX + (col.w - textW) / 2 : thX + 6;
    page1.drawText(col.label, {
      x: drawX,
      y: y - 15,
      size: 8,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    thX += col.w;
  });
  y -= thH;

  // Vẽ 16 dòng thôn buôn
  const trH = 17.5;
  villageStats.forEach((v, idx) => {
    const isEven = idx % 2 === 0;
    page1.drawRectangle({
      x: marginX,
      y: y - trH,
      width: contentW,
      height: trH,
      color: isEven ? rgb(0.97, 0.985, 1) : rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.88, 0.93),
      borderWidth: 0.5,
    });

    let rx = marginX;
    // STT
    const sttW = fontRegular.widthOfTextAtSize(String(v.stt), 8);
    page1.drawText(String(v.stt), {
      x: rx + (tableCols[0].w - sttW) / 2,
      y: y - 12,
      size: 8,
      font: fontRegular,
      color: rgb(0.4, 0.4, 0.4),
    });
    rx += tableCols[0].w;

    // Tên thôn buôn
    page1.drawText(v.name, {
      x: rx + 6,
      y: y - 12,
      size: 8,
      font: fontBold,
      color: rgb(0.1, 0.15, 0.25),
    });
    rx += tableCols[1].w;

    // 1. Tổng còn lại
    const tclStr = v.tongConLai.toLocaleString('vi-VN');
    const tclW = fontRegular.widthOfTextAtSize(tclStr, 8);
    page1.drawText(tclStr, {
      x: rx + (tableCols[2].w - tclW) / 2,
      y: y - 12,
      size: 8,
      font: fontRegular,
      color: rgb(0.8, 0.2, 0.2),
    });
    rx += tableCols[2].w;

    // 2. Không tên
    const ktStr = v.khongTen.toLocaleString('vi-VN');
    const ktW = fontRegular.widthOfTextAtSize(ktStr, 8);
    page1.drawText(ktStr, {
      x: rx + (tableCols[3].w - ktW) / 2,
      y: y - 12,
      size: 8,
      font: fontRegular,
      color: rgb(0.55, 0.2, 0.65),
    });
    rx += tableCols[3].w;

    // 3. Có tên còn lại
    const ctStr = v.coTen.toLocaleString('vi-VN');
    const ctW = fontRegular.widthOfTextAtSize(ctStr, 8);
    page1.drawText(ctStr, {
      x: rx + (tableCols[4].w - ctW) / 2,
      y: y - 12,
      size: 8,
      font: fontRegular,
      color: rgb(0.85, 0.5, 0.1),
    });
    rx += tableCols[4].w;

    // 4. Đã kê khai
    const dkkStr = v.daKeKhai.toLocaleString('vi-VN');
    const dkkW = fontBold.widthOfTextAtSize(dkkStr, 8);
    page1.drawText(dkkStr, {
      x: rx + (tableCols[5].w - dkkW) / 2,
      y: y - 12,
      size: 8,
      font: fontBold,
      color: rgb(0.1, 0.55, 0.25),
    });

    y -= trH;
  });

  // Dòng TỔNG CỘNG TOÀN XÃ
  const totalRowH = 22;
  page1.drawRectangle({
    x: marginX,
    y: y - totalRowH,
    width: contentW,
    height: totalRowH,
    color: rgb(0.9, 0.94, 1),
    borderColor: rgb(0.5, 0.65, 0.9),
    borderWidth: 1,
  });

  let totX = marginX;
  page1.drawText('TỔNG CỘNG TOÀN XÃ', {
    x: totX + 10,
    y: y - 15,
    size: 8.5,
    font: fontBold,
    color: rgb(0.08, 0.2, 0.5),
  });
  totX += tableCols[0].w + tableCols[1].w;

  const sumTclStr = sumTongConLai.toLocaleString('vi-VN');
  const sumTclW = fontBold.widthOfTextAtSize(sumTclStr, 9);
  page1.drawText(sumTclStr, {
    x: totX + (tableCols[2].w - sumTclW) / 2,
    y: y - 15,
    size: 9,
    font: fontBold,
    color: rgb(0.8, 0.1, 0.1),
  });
  totX += tableCols[2].w;

  const sumKtStr = sumKhongTen.toLocaleString('vi-VN');
  const sumKtW = fontBold.widthOfTextAtSize(sumKtStr, 9);
  page1.drawText(sumKtStr, {
    x: totX + (tableCols[3].w - sumKtW) / 2,
    y: y - 15,
    size: 9,
    font: fontBold,
    color: rgb(0.5, 0.1, 0.6),
  });
  totX += tableCols[3].w;

  const sumCtStr = sumCoTen.toLocaleString('vi-VN');
  const sumCtW = fontBold.widthOfTextAtSize(sumCtStr, 9);
  page1.drawText(sumCtStr, {
    x: totX + (tableCols[4].w - sumCtW) / 2,
    y: y - 15,
    size: 9,
    font: fontBold,
    color: rgb(0.8, 0.45, 0.05),
  });
  totX += tableCols[4].w;

  const sumDkkStr = sumDaKeKhai.toLocaleString('vi-VN');
  const sumDkkW = fontBold.widthOfTextAtSize(sumDkkStr, 9);
  page1.drawText(sumDkkStr, {
    x: totX + (tableCols[5].w - sumDkkW) / 2,
    y: y - 15,
    size: 9,
    font: fontBold,
    color: rgb(0.08, 0.5, 0.2),
  });

  // Footer Trang 1
  page1.drawText('Trang 1 • UBND Xã Cư Pui - Báo cáo địa chính tổng quan', {
    x: marginX,
    y: 20,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  // ==========================================================
  // TỪ TRANG 2 ĐẾN HẾT: BẢNG TÊN & SỐ THỬA CỦA DS CÓ TÊN CHƯA THỰC HIỆN
  // Format y hệt như hình ảnh (Header xanh đậm, lưới 3 cột, badge đỏ)
  // ==========================================================
  onProgress?.('Đang kết xuất danh sách chi tiết có tên chưa thực hiện (khổ 3 cột chuẩn ảnh)...');

  let currentPage = doc.addPage([W, H]);
  let currentY = H - 36;
  let pageNumber = 2;

  const drawPageHeader = (p: any, pNum: number) => {
    p.drawText('DANH SÁCH CHỦ HỘ CÓ TÊN CHƯA THỰC HIỆN KÊ KHAI (CHI TIẾT THEO THÔN / BUÔN)', {
      x: marginX,
      y: H - 30,
      size: 9.5,
      font: fontBold,
      color: rgb(0.1, 0.22, 0.5),
    });
    p.drawText(`Trang ${pNum}`, {
      x: W - marginX - 35,
      y: H - 30,
      size: 8,
      font: fontRegular,
      color: rgb(0.5, 0.5, 0.5),
    });
  };

  drawPageHeader(currentPage, pageNumber);
  currentY = H - 48;

  const cellW = contentW / 3; // ~174.4 pt
  const cellH = 22;
  const bannerH = 22;

  for (const vGroup of villageDetailGroups) {
    if (vGroup.owners.length === 0) continue;

    // Kiểm tra xem trang hiện tại còn đủ chỗ cho banner + ít nhất 2 hàng (bannerH + 2 * cellH = 66 pt) không
    if (currentY - (bannerH + cellH * 2) < 40) {
      currentPage = doc.addPage([W, H]);
      pageNumber++;
      drawPageHeader(currentPage, pageNumber);
      currentY = H - 48;
    }

    // 1. Vẽ banner Thôn / Buôn màu xanh đậm (chuẩn như ảnh)
    currentPage.drawRectangle({
      x: marginX,
      y: currentY - bannerH,
      width: contentW,
      height: bannerH,
      color: rgb(0.1, 0.23, 0.56),
    });

    const vTitle = vGroup.villageName.toUpperCase();
    const vSub = `(Tổng số: ${vGroup.totalOwners} chủ hộ | ${vGroup.totalParcels} thửa đất)`;
    const vTitleW = fontBold.widthOfTextAtSize(vTitle, 9.5);
    const vSubW = fontRegular.widthOfTextAtSize(vSub, 8);
    const centerAllX = marginX + (contentW - (vTitleW + 8 + vSubW)) / 2;

    currentPage.drawText(vTitle, {
      x: centerAllX,
      y: currentY - 15,
      size: 9.5,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    currentPage.drawText(vSub, {
      x: centerAllX + vTitleW + 8,
      y: currentY - 15,
      size: 8,
      font: fontRegular,
      color: rgb(0.85, 0.9, 1),
    });

    currentY -= bannerH;

    // 2. Vẽ lưới 3 cột các chủ hộ
    const totalOwners = vGroup.owners.length;
    for (let i = 0; i < totalOwners; i++) {
      const colIdx = i % 3;
      const isNewRow = colIdx === 0;

      if (isNewRow) {
        // Kiểm tra xem có cần sang trang mới không
        if (currentY - cellH < 35) {
          currentPage = doc.addPage([W, H]);
          pageNumber++;
          drawPageHeader(currentPage, pageNumber);
          currentY = H - 48;

          // Vẽ lại banner thôn để người đọc theo dõi liền mạch
          currentPage.drawRectangle({
            x: marginX,
            y: currentY - bannerH,
            width: contentW,
            height: bannerH,
            color: rgb(0.1, 0.23, 0.56),
          });
          currentPage.drawText(`${vTitle} (tiếp theo)`, {
            x: marginX + 12,
            y: currentY - 15,
            size: 9,
            font: fontBold,
            color: rgb(1, 1, 1),
          });
          currentY -= bannerH;
        }
      }

      const item = vGroup.owners[i];
      const cellX = marginX + colIdx * cellW;
      const cellY = currentY - cellH;

      // Viền ô màu xám xanh nhẹ
      currentPage.drawRectangle({
        x: cellX,
        y: cellY,
        width: cellW,
        height: cellH,
        borderColor: rgb(0.82, 0.86, 0.92),
        borderWidth: 0.5,
        color: rgb(1, 1, 1),
      });

      // Tên và STT bên trái
      // Thu gọn tên nếu quá dài để không đè lên badge
      let nameText = `${item.stt}. ${item.name}`;
      const maxTextW = cellW - 54;
      if (fontBold.widthOfTextAtSize(nameText, 8.5) > maxTextW) {
        while (nameText.length > 3 && fontBold.widthOfTextAtSize(nameText + '...', 8.5) > maxTextW) {
          nameText = nameText.slice(0, -1);
        }
        nameText += '...';
      }

      currentPage.drawText(nameText, {
        x: cellX + 5,
        y: cellY + 7,
        size: 8.5,
        font: fontBold,
        color: rgb(0.08, 0.15, 0.3),
      });

      // Badge đỏ hình viên thuốc bên phải (chuẩn như ảnh)
      const badgeW = 38;
      const badgeH = 14;
      const badgeX = cellX + cellW - badgeW - 4;
      const badgeY = cellY + 4;

      currentPage.drawRectangle({
        x: badgeX,
        y: badgeY,
        width: badgeW,
        height: badgeH,
        color: rgb(0.99, 0.9, 0.9), // Nền hồng/đỏ nhạt
        borderColor: rgb(0.98, 0.78, 0.78),
        borderWidth: 0.5,
      });

      const badgeText = `${item.parcelCount} thửa`;
      const bTextW = fontBold.widthOfTextAtSize(badgeText, 7);
      currentPage.drawText(badgeText, {
        x: badgeX + (badgeW - bTextW) / 2,
        y: badgeY + 3.5,
        size: 7,
        font: fontBold,
        color: rgb(0.85, 0.15, 0.15), // Chữ đỏ đậm
      });

      if (colIdx === 2 || i === totalOwners - 1) {
        currentY -= cellH;
      }
    }

    // Khoảng cách giữa các thôn buôn
    currentY -= 14;
  }

  onProgress?.('Đang lưu và hoàn tất tài liệu PDF...');
  const pdfBytes = await doc.save();
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `Bao_Cao_Thong_Ke_Dia_Chinh_Cu_Pui_${dateStr}.pdf`;

  return { pdfBytes, fileName };
}
