'use client';

import React, { useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, X, ShieldCheck, Download, ChevronLeft, ChevronRight, FileText, AlertCircle } from 'lucide-react';
import { getResolvedImageUrl } from '@/utils/geo';

interface VectorViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  svgUrl: string;
  urls?: string[];
  title: string;
  ownerName?: string;
  cccdNumber?: string;
}

export default function VectorViewerModal({
  isOpen,
  onClose,
  svgUrl,
  urls,
  title,
  ownerName,
  cccdNumber,
}: VectorViewerModalProps) {
  const [scale, setScale] = useState(1);
  const [activeIdx, setActiveIdx] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [retryWithProxy, setRetryWithProxy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Danh sách các ảnh cần hiển thị (nếu có urls thì lấy urls, ngược lại lấy [svgUrl])
  const imageList = urls && urls.length > 0 ? urls : [svgUrl];
  const currentPath = imageList[activeIdx] || svgUrl;

  // Tính URL thực tế
  const getImgSrc = () => {
    if (!currentPath) return '';
    if (retryWithProxy) {
      const cleanPath = currentPath.startsWith('/') ? currentPath : `/${currentPath}`;
      return `/api/image${cleanPath}`;
    }
    return getResolvedImageUrl(currentPath);
  };

  // Reset scale và trạng thái khi mở modal hoặc đổi ảnh
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setActiveIdx(0);
      setImgError(false);
      setRetryWithProxy(false);
      setIsLoading(true);
    }
  }, [isOpen, svgUrl, urls]);

  useEffect(() => {
    setScale(1);
    setImgError(false);
    setRetryWithProxy(false);
    setIsLoading(true);
  }, [activeIdx]);

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

  const handleImageError = () => {
    if (!retryWithProxy) {
      // Thử lại qua đường truyền proxy API nếu CDN R2 trực tiếp bị chặn
      console.warn('Lỗi tải CDN trực tiếp, đang thử kết nối qua proxy API...');
      setRetryWithProxy(true);
      setIsLoading(true);
    } else {
      setImgError(true);
      setIsLoading(false);
    }
  };

  const handleImageLoad = () => {
    setIsLoading(false);
    setImgError(false);
  };

  return (
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
              <h3 className="text-sm sm:text-lg font-black text-gray-900 truncate max-w-[200px] sm:max-w-none">
                {title}
              </h3>
              <span className="hidden xs:inline px-2 py-0.5 text-[10px] sm:text-[11px] font-extrabold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 shrink-0">
                Ảnh gốc sắc nét
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
              href={getImgSrc()}
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

        {/* Thanh chọn trang (Nếu có nhiều hơn 1 trang, ví dụ GCN nhiều trang) */}
        {imageList.length > 1 && (
          <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700 text-xs text-white shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              <span className="text-gray-400 text-[11px] mr-1 hidden sm:inline">Chọn trang:</span>
              {imageList.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveIdx(idx)}
                  className={`px-3 py-1 rounded-lg font-bold text-xs transition ${
                    activeIdx === idx
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-700/80 text-gray-300 hover:bg-slate-600'
                  }`}
                >
                  Trang {idx + 1}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={activeIdx === 0}
                onClick={() => setActiveIdx((prev) => Math.max(0, prev - 1))}
                className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 transition"
                title="Trang trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[11px] text-gray-300 px-1">
                {activeIdx + 1} / {imageList.length}
              </span>
              <button
                disabled={activeIdx === imageList.length - 1}
                onClick={() => setActiveIdx((prev) => Math.min(imageList.length - 1, prev + 1))}
                className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 transition"
                title="Trang sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Content Viewer (Scrollable) */}
        <div
          className="flex-1 overflow-auto bg-slate-900/90 p-4 sm:p-6 flex items-start justify-center cursor-grab active:cursor-grabbing relative"
          onWheel={(e) => {
            if (e.deltaY < 0) handleZoomIn();
            else handleZoomOut();
          }}
        >
          {/* Skeleton loading indicator */}
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/60 z-10">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
              <p className="text-xs text-blue-200 font-semibold">Đang tải ảnh hồ sơ scan...</p>
            </div>
          )}

          {imgError ? (
            <div className="flex flex-col items-center justify-center p-8 bg-white/10 rounded-2xl border border-white/20 text-white max-w-md text-center my-auto">
              <AlertCircle className="w-12 h-12 text-amber-400 mb-3" />
              <h4 className="text-sm font-bold">Không thể tải ảnh hồ sơ scan</h4>
              <p className="text-xs text-gray-300 mt-1 mb-4">
                Vui lòng kiểm tra lại kết nối mạng hoặc thử mở lại.
              </p>
              <button
                onClick={() => {
                  setImgError(false);
                  setIsLoading(true);
                  setRetryWithProxy(!retryWithProxy);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition"
              >
                Thử lại
              </button>
            </div>
          ) : (
            <div
              className="transition-transform duration-100 ease-out origin-top shadow-2xl rounded-xl overflow-hidden bg-white max-w-full"
              style={{ transform: `scale(${scale})` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getImgSrc()}
                alt={title}
                onError={handleImageError}
                onLoad={handleImageLoad}
                className="w-full max-w-[850px] h-auto select-none pointer-events-none object-contain"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-gray-100 bg-white text-xs text-gray-500 shrink-0">
          <span>
            Thu phóng: <strong className="text-blue-600 font-extrabold">{Math.round(scale * 100)}%</strong> (Dùng con lăn chuột hoặc nút bấm để zoom)
          </span>
          <span className="text-emerald-600 font-bold hidden sm:inline">
            ✓ Ảnh scan chất lượng cao từ Cloudflare R2
          </span>
        </div>
      </div>
    </div>
  );
}
