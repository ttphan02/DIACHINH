'use client';

import React from 'react';
import Link from 'next/link';
import { Parcel } from '@/types';
import {
  X,
  MapPin,
  ExternalLink,
  Printer,
  FileText,
  User,
  Calendar,
  Phone,
  Home,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Image as ImageIcon,
  Download,
  Eye,
  ShieldCheck,
  Building2,
  Layers,
  FileSpreadsheet,
  Pencil,
  Trash2,
} from 'lucide-react';
import { getResolvedImageUrl } from '@/utils/geo';

interface DashboardParcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  parcel: Parcel | null;
  declaration: any | null;
  onPrintDeclaration: (parcel: Parcel, declaration?: any) => void;
  onOpenImageViewer: (url: string, urls?: string[], title?: string) => void;
  onEditDeclaration?: (parcel: Parcel, declaration: any) => void;
  onDeleteDeclaration?: (parcel: Parcel, declaration: any) => void;
}

export default function DashboardParcelModal({
  isOpen,
  onClose,
  parcel,
  declaration,
  onPrintDeclaration,
  onOpenImageViewer,
  onEditDeclaration,
  onDeleteDeclaration,
}: DashboardParcelModalProps) {
  if (!isOpen || !parcel) return null;

  const isGreen = parcel.trang_thai === 'DA_SO_HOA_XANH';
  const isBlue = parcel.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
  const isYellow = parcel.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG';

  // Gom tất cả các ảnh liên quan đến thửa đất
  const allImages: { label: string; url: string; type: 'cccd' | 'gcn' | 'upload' }[] = [];

  // Ảnh từ phiếu kê khai thực địa upload lên
  if (declaration?.anh_cccd_truoc) {
    allImages.push({
      label: 'CCCD Mặt trước (Upload kê khai)',
      url: declaration.anh_cccd_truoc,
      type: 'upload',
    });
  }
  if (declaration?.anh_cccd_sau) {
    allImages.push({
      label: 'CCCD Mặt sau (Upload kê khai)',
      url: declaration.anh_cccd_sau,
      type: 'upload',
    });
  }
  if (Array.isArray(declaration?.anh_gcn_list) && declaration.anh_gcn_list.length > 0) {
    declaration.anh_gcn_list.forEach((u: string, idx: number) => {
      allImages.push({
        label: `Giấy chứng nhận QSDĐ - Trang ${idx + 1} (Upload kê khai)`,
        url: u,
        type: 'upload',
      });
    });
  } else if (declaration?.anh_gcn) {
    allImages.push({
      label: 'Giấy chứng nhận QSDĐ (Upload kê khai)',
      url: declaration.anh_gcn,
      type: 'upload',
    });
  }

  // Ảnh scan lưu trữ trên hệ thống (R2 / số hóa)
  if (parcel.cccd_url) {
    allImages.push({
      label: 'Hồ sơ CCCD chủ hộ (Hệ thống R2)',
      url: parcel.cccd_url,
      type: 'cccd',
    });
  }
  if (parcel.svg_url && parcel.svg_url !== parcel.cccd_url) {
    allImages.push({
      label: 'Bản đồ scan / Sơ đồ thửa (R2)',
      url: parcel.svg_url,
      type: 'gcn',
    });
  }
  if (parcel.gcn_urls && parcel.gcn_urls.length > 0) {
    parcel.gcn_urls.forEach((u, i) => {
      allImages.push({
        label: `Giấy chứng nhận QSDĐ ${i + 1} (R2)`,
        url: u,
        type: 'gcn',
      });
    });
  }

  // Format ngày kê khai
  let formattedDeclDate = '';
  if (declaration?.created_at) {
    try {
      const d = new Date(declaration.created_at);
      formattedDeclDate = d.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto no-print">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl text-slate-100 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header Modal */}
        <div className="bg-slate-950/80 p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white">
                  Thửa {parcel.so_thua} • Tờ BĐ {parcel.to_ban_do}
                </h3>
                {isGreen ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    🟢 Đã số hóa (GGS)
                  </span>
                ) : isBlue ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    🔵 Đã kê khai thực địa
                  </span>
                ) : isYellow ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    🟡 Chưa kê khai - Có tên
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700/40 text-slate-400 border border-slate-600/30">
                    ⚪ Chưa kê khai - Không có tên
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Mã định danh thửa: {parcel.ma_thua}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Modal */}
        <div className="p-4 sm:p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* 1. THÔNG TIN ĐỊA CHÍNH CỦA THỬA ĐẤT */}
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-400" />
              Thông tin thửa đất cơ sở
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 block">Chủ thửa đất:</span>
                <strong className="text-white text-sm block truncate">
                  {declaration?.chu_dat_ten || parcel.chu_ho || 'Chưa có tên'}
                </strong>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 block">Số CCCD / CMND:</span>
                <strong className="text-slate-200 font-mono text-sm block">
                  {declaration?.chu_dat_cccd || parcel.cccd || '---'}
                </strong>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 block">Địa bàn (Thôn / Buôn):</span>
                <strong className="text-slate-200 block truncate">{parcel.thon_xa || '---'}</strong>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 block">Diện tích quản lý:</span>
                <strong className="text-emerald-400 font-mono text-sm block">
                  {parcel.dien_tich ? `${parcel.dien_tich} m²` : '---'}
                </strong>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 block">Loại đất (Mục đích SD):</span>
                <span className="font-mono font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded text-[11px] border border-amber-400/20 inline-block mt-0.5">
                  {parcel.loai_dat || 'Chưa rõ'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 block">Tọa độ GPS:</span>
                {parcel.lat && parcel.lng ? (
                  <span className="text-[11px] text-slate-300 font-mono block mt-0.5">
                    {parcel.lat}, {parcel.lng}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-500 italic block mt-0.5">Chưa có GPS</span>
                )}
              </div>
            </div>
          </div>

          {/* 2. THÔNG TIN CHI TIẾT VỀ VIỆC KÊ KHAI (Được hiển thị nổi bật nếu đã kê khai) */}
          {declaration ? (
            <div className="bg-blue-950/30 border border-blue-500/30 p-4 rounded-2xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-400" />
                    Hồ sơ chi tiết kê khai thực địa
                  </h4>
                  {formattedDeclDate && (
                    <span className="text-[11px] text-blue-300/80 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-blue-400" />
                      {formattedDeclDate}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {onEditDeclaration && (
                    <button
                      type="button"
                      onClick={() => onEditDeclaration(parcel, declaration)}
                      className="px-2.5 py-1 text-[11px] font-bold bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white rounded-lg border border-blue-500/40 transition flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" /> Sửa phiếu
                    </button>
                  )}
                  {onDeleteDeclaration && (
                    <button
                      type="button"
                      onClick={() => onDeleteDeclaration(parcel, declaration)}
                      className="px-2.5 py-1 text-[11px] font-bold bg-red-500/20 hover:bg-red-600 text-red-300 hover:text-white rounded-lg border border-red-500/30 transition flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> Xóa phiếu
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Người thực hiện kê khai:</span>
                  <strong className="text-white text-sm block">
                    {declaration.nguoi_ke_khai_ten || declaration.chu_dat_ten || parcel.chu_ho}
                  </strong>
                  <span className="text-[11px] text-blue-400 block mt-0.5">
                    Chế độ: {declaration.mode === 'SURVEYOR' ? 'Cán bộ khảo sát ghi nhận' : 'Người dân tự kê khai'}
                  </span>
                </div>

                <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Số điện thoại liên hệ:</span>
                  <strong className="text-white text-sm block font-mono">
                    {declaration.nguoi_ke_khai_sdt || '---'}
                  </strong>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    Năm sinh chủ đất: {declaration.chu_dat_ngay_sinh || '---'}
                  </span>
                </div>

                <div className="sm:col-span-2 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Địa chỉ thường trú:</span>
                  <span className="text-slate-200">
                    {declaration.chu_dat_dia_chi || parcel.thon_xa || 'Xã Cư Pui, huyện Krông Bông'}
                  </span>
                </div>

                {declaration.ghi_chu && (
                  <div className="sm:col-span-2 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block mb-0.5">Ghi chú hiện trạng & nguồn gốc đất:</span>
                    <p className="text-slate-200 italic">{declaration.ghi_chu}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/60 text-xs text-slate-400 flex items-center justify-between">
              <span className="italic">
                Thửa này chưa có phiếu kê khai thực địa lưu trữ trong phiên này.
              </span>
              <span className="text-amber-400 text-[11px] font-bold">
                {isYellow ? 'Chờ thu thập thông tin' : 'Chưa có dữ liệu'}
              </span>
            </div>
          )}

          {/* 3. HÌNH ẢNH UPLOAD CỦA THỬA KÊ KHAI HOẶC ĐÃ SỐ HÓA */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                Hình ảnh hồ sơ đính kèm ({allImages.length} tài liệu)
              </h4>
            </div>

            {allImages.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {allImages.map((img, i) => {
                  const resolvedSrc = getResolvedImageUrl(img.url);
                  return (
                    <div
                      key={i}
                      onClick={() =>
                        onOpenImageViewer(
                          resolvedSrc,
                          allImages.map((item) => getResolvedImageUrl(item.url)),
                          img.label
                        )
                      }
                      className="group bg-slate-950/80 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-2 transition cursor-pointer flex flex-col justify-between"
                    >
                      <div className="relative aspect-4/3 w-full bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center">
                        <img
                          src={resolvedSrc}
                          alt={img.label}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          onError={(e) => {
                            const target = e.currentTarget;
                            target.onerror = null; // Ngăn chặn tuyệt đối vòng lặp onError gây nhấp nháy
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent && !parent.querySelector('.img-fallback-box')) {
                              const box = document.createElement('div');
                              box.className = 'img-fallback-box text-[11px] text-slate-400 text-center p-3 leading-snug';
                              box.innerText = String(img.url).startsWith('blob:')
                                ? 'Ảnh tạm từ phiên trước (Vui lòng bấm Sửa phiếu để tải lại ảnh lên Cloud)'
                                : 'Không thể hiển thị ảnh này';
                              parent.appendChild(box);
                            }
                          }}
                        />
                        <div className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1.5 text-white text-xs font-bold">
                          <Eye className="w-4 h-4 text-blue-400" />
                          <span>Xem to</span>
                        </div>
                      </div>

                      <div className="mt-2">
                        <span className="text-[11px] font-medium text-slate-300 line-clamp-1 block">
                          {img.label}
                        </span>
                        <span className="text-[9px] text-blue-400 font-bold block">
                          Bấm để phóng to & tải về
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 bg-slate-950/40 rounded-2xl border border-slate-800/60 text-center text-xs text-slate-500">
                Thửa này chưa có ảnh upload CCCD hoặc Giấy chứng nhận nào đính kèm.
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-950/90 p-4 sm:p-5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Nút in / tải PDF đơn kê khai */}
            <button
              onClick={() => onPrintDeclaration(parcel, declaration)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/25 transition cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>In Đơn Kê Khai (A4)</span>
            </button>

            {/* Nút xem trên Google Maps nếu có toạ độ */}
            {parcel.lat && parcel.lng && (
              <a
                href={parcel.gmap_link || `https://www.google.com/maps?q=${parcel.lat},${parcel.lng}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Google Maps</span>
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/?to=${parcel.to_ban_do}&thua=${parcel.so_thua}&ma_thua=${parcel.ma_thua}`}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/25 transition"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Mở Trên Bản Đồ Vệ Tinh</span>
            </Link>

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
