'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  RefreshCw,
  Search,
  Trash2,
  ExternalLink,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Calendar,
  Eye,
  FolderOpen,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import CccdHoverPreviewCard from './CccdHoverPreviewCard';

export interface ScanFileItem {
  filename: string;
  url: string;
  size: number;
  uploadedAt?: string;
  toBanDo?: string;
  soThua?: string;
  matchedParcelCode?: string;
  ownerName?: string;
}

interface ScanFileManagerTabProps {
  onSelectParcel?: (maThua: string) => void;
  onPreviewUrl?: (url: string, title: string) => void;
  theme?: 'dark' | 'light';
}

export default function ScanFileManagerTab({
  onSelectParcel,
  onPreviewUrl,
  theme = 'dark',
}: ScanFileManagerTabProps) {
  const [files, setFiles] = useState<ScanFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingFile, setDeletingFile] = useState<ScanFileItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isLight = theme === 'light';

  // Tải danh sách file scan từ R2
  const loadScanFiles = useCallback(async () => {
    setIsLoading(true);
    setFeedbackMessage(null);
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        const res = await fetch(`/api/upload-filescan?t=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok && attempts < 2) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          if (attempts < 2) {
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          data = { success: false, error: `Phản hồi máy chủ không hợp lệ (${res.status})` };
        }

        if (data.success && Array.isArray(data.files)) {
          setFiles(data.files);
          if (data.warning) {
            console.warn('Cảnh báo từ filescan API:', data.warning);
          }
          break;
        } else {
          if (attempts < 2) {
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          setFeedbackMessage({ type: 'error', text: data.error || 'Lỗi tải danh sách file scan' });
          break;
        }
      } catch (err: any) {
        if (attempts < 2) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        setFeedbackMessage({ type: 'error', text: err.message || 'Lỗi kết nối máy chủ' });
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadScanFiles();
  }, [loadScanFiles]);

  // Xóa file scan khỏi R2
  const handleDeleteConfirm = async () => {
    if (!deletingFile) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/upload-filescan?file=${encodeURIComponent(deletingFile.filename)}`, {
        method: 'DELETE',
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = { success: false, error: `Phản hồi máy chủ không hợp lệ (${res.status})` };
      }

      if (data.success) {
        setFeedbackMessage({
          type: 'success',
          text: `Đã xóa file scan "${deletingFile.filename}" khỏi R2 thành công!`,
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

  // Lọc và tìm kiếm
  const filteredFiles = useMemo(() => {
    let result = files;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((f) => {
        const fn = f.filename.toLowerCase();
        const to = (f.toBanDo || '').toLowerCase();
        const thua = (f.soThua || '').toLowerCase();
        const owner = (f.ownerName || '').toLowerCase();
        const code = (f.matchedParcelCode || '').toLowerCase();
        return fn.includes(q) || to.includes(q) || thua.includes(q) || owner.includes(q) || code.includes(q);
      });
    }

    return result;
  }, [files, searchQuery]);

  // Thống kê tổng quan
  const stats = useMemo(() => {
    const totalFiles = files.length;
    const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    const matchedCount = files.filter((f) => f.toBanDo && f.soThua).length;
    return { totalFiles, totalMB, matchedCount };
  }, [files]);

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return `${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${d.toLocaleDateString('vi-VN')}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Header Panel */}
      <div
        className={`border rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl border shrink-0 ${
              isLight
                ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
                : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
            }`}
          >
            <FolderOpen className="w-6 h-6" />
          </div>
          <div>
            <h2
              className={`text-base sm:text-lg font-black flex items-center gap-2 ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              Kho File Scan Đã Xử Lý (Cloudflare R2)
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full border font-bold ${
                  isLight
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                }`}
              >
                Thư Mục: filescan/
              </span>
            </h2>
            <p className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Lưu trữ toàn bộ các hồ sơ scan PDF sau khi tách và đặt tên chuẩn qua công cụ ScanName
            </p>
          </div>
        </div>

        {/* Nút tác vụ */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/scanname"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/25 transition cursor-pointer"
            title="Mở công cụ ScanName để tải hồ sơ scan, nhận diện AI và tách tên PDF"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Tách File Scan Mới (ScanName)</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>

          <button
            type="button"
            onClick={loadScanFiles}
            disabled={isLoading}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition disabled:opacity-50 cursor-pointer shadow-xs ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border-cyan-500/30'
            }`}
            title="Làm mới danh sách từ R2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Làm Mới</span>
          </button>
        </div>
      </div>

      {/* Thông báo Feedback */}
      {feedbackMessage && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between text-xs font-semibold animate-in fade-in duration-200 ${
            feedbackMessage.type === 'success'
              ? isLight
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
              : isLight
              ? 'bg-rose-50 text-rose-800 border-rose-300'
              : 'bg-rose-950/60 text-rose-300 border-rose-500/40'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3 Thẻ thống kê nhanh */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          className={`border rounded-xl p-3.5 shadow-xs flex items-center justify-between transition-colors ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}
        >
          <div>
            <p className={`text-[11px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Tổng File Scan Trong R2
            </p>
            <p className={`text-xl font-black mt-0.5 ${isLight ? 'text-indigo-700' : 'text-indigo-400'}`}>
              {stats.totalFiles.toLocaleString('vi-VN')}{' '}
              <span className={`text-xs font-medium ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>file PDF</span>
            </p>
          </div>
          <FileText className="w-6 h-6 text-indigo-500" />
        </div>

        <div
          className={`border rounded-xl p-3.5 shadow-xs flex items-center justify-between transition-colors ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}
        >
          <div>
            <p className={`text-[11px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Khớp Tờ / Thửa Đất
            </p>
            <p className={`text-xl font-black mt-0.5 ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
              {stats.matchedCount.toLocaleString('vi-VN')}{' '}
              <span className={`text-xs font-medium ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>hồ sơ</span>
            </p>
          </div>
          <CheckCircle2 className="w-6 h-6 text-emerald-500" />
        </div>

        <div
          className={`border rounded-xl p-3.5 shadow-xs flex items-center justify-between transition-colors ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}
        >
          <div>
            <p className={`text-[11px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Dung Lượng Lưu Trữ
            </p>
            <p className={`text-xl font-black mt-0.5 ${isLight ? 'text-cyan-700' : 'text-cyan-400'}`}>
              {stats.totalMB} <span className={`text-xs font-medium ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>MB</span>
            </p>
          </div>
          <Layers className="w-6 h-6 text-cyan-500" />
        </div>
      </div>

      {/* Thanh Tìm Kiếm */}
      <div
        className={`border rounded-xl p-3 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3 transition-colors ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className="relative w-full sm:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên file, số tờ, số thửa, chủ sử dụng..."
            className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500 transition ${
              isLight
                ? 'bg-slate-50 border-slate-300 text-slate-900 focus:bg-white placeholder:text-slate-400'
                : 'bg-slate-950 border-slate-700 text-slate-200 focus:bg-slate-900 placeholder:text-slate-500'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
            >
              ✕
            </button>
          )}
        </div>

        <div className={`text-xs font-medium ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          Đang hiển thị <strong className={isLight ? 'text-slate-800' : 'text-white'}>{filteredFiles.length}</strong> / {files.length} file
        </div>
      </div>

      {/* Bảng Danh Sách File Scan */}
      <div
        className={`border rounded-2xl overflow-hidden shadow-sm transition-colors ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
        }`}
      >
        {isLoading ? (
          <div className="p-12 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            <p className={`text-xs font-semibold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              Đang tải danh sách file scan từ Cloudflare R2...
            </p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <FileText className={`w-12 h-12 mx-auto ${isLight ? 'text-slate-300' : 'text-slate-600'}`} />
            <div>
              <p className={`text-sm font-bold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                {searchQuery ? 'Không tìm thấy file scan phù hợp' : 'Chưa có file scan nào trong R2'}
              </p>
              <p className={`text-xs mt-1 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                {searchQuery
                  ? 'Vui lòng thử tìm với từ khóa khác'
                  : 'Hãy mở công cụ ScanName để nạp file scan, phân tích AI và nhấn "Lưu R2"'}
              </p>
            </div>
            {!searchQuery && (
              <a
                href="/scanname"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Mở ScanName Ngay</span>
              </a>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead
                className={`border-b font-bold tracking-wider uppercase text-[10px] ${
                  isLight
                    ? 'bg-slate-100 text-slate-600 border-slate-200'
                    : 'bg-slate-950/70 text-slate-400 border-slate-800'
                }`}
              >
                <tr>
                  <th className="py-2.5 px-3 text-center w-12">STT</th>
                  <th className="py-2.5 px-3">Tên File PDF Scan</th>
                  <th className="py-2.5 px-3 text-center">Tờ / Thửa</th>
                  <th className="py-2.5 px-3">Chủ Sử Dụng (Dự Kiến)</th>
                  <th className="py-2.5 px-3 text-center">Dung Lượng</th>
                  <th className="py-2.5 px-3 text-center">Thời Gian Lưu R2</th>
                  <th className="py-2.5 px-3 text-center w-36">Thao Tác</th>
                </tr>
              </thead>
              <tbody
                className={`divide-y ${
                  isLight ? 'divide-slate-200' : 'divide-slate-800/60'
                }`}
              >
                {filteredFiles.map((file, idx) => (
                  <tr
                    key={file.filename}
                    className={`transition ${
                      isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <td
                      className={`py-2.5 px-3 text-center font-mono ${
                        isLight ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      {idx + 1}
                    </td>

                    {/* Tên file */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                        <span
                          className={`font-mono font-semibold break-all ${
                            isLight ? 'text-slate-900' : 'text-slate-200'
                          }`}
                        >
                          {file.filename}
                        </span>
                      </div>
                    </td>

                    {/* Tờ / Thửa */}
                    <td className="py-2.5 px-3 text-center">
                      {file.toBanDo && file.soThua ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (file.matchedParcelCode && onSelectParcel) {
                              onSelectParcel(file.matchedParcelCode);
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[11px] border transition ${
                            isLight
                              ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                              : 'bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20'
                          }`}
                          title={`Xem chi tiết Thửa ${file.soThua} - Tờ ${file.toBanDo}`}
                        >
                          <span>
                            Tờ {file.toBanDo} • Thửa {file.soThua}
                          </span>
                        </button>
                      ) : (
                        <span className={`text-[11px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                          Chưa gắn mã
                        </span>
                      )}
                    </td>

                    {/* Chủ sử dụng */}
                    <td className="py-2.5 px-3">
                      {file.ownerName ? (
                        <span className={`font-semibold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                          {file.ownerName}
                        </span>
                      ) : (
                        <span className={`italic ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                          (Theo hồ sơ scan)
                        </span>
                      )}
                    </td>

                    {/* Dung lượng */}
                    <td
                      className={`py-2.5 px-3 text-center font-mono text-[11px] ${
                        isLight ? 'text-slate-600' : 'text-slate-400'
                      }`}
                    >
                      {formatFileSize(file.size)}
                    </td>

                    {/* Thời gian */}
                    <td
                      className={`py-2.5 px-3 text-center text-[11px] ${
                        isLight ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      {formatDate(file.uploadedAt)}
                    </td>

                    {/* Nút Thao Tác */}
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Xem PDF Card Hover */}
                        <CccdHoverPreviewCard
                          fileUrl={file.url}
                          filename={file.filename}
                          ownerName={file.ownerName}
                          theme={theme}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              if (onPreviewUrl) {
                                onPreviewUrl(file.url, file.filename);
                              } else {
                                window.open(file.url, '_blank');
                              }
                            }}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${
                              isLight
                                ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                                : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                            }`}
                            title="Xem trước file scan"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </CccdHoverPreviewCard>

                        {/* Tải về */}
                        <a
                          href={file.url}
                          download={file.filename}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`p-1.5 rounded-lg border transition ${
                            isLight
                              ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                          }`}
                          title="Tải file PDF về máy"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>

                        {/* Xóa file */}
                        <button
                          type="button"
                          onClick={() => setDeletingFile(file)}
                          className={`p-1.5 rounded-lg border transition ${
                            isLight
                              ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200'
                              : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30'
                          }`}
                          title="Xóa file scan khỏi R2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Xác Nhận Xóa File Scan */}
      {deletingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`border rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 ${
              isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-slate-900 border-rose-500/30 text-slate-100'
            }`}
          >
            <div className="flex items-center gap-3 text-rose-500">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                  isLight ? 'bg-rose-50 border-rose-200' : 'bg-rose-500/20 border-rose-500/30'
                }`}
              >
                <Trash2 className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <h4 className={`font-black text-sm ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Xác nhận xóa file scan
                </h4>
                <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Xóa vĩnh viễn khỏi Cloudflare R2
                </p>
              </div>
            </div>

            <div
              className={`p-3 rounded-xl border text-xs space-y-2 ${
                isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-slate-950 border-slate-800 text-slate-300'
              }`}
            >
              <p>
                Bạn có chắc chắn muốn xóa file scan sau:
              </p>
              <p className="font-mono font-bold text-indigo-500 break-all bg-indigo-500/10 p-2 rounded border border-indigo-500/20">
                {deletingFile.filename}
              </p>
              <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                ⚠️ Hành động này không thể hoàn tác. Nếu muốn lưu lại, bạn có thể tách lại từ công cụ ScanName.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingFile(null)}
                disabled={isDeleting}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                  isLight
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                Hủy bỏ
              </button>

              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/25 transition disabled:opacity-50 cursor-pointer"
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
