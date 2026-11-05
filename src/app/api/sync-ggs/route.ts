import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { GgsParcelData } from '@/utils/ggsData';

export type { GgsParcelData };
export const dynamic = 'force-dynamic';

/**
 * Endpoint đồng bộ Google Sheets Realtime.
 * Sử dụng cơ chế Zero-CPU Streaming từ Cloudflare R2 để ngăn chặn 100% lỗi 1102 / 503
 * (Worker Exceeded Resource Limits).
 */
export async function GET(request: Request) {
  try {
    let bucket: any = null;
    try {
      const { env } = await getCloudflareContext({ async: true });
      bucket = (env as any)?.DIACHINH_STORAGE;
    } catch {}

    if (bucket) {
      const obj = await bucket.get('cache/ggs.json');
      if (obj && obj.body) {
        return new Response(obj.body, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300, s-maxage=3600',
            'ETag': obj.httpEtag || '"ggs-cache-v1"',
          },
        });
      }
    }

    // Dự phòng: chuyển hướng sang static asset do CDN phục vụ 0ms Worker CPU
    return NextResponse.redirect(new URL('/data/ggs_snapshot.json', request.url), 307);
  } catch (error: any) {
    console.error('Lỗi API sync-ggs:', error);
    return NextResponse.redirect(new URL('/data/ggs_snapshot.json', request.url), 307);
  }
}
