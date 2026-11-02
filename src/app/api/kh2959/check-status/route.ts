import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface CheckItem {
  ma_thua?: string;
  so_to?: string;
  so_thua?: string;
}

async function checkSingle(soTo: string, soThua: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const url = `https://www.kh2959bmt.net/api/nhom4/kiem-tra-trung-thua?ma_xa=24478&so_to=${encodeURIComponent(soTo)}&so_thua=${encodeURIComponent(soThua)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.kh2959bmt.net/nhom-4',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        // Quy tắc số hóa theo KH2959:
        // 1. trung === true (đã nộp kê khai trên web KH2959)
        // 2. nhom_1_2 === true (thửa thuộc Nhóm 1 / Nhóm 2, có dữ liệu từ trước, không cần nhập biểu nữa)
        // 3. ton_tai === false (không tồn tại trong dữ liệu bản đồ số thửa đất)
        const isDone = Boolean(data?.trung) || Boolean(data?.nhom_1_2) || (data?.ton_tai === false);
        return {
          ton_tai: Boolean(data?.ton_tai),
          trung: Boolean(data?.trung),
          nhom_1_2: Boolean(data?.nhom_1_2),
          phan_loai: data?.phan_loai || null,
          da_nhap: isDone,
        };
      } catch {
        return { ton_tai: false, trung: false, da_nhap: false };
      }
    }
  } catch (err: any) {
    return { error: err.message || 'Lỗi kết nối kh2959' };
  }
  return { ton_tai: false, trung: false, da_nhap: false };
}

export async function POST(req: Request) {
  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Dữ liệu JSON không hợp lệ' }, { status: 400 });
    }

    const parcels: CheckItem[] = Array.isArray(body?.parcels) ? body.parcels : [];

    if (parcels.length === 0) {
      return NextResponse.json({ success: false, error: 'Danh sách thửa đất rỗng' }, { status: 400 });
    }

    // Giới hạn tối đa 6 thửa mỗi request để đảm bảo dưới 6 subrequests của Cloudflare Worker
    const limitedParcels = parcels.slice(0, 6);

    const checkedResults = await Promise.all(
      limitedParcels.map(async (p) => {
        const parts = (p.ma_thua || '').split('_');
        const soTo = String(p.so_to || parts[0] || '').trim();
        const soThua = String(p.so_thua || parts[1] || '').trim();

        if (!soTo || !soThua) {
          return {
            ma_thua: p.ma_thua || '',
            so_to: soTo,
            so_thua: soThua,
            ok: false,
            error: 'Thiếu số tờ hoặc số thửa',
          };
        }

        const res = await checkSingle(soTo, soThua);
        return {
          ma_thua: p.ma_thua || `${soTo}_${soThua}`,
          so_to: soTo,
          so_thua: soThua,
          ok: true,
          ...res,
        };
      })
    );

    const importedCount = checkedResults.filter((r: any) => r.da_nhap).length;

    return NextResponse.json({
      success: true,
      totalChecked: checkedResults.length,
      importedCount,
      results: checkedResults,
    });
  } catch (error: any) {
    console.error('Lỗi check KH2959 status:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const soTo = searchParams.get('so_to') || searchParams.get('to') || '';
  const soThua = searchParams.get('so_thua') || searchParams.get('thua') || '';

  if (!soTo || !soThua) {
    return NextResponse.json({ success: false, error: 'Vui lòng cung cấp so_to và so_thua' }, { status: 400 });
  }

  const res = await checkSingle(soTo, soThua);
  return NextResponse.json({
    success: true,
    ma_thua: `${soTo}_${soThua}`,
    so_to: soTo,
    so_thua: soThua,
    ...res,
  });
}
