'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Parcel, NeighborParcel } from '@/types';
import {
  extractShortOwnerName,
  calculateDistanceMeters,
  calculateBearing,
  getCompassInfo,
  formatDistance,
  getDirectionsUrl,
} from '@/utils/geo';
import {
  Layers,
  Maximize2,
  Navigation,
  Compass,
  LocateFixed,
  Locate,
  Loader2,
  ExternalLink,
  MapPin,
  Crosshair,
} from 'lucide-react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';

interface CadastralMapProps {
  parcels: Parcel[];
  onSelectParcel: (parcel: Parcel) => void;
  selectedParcel: Parcel | null;
  neighborParcels?: NeighborParcel[];
  userLocation?: { lat: number; lng: number; accuracy: number } | null;
  isTracking?: boolean;
  isLocating?: boolean;
  onToggleLocation?: () => void;
  onFindNearestParcel?: () => void;
}

export default function CadastralMap({
  parcels,
  onSelectParcel,
  selectedParcel,
  neighborParcels = [],
  userLocation,
  isTracking = false,
  isLocating = false,
  onToggleLocation,
  onFindNearestParcel,
}: CadastralMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const neighborsLayerRef = useRef<LayerGroup | null>(null);
  const userLocationLayerRef = useRef<LayerGroup | null>(null);
  const navigationLayerRef = useRef<LayerGroup | null>(null);
  const tileLayerRef = useRef<any>(null);
  const [mapType, setMapType] = useState<'hybrid' | 'streets'>('hybrid');
  const [dotsCount, setDotsCount] = useState(0);

  // 1. Khởi tạo Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isCancelled = false;

    import('leaflet').then((L) => {
      if (isCancelled || !mapContainerRef.current) return;

      if ((mapContainerRef.current as any)._leaflet_id) {
        return;
      }

      const leafletMap = L.map(mapContainerRef.current, {
        center: [12.527, 108.493],
        zoom: 13,
        zoomControl: false,
        preferCanvas: true,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);

      const tileUrl =
        mapType === 'hybrid'
          ? 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'
          : 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';

      const tile = L.tileLayer(tileUrl, {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps',
      }).addTo(leafletMap);

      tileLayerRef.current = tile;

      // LayerGroup cho các thửa đất
      const layerGroup = L.layerGroup().addTo(leafletMap);
      layerGroupRef.current = layerGroup;

      // LayerGroup cho mạng lưới thửa lân cận
      const neighborsLayer = L.layerGroup().addTo(leafletMap);
      neighborsLayerRef.current = neighborsLayer;

      // LayerGroup cho vị trí GPS người dùng
      const userLocationLayer = L.layerGroup().addTo(leafletMap);
      userLocationLayerRef.current = userLocationLayer;

      // LayerGroup cho đường dẫn lộ trình điều hướng
      const navigationLayer = L.layerGroup().addTo(leafletMap);
      navigationLayerRef.current = navigationLayer;

      setMap(leafletMap);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Tự động thích ứng kích thước bản đồ
  useEffect(() => {
    if (!map || !mapContainerRef.current) return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(mapContainerRef.current);
    return () => observer.disconnect();
  }, [map]);

  // 2. Chuyển đổi lớp bản đồ Google Vệ Tinh / Đường
  useEffect(() => {
    if (!tileLayerRef.current || !map) return;
    const tileUrl =
      mapType === 'hybrid'
        ? 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'
        : 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
    tileLayerRef.current.setUrl(tileUrl);
  }, [mapType, map]);

  // 3. Vẽ tất cả các dấu chấm thửa đất lên bản đồ
  useEffect(() => {
    if (!map || !layerGroupRef.current) return;

    let isMounted = true;

    import('leaflet').then((L) => {
      if (!isMounted) return;
      const layerGroup = layerGroupRef.current;
      if (!layerGroup) return;

      layerGroup.clearLayers();

      const validParcels = parcels.filter((p) => p.lat && p.lng);
      setDotsCount(validParcels.length);

      if (validParcels.length === 0) return;

      validParcels.forEach((p) => {
        const lat = p.lat as number;
        const lng = p.lng as number;

        let color = '#374151'; // Viền đen xám
        let fillColor = '#ffffff'; // Ruột trắng sáng (Chưa có tên)
        let radius = 6;
        let weight = 2;

        if (p.trang_thai === 'DA_SO_HOA_XANH') {
          color = '#064e3b';
          fillColor = '#10b981'; // Xanh lá: Có trên GGS
          radius = 6.5;
          weight = 1.5;
        } else if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') {
          color = '#1e3a8a';
          fillColor = '#2563eb'; // Xanh lam: Đã kê khai, chưa số hóa GGS
          radius = 6.5;
          weight = 1.5;
        } else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') {
          color = '#78350f';
          fillColor = '#f59e0b'; // Vàng: Có tên chủ đất
          radius = 6.5;
          weight = 1.5;
        }

        const isSelected = selectedParcel?.ma_thua === p.ma_thua;
        if (isSelected) {
          color = '#ffffff';
          fillColor = '#f43f5e'; // Hồng đỏ rực rỡ để nổi bật
          radius = 11;
          weight = 3;
        }

        const marker = L.circleMarker([lat, lng], {
          radius,
          color,
          fillColor,
          fillOpacity: 0.95,
          weight,
        });

        const ownerDisplay = p.chu_ho || 'Không có trong dữ liệu';
        const statusLabel =
          p.trang_thai === 'DA_SO_HOA_XANH'
            ? '🟢 Đã số hóa (GGS)'
            : p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
            ? '🔵 Đã kê khai (Chưa lên GGS)'
            : p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG'
            ? '🟡 Có tên'
            : '⚪ Chưa cập nhật / Không có DL';

        const tooltipContent = `
          <div style="font-weight: 800; font-size: 13px; color: #fff; margin-bottom: 2px;">
            Thửa ${p.so_thua} • Tờ ${p.to_ban_do}
          </div>
          <div style="color: #94a3b8; font-size: 11px;">
            ${statusLabel} • ${p.thon_xa}
          </div>
          <div style="color: #e2e8f0; font-size: 11px; margin-top: 2px;">
            Chủ: <strong style="color: #38bdf8;">${ownerDisplay}</strong>
          </div>
          <div style="color: #4ade80; font-size: 11px;">
            ${p.loai_dat || '---'} • ${p.dien_tich ? p.dien_tich + ' m²' : '---'}
          </div>
          <div style="color: #cbd5e1; font-size: 10px; margin-top: 4px; font-style: italic;">
            👉 Bấm để xem và kê khai
          </div>
        `;

        marker.bindTooltip(tooltipContent, {
          className: 'custom-map-tooltip',
          direction: 'top',
          offset: [0, -6],
        });

        marker.on('click', () => {
          onSelectParcel(p);
        });

        marker.addTo(layerGroup);
      });

      if (selectedParcel?.lat && selectedParcel?.lng) {
        map.setView([selectedParcel.lat, selectedParcel.lng], 18, {
          animate: true,
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, [map, parcels, selectedParcel, onSelectParcel]);

  // 4. Vẽ mạng lưới thửa lân cận xung quanh thửa được chọn
  useEffect(() => {
    if (!map || !neighborsLayerRef.current) return;
    const group = neighborsLayerRef.current;
    group.clearLayers();

    if (!selectedParcel?.lat || !selectedParcel?.lng || !neighborParcels || neighborParcels.length === 0) {
      return;
    }

    let isMounted = true;
    import('leaflet').then((L) => {
      if (!isMounted) return;
      const centerLat = selectedParcel.lat as number;
      const centerLng = selectedParcel.lng as number;

      neighborParcels.slice(0, 8).forEach((nb) => {
        if (!nb.lat || !nb.lng) return;

        // Vẽ đường nối đứt nét từ tâm thửa hiện tại tới thửa lân cận
        const line = L.polyline(
          [
            [centerLat, centerLng],
            [nb.lat, nb.lng],
          ],
          {
            color: '#0284c7', // Sky blue
            weight: 2,
            dashArray: '4, 5',
            opacity: 0.85,
            interactive: false,
          }
        );
        line.addTo(group);

        const dirLabel = nb.quadrantText || nb.directionText || 'Lân cận';
        const arrow = nb.arrow || '🧭';
        const owner = nb.chu_ho && nb.chu_ho !== 'Chưa có tên' ? ` (${nb.chu_ho})` : '';
        const shortName = extractShortOwnerName(nb.chu_ho);

        const ring = L.circleMarker([nb.lat, nb.lng], {
          radius: 11,
          color: '#0284c7',
          fillColor: '#38bdf8',
          fillOpacity: 0.18,
          weight: 2,
          dashArray: '3, 3',
        });

        const tooltipHtml = `
          <div style="font-size: 11px; font-weight: bold; color: #fff;">
            ${arrow} <b>${dirLabel}</b>: Thửa ${nb.so_thua} (Tờ ${nb.to_ban_do}) <span style="font-size: 10px; opacity: 0.85;">~${nb.distanceMeters}m</span>
          </div>
          <div style="font-size: 10px; color: #bae6fd;">${owner}</div>
          <div style="font-size: 10px; color: #cbd5e1; font-style: italic; margin-top: 2px;">👉 Bấm để xem thửa này</div>
        `;

        ring.bindTooltip(tooltipHtml, {
          className: 'custom-map-tooltip',
          direction: 'top',
          offset: [0, -10],
        });

        ring.on('click', () => {
          onSelectParcel(nb);
        });

        ring.addTo(group);

        if (shortName) {
          const badgeMarker = L.marker([nb.lat, nb.lng], {
            icon: L.divIcon({
              className: 'neighbor-badge-wrapper',
              html: `<span class="neighbor-name-badge">${shortName}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, 13],
            }),
            interactive: true,
            zIndexOffset: 1000,
          });

          badgeMarker.bindTooltip(tooltipHtml, {
            className: 'custom-map-tooltip',
            direction: 'top',
            offset: [0, -10],
          });

          badgeMarker.on('click', () => {
            onSelectParcel(nb);
          });

          badgeMarker.addTo(group);
        }
      });
    });

    return () => {
      isMounted = false;
    };
  }, [map, selectedParcel, neighborParcels, onSelectParcel]);

  // 5. Vẽ dấu định vị GPS người dùng (Pulsing Beacon & Accuracy Circle)
  useEffect(() => {
    if (!map || !userLocationLayerRef.current) return;
    const group = userLocationLayerRef.current;
    group.clearLayers();

    if (!userLocation) return;

    let isMounted = true;
    import('leaflet').then((L) => {
      if (!isMounted) return;

      const { lat, lng, accuracy } = userLocation;

      // 1. Vòng tròn bán kính sai số GPS (Accuracy circle)
      if (accuracy && accuracy > 0) {
        const circle = L.circle([lat, lng], {
          radius: Math.min(accuracy, 150),
          color: '#2563eb',
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          weight: 1.5,
          dashArray: '3, 4',
          interactive: false,
        });
        circle.addTo(group);
      }

      // 2. Chấm xanh phát xung (Radar Pulse Beacon)
      const beaconMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'user-gps-beacon-wrapper',
          html: `
            <div class="user-gps-beacon">
              <div class="user-gps-pulse"></div>
              <div class="user-gps-dot"></div>
            </div>
          `,
          iconSize: [0, 0],
        }),
        zIndexOffset: 2000,
      });

      beaconMarker.bindTooltip(
        `
        <div style="font-size: 11px; font-weight: 800; color: #fff;">
          📍 Vị trí thực tế của bạn
        </div>
        <div style="font-size: 10px; color: #93c5fd;">
          Độ chính xác: ±${Math.round(accuracy)}m
        </div>
      `,
        {
          className: 'custom-map-tooltip',
          direction: 'top',
          offset: [0, -12],
        }
      );

      beaconMarker.addTo(group);
    });

    return () => {
      isMounted = false;
    };
  }, [map, userLocation]);

  // 6. Vẽ lộ trình điều hướng & đường chỉ dẫn từ vị trí người dùng đến thửa đất
  const navInfo = useMemo(() => {
    if (!userLocation || !selectedParcel?.lat || !selectedParcel?.lng) {
      return null;
    }
    const dist = calculateDistanceMeters(
      userLocation.lat,
      userLocation.lng,
      selectedParcel.lat,
      selectedParcel.lng
    );
    const bearing = calculateBearing(
      userLocation.lat,
      userLocation.lng,
      selectedParcel.lat,
      selectedParcel.lng
    );
    const compass = getCompassInfo(bearing);
    return {
      distanceMeters: dist,
      bearing,
      compass,
      formattedDistance: formatDistance(dist),
    };
  }, [userLocation, selectedParcel]);

  useEffect(() => {
    if (!map || !navigationLayerRef.current) return;
    const group = navigationLayerRef.current;
    group.clearLayers();

    if (!userLocation || !selectedParcel?.lat || !selectedParcel?.lng || !navInfo) {
      return;
    }

    let isMounted = true;
    import('leaflet').then((L) => {
      if (!isMounted) return;

      const p1: [number, number] = [userLocation.lat, userLocation.lng];
      const p2: [number, number] = [selectedParcel.lat as number, selectedParcel.lng as number];

      // Đường kẻ chỉ hướng rực rỡ màu Cyan
      const routeLine = L.polyline([p1, p2], {
        color: '#06b6d4',
        weight: 4,
        dashArray: '6, 8',
        opacity: 0.95,
        interactive: false,
      });
      routeLine.addTo(group);

      // Điểm giữa hiển thị khoảng cách và hướng la bàn
      const midLat = (p1[0] + p2[0]) / 2;
      const midLng = (p1[1] + p2[1]) / 2;

      const distBadge = L.marker([midLat, midLng], {
        icon: L.divIcon({
          className: 'nav-route-badge-wrapper',
          html: `<div class="nav-route-badge">${navInfo.compass.arrow} ${navInfo.formattedDistance} (${navInfo.compass.directionText})</div>`,
          iconSize: [0, 0],
        }),
        interactive: false,
        zIndexOffset: 1500,
      });
      distBadge.addTo(group);
    });

    return () => {
      isMounted = false;
    };
  }, [map, userLocation, selectedParcel, navInfo]);

  // Hành động: Thu phóng bao trọn lộ trình (Vị trí bạn + Thửa đất)
  const handleFitRoute = useCallback(() => {
    if (!map || !userLocation || !selectedParcel?.lat || !selectedParcel?.lng) return;
    import('leaflet').then((L) => {
      const bounds = L.latLngBounds([
        [userLocation.lat, userLocation.lng],
        [selectedParcel.lat as number, selectedParcel.lng as number],
      ]);
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 18 });
    });
  }, [map, userLocation, selectedParcel]);

  // Hành động: Thu phóng vừa toàn bộ các thửa
  const handleFitBounds = useCallback(() => {
    if (!map) return;
    const validParcels = parcels.filter((p) => p.lat && p.lng);
    if (validParcels.length === 0) return;

    import('leaflet').then((L) => {
      const bounds = L.latLngBounds(
        validParcels.map((p) => [p.lat as number, p.lng as number])
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    });
  }, [map, parcels]);

  // Hành động: Bay về vị trí người dùng
  const handleFlyToUserLocation = useCallback(() => {
    if (!map) return;
    if (userLocation) {
      map.flyTo([userLocation.lat, userLocation.lng], 18, { animate: true, duration: 1 });
    } else if (onToggleLocation) {
      onToggleLocation();
    }
  }, [map, userLocation, onToggleLocation]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900">
      <div ref={mapContainerRef} className="w-full h-full bg-slate-900" />

      {/* Desktop Toolbar (Màn hình lớn >= lg) */}
      <div className="absolute top-[56px] right-3.5 z-[1000] hidden lg:flex flex-wrap items-center gap-1.5 sm:gap-2 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-2xl shadow-2xl border border-slate-700/60 text-xs text-white">
        {/* Nút GPS Định vị */}
        <button
          onClick={onToggleLocation}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition shadow-sm cursor-pointer ${
            isTracking
              ? 'bg-blue-600 text-white ring-2 ring-blue-400'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600/50'
          }`}
          title={isTracking ? 'Đang bật theo dõi vị trí GPS (Bấm để tắt)' : 'Bật định vị vị trí hiện tại của bạn'}
        >
          {isLocating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
          ) : isTracking ? (
            <LocateFixed className="w-3.5 h-3.5 text-blue-300 animate-pulse" />
          ) : (
            <Locate className="w-3.5 h-3.5 text-slate-400" />
          )}
          <span>{isTracking ? 'Đang định vị' : 'Định vị GPS'}</span>
          {isTracking && userLocation && (
            <span className="text-[10px] bg-blue-700/80 px-1.5 py-0.2 rounded font-mono">
              ±{Math.round(userLocation.accuracy)}m
            </span>
          )}
        </button>

        {/* Nút Tìm thửa gần nhất */}
        {onFindNearestParcel && (
          <button
            onClick={onFindNearestParcel}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-700/90 hover:bg-emerald-600 font-bold transition shadow-sm cursor-pointer"
            title="Tự động tìm thửa đất gần vị trí thực địa của bạn nhất"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Thửa gần nhất</span>
          </button>
        )}

        {/* Nút chuyển lớp vệ tinh / bản đồ đường */}
        <button
          onClick={() => setMapType(mapType === 'hybrid' ? 'streets' : 'hybrid')}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold transition border border-slate-600/50 cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5 text-blue-400" />
          {mapType === 'hybrid' ? 'Ảnh vệ tinh' : 'Bản đồ đường'}
        </button>

        <button
          onClick={handleFitBounds}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold transition border border-slate-600/50 cursor-pointer"
          title="Thu phóng vừa toàn bộ các thửa"
        >
          <Maximize2 className="w-3.5 h-3.5 text-blue-400" /> Xem tất cả
        </button>

        <span className="text-slate-300 font-medium ml-1">
          Hiển thị: <strong className="text-emerald-400 font-black">{dotsCount.toLocaleString('vi-VN')}</strong> thửa
        </span>
      </div>

      {/* Mobile Floating Action Buttons (Màn hình điện thoại < lg) */}
      <div className="absolute top-28 right-2.5 z-[1000] lg:hidden flex flex-col gap-2">
        {/* Nút GPS Mobile */}
        <button
          onClick={onToggleLocation}
          className={`w-11 h-11 rounded-2xl backdrop-blur-md shadow-xl border flex items-center justify-center active:scale-95 transition cursor-pointer ${
            isTracking
              ? 'bg-blue-600 text-white border-blue-400 shadow-blue-600/40 ring-2 ring-blue-400'
              : 'bg-slate-950/90 text-slate-200 border-slate-700/70'
          }`}
          title="Định vị vị trí GPS của tôi"
        >
          {isLocating ? (
            <Loader2 className="w-5 h-5 animate-spin text-blue-300" />
          ) : (
            <LocateFixed className={`w-5 h-5 ${isTracking ? 'text-white animate-pulse' : 'text-blue-400'}`} />
          )}
        </button>

        {/* Nút Tìm thửa gần nhất Mobile */}
        {onFindNearestParcel && (
          <button
            onClick={onFindNearestParcel}
            className="w-11 h-11 rounded-2xl bg-emerald-700 text-white backdrop-blur-md shadow-xl border border-emerald-500/50 flex items-center justify-center active:scale-95 transition cursor-pointer"
            title="Tìm thửa đất gần bạn nhất"
          >
            <Crosshair className="w-5 h-5" />
          </button>
        )}

        <button
          onClick={() => setMapType(mapType === 'hybrid' ? 'streets' : 'hybrid')}
          className="w-11 h-11 rounded-2xl bg-slate-950/90 backdrop-blur-md shadow-xl border border-slate-700/70 flex items-center justify-center text-white active:scale-95 transition cursor-pointer"
          title={mapType === 'hybrid' ? 'Bản đồ đường' : 'Ảnh vệ tinh'}
        >
          <Layers className="w-5 h-5 text-blue-400" />
        </button>

        <button
          onClick={handleFitBounds}
          className="w-11 h-11 rounded-2xl bg-slate-950/90 backdrop-blur-md shadow-xl border border-slate-700/70 flex items-center justify-center text-white active:scale-95 transition cursor-pointer"
          title="Xem toàn bộ các thửa"
        >
          <Maximize2 className="w-5 h-5 text-emerald-400" />
        </button>
      </div>

      {/* FLOATING NAVIGATION HUD: Thanh dẫn đường thực địa nổi khi đã chọn thửa */}
      {selectedParcel && selectedParcel.lat && selectedParcel.lng && (
        <div className="absolute bottom-4 left-3 right-3 sm:left-auto sm:right-4 z-[1000] max-w-md bg-slate-950/95 backdrop-blur-md border border-cyan-500/40 rounded-2xl p-3 shadow-2xl text-slate-100 flex flex-col gap-2 animate-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400 shrink-0">
                <Navigation className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-extrabold text-xs text-white truncate">
                  Đến Thửa <span className="text-cyan-400">{selectedParcel.so_thua}</span> • Tờ <span className="text-cyan-400">{selectedParcel.to_ban_do}</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {selectedParcel.chu_ho || 'Chưa có tên'} • {selectedParcel.thon_xa}
                </div>
              </div>
            </div>

            {navInfo ? (
              <div className="text-right shrink-0">
                <div className="text-xs font-black text-cyan-400 flex items-center gap-1 justify-end">
                  <span>{navInfo.compass.arrow}</span>
                  <span>{navInfo.formattedDistance}</span>
                </div>
                <div className="text-[10px] font-semibold text-slate-400">
                  Hướng {navInfo.compass.directionText}
                </div>
              </div>
            ) : (
              <button
                onClick={onToggleLocation}
                className="px-2 py-1 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 text-[10px] font-bold transition flex items-center gap-1 shrink-0"
              >
                <Locate className="w-3 h-3" />
                <span>Bật GPS đo cự ly</span>
              </button>
            )}
          </div>

          {/* Action buttons của HUD */}
          <div className="grid grid-cols-2 gap-2">
            <a
              href={getDirectionsUrl(
                selectedParcel.lat,
                selectedParcel.lng,
                userLocation?.lat,
                userLocation?.lng
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/30 transition text-center cursor-pointer"
              title="Mở Google Maps trên điện thoại để dẫn đường từng ngã rẽ bằng giọng nói"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Chỉ đường G-Maps</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </a>

            {userLocation ? (
              <button
                type="button"
                onClick={handleFitRoute}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 font-bold text-xs transition cursor-pointer"
                title="Thu phóng để thấy cả vị trí của bạn và thửa đất"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Xem lộ trình</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFlyToUserLocation}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs transition cursor-pointer"
                title="Bật định vị GPS để theo dõi lộ trình"
              >
                <LocateFixed className="w-3.5 h-3.5 text-blue-400" />
                <span>Định vị tôi</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mobile Dot Count Badge */}
      <div className="absolute bottom-4 left-3 z-[1000] lg:hidden bg-slate-950/85 backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] font-bold text-white border border-slate-700/60 shadow-lg pointer-events-none flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span>{dotsCount.toLocaleString('vi-VN')} thửa</span>
      </div>
    </div>
  );
}
