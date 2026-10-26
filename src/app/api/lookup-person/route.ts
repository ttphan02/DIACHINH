import { NextResponse } from 'next/server';
import { fetchOrGetCachedGgsData } from '@/utils/ggsData';
import { cleanStrictName } from '@/utils/textHelpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || '';

  if (!name.trim()) {
    return NextResponse.json({ found: false });
  }

  const cleanQuery = cleanStrictName(name);
  if (!cleanQuery || cleanQuery.length < 2) {
    return NextResponse.json({ found: false });
  }

  // Loại trừ các tên danh xưng chung
  if (['nam', 'nữ', 'nu', 'cá nhân', 'chung', 'hộ gia đình', 'chưa có tên', 'không có tên'].includes(cleanQuery)) {
    return NextResponse.json({ found: false });
  }

  try {
    const data = await fetchOrGetCachedGgsData(false);
    const people = data.people || {};
    const person = people[cleanQuery];

    if (person) {
      return NextResponse.json({
        found: true,
        full_name: person.full_name,
        nam_sinh: person.nam_sinh || '',
        gioi_tinh: person.gioi_tinh || 'Nam',
        cccd: person.cccd || '',
        dia_chi: person.dia_chi || '',
        ma_thua: person.ma_thua || '',
      });
    }

    return NextResponse.json({ found: false });
  } catch (err: any) {
    console.error('Lỗi khi tra cứu công dân trên GGS:', err);
    return NextResponse.json({ found: false, error: err.message }, { status: 500 });
  }
}
