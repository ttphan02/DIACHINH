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
  svg_url?: string | null;
  is_on_ggs?: boolean;
  is_declared?: boolean;
}

export interface NeighborParcel extends Parcel {
  distanceMeters: number;
}

export type DeclarationMode = 'SELF' | 'SURVEYOR';

export interface DeclarationFormData {
  ma_thua: string;
  mode: DeclarationMode;
  nguoi_ke_khai_ten: string;
  nguoi_ke_khai_sdt: string;
  chu_dat_ten: string;
  chu_dat_cccd: string;
  chu_dat_ngay_sinh?: string;
  chu_dat_dia_chi?: string;
  giap_dong: string;
  giap_tay: string;
  giap_nam: string;
  giap_bac: string;
  anh_cccd_truoc?: string;
  anh_cccd_sau?: string;
  anh_gcn?: string;
  ghi_chu?: string;
}
