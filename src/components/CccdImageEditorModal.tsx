'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Crop,
  Sun,
  Contrast,
  Sliders,
  Check,
  X,
  Upload,
  RefreshCw,
  FileCheck2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type CropAspectRatio = 'cccd' | 'a4' | 'free' | 'square';

export interface CccdImageEditorModalProps {
  isOpen: boolean;
  imageUrl: string;
  title?: string;
  defaultAspect?: CropAspectRatio;
  onClose: () => void;
  onSave: (editedDataUrl: string) => void;
}

export default function CccdImageEditorModal({
  isOpen,
  imageUrl,
  title = 'Chỉnh sửa ảnh Căn cước công dân (CCCD)',
  defaultAspect = 'cccd',
  onClose,
  onSave,
}: CccdImageEditorModalProps) {
  const [currentImageSrc, setCurrentImageSrc] = useState<string>(imageUrl);
  const [rotation, setRotation] = useState<number>(0); // 0, 90, 180, 270
  const [flipH, setFlipH] = useState<boolean>(false);
  const [flipV, setFlipV] = useState<boolean>(false);
  const [brightness, setBrightness] = useState<number>(100); // 50 - 150
  const [contrast, setContrast] = useState<number>(100); // 50 - 200
  const [isDocumentFilter, setIsDocumentFilter] = useState<boolean>(false);
  const [cropAspect, setCropAspect] = useState<CropAspectRatio>(defaultAspect);

  // Zoom & Pan
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageObjRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (imageUrl) {
      setCurrentImageSrc(imageUrl);
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setBrightness(100);
      setContrast(100);
      setIsDocumentFilter(false);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setCropAspect(defaultAspect);
    }
  }, [imageUrl, isOpen, defaultAspect]);

  // Load image object
  useEffect(() => {
    if (!currentImageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageObjRef.current = img;
      renderPreview();
    };
    img.src = currentImageSrc;
  }, [currentImageSrc]);

  // Render to canvas whenever controls change
  const renderPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageObjRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isRotatedSideways = rotation % 180 !== 0;
    const baseWidth = isRotatedSideways ? img.height : img.width;
    const baseHeight = isRotatedSideways ? img.width : img.height;

    let targetW = baseWidth;
    let targetH = baseHeight;

    if (cropAspect === 'cccd') {
      const cccdRatio = 85.6 / 53.98; // ~1.5857
      if (baseWidth / baseHeight > cccdRatio) {
        targetW = baseHeight * cccdRatio;
        targetH = baseHeight;
      } else {
        targetW = baseWidth;
        targetH = baseWidth / cccdRatio;
      }
    } else if (cropAspect === 'a4') {
      const isLandscape = baseWidth > baseHeight;
      const a4Ratio = isLandscape ? 297 / 210 : 210 / 297;
      if (baseWidth / baseHeight > a4Ratio) {
        targetW = baseHeight * a4Ratio;
        targetH = baseHeight;
      } else {
        targetW = baseWidth;
        targetH = baseWidth / a4Ratio;
      }
    } else if (cropAspect === 'square') {
      const minDim = Math.min(baseWidth, baseHeight);
      targetW = minDim;
      targetH = minDim;
    }

    // Set preview canvas resolution (scaled for preview)
    const maxPreviewDim = 1200;
    const scale = Math.min(1, maxPreviewDim / Math.max(targetW, targetH));
    canvas.width = Math.round(targetW * scale);
    canvas.height = Math.round(targetH * scale);

    ctx.save();

    // Filters
    let filterString = `brightness(${brightness}%) contrast(${contrast}%)`;
    if (isDocumentFilter) {
      filterString += ` grayscale(100%) contrast(160%)`;
    }
    ctx.filter = filterString;

    // Center and transform
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(pan.x, pan.y);

    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.rotate((rotation * Math.PI) / 180);

    // Draw image centered
    ctx.drawImage(
      img,
      -img.width / 2,
      -img.height / 2,
      img.width,
      img.height
    );

    ctx.restore();
  }, [rotation, flipH, flipV, brightness, contrast, isDocumentFilter, cropAspect, zoom, pan]);

  useEffect(() => {
    renderPreview();
  }, [renderPreview]);

  if (!isOpen) return null;

  // Handlers
  const handleRotateRight = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleRotateLeft = () => {
    setRotation((prev) => (prev - 90 + 360) % 360);
  };

  const handleRotate180 = () => {
    setRotation((prev) => (prev + 180) % 360);
  };

  const handleFlipHorizontal = () => {
    setFlipH((prev) => !prev);
  };

  const handleFlipVertical = () => {
    setFlipV((prev) => !prev);
  };

  const handleReset = () => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setBrightness(100);
    setContrast(100);
    setIsDocumentFilter(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCropAspect(defaultAspect);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setCurrentImageSrc(event.target.result as string);
          handleReset();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const finalDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    onSave(finalDataUrl);
    onClose();
  };

  // Mouse pan handlers for preview
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-400">
                Xoay đúng chiều, cắt khung chuẩn thẻ và làm rõ nét chữ số CCCD để đóng tập in A4
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              title="Chọn ảnh khác từ máy"
            >
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span>Thay ảnh khác</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col lg:flex-row gap-5 items-center justify-center bg-slate-950/60">
          {/* Canvas Viewport */}
          <div className="flex-1 w-full flex flex-col items-center justify-center">
            <div
              className="relative w-full max-w-[560px] h-[340px] sm:h-[400px] bg-slate-900/90 rounded-xl border-2 border-dashed border-blue-500/40 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing shadow-inner"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <canvas
                ref={canvasRef}
                className="max-w-full max-h-full object-contain rounded shadow-lg transition-transform duration-75"
              />

              {/* Grid overlay for CCCD alignment */}
              <div className="absolute inset-0 pointer-events-none border border-blue-400/20 rounded-lg">
                <div className="absolute left-1/3 top-0 bottom-0 border-r border-blue-400/10" />
                <div className="absolute left-2/3 top-0 bottom-0 border-r border-blue-400/10" />
                <div className="absolute top-1/2 left-0 right-0 border-b border-blue-400/10" />
              </div>

              {/* Status Badge */}
              <div className="absolute top-2 left-2 pointer-events-none bg-slate-900/80 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 border border-slate-700">
                Xoay: {rotation}° • Zoom: {Math.round(zoom * 100)}%
              </div>
            </div>

            {/* Quick zoom controls */}
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                title="Thu nhỏ"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs text-slate-400 font-mono w-14 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                title="Phóng to"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                Căn vừa
              </button>
            </div>
          </div>

          {/* Controls Panel */}
          <div className="w-full lg:w-80 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-4 shrink-0">
            {/* 1. Xoay & Lật */}
            <div>
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mb-2">
                <RotateCw className="w-3.5 h-3.5 text-blue-400" />
                <span>1. Hướng xoay & Lật ảnh</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleRotateLeft}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition cursor-pointer"
                  title="Xoay trái 90°"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Xoay trái 90°</span>
                </button>
                <button
                  type="button"
                  onClick={handleRotateRight}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition cursor-pointer"
                  title="Xoay phải 90°"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Xoay phải 90°</span>
                </button>
                <button
                  type="button"
                  onClick={handleFlipHorizontal}
                  className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs border transition cursor-pointer ${
                    flipH
                      ? 'bg-blue-600/30 border-blue-500 text-blue-300 font-bold'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                  title="Lật gương ngang (tránh ảnh chụp gương)"
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                  <span>Lật ngang</span>
                </button>
                <button
                  type="button"
                  onClick={handleFlipVertical}
                  className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs border transition cursor-pointer ${
                    flipV
                      ? 'bg-blue-600/30 border-blue-500 text-blue-300 font-bold'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                  title="Lật dọc (nếu chụp lộn đầu)"
                >
                  <FlipVertical className="w-3.5 h-3.5" />
                  <span>Lật dọc</span>
                </button>
              </div>
            </div>

            {/* 2. Cắt Khung Tỉ Lệ */}
            <div>
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mb-2">
                <Crop className="w-3.5 h-3.5 text-blue-400" />
                <span>2. Tỉ lệ cắt khung</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCropAspect('cccd')}
                  className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition cursor-pointer ${
                    cropAspect === 'cccd'
                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  Thẻ CCCD
                </button>
                <button
                  type="button"
                  onClick={() => setCropAspect('a4')}
                  className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition cursor-pointer ${
                    cropAspect === 'a4'
                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  Khổ A4 / GCN
                </button>
                <button
                  type="button"
                  onClick={() => setCropAspect('free')}
                  className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition cursor-pointer ${
                    cropAspect === 'free'
                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  Tự do (Gốc)
                </button>
                <button
                  type="button"
                  onClick={() => setCropAspect('square')}
                  className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition cursor-pointer ${
                    cropAspect === 'square'
                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  Vuông (1:1)
                </button>
              </div>
            </div>

            {/* 3. Tinh chỉnh ánh sáng & Tài liệu */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-blue-400" />
                <span>3. Làm rõ nét văn bản & Độ sáng</span>
              </label>

              {/* Chế độ tài liệu nét cao */}
              <button
                type="button"
                onClick={() => setIsDocumentFilter(!isDocumentFilter)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-xs font-medium transition ${
                  isDocumentFilter
                    ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-emerald-400" />
                  Chế độ scan tài liệu (Trắng đen sắc nét)
                </span>
                <span
                  className={`w-3.5 h-3.5 rounded-full border ${
                    isDocumentFilter
                      ? 'bg-emerald-500 border-emerald-400'
                      : 'border-slate-500'
                  }`}
                />
              </button>

              {/* Brightness */}
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span className="flex items-center gap-1">
                    <Sun className="w-3 h-3" /> Độ sáng
                  </span>
                  <span>{brightness}%</span>
                </div>
                <input
                  type="range"
                  min="60"
                  max="140"
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Contrast */}
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span className="flex items-center gap-1">
                    <Contrast className="w-3 h-3" /> Độ tương phản
                  </span>
                  <span>{contrast}%</span>
                </div>
                <input
                  type="range"
                  min="70"
                  max="160"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
            </div>

            {/* Reset */}
            <div className="pt-1 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition"
              >
                <RefreshCw className="w-3 h-3" /> Đặt lại mặc định
              </button>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-900 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            Hủy bỏ
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition transform active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>Áp dụng & Lưu ảnh này</span>
          </button>
        </div>
      </div>
    </div>
  );
}
