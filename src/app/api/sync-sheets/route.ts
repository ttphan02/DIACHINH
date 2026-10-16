import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { executeSyncToGoogleSheet, invalidateR2Cache } from '@/utils/syncGoogleSheets';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL || 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

async function getDeclarationsMap(): Promise<Record<string, any>> {
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      const obj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (obj) {
        const text = await obj.text();
        const data = JSON.parse(text);
        return data.declarationsMap || {};
      }
    }
  } catch (err) {
    console.warn('Lỗi khi đọc declarations qua R2 binding:', err);
  }

  try {
    const res = await fetch(`${R2_PUBLIC_URL}/${KEY_ALL_DECLARATIONS}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return (data as any).declarationsMap || {};
    }
  } catch (err) {
    console.warn('Lỗi khi fetch declarations từ public R2:', err);
  }

  return {};
}

const KEY_SYNC_CACHE = 'cache/sync_sheets.json';
let cachedSyncResult: any = null;
let lastSyncTime = 0;
const SYNC_CACHE_TTL = 3 * 60 * 1000; // 3 phút (tránh quá tải CPU Worker gây lỗi 1102 khi F5)

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';
  const now = Date.now();
  const bucket = await getR2Binding();

  // Khi yêu cầu làm mới dữ liệu bắt buộc (force=true)
  if (force) {
    cachedSyncResult = null;
    lastSyncTime = 0;
    invalidateR2Cache();
    if (bucket) {
      bucket.delete(KEY_SYNC_CACHE).catch(() => {});
    }
  }

  // 1. Kiểm tra cache trong bộ nhớ (In-memory cache)
  if (!force && cachedSyncResult && now - lastSyncTime < SYNC_CACHE_TTL) {
    return NextResponse.json(
      {
        ...cachedSyncResult,
        cached: true,
        durationMs: 0,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
        },
      }
    );
  }

  // 2. Kiểm tra cache trong Cloudflare R2 (giúp các worker isolate mới không phải tính toán lại khi F5)
  if (!force && bucket) {
    try {
      const obj = await bucket.get(KEY_SYNC_CACHE);
      if (obj) {
        const text = await obj.text();
        const data = JSON.parse(text);
        if (data && now - (data.cachedAt || 0) < SYNC_CACHE_TTL) {
          cachedSyncResult = data;
          lastSyncTime = data.cachedAt;
          return NextResponse.json(
            {
              ...data,
              cached: true,
              durationMs: 0,
            },
            {
              headers: {
                'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
              },
            }
          );
        }
      }
    } catch (cacheErr) {
      console.warn('Lỗi đọc cache sync-sheets từ R2:', cacheErr);
    }
  }

  const t0 = Date.now();
  try {
    const declarationsMap = await getDeclarationsMap();
    const result = await executeSyncToGoogleSheet(declarationsMap, bucket);

    const payload = {
      success: result.success,
      message: result.message,
      durationMs: Date.now() - t0,
      totalDeclarations: Object.keys(declarationsMap).length,
      summary: (result as any).summary,
      sheetsData: (result as any).sheetsData,
      cachedAt: now,
    };

    cachedSyncResult = payload;
    lastSyncTime = now;

    // Lưu vào R2 cache cho các worker isolate khác dùng chung
    if (bucket) {
      try {
        await bucket.put(KEY_SYNC_CACHE, JSON.stringify(payload), {
          httpMetadata: { contentType: 'application/json' },
        });
      } catch (saveCacheErr) {
        console.warn('Lỗi lưu cache sync-sheets vào R2:', saveCacheErr);
      }
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error: any) {
    console.error('Lỗi khi đồng bộ Google Sheet:', error);
    if (cachedSyncResult) {
      return NextResponse.json({
        ...cachedSyncResult,
        warning: 'Sử dụng dữ liệu cache do quá tải: ' + (error.message || ''),
      });
    }
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi khi đồng bộ Google Sheet' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
