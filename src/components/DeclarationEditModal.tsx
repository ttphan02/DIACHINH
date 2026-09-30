'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Parcel, DeclarationFormData, DeclarationMode, AdditionalParcel } from '@/types';
import CccdImageEditorModal, { CropAspectRatio } from '@/components/CccdImageEditorModal';
import {
  X,
  User,
  Users,
  Layers,
  Save,
  Trash2,
  AlertTriangle,
  FileText,
  MapPin,
  Calendar,
  Phone,
  Compass,
  Image as ImageIcon,
  Upload,
  Pencil,
  Plus,
  RotateCw,
  Crop,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';

interface DeclarationEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  parcel: Parcel | null;
  declaration: DeclarationFormData | any | null;
  onSave: (data: DeclarationFormData) => void;
  onDelete: (maThua: string) => void;
}

export default function DeclarationEditModal({
  isOpen,
  onClose,
  parcel,
  declaration,
  onSave,
  onDelete,
}: DeclarationEditModalProps) {
  if (!isOpen || !parcel) return null;

  const [mode, setMode] = useState<DeclarationMode>('SELF');
  const [nguoiKeKhaiTen, setNguoiKeKhaiTen] = useState('');
  const [nguoiKeKhaiSdt, setNguoiKeKhaiSdt] = useState('');
  const [chuDatTen, setChuDatTen] = useState('');
  const [chuDatCccd, setChuDatCccd] = useState('');
  const [chuDatNgaySinh, setChuDatNgaySinh] = useState('');
  const [chuDatDiaChi, setChuDatDiaChi] = useState('');
  const [giapDong, setGiapDong] = useState('');
  const [giapTay, setGiapTay] = useState('');
  const [giapNam, setGiapNam] = useState('');
  const [giapBac, setGiapBac] = useState('');
  const [ghiChu, setGhiChu] = useState('');
  const [thuaKemTheo, setThuaKemTheo] = useState<AdditionalParcel[]>([]);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

  // Ảnh đính kèm (CCCD & GCN)
  const [anhCccdTruoc, setAnhCccdTruoc] = useState<string | null>(null);
  const [anhCccdSau, setAnhCccdSau] = useState<string | null>(null);
  const [anhGcnList, setAnhGcnList] = useState<string[]>([]);

  // Modal Chỉnh Sửa Ảnh (Cắt, Xoay, Lật, Lọc tài liệu, Thay thế)
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<
    'cccd_truoc' | 'cccd_sau' | { type: 'gcn'; index: number } | null
  >(null);
  const [editorImageUrl, setEditorImageUrl] = useState<string>('');
  const [editorTitle, setEditorTitle] = useState<string>('');
  const [editorDefaultAspect, setEditorDefaultAspect] = useState<CropAspectRatio>('cccd');

  const fileInputCccdTruocRef = useRef<HTMLInputElement | null>(null);
  const fileInputCccdSauRef = useRef<HTMLInputElement | null>(null);
  const fileInputGcnRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (declaration) {
      setMode(declaration.mode || 'SELF');
      setNguoiKeKhaiTen(declaration.nguoi_ke_khai_ten || '');
      setNguoiKeKhaiSdt(declaration.nguoi_ke_khai_sdt || '');
      setChuDatTen(declaration.chu_dat_ten || parcel.chu_ho || '');
      setChuDatCccd(declaration.chu_dat_cccd || parcel.cccd || '');
      setChuDatNgaySinh(declaration.chu_dat_ngay_sinh || '');
      setChuDatDiaChi(declaration.chu_dat_dia_chi || parcel.thon_xa || '');
      setGiapDong(declaration.giap_dong || parcel.giap_dong || '');
      setGiapTay(declaration.giap_tay || parcel.giap_tay || '');
      setGiapNam(declaration.giap_nam || parcel.giap_nam || '');
      setGiapBac(declaration.giap_bac || parcel.giap_bac || '');
      setGhiChu(declaration.ghi_chu || '');
      setThuaKemTheo(declaration.thua_kem_theo || []);

      // Tải ảnh hồ sơ đã lưu
      setAnhCccdTruoc(declaration.anh_cccd_truoc || parcel.cccd_url || null);
      setAnhCccdSau(declaration.anh_cccd_sau || null);
      if (Array.isArray(declaration.anh_gcn_list) && declaration.anh_gcn_list.length > 0) {
        setAnhGcnList(declaration.anh_gcn_list);
      } else if (declaration.anh_gcn) {
        setAnhGcnList([declaration.anh_gcn]);
      } else if (parcel.gcn_urls && parcel.gcn_urls.length > 0) {
        setAnhGcnList([...parcel.gcn_urls]);
      } else {
        setAnhGcnList([]);
      }
    } else {
      setMode('SELF');
      setNguoiKeKhaiTen('');
      setNguoiKeKhaiSdt('');
      setChuDatTen(parcel.chu_ho || '');
      setChuDatCccd(parcel.cccd || '');
      setChuDatNgaySinh('');
      setChuDatDiaChi(parcel.thon_xa || '');
      setGiapDong(parcel.giap_dong || '');
      setGiapTay(parcel.giap_tay || '');
      setGiapNam(parcel.giap_nam || '');
      setGiapBac(parcel.giap_bac || '');
      setGhiChu('');
      setThuaKemTheo([]);

      setAnhCccdTruoc(parcel.cccd_url || null);
      setAnhCccdSau(null);
      setAnhGcnList(parcel.gcn_urls && parcel.gcn_urls.length > 0 ? [...parcel.gcn_urls] : []);
    }
    setIsConfirmDeleteOpen(false);
  }, [parcel, declaration]);

  const handleRemoveAttachedParcel = (maThua: string) => {
    setThuaKemTheo((prev) => prev.filter((ap) => ap.ma_thua !== maThua));
  };

  // Mở trình chỉnh sửa ảnh
  const handleOpenEditor = (
    target: 'cccd_truoc' | 'cccd_sau' | { type: 'gcn'; index: number }
  ) => {
    let url = '';
    let title = '';
    let aspect: CropAspectRatio = 'cccd';

    if (target === 'cccd_truoc') {
      url = anhCccdTruoc || '';
      title = 'Chỉnh sửa Căn cước công dân (Mặt trước)';
      aspect = 'cccd';
    } else if (target === 'cccd_sau') {
      url = anhCccdSau || '';
      title = 'Chỉnh sửa Căn cước công dân (Mặt sau)';
      aspect = 'cccd';
    } else if (typeof target === 'object' && target.type === 'gcn') {
      url = anhGcnList[target.index] || '';
      title = `Chỉnh sửa Giấy chứng nhận QSDĐ (Ảnh ${target.index + 1})`;
      aspect = 'a4';
    }

    if (url) {
      setEditorTarget(target);
      setEditorImageUrl(url);
      setEditorTitle(title);
      setEditorDefaultAspect(aspect);
      setIsEditorOpen(true);
    }
  };

  // Lưu ảnh sau khi cắt, xoay, lật hoặc thay thế
  const handleSaveEditedImage = (editedDataUrl: string) => {
    if (editorTarget === 'cccd_truoc') {
      setAnhCccdTruoc(editedDataUrl);
    } else if (editorTarget === 'cccd_sau') {
      setAnhCccdSau(editedDataUrl);
    } else if (typeof editorTarget === 'object' && editorTarget?.type === 'gcn') {
      setAnhGcnList((prev) => {
        const copy = [...prev];
        copy[editorTarget.index] = editedDataUrl;
        return copy;
      });
    }
    setIsEditorOpen(false);
  };

  // Tải ảnh mới từ thiết bị
  const handleUploadImageFile = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'cccd_truoc' | 'cccd_sau' | 'gcn'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;

      if (target === 'cccd_truoc') {
        setAnhCccdTruoc(dataUrl);
      } else if (target === 'cccd_sau') {
        setAnhCccdSau(dataUrl);
      } else if (target === 'gcn') {
        setAnhGcnList((prev) => [...prev, dataUrl]);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveGcnImage = (index: number) => {
    setAnhGcnList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: DeclarationFormData = {
      ma_thua: parcel.ma_thua,
      mode,
      nguoi_ke_khai_ten: mode === 'SELF' ? chuDatTen : nguoiKeKhaiTen,
      nguoi_ke_khai_sdt: nguoiKeKhaiSdt,
      chu_dat_ten: chuDatTen,
      chu_dat_cccd: chuDatCccd,
      chu_dat_ngay_sinh: chuDatNgaySinh,
      chu_dat_dia_chi: chuDatDiaChi,
      giap_dong: giapDong,
      giap_tay: giapTay,
      giap_nam: giapNam,
      giap_bac: giapBac,
      anh_cccd_truoc: anhCccdTruoc || undefined,
      anh_cccd_sau: anhCccdSau || undefined,
      anh_gcn: anhGcnList[0] || undefined,
      anh_gcn_list: anhGcnList.length > 0 ? anhGcnList : undefined,
      ghi_chu: ghiChu,
      thua_kem_theo: thuaKemTheo,
    };
    onSave(data);
    onClose();
  };

  const handleConfirmDelete = () => {
    onDelete(parcel.ma_thua);
    setIsConfirmDeleteOpen(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl text-slate-100 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header Modal */}
        <div className="bg-slate-950/90 p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white">
                  Chỉnh Sửa Phiếu Kê Khai
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  Thửa {parcel.so_thua} • Tờ {parcel.to_ban_do}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Cập nhật thông tin phiếu kê khai thực địa hoặc xóa bỏ phiếu
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Chế độ kê khai */}
          <div className="flex p-1 bg-slate-950 rounded-xl text-xs border border-slate-800">
            <button
              type="button"
              onClick={() => setMode('SELF')}
              className={`flex-1 py-2 font-bold rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer ${
                mode === 'SELF'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" /> Chủ đất tự kê khai
            </button>
            <button
              type="button"
              onClick={() => setMode('SURVEYOR')}
              className={`flex-1 py-2 font-bold rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer ${
                mode === 'SURVEYOR'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" /> Cán bộ kê khai thay
            </button>
          </div>

          {/* Cán bộ thực địa nếu là kê khai thay */}
          {mode === 'SURVEYOR' && (
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2.5">
              <span className="font-bold text-blue-400 text-xs flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Thông tin cán bộ thực địa:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <input
                  type="text"
                  required
                  value={nguoiKeKhaiTen}
                  onChange={(e) => setNguoiKeKhaiTen(e.target.value)}
                  placeholder="Họ tên cán bộ *"
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="tel"
                  required
                  value={nguoiKeKhaiSdt}
                  onChange={(e) => setNguoiKeKhaiSdt(e.target.value)}
                  placeholder="Số điện thoại cán bộ *"
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Thông tin chủ đất */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2.5">
            <span className="font-bold text-slate-300 text-xs flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-blue-400" /> Thông tin chủ sử dụng đất:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Họ & Tên chủ đất *</label>
                <input
                  type="text"
                  required
                  value={chuDatTen}
                  onChange={(e) => setChuDatTen(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Số CCCD / CMND *</label>
                <input
                  type="text"
                  required
                  value={chuDatCccd}
                  onChange={(e) => setChuDatCccd(e.target.value)}
                  placeholder="12 chữ số CCCD"
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Ngày sinh (nếu có)</label>
                <input
                  type="text"
                  value={chuDatNgaySinh}
                  onChange={(e) => setChuDatNgaySinh(e.target.value)}
                  placeholder="DD/MM/YYYY"
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Số điện thoại liên hệ</label>
                <input
                  type="tel"
                  value={nguoiKeKhaiSdt}
                  onChange={(e) => setNguoiKeKhaiSdt(e.target.value)}
                  placeholder="0912..."
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[10px] text-slate-400 block mb-1">Địa chỉ thường trú</label>
                <input
                  type="text"
                  value={chuDatDiaChi}
                  onChange={(e) => setChuDatDiaChi(e.target.value)}
                  placeholder="Thôn / Buôn, Xã Cư Pui, Huyện Krông Bông..."
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Hidden File Inputs for CCCD & GCN */}
          <input
            type="file"
            ref={fileInputCccdTruocRef}
            onChange={(e) => handleUploadImageFile(e, 'cccd_truoc')}
            accept="image/*"
            className="hidden"
          />
          <input
            type="file"
            ref={fileInputCccdSauRef}
            onChange={(e) => handleUploadImageFile(e, 'cccd_sau')}
            accept="image/*"
            className="hidden"
          />
          <input
            type="file"
            ref={fileInputGcnRef}
            onChange={(e) => handleUploadImageFile(e, 'gcn')}
            accept="image/*"
            className="hidden"
          />

          {/* Hồ sơ hình ảnh đính kèm (CCCD & GCN) */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-blue-400" /> Hồ sơ hình ảnh đính kèm (CCCD & GCN):
              </span>
              <span className="text-[10px] text-slate-400">
                Hỗ trợ Cắt • Xoay • Lật • Thay thế ảnh
              </span>
            </div>

            {/* 1. Căn cước công dân (Mặt trước & Mặt sau) */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-400 block">
                1. Ảnh Căn cước công dân (CCCD):
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Mặt trước */}
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">Mặt trước CCCD</span>
                    {anhCccdTruoc && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Đã có ảnh
                      </span>
                    )}
                  </div>

                  {anhCccdTruoc ? (
                    <div className="relative group rounded-lg overflow-hidden border border-slate-700 bg-black/40 h-28 flex items-center justify-center">
                      <img
                        src={anhCccdTruoc}
                        alt="CCCD mặt trước"
                        className="max-h-full max-w-full object-contain"
                      />
                      <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2">
                        <button
                          type="button"
                          onClick={() => handleOpenEditor('cccd_truoc')}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-md transition cursor-pointer"
                          title="Cắt, xoay, lật, chỉnh nét"
                        >
                          <Pencil className="w-3 h-3" /> Chỉnh sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputCccdTruocRef.current?.click()}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] border border-slate-600 transition cursor-pointer"
                          title="Thay ảnh khác"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setAnhCccdTruoc(null)}
                          className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-500 text-white text-[11px] transition cursor-pointer"
                          title="Gỡ ảnh này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputCccdTruocRef.current?.click()}
                      className="h-28 rounded-lg border-2 border-dashed border-slate-700 hover:border-blue-500/60 bg-slate-950/50 hover:bg-slate-950 flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-blue-400 transition cursor-pointer"
                    >
                      <Upload className="w-5 h-5 text-slate-500" />
                      <span className="text-[11px] font-medium">+ Tải ảnh mặt trước</span>
                    </button>
                  )}

                  {anhCccdTruoc && (
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => handleOpenEditor('cccd_truoc')}
                        className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" /> Cắt / Xoay / Lật
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputCccdTruocRef.current?.click()}
                        className="text-slate-400 hover:text-slate-300 cursor-pointer"
                      >
                        Thay ảnh
                      </button>
                    </div>
                  )}
                </div>

                {/* Mặt sau */}
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">Mặt sau CCCD</span>
                    {anhCccdSau && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Đã có ảnh
                      </span>
                    )}
                  </div>

                  {anhCccdSau ? (
                    <div className="relative group rounded-lg overflow-hidden border border-slate-700 bg-black/40 h-28 flex items-center justify-center">
                      <img
                        src={anhCccdSau}
                        alt="CCCD mặt sau"
                        className="max-h-full max-w-full object-contain"
                      />
                      <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2">
                        <button
                          type="button"
                          onClick={() => handleOpenEditor('cccd_sau')}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-md transition cursor-pointer"
                          title="Cắt, xoay, lật, chỉnh nét"
                        >
                          <Pencil className="w-3 h-3" /> Chỉnh sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputCccdSauRef.current?.click()}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] border border-slate-600 transition cursor-pointer"
                          title="Thay ảnh khác"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setAnhCccdSau(null)}
                          className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-500 text-white text-[11px] transition cursor-pointer"
                          title="Gỡ ảnh này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputCccdSauRef.current?.click()}
                      className="h-28 rounded-lg border-2 border-dashed border-slate-700 hover:border-blue-500/60 bg-slate-950/50 hover:bg-slate-950 flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-blue-400 transition cursor-pointer"
                    >
                      <Upload className="w-5 h-5 text-slate-500" />
                      <span className="text-[11px] font-medium">+ Tải ảnh mặt sau</span>
                    </button>
                  )}

                  {anhCccdSau && (
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => handleOpenEditor('cccd_sau')}
                        className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" /> Cắt / Xoay / Lật
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputCccdSauRef.current?.click()}
                        className="text-slate-400 hover:text-slate-300 cursor-pointer"
                      >
                        Thay ảnh
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Giấy chứng nhận QSDĐ (GCN) */}
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400">
                  2. Ảnh Giấy chứng nhận QSDĐ (GCN / Sổ đỏ):
                </span>
                <button
                  type="button"
                  onClick={() => fileInputGcnRef.current?.click()}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white border border-blue-500/30 transition flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Thêm ảnh GCN
                </button>
              </div>

              {anhGcnList.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {anhGcnList.map((url, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-1.5 group relative"
                    >
                      <div className="relative rounded-lg overflow-hidden border border-slate-700 bg-black/40 h-24 flex items-center justify-center">
                        <img
                          src={url}
                          alt={`GCN ${idx + 1}`}
                          className="max-h-full max-w-full object-contain"
                        />
                        <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 p-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEditor({ type: 'gcn', index: idx })}
                            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold flex items-center gap-1 shadow transition cursor-pointer"
                            title="Cắt, xoay, lật khổ A4"
                          >
                            <Pencil className="w-2.5 h-2.5" /> Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveGcnImage(idx)}
                            className="p-1 rounded bg-red-600/80 hover:bg-red-500 text-white text-[10px] transition cursor-pointer"
                            title="Xóa trang này"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-semibold text-slate-300">Trang {idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleOpenEditor({ type: 'gcn', index: idx })}
                          className="text-blue-400 hover:text-blue-300 cursor-pointer"
                        >
                          Cắt / Xoay
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  onClick={() => fileInputGcnRef.current?.click()}
                  className="p-4 rounded-xl border-2 border-dashed border-slate-800 hover:border-blue-500/50 bg-slate-950/40 hover:bg-slate-950 flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-blue-400 transition cursor-pointer"
                >
                  <Upload className="w-5 h-5 text-slate-500" />
                  <span className="text-[11px] font-medium">Bấm vào đây để tải ảnh Giấy chứng nhận (GCN)</span>
                  <span className="text-[9px] text-slate-500">Hỗ trợ nhiều trang GCN • Tự động cắt theo khổ giấy A4</span>
                </div>
              )}
            </div>
          </div>

          {/* Tứ cận giáp ranh */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2.5">
            <span className="font-bold text-slate-300 text-xs flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-blue-400" /> Tứ cận tiếp giáp:
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Giáp Đông</label>
                <input
                  type="text"
                  value={giapDong}
                  onChange={(e) => setGiapDong(e.target.value)}
                  placeholder="Giáp thửa / đường / suối..."
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Giáp Tây</label>
                <input
                  type="text"
                  value={giapTay}
                  onChange={(e) => setGiapTay(e.target.value)}
                  placeholder="Giáp thửa..."
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Giáp Nam</label>
                <input
                  type="text"
                  value={giapNam}
                  onChange={(e) => setGiapNam(e.target.value)}
                  placeholder="Giáp thửa..."
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Giáp Bắc</label>
                <input
                  type="text"
                  value={giapBac}
                  onChange={(e) => setGiapBac(e.target.value)}
                  placeholder="Giáp thửa..."
                  className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Danh sách thửa gộp kèm theo */}
          {thuaKemTheo.length > 0 && (
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" /> Các thửa gộp kèm theo trong phiếu:
                </span>
                <span className="text-[10px] text-slate-400">
                  {thuaKemTheo.length} thửa kèm theo
                </span>
              </div>

              <div className="space-y-1.5">
                {thuaKemTheo.map((ap) => (
                  <div
                    key={ap.ma_thua}
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-bold text-white text-xs block">
                        Thửa {ap.so_thua} • Tờ {ap.to_ban_do}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {ap.dien_tich ? `${ap.dien_tich} m²` : '---'} • {ap.loai_dat || 'Chưa rõ'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveAttachedParcel(ap.ma_thua)}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition cursor-pointer"
                      title="Gỡ thửa này khỏi phiếu kê khai"
                    >
                      Gỡ bỏ
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 italic">
                * Lưu ý: Khi gỡ bỏ thửa kèm theo, thửa đó sẽ tự động quay trở lại trạng thái ban đầu (Có tên hoặc Chưa có tên).
              </p>
            </div>
          )}

          {/* Ghi chú */}
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Ghi chú nguồn gốc / hiện trạng sử dụng đất</label>
            <textarea
              rows={2}
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              placeholder="Khai hoang, nhận chuyển nhượng..."
              className="w-full px-3 py-2 border border-slate-700 rounded-xl bg-slate-900 text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            ></textarea>
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex items-center justify-between gap-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsConfirmDeleteOpen(true)}
              className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-red-500/15 text-red-400 hover:bg-red-600 hover:text-white border border-red-500/30 transition flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa phiếu kê khai</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              >
                Hủy bỏ
              </button>

              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl text-xs font-black bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Lưu thay đổi</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Confirmation Modal when Deleting */}
      {isConfirmDeleteOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl max-w-md w-full p-5 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h4 className="font-black text-sm text-white">Xác nhận xóa phiếu kê khai</h4>
                <p className="text-xs text-slate-400">Hành động này sẽ hủy bỏ hồ sơ kê khai thực địa</p>
              </div>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-2 text-slate-300">
              <p>
                Bạn có chắc chắn muốn xóa phiếu kê khai của thửa{' '}
                <strong className="text-white">
                  Thửa {parcel.so_thua} (Tờ {parcel.to_ban_do})
                </strong>
                ?
              </p>
              {thuaKemTheo.length > 0 && (
                <p className="text-amber-400">
                  Phiếu này bao gồm <strong>{thuaKemTheo.length} thửa kèm theo</strong> ({thuaKemTheo.map((t) => `Thửa ${t.so_thua}/${t.to_ban_do}`).join(', ')}).
                </p>
              )}
              <p className="text-slate-400 text-[11px]">
                👉 Toàn bộ các thửa trong phiếu này sẽ <strong>tự động quay trở lại trạng thái ban đầu</strong> (Có tên - Màu Vàng, hoặc Chưa có tên - Màu Trắng/Xám).
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsConfirmDeleteOpen(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl text-xs font-black bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-600/30 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xác nhận xóa</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Chỉnh Sửa Ảnh (Cắt, Xoay, Lật, Lọc tài liệu, Thay thế) */}
      <CccdImageEditorModal
        isOpen={isEditorOpen}
        imageUrl={editorImageUrl}
        title={editorTitle}
        defaultAspect={editorDefaultAspect}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveEditedImage}
      />
    </div>
  );
}
