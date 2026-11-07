'use client';

import React, { useState } from 'react';
import { GeneratedGcnOntPage, downloadGcnOntZip } from '@/utils/generateGcnOntChecklist';
import { X, Download, Copy, Check, Eye, Archive, Loader2 } from 'lucide-react';

interface GcnOntChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  pages: GeneratedGcnOntPage[];
  totalParcels: number;
  isLight?: boolean;
}

export const GcnOntChecklistModal: React.FC<GcnOntChecklistModalProps> = ({
  isOpen,
  onClose,
  pages,
  totalParcels,
  isLight = true,
}) => {
  const [isZipping, setIsZipping] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [zoomedPage, setZoomedPage] = useState<GeneratedGcnOntPage | null>(null);

  if (!isOpen) return null;

  const handleDownloadZip = async () => {
    try {
      setIsZipping(true);
      await downloadGcnOntZip(pages);
    } catch (err: any) {
      alert(`Lỗi khi tạo file zip: ${err.message}`);
    } finally {
      setIsZipping(false);
    }
  };

  const handleDownloadSingle = (page: GeneratedGcnOntPage) => {
    const a = document.createElement('a');
    a.href = page.dataUrl;
    a.download = page.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopyImage = async (page: GeneratedGcnOntPage, idx: number) => {
    try {
      if (navigator.clipboard && (window as any).ClipboardItem) {
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({
            'image/png': page.blob,
          }),
        ]);
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 2000);
      } else {
        handleDownloadSingle(page);
      }
    } catch {
      handleDownloadSingle(page);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className={`w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden border ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
        }`}
      >
        {/* Header Modal */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
          }`}
        >
          <div>
            <h2 className={`text-lg sm:text-xl font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Danh Sách Thu Thập CCCD & GCN (Chuẩn 9:16)
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Đã tạo thành công <strong className="text-amber-600">{pages.length} ảnh</strong> cho{' '}
              <strong className="text-indigo-600">{totalParcels} thửa đất</strong> (Tối đa 32 tên/trang, chia theo từng thôn/buôn)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isZipping || pages.length === 0}
              onClick={handleDownloadZip}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-black shadow-md transition cursor-pointer bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-amber-600/30 disabled:opacity-75"
            >
              {isZipping ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
              <span>{isZipping ? 'Đang nén zip...' : `Tải Trọn Bộ ZIP (${pages.length} ảnh)`}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className={`p-2 rounded-xl transition cursor-pointer ${
                isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body: Lưới xem trước ảnh */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {pages.map((p, idx) => {
              const isCopied = copiedIdx === idx;
              return (
                <div
                  key={idx}
                  className={`flex flex-col rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  {/* Card Header */}
                  <div
                    className={`px-3 py-2 border-b flex items-center justify-between text-xs font-bold ${
                      isLight ? 'bg-slate-100 text-slate-800 border-slate-200' : 'bg-slate-800/80 text-slate-200 border-slate-700'
                    }`}
                  >
                    <span className="truncate max-w-[170px]" title={p.village}>
                      {p.village}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
                      Trang {p.pageNum}/{p.totalPages} ({p.count} tên)
                    </span>
                  </div>

                  {/* Thumbnail Image Container */}
                  <div
                    onClick={() => setZoomedPage(p)}
                    className="relative cursor-pointer group bg-slate-200 dark:bg-slate-900 aspect-[9/16] overflow-hidden"
                  >
                    <img
                      src={p.dataUrl}
                      alt={p.fileName}
                      className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform duration-200"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <span className="px-3 py-1.5 rounded-lg bg-white/90 text-slate-900 text-xs font-bold flex items-center gap-1.5 shadow-lg">
                        <Eye className="w-3.5 h-3.5" /> Bấm xem lớn
                      </span>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className={`p-2 border-t flex items-center gap-1.5 ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
                    <button
                      type="button"
                      onClick={() => handleDownloadSingle(p)}
                      className={`flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                        isLight
                          ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      }`}
                      title="Tải ảnh PNG chuẩn 9:16 về máy"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải ảnh</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyImage(p, idx)}
                      className={`flex items-center justify-center p-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                        isCopied
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : isLight
                          ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      }`}
                      title="Sao chép ảnh vào clipboard để dán trực tiếp vào Zalo"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modal Zoom Xem Toàn Màn Hình */}
      {zoomedPage && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
          onClick={() => setZoomedPage(null)}
        >
          <div
            className="relative max-h-[95vh] max-w-[90vw] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setZoomedPage(null)}
              className="absolute -top-12 right-0 p-2 rounded-full bg-white/20 hover:bg-white/40 text-white transition cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={zoomedPage.dataUrl}
              alt={zoomedPage.fileName}
              className="max-h-[85vh] w-auto rounded-lg shadow-2xl object-contain"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleDownloadSingle(zoomedPage)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg cursor-pointer transition"
              >
                <Download className="w-4 h-4" />
                <span>Tải ảnh {zoomedPage.fileName}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
