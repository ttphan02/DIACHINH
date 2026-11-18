import { getCloudflareContext } from '@opennextjs/cloudflare';

export interface GgsParcelData {
  chu_ho: string;
  cccd?: string;
  dien_tich?: string;
  loai_dat?: string;
  nam_sinh?: string;
  gioi_tinh?: string;
  to_ban_do?: string;
  thon_xa?: string;
}

export interface GgsPersonData {
  full_name: string;
  nam_sinh?: string;
  gioi_tinh?: string;
  cccd?: string;
  dia_chi?: string;
  ma_thua?: string;
  to_ban_do?: string;
}

let cachedData: {
  codes: string[];
  parcels: Record<string, GgsParcelData>;
  people: Record<string, GgsPersonData>;
  allCccds: string[];
  updatedAt: string;
  expiresAt: number;
} | null = null;

const KEY_GGS_CACHE = 'cache/ggs.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Cache 24 giờ tĩnh

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

/**
 * Lấy dữ liệu Google Sheets đã đồng bộ vào hệ thống.
 * ĐÃ NGẮT HOÀN TOÀN việc tải trực tiếp từ Google Docs CSV và loại bỏ staticGgsSnapshot bundle
 * để giải phóng 2MB bộ nhớ và triệt tiêu lỗi 1102 / 503 Worker Exceeded Resource Limits.
 */
export async function fetchOrGetCachedGgsData(force = false): Promise<{
  codes: string[];
  parcels: Record<string, GgsParcelData>;
  people: Record<string, GgsPersonData>;
  allCccds: string[];
  updatedAt: string;
  cached: boolean;
}> {
  const now = Date.now();

  // 1. Kiểm tra cache trong bộ nhớ (0ms CPU)
  if (!force && cachedData && cachedData.expiresAt > now) {
    return {
      codes: cachedData.codes,
      parcels: cachedData.parcels,
      people: cachedData.people || {},
      allCccds: cachedData.allCccds,
      updatedAt: cachedData.updatedAt,
      cached: true,
    };
  }

  // 2. Kiểm tra cache trong Cloudflare R2
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      const obj = await bucket.get(KEY_GGS_CACHE);
      if (obj) {
        const text = await obj.text();
        const r2Data = JSON.parse(text);
        if (r2Data && (Array.isArray(r2Data.codes) || Array.isArray(r2Data.ggsCodes))) {
          const codes = r2Data.codes || r2Data.ggsCodes || [];
          const parcels = r2Data.parcels || r2Data.ggsParcels || {};
          const allCccds = r2Data.allCccds || r2Data.ggsCccds || [];
          cachedData = {
            codes,
            parcels,
            people: r2Data.people || {},
            allCccds,
            updatedAt: r2Data.updatedAt || new Date().toISOString(),
            expiresAt: now + CACHE_TTL_MS,
          };
          return {
            codes: cachedData.codes,
            parcels: cachedData.parcels,
            people: cachedData.people,
            allCccds: cachedData.allCccds,
            updatedAt: cachedData.updatedAt,
            cached: true,
          };
        }
      }
    }
  } catch (e) {
    console.warn('Lỗi đọc ggs cache từ R2:', e);
  }

  // 3. Fallback: Đọc file snapshot tĩnh từ public/data/ggs_snapshot.json
  try {
    const fs = await import('fs');
    const path = await import('path');
    let snapPath = path.join(process.cwd(), 'public', 'data', 'ggs_snapshot.json');
    if (!fs.existsSync(snapPath)) {
      snapPath = path.join(process.cwd(), 'diachinh-web', 'public', 'data', 'ggs_snapshot.json');
    }
    if (fs.existsSync(snapPath)) {
      const snapText = fs.readFileSync(snapPath, 'utf8');
      const snapData = JSON.parse(snapText);
      const codes = snapData.codes || snapData.ggsCodes || [];
      const parcels = snapData.parcels || snapData.ggsParcels || {};
      const allCccds = snapData.allCccds || snapData.ggsCccds || [];
      cachedData = {
        codes,
        parcels,
        people: snapData.people || {},
        allCccds,
        updatedAt: snapData.updatedAt || new Date().toISOString(),
        expiresAt: now + CACHE_TTL_MS,
      };
      return {
        codes,
        parcels,
        people: cachedData.people,
        allCccds,
        updatedAt: cachedData.updatedAt,
        cached: true,
      };
    }
  } catch (e) {
    console.warn('Lỗi đọc ggs snapshot từ local disk:', e);
  }

  return {
    codes: [],
    parcels: {},
    people: {},
    allCccds: [],
    updatedAt: new Date().toISOString(),
    cached: false,
  };
}
