import geminiKeys from '@/data/gemini_keys.json';

export const GEMINI_LITE_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
] as const;

export const CCCD_OCR_PROMPT = `Bạn là chuyên gia trích xuất thông tin Căn cước công dân / Thẻ căn cước Việt Nam.
Hãy đọc kỹ hình ảnh và trả về CHÍNH XÁC một đối tượng JSON:
{
  "so_cccd": "12 chữ số viết liền hoặc 9 chữ số",
  "ho_va_ten": "Họ và tên đầy đủ viết hoa có dấu (Ví dụ: ĐẶNG THỊ HỒNG)",
  "nam_sinh": "4 chữ số năm sinh (Ví dụ: 1985 hoặc trích năm từ ngày tháng năm sinh)",
  "gioi_tinh": "Nam hoặc Nữ"
}`;

export interface CccdOcrResult {
  so_cccd: string;
  ho_va_ten: string;
  nam_sinh: string;
  gioi_tinh: string;
}

export function decodeCccd12(cccd: string): { nam_sinh?: string; gioi_tinh?: 'Nam' | 'Nữ' } {
  const clean = String(cccd || '').replace(/\D/g, '');
  if (clean.length !== 12) return {};
  const code = clean.charAt(3);
  const yr = clean.substring(4, 6);
  const centuryMap: Record<string, [number, 'Nam' | 'Nữ']> = {
    '0': [1900, 'Nam'],
    '1': [1900, 'Nữ'],
    '2': [2000, 'Nam'],
    '3': [2000, 'Nữ'],
    '4': [2100, 'Nam'],
    '5': [2100, 'Nữ'],
    '6': [2200, 'Nam'],
    '7': [2200, 'Nữ'],
    '8': [1800, 'Nam'],
    '9': [1800, 'Nữ'],
  };
  const entry = centuryMap[code];
  if (!entry) return {};
  return {
    nam_sinh: String(entry[0] + parseInt(yr, 10)),
    gioi_tinh: entry[1],
  };
}

function decodeBase64Key(k: string): string {
  if (k.startsWith('AQ.')) return k;
  try {
    if (typeof atob === 'function') return atob(k);
  } catch {}
  try {
    if (typeof Buffer !== 'undefined') return Buffer.from(k, 'base64').toString('utf8');
  } catch {}
  return k;
}

export function getDecodedGeminiKeys(): string[] {
  return (geminiKeys as string[])
    .filter((k) => k && typeof k === 'string' && !k.startsWith('DIEN_API_KEY'))
    .map(decodeBase64Key);
}

export function splitDataUrlBase64(rawB64: string): { mimeType: string; cleanB64: string } {
  let cleanB64 = rawB64;
  let mimeType = 'image/jpeg';
  if (typeof rawB64 === 'string' && rawB64.includes(',')) {
    const parts = rawB64.split(',');
    const match = parts[0].match(/:(.*?);/);
    if (match && match[1]) {
      mimeType = match[1];
    }
    cleanB64 = parts[1];
  }
  return {
    mimeType,
    cleanB64: String(cleanB64 || '').replace(/\s+/g, ''),
  };
}

export function parseGeminiCccdResponse(rawText: string): CccdOcrResult | null {
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {}
    }
  }

  let rawCccd = '';
  let rawName = '';
  let rawNamSinh = '';
  let rawGioiTinh = '';

  if (parsed) {
    rawCccd = String(
      parsed.so_cccd ||
        parsed.cccd ||
        parsed.so_dinh_danh ||
        parsed.so_dinh_danh_ca_nhan ||
        parsed.id_number ||
        parsed.id ||
        ''
    ).replace(/\D/g, '');

    rawName = String(
      parsed.ho_va_ten || parsed.ho_ten || parsed.hoten || parsed.name || parsed.full_name || ''
    )
      .replace(/["']/g, '')
      .trim()
      .toUpperCase();

    const ns = String(
      parsed.nam_sinh || parsed.namsinh || parsed.ngay_sinh || parsed.dob || parsed.birth_year || ''
    ).trim();
    const yearMatch = ns.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearMatch) rawNamSinh = yearMatch[1];
    else if (/^\d{4}$/.test(ns)) rawNamSinh = ns;

    const gt = String(parsed.gioi_tinh || parsed.gioitinh || parsed.gender || parsed.sex || '')
      .trim()
      .toLowerCase();
    if (gt.includes('nữ') || gt.includes('nu') || gt === 'female' || gt === 'f') {
      rawGioiTinh = 'Nữ';
    } else if (gt.includes('nam') || gt === 'male' || gt === 'm') {
      rawGioiTinh = 'Nam';
    }
  }

  if (!rawCccd || rawCccd.length < 9) {
    const jsonCccdMatch = rawText.match(/"so_cccd"\s*:\s*"(\d+)"/i);
    if (jsonCccdMatch) {
      rawCccd = jsonCccdMatch[1];
    } else {
      const digitMatch = rawText.match(/\b\d{12}\b/) || rawText.match(/\b\d{9}\b/);
      if (digitMatch) rawCccd = digitMatch[0];
    }
  }

  if (!rawName) {
    const jsonNameMatch = rawText.match(/"ho_va_ten"\s*:\s*"([^"\\]+)"/i);
    if (jsonNameMatch) rawName = jsonNameMatch[1].trim().toUpperCase();
  }

  if (!rawNamSinh) {
    const jsonYearMatch = rawText.match(/"nam_sinh"\s*:\s*"([^"\\]+)"/i);
    if (jsonYearMatch) {
      const ym = jsonYearMatch[1].match(/\b(19\d{2}|20\d{2})\b/);
      if (ym) rawNamSinh = ym[1];
    }
  }

  if (!rawGioiTinh) {
    const jsonGenderMatch = rawText.match(/"gioi_tinh"\s*:\s*"([^"\\]+)"/i);
    if (jsonGenderMatch) {
      const gVal = jsonGenderMatch[1].toLowerCase();
      if (gVal.includes('nữ') || gVal.includes('nu')) rawGioiTinh = 'Nữ';
      else if (gVal.includes('nam')) rawGioiTinh = 'Nam';
    }
  }

  if (rawCccd && rawCccd.length === 12) {
    const decoded = decodeCccd12(rawCccd);
    if (!rawNamSinh && decoded.nam_sinh) rawNamSinh = decoded.nam_sinh;
    if (!rawGioiTinh && decoded.gioi_tinh) rawGioiTinh = decoded.gioi_tinh;
  }

  if (!rawCccd && !rawName) return null;
  return {
    so_cccd: rawCccd,
    ho_va_ten: rawName,
    nam_sinh: rawNamSinh,
    gioi_tinh: rawGioiTinh,
  };
}

export async function callGeminiOcrEndpoint(params: {
  apiKey: string;
  model: string;
  mimeType: string;
  cleanB64: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; data?: CccdOcrResult; errorText?: string }> {
  const { apiKey, model, mimeType, cleanB64, timeoutMs = 10000 } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload: any = {
    contents: [
      {
        parts: [
          { text: CCCD_OCR_PROMPT },
          { inlineData: { mimeType, data: cleanB64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok && res.status === 400) {
      delete payload.generationConfig;
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, status: res.status, errorText: errText.slice(0, 100) };
    }

    const json: any = await res.json();
    const rawText = (json.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || '')
      .filter(Boolean)
      .join('\n')
      .trim();

    const parsed = parseGeminiCccdResponse(rawText);
    if (parsed) {
      return { ok: true, status: 200, data: parsed };
    }
    return { ok: false, status: 200, errorText: 'Empty OCR parse result' };
  } catch (err: any) {
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 408 : 0,
      errorText: err?.name === 'AbortError' ? 'Timeout' : (err?.message || 'Network error'),
    };
  } finally {
    clearTimeout(timer);
  }
}
