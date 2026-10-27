'use client';

import React, { useState, useRef } from 'react';
import { Eye, ExternalLink, FileText, User, CreditCard, HardDrive, Loader2 } from 'lucide-react';

interface CccdHoverPreviewProps {
  fileUrl: string;
  filename: string;
  cccdNumber?: string;
  ownerName?: string;
  fileSize?: string | number;
  children: React.ReactNode;
  theme?: 'dark' | 'light';
}

export default function CccdHoverPreviewCard({
  fileUrl,
  filename,
  cccdNumber,
  ownerName,
  fileSize,
  children,
  theme = 'dark',
}: CccdHoverPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [align, setAlign] = useState<'center' | 'left' | 'right'>('center');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (containerRef.current && typeof window !== 'undefined') {
      const rect = containerRef.current.getBoundingClientRect();
      const cardHeight = 360;
      const cardWidth = 380;

      // Định vị dọc: Nếu phía trên không đủ 360px, hiển thị xuống phía dưới
      if (rect.top < cardHeight && window.innerHeight - rect.bottom > cardHeight) {
        setPlacement('bottom');
      } else {
        setPlacement('top');
      }

      // Định vị ngang: Tránh tràn mép trái/phải màn hình
      if (rect.left < cardWidth / 2) {
        setAlign('left');
      } else if (window.innerWidth - rect.right < cardWidth / 2) {
        setAlign('right');
      } else {
        setAlign('center');
      }
    }

    // Xem ngay: Delay 100ms nhẹ để tránh giật khi lướt chuột nhanh
    timeoutRef.current = setTimeout(() => {
      setIsOpen(true);
      setIsLoading(true);
    }, 100);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const isLight = theme === 'light';
  const isPdf = Boolean(filename && /\.pdf($|\?)/i.test(filename)) || Boolean(fileUrl && /\.pdf($|\?)/i.test(fileUrl));

  const placementClasses = placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';
  const alignClasses =
    align === 'left'
      ? 'left-0'
      : align === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';

  if (!fileUrl) {
    return <>{children}</>;
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      {isOpen && (
        <div
          className={`absolute z-50 ${placementClasses} ${alignClasses} w-96 rounded-2xl p-3 shadow-2xl border transition-all duration-150 animate-in fade-in zoom-in-95 pointer-events-auto ${
            isLight
              ? 'bg-white border-slate-200 text-slate-800 shadow-slate-300'
              : 'bg-slate-900 border-indigo-500/40 text-slate-100 shadow-black/80'
          }`}
          style={{ width: '380px' }}
        >
          {/* Header Card */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-700/50">
            <div className="flex items-center gap-1.5 text-indigo-400 min-w-0">
              <FileText className="w-4 h-4 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider truncate">
                Xem Trước CCCD
              </span>
            </div>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`p-1 rounded-lg transition text-xs font-semibold flex items-center gap-1 shrink-0 ${
                isLight
                  ? 'hover:bg-slate-100 text-indigo-600'
                  : 'hover:bg-slate-800 text-indigo-300'
              }`}
              title="Mở file trong tab mới"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="text-[10px]">Mở tab mới</span>
            </a>
          </div>

          {/* Info Details (Tên chủ hộ & Số CCCD) */}
          <div className="space-y-1 text-xs mb-2">
            {ownerName && (
              <div className="flex items-center justify-between">
                <span className={`text-[11px] flex items-center gap-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  <User className="w-3 h-3 text-emerald-400" /> Chủ hộ:
                </span>
                <span className={`font-bold truncate max-w-[220px] ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  {ownerName}
                </span>
              </div>
            )}

            {cccdNumber && (
              <div className="flex items-center justify-between">
                <span className={`text-[11px] flex items-center gap-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  <CreditCard className="w-3 h-3 text-indigo-400" /> Số CCCD:
                </span>
                <span className="font-mono font-bold text-indigo-400 tracking-wide">
                  {cccdNumber}
                </span>
              </div>
            )}
          </div>

          {/* KHUNG XEM TRỰC TIẾP TÀI LIỆU CCCD (PDF / Ảnh) */}
          <div
            className={`relative w-full h-56 rounded-xl overflow-hidden border flex items-center justify-center ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-950 border-slate-800'
            }`}
          >
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 bg-slate-900/60 backdrop-blur-xs text-indigo-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-[11px] font-medium text-slate-300">Đang hiển thị CCCD...</span>
              </div>
            )}

            {isPdf ? (
              <iframe
                src={`${fileUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                className="w-full h-full border-0 pointer-events-none bg-white rounded-lg"
                title={filename}
                onLoad={() => setIsLoading(false)}
              />
            ) : (
              <img
                src={fileUrl}
                alt={filename}
                className="w-full h-full object-contain rounded-lg"
                onLoad={() => setIsLoading(false)}
              />
            )}
          </div>

          {/* Footer Card */}
          <div className="flex items-center justify-between pt-2 mt-1 text-[10px] text-slate-400">
            <span className="truncate max-w-[180px] font-mono" title={filename}>
              {filename}
            </span>
            <span className="text-indigo-400 font-medium">Bấm nút để phóng to toàn màn hình</span>
          </div>

          {/* Arrow Pointer */}
          <div
            className={`absolute ${
              placement === 'top'
                ? 'top-full border-t-slate-900'
                : 'bottom-full border-b-slate-900'
            } ${
              align === 'left'
                ? 'left-6'
                : align === 'right'
                ? 'right-6'
                : 'left-1/2 -translate-x-1/2'
            } border-4 border-transparent ${
              isLight ? (placement === 'top' ? 'border-t-white' : 'border-b-white') : ''
            }`}
          />
        </div>
      )}
    </div>
  );
}
