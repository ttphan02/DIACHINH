import { NextResponse } from 'next/server';

const DEFAULT_GGS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0';

export interface GgsParcelData {
  chu_ho: string;
  cccd?: string;
  dien_tich?: string;
  loai_dat?: string;
}

// In-memory cache
let cachedData: {
  codes: string[];
  parcels: Record<string, GgsParcelData>;
  updatedAt: string;
  expiresAt: number;
} | null = null;

const CACHE_TTL_MS = 30 * 1000; // Cache 30 giây để realtime nhưng không quá tải

function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuote && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (c === ',' && !inQuote) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';
    const now = Date.now();

    // Trả về dữ liệu từ cache nếu còn hạn và không ép buộc làm mới
    if (!force && cachedData && cachedData.expiresAt > now) {
      return NextResponse.json({
        success: true,
        totalGgsCodes: cachedData.codes.length,
        ggsCodes: cachedData.codes,
        ggsParcels: cachedData.parcels,
        updatedAt: cachedData.updatedAt,
        cached: true,
      });
    }

    const ggsUrl = process.env.GOOGLE_SHEET_CSV_URL || DEFAULT_GGS_CSV_URL;

    // Fetch Google Sheet CSV
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(ggsUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      next: { revalidate: 0 },
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
      const row = parseCsvLine(line);
      if (row.length < 5) continue;

      let ma_thua = '';

      // 1. Kiểm tra các cột mã (Col 57, 59, 61, 56, 58)
      for (const c of [57, 59, 61, 56, 58]) {
        if (c < row.length && /^\d+_\d+$/.test(row[c])) {
          ma_thua = row[c];
          break;
        }
      }

      // 2. Kiểm tra cột tờ và thửa
      if (!ma_thua) {
        if (row.length > 22 && /^\d+$/.test(row[21]) && /^\d+$/.test(row[22])) {
          ma_thua = `${row[21]}_${row[22]}`;
        } else if (row.length > 24 && /^\d+$/.test(row[23]) && /^\d+$/.test(row[24])) {
          ma_thua = `${row[23]}_${row[24]}`;
        }
      }

      // 3. Chuỗi CHUACOGIAY_24478_to_thua
      if (!ma_thua) {
        for (const cell of row) {
          const m = cell.match(/CHUACOGIAY_\d+_(\d+)_(\d+)/);
          if (m) {
            ma_thua = `${m[1]}_${m[2]}`;
            break;
          }
        }
      }

      if (!ma_thua) continue;
      codeSet.add(ma_thua);

      // Tìm tên chủ hộ
      let chu_ho = '';
      for (const c of [7, 9, 8, 14, 5]) {
        if (c < row.length) {
          const val = row[c];
          if (val && !/^\d+$/.test(val) && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) {
            if (val !== 'Nam' && val !== 'Nữ' && val !== 'Cá nhân' && val !== 'Hộ gia đình' && val.length >= 2) {
              if (!val.includes('UBND')) {
                chu_ho = val;
                break;
              } else if (!chu_ho) {
                chu_ho = val;
              }
            }
          }
        }
      }

      // Tìm CCCD
      let cccd = '';
      for (const c of [10, 12, 11, 15, 6]) {
        if (c < row.length) {
          const val = row[c];
          if (/^\d{9,12}$/.test(val)) {
            cccd = val;
            break;
          }
        }
      }

      // Tìm diện tích
      let dien_tich = '';
      for (const c of [24, 26, 28, 20]) {
        if (c < row.length) {
          const val = row[c].replace(',', '.');
          if (/^\d+(\.\d+)?$/.test(val) && parseFloat(val) > 0) {
            dien_tich = val;
            break;
          }
        }
      }

      // Tìm loại đất
      let loai_dat = '';
      for (const c of [25, 27, 29]) {
        if (c < row.length) {
          const val = row[c];
          if (val && val.length <= 10 && /^[A-Z0-9]+$/.test(val)) {
            loai_dat = val;
            break;
          }
        }
      }

      if (!ggsParcels[ma_thua] || (chu_ho && !ggsParcels[ma_thua].chu_ho)) {
        ggsParcels[ma_thua] = {
          chu_ho,
          cccd: cccd || undefined,
          dien_tich: dien_tich || undefined,
          loai_dat: loai_dat || undefined,
        };
      }
    }

    const ggsCodes = Array.from(codeSet);
    const updatedAt = new Date().toISOString();

    // Lưu cache
    cachedData = {
      codes: ggsCodes,
      parcels: ggsParcels,
      updatedAt,
      expiresAt: now + CACHE_TTL_MS,
    };

    return NextResponse.json({
      success: true,
      totalGgsCodes: ggsCodes.length,
      ggsCodes,
      ggsParcels,
      updatedAt,
      cached: false,
    });
  } catch (error: any) {
    console.error('Lỗi đồng bộ Google Sheets:', error);

    // Nếu fetch lỗi nhưng có cache cũ, trả về cache cũ kèm cảnh báo
    if (cachedData) {
      return NextResponse.json({
        success: true,
        totalGgsCodes: cachedData.codes.length,
        ggsCodes: cachedData.codes,
        ggsParcels: cachedData.parcels,
        updatedAt: cachedData.updatedAt,
        cached: true,
        warning: `Không thể kết nối GGS (${error.message}), đang dùng dữ liệu đã lưu gần nhất`,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Lỗi kết nối tới Google Sheets',
        totalGgsCodes: 0,
        ggsCodes: [],
        ggsParcels: {},
      },
      { status: 500 }
    );
  }
}
