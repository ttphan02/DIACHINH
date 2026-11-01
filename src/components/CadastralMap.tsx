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
  RotateCcw,
  RotateCw,
  Globe,
  Mountain,
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

// Nguồn dữ liệu độ cao địa hình toàn cầu DEM (Digital Elevation Model)
const TERRAIN_DEM_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
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

  // Mặc định khởi tạo chế độ 3D Earth với địa hình đồi núi rõ rệt
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('3D');
  // Hệ số khuếch đại độ cao 3D (3.5x mặc định để thấy rõ đồi dốc ở quy mô thửa đất)
  const [elevationLevel, setElevationLevel] = useState<number>(3.5);
  const elevationLevelRef = useRef(elevationLevel);
  useEffect(() => {
    elevationLevelRef.current = elevationLevel;
  }, [elevationLevel]);
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

  // Chế độ xoay chuyên dụng (chạm hoặc nhấp chuột ở bất kỳ điểm nào để xoay quanh điểm đó)
  const [isRotateMode, setIsRotateMode] = useState<boolean>(false);
  const isRotateModeRef = useRef(isRotateMode);
  useEffect(() => {
    isRotateModeRef.current = isRotateMode;
    const map = mapRef.current;
    if (map) {
      if (isRotateMode) {
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'crosshair';
      } else {
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
      }
    }
  }, [isRotateMode]);

  // Markers tham chiếu
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const additionalMarkersRef = useRef<maplibregl.Marker[]>([]);
  const neighborMarkersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);

  const hoverTooltipRef = useRef<HTMLDivElement>(null);
  const lastCenteredParcelRef = useRef<string | null>(null);

  // Danh sách thửa đất hợp lệ được cache
  const validParcelsMapRef = useRef<Map<string, Parcel>>(new Map());
  const geojsonCacheRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>({
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

  // 1. Khởi tạo Bản đồ Google Earth với Địa hình 3D thực thụ (Digital Elevation Model)
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const initialTiles = satelliteType === 'hybrid' ? GOOGLE_EARTH_HYBRID : GOOGLE_EARTH_SATELLITE;
    const initialParsed = buildParcelsGeoJson(parcels);
    validParcelsMapRef.current = initialParsed.mapStore;
    geojsonCacheRef.current = initialParsed.geojson;
    setDotsCount(initialParsed.validList.length);

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
          'terrain-dem': {
            type: 'raster-dem',
            tiles: TERRAIN_DEM_TILES,
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
          },
          'parcels-source': {
            type: 'geojson',
            data: initialParsed.geojson,
            tolerance: 0,
            buffer: 0,
          },
          'connections-source': {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [],
            },
          },
        },
        layers: [
          // Lớp ảnh vệ tinh Google Earth
          {
            id: 'google-earth-layer',
            type: 'raster',
            source: 'google-earth',
            minzoom: 0,
            maxzoom: 22,
          },
          // Lớp đổ bóng địa hình quang học (Hillshade) làm nổi rõ mồn một các gờ núi, dốc cao và thung lũng thấp
          {
            id: 'terrain-hillshade',
            type: 'hillshade',
            source: 'terrain-dem',
            minzoom: 0,
            maxzoom: 22,
            paint: {
              'hillshade-exaggeration': 0.85,
              'hillshade-illumination-direction': 315,
              'hillshade-shadow-color': '#020617',
              'hillshade-highlight-color': '#ffffff',
              'hillshade-accent-color': '#0369a1',
            },
          },
          // Lớp đường nối thửa lân cận & thửa gộp
          {
            id: 'connections-line',
            type: 'line',
            source: 'connections-source',
            paint: {
              'line-color': ['get', 'color'],
              'line-width': ['get', 'width'],
              'line-dasharray': [2, 2],
              'line-opacity': 0.9,
            },
          },
          // Lớp hiển thị ~9.800 thửa đất WebGL nổi bật trên nền vệ tinh
          {
            id: 'parcels-layer',
            type: 'circle',
            source: 'parcels-source',
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                9,
                3.0,
                11,
                4.2,
                13,
                6.0,
                15,
                8.5,
                17,
                12.0,
                19,
                16.0,
                21,
                22.0,
              ],
              'circle-color': [
                'match',
                ['get', 'trang_thai'],
                'DA_SO_HOA_XANH',
                '#10b981', // Xanh lá: Đã số hóa
                'DA_KE_KHAI_CHUA_SO_HOA_LAM',
                '#2563eb', // Xanh lam: Đã kê khai
                'CO_TEN_CHUA_SO_HOA_VANG',
                '#f59e0b', // Vàng: Có tên chưa làm
                /* default */ '#ffffff', // Trắng: Không tên
              ],
              'circle-stroke-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                1.2,
                14,
                2.0,
                17,
                2.8,
              ],
              'circle-stroke-color': [
                'match',
                ['get', 'trang_thai'],
                'DA_SO_HOA_XANH',
                '#ffffff',
                'DA_KE_KHAI_CHUA_SO_HOA_LAM',
                '#ffffff',
                'CO_TEN_CHUA_SO_HOA_VANG',
                '#78350f',
                /* default */ '#1e293b',
              ],
              'circle-opacity': 1,
              'circle-pitch-alignment': 'viewport',
            },
          },
        ],
        // Địa hình 3D thực tế với độ lồi lõm (exaggeration) 3.5x giúp thấy rõ từng đỉnh đồi, khe suối
        terrain: {
          source: 'terrain-dem',
          exaggeration: 3.5,
        },
      },
      center: [108.493, 12.527],
      zoom: 13,
      pitch: 62, // Bắt đầu ở góc nghiêng 3D 62 độ sống động
      bearing: 0,
      maxPitch: 85,
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
      // Thiết lập bầu khí quyển chân trời Google Earth
      try {
        map.setSky({
          'sky-color': '#0284c7',
          'sky-horizon-blend': 0.5,
          'horizon-color': '#bae6fd',
          'fog-color': '#e0f2fe',
          'fog-ground-blend': 0.5,
        });
      } catch {
        // Fallback an toàn nếu trình duyệt không hỗ trợ sky
      }

      // Đảm bảo dữ liệu thửa đất luôn được đồng bộ ngay khi load xong
      const src = map.getSource('parcels-source') as maplibregl.GeoJSONSource;
      if (src && geojsonCacheRef.current) {
        src.setData(geojsonCacheRef.current);
      }

      // Xử lý click chọn thửa đất siêu nhạy qua WebGL Raycast
      map.on('click', (e) => {
        if (didOrbitRef.current) {
          didOrbitRef.current = false;
          return;
        }

        const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [e.point.x - 16, e.point.y - 16],
          [e.point.x + 16, e.point.y + 16],
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
  // TÍNH NĂNG XOAY BẢN ĐỒ: GIỮ 1 ĐIỂM RỒI DI CHUỘT / NGÓN TAY ĐỂ XOAY QUANH ĐIỂM (PIVOT ORBIT)
  // Hỗ trợ:
  // 1. Chế độ Xoay (Rotate Mode ON): Chạm / click bất kỳ điểm nào lập tức xoay quanh điểm đó
  // 2. Chuột phải (Right-click drag) hoặc Shift/Ctrl + Drag trên PC: Xoay lập tức quanh điểm đó
  // 3. Nhấn giữ 1 điểm (~180ms) trên Mobile / Desktop: Kích hoạt tâm xoay quanh điểm
  // 4. Cử chỉ 2 ngón tay xoay (Two-finger rotate) trên màn hình cảm ứng
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

    // Ngăn chặn menu ngữ cảnh chuột phải mặc định của trình duyệt để hỗ trợ kéo chuột phải xoay mượt mà
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    container.addEventListener('contextmenu', handleContextMenu);

    const activateOrbit = (pointX: number, pointY: number, clientX: number, clientY: number) => {
      let geoPivot: maplibregl.LngLat;
      try {
        geoPivot = map.unproject([pointX, pointY]);
      } catch {
        return;
      }

      startPointerRef.current = {
        x: clientX,
        y: clientY,
        lng: geoPivot.lng,
        lat: geoPivot.lat,
      };

      startCameraRef.current = {
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };

      isOrbitingRef.current = true;
      setIsOrbiting(true);
      didOrbitRef.current = true;

      // Khóa chức năng kéo bản đồ mặc định để xoay tự do quanh điểm
      map.dragPan.disable();

      // Rung nhẹ phản hồi xúc giác trên thiết bị di động
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(25);
      }

      // Đặt điểm neo trực quan
      setOrbitPivotScreen({ x: pointX, y: pointY });
    };

    const handlePointerDown = (e: PointerEvent) => {
      // Bỏ qua nếu có ngón thứ 2 chạm vào (để MapLibre xử lý cử chỉ 2 ngón tay thu phóng / xoay tự nhiên)
      if (e.pointerType === 'touch' && !e.isPrimary) {
        clearTimeout(holdTimerRef.current);
        return;
      }

      // Chỉ chấp nhận chuột trái (0) hoặc chuột phải (2)
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;

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

      // 1. KÍCH HOẠT XOAY NGAY LẬP TỨC nếu:
      // - Đang bật Chế độ Xoay (Rotate Mode ON)
      // - Dùng Chuột phải (e.button === 2)
      // - Hoặc giữ phím Shift / Ctrl
      const isInstantRotate =
        isRotateModeRef.current ||
        (e.pointerType === 'mouse' && e.button === 2) ||
        e.shiftKey ||
        e.ctrlKey;

      if (isInstantRotate) {
        activateOrbit(pointX, pointY, e.clientX, e.clientY);
        return;
      }

      // 2. Chế độ thường: Nhấn giữ ~180ms tại 1 điểm -> Kích hoạt chế độ Tâm xoay quanh điểm
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        activateOrbit(pointX, pointY, e.clientX, e.clientY);
      }, 180);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!startPointerRef.current) return;

      const dx = e.clientX - startPointerRef.current.x;
      const dy = e.clientY - startPointerRef.current.y;
      const dist = Math.hypot(dx, dy);

      // Nếu di chuyển quá xa trước khi kích hoạt -> Người dùng muốn kéo map bình thường, hủy hẹn giờ nhấn giữ
      const maxJitter = e.pointerType === 'touch' ? 24 : 14;
      if (!isOrbitingRef.current && dist > maxJitter) {
        clearTimeout(holdTimerRef.current);
        return;
      }

      // Đang trong chế độ xoay quanh điểm (Pivot Orbit)
      if (isOrbitingRef.current) {
        const { lng, lat } = startPointerRef.current;
        const initialBearing = startCameraRef.current.bearing;
        const initialPitch = startCameraRef.current.pitch;

        // Di ngang -> Xoay góc la bàn (bearing); Di dọc -> Thay đổi độ nghiêng phối cảnh 3D (pitch)
        const newBearing = initialBearing + dx * 0.45;
        const newPitch = Math.max(0, Math.min(80, initialPitch - dy * 0.35));

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

        if (!isRotateModeRef.current) {
          map.dragPan.enable();
        }

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
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  // 3. Cập nhật dữ liệu GeoJSON cho tất cả các thửa đất lên WebGL GPU khi parcels thay đổi
  useEffect(() => {
    const map = mapRef.current;
    const parsed = buildParcelsGeoJson(parcels);

    validParcelsMapRef.current = parsed.mapStore;
    geojsonCacheRef.current = parsed.geojson;
    setDotsCount(parsed.validList.length);

    if (!map) return;

    const syncData = () => {
      const src = map.getSource('parcels-source') as maplibregl.GeoJSONSource;
      if (src) {
        src.setData(parsed.geojson);
      }
    };

    if (map.getSource('parcels-source')) {
      syncData();
    } else {
      map.once('styledata', syncData);
      map.once('load', syncData);
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
      <div style="position: absolute; top: 0; left: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; background: #dc2626; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 14px rgba(220, 38, 38, 0.9);"></div>
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

  // Chuyển đổi giữa Chế độ 2D (phẳng) và 3D (Địa hình đồi núi thực thụ)
  const handleToggle2D3D = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (viewMode === '2D') {
      setViewMode('3D');
      // Kích hoạt địa hình 3D thực tế với độ cao khuếch đại để thấy rõ đỉnh núi, khe đồi
      map.setTerrain({ source: 'terrain-dem', exaggeration: elevationLevel });
      map.easeTo({
        pitch: 62,
        duration: 900,
      });
    } else {
      setViewMode('2D');
      // Tắt địa hình 3D để trở về bản đồ phẳng 2D chuẩn xác
      map.setTerrain(null);
      map.easeTo({
        pitch: 0,
        bearing: 0,
        duration: 800,
      });
    }
  }, [viewMode, elevationLevel]);

  // Tùy chỉnh mức độ nhấp nhô 3D (2.5x -> 3.5x -> 5.0x)
  const handleCycleElevation = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = elevationLevel === 2.5 ? 3.5 : elevationLevel === 3.5 ? 5.0 : 2.5;
    setElevationLevel(next);
    if (viewMode === '3D') {
      map.setTerrain({ source: 'terrain-dem', exaggeration: next });
    }
  }, [elevationLevel, viewMode]);

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
            <div className="w-16 h-16 rounded-full border-2 border-cyan-400 border-dashed animate-spin duration-7000"></div>
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
        {/* Nút bật/tắt Chế độ 2D & 3D Địa hình */}
        <button
          onClick={handleToggle2D3D}
          type="button"
          className={`px-3 py-1.5 rounded-2xl font-extrabold text-xs shadow-2xl border flex items-center gap-1.5 transition-all cursor-pointer backdrop-blur-md ${
            viewMode === '3D'
              ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white border-cyan-300 ring-2 ring-cyan-400/50 shadow-cyan-500/25'
              : 'bg-slate-900/90 text-slate-200 border-slate-700 hover:bg-slate-800'
          }`}
          title={viewMode === '3D' ? 'Đang ở chế độ 3D Địa hình Google Earth (Bấm để về 2D phẳng)' : 'Bấm để bật chế độ 3D Địa hình thực tế'}
        >
          {viewMode === '3D' ? (
            <Mountain className="w-3.5 h-3.5 text-cyan-200 animate-pulse" />
          ) : (
            <Box className="w-3.5 h-3.5 text-slate-400" />
          )}
          <span>{viewMode === '3D' ? '3D Địa hình' : '2D Phẳng'}</span>
        </button>

        {/* Nút bật/tắt Chế độ Xoay quanh điểm */}
        <button
          onClick={() => setIsRotateMode((prev) => !prev)}
          type="button"
          className={`px-3 py-1.5 rounded-2xl font-extrabold text-xs shadow-2xl border flex items-center gap-1.5 transition-all cursor-pointer backdrop-blur-md ${
            isRotateMode
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-300 ring-2 ring-amber-400/50 shadow-amber-500/30'
              : 'bg-slate-900/90 text-slate-200 border-slate-700 hover:bg-slate-800'
          }`}
          title={
            isRotateMode
              ? 'Đang bật Chế độ xoay quanh điểm (Bấm để tắt)'
              : 'Bật Chế độ xoay: Giữ 1 điểm rồi di chuột hoặc di ngón tay để xoay quanh điểm'
          }
        >
          <RotateCw className={`w-3.5 h-3.5 ${isRotateMode ? 'animate-spin duration-3000 text-white' : 'text-amber-400'}`} />
          <span>{isRotateMode ? 'Đang bật Xoay ⚓' : 'Xoay bản đồ'}</span>
        </button>

        {/* Nút tăng giảm độ nhấp nhô đồi núi 3D (2.5x -> 3.5x -> 5.0x) */}
        {viewMode === '3D' && (
          <button
            onClick={handleCycleElevation}
            type="button"
            className="hidden xs:flex items-center gap-1 px-2.5 py-1.5 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-cyan-500/40 text-cyan-200 text-xs font-bold shadow-xl cursor-pointer transition backdrop-blur-md"
            title="Bấm để tăng độ cao nhấp nhô đồi núi (2.5x -> 3.5x -> 5.0x)"
          >
            <Mountain className="w-3.5 h-3.5 text-cyan-400" />
            <span>Độ nổi {elevationLevel}x</span>
          </button>
        )}

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

      {/* THÔNG BÁO HƯỚNG DẪN KHI BẬT CHẾ ĐỘ XOAY */}
      {isRotateMode && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[1100] bg-gradient-to-r from-amber-600/95 to-orange-600/95 border border-amber-300/60 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-2xl backdrop-blur-md flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <RotateCw className="w-4 h-4 animate-spin duration-3000" />
          <span>Chạm giữ 1 điểm trên bản đồ rồi di ngón tay / chuột để xoay</span>
          <button
            onClick={() => setIsRotateMode(false)}
            className="ml-2 bg-black/30 hover:bg-black/50 text-white px-2 py-0.5 rounded-full text-[11px] font-black cursor-pointer"
          >
            Tắt
          </button>
        </div>
      )}

      {/* GỢI Ý THAO TÁC XOAY */}
      {!isRotateMode && !isOrbiting && (
        <div className="absolute top-[98px] right-3.5 z-[1000] hidden sm:flex items-center gap-1.5 bg-slate-950/85 border border-cyan-500/40 text-cyan-200 text-[11px] px-3 py-1 rounded-full shadow-lg backdrop-blur-md pointer-events-none animate-in fade-in slide-in-from-top-1">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
          <span>Giữ 1 điểm rồi di chuột / ngón tay để xoay (hoặc bật nút Xoay bản đồ)</span>
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
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-1 ring-white" /> Đã số hóa
        </span>
        <span className="flex items-center gap-1 text-blue-300">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 ring-1 ring-white" /> Đã kê khai
        </span>
        <span className="flex items-center gap-1 text-amber-300 font-semibold">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-1 ring-amber-700 shadow-sm" /> Có tên (chưa làm)
        </span>
        <span className="flex items-center gap-1 text-white font-semibold">
          <span className="w-2.5 h-2.5 rounded-full bg-white ring-1 ring-slate-700 shadow-sm" /> Không tên (chưa làm)
        </span>
      </div>

      {/* NÚT TRÒN TIỆN ÍCH XOAY & ĐỊNH VỊ GPS VỊ TRÍ ĐANG ĐỨNG (GOOGLE EARTH STYLE) */}
      <div className="absolute bottom-20 right-3.5 sm:bottom-24 sm:right-4 z-[1000] flex flex-col items-end gap-2">
        {/* Nút tròn Chế độ Xoay quanh điểm */}
        <button
          type="button"
          onClick={() => setIsRotateMode((prev) => !prev)}
          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full shadow-2xl border flex items-center justify-center active:scale-90 transition-all cursor-pointer ${
            isRotateMode
              ? 'bg-gradient-to-tr from-amber-500 to-orange-500 text-white border-amber-300 ring-4 ring-amber-500/40 shadow-amber-500/40'
              : 'bg-slate-900/90 text-amber-400 border-slate-700 hover:bg-slate-800'
          }`}
          title={
            isRotateMode
              ? 'Chế độ xoay quanh điểm đang BẬT: Chạm 1 điểm rồi di tay để xoay (Bấm để tắt)'
              : 'Bật Chế độ xoay: Giữ 1 điểm rồi di chuột / ngón tay để xoay quanh điểm'
          }
        >
          <RotateCw className={`w-5 h-5 ${isRotateMode ? 'animate-spin duration-3000 text-white' : 'text-amber-400'}`} />
        </button>

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
            <Mountain className="w-3.5 h-3.5 text-cyan-400" />
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
