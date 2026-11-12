import { NextResponse } from 'next/server';
import {
  GEMINI_LITE_MODELS,
  callGeminiOcrEndpoint,
  getDecodedGeminiKeys,
  splitDataUrlBase64,
} from '@/utils/cccdOcrHelpers';

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

    const { mimeType, cleanB64 } = splitDataUrlBase64(imageBase64);
    const keys = getDecodedGeminiKeys();

    if (keys.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình API Key AI' },
        { status: 200 }
      );
    }

    const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);
    let lastError = '';
    const debugLogs: string[] = [];

    // Giới hạn tối đa 5 key mỗi request và thoát vòng model ngay khi gặp 429/403 để tránh treo Worker
    for (const apiKey of shuffledKeys.slice(0, 5)) {
      for (const model of GEMINI_LITE_MODELS) {
        const res = await callGeminiOcrEndpoint({
          apiKey,
          model,
          mimeType,
          cleanB64,
          timeoutMs: 9000,
        });

        if (res.ok && res.data) {
          return NextResponse.json({
            success: true,
            data: res.data,
          });
        }

        lastError = `${model} HTTP ${res.status}: ${res.errorText || ''}`;
        debugLogs.push(lastError);

        if (res.status === 429 || res.status === 403) {
          break;
        }
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: `Không thể đọc CCCD tự động (${lastError || 'Ảnh mờ hoặc đang giới hạn tốc độ AI'})`,
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
