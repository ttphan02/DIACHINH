// Main Application Orchestrator & Event Listener Initialization

// Worker PDF.js - Sử dụng file worker cục bộ
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
}

function updateSelectionUI() {
  let selectedCount = 0;
  const pagesGrid = document.getElementById('pagesGrid');
  selectedPagesMap.forEach((isSelected, pageNum) => {
    if (isSelected) selectedCount++;
    const card = pagesGrid?.querySelector(`.page-card[data-page-num="${pageNum}"]`);
    if (card) {
      card.classList.toggle('selected', isSelected);
    }
  });

  const selectedCountText = document.getElementById('selectedCountText');
  if (selectedCountText) selectedCountText.textContent = selectedCount;
  calculateTotalExportFiles();

  const btnDownloadPdf = document.getElementById('btnDownloadPdf');
  if (btnDownloadPdf) {
    btnDownloadPdf.disabled = (selectedCount === 0);
    const filenames = getExportFilenames();
    if (selectedCount > 0) {
      if (filenames.length > 1) {
        btnDownloadPdf.innerHTML = `<i class="fa-solid fa-download"></i> Tải ${filenames.length} File PDF (${selectedCount} trang/file)`;
      } else {
        btnDownloadPdf.innerHTML = `<i class="fa-solid fa-download"></i> Tải PDF Đã Chọn (${selectedCount} trang)`;
      }
    } else {
      btnDownloadPdf.innerHTML = `<i class="fa-solid fa-download"></i> Tải PDF Đã Chọn (0 trang)`;
    }
  }

  const btnDeselectAllBottom = document.getElementById('btnDeselectAllBottom');
  if (btnDeselectAllBottom) {
    btnDeselectAllBottom.disabled = (selectedCount === 0);
  }

  const filenameCountBadge = document.getElementById('filenameCountBadge');
  if (filenameCountBadge) {
    const filenames = getExportFilenames();
    filenameCountBadge.textContent = `${filenames.length} file`;
  }
}

function applyRangeSelection() {
  const input = document.getElementById('rangeInput')?.value.trim();
  if (!input) return;

  const selectedIndices = new Set();
  const parts = input.split(',');

  parts.forEach(part => {
    const range = part.trim().split('-');
    if (range.length === 1) {
      const num = parseInt(range[0], 10);
      if (!isNaN(num) && num >= 1 && num <= totalPages) {
        selectedIndices.add(num);
      }
    } else if (range.length === 2) {
      const start = parseInt(range[0], 10);
      const end = parseInt(range[1], 10);
      if (!isNaN(start) && !isNaN(end)) {
        const min = Math.max(1, Math.min(start, end));
        const max = Math.min(totalPages, Math.max(start, end));
        for (let i = min; i <= max; i++) {
          selectedIndices.add(i);
        }
      }
    }
  });

  if (selectedIndices.size === 0) {
    showToast('Phạm vi trang nhập không hợp lệ!', false);
    return;
  }

  for (let i = 1; i <= totalPages; i++) {
    selectedPagesMap.set(i, selectedIndices.has(i));
  }
  updateSelectionUI();
  showToast(`Đã chọn ${selectedIndices.size} trang theo khoảng!`);
}

document.addEventListener('DOMContentLoaded', () => {
  loadGeminiKeys();

  // Kiểm tra phiên làm việc đã lưu từ IndexedDB chống mất dữ liệu khi F5/reload
  if (typeof getSavedSessionInfo === 'function') {
    getSavedSessionInfo().then(savedData => {
      if (savedData) {
        showSessionRecoveryBanner(savedData);
      }
    });
  }

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const btnDemoPdf = document.getElementById('btnDemoPdf');

  // Drag & drop
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
      }
    });
  }

  // Demo PDF Generator
  if (btnDemoPdf) {
    btnDemoPdf.addEventListener('click', async (e) => {
      e.stopPropagation();
      showSpinner('Đang khởi tạo PDF mẫu 16 trang...');
      try {
        const samplePdf = await PDFLib.PDFDocument.create();
        const font = await samplePdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
        
        const colors = [
          PDFLib.rgb(0.38, 0.4, 0.94),
          PDFLib.rgb(0.54, 0.36, 0.96),
          PDFLib.rgb(0.06, 0.72, 0.5),
          PDFLib.rgb(0.93, 0.27, 0.27),
          PDFLib.rgb(0.95, 0.61, 0.07),
          PDFLib.rgb(0.12, 0.63, 0.95)
        ];

        for (let i = 1; i <= 16; i++) {
          let width = 595.28;
          let height = 841.89;
          if (i % 3 === 0) { width = 841.89; height = 595.28; }
          else if (i % 4 === 0) { width = 600; height = 600; }

          const page = samplePdf.addPage([width, height]);
          const color = colors[(i - 1) % colors.length];

          page.drawRectangle({
            x: 20, y: 20, width: width - 40, height: height - 40,
            borderColor: color, borderWidth: 4, color: PDFLib.rgb(0.96, 0.97, 1)
          });

          page.drawText(`TRANG DEMO ${i}`, {
            x: width / 2 - 100, y: height / 2 + 20, size: 28, font: font, color: color
          });
        }

        const pdfBytes = await samplePdf.save();
        loadPdfFromBytes(pdfBytes, 'PDF_Mau_Thanh_Cong.pdf');
      } catch (err) {
        console.error(err);
        showToast('Không thể tạo PDF mẫu', false);
      } finally {
        hideSpinner();
      }
    });
  }

  // Page replacement file input
  const replaceFileInputEl = document.getElementById('replaceFileInput');
  if (replaceFileInputEl) {
    replaceFileInputEl.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await handleReplaceFile(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  // Selection Buttons
  const btnSelectAll = document.getElementById('btnSelectAll');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      for (let i = 1; i <= totalPages; i++) selectedPagesMap.set(i, true);
      updateSelectionUI();
    });
  }

  const deselectAllHandler = () => {
    for (let i = 1; i <= totalPages; i++) selectedPagesMap.set(i, false);
    updateSelectionUI();
    showToast('Đã bỏ chọn tất cả các trang!');
  };

  const btnDeselectAll = document.getElementById('btnDeselectAll');
  if (btnDeselectAll) btnDeselectAll.addEventListener('click', deselectAllHandler);

  const btnDeselectAllBottom = document.getElementById('btnDeselectAllBottom');
  if (btnDeselectAllBottom) btnDeselectAllBottom.addEventListener('click', deselectAllHandler);

  const btnInvertSelect = document.getElementById('btnInvertSelect');
  if (btnInvertSelect) {
    btnInvertSelect.addEventListener('click', () => {
      for (let i = 1; i <= totalPages; i++) {
        selectedPagesMap.set(i, !selectedPagesMap.get(i));
      }
      updateSelectionUI();
    });
  }

  const btnSelectEven = document.getElementById('btnSelectEven');
  if (btnSelectEven) {
    btnSelectEven.addEventListener('click', () => {
      for (let i = 1; i <= totalPages; i++) selectedPagesMap.set(i, i % 2 === 0);
      updateSelectionUI();
    });
  }

  const btnSelectOdd = document.getElementById('btnSelectOdd');
  if (btnSelectOdd) {
    btnSelectOdd.addEventListener('click', () => {
      for (let i = 1; i <= totalPages; i++) selectedPagesMap.set(i, i % 2 !== 0);
      updateSelectionUI();
    });
  }

  const btnRotateLeftSelected = document.getElementById('btnRotateLeftSelected');
  if (btnRotateLeftSelected) {
    btnRotateLeftSelected.addEventListener('click', () => rotateSelectedPages(-90));
  }

  const btnRotateRightSelected = document.getElementById('btnRotateRightSelected');
  if (btnRotateRightSelected) {
    btnRotateRightSelected.addEventListener('click', () => rotateSelectedPages(90));
  }

  const btnApplyRange = document.getElementById('btnApplyRange');
  if (btnApplyRange) btnApplyRange.addEventListener('click', applyRangeSelection);

  const rangeInput = document.getElementById('rangeInput');
  if (rangeInput) {
    rangeInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') applyRangeSelection();
    });
  }

  // Grid Column Picker
  const colBtns = document.querySelectorAll('.col-btn');
  const pagesGrid = document.getElementById('pagesGrid');
  colBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cols = btn.dataset.cols;
      if (pagesGrid) pagesGrid.className = `pages-grid cols-${cols}`;
    });
  });

  // Filename inputs
  const outputFilenameInputEl = document.getElementById('outputFilenameInput');
  if (outputFilenameInputEl) outputFilenameInputEl.addEventListener('input', updateSelectionUI);

  const chkSuffixDDK = document.getElementById('chkSuffixDDK');
  if (chkSuffixDDK) chkSuffixDDK.addEventListener('change', updateSelectionUI);

  // Grouping & Action Buttons
  const btnCreateGroup = document.getElementById('btnCreateGroup');
  if (btnCreateGroup) btnCreateGroup.addEventListener('click', createGroupFromSelected);

  const btnExtract12All = document.getElementById('btnExtract12All');
  if (btnExtract12All) btnExtract12All.addEventListener('click', extract12AllGroups);

  const btnExtract12AllHeader = document.getElementById('btnExtract12AllHeader');
  if (btnExtract12AllHeader) btnExtract12AllHeader.addEventListener('click', extract12AllGroups);

  const btnScanGeminiCCCD = document.getElementById('btnScanGeminiCCCD');
  if (btnScanGeminiCCCD) btnScanGeminiCCCD.addEventListener('click', scanAllGroupsWithGemini);

  const btnScanGeminiCCCDHeader = document.getElementById('btnScanGeminiCCCDHeader');
  if (btnScanGeminiCCCDHeader) btnScanGeminiCCCDHeader.addEventListener('click', scanAllGroupsWithGemini);

  const btnBatchFetchSheetNames = document.getElementById('btnBatchFetchSheetNames');
  if (btnBatchFetchSheetNames) btnBatchFetchSheetNames.addEventListener('click', batchFetchSheetNames);

  const btnBatchFetchSheetNamesHeader = document.getElementById('btnBatchFetchSheetNamesHeader');
  if (btnBatchFetchSheetNamesHeader) btnBatchFetchSheetNamesHeader.addEventListener('click', batchFetchSheetNames);

  const btnDownloadAllGroups = document.getElementById('btnDownloadAllGroups');
  if (btnDownloadAllGroups) btnDownloadAllGroups.addEventListener('click', exportAllGroups);

  const btnDownloadAllGroupsSticky = document.getElementById('btnDownloadAllGroupsSticky');
  if (btnDownloadAllGroupsSticky) btnDownloadAllGroupsSticky.addEventListener('click', exportAllGroups);

  const btnClearAllGroups = document.getElementById('btnClearAllGroups');
  if (btnClearAllGroups) {
    btnClearAllGroups.addEventListener('click', () => {
      const allGroupedPages = pdfGroups.flatMap(g => g.pageNumbers);
      pdfGroups = [];
      if (pagesGrid) pagesGrid.querySelectorAll('.group-card-item, .group-row-wrapper').forEach(el => el.remove());
      allGroupedPages.forEach(p => updatePageGroupStyling(p));
      renderGroupsUI();
      showToast('Đã xóa tất cả các nhóm!');
    });
  }

  // ZIP Buttons
  const btnZipSticky = document.getElementById('btnDownloadAllGroupsZipSticky');
  if (btnZipSticky) btnZipSticky.addEventListener('click', exportAllGroupsZip);

  const btnZipHeader = document.getElementById('btnDownloadAllGroupsZipHeader');
  if (btnZipHeader) btnZipHeader.addEventListener('click', exportAllGroupsZip);

  // CCCD Pickers
  const cccdFolderPicker = document.getElementById('cccdFolderPicker');
  const cccdSinglePicker = document.getElementById('cccdSinglePicker');
  const btnLoadCccdSticky = document.getElementById('btnLoadCccdFolderSticky');
  const btnLoadCccdHeader = document.getElementById('btnLoadCccdFolderHeader');

  if (btnLoadCccdSticky && cccdFolderPicker) {
    btnLoadCccdSticky.addEventListener('click', () => cccdFolderPicker.click());
  }
  if (btnLoadCccdHeader && cccdFolderPicker) {
    btnLoadCccdHeader.addEventListener('click', () => cccdFolderPicker.click());
  }
  if (cccdFolderPicker) {
    cccdFolderPicker.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await handleCccdFolderUpload(e.target.files);
      }
    });
  }
  if (cccdSinglePicker) {
    cccdSinglePicker.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0] && targetCccdGroupId) {
        const group = pdfGroups.find(g => g.id === targetCccdGroupId);
        if (group) {
          group.cccdFile = e.target.files[0];
          group.cccdName = e.target.files[0].name;
          attachCccdCardToGroup(group);
          updateGroupCccdUI(group);
          showToast(`Đã nối & chèn trang CCCD "${group.cccdName}" vào đầu nhóm ${group.name}!`);
        }
      }
    });
  }

  // Export Selected PDF Button
  const btnDownloadPdf = document.getElementById('btnDownloadPdf');
  if (btnDownloadPdf) {
    btnDownloadPdf.addEventListener('click', async () => {
      const selectedIndices = [];
      for (let i = 1; i <= totalPages; i++) {
        if (selectedPagesMap.get(i)) selectedIndices.push(i - 1);
      }
      if (selectedIndices.length === 0) {
        showToast('Vui lòng chọn ít nhất 1 trang để tải về!', false);
        return;
      }
      const filenames = getExportFilenames();
      showSpinner(`Đang trích xuất ${selectedIndices.length} trang PDF cho ${filenames.length} file...`);
      try {
        const pdfBytes = await buildPdfBytesForIndices(selectedIndices);
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
        showToast(`Đã xuất và tải về thành công ${filenames.length} file PDF!`);
      } catch (err) {
        console.error('Lỗi xuất PDF:', err);
        showToast('Không thể xuất PDF: ' + (err.message || 'Lỗi dữ liệu trang.'), false);
      } finally {
        hideSpinner();
      }
    });
  }

  // Zoom Modal
  const zoomModal = document.getElementById('zoomModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  if (btnCloseModal && zoomModal) {
    btnCloseModal.addEventListener('click', () => zoomModal.classList.remove('active'));
    zoomModal.addEventListener('click', (e) => {
      if (e.target === zoomModal) zoomModal.classList.remove('active');
    });
  }

  // Text Modal
  const pageTextModal = document.getElementById('pageTextModal');
  const btnClosePageTextModal = document.getElementById('btnClosePageTextModal');
  const btnCopyAllModalText = document.getElementById('btnCopyAllModalText');
  const btnOcrGeminiText = document.getElementById('btnOcrGeminiText');

  if (btnClosePageTextModal && pageTextModal) {
    btnClosePageTextModal.addEventListener('click', () => pageTextModal.classList.remove('active'));
  }
  if (btnCopyAllModalText) {
    btnCopyAllModalText.addEventListener('click', async () => {
      const box = document.getElementById('pageTextContentBox');
      const txt = box ? box.innerText : '';
      if (txt && txt.trim()) {
        await navigator.clipboard.writeText(txt.trim());
        showToast(`📋 Đã copy toàn bộ nội dung chữ trang ${currentModalPageNum} vào Clipboard!`);
      } else {
        showToast('Chưa có nội dung chữ để copy!', false);
      }
    });
  }
  if (btnOcrGeminiText) {
    btnOcrGeminiText.addEventListener('click', async () => {
      const box = document.getElementById('pageTextContentBox');
      if (box) box.textContent = `Đang gọi AI Gemini đọc toàn bộ chữ trên ảnh scan trang ${currentModalPageNum}...`;
      showSpinner(`Đang dùng AI Gemini quét chữ trang ${currentModalPageNum}...`);
      try {
        const base64Image = await getPageJpegBase64(currentModalPageNum, 2.0);
        if (!base64Image) throw new Error('Không thể tạo ảnh.');
        let attempts = 0;
        let ocrResult = null;
        while (attempts < geminiKeys.length) {
          const apiKey = getNextGeminiKey();
          if (!apiKey) break;
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const payload = {
              contents: [{
                parts: [
                  { text: "Hãy đọc và trích xuất lại toàn bộ nội dung chữ (văn bản) xuất hiện trong hình ảnh này. Giữ nguyên định dạng các đoạn văn bản." },
                  { inline_data: { mime_type: "image/jpeg", data: base64Image } }
                ]
              }]
            };
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (!response.ok) { attempts++; continue; }
            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) { ocrResult = text; break; }
          } catch (e) { attempts++; }
        }
        if (ocrResult) {
          if (box) box.textContent = ocrResult;
          showToast(`Đã dùng AI Gemini quét xong toàn bộ chữ trang ${currentModalPageNum}!`);
        } else {
          if (box) box.textContent = 'Không thể quét chữ bằng AI Gemini. Kiểm tra lại API Key hoặc Quota.';
          showToast('Không thể quét chữ bằng AI Gemini.', false);
        }
      } catch (err) {
        showToast('Lỗi quét chữ AI: ' + err.message, false);
      } finally {
        hideSpinner();
      }
    });
  }

  // Gemini Keys Modal
  const btnManageGeminiKeys = document.getElementById('btnManageGeminiKeys');
  const geminiKeysModal = document.getElementById('geminiKeysModal');
  const btnCloseGeminiKeysModal = document.getElementById('btnCloseGeminiKeysModal');
  const geminiKeysTextarea = document.getElementById('geminiKeysTextarea');
  const btnSaveGeminiKeys = document.getElementById('btnSaveGeminiKeys');
  const btnResetDefaultKeys = document.getElementById('btnResetDefaultKeys');

  if (btnManageGeminiKeys && geminiKeysModal) {
    btnManageGeminiKeys.addEventListener('click', () => {
      if (geminiKeysTextarea) geminiKeysTextarea.value = geminiKeys.join('\n');
      geminiKeysModal.classList.add('active');
    });
  }
  if (btnCloseGeminiKeysModal && geminiKeysModal) {
    btnCloseGeminiKeysModal.addEventListener('click', () => {
      geminiKeysModal.classList.remove('active');
    });
  }
  if (btnSaveGeminiKeys) {
    btnSaveGeminiKeys.addEventListener('click', () => {
      const raw = (geminiKeysTextarea ? geminiKeysTextarea.value : '') || '';
      const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length === 0) {
        showToast('Vui lòng dán ít nhất 1 API Key hợp lệ!', false);
        return;
      }
      geminiKeys = lines;
      currentGeminiKeyIdx = 0;
      isGeminiQuotaExhausted = false;
      localStorage.setItem('user_gemini_keys', JSON.stringify(geminiKeys));
      if (geminiKeysModal) geminiKeysModal.classList.remove('active');
      showToast(`Đã lưu ${geminiKeys.length} Gemini API Key thành công (Đã kích hoạt lại chế độ AI)!`);
    });
  }
  if (btnResetDefaultKeys) {
    btnResetDefaultKeys.addEventListener('click', async () => {
      localStorage.removeItem('user_gemini_keys');
      await loadGeminiKeys();
      isGeminiQuotaExhausted = false;
      if (geminiKeysTextarea) geminiKeysTextarea.value = geminiKeys.join('\n');
      showToast('Đã khôi phục danh sách API Key mặc định!');
    });
  }

  // Nút Lưu Thủ Công Phiên Làm Việc (Chống mất dữ liệu khi gặp sự cố/lag/reload)
  const btnManualSaveSession = document.getElementById('btnManualSaveSession');
  if (btnManualSaveSession) {
    btnManualSaveSession.addEventListener('click', async () => {
      if (!currentPdfBytes) {
        showToast('Chưa có file PDF nào đang mở để lưu!', false);
        return;
      }
      showSpinner('Đang lưu trạng thái làm việc vào bộ nhớ an toàn (IndexedDB)...');
      try {
        const ok = await saveSessionToStorage();
        if (ok) {
          showToast(`Đã lưu phiên làm việc "${originalFileName}" (${pdfGroups.length} nhóm) thành công!`);
        } else {
          showToast('Không thể lưu phiên làm việc!', false);
        }
      } finally {
        hideSpinner();
      }
    });
  }

  // Test Sheet Button
  const btnTestSheet = document.getElementById('btnTestSheet');
  if (btnTestSheet) {
    btnTestSheet.addEventListener('click', async () => {
      const url = document.getElementById('sheetUrlInput')?.value.trim() || DEFAULT_SHEET_URL;
      if (!url) {
        showToast('Vui lòng nhập link Google Sheet công khai!', false);
        return;
      }
      const testIdInput = document.getElementById('testSearchIdInput');
      const testId = testIdInput ? testIdInput.value.trim() : '';
      if (testId) {
        showSpinner(`Đang tra cứu thử mã "${testId}" từ Google Sheet...`);
        try {
          const names = await fetchNamesFromGoogleSheet(testId);
          if (names.length > 0) {
            alert(`KẾT QUẢ TRA CỨU MÃ ${testId} (${names.length} giá trị tìm thấy trong ${document.getElementById('sheetLimitInput')?.value || 100} dòng mới nhất):\n\n` + names.map((n, i) => `${i + 1}. ${n}`).join('\n'));
            showToast(`Tìm thấy ${names.length} giá trị cho mã ${testId}!`);
          } else {
            showToast(`Không tìm thấy mã ${testId} trong ${document.getElementById('sheetLimitInput')?.value || 100} dòng mới nhất.`, false);
          }
        } catch (err) {
          showToast('Lỗi tra cứu: ' + err.message, false);
        } finally {
          hideSpinner();
        }
        return;
      }

      if (pdfGroups.length === 0) {
        showToast('Chưa có nhóm nào. Vui lòng nhập mã vào ô "Thử mã" hoặc chọn các trang bấm "Gom Nhóm Trang Chọn"!', false);
        return;
      }
      let updatedCount = 0;
      showSpinner('Đang tra cứu Google Sheet cho tất cả các nhóm...');
      try {
        for (const g of pdfGroups) {
          if (g.identifier) {
            const names = await fetchNamesFromGoogleSheet(g.identifier);
            if (names.length > 0) {
              g.filenamesText = names.join('\n');
              updatedCount++;
            }
          }
        }
        renderGroupsUI();
        if (updatedCount > 0) {
          showToast(`Đã tra cứu và cập nhật dữ liệu thành công cho ${updatedCount} nhóm!`);
        } else {
          showToast(`Tra cứu hoàn tất nhưng không tìm thấy mã khớp nào trong ${document.getElementById('sheetLimitInput')?.value || 100} dòng mới nhất.`, false);
        }
      } catch (err) {
        showToast('Lỗi tra cứu Sheet: ' + err.message, false);
      } finally {
        hideSpinner();
      }
    });
  }
});
