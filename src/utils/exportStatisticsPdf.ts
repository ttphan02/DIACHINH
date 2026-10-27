import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Parcel } from '../types';
import { CANONICAL_VILLAGES, getCanonicalVillage, isPersonName } from './textHelpers';

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

export interface MissingCccdCitizenItem {
  stt: number;
  name: string;
  dob: string;
  gender: string;
  cccd: string;
  parcels: string[];
}

export interface VillageMissingCccdGroup {
  villageName: string;
  totalCitizens: number;
  totalParcels: number;
  citizens: MissingCccdCitizenItem[];
}

export interface ExportStatisticsPdfOptions {
  includeUnexecutedOwners?: boolean;
  includeMissingCccdVillages?: boolean;
  onlyMissingCccd?: boolean;
  targetVillage?: string;
  declarationsMap?: Record<string, any>;
}

async function loadBuffer(urlOrPath: string): Promise<ArrayBuffer> {
  if (typeof window === 'undefined') {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const cleanPath = urlOrPath.startsWith('/') ? urlOrPath.slice(1) : urlOrPath;
      const candidates = [
        path.join(process.cwd(), 'public', cleanPath),
        path.join(process.cwd(), 'diachinh-web', 'public', cleanPath),
        urlOrPath,
      ];
      for (const cand of candidates) {
        try {
          const buf = await fs.readFile(cand);
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        } catch {}
      }
    } catch {}
  }

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
  onProgress?: (msg: string) => void,
  options: ExportStatisticsPdfOptions = {}
): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
  const {
    includeUnexecutedOwners = true,
    includeMissingCccdVillages = true,
    onlyMissingCccd = false,
    targetVillage,
    declarationsMap = {},
  } = options;

  const filterVillage = targetVillage ? getCanonicalVillage(targetVillage) : null;

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

  let globalPageNumber = 1;

  // ==========================================================
  // NẾU CHỈ XUẤT DS CẦN THU THẬP CCCD THEO THÔN (onlyMissingCccd = true)
  // THÌ BỎ QUA PHẦN THỐNG KÊ TỔNG THỂ & DS CHƯA KÊ KHAI
  // ==========================================================
  if (!onlyMissingCccd) {
    onProgress?.(
      filterVillage
        ? `Đang tính toán số liệu thống kê ${filterVillage}...`
        : 'Đang tính toán số liệu thống kê 16 thôn buôn...'
    );

    // 1. TÍNH TOÁN BẢNG SỐ LIỆU 16 THÔN BUÔN (HOẶC RIÊNG THÔN YÊU CẦU)
    const villageStats: VillageStatsItem[] = [];
    let sumTongConLai = 0;
    let sumKhongTen = 0;
    let sumCoTen = 0;
    let sumDaKeKhai = 0;

    const rawTkRows = syncSheetsData?.['THỐNG KÊ'] || [];
    const headerIdx = rawTkRows.findIndex((r) => Array.isArray(r) && r[0] === 'STT' && r[1] === 'Tên thôn / buôn');
    const tkDataRows = headerIdx >= 0 ? rawTkRows.slice(headerIdx + 1) : [];

    const targetVillages = filterVillage ? [filterVillage] : CANONICAL_VILLAGES;

    if (tkDataRows.length >= 16) {
      targetVillages.forEach((vName, idx) => {
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
        } else if (statusStr === 'CO_TEN_CHUA_SO_HOA_VANG' || isPersonName(p.chu_ho)) {
          row.coTen++;
          row.tongConLai++;
        } else {
          row.khongTen++;
          row.tongConLai++;
        }
      });

      targetVillages.forEach((vName, idx) => {
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

    if (includeUnexecutedOwners) {
      const detailVillages = filterVillage ? [filterVillage] : CANONICAL_VILLAGES;
      detailVillages.forEach((vName) => {
        const parcelsInVillage = computedParcels.filter((p) => {
          const v = getCanonicalVillage(p.thon_xa);
          if (v !== vName) return false;
          const statusStr = String(p.trang_thai || '');
          const isNamedUndeclared =
            (statusStr === 'CO_TEN_CHUA_SO_HOA_VANG' || isPersonName(p.chu_ho)) &&
            !statusStr.includes('DA_KE_KHAI') &&
            statusStr !== 'DA_SO_HOA_XANH';
          return Boolean(isNamedUndeclared);
        });

        if (parcelsInVillage.length === 0) return;

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
    }

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
    const mainTitle = filterVillage
      ? `BÁO CÁO THỐNG KÊ TIẾN ĐỘ THỬA ĐẤT - ${filterVillage.toUpperCase()}`
      : 'BÁO CÁO THỐNG KÊ TIẾN ĐỘ THỬA ĐẤT & KÊ KHAI ĐỊA CHÍNH';
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
    const subTitle = filterVillage
      ? `Thời điểm thống kê: ${nowStr} • Thống kê chi tiết trên địa bàn ${filterVillage}, xã Cư Pui`
      : `Thời điểm thống kê: ${nowStr} • Đồng bộ realtime trực tiếp từ Cloudflare R2`;
    const subTitleW = fontRegular.widthOfTextAtSize(subTitle, 8.5);
    page1.drawText(subTitle, {
      x: (W - subTitleW) / 2,
      y,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.45, 0.45, 0.45),
    });

    // 4 KHỐI KPI TỔNG THỂ
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

    // Tiêu đề bảng 16 thôn buôn (hoặc thôn lọc)
    const tableTitle = filterVillage
      ? `BẢNG TIẾN ĐỘ THỐNG KÊ CHI TIẾT - ${filterVillage.toUpperCase()}`
      : 'BẢNG TIẾN ĐỘ THỐNG KÊ CHI TIẾT 16 THÔN / BUÔN XÃ CƯ PUI';
    page1.drawText(tableTitle, {
      x: marginX,
      y,
      size: 9.5,
      font: fontBold,
      color: rgb(0.12, 0.25, 0.5),
    });

    y -= 16;
    const tableCols = [
      { label: 'STT', w: 34, align: 'center' },
      { label: 'Tên Thôn / Buôn', w: 145, align: 'left' },
      { label: '1. Tổng Còn Lại', w: 86, align: 'center' },
      { label: '2. Không Tên', w: 86, align: 'center' },
      { label: '3. Có Tên Còn Lại', w: 86, align: 'center' },
      { label: '4. Đã Kê Khai', w: 86.28, align: 'center' },
    ];

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
      const sttW = fontRegular.widthOfTextAtSize(String(v.stt), 8);
      page1.drawText(String(v.stt), {
        x: rx + (tableCols[0].w - sttW) / 2,
        y: y - 12,
        size: 8,
        font: fontRegular,
        color: rgb(0.4, 0.4, 0.4),
      });
      rx += tableCols[0].w;

      page1.drawText(v.name, {
        x: rx + 6,
        y: y - 12,
        size: 8,
        font: fontBold,
        color: rgb(0.1, 0.15, 0.25),
      });
      rx += tableCols[1].w;

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
    const totalRowLabel = filterVillage
      ? `TỔNG CỘNG ${filterVillage.toUpperCase()}`
      : 'TỔNG CỘNG TOÀN XÃ';
    page1.drawText(totalRowLabel, {
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

    const footerText = filterVillage
      ? `Trang 1 • UBND Xã Cư Pui - Báo cáo địa chính ${filterVillage}`
      : 'Trang 1 • UBND Xã Cư Pui - Báo cáo địa chính tổng quan';
    page1.drawText(footerText, {
      x: marginX,
      y: 20,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.5, 0.5, 0.5),
    });

    globalPageNumber++;

    // ==========================================================
    // PHẦN 2: BẢNG TÊN & SỐ THỬA CỦA DS CÓ TÊN CHƯA THỰC HIỆN
    // ==========================================================
    if (includeUnexecutedOwners && villageDetailGroups.length > 0) {
      onProgress?.('Đang kết xuất danh sách chi tiết có tên chưa thực hiện (khổ 3 cột)...');

      let currentPage = doc.addPage([W, H]);
      let currentY = H - 36;

      const drawPageHeader = (p: any, pNum: number) => {
        const headerTitle = filterVillage
          ? `DANH SÁCH CHỦ HỘ CÓ TÊN CHƯA THỰC HIỆN KÊ KHAI - ${filterVillage.toUpperCase()}`
          : 'DANH SÁCH CHỦ HỘ CÓ TÊN CHƯA THỰC HIỆN KÊ KHAI (CHI TIẾT THEO THÔN / BUÔN)';
        p.drawText(headerTitle, {
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

      drawPageHeader(currentPage, globalPageNumber);
      currentY = H - 48;

      const cellW = contentW / 3;
      const cellH = 22;
      const bannerH = 22;

      for (const vGroup of villageDetailGroups) {
        if (vGroup.owners.length === 0) continue;

        if (currentY - (bannerH + cellH * 2) < 40) {
          globalPageNumber++;
          currentPage = doc.addPage([W, H]);
          drawPageHeader(currentPage, globalPageNumber);
          currentY = H - 48;
        }

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

        const totalOwners = vGroup.owners.length;
        for (let i = 0; i < totalOwners; i++) {
          const colIdx = i % 3;
          const isNewRow = colIdx === 0;

          if (isNewRow && currentY - cellH < 35) {
            globalPageNumber++;
            currentPage = doc.addPage([W, H]);
            drawPageHeader(currentPage, globalPageNumber);
            currentY = H - 48;

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

          const item = vGroup.owners[i];
          const cellX = marginX + colIdx * cellW;
          const cellY = currentY - cellH;

          currentPage.drawRectangle({
            x: cellX,
            y: cellY,
            width: cellW,
            height: cellH,
            borderColor: rgb(0.82, 0.86, 0.92),
            borderWidth: 0.5,
            color: rgb(1, 1, 1),
          });

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

          const badgeW = 38;
          const badgeH = 14;
          const badgeX = cellX + cellW - badgeW - 4;
          const badgeY = cellY + 4;

          currentPage.drawRectangle({
            x: badgeX,
            y: badgeY,
            width: badgeW,
            height: badgeH,
            color: rgb(0.99, 0.9, 0.9),
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
            color: rgb(0.85, 0.15, 0.15),
          });

          if (colIdx === 2 || i === totalOwners - 1) {
            currentY -= cellH;
          }
        }

        currentY -= 14;
      }

      globalPageNumber++;
    }
  }

  // ==========================================================
  // PHẦN 3: DANH SÁCH CẦN THU THẬP CCCD THEO TỪNG THÔN BUÔN
  // (MỖI THÔN BUÔN LÀ 1 TRANG RIÊNG BIỆT - TIỆN IN ẤN VÀ ĐI ĐỊA BÀN)
  // ==========================================================
  if (includeMissingCccdVillages) {
    onProgress?.('Đang kết xuất danh sách cần thu thập CCCD theo từng thôn buôn (mỗi thôn buôn 1 trang)...');

    // 1. Thu thập dữ liệu các thửa cần thu thập CCCD
    const villageMissingMap = new Map<string, Map<string, MissingCccdCitizenItem>>();

    const rawChuaCccdRows = (syncSheetsData?.['THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)'] || []).filter(
      (r) => Array.isArray(r) && r.length > 3 && r[0] !== 'STT'
    );

    if (rawChuaCccdRows.length > 0) {
      // Dùng dữ liệu đồng bộ trực tiếp từ Google Sheets / Cache
      for (const r of rawChuaCccdRows) {
        const rawVillage = String(r[2] || '');
        const vName = getCanonicalVillage(rawVillage);
        if (!villageMissingMap.has(vName)) {
          villageMissingMap.set(vName, new Map());
        }
        const citizenMap = villageMissingMap.get(vName)!;

        const name = String(r[3] || '').trim();
        if (!name || name === 'Chưa có tên' || /^\d+$/.test(name) || name.length <= 1) continue;

        const dob = String(r[4] || '').trim();
        const gender = String(r[5] || '').trim();
        const rawCccd = String(r[6] || '').replace(/^="|"$/g, '').trim();
        const maThua = String(r[1] || '').trim();

        const citizenKey = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        if (!citizenMap.has(citizenKey)) {
          citizenMap.set(citizenKey, {
            stt: 0,
            name,
            dob,
            gender,
            cccd: rawCccd && rawCccd !== 'Chưa có' ? rawCccd : '',
            parcels: maThua ? [maThua] : [],
          });
        } else {
          const existing = citizenMap.get(citizenKey)!;
          if (maThua && !existing.parcels.includes(maThua)) {
            existing.parcels.push(maThua);
          }
          if (!existing.dob && dob) existing.dob = dob;
          if (!existing.gender && gender) existing.gender = gender;
          if (!existing.cccd && rawCccd && rawCccd !== 'Chưa có') existing.cccd = rawCccd;
        }
      }
    } else {
      // Fallback: Trích xuất từ computedParcels + declarationsMap
      computedParcels.forEach((p) => {
        const isDeclared =
          p.trang_thai?.includes('DA_KE_KHAI') ||
          (p.trang_thai as any) === 'DA_SO_HOA_LAM' ||
          Boolean(declarationsMap[p.ma_thua]);
        if (!isDeclared) return;

        const decl = declarationsMap[p.ma_thua] || {};
        const hasPdf = Boolean(p.cccd_url || decl.cccd_url || decl.anh_cccd_pdf);
        if (hasPdf) return;

        const rawVillage = String(p.thon_xa || decl.dia_chi_thua_dat || '');
        const vName = getCanonicalVillage(rawVillage);
        if (!villageMissingMap.has(vName)) {
          villageMissingMap.set(vName, new Map());
        }
        const citizenMap = villageMissingMap.get(vName)!;

        const name = String(decl.chu_dat_ten || p.chu_ho || '').trim();
        if (!name || name === 'Chưa có tên' || /^\d+$/.test(name) || name.length <= 1) return;

        const dob = String(decl.chu_dat_nam_sinh || (p as any).nam_sinh || '').trim();
        const gender = String(decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || '').trim();
        const cccd = String(decl.chu_dat_cccd || p.cccd || '').replace(/^="|"$/g, '').trim();
        const maThua = String(p.ma_thua || '').trim();

        const citizenKey = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        if (!citizenMap.has(citizenKey)) {
          citizenMap.set(citizenKey, {
            stt: 0,
            name,
            dob,
            gender,
            cccd: cccd && cccd !== 'Chưa có' ? cccd : '',
            parcels: maThua ? [maThua] : [],
          });
        } else {
          const existing = citizenMap.get(citizenKey)!;
          if (maThua && !existing.parcels.includes(maThua)) {
            existing.parcels.push(maThua);
          }
          if (!existing.dob && dob) existing.dob = dob;
          if (!existing.gender && gender) existing.gender = gender;
          if (!existing.cccd && cccd && cccd !== 'Chưa có') existing.cccd = cccd;
        }
      });
    }

    const missingTableCols = [
      { label: 'STT', w: 28, align: 'center' },
      { label: 'Họ và tên chủ hộ', w: 135, align: 'left' },
      { label: 'Năm sinh / GT', w: 60, align: 'center' },
      { label: 'Số CCCD (GGS)', w: 85, align: 'center' },
      { label: 'Mã thửa đất', w: 85, align: 'left' },
      { label: 'Ký nhận / Đã chụp CCCD', w: 130.28, align: 'left' },
    ];

    const allMissingVillages = Array.from(villageMissingMap.keys()).sort((a, b) =>
      a.localeCompare(b, 'vi')
    );

    const sortedMissingVillages = filterVillage
      ? allMissingVillages.filter((v) => v.toLowerCase() === filterVillage.toLowerCase())
      : allMissingVillages;

    if (sortedMissingVillages.length === 0 && (onlyMissingCccd || filterVillage)) {
      if (onlyMissingCccd) {
        let page = doc.addPage([W, H]);
        page.drawText('ỦY BAN NHÂN DÂN XÃ CƯ PUI', {
          x: marginX,
          y: H - 36,
          size: 9.5,
          font: fontBold,
          color: rgb(0.12, 0.25, 0.5),
        });
        page.drawText('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', {
          x: W - marginX - 210,
          y: H - 36,
          size: 9,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1),
        });
        const vTitle = filterVillage ? filterVillage.toUpperCase() : 'TOÀN XÃ';
        page.drawText(`DANH SÁCH CẦN THU THẬP CCCD - ${vTitle}`, {
          x: marginX,
          y: H - 80,
          size: 12,
          font: fontBold,
          color: rgb(0.1, 0.2, 0.5),
        });
        page.drawText(
          `Hiện tại trên địa bàn ${filterVillage || 'xã'} không có hồ sơ nào thuộc diện cần thu thập CCCD (chưa có đơn kê khai hoặc đã đủ CCCD).`,
          {
            x: marginX,
            y: H - 110,
            size: 10,
            font: fontRegular,
            color: rgb(0.3, 0.3, 0.3),
          }
        );
      }
    }

    for (const vName of sortedMissingVillages) {
      const citizenMap = villageMissingMap.get(vName)!;
      const citizens = Array.from(citizenMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      if (citizens.length === 0) continue;

      citizens.forEach((c, idx) => {
        c.stt = idx + 1;
      });
      const totalParcels = citizens.reduce((sum, c) => sum + c.parcels.length, 0);

      // QUY TẮC: MỖI THÔN BUÔN LÀ 1 TRANG MỚI ĐỘC LẬP
      let page = doc.addPage([W, H]);
      let currentY = H - 36;
      let villagePageIdx = 1;

      const drawMissingHeader = (isContinuation = false) => {
        page.drawText('ỦY BAN NHÂN DÂN XÃ CƯ PUI', {
          x: marginX,
          y: currentY,
          size: 9.5,
          font: fontBold,
          color: rgb(0.12, 0.25, 0.5),
        });
        page.drawText('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', {
          x: W - marginX - 210,
          y: currentY,
          size: 9,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1),
        });
        currentY -= 12;
        page.drawText('HỘI ĐỒNG ĐĂNG KÝ ĐẤT ĐAI & KÊ KHAI', {
          x: marginX,
          y: currentY,
          size: 8,
          font: fontRegular,
          color: rgb(0.4, 0.4, 0.4),
        });
        page.drawText('Độc lập - Tự do - Hạnh phúc', {
          x: W - marginX - 160,
          y: currentY,
          size: 8.5,
          font: fontBold,
          color: rgb(0.2, 0.2, 0.2),
        });

        currentY -= 18;

        const bannerH = 34;
        page.drawRectangle({
          x: marginX,
          y: currentY - bannerH,
          width: contentW,
          height: bannerH,
          color: rgb(0.12, 0.28, 0.55),
          borderColor: rgb(0.08, 0.2, 0.45),
          borderWidth: 1,
        });

        const titleText = isContinuation
          ? `DANH SÁCH CẦN THU THẬP CCCD - ${vName.toUpperCase()} (TIẾP THEO)`
          : `DANH SÁCH CẦN THU THẬP CCCD - ${vName.toUpperCase()}`;
        page.drawText(titleText, {
          x: marginX + 10,
          y: currentY - 14,
          size: 11,
          font: fontBold,
          color: rgb(1, 1, 1),
        });

        const subText = `Thôn / Buôn: ${vName} • Tổng số: ${citizens.length} chủ hộ (${totalParcels} thửa đất) cần thu thập CCCD`;
        page.drawText(subText, {
          x: marginX + 10,
          y: currentY - 26,
          size: 8,
          font: fontRegular,
          color: rgb(0.85, 0.92, 1),
        });

        currentY -= bannerH + 10;

        // Tiêu đề cột bảng
        const thH = 20;
        page.drawRectangle({
          x: marginX,
          y: currentY - thH,
          width: contentW,
          height: thH,
          color: rgb(0.92, 0.95, 0.98),
          borderColor: rgb(0.75, 0.82, 0.9),
          borderWidth: 0.5,
        });

        let thX = marginX;
        missingTableCols.forEach((col) => {
          const textW = fontBold.widthOfTextAtSize(col.label, 8);
          const drawX = col.align === 'center' ? thX + (col.w - textW) / 2 : thX + 5;
          page.drawText(col.label, {
            x: drawX,
            y: currentY - 13.5,
            size: 8,
            font: fontBold,
            color: rgb(0.1, 0.2, 0.4),
          });
          thX += col.w;
        });

        currentY -= thH;
      };

      drawMissingHeader(false);

      const trH = 18;

      for (let i = 0; i < citizens.length; i++) {
        const c = citizens[i];

        if (currentY - trH < 40) {
          page.drawText(
            `Trang ${globalPageNumber} • ${vName} (Trang ${villagePageIdx}) • Danh sách thu thập CCCD - UBND Xã Cư Pui`,
            {
              x: marginX,
              y: 20,
              size: 7.5,
              font: fontRegular,
              color: rgb(0.5, 0.5, 0.5),
            }
          );

          globalPageNumber++;
          villagePageIdx++;
          page = doc.addPage([W, H]);
          currentY = H - 36;
          drawMissingHeader(true);
        }

        const isEven = i % 2 === 0;
        page.drawRectangle({
          x: marginX,
          y: currentY - trH,
          width: contentW,
          height: trH,
          color: isEven ? rgb(1, 1, 1) : rgb(0.975, 0.985, 1),
          borderColor: rgb(0.86, 0.89, 0.94),
          borderWidth: 0.5,
        });

        let rx = marginX;

        // 1. STT
        const sttStr = String(c.stt);
        const sttW = fontRegular.widthOfTextAtSize(sttStr, 8);
        page.drawText(sttStr, {
          x: rx + (missingTableCols[0].w - sttW) / 2,
          y: currentY - 12,
          size: 8,
          font: fontRegular,
          color: rgb(0.4, 0.4, 0.4),
        });
        rx += missingTableCols[0].w;

        // 2. Họ và tên chủ hộ
        let nameStr = c.name;
        if (fontBold.widthOfTextAtSize(nameStr, 8) > missingTableCols[1].w - 8) {
          while (nameStr.length > 3 && fontBold.widthOfTextAtSize(nameStr + '...', 8) > missingTableCols[1].w - 8) {
            nameStr = nameStr.slice(0, -1);
          }
          nameStr += '...';
        }
        page.drawText(nameStr, {
          x: rx + 5,
          y: currentY - 12,
          size: 8,
          font: fontBold,
          color: rgb(0.1, 0.15, 0.25),
        });
        rx += missingTableCols[1].w;

        // 3. Năm sinh / GT
        const nsGtStr = `${c.dob || '----'} ${c.gender ? `(${c.gender})` : ''}`.trim();
        const nsGtW = fontRegular.widthOfTextAtSize(nsGtStr, 7.5);
        page.drawText(nsGtStr, {
          x: rx + (missingTableCols[2].w - nsGtW) / 2,
          y: currentY - 12,
          size: 7.5,
          font: fontRegular,
          color: rgb(0.3, 0.3, 0.3),
        });
        rx += missingTableCols[2].w;

        // 4. Số CCCD (GGS)
        const cccdStr = c.cccd || '-';
        const cccdW = fontRegular.widthOfTextAtSize(cccdStr, 7.5);
        page.drawText(cccdStr, {
          x: rx + (missingTableCols[3].w - cccdW) / 2,
          y: currentY - 12,
          size: 7.5,
          font: c.cccd ? fontBold : fontRegular,
          color: c.cccd ? rgb(0.15, 0.45, 0.8) : rgb(0.6, 0.6, 0.6),
        });
        rx += missingTableCols[3].w;

        // 5. Mã thửa đất
        let mathuaStr = c.parcels.join(', ');
        if (fontRegular.widthOfTextAtSize(mathuaStr, 7.5) > missingTableCols[4].w - 8) {
          mathuaStr = c.parcels.slice(0, 2).join(', ') + ` (+${c.parcels.length - 2})`;
        }
        page.drawText(mathuaStr, {
          x: rx + 5,
          y: currentY - 12,
          size: 7.5,
          font: fontRegular,
          color: rgb(0.2, 0.2, 0.2),
        });
        rx += missingTableCols[4].w;

        // 6. Ký nhận / Đã chụp CCCD (hộp kiểm tra cho cán bộ đi thực địa)
        page.drawRectangle({
          x: rx + 6,
          y: currentY - 13,
          width: 8,
          height: 8,
          borderColor: rgb(0.5, 0.55, 0.65),
          borderWidth: 0.8,
          color: rgb(1, 1, 1),
        });
        page.drawText('Đã thu / SĐT: ....................', {
          x: rx + 18,
          y: currentY - 12,
          size: 7,
          font: fontRegular,
          color: rgb(0.45, 0.45, 0.45),
        });

        currentY -= trH;
      }

      // Footer trang cuối của thôn này
      page.drawText(
        `Trang ${globalPageNumber} • ${vName} (Trang ${villagePageIdx}) • Danh sách thu thập CCCD - UBND Xã Cư Pui`,
        {
          x: marginX,
          y: 20,
          size: 7.5,
          font: fontRegular,
          color: rgb(0.5, 0.5, 0.5),
        }
      );
      globalPageNumber++;
    }
  }

  onProgress?.('Đang lưu và hoàn tất tài liệu PDF...');
  const pdfBytes = await doc.save();
  const dateStr = new Date().toISOString().slice(0, 10);
  const slugVillage = filterVillage
    ? '_' + filterVillage.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
    : '';

  const fileName = onlyMissingCccd
    ? `Danh_Sach_Can_Thu_Thap_CCCD${slugVillage ? slugVillage : '_Tung_Thon_Cu_Pui'}_${dateStr}.pdf`
    : `Bao_Cao_Thong_Ke_Dia_Chinh${slugVillage ? slugVillage : '_Kem_DS_Thu_CCCD_Cu_Pui'}_${dateStr}.pdf`;

  return { pdfBytes, fileName };
}
