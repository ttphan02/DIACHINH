// Group Management, UI Rendering & Validation

async function createGroupFromSelected() {
  const selectedIndices = [];
  for (let i = 1; i <= totalPages; i++) {
    if (selectedPagesMap.get(i)) selectedIndices.push(i);
  }

  if (selectedIndices.length === 0) {
    showToast('Vui lòng chọn các trang PDF trước khi gom nhóm!', false);
    return;
  }

  // Remove selected pages from any existing groups
  pdfGroups.forEach(g => {
    g.pageNumbers = g.pageNumbers.filter(p => !selectedIndices.includes(p));
  });
  pdfGroups = pdfGroups.filter(g => g.pageNumbers.length > 0);

  const groupNum = pdfGroups.length + 1;
  const colorIndex = (groupNum - 1) % GROUP_COLORS.length;

  const newGroup = {
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    name: `Nhóm ${groupNum}`,
    colorIndex: colorIndex,
    pageNumbers: selectedIndices,
    identifier: '',
    filenamesText: `${originalFileName}-nhom${groupNum}`,
    addDDK: true,
    sheetStatus: 'pending'
  };

  if (isGeminiQuotaExhausted || !geminiKeys || geminiKeys.length === 0) {
    showToast(`Đã gom Nhóm ${groupNum} (${selectedIndices.length} trang). API Key hết lượt/chưa cấu hình -> Đang tự động Extract 12 trang 1 ngầm...`);
  } else {
    showToast(`Đã gom Nhóm ${groupNum} (${selectedIndices.length} trang). Đang tự động quét AI Gemini ngầm...`);
  }

  pdfGroups.push(newGroup);
  updateGroupStatusSummaryUI();

  // Reset main selection map
  for (let i = 1; i <= totalPages; i++) selectedPagesMap.set(i, false);

  updateSelectionUI();

  // Group Row Container: Force ALL pages of this group onto 1 SINGLE ROW
  const minPage = Math.min(...selectedIndices);
  const firstPageCard = document.querySelector(`.page-card[data-page-num="${minPage}"]`);

  const groupRowWrapper = document.createElement('div');
  groupRowWrapper.className = 'group-row-wrapper';
  groupRowWrapper.dataset.groupId = newGroup.id;

  const groupRowContainer = document.createElement('div');
  groupRowContainer.className = 'group-row-container';
  groupRowContainer.dataset.pageCount = selectedIndices.length;
  const color = GROUP_COLORS[newGroup.colorIndex % GROUP_COLORS.length];
  groupRowContainer.style.borderColor = color.border;
  groupRowContainer.style.boxShadow = `0 6px 24px ${color.border}44`;

  const groupCardEl = createGroupCardElement(newGroup);
  groupRowContainer.appendChild(groupCardEl);
  groupRowWrapper.appendChild(groupRowContainer);

  // STEP 1: Insert groupRowWrapper into pagesGrid FIRST at position of firstPageCard
  const pagesGrid = document.getElementById('pagesGrid');
  if (firstPageCard && firstPageCard.parentNode === pagesGrid) {
    firstPageCard.before(groupRowWrapper);
  } else if (pagesGrid) {
    pagesGrid.appendChild(groupRowWrapper);
  }

  // STEP 2: Move all selected page cards into groupRowContainer in numerical order
  selectedIndices.sort((a, b) => a - b).forEach(pageNum => {
    const card = document.querySelector(`.page-card[data-page-num="${pageNum}"]`);
    if (card) {
      groupRowContainer.appendChild(card);
    }
  });

  // STEP 3: Apply group styling & badges to cards
  selectedIndices.forEach(pageNum => updatePageGroupStyling(pageNum));

  // STEP 4: Tự động đối soát CCCD có sẵn & Quét AI / Extract 12
  matchCccdForGroup(newGroup);
  if (isGeminiQuotaExhausted || !geminiKeys || geminiKeys.length === 0) {
    autoProcessGroupCCCDAndSheet(newGroup);
  } else {
    scanGroupCCCDWithGemini(newGroup);
  }
  if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

function updatePageGroupStyling(pageNum) {
  const card = document.querySelector(`.page-card[data-page-num="${pageNum}"]`);
  if (!card) return;

  const group = pdfGroups.find(g => g.pageNumbers.includes(pageNum));
  let badge = card.querySelector('.page-group-badge');

  if (group) {
    const color = GROUP_COLORS[group.colorIndex % GROUP_COLORS.length];
    card.style.borderColor = color.border;
    card.style.boxShadow = `0 0 12px ${color.border}55`;

    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'page-group-badge';
      card.appendChild(badge);
    }
    badge.style.background = color.tagBg;
    badge.title = `${group.name}${group.identifier ? `: ${group.identifier}` : ''}`;
    badge.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${group.name}${group.identifier ? `: ${group.identifier}` : ''}`;
  } else {
    card.style.borderColor = '';
    card.style.boxShadow = '';
    if (badge) badge.remove();
  }
}

function createGroupCardElement(group) {
  const color = GROUP_COLORS[group.colorIndex % GROUP_COLORS.length];
  
  const card = document.createElement('div');
  card.className = 'group-card-item';
  card.dataset.groupId = group.id;
  card.style.borderColor = color.border;
  card.style.boxShadow = `0 6px 20px ${color.border}44`;

  card.innerHTML = `
    <div class="group-card-header" style="flex-direction: column; align-items: stretch; gap: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div class="group-name-badge" style="background: ${color.tagBg}; font-size: 16px; padding: 6px 16px; font-weight: 700;">
          <i class="fa-solid fa-layer-group"></i> ${group.name}
        </div>
        <span style="font-size: 13px; font-weight: 700; color: var(--text-muted);">${group.pageNumbers.length} trang (${group.pageNumbers.join(', ')})</span>
      </div>
      <div class="group-id-input-section" style="width: 100%; display: flex; flex-direction: column; gap: 8px;">
        <div class="group-id-input-box" style="width: 100%; padding: 8px 12px; display: flex; gap: 8px; align-items: center; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
          <span style="font-size: 13px; font-weight: 700; color: var(--text-muted); white-space: nowrap;">Mã 12 số:</span>
          <input type="text" class="group-id-input" value="${group.identifier}" placeholder="Mã 12 số..." data-group-id="${group.id}" style="flex: 1; font-size: 14px; font-weight: 700;">
        </div>
        <div class="group-id-buttons-row" style="display: flex; gap: 6px; width: 100%;">
          <button class="sheet-btn btn-extract-12" style="flex: 1; padding: 7px 8px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; border: none; white-space: nowrap; justify-content: center;" data-group-id="${group.id}" title="Trích xuất mã 12 số từ trang 1 nhóm này theo tọa độ & tự động chèn CCCD">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Extract 12
          </button>
          <button class="sheet-btn btn-scan-single-ai" style="flex: 1; padding: 7px 8px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #ec4899, #8b5cf6); color: #fff; border: none; white-space: nowrap; justify-content: center;" data-group-id="${group.id}" title="Quét AI CC-CD 12 số cho trang đầu nhóm này">
            <i class="fa-solid fa-microchip"></i> Quét AI
          </button>
          <button class="sheet-btn btn-lookup-group" style="flex: 1; padding: 7px 8px; font-size: 12px; font-weight: 700; white-space: nowrap; justify-content: center;" data-group-id="${group.id}" title="Tra cứu từ Google Sheet">
            <i class="fa-solid fa-rotate"></i> Tra Sheet
          </button>
        </div>
      </div>
    </div>
    <div class="group-card-body" style="flex-direction: column; gap: 14px;">
      <div class="group-filename-box" style="width: 100%; min-width: auto;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <label style="font-size: 13px; font-weight: 700; color: var(--text-sub);">Tên file xuất:</label>
          <label class="suffix-checkbox-label" style="font-size: 13px; font-weight: 600;">
            <input type="checkbox" class="chk-group-ddk" data-group-id="${group.id}" ${group.addDDK ? 'checked' : ''}>
            <span>Hậu tố <strong>-DDK</strong></span>
          </label>
        </div>
        <div class="filename-input-box" style="padding: 10px 12px; min-width: auto;">
          <textarea class="filename-input group-filename-input" rows="3" style="min-height: 68px; font-size: 14px; font-weight: 600; line-height: 1.5;" data-group-id="${group.id}" placeholder="Nhập tên file xuất...">${group.filenamesText}</textarea>
          <span class="file-ext-tag" style="font-size: 13px; font-weight: 700;">${group.addDDK ? '-DDK.pdf' : '.pdf'}</span>
        </div>
      </div>
      <div class="group-cccd-box" style="width: 100%; padding: 8px 12px; background: rgba(14, 165, 233, 0.08); border: 1px dashed ${group.cccdFile ? '#0ea5e9' : 'rgba(255, 255, 255, 0.15)'}; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
          <i class="fa-solid fa-id-card" style="color: ${group.cccdFile ? '#38bdf8' : 'var(--text-muted)'}; font-size: 15px;"></i>
          <div style="font-size: 12.5px; font-weight: 600; color: ${group.cccdFile ? '#e0f2fe' : 'var(--text-muted)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${group.cccdFile ? `Đã nối CCCD: <strong style="color: #38bdf8;">${(group.cccdName || group.cccdFile.name).replace(/</g, '&lt;')}</strong>` : `Chưa nối file CCCD`}
          </div>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0;">
          <button class="sheet-btn btn-pick-single-cccd" data-group-id="${group.id}" style="padding: 4px 10px; font-size: 11.5px; font-weight: 700; background: rgba(14, 165, 233, 0.25); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);" title="Chọn file CCCD riêng cho nhóm này">
            <i class="fa-solid fa-paperclip"></i> ${group.cccdFile ? 'Đổi' : 'Nối'}
          </button>
          ${group.cccdFile ? `
          <button class="sheet-btn btn-remove-single-cccd" data-group-id="${group.id}" style="padding: 4px 8px; font-size: 11.5px; font-weight: 700; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);" title="Gỡ file CCCD khỏi nhóm">
            <i class="fa-solid fa-xmark"></i>
          </button>` : ''}
        </div>
      </div>
      <div class="group-actions-box" style="display: flex; gap: 10px; width: 100%;">
        <button class="action-btn btn-download-group" data-group-id="${group.id}" style="flex: 1; background: linear-gradient(135deg, var(--accent-success), #047857); color: #fff; font-weight: 700; padding: 10px 16px; font-size: 14px; justify-content: center; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
          <i class="fa-solid fa-download"></i> Tải Nhóm
        </button>
        <button class="action-btn btn-delete-group" data-group-id="${group.id}" style="color: #fca5a5; border-color: rgba(239, 68, 68, 0.35); padding: 10px 16px; font-size: 14px; font-weight: 700;" title="Xóa nhóm này">
          <i class="fa-solid fa-trash"></i> Xóa
        </button>
      </div>
    </div>
  `;

  // Attach event listeners for this Group Card
  const pickCccdBtn = card.querySelector('.btn-pick-single-cccd');
  if (pickCccdBtn) {
    pickCccdBtn.addEventListener('click', () => {
      targetCccdGroupId = group.id;
      const singlePicker = document.getElementById('cccdSinglePicker');
      if (singlePicker) {
        singlePicker.value = '';
        singlePicker.click();
      }
    });
  }

  const removeCccdBtn = card.querySelector('.btn-remove-single-cccd');
  if (removeCccdBtn) {
    removeCccdBtn.addEventListener('click', () => {
      group.cccdFile = null;
      group.cccdName = '';
      renderGroupsUI();
      showToast(`Đã gỡ file CCCD khỏi nhóm ${group.name}!`);
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    });
  }

  const idInput = card.querySelector('.group-id-input');
  if (idInput) {
    validateGroupCode(group, idInput);

    const updateId = () => {
      group.identifier = idInput.value.trim();
      validateGroupCode(group, idInput);
      matchCccdForGroup(group);
      group.pageNumbers.forEach(p => updatePageGroupStyling(p));
      updateGroupStatusSummaryUI();
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    };
    idInput.addEventListener('input', updateId);
    idInput.addEventListener('change', updateId);
    idInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' && lookupBtn) lookupBtn.click();
    });
  }

  const extract12Btn = card.querySelector('.btn-extract-12');
  if (extract12Btn) {
    extract12Btn.addEventListener('click', async () => {
      showToast(`[${group.name}] Đang trích xuất mã 12 số từ trang 1 & tra Sheet...`);
      await autoProcessGroupCCCDAndSheet(group);
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    });
  }

  const scanAiBtn = card.querySelector('.btn-scan-single-ai');
  if (scanAiBtn) {
    scanAiBtn.addEventListener('click', async () => {
      await scanGroupCCCDWithGemini(group);
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    });
  }

  const lookupBtn = card.querySelector('.btn-lookup-group');
  if (lookupBtn) {
    lookupBtn.addEventListener('click', async () => {
      if (idInput && idInput.value.trim()) group.identifier = idInput.value.trim();
      if (!group.identifier) {
        showToast('Vui lòng nhập Mã 12 số để tra cứu!', false);
        return;
      }
      showSpinner(`Đang tra cứu mã ${group.identifier} từ Google Sheet...`);
      try {
        const names = await fetchNamesFromGoogleSheet(group.identifier);
        if (names.length > 0) {
          group.filenamesText = names.join('\n');
          group.sheetStatus = 'found';
          const txtEl = card.querySelector('.group-filename-input');
          if (txtEl) txtEl.value = group.filenamesText;
          showToast(`Đã tìm thấy ${names.length} tên file cho mã ${group.identifier}!`);
        } else {
          group.sheetStatus = 'not_found';
          showToast(`Không tìm thấy mã ${group.identifier} trong ${document.getElementById('sheetLimitInput')?.value || 100} dòng mới nhất.`, false);
        }
      } finally {
        hideSpinner();
        validateGroupCode(group, idInput);
        updateGroupStatusSummaryUI();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
      }
    });
  }

  const txt = card.querySelector('.group-filename-input');
  if (txt) {
    txt.addEventListener('input', (e) => {
      group.filenamesText = e.target.value;
      updateGroupStatusSummaryUI();
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    });
  }

  const chk = card.querySelector('.chk-group-ddk');
  if (chk) {
    chk.addEventListener('change', (e) => {
      group.addDDK = e.target.checked;
      const extTag = card.querySelector('.file-ext-tag');
      if (extTag) extTag.textContent = group.addDDK ? '-DDK.pdf' : '.pdf';
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    });
  }

  const dlBtn = card.querySelector('.btn-download-group');
  if (dlBtn) {
    dlBtn.addEventListener('click', async () => {
      await exportSingleGroup(group);
    });
  }

  const delBtn = card.querySelector('.btn-delete-group');
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      const pagesGrid = document.getElementById('pagesGrid');
      const removedPages = [...group.pageNumbers];
      pdfGroups = pdfGroups.filter(g => g.id !== group.id);
      
      const rowWrapper = pagesGrid.querySelector(`.group-row-wrapper[data-group-id="${group.id}"]`);
      
      removedPages.sort((a, b) => a - b).forEach(pageNum => {
        const pageCard = document.querySelector(`.page-card[data-page-num="${pageNum}"]`);
        if (pageCard && pagesGrid) {
          const allChildren = Array.from(pagesGrid.children);
          const nextElem = allChildren.find(child => {
            if (child === rowWrapper) return false;
            if (child.classList.contains('page-card')) {
              return parseInt(child.dataset.pageNum, 10) > pageNum;
            }
            if (child.classList.contains('group-row-wrapper')) {
              const grp = pdfGroups.find(g => g.id === child.dataset.groupId);
              if (grp && grp.pageNumbers.length > 0) {
                return Math.min(...grp.pageNumbers) > pageNum;
              }
            }
            return false;
          });

          if (nextElem) {
            nextElem.before(pageCard);
          } else {
            pagesGrid.appendChild(pageCard);
          }
        }
        updatePageGroupStyling(pageNum);
      });

      if (rowWrapper) rowWrapper.remove();
      updateGroupStatusSummaryUI();
      showToast('Đã xóa nhóm thành công!');
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    });
  }

  return card;
}

function renderGroupsUI() {
  const groupsContainer = document.getElementById('groupsContainer');
  const groupCountText = document.getElementById('groupCountText');

  if (!groupsContainer) return;

  if (pdfGroups.length === 0) {
    groupsContainer.style.display = 'none';
  } else {
    groupsContainer.style.display = 'flex';
    if (groupCountText) groupCountText.textContent = pdfGroups.length;
  }
  updateGroupStatusSummaryUI();
  calculateTotalExportFiles();
}

function validateGroupCode(group, idInput) {
  const card = document.querySelector(`.group-card-item[data-group-id="${group.id}"]`);
  if (!idInput && card) {
    idInput = card.querySelector('.group-id-input');
  }

  const val = (idInput ? idInput.value : group.identifier || '').trim();
  const isValid = /^\d{12}$/.test(val);

  if (idInput) {
    if (isValid) {
      idInput.classList.remove('invalid-code-alert');
    } else {
      idInput.classList.add('invalid-code-alert');
    }
  }

  if (card) {
    if (!isValid) {
      card.classList.add('invalid-code-alert');
      card.classList.remove('sheet-not-found-alert');
    } else if (group.sheetStatus === 'not_found') {
      card.classList.remove('invalid-code-alert');
      card.classList.add('sheet-not-found-alert');
    } else {
      card.classList.remove('invalid-code-alert');
      card.classList.remove('sheet-not-found-alert');
    }
  }
  return isValid;
}

function scrollToGroupCard(groupId) {
  const card = document.querySelector(`.group-card-item[data-group-id="${groupId}"]`);
  const wrapper = document.querySelector(`.group-row-wrapper[data-group-id="${groupId}"]`);
  const target = card || wrapper;

  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('card-focus-flash');
    void target.offsetWidth;
    target.classList.add('card-focus-flash');
    setTimeout(() => {
      target.classList.remove('card-focus-flash');
    }, 1800);
  } else {
    showToast(`Không tìm thấy vị trí nhóm!`, false);
  }
}

function updateGroupStatusSummaryUI() {
  const bar = document.getElementById('groupStatusSummaryBar');
  if (!bar) return;

  if (!pdfGroups || pdfGroups.length === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';

  const successGroups = [];
  const noCodeGroups = [];
  const notFoundGroups = [];

  pdfGroups.forEach(group => {
    const hasValidCode = /^\d{12}$/.test((group.identifier || '').trim());
    const filenames = (group.filenamesText || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const hasSheetName = filenames.length > 0 && !filenames[0].startsWith(`${originalFileName}-nhom`);

    if (!hasValidCode) {
      noCodeGroups.push(group);
    } else if (group.sheetStatus === 'not_found' || !hasSheetName) {
      notFoundGroups.push(group);
    } else {
      successGroups.push(group);
    }
  });

  let html = `
    <div class="status-pill success">
      <i class="fa-solid fa-circle-check"></i> Lấy mã & tên thành công: <strong>${successGroups.length}</strong> / ${pdfGroups.length} nhóm
    </div>
  `;

  if (noCodeGroups.length > 0) {
    html += `
      <div class="status-pill no-code">
        <i class="fa-solid fa-triangle-exclamation"></i> Không lấy được mã (${noCodeGroups.length} nhóm):
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-left: 4px;">
          ${noCodeGroups.map(g => `<span class="group-nav-tag no-code-tag" onclick="scrollToGroupCard('${g.id}')" title="Nhấn để cuộn đến ${g.name}"><i class="fa-solid fa-location-dot"></i> ${g.name}</span>`).join('')}
        </div>
      </div>
    `;
  }

  if (notFoundGroups.length > 0) {
    html += `
      <div class="status-pill not-found">
        <i class="fa-solid fa-magnifying-glass-chart"></i> Sheet không có tên (${notFoundGroups.length} nhóm):
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-left: 4px;">
          ${notFoundGroups.map(g => `<span class="group-nav-tag not-found-tag" onclick="scrollToGroupCard('${g.id}')" title="Nhấn để cuộn đến ${g.name}"><i class="fa-solid fa-location-dot"></i> ${g.name}</span>`).join('')}
        </div>
      </div>
    `;
  }

  bar.innerHTML = html;
}
