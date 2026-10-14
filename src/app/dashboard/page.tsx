'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import rawParcels from '@/data/parcels.json';
import { Parcel, ParcelStatus, DeclarationFormData } from '@/types';
import { removeVietnameseTones } from '@/utils/geo';
import { stripAccents, cleanCccd, getCanonicalVillage, CANONICAL_VILLAGES } from '@/utils/syncGoogleSheets';
import { getStoredDeclarations, saveOrUpdateDeclaration, removeDeclaration } from '@/utils/declaration';
import DeclarationPrintModal, { PrintableDeclarationItem } from '@/components/DeclarationPrintModal';
import DashboardParcelModal from '@/components/DashboardParcelModal';
import DeclarationEditModal from '@/components/DeclarationEditModal';
import VectorViewerModal from '@/components/VectorViewerModal';
import CccdSupplementModal from '@/components/CccdSupplementModal';
import CccdManagerTab from '@/components/CccdManagerTab';
import CccdHoverPreviewCard from '@/components/CccdHoverPreviewCard';
import ScanFileManagerTab from '@/components/ScanFileManagerTab';
import { generateReadyToPackPdf, downloadPdfBlob, ReadyToPackItem } from '@/utils/pdfPacker';
import { generateStatisticsPdf } from '@/utils/exportStatisticsPdf';
import {
  FileBarChart2,
  Loader2,
  Camera,
  HardDrive,
  FolderOpen,
  Map as MapIcon,
  BarChart3,
  PieChart,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileSpreadsheet,
  Download,
  RefreshCw,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Layers,
  MapPin,
  Sparkles,
  Building2,
  Landmark,
  ArrowUpDown,
  TrendingUp,
  FileText,
  ShieldCheck,
  Check,
  X,
  Printer,
  Calendar,
  CheckSquare,
  Square,
  Eye,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Sun,
  Moon,
  Copy,
} from 'lucide-react';

export default function DashboardPage() {
  const [parcels] = useState<Parcel[]>(rawParcels as Parcel[]);

  // Google Sheets & Realtime state
  const [ggsCodes, setGgsCodes] = useState<Set<string>>(new Set());
  const [isSyncingGgs, setIsSyncingGgs] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [declaredParcelCodes, setDeclaredParcelCodes] = useState<Set<string>>(new Set());
  const [declarationsMap, setDeclarationsMap] = useState<Record<string, any>>({});
  const lastCloudSigRef = useRef<string>('');
  const lastCloudUpdatedAtRef = useRef<string>('');

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ParcelStatus | 'ALL'>('ALL');
  const [villageFilter, setVillageFilter] = useState<string>('ALL');
  const [landTypeFilter, setLandTypeFilter] = useState<string>('ALL');
  const [sheetFilter, setSheetFilter] = useState<string>('ALL');

  // Sorting & Pagination
  const [sortBy, setSortBy] = useState<'so_thua' | 'to_ban_do' | 'dien_tich' | 'chu_ho'>('so_thua');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Active view tab in Dashboard: Báo Cáo Tiến Độ, Tiến Độ 16 Thôn, Kho CCCD, Kho File Scan
  const [activeTab, setActiveTab] = useState<'progressReport' | 'villages' | 'cccd' | 'filescan'>('progressReport');

  // Theme state: Dark mode hoặc Light mode (lưu vào localStorage)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('diachinh_dashboard_theme');
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved);
      }
    } catch {}
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('diachinh_dashboard_theme', next);
    } catch {}
  };

  // State Báo Cáo Tiến Độ 16 Thôn & Bảng Đóng Tập Nội Bộ (Đóng gói khép kín thay thế Google Sheets)
  const [syncSheetsData, setSyncSheetsData] = useState<Record<string, string[][]> | null>(null);
  const [syncSummary, setSyncSummary] = useState<{
    totalDeclared: number;
    daGiaiQuyet: number;
    choNhap?: number;
    nhapGgs: number;
    daDongTap: number;
    canTimCccd: number;
    khongCoCccd: number;
  } | null>(null);
  const [isLoadingSyncSheets, setIsLoadingSyncSheets] = useState(false);
  const [selectedReportSheet, setSelectedReportSheet] = useState<string>('THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)');
  const [reportSearchQuery, setReportSearchQuery] = useState<string>('');
  const [reportVillageFilter, setReportVillageFilter] = useState<string>('ALL');
  const [reportStatusFilter, setReportStatusFilter] = useState<'ALL' | 'CẦN TÌM CCCD' | 'KHÔNG CÓ CCCD'>('ALL');
  const [reportPageSize, setReportPageSize] = useState<number | 'ALL'>(20);
  const [reportPage, setReportPage] = useState<number>(1);

  // Sắp xếp danh sách theo tên chủ đất A -> Z
  const [sortNameOrder, setSortNameOrder] = useState<'none' | 'asc' | 'desc'>('none');

  // Lọc thửa Có tên / Không có tên trong danh sách "Chưa Thực Hiện"
  const [chuaThucHienNameFilter, setChuaThucHienNameFilter] = useState<'ALL' | 'CO_TEN' | 'CHUA_CO_TEN'>('ALL');

  // Chỉnh sửa & Nhập trực tiếp trên bảng như Excel
  const [cellEdits, setCellEdits] = useState<Record<string, Record<number, string>>>({});
  const [savingRowCodes, setSavingRowCodes] = useState<Set<string>>(new Set());
  const [inlineSaveToast, setInlineSaveToast] = useState<string | null>(null);

  // Checkbox Selection state cho THỬA SẲN SÀNG ĐÓNG TẬP (CÓ CCCD)
  const [readyToPackSelectedCodes, setReadyToPackSelectedCodes] = useState<Set<string>>(new Set());
  const [packagedParcelCodes, setPackagedParcelCodes] = useState<Set<string>>(new Set());
  const [readyToPackStatusFilter, setReadyToPackStatusFilter] = useState<'ALL' | 'UNPACKED' | 'PACKED'>('ALL');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('diachinh_packaged_parcel_codes');
      if (saved) {
        setPackagedParcelCodes(new Set(JSON.parse(saved)));
      }
    } catch {}
  }, []);

  const markParcelsAsPackaged = (codes: string[]) => {
    setPackagedParcelCodes((prev) => {
      const next = new Set(prev);
      codes.forEach((c) => next.add(c));
      try {
        localStorage.setItem('diachinh_packaged_parcel_codes', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const toggleParcelPackagedStatus = (code: string) => {
    setPackagedParcelCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      try {
        localStorage.setItem('diachinh_packaged_parcel_codes', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  // Checkbox Selection & Bộ lọc Dropdown Mã Thửa kiểu Excel cho mục "CHƯA THỰC HIỆN"
  const [chuaThucHienSelectedCodes, setChuaThucHienSelectedCodes] = useState<Set<string>>(new Set());
  const [chuaThucHienDropdownOpen, setChuaThucHienDropdownOpen] = useState(false);
  const [chuaThucHienFilterSearch, setChuaThucHienFilterSearch] = useState('');
  const [tempSelectedMaThuas, setTempSelectedMaThuas] = useState<Set<string>>(new Set());
  const [appliedMaThuas, setAppliedMaThuas] = useState<Set<string>>(new Set());
  const [filterPopupPos, setFilterPopupPos] = useState<{ top: number; left: number } | null>(null);

  // Modal xem trực tiếp file PDF CCCD (không mở url ngoài)
  const [previewPdfModal, setPreviewPdfModal] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
    filename?: string;
  }>({ isOpen: false, url: '', title: '' });

  // Checkbox Selection state for Batch PDF Export
  const [selectedParcelCodes, setSelectedParcelCodes] = useState<Set<string>>(new Set());

  // Trạng thái xuất PDF thống kê toàn xã (Trang 1: 4 nhóm & 16 thôn buôn, Trang 2+: Lưới 3 cột)
  const [isExportingStatsPdf, setIsExportingStatsPdf] = useState(false);
  const [exportStatsProgress, setExportStatsProgress] = useState('');

  // Trạng thái đóng tập PDF (Sẵn sàng đóng tập có CCCD chuẩn PDF_Web_App)
  const [isPackagingPdf, setIsPackagingPdf] = useState(false);
  const [packagingProgress, setPackagingProgress] = useState('');
  const [packagingDoneUrl, setPackagingDoneUrl] = useState<string | null>(null);
  const [packagingDoneFileName, setPackagingDoneFileName] = useState<string | null>(null);

  // PDF Print Modal state
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printModalTitle, setPrintModalTitle] = useState('Tập Đơn Kê Khai Đất Đai');
  const [printableItems, setPrintableItems] = useState<PrintableDeclarationItem[]>([]);

  // Parcel Detail Modal state
  const [activeParcelDetail, setActiveParcelDetail] = useState<Parcel | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Image Viewer Modal state
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [viewerData, setViewerData] = useState<{
    url: string;
    urls?: string[];
    title: string;
    owner?: string;
    cccd?: string;
  }>({ url: '', title: '' });

  // Edit Declaration Modal state
  const [editingParcel, setEditingParcel] = useState<Parcel | null>(null);
  const [editingDeclaration, setEditingDeclaration] = useState<any | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Delete Confirmation Modal state
  const [deletingParcel, setDeletingParcel] = useState<Parcel | null>(null);

  // CCCD & Scan Supplement Modal state
  const [isCccdSupplementOpen, setIsCccdSupplementOpen] = useState(false);
  const [selectedParcelForCccd, setSelectedParcelForCccd] = useState('');
  const [cccdModalMode, setCccdModalMode] = useState<'folder' | 'single'>('folder');

  // 1. Đồng bộ danh sách kê khai từ Cloud R2 theo thời gian thực (Không cần F5)
  const fetchCloudDeclarations = useCallback(async () => {
    try {
      const res = await fetch(`/api/declarations?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data && data.success && Array.isArray(data.declaredCodes)) {
          if (data.updatedAt && data.updatedAt === lastCloudUpdatedAtRef.current) return;
          const cloudMap = data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {};
          const sig = JSON.stringify({ codes: data.declaredCodes, map: cloudMap });
          if (sig === lastCloudSigRef.current) {
            if (data.updatedAt) lastCloudUpdatedAtRef.current = data.updatedAt;
            return;
          }
          lastCloudSigRef.current = sig;
          if (data.updatedAt) lastCloudUpdatedAtRef.current = data.updatedAt;

          // CẬP NHẬT DỮ LIỆU ĐỒNG BỘ CHÍNH XÁC TỪ CLOUD R2
          const cloudCodesSet = new Set<string>(data.declaredCodes);
          setDeclaredParcelCodes(cloudCodesSet);
          setDeclarationsMap(cloudMap);

          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('diachinh_declared_codes', JSON.stringify(data.declaredCodes));
              localStorage.setItem('diachinh_declarations_map', JSON.stringify(cloudMap));
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      console.warn('Lỗi đồng bộ declarations trên Dashboard:', err);
    }
  }, []);

  useEffect(() => {
    const { declaredCodes, declarationsMap: map } = getStoredDeclarations();
    setDeclaredParcelCodes(declaredCodes);
    setDeclarationsMap(map);
    fetchCloudDeclarations();

    // Tự động đồng bộ mỗi 12 giây (tiết kiệm CPU, không cần F5)
    const interval = setInterval(fetchCloudDeclarations, 12000);
    const onFocus = () => fetchCloudDeclarations();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [fetchCloudDeclarations]);

  const handleOpenEditDeclaration = (parcel: Parcel, decl?: any) => {
    setEditingParcel(parcel);
    setEditingDeclaration(decl || declarationsMap[parcel.ma_thua] || null);
    setIsEditModalOpen(true);
  };

  // Mở modal chỉnh sửa hoặc kê khai trực tiếp cho một thửa đất từ bảng danh sách
  const handleEditRowParcel = (maThua: string, rowData?: any[]) => {
    let p = computedParcels.find((cp) => cp.ma_thua === maThua);
    if (!p && rowData) {
      p = {
        ma_thua: maThua,
        to_ban_do: String(rowData[2] || ''),
        so_thua: String(rowData[3] || ''),
        thon_xa: String(rowData[4] || ''),
        chu_ho: String(rowData[5] || ''),
        cccd: String(rowData[8] || '').replace(/^="|"$/g, ''),
        dien_tich: String(rowData[10] || ''),
        loai_dat: String(rowData[11] || 'DGT'),
        trang_thai: 'CO_TEN_CHUA_SO_HOA_VANG',
        polygon: [],
      } as any;
    }
    if (p) {
      const decl = declarationsMap[maThua] || {
        ma_thua: p.ma_thua,
        to_ban_do: p.to_ban_do,
        so_thua: p.so_thua,
        chu_dat_ten: p.chu_ho,
        chu_dat_cccd: p.cccd,
        chu_dat_nam_sinh: (p as any).ngay_sinh || '',
        chu_dat_gioi_tinh: (p as any).gioi_tinh || 'Nam',
        chu_dat_dia_chi: p.thon_xa ? `${p.thon_xa}, xã Cư Pui` : 'xã Cư Pui',
        dien_tich: p.dien_tich,
        loai_dat: p.loai_dat,
        nguon_goc: 'Khai hoang',
      };
      handleOpenEditDeclaration(p, decl);
    }
  };

  // Cập nhật giá trị ô trực tiếp khi người dùng gõ phím
  const handleInlineCellChange = (maThua: string, colIdx: number, val: string) => {
    setCellEdits((prev) => ({
      ...prev,
      [maThua]: {
        ...(prev[maThua] || {}),
        [colIdx]: val,
      },
    }));
  };

  // Lưu giá trị vào Local Declarations và đồng bộ Realtime lên Cloudflare R2
  const handleInlineCellCommit = async (
    maThua: string,
    colIdx: number,
    headerName: string,
    newValue: string,
    row: any[]
  ) => {
    const hLower = headerName.toLowerCase();
    let fieldKey: keyof DeclarationFormData | '' = '';
    if (hLower.includes('họ và tên') || hLower.includes('chủ đất')) fieldKey = 'chu_dat_ten';
    else if (hLower.includes('năm sinh') || hLower.includes('ngày sinh')) fieldKey = 'chu_dat_nam_sinh';
    else if (hLower.includes('giới tính')) fieldKey = 'chu_dat_gioi_tinh';
    else if (hLower.includes('cccd') && !hLower.includes('xem') && !hLower.includes('file')) fieldKey = 'chu_dat_cccd';
    else if (hLower.includes('diện tích')) fieldKey = 'dien_tich';
    else if (hLower.includes('loại đất')) fieldKey = 'loai_dat';
    else if (hLower.includes('nguồn gốc')) fieldKey = 'nguon_goc';
    else if (hLower.includes('ghi chú') || hLower.includes('hướng dẫn')) fieldKey = 'ghi_chu';

    if (!fieldKey) return;

    // Tìm parcel gốc hoặc dựng từ row
    let p = computedParcels.find((cp) => cp.ma_thua === maThua);
    const existingDecl = declarationsMap[maThua] || {
      ma_thua: maThua,
      to_ban_do: String(row[2] || p?.to_ban_do || ''),
      so_thua: String(row[3] || p?.so_thua || ''),
      chu_dat_ten: String(row[5] || p?.chu_ho || ''),
      chu_dat_nam_sinh: String(row[6] || (p as any)?.ngay_sinh || ''),
      chu_dat_gioi_tinh: String(row[7] || (p as any)?.gioi_tinh || 'Nam'),
      chu_dat_cccd: String(row[8] || p?.cccd || '').replace(/^="|"$/g, ''),
      chu_dat_dia_chi: p?.thon_xa ? `${p.thon_xa}, xã Cư Pui` : `${row[4] || ''}, xã Cư Pui`,
      dien_tich: String(row[9] || p?.dien_tich || ''),
      loai_dat: String(row[10] || p?.loai_dat || 'DGT'),
      nguon_goc: String(row[11] || 'Khai hoang'),
    };

    const formattedValue = fieldKey === 'chu_dat_cccd' ? cleanCccd(newValue) : newValue.trim();

    // Nếu không thay đổi gì thì bỏ qua
    if (existingDecl[fieldKey] === formattedValue) return;

    const updatedDecl: DeclarationFormData = {
      ...existingDecl,
      [fieldKey]: formattedValue,
    };

    // Đánh dấu đang lưu
    setSavingRowCodes((prev) => new Set(prev).add(maThua));

    // Cập nhật state local
    const { updatedCodes, updatedMap } = saveOrUpdateDeclaration(updatedDecl);
    setDeclaredParcelCodes(new Set(updatedCodes));
    setDeclarationsMap(updatedMap);

    // Gửi realtime lên Cloudflare R2
    try {
      const res = await fetch('/api/declarations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedDecl),
      });
      if (res.ok) {
        setInlineSaveToast(`✓ Đã lưu thay đổi Thửa ${updatedDecl.so_thua || maThua} realtime`);
        setTimeout(() => setInlineSaveToast(null), 2500);
      }
    } catch (e) {
      console.warn('Lỗi lưu realtime:', e);
    } finally {
      setSavingRowCodes((prev) => {
        const next = new Set(prev);
        next.delete(maThua);
        return next;
      });
    }
  };

  const handleSaveEditedDeclaration = (data: DeclarationFormData) => {
    const { updatedCodes, updatedMap } = saveOrUpdateDeclaration(data);
    lastCloudSigRef.current = JSON.stringify({ codes: updatedCodes, map: updatedMap });
    setDeclaredParcelCodes(new Set(updatedCodes));
    setDeclarationsMap(updatedMap);
    setIsEditModalOpen(false);
    setEditingParcel(null);
    setEditingDeclaration(null);

    // Nếu vừa kê khai từ danh sách CHƯA THỰC HIỆN, tự động kiểm tra và chuyển qua danh sách tiếp theo:
    const cleanCccdVal = cleanCccd(data.chu_dat_cccd);
    if (selectedReportSheet === 'CHƯA THỰC HIỆN') {
      const nextSheet = cleanCccdVal
        ? 'THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'
        : 'THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)';
      setSelectedReportSheet(nextSheet);
      setReportPage(1);
    }

    // Đẩy cập nhật lên máy chủ Cloudflare R2 ngay lập tức
    fetch('/api/declarations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(async (res) => {
        if (res.ok) {
          const result = (await res.json()) as any;
          if (result.success && Array.isArray(result.declaredCodes)) {
            const cloudMap = result.declarationsMap || {};
            lastCloudSigRef.current = JSON.stringify({ codes: result.declaredCodes, map: cloudMap });
            setDeclaredParcelCodes(new Set(result.declaredCodes));
            setDeclarationsMap(cloudMap);
          }
          // Tự động tính toán lại báo cáo realtime
          fetchSyncSheetsReport();
        }
      })
      .catch((err) => console.warn('Lỗi khi lưu chỉnh sửa lên Cloud:', err));
  };

  const handleDeleteDeclaration = (maThua: string) => {
    const { updatedCodes, updatedMap } = removeDeclaration(maThua);
    lastCloudSigRef.current = JSON.stringify({ codes: updatedCodes, map: updatedMap });
    setDeclaredParcelCodes(new Set(updatedCodes));
    setDeclarationsMap(updatedMap);
    setDeletingParcel(null);
    if (activeParcelDetail && activeParcelDetail.ma_thua === maThua) {
      setIsDetailModalOpen(false);
      setActiveParcelDetail(null);
    }

    // Xóa trên máy chủ Cloudflare R2 để mọi thiết bị khác tự mất ngay lập tức
    fetch(`/api/declarations?ma_thua=${encodeURIComponent(maThua)}`, {
      method: 'DELETE',
    })
      .then(async (res) => {
        if (res.ok) {
          const result = (await res.json()) as any;
          if (result.success && Array.isArray(result.declaredCodes)) {
            const cloudMap = result.declarationsMap || {};
            lastCloudSigRef.current = JSON.stringify({ codes: result.declaredCodes, map: cloudMap });
            setDeclaredParcelCodes(new Set(result.declaredCodes));
            setDeclarationsMap(cloudMap);
          }
        }
      })
      .catch((err) => console.warn('Lỗi khi xóa phiếu trên Cloud:', err));
  };

  // 2. Nạp báo cáo thống kê 16 thôn & đóng tập từ API nội bộ
  const fetchSyncSheetsReport = useCallback(async () => {
    setIsLoadingSyncSheets(true);
    try {
      const res = await fetch('/api/sync-sheets', { cache: 'no-store' });
      const data: any = await res.json();
      if (data && data.success) {
        setSyncSummary(data.summary);
        setSyncSheetsData(data.sheetsData);
      }
    } catch (err) {
      console.error('Lỗi nạp báo cáo tiến độ nội bộ:', err);
    } finally {
      setIsLoadingSyncSheets(false);
    }
  }, []);

  // 3. Đồng bộ Google Sheets Realtime
  const fetchGgsCodes = useCallback(async () => {
    setIsSyncingGgs(true);
    try {
      const res = await fetch('/api/sync-ggs', { cache: 'no-store' });
      const data: any = await res.json();
      if (data && data.success && Array.isArray(data.ggsCodes)) {
        setGgsCodes(new Set(data.ggsCodes));
        const now = new Date();
        setLastSyncTime(
          now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      }
    } catch (err) {
      console.error('Lỗi đồng bộ Google Sheets:', err);
    } finally {
      setIsSyncingGgs(false);
    }
  }, []);

  useEffect(() => {
    fetchGgsCodes();
  }, [fetchGgsCodes]);

  useEffect(() => {
    if (activeTab === 'progressReport' && !syncSheetsData && !isLoadingSyncSheets) {
      fetchSyncSheetsReport();
    }
  }, [activeTab, syncSheetsData, isLoadingSyncSheets, fetchSyncSheetsReport]);

  // 3. Tính toán trạng thái thực tế của từng thửa
  const computedParcels = useMemo(() => {
    return parcels.map((p) => {
      const isOnGgs = ggsCodes.has(p.ma_thua);
      const isDeclared = declaredParcelCodes.has(p.ma_thua) || Boolean(declarationsMap[p.ma_thua]);

      let finalStatus: ParcelStatus;
      if (isOnGgs || p.trang_thai === 'DA_SO_HOA_XANH') {
        finalStatus = 'DA_SO_HOA_XANH';
      } else if (isDeclared) {
        finalStatus = 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
      } else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') {
        finalStatus = 'CO_TEN_CHUA_SO_HOA_VANG';
      } else {
        finalStatus = 'CHUA_CO_TEN_XAM';
      }

      // Gộp thêm dữ liệu kê khai mới nhất từ LocalStorage (nếu có)
      const savedDecl = declarationsMap[p.ma_thua];
      const mergedChuHo = savedDecl?.chu_dat_ten || p.chu_ho;
      const mergedCccd = savedDecl?.chu_dat_cccd || p.cccd;

      return {
        ...p,
        chu_ho: mergedChuHo,
        cccd: mergedCccd,
        trang_thai: finalStatus,
        is_on_ggs: isOnGgs,
        is_declared: isDeclared,
      };
    });
  }, [parcels, ggsCodes, declaredParcelCodes, declarationsMap]);

  // Danh sách các thửa chưa thực hiện kê khai
  const chuaThucHienParcels = useMemo(() => {
    return computedParcels.filter(
      (p) => !declaredParcelCodes.has(p.ma_thua) && p.trang_thai !== 'DA_SO_HOA_XANH'
    );
  }, [computedParcels, declaredParcelCodes]);

  // 4. Danh sách độc nhất Thôn / Buôn, Loại đất, Tờ bản đồ
  const uniqueVillages = useMemo(() => {
    const set = new Set<string>();
    computedParcels.forEach((p) => {
      if (p.thon_xa) set.add(p.thon_xa.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [computedParcels]);

  const uniqueLandTypes = useMemo(() => {
    const set = new Set<string>();
    computedParcels.forEach((p) => {
      if (p.loai_dat) set.add(p.loai_dat.trim());
    });
    return Array.from(set).sort();
  }, [computedParcels]);

  const uniqueSheets = useMemo(() => {
    const set = new Set<string>();
    computedParcels.forEach((p) => {
      if (p.to_ban_do) set.add(p.to_ban_do.trim());
    });
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [computedParcels]);

  // 5. Thống kê tổng hợp toàn xã
  const globalStats = useMemo(() => {
    let green = 0;
    let blue = 0;
    let yellow = 0;
    let gray = 0;
    let totalAreaM2 = 0;
    let digitizedAreaM2 = 0;
    let hasGpsCount = 0;
    let hasCccdCount = 0;
    let withImagesCount = 0;
    const ownersSet = new Set<string>();

    computedParcels.forEach((p) => {
      if (p.trang_thai === 'DA_SO_HOA_XANH') green++;
      else if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') blue++;
      else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') yellow++;
      else gray++;

      const area = parseFloat(p.dien_tich || '0');
      if (!isNaN(area) && area > 0) {
        totalAreaM2 += area;
        if (p.trang_thai === 'DA_SO_HOA_XANH') {
          digitizedAreaM2 += area;
        }
      }

      if (p.lat && p.lng) hasGpsCount++;
      if (p.cccd) hasCccdCount++;

      const decl = declarationsMap[p.ma_thua];
      const hasImg =
        Boolean(p.cccd_url) ||
        Boolean(p.svg_url) ||
        (Array.isArray(p.gcn_urls) && p.gcn_urls.length > 0) ||
        Boolean(decl?.anh_cccd_truoc) ||
        Boolean(decl?.anh_cccd_sau) ||
        Boolean(decl?.anh_gcn);
      if (hasImg) withImagesCount++;

      if (
        p.chu_ho &&
        p.chu_ho !== 'Chưa có tên' &&
        p.chu_ho !== 'Không có dữ liệu' &&
        p.chu_ho !== 'Không có trong SMK'
      ) {
        ownersSet.add(p.chu_ho.trim());
      }
    });

    const total = computedParcels.length;
    const completionRate = total > 0 ? Math.round((green / total) * 1000) / 10 : 0;
    const totalAreaHa = Math.round((totalAreaM2 / 10000) * 100) / 100;
    const digitizedAreaHa = Math.round((digitizedAreaM2 / 10000) * 100) / 100;

    return {
      total,
      green,
      blue,
      yellow,
      gray,
      totalAreaM2,
      totalAreaHa,
      digitizedAreaHa,
      completionRate,
      hasGpsCount,
      hasCccdCount,
      withImagesCount,
      uniqueOwnersCount: ownersSet.size,
    };
  }, [computedParcels, declarationsMap]);

  // 6. Thống kê theo Thôn / Buôn
  const villageStats = useMemo(() => {
    const map: Record<
      string,
      {
        name: string;
        total: number;
        green: number;
        blue: number;
        yellow: number;
        gray: number;
        totalAreaM2: number;
      }
    > = {};

    computedParcels.forEach((p) => {
      const vName = getCanonicalVillage(p.thon_xa);
      if (!map[vName]) {
        map[vName] = {
          name: vName,
          total: 0,
          green: 0,
          blue: 0,
          yellow: 0,
          gray: 0,
          totalAreaM2: 0,
        };
      }
      map[vName].total++;
      if (p.trang_thai === 'DA_SO_HOA_XANH') map[vName].green++;
      else if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') map[vName].blue++;
      else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') map[vName].yellow++;
      else map[vName].gray++;

      const area = parseFloat(p.dien_tich || '0');
      if (!isNaN(area) && area > 0) {
        map[vName].totalAreaM2 += area;
      }
    });

    return Object.values(map)
      .map((item) => ({
        ...item,
        totalAreaHa: Math.round((item.totalAreaM2 / 10000) * 100) / 100,
        rate: item.total > 0 ? Math.round((item.green / item.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [computedParcels]);

  // 7. Thống kê theo Loại đất
  const landTypeStats = useMemo(() => {
    const map: Record<string, { code: string; count: number; totalAreaM2: number }> = {};
    computedParcels.forEach((p) => {
      const code = p.loai_dat?.trim() || 'Chưa rõ';
      if (!map[code]) {
        map[code] = { code, count: 0, totalAreaM2: 0 };
      }
      map[code].count++;
      const area = parseFloat(p.dien_tich || '0');
      if (!isNaN(area) && area > 0) {
        map[code].totalAreaM2 += area;
      }
    });

    const total = computedParcels.length;
    return Object.values(map)
      .map((item) => ({
        ...item,
        totalAreaHa: Math.round((item.totalAreaM2 / 10000) * 100) / 100,
        percentCount: total > 0 ? Math.round((item.count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [computedParcels]);

  // 8. Lọc danh sách chi tiết (Table data)
  const filteredParcels = useMemo(() => {
    let result = computedParcels;

    if (statusFilter !== 'ALL') {
      result = result.filter((p) => p.trang_thai === statusFilter);
    }

    if (villageFilter !== 'ALL') {
      result = result.filter((p) => p.thon_xa?.trim() === villageFilter);
    }

    if (landTypeFilter !== 'ALL') {
      result = result.filter((p) => p.loai_dat?.trim() === landTypeFilter);
    }

    if (sheetFilter !== 'ALL') {
      result = result.filter((p) => p.to_ban_do?.trim() === sheetFilter);
    }

    if (searchQuery.trim()) {
      const q = removeVietnameseTones(searchQuery.trim().toLowerCase());
      result = result.filter((p) => {
        const thua = (p.so_thua || '').toLowerCase();
        const to = (p.to_ban_do || '').toLowerCase();
        const chu = removeVietnameseTones((p.chu_ho || '').toLowerCase());
        const cccd = (p.cccd || '').toLowerCase();
        const thon = removeVietnameseTones((p.thon_xa || '').toLowerCase());
        const loai = (p.loai_dat || '').toLowerCase();

        return (
          thua.includes(q) ||
          to.includes(q) ||
          chu.includes(q) ||
          cccd.includes(q) ||
          thon.includes(q) ||
          loai.includes(q)
        );
      });
    }

    // Sắp xếp
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'so_thua') {
        const na = parseInt(a.so_thua, 10);
        const nb = parseInt(b.so_thua, 10);
        cmp = !isNaN(na) && !isNaN(nb) ? na - nb : (a.so_thua || '').localeCompare(b.so_thua || '');
      } else if (sortBy === 'to_ban_do') {
        const na = parseInt(a.to_ban_do, 10);
        const nb = parseInt(b.to_ban_do, 10);
        cmp = !isNaN(na) && !isNaN(nb) ? na - nb : (a.to_ban_do || '').localeCompare(b.to_ban_do || '');
      } else if (sortBy === 'dien_tich') {
        const da = parseFloat(a.dien_tich || '0');
        const db = parseFloat(b.dien_tich || '0');
        cmp = da - db;
      } else if (sortBy === 'chu_ho') {
        cmp = (a.chu_ho || '').localeCompare(b.chu_ho || '', 'vi');
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [computedParcels, statusFilter, villageFilter, landTypeFilter, sheetFilter, searchQuery, sortBy, sortOrder]);

  // Phân trang
  const totalPages = Math.ceil(filteredParcels.length / pageSize) || 1;
  const paginatedParcels = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredParcels.slice(start, start + pageSize);
  }, [filteredParcels, currentPage, pageSize]);

  // Đổi cột sắp xếp
  const handleSort = (field: 'so_thua' | 'to_ban_do' | 'dien_tich' | 'chu_ho') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  // Checkbox Selection handlers
  const isAllPageSelected =
    paginatedParcels.length > 0 && paginatedParcels.every((p) => selectedParcelCodes.has(p.ma_thua));

  const toggleSelectAllPage = () => {
    setSelectedParcelCodes((prev) => {
      const next = new Set(prev);
      if (isAllPageSelected) {
        paginatedParcels.forEach((p) => next.delete(p.ma_thua));
      } else {
        paginatedParcels.forEach((p) => next.add(p.ma_thua));
      }
      return next;
    });
  };

  const toggleSelectParcel = (maThua: string) => {
    setSelectedParcelCodes((prev) => {
      const next = new Set(prev);
      if (next.has(maThua)) next.delete(maThua);
      else next.add(maThua);
      return next;
    });
  };

  // 9. XUẤT EXCEL DANH SÁCH THỬA ĐÃ KÊ KHAI
  const handleExportDeclaredExcel = () => {
    const declaredList = computedParcels.filter(
      (p) =>
        declaredParcelCodes.has(p.ma_thua) ||
        p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM' ||
        Boolean(declarationsMap[p.ma_thua])
    );

    if (declaredList.length === 0) {
      alert('Hiện chưa có thửa đất nào được kê khai trên hệ thống.');
      return;
    }

    const headers = [
      'STT',
      'Số Thửa',
      'Tờ Bản Đồ',
      'Mã Định Danh Thửa',
      'Thôn / Buôn',
      'Chủ Thửa Đất / Người Sử Dụng',
      'Số CCCD / CMND',
      'Năm Sinh',
      'Số Điện Thoại',
      'Địa Chỉ Thường Trú',
      'Người Kê Khai',
      'Diện Tích (m2)',
      'Loại Đất',
      'Ngày Giờ Kê Khai',
      'Ghi Chú Nguồn Gốc',
      'Trạng Thái',
      'Có Ảnh CCCD?',
      'Có Ảnh GCN?',
      'Tọa Độ Vĩ Độ (Lat)',
      'Tọa Độ Kinh Độ (Lng)',
    ];

    const rows = declaredList.map((p, idx) => {
      const decl = declarationsMap[p.ma_thua] || {};
      const chuHo = decl.chu_dat_ten || p.chu_ho || '';
      const cccd = decl.chu_dat_cccd || p.cccd || '';
      const ngaySinh = decl.chu_dat_ngay_sinh || '';
      const sdt = decl.nguoi_ke_khai_sdt || p.sdt || '';
      const diaChi = decl.chu_dat_dia_chi || p.thon_xa || '';
      const nguoiKekhai = decl.nguoi_ke_khai_ten || chuHo;
      const createdAt = decl.created_at || '';
      const ghiChu = decl.ghi_chu || '';
      const hasCccdImg = Boolean(decl.anh_cccd_truoc || p.cccd_url) ? 'Có' : 'Chưa';
      const hasGcnImg = Boolean(decl.anh_gcn || (p.gcn_urls && p.gcn_urls.length > 0)) ? 'Có' : 'Chưa';

      return [
        idx + 1,
        `"${p.so_thua || ''}"`,
        `"${p.to_ban_do || ''}"`,
        `"${p.ma_thua || ''}"`,
        `"${(p.thon_xa || '').replace(/"/g, '""')}"`,
        `"${chuHo.replace(/"/g, '""')}"`,
        `"${cccd ? `'${cccd}` : ''}"`,
        `"${ngaySinh}"`,
        `"${sdt ? `'${sdt}` : ''}"`,
        `"${diaChi.replace(/"/g, '""')}"`,
        `"${nguoiKekhai.replace(/"/g, '""')}"`,
        p.dien_tich || '0',
        `"${p.loai_dat || ''}"`,
        `"${createdAt}"`,
        `"${ghiChu.replace(/"/g, '""')}"`,
        '"Đã kê khai thực địa"',
        `"${hasCccdImg}"`,
        `"${hasGcnImg}"`,
        p.lat || '',
        p.lng || '',
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Danh_sach_thua_da_ke_khai_Cu_Pui_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 9b. XUẤT FILE EXCEL CHUẨN MẪU ĐÓNG TẬP (EXCEL-MAUNHAP.xlsx)
  const handleExportExcelMauNhap = () => {
    // Thu thập tất cả các thửa đã kê khai hoặc các thửa đang được tích chọn
    let targetParcels = computedParcels.filter(
      (p) =>
        declaredParcelCodes.has(p.ma_thua) ||
        p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM' ||
        Boolean(declarationsMap[p.ma_thua])
    );

    if (selectedParcelCodes.size > 0) {
      targetParcels = computedParcels.filter((p) => selectedParcelCodes.has(p.ma_thua));
    }

    if (targetParcels.length === 0) {
      alert('Chưa có thửa đất nào được chọn hoặc đã kê khai để xuất file mẫu đóng tập.');
      return;
    }

    const rows: string[] = [];

    targetParcels.forEach((p) => {
      const decl = declarationsMap[p.ma_thua] || {};
      const chuHo = decl.chu_dat_ten || p.chu_ho || '';
      const cccd = decl.chu_dat_cccd || p.cccd || '';
      const diaChi = decl.chu_dat_dia_chi || (p.thon_xa ? `${p.thon_xa}, Cư Pui` : 'Xã Cư Pui');

      // 1. Dòng cho thửa chính theo chuẩn 9 cột EXCEL-MAUNHAP.xlsx
      const toThua = `${p.to_ban_do}_${p.so_thua}`;
      rows.push([
        `"${toThua}"`,
        `"${diaChi.replace(/"/g, '""')}"`,
        `"${chuHo.replace(/"/g, '""')}"`,
        '""',
        '""',
        `"${cccd ? `'${cccd}` : ''}"`,
        `"${p.loai_dat || 'ONT'}"`,
        p.dien_tich || '0',
        `"${decl.ghi_chu ? decl.ghi_chu.replace(/"/g, '""') : 'Khai hoang'}"`,
      ].join(','));

      // 2. Dòng cho các thửa gộp kèm theo (nếu người đó kê khai nhiều thửa)
      if (decl.thua_kem_theo && Array.isArray(decl.thua_kem_theo)) {
        decl.thua_kem_theo.forEach((ap: any) => {
          const apToThua = `${ap.to_ban_do}_${ap.so_thua}`;
          rows.push([
            `"${apToThua}"`,
            `"${diaChi.replace(/"/g, '""')}"`,
            `"${chuHo.replace(/"/g, '""')}"`,
            '""',
            '""',
            `"${cccd ? `'${cccd}` : ''}"`,
            `"${ap.loai_dat || 'CLN'}"`,
            ap.dien_tich || '0',
            `"${ap.nguon_goc || 'Khai hoang'}"`,
          ].join(','));
        });
      }
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `EXCEL-MAUNHAP_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 9c. XUẤT FILE 57 CỘT CHUẨN NHẬP GOOGLE SHEETS TRỰC TIẾP TỪ WEB
  const handleExport57Cot = () => {
    let targetParcels = computedParcels.filter(
      (p) =>
        declaredParcelCodes.has(p.ma_thua) ||
        p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM' ||
        Boolean(declarationsMap[p.ma_thua])
    );

    if (selectedParcelCodes.size > 0) {
      targetParcels = computedParcels.filter((p) => selectedParcelCodes.has(p.ma_thua));
    }

    if (targetParcels.length === 0) {
      alert('Chưa có thửa đất nào được chọn hoặc đã kê khai để xuất 57 cột nhập GGS.');
      return;
    }

    const headers_57 = [
      'Mã Xã', 'Mã GCN', 'Số seri', 'Số vào sổ', 'Ngày cấp', 'Người ký',
      'Chủ sử dụng', 'Ngày sinh', 'Giới tính', 'Số CCCD', 'Địa chỉ thường trú', 'Đối tượng', 'Chủ hộ',
      'Vợ/Chồng', 'Ngày sinh vợ/chồng', 'CCCD vợ/chồng', 'Địa chỉ vợ/chồng', 'Năm sinh', 'Quốc tịch', 'Ghi chú pháp lý',
      'Tờ BĐ', 'Thửa đất', 'Địa chỉ thửa đất', 'Diện tích', 'Loại đất', 'Diện tích giao', 'Nguồn gốc',
      'Mục đích sử dụng', 'Thời hạn', 'Nguồn gốc SD', 'Hình thức SD', 'Thời điểm SD', 'Số nhà', 'Tên đường', 'Khu dân cư',
      'Tọa độ X', 'Tọa độ Y', 'Giới hạn Đông', 'Giới hạn Tây', 'Giới hạn Nam', 'Giới hạn Bắc',
      'Loại biến động', 'Ngày biến động', 'Nội dung biến động', 'Hồ sơ số', 'Cơ quan cấp', 'Cán bộ lập', 'Ngày lập',
      'Tên file đính kèm', 'Mã hồ sơ tiếp nhận', 'Người nộp', 'SĐT người nộp', 'Trạng thái', 'Ghi chú quy hoạch',
      'Tranh chấp', 'Quyền hạn chế', 'Ghi chú nội bộ'
    ];

    const rows: string[] = [];

    targetParcels.forEach((p) => {
      const decl = declarationsMap[p.ma_thua] || {};
      const toM = p.to_ban_do || '';
      const thuaM = p.so_thua || '';
      let addr = decl.chu_dat_dia_chi || (p.thon_xa ? `${p.thon_xa}, xã Cư Pui` : 'xã Cư Pui');
      let name = decl.chu_dat_ten || p.chu_ho || '';
      let cccd = decl.chu_dat_cccd || p.cccd || '';
      let dob = decl.chu_dat_ngay_sinh || (p as any).ngay_sinh || '';
      let gender = decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || 'Nam';
      let loaiDat = (decl.loai_dat || p.loai_dat || 'ONT').toUpperCase();
      let dt = p.dien_tich || '0';
      let origin = decl.nguon_goc || 'Khai hoang';

      const isHo = /^(hộ ông|hộ bà|hộ)/i.test(name);
      const cleanName = name.replace(/^(hộ ông\s*:?|hộ bà\s*:?|hộ\s+|ông\s*:?|bà\s*:?)/i, '').trim();
      const subjType = isHo ? 'Hộ gia đình' : 'Cá nhân';
      const maGcn = `CHUACOGIAY_24478_${toM}_${thuaM}`;
      const fileName = `CHUACOGIAY_24478_${toM}_${thuaM}_DDK.pdf`;

      const colArray = new Array(57).fill('');
      colArray[0] = '24478';
      colArray[1] = maGcn;
      colArray[6] = cleanName;
      colArray[7] = dob;
      colArray[8] = gender;
      colArray[9] = cccd;
      colArray[10] = addr;
      colArray[11] = subjType;
      colArray[12] = subjType;
      colArray[20] = toM;
      colArray[21] = thuaM;
      colArray[22] = addr;
      colArray[23] = dt;
      colArray[24] = loaiDat;
      colArray[25] = dt;
      colArray[26] = origin;
      colArray[48] = fileName;

      rows.push(colArray.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    });

    const csvContent = '\uFEFF' + [headers_57.map((h) => `"${h}"`).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `EXCEL-57COT_NHAP_GGS_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };



  // Xuất file Excel / CSV cho bảng báo cáo đang xem
  const handleExportReportSheet = (sheetName: string) => {
    const rows = syncSheetsData?.[sheetName] || (sheetName === 'CHỜ NHẬP' ? syncSheetsData?.['NHẬP GGS'] : undefined);
    if (!rows) return;
    const csvContent =
      '\uFEFF' +
      rows
        .map((row) =>
          row
            .map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`)
            .join(',')
        )
        .join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = sheetName.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
    link.download = `BAO_CAO_${safeName}_${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Xuất Báo Cáo Thống Kê Tiến Độ Toàn Xã (Trang 1: 4 nhóm & 16 thôn buôn, Trang 2+: Lưới 3 cột chuẩn)
  const handleExportStatisticsPdf = async () => {
    try {
      setIsExportingStatsPdf(true);
      setExportStatsProgress('Đang chuẩn bị dữ liệu...');
      const { pdfBytes, fileName } = await generateStatisticsPdf(
        syncSheetsData,
        computedParcels,
        (msg) => setExportStatsProgress(msg)
      );
      downloadPdfBlob(pdfBytes, fileName);
    } catch (err: any) {
      console.error('Lỗi xuất PDF thống kê:', err);
      alert('Không thể xuất PDF thống kê: ' + (err.message || 'Lỗi không xác định'));
    } finally {
      setIsExportingStatsPdf(false);
      setExportStatsProgress('');
    }
  };

  // Đóng tập PDF các thửa Sẵn sàng đóng tập (có CCCD) chuẩn logic PDF_Web_App
  const handleGenerateReadyToPackPdf = async (specificCodes?: string[]) => {
    const readyRows = syncSheetsData?.['THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'] || [];
    if (readyRows.length <= 1) {
      alert('Hiện tại chưa có thửa nào sẵn sàng đóng tập (có CCCD).');
      return;
    }

    const dataRows = readyRows.slice(1);
    const filterSet = specificCodes && specificCodes.length > 0 ? new Set(specificCodes) : null;
    const targetRows = filterSet ? dataRows.filter((r) => filterSet.has(String(r[1] || '').trim())) : dataRows;

    if (targetRows.length === 0) {
      alert('Chưa chọn thửa đất nào để đóng tập.');
      return;
    }

    try {
      setIsPackagingPdf(true);
      setPackagingProgress(`Đang chuẩn bị ${targetRows.length} thửa...`);

      const items: ReadyToPackItem[] = targetRows.map((row) => {
        const maThua = String(row[1] || '').trim();
        const cccdRaw = String(row[8] || row[6] || '').replace(/^="|"$/g, '');
        const cccdFormula = String(row[12] || row[10] || '');
        const cccdFileName =
          cccdFormula.replace(/.*"([^"]+\.pdf)".*/i, '$1') || (cccdRaw ? `${cccdRaw}.pdf` : '');
        const cccdUrl = cccdFileName ? `/api/image/cccd/${encodeURIComponent(cccdFileName)}` : undefined;

        const p = computedParcels.find((cp) => cp.ma_thua === maThua);
        const decl = declarationsMap[maThua];

        const gcnList: string[] = [];
        if (decl?.anh_gcn_list && decl.anh_gcn_list.length > 0) gcnList.push(...decl.anh_gcn_list);
        else if (decl?.anh_gcn) gcnList.push(decl.anh_gcn);
        else if (p?.gcn_urls && p.gcn_urls.length > 0) gcnList.push(...p.gcn_urls);

        return {
          ma_thua: maThua,
          to_ban_do: String(row[2] || p?.to_ban_do || ''),
          so_thua: String(row[3] || p?.so_thua || ''),
          thon_xa: String(row[4] || p?.thon_xa || ''),
          chu_ho: String(row[5] || p?.chu_ho || ''),
          dob: String(row[6] || decl?.chu_dat_nam_sinh || ''),
          gender: String(row[7] || decl?.chu_dat_gioi_tinh || ''),
          cccd: cccdRaw || p?.cccd || decl?.chu_dat_cccd,
          dien_tich: String(row[9] || p?.dien_tich || ''),
          loai_dat: String(row[10] || p?.loai_dat || 'DGT'),
          nguon_goc: String(row[11] || decl?.nguon_goc_su_dung || 'Khai hoang'),
          cccd_file: cccdFileName,
          cccd_url: cccdUrl || decl?.anh_cccd_truoc || p?.cccd_url,
          has_gcn: gcnList.length > 0 || Boolean(p?.has_gcn),
          gcn_urls: gcnList,
        };
      });

      const { pdfBytes, fileName } = await generateReadyToPackPdf(items, (cur, tot, msg) => {
        setPackagingProgress(msg);
      });

      const blobUrl = downloadPdfBlob(pdfBytes, fileName);
      setPackagingDoneUrl(blobUrl);
      setPackagingDoneFileName(fileName);

      // Đánh dấu các thửa vừa đóng tập xong vào bộ nhớ local
      const packagedCodes = items.map((it) => it.ma_thua).filter(Boolean);
      markParcelsAsPackaged(packagedCodes);
    } catch (err: any) {
      console.error('Lỗi đóng tập PDF:', err);
      alert('Không thể đóng tập PDF: ' + (err.message || 'Lỗi không xác định'));
    } finally {
      setIsPackagingPdf(false);
      setPackagingProgress('');
    }
  };

  // Đóng tập PDF các thửa Sẵn sàng đóng tập (xem trước / in ấn qua modal)
  const handleBatchPrintReadyToPack = (specificCodes?: string[]) => {
    const readyRows = syncSheetsData?.['THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'] || [];
    if (readyRows.length <= 1) {
      alert('Hiện tại chưa có thửa nào sẵn sàng đóng tập (có CCCD).');
      return;
    }

    const dataRows = readyRows.slice(1);
    const filterSet = specificCodes && specificCodes.length > 0 ? new Set(specificCodes) : null;
    const targetRows = filterSet ? dataRows.filter((r) => filterSet.has(String(r[1] || '').trim())) : dataRows;

    if (targetRows.length === 0) {
      alert('Chưa chọn thửa đất nào để đóng tập.');
      return;
    }

    const itemsToPrint: PrintableDeclarationItem[] = [];

    targetRows.forEach((row) => {
      const maThua = String(row[1] || '').trim();
      if (!maThua) return;
      const cccdRaw = String(row[8] || row[6] || '').replace(/^="|"$/g, '');
      const cccdFileName = String(row[12] || row[10] || '').replace(/.*"([^"]+\.pdf)".*/i, '$1');
      const cccdUrl = cccdFileName && cccdFileName.endsWith('.pdf')
        ? `/api/image/cccd/${encodeURIComponent(cccdFileName)}`
        : null;

      const p = computedParcels.find((cp) => cp.ma_thua === maThua) || {
        ma_thua: maThua,
        to_ban_do: String(row[2] || ''),
        so_thua: String(row[3] || ''),
        thon_xa: String(row[4] || ''),
        ten_xa_goc: 'Xã Cư Pui',
        chu_ho: String(row[5] || ''),
        cccd: cccdRaw,
        loai_dat: String(row[10] || 'DGT'),
        dien_tich: String(row[9] || ''),
        trang_thai: 'DA_KE_KHAI_CHUA_SO_HOA_LAM',
        lat: null,
        lng: null,
        gmap_link: '',
        cccd_url: cccdUrl,
      };

      const decl = declarationsMap[maThua] || {
        ma_thua: maThua,
        to_ban_do: row[2],
        so_thua: row[3],
        chu_dat_ten: row[5],
        chu_dat_cccd: cccdRaw,
        dien_tich: row[9],
        loai_dat: row[10],
        dia_chi_thua_dat: row[4],
        anh_cccd_truoc: cccdUrl,
      };

      itemsToPrint.push({
        parcel: { ...p, cccd_url: cccdUrl || p.cccd_url },
        declaration: { ...decl, anh_cccd_truoc: cccdUrl || decl.anh_cccd_truoc },
      });
    });

    if (itemsToPrint.length > 0) {
      setPrintableItems(itemsToPrint);
      setPrintModalTitle(`Tập Hồ Sơ Sẵn Sàng Đóng Tập (${itemsToPrint.length} thửa đất kèm CCCD)`);
      setIsPrintModalOpen(true);
    }
  };

  // 10. ĐÓNG TẬP PDF ĐƠN KÊ KHAI HÔM NAY CHO VIỆC IN
  const handleOpenPrintToday = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayItems: PrintableDeclarationItem[] = [];

    Object.entries(declarationsMap).forEach(([maThua, decl]: [string, any]) => {
      if (decl.created_at && decl.created_at.startsWith(todayStr)) {
        const p = computedParcels.find((cp) => cp.ma_thua === maThua);
        if (p) {
          todayItems.push({ parcel: p, declaration: decl });
        }
      }
    });

    if (todayItems.length > 0) {
      setPrintableItems(todayItems);
      setPrintModalTitle(`Tập Đơn Kê Khai Trong Ngày Hôm Nay (${todayItems.length} thửa)`);
      setIsPrintModalOpen(true);
    } else {
      const allDeclared: PrintableDeclarationItem[] = [];
      Object.entries(declarationsMap).forEach(([maThua, decl]: [string, any]) => {
        const p = computedParcels.find((cp) => cp.ma_thua === maThua);
        if (p) {
          allDeclared.push({ parcel: p, declaration: decl });
        }
      });

      if (allDeclared.length > 0) {
        setPrintableItems(allDeclared);
        setPrintModalTitle(`Tập Đơn Kê Khai Toàn Bộ Đã Thu Thập (${allDeclared.length} thửa)`);
        setIsPrintModalOpen(true);
      } else {
        alert(
          'Hôm nay chưa có đơn kê khai mới.\n\n👉 Bạn hãy tích chọn các thửa cần in từ bảng danh sách bên dưới rồi bấm "Đóng Tập PDF Được Chọn".'
        );
      }
    }
  };

  // 11. ĐÓNG TẬP PDF CHO CÁC THỬA ĐƯỢC CHỌN
  const handleOpenPrintSelected = () => {
    if (selectedParcelCodes.size === 0) {
      alert('Vui lòng tích chọn ít nhất 1 thửa đất trên bảng để xuất tập PDF.');
      return;
    }

    const items: PrintableDeclarationItem[] = [];
    selectedParcelCodes.forEach((code) => {
      const p = computedParcels.find((cp) => cp.ma_thua === code);
      if (p) {
        items.push({
          parcel: p,
          declaration: declarationsMap[code] || {},
        });
      }
    });

    setPrintableItems(items);
    setPrintModalTitle(`Tập Đơn Kê Khai Đất Đai (${items.length} thửa đã chọn)`);
    setIsPrintModalOpen(true);
  };

  // 12. In đơn lẻ cho 1 thửa
  const handleOpenPrintSingle = (p: Parcel) => {
    setPrintableItems([
      {
        parcel: p,
        declaration: declarationsMap[p.ma_thua] || {},
      },
    ]);
    setPrintModalTitle(`Đơn Kê Khai Đất Đai - Thửa ${p.so_thua} (Tờ ${p.to_ban_do})`);
    setIsPrintModalOpen(true);
  };

  // 13. Mở Modal chi tiết thửa đất
  const handleOpenDetailModal = (parcel: Parcel) => {
    setActiveParcelDetail(parcel);
    setIsDetailModalOpen(true);
  };

  // 14. Mở Lightbox xem ảnh lớn
  const handleOpenImageViewer = (url: string, urls?: string[], title?: string) => {
    setViewerData({
      url,
      urls: urls && urls.length > 0 ? urls : [url],
      title: title || 'Hình ảnh hồ sơ thửa đất',
      owner: activeParcelDetail?.chu_ho,
      cccd: activeParcelDetail?.cccd,
    });
    setIsImageViewerOpen(true);
  };

  // 15. Xuất file CSV toàn bộ danh sách đang lọc
  const handleExportCsv = () => {
    const headers = [
      'STT',
      'Số Thửa',
      'Tờ Bản Đồ',
      'Thôn / Buôn',
      'Chủ Hộ',
      'Số CCCD',
      'Loại Đất',
      'Diện Tích (m2)',
      'Trạng Thái',
      'Vĩ Độ (Lat)',
      'Kinh Độ (Lng)',
      'Link Google Maps',
    ];

    const rows = filteredParcels.map((p, idx) => {
      const statusText =
        p.trang_thai === 'DA_SO_HOA_XANH'
          ? 'Đã số hóa (GGS)'
          : p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
          ? 'Đã kê khai (Chưa lên GGS)'
          : p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG'
          ? 'Chưa kê khai - Có tên'
          : 'Chưa kê khai - Không có tên';

      return [
        idx + 1,
        `"${p.so_thua || ''}"`,
        `"${p.to_ban_do || ''}"`,
        `"${(p.thon_xa || '').replace(/"/g, '""')}"`,
        `"${(p.chu_ho || '').replace(/"/g, '""')}"`,
        `"${p.cccd ? `'${p.cccd}` : ''}"`,
        `"${p.loai_dat || ''}"`,
        p.dien_tich || '0',
        `"${statusText}"`,
        p.lat || '',
        p.lng || '',
        `"${p.gmap_link || ''}"`,
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Bao_cao_dia_chinh_Cu_Pui_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isLight = theme === 'light';

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-200 selection:bg-blue-600 selection:text-white ${
      isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950 text-slate-100'
    }`}>
      {/* Top Navigation Bar */}
      <header className={`sticky top-0 z-40 backdrop-blur-md border-b shadow-md transition-colors duration-200 no-print ${
        isLight ? 'bg-white/95 border-slate-200' : 'bg-slate-900/90 border-slate-800'
      }`}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <Link
              href="/"
              className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 transition transform active:scale-95 shrink-0"
              title="Về Bản đồ Vệ tinh"
            >
              <MapIcon className="w-5 h-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className={`text-base sm:text-lg font-black tracking-tight flex items-center gap-1.5 ${
                  isLight ? 'text-slate-900' : 'text-white'
                }`}>
                  Dashboard Địa Chính
                  <span className="text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-500 border border-blue-500/30">
                    Xã Cư Pui
                  </span>
                </h1>
              </div>
              <p className={`text-[11px] sm:text-xs hidden sm:block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Hệ thống giám sát tiến độ số hóa & quản trị cơ sở dữ liệu 5.943 thửa đất
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. Nút Tiến Độ 16 Thôn / Buôn trên Header */}
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'villages' ? 'progressReport' : 'villages')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer shadow-md border ${
                activeTab === 'villages'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-600/30 ring-2 ring-emerald-400'
                  : isLight
                  ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                  : 'bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border-emerald-700/50'
              }`}
              title="Xem bảng thống kê chi tiết tiến độ 16 thôn buôn xã Cư Pui"
            >
              <Building2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tiến Độ 16 Thôn / Buôn</span>
            </button>

            {/* 2. Nút Kho CCCD (Quản Lý R2) trên Header */}
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'cccd' ? 'progressReport' : 'cccd')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer shadow-md border ${
                activeTab === 'cccd'
                  ? 'bg-purple-600 text-white border-purple-500 shadow-purple-600/30 ring-2 ring-purple-400'
                  : isLight
                  ? 'bg-purple-50 hover:bg-purple-100 text-purple-800 border-purple-300'
                  : 'bg-purple-950/60 hover:bg-purple-900/70 text-purple-300 border-purple-700/50'
              }`}
              title="Mở kho lưu trữ và quản lý ảnh/PDF CCCD trên Cloudflare R2"
            >
              <FolderOpen className="w-3.5 h-3.5 text-purple-400" />
              <span>Kho CCCD (R2)</span>
            </button>

            {/* 3. Nút Kho File Scan (Quản Lý R2) trên Header */}
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'filescan' ? 'progressReport' : 'filescan')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer shadow-md border ${
                activeTab === 'filescan'
                  ? 'bg-sky-600 text-white border-sky-500 shadow-sky-600/30 ring-2 ring-sky-400'
                  : isLight
                  ? 'bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-300'
                  : 'bg-sky-950/60 hover:bg-sky-900/70 text-sky-300 border-sky-700/50'
              }`}
              title="Mở kho lưu trữ và quản lý file scan hồ sơ đã ký trên Cloudflare R2"
            >
              <HardDrive className="w-3.5 h-3.5 text-sky-400" />
              <span>Kho File Scan (R2)</span>
            </button>

            {/* Nút mở công cụ ScanName (Tách PDF & Đổi tên hồ sơ scan sau ký) */}
            <a
              href="/scanname"
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer shadow-md border ${
                isLight
                  ? 'bg-gradient-to-r from-indigo-50 to-blue-50 hover:from-indigo-100 hover:to-blue-100 text-indigo-700 border-indigo-200'
                  : 'bg-gradient-to-r from-indigo-950/80 to-purple-950/80 hover:from-indigo-900 hover:to-purple-900 text-indigo-300 border-indigo-500/40 shadow-indigo-950/40'
              }`}
              title="Mở công cụ Tách PDF & Quét CCCD / Đổi tên hồ sơ scan (ScanName)"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
              <span>ScanName (Tách PDF)</span>
            </a>

            {/* Nút Xuất PDF Báo Cáo Thống Kê Tiến Độ Toàn Xã (Trang 1: 4 nhóm & 16 thôn, Trang 2+: Lưới 3 cột) */}
            <button
              type="button"
              disabled={isExportingStatsPdf}
              onClick={handleExportStatisticsPdf}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black shadow-md transition cursor-pointer disabled:opacity-75 border ${
                isLight
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border-blue-600 shadow-blue-500/25'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border-blue-500/40 shadow-blue-900/40'
              }`}
              title="Xuất PDF Báo cáo thống kê tiến độ 16 thôn buôn & danh sách có tên chưa thực hiện (khổ 3 cột chuẩn như ảnh)"
            >
              {isExportingStatsPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <FileBarChart2 className="w-3.5 h-3.5 text-amber-300" />
              )}
              <span>{isExportingStatsPdf ? exportStatsProgress || 'Đang tạo PDF...' : 'Xuất PDF Thống Kê'}</span>
            </button>

            {/* Nút Chuyển Giao Diện Light / Dark Mode */}
            <button
              onClick={toggleTheme}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-xs border ${
                isLight
                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
              }`}
              title={isLight ? 'Chuyển sang Giao diện Tối (Dark mode)' : 'Chuyển sang Giao diện Sáng (Light mode)'}
            >
              {isLight ? <Moon className="w-3.5 h-3.5 text-indigo-600" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
              <span>{isLight ? 'Theme Tối' : 'Theme Sáng'}</span>
            </button>

            {/* Đồng bộ GGS */}
            <button
              onClick={() => fetchGgsCodes()}
              disabled={isSyncingGgs}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition disabled:opacity-60 shadow-xs cursor-pointer border ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border-cyan-500/30'
              }`}
              title={lastSyncTime ? `Đồng bộ lúc ${lastSyncTime}` : 'Đồng bộ Google Sheets'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingGgs ? 'animate-spin text-cyan-400' : ''}`} />
              <span className="hidden md:inline">GGS Live</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </button>

            <Link
              href="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/25 transition"
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Xem Bản Đồ</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
        {/* Executive KPI Cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Card 1: Tổng Thửa Quản Lý */}
          <div className={`border rounded-2xl p-4 shadow-sm transition relative overflow-hidden group ${
            isLight
              ? 'bg-white border-slate-200 hover:border-slate-300'
              : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
          }`}>
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/10 rounded-full blur-2xl group-hover:bg-blue-600/20 transition" />
            <div className={`flex items-center justify-between text-xs mb-2 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              <span className="font-semibold uppercase tracking-wider text-[10px]">Tổng Thửa Quản Lý</span>
              <Building2 className="w-4 h-4 text-blue-500" />
            </div>
            <div className={`text-2xl sm:text-3xl font-black tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {globalStats.total.toLocaleString('vi-VN')}
              <span className={`text-xs font-normal ml-1.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>thửa</span>
            </div>
            <div className={`mt-2 flex items-center justify-between text-[11px] pt-2 border-t ${
              isLight ? 'border-slate-100 text-slate-500' : 'border-slate-800/80 text-slate-400'
            }`}>
              <span>Quy mô diện tích:</span>
              <strong className="text-blue-500 font-bold">{globalStats.totalAreaHa.toLocaleString('vi-VN')} ha</strong>
            </div>
          </div>

          {/* Card 2: Đã Số Hóa & Đã Giải Quyết */}
          <div
            onClick={() => {
              setSelectedReportSheet('ĐÃ GIẢI QUYẾT');
              setActiveTab('progressReport');
              setReportPage(1);
            }}
            className={`border rounded-2xl p-4 shadow-sm transition relative overflow-hidden group cursor-pointer ${
              selectedReportSheet === 'ĐÃ GIẢI QUYẾT' && activeTab === 'progressReport'
                ? 'ring-2 ring-emerald-500 border-emerald-500'
                : isLight
                ? 'bg-white border-emerald-200 hover:border-emerald-300'
                : 'bg-slate-900/90 border-emerald-500/30 hover:border-emerald-500/50'
            }`}
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition" />
            <div className="flex items-center justify-between text-emerald-500 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Đã Số Hóa & Đã Giải Quyết
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div className={`text-2xl sm:text-3xl font-black tracking-tight ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}>
              {globalStats.green.toLocaleString('vi-VN')}
              <span className={`text-xs font-normal ml-1.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>thửa</span>
            </div>
            <div className={`mt-2 flex items-center justify-between text-[11px] pt-2 border-t ${
              isLight ? 'border-slate-100 text-slate-500' : 'border-slate-800/80 text-slate-400'
            }`}>
              <span>Đã số hóa (GGS): <strong className="text-emerald-600 font-bold">{globalStats.green.toLocaleString('vi-VN')}</strong></span>
              <span>Đã giải quyết: <strong className="text-emerald-500 font-bold">{syncSummary?.daGiaiQuyet || 0}</strong></span>
            </div>
          </div>

          {/* Card 3: Chưa Thực Hiện Kê Khai */}
          <div
            onClick={() => {
              setSelectedReportSheet('CHƯA THỰC HIỆN');
              setActiveTab('progressReport');
              setReportPage(1);
            }}
            className={`border rounded-2xl p-4 shadow-sm transition relative overflow-hidden group cursor-pointer ${
              selectedReportSheet === 'CHƯA THỰC HIỆN' && activeTab === 'progressReport'
                ? 'ring-2 ring-rose-500 border-rose-500'
                : isLight
                ? 'bg-white border-amber-200 hover:border-amber-300'
                : 'bg-slate-900/90 border-amber-500/30 hover:border-amber-500/50'
            }`}
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition" />
            <div className="flex items-center justify-between text-amber-500 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                Chưa Thực Hiện Kê Khai
              </span>
              <Users className="w-4 h-4 text-amber-500" />
            </div>
            <div className={`text-2xl sm:text-3xl font-black tracking-tight ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
              {chuaThucHienParcels.length.toLocaleString('vi-VN')}
              <span className={`text-xs font-normal ml-1.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>thửa</span>
            </div>
            <div className={`mt-2 flex items-center justify-between text-[11px] pt-2 border-t ${
              isLight ? 'border-slate-100 text-slate-500' : 'border-slate-800/80 text-slate-400'
            }`}>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                Có tên: <strong className="text-amber-600 dark:text-amber-400 font-bold">{globalStats.yellow.toLocaleString('vi-VN')}</strong>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                Không tên: <strong className={`font-bold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>{globalStats.gray.toLocaleString('vi-VN')}</strong>
              </span>
            </div>
          </div>

          {/* Card 4: Đang Kê Khai (Hồ Sơ) */}
          <div
            onClick={() => {
              setSelectedReportSheet('THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)');
              setActiveTab('progressReport');
              setReportPage(1);
            }}
            className={`border rounded-2xl p-4 shadow-sm transition relative overflow-hidden group cursor-pointer ${
              selectedReportSheet === 'THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)' && activeTab === 'progressReport'
                ? 'ring-2 ring-indigo-500 border-indigo-500'
                : isLight
                ? 'bg-white border-indigo-200 hover:border-indigo-300'
                : 'bg-slate-900/90 border-indigo-500/30 hover:border-indigo-500/50'
            }`}
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition" />
            <div className="flex items-center justify-between text-indigo-500 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                Đang Kê Khai (Hồ Sơ)
              </span>
              <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
            </div>
            <div className={`text-2xl sm:text-3xl font-black tracking-tight ${isLight ? 'text-indigo-700' : 'text-indigo-300'}`}>
              {(syncSummary ? syncSummary.canTimCccd + syncSummary.khongCoCccd + syncSummary.daDongTap : 139).toLocaleString('vi-VN')}
              <span className={`text-xs font-normal ml-1.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>hồ sơ</span>
            </div>
            <div className={`mt-2 flex items-center justify-between text-[11px] pt-2 border-t ${
              isLight ? 'border-slate-100 text-slate-500' : 'border-slate-800/80 text-slate-400'
            }`}>
              <span>Chưa CCCD: <strong className="text-amber-500 font-bold">{syncSummary ? (syncSummary.canTimCccd + syncSummary.khongCoCccd) : 132}</strong></span>
              <span>Sẵn sàng: <strong className="text-indigo-500 font-bold">{syncSummary?.daDongTap ?? 7}</strong></span>
            </div>
          </div>
        </section>

        {/* TAB 3: DANH SÁCH CHI TIẾT TẤT CẢ THÔN / BUÔN */}
        {activeTab === 'villages' && (
          <div className={`border rounded-2xl p-4 sm:p-6 shadow-sm space-y-4 ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className={`text-base font-bold flex items-center gap-2 ${
                  isLight ? 'text-slate-900' : 'text-white'
                }`}>
                  <Building2 className="w-4 h-4 text-blue-500" />
                  Tiến Độ Số Hóa Từng Thôn / Buôn ({villageStats.length} địa bàn)
                </h3>
                <p className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Bấm vào thôn bất kỳ để xem danh sách các thửa đất tương ứng
                </p>
              </div>
              <span className={`text-xs px-3 py-1 rounded-xl border ${
                isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}>
                Tổng quản lý: <strong>{globalStats.total.toLocaleString('vi-VN')} thửa</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {villageStats.map((v) => (
                <div
                  key={v.name}
                  onClick={() => {
                    setSelectedReportSheet('THỐNG KÊ');
                    setReportSearchQuery(v.name);
                    setActiveTab('progressReport');
                  }}
                  className={`p-4 rounded-xl border transition cursor-pointer group shadow-xs ${
                    isLight
                      ? 'bg-slate-50/80 hover:bg-white border-slate-200 hover:border-blue-400 hover:shadow-md'
                      : 'bg-slate-950/70 hover:bg-slate-950 border-slate-800 hover:border-blue-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <strong className={`text-sm font-bold transition truncate max-w-[200px] ${
                      isLight ? 'text-slate-800 group-hover:text-blue-600' : 'text-white group-hover:text-blue-300'
                    }`}>
                      {v.name}
                    </strong>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      {v.rate}% GGS
                    </span>
                  </div>

                  <div className={`w-full h-2 rounded-full overflow-hidden flex my-2 ${
                    isLight ? 'bg-slate-200' : 'bg-slate-900'
                  }`}>
                    <div style={{ width: `${v.rate}%` }} className="bg-emerald-500 h-full rounded-l-full" />
                    <div
                      style={{ width: `${v.total > 0 ? (v.yellow / v.total) * 100 : 0}%` }}
                      className="bg-amber-500 h-full"
                    />
                    <div
                      style={{ width: `${v.total > 0 ? (v.gray / v.total) * 100 : 0}%` }}
                      className={isLight ? 'bg-slate-300 h-full rounded-r-full' : 'bg-slate-700 h-full rounded-r-full'}
                    />
                  </div>

                  <div className={`grid grid-cols-3 gap-1 text-[11px] mt-2 pt-2 border-t ${
                    isLight ? 'border-slate-200 text-slate-500' : 'border-slate-800/60 text-slate-400'
                  }`}>
                    <div>
                      <span className={`block text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>Tổng thửa:</span>
                      <strong className={isLight ? 'text-slate-800' : 'text-slate-200'}>{v.total}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-emerald-600 dark:text-emerald-500">Đã số hóa:</span>
                      <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{v.green}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-amber-600 dark:text-amber-500">Có tên:</span>
                      <strong className="text-amber-600 dark:text-amber-400 font-bold">{v.yellow}</strong>
                    </div>
                  </div>

                  <div className={`mt-2 text-[10px] font-semibold group-hover:underline flex items-center justify-between ${
                    isLight ? 'text-blue-600' : 'text-blue-400'
                  }`}>
                    <span>Quy mô: {v.totalAreaHa} ha</span>
                    <span>Xem danh sách →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: QUẢN LÝ KHO CCCD (CLOUDFLARE R2) */}
        {activeTab === 'cccd' && (
          <CccdManagerTab
            theme={theme}
            onOpenAddModal={(mode) => {
              setSelectedParcelForCccd('');
              setCccdModalMode(mode || 'folder');
              setIsCccdSupplementOpen(true);
            }}
            onSelectParcel={(code) => {
              const p = computedParcels.find((cp) => cp.ma_thua === code);
              if (p) {
                setActiveParcelDetail(p);
                setIsDetailModalOpen(true);
              }
            }}
          />
        )}

        {/* TAB 5b: QUẢN LÝ KHO FILE SCAN (CLOUDFLARE R2) */}
        {activeTab === 'filescan' && (
          <ScanFileManagerTab
            theme={theme}
            onSelectParcel={(code) => {
              const p = computedParcels.find((cp) => cp.ma_thua === code);
              if (p) {
                setActiveParcelDetail(p);
                setIsDetailModalOpen(true);
              }
            }}
          />
        )}

        {/* TAB 6: BÁO CÁO TIẾN ĐỘ 16 THÔN & ĐÓNG TẬP NỘI BỘ (THAY THẾ THỐNG KÊ & DSTONG GGS) */}
        {activeTab === 'progressReport' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* 4 Nhóm Danh Sách Tiến Độ Dạng Ô Thẻ Tương Tác (Theo phong cách 4 Thẻ KPI trên) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[
                {
                  id: 'CHƯA THỰC HIỆN',
                  index: '0',
                  label: '0. Chưa Thực Hiện (Chưa Kê Khai)',
                  shortTitle: 'Chưa Thực Hiện',
                  count: chuaThucHienParcels.length,
                  subLabel: `Có tên: ${globalStats.yellow.toLocaleString('vi-VN')}`,
                  subLabelRight: `Không tên: ${globalStats.gray.toLocaleString('vi-VN')}`,
                  icon: Users,
                  borderActive: 'border-amber-500 ring-2 ring-amber-500/50',
                  bgActiveLight: 'bg-amber-50/70',
                  bgActiveDark: 'bg-amber-950/20',
                  textCount: isLight ? 'text-amber-700' : 'text-amber-300',
                  dotColor: 'bg-amber-400',
                  glowColor: 'bg-amber-500/10 group-hover:bg-amber-500/20',
                },
                {
                  id: 'THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)',
                  index: '1',
                  label: '1. Đang Kê Khai (Chưa có CCCD)',
                  shortTitle: 'Đang Kê Khai (Chưa CCCD)',
                  count: syncSummary ? syncSummary.canTimCccd + syncSummary.khongCoCccd : 132,
                  subLabel: `Cần tìm: ${syncSummary?.canTimCccd ?? 0}`,
                  subLabelRight: `Chưa có: ${syncSummary?.khongCoCccd ?? 0}`,
                  icon: FileSpreadsheet,
                  borderActive: 'border-rose-500 ring-2 ring-rose-500/50',
                  bgActiveLight: 'bg-rose-50/70',
                  bgActiveDark: 'bg-rose-950/20',
                  textCount: isLight ? 'text-rose-700' : 'text-rose-300',
                  dotColor: 'bg-rose-500 animate-pulse',
                  glowColor: 'bg-rose-500/10 group-hover:bg-rose-500/20',
                },
                {
                  id: 'THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)',
                  index: '2',
                  label: '2. Sẵn Sàng Đóng Tập (Có CCCD)',
                  shortTitle: 'Sẵn Sàng Đóng Tập',
                  count: syncSummary?.daDongTap ?? 7,
                  subLabel: 'Hồ sơ đủ CCCD',
                  subLabelRight: 'Sẵn sàng in & scan',
                  icon: Printer,
                  borderActive: 'border-indigo-500 ring-2 ring-indigo-500/50',
                  bgActiveLight: 'bg-indigo-50/70',
                  bgActiveDark: 'bg-indigo-950/20',
                  textCount: isLight ? 'text-indigo-700' : 'text-indigo-300',
                  dotColor: 'bg-indigo-500 animate-pulse',
                  glowColor: 'bg-indigo-500/10 group-hover:bg-indigo-500/20',
                },
                {
                  id: 'ĐÃ GIẢI QUYẾT',
                  index: '3',
                  label: '3. Đã Giải Quyết (GGS & Đã Scan)',
                  shortTitle: 'Đã Giải Quyết',
                  count: syncSummary?.daGiaiQuyet ?? globalStats.green,
                  subLabel: 'Đã scan & GGS',
                  subLabelRight: 'Hoàn tất quy trình',
                  icon: CheckCircle2,
                  borderActive: 'border-emerald-500 ring-2 ring-emerald-500/50',
                  bgActiveLight: 'bg-emerald-50/70',
                  bgActiveDark: 'bg-emerald-950/20',
                  textCount: isLight ? 'text-emerald-700' : 'text-emerald-300',
                  dotColor: 'bg-emerald-500',
                  glowColor: 'bg-emerald-500/10 group-hover:bg-emerald-500/20',
                },
              ].map((card) => {
                const isActive = selectedReportSheet === card.id;
                const IconComponent = card.icon;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      setSelectedReportSheet(card.id);
                      setReportPage(1);
                      setReportSearchQuery('');
                    }}
                    className={`text-left border rounded-2xl p-4 shadow-sm transition relative overflow-hidden group cursor-pointer ${
                      isActive
                        ? `${card.borderActive} ${isLight ? card.bgActiveLight : card.bgActiveDark}`
                        : isLight
                        ? 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md'
                        : 'bg-slate-900/90 border-slate-800 hover:border-slate-700 hover:shadow-md'
                    }`}
                  >
                    <div className={`absolute top-0 right-0 w-24 h-24 ${card.glowColor} rounded-full blur-2xl transition`} />

                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className={`font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5 ${
                        isActive
                          ? isLight ? 'text-slate-900 font-black' : 'text-white font-black'
                          : isLight ? 'text-slate-500' : 'text-slate-400'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${card.dotColor}`} />
                        {card.index}. {card.shortTitle}
                      </span>
                      <IconComponent className={`w-4 h-4 ${
                        isActive ? (isLight ? 'text-slate-900' : 'text-white') : isLight ? 'text-slate-400' : 'text-slate-500'
                      }`} />
                    </div>

                    <div className={`text-2xl sm:text-3xl font-black tracking-tight ${card.textCount}`}>
                      {card.count.toLocaleString('vi-VN')}
                      <span className={`text-xs font-normal ml-1.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>thửa</span>
                    </div>

                    <div className={`mt-2 flex items-center justify-between text-[11px] pt-2 border-t ${
                      isLight ? 'border-slate-100 text-slate-500' : 'border-slate-800/80 text-slate-400'
                    }`}>
                      <span>{card.subLabel}</span>
                      <span className="font-semibold">{card.subLabelRight}</span>
                    </div>

                    {/* Indicator pill khi đang chọn */}
                    {isActive && (
                      <div className="mt-2.5 flex items-center justify-center">
                        <span className={`w-full text-center text-[10px] font-black py-0.5 rounded-md border ${
                          isLight ? 'bg-white/90 text-slate-800 border-slate-300' : 'bg-slate-800/90 text-slate-200 border-slate-700'
                        }`}>
                          Đang hiển thị danh sách này
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* BẢNG DỮ LIỆU CÁC SHEET CHI TIẾT (0. Chưa Kê Khai, 1. Chưa Có CCCD, 2. Sẵn Sàng Đóng Tập, 3. Chờ Nhập, 4. Đã Giải Quyết) */}
            <div className={`border rounded-2xl p-4 sm:p-5 shadow-sm space-y-4 ${
                isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
              }`}>
                {(() => {
                  let rawSheet = syncSheetsData?.[selectedReportSheet] || [];
                  if (selectedReportSheet === 'CHƯA THỰC HIỆN') {
                    const headersChuaThucHien = [
                      'STT', 'Mã thửa', 'Tờ BĐ', 'Số thửa', 'Thôn / Buôn', 'Họ và tên chủ đất (dự kiến)',
                      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng',
                      'Trạng thái dữ liệu'
                    ];
                    const rowsChuaThucHien = chuaThucHienParcels.map((p, idx) => {
                      const cccdText = p.cccd ? `="${p.cccd}"` : 'Chưa có';
                      return [
                        String(idx + 1),
                        p.ma_thua,
                        p.to_ban_do || '',
                        p.so_thua || '',
                        p.thon_xa || 'Chưa rõ thôn',
                        p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG' ? (p.chu_ho || 'Chưa có tên') : 'Chưa có tên',
                        (p as any).ngay_sinh || '',
                        (p as any).gioi_tinh || 'Nam',
                        cccdText,
                        p.dien_tich || '0',
                        p.loai_dat || 'DGT',
                        'Khai hoang',
                        p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG' ? 'Có tên (Chưa kê khai)' : 'Chưa cập nhật / Không có DL'
                      ];
                    });
                    rawSheet = [headersChuaThucHien, ...rowsChuaThucHien];
                  }
                  const headers = [...(rawSheet[0] || [])];
                  const allRows = (rawSheet.slice(1) || []).map((r) => [...r]);

                  // Bỏ cột "Nguồn CCCD" khỏi bất kỳ sheet nào nếu tồn tại
                  const nguonCccdColIdx = headers.findIndex((h) => /nguồn.*cccd/i.test(h));
                  if (nguonCccdColIdx >= 0) {
                    headers.splice(nguonCccdColIdx, 1);
                    allRows.forEach((r) => r.splice(nguonCccdColIdx, 1));
                  }

                  // Nhận diện cột Thôn / Buôn, Họ và tên và Phân loại trạng thái
                  const villageColIdx = headers.findIndex((h) => /thôn|buôn/i.test(h));
                  const nameColIdx = headers.findIndex((h) => /họ và tên|chủ đất/i.test(h));
                  const statusColIdx = headers.findIndex((h) => /phân loại/i.test(h));

                  const isChuaThucHienSheet = selectedReportSheet === 'CHƯA THỰC HIỆN';
                  const isReadyToPackSheet = selectedReportSheet === 'THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)';
                  const isChuaCoCccdSheet = selectedReportSheet === 'THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)';

                  // Thống kê Thôn / Buôn và số lượng thửa
                  const villageCounts: Record<string, number> = {};
                  allRows.forEach((r) => {
                    if (villageColIdx >= 0) {
                      const v = String(r[villageColIdx] || '').trim();
                      if (v) villageCounts[v] = (villageCounts[v] || 0) + 1;
                    }
                  });
                  const availableVillages = Object.keys(villageCounts).sort((a, b) => a.localeCompare(b, 'vi'));

                  // Thống kê Có tên / Không có tên cho sheet Chưa thực hiện
                  let countCoTen = 0;
                  let countChuaCoTen = 0;
                  if (isChuaThucHienSheet && nameColIdx >= 0) {
                    allRows.forEach((r) => {
                      const maThua = String(r[1] || '').trim();
                      const nameVal = String(cellEdits[maThua]?.[nameColIdx] || r[nameColIdx] || '').trim();
                      const isNamed =
                        nameVal &&
                        nameVal !== 'Chưa có tên' &&
                        !nameVal.toLowerCase().includes('không có') &&
                        !nameVal.toLowerCase().includes('chưa có');
                      if (isNamed) countCoTen++;
                      else countChuaCoTen++;
                    });
                  }

                  // Danh sách Phân loại trạng thái (cho sheet Chưa có CCCD)
                  const statusCounts: Record<string, number> = {};
                  if (statusColIdx >= 0) {
                    allRows.forEach((r) => {
                      const st = String(r[statusColIdx] || '').trim();
                      if (st) statusCounts[st] = (statusCounts[st] || 0) + 1;
                    });
                  }

                  // Danh sách tất cả mã thửa duy nhất của sheet Chưa thực hiện (dùng cho Dropdown lọc kiểu Excel)
                  const distinctMaThuas = isChuaThucHienSheet
                    ? Array.from(new Set(allRows.map((r) => String(r[1] || '').trim()).filter(Boolean))).sort((a, b) => {
                        const [toA, thuaA] = a.split('_').map(Number);
                        const [toB, thuaB] = b.split('_').map(Number);
                        if (toA !== toB) return (toA || 0) - (toB || 0);
                        return (thuaA || 0) - (thuaB || 0);
                      })
                    : [];

                  const filteredDropdownList = distinctMaThuas.filter((mt) => {
                    if (!chuaThucHienFilterSearch.trim()) return true;
                    return mt.toLowerCase().includes(chuaThucHienFilterSearch.trim().toLowerCase());
                  });

                  // Áp dụng bộ lọc
                  const filtered = allRows.filter((row) => {
                    const maThua = String(row[1] || '').trim();

                    // 1. Tìm kiếm text (soát cả giá trị vừa nhập trực tiếp)
                    if (reportSearchQuery) {
                      const q = stripAccents(reportSearchQuery);
                      const match = row.some((cell, cIdx) => {
                        const val = String(cellEdits[maThua]?.[cIdx] ?? cell ?? '');
                        return stripAccents(val).includes(q);
                      });
                      if (!match) return false;
                    }

                    // 2. Lọc theo Thôn / Buôn
                    if (reportVillageFilter !== 'ALL' && villageColIdx >= 0) {
                      const v = String(cellEdits[maThua]?.[villageColIdx] ?? row[villageColIdx] ?? '').trim();
                      if (v !== reportVillageFilter) return false;
                    }

                    // 3. Lọc theo Phân loại trạng thái (cho sheet Đang kê khai - Chưa có CCCD)
                    if (reportStatusFilter !== 'ALL' && statusColIdx >= 0) {
                      const st = String(row[statusColIdx] || '').trim();
                      if (st !== reportStatusFilter) return false;
                    }

                    // 4. Lọc thửa Có tên / Không có tên (cho sheet Chưa thực hiện)
                    if (isChuaThucHienSheet && nameColIdx >= 0 && chuaThucHienNameFilter !== 'ALL') {
                      const nameVal = String(cellEdits[maThua]?.[nameColIdx] ?? row[nameColIdx] ?? '').trim();
                      const isNamed =
                        nameVal &&
                        nameVal !== 'Chưa có tên' &&
                        !nameVal.toLowerCase().includes('không có') &&
                        !nameVal.toLowerCase().includes('chưa có');
                      if (chuaThucHienNameFilter === 'CO_TEN' && !isNamed) return false;
                      if (chuaThucHienNameFilter === 'CHUA_CO_TEN' && isNamed) return false;
                    }

                    // 5. Lọc theo danh sách Mã thửa đã chọn từ dropdown Excel (cho sheet Chưa thực hiện)
                    if (isChuaThucHienSheet && appliedMaThuas.size > 0) {
                      if (!appliedMaThuas.has(maThua)) return false;
                    }

                    // 6. Lọc theo trạng thái đóng tập (cho sheet Sẵn sàng đóng tập)
                    if (isReadyToPackSheet && readyToPackStatusFilter !== 'ALL') {
                      const isPackaged = packagedParcelCodes.has(maThua);
                      if (readyToPackStatusFilter === 'UNPACKED' && isPackaged) return false;
                      if (readyToPackStatusFilter === 'PACKED' && !isPackaged) return false;
                    }

                    return true;
                  });

                  // Sắp xếp theo Tên chủ đất A -> Z hoặc Z -> A
                  if (nameColIdx >= 0 && sortNameOrder !== 'none') {
                    filtered.sort((a, b) => {
                      const maA = String(a[1] || '').trim();
                      const maB = String(b[1] || '').trim();
                      const nameA = String(cellEdits[maA]?.[nameColIdx] ?? a[nameColIdx] ?? '').trim();
                      const nameB = String(cellEdits[maB]?.[nameColIdx] ?? b[nameColIdx] ?? '').trim();
                      const cmp = nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
                      return sortNameOrder === 'asc' ? cmp : -cmp;
                    });
                  }

                  // Phân trang và Chế độ hiển thị Toàn bộ danh sách
                  const isAllRowsMode = reportPageSize === 'ALL';
                  const currentSize = isAllRowsMode ? Math.max(filtered.length, 1) : (reportPageSize as number);
                  const totalPages = isAllRowsMode ? 1 : Math.ceil(filtered.length / currentSize) || 1;
                  const safePage = Math.min(Math.max(1, reportPage), totalPages);
                  const pagedRows = isAllRowsMode
                    ? filtered
                    : filtered.slice((safePage - 1) * currentSize, safePage * currentSize);

                  const pageCodes = pagedRows.map((r) => String(r[1] || '').trim()).filter(Boolean);
                  const isAllPageSelected = pageCodes.length > 0 && pageCodes.every((c) => readyToPackSelectedCodes.has(c));
                  const isAllPageSelectedChuaThucHien = pageCodes.length > 0 && pageCodes.every((c) => chuaThucHienSelectedCodes.has(c));

                  const toggleSelectAllPageReadyToPack = () => {
                    setReadyToPackSelectedCodes((prev) => {
                      const next = new Set(prev);
                      if (isAllPageSelected) {
                        pageCodes.forEach((c) => next.delete(c));
                      } else {
                        pageCodes.forEach((c) => next.add(c));
                      }
                      return next;
                    });
                  };

                  const toggleSelectAllPageChuaThucHien = () => {
                    setChuaThucHienSelectedCodes((prev) => {
                      const next = new Set(prev);
                      if (isAllPageSelectedChuaThucHien) {
                        pageCodes.forEach((c) => next.delete(c));
                      } else {
                        pageCodes.forEach((c) => next.add(c));
                      }
                      return next;
                    });
                  };

                  const handleSelectAllFilteredChuaThucHien = () => {
                    setChuaThucHienSelectedCodes((prev) => {
                      const next = new Set(prev);
                      filtered.forEach((r) => {
                        const code = String(r[1] || '').trim();
                        if (code) next.add(code);
                      });
                      return next;
                    });
                  };

                  const handleCopySelectedChuaThucHienCodes = () => {
                    if (chuaThucHienSelectedCodes.size === 0) return;
                    const text = Array.from(chuaThucHienSelectedCodes).join(', ');
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(text);
                    }
                    setInlineSaveToast(`Đã sao chép ${chuaThucHienSelectedCodes.size} mã thửa vào clipboard!`);
                    setTimeout(() => setInlineSaveToast(null), 3000);
                  };

                  const isAnyFilterActive =
                    Boolean(reportSearchQuery) ||
                    reportVillageFilter !== 'ALL' ||
                    reportStatusFilter !== 'ALL' ||
                    chuaThucHienNameFilter !== 'ALL' ||
                    (isChuaThucHienSheet && appliedMaThuas.size > 0) ||
                    sortNameOrder !== 'none' ||
                    reportPageSize === 'ALL';

                  return (
                    <div className="space-y-4">
                      {/* Toast báo lưu realtime thành công */}
                      {inlineSaveToast && (
                        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
                          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>{inlineSaveToast}</span>
                        </div>
                      )}

                      {/* Toolbar trên cùng của bảng */}
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className={`text-sm sm:text-base font-bold flex items-center gap-2 ${
                              isLight ? 'text-slate-900' : 'text-white'
                            }`}>
                              <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
                              {selectedReportSheet}
                            </h3>
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                              isLight
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                            }`}>
                              {filtered.length} / {allRows.length} thửa
                            </span>
                          </div>
                          <p className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                            {isChuaThucHienSheet
                              ? 'Danh sách các thửa đất chưa kê khai • Nhập hoặc sửa trực tiếp trên bảng như Excel • Tự động lưu & đồng bộ realtime'
                              : isReadyToPackSheet
                              ? 'Hồ sơ đã đầy đủ CCCD và sẵn sàng đóng tập PDF • Nhập sửa trực tiếp như Excel • Hover vào ô Xem CCCD để xem chi tiết'
                              : isChuaCoCccdSheet
                              ? 'Danh sách cần bổ sung CCCD • Nhập sửa trực tiếp như Excel • Lọc theo Thôn buôn hoặc Phân loại để thu thập thuận tiện'
                              : 'Danh sách chi tiết được tạo tự động • Nhập sửa trực tiếp như Excel • Hỗ trợ tìm kiếm nhanh & xuất file'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Nút tác vụ đóng tập nếu là sheet Sẵn sàng đóng tập */}
                        {isReadyToPackSheet && (() => {
                          const allFilteredCodes = filtered.map((r) => String(r[1] || '').trim()).filter(Boolean);
                          const unpackedFilteredCodes = filtered
                            .map((r) => String(r[1] || '').trim())
                            .filter((c) => Boolean(c) && !packagedParcelCodes.has(c));

                          return (
                            <div className="flex items-center gap-2 flex-wrap">
                              {packagingDoneUrl ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const a = document.createElement('a');
                                      a.href = packagingDoneUrl;
                                      a.download = packagingDoneFileName || 'Tap_Ho_So_In_Co_Trang_CCCD.pdf';
                                      document.body.appendChild(a);
                                      a.click();
                                      document.body.removeChild(a);
                                    }}
                                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black shadow-md transition cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/30"
                                    title="Bấm để tải lại file PDF đã đóng tập kèm bìa CCCD"
                                  >
                                    <Download className="w-3.5 h-3.5 text-white animate-bounce" />
                                    <span>
                                      Tải Tập PDF Đã Đóng ({readyToPackSelectedCodes.size > 0 ? readyToPackSelectedCodes.size : filtered.length} thửa)
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    disabled={isPackagingPdf}
                                    onClick={() => {
                                      setPackagingDoneUrl(null);
                                      handleGenerateReadyToPackPdf(
                                        readyToPackSelectedCodes.size > 0
                                          ? Array.from(readyToPackSelectedCodes)
                                          : unpackedFilteredCodes.length > 0
                                          ? unpackedFilteredCodes
                                          : allFilteredCodes
                                      );
                                    }}
                                    className={`p-1.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                                      isLight
                                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                                    }`}
                                    title="Đóng tập lại từ đầu với dữ liệu mới nhất"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  {readyToPackSelectedCodes.size > 0 ? (
                                    <button
                                      type="button"
                                      disabled={isPackagingPdf}
                                      onClick={() => handleGenerateReadyToPackPdf(Array.from(readyToPackSelectedCodes))}
                                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black shadow-md transition cursor-pointer bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-600/30 disabled:opacity-75"
                                    >
                                      {isPackagingPdf ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                                      ) : (
                                        <Printer className="w-3.5 h-3.5 text-indigo-200" />
                                      )}
                                      <span>
                                        {isPackagingPdf
                                          ? packagingProgress || 'Đang xử lý...'
                                          : `Đóng Tập (${readyToPackSelectedCodes.size} thửa đã chọn)`}
                                      </span>
                                    </button>
                                  ) : unpackedFilteredCodes.length > 0 ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={isPackagingPdf}
                                        onClick={() => handleGenerateReadyToPackPdf(unpackedFilteredCodes)}
                                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black shadow-md transition cursor-pointer bg-gradient-to-r from-amber-600 via-orange-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white shadow-orange-600/30 disabled:opacity-75"
                                        title="Chỉ gom và đóng tập các thửa mới có CCCD chưa từng in (tránh in trùng các thửa đã đóng trước đó)"
                                      >
                                        {isPackagingPdf ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                                        ) : (
                                          <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                                        )}
                                        <span>
                                          {isPackagingPdf
                                            ? packagingProgress || 'Đang xử lý...'
                                            : `⚡ Đóng Tập Thửa Mới (${unpackedFilteredCodes.length} thửa chưa đóng)`}
                                        </span>
                                      </button>

                                      <button
                                        type="button"
                                        disabled={isPackagingPdf}
                                        onClick={() => handleGenerateReadyToPackPdf(allFilteredCodes)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer disabled:opacity-75 ${
                                          isLight
                                            ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                                        }`}
                                        title="Đóng tập lại toàn bộ danh sách gồm cả thửa cũ và mới"
                                      >
                                        <span>Đóng tất cả ({allFilteredCodes.length})</span>
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={isPackagingPdf}
                                      onClick={() => handleGenerateReadyToPackPdf(allFilteredCodes)}
                                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black shadow-md transition cursor-pointer bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-600/30 disabled:opacity-75"
                                    >
                                      {isPackagingPdf ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                                      ) : (
                                        <Printer className="w-3.5 h-3.5 text-indigo-200" />
                                      )}
                                      <span>
                                        {isPackagingPdf
                                          ? packagingProgress || 'Đang xử lý...'
                                          : `Đóng Tập Lại Tất Cả (${allFilteredCodes.length} thửa)`}
                                      </span>
                                    </button>
                                  )}
                                </>
                              )}

                              {readyToPackSelectedCodes.size > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setReadyToPackSelectedCodes(new Set())}
                                  className={`text-xs underline transition cursor-pointer ${
                                    isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  Bỏ chọn ({readyToPackSelectedCodes.size})
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        </div>
                    </div>

                    {/* Hàng bộ lọc: Thôn / Buôn, Trạng thái, Có tên/Không có tên, Sắp xếp A-Z, Hiển thị, Tìm kiếm */}
                      <div className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 transition-colors ${
                        isLight ? 'bg-slate-50/80 border-slate-200' : 'bg-slate-950/60 border-slate-800'
                      }`}>
                        <div className="flex flex-wrap items-center gap-2">
                          {/* 1. LỌC THEO THÔN / BUÔN */}
                          {villageColIdx >= 0 && availableVillages.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                                Thôn/Buôn:
                              </span>
                              <select
                                value={reportVillageFilter}
                                onChange={(e) => {
                                  setReportVillageFilter(e.target.value);
                                  setReportPage(1);
                                }}
                                className={`text-xs px-2.5 py-1.5 rounded-xl border font-bold transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                  reportVillageFilter !== 'ALL'
                                    ? isLight
                                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                                      : 'bg-blue-950/60 border-blue-500/50 text-blue-300'
                                    : isLight
                                    ? 'bg-white border-slate-300 text-slate-800'
                                    : 'bg-slate-900 border-slate-700 text-slate-200'
                                }`}
                              >
                                <option value="ALL">Tất cả Thôn / Buôn ({allRows.length})</option>
                                {availableVillages.map((v) => (
                                  <option key={v} value={v}>
                                    {v} ({villageCounts[v]})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* 2. LỌC THỬA CÓ TÊN / KHÔNG CÓ TÊN (ở mục Chưa thực hiện) */}
                          {isChuaThucHienSheet && (
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-bold ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                                Chủ đất:
                              </span>
                              <select
                                value={chuaThucHienNameFilter}
                                onChange={(e) => {
                                  setChuaThucHienNameFilter(e.target.value as any);
                                  setReportPage(1);
                                }}
                                className={`text-xs px-2.5 py-1.5 rounded-xl border font-bold transition focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                                  chuaThucHienNameFilter !== 'ALL'
                                    ? isLight
                                      ? 'bg-emerald-100 border-emerald-400 text-emerald-900'
                                      : 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                                    : isLight
                                    ? 'bg-white border-slate-300 text-slate-800'
                                    : 'bg-slate-900 border-slate-700 text-slate-200'
                                }`}
                              >
                                <option value="ALL">Tất cả ({allRows.length})</option>
                                <option value="CO_TEN">Có tên ({countCoTen})</option>
                                <option value="CHUA_CO_TEN">Không có tên ({countChuaCoTen})</option>
                              </select>
                            </div>
                          )}

                          {/* 3. LỌC THEO PHÂN LOẠI TRẠNG THÁI (Đang Kê Khai - Chưa Có CCCD) */}
                          {isChuaCoCccdSheet && statusColIdx >= 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-bold ${isLight ? 'text-amber-700' : 'text-amber-400'}`}>
                                Trạng thái:
                              </span>
                              <select
                                value={reportStatusFilter}
                                onChange={(e) => {
                                  setReportStatusFilter(e.target.value as any);
                                  setReportPage(1);
                                }}
                                className={`text-xs px-2.5 py-1.5 rounded-xl border font-bold transition focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                                  reportStatusFilter !== 'ALL'
                                    ? isLight
                                      ? 'bg-amber-100/70 border-amber-400 text-amber-900'
                                      : 'bg-amber-950/70 border-amber-500/50 text-amber-200'
                                    : isLight
                                    ? 'bg-white border-slate-300 text-slate-800'
                                    : 'bg-slate-900 border-slate-700 text-slate-200'
                                }`}
                              >
                                <option value="ALL">Tất cả phân loại ({allRows.length})</option>
                                <option value="CẦN TÌM CCCD">
                                  CẦN TÌM CCCD ({statusCounts['CẦN TÌM CCCD'] || 0})
                                </option>
                                <option value="KHÔNG CÓ CCCD">
                                  KHÔNG CÓ CCCD ({statusCounts['KHÔNG CÓ CCCD'] || 0})
                                </option>
                              </select>
                            </div>
                          )}

                          {/* 4. LỌC THEO TRẠNG THÁI ĐÓNG TẬP (Sẵn sàng đóng tập - Có CCCD) */}
                          {isReadyToPackSheet && (
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-bold ${isLight ? 'text-indigo-700' : 'text-indigo-400'}`}>
                                Đóng tập:
                              </span>
                              <select
                                value={readyToPackStatusFilter}
                                onChange={(e) => {
                                  setReadyToPackStatusFilter(e.target.value as any);
                                  setReportPage(1);
                                }}
                                className={`text-xs px-2.5 py-1.5 rounded-xl border font-bold transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                  readyToPackStatusFilter !== 'ALL'
                                    ? isLight
                                      ? 'bg-indigo-100/80 border-indigo-400 text-indigo-900'
                                      : 'bg-indigo-950/70 border-indigo-500/50 text-indigo-200'
                                    : isLight
                                    ? 'bg-white border-slate-300 text-slate-800'
                                    : 'bg-slate-900 border-slate-700 text-slate-200'
                                }`}
                              >
                                <option value="ALL">Tất cả ({allRows.length})</option>
                                <option value="UNPACKED">
                                  ⚡ Chưa đóng ({allRows.filter((r) => !packagedParcelCodes.has(String(r[1] || '').trim())).length})
                                </option>
                                <option value="PACKED">
                                  Đã đóng ({allRows.filter((r) => packagedParcelCodes.has(String(r[1] || '').trim())).length})
                                </option>
                              </select>
                            </div>
                          )}

                          {/* 4. NÚT SẮP XẾP TÊN A -> Z */}
                          {nameColIdx >= 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSortNameOrder((prev) => (prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'));
                                setReportPage(1);
                              }}
                              className={`text-xs px-2.5 py-1.5 rounded-xl border font-bold transition flex items-center gap-1.5 cursor-pointer ${
                                sortNameOrder !== 'none'
                                  ? isLight
                                    ? 'bg-indigo-100 border-indigo-400 text-indigo-800'
                                    : 'bg-indigo-950/80 border-indigo-500/60 text-indigo-300'
                                  : isLight
                                  ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                              }`}
                              title="Bấm để đổi: Sắp xếp Tên A→Z, Z→A hoặc Mặc định"
                            >
                              <ArrowUpDown className="w-3.5 h-3.5 text-indigo-500" />
                              <span>
                                {sortNameOrder === 'asc' ? 'Tên: A → Z' : sortNameOrder === 'desc' ? 'Tên: Z → A' : 'Sắp xếp Tên A-Z'}
                              </span>
                            </button>
                          )}

                          {/* 5. DẠNG HIỂN THỊ: THEO PHẦN (1/7, 2/7) HOẶC TOÀN BỘ */}
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[11px] font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                              Hiển thị:
                            </span>
                            <select
                              value={reportPageSize}
                              onChange={(e) => {
                                const val = e.target.value === 'ALL' ? 'ALL' : parseInt(e.target.value, 10);
                                setReportPageSize(val);
                                setReportPage(1);
                              }}
                              className={`text-xs px-2.5 py-1.5 rounded-xl border font-bold transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                reportPageSize === 'ALL'
                                  ? isLight
                                    ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                                    : 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                                  : isLight
                                  ? 'bg-white border-slate-300 text-slate-800'
                                  : 'bg-slate-900 border-slate-700 text-slate-200'
                              }`}
                            >
                              <option value={20}>20 thửa / phần (hiện {Math.ceil(filtered.length / 20) || 1} phần)</option>
                              <option value={50}>50 thửa / phần (hiện {Math.ceil(filtered.length / 50) || 1} phần)</option>
                              <option value={100}>100 thửa / phần</option>
                              <option value="ALL">Toàn bộ danh sách ({filtered.length} thửa)</option>
                            </select>
                          </div>

                          {/* Nút Đặt Lại nếu đang kích hoạt lọc */}
                          {isAnyFilterActive && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportSearchQuery('');
                                setReportVillageFilter('ALL');
                                setReportStatusFilter('ALL');
                                setChuaThucHienNameFilter('ALL');
                                setAppliedMaThuas(new Set());
                                setTempSelectedMaThuas(new Set());
                                setSortNameOrder('none');
                                setReportPageSize(20);
                                setReportPage(1);
                              }}
                              className={`text-xs px-2.5 py-1.5 rounded-xl border font-semibold transition cursor-pointer ${
                                isLight
                                  ? 'bg-white hover:bg-slate-100 text-slate-600 border-slate-300'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                              }`}
                              title="Khôi phục mặc định"
                            >
                              Đặt lại
                            </button>
                          )}
                        </div>

                        {/* Ô tìm kiếm theo từ khóa */}
                        <div className="relative w-full sm:w-64">
                          <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${
                            isLight ? 'text-slate-400' : 'text-slate-500'
                          }`} />
                          <input
                            type="text"
                            placeholder="Tìm tên, mã thửa, CCCD..."
                            value={reportSearchQuery}
                            onChange={(e) => {
                              setReportSearchQuery(e.target.value);
                              setReportPage(1);
                            }}
                            className={`w-full pl-9 pr-3 py-1.5 rounded-xl text-xs focus:outline-none focus:border-indigo-500 ${
                              isLight
                                ? 'bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400'
                                : 'bg-slate-900 border border-slate-800 text-slate-200 placeholder:text-slate-500'
                            }`}
                          />
                          {reportSearchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportSearchQuery('');
                                setReportPage(1);
                              }}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Bảng dữ liệu chi tiết - HỖ TRỢ NHẬP & SỬA TRỰC TIẾP NHƯ EXCEL */}
                      <div className={`overflow-x-auto rounded-xl border ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
                        <table className={`w-full text-xs text-left ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                          <thead className={`border-b font-bold ${
                            isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-950 text-slate-400 border-slate-800'
                          }`}>
                            <tr>
                              {isReadyToPackSheet && (
                                <th className={`w-10 px-3 py-2.5 text-center border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                                  <input
                                    type="checkbox"
                                    checked={isAllPageSelected}
                                    onChange={toggleSelectAllPageReadyToPack}
                                    className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                    title={isAllPageSelected ? 'Bỏ chọn trang này' : 'Chọn tất cả trang này'}
                                  />
                                </th>
                              )}
                              {headers.map((h, hIdx) => {
                                const isNameHeader = hIdx === nameColIdx;
                                const isMaThuaHeader = hIdx === 1 && isChuaThucHienSheet;
                                return (
                                  <th
                                    key={hIdx}
                                    onClick={
                                      isNameHeader
                                        ? () => {
                                            setSortNameOrder((prev) =>
                                              prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'
                                            );
                                            setReportPage(1);
                                          }
                                        : undefined
                                    }
                                    className={`py-2.5 px-3 whitespace-nowrap border-r select-none ${
                                      isNameHeader ? 'cursor-pointer hover:bg-indigo-500/10' : ''
                                    } ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}
                                  >
                                    <div className="flex items-center gap-1.5 relative">
                                      
                                      <span>{h}</span>
                                      {isMaThuaHeader && (
                                        <div className="relative inline-block text-left">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const rect = e.currentTarget.getBoundingClientRect();
                                              setFilterPopupPos({
                                                top: rect.bottom + 6,
                                                left: Math.max(10, Math.min(rect.left, window.innerWidth - 300)),
                                              });
                                              setChuaThucHienDropdownOpen((prev) => !prev);
                                              setTempSelectedMaThuas(new Set(appliedMaThuas));
                                            }}
                                            className={`p-1 rounded-md transition cursor-pointer flex items-center gap-0.5 ${
                                              appliedMaThuas.size > 0
                                                ? 'bg-emerald-600 text-white shadow-xs'
                                                : isLight
                                                ? 'hover:bg-slate-200 text-slate-600'
                                                : 'hover:bg-slate-700 text-slate-300'
                                            }`}
                                            title="Bấm để tìm và tích chọn mã thửa kiểu Excel"
                                          >
                                            <Filter className="w-3 h-3" />
                                            <ChevronDown className="w-3 h-3" />
                                            {appliedMaThuas.size > 0 && (
                                              <span className="text-[9px] font-black px-1 rounded-full bg-white text-emerald-800">
                                                {appliedMaThuas.size}
                                              </span>
                                            )}
                                          </button>

                                          {/* Popover Lọc kiểu Excel */}
                                          {chuaThucHienDropdownOpen && filterPopupPos && (
                                            <>
                                              <div
                                                className="fixed inset-0 z-[99998]"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setChuaThucHienDropdownOpen(false);
                                                }}
                                              />
                                              <div
                                                onClick={(e) => e.stopPropagation()}
                                                style={{
                                                  position: 'fixed',
                                                  top: `${filterPopupPos.top}px`,
                                                  left: `${filterPopupPos.left}px`,
                                                  zIndex: 99999,
                                                }}
                                                className={`w-72 max-w-[90vw] p-3 rounded-2xl shadow-2xl border text-left font-normal ${
                                                  isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-900 border-slate-700 text-slate-100'
                                                }`}
                                              >
                                              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800 mb-2">
                                                <span className="text-xs font-bold flex items-center gap-1.5">
                                                  <Filter className="w-3.5 h-3.5 text-emerald-500" />
                                                  Lọc Mã Thửa (Excel)
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={() => setChuaThucHienDropdownOpen(false)}
                                                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                                >
                                                  <X className="w-4 h-4" />
                                                </button>
                                              </div>

                                              {/* Search Box */}
                                              <div className="relative mb-2">
                                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                <input
                                                  type="text"
                                                  placeholder="Tìm kiếm mã thửa..."
                                                  value={chuaThucHienFilterSearch}
                                                  onChange={(e) => setChuaThucHienFilterSearch(e.target.value)}
                                                  className={`w-full pl-8 pr-2.5 py-1.5 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                                                    isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-950 border-slate-700 text-slate-200'
                                                  }`}
                                                />
                                              </div>

                                              {/* Quick actions */}
                                              <div className="flex items-center justify-between text-[11px] mb-2 px-1">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const next = new Set(tempSelectedMaThuas);
                                                    filteredDropdownList.forEach((m) => next.add(m));
                                                    setTempSelectedMaThuas(next);
                                                  }}
                                                  className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline cursor-pointer"
                                                >
                                                  Chọn tất cả ({filteredDropdownList.length})
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const next = new Set(tempSelectedMaThuas);
                                                    filteredDropdownList.forEach((m) => next.delete(m));
                                                    setTempSelectedMaThuas(next);
                                                  }}
                                                  className="text-slate-500 hover:underline cursor-pointer"
                                                >
                                                  Bỏ chọn
                                                </button>
                                              </div>

                                              {/* Checkbox scroll list */}
                                              <div className={`max-h-52 overflow-y-auto space-y-1 p-1 rounded-xl border text-xs ${
                                                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
                                              }`}>
                                                {filteredDropdownList.length === 0 ? (
                                                  <div className="py-4 text-center text-slate-400 text-xs italic">Không tìm thấy mã thửa</div>
                                                ) : (
                                                  filteredDropdownList.map((mt) => {
                                                    const checked = tempSelectedMaThuas.has(mt);
                                                    return (
                                                      <label
                                                        key={mt}
                                                        className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition ${
                                                          checked
                                                            ? isLight ? 'bg-emerald-50 text-emerald-900 font-bold' : 'bg-emerald-950/60 text-emerald-200 font-bold'
                                                            : 'hover:bg-slate-200/50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                                                        }`}
                                                      >
                                                        <input
                                                          type="checkbox"
                                                          checked={checked}
                                                          onChange={() => {
                                                            const next = new Set(tempSelectedMaThuas);
                                                            if (next.has(mt)) next.delete(mt);
                                                            else next.add(mt);
                                                            setTempSelectedMaThuas(next);
                                                          }}
                                                          className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                                        />
                                                        <span className="truncate">{mt}</span>
                                                      </label>
                                                    );
                                                  })
                                                )}
                                              </div>

                                              {/* Footer action buttons */}
                                              <div className="flex items-center justify-between gap-2 pt-2.5 mt-2 border-t border-slate-200 dark:border-slate-800">
                                                {appliedMaThuas.size > 0 && (
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setAppliedMaThuas(new Set());
                                                      setTempSelectedMaThuas(new Set());
                                                      setChuaThucHienDropdownOpen(false);
                                                      setReportPage(1);
                                                    }}
                                                    className="text-[11px] text-rose-500 hover:underline font-semibold cursor-pointer"
                                                  >
                                                    Xóa lọc
                                                  </button>
                                                )}
                                                <div className="flex items-center gap-2 ml-auto">
                                                  <button
                                                    type="button"
                                                    onClick={() => setChuaThucHienDropdownOpen(false)}
                                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                                                      isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                                    }`}
                                                  >
                                                    Hủy
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setAppliedMaThuas(new Set(tempSelectedMaThuas));
                                                      setChuaThucHienDropdownOpen(false);
                                                      setReportPage(1);
                                                    }}
                                                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm cursor-pointer"
                                                  >
                                                    OK / Áp dụng
                                                  </button>
                                                </div>
                                              </div>
                                            </div>
                                            </>
                                          )}
                                        </div>
                                      )}
                                      {isMaThuaHeader && chuaThucHienSelectedCodes.size > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.2 bg-emerald-600 text-white rounded-full font-black">
                                          {chuaThucHienSelectedCodes.size}
                                        </span>
                                      )}
                                      {isNameHeader && (
                                        <ArrowUpDown className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                      )}
                                      {isNameHeader && sortNameOrder !== 'none' && (
                                        <span className="text-[10px] px-1 py-0.2 bg-indigo-500 text-white rounded font-black">
                                          {sortNameOrder === 'asc' ? 'A→Z' : 'Z→A'}
                                        </span>
                                      )}
                                    </div>
                                  </th>
                                );
                              })}
                              {/* Cột Trạng thái / Thao tác */}
                              <th className={`w-28 px-3 py-2.5 text-center border-r font-bold whitespace-nowrap ${
                                isLight ? 'border-slate-200 bg-slate-200/60' : 'border-slate-800/80 bg-slate-900'
                              }`}>
                                Trạng thái
                              </th>
                            </tr>
                          </thead>
                          <tbody className={`divide-y ${isLight ? 'divide-slate-200' : 'divide-slate-800/60'}`}>
                            {pagedRows.length === 0 ? (
                              <tr>
                                <td colSpan={Math.max(headers.length + (isReadyToPackSheet ? 1 : 0) + 1, 1)} className="py-8 text-center text-slate-500">
                                  {filtered.length === 0
                                    ? 'Không tìm thấy kết quả phù hợp với các bộ lọc đã chọn.'
                                    : 'Chưa có hồ sơ trong danh sách này.'}
                                </td>
                              </tr>
                            ) : (
                              pagedRows.map((row, rIdx) => {
                                const maThua = String(row[1] || '').trim();
                                const isChecked = readyToPackSelectedCodes.has(maThua);
                                const isChuaThucHienChecked = isChuaThucHienSheet && chuaThucHienSelectedCodes.has(maThua);
                                const isSaving = savingRowCodes.has(maThua);
                                const hasEdited = Boolean(cellEdits[maThua]);

                                return (
                                  <tr
                                    key={rIdx}
                                    className={`transition ${
                                      isChecked
                                        ? isLight
                                          ? 'bg-indigo-50/70'
                                          : 'bg-indigo-950/30'
                                        : isChuaThucHienChecked
                                        ? isLight
                                          ? 'bg-emerald-50/70'
                                          : 'bg-emerald-950/30'
                                        : isLight
                                        ? 'hover:bg-slate-50'
                                        : 'hover:bg-slate-800/40'
                                    }`}
                                  >
                                    {isReadyToPackSheet && (
                                      <td className={`w-10 px-3 py-2 text-center border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}>
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => {
                                            setReadyToPackSelectedCodes((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(maThua)) next.delete(maThua);
                                              else next.add(maThua);
                                              return next;
                                            });
                                          }}
                                          className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                        />
                                      </td>
                                    )}

                                    {row.map((cell, cIdx) => {
                                      const cellStr = String(cell || '');
                                      const headerName = headers[cIdx] || '';
                                      const hLower = headerName.toLowerCase();

                                      // Cột Phân loại trạng thái (Làm nổi bật badge)
                                      if (cIdx === statusColIdx && isChuaCoCccdSheet) {
                                        const isCanTim = cellStr.includes('CẦN TÌM');
                                        return (
                                          <td key={cIdx} className={`py-2 px-3 whitespace-nowrap border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}>
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-[11px] border ${
                                              isCanTim
                                                ? isLight
                                                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                                                  : 'bg-amber-950/50 text-amber-300 border-amber-500/40'
                                                : isLight
                                                ? 'bg-rose-50 text-rose-800 border-rose-300'
                                                : 'bg-rose-950/50 text-rose-300 border-rose-500/40'
                                            }`}>
                                              <span className={`w-1.5 h-1.5 rounded-full ${isCanTim ? 'bg-amber-500' : 'bg-rose-500'}`} />
                                              {cellStr}
                                            </span>
                                          </td>
                                        );
                                      }

                                      // Hiển thị nút bấm Xem CCCD / Xem PDF kèm Card Hover nổi
                                      const linkMatch = cellStr.match(/HYPERLINK\("([^"]+)";\s*"([^"]+)"\)/i);
                                      if (linkMatch) {
                                        const href = linkMatch[1];
                                        const text = linkMatch[2];
                                        const ownerName = String(cellEdits[maThua]?.[nameColIdx] ?? row[nameColIdx] ?? '').trim();
                                        const cccdVal = String(row[8] || '').replace(/^="|"$/g, '').trim();

                                        return (
                                          <td key={cIdx} className={`py-2 px-3 whitespace-nowrap border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}>
                                            <CccdHoverPreviewCard
                                              fileUrl={href}
                                              filename={text}
                                              ownerName={ownerName || undefined}
                                              cccdNumber={cccdVal || undefined}
                                              theme={theme}
                                            >
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  setPreviewPdfModal({
                                                    isOpen: true,
                                                    url: href,
                                                    title: `CCCD: ${ownerName || text}`,
                                                    filename: text,
                                                  });
                                                }}
                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition shadow-xs cursor-pointer ${
                                                  isLight
                                                    ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                                                    : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                                                }`}
                                                title="Xem trực tiếp file CCCD trên giao diện"
                                              >
                                                <Eye className="w-3.5 h-3.5 text-indigo-500" />
                                                <span>Xem CCCD</span>
                                              </button>
                                            </CccdHoverPreviewCard>
                                          </td>
                                        );
                                      }

                                      // Hiển thị chuỗi định dạng Excel (="...")
                                      const cleanText = cellStr.replace(/^="|"$/g, '');
                                      const displayVal = cellEdits[maThua]?.[cIdx] !== undefined ? cellEdits[maThua][cIdx] : cleanText;

                                      // Kiểm tra xem cột này có cho phép sửa trực tiếp như Excel không
                                      const isNameCol = hLower.includes('họ và tên') || hLower.includes('chủ đất');
                                      const isDobCol = hLower.includes('năm sinh') || hLower.includes('ngày sinh');
                                      const isGenderCol = hLower.includes('giới tính');
                                      const isCccdCol = hLower.includes('cccd') && !hLower.includes('xem') && !hLower.includes('file');
                                      const isAreaCol = hLower.includes('diện tích');
                                      const isLandTypeCol = hLower.includes('loại đất');
                                      const isOriginCol = hLower.includes('nguồn gốc');
                                      const isNoteCol = hLower.includes('ghi chú') || hLower.includes('hướng dẫn');

                                      // 1. Ô Giới tính (Dropdown Nam/Nữ trực tiếp)
                                      if (isGenderCol) {
                                        return (
                                          <td key={cIdx} className={`py-1.5 px-2 whitespace-nowrap border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}>
                                            <select
                                              value={displayVal || 'Nam'}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                handleInlineCellChange(maThua, cIdx, v);
                                                handleInlineCellCommit(maThua, cIdx, headerName, v, row);
                                              }}
                                              className={`px-1.5 py-1 rounded-lg border text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 transition cursor-pointer ${
                                                isLight
                                                  ? 'bg-white hover:bg-slate-50 border-slate-300 text-slate-800'
                                                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                              }`}
                                            >
                                              <option value="Nam">Nam</option>
                                              <option value="Nữ">Nữ</option>
                                            </select>
                                          </td>
                                        );
                                      }

                                      // 2. Ô Nguồn gốc sử dụng đất (Dropdown Khai hoang / Thừa kế / Tặng cho trực tiếp)
                                      if (isOriginCol) {
                                        return (
                                          <td key={cIdx} className={`py-1.5 px-2 whitespace-nowrap border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}>
                                            <select
                                              value={displayVal || 'Khai hoang'}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                handleInlineCellChange(maThua, cIdx, v);
                                                handleInlineCellCommit(maThua, cIdx, headerName, v, row);
                                              }}
                                              className={`px-1.5 py-1 rounded-lg border text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 transition cursor-pointer ${
                                                isLight
                                                  ? 'bg-white hover:bg-slate-50 border-slate-300 text-slate-800'
                                                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                              }`}
                                            >
                                              <option value="Khai hoang">Khai hoang</option>
                                              <option value="Nhận Thừa Kế">Nhận Thừa Kế</option>
                                              <option value="Nhận Tặng Cho">Nhận Tặng Cho</option>
                                            </select>
                                          </td>
                                        );
                                      }

                                      // 3. Các ô nhập chữ trực tiếp như Excel (Họ tên, Năm sinh, Số CCCD, Diện tích, Loại đất, Ghi chú)
                                      if (isNameCol || isDobCol || isCccdCol || isAreaCol || isLandTypeCol || isNoteCol) {
                                        return (
                                          <td key={cIdx} className={`p-1 whitespace-nowrap border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}>
                                            <input
                                              type="text"
                                              value={displayVal}
                                              onChange={(e) => handleInlineCellChange(maThua, cIdx, e.target.value)}
                                              onBlur={(e) => handleInlineCellCommit(maThua, cIdx, headerName, e.target.value, row)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  (e.target as HTMLInputElement).blur();
                                                }
                                              }}
                                              placeholder={isCccdCol ? '12 số CCCD...' : isNameCol ? 'Nhập họ tên...' : isDobCol ? 'YYYY...' : 'Nhập...'}
                                              className={`w-full min-w-[80px] px-2 py-1 text-xs rounded border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:bg-white font-medium transition ${
                                                isNameCol ? 'font-bold' : ''
                                              } ${
                                                isLight
                                                  ? 'text-slate-800 hover:bg-slate-100/50'
                                                  : 'text-slate-100 focus:bg-slate-800 hover:bg-slate-800/40'
                                              }`}
                                            />
                                          </td>
                                        );
                                      }

                                      // 4. Các cột định danh cố định (STT, Mã thửa, Tờ BĐ, Số thửa, Thôn / Buôn, Trạng thái)
                                      if (cIdx === 1 && isChuaThucHienSheet) {
                                        return (
                                          <td key={cIdx} className={`py-2 px-3 whitespace-nowrap border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}>
                                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">{cleanText}</span>
                                          </td>
                                        );
                                      }

                                      if (cIdx === 1 && isReadyToPackSheet) {
                                        const isPackaged = packagedParcelCodes.has(maThua);
                                        return (
                                          <td key={cIdx} className={`py-2 px-3 whitespace-nowrap border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}>
                                            <div className="flex items-center gap-1.5">
                                              <span className="font-semibold text-indigo-700 dark:text-indigo-400">{cleanText}</span>
                                              {isPackaged ? (
                                                <button
                                                  type="button"
                                                  onClick={() => toggleParcelPackagedStatus(maThua)}
                                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer"
                                                  title="Đã đóng tập PDF. Bấm để chuyển lại Chưa đóng nếu muốn in lại."
                                                >
                                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                                  <span>Đã đóng</span>
                                                </button>
                                              ) : (
                                                <span
                                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse"
                                                  title="Hồ sơ mới chưa đóng tập PDF"
                                                >
                                                  <Sparkles className="w-2.5 h-2.5" />
                                                  <span>Chưa đóng</span>
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                        );
                                      }

                                      return (
                                        <td key={cIdx} className={`py-2 px-3 whitespace-nowrap border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}>
                                          {cleanText}
                                        </td>
                                      );
                                    })}

                                    {/* Cột Trạng thái / Sửa nhanh */}
                                    <td className={`w-28 px-2 py-2 text-center whitespace-nowrap border-r ${
                                      isLight ? 'border-slate-200' : 'border-slate-800/60'
                                    }`}>
                                      {isSaving ? (
                                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 font-bold">
                                          <RefreshCw className="w-3 h-3 animate-spin" />
                                          <span>Đang lưu</span>
                                        </span>
                                      ) : hasEdited ? (
                                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-bold">
                                          <Check className="w-3 h-3 text-emerald-500" />
                                          <span>Đã lưu</span>
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handleEditRowParcel(maThua, row)}
                                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition cursor-pointer ${
                                            isLight
                                              ? 'text-slate-500 hover:text-slate-800 border-slate-200 hover:bg-slate-100'
                                              : 'text-slate-400 hover:text-slate-200 border-slate-700/60 hover:bg-slate-800'
                                          }`}
                                          title="Bấm để mở form xem chi tiết / in phiếu"
                                        >
                                          <Pencil className="w-3 h-3 text-slate-400" />
                                          <span>Chi tiết</span>
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Phân trang & Điều hướng theo phần (1/7, 2/7) hoặc Toàn bộ */}
                      <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 text-xs pt-2 ${
                        isLight ? 'text-slate-600' : 'text-slate-400'
                      }`}>
                        <div className="flex flex-wrap items-center gap-2">
                          {isAllRowsMode ? (
                            <span className="font-semibold flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              Đang hiển thị <strong>Toàn bộ {filtered.length}</strong> thửa đất
                            </span>
                          ) : (
                            <span>
                              Hiển thị {(safePage - 1) * currentSize + 1} -{' '}
                              {Math.min(safePage * currentSize, filtered.length)} / <strong>{filtered.length}</strong> thửa
                              {filtered.length < allRows.length && ` (đã lọc từ ${allRows.length} thửa)`}
                            </span>
                          )}

                          {/* Nút chuyển đổi nhanh chế độ Toàn bộ / Phân trang */}
                          <button
                            type="button"
                            onClick={() => {
                              setReportPageSize((prev) => (prev === 'ALL' ? 20 : 'ALL'));
                              setReportPage(1);
                            }}
                            className={`ml-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                              isAllRowsMode
                                ? isLight
                                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                                : isLight
                                ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                                : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                            }`}
                          >
                            {isAllRowsMode ? '⚡ Xem theo phần (1/7, 2/7)' : '👁️ Xem toàn bộ danh sách'}
                          </button>
                        </div>

                        {/* Cụm điều khiển các phần (Ví dụ: Phần 1/7, 2/7) */}
                        {!isAllRowsMode && totalPages > 1 && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setReportPage((p) => Math.max(1, p - 1))}
                              disabled={safePage <= 1}
                              className={`px-2.5 py-1 rounded-lg disabled:opacity-40 transition cursor-pointer border font-semibold ${
                                isLight
                                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                              }`}
                            >
                              Trước
                            </button>

                            {/* Các nút bấm chọn từng phần nếu <= 7 phần */}
                            {totalPages <= 7 ? (
                              Array.from({ length: totalPages }).map((_, i) => (
                                <button
                                  key={i + 1}
                                  type="button"
                                  onClick={() => setReportPage(i + 1)}
                                  className={`w-7 h-7 rounded-lg text-xs font-bold transition cursor-pointer ${
                                    safePage === i + 1
                                      ? 'bg-indigo-600 text-white shadow-xs'
                                      : isLight
                                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                  }`}
                                >
                                  {i + 1}
                                </button>
                              ))
                            ) : (
                              <span className={`px-2.5 font-bold ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>
                                Phần {safePage} / {totalPages}
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => setReportPage((p) => Math.min(totalPages, p + 1))}
                              disabled={safePage >= totalPages}
                              className={`px-2.5 py-1 rounded-lg disabled:opacity-40 transition cursor-pointer border font-semibold ${
                                isLight
                                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                              }`}
                            >
                              Sau
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-3 sm:px-6 text-center text-xs text-slate-500 mt-auto no-print">
        <p>Hệ thống Bản đồ Địa chính & Quản trị Tiến độ Số hóa Xã Cư Pui • Dữ liệu cập nhật 2026</p>
      </footer>

      {/* Modal Xem chi tiết Thửa đất & Hồ sơ kê khai thực địa */}
      <DashboardParcelModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        parcel={activeParcelDetail}
        declaration={activeParcelDetail ? declarationsMap[activeParcelDetail.ma_thua] : null}
        onPrintDeclaration={(p, decl) => {
          setIsDetailModalOpen(false);
          handleOpenPrintSingle(p);
        }}
        onOpenImageViewer={handleOpenImageViewer}
        onEditDeclaration={(p, decl) => {
          setIsDetailModalOpen(false);
          handleOpenEditDeclaration(p, decl);
        }}
        onDeleteDeclaration={(p) => {
          setDeletingParcel(p);
        }}
        onOpenSupplementCccd={(p) => {
          setSelectedParcelForCccd(p.ma_thua);
          setIsCccdSupplementOpen(true);
        }}
      />

      {/* Modal Chỉnh Sửa Phiếu Kê Khai */}
      <DeclarationEditModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingParcel(null);
          setEditingDeclaration(null);
        }}
        parcel={editingParcel}
        declaration={editingDeclaration}
        onSave={handleSaveEditedDeclaration}
        onDelete={handleDeleteDeclaration}
      />

      {/* Modal Xác Nhận Xóa Phiếu Kê Khai */}
      {deletingParcel && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl max-w-md w-full p-5 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h4 className="font-black text-sm text-white">Xác nhận xóa phiếu kê khai</h4>
                <p className="text-xs text-slate-400">Hủy bỏ hồ sơ kê khai đã lưu</p>
              </div>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-2 text-slate-300">
              <p>
                Bạn có chắc chắn muốn xóa phiếu kê khai của thửa{' '}
                <strong className="text-white">
                  Thửa {deletingParcel.so_thua} (Tờ {deletingParcel.to_ban_do})
                </strong>
                ?
              </p>
              {declarationsMap[deletingParcel.ma_thua]?.thua_kem_theo?.length > 0 && (
                <p className="text-amber-400">
                  Phiếu này bao gồm <strong>{declarationsMap[deletingParcel.ma_thua].thua_kem_theo.length} thửa kèm theo</strong> ({declarationsMap[deletingParcel.ma_thua].thua_kem_theo.map((t: any) => `Thửa ${t.so_thua}/${t.to_ban_do}`).join(', ')}).
                </p>
              )}
              <p className="text-slate-400 text-[11px]">
                👉 Toàn bộ các thửa trong phiếu này sẽ <strong>tự động quay trở lại trạng thái ban đầu</strong> (Có tên - Màu Vàng, hoặc Chưa có tên - Màu Trắng/Xám).
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingParcel(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => handleDeleteDeclaration(deletingParcel.ma_thua)}
                className="px-4 py-2 rounded-xl text-xs font-black bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-600/30 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xác nhận xóa</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Phóng to & Tải ảnh CCCD / Giấy chứng nhận */}
      <VectorViewerModal
        isOpen={isImageViewerOpen}
        onClose={() => setIsImageViewerOpen(false)}
        svgUrl={viewerData.url}
        urls={viewerData.urls}
        title={viewerData.title}
        ownerName={viewerData.owner}
        cccdNumber={viewerData.cccd}
      />

      {/* Modal In / Xuất PDF tập đơn kê khai khổ A4 chuẩn */}
      <DeclarationPrintModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        items={printableItems}
        title={printModalTitle}
      />

      {/* Modal Bổ Sung CCCD (Quét AI) & File Scan Sau Ký */}
      <CccdSupplementModal
        isOpen={isCccdSupplementOpen}
        onClose={() => setIsCccdSupplementOpen(false)}
        initialParcelCode={selectedParcelForCccd}
        defaultMode={cccdModalMode}
        onSuccess={() => {
          fetchCloudDeclarations();
        }}
      />

      {/* Modal Xem file PDF CCCD trực tiếp trên Dashboard (không mở link ngoài) */}
      {previewPdfModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
          <div className={`w-full max-w-5xl h-[90vh] rounded-2xl shadow-2xl flex flex-col border overflow-hidden ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}>
            <div className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
            }`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                  <Eye className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className={`text-sm font-bold truncate ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>
                    {previewPdfModal.title}
                  </h3>
                  <p className="text-[10px] text-slate-500">{previewPdfModal.filename || 'Xem trực tiếp tài liệu từ Cloudflare R2'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewPdfModal.url}
                  download={previewPdfModal.filename || 'cccd.pdf'}
                  className={`p-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                    isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                  title="Tải file PDF về máy"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Tải về</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewPdfModal({ isOpen: false, url: '', title: '' })}
                  className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                  title="Đóng modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 w-full bg-slate-950 relative">
              <iframe
                src={previewPdfModal.url}
                className="w-full h-full border-0 bg-white"
                title={previewPdfModal.title}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
