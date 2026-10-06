import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const R2_PUBLIC_BASE = 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

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

    // 1. Ưu tiên đọc trực tiếp từ R2 Bucket Binding trên Cloudflare Worker
    try {
      const bucket = await getR2Binding();
      if (bucket) {
        const obj = await bucket.get(key);
        if (obj) {
          const contentType =
            obj.httpMetadata?.contentType ||
            (key.endsWith('.svg')
              ? 'image/svg+xml'
              : key.endsWith('.png')
              ? 'image/png'
              : 'image/jpeg');
          const arrayBuffer = await obj.arrayBuffer();
          return new NextResponse(arrayBuffer, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }
    } catch (e) {
      console.warn('R2 binding GET fallback:', e);
    }

    // 2. Fallback qua Public R2 URL
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

// POST: Upload ảnh CCCD / GCN từ điện thoại hoặc máy tính lên thẳng Cloudflare R2
export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const key = path && path.length > 0 ? path.join('/') : `uploads/${Date.now()}.jpg`;

    const bucket = await getR2Binding();
    if (!bucket) {
      return NextResponse.json({ success: false, error: 'R2 binding unavailable' }, { status: 503 });
    }

    const contentType = request.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await request.arrayBuffer();

    await bucket.put(key, arrayBuffer, {
      httpMetadata: { contentType },
    });

    return NextResponse.json({
      success: true,
      url: `/api/image/${key}`,
      key,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Upload error' },
      { status: 500 }
    );
  }
}
