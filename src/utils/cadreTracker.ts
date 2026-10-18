import { getSavedCadreName } from './declaration';

interface SendLocationOptions {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number | null;
  heading?: number | null;
  action?: string;
  force?: boolean;
}

let lastReportTime = 0;
let lastReportedLat = 0;
let lastReportedLng = 0;
const MIN_REPORT_INTERVAL_MS = 12000; // Tối thiểu 12 giây một lần để tiết kiệm pin & mạng
const MIN_DISTANCE_CHANGE_METERS = 5; // Hoặc di chuyển trên 5m thì gửi ngay

function calculateSimpleDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Lấy hoặc khởi tạo mã phần cứng thiết bị vĩnh viễn (để giữ liên kết lộ trình kể cả trước và sau khi nhập tên)
 */
export function getPermanentDeviceId(): string {
  if (typeof window === 'undefined') return 'DEV_UNKNOWN';
  try {
    let devId = localStorage.getItem('diachinh_permanent_device_id');
    if (!devId) {
      const legacy = localStorage.getItem('diachinh_device_id');
      if (legacy && legacy.startsWith('MAY_')) {
        devId = legacy;
      } else {
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        devId = `MAY_${rand}`;
      }
      localStorage.setItem('diachinh_permanent_device_id', devId);
    }
    return devId;
  } catch {
    return 'MAY_DEF';
  }
}

/**
 * Phát sóng tọa độ GPS của cán bộ lên máy chủ trung tâm
 */
export async function reportCadreLocation(options: SendLocationOptions): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const deviceId = getPermanentDeviceId();
  const savedName = getSavedCadreName();
  // Phương án B: Nếu chưa nhập tên, tự động gán tên định danh tạm thời theo mã máy
  const cadreName = savedName || `CHUADATTEN_${deviceId.replace(/^MAY_/, '')}`;

  const { lat, lng, accuracy = 10, speed = null, heading = null, action, force = false } = options;
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return false;

  const now = Date.now();
  const timeElapsed = now - lastReportTime;
  const dist = calculateSimpleDistance(lastReportedLat, lastReportedLng, lat, lng);

  // Chỉ gửi nếu được yêu cầu bắt buộc (force), hoặc đã quá thời gian tối thiểu, hoặc di chuyển > 5m
  if (!force && timeElapsed < MIN_REPORT_INTERVAL_MS && dist < MIN_DISTANCE_CHANGE_METERS) {
    return false;
  }

  lastReportTime = now;
  lastReportedLat = lat;
  lastReportedLng = lng;

  let batteryLevel: number | null = null;
  try {
    if (typeof navigator !== 'undefined' && (navigator as any).getBattery) {
      const b = await (navigator as any).getBattery();
      batteryLevel = Math.round((b.level || 0) * 100);
    }
  } catch {}

  const payload = {
    cadreName,
    deviceId,
    lat,
    lng,
    accuracy,
    speed,
    heading,
    currentAction: action || (speed && speed > 2 ? 'Đang di chuyển thực địa' : 'Đang làm việc tại chỗ'),
    battery: batteryLevel,
  };

  try {
    // Sử dụng keepalive để request hoàn thành ngay cả khi người dùng chuyển tab
    await fetch('/api/cadres/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return true;
  } catch (err) {
    console.warn('Lỗi khi phát sóng vị trí cán bộ:', err);
    return false;
  }
}
