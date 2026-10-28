import { getCloudflareContext } from '@opennextjs/cloudflare';

let cachedD1: any = null;

/**
 * Lấy D1 Database binding với cơ chế đa tầng (Multi-tier context)
 */
export async function getD1Binding(): Promise<any | null> {
  if (cachedD1) return cachedD1;

  // 1. globalThis.__CF_ENV__
  if ((globalThis as any).__CF_ENV__?.DB) {
    cachedD1 = (globalThis as any).__CF_ENV__.DB;
    return cachedD1;
  }

  // 2. OpenNext Symbol
  try {
    const ctx = (globalThis as any)[Symbol.for('__cloudflare-context__')];
    if (ctx?.env?.DB) {
      cachedD1 = ctx.env.DB;
      (globalThis as any).__CF_ENV__ = ctx.env;
      return cachedD1;
    }
  } catch {}

  // 3. getCloudflareContext async
  try {
    const { env } = await getCloudflareContext({ async: true });
    if ((env as any)?.DB) {
      cachedD1 = (env as any).DB;
      (globalThis as any).__CF_ENV__ = env;
      return cachedD1;
    }
  } catch {}

  // 4. getCloudflareContext sync
  try {
    const { env } = getCloudflareContext({ async: false });
    if ((env as any)?.DB) {
      cachedD1 = (env as any).DB;
      (globalThis as any).__CF_ENV__ = env;
      return cachedD1;
    }
  } catch {}

  return null;
}

/**
 * Khởi tạo bảng D1 SQL Database (Schema)
 */
export async function initD1Schema(db: any): Promise<void> {
  if (!db) return;

  const statements = [
    `CREATE TABLE IF NOT EXISTS declarations (
      ma_thua TEXT PRIMARY KEY,
      to_ban_do TEXT,
      so_thua TEXT,
      dien_tich TEXT,
      loai_dat TEXT,
      thon_xa TEXT,
      dia_chi_thua_dat TEXT,
      chu_dat_ten TEXT,
      chu_dat_nam_sinh TEXT,
      chu_dat_gioi_tinh TEXT,
      chu_dat_cccd TEXT,
      chu_dat_dia_chi TEXT,
      nguon_goc_su_dung TEXT,
      giap_dong TEXT,
      giap_tay TEXT,
      giap_nam TEXT,
      giap_bac TEXT,
      anh_cccd_truoc TEXT,
      anh_cccd_sau TEXT,
      anh_gcn TEXT,
      anh_gcn_list TEXT,
      ghi_chu TEXT,
      device_id TEXT,
      is_thua_kem_theo INTEGER DEFAULT 0,
      parent_ma_thua TEXT,
      thua_kem_theo_json TEXT,
      created_at TEXT,
      updated_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_decl_cccd ON declarations(chu_dat_cccd)`,
    `CREATE INDEX IF NOT EXISTS idx_decl_chu_dat ON declarations(chu_dat_ten)`,
    `CREATE INDEX IF NOT EXISTS idx_decl_parent ON declarations(parent_ma_thua)`,
    `CREATE INDEX IF NOT EXISTS idx_decl_to_thua ON declarations(to_ban_do, so_thua)`,
    `CREATE TABLE IF NOT EXISTS cell_edits (
      ma_thua TEXT,
      col_idx INTEGER,
      val TEXT,
      updated_at TEXT,
      PRIMARY KEY (ma_thua, col_idx)
    )`
  ];

  for (const sql of statements) {
    try {
      await db.prepare(sql).run();
    } catch (err) {
      console.error('Lỗi thực thi DDL D1:', sql, err);
      throw err;
    }
  }
}

/**
 * Lưu hoặc cập nhật một phiếu kê khai vào D1 SQL Database (UPSERT)
 */
export async function upsertD1Declaration(db: any, decl: any): Promise<boolean> {
  if (!db || !decl || !decl.ma_thua) return false;

  const sql = `
    INSERT INTO declarations (
      ma_thua, to_ban_do, so_thua, dien_tich, loai_dat, thon_xa, dia_chi_thua_dat,
      chu_dat_ten, chu_dat_nam_sinh, chu_dat_gioi_tinh, chu_dat_cccd, chu_dat_dia_chi,
      nguon_goc_su_dung, giap_dong, giap_tay, giap_nam, giap_bac,
      anh_cccd_truoc, anh_cccd_sau, anh_gcn, anh_gcn_list, ghi_chu, device_id,
      is_thua_kem_theo, parent_ma_thua, thua_kem_theo_json, created_at, updated_at
    ) VALUES (
      ?1, ?2, ?3, ?4, ?5, ?6, ?7,
      ?8, ?9, ?10, ?11, ?12,
      ?13, ?14, ?15, ?16, ?17,
      ?18, ?19, ?20, ?21, ?22, ?23,
      ?24, ?25, ?26, ?27, ?28
    )
    ON CONFLICT(ma_thua) DO UPDATE SET
      to_ban_do = excluded.to_ban_do,
      so_thua = excluded.so_thua,
      dien_tich = excluded.dien_tich,
      loai_dat = excluded.loai_dat,
      thon_xa = excluded.thon_xa,
      dia_chi_thua_dat = excluded.dia_chi_thua_dat,
      chu_dat_ten = excluded.chu_dat_ten,
      chu_dat_nam_sinh = excluded.chu_dat_nam_sinh,
      chu_dat_gioi_tinh = excluded.chu_dat_gioi_tinh,
      chu_dat_cccd = excluded.chu_dat_cccd,
      chu_dat_dia_chi = excluded.chu_dat_dia_chi,
      nguon_goc_su_dung = excluded.nguon_goc_su_dung,
      giap_dong = excluded.giap_dong,
      giap_tay = excluded.giap_tay,
      giap_nam = excluded.giap_nam,
      giap_bac = excluded.giap_bac,
      anh_cccd_truoc = excluded.anh_cccd_truoc,
      anh_cccd_sau = excluded.anh_cccd_sau,
      anh_gcn = excluded.anh_gcn,
      anh_gcn_list = excluded.anh_gcn_list,
      ghi_chu = excluded.ghi_chu,
      device_id = excluded.device_id,
      is_thua_kem_theo = excluded.is_thua_kem_theo,
      parent_ma_thua = excluded.parent_ma_thua,
      thua_kem_theo_json = excluded.thua_kem_theo_json,
      updated_at = excluded.updated_at;
  `;

  const tktJson = Array.isArray(decl.thua_kem_theo) && decl.thua_kem_theo.length > 0
    ? JSON.stringify(decl.thua_kem_theo)
    : null;

  const gcnListJson = Array.isArray(decl.anh_gcn_list) && decl.anh_gcn_list.length > 0
    ? JSON.stringify(decl.anh_gcn_list)
    : null;

  const timestamp = new Date().toISOString();

  await db.prepare(sql).bind(
    String(decl.ma_thua),
    String(decl.to_ban_do || ''),
    String(decl.so_thua || ''),
    String(decl.dien_tich || ''),
    String(decl.loai_dat || 'LUK'),
    String(decl.thon_xa || ''),
    String(decl.dia_chi_thua_dat || decl.thon_xa || ''),
    String(decl.chu_dat_ten || decl.chu_ho || decl.ho_va_ten_chu_ho || ''),
    String(decl.chu_dat_nam_sinh || decl.nam_sinh_chu_ho || ''),
    String(decl.chu_dat_gioi_tinh || decl.gioi_tinh_chu_ho || 'Nam'),
    String(decl.chu_dat_cccd || decl.cccd || decl.cccd_chu_ho || ''),
    String(decl.chu_dat_dia_chi || decl.dia_chi_thua_dat || decl.thon_xa || ''),
    String(decl.nguon_goc_su_dung || decl.nguon_goc || 'Khai hoang'),
    String(decl.giap_dong || ''),
    String(decl.giap_tay || ''),
    String(decl.giap_nam || ''),
    String(decl.giap_bac || ''),
    String(decl.anh_cccd_truoc || ''),
    String(decl.anh_cccd_sau || ''),
    String(decl.anh_gcn || ''),
    gcnListJson,
    String(decl.ghi_chu || ''),
    String(decl.device_id || 'MAY_DEF'),
    decl.is_thua_kem_theo ? 1 : 0,
    String(decl.parent_ma_thua || ''),
    tktJson,
    String(decl.created_at || timestamp),
    String(decl.updated_at || timestamp)
  ).run();

  return true;
}

/**
 * Lưu hoặc cập nhật hàng loạt phiếu kê khai theo batch (Tối ưu cho migrate hoặc đồng bộ lớn)
 */
export async function batchUpsertD1Declarations(db: any, decls: any[]): Promise<number> {
  if (!db || !decls || decls.length === 0) return 0;

  const sql = `
    INSERT INTO declarations (
      ma_thua, to_ban_do, so_thua, dien_tich, loai_dat, thon_xa, dia_chi_thua_dat,
      chu_dat_ten, chu_dat_nam_sinh, chu_dat_gioi_tinh, chu_dat_cccd, chu_dat_dia_chi,
      nguon_goc_su_dung, giap_dong, giap_tay, giap_nam, giap_bac,
      anh_cccd_truoc, anh_cccd_sau, anh_gcn, anh_gcn_list, ghi_chu, device_id,
      is_thua_kem_theo, parent_ma_thua, thua_kem_theo_json, created_at, updated_at
    ) VALUES (
      ?1, ?2, ?3, ?4, ?5, ?6, ?7,
      ?8, ?9, ?10, ?11, ?12,
      ?13, ?14, ?15, ?16, ?17,
      ?18, ?19, ?20, ?21, ?22, ?23,
      ?24, ?25, ?26, ?27, ?28
    )
    ON CONFLICT(ma_thua) DO UPDATE SET
      to_ban_do = excluded.to_ban_do,
      so_thua = excluded.so_thua,
      dien_tich = excluded.dien_tich,
      loai_dat = excluded.loai_dat,
      thon_xa = excluded.thon_xa,
      dia_chi_thua_dat = excluded.dia_chi_thua_dat,
      chu_dat_ten = excluded.chu_dat_ten,
      chu_dat_nam_sinh = excluded.chu_dat_nam_sinh,
      chu_dat_gioi_tinh = excluded.chu_dat_gioi_tinh,
      chu_dat_cccd = excluded.chu_dat_cccd,
      chu_dat_dia_chi = excluded.chu_dat_dia_chi,
      nguon_goc_su_dung = excluded.nguon_goc_su_dung,
      giap_dong = excluded.giap_dong,
      giap_tay = excluded.giap_tay,
      giap_nam = excluded.giap_nam,
      giap_bac = excluded.giap_bac,
      anh_cccd_truoc = excluded.anh_cccd_truoc,
      anh_cccd_sau = excluded.anh_cccd_sau,
      anh_gcn = excluded.anh_gcn,
      anh_gcn_list = excluded.anh_gcn_list,
      ghi_chu = excluded.ghi_chu,
      device_id = excluded.device_id,
      is_thua_kem_theo = excluded.is_thua_kem_theo,
      parent_ma_thua = excluded.parent_ma_thua,
      thua_kem_theo_json = excluded.thua_kem_theo_json,
      updated_at = excluded.updated_at;
  `;

  const CHUNK_SIZE = 50;
  let totalSaved = 0;

  for (let i = 0; i < decls.length; i += CHUNK_SIZE) {
    const chunk = decls.slice(i, i + CHUNK_SIZE);
    const statements = chunk.map((decl) => {
      const tktJson = Array.isArray(decl.thua_kem_theo) && decl.thua_kem_theo.length > 0
        ? JSON.stringify(decl.thua_kem_theo)
        : null;

      const gcnListJson = Array.isArray(decl.anh_gcn_list) && decl.anh_gcn_list.length > 0
        ? JSON.stringify(decl.anh_gcn_list)
        : null;

      const timestamp = new Date().toISOString();

      return db.prepare(sql).bind(
        String(decl.ma_thua),
        String(decl.to_ban_do || ''),
        String(decl.so_thua || ''),
        String(decl.dien_tich || ''),
        String(decl.loai_dat || 'LUK'),
        String(decl.thon_xa || ''),
        String(decl.dia_chi_thua_dat || decl.thon_xa || ''),
        String(decl.chu_dat_ten || decl.chu_ho || decl.ho_va_ten_chu_ho || ''),
        String(decl.chu_dat_nam_sinh || decl.nam_sinh_chu_ho || ''),
        String(decl.chu_dat_gioi_tinh || decl.gioi_tinh_chu_ho || 'Nam'),
        String(decl.chu_dat_cccd || decl.cccd || decl.cccd_chu_ho || ''),
        String(decl.chu_dat_dia_chi || decl.dia_chi_thua_dat || decl.thon_xa || ''),
        String(decl.nguon_goc_su_dung || decl.nguon_goc || 'Khai hoang'),
        String(decl.giap_dong || ''),
        String(decl.giap_tay || ''),
        String(decl.giap_nam || ''),
        String(decl.giap_bac || ''),
        String(decl.anh_cccd_truoc || ''),
        String(decl.anh_cccd_sau || ''),
        String(decl.anh_gcn || ''),
        gcnListJson,
        String(decl.ghi_chu || ''),
        String(decl.device_id || 'MAY_DEF'),
        decl.is_thua_kem_theo ? 1 : 0,
        String(decl.parent_ma_thua || ''),
        tktJson,
        String(decl.created_at || timestamp),
        String(decl.updated_at || timestamp)
      );
    });

    await db.batch(statements);
    totalSaved += chunk.length;
  }

  return totalSaved;
}

/**
 * Xóa phiếu kê khai trong D1 SQL Database (gồm cả các thửa kèm theo của phiếu đó)
 */
export async function deleteD1Declaration(db: any, maThua: string): Promise<boolean> {
  if (!db || !maThua) return false;
  await db.prepare('DELETE FROM declarations WHERE ma_thua = ?1 OR parent_ma_thua = ?1').bind(maThua).run();
  return true;
}

/**
 * Đọc toàn bộ danh sách phiếu kê khai từ D1 SQL Database (tốc độ ~5ms)
 */
export async function getAllD1Declarations(db: any): Promise<{
  declaredCodes: string[];
  declarationsMap: Record<string, any>;
  cellEdits: Record<string, Record<number, string>>;
  updatedAt: string;
} | null> {
  if (!db) return null;

  try {
    const { results } = await db.prepare('SELECT * FROM declarations').all();
    if (!results || results.length === 0) return null;

    const declaredCodes: string[] = [];
    const declarationsMap: Record<string, any> = {};

    results.forEach((row: any) => {
      const code = row.ma_thua;
      declaredCodes.push(code);

      let thuaKemTheo: any[] = [];
      if (row.thua_kem_theo_json) {
        try {
          thuaKemTheo = JSON.parse(row.thua_kem_theo_json);
        } catch {}
      }

      let anhGcnList: string[] = [];
      if (row.anh_gcn_list) {
        try {
          anhGcnList = JSON.parse(row.anh_gcn_list);
        } catch {}
      }

      declarationsMap[code] = {
        ma_thua: code,
        to_ban_do: row.to_ban_do,
        so_thua: row.so_thua,
        dien_tich: row.dien_tich,
        loai_dat: row.loai_dat,
        thon_xa: row.thon_xa,
        dia_chi_thua_dat: row.dia_chi_thua_dat,
        chu_dat_ten: row.chu_dat_ten,
        chu_ho: row.chu_dat_ten,
        ho_va_ten_chu_ho: row.chu_dat_ten,
        chu_dat_nam_sinh: row.chu_dat_nam_sinh,
        nam_sinh_chu_ho: row.chu_dat_nam_sinh,
        chu_dat_gioi_tinh: row.chu_dat_gioi_tinh,
        gioi_tinh_chu_ho: row.chu_dat_gioi_tinh,
        chu_dat_cccd: row.chu_dat_cccd,
        cccd: row.chu_dat_cccd,
        cccd_chu_ho: row.chu_dat_cccd,
        chu_dat_dia_chi: row.chu_dat_dia_chi,
        nguon_goc_su_dung: row.nguon_goc_su_dung,
        nguon_goc: row.nguon_goc_su_dung,
        giap_dong: row.giap_dong,
        giap_tay: row.giap_tay,
        giap_nam: row.giap_nam,
        giap_bac: row.giap_bac,
        anh_cccd_truoc: row.anh_cccd_truoc,
        anh_cccd_sau: row.anh_cccd_sau,
        anh_gcn: row.anh_gcn,
        anh_gcn_list: anhGcnList,
        ghi_chu: row.ghi_chu,
        device_id: row.device_id,
        is_thua_kem_theo: Boolean(row.is_thua_kem_theo),
        parent_ma_thua: row.parent_ma_thua || undefined,
        thua_kem_theo: thuaKemTheo.length > 0 ? thuaKemTheo : undefined,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    // Lấy cell_edits nếu có
    const cellEdits: Record<string, Record<number, string>> = {};
    try {
      const { results: editRows } = await db.prepare('SELECT ma_thua, col_idx, val FROM cell_edits').all();
      if (Array.isArray(editRows)) {
        editRows.forEach((r: any) => {
          if (!cellEdits[r.ma_thua]) cellEdits[r.ma_thua] = {};
          cellEdits[r.ma_thua][r.col_idx] = r.val;
        });
      }
    } catch {}

    return {
      declaredCodes,
      declarationsMap,
      cellEdits,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('Lỗi đọc toàn bộ declarations từ D1:', err);
    return null;
  }
}
