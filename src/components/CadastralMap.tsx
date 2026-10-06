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
  const leafletRef = useRef<any>(null);
  const canvasRendererRef = useRef<any>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const neighborsLayerRef = useRef<LayerGroup | null>(null);
  const selectionPulseLayerRef = useRef<LayerGroup | null>(null);
  const userLocationLayerRef = useRef<LayerGroup | null>(null);
  const userMarkerRef = useRef<any>(null);
  const lastCenteredParcelRef = useRef<string | null>(null);
  const [dotsCount, setDotsCount] = useState(0);
  // Chế độ tự động di chuyển màn hình bám theo bước chân người dùng (giống Google Maps)
  const [isFollowingUser, setIsFollowingUser] = useState(false);

  // Giữ tham chiếu hàm chọn thửa để KHÔNG bao giờ phải vẽ lại 18.000 điểm khi state cha cập nhật
  const onSelectParcelRef = useRef(onSelectParcel);
  useEffect(() => {
    onSelectParcelRef.current = onSelectParcel;
  }, [onSelectParcel]);

  // 1. Khởi tạo Leaflet Map với lớp ảnh vệ tinh Google Hybrid & Canvas Renderer siêu tốc
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isCancelled = false;

    import('leaflet').then((L) => {
      if (isCancelled || !mapContainerRef.current) return;

      if ((mapContainerRef.current as any)._leaflet_id) {
        return;
      }

      leafletRef.current = L;
      const canvasRenderer = L.canvas({ padding: 0.4 });
      canvasRendererRef.current = canvasRenderer;

      const leafletMap = L.map(mapContainerRef.current, {
        center: [12.527, 108.493],
        zoom: 13,
        zoomControl: false,
        preferCanvas: true,
        renderer: canvasRenderer,
      });

      // Khi người dùng chủ động lấy tay kéo bản đồ -> tắt tự động khóa tâm GPS để tự do xem thửa khác
      leafletMap.on('dragstart', () => {
        setIsFollowingUser(false);
      });

      // Điều khiển thu phóng góc dưới bên phải
      L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);

      // Ảnh vệ tinh kèm đường & địa danh Google Hybrid
      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps',
      }).addTo(leafletMap);

      // LayerGroup cho các thửa đất nền
      const layerGroup = L.layerGroup().addTo(leafletMap);
      layerGroupRef.current = layerGroup;

      // LayerGroup cho mạng lưới thửa lân cận
      const neighborsLayer = L.layerGroup().addTo(leafletMap);
      neighborsLayerRef.current = neighborsLayer;

      // LayerGroup cho hiệu ứng thửa đang chọn kê khai (thửa chính + thửa gộp)
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
  useEffect(() => {
    if (!map) return;
    if (!selectedParcel || !selectedParcel.lat || !selectedParcel.lng) {
      lastCenteredParcelRef.current = null;
      return;
    }

    if (lastCenteredParcelRef.current !== selectedParcel.ma_thua) {
      lastCenteredParcelRef.current = selectedParcel.ma_thua;
      setIsFollowingUser(false); // Tắt bám GPS khi người dùng bấm chọn xem một thửa đất cụ thể
      map.flyTo([selectedParcel.lat, selectedParcel.lng], 18, {
        animate: true,
        duration: 0.6,
      });
    }
  }, [map, selectedParcel]);

  // 3. VẼ LỚP NỀN CÁC DẤU CHẤM THỬA ĐẤT (TỐI ƯU HÓA CỰC ĐẠI CHO ĐIỆN THOẠI YẾU)
  // Chỉ chạy lại khi danh sách `parcels` thực sự thay đổi, KHÔNG chạy lại khi bấm chọn thửa hay khi GPS di chuyển!
  useEffect(() => {
    if (!map || !layerGroupRef.current) return;

    let isMounted = true;
    const renderParcels = (L: any) => {
      if (!isMounted) return;
      const layerGroup = layerGroupRef.current;
      if (!layerGroup) return;

      layerGroup.clearLayers();

      const validParcels = parcels.filter((p) => p.lat && p.lng);
      setDotsCount(validParcels.length);

      if (validParcels.length === 0) return;

      const isTouchDevice =
        typeof window !== 'undefined' &&
        (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
      const renderer = canvasRendererRef.current;

      for (let i = 0; i < validParcels.length; i++) {
        const p = validParcels[i];
        const lat = p.lat as number;
        const lng = p.lng as number;

        let color = '#374151';
        let fillColor = '#ffffff';
        let radius = 6;
        let weight = 1.5;

        if (p.trang_thai === 'DA_SO_HOA_XANH') {
          color = '#064e3b';
          fillColor = '#10b981';
          radius = 6.2;
        } else if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') {
          color = '#1e3a8a';
          fillColor = '#2563eb';
          radius = 6.5;
        } else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') {
          color = '#78350f';
          fillColor = '#f59e0b';
          radius = 6.2;
        }

        const marker = L.circleMarker([lat, lng], {
          renderer,
          radius,
          color,
          fillColor,
          fillOpacity: 0.96,
          weight,
        });

        // Tối ưu RAM & CPU: Trên điện thoại cảm ứng không cần tạo 18.000 HTML Tooltip.
        // Trên máy tính chỉ khởi tạo Tooltip khi người dùng thực sự rê chuột vào chấm đó (Lazy Tooltip).
        if (!isTouchDevice) {
          marker.once('mouseover', () => {
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
            `;
            marker
              .bindTooltip(tooltipContent, {
                className: 'custom-map-tooltip',
                direction: 'top',
                offset: [0, -6],
              })
              .openTooltip();
          });
        }

        marker.on('click', () => {
          onSelectParcelRef.current(p);
        });

        marker.addTo(layerGroup);
      }
    };

    if (leafletRef.current) {
      renderParcels(leafletRef.current);
    } else {
      import('leaflet').then((L) => {
        leafletRef.current = L;
        renderParcels(L);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [map, parcels]);

  // 4. LỚP ĐÁNH DẤU THỬA ĐANG CHỌN & THỬA GỘP (SIÊU NHẸ, PHẢN HỒI TỨC THÌ 0.1ms)
  useEffect(() => {
    if (!map || !selectionPulseLayerRef.current) return;
    const group = selectionPulseLayerRef.current;
    group.clearLayers();

    if (!selectedParcel?.lat || !selectedParcel?.lng) return;

    let isMounted = true;
    const renderSelection = (L: any) => {
      if (!isMounted) return;

      const centerLat = selectedParcel.lat as number;
      const centerLng = selectedParcel.lng as number;

      // Chấm tròn đỏ nổi bật cho thửa đất chính đang chọn
      const selectedCircle = L.circleMarker([centerLat, centerLng], {
        renderer: canvasRendererRef.current,
        radius: 12,
        color: '#ffffff',
        fillColor: '#dc2626',
        fillOpacity: 1,
        weight: 3.5,
      });
      selectedCircle.addTo(group);

      // Hiệu ứng radar pulse màu đỏ cho thửa chính
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

      // Đường nối đứt nét màu cam và chấm cam cho các thửa gộp kèm theo
      if (additionalParcels && additionalParcels.length > 0) {
        additionalParcels.forEach((ap, idx) => {
          const match = parcels.find((p) => p.ma_thua === ap.ma_thua);
          if (!match?.lat || !match?.lng) return;

          const connLine = L.polyline(
            [
              [centerLat, centerLng],
              [match.lat, match.lng],
            ],
            {
              renderer: canvasRendererRef.current,
              color: '#f97316',
              weight: 2.5,
              dashArray: '5, 5',
              opacity: 0.95,
              interactive: false,
            }
          );
          connLine.addTo(group);

          const addCircle = L.circleMarker([match.lat, match.lng], {
            renderer: canvasRendererRef.current,
            radius: 10,
            color: '#ffffff',
            fillColor: '#f97316',
            fillOpacity: 1,
            weight: 3,
          });
          addCircle.on('click', () => {
            onSelectParcelRef.current(match);
          });
          addCircle.addTo(group);

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
    };

    if (leafletRef.current) {
      renderSelection(leafletRef.current);
    } else {
      import('leaflet').then((L) => {
        leafletRef.current = L;
        renderSelection(L);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [map, selectedParcel, additionalParcels, parcels]);

  // 5. VẼ MẠNG LƯỚI THỬA LÂN CẬN XUNG QUANH THỬA ĐƯỢC CHỌN
  useEffect(() => {
    if (!map || !neighborsLayerRef.current) return;
    const group = neighborsLayerRef.current;
    group.clearLayers();

    if (!selectedParcel?.lat || !selectedParcel?.lng || !neighborParcels || neighborParcels.length === 0) {
      return;
    }

    let isMounted = true;
    const renderNeighbors = (L: any) => {
      if (!isMounted) return;
      const centerLat = selectedParcel.lat as number;
      const centerLng = selectedParcel.lng as number;

      neighborParcels.slice(0, 8).forEach((nb) => {
        if (!nb.lat || !nb.lng) return;

        const line = L.polyline(
          [
            [centerLat, centerLng],
            [nb.lat, nb.lng],
          ],
          {
            renderer: canvasRendererRef.current,
            color: '#0284c7',
            weight: 2,
            dashArray: '4, 5',
            opacity: 0.85,
            interactive: false,
          }
        );
        line.addTo(group);

        const shortName = extractShortOwnerName(nb.chu_ho);

        const ring = L.circleMarker([nb.lat, nb.lng], {
          renderer: canvasRendererRef.current,
          radius: 11,
          color: '#0284c7',
          fillColor: '#38bdf8',
          fillOpacity: 0.18,
          weight: 2,
          dashArray: '3, 3',
        });

        ring.on('click', () => {
          onSelectParcelRef.current(nb);
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

          badgeMarker.on('click', () => {
            onSelectParcelRef.current(nb);
          });

          badgeMarker.addTo(group);
        }
      });
    };

    if (leafletRef.current) {
      renderNeighbors(leafletRef.current);
    } else {
      import('leaflet').then((L) => {
        leafletRef.current = L;
        renderNeighbors(L);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [map, selectedParcel, neighborParcels]);

  // 6. VỊ TRÍ GPS NGƯỜI DÙNG DI CHUYỂN REALTIME MƯỢT MÀ (KHÔNG TẠO LẠI DOM MỖI GIÂY)
  useEffect(() => {
    if (!map || !userLocationLayerRef.current) return;
    const group = userLocationLayerRef.current;

    if (!userLocation) {
      group.clearLayers();
      userMarkerRef.current = null;
      return;
    }

    const { lat, lng } = userLocation;

    // Nếu chấm xanh GPS đã tồn tại -> chỉ cập nhật tọa độ mới (di chuyển realtime mượt mà 60fps)
    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([lat, lng]);
      if (isFollowingUser) {
        map.panTo([lat, lng], { animate: true, duration: 0.5 });
      }
      return;
    }

    // Khởi tạo chấm xanh lần đầu tiên
    let isMounted = true;
    const createGpsMarker = (L: any) => {
      if (!isMounted || userMarkerRef.current) return;

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
        interactive: false,
        zIndexOffset: 2000,
      });

      beaconMarker.addTo(group);
      userMarkerRef.current = beaconMarker;

      if (isFollowingUser) {
        map.panTo([lat, lng], { animate: true, duration: 0.5 });
      }
    };

    if (leafletRef.current) {
      createGpsMarker(leafletRef.current);
    } else {
      import('leaflet').then((L) => {
        leafletRef.current = L;
        createGpsMarker(L);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [map, userLocation, isFollowingUser]);

  // Thu phóng vừa toàn bộ các thửa
  const handleFitBounds = useCallback(() => {
    if (!map) return;
    const validParcels = parcels.filter((p) => p.lat && p.lng);
    if (validParcels.length === 0) return;

    setIsFollowingUser(false);
    import('leaflet').then((L) => {
      const bounds = L.latLngBounds(
        validParcels.map((p) => [p.lat as number, p.lng as number])
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    });
  }, [map, parcels]);

  // Bấm nút Định vị: Bay tới vị trí người dùng & Bật chế độ tự động bám theo bước chân
  const handleFlyToUserLocation = useCallback(() => {
    setIsFollowingUser(true);
    if (map && userLocation?.lat && userLocation?.lng) {
      map.flyTo([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 18), {
        animate: true,
        duration: 0.7,
      });
    } else if (onToggleLocation) {
      onToggleLocation();
    }
  }, [map, userLocation, onToggleLocation]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900">
      <div ref={mapContainerRef} className="w-full h-full bg-slate-900" />

      {/* Desktop Toolbar đơn giản góc trên bên phải */}
      <div className="absolute top-[56px] right-3.5 z-[1000] hidden lg:flex items-center gap-2 bg-slate-950/90 px-3 py-1.5 rounded-2xl shadow-2xl border border-slate-700/60 text-xs text-white">
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
      <div className="absolute top-[96px] right-3.5 z-[1000] hidden lg:flex items-center gap-3 bg-slate-950/90 px-3.5 py-1.5 rounded-2xl shadow-xl border border-slate-700/60 text-[11px] text-slate-200 pointer-events-none select-none">
        <span className="flex items-center gap-1.5 font-bold text-red-400">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-white" /> Đang chọn kê khai
        </span>
        {additionalParcels && additionalParcels.length > 0 && (
          <span className="flex items-center gap-1.5 font-bold text-orange-400">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500 ring-2 ring-white" /> Thửa gộp ({additionalParcels.length})
          </span>
        )}
        <span className="flex items-center gap-1 text-emerald-300">
          <span className="w-2 h-2 rounded-full bg-emerald-500" /> Đã số hóa (GGS)
        </span>
        <span className="flex items-center gap-1 text-blue-300">
          <span className="w-2 h-2 rounded-full bg-blue-500" /> Đã kê khai
        </span>
        <span className="flex items-center gap-1 text-amber-300">
          <span className="w-2 h-2 rounded-full bg-amber-500" /> Có tên
        </span>
        <span className="flex items-center gap-1 text-slate-300">
          <span className="w-2 h-2 rounded-full bg-white border border-gray-400" /> Chưa có tên
        </span>
      </div>

      {/* NÚT TRÒN ĐỊNH VỊ VỊ TRÍ ĐANG ĐỨNG (GOOGLE MAPS STYLE - CÓ CHẾ ĐỘ BÁM BƯỚC CHÂN) */}
      <div className="absolute bottom-20 right-3.5 sm:bottom-24 sm:right-4 z-[1000] flex flex-col items-center gap-2">
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
            <span>Thửa {selectedParcel.so_thua} (Đang chọn)</span>
            {additionalParcels && additionalParcels.length > 0 && (
              <span className="text-orange-400 ml-1">+{additionalParcels.length} thửa gộp</span>
            )}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>{dotsCount.toLocaleString('vi-VN')} thửa</span>
          </span>
        )}
      </div>
    </div>
  );
}
