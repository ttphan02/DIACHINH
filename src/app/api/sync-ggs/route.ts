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
      if (row.length < 3) continue;

      const colC = (row[2] || '').trim();
      let ma_thua = '';

      // 1. Ưu tiên hàng đầu: Trích xuất mã thửa từ Cột C (ví dụ: CHUACOGIAY_24478_263_58 -> 263_58)
      if (colC) {
        const mColC = colC.match(/_(\d+_\d+)$/);
        if (mColC) {
          ma_thua = mColC[1];
        } else if (/^\d+_\d+$/.test(colC)) {
          ma_thua = colC;
        }
      }

      // 2. Nếu Cột C không chứa chuỗi X_Y, kiểm tra Cột V (Tờ - index 21) và Cột W (Thửa - index 22)
      if (!ma_thua) {
        if (row.length > 22 && /^\d+$/.test(row[21]) && /^\d+$/.test(row[22])) {
          ma_thua = `${row[21]}_${row[22]}`;
        } else if (row.length > 24 && /^\d+$/.test(row[23]) && /^\d+$/.test(row[24])) {
          ma_thua = `${row[23]}_${row[24]}`;
        }
      }

      // 3. Fallback kiểm tra các cột mã phụ (Col 57, 59, 61, 56, 58) nếu vẫn chưa tìm thấy
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

      // Lấy Họ và tên chủ sử dụng: Trực tiếp từ Cột H (index 7)
      let chu_ho = (row[7] || '').trim();
      // Nếu Cột H trống, lấy tên người sử dụng hiện tại từ Cột O (index 14)
      if (!chu_ho && row.length > 14) {
        const altName = (row[14] || '').trim();
        if (altName && altName !== 'Chung' && altName !== 'Cá nhân') {
          chu_ho = altName;
        }
      }

      // Lấy Số CCCD / Số định danh: Trực tiếp từ Cột K (index 10)
      let cccd = '';
      const rawCccd = (row[10] || '').trim();
      if (/^\d{9,15}$/.test(rawCccd)) {
        cccd = rawCccd;
      } else if (row.length > 15 && /^\d{9,15}$/.test((row[15] || '').trim())) {
        cccd = (row[15] || '').trim(); // Cột P (index 15): CCCD người sử dụng hiện tại
      }

      // Tìm diện tích: Cột Y (index 24)
      let dien_tich = '';
      if (row.length > 24) {
        const val = row[24].trim().replace(',', '.');
        if (/^\d+(\.\d+)?$/.test(val) && parseFloat(val) > 0) {
          dien_tich = val;
        }
      }

      // Tìm loại đất: Cột Z (index 25)
      let loai_dat = '';
      if (row.length > 25) {
        const val = row[25].trim();
        if (val && val.length <= 15) {
          loai_dat = val;
        }
      }

      // Lưu trữ dữ liệu thửa đất
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

      // Hỗ trợ cả key đảo ngược (to_thua và thua_to) để tra cứu luôn chính xác 100%
      if (ma_thua.includes('_')) {
        const [p1, p2] = ma_thua.split('_');
        if (p1 && p2) {
          const revKey = `${p2}_${p1}`;
          codeSet.add(revKey);
          if (!ggsParcels[revKey] || (chu_ho && !ggsParcels[revKey].chu_ho)) {
            ggsParcels[revKey] = parcelData;
          }
        }
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
