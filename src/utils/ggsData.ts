import { getCloudflareContext } from '@opennextjs/cloudflare';
import staticGgsSnapshot from '@/data/ggs_snapshot.json';

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
 * ĐÃ NGẮT HOÀN TOÀN việc tải trực tiếp từ Google Docs CSV để ngăn chặn triệt để lỗi 403 / 503 / CPU limit.
 * Nguồn dữ liệu sử dụng R2 Cache hoặc Bản sao snapshot tĩnh sạch (loại bỏ hoàn toàn các dòng tạm 7917-9246).
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
  if (!force) {
    try {
      const bucket = await getR2Binding();
      if (bucket) {
        const obj = await bucket.get(KEY_GGS_CACHE);
        if (obj) {
          const text = await obj.text();
          const r2Data = JSON.parse(text);
          if (r2Data && Array.isArray(r2Data.codes)) {
            cachedData = {
              ...r2Data,
              expiresAt: now + CACHE_TTL_MS,
            };
            return {
              codes: r2Data.codes,
              parcels: r2Data.parcels,
              people: r2Data.people || {},
              allCccds: r2Data.allCccds,
              updatedAt: r2Data.updatedAt,
              cached: true,
            };
          }
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc ggs cache từ R2:', e);
    }
  }

  // 3. Sử dụng bản sao dữ liệu tĩnh pre-bundled (không tốn subrequest, không tải docs.google.com)
  const snapshot = staticGgsSnapshot as any;
  cachedData = {
    codes: snapshot.codes,
    parcels: snapshot.parcels,
    people: snapshot.people || {},
    allCccds: snapshot.allCccds || [],
    updatedAt: snapshot.updatedAt || new Date().toISOString(),
    expiresAt: now + CACHE_TTL_MS,
  };

  // Lưu ngược vào R2 trong nền nếu chưa có
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      bucket.put(KEY_GGS_CACHE, JSON.stringify(cachedData), {
        httpMetadata: { contentType: 'application/json' },
      }).catch(() => {});
    }
  } catch {}

  return {
    codes: cachedData.codes,
    parcels: cachedData.parcels,
    people: cachedData.people,
    allCccds: cachedData.allCccds,
    updatedAt: cachedData.updatedAt,
    cached: false,
  };
}
