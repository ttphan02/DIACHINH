import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

export const dynamic = 'force-dynamic';

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

function getS3Client(): S3Client | null {
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    });
  }
  return null;
}

function detectContentType(key: string, defaultType?: string | null): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return defaultType || 'application/octet-stream';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    if (!path || path.length === 0) {
      return new Response('Path is required', { status: 400 });
    }

    // Giải mã chuỗi URL để khớp chính xác tên tệp trong R2 (kể cả có dấu cách hoặc tiếng Việt)
    const key = path.map((segment) => decodeURIComponent(segment)).join('/');
    const filename = key.split('/').pop() || 'file';

    // 1. Ưu tiên đọc trực tiếp từ R2 Bucket Binding (hỗ trợ HTTP Range requests cho trình duyệt)
    try {
      const bucket = await getR2Binding();
      if (bucket) {
        const hasRange = request.headers.has('range');
        const obj = await bucket.get(key, {
          range: hasRange ? request.headers : undefined,
          onlyIf: request.headers,
        });

        if (obj) {
          const headers = new Headers();
          obj.writeHttpMetadata(headers);
          if (obj.httpEtag) headers.set('etag', obj.httpEtag);
          headers.set('Accept-Ranges', 'bytes');
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');

          const contentType = detectContentType(key, headers.get('content-type'));
          headers.set('Content-Type', contentType);
          headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);

          const status = obj.range ? 206 : 200;
          return new Response(obj.body, {
            status,
            headers,
          });
        }
      }
    } catch (e) {
      console.warn('R2 binding GET fallback:', e);
    }

    // 2. Dự phòng qua S3 SDK (hỗ trợ môi trường dev và đảm bảo kết nối R2)
    const s3 = getS3Client();
    if (s3) {
      try {
        const rangeHeader = request.headers.get('range');
        const s3Res = await s3.send(
          new GetObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Range: rangeHeader || undefined,
          })
        );

        if (s3Res.Body) {
          const headers = new Headers();
          headers.set('Accept-Ranges', 'bytes');
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');

          const contentType = detectContentType(key, s3Res.ContentType);
          headers.set('Content-Type', contentType);
          headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);

          if (s3Res.ContentLength) headers.set('Content-Length', String(s3Res.ContentLength));
          if (s3Res.ContentRange) headers.set('Content-Range', s3Res.ContentRange);
          if (s3Res.ETag) headers.set('etag', s3Res.ETag);

          const status = s3Res.ContentRange ? 206 : 200;
          const bodyData =
            typeof (s3Res.Body as any).transformToWebStream === 'function'
              ? (s3Res.Body as any).transformToWebStream()
              : await s3Res.Body.transformToByteArray();

          return new Response(bodyData, {
            status,
            headers,
          });
        }
      } catch (e: any) {
        if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== 'NoSuchKey') {
          console.warn('S3 SDK GET fallback error for key:', key, e?.message);
        }
      }
    }

    // 3. Dự phòng cuối qua Public R2 URL
    try {
      const encodedKey = key
        .split('/')
        .map((s) => encodeURIComponent(s))
        .join('/');
      const r2Url = `${R2_PUBLIC_BASE}/${encodedKey}`;
      const r2Response = await fetch(r2Url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          ...(request.headers.get('range') ? { range: request.headers.get('range')! } : {}),
        },
      });

      if (r2Response.ok || r2Response.status === 206) {
        const headers = new Headers();
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');

        const contentType = detectContentType(key, r2Response.headers.get('content-type'));
        headers.set('Content-Type', contentType);
        headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);

        const len = r2Response.headers.get('content-length');
        if (len) headers.set('Content-Length', len);
        const cr = r2Response.headers.get('content-range');
        if (cr) headers.set('Content-Range', cr);

        return new Response(r2Response.body, {
          status: r2Response.status,
          headers,
        });
      }
    } catch (e) {
      console.warn('R2 public URL fallback error:', e);
    }

    return new Response('File not found', { status: 404 });
  } catch (error: any) {
    return new Response(error.message || 'Internal Server Error', {
      status: 500,
    });
  }
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const getRes = await GET(request, context);
  return new Response(null, {
    status: getRes.status,
    headers: getRes.headers,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
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
