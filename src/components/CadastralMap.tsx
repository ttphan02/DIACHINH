'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Parcel, NeighborParcel, AdditionalParcel } from '@/types';
import { extractShortOwnerName } from '@/utils/geo';
import { Maximize2, LocateFixed, Loader2, Compass } from 'lucide-react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
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

interface RenderedPoint {
  x: number; // Tọa độ containerPoint X
  y: number; // Tọa độ containerPoint Y
  parcel: Parcel;
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
  const outerContainerRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const leafletRef = useRef<any>(null);
  const canvasRendererRef = useRef<any>(null);
  const neighborsLayerRef = useRef<LayerGroup | null>(null);
  const selectionPulseLayerRef = useRef<LayerGroup | null>(null);
  const userLocationLayerRef = useRef<LayerGroup | null>(null);
  const userMarkerRef = useRef<any>(null);
  const lastCenteredParcelRef = useRef<string | null>(null);
  const [dotsCount, setDotsCount] = useState(0);

  // Kích thước khung chứa để bao phủ 100% màn hình khi xoay (Đường kính đường tròn ngoại tiếp D x D)
  const [containerDim, setContainerDim] = useState<{ w: number; h: number; d: number }>({
    w: typeof window !== 'undefined' ? window.innerWidth : 1920,
    h: typeof window !== 'undefined' ? window.innerHeight : 1080,
    d: typeof window !== 'undefined' ? Math.ceil(Math.hypot(window.innerWidth, window.innerHeight)) + 60 : 2260,
  });

  // Chế độ tự động di chuyển màn hình bám theo bước chân người dùng (giống Google Maps)
  const [isFollowingUser, setIsFollowingUser] = useState(false);

  // Góc xoay bản đồ (độ)
  const [bearing, setBearing] = useState<number>(0);
  const bearingRef = useRef<number>(0);
  useEffect(() => {
    bearingRef.current = bearing;
  }, [bearing]);

  // Trạng thái đang xoay quanh điểm
  const [isOrbiting, setIsOrbiting] = useState<boolean>(false);
  const isOrbitingRef = useRef<boolean>(false);

  // Tọa độ tâm neo xoay (screen pixel x, y)
  const [pivotScreen, setPivotScreen] = useState<{ x: number; y: number } | null>(null);
  const pivotScreenRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const holdTimerRef = useRef<any>(null);
  const startPointerRef = useRef<{ x: number; y: number; startBearing: number; startAngle: number } | null>(null);
  const didOrbitRef = useRef<boolean>(false);

  // Batch Canvas Layer refs (Vẽ hàng loạt 11.280 điểm chỉ trong 4 lệnh GPU thay vì 11.000 layer)
  const validParcelsRef = useRef<Parcel[]>([]);
  const renderedPointsRef = useRef<RenderedPoint[]>([]);
  const redrawBatchCanvasRef = useRef<(() => void) | null>(null);
  const hoverTooltipRef = useRef<HTMLDivElement>(null);

  // Giữ tham chiếu hàm chọn thửa để KHÔNG bao giờ phải khởi tạo lại sự kiện bản đồ
  const onSelectParcelRef = useRef(onSelectParcel);
  useEffect(() => {
    onSelectParcelRef.current = onSelectParcel;
  }, [onSelectParcel]);

  // Đo và cập nhật kích thước khung bao D x D tự động khi co giãn trình duyệt
  useEffect(() => {
    const updateDim = () => {
      if (!outerContainerRef.current) return;
      const rect = outerContainerRef.current.getBoundingClientRect();
      const w = rect.width || window.innerWidth;
      const h = rect.height || window.innerHeight;
      const d = Math.ceil(Math.hypot(w, h)) + 60;
      setContainerDim({ w, h, d });
      if (map) {
        map.invalidateSize();
        if (redrawBatchCanvasRef.current) {
          redrawBatchCanvasRef.current();
        }
      }
    };

    updateDim();
    window.addEventListener('resize', updateDim);
    return () => window.removeEventListener('resize', updateDim);
  }, [map]);

  // 1. Khởi tạo Leaflet Map với lớp ảnh vệ tinh Google Hybrid & Batch Canvas 60FPS
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isCancelled = false;

    import('leaflet').then((L) => {
      if (isCancelled || !mapContainerRef.current) return;

      if ((mapContainerRef.current as any)._leaflet_id) {
        return;
      }

      leafletRef.current = L;

      // Leaflet map instance tối ưu phần cứng
      const leafletMap = L.map(mapContainerRef.current, {
        center: [12.527, 108.493],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        fadeAnimation: false,
        zoomAnimation: true,
        markerZoomAnimation: true,
        inertia: true,
        inertiaDeceleration: 3000,
      });

      // Lớp ảnh vệ tinh Google Maps Hybrid (Trình duyệt tự động lưu cache vĩnh viễn trên RAM & ổ đĩa)
      const googleHybrid = L.tileLayer(
        'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        {
          subdomains: ['0', '1', '2', '3'],
          maxZoom: 22,
          maxNativeZoom: 20,
          updateWhenIdle: false,
          updateWhenZooming: true,
          keepBuffer: 16, // Giữ sẵn nhiều tile trong RAM trình duyệt để di chuyển không bị tải lại
        }
      );
      googleHybrid.addTo(leafletMap);

      // Tạo một thẻ <canvas> độc quyền duy nhất phủ lên bản đồ để vẽ hàng vạn thửa đất
      const PADDING = 0.5;
      const batchCanvas = document.createElement('canvas');
      batchCanvas.className = 'leaflet-zoom-animated pointer-events-none';
      batchCanvas.style.position = 'absolute';
      batchCanvas.style.left = '0px';
      batchCanvas.style.top = '0px';
      batchCanvas.style.zIndex = '400';
      batchCanvas.style.transformOrigin = '0 0';

      const mapPanes = leafletMap.getPanes();
      const overlayPane = mapPanes.overlayPane;
      overlayPane.appendChild(batchCanvas);

      const ctx = batchCanvas.getContext('2d', { alpha: true });

      let currentTopLeft = L.point(0, 0);

      const updateTransform = (center: any, zoom: number) => {
        const scale = leafletMap.getZoomScale(zoom, leafletMap.getZoom());
        const viewHalf = leafletMap.getSize().divideBy(2);
        const currentCenterPoint = leafletMap.project(leafletMap.getCenter(), zoom);
        const targetCenterPoint = leafletMap.project(center, zoom);
        const offset = targetCenterPoint.subtract(currentCenterPoint);

        const pos = currentTopLeft
          .multiplyBy(scale)
          .add(viewHalf.multiplyBy(1 - scale))
          .subtract(offset);

        L.DomUtil.setTransform(batchCanvas, pos, scale);
      };

      const onZoomAnim = (ev: any) => {
        updateTransform(ev.center, ev.zoom);
      };

      const redrawBatchCanvas = () => {
        if (!leafletMap || !(leafletMap as any)._loaded || !ctx) return;

        const size = leafletMap.getSize();
        if (size.x <= 0 || size.y <= 0) return;

        const padX = Math.round(size.x * PADDING);
        const padY = Math.round(size.y * PADDING);
        const width = size.x + padX * 2;
        const height = size.y + padY * 2;

        const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

        if (batchCanvas.width !== Math.round(width * dpr) || batchCanvas.height !== Math.round(height * dpr)) {
          batchCanvas.width = Math.round(width * dpr);
          batchCanvas.height = Math.round(height * dpr);
          batchCanvas.style.width = `${width}px`;
          batchCanvas.style.height = `${height}px`;
        }

        const topLeftLayerPt = leafletMap.containerPointToLayerPoint([-padX, -padY]);
        currentTopLeft = topLeftLayerPt;
        L.DomUtil.setPosition(batchCanvas, topLeftLayerPt);
        L.DomUtil.setTransform(batchCanvas, topLeftLayerPt, 1);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, batchCanvas.width, batchCanvas.height);
        ctx.scale(dpr, dpr);

        const zoom = leafletMap.getZoom();
        const bounds = leafletMap.getBounds().pad(PADDING);
        const allParcels = validParcelsRef.current;
        const rendered: RenderedPoint[] = [];

        const greenPts: number[] = [];
        const bluePts: number[] = [];
        const yellowPts: number[] = [];
        const whitePts: number[] = [];

        const useGridCull = zoom < 14;
        const cellSize = 3;
        const gridCols = useGridCull ? Math.ceil(width / cellSize) + 1 : 0;
        const gridRows = useGridCull ? Math.ceil(height / cellSize) + 1 : 0;
        const grid = useGridCull ? new Uint8Array(gridCols * gridRows) : null;

        for (let i = 0; i < allParcels.length; i++) {
          const p = allParcels[i];
          const lat = p.lat!;
          const lng = p.lng!;

          if (
            lat < bounds.getSouth() ||
            lat > bounds.getNorth() ||
            lng < bounds.getWest() ||
            lng > bounds.getEast()
          ) {
            continue;
          }

          const cp = leafletMap.latLngToContainerPoint([lat, lng]);
          const screenX = cp.x + padX;
          const screenY = cp.y + padY;

          if (screenX < 0 || screenX > width || screenY < 0 || screenY > height) {
            continue;
          }

          if (useGridCull && grid) {
            const gx = (screenX / cellSize) | 0;
            const gy = (screenY / cellSize) | 0;
            const gIdx = gy * gridCols + gx;
            if (grid[gIdx]) continue;
            grid[gIdx] = 1;
          }

          rendered.push({
            x: cp.x,
            y: cp.y,
            parcel: p,
          });

          const tt = p.trang_thai;
          if (tt === 'DA_SO_HOA_XANH') {
            greenPts.push(screenX, screenY);
          } else if (tt === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') {
            bluePts.push(screenX, screenY);
          } else if (tt === 'CO_TEN_CHUA_SO_HOA_VANG') {
            yellowPts.push(screenX, screenY);
          } else {
            whitePts.push(screenX, screenY);
          }
        }

        renderedPointsRef.current = rendered;

        const baseRadius = zoom <= 13 ? 4.2 : zoom <= 15 ? 5.2 : 6.2;
        const twoPi = Math.PI * 2;

        const drawBatch = (
          pts: number[],
          fillColor: string,
          strokeColor: string,
          radius: number,
          lineWidth: number
        ) => {
          if (pts.length === 0) return;
          ctx.beginPath();
          for (let i = 0; i < pts.length; i += 2) {
            const x = pts[i];
            const y = pts[i + 1];
            ctx.moveTo(x + radius, y);
            ctx.arc(x, y, radius, 0, twoPi);
          }
          ctx.fillStyle = fillColor;
          ctx.fill();
          ctx.lineWidth = lineWidth;
          ctx.strokeStyle = strokeColor;
          ctx.stroke();
        };

        // Vẽ theo thứ tự ưu tiên:
        // 1. Trắng sáng: Chưa có tên
        drawBatch(whitePts, '#ffffff', '#475569', baseRadius * 0.95, 1.4);
        // 2. Vàng nổi bật: Có tên chưa làm
        drawBatch(yellowPts, '#eab308', '#713f12', baseRadius * 0.95, 1.4);
        // 3. Xanh lá: Đã số hóa (Google Sheets)
        drawBatch(greenPts, '#10b981', '#064e3b', baseRadius, 1.4);
        // 4. Xanh lam: Đã kê khai (Web)
        drawBatch(bluePts, '#2563eb', '#1e3a8a', baseRadius * 1.08, 1.6);

        ctx.restore();
      };

      redrawBatchCanvasRef.current = redrawBatchCanvas;

      leafletMap.on('zoomanim', onZoomAnim);
      leafletMap.on('moveend zoomend viewreset resize', redrawBatchCanvas);

      // Xử lý Click siêu nhạy trên bản đồ (Tìm điểm gần nhất trong bán kính 22px chỉ mất < 0.05ms)
      leafletMap.on('click', (e: any) => {
        if (didOrbitRef.current) {
          didOrbitRef.current = false;
          return;
        }

        const outer = outerContainerRef.current;
        if (!outer) return;
        const outerRect = outer.getBoundingClientRect();
        const cx = outerRect.width / 2;
        const cy = outerRect.height / 2;

        let clickX = e.containerPoint.x;
        let clickY = e.containerPoint.y;

        // Nếu bản đồ đang xoay: giải mã ngược tọa độ click theo góc xoay quanh tâm
        const b = bearingRef.current;
        if (b !== 0 && e.originalEvent) {
          const screenX = e.originalEvent.clientX - outerRect.left;
          const screenY = e.originalEvent.clientY - outerRect.top;
          const rad = (-b * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const dx = screenX - cx;
          const dy = screenY - cy;
          const unrotScreenX = cx + (dx * cos - dy * sin);
          const unrotScreenY = cy + (dx * sin + dy * cos);

          const curD = Math.ceil(Math.hypot(outerRect.width, outerRect.height)) + 60;
          clickX = unrotScreenX - (cx - curD / 2);
          clickY = unrotScreenY - (cy - curD / 2);
        }

        const pts = renderedPointsRef.current;
        let bestParcel: Parcel | null = null;
        let minDistSq = 24 * 24; // Bán kính chạm 24px (dễ bấm trên màn hình điện thoại)

        for (let i = 0; i < pts.length; i++) {
          const pt = pts[i];
          const dx = pt.x - clickX;
          const dy = pt.y - clickY;
          const dSq = dx * dx + dy * dy;
          if (dSq < minDistSq) {
            minDistSq = dSq;
            bestParcel = pt.parcel;
          }
        }

        if (bestParcel) {
          onSelectParcelRef.current(bestParcel);
        }
      });

      // LayerGroup cho đường nối thửa lân cận & thửa gộp
      const neighborsLayer = L.layerGroup().addTo(leafletMap);
      neighborsLayerRef.current = neighborsLayer;

      // LayerGroup cho vòng xung tròn thửa được chọn
      const pulseLayer = L.layerGroup().addTo(leafletMap);
      selectionPulseLayerRef.current = pulseLayer;

      // LayerGroup cho vị trí GPS người dùng (Google Maps style)
      const userLocationLayer = L.layerGroup().addTo(leafletMap);
      userLocationLayerRef.current = userLocationLayer;

      setMap(leafletMap);
      requestAnimationFrame(() => redrawBatchCanvas());
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // ============================================================================
  // TÍNH NĂNG XOAY BẢN ĐỒ QUANH TÂM: GIỮ 1 ĐIỂM RỒI DI CHUỘT / NGÓN TAY ĐỂ XOAY
  // BẢN ĐỒ LUÔN TRÀN 100% TOÀN MÀN HÌNH - KHÔNG HỞ VIỀN ĐEN Ở MỌI GÓC XOAY
  // ============================================================================
  useEffect(() => {
    const outer = outerContainerRef.current;
    if (!outer) return;

    const activateOrbit = (clientX: number, clientY: number) => {
      const rect = outer.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      setPivotScreen({ x: px, y: py });
      pivotScreenRef.current = { x: px, y: py };

      isOrbitingRef.current = true;
      setIsOrbiting(true);
      didOrbitRef.current = true;

      if (map) {
        map.dragging.disable();
      }

      const startAngle = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;

      startPointerRef.current = {
        x: clientX,
        y: clientY,
        startBearing: bearingRef.current,
        startAngle,
      };

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(25);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      const isRightClick = e.button === 2;
      const isLeftClick = e.button === 0;

      if (!isRightClick && !isLeftClick && e.pointerType === 'mouse') return;

      if (isRightClick || e.shiftKey) {
        e.preventDefault();
        activateOrbit(e.clientX, e.clientY);
        return;
      }

      startPointerRef.current = {
        x: e.clientX,
        y: e.clientY,
        startBearing: bearingRef.current,
        startAngle: 0,
      };
      didOrbitRef.current = false;

      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        activateOrbit(e.clientX, e.clientY);
      }, 180);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!startPointerRef.current) return;

      const rect = outer.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const dx = e.clientX - startPointerRef.current.x;
      const dy = e.clientY - startPointerRef.current.y;
      const dist = Math.hypot(dx, dy);

      if (!isOrbitingRef.current && dist > 8) {
        clearTimeout(holdTimerRef.current);
        return;
      }

      if (isOrbitingRef.current) {
        // Tính góc xoay quanh tâm màn hình
        const currentAngle = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
        const delta = currentAngle - startPointerRef.current.startAngle;
        const newBearing = (startPointerRef.current.startBearing + delta) % 360;
        setBearing(newBearing);

        if (hoverTooltipRef.current) {
          hoverTooltipRef.current.style.display = 'none';
        }
      }
    };

    const handlePointerUp = () => {
      clearTimeout(holdTimerRef.current);

      if (isOrbitingRef.current) {
        isOrbitingRef.current = false;
        setIsOrbiting(false);
        setPivotScreen(null);

        if (map) {
          map.dragging.enable();
        }

        setTimeout(() => {
          didOrbitRef.current = false;
        }, 120);
      }
      startPointerRef.current = null;
    };

    outer.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      clearTimeout(holdTimerRef.current);
      outer.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [map]);

  // Tự động thích ứng kích thước bản đồ
  useEffect(() => {
    if (!map || !mapContainerRef.current) return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      if (redrawBatchCanvasRef.current) {
        redrawBatchCanvasRef.current();
      }
    });
    observer.observe(mapContainerRef.current);
    return () => observer.disconnect();
  }, [map]);

  // Cập nhật và lọc danh sách thửa đất hợp lệ
  useEffect(() => {
    const valid: Parcel[] = [];
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      if (typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng)) {
        if (HIDDEN_PARCEL_SET.has(p.ma_thua)) continue;
        const ld = (p.loai_dat || '').trim().toUpperCase();
        if (ld === 'BCS') {
          const dt = parseFloat(String(p.dien_tich || '').replace(',', '.'));
          if (!isNaN(dt) && dt < 100) continue;
        }
        valid.push(p);
      }
    }
    validParcelsRef.current = valid;
    setDotsCount(valid.length);

    if (redrawBatchCanvasRef.current) {
      redrawBatchCanvasRef.current();
    }
  }, [parcels]);

  // Tự động bay tới thửa đất được chọn (Zoom mượt mà + Bù lề trên điện thoại)
  useEffect(() => {
    if (!map || !selectedParcel || !selectedParcel.lat || !selectedParcel.lng) {
      lastCenteredParcelRef.current = null;
      return;
    }

    const forceZoom = (selectedParcel as any)._forceZoom;
    if (lastCenteredParcelRef.current !== selectedParcel.ma_thua || forceZoom) {
      lastCenteredParcelRef.current = selectedParcel.ma_thua;
      setIsFollowingUser(false);

      const targetZoom = Math.max(map.getZoom(), 18);
      let targetCenter: [number, number] = [selectedParcel.lat, selectedParcel.lng];

      const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
      if (isMobile && isBottomPanelActive) {
        try {
          const container = map.getContainer();
          const height = container.clientHeight || 800;
          const dy = height * 0.28;
          const centerPoint = map.latLngToContainerPoint(targetCenter);
          const L = leafletRef.current;
          if (L) {
            const offsetPoint = L.point(centerPoint.x, centerPoint.y + dy);
            const offsetLatLng = map.containerPointToLatLng(offsetPoint);
            targetCenter = [offsetLatLng.lat, offsetLatLng.lng];
          }
        } catch {
          targetCenter = [selectedParcel.lat, selectedParcel.lng];
        }
      }

      map.flyTo(targetCenter, targetZoom, {
        animate: true,
        duration: 0.8,
      });
    }
  }, [map, selectedParcel, isBottomPanelActive]);

  // Vẽ vòng tròn phát xung đỏ (Radar Pulse) cho thửa chính và thửa gộp kèm theo
  useEffect(() => {
    if (!map || !selectionPulseLayerRef.current) return;
    const pulseLayer = selectionPulseLayerRef.current;
    pulseLayer.clearLayers();

    if (!selectedParcel || !selectedParcel.lat || !selectedParcel.lng) return;

    import('leaflet').then((L) => {
      // Vòng xung đỏ thửa chính
      const pulseIcon = L.divIcon({
        className: 'parcel-selected-pulse-wrapper',
        html: `
          <div class="parcel-selected-pulse"></div>
          <div style="position: absolute; top: 0; left: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; background: #dc2626; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 12px rgba(220, 38, 38, 0.9);"></div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      L.marker([selectedParcel.lat!, selectedParcel.lng!], {
        icon: pulseIcon,
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(pulseLayer);

      // Thửa gộp kèm theo (màu cam)
      if (additionalParcels && additionalParcels.length > 0) {
        additionalParcels.forEach((ap, idx) => {
          const match = validParcelsRef.current.find((p) => p.ma_thua === ap.ma_thua);
          if (!match?.lat || !match?.lng) return;

          L.polyline(
            [
              [selectedParcel.lat!, selectedParcel.lng!],
              [match.lat, match.lng],
            ],
            {
              color: '#f97316',
              weight: 2.5,
              dashArray: '4, 4',
              opacity: 0.9,
            }
          ).addTo(pulseLayer);

          const addIcon = L.divIcon({
            className: 'parcel-additional-pulse-wrapper',
            html: `
              <div class="parcel-additional-pulse"></div>
              <div style="position: absolute; top: 0; left: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; background: #f97316; border: 2px solid #ffffff; border-radius: 50%;"></div>
              <span class="parcel-additional-badge">+${idx + 1}</span>
            `,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });

          const m = L.marker([match.lat, match.lng], {
            icon: addIcon,
            interactive: true,
            zIndexOffset: 950,
          }).addTo(pulseLayer);

          m.on('click', () => {
            onSelectParcelRef.current(match);
          });
        });
      }
    });
  }, [map, selectedParcel, additionalParcels]);

  // Vẽ mạng lưới thửa lân cận xung quanh thửa đang chọn
  useEffect(() => {
    if (!map || !neighborsLayerRef.current) return;
    const neighborsLayer = neighborsLayerRef.current;
    neighborsLayer.clearLayers();

    if (!selectedParcel || !selectedParcel.lat || !selectedParcel.lng || !neighborParcels || neighborParcels.length === 0) {
      return;
    }

    import('leaflet').then((L) => {
      neighborParcels.slice(0, 8).forEach((nb) => {
        if (!nb.lat || !nb.lng) return;

        L.polyline(
          [
            [selectedParcel.lat!, selectedParcel.lng!],
            [nb.lat, nb.lng],
          ],
          {
            color: '#94a3b8',
            weight: 1.5,
            dashArray: '3, 4',
            opacity: 0.7,
          }
        ).addTo(neighborsLayer);

        const shortOwner = extractShortOwnerName(nb.chu_ho);
        const nbIcon = L.divIcon({
          className: 'neighbor-label-badge',
          html: `
            <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid #38bdf8; border-radius: 6px; padding: 2px 6px; color: #fff; font-size: 10px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">
              ${nb.so_thua} • <span style="color: #38bdf8;">${shortOwner}</span>
            </div>
          `,
          iconSize: [0, 0],
          iconAnchor: [0, 22],
        });

        const m = L.marker([nb.lat, nb.lng], {
          icon: nbIcon,
          interactive: true,
          zIndexOffset: 900,
        }).addTo(neighborsLayer);

        m.on('click', () => {
          const match = validParcelsRef.current.find((p) => p.ma_thua === nb.ma_thua);
          if (match) {
            onSelectParcelRef.current(match);
          }
        });
      });
    });
  }, [map, selectedParcel, neighborParcels]);

  // Vị trí GPS người dùng di chuyển Realtime (Chế độ bám bước chân Google Maps)
  useEffect(() => {
    if (!map || !userLocationLayerRef.current) return;
    const layer = userLocationLayerRef.current;

    if (!userLocation) {
      layer.clearLayers();
      userMarkerRef.current = null;
      return;
    }

    import('leaflet').then((L) => {
      if (!userMarkerRef.current) {
        const userIcon = L.divIcon({
          className: 'user-location-marker',
          html: `
            <div class="user-pulse"></div>
            <div style="position: absolute; top: 0; left: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; background: #2563eb; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 10px rgba(37, 99, 235, 0.8);"></div>
          `,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });

        const m = L.marker([userLocation.lat, userLocation.lng], {
          icon: userIcon,
          zIndexOffset: 2000,
        }).addTo(layer);

        userMarkerRef.current = m;
      } else {
        userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
      }

      if (isFollowingUser) {
        map.panTo([userLocation.lat, userLocation.lng], { animate: true, duration: 0.5 });
      }
    });
  }, [map, userLocation, isFollowingUser]);

  // Bay tới vị trí GPS của người dùng
  const handleFlyToUserLocation = useCallback(() => {
    if (!userLocation) {
      if (onToggleLocation) onToggleLocation();
      return;
    }
    if (!map) return;

    setIsFollowingUser(true);
    map.flyTo([userLocation.lat, userLocation.lng], 18.5, {
      animate: true,
      duration: 1,
    });
  }, [map, userLocation, onToggleLocation]);

  // Xem toàn bộ xã Cư Pui
  const handleFitAll = useCallback(() => {
    if (!map) return;
    map.flyTo([12.527, 108.493], 13.5, {
      animate: true,
      duration: 0.8,
    });
  }, [map]);

  // Đặt lại hướng Bắc (0°)
  const handleResetNorth = useCallback(() => {
    setBearing(0);
  }, []);

  return (
    <div
      ref={outerContainerRef}
      className="relative w-full h-full overflow-hidden bg-slate-900 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* VÙNG CHỨA BẢN ĐỒ LEAFLET NGOẠI TIẾP (D x D): XOAY TỰ DO KHÔNG BAO GIỜ BỊ HỞ VIỀN ĐEN */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${containerDim.d}px`,
          height: `${containerDim.d}px`,
          transform: `translate(-50%, -50%) rotate(${bearing}deg)`,
          transformOrigin: '50% 50%',
          transition: isOrbiting ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <div ref={mapContainerRef} className="w-full h-full bg-slate-900" />
      </div>

      {/* TÂM NEO XOAY (HIỂN THỊ KHI NHẤN GIỮ ĐIỂM ĐỂ XOAY) */}
      {isOrbiting && pivotScreen && (
        <div
          style={{
            left: `${pivotScreen.x}px`,
            top: `${pivotScreen.y}px`,
          }}
          className="pointer-events-none absolute z-[1200] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center animate-in fade-in zoom-in-75 duration-150"
        >
          <div className="relative flex items-center justify-center">
            <div className="w-14 h-14 rounded-full border-2 border-cyan-400 border-dashed animate-spin duration-7000"></div>
            <div className="absolute w-5 h-5 rounded-full bg-cyan-500/40 border-2 border-white shadow-[0_0_14px_rgba(6,182,212,1)] animate-ping"></div>
            <div className="absolute w-3.5 h-3.5 rounded-full bg-cyan-400 border-2 border-white shadow-md"></div>
          </div>
          <span className="mt-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-200 bg-slate-950/90 px-2.5 py-1 rounded-full border border-cyan-400/50 shadow-xl backdrop-blur-sm whitespace-nowrap">
            ⚓ Đang xoay bản đồ
          </span>
        </div>
      )}

      {/* Tooltip khi rê chuột trên máy tính (luôn nằm ngang chuẩn xác, không xoay chữ) */}
      <div
        ref={hoverTooltipRef}
        style={{ display: 'none', top: 0, left: 0 }}
        className="pointer-events-none fixed z-[1100] bg-slate-900/95 border border-slate-700 px-3 py-2 rounded-xl shadow-2xl whitespace-nowrap backdrop-blur-md"
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
