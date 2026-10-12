import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { executeSyncToGoogleSheet } from '@/utils/syncGoogleSheets';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const ma_thua = (formData.get('ma_thua') as string) || '';

    if (!file) {
      return NextResponse.json({ success: false, error: 'Chưa đính kèm file scan' }, { status: 400 });
    }

    let fileName = file.name;
    if (ma_thua && !fileName.includes(ma_thua)) {
      const ext = fileName.split('.').pop() || 'pdf';
      fileName = `${ma_thua}_SCAN.${ext}`;
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const bucket = await getR2Binding();
    const r2Key = `scanhoso/${fileName}`;

    if (bucket) {
      await bucket.put(r2Key, bytes, {
        httpMetadata: {
          contentType: file.type || 'application/pdf',
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
    }

    const r2PublicUrl = `https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/${r2Key}`;

    // Lấy declarationsMap hiện có và kích hoạt đồng bộ
    let declarationsMap: Record<string, any> = {};
    if (bucket) {
      try {
        const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
        if (declObj) {
          const payload = JSON.parse(await declObj.text());
          declarationsMap = payload.declarationsMap || {};
        }
      } catch (e) {
        console.warn('Lỗi đọc declarations:', e);
      }
    }

    // Tự động kích hoạt đồng bộ sang Google Sheet Realtime tức thì
    if (bucket) {
      executeSyncToGoogleSheet(declarationsMap, bucket).catch((err) =>
        console.error('Lỗi sync Google Sheet sau khi upload SCAN:', err)
      );
    }

    return NextResponse.json({
      success: true,
      fileName,
      r2Key,
      r2Url: r2PublicUrl,
      message: 'Đã lưu file scan vào R2 và tự động chuyển sang Giai đoạn 3 (NHẬP GGS) trên Google Sheet!',
    });
  } catch (error: any) {
    console.error('Lỗi POST /api/upload-scan:', error);
    return NextResponse.json({ success: false, error: error.message || 'Lỗi tải file scan' }, { status: 500 });
  }
}
