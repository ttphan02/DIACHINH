'use client';

import React, { useState } from 'react';
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
  Navigation
} from 'lucide-react';

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
  const [mode, setMode] = useState<DeclarationMode>('SELF');

  // Boundaries state (Tứ cận)
  const [giapDong, setGiapDong] = useState(parcel?.giap_dong || '');
  const [giapTay, setGiapTay] = useState(parcel?.giap_tay || '');
  const [giapNam, setGiapNam] = useState(parcel?.giap_nam || '');
  const [giapBac, setGiapBac] = useState(parcel?.giap_bac || '');

  // Declaration form state
  const [nguoiKeKhaiTen, setNguoiKeKhaiTen] = useState('');
  const [nguoiKeKhaiSdt, setNguoiKeKhaiSdt] = useState('');
  const [chuDatTen, setChuDatTen] = useState(parcel?.chu_ho && parcel.chu_ho !== 'Chưa có tên' ? parcel.chu_ho : '');
  const [chuDatCccd, setChuDatCccd] = useState('');
  const [ghiChu, setGhiChu] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!parcel) return null;

  const getStatusBadge = () => {
    switch (parcel.trang_thai) {
      case 'DA_SO_HOA_XANH':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full border border-blue-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-600"></span> 🔵 Đã số hóa (GGS)
          </span>
        );
      case 'DA_KE_KHAI_CHUA_SO_HOA_LAM':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span> 🟢 Đã kê khai (Chờ số hóa)
          </span>
        );
      case 'CO_TEN_CHUA_SO_HOA_VANG':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-800 rounded-full border border-amber-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span> Có tên chủ đất
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-semibold bg-gray-100 text-gray-700 rounded-full border border-gray-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-400"></span> Chưa có tên
          </span>
        );
    }
  };

  const handleApplyNeighborToBoundary = (direction: 'dong' | 'tay' | 'nam' | 'bac', neighbor: NeighborParcel) => {
    const text = `Thửa ${neighbor.so_thua} (Tờ ${neighbor.to_ban_do}) - ${neighbor.chu_ho || 'Chưa rõ'}`;
    if (direction === 'dong') setGiapDong(text);
    if (direction === 'tay') setGiapTay(text);
    if (direction === 'nam') setGiapNam(text);
    if (direction === 'bac') setGiapBac(text);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveDeclaration({
      ma_thua: parcel.ma_thua,
      mode,
      nguoi_ke_khai_ten: mode === 'SELF' ? chuDatTen : nguoiKeKhaiTen,
      nguoi_ke_khai_sdt: nguoiKeKhaiSdt,
      chu_dat_ten: chuDatTen,
      chu_dat_cccd: chuDatCccd,
      giap_dong: giapDong,
      giap_tay: giapTay,
      giap_nam: giapNam,
      giap_bac: giapBac,
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
            /* Phiếu Kê Khai (2 Chế độ) */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Chọn chế độ kê khai */}
              <div className="flex p-1 bg-gray-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMode('SELF')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 ${
                    mode === 'SELF'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <User className="w-3.5 h-3.5" /> Bản thân tự kê khai
                </button>
                <button
                  type="button"
                  onClick={() => setMode('SURVEYOR')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 ${
                    mode === 'SURVEYOR'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" /> Người chuyên trách / Kê khai hộ
                </button>
              </div>

              {/* Thông tin người kê khai hộ (Nếu là cán bộ) */}
              {mode === 'SURVEYOR' && (
                <div className="p-3.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-3">
                  <h5 className="text-xs font-bold text-blue-900 flex items-center gap-1">
                    <User className="w-3.5 h-3.5" /> Thông tin Người Chuyên Trách / Cán Bộ Kê Khai:
                  </h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Họ & Tên người kê khai *
                      </label>
                      <input
                        type="text"
                        required
                        value={nguoiKeKhaiTen}
                        onChange={(e) => setNguoiKeKhaiTen(e.target.value)}
                        placeholder="Vd: Nguyễn Văn Cán Bộ..."
                        className="w-full text-xs px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Số điện thoại liên hệ *
                      </label>
                      <input
                        type="tel"
                        required
                        value={nguoiKeKhaiSdt}
                        onChange={(e) => setNguoiKeKhaiSdt(e.target.value)}
                        placeholder="0912..."
                        className="w-full text-xs px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Thông tin chủ thửa đất */}
              <div className="p-4 bg-white border border-gray-100 rounded-xl shadow-sm space-y-3">
                <h5 className="text-xs font-bold text-gray-900">Thông tin Chủ Thửa Đất Thực Tế:</h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Họ và Tên chủ đất *
                    </label>
                    <input
                      type="text"
                      required
                      value={chuDatTen}
                      onChange={(e) => setChuDatTen(e.target.value)}
                      placeholder="Vd: Trần Văn Chủ Hộ..."
                      className="w-full text-xs px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Số định danh / CCCD chủ đất *
                    </label>
                    <input
                      type="text"
                      required
                      value={chuDatCccd}
                      onChange={(e) => setChuDatCccd(e.target.value)}
                      placeholder="12 chữ số CCCD..."
                      className="w-full text-xs px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {mode === 'SELF' && (
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Số điện thoại người dân tự kê khai *
                      </label>
                      <input
                        type="tel"
                        required
                        value={nguoiKeKhaiSdt}
                        onChange={(e) => setNguoiKeKhaiSdt(e.target.value)}
                        placeholder="09..."
                        className="w-full text-xs px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Upload ảnh CCCD và Giấy chứng nhận quyền sử dụng đất */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl bg-white text-center cursor-pointer transition">
                  <Upload className="w-5 h-5 mx-auto text-blue-500 mb-1" />
                  <span className="text-xs font-bold text-gray-800 block">Chụp / Đính kèm ảnh CCCD</span>
                  <span className="text-[11px] text-gray-400">Mặt trước và mặt sau</span>
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
