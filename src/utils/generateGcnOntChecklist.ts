import JSZip from 'jszip';

export interface GcnOntItem {
  maThua: string;
  to: string;
  thua: string;
  thon: string;
  ten: string;
  cccd: string;
  dt: string;
  loaiDat: string;
  hasCccd: boolean;
}

export interface GeneratedGcnOntPage {
  fileName: string;
  village: string;
  pageNum: number;
  totalPages: number;
  count: number;
  dataUrl: string;
  blob: Blob;
}

export function cleanVillageName(raw: any): string {
  if (!raw) return 'Chưa rõ thôn';
  let s = String(raw).trim();
  s = s.replace(/,\s*xã\s*Cư\s*Pui/i, '').trim();
  if (s.toLowerCase() === 'xã cư pui' || !s) return 'Chưa rõ thôn';
  return s;
}

export function cleanCccd(s: any): string {
  if (!s) return '';
  const digits = String(s).replace(/\D/g, '');
  return digits.length === 12 ? digits : '';
}

export function sanitizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');
}

// Hàm vẽ đường bo góc (rounded rect) cho Canvas
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill?: string,
  stroke?: string,
  lineWidth?: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  }
}

// Vẽ 1 trang 9:16 (1080 × 1920)
function renderPageToCanvas(
  villageTitle: string,
  pageNum: number,
  totalPages: number,
  items: GcnOntItem[]
): Promise<{ dataUrl: string; blob: Blob }> {
  return new Promise((resolve, reject) => {
    try {
      const width = 1080;
      const height = 1920;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Cannot get 2D context'));
        return;
      }

      // 1. Nền trắng
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // 2. Header
      // Tiêu đề chính
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1e3a8a';
      ctx.font = 'bold 54px Grandview, "Segoe UI", sans-serif';
      ctx.fillText('THU THẬP CCCD & GCN', width / 2, 54);

      // Subtitle: Thôn • Trang • Note
      ctx.fillStyle = '#0369a1';
      ctx.font = 'bold 24px Grandview, "Segoe UI", sans-serif';
      const subText = `${villageTitle.toUpperCase()} • Trang ${pageNum}/${totalPages} • note: GCN - giấy chứng nhận sử dụng đất(sổ đỏ)`;
      ctx.fillText(subText, width / 2, 98);

      // 3. Khung bảng (Bảng 6 cột)
      const tableX = 18;
      const tableY = 125;
      const tableW = 1044;
      const tableH = 1765;
      const colNameW = 366;
      const colTickW = 78;
      const leftW = colNameW + colTickW * 2; // 522px
      const midDividerX = tableX + leftW; // 18 + 522 = 540

      // Vẽ nền bảng
      drawRoundedRect(ctx, tableX, tableY, tableW, tableH, 14, '#ffffff', '#0f172a', 3);

      // Header bảng
      const theadH = 65;
      ctx.save();
      // Clip bo góc trên của bảng
      ctx.beginPath();
      ctx.moveTo(tableX + 14, tableY);
      ctx.lineTo(tableX + tableW - 14, tableY);
      ctx.quadraticCurveTo(tableX + tableW, tableY, tableX + tableW, tableY + 14);
      ctx.lineTo(tableX + tableW, tableY + theadH);
      ctx.lineTo(tableX, tableY + theadH);
      ctx.lineTo(tableX, tableY + 14);
      ctx.quadraticCurveTo(tableX, tableY, tableX + 14, tableY);
      ctx.closePath();
      ctx.fillStyle = '#1e3a8a';
      ctx.fill();
      ctx.restore();

      // Tiêu đề 6 cột
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px Grandview, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const theadTextY = tableY + theadH / 2;

      // Cột 1: TÊN (Trái)
      ctx.fillText('TÊN', tableX + colNameW / 2, theadTextY);

      // Cột 2 & 3: CCCD & GCN (Trái)
      ctx.font = 'bold 21px Grandview, "Segoe UI", sans-serif';
      ctx.fillText('CCCD', tableX + colNameW + colTickW / 2, theadTextY);
      ctx.fillText('GCN', tableX + colNameW + colTickW + colTickW / 2, theadTextY);

      // Cột 4: TÊN (Phải)
      ctx.font = 'bold 28px Grandview, "Segoe UI", sans-serif';
      ctx.fillText('TÊN', midDividerX + colNameW / 2, theadTextY);

      // Cột 5 & 6: CCCD & GCN (Phải)
      ctx.font = 'bold 21px Grandview, "Segoe UI", sans-serif';
      ctx.fillText('CCCD', midDividerX + colNameW + colTickW / 2, theadTextY);
      ctx.fillText('GCN', midDividerX + colNameW + colTickW + colTickW / 2, theadTextY);

      // Đường kẻ dọc thead
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1.5;
      [
        tableX + colNameW,
        tableX + colNameW + colTickW,
        midDividerX + colNameW,
        midDividerX + colNameW + colTickW,
      ].forEach((xPos) => {
        ctx.beginPath();
        ctx.moveTo(xPos, tableY);
        ctx.lineTo(xPos, tableY + theadH);
        ctx.stroke();
      });

      // 4. Chia dữ liệu thành 2 cột: Left & Right
      const half = Math.ceil(items.length / 2);
      const leftCol = items.slice(0, half);
      const rightCol = items.slice(half);

      const maxRows = 16;
      const rowH = (tableH - theadH) / maxRows; // ~106px

      for (let i = 0; i < maxRows; i++) {
        const rowY = tableY + theadH + i * rowH;
        const isEven = i % 2 === 1;

        // Nền xen kẽ
        if (isEven) {
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(tableX + 2, rowY, tableW - 4, rowH);
        }

        // Đường kẻ ngang dưới mỗi hàng
        if (i < maxRows - 1) {
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(tableX, rowY + rowH);
          ctx.lineTo(tableX + tableW, rowY + rowH);
          ctx.stroke();
        }

        // Đường kẻ dọc các cột
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
        [
          tableX + colNameW,
          tableX + colNameW + colTickW,
          midDividerX + colNameW,
          midDividerX + colNameW + colTickW,
        ].forEach((xPos) => {
          ctx.beginPath();
          ctx.moveTo(xPos, rowY);
          ctx.lineTo(xPos, rowY + rowH);
          ctx.stroke();
        });

        // Vẽ phần tử Cột Trái (Left)
        if (i < leftCol.length) {
          const l = leftCol[i];
          const stt = i + 1;
          renderRowContent(
            ctx,
            tableX,
            rowY,
            colNameW,
            colTickW,
            rowH,
            stt,
            l.ten,
            l.hasCccd
          );
        }

        // Vẽ phần tử Cột Phải (Right)
        if (i < rightCol.length) {
          const r = rightCol[i];
          const stt = half + i + 1;
          renderRowContent(
            ctx,
            midDividerX,
            rowY,
            colNameW,
            colTickW,
            rowH,
            stt,
            r.ten,
            r.hasCccd
          );
        }
      }

      // Đường kẻ dọc giữa phân tách 2 cột (màu cam hổ phách đậm 5px)
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(midDividerX, tableY);
      ctx.lineTo(midDividerX, tableY + tableH);
      ctx.stroke();

      // Viền bao ngoài bảng
      drawRoundedRect(ctx, tableX, tableY, tableW, tableH, 14, undefined, '#0f172a', 3);

      // Chuyển thành DataURL và Blob
      const dataUrl = canvas.toDataURL('image/png');
      canvas.toBlob((blob) => {
        if (blob) {
          resolve({ dataUrl, blob });
        } else {
          reject(new Error('Canvas toBlob failed'));
        }
      }, 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

// Hàm vẽ nội dung của 1 ô (STT + Tên + 2 ô Tick CCCD & GCN)
function renderRowContent(
  ctx: CanvasRenderingContext2D,
  startX: number,
  rowY: number,
  colNameW: number,
  colTickW: number,
  rowH: number,
  stt: number,
  ten: string,
  hasCccd: boolean
) {
  const midY = rowY + rowH / 2;

  // 1. STT
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 27px Grandview, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const sttStr = `${stt}.`;
  ctx.fillText(sttStr, startX + 12, midY);

  // Đo độ rộng STT
  const sttW = ctx.measureText(sttStr).width;

  // 2. Tên chủ đất (31px bold đen tuyền)
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 31px Grandview, "Segoe UI", sans-serif';
  const nameX = startX + 16 + sttW;
  const maxNameW = colNameW - (16 + sttW) - 8;

  // Kiểm tra nếu tên dài cần xuống hàng
  const nameWidth = ctx.measureText(ten).width;
  if (nameWidth > maxNameW && ten.includes(' ')) {
    // Tách 2 dòng
    const words = ten.split(' ');
    let line1 = '';
    let line2 = '';
    for (const w of words) {
      if (ctx.measureText(line1 + (line1 ? ' ' : '') + w).width < maxNameW) {
        line1 += (line1 ? ' ' : '') + w;
      } else {
        line2 += (line2 ? ' ' : '') + w;
      }
    }
    ctx.fillText(line1, nameX, midY - 18);
    ctx.fillText(line2, nameX, midY + 18);
  } else {
    ctx.fillText(ten, nameX, midY);
  }

  // 3. Ô tick CCCD (52 × 52 px)
  const boxSize = 52;
  const cccdBoxX = startX + colNameW + (colTickW - boxSize) / 2;
  const boxY = midY - boxSize / 2;

  if (hasCccd) {
    // Đã có CCCD: nền xanh nhạt, viền xanh lá, dấu tick đậm
    drawRoundedRect(ctx, cccdBoxX, boxY, boxSize, boxSize, 10, '#ecfdf5', '#059669', 3.5);

    // Vẽ dấu tick ✓
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cccdBoxX + 12, boxY + 27);
    ctx.lineTo(cccdBoxX + 22, boxY + 38);
    ctx.lineTo(cccdBoxX + 41, boxY + 14);
    ctx.stroke();
  } else {
    // Chưa có: ô vuông trắng viền xám đậm để cán bộ tick
    drawRoundedRect(ctx, cccdBoxX, boxY, boxSize, boxSize, 10, '#ffffff', '#334155', 3.5);
  }

  // 4. Ô tick GCN (52 × 52 px): Luôn là ô trống trắng để thu thập
  const gcnBoxX = startX + colNameW + colTickW + (colTickW - boxSize) / 2;
  drawRoundedRect(ctx, gcnBoxX, boxY, boxSize, boxSize, 10, '#ffffff', '#334155', 3.5);
}

// Hàm tạo toàn bộ ảnh danh sách GCN - ONT từ các thửa được chọn
export async function generateGcnOntChecklist(
  items: GcnOntItem[]
): Promise<GeneratedGcnOntPage[]> {
  // 1. Nhóm theo thôn buôn
  const villageMap = new Map<string, GcnOntItem[]>();
  for (const it of items) {
    const v = cleanVillageName(it.thon);
    if (!villageMap.has(v)) villageMap.set(v, []);
    villageMap.get(v)!.push(it);
  }

  const generatedPages: GeneratedGcnOntPage[] = [];
  const PAGE_CAPACITY = 32;

  for (const [village, vItems] of villageMap.entries()) {
    // Sắp xếp theo tờ và số thửa
    vItems.sort((a, b) => {
      const toA = parseInt(a.to, 10) || 0;
      const toB = parseInt(b.to, 10) || 0;
      if (toA !== toB) return toA - toB;
      const thuaA = parseInt(a.thua, 10) || 0;
      const thuaB = parseInt(b.thua, 10) || 0;
      return thuaA - thuaB;
    });

    const totalPages = Math.ceil(vItems.length / PAGE_CAPACITY);

    for (let p = 0; p < totalPages; p++) {
      const pageItems = vItems.slice(p * PAGE_CAPACITY, (p + 1) * PAGE_CAPACITY);
      const pageNum = p + 1;

      const { dataUrl, blob } = await renderPageToCanvas(village, pageNum, totalPages, pageItems);
      const safeVillage = sanitizeFileName(village);
      const fileName = `${safeVillage}_Trang_${pageNum}_cua_${totalPages}.png`;

      generatedPages.push({
        fileName,
        village,
        pageNum,
        totalPages,
        count: pageItems.length,
        dataUrl,
        blob,
      });
    }
  }

  return generatedPages;
}

// Hàm tải toàn bộ ảnh dưới dạng file ZIP
export async function downloadGcnOntZip(pages: GeneratedGcnOntPage[]) {
  const zip = new JSZip();
  pages.forEach((p) => {
    zip.file(p.fileName, p.blob);
  });
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'DS_Thu_Thap_CCCD_GCN_ONT_9x16.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
