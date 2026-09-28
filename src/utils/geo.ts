import { Parcel, NeighborParcel } from '@/types';

// Bán kính Trái Đất (mét)
const EARTH_RADIUS_METERS = 6371000;

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 10) / 10;
}

/**
 * Tìm các thửa lân cận (gần nhất):
 * Hỗ trợ lấy cả thửa màu xanh (đã số hóa/đã kê khai) và thửa màu vàng (có tên chủ đất),
 * ưu tiên theo khoảng cách thực địa gần nhất để tiện lập biên bản tứ cận.
 */
export function findNearbyParcels(
  current: Parcel,
  allParcels: Parcel[],
  maxDistance = 350,
  limit = 8
): NeighborParcel[] {
  if (!current.lat || !current.lng) return [];

  const neighbors: NeighborParcel[] = [];

  for (const p of allParcels) {
    if (p.ma_thua === current.ma_thua) continue;
    if (!p.lat || !p.lng) continue;

    const dist = calculateDistanceMeters(current.lat, current.lng, p.lat, p.lng);
    if (dist <= maxDistance) {
      neighbors.push({
        ...p,
        distanceMeters: dist,
      });
    }
  }

  // Phân loại ưu tiên:
  // Nhóm 1 (Độ ưu tiên cao nhất): Thửa Xanh lá (GGS), Xanh lam (Đã kê khai) và Vàng (Có tên chủ đất)
  // Nhóm 2: Thửa chưa có tên (Trắng/Xám)
  // Trong cùng nhóm, sắp xếp tăng dần theo khoảng cách (thửa gần nhất lên đầu)
  return neighbors
    .sort((a, b) => {
      const getPriorityScore = (p: NeighborParcel) => {
        if (p.trang_thai === 'DA_SO_HOA_XANH') return 0; // Xanh lá
        if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') return 1; // Xanh lam
        if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') return 2; // Vàng (có tên)
        return 3; // Trắng (chưa tên)
      };

      const scoreA = getPriorityScore(a);
      const scoreB = getPriorityScore(b);

      // Nếu cả hai đều có thông tin (thuộc nhóm 0, 1 hoặc 2), ưu tiên khoảng cách gần nhất
      const isInformativeA = scoreA < 3;
      const isInformativeB = scoreB < 3;

      if (isInformativeA && isInformativeB) {
        return a.distanceMeters - b.distanceMeters;
      }

      if (isInformativeA !== isInformativeB) {
        return isInformativeA ? -1 : 1;
      }

      return a.distanceMeters - b.distanceMeters;
    })
    .slice(0, limit);
}

// Hàm chuẩn hóa chuỗi tiếng Việt để tìm kiếm
export function removeVietnameseTones(str: string): string {
  if (!str) return '';
  str = str.toLowerCase();
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, 'a');
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, 'e');
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, 'i');
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, 'o');
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, 'u');
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, 'y');
  str = str.replace(/đ/g, 'd');
  str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, '');
  str = str.replace(/\u02C6|\u0306|\u031B/g, '');
  return str.trim();
}

const DEFAULT_R2_URL = 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

/**
 * Lấy URL ảnh scan CCCD / GCN:
 * Tải trực tiếp từ Cloudflare R2 CDN siêu tốc
 */
export function getResolvedImageUrl(path?: string | null): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const r2Url = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL || DEFAULT_R2_URL;
  const cleanR2 = r2Url.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanR2}${cleanPath}`;
}

export function getResolvedSvgUrl(path?: string | null): string {
  return getResolvedImageUrl(path);
}

/**
 * Tải file ảnh về máy tính hoặc điện thoại:
 * Tự động chuyển đổi qua Blob để kích hoạt tải xuống thật (không bị trình duyệt mở tab mới)
 */
export async function downloadFile(urlOrPath: string, customFilename?: string): Promise<boolean> {
  if (!urlOrPath) return false;
  try {
    const directUrl = getResolvedImageUrl(urlOrPath);
    let blob: Blob | null = null;
    try {
      const res = await fetch(directUrl);
      if (res.ok) {
        blob = await res.blob();
      }
    } catch {
      // Fallback via proxy
    }

    if (!blob) {
      try {
        const cleanPath = urlOrPath.startsWith('http')
          ? new URL(urlOrPath).pathname.replace(/^\/+/, '')
          : urlOrPath.replace(/^\/+/, '');
        const proxyUrl = `/api/image/${cleanPath}`;
        const res = await fetch(proxyUrl);
        if (res.ok) {
          blob = await res.blob();
        }
      } catch (proxyErr) {
        console.warn('Proxy fetch failed:', proxyErr);
      }
    }

    if (blob) {
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const defaultName = urlOrPath.split('/').pop() || 'hoso_diachinh.jpg';
      a.download = customFilename || defaultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1500);
      return true;
    }

    window.open(directUrl, '_blank');
    return true;
  } catch (err) {
    console.error('Download file error:', err);
    window.open(getResolvedImageUrl(urlOrPath), '_blank');
    return false;
  }
}

