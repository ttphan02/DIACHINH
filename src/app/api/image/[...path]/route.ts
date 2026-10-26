import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    if (!path || path.length === 0) {
      return new Response('Path is required', { status: 400 });
    }

    // Giải mã từng phần đường dẫn để xử lý ký tự tiếng Việt / dấu cách
    const key = path.map((segment) => decodeURIComponent(segment)).join('/');
    const encodedKey = key
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');

    // CHUYỂN HƯỚNG TRỰC TIẾP (307) SANG CLOUDFLARE R2 PUBLIC CDN
    // Giúp Worker tiêu tốn 0ms CPU và 0MB RAM, loại bỏ hoàn toàn lỗi 1102 khi xem ảnh/PDF CCCD
    const targetUrl = `${R2_PUBLIC_BASE}/${encodedKey}`;
    return NextResponse.redirect(targetUrl, {
      status: 307,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    return new Response(error?.message || 'Internal Server Error', {
      status: 500,
    });
  }
}
