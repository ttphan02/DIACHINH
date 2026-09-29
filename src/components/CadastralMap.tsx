'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Parcel, NeighborParcel, AdditionalParcel } from '@/types';
import { extractShortOwnerName } from '@/utils/geo';
import { Maximize2, LocateFixed, Loader2 } from 'lucide-react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';

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
}: CadastralMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const neighborsLayerRef = useRef<LayerGroup | null>(null);
  const selectionPulseLayerRef = useRef<LayerGroup | null>(null);
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

      // LayerGroup cho hiệu ứng radar pulse thửa đang chọn kê khai (thửa chính + thửa gộp)
      const selectionPulseLayer = L.layerGroup().addTo(leafletMap);
      selectionPulseLayerRef.current = selectionPulseLayer;

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

      const additionalMap = new Map<string, number>();
      (additionalParcels || []).forEach((ap, idx) => {
        additionalMap.set(ap.ma_thua, idx + 1);
      });

      validParcels.forEach((p) => {
        const lat = p.lat as number;
        const lng = p.lng as number;

        let color = '#374151'; // Viền đen xám
        let fillColor = '#ffffff'; // Ruột trắng sáng (Chưa có tên)
        let radius = 6;
        let weight = 2;

        if (p.trang_thai === 'DA_SO_HOA_XANH') {
          color = '#1e3a8a';
          fillColor = '#2563eb'; // Xanh lam: Đã số hóa (Có trên GGS)
          radius = 6.5;
          weight = 1.5;
        } else if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') {
          color = '#064e3b';
          fillColor = '#10b981'; // Xanh lá: Đã kê khai (Chờ số hóa lên GGS)
          radius = 6.5;
          weight = 1.5;
        } else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') {
          color = '#78350f';
          fillColor = '#f59e0b'; // Vàng: Có tên chủ đất
          radius = 6.5;
          weight = 1.5;
        }

        const isSelected = selectedParcel?.ma_thua === p.ma_thua;
        const additionalIndex = additionalMap.get(p.ma_thua);
        const isAdditional = additionalIndex !== undefined;

        // Màu sắc riêng biệt, rực rỡ và dễ nhận biết nhất cho các thửa đang chọn để kê khai:
        if (isSelected) {
          color = '#ffffff';
          fillColor = '#dc2626'; // Đỏ cờ tươi rực rỡ cho thửa đất chính đang kê khai
          radius = 12;
          weight = 3.5;
        } else if (isAdditional) {
          color = '#ffffff';
          fillColor = '#f97316'; // Cam neon rực rỡ cho các thửa được chọn gộp thêm vào phiếu
          radius = 10;
          weight = 3;
        }

        const marker = L.circleMarker([lat, lng], {
          radius,
          color,
          fillColor,
          fillOpacity: 0.98,
          weight,
        });

        const ownerDisplay = p.chu_ho || 'Không có trong dữ liệu';
        const statusLabel =
          p.trang_thai === 'DA_SO_HOA_XANH'
            ? '🔵 Đã số hóa (GGS)'
            : p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
            ? '🟢 Đã kê khai (Chờ số hóa)'
            : p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG'
            ? '🟡 Có tên'
            : '⚪ Chưa cập nhật / Không có DL';

        let headerBadge = '';
        if (isSelected) {
          headerBadge = `
            <div style="display: inline-flex; align-items: center; gap: 4px; background: #dc2626; color: #fff; font-size: 10px; font-weight: 800; padding: 2.5px 7px; border-radius: 5px; margin-bottom: 5px; box-shadow: 0 2px 6px rgba(220, 38, 38, 0.4);">
              <span>🔴</span> ĐANG CHỌN KÊ KHAI (THỬA GỐC)
            </div>
          `;
        } else if (isAdditional) {
          headerBadge = `
            <div style="display: inline-flex; align-items: center; gap: 4px; background: #ea580c; color: #fff; font-size: 10px; font-weight: 800; padding: 2.5px 7px; border-radius: 5px; margin-bottom: 5px; box-shadow: 0 2px 6px rgba(234, 88, 12, 0.4);">
              <span>🟠</span> ĐANG CHỌN KÊ KHAI (THỬA GỘP #${additionalIndex})
            </div>
          `;
        }

        const tooltipContent = `
          ${headerBadge}
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
            ${isSelected ? '✓ Đang xem thông tin & kê khai' : isAdditional ? '✓ Đã gộp trong phiếu kê khai' : '👉 Bấm để xem và kê khai'}
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

        if (isSelected || isAdditional) {
          marker.bringToFront();
        }
      });
    });

    return () => {
      isMounted = false;
    };
  }, [map, parcels, selectedParcel, additionalParcels, onSelectParcel]);

  // 4. HIỆU ỨNG RADAR PULSE VÀ ĐƯỜNG NỐI CHO CÁC THỬA ĐANG ĐƯỢC CHỌN KÊ KHAI
  useEffect(() => {
    if (!map || !selectionPulseLayerRef.current) return;
    const group = selectionPulseLayerRef.current;
    group.clearLayers();

    if (!selectedParcel?.lat || !selectedParcel?.lng) return;

    let isMounted = true;
    import('leaflet').then((L) => {
      if (!isMounted) return;

      const centerLat = selectedParcel.lat as number;
      const centerLng = selectedParcel.lng as number;

      // 1. Radar pulse màu đỏ rực rỡ cho thửa chính đang kê khai
      const mainPulseHtml = `
        <div class="parcel-selected-pulse-wrapper">
          <div class="parcel-selected-pulse"></div>
        </div>
      `;
      const mainPulseMarker = L.marker([centerLat, centerLng], {
        icon: L.divIcon({
          className: 'parcel-pulse-div-icon',
          html: mainPulseHtml,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: false,
        zIndexOffset: 1200,
      });
      mainPulseMarker.addTo(group);

      // 2. Đường nối đứt nét màu cam và pulse cho các thửa gộp kèm theo
      if (additionalParcels && additionalParcels.length > 0) {
        additionalParcels.forEach((ap, idx) => {
          const match = parcels.find((p) => p.ma_thua === ap.ma_thua);
          if (!match?.lat || !match?.lng) return;

          // Đường nối đứt nét từ thửa chính tới thửa kèm theo
          const connLine = L.polyline(
            [
              [centerLat, centerLng],
              [match.lat, match.lng],
            ],
            {
              color: '#f97316',
              weight: 2.5,
              dashArray: '5, 5',
              opacity: 0.95,
              interactive: false,
            }
          );
          connLine.addTo(group);

          // Pulse màu cam kèm huy hiệu số thứ tự (+1, +2...)
          const addPulseHtml = `
            <div class="parcel-additional-pulse-wrapper">
              <div class="parcel-additional-pulse"></div>
              <span class="parcel-additional-badge">+${idx + 1}</span>
            </div>
          `;
          const addMarker = L.marker([match.lat, match.lng], {
            icon: L.divIcon({
              className: 'parcel-pulse-div-icon',
              html: addPulseHtml,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
            interactive: false,
            zIndexOffset: 1100,
          });
          addMarker.addTo(group);
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, [map, selectedParcel, additionalParcels, parcels]);

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

  // 5. VỊ TRÍ ĐANG ĐỨNG CHUẨN GOOGLE MAPS (CHẤM XANH PHÁT XUNG)
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

      // Chấm định vị xanh chuẩn Google Maps kèm hiệu ứng phát xung radar nhẹ nhàng
      const locationHtml = `
        <div class="user-ggm-location">
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
      `,
        {
          className: 'custom-map-tooltip',
          direction: 'top',
          offset: [0, -12],
        }
      );

      beaconMarker.addTo(group);
      userMarkerRef.current = beaconMarker;
    });

    return () => {
      isMounted = false;
    };
  }, [map, userLocation]);

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

  // Bay về vị trí người dùng
  const handleFlyToUserLocation = useCallback(() => {
    if (onToggleLocation) {
      onToggleLocation();
    }
    if (map && userLocation?.lat && userLocation?.lng) {
      map.flyTo([userLocation.lat, userLocation.lng], 18, { animate: true, duration: 0.8 });
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

      {/* Bảng chú thích màu sắc trạng thái thửa đất trên bản đồ */}
      <div className="absolute top-[96px] right-3.5 z-[1000] hidden lg:flex items-center gap-3 bg-slate-950/85 backdrop-blur-md px-3.5 py-1.5 rounded-2xl shadow-xl border border-slate-700/60 text-[11px] text-slate-200 pointer-events-none select-none">
        <span className="flex items-center gap-1.5 font-bold text-red-400">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-white animate-pulse" /> Đang chọn kê khai
        </span>
        {additionalParcels && additionalParcels.length > 0 && (
          <span className="flex items-center gap-1.5 font-bold text-orange-400">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500 ring-2 ring-white" /> Thửa gộp ({additionalParcels.length})
          </span>
        )}
        <span className="flex items-center gap-1 text-blue-300">
          <span className="w-2 h-2 rounded-full bg-blue-500" /> Đã số hóa (GGS)
        </span>
        <span className="flex items-center gap-1 text-emerald-300">
          <span className="w-2 h-2 rounded-full bg-emerald-500" /> Đã kê khai
        </span>
        <span className="flex items-center gap-1 text-amber-300">
          <span className="w-2 h-2 rounded-full bg-amber-500" /> Có tên
        </span>
        <span className="flex items-center gap-1 text-slate-300">
          <span className="w-2 h-2 rounded-full bg-white border border-gray-400" /> Chưa có tên
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

      {/* Mobile Dot Count & Selection Badge */}
      <div className="absolute bottom-4 left-3 z-[1000] lg:hidden bg-slate-950/85 backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] font-bold text-white border border-slate-700/60 shadow-lg pointer-events-none flex items-center gap-2">
        {selectedParcel ? (
          <span className="flex items-center gap-1.5 text-red-400">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-white animate-pulse" />
            <span>Thửa {selectedParcel.so_thua} (Đang chọn)</span>
            {additionalParcels && additionalParcels.length > 0 && (
              <span className="text-orange-400 ml-1">+{additionalParcels.length} thửa gộp</span>
            )}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>{dotsCount.toLocaleString('vi-VN')} thửa</span>
          </span>
        )}
      </div>
    </div>
  );
}
