import { NextResponse } from 'next/server';
import geminiKeys from '@/data/gemini_keys.json';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as any;
    const { imageBase64 } = body;

    if (!imageBase64) {
      return NextResponse.json({ success: false, error: 'Thiếu dữ liệu ảnh CCCD' }, { status: 400 });
    }

    // Làm sạch base64
    const cleanB64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');

    const keys = (geminiKeys as string[])
      .filter((k) => k && !k.startsWith('DIEN_API_KEY'))
      .map((k) => (k.startsWith('AQ.') ? k : Buffer.from(k, 'base64').toString('utf-8')));
    if (keys.length === 0) {
      return NextResponse.json({ success: false, error: 'Chưa cấu hình API Key AI' }, { status: 500 });
    }

    const promptText = `Bạn là chuyên gia trích xuất thông tin Căn cước công dân (CCCD/CMND) Việt Nam.
Hãy đọc kỹ hình ảnh và trả về CHÍNH XÁC một đối tượng JSON (không markdown, không giải thích gì thêm):
{
  "so_cccd": "12 chữ số viết liền (hoặc 9 số nếu CMND cũ)",
  "ho_va_ten": "Họ và tên đầy đủ viết hoa có dấu chuẩn xác (Ví dụ: PHAN THANH TRÚC)",
  "ngay_sinh": "DD/MM/YYYY",
  "gioi_tinh": "Nam hoặc Nữ",
  "que_quan": "Quê quán",
  "noi_thuong_tru": "Nơi thường trú"
}`;

    let lastError = '';
    const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);

    for (const apiKey of shuffledKeys.slice(0, 4)) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const payload = {
          contents: [
            {
              parts: [
                { text: promptText },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
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

        if (parsed && (parsed.so_cccd || parsed.ho_va_ten)) {
          return NextResponse.json({
            success: true,
            data: {
              so_cccd: String(parsed.so_cccd || '').replace(/\D/g, ''),
              ho_va_ten: String(parsed.ho_va_ten || '').trim(),
              ngay_sinh: String(parsed.ngay_sinh || '').trim(),
              gioi_tinh: String(parsed.gioi_tinh || '').trim(),
              que_quan: String(parsed.que_quan || '').trim(),
              noi_thuong_tru: String(parsed.noi_thuong_tru || '').trim(),
            },
          });
        }
      } catch (err: any) {
        lastError = err.message || 'Lỗi gọi AI';
      }
    }

    return NextResponse.json(
      { success: false, error: `Không thể đọc CCCD qua AI: ${lastError}` },
      { status: 500 }
    );
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
