'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Parcel, NeighborParcel, AdditionalParcel } from '@/types';
import { extractShortOwnerName } from '@/utils/geo';
import {
  Maximize2,
  LocateFixed,
  Loader2,
  Compass,
  Box,
  Layers,
  RotateCcw,
  RotateCw,
  Globe,
} from 'lucide-react';
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

// Google Earth Tile URLs
const GOOGLE_EARTH_HYBRID = [
  'https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  'https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  'https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
];

const GOOGLE_EARTH_SATELLITE = [
  'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
];

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

  // Chế độ xem: 2D (phẳng) hoặc 3D (Google Earth nghiêng phối cảnh)
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('2D');
  // Góc xoay hiện tại (độ) để hiển thị la bàn
  const [bearing, setBearing] = useState<number>(0);
  // Loại lớp vệ tinh Google Earth: Hybrid (có đường/nhãn) hoặc Pure (ảnh thuần túy)
  const [satelliteType, setSatelliteType] = useState<'hybrid' | 'pure'>('hybrid');
  // Số thửa hợp lệ hiển thị
  const [dotsCount, setDotsCount] = useState(0);
  // Chế độ tự động bám theo bước chân GPS
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  // Trạng thái đang xoay quanh điểm 3D
  const [isOrbiting, setIsOrbiting] = useState(false);
  // Tọa độ điểm neo xoay 3D (hiển thị tâm neo trên màn hình)
  const [orbitPivotScreen, setOrbitPivotScreen] = useState<{ x: number; y: number } | null>(null);

  // Markers tham chiếu để không tạo lại DOM không cần thiết
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const additionalMarkersRef = useRef<maplibregl.Marker[]>([]);
  const neighborMarkersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const pivotMarkerRef = useRef<maplibregl.Marker | null>(null);

  const hoverTooltipRef = useRef<HTMLDivElement>(null);
  const lastCenteredParcelRef = useRef<string | null>(null);

  // Danh sách thửa đất hợp lệ được cache
  const validParcelsMapRef = useRef<Map<string, Parcel>>(new Map());

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

  // 1. Khởi tạo Bản đồ Google Earth với MapLibre GL
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const initialTiles = satelliteType === 'hybrid' ? GOOGLE_EARTH_HYBRID : GOOGLE_EARTH_SATELLITE;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          'google-earth': {
            type: 'raster',
            tiles: initialTiles,
            tileSize: 256,
            maxzoom: 21,
            attribution: '&copy; Google Earth',
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
      maxPitch: 80,
      attributionControl: false,
      trackResize: true,
      dragRotate: true,
      touchPitch: true,
      touchZoomRotate: true,
    });

    mapRef.current = map;

    // Lắng nghe thay đổi góc xoay & góc nghiêng
    const updateBearingPitch = () => {
      const b = Math.round(map.getBearing());
      setBearing(b);
      const p = map.getPitch();
      if (p >= 20 && viewMode !== '3D') {
        setViewMode('3D');
      } else if (p < 5 && viewMode !== '2D') {
        setViewMode('2D');
      }
    };

    map.on('rotate', updateBearingPitch);
    map.on('pitch', updateBearingPitch);

    map.on('dragstart', () => {
      setIsFollowingUser(false);
      if (hoverTooltipRef.current) {
        hoverTooltipRef.current.style.display = 'none';
      }
    });

    map.on('load', () => {
      // 1. Thêm nguồn GeoJSON cho toàn bộ các thửa đất
      map.addSource('parcels-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
        tolerance: 0,
        buffer: 0,
      });

      // 2. Thêm layer vòng tròn hiển thị thửa đất tối ưu phần cứng WebGL
      map.addLayer({
        id: 'parcels-layer',
        type: 'circle',
        source: 'parcels-source',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            2.5,
            13,
            4.2,
            15,
            6.2,
            17,
            8.8,
            19,
            12.5,
            21,
            16,
          ],
          'circle-color': [
            'match',
            ['get', 'trang_thai'],
            'DA_SO_HOA_XANH',
            '#10b981', // Xanh lá: Đã số hóa
            'DA_KE_KHAI_CHUA_SO_HOA_LAM',
            '#2563eb', // Xanh lam: Đã kê khai
            'CO_TEN_CHUA_SO_HOA_VANG',
            '#eab308', // Vàng: Có tên chưa làm
            /* default */ '#ffffff', // Trắng: Không tên
          ],
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            0.8,
            14,
            1.5,
            17,
            2.2,
          ],
          'circle-stroke-color': [
            'match',
            ['get', 'trang_thai'],
            'DA_SO_HOA_XANH',
            '#064e3b',
            'DA_KE_KHAI_CHUA_SO_HOA_LAM',
            '#1e3a8a',
            'CO_TEN_CHUA_SO_HOA_VANG',
            '#713f12',
            /* default */ '#475569',
          ],
          'circle-opacity': 0.95,
          'circle-pitch-alignment': 'viewport',
        },
      });

      // 3. Nguồn và Layer vẽ đường nối thửa lân cận & thửa gộp
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

      // 4. Xử lý click chọn thửa đất siêu nhạy qua WebGL Raycast
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

      // 5. Xử lý rê chuột (hover) trên Desktop
      map.on('mousemove', 'parcels-layer', (e) => {
        if (isTouchDeviceRef.current) return;
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
  }, []);

  // 2. Chuyển đổi lớp vệ tinh Google Earth (Hybrid <-> Pure)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource('google-earth') as any;
    if (source && source.setTiles) {
      const tiles = satelliteType === 'hybrid' ? GOOGLE_EARTH_HYBRID : GOOGLE_EARTH_SATELLITE;
      source.setTiles(tiles);
    }
  }, [satelliteType]);

  // ============================================================================
  // TÍNH NĂNG ĐỘC QUYỀN GOOGLE EARTH: NHẤN GIỮ 1 ĐIỂM RỒI DI CHUỘT / NGÓN TAY ĐỂ XOAY 3D (PIVOT ORBIT)
  // ============================================================================
  const holdTimerRef = useRef<any>(null);
  const startPointerRef = useRef<{ x: number; y: number; lng: number; lat: number } | null>(null);
  const startCameraRef = useRef<{ bearing: number; pitch: number }>({ bearing: 0, pitch: 0 });
  const isOrbitingRef = useRef<boolean>(false);
  const didOrbitRef = useRef<boolean>(false);

  useEffect(() => {
    const container = mapContainerRef.current;
    const map = mapRef.current;
    if (!container || !map) return;

    const handlePointerDown = (e: PointerEvent) => {
      // Chỉ kích hoạt chế độ xoay quanh điểm khi dùng chuột trái hoặc ngón tay cảm ứng
      if (e.button !== 0 && e.pointerType === 'mouse') return;

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
        pitch: map.getPitch(),
      };

      didOrbitRef.current = false;

      // Nhấn giữ 200ms -> Kích hoạt chế độ Tâm xoay 3D (Pivot Orbit)
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        isOrbitingRef.current = true;
        setIsOrbiting(true);
        didOrbitRef.current = true;

        // Nếu đang ở 2D, tự động nghiêng lên 55° góc nhìn 3D Google Earth
        if (map.getPitch() < 15) {
          map.easeTo({ pitch: 55, duration: 400 });
        }

        // Khóa chức năng kéo bản đồ mặc định để xoay tự do quanh điểm
        map.dragPan.disable();

        // Rung nhẹ phản hồi xúc giác trên thiết bị di động
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(25);
        }

        // Đặt điểm neo trực quan
        setOrbitPivotScreen({ x: pointX, y: pointY });
      }, 200);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!startPointerRef.current) return;

      const dx = e.clientX - startPointerRef.current.x;
      const dy = e.clientY - startPointerRef.current.y;
      const dist = Math.hypot(dx, dy);

      // Nếu di chuyển nhanh trước 200ms -> Người dùng muốn kéo map bình thường, hủy hẹn giờ nhấn giữ
      if (!isOrbitingRef.current && dist > 8) {
        clearTimeout(holdTimerRef.current);
        return;
      }

      // Đang trong chế độ xoay 3D quanh điểm (Pivot Orbit)
      if (isOrbitingRef.current) {
        const { lng, lat } = startPointerRef.current;
        const initialBearing = startCameraRef.current.bearing;
        const initialPitch = startCameraRef.current.pitch;

        // Di ngang -> Xoay góc la bàn (bearing); Di dọc -> Thay đổi độ nghiêng phối cảnh 3D (pitch)
        const newBearing = (initialBearing + dx * 0.45) % 360;
        const newPitch = Math.max(0, Math.min(78, initialPitch - dy * 0.35));

        // Xoay camera tự nhiên quanh chính tọa độ mặt đất được nhấn giữ
        map.easeTo({
          bearing: newBearing,
          pitch: newPitch,
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

        // Giữ cờ didOrbit một chút để ngăn sự kiện click chọn nhầm thửa khi vừa nhấc ngón tay
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

  // 3. Cập nhật dữ liệu GeoJSON cho tất cả các thửa đất lên WebGL GPU
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const validParcels = parcels.filter((p) => {
      if (!p.lat || !p.lng || HIDDEN_PARCEL_SET.has(p.ma_thua)) return false;
      const ld = (p.loai_dat || '').trim().toUpperCase();
      if (ld === 'BCS') {
        const dt = parseFloat(String(p.dien_tich || '').replace(',', '.'));
        if (!isNaN(dt) && dt < 100) return false;
      }
      return true;
    });

    const mapStore = new Map<string, Parcel>();
    validParcels.forEach((p) => mapStore.set(p.ma_thua, p));
    validParcelsMapRef.current = mapStore;
    setDotsCount(validParcels.length);

    const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: validParcels.map((p) => ({
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
      })),
    };

    const updateSource = () => {
      const src = map.getSource('parcels-source') as maplibregl.GeoJSONSource;
      if (src) {
        src.setData(geojson);
      }
    };

    if (map.isStyleLoaded()) {
      updateSource();
    } else {
      map.once('load', updateSource);
    }
  }, [parcels]);

  // 4. Bay tới và căn giữa thửa đất được chọn (Hỗ trợ định vị bù lề cho màn hình điện thoại)
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

  // 5. Đánh dấu thửa đất đang chọn & các thửa gộp kèm theo (Radar Pulse Marker)
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

  // 6. Vẽ mạng lưới thửa lân cận xung quanh thửa được chọn
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
          color: '#0284c7',
          width: 2,
        },
      });

      const shortName = extractShortOwnerName(nb.chu_ho);
      const ringEl = document.createElement('div');
      ringEl.className = 'neighbor-badge-wrapper';
      ringEl.innerHTML = `
        <div style="position: absolute; top: 0; left: 0; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; border: 2px dashed #0284c7; background: rgba(56, 189, 248, 0.25);"></div>
        ${shortName ? `<span class="neighbor-name-badge">${shortName}</span>` : ''}
      `;
      ringEl.onclick = () => onSelectParcelRef.current(nb);

      const nbMarker = new maplibregl.Marker({
        element: ringEl,
        anchor: 'center',
      })
        .setLngLat([nb.lng, nb.lat])
        .addTo(map);

      neighborMarkersRef.current.push(nbMarker);
    });

    // Cập nhật đường nối lân cận vào connection source
    const connSrc = map.getSource('connections-source') as maplibregl.GeoJSONSource;
    if (connSrc) {
      const existing = (connSrc as any)._data?.features || [];
      connSrc.setData({
        type: 'FeatureCollection',
        features: [...existing, ...neighborLineFeatures],
      });
    }
  }, [selectedParcel, neighborParcels]);

  // 7. Vị trí GPS người dùng di chuyển Realtime (Chế độ bám bước chân Google Maps)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!userLocation) {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      return;
    }

    const { lat, lng } = userLocation;

    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat([lng, lat]);
      if (isFollowingUser) {
        map.easeTo({ center: [lng, lat], duration: 400 });
      }
      return;
    }

    const locEl = document.createElement('div');
    locEl.className = 'user-ggm-wrapper';
    locEl.innerHTML = `
      <div class="user-ggm-location">
        <div class="user-ggm-pulse"></div>
        <div class="user-ggm-dot"></div>
      </div>
    `;

    const marker = new maplibregl.Marker({
      element: locEl,
      anchor: 'center',
    })
      .setLngLat([lng, lat])
      .addTo(map);

    userMarkerRef.current = marker;

    if (isFollowingUser) {
      map.easeTo({ center: [lng, lat], duration: 400 });
    }
  }, [userLocation, isFollowingUser]);

  // Chuyển đổi giữa Chế độ 2D và 3D
  const handleToggle2D3D = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (viewMode === '2D') {
      setViewMode('3D');
      map.easeTo({
        pitch: 60,
        duration: 900,
      });
    } else {
      setViewMode('2D');
      map.easeTo({
        pitch: 0,
        bearing: 0,
        duration: 800,
      });
    }
  }, [viewMode]);

  // Bấm vào la bàn: Reset góc xoay về hướng Bắc (0 độ)
  const handleResetNorth = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      bearing: 0,
      duration: 600,
    });
  }, []);

  // Xoay nhanh bản đồ trái / phải
  const handleRotateStep = useCallback((direction: 'left' | 'right') => {
    const map = mapRef.current;
    if (!map) return;
    const currentBearing = map.getBearing();
    const delta = direction === 'left' ? -45 : 45;
    map.easeTo({
      bearing: currentBearing + delta,
      duration: 500,
    });
  }, []);

  // Chuyển đổi loại ảnh vệ tinh Google Earth (Hybrid <-> Pure)
  const handleToggleSatelliteType = useCallback(() => {
    setSatelliteType((prev) => (prev === 'hybrid' ? 'pure' : 'hybrid'));
  }, []);

  // Thu phóng vừa toàn bộ các thửa
  const handleFitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const list = Array.from(validParcelsMapRef.current.values());
    if (list.length === 0) return;

    setIsFollowingUser(false);
    const bounds = new maplibregl.LngLatBounds();
    list.forEach((p) => {
      bounds.extend([p.lng as number, p.lat as number]);
    });

    map.fitBounds(bounds, {
      padding: { top: 60, bottom: 60, left: 60, right: 60 },
      maxZoom: 16.5,
      duration: 900,
    });
  }, []);

  // Định vị GPS người dùng
  const handleFlyToUserLocation = useCallback(() => {
    setIsFollowingUser(true);
    const map = mapRef.current;
    if (map && userLocation?.lat && userLocation?.lng) {
      map.flyTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: Math.max(map.getZoom(), 18),
        duration: 800,
      });
    } else if (onToggleLocation) {
      onToggleLocation();
    }
  }, [userLocation, onToggleLocation]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950 select-none">
      {/* Vùng chứa bản đồ WebGL Google Earth 3D */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* TÂM NEO XOAY 3D (HIỂN THỊ KHI NHẤN GIỮ ĐIỂM ĐỂ XOAY) */}
      {isOrbiting && orbitPivotScreen && (
        <div
          style={{
            left: `${orbitPivotScreen.x}px`,
            top: `${orbitPivotScreen.y}px`,
          }}
          className="pointer-events-none absolute z-[1200] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center animate-in fade-in zoom-in-75 duration-150"
        >
          <div className="relative flex items-center justify-center">
            {/* Vòng quay xung quanh điểm neo */}
            <div className="w-16 h-16 rounded-full border-2 border-cyan-400 border-dashed animate-spin duration-7000"></div>
            {/* Vòng tâm phát sáng */}
            <div className="absolute w-6 h-6 rounded-full bg-cyan-500/40 border-2 border-white shadow-[0_0_16px_rgba(6,182,212,1)] animate-ping"></div>
            <div className="absolute w-3.5 h-3.5 rounded-full bg-cyan-400 border-2 border-white shadow-md"></div>
          </div>
          <span className="mt-2 text-[10px] font-black uppercase tracking-wider text-cyan-200 bg-slate-950/90 px-2.5 py-1 rounded-full border border-cyan-400/50 shadow-xl backdrop-blur-sm whitespace-nowrap">
            ⚓ Đang xoay quanh điểm
          </span>
        </div>
      )}

      {/* Tooltip khi rê chuột trên Desktop */}
      <div
        ref={hoverTooltipRef}
        style={{ display: 'none', top: 0, left: 0 }}
        className="pointer-events-none absolute z-[1100] bg-slate-900/95 border border-slate-700 px-3 py-2 rounded-xl shadow-2xl whitespace-nowrap backdrop-blur-md"
      />

      {/* BỘ ĐIỀU KHIỂN GOOGLE EARTH 2D / 3D & LA BÀN XOAY (GÓC TRÊN BÊN PHẢI) */}
      <div className="absolute top-[56px] right-3.5 z-[1000] flex items-center gap-2">
        {/* Nút bật/tắt Chế độ 2D & 3D */}
        <button
          onClick={handleToggle2D3D}
          type="button"
          className={`px-3 py-1.5 rounded-2xl font-extrabold text-xs shadow-2xl border flex items-center gap-1.5 transition-all cursor-pointer backdrop-blur-md ${
            viewMode === '3D'
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white border-cyan-300 ring-2 ring-cyan-400/40 shadow-cyan-500/20'
              : 'bg-slate-900/90 text-slate-200 border-slate-700 hover:bg-slate-800'
          }`}
          title={viewMode === '3D' ? 'Đang ở chế độ 3D Earth (Bấm để về 2D phẳng)' : 'Bấm để bật chế độ xem phối cảnh 3D Earth'}
        >
          <Box className={`w-3.5 h-3.5 ${viewMode === '3D' ? 'text-cyan-200 animate-pulse' : 'text-slate-400'}`} />
          <span>{viewMode === '3D' ? '3D Earth' : '2D Map'}</span>
        </button>

        {/* Nút La bàn (Compass) - Xoay tự động theo góc nhìn, bấm để về Bắc */}
        <button
          onClick={handleResetNorth}
          type="button"
          className="w-8 h-8 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-white flex items-center justify-center shadow-xl cursor-pointer transition backdrop-blur-md"
          title={`Góc xoay: ${bearing}°. Bấm để quay về hướng Bắc`}
        >
          <Compass
            className="w-4 h-4 text-rose-500 transition-transform duration-200"
            style={{ transform: `rotate(${-bearing}deg)` }}
          />
        </button>

        {/* Nút xoay nhanh 45 độ */}
        <div className="hidden sm:flex items-center bg-slate-900/90 border border-slate-700 rounded-2xl shadow-xl overflow-hidden backdrop-blur-md">
          <button
            onClick={() => handleRotateStep('left')}
            className="p-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
            title="Xoay trái 45°"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="w-[1px] h-4 bg-slate-700"></div>
          <button
            onClick={() => handleRotateStep('right')}
            className="p-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
            title="Xoay phải 45°"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Chuyển loại ảnh Google Earth (Hybrid <-> Pure Satellite) */}
        <button
          onClick={handleToggleSatelliteType}
          type="button"
          className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold shadow-xl cursor-pointer transition backdrop-blur-md"
          title={satelliteType === 'hybrid' ? 'Đang hiển thị vệ tinh có tên đường (Bấm để xem ảnh vệ tinh thuần túy)' : 'Đang xem ảnh vệ tinh thuần túy (Bấm để hiện tên đường)'}
        >
          <Globe className="w-3.5 h-3.5 text-emerald-400" />
          <span>{satelliteType === 'hybrid' ? 'Earth Hybrid' : 'Earth Thuần'}</span>
        </button>

        {/* Nút Xem tất cả (Fit Bounds) */}
        <button
          onClick={handleFitBounds}
          className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-white shadow-xl transition cursor-pointer backdrop-blur-md"
          title="Thu phóng vừa toàn bộ các thửa"
        >
          <Maximize2 className="w-3.5 h-3.5 text-blue-400" />
          <span>Xem tất cả</span>
        </button>
      </div>

      {/* GỢI Ý THAO TÁC 3D (NHẤN GIỮ ĐỂ XOAY) */}
      {viewMode === '3D' && !isOrbiting && (
        <div className="absolute top-[98px] right-3.5 z-[1000] hidden sm:flex items-center gap-1.5 bg-slate-950/80 border border-cyan-500/30 text-cyan-200 text-[11px] px-3 py-1 rounded-full shadow-lg backdrop-blur-md pointer-events-none animate-in fade-in slide-in-from-top-1">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
          <span>Nhấn giữ 1 điểm trên bản đồ rồi di tay để xoay 3D</span>
        </div>
      )}

      {/* BẢNG CHÚ THÍCH MÀU SẮC TRẠNG THÁI THỬA ĐẤT (DESKTOP) */}
      <div className="absolute top-[132px] right-3.5 z-[1000] hidden lg:flex items-center gap-2.5 bg-slate-950/90 px-3.5 py-1.5 rounded-2xl shadow-xl border border-slate-700/60 text-[11px] text-slate-200 select-none backdrop-blur-md">
        <span className="flex items-center gap-1.5 font-bold text-red-400">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-white" /> Đang chọn
        </span>
        {additionalParcels && additionalParcels.length > 0 && (
          <span className="flex items-center gap-1.5 font-bold text-orange-400">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500 ring-2 ring-white" /> Thửa gộp ({additionalParcels.length})
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

      {/* NÚT TRÒN ĐỊNH VỊ GPS VỊ TRÍ ĐANG ĐỨNG (GOOGLE EARTH STYLE - BÁM BƯỚC CHÂN) */}
      <div className="absolute bottom-20 right-3.5 sm:bottom-24 sm:right-4 z-[1000] flex flex-col items-end gap-1.5">
        {!userLocation && (
          <div
            onClick={handleFlyToUserLocation}
            className="cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-[11px] font-extrabold px-3 py-1.5 rounded-2xl shadow-xl border border-emerald-400/50 flex items-center gap-1.5 animate-bounce active:scale-95 transition"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
            <span>Chạm để Bật GPS</span>
          </div>
        )}
        <button
          type="button"
          onClick={handleFlyToUserLocation}
          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full shadow-2xl border flex items-center justify-center active:scale-90 transition-all cursor-pointer ${
            isFollowingUser && userLocation
              ? 'bg-blue-600 text-white border-blue-400 ring-4 ring-blue-500/30'
              : 'bg-slate-900/90 text-blue-400 border-slate-700 hover:bg-slate-800'
          }`}
          title={
            isFollowingUser
              ? 'Đang tự động di chuyển bản đồ theo bước chân của bạn'
              : 'Bấm để đưa tâm bản đồ về vị trí hiện tại và bám theo bước chân'
          }
        >
          {isLocating && !userLocation ? (
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          ) : (
            <LocateFixed
              className={`w-5 h-5 ${
                isFollowingUser && userLocation
                  ? 'text-white'
                  : userLocation
                  ? 'text-blue-400'
                  : 'text-slate-400'
              }`}
            />
          )}
        </button>
      </div>

      {/* MOBILE THỐNG KÊ SỐ LƯỢNG THỬA & CHẾ ĐỘ GOOGLE EARTH */}
      <div className="absolute bottom-4 left-3 z-[1000] lg:hidden bg-slate-950/90 px-3 py-1.5 rounded-full text-[11px] font-bold text-white border border-slate-700/60 shadow-lg pointer-events-none flex items-center gap-2 backdrop-blur-md">
        {selectedParcel ? (
          <span className="flex items-center gap-1.5 text-red-400">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-white" />
            <span>Thửa {selectedParcel.so_thua} (Đang chọn)</span>
            {additionalParcels && additionalParcels.length > 0 && (
              <span className="text-orange-400 ml-1">+{additionalParcels.length} thửa gộp</span>
            )}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>{dotsCount.toLocaleString('vi-VN')} thửa</span>
            <span className="text-slate-500">•</span>
            <span className={viewMode === '3D' ? 'text-cyan-400 font-extrabold' : 'text-slate-400'}>
              {viewMode} Earth
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
