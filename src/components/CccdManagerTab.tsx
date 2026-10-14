'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HardDrive,
  RefreshCw,
  Search,
  FileText,
  MapPin,
  Trash2,
  ExternalLink,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Calendar,
  Eye,
} from 'lucide-react';
import CccdHoverPreviewCard from './CccdHoverPreviewCard';

interface CccdFileItem {
  filename: string;
  url: string;
  size: number;
  uploadedAt?: string;
  matchedParcelCode?: string;
  cccdNumber?: string;
  ownerName?: string;
}

interface CccdManagerTabProps {
  onOpenAddModal: (mode?: 'single' | 'folder') => void;
  onSelectParcel?: (maThua: string) => void;
  onPreviewUrl?: (url: string, title: string) => void;
  theme?: 'dark' | 'light';
}

export default function CccdManagerTab({
  onOpenAddModal,
  onSelectParcel,
  onPreviewUrl,
  theme = 'dark',
}: CccdManagerTabProps) {
  const [files, setFiles] = useState<CccdFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [deletingFile, setDeletingFile] = useState<CccdFileItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isLight = theme === 'light';

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

  // Lọc danh sách file theo search query và filterType
  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      // 1. Lọc theo trạng thái gán thửa
      if (filterType === 'matched' && !f.matchedParcelCode) return false;
      if (filterType === 'unmatched' && f.matchedParcelCode) return false;

      // 2. Tìm kiếm
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const fn = f.filename.toLowerCase();
      const cccd = (f.cccdNumber || '').toLowerCase();
      const owner = (f.ownerName || '').toLowerCase();
      const parcel = (f.matchedParcelCode || '').toLowerCase();

      return fn.includes(q) || cccd.includes(q) || owner.includes(q) || parcel.includes(q);
    });
  }, [files, searchQuery, filterType]);

  const matchedCount = useMemo(() => files.filter((f) => !!f.matchedParcelCode).length, [files]);
  const unmatchedCount = files.length - matchedCount;

  // Định dạng kích thước file
  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className={`border rounded-2xl p-4 sm:p-6 shadow-sm space-y-5 ${
      isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
    }`}>
      {/* Top Banner / Actions Bar */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b ${
        isLight ? 'border-slate-200' : 'border-slate-800'
      }`}>
        <div>
          <h3 className={`text-base font-bold flex items-center gap-2 ${
            isLight ? 'text-slate-900' : 'text-white'
          }`}>
            <span className={`p-2 rounded-xl border ${
              isLight ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30'
            }`}>
              <HardDrive className="w-5 h-5 text-indigo-500" />
            </span>
            Kho Quản Lý CCCD Cloudflare R2
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
              isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            }`}>
              {files.length} File PDF
            </span>
          </h3>
          <p className={`text-xs mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Xem, thêm, xóa các file CCCD trên bộ nhớ đám mây R2 • Tự động đồng bộ sang Google Sheets Realtime
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={loadCccdFiles}
            disabled={isLoading}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer disabled:opacity-50 ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
            title="Tải lại danh sách từ Cloudflare R2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-500' : ''}`} />
            <span>Làm mới</span>
          </button>

          <button
            onClick={() => onOpenAddModal('folder')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white shadow-lg shadow-indigo-600/30 transition cursor-pointer border border-indigo-400/30"
          >
            <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
            <span>Tải Lên Thư Mục CCCD</span>
          </button>

          <button
            onClick={() => onOpenAddModal('single')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            <Plus className="w-4 h-4 text-slate-400" />
            <span>Thêm 1 CCCD</span>
          </button>
        </div>
      </div>

      {/* Thông báo feedback */}
      {feedbackMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
            feedbackMessage.type === 'success'
              ? isLight
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-emerald-950/40 border-emerald-600/50 text-emerald-300'
              : isLight
              ? 'bg-rose-50 border-rose-300 text-rose-800'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-500" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMessage(null)}
            className={`text-xs font-bold ${isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'}`}
          >
            Đóng
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 ${
            isLight ? 'text-slate-400' : 'text-slate-500'
          }`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo số CCCD (12 số), Họ tên chủ hộ, Mã thửa (ví dụ: 276_213)..."
            className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-xs font-sans focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
              isLight
                ? 'bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-500'
                : 'bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:border-indigo-500'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold ${
                isLight ? 'text-slate-400 hover:text-slate-600' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Xóa
            </button>
          )}
        </div>

        {/* Filter Badges */}
        <div className={`flex items-center gap-1.5 p-1 rounded-xl border shrink-0 text-xs ${
          isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-950 border-slate-800'
        }`}>
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
              filterType === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : isLight
                ? 'text-slate-600 hover:text-slate-900'
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
                : isLight
                ? 'text-slate-600 hover:text-slate-900'
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
                : isLight
                ? 'text-slate-600 hover:text-slate-900'
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
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <span className="text-xs font-medium">Đang tải danh sách file CCCD từ Cloudflare R2...</span>
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className={`py-16 text-center rounded-2xl border border-dashed space-y-2 ${
          isLight
            ? 'bg-slate-50 border-slate-300 text-slate-500'
            : 'bg-slate-950/40 border-slate-800 text-slate-500'
        }`}>
          <FileText className={`w-8 h-8 mx-auto ${isLight ? 'text-slate-400' : 'text-slate-600'}`} />
          <p className={`text-sm font-semibold ${isLight ? 'text-slate-700' : 'text-slate-400'}`}>Không tìm thấy file CCCD nào phù hợp</p>
          <p className="text-xs text-slate-500">
            {searchQuery
              ? 'Thử thay đổi từ khóa tìm kiếm số CCCD hoặc họ tên'
              : 'Chưa có file CCCD nào trong kho lưu trữ'}
          </p>
          <button
            onClick={() => onOpenAddModal('folder')}
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
                className={`border rounded-2xl p-4 transition flex flex-col justify-between group space-y-3 ${
                  isLight
                    ? 'bg-slate-50/70 hover:bg-white border-slate-200 hover:border-indigo-400 shadow-xs'
                    : 'bg-slate-950/80 border-slate-800/80 hover:border-indigo-500/50'
                }`}
              >
                {/* Header item */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`p-2 rounded-xl border shrink-0 ${
                      isLight ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-indigo-950/60 border-indigo-800/40 text-indigo-400'
                    }`}>
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className={`text-xs font-mono font-bold truncate ${
                        isLight ? 'text-slate-900' : 'text-white'
                      }`} title={file.filename}>
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
                      onClick={() => onSelectParcel && file.matchedParcelCode && onSelectParcel(file.matchedParcelCode)}
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition shrink-0 flex items-center gap-1"
                      title="Bấm để xem chi tiết thửa đất này"
                    >
                      <MapPin className="w-2.5 h-2.5" />
                      <span>Thửa {file.matchedParcelCode}</span>
                    </button>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                      Chưa gán thửa
                    </span>
                  )}
                </div>

                {/* Thông tin OCR */}
                <div className={`p-2.5 rounded-xl border space-y-1 text-xs ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-900/80 border-slate-800/60'
                }`}>
                  {file.cccdNumber && (
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Số CCCD:</span>
                      <strong className="text-indigo-600 dark:text-indigo-300 font-mono text-[11px] font-bold">
                        {file.cccdNumber}
                      </strong>
                    </div>
                  )}
                  {file.ownerName && (
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Họ và tên:</span>
                      <strong className={`text-[11px] truncate max-w-[150px] font-bold ${
                        isLight ? 'text-slate-800' : 'text-slate-200'
                      }`}>
                        {file.ownerName}
                      </strong>
                    </div>
                  )}
                </div>

                {/* Actions: Xem PDF & Xóa */}
                <div className={`flex items-center justify-between pt-1 border-t ${
                  isLight ? 'border-slate-200' : 'border-slate-900'
                }`}>
                  <div className="flex items-center gap-1.5">
                    {/* Nút Xem file PDF có Hover Card Preview */}
                    <CccdHoverPreviewCard
                      theme={theme}
                      fileUrl={file.url}
                      filename={file.filename}
                      cccdNumber={file.cccdNumber}
                      ownerName={file.ownerName}
                      fileSize={formatFileSize(file.size)}
                    >
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                          isLight
                            ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                            : 'bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border-indigo-500/30'
                        }`}
                        title="Mở xem file PDF trên Cloudflare R2"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Xem PDF</span>
                      </a>
                    </CccdHoverPreviewCard>
                  </div>

                  {/* Nút Xóa */}
                  <button
                    onClick={() => setDeletingFile(file)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                      isLight
                        ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200'
                        : 'bg-rose-950/40 hover:bg-rose-950 text-rose-400 hover:text-rose-300 border-rose-800/40'
                    }`}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className={`w-full max-w-md border rounded-3xl p-6 shadow-2xl space-y-4 ${
            isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-900 border-slate-700 text-white'
          }`}>
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-rose-600/20 border border-rose-500/30 text-rose-500">
                <Trash2 className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h3 className={`text-base font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>Xác Nhận Xóa File CCCD</h3>
                <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Thao tác này không thể hoàn tác</p>
              </div>
            </div>

            <div className={`p-3.5 rounded-xl border space-y-2 text-xs ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
            }`}>
              <div className="flex items-center justify-between">
                <span className={isLight ? 'text-slate-500' : 'text-slate-400'}>Tên file:</span>
                <span className={`font-mono font-bold truncate max-w-[200px] ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  {deletingFile.filename}
                </span>
              </div>
              {deletingFile.cccdNumber && (
                <div className="flex items-center justify-between">
                  <span className={isLight ? 'text-slate-500' : 'text-slate-400'}>Số CCCD:</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-300 font-semibold">{deletingFile.cccdNumber}</span>
                </div>
              )}
              {deletingFile.matchedParcelCode && (
                <div className="flex items-center justify-between text-amber-600 dark:text-amber-300">
                  <span>Thửa liên kết:</span>
                  <span className="font-bold">Thửa {deletingFile.matchedParcelCode}</span>
                </div>
              )}
            </div>

            <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              File sẽ bị xóa vĩnh viễn khỏi Cloudflare R2. Nếu file đang gắn với thửa đất, hệ thống sẽ tự động hủy liên kết và chuyển thửa đất về lại nhóm <strong>THỬA ĐANG KÊ KHAI (CHƯA CÓ CCCD)</strong> trên Google Sheet.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingFile(null)}
                disabled={isDeleting}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                  isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
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
