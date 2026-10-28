import { DeclarationFormData } from '@/types';
import parcelsBriefData from '@/data/parcels_brief.json';

const parcelsBrief = parcelsBriefData as unknown as Record<string, [string, string, string, number]>;

export const DECLARED_CODES_KEY = 'diachinh_declared_codes';
export const DECLARATIONS_MAP_KEY = 'diachinh_declarations_map';
export const DEVICE_ID_KEY = 'diachinh_device_id';
export const CADRE_NAME_KEY = 'diachinh_cadre_name';
export const PENDING_DECLARATIONS_KEY = 'diachinh_pending_declarations';

/**
 * Lấy danh sách phiếu kê khai đang chờ đẩy lên Cloud (chưa được Cloud xác nhận)
 */
export function getPendingDeclarations(): Record<string, DeclarationFormData> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PENDING_DECLARATIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Thêm hoặc cập nhật phiếu kê khai vào hàng đợi đồng bộ Cloud
 */
export function savePendingDeclaration(formData: DeclarationFormData): void {
  if (typeof window === 'undefined' || !formData?.ma_thua) return;
  try {
    const pending = getPendingDeclarations();
    pending[formData.ma_thua] = formData;
    localStorage.setItem(PENDING_DECLARATIONS_KEY, JSON.stringify(pending));
  } catch {}
}

/**
 * Xóa một hoặc nhiều phiếu khỏi hàng đợi đồng bộ Cloud khi đã đồng bộ thành công
 */
export function removePendingDeclaration(maThua: string): void {
  if (typeof window === 'undefined' || !maThua) return;
  try {
    const pending = getPendingDeclarations();
    if (pending[maThua]) {
      delete pending[maThua];
      localStorage.setItem(PENDING_DECLARATIONS_KEY, JSON.stringify(pending));
    }
  } catch {}
}

export function clearPendingDeclarations(maThuaList?: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (!maThuaList) {
      localStorage.removeItem(PENDING_DECLARATIONS_KEY);
      return;
    }
    const pending = getPendingDeclarations();
    maThuaList.forEach((code) => delete pending[code]);
    localStorage.setItem(PENDING_DECLARATIONS_KEY, JSON.stringify(pending));
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
 * Lấy tên cán bộ đã lưu từ localStorage hoặc cookie (nếu chưa có thì trả về rỗng)
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
 * Lưu tên cán bộ vào localStorage và cookie vĩnh viễn
 */
export function saveCadreName(name: string): string {
  const formatted = formatCadreName(name);
  if (typeof window !== 'undefined' && formatted) {
    try {
      localStorage.setItem(CADRE_NAME_KEY, formatted);
      localStorage.setItem(DEVICE_ID_KEY, formatted);
      // Ghi cookie 1 năm để trình duyệt giữ vĩnh viễn
      document.cookie = `${CADRE_NAME_KEY}=${formatted}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {}
  }
  return formatted;
}

/**
 * Lấy hoặc khởi tạo mã định danh duy nhất: ưu tiên Tên Cán Bộ nếu đã lưu
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
 * Cho phép cán bộ đổi tên thiết bị / tên cán bộ theo ý muốn (vd: PHANTHANHTRUC)
 */
export function setCustomDeviceId(newId: string): void {
  saveCadreName(newId);
}

/**
 * Đọc an toàn danh sách mã thửa đã kê khai và bản đồ phiếu kê khai từ localStorage
 */
export function getStoredDeclarations(): {
  declaredCodes: Set<string>;
  declarationsMap: Record<string, any>;
} {
  if (typeof window === 'undefined') {
    return { declaredCodes: new Set(), declarationsMap: {} };
  }

  try {
    const rawCodes = localStorage.getItem(DECLARED_CODES_KEY);
    const declaredCodes = new Set<string>(rawCodes ? JSON.parse(rawCodes) : []);

    const rawMap = localStorage.getItem(DECLARATIONS_MAP_KEY);
    const declarationsMap = rawMap ? JSON.parse(rawMap) : {};

    return { declaredCodes, declarationsMap };
  } catch (e) {
    console.error('Lỗi khi đọc dữ liệu kê khai từ localStorage:', e);
    return { declaredCodes: new Set(), declarationsMap: {} };
  }
}

/**
 * Xóa một phiếu kê khai (bao gồm thửa chính và toàn bộ các thửa kèm theo)
 * Trả về danh sách các mã thửa bị ảnh hưởng để cập nhật giao diện
 */
export function removeDeclaration(targetMaThua: string): {
  removedCodes: string[];
  updatedCodes: string[];
  updatedMap: Record<string, any>;
} {
  const { declaredCodes, declarationsMap } = getStoredDeclarations();
  const decl = declarationsMap[targetMaThua];

  const codesToRemove = new Set<string>();
  codesToRemove.add(targetMaThua);

  if (decl?.ma_thua) {
    codesToRemove.add(decl.ma_thua);
  }

  // Thêm tất cả thửa kèm theo trong phiếu
  if (Array.isArray(decl?.thua_kem_theo)) {
    decl.thua_kem_theo.forEach((ap: any) => {
      if (ap?.ma_thua) codesToRemove.add(ap.ma_thua);
    });
  }

  // Quét toàn bộ map để tìm các thửa cùng thuộc phiếu này
  const rootMaThua = decl?.ma_thua || targetMaThua;
  Object.entries(declarationsMap).forEach(([code, d]: [string, any]) => {
    if (d?.ma_thua === rootMaThua || code === rootMaThua) {
      codesToRemove.add(code);
      if (Array.isArray(d?.thua_kem_theo)) {
        d.thua_kem_theo.forEach((ap: any) => {
          if (ap?.ma_thua) codesToRemove.add(ap.ma_thua);
        });
      }
    }
  });

  const removedCodes = Array.from(codesToRemove);

  // Xóa khỏi declaredCodes
  removedCodes.forEach((c) => declaredCodes.delete(c));
  const updatedCodes = Array.from(declaredCodes);

  // Xóa khỏi declarationsMap
  const updatedMap = { ...declarationsMap };
  removedCodes.forEach((c) => delete updatedMap[c]);

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(DECLARED_CODES_KEY, JSON.stringify(updatedCodes));
      localStorage.setItem(DECLARATIONS_MAP_KEY, JSON.stringify(updatedMap));
      removedCodes.forEach((c) => removePendingDeclaration(c));
    } catch (e) {
      console.error('Lỗi lưu localStorage khi xóa phiếu:', e);
    }
  }

  return { removedCodes, updatedCodes, updatedMap };
}

/**
 * Lưu hoặc cập nhật phiếu kê khai
 * Xử lý tự động trường hợp người dùng bớt/gỡ thửa kèm theo khỏi phiếu
 */
export function saveOrUpdateDeclaration(formData: DeclarationFormData): {
  addedCodes: string[];
  removedCodes: string[];
  updatedCodes: string[];
  updatedMap: Record<string, any>;
} {
  const { declaredCodes, declarationsMap } = getStoredDeclarations();
  const rootMaThua = formData.ma_thua;
  const previousDecl = declarationsMap[rootMaThua];

  // Tập hợp các mã thửa cũ trong phiếu này
  const previousCodes = new Set<string>();
  if (previousDecl) {
    previousCodes.add(rootMaThua);
    if (Array.isArray(previousDecl.thua_kem_theo)) {
      previousDecl.thua_kem_theo.forEach((ap: any) => {
        if (ap?.ma_thua) previousCodes.add(ap.ma_thua);
      });
    }
  }

  // Tập hợp các mã thửa mới trong phiếu này
  const newCodes = new Set<string>();
  newCodes.add(rootMaThua);
  if (Array.isArray(formData.thua_kem_theo)) {
    formData.thua_kem_theo.forEach((ap: any) => {
      if (ap?.ma_thua) newCodes.add(ap.ma_thua);
    });
  }

  // Thửa nào trước đây có nhưng bây giờ bị xóa khỏi phiếu -> cần hoàn trả trạng thái ban đầu
  const removedCodes = Array.from(previousCodes).filter((c) => !newCodes.has(c));
  const addedCodes = Array.from(newCodes);

  // Cập nhật declaredCodes
  removedCodes.forEach((c) => declaredCodes.delete(c));
  addedCodes.forEach((c) => declaredCodes.add(c));
  const updatedCodes = Array.from(declaredCodes);

  // Cập nhật declarationsMap
  const updatedMap = { ...declarationsMap };
  removedCodes.forEach((c) => delete updatedMap[c]);

  const timestamp = new Date().toISOString();
  const currentDeviceId = getOrCreateDeviceId();
  const deviceId = formData.device_id || previousDecl?.device_id || currentDeviceId;
  const rootParts = rootMaThua.split('_');
  const rootBrief = parcelsBrief[rootMaThua];
  const rootDienTich = (rootBrief && rootBrief[0]) || formData.dien_tich || '1000';
  const rootLoaiDat = formData.loai_dat || (rootBrief && rootBrief[1]) || 'LUK';
  const rootThonXa = formData.thon_xa || formData.dia_chi_thua_dat || (rootBrief && rootBrief[2]) || 'xã Cư Pui';

  const rootDeclData = {
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

  // Xử lý thửa kèm theo nếu có
  if (Array.isArray(formData.thua_kem_theo)) {
    formData.thua_kem_theo.forEach((ap) => {
      if (!ap?.ma_thua) return;
      const apCode = ap.ma_thua;
      const apParts = apCode.split('_');
      const apBrief = parcelsBrief[apCode];
      const apDienTich = (apBrief && apBrief[0]) || ap.dien_tich || '1000';
      const apLoaiDat = ap.loai_dat || (apBrief && apBrief[1]) || rootLoaiDat;
      const apThonXa = ap.thon_xa || (apBrief && apBrief[2]) || rootThonXa;
      const apNguonGoc = ap.nguon_goc || formData.nguon_goc_su_dung || 'Khai hoang';

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

  // Tự động gán device_id cho các thửa cũ đã kê khai trên máy này nếu chưa có
  Object.keys(updatedMap).forEach((code) => {
    if (updatedMap[code] && !updatedMap[code].device_id) {
      updatedMap[code].device_id = currentDeviceId;
    }
  });

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(DECLARED_CODES_KEY, JSON.stringify(updatedCodes));
      localStorage.setItem(DECLARATIONS_MAP_KEY, JSON.stringify(updatedMap));
      savePendingDeclaration(rootDeclData);
    } catch (e) {
      console.error('Lỗi lưu localStorage khi lưu phiếu:', e);
    }
  }

  return { addedCodes, removedCodes, updatedCodes, updatedMap };
}
