'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Eye,
  ExternalLink,
  Download,
  Maximize2,
  Copy,
  Check,
  FileText,
  CreditCard,
  HardDrive,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface CccdHoverPreviewProps {
  fileUrl: string;
  filename: string;
  cccdNumber?: string;
  ownerName?: string;
  fileSize?: string | number;
  children: React.ReactNode;
  theme?: 'dark' | 'light';
  onOpenFullModal?: () => void;
}

export default function CccdHoverPreviewCard({
  fileUrl,
  filename,
  cccdNumber,
  ownerName,
  children,
  theme = 'dark',
  onOpenFullModal,
}: CccdHoverPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [renderError, setRenderError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [cardPos, setCardPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' }>({
    top: 0,
    left: 0,
    placement: 'top',
  });

  const triggerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const calculatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const cardW = Math.min(440, window.innerWidth - 32);
    const cardH = 460;

    // Căn theo cạnh phải của nút trigger để tránh tràn mép phải màn hình
    let left = rect.right - cardW;
    if (left < 16) left = 16;
    if (left + cardW > window.innerWidth - 16) {
      left = window.innerWidth - cardW - 16;
    }

    // Ưu tiên hiển thị phía trên nút bấm; nếu không đủ chỗ thì hiển thị phía dưới
    let top = rect.top - cardH - 10;
    let placement: 'top' | 'bottom' = 'top';
    if (top < 10) {
      top = rect.bottom + 10;
      placement = 'bottom';
      if (top + cardH > window.innerHeight - 10) {
        top = Math.max(10, window.innerHeight - cardH - 10);
      }
    }

    setCardPos({ top, left, placement });
  };

  const isPdf = /\.pdf($|\?)/i.test(filename || fileUrl);

  // Render PDF trực tiếp lên HTML Canvas bằng PDF.js
  useEffect(() => {
    if (!isOpen || !isPdf) return;

    let isCancelled = false;
    setIsLoadingContent(true);
    setRenderError(false);

    async function loadAndRenderPdf() {
      try {
        // 1. Nạp thư viện pdfjs nếu chưa có sẵn trên window
        if (!(window as any).pdfjsLib) {
          await new Promise<void>((resolve, reject) => {
            const existingScript = document.querySelector('script[data-pdfjs="1"]');
            if (existingScript) {
              existingScript.addEventListener('load', () => resolve());
              existingScript.addEventListener('error', reject);
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
        if (!pdfjsLib) throw new Error('Không thể nạp PDF.js engine');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';

        // 2. Fetch dữ liệu PDF qua ArrayBuffer (tránh lỗi chunked stream của iframe trình duyệt)
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();

        if (isCancelled) return;

        // 3. Đọc trang đầu tiên của CCCD
        const loadingTask = pdfjsLib.getDocument({
          data,
          cMapPacked: true,
        });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        if (isCancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context error');

        // Tính tỉ lệ phóng vừa vặn khung xem (rộng ~400px, cao ~300px)
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const targetWidth = containerRef.current?.clientWidth || 400;
        const targetHeight = 290;

        const scaleX = targetWidth / unscaledViewport.width;
        const scaleY = targetHeight / unscaledViewport.height;
        const scale = Math.min(scaleX, scaleY, 2.0); // Tối đa phóng x2 để nét

        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Huỷ tác vụ render cũ nếu có
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
        }

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };
        renderTaskRef.current = page.render(renderContext);
        await renderTaskRef.current.promise;

        if (!isCancelled) {
          setIsLoadingContent(false);
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.warn('Lỗi vẽ PDF bằng Canvas:', err);
          setRenderError(true);
          setIsLoadingContent(false);
        }
      }
    }

    loadAndRenderPdf();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
    };
  }, [isOpen, fileUrl, isPdf]);

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!isOpen) {
      openTimerRef.current = setTimeout(() => {
        calculatePosition();
        setIsLoadingContent(true);
        setRenderError(false);
        setIsOpen(true);
      }, 150); // Phản hồi nhanh 150ms khi hover
    }
  };

  const handleMouseLeave = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 200); // 200ms để chuột kịp di chuyển vào trong popover
  };

  const handleCardMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handleCardMouseLeave = () => {
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const handleCopyCccd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cccdNumber && cccdNumber !== 'CLN' && cccdNumber !== 'Chưa có') {
      navigator.clipboard.writeText(cccdNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isLight = theme === 'light';

  // Lọc số CCCD hiển thị, loại bỏ nhãn loại đất nếu bị lọt vào
  const displayCccd =
    cccdNumber && cccdNumber.length >= 9 && !/^(CLN|ONT|ODT|BHK|NHK|LUK|RSX|RPH|NTS|HNK)$/i.test(cccdNumber)
      ? cccdNumber
      : (filename.match(/\b\d{9,12}\b/)?.[0] || '');

  const cardContent = (
    <div
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
      style={{
        position: 'fixed',
        top: `${cardPos.top}px`,
        left: `${cardPos.left}px`,
        width: `${Math.min(440, window.innerWidth - 32)}px`,
        zIndex: 99999,
      }}
      className={`rounded-2xl p-3 shadow-2xl border transition-all duration-150 animate-in fade-in zoom-in-95 pointer-events-auto ${
        isLight
          ? 'bg-white border-slate-200 text-slate-800 shadow-xl shadow-slate-300'
          : 'bg-slate-900 border-indigo-500/40 text-slate-100 shadow-2xl shadow-indigo-500/10'
      }`}
    >
      {/* 1. Header: Thông tin chủ hộ & số CCCD */}
      <div className={`flex items-center justify-between pb-2 mb-2 border-b ${
        isLight ? 'border-slate-200' : 'border-slate-800'
      }`}>
        <div className="min-w-0 pr-2">
          <div className="flex items-center gap-1.5">
            <span className="p-1 rounded-md bg-indigo-500/10 text-indigo-500 shrink-0">
              <FileText className="w-3.5 h-3.5" />
            </span>
            <h4 className={`text-xs font-bold truncate ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>
              {ownerName || filename}
            </h4>
          </div>
          {displayCccd && (
            <div className="flex items-center gap-1.5 mt-0.5 ml-5">
              <CreditCard className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="font-mono text-[11px] font-bold text-indigo-400 tracking-wide">
                {displayCccd}
              </span>
              <button
                type="button"
                onClick={handleCopyCccd}
                className={`p-0.5 rounded transition cursor-pointer ${
                  copied
                    ? 'text-emerald-500'
                    : isLight
                    ? 'text-slate-400 hover:text-slate-700'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                title="Sao chép số CCCD"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1 shrink-0">
          {onOpenFullModal && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                onOpenFullModal();
              }}
              className={`p-1.5 rounded-lg transition text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                isLight ? 'hover:bg-slate-100 text-indigo-600' : 'hover:bg-slate-800 text-indigo-400'
              }`}
              title="Phóng to xem toàn màn hình"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`p-1.5 rounded-lg transition text-xs font-semibold flex items-center gap-1 cursor-pointer ${
              isLight ? 'hover:bg-slate-100 text-slate-700' : 'hover:bg-slate-800 text-slate-300'
            }`}
            title="Mở file trong tab mới"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href={fileUrl}
            download={filename || 'cccd.pdf'}
            className={`p-1.5 rounded-lg transition text-xs font-semibold flex items-center gap-1 cursor-pointer ${
              isLight ? 'hover:bg-slate-100 text-slate-700' : 'hover:bg-slate-800 text-slate-300'
            }`}
            title="Tải file về máy"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* 2. Visual Content Area: Hiển thị ngay file CCCD (Canvas trực tiếp hoặc Image) */}
      <div
        ref={containerRef}
        className={`relative w-full h-[300px] rounded-xl overflow-hidden border flex items-center justify-center ${
          isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-950 border-slate-800'
        }`}
      >
        {isLoadingContent && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 z-10 text-indigo-400">
            <Loader2 className="w-6 h-6 animate-spin mb-1.5" />
            <span className="text-[11px] font-medium text-slate-300">Đang dựng hình CCCD...</span>
          </div>
        )}

        {isPdf ? (
          renderError ? (
            /* Fallback iframe nếu Canvas không nạp được */
            <iframe
              src={`${fileUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
              className="w-full h-full border-0 bg-white"
              title={`CCCD: ${ownerName || filename}`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-1 overflow-hidden">
              <canvas
                ref={canvasRef}
                className="max-w-full max-h-full object-contain rounded-lg shadow-sm border border-slate-700/30"
              />
            </div>
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center p-1 bg-slate-950">
            <img
              src={fileUrl}
              alt={`CCCD: ${ownerName || filename}`}
              onLoad={() => setIsLoadingContent(false)}
              className="w-full h-full object-contain rounded-lg"
            />
          </div>
        )}
      </div>

      {/* 3. Footer: Tên file & Nút xem chi tiết */}
      <div className="flex items-center justify-between mt-2 pt-1.5 text-[10px]">
        <div className={`flex items-center gap-1 truncate max-w-[250px] font-mono ${
          isLight ? 'text-slate-500' : 'text-slate-400'
        }`} title={filename}>
          <HardDrive className="w-3 h-3 text-amber-500 shrink-0" />
          <span className="truncate">{filename}</span>
        </div>
        {onOpenFullModal ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              onOpenFullModal();
            }}
            className="text-indigo-400 hover:text-indigo-300 font-bold hover:underline cursor-pointer flex items-center gap-1"
          >
            <Eye className="w-3 h-3" />
            <span>Xem đầy đủ</span>
          </button>
        ) : (
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300 font-bold hover:underline cursor-pointer flex items-center gap-1"
          >
            <Eye className="w-3 h-3" />
            <span>Mở tab mới</span>
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={triggerRef}
      className="inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {mounted && isOpen && createPortal(cardContent, document.body)}
    </div>
  );
}
