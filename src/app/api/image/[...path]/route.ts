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

    const filename = cleanKey.split('/').pop() || 'document.pdf';

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'public, max-age=31536000, immutable',
    };

    // Phân tích HTTP Range header cho PDF reader / trình duyệt
    const rangeHeader = request.headers.get('range');
    let r2Range: any = undefined;
    if (rangeHeader) {
      const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
      if (match) {
        const [, startStr, endStr] = match;
        if (startStr && endStr) {
          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);
          if (!isNaN(start) && !isNaN(end) && end >= start) {
            r2Range = { offset: start, length: end - start + 1 };
          }
        } else if (startStr) {
          const start = parseInt(startStr, 10);
          if (!isNaN(start)) {
            r2Range = { offset: start };
          }
        } else if (endStr) {
          const suffix = parseInt(endStr, 10);
          if (!isNaN(suffix) && suffix > 0) {
            r2Range = { suffix };
          }
        }
      }
    }

    const getOptions: any = {};
    if (r2Range) {
      getOptions.range = r2Range;
    } else if (rangeHeader) {
      getOptions.range = request.headers;
    }

    // 1. Phục vụ trực tiếp qua Cloudflare R2 Binding
    const bucket = await getR2Binding();
    if (bucket) {
      try {
        let obj = await bucket.get(cleanKey, getOptions);

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
              obj = await bucket.get(matchedKey, getOptions);
            }
          }
        }

        if (obj) {
          const isPartial = Boolean(obj.range);
          const status = isPartial ? 206 : 200;

          const headers = new Headers(corsHeaders);
          headers.set('Accept-Ranges', 'bytes');
          headers.set('Content-Type', obj.httpMetadata?.contentType || defaultContentType);
          headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);

          if (isPartial && obj.range) {
            const offset = obj.range.offset;
            const length = obj.range.length;
            headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
            headers.set('Content-Length', String(length));
          } else if (obj.size) {
            headers.set('Content-Length', String(obj.size));
          }

          // Trả về ArrayBuffer cho các file <= 10MB để không bị Next.js chuyển thành chunked stream,
          // giúp PDF viewer của Chrome/Edge hiển thị trơn tru không báo lỗi
          const contentLengthNum = isPartial && obj.range ? obj.range.length : obj.size;
          if (contentLengthNum && contentLengthNum <= 10 * 1024 * 1024) {
            const buffer = await obj.arrayBuffer();
            return new Response(buffer, { status, headers });
          }

          return new Response(obj.body, { status, headers });
        }
      } catch (r2Err) {
        console.warn('Lỗi đọc R2 binding:', r2Err);
      }
    }

    // 2. S3Client Fallback (CHỈ cho Local Node.js dev mode, không chạy trên production Worker để tránh Error 1102)
    if (process.env.NODE_ENV !== 'production' && !bucket) {
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
            Range: rangeHeader || undefined,
          });
          const res = await s3.send(cmd);
          if (res.Body) {
            const status = res.ContentRange ? 206 : 200;
            const headers = new Headers(corsHeaders);
            headers.set('Accept-Ranges', 'bytes');
            headers.set('Content-Type', res.ContentType || defaultContentType);
            headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
            if (res.ContentRange) {
              headers.set('Content-Range', res.ContentRange);
            }
            if (res.ContentLength) {
              headers.set('Content-Length', String(res.ContentLength));
            }
            const bodyStream = (res.Body as any).transformToWebStream
              ? (res.Body as any).transformToWebStream()
              : res.Body;
            return new Response(bodyStream, { status, headers });
          }
        } catch (s3Err) {
          console.warn('Lỗi S3 client fallback:', s3Err);
        }
      }
    }

    // 3. Fallback: Proxy từ Cloudflare R2 Public CDN phía server
    const encodedKey = cleanKey
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    const targetUrl = `${R2_PUBLIC_BASE}/${encodedKey}`;

    try {
      const upstreamHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      };
      if (rangeHeader) {
        upstreamHeaders['Range'] = rangeHeader;
      }
      const upstreamRes = await fetch(targetUrl, {
        headers: upstreamHeaders,
      });

      if (upstreamRes.ok || upstreamRes.status === 206) {
        const headers = new Headers(corsHeaders);
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Type', upstreamRes.headers.get('Content-Type') || defaultContentType);
        headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
        const cr = upstreamRes.headers.get('Content-Range');
        if (cr) headers.set('Content-Range', cr);
        const cl = upstreamRes.headers.get('Content-Length');
        if (cl) headers.set('Content-Length', cl);
        return new Response(upstreamRes.body, { status: upstreamRes.status, headers });
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
