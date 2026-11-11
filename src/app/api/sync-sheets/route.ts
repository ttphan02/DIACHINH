import hiddenParcelsData from '@/data/hidden_parcels.json';
const HIDDEN_PARCEL_SET = new Set(hiddenParcelsData as string[]);
import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { executeSyncToGoogleSheet, invalidateR2Cache } from '@/utils/syncGoogleSheets';
import { getD1Binding, getAllD1Declarations } from '@/utils/d1Database';

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
  // 1. Ưu tiên đọc trực tiếp từ Cloudflare D1 SQL Database (nguồn dữ liệu tức thời và chính xác nhất)
  try {
    const db = await getD1Binding();
    if (db) {
      const d1Data = await getAllD1Declarations(db);
      if (d1Data && d1Data.declarationsMap && Object.keys(d1Data.declarationsMap).length > 0) {
        return d1Data.declarationsMap;
      }
    }
  } catch (err) {
    console.warn('Lỗi khi đọc declarations qua D1 binding trong sync-sheets:', err);
  }

  // 2. Fallback đọc qua R2 Binding
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

  // 1. Stream trực tiếp cache snapshot từ Cloudflare R2 (khi KHÔNG yêu cầu force làm mới)
  if (!force && bucket) {
    try {
      const obj = await bucket.get(KEY_SYNC_CACHE);
      if (obj) {
        const etag = obj.httpEtag || `"${obj.uploaded?.getTime() || 'sync-v1'}"`;
        const clientEtag = req.headers.get('if-none-match');
        if (clientEtag && (clientEtag === etag || clientEtag.includes(etag))) {
          return new Response(null, {
            status: 304,
            headers: {
              'ETag': etag,
              'Cache-Control': 'no-store, no-cache, must-revalidate',
              'CDN-Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
        const text = await obj.text();
        const byteLen = new TextEncoder().encode(text).length;
        return new Response(text, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': String(byteLen),
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'CDN-Cache-Control': 'no-store',
            'ETag': etag,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    } catch (cacheErr) {
      console.warn('Lỗi đọc cache sync-sheets từ R2:', cacheErr);
    }
  }

  // 2. Fallback đọc từ public R2 URL nếu bucket.get gặp vấn đề (khi KHÔNG yêu cầu force)
  if (!force) {
    try {
      const res = await fetch(`${R2_PUBLIC_URL}/${KEY_SYNC_CACHE}?t=${now}`, {
        headers: { 'Cache-Control': 'no-cache' },
        cache: 'no-store',
      });
      if (res.ok) {
        const text = await res.text();
        return new Response(text, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=15, s-maxage=30',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    } catch (err) {
      console.warn('Lỗi khi fetch cache sync-sheets từ public R2:', err);
    }
  }

  // 3. In-memory cache fallback (khi KHÔNG force)
  if (!force && cachedSyncResult) {
    return NextResponse.json({
      ...cachedSyncResult,
      sheetsData: sanitizeSheetsPayload(cachedSyncResult.sheetsData),
      cached: true,
      durationMs: 0,
    });
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
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'CDN-Cache-Control': 'no-store',
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
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = (await req.json()) as any;
      if (body && (body.sheetsData || body.summary)) {
        const bucket = await getR2Binding();
        let currentSnapshot: any = {};
        if (bucket) {
          try {
            const obj = await bucket.get(KEY_SYNC_CACHE);
            if (obj) currentSnapshot = JSON.parse(await obj.text());
          } catch {}
        }
        const updatedPayload = {
          success: true,
          durationMs: 0,
          totalDeclarations: body.totalDeclarations ?? currentSnapshot.totalDeclarations ?? 0,
          summary: { ...(currentSnapshot.summary || {}), ...(body.summary || {}) },
          sheetsData: sanitizeSheetsPayload({ ...(currentSnapshot.sheetsData || {}), ...(body.sheetsData || {}) }),
          cachedAt: Date.now(),
        };

        cachedSyncResult = updatedPayload;
        lastSyncTime = Date.now();

        if (bucket) {
          try {
            await bucket.put(KEY_SYNC_CACHE, JSON.stringify(updatedPayload), {
              httpMetadata: { contentType: 'application/json' },
            });
          } catch (e) {
            console.warn('Lỗi lưu KEY_SYNC_CACHE trên R2:', e);
          }
        }

        return NextResponse.json(updatedPayload);
      }
    }
  } catch (err: any) {
    console.warn('Lỗi xử lý POST /api/sync-sheets:', err);
  }
  return GET(req);
}
