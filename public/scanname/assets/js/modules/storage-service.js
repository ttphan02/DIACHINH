// Storage & Session Persistence Service (IndexedDB Auto-Save & Recovery)

const DB_NAME = 'PdfSplitterProDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessionStore';
const SESSION_KEY = 'active_working_session';

let dbInstance = null;
let autoSaveTimer = null;

// Initialize IndexedDB
function getDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => {
      console.warn('Lỗi mở IndexedDB:', e.target.error);
      reject(e.target.error);
    };
  });
}

// Debounced Auto-Save Trigger
function triggerAutoSave(delayMs = 600) {
  if (!currentPdfBytes || !currentPdfDoc) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);

  autoSaveTimer = setTimeout(() => {
    saveSessionToStorage().catch(err => {
      console.warn('Tự động lưu phiên thất bại:', err);
    });
  }, delayMs);
}

// Save Full Application State to IndexedDB
async function saveSessionToStorage() {
  if (!currentPdfBytes || !currentPdfDoc) return false;

  try {
    const db = await getDB();

    // Serialize replaced pages map
    const replacedPagesArr = [];
    replacedPagesMap.forEach((rep, pageNum) => {
      replacedPagesArr.push({
        pageNum,
        type: rep.type,
        filename: rep.filename,
        bytes: rep.bytes,
        dataUrl: rep.dataUrl
      });
    });

    // Serialize groups (including attached CCCD blobs)
    const groupsArr = pdfGroups.map(g => ({
      id: g.id,
      name: g.name,
      colorIndex: g.colorIndex,
      pageNumbers: [...g.pageNumbers],
      identifier: g.identifier || '',
      filenamesText: g.filenamesText || '',
      addDDK: g.addDDK !== false,
      sheetStatus: g.sheetStatus || 'pending',
      cccdName: g.cccdName || (g.cccdFile ? g.cccdFile.name : null),
      cccdFileType: g.cccdFileType || (g.cccdFile ? g.cccdFile.type : null),
      cccdFile: g.cccdFile || null // Stored as File/Blob natively by IndexedDB
    }));

    const sessionData = {
      timestamp: Date.now(),
      originalFileName: originalFileName,
      fileSize: currentPdfBytes.byteLength,
      totalPages: totalPages,
      pdfBytes: currentPdfBytes,
      selectedPages: Array.from(selectedPagesMap.entries()),
      pageRotations: Array.from(pageRotationMap.entries()),
      replacedPages: replacedPagesArr,
      pdfGroups: groupsArr,
      sheetConfig: {
        url: document.getElementById('sheetUrlInput')?.value || '',
        sheetName: document.getElementById('sheetNameInput')?.value || '',
        limit: document.getElementById('sheetLimitInput')?.value || 100
      },
      outputFilename: document.getElementById('outputFilenameInput')?.value || ''
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(sessionData, SESSION_KEY);

      req.onsuccess = () => {
        updateAutoSaveBadge(sessionData.timestamp);
        resolve(true);
      };
      req.onerror = (e) => reject(e.target.error);
    });

  } catch (err) {
    console.warn('Lỗi ghi session vào IndexedDB:', err);
    return false;
  }
}

// Check if a saved session exists
async function getSavedSessionInfo() {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SESSION_KEY);

      req.onsuccess = () => {
        const data = req.result;
        if (data && data.pdfBytes && data.originalFileName) {
          resolve(data);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

// Clear Saved Session from Storage
async function clearSavedSession() {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(SESSION_KEY);
      req.onsuccess = () => {
        hideSessionRecoveryBanner();
        updateAutoSaveBadge(null);
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    return false;
  }
}

// Update Auto-Save Badge on UI Header
function updateAutoSaveBadge(timestamp) {
  let badge = document.getElementById('autoSaveStatusBadge');
  if (!badge) {
    const headerRight = document.querySelector('header .header-container > div:last-child');
    if (headerRight) {
      badge = document.createElement('div');
      badge.id = 'autoSaveStatusBadge';
      badge.style.display = 'inline-flex';
      badge.style.alignItems = 'center';
      badge.style.gap = '6px';
      badge.style.fontSize = '12px';
      badge.style.fontWeight = '600';
      badge.style.color = '#34d399';
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      badge.style.borderRadius = '20px';
      badge.style.padding = '4px 12px';
      badge.style.transition = 'all 0.3s ease';
      badge.title = 'Hệ thống tự động lưu trữ trạng thái xử lý vào ổ cứng cục bộ (IndexedDB) chống mất dữ liệu';
      headerRight.prepend(badge);
    }
  }

  if (badge) {
    if (timestamp) {
      const timeStr = new Date(timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Đã lưu tự động ${timeStr}`;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

// Show/Hide Recovery Banner
function showSessionRecoveryBanner(savedData) {
  let banner = document.getElementById('sessionRecoveryBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'sessionRecoveryBanner';
    banner.className = 'session-recovery-banner';
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.prepend(banner);
  }

  const timeStr = new Date(savedData.timestamp).toLocaleString('vi-VN');
  const groupCount = savedData.pdfGroups ? savedData.pdfGroups.length : 0;
  const fileName = savedData.originalFileName || 'tai-lieu';

  banner.innerHTML = `
    <div class="recovery-banner-content">
      <div class="recovery-banner-info">
        <div class="recovery-banner-icon">
          <i class="fa-solid fa-clock-rotate-left"></i>
        </div>
        <div>
          <div class="recovery-banner-title">Phát hiện phiên làm việc chưa hoàn tất!</div>
          <div class="recovery-banner-desc">
            File: <strong>${fileName}.pdf</strong> &bull; ${savedData.totalPages} trang &bull; ${groupCount} nhóm đã gom &bull; Lưu lúc: <em>${timeStr}</em>
          </div>
        </div>
      </div>
      <div class="recovery-banner-actions">
        <button class="btn-restore-session" id="btnRestoreSessionAction">
          <i class="fa-solid fa-rotate-left"></i> Khôi Phục Phiên Này
        </button>
        <button class="btn-discard-session" id="btnDiscardSessionAction">
          <i class="fa-solid fa-trash-can"></i> Bỏ Qua & Xóa
        </button>
      </div>
    </div>
  `;

  banner.style.display = 'block';

  document.getElementById('btnRestoreSessionAction')?.addEventListener('click', async () => {
    banner.style.display = 'none';
    await restoreWorkingSession(savedData);
  });

  document.getElementById('btnDiscardSessionAction')?.addEventListener('click', async () => {
    await clearSavedSession();
    showToast('Đã xóa phiên làm việc cũ khỏi bộ nhớ đệm!');
  });
}

function hideSessionRecoveryBanner() {
  const banner = document.getElementById('sessionRecoveryBanner');
  if (banner) banner.style.display = 'none';
}

// Full Restoration Process
async function restoreWorkingSession(savedData) {
  if (!savedData || !savedData.pdfBytes) {
    showToast('Không tìm thấy dữ liệu phiên làm việc để khôi phục!', false);
    return;
  }

  showSpinner(`Đang khôi phục phiên: "${savedData.originalFileName}" (${savedData.pdfGroups?.length || 0} nhóm)...`);

  try {
    // 1. Nạp lại file PDF gốc
    await loadPdfFromBytes(savedData.pdfBytes, savedData.originalFileName, savedData.fileSize);

    // 2. Khôi phục Selection Map
    if (Array.isArray(savedData.selectedPages)) {
      selectedPagesMap.clear();
      savedData.selectedPages.forEach(([pageNum, isSelected]) => {
        selectedPagesMap.set(pageNum, isSelected);
      });
    }

    // 3. Khôi phục Page Rotations
    if (Array.isArray(savedData.pageRotations)) {
      pageRotationMap.clear();
      savedData.pageRotations.forEach(([pageNum, rot]) => {
        pageRotationMap.set(pageNum, rot);
        if (rot !== 0) {
          const card = document.querySelector(`.page-card[data-page-num="${pageNum}"]`);
          if (card) {
            const canvas = card.querySelector('canvas');
            const ratioSpan = card.querySelector('.ratio-tag');
            if (canvas && ratioSpan) {
              renderSingleCanvas(pageNum, canvas, ratioSpan);
            }
          }
        }
      });
    }

    // 4. Khôi phục Replaced Pages
    if (Array.isArray(savedData.replacedPages) && savedData.replacedPages.length > 0) {
      for (const rep of savedData.replacedPages) {
        if (rep.type === 'pdf') {
          const repPdfjsDoc = await pdfjsLib.getDocument({ data: rep.bytes.slice(0) }).promise;
          const repPdfLibDoc = await PDFLib.PDFDocument.load(rep.bytes.slice(0), { ignoreEncryption: true });
          replacedPagesMap.set(rep.pageNum, {
            type: 'pdf',
            pdfjsDoc: repPdfjsDoc,
            pdfLibDoc: repPdfLibDoc,
            filename: rep.filename,
            bytes: rep.bytes
          });
        } else if (rep.type === 'image') {
          const imgDoc = await PDFLib.PDFDocument.load(rep.bytes.slice(0), { ignoreEncryption: true });
          const repPdfjsDoc = await pdfjsLib.getDocument({ data: rep.bytes.slice(0) }).promise;
          replacedPagesMap.set(rep.pageNum, {
            type: 'image',
            pdfjsDoc: repPdfjsDoc,
            pdfLibDoc: imgDoc,
            filename: rep.filename,
            dataUrl: rep.dataUrl,
            bytes: rep.bytes
          });
        }

        const card = document.querySelector(`.page-card[data-page-num="${rep.pageNum}"]`);
        if (card) {
          const canvas = card.querySelector('canvas');
          const ratioSpan = card.querySelector('.ratio-tag');
          if (canvas && ratioSpan) {
            await renderSingleCanvas(rep.pageNum, canvas, ratioSpan);
          }
          let repBadge = card.querySelector('.replaced-tag');
          if (!repBadge) {
            repBadge = document.createElement('div');
            repBadge.className = 'replaced-tag';
            card.appendChild(repBadge);
          }
          repBadge.title = `Đã thay thế trang bằng: ${rep.filename}`;
          repBadge.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Đã thay`;
        }
      }
    }

    // 5. Khôi phục cấu hình Sheet & Output Filename
    if (savedData.sheetConfig) {
      const sheetUrlInput = document.getElementById('sheetUrlInput');
      const sheetNameInput = document.getElementById('sheetNameInput');
      const sheetLimitInput = document.getElementById('sheetLimitInput');
      if (sheetUrlInput && savedData.sheetConfig.url) sheetUrlInput.value = savedData.sheetConfig.url;
      if (sheetNameInput && savedData.sheetConfig.sheetName) sheetNameInput.value = savedData.sheetConfig.sheetName;
      if (sheetLimitInput && savedData.sheetConfig.limit) sheetLimitInput.value = savedData.sheetConfig.limit;
    }
    if (savedData.outputFilename) {
      const outputFilenameInput = document.getElementById('outputFilenameInput');
      if (outputFilenameInput) outputFilenameInput.value = savedData.outputFilename;
    }

    // 6. Tái cấu trúc các Nhóm đã gom & DOM Layout
    if (Array.isArray(savedData.pdfGroups) && savedData.pdfGroups.length > 0) {
      pdfGroups = [];

      for (const groupData of savedData.pdfGroups) {
        const restoredGroup = {
          id: groupData.id,
          name: groupData.name,
          colorIndex: groupData.colorIndex,
          pageNumbers: [...groupData.pageNumbers],
          identifier: groupData.identifier || '',
          filenamesText: groupData.filenamesText || '',
          addDDK: groupData.addDDK !== false,
          sheetStatus: groupData.sheetStatus || 'pending',
          cccdName: groupData.cccdName || null,
          cccdFileType: groupData.cccdFileType || null,
          cccdFile: groupData.cccdFile || null
        };

        pdfGroups.push(restoredGroup);

        // Khôi phục hàng gom nhóm trên giao diện (Group Row Container)
        const minPage = Math.min(...restoredGroup.pageNumbers);
        const firstPageCard = document.querySelector(`.page-card[data-page-num="${minPage}"]`);

        const groupRowWrapper = document.createElement('div');
        groupRowWrapper.className = 'group-row-wrapper';
        groupRowWrapper.dataset.groupId = restoredGroup.id;

        const groupRowContainer = document.createElement('div');
        groupRowContainer.className = 'group-row-container';
        groupRowContainer.dataset.pageCount = restoredGroup.pageNumbers.length;
        const color = GROUP_COLORS[restoredGroup.colorIndex % GROUP_COLORS.length];
        groupRowContainer.style.borderColor = color.border;
        groupRowContainer.style.boxShadow = `0 6px 24px ${color.border}44`;

        const groupCardEl = createGroupCardElement(restoredGroup);
        groupRowContainer.appendChild(groupCardEl);
        groupRowWrapper.appendChild(groupRowContainer);

        const pagesGrid = document.getElementById('pagesGrid');
        if (firstPageCard && firstPageCard.parentNode === pagesGrid) {
          firstPageCard.before(groupRowWrapper);
        } else if (pagesGrid) {
          pagesGrid.appendChild(groupRowWrapper);
        }

        // Đưa các thẻ trang vào trong hàng nhóm
        restoredGroup.pageNumbers.sort((a, b) => a - b).forEach(pageNum => {
          const card = document.querySelector(`.page-card[data-page-num="${pageNum}"]`);
          if (card) {
            groupRowContainer.appendChild(card);
            updatePageGroupStyling(pageNum);
          }
        });

        // Điền lại giá trị đã nhập trên thẻ nhóm
        const idInput = groupCardEl.querySelector('.group-id-input');
        if (idInput && restoredGroup.identifier) {
          idInput.value = restoredGroup.identifier;
        }

        const nameInput = groupCardEl.querySelector('.group-filenames-input');
        if (nameInput && restoredGroup.filenamesText) {
          nameInput.value = restoredGroup.filenamesText;
        }

        const ddkCheckbox = groupCardEl.querySelector('.group-ddk-checkbox');
        if (ddkCheckbox) {
          ddkCheckbox.checked = restoredGroup.addDDK;
        }

        // Cập nhật CCCD UI nếu có
        if (restoredGroup.cccdFile) {
          updateGroupCccdUI(restoredGroup);
        }

        // Cập nhật trạng thái Sheet Status
        if (restoredGroup.sheetStatus && restoredGroup.sheetStatus !== 'pending') {
          updateGroupSheetStatusBadge(restoredGroup, restoredGroup.sheetStatus);
        }
      }
    }

    updateSelectionUI();
    renderGroupsUI();
    updateAutoSaveBadge(savedData.timestamp);

    showToast(`Đã khôi phục thành công toàn bộ phiên: "${savedData.originalFileName}" (${pdfGroups.length} nhóm)!`);

  } catch (err) {
    console.error('Lỗi khôi phục session:', err);
    showToast(`Lỗi khôi phục phiên: ${err.message}`, false);
  } finally {
    hideSpinner();
  }
}
