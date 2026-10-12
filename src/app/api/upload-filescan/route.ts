import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { executeSyncToGoogleSheet } from '@/utils/syncGoogleSheets';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const R2_PUBLIC_BASE = 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

// Chuyển base64 sang Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const cleanB64 = base64.replace(/^data:application\/pdf;base64,/, '').replace(/^data:[^;]+;base64,/, '');
  const binaryString = atob(cleanB64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    const bucket = await getR2Binding();

    if (!bucket) {
      return NextResponse.json({ success: false, error: 'Không thể kết nối Cloudflare R2 Bucket' }, { status: 500 });
    }

    const uploadedFiles: Array<{ filename: string; r2Url: string; size: number }> = [];

    if (contentType.includes('application/json')) {
      const body: any = await request.json();

      // Trường hợp 1: Mảng nhiều file
      if (Array.isArray(body.files)) {
        for (const item of body.files) {
          if (!item.filename || !item.fileBase64) continue;
          let fn = item.filename.trim();
          if (!fn.toLowerCase().endsWith('.pdf')) fn += '.pdf';
          const r2Key = `filescan/${fn}`;
          const bytes = base64ToUint8Array(item.fileBase64);

          await bucket.put(r2Key, bytes, {
            httpMetadata: {
              contentType: 'application/pdf',
              cacheControl: 'public, max-age=31536000, immutable',
            },
          });
          uploadedFiles.push({
            filename: fn,
            r2Url: `${R2_PUBLIC_BASE}/${r2Key}`,
            size: bytes.length,
          });
        }
      }
      // Trường hợp 2: Đơn lẻ 1 file trong JSON
      else if (body.filename && (body.fileBase64 || body.bytes)) {
        let fn = body.filename.trim();
        if (!fn.toLowerCase().endsWith('.pdf')) fn += '.pdf';
        const r2Key = `filescan/${fn}`;
        const bytes = body.bytes ? new Uint8Array(body.bytes) : base64ToUint8Array(body.fileBase64);

        await bucket.put(r2Key, bytes, {
          httpMetadata: {
            contentType: 'application/pdf',
            cacheControl: 'public, max-age=31536000, immutable',
          },
        });
        uploadedFiles.push({
          filename: fn,
          r2Url: `${R2_PUBLIC_BASE}/${r2Key}`,
          size: bytes.length,
        });
      }
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      let filename = (formData.get('filename') as string) || file?.name || 'scanhoso.pdf';

      if (!file) {
        return NextResponse.json({ success: false, error: 'Thiếu file tải lên' }, { status: 400 });
      }

      if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';
      const r2Key = `filescan/${filename}`;
      const arrayBuffer = await file.arrayBuffer();

      await bucket.put(r2Key, arrayBuffer, {
        httpMetadata: {
          contentType: file.type || 'application/pdf',
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });

      uploadedFiles.push({
        filename,
        r2Url: `${R2_PUBLIC_BASE}/${r2Key}`,
        size: arrayBuffer.byteLength,
      });
    } else {
      return NextResponse.json({ success: false, error: 'Định dạng dữ liệu không được hỗ trợ' }, { status: 400 });
    }

    if (uploadedFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'Không có file nào được xử lý' }, { status: 400 });
    }

    // Đọc danh sách kê khai và kích hoạt đồng bộ Google Sheet
    try {
      const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
      const declMap = declObj ? JSON.parse(await declObj.text()).declarationsMap || {} : {};
      executeSyncToGoogleSheet(declMap, bucket).catch((err) =>
        console.error('Lỗi sync Google Sheet sau khi upload filescan:', err)
      );
    } catch (err) {
      console.warn('Lỗi trigger sync sheet:', err);
    }

    return NextResponse.json({
      success: true,
      count: uploadedFiles.length,
      files: uploadedFiles,
      message: `Đã lưu thành công ${uploadedFiles.length} file vào R2 folder filescan/ và kích hoạt đồng bộ Google Sheet!`,
    });
  } catch (error: any) {
    console.error('Lỗi POST /api/upload-filescan:', error);
    return NextResponse.json({ success: false, error: error.message || 'Lỗi server' }, { status: 500 });
  }
}
