// Service kết nối Nguồn Dữ Liệu: Đơn Kê Khai Có CCCD (Sẵn Sàng Đóng Tập)
// Tự động tải trước danh bạ từ /api/scanname/parcels để tra cứu tức thì trong 0ms

let cachedLocalStore = null;
let isLocalStoreLoading = false;
let cachedSheetData = null;
let cachedSheetTime = 0;

// Nạp danh bạ từ backend nội bộ
async function fetchLocalDeclarationsStore(force = false) {
  if (!force && cachedLocalStore) return cachedLocalStore;
  if (isLocalStoreLoading) {
    while (isLocalStoreLoading) {
      await new Promise((r) => setTimeout(r, 60));
    }
    if (cachedLocalStore) return cachedLocalStore;
  }

  isLocalStoreLoading = true;
  try {
    const res = await fetch(`/api/scanname/parcels${force ? '?force=true' : ''}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        cachedLocalStore = data;
        updateDataSourceBadgeUI(data);
        return data;
      }
    }
  } catch (err) {
    console.warn('Lỗi kết nối /api/scanname/parcels:', err);
  } finally {
    isLocalStoreLoading = false;
  }
  return null;
}

// Cập nhật giao diện trạng thái nguồn dữ liệu
function updateDataSourceBadgeUI(data) {
  const statusEl = document.getElementById('dataSourceStatusText');
  if (statusEl) {
    if (data && data.success) {
      const totalParcels = data.totalParcels || (data.records ? data.records.length : 0);
      const totalCccd = data.totalCccd || (data.cccdMap ? Object.keys(data.cccdMap).length : 0);
      statusEl.textContent = `✓ Đã kết nối: ${totalParcels} thửa đất có CCCD sẵn sàng đóng tập (${totalCccd} CCCD)`;
      statusEl.style.color = '#10b981';
    } else {
      statusEl.textContent = 'Chưa tải được danh bạ kê khai';
      statusEl.style.color = '#f59e0b';
    }
  }
}

// Tự động khởi tạo nạp danh bạ ngay khi tải trang
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    fetchLocalDeclarationsStore().catch(() => {});
  });
}

/**
 * Tra cứu mã GCN (CHUACOGIAY_24478_{to}_{thua}) theo số CCCD (12 số) hoặc mã thửa
 * ƯU TIÊN 1: Tra cứu từ Danh sách Đơn Kê Khai Có CCCD (Đóng Tập) nội bộ (0ms)
 * FALLBACK 2: Tra cứu qua Google Sheet nếu cấu hình
 */
function fetchNamesFromGoogleSheet(identifier, forceRefresh = false) {
  return new Promise(async (resolve) => {
    const rawId = String(identifier || '').trim();
    if (!rawId) return resolve([]);

    // 1. ƯU TIÊN SỐ 1: TRA CỨU TRỰC TIẾP TỪ NGUỒN ĐƠN KÊ KHAI CÓ CCCD (NỘI BỘ)
    try {
      const store = await fetchLocalDeclarationsStore(forceRefresh);
      if (store && (store.cccdMap || store.thuaMap)) {
        const cleanDigits = rawId.replace(/\D/g, '');
        const pad12 = cleanDigits.length > 0 && cleanDigits.length <= 12 ? cleanDigits.padStart(12, '0') : '';
        const matchedNames = [];

        // Tìm theo CCCD
        if (cleanDigits && store.cccdMap && store.cccdMap[cleanDigits]) {
          store.cccdMap[cleanDigits].forEach((n) => {
            if (!matchedNames.includes(n)) matchedNames.push(n);
          });
        }
        if (pad12 && store.cccdMap && store.cccdMap[pad12]) {
          store.cccdMap[pad12].forEach((n) => {
            if (!matchedNames.includes(n)) matchedNames.push(n);
          });
        }

        // Tìm theo mã thửa
        if (store.thuaMap && store.thuaMap[rawId]) {
          const n = store.thuaMap[rawId];
          if (!matchedNames.includes(n)) matchedNames.push(n);
        }
        const cleanThua = rawId.replace(/^CHUACOGIAY_24478_/i, '').trim();
        if (store.thuaMap && store.thuaMap[cleanThua]) {
          const n = store.thuaMap[cleanThua];
          if (!matchedNames.includes(n)) matchedNames.push(n);
        }

        if (matchedNames.length > 0) {
          return resolve(matchedNames);
        }

        // Thử gọi API tìm kiếm trực tiếp backend nếu trong bộ nhớ chưa thấy
        const qRes = await fetch(`/api/scanname/parcels?q=${encodeURIComponent(rawId)}`);
        if (qRes.ok) {
          const qData = await qRes.json();
          if (qData.success && qData.matchedNames && qData.matchedNames.length > 0) {
            return resolve(qData.matchedNames);
          }
        }
      }
    } catch (localErr) {
      console.warn('Lỗi tra cứu danh bạ nội bộ, thử fallback sang Google Sheet:', localErr);
    }

    // 2. FALLBACK SỐ 2: GOOGLE SHEET CÔNG KHAI (NẾU CÓ CẤU HÌNH)
    const url = document.getElementById('sheetUrlInput')?.value.trim() || DEFAULT_SHEET_URL;
    const cleanId = rawId.replace(/\D/g, '');
    if (!url || (!rawId && !cleanId)) return resolve([]);

    const matchId = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!matchId) return resolve([]);
    const spreadsheetId = matchId[1];
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

        let cccdCandidates = [];
        [6, 10].forEach((idx) => {
          const cell = row.c[idx];
          if (cell) {
            const v = cell.f != null ? String(cell.f).trim() : cell.v != null ? String(cell.v).trim() : '';
            if (v) cccdCandidates.push(v);
          }
        });

        let isMatch = false;
        for (const valCCCD of cccdCandidates) {
          const cleanVal = valCCCD.replace(/\D/g, '');
          const normVal = cleanVal.padStart(12, '0');
          const normId = cleanId.padStart(12, '0');

          if (
            valCCCD === String(rawId).trim() ||
            (normVal.length === 12 && normVal === normId) ||
            (cleanVal.length >= 9 && cleanId.length >= 9 && (cleanVal === cleanId || normVal === normId))
          ) {
            isMatch = true;
            break;
          }
        }

        if (isMatch) {
          const cellB = row.c[1];
          const valB = cellB ? (cellB.f != null ? String(cellB.f).trim() : cellB.v != null ? String(cellB.v).trim() : '') : '';
          const cellC = row.c[2];
          const valC = cellC ? (cellC.f != null ? String(cellC.f).trim() : cellC.v != null ? String(cellC.v).trim() : '') : '';

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

    if (!forceRefresh && cachedSheetData && Date.now() - cachedSheetTime < SHEET_CACHE_TTL) {
      return resolve(processTableData(cachedSheetData));
    }

    const callbackName = 'gvizJsonpCb_' + Math.random().toString(36).substr(2, 9);
    let timeoutId = null;

    const cleanup = () => {
      delete window[callbackName];
      if (timeoutId) clearTimeout(timeoutId);
      const el = document.getElementById(callbackName);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    };

    window[callbackName] = function (data) {
      cleanup();
      cachedSheetData = data;
      cachedSheetTime = Date.now();
      resolve(processTableData(data));
    };

    const scriptTag = document.createElement('script');
    scriptTag.id = callbackName;
    scriptTag.src = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=responseHandler:${callbackName}&sheet=${encodeURIComponent(sheet)}`;
    scriptTag.onerror = function () {
      cleanup();
      resolve([]);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      resolve([]);
    }, 4000);

    document.body.appendChild(scriptTag);
  });
}

// Tra cứu hàng loạt cho toàn bộ các nhóm
async function batchFetchSheetNames() {
  if (!pdfGroups || pdfGroups.length === 0) {
    showToast('Chưa có nhóm nào được tạo!', false);
    return;
  }

  let invalidGroups = [];
  pdfGroups.forEach((group) => {
    const isValid = validateGroupCode(group);
    if (!isValid) invalidGroups.push(group);
  });

  if (invalidGroups.length > 0) {
    showToast(`Có ${invalidGroups.length} nhóm bị thiếu hoặc sai định dạng mã 12 số (báo ĐỎ). Vui lòng điền đủ 12 số trước khi lấy tên hàng loạt!`, false);
    return;
  }

  showSpinner(`Đang tra cứu từ danh sách đơn kê khai có CCCD cho ${pdfGroups.length} nhóm...`);
  try {
    // Đảm bảo dữ liệu nội bộ đã sẵn sàng trước khi lặp
    await fetchLocalDeclarationsStore();

    let successCount = 0;
    for (let i = 0; i < pdfGroups.length; i++) {
      const group = pdfGroups[i];
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
