'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { CadreLocationRecord, CadreWorkStatus } from '@/types';
import {
  Navigation,
  Radio,
  RefreshCw,
  LocateFixed,
  Layers,
  Footprints,
  Activity,
  Clock,
  WifiOff,
  Battery,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Eye,
  EyeOff,
  Maximize2,
  Compass,
} from 'lucide-react';
import type { Map as LeafletMap, LayerGroup, Polyline, Marker } from 'leaflet';

interface CadreTrackingTabProps {
  theme?: 'dark' | 'light';
  isLight?: boolean;
}

const CADRE_COLORS = [
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#3b82f6', // Blue
  '#14b8a6', // Teal
  '#f97316', // Orange
];

export default function CadreTrackingTab({ theme = 'dark', isLight = false }: CadreTrackingTabProps) {
  const [cadres, setCadres] = useState<CadreLocationRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [selectedCadreName, setSelectedCadreName] = useState<string | null>(null);
  const [visibleTrails, setVisibleTrails] = useState<Record<string, boolean>>({});
  const [mapType, setMapType] = useState<'satellite' | 'streets'>('satellite');
  const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now());
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState<number>(6);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markersLayerRef = useRef<LayerGroup | null>(null);
  const polylinesLayerRef = useRef<LayerGroup | null>(null);
  const cadreMarkersRef = useRef<Record<string, Marker>>({});

  // 1. Fetch dữ liệu vị trí cán bộ từ API
  const fetchCadres = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setIsRefreshing(true);
      const res = await fetch(`/api/cadres/location?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data.success && Array.isArray(data.cadres)) {
          setCadres(data.cadres);
          setLastFetchTime(Date.now());
        }
      }
    } catch (err) {
      console.warn('Lỗi fetch vị trí cán bộ:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Khởi tạo fetch ban đầu & polling tự động
  useEffect(() => {
    fetchCadres(false);
  }, [fetchCadres]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchCadres(true);
      setSecondsUntilRefresh(6);
    }, 6000);

    const countdown = setInterval(() => {
      setSecondsUntilRefresh((prev) => (prev > 1 ? prev - 1 : 6));
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(countdown);
    };
  }, [autoRefresh, fetchCadres]);

  // Kích hoạt dữ liệu mô phỏng demo
  const handleSeedDemo = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/cadres/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'demo_seed' }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data.cadres) {
          setCadres(data.cadres);
          // Mặc định bật hiển thị lộ trình cho tất cả cán bộ demo
          const trails: Record<string, boolean> = {};
          data.cadres.forEach((c: CadreLocationRecord) => {
            trails[c.cadreName] = true;
          });
          setVisibleTrails(trails);
        }
      }
    } catch (err) {
      console.error('Lỗi khi kích hoạt demo:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Xóa / Làm mới toàn bộ
  const handleReset = async () => {
    if (!confirm('Bạn có chắc muốn làm mới / xóa dữ liệu vị trí các cán bộ?')) return;
    try {
      setIsRefreshing(true);
      await fetch('/api/cadres/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      });
      setCadres([]);
      setVisibleTrails({});
    } catch (err) {
      console.error('Lỗi khi xóa vị trí:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 2. Khởi tạo Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isCancelled = false;

    import('leaflet').then((L) => {
      if (isCancelled || !mapContainerRef.current) return;

      if ((mapContainerRef.current as any)._leaflet_id) {
        return;
      }

      leafletRef.current = L;

      // Trung tâm mặc định: UBND Xã Cư Pui, Đắk Lắk
      const map = L.map(mapContainerRef.current, {
        center: [12.5278, 108.4932],
        zoom: 13,
        zoomControl: false,
        fadeAnimation: true,
        markerZoomAnimation: true,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Lớp tile vệ tinh Google Hybrid
      const tile = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps',
      }).addTo(map);

      tileLayerRef.current = tile;

      const polylinesLayer = L.layerGroup().addTo(map);
      const markersLayer = L.layerGroup().addTo(map);

      polylinesLayerRef.current = polylinesLayer;
      markersLayerRef.current = markersLayer;

      mapRef.current = map;
    });

    return () => {
      isCancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Đổi kiểu bản đồ Vệ tinh / Đường sá
  const toggleMapType = () => {
    if (!mapRef.current || !leafletRef.current || !tileLayerRef.current) return;
    const L = leafletRef.current;
    mapRef.current.removeLayer(tileLayerRef.current);

    const nextType = mapType === 'satellite' ? 'streets' : 'satellite';
    setMapType(nextType);

    const url =
      nextType === 'satellite'
        ? 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    const newTile = L.tileLayer(url, {
      maxZoom: 21,
      subdomains: nextType === 'satellite' ? ['mt0', 'mt1', 'mt2', 'mt3'] : ['a', 'b', 'c'],
      attribution: nextType === 'satellite' ? '&copy; Google Maps' : '&copy; OpenStreetMap',
    }).addTo(mapRef.current);

    tileLayerRef.current = newTile;
  };

  // 3. Vẽ Markers & Polylines khi cadres thay đổi
  useEffect(() => {
    if (!mapRef.current || !leafletRef.current || !markersLayerRef.current || !polylinesLayerRef.current) {
      return;
    }

    const L = leafletRef.current;
    const markersLayer = markersLayerRef.current;
    const polylinesLayer = polylinesLayerRef.current;

    markersLayer.clearLayers();
    polylinesLayer.clearLayers();
    cadreMarkersRef.current = {};

    cadres.forEach((cadre, idx) => {
      const color = CADRE_COLORS[idx % CADRE_COLORS.length];
      const isOnline = cadre.status === 'active_moving' || cadre.status === 'active_stationary';
      const isMoving = cadre.status === 'active_moving';
      const isStationary = cadre.status === 'active_stationary';
      const isIdle = cadre.status === 'idle';

      // Status indicator color
      const statusBg = isMoving
        ? '#10b981' // Xanh lá
        : isStationary
        ? '#eab308' // Vàng
        : isIdle
        ? '#f97316' // Cam
        : '#ef4444'; // Đỏ

      const statusText = isMoving
        ? `Đang di chuyển (${cadre.speed || 0} km/h)`
        : isStationary
        ? 'Đang làm việc tại chỗ'
        : isIdle
        ? 'Tạm dừng (>3 phút)'
        : 'Ngoại tuyến';

      // Custom animated HTML icon
      const customIcon = L.divIcon({
        className: 'cadre-live-marker',
        html: `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            ${
              isOnline
                ? `<div style="position: absolute; top: -6px; left: 50%; transform: translateX(-50%); width: 44px; height: 44px; border-radius: 50%; background: ${statusBg}; opacity: 0.35; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>`
                : ''
            }
            <div style="
              position: relative;
              z-index: 2;
              width: 34px;
              height: 34px;
              border-radius: 50%;
              background: #0f172a;
              border: 3px solid ${statusBg};
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 4px 14px rgba(0,0,0,0.45);
              transition: transform 0.2s ease;
            ">
              <span style="color: #ffffff; font-weight: 900; font-size: 13px; font-family: sans-serif;">
                ${cadre.cadreName.charAt(0)}
              </span>
              ${
                typeof cadre.heading === 'number' && isMoving
                  ? `<div style="
                      position: absolute;
                      top: -10px;
                      width: 0;
                      height: 0;
                      border-left: 5px solid transparent;
                      border-right: 5px solid transparent;
                      border-bottom: 9px solid ${statusBg};
                      transform: rotate(${cadre.heading}deg);
                      transform-origin: center 19px;
                    "></div>`
                  : ''
              }
            </div>
            <div style="
              margin-top: 3px;
              background: rgba(15, 23, 42, 0.88);
              backdrop-filter: blur(4px);
              border: 1px solid rgba(255,255,255,0.15);
              padding: 2px 7px;
              border-radius: 8px;
              font-size: 11px;
              font-weight: 800;
              color: #f8fafc;
              white-space: nowrap;
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              gap: 4px;
            ">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: ${statusBg};"></span>
              <span>${cadre.cadreName}</span>
            </div>
          </div>
        `,
        iconSize: [34, 56],
        iconAnchor: [17, 28],
        popupAnchor: [0, -28],
      });

      const marker = L.marker([cadre.lat, cadre.lng], { icon: customIcon });

      const lastUpdatedStr = formatRelativeTime(cadre.lastUpdated);
      const totalKm = ((cadre.todayDistanceMeters || 0) / 1000).toFixed(2);

      // Popup nội dung chi tiết
      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4; min-width: 230px; color: #0f172a;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 8px;">
            <div style="font-weight: 800; font-size: 14px; color: #1e293b; display: flex; align-items: center; gap: 6px;">
              <span style="width: 9px; height: 9px; border-radius: 50%; background: ${statusBg}; display: inline-block;"></span>
              ${cadre.cadreName}
            </div>
            <span style="font-size: 10px; font-weight: 700; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #64748b;">
              ${cadre.deviceId}
            </span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 5px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b; font-weight: 600;">Trạng thái:</span>
              <span style="font-weight: 700; color: ${statusBg};">${statusText}</span>
            </div>

            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b; font-weight: 600;">Địa bàn:</span>
              <span style="font-weight: 700; color: #0f172a;">${cadre.nearestVillage || 'Xã Cư Pui'}</span>
            </div>

            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b; font-weight: 600;">Hoạt động:</span>
              <span style="font-weight: 600; color: #0369a1; text-align: right; max-width: 140px;">${
                cadre.currentAction || 'Khảo sát thực địa'
              }</span>
            </div>

            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b; font-weight: 600;">Quãng đường hôm nay:</span>
              <span style="font-weight: 800; color: #0f172a;">${totalKm} km</span>
            </div>

            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b; font-weight: 600;">Độ chính xác GPS:</span>
              <span style="font-weight: 600; color: #334155;">±${cadre.accuracy}m</span>
            </div>

            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b; font-weight: 600;">Cập nhật lúc:</span>
              <span style="font-weight: 600; color: #64748b;">${lastUpdatedStr}</span>
            </div>
          </div>
        </div>
      `);

      marker.addTo(markersLayer);
      cadreMarkersRef.current[cadre.cadreName] = marker;

      // 4. Vẽ Polyline Lộ trình di chuyển (Breadcrumbs)
      const isTrailVisible = visibleTrails[cadre.cadreName] !== false; // mặc định bật
      if (isTrailVisible && Array.isArray(cadre.breadcrumbs) && cadre.breadcrumbs.length > 1) {
        const latlngs = cadre.breadcrumbs.map((b) => [b.lat, b.lng]);

        // Đường viền phát sáng ngoài
        L.polyline(latlngs, {
          color: color,
          weight: 6,
          opacity: 0.45,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(polylinesLayer);

        // Lõi đường đi chính
        L.polyline(latlngs, {
          color: '#ffffff',
          weight: 2.5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(polylinesLayer);

        // Điểm xuất phát (Start marker)
        const startPt = cadre.breadcrumbs[0];
        const startIcon = L.divIcon({
          className: 'start-point-marker',
          html: `<div style="width: 10px; height: 10px; border-radius: 50%; background: #22c55e; border: 2px solid #ffffff; box-shadow: 0 0 6px #22c55e;"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        L.marker([startPt.lat, startPt.lng], { icon: startIcon })
          .bindTooltip(`Điểm xuất phát: ${cadre.cadreName}`, { direction: 'top' })
          .addTo(polylinesLayer);
      }
    });
  }, [cadres, visibleTrails]);

  // Phóng to và định vị đến cán bộ
  const focusCadre = (cadre: CadreLocationRecord) => {
    setSelectedCadreName(cadre.cadreName);
    if (mapRef.current) {
      mapRef.current.flyTo([cadre.lat, cadre.lng], 16, {
        duration: 1.2,
      });
      const marker = cadreMarkersRef.current[cadre.cadreName];
      if (marker) {
        setTimeout(() => marker.openPopup(), 1200);
      }
    }
  };

  // Bao quát tất cả cán bộ
  const fitAllCadres = () => {
    if (!mapRef.current || !leafletRef.current || cadres.length === 0) return;
    const L = leafletRef.current;
    const bounds = L.latLngBounds(cadres.map((c) => [c.lat, c.lng]));
    mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
  };

  // Bật/tắt lộ trình cán bộ
  const toggleTrail = (cadreName: string) => {
    setVisibleTrails((prev) => ({
      ...prev,
      [cadreName]: prev[cadreName] === false ? true : false,
    }));
  };

  // Thống kê tổng quan
  const stats = useMemo(() => {
    let moving = 0;
    let stationary = 0;
    let idle = 0;
    let offline = 0;
    let totalDistMeters = 0;

    cadres.forEach((c) => {
      totalDistMeters += c.todayDistanceMeters || 0;
      if (c.status === 'active_moving') moving++;
      else if (c.status === 'active_stationary') stationary++;
      else if (c.status === 'idle') idle++;
      else offline++;
    });

    return {
      total: cadres.length,
      moving,
      stationary,
      idle,
      offline,
      totalKm: (totalDistMeters / 1000).toFixed(1),
    };
  }, [cadres]);

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* 1. Header Toolbar & Điều khiển Realtime */}
      <div
        className={`flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 sm:p-4 rounded-2xl border transition shadow-xs ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-cyan-500 flex items-center justify-center text-white shadow-md">
            <Navigation className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black tracking-tight">
                Giám Sát Vị Trí & Hoạt Động Cán Bộ Thực Địa
              </h2>
              {autoRefresh && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  Realtime ({secondsUntilRefresh}s)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Hệ thống theo dõi bước chân, tốc độ di chuyển và vị trí làm việc thời gian thực xã Cư Pui
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Nút bật/tắt tự động làm mới */}
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
              autoRefresh
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-xs'
                : isLight
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title={autoRefresh ? 'Bấm để tắt tự động làm mới' : 'Bấm để bật tự động làm mới'}
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
            <span>{autoRefresh ? 'Tự động (Bật)' : 'Tự động (Tắt)'}</span>
          </button>

          {/* Nút Làm mới ngay */}
          <button
            type="button"
            onClick={() => fetchCadres(false)}
            disabled={isRefreshing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
              isLight
                ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Lấy dữ liệu vị trí mới nhất"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Làm mới</span>
          </button>

          {/* Nút Phóng toàn cảnh */}
          <button
            type="button"
            onClick={fitAllCadres}
            disabled={cadres.length === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
              isLight
                ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Thu phóng toàn bộ vị trí cán bộ"
          >
            <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Toàn cảnh</span>
          </button>

          {/* Nút Kích hoạt Demo / Mô phỏng */}
          <button
            type="button"
            onClick={handleSeedDemo}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
              isLight
                ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                : 'bg-indigo-950/80 hover:bg-indigo-900 text-cyan-300 border-indigo-500/40'
            }`}
            title="Nạp dữ liệu mẫu cán bộ đang khảo sát các thôn để kiểm tra giao diện"
          >
            <Play className="w-3.5 h-3.5 text-cyan-400" />
            <span>Mô phỏng Demo</span>
          </button>

          {/* Nút Làm mới ngày */}
          {cadres.length > 0 && (
            <button
              type="button"
              onClick={handleReset}
              className={`p-1.5 rounded-xl text-xs font-bold transition cursor-pointer border text-slate-400 hover:text-rose-400 ${
                isLight ? 'border-slate-200 hover:bg-rose-50' : 'border-slate-800 hover:bg-rose-950/40'
              }`}
              title="Xóa danh sách cán bộ mẫu / làm mới ngày"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Thẻ Thống kê Trạng thái Làm việc (Work Status Overview) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Đang di chuyển thực địa */}
        <div
          className={`p-3 rounded-2xl border transition shadow-xs flex items-center gap-3 ${
            isLight ? 'bg-white border-emerald-200/80' : 'bg-slate-900 border-emerald-500/20'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
            <Footprints className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="text-xl font-black text-emerald-500">{stats.moving}</div>
            <div className="text-[11px] font-semibold text-slate-400">Đang di chuyển (Khảo sát)</div>
          </div>
        </div>

        {/* Đang đứng yên / Kê khai tại chỗ */}
        <div
          className={`p-3 rounded-2xl border transition shadow-xs flex items-center gap-3 ${
            isLight ? 'bg-white border-amber-200/80' : 'bg-slate-900 border-amber-500/20'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-black text-amber-500">{stats.stationary}</div>
            <div className="text-[11px] font-semibold text-slate-400">Đang kê khai tại chỗ</div>
          </div>
        </div>

        {/* Tạm dừng hoạt động */}
        <div
          className={`p-3 rounded-2xl border transition shadow-xs flex items-center gap-3 ${
            isLight ? 'bg-white border-orange-200/80' : 'bg-slate-900 border-orange-500/20'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-orange-500/15 text-orange-400 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-black text-orange-400">{stats.idle}</div>
            <div className="text-[11px] font-semibold text-slate-400">Tạm dừng (&gt;3 phút)</div>
          </div>
        </div>

        {/* Ngoại tuyến */}
        <div
          className={`p-3 rounded-2xl border transition shadow-xs flex items-center gap-3 ${
            isLight ? 'bg-white border-rose-200/80' : 'bg-slate-900 border-rose-500/20'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0">
            <WifiOff className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-black text-rose-500">{stats.offline}</div>
            <div className="text-[11px] font-semibold text-slate-400">Ngoại tuyến (&gt;10 phút)</div>
          </div>
        </div>

        {/* Tổng quãng đường hôm nay */}
        <div
          className={`p-3 rounded-2xl border transition shadow-xs flex items-center gap-3 col-span-2 sm:col-span-1 ${
            isLight ? 'bg-white border-blue-200/80' : 'bg-slate-900 border-blue-500/20'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-black text-blue-400">{stats.totalKm} km</div>
            <div className="text-[11px] font-semibold text-slate-400">Tổng quãng đường hôm nay</div>
          </div>
        </div>
      </div>

      {/* 3. Bản đồ Thực địa & Danh sách Cán bộ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bản đồ Leaflet (2/3 màn hình) */}
        <div
          className={`lg:col-span-2 relative h-[520px] sm:h-[620px] rounded-2xl overflow-hidden border shadow-sm ${
            isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}
        >
          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Nút chuyển đổi kiểu bản đồ */}
          <div className="absolute top-3 right-3 z-[400] flex flex-col gap-2">
            <button
              type="button"
              onClick={toggleMapType}
              className={`p-2 rounded-xl text-xs font-bold transition shadow-md border cursor-pointer ${
                isLight
                  ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                  : 'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-slate-700'
              }`}
              title={mapType === 'satellite' ? 'Chuyển sang bản đồ đường sá' : 'Chuyển sang ảnh vệ tinh'}
            >
              <Layers className="w-4 h-4 text-cyan-400" />
            </button>
          </div>

          {/* Ghi chú ký hiệu trạng thái trên bản đồ */}
          <div className="absolute bottom-3 left-3 z-[400] bg-slate-900/90 backdrop-blur-md border border-slate-800 p-2.5 rounded-xl text-[11px] text-slate-300 space-y-1 shadow-lg hidden sm:block">
            <div className="font-bold text-xs text-white mb-1 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span>Ký hiệu Giám sát</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Đang di chuyển (Tốc độ &gt; 1.5 km/h)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <span>Đang đứng yên (Kê khai tại chỗ)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
              <span>Tạm dừng (&gt; 3 phút không đổi vị trí)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
              <span>Mất tín hiệu / Đã tắt ứng dụng (&gt; 10 phút)</span>
            </div>
          </div>
        </div>

        {/* Danh sách thẻ cán bộ (1/3 màn hình) */}
        <div className="space-y-3">
          <div
            className={`p-3.5 rounded-2xl border shadow-xs ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-black text-sm flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span>Đội Ngũ Cán Bộ ({cadres.length})</span>
              </div>
              <span className="text-[11px] text-slate-400">
                {stats.moving + stats.stationary} trực tuyến
              </span>
            </div>

            {/* Danh sách cuộn */}
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {cadres.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-3">
                  <div className="w-12 h-12 mx-auto rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500">
                    <Navigation className="w-6 h-6" />
                  </div>
                  <div className="text-xs font-semibold">Chưa có cán bộ nào phát sóng GPS</div>
                  <p className="text-[11px] text-slate-500 max-w-[220px] mx-auto">
                    Khi cán bộ mở trang thực địa và cấp quyền định vị, vị trí sẽ tự động xuất hiện tại đây.
                  </p>
                  <button
                    type="button"
                    onClick={handleSeedDemo}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-xs cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Chạy thử Demo</span>
                  </button>
                </div>
              ) : (
                cadres.map((cadre, idx) => {
                  const color = CADRE_COLORS[idx % CADRE_COLORS.length];
                  const isMoving = cadre.status === 'active_moving';
                  const isStationary = cadre.status === 'active_stationary';
                  const isIdle = cadre.status === 'idle';
                  const isOffline = cadre.status === 'offline';

                  const badgeClass = isMoving
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : isStationary
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : isIdle
                    ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                    : 'bg-rose-500/15 text-rose-400 border-rose-500/30';

                  const badgeLabel = isMoving
                    ? `🟢 Di chuyển ${cadre.speed || 0} km/h`
                    : isStationary
                    ? '🟡 Đứng yên'
                    : isIdle
                    ? '🟠 Tạm dừng'
                    : '🔴 Ngoại tuyến';

                  const isTrailOn = visibleTrails[cadre.cadreName] !== false;
                  const isSelected = selectedCadreName === cadre.cadreName;
                  const distKm = ((cadre.todayDistanceMeters || 0) / 1000).toFixed(2);

                  return (
                    <div
                      key={cadre.cadreName}
                      className={`p-3 rounded-xl border transition shadow-xs space-y-2.5 ${
                        isSelected
                          ? 'ring-2 ring-indigo-500 border-indigo-500 bg-indigo-500/10'
                          : isLight
                          ? 'bg-slate-50/80 hover:bg-white border-slate-200 hover:border-slate-300'
                          : 'bg-slate-950/60 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {/* Tiêu đề & Trạng thái */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center font-black text-xs text-white shadow-xs shrink-0"
                            style={{ backgroundColor: color }}
                          >
                            {cadre.cadreName.charAt(0)}
                          </div>
                          <div>
                            <div className="font-black text-xs sm:text-sm tracking-tight text-white flex items-center gap-1.5">
                              <span>{cadre.cadreName}</span>
                              {isMoving && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-1">
                              <span>{cadre.nearestVillage || 'Xã Cư Pui'}</span>
                              <span>•</span>
                              <span>{formatRelativeTime(cadre.lastUpdated)}</span>
                            </div>
                          </div>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${badgeClass}`}
                        >
                          {badgeLabel}
                        </span>
                      </div>

                      {/* Hoạt động & Quãng đường */}
                      <div className="text-[11px] space-y-1 bg-slate-900/50 p-2 rounded-lg border border-slate-800/60">
                        <div className="text-slate-300 font-semibold truncate flex items-center gap-1">
                          <span className="text-cyan-400 font-bold">Việc làm:</span>
                          <span className="truncate">{cadre.currentAction || 'Khảo sát thực địa'}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                          <span>Quãng đường: <b className="text-slate-200">{distKm} km</b></span>
                          <span>GPS: ±{cadre.accuracy}m</span>
                        </div>
                      </div>

                      {/* Các nút hành động */}
                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => toggleTrail(cadre.cadreName)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer border ${
                            isTrailOn
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs'
                              : isLight
                              ? 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
                          }`}
                          title="Bật/Tắt đường đi lộ trình"
                        >
                          {isTrailOn ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          <span>Lộ trình</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => focusCadre(cadre)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition shadow-xs cursor-pointer border border-cyan-500"
                          title="Xem vị trí trực tiếp trên bản đồ"
                        >
                          <LocateFixed className="w-3 h-3" />
                          <span>Định vị</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 15) return 'vừa xong';
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  return `${diffHour} giờ trước`;
}
