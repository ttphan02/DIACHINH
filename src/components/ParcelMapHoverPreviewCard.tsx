'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, ExternalLink, Navigation, Copy, Check, Compass, Layers } from 'lucide-react';
import { Parcel } from '@/types';
import { calculateDistanceMeters, extractShortOwnerName } from '@/utils/geo';

interface ParcelMapHoverPreviewCardProps {
  parcel?: Parcel | null;
  allParcels?: Parcel[];
  maThua: string;
  soThua?: string;
  toBanDo?: string;
  chuHo?: string;
  thonXa?: string;
  dienTich?: string;
  loaiDat?: string;
  lat?: number | null;
  lng?: number | null;
  theme?: 'dark' | 'light';
  children: React.ReactNode;
}

export default function ParcelMapHoverPreviewCard({
  parcel,
  allParcels,
  maThua,
  soThua: propSoThua,
  toBanDo: propToBanDo,
  chuHo: propChuHo,
  thonXa: propThonXa,
  dienTich: propDienTich,
  loaiDat: propLoaiDat,
  lat: propLat,
  lng: propLng,
  theme = 'dark',
  children,
}: ParcelMapHoverPreviewCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [cardPos, setCardPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' }>({
    top: 0,
    left: 0,
    placement: 'bottom',
  });

  const triggerRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const openTimerRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Trích xuất thông tin thửa đất
  const finalLat = propLat ?? parcel?.lat ?? null;
  const finalLng = propLng ?? parcel?.lng ?? null;

  let derivedTo = propToBanDo || parcel?.to_ban_do || '';
  let derivedThua = propSoThua || parcel?.so_thua || '';
  if ((!derivedTo || !derivedThua) && maThua.includes('_')) {
    const parts = maThua.split('_');
    derivedTo = derivedTo || parts[0];
    derivedThua = derivedThua || parts[1];
  }

  const finalOwner = propChuHo || parcel?.chu_ho || '';
  const finalThon = propThonXa || parcel?.thon_xa || '';
  const finalArea = propDienTich || parcel?.dien_tich || '';
  const finalType = propLoaiDat || parcel?.loai_dat || '';

  const isLight = theme === 'light';

  useEffect(() => {
    setMounted(true);
  }, []);

  const calculatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const cardW = 420;
    const cardH = 370;

    // Căn theo lề trái của trigger, giữ trong màn hình
    let left = rect.left - 10;
    if (left + cardW > window.innerWidth - 16) {
      left = window.innerWidth - cardW - 16;
    }
    if (left < 16) left = 16;

    // Ưu tiên hiển thị phía dưới hoặc phía trên
    let top = rect.bottom + 8;
    let placement: 'top' | 'bottom' = 'bottom';

    if (top + cardH > window.innerHeight - 10) {
      // Nếu phía dưới không đủ chỗ thì hiển thị phía trên
      top = rect.top - cardH - 8;
      placement = 'top';
      if (top < 10) {
        top = Math.max(10, window.innerHeight - cardH - 10);
      }
    }

    setCardPos({ top, left, placement });
  };

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!isOpen) {
      openTimerRef.current = setTimeout(() => {
        calculatePosition();
        setIsOpen(true);
      }, 250);
    }
  };

  const handleMouseLeave = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 180);
  };

  // Khởi tạo mini-map Leaflet khi popup mở
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current || finalLat === null || finalLng === null) {
      return;
    }

    let isCancelled = false;

    import('leaflet').then((L) => {
      if (isCancelled || !mapContainerRef.current) return;

      // Hủy map cũ nếu có
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const centerLat = finalLat;
      const centerLng = finalLng;

      const map = L.map(mapContainerRef.current, {
        center: [centerLat, centerLng],
        zoom: 18,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
      });

      // Lớp ảnh vệ tinh Google Hybrid
      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      }).addTo(map);

      // Lọc nhanh các thửa đất lân cận trong bán kính ~350m
      const nearbyParcels = (allParcels || [])
        .filter((p) => {
          if (!p.lat || !p.lng || p.ma_thua === maThua) return false;
          return Math.abs((p.lat as number) - centerLat) < 0.0035 && Math.abs((p.lng as number) - centerLng) < 0.0035;
        })
        .map((p) => ({
          ...p,
          dist: calculateDistanceMeters(centerLat, centerLng, p.lat as number, p.lng as number),
        }))
        .filter((p) => p.dist <= 350)
        .sort((a, b) => a.dist - b.dist);

      // 1. Hiển thị lưới chấm màu cho tất cả các thửa lân cận xung quanh theo trạng thái
      nearbyParcels.forEach((p) => {
        let fillColor = '#ffffff';
        if (p.trang_thai === 'DA_SO_HOA_XANH') {
          fillColor = '#10b981';
        } else if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') {
          fillColor = '#2563eb';
        } else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') {
          fillColor = '#eab308';
        }

        L.circleMarker([p.lat as number, p.lng as number], {
          radius: 6,
          color: '#ffffff',
          fillColor: fillColor,
          fillOpacity: 0.95,
          weight: 1.5,
          interactive: false,
        }).addTo(map);
      });

      // 2. Thể hiện mạng lưới liên kết tới 6 thửa gần nhất (đường đứt nét + vòng định vị + nhãn tên)
      const closestNeighbors = nearbyParcels.slice(0, 6);
      closestNeighbors.forEach((nb) => {
        // Đường nối nét đứt xanh lam
        L.polyline(
          [
            [centerLat, centerLng],
            [nb.lat as number, nb.lng as number],
          ],
          {
            color: '#0284c7',
            weight: 2,
            dashArray: '4, 4',
            opacity: 0.85,
            interactive: false,
          }
        ).addTo(map);

        // Vòng tròn highlight thửa lân cận
        L.circleMarker([nb.lat as number, nb.lng as number], {
          radius: 11,
          color: '#0284c7',
          fillColor: '#38bdf8',
          fillOpacity: 0.22,
          weight: 2,
          dashArray: '3, 3',
          interactive: false,
        }).addTo(map);

        // Nhãn tên chủ hộ rút gọn hoặc số thửa
        const shortName = extractShortOwnerName(nb.chu_ho) || (nb.so_thua ? `Thửa ${nb.so_thua}` : '');
        if (shortName) {
          L.marker([nb.lat as number, nb.lng as number], {
            icon: L.divIcon({
              className: 'neighbor-badge-wrapper',
              html: `<span class="neighbor-name-badge">${shortName}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, 13],
            }),
            interactive: false,
            zIndexOffset: 1000,
          }).addTo(map);
        }
      });

      // 3. Hiệu ứng radar pulse đỏ cho thửa chính
      L.marker([centerLat, centerLng], {
        icon: L.divIcon({
          className: 'parcel-pulse-div-icon',
          html: `
            <div class="parcel-selected-pulse-wrapper">
              <div class="parcel-selected-pulse"></div>
            </div>
          `,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: false,
        zIndexOffset: 1200,
      }).addTo(map);

      // 4. Chấm tròn đỏ nổi bật cho thửa chính
      L.circleMarker([centerLat, centerLng], {
        radius: 11,
        color: '#ffffff',
        fillColor: '#dc2626',
        fillOpacity: 1,
        weight: 3.5,
      }).addTo(map);

      // 5. Thẻ tên nổi bật cho thửa chính
      const centerLabel = finalOwner ? extractShortOwnerName(finalOwner) : (derivedThua ? `Thửa ${derivedThua}` : '');
      if (centerLabel) {
        L.marker([centerLat, centerLng], {
          icon: L.divIcon({
            className: 'center-parcel-badge-wrapper',
            html: `<span class="center-parcel-name-badge" style="transform: translate(-50%, -100%); background: #dc2626 !important; color: #ffffff !important; font-family: 'Grandview', 'Bahnschrift', sans-serif; font-weight: 800; font-size: 11px; line-height: 1.2; padding: 3px 8px; min-width: 36px; text-align: center; border-radius: 6px; white-space: nowrap; display: inline-block; box-shadow: 0 2px 10px rgba(0,0,0,0.6); border: 2px solid #ffffff !important; pointer-events: none; user-select: none;">${centerLabel}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 14],
          }),
          interactive: false,
          zIndexOffset: 1500,
        }).addTo(map);
      }

      mapInstanceRef.current = map;
      setTimeout(() => {
        if (!isCancelled && mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 60);
    });

    return () => {
      isCancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isOpen, finalLat, finalLng, derivedThua, finalOwner, allParcels]);

  const copyCoordinates = () => {
    if (finalLat !== null && finalLng !== null) {
      navigator.clipboard.writeText(`${finalLat.toFixed(6)}, ${finalLng.toFixed(6)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const gmapsUrl = finalLat !== null && finalLng !== null
    ? `https://www.google.com/maps?q=${finalLat},${finalLng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Xã Cư Pui Thửa ${derivedThua} Tờ ${derivedTo}`)}`;

  const cadastralMapUrl = `/?selected=${encodeURIComponent(maThua)}`;

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-flex items-center"
      >
        {children}
      </div>

      {mounted &&
        isOpen &&
        createPortal(
          <div
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
              position: 'fixed',
              top: `${cardPos.top}px`,
              left: `${cardPos.left}px`,
              width: '420px',
              zIndex: 9999,
            }}
            className={`rounded-2xl shadow-2xl border overflow-hidden transition-all duration-150 animate-in fade-in zoom-in-95 ${
              isLight
                ? 'bg-white border-slate-300 shadow-slate-900/25 text-slate-900'
                : 'bg-slate-900 border-slate-700 shadow-black/70 text-slate-100'
            }`}
          >
            {/* Header Thửa Đất - Màu sắc tương phản cao, rõ ràng trên cả 2 giao diện */}
            <div
              className={`p-3 border-b flex items-start justify-between gap-2 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className={`font-extrabold text-sm truncate ${isLight ? 'text-amber-700' : 'text-amber-400'}`}>
                    Thửa {derivedThua || '?'} (Tờ {derivedTo || '?'})
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono font-bold shrink-0 ${
                      isLight
                        ? 'bg-slate-200 text-slate-800 border border-slate-300'
                        : 'bg-slate-800 text-slate-200 border border-slate-700'
                    }`}
                  >
                    {maThua}
                  </span>
                </div>
                <div className={`text-xs font-bold mt-1 truncate ${isLight ? 'text-slate-950' : 'text-white'}`}>
                  {finalOwner ? (
                    <span className="flex items-center gap-1">
                      <span className="opacity-75">👤</span>
                      <span>{finalOwner}</span>
                    </span>
                  ) : (
                    <span className="italic text-slate-400 font-normal">Chưa có tên chủ đất</span>
                  )}
                </div>
                <div className={`text-[11px] font-medium truncate mt-0.5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                  📍 {finalThon || 'Xã Cư Pui, Krông Bông'}
                </div>
              </div>

              {(finalArea || finalType) && (
                <div className="text-right shrink-0">
                  {finalArea && (
                    <div className={`text-xs font-black ${isLight ? 'text-blue-700' : 'text-blue-400'}`}>
                      {finalArea} m²
                    </div>
                  )}
                  {finalType && (
                    <div className={`text-[10px] font-bold uppercase mt-0.5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                      {finalType}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Khung Bản Đồ Vệ Tinh Thu Nhỏ Với Mạng Lưới Thửa Xung Quanh */}
            <div className="relative w-full h-[235px] bg-slate-950 overflow-hidden">
              {finalLat !== null && finalLng !== null ? (
                <div ref={mapContainerRef} className="w-full h-full" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-slate-400">
                  <Compass className="w-8 h-8 opacity-40 mb-2 animate-pulse" />
                  <span className="text-xs font-semibold">Chưa có tọa độ GPS cho thửa đất này</span>
                  <span className="text-[10px] text-slate-500 mt-1">Dữ liệu bản đồ đang được cập nhật</span>
                </div>
              )}

              {/* Tag Vệ Tinh Google */}
              <div className="absolute top-2 left-2 z-[400] pointer-events-none flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/65 backdrop-blur-xs text-[10px] text-white font-medium border border-white/10 shadow-xs">
                <Layers className="w-3 h-3 text-amber-400" />
                <span>Vệ tinh Google Hybrid</span>
              </div>

              {/* Legend trạng thái lưới thửa xung quanh */}
              <div className="absolute bottom-2 left-2 z-[400] pointer-events-none flex items-center gap-2 px-2 py-1 rounded-md bg-black/80 backdrop-blur-xs text-[9px] text-white font-medium border border-white/15 shadow-sm">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shadow-xs"></span>Số hóa
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block shadow-xs"></span>Kê khai
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block shadow-xs"></span>Có tên
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-white border border-slate-600 inline-block shadow-xs"></span>Chưa tên
                </span>
              </div>
            </div>

            {/* Footer Điều Hướng & Thao Tác */}
            <div
              className={`p-2.5 border-t flex items-center justify-between gap-2 text-xs ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
              }`}
            >
              {finalLat !== null && finalLng !== null ? (
                <button
                  type="button"
                  onClick={copyCoordinates}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                    copied
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : isLight
                      ? 'bg-white hover:bg-slate-100 text-slate-800 border-slate-300'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                  title="Sao chép tọa độ GPS"
                >
                  {copied ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Đã chép GPS' : `${finalLat.toFixed(4)}, ${finalLng.toFixed(4)}`}</span>
                </button>
              ) : (
                <span className="text-[11px] text-slate-400 italic">Thửa chưa có tọa độ</span>
              )}

              <div className="flex items-center gap-1.5 ml-auto">
                <a
                  href={cadastralMapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition cursor-pointer"
                  title="Mở thửa này trên Bản đồ số hóa địa chính toàn xã"
                >
                  <Navigation className="w-3 h-3" />
                  <span>Bản đồ số hóa</span>
                </a>

                {finalLat !== null && finalLng !== null && (
                  <a
                    href={gmapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`p-1 rounded-lg border transition cursor-pointer ${
                      isLight
                        ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    }`}
                    title="Mở vị trí thửa trên Google Maps"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
