'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Parcel, NeighborParcel } from '@/types';
import { extractShortOwnerName } from '@/utils/geo';
import { Maximize2, LocateFixed, Loader2 } from 'lucide-react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';

interface CadastralMapProps {
  parcels: Parcel[];
  onSelectParcel: (parcel: Parcel) => void;
  selectedParcel: Parcel | null;
  neighborParcels?: NeighborParcel[];
  userLocation?: { lat: number; lng: number; accuracy: number; heading?: number | null; speed?: number | null } | null;
  userHeading?: number | null;
  isTracking?: boolean;
  isLocating?: boolean;
  onToggleLocation?: () => void;
}

export default function CadastralMap({
  parcels,
  onSelectParcel,
  selectedParcel,
  neighborParcels = [],
  userLocation,
  userHeading,
  isTracking = false,
  isLocating = false,
  onToggleLocation,
}: CadastralMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const neighborsLayerRef = useRef<LayerGroup | null>(null);
  const userLocationLayerRef = useRef<LayerGroup | null>(null);
  const userMarkerRef = useRef<any>(null);
  const lastCenteredParcelRef = useRef<string | null>(null);
  const [dotsCount, setDotsCount] = useState(0);

  // 1. Khởi tạo Leaflet Map với lớp ảnh vệ tinh Google Hybrid vĩnh viễn
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

      // Điều khiển thu phóng góc dưới bên phải
      L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);

      // Ảnh vệ tinh kèm đường & địa danh Google Hybrid
      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps',
      }).addTo(leafletMap);

      // LayerGroup cho các thửa đất
      const layerGroup = L.layerGroup().addTo(leafletMap);
      layerGroupRef.current = layerGroup;

      // LayerGroup cho mạng lưới thửa lân cận
      const neighborsLayer = L.layerGroup().addTo(leafletMap);
      neighborsLayerRef.current = neighborsLayer;

      // LayerGroup cho vị trí GPS người dùng (Google Maps style)
      const userLocationLayer = L.layerGroup().addTo(leafletMap);
      userLocationLayerRef.current = userLocationLayer;

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

  // 2. CĂN GIỮA VÀ BAY TỚI THỬA ĐẤT ĐƯỢC CHỌN 1 LẦN DUY NHẤT
  // KHẮC PHỤC TRIỆT ĐỂ LỖI: Thu nhỏ/phóng to hay di chuyển bản đồ bị nhảy ngược lại thửa đất vừa bấm (kt1)
  useEffect(() => {
    if (!map) return;
    if (!selectedParcel || !selectedParcel.lat || !selectedParcel.lng) {
      lastCenteredParcelRef.current = null;
      return;
    }

    // Chỉ thực hiện flyTo 1 lần duy nhất khi người dùng chọn sang một thửa đất KHÁC
    if (lastCenteredParcelRef.current !== selectedParcel.ma_thua) {
      lastCenteredParcelRef.current = selectedParcel.ma_thua;
      map.flyTo([selectedParcel.lat, selectedParcel.lng], 18, {
        animate: true,
        duration: 0.8,
      });
    }
  }, [map, selectedParcel]);

  // 3. Vẽ tất cả các dấu chấm thửa đất lên bản đồ (KHÔNG chứa setView để tránh reset zoom)
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

        // Đường nối đứt nét từ tâm thửa hiện tại tới thửa lân cận
        const line = L.polyline(
          [
            [centerLat, centerLng],
            [nb.lat, nb.lng],
          ],
          {
            color: '#0284c7',
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

  const userHeadingRef = useRef<number | null>(userHeading ?? null);
  const lastAngleRef = useRef<number>(0);

  // Cập nhật nón hướng nhìn 60 độ siêu mượt khi xoay điện thoại
  const applyHeadingRotation = useCallback((heading: number | null | undefined) => {
    if (!userMarkerRef.current) return;
    const el = userMarkerRef.current.getElement();
    if (!el) return;

    const beam = el.querySelector('.user-ggm-heading-beam') as HTMLElement | null;
    if (beam) {
      if (typeof heading === 'number' && !isNaN(heading)) {
        beam.style.display = 'block';
        const prev = lastAngleRef.current;
        let diff = (heading - prev) % 360;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        const unwrapped = prev + diff;
        lastAngleRef.current = unwrapped;
        beam.style.transform = `rotate(${unwrapped}deg)`;
      }
    }
  }, []);

  useEffect(() => {
    userHeadingRef.current = userHeading ?? null;
    applyHeadingRotation(userHeading);
  }, [userHeading, applyHeadingRotation]);

  // 5. VỊ TRÍ ĐANG ĐỨNG & HƯỚNG NHÌN 60 ĐỘ CHUẨN GOOGLE MAPS
  useEffect(() => {
    if (!map || !userLocationLayerRef.current) return;
    const group = userLocationLayerRef.current;
    group.clearLayers();
    userMarkerRef.current = null;

    if (!userLocation) return;

    let isMounted = true;
    import('leaflet').then((L) => {
      if (!isMounted) return;

      const { lat, lng } = userLocation;
      const currentHeading = userHeadingRef.current;
      const hasHeading = typeof currentHeading === 'number' && !isNaN(currentHeading);
      const curHeading = hasHeading ? Math.round(currentHeading) : 0;
      lastAngleRef.current = curHeading;

      // Nón hướng nhìn 60 độ Google Maps + Chấm xanh định vị
      const locationHtml = `
        <div class="user-ggm-location">
          <div class="user-ggm-heading-beam" style="transform: rotate(${curHeading}deg); display: ${
        hasHeading ? 'block' : 'none'
      };">
            <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible;">
              <defs>
                <radialGradient id="ggmConeGrad" cx="50" cy="50" r="48" fx="50" fy="50" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.85" />
                  <stop offset="35%" stop-color="#0284c7" stop-opacity="0.5" />
                  <stop offset="85%" stop-color="#0284c7" stop-opacity="0.08" />
                  <stop offset="100%" stop-color="#0284c7" stop-opacity="0" />
                </radialGradient>
              </defs>
              <!-- Chùm tia nón 60 độ tỏa từ tâm (50, 50) -->
              <path d="M 50 50 L 25 7 A 50 50 0 0 1 75 7 Z" fill="url(#ggmConeGrad)" stroke="rgba(56, 189, 248, 0.45)" stroke-width="0.8" />
              <!-- Tia chỉ tâm hướng nhìn -->
              <line x1="50" y1="50" x2="50" y2="10" stroke="rgba(56, 189, 248, 0.9)" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </div>
          <div class="user-ggm-pulse"></div>
          <div class="user-ggm-dot"></div>
        </div>
      `;

      const beaconMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'user-ggm-wrapper',
          html: locationHtml,
          iconSize: [0, 0],
        }),
        zIndexOffset: 2000,
      });

      beaconMarker.bindTooltip(
        `
        <div style="font-size: 11px; font-weight: 800; color: #fff;">
          📍 Vị trí của bạn
        </div>
        ${
          hasHeading
            ? `<div style="font-size: 10px; color: #38bdf8; margin-top: 2px;">
                Hướng nhìn: <strong>${curHeading}°</strong>
              </div>`
            : ''
        }
      `,
        {
          className: 'custom-map-tooltip',
          direction: 'top',
          offset: [0, -12],
        }
      );

      beaconMarker.addTo(group);
      userMarkerRef.current = beaconMarker;
      applyHeadingRotation(userHeadingRef.current);
    });

    return () => {
      isMounted = false;
    };
  }, [map, userLocation, applyHeadingRotation]);

  // Thu phóng vừa toàn bộ các thửa
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

  // Bay về vị trí người dùng & kích hoạt xin quyền cảm biến la bàn
  const handleFlyToUserLocation = useCallback(() => {
    if (onToggleLocation) {
      onToggleLocation();
    }
    if (map && userLocation?.lat && userLocation?.lng) {
      map.flyTo([userLocation.lat, userLocation.lng], 18, { animate: true, duration: 1 });
    }
  }, [map, userLocation, onToggleLocation]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900">
      <div ref={mapContainerRef} className="w-full h-full bg-slate-900" />

      {/* Desktop Toolbar đơn giản góc trên bên phải */}
      <div className="absolute top-[56px] right-3.5 z-[1000] hidden lg:flex items-center gap-2 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-2xl shadow-2xl border border-slate-700/60 text-xs text-white">
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

      {/* NÚT TRÒN ĐỊNH VỊ VỊ TRÍ ĐANG ĐỨNG (GOOGLE MAPS STYLE) */}
      <div className="absolute bottom-20 right-3.5 sm:bottom-24 sm:right-4 z-[1000] flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={handleFlyToUserLocation}
          className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white text-blue-600 shadow-xl border border-gray-200/90 hover:bg-blue-50 flex items-center justify-center active:scale-90 transition-all cursor-pointer"
          title="Vị trí của bạn (Bấm để căn giữa)"
        >
          {isLocating ? (
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          ) : (
            <LocateFixed className={`w-5 h-5 ${userLocation ? 'text-blue-600' : 'text-slate-500'}`} />
          )}
        </button>
      </div>

      {/* Mobile Dot Count Badge */}
      <div className="absolute bottom-4 left-3 z-[1000] lg:hidden bg-slate-950/85 backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] font-bold text-white border border-slate-700/60 shadow-lg pointer-events-none flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span>{dotsCount.toLocaleString('vi-VN')} thửa</span>
      </div>
    </div>
  );
}
