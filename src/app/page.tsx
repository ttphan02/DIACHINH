'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Parcel, ParcelStatus, NeighborParcel, DeclarationFormData, AdditionalParcel } from '@/types';
import ParcelDetailPanel from '@/components/ParcelDetailPanel';
import VectorViewerModal from '@/components/VectorViewerModal';
import CccdSupplementModal from '@/components/CccdSupplementModal';
import CccdUploadBottomSheet from '@/components/CccdUploadBottomSheet';
import ExportMissingCccdModal from '@/components/ExportMissingCccdModal';
import CadreNameModal from '@/components/CadreNameModal';
import MapSheetMultiSelect from '@/components/MapSheetMultiSelect';
import { findNearbyParcels, removeVietnameseTones, calculateDistanceMeters, formatDistance } from '@/utils/geo';
import { isPersonName } from '@/utils/textHelpers';
import { getStoredDeclarations, saveOrUpdateDeclaration, removeDeclaration, getSavedCadreName } from '@/utils/declaration';
import { reportCadreLocation } from '@/utils/cadreTracker';
import { backgroundKeeper } from '@/utils/backgroundLocationKeeper';
import {
  Search,
  Layers,
  ChevronRight,
  ChevronUp,
  MapPin,
  RefreshCw,
  Sparkles,
  BarChart3,
  FileText,
  Camera,
  Users,
  UserCheck,
  Headphones,
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
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [isLoadingParcels, setIsLoadingParcels] = useState(true);

  // Tên cán bộ kê khai
  const [cadreName, setCadreName] = useState<string>('');
  const [isCadreModalOpen, setIsCadreModalOpen] = useState(false);
  const [isFirstTimeCadre, setIsFirstTimeCadre] = useState(false);

  // Chế độ Đút Túi Quần (Background Audio Keep-Alive khi khóa màn hình) - Luôn BẬT mặc định
  const [isPocketMode, setIsPocketMode] = useState(true);

  useEffect(() => {
    const saved = getSavedCadreName();
    if (saved) {
      setCadreName(saved);
      // Chế độ đút túi quần luôn bật (mặc định)
      setIsPocketMode(true);

      // Kích hoạt ngay audio nền khi người dùng chạm vào màn hình lần đầu
      const startKeeperOnFirstInteraction = async () => {
        if (!backgroundKeeper.isActive()) {
          await backgroundKeeper.start(saved);
        }
        window.removeEventListener('click', startKeeperOnFirstInteraction);
        window.removeEventListener('touchstart', startKeeperOnFirstInteraction);
      };
      window.addEventListener('click', startKeeperOnFirstInteraction, { once: true });
      window.addEventListener('touchstart', startKeeperOnFirstInteraction, { once: true });
    } else {
      setIsFirstTimeCadre(true);
      setIsCadreModalOpen(true);
    }
  }, []);

  const togglePocketMode = async () => {
    if (isPocketMode) {
      backgroundKeeper.stop();
      setIsPocketMode(false);
      setPickToast('✓ Đã tắt chế độ theo dõi khi khóa màn hình');
      setTimeout(() => setPickToast(null), 3000);
    } else {
      const ok = await backgroundKeeper.start(cadreName);
      if (ok) {
        setIsPocketMode(true);
        setPickToast('🟢 Đã bật chế độ Đút túi quần! Khi khóa màn hình, điện thoại vẫn liên tục gửi vị trí về Dashboard.');
        setTimeout(() => setPickToast(null), 5000);
      } else {
        setPickToast('⚠️ Không thể kích hoạt âm thanh nền');
        setTimeout(() => setPickToast(null), 3000);
      }
    }
  };

  // Tải dữ liệu 11.280 thửa đất bất đồng bộ phía trình duyệt từ CDN tĩnh, giải phóng 100% tài nguyên Cloudflare Worker SSR (ngăn lỗi 1102)
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

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<ParcelStatus | 'ALL' | 'CHUA_KE_KHAI'>('ALL');

  // Selected Parcel & Slide Animation State
  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [neighborParcels, setNeighborParcels] = useState<NeighborParcel[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Modal Tải Lên CCCD hàng loạt & thư mục
  const [isCccdModalOpen, setIsCccdModalOpen] = useState(false);
  // Bottom Sheet Tải Lên CCCD (Trượt từ dưới lên như khi nhấn vào thửa đất)
  const [isCccdUploadOpen, setIsCccdUploadOpen] = useState(false);

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
  const [ggsParcelsMap, setGgsParcelsMap] = useState<
    Record<string, { chu_ho?: string; cccd?: string; dien_tich?: string; loai_dat?: string }>
  >({});
  const [isGgsLoaded, setIsGgsLoaded] = useState(false);
  const [isSyncingGgs, setIsSyncingGgs] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Danh sách các thửa đã kê khai trên hệ thống (lưu trong localStorage để bền vững)
  const [declaredParcelCodes, setDeclaredParcelCodes] = useState<Set<string>>(new Set());
  const [declarationsMap, setDeclarationsMap] = useState<Record<string, any>>({});
  const [isExportMissingCccdOpen, setIsExportMissingCccdOpen] = useState(false);

  // Kê khai gộp nhiều thửa đất chung một phiếu
  const [additionalParcels, setAdditionalParcels] = useState<AdditionalParcel[]>([]);
  const [isPickingAdditional, setIsPickingAdditional] = useState<boolean>(false);
  const [pickToast, setPickToast] = useState<string | null>(null);

  // Định vị GPS thực địa và La bàn hướng nhìn cho cán bộ
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    heading?: number | null;
    speed?: number | null;
  } | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const lastCloudSigRef = useRef<string>('');
  const lastCloudUpdatedAtRef = useRef<string>('');
  const lastGgsCountRef = useRef<number>(-1);
  const hasHandledUrlQueryRef = useRef<boolean>(false);

  // Tự động kích hoạt định vị GPS liên tục khi tải trang (Always-on Realtime GPS)
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;

    setIsLocating(true);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading: gpsHeading, speed } = pos.coords;
        setUserLocation((prev) => {
          // Chống nhiễu GPS (Jitter filter): Nếu đứng yên (dịch chuyển < 1.2m), giữ nguyên tham chiếu để tránh re-render
          if (
            prev &&
            Math.abs(prev.lat - latitude) < 0.000011 &&
            Math.abs(prev.lng - longitude) < 0.000011
          ) {
            return prev;
          }
          return {
            lat: latitude,
            lng: longitude,
            accuracy: Math.round(accuracy),
            heading: typeof gpsHeading === 'number' && !isNaN(gpsHeading) ? Math.round(gpsHeading) : prev?.heading,
            speed: typeof speed === 'number' && !isNaN(speed) ? Math.round(speed * 3.6) : null,
          };
        });
        setIsTracking(true);
        setIsLocating(false);

        // Phát sóng vị trí thực địa của cán bộ lên máy chủ trung tâm Dashboard
        reportCadreLocation({
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy),
          speed: typeof speed === 'number' && !isNaN(speed) ? Math.round(speed * 3.6) : null,
          heading: typeof gpsHeading === 'number' && !isNaN(gpsHeading) ? Math.round(gpsHeading) : null,
        }).catch(() => {});
      },
      (err) => {
        console.warn('GPS auto-watch note:', err.message);
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 2000,
      }
    );

    watchIdRef.current = watchId;

    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const handleAddAdditionalParcel = (p: Parcel) => {
    if (p.ma_thua === selectedParcel?.ma_thua) return;
    setAdditionalParcels((prev) => {
      if (prev.some((ap) => ap.ma_thua === p.ma_thua)) return prev;
      return [
        ...prev,
        {
          ma_thua: p.ma_thua,
          so_thua: p.so_thua,
          to_ban_do: p.to_ban_do,
          dien_tich: p.dien_tich,
          loai_dat: p.loai_dat,
          thon_xa: p.thon_xa,
          nguon_goc: 'Khai hoang',
        },
      ];
    });
    setPickToast(`Đã gộp Thửa ${p.so_thua} (Tờ ${p.to_ban_do}) vào phiếu`);
    setTimeout(() => setPickToast(null), 3000);
  };

  const handleRemoveAdditionalParcel = (maThua: string) => {
    setAdditionalParcels((prev) => prev.filter((ap) => ap.ma_thua !== maThua));
  };

  const handleTogglePickAdditional = () => {
    setIsPickingAdditional((prev) => !prev);
  };

  // Tải danh sách đã kê khai từ LocalStorage và đồng bộ từ Cloudflare R2
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
          if (data.updatedAt && data.updatedAt === lastCloudUpdatedAtRef.current) {
            return;
          }
          const cloudMap = data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {};
          const sig = JSON.stringify({ codes: data.declaredCodes, map: cloudMap });

          // CHỈ CẬP NHẬT STATE KHI DỮ LIỆU TRÊN CLOUD THỰC SỰ THAY ĐỔI (Tránh tính toán lại 18.000 thửa không cần thiết)
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

          // Khôi phục selectedParcel nếu đang xem đúng thửa vừa bị xóa trên máy khác
          setSelectedParcel((curr) => {
            if (!curr) return null;
            if (curr.is_declared && !cloudCodesSet.has(curr.ma_thua)) {
              const orig = parcels.find((p) => p.ma_thua === curr.ma_thua);
              return {
                ...(orig || curr),
                is_declared: false,
                trang_thai: (orig?.trang_thai as ParcelStatus) || 'CHUA_CO_TEN_XAM',
              };
            }
            return curr;
          });
        }
      }
    } catch (err) {
      console.warn('Lỗi khi fetch declarations từ cloud:', err);
    }
  }, [parcels]);

  useEffect(() => {
    const { declaredCodes, declarationsMap: loadedMap } = getStoredDeclarations();
    setDeclaredParcelCodes(declaredCodes);
    setDeclarationsMap(loadedMap);
    fetchCloudDeclarations();
  }, [fetchCloudDeclarations]);

  // Hàm đồng bộ Google Sheets realtime
  const fetchGgsCodes = useCallback(async (force = false) => {
    try {
      setIsSyncingGgs(true);
      const res = await fetch(`/api/sync-ggs${force ? '?force=true' : ''}`);
      if (!res.ok) throw new Error(`Lỗi HTTP ${res.status}`);
      const data: any = await res.json();
      if (data && data.success && Array.isArray(data.ggsCodes)) {
        // Chỉ tạo Set mới và tính toán lại 18.000 thửa nếu số lượng mã trên GGS thay đổi hoặc người dùng bấm làm mới
        if (force || data.ggsCodes.length !== lastGgsCountRef.current) {
          lastGgsCountRef.current = data.ggsCodes.length;
          setGgsCodes(new Set(data.ggsCodes));
          if (data.ggsParcels) {
            setGgsParcelsMap(data.ggsParcels);
          }
          setIsGgsLoaded(true);
        }
        setLastSyncTime(new Date().toLocaleTimeString('vi-VN'));
      }
    } catch (err: any) {
      console.warn('Lỗi kết nối /api/sync-ggs, kích hoạt dự phòng nạp trực tiếp từ Google Sheets:', err);
      try {
        const directRes = await fetch(
          'https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc/export?format=csv&gid=0'
        );
        if (directRes.ok) {
          const csvText = await directRes.text();
          const lines = csvText.split(/\r?\n/);
          const directCodes: string[] = [];
          for (let i = 2; i < lines.length; i++) {
            const line = lines[i];
            const m = line.match(/CHUACOGIAY_24478_(\d+_\d+)/);
            if (m) directCodes.push(m[1]);
          }
          if (directCodes.length > 0 && directCodes.length !== lastGgsCountRef.current) {
            lastGgsCountRef.current = directCodes.length;
            setGgsCodes(new Set(directCodes));
            setIsGgsLoaded(true);
            setLastSyncTime(new Date().toLocaleTimeString('vi-VN'));
          }
        }
      } catch (directErr) {
        console.error('Lỗi khi fetch trực tiếp GGS:', directErr);
      }
    } finally {
      setIsSyncingGgs(false);
    }
  }, []);

  // Fetch GGS & Cloud Declarations lúc ban đầu và định kỳ realtime giữa Admin & Mobile (Không cần F5)
  useEffect(() => {
    fetchGgsCodes(false);
    fetchCloudDeclarations();

    // Kiểm tra đồng bộ phiếu kê khai (xóa/sửa/thêm) mỗi 12 giây (Tự động cập nhật như WebSocket mà không cần F5)
    const declInterval = setInterval(() => {
      fetchCloudDeclarations();
    }, 12000);

    // Đồng bộ ngay lập tức khi người dùng chuyển tab hoặc mở màn hình điện thoại lên
    const onInstantSync = () => fetchCloudDeclarations();
    window.addEventListener('focus', onInstantSync);
    document.addEventListener('visibilitychange', onInstantSync);

    // Bắt lại vị trí và đồng bộ dữ liệu ngay lập tức khi thiết bị có mạng trở lại (Online event)
    const onOnlineReconnect = () => {
      fetchCloudDeclarations();
      fetchGgsCodes(true);
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude, accuracy, speed, heading } = pos.coords;
            const spd = typeof speed === 'number' && !isNaN(speed) ? Math.round(speed * 3.6) : null;
            reportCadreLocation({
              lat: latitude,
              lng: longitude,
              accuracy: Math.round(accuracy),
              speed: spd,
              heading: typeof heading === 'number' && !isNaN(heading) ? Math.round(heading) : null,
              action: 'Trực tuyến trở lại',
              force: true,
            }).catch(() => {});
          },
          () => {},
          { enableHighAccuracy: true, timeout: 10000 }
        );
      }
    };
    window.addEventListener('online', onOnlineReconnect);

    // Đồng bộ Google Sheets mỗi 45 giây
    const ggsInterval = setInterval(() => {
      fetchGgsCodes(false);
    }, 45000);

    return () => {
      clearInterval(declInterval);
      clearInterval(ggsInterval);
      window.removeEventListener('focus', onInstantSync);
      document.removeEventListener('visibilitychange', onInstantSync);
      window.removeEventListener('online', onOnlineReconnect);
    };
  }, [fetchGgsCodes, fetchCloudDeclarations]);

  // TÍNH TOÁN TRẠNG THÁI REALTIME VÀ ĐỒNG BỘ THÔNG TIN TỪ GOOGLE SHEETS:
  // 1. Thửa có trên Google Sheets -> Lấy Tên chủ hộ, CCCD từ GGS (thay thế bất kỳ dữ liệu excel lỗi thời nào)
  // 2. Thửa ĐÃ ĐƯỢC KÊ KHAI trên hệ thống web nhưng CHƯA có trên GGS -> Màu xanh lam
  // 3. Thửa có tên chủ đất (chưa kê khai, chưa có trên GGS) -> Màu vàng
  // 4. Thửa chưa có tên -> Màu trắng
  const computedParcels = useMemo<Parcel[]>(() => {
    return parcels.map((p) => {
      const isOnGgs = isGgsLoaded ? ggsCodes.has(p.ma_thua) : false;
      const isLocallyDeclared = declaredParcelCodes.has(p.ma_thua) || Boolean(declarationsMap[p.ma_thua]);

      // ĐỐI VỚI THỬA ĐÃ CÓ TRÊN GOOGLE SHEETS HOẶC ĐÃ KÊ KHAI:
      // ƯU TIÊN LẤY TÊN CHỦ THỬA VÀ CCCD TỪ GOOGLE SHEETS (loại bỏ hoàn toàn mã geohash rác w6jp...)
      const ggsInfo = ggsParcelsMap[p.ma_thua];
      const savedDecl = declarationsMap[p.ma_thua];

      let chu_ho = p.chu_ho;
      let cccd = p.cccd;

      const isInvalidName = (name?: string) => {
        if (!name) return true;
        const s = name.trim().toLowerCase();
        return (
          s === 'nam' ||
          s === 'nữ' ||
          s === 'nu' ||
          s === 'cá nhân' ||
          s === 'chung' ||
          s.startsWith('w6jp')
        );
      };

      // Ưu tiên dữ liệu kê khai thực địa nếu thửa này đã kê khai trên web (và tên không phải là giới tính)
      if (savedDecl) {
        if (savedDecl.chu_dat_ten && !isInvalidName(savedDecl.chu_dat_ten)) chu_ho = savedDecl.chu_dat_ten;
        if (savedDecl.chu_dat_cccd) cccd = savedDecl.chu_dat_cccd;
      }

      if (ggsInfo?.chu_ho && !isInvalidName(ggsInfo.chu_ho)) {
        chu_ho = ggsInfo.chu_ho;
      } else if (isInvalidName(chu_ho)) {
        chu_ho = 'Không có trong dữ liệu';
      }

      // XÁC ĐỊNH TRẠNG THÁI THỬA ĐẤT:
      // 1. Thửa ĐÃ SỐ HÓA (có trên Google Sheets hoặc cccd đã đóng tập) -> Xanh lá
      // 2. Thửa ĐÃ KÊ KHAI (vừa kê khai trên web, chưa số hóa lên GGS) -> Xanh lam
      // 3. Thửa CHƯA KÊ KHAI CÓ TÊN (tên người thật) -> Vàng
      // 4. Thửa CHƯA KÊ KHAI CHƯA CÓ TÊN (không phải tên người, địa danh, công cộng...) -> Trắng
      let trang_thai: ParcelStatus;
      if (isOnGgs || p.trang_thai === 'DA_SO_HOA_XANH') {
        trang_thai = 'DA_SO_HOA_XANH';
      } else if (isLocallyDeclared) {
        trang_thai = 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
      } else if (isPersonName(chu_ho)) {
        trang_thai = 'CO_TEN_CHUA_SO_HOA_VANG';
      } else {
        trang_thai = 'CHUA_CO_TEN_XAM';
      }

      if (ggsInfo?.cccd && ggsInfo.cccd.length >= 9) {
        cccd = ggsInfo.cccd;
      }

      let dien_tich = p.dien_tich ? String(p.dien_tich) : '';
      if ((!dien_tich || dien_tich.startsWith('w6jp')) && ggsInfo?.dien_tich) {
        dien_tich = String(ggsInfo.dien_tich);
      } else if (dien_tich?.startsWith('w6jp')) {
        dien_tich = '';
      }

      let loai_dat = p.loai_dat ? String(p.loai_dat) : '';
      if ((!loai_dat || loai_dat.includes('http') || loai_dat.startsWith('w6jp')) && ggsInfo?.loai_dat) {
        loai_dat = String(ggsInfo.loai_dat);
      } else if (loai_dat?.includes('http') || loai_dat?.startsWith('w6jp')) {
        loai_dat = '';
      }

      return {
        ...p,
        chu_ho,
        cccd,
        dien_tich,
        loai_dat,
        trang_thai,
        is_on_ggs: isOnGgs || p.trang_thai === 'DA_SO_HOA_XANH',
        is_declared: isLocallyDeclared,
      };
    });
  }, [parcels, ggsCodes, ggsParcelsMap, declaredParcelCodes, declarationsMap, isGgsLoaded]);

  // Cập nhật selectedParcel khi computedParcels thay đổi
  useEffect(() => {
    if (selectedParcel) {
      const updated = computedParcels.find((p) => p.ma_thua === selectedParcel.ma_thua);
      if (
        updated &&
        (updated.trang_thai !== selectedParcel.trang_thai ||
          updated.chu_ho !== selectedParcel.chu_ho ||
          updated.cccd !== selectedParcel.cccd)
      ) {
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
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'CHUA_KE_KHAI') {
          if (p.trang_thai === 'DA_SO_HOA_XANH' || p.trang_thai === 'DA_KE_KHAI_CHUA_SO_HOA_LAM') return false;
        } else if (p.trang_thai !== statusFilter) {
          return false;
        }
      }

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

  // 1. Danh sách các thửa đất cùng chủ CHÍNH XÁC theo CCCD (duy nhất) - Loại bỏ các thửa đã chọn gộp
  const sameCccdParcels = useMemo(() => {
    if (!selectedParcel || !selectedParcel.cccd || selectedParcel.cccd.trim().length < 9) {
      return [];
    }
    const cleanCccd = selectedParcel.cccd.trim();
    const additionalCodes = new Set(additionalParcels.map((ap) => ap.ma_thua));
    return computedParcels.filter(
      (p) =>
        p.ma_thua !== selectedParcel.ma_thua &&
        !additionalCodes.has(p.ma_thua) &&
        p.cccd &&
        p.cccd.trim() === cleanCccd
    );
  }, [selectedParcel, computedParcels, additionalParcels]);

  // 2. Danh sách các thửa đất khác có cùng Tên (trừ các thửa đã trùng CCCD) - "Có thể chủ hộ này còn sở hữu" - Loại bỏ các thửa đã chọn gộp
  const sameNameParcels = useMemo(() => {
    const nonPersonPlaceholders = [
      'Chưa có tên',
      'Không có tên',
      'Không có dữ liệu',
      'Không có dữ liệu cập nhật',
      'Không có trong dữ liệu',
      'Không có trong SMK',
      'Hồ Ea Rớt',
      'UBND xã',
      'UBND xã Cư Pui',
      'Ông ..',
      'Bà ..',
      '..',
    ];

    if (
      !selectedParcel ||
      !selectedParcel.chu_ho ||
      nonPersonPlaceholders.some((np) => selectedParcel.chu_ho.toLowerCase().includes(np.toLowerCase()))
    ) {
      return [];
    }
    const cleanOwner = selectedParcel.chu_ho.trim().toLowerCase();
    const cccdMatchedCodes = new Set(sameCccdParcels.map((p) => p.ma_thua));
    const additionalCodes = new Set(additionalParcels.map((ap) => ap.ma_thua));

    return computedParcels.filter(
      (p) =>
        p.ma_thua !== selectedParcel.ma_thua &&
        !additionalCodes.has(p.ma_thua) &&
        !cccdMatchedCodes.has(p.ma_thua) &&
        p.chu_ho &&
        !nonPersonPlaceholders.some((np) => p.chu_ho.toLowerCase().includes(np.toLowerCase())) &&
        p.chu_ho.trim().toLowerCase() === cleanOwner
    );
  }, [selectedParcel, computedParcels, sameCccdParcels, additionalParcels]);

  const sameOwnerParcels = useMemo(() => {
    return [...sameCccdParcels, ...sameNameParcels];
  }, [sameCccdParcels, sameNameParcels]);

  const handleSelectParcel = (p: Parcel) => {
    const latest = computedParcels.find((cp) => cp.ma_thua === p.ma_thua) || p;

    // Tìm thửa lân cận: luôn cập nhật mạng lưới xung quanh thửa vừa bấm để người dùng quan sát
    const nbs = findNearbyParcels(latest, computedParcels, 450, 12);
    setNeighborParcels(nbs);

    // Nếu đang trong chế độ chọn thêm thửa đất vào chung phiếu kê khai
    if (isPickingAdditional) {
      if (selectedParcel && latest.ma_thua === selectedParcel.ma_thua) {
        setPickToast(`Thửa ${latest.so_thua} là thửa gốc đang kê khai`);
        setTimeout(() => setPickToast(null), 2500);
        return;
      }

      setAdditionalParcels((prev) => {
        const exists = prev.some((ap) => ap.ma_thua === latest.ma_thua);
        if (exists) {
          setPickToast(`Đã bỏ Thửa ${latest.so_thua} (Tờ ${latest.to_ban_do}) khỏi phiếu`);
          setTimeout(() => setPickToast(null), 2500);
          return prev.filter((ap) => ap.ma_thua !== latest.ma_thua);
        } else {
          setPickToast(`✓ Đã thêm Thửa ${latest.so_thua} (Tờ ${latest.to_ban_do}) vào phiếu`);
          setTimeout(() => setPickToast(null), 2500);
          return [
            ...prev,
            {
              ma_thua: latest.ma_thua,
              so_thua: latest.so_thua,
              to_ban_do: latest.to_ban_do,
              dien_tich: latest.dien_tich,
              loai_dat: latest.loai_dat,
              thon_xa: latest.thon_xa,
              nguon_goc: 'Khai hoang',
            },
          ];
        }
      });
      return;
    }

    const savedDecl = declarationsMap[latest.ma_thua];
    if (savedDecl?.thua_kem_theo && Array.isArray(savedDecl.thua_kem_theo)) {
      setAdditionalParcels(savedDecl.thua_kem_theo);
    } else {
      setAdditionalParcels([]);
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setSelectedParcel(latest);
    setIsPanelCollapsed(false);
    setIsCccdUploadOpen(false);

    // Kích hoạt animation trượt vào mượt mà
    requestAnimationFrame(() => {
      setIsPanelOpen(true);
    });

    if (window.innerWidth < 1024 && panelRef.current) {
      setTimeout(() => {
        panelRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    }
  };

  const handleClosePanel = () => {
    setIsPanelOpen(false);
    setIsPanelCollapsed(false);
    setIsPickingAdditional(false);
    // Đợi hiệu ứng trượt ra (300ms) kết thúc mới dọn dẹp dữ liệu
    closeTimerRef.current = setTimeout(() => {
      setSelectedParcel(null);
      setAdditionalParcels([]);
      closeTimerRef.current = null;
    }, 320);
  };

  // Kích hoạt / lấy lại vị trí GPS
  const handleToggleLocation = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      alert('Trình duyệt hoặc thiết bị của bạn không hỗ trợ định vị GPS.');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setIsLocating(true);
    setPickToast('Đang kết nối vị trí GPS...');
    let notifiedOnce = false;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading: gpsHeading, speed } = pos.coords;
        setUserLocation((prev) => {
          if (
            prev &&
            notifiedOnce &&
            Math.abs(prev.lat - latitude) < 0.000011 &&
            Math.abs(prev.lng - longitude) < 0.000011
          ) {
            return prev;
          }
          return {
            lat: latitude,
            lng: longitude,
            accuracy: Math.round(accuracy),
            heading: typeof gpsHeading === 'number' && !isNaN(gpsHeading) ? Math.round(gpsHeading) : prev?.heading,
            speed: typeof speed === 'number' && !isNaN(speed) ? Math.round(speed * 3.6) : null,
          };
        });
        setIsTracking(true);
        setIsLocating(false);
        if (!notifiedOnce) {
          notifiedOnce = true;
          setPickToast('✓ Đã bật định vị bám theo di chuyển');
          setTimeout(() => setPickToast(null), 2200);
        }
      },
      (err) => {
        console.warn('Lỗi định vị GPS:', err.message);
        setIsLocating(false);
        let msg = 'Không thể lấy vị trí GPS';
        if (err.code === 1) {
          msg = 'Vui lòng cấp quyền truy cập vị trí (GPS) cho trang web này';
        }
        setPickToast(`⚠️ ${msg}`);
        setTimeout(() => setPickToast(null), 3500);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 2000,
      }
    );

    watchIdRef.current = watchId;
  }, []);

  // Tự động chọn thửa nếu có query params (từ Dashboard chuyển sang: ?to=4&thua=154 hoặc ?ma_thua=...)
  useEffect(() => {
    if (typeof window === 'undefined' || hasHandledUrlQueryRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const qMaThua = params.get('ma_thua');
    const qTo = params.get('to');
    const qThua = params.get('thua');

    if (qMaThua || (qTo && qThua)) {
      const found = computedParcels.find((p) => {
        if (qMaThua && p.ma_thua === qMaThua) return true;
        if (qTo && qThua && p.to_ban_do === qTo && p.so_thua === qThua) return true;
        return false;
      });
      if (found) {
        hasHandledUrlQueryRef.current = true;
        handleSelectParcel(found);
      }
    }
  }, [computedParcels]);

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
      const { updatedCodes, updatedMap } = saveOrUpdateDeclaration(formData);
      lastCloudSigRef.current = JSON.stringify({ codes: updatedCodes, map: updatedMap });
      setDeclaredParcelCodes(new Set(updatedCodes));
      setDeclarationsMap(updatedMap);
      setIsPickingAdditional(false);

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

      setPickToast('✓ Đang đồng bộ phiếu kê khai lên máy chủ...');

      // Gửi đồng bộ lên Cloudflare R2
      fetch('/api/declarations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
        .then(async (res) => {
          if (res.ok) {
            const result = (await res.json()) as any;
            if (result.success && Array.isArray(result.declaredCodes)) {
              const cloudMap = result.declarationsMap || {};
              lastCloudSigRef.current = JSON.stringify({ codes: result.declaredCodes, map: cloudMap });
              setDeclaredParcelCodes(new Set(result.declaredCodes));
              if (result.declarationsMap) {
                setDeclarationsMap(result.declarationsMap);
              }
            }
            setPickToast('✓ Đã đồng bộ lên máy chủ thành công');
            setTimeout(() => setPickToast(null), 3000);

            // Cập nhật trạng thái công việc của cán bộ: Vừa kê khai xong thửa đất
            if (userLocation) {
              reportCadreLocation({
                lat: userLocation.lat,
                lng: userLocation.lng,
                accuracy: userLocation.accuracy,
                speed: userLocation.speed,
                heading: userLocation.heading,
                action: `Kê khai thửa ${formData.ma_thua}`,
                force: true,
              }).catch(() => {});
            }
          } else {
            console.warn('Đồng bộ cloud trả về mã lỗi:', res.status);
            setPickToast('✓ Đã lưu trên máy (Cloud sẽ đồng bộ sau)');
            setTimeout(() => setPickToast(null), 3500);
          }
        })
        .catch((err) => {
          console.warn('Lỗi kết nối khi đồng bộ lên Cloud:', err);
          setPickToast('✓ Đã lưu trên máy (Đang chờ kết nối)');
          setTimeout(() => setPickToast(null), 3500);
        });
    }
  };

  const handleDeleteDeclaration = (targetMaThua: string) => {
    const { removedCodes, updatedCodes, updatedMap } = removeDeclaration(targetMaThua);
    lastCloudSigRef.current = JSON.stringify({ codes: updatedCodes, map: updatedMap });
    setDeclaredParcelCodes(new Set(updatedCodes));
    setDeclarationsMap(updatedMap);
    setAdditionalParcels([]);
    setIsPickingAdditional(false);

    // Khôi phục selectedParcel nếu đang chọn thuộc nhóm bị xóa
    if (selectedParcel && removedCodes.includes(selectedParcel.ma_thua)) {
      const original = parcels.find((p) => p.ma_thua === selectedParcel.ma_thua);
      if (original) {
        const isOnGgs = ggsCodes.has(original.ma_thua) || original.trang_thai === 'DA_SO_HOA_XANH';
        setSelectedParcel({
          ...original,
          trang_thai: isOnGgs ? 'DA_SO_HOA_XANH' : (original.trang_thai as ParcelStatus),
          is_declared: false,
        });
      }
    }

    setPickToast('✓ Đang xóa trên máy chủ...');
    fetch(`/api/declarations?ma_thua=${encodeURIComponent(targetMaThua)}`, {
      method: 'DELETE',
    })
      .then(async (res) => {
        if (res.ok) {
          const result = (await res.json()) as any;
          if (result.success && Array.isArray(result.declaredCodes)) {
            const cloudMap = result.declarationsMap || {};
            lastCloudSigRef.current = JSON.stringify({ codes: result.declaredCodes, map: cloudMap });
            setDeclaredParcelCodes(new Set(result.declaredCodes));
            if (result.declarationsMap) {
              setDeclarationsMap(result.declarationsMap);
            }
          }
          setPickToast('✓ Đã xóa phiếu kê khai thành công');
        } else {
          setPickToast('✓ Đã xóa cục bộ trên máy');
        }
        setTimeout(() => setPickToast(null), 3000);
      })
      .catch((err) => {
        console.warn('Lỗi kết nối khi xóa trên Cloud:', err);
        setPickToast('✓ Đã xóa cục bộ trên máy');
        setTimeout(() => setPickToast(null), 3000);
      });
  };

  return (
    <main className="h-screen w-screen overflow-hidden relative bg-slate-900 text-gray-900">
      {/* Main Content Area: Bản Đồ Vệ Tinh Toàn Màn Hình */}
      <div className="w-full h-full relative overflow-hidden">
            {/* Form chi tiết: Trượt từ trái qua (Desktop) hoặc từ dưới lên (Mobile); Có thể thu gọn qua trái (Desktop) hoặc xuống dưới (Mobile) */}
            <div
              ref={panelRef}
              className={`absolute z-30 bg-white transition-all duration-300 ease-in-out shadow-2xl overflow-hidden ${
                isPanelOpen && selectedParcel
                  ? isPanelCollapsed
                    ? 'w-full lg:w-[420px] h-[65vh] max-h-[85vh] lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-0 translate-y-full lg:-translate-x-full border-0 pointer-events-none'
                    : 'w-full lg:w-[420px] h-[65vh] max-h-[85vh] lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-100 translate-y-0 lg:translate-x-0 rounded-t-3xl lg:rounded-none border-t lg:border-t-0 lg:border-r border-gray-200 pointer-events-auto'
                  : 'w-full lg:w-0 h-0 lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-0 translate-y-full lg:-translate-x-full border-0 pointer-events-none'
              }`}
            >
              <div className="w-full lg:w-[420px] h-full flex flex-col">
                {selectedParcel && (
                  <ParcelDetailPanel
                    parcel={selectedParcel}
                    neighbors={neighborParcels}
                    allParcels={computedParcels}
                    sameCccdParcels={sameCccdParcels}
                    sameNameParcels={sameNameParcels}
                    sameOwnerParcels={sameOwnerParcels}
                    additionalParcels={additionalParcels}
                    isPickingAdditional={isPickingAdditional}
                    onStartPickAdditional={handleTogglePickAdditional}
                    onAddAdditionalParcel={handleAddAdditionalParcel}
                    onRemoveAdditionalParcel={handleRemoveAdditionalParcel}
                    onSelectParcel={handleSelectParcel}
                    onClose={handleClosePanel}
                    onOpenVectorViewer={handleOpenVectorViewer}
                    onSaveDeclaration={handleSaveDeclaration}
                    onDeleteDeclaration={handleDeleteDeclaration}
                    currentDeclaration={selectedParcel ? declarationsMap[selectedParcel.ma_thua] : undefined}
                    userLocation={userLocation}
                    onToggleLocation={handleToggleLocation}
                    onToggleCollapse={() => setIsPanelCollapsed((prev) => !prev)}
                  />
                )}
              </div>
            </div>

            {/* Nút mở lại bảng chi tiết khi đang thu gọn trên Desktop (nằm ở mép trái bản đồ) */}
            {isPanelOpen && selectedParcel && isPanelCollapsed && (
              <button
                type="button"
                onClick={() => setIsPanelCollapsed(false)}
                className="absolute top-20 left-0 z-30 hidden lg:flex items-center gap-1.5 bg-white/95 backdrop-blur-md text-slate-800 hover:text-blue-600 hover:bg-blue-50 px-3 py-2.5 rounded-r-2xl shadow-2xl border-y border-r border-gray-200 font-bold text-xs transition-all active:scale-95 cursor-pointer animate-in slide-in-from-left duration-200"
                title="Mở lại bảng chi tiết thửa đất"
              >
                <ChevronRight className="w-4 h-4 text-blue-600" />
                <span>Thửa {selectedParcel.so_thua} (Tờ {selectedParcel.to_ban_do})</span>
              </button>
            )}

            {/* Nút mở lại bảng chi tiết khi đang thu gọn trên Điện thoại (nằm ở đáy màn hình) */}
            {isPanelOpen && selectedParcel && isPanelCollapsed && (
              <button
                type="button"
                onClick={() => setIsPanelCollapsed(false)}
                className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 lg:hidden flex items-center gap-2 bg-white/95 backdrop-blur-md text-slate-800 px-4 py-2.5 rounded-full shadow-2xl border border-gray-200 font-extrabold text-xs transition-all active:scale-95 cursor-pointer animate-in slide-in-from-bottom duration-200"
                title="Mở lại bảng chi tiết thửa đất"
              >
                <ChevronUp className="w-4 h-4 text-blue-600 animate-bounce" />
                <span>Xem Thửa {selectedParcel.so_thua} • Tờ {selectedParcel.to_ban_do}</span>
              </button>
            )}

            {/* Banner nổi khi đang trong chế độ chọn thêm thửa đất gộp */}
            {isPickingAdditional && (
              <div className="absolute top-3 sm:top-5 left-1/2 -translate-x-1/2 z-40 bg-gradient-to-r from-amber-600 to-orange-600 text-white px-4 py-2.5 rounded-2xl shadow-2xl border-2 border-amber-300 flex items-center gap-3 backdrop-blur-md animate-in slide-in-from-top duration-200">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
                  <span className="text-xs font-black tracking-wide">
                    ĐANG CHỌN THỬA TRÊN BẢN ĐỒ ({additionalParcels.length} thửa kèm theo)
                  </span>
                </div>
                <span className="text-[11px] text-amber-100 hidden md:inline">
                  • Nhấp vào thửa trên bản đồ để thêm hoặc bỏ
                </span>
                <button
                  type="button"
                  onClick={() => setIsPickingAdditional(false)}
                  className="px-3 py-1 bg-white hover:bg-amber-50 text-amber-900 rounded-xl text-xs font-black shadow-sm transition cursor-pointer"
                >
                  Xong / Xem phiếu
                </button>
              </div>
            )}

            {/* Toast thông báo nhanh khi chọn/bỏ thửa */}
            {pickToast && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white border border-slate-700/80 px-4 py-2 rounded-xl shadow-2xl text-xs font-bold animate-in fade-in flex items-center gap-2 backdrop-blur-md">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{pickToast}</span>
              </div>
            )}

            {/* Cụm button điều khiển nổi: Trạng thái, Realtime GGS & Tìm kiếm (Tự động trượt lên ẩn khỏi khung hình khi chọn thửa) */}
            <div
              className={`absolute top-2.5 sm:top-3.5 z-20 flex flex-col gap-1.5 sm:gap-2 transition-all duration-300 ease-in-out left-2.5 right-2.5 lg:left-3.5 lg:right-auto ${
                isPanelOpen && selectedParcel
                  ? '-translate-y-[170%] opacity-0 pointer-events-none'
                  : 'translate-y-0 opacity-100 pointer-events-auto'
              }`}
            >

              {/* Row 1: Các button trạng thái: Tất cả, Đã số hóa (Xanh lá), Đã kê khai (Xanh lam), Có tên (Vàng), Chưa có tên (Trắng) */}
              <div className="flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-md p-1 rounded-2xl border border-slate-700/60 shadow-xl overflow-x-auto no-scrollbar w-full sm:w-fit max-w-full">
                <button
                  onClick={() => {
                    setStatusFilter('ALL');
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

                {/* Có tên (Màu vàng) */}
                <button
                  onClick={() => {
                    setStatusFilter(statusFilter === 'CO_TEN_CHUA_SO_HOA_VANG' ? 'ALL' : 'CO_TEN_CHUA_SO_HOA_VANG');
                  }}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl font-bold transition text-xs shrink-0 ${
                    statusFilter === 'CO_TEN_CHUA_SO_HOA_VANG'
                      ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-300'
                      : 'bg-slate-800/80 text-amber-300 hover:bg-slate-700/80 border border-amber-500/30'
                  }`}
                  title="Thửa chưa kê khai có tên người (màu vàng trên bản đồ)"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-200"></span>
                  Có tên ({stats.yellow.toLocaleString('vi-VN')})
                </button>

                {/* Không có tên (Màu trắng) */}
                <button
                  onClick={() => {
                    setStatusFilter(statusFilter === 'CHUA_CO_TEN_XAM' ? 'ALL' : 'CHUA_CO_TEN_XAM');
                  }}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl font-bold transition text-xs shrink-0 ${
                    statusFilter === 'CHUA_CO_TEN_XAM'
                      ? 'bg-slate-200 text-slate-900 shadow-sm ring-2 ring-white'
                      : 'bg-slate-800/80 text-white hover:bg-slate-700/80 border border-slate-600/50'
                  }`}
                  title="Thửa chưa kê khai không có tên người, địa danh (màu trắng trên bản đồ)"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-white ring-1 ring-slate-400 shadow-sm"></span>
                  Không tên ({stats.gray.toLocaleString('vi-VN')})
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
                  }}
                />

                {(searchQuery || selectedSheets.length > 0 || statusFilter !== 'ALL') && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedSheets([]);
                      setStatusFilter('ALL');
                    }}
                    className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition font-medium shrink-0"
                    title="Khôi phục mặc định"
                  >
                    Đặt lại
                  </button>
                )}

                {/* Nút mở Dashboard quản trị & tiến độ (Ẩn trên điện thoại) */}
                <Link
                  href="/dashboard"
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 text-xs bg-slate-900 hover:bg-slate-800 text-cyan-300 font-bold rounded-xl transition shrink-0 border border-cyan-500/40 shadow-xs"
                  title="Mở Dashboard thống kê & tiến độ số hóa"
                >
                  <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="hidden xs:inline">Dashboard</span>
                </Link>

                {/* Nút mở công cụ Tách PDF & CCCD ScanName (Ẩn trên điện thoại) */}
                <a
                  href="/scanname"
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 text-xs bg-indigo-950 hover:bg-indigo-900 text-indigo-300 font-bold rounded-xl transition shrink-0 border border-indigo-500/40 shadow-xs"
                  title="Mở công cụ Tách PDF & Quét CCCD ScanName"
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="hidden xs:inline">Tách PDF</span>
                </a>

                {/* Nút Tải Lên CCCD (Trượt form dưới lên như khi nhấn vào thửa đất) */}
                <button
                  type="button"
                  onClick={() => {
                    setIsPanelOpen(false);
                    setIsCccdUploadOpen(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-purple-950 hover:bg-purple-900 text-purple-300 font-bold rounded-xl transition shrink-0 border border-purple-500/40 shadow-xs cursor-pointer"
                  title="Tải lên ảnh CCCD từ máy (trượt form từ dưới lên)"
                >
                  <Camera className="w-3.5 h-3.5 text-purple-400" />
                  <span className="hidden xs:inline">Tải Lên CCCD</span>
                </button>

                {/* Nút Xuất DS Cần Thu Thập CCCD (Dạng ảnh 16:9 Dọc) */}
                <button
                  type="button"
                  onClick={() => setIsExportMissingCccdOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-rose-950 hover:bg-rose-900 text-rose-300 font-bold rounded-xl transition shrink-0 border border-rose-500/40 shadow-xs cursor-pointer"
                  title="Xuất ảnh danh sách cần thu thập CCCD (Tỷ lệ 16:9 dọc có 2 cột)"
                >
                  <Users className="w-3.5 h-3.5 text-rose-400" />
                  <span className="hidden xs:inline">Cần Thu CCCD</span>
                </button>

                {/* Nút Chế độ Đút Túi Quần (Khóa màn hình vẫn theo dõi qua Audio Keep-Alive) */}
                <button
                  type="button"
                  onClick={togglePocketMode}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-xl transition shrink-0 border shadow-xs cursor-pointer ${
                    isPocketMode
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-emerald-900/50'
                      : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                  title={
                    isPocketMode
                      ? 'Chế độ Đút túi quần ĐANG BẬT: Bạn có thể khóa màn hình, điện thoại vẫn liên tục gửi GPS về Dashboard'
                      : 'Bấm để bật chế độ Đút túi quần (Khóa màn hình vẫn theo dõi GPS realtime)'
                  }
                >
                  <Headphones className={`w-3.5 h-3.5 ${isPocketMode ? 'text-white animate-pulse' : 'text-slate-400'}`} />
                  <span className="hidden xs:inline">
                    {isPocketMode ? 'Đút túi: BẬT' : 'Đút túi: TẮT'}
                  </span>
                </button>

                {/* Nút Hiển Thị / Đổi Tên Người Kê Khai */}
                <button
                  type="button"
                  onClick={() => setIsCadreModalOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 font-bold rounded-xl transition shrink-0 border border-emerald-500/40 shadow-xs cursor-pointer"
                  title="Bấm để đổi tên người kê khai (Đang kết nối GPS trực tuyến)"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden xs:inline">{cadreName || 'Người kê khai'}</span>
                </button>
              </div>
            </div>

            {/* Chỉ báo nạp cơ sở dữ liệu thửa đất bất đồng bộ */}
            {isLoadingParcels && (
              <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-slate-950/90 text-white border border-blue-500/40 px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-2.5 backdrop-blur-md animate-in fade-in">
                <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
                <span className="text-xs font-semibold text-slate-200">Đang nạp 11.280 thửa đất xã Cư Pui...</span>
              </div>
            )}

            {/* Bản đồ Leaflet phủ 100% diện tích màn hình */}
            <CadastralMap
              parcels={filteredParcels}
              onSelectParcel={handleSelectParcel}
              selectedParcel={selectedParcel}
              additionalParcels={additionalParcels}
              neighborParcels={neighborParcels}
              userLocation={userLocation}
              isTracking={isTracking}
              isLocating={isLocating}
              onToggleLocation={handleToggleLocation}
            />
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

      {/* Bottom Sheet Tải Lên CCCD (Trượt từ dưới lên như khi nhấn vào thửa đất) */}
      <CccdUploadBottomSheet
        isOpen={isCccdUploadOpen}
        onClose={() => setIsCccdUploadOpen(false)}
        onSuccess={() => {
          fetchCloudDeclarations();
          fetchGgsCodes(true);
        }}
      />

      {/* Modal Tải Lên CCCD Hàng Loạt & Thư Mục (AI Quét & Lưu R2) */}
      <CccdSupplementModal
        isOpen={isCccdModalOpen}
        onClose={() => setIsCccdModalOpen(false)}
        defaultMode="folder"
        onSuccess={() => {
          fetchCloudDeclarations();
          fetchGgsCodes(true);
        }}
      />

      {/* Modal Xuất Danh Sách Cần Thu Thập CCCD Dạng Ảnh 16:9 Dọc */}
      <ExportMissingCccdModal
        isOpen={isExportMissingCccdOpen}
        onClose={() => setIsExportMissingCccdOpen(false)}
        parcels={parcels}
        declarationsMap={declarationsMap}
        theme="dark"
      />

      {/* Modal Nhập / Đổi Tên Cán Bộ Kê Khai */}
      <CadreNameModal
        isOpen={isCadreModalOpen}
        onClose={() => {
          setIsCadreModalOpen(false);
          setIsFirstTimeCadre(false);
        }}
        onSaved={async (newName) => {
          setCadreName(newName);
          setIsFirstTimeCadre(false);

          // 1. Chế độ đút túi quần luôn bật (mặc định)
          setIsPocketMode(true);
          await backgroundKeeper.start(newName);

          // 2. Yêu cầu bật vị trí GPS ngay lập tức sau khi nhập tên
          if (typeof window !== 'undefined' && navigator.geolocation) {
            setPickToast('📍 Đang kích hoạt định vị GPS thực địa...');
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const { latitude, longitude, accuracy, speed, heading } = pos.coords;
                const spd = typeof speed === 'number' && !isNaN(speed) ? Math.round(speed * 3.6) : null;
                setUserLocation({
                  lat: latitude,
                  lng: longitude,
                  accuracy: Math.round(accuracy),
                  heading: typeof heading === 'number' && !isNaN(heading) ? Math.round(heading) : null,
                  speed: spd,
                });
                setIsTracking(true);
                setIsLocating(false);

                // Phát sóng tọa độ GPS ngay lập tức lên Dashboard
                reportCadreLocation({
                  lat: latitude,
                  lng: longitude,
                  accuracy: Math.round(accuracy),
                  speed: spd,
                  heading: typeof heading === 'number' && !isNaN(heading) ? Math.round(heading) : null,
                  action: 'Bắt đầu làm việc thực địa',
                  force: true,
                }).catch(() => {});

                setPickToast(`🟢 Đã kích hoạt GPS & Chế độ Đút túi quần (khóa màn hình vẫn theo dõi)!`);
                setTimeout(() => setPickToast(null), 5000);
              },
              (err) => {
                console.warn('Lỗi định vị sau khi nhập tên:', err);
                if (err.code === 1) {
                  alert('⚠️ Vui lòng cấp quyền "Cho phép truy cập vị trí" để hệ thống theo dõi GPS thực địa.');
                }
                setPickToast('⚠️ Vui lòng bật vị trí GPS trên máy để gửi tọa độ về Dashboard');
                setTimeout(() => setPickToast(null), 5000);
              },
              {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
              }
            );
          }
        }}
        isFirstTime={isFirstTimeCadre}
        theme="dark"
      />
    </main>
  );
}
