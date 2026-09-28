'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Download,
  Loader2,
  Camera,
  Trash2,
  AlertTriangle,
  FileEdit,
  Sparkles,
} from 'lucide-react';
import { downloadFile, autoDetectBoundaries, formatBoundaryText } from '@/utils/geo';

interface ParcelDetailPanelProps {
  parcel: Parcel | null;
  neighbors: NeighborParcel[];
  allParcels?: Parcel[];
  sameCccdParcels?: Parcel[];
  sameNameParcels?: Parcel[];
  sameOwnerParcels?: Parcel[];
  onSelectParcel?: (parcel: Parcel) => void;
  onClose: () => void;
  onOpenVectorViewer: (svgUrl: string, title: string, owner?: string, cccd?: string, urls?: string[]) => void;
  onSaveDeclaration: (data: DeclarationFormData) => void;
}

export default function ParcelDetailPanel({
  parcel,
  neighbors,
  allParcels = [],
  sameCccdParcels = [],
  sameNameParcels = [],
  sameOwnerParcels = [],
  onSelectParcel,
  onClose,
  onOpenVectorViewer,
  onSaveDeclaration,
}: ParcelDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'declare' | 'correction'>('info');
  const [mode, setMode] = useState<DeclarationMode>('SELF');
  const [downloadingItem, setDownloadingItem] = useState<string | null>(null);

  // Kiểm tra xem thửa này đã có trên Google Sheets chưa (đã được số hóa)
  const isAlreadyOnGgs = Boolean(parcel?.is_on_ggs || parcel?.trang_thai === 'DA_SO_HOA_XANH');

  // File upload state & refs
  const cccdInputRef = useRef<HTMLInputElement>(null);
  const gcnInputRef = useRef<HTMLInputElement>(null);
  const [cccdUploadedFiles, setCccdUploadedFiles] = useState<{ name: string; url: string }[]>([]);
  const [gcnUploadedFiles, setGcnUploadedFiles] = useState<{ name: string; url: string }[]>([]);

  // 1. Thửa khác cùng chủ CHÍNH XÁC theo CCCD (duy nhất)
  const resolvedSameCccdParcels = useMemo(() => {
    if (sameCccdParcels && sameCccdParcels.length > 0) {
      return sameCccdParcels.filter((p) => p.ma_thua !== parcel?.ma_thua);
    }
    return [];
  }, [sameCccdParcels, parcel]);

  // 2. Thửa khác có cùng Tên (trừ các thửa đã trùng CCCD) - "Có thể chủ hộ này còn sở hữu"
  const resolvedSameNameParcels = useMemo(() => {
    if (sameNameParcels && sameNameParcels.length > 0) {
      return sameNameParcels.filter((p) => p.ma_thua !== parcel?.ma_thua);
    }
    if (sameOwnerParcels && sameOwnerParcels.length > 0) {
      return sameOwnerParcels.filter((p) => p.ma_thua !== parcel?.ma_thua);
    }
    return [];
  }, [sameNameParcels, sameOwnerParcels, parcel]);

  // Lọc chỉ các thửa chưa số hóa để hiển thị trong mục "Thửa tiếp theo cần kê khai"
  const undeclaredSameCccdParcels = useMemo(() => {
    return resolvedSameCccdParcels.filter((p) => !p.is_on_ggs && p.trang_thai !== 'DA_SO_HOA_XANH');
  }, [resolvedSameCccdParcels]);

  const undeclaredSameNameParcels = useMemo(() => {
    return resolvedSameNameParcels.filter((p) => !p.is_on_ggs && p.trang_thai !== 'DA_SO_HOA_XANH');
  }, [resolvedSameNameParcels]);

  // Boundaries state (Tứ cận)
  const [giapDong, setGiapDong] = useState('');
  const [giapTay, setGiapTay] = useState('');
  const [giapNam, setGiapNam] = useState('');
  const [giapBac, setGiapBac] = useState('');

  // Declaration & Correction form state
  const [nguoiKeKhaiTen, setNguoiKeKhaiTen] = useState('');
  const [nguoiKeKhaiSdt, setNguoiKeKhaiSdt] = useState('');
  const [chuDatTen, setChuDatTen] = useState('');
  const [chuDatCccd, setChuDatCccd] = useState('');
  const [ghiChu, setGhiChu] = useState('');
  const [lyDoBaoSai, setLyDoBaoSai] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [correctionSuccess, setCorrectionSuccess] = useState(false);

  // Sync state when parcel changes
  useEffect(() => {
    if (parcel) {
      setGiapDong(parcel.giap_dong || '');
      setGiapTay(parcel.giap_tay || '');
      setGiapNam(parcel.giap_nam || '');
      setGiapBac(parcel.giap_bac || '');
      setChuDatTen(parcel.chu_ho && parcel.chu_ho !== 'Chưa có tên' ? parcel.chu_ho : '');
      setChuDatCccd(parcel.cccd || '');
      setLyDoBaoSai('');
      setSavedSuccess(false);
      setCorrectionSuccess(false);
      setCccdUploadedFiles([]);
      setGcnUploadedFiles([]);

      // Mặc định về tab thông tin khi đổi thửa
      setActiveTab('info');
    }
  }, [parcel?.ma_thua]);

  const handleCccdFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newItems = Array.from(files).map((f) => ({
      name: f.name,
      url: URL.createObjectURL(f),
    }));
    setCccdUploadedFiles((prev) => [...prev, ...newItems]);
  };

  const handleGcnFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newItems = Array.from(files).map((f) => ({
      name: f.name,
      url: URL.createObjectURL(f),
    }));
    setGcnUploadedFiles((prev) => [...prev, ...newItems]);
  };

  const removeCccdFile = (index: number) => {
    setCccdUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeGcnFile = (index: number) => {
    setGcnUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

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

  // Tự động nhận diện Tứ cận (Đông, Tây, Nam, Bắc) dựa trên tọa độ bản đồ
  const detectedBoundaries = useMemo(() => {
    if (!parcel) return {};
    const pool = allParcels && allParcels.length > 0 ? allParcels : neighbors;
    return autoDetectBoundaries(parcel, pool, 500);
  }, [parcel, allParcels, neighbors]);

  const [autoDetectToast, setAutoDetectToast] = useState<string | null>(null);

  const handleAutoDetectBoundaries = () => {
    if (!parcel) return;
    let count = 0;
    if (detectedBoundaries.dong) {
      setGiapDong(formatBoundaryText(detectedBoundaries.dong));
      count++;
    }
    if (detectedBoundaries.tay) {
      setGiapTay(formatBoundaryText(detectedBoundaries.tay));
      count++;
    }
    if (detectedBoundaries.nam) {
      setGiapNam(formatBoundaryText(detectedBoundaries.nam));
      count++;
    }
    if (detectedBoundaries.bac) {
      setGiapBac(formatBoundaryText(detectedBoundaries.bac));
      count++;
    }

    if (count > 0) {
      setAutoDetectToast(`Đã tự động xác định và điền ${count} hướng tiếp giáp từ bản đồ!`);
    } else {
      setAutoDetectToast('Không tìm thấy thửa lân cận trong bán kính quét.');
    }
    setTimeout(() => setAutoDetectToast(null), 3500);
  };

  const handleApplyNeighborToBoundary = (direction: 'dong' | 'tay' | 'nam' | 'bac', neighbor: NeighborParcel) => {
    const text = formatBoundaryText(neighbor);
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
      anh_cccd_truoc: cccdUploadedFiles[0]?.url,
      anh_cccd_sau: cccdUploadedFiles[1]?.url,
      anh_gcn: gcnUploadedFiles[0]?.url,
      ghi_chu: ghiChu,
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleCorrectionSubmit = (e: React.FormEvent) => {
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
      anh_cccd_truoc: cccdUploadedFiles[0]?.url,
      anh_cccd_sau: cccdUploadedFiles[1]?.url,
      anh_gcn: gcnUploadedFiles[0]?.url,
      ghi_chu: `[BÁO SAI / BỔ SUNG THỬA GGS: ${lyDoBaoSai}] ${ghiChu}`.trim(),
      is_correction: true,
      ly_do_sai: lyDoBaoSai,
    });
    setCorrectionSuccess(true);
    setTimeout(() => {
      setCorrectionSuccess(false);
      setActiveTab('info');
    }, 2500);
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
            {resolvedSameCccdParcels.length > 0 ? (
              <>
                <span className="text-gray-300">•</span>
                <span className="text-[10px] font-bold bg-emerald-100/90 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-200 inline-flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  Cùng CCCD: {resolvedSameCccdParcels.length + 1} thửa
                </span>
              </>
            ) : resolvedSameNameParcels.length > 0 ? (
              <>
                <span className="text-gray-300">•</span>
                <span className="text-[10px] font-bold bg-amber-100/90 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200 inline-flex items-center gap-1">
                  <Users className="w-3 h-3 text-amber-600" />
                  Cùng tên: {resolvedSameNameParcels.length + 1} thửa
                </span>
              </>
            ) : null}
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

      {/* Tab Navigation: Nếu thửa đã có trên Google Sheets thì hiện Tab Thông tin & Tab Sai thông tin/Bổ sung */}
      {isAlreadyOnGgs ? (
        <div>
          {/* Banner thửa đã số hóa + Nút bấm nhanh Sai thông tin */}
          <div className="flex items-center justify-between px-3.5 py-2 bg-emerald-50/90 border-b border-emerald-100 text-xs gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-bold text-emerald-950 truncate">
                Đã có trên Google Sheet (Đã số hóa)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'correction' ? 'info' : 'correction')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow-2xs border ${
                activeTab === 'correction'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white hover:bg-amber-50 text-amber-800 border-amber-300'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              {activeTab === 'correction' ? 'Xem thông tin' : 'Sai thông tin?'}
            </button>
          </div>

          {/* Tab bar để người dùng chuyển đổi dễ dàng */}
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
              onClick={() => setActiveTab('correction')}
              className={`py-2 px-3 font-bold text-xs border-b-2 transition flex items-center gap-1.5 ${
                activeTab === 'correction'
                  ? 'border-amber-600 text-amber-700 bg-amber-50/40 font-extrabold'
                  : 'border-transparent text-amber-700 hover:text-amber-900'
              }`}
            >
              <FileEdit className="w-3.5 h-3.5 text-amber-600" />
              Sai thông tin / Bổ sung
            </button>
          </div>
        </div>
      ) : (
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
      )}

      {/* Panel Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {activeTab === 'info' ? (
          <>
            {/* Gợi ý Báo sai thông tin nếu phát hiện sai sót */}
            {isAlreadyOnGgs && (
              <div className="p-2.5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 rounded-xl text-amber-900 text-xs flex items-center justify-between gap-2 shadow-2xs">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="truncate text-[11px] font-medium">Phát hiện thông tin thửa đất có sai sót?</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('correction')}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[11px] shadow-xs transition shrink-0 flex items-center gap-1"
                >
                  <FileEdit className="w-3.5 h-3.5" /> Sai thông tin / Bổ sung
                </button>
              </div>
            )}

            {/* NÚT XEM VÀ TẢI CCCD VÀ GCN QUYỀN SỬ DỤNG ĐẤT */}
            {(parcel.has_cccd || parcel.has_gcn) ? (
              <div className="space-y-2">
                {parcel.has_cccd && (parcel.cccd_url || parcel.svg_url) && (
                  <div className="p-3 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl text-white shadow-md flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ShieldCheck className="w-5 h-5 text-emerald-100 shrink-0" />
                      <div className="min-w-0">
                        <h5 className="text-xs font-black truncate">Hồ sơ CCCD chủ hộ</h5>
                        <p className="text-[11px] text-emerald-100 truncate">Ảnh scan rõ nét</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onOpenVectorViewer(
                            parcel.cccd_url || parcel.svg_url!,
                            `Ảnh CCCD - Thửa ${parcel.so_thua} (Tờ ${parcel.to_ban_do})`,
                            parcel.chu_ho,
                            parcel.cccd
                          )
                        }
                        className="px-2.5 py-1.5 bg-white text-emerald-700 hover:bg-emerald-50 rounded-lg text-xs font-extrabold shadow-sm transition flex items-center gap-1"
                        title="Xem phóng to CCCD"
                      >
                        <Eye className="w-3.5 h-3.5" /> Xem
                      </button>
                      <button
                        type="button"
                        disabled={downloadingItem === 'cccd'}
                        onClick={async () => {
                          setDownloadingItem('cccd');
                          await downloadFile(
                            parcel.cccd_url || parcel.svg_url!,
                            `CCCD_${parcel.chu_ho || 'ChuHo'}_Thua_${parcel.so_thua}_To_${parcel.to_ban_do}.jpg`
                          );
                          setDownloadingItem(null);
                        }}
                        className="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-sm transition flex items-center gap-1 disabled:opacity-50"
                        title="Tải ảnh CCCD về máy"
                      >
                        {downloadingItem === 'cccd' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        Tải về
                      </button>
                    </div>
                  </div>
                )}

                {parcel.has_gcn && parcel.gcn_urls && parcel.gcn_urls.length > 0 && (
                  <div className="p-3 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl text-white shadow-md flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="w-5 h-5 text-blue-100 shrink-0" />
                      <div className="min-w-0">
                        <h5 className="text-xs font-black truncate">Giấy chứng nhận SD đất</h5>
                        <p className="text-[11px] text-blue-100 truncate">{parcel.gcn_urls.length} trang hồ sơ scan</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onOpenVectorViewer(
                            parcel.gcn_urls![0],
                            `Giấy chứng nhận SD đất - Thửa ${parcel.so_thua} (Tờ ${parcel.to_ban_do})`,
                            parcel.chu_ho,
                            parcel.cccd,
                            parcel.gcn_urls
                          )
                        }
                        className="px-2.5 py-1.5 bg-white text-blue-700 hover:bg-blue-50 rounded-lg text-xs font-extrabold shadow-sm transition flex items-center gap-1"
                        title="Xem phóng to GCN"
                      >
                        <Eye className="w-3.5 h-3.5" /> Xem
                      </button>
                      <button
                        type="button"
                        disabled={downloadingItem === 'gcn'}
                        onClick={async () => {
                          setDownloadingItem('gcn');
                          await downloadFile(
                            parcel.gcn_urls![0],
                            `GCN_${parcel.chu_ho || 'ChuHo'}_Thua_${parcel.so_thua}_To_${parcel.to_ban_do}_trang1.jpg`
                          );
                          setDownloadingItem(null);
                        }}
                        className="px-2.5 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-bold shadow-sm transition flex items-center gap-1 disabled:opacity-50"
                        title="Tải ảnh Giấy chứng nhận về máy"
                      >
                        {downloadingItem === 'gcn' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        Tải về
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-600 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-gray-400 shrink-0" />
                  <span>Chưa có tệp scan (CCCD/GCN)</span>
                </div>
                {!isAlreadyOnGgs && (
                  <button
                    onClick={() => setActiveTab('declare')}
                    className="text-[11px] font-bold text-blue-600 hover:underline shrink-0"
                  >
                    Kê khai ngay
                  </button>
                )}
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

            {/* 1. THỬA KHÁC CÙNG CHỦ THEO CCCD (CHÍNH XÁC DUY NHẤT) */}
            {resolvedSameCccdParcels.length > 0 && (
              <div className="bg-gradient-to-br from-emerald-50/90 to-teal-50/70 p-3 rounded-xl border border-emerald-200/90 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-emerald-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Thửa khác cùng chủ ({resolvedSameCccdParcels.length} thửa)
                  </h4>
                  <span className="text-[10px] font-bold text-emerald-800 bg-white px-2 py-0.5 rounded-full border border-emerald-200 shadow-2xs font-mono">
                    CCCD: {parcel.cccd}
                  </span>
                </div>
                <p className="text-[11px] text-emerald-800 leading-snug">
                  Xác thực chính xác theo số CCCD duy nhất. Bấm vào thửa để chuyển nhanh sang xem hoặc kê khai:
                </p>

                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                  {resolvedSameCccdParcels.map((op) => (
                    <div
                      key={op.ma_thua}
                      onClick={() => onSelectParcel && onSelectParcel(op)}
                      className="p-2.5 bg-white hover:bg-emerald-50/60 border border-emerald-100 hover:border-emerald-400 rounded-xl transition cursor-pointer flex items-center justify-between gap-2 shadow-2xs group"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-xs text-gray-900 group-hover:text-emerald-700 transition">
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
                          <span className="font-bold text-emerald-700">{op.dien_tich ? `${op.dien_tich} m²` : '---'}</span>
                          <span>•</span>
                          <span>{op.loai_dat || 'Chưa rõ loại'}</span>
                          <span>•</span>
                          <span className="capitalize">{op.thon_xa}</span>
                        </div>
                      </div>

                      {Boolean(op.is_on_ggs || op.trang_thai === 'DA_SO_HOA_XANH') ? (
                        <button
                          type="button"
                          className="px-2.5 py-1 text-[11px] font-bold bg-emerald-100 text-emerald-800 group-hover:bg-emerald-600 group-hover:text-white rounded-lg transition shrink-0 flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" /> Xem
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="px-2.5 py-1 text-[11px] font-bold bg-emerald-50 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white rounded-lg transition shrink-0 flex items-center gap-0.5"
                        >
                          Kê khai <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. THỬA KHÁC CÓ CÙNG TÊN (TRỪ CCCD) - CÓ THỂ CHỦ HỘ NÀY CÒN SỞ HỮU */}
            {resolvedSameNameParcels.length > 0 && (
              <div className="bg-gradient-to-br from-amber-50/90 to-orange-50/70 p-3 rounded-xl border border-amber-200/90 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-amber-600" />
                    Có thể chủ hộ này còn sở hữu ({resolvedSameNameParcels.length} thửa)
                  </h4>
                  <span className="text-[10px] font-bold text-amber-800 bg-white px-2 py-0.5 rounded-full border border-amber-200 shadow-2xs">
                    {parcel.chu_ho}
                  </span>
                </div>
                <p className="text-[11px] text-amber-800 leading-snug">
                  Trùng họ tên nhưng khác hoặc chưa có số CCCD (có thể là người khác trùng tên). Bấm vào thửa để kiểm tra:
                </p>

                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                  {resolvedSameNameParcels.map((op) => (
                    <div
                      key={op.ma_thua}
                      onClick={() => onSelectParcel && onSelectParcel(op)}
                      className="p-2.5 bg-white hover:bg-amber-50/60 border border-amber-100 hover:border-amber-400 rounded-xl transition cursor-pointer flex items-center justify-between gap-2 shadow-2xs group"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-extrabold text-xs text-gray-900 group-hover:text-amber-800 transition">
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
                          {op.cccd ? (
                            <span className="text-[9px] font-mono font-bold bg-amber-100/90 text-amber-900 px-1.5 py-0.2 rounded border border-amber-200">
                              CCCD: {op.cccd}
                            </span>
                          ) : (
                            <span className="text-[9px] text-gray-400 italic">
                              Chưa có CCCD
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-0.5 truncate">
                          <span className="font-bold text-amber-800">{op.dien_tich ? `${op.dien_tich} m²` : '---'}</span>
                          <span>•</span>
                          <span>{op.loai_dat || 'Chưa rõ loại'}</span>
                          <span>•</span>
                          <span className="capitalize">{op.thon_xa}</span>
                        </div>
                      </div>

                      {Boolean(op.is_on_ggs || op.trang_thai === 'DA_SO_HOA_XANH') ? (
                        <button
                          type="button"
                          className="px-2.5 py-1 text-[11px] font-bold bg-emerald-100 text-emerald-800 group-hover:bg-emerald-600 group-hover:text-white rounded-lg transition shrink-0 flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" /> Xem
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="px-2.5 py-1 text-[11px] font-bold bg-amber-50 text-amber-800 group-hover:bg-amber-600 group-hover:text-white rounded-lg transition shrink-0 flex items-center gap-0.5"
                        >
                          Kê khai <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tứ Cận (Đông, Tây, Nam, Bắc) */}
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200/90 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-black text-gray-800 flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-blue-600" />
                    Tứ cận (Tiếp giáp 4 hướng)
                  </h4>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Tự động phân tích hướng tiếp giáp từ tọa độ vệ tinh thực địa
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAutoDetectBoundaries}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition active:scale-95 shadow-2xs shrink-0"
                  title="Tự động nhận diện 4 thửa tiếp giáp gần nhất theo hướng Đông, Tây, Nam, Bắc"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                  <span>Tự động nhận diện</span>
                </button>
              </div>

              {autoDetectToast && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[11px] font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{autoDetectToast}</span>
                </div>
              )}

              {/* Sơ đồ La bàn trực quan (Compass Mini-Map) */}
              <div className="bg-slate-50/90 p-2.5 rounded-xl border border-slate-200/80">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center mb-1.5 flex items-center justify-center gap-1">
                  <Compass className="w-3 h-3 text-blue-500" /> Sơ đồ vị trí các hướng tiếp giáp
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-center items-center">
                  {/* Hàng 1: Bắc */}
                  <div></div>
                  <div
                    onClick={() => detectedBoundaries.bac && setGiapBac(formatBoundaryText(detectedBoundaries.bac))}
                    className={`p-1.5 rounded-lg border transition cursor-pointer ${
                      detectedBoundaries.bac
                        ? 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-900'
                        : 'bg-gray-100/70 border-gray-200 text-gray-400 cursor-default'
                    }`}
                    title={detectedBoundaries.bac ? `Phía Bắc: ${formatBoundaryText(detectedBoundaries.bac)} (Bấm để điền)` : 'Chưa có thửa'}
                  >
                    <span className="text-[9px] text-blue-700 block font-black">⬆️ PHÍA BẮC</span>
                    <span className="text-[10px] font-bold truncate block">
                      {detectedBoundaries.bac ? `Thửa ${detectedBoundaries.bac.so_thua}` : 'Chưa rõ'}
                    </span>
                  </div>
                  <div></div>

                  {/* Hàng 2: Tây - Thửa đang chọn - Đông */}
                  <div
                    onClick={() => detectedBoundaries.tay && setGiapTay(formatBoundaryText(detectedBoundaries.tay))}
                    className={`p-1.5 rounded-lg border transition cursor-pointer ${
                      detectedBoundaries.tay
                        ? 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-900'
                        : 'bg-gray-100/70 border-gray-200 text-gray-400 cursor-default'
                    }`}
                    title={detectedBoundaries.tay ? `Phía Tây: ${formatBoundaryText(detectedBoundaries.tay)} (Bấm để điền)` : 'Chưa có thửa'}
                  >
                    <span className="text-[9px] text-blue-700 block font-black">⬅️ PHÍA TÂY</span>
                    <span className="text-[10px] font-bold truncate block">
                      {detectedBoundaries.tay ? `Thửa ${detectedBoundaries.tay.so_thua}` : 'Chưa rõ'}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-rose-50 border-2 border-rose-300 font-black text-rose-900 shadow-2xs">
                    <span className="text-[8px] text-rose-600 block uppercase font-black">Đang chọn</span>
                    <span className="text-xs font-black text-rose-700">Thửa {parcel.so_thua}</span>
                  </div>

                  <div
                    onClick={() => detectedBoundaries.dong && setGiapDong(formatBoundaryText(detectedBoundaries.dong))}
                    className={`p-1.5 rounded-lg border transition cursor-pointer ${
                      detectedBoundaries.dong
                        ? 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-900'
                        : 'bg-gray-100/70 border-gray-200 text-gray-400 cursor-default'
                    }`}
                    title={detectedBoundaries.dong ? `Phía Đông: ${formatBoundaryText(detectedBoundaries.dong)} (Bấm để điền)` : 'Chưa có thửa'}
                  >
                    <span className="text-[9px] text-blue-700 block font-black">➡️ PHÍA ĐÔNG</span>
                    <span className="text-[10px] font-bold truncate block">
                      {detectedBoundaries.dong ? `Thửa ${detectedBoundaries.dong.so_thua}` : 'Chưa rõ'}
                    </span>
                  </div>

                  {/* Hàng 3: Nam */}
                  <div></div>
                  <div
                    onClick={() => detectedBoundaries.nam && setGiapNam(formatBoundaryText(detectedBoundaries.nam))}
                    className={`p-1.5 rounded-lg border transition cursor-pointer ${
                      detectedBoundaries.nam
                        ? 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-900'
                        : 'bg-gray-100/70 border-gray-200 text-gray-400 cursor-default'
                    }`}
                    title={detectedBoundaries.nam ? `Phía Nam: ${formatBoundaryText(detectedBoundaries.nam)} (Bấm để điền)` : 'Chưa có thửa'}
                  >
                    <span className="text-[9px] text-blue-700 block font-black">⬇️ PHÍA NAM</span>
                    <span className="text-[10px] font-bold truncate block">
                      {detectedBoundaries.nam ? `Thửa ${detectedBoundaries.nam.so_thua}` : 'Chưa rõ'}
                    </span>
                  </div>
                  <div></div>
                </div>
              </div>

              {/* 4 Ô Nhập Tứ Cận với Gợi Ý Tự Động */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {/* Phía Đông */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-gray-700 flex items-center gap-1">
                      <span>➡️</span> Phía Đông:
                    </label>
                    {detectedBoundaries.dong && !giapDong && (
                      <button
                        type="button"
                        onClick={() => setGiapDong(formatBoundaryText(detectedBoundaries.dong))}
                        className="text-[10px] text-blue-600 hover:underline font-semibold"
                      >
                        Gợi ý: Thửa {detectedBoundaries.dong.so_thua} (+Điền)
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={giapDong}
                    onChange={(e) => setGiapDong(e.target.value)}
                    placeholder="Giáp thửa/đường/suối..."
                    className="w-full text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Phía Tây */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-gray-700 flex items-center gap-1">
                      <span>⬅️</span> Phía Tây:
                    </label>
                    {detectedBoundaries.tay && !giapTay && (
                      <button
                        type="button"
                        onClick={() => setGiapTay(formatBoundaryText(detectedBoundaries.tay))}
                        className="text-[10px] text-blue-600 hover:underline font-semibold"
                      >
                        Gợi ý: Thửa {detectedBoundaries.tay.so_thua} (+Điền)
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={giapTay}
                    onChange={(e) => setGiapTay(e.target.value)}
                    placeholder="Giáp thửa/đường/suối..."
                    className="w-full text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Phía Nam */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-gray-700 flex items-center gap-1">
                      <span>⬇️</span> Phía Nam:
                    </label>
                    {detectedBoundaries.nam && !giapNam && (
                      <button
                        type="button"
                        onClick={() => setGiapNam(formatBoundaryText(detectedBoundaries.nam))}
                        className="text-[10px] text-blue-600 hover:underline font-semibold"
                      >
                        Gợi ý: Thửa {detectedBoundaries.nam.so_thua} (+Điền)
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={giapNam}
                    onChange={(e) => setGiapNam(e.target.value)}
                    placeholder="Giáp thửa/đường/suối..."
                    className="w-full text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Phía Bắc */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-gray-700 flex items-center gap-1">
                      <span>⬆️</span> Phía Bắc:
                    </label>
                    {detectedBoundaries.bac && !giapBac && (
                      <button
                        type="button"
                        onClick={() => setGiapBac(formatBoundaryText(detectedBoundaries.bac))}
                        className="text-[10px] text-blue-600 hover:underline font-semibold"
                      >
                        Gợi ý: Thửa {detectedBoundaries.bac.so_thua} (+Điền)
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={giapBac}
                    onChange={(e) => setGiapBac(e.target.value)}
                    placeholder="Giáp thửa/đường/suối..."
                    className="w-full text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Thửa Lân Cận Theo Phương Hướng Bản Đồ */}
            <div className="bg-white p-3 rounded-xl border border-gray-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1">
                  <Navigation className="w-3.5 h-3.5 text-emerald-600" />
                  Thửa xung quanh theo phương hướng
                </h4>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                  {neighbors.length} thửa
                </span>
              </div>

              {neighbors.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-2.5 text-center">
                  Không có thửa liền kề xung quanh trong bán kính quét.
                </p>
              ) : (
                <div className="divide-y divide-gray-100 max-h-56 overflow-y-auto pr-1">
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
                      <div key={nb.ma_thua} className="py-2.5 space-y-1.5">
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

                          {/* Badge Phương Hướng & Khoảng cách */}
                          <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-md font-semibold flex items-center gap-1 shrink-0">
                            <span>{nb.arrow || '🧭'}</span>
                            <span>{nb.directionText || nb.quadrantText || 'Lân cận'}</span>
                            <span className="text-gray-300">|</span>
                            <span className="font-mono">~{nb.distanceMeters}m</span>
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-600 truncate" title={nb.chu_ho}>
                          Chủ: <strong className="text-gray-800">{nb.chu_ho || 'Chưa có tên'}</strong>
                        </p>

                        <div className="flex items-center justify-between pt-0.5">
                          {(nb.has_cccd && (nb.cccd_url || nb.svg_url)) ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() =>
                                  onOpenVectorViewer(
                                    (nb.cccd_url || nb.svg_url)!,
                                    `Ảnh CCCD - Thửa ${nb.so_thua} (Tờ ${nb.to_ban_do})`,
                                    nb.chu_ho,
                                    nb.cccd
                                  )
                                }
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 hover:underline"
                              >
                                <Eye className="w-3 h-3" /> Xem
                              </button>
                              <button
                                onClick={() =>
                                  downloadFile(
                                    (nb.cccd_url || nb.svg_url)!,
                                    `CCCD_${nb.chu_ho || 'ChuHo'}_Thua_${nb.so_thua}_To_${nb.to_ban_do}.jpg`
                                  )
                                }
                                className="inline-flex items-center gap-0.5 text-[10px] font-bold text-gray-500 hover:text-emerald-700"
                                title="Tải ảnh CCCD"
                              >
                                <Download className="w-3 h-3" /> Tải
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-400 italic">Chưa có ảnh CCCD</span>
                          )}

                          {/* Cụm hành động điền vào hướng */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleApplyNeighborToBoundary(nb.quadrant || 'dong', nb)}
                              className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded font-bold transition flex items-center gap-1 shadow-2xs"
                              title={`Điền thửa này vào ${nb.quadrantText || 'Phía Đông'}`}
                            >
                              <span>{nb.arrow}</span> Điền {nb.quadrantText || 'Phía Đông'}
                            </button>

                            {/* Các nút phụ đổi hướng */}
                            <span className="text-[9px] text-gray-400 ml-1">Đổi:</span>
                            {(['dong', 'tay', 'nam', 'bac'] as const)
                              .filter((q) => q !== (nb.quadrant || 'dong'))
                              .map((q) => (
                                <button
                                  key={q}
                                  type="button"
                                  onClick={() => handleApplyNeighborToBoundary(q, nb)}
                                  className="px-1 text-[9px] bg-gray-100 hover:bg-gray-200 text-gray-600 rounded font-medium uppercase"
                                  title={`Điền vào ${q === 'dong' ? 'Đông' : q === 'tay' ? 'Tây' : q === 'nam' ? 'Nam' : 'Bắc'}`}
                                >
                                  {q === 'dong' ? 'Đ' : q === 'tay' ? 'T' : q === 'nam' ? 'N' : 'B'}
                                </button>
                              ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : activeTab === 'correction' ? (
          /* Phiếu Báo Sai & Bổ Sung Thông Tin Thửa Đã Số Hóa */
          <form onSubmit={handleCorrectionSubmit} className="space-y-3.5 animate-in fade-in duration-200">
            {/* Callout hướng dẫn */}
            <div className="p-3 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl space-y-1.5 text-xs text-amber-950">
              <div className="flex items-center gap-2 font-black text-amber-900 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Báo sai lệch & Bổ sung thông tin thửa đất</span>
              </div>
              <p className="text-[11px] text-amber-900 leading-snug">
                Thửa <strong className="font-extrabold text-blue-700">{parcel.so_thua}</strong> (Tờ <strong className="font-extrabold text-blue-700">{parcel.to_ban_do}</strong>) đã được số hóa trên Google Sheets. Nếu thông tin bị sai (tên chủ, CCCD, tứ cận, diện tích) hoặc cần bổ sung giấy tờ mới, vui lòng điền nội dung bên dưới:
              </p>
            </div>

            {/* Ô nhập nội dung sai lệch cụ thể */}
            <div className="space-y-1 text-xs">
              <label className="font-bold text-gray-800 flex items-center justify-between">
                <span>Nội dung sai lệch cần điều chỉnh / bổ sung <span className="text-red-500">*</span></span>
              </label>
              <textarea
                rows={2}
                required
                value={lyDoBaoSai}
                onChange={(e) => setLyDoBaoSai(e.target.value)}
                placeholder="VD: Tên đúng là Trần Văn B chứ không phải A; Số CCCD đúng là 0600...; hoặc Cần bổ sung trang 2 Sổ đỏ..."
                className="w-full text-xs px-2.5 py-1.5 border border-amber-300 rounded-lg bg-amber-50/20 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
              />
            </div>

            {/* Chế độ phản ánh */}
            <div className="flex p-1 bg-gray-100 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setMode('SELF')}
                className={`flex-1 py-1.5 font-bold rounded-lg transition flex items-center justify-center gap-1 ${
                  mode === 'SELF'
                    ? 'bg-white text-amber-800 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <User className="w-3 h-3" /> Chủ đất báo sai
              </button>
              <button
                type="button"
                onClick={() => setMode('SURVEYOR')}
                className={`flex-1 py-1.5 font-bold rounded-lg transition flex items-center justify-center gap-1 ${
                  mode === 'SURVEYOR'
                    ? 'bg-white text-amber-800 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Users className="w-3 h-3" /> Cán bộ khảo sát
              </button>
            </div>

            {/* Người gửi phản ánh */}
            {mode === 'SURVEYOR' ? (
              <div className="p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl space-y-2 text-xs">
                <span className="font-bold text-blue-900 block text-[11px]">
                  Cán bộ thực địa ghi nhận:
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
            ) : (
              <div className="space-y-1 text-xs">
                <label className="font-bold text-gray-700 block">Số điện thoại liên hệ của chủ hộ:</label>
                <input
                  type="tel"
                  required
                  value={nguoiKeKhaiSdt}
                  onChange={(e) => setNguoiKeKhaiSdt(e.target.value)}
                  placeholder="Nhập số điện thoại để liên hệ xác minh *"
                  className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            )}

            {/* Thông tin chuẩn xác đề xuất cập nhật */}
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2 text-xs">
              <span className="font-bold text-gray-900 block text-[11px]">
                Thông tin chuẩn xác đề xuất cập nhật:
              </span>
              <div className="space-y-1.5">
                <div>
                  <label className="text-[10px] text-gray-500 block mb-0.5">Họ và tên chủ đất chuẩn:</label>
                  <input
                    type="text"
                    required
                    value={chuDatTen}
                    onChange={(e) => setChuDatTen(e.target.value)}
                    placeholder="Họ và tên chủ đất chuẩn *"
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block mb-0.5">Số CCCD chuẩn:</label>
                  <input
                    type="text"
                    value={chuDatCccd}
                    onChange={(e) => setChuDatCccd(e.target.value)}
                    placeholder="Số CCCD chuẩn"
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>

            {/* Tứ cận cập nhật nếu có sai lệch */}
            <div className="bg-white p-3 rounded-xl border border-gray-200 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-800 block text-[11px]">
                  Tứ cận chuẩn xác (nếu cần sửa):
                </span>
                <button
                  type="button"
                  onClick={handleAutoDetectBoundaries}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-lg transition"
                  title="Tự động nhận diện 4 hướng tiếp giáp từ tọa độ thực địa"
                >
                  <Sparkles className="w-3 h-3 text-amber-500 fill-amber-400" />
                  <span>Tự động nhận diện</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[10px] text-gray-500 block">Đông:</label>
                  <input
                    type="text"
                    value={giapDong}
                    onChange={(e) => setGiapDong(e.target.value)}
                    placeholder="Giáp..."
                    className="w-full text-xs px-2 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">Tây:</label>
                  <input
                    type="text"
                    value={giapTay}
                    onChange={(e) => setGiapTay(e.target.value)}
                    placeholder="Giáp..."
                    className="w-full text-xs px-2 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">Nam:</label>
                  <input
                    type="text"
                    value={giapNam}
                    onChange={(e) => setGiapNam(e.target.value)}
                    placeholder="Giáp..."
                    className="w-full text-xs px-2 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">Bắc:</label>
                  <input
                    type="text"
                    value={giapBac}
                    onChange={(e) => setGiapBac(e.target.value)}
                    placeholder="Giáp..."
                    className="w-full text-xs px-2 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>

            {/* Chụp / Tải ảnh bổ sung để chứng minh */}
            <div className="space-y-2 text-xs">
              <span className="font-bold text-gray-800 block text-[11px]">
                Chụp / Tải ảnh hồ sơ bổ sung (CCCD / Giấy chứng nhận):
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => cccdInputRef.current?.click()}
                  className="p-2.5 border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50/30 rounded-xl bg-white text-center cursor-pointer transition select-none flex flex-col items-center justify-center"
                >
                  <Upload className="w-4 h-4 text-blue-500 mb-0.5" />
                  <span className="font-bold text-gray-800 block text-[11px]">Chụp/Tải CCCD mới</span>
                  <span className="text-[10px] text-gray-400">
                    {cccdUploadedFiles.length > 0 ? `Đã chọn ${cccdUploadedFiles.length} ảnh` : 'Bổ sung CCCD'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => gcnInputRef.current?.click()}
                  className="p-2.5 border-2 border-dashed border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/30 rounded-xl bg-white text-center cursor-pointer transition select-none flex flex-col items-center justify-center"
                >
                  <Upload className="w-4 h-4 text-emerald-500 mb-0.5" />
                  <span className="font-bold text-gray-800 block text-[11px]">Chụp/Tải Sổ đỏ mới</span>
                  <span className="text-[10px] text-gray-400">
                    {gcnUploadedFiles.length > 0 ? `Đã chọn ${gcnUploadedFiles.length} ảnh` : 'Bổ sung giấy tờ'}
                  </span>
                </button>
              </div>

              {/* Previews */}
              {cccdUploadedFiles.length > 0 && (
                <div className="p-2 bg-blue-50/60 rounded-lg space-y-1">
                  <span className="text-[10px] font-bold text-blue-900 block">Ảnh CCCD bổ sung:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {cccdUploadedFiles.map((file, idx) => (
                      <div key={idx} className="relative group w-14 h-14 rounded-lg overflow-hidden border border-blue-200">
                        <img src={file.url} alt="CCCD" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeCccdFile(idx)}
                          className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                          title="Xóa ảnh này"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {gcnUploadedFiles.length > 0 && (
                <div className="p-2 bg-emerald-50/60 rounded-lg space-y-1">
                  <span className="text-[10px] font-bold text-emerald-900 block">Ảnh Sổ đỏ bổ sung:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {gcnUploadedFiles.map((file, idx) => (
                      <div key={idx} className="relative group w-14 h-14 rounded-lg overflow-hidden border border-emerald-200">
                        <img src={file.url} alt="GCN" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeGcnFile(idx)}
                          className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                          title="Xóa ảnh này"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Ghi chú thêm */}
            <div>
              <textarea
                rows={2}
                value={ghiChu}
                onChange={(e) => setGhiChu(e.target.value)}
                placeholder="Ghi chú thêm về nguồn gốc, tranh chấp hoặc thông tin khác..."
                className="w-full text-xs px-2.5 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {correctionSuccess && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-1.5 font-bold animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                Đã ghi nhận báo sai & bổ sung thành công! Dữ liệu đã được lưu lại.
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setActiveTab('info')}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition"
              >
                Hủy / Quay lại
              </button>
              <button
                type="submit"
                className="flex-2 py-2 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                Gửi báo sai & Bổ sung
              </button>
            </div>
          </form>
        ) : (
          /* Phiếu Kê Khai (Tab 2 cho thửa chưa số hóa) */
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

            {/* Hidden file inputs for upload/photo capture */}
            <input
              type="file"
              ref={cccdInputRef}
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleCccdFileSelect}
            />
            <input
              type="file"
              ref={gcnInputRef}
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleGcnFileSelect}
            />

            {/* Đính kèm ảnh CCCD & GCN */}
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => cccdInputRef.current?.click()}
                  className="p-2.5 border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50/30 rounded-xl bg-white text-center cursor-pointer transition select-none flex flex-col items-center justify-center"
                >
                  <Upload className="w-4 h-4 text-blue-500 mb-0.5" />
                  <span className="font-bold text-gray-800 block text-[11px]">Chụp / Tải CCCD</span>
                  <span className="text-[10px] text-gray-400">
                    {cccdUploadedFiles.length > 0 ? `Đã chọn ${cccdUploadedFiles.length} ảnh` : 'Mặt trước & sau'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => gcnInputRef.current?.click()}
                  className="p-2.5 border-2 border-dashed border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/30 rounded-xl bg-white text-center cursor-pointer transition select-none flex flex-col items-center justify-center"
                >
                  <Upload className="w-4 h-4 text-emerald-500 mb-0.5" />
                  <span className="font-bold text-gray-800 block text-[11px]">Chụp / Tải Sổ đỏ</span>
                  <span className="text-[10px] text-gray-400">
                    {gcnUploadedFiles.length > 0 ? `Đã chọn ${gcnUploadedFiles.length} ảnh` : 'Nếu đã có giấy'}
                  </span>
                </button>
              </div>

              {/* Danh sách ảnh CCCD đã chọn */}
              {cccdUploadedFiles.length > 0 && (
                <div className="p-2 bg-blue-50/60 rounded-lg space-y-1">
                  <span className="text-[10px] font-bold text-blue-900 block">Ảnh CCCD đã chọn:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {cccdUploadedFiles.map((file, idx) => (
                      <div key={idx} className="relative group w-14 h-14 rounded-lg overflow-hidden border border-blue-200">
                        <img src={file.url} alt="CCCD" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeCccdFile(idx)}
                          className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                          title="Xóa ảnh này"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Danh sách ảnh GCN đã chọn */}
              {gcnUploadedFiles.length > 0 && (
                <div className="p-2 bg-emerald-50/60 rounded-lg space-y-1">
                  <span className="text-[10px] font-bold text-emerald-900 block">Ảnh Sổ đỏ đã chọn:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {gcnUploadedFiles.map((file, idx) => (
                      <div key={idx} className="relative group w-14 h-14 rounded-lg overflow-hidden border border-emerald-200">
                        <img src={file.url} alt="GCN" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeGcnFile(idx)}
                          className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                          title="Xóa ảnh này"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Tứ Cận (Đông, Tây, Nam, Bắc) */}
            <div className="bg-gray-50/80 p-2.5 rounded-xl border border-gray-200 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-800 block text-[11px] flex items-center gap-1">
                  <Compass className="w-3.5 h-3.5 text-blue-600" />
                  Tứ cận (Tiếp giáp 4 hướng):
                </span>
                <button
                  type="button"
                  onClick={handleAutoDetectBoundaries}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-100/70 hover:bg-blue-200/80 px-2 py-0.5 rounded-lg transition"
                  title="Tự động nhận diện 4 hướng tiếp giáp từ tọa độ thực địa"
                >
                  <Sparkles className="w-3 h-3 text-amber-500 fill-amber-400" />
                  <span>Tự động nhận diện</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[10px] text-gray-500 block">Đông:</label>
                  <input
                    type="text"
                    value={giapDong}
                    onChange={(e) => setGiapDong(e.target.value)}
                    placeholder="Giáp thửa/đường..."
                    className="w-full text-xs px-2 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">Tây:</label>
                  <input
                    type="text"
                    value={giapTay}
                    onChange={(e) => setGiapTay(e.target.value)}
                    placeholder="Giáp thửa/đường..."
                    className="w-full text-xs px-2 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">Nam:</label>
                  <input
                    type="text"
                    value={giapNam}
                    onChange={(e) => setGiapNam(e.target.value)}
                    placeholder="Giáp thửa/đường..."
                    className="w-full text-xs px-2 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">Bắc:</label>
                  <input
                    type="text"
                    value={giapBac}
                    onChange={(e) => setGiapBac(e.target.value)}
                    placeholder="Giáp thửa/đường..."
                    className="w-full text-xs px-2 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
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

            {/* TIỆN ÍCH KÊ KHAI NHANH CÁC THỬA TIẾP THEO (Chỉ các thửa chưa số hóa) */}
            {(undeclaredSameCccdParcels.length > 0 || undeclaredSameNameParcels.length > 0) && (
              <div className="pt-3 border-t border-gray-100 space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-black text-gray-800 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    Thửa tiếp theo cần kê khai ({undeclaredSameCccdParcels.length + undeclaredSameNameParcels.length} thửa)
                  </h5>
                </div>
                <p className="text-[11px] text-gray-500">
                  Bấm vào thửa để chuyển nhanh sang kê khai:
                </p>

                <div className="space-y-1.5">
                  {/* Nhóm cùng CCCD chưa số hóa */}
                  {undeclaredSameCccdParcels.map((op) => (
                    <button
                      key={op.ma_thua}
                      type="button"
                      onClick={() => onSelectParcel && onSelectParcel(op)}
                      className="w-full p-2.5 bg-emerald-50/60 hover:bg-emerald-100/70 border border-emerald-200 rounded-xl text-left transition flex items-center justify-between gap-2 group"
                    >
                      <div>
                        <div className="font-bold text-xs text-emerald-950 flex items-center gap-1.5">
                          <span>Thửa {op.so_thua} • Tờ {op.to_ban_do}</span>
                          <span className="text-[9px] font-bold bg-emerald-200 text-emerald-800 px-1 py-0.2 rounded">
                            Cùng CCCD
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-500 capitalize mt-0.5">
                          {op.dien_tich ? `${op.dien_tich} m²` : '---'} • {op.loai_dat || 'Đất'} • {op.thon_xa}
                        </div>
                      </div>
                      <span className="text-[11px] font-extrabold text-emerald-700 group-hover:translate-x-0.5 transition flex items-center gap-0.5 shrink-0">
                        Kê khai <ChevronRight className="w-3 h-3" />
                      </span>
                    </button>
                  ))}

                  {/* Nhóm cùng Tên chưa số hóa */}
                  {undeclaredSameNameParcels.map((op) => (
                    <button
                      key={op.ma_thua}
                      type="button"
                      onClick={() => onSelectParcel && onSelectParcel(op)}
                      className="w-full p-2.5 bg-amber-50/60 hover:bg-amber-100/70 border border-amber-200 rounded-xl text-left transition flex items-center justify-between gap-2 group"
                    >
                      <div>
                        <div className="font-bold text-xs text-amber-950 flex items-center gap-1.5">
                          <span>Thửa {op.so_thua} • Tờ {op.to_ban_do}</span>
                          <span className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1 py-0.2 rounded">
                            Cùng tên
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-500 capitalize mt-0.5">
                          {op.dien_tich ? `${op.dien_tich} m²` : '---'} • {op.loai_dat || 'Đất'} • {op.thon_xa}
                        </div>
                      </div>
                      <span className="text-[11px] font-extrabold text-amber-800 group-hover:translate-x-0.5 transition flex items-center gap-0.5 shrink-0">
                        Kê khai <ChevronRight className="w-3 h-3" />
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
