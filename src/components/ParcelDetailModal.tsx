'use client';

import React, { useState, useEffect } from 'react';
import { Parcel, NeighborParcel, DeclarationMode, DeclarationFormData } from '@/types';
import {
  X,
  MapPin,
  ExternalLink,
  Compass,
  User,
  Users,
  Phone,
  FileText,
  Upload,
  Eye,
  CheckCircle2,
  Navigation,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  cleanCccd,
  cleanName,
  cleanBoundaryText,
  NGUON_GOC_OPTIONS,
  normalizeNguonGoc,
  isValidCccd,
  isValidBirthYear,
  isValidFullName,
} from '@/utils/textHelpers';

interface ParcelDetailModalProps {
  parcel: Parcel | null;
  neighbors: NeighborParcel[];
  onClose: () => void;
  onOpenVectorViewer: (svgUrl: string, title: string, owner?: string, cccd?: string, urls?: string[]) => void;
  onSaveDeclaration: (data: DeclarationFormData) => void;
}

export default function ParcelDetailModal({
  parcel,
  neighbors,
  onClose,
  onOpenVectorViewer,
  onSaveDeclaration,
}: ParcelDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'declare'>('info');

  // Boundaries state (Tứ cận)
  const [giapDong, setGiapDong] = useState(parcel?.giap_dong || '');
  const [giapTay, setGiapTay] = useState(parcel?.giap_tay || '');
  const [giapNam, setGiapNam] = useState(parcel?.giap_nam || '');
  const [giapBac, setGiapBac] = useState(parcel?.giap_bac || '');

  // Declaration form state - 1.1 Cá nhân & Nguồn gốc
  const isInvalidOwnerName = (name?: string) => {
    if (!name) return true;
    const s = name.trim().toLowerCase();
    const placeholders = [
      'chưa có tên',
      'không có tên',
      'không có dữ liệu',
      'không có dữ liệu cập nhật',
      'không có trong dữ liệu',
      'không có trong smk',
      'hồ ea rớt',
      'ubnd xã',
      'ông ..',
      'bà ..',
      '..',
      'nam',
      'nữ',
      'nu',
      'cá nhân',
      'chung',
    ];
    return placeholders.some((ph) => s === ph || s.includes(ph));
  };

  const formatThonAddress = (thon?: string) => {
    const clean = (thon || '').trim();
    if (!clean || clean.includes('(khong đia chỉ)')) return 'Xã Cư Pui, huyện Krông Bông';
    if (clean.toLowerCase().includes('cư pui') || clean.toLowerCase().includes('cu pui')) {
      return clean;
    }
    return `${clean}, xã Cư Pui`;
  };

  const parcelNameValid = parcel?.chu_ho && !isInvalidOwnerName(parcel.chu_ho);
  const [chuDatTen, setChuDatTen] = useState(cleanName(parcelNameValid ? parcel!.chu_ho : ''));
  const [chuDatNamSinh, setChuDatNamSinh] = useState('');
  const [chuDatGioiTinh, setChuDatGioiTinh] = useState<'Nam' | 'Nữ'>(
    parcel?.chu_ho?.trim().toLowerCase() === 'nữ' ? 'Nữ' : 'Nam'
  );
  const [chuDatCccd, setChuDatCccd] = useState(parcel?.cccd || '');
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [cccdCheckResult, setCccdCheckResult] = useState<{ exists: boolean; filename?: string; url?: string; message?: string } | null>(null);
  const [isCheckingCccd, setIsCheckingCccd] = useState(false);

  useEffect(() => {
    const clean = cleanCccd(chuDatCccd);
    if (clean.length === 12) {
      let active = true;
      setIsCheckingCccd(true);
      fetch(`/api/cccd?check=${clean}`)
        .then((r) => r.json() as Promise<{ exists: boolean; filename?: string; url?: string; message?: string }>)
        .then((res) => {
          if (active) setCccdCheckResult(res);
        })
        .catch(() => {
          if (active) setCccdCheckResult(null);
        })
        .finally(() => {
          if (active) setIsCheckingCccd(false);
        });
      return () => {
        active = false;
      };
    } else {
      setCccdCheckResult(null);
      setIsCheckingCccd(false);
    }
  }, [chuDatCccd]);

  const [chuDatDiaChi, setChuDatDiaChi] = useState(formatThonAddress(parcel?.thon_xa));
  const [nguonGocSuDung, setNguonGocSuDung] = useState<string>('Khai Hoang');
  const [ghiChu, setGhiChu] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!parcel) return null;

  const getStatusBadge = () => {
    switch (parcel.trang_thai) {
      case 'DA_SO_HOA_XANH':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span> 🟢 Đã số hóa (GGS)
          </span>
        );
      case 'DA_KE_KHAI_CHUA_SO_HOA_LAM':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full border border-blue-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-600"></span> 🔵 Đã kê khai (Chưa lên GGS)
          </span>
        );
      case 'CO_TEN_CHUA_SO_HOA_VANG':
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-800 rounded-full border border-amber-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span> 🟡 Chưa kê khai
          </span>
        );
    }
  };

  const handleApplyNeighborToBoundary = (direction: 'dong' | 'tay' | 'nam' | 'bac', neighbor: NeighborParcel) => {
    const text = `Thửa ${neighbor.so_thua} (Tờ ${neighbor.to_ban_do}) - ${cleanName(neighbor.chu_ho) || 'Chưa rõ'}`;
    if (direction === 'dong') setGiapDong(text);
    if (direction === 'tay') setGiapTay(text);
    if (direction === 'nam') setGiapNam(text);
    if (direction === 'bac') setGiapBac(text);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitted(true);
    const cleanedTen = cleanName(chuDatTen);
    const cleanedNamSinh = chuDatNamSinh.trim();
    const cleanedCccd = chuDatCccd.replace(/\D/g, '').slice(0, 12);
    const cleanedDiaChi = chuDatDiaChi.trim();

    if (!isValidFullName(cleanedTen)) {
      alert('Vui lòng nhập đầy đủ Họ và tên cá nhân (tối thiểu 2 từ, không gồm danh xưng).');
      return;
    }
    if (cleanedNamSinh && !isValidBirthYear(cleanedNamSinh)) {
      alert('Năm sinh không hợp lệ. Vui lòng nhập đúng 4 chữ số (ví dụ: 1985).');
      return;
    }
    if (cleanedCccd && !isValidCccd(cleanedCccd)) {
      alert(`Số CCCD chưa đủ 12 chữ số (đang có ${cleanedCccd.length}/12 số). Vui lòng nhập đủ 12 chữ số.`);
      return;
    }
    if (!cleanedDiaChi) {
      alert('Vui lòng nhập địa chỉ thường trú.');
      return;
    }

    onSaveDeclaration({
      ma_thua: parcel.ma_thua,
      mode: 'SELF',
      chu_dat_ten: cleanedTen,
      chu_dat_nam_sinh: cleanedNamSinh,
      chu_dat_gioi_tinh: chuDatGioiTinh,
      chu_dat_cccd: cleanedCccd,
      chu_dat_dia_chi: cleanedDiaChi,
      nguon_goc_su_dung: normalizeNguonGoc(nguonGocSuDung),
      giap_dong: cleanBoundaryText(giapDong),
      giap_tay: cleanBoundaryText(giapTay),
      giap_nam: cleanBoundaryText(giapNam),
      giap_bac: cleanBoundaryText(giapBac),
      ghi_chu: ghiChu,
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative flex flex-col w-full max-w-3xl max-h-[92vh] bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">
                Thửa số <span className="text-blue-600 font-extrabold">{parcel.so_thua}</span> • Tờ bản đồ <span className="text-blue-600 font-extrabold">{parcel.to_ban_do}</span>
              </h2>
              {getStatusBadge()}
            </div>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-gray-400" />
              Thôn/Xã: <strong className="text-gray-700 capitalize">{parcel.thon_xa}</strong>
              <span className="text-gray-300">•</span>
              Mã thửa: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">{parcel.ma_thua}</code>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-gray-100 bg-white px-6">
          <button
            onClick={() => setActiveTab('info')}
            className={`py-3 px-4 font-semibold text-sm border-b-2 transition ${
              activeTab === 'info'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Thông Tin Thửa & Tứ Cận Lân Cận
          </button>
          <button
            onClick={() => setActiveTab('declare')}
            className={`py-3 px-4 font-semibold text-sm border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'declare'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            Phiếu Kê Khai Đất Đai
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/40">
          {activeTab === 'info' ? (
            <>
              {/* Thông số cơ bản */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                <div>
                  <span className="text-xs text-gray-400 font-medium">Chủ sở hữu</span>
                  <p className="text-sm font-bold text-gray-800 truncate" title={parcel.chu_ho}>
                    {parcel.chu_ho || 'Chưa xác định'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-400 font-medium">Diện tích</span>
                  <p className="text-sm font-bold text-blue-600">
                    {parcel.dien_tich ? `${parcel.dien_tich} m²` : '---'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-400 font-medium">Loại đất</span>
                  <p className="text-sm font-bold text-emerald-600">{parcel.loai_dat || 'Chưa có'}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400 font-medium">Định vị GPS</span>
                  {parcel.gmap_link ? (
                    <a
                      href={parcel.gmap_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-semibold mt-0.5"
                    >
                      Mở Google Maps <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">Chưa có tọa độ</p>
                  )}
                </div>
              </div>

              {/* Tứ Cận (Đông, Tây, Nam, Bắc) */}
              <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-blue-600" />
                    Xác định Tứ Cận (Ranh giới tiếp giáp)
                  </h4>
                  <span className="text-xs text-gray-400">Có thể chọn nhanh từ thửa lân cận bên dưới</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Phía Đông giáp với:
                    </label>
                    <input
                      type="text"
                      value={giapDong}
                      onChange={(e) => setGiapDong(e.target.value)}
                      placeholder="Vd: Thửa 59 - Ông Nguyễn Văn A..."
                      className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Phía Tây giáp với:
                    </label>
                    <input
                      type="text"
                      value={giapTay}
                      onChange={(e) => setGiapTay(e.target.value)}
                      placeholder="Vd: Đường giao thông, suối..."
                      className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Phía Nam giáp với:
                    </label>
                    <input
                      type="text"
                      value={giapNam}
                      onChange={(e) => setGiapNam(e.target.value)}
                      placeholder="Vd: Thửa 40 - Bà Lê Thị B..."
                      className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Phía Bắc giáp với:
                    </label>
                    <input
                      type="text"
                      value={giapBac}
                      onChange={(e) => setGiapBac(e.target.value)}
                      placeholder="Vd: Thửa 38..."
                      className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Các Thửa Lân Cận Đã Kê Khai (Gợi ý tự động) */}
              <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                    <Navigation className="w-4 h-4 text-emerald-600" />
                    Các Thửa Lân Cận (Bán kính 30m - 150m)
                  </h4>
                  <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                    Tìm thấy {neighbors.length} thửa xung quanh
                  </span>
                </div>

                {neighbors.length === 0 ? (
                  <p className="text-xs text-gray-400 py-3 text-center">
                    Không tìm thấy thửa lân cận trong bán kính lân cận hoặc thửa chưa có tọa độ GPS.
                  </p>
                ) : (
                  <div className="divide-y divide-gray-100 max-h-60 overflow-y-auto">
                    {neighbors.map((nb) => (
                      <div
                        key={nb.ma_thua}
                        className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-gray-50/80 px-2 rounded-lg transition"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900">
                              Thửa {nb.so_thua} (Tờ {nb.to_ban_do})
                            </span>
                            <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                              Cách ~{nb.distanceMeters}m
                            </span>
                            <span className="text-[11px] font-semibold text-emerald-600">
                              {nb.loai_dat}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5">
                            Chủ hộ: <strong className="text-gray-800">{nb.chu_ho || 'Chưa có tên'}</strong>
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 text-xs">
                          {/* Nút xem CCCD Vector mẫu */}
                          <button
                            onClick={() =>
                              onOpenVectorViewer(
                                '/svgs/Bùi Thị Cườm - Thôn Cẩm Phong, xã Cư Pui - CHUACOGIAY_24478_268_50.svg',
                                `Ảnh CCCD Vector - Thửa ${nb.so_thua}`,
                                nb.chu_ho,
                                '049070002148'
                              )
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded transition font-medium"
                            title="Xem ảnh CCCD Vector sắc nét"
                          >
                            <Eye className="w-3.5 h-3.5" /> Xem CCCD
                          </button>

                          {/* Gán Tứ Cận Nhanh */}
                          <div className="flex items-center gap-1 bg-gray-50 p-0.5 rounded border border-gray-200">
                            <span className="text-[10px] text-gray-400 px-1 font-semibold">Gán:</span>
                            <button
                              onClick={() => handleApplyNeighborToBoundary('dong', nb)}
                              className="px-1.5 py-0.5 text-[10px] hover:bg-white rounded font-medium text-gray-700"
                              title="Gán phía Đông"
                            >
                              Đông
                            </button>
                            <button
                              onClick={() => handleApplyNeighborToBoundary('tay', nb)}
                              className="px-1.5 py-0.5 text-[10px] hover:bg-white rounded font-medium text-gray-700"
                              title="Gán phía Tây"
                            >
                              Tây
                            </button>
                            <button
                              onClick={() => handleApplyNeighborToBoundary('nam', nb)}
                              className="px-1.5 py-0.5 text-[10px] hover:bg-white rounded font-medium text-gray-700"
                              title="Gán phía Nam"
                            >
                              Nam
                            </button>
                            <button
                              onClick={() => handleApplyNeighborToBoundary('bac', nb)}
                              className="px-1.5 py-0.5 text-[10px] hover:bg-white rounded font-medium text-gray-700"
                              title="Gán phía Bắc"
                            >
                              Bắc
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Phiếu Kê Khai 1.1 Cá nhân & Nguồn gốc */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 1.1 Cá nhân */}
              <div className="p-4 bg-white border border-gray-100 rounded-xl shadow-sm space-y-3">
                <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                  <User className="w-4 h-4 text-blue-600" />
                  <h5 className="text-xs font-bold text-gray-900 uppercase">1.1 Cá nhân</h5>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Họ và Tên chủ đất <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={chuDatTen}
                      onChange={(e) => setChuDatTen(e.target.value)}
                      onBlur={() => setChuDatTen(cleanName(chuDatTen))}
                      placeholder="NGUYỄN VĂN A"
                      className={`w-full text-xs px-3 py-2 border rounded-lg focus:outline-none font-bold uppercase transition ${
                        (formSubmitted || (chuDatTen.length > 0 && chuDatTen.trim().split(/\s+/).length < 2)) && !isValidFullName(chuDatTen)
                          ? 'border-red-500 bg-red-50/20 text-red-900 focus:ring-2 focus:ring-red-400 ring-1 ring-red-400'
                          : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                      }`}
                    />
                    {(formSubmitted || (chuDatTen.length > 0 && chuDatTen.trim().split(/\s+/).length < 2)) && !isValidFullName(chuDatTen) && (
                      <p className="mt-1 text-[11px] text-red-600 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {!chuDatTen.trim() ? 'Vui lòng nhập họ và tên' : 'Họ và tên tối thiểu 2 từ (đã loại bỏ danh xưng)'}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Năm sinh <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={chuDatNamSinh}
                        onChange={(e) => setChuDatNamSinh(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="1980"
                        className={`w-full text-xs px-3 py-2 border rounded-lg focus:outline-none font-medium transition ${
                          (formSubmitted && !chuDatNamSinh.trim()) || (chuDatNamSinh.length > 0 && !isValidBirthYear(chuDatNamSinh))
                            ? 'border-red-500 bg-red-50/20 text-red-900 focus:ring-2 focus:ring-red-400 ring-1 ring-red-400'
                            : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                        }`}
                      />
                      {((formSubmitted && !chuDatNamSinh.trim()) || (chuDatNamSinh.length > 0 && !isValidBirthYear(chuDatNamSinh))) && (
                        <p className="mt-1 text-[10px] text-red-600 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          {!chuDatNamSinh.trim() ? 'Nhập 4 số năm sinh' : 'Năm sinh 4 số (1920 - nay)'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Giới tính <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={chuDatGioiTinh}
                        onChange={(e) => setChuDatGioiTinh(e.target.value as 'Nam' | 'Nữ')}
                        className="w-full text-xs px-2.5 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        <option value="Nam">Nam</option>
                        <option value="Nữ">Nữ</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 flex-wrap">
                        <span>Số CCCD</span>
                        <span className="text-red-500">*</span>
                        {cccdCheckResult?.exists && (
                          <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-300 px-1.5 py-0.5 rounded-md flex items-center gap-1 animate-in fade-in shadow-2xs">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            Đã có cccd trên hệ thống!
                          </span>
                        )}
                      </label>
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-mono font-bold ${chuDatCccd.replace(/\D/g, '').length === 12 ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {chuDatCccd.replace(/\D/g, '').length}/12
                        </span>
                        {cccdCheckResult?.exists && cccdCheckResult.url && (
                          <a
                            href={cccdCheckResult.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-emerald-700 hover:text-emerald-900 underline font-bold"
                          >
                            Xem file
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={chuDatCccd}
                        onChange={(e) => setChuDatCccd(e.target.value.replace(/\D/g, '').slice(0, 12))}
                        placeholder="12 chữ số CCCD..."
                        className={`w-full text-xs px-3 py-2 border rounded-lg focus:outline-none font-mono font-bold tracking-wider transition ${
                          (formSubmitted && !chuDatCccd.trim()) || (chuDatCccd.length > 0 && !isValidCccd(chuDatCccd))
                            ? 'border-red-500 bg-red-50/20 text-red-900 focus:ring-2 focus:ring-red-400 ring-1 ring-red-400'
                            : cccdCheckResult?.exists
                            ? 'border-emerald-500 bg-emerald-50/20 text-emerald-950 ring-2 ring-emerald-500/20'
                            : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                        }`}
                      />
                      {isCheckingCccd && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 flex items-center gap-1">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      )}
                    </div>
                    {((formSubmitted && !chuDatCccd.trim()) || (chuDatCccd.length > 0 && !isValidCccd(chuDatCccd))) && (
                      <p className="mt-1 text-[11px] text-red-600 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {!chuDatCccd.trim() ? 'Vui lòng nhập số CCCD (12 chữ số)' : `Số CCCD phải gồm đúng 12 chữ số (đang có ${chuDatCccd.replace(/\D/g, '').length}/12 số)`}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Địa chỉ thường trú <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={chuDatDiaChi}
                      onChange={(e) => setChuDatDiaChi(e.target.value)}
                      placeholder="Thôn Cẩm Phong, xã Cư Pui..."
                      className={`w-full text-xs px-3 py-2 border rounded-lg focus:outline-none transition ${
                        formSubmitted && !chuDatDiaChi.trim()
                          ? 'border-red-500 bg-red-50/20 text-red-900 focus:ring-2 focus:ring-red-400 ring-1 ring-red-400'
                          : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                      }`}
                    />
                    {formSubmitted && !chuDatDiaChi.trim() && (
                      <p className="mt-1 text-[11px] text-red-600 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        Vui lòng nhập địa chỉ thường trú
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Nguồn gốc sử dụng đất */}
              <div className="p-4 bg-white border border-gray-100 rounded-xl shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-gray-800">
                    Nguồn gốc sử dụng đất <span className="text-red-500">*</span>
                  </label>
                  <span className="text-xs font-bold text-blue-600">{normalizeNguonGoc(nguonGocSuDung)}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {NGUON_GOC_OPTIONS.map((ng) => (
                    <button
                      type="button"
                      key={ng}
                      onClick={() => setNguonGocSuDung(ng)}
                      className={`py-2 px-2 text-xs font-bold rounded-lg border transition text-center cursor-pointer ${
                        normalizeNguonGoc(nguonGocSuDung) === ng
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {ng}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload ảnh CCCD và Giấy chứng nhận quyền sử dụng đất */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl bg-white text-center cursor-pointer transition">
                  <Upload className="w-5 h-5 mx-auto text-blue-500 mb-1" />
                  <span className="text-xs font-bold text-gray-800 block">Tải lên CCCD của cá nhân</span>
                  <span className="text-[11px] text-gray-400">(Tùy chọn)</span>
                </div>
                <div className="p-3.5 border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl bg-white text-center cursor-pointer transition">
                  <Upload className="w-5 h-5 mx-auto text-emerald-500 mb-1" />
                  <span className="text-xs font-bold text-gray-800 block">Chụp / Đính kèm Sổ Đỏ (GCN)</span>
                  <span className="text-[11px] text-gray-400">Nếu đã có giấy chứng nhận</span>
                </div>
              </div>

              {/* Ghi chú */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Ghi chú bổ sung</label>
                <textarea
                  rows={2}
                  value={ghiChu}
                  onChange={(e) => setGhiChu(e.target.value)}
                  placeholder="Ghi chú về nguồn gốc đất, tình trạng tranh chấp hoặc yêu cầu thêm..."
                  className="w-full text-xs px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                ></textarea>
              </div>

              {savedSuccess && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Đã ghi nhận phiếu kê khai thành công cho thửa {parcel.ma_thua}!
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition"
              >
                Lưu Phiếu Kê Khai Thửa Đất
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
