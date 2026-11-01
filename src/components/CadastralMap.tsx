'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Parcel, NeighborParcel, AdditionalParcel } from '@/types';
import { extractShortOwnerName } from '@/utils/geo';
import { Maximize2, LocateFixed, Loader2, Compass } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import hiddenParcelsData from '@/data/hidden_parcels.json';

const HIDDEN_PARCEL_SET = new Set(hiddenParcelsData as string[]);

interface CadastralMapProps {
  parcels: Parcel[];
  onSelectParcel: (parcel: Parcel) => void;
  selectedParcel: Parcel | null;
  additionalParcels?: AdditionalParcel[];
  neighborParcels?: NeighborParcel[];
  userLocation?: { lat: number; lng: number; accuracy: number; heading?: number | null; speed?: number | null } | null;
  isTracking?: boolean;
  isLocating?: boolean;
  onToggleLocation?: () => void;
  isBottomPanelActive?: boolean;
}

// Lớp ảnh vệ tinh Google Maps Hybrid (ảnh vệ tinh độ nét cao kèm tên đường & địa danh)
const GOOGLE_HYBRID_TILES = [
  'https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  'https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  'https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
];

// Helper lọc và tạo GeoJSON chuẩn
function buildParcelsGeoJson(rawList: Parcel[]): {
  geojson: GeoJSON.FeatureCollection<GeoJSON.Point>;
  mapStore: Map<string, Parcel>;
  validList: Parcel[];
} {
  const mapStore = new Map<string, Parcel>();
  const validList: Parcel[] = [];
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const p = rawList[i];
    if (!p.lat || !p.lng || HIDDEN_PARCEL_SET.has(p.ma_thua)) continue;

    const ld = (p.loai_dat || '').trim().toUpperCase();
    if (ld === 'BCS') {
      const dt = parseFloat(String(p.dien_tich || '').replace(',', '.'));
      if (!isNaN(dt) && dt < 100) continue;
    }

    mapStore.set(p.ma_thua, p);
    validList.push(p);

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [p.lng as number, p.lat as number],
      },
      properties: {
        ma_thua: p.ma_thua,
        so_thua: p.so_thua,
        to_ban_do: p.to_ban_do,
        chu_ho: p.chu_ho || '',
        loai_dat: p.loai_dat || '',
        dien_tich: p.dien_tich || '',
        thon_xa: p.thon_xa || '',
        trang_thai: p.trang_thai,
      },
    });
  }

  return {
    geojson: { type: 'FeatureCollection', features },
    mapStore,
    validList,
  };
}

export default function CadastralMap({
  parcels,
  onSelectParcel,
  selectedParcel,
  additionalParcels = [],
  neighborParcels = [],
  userLocation,
  isTracking = false,
  isLocating = false,
  onToggleLocation,
  isBottomPanelActive = true,
}: CadastralMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Góc xoay hiện tại (độ) để hiển thị la bàn
  const [bearing, setBearing] = useState<number>(0);
  // Số thửa hợp lệ hiển thị
  const [dotsCount, setDotsCount] = useState(0);
  // Chế độ tự động bám theo bước chân GPS
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  // Trạng thái đang xoay quanh điểm
  const [isOrbiting, setIsOrbiting] = useState(false);
  // Tọa độ điểm neo xoay (hiển thị tâm neo trên màn hình)
  const [orbitPivotScreen, setOrbitPivotScreen] = useState<{ x: number; y: number } | null>(null);

  // Markers tham chiếu để không tạo lại DOM không cần thiết
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const additionalMarkersRef = useRef<maplibregl.Marker[]>([]);
  const neighborMarkersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);

  const hoverTooltipRef = useRef<HTMLDivElement>(null);
  const lastCenteredParcelRef = useRef<string | null>(null);

  // Danh sách thửa đất hợp lệ được cache
  const validParcelsMapRef = useRef<Map<string, Parcel>>(new Map());
  const geojsonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>({
    type: 'FeatureCollection',
    features: [],
  });

  // Giữ tham chiếu hàm chọn thửa
  const onSelectParcelRef = useRef(onSelectParcel);
  useEffect(() => {
    onSelectParcelRef.current = onSelectParcel;
  }, [onSelectParcel]);

  // Cờ nhận diện thiết bị cảm ứng
  const isTouchDeviceRef = useRef<boolean>(false);
  useEffect(() => {
    isTouchDeviceRef.current =
      typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
  }, []);

  // Đồng bộ nguồn GeoJSON các thửa đất lên WebGL MapLibre
  const syncParcelsToMap = useCallback((mapInstance: maplibregl.Map) => {
    if (!mapInstance || !mapInstance.isStyleLoaded()) return;

    const data = geojsonRef.current;
    const existingSource = mapInstance.getSource('parcels-source') as maplibregl.GeoJSONSource;

    if (existingSource) {
      existingSource.setData(data);
    } else {
      mapInstance.addSource('parcels-source', {
        type: 'geojson',
        data,
        tolerance: 0,
        buffer: 0,
      });

      if (!mapInstance.getLayer('parcels-layer')) {
        mapInstance.addLayer({
          id: 'parcels-layer',
          type: 'circle',
          source: 'parcels-source',
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10, 2.8,
              13, 4.5,
              15, 6.5,
              17, 9.2,
              19, 13,
              21, 16.5,
            ],
            'circle-color': [
              'match',
              ['get', 'trang_thai'],
              'DA_SO_HOA_XANH', '#10b981', // Xanh lá: Đã số hóa (Google Sheets)
              'DA_KE_KHAI_CHUA_SO_HOA_LAM', '#2563eb', // Xanh lam: Đã kê khai (Web)
              'CO_TEN_CHUA_SO_HOA_VANG', '#eab308', // Vàng: Có tên chưa làm
              /* default */ '#ffffff', // Trắng: Không tên
            ],
            'circle-stroke-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10, 0.8,
              14, 1.5,
              17, 2.2,
            ],
            'circle-stroke-color': [
              'match',
              ['get', 'trang_thai'],
              'DA_SO_HOA_XANH', '#064e3b',
              'DA_KE_KHAI_CHUA_SO_HOA_LAM', '#1e3a8a',
              'CO_TEN_CHUA_SO_HOA_VANG', '#713f12',
              /* default */ '#475569',
            ],
            'circle-opacity': 0.95,
            'circle-pitch-alignment': 'viewport',
          },
        });
      }
    }
  }, []);

  // 1. Khởi tạo Bản đồ MapLibre GL 2D phẳng nguyên bản (Không 3D, không méo mó, tràn 100% màn hình khi xoay)
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          'google-earth': {
            type: 'raster',
            tiles: GOOGLE_HYBRID_TILES,
            tileSize: 256,
            maxzoom: 21,
            attribution: '&copy; Google Hybrid',
          },
        },
        layers: [
          {
            id: 'google-earth-layer',
            type: 'raster',
            source: 'google-earth',
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      },
      center: [108.493, 12.527],
      zoom: 13,
      pitch: 0,
      bearing: 0,
      maxPitch: 0, // Khóa cố định 2D phẳng chuẩn xác tuyệt đối, không bị nghiêng lồi lõm
      attributionControl: false,
      trackResize: true,
      dragRotate: false, // Quản lý xoay qua tính năng Pivot Orbit độc quyền
      touchPitch: false, // Tắt hoàn toàn cử chỉ nghiêng 3D
      touchZoomRotate: true,
    });

    mapRef.current = map;

    // Lắng nghe thay đổi góc xoay
    const updateBearing = () => {
      const b = Math.round(map.getBearing());
      setBearing(b);
    };

    map.on('rotate', updateBearing);

    map.on('dragstart', () => {
      setIsFollowingUser(false);
      if (hoverTooltipRef.current) {
        hoverTooltipRef.current.style.display = 'none';
      }
    });

    map.on('load', () => {
      // Đảm bảo layer thửa đất được nạp ngay từ khung hình đầu tiên
      syncParcelsToMap(map);

      // Nguồn và Layer vẽ đường nối thửa lân cận & thửa gộp
      map.addSource('connections-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      map.addLayer({
        id: 'connections-line',
        type: 'line',
        source: 'connections-source',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-dasharray': [2, 2],
          'line-opacity': 0.85,
        },
      });

      // Xử lý click chọn thửa đất siêu nhạy qua WebGL Raycast
      map.on('click', (e) => {
        if (didOrbitRef.current) {
          didOrbitRef.current = false;
          return;
        }

        const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [e.point.x - 14, e.point.y - 14],
          [e.point.x + 14, e.point.y + 14],
        ];
        const features = map.queryRenderedFeatures(bbox, { layers: ['parcels-layer'] });

        if (features && features.length > 0) {
          const maThua = features[0].properties?.ma_thua;
          if (maThua) {
            const matched = validParcelsMapRef.current.get(maThua);
            if (matched) {
              onSelectParcelRef.current(matched);
            }
          }
        }
      });

      // Xử lý rê chuột (hover) trên Desktop
      map.on('mousemove', 'parcels-layer', (e) => {
        if (isTouchDeviceRef.current || isOrbitingRef.current) return;
        map.getCanvas().style.cursor = 'pointer';

        if (e.features && e.features[0]) {
          const p = e.features[0].properties;
          const tip = hoverTooltipRef.current;
          if (tip) {
            const ownerDisplay = p.chu_ho || 'Không có trong dữ liệu';
            const statusBadgeHtml =
              p.trang_thai === 'DA_SO_HOA_XANH'
                ? '<span style="color:#10b981;font-weight:700;">🟢 Đã số hóa</span>'
                : p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
                ? '<span style="color:#60a5fa;font-weight:700;">🔵 Đã kê khai (Web)</span>'
                : p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG'
                ? '<span style="color:#eab308;font-weight:700;">🟡 Có tên (Chưa làm)</span>'
                : '<span style="color:#ffffff;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ffffff;border:1px solid #94a3b8;"></span>⚪ Không tên / Địa danh</span>';

            tip.innerHTML = `
              <div style="font-weight: 800; font-size: 13px; color: #fff; margin-bottom: 2px;">
                Thửa ${p.so_thua} • Tờ ${p.to_ban_do}
              </div>
              <div style="font-size: 11px; margin-bottom: 2px;">
                ${statusBadgeHtml}
              </div>
              <div style="color: #94a3b8; font-size: 11px;">
                ${p.thon_xa || 'xã Cư Pui'}
              </div>
              <div style="color: #e2e8f0; font-size: 11px; margin-top: 3px;">
                Chủ: <strong style="color: #38bdf8;">${ownerDisplay}</strong>
              </div>
              <div style="color: #4ade80; font-size: 11px; margin-top: 1px;">
                ${p.loai_dat || '---'} • ${p.dien_tich ? p.dien_tich + ' m²' : '---'}
              </div>
            `;
            tip.style.display = 'block';
            tip.style.transform = `translate3d(${Math.round(e.point.x)}px, ${Math.round(e.point.y - 12)}px, 0) translate(-50%, -100%)`;
          }
        }
      });

      map.on('mouseleave', 'parcels-layer', () => {
        if (isTouchDeviceRef.current) return;
        map.getCanvas().style.cursor = '';
        if (hoverTooltipRef.current) {
          hoverTooltipRef.current.style.display = 'none';
        }
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [syncParcelsToMap]);

  // ============================================================================
  // TÍNH NĂNG XOAY BẢN ĐỒ QUANH ĐIỂM (PIVOT ORBIT) - HIỂN THỊ ĐẦY ĐỦ 100% MÀN HÌNH
  // ============================================================================
  const holdTimerRef = useRef<any>(null);
  const startPointerRef = useRef<{ x: number; y: number; lng: number; lat: number } | null>(null);
  const startCameraRef = useRef<{ bearing: number }>({ bearing: 0 });
  const isOrbitingRef = useRef<boolean>(false);
  const didOrbitRef = useRef<boolean>(false);

  useEffect(() => {
    const container = mapContainerRef.current;
    const map = mapRef.current;
    if (!container || !map) return;

    const handlePointerDown = (e: PointerEvent) => {
      // Hỗ trợ chuột trái hoặc ngón tay cảm ứng hoặc chuột phải
      const isRightClick = e.button === 2;
      const isLeftClick = e.button === 0;

      if (!isRightClick && !isLeftClick && e.pointerType === 'mouse') return;

      const rect = container.getBoundingClientRect();
      const pointX = e.clientX - rect.left;
      const pointY = e.clientY - rect.top;

      let geoPivot: maplibregl.LngLat;
      try {
        geoPivot = map.unproject([pointX, pointY]);
      } catch {
        return;
      }

      startPointerRef.current = {
        x: e.clientX,
        y: e.clientY,
        lng: geoPivot.lng,
        lat: geoPivot.lat,
      };

      startCameraRef.current = {
        bearing: map.getBearing(),
      };

      didOrbitRef.current = false;

      // Nhấn giữ 180ms -> Kích hoạt chế độ Tâm xoay (Pivot Orbit)
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        isOrbitingRef.current = true;
        setIsOrbiting(true);
        didOrbitRef.current = true;

        // Khóa kéo bản đồ mặc định để xoay quanh điểm
        map.dragPan.disable();

        // Rung nhẹ phản hồi xúc giác trên điện thoại di động
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(25);
        }

        // Đặt điểm neo trực quan
        setOrbitPivotScreen({ x: pointX, y: pointY });
      }, isRightClick ? 0 : 180);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!startPointerRef.current) return;

      const dx = e.clientX - startPointerRef.current.x;
      const dy = e.clientY - startPointerRef.current.y;
      const dist = Math.hypot(dx, dy);

      // Nếu di chuyển nhanh trước 180ms -> Người dùng muốn kéo map bình thường
      if (!isOrbitingRef.current && dist > 8) {
        clearTimeout(holdTimerRef.current);
        return;
      }

      // Đang trong chế độ xoay quanh điểm (Pivot Orbit)
      if (isOrbitingRef.current) {
        const { lng, lat } = startPointerRef.current;
        const initialBearing = startCameraRef.current.bearing;

        // Di chuyển ngang xoay mượt mà theo góc la bàn
        const newBearing = (initialBearing + dx * 0.45) % 360;

        // Xoay WebGL tự nhiên quanh chính tọa độ mặt đất được nhấn giữ (Bản đồ luôn đầy tràn 100% màn hình)
        map.easeTo({
          bearing: newBearing,
          pitch: 0,
          around: [lng, lat],
          duration: 0,
        });
      }
    };

    const handlePointerUp = () => {
      clearTimeout(holdTimerRef.current);

      if (isOrbitingRef.current) {
        isOrbitingRef.current = false;
        setIsOrbiting(false);
        setOrbitPivotScreen(null);
        map.dragPan.enable();

        // Giữ cờ didOrbit một chút để ngăn sự kiện click chọn nhầm thửa
        setTimeout(() => {
          didOrbitRef.current = false;
        }, 80);
      }
      startPointerRef.current = null;
    };

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      clearTimeout(holdTimerRef.current);
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  // 2. Cập nhật dữ liệu GeoJSON cho tất cả các thửa đất lên WebGL GPU
  useEffect(() => {
    const { geojson, mapStore, validList } = buildParcelsGeoJson(parcels);
    geojsonRef.current = geojson;
    validParcelsMapRef.current = mapStore;
    setDotsCount(validList.length);

    const map = mapRef.current;
    if (map) {
      syncParcelsToMap(map);
    }
  }, [parcels, syncParcelsToMap]);

  // 3. Bay tới và căn giữa thửa đất được chọn (Hỗ trợ định vị bù lề cho màn hình điện thoại)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedParcel?.lat || !selectedParcel?.lng) {
      lastCenteredParcelRef.current = null;
      return;
    }

    const forceZoom = (selectedParcel as any)._forceZoom;
    if (lastCenteredParcelRef.current !== selectedParcel.ma_thua || forceZoom) {
      lastCenteredParcelRef.current = selectedParcel.ma_thua;
      setIsFollowingUser(false);

      const targetZoom = Math.max(map.getZoom(), 18.5);
      let targetCenter: [number, number] = [selectedParcel.lng, selectedParcel.lat];

      // Bù lề khi mở khay kê khai / CCCD trên điện thoại di động
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
      if (isMobile && isBottomPanelActive) {
        try {
          const container = map.getContainer();
          const height = container.clientHeight || 800;
          const dy = height * 0.28;
          const centerScreen = map.project(targetCenter);
          const offsetScreen = { x: centerScreen.x, y: centerScreen.y + dy };
          const offsetCoord = map.unproject([offsetScreen.x, offsetScreen.y]);
          targetCenter = [offsetCoord.lng, offsetCoord.lat];
        } catch {
          targetCenter = [selectedParcel.lng, selectedParcel.lat];
        }
      }

      map.flyTo({
        center: targetCenter,
        zoom: targetZoom,
        duration: 800,
        essential: true,
      });
    }
  }, [selectedParcel, isBottomPanelActive]);

  // 4. Đánh dấu thửa đất đang chọn & các thửa gộp kèm theo (Radar Pulse Marker)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Xóa marker cũ
    if (selectedMarkerRef.current) {
      selectedMarkerRef.current.remove();
      selectedMarkerRef.current = null;
    }
    additionalMarkersRef.current.forEach((m) => m.remove());
    additionalMarkersRef.current = [];

    if (!selectedParcel?.lat || !selectedParcel?.lng) return;

    // Marker phát xung đỏ cho thửa chính
    const pulseEl = document.createElement('div');
    pulseEl.className = 'parcel-selected-pulse-wrapper';
    pulseEl.innerHTML = `
      <div class="parcel-selected-pulse"></div>
      <div style="position: absolute; top: 0; left: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; background: #dc2626; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 12px rgba(220, 38, 38, 0.9);"></div>
    `;

    const marker = new maplibregl.Marker({
      element: pulseEl,
      anchor: 'center',
    })
      .setLngLat([selectedParcel.lng, selectedParcel.lat])
      .addTo(map);

    selectedMarkerRef.current = marker;

    // Marker và đường nối cho các thửa gộp kèm theo
    const lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];

    if (additionalParcels && additionalParcels.length > 0) {
      additionalParcels.forEach((ap, idx) => {
        const match = validParcelsMapRef.current.get(ap.ma_thua);
        if (!match?.lat || !match?.lng) return;

        lineFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [selectedParcel.lng as number, selectedParcel.lat as number],
              [match.lng as number, match.lat as number],
            ],
          },
          properties: {
            color: '#f97316',
            width: 2.5,
          },
        });

        const addEl = document.createElement('div');
        addEl.className = 'parcel-additional-pulse-wrapper';
        addEl.style.cursor = 'pointer';
        addEl.innerHTML = `
          <div class="parcel-additional-pulse"></div>
          <div style="position: absolute; top: 0; left: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; background: #f97316; border: 2px solid #ffffff; border-radius: 50%;"></div>
          <span class="parcel-additional-badge">+${idx + 1}</span>
        `;
        addEl.onclick = () => onSelectParcelRef.current(match);

        const addMarker = new maplibregl.Marker({
          element: addEl,
          anchor: 'center',
        })
          .setLngLat([match.lng, match.lat])
          .addTo(map);

        additionalMarkersRef.current.push(addMarker);
      });
    }

    // Vẽ đường nối lên map
    const connSrc = map.getSource('connections-source') as maplibregl.GeoJSONSource;
    if (connSrc) {
      connSrc.setData({
        type: 'FeatureCollection',
        features: lineFeatures,
      });
    }
  }, [selectedParcel, additionalParcels]);

  // 5. Vẽ mạng lưới thửa lân cận xung quanh thửa được chọn
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    neighborMarkersRef.current.forEach((m) => m.remove());
    neighborMarkersRef.current = [];

    if (!selectedParcel?.lat || !selectedParcel?.lng || !neighborParcels || neighborParcels.length === 0) {
      return;
    }

    const neighborLineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];

    neighborParcels.slice(0, 8).forEach((nb) => {
      if (!nb.lat || !nb.lng) return;

      neighborLineFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [selectedParcel.lng as number, selectedParcel.lat as number],
            [nb.lng, nb.lat],
          ],
        },
        properties: {
          color: '#94a3b8',
          width: 1.5,
        },
      });

      const nbEl = document.createElement('div');
      nbEl.className = 'neighbor-label-badge';
      nbEl.style.cursor = 'pointer';
      const shortOwner = extractShortOwnerName(nb.chu_ho);
      nbEl.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid #38bdf8; border-radius: 6px; padding: 2px 6px; color: #fff; font-size: 10px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">
          ${nb.so_thua} • <span style="color: #38bdf8;">${shortOwner}</span>
        </div>
      `;
      nbEl.onclick = () => {
        const match = validParcelsMapRef.current.get(nb.ma_thua);
        if (match) onSelectParcelRef.current(match);
      };

      const nbMarker = new maplibregl.Marker({
        element: nbEl,
        anchor: 'bottom',
      })
        .setLngLat([nb.lng, nb.lat])
        .addTo(map);

      neighborMarkersRef.current.push(nbMarker);
    });

    const connSrc = map.getSource('connections-source') as maplibregl.GeoJSONSource;
    if (connSrc) {
      const existing = (connSrc as any)._data?.features || [];
      connSrc.setData({
        type: 'FeatureCollection',
        features: [...existing, ...neighborLineFeatures],
      });
    }
  }, [selectedParcel, neighborParcels]);

  // 6. Vị trí GPS người dùng di chuyển Realtime (Chế độ bám bước chân Google Maps)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      return;
    }

    if (!userMarkerRef.current) {
      const userEl = document.createElement('div');
      userEl.className = 'user-location-marker';
      userEl.innerHTML = `
        <div class="user-pulse"></div>
        <div style="position: absolute; top: 0; left: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; background: #2563eb; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 10px rgba(37, 99, 235, 0.8);"></div>
      `;

      userMarkerRef.current = new maplibregl.Marker({
        element: userEl,
        anchor: 'center',
      })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
    }

    if (isFollowingUser) {
      map.easeTo({
        center: [userLocation.lng, userLocation.lat],
        duration: 800,
      });
    }
  }, [userLocation, isFollowingUser]);

  // Bay tới vị trí GPS của người dùng
  const handleFlyToUserLocation = useCallback(() => {
    if (!userLocation) {
      if (onToggleLocation) onToggleLocation();
      return;
    }
    const map = mapRef.current;
    if (!map) return;

    setIsFollowingUser(true);
    map.flyTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: 18.5,
      duration: 1000,
      essential: true,
    });
  }, [userLocation, onToggleLocation]);

  // Xem toàn bộ xã Cư Pui
  const handleFitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    map.flyTo({
      center: [108.493, 12.527],
      zoom: 13,
      bearing: 0,
      duration: 800,
    });
  }, []);

  // Đặt lại hướng Bắc (North 0°)
  const handleResetNorth = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      bearing: 0,
      duration: 400,
      essential: true,
    });
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900 select-none">
      {/* VÙNG CHỨA BẢN ĐỒ WEBGL NATIVE (LUÔN TRÀN ĐẦY 100% MÀN HÌNH KHI XOAY) */}
      <div ref={mapContainerRef} className="w-full h-full bg-slate-900" />

      {/* TÂM NEO XOAY (HIỂN THỊ KHI NHẤN GIỮ ĐIỂM ĐỂ XOAY) */}
      {isOrbiting && orbitPivotScreen && (
        <div
          style={{
            left: `${orbitPivotScreen.x}px`,
            top: `${orbitPivotScreen.y}px`,
          }}
          className="pointer-events-none absolute z-[1200] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center animate-in fade-in zoom-in-75 duration-150"
        >
          <div className="relative flex items-center justify-center">
            <div className="w-14 h-14 rounded-full border-2 border-cyan-400 border-dashed animate-spin duration-7000"></div>
            <div className="absolute w-5 h-5 rounded-full bg-cyan-500/40 border-2 border-white shadow-[0_0_14px_rgba(6,182,212,1)] animate-ping"></div>
            <div className="absolute w-3.5 h-3.5 rounded-full bg-cyan-400 border-2 border-white shadow-md"></div>
          </div>
          <span className="mt-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-200 bg-slate-950/90 px-2.5 py-1 rounded-full border border-cyan-400/50 shadow-xl backdrop-blur-sm whitespace-nowrap">
            ⚓ Đang xoay quanh điểm
          </span>
        </div>
      )}

      {/* Tooltip khi rê chuột trên máy tính (luôn nằm ngang chuẩn xác, không xoay chữ) */}
      <div
        ref={hoverTooltipRef}
        style={{ display: 'none', top: 0, left: 0 }}
        className="pointer-events-none absolute z-[1100] bg-slate-900/95 border border-slate-700 px-3 py-2 rounded-xl shadow-2xl whitespace-nowrap backdrop-blur-md"
      />

      {/* Desktop Toolbar góc trên bên phải */}
      <div className="absolute top-4 right-4 z-[1000] hidden lg:flex items-center gap-2 bg-slate-900/85 backdrop-blur-md border border-slate-700 px-3 py-1.5 rounded-2xl shadow-xl text-xs">
        <button
          onClick={handleFitAll}
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold transition border border-slate-600/50 cursor-pointer text-slate-200"
        >
          <Maximize2 className="w-3.5 h-3.5 text-blue-400" /> Xem tất cả
        </button>

        {/* Nút La bàn (Compass) - Xoay theo hướng bản đồ, bấm vào để trả về hướng Bắc */}
        <button
          onClick={handleResetNorth}
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold transition border border-slate-600/50 cursor-pointer"
          title={bearing !== 0 ? `Bản đồ đang xoay ${Math.round(((bearing % 360) + 360) % 360)}°. Bấm để quay về hướng Bắc` : 'Hướng Bắc'}
        >
          <Compass
            className="w-3.5 h-3.5 text-rose-500 transition-transform duration-200"
            style={{ transform: `rotate(${-bearing}deg)` }}
          />
          {bearing !== 0 && (
            <span className="text-[11px] font-bold text-slate-300">
              {Math.round(((bearing % 360) + 360) % 360)}°
            </span>
          )}
        </button>

        <span className="text-slate-300 font-medium ml-1">
          Hiển thị: <strong className="text-emerald-400 font-black">{dotsCount.toLocaleString('vi-VN')}</strong> thửa
        </span>
      </div>

      {/* Chú giải các loại thửa đất (Desktop góc trên) */}
      <div className="absolute top-16 right-4 z-[1000] hidden lg:flex items-center gap-3 bg-slate-900/85 backdrop-blur-md border border-slate-700 px-3.5 py-1.5 rounded-2xl shadow-xl text-[11px] select-none">
        <span className="flex items-center gap-1.5 font-bold text-red-400">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-white" /> Đang chọn kê khai
        </span>
        {additionalParcels && additionalParcels.length > 0 && (
          <span className="flex items-center gap-1.5 font-bold text-orange-400">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500 ring-2 ring-white" /> Thửa gộp (+{additionalParcels.length})
          </span>
        )}
        <span className="flex items-center gap-1 text-emerald-300">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Đã số hóa
        </span>
        <span className="flex items-center gap-1 text-blue-300">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Đã kê khai
        </span>
        <span className="flex items-center gap-1 text-amber-300 font-semibold">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-1 ring-amber-600 shadow-sm" /> Có tên (chưa làm)
        </span>
        <span className="flex items-center gap-1 text-white font-semibold">
          <span className="w-2.5 h-2.5 rounded-full bg-white ring-1 ring-slate-400 shadow-sm" /> Không tên (chưa làm)
        </span>
      </div>

      {/* NÚT TRÒN ĐỊNH VỊ VỊ TRÍ ĐANG ĐỨNG (GOOGLE MAPS STYLE - BÁM BƯỚC CHÂN) */}
      <div className="absolute bottom-20 right-3.5 sm:bottom-24 sm:right-4 z-[1000] flex flex-col items-end gap-2">
        {bearing !== 0 && (
          <button
            type="button"
            onClick={handleResetNorth}
            className="w-10 h-10 rounded-full shadow-xl border border-slate-700 bg-slate-900/90 text-rose-500 flex items-center justify-center cursor-pointer transition active:scale-90"
            title="Bấm để quay về hướng Bắc"
          >
            <Compass
              className="w-5 h-5 transition-transform duration-200"
              style={{ transform: `rotate(${-bearing}deg)` }}
            />
          </button>
        )}
        {!userLocation && (
          <div
            onClick={handleFlyToUserLocation}
            className="bg-slate-900/90 border border-slate-700/80 px-2.5 py-1 rounded-full text-[10px] font-semibold text-slate-300 shadow-md flex items-center gap-1 cursor-pointer hover:bg-slate-800"
          >
            <LocateFixed className="w-3 h-3 text-blue-400" />
            <span>Định vị tôi</span>
          </div>
        )}
        <button
          type="button"
          onClick={handleFlyToUserLocation}
          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full shadow-xl border flex items-center justify-center active:scale-90 transition-all cursor-pointer ${
            isFollowingUser && userLocation
              ? 'bg-blue-600 text-white border-blue-400 ring-4 ring-blue-500/30'
              : 'bg-white text-blue-600 border-gray-200/90 hover:bg-blue-50'
          }`}
          title={
            isFollowingUser
              ? 'Đang tự bám theo vị trí của bạn'
              : userLocation
              ? 'Bấm để di chuyển tới vị trí của bạn'
              : 'Bật GPS định vị'
          }
        >
          {isLocating ? (
            <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin text-blue-500" />
          ) : (
            <LocateFixed
              className={`w-5 h-5 sm:w-6 sm:h-6 ${
                isFollowingUser && userLocation
                  ? 'text-white'
                  : userLocation
                  ? 'text-blue-600'
                  : 'text-slate-500'
              }`}
            />
          )}
        </button>
      </div>

      {/* Mobile Dot Count & Selection Badge */}
      <div className="absolute bottom-4 left-3 z-[1000] lg:hidden bg-slate-950/90 px-2.5 py-1 rounded-full text-[11px] font-bold text-white border border-slate-700/60 shadow-lg pointer-events-none flex items-center gap-2">
        {selectedParcel ? (
          <span className="flex items-center gap-1.5 text-red-400">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-white" />
            Thửa {selectedParcel.so_thua} ({selectedParcel.to_ban_do})
          </span>
        ) : (
          <span className="text-slate-300">
            <strong className="text-emerald-400">{dotsCount.toLocaleString('vi-VN')}</strong> thửa
          </span>
        )}
      </div>
    </div>
  );
}
