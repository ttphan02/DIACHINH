'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import Link from 'next/link';
import { Parcel, ParcelStatus, DeclarationFormData } from '@/types';
import { removeVietnameseTones, getResolvedImageUrl } from '@/utils/geo';
import { stripAccents, cleanCccd, getCanonicalVillage, CANONICAL_VILLAGES, normalizeNguonGoc, NGUON_GOC_OPTIONS, cleanName, isValidFullName, isValidBirthYear, isValidCccd, cleanDisplayAddress, isPersonName } from '@/utils/textHelpers';
import { getStoredDeclarations, saveOrUpdateDeclaration, removeDeclaration, getOrCreateDeviceId, getSavedCadreName } from '@/utils/declaration';
import { broadcastRealtimeEvent, onRealtimeEvent } from '@/utils/realtimeSync';
import dynamic from 'next/dynamic';
import type { PrintableDeclarationItem } from '@/components/DeclarationPrintModal';
const DeclarationPrintModal = dynamic(() => import('@/components/DeclarationPrintModal'), { ssr: false });
import DashboardParcelModal from '@/components/DashboardParcelModal';
import DeclarationEditModal from '@/components/DeclarationEditModal';
const VectorViewerModal = dynamic(() => import('@/components/VectorViewerModal'), { ssr: false });
import CccdSupplementModal from '@/components/CccdSupplementModal';
import CccdManagerTab from '@/components/CccdManagerTab';
import CccdHoverPreviewCard from '@/components/CccdHoverPreviewCard';
const PdfViewer = dynamic(() => import('@/components/PdfViewer'), { ssr: false });
const ExportMissingCccdModal = dynamic(() => import('@/components/ExportMissingCccdModal'), { ssr: false });
import ScanFileManagerTab from '@/components/ScanFileManagerTab';
import CadreNameModal from '@/components/CadreNameModal';
const CadreTrackingTab = dynamic(() => import('@/components/CadreTrackingTab'), { ssr: false });
import type { ReadyToPackItem } from '@/utils/pdfPacker';
import digitizedBlueParcelsData from '@/data/digitized_blue_parcels.json';
const DIGITIZED_BLUE_SET = new Set(digitizedBlueParcelsData as string[]);
import {
  Radio,
  FileBarChart2,
  Loader2,
  Camera,
  HardDrive,
  FolderOpen,
  Map as MapIcon,
  BarChart3,
  PieChart,
  Users,
  UserCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileSpreadsheet,
  Download,
  FileDown,
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
  UploadCloud,
  Home,
} from 'lucide-react';


const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

export default function DashboardPage() {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [isLoadingParcels, setIsLoadingParcels] = useState(true);

  // Nạp 11.280 thửa đất xã Cư Pui bất đồng bộ phía client từ CDN, tránh lỗi Cloudflare 1102 khi SSR
  useEffect(() => {
    let isMounted = true;
    fetch('/data/parcels.json')
      .then((res) => {
        if (!res.ok) throw new Error('Không thể nạp dữ liệu thửa đất');
        return res.json() as Promise<Parcel[]>;
      })
      .then((data) => {
        if (isMounted) {
          setParcels(data);
          setIsLoadingParcels(false);
        }
      })
      .catch((err) => {
        console.error('Lỗi nạp danh sách thửa đất:', err);
        if (isMounted) setIsLoadingParcels(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

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

  // Sorting & Pagination (Mặc định hiển thị tất cả & sắp xếp A -> Z theo tên)
  const [sortBy, setSortBy] = useState<'so_thua' | 'to_ban_do' | 'dien_tich' | 'chu_ho'>('chu_ho');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10000);

  // Active view tab in Dashboard: Báo Cáo Tiến Độ, Tiến Độ 16 Thôn, Kho CCCD, Kho File Scan, Vị Trí Cán Bộ
  const [activeTab, setActiveTab] = useState<'progressReport' | 'villages' | 'cccd' | 'filescan' | 'cadres'>('progressReport');

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
    nhapDuLieu?: number;
    nhapGgs: number;
    daDongTap: number;
    canTimCccd: number;
    khongCoCccd: number;
    gcnOnt?: number;
  } | null>(null);
  const [isLoadingSyncSheets, setIsLoadingSyncSheets] = useState(false);
  const [selectedReportSheet, setSelectedReportSheet] = useState<string>('THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)');
  const [perSheetFilters, setPerSheetFilters] = useState<Record<string, {
    village?: string;
    status?: string;
    search?: string;
  }>>({});

  const reportVillageFilter = perSheetFilters[selectedReportSheet]?.village || 'ALL';
  const setReportVillageFilter = (v: string) => {
    setPerSheetFilters((prev) => ({
      ...prev,
      [selectedReportSheet]: { ...(prev[selectedReportSheet] || {}), village: v },
    }));
  };

  const reportStatusFilter = perSheetFilters[selectedReportSheet]?.status || 'ALL';
  const setReportStatusFilter = (st: string) => {
    setPerSheetFilters((prev) => ({
      ...prev,
      [selectedReportSheet]: { ...(prev[selectedReportSheet] || {}), status: st },
    }));
  };

  const reportSearchQuery = perSheetFilters[selectedReportSheet]?.search || '';
  const setReportSearchQuery = (q: string) => {
    setPerSheetFilters((prev) => ({
      ...prev,
      [selectedReportSheet]: { ...(prev[selectedReportSheet] || {}), search: q },
    }));
  };

  const viCollator = useMemo(() => new Intl.Collator('vi', { sensitivity: 'base' }), []);
  const deferredReportSearchQuery = useDeferredValue(reportSearchQuery);

  const [reportPageSize, setReportPageSize] = useState<number | 'ALL'>('ALL');
  const [reportPage, setReportPage] = useState<number>(1);

  // Danh sách CCCD đã có trên R2 và trên GGS phục vụ kiểm tra realtime
  const [r2CccdSet, setR2CccdSet] = useState<Set<string>>(new Set());
  const [ggsCccdSet, setGgsCccdSet] = useState<Set<string>>(new Set());
  const [isLoadingR2Cccd, setIsLoadingR2Cccd] = useState(false);
  const [isMovingParcelsToPack, setIsMovingParcelsToPack] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [statusFilterPopupPos, setStatusFilterPopupPos] = useState<{ top: number; left: number } | null>(null);
  const [cccdTabRefreshKey, setCccdTabRefreshKey] = useState(0);

  // Sắp xếp danh sách theo tên chủ đất A -> Z (Mặc định luôn A -> Z)
  const [sortNameOrder, setSortNameOrder] = useState<'none' | 'asc' | 'desc'>('asc');

  // Lọc thửa Có tên / Không có tên trong danh sách "Chưa Thực Hiện"
  const [chuaThucHienNameFilter, setChuaThucHienNameFilter] = useState<'ALL' | 'CO_TEN' | 'CHUA_CO_TEN'>('ALL');

  // Chỉnh sửa & Nhập trực tiếp trên bảng như Excel
  const [cellEdits, setCellEdits] = useState<Record<string, Record<number, string>>>({});
  const [savingRowCodes, setSavingRowCodes] = useState<Set<string>>(new Set());
  const [inlineSaveToast, setInlineSaveToast] = useState<string | null>(null);
  const [isExportMissingCccdOpen, setIsExportMissingCccdOpen] = useState(false);
  const [isCommittingAllReady, setIsCommittingAllReady] = useState(false);

  // Trạng thái nhập hồ sơ tự động lên web KH2959
  const [kh2959ImportedCodes, setKh2959ImportedCodes] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('kh2959_imported_parcels');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [isSubmittingWeb, setIsSubmittingWeb] = useState(false);
  const [submittingRowCode, setSubmittingRowCode] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  // Tên cán bộ kê khai
  const [cadreName, setCadreName] = useState<string>('');
  const [isCadreModalOpen, setIsCadreModalOpen] = useState(false);
  const [isFirstTimeCadre, setIsFirstTimeCadre] = useState(false);

  useEffect(() => {
    const saved = getSavedCadreName();
    if (saved) {
      setCadreName(saved);
    } else {
      setIsFirstTimeCadre(true);
      setIsCadreModalOpen(true);
    }
  }, []);

  // Độ rộng cột tuỳ chỉnh trên danh sách (kéo thu nhỏ/mở rộng & nhấn đúp tự căn chiều rộng tối thiểu)
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem('diachinh_dashboard_col_widths');
      if (saved) {
        setColWidths(JSON.parse(saved));
      }
      const savedEdits = localStorage.getItem('diachinh_table_cell_edits');
      if (savedEdits) {
        setCellEdits(JSON.parse(savedEdits));
      }
    } catch {}
  }, []);

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

  // Bộ lọc Dropdown Thôn/Buôn trên tiêu đề cột
  const [villageDropdownOpen, setVillageDropdownOpen] = useState(false);
  const [villageFilterSearch, setVillageFilterSearch] = useState('');
  const [villageFilterPopupPos, setVillageFilterPopupPos] = useState<{ top: number; left: number } | null>(null);

  // Kéo thả di chuyển popover Lọc Mã Thửa khi nhấn giữ header
  const isDraggingPopupRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialLeft: number; initialTop: number }>({
    mouseX: 0,
    mouseY: 0,
    initialLeft: 0,
    initialTop: 0,
  });

  const handlePopupHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    isDraggingPopupRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialLeft: filterPopupPos?.left || 100,
      initialTop: filterPopupPos?.top || 100,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingPopupRef.current) return;
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      const newLeft = Math.max(10, Math.min(window.innerWidth - 300, dragStartRef.current.initialLeft + dx));
      const newTop = Math.max(10, Math.min(window.innerHeight - 300, dragStartRef.current.initialTop + dy));
      setFilterPopupPos({ left: newLeft, top: newTop });
    };

    const handleMouseUp = () => {
      isDraggingPopupRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handlePopupHeaderTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const touch = e.touches[0];
    isDraggingPopupRef.current = true;
    dragStartRef.current = {
      mouseX: touch.clientX,
      mouseY: touch.clientY,
      initialLeft: filterPopupPos?.left || 100,
      initialTop: filterPopupPos?.top || 100,
    };

    const handleTouchMove = (ev: TouchEvent) => {
      if (!isDraggingPopupRef.current || !ev.touches[0]) return;
      const t = ev.touches[0];
      const dx = t.clientX - dragStartRef.current.mouseX;
      const dy = t.clientY - dragStartRef.current.mouseY;
      const newLeft = Math.max(10, Math.min(window.innerWidth - 300, dragStartRef.current.initialLeft + dx));
      const newTop = Math.max(10, Math.min(window.innerHeight - 300, dragStartRef.current.initialTop + dy));
      setFilterPopupPos({ left: newLeft, top: newTop });
    };

    const handleTouchEnd = () => {
      isDraggingPopupRef.current = false;
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };

    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);
  };

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

  const isFetchingCloudRef = useRef(false);
  const lastFetchTimeRef = useRef(0);

  // 1. Đồng bộ danh sách kê khai từ Cloud R2 theo thời gian thực (Không cần F5)
  const fetchCloudDeclarations = useCallback(async () => {
    if (isFetchingCloudRef.current) return;
    isFetchingCloudRef.current = true;
    lastFetchTimeRef.current = Date.now();
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
          const cloudEdits = data.cellEdits && typeof data.cellEdits === 'object' ? data.cellEdits : {};
          const sig = JSON.stringify({ codes: data.declaredCodes, map: cloudMap, edits: cloudEdits });
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

          // Đồng bộ các ô đang nhập nháp (cellEdits) từ Cloud R2
          setCellEdits((prev) => {
            const merged: Record<string, Record<number, string>> = { ...cloudEdits };
            for (const code of Object.keys(prev)) {
              if (!cloudCodesSet.has(code) && prev[code]) {
                merged[code] = { ...(merged[code] || {}), ...prev[code] };
              }
            }
            try {
              localStorage.setItem('diachinh_table_cell_edits', JSON.stringify(merged));
            } catch (e) {}
            return merged;
          });

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
    } finally {
      isFetchingCloudRef.current = false;
    }
  }, []);

  useEffect(() => {
    const { declaredCodes, declarationsMap: map } = getStoredDeclarations();
    setDeclaredParcelCodes(declaredCodes);
    setDeclarationsMap(map);
    fetchCloudDeclarations();

    // Tự động đồng bộ mỗi 30 giây (tiết kiệm CPU worker, không cần F5)
    const interval = setInterval(fetchCloudDeclarations, 30000);
    const onFocus = () => {
      // Chỉ đồng bộ khi focus nếu lần fetch trước cách ít nhất 10 giây
      if (Date.now() - lastFetchTimeRef.current > 10000) {
        fetchCloudDeclarations();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    // Lắng nghe sự kiện Realtime tức thì (0ms) từ Map hoặc các Tab khác
    const unsubscribeRealtime = onRealtimeEvent((event) => {
      if (event.type === 'DECLARATION_SAVED' && event.maThua) {
        const targetMaThua = event.maThua;
        if (event.declaration) {
          setDeclarationsMap((prev) => ({
            ...prev,
            [targetMaThua]: event.declaration,
          }));
        }
        if (event.declaredCodes) {
          setDeclaredParcelCodes(new Set(event.declaredCodes));
        } else {
          setDeclaredParcelCodes((prev) => new Set([...prev, targetMaThua]));
        }
        if (realtimeReloadTimeoutRef.current) clearTimeout(realtimeReloadTimeoutRef.current);
        realtimeReloadTimeoutRef.current = setTimeout(() => {
          fetchSyncSheetsReportRef.current?.(true);
        }, 350);
      } else if (event.type === 'DECLARATION_DELETED' && event.maThua) {
        const targetMaThua = event.maThua;
        setDeclarationsMap((prev) => {
          const next = { ...prev };
          delete next[targetMaThua];
          return next;
        });
        if (event.declaredCodes) {
          setDeclaredParcelCodes(new Set(event.declaredCodes));
        } else {
          setDeclaredParcelCodes((prev) => {
            const next = new Set(prev);
            next.delete(targetMaThua);
            return next;
          });
        }
      } else if (event.type === 'CELL_EDITS_SYNCED') {
        if (event.cellEdits) {
          setCellEdits((prev) => ({
            ...prev,
            ...event.cellEdits,
          }));
        }
      } else if (event.type === 'FORCE_REFRESH_REPORT') {
        fetchCloudDeclarations();
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribeRealtime();
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
    const [toFromCode, thuaFromCode] = maThua.split('_');
    if (!p && rowData) {
      p = {
        ma_thua: maThua,
        to_ban_do: toFromCode || '',
        so_thua: thuaFromCode || '',
        thon_xa: String(rowData[2] || ''),
        chu_ho: cleanName(String(rowData[3] || '')),
        cccd: cleanCccd(String(rowData[6] || '').replace(/^="|"$/g, '')),
        dien_tich: String(rowData[7] || ''),
        loai_dat: String(rowData[8] || 'DGT'),
        trang_thai: 'CO_TEN_CHUA_SO_HOA_VANG',
        polygon: [],
      } as any;
    }
    if (p) {
      const decl = declarationsMap[maThua] || {
        ma_thua: p.ma_thua,
        to_ban_do: p.to_ban_do,
        so_thua: p.so_thua,
        chu_dat_ten: cleanName(p.chu_ho),
        chu_dat_cccd: cleanCccd(p.cccd),
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

  const cellEditsSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const realtimeReloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fetchSyncSheetsReportRef = useRef<((force?: boolean) => Promise<void>) | null>(null);

  const syncCellEditsToCloud = useCallback((edits: Record<string, Record<number, string>>, immediate = false) => {
    if (cellEditsSyncTimeoutRef.current) {
      clearTimeout(cellEditsSyncTimeoutRef.current);
    }
    const doSync = async () => {
      try {
        await fetch('/api/declarations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'cell_edits', cellEdits: edits }),
          keepalive: true,
        });
      } catch (err) {
        console.warn('Lỗi đồng bộ cellEdits lên R2:', err);
      }
    };
    if (immediate) {
      doSync();
    } else {
      cellEditsSyncTimeoutRef.current = setTimeout(doSync, 300);
    }
  }, []);

  // Cập nhật giá trị ô trực tiếp khi người dùng gõ phím
  const handleInlineCellChange = (maThua: string, colIdx: number, val: string) => {
    setCellEdits((prev) => {
      const next = {
        ...prev,
        [maThua]: {
          ...(prev[maThua] || {}),
          [colIdx]: val,
        },
      };
      try {
        localStorage.setItem('diachinh_table_cell_edits', JSON.stringify(next));
      } catch {}
      syncCellEditsToCloud(next);
      return next;
    });
  };

  // Lưu giá trị vào Local Declarations và đồng bộ Realtime lên Cloudflare R2
  const handleInlineCellCommit = async (
    maThua: string,
    colIdx: number,
    headerName: string,
    newValue: string,
    row: any[],
    currentHeaders?: string[]
  ) => {
    const hNorm = stripAccents(headerName).toLowerCase().trim();
    let fieldKey: keyof DeclarationFormData | '' = '';
    if (hNorm.includes('ho va ten') || hNorm.includes('chu dat') || hNorm.includes('chu su dung') || hNorm.includes('chu ho')) fieldKey = 'chu_dat_ten';
    else if (hNorm.includes('nam sinh') || hNorm.includes('ngay sinh')) fieldKey = 'chu_dat_nam_sinh';
    else if (hNorm.includes('gioi tinh')) fieldKey = 'chu_dat_gioi_tinh';
    else if ((hNorm.includes('cccd') || hNorm.includes('cmnd') || hNorm.includes('dinh danh')) && !hNorm.includes('xem') && !hNorm.includes('file')) fieldKey = 'chu_dat_cccd';
    else if (hNorm.includes('thon') || hNorm.includes('buon') || hNorm.includes('dia chi')) fieldKey = 'dia_chi_thua_dat';
    else if (hNorm.includes('nguon goc')) fieldKey = 'nguon_goc';
    else if (hNorm.includes('ghi chu') || hNorm.includes('huong dan')) fieldKey = 'ghi_chu';
    else if (hNorm.includes('dien tich')) fieldKey = 'dien_tich';
    else if (hNorm.includes('loai dat')) fieldKey = 'loai_dat';

    if (!fieldKey) return;

    // Trong danh sách "CHƯA THỰC HIỆN": người dùng đang nhập nháp các ô.
    // Lưu ngay lập tức lên R2 mà không chờ debounce
    if (selectedReportSheet === 'CHƯA THỰC HIỆN') {
      const updatedEdits = {
        ...cellEdits,
        [maThua]: {
          ...(cellEdits[maThua] || {}),
          [colIdx]: newValue,
        },
      };
      syncCellEditsToCloud(updatedEdits, true);
      broadcastRealtimeEvent({
        type: 'CELL_EDITS_SYNCED',
        cellEdits: updatedEdits,
      });
      return;
    }

    // Tìm parcel gốc hoặc dựng từ row (đối với các sheet đã kê khai)
    const p = computedParcels.find((cp) => cp.ma_thua === maThua);
    const existingDecl = declarationsMap[maThua] || {};

    const findColVal = (patterns: RegExp[]): string => {
      if (!currentHeaders || !Array.isArray(row)) return '';
      const idx = currentHeaders.findIndex((h) => patterns.some((patt) => patt.test(stripAccents(String(h || '')).toLowerCase())));
      if (idx >= 0 && row[idx] !== undefined) {
        return String(row[idx]).replace(/^="|"$/g, '').trim();
      }
      return '';
    };

    const [toPart, thuaPart] = maThua.split('_');
    const toBanDo = existingDecl.to_ban_do || toPart || p?.to_ban_do || '';
    const soThua = existingDecl.so_thua || thuaPart || p?.so_thua || '';
    const chuDatTen = existingDecl.chu_dat_ten || existingDecl.chu_ho || findColVal([/ho va ten/, /chu dat/, /chu ho/]) || p?.chu_ho || '';
    const chuDatNamSinh = existingDecl.chu_dat_nam_sinh || findColVal([/nam sinh/, /ngay sinh/]) || (p as any)?.ngay_sinh || '';
    const chuDatGioiTinh = existingDecl.chu_dat_gioi_tinh || findColVal([/gioi tinh/]) || (p as any)?.gioi_tinh || 'Nam';
    const chuDatCccd = cleanCccd(existingDecl.chu_dat_cccd || existingDecl.cccd || findColVal([/cccd/, /cmnd/]) || p?.cccd || '');
    const diaChiThua = existingDecl.dia_chi_thua_dat || existingDecl.chu_dat_dia_chi || findColVal([/thon/, /buon/]) || (p?.thon_xa ? `${p.thon_xa}, xã Cư Pui` : 'Xã Cư Pui');
    const dienTich = existingDecl.dien_tich || findColVal([/dien tich/]) || p?.dien_tich || '';
    const loaiDat = existingDecl.loai_dat || findColVal([/loai dat/]) || p?.loai_dat || 'DGT';
    const nguonGoc = existingDecl.nguon_goc || existingDecl.nguon_goc_su_dung || findColVal([/nguon goc/]) || 'Khai hoang';

    const formattedValue = fieldKey === 'chu_dat_cccd' ? cleanCccd(newValue) : newValue.trim();

    const baseDecl: DeclarationFormData = {
      ...existingDecl,
      ma_thua: maThua,
      to_ban_do: toBanDo,
      so_thua: soThua,
      chu_dat_ten: chuDatTen,
      chu_dat_nam_sinh: chuDatNamSinh,
      chu_dat_gioi_tinh: chuDatGioiTinh,
      chu_dat_cccd: chuDatCccd,
      chu_dat_dia_chi: diaChiThua,
      dien_tich: dienTich,
      loai_dat: loaiDat,
      nguon_goc: nguonGoc,
      device_id: existingDecl.device_id || getOrCreateDeviceId(),
    };

    if (baseDecl[fieldKey] === formattedValue) return;

    const updatedDecl: DeclarationFormData = {
      ...baseDecl,
      [fieldKey]: formattedValue,
    };
    if (fieldKey === 'chu_dat_cccd') {
      updatedDecl.chu_dat_cccd = formattedValue;
      updatedDecl.cccd_chu_ho = formattedValue;
      (updatedDecl as any).cccd = formattedValue;
    }
    if (fieldKey === 'chu_dat_ten') {
      (updatedDecl as any).chu_ho = formattedValue;
      (updatedDecl as any).ho_va_ten_chu_ho = formattedValue;
    }
    if (fieldKey === 'dia_chi_thua_dat') {
      updatedDecl.dia_chi_thua_dat = formattedValue;
      updatedDecl.chu_dat_dia_chi = formattedValue.includes('xã Cư Pui') ? formattedValue : `${formattedValue}, xã Cư Pui`;
    }

    // 1. Cập nhật ngay tức thì vào React State & LocalStorage (0ms latency)
    const { updatedCodes, updatedMap } = saveOrUpdateDeclaration(updatedDecl);
    setDeclaredParcelCodes(new Set(updatedCodes));
    setDeclarationsMap(updatedMap);

    // 2. Cập nhật syncSheetsData cho sheet hiện tại
    setSyncSheetsData((prev) => {
      if (!prev || !prev[selectedReportSheet]) return prev;
      const sheet = prev[selectedReportSheet];
      const updatedRows = sheet.map((r, rIdx) => {
        if (rIdx === 0) return r;
        if (String(r[1] || '').trim() === maThua) {
          const nextRow = [...r];
          if (colIdx >= 0 && colIdx < nextRow.length) {
            nextRow[colIdx] = formattedValue;
          }
          return nextRow;
        }
        return r;
      });
      return {
        ...prev,
        [selectedReportSheet]: updatedRows,
      };
    });

    // 3. Xóa ô nháp trong cellEdits sau khi commit thành công
    setCellEdits((prev) => {
      if (!prev[maThua] || prev[maThua][colIdx] === undefined) return prev;
      const nextParcelEdits = { ...prev[maThua] };
      delete nextParcelEdits[colIdx];
      const next = { ...prev, [maThua]: nextParcelEdits };
      try {
        localStorage.setItem('diachinh_table_cell_edits', JSON.stringify(next));
      } catch {}
      return next;
    });

    // 4. Phát tín hiệu realtime ngay lập tức cho các tab khác
    broadcastRealtimeEvent({
      type: 'DECLARATION_SAVED',
      maThua,
      declaration: updatedDecl,
      declaredCodes: updatedCodes,
    });

    // Tự động kiểm tra file CCCD trên R2 nếu vừa nhập/sửa CCCD
    if (fieldKey === 'chu_dat_cccd' && formattedValue.length === 12) {
      if (r2CccdSet.has(formattedValue)) {
        setInlineSaveToast(`✓ Đã có hình ảnh / file PDF CCCD (${formattedValue}.pdf) trên R2!`);
        setTimeout(() => setInlineSaveToast(null), 3500);
      } else {
        fetch(`/api/cccd?check=${formattedValue}`)
          .then((res) => res.json())
          .then((data: any) => {
            if (data && data.exists) {
              setR2CccdSet((prev) => new Set(prev).add(formattedValue));
              setInlineSaveToast(`✓ Đã phát hiện file PDF CCCD (${formattedValue}.pdf) trên R2!`);
              setTimeout(() => setInlineSaveToast(null), 3500);
            }
          })
          .catch(() => {});
      }
    }

    // 5. Gửi lên Cloudflare R2 với cơ chế tự động retry để đảm bảo lưu thành công 100%
    setSavingRowCodes((prev) => new Set(prev).add(maThua));
    const attemptSave = async (retryCount = 0): Promise<boolean> => {
      try {
        const res = await fetch('/api/declarations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedDecl),
          keepalive: true,
        });
        if (res.ok) {
          return true;
        } else {
          if (retryCount < 2) {
            await new Promise((r) => setTimeout(r, 600 * (retryCount + 1)));
            return await attemptSave(retryCount + 1);
          }
          return false;
        }
      } catch (err) {
        if (retryCount < 2) {
          await new Promise((r) => setTimeout(r, 800 * (retryCount + 1)));
          return await attemptSave(retryCount + 1);
        }
        return false;
      } finally {
        if (retryCount === 0) {
          setSavingRowCodes((prev) => {
            const next = new Set(prev);
            next.delete(maThua);
            return next;
          });
        }
      }
    };
    attemptSave(0);
  };

  // Xác nhận kê khai thửa đất từ danh sách CHƯA THỰC HIỆN
  const handleCommitChuaThucHienDeclaration = async (maThua: string, row: any[]) => {
    const p = computedParcels.find((cp) => cp.ma_thua === maThua);
    const edits = cellEdits[maThua] || {};

    const [toFromCode, thuaFromCode] = maThua.split('_');
    const toBanDo = toFromCode || p?.to_ban_do || '';
    const soThua = thuaFromCode || p?.so_thua || '';
    const thonXa = String(edits[2] ?? row[2] ?? p?.thon_xa ?? '').trim();

    let chuDatTen = cleanName(String(edits[3] ?? row[3] ?? p?.chu_ho ?? '').trim());
    if (chuDatTen === 'Chưa có tên' || chuDatTen === 'Chưa Có Tên' || chuDatTen.toLowerCase().includes('chưa có')) {
      chuDatTen = '';
    }

    const chuDatNamSinh = String(edits[4] ?? row[4] ?? (p as any)?.ngay_sinh ?? '').trim();
    const chuDatGioiTinh = String(edits[5] ?? row[5] ?? (p as any)?.gioi_tinh ?? 'Nam').trim();
    const rawCccd = String(edits[6] ?? row[6] ?? p?.cccd ?? '').replace(/^="|"$/g, '').trim();
    const cleanCccdVal = cleanCccd(rawCccd);

    const dienTich = String(p?.dien_tich ?? row[7] ?? '').trim();
    const loaiDat = String(p?.loai_dat ?? row[8] ?? 'DGT').trim();
    const nguonGoc = normalizeNguonGoc(String(edits[9] ?? row[9] ?? 'Khai hoang').trim());
    const ghiChu = '';

    const diaChi = thonXa ? (thonXa.includes('xã Cư Pui') ? thonXa : `${thonXa}, xã Cư Pui`) : 'xã Cư Pui';
    const deviceId = getOrCreateDeviceId();

    const newDecl: DeclarationFormData = {
      ma_thua: maThua,
      to_ban_do: toBanDo,
      so_thua: soThua,
      chu_dat_ten: chuDatTen || (p?.chu_ho && p.chu_ho !== 'Chưa có tên' ? cleanName(p.chu_ho) : `Chủ Thửa ${soThua}`),
      chu_dat_nam_sinh: chuDatNamSinh,
      chu_dat_gioi_tinh: chuDatGioiTinh || 'Nam',
      chu_dat_cccd: cleanCccdVal,
      chu_dat_dia_chi: diaChi,
      dien_tich: dienTich,
      loai_dat: loaiDat,
      nguon_goc: nguonGoc,
      ghi_chu: ghiChu,
      device_id: deviceId,
    };

    // Đánh dấu đang lưu
    setSavingRowCodes((prev) => new Set(prev).add(maThua));

    // Cập nhật state local
    const { updatedCodes, updatedMap } = saveOrUpdateDeclaration(newDecl);
    lastCloudSigRef.current = JSON.stringify({ codes: updatedCodes, map: updatedMap });
    setDeclaredParcelCodes(new Set(updatedCodes));
    setDeclarationsMap(updatedMap);

    // Xóa nháp của mã thửa này khỏi cellEdits
    setCellEdits((prev) => {
      const next = { ...prev };
      delete next[maThua];
      try {
        localStorage.setItem('diachinh_table_cell_edits', JSON.stringify(next));
      } catch {}
      syncCellEditsToCloud(next, true);
      return next;
    });

    // Bỏ chọn nếu mã thửa này đang được chọn
    setChuaThucHienSelectedCodes((prev) => {
      if (!prev.has(maThua)) return prev;
      const next = new Set(prev);
      next.delete(maThua);
      return next;
    });

    // Xác định danh sách đích
    const hasCccd = cleanCccdVal && cleanCccdVal.length === 12;
    const targetLabel = hasCccd ? 'Sẵn Sàng Đóng Tập (Có CCCD)' : 'Đang Kê Khai (Chưa có CCCD)';
    setInlineSaveToast(`✓ Đã kê khai Thửa ${soThua} (Tờ ${toBanDo}). Dữ liệu đã chuyển sang [${targetLabel}]!`);
    setTimeout(() => setInlineSaveToast(null), 4500);

    // Gửi realtime lên Cloudflare R2 với retry và broadcast
    const attemptSaveCommit = async (retryCount = 0): Promise<boolean> => {
      try {
        const res = await fetch('/api/declarations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newDecl),
          keepalive: true,
        });
        if (res.ok) {
          broadcastRealtimeEvent({
            type: 'DECLARATION_SAVED',
            maThua,
            declaration: newDecl,
            declaredCodes: updatedCodes,
          });
          return true;
        } else {
          if (retryCount < 2) {
            await new Promise((r) => setTimeout(r, 600 * (retryCount + 1)));
            return await attemptSaveCommit(retryCount + 1);
          }
          return false;
        }
      } catch (err) {
        if (retryCount < 2) {
          await new Promise((r) => setTimeout(r, 800 * (retryCount + 1)));
          return await attemptSaveCommit(retryCount + 1);
        }
        return false;
      } finally {
        if (retryCount === 0) {
          setSavingRowCodes((prev) => {
            const next = new Set(prev);
            next.delete(maThua);
            return next;
          });
        }
      }
    };
    attemptSaveCommit(0);
  };

  // -------------------------------------------------------------
  // ĐIỀU CHỈNH ĐỘ RỘNG CỘT DANH SÁCH (KÉO THU NHỎ / NHẤN ĐÚP CĂN TỰ ĐỘNG)
  // -------------------------------------------------------------
  const getDefaultColWidth = (header: string, idx: number): number => {
    const h = (header || '').toLowerCase();
    if (idx === 0 && (h.includes('stt') || h === '')) return 50;
    if (h.includes('mã thửa')) return 110;
    if (h.includes('tờ')) return 70;
    if (h.includes('thửa')) return 75;
    if (h.includes('thôn') || h.includes('buôn')) return 120;
    if (h.includes('họ') || h.includes('tên') || h.includes('chủ')) return 175;
    if (h.includes('sinh')) return 85;
    if (h.includes('giới tính')) return 75;
    if (h.includes('cccd') && !h.includes('xem') && !h.includes('file')) return 125;
    if (h.includes('diện tích')) return 90;
    if (h.includes('loại đất')) return 80;
    if (h.includes('nguồn gốc')) return 120;
    if (h.includes('cccd') && (h.includes('xem') || h.includes('file'))) return 105;
    if (h.includes('scan') || (h.includes('file') && h.includes('tải'))) return 175;
    if (h.includes('ghi chú')) return 140;
    return 110;
  };

  const getColWidth = (idx: number, header: string): number => {
    const key = `${selectedReportSheet}_${idx}`;
    return colWidths[key] ?? getDefaultColWidth(header, idx);
  };

  const handleResizeStart = (colIdx: number, header: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const colKey = colIdx === -1 ? `${selectedReportSheet}_status` : `${selectedReportSheet}_${colIdx}`;
    const startWidth = colIdx === -1 ? (colWidths[colKey] ?? 110) : getColWidth(colIdx, header);

    let currentWidth = startWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      // Cho phép kéo thu nhỏ tối đa xuống 30px
      currentWidth = Math.max(30, Math.round(startWidth + delta));
      setColWidths((prev) => ({
        ...prev,
        [colKey]: currentWidth,
      }));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setColWidths((prev) => {
        const next = { ...prev, [colKey]: currentWidth };
        try {
          localStorage.setItem('diachinh_dashboard_col_widths', JSON.stringify(next));
        } catch {}
        return next;
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleResizeTouchStart = (colIdx: number, header: string, e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length !== 1) return;
    const startX = e.touches[0].clientX;
    const colKey = colIdx === -1 ? `${selectedReportSheet}_status` : `${selectedReportSheet}_${colIdx}`;
    const startWidth = colIdx === -1 ? (colWidths[colKey] ?? 110) : getColWidth(colIdx, header);

    let currentWidth = startWidth;

    const onTouchMove = (moveEvent: TouchEvent) => {
      if (moveEvent.touches.length !== 1) return;
      const delta = moveEvent.touches[0].clientX - startX;
      currentWidth = Math.max(30, Math.round(startWidth + delta));
      setColWidths((prev) => ({
        ...prev,
        [colKey]: currentWidth,
      }));
    };

    const onTouchEnd = () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      setColWidths((prev) => {
        const next = { ...prev, [colKey]: currentWidth };
        try {
          localStorage.setItem('diachinh_dashboard_col_widths', JSON.stringify(next));
        } catch {}
        return next;
      });
    };

    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onTouchEnd);
  };

  const handleAutoFit = (colIdx: number, header: string, sampleRows: any[][]) => {
    const colKey = colIdx === -1 ? `${selectedReportSheet}_status` : `${selectedReportSheet}_${colIdx}`;
    const hLower = (header || '').toLowerCase();
    const isMaThuaHeader = colIdx === 1 && selectedReportSheet === 'CHƯA THỰC HIỆN';
    const isNameHeader = /họ và tên|chủ đất/i.test(header);

    if (colIdx === -1) {
      setColWidths((prev) => {
        const next = { ...prev, [colKey]: 110 };
        try {
          localStorage.setItem('diachinh_dashboard_col_widths', JSON.stringify(next));
        } catch {}
        return next;
      });
      return;
    }

    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = document.createElement('canvas');
    } catch {}
    const ctx = canvas?.getContext('2d');

    const measureText = (text: string, font: string = '12px Inter, sans-serif') => {
      if (ctx) {
        ctx.font = font;
        return ctx.measureText(text).width;
      }
      return text.length * 7.5;
    };

    // Chiều rộng tiêu đề cột (kèm khoảng cách padding và nút bấm lọc/sắp xếp nếu có)
    const headerTextWidth = measureText(header, 'bold 12px Inter, sans-serif');
    let extraHeader = 20; // padding 10px mỗi bên
    if (isMaThuaHeader) extraHeader += 46; // Nút lọc Excel và badge số lượng
    if (isNameHeader) extraHeader += 30; // Icon sắp xếp A-Z
    let maxW = headerTextWidth + extraHeader;

    const isCccdView = hLower.includes('cccd') && (hLower.includes('xem') || hLower.includes('file'));
    if (isCccdView) {
      maxW = Math.max(maxW, 95);
    } else {
      // Đo độ rộng của nội dung các dòng (dòng hiện tại hoặc tối đa 100 dòng mẫu)
      (sampleRows || []).slice(0, 100).forEach((row) => {
        const rawVal = String(row[colIdx] || '').replace(/^="|"$/g, '');
        const cellW = measureText(rawVal, '12px Inter, sans-serif') + 20; // 20px padding
        if (cellW > maxW) {
          maxW = cellW;
        }
      });
    }

    // Căn chiều rộng tối thiểu vừa bằng nội dung (tối thiểu 35px)
    const fittedWidth = Math.max(35, Math.ceil(maxW) + 6);
    setColWidths((prev) => {
      const next = { ...prev, [colKey]: fittedWidth };
      try {
        localStorage.setItem('diachinh_dashboard_col_widths', JSON.stringify(next));
      } catch {}
      return next;
    });
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
      keepalive: true,
    })
      .then(async (res) => {
        if (res.ok) {
          const result = (await res.json()) as any;
          if (result.success && Array.isArray(result.declaredCodes)) {
            const cloudMap =
              result.declarationsMap && Object.keys(result.declarationsMap).length > 0
                ? result.declarationsMap
                : updatedMap;
            lastCloudSigRef.current = JSON.stringify({ codes: result.declaredCodes, map: cloudMap });
            setDeclaredParcelCodes(new Set(result.declaredCodes));
            setDeclarationsMap(cloudMap);
          }
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
            const cloudMap =
              result.declarationsMap && Object.keys(result.declarationsMap).length > 0
                ? result.declarationsMap
                : updatedMap;
            lastCloudSigRef.current = JSON.stringify({ codes: result.declaredCodes, map: cloudMap });
            setDeclaredParcelCodes(new Set(result.declaredCodes));
            setDeclarationsMap(cloudMap);
          }
        }
      })
      .catch((err) => console.warn('Lỗi khi xóa phiếu trên Cloud:', err));
  };

  // 2. Nạp báo cáo thống kê 16 thôn & đóng tập từ API nội bộ
  const fetchSyncSheetsReport = useCallback(async (force = false) => {
    setIsLoadingSyncSheets(true);
    try {
      const res = await fetch(`/api/sync-sheets${force ? '?force=true' : ''}`);
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

  useEffect(() => {
    fetchSyncSheetsReportRef.current = fetchSyncSheetsReport;
  }, [fetchSyncSheetsReport]);

  // 3. Đồng bộ Google Sheets Realtime
  const fetchGgsCodes = useCallback(async (force = false) => {
    setIsSyncingGgs(true);
    try {
      const res = await fetch(`/api/sync-ggs${force ? '?force=true' : ''}`);
      const data: any = await res.json();
      if (data && data.success) {
        if (Array.isArray(data.ggsCodes)) {
          setGgsCodes(new Set(data.ggsCodes));
        }
        if (Array.isArray(data.ggsCccds)) {
          setGgsCccdSet(new Set(data.ggsCccds));
        }
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

  // 4. Lấy danh sách CCCD đã có file trên R2 phục vụ kiểm tra realtime
  const fetchR2CccdList = useCallback(async () => {
    setIsLoadingR2Cccd(true);
    try {
      const res = await fetch(`/api/cccd?list_only=1&t=${Date.now()}`);
      const data: any = await res.json();
      if (data && data.success && Array.isArray(data.cccdList)) {
        setR2CccdSet(new Set(data.cccdList));
      }
    } catch (err) {
      console.warn('Lỗi nạp danh sách CCCD R2:', err);
    } finally {
      setIsLoadingR2Cccd(false);
    }
  }, []);

  const hasInitialLoadedRef = useRef(false);
  useEffect(() => {
    if (hasInitialLoadedRef.current) return;
    hasInitialLoadedRef.current = true;
    fetchGgsCodes();
    fetchR2CccdList();
    fetchSyncSheetsReport();
  }, [fetchGgsCodes, fetchR2CccdList, fetchSyncSheetsReport]);

  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    // Chỉ nạp báo cáo khi người dùng thực sự chuyển sang tab progressReport và chưa có dữ liệu
    if (activeTab === 'progressReport' && prevTabRef.current !== 'progressReport') {
      if (!syncSheetsData && !isLoadingSyncSheets) {
        fetchSyncSheetsReport();
      }
    }
    prevTabRef.current = activeTab;
  }, [activeTab, syncSheetsData, isLoadingSyncSheets, fetchSyncSheetsReport]);

  // 3. Tính toán trạng thái thực tế của từng thửa
  const computedParcels = useMemo(() => {
    return parcels.map((p) => {
      const isOnGgs = ggsCodes.has(p.ma_thua);
      const isDigitizedBlue = DIGITIZED_BLUE_SET.has(p.ma_thua);
      const isDeclared = declaredParcelCodes.has(p.ma_thua) || Boolean(declarationsMap[p.ma_thua]) || isDigitizedBlue;

      // Gộp thêm dữ liệu kê khai mới nhất từ LocalStorage (nếu có)
      const savedDecl = declarationsMap[p.ma_thua];
      const mergedChuHo = savedDecl?.chu_dat_ten || p.chu_ho;
      const mergedCccd = savedDecl?.chu_dat_cccd || p.cccd;

      let finalStatus: ParcelStatus;
      if (isOnGgs) {
        finalStatus = 'DA_SO_HOA_XANH';
      } else if (isDeclared || isDigitizedBlue) {
        finalStatus = 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
      } else if (p.trang_thai === 'DA_SO_HOA_XANH') {
        finalStatus = 'DA_SO_HOA_XANH';
      } else if (mergedChuHo && mergedChuHo !== 'Không có trong dữ liệu' && isPersonName(mergedChuHo)) {
        finalStatus = 'CO_TEN_CHUA_SO_HOA_VANG';
      } else {
        finalStatus = 'CHUA_CO_TEN_XAM';
      }

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

  // Kiểm tra một thửa đất có đầy đủ và hợp lệ toàn bộ thông tin kê khai hay chưa
  const isParcelInfoCompleteAndValid = useCallback((info: {
    chu_ho?: string;
    chu_dat_ten?: string;
    ngay_sinh?: string;
    nam_sinh?: string;
    chu_dat_nam_sinh?: string;
    gioi_tinh?: string;
    chu_dat_gioi_tinh?: string;
    thon_xa?: string;
    dia_chi?: string;
    chu_dat_dia_chi?: string;
    dien_tich?: string | number;
    loai_dat?: string;
    nguon_goc?: string;
    nguon_goc_su_dung?: string;
  }) => {
    const rawName = info.chu_dat_ten || info.chu_ho || '';
    const name = cleanName(rawName);
    if (!name || !isValidFullName(name) || name.toLowerCase().includes('chưa có') || name.toLowerCase().includes('không có')) {
      return false;
    }

    const birthYear = String(info.chu_dat_nam_sinh || info.nam_sinh || info.ngay_sinh || '').trim();
    if (!birthYear || !isValidBirthYear(birthYear)) return false;

    const gender = String(info.chu_dat_gioi_tinh || info.gioi_tinh || '').trim();
    if (!gender) return false;

    const village = String(info.thon_xa || info.dia_chi || info.chu_dat_dia_chi || '').trim();
    if (!village || village.toLowerCase().includes('chưa rõ')) {
      return false;
    }

    const area = parseFloat(String(info.dien_tich || '0'));
    if (isNaN(area) || area <= 0) return false;

    const landType = String(info.loai_dat || '').trim();
    if (!landType) return false;

    const origin = String(info.nguon_goc || info.nguon_goc_su_dung || '').trim();
    if (!origin) return false;

    return true;
  }, []);

  const hasCccdAndFile = useCallback((
    rawCccd: string | undefined,
    cccdUrl: string | undefined,
    r2Set: Set<string>
  ) => {
    const cccd = cleanCccd(rawCccd || '');
    if (!isValidCccd(cccd)) return false;
    return Boolean(r2Set.has(cccd) || cccdUrl);
  }, []);

  // Danh sách các thửa chưa số hóa trên GGS
  const nonGgsParcels = useMemo(() => {
    return computedParcels.filter(
      (p) => p.trang_thai !== 'DA_SO_HOA_XANH' && !ggsCodes.has(p.ma_thua)
    );
  }, [computedParcels, ggsCodes]);

  // 1. THỬA SẲN SÀNG ĐÓNG TẬP (CÓ CCCD): Thửa đã kê khai + CCCD 12 số + có file trên R2 (ĐÃ LỌC BỎ THỬA ONT ĐỂ BỔ SUNG SAU)
  const readyToPackParcels = useMemo(() => {
    return nonGgsParcels.filter((p) => {
      const isDeclared =
        declaredParcelCodes.has(p.ma_thua) ||
        Boolean(declarationsMap[p.ma_thua]) ||
        p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
      if (!isDeclared) return false;

      const decl = declarationsMap[p.ma_thua] || {};
      const edits = cellEdits[p.ma_thua] || {};
      const loaiDat = String(edits[8] ?? decl.loai_dat ?? p.loai_dat ?? '').trim();
      // Nếu loại đất là ONT hoặc có ONT: Tự động chuyển qua danh sách "GCN - ONT" để bổ sung sau
      if (/ont/i.test(loaiDat)) return false;

      const rawCccd = edits[6] ?? decl.chu_dat_cccd ?? decl.cccd_chu_ho ?? decl.cccd ?? p.cccd;
      const cccdUrl = decl.cccd_url || p.cccd_url;
      return hasCccdAndFile(rawCccd, cccdUrl, r2CccdSet);
    });
  }, [nonGgsParcels, declaredParcelCodes, declarationsMap, cellEdits, hasCccdAndFile, r2CccdSet]);

  // Danh sách thửa đất ONT chờ bổ sung sau (GCN - ONT)
  const gcnOntParcels = useMemo(() => {
    return nonGgsParcels.filter((p) => {
      const isDeclared =
        declaredParcelCodes.has(p.ma_thua) ||
        Boolean(declarationsMap[p.ma_thua]) ||
        p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
      if (!isDeclared) return false;

      const decl = declarationsMap[p.ma_thua] || {};
      const edits = cellEdits[p.ma_thua] || {};
      const loaiDat = String(edits[8] ?? decl.loai_dat ?? p.loai_dat ?? '').trim();
      return /ont/i.test(loaiDat);
    });
  }, [nonGgsParcels, declaredParcelCodes, declarationsMap, cellEdits]);

  // 2. THỬA ĐANG KÊ KHAI (CHƯA CÓ CCCD): Thửa đã kê khai NHƯNG chưa có CCCD hoặc chưa có file R2
  const dangKeKhaiChuaCccdParcels = useMemo(() => {
    return nonGgsParcels.filter((p) => {
      const isDeclared =
        declaredParcelCodes.has(p.ma_thua) ||
        Boolean(declarationsMap[p.ma_thua]) ||
        p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
      if (!isDeclared) return false;

      const decl = declarationsMap[p.ma_thua] || {};
      const edits = cellEdits[p.ma_thua] || {};
      const rawCccd = edits[6] ?? decl.chu_dat_cccd ?? decl.cccd_chu_ho ?? decl.cccd ?? p.cccd;
      const cccdUrl = decl.cccd_url || p.cccd_url;
      return !hasCccdAndFile(rawCccd, cccdUrl, r2CccdSet);
    });
  }, [nonGgsParcels, declaredParcelCodes, declarationsMap, cellEdits, hasCccdAndFile, r2CccdSet]);

  // Số lượng hiển thị chính xác, đồng bộ 100% giữa Card thống kê và Bảng danh sách
  const displayCountReadyToPack = useMemo(() => {
    if (syncSummary?.daDongTap !== undefined) {
      return syncSummary.daDongTap;
    }
    const rows = syncSheetsData?.['THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'];
    if (Array.isArray(rows) && rows.length > 1) {
      return rows.length - 1;
    }
    return readyToPackParcels.length;
  }, [syncSummary, syncSheetsData, readyToPackParcels.length]);

  const displayCountChuaCccd = useMemo(() => {
    if (syncSummary?.canTimCccd !== undefined && syncSummary?.khongCoCccd !== undefined) {
      return syncSummary.canTimCccd + syncSummary.khongCoCccd;
    }
    const rows = syncSheetsData?.['THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)'];
    if (Array.isArray(rows) && rows.length > 1) {
      return rows.length - 1;
    }
    return dangKeKhaiChuaCccdParcels.length;
  }, [syncSummary, syncSheetsData, dangKeKhaiChuaCccdParcels.length]);

  const displayCountTotalDangKeKhai = displayCountReadyToPack + displayCountChuaCccd;

  const displayCountNhapDuLieu = useMemo(() => {
    if (syncSummary?.nhapDuLieu !== undefined) {
      return syncSummary.nhapDuLieu;
    }
    const rows = syncSheetsData?.['NHẬP DỮ LIỆU'] || syncSheetsData?.['CHỜ NHẬP'];
    if (Array.isArray(rows) && rows.length > 1) {
      return rows.length - 1;
    }
    return 0;
  }, [syncSummary, syncSheetsData]);

  const displayCountGcnOnt = useMemo(() => {
    if (syncSummary?.gcnOnt !== undefined) {
      return syncSummary.gcnOnt;
    }
    const rows = syncSheetsData?.['GCN - ONT'];
    if (Array.isArray(rows) && rows.length > 1) {
      return rows.length - 1;
    }
    return gcnOntParcels.length;
  }, [syncSummary, syncSheetsData, gcnOntParcels.length]);

  // 3. THỬA CHƯA THỰC HIỆN: Các thửa chưa số hóa và chưa thực hiện kê khai
  const chuaThucHienParcels = useMemo(() => {
    return nonGgsParcels.filter((p) => {
      if (DIGITIZED_BLUE_SET.has(p.ma_thua)) return false;
      const isDeclared =
        declaredParcelCodes.has(p.ma_thua) ||
        Boolean(declarationsMap[p.ma_thua]) ||
        p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
      return !isDeclared;
    });
  }, [nonGgsParcels, declaredParcelCodes, declarationsMap]);

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

  // Helper xuất dữ liệu ra file Excel (.xlsx) thật 100% bằng thư viện SheetJS
  const exportToExcelXlsx = async (data: any[][], fileName: string, sheetName: string = 'Sheet1') => {
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      const safeSheetName = (sheetName || 'Sheet1').slice(0, 31).replace(/[:\\/\?\*\[\]]/g, '_');
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Lỗi khi xuất file Excel:', err);
      alert('Có lỗi khi tạo file Excel: ' + (err?.message || err));
    }
  };

  // 9. XUẤT EXCEL DANH SÁCH THỬA ĐÃ KÊ KHAI (.xlsx)
  const handleExportDeclaredExcel = async () => {
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

    const rows: any[][] = declaredList.map((p, idx) => {
      const decl = declarationsMap[p.ma_thua] || {};
      const chuHo = decl.chu_dat_ten || p.chu_ho || '';
      const cccd = decl.chu_dat_cccd || p.cccd || '';
      const ngaySinh = decl.chu_dat_ngay_sinh || (p as any).ngay_sinh || decl.chu_dat_nam_sinh || '';
      const sdt = decl.nguoi_ke_khai_sdt || p.sdt || '';
      const diaChi = decl.chu_dat_dia_chi || (p.thon_xa ? `${p.thon_xa}, Cư Pui` : 'Xã Cư Pui');
      const nguoiKekhai = decl.nguoi_ke_khai_ten || chuHo;
      const createdAt = decl.created_at || '';
      const ghiChu = decl.ghi_chu || '';
      const hasCccdImg = Boolean(decl.anh_cccd_truoc || p.cccd_url || decl.file_scan) ? 'Có' : 'Chưa';
      const hasGcnImg = Boolean(decl.anh_gcn || (p.gcn_urls && p.gcn_urls.length > 0) || decl.file_scan) ? 'Có' : 'Chưa';

      return [
        idx + 1,
        p.so_thua || '',
        p.to_ban_do || '',
        p.ma_thua || '',
        p.thon_xa || '',
        chuHo,
        cccd,
        ngaySinh,
        sdt,
        diaChi,
        nguoiKekhai,
        Number(p.dien_tich) || p.dien_tich || 0,
        p.loai_dat || '',
        createdAt,
        ghiChu,
        'Đã kê khai thực địa',
        hasCccdImg,
        hasGcnImg,
        p.lat || '',
        p.lng || '',
      ];
    });

    await exportToExcelXlsx(
      [headers, ...rows],
      `Danh_sach_thua_da_ke_khai_Cu_Pui_${new Date().toISOString().slice(0, 10)}.xlsx`,
      'ThuaDaKeKhai'
    );
  };

  // 9b. XUẤT FILE EXCEL CHUẨN MẪU ĐÓNG TẬP (EXCEL-MAUNHAP.xlsx)
  const handleExportExcelMauNhap = async (customRows?: any[], customHeaders?: string[]) => {
    const rows: any[][] = [];
    const exportedCodes = new Set<string>();

    if (customRows && Array.isArray(customRows) && customRows.length > 0) {
      const getIdx = (re: RegExp) => {
        if (!customHeaders) return -1;
        return customHeaders.findIndex((h) => re.test(h));
      };

      const maThuaIdx = getIdx(/^mã\s+thửa$/i);
      const toBdIdx = getIdx(/^(tờ|tờ\s+bđ|tờ\s+bản\s+đồ)$/i);
      const soThuaIdx = getIdx(/^(số\s+thửa|thửa\s+đất)$/i);
      const thonIdx = getIdx(/thôn|buôn/i);
      const nameIdx = getIdx(/họ và tên|chủ đất|chủ sử dụng|chủ hộ/i);
      const dobIdx = getIdx(/năm sinh|ngày sinh/i);
      const genderIdx = getIdx(/giới tính/i);
      const cccdIdx = getIdx(/cccd|cmnd/i);
      const dtIdx = getIdx(/diện tích/i);
      const loaiDatIdx = getIdx(/loại đất/i);
      const originIdx = getIdx(/nguồn gốc/i);

      customRows.forEach((r) => {
        const maThua = String(maThuaIdx >= 0 ? r[maThuaIdx] : r[1] || '').trim();
        if (!maThua || exportedCodes.has(maThua)) return;
        exportedCodes.add(maThua);

        const getVal = (idx: number) => (idx >= 0 ? String(cellEdits[maThua]?.[idx] ?? r[idx] ?? '').trim() : '');

        let toM = getVal(toBdIdx);
        let thuaM = getVal(soThuaIdx);
        if ((!toM || !thuaM) && maThua.includes('_')) {
          const parts = maThua.split('_');
          if (!toM) toM = parts[0] || '';
          if (!thuaM) thuaM = parts[1] || '';
        }

        const toThua = `${toM}_${thuaM}`;
        const thonM = getVal(thonIdx);
        const diaChi = thonM ? (thonM.toLowerCase().includes('cư pui') ? thonM : `${thonM}, Cư Pui`) : 'Xã Cư Pui';
        const chuHo = cleanName(getVal(nameIdx));
        const dob = getVal(dobIdx);
        const gender = getVal(genderIdx) || 'Nam';
        const rawCccd = getVal(cccdIdx);
        const cccd = cleanCccd(rawCccd);
        const dt = Number(getVal(dtIdx)) || getVal(dtIdx) || 0;
        const loaiDat = (getVal(loaiDatIdx) || 'ONT').toUpperCase();
        const ghiChu = getVal(originIdx) || 'Khai hoang';

        rows.push([
          toThua,
          diaChi,
          chuHo,
          dob,
          gender,
          cccd ? `'${cccd}` : '',
          loaiDat,
          dt,
          ghiChu,
        ]);
      });
    } else {
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

      targetParcels.forEach((p) => {
        const decl = declarationsMap[p.ma_thua] || {};
        const chuHo = cleanName(decl.chu_dat_ten || p.chu_ho || '');
        const cccd = cleanCccd(decl.chu_dat_cccd || p.cccd || '');
        const diaChi = decl.chu_dat_dia_chi || (p.thon_xa ? `${p.thon_xa}, Cư Pui` : 'Xã Cư Pui');
        const toThua = `${p.to_ban_do}_${p.so_thua}`;
        const dob = decl.chu_dat_ngay_sinh || (p as any).ngay_sinh || decl.chu_dat_nam_sinh || '';
        const gender = decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || 'Nam';

        rows.push([
          toThua,
          diaChi,
          chuHo,
          dob,
          gender,
          cccd ? `'${cccd}` : '',
          p.loai_dat || 'ONT',
          Number(p.dien_tich) || p.dien_tich || 0,
          decl.ghi_chu || 'Khai hoang',
        ]);
      });
    }

    if (rows.length === 0) {
      alert('Không có dữ liệu thửa đất nào để xuất file mẫu đóng tập.');
      return;
    }

    await exportToExcelXlsx(
      rows,
      `EXCEL-MAUNHAP_${new Date().toISOString().slice(0, 10)}.xlsx`,
      'MAUNHAP'
    );
  };

  // 9c. XUẤT FILE EXCEL 57 CỘT CHUẨN ĐỊA CHÍNH (EXCEL-MAUNHAP_57COT.xlsx)
  const handleExport57Cot = async (customRows?: any[], customHeaders?: string[]) => {
    const rows: any[][] = [];
    const exportedCodes = new Set<string>();

    // Helper chuẩn hóa ngày sinh chuẩn D/M/YYYY (hoặc 1/1/YYYY nếu chỉ có năm)
    const formatDob57 = (dobVal: any) => {
      if (!dobVal) return '';
      const s = String(dobVal).trim();
      const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (mIso) {
        return `${parseInt(mIso[3], 10)}/${parseInt(mIso[2], 10)}/${mIso[1]}`;
      }
      const clean = s.replace(/-/g, '/').replace(/[^\d/]/g, '');
      const parts = clean.split('/');
      if (parts.length === 3) {
        try {
          return `${parseInt(parts[0], 10)}/${parseInt(parts[1], 10)}/${parts[2]}`;
        } catch {
          return clean;
        }
      }
      if (parts.length === 1 && parts[0].length === 4) {
        return `1/1/${parts[0]}`;
      }
      return s;
    };

    // Helper chuẩn hóa diện tích định dạng phẩy (ví dụ 595,57)
    const formatArea57 = (areaVal: any) => {
      if (areaVal === null || areaVal === undefined || String(areaVal).trim() === '') return '';
      const s = String(areaVal).replace(/\s+/g, '').replace(',', '.');
      const num = parseFloat(s);
      if (isNaN(num)) return String(areaVal).trim();
      return num.toFixed(2).replace('.', ',');
    };

    // Helper chuẩn hóa nguồn gốc sử dụng đất
    const formatOrigin57 = (val: any) => {
      if (!val) return 'Khai hoang';
      const s = String(val).toLowerCase();
      if (s.includes('thừa kế') || s.includes('thua ke')) return 'Nhận thừa kế';
      if (s.includes('chuyển nhượng') || s.includes('chuyen nhuong')) return 'Nhận chuyển nhượng';
      if (s.includes('tặng cho') || s.includes('tang cho')) return 'Tặng cho';
      if (s.includes('khai hoang')) return 'Khai hoang';
      return String(val).trim();
    };

    if (customRows && Array.isArray(customRows) && customRows.length > 0) {
      const getIdx = (re: RegExp) => {
        if (!customHeaders) return -1;
        return customHeaders.findIndex((h) => re.test(h));
      };

      const maThuaIdx = getIdx(/^mã\s+thửa$/i);
      const toBdIdx = getIdx(/^(tờ|tờ\s+bđ|tờ\s+bản\s+đồ)$/i);
      const soThuaIdx = getIdx(/^(số\s+thửa|thửa\s+đất)$/i);
      const thonIdx = getIdx(/thôn|buôn/i);
      const nameIdx = getIdx(/họ và tên|chủ đất|chủ sử dụng|chủ hộ/i);
      const dobIdx = getIdx(/năm sinh|ngày sinh/i);
      const genderIdx = getIdx(/giới tính/i);
      const cccdIdx = getIdx(/cccd|cmnd/i);
      const dtIdx = getIdx(/diện tích/i);
      const loaiDatIdx = getIdx(/loại đất/i);
      const originIdx = getIdx(/nguồn gốc/i);
      const scanIdx = getIdx(/scan|tải|xem|tệp|file/i);

      customRows.forEach((r) => {
        const maThua = String(maThuaIdx >= 0 ? r[maThuaIdx] : r[1] || '').trim();
        if (!maThua || exportedCodes.has(maThua)) return;
        exportedCodes.add(maThua);

        const getVal = (idx: number) => (idx >= 0 ? String(cellEdits[maThua]?.[idx] ?? r[idx] ?? '').trim() : '');

        let toM = getVal(toBdIdx);
        let thuaM = getVal(soThuaIdx);
        if ((!toM || !thuaM) && maThua.includes('_')) {
          const parts = maThua.split('_');
          if (!toM) toM = parts[0] || '';
          if (!thuaM) thuaM = parts[1] || '';
        }

        const thonM = getVal(thonIdx);
        const nameM = getVal(nameIdx);
        const dobM = getVal(dobIdx);
        const genderM = getVal(genderIdx) || 'Nam';
        const rawCccd = getVal(cccdIdx);
        const dtM = getVal(dtIdx) || '0';
        const loaiDatM = (getVal(loaiDatIdx) || 'ONT').toUpperCase();
        const originM = getVal(originIdx) || 'Khai hoang';
        const scanCell = getVal(scanIdx);

        let fileName = '';
        const mFile = scanCell.match(/;\s*"([^"]+)"\)/) || scanCell.match(/"([^"]+\.pdf)"/i) || scanCell.match(/([a-zA-Z0-9_\-]+\.pdf)/i);
        if (mFile) {
          fileName = mFile[1];
        }
        if (!fileName) {
          fileName = `CHUACOGIAY_24478_${toM}_${thuaM}_DDK.pdf`;
        }

        const isHo = /^(hộ\s+ông|hộ\s+bà|hộ)/i.test(nameM);
        const subjType = isHo ? 'Hộ gia đình' : 'Cá nhân';
        const cleanChuSuDung = cleanName(nameM);
        const dob = formatDob57(dobM);
        const gender = genderM.toLowerCase().includes('nữ') ? 'Nữ' : 'Nam';
        const cccd = cleanCccd(rawCccd);
        const area = formatArea57(dtM);
        const origin = formatOrigin57(originM);

        let addr = thonM;
        if (addr && !addr.toLowerCase().includes('cư pui')) {
          addr = `${addr}, xã Cư Pui`;
        } else if (!addr) {
          addr = 'xã Cư Pui';
        }
        const maGcn = `CHUACOGIAY_24478_${toM}_${thuaM}`;

        const colArray = new Array(57).fill('');
        colArray[0] = '24478';
        colArray[1] = maGcn;
        colArray[6] = cleanChuSuDung;
        colArray[7] = dob;
        colArray[8] = gender;
        colArray[9] = cccd;
        colArray[10] = addr;
        colArray[11] = subjType;
        colArray[12] = subjType;
        colArray[20] = toM;
        colArray[21] = thuaM;
        colArray[22] = addr;
        colArray[23] = area;
        colArray[24] = loaiDatM;
        colArray[25] = area;
        colArray[26] = origin;
        colArray[48] = fileName;

        rows.push(colArray);
      });
    } else {
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
        alert('Chưa có thửa đất nào được chọn hoặc đã kê khai để xuất 57 cột.');
        return;
      }

      targetParcels.forEach((p) => {
        const maThua = p.ma_thua;
        if (!maThua || exportedCodes.has(maThua)) return;
        exportedCodes.add(maThua);

        const decl = declarationsMap[p.ma_thua] || {};
        const toM = String(p.to_ban_do || maThua.split('_')[0] || '');
        const thuaM = String(p.so_thua || maThua.split('_')[1] || '');
        let addr = decl.chu_dat_dia_chi || (p.thon_xa ? `${p.thon_xa}, xã Cư Pui` : 'xã Cư Pui');
        let name = decl.chu_dat_ten || p.chu_ho || '';
        let cccd = cleanCccd(decl.chu_dat_cccd || p.cccd || '');
        let dob = formatDob57(decl.chu_dat_ngay_sinh || (p as any).ngay_sinh || decl.chu_dat_nam_sinh || '');
        let gender = (decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || 'Nam').toLowerCase().includes('nữ') ? 'Nữ' : 'Nam';
        let loaiDat = (decl.loai_dat || p.loai_dat || 'ONT').toUpperCase();
        let area = formatArea57(p.dien_tich || '0');
        let origin = formatOrigin57(decl.nguon_goc || 'Khai hoang');

        const isHo = /^(hộ\s+ông|hộ\s+bà|hộ)/i.test(name);
        const cleanChuSuDung = cleanName(name);
        const subjType = isHo ? 'Hộ gia đình' : 'Cá nhân';
        const maGcn = `CHUACOGIAY_24478_${toM}_${thuaM}`;
        const fileName = `CHUACOGIAY_24478_${toM}_${thuaM}_DDK.pdf`;

        const colArray = new Array(57).fill('');
        colArray[0] = '24478';
        colArray[1] = maGcn;
        colArray[6] = cleanChuSuDung;
        colArray[7] = dob;
        colArray[8] = gender;
        colArray[9] = cccd;
        colArray[10] = addr;
        colArray[11] = subjType;
        colArray[12] = subjType;
        colArray[20] = toM;
        colArray[21] = thuaM;
        colArray[22] = addr;
        colArray[23] = area;
        colArray[24] = loaiDat;
        colArray[25] = area;
        colArray[26] = origin;
        colArray[48] = fileName;

        rows.push(colArray);
      });
    }

    if (rows.length === 0) {
      alert('Không có dữ liệu thửa đất nào để xuất 57 cột.');
      return;
    }

    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet(rows);

      // Đặt định dạng ô chuẩn TEXT (@) cho các cột mã xã, mã GCN, CCCD, tờ, thửa
      for (let R = 0; R < rows.length; ++R) {
        const c0 = XLSX.utils.encode_cell({ r: R, c: 0 });
        if (ws[c0]) { ws[c0].t = 's'; ws[c0].z = '@'; }
        const c1 = XLSX.utils.encode_cell({ r: R, c: 1 });
        if (ws[c1]) { ws[c1].t = 's'; ws[c1].z = '@'; }
        const c9 = XLSX.utils.encode_cell({ r: R, c: 9 });
        if (ws[c9]) { ws[c9].t = 's'; ws[c9].z = '@'; }
        const c20 = XLSX.utils.encode_cell({ r: R, c: 20 });
        if (ws[c20]) { ws[c20].t = 's'; ws[c20].z = '@'; }
        const c21 = XLSX.utils.encode_cell({ r: R, c: 21 });
        if (ws[c21]) { ws[c21].t = 's'; ws[c21].z = '@'; }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'DuLieuDiaChinh');
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'EXCEL-MAUNHAP_57COT.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Lỗi khi xuất file EXCEL-MAUNHAP_57COT.xlsx:', err);
      alert('Có lỗi khi tạo file Excel: ' + (err?.message || err));
    }
  };
  // Xuất file Excel (.xlsx) cho bảng báo cáo đang xem
  const handleExportReportSheet = async (sheetName: string) => {
    const rows = syncSheetsData?.[sheetName] || (sheetName === 'CHỜ NHẬP' ? syncSheetsData?.['NHẬP GGS'] : undefined);
    if (!rows || rows.length === 0) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = sheetName.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
    await exportToExcelXlsx(
      rows,
      `BAO_CAO_${safeName}_${dateStr}.xlsx`,
      sheetName
    );
  };

  // Xuất Báo Cáo Thống Kê Tiến Độ Toàn Xã & DS Cần Thu Thập CCCD Theo Từng Thôn Buôn
  const handleExportStatisticsPdf = async (options?: { onlyMissingCccd?: boolean; targetVillage?: string }) => {
    try {
      setIsExportingStatsPdf(true);
      setExportStatsProgress('Đang chuẩn bị dữ liệu...');
      const [{ generateStatisticsPdf }, { downloadPdfBlob }] = await Promise.all([
        import('@/utils/exportStatisticsPdf'),
        import('@/utils/pdfPacker'),
      ]);
      const { pdfBytes, fileName } = await generateStatisticsPdf(
        syncSheetsData,
        computedParcels,
        (msg) => setExportStatsProgress(msg),
        {
          onlyMissingCccd: options?.onlyMissingCccd,
          targetVillage: options?.targetVillage,
          declarationsMap,
        }
      );
      downloadPdfBlob(pdfBytes, fileName);
    } catch (err: any) {
      console.error('Lỗi xuất PDF:', err);
      alert('Không thể xuất PDF: ' + (err.message || 'Lỗi không xác định'));
    } finally {
      setIsExportingStatsPdf(false);
      setExportStatsProgress('');
    }
  };

  // Đóng tập PDF các thửa Sẵn sàng đóng tập (có CCCD) chuẩn logic PDF_Web_App
  const handleGenerateReadyToPackPdf = async (specificCodes?: string[]) => {
    let readyRows = syncSheetsData?.['THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'] || [];
    let headers: string[] = [];
    let dataRows: string[][] = [];

    if (readyRows.length > 1) {
      headers = (readyRows[0] || []).map((h) => stripAccents(String(h || '')).toLowerCase().trim());
      dataRows = readyRows.slice(1);
    } else if (readyToPackParcels.length > 0) {
      // Fallback từ readyToPackParcels nếu syncSheetsData chưa có
      headers = [
        'stt', 'ma thua', 'thon / buon', 'ho va ten chu dat',
        'nam sinh', 'gioi tinh', 'so cccd', 'dien tich (m2)', 'loai dat', 'nguon goc su dung',
        'xem file pdf cccd'
      ];
      dataRows = readyToPackParcels.map((p, idx) => {
        const decl = declarationsMap[p.ma_thua] || {};
        const cccdVal = cleanCccd(decl.chu_dat_cccd || decl.cccd_chu_ho || p.cccd || '');
        const cccdFileName = `${cccdVal}.pdf`;
        const cccdLink = `/api/image/cccd/${encodeURIComponent(cccdFileName)}`;
        const cccdFormula = cccdVal ? `=HYPERLINK("${cccdLink}"; "${cccdFileName}")` : '';
        return [
          String(idx + 1),
          p.ma_thua,
          decl.dia_chi_thua_dat || p.thon_xa || 'Xã Cư Pui',
          cleanName(decl.chu_dat_ten || p.chu_ho || 'Chưa có tên'),
          decl.chu_dat_nam_sinh || (p as any).ngay_sinh || '',
          decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || 'Nam',
          cccdVal ? `="${cccdVal}"` : '',
          decl.dien_tich || p.dien_tich || '',
          decl.loai_dat || p.loai_dat || 'DGT',
          normalizeNguonGoc(decl.nguon_goc || decl.nguon_goc_su_dung || 'Khai Hoang'),
          cccdFormula
        ];
      });
    }

    if (dataRows.length === 0) {
      alert('Hiện tại chưa có thửa nào sẵn sàng đóng tập (có CCCD).');
      return;
    }

    const filterSet = specificCodes && specificCodes.length > 0 ? new Set(specificCodes) : null;
    const targetRows = filterSet ? dataRows.filter((r) => filterSet.has(String(r[1] || '').trim())) : dataRows;

    if (targetRows.length === 0) {
      alert('Chưa chọn thửa đất nào để đóng tập.');
      return;
    }

    try {
      setIsPackagingPdf(true);
      setPackagingProgress(`Đang chuẩn bị ${targetRows.length} thửa...`);

      const findCol = (pattern: RegExp) => headers.findIndex((h) => pattern.test(h));
      const maThuaIdx = findCol(/^ma thua$/i) >= 0 ? findCol(/^ma thua$/i) : 1;
      const thonXaIdx = findCol(/thon|buon/i) >= 0 ? findCol(/thon|buon/i) : 2;
      const chuHoIdx = findCol(/ho va ten|chu dat|chu ho/i) >= 0 ? findCol(/ho va ten|chu dat|chu ho/i) : 3;
      const dobIdx = findCol(/nam sinh|ngay sinh/i) >= 0 ? findCol(/nam sinh|ngay sinh/i) : 4;
      const genderIdx = findCol(/gioi tinh/i) >= 0 ? findCol(/gioi tinh/i) : 5;
      const cccdIdx = findCol(/cccd/i) >= 0 ? findCol(/cccd/i) : 6;
      const dienTichIdx = findCol(/dien tich/i) >= 0 ? findCol(/dien tich/i) : 7;
      const loaiDatIdx = findCol(/loai dat/i) >= 0 ? findCol(/loai dat/i) : 8;
      const nguonGocIdx = findCol(/nguon goc/i) >= 0 ? findCol(/nguon goc/i) : 9;
      const cccdFormulaIdx = findCol(/xem|file/i) >= 0 ? findCol(/xem|file/i) : 10;

      const items: ReadyToPackItem[] = targetRows.map((row) => {
        const maThua = String(row[maThuaIdx] || '').trim();
        const p = computedParcels.find((cp) => cp.ma_thua === maThua);
        const decl = declarationsMap[maThua];

        // Tách mã thửa thành tờ bản đồ và số thửa chuẩn địa chính (ví dụ: 12_34 -> tờ 12, thửa 34)
        const parts = maThua.split('_');
        const toBanDo = parts[0] || p?.to_ban_do || '';
        const soThua = parts[1] || p?.so_thua || '';

        const rawThonXa = String(row[thonXaIdx] || decl?.dia_chi_thua_dat || decl?.chu_dat_dia_chi || p?.thon_xa || '').replace(/^="|"$/g, '').trim();
        const rawChuHo = String(row[chuHoIdx] || decl?.chu_dat_ten || p?.chu_ho || '').replace(/^="|"$/g, '').trim();
        const chuHo = cleanName(rawChuHo);
        const dob = String(row[dobIdx] || decl?.chu_dat_nam_sinh || '').replace(/^="|"$/g, '').trim();
        const gender = String(row[genderIdx] || decl?.chu_dat_gioi_tinh || 'Nam').replace(/^="|"$/g, '').trim();
        const cccdRaw = cleanCccd(String(row[cccdIdx] || decl?.chu_dat_cccd || decl?.cccd_chu_ho || p?.cccd || '').replace(/^="|"$/g, '').trim());
        const dienTich = String(row[dienTichIdx] || decl?.dien_tich || p?.dien_tich || '').replace(/^="|"$/g, '').trim();
        const loaiDat = String(row[loaiDatIdx] || decl?.loai_dat || p?.loai_dat || 'DGT').replace(/^="|"$/g, '').trim();
        const nguonGoc = normalizeNguonGoc(String(row[nguonGocIdx] || decl?.nguon_goc || decl?.nguon_goc_su_dung || 'Khai hoang').replace(/^="|"$/g, '').trim());

        const cccdFormula = String(row[cccdFormulaIdx] || '');
        let cccdFileName = '';
        let cccdUrl = '';

        const linkMatch = cccdFormula.match(/HYPERLINK\("([^"]+)"[,;]\s*"([^"]+)"\)/i);
        if (linkMatch) {
          cccdUrl = getResolvedImageUrl(linkMatch[1]);
          cccdFileName = linkMatch[2];
        } else {
          const fileMatch = cccdFormula.match(/["']?([^"']+\.(pdf|jpg|jpeg|png))["']?/i);
          if (fileMatch) {
            cccdFileName = fileMatch[1];
          } else if (cccdRaw) {
            cccdFileName = `${cccdRaw}.pdf`;
          }
          if (cccdFileName) {
            cccdUrl = `/api/image/cccd/${encodeURIComponent(cccdFileName)}`;
          }
        }

        const gcnList: string[] = [];
        if (decl?.anh_gcn_list && decl.anh_gcn_list.length > 0) gcnList.push(...decl.anh_gcn_list);
        else if (decl?.anh_gcn) gcnList.push(decl.anh_gcn);
        else if (p?.gcn_urls && p.gcn_urls.length > 0) gcnList.push(...p.gcn_urls);

        const permanentAddr = decl?.chu_dat_dia_chi || rawThonXa || p?.thon_xa || 'Xã Cư Pui';
        const parcelAddr = decl?.dia_chi_thua_dat || rawThonXa || p?.thon_xa || 'Xã Cư Pui';

        return {
          ma_thua: maThua,
          to_ban_do: toBanDo,
          so_thua: soThua,
          thon_xa: cleanDisplayAddress(parcelAddr),
          dia_chi: cleanDisplayAddress(permanentAddr),
          chu_ho: chuHo,
          dob: dob,
          gender: gender,
          cccd: cccdRaw,
          dien_tich: dienTich,
          loai_dat: loaiDat,
          nguon_goc: nguonGoc,
          cccd_file: cccdFileName,
          cccd_url: cccdUrl || decl?.anh_cccd_truoc || p?.cccd_url,
          has_gcn: gcnList.length > 0 || Boolean(p?.has_gcn),
          gcn_urls: gcnList,
        };
      });

      const { generateReadyToPackPdf, downloadPdfBlob } = await import('@/utils/pdfPacker');
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
    let readyRows = syncSheetsData?.['THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'] || [];
    let headers: string[] = [];
    let dataRows: string[][] = [];

    if (readyRows.length > 1) {
      headers = (readyRows[0] || []).map((h) => stripAccents(String(h || '')).toLowerCase().trim());
      dataRows = readyRows.slice(1);
    } else if (readyToPackParcels.length > 0) {
      headers = [
        'stt', 'ma thua', 'thon / buon', 'ho va ten chu dat',
        'nam sinh', 'gioi tinh', 'so cccd', 'dien tich (m2)', 'loai dat', 'nguon goc su dung',
        'xem file pdf cccd'
      ];
      dataRows = readyToPackParcels.map((p, idx) => {
        const decl = declarationsMap[p.ma_thua] || {};
        const cccdVal = cleanCccd(decl.chu_dat_cccd || decl.cccd_chu_ho || p.cccd || '');
        const cccdFileName = `${cccdVal}.pdf`;
        const cccdLink = `/api/image/cccd/${encodeURIComponent(cccdFileName)}`;
        const cccdFormula = cccdVal ? `=HYPERLINK("${cccdLink}"; "${cccdFileName}")` : '';
        return [
          String(idx + 1),
          p.ma_thua,
          decl.dia_chi_thua_dat || p.thon_xa || 'Thôn 1, xã Cư Pui',
          cleanName(decl.chu_dat_ten || p.chu_ho || 'Chủ sử dụng'),
          decl.chu_dat_nam_sinh || (p as any).ngay_sinh || '1980',
          decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || 'Nam',
          cccdVal ? `="${cccdVal}"` : '',
          decl.dien_tich || p.dien_tich || '1000',
          decl.loai_dat || p.loai_dat || 'DGT',
          normalizeNguonGoc(decl.nguon_goc || decl.nguon_goc_su_dung || 'Khai Hoang'),
          cccdFormula
        ];
      });
    }

    if (dataRows.length === 0) {
      alert('Hiện tại chưa có thửa nào sẵn sàng đóng tập (có CCCD).');
      return;
    }

    const filterSet = specificCodes && specificCodes.length > 0 ? new Set(specificCodes) : null;
    const targetRows = filterSet ? dataRows.filter((r) => filterSet.has(String(r[1] || '').trim())) : dataRows;

    if (targetRows.length === 0) {
      alert('Chưa chọn thửa đất nào để đóng tập.');
      return;
    }

    const findCol = (pattern: RegExp) => headers.findIndex((h) => pattern.test(h));
    const maThuaIdx = findCol(/^ma thua$/i) >= 0 ? findCol(/^ma thua$/i) : 1;
    const thonXaIdx = findCol(/thon|buon/i) >= 0 ? findCol(/thon|buon/i) : 2;
    const chuHoIdx = findCol(/ho va ten|chu dat|chu ho/i) >= 0 ? findCol(/ho va ten|chu dat|chu ho/i) : 3;
    const dobIdx = findCol(/nam sinh|ngay sinh/i) >= 0 ? findCol(/nam sinh|ngay sinh/i) : 4;
    const genderIdx = findCol(/gioi tinh/i) >= 0 ? findCol(/gioi tinh/i) : 5;
    const cccdIdx = findCol(/cccd/i) >= 0 ? findCol(/cccd/i) : 6;
    const dienTichIdx = findCol(/dien tich/i) >= 0 ? findCol(/dien tich/i) : 7;
    const loaiDatIdx = findCol(/loai dat/i) >= 0 ? findCol(/loai dat/i) : 8;
    const nguonGocIdx = findCol(/nguon goc/i) >= 0 ? findCol(/nguon goc/i) : 9;
    const cccdFormulaIdx = findCol(/xem|file/i) >= 0 ? findCol(/xem|file/i) : 10;

    const itemsToPrint: PrintableDeclarationItem[] = [];

    targetRows.forEach((row) => {
      const maThua = String(row[maThuaIdx] || '').trim();
      if (!maThua) return;

      const parts = maThua.split('_');
      const toBanDo = parts[0] || '';
      const soThua = parts[1] || '';

      const decl = declarationsMap[maThua] || {};
      const edits = cellEdits[maThua] || {};

      const rawThonXa = String(row[thonXaIdx] || '').replace(/^="|"$/g, '').trim();
      const rawChuHo = cleanName(String(row[chuHoIdx] || '').replace(/^="|"$/g, '').trim());
      const dob = String(row[dobIdx] || '').replace(/^="|"$/g, '').trim();
      const gender = String(row[genderIdx] || 'Nam').replace(/^="|"$/g, '').trim();
      const cccdRaw = cleanCccd(String(row[cccdIdx] || '').replace(/^="|"$/g, '').trim());
      const dienTich = String(row[dienTichIdx] || '').replace(/^="|"$/g, '').trim();
      const loaiDat = String(row[loaiDatIdx] || 'DGT').replace(/^="|"$/g, '').trim();
      const nguonGoc = normalizeNguonGoc(String(row[nguonGocIdx] || 'Khai hoang').replace(/^="|"$/g, '').trim());

      const p = computedParcels.find((cp) => cp.ma_thua === maThua);

      // Ưu tiên cao nhất: Dữ liệu người dùng đã chỉnh sửa trong DeclarationsMap hoặc CellEdits
      const finalChuHo = cleanName(String(decl.chu_dat_ten || edits[chuHoIdx] || rawChuHo || p?.chu_ho || '').trim());
      const finalDob = String(decl.chu_dat_nam_sinh || edits[dobIdx] || dob || '').trim();
      const finalGender = String(decl.chu_dat_gioi_tinh || edits[genderIdx] || gender || 'Nam').trim();
      const finalCccd = cleanCccd(String(decl.chu_dat_cccd || edits[cccdIdx] || cccdRaw || p?.cccd || '').trim());
      const finalDienTich = String(decl.dien_tich || dienTich || p?.dien_tich || '').trim();
      const finalLoaiDat = String(decl.loai_dat || loaiDat || p?.loai_dat || 'DGT').trim();
      const finalNguonGoc = normalizeNguonGoc(String(decl.nguon_goc || edits[nguonGocIdx] || nguonGoc || 'Khai hoang').trim());

      // Xác định địa chỉ có thôn/buôn chuẩn (VD: Buôn Khanh, xã Cư Pui)
      let finalThonXa = String(decl.dia_chi_thua_dat || decl.chu_dat_dia_chi || edits[thonXaIdx] || p?.thon_xa || rawThonXa || '').trim();
      if (!finalThonXa || finalThonXa.toLowerCase() === 'xã cư pui' || finalThonXa.toLowerCase() === 'cư pui') {
        if (p?.thon_xa && p.thon_xa.toLowerCase() !== 'xã cư pui') {
          finalThonXa = p.thon_xa;
        }
      }
      if (finalThonXa && !finalThonXa.toLowerCase().includes('cư pui')) {
        finalThonXa = `${finalThonXa}, xã Cư Pui`;
      }
      if (!finalThonXa) finalThonXa = 'xã Cư Pui';

      const cccdFormula = String(row[cccdFormulaIdx] || '');
      let cccdFileName = '';
      let cccdUrl = '';
      const linkMatch = cccdFormula.match(/HYPERLINK\("([^"]+)"[,;]\s*"([^"]+)"\)/i);
      if (linkMatch) {
        cccdUrl = getResolvedImageUrl(linkMatch[1]);
        cccdFileName = linkMatch[2];
      } else {
        const fileMatch = cccdFormula.match(/["']?([^"']+\.(pdf|jpg|jpeg|png))["']?/i);
        if (fileMatch) {
          cccdFileName = fileMatch[1];
        } else if (finalCccd) {
          cccdFileName = `${finalCccd}.pdf`;
        }
        if (cccdFileName) {
          cccdUrl = `/api/image/cccd/${encodeURIComponent(cccdFileName)}`;
        }
      }

      const parcelObj: Parcel = p ? { ...p, to_ban_do: toBanDo, so_thua: soThua, thon_xa: finalThonXa, chu_ho: finalChuHo, cccd: finalCccd, cccd_url: cccdUrl || p.cccd_url } : {
        ma_thua: maThua,
        to_ban_do: toBanDo,
        so_thua: soThua,
        thon_xa: finalThonXa,
        ten_xa_goc: 'Xã Cư Pui',
        chu_ho: finalChuHo,
        cccd: finalCccd,
        loai_dat: finalLoaiDat,
        dien_tich: finalDienTich,
        trang_thai: 'DA_KE_KHAI_CHUA_SO_HOA_LAM',
        lat: null,
        lng: null,
        gmap_link: '',
        cccd_url: cccdUrl,
      };

      const declObj = {
        ...decl,
        ma_thua: maThua,
        to_ban_do: toBanDo,
        so_thua: soThua,
        chu_dat_ten: finalChuHo,
        chu_dat_nam_sinh: finalDob,
        chu_dat_gioi_tinh: finalGender,
        chu_dat_cccd: finalCccd,
        dien_tich: finalDienTich,
        loai_dat: finalLoaiDat,
        nguon_goc: finalNguonGoc,
        dia_chi_thua_dat: finalThonXa,
        chu_dat_dia_chi: finalThonXa,
        anh_cccd_truoc: cccdUrl || decl.anh_cccd_truoc,
      };

      itemsToPrint.push({
        parcel: parcelObj,
        declaration: declObj,
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

  // 15. Xuất file Excel (.xlsx) toàn bộ danh sách đang lọc
  const handleExportCsv = async () => {
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
          : 'Chưa kê khai';

      return [
        idx + 1,
        p.so_thua || '',
        p.to_ban_do || '',
        p.thon_xa || '',
        p.chu_ho || '',
        p.cccd ? cleanCccd(p.cccd) : '',
        p.loai_dat || '',
        Number(p.dien_tich) || p.dien_tich || 0,
        statusText,
        p.lat || '',
        p.lng || '',
        p.gmap_link || '',
      ];
    });

    await exportToExcelXlsx(
      [headers, ...rows],
      `Bao_cao_dia_chinh_Cu_Pui_${new Date().toISOString().slice(0, 10)}.xlsx`,
      'BaoCaoDiaChinh'
    );
  };

  const isLight = theme === 'light';

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-200 selection:bg-blue-600 selection:text-white ${
      isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950 text-slate-100'
    }`}>
      {/* Top Navigation Bar - TÍCH HỢP 4 GIÁ TRỊ THỐNG KÊ THU NHỎ TRÊN HEADER */}
      <header className={`sticky top-0 z-40 backdrop-blur-md border-b shadow-xs transition-colors duration-200 no-print ${
        isLight ? 'bg-white/95 border-slate-200' : 'bg-slate-900/90 border-slate-800'
      }`}>
        <div className="w-full px-2 sm:px-4 lg:px-6 py-1.5 sm:py-2 flex flex-wrap items-center justify-between gap-2">
          {/* Cụm Trái: Nút Map + 4 Thống kê thu nhỏ */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <Link
              href="/"
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 transition transform active:scale-95 shrink-0"
              title="Về Bản đồ Vệ tinh Cư Pui"
            >
              <MapIcon className="w-4 h-4" />
            </Link>

            {/* 1. Tổng Thửa Quản Lý */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs shadow-2xs select-none ${
                isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-slate-800/80 border-slate-700 text-slate-200'
              }`}
              title={`Tổng quản lý: ${globalStats.total.toLocaleString('vi-VN')} thửa (Quy mô: ${globalStats.totalAreaHa.toLocaleString('vi-VN')} ha)`}
            >
              <Building2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-slate-400">Tổng:</span>
              <strong className="font-black text-slate-900 dark:text-white">{globalStats.total.toLocaleString('vi-VN')}</strong>
            </div>

            {/* 2. Đã Số Hóa (GGS) */}
            <button
              type="button"
              onClick={() => {
                setSelectedReportSheet('ĐÃ GIẢI QUYẾT');
                setActiveTab('progressReport');
                setReportPage(1);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs shadow-2xs transition cursor-pointer ${
                selectedReportSheet === 'ĐÃ GIẢI QUYẾT' && activeTab === 'progressReport'
                  ? 'ring-2 ring-emerald-500 border-emerald-500 bg-emerald-500/15'
                  : isLight
                  ? 'bg-emerald-50/80 hover:bg-emerald-100 border-emerald-200 text-emerald-800'
                  : 'bg-emerald-950/50 hover:bg-emerald-900/60 border-emerald-800/60 text-emerald-300'
              }`}
              title={`Đã số hóa: ${globalStats.green.toLocaleString('vi-VN')} thửa • Đã giải quyết: ${syncSummary?.daGiaiQuyet || 0}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="text-[10px] sm:text-[11px] font-bold">Số hóa:</span>
              <strong className="font-black">{globalStats.green.toLocaleString('vi-VN')}</strong>
            </button>

            {/* 3. Chưa Thực Hiện */}
            <button
              type="button"
              onClick={() => {
                setSelectedReportSheet('CHƯA THỰC HIỆN');
                setActiveTab('progressReport');
                setReportPage(1);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs shadow-2xs transition cursor-pointer ${
                selectedReportSheet === 'CHƯA THỰC HIỆN' && activeTab === 'progressReport'
                  ? 'ring-2 ring-rose-500 border-rose-500 bg-rose-500/15'
                  : isLight
                  ? 'bg-amber-50/80 hover:bg-amber-100 border-amber-200 text-amber-800'
                  : 'bg-amber-950/50 hover:bg-amber-900/60 border-amber-800/60 text-amber-300'
              }`}
              title={`Chưa thực hiện kê khai: ${chuaThucHienParcels.length.toLocaleString('vi-VN')} thửa`}
            >
              <Users className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="text-[10px] sm:text-[11px] font-bold">Chưa làm:</span>
              <strong className="font-black">{chuaThucHienParcels.length.toLocaleString('vi-VN')}</strong>
            </button>

            {/* 4. Đang Kê Khai (Tích hợp Chưa CCCD & Có CCCD) */}
            <div className={`flex items-center gap-1 p-0.5 rounded-xl border ${
              isLight ? 'bg-slate-100/90 border-slate-200' : 'bg-slate-900/90 border-slate-800'
            }`}>
              <span className="px-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 hidden xl:inline">
                Kê khai:
              </span>
              {/* Chưa CCCD */}
              <button
                type="button"
                onClick={() => {
                  setSelectedReportSheet('THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)');
                  setActiveTab('progressReport');
                  setReportPage(1);
                  setReportSearchQuery('');
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs transition cursor-pointer border ${
                  selectedReportSheet === 'THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)' && activeTab === 'progressReport'
                    ? 'bg-rose-500 text-white border-rose-500 font-black shadow-xs ring-1 ring-rose-400'
                    : isLight
                    ? 'bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700'
                    : 'bg-rose-950/50 hover:bg-rose-900/60 border-rose-800/60 text-rose-300'
                }`}
                title={`Đang kê khai chưa có CCCD: ${displayCountChuaCccd} thửa`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                <span className="text-[10px] font-medium">Chưa CCCD:</span>
                <strong className="font-black">{displayCountChuaCccd}</strong>
              </button>

              {/* Có CCCD */}
              <button
                type="button"
                onClick={() => {
                  setSelectedReportSheet('THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)');
                  setActiveTab('progressReport');
                  setReportPage(1);
                  setReportSearchQuery('');
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs transition cursor-pointer border ${
                  selectedReportSheet === 'THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)' && activeTab === 'progressReport'
                    ? 'bg-indigo-600 text-white border-indigo-600 font-black shadow-xs ring-1 ring-indigo-400'
                    : isLight
                    ? 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700'
                    : 'bg-indigo-950/50 hover:bg-indigo-900/60 border-indigo-800/60 text-indigo-300'
                }`}
                title={`Sẵn sàng đóng tập có CCCD: ${displayCountReadyToPack} thửa`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span className="text-[10px] font-medium">Có CCCD:</span>
                <strong className="font-black">{displayCountReadyToPack}</strong>
              </button>

              {/* Nhập dữ liệu (Đã scan) */}
              <button
                type="button"
                onClick={() => {
                  setSelectedReportSheet('NHẬP DỮ LIỆU');
                  setActiveTab('progressReport');
                  setReportPage(1);
                  setReportSearchQuery('');
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs transition cursor-pointer border ${
                  selectedReportSheet === 'NHẬP DỮ LIỆU' && activeTab === 'progressReport'
                    ? 'bg-cyan-600 text-white border-cyan-600 font-black shadow-xs ring-1 ring-cyan-400'
                    : isLight
                    ? 'bg-cyan-50 hover:bg-cyan-100 border-cyan-200 text-cyan-800'
                    : 'bg-cyan-950/50 hover:bg-cyan-900/60 border-cyan-800/60 text-cyan-300'
                }`}
                title={`Đơn kê khai đã đóng tập & đã scan có file trong R2: ${displayCountNhapDuLieu} thửa`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                <span className="text-[10px] font-medium">Nhập dữ liệu:</span>
                <strong className="font-black">{displayCountNhapDuLieu}</strong>
              </button>

              {/* 5. GCN - ONT (Thửa đất có đất ONT chờ bổ sung sau) */}
              <button
                type="button"
                onClick={() => {
                  setSelectedReportSheet('GCN - ONT');
                  setActiveTab('progressReport');
                  setReportPage(1);
                  setReportSearchQuery('');
                }}
                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs transition cursor-pointer border ${
                  selectedReportSheet === 'GCN - ONT' && activeTab === 'progressReport'
                    ? 'bg-amber-600 text-white border-amber-600 font-black shadow-xs ring-1 ring-amber-400'
                    : isLight
                    ? 'bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-800'
                    : 'bg-amber-950/50 hover:bg-amber-900/60 border-amber-800/60 text-amber-300'
                }`}
                title={`Danh sách thửa đất ONT chờ bổ sung sau: ${displayCountGcnOnt} thửa`}
              >
                <Home className="w-3 h-3 text-amber-500 shrink-0" />
                <span className="text-[10px] font-medium">GCN - ONT:</span>
                <strong className="font-black">{displayCountGcnOnt}</strong>
              </button>
            </div>
          </div>

          {/* Cụm Phải: Action buttons */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Nhóm Tab điều hướng */}
            <div className={`p-0.5 rounded-xl border flex items-center gap-0.5 ${
              isLight ? 'bg-slate-100/80 border-slate-200' : 'bg-slate-950/60 border-slate-800'
            }`}>
              {/* 1. Nút Tiến Độ 16 Thôn / Buôn */}
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === 'villages' ? 'progressReport' : 'villages')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === 'villages'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : isLight
                    ? 'text-slate-700 hover:bg-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Xem bảng thống kê chi tiết tiến độ 16 thôn buôn xã Cư Pui"
              >
                <Building2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="hidden sm:inline">16 Thôn/Buôn</span>
              </button>

              {/* Thu Thập CCCD - Danh sách theo từng thôn buôn */}
              <button
                type="button"
                onClick={() => setIsExportMissingCccdOpen(true)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  isLight
                    ? 'text-amber-700 hover:bg-amber-50 bg-amber-50/80 border border-amber-200'
                    : 'text-amber-300 hover:bg-amber-900/40 bg-amber-950/40 border border-amber-700/40'
                }`}
                title="Mở danh sách thu thập CCCD theo từng thôn buôn"
              >
                <Users className="w-3.5 h-3.5 text-amber-500" />
                <span>Thu CCCD</span>
              </button>

              {/* 2. Nút Kho CCCD (Quản Lý R2) */}
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === 'cccd' ? 'progressReport' : 'cccd')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === 'cccd'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : isLight
                    ? 'text-slate-700 hover:bg-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Mở kho lưu trữ và quản lý ảnh/PDF CCCD trên Cloudflare R2"
              >
                <FolderOpen className="w-3.5 h-3.5 text-purple-500" />
                <span>Kho CCCD</span>
              </button>

              {/* 3. Nút Kho File Scan (Quản Lý R2) */}
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === 'filescan' ? 'progressReport' : 'filescan')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === 'filescan'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : isLight
                    ? 'text-slate-700 hover:bg-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Mở kho lưu trữ và quản lý file scan hồ sơ đã ký trên Cloudflare R2"
              >
                <HardDrive className="w-3.5 h-3.5 text-sky-500" />
                <span>File Scan</span>
              </button>

              {/* 4. Nút Vị trí Cán Bộ Thực Địa (GPS Realtime) */}
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === 'cadres' ? 'progressReport' : 'cadres')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === 'cadres'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : isLight
                    ? 'text-slate-700 hover:bg-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Giám sát vị trí & di chuyển realtime của người kê khai"
              >
                <Radio className={`w-3.5 h-3.5 ${activeTab === 'cadres' ? 'text-white' : 'text-emerald-400 animate-pulse'}`} />
                <span>Vị trí Cán bộ</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              </button>
            </div>

            {/* Nút mở công cụ ScanName (Tách PDF & Đổi tên hồ sơ scan sau ký) */}
            <a
              href="/scanname"
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                isLight
                  ? 'bg-white hover:bg-slate-50 text-indigo-700 border-indigo-200 shadow-xs'
                  : 'bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border-indigo-500/30'
              }`}
              title="Mở công cụ Tách PDF & Quét CCCD / Đổi tên hồ sơ scan (ScanName)"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
              <span className="hidden md:inline">ScanName</span>
            </a>

            {/* Nút Xuất PDF Báo Cáo Thống Kê */}
            <button
              type="button"
              disabled={isExportingStatsPdf}
              onClick={() => handleExportStatisticsPdf()}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-75 border ${
                isLight
                  ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-600'
                  : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500'
              }`}
              title="Xuất PDF Báo cáo thống kê tiến độ 16 thôn buôn & danh sách có tên chưa thực hiện"
            >
              {isExportingStatsPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <FileBarChart2 className="w-3.5 h-3.5 text-amber-300" />
              )}
              <span>{isExportingStatsPdf ? 'Đang tạo...' : 'Xuất PDF'}</span>
            </button>

            {/* Nút Chuyển Giao Diện Light / Dark Mode */}
            <button
              onClick={toggleTheme}
              className={`flex items-center justify-center p-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                isLight
                  ? 'bg-white hover:bg-slate-100 text-amber-700 border-slate-200'
                  : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
              }`}
              title={isLight ? 'Chuyển sang Giao diện Tối' : 'Chuyển sang Giao diện Sáng'}
            >
              {isLight ? <Moon className="w-4 h-4 text-indigo-600" /> : <Sun className="w-4 h-4 text-amber-400" />}
            </button>
          </div>
        </div>
      </header>

      {/* Thanh trạng thái nạp cơ sở dữ liệu 11.280 thửa đất từ CDN */}
      {isLoadingParcels && (
        <div className="w-full bg-blue-600/10 border-b border-blue-500/20 px-4 py-1.5 flex items-center justify-center gap-2 text-xs font-semibold text-blue-400 no-print">
          <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
          <span>Đang nạp cơ sở dữ liệu 11.280 thửa đất xã Cư Pui từ CDN...</span>
        </div>
      )}

      {/* Main Container */}
      <main className={`flex-1 w-full py-4 sm:py-6 space-y-5 ${
        activeTab === 'progressReport' ? 'px-0 sm:px-1 md:px-2' : 'px-3 sm:px-6 lg:px-8'
      }`}>

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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
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
                      <span className="block text-[10px] text-amber-600 dark:text-amber-500">Chưa kê khai:</span>
                      <strong className="text-amber-600 dark:text-amber-400 font-bold">{v.yellow + v.gray}</strong>
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
            refreshKey={cccdTabRefreshKey}
            onOpenAddModal={(mode) => {
              setSelectedParcelForCccd('');
              setCccdModalMode(mode || 'folder');
              setIsCccdSupplementOpen(true);
            }}
            onPreviewUrl={(url, title) => {
              setPreviewPdfModal({
                isOpen: true,
                url,
                title,
                filename: title,
              });
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
            onPreviewUrl={(url, title) => {
              setPreviewPdfModal({
                isOpen: true,
                url,
                title,
                filename: title,
              });
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

        {/* TAB 5c: QUẢN LÝ VỊ TRÍ & DI CHUYỂN REALTIME CỦA CÁN BỘ */}
        {activeTab === 'cadres' && (
          <CadreTrackingTab
            theme={theme}
            isLight={isLight}
          />
        )}

        {/* TAB 6: BÁO CÁO TIẾN ĐỘ 16 THÔN & ĐÓNG TẬP NỘI BỘ (THAY THẾ THỐNG KÊ & DSTONG GGS) */}
        {activeTab === 'progressReport' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* BẢNG DỮ LIỆU CÁC SHEET CHI TIẾT (0. Chưa Kê Khai, 1. Chưa Có CCCD, 2. Sẵn Sàng Đóng Tập, 3. Chờ Nhập, 4. Đã Giải Quyết) */}
            <div className={`w-full space-y-4`}>
                {(() => {
                  let rawSheet = syncSheetsData?.[selectedReportSheet] || [];

                  // Fallback 1: CHƯA THỰC HIỆN
                  if (selectedReportSheet === 'CHƯA THỰC HIỆN') {
                    const headersChuaThucHien = [
                      'STT', 'Mã thửa', 'Thôn / Buôn', 'Họ và tên chủ đất (dự kiến)',
                      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng'
                    ];
                    const rowsChuaThucHien = chuaThucHienParcels.map((p, idx) => {
                      const cccdText = p.cccd ? `="${cleanCccd(p.cccd)}"` : 'Chưa có';
                      return [
                        String(idx + 1),
                        p.ma_thua,
                        p.thon_xa || 'Chưa rõ thôn',
                        cleanName(p.chu_ho || 'Chưa có tên'),
                        (p as any).ngay_sinh || '',
                        (p as any).gioi_tinh || 'Nam',
                        cccdText,
                        p.dien_tich || '0',
                        p.loai_dat || 'DGT',
                        'Khai Hoang'
                      ];
                    });
                    rawSheet = [headersChuaThucHien, ...rowsChuaThucHien];
                  }

                  // Fallback 2: THỬA SẲN SÀNG ĐÓNG TẬP (CÓ CCCD)
                  if ((!rawSheet || rawSheet.length <= 1) && selectedReportSheet === 'THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)') {
                    const headersPack = [
                      'STT', 'Mã thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
                      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng',
                      'Xem file PDF CCCD (Bấm vào xem)'
                    ];
                    const rowsPack = readyToPackParcels.map((p, idx) => {
                      const decl = declarationsMap[p.ma_thua] || {};
                      const cccdVal = cleanCccd(decl.chu_dat_cccd || decl.cccd_chu_ho || p.cccd || '');
                      const cccdFileName = `${cccdVal}.pdf`;
                      const cccdLink = `/api/image/cccd/${encodeURIComponent(cccdFileName)}`;
                      const cccdFormula = cccdVal ? `=HYPERLINK("${cccdLink}"; "${cccdFileName}")` : '';
                      return [
                        String(idx + 1),
                        p.ma_thua,
                        decl.dia_chi_thua_dat || p.thon_xa || 'Thôn 1, xã Cư Pui',
                        cleanName(decl.chu_dat_ten || p.chu_ho || 'Chủ sử dụng'),
                        decl.chu_dat_nam_sinh || (p as any).ngay_sinh || '1980',
                        decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || 'Nam',
                        cccdVal ? `="${cccdVal}"` : '',
                        decl.dien_tich || p.dien_tich || '1000',
                        decl.loai_dat || p.loai_dat || 'DGT',
                        normalizeNguonGoc(decl.nguon_goc || decl.nguon_goc_su_dung || 'Khai Hoang'),
                        cccdFormula
                      ];
                    });
                    rawSheet = [headersPack, ...rowsPack];
                  }

                  // Fallback 3: THỬA ĐANG KÊ KHAI (CHƯA CÓ CCCD)
                  if ((!rawSheet || rawSheet.length <= 1) && selectedReportSheet === 'THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)') {
                    const headersUnpack = [
                      'STT', 'Mã thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
                      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng'
                    ];
                    const rowsUnpack = dangKeKhaiChuaCccdParcels.map((p, idx) => {
                      const decl = declarationsMap[p.ma_thua] || {};
                      const cccdVal = cleanCccd(decl.chu_dat_cccd || decl.cccd_chu_ho || p.cccd || '');
                      return [
                        String(idx + 1),
                        p.ma_thua,
                        decl.dia_chi_thua_dat || p.thon_xa || 'Thôn 1, xã Cư Pui',
                        cleanName(decl.chu_dat_ten || p.chu_ho || 'Chủ sử dụng'),
                        decl.chu_dat_nam_sinh || (p as any).ngay_sinh || '1980',
                        decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || 'Nam',
                        cccdVal ? `="${cccdVal}"` : '',
                        decl.dien_tich || p.dien_tich || '1000',
                        decl.loai_dat || p.loai_dat || 'DGT',
                        normalizeNguonGoc(decl.nguon_goc || decl.nguon_goc_su_dung || 'Khai Hoang')
                      ];
                    });
                    rawSheet = [headersUnpack, ...rowsUnpack];
                  }

                  // Fallback 4: ĐÃ GIẢI QUYẾT
                  if ((!rawSheet || rawSheet.length <= 1) && selectedReportSheet === 'ĐÃ GIẢI QUYẾT') {
                    const headersDone = [
                      'STT', 'Mã thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
                      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng'
                    ];
                    const doneParcels = computedParcels.filter(
                      (p) => p.trang_thai === 'DA_SO_HOA_XANH' || ggsCodes.has(p.ma_thua)
                    );
                    const rowsDone = doneParcels.map((p, idx) => {
                      const decl = declarationsMap[p.ma_thua] || {};
                      const cccdVal = cleanCccd(decl.chu_dat_cccd || p.cccd || '');
                      return [
                        String(idx + 1),
                        p.ma_thua,
                        p.thon_xa || 'Xã Cư Pui',
                        cleanName(p.chu_ho || decl.chu_dat_ten || 'Chưa xác định'),
                        decl.chu_dat_nam_sinh || (p as any).ngay_sinh || '',
                        decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || 'Nam',
                        cccdVal ? `="${cccdVal}"` : '',
                        p.dien_tich || '',
                        p.loai_dat || 'DGT',
                        normalizeNguonGoc(decl.nguon_goc || decl.nguon_goc_su_dung || 'Khai Hoang')
                      ];
                    });
                    rawSheet = [headersDone, ...rowsDone];
                  }

                  // Fallback 5: GCN - ONT (Thửa đất ONT từ Nhập dữ liệu & Đóng tập chuyển sang)
                  if ((!rawSheet || rawSheet.length <= 1) && selectedReportSheet === 'GCN - ONT') {
                    const headersGcnOnt = [
                      'STT', 'Mã thửa', 'Tờ BĐ', 'Số thửa', 'Thôn / Buôn', 'Họ và tên chủ đất',
                      'Năm sinh', 'Giới tính', 'Số CCCD', 'Diện tích (m²)', 'Loại đất', 'Nguồn gốc sử dụng',
                      'Nguồn chuyển', 'File scan / CCCD'
                    ];
                    const rowsGcnOnt = gcnOntParcels.map((p, idx) => {
                      const decl = declarationsMap[p.ma_thua] || {};
                      const cccdVal = cleanCccd(decl.chu_dat_cccd || decl.cccd_chu_ho || p.cccd || '');
                      const cccdFileName = `${cccdVal}.pdf`;
                      const cccdLink = `/api/image/cccd/${encodeURIComponent(cccdFileName)}`;
                      const cccdFormula = cccdVal ? `=HYPERLINK("${cccdLink}"; "${cccdFileName}")` : 'Chưa có file';
                      return [
                        String(idx + 1),
                        p.ma_thua,
                        p.to_ban_do || p.ma_thua.split('_')[0] || '',
                        p.so_thua || p.ma_thua.split('_')[1] || '',
                        decl.dia_chi_thua_dat || p.thon_xa || 'Xã Cư Pui',
                        cleanName(decl.chu_dat_ten || p.chu_ho || 'Chủ sử dụng'),
                        decl.chu_dat_nam_sinh || (p as any).ngay_sinh || '1980',
                        decl.chu_dat_gioi_tinh || (p as any).gioi_tinh || 'Nam',
                        cccdVal ? `="${cccdVal}"` : '',
                        decl.dien_tich || p.dien_tich || '1000',
                        decl.loai_dat || p.loai_dat || 'ONT',
                        normalizeNguonGoc(decl.nguon_goc || decl.nguon_goc_su_dung || 'Khai Hoang'),
                        'Từ Đơn kê khai có CCCD',
                        cccdFormula
                      ];
                    });
                    rawSheet = [headersGcnOnt, ...rowsGcnOnt];
                  }

                  let headers = [...(rawSheet[0] || [])];
                  let allRows = (rawSheet.slice(1) || []).map((r) => [...r]);

                  // Bỏ các cột theo yêu cầu: Tờ BĐ, Số thửa, Trạng thái dữ liệu, Ghi chú, Trạng thái đóng tập, Trạng thái giải quyết, Phân loại trạng thái, Nguồn CCCD
                  const isExcludedCol = (h: string) => {
                    const norm = stripAccents(h).toLowerCase().trim();
                    return (
                      norm === 'to bd' ||
                      norm === 'to ban do' ||
                      norm === 'so thua' ||
                      norm.includes('trang thai du lieu') ||
                      norm.includes('trang thai dong tap') ||
                      norm.includes('trang thai giai quyet') ||
                      norm.includes('trang thai xu ly') ||
                      norm.includes('ghi chu') ||
                      norm.includes('phan loai') ||
                      norm.includes('nguon cccd')
                    );
                  };

                  const excludedIndices = new Set<number>();
                  headers.forEach((h, idx) => {
                    if (isExcludedCol(h)) excludedIndices.add(idx);
                  });
                  if (excludedIndices.size > 0) {
                    headers = headers.filter((_, idx) => !excludedIndices.has(idx));
                    allRows = allRows.map((r) => r.filter((_, idx) => !excludedIndices.has(idx)));
                  }

                  // Nhận diện cột Thôn / Buôn, Họ và tên và Phân loại trạng thái
                  const villageColIdx = headers.findIndex((h) => /thôn|buôn/i.test(h));
                  const nameColIdx = headers.findIndex((h) => /họ và tên|chủ đất/i.test(h));
                  const statusColIdx = headers.findIndex((h) => /phân loại/i.test(h));

                  const isChuaThucHienSheet = selectedReportSheet === 'CHƯA THỰC HIỆN';
                  const isReadyToPackSheet = selectedReportSheet === 'THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)';
                  const isChuaCoCccdSheet = selectedReportSheet === 'THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)';
                  const isNhapDuLieuSheet = selectedReportSheet === 'NHẬP DỮ LIỆU';
                  const isGcnOntSheet = selectedReportSheet === 'GCN - ONT';

                  // Thống kê Thôn / Buôn và số lượng thửa
                  const villageCounts: Record<string, number> = {};
                  allRows.forEach((r) => {
                    if (villageColIdx >= 0) {
                      const maThua = String(r[1] || '').trim();
                      const v = String(cellEdits[maThua]?.[villageColIdx] ?? r[villageColIdx] ?? '').trim();
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

                  // Hàm nhận diện trạng thái CCCD cho sheet "THỬA ĐANG KÊ KHAI (CHƯA CÓ CCCD)"
                  const getChuaCoCccdRowStatus = (maThua: string, r: any[]) => {
                    const cccdIdx = headers.findIndex((h) => /cccd/i.test(h) && !/xem|file/i.test(h));
                    const rawCccd = cellEdits[maThua]?.[cccdIdx] !== undefined
                      ? cellEdits[maThua][cccdIdx]
                      : (declarationsMap[maThua]?.chu_dat_cccd || declarationsMap[maThua]?.cccd_chu_ho || (cccdIdx >= 0 ? r[cccdIdx] : ''));
                    const cleanVal = cleanCccd(String(rawCccd || '').replace(/^="|"$/g, '').trim());
                    const cccdUrl = declarationsMap[maThua]?.cccd_url;

                    if (cleanVal && (r2CccdSet.has(cleanVal) || cccdUrl)) {
                      return 'ĐÃ CÓ CCCD (R2)';
                    }
                    // CHỈ KHI SỐ CCCD THỰC SỰ CÓ TRÊN GGS CHÍNH THÌ MỚI LÀ "CẦN TÌM CCCD"!
                    // Nếu không có trên GGS chính lẫn R2 thì là "KHÔNG CÓ CCCD"
                    if (cleanVal && ggsCccdSet.has(cleanVal)) {
                      return 'CẦN TÌM CCCD';
                    }
                    return 'KHÔNG CÓ CCCD';
                  };

                  // Danh sách Phân loại trạng thái (cho sheet Chưa có CCCD)
                  const statusCounts: Record<string, number> = {
                    'CẦN TÌM CCCD': 0,
                    'KHÔNG CÓ CCCD': 0,
                    'ĐÃ CÓ CCCD (R2)': 0,
                  };
                  if (isChuaCoCccdSheet) {
                    allRows.forEach((r) => {
                      const maThua = String(r[1] || '').trim();
                      const st = getChuaCoCccdRowStatus(maThua, r);
                      statusCounts[st] = (statusCounts[st] || 0) + 1;
                    });
                  }

                  // Danh sách tất cả mã thửa duy nhất của sheet Chưa thực hiện (chỉ tính toán khi dropdown mở)
                  const distinctMaThuas = (isChuaThucHienSheet && chuaThucHienDropdownOpen)
                    ? Array.from(new Set(allRows.map((r) => String(r[1] || '').trim()).filter(Boolean))).sort((a, b) => {
                        const [toA, thuaA] = a.split('_').map(Number);
                        const [toB, thuaB] = b.split('_').map(Number);
                        if (toA !== toB) return (toA || 0) - (toB || 0);
                        return (thuaA || 0) - (thuaB || 0);
                      })
                    : [];

                  const filteredDropdownList = (isChuaThucHienSheet && chuaThucHienDropdownOpen)
                    ? distinctMaThuas.filter((mt) => {
                        if (!chuaThucHienFilterSearch.trim()) return true;
                        return mt.toLowerCase().includes(chuaThucHienFilterSearch.trim().toLowerCase());
                      })
                    : [];

                  const cccdColIdx = headers.findIndex((h) => /cccd/i.test(h) && !/xem|file/i.test(h));
                  const searchQ = deferredReportSearchQuery ? stripAccents(deferredReportSearchQuery) : '';

                  // Áp dụng bộ lọc
                  const filtered = allRows.filter((row) => {
                    const maThua = String(row[1] || '').trim();

                    // 1. Tìm kiếm text (soát cả giá trị vừa nhập trực tiếp)
                    if (searchQ) {
                      // Short-circuit: Kiểm tra trước các cột thường tìm kiếm (mã thửa, tên, CCCD, thôn)
                      const fastCandidates = [
                        maThua,
                        nameColIdx >= 0 ? String(cellEdits[maThua]?.[nameColIdx] ?? row[nameColIdx] ?? '') : '',
                        cccdColIdx >= 0 ? String(cellEdits[maThua]?.[cccdColIdx] ?? row[cccdColIdx] ?? '') : '',
                        villageColIdx >= 0 ? String(cellEdits[maThua]?.[villageColIdx] ?? row[villageColIdx] ?? '') : '',
                      ];
                      let match = fastCandidates.some((val) => val && stripAccents(val).includes(searchQ));
                      if (!match) {
                        match = row.some((cell, cIdx) => {
                          if (!cell && !cellEdits[maThua]?.[cIdx]) return false;
                          const val = String(cellEdits[maThua]?.[cIdx] ?? cell ?? '');
                          return val ? stripAccents(val).includes(searchQ) : false;
                        });
                      }
                      if (!match) return false;
                    }

                    // 2. Lọc theo Thôn / Buôn
                    if (reportVillageFilter !== 'ALL' && villageColIdx >= 0) {
                      const v = String(cellEdits[maThua]?.[villageColIdx] ?? row[villageColIdx] ?? '').trim();
                      if (v !== reportVillageFilter) return false;
                    }

                    // 3. Lọc theo Phân loại trạng thái (cho sheet Đang kê khai - Chưa có CCCD)
                    if (isChuaCoCccdSheet && reportStatusFilter !== 'ALL') {
                      const st = getChuaCoCccdRowStatus(maThua, row);
                      if (st !== reportStatusFilter) return false;
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

                  // Sắp xếp theo Tên chủ đất A -> Z hoặc Z -> A (dùng viCollator dùng chung)
                  if (nameColIdx >= 0 && sortNameOrder !== 'none') {
                    filtered.sort((a, b) => {
                      const maA = String(a[1] || '').trim();
                      const maB = String(b[1] || '').trim();
                      const nameA = String(cellEdits[maA]?.[nameColIdx] ?? a[nameColIdx] ?? '').trim();
                      const nameB = String(cellEdits[maB]?.[nameColIdx] ?? b[nameColIdx] ?? '').trim();

                      const isAValid = Boolean(nameA && !nameA.toLowerCase().includes('chưa có tên'));
                      const isBValid = Boolean(nameB && !nameB.toLowerCase().includes('chưa có tên'));
                      if (isAValid && !isBValid) return -1;
                      if (!isAValid && isBValid) return 1;

                      const cmp = viCollator.compare(nameA, nameB);
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

                  // Kiểm tra một thửa đất đã có đầy đủ thông tin để kê khai hay chưa
                  const checkIsRowReadyToDeclare = (code: string, r: any[]) => {
                    const edits = cellEdits[code] || {};
                    const thonXa = String(edits[2] ?? r[2] ?? '').trim();
                    const chuDatTen = cleanName(String(edits[3] ?? r[3] ?? '').trim());
                    const chuDatNamSinh = String(edits[4] ?? r[4] ?? '').trim();
                    const chuDatGioiTinh = String(edits[5] ?? r[5] ?? 'Nam').trim();
                    const rawCccd = String(edits[6] ?? r[6] ?? '').replace(/^="|"$/g, '').trim();
                    const cleanCccdVal = cleanCccd(rawCccd);
                    const dienTich = String(r[7] ?? '').trim();
                    const loaiDat = String(r[8] ?? 'DGT').trim();
                    const nguonGoc = normalizeNguonGoc(String(edits[9] ?? r[9] ?? 'Khai hoang').trim());

                    return isParcelInfoCompleteAndValid({
                      chu_dat_ten: chuDatTen,
                      chu_dat_nam_sinh: chuDatNamSinh,
                      chu_dat_gioi_tinh: chuDatGioiTinh,
                      thon_xa: thonXa,
                      dien_tich: dienTich,
                      loai_dat: loaiDat,
                      nguon_goc: nguonGoc,
                    });
                  };

                  // Danh sách các thửa có đầy đủ thông tin để kê khai trong mục CHƯA THỰC HIỆN
                  const readyChuaThucHienRows = isChuaThucHienSheet
                    ? allRows.filter((r) => {
                        const code = String(r[1] || '').trim();
                        return checkIsRowReadyToDeclare(code, r);
                      })
                    : [];

                  const readyCount = readyChuaThucHienRows.length;

                  // Kê khai toàn bộ các thửa đã có đầy đủ thông tin (Batch 1 request duy nhất)
                  const handleCommitAllReadyDeclarations = async () => {
                    if (readyCount === 0 || isCommittingAllReady) return;
                    setIsCommittingAllReady(true);
                    try {
                      const newDecls: DeclarationFormData[] = [];
                      const deviceId = getOrCreateDeviceId();
                      const newlyDeclaredCodes: string[] = [];

                      for (const r of readyChuaThucHienRows) {
                        const code = String(r[1] || '').trim();
                        if (!code) continue;
                        const [toBanDo, soThua] = code.split('_');
                        const p = computedParcels.find((cp) => cp.ma_thua === code);
                        const edits = cellEdits[code] || {};
                        const thonXa = String(edits[2] ?? r[2] ?? p?.thon_xa ?? '').trim();
                        const chuDatTen = String(edits[3] ?? r[3] ?? p?.chu_ho ?? '').trim();
                        const chuDatNamSinh = String(edits[4] ?? r[4] ?? '').trim();
                        const chuDatGioiTinh = String(edits[5] ?? r[5] ?? 'Nam').trim();
                        const rawCccdVal = String(edits[6] ?? r[6] ?? p?.cccd ?? '').replace(/^="|"$/g, '').trim();
                        const cleanCccdVal = cleanCccd(rawCccdVal);
                        const dienTich = String(p?.dien_tich ?? r[7] ?? '').trim();
                        const loaiDat = String(p?.loai_dat ?? r[8] ?? 'DGT').trim();
                        const nguonGoc = normalizeNguonGoc(String(edits[9] ?? r[9] ?? 'Khai hoang').trim());
                        const diaChi = thonXa ? (thonXa.includes('xã Cư Pui') ? thonXa : `${thonXa}, xã Cư Pui`) : 'xã Cư Pui';

                        const newDecl: DeclarationFormData = {
                          ma_thua: code,
                          to_ban_do: toBanDo,
                          so_thua: soThua,
                          chu_dat_ten: chuDatTen || (p?.chu_ho && p.chu_ho !== 'Chưa có tên' ? cleanName(p.chu_ho) : `Chủ Thửa ${soThua}`),
                          chu_dat_nam_sinh: chuDatNamSinh,
                          chu_dat_gioi_tinh: chuDatGioiTinh || 'Nam',
                          chu_dat_cccd: cleanCccdVal,
                          chu_dat_dia_chi: diaChi,
                          dien_tich: dienTich,
                          loai_dat: loaiDat,
                          nguon_goc: nguonGoc,
                          ghi_chu: '',
                          device_id: deviceId,
                        };
                        newDecls.push(newDecl);
                        newlyDeclaredCodes.push(code);
                        saveOrUpdateDeclaration(newDecl);
                      }

                      // Gửi 1 request BATCH duy nhất lên Cloudflare R2
                      const res = await fetch('/api/declarations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ batch: newDecls }),
                      });

                      if (res.ok) {
                        const data = (await res.json()) as any;
                        if (data && data.declaredCodes) {
                          setDeclaredParcelCodes(new Set(data.declaredCodes));
                          setDeclarationsMap(data.declarationsMap || {});
                        }
                      }

                      // Dọn dẹp cellEdits của các thửa này
                      setCellEdits((prev) => {
                        const next = { ...prev };
                        newlyDeclaredCodes.forEach((c) => delete next[c]);
                        try {
                          localStorage.setItem('diachinh_table_cell_edits', JSON.stringify(next));
                        } catch {}
                        return next;
                      });

                      setInlineSaveToast(`✓ Đã kê khai thành công ${newDecls.length} thửa đất đủ thông tin! Dữ liệu đã chuyển sang danh sách tương ứng.`);
                      setTimeout(() => setInlineSaveToast(null), 4500);
                      await fetchSyncSheetsReport(true);
                    } catch (err) {
                      console.error('Lỗi kê khai các thửa đủ thông tin:', err);
                    } finally {
                      setIsCommittingAllReady(false);
                    }
                  };

                  // Danh sách các thửa trong mục ĐANG KÊ KHAI (CHƯA CÓ CCCD) đã phát hiện có file trên R2
                  const readyToMoveToPackRows = isChuaCoCccdSheet
                    ? allRows.filter((r) => {
                        const maThua = String(r[1] || '').trim();
                        const edits = cellEdits[maThua] || {};
                        const rawCccd = String(edits[6] ?? declarationsMap[maThua]?.chu_dat_cccd ?? r[6] ?? '').replace(/^="|"$/g, '').trim();
                        const cleanVal = cleanCccd(rawCccd);
                        return Boolean(cleanVal && (r2CccdSet.has(cleanVal) || declarationsMap[maThua]?.cccd_url));
                      })
                    : [];

                  // Chuyển toàn bộ các thửa đã có file CCCD trên R2 sang SẴN SÀNG ĐÓNG TẬP (Batch 1 request)
                  const handleMoveParcelsToReadyToPack = async () => {
                    if (readyToMoveToPackRows.length === 0 || isMovingParcelsToPack) return;
                    setIsMovingParcelsToPack(true);
                    try {
                      const updatedDecls: DeclarationFormData[] = [];
                      for (const r of readyToMoveToPackRows) {
                        const maThua = String(r[1] || '').trim();
                        const edits = cellEdits[maThua] || {};
                        const rawCccd = String(edits[6] ?? declarationsMap[maThua]?.chu_dat_cccd ?? r[6] ?? '').replace(/^="|"$/g, '').trim();
                        const cleanVal = cleanCccd(rawCccd);
                        if (maThua && cleanVal) {
                          const [toFromCode, thuaFromCode] = maThua.split('_');
                          const existingDecl = declarationsMap[maThua] || {
                            ma_thua: maThua,
                            to_ban_do: toFromCode || '',
                            so_thua: thuaFromCode || '',
                            chu_dat_ten: cleanName(String(r[3] || '')),
                            chu_dat_nam_sinh: String(r[4] || ''),
                            chu_dat_gioi_tinh: String(r[5] || 'Nam'),
                            chu_dat_dia_chi: String(r[2] ? `${r[2]}, xã Cư Pui` : 'xã Cư Pui'),
                            dien_tich: String(r[7] || ''),
                            loai_dat: String(r[8] || 'DGT'),
                            nguon_goc: normalizeNguonGoc(String(r[9] || 'Khai hoang')),
                          };
                          const updatedDecl: DeclarationFormData = {
                            ...existingDecl,
                            chu_dat_cccd: cleanVal,
                            cccd_chu_ho: cleanVal,
                            cccd: cleanVal,
                          };
                          saveOrUpdateDeclaration(updatedDecl);
                          updatedDecls.push(updatedDecl);
                        }
                      }

                      if (updatedDecls.length > 0) {
                        // Dọn dẹp cellEdits của các thửa này
                        setCellEdits((prev) => {
                          const next = { ...prev };
                          updatedDecls.forEach((d) => delete next[d.ma_thua]);
                          try {
                            localStorage.setItem('diachinh_table_cell_edits', JSON.stringify(next));
                          } catch {}
                          return next;
                        });

                        // Cập nhật UI tức thì (Optimistic UI Update): Di chuyển ngay lập tức giữa 2 sheet
                        const movedMaThuas = new Set(updatedDecls.map((d) => d.ma_thua));
                        setSyncSheetsData((prev) => {
                          if (!prev) return prev;
                          const oldUnpack = prev['THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)'] || [];
                          const oldPack = prev['THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)'] || [];

                          const headerUnpack = oldUnpack[0] || [];
                          const headerPack = oldPack[0] || [];

                          const remainingUnpackRows = oldUnpack.slice(1).filter((r) => !movedMaThuas.has(String(r[1] || '').trim()));
                          const newUnpack = [
                            headerUnpack,
                            ...remainingUnpackRows.map((r, idx) => [String(idx + 1), ...r.slice(1)]),
                          ];

                          const newlyPackedRows = readyToMoveToPackRows.map((r) => {
                            const maThua = String(r[1] || '').trim();
                            const decl = updatedDecls.find((d) => d.ma_thua === maThua);
                            const cccdNum = decl?.chu_dat_cccd || '';
                            const cccdText = cccdNum ? `="${cccdNum}"` : '';
                            const fileName = `${cccdNum}.pdf`;
                            const fileUrl = `/api/image/cccd/${encodeURIComponent(fileName)}`;
                            const fileFormula = `=HYPERLINK("${fileUrl}"; "${fileName}")`;
                            return [
                              '',
                              maThua,
                              String(r[2] || ''),
                              String(decl?.chu_dat_ten || r[3] || ''),
                              String(decl?.chu_dat_nam_sinh || r[4] || ''),
                              String(decl?.chu_dat_gioi_tinh || r[5] || 'Nam'),
                              cccdText,
                              String(decl?.dien_tich || r[7] || ''),
                              String(decl?.loai_dat || r[8] || 'DGT'),
                              String(decl?.nguon_goc || r[9] || 'Khai Hoang'),
                              fileFormula,
                            ];
                          });

                          const mergedPackRows = [...oldPack.slice(1), ...newlyPackedRows];
                          const newPack = [
                            headerPack,
                            ...mergedPackRows.map((r, idx) => [String(idx + 1), ...r.slice(1)]),
                          ];

                          return {
                            ...prev,
                            'THỬA ĐANG KÊ KHAI(CHƯA CÓ CCCD)': newUnpack,
                            'THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)': newPack,
                          };
                        });

                        setSyncSummary((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            daDongTap: (prev.daDongTap || 0) + updatedDecls.length,
                            khongCoCccd: Math.max(0, (prev.khongCoCccd || 0) - updatedDecls.length),
                          };
                        });

                        // Gửi batch lưu lên Cloudflare R2
                        const res = await fetch('/api/declarations', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ batch: updatedDecls }),
                        });
                        if (res.ok) {
                          const data = (await res.json()) as any;
                          if (data && data.declaredCodes) {
                            setDeclaredParcelCodes(new Set(data.declaredCodes));
                            setDeclarationsMap(data.declarationsMap || {});
                          }
                        }
                      }

                      setInlineSaveToast(`✓ Đã chuyển thành công ${updatedDecls.length} thửa có file CCCD trên R2 sang Sẵn Sàng Đóng Tập!`);
                      setTimeout(() => setInlineSaveToast(null), 4000);
                      setSelectedReportSheet('THỬA SẲN SÀNG ĐÓNG TẬP(CÓ CCCD)');
                      await fetchSyncSheetsReport(true);
                    } catch (err) {
                      console.error('Lỗi chuyển thửa sang đóng tập:', err);
                    } finally {
                      setIsMovingParcelsToPack(false);
                    }
                  };

                  // Trích xuất thông tin thửa đất từ dòng trong bảng
                  const extractParcelFromRow = (r: any[]) => {
                    const maThua = String(r[1] || '').trim();
                    const parts = maThua.split('_');
                    const toColIdx = headers.findIndex((h) => /tờ bđ|tờ bản đồ|số tờ/i.test(h));
                    const thuaColIdx = headers.findIndex((h) => /số thửa|thửa số/i.test(h));
                    const villageColIdx = headers.findIndex((h) => /thôn|buôn/i.test(h));
                    const nameColIdx = headers.findIndex((h) => /họ và tên|chủ đất/i.test(h));
                    const dobColIdx = headers.findIndex((h) => /năm sinh|ngày sinh/i.test(h));
                    const genderColIdx = headers.findIndex((h) => /giới tính/i.test(h));
                    const cccdColIdx = headers.findIndex((h) => /cccd|cmnd|định danh/i.test(h) && !/xem|file/i.test(h));
                    const areaColIdx = headers.findIndex((h) => /diện tích/i.test(h));
                    const landTypeColIdx = headers.findIndex((h) => /loại đất|mục đích/i.test(h));
                    const originColIdx = headers.findIndex((h) => /nguồn gốc/i.test(h));
                    const scanColIdx = headers.findIndex((h) => /scan|hồ sơ/i.test(h));

                    const soTo = String(toColIdx !== -1 ? r[toColIdx] : parts[0] || '').trim();
                    const soThua = String(thuaColIdx !== -1 ? r[thuaColIdx] : parts[1] || '').trim();
                    const thonXa = String(villageColIdx !== -1 ? r[villageColIdx] : '').trim();
                    const chuHo = cleanName(String(nameColIdx !== -1 ? r[nameColIdx] : '').trim());
                    const namSinh = String(dobColIdx !== -1 ? r[dobColIdx] : '').trim();
                    const gioiTinh = String(genderColIdx !== -1 ? r[genderColIdx] : 'Nam').trim();
                    const rawCccd = String(cccdColIdx !== -1 ? r[cccdColIdx] : '').replace(/^="|"$/g, '').trim();
                    const cccd = cleanCccd(rawCccd);
                    const dienTich = String(areaColIdx !== -1 ? r[areaColIdx] : '').replace(',', '.').trim();
                    const loaiDat = String(landTypeColIdx !== -1 ? r[landTypeColIdx] : '').trim().toUpperCase();
                    const nguonGoc = String(originColIdx !== -1 ? r[originColIdx] : 'Khai hoang').trim();

                    let scanFile = '';
                    const scanCell = String(scanColIdx !== -1 ? r[scanColIdx] : '');
                    const m = scanCell.match(/CHUACOGIAY_[^"';,)]+\.pdf/i) || scanCell.match(/[^"';,)\\]+\.pdf/i);
                    if (m) {
                      scanFile = m[0];
                    } else {
                      scanFile = `CHUACOGIAY_24478_${soTo}_${soThua}-DDK.pdf`;
                    }

                    return {
                      ma_thua: maThua,
                      so_to: soTo,
                      so_thua: soThua,
                      thon_xa: thonXa,
                      chu_ho: chuHo,
                      nam_sinh: namSinh,
                      gioi_tinh: gioiTinh,
                      cccd,
                      dien_tich: dienTich,
                      loai_dat: loaiDat,
                      nguon_goc: nguonGoc,
                      scan_file: scanFile,
                    };
                  };

                  // Lọc các dòng hợp lệ có thể nhập lên web KH2959 trong sheet NHẬP DỮ LIỆU
                  const validNonOntNhapDuLieuRows = isNhapDuLieuSheet
                    ? allRows.filter((r) => {
                        const maThua = String(r[1] || '').trim();
                        if (!maThua || kh2959ImportedCodes.has(maThua)) return false;
                        const p = extractParcelFromRow(r);
                        return !/ont/i.test(p.loai_dat || '');
                      })
                    : [];

                  // Nộp đơn lẻ 1 thửa lên web KH2959
                  const handleSingleImportToKh2959 = async (r: any[]) => {
                    const p = extractParcelFromRow(r);
                    if (!p.ma_thua || isSubmittingWeb) return;
                    if (/ont/i.test(p.loai_dat || '')) {
                      alert(`Thửa ${p.so_thua} (Tờ ${p.so_to}) có loại đất ${p.loai_dat} (ONT) - Thuộc diện bổ sung sau, vui lòng xem tại tab 'GCN - ONT'!`);
                      return;
                    }
                    setSubmittingRowCode(p.ma_thua);
                    try {
                      const res = await fetch('/api/kh2959/submit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(p),
                      });
                      const data = (await res.json()) as any;
                      const resItem = data?.results?.[0];
                      if (resItem?.ok) {
                        setKh2959ImportedCodes((prev) => {
                          const next = new Set(prev);
                          next.add(p.ma_thua);
                          try {
                            localStorage.setItem('kh2959_imported_parcels', JSON.stringify(Array.from(next)));
                          } catch {}
                          return next;
                        });
                        setInlineSaveToast(`✓ Đã nhập thành công Thửa ${p.so_thua} (Tờ ${p.so_to}) lên hệ thống máy chủ KH2959!`);
                        setTimeout(() => setInlineSaveToast(null), 4000);
                      } else {
                        alert(`Lỗi khi nộp: ${resItem?.error || data?.error || 'Thao tác không thành công'}`);
                      }
                    } catch (err: any) {
                      alert(`Lỗi kết nối: ${err.message}`);
                    } finally {
                      setSubmittingRowCode(null);
                    }
                  };

                  // Nộp hàng loạt các thửa hợp lệ (không chứa ONT) lên KH2959
                  const handleBatchImportToKh2959 = async () => {
                    if (isSubmittingWeb || validNonOntNhapDuLieuRows.length === 0) return;
                    const confirmMsg = `Bạn có chắc muốn tự động nhập ${validNonOntNhapDuLieuRows.length} thửa đất hợp lệ (không chứa đất ONT) lên web KH2959 không?`;
                    if (!window.confirm(confirmMsg)) return;

                    setIsSubmittingWeb(true);
                    setBatchProgress({ current: 0, total: validNonOntNhapDuLieuRows.length });

                    let successCount = 0;
                    let failCount = 0;

                    for (let i = 0; i < validNonOntNhapDuLieuRows.length; i++) {
                      const r = validNonOntNhapDuLieuRows[i];
                      const p = extractParcelFromRow(r);
                      setBatchProgress({ current: i + 1, total: validNonOntNhapDuLieuRows.length });
                      setSubmittingRowCode(p.ma_thua);

                      try {
                        const res = await fetch('/api/kh2959/submit', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(p),
                        });
                        const data = (await res.json()) as any;
                        const resItem = data?.results?.[0];
                        if (resItem?.ok) {
                          successCount++;
                          setKh2959ImportedCodes((prev) => {
                            const next = new Set(prev);
                            next.add(p.ma_thua);
                            try {
                              localStorage.setItem('kh2959_imported_parcels', JSON.stringify(Array.from(next)));
                            } catch {}
                            return next;
                          });
                        } else {
                          failCount++;
                        }
                      } catch {
                        failCount++;
                      }
                      await new Promise((resolve) => setTimeout(resolve, 250));
                    }

                    setIsSubmittingWeb(false);
                    setSubmittingRowCode(null);
                    setInlineSaveToast(`✓ Hoàn tất: Đã nhập ${successCount} thửa thành công, ${failCount} lỗi.`);
                    setTimeout(() => setInlineSaveToast(null), 5000);
                  };

                  const isAnyFilterActive =
                    Boolean(reportSearchQuery) ||
                    reportVillageFilter !== 'ALL' ||
                    reportStatusFilter !== 'ALL' ||
                    chuaThucHienNameFilter !== 'ALL' ||
                    (isChuaThucHienSheet && appliedMaThuas.size > 0) ||
                    sortNameOrder !== 'asc';

                  return (
                    <div className="space-y-4">
                      {/* Toast báo lưu realtime thành công */}
                      {inlineSaveToast && (
                        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
                          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>{inlineSaveToast}</span>
                        </div>
                      )}

                      {/* THẺ CÔNG CỤ BỘ LỌC & TÁC VỤ (CỐ ĐỊNH STICKY DƯỚI HEADER KHI CUỘN) */}
                      <div className={`sticky top-[48px] sm:top-[52px] z-30 p-2 sm:p-2.5 rounded-xl border shadow-md backdrop-blur-md transition-all duration-200 ${
                        isLight
                          ? 'bg-white/95 border-slate-200/90 shadow-slate-200/50'
                          : 'bg-slate-900/95 border-slate-800 shadow-black/50'
                      }`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Nút Xuất EXCEL-MAUNHAP_57COT cho mục Nhập dữ liệu */}
                          {isNhapDuLieuSheet && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleExport57Cot(filtered, headers)}
                                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black shadow-md transition cursor-pointer bg-gradient-to-r from-emerald-600 via-teal-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white shadow-emerald-600/30 active:scale-95"
                                title="Xuất file EXCEL-MAUNHAP_57COT chuẩn 57 cột để nhập / đồng bộ trực tiếp vào Google Sheets"
                              >
                                <FileSpreadsheet className="w-3.5 h-3.5 text-white" />
                                <span>Xuất EXCEL-MAUNHAP_57COT ({filtered.length} thửa)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportExcelMauNhap(filtered, headers)}
                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                                  isLight
                                    ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                                }`}
                                title="Xuất file EXCEL-MAUNHAP chuẩn 9 cột (Mẫu đóng tập)"
                              >
                                <Download className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Mẫu Đóng Tập (9 cột)</span>
                              </button>
                            </div>
                          )}

                          {/* Nút Xuất DS Cần Thu CCCD cho mục Đang kê khai (Chưa có CCCD) */}
                          {isChuaCoCccdSheet && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setIsExportMissingCccdOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shadow-md transition cursor-pointer bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20"
                                title="Xuất ảnh danh sách cần thu thập CCCD (Tỷ lệ 16:9 dọc gửi Zalo)"
                              >
                                <Users className="w-3.5 h-3.5 text-white" />
                                <span>Xuất ảnh Zalo</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportStatisticsPdf({ onlyMissingCccd: true })}
                                disabled={isExportingStatsPdf}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shadow-md transition cursor-pointer bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-rose-600/30 disabled:opacity-50"
                                title="Xuất file PDF danh sách cần thu thập CCCD (Mỗi thôn buôn là 1 trang riêng biệt)"
                              >
                                <FileDown className="w-3.5 h-3.5 text-white" />
                                <span>{isExportingStatsPdf ? 'Đang tạo...' : 'Xuất PDF Thu CCCD (Theo thôn)'}</span>
                              </button>
                            </div>
                          )}
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


                          {/* NÚT KÊ KHAI NGAY TRÊN CHỖ BỘ LỌC (cho mục Chưa thực hiện) */}
                          {isChuaThucHienSheet && (
                            <div className="flex items-center gap-1.5 ml-1">
                              {readyCount === 0 ? (
                                <button
                                  type="button"
                                  disabled={true}
                                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-not-allowed border select-none ${
                                    isLight
                                      ? 'bg-slate-100 text-slate-400 border-slate-200'
                                      : 'bg-slate-800/60 text-slate-500 border-slate-700/60'
                                  }`}
                                  title="Chưa có thửa nào có đầy đủ thông tin (Họ tên + Năm sinh hoặc CCCD) để kê khai"
                                >
                                  <FileText className="w-3.5 h-3.5 opacity-40" />
                                  <span>Kê khai (0)</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isCommittingAllReady}
                                  onClick={handleCommitAllReadyDeclarations}
                                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black shadow-md transition cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/30 animate-pulse"
                                  title={`Bấm để lưu và chuyển ${readyCount} thửa đất đủ thông tin sang danh sách tương ứng`}
                                >
                                  {isCommittingAllReady ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                                  ) : (
                                    <FileText className="w-3.5 h-3.5 text-white" />
                                  )}
                                  <span>{isCommittingAllReady ? 'Đang kê khai...' : `Kê khai (${readyCount} thửa)`}</span>
                                </button>
                              )}
                            </div>
                          )}

                          {/* 2. BỘ LỌC CẦN TÌM CCCD VÀ KHÔNG CÓ CCCD (THỬA ĐANG KÊ KHAI - CHƯA CÓ CCCD) */}
                          {isChuaCoCccdSheet && (
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-bold ${isLight ? 'text-amber-800' : 'text-amber-400'}`}>
                                Lọc CCCD:
                              </span>
                              <select
                                value={reportStatusFilter}
                                onChange={(e) => {
                                  setReportStatusFilter(e.target.value as any);
                                  setReportPage(1);
                                }}
                                className={`text-xs px-2.5 py-1.5 rounded-xl border font-bold transition focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer ${
                                  reportStatusFilter === 'CẦN TÌM CCCD'
                                    ? isLight
                                      ? 'bg-amber-100 border-amber-500 text-amber-900 ring-1 ring-amber-400 font-black'
                                      : 'bg-amber-950/80 border-amber-500 text-amber-200 ring-1 ring-amber-500 font-black'
                                    : reportStatusFilter === 'KHÔNG CÓ CCCD'
                                    ? isLight
                                      ? 'bg-rose-100 border-rose-400 text-rose-900 ring-1 ring-rose-400 font-black'
                                      : 'bg-rose-950/80 border-rose-500 text-rose-200 ring-1 ring-rose-500 font-black'
                                    : isLight
                                    ? 'bg-white border-slate-300 text-slate-800'
                                    : 'bg-slate-900 border-slate-700 text-slate-200'
                                }`}
                              >
                                <option value="ALL">Tất cả ({allRows.length})</option>
                                <option value="CẦN TÌM CCCD">
                                  🔍 Cần Tìm CCCD ({statusCounts['CẦN TÌM CCCD'] || 0})
                                </option>
                                <option value="KHÔNG CÓ CCCD">
                                  ❓ Không Có CCCD ({statusCounts['KHÔNG CÓ CCCD'] || 0})
                                </option>
                                {statusCounts['ĐÃ CÓ CCCD (R2)'] > 0 && (
                                  <option value="ĐÃ CÓ CCCD (R2)">
                                    ⚡ Đã Có CCCD trên R2 ({statusCounts['ĐÃ CÓ CCCD (R2)']})
                                  </option>
                                )}
                              </select>
                            </div>
                          )}

                          {/* NÚT TỰ ĐỘNG ĐẾM & CHUYỂN CÁC THỬA CÓ FILE CCCD TRÊN R2 SANG KÊ KHAI CÓ CCCD (ĐÓNG TẬP) */}
                          {isChuaCoCccdSheet && (
                            <div className="flex items-center gap-1.5 ml-1">
                              {readyToMoveToPackRows.length > 0 ? (
                                <button
                                  type="button"
                                  disabled={isMovingParcelsToPack}
                                  onClick={handleMoveParcelsToReadyToPack}
                                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black shadow-md transition cursor-pointer bg-gradient-to-r from-emerald-600 via-teal-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white shadow-emerald-600/30 animate-pulse"
                                  title="Bấm để tự động chuyển các thửa đã có file CCCD trên R2 sang SẴN SÀNG ĐÓNG TẬP (CÓ CCCD)"
                                >
                                  {isMovingParcelsToPack ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                                  ) : (
                                    <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                                  )}
                                  <span>
                                    {isMovingParcelsToPack
                                      ? 'Đang chuyển...'
                                      : `⚡ Chuyển sang Có CCCD (${readyToMoveToPackRows.length} thửa có R2)`}
                                  </span>
                                </button>
                              ) : (
                                <div
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border select-none ${
                                    isLight
                                      ? 'bg-slate-100 text-slate-400 border-slate-200'
                                      : 'bg-slate-800/60 text-slate-500 border-slate-700/60'
                                  }`}
                                  title="Chưa có thửa nào trong danh sách này có file CCCD sẵn trên R2"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5 opacity-50" />
                                  <span>CCCD trên R2: 0</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* NÚT TỰ ĐỘNG NHẬP LÊN HỆ THỐNG WEB KH2959 (NHẬP DỮ LIỆU) */}
                          {isNhapDuLieuSheet && (
                            <div className="flex items-center gap-1.5 ml-1">
                              {validNonOntNhapDuLieuRows.length > 0 ? (
                                <button
                                  type="button"
                                  disabled={isSubmittingWeb}
                                  onClick={handleBatchImportToKh2959}
                                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black shadow-md transition cursor-pointer text-white ${
                                    isSubmittingWeb
                                      ? 'bg-cyan-700 opacity-80 cursor-wait'
                                      : 'bg-gradient-to-r from-cyan-600 via-teal-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 shadow-cyan-600/30 animate-pulse'
                                  }`}
                                  title="Bấm để tự động nộp hồ sơ các thửa hợp lệ (không chứa đất ONT) lên hệ thống web KH2959"
                                >
                                  {isSubmittingWeb ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                                  ) : (
                                    <UploadCloud className="w-3.5 h-3.5 text-white" />
                                  )}
                                  <span>
                                    {isSubmittingWeb
                                      ? `Đang nhập... (${batchProgress.current}/${batchProgress.total})`
                                      : `⚡ Nhập Web KH2959 (${validNonOntNhapDuLieuRows.length} thửa)`}
                                  </span>
                                </button>
                              ) : (
                                <div
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border select-none ${
                                    isLight
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                                  }`}
                                  title="Tất cả các thửa hợp lệ đã được nhập lên web KH2959"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>Đã nhập xong ({allRows.filter((r) => kh2959ImportedCodes.has(String(r[1] || '').trim())).length}/{allRows.length})</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* 3. LỌC THEO TRẠNG THÁI ĐÓNG TẬP (Sẵn sàng đóng tập - Có CCCD) */}
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

                          {/* 4. DẠNG HIỂN THỊ: THEO PHẦN (1/7, 2/7) HOẶC TOÀN BỘ */}
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
                              <option value={20}>20</option>
                              <option value={50}>50</option>
                              <option value="ALL">Tất cả</option>
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
                                setSortNameOrder('asc');
                                setReportPageSize('ALL');
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
                        <div className="relative w-full sm:w-60">
                          <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${
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
                            className={`w-full pl-8 pr-7 py-1 rounded-lg text-xs focus:outline-none focus:border-indigo-500 transition ${
                              isLight
                                ? 'bg-slate-50 border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-indigo-400'
                                : 'bg-slate-950 border border-slate-800 text-slate-200 placeholder:text-slate-500 focus:bg-slate-900 focus:ring-1 focus:ring-indigo-500'
                            }`}
                          />
                          {reportSearchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportSearchQuery('');
                                setReportPage(1);
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                      {/* Bảng dữ liệu chi tiết - HỖ TRỢ NHẬP & SỬA TRỰC TIẾP NHƯ EXCEL */}
                      <div className={`w-full overflow-x-auto border-y sm:border sm:rounded-xl shadow-xs ${isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'}`}>
                        <table
                          style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}
                          className={`text-xs text-left ${isLight ? 'text-slate-700' : 'text-slate-300'}`}
                        >
                          <thead className={`border-b font-bold ${
                            isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-950 text-slate-400 border-slate-800'
                          }`}>
                            <tr>
                              {isReadyToPackSheet && (
                                <th
                                  style={{ width: '40px', minWidth: '40px', maxWidth: '40px' }}
                                  className={`w-10 px-3 py-2.5 text-center border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}
                                >
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
                                const isVillageHeader = hIdx === villageColIdx && availableVillages.length > 0;
                                const isStatusHeader = isChuaCoCccdSheet && hIdx === statusColIdx;
                                const colW = getColWidth(hIdx, h);
                                return (
                                  <th
                                    key={hIdx}
                                    style={{ width: `${colW}px`, minWidth: `${colW}px`, maxWidth: `${colW}px` }}
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
                                    className={`py-2.5 px-2 relative border-r select-none overflow-visible ${
                                      isNameHeader ? 'cursor-pointer hover:bg-indigo-500/10' : ''
                                    } ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}
                                  >
                                    <div className="flex items-center gap-1.5 relative min-w-0 pr-1">
                                      
                                      <span className="truncate" title={h}>{h}</span>
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
                                              <div
                                                onMouseDown={handlePopupHeaderMouseDown}
                                                onTouchStart={handlePopupHeaderTouchStart}
                                                className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800 mb-2 cursor-grab active:cursor-grabbing select-none"
                                                title="Nhấn giữ và kéo để di chuyển bảng lọc"
                                              >
                                                <span className="text-xs font-bold flex items-center gap-1.5">
                                                  <Filter className="w-3.5 h-3.5 text-emerald-500" />
                                                  Lọc Mã Thửa (Excel)
                                                  <span className="text-[10px] text-slate-400 font-normal ml-1">⋮⋮ kéo di chuyển</span>
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
                                       {isVillageHeader && (
                                         <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
                                           <button
                                             type="button"
                                             onClick={(e) => {
                                               e.stopPropagation();
                                               const rect = e.currentTarget.getBoundingClientRect();
                                               setVillageFilterPopupPos({
                                                 top: rect.bottom + 6,
                                                 left: Math.max(10, Math.min(rect.left, window.innerWidth - 280)),
                                               });
                                               setVillageDropdownOpen((prev) => !prev);
                                             }}
                                             className={`p-1 rounded-md transition cursor-pointer flex items-center gap-0.5 ${
                                               reportVillageFilter !== 'ALL'
                                                 ? 'bg-blue-600 text-white shadow-xs'
                                                 : isLight
                                                 ? 'hover:bg-slate-200 text-slate-600'
                                                 : 'hover:bg-slate-700 text-slate-300'
                                             }`}
                                             title="Bấm để lọc theo Thôn / Buôn"
                                           >
                                             <Filter className="w-3 h-3" />
                                             <ChevronDown className="w-3 h-3" />
                                           </button>

                                           {/* Popover Lọc Thôn / Buôn */}
                                           {villageDropdownOpen && villageFilterPopupPos && (
                                             <>
                                               <div
                                                 className="fixed inset-0 z-[99998]"
                                                 onClick={(e) => {
                                                   e.stopPropagation();
                                                   setVillageDropdownOpen(false);
                                                 }}
                                               />
                                               <div
                                                 onClick={(e) => e.stopPropagation()}
                                                 style={{
                                                   position: 'fixed',
                                                   top: `${villageFilterPopupPos.top}px`,
                                                   left: `${villageFilterPopupPos.left}px`,
                                                   zIndex: 99999,
                                                 }}
                                                 className={`w-64 max-w-[90vw] p-2.5 rounded-2xl shadow-2xl border text-left font-normal ${
                                                   isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-900 border-slate-700 text-slate-100'
                                                 }`}
                                               >
                                                 <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800 mb-2 select-none">
                                                   <span className="text-xs font-bold flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                                                     <Filter className="w-3.5 h-3.5" />
                                                     Lọc Thôn / Buôn
                                                   </span>
                                                   <button
                                                     type="button"
                                                     onClick={() => setVillageDropdownOpen(false)}
                                                     className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                                   >
                                                     <X className="w-4 h-4" />
                                                   </button>
                                                 </div>

                                                 {availableVillages.length > 5 && (
                                                   <div className="relative mb-2">
                                                     <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                     <input
                                                       type="text"
                                                       placeholder="Tìm thôn/buôn..."
                                                       value={villageFilterSearch}
                                                       onChange={(e) => setVillageFilterSearch(e.target.value)}
                                                       className={`w-full pl-8 pr-2.5 py-1 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                                         isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-slate-950 border-slate-700 text-slate-200'
                                                       }`}
                                                     />
                                                   </div>
                                                 )}

                                                 <div className={`max-h-56 overflow-y-auto space-y-1 p-1 rounded-xl border text-xs ${
                                                   isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
                                                 }`}>
                                                   <button
                                                     type="button"
                                                     onClick={() => {
                                                       setReportVillageFilter('ALL');
                                                       setVillageDropdownOpen(false);
                                                       setReportPage(1);
                                                     }}
                                                     className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition cursor-pointer font-semibold ${
                                                       reportVillageFilter === 'ALL'
                                                         ? 'bg-blue-600 text-white font-bold'
                                                         : isLight
                                                         ? 'hover:bg-slate-200/70 text-slate-700'
                                                         : 'hover:bg-slate-800 text-slate-300'
                                                     }`}
                                                   >
                                                     <span>Tất cả Thôn / Buôn</span>
                                                     <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                                                       reportVillageFilter === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                                     }`}>
                                                       {allRows.length}
                                                     </span>
                                                   </button>

                                                   {availableVillages
                                                     .filter((v) => !villageFilterSearch || v.toLowerCase().includes(villageFilterSearch.toLowerCase()))
                                                     .map((v) => {
                                                       const isSelected = reportVillageFilter === v;
                                                       return (
                                                         <button
                                                           key={v}
                                                           type="button"
                                                           onClick={() => {
                                                             setReportVillageFilter(v);
                                                             setVillageDropdownOpen(false);
                                                             setReportPage(1);
                                                           }}
                                                           className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition cursor-pointer ${
                                                             isSelected
                                                               ? 'bg-blue-600 text-white font-bold'
                                                               : isLight
                                                               ? 'hover:bg-slate-200/70 text-slate-700'
                                                               : 'hover:bg-slate-800 text-slate-300'
                                                           }`}
                                                         >
                                                           <span className="truncate pr-2">{v}</span>
                                                           <span className={`text-[10px] px-1.5 py-0.5 rounded-md shrink-0 ${
                                                             isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                                           }`}>
                                                             {villageCounts[v] || 0}
                                                           </span>
                                                         </button>
                                                       );
                                                     })}
                                                 </div>

                                                 {reportVillageFilter !== 'ALL' && (
                                                   <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                                                     <button
                                                       type="button"
                                                       onClick={() => {
                                                         setReportVillageFilter('ALL');
                                                         setVillageDropdownOpen(false);
                                                         setReportPage(1);
                                                       }}
                                                       className="text-[11px] text-rose-500 hover:underline font-semibold cursor-pointer"
                                                     >
                                                       Xóa lọc (Hiển thị tất cả)
                                                     </button>
                                                   </div>
                                                 )}
                                               </div>
                                             </>
                                           )}
                                         </div>
                                       )}
                                       {isVillageHeader && reportVillageFilter !== 'ALL' && (
                                         <span className="text-[10px] px-1.5 py-0.2 bg-blue-600 text-white rounded font-bold truncate max-w-[80px]" title={`Đang lọc: ${reportVillageFilter}`}>
                                           {reportVillageFilter}
                                         </span>
                                       )}
                                       {isStatusHeader && (
                                         <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
                                           <button
                                             type="button"
                                             onClick={(e) => {
                                               e.stopPropagation();
                                               const rect = e.currentTarget.getBoundingClientRect();
                                               setStatusFilterPopupPos({
                                                 top: rect.bottom + 6,
                                                 left: Math.max(10, Math.min(rect.left, window.innerWidth - 260)),
                                               });
                                               setStatusDropdownOpen((prev) => !prev);
                                             }}
                                             className={`p-1 rounded-md transition cursor-pointer flex items-center gap-0.5 ${
                                               reportStatusFilter !== 'ALL'
                                                 ? 'bg-amber-600 text-white shadow-xs'
                                                 : isLight
                                                 ? 'hover:bg-slate-200 text-slate-600'
                                                 : 'hover:bg-slate-700 text-slate-300'
                                             }`}
                                             title="Bấm để lọc theo Phân loại trạng thái"
                                           >
                                             <Filter className="w-3 h-3" />
                                             <ChevronDown className="w-3 h-3" />
                                           </button>

                                           {/* Popover Lọc Trạng Thái */}
                                           {statusDropdownOpen && statusFilterPopupPos && (
                                             <>
                                               <div
                                                 className="fixed inset-0 z-[99998]"
                                                 onClick={(e) => {
                                                   e.stopPropagation();
                                                   setStatusDropdownOpen(false);
                                                 }}
                                               />
                                               <div
                                                 onClick={(e) => e.stopPropagation()}
                                                 style={{
                                                   position: 'fixed',
                                                   top: `${statusFilterPopupPos.top}px`,
                                                   left: `${statusFilterPopupPos.left}px`,
                                                   zIndex: 99999,
                                                 }}
                                                 className={`w-64 max-w-[90vw] p-2.5 rounded-2xl shadow-2xl border text-left font-normal ${
                                                   isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-900 border-slate-700 text-slate-100'
                                                 }`}
                                               >
                                                 <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800 mb-2 select-none">
                                                   <span className="text-xs font-bold flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                                     <Filter className="w-3.5 h-3.5" />
                                                     Lọc Phân Loại Trạng Thái
                                                   </span>
                                                   <button
                                                     type="button"
                                                     onClick={() => setStatusDropdownOpen(false)}
                                                     className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                                   >
                                                     <X className="w-4 h-4" />
                                                   </button>
                                                 </div>

                                                 <div className={`space-y-1 p-1 rounded-xl border text-xs ${
                                                   isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
                                                 }`}>
                                                   <button
                                                     type="button"
                                                     onClick={() => {
                                                       setReportStatusFilter('ALL');
                                                       setStatusDropdownOpen(false);
                                                       setReportPage(1);
                                                     }}
                                                     className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition cursor-pointer font-semibold ${
                                                       reportStatusFilter === 'ALL'
                                                         ? 'bg-amber-600 text-white font-bold'
                                                         : isLight
                                                         ? 'hover:bg-slate-200/70 text-slate-700'
                                                         : 'hover:bg-slate-800 text-slate-300'
                                                     }`}
                                                   >
                                                     <span>Tất cả phân loại</span>
                                                     <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                                                       reportStatusFilter === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                                     }`}>
                                                       {allRows.length}
                                                     </span>
                                                   </button>

                                                   {['ĐÃ CÓ CCCD (R2)', 'CẦN TÌM CCCD', 'KHÔNG CÓ CCCD'].map((stKey) => {
                                                     const isSelected = reportStatusFilter === stKey;
                                                     const count = statusCounts[stKey] || 0;
                                                     return (
                                                       <button
                                                         key={stKey}
                                                         type="button"
                                                         onClick={() => {
                                                           setReportStatusFilter(stKey);
                                                           setStatusDropdownOpen(false);
                                                           setReportPage(1);
                                                         }}
                                                         className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition cursor-pointer ${
                                                           isSelected
                                                             ? 'bg-amber-600 text-white font-bold'
                                                             : isLight
                                                             ? 'hover:bg-slate-200/70 text-slate-700'
                                                             : 'hover:bg-slate-800 text-slate-300'
                                                         }`}
                                                       >
                                                         <span className="truncate pr-2">{stKey}</span>
                                                         <span className={`text-[10px] px-1.5 py-0.5 rounded-md shrink-0 ${
                                                           isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                                         }`}>
                                                           {count}
                                                         </span>
                                                       </button>
                                                     );
                                                   })}
                                                 </div>

                                                 {reportStatusFilter !== 'ALL' && (
                                                   <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                                                     <button
                                                       type="button"
                                                       onClick={() => {
                                                         setReportStatusFilter('ALL');
                                                         setStatusDropdownOpen(false);
                                                         setReportPage(1);
                                                       }}
                                                       className="text-[11px] text-rose-500 hover:underline font-semibold cursor-pointer"
                                                     >
                                                       Xóa lọc (Hiển thị tất cả)
                                                     </button>
                                                   </div>
                                                 )}
                                               </div>
                                             </>
                                           )}
                                         </div>
                                       )}
                                       {isStatusHeader && reportStatusFilter !== 'ALL' && (
                                         <span className="text-[10px] px-1.5 py-0.2 bg-amber-600 text-white rounded font-bold truncate max-w-[90px]" title={`Đang lọc: ${reportStatusFilter}`}>
                                           {reportStatusFilter}
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
                                    {/* Vùng kéo thu nhỏ / mở rộng & nhấn đúp tự căn chiều rộng */}
                                    <div
                                      onMouseDown={(e) => handleResizeStart(hIdx, h, e)}
                                      onTouchStart={(e) => handleResizeTouchStart(hIdx, h, e)}
                                      onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        handleAutoFit(hIdx, h, pagedRows.length > 0 ? pagedRows : allRows);
                                      }}
                                      className="absolute right-0 top-0 bottom-0 w-3 translate-x-1.5 cursor-col-resize z-20 group hover:bg-indigo-500/20 flex items-center justify-center select-none"
                                      title="Kéo để thu nhỏ/mở rộng cột, nhấn đúp vào giữa để tự căn vừa nội dung"
                                    >
                                      <div className="w-[1.5px] h-full bg-slate-300 dark:bg-slate-700/80 group-hover:bg-indigo-500 group-hover:w-[2.5px] transition-all" />
                                    </div>
                                  </th>
                                );
                              })}

                            </tr>
                          </thead>
                          <tbody className={`divide-y ${isLight ? 'divide-slate-200' : 'divide-slate-800/60'}`}>
                            {pagedRows.length === 0 ? (
                              <tr>
                                <td colSpan={Math.max(headers.length + (isReadyToPackSheet ? 1 : 0), 1)} className="py-8 text-center text-slate-500">
                                  {filtered.length === 0
                                    ? 'Không tìm thấy kết quả phù hợp với các bộ lọc đã chọn.'
                                    : 'Chưa có hồ sơ trong danh sách này.'}
                                </td>
                              </tr>
                            ) : (
                              pagedRows.map((row, rIdx) => {
                                const maThua = String(row[1] || '').trim();
                                const isChecked = readyToPackSelectedCodes.has(maThua);
                                const isReadyToDeclare = isChuaThucHienSheet && checkIsRowReadyToDeclare(maThua, row);
                                const isCanTimCccd = isChuaCoCccdSheet && getChuaCoCccdRowStatus(maThua, row) === 'CẦN TÌM CCCD';
                                const isSaving = savingRowCodes.has(maThua);
                                const hasEdited = Boolean(cellEdits[maThua]);
                                const isImportedWeb = kh2959ImportedCodes.has(maThua);
                                const landTypeIdx = headers.findIndex((h) => /loại đất|mục đích/i.test(h));
                                const rowLoaiDat = String(landTypeIdx !== -1 ? row[landTypeIdx] : '').trim();
                                const isOntRow = /ont/i.test(rowLoaiDat);

                                return (
                                  <tr
                                    key={rIdx}
                                    className={`transition ${
                                      isChecked
                                        ? isLight
                                          ? 'bg-indigo-50/70'
                                          : 'bg-indigo-950/30'
                                        : isImportedWeb
                                        ? isLight
                                          ? 'bg-emerald-100/95 hover:bg-emerald-200/90 text-emerald-950 border-emerald-400 font-medium shadow-2xs'
                                          : 'bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-100 border-emerald-700 font-medium shadow-2xs'
                                        : isCanTimCccd
                                        ? isLight
                                          ? 'bg-amber-100/70 hover:bg-amber-200/80 text-amber-950 border-amber-300'
                                          : 'bg-amber-950/40 hover:bg-amber-950/60 text-amber-100 border-amber-800/60'
                                        : isReadyToDeclare
                                        ? isLight
                                          ? 'bg-emerald-50/90 hover:bg-emerald-100/90 text-emerald-950 border-emerald-300'
                                          : 'bg-emerald-950/25 hover:bg-emerald-950/45 text-emerald-100 border-emerald-900/60'
                                        : isLight
                                        ? 'hover:bg-slate-50'
                                        : 'hover:bg-slate-800/40'
                                    }`}
                                  >
                                    {isReadyToPackSheet && (
                                      <td
                                        style={{ width: '40px', minWidth: '40px', maxWidth: '40px' }}
                                        className={`w-10 px-3 py-2 text-center border-r ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}
                                      >
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
                                      const colW = getColWidth(cIdx, headerName);

                                      // Cột Phân loại trạng thái (Làm nổi bật badge & realtime check)
                                      if (cIdx === statusColIdx && isChuaCoCccdSheet) {
                                        const cccdColIdx = headers.findIndex((h) => /cccd|cmnd|định danh/i.test(h));
                                        const cccdVal = cleanCccd(
                                          (cccdColIdx !== -1 && cellEdits[maThua]?.[cccdColIdx] !== undefined)
                                            ? cellEdits[maThua][cccdColIdx]
                                            : (declarationsMap[maThua]?.chu_dat_cccd || (cccdColIdx !== -1 ? row[cccdColIdx] : '') || '')
                                        );
                                        const hasR2 = Boolean(cccdVal && (r2CccdSet.has(cccdVal) || declarationsMap[maThua]?.cccd_url));
                                        const hasGgs = Boolean(cccdVal && ggsCccdSet.has(cccdVal));

                                        let dynamicStatus = cellStr;
                                        let statusType: 'r2' | 'cantim' | 'khongco' = 'khongco';

                                        if (hasR2) {
                                          dynamicStatus = 'ĐÃ CÓ CCCD (R2)';
                                          statusType = 'r2';
                                        } else if (hasGgs) {
                                          dynamicStatus = 'CẦN TÌM CCCD';
                                          statusType = 'cantim';
                                        } else {
                                          dynamicStatus = 'KHÔNG CÓ CCCD';
                                          statusType = 'khongco';
                                        }

                                        return (
                                          <td
                                            key={cIdx}
                                            style={{ width: `${colW}px`, minWidth: `${colW}px`, maxWidth: `${colW}px` }}
                                            className={`py-2 px-2 border-r overflow-hidden ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}
                                          >
                                            <div className="truncate">
                                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-[11px] border ${
                                                statusType === 'r2'
                                                  ? isLight
                                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                                    : 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                                                  : statusType === 'cantim'
                                                  ? isLight
                                                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                                                    : 'bg-amber-950/50 text-amber-300 border-amber-500/40'
                                                  : isLight
                                                  ? 'bg-rose-50 text-rose-800 border-rose-300'
                                                  : 'bg-rose-950/50 text-rose-300 border-rose-500/40'
                                              }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${
                                                  statusType === 'r2' ? 'bg-emerald-500' : statusType === 'cantim' ? 'bg-amber-500' : 'bg-rose-500'
                                                }`} />
                                                <span className="truncate">{dynamicStatus}</span>
                                              </span>
                                            </div>
                                          </td>
                                        );
                                      }

                                      // Hiển thị nút bấm Xem CCCD / Xem PDF kèm Card Hover nổi
                                      const linkMatch = cellStr.match(/HYPERLINK\(\s*["']?([^"';,]+)["']?\s*[;,]\s*["']?([^"')]+)["']?\s*\)/i);
                                      const isPdfCell = !linkMatch && (/\.pdf$/i.test(cellStr.trim().replace(/^="|"$/g, '')) || cellStr.includes('.r2.dev/'));

                                      // Nếu là cột tên file scan thuần túy (không phải link) thì chỉ hiển thị text tên file, không render nút
                                      if (hLower.includes('tên file scan')) {
                                        return (
                                          <td
                                            key={cIdx}
                                            style={{ width: `${colW}px`, minWidth: `${colW}px`, maxWidth: `${colW}px` }}
                                            className={`py-2 px-2.5 border-r overflow-hidden text-xs font-mono truncate ${
                                              isLight ? 'border-slate-200 text-slate-700' : 'border-slate-800/60 text-slate-300'
                                            }`}
                                            title={cellStr.replace(/^="|"$/g, '')}
                                          >
                                            {cellStr.replace(/^="|"$/g, '')}
                                          </td>
                                        );
                                      }

                                      if (linkMatch || isPdfCell) {
                                        const rawUrl = linkMatch ? linkMatch[1].trim() : cellStr.trim().replace(/^="|"$/g, '');
                                        const cleanUrl = rawUrl.startsWith('http') || rawUrl.startsWith('/api/')
                                          ? rawUrl
                                          : (rawUrl.includes('/') ? rawUrl : `cccd/${rawUrl}`);
                                        const href = getResolvedImageUrl(cleanUrl);
                                        const text = linkMatch ? linkMatch[2].trim() : (cleanUrl.split('/').pop() || 'Xem PDF');
                                        const ownerName = String(cellEdits[maThua]?.[nameColIdx] ?? row[nameColIdx] ?? '').trim();
                                        const cccdColIdx = headers.findIndex((h) => /cccd|cmnd|định danh/i.test(h));
                                        const cccdVal = String((cccdColIdx !== -1 ? row[cccdColIdx] : row[6]) || '').replace(/^="|"$/g, '').trim();
                                        const isScan = href.includes('filescan') || hLower.includes('scan') || isNhapDuLieuSheet;

                                        return (
                                          <td
                                            key={cIdx}
                                            style={{ width: `${colW}px`, minWidth: `${colW}px`, maxWidth: `${colW}px` }}
                                            className={`py-2 px-2 border-r overflow-hidden ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}
                                          >
                                            <div className="flex items-center gap-1.5 truncate">
                                              <CccdHoverPreviewCard
                                                fileUrl={href}
                                                filename={text}
                                                ownerName={ownerName || undefined}
                                                cccdNumber={cccdVal || undefined}
                                                theme={theme}
                                                onOpenFullModal={() => {
                                                  setPreviewPdfModal({
                                                    isOpen: true,
                                                    url: href,
                                                    title: isScan ? `Hồ sơ scan: ${ownerName || text}` : `CCCD: ${ownerName || text}`,
                                                    filename: text,
                                                  });
                                                }}
                                              >
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.preventDefault();
                                                    setPreviewPdfModal({
                                                      isOpen: true,
                                                      url: href,
                                                      title: isScan ? `Hồ sơ scan: ${ownerName || text}` : `CCCD: ${ownerName || text}`,
                                                      filename: text,
                                                    });
                                                  }}
                                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition shadow-xs cursor-pointer ${
                                                    isLight
                                                      ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                                                      : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                                                  }`}
                                                  title={isScan ? 'Xem trực tiếp file scan trên giao diện' : 'Xem trực tiếp file CCCD trên giao diện'}
                                                >
                                                  <Eye className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                                  <span className="truncate">{isScan ? 'Xem scan' : 'Xem CCCD'}</span>
                                                </button>
                                              </CccdHoverPreviewCard>

                                              {isScan && (
                                                <a
                                                  href={href}
                                                  download={text.endsWith('.pdf') ? text : `${text}.pdf`}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition shadow-xs cursor-pointer shrink-0 ${
                                                    isLight
                                                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                                                      : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                                  }`}
                                                  title={`Tải file scan ${text} về máy tính`}
                                                >
                                                  <Download className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                                  <span>Tải về</span>
                                                </a>
                                              )}
                                            </div>
                                          </td>
                                        );
                                      }

                                      // Kiểm tra xem cột này có cho phép sửa trực tiếp như Excel không
                                      const isNameCol = hLower.includes('họ và tên') || hLower.includes('chủ đất');
                                      const isDobCol = hLower.includes('năm sinh') || hLower.includes('ngày sinh');
                                      const isGenderCol = hLower.includes('giới tính');
                                      const isCccdCol = hLower.includes('cccd') && !hLower.includes('xem') && !hLower.includes('file');
                                      const isVillageCol = hLower.includes('thôn') || hLower.includes('buôn');
                                      const isAreaCol = hLower.includes('diện tích');
                                      const isLandTypeCol = hLower.includes('loại đất');
                                      const isOriginCol = hLower.includes('nguồn gốc');
                                      const isNoteCol = hLower.includes('ghi chú') || hLower.includes('hướng dẫn');

                                      // Hiển thị chuỗi định dạng Excel (="...") và ưu tiên dữ liệu mới nhất từ declarationsMap
                                      const cleanText = cellStr.replace(/^="|"$/g, '');
                                      const declForParcel = declarationsMap[maThua];
                                      let effectiveVal = cleanText;
                                      if (declForParcel && selectedReportSheet !== 'CHƯA THỰC HIỆN') {
                                        if (isNameCol && (declForParcel.chu_dat_ten || declForParcel.chu_ho)) {
                                          effectiveVal = cleanName(declForParcel.chu_dat_ten || declForParcel.chu_ho);
                                        } else if (isDobCol && declForParcel.chu_dat_nam_sinh) {
                                          effectiveVal = declForParcel.chu_dat_nam_sinh;
                                        } else if (isGenderCol && declForParcel.chu_dat_gioi_tinh) {
                                          effectiveVal = declForParcel.chu_dat_gioi_tinh;
                                        } else if (isCccdCol && (declForParcel.chu_dat_cccd || declForParcel.cccd)) {
                                          effectiveVal = cleanCccd(declForParcel.chu_dat_cccd || declForParcel.cccd);
                                        } else if (isVillageCol && (declForParcel.dia_chi_thua_dat || declForParcel.chu_dat_dia_chi)) {
                                          effectiveVal = declForParcel.dia_chi_thua_dat || declForParcel.chu_dat_dia_chi;
                                        } else if (isOriginCol && (declForParcel.nguon_goc || declForParcel.nguon_goc_su_dung)) {
                                          effectiveVal = normalizeNguonGoc(declForParcel.nguon_goc || declForParcel.nguon_goc_su_dung);
                                        } else if (isAreaCol && (!cleanText || cleanText === '0' || cleanText === '1000') && declForParcel.dien_tich && declForParcel.ma_thua === maThua) {
                                          effectiveVal = declForParcel.dien_tich;
                                        } else if (isLandTypeCol && declForParcel.loai_dat) {
                                          effectiveVal = declForParcel.loai_dat;
                                        }
                                      }
                                      const displayVal = cellEdits[maThua]?.[cIdx] !== undefined ? cellEdits[maThua][cIdx] : effectiveVal;

                                      // 1. Ô Nguồn gốc sử dụng đất (Dropdown Khai hoang / Thừa kế / Tặng cho trực tiếp)
                                      if (isOriginCol) {
                                        return (
                                          <td
                                            key={cIdx}
                                            style={{ width: `${colW}px`, minWidth: `${colW}px`, maxWidth: `${colW}px` }}
                                            className={`py-1 px-1.5 border-r overflow-hidden ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}
                                          >
                                            <select
                                              value={normalizeNguonGoc(displayVal || '')}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                handleInlineCellChange(maThua, cIdx, v);
                                                handleInlineCellCommit(maThua, cIdx, headerName, v, row, headers);
                                              }}
                                              className={`w-full min-w-0 px-1.5 py-1 rounded-lg border text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 transition cursor-pointer truncate ${
                                                isLight
                                                  ? 'bg-white hover:bg-slate-50 border-slate-300 text-slate-800'
                                                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                              }`}
                                            >
                                              {NGUON_GOC_OPTIONS.map((opt) => (
                                                <option key={opt} value={opt}>
                                                  {opt}
                                                </option>
                                              ))}
                                            </select>
                                          </td>
                                        );
                                      }

                                      // Cột Ghi chú & Hướng dẫn xử lý cho mục Đang kê khai (Chưa có CCCD) - Hiển thị realtime tô màu xanh lá nếu có file R2
                                      if (isChuaCoCccdSheet && (isNoteCol || cIdx === headers.length - 1)) {
                                        const cccdVal = cleanCccd(
                                          cellEdits[maThua]?.[8] !== undefined
                                            ? cellEdits[maThua][8]
                                            : (declarationsMap[maThua]?.chu_dat_cccd || row[8] || '')
                                        );
                                        const hasR2 = Boolean(cccdVal && (r2CccdSet.has(cccdVal) || declarationsMap[maThua]?.cccd_url));
                                        const hasGgs = Boolean(cccdVal && ggsCccdSet.has(cccdVal));

                                        let dynamicNote = '';
                                        let noteStyle = '';

                                        if (hasR2) {
                                          dynamicNote = '✓ Đã có hình ảnh / file PDF CCCD trên R2 - Sẵn sàng chuyển sang Đóng tập';
                                          noteStyle = isLight ? 'text-emerald-700 bg-emerald-50/70 font-bold' : 'text-emerald-400 bg-emerald-950/30 font-bold';
                                        } else if (hasGgs) {
                                          dynamicNote = 'Đã có thông tin CCCD trên GGS chính - Cần tìm file scan/ảnh CCCD tải lên R2';
                                          noteStyle = isLight ? 'text-amber-800 bg-amber-50/40 font-semibold' : 'text-amber-300 bg-amber-950/20 font-semibold';
                                        } else {
                                          dynamicNote = 'Chưa có CCCD trên GGS chính lẫn R2 - Cần liên hệ chủ hộ thu thập CCCD mới';
                                          noteStyle = isLight ? 'text-rose-700' : 'text-rose-400';
                                        }

                                        return (
                                          <td
                                            key={cIdx}
                                            style={{ width: `${colW}px`, minWidth: `${colW}px`, maxWidth: `${colW}px` }}
                                            className={`py-2 px-2.5 border-r overflow-hidden text-xs ${
                                              isLight ? 'border-slate-200' : 'border-slate-800/60'
                                            } ${noteStyle}`}
                                            title={dynamicNote}
                                          >
                                            <div className="flex items-center gap-1.5 truncate">
                                              {hasR2 && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                                              <span className="truncate">{dynamicNote}</span>
                                            </div>
                                          </td>
                                        );
                                      }

                                      // 2. Các ô nhập chữ trực tiếp như Excel (Họ tên, Năm sinh, Giới tính, Số CCCD, Diện tích, Loại đất)
                                      // Cột Diện tích & Loại đất cố định theo bản đồ địa chính, KHÔNG cho phép sửa trên bảng
                                      if (isNameCol || isDobCol || isGenderCol || isCccdCol || isVillageCol) {
                                        // Chỉ kiểm tra validate ở THỬA ĐANG KÊ KHAI (CHƯA CÓ CCCD) và SẲN SÀNG ĐÓNG TẬP
                                        // Bảng Chưa thực hiện thì không cần check valid
                                        const shouldValidate = isReadyToPackSheet || isChuaCoCccdSheet;
                                        let isInvalid = false;
                                        let invalidMsg = '';

                                        if (shouldValidate) {
                                          if (isNameCol) {
                                            if (!displayVal || !isValidFullName(displayVal) || /chưa có|không có/i.test(displayVal)) {
                                              isInvalid = true;
                                              invalidMsg = 'Họ tên phải có ít nhất 2 từ và không chứa danh xưng (Ông, Bà, Hộ...)';
                                            }
                                          } else if (isDobCol) {
                                            if (!displayVal || !isValidBirthYear(displayVal)) {
                                              isInvalid = true;
                                              invalidMsg = 'Năm sinh phải là 4 chữ số hợp lệ (ví dụ: 1985)';
                                            }
                                          } else if (isCccdCol) {
                                            if (isReadyToPackSheet) {
                                              if (!displayVal || !isValidCccd(displayVal)) {
                                                isInvalid = true;
                                                invalidMsg = 'Số CCCD phải gồm đúng 12 chữ số';
                                              }
                                            } else if (isChuaCoCccdSheet && displayVal) {
                                              if (!isValidCccd(displayVal)) {
                                                isInvalid = true;
                                                invalidMsg = 'Số CCCD phải gồm đúng 12 chữ số';
                                              }
                                            }
                                          } else if (isGenderCol && displayVal) {
                                            if (!['nam', 'nữ', 'nu'].includes(displayVal.trim().toLowerCase())) {
                                              isInvalid = true;
                                              invalidMsg = 'Giới tính phải là Nam hoặc Nữ';
                                            }
                                          }
                                        }

                                        return (
                                          <td
                                            key={cIdx}
                                            style={{ width: `${colW}px`, minWidth: `${colW}px`, maxWidth: `${colW}px` }}
                                            className={`p-1 border-r overflow-hidden ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}
                                          >
                                            <input
                                              type="text"
                                              value={displayVal}
                                              title={invalidMsg || undefined}
                                              onChange={(e) => handleInlineCellChange(maThua, cIdx, e.target.value)}
                                              onBlur={(e) => {
                                                let val = e.target.value;
                                                if (isNameCol) val = cleanName(val);
                                                else if (isCccdCol) val = cleanCccd(val);
                                                handleInlineCellCommit(maThua, cIdx, headerName, val, row, headers);
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  (e.target as HTMLInputElement).blur();
                                                }
                                              }}
                                              placeholder={
                                                isGenderCol
                                                  ? 'Nam / Nữ...'
                                                  : isCccdCol
                                                  ? '12 số CCCD...'
                                                  : isVillageCol
                                                  ? 'Thôn / Buôn...'
                                                  : isNameCol
                                                  ? 'Nhập họ tên...'
                                                  : isDobCol
                                                  ? 'YYYY...'
                                                  : 'Nhập...'
                                              }
                                              className={`w-full min-w-0 px-2 py-1 text-xs rounded border transition truncate font-medium ${
                                                isInvalid
                                                  ? isLight
                                                    ? 'border-rose-500 ring-1 ring-rose-500 bg-white text-slate-800 focus:border-rose-600 focus:ring-rose-600'
                                                    : 'border-rose-500 ring-1 ring-rose-500 bg-slate-900 text-slate-100 focus:border-rose-400 focus:ring-rose-400'
                                                  : isLight
                                                  ? 'border-transparent hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800 hover:bg-slate-100/50'
                                                  : 'border-transparent hover:border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:bg-slate-800 text-slate-100 hover:bg-slate-800/40'
                                              } ${isNameCol ? 'font-bold' : ''}`}
                                            />
                                          </td>
                                        );
                                      }

                                      // 3. Cột Mã thửa
                                      if (cIdx === 1) {
                                        return (
                                          <td
                                            key={cIdx}
                                            style={{ width: `${colW}px`, minWidth: `${colW}px`, maxWidth: `${colW}px` }}
                                            className={`py-2 px-2 border-r overflow-hidden ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}
                                          >
                                            <div className="flex items-center gap-1.5 truncate">
                                              <button
                                                type="button"
                                                onClick={() => handleEditRowParcel(maThua, row)}
                                                className={`font-semibold hover:underline flex items-center gap-1 text-left cursor-pointer truncate ${
                                                  isChuaThucHienSheet
                                                    ? 'text-emerald-700 dark:text-emerald-400'
                                                    : isReadyToPackSheet
                                                    ? 'text-indigo-700 dark:text-indigo-400'
                                                    : 'text-blue-700 dark:text-blue-400'
                                                }`}
                                                title="Bấm để xem chi tiết / chỉnh sửa hồ sơ"
                                              >
                                                <span className="truncate">{cleanText}</span>
                                                <Pencil className="w-2.5 h-2.5 opacity-60 hover:opacity-100 shrink-0" />
                                              </button>
                                              {isReadyToDeclare && (
                                                <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-black bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                                                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                                                  <span>Đủ TT</span>
                                                </span>
                                              )}
                                              {isReadyToPackSheet && (
                                                packagedParcelCodes.has(maThua) ? (
                                                  <button
                                                    type="button"
                                                    onClick={() => toggleParcelPackagedStatus(maThua)}
                                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer shrink-0"
                                                    title="Đã đóng tập PDF. Bấm để chuyển lại Chưa đóng nếu muốn in lại."
                                                  >
                                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                                    <span>Đã đóng</span>
                                                  </button>
                                                ) : (
                                                  <span
                                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse shrink-0"
                                                    title="Hồ sơ mới chưa đóng tập PDF"
                                                  >
                                                    <Sparkles className="w-2.5 h-2.5" />
                                                    <span>Chưa đóng</span>
                                                  </span>
                                                )
                                              )}
                                            </div>
                                          </td>
                                        );
                                      }

                                      return (
                                        <td
                                          key={cIdx}
                                          style={{ width: `${colW}px`, minWidth: `${colW}px`, maxWidth: `${colW}px` }}
                                          className={`py-2 px-2.5 border-r overflow-hidden ${isLight ? 'border-slate-200' : 'border-slate-800/60'}`}
                                        >
                                           <div
                                             className={`truncate ${
                                               isAreaCol
                                                 ? 'text-right font-mono font-medium text-slate-800 dark:text-slate-200'
                                                 : isLandTypeCol
                                                 ? 'text-center font-bold text-amber-700 dark:text-amber-400'
                                                 : ''
                                             }`}
                                             title={cleanText}
                                           >
                                            {cleanText}
                                          </div>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Phân trang & Điều hướng theo phần (1/7, 2/7) hoặc Toàn bộ - TREO CỐ ĐỊNH Ở FOOTER */}
                      <div className={`sticky bottom-0 z-30 w-full py-2.5 px-3 sm:px-6 rounded-t-xl sm:rounded-t-2xl border-t shadow-2xl backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs transition-all duration-200 ${
                        isLight
                          ? 'bg-white/95 border-slate-200/90 shadow-slate-400/30 text-slate-700'
                          : 'bg-slate-900/95 border-slate-800 shadow-black/80 text-slate-300'
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
      {isEditModalOpen && editingParcel && (
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
      )}

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
          fetchR2CccdList();
          setCccdTabRefreshKey((k) => k + 1);
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
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`p-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                    isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                  title="Mở file trong tab mới"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Mở tab mới</span>
                </a>
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
            <div className="flex-1 w-full bg-slate-950 relative overflow-hidden">
              <PdfViewer
                url={previewPdfModal.url}
                title={previewPdfModal.title}
                compact={false}
                theme={theme}
                showActions={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal Xuất Danh Sách Cần Thu Thập CCCD Dạng Ảnh 16:9 Dọc */}
      <ExportMissingCccdModal
        isOpen={isExportMissingCccdOpen}
        onClose={() => setIsExportMissingCccdOpen(false)}
        parcels={parcels}
        declarationsMap={declarationsMap}
        theme={theme}
      />

      {/* Modal Nhập/Đổi Tên Cán Bộ Kê Khai */}
      <CadreNameModal
        isOpen={isCadreModalOpen}
        onClose={() => {
          setIsCadreModalOpen(false);
          setIsFirstTimeCadre(false);
        }}
        onSaved={(newName) => {
          setCadreName(newName);
          setIsFirstTimeCadre(false);
        }}
        isFirstTime={isFirstTimeCadre}
        theme={theme}
      />
    </div>
  );
}
