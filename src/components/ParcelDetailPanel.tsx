'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Parcel, NeighborParcel, DeclarationMode, DeclarationFormData } from '@/types';
import {
  X,
  MapPin,
  ExternalLink,
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
  ChevronLeft,
  ChevronDown,
  Download,
  Loader2,
  Camera,
  Trash2,
  AlertTriangle,
  FileEdit,
  Sparkles,
  Crop,
  RotateCw,
  Plus,
  ListPlus,
  Save,
} from 'lucide-react';
import { downloadFile, autoDetectBoundaries, formatBoundaryText } from '@/utils/geo';
import CccdImageEditorModal from '@/components/CccdImageEditorModal';
import { AdditionalParcel } from '@/types';

interface ParcelDetailPanelProps {
  parcel: Parcel | null;
  neighbors: NeighborParcel[];
  allParcels?: Parcel[];
  sameCccdParcels?: Parcel[];
  sameNameParcels?: Parcel[];
  sameOwnerParcels?: Parcel[];
  additionalParcels?: AdditionalParcel[];
  isPickingAdditional?: boolean;
  onStartPickAdditional?: () => void;
  onAddAdditionalParcel?: (parcel: Parcel) => void;
  onRemoveAdditionalParcel?: (maThua: string) => void;
  onSelectParcel?: (parcel: Parcel) => void;
  onClose: () => void;
  onOpenVectorViewer: (svgUrl: string, title: string, owner?: string, cccd?: string, urls?: string[]) => void;
  onSaveDeclaration: (data: DeclarationFormData) => void;
  onDeleteDeclaration?: (maThua: string) => void;
  currentDeclaration?: DeclarationFormData | any;
  userLocation?: { lat: number; lng: number; accuracy: number } | null;
  onToggleLocation?: () => void;
  onToggleCollapse?: () => void;
}

export default function ParcelDetailPanel({
  parcel,
  neighbors,
  allParcels = [],
  sameCccdParcels = [],
  sameNameParcels = [],
  sameOwnerParcels = [],
  additionalParcels = [],
  isPickingAdditional = false,
  onStartPickAdditional,
  onAddAdditionalParcel,
  onRemoveAdditionalParcel,
  onSelectParcel,
  onClose,
  onOpenVectorViewer,
  onSaveDeclaration,
  onDeleteDeclaration,
  currentDeclaration,
  userLocation,
  onToggleLocation,
  onToggleCollapse,
}: ParcelDetailPanelProps) {

  const [activeTab, setActiveTab] = useState<'info' | 'declare' | 'correction'>('info');
  const [mode, setMode] = useState<DeclarationMode>('SELF');
  const [downloadingItem, setDownloadingItem] = useState<string | null>(null);



  // Kiểm tra xem thửa này đã có trên Google Sheets chưa (đã được số hóa)
  const isAlreadyOnGgs = Boolean(parcel?.is_on_ggs || parcel?.trang_thai === 'DA_SO_HOA_XANH');

  // File upload state & refs
  const cccdInputRef = useRef<HTMLInputElement>(null);
  const gcnInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [cccdUploadedFiles, setCccdUploadedFiles] = useState<{ name: string; url: string }[]>([]);
  const [gcnUploadedFiles, setGcnUploadedFiles] = useState<{ name: string; url: string }[]>([]);

  const handleNeighborClick = (nb: NeighborParcel) => {
    if (onSelectParcel) {
      onSelectParcel(nb);
    }
    setTimeout(() => {
      contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  // 1. Thửa khác cùng chủ CHÍNH XÁC theo CCCD (duy nhất) - Loại bỏ thửa chính và các thửa đã chọn gộp
  const resolvedSameCccdParcels = useMemo(() => {
    const additionalCodes = new Set((additionalParcels || []).map((ap) => ap.ma_thua));
    if (sameCccdParcels && sameCccdParcels.length > 0) {
      return sameCccdParcels.filter(
        (p) => p.ma_thua !== parcel?.ma_thua && !additionalCodes.has(p.ma_thua)
      );
    }
    return [];
  }, [sameCccdParcels, parcel, additionalParcels]);

  // 2. Thửa khác có cùng Tên (trừ các thửa đã trùng CCCD) - "Có thể chủ hộ này còn sở hữu" - Loại bỏ các thửa đã chọn gộp
  const resolvedSameNameParcels = useMemo(() => {
    const additionalCodes = new Set((additionalParcels || []).map((ap) => ap.ma_thua));
    const filterFn = (p: Parcel) => p.ma_thua !== parcel?.ma_thua && !additionalCodes.has(p.ma_thua);

    if (sameNameParcels && sameNameParcels.length > 0) {
      return sameNameParcels.filter(filterFn);
    }
    if (sameOwnerParcels && sameOwnerParcels.length > 0) {
      return sameOwnerParcels.filter(filterFn);
    }
    return [];
  }, [sameNameParcels, sameOwnerParcels, parcel, additionalParcels]);

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

  // CCCD Image Editor State
  const [isCccdEditorOpen, setIsCccdEditorOpen] = useState(false);
  const [editingCccdIndex, setEditingCccdIndex] = useState<number>(0);
  const [editingImageUrl, setEditingImageUrl] = useState<string>('');

  const handleOpenCccdEditor = (index: number) => {
    if (cccdUploadedFiles[index]) {
      setEditingCccdIndex(index);
      setEditingImageUrl(cccdUploadedFiles[index].url);
      setIsCccdEditorOpen(true);
    }
  };

  const handleSaveEditedCccd = (newUrl: string) => {
    setCccdUploadedFiles((prev) => {
      const copy = [...prev];
      if (copy[editingCccdIndex]) {
        copy[editingCccdIndex] = { ...copy[editingCccdIndex], url: newUrl };
      }
      return copy;
    });
  };

  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

  // Sync state when parcel or currentDeclaration changes
  useEffect(() => {
    if (parcel) {
      if (currentDeclaration) {
        setMode(currentDeclaration.mode || 'SELF');
        setNguoiKeKhaiTen(currentDeclaration.nguoi_ke_khai_ten || '');
        setNguoiKeKhaiSdt(currentDeclaration.nguoi_ke_khai_sdt || '');
        setChuDatTen(currentDeclaration.chu_dat_ten || parcel.chu_ho || '');
        setChuDatCccd(currentDeclaration.chu_dat_cccd || parcel.cccd || '');
        setGiapDong(currentDeclaration.giap_dong || parcel.giap_dong || '');
        setGiapTay(currentDeclaration.giap_tay || parcel.giap_tay || '');
        setGiapNam(currentDeclaration.giap_nam || parcel.giap_nam || '');
        setGiapBac(currentDeclaration.giap_bac || parcel.giap_bac || '');
        setGhiChu(currentDeclaration.ghi_chu || '');
      } else {
        setMode('SELF');
        setNguoiKeKhaiTen('');
        setNguoiKeKhaiSdt('');
        setGiapDong(parcel.giap_dong || '');
        setGiapTay(parcel.giap_tay || '');
        setGiapNam(parcel.giap_nam || '');
        setGiapBac(parcel.giap_bac || '');
        setGhiChu('');
        const nonPersonPlaceholders = [
          'chưa có tên',
          'không có tên',
          'không có dữ liệu',
          'không có dữ liệu cập nhật',
          'không có trong dữ liệu',
          'không có trong smk',
          'hồ ea rớt',
          'ubnd xã',
          'ông ..',
          '..',
        ];
        const isPlaceholder = nonPersonPlaceholders.some((ph) => parcel.chu_ho?.toLowerCase().includes(ph));
        setChuDatTen(parcel.chu_ho && !isPlaceholder ? parcel.chu_ho : '');
        setChuDatCccd(parcel.cccd || '');
      }
      setLyDoBaoSai('');
      setSavedSuccess(false);
      setCorrectionSuccess(false);
      setCccdUploadedFiles([]);
      setGcnUploadedFiles([]);
      setIsConfirmDeleteOpen(false);

      // Mặc định về tab thông tin khi đổi thửa
      setActiveTab('info');

      // Tự động cuộn lên đầu panel khi chọn hoặc đổi sang thửa mới
      contentRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [parcel?.ma_thua, currentDeclaration]);

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
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> 🟢 Đã số hóa (GGS)
          </span>
        );
      case 'DA_KE_KHAI_CHUA_SO_HOA_LAM':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 rounded-full border border-blue-200 inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span> 🔵 Đã kê khai (Chưa lên GGS)
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
      thua_kem_theo: additionalParcels,
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

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Nút mũi tên thu gọn: máy tính thu qua trái, điện thoại thu xuống dưới */}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50/80 rounded-xl transition border border-gray-200/80 shadow-2xs cursor-pointer flex items-center justify-center"
              title="Thu gọn bảng chi tiết để xem bản đồ"
            >
              <ChevronLeft className="w-4 h-4 hidden lg:block" />
              <ChevronDown className="w-4 h-4 block lg:hidden" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 rounded-xl transition cursor-pointer"
            title="Đóng bảng chi tiết"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Navigation: Thiết kế gọn gàng, đồng bộ */}
      <div className="flex border-b border-gray-100 bg-white px-3">
        <button
          onClick={() => setActiveTab('info')}
          className={`py-2 px-3 font-bold text-xs border-b-2 transition ${
            activeTab === 'info'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Thông tin thửa đất
        </button>
        {isAlreadyOnGgs ? (
          <button
            onClick={() => setActiveTab('correction')}
            className={`py-2 px-3 font-medium text-xs border-b-2 transition flex items-center gap-1 ${
              activeTab === 'correction'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-700'
            }`}
          >
            <FileEdit className="w-3.5 h-3.5" />
            Bổ sung / Báo sai
          </button>
        ) : (
          <button
            onClick={() => setActiveTab('declare')}
            className={`py-2 px-3 font-bold text-xs border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'declare'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Phiếu kê khai</span>
            {Boolean(currentDeclaration || parcel.is_declared) && (
              <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" title="Đã có phiếu kê khai" />
            )}
          </button>
        )}
      </div>

      {/* Panel Scrollable Body */}
      <div ref={contentRef} className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {activeTab === 'info' ? (
          <>
            {/* THÔNG BÁO VÀ THAO TÁC SỬA / XÓA NẾU THỬA ĐÃ ĐƯỢC KÊ KHAI */}
            {Boolean(currentDeclaration || parcel.is_declared) && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-blue-900 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-blue-600" />
                    Thửa đất đã lập phiếu kê khai thực địa
                  </span>
                  <span className="text-[10px] font-bold bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">
                    Đã kê khai
                  </span>
                </div>
                <div className="text-[11px] text-gray-600 space-y-0.5">
                  <p>
                    Chủ hộ kê khai: <strong className="text-gray-900">{currentDeclaration?.chu_dat_ten || parcel.chu_ho}</strong>
                    {Boolean(currentDeclaration?.chu_dat_cccd || parcel.cccd) && (
                      <span> • CCCD: <strong className="font-mono text-gray-900">{currentDeclaration?.chu_dat_cccd || parcel.cccd}</strong></span>
                    )}
                  </p>
                  {Boolean(currentDeclaration?.thua_kem_theo?.length) && (
                    <p className="text-amber-800 font-medium">
                      Gộp chung {currentDeclaration.thua_kem_theo.length} thửa kèm theo
                    </p>
                  )}
                </div>
                <div className="pt-1.5 flex items-center gap-2 border-t border-blue-100">
                  <button
                    type="button"
                    onClick={() => setActiveTab('declare')}
                    className="flex-1 py-1.5 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] transition flex items-center justify-center gap-1 cursor-pointer shadow-xs"
                  >
                    <FileEdit className="w-3.5 h-3.5" /> Sửa thông tin phiếu
                  </button>
                  {onDeleteDeclaration && (
                    <button
                      type="button"
                      onClick={() => setIsConfirmDeleteOpen(true)}
                      className="py-1.5 px-2.5 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 rounded-lg font-bold text-[11px] transition flex items-center gap-1 cursor-pointer"
                      title="Xóa phiếu kê khai này"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Xóa phiếu
                    </button>
                  )}
                </div>
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
                          ) : op.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-100 text-blue-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span> Đã kê khai
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
                          ) : op.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-100 text-blue-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span> Đã kê khai
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

            {/* Thửa lân cận */}
            <div className="bg-white p-3 rounded-xl border border-gray-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-blue-500" />
                  Thửa xung quanh
                </h4>
                <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-semibold">
                  {neighbors.length} thửa gần nhất
                </span>
              </div>

              {neighbors.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-2 text-center italic">
                  Không có thửa nào trong bán kính quét.
                </p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {neighbors.map((nb) => {
                    const statusDot = nb.trang_thai === 'DA_SO_HOA_XANH'
                      ? <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" title="Đã số hóa (GGS)" />
                      : nb.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
                      ? <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" title="Đã kê khai" />
                      : nb.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG'
                      ? <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" title="Có tên chủ" />
                      : <span className="w-2.5 h-2.5 rounded-full bg-gray-300 shrink-0" title="Chưa có tên" />;

                    return (
                      <div
                        key={nb.ma_thua}
                        onClick={() => handleNeighborClick(nb)}
                        className="w-full flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-blue-50/70 border border-gray-100 hover:border-blue-200 transition cursor-pointer text-left group shadow-2xs bg-white"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {statusDot}
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-gray-800 group-hover:text-blue-600 transition block">
                              Thửa {nb.so_thua} (Tờ {nb.to_ban_do})
                            </span>
                            {nb.chu_ho && nb.chu_ho !== 'Chưa có tên' && (
                              <span className="text-[10px] text-gray-500 block truncate">
                                {nb.chu_ho}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded whitespace-nowrap">
                            {nb.arrow} {nb.directionText || nb.quadrantText} · ~{nb.distanceMeters}m
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNeighborClick(nb);
                            }}
                            className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200 hover:border-blue-600 rounded transition flex items-center gap-0.5"
                          >
                            <Eye className="w-3 h-3" /> Xem
                          </button>
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
            {/* Hướng dẫn ngắn gọn */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs text-slate-700">
              <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
                <FileEdit className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Bổ sung / Báo sai thông tin thửa đất</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Thửa <strong className="font-bold text-slate-800">{parcel.so_thua}</strong> (Tờ <strong className="font-bold text-slate-800">{parcel.to_ban_do}</strong>) đã được số hóa. Nếu thông tin có sai sót hoặc cần bổ sung giấy tờ, vui lòng ghi nội dung bên dưới:
              </p>
            </div>

            {/* Ô nhập nội dung sai lệch cụ thể */}
            <div className="space-y-1 text-xs">
              <label className="font-semibold text-gray-700 flex items-center justify-between">
                <span>Nội dung cần điều chỉnh / bổ sung <span className="text-red-500">*</span></span>
              </label>
              <textarea
                rows={2}
                required
                value={lyDoBaoSai}
                onChange={(e) => setLyDoBaoSai(e.target.value)}
                placeholder="VD: Cập nhật tên chủ hộ đúng, số CCCD chuẩn, hoặc bổ sung ảnh GCN..."
                className="w-full text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
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
            {/* Banner đang chỉnh sửa phiếu đã kê khai */}
            {currentDeclaration && (
              <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                  <div>
                    <span className="font-bold block">Phiếu kê khai đã lưu</span>
                    <span className="text-[10px] text-blue-700">Bạn có thể chỉnh sửa thông tin hoặc xóa bỏ phiếu</span>
                  </div>
                </div>
                {onDeleteDeclaration && (
                  <button
                    type="button"
                    onClick={() => setIsConfirmDeleteOpen(true)}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-red-100 text-red-700 hover:bg-red-600 hover:text-white transition flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" /> Xóa phiếu
                  </button>
                )}
              </div>
            )}

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

            {/* DANH SÁCH THỬA ĐẤT KÊ KHAI (HỖ TRỢ THÊM NHIỀU THỬA CHUNG 1 PHIẾU) */}
            <div className="p-3 bg-gradient-to-br from-blue-50/80 to-indigo-50/60 border border-blue-200 rounded-xl space-y-2.5 text-xs shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-blue-900 flex items-center gap-1.5 text-xs">
                  <Layers className="w-4 h-4 text-blue-600" />
                  Thửa đất kê khai trong phiếu này:
                </span>
                <span className="text-[10px] font-bold bg-blue-200/80 text-blue-900 px-2 py-0.5 rounded-full">
                  {1 + (additionalParcels?.length || 0)} thửa gộp chung
                </span>
              </div>

              {/* Thửa chính */}
              <div className="p-2 bg-white rounded-lg border border-red-200 flex items-center justify-between shadow-2xs">
                <div>
                  <span className="font-bold text-gray-900 block text-xs flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-red-200 shrink-0 animate-pulse" />
                    Thửa {parcel.so_thua} • Tờ {parcel.to_ban_do} (Thửa gốc)
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">
                    {parcel.dien_tich ? `${parcel.dien_tich} m²` : '---'} • {parcel.loai_dat || 'Chưa rõ loại'} • {parcel.thon_xa}
                  </span>
                </div>
                <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200">
                  🔴 Thửa chính
                </span>
              </div>

              {/* Danh sách các thửa gộp thêm */}
              {additionalParcels && additionalParcels.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-gray-600 block">Các thửa kèm theo:</span>
                  {additionalParcels.map((ap, idx) => (
                    <div key={ap.ma_thua} className="p-2 bg-white rounded-lg border border-orange-200 flex items-center justify-between shadow-2xs">
                      <div>
                        <span className="font-bold text-orange-950 block text-xs flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 ring-2 ring-orange-200 shrink-0" />
                          Thửa {ap.so_thua} • Tờ {ap.to_ban_do}
                        </span>
                        <span className="text-[10px] text-gray-500 font-mono">
                          {ap.dien_tich ? `${ap.dien_tich} m²` : '---'} • {ap.loai_dat || 'Đất'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200">
                          🟠 Thửa #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveAdditionalParcel && onRemoveAdditionalParcel(ap.ma_thua)}
                          className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition"
                          title="Bỏ thửa này khỏi phiếu"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Nút hành động chọn thêm trên bản đồ & gợi ý gộp */}
              <div className="flex flex-col gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={onStartPickAdditional}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    isPickingAdditional
                      ? 'bg-amber-500 text-white border-amber-600 shadow-md animate-pulse'
                      : 'bg-white hover:bg-blue-50 text-blue-700 border-blue-300 shadow-2xs'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{isPickingAdditional ? 'Đang chọn thửa trên bản đồ (Bấm để dừng)' : '🎯 Chọn thêm thửa khác trên bản đồ'}</span>
                </button>

                {/* Gợi ý gộp nhanh nếu có thửa cùng chủ */}
                {(undeclaredSameCccdParcels.length > 0 || undeclaredSameNameParcels.length > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      const toAdd = [...undeclaredSameCccdParcels, ...undeclaredSameNameParcels];
                      toAdd.forEach((p) => onAddAdditionalParcel && onAddAdditionalParcel(p));
                    }}
                    className="w-full py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition"
                  >
                    <ListPlus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Gộp tất cả thửa cùng chủ ({undeclaredSameCccdParcels.length + undeclaredSameNameParcels.length} thửa) vào phiếu này</span>
                  </button>
                )}
              </div>
            </div>

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

              {/* Danh sách ảnh CCCD đã chọn kèm nút Sửa/Cắt/Xoay */}
              {cccdUploadedFiles.length > 0 && (
                <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-900 block">
                      Ảnh CCCD đính kèm ({cccdUploadedFiles.length} ảnh):
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenCccdEditor(0)}
                      className="text-[10px] font-bold text-blue-700 hover:underline flex items-center gap-1"
                    >
                      <Crop className="w-3 h-3 text-blue-600" /> Cắt / Xoay ảnh
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    {cccdUploadedFiles.map((file, idx) => (
                      <div key={idx} className="relative group bg-white p-1 rounded-lg border border-blue-200 shadow-2xs flex flex-col items-center">
                        <div className="w-full h-24 rounded overflow-hidden bg-slate-900 relative">
                          <img src={file.url} alt="CCCD" className="w-full h-full object-contain" />
                          <div className="absolute top-1 left-1 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                            {idx === 0 ? 'Mặt trước' : 'Mặt sau'}
                          </div>
                        </div>
                        <div className="w-full flex items-center justify-between gap-1 mt-1 pt-1 border-t border-gray-100">
                          <button
                            type="button"
                            onClick={() => handleOpenCccdEditor(idx)}
                            className="flex-1 py-0.5 px-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold rounded flex items-center justify-center gap-1 transition"
                            title="Cắt, xoay, làm nét"
                          >
                            <Crop className="w-3 h-3" /> Sửa ảnh
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCccdFile(idx)}
                            className="p-1 text-red-500 hover:bg-red-50 rounded transition"
                            title="Xóa ảnh này"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Đã lưu thông tin kê khai thành công!</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              {currentDeclaration && onDeleteDeclaration && (
                <button
                  type="button"
                  onClick={() => setIsConfirmDeleteOpen(true)}
                  className="py-2.5 px-3 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                  title="Xóa phiếu kê khai này"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Xóa phiếu</span>
                </button>
              )}

              <button
                type="submit"
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>{currentDeclaration ? 'Lưu thay đổi phiếu kê khai' : 'Lưu phiếu kê khai'}</span>
              </button>
            </div>

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

      {/* Modal Chỉnh sửa, Cắt, Xoay, Tinh chỉnh ảnh CCCD */}
      <CccdImageEditorModal
        isOpen={isCccdEditorOpen}
        imageUrl={editingImageUrl}
        title={`Chỉnh sửa ảnh CCCD (${editingCccdIndex === 0 ? 'Mặt trước' : 'Mặt sau'})`}
        onClose={() => setIsCccdEditorOpen(false)}
        onSave={handleSaveEditedCccd}
      />

      {/* Confirmation Modal when Deleting Declaration */}
      {isConfirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-sm w-full p-4 shadow-2xl border border-red-200 space-y-3 text-left">
            <div className="flex items-center gap-2.5 text-red-600">
              <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h4 className="font-extrabold text-sm text-gray-900">Xác nhận xóa phiếu kê khai</h4>
                <p className="text-[11px] text-gray-500">Hủy bỏ hồ sơ kê khai đã lưu</p>
              </div>
            </div>

            <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-700 space-y-1.5">
              <p>
                Bạn có chắc muốn xóa phiếu kê khai của <strong>Thửa {parcel.so_thua} (Tờ {parcel.to_ban_do})</strong>?
              </p>
              {additionalParcels && additionalParcels.length > 0 && (
                <p className="text-amber-800 text-[11px]">
                  Phiếu này bao gồm <strong>{additionalParcels.length} thửa kèm theo</strong> ({additionalParcels.map(t => `${t.so_thua}/${t.to_ban_do}`).join(', ')}).
                </p>
              )}
              <p className="text-[11px] text-blue-700">
                👉 Tất cả các thửa trong phiếu sẽ <strong>tự động quay lại trạng thái ban đầu</strong> (Có tên - Màu Vàng, hoặc Chưa có tên - Màu Trắng).
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsConfirmDeleteOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteDeclaration) {
                    onDeleteDeclaration(parcel.ma_thua);
                  }
                  setIsConfirmDeleteOpen(false);
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-black bg-red-600 hover:bg-red-700 text-white shadow-xs transition flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xác nhận xóa</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

