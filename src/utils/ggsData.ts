const DEFAULT_GGS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0';

export interface GgsParcelData {
  chu_ho: string;
  cccd?: string;
  dien_tich?: string;
  loai_dat?: string;
}

let cachedData: {
  codes: string[];
  parcels: Record<string, GgsParcelData>;
  updatedAt: string;
  expiresAt: number;
} | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // Cache 5 phút

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
  updatedAt: string;
  cached: boolean;
}> {
  const now = Date.now();
  if (!force && cachedData && cachedData.expiresAt > now) {
    return {
      codes: cachedData.codes,
      parcels: cachedData.parcels,
      updatedAt: cachedData.updatedAt,
      cached: true,
    };
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
    const codeSet = new Set<string>();

    for (let i = 2; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const row = extractFields(line);
      if (row.length < 3) continue;

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

      let chu_ho = (row[9] || row[7] || '').trim();
      if (!chu_ho && row.length > 14) {
        const altName = (row[14] || '').trim();
        if (altName && altName !== 'Chung' && altName !== 'Cá nhân') {
          chu_ho = altName;
        }
      }

      let cccd = '';
      const rawCccd = (row[12] || row[10] || '').trim();
      const cleanDigits = rawCccd.replace(/\D/g, '');
      if (cleanDigits.length >= 9 && cleanDigits.length <= 12) {
        cccd = cleanDigits;
      } else if (row.length > 15) {
        const altDigits = (row[15] || '').trim().replace(/\D/g, '');
        if (altDigits.length >= 9 && altDigits.length <= 12) {
          cccd = altDigits;
        }
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
      }
    }

    const ggsCodes = Array.from(codeSet);
    const updatedAt = new Date().toISOString();

    cachedData = {
      codes: ggsCodes,
      parcels: ggsParcels,
      updatedAt,
      expiresAt: now + CACHE_TTL_MS,
    };

    return {
      codes: ggsCodes,
      parcels: ggsParcels,
      updatedAt,
      cached: false,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (cachedData) {
      return {
        codes: cachedData.codes,
        parcels: cachedData.parcels,
        updatedAt: cachedData.updatedAt,
        cached: true,
      };
    }
    throw error;
  }
}
