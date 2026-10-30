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
  FolderUp,
  Folder,
  Image as ImageIcon,
  Play,
  RotateCw,
} from 'lucide-react';

interface CccdSupplementModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialParcelCode?: string;
  onSuccess?: () => void;
  defaultMode?: 'single' | 'folder';
}

interface BatchItem {
  id: string;
  file: File;
  previewUrl: string;
  originalName: string;
  soCccd: string;
  hoVaTen: string;
  namSinh?: string;
  gioiTinh?: string;
  status: 'pending' | 'scanning' | 'converting' | 'success' | 'error';
  destFileName: string;
  r2Url?: string;
  errorMessage?: string;
}

export default function CccdSupplementModal({
  isOpen,
  onClose,
  initialParcelCode = '',
  onSuccess,
  defaultMode = 'folder',
}: CccdSupplementModalProps) {
  const [activeTab, setActiveTab] = useState<'folder' | 'single'>(defaultMode);

  // State cho chế độ Đơn Lẻ (Single)
  const [imageFile, setImageFile] = useState<string | null>(null);
  const [soCccd, setSoCccd] = useState('');
  const [hoVaTen, setHoVaTen] = useState('');
  const [namSinh, setNamSinh] = useState('');
  const [gioiTinh, setGioiTinh] = useState('Nam');
  const [maThua, setMaThua] = useState(initialParcelCode);
  const [isScanningAi, setIsScanningAi] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultInfo, setResultInfo] = useState<{ fileName: string; r2Url: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // State cho chế độ Thư Mục / Hàng Loạt (Folder Batch)
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchSuccessMessage, setBatchSuccessMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const multiFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialParcelCode) {
      setMaThua(initialParcelCode);
      setActiveTab('single');
    }
  }, [initialParcelCode]);

  // Hỗ trợ paste ảnh từ Clipboard (Ctrl + V)
  useEffect(() => {
    if (!isOpen || activeTab !== 'single') return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            readAndProcessSingleImage(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  // ============================================================================
  // HÀM TIỆN ÍCH DÙNG CHUNG
  // ============================================================================
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const ocrImageWithAi = async (b64: string): Promise<{ so_cccd?: string; ho_va_ten?: string; nam_sinh?: string; gioi_tinh?: string }> => {
    try {
      const res = await fetch('/api/ocr-cccd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64 }),
      });
      const data: any = await res.json();
      if (data.success && data.data) {
        return {
          so_cccd: data.data.so_cccd || '',
          ho_va_ten: data.data.ho_va_ten || '',
          nam_sinh: data.data.nam_sinh || '',
          gioi_tinh: data.data.gioi_tinh || '',
        };
      }
    } catch (e) {
      console.warn('Lỗi OCR AI:', e);
    }
    return {};
  };

  // ============================================================================
  // LOGIC XỬ LÝ CHẾ ĐỘ ĐƠN LẺ
  // ============================================================================
  const readAndProcessSingleImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const b64 = event.target?.result as string;
      setImageFile(b64);
      setResultInfo(null);
      setErrorMessage('');
      triggerAiOcrSingle(b64);
    };
    reader.readAsDataURL(file);
  };

  const triggerAiOcrSingle = async (b64: string) => {
    setIsScanningAi(true);
    setErrorMessage('');
    const ocrRes = await ocrImageWithAi(b64);
    if (ocrRes.so_cccd) setSoCccd(ocrRes.so_cccd);
    if (ocrRes.ho_va_ten) setHoVaTen(ocrRes.ho_va_ten);
    if (ocrRes.nam_sinh) setNamSinh(ocrRes.nam_sinh);
    if (ocrRes.gioi_tinh) setGioiTinh(ocrRes.gioi_tinh);
    if (!ocrRes.so_cccd && !ocrRes.ho_va_ten) {
      setErrorMessage('AI không nhận diện được chữ trên ảnh, bạn vui lòng điền tay số CCCD hoặc Họ tên.');
    }
    setIsScanningAi(false);
  };

  const handleSaveSingleCccdPdf = async () => {
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
          nam_sinh: namSinh,
          gioi_tinh: gioiTinh,
          ma_thua: maThua,
        }),
      });

      let data: any = null;
      try {
        const text = await res.text();
        if (text) data = JSON.parse(text);
      } catch {}

      if (res.ok && data?.success) {
        setResultInfo({ fileName: data.fileName, r2Url: data.r2Url });
        if (onSuccess) onSuccess();
      } else {
        setErrorMessage(data?.error || `Lỗi tải lên (${res.status}: ${res.statusText || 'Không xác định'})`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi hệ thống');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============================================================================
  // LOGIC XỬ LÝ CHẾ ĐỘ THƯ MỤC / HÀNG LOẠT (FOLDER BATCH)
  // ============================================================================
  const handleFolderFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const newItems: BatchItem[] = [];
    const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const lower = f.name.toLowerCase();
      if (!validExts.some((ext) => lower.endsWith(ext))) continue;

      // Trích xuất gợi ý số CCCD / Tên từ tên file ảnh gốc nếu có sẵn
      let guessCccd = '';
      let guessName = '';
      const cleanBase = f.name.replace(/\.[^/.]+$/, '');
      const digitsMatch = cleanBase.match(/\b\d{9,12}\b/);
      if (digitsMatch) {
        guessCccd = digitsMatch[0];
        const rest = cleanBase.replace(guessCccd, '').replace(/^[-_]+|[-_]+$/g, '').trim();
        if (rest && rest.length > 2) guessName = rest;
      }

      newItems.push({
        id: `batch-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 6)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        originalName: f.name,
        soCccd: guessCccd,
        hoVaTen: guessName,
        status: 'pending',
        destFileName: guessCccd && guessName ? `${guessCccd}_${guessName}.pdf` : (guessCccd ? `${guessCccd}.pdf` : `${cleanBase}.pdf`),
      });
    }

    setBatchItems(newItems);
    setBatchProgress({ current: 0, total: newItems.length });
    setBatchSuccessMessage('');
  };

  const handleStartBatchProcessing = async () => {
    if (batchItems.length === 0) return;

    setIsBatchRunning(true);
    setBatchSuccessMessage('');

    let successCount = 0;
    const updated = [...batchItems];

    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      setBatchProgress({ current: i + 1, total: updated.length });

      try {
        // Bước 1: Quét AI OCR nếu chưa có đủ số CCCD & họ tên
        let curCccd = item.soCccd;
        let curName = item.hoVaTen;

        item.status = 'scanning';
        setBatchItems([...updated]);

        const b64 = await fileToBase64(item.file);

        if (!curCccd || !curName) {
          const ocr = await ocrImageWithAi(b64);
          if (ocr.so_cccd && !curCccd) curCccd = ocr.so_cccd;
          if (ocr.ho_va_ten && !curName) curName = ocr.ho_va_ten;
          if (ocr.nam_sinh) item.namSinh = ocr.nam_sinh;
          if (ocr.gioi_tinh) item.gioiTinh = ocr.gioi_tinh;
        }

        item.soCccd = curCccd;
        item.hoVaTen = curName;

        // Tên file đích chuẩn: sốcccd_tên.pdf
        let finalDestName = '';
        if (curCccd && curName) {
          finalDestName = `${curCccd}_${curName}.pdf`;
        } else if (curCccd) {
          finalDestName = `${curCccd}.pdf`;
        } else {
          finalDestName = `${item.originalName.replace(/\.[^/.]+$/, '')}.pdf`;
        }
        item.destFileName = finalDestName;

        // Bước 2: Chuyển thành PDF khổ A4 và lưu vào R2 cccd/
        item.status = 'converting';
        setBatchItems([...updated]);

        const uploadRes = await fetch('/api/upload-cccd-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frontBase64: b64,
            so_cccd: curCccd,
            ho_va_ten: curName,
            nam_sinh: item.namSinh,
            gioi_tinh: item.gioiTinh,
            skipSync: true, // Tạm thời bỏ qua sync cho từng file
          }),
        });

        let uploadData: any = null;
        try {
          const text = await uploadRes.text();
          if (text) uploadData = JSON.parse(text);
        } catch {}

        if (uploadRes.ok && uploadData?.success) {
          item.status = 'success';
          item.r2Url = uploadData.r2Url;
          item.destFileName = uploadData.fileName || finalDestName;
          successCount++;
        } else {
          item.status = 'error';
          item.errorMessage = uploadData?.error || `Lỗi lưu R2 (${uploadRes.status}: ${uploadRes.statusText || 'Không xác định'})`;
        }
      } catch (err: any) {
        item.status = 'error';
        item.errorMessage = err.message || 'Lỗi xử lý';
      }

      setBatchItems([...updated]);
    }

    // Bước 3: Hoàn thành toàn bộ folder -> Kích hoạt đồng bộ Google Sheet 1 LẦN DUY NHẤT
    try {
      await fetch('/api/sync-sheets');
    } catch (e) {
      console.warn('Lỗi gọi sync-sheets sau batch:', e);
    }

    setIsBatchRunning(false);
    setBatchSuccessMessage(
      `Đã chuyển đổi và lưu thành công ${successCount}/${updated.length} file CCCD PDF A4 vào R2! Hệ thống đã tự động đồng bộ sang Google Sheets.`
    );
    if (onSuccess) onSuccess();
  };

  const previewSingleFileName =
    soCccd && hoVaTen
      ? `${soCccd}_${hoVaTen}.pdf`
      : soCccd
      ? `${soCccd}.pdf`
      : maThua
      ? `${maThua}.pdf`
      : 'cccd_chuan.pdf';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <FolderUp className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Bổ Sung CCCD & Đồng Bộ Tự Động R2
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  AI OCR • PDF A4 • Realtime Sheet
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Tự động nhận diện và chuyển các thửa từ{' '}
                <span className="text-amber-400 font-medium">CHƯA CÓ CCCD</span> sang{' '}
                <span className="text-emerald-400 font-medium">SẴN SÀNG ĐÓNG TẬP (CÓ CCCD)</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/80 px-6 pt-2">
          <button
            onClick={() => setActiveTab('folder')}
            className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === 'folder'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20 rounded-t-xl'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Folder className="w-4 h-4 text-indigo-400" />
            <span>Tải Lên Thư Mục (Folder Nhiều Ảnh CCCD)</span>
            {batchItems.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-600/30 text-indigo-300 font-mono">
                {batchItems.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('single')}
            className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === 'single'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20 rounded-t-xl'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Camera className="w-4 h-4 text-emerald-400" />
            <span>Tải 1 Ảnh CCCD (Đơn Lẻ / Dán Ctrl+V)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* ================================================================ */}
          {/* TAB 1: TẢI THƯ MỤC / NHIỀU ẢNH (FOLDER BATCH) */}
          {/* ================================================================ */}
          {activeTab === 'folder' && (
            <div className="space-y-4">
              {/* Inputs ẩn chọn Thư Mục hoặc Nhiều File */}
              <input
                type="file"
                ref={folderInputRef}
                {...({ webkitdirectory: '', directory: '' } as any)}
                multiple
                onChange={handleFolderFilesSelected}
                className="hidden"
              />
              <input
                type="file"
                ref={multiFileInputRef}
                multiple
                accept="image/*"
                onChange={handleFolderFilesSelected}
                className="hidden"
              />

              {batchItems.length === 0 ? (
                <div className="border-2 border-dashed border-indigo-500/30 hover:border-indigo-500/60 bg-indigo-950/10 hover:bg-indigo-950/20 rounded-3xl p-8 text-center transition flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 flex items-center justify-center text-indigo-400">
                    <FolderUp className="w-8 h-8" />
                  </div>
                  <div className="max-w-md">
                    <h3 className="text-sm font-bold text-slate-200">
                      Chọn Thư Mục Chứa Tất Cả Hình Ảnh CCCD
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Hệ thống sẽ tự động quét AI lấy Số CCCD & Họ tên, đóng khung PDF tỷ lệ A4 chuẩn (không cắt mép) và lưu vào R2 với định dạng <code className="text-indigo-300 font-mono">sốcccd_tên.pdf</code>.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => folderInputRef.current?.click()}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition cursor-pointer"
                    >
                      <Folder className="w-4 h-4" />
                      <span>Chọn Thư Mục (Folder CCCD)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => multiFileInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
                    >
                      <ImageIcon className="w-4 h-4" />
                      <span>Hoặc Chọn Nhiều File Ảnh</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Thanh điều khiển Batch */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-slate-950 rounded-2xl border border-slate-800">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold font-mono">
                        {batchItems.length} Ảnh Đã Chọn
                      </span>
                      {isBatchRunning && (
                        <div className="flex items-center gap-2 text-xs text-indigo-300 font-semibold">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                          <span>
                            Đang xử lý: {batchProgress.current} / {batchProgress.total}...
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setBatchItems([]);
                          setBatchSuccessMessage('');
                        }}
                        disabled={isBatchRunning}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-rose-400 transition cursor-pointer disabled:opacity-50"
                      >
                        Chọn thư mục khác
                      </button>
                      <button
                        type="button"
                        onClick={handleStartBatchProcessing}
                        disabled={isBatchRunning || batchItems.length === 0}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white shadow-lg shadow-indigo-600/30 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isBatchRunning ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Đang Xử Lý & Lưu R2...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 fill-white" />
                            <span>Bắt Đầu Quét AI & Lưu PDF A4 Vào R2</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Thông báo kết quả tổng */}
                  {batchSuccessMessage && (
                    <div className="p-4 bg-emerald-950/40 border border-emerald-600/50 rounded-2xl flex items-center gap-3 text-xs text-emerald-300 font-semibold">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      <span>{batchSuccessMessage}</span>
                    </div>
                  )}

                  {/* Bảng danh sách các ảnh trong folder */}
                  <div className="max-h-[50vh] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/60 divide-y divide-slate-800/80">
                    {batchItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-900/40 transition"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="text-slate-500 font-mono w-6 text-center shrink-0">
                            {idx + 1}
                          </span>
                          <div className="w-12 h-9 bg-slate-900 rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.previewUrl}
                              alt="thumb"
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-200 truncate" title={item.originalName}>
                              {item.originalName}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {item.destFileName && (
                                <span className="font-mono text-[11px] text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/40 truncate">
                                  {item.destFileName}
                                </span>
                              )}
                              {item.soCccd && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  CCCD: {item.soCccd}
                                </span>
                              )}
                              {item.hoVaTen && (
                                <span className="text-[10px] text-slate-400 uppercase">
                                  {item.hoVaTen}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Trạng thái xử lý */}
                        <div className="flex items-center gap-2 shrink-0">
                          {item.status === 'pending' && (
                            <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 text-[11px] font-medium">
                              Chờ xử lý
                            </span>
                          )}
                          {item.status === 'scanning' && (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-medium">
                              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                              <span>Đang đọc AI...</span>
                            </span>
                          )}
                          {item.status === 'converting' && (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[11px] font-medium">
                              <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                              <span>Đang tạo PDF...</span>
                            </span>
                          )}
                          {item.status === 'success' && (
                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Đã lưu R2</span>
                              </span>
                              {item.r2Url && (
                                <a
                                  href={item.r2Url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
                                  title="Xem PDF"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                          )}
                          {item.status === 'error' && (
                            <span
                              className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-medium"
                              title={item.errorMessage}
                            >
                              Lỗi xử lý
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================ */}
          {/* TAB 2: TẢI 1 ẢNH ĐƠN LẺ */}
          {/* ================================================================ */}
          {activeTab === 'single' && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    Ảnh Căn cước công dân:
                  </label>
                  <span className="text-[11px] text-slate-400">Hỗ trợ dán trực tiếp (Ctrl+V) hoặc kéo thả</span>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readAndProcessSingleImage(f);
                  }}
                  accept="image/*"
                  className="hidden"
                />

                {!imageFile ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f && f.type.startsWith('image/')) readAndProcessSingleImage(f);
                    }}
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
                          onClick={() => triggerAiOcrSingle(imageFile)}
                          disabled={isScanningAi}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50 cursor-pointer"
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
                          className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition cursor-pointer"
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
                  {previewSingleFileName}
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
                    Thửa đất đã được nhận diện và chuyển sang tab{' '}
                    <strong className="text-emerald-300">THỬA SẴN SÀNG ĐÓNG TẬP (CÓ CCCD)</strong>.
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
            </div>
          )}

          {/* Banner liên kết ScanName */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-blue-950/40 to-slate-900 border border-blue-500/20 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-200">Xử lý File Scan Hồ Sơ Sau Ký?</p>
                <p className="text-[11px] text-slate-400">
                  Tải file scan tổng lên để tách, đổi tên và lưu vào folder <code className="text-blue-300 font-mono">filescan/</code> trên R2 để đồng bộ qua NHẬP GGS.
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
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
          >
            Đóng
          </button>

          {activeTab === 'single' && (
            <button
              type="button"
              onClick={handleSaveSingleCccdPdf}
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
          )}

          {activeTab === 'folder' && batchItems.length > 0 && (
            <button
              type="button"
              onClick={handleStartBatchProcessing}
              disabled={isBatchRunning}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white shadow-lg shadow-indigo-600/30 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBatchRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang Xử Lý ({batchProgress.current}/{batchProgress.total})...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>Xử Lý {batchItems.length} Ảnh & Đồng Bộ Sheet</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
