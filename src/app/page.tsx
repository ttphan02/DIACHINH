'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import rawParcels from '@/data/parcels.json';
import { Parcel, ParcelStatus, NeighborParcel, DeclarationFormData } from '@/types';
import HeaderStats from '@/components/HeaderStats';
import ParcelDetailPanel from '@/components/ParcelDetailPanel';
import VectorViewerModal from '@/components/VectorViewerModal';
import MapSheetMultiSelect from '@/components/MapSheetMultiSelect';
import { findNearbyParcels, removeVietnameseTones } from '@/utils/geo';
import {
  Search,
  Layers,
  ChevronRight,
  Map as MapIcon,
  LayoutGrid,
  MapPin,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

// Dynamic import Leaflet Map (SSR disabled)
const CadastralMap = dynamic(() => import('@/components/CadastralMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-white gap-3">
      <div className="w-9 h-9 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-xs font-semibold text-slate-300">Đang tải bản đồ vệ tinh Google Maps...</p>
    </div>
  ),
});

export default function Home() {
  const [parcels] = useState<Parcel[]>(rawParcels as Parcel[]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<ParcelStatus | 'ALL'>('ALL');
  const [viewMode, setViewMode] = useState<'map' | 'grid'>('map');
  const [page, setPage] = useState(1);
  const pageSize = 40;

  // Selected Parcel & Slide Animation State
  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [neighborParcels, setNeighborParcels] = useState<NeighborParcel[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Vector SVG / Image Viewer Modal State
  const [isSvgOpen, setIsSvgOpen] = useState(false);
  const [svgData, setSvgData] = useState<{
    url: string;
    urls?: string[];
    title: string;
    owner?: string;
    cccd?: string;
  }>({
    url: '',
    title: '',
  });

  // Google Sheets Realtime State
  const [ggsCodes, setGgsCodes] = useState<Set<string>>(new Set());
  const [isGgsLoaded, setIsGgsLoaded] = useState(false);
  const [isSyncingGgs, setIsSyncingGgs] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Danh sách các thửa đã kê khai trên hệ thống (lưu trong localStorage để bền vững)
  const [declaredParcelCodes, setDeclaredParcelCodes] = useState<Set<string>>(new Set());

  // Tải danh sách đã kê khai từ LocalStorage khi khởi tạo
  useEffect(() => {
    try {
      const saved = localStorage.getItem('diachinh_declared_codes');
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          setDeclaredParcelCodes(new Set(arr));
        }
      }
    } catch (e) {
      console.error('Không thể đọc dữ liệu kê khai đã lưu:', e);
    }
  }, []);

  // Hàm đồng bộ Google Sheets realtime
  const fetchGgsCodes = useCallback(async (force = false) => {
    try {
      setIsSyncingGgs(true);
      const res = await fetch(`/api/sync-ggs${force ? '?force=true' : ''}`);
      if (!res.ok) throw new Error(`Lỗi HTTP ${res.status}`);
      const data: any = await res.json();
      if (data && data.success && Array.isArray(data.ggsCodes)) {
        setGgsCodes(new Set(data.ggsCodes));
        setIsGgsLoaded(true);
        setLastSyncTime(new Date().toLocaleTimeString('vi-VN'));
      }
    } catch (err: any) {
      console.error('Lỗi khi fetch Google Sheets:', err);
    } finally {
      setIsSyncingGgs(false);
    }
  }, []);

  // Fetch GGS lúc ban đầu và định kỳ 45s một lần (Realtime)
  useEffect(() => {
    fetchGgsCodes(false);
    const interval = setInterval(() => {
      fetchGgsCodes(false);
    }, 45000);
    return () => clearInterval(interval);
  }, [fetchGgsCodes]);

  // TÍNH TOÁN TRẠNG THÁI REALTIME CỦA TỪNG THỬA ĐẤT:
  // TÍNH TOÁN TRẠNG THÁI REALTIME CỦA TỪNG THỬA ĐẤT:
  // 1. Thửa có trên Google Sheets -> Đã số hóa (Xanh lá)
  // 2. Thửa ĐÃ ĐƯỢC KÊ KHAI trên hệ thống web nhưng CHƯA có trên GGS -> Màu xanh lam
  // 3. Thửa có tên chủ đất (chưa kê khai, chưa có trên GGS) -> Màu vàng
  // 4. Thửa chưa có tên -> Màu trắng
  const computedParcels = useMemo<Parcel[]>(() => {
    return parcels.map((p) => {
      const isOnGgs = isGgsLoaded ? ggsCodes.has(p.ma_thua) : false;
      const isLocallyDeclared = declaredParcelCodes.has(p.ma_thua);

      let trang_thai: ParcelStatus;
      if (isOnGgs || p.trang_thai === 'DA_SO_HOA_XANH') {
        trang_thai = 'DA_SO_HOA_XANH'; // Xanh lá: Đã số hóa (Có trên GGS hoặc đã được đánh dấu xanh trong Excel tổng)
      } else if (isLocallyDeclared) {
        trang_thai = 'DA_KE_KHAI_CHUA_SO_HOA_LAM'; // Xanh lam: Vừa kê khai trên web, chưa số hóa lên GGS
      } else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') {
        trang_thai = 'CO_TEN_CHUA_SO_HOA_VANG'; // Vàng: Có tên chủ đất (từ danh sách DSCOTEN)
      } else {
        trang_thai = 'CHUA_CO_TEN_XAM'; // Trắng: Chưa có tên (File tổng trừ đi DSCOTEN)
      }

      return {
        ...p,
        trang_thai,
        is_on_ggs: isOnGgs || p.trang_thai === 'DA_SO_HOA_XANH',
        is_declared: isLocallyDeclared,
      };
    });
  }, [parcels, ggsCodes, declaredParcelCodes, isGgsLoaded]);

  // Cập nhật selectedParcel khi computedParcels thay đổi
  useEffect(() => {
    if (selectedParcel) {
      const updated = computedParcels.find((p) => p.ma_thua === selectedParcel.ma_thua);
      if (updated && updated.trang_thai !== selectedParcel.trang_thai) {
        setSelectedParcel(updated);
      }
    }
  }, [computedParcels, selectedParcel]);

  // Danh sách Tờ bản đồ sắp xếp thứ tự và đếm số thửa
  const sheetList = useMemo(() => {
    const counts: Record<string, number> = {};
    computedParcels.forEach((p) => {
      const t = p.to_ban_do?.trim();
      if (t) counts[t] = (counts[t] || 0) + 1;
    });

    const sortKey = (k: string) => {
      const num = parseInt(k, 10);
      return isNaN(num) ? [1, k] : [0, num];
    };

    return Object.keys(counts)
      .sort((a, b) => {
        const [typeA, valA] = sortKey(a);
        const [typeB, valB] = sortKey(b);
        if (typeA !== typeB) return (typeA as number) - (typeB as number);
        return valA < valB ? -1 : valA > valB ? 1 : 0;
      })
      .map((sheet) => ({ sheet, count: counts[sheet] }));
  }, [computedParcels]);

  // Stats
  const stats = useMemo(() => {
    let green = 0;
    let blue = 0;
    let yellow = 0;
    let gray = 0;
    let gps = 0;
    computedParcels.forEach((p) => {
      if (p.trang_thai === 'DA_SO_HOA_XANH') green++;
      else if (p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') blue++;
      else if (p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG') yellow++;
      else gray++;
      if (p.lat && p.lng) gps++;
    });
    return {
      total: computedParcels.length,
      green,
      blue,
      yellow,
      gray,
      gps,
    };
  }, [computedParcels]);

  // Filtered parcels
  const filteredParcels = useMemo(() => {
    const qClean = removeVietnameseTones(searchQuery.trim());

    return computedParcels.filter((p) => {
      if (statusFilter !== 'ALL' && p.trang_thai !== statusFilter) return false;

      if (selectedSheets.length > 0 && !selectedSheets.includes(p.to_ban_do)) {
        return false;
      }

      if (qClean) {
        const codeMatch = p.ma_thua.toLowerCase().includes(qClean);
        const ownerClean = removeVietnameseTones(p.chu_ho || '');
        const ownerMatch = ownerClean.includes(qClean);
        const toMatch = p.to_ban_do.includes(qClean);
        const thuaMatch = p.so_thua.includes(qClean);
        if (!codeMatch && !ownerMatch && !toMatch && !thuaMatch) return false;
      }

      return true;
    });
  }, [computedParcels, searchQuery, selectedSheets, statusFilter]);

  // Paginated items
  const paginatedParcels = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredParcels.slice(start, start + pageSize);
  }, [filteredParcels, page]);

  const totalPages = Math.ceil(filteredParcels.length / pageSize);

  // 1. Danh sách các thửa đất cùng chủ CHÍNH XÁC theo CCCD (duy nhất)
  const sameCccdParcels = useMemo(() => {
    if (!selectedParcel || !selectedParcel.cccd || selectedParcel.cccd.trim().length < 9) {
      return [];
    }
    const cleanCccd = selectedParcel.cccd.trim();
    return computedParcels.filter(
      (p) =>
        p.ma_thua !== selectedParcel.ma_thua &&
        p.cccd &&
        p.cccd.trim() === cleanCccd
    );
  }, [selectedParcel, computedParcels]);

  // 2. Danh sách các thửa đất khác có cùng Tên (trừ các thửa đã trùng CCCD) - "Có thể chủ hộ này còn sở hữu"
  const sameNameParcels = useMemo(() => {
    if (!selectedParcel || !selectedParcel.chu_ho || selectedParcel.chu_ho === 'Chưa có tên') {
      return [];
    }
    const cleanOwner = selectedParcel.chu_ho.trim().toLowerCase();
    const cccdMatchedCodes = new Set(sameCccdParcels.map((p) => p.ma_thua));

    return computedParcels.filter(
      (p) =>
        p.ma_thua !== selectedParcel.ma_thua &&
        !cccdMatchedCodes.has(p.ma_thua) &&
        p.chu_ho &&
        p.chu_ho !== 'Chưa có tên' &&
        p.chu_ho.trim().toLowerCase() === cleanOwner
    );
  }, [selectedParcel, computedParcels, sameCccdParcels]);

  const sameOwnerParcels = useMemo(() => {
    return [...sameCccdParcels, ...sameNameParcels];
  }, [sameCccdParcels, sameNameParcels]);

  const handleSelectParcel = (p: Parcel) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const latest = computedParcels.find((cp) => cp.ma_thua === p.ma_thua) || p;
    setSelectedParcel(latest);

    // Kích hoạt animation trượt vào mượt mà
    requestAnimationFrame(() => {
      setIsPanelOpen(true);
    });

    // Tìm thửa lân cận: bao gồm cả thửa xanh lá, xanh lam và thửa vàng (có tên)
    const nbs = findNearbyParcels(latest, computedParcels, 350, 8);
    setNeighborParcels(nbs);

    if (window.innerWidth < 1024 && panelRef.current) {
      setTimeout(() => {
        panelRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    }
  };

  const handleClosePanel = () => {
    setIsPanelOpen(false);
    // Đợi hiệu ứng trượt ra (300ms) kết thúc mới dọn dẹp dữ liệu
    closeTimerRef.current = setTimeout(() => {
      setSelectedParcel(null);
      closeTimerRef.current = null;
    }, 320);
  };

  const handleOpenVectorViewer = (
    url: string,
    title: string,
    owner?: string,
    cccd?: string,
    urls?: string[]
  ) => {
    setSvgData({ url, title, owner, cccd, urls });
    setIsSvgOpen(true);
  };

  const handleSaveDeclaration = (formData: DeclarationFormData) => {
    console.log('Phiếu kê khai / báo sai đã lưu:', formData);

    if (formData.is_correction) {
      try {
        const stored = JSON.parse(localStorage.getItem('diachinh_corrections') || '[]');
        stored.push({
          ...formData,
          created_at: new Date().toISOString(),
        });
        localStorage.setItem('diachinh_corrections', JSON.stringify(stored));
      } catch (e) {
        console.error(e);
      }
    } else {
      // 1. Thêm mã thửa vào danh sách đã kê khai
      setDeclaredParcelCodes((prev) => {
        const next = new Set(prev);
        next.add(formData.ma_thua);
        try {
          localStorage.setItem('diachinh_declared_codes', JSON.stringify(Array.from(next)));
        } catch (e) {
          console.error(e);
        }
        return next;
      });
    }

    // 2. Cập nhật dữ liệu hiển thị của thửa đang chọn
    if (selectedParcel && selectedParcel.ma_thua === formData.ma_thua) {
      const isOnGgs = ggsCodes.has(formData.ma_thua) || selectedParcel.trang_thai === 'DA_SO_HOA_XANH';
      setSelectedParcel({
        ...selectedParcel,
        chu_ho: formData.chu_dat_ten || selectedParcel.chu_ho,
        cccd: formData.chu_dat_cccd || selectedParcel.cccd,
        giap_dong: formData.giap_dong || selectedParcel.giap_dong,
        giap_tay: formData.giap_tay || selectedParcel.giap_tay,
        giap_nam: formData.giap_nam || selectedParcel.giap_nam,
        giap_bac: formData.giap_bac || selectedParcel.giap_bac,
        trang_thai: isOnGgs ? 'DA_SO_HOA_XANH' : 'DA_KE_KHAI_CHUA_SO_HOA_LAM',
        is_declared: true,
      });
    }
  };

  return (
    <main className="h-screen w-screen overflow-hidden relative bg-slate-900 text-gray-900">
      {/* Main Content Area */}
      <div className="w-full h-full relative overflow-hidden">
        {viewMode === 'map' ? (
          /* CHẾ ĐỘ BẢN ĐỒ VỆ TINH TOÀN MÀN HÌNH */
          <div className="w-full h-full relative overflow-hidden">
            {/* Form chi tiết: Trượt từ trái qua (Desktop toàn chiều cao) hoặc Bottom Sheet trượt từ dưới lên (Mobile không làm mờ map) */}
            <div
              ref={panelRef}
              className={`absolute z-30 bg-white transition-all duration-300 ease-in-out shadow-2xl overflow-hidden ${
                isPanelOpen && selectedParcel
                  ? 'w-full lg:w-[420px] h-[65vh] max-h-[85vh] lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-100 translate-y-0 lg:translate-x-0 rounded-t-3xl lg:rounded-none border-t lg:border-t-0 lg:border-r border-gray-200 pointer-events-auto'
                  : 'w-full lg:w-0 h-0 lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-0 translate-y-full lg:-translate-x-full border-0 pointer-events-none'
              }`}
            >
              <div className="w-full lg:w-[420px] h-full flex flex-col">
                {selectedParcel && (
                  <ParcelDetailPanel
                    parcel={selectedParcel}
                    neighbors={neighborParcels}
                    sameCccdParcels={sameCccdParcels}
                    sameNameParcels={sameNameParcels}
                    sameOwnerParcels={sameOwnerParcels}
                    onSelectParcel={handleSelectParcel}
                    onClose={handleClosePanel}
                    onOpenVectorViewer={handleOpenVectorViewer}
                    onSaveDeclaration={handleSaveDeclaration}
                  />
                )}
              </div>
            </div>

            {/* Cụm button điều khiển nổi: Trạng thái, Realtime GGS & Tìm kiếm */}
            <div
              className={`absolute top-2.5 sm:top-3.5 z-20 flex flex-col gap-1.5 sm:gap-2 transition-all duration-300 left-2.5 right-2.5 lg:right-auto ${
                isPanelOpen ? 'lg:left-[436px]' : 'lg:left-3.5'
              }`}
            >
              {/* Row 1: Các button trạng thái: Tất cả, Đã số hóa (Xanh lá), Đã kê khai (Xanh lam), Có tên (Vàng), Chưa có tên (Trắng) */}
              <div className="flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-md p-1 rounded-2xl border border-slate-700/60 shadow-xl overflow-x-auto no-scrollbar w-full sm:w-fit max-w-full">
                <button
                  onClick={() => {
                    setStatusFilter('ALL');
                    setPage(1);
                  }}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-xl font-bold transition text-xs flex items-center gap-1 shrink-0 ${
                    statusFilter === 'ALL'
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-400'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
                  }`}
                >
                  Tất cả ({stats.total.toLocaleString('vi-VN')})
                </button>

                {/* Đã số hóa (Xanh lá - Có trên GGS) */}
                <button
                  onClick={() => {
                    setStatusFilter('DA_SO_HOA_XANH');
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl font-bold transition text-xs shrink-0 ${
                    statusFilter === 'DA_SO_HOA_XANH'
                      ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400'
                      : 'bg-slate-800/80 text-emerald-300 hover:bg-slate-700/80 border border-emerald-500/30'
                  }`}
                  title="Thửa đã số hóa (có trên Google Sheets)"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-emerald-300"></span>
                  Đã số hóa ({stats.green.toLocaleString('vi-VN')})
                </button>

                {/* Đã kê khai (Xanh lam - Chưa có trên GGS) */}
                <button
                  onClick={() => {
                    setStatusFilter('DA_KE_KHAI_CHUA_SO_HOA_LAM');
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl font-bold transition text-xs shrink-0 ${
                    statusFilter === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-400'
                      : 'bg-slate-800/80 text-blue-300 hover:bg-slate-700/80 border border-blue-500/30'
                  }`}
                  title="Thửa đã được kê khai nhưng chưa số hóa lên Google Sheets"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 border border-blue-300"></span>
                  Đã kê khai ({stats.blue.toLocaleString('vi-VN')})
                </button>

                {/* Có tên chủ đất (Vàng) */}
                <button
                  onClick={() => {
                    setStatusFilter('CO_TEN_CHUA_SO_HOA_VANG');
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl font-bold transition text-xs shrink-0 ${
                    statusFilter === 'CO_TEN_CHUA_SO_HOA_VANG'
                      ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-400'
                      : 'bg-slate-800/80 text-amber-300 hover:bg-slate-700/80 border border-amber-500/30'
                  }`}
                  title="Thửa có tên chủ đất, chưa kê khai"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-300"></span>
                  Có tên ({stats.yellow.toLocaleString('vi-VN')})
                </button>

                {/* Chưa có tên (Trắng) */}
                <button
                  onClick={() => {
                    setStatusFilter('CHUA_CO_TEN_XAM');
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl font-bold transition text-xs shrink-0 ${
                    statusFilter === 'CHUA_CO_TEN_XAM'
                      ? 'bg-slate-700 text-white shadow-sm ring-2 ring-slate-400'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 border border-slate-600/30'
                  }`}
                  title="Thửa chưa có tên chủ đất"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-white border border-slate-400"></span>
                  Chưa có tên ({stats.gray.toLocaleString('vi-VN')})
                </button>

                {/* Nút bấm & Chỉ báo Realtime Google Sheets */}
                <button
                  onClick={() => fetchGgsCodes(true)}
                  disabled={isSyncingGgs}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-bold transition text-xs shrink-0 bg-slate-900/90 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 disabled:opacity-60"
                  title={
                    lastSyncTime
                      ? `Đồng bộ lúc: ${lastSyncTime}. Bấm để cập nhật lại từ Google Sheets ngay.`
                      : 'Bấm để đồng bộ từ Google Sheets ngay'
                  }
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isSyncingGgs ? 'animate-spin text-cyan-400' : 'text-cyan-400'
                    }`}
                  />
                  <span className="hidden sm:inline">GGS Live</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </button>
              </div>

              {/* Row 2: Thanh tìm kiếm & lọc tờ bản đồ & Nút Danh sách trên mobile */}
              <div className="flex items-center gap-1.5 sm:gap-2 bg-white/95 backdrop-blur-md p-1.5 rounded-2xl border border-gray-200/90 shadow-xl w-full max-w-xl">
                <div className="relative flex-1 min-w-[110px] sm:min-w-[180px]">
                  <Search className="w-4 h-4 text-gray-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Tìm số tờ, thửa, tên..."
                    className="w-full pl-7 sm:pl-8 pr-2 py-1.5 text-xs bg-gray-50 hover:bg-gray-100/70 focus:bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium transition"
                  />
                </div>

                <MapSheetMultiSelect
                  sheetList={sheetList}
                  selectedSheets={selectedSheets}
                  onChange={(sheets) => {
                    setSelectedSheets(sheets);
                    setPage(1);
                  }}
                />

                {(searchQuery || selectedSheets.length > 0 || statusFilter !== 'ALL') && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedSheets([]);
                      setStatusFilter('ALL');
                      setPage(1);
                    }}
                    className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition font-medium shrink-0"
                    title="Khôi phục mặc định"
                  >
                    Đặt lại
                  </button>
                )}

                {/* Nút chuyển chế độ Danh sách / Lưới */}
                <button
                  onClick={() => setViewMode('grid')}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl transition shrink-0 border border-blue-200"
                  title="Xem danh sách dạng lưới"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">DS</span>
                </button>
              </div>
            </div>

            {/* Bản đồ Leaflet phủ 100% diện tích màn hình */}
            <CadastralMap
              parcels={filteredParcels}
              onSelectParcel={handleSelectParcel}
              selectedParcel={selectedParcel}
            />
          </div>
        ) : (
          /* CHẾ ĐỘ DANH SÁCH / LƯỚI CARD */
          <div className="w-full h-full overflow-y-auto bg-slate-50 p-3 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-4">
              {/* Header Grid View */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div>
                  <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                    Tra Cứu Bản Đồ Địa Chính
                    <span className="text-xs font-bold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                      Cư Pui
                    </span>
                  </h1>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Hệ thống số hóa, kê khai đất đai và đối soát Google Sheets trực tiếp
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchGgsCodes(true)}
                    disabled={isSyncingGgs}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition text-xs bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200"
                    title="Đồng bộ lại Google Sheets"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingGgs ? 'animate-spin' : ''}`} />
                    <span>Đồng bộ GGS</span>
                  </button>

                  <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-2xl text-xs">
                    <button
                      onClick={() => setViewMode('map')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition text-gray-600 hover:text-gray-900"
                    >
                      <MapIcon className="w-3.5 h-3.5 text-blue-600" />
                      Bản đồ
                    </button>
                    <button
                      onClick={() => setViewMode('grid')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition bg-blue-600 text-white shadow-xs"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      Danh sách
                    </button>
                  </div>
                </div>
              </div>

              {/* Thống kê 5 nhóm trạng thái */}
              <HeaderStats
                total={stats.total}
                greenCount={stats.green}
                blueCount={stats.blue}
                yellowCount={stats.yellow}
                grayCount={stats.gray}
                gpsCount={stats.gps}
                currentFilter={statusFilter}
                onSelectFilter={(st) => {
                  setStatusFilter(st);
                  setPage(1);
                }}
              />

              {/* Bộ lọc & Tìm kiếm */}
              <div className="bg-white p-2.5 sm:p-3 rounded-2xl border border-gray-100 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-2 relative z-20">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Tìm theo số tờ, số thửa hoặc tên chủ đất..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium transition"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                  <div className="flex-1 sm:flex-initial">
                    <MapSheetMultiSelect
                      sheetList={sheetList}
                      selectedSheets={selectedSheets}
                      onChange={(sheets) => {
                        setSelectedSheets(sheets);
                        setPage(1);
                      }}
                    />
                  </div>

                  {(searchQuery || selectedSheets.length > 0 || statusFilter !== 'ALL') && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedSheets([]);
                        setStatusFilter('ALL');
                        setPage(1);
                      }}
                      className="px-3 py-2 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition font-medium shrink-0"
                      title="Khôi phục mặc định"
                    >
                      Đặt lại
                    </button>
                  )}
                </div>
              </div>

              {/* Thông tin kết quả tìm kiếm */}
              <div className="flex items-center justify-between text-xs text-gray-500 px-1 mb-3">
                <span>
                  Tìm thấy <strong>{filteredParcels.length.toLocaleString('vi-VN')}</strong> thửa đất
                  {selectedSheets.length > 0 && ` (${selectedSheets.length} tờ bản đồ)`}
                </span>
                <span>
                  Trang {page} / {totalPages || 1}
                </span>
              </div>

              {/* Lưới danh sách thửa đất */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {paginatedParcels.map((p) => {
                  const isGreen = p.trang_thai === 'DA_SO_HOA_XANH';
                  const isBlue = p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
                  const isYellow = p.trang_thai === 'CO_TEN_CHUA_SO_HOA_VANG';

                  return (
                    <div
                      key={p.ma_thua}
                      onClick={() => {
                        handleSelectParcel(p);
                        setViewMode('map');
                      }}
                      className="group relative bg-white p-3.5 rounded-2xl border border-gray-100 hover:border-blue-300 hover:shadow-lg transition-all duration-200 cursor-pointer flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                              isGreen
                                ? 'bg-emerald-100 text-emerald-800'
                                : isBlue
                                ? 'bg-blue-100 text-blue-800'
                                : isYellow
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isGreen
                                  ? 'bg-emerald-500'
                                  : isBlue
                                  ? 'bg-blue-600'
                                  : isYellow
                                  ? 'bg-amber-500'
                                  : 'bg-gray-400'
                              }`}
                            ></span>
                            {isGreen
                              ? 'Đã số hóa (GGS)'
                              : isBlue
                              ? 'Đã kê khai'
                              : isYellow
                              ? 'Có tên chủ'
                              : 'Chưa có tên'}
                          </span>

                          <span className="text-[11px] font-mono font-bold text-gray-400 group-hover:text-blue-600 transition">
                            {p.ma_thua}
                          </span>
                        </div>

                        <h3 className="text-sm font-extrabold text-gray-900 group-hover:text-blue-600 transition flex items-center justify-between">
                          Thửa {p.so_thua} • Tờ {p.to_ban_do}
                          <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition" />
                        </h3>

                        <p className="text-xs text-gray-700 font-semibold mt-1 truncate" title={p.chu_ho}>
                          {p.chu_ho && p.chu_ho !== 'Chưa có tên' ? (
                            p.chu_ho
                          ) : (
                            <span className="text-gray-400 font-normal italic">Chưa có tên chủ</span>
                          )}
                        </p>

                        <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1 capitalize">
                          <MapPin className="w-3 h-3 text-gray-400" />
                          {p.thon_xa}
                        </p>
                      </div>

                      <div className="pt-2.5 mt-2.5 border-t border-gray-50 flex items-center justify-between text-xs text-gray-500">
                        <span className="font-bold text-blue-600">
                          {p.dien_tich ? `${p.dien_tich} m²` : '---'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-gray-50 text-[10px] font-bold text-emerald-700">
                          {p.loai_dat || 'Chưa có'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8 pb-10">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    className="px-3.5 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold hover:bg-gray-50 disabled:opacity-40 transition"
                  >
                    Trang trước
                  </button>
                  <span className="text-xs font-bold text-gray-600 px-2">
                    {page} / {totalPages}
                  </span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                    className="px-3.5 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold hover:bg-gray-50 disabled:opacity-40 transition"
                  >
                    Trang sau
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Vector SVG / Image Modal */}
      <VectorViewerModal
        isOpen={isSvgOpen}
        onClose={() => setIsSvgOpen(false)}
        svgUrl={svgData.url}
        urls={svgData.urls}
        title={svgData.title}
        ownerName={svgData.owner}
        cccdNumber={svgData.cccd}
      />
    </main>
  );
}
