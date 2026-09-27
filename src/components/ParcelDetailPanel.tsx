'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Parcel, NeighborParcel, DeclarationMode, DeclarationFormData } from '@/types';
import {
  X,
  MapPin,
  ExternalLink,
  Compass,
  User,
  Users,
  FileText,
  Upload,
  Eye,
  CheckCircle2,
  Navigation,
  ShieldCheck,
  AlertCircle,
  Layers,
  ChevronRight,
} from 'lucide-react';

interface ParcelDetailPanelProps {
  parcel: Parcel | null;
  neighbors: NeighborParcel[];
  sameOwnerParcels?: Parcel[];
  onSelectParcel?: (parcel: Parcel) => void;
  onClose: () => void;
  onOpenVectorViewer: (svgUrl: string, title: string, owner?: string, cccd?: string) => void;
  onSaveDeclaration: (data: DeclarationFormData) => void;
}

export default function ParcelDetailPanel({
  parcel,
  neighbors,
  sameOwnerParcels = [],
  onSelectParcel,
  onClose,
  onOpenVectorViewer,
  onSaveDeclaration,
}: ParcelDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'declare'>('info');
  const [mode, setMode] = useState<DeclarationMode>('SELF');

  // Danh sách các thửa khác cùng chủ hộ (loại trừ thửa hiện tại)
  const otherParcels = useMemo(() => {
    if (!parcel) return [];
    return sameOwnerParcels.filter((p) => p.ma_thua !== parcel.ma_thua);
  }, [parcel, sameOwnerParcels]);

  // Boundaries state (Tứ cận)
  const [giapDong, setGiapDong] = useState('');
  const [giapTay, setGiapTay] = useState('');
  const [giapNam, setGiapNam] = useState('');
  const [giapBac, setGiapBac] = useState('');

  // Declaration form state
  const [nguoiKeKhaiTen, setNguoiKeKhaiTen] = useState('');
  const [nguoiKeKhaiSdt, setNguoiKeKhaiSdt] = useState('');
  const [chuDatTen, setChuDatTen] = useState('');
  const [chuDatCccd, setChuDatCccd] = useState('');
  const [ghiChu, setGhiChu] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Sync state when parcel changes
  useEffect(() => {
    if (parcel) {
      setGiapDong(parcel.giap_dong || '');
      setGiapTay(parcel.giap_tay || '');
      setGiapNam(parcel.giap_nam || '');
      setGiapBac(parcel.giap_bac || '');
      setChuDatTen(parcel.chu_ho && parcel.chu_ho !== 'Chưa có tên' ? parcel.chu_ho : '');
      setChuDatCccd(parcel.cccd || '');
      setSavedSuccess(false);
    }
  }, [parcel]);

  if (!parcel) return null;

  const getStatusBadge = () => {
    switch (parcel.trang_thai) {
      case 'DA_SO_HOA_XANH':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Đã số hóa (GGS)
          </span>
        );
      case 'DA_KE_KHAI_CHUA_SO_HOA_LAM':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 rounded-full border border-blue-200 inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span> Đã kê khai (Chưa lên GGS)
          </span>
        );
      case 'CO_TEN_CHUA_SO_HOA_VANG':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full border border-amber-200 inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Có tên chủ đất
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-700 rounded-full border border-gray-200 inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span> Chưa có tên
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
    <div className="h-full w-full flex flex-col bg-white overflow-hidden">
      {/* Mobile Drag Handle */}
      <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mt-2 mb-0.5 lg:hidden shrink-0" />

      {/* Top Header of Panel */}
      <div className="p-3.5 border-b border-gray-100 bg-gray-50/90 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-gray-900">
              Thửa <span className="text-blue-600 font-black">{parcel.so_thua}</span> • Tờ <span className="text-blue-600 font-black">{parcel.to_ban_do}</span>
            </h2>
            {getStatusBadge()}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-gray-400" />
            <span className="capitalize font-medium">{parcel.thon_xa}</span>
            <span className="text-gray-300">•</span>
            <code className="text-[11px] font-mono bg-white px-1.5 py-0.5 rounded border border-gray-200 text-gray-700">
              {parcel.ma_thua}
            </code>
            {sameOwnerParcels.length > 1 && (
              <>
                <span className="text-gray-300">•</span>
                <span className="text-[10px] font-bold bg-blue-100/90 text-blue-800 px-1.5 py-0.5 rounded border border-blue-200">
                  Chủ có {sameOwnerParcels.length} thửa
                </span>
              </>
            )}
          </p>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 rounded-xl transition"
          title="Đóng bảng chi tiết"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-100 bg-white px-3">
        <button
          onClick={() => setActiveTab('info')}
          className={`py-2 px-3 font-bold text-xs border-b-2 transition ${
            activeTab === 'info'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Thông tin & Tứ cận
        </button>
        <button
          onClick={() => setActiveTab('declare')}
          className={`py-2 px-3 font-bold text-xs border-b-2 transition flex items-center gap-1.5 ${
            activeTab === 'declare'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Phiếu kê khai
        </button>
      </div>

      {/* Panel Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {activeTab === 'info' ? (
          <>
            {/* NÚT XEM CCCD CHỦ ĐẤT */}
            {parcel.has_cccd && parcel.svg_url ? (
              <div className="p-3 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl text-white shadow-md flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-6 h-6 text-emerald-100" />
                  <div>
                    <h5 className="text-xs font-black">Đã có ảnh CCCD</h5>
                    <p className="text-[11px] text-emerald-100">Bản vẽ vector rõ nét</p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    onOpenVectorViewer(
                      parcel.svg_url!,
                      `Ảnh CCCD - Thửa ${parcel.so_thua} (Tờ ${parcel.to_ban_do})`,
                      parcel.chu_ho,
                      parcel.cccd
                    )
                  }
                  className="px-3 py-1.5 bg-white text-emerald-700 hover:bg-emerald-50 rounded-lg text-xs font-extrabold shadow-sm transition flex items-center gap-1"
                >
                  <Eye className="w-3.5 h-3.5" /> Xem CCCD
                </button>
              </div>
            ) : (
              <div className="p-2.5 bg-amber-50/80 border border-amber-200/80 rounded-xl text-amber-900 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <span>Chưa có ảnh CCCD của thửa này</span>
                </div>
                <button
                  onClick={() => setActiveTab('declare')}
                  className="text-[11px] font-bold text-blue-600 hover:underline"
                >
                  Thêm ảnh
                </button>
              </div>
            )}

            {/* Thông số chính */}
            <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs">
              <div>
                <span className="text-gray-400 text-[11px] block">Chủ sử dụng đất</span>
                <p className="font-bold text-gray-800 truncate" title={parcel.chu_ho}>
                  {parcel.chu_ho || 'Chưa xác định'}
                </p>
                {parcel.cccd && (
                  <span className="text-[10px] text-gray-500 block font-mono">CCCD: {parcel.cccd}</span>
                )}
              </div>
              <div>
                <span className="text-gray-400 text-[11px] block">Diện tích</span>
                <p className="font-bold text-blue-600">
                  {parcel.dien_tich ? `${parcel.dien_tich} m²` : '---'}
                </p>
              </div>
              <div>
                <span className="text-gray-400 text-[11px] block">Loại đất</span>
                <p className="font-bold text-emerald-600">{parcel.loai_dat || 'Chưa có'}</p>
              </div>
              <div>
                <span className="text-gray-400 text-[11px] block">Vị trí</span>
                {parcel.gmap_link ? (
                  <a
                    href={parcel.gmap_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline font-semibold"
                  >
                    Mở Google Maps <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-[11px] text-gray-400">Chưa có tọa độ</span>
                )}
              </div>
            </div>

            {/* DANH SÁCH CÁC THỬA ĐẤT KHÁC CÙNG CHỦ HỘ */}
            {otherParcels.length > 0 && (
              <div className="bg-gradient-to-br from-blue-50/90 to-indigo-50/70 p-3 rounded-xl border border-blue-200/90 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-blue-900 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-600" />
                    Thửa khác cùng chủ ({otherParcels.length} thửa)
                  </h4>
                  <span className="text-[10px] font-bold text-blue-700 bg-white px-2 py-0.5 rounded-full border border-blue-200 shadow-2xs">
                    {parcel.chu_ho}
                  </span>
                </div>
                <p className="text-[11px] text-blue-800 leading-snug">
                  Chủ hộ này còn đứng tên các thửa đất sau. Bấm vào thửa để chuyển nhanh sang xem hoặc kê khai:
                </p>

                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                  {otherParcels.map((op) => (
                    <div
                      key={op.ma_thua}
                      onClick={() => onSelectParcel && onSelectParcel(op)}
                      className="p-2.5 bg-white hover:bg-blue-50 border border-blue-100 hover:border-blue-400 rounded-xl transition cursor-pointer flex items-center justify-between gap-2 shadow-2xs group"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-xs text-gray-900 group-hover:text-blue-600 transition">
                            Thửa {op.so_thua} • Tờ {op.to_ban_do}
                          </span>
                          {op.trang_thai === 'DA_SO_HOA_XANH' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Đã số hóa
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Có tên
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-0.5 truncate">
                          <span className="font-bold text-blue-600">{op.dien_tich ? `${op.dien_tich} m²` : '---'}</span>
                          <span>•</span>
                          <span>{op.loai_dat || 'Chưa rõ loại'}</span>
                          <span>•</span>
                          <span className="capitalize">{op.thon_xa}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="px-2.5 py-1 text-[11px] font-bold bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white rounded-lg transition shrink-0 flex items-center gap-0.5"
                      >
                        Kê khai <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tứ Cận (Đông, Tây, Nam, Bắc) */}
            <div className="bg-white p-3 rounded-xl border border-gray-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-blue-600" />
                  Tứ cận (Tiếp giáp)
                </h4>
                <span className="text-[10px] text-gray-400">Bấm từ danh sách dưới để điền nhanh</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[10px] font-semibold text-gray-600 mb-0.5 block">
                    Phía Đông:
                  </label>
                  <input
                    type="text"
                    value={giapDong}
                    onChange={(e) => setGiapDong(e.target.value)}
                    placeholder="Giáp thửa/đường..."
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-600 mb-0.5 block">
                    Phía Tây:
                  </label>
                  <input
                    type="text"
                    value={giapTay}
                    onChange={(e) => setGiapTay(e.target.value)}
                    placeholder="Giáp thửa/đường..."
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-600 mb-0.5 block">
                    Phía Nam:
                  </label>
                  <input
                    type="text"
                    value={giapNam}
                    onChange={(e) => setGiapNam(e.target.value)}
                    placeholder="Giáp thửa/đường..."
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-600 mb-0.5 block">
                    Phía Bắc:
                  </label>
                  <input
                    type="text"
                    value={giapBac}
                    onChange={(e) => setGiapBac(e.target.value)}
                    placeholder="Giáp thửa/đường..."
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Thửa Lân Cận Đã Kê Khai */}
            <div className="bg-white p-3 rounded-xl border border-gray-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1">
                  <Navigation className="w-3.5 h-3.5 text-emerald-600" />
                  Thửa lân cận (gần nhất)
                </h4>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                  {neighbors.length} thửa
                </span>
              </div>

              {neighbors.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-2.5 text-center">
                  Không có thửa liền kề xung quanh.
                </p>
              ) : (
                <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto pr-1">
                  {neighbors.map((nb) => {
                    const getNeighborDot = () => {
                      if (nb.trang_thai === 'DA_SO_HOA_XANH') {
                        return <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-emerald-300 shrink-0" title="Đã số hóa (GGS)" />;
                      }
                      if (nb.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') {
                        return <span className="w-2.5 h-2.5 rounded-full bg-blue-600 border border-blue-300 shrink-0" title="Đã kê khai (Xanh lam)" />;
                      }
                      if (nb.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') {
                        return <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-300 shrink-0" title="Có tên chủ đất (Vàng)" />;
                      }
                      return <span className="w-2.5 h-2.5 rounded-full bg-gray-300 border border-gray-400 shrink-0" title="Chưa có tên" />;
                    };

                    return (
                      <div key={nb.ma_thua} className="py-2 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <button
                            type="button"
                            onClick={() => onSelectParcel && onSelectParcel(nb)}
                            className="font-bold text-gray-900 hover:text-blue-600 flex items-center gap-1.5 transition text-left"
                            title="Bấm để xem thửa này"
                          >
                            {getNeighborDot()}
                            <span>Thửa {nb.so_thua} (Tờ {nb.to_ban_do})</span>
                          </button>
                          <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded font-mono">
                            ~{nb.distanceMeters}m
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-600 truncate" title={nb.chu_ho}>
                          Chủ: <strong className="text-gray-800">{nb.chu_ho || 'Chưa có tên'}</strong>
                        </p>

                      <div className="flex items-center justify-between pt-0.5">
                        {nb.has_cccd && nb.svg_url ? (
                          <button
                            onClick={() =>
                              onOpenVectorViewer(
                                nb.svg_url!,
                                `Ảnh CCCD - Thửa ${nb.so_thua} (Tờ ${nb.to_ban_do})`,
                                nb.chu_ho,
                                nb.cccd
                              )
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 hover:underline"
                          >
                            <Eye className="w-3 h-3" /> Xem CCCD
                          </button>
                        ) : (
                          <span className="text-[10px] text-gray-400 italic">Chưa có ảnh CCCD</span>
                        )}

                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-gray-400">Điền:</span>
                          <button
                            onClick={() => handleApplyNeighborToBoundary('dong', nb)}
                            className="px-1 text-[10px] bg-gray-100 hover:bg-gray-200 rounded font-medium"
                          >
                            Đông
                          </button>
                          <button
                            onClick={() => handleApplyNeighborToBoundary('tay', nb)}
                            className="px-1 text-[10px] bg-gray-100 hover:bg-gray-200 rounded font-medium"
                          >
                            Tây
                          </button>
                          <button
                            onClick={() => handleApplyNeighborToBoundary('nam', nb)}
                            className="px-1 text-[10px] bg-gray-100 hover:bg-gray-200 rounded font-medium"
                          >
                            Nam
                          </button>
                          <button
                            onClick={() => handleApplyNeighborToBoundary('bac', nb)}
                            className="px-1 text-[10px] bg-gray-100 hover:bg-gray-200 rounded font-medium"
                          >
                            Bắc
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          </>
        ) : (
          /* Phiếu Kê Khai (Tab 2) */
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Chế độ kê khai */}
            <div className="flex p-1 bg-gray-100 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setMode('SELF')}
                className={`flex-1 py-1.5 font-bold rounded-lg transition flex items-center justify-center gap-1 ${
                  mode === 'SELF'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <User className="w-3 h-3" /> Chủ đất tự kê khai
              </button>
              <button
                type="button"
                onClick={() => setMode('SURVEYOR')}
                className={`flex-1 py-1.5 font-bold rounded-lg transition flex items-center justify-center gap-1 ${
                  mode === 'SURVEYOR'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Users className="w-3 h-3" /> Cán bộ kê khai thay
              </button>
            </div>

            {/* Thông tin Cán bộ nếu là kê khai hộ */}
            {mode === 'SURVEYOR' && (
              <div className="p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl space-y-2 text-xs">
                <span className="font-bold text-blue-900 block text-[11px]">
                  Cán bộ thực địa:
                </span>
                <div className="space-y-1.5">
                  <input
                    type="text"
                    required
                    value={nguoiKeKhaiTen}
                    onChange={(e) => setNguoiKeKhaiTen(e.target.value)}
                    placeholder="Họ tên cán bộ *"
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="tel"
                    required
                    value={nguoiKeKhaiSdt}
                    onChange={(e) => setNguoiKeKhaiSdt(e.target.value)}
                    placeholder="Số điện thoại cán bộ *"
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            {/* Thông tin chủ đất */}
            <div className="space-y-1.5 text-xs">
              <label className="font-bold text-gray-700 block">Thông tin chủ đất:</label>
              <input
                type="text"
                required
                value={chuDatTen}
                onChange={(e) => setChuDatTen(e.target.value)}
                placeholder="Họ và tên chủ đất *"
                className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                required
                value={chuDatCccd}
                onChange={(e) => setChuDatCccd(e.target.value)}
                placeholder="Số CCCD *"
                className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {mode === 'SELF' && (
                <input
                  type="tel"
                  required
                  value={nguoiKeKhaiSdt}
                  onChange={(e) => setNguoiKeKhaiSdt(e.target.value)}
                  placeholder="Số điện thoại liên hệ *"
                  className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            {/* Đính kèm ảnh */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl bg-white text-center cursor-pointer transition">
                <Upload className="w-4 h-4 mx-auto text-blue-500 mb-0.5" />
                <span className="font-bold text-gray-800 block text-[11px]">Chụp ảnh CCCD</span>
                <span className="text-[10px] text-gray-400">Mặt trước & sau</span>
              </div>
              <div className="p-2.5 border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl bg-white text-center cursor-pointer transition">
                <Upload className="w-4 h-4 mx-auto text-emerald-500 mb-0.5" />
                <span className="font-bold text-gray-800 block text-[11px]">Chụp Sổ đỏ</span>
                <span className="text-[10px] text-gray-400">Nếu đã có giấy</span>
              </div>
            </div>

            {/* Ghi chú */}
            <div>
              <textarea
                rows={2}
                value={ghiChu}
                onChange={(e) => setGhiChu(e.target.value)}
                placeholder="Ghi chú về nguồn gốc đất, hiện trạng sử dụng..."
                className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              ></textarea>
            </div>

            {savedSuccess && (
              <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Đã lưu thông tin kê khai thành công!
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition"
            >
              Lưu phiếu kê khai
            </button>

            {/* TIỆN ÍCH KÊ KHAI NHANH CÁC THỬA TIẾP THEO CÙNG CHỦ HỘ */}
            {otherParcels.length > 0 && (
              <div className="pt-3 border-t border-gray-100 space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-black text-gray-800 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    Thửa tiếp theo cần kê khai ({otherParcels.length} thửa)
                  </h5>
                </div>
                <p className="text-[11px] text-gray-500">
                  Chủ hộ <strong>{parcel.chu_ho}</strong> còn các thửa sau, bấm để chuyển nhanh sang kê khai:
                </p>

                <div className="space-y-1.5">
                  {otherParcels.map((op) => (
                    <button
                      key={op.ma_thua}
                      type="button"
                      onClick={() => onSelectParcel && onSelectParcel(op)}
                      className="w-full p-2.5 bg-blue-50/60 hover:bg-blue-100/70 border border-blue-200 rounded-xl text-left transition flex items-center justify-between gap-2 group"
                    >
                      <div>
                        <div className="font-bold text-xs text-blue-900 group-hover:text-blue-700">
                          Thửa {op.so_thua} • Tờ {op.to_ban_do} ({op.dien_tich ? `${op.dien_tich} m²` : '---'} - {op.loai_dat || 'Đất'})
                        </div>
                        <div className="text-[10px] text-gray-500 capitalize">{op.thon_xa}</div>
                      </div>
                      <span className="text-[11px] font-extrabold text-blue-600 group-hover:translate-x-0.5 transition flex items-center gap-0.5 shrink-0">
                        Kê khai tiếp <ChevronRight className="w-3 h-3" />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
