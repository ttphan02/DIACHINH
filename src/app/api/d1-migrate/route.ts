import { NextResponse } from 'next/server';
import { getD1Binding, initD1Schema, batchUpsertD1Declarations, getAllD1Declarations } from '@/utils/d1Database';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL || 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

export async function GET(req: Request) {
  try {
    const db = await getD1Binding();
    if (!db) {
      return NextResponse.json(
        { success: false, error: 'Chưa tìm thấy D1 Database binding "DB" trên Cloudflare Worker' },
        { status: 500 }
      );
    }

    // 1. Khởi tạo cấu trúc bảng SQL (Schema)
    await initD1Schema(db);

    // 2. Kiểm tra xem trong D1 đã có dữ liệu chưa
    const existing = await getAllD1Declarations(db);
    const url = new URL(req.url);
    const force = url.searchParams.get('force') === 'true';

    if (existing && existing.declaredCodes.length > 0 && !force) {
      return NextResponse.json({
        success: true,
        message: `D1 Database đã có sẵn ${existing.declaredCodes.length} hồ sơ kê khai`,
        totalInD1: existing.declaredCodes.length,
        alreadyMigrated: true,
      });
    }

    // 3. Đọc dữ liệu từ R2 declarations/all.json để nạp vào D1
    let declarationsMap: Record<string, any> = {};
    let cellEdits: Record<string, Record<number, string>> = {};

    try {
      const { env } = await getCloudflareContext({ async: true });
      const bucket = (env as any)?.DIACHINH_STORAGE;
      if (bucket) {
        const obj = await bucket.get('declarations/all.json');
        if (obj) {
          const text = await obj.text();
          const parsed = JSON.parse(text);
          declarationsMap = parsed.declarationsMap || {};
          cellEdits = parsed.cellEdits || {};
        }
      }
    } catch {}

    if (Object.keys(declarationsMap).length === 0) {
      const res = await fetch(`${R2_PUBLIC_URL}/declarations/all.json?t=${Date.now()}`);
      if (res.ok) {
        const parsed = (await res.json()) as any;
        declarationsMap = parsed.declarationsMap || {};
        cellEdits = parsed.cellEdits || {};
      }
    }

    const items = Object.values(declarationsMap).filter((d: any) => d && d.ma_thua);
    const migratedCount = await batchUpsertD1Declarations(db, items);

    // Nạp cell_edits nếu có
    for (const [maThua, cols] of Object.entries(cellEdits)) {
      for (const [cIdx, val] of Object.entries(cols)) {
        try {
          await db
            .prepare(
              'INSERT INTO cell_edits (ma_thua, col_idx, val, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(ma_thua, col_idx) DO UPDATE SET val = excluded.val'
            )
            .bind(maThua, Number(cIdx), String(val), new Date().toISOString())
            .run();
        } catch {}
      }
    }

    return NextResponse.json({
      success: true,
      message: `Đã di chuyển thành công ${migratedCount} hồ sơ kê khai từ R2 vào Cloudflare D1 SQL Database!`,
      totalMigrated: migratedCount,
    });
  } catch (error: any) {
    console.error('Lỗi khi migrate sang D1:', error);
    return NextResponse.json({ success: false, error: error.message || 'Lỗi migrate D1' }, { status: 500 });
  }
}
