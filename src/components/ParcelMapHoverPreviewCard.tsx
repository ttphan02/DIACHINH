'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, ExternalLink, Navigation, Copy, Check, Compass, Layers } from 'lucide-react';
import { Parcel } from '@/types';

interface ParcelMapHoverPreviewCardProps {
  parcel?: Parcel | null;
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
    const cardW = 390;
    const cardH = 340;

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

      const map = L.map(mapContainerRef.current, {
        center: [finalLat, finalLng],
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

      // Icon đánh dấu thửa đất nổi bật
      const customIcon = L.divIcon({
        className: 'custom-parcel-pin',
        html: `
          <div style="position: relative; transform: translate(-50%, -100%); pointer-events: none;">
            <div style="background: #ea580c; color: white; font-weight: 800; font-size: 11px; padding: 2px 7px; border-radius: 9999px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); border: 2px solid white; white-space: nowrap; text-align: center;">
              Thửa ${derivedThua || '?'}
            </div>
            <div style="width: 14px; height: 14px; background: #ea580c; border: 2.5px solid white; border-radius: 50%; margin: 2px auto 0 auto; box-shadow: 0 0 12px #ea580c;"></div>
          </div>
        `,
        iconSize: [0, 0],
      });

      L.marker([finalLat, finalLng], { icon: customIcon }).addTo(map);

      // Vòng tròn định vị thửa
      L.circle([finalLat, finalLng], {
        radius: 12,
        color: '#f59e0b',
        fillColor: '#f59e0b',
        fillOpacity: 0.25,
        weight: 2,
      }).addTo(map);

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
  }, [isOpen, finalLat, finalLng, derivedThua]);

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
              width: '390px',
              zIndex: 9999,
            }}
            className={`rounded-2xl shadow-2xl border overflow-hidden transition-all duration-150 animate-in fade-in zoom-in-95 ${
              isLight
                ? 'bg-white border-slate-300 shadow-slate-900/20 text-slate-800'
                : 'bg-slate-900 border-slate-700 shadow-black/60 text-slate-100'
            }`}
          >
            {/* Header Thửa Đất */}
            <div
              className={`p-3 border-b flex items-start justify-between gap-2 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/80 border-slate-800'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-extrabold text-sm text-amber-600 dark:text-amber-400 truncate">
                    Thửa {derivedThua || '?'} (Tờ {derivedTo || '?'})
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono shrink-0">
                    {maThua}
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mt-1 truncate">
                  {finalOwner ? (
                    <span>👤 {finalOwner}</span>
                  ) : (
                    <span className="italic text-slate-400">Chưa có tên chủ đất</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  📍 {finalThon || 'Xã Cư Pui, Krông Bông'}
                </div>
              </div>

              {(finalArea || finalType) && (
                <div className="text-right shrink-0">
                  {finalArea && (
                    <div className="text-xs font-bold text-blue-600 dark:text-blue-400">
                      {finalArea} m²
                    </div>
                  )}
                  {finalType && (
                    <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">
                      {finalType}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Khung Bản Đồ Vệ Tinh Thu Nhỏ */}
            <div className="relative w-full h-[220px] bg-slate-950 overflow-hidden">
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
              <div className="absolute top-2 left-2 z-10 pointer-events-none flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-[10px] text-white font-medium">
                <Layers className="w-3 h-3 text-amber-400" />
                <span>Vệ tinh Google Hybrid</span>
              </div>
            </div>

            {/* Footer Điều Hướng & Thao Tác */}
            <div
              className={`p-2.5 border-t flex items-center justify-between gap-2 text-xs ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/80 border-slate-800'
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
                      ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
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
                        ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
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
