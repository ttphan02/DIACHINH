import { NextResponse } from 'next/server';
import geminiKeys from '@/data/gemini_keys.json';

export const dynamic = 'force-dynamic';

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
  "ho_va_ten": "Họ và tên đầy đủ viết hoa có dấu (Ví dụ: ĐẶNG THỊ HỒNG)"
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
            continue;
          }

          const data: any = await res.json();
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

          let parsed: any = null;
          try {
            parsed = JSON.parse(rawText);
          } catch {
            const match = rawText.match(/\{[\s\S]*\}/);
            if (match) parsed = JSON.parse(match[0]);
          }

          let rawCccd = '';
          let rawName = '';

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
          }

          // Dự phòng tìm số 12 số hoặc 9 số trực tiếp từ text
          if (!rawCccd || rawCccd.length < 9) {
            const digitMatch = rawText.match(/\b\d{12}\b/) || rawText.match(/\b\d{9}\b/);
            if (digitMatch) {
              rawCccd = digitMatch[0];
            }
          }

          if (rawCccd || rawName) {
            return NextResponse.json({
              success: true,
              data: {
                so_cccd: rawCccd,
                ho_va_ten: rawName,
              },
            });
          }
        } catch (err: any) {
          lastError = err.message || 'Lỗi gọi AI';
        }
      }
    }

    return NextResponse.json(
      { success: false, error: `Không thể đọc CCCD tự động (${lastError || 'Ảnh mờ hoặc không nhận diện được chữ'})` },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi máy chủ khi đọc CCCD' },
      { status: 200 }
    );
  }
}
