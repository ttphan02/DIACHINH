import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { DeclarationFormData } from '@/types';
import { isAgriculturalLand, stripAccents, cleanStrictName, cleanCccd } from '@/utils/textHelpers';
import parcelsBriefData from '@/data/parcels_brief.json';
import {
  getD1Binding,
  getAllD1Declarations,
  upsertD1Declaration,
  batchUpsertD1Declarations,
  deleteD1Declaration,
  getD1SyncVersion,
  bumpD1SyncVersion,
} from '@/utils/d1Database';
import { isLocalNodeRuntime, readLocalJson, writeLocalJson } from '@/utils/localFileDb';

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

let memoryAllJsonCache: { text: string; etag: string; byteLength: number; timestamp: number } | null = null;
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
 * Cập nhật từng ô cell_edits trong D1 (MERGE theo cặp ma_thua + col_idx, KHÔNG BAO GIỜ xóa toàn bảng gây mất sửa đổi của máy khác)
 */
async function syncCellEditsToD1(
  db: any,
  editsMap: Record<string, Record<number, string>>,
  _replaceAll = false
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
    if (statements.length === 0) return;
    const CHUNK = 50;
    for (let i = 0; i < statements.length; i += CHUNK) {
      await db.batch(statements.slice(i, i + CHUNK));
    }
    await bumpD1SyncVersion(db);
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
  if (isLocalNodeRuntime()) {
    const localData = await readLocalJson<any>('declarations.json');
    if (localData && typeof localData === 'object') {
      return {
        declaredCodes: Array.isArray(localData.declaredCodes) ? localData.declaredCodes : [],
        declarationsMap: localData.declarationsMap && typeof localData.declarationsMap === 'object' ? localData.declarationsMap : {},
        cellEdits: localData.cellEdits && typeof localData.cellEdits === 'object' ? localData.cellEdits : {},
        updatedAt: localData.updatedAt || new Date().toISOString(),
      };
    }
  }
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
  const nextCellEdits: Record<string, Record<number, string>> = {
    ...(currentPayload.cellEdits || {}),
  };

  const patchSource = options.cellEditsPatch || options.replaceCellEdits;
  if (patchSource) {
    for (const [code, cols] of Object.entries(patchSource)) {
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

  // Trên Local / Private mode: Khi sửa thông tin thửa, tự động đồng bộ cùng tên chủ hộ trên mọi thửa khác
  // (CCCD, Năm sinh, Giới tính, Địa chỉ)
  if (isLocalNodeRuntime() && declItems.length > 0) {
    for (const d of declItems) {
      const targetNameStrict = cleanStrictName(d?.chu_dat_ten || d?.chu_ho || '');
      if (targetNameStrict && targetNameStrict.length >= 2) {
        const syncedCccd = cleanCccd(d.chu_dat_cccd || d.cccd || '');
        const syncedDob = d.chu_dat_nam_sinh || d.nam_sinh_chu_ho || '';
        const syncedGender = d.chu_dat_gioi_tinh || d.gioi_tinh_chu_ho || '';
        const syncedAddress = d.chu_dat_dia_chi || d.dia_chi_thua_dat || d.thon_xa || '';

        for (const [otherCode, otherDecl] of Object.entries(currentPayload.declarationsMap)) {
          if (!otherDecl || otherCode === d.ma_thua) continue;
          const otherNameStrict = cleanStrictName(otherDecl.chu_dat_ten || otherDecl.chu_ho || '');
          if (otherNameStrict === targetNameStrict) {
            let changed = false;
            if (syncedCccd && (otherDecl.chu_dat_cccd !== syncedCccd || otherDecl.cccd !== syncedCccd)) {
              otherDecl.chu_dat_cccd = syncedCccd;
              otherDecl.cccd = syncedCccd;
              otherDecl.cccd_chu_ho = syncedCccd;
              otherDecl.cccd_url = `/api/image/cccd/${encodeURIComponent(syncedCccd)}.pdf`;
              otherDecl.file_cccd_pdf = `${syncedCccd}.pdf`;
              otherDecl.cccd_file = `${syncedCccd}.pdf`;
              otherDecl.yeu_cau_thu_cccd = false;
              changed = true;
            }
            if (syncedDob && otherDecl.chu_dat_nam_sinh !== syncedDob) {
              otherDecl.chu_dat_nam_sinh = syncedDob;
              otherDecl.nam_sinh_chu_ho = syncedDob;
              changed = true;
            }
            if (syncedGender && otherDecl.chu_dat_gioi_tinh !== syncedGender) {
              otherDecl.chu_dat_gioi_tinh = syncedGender;
              otherDecl.gioi_tinh_chu_ho = syncedGender;
              changed = true;
            }
            if (syncedAddress && (otherDecl.chu_dat_dia_chi !== syncedAddress || !otherDecl.chu_dat_dia_chi)) {
              otherDecl.chu_dat_dia_chi = syncedAddress;
              changed = true;
            }
            if (changed) {
              otherDecl.updated_at = timestamp;
            }
          }
        }
      }
    }
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
  if (isLocalNodeRuntime()) return null;
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

// Đọc danh sách phiếu kê khai trực tiếp từ D1 / R2 (không giữ cache stale trong memory worker)
async function getDeclarationsFromR2(_forceRefresh = false): Promise<StoragePayload> {
  const now = Date.now();

  // 1. Ưu tiên đọc trực tiếp từ Cloudflare D1 SQL Database
  try {
    const db = await getD1Binding();
    if (db) {
      const d1Data = await getAllD1Declarations(db);
      if (d1Data && d1Data.declaredCodes.length > 0) {
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
        return payload;
      }
    }
  } catch (err) {
    console.warn('Lỗi khi đọc declarations qua R2 binding:', err);
  }

  // 3. Fallback đọc qua R2 Public URL
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
      return payload;
    }
  } catch (err) {
    console.warn('Lỗi khi fetch declarations từ public R2:', err);
  }

  return { declaredCodes: [], declarationsMap: {}, cellEdits: {}, updatedAt: new Date().toISOString() };
}

// Lưu danh sách phiếu kê khai vào Cloudflare R2
async function saveDeclarationsToR2(
  payload: StoragePayload,
  version?: string
): Promise<{ success: boolean; error?: string }> {
  const jsonStr = JSON.stringify({ success: true, ...payload });
  const etag = `"${version || Date.now()}"`;
  memoryAllJsonCache = { text: jsonStr, etag, byteLength: jsonStr.length, timestamp: Date.now() };

  // Khi chạy Local: lưu ngay lập tức vào local-data/declarations.json trước, rồi đồng bộ snapshot lên R2 cho bản Public đọc
  if (isLocalNodeRuntime()) {
    await writeLocalJson('declarations.json', { success: true, ...payload });
  }

  try {
    const bucket = await getR2Binding();
    if (bucket) {
      await bucket.put(KEY_ALL_DECLARATIONS, jsonStr, {
        httpMetadata: { contentType: 'application/json' },
        ...(version ? { customMetadata: { version } } : {}),
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

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'Access-Control-Allow-Origin': '*',
};

// GET: Đọc trực tiếp từ Cloudflare D1 SQL Database (nguồn chân lý duy nhất, không CDN cache cũ)
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
          return NextResponse.json(
            {
              success: true,
              declaration: {
                ...row,
                thua_kem_theo: thuaKemTheo,
                anh_gcn_list: anhGcnList,
                is_thua_kem_theo: Boolean(row.is_thua_kem_theo),
              },
              source: 'd1_sql_database',
            },
            { headers: NO_STORE_HEADERS }
          );
        }
      } catch (singleErr) {
        console.warn('Lỗi đọc đơn lẻ thửa từ D1:', singleErr);
      }
    }

    const clientEtag = request.headers.get('if-none-match');

    // Khi chạy Local (Node.js / PM2): đọc trực tiếp từ local-data/declarations.json (0ms, không lỗi D1 ảo)
    if (isLocalNodeRuntime()) {
      const localData = await readLocalJson<any>('declarations.json');
      if (localData && Array.isArray(localData.declaredCodes)) {
        const localEtag = `"local-${localData.updatedAt || localData.declaredCodes.length}"`;
        if (clientEtag && (clientEtag === localEtag || clientEtag.includes(localEtag))) {
          return new Response(null, {
            status: 304,
            headers: {
              'ETag': localEtag,
              ...NO_STORE_HEADERS,
            },
          });
        }
        return NextResponse.json(
          {
            success: true,
            source: 'local_file_db',
            declaredCodes: localData.declaredCodes,
            declarationsMap: localData.declarationsMap || {},
            cellEdits: localData.cellEdits || {},
            updatedAt: localData.updatedAt || new Date().toISOString(),
          },
          { headers: { ETag: localEtag, ...NO_STORE_HEADERS } }
        );
      }
    }

    // Ở chế độ Public Read-Only, ưu tiên đọc/stream thẳng declarations/all.json từ R2 để đồng bộ tức thì dữ liệu từ Local
    if (process.env.NEXT_PUBLIC_PUBLIC_READONLY === 'true') {
      const bucket = await getR2Binding();
      if (bucket) {
        try {
          const r2Obj = await bucket.get(KEY_ALL_DECLARATIONS);
          if (r2Obj?.body) {
            const r2Etag = r2Obj.httpEtag || (r2Obj.customMetadata?.version ? `"${r2Obj.customMetadata.version}"` : `"r2-${r2Obj.uploaded?.getTime() || 'v1'}"`);
            if (clientEtag && (clientEtag === r2Etag || clientEtag.includes(r2Etag))) {
              return new Response(null, {
                status: 304,
                headers: {
                  'ETag': r2Etag,
                  ...NO_STORE_HEADERS,
                },
              });
            }
            return new Response(r2Obj.body, {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'ETag': r2Etag,
                ...NO_STORE_HEADERS,
              },
            });
          }
        } catch {}
      }
    }

    // 1. Ưu tiên đọc trực tiếp từ D1 SQL Database (kiểm tra phiên bản 1 row để trả 304 <1ms nếu chưa có thay đổi)
    if (db) {
      try {
        const currentVersion = await getD1SyncVersion(db);
        const etag = currentVersion ? `"${currentVersion}"` : undefined;

        if (clientEtag && etag && (clientEtag === etag || clientEtag.includes(etag))) {
          return new Response(null, {
            status: 304,
            headers: {
              'ETag': etag,
              ...NO_STORE_HEADERS,
            },
          });
        }

        // Zero-CPU R2 stream: nếu declarations/all.json trên R2 đang khớp đúng version hiện tại của D1 -> stream thẳng body, không cần parse/stringify 1.2MB
        const bucket = await getR2Binding();
        if (bucket && currentVersion) {
          try {
            const r2Obj = await bucket.get(KEY_ALL_DECLARATIONS);
            if (r2Obj?.body && r2Obj.customMetadata?.version === currentVersion) {
              return new Response(r2Obj.body, {
                status: 200,
                headers: {
                  'Content-Type': 'application/json; charset=utf-8',
                  'ETag': etag!,
                  ...NO_STORE_HEADERS,
                },
              });
            }
          } catch {}
        }

        if (memoryAllJsonCache && etag && memoryAllJsonCache.etag === etag) {
          return new Response(memoryAllJsonCache.text, {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'ETag': etag,
              ...NO_STORE_HEADERS,
            },
          });
        }

        const d1Data = await getAllD1Declarations(db);
        if (d1Data) {
          // Đồng bộ bổ sung 1 lần nếu D1 cell_edits chưa có dữ liệu cũ từ R2
          if (Object.keys(d1Data.cellEdits).length === 0) {
            try {
              if (bucket) {
                const obj = await bucket.get(KEY_ALL_DECLARATIONS);
                if (obj) {
                  const r2Parsed = JSON.parse(await obj.text());
                  if (r2Parsed?.cellEdits && Object.keys(r2Parsed.cellEdits).length > 0) {
                    await syncCellEditsToD1(db, r2Parsed.cellEdits, false);
                    d1Data.cellEdits = r2Parsed.cellEdits;
                  }
                }
              }
            } catch {}
          }

          const finalVersion = d1Data.version || currentVersion || `d1-${d1Data.declaredCodes.length}`;
          const finalEtag = `"${finalVersion}"`;
          const text = JSON.stringify({
            success: true,
            source: 'd1_sql_database',
            declaredCodes: d1Data.declaredCodes,
            declarationsMap: d1Data.declarationsMap,
            cellEdits: d1Data.cellEdits,
            updatedAt: finalVersion,
          });
          memoryAllJsonCache = {
            text,
            etag: finalEtag,
            byteLength: text.length,
            timestamp: Date.now(),
          };

          if (bucket && finalVersion) {
            await bucket.put(KEY_ALL_DECLARATIONS, text, {
              httpMetadata: { contentType: 'application/json' },
              customMetadata: { version: finalVersion },
            }).catch(() => {});
          }

          return new Response(text, {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'ETag': finalEtag,
              ...NO_STORE_HEADERS,
            },
          });
        }
      } catch (d1Err) {
        console.warn('Lỗi truy vấn declarations từ D1 SQL Database:', d1Err);
      }
    }

    // 2. Fallback R2 nếu D1 tạm thời chưa khả dụng
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
              ...NO_STORE_HEADERS,
            },
          });
        }
        const text = await obj.text();
        const byteLen = new TextEncoder().encode(text).length;
        return new Response(text, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': String(byteLen),
            'ETag': etag,
            ...NO_STORE_HEADERS,
          },
        });
      }
    }

    const r2Data = await getDeclarationsFromR2(true);
    return NextResponse.json(
      {
        success: true,
        source: 'R2_STORAGE',
        declaredCodes: r2Data.declaredCodes || [],
        declarationsMap: r2Data.declarationsMap || {},
        cellEdits: r2Data.cellEdits || {},
        updatedAt: r2Data.updatedAt || new Date().toISOString(),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error: any) {
    console.error('Lỗi GET /api/declarations:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi đọc dữ liệu kê khai' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

// POST: Client ghi trực tiếp vào Cloudflare D1 SQL Database và vá R2 đồng bộ
export async function POST(request: Request) {
  await getR2Binding();
  memoryAllJsonCache = null;

  try {
    const body: any = await request.json();
    if (process.env.NEXT_PUBLIC_PUBLIC_READONLY === 'true') {
      const allowedType =
        body &&
        (body.type === 'patch_declaration_fields' || body.type === 'patch_cell_edits');
      if (!allowedType) {
        return NextResponse.json(
          {
            success: false,
            error: 'Chế độ Public chỉ cho phép sửa thông tin trên Danh sách Thu thập CCCD.',
          },
          { status: 403 }
        );
      }
    }

    // Vá từng trường của 1 phiếu kê khai trực tiếp trên D1 (an toàn khi nhiều máy cùng sửa khác cột trên 1 thửa)
    if (body && body.type === 'patch_declaration_fields' && body.ma_thua) {
      const maThua = String(body.ma_thua).trim();
      const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
      const fallbackDecl = body.fallbackDecl && typeof body.fallbackDecl === 'object' ? body.fallbackDecl : {};
      const timestamp = new Date().toISOString();
      const db = await getD1Binding();

      let latest: any = null;
      if (db) {
        try {
          const row = await db.prepare('SELECT * FROM declarations WHERE ma_thua = ?1').bind(maThua).first();
          if (row) {
            let tkt: any[] = [];
            if (row.thua_kem_theo_json) {
              try { tkt = JSON.parse(row.thua_kem_theo_json); } catch {}
            }
            let gcnList: string[] = [];
            if (row.anh_gcn_list) {
              try { gcnList = JSON.parse(row.anh_gcn_list); } catch {}
            }
            latest = {
              ...row,
              chu_ho: row.chu_dat_ten,
              ho_va_ten_chu_ho: row.chu_dat_ten,
              nam_sinh_chu_ho: row.chu_dat_nam_sinh,
              gioi_tinh_chu_ho: row.chu_dat_gioi_tinh,
              cccd: row.chu_dat_cccd,
              cccd_chu_ho: row.chu_dat_cccd,
              nguon_goc: row.nguon_goc_su_dung,
              thua_kem_theo: tkt.length > 0 ? tkt : undefined,
              anh_gcn_list: gcnList,
              is_thua_kem_theo: Boolean(row.is_thua_kem_theo),
              yeu_cau_thu_cccd: Boolean(row.yeu_cau_thu_cccd),
            };
          }
        } catch {}
      }
      if (!latest) {
        const current = await readAllJsonFast(await getR2Binding());
        latest = current.declarationsMap?.[maThua] || null;
      }

      const [toPart, thuaPart] = maThua.split('_');
      const brief = parcelsBrief[maThua];
      const mergedDecl: any = {
        to_ban_do: toPart || '',
        so_thua: thuaPart || '',
        dien_tich: (brief && brief[0]) || '',
        loai_dat: (brief && brief[1]) || 'DGT',
        thon_xa: (brief && brief[2]) || 'xã Cư Pui',
        ...fallbackDecl,
        ...(latest || {}),
        ...fields,
        ma_thua: maThua,
        created_at: latest?.created_at || fallbackDecl?.created_at || timestamp,
        updated_at: timestamp,
      };
      // Khi thay đổi CCCD: tự động cập nhật cccd_url và xóa cccd_url cũ nếu không còn khớp
      if (fields.chu_dat_cccd !== undefined || fields.cccd !== undefined) {
        const newCccdClean = cleanCccd(fields.chu_dat_cccd ?? fields.cccd ?? '');
        if (newCccdClean) {
          mergedDecl.chu_dat_cccd = newCccdClean;
          mergedDecl.cccd = newCccdClean;
          mergedDecl.cccd_chu_ho = newCccdClean;
          mergedDecl.cccd_url = `/api/image/cccd/${encodeURIComponent(newCccdClean)}.pdf`;
          mergedDecl.file_cccd_pdf = `${newCccdClean}.pdf`;
          mergedDecl.cccd_file = `${newCccdClean}.pdf`;
          mergedDecl.yeu_cau_thu_cccd = false;
          mergedDecl.ghi_chu = '';
        } else {
          mergedDecl.chu_dat_cccd = '';
          mergedDecl.cccd = '';
          mergedDecl.cccd_chu_ho = '';
          mergedDecl.cccd_url = '';
          mergedDecl.file_cccd_pdf = '';
          mergedDecl.cccd_file = '';
        }
      }

      if (db) {
        await upsertD1Declaration(db, mergedDecl);
        await deleteCellEditsForCodesInD1(db, [maThua]);
      }
      await saveSingleDeclarationToR2(maThua, mergedDecl);
      memoryAllJsonCache = null;
      try {
        await patchAllJsonAndSyncSheets({
          declItems: [mergedDecl],
          timestamp,
        });
      } catch {}

      let returnMap: Record<string, any> = { [maThua]: mergedDecl };
      let returnCodes: string[] = [maThua];
      if (isLocalNodeRuntime()) {
        const localData = await readLocalJson<any>('declarations.json');
        if (localData?.declarationsMap) {
          const targetNameStrict = cleanStrictName(mergedDecl.chu_dat_ten || mergedDecl.chu_ho || '');
          if (targetNameStrict) {
            for (const [c, d] of Object.entries(localData.declarationsMap)) {
              if (cleanStrictName((d as any)?.chu_dat_ten || (d as any)?.chu_ho || '') === targetNameStrict) {
                returnMap[c] = d;
                if (!returnCodes.includes(c)) returnCodes.push(c);
              }
            }
          }
        }
      }

      return NextResponse.json({
        success: true,
        savedParcel: maThua,
        declaration: mergedDecl,
        declarationsMap: returnMap,
        declaredCodes: returnCodes,
        updatedAt: timestamp,
      });
    }

    // Vá từng ô nháp (cellEdits) an toàn không ghi đè mất chỉnh sửa của thửa khác
    if (body && (body.type === 'patch_cell_edits' || body.type === 'cell_edits' || (!body.ma_thua && body.cellEdits && (!body.batch || body.batch.length === 0)))) {
      const editsPatch: Record<string, Record<number, string>> = body.cellEdits || {};
      const db = await getD1Binding();
      if (db && Object.keys(editsPatch).length > 0) {
        await syncCellEditsToD1(db, editsPatch, false);
      }
      const mergedCellEdits = await patchAllJsonAndSyncSheets({
        cellEditsPatch: editsPatch,
      });
      memoryAllJsonCache = null;
      return NextResponse.json({ success: true, cellEdits: mergedCellEdits, patched: editsPatch });
    }

    // Hỗ trợ lưu hàng loạt (batch) trực tiếp vào D1 SQL Database và R2
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
      }

      // 1. Lưu trực tiếp vào Cloudflare D1 SQL Database theo batch (ACID ~2ms)
      const db = await getD1Binding();
      if (db && d1Items.length > 0) {
        await batchUpsertD1Declarations(db, d1Items);
        await deleteCellEditsForCodesInD1(db, savedCodes);
        if (body.cellEditsPatch && typeof body.cellEditsPatch === 'object') {
          await syncCellEditsToD1(db, body.cellEditsPatch, false);
        }
      }

      // 2. Lưu file đơn lẻ R2 song song
      await Promise.all(atomicWrites);
      memoryAllJsonCache = null;

      // 3. Vá tức thì all.json & cache/sync_sheets.json trên R2 (tuyệt đối KHÔNG xóa/replace cellEdits của thửa khác)
      try {
        await patchAllJsonAndSyncSheets({
          declItems: d1Items,
          cellEditsPatch: body.cellEditsPatch || undefined,
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

    // Trên Local: Trả về toàn bộ các thửa cùng tên vừa được đồng bộ
    if (isLocalNodeRuntime()) {
      const localData = await readLocalJson<any>('declarations.json');
      if (localData?.declarationsMap) {
        const targetNameStrict = cleanStrictName(rootDeclData.chu_dat_ten || rootDeclData.chu_ho || '');
        if (targetNameStrict) {
          for (const [c, d] of Object.entries(localData.declarationsMap)) {
            if (cleanStrictName((d as any)?.chu_dat_ten || (d as any)?.chu_ho || '') === targetNameStrict) {
              savedDeltaMap[c] = d;
              if (!declaredCodes.includes(c)) declaredCodes.push(c);
            }
          }
        }
      }
    }

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

    // 3. Invalidate cached JSON response (etag changes via bumpD1SyncVersion)
    memoryAllJsonCache = null;

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
