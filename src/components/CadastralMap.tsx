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
  const startPointerRef = useRef<{ x: number; y: number; startBearing: number } | null>(null);
  const didOrbitRef = useRef<boolean>(false);

  // Batch Canvas Layer refs (Vẽ hàng loạt 18.000 điểm chỉ trong 4 lệnh GPU thay vì 18.000 layer)
  const validParcelsRef = useRef<Parcel[]>([]);
  const renderedPointsRef = useRef<RenderedPoint[]>([]);
  const redrawBatchCanvasRef = useRef<(() => void) | null>(null);
  const hoverTooltipRef = useRef<HTMLDivElement>(null);

  // Giữ tham chiếu hàm chọn thửa để KHÔNG bao giờ phải khởi tạo lại sự kiện bản đồ
  const onSelectParcelRef = useRef(onSelectParcel);
  useEffect(() => {
    onSelectParcelRef.current = onSelectParcel;
  }, [onSelectParcel]);

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
      const canvasRenderer = L.canvas({ padding: 0.3 });
      canvasRendererRef.current = canvasRenderer;

      const leafletMap = L.map(mapContainerRef.current, {
        center: [12.527, 108.493],
        zoom: 13,
        zoomControl: false,
        preferCanvas: true,
        renderer: canvasRenderer,
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true,
        inertia: true,
        inertiaDeceleration: 3000,
        inertiaMaxSpeed: 2500,
        worldCopyJump: false,
      });

      // Khi người dùng chủ động lấy tay kéo bản đồ -> tắt tự động khóa tâm GPS để tự do xem thửa khác
      leafletMap.on('dragstart', () => {
        setIsFollowingUser(false);
        if (hoverTooltipRef.current) {
          hoverTooltipRef.current.style.display = 'none';
        }
      });

      // Điều khiển thu phóng góc dưới bên phải
      L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);

      // Ảnh vệ tinh kèm đường & địa danh Google Hybrid (Tối ưu bộ nhớ đệm tile mượt như Google Maps)
      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps',
        updateWhenIdle: false,
        updateWhenZooming: false,
        keepBuffer: 4,
      }).addTo(leafletMap);

      // ============================================================================
      // LỚP BATCH CANVAS TÙY CHỈNH SIÊU MƯỢT (60 FPS TRÊN MỌI ĐIỆN THOẠI YẾU)
      // Thay vì tạo 9.350 đối tượng L.circleMarker gây nghẽn CPU khi kéo/zoom,
      // ta dùng 1 thẻ <canvas> duy nhất với Viewport Culling + 4 lệnh vẽ gộp theo màu.
      // ============================================================================
      const PADDING = 0.25;
      const batchCanvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated') as HTMLCanvasElement;
      batchCanvas.style.pointerEvents = 'none';
      batchCanvas.style.position = 'absolute';
      batchCanvas.style.top = '0';
      batchCanvas.style.left = '0';
      batchCanvas.style.zIndex = '250';

      const overlayPane = leafletMap.getPanes().overlayPane;
      overlayPane.appendChild(batchCanvas);

      let canvasCenter = leafletMap.getCenter();
      let canvasZoom = leafletMap.getZoom();

      const updateTransform = (center: any, zoom: number) => {
        const scale = leafletMap.getZoomScale(zoom, canvasZoom);
        const position = L.DomUtil.getPosition(batchCanvas);
        const viewHalf = leafletMap.getSize().multiplyBy(0.5 + PADDING);
        const currentCenterPoint = leafletMap.project(canvasCenter, zoom);
        const destCenterPoint = leafletMap.project(center, zoom);
        const centerOffset = destCenterPoint.subtract(currentCenterPoint);
        const topLeftOffset = viewHalf
          .multiplyBy(-scale)
          .add(position)
          .add(viewHalf)
          .subtract(centerOffset);

        L.DomUtil.setTransform(batchCanvas, topLeftOffset, scale);
      };

      const onZoomAnim = (ev: any) => {
        updateTransform(ev.center, ev.zoom);
      };

      const redrawBatchCanvas = () => {
        if (!leafletMap || !(leafletMap as any)._loaded) return;

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
        L.DomUtil.setPosition(batchCanvas, topLeftLayerPt);
        canvasCenter = leafletMap.getCenter();
        canvasZoom = leafletMap.getZoom();

        const ctx = batchCanvas.getContext('2d');
        if (!ctx) return;

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const list = validParcelsRef.current;
        if (list.length === 0) {
          renderedPointsRef.current = [];
          ctx.restore();
          return;
        }

        // 1. Viewport Culling: Chỉ xét những thửa nằm trong vùng nhìn thấy (+25% lề)
        const bounds = leafletMap.getBounds().pad(PADDING);
        const south = bounds.getSouth();
        const north = bounds.getNorth();
        const west = bounds.getWest();
        const east = bounds.getEast();

        // 2. Pixel Grid Deduplication ở mức zoom nhỏ để tránh vẽ chồng hàng nghìn điểm lên cùng 1 pixel
        const zoom = canvasZoom;
        const useGridCull = zoom <= 15;
        const cellSize = zoom <= 12 ? 6 : zoom <= 14 ? 4 : 3;
        const gridCols = useGridCull ? Math.ceil(width / cellSize) + 1 : 0;
        const gridRows = useGridCull ? Math.ceil(height / cellSize) + 1 : 0;
        const grid = useGridCull ? new Uint8Array(gridCols * gridRows) : null;

        // Gom nhóm tọa độ để vẽ hàng loạt:
        // - Xanh lá: Đã số hóa (Google Sheets)
        // - Xanh lam: Đã kê khai (Web)
        // - Vàng: Chưa kê khai CÓ TÊN (Tên người)
        // - Trắng: Chưa kê khai CHƯA CÓ TÊN (Không phải tên người, địa danh...)
        const greenPts: number[] = [];
        const bluePts: number[] = [];
        const yellowPts: number[] = [];
        const whitePts: number[] = [];
        const visibleScreenPts: RenderedPoint[] = [];

        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const lat = p.lat as number;
          const lng = p.lng as number;

          if (lat < south || lat > north || lng < west || lng > east) continue;

          const containerPt = leafletMap.latLngToContainerPoint([lat, lng]);
          const cx = containerPt.x + padX;
          const cy = containerPt.y + padY;

          if (cx < -10 || cx > width + 10 || cy < -10 || cy > height + 10) continue;

          // Ưu tiên giữ các chấm Đã kê khai (Xanh lam) hoặc Đã số hóa (Xanh lá) không bị lọc lưới ở zoom xa
          const isHighPriority =
            p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM' || p.trang_thai === 'DA_SO_HOA_XANH';

          if (grid && !isHighPriority) {
            const gx = (cx / cellSize) | 0;
            const gy = (cy / cellSize) | 0;
            if (gx >= 0 && gx < gridCols && gy >= 0 && gy < gridRows) {
              const idx = gy * gridCols + gx;
              if (grid[idx] !== 0) continue;
              grid[idx] = 1;
            }
          }

          visibleScreenPts.push({
            x: containerPt.x,
            y: containerPt.y,
            parcel: p,
          });

          if (p.trang_thai === 'DA_SO_HOA_XANH') {
            greenPts.push(cx, cy);
          } else if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') {
            bluePts.push(cx, cy);
          } else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') {
            yellowPts.push(cx, cy);
          } else {
            // Thửa chưa kê khai & chưa có tên / địa danh -> màu trắng sáng
            whitePts.push(cx, cy);
          }
        }

        renderedPointsRef.current = visibleScreenPts;

        // Kích thước chấm tự động thích ứng theo độ thu phóng để nhìn thoáng như Google Maps
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

        // Vẽ theo thứ tự lớp ưu tiên từ dưới lên:
        // 1. Trắng sáng: Chưa kê khai & Chưa có tên (Không phải tên người, địa danh...)
        drawBatch(whitePts, '#ffffff', '#475569', baseRadius * 0.95, 1.4);

        // 2. Vàng nổi bật: Chưa kê khai & Có tên người
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

        const container = mapContainerRef.current;
        let clickX = e.containerPoint.x;
        let clickY = e.containerPoint.y;

        // Nếu bản đồ đang xoay: chuyển đổi tọa độ click về hệ quy chiếu chuẩn của canvas
        const b = bearingRef.current;
        if (b !== 0 && container && e.originalEvent) {
          const rect = container.getBoundingClientRect();
          const rad = (-b * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const ps = pivotScreenRef.current;
          const dx = e.originalEvent.clientX - ps.x;
          const dy = e.originalEvent.clientY - ps.y;
          const unrotScreenX = ps.x + (dx * cos - dy * sin);
          const unrotScreenY = ps.y + (dx * sin + dy * cos);
          clickX = unrotScreenX - rect.left;
          clickY = unrotScreenY - rect.top;
        }

        const pts = renderedPointsRef.current;
        let bestParcel: Parcel | null = null;
        let minDistSq = 22 * 22; // Bán kính chạm 22px (dễ bấm trên màn hình cảm ứng điện thoại)

        for (let i = pts.length - 1; i >= 0; i--) {
          const item = pts[i];
          const dx = item.x - clickX;
          const dy = item.y - clickY;
          const distSq = dx * dx + dy * dy;
          if (distSq <= minDistSq) {
            minDistSq = distSq;
            bestParcel = item.parcel;
          }
        }

        if (bestParcel) {
          onSelectParcelRef.current(bestParcel);
        }
      });

      // Xử lý Hover nhẹ nhàng trên máy tính (Không chạy trên điện thoại cảm ứng)
      const isTouchDevice =
        typeof window !== 'undefined' &&
        (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);

      if (!isTouchDevice) {
        leafletMap.on('mousemove', (e: any) => {
          if (isOrbitingRef.current) return;
          const tip = hoverTooltipRef.current;
          const container = mapContainerRef.current;
          let mx = e.containerPoint.x;
          let my = e.containerPoint.y;

          const b = bearingRef.current;
          if (b !== 0 && container && e.originalEvent) {
            const rect = container.getBoundingClientRect();
            const rad = (-b * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const ps = pivotScreenRef.current;
            const dx = e.originalEvent.clientX - ps.x;
            const dy = e.originalEvent.clientY - ps.y;
            const unrotScreenX = ps.x + (dx * cos - dy * sin);
            const unrotScreenY = ps.y + (dx * sin + dy * cos);
            mx = unrotScreenX - rect.left;
            my = unrotScreenY - rect.top;
          }

          const pts = renderedPointsRef.current;
          let hovered: RenderedPoint | null = null;
          let minDistSq = 12 * 12;

          for (let i = pts.length - 1; i >= 0; i--) {
            const item = pts[i];
            const dx = item.x - mx;
            const dy = item.y - my;
            const d2 = dx * dx + dy * dy;
            if (d2 <= minDistSq) {
              minDistSq = d2;
              hovered = item;
            }
          }

          const containerDom = leafletMap.getContainer();
          if (hovered) {
            containerDom.style.cursor = 'pointer';
            if (tip) {
              const p = hovered.parcel;
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
              tip.style.transform = `translate3d(${Math.round(e.originalEvent.clientX)}px, ${Math.round(e.originalEvent.clientY - 14)}px, 0) translate(-50%, -100%)`;
            }
          } else {
            containerDom.style.cursor = '';
            if (tip) {
              tip.style.display = 'none';
            }
          }
        });

        leafletMap.on('mouseout', () => {
          if (hoverTooltipRef.current) {
            hoverTooltipRef.current.style.display = 'none';
          }
        });
      }

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
      requestAnimationFrame(() => redrawBatchCanvas());
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // ============================================================================
  // TÍNH NĂNG XOAY BẢN ĐỒ: GIỮ 1 ĐIỂM RỒI DI CHUỘT / NGÓN TAY ĐỂ XOAY QUANH ĐIỂM (PIVOT ORBIT)
  // ============================================================================
  useEffect(() => {
    const outer = outerContainerRef.current;
    if (!outer) return;

    const activateOrbit = (clientX: number, clientY: number) => {
      const rect = outer.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      setPivotScreen({ x: px, y: py });
      pivotScreenRef.current = { x: px, y: py };

      startPointerRef.current = {
        x: clientX,
        y: clientY,
        startBearing: bearingRef.current,
      };

      isOrbitingRef.current = true;
      setIsOrbiting(true);
      didOrbitRef.current = true;

      // Khóa kéo bản đồ Leaflet
      if (map) {
        map.dragging.disable();
      }

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(25);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && !e.isPrimary) {
        clearTimeout(holdTimerRef.current);
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;

      didOrbitRef.current = false;

      // Chuột phải hoặc Shift+click trên PC -> Xoay tức thì
      if ((e.pointerType === 'mouse' && e.button === 2) || e.shiftKey || e.ctrlKey) {
        activateOrbit(e.clientX, e.clientY);
        return;
      }

      // Nhấn giữ 1 điểm (~180ms) rồi xoay bằng chuột hoặc ngón tay
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        activateOrbit(e.clientX, e.clientY);
      }, 180);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isOrbitingRef.current) {
        if (startPointerRef.current) {
          const dx = e.clientX - startPointerRef.current.x;
          const dy = e.clientY - startPointerRef.current.y;
          if (Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 24 : 14)) {
            clearTimeout(holdTimerRef.current);
          }
        }
        return;
      }

      const start = startPointerRef.current;
      if (!start) return;

      const initialBearing = start.startBearing;
      const dx = e.clientX - start.x;

      // Kéo chuột / ngón tay để xoay bản đồ
      const newBearing = initialBearing + dx * 0.45;
      setBearing(newBearing);
    };

    const handlePointerUp = () => {
      clearTimeout(holdTimerRef.current);
      if (isOrbitingRef.current) {
        isOrbitingRef.current = false;
        setIsOrbiting(false);
        if (map) {
          map.dragging.enable();
        }
        setTimeout(() => {
          didOrbitRef.current = false;
        }, 100);
      }
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
          const centerPt = map.project(targetCenter, targetZoom);
          const offsetPt = centerPt.add([0, dy]);
          const offsetLatLng = map.unproject(offsetPt, targetZoom);
          targetCenter = [offsetLatLng.lat, offsetLatLng.lng];
        } catch {
          targetCenter = [selectedParcel.lat, selectedParcel.lng];
        }
      }

      map.flyTo(targetCenter, targetZoom, {
        animate: true,
        duration: 0.8,
        easeLinearity: 0.25,
      });
    }
  }, [map, selectedParcel, isBottomPanelActive]);

  // Hiệu ứng thửa đang chọn kê khai (thửa chính + thửa gộp)
  useEffect(() => {
    if (!map || !selectionPulseLayerRef.current) return;
    const group = selectionPulseLayerRef.current;
    group.clearLayers();

    if (!selectedParcel?.lat || !selectedParcel?.lng) return;

    let isMounted = true;
    const createSelectionPulse = (L: any) => {
      if (!isMounted) return;

      const mainCenter: [number, number] = [selectedParcel.lat as number, selectedParcel.lng as number];

      // Radar Pulse cho thửa chính
      const pulseDiv = L.divIcon({
        className: 'parcel-selected-pulse-wrapper',
        html: `
          <div class="parcel-selected-pulse"></div>
          <div style="position: absolute; top: 0; left: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; background: #dc2626; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 14px rgba(220, 38, 38, 0.9);"></div>
        `,
        iconSize: [0, 0],
      });
      L.marker(mainCenter, { icon: pulseDiv, interactive: false, zIndexOffset: 1000 }).addTo(group);

      // Thửa gộp bổ sung
      if (additionalParcels && additionalParcels.length > 0) {
        const validParcels = validParcelsRef.current;
        additionalParcels.forEach((add, index) => {
          const match = validParcels.find((p) => p.ma_thua === add.ma_thua);
          if (match?.lat && match?.lng) {
            const addCenter: [number, number] = [match.lat, match.lng];

            L.polyline([mainCenter, addCenter], {
              color: '#f97316',
              weight: 2.5,
              dashArray: '4, 4',
              opacity: 0.9,
            }).addTo(group);

            const addDiv = L.divIcon({
              className: 'parcel-additional-pulse-wrapper',
              html: `
                <div class="parcel-additional-pulse"></div>
                <div style="position: absolute; top: 0; left: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; background: #f97316; border: 2px solid #ffffff; border-radius: 50%;"></div>
                <span class="parcel-additional-badge">+${index + 1}</span>
              `,
              iconSize: [0, 0],
            });
            const m = L.marker(addCenter, { icon: addDiv, zIndexOffset: 900 }).addTo(group);
            m.on('click', () => onSelectParcelRef.current(match));
          }
        });
      }
    };

    if (leafletRef.current) {
      createSelectionPulse(leafletRef.current);
    } else {
      import('leaflet').then((L) => {
        leafletRef.current = L;
        createSelectionPulse(L);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [map, selectedParcel, additionalParcels]);

  // Mạng lưới các thửa lân cận
  useEffect(() => {
    if (!map || !neighborsLayerRef.current) return;
    const group = neighborsLayerRef.current;
    group.clearLayers();

    if (!selectedParcel?.lat || !selectedParcel?.lng || !neighborParcels || neighborParcels.length === 0) {
      return;
    }

    let isMounted = true;
    const createNeighbors = (L: any) => {
      if (!isMounted) return;

      const mainCenter: [number, number] = [selectedParcel.lat as number, selectedParcel.lng as number];

      neighborParcels.slice(0, 8).forEach((neighbor) => {
        if (!neighbor.lat || !neighbor.lng) return;
        const neighborCenter: [number, number] = [neighbor.lat, neighbor.lng];

        L.polyline([mainCenter, neighborCenter], {
          color: '#0284c7',
          weight: 2,
          dashArray: '3, 4',
          opacity: 0.85,
        }).addTo(group);

        const shortName = extractShortOwnerName(neighbor.chu_ho);
        const neighborDiv = L.divIcon({
          className: 'neighbor-badge-wrapper',
          html: `
            <div style="position: absolute; top: 0; left: 0; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; border: 2px dashed #0284c7; background: rgba(56, 189, 248, 0.25);"></div>
            ${shortName ? `<span class="neighbor-name-badge">${shortName}</span>` : ''}
          `,
          iconSize: [0, 0],
        });

        const m = L.marker(neighborCenter, { icon: neighborDiv, zIndexOffset: 800 }).addTo(group);
        m.on('click', () => onSelectParcelRef.current(neighbor));
      });
    };

    if (leafletRef.current) {
      createNeighbors(leafletRef.current);
    } else {
      import('leaflet').then((L) => {
        leafletRef.current = L;
        createNeighbors(L);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [map, selectedParcel, neighborParcels]);

  // Vị trí GPS người dùng di chuyển (Google Maps style)
  useEffect(() => {
    if (!map || !userLocationLayerRef.current) return;
    const group = userLocationLayerRef.current;

    if (!userLocation) {
      group.clearLayers();
      userMarkerRef.current = null;
      return;
    }

    let isMounted = true;
    const createGpsMarker = (L: any) => {
      if (!isMounted) return;

      const { lat, lng } = userLocation;

      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([lat, lng]);
        if (isFollowingUser) {
          map.panTo([lat, lng], { animate: true, duration: 0.4 });
        }
        return;
      }

      group.clearLayers();

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
    const validParcels = validParcelsRef.current;
    if (validParcels.length === 0) return;

    setIsFollowingUser(false);
    import('leaflet').then((L) => {
      const bounds = L.latLngBounds(
        validParcels.map((p) => [p.lat as number, p.lng as number])
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    });
  }, [map]);

  // Bấm nút La bàn: Reset góc xoay về hướng Bắc (0 độ)
  const handleResetNorth = useCallback(() => {
    setBearing(0);
  }, []);

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
    <div
      ref={outerContainerRef}
      className="relative w-full h-full overflow-hidden bg-slate-900 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* VÙNG CHỨA BẢN ĐỒ CÓ THỂ XOAY QUANH ĐIỂM ĐƯỢC CHỌN */}
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: bearing !== 0 ? `rotate(${bearing}deg)` : undefined,
          transformOrigin: pivotScreen ? `${pivotScreen.x}px ${pivotScreen.y}px` : '50% 50%',
          transition: isOrbiting ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
        className="w-full h-full"
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
            ⚓ Đang xoay quanh điểm
          </span>
        </div>
      )}

      {/* Tooltip khi rê chuột trên máy tính (luôn giữ ngang chuẩn, không bị xoay nghiêng) */}
      <div
        ref={hoverTooltipRef}
        style={{ display: 'none', top: 0, left: 0 }}
        className="pointer-events-none fixed z-[1100] bg-slate-900/95 border border-slate-700 px-3 py-2 rounded-xl shadow-2xl whitespace-nowrap backdrop-blur-md"
      />

      {/* Desktop Toolbar đơn giản góc trên bên phải */}
      <div className="absolute top-[56px] right-3.5 z-[1000] hidden lg:flex items-center gap-2 bg-slate-950/90 px-3 py-1.5 rounded-2xl shadow-2xl border border-slate-700/60 text-xs text-white">
        <button
          onClick={handleFitBounds}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold transition border border-slate-600/50 cursor-pointer"
          title="Thu phóng vừa toàn bộ các thửa"
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

      {/* Bảng chú thích màu sắc trạng thái thửa đất trên bản đồ */}
      <div className="absolute top-[96px] right-3.5 z-[1000] hidden lg:flex items-center gap-2.5 bg-slate-950/90 px-3.5 py-1.5 rounded-2xl shadow-xl border border-slate-700/60 text-[11px] text-slate-200 select-none">
        <span className="flex items-center gap-1.5 font-bold text-red-400">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-white" /> Đang chọn kê khai
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

      {/* NÚT TRÒN ĐỊNH VỊ VỊ TRÍ ĐANG ĐỨNG (GOOGLE MAPS STYLE - CÓ CHẾ ĐỘ BÁM BƯỚC CHÂN) */}
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
            className="cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-[11px] font-extrabold px-3 py-1.5 rounded-2xl shadow-xl border border-emerald-400/50 flex items-center gap-1.5 animate-bounce active:scale-95 transition"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
            <span>Chạm để Bật GPS</span>
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
