'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Upload,
  Camera,
  Sparkles,
  FileText,
  FileCheck,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface CccdSupplementModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialParcelCode?: string;
  onSuccess?: () => void;
}

export default function CccdSupplementModal({
  isOpen,
  onClose,
  initialParcelCode = '',
  onSuccess,
}: CccdSupplementModalProps) {
  const [imageFile, setImageFile] = useState<string | null>(null);
  const [soCccd, setSoCccd] = useState('');
  const [hoVaTen, setHoVaTen] = useState('');
  const [maThua, setMaThua] = useState(initialParcelCode);
  const [isScanningAi, setIsScanningAi] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultInfo, setResultInfo] = useState<{ fileName: string; r2Url: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialParcelCode) {
      setMaThua(initialParcelCode);
    }
  }, [initialParcelCode]);

  // Hỗ trợ paste ảnh từ Clipboard (Ctrl + V)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            readAndProcessImage(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen]);

  if (!isOpen) return null;

  // Đọc file ảnh thành Base64
  const readAndProcessImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const b64 = event.target?.result as string;
      setImageFile(b64);
      setResultInfo(null);
      setErrorMessage('');
      // Tự động quét AI khi vừa nhận ảnh
      triggerAiOcr(b64);
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readAndProcessImage(file);
    }
  };

  // Kéo thả ảnh
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      readAndProcessImage(file);
    }
  };

  // Quét AI bằng Gemini Flash
  const triggerAiOcr = async (b64: string) => {
    setIsScanningAi(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/ocr-cccd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64 }),
      });
      const data: any = await res.json();
      if (data.success && data.data) {
        if (data.data.so_cccd) setSoCccd(data.data.so_cccd);
        if (data.data.ho_va_ten) setHoVaTen(data.data.ho_va_ten);
      } else {
        setErrorMessage(data.error || 'AI không nhận diện được chữ trên ảnh, bạn vui lòng điền tay.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi kết nối máy chủ AI');
    } finally {
      setIsScanningAi(false);
    }
  };

  // Lưu PDF CCCD lên R2 và đồng bộ Google Sheets
  const handleSaveCccdPdf = async () => {
    if (!imageFile) {
      setErrorMessage('Vui lòng chọn 1 ảnh CCCD.');
      return;
    }
    if (!soCccd && !hoVaTen && !maThua) {
      setErrorMessage('Vui lòng nhập Số CCCD hoặc Mã thửa để đặt tên file.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/upload-cccd-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontBase64: imageFile,
          so_cccd: soCccd,
          ho_va_ten: hoVaTen,
          ma_thua: maThua,
        }),
      });
      const data: any = await res.json();
      if (data.success) {
        setResultInfo({ fileName: data.fileName, r2Url: data.r2Url });
        if (onSuccess) onSuccess();
      } else {
        setErrorMessage(data.error || 'Lỗi khi lưu file lên R2');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi hệ thống');
    } finally {
      setIsSubmitting(false);
    }
  };

  const previewFileName = soCccd && hoVaTen
    ? `${soCccd}_${hoVaTen}.pdf`
    : soCccd
    ? `${soCccd}.pdf`
    : maThua
    ? `${maThua}.pdf`
    : 'cccd_chuan.pdf';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Camera className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Bổ Sung CCCD (1 Ảnh Duy Nhất)
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  AI OCR • PDF A4
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Tự động chuyển từ <span className="text-amber-400 font-medium">THỬA ĐANG KÊ KHAI (CHƯA CÓ CCCD)</span> sang <span className="text-emerald-400 font-medium">THỬA SẴN SÀNG ĐÓNG TẬP (CÓ CCCD)</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Vùng chọn/tải 1 ảnh CCCD */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                Ảnh Căn cước công dân (1 ảnh duy nhất):
              </label>
              <span className="text-[11px] text-slate-400">Hỗ trợ dán trực tiếp (Ctrl+V) hoặc kéo thả</span>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              accept="image/*"
              className="hidden"
            />

            {!imageFile ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="border-2 border-dashed border-indigo-500/30 hover:border-indigo-500/60 bg-indigo-950/10 hover:bg-indigo-950/20 rounded-2xl p-7 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 group"
              >
                <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition duration-300">
                  <Upload className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-200">
                    Bấm vào đây để chọn ảnh hoặc Kéo & Thả ảnh vào
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Hỗ trợ JPG, PNG, WebP (Hoặc chụp trực tiếp từ điện thoại / Dán Ctrl+V)
                  </p>
                </div>
              </div>
            ) : (
              <div className="relative rounded-2xl border border-indigo-500/30 bg-slate-950 p-3 flex flex-col sm:flex-row items-center gap-4">
                <div className="relative w-full sm:w-48 h-32 bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center border border-slate-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageFile}
                    alt="CCCD"
                    className="max-w-full max-h-full object-contain"
                  />
                  {isScanningAi && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-xs text-indigo-300 gap-1.5 font-medium">
                      <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                      <span>Đang quét AI...</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2 w-full">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => triggerAiOcr(imageFile)}
                      disabled={isScanningAi}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                      {isScanningAi ? 'Đang đọc AI...' : 'Quét Lại AI (OCR)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setImageFile(null);
                        setResultInfo(null);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition"
                    >
                      Đổi ảnh khác
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Ảnh sẽ được đặt vừa vặn vào khung khổ A4 chuẩn (không cắt mép) khi lưu vào Cloudflare R2.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Form thông tin trích xuất & ghép thửa */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Số CCCD (12 số)
              </label>
              <input
                type="text"
                value={soCccd}
                onChange={(e) => setSoCccd(e.target.value)}
                placeholder="Ví dụ: 020064002073"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm font-semibold text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder-slate-600 font-mono"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Họ và Tên Chủ Hộ
              </label>
              <input
                type="text"
                value={hoVaTen}
                onChange={(e) => setHoVaTen(e.target.value)}
                placeholder="Ví dụ: Phan Thanh Trúc"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm font-semibold text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder-slate-600 uppercase"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Mã Thửa Đất (Để liên kết tự động chuyển trạng thái đóng tập)
              </label>
              <input
                type="text"
                value={maThua}
                onChange={(e) => setMaThua(e.target.value)}
                placeholder="Ví dụ: 276_213 (Tờ 276 Thửa 213)"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm font-semibold text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder-slate-600"
              />
            </div>
          </div>

          {/* Tên file PDF dự kiến */}
          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">Tên file PDF A4 trên R2:</span>
            <span className="font-mono font-bold text-indigo-300 bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-800/40">
              {previewFileName}
            </span>
          </div>

          {/* Thông báo lỗi */}
          {errorMessage && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl flex items-center gap-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Kết quả thành công */}
          {resultInfo && (
            <div className="p-4 bg-emerald-950/50 border border-emerald-600/50 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-emerald-300 text-sm font-bold">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Đã lưu PDF A4 vào R2 & Đồng bộ sang Google Sheet!</span>
              </div>
              <p className="text-xs text-slate-300">
                Thửa đất đã được chuyển sang tab <strong className="text-emerald-300">THỬA SẴN SÀNG ĐÓNG TẬP (CÓ CCCD)</strong>.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <a
                  href={resultInfo.r2Url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 text-xs font-semibold border border-emerald-500/30 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Xem file PDF trên Cloudflare R2
                </a>
              </div>
            </div>
          )}

          {/* Banner dẫn sang ScanName Pro */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-950/40 to-slate-900 border border-blue-500/20 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-200">Xử lý File Scan Tổng Sau Ký?</p>
                <p className="text-[11px] text-slate-400">
                  Tải file scan tổng lên để tách, đổi tên và lưu vào folder <code className="text-blue-300 font-mono">filescan/</code> trên R2.
                </p>
              </div>
            </div>
            <a
              href="/scanname/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 text-xs font-bold border border-blue-500/30 transition whitespace-nowrap"
            >
              <span>Mở ScanName</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
          >
            Đóng
          </button>

          <button
            type="button"
            onClick={handleSaveCccdPdf}
            disabled={isSubmitting || !imageFile}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white shadow-lg shadow-indigo-600/30 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang tạo PDF A4 & Đồng bộ...</span>
              </>
            ) : (
              <>
                <FileCheck className="w-4 h-4 text-emerald-300" />
                <span>Lưu PDF A4 Vào R2 & Đồng Bộ Sheet</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
