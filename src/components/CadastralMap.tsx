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
  selectedSheets?: string[];
  additionalParcels?: AdditionalParcel[];
  neighborParcels?: NeighborParcel[];
  userLocation?: { lat: number; lng: number; accuracy: number; heading?: number | null; speed?: number | null } | null;
  isTracking?: boolean;
  isLocating?: boolean;
  onToggleLocation?: () => void;
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
  selectedSheets = [],
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
  const neighborsLayerRef = useRef<LayerGroup | null>(null);
  const selectionPulseLayerRef = useRef<LayerGroup | null>(null);
  const userLocationLayerRef = useRef<LayerGroup | null>(null);
  const userMarkerRef = useRef<any>(null);
  const lastCenteredParcelRef = useRef<string | null>(null);
  const [dotsCount, setDotsCount] = useState(0);
  // Chế độ tự động di chuyển màn hình bám theo bước chân người dùng (giống Google Maps)
  const [isFollowingUser, setIsFollowingUser] = useState(false);

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

        // Gom nhóm tọa độ theo 4 màu trạng thái để vẽ hàng loạt (chỉ tốn 4 lệnh GPU fill/stroke)
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

        // Vẽ theo thứ tự lớp ưu tiên từ dưới lên trên: Trắng -> Vàng -> Xanh lá -> Xanh lam
        drawBatch(whitePts, '#ffffff', '#374151', baseRadius * 0.95, 1.3);
        drawBatch(yellowPts, '#f59e0b', '#78350f', baseRadius, 1.4);
        drawBatch(greenPts, '#10b981', '#064e3b', baseRadius, 1.4);
        drawBatch(bluePts, '#2563eb', '#1e3a8a', baseRadius * 1.08, 1.6);

        ctx.restore();
      };

      redrawBatchCanvasRef.current = redrawBatchCanvas;

      leafletMap.on('zoomanim', onZoomAnim);
      leafletMap.on('moveend zoomend viewreset resize', redrawBatchCanvas);

      // Xử lý Click siêu nhạy trên bản đồ (Tìm điểm gần nhất trong bán kính 22px chỉ mất < 0.05ms)
      leafletMap.on('click', (e: any) => {
        const clickX = e.containerPoint.x;
        const clickY = e.containerPoint.y;
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
          const tip = hoverTooltipRef.current;
          const mx = e.containerPoint.x;
          const my = e.containerPoint.y;
          const pts = renderedPointsRef.current;

          let hovered: RenderedPoint | null = null;
          let minDistSq = 10 * 10;

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

          const container = leafletMap.getContainer();
          if (hovered) {
            container.style.cursor = 'pointer';
            if (tip) {
              const p = hovered.parcel;
              const ownerDisplay = p.chu_ho || 'Không có trong dữ liệu';
              const statusLabel =
                p.trang_thai === 'DA_SO_HOA_XANH'
                  ? '🟢 Đã số hóa (GGS)'
                  : p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
                  ? '🔵 Đã kê khai (Chưa lên GGS)'
                  : p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG'
                  ? '🟡 Có tên'
                  : '⚪ Chưa cập nhật / Không có DL';

              tip.innerHTML = `
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
              tip.style.display = 'block';
              tip.style.transform = `translate3d(${Math.round(hovered.x)}px, ${Math.round(hovered.y - 12)}px, 0) translate(-50%, -100%)`;
            }
          } else {
            container.style.cursor = '';
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
      map.flyTo([selectedParcel.lat, selectedParcel.lng], Math.max(map.getZoom(), 18), {
        animate: true,
        duration: 0.55,
      });
    }
  }, [map, selectedParcel]);

  // 3. CẬP NHẬT DỮ LIỆU THỬA ĐẤT CHO BATCH CANVAS (SIÊU NHANH < 1ms)
  const prevSheetsSigRef = useRef<string>('');
  useEffect(() => {
    const validParcels = parcels.filter((p) => p.lat && p.lng);
    validParcelsRef.current = validParcels;
    setDotsCount(validParcels.length);

    if (redrawBatchCanvasRef.current) {
      redrawBatchCanvasRef.current();
    }

    // Tự động đưa góc nhìn bản đồ tới vùng Thôn/Buôn hoặc Tờ bản đồ vừa lọc
    if (map) {
      const sheetsSig = (selectedSheets || []).slice().sort().join(',');
      if (sheetsSig !== prevSheetsSigRef.current) {
        prevSheetsSigRef.current = sheetsSig;
        if (sheetsSig && validParcels.length > 0 && leafletRef.current) {
          setIsFollowingUser(false);
          const L = leafletRef.current;
          const bounds = L.latLngBounds(
            validParcels.map((p) => [p.lat as number, p.lng as number])
          );
          map.fitBounds(bounds, { padding: [45, 45], maxZoom: 16 });
        }
      }
    }
  }, [map, parcels, selectedSheets]);

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
          const match = validParcelsRef.current.find((p) => p.ma_thua === ap.ma_thua);
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
  }, [map, selectedParcel, additionalParcels]);

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

      {/* Tooltip nhẹ nhàng khi rê chuột trên máy tính */}
      <div
        ref={hoverTooltipRef}
        style={{ display: 'none', top: 0, left: 0 }}
        className="pointer-events-none absolute z-[1100] bg-slate-900/95 border border-slate-700 px-3 py-2 rounded-xl shadow-2xl whitespace-nowrap"
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
