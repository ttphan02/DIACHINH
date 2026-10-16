import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export interface ReadyToPackItem {
  ma_thua: string;
  to_ban_do: string;
  so_thua: string;
  thon_xa: string;
  dia_chi?: string | null;
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

function cleanNameKey(name?: string, cccd?: string): string {
  const c = cccd ? String(cccd).replace(/\D/g, '').trim() : '';
  if (c && c.length >= 9) {
    return `cccd_${c}`;
  }
  if (!name) return 'khong_ten';
  return (
    'name_' +
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^(hộ ông|hộ bà|ông|bà)\s*:?/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim()
  );
}

function cleanOwnerNameDisplay(name?: string): string {
  if (!name) return '';
  return name.replace(/^(hộ ông|hộ bà|ông|bà)\s*:?/i, '').trim();
}

export function cleanDisplayAddress(rawAddr?: string): string {
  if (!rawAddr || !rawAddr.trim()) return 'Xã Cư Pui';
  let addr = rawAddr.trim().replace(/,\s*$/, '');

  if (/^(x[ãa]\s*)?c[uư]\s*pui$/i.test(addr)) return 'Xã Cư Pui';

  addr = addr.replace(/([,\s]+x[ãa]\s*c[uư]\s*pui)+$/i, '');
  addr = addr.replace(/([,\s]+c[uư]\s*pui)+$/i, '');
  addr = addr.trim().replace(/,\s*$/, '');

  if (!addr || /^(x[ãa]\s*)?c[uư]\s*pui$/i.test(addr)) return 'Xã Cư Pui';
  return `${addr}, xã Cư Pui`;
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

  // Tải mẫu template.pdf và fonts (Times New Roman Bold cho Mẫu 15, Calibri Bold cho Mẫu 15b y hệt PDF_Web_App)
  const [templateBytes, fontCalibriBoldBytes, fontTimesBoldBytes] = await Promise.all([
    loadBuffer('/template.pdf'),
    loadBuffer('/fonts/calibrib.ttf'),
    loadBuffer('/fonts/timesbd.ttf'),
  ]);

  // Gom nhóm các thửa theo Chủ hộ / CCCD
  const grouped: Record<string, { ownerDisplayName: string; rows: ReadyToPackItem[] }> = {};
  items.forEach((it) => {
    const rawName = String(it.chu_ho || '').trim();
    const cleanKey = cleanNameKey(rawName, it.cccd || undefined);
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

  const mergedDoc = await PDFDocument.create();
  mergedDoc.registerFontkit(fontkit);

  // Chuẩn kích thước toàn bộ các trang: Khổ đứng A4/Letter 612 x 792 pt (khớp 100% template.pdf)
  const PAGE_W = 612.0;
  const PAGE_H = 792.0;

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
    // BƯỚC 1: TRANG 1 - BÌA CCCD KHỔ ĐỨNG (612 x 792 pt)
    // Tự động scale vừa trọn chiều ngang 612 pt, căn giữa trang, bù trắng trên/dưới
    // ========================================================
    let cccdInserted = false;
    const cccdFileName = firstRow.cccd_file || (firstRow.cccd ? `${firstRow.cccd}.pdf` : '');

    const possibleUrls: string[] = [];
    if (firstRow.cccd_url) possibleUrls.push(firstRow.cccd_url);
    if (cccdFileName) {
      if (cccdFileName.startsWith('http')) {
        possibleUrls.push(cccdFileName);
      } else {
        possibleUrls.push(`/api/image/cccd/${encodeURIComponent(cccdFileName)}`);
        possibleUrls.push(`https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/cccd/${encodeURIComponent(cccdFileName)}`);
      }
    }

    if (firstRow.cccd) {
      const c = String(firstRow.cccd).trim();
      for (const ext of ['.pdf', '.jpg', '.jpeg', '.png']) {
        possibleUrls.push(`/api/image/cccd/${encodeURIComponent(c + ext)}`);
        possibleUrls.push(`https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/cccd/${encodeURIComponent(c + ext)}`);
      }
    }

    const targetCodes = [firstRow.ma_thua, ...rows.map((r) => r.ma_thua)].filter(Boolean);
    for (const code of Array.from(new Set(targetCodes))) {
      for (const ext of ['.jpg', '.jpeg', '.pdf', '.png']) {
        possibleUrls.push(`/api/image/cccd/${encodeURIComponent(code + ext)}`);
        possibleUrls.push(`https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/cccd/${encodeURIComponent(code + ext)}`);
      }
    }

    for (const url of possibleUrls) {
      try {
        const cccdRes = await fetch(url);
        if (cccdRes.ok) {
          const cccdBuf = await cccdRes.arrayBuffer();
          const header = new Uint8Array(cccdBuf.slice(0, 4));
          const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF

          if (isPdf) {
            const cccdDoc = await PDFDocument.load(cccdBuf, { ignoreEncryption: true });
            const pageIndices = cccdDoc.getPageIndices();
            if (pageIndices.length > 0) {
              const srcPage = cccdDoc.getPages()[0];
              const embedded = await mergedDoc.embedPage(srcPage);
              const cccdPage = mergedDoc.addPage([PAGE_W, PAGE_H]);
              const imgW = embedded.width;
              const imgH = embedded.height;

              // Tính toán: Chiều ngang tối đa (612 pt), chiều dài thiếu thì bù trắng trên/dưới
              let scale = PAGE_W / imgW;
              let scaledH = imgH * scale;
              if (scaledH > PAGE_H) {
                scale = PAGE_H / imgH;
                const scaledW = imgW * scale;
                const x0 = (PAGE_W - scaledW) / 2.0;
                cccdPage.drawPage(embedded, {
                  x: x0,
                  y: 0,
                  width: scaledW,
                  height: PAGE_H,
                });
              } else {
                const y0 = (PAGE_H - scaledH) / 2.0;
                cccdPage.drawPage(embedded, {
                  x: 0,
                  y: y0,
                  width: PAGE_W,
                  height: scaledH,
                });
              }

              cccdInserted = true;
              break;
            }
          } else {
            // Ảnh JPG / PNG
            let embeddedImg: any = null;
            try {
              embeddedImg = await mergedDoc.embedJpg(cccdBuf);
            } catch {
              try {
                embeddedImg = await mergedDoc.embedPng(cccdBuf);
              } catch (imgErr) {
                console.warn('Không thể parse dữ liệu ảnh CCCD:', imgErr);
              }
            }

            if (embeddedImg) {
              const cccdPage = mergedDoc.addPage([PAGE_W, PAGE_H]);
              const imgW = embeddedImg.width;
              const imgH = embeddedImg.height;

              let scale = PAGE_W / imgW;
              let scaledH = imgH * scale;
              if (scaledH > PAGE_H) {
                scale = PAGE_H / imgH;
                const scaledW = imgW * scale;
                const x0 = (PAGE_W - scaledW) / 2.0;
                cccdPage.drawImage(embeddedImg, {
                  x: x0,
                  y: 0,
                  width: scaledW,
                  height: PAGE_H,
                });
              } else {
                const y0 = (PAGE_H - scaledH) / 2.0;
                cccdPage.drawImage(embeddedImg, {
                  x: 0,
                  y: y0,
                  width: PAGE_W,
                  height: scaledH,
                });
              }

              cccdInserted = true;
              break;
            }
          }
        }
      } catch (err) {
        console.warn(`Không thể nạp CCCD từ ${url}:`, err);
      }
    }

    if (!cccdInserted) {
      // Nếu không tìm thấy tệp CCCD: Trang bìa trống có viền đứt nét chuẩn PDF_Web_App
      const blankPage = mergedDoc.addPage([PAGE_W, PAGE_H]);
      const timesFont = await mergedDoc.embedFont(fontTimesBoldBytes);
      const title = `BẢN SAO CĂN CƯỚC CÔNG DÂN: ${ownerDisplayName.toUpperCase()}`;
      const titleW = timesFont.widthOfTextAtSize(title, 13);
      blankPage.drawText(title, {
        x: Math.max(36, (PAGE_W - titleW) / 2),
        y: 650,
        size: 13,
        font: timesFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      const sub = `[ VỊ TRÍ ĐÍNH KÈM BẢN SAO CĂN CƯỚC CÔNG DÂN ]`;
      const subW = timesFont.widthOfTextAtSize(sub, 11);
      blankPage.drawText(sub, {
        x: Math.max(36, (PAGE_W - subW) / 2),
        y: 400,
        size: 11,
        font: timesFont,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    // Trang 2: Trang trắng phía sau CCCD (chuẩn in ấn 2 mặt tách biệt bìa CCCD y hệt PDF_Web_App)
    mergedDoc.addPage([PAGE_W, PAGE_H]);

    // ========================================================
    // BƯỚC 2: KIỂM TRA CÓ GCN HAY KHÔNG
    // ========================================================
    const hasGcn = Boolean(firstRow.has_gcn) || (firstRow.gcn_urls && firstRow.gcn_urls.length > 0);
    if (hasGcn && firstRow.gcn_urls && firstRow.gcn_urls.length > 0) {
      for (const gcnUrl of firstRow.gcn_urls) {
        try {
          const gcnRes = await fetch(gcnUrl);
          if (gcnRes.ok) {
            const gcnBuf = await gcnRes.arrayBuffer();
            const header = new Uint8Array(gcnBuf.slice(0, 4));
            const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
            if (isPdf) {
              const gcnDoc = await PDFDocument.load(gcnBuf, { ignoreEncryption: true });
              for (const p of gcnDoc.getPages()) {
                const emb = await mergedDoc.embedPage(p);
                const gPage = mergedDoc.addPage([PAGE_W, PAGE_H]);
                gPage.drawPage(emb, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
              }
            } else {
              let embeddedImg;
              try {
                embeddedImg = await mergedDoc.embedJpg(gcnBuf);
              } catch {
                embeddedImg = await mergedDoc.embedPng(gcnBuf);
              }
              if (embeddedImg) {
                const gcnPage = mergedDoc.addPage([PAGE_W, PAGE_H]);
                const scaled = embeddedImg.scaleToFit(PAGE_W - 72, PAGE_H - 72);
                gcnPage.drawImage(embeddedImg, {
                  x: (PAGE_W - scaled.width) / 2,
                  y: (PAGE_H - scaled.height) / 2,
                  width: scaled.width,
                  height: scaled.height,
                });
              }
            }
          }
        } catch (e) {
          console.warn('Lỗi ghép GCN:', e);
        }
      }
      continue;
    }

    // ========================================================
    // BƯỚC 3: KHÔNG CÓ GCN -> ĐIỀN ĐƠN VÀO TEMPLATE.PDF (MẪU 15 & MẪU 15B)
    // Khớp 100% tọa độ và logic của PDF_Web_App
    // ========================================================
    const tempDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    tempDoc.registerFontkit(fontkit);
    const timesFont = await tempDoc.embedFont(fontTimesBoldBytes);

    const p1 = tempDoc.getPages()[0];
    const pageH = p1.getHeight();

    // Tọa độ chuẩn khớp 100% với PDF_Web_App:
    // y_off = -pt(0.15) = -4.2519
    const yOff = -4.25;
    const fitzToPdfY = (yFitz: number) => pageH - (yFitz + yOff);

    const x_hoten = 209.76;
    const x_cccd = 306.45;
    const x_dc4 = 199.76;
    const x_thuaso = 219.76;
    const x_tbd = 416.42;
    const x_dc5 = 199.76;
    const x_dt = 187.09;
    const x_md = 257.09;
    const x_thoihan = 325.59;
    const x_nguongoc = 265.59;

    const cccdVal = firstRow.cccd || '';
    const diaChiVal = cleanDisplayAddress(firstRow.dia_chi || firstRow.thon_xa || '');

    // Mục 1: Họ tên, CCCD, Địa chỉ chung
    p1.drawText(ownerDisplayName, {
      x: x_hoten,
      y: fitzToPdfY(248),
      size: 12,
      font: timesFont,
      color: rgb(0, 0, 0),
    });
    if (cccdVal) {
      p1.drawText(String(cccdVal), {
        x: x_cccd,
        y: fitzToPdfY(272),
        size: 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
    }
    p1.drawText(diaChiVal, {
      x: x_dc4,
      y: fitzToPdfY(320),
      size: diaChiVal.length > 35 ? 10.5 : 12,
      font: timesFont,
      color: rgb(0, 0, 0),
    });
    p1.drawText('Xã Cư Pui', {
      x: x_dc5,
      y: fitzToPdfY(489),
      size: 12,
      font: timesFont,
      color: rgb(0, 0, 0),
    });

    if (rows.length === 1) {
      // === TRƯỜNG HỢP 1 THỬA (Chỉ cần 2 trang đầu Mẫu 15) ===
      const r = rows[0];
      let dienTichFormatted = String(r.dien_tich || '').trim().replace('.', ',');
      if (dienTichFormatted.includes(',')) {
        const parts = dienTichFormatted.split(',');
        dienTichFormatted = `${parts[0]},${parts[1].slice(0, 1)}`;
      }
      const thoiHan = resolveThoiHan(r.loai_dat);
      const nguonGoc = (r.nguon_goc || 'Khai hoang').trim();

      p1.drawText(String(r.so_thua || ''), {
        x: x_thuaso,
        y: fitzToPdfY(465),
        size: 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(String(r.to_ban_do || ''), {
        x: x_tbd,
        y: fitzToPdfY(465),
        size: 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(dienTichFormatted, {
        x: x_dt,
        y: fitzToPdfY(513),
        size: 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(String(r.loai_dat || ''), {
        x: x_md,
        y: fitzToPdfY(538),
        size: 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(thoiHan, {
        x: x_thoihan,
        y: fitzToPdfY(562),
        size: 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });
      p1.drawText(nguonGoc, {
        x: x_nguongoc,
        y: fitzToPdfY(586),
        size: 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });

      // 1 thửa: KHÔNG CẦN TỜ 2 (MẪU 15b) -> CHỈ CẦN 2 TRANG ĐẦU CỦA TEMPLATE.PDF (MẪU 15 TRANG 1 & TRANG 2)
      const [pCopy1, pCopy2] = await mergedDoc.copyPages(tempDoc, [0, 1]);
      mergedDoc.addPage(pCopy1);
      mergedDoc.addPage(pCopy2);
    } else {
      // === TRƯỜNG HỢP NHIỀU THỬA ===
      const toBanDoList = Array.from(new Set(rows.map((r) => r.to_ban_do).filter(Boolean)));
      const mucDichList = Array.from(new Set(rows.map((r) => r.loai_dat).filter(Boolean)));
      const thoiHanList = Array.from(new Set(rows.map((r) => resolveThoiHan(r.loai_dat)).filter(Boolean)));
      const nguonGocList = Array.from(
        new Set(rows.map((r) => (r.nguon_goc || 'Khai hoang').trim()).filter(Boolean))
      );

      const countText = `${String(rows.length).padStart(2, '0')} thửa`;
      p1.drawText(countText, {
        x: x_thuaso,
        y: fitzToPdfY(465),
        size: 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });

      const toBanDoText = toBanDoList.join(', ');
      p1.drawText(toBanDoText, {
        x: x_tbd,
        y: fitzToPdfY(465),
        size: toBanDoText.length > 25 ? 10 : 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });

      const mucDichText = mucDichList.join(', ');
      p1.drawText(mucDichText, {
        x: x_md,
        y: fitzToPdfY(538),
        size: mucDichText.length > 25 ? 10 : 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });

      const thoiHanText = thoiHanList.join(', ');
      p1.drawText(thoiHanText, {
        x: x_thoihan,
        y: fitzToPdfY(562),
        size: thoiHanText.length > 25 ? 10 : 12,
        font: timesFont,
        color: rgb(0, 0, 0),
      });

      const nguonGocText = nguonGocList.join(', ');
      p1.drawText(nguonGocText, {
        x: x_nguongoc,
        y: fitzToPdfY(586),
        size: nguonGocText.length > 25 ? 10 : 12,
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
        const calibriBoldFont = await tableDoc.embedFont(fontCalibriBoldBytes);
        const pTable = tableDoc.getPages()[2]; // Mẫu 15b (Trang thứ 3)

        const yStart = 235 + 16.44; // 235 + pt(0.58) = 251.44
        const rowSpace = 27.637; // pt(0.975)

        const drawCenter = (text: string, xCenter: number, yFit: number) => {
          if (!text) return;
          const textW = calibriBoldFont.widthOfTextAtSize(text, 10);
          pTable.drawText(text, {
            x: xCenter - textW / 2,
            y: pageH - yFit,
            size: 10,
            font: calibriBoldFont,
            color: rgb(0, 0, 0),
          });
        };

        chunk.forEach((row, rIdx) => {
          const curY = yStart + rIdx * rowSpace;
          let dt = String(row.dien_tich || '').trim().replace('.', ',');
          if (dt.includes(',')) {
            const parts = dt.split(',');
            dt = `${parts[0]},${parts[1].slice(0, 1)}`;
          }
          drawCenter(String(row.so_thua || ''), 131.16, curY);
          drawCenter(String(row.to_ban_do || ''), 180.86, curY);
          drawCenter(dt, 300.92, curY);
          drawCenter(String(row.loai_dat || ''), 369.78, curY);
          drawCenter(resolveThoiHan(row.loai_dat), 439.54, curY);
          drawCenter(String(row.nguon_goc || 'Khai hoang').trim(), 538.54, curY);
        });

        const [pTableCopy] = await mergedDoc.copyPages(tableDoc, [2]);
        mergedDoc.addPage(pTableCopy);
      }

      // Trang 5: TRANG TRỐNG HOÀN TOÀN KHÔNG CÓ CHỮ GÌ (khớp 100% PDF_Web_App)
      mergedDoc.addPage([PAGE_W, PAGE_H]);
    }
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
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
  return url;
}
