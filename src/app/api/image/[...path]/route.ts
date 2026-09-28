import { NextResponse } from 'next/server';

const R2_PUBLIC_BASE = 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    if (!path || path.length === 0) {
      return new NextResponse('Path is required', { status: 400 });
    }

    const key = path.join('/');
    const r2Url = `${R2_PUBLIC_BASE}/${key}`;

    const r2Response = await fetch(r2Url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });

    if (!r2Response.ok) {
      return new NextResponse('File not found', { status: r2Response.status });
    }

    const contentType =
      r2Response.headers.get('content-type') ||
      (key.endsWith('.svg')
        ? 'image/svg+xml'
        : key.endsWith('.png')
        ? 'image/png'
        : 'image/jpeg');

    const arrayBuffer = await r2Response.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    return new NextResponse(error.message || 'Internal Server Error', {
      status: 500,
    });
  }
}
