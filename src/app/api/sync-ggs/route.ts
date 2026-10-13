import { NextResponse } from 'next/server';
import { fetchOrGetCachedGgsData, GgsParcelData } from '@/utils/ggsData';

export type { GgsParcelData };

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';

    const result = await fetchOrGetCachedGgsData(force);

    return NextResponse.json(
      {
        success: true,
        totalGgsCodes: result.codes.length,
        ggsCodes: result.codes,
        ggsParcels: result.parcels,
        updatedAt: result.updatedAt,
        cached: result.cached,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      }
    );
  } catch (error: any) {
    console.error('Lỗi API sync-ggs:', error);
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
