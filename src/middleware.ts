import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const PUBLIC_BLOCKED_WRITE_PREFIXES = [
  '/api/declarations',
  '/api/upload-cccd-pdf',
  '/api/ocr-cccd',
  '/api/cccd',
  '/api/upload-scan',
  '/api/upload-filescan',
  '/api/d1-migrate',
  '/api/kh2959',
  '/api/sync-ggs',
  '/api/sync-sheets',
];

export async function middleware(request: NextRequest) {
  const isPublicReadOnly = process.env.NEXT_PUBLIC_PUBLIC_READONLY === 'true';
  if (isPublicReadOnly) {
    const { pathname } = request.nextUrl;
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/scanname')) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    const isCollectPanelPatch =
      pathname.startsWith('/api/declarations') &&
      request.headers.get('x-collect-panel-patch') === '1';

    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.method !== 'OPTIONS' &&
      !isCollectPanelPatch &&
      PUBLIC_BLOCKED_WRITE_PREFIXES.some((p) => pathname.startsWith(p))
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Chế độ Public chỉ xem bản đồ. Kê khai và tải CCCD lên chỉ thực hiện trên Local.',
        },
        { status: 403 }
      );
    }
  }

  try {
    const { env } = await getCloudflareContext({ async: true });
    if (env) {
      (globalThis as any).__CF_ENV__ = env;
    }
  } catch {
    try {
      const { env } = getCloudflareContext({ async: false });
      if (env) {
        (globalThis as any).__CF_ENV__ = env;
      }
    } catch {}
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/dashboard', '/dashboard/:path*', '/scanname', '/scanname/:path*'],
};
