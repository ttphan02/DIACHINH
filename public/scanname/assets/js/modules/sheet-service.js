// Google Sheet Integration Service (Cached GViz & Optional Backend Proxy)

function fetchNamesFromGoogleSheet(identifier, forceRefresh = false) {
  return new Promise(async (resolve) => {
    const url = document.getElementById('sheetUrlInput')?.value.trim() || DEFAULT_SHEET_URL;
    const cleanId = String(identifier).replace(/\D/g, '');
    if (!url || (!identifier && !cleanId)) return resolve([]);

    const matchId = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!matchId) {
      showToast('Link Google Sheet không hợp lệ!', false);
      return resolve([]);
    }
    const matchGid = url.match(/[?&#]gid=([0-9]+)/);
    const gidParam = matchGid ? matchGid[1] : '';
    const sheet = document.getElementById('sheetNameInput')?.value.trim() || (typeof DEFAULT_SHEET_NAME !== 'undefined' ? DEFAULT_SHEET_NAME : 'THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)');
    const limit = parseInt(document.getElementById('sheetLimitInput')?.value, 10) || 500;

    const processTableData = (data) => {
      if (!data || !data.table || !data.table.rows) return [];
      const rows = data.table.rows;
      const recentRows = limit > 0 && limit < rows.length ? rows.slice(-limit) : rows;

      const matchedNames = [];
      for (let i = recentRows.length - 1; i >= 0; i--) {
        const row = recentRows[i];
        if (!row || !row.c) continue;

        // Check CCCD from Col G (index 6, new sheet) or Col K (index 10, old sheet)
        let cccdCandidates = [];
        [6, 10].forEach(idx => {
          const cell = row.c[idx];
          if (cell) {
            const v = cell.f != null ? String(cell.f).trim() : (cell.v != null ? String(cell.v).trim() : '');
            if (v) cccdCandidates.push(v);
          }
        });

        let isMatch = false;
        for (const valCCCD of cccdCandidates) {
          const cleanVal = valCCCD.replace(/\D/g, '');
          const normVal = cleanVal.padStart(12, '0');
          const normId = cleanId.padStart(12, '0');

          if (
            valCCCD === String(identifier).trim() ||
            (normVal.length === 12 && normVal === normId) ||
            (cleanVal.length >= 9 && cleanId.length >= 9 && (cleanVal === cleanId || normVal === normId))
          ) {
            isMatch = true;
            break;
          }
        }

        if (isMatch) {
          // Case 1: Col B (index 1) = Mã thửa (ví dụ: 276_213) ở sheet mới
          const cellB = row.c[1];
          const valB = cellB ? (cellB.f != null ? String(cellB.f).trim() : (cellB.v != null ? String(cellB.v).trim() : '')) : '';

          // Case 2: Col C (index 2) = Mã GCN (CHUACOGIAY_...) ở sheet cũ
          const cellC = row.c[2];
          const valC = cellC ? (cellC.f != null ? String(cellC.f).trim() : (cellC.v != null ? String(cellC.v).trim() : '')) : '';

          let gcnName = '';
          if (valB && /^\d+_\d+$/.test(valB)) {
            gcnName = `CHUACOGIAY_24478_${valB}`;
          } else if (valB && valB.startsWith('CHUACOGIAY')) {
            gcnName = valB;
          } else if (valC && valC.startsWith('CHUACOGIAY')) {
            gcnName = valC;
          } else if (valB) {
            gcnName = `CHUACOGIAY_24478_${valB}`;
          } else if (valC) {
            gcnName = valC;
          }

          if (gcnName && !matchedNames.includes(gcnName)) {
            matchedNames.push(gcnName);
          }
        }
      }
      return matchedNames;
    };

    // Nếu đã có cache và chưa hết hạn, tra cứu tức thì trong 1ms (không gọi mạng)
    if (!forceRefresh && cachedSheetData && (Date.now() - cachedSheetTime < SHEET_CACHE_TTL)) {
      return resolve(processTableData(cachedSheetData));
    }

    // JSONP GViz Fetcher
    const callbackName = 'gvizJsonpCb_' + Math.random().toString(36).substr(2, 9);
    let timeoutId = null;

    const cleanup = () => {
      delete window[callbackName];
      if (timeoutId) clearTimeout(timeoutId);
      const el = document.getElementById(callbackName);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    };

    window[callbackName] = function(data) {
      cleanup();
      cachedSheetData = data;
      cachedSheetTime = Date.now();
      resolve(processTableData(data));
    };

    const scriptTag = document.createElement('script');
    scriptTag.id = callbackName;
    scriptTag.src = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=responseHandler:${callbackName}&sheet=${encodeURIComponent(sheet)}`;

    scriptTag.onerror = function() {
      cleanup();
      // Fallback JSONP without sheet parameter (defaults to 1st sheet)
      const fbCallback = 'gvizJsonpCb_fb_' + Math.random().toString(36).substr(2, 9);
      const fbCleanup = () => {
        delete window[fbCallback];
        const fbEl = document.getElementById(fbCallback);
        if (fbEl && fbEl.parentNode) fbEl.parentNode.removeChild(fbEl);
      };
      window[fbCallback] = function(fbData) {
        fbCleanup();
        cachedSheetData = fbData;
        cachedSheetTime = Date.now();
        resolve(processTableData(fbData));
      };
      const fbScript = document.createElement('script');
      fbScript.id = fbCallback;
      fbScript.src = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=responseHandler:${fbCallback}`;
      fbScript.onerror = function() {
        fbCleanup();
        if (cachedSheetData) {
          resolve(processTableData(cachedSheetData));
        } else {
          showToast('Không thể kết nối đến Google Sheet!', false);
          resolve([]);
        }
      };
      document.body.appendChild(fbScript);
    };

    timeoutId = setTimeout(() => {
      if (window[callbackName]) {
        cleanup();
        if (cachedSheetData) {
          resolve(processTableData(cachedSheetData));
        } else {
          showToast('Tra cứu Google Sheet quá thời gian chờ (Timeout)!', false);
          resolve([]);
        }
      }
    }, 8000);

    document.body.appendChild(scriptTag);
  });
}

async function batchFetchSheetNames() {
  if (!pdfGroups || pdfGroups.length === 0) {
    showToast('Chưa có nhóm nào được tạo!', false);
    return;
  }

  let invalidGroups = [];
  pdfGroups.forEach(group => {
    const isValid = validateGroupCode(group);
    if (!isValid) invalidGroups.push(group);
  });

  if (invalidGroups.length > 0) {
    showToast(`Có ${invalidGroups.length} nhóm bị thiếu hoặc sai định dạng mã 12 số (báo ĐỎ). Vui lòng điền đủ 12 số trước khi lấy tên hàng loạt!`, false);
    return;
  }

  showSpinner(`Đang tra cứu tên hàng loạt từ Google Sheet cho ${pdfGroups.length} nhóm...`);
  try {
    let successCount = 0;
    for (let i = 0; i < pdfGroups.length; i++) {
      const group = pdfGroups[i];
      showSpinner(`Đang tra cứu nhóm ${i + 1}/${pdfGroups.length}: Mã ${group.identifier}...`);
      const names = await fetchNamesFromGoogleSheet(group.identifier);
      if (names.length > 0) {
        group.filenamesText = names.join('\n');
        group.sheetStatus = 'found';
        successCount++;
        const card = document.querySelector(`.group-card-item[data-group-id="${group.id}"]`);
        if (card) {
          const txtEl = card.querySelector('.group-filename-input');
          if (txtEl) txtEl.value = group.filenamesText;
        }
      } else {
        group.sheetStatus = 'not_found';
      }
      validateGroupCode(group);
    }
    showToast(`Đã tra cứu xong! Tìm thấy tên cho ${successCount}/${pdfGroups.length} nhóm.`);
  } catch (err) {
    showToast(`Lỗi khi tra cứu hàng loạt: ${err.message}`, false);
  } finally {
    hideSpinner();
    updateGroupStatusSummaryUI();
  }
}
