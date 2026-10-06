'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import rawParcels from '@/data/parcels.json';
import { Parcel, ParcelStatus, DeclarationFormData } from '@/types';
import { removeVietnameseTones } from '@/utils/geo';
import { getStoredDeclarations, saveOrUpdateDeclaration, removeDeclaration } from '@/utils/declaration';
import DeclarationPrintModal, { PrintableDeclarationItem } from '@/components/DeclarationPrintModal';
import DashboardParcelModal from '@/components/DashboardParcelModal';
import DeclarationEditModal from '@/components/DeclarationEditModal';
import VectorViewerModal from '@/components/VectorViewerModal';
import {
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

  // Active view tab in Dashboard
  const [activeTab, setActiveTab] = useState<'overview' | 'villages' | 'landTypes' | 'table'>('table');

  // Checkbox Selection state for Batch PDF Export
  const [selectedParcelCodes, setSelectedParcelCodes] = useState<Set<string>>(new Set());

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
          const cloudMap = data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {};
          const sig = JSON.stringify({ codes: data.declaredCodes, map: cloudMap });
          if (sig === lastCloudSigRef.current) return;
          lastCloudSigRef.current = sig;

          setDeclaredParcelCodes(new Set<string>(data.declaredCodes));
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

    // Tự động đồng bộ mỗi 3 giây (tương tự WebSocket, không cần F5)
    const interval = setInterval(fetchCloudDeclarations, 3000);
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

  const handleSaveEditedDeclaration = (data: DeclarationFormData) => {
    const { updatedCodes, updatedMap } = saveOrUpdateDeclaration(data);
    lastCloudSigRef.current = JSON.stringify({ codes: updatedCodes, map: updatedMap });
    setDeclaredParcelCodes(new Set(updatedCodes));
    setDeclarationsMap(updatedMap);
    setIsEditModalOpen(false);
    setEditingParcel(null);
    setEditingDeclaration(null);

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

  // 2. Đồng bộ Google Sheets Realtime
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

  // 3. Tính toán trạng thái thực tế của từng thửa
  const computedParcels = useMemo(() => {
    return parcels.map((p) => {
      let finalStatus: ParcelStatus = p.trang_thai;
      let isOnGgs = false;
      let isDeclared = false;

      if (ggsCodes.has(p.ma_thua)) {
        finalStatus = 'DA_SO_HOA_XANH';
        isOnGgs = true;
      } else if (declaredParcelCodes.has(p.ma_thua) || declarationsMap[p.ma_thua]) {
        finalStatus = 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
        isDeclared = true;
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
      const vName = p.thon_xa?.trim() || 'Chưa rõ địa chỉ thôn';
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 shadow-lg no-print">
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
                <h1 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                  Dashboard Địa Chính
                  <span className="text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    Xã Cư Pui
                  </span>
                </h1>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 hidden sm:block">
                Hệ thống giám sát tiến độ số hóa & quản trị cơ sở dữ liệu 5.943 thửa đất
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Nút Xuất Excel Đã Kê Khai */}
            <button
              onClick={handleExportDeclaredExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600/90 hover:bg-amber-600 text-white shadow-md shadow-amber-600/20 transition cursor-pointer"
              title="Tải về file Excel danh sách các thửa đã kê khai thu thập"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Xuất Excel Đã Kê Khai</span>
            </button>

            {/* Nút Xuất Excel Chuẩn Mẫu Đóng Tập EXCEL-MAUNHAP */}
            <button
              onClick={handleExportExcelMauNhap}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-teal-600/90 hover:bg-teal-600 text-white shadow-md shadow-teal-600/20 transition cursor-pointer"
              title="Xuất file theo cấu trúc 9 cột chuẩn của EXCEL-MAUNHAP.xlsx để nạp vào PDF_Web_App đóng tập"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Mẫu Nhập Đóng Tập</span>
            </button>

            {/* Nút Đóng tập PDF Hôm Nay */}
            <button
              onClick={handleOpenPrintToday}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-600/90 hover:bg-purple-600 text-white shadow-md shadow-purple-600/20 transition cursor-pointer"
              title="Đóng tập PDF các đơn kê khai được tạo trong ngày hôm nay cho việc in"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Đóng Tập PDF Hôm Nay</span>
            </button>


            {/* Nút Xuất Excel danh sách đang lọc */}
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600/90 hover:bg-emerald-600 text-white shadow-md shadow-emerald-700/20 transition cursor-pointer"
              title="Xuất dữ liệu Excel danh sách đang lọc"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Xuất Excel Lọc</span>
            </button>

            {/* Đồng bộ GGS */}
            <button
              onClick={() => fetchGgsCodes()}
              disabled={isSyncingGgs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 transition disabled:opacity-60 shadow-xs cursor-pointer"
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
          {/* Card 1: Tổng số thửa & Diện tích */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-slate-700 transition relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/10 rounded-full blur-2xl group-hover:bg-blue-600/20 transition" />
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-slate-400">Tổng Thửa Quản Lý</span>
              <Building2 className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {globalStats.total.toLocaleString('vi-VN')}
              <span className="text-xs font-normal text-slate-400 ml-1.5">thửa</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
              <span>Quy mô diện tích:</span>
              <strong className="text-blue-400 font-bold">{globalStats.totalAreaHa.toLocaleString('vi-VN')} ha</strong>
            </div>
          </div>

          {/* Card 2: Đã Số Hóa GGS (Xanh lá) */}
          <div
            onClick={() => {
              setStatusFilter('DA_SO_HOA_XANH');
              setActiveTab('table');
            }}
            className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 shadow-sm hover:border-emerald-500/50 transition relative overflow-hidden group cursor-pointer"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition" />
            <div className="flex items-center justify-between text-emerald-400 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Đã Số Hóa (GGS)
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-300 tracking-tight">
              {globalStats.green.toLocaleString('vi-VN')}
              <span className="text-xs font-normal text-slate-400 ml-1.5">thửa</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
              <span>Tỷ lệ hoàn thành:</span>
              <strong className="text-emerald-400 font-bold">{globalStats.completionRate}%</strong>
            </div>
          </div>

          {/* Card 3: Chưa kê khai - Có tên chủ (Vàng) */}
          <div
            onClick={() => {
              setStatusFilter('CO_TEN_CHUA_SO_HOA_VANG');
              setActiveTab('table');
            }}
            className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-4 shadow-sm hover:border-amber-500/50 transition relative overflow-hidden group cursor-pointer"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition" />
            <div className="flex items-center justify-between text-amber-400 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                Chưa Kê Khai - Có Tên
              </span>
              <Users className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-amber-300 tracking-tight">
              {globalStats.yellow.toLocaleString('vi-VN')}
              <span className="text-xs font-normal text-slate-400 ml-1.5">thửa</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
              <span>Chờ thu thập hồ sơ:</span>
              <strong className="text-amber-400 font-bold">
                {Math.round((globalStats.yellow / globalStats.total) * 1000) / 10}%
              </strong>
            </div>
          </div>

          {/* Card 4: Chưa kê khai - Không có tên (Trắng/Xám) */}
          <div
            onClick={() => {
              setStatusFilter('CHUA_CO_TEN_XAM');
              setActiveTab('table');
            }}
            className="bg-slate-900/90 border border-slate-700/60 rounded-2xl p-4 shadow-sm hover:border-slate-600 transition relative overflow-hidden group cursor-pointer"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-slate-500/10 rounded-full blur-2xl group-hover:bg-slate-500/20 transition" />
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                Chưa Kê Khai - Không Tên
              </span>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-200 tracking-tight">
              {globalStats.gray.toLocaleString('vi-VN')}
              <span className="text-xs font-normal text-slate-400 ml-1.5">thửa</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
              <span>Cần rà soát thực địa:</span>
              <strong className="text-slate-300 font-bold">
                {Math.round((globalStats.gray / globalStats.total) * 1000) / 10}%
              </strong>
            </div>
          </div>
        </section>

        {/* Tiêu điểm: Thanh đo tiến độ số hóa toàn diện */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-400" />
                Cơ Cấu Tiến Độ Số Hóa Bản Đồ Địa Chính Xã Cư Pui
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Đã số hóa {globalStats.green.toLocaleString('vi-VN')} / {globalStats.total.toLocaleString('vi-VN')} thửa ({globalStats.completionRate}%)
                • Quy mô {globalStats.digitizedAreaHa} ha / {globalStats.totalAreaHa} ha
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                Đã số hóa ({globalStats.completionRate}%)
              </div>
              <div className="flex items-center gap-1.5 text-blue-400">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                Đã kê khai ({globalStats.blue} thửa)
              </div>
              <div className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                Chưa kê khai - Có tên ({Math.round((globalStats.yellow / globalStats.total) * 1000) / 10}%)
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span>
                Không có tên ({Math.round((globalStats.gray / globalStats.total) * 1000) / 10}%)
              </div>
            </div>
          </div>

          {/* Thanh Tiến độ Segmented Progress Bar */}
          <div className="w-full h-4 bg-slate-950 rounded-full overflow-hidden flex p-0.5 border border-slate-800">
            <div
              style={{ width: `${(globalStats.green / globalStats.total) * 100}%` }}
              className="h-full bg-emerald-500 rounded-l-full transition-all duration-500 hover:brightness-110"
              title={`Đã số hóa: ${globalStats.green} thửa (${globalStats.completionRate}%)`}
            />
            {globalStats.blue > 0 && (
              <div
                style={{ width: `${(globalStats.blue / globalStats.total) * 100}%` }}
                className="h-full bg-blue-500 transition-all duration-500 hover:brightness-110"
                title={`Đã kê khai thực địa: ${globalStats.blue} thửa`}
              />
            )}
            <div
              style={{ width: `${(globalStats.yellow / globalStats.total) * 100}%` }}
              className="h-full bg-amber-500 transition-all duration-500 hover:brightness-110"
              title={`Chưa kê khai - Có tên: ${globalStats.yellow} thửa`}
            />
            <div
              style={{ width: `${(globalStats.gray / globalStats.total) * 100}%` }}
              className="h-full bg-slate-400 rounded-r-full transition-all duration-500 hover:brightness-110"
              title={`Chưa kê khai - Không có tên: ${globalStats.gray} thửa`}
            />
          </div>

          {/* Thông tin phụ trợ */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-xs text-slate-400">
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
              <span className="block text-[10px] text-slate-500">Định vị GPS chính xác:</span>
              <strong className="text-slate-200 text-sm">{globalStats.hasGpsCount.toLocaleString('vi-VN')} thửa</strong>{' '}
              <span className="text-[10px] text-emerald-400">(99.6%)</span>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
              <span className="block text-[10px] text-slate-500">Hồ sơ đã có CCCD:</span>
              <strong className="text-slate-200 text-sm">{globalStats.hasCccdCount.toLocaleString('vi-VN')} thửa</strong>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
              <span className="block text-[10px] text-slate-500">Hồ sơ có ảnh scan / upload:</span>
              <strong className="text-purple-300 text-sm">{globalStats.withImagesCount.toLocaleString('vi-VN')} hồ sơ</strong>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
              <span className="block text-[10px] text-slate-500">Chủ hộ độc nhất thu thập:</span>
              <strong className="text-slate-200 text-sm">{globalStats.uniqueOwnersCount.toLocaleString('vi-VN')} người</strong>
            </div>
          </div>
        </section>

        {/* Tab Navigation for Analytics */}
        <div className="flex border-b border-slate-800 gap-2 sm:gap-4 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('table')}
            className={`py-2.5 px-3 font-bold text-xs sm:text-sm border-b-2 transition flex items-center gap-2 shrink-0 ${
              activeTab === 'table'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Tra Cứu & Quản Lý Kê Khai ({filteredParcels.length.toLocaleString('vi-VN')})
          </button>

          <button
            onClick={() => setActiveTab('overview')}
            className={`py-2.5 px-3 font-bold text-xs sm:text-sm border-b-2 transition flex items-center gap-2 shrink-0 ${
              activeTab === 'overview'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Bảng Tổng Quan
          </button>

          <button
            onClick={() => setActiveTab('villages')}
            className={`py-2.5 px-3 font-bold text-xs sm:text-sm border-b-2 transition flex items-center gap-2 shrink-0 ${
              activeTab === 'villages'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            Tiến Độ Thôn / Buôn ({villageStats.length})
          </button>

          <button
            onClick={() => setActiveTab('landTypes')}
            className={`py-2.5 px-3 font-bold text-xs sm:text-sm border-b-2 transition flex items-center gap-2 shrink-0 ${
              activeTab === 'landTypes'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <PieChart className="w-4 h-4" />
            Cơ Cấu Loại Đất ({landTypeStats.length})
          </button>
        </div>

        {/* TAB 1: BẢNG DỮ LIỆU & QUẢN LÝ KÊ KHAI (MẶC ĐỊNH) */}
        {activeTab === 'table' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
            {/* 4 NÚT LỌC NHANH TRẠNG THÁI THEO ĐÚNG YÊU CẦU */}
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <span className="text-xs text-slate-400 font-semibold mr-1">Lọc nhanh:</span>
              <button
                onClick={() => {
                  setStatusFilter('ALL');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-400'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Tất cả ({globalStats.total})
              </button>

              <button
                onClick={() => {
                  setStatusFilter('DA_SO_HOA_XANH');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  statusFilter === 'DA_SO_HOA_XANH'
                    ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400'
                    : 'bg-slate-800 text-emerald-300 hover:bg-slate-700 border border-emerald-500/30'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                Đã số hóa ({globalStats.green})
              </button>

              <button
                onClick={() => {
                  setStatusFilter('DA_KE_KHAI_CHUA_SO_HOA_LAM');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  statusFilter === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
                    ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-400'
                    : 'bg-slate-800 text-blue-300 hover:bg-slate-700 border border-blue-500/30'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                Đã kê khai ({globalStats.blue})
              </button>

              <button
                onClick={() => {
                  setStatusFilter('CO_TEN_CHUA_SO_HOA_VANG');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  statusFilter === 'CO_TEN_CHUA_SO_HOA_VANG'
                    ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-400'
                    : 'bg-slate-800 text-amber-300 hover:bg-slate-700 border border-amber-500/30'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                Chưa kê khai - Có tên ({globalStats.yellow})
              </button>

              <button
                onClick={() => {
                  setStatusFilter('CHUA_CO_TEN_XAM');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  statusFilter === 'CHUA_CO_TEN_XAM'
                    ? 'bg-slate-700 text-white shadow-sm ring-2 ring-slate-400'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600/30'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                Chưa kê khai - Không có tên ({globalStats.gray})
              </button>
            </div>

            {/* Filter Toolbar */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
                {/* Search Input */}
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Tìm theo số thửa, tờ BĐ, tên chủ hộ, CCCD..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Reset button */}
                {(statusFilter !== 'ALL' ||
                  villageFilter !== 'ALL' ||
                  landTypeFilter !== 'ALL' ||
                  sheetFilter !== 'ALL' ||
                  searchQuery) && (
                  <button
                    onClick={() => {
                      setStatusFilter('ALL');
                      setVillageFilter('ALL');
                      setLandTypeFilter('ALL');
                      setSheetFilter('ALL');
                      setSearchQuery('');
                      setCurrentPage(1);
                    }}
                    className="px-3 py-2 text-xs font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-xl transition shrink-0 cursor-pointer"
                  >
                    Xóa tất cả bộ lọc
                  </button>
                )}
              </div>

              {/* Filter Dropdowns row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {/* Thôn / Buôn */}
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Thôn / Buôn:</label>
                  <select
                    value={villageFilter}
                    onChange={(e) => {
                      setVillageFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full p-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ALL">Tất cả thôn/buôn ({uniqueVillages.length})</option>
                    {uniqueVillages.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Loại đất */}
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Loại đất:</label>
                  <select
                    value={landTypeFilter}
                    onChange={(e) => {
                      setLandTypeFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full p-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ALL">Tất cả loại đất ({uniqueLandTypes.length})</option>
                    {uniqueLandTypes.map((lt) => (
                      <option key={lt} value={lt}>
                        {lt}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tờ bản đồ */}
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Tờ bản đồ:</label>
                  <select
                    value={sheetFilter}
                    onChange={(e) => {
                      setSheetFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full p-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ALL">Tất cả tờ BĐ ({uniqueSheets.length})</option>
                    {uniqueSheets.map((s) => (
                      <option key={s} value={s}>
                        Tờ {s}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Bộ lọc có ảnh hồ sơ */}
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Tài liệu ảnh:</label>
                  <div className="p-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 flex items-center justify-between">
                    <span>Hồ sơ có ảnh:</span>
                    <strong className="text-purple-300">{globalStats.withImagesCount}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Results count & Batch Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 pt-2 border-t border-slate-800">
              <div className="flex items-center gap-3">
                <div>
                  Tìm thấy <strong>{filteredParcels.length.toLocaleString('vi-VN')}</strong> thửa đất phù hợp
                </div>

                {/* Báo số thửa đang chọn & Nút Đóng tập PDF */}
                {selectedParcelCodes.size > 0 && (
                  <div className="flex items-center gap-2 bg-blue-950/80 text-blue-300 border border-blue-500/30 px-3 py-1 rounded-xl font-bold animate-in fade-in">
                    <span>Đang chọn {selectedParcelCodes.size} thửa</span>
                    <button
                      onClick={handleOpenPrintSelected}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] flex items-center gap-1 shadow-md cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Đóng Tập PDF ({selectedParcelCodes.size} đơn)
                    </button>
                    <button
                      onClick={() => setSelectedParcelCodes(new Set())}
                      className="text-slate-400 hover:text-white text-[10px] underline ml-1 cursor-pointer"
                    >
                      Bỏ chọn
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px]">Hiển thị:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
                >
                  <option value={25}>25 dòng</option>
                  <option value={50}>50 dòng</option>
                  <option value={100}>100 dòng</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider select-none">
                  <tr>
                    {/* Checkbox All */}
                    <th className="p-3 w-8 text-center">
                      <input
                        type="checkbox"
                        checked={isAllPageSelected}
                        onChange={toggleSelectAllPage}
                        className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        title="Chọn tất cả thửa trên trang này để đóng tập PDF"
                      />
                    </th>
                    <th
                      onClick={() => handleSort('so_thua')}
                      className="p-3 cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center gap-1">
                        <span>Số Thửa</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('to_ban_do')}
                      className="p-3 cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center gap-1">
                        <span>Tờ BĐ</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('chu_ho')}
                      className="p-3 cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center gap-1">
                        <span>Chủ Thửa Đất</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th className="p-3">CCCD</th>
                    <th className="p-3">Thôn / Buôn</th>
                    <th className="p-3">Loại Đất</th>
                    <th
                      onClick={() => handleSort('dien_tich')}
                      className="p-3 cursor-pointer hover:text-white transition text-right"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Diện Tích</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th className="p-3 text-center">Hồ Sơ Ảnh</th>
                    <th className="p-3 text-center">Trạng Thái</th>
                    <th className="p-3 text-center">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {paginatedParcels.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="p-8 text-center text-slate-500">
                        Không tìm thấy thửa đất nào phù hợp với bộ lọc hiện tại.
                      </td>
                    </tr>
                  ) : (
                    paginatedParcels.map((p) => {
                      const isGreen = p.trang_thai === 'DA_SO_HOA_XANH';
                      const isBlue = p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
                      const isYellow = p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG';
                      const isChecked = selectedParcelCodes.has(p.ma_thua);

                      const decl = declarationsMap[p.ma_thua];
                      const hasImg =
                        Boolean(p.cccd_url) ||
                        Boolean(p.svg_url) ||
                        (Array.isArray(p.gcn_urls) && p.gcn_urls.length > 0) ||
                        Boolean(decl?.anh_cccd_truoc) ||
                        Boolean(decl?.anh_cccd_sau) ||
                        Boolean(decl?.anh_gcn);

                      return (
                        <tr
                          key={p.ma_thua}
                          className={`hover:bg-slate-800/40 transition ${
                            isChecked ? 'bg-blue-950/20' : ''
                          }`}
                        >
                          {/* Checkbox row */}
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelectParcel(p.ma_thua)}
                              className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                          </td>

                          {/* Số thửa - Bấm để mở Modal xem chi tiết */}
                          <td className="p-3 font-mono font-bold text-white">
                            <button
                              onClick={() => handleOpenDetailModal(p)}
                              className="hover:text-blue-400 hover:underline transition font-bold text-left cursor-pointer"
                              title="Bấm để xem chi tiết thửa đất & hồ sơ kê khai"
                            >
                              Thửa {p.so_thua}
                            </button>
                          </td>

                          <td className="p-3 font-mono text-slate-300">Tờ {p.to_ban_do}</td>

                          {/* Chủ hộ */}
                          <td className="p-3">
                            <button
                              onClick={() => handleOpenDetailModal(p)}
                              className="text-left group cursor-pointer"
                            >
                              <strong className="text-white font-medium block group-hover:text-blue-300 transition">
                                {p.chu_ho || <span className="text-slate-500 italic">Chưa có tên</span>}
                              </strong>
                              {decl?.created_at && (
                                <span className="text-[10px] text-blue-400 flex items-center gap-1 mt-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  Đã kê khai {new Date(decl.created_at).toLocaleDateString('vi-VN')}
                                </span>
                              )}
                            </button>
                          </td>

                          <td className="p-3 font-mono text-[11px] text-slate-400">
                            {p.cccd ? (
                              <span className="text-slate-300">{p.cccd}</span>
                            ) : (
                              <span className="text-slate-600">---</span>
                            )}
                          </td>

                          <td className="p-3 text-slate-300 truncate max-w-[160px]">{p.thon_xa}</td>

                          <td className="p-3">
                            <span className="font-mono px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 text-[11px] border border-slate-700">
                              {p.loai_dat || '---'}
                            </span>
                          </td>

                          <td className="p-3 text-right font-mono font-semibold text-slate-200">
                            {p.dien_tich ? `${p.dien_tich} m²` : '---'}
                          </td>

                          {/* Cột Hồ sơ ảnh */}
                          <td className="p-3 text-center">
                            {hasImg ? (
                              <button
                                onClick={() => handleOpenDetailModal(p)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 transition cursor-pointer"
                                title="Bấm để xem ảnh CCCD / Giấy chứng nhận"
                              >
                                <ImageIcon className="w-3 h-3 text-purple-400" />
                                <span>Có ảnh</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-600">---</span>
                            )}
                          </td>

                          {/* Trạng thái */}
                          <td className="p-3 text-center">
                            {isGreen ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                Đã số hóa
                              </span>
                            ) : isBlue ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                                Đã kê khai
                              </span>
                            ) : isYellow ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                                Có tên
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700/40 text-slate-400 border border-slate-600/30">
                                Không có tên
                              </span>
                            )}
                          </td>

                          {/* Cột Thao Tác: Chi tiết, In đơn, Bản đồ */}
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Xem chi tiết */}
                              <button
                                onClick={() => handleOpenDetailModal(p)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-blue-300 border border-blue-500/30 transition cursor-pointer"
                                title="Xem chi tiết thửa đất và hồ sơ kê khai"
                              >
                                <Eye className="w-3 h-3 text-blue-400" />
                                <span>Chi tiết</span>
                              </button>

                              {/* Sửa và Xóa phiếu kê khai nếu thửa đã kê khai */}
                              {(isBlue || Boolean(decl)) && (
                                <>
                                  <button
                                    onClick={() => handleOpenEditDeclaration(p, decl)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 transition cursor-pointer"
                                    title="Sửa thông tin phiếu kê khai"
                                  >
                                    <Pencil className="w-3 h-3 text-amber-400" />
                                    <span>Sửa</span>
                                  </button>

                                  <button
                                    onClick={() => setDeletingParcel(p)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 transition cursor-pointer"
                                    title="Xóa phiếu kê khai (quay về trạng thái ban đầu)"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>Xóa</span>
                                  </button>
                                </>
                              )}

                              {/* In đơn */}
                              <button
                                onClick={() => handleOpenPrintSingle(p)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 transition cursor-pointer"
                                title="In hoặc xuất PDF Đơn kê khai thửa đất này"
                              >
                                <Printer className="w-3 h-3 text-purple-400" />
                                <span>In đơn</span>
                              </button>

                              {/* Bản đồ */}
                              <Link
                                href={`/?to=${p.to_ban_do}&thua=${p.so_thua}&ma_thua=${p.ma_thua}`}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-600/80 hover:bg-blue-600 text-white transition shadow-xs"
                                title="Xem thửa này trên bản đồ vệ tinh"
                              >
                                <MapPin className="w-3 h-3" />
                                <span>Bản đồ</span>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs pt-2">
              <div className="text-slate-400">
                Trang <strong>{currentPage}</strong> / <strong>{totalPages}</strong> (
                {filteredParcels.length.toLocaleString('vi-VN')} kết quả)
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage <= 1}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:hover:text-slate-300 cursor-pointer"
                >
                  Đầu
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
                >
                  Trước
                </button>

                <div className="px-3 py-1.5 rounded-lg bg-slate-800 text-white font-bold">
                  {currentPage}
                </div>

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
                >
                  Sau
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
                >
                  Cuối
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: BẢNG TỔNG QUAN & TOP THÔN */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-400" />
                    Tiến Độ Số Hóa Tại Các Thôn / Buôn Trọng Điểm
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Xếp hạng theo số lượng thửa đất cần quản lý</p>
                </div>
                <button
                  onClick={() => setActiveTab('villages')}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                >
                  Xem tất cả ({villageStats.length}) →
                </button>
              </div>

              <div className="space-y-3">
                {villageStats.slice(0, 7).map((v, i) => (
                  <div
                    key={v.name}
                    className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 hover:border-slate-700 transition"
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-slate-800 text-slate-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <strong className="text-slate-100 font-semibold truncate max-w-[200px] sm:max-w-none">
                          {v.name}
                        </strong>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400">
                          <strong className="text-emerald-400">{v.green}</strong>/{v.total} thửa
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold text-[11px]">
                          {v.rate}%
                        </span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden flex">
                      <div style={{ width: `${v.rate}%` }} className="bg-emerald-500 h-full rounded-l-full" />
                      <div
                        style={{ width: `${v.total > 0 ? (v.yellow / v.total) * 100 : 0}%` }}
                        className="bg-amber-500 h-full"
                      />
                      <div
                        style={{ width: `${v.total > 0 ? (v.gray / v.total) * 100 : 0}%` }}
                        className="bg-slate-700 h-full rounded-r-full"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                      <span>Diện tích: {v.totalAreaHa} ha</span>
                      <span>Chờ số hóa: {v.yellow + v.gray} thửa</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-amber-400" />
                    Cơ Cấu Loại Đất Chính
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Phân bổ mục đích sử dụng đất</p>
                </div>
                <button
                  onClick={() => setActiveTab('landTypes')}
                  className="text-xs text-amber-400 hover:text-amber-300 font-semibold cursor-pointer"
                >
                  Chi tiết →
                </button>
              </div>

              <div className="space-y-2.5">
                {landTypeStats.slice(0, 6).map((lt) => (
                  <div
                    key={lt.code}
                    className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded text-[11px] border border-amber-400/20">
                          {lt.code}
                        </span>
                        <span className="text-slate-300 font-medium">
                          {lt.code === 'LUK'
                            ? 'Đất trồng lúa nước còn lại'
                            : lt.code === 'NHK'
                            ? 'Đất nương rẫy trồng cây hàng năm'
                            : lt.code === 'ONT'
                            ? 'Đất ở tại nông thôn'
                            : lt.code === 'LUC'
                            ? 'Đất chuyên trồng lúa nước'
                            : lt.code === 'CLN'
                            ? 'Đất trồng cây lâu năm'
                            : lt.code === 'BHK'
                            ? 'Đất bằng trồng cây hàng năm khác'
                            : 'Đất nông nghiệp / chuyên dùng'}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 mt-0.5 block">
                        Quy mô: {lt.totalAreaHa} ha
                      </span>
                    </div>
                    <div className="text-right">
                      <strong className="text-slate-200 block">{lt.count.toLocaleString('vi-VN')}</strong>
                      <span className="text-[10px] text-slate-400">{lt.percentCount}%</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-800/80 text-center">
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-400 hover:text-blue-300 transition"
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  Mở bản đồ số trực quan 5.943 thửa đất →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DANH SÁCH CHI TIẾT TẤT CẢ THÔN / BUÔN */}
        {activeTab === 'villages' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-400" />
                  Tiến Độ Số Hóa Từng Thôn / Buôn ({villageStats.length} địa bàn)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Bấm vào thôn bất kỳ để xem danh sách các thửa đất tương ứng
                </p>
              </div>
              <span className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-xl">
                Tổng quản lý: <strong>{globalStats.total.toLocaleString('vi-VN')} thửa</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {villageStats.map((v) => (
                <div
                  key={v.name}
                  onClick={() => {
                    setVillageFilter(v.name);
                    setActiveTab('table');
                  }}
                  className="bg-slate-950/70 hover:bg-slate-950 p-4 rounded-xl border border-slate-800 hover:border-blue-500/50 transition cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <strong className="text-sm font-bold text-white group-hover:text-blue-300 transition truncate max-w-[200px]">
                      {v.name}
                    </strong>
                    <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      {v.rate}% GGS
                    </span>
                  </div>

                  <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden flex my-2">
                    <div style={{ width: `${v.rate}%` }} className="bg-emerald-500 h-full rounded-l-full" />
                    <div
                      style={{ width: `${v.total > 0 ? (v.yellow / v.total) * 100 : 0}%` }}
                      className="bg-amber-500 h-full"
                    />
                    <div
                      style={{ width: `${v.total > 0 ? (v.gray / v.total) * 100 : 0}%` }}
                      className="bg-slate-700 h-full rounded-r-full"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800/60">
                    <div>
                      <span className="block text-[10px] text-slate-500">Tổng thửa:</span>
                      <strong className="text-slate-200">{v.total}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-emerald-500">Đã số hóa:</span>
                      <strong className="text-emerald-400">{v.green}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-amber-500">Có tên:</span>
                      <strong className="text-amber-400">{v.yellow}</strong>
                    </div>
                  </div>

                  <div className="mt-2 text-[10px] text-blue-400 group-hover:underline flex items-center justify-between">
                    <span>Quy mô: {v.totalAreaHa} ha</span>
                    <span>Xem danh sách →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: PHÂN BỔ LOẠI ĐẤT TOÀN XÃ */}
        {activeTab === 'landTypes' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <PieChart className="w-4 h-4 text-amber-400" />
                Cơ Cấu & Diện Tích Phân Bổ Theo Mục Đích Sử Dụng Đất
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Toàn xã có {landTypeStats.length} mã loại đất với tổng diện tích {globalStats.totalAreaHa} ha
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {landTypeStats.map((lt) => (
                <div
                  key={lt.code}
                  onClick={() => {
                    setLandTypeFilter(lt.code);
                    setActiveTab('table');
                  }}
                  className="bg-slate-950/70 hover:bg-slate-950 p-4 rounded-xl border border-slate-800 hover:border-amber-500/50 transition cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono font-bold text-sm text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-lg border border-amber-400/20">
                      {lt.code}
                    </span>
                    <span className="text-xs font-bold text-slate-300">{lt.percentCount}%</span>
                  </div>

                  <strong className="text-xs text-white block truncate mb-1">
                    {lt.code === 'LUK'
                      ? 'Đất trồng lúa nước còn lại'
                      : lt.code === 'NHK'
                      ? 'Đất nương rẫy trồng cây hàng năm'
                      : lt.code === 'ONT'
                      ? 'Đất ở tại nông thôn'
                      : lt.code === 'LUC'
                      ? 'Đất chuyên trồng lúa nước'
                      : lt.code === 'CLN'
                      ? 'Đất trồng cây lâu năm'
                      : lt.code === 'BHK'
                      ? 'Đất bằng trồng cây hàng năm khác'
                      : lt.code === 'BCS'
                      ? 'Đất bằng chưa sử dụng'
                      : lt.code === 'HNK'
                      ? 'Đất trồng cây hàng năm khác'
                      : lt.code === 'RSX'
                      ? 'Đất rừng sản xuất'
                      : lt.code === 'NTS'
                      ? 'Đất nuôi trồng thủy sản'
                      : 'Mục đích sử dụng khác'}
                  </strong>

                  <div className="flex items-center justify-between text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/60">
                    <span>Số lượng: <strong className="text-white">{lt.count.toLocaleString('vi-VN')} thửa</strong></span>
                    <span>Diện tích: <strong className="text-amber-400">{lt.totalAreaHa} ha</strong></span>
                  </div>
                </div>
              ))}
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
    </div>
  );
}
