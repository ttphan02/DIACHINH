'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  ExternalLink,
  Download,
} from 'lucide-react';

interface PdfViewerProps {
  url: string;
  title?: string;
  compact?: boolean;
  theme?: 'dark' | 'light';
  className?: string;
  onOpenFullModal?: () => void;
  showActions?: boolean;
}

export default function PdfViewer({
  url,
  title,
  compact = false,
  theme = 'dark',
  className = '',
  onOpenFullModal,
  showActions = true,
}: PdfViewerProps) {
  const isImage = /\.(jpe?g|png|webp|gif|svg)($|\?)/i.test(url);
  const [numPages, setNumPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1.0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pan / Dragging
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  // 1. Tải tài liệu PDF bằng PDF.js từ ArrayBuffer
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setErrorMsg(null);
    setCurrentPage(1);
    setZoom(1.0);
    setPan({ x: 0, y: 0 });

    if (isImage) {
      // Đối với định dạng ảnh, trình duyệt hiển thị trực tiếp
      setIsLoading(false);
      return;
    }

    async function loadPdf() {
      try {
        if (!(window as any).pdfjsLib) {
          await new Promise<void>((resolve, reject) => {
            const existingScript = document.querySelector('script[data-pdfjs="1"]');
            if (existingScript) {
              if ((window as any).pdfjsLib) {
                resolve();
                return;
              }
              existingScript.addEventListener('load', () => resolve());
              existingScript.addEventListener('error', reject);
              setTimeout(() => {
                if ((window as any).pdfjsLib) resolve();
              }, 1500);
              return;
            }
            const script = document.createElement('script');
            script.src = '/pdfjs/pdf.min.js';
            script.setAttribute('data-pdfjs', '1');
            script.onload = () => resolve();
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        const pdfjsLib = (window as any).pdfjsLib;
        if (!pdfjsLib) throw new Error('Không thể khởi tạo PDF engine');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';

        // Tải nhị phân an toàn qua fetch ArrayBuffer
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.arrayBuffer();

        if (isCancelled) return;

        const loadingTask = pdfjsLib.getDocument({
          data,
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (isCancelled) return;

        pdfDocRef.current = doc;
        setNumPages(doc.numPages || 1);
        setIsLoading(false);
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Lỗi nạp PDF:', err);
          setErrorMsg(err?.message || 'Không thể đọc nội dung file PDF');
          setIsLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
    };
  }, [url, isImage]);

  // 2. Vẽ trang PDF lên HTML Canvas (Độ phân giải cao x2 để khi phóng to không bị mờ)
  const renderPage = useCallback(async () => {
    if (isImage || !pdfDocRef.current || !canvasRef.current || !containerRef.current) return;

    try {
      const page = await pdfDocRef.current.getPage(currentPage);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }

      const containerW = containerRef.current.clientWidth || 400;
      const containerH = containerRef.current.clientHeight || 300;

      // Tính scale cơ bản để vừa vặn khung xem (Fit to container)
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const scaleX = (containerW - (compact ? 12 : 24)) / unscaledViewport.width;
      const scaleY = (containerH - (compact ? 12 : 24)) / unscaledViewport.height;
      const fitScale = Math.max(0.1, Math.min(scaleX, scaleY) || 0.6);

      // Render với độ phân giải cao (tối thiểu x1.8 để nét căng khi zoom)
      const renderScale = Math.max(fitScale, 1.0) * (window.devicePixelRatio || 1.5) * 1.5;
      const viewport = page.getViewport({ scale: renderScale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Kích thước hiển thị CSS
      canvas.style.width = `${unscaledViewport.width * fitScale}px`;
      canvas.style.height = `${unscaledViewport.height * fitScale}px`;

      const renderContext = {
        canvasContext: ctx,
        viewport,
      };

      renderTaskRef.current = page.render(renderContext);
      await renderTaskRef.current.promise;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.warn('Lỗi vẽ canvas trang PDF:', err);
      }
    }
  }, [currentPage, compact, isImage]);

  useEffect(() => {
    if (!isLoading && !errorMsg && !isImage) {
      renderPage();
    }
  }, [isLoading, errorMsg, isImage, renderPage]);

  // Lắng nghe thay đổi kích thước khung hình
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!isImage && !isLoading && !errorMsg) {
          renderPage();
        }
      }, 200);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
    };
  }, [renderPage, isImage, isLoading, errorMsg]);

  // Điều khiển Zoom
  const handleZoomIn = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setZoom((prev) => Math.min(3.5, Math.round((prev + 0.25) * 100) / 100));
  };

  const handleZoomOut = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setZoom((prev) => {
      const next = Math.max(0.6, Math.round((prev - 0.25) * 100) / 100);
      if (next <= 1.0) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  // Cuộn chuột để Zoom mượt mà
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    setZoom((prev) => {
      const next = Math.min(3.5, Math.max(0.6, Math.round((prev + delta) * 100) / 100));
      if (next <= 1.0) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  // Nhấp đúp để phóng to nhanh (175%) hoặc quay về 100%
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (zoom > 1.1) {
      handleResetZoom();
    } else {
      setZoom(1.8);
    }
  };

  // Kéo rê (Pan)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1.0) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const isLight = theme === 'light';

  return (
    <div
      className={`relative w-full h-full flex flex-col select-none overflow-hidden ${
        isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950 text-slate-100'
      } ${className}`}
    >
      {/* 1. THANH ĐIỀU KHIỂN (TOOLBAR) */}
      <div
        className={`flex items-center justify-between px-2.5 py-1.5 border-b z-20 shrink-0 ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
        }`}
      >
        {/* Phân trang (nếu có nhiều hơn 1 trang) */}
        <div className="flex items-center gap-1.5">
          {numPages > 1 && !isImage && (
            <div className="flex items-center gap-1 text-[11px] font-medium mr-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentPage((p) => Math.max(1, p - 1));
                  setPan({ x: 0, y: 0 });
                }}
                className="p-1 rounded hover:bg-slate-500/20 disabled:opacity-30 cursor-pointer"
                title="Trang trước"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-xs font-semibold">
                {currentPage}/{numPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= numPages}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentPage((p) => Math.min(numPages, p + 1));
                  setPan({ x: 0, y: 0 });
                }}
                className="p-1 rounded hover:bg-slate-500/20 disabled:opacity-30 cursor-pointer"
                title="Trang tiếp"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Công cụ Zoom: [-] [100%] [+] */}
          <div
            className={`flex items-center rounded-lg border text-[11px] font-semibold ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-800 border-slate-700'
            }`}
          >
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1.5 hover:bg-slate-500/20 rounded-l transition cursor-pointer"
              title="Thu nhỏ (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="px-2 font-mono text-[10px] hover:bg-slate-500/20 transition cursor-pointer"
              title="Nhấp để đặt lại kích thước vừa khung"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1.5 hover:bg-slate-500/20 rounded-r transition cursor-pointer"
              title="Phóng to (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleResetZoom}
            className={`p-1.5 rounded-lg transition cursor-pointer text-xs ${
              isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-slate-800 text-slate-400'
            }`}
            title="Vừa khung"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Các nút tiện ích bên phải */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-[10px] text-slate-400 hidden sm:inline">
            {zoom > 1 ? 'Kéo để rê • Cuộn chuột để zoom' : 'Cuộn chuột hoặc nhấp đúp để zoom'}
          </span>

          {onOpenFullModal && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFullModal();
              }}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                isLight ? 'hover:bg-slate-200 text-indigo-600' : 'hover:bg-slate-800 text-indigo-400'
              }`}
              title="Phóng to xem toàn màn hình"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

          {showActions && (
            <>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-slate-800 text-slate-400'
                }`}
                title="Mở tài liệu trong tab mới"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <a
                href={url}
                download={title || (isImage ? 'image.jpg' : 'document.pdf')}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-slate-800 text-slate-400'
                }`}
                title="Tải file về máy"
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            </>
          )}
        </div>
      </div>

      {/* 2. KHU VỰC HIỂN THỊ (HỖ TRỢ ZOOM VÀ PAN) */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`relative flex-1 w-full h-full flex items-center justify-center overflow-hidden p-2 ${
          zoom > 1.0 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        }`}
      >
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 z-30 text-indigo-400 backdrop-blur-xs">
            <Loader2 className="w-7 h-7 animate-spin mb-2" />
            <span className="text-xs font-semibold text-slate-200">Đang hiển thị tài liệu...</span>
          </div>
        )}

        {errorMsg ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-rose-400 z-10">
            <AlertCircle className="w-8 h-8 mb-2 opacity-80" />
            <p className="text-xs font-bold mb-1">Không thể hiển thị tài liệu</p>
            <p className="text-[11px] text-slate-400 max-w-xs mb-3">{errorMsg}</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Tải hoặc mở liên kết trực tiếp</span>
            </a>
          </div>
        ) : isImage ? (
          <div
            className="flex items-center justify-center transition-transform duration-75 max-w-full max-h-full"
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transformOrigin: 'center center',
            }}
          >
            <img
              src={url}
              alt={title || 'Tài liệu'}
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setErrorMsg('Không thể nạp tệp hình ảnh');
                setIsLoading(false);
              }}
              className="max-w-full max-h-full object-contain rounded-lg shadow-xl border border-slate-700/40 bg-white"
            />
          </div>
        ) : (
          <div
            className="flex items-center justify-center transition-transform duration-75"
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transformOrigin: 'center center',
            }}
          >
            <canvas
              ref={canvasRef}
              className="max-w-none rounded-lg shadow-xl border border-slate-700/40 bg-white"
            />
          </div>
        )}
      </div>
    </div>
  );
}
