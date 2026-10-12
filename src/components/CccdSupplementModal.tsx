'use client';

import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  Camera,
  Sparkles,
  FileCheck2,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
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
  const [activeTab, setActiveTab] = useState<'cccd' | 'scan'>('cccd');

  // State Tab CCCD
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [soCccd, setSoCccd] = useState('');
  const [hoVaTen, setHoVaTen] = useState('');
  const [maThua, setMaThua] = useState(initialParcelCode);
  const [isScanningAi, setIsScanningAi] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultInfo, setResultInfo] = useState<{ fileName: string; r2Url: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // State Tab Scan
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanMaThua, setScanMaThua] = useState(initialParcelCode);
  const [isSubmittingScan, setIsSubmittingScan] = useState(false);
  const [scanResultInfo, setScanResultInfo] = useState<{ fileName: string; r2Url: string } | null>(null);

  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Xử lý đọc file ảnh thành Base64
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isFront: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const b64 = event.target?.result as string;
      if (isFront) {
        setFrontImage(b64);
        setResultInfo(null);
        // Tự động quét AI khi có mặt trước
        triggerAiOcr(b64);
      } else {
        setBackImage(b64);
      }
    };
    reader.readAsDataURL(file);
  };

  // Quét AI
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
        setErrorMessage(data.error || 'AI không nhận diện được chữ trên ảnh, vui lòng điền thủ công.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi kết nối AI');
    } finally {
      setIsScanningAi(false);
    }
  };

  // Lưu PDF CCCD lên R2
  const handleSaveCccdPdf = async () => {
    if (!frontImage && !backImage) {
      setErrorMessage('Vui lòng chọn ít nhất một ảnh CCCD.');
      return;
    }
    if (!soCccd && !hoVaTen && !maThua) {
      setErrorMessage('Vui lòng nhập Số CCCD hoặc Họ tên để đặt tên file.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/upload-cccd-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontBase64: frontImage,
          backBase64: backImage,
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

  // Tải file Scan sau ký
  const handleSaveScanFile = async () => {
    if (!scanFile) {
      setErrorMessage('Vui lòng chọn file scan.');
      return;
    }
    setIsSubmittingScan(true);
    setErrorMessage('');
    try {
      const fd = new FormData();
      fd.append('file', scanFile);
      if (scanMaThua) fd.append('ma_thua', scanMaThua);

      const res = await fetch('/api/upload-scan', {
        method: 'POST',
        body: fd,
      });
      const data: any = await res.json();
      if (data.success) {
        setScanResultInfo({ fileName: data.fileName, r2Url: data.r2Url });
        if (onSuccess) onSuccess();
      } else {
        setErrorMessage(data.error || 'Lỗi lưu file scan');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi hệ thống');
    } finally {
      setIsSubmittingScan(false);
    }
  };

  const previewFileName = soCccd && hoVaTen
    ? `${soCccd}_${hoVaTen}.pdf`
    : soCccd
    ? `${soCccd}.pdf`
    : maThua
    ? `${maThua}.pdf`
    : 'Chưa đủ thông tin';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-gray-100 my-8">
        {/* Header Modal */}
        <div className="px-6 py-4 bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <Camera className="w-6 h-6 text-yellow-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Bổ sung Hồ sơ & Tự động Quét AI</h2>
              <p className="text-xs text-blue-100">
                Tạo PDF A4 chuẩn photocopy, lưu R2 và đồng bộ tức thì lên Google Sheet
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-gray-200 bg-gray-50/70">
          <button
            onClick={() => {
              setActiveTab('cccd');
              setErrorMessage('');
            }}
            className={`flex-1 py-3 px-4 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === 'cccd'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText className="w-4 h-4" />
            Bổ sung CCCD (Tạo PDF A4)
          </button>
          <button
            onClick={() => {
              setActiveTab('scan');
              setErrorMessage('');
            }}
            className={`flex-1 py-3 px-4 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === 'scan'
                ? 'border-indigo-600 text-indigo-700 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileCheck2 className="w-4 h-4" />
            Tải File Scan Sau Ký (GĐ 3)
          </button>
        </div>

        {/* Body Modal */}
        <div className="p-6 space-y-5">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {activeTab === 'cccd' ? (
            <>
              {/* Thành công */}
              {resultInfo ? (
                <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-3">
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <h3 className="font-bold text-emerald-800 text-base">Đã lưu và đồng bộ thành công!</h3>
                  <p className="text-xs text-emerald-700">
                    File đã được lưu vào Cloudflare R2 và Google Sheet đã được cập nhật sang{' '}
                    <strong>THỬA SẴN SÀNG ĐÓNG TẬP (CÓ CCCD)</strong>.
                  </p>
                  <div className="inline-block p-2 bg-white rounded-lg border border-emerald-200 text-xs font-mono text-emerald-900">
                    📄 {resultInfo.fileName}
                  </div>
                  <div>
                    <a
                      href={resultInfo.r2Url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Xem file PDF A4 trên Cloudflare R2
                    </a>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setResultInfo(null);
                        setFrontImage(null);
                        setBackImage(null);
                        setSoCccd('');
                        setHoVaTen('');
                      }}
                      className="text-xs text-gray-500 hover:underline"
                    >
                      + Bổ sung thêm CCCD cho thửa khác
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Upload 2 mặt ảnh */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Mặt trước */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                        Ảnh CCCD Mặt trước <span className="text-red-500">*</span>
                      </label>
                      <div
                        onClick={() => frontInputRef.current?.click()}
                        className={`relative border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-all h-36 flex flex-col items-center justify-center overflow-hidden ${
                          frontImage
                            ? 'border-blue-400 bg-blue-50/30'
                            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                        }`}
                      >
                        {frontImage ? (
                          <img
                            src={frontImage}
                            alt="Mặt trước"
                            className="w-full h-full object-contain rounded-lg"
                          />
                        ) : (
                          <>
                            <Upload className="w-6 h-6 text-gray-400 mb-1" />
                            <span className="text-xs font-medium text-gray-600">Bấm tải hoặc chụp</span>
                            <span className="text-[10px] text-gray-400">Tự động quét AI</span>
                          </>
                        )}
                        <input
                          ref={frontInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleFileChange(e, true)}
                          className="hidden"
                        />
                      </div>
                    </div>

                    {/* Mặt sau */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                        Ảnh CCCD Mặt sau <span className="text-gray-400 font-normal">(Tùy chọn)</span>
                      </label>
                      <div
                        onClick={() => backInputRef.current?.click()}
                        className={`relative border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-all h-36 flex flex-col items-center justify-center overflow-hidden ${
                          backImage
                            ? 'border-blue-400 bg-blue-50/30'
                            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                        }`}
                      >
                        {backImage ? (
                          <img
                            src={backImage}
                            alt="Mặt sau"
                            className="w-full h-full object-contain rounded-lg"
                          />
                        ) : (
                          <>
                            <Upload className="w-6 h-6 text-gray-400 mb-1" />
                            <span className="text-xs font-medium text-gray-600">Bấm tải hoặc chụp</span>
                            <span className="text-[10px] text-gray-400">Ghép chung trang A4</span>
                          </>
                        )}
                        <input
                          ref={backInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleFileChange(e, false)}
                          className="hidden"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Thanh Quét AI đang chạy */}
                  {isScanningAi && (
                    <div className="flex items-center justify-center gap-2 py-2 px-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-medium">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                      <span>Trợ lý AI đang quét số CCCD và Họ tên từ ảnh...</span>
                    </div>
                  )}

                  {/* Form thông tin trích xuất */}
                  <div className="grid grid-cols-2 gap-3 bg-gray-50 p-4 rounded-xl border border-gray-200/80">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Số CCCD (12 số)
                      </label>
                      <input
                        type="text"
                        value={soCccd}
                        onChange={(e) => setSoCccd(e.target.value)}
                        placeholder="VD: 020064002073"
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-mono font-bold text-blue-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Họ và tên chủ đất
                      </label>
                      <input
                        type="text"
                        value={hoVaTen}
                        onChange={(e) => setHoVaTen(e.target.value)}
                        placeholder="VD: PHAN THANH TRÚC"
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-semibold text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Mã thửa liên kết <span className="text-gray-400 font-normal">(VD: 276_213 - Bỏ trống nếu lưu chung)</span>
                      </label>
                      <input
                        type="text"
                        value={maThua}
                        onChange={(e) => setMaThua(e.target.value)}
                        placeholder="VD: 276_213"
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-mono text-gray-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Tên file & quy cách A4 */}
                  <div className="p-3 bg-blue-50/60 border border-blue-200/80 rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <span className="text-gray-500">Tên file PDF A4 tự sinh:</span>
                      <div className="font-mono font-bold text-blue-800 mt-0.5">
                        📄 {previewFileName}
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-gray-500">
                      <div>Tỷ lệ: <strong>Khổ A4 (210 × 297 mm)</strong></div>
                      <div className="text-emerald-600 font-medium">✓ Giữ nguyên tỉ lệ ảnh (không cắt)</div>
                    </div>
                  </div>

                  {/* Nút Thực hiện */}
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting || isScanningAi || (!frontImage && !backImage)}
                      onClick={handleSaveCccdPdf}
                      className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-2 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Đang tạo PDF A4 & Lưu R2...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-yellow-300" />
                          Tạo PDF A4 & Đồng bộ Google Sheet
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            /* TAB 2: TẢI FILE SCAN HỒ SƠ SAU KÝ */
            <>
              {scanResultInfo ? (
                <div className="p-5 bg-indigo-50 border border-indigo-200 rounded-2xl text-center space-y-3">
                  <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <h3 className="font-bold text-indigo-900 text-base">Đã lưu file scan vào R2!</h3>
                  <p className="text-xs text-indigo-700">
                    Thửa đất đã được tự động chuyển sang <strong>GIAI ĐOẠN 3 (NHẬP GGS)</strong> và điền đủ 57 cột
                    trên Google Sheet.
                  </p>
                  <div className="inline-block p-2 bg-white rounded-lg border border-indigo-200 text-xs font-mono text-indigo-900">
                    📑 {scanResultInfo.fileName}
                  </div>
                  <div>
                    <a
                      href={scanResultInfo.r2Url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Xem file scan trên R2
                    </a>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div
                    onClick={() => scanInputRef.current?.click()}
                    className="border-2 border-dashed border-indigo-300 rounded-2xl p-6 text-center cursor-pointer hover:bg-indigo-50/50 transition-all"
                  >
                    <FileCheck2 className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-gray-800">
                      {scanFile ? scanFile.name : 'Bấm chọn File PDF hoặc Ảnh Hồ Sơ Scan Sau Ký'}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Hỗ trợ file .pdf, .jpg, .png (Dung lượng tối đa 50MB)
                    </p>
                    <input
                      ref={scanInputRef}
                      type="file"
                      accept=".pdf,image/*"
                      onChange={(e) => setScanFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Mã thửa đất hồ sơ đã ký <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={scanMaThua}
                      onChange={(e) => setScanMaThua(e.target.value)}
                      placeholder="VD: 276_213 (Tờ 276 Thửa 213)"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-mono font-bold text-indigo-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">
                      Khi lưu, hệ thống tự động nhận diện và chuyển sang <strong>Giai đoạn 3 (NHẬP GGS)</strong> với đủ
                      57 cột dữ liệu địa chính trên Google Sheet.
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingScan || !scanFile || !scanMaThua}
                      onClick={handleSaveScanFile}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-2 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {isSubmittingScan ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Đang lưu vào R2 & Chuyển GĐ 3...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          Lưu R2 & Chuyển sang GĐ 3 (NHẬP GGS)
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
