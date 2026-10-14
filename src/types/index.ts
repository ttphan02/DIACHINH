export type ParcelStatus =
  | 'DA_SO_HOA_XANH' // Xanh lá: Đã số hóa (Có trên Google Sheets)
  | 'DA_KE_KHAI_CHUA_SO_HOA_LAM' // Xanh lam: Đã kê khai nhưng chưa số hóa (Chưa có trên Google Sheets)
  | 'CO_TEN_CHUA_SO_HOA_VANG' // Vàng: Có tên chủ đất nhưng chưa kê khai
  | 'CHUA_CO_TEN_XAM'; // Trắng: Chưa có tên chủ đất

export interface Parcel {
  ma_thua: string;
  to_ban_do: string;
  so_thua: string;
  thon_xa: string;
  ten_xa_goc: string;
  chu_ho: string;
  cccd?: string;
  sdt?: string;
  loai_dat: string;
  dien_tich: string;
  trang_thai: ParcelStatus;
  lat: number | null;
  lng: number | null;
  gmap_link: string;
  giap_dong?: string;
  giap_tay?: string;
  giap_nam?: string;
  giap_bac?: string;
  has_cccd?: boolean;
  cccd_url?: string | null;
  svg_url?: string | null;
  has_gcn?: boolean;
  gcn_urls?: string[];
  is_on_ggs?: boolean;
  is_declared?: boolean;
}

export type CompassQuadrant = 'dong' | 'tay' | 'nam' | 'bac';

export interface NeighborParcel extends Parcel {
  distanceMeters: number;
  bearing?: number;
  directionText?: string;
  arrow?: string;
  quadrant?: CompassQuadrant;
  quadrantText?: string;
}

export interface AutoBoundariesResult {
  dong?: NeighborParcel;
  tay?: NeighborParcel;
  nam?: NeighborParcel;
  bac?: NeighborParcel;
}

export type DeclarationMode = 'SELF' | 'SURVEYOR';

export type NguonGocSuDung = 'Khai hoang' | 'Nhận Thừa Kế' | 'Nhận Tặng Cho';

export interface AdditionalParcel {
  ma_thua: string;
  to_ban_do: string;
  so_thua: string;
  dien_tich: string;
  loai_dat: string;
  thon_xa?: string;
  nguon_goc?: string;
}

export interface DeclarationFormData {
  ma_thua: string;
  to_ban_do?: string;
  so_thua?: string;
  dien_tich?: string;
  loai_dat?: string;
  nguon_goc?: string;
  dia_chi_thua_dat?: string;
  // 1.1 Cá nhân
  chu_dat_ten: string; // Họ tên cá nhân *
  chu_dat_nam_sinh?: string; // Năm sinh *
  chu_dat_gioi_tinh?: 'Nam' | 'Nữ' | string; // Giới tính (Nam/Nữ) *
  chu_dat_cccd: string; // Số CCCD *
  chu_dat_dia_chi?: string; // Địa chỉ thường trú *
  chu_dat_ngay_sinh?: string; // Tương thích ngược
  nam_sinh_chu_ho?: string; // Tương thích ngược
  gioi_tinh_chu_ho?: string; // Tương thích ngược
  nguon_goc_su_dung?: NguonGocSuDung | string; // Option: Khai hoang | Nhận Thừa Kế | Nhận Tặng Cho *
  // Tứ cận
  giap_dong?: string;
  giap_tay?: string;
  giap_nam?: string;
  giap_bac?: string;
  // Hồ sơ đính kèm (Tùy chọn)
  anh_cccd_truoc?: string;
  anh_cccd_sau?: string;
  anh_gcn?: string;
  anh_gcn_list?: string[];
  ghi_chu?: string;
  // Các trường phụ trợ
  mode?: DeclarationMode;
  nguoi_ke_khai_ten?: string;
  nguoi_ke_khai_sdt?: string;
  is_correction?: boolean;
  ly_do_sai?: string;
  thua_kem_theo?: AdditionalParcel[];
  device_id?: string; // Mã định danh thiết bị đã kê khai thửa đất này
}

