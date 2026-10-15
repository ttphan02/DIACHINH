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

    // Làm sạch và trích xuất đúng mimeType và base64
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

    const keys = (geminiKeys as string[])
      .filter((k) => k && typeof k === 'string' && !k.startsWith('DIEN_API_KEY'))
      .map((k) => (k.startsWith('AQ.') ? k : atob(k)));

    if (keys.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình API Key AI' },
        { status: 200 }
      );
    }

    const promptText = `Bạn là chuyên gia trích xuất thông tin Căn cước công dân / Thẻ căn cước Việt Nam.
Hãy đọc kỹ hình ảnh và trả về CHÍNH XÁC một đối tượng JSON (không thêm markdown hay chữ gì khác):
{
  "so_cccd": "12 chữ số viết liền hoặc 9 chữ số",
  "ho_va_ten": "Họ và tên đầy đủ viết hoa có dấu (Ví dụ: ĐẶNG THỊ HỒNG)"
}`;

    const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);
    let lastError = '';

    for (const apiKey of shuffledKeys.slice(0, 6)) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          lastError = `Gemini HTTP ${res.status}`;
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
