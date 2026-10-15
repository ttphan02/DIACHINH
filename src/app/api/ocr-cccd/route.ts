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
      .filter((k) => k && !k.startsWith('DIEN_API_KEY'))
      .map((k) => (k.startsWith('AQ.') ? k : Buffer.from(k, 'base64').toString('utf-8')));

    if (keys.length === 0) {
      return NextResponse.json({ success: false, error: 'Chưa cấu hình API Key AI' }, { status: 500 });
    }

    const promptText = `Bạn là chuyên gia trích xuất thông tin Căn cước công dân (CCCD / CMND / Thẻ Căn cước) Việt Nam.
Hãy đọc kỹ hình ảnh (kể cả ảnh chụp nghiêng, ngược, mặt trước hoặc mặt sau) và trả về CHÍNH XÁC một đối tượng JSON (không markdown, không giải thích gì thêm):
{
  "so_cccd": "12 chữ số viết liền (hoặc 9 số nếu CMND cũ)",
  "ho_va_ten": "Họ và tên đầy đủ viết hoa có dấu chuẩn xác (Ví dụ: PHAN THANH TRÚC)",
  "ngay_sinh": "DD/MM/YYYY",
  "gioi_tinh": "Nam hoặc Nữ",
  "que_quan": "Quê quán",
  "noi_thuong_tru": "Nơi thường trú"
}`;

    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);

    let lastError = '';

    for (const apiKey of shuffledKeys.slice(0, 6)) {
      for (const modelName of modelsToTry) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
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
            lastError = `${modelName} HTTP ${res.status}`;
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
            const rawCccd = String(parsed.so_cccd || '').replace(/\D/g, '');
            const rawName = String(parsed.ho_va_ten || '').replace(/["']/g, '').trim().toUpperCase();

            return NextResponse.json({
              success: true,
              data: {
                so_cccd: rawCccd,
                ho_va_ten: rawName,
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
    }

    return NextResponse.json(
      { success: false, error: `Không thể đọc CCCD qua AI: ${lastError}` },
      { status: 500 }
    );
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
