import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { isLocalNodeRuntime, readLocalJson, writeLocalJson } from '@/utils/localFileDb';

export const dynamic = 'force-dynamic';

const KEY_COLLECTED_JSON = 'cache/cccd_collected.json';
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Pragma': 'no-cache',
};

async function getR2Binding(): Promise<any | null> {
  if ((globalThis as any).__CF_ENV__?.DIACHINH_STORAGE) {
    return (globalThis as any).__CF_ENV__.DIACHINH_STORAGE;
  }
  try {
    const { env } = await getCloudflareContext({ async: true });
    if ((env as any)?.DIACHINH_STORAGE) return (env as any).DIACHINH_STORAGE;
  } catch {}
  return null;
}

async function getS3Client(): Promise<any | null> {
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    try {
      const { S3Client } = await import('@aws-sdk/client-s3');
      return new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY,
          secretAccessKey: R2_SECRET_KEY,
        },
      });
    } catch {}
  }
  return null;
}

interface CollectedPayload {
  collectedKeys: string[];
  updatedAt: string;
}

async function readCollectedFromR2(): Promise<{ payload: CollectedPayload; etag: string }> {
  const empty: CollectedPayload = { collectedKeys: [], updatedAt: '' };
  if (isLocalNodeRuntime()) {
    const localData = await readLocalJson<any>('cccd_collected.json');
    if (localData && Array.isArray(localData.collectedKeys)) {
      const etag = `"local-${localData.updatedAt || localData.collectedKeys.length}"`;
      return {
        payload: {
          collectedKeys: localData.collectedKeys,
          updatedAt: String(localData.updatedAt || ''),
        },
        etag,
      };
    }
  }
  const bucket = await getR2Binding();
  if (bucket) {
    try {
      const obj = await bucket.get(KEY_COLLECTED_JSON);
      if (obj) {
        const parsed = JSON.parse(await obj.text());
        const etag = obj.httpEtag || `"${parsed.updatedAt || 'v1'}"`;
        return {
          payload: {
            collectedKeys: Array.isArray(parsed.collectedKeys) ? parsed.collectedKeys : [],
            updatedAt: String(parsed.updatedAt || ''),
          },
          etag,
        };
      }
    } catch {}
    return { payload: empty, etag: '"empty"' };
  }

  const s3 = await getS3Client();
  if (s3) {
    try {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const res: any = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: KEY_COLLECTED_JSON }));
      if (res?.Body) {
        const text = await res.Body.transformToString('utf-8');
        const parsed = JSON.parse(text);
        const etag = res.ETag || `"${parsed.updatedAt || 'v1'}"`;
        return {
          payload: {
            collectedKeys: Array.isArray(parsed.collectedKeys) ? parsed.collectedKeys : [],
            updatedAt: String(parsed.updatedAt || ''),
          },
          etag,
        };
      }
    } catch {}
  }
  return { payload: empty, etag: '"empty"' };
}

async function writeCollectedToR2(payload: CollectedPayload): Promise<void> {
  if (isLocalNodeRuntime()) {
    await writeLocalJson('cccd_collected.json', payload);
  }
  const jsonStr = JSON.stringify(payload);
  const bucket = await getR2Binding();
  if (bucket) {
    await bucket.put(KEY_COLLECTED_JSON, jsonStr, {
      httpMetadata: { contentType: 'application/json' },
    });
    return;
  }

  const s3 = await getS3Client();
  if (s3) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: KEY_COLLECTED_JSON,
        Body: jsonStr,
        ContentType: 'application/json',
      })
    );
  }
}

export async function GET(request: Request) {
  try {
    const clientEtag = request.headers.get('if-none-match');
    const { payload, etag } = await readCollectedFromR2();

    if (clientEtag && etag && (clientEtag === etag || clientEtag.includes(etag))) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          ...NO_STORE_HEADERS,
        },
      });
    }

    return NextResponse.json(
      { success: true, ...payload },
      {
        headers: {
          ETag: etag,
          ...NO_STORE_HEADERS,
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Lỗi đọc trạng thái thu thập CCCD' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: any = await request.json();
    const { payload } = await readCollectedFromR2();
    const nextSet = new Set<string>(payload.collectedKeys);

    if (typeof body?.key === 'string' && body.key.trim()) {
      const k = body.key.trim();
      if (body.checked) nextSet.add(k);
      else nextSet.delete(k);
    } else if (Array.isArray(body?.keys)) {
      for (const k of body.keys) {
        if (typeof k === 'string' && k.trim()) nextSet.add(k.trim());
      }
    }

    const updated: CollectedPayload = {
      collectedKeys: Array.from(nextSet),
      updatedAt: new Date().toISOString(),
    };
    await writeCollectedToR2(updated);

    return NextResponse.json(
      { success: true, ...updated },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Lỗi lưu trạng thái thu thập CCCD' }, { status: 500 });
  }
}
