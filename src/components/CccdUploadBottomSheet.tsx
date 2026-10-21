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
  Edit2,
  RefreshCw,
} from 'lucide-react';
import geminiKeys from '@/data/gemini_keys.json';

interface SelectedCccdImage {
  id: string;
  file?: File;
  name: string;
  originalUrl: string;
  previewUrl: string;
  isCropped: boolean;
  size: number;
  soCccd?: string;
  hoVaTen?: string;
  maThua?: string;
  isScanning?: boolean;
  scanError?: string;
  errorMessage?: string;
}

interface CccdUploadBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | null;

// Tối ưu hóa ảnh tải lên trên điện thoại: Luôn chuyển sang định dạng JPEG chuẩn (chất lượng 0.85, tối đa 1400px)
// để đảm bảo dung lượng nhẹ (~150-250KB), tốc độ xử lý nhanh và tương thích hoàn toàn với pdf-lib
async function optimizeImageForMobile(
  file: File,
  maxDim = 1400
): Promise<{ previewUrl: string; size: number }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
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
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ previewUrl: dataUrl, size: Math.round(dataUrl.length * 0.75) });
        return;
      }
      resolve({ previewUrl: objectUrl, size: file.size });
    };

    img.onerror = () => {
      // Fallback nếu không load được qua Image (thử FileReader)
      const reader = new FileReader();
      reader.onload = () => resolve({ previewUrl: reader.result as string, size: file.size });
      reader.onerror = () => resolve({ previewUrl: objectUrl, size: file.size });
      reader.readAsDataURL(file);
    };

    img.src = objectUrl;
  });
}

// Chuyển DataURL hoặc Blob URL sang chuỗi base64 JPEG chuẩn
const getBase64FromUrl = async (url: string): Promise<string> => {
  if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg') || url.startsWith('data:image/png')) {
    return url;
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
          return;
        }
      } catch (err) {
        console.warn('Lỗi vẽ canvas getBase64FromUrl, fallback FileReader:', err);
      }
      readDirect();
    };
    img.onerror = () => readDirect();
    img.src = url;

    function readDirect() {
      if (url.startsWith('data:')) return resolve(url);
      fetch(url)
        .then((res) => res.blob())
        .then((blob) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        })
        .catch(reject);
    }
  });
};

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
    }, 4000);
  };

  // Căn khung chuẩn CCCD tự động bắt trọn 100% chiều ngang của ảnh (tỷ lệ 1.586)
  const handleFitCccdFrame = useCallback(() => {
    if (!cropContainerRef.current) return;
    const container = cropContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const imgEl = cropImageRef.current;

    let imgLeft = 0;
    let imgTop = 0;
    let imgW = container.clientWidth;
    let imgH = container.clientHeight;

    if (imgEl && imgEl.clientWidth > 0 && imgEl.clientHeight > 0) {
      const imgRect = imgEl.getBoundingClientRect();
      imgLeft = imgRect.left - containerRect.left;
      imgTop = imgRect.top - containerRect.top;
      imgW = imgRect.width;
      imgH = imgRect.height;
    }

    // Bắt hết toàn bộ 100% chiều ngang của ảnh
    let targetW = Math.round(imgW);
    let targetH = Math.round(targetW / 1.586);

    // Nếu chiều cao vượt quá chiều cao ảnh thì khớp theo chiều cao ảnh
    if (targetH > imgH) {
      targetH = Math.round(imgH);
      targetW = Math.round(targetH * 1.586);
    }

    const targetX = Math.round(imgLeft + (imgW - targetW) / 2);
    const targetY = Math.round(imgTop + (imgH - targetH) / 2);

    setCropBox({
      x: Math.max(0, targetX),
      y: Math.max(0, targetY),
      w: targetW,
      h: targetH,
    });
    setImageZoom(1);
    setCropRatioMode('cccd');
  }, []);

// Biến con trỏ Round-Robin toàn cục giống ScanName để chia đều tải 100% cho các API Key
let currentClientKeyIdx = 0;

  // Hàm gọi trực tiếp Gemini từ trình duyệt của người dùng (tránh lỗi IP Cloudflare Data Center)
  const doDirectGeminiOcr = async (rawB64: string): Promise<{ so_cccd: string; ho_va_ten: string } | null> => {
    try {
      let cleanB64 = rawB64;
      let mimeType = 'image/jpeg';
      if (typeof rawB64 === 'string' && rawB64.includes(',')) {
        const parts = rawB64.split(',');
        const match = parts[0].match(/:(.*?);/);
        if (match && match[1]) mimeType = match[1];
        cleanB64 = parts[1];
      }
      cleanB64 = cleanB64.replace(/\s+/g, '');

      const keys = (geminiKeys as string[])
        .filter((k) => k && typeof k === 'string' && !k.startsWith('DIEN_API_KEY'))
        .map((k) => (k.startsWith('AQ.') ? k : atob(k)));

      if (keys.length === 0) return null;

      // Thuật toán Round-Robin chuẩn ScanName: chia đều tuần tự các ảnh cho từng key
      const startIdx = currentClientKeyIdx;
      currentClientKeyIdx = (currentClientKeyIdx + 1) % keys.length;

      const models = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

      const promptText = `Bạn là chuyên gia trích xuất thông tin Căn cước công dân / Thẻ căn cước Việt Nam.
Hãy đọc kỹ hình ảnh và trả về CHÍNH XÁC một đối tượng JSON:
{
  "so_cccd": "12 chữ số viết liền hoặc 9 chữ số",
  "ho_va_ten": "Họ và tên đầy đủ viết hoa có dấu (Ví dụ: ĐẶNG THỊ HỒNG)"
}`;

      // Thử key xuất phát của ảnh, nếu lỗi quay vòng thử tiếp các key còn lại
      for (let attempt = 0; attempt < keys.length; attempt++) {
        const apiKey = keys[(startIdx + attempt) % keys.length];
        for (const model of models) {
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const payload = {
              contents: [
                {
                  parts: [
                    { text: promptText },
                    { inlineData: { mimeType, data: cleanB64 } },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
              },
            };

            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            if (!res.ok) continue;

            const data: any = await res.json();
            const rawText = (data.candidates?.[0]?.content?.parts || [])
              .map((p: any) => p.text || '')
              .filter(Boolean)
              .join('\n')
              .trim();

            let parsed: any = null;
            try {
              parsed = JSON.parse(rawText);
            } catch {
              const match = rawText.match(/\{[\s\S]*?\}/);
              if (match) {
                try { parsed = JSON.parse(match[0]); } catch {}
              }
            }

            let soCccd = '';
            let hoVaTen = '';
            if (parsed) {
              soCccd = String(parsed.so_cccd || parsed.cccd || parsed.id || '').replace(/\D/g, '');
              hoVaTen = String(parsed.ho_va_ten || parsed.ho_ten || parsed.name || '').replace(/["']/g, '').trim().toUpperCase();
            }

            if (!soCccd || soCccd.length < 9) {
              const digitMatch = rawText.match(/\b\d{12}\b/) || rawText.match(/\b\d{9}\b/);
              if (digitMatch) soCccd = digitMatch[0];
            }

            if (!hoVaTen) {
              const nameMatch = rawText.match(/"ho_va_ten"\s*:\s*"([^"\\]+)"/i);
              if (nameMatch) hoVaTen = nameMatch[1].trim().toUpperCase();
            }

            if (soCccd || hoVaTen) {
              return { so_cccd: soCccd, ho_va_ten: hoVaTen };
            }
          } catch {
            // tiếp tục model khác
          }
        }
      }
    } catch {
      // bỏ qua
    }
    return null;
  };

  // Gọi AI OCR nhận diện thông tin CCCD (Ưu tiên trực tiếp từ máy người dùng, sau đó fallback server)
  const runAiOcrForImage = async (id: string, previewUrl: string) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, isScanning: true, scanError: undefined } : img))
    );
    try {
      const b64 = await getBase64FromUrl(previewUrl);

      // 1. Thử nhận diện trực tiếp từ Client IP (tránh bị Google chặn IP Cloudflare)
      let ocrResult = await doDirectGeminiOcr(b64);

      // 2. Dự phòng gọi qua API server nếu Client bị chặn (ví dụ do chặn adblock)
      if (!ocrResult) {
        try {
          const res = await fetch('/api/ocr-cccd', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: b64 }),
          });
          const data: any = await res.json();
          if (data.success && data.data) {
            ocrResult = data.data;
          }
        } catch {}
      }

      if (ocrResult && (ocrResult.so_cccd || ocrResult.ho_va_ten)) {
        setImages((prev) =>
          prev.map((img) =>
            img.id === id
              ? {
                  ...img,
                  soCccd: ocrResult!.so_cccd || img.soCccd || '',
                  hoVaTen: ocrResult!.ho_va_ten || img.hoVaTen || '',
                  isScanning: false,
                  scanError: undefined,
                  errorMessage: undefined,
                }
              : img
          )
        );
        showToast(`✓ Đã nhận diện: ${ocrResult.so_cccd || ''} ${ocrResult.ho_va_ten ? '• ' + ocrResult.ho_va_ten : ''}`);
      } else {
        setImages((prev) =>
          prev.map((img) =>
            img.id === id
              ? {
                  ...img,
                  isScanning: false,
                  scanError: 'AI không nhận diện được chữ, vui lòng điền tay bên dưới',
                }
              : img
          )
        );
      }
    } catch {
      setImages((prev) =>
        prev.map((img) =>
          img.id === id ? { ...img, isScanning: false, scanError: 'Lỗi kết nối AI' } : img
        )
      );
    }
  };

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

        // Trích xuất gợi ý số CCCD / Tên từ tên file ảnh gốc nếu có sẵn
        let guessCccd = '';
        let guessName = '';
        const cleanBase = file.name.replace(/\.[^/.]+$/, '');
        const digitsMatch = cleanBase.match(/\b\d{9,12}\b/);
        if (digitsMatch) {
          guessCccd = digitsMatch[0];
          const rest = cleanBase.replace(guessCccd, '').replace(/^[-_]+|[-_]+$/g, '').trim();
          if (rest && rest.length > 2) guessName = rest.replace(/_/g, ' ');
        }

        const newId = `${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`;
        newItems.push({
          id: newId,
          file,
          name: file.name,
          originalUrl: previewUrl,
          previewUrl,
          isCropped: false,
          size,
          soCccd: guessCccd,
          hoVaTen: guessName,
          isScanning: true,
        });

        // Tự động kích hoạt AI OCR nhận diện ngay lập tức
        runAiOcrForImage(newId, previewUrl);
      } catch (err) {
        console.warn('Lỗi tối ưu ảnh:', err);
      }
    }

    setIsOptimizing(false);

    if (newItems.length > 0) {
      setImages((prev) => [...prev, ...newItems]);
      showToast(`Đã nạp ${newItems.length} ảnh. AI đang quét số CCCD và Họ tên tự động.`);
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

      const rotatedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

      setImages((prev) =>
        prev.map((item) =>
          item.id === editingImage.id
            ? { ...item, previewUrl: rotatedDataUrl, isCropped: true, isScanning: true }
            : item
        )
      );

      // Quét lại AI sau khi xoay đúng hướng
      runAiOcrForImage(editingImage.id, rotatedDataUrl);
      showToast('Đã xoay ảnh 90°. AI đang quét lại...');
    };
  };

  // Pointer event handlers cho kéo thả & co giãn khung cắt
  const handlePointerDownAction = (mode: DragMode, e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

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

  const handlePointerMoveAction = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragMode || !cropContainerRef.current) return;

    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;
    const containerW = cropContainerRef.current.clientWidth;
    const containerH = cropContainerRef.current.clientHeight;

    if (dragMode === 'move') {
      const newX = Math.max(0, Math.min(containerW - cropBox.w, dragStart.boxX + deltaX));
      const newY = Math.max(0, Math.min(containerH - cropBox.h, dragStart.boxY + deltaY));
      setCropBox((prev) => ({ ...prev, x: newX, y: newY }));
      return;
    }

    if (cropRatioMode === 'cccd') {
      const ratio = 1.586;
      if (dragMode === 'se') {
        const potentialW = Math.max(80, Math.min(containerW - dragStart.boxX, dragStart.boxW + deltaX));
        const potentialH = Math.round(potentialW / ratio);
        if (dragStart.boxY + potentialH <= containerH) {
          setCropBox({
            x: dragStart.boxX,
            y: dragStart.boxY,
            w: potentialW,
            h: potentialH,
          });
        }
      } else if (dragMode === 'sw') {
        const potentialW = Math.max(80, Math.min(dragStart.boxX + dragStart.boxW, dragStart.boxW - deltaX));
        const potentialH = Math.round(potentialW / ratio);
        const newX = dragStart.boxX + (dragStart.boxW - potentialW);
        if (newX >= 0 && dragStart.boxY + potentialH <= containerH) {
          setCropBox({
            x: newX,
            y: dragStart.boxY,
            w: potentialW,
            h: potentialH,
          });
        }
      } else if (dragMode === 'ne') {
        const potentialW = Math.max(80, Math.min(containerW - dragStart.boxX, dragStart.boxW + deltaX));
        const potentialH = Math.round(potentialW / ratio);
        const newY = dragStart.boxY + (dragStart.boxH - potentialH);
        if (newY >= 0) {
          setCropBox({
            x: dragStart.boxX,
            y: newY,
            w: potentialW,
            h: potentialH,
          });
        }
      } else if (dragMode === 'nw') {
        const potentialW = Math.max(80, Math.min(dragStart.boxX + dragStart.boxW, dragStart.boxW - deltaX));
        const potentialH = Math.round(potentialW / ratio);
        const newX = dragStart.boxX + (dragStart.boxW - potentialW);
        const newY = dragStart.boxY + (dragStart.boxH - potentialH);
        if (newX >= 0 && newY >= 0) {
          setCropBox({
            x: newX,
            y: newY,
            w: potentialW,
            h: potentialH,
          });
        }
      }
    } else {
      let potentialW = dragStart.boxW;
      let potentialH = dragStart.boxH;
      let potentialX = dragStart.boxX;
      let potentialY = dragStart.boxY;

      if (dragMode.includes('e')) {
        potentialW = Math.max(60, Math.min(containerW - dragStart.boxX, dragStart.boxW + deltaX));
      }
      if (dragMode.includes('s')) {
        potentialH = Math.max(40, Math.min(containerH - dragStart.boxY, dragStart.boxH + deltaY));
      }
      if (dragMode.includes('w')) {
        potentialW = Math.max(60, Math.min(dragStart.boxX + dragStart.boxW, dragStart.boxW - deltaX));
        potentialX = dragStart.boxX + (dragStart.boxW - potentialW);
      }
      if (dragMode.includes('n')) {
        potentialH = Math.max(40, Math.min(dragStart.boxY + dragStart.boxH, dragStart.boxH - deltaY));
        potentialY = dragStart.boxY + (dragStart.boxH - potentialH);
      }

      setCropBox({
        x: potentialX,
        y: potentialY,
        w: potentialW,
        h: potentialH,
      });
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

    const cropRelativeX = cropBox.x - (imgRect.left - containerRect.left);
    const cropRelativeY = cropBox.y - (imgRect.top - containerRect.top);

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

    const maxDim = 1400;
    let targetW = Math.round(realCropW);
    let targetH = Math.round(realCropH);
    if (targetW > maxDim || targetH > maxDim) {
      if (targetW > targetH) {
        targetH = Math.round((targetH * maxDim) / targetW);
        targetW = maxDim;
      } else {
        targetW = Math.round((targetW * maxDim) / targetH);
        targetH = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, targetW);
    canvas.height = Math.max(1, targetH);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sourceImg = new Image();
    sourceImg.src = editingImage.previewUrl;
    sourceImg.onload = () => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceImg, realCropX, realCropY, realCropW, realCropH, 0, 0, canvas.width, canvas.height);
      const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.88);

      setImages((prev) =>
        prev.map((item) =>
          item.id === editingImage.id
            ? { ...item, previewUrl: croppedDataUrl, isCropped: true }
            : item
        )
      );
      setEditingImageId(null);
      showToast('✓ Đã lưu ảnh CCCD đã cắt!');

      // Nếu chưa có số CCCD, thử quét lại trên ảnh đã cắt gọn
      if (!editingImage.soCccd) {
        runAiOcrForImage(editingImage.id, croppedDataUrl);
      }
    };
  };

  // Tải Lên Tất Cả Ảnh CCCD Đã Chuẩn Bị
  const handleUploadAll = async () => {
    if (images.length === 0) return;

    // Kiểm tra xem có ảnh nào chưa có số CCCD lẫn Họ tên không
    const invalidItems = images.filter(
      (img) => !img.soCccd?.trim() && !img.hoVaTen?.trim() && !img.maThua?.trim()
    );

    if (invalidItems.length > 0) {
      showToast(
        `⚠️ Có ${invalidItems.length} ảnh chưa có Số CCCD hoặc Họ tên. Vui lòng nhập thông tin trước khi tải lên!`
      );
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    const successfulIds = new Set<string>();

    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      setUploadProgress({
        current: i + 1,
        total: images.length,
        message: `Đang lưu PDF CCCD vào hệ thống (${i + 1}/${images.length})...`,
      });

      try {
        const b64 = await getBase64FromUrl(item.previewUrl);

        const uploadRes = await fetch('/api/upload-cccd-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frontBase64: b64,
            so_cccd: item.soCccd?.trim() || '',
            ho_va_ten: item.hoVaTen?.trim() || '',
            ma_thua: item.maThua?.trim() || '',
            skipSync: true,
          }),
        });

        let uploadData: any = null;
        try {
          const resText = await uploadRes.text();
          if (resText) {
            uploadData = JSON.parse(resText);
          }
        } catch {
          // Phản hồi không phải JSON hợp lệ (ví dụ Cloudflare HTML timeout hoặc rỗng)
        }

        if (uploadRes.ok && uploadData?.success) {
          successCount++;
          successfulIds.add(item.id);
        } else {
          const errDetail =
            uploadData?.error ||
            (uploadRes.status === 413
              ? 'Dung lượng ảnh quá lớn (413)'
              : uploadRes.status === 504 || uploadRes.status === 502
              ? 'Máy chủ Cloudflare bị timeout/quá tải (502/504)'
              : `Lỗi máy chủ (${uploadRes.status}: ${uploadRes.statusText || 'Không xác định'})`);

          setImages((prev) =>
            prev.map((img) =>
              img.id === item.id
                ? { ...img, errorMessage: errDetail }
                : img
            )
          );
        }
      } catch (err: any) {
        setImages((prev) =>
          prev.map((img) =>
            img.id === item.id ? { ...img, errorMessage: err.message || 'Lỗi kết nối mạng' } : img
          )
        );
      }
    }

    // Kích hoạt đồng bộ Google Sheets 1 lần duy nhất nếu có file thành công
    if (successCount > 0) {
      try {
        await fetch('/api/sync-sheets');
      } catch {
        // ignore
      }
    }

    setIsUploading(false);

    if (successCount === images.length) {
      showToast(`✓ Đã lưu thành công ${successCount} file CCCD PDF vào kho lưu trữ!`);
      setImages([]);
      setEditingImageId(null);
      if (onSuccess) onSuccess();
    } else {
      showToast(
        `✓ Đã tải lên thành công ${successCount}/${images.length} file. Vui lòng kiểm tra lại file bị lỗi.`
      );
      // Giữ lại các ảnh bị lỗi để người dùng sửa đổi mà không mất dữ liệu
      setImages((prev) => prev.filter((img) => !successfulIds.has(img.id)));
      if (onSuccess) onSuccess();
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
            ? 'w-full lg:w-[540px] h-[88vh] max-h-[92vh] lg:h-[90vh] lg:bottom-4 lg:left-4 bottom-0 left-0 rounded-t-3xl lg:rounded-3xl border-t lg:border border-slate-200 opacity-100 translate-y-0 pointer-events-auto'
            : 'w-full lg:w-[540px] h-[88vh] max-h-[92vh] lg:h-[90vh] lg:bottom-4 lg:left-4 bottom-0 left-0 rounded-t-3xl lg:rounded-3xl border-0 opacity-0 translate-y-full pointer-events-none'
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
                  : `Đã chọn ${images.length} ảnh (${images.filter((i) => i.soCccd || i.hoVaTen).length} đã nhận diện)`}
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
          <div className="mx-4 mt-2 px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-1 z-30">
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
                <span className="text-xs font-bold truncate max-w-[130px] sm:max-w-[160px]">
                  {editingImage.name}
                </span>
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
                      cropRatioMode === 'cccd'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Khóa khung theo tỷ lệ thẻ căn cước chuẩn (1.586)"
                  >
                    Chuẩn CCCD
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropRatioMode('free')}
                    className={`px-2 py-1 rounded-md transition cursor-pointer ${
                      cropRatioMode === 'free'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
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
                  onLoad={() => handleFitCccdFrame()}
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
                    {cropRatioMode === 'cccd'
                      ? 'CCCD (1.59)'
                      : `${Math.round(cropBox.w)}×${Math.round(cropBox.h)}`}
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

                {/* 4 NÚT TAY CẦM GÓC CẢM ỨNG LỚN */}
                <div
                  onPointerDown={(e) => handlePointerDownAction('nw', e)}
                  className="absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
                  title="Kéo góc trên-trái"
                >
                  <div className="w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full shadow-md" />
                </div>

                <div
                  onPointerDown={(e) => handlePointerDownAction('ne', e)}
                  className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
                  title="Kéo góc trên-phải"
                >
                  <div className="w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full shadow-md" />
                </div>

                <div
                  onPointerDown={(e) => handlePointerDownAction('sw', e)}
                  className="absolute -bottom-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
                  title="Kéo góc dưới-trái"
                >
                  <div className="w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full shadow-md" />
                </div>

                <div
                  onPointerDown={(e) => handlePointerDownAction('se', e)}
                  className="absolute -bottom-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
                  title="Kéo góc dưới-phải"
                >
                  <div className="w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full shadow-md" />
                </div>
              </div>
            </div>

            {/* Thông tin số CCCD & Họ tên chỉnh sửa được */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 mb-2 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5 text-purple-400" />
                  Thông tin CCCD:
                </span>
                <button
                  type="button"
                  onClick={() => runAiOcrForImage(editingImage.id, editingImage.previewUrl)}
                  disabled={editingImage.isScanning}
                  className="text-[10px] text-purple-300 hover:text-purple-200 font-bold flex items-center gap-1 cursor-pointer bg-purple-950/80 px-2 py-0.5 rounded-md border border-purple-800"
                >
                  {editingImage.isScanning ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3 text-amber-400" />
                  )}
                  <span>Quét lại AI</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">Số CCCD</label>
                  <input
                    type="text"
                    value={editingImage.soCccd || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 12);
                      setImages((prev) =>
                        prev.map((img) => (img.id === editingImage.id ? { ...img, soCccd: val } : img))
                      );
                    }}
                    placeholder="VD: 066069000926"
                    className="w-full px-2.5 py-1.5 bg-slate-800 text-white rounded-lg border border-slate-700 font-mono text-xs focus:ring-1 focus:ring-purple-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">Họ và tên</label>
                  <input
                    type="text"
                    value={editingImage.hoVaTen || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setImages((prev) =>
                        prev.map((img) => (img.id === editingImage.id ? { ...img, hoVaTen: val } : img))
                      );
                    }}
                    placeholder="VD: PHAN THANH TRÚC"
                    className="w-full px-2.5 py-1.5 bg-slate-800 text-white rounded-lg border border-slate-700 text-xs focus:ring-1 focus:ring-purple-500 outline-none uppercase font-semibold"
                  />
                </div>
              </div>
            </div>

            {/* Thanh điều khiển Zoom ảnh linh hoạt */}
            <div className="flex flex-wrap items-center justify-between px-2.5 py-1.5 bg-slate-900 rounded-xl mb-2 text-xs gap-2">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Scan className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="text-[11px] font-semibold">Thu phóng:</span>
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
                Đóng cắt
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
                  Hỗ trợ định dạng JPG, PNG • Tự động nhận diện AI số CCCD và Họ tên
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
                        Kiểm tra số CCCD & Họ tên bên dưới trước khi bấm <strong>Tải Lên</strong>.
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

                  {/* Danh sách thẻ ảnh (1 cột dạng danh sách trực quan trên điện thoại) */}
                  <div className="space-y-3">
                    {images.map((item, idx) => {
                      const isComplete = Boolean(item.soCccd || item.hoVaTen);
                      return (
                        <div
                          key={item.id}
                          className={`p-3 rounded-2xl border-2 transition-all bg-white shadow-xs ${
                            item.errorMessage
                              ? 'border-rose-400 bg-rose-50/20'
                              : isComplete
                              ? 'border-emerald-300'
                              : 'border-amber-300'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Khối Ảnh thu nhỏ */}
                            <div
                              onClick={() => handleStartCrop(item)}
                              className="relative w-28 aspect-[1.58/1] rounded-xl overflow-hidden bg-slate-950 shrink-0 cursor-pointer group shadow-inner"
                              title="Nhấn để cắt hoặc xoay ảnh"
                            >
                              <img
                                src={item.previewUrl}
                                alt={item.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                              />

                              {/* STT ảnh */}
                              <span className="absolute top-1 left-1 w-4 h-4 bg-black/70 text-white rounded-full text-[9px] font-black flex items-center justify-center">
                                {idx + 1}
                              </span>

                              {/* Badge Đã cắt */}
                              {item.isCropped && (
                                <span className="absolute bottom-1 right-1 px-1 py-0.2 rounded text-[8px] font-black bg-emerald-600 text-white shadow-xs">
                                  Đã cắt
                                </span>
                              )}

                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                                <Crop className="w-4 h-4 text-white drop-shadow" />
                              </div>
                            </div>

                            {/* Cột Thông Tin CCCD & Thao Tác */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1 mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  {item.isScanning ? (
                                    <span className="text-[11px] font-bold text-purple-600 flex items-center gap-1 animate-pulse">
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      AI đang nhận diện...
                                    </span>
                                  ) : isComplete ? (
                                    <span className="text-[11px] font-black text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      Đã nhận diện
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3 text-amber-600" />
                                      Điền số CCCD / Tên
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => runAiOcrForImage(item.id, item.previewUrl)}
                                    disabled={item.isScanning}
                                    className="p-1 text-slate-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition cursor-pointer disabled:opacity-40"
                                    title="Quét lại AI (nhận diện số CCCD và Tên)"
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${item.isScanning ? 'animate-spin text-purple-600' : ''}`} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStartCrop(item)}
                                    className="p-1 text-slate-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition cursor-pointer"
                                    title="Cắt hoặc xoay ảnh này"
                                  >
                                    <Crop className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => handleRemoveImage(item.id, e)}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                    title="Xóa ảnh"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Form Điền / Sửa Số CCCD & Họ Tên Ngay Tại Thẻ */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                                <div>
                                  <input
                                    type="text"
                                    value={item.soCccd || ''}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/\D/g, '').slice(0, 12);
                                      setImages((prev) =>
                                        prev.map((img) => (img.id === item.id ? { ...img, soCccd: val, errorMessage: undefined } : img))
                                      );
                                    }}
                                    placeholder="Số CCCD (12 số)..."
                                    className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] font-semibold text-slate-800 focus:bg-white focus:ring-1 focus:ring-purple-500 outline-none"
                                  />
                                </div>

                                <div>
                                  <input
                                    type="text"
                                    value={item.hoVaTen || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setImages((prev) =>
                                        prev.map((img) => (img.id === item.id ? { ...img, hoVaTen: val, errorMessage: undefined } : img))
                                      );
                                    }}
                                    placeholder="Họ và tên..."
                                    className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 uppercase focus:bg-white focus:ring-1 focus:ring-purple-500 outline-none"
                                  />
                                </div>
                              </div>

                              {/* Lỗi hiển thị nếu có */}
                              {item.errorMessage && (
                                <div className="mt-1 text-[10px] text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3 shrink-0" />
                                  <span>{item.errorMessage}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* THANH ĐIỀU KHIỂN & NÚT TẢI LÊN DƯỚI CÙNG */}
                <div className="pt-4 mt-4 border-t border-slate-100 sticky bottom-0 bg-white">
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
                      <span>Lưu Lên Hệ Thống ({images.length} file)</span>
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
