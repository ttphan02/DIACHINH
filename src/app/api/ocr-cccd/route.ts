import { NextResponse } from 'next/server';
import geminiKeys from '@/data/gemini_keys.json';

export const dynamic = 'force-dynamic';

function decodeCccd12(cccd: string): { nam_sinh?: string; gioi_tinh?: 'Nam' | 'Nữ' } {
  const clean = String(cccd || '').replace(/\D/g, '');
  if (clean.length === 12) {
    const code = clean.charAt(3);
    const yr = clean.substring(4, 6);
    let century = 1900;
    let gender: 'Nam' | 'Nữ' = 'Nam';
    if (code === '0') { century = 1900; gender = 'Nam'; }
    else if (code === '1') { century = 1900; gender = 'Nữ'; }
    else if (code === '2') { century = 2000; gender = 'Nam'; }
    else if (code === '3') { century = 2000; gender = 'Nữ'; }
    else if (code === '4') { century = 2100; gender = 'Nam'; }
    else if (code === '5') { century = 2100; gender = 'Nữ'; }
    else if (code === '6') { century = 2200; gender = 'Nam'; }
    else if (code === '7') { century = 2200; gender = 'Nữ'; }
    else if (code === '8') { century = 1800; gender = 'Nam'; }
    else if (code === '9') { century = 1800; gender = 'Nữ'; }
    else return {};
    return {
      nam_sinh: String(century + parseInt(yr, 10)),
      gioi_tinh: gender,
    };
  }
  return {};
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as any;
    const { imageBase64 } = body;

    if (!imageBase64) {
      return NextResponse.json(
        { success: false, error: 'Thiếu dữ liệu ảnh CCCD' },
        { status: 200 }
      );
    }

    let cleanB64 = imageBase64;
    let mimeType = 'image/jpeg';
    if (typeof imageBase64 === 'string' && imageBase64.includes(',')) {
      const parts = imageBase64.split(',');
      const match = parts[0].match(/:(.*?);/);
      if (match && match[1]) {
        mimeType = match[1];
      }
      cleanB64 = parts[1];
    }
    cleanB64 = cleanB64.replace(/\s+/g, '');

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

    const keys = (geminiKeys as string[])
      .filter((k) => k && typeof k === 'string' && !k.startsWith('DIEN_API_KEY'))
      .map(decodeBase64Key);

    if (keys.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình API Key AI' },
        { status: 200 }
      );
    }

    const promptText = `Bạn là chuyên gia trích xuất thông tin Căn cước công dân / Thẻ căn cước Việt Nam.
Hãy đọc kỹ hình ảnh và trả về CHÍNH XÁC một đối tượng JSON:
{
  "so_cccd": "12 chữ số viết liền hoặc 9 chữ số",
  "ho_va_ten": "Họ và tên đầy đủ viết hoa có dấu (Ví dụ: ĐẶNG THỊ HỒNG)",
  "nam_sinh": "4 chữ số năm sinh (Ví dụ: 1985 hoặc trích năm từ ngày tháng năm sinh)",
  "gioi_tinh": "Nam hoặc Nữ"
}`;

    // Sử dụng các model Flash có quota lớn và tốc độ cao nhất
    const candidateModels = [
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-flash-latest',
    ];

    const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);
    let lastError = '';
    const debugLogs: string[] = [];

    for (const apiKey of shuffledKeys.slice(0, 6)) {
      for (const model of candidateModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const payload = {
            contents: [
              {
                parts: [
                  { text: promptText },
                  {
                    inlineData: {
                      mimeType,
                      data: cleanB64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          };

          let res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          // Nếu model không thích hợp với responseMimeType, thử lại không có generationConfig
          if (!res.ok && res.status === 400) {
            delete (payload as any).generationConfig;
            res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
          }

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            lastError = `${model} HTTP ${res.status}: ${errText.slice(0, 80)}`;
            debugLogs.push(lastError);
            continue;
          }

          const data: any = await res.json();
          // Ghép toàn bộ text từ tất cả parts (vì các model thinking có thể để text ở part 2)
          const rawText = (data.candidates?.[0]?.content?.parts || [])
            .map((p: any) => p.text || '')
            .filter(Boolean)
            .join('\n')
            .trim();

          debugLogs.push(`${model} 200: textLen=${rawText.length}`);

          let parsed: any = null;
          try {
            parsed = JSON.parse(rawText);
          } catch {
            const match = rawText.match(/\{[\s\S]*?\}/);
            if (match) {
              try { parsed = JSON.parse(match[0]); } catch {}
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
              parsed.ho_va_ten ||
              parsed.ho_ten ||
              parsed.hoten ||
              parsed.name ||
              parsed.full_name ||
              ''
            ).replace(/["']/g, '').trim().toUpperCase();

            // Trích xuất năm sinh
            const ns = String(
              parsed.nam_sinh ||
              parsed.namsinh ||
              parsed.ngay_sinh ||
              parsed.dob ||
              parsed.birth_year ||
              ''
            ).trim();
            const yearMatch = ns.match(/\b(19\d{2}|20\d{2})\b/);
            if (yearMatch) {
              rawNamSinh = yearMatch[1];
            } else if (/^\d{4}$/.test(ns)) {
              rawNamSinh = ns;
            }

            // Trích xuất giới tính
            const gt = String(
              parsed.gioi_tinh ||
              parsed.gioitinh ||
              parsed.gender ||
              parsed.sex ||
              ''
            ).trim().toLowerCase();
            if (gt.includes('nữ') || gt.includes('nu') || gt === 'female' || gt === 'f') {
              rawGioiTinh = 'Nữ';
            } else if (gt.includes('nam') || gt === 'male' || gt === 'm') {
              rawGioiTinh = 'Nam';
            }
          }

          // Dự phòng trích xuất trực tiếp bằng regex từ toàn bộ chuỗi
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
            if (jsonNameMatch) {
              rawName = jsonNameMatch[1].trim().toUpperCase();
            }
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

          // Fallback giải mã chính xác 100% từ quy tắc 12 số CCCD của Bộ Công An
          if (rawCccd && rawCccd.length === 12) {
            const decoded = decodeCccd12(rawCccd);
            if (!rawNamSinh && decoded.nam_sinh) rawNamSinh = decoded.nam_sinh;
            if (!rawGioiTinh && decoded.gioi_tinh) rawGioiTinh = decoded.gioi_tinh;
          }

          if (rawCccd || rawName) {
            return NextResponse.json({
              success: true,
              data: {
                so_cccd: rawCccd,
                ho_va_ten: rawName,
                nam_sinh: rawNamSinh,
                gioi_tinh: rawGioiTinh,
              },
            });
          }
        } catch (err: any) {
          lastError = err.message || 'Lỗi gọi AI';
          debugLogs.push(lastError);
        }
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: `Không thể đọc CCCD tự động (${lastError || 'Ảnh mờ hoặc không nhận diện được chữ'})`,
        debugLogs,
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi máy chủ khi đọc CCCD' },
      { status: 200 }
    );
  }
}
