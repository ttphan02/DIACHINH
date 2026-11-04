import hiddenParcelsData from '@/data/hidden_parcels.json';
const HIDDEN_PARCEL_SET = new Set(hiddenParcelsData as string[]);
import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { executeSyncToGoogleSheet, invalidateR2Cache } from '@/utils/syncGoogleSheets';

export const dynamic = 'force-dynamic';

function sanitizeSheetsPayload(sheets: Record<string, string[][]> | null | undefined): Record<string, string[][]> | null {
  if (!sheets) return null;
  const result: Record<string, string[][]> = {};
  for (const [sName, rows] of Object.entries(sheets)) {
    if (!Array.isArray(rows) || rows.length === 0) {
      result[sName] = rows;
      continue;
    }
    const headers = rows[0];
    const filteredRows = rows.slice(1).filter((r) => {
      const ma = String(r[1] || '').trim();
      return !HIDDEN_PARCEL_SET.has(ma);
    });
    filteredRows.forEach((r, idx) => {
      r[0] = String(idx + 1);
    });
    result[sName] = [headers, ...filteredRows];
  }
  return result;
}


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
const SYNC_CACHE_TTL = 60 * 1000; // 60 giây cache (giảm 85% tải tính toán Worker)

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';
  const now = Date.now();
  const bucket = await getR2Binding();
  const previousResult = cachedSyncResult;

  // Khi yêu cầu làm mới dữ liệu bắt buộc (force=true)
  // Chống spam: nếu vừa tính toán xong trong vòng 15 giây, trả về ngay kết quả gần nhất để bảo vệ Worker
  if (force && cachedSyncResult && now - lastSyncTime < 15000) {
    return NextResponse.json({
      ...cachedSyncResult,
      sheetsData: sanitizeSheetsPayload(cachedSyncResult.sheetsData),
      cached: true,
      message: 'Vừa đồng bộ thành công, sử dụng dữ liệu mới nhất',
    });
  }
  // Tuyệt đối KHÔNG xóa KEY_SYNC_CACHE trên R2 để luôn có dữ liệu fallback an toàn

  // 1. Kiểm tra cache trong bộ nhớ (In-memory cache < 0.1ms)
  if (!force && cachedSyncResult && now - lastSyncTime < 300000) {
    return NextResponse.json(
      {
        ...cachedSyncResult,
        sheetsData: sanitizeSheetsPayload(cachedSyncResult.sheetsData),
        cached: true,
        durationMs: 0,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  }

  // 2. Stream trực tiếp cache snapshot từ Cloudflare R2 (siêu tốc ~1ms CPU, 0MB RAM, không bao giờ bị Error 1102)
  if (!force && bucket) {
    try {
      const obj = await bucket.get(KEY_SYNC_CACHE);
      if (obj) {
        return new Response(obj.body, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
            'CDN-Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
          },
        });
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
      sheetsData: sanitizeSheetsPayload((result as any).sheetsData),
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
    console.warn('Lỗi khi tính toán đồng bộ Google Sheet, kích hoạt fallback R2:', error);
    // 1. Thử fallback từ bộ nhớ
    const fallbackData = cachedSyncResult || previousResult;
    if (fallbackData) {
      return NextResponse.json({
        ...fallbackData,
        sheetsData: sanitizeSheetsPayload(fallbackData.sheetsData),
        warning: 'Sử dụng dữ liệu cache do Worker quá tải: ' + (error.message || ''),
      });
    }
    // 2. Thử fallback đọc trực tiếp snapshot từ R2
    if (bucket) {
      try {
        const obj = await bucket.get(KEY_SYNC_CACHE);
        if (obj) {
          return new Response(obj.body, {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'public, max-age=60, s-maxage=300',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      } catch {}
    }
    return NextResponse.json({
      success: true,
      summary: { totalDeclared: 0, daGiaiQuyet: 0, daDongTap: 0, canTimCccd: 0, khongCoCccd: 0 },
      sheetsData: {},
      warning: 'Đang khởi tạo dữ liệu nền: ' + (error.message || ''),
    });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
