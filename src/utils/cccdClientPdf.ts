'use client';

import { PDFDocument } from 'pdf-lib';
import {
  CccdOcrResult,
  GEMINI_LITE_MODELS,
  callGeminiOcrEndpoint,
  getDecodedGeminiKeys,
  splitDataUrlBase64,
} from '@/utils/cccdOcrHelpers';

// Round-robin cursor & per-key 429 cooldown map to prevent freezing on rate limits
let clientKeyCursor = 0;
const keyCooldownUntil = new Map<string, number>();

export async function ocrCccdClientFirst(
  rawB64: string,
  options?: { timeoutMs?: number }
): Promise<CccdOcrResult | null> {
  const { mimeType, cleanB64 } = splitDataUrlBase64(rawB64);
  const keys = getDecodedGeminiKeys();
  const timeoutMs = options?.timeoutMs ?? 10000;

  if (keys.length > 0 && cleanB64) {
    const startIdx = clientKeyCursor;
    clientKeyCursor = (clientKeyCursor + 1) % keys.length;
    const now = Date.now();

    // Prioritize keys not currently in 429 cooldown
    const orderedKeys: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[(startIdx + i) % keys.length];
      if ((keyCooldownUntil.get(k) || 0) <= now) {
        orderedKeys.push(k);
      }
    }

    for (const apiKey of orderedKeys) {
      for (const model of GEMINI_LITE_MODELS) {
        const res = await callGeminiOcrEndpoint({
          apiKey,
          model,
          mimeType,
          cleanB64,
          timeoutMs,
        });
        if (res.ok && res.data) {
          return res.data;
        }
        // If this key is rate-limited / quota-blocked, cool down 60s and jump to next key immediately
        if (res.status === 429 || res.status === 403) {
          keyCooldownUntil.set(apiKey, Date.now() + 60000);
          break;
        }
      }
    }
  }

  // Fallback to server API route (e.g., if client blocks generativelanguage.googleapis.com)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const res = await fetch('/api/ocr-cccd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: rawB64 }),
      signal: controller.signal,
    });
    const data: any = await res.json();
    if (data?.success && data?.data) {
      return {
        so_cccd: data.data.so_cccd || '',
        ho_va_ten: data.data.ho_va_ten || '',
        nam_sinh: data.data.nam_sinh || '',
        gioi_tinh: data.data.gioi_tinh || '',
      };
    }
  } catch {
    // ignore
  } finally {
    clearTimeout(timer);
  }
  return null;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const clean = (commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl).replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Đóng gói 1 hoặc 2 ảnh CCCD thành file PDF chuẩn A4 ngay tại trình duyệt
 * để giảm ~95% CPU & RAM trên Cloudflare Worker (tránh Error 1102).
 */
export async function buildCccdA4PdfBytes(params: {
  frontBase64?: string | null;
  backBase64?: string | null;
  imageBase64?: string | null;
}): Promise<Uint8Array> {
  const { frontBase64, backBase64, imageBase64 } = params;
  const imgPrimary = imageBase64 || frontBase64;
  if (!imgPrimary && !backBase64) {
    throw new Error('Thiếu dữ liệu ảnh CCCD');
  }

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width: pageWidth, height: pageHeight } = page.getSize();

  const embedImage = async (b64: string) => {
    const bytes = dataUrlToUint8Array(b64);
    const isPng = b64.toLowerCase().startsWith('data:image/png');
    try {
      return isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    } catch {
      return isPng ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
    }
  };

  if (frontBase64 && backBase64) {
    const imgFront = await embedImage(frontBase64);
    const imgBack = await embedImage(backBase64);
    const maxBoxW = pageWidth - 80;
    const maxBoxH = (pageHeight - 120) / 2;

    const scaleFront = imgFront.scaleToFit(maxBoxW, maxBoxH);
    page.drawImage(imgFront, {
      x: (pageWidth - scaleFront.width) / 2,
      y: pageHeight - 60 - maxBoxH + (maxBoxH - scaleFront.height) / 2,
      width: scaleFront.width,
      height: scaleFront.height,
    });

    const scaleBack = imgBack.scaleToFit(maxBoxW, maxBoxH);
    page.drawImage(imgBack, {
      x: (pageWidth - scaleBack.width) / 2,
      y: 60 + (maxBoxH - scaleBack.height) / 2,
      width: scaleBack.width,
      height: scaleBack.height,
    });
  } else {
    const singleB64 = (frontBase64 || backBase64 || imgPrimary)!;
    const img = await embedImage(singleB64);
    const scale = img.scaleToFit(pageWidth - 80, pageHeight - 120);
    page.drawImage(img, {
      x: (pageWidth - scale.width) / 2,
      y: (pageHeight - scale.height) / 2,
      width: scale.width,
      height: scale.height,
    });
  }

  return pdfDoc.save();
}

export async function uploadCccdPdfSmart(params: {
  frontBase64?: string | null;
  backBase64?: string | null;
  imageBase64?: string | null;
  so_cccd?: string;
  ho_va_ten?: string;
  nam_sinh?: string;
  gioi_tinh?: string;
  ma_thua?: string;
  fileName?: string;
  skipSync?: boolean;
}): Promise<{ ok: boolean; status: number; statusText: string; data: any }> {
  const pdfBytes = await buildCccdA4PdfBytes({
    frontBase64: params.frontBase64,
    backBase64: params.backBase64,
    imageBase64: params.imageBase64,
  });

  const formData = new FormData();
  const pdfCopy = new Uint8Array(pdfBytes.byteLength);
  pdfCopy.set(pdfBytes);
  formData.append('pdfFile', new Blob([pdfCopy.buffer], { type: 'application/pdf' }), 'cccd.pdf');
  if (params.so_cccd) formData.append('so_cccd', params.so_cccd);
  if (params.ho_va_ten) formData.append('ho_va_ten', params.ho_va_ten);
  if (params.nam_sinh) formData.append('nam_sinh', params.nam_sinh);
  if (params.gioi_tinh) formData.append('gioi_tinh', params.gioi_tinh);
  if (params.ma_thua) formData.append('ma_thua', params.ma_thua);
  if (params.fileName) formData.append('fileName', params.fileName);
  if (params.skipSync) formData.append('skipSync', 'true');

  let lastStatus = 0;
  let lastStatusText = '';
  let lastData: any = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch('/api/upload-cccd-pdf', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      lastStatus = res.status;
      lastStatusText = res.statusText || '';
      const text = await res.text();
      try {
        if (text) lastData = JSON.parse(text);
      } catch {
        lastData = null;
      }

      if (res.ok && lastData?.success) {
        return { ok: true, status: res.status, statusText: lastStatusText, data: lastData };
      }
      if (res.status < 500 && res.status !== 429) {
        return { ok: false, status: res.status, statusText: lastStatusText, data: lastData };
      }
    } catch (err: any) {
      lastData = { error: err?.name === 'AbortError' ? 'Timeout tải lên R2' : (err?.message || 'Lỗi mạng') };
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  return { ok: false, status: lastStatus, statusText: lastStatusText, data: lastData };
}
