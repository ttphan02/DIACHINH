import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function middleware(request: NextRequest) {
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
