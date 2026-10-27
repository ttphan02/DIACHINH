import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_URL =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';

let cachedR2Bucket: any = null;
async function getR2Binding(): Promise<any | null> {
  if (cachedR2Bucket) return cachedR2Bucket;
  if ((globalThis as any).__CF_ENV__?.DIACHINH_STORAGE) {
    cachedR2Bucket = (globalThis as any).__CF_ENV__.DIACHINH_STORAGE;
    return cachedR2Bucket;
  }
  try {
    const ctx = (globalThis as any)[Symbol.for('__cloudflare-context__')];
    if (ctx?.env?.DIACHINH_STORAGE) {
      cachedR2Bucket = ctx.env.DIACHINH_STORAGE;
      (globalThis as any).__CF_ENV__ = ctx.env;
      return cachedR2Bucket;
    }
  } catch {}
  try {
    const { env } = await getCloudflareContext({ async: true });
    if ((env as any)?.DIACHINH_STORAGE) {
      cachedR2Bucket = (env as any).DIACHINH_STORAGE;
      (globalThis as any).__CF_ENV__ = env;
      return cachedR2Bucket;
    }
  } catch {}
  return null;
}

let memoryCache: {
  timestamp: number;
  data: {
    cccdMap: Record<string, string[]>;
    thuaMap: Record<string, string>;
    records: any[];
  };
} | null = null;
const CACHE_TTL_MS = 15000; // 15 giây

async function loadDeclarations(): Promise<Record<string, any>> {
  // 1. R2 binding
  const bucket = await getR2Binding();
  if (bucket) {
    try {
      const obj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (obj) {
        const text = await obj.text();
        const data = JSON.parse(text);
        return data.declarationsMap || {};
      }
    } catch (e) {
      console.warn('Lỗi đọc declarations qua R2 binding:', e);
    }
  }

  // 2. S3 SDK fallback (Local Node.js)
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    try {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY,
          secretAccessKey: R2_SECRET_KEY,
        },
      });
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: KEY_ALL_DECLARATIONS,
        })
      );
      if (res.Body) {
        const text = await res.Body.transformToString();
        const data = JSON.parse(text);
        return data.declarationsMap || {};
      }
    } catch (s3Err) {
      console.warn('Lỗi đọc declarations qua S3 SDK:', s3Err);
    }
  }

  // 3. Public CDN fallback
  try {
    const res = await fetch(`${R2_PUBLIC_URL}/${KEY_ALL_DECLARATIONS}?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return (data as any)?.declarationsMap || {};
    }
  } catch (fetchErr) {
    console.warn('Lỗi fetch declarations từ public R2:', fetchErr);
  }

  return {};
}

function processDeclarations(dmap: Record<string, any>) {
  const cccdMap: Record<string, string[]> = {};
  const thuaMap: Record<string, string> = {};
  const records: any[] = [];

  for (const [maThua, decl] of Object.entries(dmap)) {
    if (!decl || !maThua) continue;

    const rawCccd = String(
      decl.chu_dat_cccd || decl.cccd_chu_ho || decl.cccd || ''
    ).replace(/^="|"$/g, '').trim();
    const cleanDigits = rawCccd.replace(/\D/g, '');

    // Chỉ lấy các đơn có CCCD (từ 9 đến 12 số)
    if (cleanDigits.length < 9) continue;

    const chuHo = (decl.chu_dat_ten || decl.chu_ho || decl.ho_va_ten_chu_ho || 'Chủ sử dụng').trim();
    const thonXa = (decl.dia_chi_thua_dat || decl.thon_xa || decl.chu_dat_dia_chi || 'Xã Cư Pui').trim();
    const gcnName = `CHUACOGIAY_24478_${maThua}`;

    const rec = {
      ma_thua: maThua,
      to_ban_do: decl.to_ban_do || maThua.split('_')[0] || '',
      so_thua: decl.so_thua || maThua.split('_')[1] || '',
      chu_ho: chuHo,
      cccd: cleanDigits,
      thon_xa: thonXa,
      gcn_name: gcnName,
      cccd_file: decl.cccd_file || (cleanDigits ? `${cleanDigits.padStart(12, '0')}.pdf` : null),
    };
    records.push(rec);

    thuaMap[maThua] = gcnName;
    thuaMap[gcnName] = gcnName;

    // Helper map CCCD
    const addCccdKey = (key: string, name: string) => {
      if (!key) return;
      if (!cccdMap[key]) cccdMap[key] = [];
      if (!cccdMap[key].includes(name)) cccdMap[key].push(name);
    };

    addCccdKey(cleanDigits, gcnName);
    if (cleanDigits.length < 12) {
      addCccdKey(cleanDigits.padStart(12, '0'), gcnName);
    }

    // Xử lý các thửa kèm theo (nếu kê khai nhiều thửa trong cùng 1 đơn)
    if (Array.isArray(decl.thua_kem_theo) && decl.thua_kem_theo.length > 0) {
      for (const ap of decl.thua_kem_theo) {
        if (!ap || !ap.ma_thua) continue;
        const apGcnName = `CHUACOGIAY_24478_${ap.ma_thua}`;
        thuaMap[ap.ma_thua] = apGcnName;
        thuaMap[apGcnName] = apGcnName;
        addCccdKey(cleanDigits, apGcnName);
        if (cleanDigits.length < 12) {
          addCccdKey(cleanDigits.padStart(12, '0'), apGcnName);
        }
        records.push({
          ma_thua: ap.ma_thua,
          to_ban_do: ap.to_ban_do || ap.ma_thua.split('_')[0] || '',
          so_thua: ap.so_thua || ap.ma_thua.split('_')[1] || '',
          chu_ho: chuHo,
          cccd: cleanDigits,
          thon_xa: ap.thon_xa || thonXa,
          gcn_name: apGcnName,
          cccd_file: rec.cccd_file,
          is_kem_theo: true,
        });
      }
    }
  }

  return { cccdMap, thuaMap, records };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() || '';
  const force = url.searchParams.get('force') === 'true';
  const now = Date.now();

  let store: {
    cccdMap: Record<string, string[]>;
    thuaMap: Record<string, string>;
    records: any[];
  };

  if (!force && memoryCache && now - memoryCache.timestamp < CACHE_TTL_MS) {
    store = memoryCache.data;
  } else {
    const dmap = await loadDeclarations();
    store = processDeclarations(dmap);
    memoryCache = {
      timestamp: now,
      data: store,
    };
  }

  // 1. Nếu có tham số truy vấn tìm kiếm (q)
  if (q) {
    const cleanQ = q.replace(/\D/g, '');
    const pad12 = cleanQ.length > 0 && cleanQ.length <= 12 ? cleanQ.padStart(12, '0') : '';
    const matchedNames: string[] = [];

    // Tìm theo số CCCD
    if (cleanQ && store.cccdMap[cleanQ]) {
      store.cccdMap[cleanQ].forEach((n) => {
        if (!matchedNames.includes(n)) matchedNames.push(n);
      });
    }
    if (pad12 && store.cccdMap[pad12]) {
      store.cccdMap[pad12].forEach((n) => {
        if (!matchedNames.includes(n)) matchedNames.push(n);
      });
    }

    // Tìm theo mã thửa hoặc tên GCN
    if (store.thuaMap[q]) {
      const n = store.thuaMap[q];
      if (!matchedNames.includes(n)) matchedNames.push(n);
    }
    const cleanThua = q.replace(/^CHUACOGIAY_24478_/i, '').trim();
    if (store.thuaMap[cleanThua]) {
      const n = store.thuaMap[cleanThua];
      if (!matchedNames.includes(n)) matchedNames.push(n);
    }

    // Tìm theo tên chủ hộ (nếu tìm theo chữ)
    if (matchedNames.length === 0 && q.length >= 3 && isNaN(Number(q))) {
      const lowerQ = q.toLowerCase();
      for (const rec of store.records) {
        if (rec.chu_ho && rec.chu_ho.toLowerCase().includes(lowerQ)) {
          if (!matchedNames.includes(rec.gcn_name)) {
            matchedNames.push(rec.gcn_name);
          }
        }
      }
    }

    const matchedRecords = store.records.filter((r) => matchedNames.includes(r.gcn_name));

    return NextResponse.json(
      {
        success: true,
        query: q,
        found: matchedNames.length > 0,
        matchedNames,
        records: matchedRecords,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=10, s-maxage=30, stale-while-revalidate=60',
        },
      }
    );
  }

  // 2. Trả về toàn bộ danh bạ để frontend /scanname lưu vào bộ nhớ cache tra cứu 0ms
  return NextResponse.json(
    {
      success: true,
      totalParcels: store.records.length,
      totalCccd: Object.keys(store.cccdMap).length,
      cccdMap: store.cccdMap,
      thuaMap: store.thuaMap,
      records: store.records,
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
      },
    }
  );
}
