import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

let cachedR2Bucket: any = null;

async function getR2Binding(): Promise<any | null> {
  if (cachedR2Bucket) return cachedR2Bucket;

  // 1. globalThis.__CF_ENV__
  if ((globalThis as any).__CF_ENV__?.DIACHINH_STORAGE) {
    cachedR2Bucket = (globalThis as any).__CF_ENV__.DIACHINH_STORAGE;
    return cachedR2Bucket;
  }

  // 2. OpenNext global Symbol
  try {
    const ctx = (globalThis as any)[Symbol.for('__cloudflare-context__')];
    if (ctx?.env?.DIACHINH_STORAGE) {
      cachedR2Bucket = ctx.env.DIACHINH_STORAGE;
      (globalThis as any).__CF_ENV__ = ctx.env;
      return cachedR2Bucket;
    }
  } catch {}

  // 3. getCloudflareContext async
  try {
    const { env } = await getCloudflareContext({ async: true });
    if ((env as any)?.DIACHINH_STORAGE) {
      cachedR2Bucket = (env as any).DIACHINH_STORAGE;
      (globalThis as any).__CF_ENV__ = env;
      return cachedR2Bucket;
    }
  } catch {}

  // 4. getCloudflareContext sync
  try {
    const { env } = getCloudflareContext({ async: false });
    if ((env as any)?.DIACHINH_STORAGE) {
      cachedR2Bucket = (env as any).DIACHINH_STORAGE;
      (globalThis as any).__CF_ENV__ = env;
      return cachedR2Bucket;
    }
  } catch {}

  return null;
}

let cachedS3Client: any = null;
async function getS3Client(): Promise<any | null> {
  if (cachedS3Client) return cachedS3Client;
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    try {
      const { S3Client } = await import('@aws-sdk/client-s3');
      cachedS3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY,
          secretAccessKey: R2_SECRET_KEY,
        },
      });
      return cachedS3Client;
    } catch {}
  }
  return null;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
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

    // Giải mã từng phần đường dẫn để xử lý ký tự tiếng Việt / dấu cách
    const key = path.map((segment) => decodeURIComponent(segment)).join('/');
    const cleanKey = key.replace(/^\/+/, '');

    const isPdf = cleanKey.toLowerCase().endsWith('.pdf');
    const defaultContentType = isPdf
      ? 'application/pdf'
      : cleanKey.toLowerCase().endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'public, max-age=31536000, immutable',
    };

    // 1. Phục vụ trực tiếp qua Cloudflare R2 Binding
    const bucket = await getR2Binding();
    if (bucket) {
      try {
        let obj = await bucket.get(cleanKey);

        // Fallback tra cứu CCCD theo tiền tố (VD: yêu cầu cccd/038075015833.pdf nhưng trong R2 là cccd/038075015833 - CAO VĂN HĂNG.pdf)
        if (!obj && cleanKey.startsWith('cccd/')) {
          const m = cleanKey.match(/(?:^|\/)(\d{9,12})/);
          if (m) {
            const cccdDigits = m[1];
            let listRes = await bucket.list({ prefix: `cccd/${cccdDigits}`, limit: 5 });
            if ((!listRes?.objects || listRes.objects.length === 0) && cccdDigits.length < 12) {
              const padded12 = cccdDigits.padStart(12, '0');
              listRes = await bucket.list({ prefix: `cccd/${padded12}`, limit: 5 });
            }
            if (listRes?.objects && listRes.objects.length > 0) {
              const matchedKey = listRes.objects[0].key;
              obj = await bucket.get(matchedKey);
            }
          }
        }

        if (obj) {
          const headers = new Headers(corsHeaders);
          headers.set('Content-Type', obj.httpMetadata?.contentType || defaultContentType);
          if (obj.size) {
            headers.set('Content-Length', String(obj.size));
          }
          return new Response(obj.body, { headers });
        }
      } catch (r2Err) {
        console.warn('Lỗi đọc R2 binding:', r2Err);
      }
    }

    // 2. S3Client Fallback (Local Node.js dev mode)
    const s3 = await getS3Client();
    if (s3) {
      try {
        const { GetObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
        let targetKey = cleanKey;

        if (cleanKey.startsWith('cccd/')) {
          const m = cleanKey.match(/(?:^|\/)(\d{9,12})/);
          if (m) {
            const cccdDigits = m[1];
            let listCmd = new ListObjectsV2Command({
              Bucket: R2_BUCKET,
              Prefix: `cccd/${cccdDigits}`,
              MaxKeys: 5,
            });
            let listRes = await s3.send(listCmd);
            if ((!listRes?.Contents || listRes.Contents.length === 0) && cccdDigits.length < 12) {
              listCmd = new ListObjectsV2Command({
                Bucket: R2_BUCKET,
                Prefix: `cccd/${cccdDigits.padStart(12, '0')}`,
                MaxKeys: 5,
              });
              listRes = await s3.send(listCmd);
            }
            if (listRes?.Contents && listRes.Contents.length > 0) {
              targetKey = listRes.Contents[0].Key!;
            }
          }
        }

        const cmd = new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: targetKey,
        });
        const res = await s3.send(cmd);
        if (res.Body) {
          const headers = new Headers(corsHeaders);
          headers.set('Content-Type', res.ContentType || defaultContentType);
          if (res.ContentLength) {
            headers.set('Content-Length', String(res.ContentLength));
          }
          // Chuyển Body sang ReadableStream nếu cần
          const bodyStream = (res.Body as any).transformToWebStream
            ? (res.Body as any).transformToWebStream()
            : res.Body;
          return new Response(bodyStream, { headers });
        }
      } catch (s3Err) {
        console.warn('Lỗi S3 client fallback:', s3Err);
      }
    }

    // 3. Fallback: Proxy từ Cloudflare R2 Public CDN phía server
    const encodedKey = cleanKey
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    const targetUrl = `${R2_PUBLIC_BASE}/${encodedKey}`;

    try {
      const upstreamRes = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });

      if (upstreamRes.ok) {
        const headers = new Headers(corsHeaders);
        headers.set('Content-Type', upstreamRes.headers.get('Content-Type') || defaultContentType);
        const len = upstreamRes.headers.get('Content-Length');
        if (len) headers.set('Content-Length', len);
        return new Response(upstreamRes.body, { headers });
      }
    } catch (fetchErr) {
      console.warn('Lỗi fetch upstream CDN:', fetchErr);
    }

    return new Response('File not found in R2', {
      status: 404,
      headers: corsHeaders,
    });
  } catch (error: any) {
    return new Response(error?.message || 'Internal Server Error', {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
