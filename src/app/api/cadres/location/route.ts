import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { CadreLocationRecord, CadreBreadcrumb, CadreWorkStatus } from '@/types';
import { formatCadreName } from '@/utils/declaration';

export const dynamic = 'force-dynamic';

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL || 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

const KEY_CADRE_LOCATIONS = 'cadres/live_locations.json';

// In-memory cache 2 giây để đáp ứng phản hồi cực nhanh cho dashboard
let cadresCache: { list: CadreLocationRecord[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 2000;

// Danh sách tọa độ trung tâm các thôn / buôn tại xã Cư Pui để xác định vị trí thực tế
const VILLAGE_CENTERS: { name: string; lat: number; lng: number }[] = [
  { name: 'UBND Xã Cư Pui', lat: 12.5278, lng: 108.4932 },
  { name: 'Buôn Đắk Tuôr', lat: 12.5152, lng: 108.4756 },
  { name: 'Buôn Khóa', lat: 12.5310, lng: 108.4850 },
  { name: 'Buôn Khanh', lat: 12.5420, lng: 108.5020 },
  { name: 'Buôn Ngô', lat: 12.5180, lng: 108.5110 },
  { name: 'Buôn Bhung', lat: 12.5090, lng: 108.4980 },
  { name: 'Buôn Cư Pui', lat: 12.5350, lng: 108.4970 },
  { name: 'Buôn Cư Phiang', lat: 12.5490, lng: 108.4830 },
  { name: 'Buôn Tliêr', lat: 12.5240, lng: 108.4680 },
  { name: 'Buôn Phung', lat: 12.5380, lng: 108.5200 },
  { name: 'Buôn M\'Hăng', lat: 12.5530, lng: 108.5120 },
  { name: 'Buôn Hàng', lat: 12.5160, lng: 108.4820 },
  { name: 'Thôn 1', lat: 12.5265, lng: 108.4915 },
  { name: 'Thôn 2', lat: 12.5325, lng: 108.4990 },
  { name: 'Thôn 3', lat: 12.5410, lng: 108.4880 },
  { name: 'Thôn 4', lat: 12.5460, lng: 108.4950 },
  { name: 'Thôn Ea Uôl', lat: 12.5620, lng: 108.5250 },
];

function findNearestVillage(lat: number, lng: number): string {
  let nearest = 'Xã Cư Pui';
  let minDist = Infinity;
  for (const v of VILLAGE_CENTERS) {
    const d = calculateDistance(lat, lng, v.lat, v.lng);
    if (d < minDist) {
      minDist = d;
      nearest = v.name;
    }
  }
  // Nếu cách Cư Pui > 15km: Hiển thị rõ vị trí ngoài địa bàn xã
  if (minDist > 15000) {
    const km = Math.round(minDist / 1000);
    return `Ngoài địa bàn Cư Pui (~${km} km)`;
  }
  return nearest;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

async function getS3Client(): Promise<any | null> {
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    try {
      const { S3Client } = await import('@aws-sdk/client-s3');
      return new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY,
          secretAccessKey: R2_SECRET_KEY,
        },
      });
    } catch (err) {
      console.warn('Lỗi khởi tạo S3Client SDK:', err);
    }
  }
  return null;
}

async function loadCadresFromR2(forceRefresh = false): Promise<CadreLocationRecord[]> {
  const now = Date.now();
  if (!forceRefresh && cadresCache && now - cadresCache.timestamp < CACHE_TTL_MS) {
    return cadresCache.list;
  }

  // 1. R2 Binding
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      const obj = await bucket.get(KEY_CADRE_LOCATIONS);
      if (obj) {
        const text = await obj.text();
        const data = JSON.parse(text);
        const list: CadreLocationRecord[] = Array.isArray(data) ? data : [];
        cadresCache = { list, timestamp: now };
        return list;
      }
    }
  } catch (err) {
    console.warn('Lỗi đọc cadre locations từ R2 binding:', err);
  }

  // 2. Fallback fetch qua public URL
  try {
    const res = await fetch(`${R2_PUBLIC_URL}/${KEY_CADRE_LOCATIONS}?t=${now}`, {
      headers: { 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (res.ok) {
      const list = (await res.json()) as CadreLocationRecord[];
      if (Array.isArray(list)) {
        cadresCache = { list, timestamp: now };
        return list;
      }
    }
  } catch (err) {
    // Không log lỗi nếu file chưa tồn tại lần đầu
  }

  const fallback: CadreLocationRecord[] = [];
  cadresCache = { list: fallback, timestamp: now };
  return fallback;
}

async function saveCadresToR2(list: CadreLocationRecord[]): Promise<boolean> {
  const jsonStr = JSON.stringify(list);
  cadresCache = { list, timestamp: Date.now() };

  // 1. R2 Binding
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      await bucket.put(KEY_CADRE_LOCATIONS, jsonStr, {
        httpMetadata: { contentType: 'application/json' },
      });
      return true;
    }
  } catch (err) {
    console.warn('Lỗi ghi cadre locations qua R2 binding:', err);
  }

  // 2. S3 SDK fallback
  try {
    const s3 = await getS3Client();
    if (s3) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: KEY_CADRE_LOCATIONS,
          Body: Buffer.from(jsonStr, 'utf-8'),
          ContentType: 'application/json',
        })
      );
      return true;
    }
  } catch (err) {
    console.error('Lỗi ghi cadre locations qua S3 SDK:', err);
  }

  return false;
}

function computeLiveStatus(lastUpdated: number, speed?: number | null): CadreWorkStatus {
  const diffSec = (Date.now() - lastUpdated) / 1000;
  if (diffSec <= 180) {
    // Trong vòng 3 phút
    if (speed && speed >= 1.5) return 'active_moving';
    return 'active_stationary';
  }
  if (diffSec <= 600) {
    // Từ 3 đến 10 phút
    return 'idle';
  }
  // Quá 10 phút không cập nhật
  return 'offline';
}

// GET: Lấy danh sách realtime của tất cả cán bộ kèm trạng thái làm việc & lộ trình
export async function GET() {
  try {
    const rawList = await loadCadresFromR2();
    const now = Date.now();

    // Cập nhật lại status theo thời gian thực tại thời điểm request
    const cadres: CadreLocationRecord[] = rawList.map((c) => ({
      ...c,
      status: computeLiveStatus(c.lastUpdated, c.speed),
      nearestVillage: c.nearestVillage || findNearestVillage(c.lat, c.lng),
    }));

    return NextResponse.json({
      success: true,
      cadres,
      serverTime: now,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Lỗi server' },
      { status: 500 }
    );
  }
}

// POST: Cán bộ gửi vị trí GPS realtime hoặc Quản trị viên thao tác (Mô phỏng/Xóa)
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as any;
    const { action } = body;

    // THAO TÁC 1: XÓA HOẶC LÀM MỚI DỮ LIỆU
    if (action === 'clear' || action === 'reset_all') {
      await saveCadresToR2([]);
      return NextResponse.json({ success: true, message: 'Đã xóa toàn bộ dữ liệu vị trí cán bộ' });
    }

    // THAO TÁC 2: MÔ PHỎNG DỮ LIỆU THỰC ĐỊA (DEMO MODE CHO TEST)
    if (action === 'demo_seed') {
      const demoCadres: CadreLocationRecord[] = [
        {
          cadreName: 'PHANTHANHTRUC',
          deviceId: 'PHANTHANHTRUC',
          lat: 12.5165,
          lng: 108.4768,
          accuracy: 5,
          speed: 16.5,
          heading: 85,
          currentAction: 'Đang khảo sát thực địa thửa 03_14',
          lastUpdated: Date.now() - 15000, // 15 giây trước
          status: 'active_moving',
          todayDistanceMeters: 4850,
          nearestVillage: 'Buôn Đắk Tuôr',
          breadcrumbs: [
            { lat: 12.5278, lng: 108.4932, timestamp: Date.now() - 3600000, speed: 22, accuracy: 6 },
            { lat: 12.5230, lng: 108.4870, timestamp: Date.now() - 2800000, speed: 18, accuracy: 5 },
            { lat: 12.5190, lng: 108.4810, timestamp: Date.now() - 1500000, speed: 14, accuracy: 4 },
            { lat: 12.5175, lng: 108.4785, timestamp: Date.now() - 600000, speed: 4, accuracy: 5 },
            { lat: 12.5165, lng: 108.4768, timestamp: Date.now() - 15000, speed: 16.5, accuracy: 5 },
          ],
        },
        {
          cadreName: 'NGUYENVANAN',
          deviceId: 'MAY_AN01',
          lat: 12.5312,
          lng: 108.4855,
          accuracy: 4,
          speed: 0.5,
          heading: 190,
          currentAction: 'Đang kê khai tại nhà dân (thửa 08_12)',
          lastUpdated: Date.now() - 45000, // 45 giây trước
          status: 'active_stationary',
          todayDistanceMeters: 2600,
          nearestVillage: 'Buôn Khóa',
          breadcrumbs: [
            { lat: 12.5278, lng: 108.4932, timestamp: Date.now() - 2400000, speed: 15, accuracy: 5 },
            { lat: 12.5295, lng: 108.4890, timestamp: Date.now() - 1600000, speed: 12, accuracy: 4 },
            { lat: 12.5310, lng: 108.4858, timestamp: Date.now() - 800000, speed: 0.8, accuracy: 4 },
            { lat: 12.5312, lng: 108.4855, timestamp: Date.now() - 45000, speed: 0.5, accuracy: 4 },
          ],
        },
        {
          cadreName: 'TRANTHIBICH',
          deviceId: 'MAY_BICH02',
          lat: 12.5418,
          lng: 108.5025,
          accuracy: 6,
          speed: 0,
          heading: 0,
          currentAction: 'Nghỉ giải lao tại nhà cộng đồng',
          lastUpdated: Date.now() - 320000, // 5 phút trước
          status: 'idle',
          todayDistanceMeters: 3100,
          nearestVillage: 'Buôn Khanh',
          breadcrumbs: [
            { lat: 12.5350, lng: 108.4970, timestamp: Date.now() - 3000000, speed: 19, accuracy: 6 },
            { lat: 12.5400, lng: 108.5010, timestamp: Date.now() - 1800000, speed: 11, accuracy: 5 },
            { lat: 12.5418, lng: 108.5025, timestamp: Date.now() - 320000, speed: 0, accuracy: 6 },
          ],
        },
        {
          cadreName: 'LEVANHOANG',
          deviceId: 'MAY_HOANG03',
          lat: 12.5185,
          lng: 108.5115,
          accuracy: 10,
          speed: 0,
          heading: 0,
          currentAction: 'Đã hoàn thành khảo sát buổi sáng',
          lastUpdated: Date.now() - 950000, // 16 phút trước
          status: 'offline',
          todayDistanceMeters: 5200,
          nearestVillage: 'Buôn Ngô',
          breadcrumbs: [
            { lat: 12.5278, lng: 108.4932, timestamp: Date.now() - 5400000, speed: 20, accuracy: 8 },
            { lat: 12.5210, lng: 108.5060, timestamp: Date.now() - 3600000, speed: 14, accuracy: 7 },
            { lat: 12.5185, lng: 108.5115, timestamp: Date.now() - 950000, speed: 0, accuracy: 10 },
          ],
        },
      ];
      await saveCadresToR2(demoCadres);
      return NextResponse.json({ success: true, message: 'Đã kích hoạt dữ liệu mô phỏng thực địa', cadres: demoCadres });
    }

    // THAO TÁC 3: CẬP NHẬT TỌA ĐỘ GPS THỰC TẾ CỦA CÁN BỘ
    const {
      cadreName: rawName,
      deviceId: rawDeviceId,
      lat,
      lng,
      accuracy = 10,
      speed = null,
      heading = null,
      currentAction = 'Đang khảo sát thực địa',
      battery = null,
    } = body;

    const formattedName = formatCadreName(rawName || rawDeviceId || 'CANBO');
    if (!formattedName || typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json(
        { success: false, error: 'Thiếu thông tin tên cán bộ hoặc tọa độ GPS' },
        { status: 400 }
      );
    }

    const deviceId = rawDeviceId || formattedName;
    const now = Date.now();
    const nearestVillage = findNearestVillage(lat, lng);
    const liveStatus = computeLiveStatus(now, speed);

    const existingList = await loadCadresFromR2();
    const index = existingList.findIndex(
      (c) => c.cadreName === formattedName || (c.deviceId && c.deviceId === deviceId)
    );

    let updatedRecord: CadreLocationRecord;

    if (index >= 0) {
      const prev = existingList[index];
      const distFromPrev = calculateDistance(prev.lat, prev.lng, lat, lng);

      // Tính tổng quãng đường di chuyển trong ngày (lũy kế nếu di chuyển >= 5m)
      const isMoved = distFromPrev >= 5;
      const todayDist = (prev.todayDistanceMeters || 0) + (isMoved ? Math.round(distFromPrev) : 0);

      // Thêm điểm breadcrumb nếu di chuyển >= 5m hoặc điểm cũ cách đây > 30 giây
      let newBreadcrumbs = Array.isArray(prev.breadcrumbs) ? [...prev.breadcrumbs] : [];
      const lastPoint = newBreadcrumbs[newBreadcrumbs.length - 1];
      const timeSinceLastPoint = lastPoint ? now - lastPoint.timestamp : Infinity;

      if (isMoved || timeSinceLastPoint >= 30000 || newBreadcrumbs.length === 0) {
        newBreadcrumbs.push({
          lat,
          lng,
          timestamp: now,
          speed: typeof speed === 'number' ? Math.round(speed * 10) / 10 : null,
          accuracy: Math.round(accuracy),
        });
        // Giữ tối đa 150 điểm gần nhất trong ngày để payload nhẹ và mượt
        if (newBreadcrumbs.length > 150) {
          newBreadcrumbs = newBreadcrumbs.slice(newBreadcrumbs.length - 150);
        }
      }

      updatedRecord = {
        ...prev,
        cadreName: formattedName,
        deviceId,
        lat,
        lng,
        accuracy: Math.round(accuracy),
        speed: typeof speed === 'number' ? Math.round(speed * 10) / 10 : null,
        heading: typeof heading === 'number' ? Math.round(heading) : prev.heading,
        currentAction: currentAction || prev.currentAction,
        battery: typeof battery === 'number' ? battery : prev.battery,
        lastUpdated: now,
        status: liveStatus,
        todayDistanceMeters: todayDist,
        nearestVillage,
        breadcrumbs: newBreadcrumbs,
      };

      existingList[index] = updatedRecord;
    } else {
      // Cán bộ mới lần đầu kết nối GPS
      updatedRecord = {
        cadreName: formattedName,
        deviceId,
        lat,
        lng,
        accuracy: Math.round(accuracy),
        speed: typeof speed === 'number' ? Math.round(speed * 10) / 10 : null,
        heading: typeof heading === 'number' ? Math.round(heading) : null,
        currentAction: currentAction || 'Bắt đầu làm việc thực địa',
        battery: typeof battery === 'number' ? battery : null,
        lastUpdated: now,
        status: liveStatus,
        todayDistanceMeters: 0,
        nearestVillage,
        breadcrumbs: [
          {
            lat,
            lng,
            timestamp: now,
            speed: typeof speed === 'number' ? Math.round(speed * 10) / 10 : null,
            accuracy: Math.round(accuracy),
          },
        ],
      };
      existingList.push(updatedRecord);
    }

    await saveCadresToR2(existingList);

    return NextResponse.json({
      success: true,
      record: updatedRecord,
    });
  } catch (err: any) {
    console.error('Lỗi khi cập nhật vị trí cán bộ:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Lỗi server' },
      { status: 500 }
    );
  }
}
