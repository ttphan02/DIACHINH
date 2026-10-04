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
    const spreadsheetId = matchId[1];
    const sheet = document.getElementById('sheetNameInput')?.value.trim() || 'Trang tính1';
    const limit = parseInt(document.getElementById('sheetLimitInput')?.value, 10) || 100;

    const processTableData = (data) => {
      if (!data || !data.table || !data.table.rows) return [];
      const rows = data.table.rows;
      const recentRows = rows.slice(-limit);

      const matchedNames = [];
      for (let i = recentRows.length - 1; i >= 0; i--) {
        const row = recentRows[i];
        if (!row || !row.c) continue;

        const cellK = row.c[10];
        let valK = cellK ? (cellK.f != null ? String(cellK.f).trim() : (cellK.v != null ? String(cellK.v).trim() : '')) : '';

        const cellC = row.c[2];
        let valC = cellC ? (cellC.f != null ? String(cellC.f).trim() : (cellC.v != null ? String(cellC.v).trim() : '')) : '';

        const cleanK = valK.replace(/\D/g, '');
        const normK = cleanK.padStart(12, '0');
        const normId = cleanId.padStart(12, '0');

        const isMatch = (valK === String(identifier).trim()) ||
                        (normK.length === 12 && normK === normId) ||
                        (cleanK.length >= 10 && cleanId.length >= 10 && (cleanK === cleanId || normK === normId));

        if (isMatch && valC) {
          matchedNames.push(valC);
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
