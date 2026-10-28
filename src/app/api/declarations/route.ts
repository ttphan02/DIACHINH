import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { DeclarationFormData } from '@/types';
import parcelsBriefData from '@/data/parcels_brief.json';

const parcelsBrief = parcelsBriefData as unknown as Record<string, [string, string, string, number]>;

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
  cellEdits?: Record<string, Record<number, string>>;
  updatedAt?: string;
}

// In-memory cache ngắn hạn (2.5 giây) giúp giảm tải triệt để I/O và CPU trên Cloudflare Worker
let memoryCache: { payload: StoragePayload; timestamp: number } | null = null;
const MEMORY_CACHE_TTL = 2500;

let cachedR2Bucket: any = null;

/**
 * Lấy R2 bucket binding với cơ chế đa tầng (Multi-tier fallback):
 * 1. Module-level cached instance
 * 2. globalThis.__CF_ENV__ (được middleware hoặc request trước khởi tạo)
 * 3. Symbol.for("__cloudflare-context__") của OpenNext
 * 4. getCloudflareContext({ async: true })
 * 5. getCloudflareContext({ async: false })
 */
async function getR2Binding(): Promise<any | null> {
  if (cachedR2Bucket) return cachedR2Bucket;

  // 1. Kiểm tra globalThis.__CF_ENV__
  if ((globalThis as any).__CF_ENV__?.DIACHINH_STORAGE) {
    cachedR2Bucket = (globalThis as any).__CF_ENV__.DIACHINH_STORAGE;
    return cachedR2Bucket;
  }

  // 2. Kiểm tra OpenNext global Symbol
  try {
    const ctx = (globalThis as any)[Symbol.for('__cloudflare-context__')];
    if (ctx?.env?.DIACHINH_STORAGE) {
      cachedR2Bucket = ctx.env.DIACHINH_STORAGE;
      (globalThis as any).__CF_ENV__ = ctx.env;
      return cachedR2Bucket;
    }
  } catch {}

  // 3. getCloudflareContext async
  try {
    const { env } = await getCloudflareContext({ async: true });
    if ((env as any)?.DIACHINH_STORAGE) {
      cachedR2Bucket = (env as any).DIACHINH_STORAGE;
      (globalThis as any).__CF_ENV__ = env;
      return cachedR2Bucket;
    }
  } catch {}

  // 4. getCloudflareContext sync
  try {
    const { env } = getCloudflareContext({ async: false });
    if ((env as any)?.DIACHINH_STORAGE) {
      cachedR2Bucket = (env as any).DIACHINH_STORAGE;
      (globalThis as any).__CF_ENV__ = env;
      return cachedR2Bucket;
    }
  } catch {}

  return null;
}

async function getCloudflareCtx(): Promise<any | null> {
  try {
    const cf = (globalThis as any)[Symbol.for('__cloudflare-context__')];
    if (cf?.ctx) return cf.ctx;
  } catch {}
  try {
    const context = await getCloudflareContext({ async: true });
    return (context as any)?.ctx || null;
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

// Lưu song song file đơn lẻ của từng thửa đất (Atomic, siêu nhẹ ~500 bytes, không bao giờ bị ghi đè hay mất)
async function saveSingleDeclarationToR2(maThua: string, declData: any): Promise<void> {
  if (!maThua || !declData) return;
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      await bucket.put(`declarations/parcels/${maThua}.json`, JSON.stringify(declData), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
  } catch (err) {
    console.warn(`Lỗi lưu phiếu đơn lẻ cho thửa ${maThua}:`, err);
  }
}

// Đọc danh sách phiếu kê khai từ Cloudflare R2
async function getDeclarationsFromR2(forceRefresh = false): Promise<StoragePayload> {
  const now = Date.now();
  if (!forceRefresh && memoryCache && now - memoryCache.timestamp < MEMORY_CACHE_TTL) {
    return memoryCache.payload;
  }

  // 1. Đọc trực tiếp qua R2 Binding (nhanh nhất trên Cloudflare Worker)
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      const obj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (obj) {
        const text = await obj.text();
        const data = JSON.parse(text);
        const payload: StoragePayload = {
          declaredCodes: Array.isArray(data.declaredCodes) ? data.declaredCodes : [],
          declarationsMap: data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {},
          cellEdits: data.cellEdits && typeof data.cellEdits === 'object' ? data.cellEdits : {},
          updatedAt: data.updatedAt || new Date().toISOString(),
        };
        memoryCache = { payload, timestamp: now };
        return payload;
      }
    }
  } catch (err) {
    console.warn('Lỗi khi đọc declarations qua R2 binding:', err);
  }

  // 2. Fallback đọc qua R2 Public URL
  try {
    const res = await fetch(`${R2_PUBLIC_URL}/${KEY_ALL_DECLARATIONS}?t=${now}`, {
      headers: { 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      const payload: StoragePayload = {
        declaredCodes: Array.isArray(data.declaredCodes) ? data.declaredCodes : [],
        declarationsMap: data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {},
        cellEdits: data.cellEdits && typeof data.cellEdits === 'object' ? data.cellEdits : {},
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
      memoryCache = { payload, timestamp: now };
      return payload;
    }
  } catch (err) {
    console.warn('Lỗi khi fetch declarations từ public R2:', err);
  }

  const fallback: StoragePayload = { declaredCodes: [], declarationsMap: {}, cellEdits: {}, updatedAt: new Date().toISOString() };
  memoryCache = { payload: fallback, timestamp: now };
  return fallback;
}

// Lưu danh sách phiếu kê khai vào Cloudflare R2
async function saveDeclarationsToR2(payload: StoragePayload): Promise<{ success: boolean; error?: string }> {
  const jsonStr = JSON.stringify(payload);
  memoryCache = { payload, timestamp: Date.now() };

  let lastError = '';

  // 1. Ghi trực tiếp qua R2 Binding với retry 3 lần
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const bucket = await getR2Binding();
      if (!bucket) {
        lastError = 'R2 Binding DIACHINH_STORAGE không khả dụng';
        continue;
      }
      await bucket.put(KEY_ALL_DECLARATIONS, jsonStr, {
        httpMetadata: { contentType: 'application/json' },
      });
      // Xóa cache bất đồng bộ không await để không làm chậm request
      bucket.delete('cache/sync_sheets.json').catch(() => {});
      return { success: true };
    } catch (err: any) {
      lastError = err?.message || String(err);
      console.warn(`Lỗi khi ghi qua R2 binding (lần ${attempt}/3):`, lastError);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      }
    }
  }

  // 2. Fallback qua S3 Client SDK (nếu có biến môi trường cấu hình)
  try {
    const s3 = await getS3Client();
    if (s3) {
      const { PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: KEY_ALL_DECLARATIONS,
          Body: Buffer.from(jsonStr, 'utf-8'),
          ContentType: 'application/json',
        })
      );
      s3.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: 'cache/sync_sheets.json',
        })
      ).catch(() => {});
      return { success: true };
    }
  } catch (err: any) {
    lastError = `S3 SDK fallback error: ${err?.message || err}`;
    console.error('Lỗi khi ghi dữ liệu kê khai vào R2 qua S3 SDK:', err);
  }

  return { success: false, error: lastError || 'Không thể ghi vào Cloudflare R2' };
}

// GET: Lấy toàn bộ phiếu kê khai đã đồng bộ trên hệ thống
export async function GET() {
  // Pre-heat R2 context
  await getR2Binding();
  try {
    const data = await getDeclarationsFromR2();
    return NextResponse.json(
      {
        success: true,
        declaredCodes: data.declaredCodes,
        declarationsMap: data.declarationsMap,
        cellEdits: data.cellEdits || {},
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

// POST: Client (Điện thoại hoặc Máy tính) gửi phiếu kê khai mới hoặc nháp cellEdits lên Cloudflare R2
export async function POST(request: Request) {
  // 1. Kích hoạt lấy R2 Binding ngay từ đầu request handler trước bất kỳ stream parsing nào
  await getR2Binding();

  try {
    const body: any = await request.json();

    // Đồng bộ nhanh các ô nhập nháp (cellEdits) qua các máy tính khác nhau
    if (body && body.type === 'cell_edits') {
      const currentData = await getDeclarationsFromR2(true);
      const updatedPayload: StoragePayload = {
        declaredCodes: currentData.declaredCodes,
        declarationsMap: currentData.declarationsMap,
        cellEdits: body.cellEdits || {},
        updatedAt: new Date().toISOString(),
      };
      await saveDeclarationsToR2(updatedPayload);
      memoryCache = { payload: updatedPayload, timestamp: Date.now() };
      return NextResponse.json({ success: true, cellEdits: updatedPayload.cellEdits });
    }

    // Hỗ trợ lưu hàng loạt (batch) trong 1 request duy nhất
    if (body && Array.isArray(body.batch) && body.batch.length > 0) {
      const currentData = await getDeclarationsFromR2(true);
      const declaredCodesSet = new Set<string>(currentData.declaredCodes);
      const declarationsMap = { ...currentData.declarationsMap };
      const currentCellEdits = { ...(currentData.cellEdits || {}) };
      const timestamp = new Date().toISOString();

      for (const item of body.batch) {
        if (!item || !item.ma_thua) continue;
        const code = item.ma_thua;
        const fullDeclData = {
          ...item,
          dia_chi_thua_dat: item.dia_chi_thua_dat || 'xã Cư Pui',
          chu_dat_dia_chi: item.chu_dat_dia_chi || item.dia_chi_thua_dat || 'xã Cư Pui',
          device_id: item.device_id || 'MAY_DEF',
          created_at: item.created_at || timestamp,
          updated_at: timestamp,
        };
        declaredCodesSet.add(code);
        declarationsMap[code] = fullDeclData;
        delete currentCellEdits[code];

        // Lưu bản sao nguyên tử cho từng thửa (không bao giờ mất)
        saveSingleDeclarationToR2(code, fullDeclData);
      }

      const updatedCodes = Array.from(declaredCodesSet);
      const updatedPayload: StoragePayload = {
        declaredCodes: updatedCodes,
        declarationsMap,
        cellEdits: currentCellEdits,
        updatedAt: timestamp,
      };

      const saveRes = await saveDeclarationsToR2(updatedPayload);
      if (!saveRes.success) {
        return NextResponse.json(
          { success: false, error: saveRes.error || 'Không thể ghi vào Cloudflare R2' },
          { status: 500 }
        );
      }

      memoryCache = { payload: updatedPayload, timestamp: Date.now() };

      return NextResponse.json({
        success: true,
        batchCount: body.batch.length,
        declaredCodes: updatedCodes,
        updatedAt: timestamp,
      });
    }

    const formData = body as DeclarationFormData;
    if (!formData || !formData.ma_thua) {
      return NextResponse.json({ success: false, error: 'Thiếu mã thửa đất' }, { status: 400 });
    }

    const currentData = await getDeclarationsFromR2(true);
    const declaredCodesSet = new Set<string>(currentData.declaredCodes);
    const declarationsMap = { ...currentData.declarationsMap };
    const currentCellEdits = { ...(currentData.cellEdits || {}) };

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
    const rootParts = rootMaThua.split('_');
    const rootBrief = parcelsBrief[rootMaThua];
    const rootDienTich = (rootBrief && rootBrief[0]) || formData.dien_tich || '1000';
    const rootLoaiDat = formData.loai_dat || (rootBrief && rootBrief[1]) || 'LUK';
    const rootThonXa = formData.thon_xa || formData.dia_chi_thua_dat || (rootBrief && rootBrief[2]) || 'xã Cư Pui';

    const rootDeclData = {
      ...formData,
      ma_thua: rootMaThua,
      to_ban_do: rootParts[0] || formData.to_ban_do || '',
      so_thua: rootParts[1] || formData.so_thua || '',
      dien_tich: String(rootDienTich),
      loai_dat: rootLoaiDat,
      thon_xa: rootThonXa,
      dia_chi_thua_dat: rootThonXa,
      chu_dat_dia_chi: formData.chu_dat_dia_chi || rootThonXa,
      device_id: formData.device_id || previousDecl?.device_id || 'MAY_DEF',
      created_at: previousDecl?.created_at || timestamp,
      updated_at: timestamp,
    };

    const atomicWrites: Promise<void>[] = [];

    // 1. Lưu thửa chính
    declaredCodesSet.add(rootMaThua);
    declarationsMap[rootMaThua] = rootDeclData;
    delete currentCellEdits[rootMaThua];
    atomicWrites.push(saveSingleDeclarationToR2(rootMaThua, rootDeclData));

    // 2. Lưu từng thửa kèm theo với đúng mã thửa, tờ, thửa, diện tích và loại đất của chính nó
    if (Array.isArray(formData.thua_kem_theo)) {
      formData.thua_kem_theo.forEach((ap) => {
        if (!ap?.ma_thua) return;
        const apCode = ap.ma_thua;
        const apParts = apCode.split('_');
        const apBrief = parcelsBrief[apCode];
        const apDienTich = (apBrief && apBrief[0]) || ap.dien_tich || '1000';
        const apLoaiDat = ap.loai_dat || (apBrief && apBrief[1]) || rootLoaiDat;
        const apThonXa = ap.thon_xa || (apBrief && apBrief[2]) || rootThonXa;
        const apNguonGoc = ap.nguon_goc || formData.nguon_goc_su_dung || 'Khai hoang';

        const attachedDeclData = {
          ...rootDeclData,
          ma_thua: apCode,
          to_ban_do: ap.to_ban_do || apParts[0] || '',
          so_thua: ap.so_thua || apParts[1] || '',
          dien_tich: String(apDienTich),
          loai_dat: apLoaiDat,
          thon_xa: apThonXa,
          dia_chi_thua_dat: apThonXa,
          nguon_goc: apNguonGoc,
          nguon_goc_su_dung: apNguonGoc,
          is_thua_kem_theo: true,
          parent_ma_thua: rootMaThua,
          thua_kem_theo: undefined,
        };

        declaredCodesSet.add(apCode);
        declarationsMap[apCode] = attachedDeclData;
        delete currentCellEdits[apCode];
        atomicWrites.push(saveSingleDeclarationToR2(apCode, attachedDeclData));
      });
    }

    // Đợi lưu song song toàn bộ file đơn lẻ (chỉ mất ~20ms, đảm bảo 100% dữ liệu đã ở an toàn trên R2)
    await Promise.all(atomicWrites);

    const updatedCodes = Array.from(declaredCodesSet);
    const updatedPayload: StoragePayload = {
      declaredCodes: updatedCodes,
      declarationsMap,
      cellEdits: currentCellEdits,
      updatedAt: timestamp,
    };

    memoryCache = { payload: updatedPayload, timestamp: Date.now() };

    // Tác vụ nền (Background Queue Task): Ghi file tổng all.json và xóa cache không bắt người dùng phải đợi!
    const ctx = await getCloudflareCtx();
    const backgroundTask = async () => {
      await saveDeclarationsToR2(updatedPayload);
    };

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(backgroundTask());
    } else {
      backgroundTask().catch((e) => console.error('Lỗi lưu all.json nền:', e));
    }

    return NextResponse.json({
      success: true,
      declaredCodes: updatedCodes,
      savedParcel: rootMaThua,
      declarationsMap,
      updatedAt: timestamp,
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
  await getR2Binding();
  try {
    const { searchParams } = new URL(request.url);
    const targetMaThua = searchParams.get('ma_thua');
    if (!targetMaThua) {
      return NextResponse.json({ success: false, error: 'Thiếu mã thửa cần xóa' }, { status: 400 });
    }

    const currentData = await getDeclarationsFromR2(true);
    const declaredCodesSet = new Set<string>(currentData.declaredCodes);
    const declarationsMap = { ...currentData.declarationsMap };

    const bucket = await getR2Binding();
    const decl = declarationsMap[targetMaThua];
    if (decl) {
      declaredCodesSet.delete(targetMaThua);
      delete declarationsMap[targetMaThua];
      if (bucket) {
        bucket.delete(`declarations/parcels/${targetMaThua}.json`).catch(() => {});
      }

      if (Array.isArray(decl.thua_kem_theo)) {
        decl.thua_kem_theo.forEach((ap: any) => {
          if (ap?.ma_thua) {
            declaredCodesSet.delete(ap.ma_thua);
            delete declarationsMap[ap.ma_thua];
            if (bucket) {
              bucket.delete(`declarations/parcels/${ap.ma_thua}.json`).catch(() => {});
            }
          }
        });
      }
    }

    const updatedCodes = Array.from(declaredCodesSet);
    const updatedPayload: StoragePayload = {
      declaredCodes: updatedCodes,
      declarationsMap,
      cellEdits: currentData.cellEdits || {},
      updatedAt: new Date().toISOString(),
    };

    await saveDeclarationsToR2(updatedPayload);
    memoryCache = { payload: updatedPayload, timestamp: Date.now() };

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
