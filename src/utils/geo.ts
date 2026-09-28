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
 * Tính góc phương vị (bearing) từ điểm 1 đến điểm 2:
 * Trả về góc từ 0 đến 360 độ (0 = Bắc, 90 = Đông, 180 = Nam, 270 = Tây)
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  const bearing = ((θ * 180) / Math.PI + 360) % 360;
  return Math.round(bearing * 10) / 10;
}

export function getCompassInfo(bearing: number): {
  directionText: string;
  quadrant: 'dong' | 'tay' | 'nam' | 'bac';
  quadrantText: string;
  arrow: string;
} {
  const b = ((bearing % 360) + 360) % 360;

  let directionText = 'Bắc';
  let arrow = '⬆️';

  if (b >= 22.5 && b < 67.5) {
    directionText = 'Đông Bắc';
    arrow = '↗️';
  } else if (b >= 67.5 && b < 112.5) {
    directionText = 'Đông';
    arrow = '➡️';
  } else if (b >= 112.5 && b < 157.5) {
    directionText = 'Đông Nam';
    arrow = '↘️';
  } else if (b >= 157.5 && b < 202.5) {
    directionText = 'Nam';
    arrow = '⬇️';
  } else if (b >= 202.5 && b < 247.5) {
    directionText = 'Tây Nam';
    arrow = '↙️';
  } else if (b >= 247.5 && b < 292.5) {
    directionText = 'Tây';
    arrow = '⬅️';
  } else if (b >= 292.5 && b < 337.5) {
    directionText = 'Tây Bắc';
    arrow = '↖️';
  }

  // Phân chia 4 cung chính (Tứ cận: Đông, Tây, Nam, Bắc)
  let quadrant: 'dong' | 'tay' | 'nam' | 'bac' = 'bac';
  let quadrantText = 'Phía Đông';
  if (b >= 45 && b < 135) {
    quadrant = 'dong';
    quadrantText = 'Phía Đông';
  } else if (b >= 135 && b < 225) {
    quadrant = 'nam';
    quadrantText = 'Phía Nam';
  } else if (b >= 225 && b < 315) {
    quadrant = 'tay';
    quadrantText = 'Phía Tây';
  } else {
    quadrant = 'bac';
    quadrantText = 'Phía Bắc';
  }

  return { directionText, quadrant, quadrantText, arrow };
}

/**
 * Định dạng chuỗi mô tả ranh giới thửa đất chuẩn địa chính
 */
export function formatBoundaryText(p?: Parcel | NeighborParcel | null): string {
  if (!p) return '';
  const owner = p.chu_ho && p.chu_ho !== 'Chưa có tên' ? ` - ${p.chu_ho}` : '';
  return `Thửa ${p.so_thua} (Tờ ${p.to_ban_do})${owner}`;
}

/**
 * Tự động quét và nhận diện thửa tiếp giáp 4 hướng (Tứ cận: Đông, Tây, Nam, Bắc)
 * dựa trên tọa độ GPS thực địa.
 */
export function autoDetectBoundaries(
  current: Parcel,
  allParcels: Parcel[],
  maxDistance = 500
): {
  dong?: NeighborParcel;
  tay?: NeighborParcel;
  nam?: NeighborParcel;
  bac?: NeighborParcel;
} {
  if (!current.lat || !current.lng) return {};

  const byQuadrant: Record<'dong' | 'tay' | 'nam' | 'bac', NeighborParcel[]> = {
    dong: [],
    tay: [],
    nam: [],
    bac: [],
  };

  for (const p of allParcels) {
    if (p.ma_thua === current.ma_thua) continue;
    if (!p.lat || !p.lng) continue;

    const dist = calculateDistanceMeters(current.lat, current.lng, p.lat, p.lng);
    if (dist > maxDistance) continue;

    const bearing = calculateBearing(current.lat, current.lng, p.lat, p.lng);
    const compass = getCompassInfo(bearing);

    byQuadrant[compass.quadrant].push({
      ...p,
      distanceMeters: dist,
      bearing,
      directionText: compass.directionText,
      arrow: compass.arrow,
      quadrant: compass.quadrant,
      quadrantText: compass.quadrantText,
    });
  }

  // Chọn thửa tiếp giáp tốt nhất cho mỗi hướng:
  // Ưu tiên khoảng cách gần, nếu có tên trong khoảng cách gần thì ưu tiên
  const pickBestNeighbor = (list: NeighborParcel[]): NeighborParcel | undefined => {
    if (list.length === 0) return undefined;
    return list.sort((a, b) => {
      const hasOwnerA = Boolean(a.chu_ho && a.chu_ho !== 'Chưa có tên');
      const hasOwnerB = Boolean(b.chu_ho && b.chu_ho !== 'Chưa có tên');
      if (hasOwnerA !== hasOwnerB && a.distanceMeters < b.distanceMeters * 1.5) {
        return hasOwnerA ? -1 : 1;
      }
      return a.distanceMeters - b.distanceMeters;
    })[0];
  };

  return {
    dong: pickBestNeighbor(byQuadrant.dong),
    tay: pickBestNeighbor(byQuadrant.tay),
    nam: pickBestNeighbor(byQuadrant.nam),
    bac: pickBestNeighbor(byQuadrant.bac),
  };
}

/**
 * Tìm các thửa lân cận (gần nhất):
 * Tự động tính toán hướng la bàn và khoảng cách thực tế.
 */
export function findNearbyParcels(
  current: Parcel,
  allParcels: Parcel[],
  maxDistance = 450,
  limit = 12
): NeighborParcel[] {
  if (!current.lat || !current.lng) return [];

  const neighbors: NeighborParcel[] = [];

  for (const p of allParcels) {
    if (p.ma_thua === current.ma_thua) continue;
    if (!p.lat || !p.lng) continue;

    const dist = calculateDistanceMeters(current.lat, current.lng, p.lat, p.lng);
    if (dist <= maxDistance) {
      const bearing = calculateBearing(current.lat, current.lng, p.lat, p.lng);
      const compass = getCompassInfo(bearing);
      neighbors.push({
        ...p,
        distanceMeters: dist,
        bearing,
        directionText: compass.directionText,
        arrow: compass.arrow,
        quadrant: compass.quadrant,
        quadrantText: compass.quadrantText,
      });
    }
  }

  // Sắp xếp theo khoảng cách tăng dần (gần nhất lên đầu)
  return neighbors
    .sort((a, b) => {
      const getPriorityScore = (p: NeighborParcel) => {
        if (p.trang_thai === 'DA_SO_HOA_XANH') return 0;
        if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') return 1;
        if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') return 2;
        return 3;
      };

      const scoreA = getPriorityScore(a);
      const scoreB = getPriorityScore(b);

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

