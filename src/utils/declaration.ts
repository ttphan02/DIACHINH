import { DeclarationFormData } from '@/types';
import parcelsBriefData from '@/data/parcels_brief.json';

const parcelsBrief = parcelsBriefData as unknown as Record<string, [string, string, string, number]>;

export const DEVICE_ID_KEY = 'diachinh_device_id';
export const CADRE_NAME_KEY = 'diachinh_cadre_name';

const LEGACY_DATA_KEYS = [
  'diachinh_declared_codes',
  'diachinh_declarations_map',
  'diachinh_pending_declarations',
  'diachinh_table_cell_edits',
  'diachinh_corrections',
];

/**
 * Dọn sạch các key dữ liệu kê khai / chỉnh sửa cũ từng lưu trong localStorage
 * để đảm bảo trình duyệt không còn giữ bản cache cũ gây xung đột với Database.
 */
export function clearLegacyLocalDataStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    LEGACY_DATA_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

/**
 * Định dạng tên cán bộ: IN HOA, LIỀN NHAU, KHÔNG DẤU
 * Ví dụ: "Phan Thanh Trúc" -> "PHANTHANHTRUC"
 */
export function formatCadreName(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'D')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Lấy tên cán bộ đã lưu (chỉ là thông tin định danh người thao tác, không phải dữ liệu đất)
 */
export function getSavedCadreName(): string {
  if (typeof window === 'undefined') return '';
  try {
    const name = localStorage.getItem(CADRE_NAME_KEY) || '';
    return formatCadreName(name);
  } catch {
    return '';
  }
}

/**
 * Lưu tên cán bộ vào cài đặt trình duyệt và cookie
 */
export function saveCadreName(name: string): string {
  const formatted = formatCadreName(name);
  if (typeof window !== 'undefined' && formatted) {
    try {
      localStorage.setItem(CADRE_NAME_KEY, formatted);
      localStorage.setItem(DEVICE_ID_KEY, formatted);
      document.cookie = `${CADRE_NAME_KEY}=${formatted}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {}
  }
  return formatted;
}

/**
 * Lấy hoặc khởi tạo mã định danh cán bộ / thiết bị
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'SERVER';
  try {
    const cadre = getSavedCadreName();
    if (cadre) return cadre;

    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id || !id.trim() || id === 'MAY_DEF') {
      const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
      id = `MAY_${rand}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id.trim();
  } catch {
    return 'MAY_DEF';
  }
}

/**
 * Đổi tên thiết bị / tên cán bộ
 */
export function setCustomDeviceId(newId: string): void {
  saveCadreName(newId);
}

/**
 * Tính toán danh sách mã & map trong bộ nhớ RAM sau khi xóa một phiếu trên Database
 * (KHÔNG đọc hay ghi localStorage)
 */
export function removeDeclarationFromState(
  currentCodes: Set<string>,
  currentMap: Record<string, any>,
  targetMaThua: string
): {
  removedCodes: string[];
  updatedCodes: string[];
  updatedMap: Record<string, any>;
} {
  const decl = currentMap[targetMaThua];
  const codesToRemove = new Set<string>();
  codesToRemove.add(targetMaThua);

  if (decl?.ma_thua) {
    codesToRemove.add(decl.ma_thua);
  }

  if (Array.isArray(decl?.thua_kem_theo)) {
    decl.thua_kem_theo.forEach((ap: any) => {
      if (ap?.ma_thua) codesToRemove.add(ap.ma_thua);
    });
  }

  const rootMaThua = decl?.ma_thua || targetMaThua;
  Object.entries(currentMap).forEach(([code, d]: [string, any]) => {
    if (d?.ma_thua === rootMaThua || code === rootMaThua || d?.parent_ma_thua === rootMaThua) {
      codesToRemove.add(code);
      if (Array.isArray(d?.thua_kem_theo)) {
        d.thua_kem_theo.forEach((ap: any) => {
          if (ap?.ma_thua) codesToRemove.add(ap.ma_thua);
        });
      }
    }
  });

  const removedCodes = Array.from(codesToRemove);
  const nextCodesSet = new Set(currentCodes);
  removedCodes.forEach((c) => nextCodesSet.delete(c));
  const updatedCodes = Array.from(nextCodesSet);

  const updatedMap = { ...currentMap };
  removedCodes.forEach((c) => delete updatedMap[c]);

  return { removedCodes, updatedCodes, updatedMap };
}

/**
 * Chuẩn hóa dữ liệu phiếu kê khai & cập nhật state trong bộ nhớ RAM sau khi lưu lên Database
 * (KHÔNG đọc hay ghi localStorage)
 */
export function applyDeclarationToState(
  currentCodes: Set<string>,
  currentMap: Record<string, any>,
  formData: DeclarationFormData
): {
  rootDeclData: DeclarationFormData;
  addedCodes: string[];
  removedCodes: string[];
  updatedCodes: string[];
  updatedMap: Record<string, any>;
} {
  const rootMaThua = formData.ma_thua;
  const previousDecl = currentMap[rootMaThua];

  const previousCodes = new Set<string>();
  if (previousDecl) {
    previousCodes.add(rootMaThua);
    if (Array.isArray(previousDecl.thua_kem_theo)) {
      previousDecl.thua_kem_theo.forEach((ap: any) => {
        if (ap?.ma_thua) previousCodes.add(ap.ma_thua);
      });
    }
  }

  const newCodes = new Set<string>();
  newCodes.add(rootMaThua);
  if (Array.isArray(formData.thua_kem_theo)) {
    formData.thua_kem_theo.forEach((ap: any) => {
      if (ap?.ma_thua) newCodes.add(ap.ma_thua);
    });
  }

  const removedCodes = Array.from(previousCodes).filter((c) => !newCodes.has(c));
  const addedCodes = Array.from(newCodes);

  const nextCodesSet = new Set(currentCodes);
  removedCodes.forEach((c) => nextCodesSet.delete(c));
  addedCodes.forEach((c) => nextCodesSet.add(c));
  const updatedCodes = Array.from(nextCodesSet);

  const updatedMap = { ...currentMap };
  removedCodes.forEach((c) => delete updatedMap[c]);

  const timestamp = new Date().toISOString();
  const currentDeviceId = getOrCreateDeviceId();
  const deviceId = formData.device_id || previousDecl?.device_id || currentDeviceId;
  const rootParts = rootMaThua.split('_');
  const rootBrief = parcelsBrief[rootMaThua];
  const rootDienTich = (rootBrief && rootBrief[0]) || formData.dien_tich || '1000';
  const rootLoaiDat = formData.loai_dat || (rootBrief && rootBrief[1]) || 'LUK';
  const rootThonXa = formData.thon_xa || formData.dia_chi_thua_dat || (rootBrief && rootBrief[2]) || 'xã Cư Pui';

  const rootDeclData: DeclarationFormData = {
    ...formData,
    ma_thua: rootMaThua,
    to_ban_do: rootParts[0] || formData.to_ban_do || '',
    so_thua: rootParts[1] || formData.so_thua || '',
    dien_tich: String(rootDienTich),
    loai_dat: rootLoaiDat,
    thon_xa: rootThonXa,
    dia_chi_thua_dat: rootThonXa,
    chu_dat_dia_chi: formData.chu_dat_dia_chi || rootThonXa,
    device_id: deviceId,
    created_at: previousDecl?.created_at || timestamp,
    updated_at: timestamp,
  };

  updatedMap[rootMaThua] = rootDeclData;

  if (Array.isArray(formData.thua_kem_theo)) {
    formData.thua_kem_theo.forEach((ap) => {
      if (!ap?.ma_thua) return;
      const apCode = ap.ma_thua;
      const apParts = apCode.split('_');
      const apBrief = parcelsBrief[apCode];
      const apDienTich = (apBrief && apBrief[0]) || ap.dien_tich || '1000';
      const apLoaiDat = ap.loai_dat || (apBrief && apBrief[1]) || rootLoaiDat;
      const apThonXa = ap.thon_xa || (apBrief && apBrief[2]) || rootThonXa;
      const defaultApOrigin = 'Khai hoang';
      const apNguonGoc = ap.nguon_goc || formData.nguon_goc_su_dung || defaultApOrigin;

      updatedMap[apCode] = {
        ...rootDeclData,
        ma_thua: apCode,
        to_ban_do: ap.to_ban_do || apParts[0] || '',
        so_thua: ap.so_thua || apParts[1] || '',
        dien_tich: String(apDienTich),
        loai_dat: apLoaiDat,
        thon_xa: apThonXa,
        dia_chi_thua_dat: apThonXa,
        nguon_goc: apNguonGoc,
        nguon_goc_su_dung: apNguonGoc,
        is_thua_kem_theo: true,
        parent_ma_thua: rootMaThua,
        thua_kem_theo: undefined,
      };
    });
  }

  return { rootDeclData, addedCodes, removedCodes, updatedCodes, updatedMap };
}
