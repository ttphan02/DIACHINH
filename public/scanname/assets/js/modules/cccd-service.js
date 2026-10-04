// CCCD Files Management, Matching & Card Rendering Service

// Vẽ thumbnail cho trang CCCD (hỗ trợ cả PDF và Ảnh JPG/PNG/WebP)
async function renderCccdThumbnail(file, canvas, ratioTag) {
  if (!file || !canvas) return;
  try {
    const buffer = await file.arrayBuffer();
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const cccdDoc = await loadingTask.promise;
      const page = await cccdDoc.getPage(1);
      const viewport = page.getViewport({ scale: 0.8 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (ratioTag) ratioTag.textContent = `PDF • ${cccdDoc.numPages} trang • ${(file.size / 1024).toFixed(0)} KB`;
    } else {
      // File Ảnh
      const blobUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const maxW = 320;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.style.aspectRatio = `${img.width} / ${img.height}`;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(blobUrl);
        if (ratioTag) ratioTag.textContent = `Ảnh • ${img.naturalWidth}x${img.naturalHeight} • ${(file.size / 1024).toFixed(0)} KB`;
      };
      img.src = blobUrl;
    }
  } catch (err) {
    console.warn('Lỗi vẽ thumbnail CCCD:', err);
    if (ratioTag) ratioTag.textContent = `CCCD • ${(file.size / 1024).toFixed(0)} KB`;
  }
}

// Cập nhật giao diện Box CCCD trên thẻ nhóm và số lượng trang
function updateGroupCccdUI(group) {
  if (!group) return;
  const groupRowWrapper = document.querySelector(`.group-row-wrapper[data-group-id="${group.id}"]`);
  if (!groupRowWrapper) return;
  
  const card = groupRowWrapper.querySelector('.group-card-item');
  if (card) {
    const cccdBox = card.querySelector('.group-cccd-box');
    if (cccdBox) {
      if (group.cccdFile) {
        cccdBox.style.border = '1px solid #0ea5e9';
        cccdBox.style.background = 'rgba(14, 165, 233, 0.16)';
        cccdBox.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
            <i class="fa-solid fa-id-card" style="color: #38bdf8; font-size: 15px;"></i>
            <div style="font-size: 12.5px; font-weight: 600; color: #e0f2fe; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              Đã nối CCCD: <strong style="color: #38bdf8;">${(group.cccdName || group.cccdFile.name).replace(/</g, '&lt;')}</strong>
            </div>
          </div>
          <div style="display: flex; gap: 6px; flex-shrink: 0;">
            <button class="sheet-btn btn-pick-single-cccd" data-group-id="${group.id}" style="padding: 4px 10px; font-size: 11.5px; font-weight: 700; background: rgba(14, 165, 233, 0.25); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);" title="Đổi file CCCD khác cho nhóm này">
              <i class="fa-solid fa-paperclip"></i> Đổi
            </button>
            <button class="sheet-btn btn-remove-single-cccd" data-group-id="${group.id}" style="padding: 4px 8px; font-size: 11.5px; font-weight: 700; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);" title="Gỡ file CCCD khỏi nhóm">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        `;
      } else {
        cccdBox.style.border = '1px dashed rgba(255, 255, 255, 0.15)';
        cccdBox.style.background = 'rgba(14, 165, 233, 0.08)';
        cccdBox.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
            <i class="fa-solid fa-id-card" style="color: var(--text-muted); font-size: 15px;"></i>
            <div style="font-size: 12.5px; font-weight: 600; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              Chưa nối file CCCD
            </div>
          </div>
          <div style="display: flex; gap: 6px; flex-shrink: 0;">
            <button class="sheet-btn btn-pick-single-cccd" data-group-id="${group.id}" style="padding: 4px 10px; font-size: 11.5px; font-weight: 700; background: rgba(14, 165, 233, 0.25); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);" title="Chọn file CCCD riêng cho nhóm này">
              <i class="fa-solid fa-paperclip"></i> Nối
            </button>
          </div>
        `;
      }

      const pickBtn = cccdBox.querySelector('.btn-pick-single-cccd');
      if (pickBtn) {
        pickBtn.addEventListener('click', () => {
          targetCccdGroupId = group.id;
          const cccdSinglePicker = document.getElementById('cccdSinglePicker');
          if (cccdSinglePicker) {
            cccdSinglePicker.value = '';
            cccdSinglePicker.click();
          }
        });
      }
      const rmBtn = cccdBox.querySelector('.btn-remove-single-cccd');
      if (rmBtn) {
        rmBtn.addEventListener('click', () => {
          group.cccdFile = null;
          group.cccdName = '';
          const container = groupRowWrapper.querySelector('.group-row-container');
          const cCard = container?.querySelector('.cccd-page-card');
          if (cCard) cCard.remove();
          updateGroupCccdUI(group);
          showToast(`Đã gỡ file CCCD khỏi nhóm ${group.name}!`);
        });
      }
    }

    const pageCountSpan = card.querySelector('.group-card-header span');
    if (pageCountSpan) {
      const cccdText = group.cccdFile ? ' + 1 CCCD' : '';
      pageCountSpan.textContent = `${group.pageNumbers.length} trang${cccdText} (${group.pageNumbers.join(', ')})`;
    }
  }

  const container = groupRowWrapper.querySelector('.group-row-container');
  if (container) {
    container.dataset.pageCount = group.pageNumbers.length + (group.cccdFile ? 1 : 0);
  }
}

// TỰ ĐỘNG CHÈN TRANG CCCD VÀO ĐẦU NHÓM (NGAY SAU BẢNG ĐIỀU KHIỂN NHÓM, TRƯỚC TRANG 1 ĐƠN)
function attachCccdCardToGroup(group) {
  if (!group || !group.cccdFile) return;
  const groupRowWrapper = document.querySelector(`.group-row-wrapper[data-group-id="${group.id}"]`);
  if (!groupRowWrapper) return;
  const container = groupRowWrapper.querySelector('.group-row-container');
  if (!container) return;

  // Xóa thẻ CCCD cũ nếu đã có
  const existing = container.querySelector('.cccd-page-card');
  if (existing) existing.remove();

  // Tạo thẻ Trang CCCD trực quan
  const cccdCard = document.createElement('div');
  cccdCard.className = 'page-card cccd-page-card';
  cccdCard.dataset.groupId = group.id;

  const topBar = document.createElement('div');
  topBar.className = 'card-top-bar';

  const numBadge = document.createElement('div');
  numBadge.className = 'page-num-badge';
  numBadge.innerHTML = `<i class="fa-solid fa-id-card"></i> Trang CCCD`;

  const actionsGroup = document.createElement('div');
  actionsGroup.className = 'card-action-buttons';

  const zoomBtn = document.createElement('button');
  zoomBtn.className = 'card-btn btn-zoom';
  zoomBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i>';
  zoomBtn.title = 'Xem phóng to toàn bộ trang CCCD';
  zoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCccdZoomModal(group);
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'card-btn btn-remove-cccd';
  removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  removeBtn.title = 'Gỡ trang CCCD khỏi nhóm này';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    group.cccdFile = null;
    group.cccdName = '';
    cccdCard.remove();
    updateGroupCccdUI(group);
    showToast(`Đã gỡ trang CCCD khỏi nhóm ${group.name}!`);
  });

  actionsGroup.appendChild(zoomBtn);
  actionsGroup.appendChild(removeBtn);
  topBar.appendChild(numBadge);
  topBar.appendChild(actionsGroup);

  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'canvas-wrapper';
  const canvas = document.createElement('canvas');
  canvasWrapper.appendChild(canvas);

  const footer = document.createElement('div');
  footer.className = 'page-meta-footer';
  const ratioSpan = document.createElement('span');
  ratioSpan.className = 'ratio-tag';
  ratioSpan.textContent = 'Đang tải CCCD...';
  footer.appendChild(ratioSpan);

  cccdCard.appendChild(topBar);
  cccdCard.appendChild(canvasWrapper);
  cccdCard.appendChild(footer);

  // Chèn trang CCCD ngay sau thẻ điều khiển nhóm (vị trí đầu tiên trong dãy trang)
  const groupCardEl = container.querySelector('.group-card-item');
  if (groupCardEl && groupCardEl.nextSibling) {
    container.insertBefore(cccdCard, groupCardEl.nextSibling);
  } else {
    container.appendChild(cccdCard);
  }

  updateGroupCccdUI(group);
  renderCccdThumbnail(group.cccdFile, canvas, ratioSpan);
}

// Xem phóng to trang CCCD trong Modal
async function openCccdZoomModal(group) {
  if (!group || !group.cccdFile) return;
  const zoomModal = document.getElementById('zoomModal');
  const modalPageTitle = document.getElementById('modalPageTitle');
  const modalCanvas = document.getElementById('modalCanvas');
  if (!zoomModal || !modalCanvas) return;

  modalPageTitle.textContent = `Xem Chi Tiết CCCD: ${group.cccdName} (Nhóm: ${group.name})`;
  zoomModal.classList.add('active');

  try {
    const buffer = await group.cccdFile.arrayBuffer();
    const isPdf = group.cccdFile.type === 'application/pdf' || group.cccdFile.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const cDoc = await loadingTask.promise;
      const page = await cDoc.getPage(1);
      const viewport = page.getViewport({ scale: 2.0 });
      modalCanvas.width = viewport.width;
      modalCanvas.height = viewport.height;
      const ctx = modalCanvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
    } else {
      const blobUrl = URL.createObjectURL(group.cccdFile);
      const img = new Image();
      img.onload = () => {
        modalCanvas.width = img.naturalWidth;
        modalCanvas.height = img.naturalHeight;
        const ctx = modalCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(blobUrl);
      };
      img.src = blobUrl;
    }
  } catch (err) {
    console.warn('Lỗi phóng to CCCD:', err);
  }
}

function matchCccdForGroup(group) {
  if (group.cccdFile) {
    attachCccdCardToGroup(group);
    return true;
  }
  if ((!loadedCccdFilesMap || loadedCccdFilesMap.size === 0) && (!cccd12DigitMap || cccd12DigitMap.size === 0)) return false;

  const idCode = (group.identifier || '').trim();
  const cleanId12 = idCode.replace(/\D/g, '');
  const filenames = (group.filenamesText || '').split('\n').map(s => s.trim()).filter(Boolean);

  let matchedFile = null;

  // 1. Khớp chính xác theo mã 12 số CCCD
  if (cleanId12.length === 12 && cccd12DigitMap.has(cleanId12)) {
    matchedFile = cccd12DigitMap.get(cleanId12);
  }

  // 2. Khớp theo chuỗi con trong tên file
  if (!matchedFile && cleanId12.length >= 9) {
    for (const [key, file] of loadedCccdFilesMap.entries()) {
      if (key.includes(cleanId12)) {
        matchedFile = file;
        break;
      }
    }
  }

  // 3. Khớp theo tên file xuất / mã hồ sơ từ Google Sheet
  if (!matchedFile) {
    for (const fn of filenames) {
      const cleanFn = cleanFilenameKey(fn);
      if (!cleanFn) continue;
      for (const [key, file] of loadedCccdFilesMap.entries()) {
        if (key.includes(cleanFn) || cleanFn.includes(key)) {
          matchedFile = file;
          break;
        }
      }
      if (matchedFile) break;

      const matchToThua = fn.match(/\b\d+_\d+\b/);
      if (matchToThua) {
        const cleanToThua = matchToThua[0].replace('_', '');
        for (const [key, file] of loadedCccdFilesMap.entries()) {
          if (key.includes(cleanToThua)) {
            matchedFile = file;
            break;
          }
        }
      }
      if (matchedFile) break;
    }
  }

  if (matchedFile) {
    group.cccdFile = matchedFile;
    group.cccdName = matchedFile.name;
    attachCccdCardToGroup(group);
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    return true;
  }

  return false;
}

function matchAllCccd() {
  if (!pdfGroups || pdfGroups.length === 0) return 0;
  if (loadedCccdFilesMap.size === 0 && cccd12DigitMap.size === 0) return 0;
  let matchCount = 0;
  pdfGroups.forEach(group => {
    const had = !!group.cccdFile;
    if (matchCccdForGroup(group)) {
      if (!had) matchCount++;
    }
  });
  return matchCount;
}

async function handleCccdFolderUpload(files) {
  if (!files || files.length === 0) return;
  showSpinner(`Đang nạp và đối soát ${files.length} tệp từ thư mục CCCD...`);
  try {
    let validCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.startsWith('._')) continue;
      const ext = file.name.split('.').pop().toLowerCase();
      if (['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
        const cleanKey = cleanFilenameKey(file.name);
        loadedCccdFilesMap.set(cleanKey, file);

        const m = file.name.match(/\b\d{12}\b/) || file.name.match(/\d{12}/);
        if (m) {
          cccd12DigitMap.set(m[0], file);
        }
        validCount++;
      }
    }

    if (validCount === 0) {
      showToast('Không tìm thấy tệp PDF hoặc Ảnh CCCD hợp lệ trong thư mục đã chọn!', false);
      return;
    }

    const matched = matchAllCccd();
    renderGroupsUI();
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    if (matched > 0) {
      showToast(`Đã nạp ${validCount} file CCCD! Khớp và TỰ ĐỘNG CHÈN ${matched} / ${pdfGroups.length} trang CCCD vào đầu các nhóm.`);
    } else {
      showToast(`Đã nạp ${validCount} file CCCD thành công vào bộ nhớ.`);
    }
  } finally {
    hideSpinner();
  }
}
