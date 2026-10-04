// PDF Core Engine: Loading, Rendering, Rotation, Page Replacement & Dual-Engine Export

let currentModalPageNum = 1;

async function handleReplaceFile(file) {
  if (!targetReplacePageNum) return;
  const pageNum = targetReplacePageNum;
  showSpinner(`Đang thay thế trang ${pageNum} bằng file "${file.name}"...`);

  try {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(file.name);

    if (!isPdf && !isImage) {
      showToast('Vui lòng chọn file PDF hoặc file ảnh (JPG, PNG, WebP)!', false);
      return;
    }

    const reader = new FileReader();
    reader.onload = async function() {
      const bytes = new Uint8Array(this.result);
      
      if (isPdf) {
        const pdfjsTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
        const repPdfjsDoc = await pdfjsTask.promise;
        const repPdfLibDoc = await PDFLib.PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });

        replacedPagesMap.set(pageNum, {
          type: 'pdf',
          pdfjsDoc: repPdfjsDoc,
          pdfLibDoc: repPdfLibDoc,
          filename: file.name,
          bytes: bytes
        });
      } else if (isImage) {
        const dataUrl = await new Promise(res => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(file);
        });

        const imgPdfDoc = await PDFLib.PDFDocument.create();
        let imgEmbed;
        if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
          imgEmbed = await imgPdfDoc.embedPng(bytes);
        } else {
          imgEmbed = await imgPdfDoc.embedJpg(bytes);
        }
        const imgPage = imgPdfDoc.addPage([imgEmbed.width, imgEmbed.height]);
        imgPage.drawImage(imgEmbed, { x: 0, y: 0, width: imgEmbed.width, height: imgEmbed.height });

        const pdfBytes = await imgPdfDoc.save();
        const repPdfjsDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

        replacedPagesMap.set(pageNum, {
          type: 'image',
          pdfjsDoc: repPdfjsDoc,
          pdfLibDoc: imgPdfDoc,
          filename: file.name,
          dataUrl: dataUrl,
          bytes: pdfBytes
        });
      }

      // Re-render thumbnail canvas for this page
      const card = document.querySelector(`.page-card[data-page-num="${pageNum}"]`);
      if (card) {
        const canvas = card.querySelector('canvas');
        const ratioSpan = card.querySelector('.ratio-tag');
        if (canvas && ratioSpan) {
          await renderSingleCanvas(pageNum, canvas, ratioSpan);
        }

        let repBadge = card.querySelector('.replaced-tag');
        if (!repBadge) {
          repBadge = document.createElement('div');
          repBadge.className = 'replaced-tag';
          card.appendChild(repBadge);
        }
        repBadge.title = `Đã thay thế trang bằng: ${file.name}`;
        repBadge.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Đã thay`;
      }

      showToast(`Đã thay thế thành công trang ${pageNum} bằng "${file.name}"!`);
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    };
    reader.readAsArrayBuffer(file);
  } catch (err) {
    console.error('Lỗi thay thế trang:', err);
    showToast(`Lỗi thay thế trang: ${err.message}`, false);
  } finally {
    hideSpinner();
  }
}

async function handleFileSelect(file) {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Vui lòng chọn file định dạng .pdf', false);
    return;
  }
  showSpinner('Đang đọc file PDF...');
  const reader = new FileReader();
  reader.onload = async function () {
    await loadPdfFromBytes(new Uint8Array(this.result), file.name, file.size);
    hideSpinner();
  };
  reader.readAsArrayBuffer(file);
}

async function loadPdfFromBytes(bytes, fileName, fileSize = null) {
  try {
    currentPdfBytes = new Uint8Array(bytes);
    originalFileName = fileName.replace(/\.[^/.]+$/, "");
    const outputFilenameInput = document.getElementById('outputFilenameInput');
    if (outputFilenameInput) outputFilenameInput.value = `${originalFileName}-tach`;

    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const fileStatsDisplay = document.getElementById('fileStatsDisplay');
    if (fileNameDisplay) fileNameDisplay.textContent = fileName;
    
    const loadingTask = pdfjsLib.getDocument({ data: currentPdfBytes.slice(0) });
    currentPdfDoc = await loadingTask.promise;
    totalPages = currentPdfDoc.numPages;

    const sizeStr = fileSize ? formatBytes(fileSize) : '';
    if (fileStatsDisplay) fileStatsDisplay.textContent = `${sizeStr} • Tổng cộng ${totalPages} trang`;

    // Reset Maps
    selectedPagesMap.clear();
    pageRotationMap.clear();
    replacedPagesMap.clear();
    pdfGroups = [];
    for (let i = 1; i <= totalPages; i++) {
      selectedPagesMap.set(i, true);
      pageRotationMap.set(i, 0);
    }

    // Show UI Panels
    const dropZone = document.getElementById('dropZone');
    const fileInfoBar = document.getElementById('fileInfoBar');
    const controlsPanel = document.getElementById('controlsPanel');
    const pagesContainer = document.getElementById('pagesContainer');
    const exportBarBottom = document.getElementById('exportBarBottom');
    const sheetConfigBar = document.getElementById('sheetConfigBar');

    if (dropZone) dropZone.style.display = 'none';
    if (fileInfoBar) fileInfoBar.style.display = 'flex';
    if (controlsPanel) controlsPanel.style.display = 'flex';
    if (pagesContainer) pagesContainer.style.display = 'flex';
    if (exportBarBottom) exportBarBottom.style.display = 'flex';
    if (sheetConfigBar) sheetConfigBar.style.display = 'block';

    renderGroupsUI();

    // Render PDF pages
    await renderAllPages();

    updateSelectionUI();
    showToast(`Đã tải file PDF (${totalPages} trang) thành công!`);
    if (typeof triggerAutoSave === 'function') triggerAutoSave();

  } catch (err) {
    console.error('Lỗi đọc PDF:', err);
    showToast('Không thể đọc file PDF này: ' + (err.message || 'File có thể bị hỏng hoặc bảo mật.'), false);
  }
}

// --- Lazy Rendering Queue ---
function initPageRenderObserver() {
  if (pageRenderObserver) pageRenderObserver.disconnect();

  pageRenderObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const card = entry.target;
        const pageNum = parseInt(card.dataset.pageNum, 10);
        if (pageNum && !renderedPagesSet.has(pageNum)) {
          queuePageRender(pageNum, card);
        }
      }
    });
  }, {
    root: null,
    rootMargin: '500px 0px',
    threshold: 0.01
  });
}

function queuePageRender(pageNum, card) {
  if (renderedPagesSet.has(pageNum)) return;
  if (renderQueue.some(item => item.pageNum === pageNum)) return;
  renderQueue.push({ pageNum, card });
  processRenderQueue();
}

async function processRenderQueue() {
  if (activeRenderCount >= 2 || renderQueue.length === 0) return;
  const item = renderQueue.shift();
  if (!item || renderedPagesSet.has(item.pageNum)) {
    processRenderQueue();
    return;
  }

  activeRenderCount++;
  try {
    const canvas = item.card.querySelector('canvas');
    const ratioSpan = item.card.querySelector('.ratio-tag');
    if (canvas && ratioSpan) {
      await renderSingleCanvas(item.pageNum, canvas, ratioSpan);
      renderedPagesSet.add(item.pageNum);
      item.card.querySelector('.canvas-wrapper')?.classList.remove('loading-skeleton');
    }
  } catch (err) {
    console.warn(`Lỗi render trang ${item.pageNum}:`, err);
  } finally {
    activeRenderCount--;
    processRenderQueue();
  }
}

async function renderAllPages() {
  const pagesGrid = document.getElementById('pagesGrid');
  const totalCountText = document.getElementById('totalCountText');
  if (!pagesGrid) return;

  pagesGrid.innerHTML = '';
  if (totalCountText) totalCountText.textContent = totalPages;
  renderedPagesSet.clear();
  renderQueue = [];
  activeRenderCount = 0;
  initPageRenderObserver();

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const card = document.createElement('div');
    card.className = `page-card ${selectedPagesMap.get(pageNum) ? 'selected' : ''}`;
    card.dataset.pageNum = pageNum;

    const topBar = document.createElement('div');
    topBar.className = 'card-top-bar';

    const numBadge = document.createElement('div');
    numBadge.className = 'page-num-badge';
    numBadge.textContent = `Trang ${pageNum}`;

    const actionsGroup = document.createElement('div');
    actionsGroup.className = 'card-action-buttons';

    const rotateLeftBtn = document.createElement('button');
    rotateLeftBtn.className = 'card-btn btn-rotate-left';
    rotateLeftBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
    rotateLeftBtn.title = 'Xoay trái 90°';
    rotateLeftBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      rotatePage(pageNum, -90);
    });

    const rotateRightBtn = document.createElement('button');
    rotateRightBtn.className = 'card-btn btn-rotate-right';
    rotateRightBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
    rotateRightBtn.title = 'Xoay phải 90°';
    rotateRightBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      rotatePage(pageNum, 90);
    });

    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'card-btn btn-zoom';
    zoomBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i>';
    zoomBtn.title = 'Xem phóng to chi tiết trang';
    zoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openZoomModal(pageNum);
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'card-btn btn-copy-text';
    copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i>';
    copyBtn.title = 'Bôi đen & Copy nội dung chữ trang này';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPageTextModal(pageNum);
    });

    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'card-btn btn-replace-page';
    replaceBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
    replaceBtn.title = 'Thay thế trang này bằng file PDF hoặc Ảnh khác';
    replaceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      targetReplacePageNum = pageNum;
      const replaceInput = document.getElementById('replaceFileInput');
      if (replaceInput) replaceInput.click();
    });

    actionsGroup.appendChild(rotateLeftBtn);
    actionsGroup.appendChild(rotateRightBtn);
    actionsGroup.appendChild(replaceBtn);
    actionsGroup.appendChild(copyBtn);
    actionsGroup.appendChild(zoomBtn);

    const checkbox = document.createElement('div');
    checkbox.className = 'page-checkbox';
    checkbox.innerHTML = '<i class="fa-solid fa-check"></i>';

    topBar.appendChild(numBadge);
    topBar.appendChild(actionsGroup);
    topBar.appendChild(checkbox);

    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'canvas-wrapper loading-skeleton';

    const canvas = document.createElement('canvas');
    canvasWrapper.appendChild(canvas);

    const footer = document.createElement('div');
    footer.className = 'page-meta-footer';

    const ratioSpan = document.createElement('span');
    ratioSpan.className = 'ratio-tag';
    ratioSpan.textContent = `Trang ${pageNum}`;
    footer.appendChild(ratioSpan);

    card.appendChild(topBar);
    card.appendChild(canvasWrapper);
    card.appendChild(footer);

    if (replacedPagesMap.has(pageNum)) {
      const rep = replacedPagesMap.get(pageNum);
      const repBadge = document.createElement('div');
      repBadge.className = 'replaced-tag';
      repBadge.title = `Đã thay thế trang bằng: ${rep.filename}`;
      repBadge.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Đã thay`;
      card.appendChild(repBadge);
    }

    const group = pdfGroups.find(g => g.pageNumbers.includes(pageNum));
    if (group) {
      const color = GROUP_COLORS[group.colorIndex % GROUP_COLORS.length];
      card.style.borderColor = color.border;
      card.style.boxShadow = `0 0 12px ${color.border}55`;

      const groupBadge = document.createElement('div');
      groupBadge.className = 'page-group-badge';
      groupBadge.style.background = color.tagBg;
      groupBadge.title = `${group.name}${group.identifier ? `: ${group.identifier}` : ''}`;
      groupBadge.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${group.name}${group.identifier ? `: ${group.identifier}` : ''}`;
      card.appendChild(groupBadge);
    }

    card.addEventListener('click', () => {
      const currentState = selectedPagesMap.get(pageNum);
      selectedPagesMap.set(pageNum, !currentState);
      card.classList.toggle('selected', !currentState);
      updateSelectionUI();
    });

    pagesGrid.appendChild(card);
    pageRenderObserver.observe(card);

    const groupEndingHere = pdfGroups.find(g => Math.max(...g.pageNumbers) === pageNum);
    if (groupEndingHere) {
      const groupCardEl = createGroupCardElement(groupEndingHere);
      pagesGrid.appendChild(groupCardEl);
    }
  }
}

function rotatePage(pageNum, degrees = 90) {
  const currentRot = pageRotationMap.get(pageNum) || 0;
  const newRot = (currentRot + degrees + 360) % 360;
  pageRotationMap.set(pageNum, newRot);

  renderedPagesSet.delete(pageNum);
  const pagesGrid = document.getElementById('pagesGrid');
  const card = pagesGrid?.querySelector(`.page-card[data-page-num="${pageNum}"]`);
  if (card) {
    const canvas = card.querySelector('canvas');
    const ratioSpan = card.querySelector('.ratio-tag');
    if (canvas && ratioSpan) {
      renderSingleCanvas(pageNum, canvas, ratioSpan);
      renderedPagesSet.add(pageNum);
    }
  }
  if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

function rotateSelectedPages(degrees = 90) {
  let count = 0;
  selectedPagesMap.forEach((isSelected, pageNum) => {
    if (isSelected) {
      rotatePage(pageNum, degrees);
      count++;
    }
  });
  const dirStr = degrees > 0 ? 'phải' : 'trái';
  if (count > 0) {
    showToast(`Đã xoay ${dirStr} 90° cho ${count} trang được chọn!`);
  } else {
    showToast(`Vui lòng chọn ít nhất 1 trang để xoay!`, false);
  }
}

async function renderSingleCanvas(pageNum, canvas, ratioSpan) {
  try {
    const userRotation = pageRotationMap.get(pageNum) || 0;
    let targetDoc = currentPdfDoc;
    let targetPageNumInDoc = pageNum;
    if (replacedPagesMap.has(pageNum)) {
      const rep = replacedPagesMap.get(pageNum);
      targetDoc = rep.pdfjsDoc;
      targetPageNumInDoc = 1;
    }
    const page = await targetDoc.getPage(targetPageNumInDoc);
    const totalRotation = (page.rotate + userRotation) % 360;

    const unscaledViewport = page.getViewport({ scale: 1.0, rotation: totalRotation });
    const aspect = unscaledViewport.width / unscaledViewport.height;

    let orientTag = 'Dọc';
    if (aspect > 1.1) orientTag = 'Ngang';
    else if (Math.abs(aspect - 1.0) < 0.1) orientTag = 'Vuông';

    const rotStr = userRotation > 0 ? ` • ${userRotation}°` : '';
    ratioSpan.textContent = `${orientTag}${rotStr} • ${Math.round(unscaledViewport.width)}x${Math.round(unscaledViewport.height)}pt`;

    const renderScale = 1.3;
    const viewport = page.getViewport({ scale: renderScale, rotation: totalRotation });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.aspectRatio = `${unscaledViewport.width} / ${unscaledViewport.height}`;

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

  } catch (err) {
    console.error(`Lỗi render trang ${pageNum}:`, err);
  }
}

async function buildPdfBytesForIndices(selectedIndices, group = null) {
  try {
    const pdfBytesCopy = currentPdfBytes.slice(0);
    const srcDoc = await PDFLib.PDFDocument.load(pdfBytesCopy, { ignoreEncryption: true });
    const destDoc = await PDFLib.PDFDocument.create();

    // 1. Chèn file CCCD vào đầu (nếu nhóm có file CCCD đã nối)
    if (group && group.cccdFile) {
      try {
        const cccdBuffer = await group.cccdFile.arrayBuffer();
        const isPdf = group.cccdFile.type === 'application/pdf' || group.cccdFile.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          const cccdDoc = await PDFLib.PDFDocument.load(cccdBuffer, { ignoreEncryption: true });
          const cPages = await destDoc.copyPages(cccdDoc, cccdDoc.getPageIndices());
          cPages.forEach(cp => destDoc.addPage(cp));
        } else {
          let img;
          const isPng = group.cccdFile.type === 'image/png' || group.cccdFile.name.toLowerCase().endsWith('.png');
          if (isPng) {
            img = await destDoc.embedPng(cccdBuffer);
          } else {
            img = await destDoc.embedJpg(cccdBuffer);
          }
          const pageW = 612.0, pageH = 792.0;
          const page = destDoc.addPage([pageW, pageH]);
          const scale = Math.min(pageW / img.width, pageH / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          page.drawImage(img, {
            x: (pageW - drawW) / 2,
            y: (pageH - drawH) / 2,
            width: drawW,
            height: drawH
          });
        }

        const chkBlank = document.getElementById('chkBlankAfterCccd');
        if (chkBlank && chkBlank.checked) {
          destDoc.addPage([612.0, 792.0]);
        }
      } catch (cccdErr) {
        console.warn('Lỗi chèn CCCD:', cccdErr);
      }
    }

    // 2. Chèn các trang của đơn kê khai
    for (let idx of selectedIndices) {
      const pageNum = idx + 1;
      const userRot = pageRotationMap.get(pageNum) || 0;

      if (replacedPagesMap.has(pageNum)) {
        const rep = replacedPagesMap.get(pageNum);
        const repPages = await destDoc.copyPages(rep.pdfLibDoc, rep.pdfLibDoc.getPageIndices());
        repPages.forEach(p => {
          if (userRot !== 0) {
            const currentRot = p.getRotation().angle;
            p.setRotation(PDFLib.degrees((currentRot + userRot) % 360));
          }
          destDoc.addPage(p);
        });
      } else {
        const copiedPages = await destDoc.copyPages(srcDoc, [idx]);
        const page = copiedPages[0];
        if (userRot !== 0) {
          const currentRot = page.getRotation().angle;
          page.setRotation(PDFLib.degrees((currentRot + userRot) % 360));
        }
        destDoc.addPage(page);
      }
    }

    return await destDoc.save({ useObjectStreams: true });
  } catch (vectorErr) {
    console.warn('Vector PDF build fallback triggered:', vectorErr);
    const destDoc = await PDFLib.PDFDocument.create();

    if (group && group.cccdFile) {
      try {
        const cccdBuffer = await group.cccdFile.arrayBuffer();
        const isPdf = group.cccdFile.type === 'application/pdf' || group.cccdFile.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          const cccdDoc = await PDFLib.PDFDocument.load(cccdBuffer, { ignoreEncryption: true });
          const cPages = await destDoc.copyPages(cccdDoc, cccdDoc.getPageIndices());
          cPages.forEach(cp => destDoc.addPage(cp));
        } else {
          let img;
          const isPng = group.cccdFile.type === 'image/png' || group.cccdFile.name.toLowerCase().endsWith('.png');
          if (isPng) {
            img = await destDoc.embedPng(cccdBuffer);
          } else {
            img = await destDoc.embedJpg(cccdBuffer);
          }
          const pageW = 612.0, pageH = 792.0;
          const page = destDoc.addPage([pageW, pageH]);
          const scale = Math.min(pageW / img.width, pageH / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          page.drawImage(img, {
            x: (pageW - drawW) / 2,
            y: (pageH - drawH) / 2,
            width: drawW,
            height: drawH
          });
        }

        const chkBlank = document.getElementById('chkBlankAfterCccd');
        if (chkBlank && chkBlank.checked) {
          destDoc.addPage([612.0, 792.0]);
        }
      } catch (cccdErr) {
        console.warn('Lỗi chèn CCCD (fallback):', cccdErr);
      }
    }

    for (let idx of selectedIndices) {
      const pageNum = idx + 1;
      const userRot = pageRotationMap.get(pageNum) || 0;
      
      let pageDoc = currentPdfDoc;
      let pNum = pageNum;
      if (replacedPagesMap.has(pageNum)) {
        pageDoc = replacedPagesMap.get(pageNum).pdfjsDoc;
        pNum = 1;
      }

      const page = await pageDoc.getPage(pNum);
      const totalRotation = (page.rotate + userRot) % 360;

      const scale = 2.0;
      const viewport = page.getViewport({ scale, rotation: totalRotation });
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d', { alpha: false });

      await page.render({ canvasContext: ctx, viewport }).promise;

      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const jpgImageBytes = await fetch(dataUrl).then(res => res.arrayBuffer());
      const jpgImage = await destDoc.embedJpg(jpgImageBytes);

      const origViewport = page.getViewport({ scale: 1.0, rotation: totalRotation });
      const newPage = destDoc.addPage([origViewport.width, origViewport.height]);
      
      newPage.drawImage(jpgImage, {
        x: 0, y: 0, width: origViewport.width, height: origViewport.height
      });
    }

    return await destDoc.save({ useObjectStreams: true });
  }
}

async function exportSingleGroup(group) {
  const selectedIndices = group.pageNumbers.map(p => p - 1);
  if (selectedIndices.length === 0) return;

  const rawLines = group.filenamesText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const baseNames = rawLines.length > 0 ? rawLines : [`${originalFileName}-${group.name.replace(/\s+/g, '')}`];

  const filenames = baseNames.map(name => {
    let base = name.replace(/\.pdf$/i, '').trim();
    if (group.addDDK && !base.toUpperCase().endsWith('-DDK')) {
      base += '-DDK';
    }
    return `${base}.pdf`;
  });

  showSpinner(`Đang xuất ${group.name} (${selectedIndices.length} trang, ${filenames.length} file)...`);

  try {
    const pdfBytes = await buildPdfBytesForIndices(selectedIndices, group);

    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    for (let i = 0; i < filenames.length; i++) {
      const exportName = filenames[i];
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = exportName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (i < filenames.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    showToast(`Đã xuất ${group.name} (${filenames.length} file) thành công!`);

  } catch (err) {
    console.error('Lỗi xuất nhóm PDF:', err);
    showToast(`Lỗi xuất ${group.name}: ` + (err.message || 'Lỗi dữ liệu'), false);
  } finally {
    hideSpinner();
  }
}

async function exportAllGroups() {
  if (pdfGroups.length === 0) {
    showToast('Chưa có nhóm nào được tạo!', false);
    return;
  }
  for (let i = 0; i < pdfGroups.length; i++) {
    await exportSingleGroup(pdfGroups[i]);
    if (i < pdfGroups.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  showToast(`Đã hoàn tất xuất toàn bộ ${pdfGroups.length} nhóm!`);
}

async function exportAllGroupsZip() {
  if (!pdfGroups || pdfGroups.length === 0) {
    showToast('Chưa có nhóm nào được tạo để xuất file ZIP!', false);
    return;
  }
  if (typeof JSZip === 'undefined') {
    showToast('Thư viện nén ZIP chưa sẵn sàng!', false);
    return;
  }

  showSpinner(`Đang tạo nén ZIP toàn bộ ${pdfGroups.length} nhóm PDF...`);
  try {
    const zip = new JSZip();
    for (let i = 0; i < pdfGroups.length; i++) {
      const group = pdfGroups[i];
      showSpinner(`Đang xử lý nén nhóm ${i + 1}/${pdfGroups.length}: ${group.name}...`);

      const selectedIndices = group.pageNumbers.map(p => p - 1);
      const pdfBytes = await buildPdfBytesForIndices(selectedIndices, group);

      const rawLines = group.filenamesText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const baseNames = rawLines.length > 0 ? rawLines : [`${originalFileName}-${group.name.replace(/\s+/g, '')}`];

      baseNames.forEach(name => {
        let base = name.replace(/\.pdf$/i, '').trim();
        if (group.addDDK && !base.toUpperCase().endsWith('-DDK')) {
          base += '-DDK';
        }
        zip.file(`${base}.pdf`, pdfBytes);
      });
    }

    showSpinner('Đang đóng gói file ZIP...');
    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      showSpinner(`Đang tạo nén ZIP... ${Math.round(metadata.percent)}%`);
    });

    const zipUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = zipUrl;
    link.download = `${originalFileName}_Tat_Ca_Nhom_PDF.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);

    showToast(`Đã xuất và tải về file ZIP cho tất cả ${pdfGroups.length} nhóm thành công!`);
  } catch (err) {
    console.error('Lỗi xuất ZIP:', err);
    showToast('Không thể tạo file ZIP: ' + (err.message || 'Lỗi dữ liệu'), false);
  } finally {
    hideSpinner();
  }
}

function calculateTotalExportFiles() {
  let totalFiles = 0;
  if (pdfGroups && pdfGroups.length > 0) {
    pdfGroups.forEach(g => {
      const lines = (g.filenamesText || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
      totalFiles += lines.length > 0 ? lines.length : 1;
    });
  } else {
    const filenames = getExportFilenames();
    totalFiles = filenames.length;
  }

  const totalCountEl = document.getElementById('totalExportFilesCount');
  if (totalCountEl) {
    totalCountEl.textContent = totalFiles;
  }
  return totalFiles;
}

function getExportFilenames() {
  const outputFilenameInput = document.getElementById('outputFilenameInput');
  const val = outputFilenameInput ? outputFilenameInput.value : '';
  const chkSuffixDDK = document.getElementById('chkSuffixDDK');
  const addDDK = chkSuffixDDK ? chkSuffixDDK.checked : false;

  const fileExtTag = document.getElementById('fileExtTag');
  if (fileExtTag) {
    fileExtTag.textContent = addDDK ? '-DDK.pdf' : '.pdf';
  }

  const lines = val.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    let base = `${originalFileName}-tach`;
    if (addDDK && !base.toUpperCase().endsWith('-DDK')) {
      base += '-DDK';
    }
    return [`${base}.pdf`];
  }

  return lines.map(line => {
    let base = line.replace(/\.pdf$/i, '').trim();
    if (addDDK && !base.toUpperCase().endsWith('-DDK')) {
      base += '-DDK';
    }
    return `${base}.pdf`;
  });
}

async function openZoomModal(pageNum) {
  const userRotation = pageRotationMap.get(pageNum) || 0;
  const zoomModal = document.getElementById('zoomModal');
  const modalPageTitle = document.getElementById('modalPageTitle');
  const modalCanvas = document.getElementById('modalCanvas');
  if (!zoomModal || !modalCanvas) return;

  modalPageTitle.textContent = `Xem Chi Tiết Trang ${pageNum} / ${totalPages}${userRotation > 0 ? ` (${userRotation}°)` : ''}`;
  zoomModal.classList.add('active');

  const page = await currentPdfDoc.getPage(pageNum);
  const totalRotation = (page.rotate + userRotation) % 360;
  const viewport = page.getViewport({ scale: 2.0, rotation: totalRotation });

  modalCanvas.width = viewport.width;
  modalCanvas.height = viewport.height;

  const ctx = modalCanvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
}

async function openPageTextModal(pageNum) {
  currentModalPageNum = pageNum;
  const modal = document.getElementById('pageTextModal');
  const textNumEl = document.getElementById('textModalPageNum');
  const textContainer = document.getElementById('pageTextContentBox');

  if (textNumEl) textNumEl.textContent = pageNum;
  if (textContainer) textContainer.textContent = 'Đang trích xuất chữ từ PDF...';
  if (modal) modal.classList.add('active');

  try {
    const page = await currentPdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();

    if (text && text.length > 0) {
      if (textContainer) textContainer.textContent = text;
    } else {
      if (textContainer) {
        textContainer.innerHTML = `<em style="color: #fca5a5;">Trang ${pageNum} là <strong>ảnh scan</strong> (chưa có lớp chữ vector sẵn).<br>Vui lòng nhấn nút <strong>"Quét Chữ AI Gemini"</strong> bên dưới để tự động đọc toàn bộ chữ trên ảnh scan trang này!</em>`;
      }
    }
  } catch (err) {
    if (textContainer) textContainer.textContent = `Lỗi đọc chữ: ${err.message}`;
  }
}
