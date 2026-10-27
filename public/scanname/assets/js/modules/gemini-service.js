const DEFAULT_FALLBACK_KEYS = [
  "QVEuQWI4Uk42TFI3QlRwMHRhaEQ0Um82V043d1hFbEJHSHlEblU5R3c5TU1vLXpaY19kVmc=",
  "QVEuQWI4Uk42S1RtLXBSMGEyY1NaLUlUNm9acG9oUDJ1cnR4TzRvY3NGN1NZX0JBT3JDMEE=",
  "QVEuQWI4Uk42SkZ1X3hTZ2lxOUlxUi0wb241UGxmMFVVZjN0NUlWMEJqNnYyYzRpRFo3dUE=",
  "QVEuQWI4Uk42S2VTNFc1WmhyZDRPU3RfcGhnd010SDhTWmIwNWhjTExZN0oxaEFvUGZPZkE=",
  "QVEuQWI4Uk42TGdtSWVXZDFTSmdKOWFIVDg1Z2xkd01fY0dfanU5WnR2M1pYZ0I1UUIwRmc=",
  "QVEuQWI4Uk42SW4ycEJKSEluVnY3UDRWZ0lMcWpYWTB6bGFNbDZHdDc1a0tSdDhQMFFiY0E=",
  "QVEuQWI4Uk42S1ktVDVTZW11bVJtQVlWUTJya2dyNHNOT1pSMUMtMGp0X3l5U0RPLW9MQ1E=",
  "QVEuQWI4Uk42SUFPRkM5WlpfM3RqcnFHcHZrdTNMSlBzOXd1dEtyajVIOWhXN1JnekhxLUE=",
  "QVEuQWI4Uk42Sm05UkU4Y3BrWUhDQm9hOXVmTnRqTkM1b25Ibktjb2ZVeVR2MHI5RVBhNmc="
];

async function loadGeminiKeys() {
  try {
    const saved = localStorage.getItem('user_gemini_keys');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        geminiKeys = parsed.map(k => (k.startsWith('AQ.') ? k : atob(k)));
        console.log(`Đã tải ${geminiKeys.length} API Key từ localStorage.`);
        return;
      }
    }
  } catch (e) {}

  // If running via HTTP server, fetch local keys file safely
  if (window.location.protocol.startsWith('http')) {
    try {
      const res = await fetch('data/gemini_keys.json');
      if (res.ok) {
        const keys = await res.json();
        if (Array.isArray(keys) && keys.length > 0) {
          geminiKeys = keys.map(k => (k.startsWith('AQ.') ? k : atob(k)));
        }
      }
    } catch (err) {}
  }

  // Luôn đảm bảo có sẵn danh sách keys dự phòng ngay cả khi fetch 404
  if (!geminiKeys || geminiKeys.length === 0) {
    geminiKeys = DEFAULT_FALLBACK_KEYS.map(k => atob(k));
    console.log(`Đã nạp ${geminiKeys.length} API Key dự phòng tích hợp.`);
  }
}

function getNextGeminiKey() {
  if (!geminiKeys || geminiKeys.length === 0) return null;
  const rawKey = geminiKeys[currentGeminiKeyIdx % geminiKeys.length];
  currentGeminiKeyIdx = (currentGeminiKeyIdx + 1) % geminiKeys.length;
  return rawKey.startsWith('AQ.') ? rawKey : atob(rawKey);
}

async function getPageJpegBase64(pageNum, scale = 2.0) {
  if (!currentPdfDoc) return null;
  let targetDoc = currentPdfDoc;
  let targetPageNumInDoc = pageNum;
  if (replacedPagesMap.has(pageNum)) {
    const rep = replacedPagesMap.get(pageNum);
    targetDoc = rep.pdfjsDoc;
    targetPageNumInDoc = 1;
  }
  const page = await targetDoc.getPage(targetPageNumInDoc);
  const userRotation = pageRotationMap.get(pageNum) || 0;
  const totalRotation = (page.rotate + userRotation) % 360;

  const viewport = page.getViewport({ scale: scale, rotation: totalRotation });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');

  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

async function callGeminiApiForCCCD(base64Image) {
  let attempts = 0;
  const maxAttempts = geminiKeys.length;
  let quota429Count = 0;
  const candidateModels = [
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest',
  ];

  while (attempts < maxAttempts) {
    const apiKey = getNextGeminiKey();
    if (!apiKey) break;

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
          contents: [
            {
              parts: [
                {
                  text: "Hãy tìm và trích xuất duy nhất 12 chữ số của mã Căn cước công dân (CCCD) hoặc Số Định danh cá nhân xuất hiện trong hình ảnh này. Chỉ trả về đúng 12 chữ số không có thêm bất kỳ ký tự, dấu cách hay lời giải thích nào khác."
                },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: base64Image
                  }
                }
              ]
            }
          ]
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          if (response.status === 429) {
            quota429Count++;
            console.warn(`Gemini API key ${apiKey.substring(0, 15)}... hết Quota (${model}).`);
          }
          continue;
        }

        const data = await response.json();
        const text = (data?.candidates?.[0]?.content?.parts || [])
          .map(p => p.text || '')
          .join('\n');
        const match = text.match(/\b\d{12}\b/) || text.replace(/\D/g, '').match(/\d{12}/);
        if (match) {
          return match[0];
        }
      } catch (err) {
        console.warn(`Lỗi gọi Gemini API (${model}): ${err.message}.`);
      }
    }
    attempts++;
  }

  if (quota429Count >= maxAttempts && maxAttempts > 0) {
    isGeminiQuotaExhausted = true;
    showToast('⚠️ Tất cả Gemini API Key hiện tại đều bị HẾT QUOTA (Lỗi HTTP 429)! Hệ thống sẽ tự động dùng Extract 12 trang 1 khi gom nhóm.', false);
  }
  return null;
}

async function scanGroupCCCDWithGemini(group) {
  if (!group || !group.pageNumbers || group.pageNumbers.length === 0) return;

  // Nếu API Key đã hết lượt dùng thì tự động chuyển sang Extract 12 trang 1 luôn
  if (isGeminiQuotaExhausted || !geminiKeys || geminiKeys.length === 0) {
    console.warn(`[${group.name}] API Key đã hết lượt dùng -> Tự động chuyển sang Extract 12 trang 1...`);
    await autoProcessGroupCCCDAndSheet(group);
    return;
  }

  const firstPageNum = group.pageNumbers[0];
  const card = document.querySelector(`.group-card-item[data-group-id="${group.id}"]`);
  const idInput = card ? card.querySelector('.group-id-input') : null;

  if (idInput) {
    idInput.value = 'Đang quét AI...';
    idInput.classList.remove('invalid-code-alert');
  }

  try {
    const base64Image = await getPageJpegBase64(firstPageNum, 2.0);
    if (!base64Image) throw new Error('Không thể tạo ảnh xem trước.');

    const code = await callGeminiApiForCCCD(base64Image);
    if (code) {
      group.identifier = code;
      if (idInput) {
        idInput.value = code;
        idInput.classList.remove('invalid-code-alert');
        idInput.dispatchEvent(new Event('input'));
      }

      // 1. TỰ ĐỘNG KHỚP VÀ CHÈN TRANG CCCD VÀO ĐẦU NHÓM NGAY LẬP TỨC
      const isMatched = matchCccdForGroup(group);
      if (isMatched) {
        showToast(`[${group.name}] Đã quét mã ${code} & TỰ ĐỘNG CHÈN trang CCCD (${group.cccdName}) vào đầu nhóm!`);
      }

      // 2. Tra cứu tên file từ danh bạ đơn kê khai có CCCD
      try {
        const names = await fetchNamesFromGoogleSheet(code);
        if (names.length > 0) {
          group.filenamesText = names.join('\n');
          group.sheetStatus = 'found';
          const freshCard = document.querySelector(`.group-card-item[data-group-id="${group.id}"]`) || card;
          if (freshCard) {
            const txtEl = freshCard.querySelector('.group-filename-input');
            if (txtEl) txtEl.value = group.filenamesText;
          }
          showToast(`[${group.name}] Đã lấy mã ${code} & tìm thấy ${names.length} tên file: ${names[0]}!`);
        } else {
          group.sheetStatus = 'not_found';
          showToast(`[${group.name}] Đã lấy mã ${code}, nhưng danh bạ đơn kê khai KHÔNG CÓ tên!`, false);
        }
      } catch (sheetErr) {
        console.warn(`Lỗi tra danh bạ tự động cho nhóm ${group.name}:`, sheetErr);
        group.sheetStatus = 'not_found';
      }
    } else {
      // Gemini không lấy được mã hoặc API key bị hết lượt dùng (HTTP 429) -> Tự động chuyển sang Extract 12
      console.warn(`[${group.name}] AI Gemini không lấy được mã hoặc hết Quota. Tự động chuyển sang Extract 12...`);
      if (isGeminiQuotaExhausted) {
        showToast(`[${group.name}] API Key hết lượt dùng -> Tự động chuyển sang Extract 12...`, false);
      }
      await autoProcessGroupCCCDAndSheet(group);
      return;
    }
  } catch (err) {
    console.error(`Quét Gemini thất bại cho nhóm ${group.name}:`, err);
    console.warn(`[${group.name}] Tự động fallback sang Extract 12...`);
    await autoProcessGroupCCCDAndSheet(group);
    return;
  } finally {
    validateGroupCode(group, idInput);
    group.pageNumbers.forEach(p => updatePageGroupStyling(p));
    updateGroupStatusSummaryUI();
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
  }
}

async function scanAllGroupsWithGemini() {
  if (!pdfGroups || pdfGroups.length === 0) {
    showToast('Chưa có nhóm nào được tạo! Vui lòng gom nhóm trước.', false);
    return;
  }

  showSpinner(`Đang quét AI Gemini & tự động tra danh bạ đơn kê khai cho ${pdfGroups.length} nhóm...`);
  try {
    for (let i = 0; i < pdfGroups.length; i++) {
      const group = pdfGroups[i];
      showSpinner(`Đang quét AI nhóm ${i + 1}/${pdfGroups.length}: ${group.name}...`);
      await scanGroupCCCDWithGemini(group);
    }

    const invalidCount = pdfGroups.filter(g => !/^\d{12}$/.test(g.identifier || '')).length;
    if (invalidCount > 0) {
      showToast(`Hoàn tất quét AI! Còn ${invalidCount} nhóm chưa có mã 12 số hợp lệ (đang báo ĐỎ).`, false);
    } else {
      showToast(`Hoàn tất quét AI & tra danh bạ đơn kê khai cho tất cả ${pdfGroups.length} nhóm!`);
    }
  } finally {
    hideSpinner();
    updateGroupStatusSummaryUI();
  }
}
