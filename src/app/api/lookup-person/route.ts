import { NextResponse } from 'next/server';
import { cleanStrictName } from '@/utils/textHelpers';
import { getD1Binding } from '@/utils/d1Database';

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
    const db = await getD1Binding();
    if (db) {
      // 1. Tìm chính xác hoặc tương đối theo tên trong database D1 đã có CCCD (< 1ms CPU)
      const row = await db.prepare(
        `SELECT chu_dat_ten, chu_dat_nam_sinh, chu_dat_gioi_tinh, chu_dat_cccd, chu_dat_dia_chi, ma_thua 
         FROM declarations 
         WHERE (chu_dat_ten = ?1 OR chu_dat_ten LIKE ?2) AND chu_dat_cccd != '' AND chu_dat_cccd IS NOT NULL
         ORDER BY (chu_dat_ten = ?1) DESC, LENGTH(chu_dat_cccd) DESC, updated_at DESC 
         LIMIT 1`
      ).bind(name.trim(), `%${name.trim()}%`).first();

      if (row && row.chu_dat_cccd) {
        return NextResponse.json({
          found: true,
          full_name: row.chu_dat_ten,
          nam_sinh: row.chu_dat_nam_sinh || '',
          gioi_tinh: row.chu_dat_gioi_tinh || 'Nam',
          cccd: row.chu_dat_cccd || '',
          dia_chi: row.chu_dat_dia_chi || '',
          ma_thua: row.ma_thua || '',
        });
      }
    }

    return NextResponse.json({ found: false });
  } catch (err: any) {
    console.error('Lỗi khi tra cứu công dân:', err);
    return NextResponse.json({ found: false });
  }
}
