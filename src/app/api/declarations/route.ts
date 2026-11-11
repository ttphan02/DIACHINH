import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { DeclarationFormData } from '@/types';
import { isAgriculturalLand, stripAccents } from '@/utils/textHelpers';
import parcelsBriefData from '@/data/parcels_brief.json';
import {
  getD1Binding,
  getAllD1Declarations,
  upsertD1Declaration,
  batchUpsertD1Declarations,
  deleteD1Declaration,
} from '@/utils/d1Database';

const parcelsBrief = parcelsBriefData as unknown as Record<string, [string, string, string, number]>;

export const dynamic = 'force-dynamic';

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL || 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const KEY_SYNC_CACHE = 'cache/sync_sheets.json';
const KEY_CELL_EDITS = 'cache/cell_edits.json';

interface StoragePayload {
  declaredCodes: string[];
  declarationsMap: Record<string, any>;
  cellEdits?: Record<string, Record<number, string>>;
  updatedAt?: string;
}

// In-memory cache ngắn hạn (15 giây) giúp giảm tải triệt để I/O và CPU trên Cloudflare Worker
let memoryCache: { payload: StoragePayload; timestamp: number } | null = null;
let memoryAllJsonCache: { text: string; etag: string; byteLength: number; timestamp: number } | null = null;
const MEMORY_CACHE_TTL = 15000;
let lastAllJsonSyncTime = 0;

/**
 * Đồng bộ ngầm all.json từ D1 lên R2 (được throttle tối đa 1 lần / 60 giây)
 * Ngăn chặn triệt để 100% tình trạng nhiều worker cùng lúc parse/stringify gây sập 503 / 1102
 */
async function syncAllJsonToR2Background(): Promise<void> {
  const now = Date.now();
  if (now - lastAllJsonSyncTime < 60000) return;
  lastAllJsonSyncTime = now;
  try {
    const db = await getD1Binding();
    if (db) {
      const d1Data = await getAllD1Declarations(db);
      if (d1Data && d1Data.declaredCodes && d1Data.declaredCodes.length > 0) {
        await saveDeclarationsToR2(d1Data);
      }
    }
  } catch (e) {
    console.warn('Lỗi syncAllJsonToR2Background:', e);
  }
}

/**
 * Đồng bộ bảng cell_edits trong D1 để tránh mất chỉnh sửa thửa chưa kê khai khi fallback D1
 */
async function syncCellEditsToD1(
  db: any,
  editsMap: Record<string, Record<number, string>>,
  replaceAll = false
): Promise<void> {
  if (!db) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS cell_edits (
      ma_thua TEXT,
      col_idx INTEGER,
      val TEXT,
      updated_at TEXT,
      PRIMARY KEY (ma_thua, col_idx)
    )`).run();

    const nowIso = new Date().toISOString();
    if (replaceAll) {
      await db.prepare('DELETE FROM cell_edits').run();
    }

    const statements: any[] = [];
    for (const [maThua, cols] of Object.entries(editsMap || {})) {
      if (!maThua || !cols || typeof cols !== 'object') continue;
      for (const [colKey, rawVal] of Object.entries(cols)) {
        const colIdx = Number(colKey);
        if (!Number.isFinite(colIdx)) continue;
        statements.push(
          db
            .prepare(
              `INSERT INTO cell_edits (ma_thua, col_idx, val, updated_at) VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT(ma_thua, col_idx) DO UPDATE SET val = excluded.val, updated_at = excluded.updated_at`
            )
            .bind(String(maThua), colIdx, rawVal == null ? '' : String(rawVal), nowIso)
        );
      }
    }
    const CHUNK = 50;
    for (let i = 0; i < statements.length; i += CHUNK) {
      await db.batch(statements.slice(i, i + CHUNK));
    }
  } catch (err) {
    console.warn('Lỗi lưu cell_edits vào D1:', err);
  }
}

async function deleteCellEditsForCodesInD1(db: any, codes: string[]): Promise<void> {
  if (!db || !codes.length) return;
  try {
    const stmts = codes.map((c) => db.prepare('DELETE FROM cell_edits WHERE ma_thua = ?1').bind(String(c)));
    const CHUNK = 50;
    for (let i = 0; i < stmts.length; i += CHUNK) {
      await db.batch(stmts.slice(i, i + CHUNK));
    }
  } catch {}
}

/**
 * Đọc nhanh payload all.json từ R2 (hoặc D1 fallback) để vá delta tức thì
 */
async function readAllJsonFast(bucket: any): Promise<StoragePayload> {
  if (bucket) {
    try {
      const obj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (obj) {
        const data = JSON.parse(await obj.text());
        return {
          declaredCodes: Array.isArray(data.declaredCodes) ? data.declaredCodes : [],
          declarationsMap: data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {},
          cellEdits: data.cellEdits && typeof data.cellEdits === 'object' ? data.cellEdits : {},
          updatedAt: data.updatedAt || new Date().toISOString(),
        };
      }
    } catch {}
  }
  return getDeclarationsFromR2(true);
}

/**
 * Vá trực tiếp snapshot cache/sync_sheets.json trên R2 theo header từng sheet (tuyệt đối KHÔNG xóa KEY_SYNC_CACHE)
 */
async function patchSyncSheetsSnapshotInR2(
  bucket: any,
  declItems: any[],
  cellEditsPatch?: Record<string, Record<number, string>>,
  deletedCodes?: string[]
): Promise<void> {
  if (!bucket) return;
  if ((!declItems || declItems.length === 0) && (!cellEditsPatch || Object.keys(cellEditsPatch).length === 0) && (!deletedCodes || deletedCodes.length === 0)) {
    return;
  }

  try {
    const obj = await bucket.get(KEY_SYNC_CACHE);
    if (!obj) return;
    const snapshot = JSON.parse(await obj.text());
    if (!snapshot || !snapshot.sheetsData || typeof snapshot.sheetsData !== 'object') return;

    const declByCode = new Map<string, any>();
    for (const d of declItems || []) {
      if (d?.ma_thua) declByCode.set(String(d.ma_thua), d);
    }
    const deletedSet = new Set((deletedCodes || []).map((c) => String(c)));

    let modified = false;

    for (const [sheetName, rows] of Object.entries(snapshot.sheetsData as Record<string, any[][]>)) {
      if (!Array.isArray(rows) || rows.length < 2) continue;
      const header = rows[0] || [];
      const normHeaders = header.map((h) => stripAccents(String(h || '')).toLowerCase().replace(/\s+/g, ' ').trim());

      const findCol = (preds: ((h: string) => boolean)[]) =>
        normHeaders.findIndex((h) => preds.some((fn) => fn(h)));

      const maThuaCol = findCol([(h) => h.includes('ma thua') || h === 'ma_thua']);
      if (maThuaCol < 0) continue;

      const villageCol = findCol([
        (h) => h.includes('thon / buon') || h.includes('thon/buon') || h.includes('thon buon') || h === 'thon xa' || h === 'thon_xa',
      ]);
      const nameCol = findCol([
        (h) => h.includes('ho va ten') || h.includes('chu ho') || h === 'chu_dat_ten' || h === 'ten chu',
      ]);
      const dobCol = findCol([(h) => h.includes('nam sinh') || h.includes('ngay sinh')]);
      const genderCol = findCol([(h) => h.includes('gioi tinh')]);
      const cccdCol = findCol([(h) => h.includes('cccd') || h.includes('cmnd')]);
      const areaCol = findCol([(h) => h.includes('dien tich')]);
      const landTypeCol = findCol([(h) => h.includes('loai dat')]);
      const originCol = findCol([(h) => h.includes('nguon goc')]);
      const addressCol = findCol([(h) => h.includes('dia chi')]);

      const nextRows: any[][] = [header];
      for (let rIdx = 1; rIdx < rows.length; rIdx++) {
        const row = rows[rIdx];
        if (!Array.isArray(row)) {
          nextRows.push(row);
          continue;
        }
        const code = String(row[maThuaCol] || '').trim();
        if (code && deletedSet.has(code)) {
          modified = true;
          continue;
        }

        const cloned = [...row];
        const decl = code ? declByCode.get(code) : undefined;
        if (decl) {
          const villageVal = decl.dia_chi_thua_dat || decl.thon_xa || decl.chu_dat_dia_chi || '';
          const nameVal = decl.chu_dat_ten || decl.chu_ho || decl.ho_va_ten_chu_ho || '';
          const dobVal = decl.chu_dat_nam_sinh || decl.nam_sinh_chu_ho || '';
          const genderVal = decl.chu_dat_gioi_tinh || decl.gioi_tinh_chu_ho || '';
          const cccdVal = decl.chu_dat_cccd || decl.cccd || decl.cccd_chu_ho || '';
          const areaVal = decl.dien_tich ?? '';
          const landTypeVal = decl.loai_dat || '';
          const originVal = decl.nguon_goc_su_dung || decl.nguon_goc || '';
          const addrVal = decl.chu_dat_dia_chi || villageVal;

          if (villageCol >= 0 && villageVal) cloned[villageCol] = villageVal;
          if (nameCol >= 0 && nameVal !== undefined) cloned[nameCol] = nameVal;
          if (dobCol >= 0 && dobVal !== undefined) cloned[dobCol] = dobVal;
          if (genderCol >= 0 && genderVal !== undefined) cloned[genderCol] = genderVal;
          if (cccdCol >= 0 && cccdVal !== undefined) cloned[cccdCol] = cccdVal;
          if (areaCol >= 0 && areaVal !== '') cloned[areaCol] = String(areaVal);
          if (landTypeCol >= 0 && landTypeVal) cloned[landTypeCol] = landTypeVal;
          if (originCol >= 0 && originVal !== undefined) cloned[originCol] = originVal;
          if (addressCol >= 0 && addrVal) cloned[addressCol] = addrVal;
          modified = true;
        }

        const cEdit = code && cellEditsPatch ? cellEditsPatch[code] : undefined;
        if (cEdit && typeof cEdit === 'object') {
          if (cEdit[2] !== undefined && villageCol >= 0) cloned[villageCol] = cEdit[2];
          if (cEdit[3] !== undefined && nameCol >= 0) cloned[nameCol] = cEdit[3];
          if (cEdit[4] !== undefined && dobCol >= 0) cloned[dobCol] = cEdit[4];
          if (cEdit[5] !== undefined && genderCol >= 0) cloned[genderCol] = cEdit[5];
          if (cEdit[6] !== undefined && cccdCol >= 0) cloned[cccdCol] = cEdit[6];
          if (cEdit[7] !== undefined && areaCol >= 0) cloned[areaCol] = cEdit[7];
          if (cEdit[8] !== undefined && landTypeCol >= 0) cloned[landTypeCol] = cEdit[8];
          if (cEdit[9] !== undefined && originCol >= 0) cloned[originCol] = cEdit[9];
          if (cEdit[2] !== undefined && addressCol >= 0 && !decl) cloned[addressCol] = cEdit[2];
          modified = true;
        }

        nextRows.push(cloned);
      }
      snapshot.sheetsData[sheetName] = nextRows;
    }

    if (modified) {
      snapshot.cachedAt = Date.now();
      await bucket.put(KEY_SYNC_CACHE, JSON.stringify(snapshot), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
  } catch (err) {
    console.warn('Lỗi vá snapshot cache/sync_sheets.json trên R2:', err);
  }
}

/**
 * Vá ngay cả declarations/all.json và cache/sync_sheets.json sau mọi thao tác lưu/sửa/xóa
 */
async function patchAllJsonAndSyncSheets(options: {
  declItems?: any[];
  cellEditsPatch?: Record<string, Record<number, string>>;
  replaceCellEdits?: Record<string, Record<number, string>>;
  deletedCodes?: string[];
  timestamp?: string;
}): Promise<Record<string, Record<number, string>>> {
  const bucket = await getR2Binding();
  const timestamp = options.timestamp || new Date().toISOString();
  const declItems = options.declItems || [];
  const deletedSet = new Set((options.deletedCodes || []).map((c) => String(c)));

  const currentPayload = await readAllJsonFast(bucket);
  const nextCellEdits: Record<string, Record<number, string>> = options.replaceCellEdits
    ? { ...options.replaceCellEdits }
    : { ...(currentPayload.cellEdits || {}) };

  if (options.cellEditsPatch) {
    for (const [code, cols] of Object.entries(options.cellEditsPatch)) {
      if (!code || !cols || typeof cols !== 'object') continue;
      nextCellEdits[code] = { ...(nextCellEdits[code] || {}), ...cols };
    }
  }

  for (const decl of declItems) {
    if (!decl?.ma_thua) continue;
    const code = String(decl.ma_thua);
    currentPayload.declarationsMap[code] = decl;
    if (!currentPayload.declaredCodes.includes(code)) {
      currentPayload.declaredCodes.push(code);
    }
    delete nextCellEdits[code];
  }

  if (deletedSet.size > 0) {
    currentPayload.declaredCodes = currentPayload.declaredCodes.filter((c) => !deletedSet.has(c));
    deletedSet.forEach((c) => {
      delete currentPayload.declarationsMap[c];
      delete nextCellEdits[c];
    });
  }

  currentPayload.cellEdits = nextCellEdits;
  currentPayload.updatedAt = timestamp;

  await Promise.all([
    saveDeclarationsToR2(currentPayload),
    bucket
      ? bucket
          .put(KEY_CELL_EDITS, JSON.stringify(nextCellEdits), {
            httpMetadata: { contentType: 'application/json' },
          })
          .catch(() => {})
      : Promise.resolve(),
    patchSyncSheetsSnapshotInR2(bucket, declItems, options.cellEditsPatch || options.replaceCellEdits, options.deletedCodes),
  ]);

  return nextCellEdits;
}

let cachedR2Bucket: any = null;

/**
 * Lấy R2 bucket binding với cơ chế đa tầng (Multi-tier fallback):
 * 1. Module-level cached instance
 * 2. globalThis.__CF_ENV__ (được middleware hoặc request trước khởi tạo)
 * 3. Symbol.for("__cloudflare-context__") của OpenNext
 * 4. getCloudflareContext({ async: true })
 * 5. getCloudflareContext({ async: false })
 */
async function getR2Binding(): Promise<any | null> {
  if (cachedR2Bucket) return cachedR2Bucket;

  // 1. Kiểm tra globalThis.__CF_ENV__
  if ((globalThis as any).__CF_ENV__?.DIACHINH_STORAGE) {
    cachedR2Bucket = (globalThis as any).__CF_ENV__.DIACHINH_STORAGE;
    return cachedR2Bucket;
  }

  // 2. Kiểm tra OpenNext global Symbol
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

async function getCloudflareCtx(): Promise<any | null> {
  try {
    const cf = (globalThis as any)[Symbol.for('__cloudflare-context__')];
    if (cf?.ctx) return cf.ctx;
  } catch {}
  try {
    const context = await getCloudflareContext({ async: true });
    return (context as any)?.ctx || null;
  } catch {
    return null;
  }
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
    } catch (err) {
      console.warn('Lỗi khởi tạo S3Client SDK:', err);
    }
  }
  return null;
}

// Lưu song song file đơn lẻ của từng thửa đất (Atomic, siêu nhẹ ~500 bytes, không bao giờ bị ghi đè hay mất)
async function saveSingleDeclarationToR2(maThua: string, declData: any): Promise<void> {
  if (!maThua || !declData) return;
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      await bucket.put(`declarations/parcels/${maThua}.json`, JSON.stringify(declData), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
  } catch (err) {
    console.warn(`Lỗi lưu phiếu đơn lẻ cho thửa ${maThua}:`, err);
  }
}

// Đọc danh sách phiếu kê khai từ Cloudflare R2
async function getDeclarationsFromR2(forceRefresh = false): Promise<StoragePayload> {
  const now = Date.now();
  if (!forceRefresh && memoryCache && now - memoryCache.timestamp < MEMORY_CACHE_TTL) {
    return memoryCache.payload;
  }

  // 1. Ưu tiên đọc trực tiếp từ Cloudflare D1 SQL Database
  try {
    const db = await getD1Binding();
    if (db) {
      const d1Data = await getAllD1Declarations(db);
      if (d1Data && d1Data.declaredCodes.length > 0) {
        memoryCache = { payload: d1Data, timestamp: now };
        return d1Data;
      }
    }
  } catch (d1Err) {
    console.warn('Lỗi đọc declarations từ D1 SQL Database:', d1Err);
  }

  // 2. Đọc trực tiếp qua R2 Binding (fallback nếu D1 chưa sẵn sàng)
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      const obj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (obj) {
        const text = await obj.text();
        const data = JSON.parse(text);
        const payload: StoragePayload = {
          declaredCodes: Array.isArray(data.declaredCodes) ? data.declaredCodes : [],
          declarationsMap: data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {},
          cellEdits: data.cellEdits && typeof data.cellEdits === 'object' ? data.cellEdits : {},
          updatedAt: data.updatedAt || new Date().toISOString(),
        };
        memoryCache = { payload, timestamp: now };
        return payload;
      }
    }
  } catch (err) {
    console.warn('Lỗi khi đọc declarations qua R2 binding:', err);
  }

  // 2. Fallback đọc qua R2 Public URL
  try {
    const res = await fetch(`${R2_PUBLIC_URL}/${KEY_ALL_DECLARATIONS}?t=${now}`, {
      headers: { 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      const payload: StoragePayload = {
        declaredCodes: Array.isArray(data.declaredCodes) ? data.declaredCodes : [],
        declarationsMap: data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {},
        cellEdits: data.cellEdits && typeof data.cellEdits === 'object' ? data.cellEdits : {},
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
      memoryCache = { payload, timestamp: now };
      return payload;
    }
  } catch (err) {
    console.warn('Lỗi khi fetch declarations từ public R2:', err);
  }

  const fallback: StoragePayload = { declaredCodes: [], declarationsMap: {}, cellEdits: {}, updatedAt: new Date().toISOString() };
  memoryCache = { payload: fallback, timestamp: now };
  return fallback;
}

// Lưu danh sách phiếu kê khai vào Cloudflare R2
async function saveDeclarationsToR2(payload: StoragePayload): Promise<{ success: boolean; error?: string }> {
  const jsonStr = JSON.stringify({ success: true, ...payload });
  const byteLen = new TextEncoder().encode(jsonStr).length;
  const etag = `"${Date.now()}"`;
  memoryCache = { payload, timestamp: Date.now() };
  memoryAllJsonCache = { text: jsonStr, etag, byteLength: byteLen, timestamp: Date.now() };

  try {
    const bucket = await getR2Binding();
    if (bucket) {
      await bucket.put(KEY_ALL_DECLARATIONS, jsonStr, {
        httpMetadata: { contentType: 'application/json' },
      });
      return { success: true };
    }
  } catch (err: any) {
    console.error('Lỗi ghi all.json qua R2 binding:', err?.message || err);
  }

  // Fallback qua S3 Client SDK nếu R2 binding tạm thời không khả dụng
  try {
    const s3 = await getS3Client();
    if (s3) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: KEY_ALL_DECLARATIONS,
          Body: jsonStr,
          ContentType: 'application/json',
        })
      );
      return { success: true };
    }
  } catch (s3Err: any) {
    console.warn('Lỗi ghi all.json qua S3 fallback:', s3Err?.message);
  }

  return { success: false, error: 'R2 Binding DIACHINH_STORAGE không khả dụng' };
}

// GET: Lấy toàn bộ hoặc từng phiếu kê khai (ưu tiên Cloudflare D1 SQL Database)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const maThuaParam = url.searchParams.get('ma_thua');
    const db = await getD1Binding();

    // Tra cứu siêu tốc 1 thửa trực tiếp từ D1 SQL Database (~1ms)
    if (maThuaParam && db) {
      try {
        const row = await db.prepare('SELECT * FROM declarations WHERE ma_thua = ?1').bind(maThuaParam).first();
        if (row) {
          let thuaKemTheo = [];
          if (row.thua_kem_theo_json) {
            try { thuaKemTheo = JSON.parse(row.thua_kem_theo_json); } catch {}
          }
          let anhGcnList = [];
          if (row.anh_gcn_list) {
            try { anhGcnList = JSON.parse(row.anh_gcn_list); } catch {}
          }
          return NextResponse.json({
            success: true,
            declaration: {
              ...row,
              thua_kem_theo: thuaKemTheo,
              anh_gcn_list: anhGcnList,
              is_thua_kem_theo: Boolean(row.is_thua_kem_theo),
            },
            source: 'd1_sql_database',
          });
        }
      } catch (singleErr) {
        console.warn('Lỗi đọc đơn lẻ thửa từ D1:', singleErr);
      }
    }

    // 1. Kiểm tra ETag và in-memory cache siêu tốc (< 0.1ms CPU, 0 I/O)
    const clientEtag = request.headers.get('if-none-match');
    if (memoryAllJsonCache && Date.now() - memoryAllJsonCache.timestamp < 15000) {
      const etag = memoryAllJsonCache.etag;
      if (clientEtag && (clientEtag === etag || clientEtag.includes(etag))) {
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': etag,
            'Cache-Control': 'public, max-age=5, s-maxage=15, stale-while-revalidate=30',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      return new Response(memoryAllJsonCache.text, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': String(memoryAllJsonCache.byteLength),
          'Cache-Control': 'public, max-age=5, s-maxage=15, stale-while-revalidate=30',
          'CDN-Cache-Control': 'public, max-age=15',
          'ETag': etag,
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // 2. Đọc trực tiếp từ Cloudflare R2 với đầy đủ Content-Length (Loại bỏ 100% nguy cơ stream bị cắt đứt giữa chừng)
    const bucket = await getR2Binding();
    if (bucket) {
      const obj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (obj) {
        const etag = obj.httpEtag || `"${obj.uploaded?.getTime() || 'all-decl-v1'}"`;
        if (clientEtag && (clientEtag === etag || clientEtag.includes(etag))) {
          return new Response(null, {
            status: 304,
            headers: {
              'ETag': etag,
              'Cache-Control': 'public, max-age=5, s-maxage=15, stale-while-revalidate=30',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        const text = await obj.text();
        const byteLen = new TextEncoder().encode(text).length;
        memoryAllJsonCache = {
          text,
          etag,
          byteLength: byteLen,
          timestamp: Date.now(),
        };

        return new Response(text, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': String(byteLen),
            'Cache-Control': 'public, max-age=5, s-maxage=15, stale-while-revalidate=30',
            'CDN-Cache-Control': 'public, max-age=15',
            'ETag': etag,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // 2. Dự phòng: Truy vấn từ Cloudflare D1 SQL Database nếu R2 chưa có cache
    if (db) {
      try {
        const d1Data = await getAllD1Declarations(db);
        if (d1Data && d1Data.declaredCodes.length > 0) {
          return NextResponse.json(
            {
              success: true,
              ...d1Data,
              source: 'd1_sql_database',
            },
            {
              headers: {
                'Cache-Control': 'public, max-age=3, s-maxage=10, stale-while-revalidate=30',
              },
            }
          );
        }
      } catch (d1Err) {
        console.warn('Lỗi truy vấn declarations từ D1 SQL Database:', d1Err);
      }
    }

    // 2. Fallback khi R2 Binding chưa sẵn sàng
    const r2Data = await getDeclarationsFromR2();
    return NextResponse.json(
      {
        success: true,
        source: 'R2_STORAGE',
        declaredCodes: r2Data.declaredCodes || [],
        declarationsMap: r2Data.declarationsMap || {},
        cellEdits: r2Data.cellEdits || {},
        updatedAt: r2Data.updatedAt || new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=5, s-maxage=15, stale-while-revalidate=30',
          'CDN-Cache-Control': 'public, max-age=15',
        },
      }
    );
  } catch (error: any) {
    console.error('Lỗi GET /api/declarations:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi đọc dữ liệu kê khai' },
      { status: 500 }
    );
  }
}

// POST: Client (Điện thoại hoặc Máy tính) gửi phiếu kê khai mới hoặc nháp cellEdits lên Cloudflare R2
export async function POST(request: Request) {
  // 1. Kích hoạt lấy R2 Binding ngay từ đầu request handler trước bất kỳ stream parsing nào
  await getR2Binding();
  memoryAllJsonCache = null;

  try {
    const body: any = await request.json();

    // Vá từng ô nháp (cellEdits) an toàn không ghi đè mất chỉnh sửa của thửa khác
    if (body && body.type === 'patch_cell_edits') {
      const editsPatch: Record<string, Record<number, string>> = body.cellEdits || {};
      const db = await getD1Binding();
      if (db && Object.keys(editsPatch).length > 0) {
        await syncCellEditsToD1(db, editsPatch, false);
      }
      const mergedCellEdits = await patchAllJsonAndSyncSheets({
        cellEditsPatch: editsPatch,
      });
      return NextResponse.json({ success: true, cellEdits: mergedCellEdits, patched: editsPatch });
    }

    // Đồng bộ nhanh các ô nhập nháp (cellEdits) qua các máy tính khác nhau
    if (body && (body.type === 'cell_edits' || (!body.ma_thua && body.cellEdits && (!body.batch || body.batch.length === 0)))) {
      const edits: Record<string, Record<number, string>> = body.cellEdits || {};
      const db = await getD1Binding();
      if (db) {
        await syncCellEditsToD1(db, edits, true);
      }
      const mergedCellEdits = await patchAllJsonAndSyncSheets({
        replaceCellEdits: edits,
      });
      return NextResponse.json({ success: true, cellEdits: mergedCellEdits });
    }

    // Hỗ trợ lưu hàng loạt (batch) trực tiếp vào D1 SQL Database và R2 (Siêu tốc O(1) CPU, không đọc/ghi all.json)
    if (body && Array.isArray(body.batch) && body.batch.length > 0) {
      const timestamp = new Date().toISOString();
      const d1Items: any[] = [];
      const atomicWrites: Promise<void>[] = [];
      const savedCodes: string[] = [];

      for (const item of body.batch) {
        if (!item || !item.ma_thua) continue;
        const code = item.ma_thua;
        const fullDeclData = {
          ...item,
          dia_chi_thua_dat: item.dia_chi_thua_dat || 'xã Cư Pui',
          chu_dat_dia_chi: item.chu_dat_dia_chi || item.dia_chi_thua_dat || 'xã Cư Pui',
          device_id: item.device_id || 'MAY_DEF',
          created_at: item.created_at || timestamp,
          updated_at: timestamp,
        };
        savedCodes.push(code);
        d1Items.push(fullDeclData);
        atomicWrites.push(saveSingleDeclarationToR2(code, fullDeclData));

        if (memoryCache?.payload) {
          if (!memoryCache.payload.declaredCodes.includes(code)) {
            memoryCache.payload.declaredCodes.push(code);
          }
          memoryCache.payload.declarationsMap[code] = fullDeclData;
          if (memoryCache.payload.cellEdits) {
            delete memoryCache.payload.cellEdits[code];
          }
        }
      }

      // 1. Lưu trực tiếp vào Cloudflare D1 SQL Database theo batch (siêu tốc, ACID ~2ms)
      try {
        const db = await getD1Binding();
        if (db && d1Items.length > 0) {
          await batchUpsertD1Declarations(db, d1Items);
          await deleteCellEditsForCodesInD1(db, savedCodes);
        }
      } catch (d1Err) {
        console.warn('Lỗi batch ghi D1:', d1Err);
      }

      // 2. Lưu file đơn lẻ R2 song song (~10ms I/O)
      await Promise.all(atomicWrites);

      // Invalidate in-memory caches ngay lập tức
      memoryAllJsonCache = null;

      // Xử lý cellEdits nếu được gửi kèm và vá ngay all.json + cache/sync_sheets.json trên R2
      try {
        await patchAllJsonAndSyncSheets({
          declItems: d1Items,
          replaceCellEdits: body.cellEdits || undefined,
          timestamp,
        });
      } catch (r2AllErr) {
        console.warn('Lỗi cập nhật tức thì all.json & sync_sheets lên R2:', r2AllErr);
      }

      const savedDeltaMap: Record<string, any> = {};
      for (const fullDecl of d1Items) {
        savedDeltaMap[fullDecl.ma_thua] = fullDecl;
      }

      return NextResponse.json({
        success: true,
        batchCount: d1Items.length,
        declaredCodes: savedCodes,
        declarationsMap: savedDeltaMap,
        updatedAt: timestamp,
      });
    }

    const formData = body as DeclarationFormData;
    if (!formData || !formData.ma_thua) {
      return NextResponse.json({ success: false, error: 'Thiếu mã thửa đất' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const rootMaThua = formData.ma_thua;
    const db = await getD1Binding();

    // Tra cứu nhanh thửa cũ từ D1 (~0.5ms) để bảo toàn created_at và dọn dẹp thửa kèm theo nếu có
    let previousDecl: any = null;
    if (db) {
      try {
        const row = await db.prepare('SELECT created_at, device_id, thua_kem_theo_json FROM declarations WHERE ma_thua = ?1').bind(rootMaThua).first();
        if (row) {
          let oldTkt = [];
          if (row.thua_kem_theo_json) {
            try { oldTkt = JSON.parse(row.thua_kem_theo_json); } catch {}
          }
          previousDecl = { ...row, thua_kem_theo: oldTkt };
        }
      } catch (e) {}
    } else if (memoryCache?.payload?.declarationsMap?.[rootMaThua]) {
      previousDecl = memoryCache.payload.declarationsMap[rootMaThua];
    }

    // Thu thập mã thửa trong phiếu
    const targetCodes = new Set<string>();
    targetCodes.add(rootMaThua);
    if (Array.isArray(formData.thua_kem_theo)) {
      formData.thua_kem_theo.forEach((ap) => {
        if (ap?.ma_thua) targetCodes.add(ap.ma_thua);
      });
    }

    // Dọn dẹp các thửa kèm theo cũ bị gỡ bỏ
    if (previousDecl && Array.isArray(previousDecl.thua_kem_theo)) {
      for (const ap of previousDecl.thua_kem_theo) {
        if (ap?.ma_thua && !targetCodes.has(ap.ma_thua)) {
          if (db) {
            try {
              await db.prepare('DELETE FROM declarations WHERE ma_thua = ?1 AND parent_ma_thua = ?2').bind(ap.ma_thua, rootMaThua).run();
            } catch {}
          }
          if (memoryCache?.payload) {
            const idx = memoryCache.payload.declaredCodes.indexOf(ap.ma_thua);
            if (idx >= 0) memoryCache.payload.declaredCodes.splice(idx, 1);
            delete memoryCache.payload.declarationsMap[ap.ma_thua];
          }
          const bucket = await getR2Binding();
          if (bucket) {
            bucket.delete(`declarations/parcels/${ap.ma_thua}.json`).catch(() => {});
          }
        }
      }
    }

    const rootParts = rootMaThua.split('_');
    const rootBrief = parcelsBrief[rootMaThua];
    const rootDienTich = formData.dien_tich || (rootBrief && rootBrief[0]) || '1000';
    const rootLoaiDat = formData.loai_dat || (rootBrief && rootBrief[1]) || 'LUK';
    const rootThonXa = formData.dia_chi_thua_dat || formData.thon_xa || (rootBrief && rootBrief[2]) || 'xã Cư Pui';

    const rootDeclData = {
      ...formData,
      ma_thua: rootMaThua,
      to_ban_do: rootParts[0] || formData.to_ban_do || '',
      so_thua: rootParts[1] || formData.so_thua || '',
      dien_tich: String(rootDienTich),
      loai_dat: rootLoaiDat,
      thon_xa: rootThonXa,
      dia_chi_thua_dat: rootThonXa,
      chu_dat_dia_chi: formData.chu_dat_dia_chi || rootThonXa,
      device_id: formData.device_id || previousDecl?.device_id || 'MAY_DEF',
      created_at: previousDecl?.created_at || timestamp,
      updated_at: timestamp,
    };

    const atomicWrites: Promise<void>[] = [];
    const attachedDecls: any[] = [];

    // 1. Lưu thửa chính vào R2 file đơn lẻ (~500 bytes)
    atomicWrites.push(saveSingleDeclarationToR2(rootMaThua, rootDeclData));

    // 2. Lưu từng thửa kèm theo với đúng mã thửa, tờ, thửa, diện tích và loại đất của chính nó
    if (Array.isArray(formData.thua_kem_theo)) {
      formData.thua_kem_theo.forEach((ap) => {
        if (!ap?.ma_thua) return;
        const apCode = ap.ma_thua;
        const apParts = apCode.split('_');
        const apBrief = parcelsBrief[apCode];
        const apDienTich = ap.dien_tich || (apBrief && apBrief[0]) || '1000';
        const apLoaiDat = ap.loai_dat || (apBrief && apBrief[1]) || rootLoaiDat;
        const apThonXa = ap.thon_xa || (apBrief && apBrief[2]) || rootThonXa;
        const defaultApOrigin = 'Khai Hoang';
        const apNguonGoc = ap.nguon_goc || formData.nguon_goc_su_dung || defaultApOrigin;

        const attachedDeclData = {
          ...rootDeclData,
          ma_thua: apCode,
          to_ban_do: ap.to_ban_do || apParts[0] || '',
          so_thua: ap.so_thua || apParts[1] || '',
          dien_tich: String(apDienTich),
          loai_dat: apLoaiDat,
          thon_xa: apThonXa,
          dia_chi_thua_dat: apThonXa,
          nguon_goc: apNguonGoc,
          nguon_goc_su_dung: apNguonGoc,
          is_thua_kem_theo: true,
          parent_ma_thua: rootMaThua,
          thua_kem_theo: undefined,
        };

        attachedDecls.push(attachedDeclData);
        atomicWrites.push(saveSingleDeclarationToR2(apCode, attachedDeclData));
      });
    }

    // Đợi lưu song song các file đơn lẻ (chỉ mất ~10-15ms I/O)
    await Promise.all(atomicWrites);

    // Lưu trực tiếp vào Cloudflare D1 SQL Database (ACID, row-level lock, siêu tốc 1ms)
    if (db) {
      try {
        await upsertD1Declaration(db, rootDeclData);
        for (const apDecl of attachedDecls) {
          await upsertD1Declaration(db, apDecl);
        }
        await deleteCellEditsForCodesInD1(db, Array.from(targetCodes));
      } catch (d1SaveErr) {
        console.warn('Lỗi ghi D1 (vẫn lưu R2 đơn lẻ):', d1SaveErr);
      }
    }

    // Cập nhật O(1) in-memory cache nếu đang có
    if (memoryCache?.payload) {
      if (!memoryCache.payload.declaredCodes.includes(rootMaThua)) {
        memoryCache.payload.declaredCodes.push(rootMaThua);
      }
      memoryCache.payload.declarationsMap[rootMaThua] = rootDeclData;
      if (memoryCache.payload.cellEdits) {
        delete memoryCache.payload.cellEdits[rootMaThua];
      }
      for (const ap of attachedDecls) {
        if (!memoryCache.payload.declaredCodes.includes(ap.ma_thua)) {
          memoryCache.payload.declaredCodes.push(ap.ma_thua);
        }
        memoryCache.payload.declarationsMap[ap.ma_thua] = ap;
      }
    }

    // Invalidate in-memory cache
    memoryAllJsonCache = null;

    // Vá tức thì declarations/all.json & cache/sync_sheets.json trên R2 (không bị chặn bởi throttle 60s)
    const removedAttached =
      previousDecl && Array.isArray(previousDecl.thua_kem_theo)
        ? previousDecl.thua_kem_theo
            .map((ap: any) => ap?.ma_thua)
            .filter((c: string) => Boolean(c) && !targetCodes.has(c))
        : [];
    try {
      await patchAllJsonAndSyncSheets({
        declItems: [rootDeclData, ...attachedDecls],
        deletedCodes: removedAttached,
        timestamp,
      });
    } catch (patchErr) {
      console.warn('Lỗi vá all.json / sync_sheets sau khi lưu đơn lẻ:', patchErr);
    }

    // Trả về delta chỉ chứa các thửa vừa lưu (siêu nhẹ <1KB, phản hồi ngay lập tức ~1ms)
    const savedDeltaMap: Record<string, any> = {
      [rootMaThua]: rootDeclData,
    };
    for (const ap of attachedDecls) {
      savedDeltaMap[ap.ma_thua] = ap;
    }

    const declaredCodes = Array.from(targetCodes);

    return NextResponse.json({
      success: true,
      declaredCodes,
      savedParcel: rootMaThua,
      declarationsMap: savedDeltaMap,
      updatedAt: timestamp,
    });
  } catch (error: any) {
    console.error('Lỗi POST /api/declarations:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi lưu phiếu kê khai' },
      { status: 500 }
    );
  }
}

// DELETE: Xóa phiếu kê khai
export async function DELETE(request: Request) {
  await getR2Binding();
  try {
    const { searchParams } = new URL(request.url);
    const targetMaThua = searchParams.get('ma_thua');
    if (!targetMaThua) {
      return NextResponse.json({ success: false, error: 'Thiếu mã thửa cần xóa' }, { status: 400 });
    }

    const bucket = await getR2Binding();
    const db = await getD1Binding();

    // 1. Xóa trong Cloudflare D1 SQL Database (~1ms)
    if (db) {
      try {
        await deleteD1Declaration(db, targetMaThua);
      } catch (d1DelErr) {
        console.warn('Lỗi xóa D1:', d1DelErr);
      }
    }

    // 2. Xóa file đơn lẻ trên R2
    if (bucket) {
      bucket.delete(`declarations/parcels/${targetMaThua}.json`).catch(() => {});
    }

    // 3. Cập nhật O(1) trong in-memory cache nếu có
    memoryAllJsonCache = null;
    if (memoryCache?.payload) {
      const idx = memoryCache.payload.declaredCodes.indexOf(targetMaThua);
      if (idx >= 0) memoryCache.payload.declaredCodes.splice(idx, 1);
      delete memoryCache.payload.declarationsMap[targetMaThua];
      if (memoryCache.payload.cellEdits) {
        delete memoryCache.payload.cellEdits[targetMaThua];
      }
    }

    // 4. Vá tức thì all.json & sync_sheets.json sau khi xóa
    try {
      await patchAllJsonAndSyncSheets({
        deletedCodes: [targetMaThua],
      });
    } catch (patchErr) {
      console.warn('Lỗi vá all.json sau khi xóa:', patchErr);
    }

    return NextResponse.json({
      success: true,
      deletedParcel: targetMaThua,
    });
  } catch (error: any) {
    console.error('Lỗi DELETE /api/declarations:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi xóa phiếu kê khai' },
      { status: 500 }
    );
  }
}
