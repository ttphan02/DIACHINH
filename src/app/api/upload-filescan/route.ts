import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { executeSyncToGoogleSheet } from '@/utils/syncGoogleSheets';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

function getS3Client(): S3Client | null {
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    });
  }
  return null;
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

async function putObjectToR2(key: string, body: Uint8Array | ArrayBuffer, contentType: string) {
  const bucket = await getR2Binding();
  if (bucket) {
    await bucket.put(key, body, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return true;
  }
  const s3 = getS3Client();
  if (s3) {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
    return true;
  }
  throw new Error('Không thể kết nối Cloudflare R2 (Binding hoặc S3)');
}

async function deleteObjectFromR2(key: string) {
  const bucket = await getR2Binding();
  if (bucket) {
    await bucket.delete(key);
    return true;
  }
  const s3 = getS3Client();
  if (s3) {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    return true;
  }
  return false;
}

// GET /api/upload-filescan - Lấy danh sách toàn bộ file PDF scan trong folder filescan/ và scanhoso/
export async function GET() {
  try {
    const bucket = await getR2Binding();
    const s3 = getS3Client();

    let allObjects: Array<{ key: string; size: number; uploaded?: string | Date | null }> = [];

    if (bucket) {
      try {
        const listRes: any = await bucket.list({ prefix: 'filescan/', limit: 1000 });
        const objects = listRes.objects || [];
        let objectsScanHoso: any[] = [];
        try {
          const listHoso: any = await bucket.list({ prefix: 'scanhoso/', limit: 1000 });
          objectsScanHoso = listHoso.objects || [];
        } catch {}
        allObjects = [...objects, ...objectsScanHoso];
      } catch (err) {
        console.warn('Lỗi list qua R2 binding:', err);
      }
    }

    // Fallback qua S3 SDK nếu bucket binding không có hoặc chưa lấy được
    if (allObjects.length === 0 && s3) {
      try {
        const cmd1 = new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: 'filescan/',
          MaxKeys: 1000,
        });
        const res1 = await s3.send(cmd1);
        const list1 = (res1.Contents || []).map((c) => ({
          key: c.Key || '',
          size: c.Size || 0,
          uploaded: c.LastModified || null,
        }));

        const cmd2 = new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: 'scanhoso/',
          MaxKeys: 1000,
        });
        const res2 = await s3.send(cmd2);
        const list2 = (res2.Contents || []).map((c) => ({
          key: c.Key || '',
          size: c.Size || 0,
          uploaded: c.LastModified || null,
        }));

        allObjects = [...list1, ...list2];
      } catch (err) {
        console.warn('Lỗi list filescan qua S3 SDK:', err);
      }
    }

    // Đọc declarations để tìm liên kết chủ sở hữu & thửa đất
    let declarationsMap: Record<string, any> = {};
    if (bucket) {
      try {
        const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
        if (declObj) {
          const payload = JSON.parse(await declObj.text());
          declarationsMap = payload.declarationsMap || {};
        }
      } catch (e) {
        console.warn('Lỗi đọc declarationsMap cho filescan qua bucket:', e);
      }
    }
    if (Object.keys(declarationsMap).length === 0) {
      try {
        const res = await fetch(`${R2_PUBLIC_BASE}/${KEY_ALL_DECLARATIONS}?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const payload: any = await res.json();
          declarationsMap = payload.declarationsMap || {};
        }
      } catch (e) {
        console.warn('Lỗi fetch declarationsMap qua public URL:', e);
      }
    }

    const files = allObjects
      .map((obj: any) => {
        const fullKey = obj.key;
        const filename = fullKey.replace(/^(filescan|scanhoso)\//, '');
        if (!filename) return null;

        let matchedTo = '';
        let matchedThua = '';
        let matchedOwner = '';
        let matchedParcel = '';

        const m = filename.match(/(?:CHUACOGIAY_\d+_)?(\d+)[-_](\d+)(?:[-_]DDK)?/i);
        if (m) {
          matchedTo = m[1];
          matchedThua = m[2];
        }

        // Tìm đối chiếu trong declarationsMap
        for (const [code, decl] of Object.entries(declarationsMap)) {
          if (
            (matchedTo && matchedThua && String(decl.to_ban_do) === matchedTo && String(decl.so_thua) === matchedThua) ||
            filename.includes(code)
          ) {
            matchedParcel = code;
            matchedOwner = decl.chu_dat_ten || decl.chu_ho || '';
            break;
          }
        }

        return {
          key: fullKey,
          filename,
          size: obj.size,
          uploadedAt: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
          url: `/api/image/${encodeURI(fullKey)}`,
          toBanDo: matchedTo,
          soThua: matchedThua,
          ownerName: matchedOwner,
          matchedParcelCode: matchedParcel,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const tA = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
        const tB = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        return tB - tA; // Mới nhất lên đầu
      });

    return NextResponse.json({
      success: true,
      total: files.length,
      files,
    });
  } catch (error: any) {
    console.error('Lỗi GET /api/upload-filescan:', error);
    return NextResponse.json({
      success: true,
      total: 0,
      files: [],
      warning: error.message || 'Lỗi server',
    });
  }
}

// POST /api/upload-filescan - Lưu file scan từ ScanName lên R2
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
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

          await putObjectToR2(r2Key, bytes, 'application/pdf');
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

        await putObjectToR2(r2Key, bytes, 'application/pdf');
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

      await putObjectToR2(r2Key, arrayBuffer, file.type || 'application/pdf');

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
      const bucket = await getR2Binding();
      let declMap: Record<string, any> = {};
      if (bucket) {
        const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
        declMap = declObj ? JSON.parse(await declObj.text()).declarationsMap || {} : {};
      } else {
        const res = await fetch(`${R2_PUBLIC_BASE}/${KEY_ALL_DECLARATIONS}?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const payload: any = await res.json();
          declMap = payload.declarationsMap || {};
        }
      }
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

// DELETE /api/upload-filescan - Xóa file scan khỏi R2
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let filename = searchParams.get('file') || searchParams.get('filename');

    if (!filename) {
      try {
        const body: any = await request.json();
        filename = body.filename || body.file;
      } catch {}
    }

    if (!filename) {
      return NextResponse.json({ success: false, error: 'Vui lòng cung cấp tên file cần xóa' }, { status: 400 });
    }

    const cleanFn = filename.replace(/^(filescan|scanhoso)\//, '');
    const r2Key = `filescan/${cleanFn}`;

    console.log(`>>> Đang xóa file scan: ${r2Key}`);
    await deleteObjectFromR2(r2Key);
    try {
      await deleteObjectFromR2(`scanhoso/${cleanFn}`);
    } catch {}

    return NextResponse.json({
      success: true,
      message: `Đã xóa file ${cleanFn} khỏi R2!`,
    });
  } catch (error: any) {
    console.error('Lỗi DELETE /api/upload-filescan:', error);
    return NextResponse.json({ success: false, error: error.message || 'Lỗi server' }, { status: 500 });
  }
}
