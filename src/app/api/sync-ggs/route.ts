import { NextResponse } from 'next/server';

const DEFAULT_GGS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0';

// In-memory cache
let cachedData: {
  codes: string[];
  updatedAt: string;
  expiresAt: number;
} | null = null;

const CACHE_TTL_MS = 30 * 1000; // Cache 30 giây để tối ưu tốc độ nhưng vẫn đảm bảo realtime

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
        updatedAt: cachedData.updatedAt,
        cached: true,
      });
    }

    const ggsUrl = process.env.GOOGLE_SHEET_CSV_URL || DEFAULT_GGS_CSV_URL;

    // Fetch Google Sheet CSV
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

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

    // Trích xuất mã thửa dạng to_thua (ví dụ 308_13, 286_25,...)
    const codeSet = new Set<string>();
    const matches = csvText.match(/\b\d+_\d+\b/g);
    if (matches) {
      for (const m of matches) {
        codeSet.add(m);
      }
    }

    const ggsCodes = Array.from(codeSet);
    const updatedAt = new Date().toISOString();

    // Lưu cache
    cachedData = {
      codes: ggsCodes,
      updatedAt,
      expiresAt: now + CACHE_TTL_MS,
    };

    return NextResponse.json({
      success: true,
      totalGgsCodes: ggsCodes.length,
      ggsCodes,
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
      },
      { status: 500 }
    );
  }
}
