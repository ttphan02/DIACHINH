'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Upload,
  X,
  Crop,
  RotateCw,
  Check,
  Trash2,
  Plus,
  Sparkles,
  FileText,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Scan,
  Move,
} from 'lucide-react';

interface SelectedCccdImage {
  id: string;
  file?: File;
  name: string;
  originalUrl: string;
  previewUrl: string;
  isCropped: boolean;
  size: number;
}

interface CccdUploadBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | null;

// Tối ưu hóa ảnh tải lên trên điện thoại: nén nhẹ & giới hạn kích thước tối đa 1600px để tránh lag RAM
async function optimizeImageForMobile(
  file: File,
  maxDim = 1600
): Promise<{ previewUrl: string; size: number }> {
  return new Promise((resolve) => {
    // Nếu ảnh quá nhỏ (< 300KB), dùng trực tiếp
    if (file.size < 300 * 1024) {
      const url = URL.createObjectURL(file);
      resolve({ previewUrl: url, size: file.size });
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        resolve({ previewUrl: dataUrl, size: Math.round(dataUrl.length * 0.75) });
        return;
      }
      resolve({ previewUrl: objectUrl, size: file.size });
    };

    img.onerror = () => {
      resolve({ previewUrl: objectUrl, size: file.size });
    };

    img.src = objectUrl;
  });
}

export default function CccdUploadBottomSheet({
  isOpen,
  onClose,
  onSuccess,
}: CccdUploadBottomSheetProps) {
  const [images, setImages] = useState<SelectedCccdImage[]>([]);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; message: string }>({
    current: 0,
    total: 0,
    message: '',
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop State
  const [cropRatioMode, setCropRatioMode] = useState<'cccd' | 'free'>('cccd');
  const [imageZoom, setImageZoom] = useState<number>(1);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);

  // Multi-touch Pinch to Zoom trên màn hình điện thoại
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);
  const imageZoomRef = useRef<number>(imageZoom);
  imageZoomRef.current = imageZoom;

  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 20,
    y: 20,
    w: 260,
    h: 164, // ~1.586 ratio
  });

  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    boxX: number;
    boxY: number;
    boxW: number;
    boxH: number;
  }>({
    x: 0,
    y: 0,
    boxX: 0,
    boxY: 0,
    boxW: 0,
    boxH: 0,
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  // Căn khung chuẩn CCCD tự động (85.6mm x 53.98mm = tỷ lệ 1.586)
  const handleFitCccdFrame = useCallback(() => {
    if (!cropContainerRef.current) return;
    const containerW = cropContainerRef.current.clientWidth;
    const containerH = cropContainerRef.current.clientHeight;

    // Chiếm khoảng 82% chiều ngang hoặc vừa chiều dọc
    let targetW = Math.min(containerW * 0.85, 380);
    let targetH = Math.round(targetW / 1.586);

    if (targetH > containerH * 0.82) {
      targetH = Math.round(containerH * 0.82);
      targetW = Math.round(targetH * 1.586);
    }

    const targetX = Math.max(10, Math.round((containerW - targetW) / 2));
    const targetY = Math.max(10, Math.round((containerH - targetH) / 2));

    setCropBox({
      x: targetX,
      y: targetY,
      w: targetW,
      h: targetH,
    });
    setImageZoom(1);
    setCropRatioMode('cccd');
  }, []);

  // Khi người dùng chọn tệp từ máy / điện thoại
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsOptimizing(true);
    const newItems: SelectedCccdImage[] = [];

    const fileList = Array.from(files).filter((f) => f.type.startsWith('image/'));

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        const { previewUrl, size } = await optimizeImageForMobile(file, 1600);
        newItems.push({
          id: `${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
          file,
          name: file.name,
          originalUrl: previewUrl,
          previewUrl,
          isCropped: false,
          size,
        });
      } catch (err) {
        console.warn('Lỗi tối ưu ảnh:', err);
      }
    }

    setIsOptimizing(false);

    if (newItems.length > 0) {
      setImages((prev) => [...prev, ...newItems]);
      showToast(`Đã nạp ${newItems.length} ảnh CCCD. Chạm vào ảnh để căn chỉnh cắt / zoom.`);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleClearAll = () => {
    if (window.confirm('Bạn có chắc chắn muốn bỏ tất cả ảnh đã chọn?')) {
      setImages([]);
    }
  };

  // Mở giao diện cắt ảnh
  const handleStartCrop = (img: SelectedCccdImage) => {
    setEditingImageId(img.id);
    setImageZoom(1);
  };

  const editingImage = images.find((img) => img.id === editingImageId);

  // Tự động căn chỉnh khung cắt khi mở ảnh hoặc đổi tỉ lệ
  useEffect(() => {
    if (editingImage && cropContainerRef.current) {
      handleFitCccdFrame();
    }
  }, [editingImageId, handleFitCccdFrame]);

  // Hỗ trợ thu phóng ảnh tự nhiên 2 ngón tay (Pinch-to-zoom) trên điện thoại cảm ứng
  useEffect(() => {
    const container = cropContainerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        setDragMode(null);
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        touchStartDistRef.current = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        touchStartZoomRef.current = imageZoomRef.current;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && touchStartDistRef.current && touchStartDistRef.current > 0) {
        if (e.cancelable) {
          e.preventDefault();
        }
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const ratio = dist / touchStartDistRef.current;
        const targetZoom = +(touchStartZoomRef.current * ratio).toFixed(2);
        const clampedZoom = Math.min(3.5, Math.max(0.6, targetZoom));
        setImageZoom(clampedZoom);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        touchStartDistRef.current = null;
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [editingImageId]);

  // Xoay ảnh 90 độ bằng HTML Canvas
  const handleRotateImage = () => {
    if (!editingImage) return;

    const img = new Image();
    img.src = editingImage.previewUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const rotatedUrl = canvas.toDataURL('image/jpeg', 0.92);
      setImages((prev) =>
        prev.map((item) => (item.id === editingImage.id ? { ...item, previewUrl: rotatedUrl } : item))
      );
      handleFitCccdFrame();
    };
  };

  // Bắt đầu kéo thả hoặc thay đổi kích thước khung cắt
  const handlePointerDownAction = (
    mode: DragMode,
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    setDragMode(mode);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      boxX: cropBox.x,
      boxY: cropBox.y,
      boxW: cropBox.w,
      boxH: cropBox.h,
    });
  };

  // Di chuyển chuột hoặc ngón tay cảm ứng trên khung cắt
  const handlePointerMoveAction = (e: React.PointerEvent<HTMLDivElement>) => {
    if (touchStartDistRef.current !== null) return;
    if (!dragMode || !cropContainerRef.current) return;
    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;

    const maxW = cropContainerRef.current.clientWidth;
    const maxH = cropContainerRef.current.clientHeight;

    const minSize = 35; // kích thước nhỏ nhất cho phép kéo nhỏ lại trong chế độ tự do

    if (dragMode === 'move') {
      const newX = Math.max(0, Math.min(dragStart.boxX + deltaX, maxW - cropBox.w));
      const newY = Math.max(0, Math.min(dragStart.boxY + deltaY, maxH - cropBox.h));
      setCropBox((prev) => ({ ...prev, x: newX, y: newY }));
      return;
    }

    // Chế độ Tự Do: Kéo tự do mọi hướng và mọi kích thước nhỏ/to
    if (cropRatioMode === 'free') {
      let { boxX: newX, boxY: newY, boxW: newW, boxH: newH } = dragStart;

      if (dragMode === 'se') {
        newW = Math.max(minSize, Math.min(dragStart.boxW + deltaX, maxW - dragStart.boxX));
        newH = Math.max(minSize, Math.min(dragStart.boxH + deltaY, maxH - dragStart.boxY));
      } else if (dragMode === 'sw') {
        const potentialW = dragStart.boxW - deltaX;
        if (potentialW >= minSize && dragStart.boxX + deltaX >= 0) {
          newW = potentialW;
          newX = dragStart.boxX + deltaX;
        }
        newH = Math.max(minSize, Math.min(dragStart.boxH + deltaY, maxH - dragStart.boxY));
      } else if (dragMode === 'ne') {
        newW = Math.max(minSize, Math.min(dragStart.boxW + deltaX, maxW - dragStart.boxX));
        const potentialH = dragStart.boxH - deltaY;
        if (potentialH >= minSize && dragStart.boxY + deltaY >= 0) {
          newH = potentialH;
          newY = dragStart.boxY + deltaY;
        }
      } else if (dragMode === 'nw') {
        const potentialW = dragStart.boxW - deltaX;
        if (potentialW >= minSize && dragStart.boxX + deltaX >= 0) {
          newW = potentialW;
          newX = dragStart.boxX + deltaX;
        }
        const potentialH = dragStart.boxH - deltaY;
        if (potentialH >= minSize && dragStart.boxY + deltaY >= 0) {
          newH = potentialH;
          newY = dragStart.boxY + deltaY;
        }
      } else if (dragMode === 'e') {
        newW = Math.max(minSize, Math.min(dragStart.boxW + deltaX, maxW - dragStart.boxX));
      } else if (dragMode === 's') {
        newH = Math.max(minSize, Math.min(dragStart.boxH + deltaY, maxH - dragStart.boxY));
      } else if (dragMode === 'w') {
        const potentialW = dragStart.boxW - deltaX;
        if (potentialW >= minSize && dragStart.boxX + deltaX >= 0) {
          newW = potentialW;
          newX = dragStart.boxX + deltaX;
        }
      } else if (dragMode === 'n') {
        const potentialH = dragStart.boxH - deltaY;
        if (potentialH >= minSize && dragStart.boxY + deltaY >= 0) {
          newH = potentialH;
          newY = dragStart.boxY + deltaY;
        }
      }

      setCropBox({ x: newX, y: newY, w: newW, h: newH });
      return;
    }

    // Chế độ Chuẩn CCCD: Giữ tỷ lệ vàng 1.586
    const ratio = 1.5858;
    if (dragMode === 'se' || dragMode === 'e' || dragMode === 's') {
      const newW = Math.max(60, Math.min(dragStart.boxW + deltaX, maxW - dragStart.boxX));
      const newH = Math.round(newW / ratio);
      if (dragStart.boxY + newH <= maxH) {
        setCropBox((prev) => ({ ...prev, w: newW, h: newH }));
      }
    } else if (dragMode === 'sw' || dragMode === 'w') {
      const potentialW = dragStart.boxW - deltaX;
      const newH = Math.round(potentialW / ratio);
      if (potentialW >= 60 && dragStart.boxX + deltaX >= 0 && dragStart.boxY + newH <= maxH) {
        setCropBox({
          x: dragStart.boxX + deltaX,
          y: dragStart.boxY,
          w: potentialW,
          h: newH,
        });
      }
    } else if (dragMode === 'ne' || dragMode === 'n') {
      const newW = Math.max(60, Math.min(dragStart.boxW + deltaX, maxW - dragStart.boxX));
      const newH = Math.round(newW / ratio);
      const newY = dragStart.boxY + (dragStart.boxH - newH);
      if (newY >= 0) {
        setCropBox({
          x: dragStart.boxX,
          y: newY,
          w: newW,
          h: newH,
        });
      }
    } else if (dragMode === 'nw') {
      const potentialW = dragStart.boxW - deltaX;
      const newH = Math.round(potentialW / ratio);
      const newX = dragStart.boxX + deltaX;
      const newY = dragStart.boxY + (dragStart.boxH - newH);
      if (potentialW >= 60 && newX >= 0 && newY >= 0) {
        setCropBox({
          x: newX,
          y: newY,
          w: potentialW,
          h: newH,
        });
      }
    }
  };

  const handlePointerUpAction = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMode) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      setDragMode(null);
    }
  };

  // Lưu ảnh đã cắt
  const handleSaveCrop = () => {
    if (!editingImage || !cropImageRef.current || !cropContainerRef.current) return;

    const imgEl = cropImageRef.current;
    const containerEl = cropContainerRef.current;

    const imgRect = imgEl.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();

    // Tọa độ của khung cắt so với ảnh hiển thị thực tế (đã tính zoom)
    const cropRelativeX = cropBox.x - (imgRect.left - containerRect.left);
    const cropRelativeY = cropBox.y - (imgRect.top - containerRect.top);

    // Tỷ lệ giữa kích thước thật của ảnh và kích thước hiển thị
    const scaleX = imgEl.naturalWidth / imgRect.width;
    const scaleY = imgEl.naturalHeight / imgRect.height;

    const realCropX = Math.max(0, cropRelativeX * scaleX);
    const realCropY = Math.max(0, cropRelativeY * scaleY);
    const realCropW = Math.min(imgEl.naturalWidth - realCropX, cropBox.w * scaleX);
    const realCropH = Math.min(imgEl.naturalHeight - realCropY, cropBox.h * scaleY);

    if (realCropW <= 10 || realCropH <= 10) {
      showToast('Khung cắt nằm ngoài ảnh, vui lòng kéo vào trong ảnh CCCD.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(realCropW);
    canvas.height = Math.round(realCropH);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sourceImg = new Image();
    sourceImg.src = editingImage.previewUrl;
    sourceImg.onload = () => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceImg, realCropX, realCropY, realCropW, realCropH, 0, 0, canvas.width, canvas.height);
      const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

      setImages((prev) =>
        prev.map((item) =>
          item.id === editingImage.id
            ? { ...item, previewUrl: croppedDataUrl, isCropped: true }
            : item
        )
      );
      setEditingImageId(null);
      showToast('✓ Đã lưu ảnh CCCD đã cắt!');
    };
  };

  // Chuyển DataURL sang chuỗi base64 sạch
  const getBase64FromUrl = async (url: string): Promise<string> => {
    if (url.startsWith('data:')) return url;
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Quét AI và Tải Lên Tất Cả Ảnh CCCD
  const handleUploadAll = async () => {
    if (images.length === 0) return;

    setIsUploading(true);
    let successCount = 0;

    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      setUploadProgress({
        current: i + 1,
        total: images.length,
        message: `Đang nhận diện AI và tạo PDF (${i + 1}/${images.length})...`,
      });

      try {
        const b64 = await getBase64FromUrl(item.previewUrl);

        // Bước 1: Gọi AI trích xuất thông tin Họ tên & CCCD
        let soCccd = '';
        let hoVaTen = '';

        try {
          const ocrRes = await fetch('/api/ocr-cccd', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: b64 }),
          });
          const ocrData: any = await ocrRes.json();
          if (ocrData.success && ocrData.data) {
            soCccd = ocrData.data.so_cccd || '';
            hoVaTen = ocrData.data.ho_va_ten || '';
          }
        } catch (err) {
          console.warn('Lỗi OCR CCCD:', err);
        }

        // Bước 2: Tạo PDF khổ A4 và lưu vào R2 cccd/
        setUploadProgress({
          current: i + 1,
          total: images.length,
          message: `Đang lưu file PDF vào kho CCCD (${i + 1}/${images.length})...`,
        });

        const uploadRes = await fetch('/api/upload-cccd-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frontBase64: b64,
            so_cccd: soCccd,
            ho_va_ten: hoVaTen,
            skipSync: true,
          }),
        });

        if (uploadRes.ok) {
          successCount++;
        }
      } catch (err) {
        console.error('Lỗi khi tải lên file CCCD:', err);
      }
    }

    // Kích hoạt đồng bộ Google Sheets 1 lần
    try {
      await fetch('/api/sync-sheets');
    } catch {
      // ignore
    }

    setIsUploading(false);
    showToast(`✓ Đã tải lên và lưu thành công ${successCount}/${images.length} file CCCD vào hệ thống!`);

    // Reset về trạng thái form ban đầu có nút "Tải ảnh CCCD lên"
    setImages([]);
    setEditingImageId(null);

    if (onSuccess) {
      onSuccess();
    }
  };

  return (
    <>
      {/* Nền làm mờ khi mở Bottom Sheet */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-xs transition-opacity duration-300 lg:hidden ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Bottom Sheet Drawer */}
      <div
        className={`fixed z-50 bg-white transition-all duration-300 ease-in-out shadow-2xl flex flex-col ${
          isOpen
            ? 'w-full lg:w-[500px] h-[86vh] max-h-[90vh] lg:h-[88vh] lg:bottom-4 lg:left-4 bottom-0 left-0 rounded-t-3xl lg:rounded-3xl border-t lg:border border-slate-200 opacity-100 translate-y-0 pointer-events-auto'
            : 'w-full lg:w-[500px] h-[86vh] max-h-[90vh] lg:h-[88vh] lg:bottom-4 lg:left-4 bottom-0 left-0 rounded-t-3xl lg:rounded-3xl border-0 opacity-0 translate-y-full pointer-events-none'
        }`}
      >
        {/* Nút kéo / pill trên mobile */}
        <div className="w-full flex items-center justify-center pt-2.5 pb-1 lg:hidden">
          <div className="w-12 h-1.5 bg-slate-300 rounded-full" />
        </div>

        {/* Header Drawer */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/80 rounded-t-3xl">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-800">Tải Ảnh CCCD Lên</h2>
              <p className="text-[11px] text-slate-500 font-medium">
                {images.length === 0
                  ? 'Chụp ảnh hoặc chọn nhiều ảnh từ máy'
                  : `Đã chọn ${images.length} ảnh (${images.filter((i) => i.isCropped).length} đã cắt)`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {images.length > 0 && !isUploading && (
              <button
                type="button"
                onClick={handleClearAll}
                className="p-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer"
                title="Bỏ tất cả ảnh đã chọn"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Xóa hết</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition cursor-pointer"
              title="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Input file ẩn hỗ trợ chọn nhiều ảnh */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFilesSelected}
          className="hidden"
        />

        {/* Loading khi đang tối ưu ảnh trên điện thoại */}
        {isOptimizing && (
          <div className="mx-4 mt-2 p-2.5 bg-purple-50 text-purple-700 text-xs font-bold rounded-xl flex items-center gap-2 animate-pulse border border-purple-200">
            <Loader2 className="w-4 h-4 animate-spin text-purple-600 shrink-0" />
            <span>Đang xử lý & tối ưu hóa ảnh mượt mà cho điện thoại...</span>
          </div>
        )}

        {/* Toast thông báo nhanh */}
        {toastMessage && (
          <div className="mx-4 mt-2 px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* GIAO DIỆN CẮT ẢNH CHUYÊN NGHIỆP CÓ ZOOM & KÉO THU PHÓNG TỰ DO */}
        {editingImage ? (
          <div className="flex-1 flex flex-col p-3 sm:p-4 overflow-hidden bg-slate-950 text-white select-none">
            {/* Thanh công cụ cắt trên cùng */}
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Crop className="w-4 h-4 text-purple-400 shrink-0" />
                <span className="text-xs font-bold truncate max-w-[130px] sm:max-w-[160px]">{editingImage.name}</span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Chế độ: Chuẩn CCCD vs Tự do */}
                <div className="flex items-center bg-slate-800 rounded-lg p-0.5 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => {
                      setCropRatioMode('cccd');
                      handleFitCccdFrame();
                    }}
                    className={`px-2 py-1 rounded-md transition cursor-pointer ${
                      cropRatioMode === 'cccd' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Khóa khung theo tỷ lệ thẻ căn cước chuẩn (1.586)"
                  >
                    Chuẩn CCCD
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropRatioMode('free')}
                    className={`px-2 py-1 rounded-md transition cursor-pointer ${
                      cropRatioMode === 'free' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Kéo thả tự do mọi kích thước nhỏ/to tùy ý"
                  >
                    Tự do
                  </button>
                </div>

                {/* Nút Vừa khung */}
                <button
                  type="button"
                  onClick={handleFitCccdFrame}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg text-[11px] font-bold transition flex items-center gap-1 cursor-pointer"
                  title="Tự động căn chỉnh vừa khung thẻ CCCD"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span className="hidden sm:inline">Vừa khung</span>
                </button>

                {/* Xoay 90 độ */}
                <button
                  type="button"
                  onClick={handleRotateImage}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                  title="Xoay ảnh 90 độ"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Xoay</span>
                </button>
              </div>
            </div>

            {/* Vùng xem ảnh và khung cắt tương tác với Pointer Events */}
            <div
              ref={cropContainerRef}
              onPointerMove={handlePointerMoveAction}
              onPointerUp={handlePointerUpAction}
              className="flex-1 relative my-2 bg-black/75 rounded-2xl overflow-hidden flex items-center justify-center touch-none select-none"
            >
              {/* Ảnh đang cắt hỗ trợ CSS Zoom mượt mà */}
              <div
                className="w-full h-full flex items-center justify-center transition-transform duration-100 ease-out"
                style={{
                  transform: `scale(${imageZoom})`,
                  transformOrigin: 'center center',
                }}
              >
                <img
                  ref={cropImageRef}
                  src={editingImage.previewUrl}
                  alt="Đang cắt"
                  className="max-w-full max-h-full object-contain pointer-events-none select-none"
                  draggable={false}
                />
              </div>

              {/* Khung cắt di động & thu phóng */}
              <div
                onPointerDown={(e) => handlePointerDownAction('move', e)}
                style={{
                  left: `${cropBox.x}px`,
                  top: `${cropBox.y}px`,
                  width: `${cropBox.w}px`,
                  height: `${cropBox.h}px`,
                }}
                className={`absolute border-2 border-emerald-400 bg-emerald-500/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.72)] cursor-move rounded-lg flex flex-col justify-between p-1 transition-shadow touch-none ${
                  dragMode ? 'ring-2 ring-emerald-300 ring-offset-1' : ''
                }`}
              >
                {/* Header hiển thị chế độ */}
                <div className="flex items-center justify-between text-[10px] text-emerald-300 font-black px-1 pointer-events-none select-none">
                  <span className="bg-black/60 px-1 py-0.2 rounded">
                    {cropRatioMode === 'cccd' ? 'CCCD (1.59)' : `${Math.round(cropBox.w)}×${Math.round(cropBox.h)}`}
                  </span>
                  <span className="bg-black/60 px-1 py-0.2 rounded text-[9px]">Kéo góc để thu nhỏ</span>
                </div>

                {/* Đường lưới định vị 1/3 (Rule of Thirds) */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-20">
                  <div className="border-r border-b border-emerald-300" />
                  <div className="border-r border-b border-emerald-300" />
                  <div className="border-b border-emerald-300" />
                  <div className="border-r border-b border-emerald-300" />
                  <div className="border-r border-b border-emerald-300" />
                  <div className="border-b border-emerald-300" />
                  <div className="border-r border-emerald-300" />
                  <div className="border-r border-emerald-300" />
                  <div />
                </div>

                {/* 4 NÚT TAY CẦM GÓC CẢM ỨNG LỚN (Touch handles cho Mobile & Chuột) */}
                {/* Góc Trên - Trái (NW) */}
                <div
                  onPointerDown={(e) => handlePointerDownAction('nw', e)}
                  className="absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
                  title="Kéo góc trên-trái"
                >
                  <div className="w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full shadow-md" />
                </div>

                {/* Góc Trên - Phải (NE) */}
                <div
                  onPointerDown={(e) => handlePointerDownAction('ne', e)}
                  className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
                  title="Kéo góc trên-phải"
                >
                  <div className="w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full shadow-md" />
                </div>

                {/* Góc Dưới - Trái (SW) */}
                <div
                  onPointerDown={(e) => handlePointerDownAction('sw', e)}
                  className="absolute -bottom-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
                  title="Kéo góc dưới-trái"
                >
                  <div className="w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full shadow-md" />
                </div>

                {/* Góc Dưới - Phải (SE) */}
                <div
                  onPointerDown={(e) => handlePointerDownAction('se', e)}
                  className="absolute -bottom-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
                  title="Kéo góc dưới-phải"
                >
                  <div className="w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full shadow-md" />
                </div>

                {/* 4 ĐIỂM CẠNH (Dành cho chế độ Tự do) */}
                {cropRatioMode === 'free' && (
                  <>
                    {/* Cạnh Trên */}
                    <div
                      onPointerDown={(e) => handlePointerDownAction('n', e)}
                      className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-4 flex items-center justify-center cursor-ns-resize z-10 touch-none"
                    >
                      <div className="w-4 h-1.5 bg-emerald-400 border border-white rounded-full" />
                    </div>
                    {/* Cạnh Dưới */}
                    <div
                      onPointerDown={(e) => handlePointerDownAction('s', e)}
                      className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-4 flex items-center justify-center cursor-ns-resize z-10 touch-none"
                    >
                      <div className="w-4 h-1.5 bg-emerald-400 border border-white rounded-full" />
                    </div>
                    {/* Cạnh Trái */}
                    <div
                      onPointerDown={(e) => handlePointerDownAction('w', e)}
                      className="absolute top-1/2 -left-2 -translate-y-1/2 w-4 h-8 flex items-center justify-center cursor-ew-resize z-10 touch-none"
                    >
                      <div className="w-1.5 h-4 bg-emerald-400 border border-white rounded-full" />
                    </div>
                    {/* Cạnh Phải */}
                    <div
                      onPointerDown={(e) => handlePointerDownAction('e', e)}
                      className="absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-8 flex items-center justify-center cursor-ew-resize z-10 touch-none"
                    >
                      <div className="w-1.5 h-4 bg-emerald-400 border border-white rounded-full" />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Thanh điều khiển Zoom ảnh linh hoạt */}
            <div className="flex flex-wrap items-center justify-between px-2.5 py-1.5 bg-slate-900 rounded-xl mb-2 text-xs gap-2">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Scan className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="text-[11px] font-semibold">Thu phóng:</span>
                <span className="text-[10px] text-slate-400 hidden sm:inline">(Hỗ trợ 2 ngón tay pinch-zoom)</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setImageZoom((prev) => Math.max(0.6, +(prev - 0.15).toFixed(2)))}
                  disabled={imageZoom <= 0.6}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition cursor-pointer"
                  title="Thu nhỏ ảnh"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>

                <span className="text-[11px] font-mono font-bold w-12 text-center text-emerald-400">
                  {Math.round(imageZoom * 100)}%
                </span>

                <button
                  type="button"
                  onClick={() => setImageZoom((prev) => Math.min(3.5, +(prev + 0.15).toFixed(2)))}
                  disabled={imageZoom >= 3.5}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition cursor-pointer"
                  title="Phóng to ảnh"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>

                {imageZoom !== 1 && (
                  <button
                    type="button"
                    onClick={() => setImageZoom(1)}
                    className="text-[10px] text-amber-400 underline ml-1 cursor-pointer"
                  >
                    100%
                  </button>
                )}
              </div>
            </div>

            {/* Thanh nút bấm Hủy & Lưu cắt */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setEditingImageId(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleSaveCrop}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-lg transition cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
              >
                <Check className="w-4 h-4" />
                <span>Lưu ảnh đã cắt</span>
              </button>
            </div>
          </div>
        ) : (
          /* THÂN DRAWER: FORM BAN ĐẦU HOẶC DANH SÁCH ẢNH ĐÃ CHỌN */
          <div className="flex-1 flex flex-col p-4 overflow-y-auto">
            {images.length === 0 ? (
              /* FORM BAN ĐẦU: ĐƠN GIẢN, NÚT TẢI ẢNH TO RÕ TRÊN ĐIỆN THOẠI */
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <div className="relative mb-6">
                  <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500 flex items-center justify-center text-white shadow-xl shadow-purple-500/20 animate-pulse">
                    <Camera className="w-12 h-12" />
                  </div>
                  <div className="absolute -bottom-2 -right-2 p-2 bg-emerald-500 text-white rounded-2xl shadow-md">
                    <Upload className="w-4 h-4" />
                  </div>
                </div>

                <h3 className="text-base sm:text-lg font-black text-slate-900 mb-2">
                  Tải Ảnh Căn Cước Công Dân
                </h3>
                <p className="text-xs text-slate-500 max-w-xs mb-8 leading-relaxed">
                  Chạm vào nút bên dưới để chọn nhiều ảnh CCCD từ máy hoặc chụp trực tiếp bằng máy ảnh điện thoại.
                </p>

                {/* NÚT TẢI ẢNH CCCD LÊN */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full max-w-sm py-4 px-6 bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-black text-sm rounded-2xl shadow-xl shadow-purple-600/30 flex items-center justify-center gap-2.5 transition transform active:scale-95 cursor-pointer"
                >
                  <Camera className="w-5 h-5" />
                  <span>Tải ảnh CCCD lên</span>
                </button>

                <p className="text-[11px] text-slate-400 mt-4">
                  Hỗ trợ định dạng JPG, PNG • Tự động xoay, căn zoom và nhận diện AI mượt mà
                </p>
              </div>
            ) : (
              /* DANH SÁCH TẤT CẢ ẢNH CCCD ĐÃ CHỌN */
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  {/* Banner hướng dẫn người dùng */}
                  <div className="mb-3 p-3 bg-purple-50 border border-purple-200/60 rounded-2xl flex items-center justify-between text-xs text-purple-900">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
                      <span className="font-medium text-[11px] sm:text-xs">
                        Nhấn vào 1 ảnh bất kỳ để <strong>cắt, zoom & xoay</strong> trước khi tải lên.
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shrink-0 flex items-center gap-1 transition cursor-pointer shadow-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm ảnh</span>
                    </button>
                  </div>

                  {/* Lưới hình ảnh (2 cột trên điện thoại) */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {images.map((item, idx) => (
                      <div
                        key={item.id}
                        onClick={() => handleStartCrop(item)}
                        className={`group relative rounded-2xl overflow-hidden border-2 transition-all cursor-pointer bg-slate-900 shadow-sm flex flex-col ${
                          item.isCropped
                            ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                            : 'border-slate-200 hover:border-purple-400'
                        }`}
                      >
                        {/* Hình ảnh */}
                        <div className="relative aspect-[1.58/1] w-full bg-slate-950 flex items-center justify-center overflow-hidden">
                          <img
                            src={item.previewUrl}
                            alt={item.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            loading="lazy"
                          />

                          {/* Badge trạng thái */}
                          <div className="absolute bottom-1.5 left-1.5">
                            {item.isCropped ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-600 text-white shadow-md">
                                <CheckCircle2 className="w-3 h-3" />
                                Đã cắt
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-black/70 backdrop-blur-xs text-amber-300 shadow-md">
                                <Crop className="w-3 h-3" />
                                Chạm để cắt
                              </span>
                            )}
                          </div>

                          {/* STT ảnh */}
                          <span className="absolute top-1.5 left-1.5 w-5 h-5 bg-black/60 backdrop-blur-xs text-white rounded-full text-[10px] font-black flex items-center justify-center">
                            {idx + 1}
                          </span>

                          {/* Nút xóa ảnh */}
                          <button
                            type="button"
                            onClick={(e) => handleRemoveImage(item.id, e)}
                            className="absolute top-1.5 right-1.5 w-6 h-6 bg-rose-600/90 hover:bg-rose-700 text-white rounded-full flex items-center justify-center shadow-md transition cursor-pointer"
                            title="Xóa ảnh này"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Tên ảnh */}
                        <div className="p-2 bg-white flex items-center justify-between text-[11px] text-slate-700">
                          <span className="truncate font-medium">{item.name}</span>
                        </div>
                      </div>
                    ))}

                    {/* Nút thêm ảnh vào lưới */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-[1.58/1] rounded-2xl border-2 border-dashed border-slate-300 hover:border-purple-400 bg-slate-50 hover:bg-purple-50/50 flex flex-col items-center justify-center text-slate-500 hover:text-purple-600 transition cursor-pointer p-2 text-center"
                    >
                      <Plus className="w-6 h-6 mb-1 text-slate-400" />
                      <span className="text-xs font-bold">Thêm ảnh</span>
                    </div>
                  </div>
                </div>

                {/* THANH ĐIỀU KHIỂN & NÚT TẢI LÊN DƯỚI CÙNG */}
                <div className="pt-4 mt-4 border-t border-slate-100">
                  {isUploading ? (
                    <div className="p-4 bg-purple-50 rounded-2xl border border-purple-200 flex flex-col items-center justify-center gap-2 text-center">
                      <div className="flex items-center gap-2 text-purple-700 font-black text-sm">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>{uploadProgress.message}</span>
                      </div>
                      <div className="w-full bg-purple-200 h-2 rounded-full overflow-hidden mt-1">
                        <div
                          className="bg-purple-600 h-full transition-all duration-300 rounded-full"
                          style={{
                            width: `${(uploadProgress.current / Math.max(uploadProgress.total, 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleUploadAll}
                      className="w-full py-3.5 px-6 bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-black text-sm rounded-2xl shadow-xl shadow-purple-600/30 flex items-center justify-center gap-2 transition transform active:scale-95 cursor-pointer"
                    >
                      <Upload className="w-5 h-5" />
                      <span>Tải Lên ({images.length} ảnh)</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
