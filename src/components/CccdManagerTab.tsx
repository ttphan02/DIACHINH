'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  Trash2,
  ExternalLink,
  Eye,
  FileText,
  AlertCircle,
  CheckCircle2,
  Layers,
  Sparkles,
  Loader2,
  HardDrive,
  User,
  MapPin,
  Calendar,
} from 'lucide-react';

interface CccdFileItem {
  key: string;
  filename: string;
  size: number;
  uploadedAt: string | null;
  url: string;
  cccdNumber: string;
  ownerName: string;
  matchedParcelCode: string;
}

interface CccdManagerTabProps {
  onOpenAddModal: () => void;
  onSelectParcel?: (maThua: string) => void;
  onPreviewUrl?: (url: string, title: string) => void;
}

export default function CccdManagerTab({
  onOpenAddModal,
  onSelectParcel,
  onPreviewUrl,
}: CccdManagerTabProps) {
  const [files, setFiles] = useState<CccdFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [deletingFile, setDeletingFile] = useState<CccdFileItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Tải danh sách file CCCD từ R2
  const loadCccdFiles = useCallback(async () => {
    setIsLoading(true);
    setFeedbackMessage(null);
    try {
      const res = await fetch(`/api/cccd?t=${Date.now()}`);
      const data = (await res.json()) as any;
      if (data.success && Array.isArray(data.files)) {
        setFiles(data.files);
      } else {
        setFeedbackMessage({ type: 'error', text: data.error || 'Lỗi tải danh sách CCCD' });
      }
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: err.message || 'Lỗi kết nối máy chủ' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCccdFiles();
  }, [loadCccdFiles]);

  // Xóa file CCCD khỏi R2
  const handleDeleteConfirm = async () => {
    if (!deletingFile) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/cccd?file=${encodeURIComponent(deletingFile.filename)}`, {
        method: 'DELETE',
      });
      const data = (await res.json()) as any;
      if (data.success) {
        setFeedbackMessage({
          type: 'success',
          text: `Đã xóa file "${deletingFile.filename}" và tự động đồng bộ lại Google Sheet!`,
        });
        setFiles((prev) => prev.filter((f) => f.filename !== deletingFile.filename));
        setDeletingFile(null);
      } else {
        setFeedbackMessage({ type: 'error', text: data.error || 'Không thể xóa file' });
      }
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: err.message || 'Lỗi kết nối khi xóa' });
    } finally {
      setIsDeleting(false);
    }
  };

  // Lọc danh sách theo tìm kiếm và bộ lọc trạng thái
  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter((f) => {
      // Bộ lọc loại
      if (filterType === 'matched' && !f.matchedParcelCode) return false;
      if (filterType === 'unmatched' && f.matchedParcelCode) return false;

      // Tìm kiếm text
      if (!q) return true;
      return (
        f.filename.toLowerCase().includes(q) ||
        f.cccdNumber.includes(q) ||
        f.ownerName.toLowerCase().includes(q) ||
        f.matchedParcelCode.toLowerCase().includes(q)
      );
    });
  }, [files, searchQuery, filterType]);

  const matchedCount = useMemo(() => files.filter((f) => !!f.matchedParcelCode).length, [files]);
  const unmatchedCount = files.length - matchedCount;

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-sm space-y-5">
      {/* Top Banner / Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <HardDrive className="w-5 h-5 text-indigo-400" />
            </span>
            Kho Quản Lý CCCD Cloudflare R2
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              {files.length} File PDF
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Xem, thêm, xóa các file CCCD trên bộ nhớ đám mây R2 • Tự động đồng bộ sang Google Sheets Realtime
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={loadCccdFiles}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer disabled:opacity-50"
            title="Tải lại danh sách từ Cloudflare R2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            <span>Làm mới</span>
          </button>

          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white shadow-lg shadow-indigo-600/30 transition cursor-pointer border border-blue-400/30"
          >
            <Plus className="w-4 h-4 text-white" />
            <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
            <span>Thêm CCCD Mới (Quét AI)</span>
          </button>
        </div>
      </div>

      {/* Thông báo feedback */}
      {feedbackMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-600/50 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-slate-400 hover:text-white text-xs font-bold"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo số CCCD (12 số), Họ tên chủ hộ, Mã thửa (ví dụ: 276_213)..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs font-bold"
            >
              Xóa
            </button>
          )}
        </div>

        {/* Filter Badges */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0 text-xs">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
              filterType === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Tất cả ({files.length})
          </button>
          <button
            onClick={() => setFilterType('matched')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
              filterType === 'matched'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Đã gán thửa ({matchedCount})
          </button>
          <button
            onClick={() => setFilterType('unmatched')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
              filterType === 'unmatched'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Chưa gán thửa ({unmatchedCount})
          </button>
        </div>
      </div>

      {/* Grid Danh Sách File CCCD */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <span className="text-xs font-medium">Đang tải danh sách file CCCD từ Cloudflare R2...</span>
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="py-16 text-center text-slate-500 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800 space-y-2">
          <FileText className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-sm font-semibold text-slate-400">Không tìm thấy file CCCD nào phù hợp</p>
          <p className="text-xs text-slate-500">
            {searchQuery
              ? 'Thử thay đổi từ khóa tìm kiếm số CCCD hoặc họ tên'
              : 'Chưa có file CCCD nào trong kho lưu trữ'}
          </p>
          <button
            onClick={onOpenAddModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 mt-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm CCCD ngay</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredFiles.map((file) => {
            const isMatched = !!file.matchedParcelCode;
            return (
              <div
                key={file.filename}
                className="bg-slate-950/80 border border-slate-800/80 hover:border-indigo-500/50 rounded-2xl p-4 transition flex flex-col justify-between group space-y-3"
              >
                {/* Header item */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-xl bg-indigo-950/60 border border-indigo-800/40 text-indigo-400 shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-mono font-bold text-white truncate" title={file.filename}>
                        {file.filename}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>{formatFileSize(file.size)}</span>
                        {file.uploadedAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-2.5 h-2.5" />
                            {new Date(file.uploadedAt).toLocaleDateString('vi-VN')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Badge liên kết thửa */}
                  {isMatched ? (
                    <button
                      onClick={() => onSelectParcel && onSelectParcel(file.matchedParcelCode)}
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition shrink-0 flex items-center gap-1"
                      title="Bấm để xem chi tiết thửa đất này"
                    >
                      <MapPin className="w-2.5 h-2.5" />
                      <span>Thửa {file.matchedParcelCode}</span>
                    </button>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                      Chưa gán thửa
                    </span>
                  )}
                </div>

                {/* Thông tin OCR */}
                <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/60 space-y-1 text-xs">
                  {file.cccdNumber && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">Số CCCD:</span>
                      <strong className="text-indigo-300 font-mono text-[11px] font-bold">
                        {file.cccdNumber}
                      </strong>
                    </div>
                  )}
                  {file.ownerName && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">Họ và tên:</span>
                      <strong className="text-slate-200 text-[11px] truncate max-w-[150px]">
                        {file.ownerName}
                      </strong>
                    </div>
                  )}
                </div>

                {/* Actions: Xem PDF & Xóa */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-900">
                  <div className="flex items-center gap-1.5">
                    {/* Nút Xem file PDF */}
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 text-xs font-semibold border border-indigo-500/30 transition"
                      title="Mở xem file PDF trên Cloudflare R2"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Xem PDF</span>
                    </a>
                  </div>

                  {/* Nút Xóa */}
                  <button
                    onClick={() => setDeletingFile(file)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-950 text-rose-400 hover:text-rose-300 text-xs font-semibold border border-rose-800/40 transition cursor-pointer"
                    title="Xóa vĩnh viễn file này khỏi Cloudflare R2"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Xóa</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal Xóa CCCD */}
      {deletingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-rose-600/20 border border-rose-500/30 text-rose-400">
                <Trash2 className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Xác Nhận Xóa File CCCD</h3>
                <p className="text-xs text-slate-400">Thao tác này không thể hoàn tác</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Tên file:</span>
                <span className="font-mono font-bold text-white truncate max-w-[200px]">
                  {deletingFile.filename}
                </span>
              </div>
              {deletingFile.cccdNumber && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Số CCCD:</span>
                  <span className="font-mono text-indigo-300 font-semibold">{deletingFile.cccdNumber}</span>
                </div>
              )}
              {deletingFile.matchedParcelCode && (
                <div className="flex items-center justify-between text-amber-300">
                  <span>Thửa liên kết:</span>
                  <span className="font-bold">Thửa {deletingFile.matchedParcelCode}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              File sẽ bị xóa vĩnh viễn khỏi Cloudflare R2. Nếu file đang gắn với thửa đất, hệ thống sẽ tự động hủy liên kết và chuyển thửa đất về lại nhóm <strong>THỬA ĐANG KÊ KHAI (CHƯA CÓ CCCD)</strong> trên Google Sheet.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingFile(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang xóa...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa Vĩnh Viễn</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
