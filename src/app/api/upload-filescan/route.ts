import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

// Cache ngắn hạn 8 giây giúp Worker giảm 95% tải CPU và I/O khi người dùng bấm chuyển tab hoặc F5
let scanCache: { data: any; timestamp: number } | null = null;
const SCAN_CACHE_TTL = 8000;

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

async function getS3Client(): Promise<any | null> {
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    try {
      const { S3Client } = await import('@aws-sdk/client-s3');
      return new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY,
          secretAccessKey: R2_SECRET_KEY,
        },
      });
    } catch (err) {
      console.warn('Lỗi khởi tạo S3Client SDK:', err);
    }
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
  const s3 = await getS3Client();
  if (s3) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
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
  const s3 = await getS3Client();
  if (s3) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
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
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('force') === 'true';
    const now = Date.now();

    if (!forceRefresh && scanCache && now - scanCache.timestamp < SCAN_CACHE_TTL) {
      return NextResponse.json(scanCache.data);
    }

    const bucket = await getR2Binding();
    let allObjects: Array<{ key: string; size: number; uploaded?: string | Date | null }> = [];
    let declarationsMap: Record<string, any> = {};

    if (bucket) {
      try {
        // Thực hiện song song 3 truy vấn R2: filescan, scanhoso và declarations
        const [listRes, listHoso, declObj] = await Promise.all([
          bucket.list({ prefix: 'filescan/', limit: 1000 }).catch(() => ({ objects: [] })),
          bucket.list({ prefix: 'scanhoso/', limit: 1000 }).catch(() => ({ objects: [] })),
          bucket.get(KEY_ALL_DECLARATIONS).catch(() => null),
        ]);

        const objects1 = listRes?.objects || [];
        const objects2 = listHoso?.objects || [];
        allObjects = [...objects1, ...objects2];

        if (declObj) {
          const payload = JSON.parse(await declObj.text());
          declarationsMap = payload.declarationsMap || {};
        }
      } catch (err) {
        console.warn('Lỗi list qua R2 binding:', err);
      }
    }

    // Fallback qua S3 SDK nếu bucket binding không có hoặc chưa lấy được
    if (allObjects.length === 0) {
      const s3 = await getS3Client();
      if (s3) {
        try {
          const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
          const [res1, res2] = await Promise.all([
            s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'filescan/', MaxKeys: 1000 })).catch(() => ({ Contents: [] })),
            s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'scanhoso/', MaxKeys: 1000 })).catch(() => ({ Contents: [] })),
          ]);

          const list1 = (res1.Contents || []).map((c: any) => ({
            key: c.Key || '',
            size: c.Size || 0,
            uploaded: c.LastModified || null,
          }));
          const list2 = (res2.Contents || []).map((c: any) => ({
            key: c.Key || '',
            size: c.Size || 0,
            uploaded: c.LastModified || null,
          }));

          allObjects = [...list1, ...list2];
        } catch (err) {
          console.warn('Lỗi list filescan qua S3 SDK:', err);
        }
      }
    }

    // Fallback đọc declarations nếu chưa có
    if (Object.keys(declarationsMap).length === 0) {
      try {
        const res = await fetch(`${R2_PUBLIC_BASE}/${KEY_ALL_DECLARATIONS}?t=${now}`, {
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

    // Index 1 lần duy nhất để tra cứu O(1) - KHÔNG lặp lồng O(N*M) làm quá tải CPU Worker gây lỗi 503
    const toThuaMap = new Map<string, { code: string; owner: string }>();
    const declaredCodesSet = new Set<string>();

    for (const [code, decl] of Object.entries(declarationsMap)) {
      declaredCodesSet.add(code);
      const to = String(decl.to_ban_do || '').trim();
      const thua = String(decl.so_thua || '').trim();
      const owner = decl.chu_dat_ten || decl.chu_ho || '';
      if (to && thua) {
        toThuaMap.set(`${to}_${thua}`, { code, owner });
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

        // Tra cứu nhanh O(1)
        if (matchedTo && matchedThua) {
          const match = toThuaMap.get(`${matchedTo}_${matchedThua}`);
          if (match) {
            matchedParcel = match.code;
            matchedOwner = match.owner;
          }
        }

        // Nếu chưa khớp, thử tìm mã thửa dạng to_thua trong tên file qua Set O(1)
        if (!matchedParcel) {
          const codeMatch = filename.match(/\b(\d+_\d+)\b/);
          if (codeMatch && declaredCodesSet.has(codeMatch[1])) {
            matchedParcel = codeMatch[1];
            matchedOwner = declarationsMap[matchedParcel]?.chu_dat_ten || declarationsMap[matchedParcel]?.chu_ho || '';
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

    const result = {
      success: true,
      total: files.length,
      files,
    };

    scanCache = { data: result, timestamp: now };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=5, s-maxage=10, stale-while-revalidate=30',
      },
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

    // Xóa cache để cập nhật tức thì
    scanCache = null;

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

      import('@/utils/syncGoogleSheets')
        .then(({ executeSyncToGoogleSheet }) => {
          executeSyncToGoogleSheet(declMap, bucket).catch((err) =>
            console.error('Lỗi sync Google Sheet sau khi upload filescan:', err)
          );
        })
        .catch((err) => console.warn('Lỗi nạp module syncGoogleSheets:', err));
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

    // Xóa cache để cập nhật tức thì
    scanCache = null;

    return NextResponse.json({
      success: true,
      message: `Đã xóa file ${cleanFn} khỏi R2!`,
    });
  } catch (error: any) {
    console.error('Lỗi DELETE /api/upload-filescan:', error);
    return NextResponse.json({ success: false, error: error.message || 'Lỗi server' }, { status: 500 });
  }
}
