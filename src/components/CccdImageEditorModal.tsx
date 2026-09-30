'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
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
  Maximize2,
  Move,
} from 'lucide-react';

export type CropAspectRatio = 'a4' | 'cccd' | 'free' | 'square';

export interface CccdImageEditorModalProps {
  isOpen: boolean;
  imageUrl: string;
  title?: string;
  defaultAspect?: CropAspectRatio;
  onClose: () => void;
  onSave: (editedDataUrl: string) => void;
}

// Khổ canvas chuẩn A4 đứng (210mm x 297mm) ở độ phân giải in sắc nét (~150 DPI)
const A4_WIDTH = 1240;
const A4_HEIGHT = 1754;

export default function CccdImageEditorModal({
  isOpen,
  imageUrl,
  title = 'Chỉnh sửa Căn cước công dân (Mặt trước)',
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

  // Zoom & Pan trên khổ A4 đứng
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

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
    }
  }, [imageUrl, isOpen]);

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

  // Vẽ hình ảnh lên khung canvas A4 đứng
  const renderPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageObjRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Luôn cố định kích thước canvas là khổ A4 đứng (210 x 297)
    canvas.width = A4_WIDTH;
    canvas.height = A4_HEIGHT;

    // 1. Nền giấy A4 trắng tinh
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Tính tỷ lệ để hình ảnh mặc định gần như lấp đầy cả tờ giấy A4 đứng (~92% - 95%)
    const isRotatedSideways = rotation % 180 !== 0;
    const effectiveW = isRotatedSideways ? img.height : img.width;
    const effectiveH = isRotatedSideways ? img.width : img.height;

    // Tỷ lệ chiếm gần như trọn bề ngang hoặc dọc của tờ A4
    const scaleToFitW = (A4_WIDTH * 0.94) / effectiveW;
    const scaleToFitH = (A4_HEIGHT * 0.94) / effectiveH;
    const baseFitScale = Math.min(scaleToFitW, scaleToFitH);

    ctx.save();

    // 3. Bộ lọc màu sắc / độ sáng / tương phản
    let filterString = `brightness(${brightness}%) contrast(${contrast}%)`;
    if (isDocumentFilter) {
      filterString += ` grayscale(100%) contrast(165%)`;
    }
    ctx.filter = filterString;

    // 4. Di chuyển vào tâm tờ giấy A4
    ctx.translate(canvas.width / 2, canvas.height / 2);

    // 5. Áp dụng pan (dịch chuyển tự do do người dùng kéo chuột)
    ctx.translate(pan.x, pan.y);

    // 6. Áp dụng zoom do người dùng phóng to/thu nhỏ
    ctx.scale(zoom, zoom);

    // 7. Lật ngang / dọc
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

    // 8. Xoay góc
    ctx.rotate((rotation * Math.PI) / 180);

    // 9. Vẽ hình ảnh với tỷ lệ lấp đầy tờ A4
    const drawW = img.width * baseFitScale;
    const drawH = img.height * baseFitScale;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

    ctx.restore();
  }, [rotation, flipH, flipV, brightness, contrast, isDocumentFilter, zoom, pan]);

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
    // Xuất ra nguyên vẹn tờ giấy A4 đứng (210 x 297) sắc nét
    const finalDataUrl = canvas.toDataURL('image/jpeg', 0.95);
    onSave(finalDataUrl);
    onClose();
  };

  // Kéo di chuyển ảnh tự do trên tờ A4 (Pan)
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setPanStart({ x: pan.x, y: pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !canvasRef.current) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const scaleRatio = canvasRef.current.width / (canvasRect.width || 1);
    const dx = (e.clientX - dragStart.x) * scaleRatio;
    const dy = (e.clientY - dragStart.y) * scaleRatio;
    setPan({
      x: panStart.x + dx,
      y: panStart.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Lăn chuột để zoom mượt mà
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    setZoom((z) => Math.min(3.0, Math.max(0.4, Number((z + delta).toFixed(2)))));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[96vh] overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-400">
                Khung chỉnh sửa luôn là <strong>khổ giấy A4 đứng</strong> • Ảnh mặc định lấp đầy A4 • Kéo rê hoặc phóng to/thu nhỏ tự do
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
              title="Chọn ảnh khác từ máy tính"
            >
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span>Thay ảnh khác</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col lg:flex-row gap-6 items-center justify-center bg-slate-950/70">
          {/* Tờ giấy A4 Viewport */}
          <div className="flex-1 w-full flex flex-col items-center justify-center">
            {/* Khung mô phỏng tờ giấy A4 đứng */}
            <div
              className="relative aspect-[210/297] h-[480px] sm:h-[550px] max-w-full bg-white rounded shadow-2xl border-2 border-slate-700 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
              title="Kéo chuột để di chuyển vị trí ảnh • Lăn chuột để phóng to/thu nhỏ"
            >
              <canvas
                ref={canvasRef}
                className="w-full h-full object-contain pointer-events-none"
              />

              {/* Nhãn trạng thái góc trên */}
              <div className="absolute top-2 left-2 pointer-events-none bg-slate-950/75 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono text-slate-200 border border-slate-700">
                Khổ A4 Đứng • Zoom: {Math.round(zoom * 100)}% • Xoay: {rotation}°
              </div>

              {/* Chỉ dẫn di chuyển */}
              <div className="absolute bottom-2 right-2 pointer-events-none bg-slate-950/75 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-sans text-slate-300 border border-slate-700 flex items-center gap-1">
                <Move className="w-3 h-3 text-blue-400" />
                <span>Kéo ảnh di chuyển</span>
              </div>
            </div>

            {/* Quick zoom controls */}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.1).toFixed(2))))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                title="Thu nhỏ"
              >
                <ZoomOut className="w-4 h-4" />
              </button>

              <input
                type="range"
                min="40"
                max="250"
                value={Math.round(zoom * 100)}
                onChange={(e) => setZoom(Number(e.target.value) / 100)}
                className="w-28 sm:w-36 accent-blue-500 cursor-pointer"
              />

              <span className="text-xs text-slate-300 font-mono w-12 text-center">
                {Math.round(zoom * 100)}%
              </span>

              <button
                onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.1).toFixed(2))))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                title="Phóng to"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium flex items-center gap-1 cursor-pointer"
                title="Căn giữa và lấp đầy tờ giấy A4"
              >
                <Maximize2 className="w-3.5 h-3.5 text-blue-400" />
                <span>Căn giữa A4</span>
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
                  title="Lật gương ngang"
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
                  title="Lật dọc"
                >
                  <FlipVertical className="w-3.5 h-3.5" />
                  <span>Lật dọc</span>
                </button>
              </div>
            </div>

            {/* 2. Độ sáng & Độ tương phản */}
            <div className="space-y-3 pt-1 border-t border-slate-800">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>2. Tinh chỉnh màu sắc</span>
              </label>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Độ sáng (Brightness)</span>
                  <span className="font-mono">{brightness}%</span>
                </div>
                <input
                  type="range"
                  min="60"
                  max="160"
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Độ tương phản (Contrast)</span>
                  <span className="font-mono">{contrast}%</span>
                </div>
                <input
                  type="range"
                  min="60"
                  max="180"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              {/* Nút lọc văn bản trắng đen */}
              <button
                type="button"
                onClick={() => setIsDocumentFilter((prev) => !prev)}
                className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                  isDocumentFilter
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 shadow-sm'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                <FileCheck2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isDocumentFilter ? 'Đang bật: Lọc văn bản rõ nét' : 'Lọc văn bản / Tăng nét chữ số'}</span>
              </button>
            </div>

            {/* Nút Đặt lại */}
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={handleReset}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Đặt lại mặc định</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
          <p className="text-xs text-slate-400 italic">
            💡 Ảnh lưu sẽ là nguyên vẹn khổ A4 đứng, xuất ra PDF trên Trang 1 y chang như bạn nhìn thấy.
          </p>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700 transition cursor-pointer"
            >
              Hủy bỏ
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition transform active:scale-95 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Áp dụng & Lưu vào hồ sơ</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
