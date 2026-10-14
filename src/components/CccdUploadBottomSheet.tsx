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

export default function CccdUploadBottomSheet({
  isOpen,
  onClose,
  onSuccess,
}: CccdUploadBottomSheetProps) {
  const [images, setImages] = useState<SelectedCccdImage[]>([]);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
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
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 20,
    y: 20,
    w: 260,
    h: 164, // ~1.586 ratio
  });
  const [isDraggingCrop, setIsDraggingCrop] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; boxX: number; boxY: number }>({
    x: 0,
    y: 0,
    boxX: 0,
    boxY: 0,
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  // Khi người dùng chọn tệp từ máy / điện thoại
  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: SelectedCccdImage[] = [];
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        newItems.push({
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          file,
          name: file.name,
          originalUrl: url,
          previewUrl: url,
          isCropped: false,
          size: file.size,
        });
      }
    });

    if (newItems.length > 0) {
      setImages((prev) => [...prev, ...newItems]);
      showToast(`Đã chọn ${newItems.length} ảnh CCCD. Bạn có thể nhấn vào ảnh để cắt/xoay.`);
    }

    // Reset input để có thể chọn lại cùng file nếu muốn
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
  };

  const editingImage = images.find((img) => img.id === editingImageId);

  // Tự động căn chỉnh khung cắt khi mở ảnh hoặc đổi tỉ lệ
  useEffect(() => {
    if (editingImage && cropContainerRef.current) {
      const containerW = Math.min(cropContainerRef.current.clientWidth - 40, 360);
      const targetW = Math.max(containerW, 200);
      const targetH = cropRatioMode === 'cccd' ? Math.round(targetW / 1.586) : Math.round(targetW * 0.7);
      setCropBox({
        x: Math.max(10, Math.round((cropContainerRef.current.clientWidth - targetW) / 2)),
        y: 30,
        w: targetW,
        h: targetH,
      });
    }
  }, [editingImageId, cropRatioMode]);

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

      const rotatedUrl = canvas.toDataURL('image/jpeg', 0.95);
      setImages((prev) =>
        prev.map((item) => (item.id === editingImage.id ? { ...item, previewUrl: rotatedUrl } : item))
      );
    };
  };

  // Xử lý kéo thả khung cắt trên điện thoại / chuột
  const handleCropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsDraggingCrop(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      boxX: cropBox.x,
      boxY: cropBox.y,
    });
  };

  const handleCropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingCrop || !cropContainerRef.current) return;
    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;

    const maxW = cropContainerRef.current.clientWidth;
    const maxH = cropContainerRef.current.clientHeight;

    const newX = Math.max(0, Math.min(dragStart.boxX + deltaX, maxW - cropBox.w));
    const newY = Math.max(0, Math.min(dragStart.boxY + deltaY, maxH - cropBox.h));

    setCropBox((prev) => ({
      ...prev,
      x: newX,
      y: newY,
    }));
  };

  const handleCropPointerUp = () => {
    setIsDraggingCrop(false);
  };

  // Lưu ảnh đã cắt
  const handleSaveCrop = () => {
    if (!editingImage || !cropImageRef.current || !cropContainerRef.current) return;

    const imgEl = cropImageRef.current;
    const containerEl = cropContainerRef.current;

    const imgRect = imgEl.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();

    // Tọa độ của khung cắt so với ảnh hiển thị
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
    canvas.width = realCropW;
    canvas.height = realCropH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sourceImg = new Image();
    sourceImg.src = editingImage.previewUrl;
    sourceImg.onload = () => {
      ctx.drawImage(sourceImg, realCropX, realCropY, realCropW, realCropH, 0, 0, realCropW, realCropH);
      const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.95);

      setImages((prev) =>
        prev.map((item) =>
          item.id === editingImage.id
            ? { ...item, previewUrl: croppedDataUrl, isCropped: true }
            : item
        )
      );
      setEditingImageId(null);
      showToast('✓ Đã lưu ảnh cắt thành công!');
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

      {/* Bottom Sheet Drawer - Trượt từ dưới lên (Mobile) hoặc Panel góc trái/dưới (Desktop) */}
      <div
        className={`fixed z-50 bg-white transition-all duration-300 ease-in-out shadow-2xl flex flex-col ${
          isOpen
            ? 'w-full lg:w-[480px] h-[82vh] max-h-[88vh] lg:h-[85vh] lg:bottom-4 lg:left-4 bottom-0 left-0 rounded-t-3xl lg:rounded-3xl border-t lg:border border-slate-200 opacity-100 translate-y-0 pointer-events-auto'
            : 'w-full lg:w-[480px] h-[82vh] max-h-[88vh] lg:h-[85vh] lg:bottom-4 lg:left-4 bottom-0 left-0 rounded-t-3xl lg:rounded-3xl border-0 opacity-0 translate-y-full pointer-events-none'
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

        {/* Toast thông báo nhanh */}
        {toastMessage && (
          <div className="mx-4 mt-2 px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* GIAO DIỆN CẮT ẢNH (MODAL CẮT NẰM TRONG SHEET) */}
        {editingImage ? (
          <div className="flex-1 flex flex-col p-4 overflow-hidden bg-slate-950 text-white">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Crop className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-bold truncate max-w-[180px]">{editingImage.name}</span>
              </div>

              <div className="flex items-center gap-2">
                {/* Đổi tỉ lệ cắt */}
                <div className="flex items-center bg-slate-800 rounded-lg p-0.5 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setCropRatioMode('cccd')}
                    className={`px-2 py-1 rounded-md transition ${
                      cropRatioMode === 'cccd' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Chuẩn CCCD
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropRatioMode('free')}
                    className={`px-2 py-1 rounded-md transition ${
                      cropRatioMode === 'free' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Tự do
                  </button>
                </div>

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

            {/* Vùng xem ảnh và khung cắt tương tác */}
            <div
              ref={cropContainerRef}
              onPointerMove={handleCropPointerMove}
              onPointerUp={handleCropPointerUp}
              className="flex-1 relative my-3 bg-black/60 rounded-2xl overflow-hidden flex items-center justify-center select-none touch-none"
            >
              {/* Ảnh đang cắt */}
              <img
                ref={cropImageRef}
                src={editingImage.previewUrl}
                alt="Đang cắt"
                className="max-w-full max-h-full object-contain pointer-events-none"
              />

              {/* Khung cắt di động */}
              <div
                onPointerDown={handleCropPointerDown}
                style={{
                  left: `${cropBox.x}px`,
                  top: `${cropBox.y}px`,
                  width: `${cropBox.w}px`,
                  height: `${cropBox.h}px`,
                }}
                className={`absolute border-2 border-emerald-400 bg-emerald-500/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] cursor-move rounded-lg flex flex-col justify-between p-1 transition-shadow ${
                  isDraggingCrop ? 'ring-2 ring-emerald-300 ring-offset-1' : ''
                }`}
              >
                <div className="flex items-center justify-between text-[10px] text-emerald-300 font-black px-1">
                  <span>CCCD</span>
                  <span>Kéo để căn</span>
                </div>
                {/* 4 góc điểm định vị */}
                <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-emerald-400 border border-white rounded-full pointer-events-none" />
                <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-emerald-400 border border-white rounded-full pointer-events-none" />
                <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-emerald-400 border border-white rounded-full pointer-events-none" />
                <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-emerald-400 border border-white rounded-full pointer-events-none" />
              </div>
            </div>

            {/* Thanh nút bấm Hủy & Lưu cắt */}
            <div className="flex items-center gap-3 pt-2">
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
                  Hỗ trợ định dạng JPG, PNG • Tự động xoay, cắt và nhận diện AI
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
                        Nhấn vào 1 ảnh bất kỳ để <strong>cắt & xoay căn chỉnh</strong> trước khi tải lên.
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
