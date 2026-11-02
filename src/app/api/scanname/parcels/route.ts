import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import parcelsData from '@/data/parcels.json';
import hiddenParcelsData from '@/data/hidden_parcels.json';

const HIDDEN_PARCEL_SET = new Set(hiddenParcelsData as string[]);

export const dynamic = 'force-dynamic';

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_URL =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const KEY_SYNC_CACHE = 'cache/sync_sheets.json';

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
    nameMap: Record<string, string[]>;
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

async function loadSyncSheets(): Promise<Record<string, string[][]>> {
  const bucket = await getR2Binding();
  if (bucket) {
    try {
      const obj = await bucket.get(KEY_SYNC_CACHE);
      if (obj) {
        const text = await obj.text();
        const data = JSON.parse(text);
        if (data?.sheetsData) return data.sheetsData;
      }
    } catch (e) {
      console.warn('Lỗi đọc cache sync_sheets qua R2 binding:', e);
    }
  }

  // S3 SDK fallback
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
          Key: KEY_SYNC_CACHE,
        })
      );
      if (res.Body) {
        const text = await res.Body.transformToString();
        const data = JSON.parse(text);
        if (data?.sheetsData) return data.sheetsData;
      }
    } catch (s3Err) {
      console.warn('Lỗi đọc sync_sheets qua S3 SDK:', s3Err);
    }
  }

  return {};
}

function buildComprehensiveDatabase(
  dmap: Record<string, any>,
  syncSheets: Record<string, string[][]>
) {
  const cccdMap: Record<string, string[]> = {};
  const thuaMap: Record<string, string> = {};
  const nameMap: Record<string, string[]> = {};
  const records: any[] = [];
  const addedRecords = new Set<string>();

  const addCccdKey = (key: string, name: string) => {
    if (!key) return;
    if (!cccdMap[key]) cccdMap[key] = [];
    if (!cccdMap[key].includes(name)) cccdMap[key].push(name);
  };

  const addEntry = (
    maThua: string | undefined,
    rawCccd: string | undefined,
    chuHo: string | undefined,
    thonXa: string | undefined
  ) => {
    if (!maThua) return;
    const cleanMa = String(maThua).trim();
    if (HIDDEN_PARCEL_SET.has(cleanMa)) return;

    const gcnName = `CHUACOGIAY_24478_${cleanMa}`;
    thuaMap[cleanMa] = gcnName;
    thuaMap[gcnName] = gcnName;

    // Hỗ trợ cả định dạng 186/845 hoặc 186-845
    const slashMa = cleanMa.replace('_', '/');
    const dashMa = cleanMa.replace('_', '-');
    thuaMap[slashMa] = gcnName;
    thuaMap[dashMa] = gcnName;

    const cleanDigits = String(rawCccd || '').replace(/^="|"$/g, '').replace(/\D/g, '');
    if (cleanDigits.length >= 9) {
      addCccdKey(cleanDigits, gcnName);
      if (cleanDigits.length < 12) {
        addCccdKey(cleanDigits.padStart(12, '0'), gcnName);
      }
    }

    const cleanName = (chuHo || '').trim();
    if (cleanName) {
      const lowerName = cleanName.toLowerCase();
      if (!nameMap[lowerName]) nameMap[lowerName] = [];
      if (!nameMap[lowerName].includes(gcnName)) nameMap[lowerName].push(gcnName);
    }

    if (!addedRecords.has(cleanMa)) {
      addedRecords.add(cleanMa);
      const parts = cleanMa.split('_');
      records.push({
        ma_thua: cleanMa,
        to_ban_do: parts[0] || '',
        so_thua: parts[1] || '',
        chu_ho: cleanName || 'Chủ sử dụng',
        cccd: cleanDigits,
        thon_xa: (thonXa || 'Xã Cư Pui').trim(),
        gcn_name: gcnName,
        cccd_file: cleanDigits ? `${cleanDigits.padStart(12, '0')}.pdf` : null,
      });
    }
  };

  // 1. Nạp từ toàn bộ các sheet của syncSheets (Đặc biệt là THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD) đã qua đối soát R2)
  if (syncSheets && typeof syncSheets === 'object') {
    for (const [, rows] of Object.entries(syncSheets)) {
      if (!Array.isArray(rows) || rows.length <= 1) continue;
      const headers = rows[0] || [];
      const maIdx = headers.findIndex((h) => /mã thửa/i.test(h));
      const nameIdx = headers.findIndex((h) => /họ và tên|chủ đất/i.test(h));
      const cccdIdx = headers.findIndex((h) => /cccd/i.test(h) && !/xem|file/i.test(h));
      const thonIdx = headers.findIndex((h) => /thôn|buôn/i.test(h));

      for (const r of rows.slice(1)) {
        const maThua = maIdx >= 0 ? r[maIdx] : r[1];
        const chuHo = nameIdx >= 0 ? r[nameIdx] : r[3];
        const cccd = cccdIdx >= 0 ? r[cccdIdx] : r[6];
        const thon = thonIdx >= 0 ? r[thonIdx] : r[2];
        addEntry(maThua, cccd, chuHo, thon);
      }
    }
  }

  // 2. Nạp từ declarationsMap (kê khai trực tiếp từ cán bộ)
  if (dmap && typeof dmap === 'object') {
    for (const [maThua, decl] of Object.entries(dmap)) {
      if (!decl) continue;
      addEntry(
        maThua,
        decl.chu_dat_cccd || decl.cccd_chu_ho || decl.cccd,
        decl.chu_dat_ten || decl.chu_ho || decl.ho_va_ten_chu_ho,
        decl.dia_chi_thua_dat || decl.thon_xa || decl.chu_dat_dia_chi
      );
      if (Array.isArray(decl.thua_kem_theo)) {
        decl.thua_kem_theo.forEach((ap: any) => {
          if (ap && ap.ma_thua) {
            addEntry(
              ap.ma_thua,
              decl.chu_dat_cccd || decl.cccd_chu_ho || decl.cccd,
              decl.chu_dat_ten || decl.chu_ho,
              ap.thon_xa || decl.dia_chi_thua_dat
            );
          }
        });
      }
    }
  }

  // 3. Nạp từ parcels.json (toàn xã 9.822 thửa đất)
  if (Array.isArray(parcelsData)) {
    for (const p of parcelsData as any[]) {
      if (p.ma_thua) {
        addEntry(p.ma_thua, p.cccd, p.chu_ho, p.thon_xa);
      }
    }
  }

  return { cccdMap, thuaMap, nameMap, records };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() || '';
  const force = url.searchParams.get('force') === 'true';
  const now = Date.now();

  let store: {
    cccdMap: Record<string, string[]>;
    thuaMap: Record<string, string>;
    nameMap: Record<string, string[]>;
    records: any[];
  };

  if (!force && memoryCache && now - memoryCache.timestamp < CACHE_TTL_MS) {
    store = memoryCache.data;
  } else {
    const [dmap, syncSheets] = await Promise.all([
      loadDeclarations(),
      loadSyncSheets(),
    ]);
    store = buildComprehensiveDatabase(dmap, syncSheets);
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

    // 1. Tìm theo số CCCD (chính xác hoặc 12 số)
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

    // 2. Tìm theo mã thửa hoặc tên GCN
    if (store.thuaMap[q]) {
      const n = store.thuaMap[q];
      if (!matchedNames.includes(n)) matchedNames.push(n);
    }
    const cleanThua = q.replace(/^CHUACOGIAY_24478_/i, '').trim();
    if (store.thuaMap[cleanThua]) {
      const n = store.thuaMap[cleanThua];
      if (!matchedNames.includes(n)) matchedNames.push(n);
    }
    const normSlash = cleanThua.replace(/[/\\-]/g, '_');
    if (store.thuaMap[normSlash]) {
      const n = store.thuaMap[normSlash];
      if (!matchedNames.includes(n)) matchedNames.push(n);
    }

    // 3. Tìm theo tên chủ hộ (chính xác hoặc substring)
    const lowerQ = q.toLowerCase();
    if (store.nameMap[lowerQ]) {
      store.nameMap[lowerQ].forEach((n) => {
        if (!matchedNames.includes(n)) matchedNames.push(n);
      });
    }
    if (matchedNames.length === 0 && q.length >= 3 && isNaN(Number(q))) {
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

  // 2. Trả về toàn bộ danh bạ toàn diện để frontend /scanname lưu vào bộ nhớ cache tra cứu 0ms
  return NextResponse.json(
    {
      success: true,
      totalParcels: store.records.length,
      totalCccd: Object.keys(store.cccdMap).length,
      totalNames: Object.keys(store.nameMap).length,
      cccdMap: store.cccdMap,
      thuaMap: store.thuaMap,
      nameMap: store.nameMap,
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
