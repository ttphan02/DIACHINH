// OCR & Extract 12 Coordinate-based Text Extraction Service

let isTesseractLoading = false;
async function ensureTesseractLoaded() {
  if (typeof Tesseract !== 'undefined') return true;
  if (isTesseractLoading) {
    while (isTesseractLoading && typeof Tesseract === 'undefined') {
      await new Promise(r => setTimeout(r, 100));
    }
    return typeof Tesseract !== 'undefined';
  }
  isTesseractLoading = true;
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Không thể tải Tesseract.js'));
      document.head.appendChild(s);
    });
    return true;
  } catch (e) {
    console.warn('Lazy load Tesseract error:', e);
    return false;
  } finally {
    isTesseractLoading = false;
  }
}

// --- Fast Native PDF Text Extraction (Page 1 Coordinate Target) & Auto Sheet Processing ---
async function extractCCCDFromPage(pageNum) {
  if (!currentPdfDoc) return '';
  try {
    let targetDoc = currentPdfDoc;
    let targetPageNumInDoc = pageNum;
    if (replacedPagesMap.has(pageNum)) {
      const rep = replacedPagesMap.get(pageNum);
      targetDoc = rep.pdfjsDoc;
      targetPageNumInDoc = 1;
    }
    const page = await targetDoc.getPage(targetPageNumInDoc);
    const textContent = await page.getTextContent();
    const items = textContent.items || [];
    const viewport = page.getViewport({ scale: 1.0 });
    const pageHeight = viewport.height || 841.89;

    // Helper: convert cm to PDF points (1 inch = 2.54 cm = 72 pt)
    const cmToPt = (cm) => cm * (72 / 2.54);

    // Target coordinates (from top of page):
    // X = 220 + pt(3.05) ≈ 306.46 pt
    // Y_top = 272 - pt(0.15) ≈ 267.75 pt from TOP
    // In PDF bottom-up coordinate space: Y_pdf = pageHeight - Y_top ≈ 574 pt
    const targetX = 220 + cmToPt(3.05);
    const targetYFromTop = 272 - cmToPt(0.15);
    const targetYFromBottom = pageHeight - targetYFromTop;

    // Strict Y-band bounding around CCCD line (targetY ± 85pt) to exclude lower page numbers
    const minYBottom = targetYFromBottom - 85;
    const maxYBottom = targetYFromBottom + 85;

    // 1. Proximity matching strictly WITHIN the target CCCD line Y-band
    let candidates = [];
    items.forEach(item => {
      if (!item || !item.str) return;
      const transform = item.transform;
      if (!transform || transform.length < 6) return;

      const itemX = transform[4];
      const itemY = transform[5]; // PDF Y coordinate from bottom

      // Exclude text items outside the CCCD line zone
      if (itemY < minYBottom || itemY > maxYBottom) return;

      const textStr = item.str.trim();
      const digitsMatch = textStr.match(/\b\d{12}\b/) || textStr.replace(/\D/g, '').match(/\d{12}/);
      if (digitsMatch) {
        const distX = Math.abs(itemX - targetX);
        const distY = Math.abs(itemY - targetYFromBottom);
        const dist = Math.sqrt(distX * distX + distY * distY);
        candidates.push({ code: digitsMatch[0], dist: dist });
      }
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.dist - b.dist);
      return candidates[0].code;
    }

    // 2. Secondary search inside items strictly within the CCCD line Y-band
    const lineZoneItems = items.filter(item => {
      if (!item || !item.transform || item.transform.length < 6) return false;
      const itemY = item.transform[5];
      return itemY >= minYBottom && itemY <= maxYBottom;
    });

    if (lineZoneItems.length > 0) {
      const rawItems = lineZoneItems.map(i => i.str || '');
      const rawTextWithSpaces = rawItems.join(' ');
      const rawTextJoined = rawItems.join('');

      let match = rawTextWithSpaces.match(/\b\d{12}\b/) || rawTextWithSpaces.match(/\d{12}/);
      if (!match) match = rawTextJoined.match(/\d{12}/);
      if (!match) {
        const cleanDigits = rawTextWithSpaces.replace(/\D/g, '');
        if (cleanDigits.length === 12) match = [cleanDigits];
      }
      if (match && match[0]) return match[0];
    }

    // 3. Fallback: Automatic Local Browser OCR on Cropped CCCD Region
    const localCode = await extractCCCDWithLocalOCR(pageNum);
    return localCode || '';

  } catch (err) {
    console.warn(`Lỗi trích xuất chữ trang ${pageNum}:`, err);
    return '';
  }
}

async function extractCCCDWithLocalOCR(pageNum) {
  if (!currentPdfDoc) return '';

  try {
    const page = await currentPdfDoc.getPage(pageNum);
    const userRotation = pageRotationMap.get(pageNum) || 0;
    const totalRotation = (page.rotate + userRotation) % 360;

    // Độ phân giải cao (scale 4.0 tương đương 400 DPI gốc)
    const scale = 4.0;
    const viewport = page.getViewport({ scale: scale, rotation: totalRotation });

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = viewport.width;
    fullCanvas.height = viewport.height;
    const fullCtx = fullCanvas.getContext('2d', { alpha: false });
    fullCtx.fillStyle = '#ffffff';
    fullCtx.fillRect(0, 0, fullCanvas.width, fullCanvas.height);
    await page.render({ canvasContext: fullCtx, viewport }).promise;

    // Vùng chứa CCCD chuẩn xác (X: 44% -> 66%, Y: 28% -> 35%)
    const cropX = Math.floor(viewport.width * 0.44);
    const cropY = Math.floor(viewport.height * 0.28);
    const cropW = Math.floor(viewport.width * 0.22);
    const cropH = Math.floor(viewport.height * 0.07);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d', { alpha: false });
    cropCtx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const dataUrl = cropCanvas.toDataURL('image/png');

    // 1. Ưu tiên máy chủ cục bộ /api/extract12 (Tự động khử nghiêng Deskew + CLAHE + EasyOCR)
    try {
      const response = await fetch('/api/extract12', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.code && /^\d{12}$/.test(data.code)) {
          console.log(`[FastAPI OCR] Đã trích xuất chính xác 12 số CCCD: ${data.code} (Góc nắn: ${data.skew_angle}°)`);
          return data.code;
        }
      }
    } catch (apiErr) {
      console.warn('Backend API /api/extract12 không phản hồi, thử giải pháp tiếp theo:', apiErr);
    }

    // 2. Dự phòng AI Gemini Vision nếu có cài đặt API key
    if (typeof callGeminiApiForCCCD === 'function') {
      try {
        const b64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
        const aiCode = await callGeminiApiForCCCD(b64);
        if (aiCode && /^\d{12}$/.test(aiCode)) {
          console.log(`[Gemini Vision] Đã trích xuất thành công 12 số CCCD: ${aiCode}`);
          return aiCode;
        }
      } catch (aiErr) {
        console.warn('Gemini Vision AI fallback error:', aiErr);
      }
    }

    // 3. Dự phòng Tesseract.js chạy trong trình duyệt trên vùng CCCD xén hẹp chuẩn
    const isLoaded = await ensureTesseractLoaded();
    if (isLoaded && typeof Tesseract !== 'undefined') {
      const worker = await Tesseract.createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789'
      });
      const ret = await worker.recognize(cropCanvas);
      await worker.terminate();

      const rawText = ret?.data?.text || '';
      const match = rawText.match(/\b\d{12}\b/) || rawText.replace(/\D/g, '').match(/\d{12}/);
      if (match && match[0] && match[0].startsWith('066')) {
        return match[0];
      }
    }

    return '';
  } catch (err) {
    console.warn(`Lỗi OCR local trang ${pageNum}:`, err);
    return '';
  }
}

async function autoProcessGroupCCCDAndSheet(group) {
  if (!group || !group.pageNumbers || group.pageNumbers.length === 0) return;
  
  const card = document.querySelector(`.group-card-item[data-group-id="${group.id}"]`);
  const idInput = card ? card.querySelector('.group-id-input') : null;

  if (idInput) {
    idInput.value = 'Đang trích xuất...';
    idInput.classList.remove('invalid-code-alert');
  }

  try {
    let code = '';
    let foundPageNum = 0;
    
    // Quét tìm mã 12 số: quét TRANG 1 của nhóm theo đúng tọa độ (thay vì trang 2)
    const firstPageNum = group.pageNumbers[0];
    code = await extractCCCDFromPage(firstPageNum);
    if (code && /^\d{12}$/.test(code)) {
      foundPageNum = firstPageNum;
    } else {
      // Dự phòng quét các trang còn lại nếu trang 1 chưa ra mã
      for (let i = 1; i < group.pageNumbers.length; i++) {
        const pNum = group.pageNumbers[i];
        const altCode = await extractCCCDFromPage(pNum);
        if (altCode && /^\d{12}$/.test(altCode)) {
          code = altCode;
          foundPageNum = pNum;
          break;
        }
      }
    }

    if (code && /^\d{12}$/.test(code)) {
      group.identifier = code;
      if (idInput) idInput.value = code;

      // 1. TỰ ĐỘNG CHÈN TRANG CCCD VÀO ĐẦU NHÓM (Y hệt như quét AI)
      const isMatched = matchCccdForGroup(group);
      if (isMatched) {
        showToast(`[${group.name}] Đã lấy mã ${code} ở trang ${foundPageNum} & TỰ ĐỘNG CHÈN trang CCCD (${group.cccdName}) vào đầu nhóm!`);
      }

      // 2. Tự động tra cứu tên file từ Google Sheet
      try {
        const names = await fetchNamesFromGoogleSheet(code);
        if (names.length > 0) {
          group.filenamesText = names.join('\n');
          group.sheetStatus = 'found';
          if (card) {
            const txtEl = card.querySelector('.group-filename-input');
            if (txtEl) txtEl.value = group.filenamesText;
          }
          // Thử khớp lại CCCD theo tên file nếu lúc trước chưa khớp
          const matchedAfterSheet = matchCccdForGroup(group);
          if (matchedAfterSheet && !isMatched) {
            showToast(`[${group.name}] Đã lấy mã ${code} & TỰ ĐỘNG CHÈN trang CCCD (${group.cccdName}) vào đầu nhóm!`);
          }
          showToast(`[${group.name}] Đã lấy mã ${code} ở trang ${foundPageNum} & tìm thấy ${names.length} tên file từ Google Sheet!`);
        } else {
          group.sheetStatus = 'not_found';
          showToast(`[${group.name}] Đã lấy mã ${code} ở trang ${foundPageNum}, nhưng Google Sheet KHÔNG CÓ tên!`, false);
        }
      } catch (sheetErr) {
        group.sheetStatus = 'not_found';
      }
    } else {
      group.identifier = '';
      group.sheetStatus = 'no_code';
      if (idInput) idInput.value = '';
      showToast(`[${group.name}] Không tìm thấy mã 12 số ở trang 1 của nhóm (đã báo ĐỎ).`, false);
    }
  } catch (err) {
    console.error(`Lỗi xử lý tự động cho nhóm ${group.name}:`, err);
  } finally {
    validateGroupCode(group, idInput);
    group.pageNumbers.forEach(p => updatePageGroupStyling(p));
    updateGroupStatusSummaryUI();
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
  }
}

async function extract12AllGroups() {
  if (!pdfGroups || pdfGroups.length === 0) {
    showToast('Chưa có nhóm nào được tạo! Vui lòng gom nhóm trước.', false);
    return;
  }

  showSpinner(`Đang trích xuất mã 12 số từ trang 1 & tra Sheet cho ${pdfGroups.length} nhóm...`);
  try {
    for (let i = 0; i < pdfGroups.length; i++) {
      const group = pdfGroups[i];
      showSpinner(`Đang trích xuất nhóm ${i + 1}/${pdfGroups.length}: ${group.name}...`);
      await autoProcessGroupCCCDAndSheet(group);
    }

    const noCodeCount = pdfGroups.filter(g => !/^\d{12}$/.test((g.identifier || '').trim())).length;
    if (noCodeCount > 0) {
      showToast(`Hoàn tất Extract 12! Còn ${noCodeCount} nhóm chưa lấy được mã 12 số (đang báo ĐỎ).`, false);
    } else {
      showToast(`Hoàn tất Extract 12 & tra Google Sheet cho tất cả ${pdfGroups.length} nhóm!`);
    }
  } finally {
    hideSpinner();
    updateGroupStatusSummaryUI();
  }
}
