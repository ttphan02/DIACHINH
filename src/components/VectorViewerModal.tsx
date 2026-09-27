'use client';

import React, { useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, X, ShieldCheck, Download } from 'lucide-react';
import { getResolvedSvgUrl } from '@/utils/geo';

interface VectorViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  svgUrl: string;
  title: string;
  ownerName?: string;
  cccdNumber?: string;
}

export default function VectorViewerModal({
  isOpen,
  onClose,
  svgUrl,
  title,
  ownerName,
  cccdNumber,
}: VectorViewerModalProps) {
  const [scale, setScale] = useState(1);

  // Reset scale when opening a new SVG
  useEffect(() => {
    if (isOpen) {
      setScale(1);
    }
  }, [isOpen, svgUrl]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleZoomIn = () => setScale((prev) => Math.min(prev + 0.3, 4.5));
  const handleZoomOut = () => setScale((prev) => Math.max(prev - 0.3, 0.5));
  const handleReset = () => setScale(1);

  return (
    /* z-[99999] ĐẢM BẢO NỔI TUYỆT ĐỐI LÊN TRÊN BẢN ĐỒ LEAFLET (Leaflet dùng z-index từ 400 đến 1000) */
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 p-2 sm:p-6 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex flex-col w-full max-w-4xl h-[95vh] sm:h-[92vh] bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 sm:px-5 py-2.5 sm:py-3.5 border-b border-gray-100 bg-gray-50/90 shrink-0">
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 shrink-0" />
              <h3 className="text-sm sm:text-lg font-black text-gray-900 truncate max-w-[180px] sm:max-w-none">{title}</h3>
              <span className="hidden xs:inline px-2 py-0.5 text-[10px] sm:text-[11px] font-extrabold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 shrink-0">
                Ảnh rõ nét
              </span>
            </div>
            {ownerName && (
              <p className="text-xs text-gray-600 mt-0.5">
                Chủ đất: <strong className="text-gray-900">{ownerName}</strong>
                {cccdNumber ? ` • CCCD: ${cccdNumber}` : ''}
              </p>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={handleZoomIn}
              className="p-2 text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition flex items-center gap-1 text-xs font-bold"
              title="Phóng to"
            >
              <ZoomIn className="w-4 h-4" />
              <span className="hidden sm:inline">Phóng to</span>
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition flex items-center gap-1 text-xs font-bold"
              title="Thu nhỏ"
            >
              <ZoomOut className="w-4 h-4" />
              <span className="hidden sm:inline">Thu nhỏ</span>
            </button>
            <button
              onClick={handleReset}
              className="p-2 text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition flex items-center gap-1 text-xs font-bold"
              title="Đặt lại kích thước"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="hidden sm:inline">Đặt lại</span>
            </button>

            <a
              href={getResolvedSvgUrl(svgUrl)}
              download
              target="_blank"
              rel="noreferrer"
              className="p-2 text-gray-700 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition flex items-center gap-1 text-xs font-bold"
              title="Tải ảnh về máy"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Tải về</span>
            </a>

            <div className="w-[1px] h-6 bg-gray-200 mx-1" />

            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition"
              title="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Viewer (Scrollable) */}
        <div
          className="flex-1 overflow-auto bg-slate-900/90 p-6 flex items-start justify-center cursor-grab active:cursor-grabbing"
          onWheel={(e) => {
            if (e.deltaY < 0) handleZoomIn();
            else handleZoomOut();
          }}
        >
          <div
            className="transition-transform duration-100 ease-out origin-top shadow-2xl rounded-xl overflow-hidden bg-white"
            style={{ transform: `scale(${scale})` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getResolvedSvgUrl(svgUrl)}
              alt="CCCD Vector Preview"
              className="w-[720px] max-w-none h-auto select-none pointer-events-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-gray-100 bg-white text-xs text-gray-500 shrink-0">
          <span>
            Thu phóng: <strong className="text-blue-600 font-extrabold">{Math.round(scale * 100)}%</strong> (Dùng con lăn chuột hoặc nút bấm để zoom)
          </span>
          <span className="text-emerald-600 font-bold hidden sm:inline">
            ✓ Định dạng đồ họa Vector SVG: Phóng to không bao giờ bị vỡ hạt
          </span>
        </div>
      </div>
    </div>
  );
}
