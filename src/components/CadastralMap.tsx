'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Parcel } from '@/types';
import { Layers, Maximize2 } from 'lucide-react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';

interface CadastralMapProps {
  parcels: Parcel[];
  onSelectParcel: (parcel: Parcel) => void;
  selectedParcel: Parcel | null;
}

export default function CadastralMap({
  parcels,
  onSelectParcel,
  selectedParcel,
}: CadastralMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
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

      const layerGroup = L.layerGroup().addTo(leafletMap);
      layerGroupRef.current = layerGroup;

      setMap(leafletMap);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Tự động thích ứng kích thước bản đồ liên tục trong suốt hiệu ứng trượt mở/đóng của panel
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

      const latLngs: [number, number][] = [];

      validParcels.forEach((p) => {
        const lat = p.lat as number;
        const lng = p.lng as number;
        latLngs.push([lat, lng]);

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
          fillColor = '#f43f5e'; // Hồng đỏ rực rỡ để nổi bật khác biệt hoàn toàn với màu xanh lam
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

        const ownerDisplay = p.chu_ho && p.chu_ho !== 'Chưa có tên' ? p.chu_ho : 'Chưa có tên';
        const statusLabel =
          p.trang_thai === 'DA_SO_HOA_XANH'
            ? '🟢 Đã số hóa (GGS)'
            : p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
            ? '🔵 Đã kê khai (Chưa lên GGS)'
            : p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG'
            ? '🟡 Có tên'
            : '⚪ Chưa có tên';

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
            👉 Bấm để mở form kê khai
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

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900">
      <div ref={mapContainerRef} className="w-full h-full bg-slate-900" />

      {/* Desktop Toolbar (Màn hình lớn >= lg) */}
      <div className="absolute top-[56px] right-3.5 z-[1000] hidden lg:flex flex-wrap items-center gap-1.5 sm:gap-2 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-2xl shadow-2xl border border-slate-700/60 text-xs text-white">
        <button
          onClick={() => setMapType(mapType === 'hybrid' ? 'streets' : 'hybrid')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold transition shadow-sm"
        >
          <Layers className="w-3.5 h-3.5" />
          {mapType === 'hybrid' ? 'Ảnh vệ tinh' : 'Bản đồ đường'}
        </button>

        <button
          onClick={handleFitBounds}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold transition border border-slate-600/50"
          title="Thu phóng vừa toàn bộ các thửa"
        >
          <Maximize2 className="w-3.5 h-3.5 text-blue-400" /> Xem toàn bộ
        </button>

        <span className="text-slate-300 font-medium ml-1">
          Hiển thị: <strong className="text-emerald-400 font-black">{dotsCount.toLocaleString('vi-VN')}</strong> thửa
        </span>
      </div>

      {/* Mobile Floating Action Buttons (Màn hình điện thoại < lg) */}
      <div className="absolute top-28 right-2.5 z-[1000] lg:hidden flex flex-col gap-2">
        <button
          onClick={() => setMapType(mapType === 'hybrid' ? 'streets' : 'hybrid')}
          className="w-10 h-10 rounded-2xl bg-slate-950/90 backdrop-blur-md shadow-xl border border-slate-700/70 flex items-center justify-center text-white active:scale-95 transition"
          title={mapType === 'hybrid' ? 'Chuyển sang bản đồ đường' : 'Chuyển sang ảnh vệ tinh'}
        >
          <Layers className="w-4 h-4 text-blue-400" />
        </button>

        <button
          onClick={handleFitBounds}
          className="w-10 h-10 rounded-2xl bg-slate-950/90 backdrop-blur-md shadow-xl border border-slate-700/70 flex items-center justify-center text-white active:scale-95 transition"
          title="Xem toàn bộ các thửa"
        >
          <Maximize2 className="w-4 h-4 text-emerald-400" />
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
