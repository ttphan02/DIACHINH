import { getCloudflareContext } from '@opennextjs/cloudflare';
import { cleanStrictName, cleanCccd } from './textHelpers';

const DEFAULT_GGS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0';

export interface GgsParcelData {
  chu_ho: string;
  cccd?: string;
  dien_tich?: string;
  loai_dat?: string;
  nam_sinh?: string;
  gioi_tinh?: string;
}

export interface GgsPersonData {
  full_name: string;
  nam_sinh?: string;
  gioi_tinh?: string;
  cccd?: string;
  dia_chi?: string;
  ma_thua?: string;
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
const CACHE_TTL_MS = 10 * 60 * 1000; // Cache 10 phút (giúp worker siêu nhẹ, không tốn CPU parse CSV)

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

function extractFields(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuote = false;
  const len = line.length;

  for (let i = 0; i < len; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur.trim());
  return fields;
}

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

  // 2. Kiểm tra cache trong Cloudflare R2 (giúp các isolate worker mới không tốn CPU parse 10.000 dòng CSV)
  if (!force) {
    try {
      const bucket = await getR2Binding();
      if (bucket) {
        const obj = await bucket.get(KEY_GGS_CACHE);
        if (obj) {
          const text = await obj.text();
          const r2Data = JSON.parse(text);
          if (r2Data && r2Data.expiresAt > now && Array.isArray(r2Data.codes)) {
            cachedData = r2Data;
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

  const ggsUrl = process.env.GOOGLE_SHEET_CSV_URL || DEFAULT_GGS_CSV_URL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(ggsUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Google Sheets trả về mã lỗi: ${response.status} ${response.statusText}`);
    }

    const csvText = await response.text();
    const lines = csvText.split(/\r?\n/);

    const ggsParcels: Record<string, GgsParcelData> = {};
    const ggsPeople: Record<string, GgsPersonData> = {};
    const codeSet = new Set<string>();
    const allCccdsSet = new Set<string>();

    for (let i = 2; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const row = extractFields(line);
      if (row.length < 3) continue;

      // Thu thập thông tin công dân (Person 1 và Person 2)
      const name1 = (row[7] || '').trim();
      const rawCccd10 = (row[10] || '').replace(/\D/g, '');
      const cleanCccd10 = (rawCccd10.length >= 9 && rawCccd10.length <= 12) ? rawCccd10.padStart(12, '0') : '';
      if (cleanCccd10) allCccdsSet.add(cleanCccd10);

      const rawCccd15 = row.length > 15 ? (row[15] || '').replace(/\D/g, '') : '';
      const cleanCccd15 = (rawCccd15.length >= 9 && rawCccd15.length <= 12) ? rawCccd15.padStart(12, '0') : '';
      if (cleanCccd15) allCccdsSet.add(cleanCccd15);

      const addr11 = (row[11] || '').trim();
      const addr23 = row.length > 23 ? (row[23] || '').trim() : '';
      const citizenAddr = addr11 || addr23;

      let mYear1 = '';
      if (row.length > 8 && row[8]) {
        const ym = row[8].match(/(?:19|20)\d{2}/);
        if (ym) mYear1 = ym[0];
      }
      const gLower = (row[9] || '').toLowerCase();
      const gender1 = (gLower.includes('nữ') || gLower.includes('nu')) ? 'Nữ' : 'Nam';

      if (name1) {
        const s1 = cleanStrictName(name1);
        if (s1 && s1.length >= 2 && !['nam', 'nữ', 'nu', 'cá nhân', 'chung', 'hộ gia đình'].includes(s1)) {
          if (!ggsPeople[s1] || (!ggsPeople[s1].cccd && cleanCccd10)) {
            ggsPeople[s1] = {
              full_name: name1,
              nam_sinh: mYear1 || ggsPeople[s1]?.nam_sinh || '',
              gioi_tinh: gender1,
              cccd: cleanCccd10 || ggsPeople[s1]?.cccd || '',
              dia_chi: citizenAddr ? `${citizenAddr}, xã Cư Pui` : 'Xã Cư Pui',
            };
          }
        }
      }

      if (row.length > 14) {
        const name2 = (row[14] || '').trim();
        if (name2) {
          const s2 = cleanStrictName(name2);
          if (s2 && s2.length >= 2 && !['nam', 'nữ', 'nu', 'cá nhân', 'chung', 'hộ gia đình'].includes(s2)) {
            if (!ggsPeople[s2] || (!ggsPeople[s2].cccd && cleanCccd15)) {
              ggsPeople[s2] = {
                full_name: name2,
                nam_sinh: ggsPeople[s2]?.nam_sinh || '',
                gioi_tinh: gender1 === 'Nam' ? 'Nữ' : 'Nam',
                cccd: cleanCccd15 || ggsPeople[s2]?.cccd || '',
                dia_chi: citizenAddr ? `${citizenAddr}, xã Cư Pui` : 'Xã Cư Pui',
              };
            }
          }
        }
      }

      const colC = (row[2] || '').trim();
      let ma_thua = '';

      if (colC) {
        const mColC = colC.match(/_(\d+_\d+)$/);
        if (mColC) {
          ma_thua = mColC[1];
        } else if (/^\d+_\d+$/.test(colC)) {
          ma_thua = colC;
        }
      }

      if (!ma_thua) {
        if (row.length > 22 && /^\d+$/.test(row[21]) && /^\d+$/.test(row[22])) {
          ma_thua = `${row[21]}_${row[22]}`;
        } else if (row.length > 24 && /^\d+$/.test(row[23]) && /^\d+$/.test(row[24])) {
          ma_thua = `${row[23]}_${row[24]}`;
        }
      }

      if (!ma_thua) {
        for (const c of [57, 59, 61, 56, 58]) {
          if (c < row.length && /^\d+_\d+$/.test(row[c])) {
            ma_thua = row[c];
            break;
          }
        }
      }

      if (!ma_thua) continue;
      codeSet.add(ma_thua);

      // 1. Tên chủ hộ: Cột 7 (Họ và tên chủ sử dụng/) hoặc Cột 14 (Tên người sử dụng hiện tại)
      let chu_ho = (row[7] || '').trim();
      if (!chu_ho && row.length > 14) {
        const altName = (row[14] || '').trim();
        if (altName && altName !== 'Chung' && altName !== 'Cá nhân') {
          chu_ho = altName;
        }
      }
      // Tuyệt đối không nhận 'Nam', 'Nữ' hoặc các từ khóa phân loại làm tên người
      const lowerOwner = chu_ho.toLowerCase();
      if (
        lowerOwner === 'nam' ||
        lowerOwner === 'nữ' ||
        lowerOwner === 'nu' ||
        lowerOwner === 'cá nhân' ||
        lowerOwner === 'chung'
      ) {
        chu_ho = '';
        if (row.length > 14) {
          const altName = (row[14] || '').trim();
          const altLower = altName.toLowerCase();
          if (
            altName &&
            altLower !== 'nam' &&
            altLower !== 'nữ' &&
            altLower !== 'nu' &&
            altLower !== 'cá nhân' &&
            altLower !== 'chung'
          ) {
            chu_ho = altName;
          }
        }
      }

      // 2. Số định danh / CCCD: Cột 10 (Số định danh cá nhân/CCCD) hoặc Cột 15
      let cccd = '';
      const rawCccd = (row[10] || '').trim();
      const cleanDigits = rawCccd.replace(/\D/g, '');
      if (cleanDigits.length >= 9 && cleanDigits.length <= 12) {
        cccd = cleanDigits;
      } else if (row.length > 15) {
        const altDigits = (row[15] || '').trim().replace(/\D/g, '');
        if (altDigits.length >= 9 && altDigits.length <= 12) {
          cccd = altDigits;
        }
      }

      // 3. Năm sinh: Cột 8 (Ngày, tháng, năm sinh)
      let nam_sinh = '';
      if (row.length > 8 && row[8]) {
        const mYear = row[8].match(/(?:19|20)\d{2}/);
        if (mYear) nam_sinh = mYear[0];
      }

      // 4. Giới tính: Cột 9 (Giới tính)
      let gioi_tinh = '';
      if (row.length > 9 && row[9]) {
        const gVal = row[9].trim().toLowerCase();
        if (gVal.includes('nữ') || gVal.includes('nu')) gioi_tinh = 'Nữ';
        else if (gVal.includes('nam')) gioi_tinh = 'Nam';
      }

      let dien_tich = '';
      if (row.length > 24) {
        const val = row[24].trim().replace(',', '.');
        if (/^\d+(\.\d+)?$/.test(val) && parseFloat(val) > 0) {
          dien_tich = val;
        }
      }

      let loai_dat = '';
      if (row.length > 25) {
        const val = row[25].trim();
        if (val && val.length <= 15) {
          loai_dat = val;
        }
      }

      const parcelData: GgsParcelData = {
        chu_ho: chu_ho || ggsParcels[ma_thua]?.chu_ho || '',
        cccd: cccd || ggsParcels[ma_thua]?.cccd || undefined,
        dien_tich: dien_tich || ggsParcels[ma_thua]?.dien_tich || undefined,
        loai_dat: loai_dat || ggsParcels[ma_thua]?.loai_dat || undefined,
        nam_sinh: nam_sinh || ggsParcels[ma_thua]?.nam_sinh || undefined,
        gioi_tinh: gioi_tinh || ggsParcels[ma_thua]?.gioi_tinh || undefined,
      };

      if (!ggsParcels[ma_thua] || (chu_ho && !ggsParcels[ma_thua].chu_ho)) {
        ggsParcels[ma_thua] = parcelData;
      } else {
        if (!ggsParcels[ma_thua].cccd && cccd) {
          ggsParcels[ma_thua].cccd = cccd;
        }
        if (!ggsParcels[ma_thua].dien_tich && dien_tich) {
          ggsParcels[ma_thua].dien_tich = dien_tich;
        }
        if (!ggsParcels[ma_thua].loai_dat && loai_dat) {
          ggsParcels[ma_thua].loai_dat = loai_dat;
        }
        if (!ggsParcels[ma_thua].nam_sinh && nam_sinh) {
          ggsParcels[ma_thua].nam_sinh = nam_sinh;
        }
        if (!ggsParcels[ma_thua].gioi_tinh && gioi_tinh) {
          ggsParcels[ma_thua].gioi_tinh = gioi_tinh;
        }
      }
    }

    // Các thửa đất ghi đè thủ công theo hồ sơ thực tế chuẩn
    const MANUAL_PARCEL_OVERRIDES: Record<string, Partial<GgsParcelData>> = {
      '78_243': {
        chu_ho: 'Ly Mí Phà',
        cccd: '002096001672',
        nam_sinh: '1996',
        gioi_tinh: 'Nam',
        dien_tich: '2482.7',
        loai_dat: 'ONT+HNK',
      },
      '6_188': {
        chu_ho: 'Ly Mí Phà',
        cccd: '002096001672',
        nam_sinh: '1996',
        gioi_tinh: 'Nam',
        dien_tich: '6977.83',
        loai_dat: 'NHK',
      },
    };

    for (const [maThua, overrideData] of Object.entries(MANUAL_PARCEL_OVERRIDES)) {
      ggsParcels[maThua] = {
        ...(ggsParcels[maThua] || {}),
        ...overrideData,
      } as GgsParcelData;
      codeSet.add(maThua);
      if (overrideData.cccd) {
        allCccdsSet.add(overrideData.cccd);
      }
    }

    // Đảm bảo thông tin công dân Ly Mí Phà chuẩn
    const lyMiPhaPerson: GgsPersonData = {
      full_name: 'Ly Mí Phà',
      nam_sinh: '1996',
      gioi_tinh: 'Nam',
      cccd: '002096001672',
      dia_chi: 'Thôn Ea Uôl, xã Cư Pui',
    };
    ggsPeople['ly mí phà'] = lyMiPhaPerson;
    ggsPeople['lý mí phà'] = lyMiPhaPerson;

    const ggsCodes = Array.from(codeSet);
    const allCccds = Array.from(allCccdsSet);
    const updatedAt = new Date().toISOString();

    cachedData = {
      codes: ggsCodes,
      parcels: ggsParcels,
      people: ggsPeople,
      allCccds,
      updatedAt,
      expiresAt: now + CACHE_TTL_MS,
    };

    try {
      const bucket = await getR2Binding();
      if (bucket) {
        await bucket.put(KEY_GGS_CACHE, JSON.stringify(cachedData), {
          httpMetadata: { contentType: 'application/json' },
        });
      }
    } catch (saveErr) {
      console.warn('Lỗi lưu ggs cache vào R2:', saveErr);
    }

    return {
      codes: ggsCodes,
      parcels: ggsParcels,
      people: ggsPeople,
      allCccds,
      updatedAt,
      cached: false,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (cachedData) {
      return {
        codes: cachedData.codes,
        parcels: cachedData.parcels,
        people: cachedData.people || {},
        allCccds: cachedData.allCccds,
        updatedAt: cachedData.updatedAt,
        cached: true,
      };
    }
    throw error;
  }
}
