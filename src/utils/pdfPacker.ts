import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export interface ReadyToPackItem {
  ma_thua: string;
  to_ban_do: string;
  so_thua: string;
  thon_xa: string;
  chu_ho: string;
  dob?: string | null;
  gender?: string | null;
  cccd?: string | null;
  dien_tich?: string | null;
  loai_dat?: string | null;
  nguon_goc?: string | null;
  cccd_file?: string | null;
  cccd_url?: string | null;
  has_gcn?: boolean | null;
  gcn_urls?: string[] | null;
}

function resolveThoiHan(mucDich?: string | null): string {
  if (!mucDich) return '50 năm';
  const parts = String(mucDich).split('+');
  const res = parts.map((p) => (p.trim().toUpperCase() === 'ONT' ? 'Lâu dài' : '50 năm'));
  return res.join('+');
}

function cleanNameKey(name?: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(hộ ông|hộ bà|ông|bà)\s*:?/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function cleanOwnerNameDisplay(name?: string): string {
  if (!name) return '';
  return name.replace(/^(hộ ông|hộ bà|ông|bà)\s*:?/i, '').trim();
}

async function loadBuffer(urlOrPath: string): Promise<ArrayBuffer> {
  const resp = await fetch(urlOrPath);
  if (!resp.ok) {
    throw new Error(`Không thể tải tài nguyên: ${urlOrPath} (${resp.status})`);
  }
  return await resp.arrayBuffer();
}

export async function generateReadyToPackPdf(
  items: ReadyToPackItem[],
  onProgress?: (current: number, total: number, message: string) => void
): Promise<{ pdfBytes: Uint8Array; fileName: string; totalSets: number }> {
  if (!items || items.length === 0) {
    throw new Error('Không có thửa đất nào để đóng tập.');
  }

  onProgress?.(0, items.length, 'Đang chuẩn bị mẫu hồ sơ và font chữ...');

  // 1. Tải mẫu template.pdf và fonts (sử dụng font in đậm timesbd.ttf cho thông tin kê khai)
  const [templateBytes, fontRegularBytes, fontBoldBytes] = await Promise.all([
    loadBuffer('/template.pdf'),
    loadBuffer('/fonts/times.ttf'),
    loadBuffer('/fonts/timesbd.ttf'),
  ]);

  // 2. Gom nhóm các thửa theo Chủ hộ / Người sử dụng đất (y hệt logic PDF_Web_App)
  const grouped: Record<string, { ownerDisplayName: string; rows: ReadyToPackItem[] }> = {};
  items.forEach((it) => {
    const rawName = String(it.chu_ho || '').trim();
    const cleanKey = cleanNameKey(rawName) || 'khong_ten';
    if (!grouped[cleanKey]) {
      grouped[cleanKey] = {
        ownerDisplayName: cleanOwnerNameDisplay(rawName) || rawName || 'Chưa xác định',
        rows: [],
      };
    }
    grouped[cleanKey].rows.push(it);
  });

  const groupKeys = Object.keys(grouped);
  const totalSets = groupKeys.length;

  // 3. Khởi tạo file PDF đích gom tất cả
  const mergedDoc = await PDFDocument.create();
  mergedDoc.registerFontkit(fontkit);

  let processedCount = 0;

  for (let gIdx = 0; gIdx < totalSets; gIdx++) {
    const gKey = groupKeys[gIdx];
    const group = grouped[gKey];
    const { ownerDisplayName, rows } = group;
    const firstRow = rows[0];

    onProgress?.(
      gIdx + 1,
      totalSets,
      `Đang đóng tập (${gIdx + 1}/${totalSets}): ${ownerDisplayName} (${rows.length} thửa)...`
    );

    // ========================================================
    // BƯỚC 1: TRANG ĐẦU TIÊN LUÔN LÀ CCCD (GHÉP TRANG PDF TỪ R2)
    // ========================================================
    let cccdInserted = false;
    const cccdFileName = firstRow.cccd_file || (firstRow.cccd ? `${firstRow.cccd}.pdf` : '');

    // Tìm URL CCCD từ proxy hoặc URL trực tiếp
    const possibleUrls: string[] = [];
    if (firstRow.cccd_url) possibleUrls.push(firstRow.cccd_url);
    if (cccdFileName) {
      possibleUrls.push(`/api/image/cccd/${encodeURIComponent(cccdFileName)}`);
      possibleUrls.push(`https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/cccd/${encodeURIComponent(cccdFileName)}`);
    }

    for (const url of possibleUrls) {
      try {
        const cccdRes = await fetch(url);
        if (cccdRes.ok) {
          const cccdBuf = await cccdRes.arrayBuffer();
          // Kiểm tra xem có đúng định dạng PDF không (%PDF)
          const header = new Uint8Array(cccdBuf.slice(0, 4));
          const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
          if (isPdf) {
            const cccdDoc = await PDFDocument.load(cccdBuf, { ignoreEncryption: true });
            const pageIndices = cccdDoc.getPageIndices();
            if (pageIndices.length > 0) {
              const copiedPages = await mergedDoc.copyPages(cccdDoc, pageIndices);
              copiedPages.forEach((cp) => mergedDoc.addPage(cp));
              cccdInserted = true;
              break;
            }
          }
        }
      } catch (err) {
        console.warn(`Không thể nạp CCCD PDF từ ${url}:`, err);
      }
    }

    if (!cccdInserted) {
      // Nếu không tìm thấy file PDF CCCD trên R2: Thêm 1 trang thông báo bìa
      const blankPage = mergedDoc.addPage([595.28, 841.89]);
      const f = await mergedDoc.embedFont(fontRegularBytes);
      blankPage.drawText(`BẢN SAO CĂN CƯỚC CÔNG DÂN: ${ownerDisplayName.toUpperCase()}`, {
        x: 100,
        y: 700,
        size: 14,
        font: f,
        color: rgb(0.2, 0.2, 0.2),
      });
      blankPage.drawText(`(Chưa tìm thấy tệp PDF CCCD trên kho Cloudflare R2)`, {
        x: 100,
        y: 670,
        size: 11,
        font: f,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    // Trang trắng phía sau CCCD (chuẩn in ấn 2 mặt tách biệt bìa CCCD y hệt PDF_Web_App)
    mergedDoc.addPage([595.28, 841.89]);

    // ========================================================
    // BƯỚC 2: KIỂM TRA CÓ GCN HAY KHÔNG
    // ========================================================
    const hasGcn = Boolean(firstRow.has_gcn) || (firstRow.gcn_urls && firstRow.gcn_urls.length > 0);
    if (hasGcn && firstRow.gcn_urls && firstRow.gcn_urls.length > 0) {
      // Đã có ảnh/PDF GCN: Ghép trực tiếp GCN
      for (const gcnUrl of firstRow.gcn_urls) {
        try {
          const gcnRes = await fetch(gcnUrl);
          if (gcnRes.ok) {
            const gcnBuf = await gcnRes.arrayBuffer();
            const header = new Uint8Array(gcnBuf.slice(0, 4));
            const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
            if (isPdf) {
              const gcnDoc = await PDFDocument.load(gcnBuf, { ignoreEncryption: true });
              const copiedGcn = await mergedDoc.copyPages(gcnDoc, gcnDoc.getPageIndices());
              copiedGcn.forEach((p) => mergedDoc.addPage(p));
            } else {
              // Embed ảnh GCN
              const gcnPage = mergedDoc.addPage([595.28, 841.89]);
              let embeddedImg;
              try {
                embeddedImg = await mergedDoc.embedJpg(gcnBuf);
              } catch {
                embeddedImg = await mergedDoc.embedPng(gcnBuf);
              }
              const scaled = embeddedImg.scaleToFit(520, 740);
              gcnPage.drawImage(embeddedImg, {
                x: (595.28 - scaled.width) / 2,
                y: (841.89 - scaled.height) / 2,
                width: scaled.width,
                height: scaled.height,
              });
            }
          }
        } catch (e) {
          console.warn('Lỗi ghép GCN:', e);
        }
      }
      processedCount++;
      continue;
    }

    // ========================================================
    // BƯỚC 3: KHÔNG CÓ GCN -> ĐIỀN ĐƠN VÀO TEMPLATE.PDF (MẪU 15 & MẪU 15B)
    // ========================================================
    const tempDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    tempDoc.registerFontkit(fontkit);
    const timesFont = await tempDoc.embedFont(fontBoldBytes); // In đậm tất cả chữ ghi trên phiếu kê khai

    const p1 = tempDoc.getPages()[0];
    const pageH = p1.getHeight();

    // Tọa độ chuẩn khớp 100% với PDF_Web_App fitz coordinates:
    // fitz: (x, y_fitz) từ đỉnh trang -> pdf-lib: y = pageH - y_fitz
    const yOff = -4.25; // -pt(0.15)
    const fitzToPdfY = (yFitz: number) => pageH - (yFitz + yOff);

    const cccdVal = firstRow.cccd || '';
    const diaChiVal = firstRow.thon_xa ? `${firstRow.thon_xa}, xã Cư Pui` : 'Xã Cư Pui';

    // Họ tên, CCCD, địa chỉ chung
    p1.drawText(ownerDisplayName, {
      x: 209.76,
      y: fitzToPdfY(248),
      size: 11,
      font: timesFont,
      color: rgb(0, 0, 0),
    });
    if (cccdVal) {
      p1.drawText(String(cccdVal), {
        x: 306.45,
        y: fitzToPdfY(272),
        size: 11,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
    }
    p1.drawText(diaChiVal, {
      x: 199.76,
      y: fitzToPdfY(320),
      size: 10,
      font: timesFont,
      color: rgb(0, 0, 0),
    });
    p1.drawText('Xã Cư Pui', {
      x: 199.76,
      y: fitzToPdfY(489),
      size: 11,
      font: timesFont,
      color: rgb(0, 0, 0),
    });

    if (rows.length === 1) {
      // === TRƯỜNG HỢP 1 THỬA ===
      const r = rows[0];
      const dienTichFormatted = String(r.dien_tich || '').replace('.', ',');
      const thoiHan = resolveThoiHan(r.loai_dat);
      const nguonGoc = r.nguon_goc || 'Khai hoang';

      p1.drawText(String(r.so_thua || ''), {
        x: 219.76,
        y: fitzToPdfY(465),
        size: 11,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(String(r.to_ban_do || ''), {
        x: 416.41,
        y: fitzToPdfY(465),
        size: 11,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(dienTichFormatted, {
        x: 187.08,
        y: fitzToPdfY(513),
        size: 11,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(String(r.loai_dat || ''), {
        x: 257.08,
        y: fitzToPdfY(538),
        size: 11,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(thoiHan, {
        x: 325.59,
        y: fitzToPdfY(562),
        size: 11,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(nguonGoc, {
        x: 265.59,
        y: fitzToPdfY(586),
        size: 11,
        font: timesFont,
        color: rgb(0, 0, 0),
      });

      // 1 thửa: Chỉ cần Trang 1 và Trang 2 từ template.pdf (Mẫu 15)
      const [pCopy1, pCopy2] = await mergedDoc.copyPages(tempDoc, [0, 1]);
      mergedDoc.addPage(pCopy1);
      mergedDoc.addPage(pCopy2);
    } else {
      // === TRƯỜNG HỢP NHIỀU THỬA ===
      const toBanDoList = Array.from(new Set(rows.map((r) => r.to_ban_do).filter(Boolean))).join(', ');
      const mucDichList = Array.from(new Set(rows.map((r) => r.loai_dat).filter(Boolean))).join(', ');
      const thoiHanList = Array.from(new Set(rows.map((r) => resolveThoiHan(r.loai_dat)).filter(Boolean))).join(', ');
      const nguonGocList = Array.from(
        new Set(rows.map((r) => r.nguon_goc || 'Khai hoang').filter(Boolean))
      ).join(', ');

      p1.drawText(`${rows.length} thửa`, {
        x: 219.76,
        y: fitzToPdfY(465),
        size: 11,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(toBanDoList, {
        x: 416.41,
        y: fitzToPdfY(465),
        size: 10,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(mucDichList, {
        x: 257.08,
        y: fitzToPdfY(538),
        size: 10,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(thoiHanList, {
        x: 325.59,
        y: fitzToPdfY(562),
        size: 10,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(nguonGocList, {
        x: 265.59,
        y: fitzToPdfY(586),
        size: 10,
        font: timesFont,
        color: rgb(0, 0, 0),
      });

      // Ghép Trang 1 và Trang 2 từ template.pdf
      const [pCopy1, pCopy2] = await mergedDoc.copyPages(tempDoc, [0, 1]);
      mergedDoc.addPage(pCopy1);
      mergedDoc.addPage(pCopy2);

      // Chia danh sách thửa thành từng nhóm 15 dòng cho Mẫu 15b (Trang 3 của template)
      const chunks: ReadyToPackItem[][] = [];
      for (let i = 0; i < rows.length; i += 15) {
        chunks.push(rows.slice(i, i + 15));
      }

      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const chunk = chunks[cIdx];
        const tableDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
        tableDoc.registerFontkit(fontkit);
        const tf = await tableDoc.embedFont(fontBoldBytes); // In đậm tất cả chữ ghi trên bảng phụ lục Mẫu 15b
        const pTable = tableDoc.getPages()[2]; // Mẫu 15b (Trang thứ 3)

        const yStart = 235 + 16.44; // 235 + pt(0.58)
        const rowSpace = 27.63; // pt(0.975)

        const drawCenter = (text: string, xCenter: number, yFit: number) => {
          if (!text) return;
          const textW = tf.widthOfTextAtSize(text, 9.5);
          pTable.drawText(text, {
            x: xCenter - textW / 2,
            y: pageH - yFit,
            size: 9.5,
            font: tf,
            color: rgb(0, 0, 0),
          });
        };

        chunk.forEach((row, rIdx) => {
          const curY = yStart + rIdx * rowSpace;
          const dt = String(row.dien_tich || '').replace('.', ',');
          drawCenter(String(row.so_thua || ''), 131.16, curY);
          drawCenter(String(row.to_ban_do || ''), 180.86, curY);
          drawCenter(dt, 300.92, curY);
          drawCenter(String(row.loai_dat || ''), 369.78, curY);
          drawCenter(resolveThoiHan(row.loai_dat), 439.54, curY);
          drawCenter(row.nguon_goc || 'Khai hoang', 538.54, curY);
        });

        const [pTableCopy] = await mergedDoc.copyPages(tableDoc, [2]);
        mergedDoc.addPage(pTableCopy);
      }

      // Trang trắng phía sau tập nhiều thửa
      mergedDoc.addPage([595.28, 841.89]);
    }

    processedCount++;
  }

  onProgress?.(totalSets, totalSets, 'Đang đóng gói và hoàn tất file PDF...');

  const pdfBytes = await mergedDoc.save();
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `Tap_Ho_So_In_Co_Trang_CCCD_${totalSets}_chuho_${items.length}_thua_${dateStr}.pdf`;

  return { pdfBytes, fileName, totalSets };
}

export function downloadPdfBlob(bytes: Uint8Array, fileName: string): string {
  const blob = new Blob([bytes as any], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return url;
}
