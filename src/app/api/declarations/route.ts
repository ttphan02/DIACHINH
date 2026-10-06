import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DeclarationFormData } from '@/types';

export const dynamic = 'force-dynamic';

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL || 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';

interface StoragePayload {
  declaredCodes: string[];
  declarationsMap: Record<string, any>;
  updatedAt?: string;
}

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

// Đọc danh sách phiếu kê khai từ Cloudflare R2
async function getDeclarationsFromR2(): Promise<StoragePayload> {
  // 1. Thử đọc trực tiếp qua R2 Binding (nhanh nhất trên Cloudflare Worker)
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      const obj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (obj) {
        const text = await obj.text();
        const data = JSON.parse(text);
        return {
          declaredCodes: Array.isArray(data.declaredCodes) ? data.declaredCodes : [],
          declarationsMap: data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {},
          updatedAt: data.updatedAt || new Date().toISOString(),
        };
      }
    }
  } catch (err) {
    console.warn('Lỗi khi đọc declarations qua R2 binding:', err);
  }

  // 2. Fallback đọc qua R2 Public URL
  try {
    const res = await fetch(`${R2_PUBLIC_URL}/${KEY_ALL_DECLARATIONS}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      return {
        declaredCodes: Array.isArray(data.declaredCodes) ? data.declaredCodes : [],
        declarationsMap: data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {},
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    }
  } catch (err) {
    console.warn('Lỗi khi fetch declarations từ public R2:', err);
  }

  return { declaredCodes: [], declarationsMap: {}, updatedAt: new Date().toISOString() };
}

// Lưu danh sách phiếu kê khai vào Cloudflare R2
async function saveDeclarationsToR2(payload: StoragePayload): Promise<boolean> {
  const jsonStr = JSON.stringify(payload, null, 2);

  // 1. Ghi trực tiếp qua R2 Binding
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      await bucket.put(KEY_ALL_DECLARATIONS, jsonStr, {
        httpMetadata: { contentType: 'application/json' },
      });
      return true;
    }
  } catch (err) {
    console.warn('Lỗi khi ghi qua R2 binding, thử fallback S3 SDK:', err);
  }

  // 2. Fallback qua S3 Client SDK
  try {
    const s3 = getS3Client();
    if (s3) {
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: KEY_ALL_DECLARATIONS,
          Body: Buffer.from(jsonStr, 'utf-8'),
          ContentType: 'application/json',
        })
      );
      return true;
    }
  } catch (err) {
    console.error('Lỗi khi ghi dữ liệu kê khai vào R2 qua S3 SDK:', err);
  }

  return false;
}

// GET: Lấy toàn bộ phiếu kê khai đã đồng bộ trên hệ thống
export async function GET() {
  try {
    const data = await getDeclarationsFromR2();
    return NextResponse.json(
      {
        success: true,
        declaredCodes: data.declaredCodes,
        declarationsMap: data.declarationsMap,
        updatedAt: data.updatedAt,
      },
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error: any) {
    console.error('Lỗi GET /api/declarations:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi đọc dữ liệu kê khai' },
      { status: 500 }
    );
  }
}

// POST: Client (Điện thoại hoặc Máy tính) gửi phiếu kê khai mới lên Cloudflare R2
export async function POST(request: Request) {
  try {
    const formData = (await request.json()) as DeclarationFormData;
    if (!formData || !formData.ma_thua) {
      return NextResponse.json({ success: false, error: 'Thiếu mã thửa đất' }, { status: 400 });
    }

    const currentData = await getDeclarationsFromR2();
    const declaredCodesSet = new Set<string>(currentData.declaredCodes);
    const declarationsMap = { ...currentData.declarationsMap };

    const rootMaThua = formData.ma_thua;
    const previousDecl = declarationsMap[rootMaThua];

    // Thu thập mã thửa trong phiếu
    const targetCodes = new Set<string>();
    targetCodes.add(rootMaThua);
    if (Array.isArray(formData.thua_kem_theo)) {
      formData.thua_kem_theo.forEach((ap) => {
        if (ap?.ma_thua) targetCodes.add(ap.ma_thua);
      });
    }

    // Xử lý các thửa cũ bị gỡ bỏ
    if (previousDecl && Array.isArray(previousDecl.thua_kem_theo)) {
      previousDecl.thua_kem_theo.forEach((ap: any) => {
        if (ap?.ma_thua && !targetCodes.has(ap.ma_thua)) {
          declaredCodesSet.delete(ap.ma_thua);
          delete declarationsMap[ap.ma_thua];
        }
      });
    }

    const timestamp = new Date().toISOString();
    const fullDeclData = {
      ...formData,
      created_at: previousDecl?.created_at || timestamp,
      updated_at: timestamp,
    };

    targetCodes.forEach((code) => {
      declaredCodesSet.add(code);
      declarationsMap[code] = fullDeclData;
    });

    const updatedCodes = Array.from(declaredCodesSet);
    const updatedPayload: StoragePayload = {
      declaredCodes: updatedCodes,
      declarationsMap,
      updatedAt: timestamp,
    };

    const saved = await saveDeclarationsToR2(updatedPayload);
    if (!saved) {
      return NextResponse.json({ success: false, error: 'Không thể ghi vào Cloudflare R2' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      declaredCodes: updatedCodes,
      declarationsMap,
      savedParcel: rootMaThua,
    });
  } catch (error: any) {
    console.error('Lỗi POST /api/declarations:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi lưu phiếu kê khai' },
      { status: 500 }
    );
  }
}

// DELETE: Xóa phiếu kê khai
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetMaThua = searchParams.get('ma_thua');
    if (!targetMaThua) {
      return NextResponse.json({ success: false, error: 'Thiếu mã thửa cần xóa' }, { status: 400 });
    }

    const currentData = await getDeclarationsFromR2();
    const declaredCodesSet = new Set<string>(currentData.declaredCodes);
    const declarationsMap = { ...currentData.declarationsMap };

    const decl = declarationsMap[targetMaThua];
    if (decl) {
      declaredCodesSet.delete(targetMaThua);
      delete declarationsMap[targetMaThua];

      if (Array.isArray(decl.thua_kem_theo)) {
        decl.thua_kem_theo.forEach((ap: any) => {
          if (ap?.ma_thua) {
            declaredCodesSet.delete(ap.ma_thua);
            delete declarationsMap[ap.ma_thua];
          }
        });
      }
    }

    const updatedCodes = Array.from(declaredCodesSet);
    const updatedPayload: StoragePayload = {
      declaredCodes: updatedCodes,
      declarationsMap,
      updatedAt: new Date().toISOString(),
    };

    await saveDeclarationsToR2(updatedPayload);

    return NextResponse.json({
      success: true,
      declaredCodes: updatedCodes,
      declarationsMap,
      deletedParcel: targetMaThua,
    });
  } catch (error: any) {
    console.error('Lỗi DELETE /api/declarations:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi xóa phiếu kê khai' },
      { status: 500 }
    );
  }
}
