import { DeclarationFormData } from '@/types';

export const DECLARED_CODES_KEY = 'diachinh_declared_codes';
export const DECLARATIONS_MAP_KEY = 'diachinh_declarations_map';

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
  const fullDeclData = {
    ...formData,
    created_at: previousDecl?.created_at || timestamp,
    updated_at: timestamp,
  };

  addedCodes.forEach((code) => {
    updatedMap[code] = fullDeclData;
  });

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(DECLARED_CODES_KEY, JSON.stringify(updatedCodes));
      localStorage.setItem(DECLARATIONS_MAP_KEY, JSON.stringify(updatedMap));
    } catch (e) {
      console.error('Lỗi lưu localStorage khi lưu phiếu:', e);
    }
  }

  return { addedCodes, removedCodes, updatedCodes, updatedMap };
}
