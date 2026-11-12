'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Parcel, ParcelStatus, NeighborParcel, DeclarationFormData, AdditionalParcel } from '@/types';
import ParcelDetailPanel from '@/components/ParcelDetailPanel';
import VectorViewerModal from '@/components/VectorViewerModal';
import CccdSupplementModal from '@/components/CccdSupplementModal';
import CccdUploadBottomSheet from '@/components/CccdUploadBottomSheet';
import CccdCollectPanel from '@/components/CccdCollectPanel';
import CadreNameModal from '@/components/CadreNameModal';
import { findNearbyParcels, removeVietnameseTones, calculateDistanceMeters, formatDistance } from '@/utils/geo';
import { isPersonName, cleanStrictName, stripAccents, isAgriculturalLand, isExcludedLandType, isOntLand, isGcnOntRoute, cleanVillageDisplay, getCanonicalVillage, cleanCccd, cleanName } from '@/utils/textHelpers';
import {
  applyDeclarationToState,
  removeDeclarationFromState,
  clearLegacyLocalDataStorage,
  getSavedCadreName,
} from '@/utils/declaration';
import { reportCadreLocation } from '@/utils/cadreTracker';
import { backgroundKeeper } from '@/utils/backgroundLocationKeeper';
import { broadcastRealtimeEvent, onRealtimeEvent } from '@/utils/realtimeSync';
import hiddenParcelsData from '@/data/hidden_parcels.json';
import digitizedParcelsData from '@/data/digitized_parcels.json';
const HIDDEN_PARCEL_SET = new Set(hiddenParcelsData as string[]);
const DIGITIZED_SET = new Set(digitizedParcelsData as string[]);
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
  Cloud,
  CheckCircle2,
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
  const ALL_STATUS_KEYS: ParcelStatus[] = [
    'DA_SO_HOA_XANH',
    'DA_KE_KHAI_CHUA_SO_HOA_LAM',
    'CO_TEN_CHUA_SO_HOA_VANG',
    'CHUA_CO_TEN_XAM',
  ];
  const [selectedStatuses, setSelectedStatuses] = useState<Set<ParcelStatus>>(new Set());

  const isAllStatusesSelected = selectedStatuses.size === 0 || selectedStatuses.size === ALL_STATUS_KEYS.length;

  const toggleStatusFilter = (st: ParcelStatus) => {
    setSelectedStatuses((prev) => {
      // Nếu đang hiển thị Tất cả (size = 0 hoặc size = 4), click vào 1 loại -> chuyển sang chỉ chọn loại đó
      if (prev.size === 0 || prev.size === ALL_STATUS_KEYS.length) {
        return new Set([st]);
      }
      const next = new Set(prev);
      if (next.has(st)) {
        next.delete(st);
        // Nếu đã bỏ chọn hết -> tự động về Tất cả
        return next;
      } else {
        next.add(st);
        // Nếu đã chọn đủ cả 4 loại -> về Tất cả
        if (next.size === ALL_STATUS_KEYS.length) {
          return new Set();
        }
        return next;
      }
    });
  };

  const selectAllStatuses = () => {
    setSelectedStatuses(new Set());
  };

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
  // Danh sách các thửa đã kê khai trực tiếp từ Database (Cloudflare D1)
  const [declaredParcelCodes, setDeclaredParcelCodes] = useState<Set<string>>(new Set());
  const [declarationsMap, setDeclarationsMap] = useState<Record<string, any>>({});
  const [cellEdits, setCellEdits] = useState<Record<string, Record<number, string>>>({});
  const declaredCodesRef = useRef<Set<string>>(new Set());
  const declarationsMapRef = useRef<Record<string, any>>({});
  useEffect(() => {
    declaredCodesRef.current = declaredParcelCodes;
  }, [declaredParcelCodes]);
  useEffect(() => {
    declarationsMapRef.current = declarationsMap;
  }, [declarationsMap]);
  const [isExportMissingCccdOpen, setIsExportMissingCccdOpen] = useState(false);
  const [isCccdSplitView, setIsCccdSplitView] = useState(false);

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

  const isFetchingCloudRef = useRef(false);
  const lastCloudFetchTimeRef = useRef(0);
  const lastCloudEtagRef = useRef<string | null>(null);

  // Tải danh sách đã kê khai trực tiếp từ Database (Cloudflare D1), không gộp cache cũ trình duyệt
  const fetchCloudDeclarations = useCallback(async (force = false) => {
    const now = Date.now();
    if (isFetchingCloudRef.current || (!force && now - lastCloudFetchTimeRef.current < 2500)) {
      return;
    }
    isFetchingCloudRef.current = true;
    lastCloudFetchTimeRef.current = now;
    try {
      const headers: Record<string, string> = {};
      if (lastCloudEtagRef.current && !force) {
        headers['If-None-Match'] = lastCloudEtagRef.current;
      }

      const res = await fetch('/api/declarations', { headers, cache: 'no-store' });

      if (res.status === 304) {
        return;
      }

      if (res.ok) {
        const etag = res.headers.get('ETag');
        if (etag) lastCloudEtagRef.current = etag;

        const text = await res.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          return;
        }

        if (data && data.success && Array.isArray(data.declaredCodes)) {
          const cloudCodesSet = new Set<string>(data.declaredCodes);
          const cloudMap: Record<string, any> =
            data.declarationsMap && typeof data.declarationsMap === 'object' ? data.declarationsMap : {};
          const cloudEdits: Record<string, Record<number, string>> =
            data.cellEdits && typeof data.cellEdits === 'object' ? data.cellEdits : {};

          const sig = JSON.stringify({
            codes: data.declaredCodes,
            map: cloudMap,
            edits: cloudEdits,
          });

          if (sig !== lastCloudSigRef.current || force) {
            lastCloudSigRef.current = sig;
            declaredCodesRef.current = cloudCodesSet;
            declarationsMapRef.current = cloudMap;
            setDeclaredParcelCodes(cloudCodesSet);
            setDeclarationsMap(cloudMap);
            setCellEdits(cloudEdits);
          }

          if (data.updatedAt) lastCloudUpdatedAtRef.current = data.updatedAt;

          setSelectedParcel((curr) => {
            if (!curr) return null;
            if (cloudCodesSet.has(curr.ma_thua)) {
              const decl = cloudMap[curr.ma_thua];
              const isOnGgs = DIGITIZED_SET.has(curr.ma_thua) || ggsCodes.has(curr.ma_thua);
              return {
                ...curr,
                chu_ho: decl?.chu_dat_ten !== undefined ? decl.chu_dat_ten : curr.chu_ho,
                cccd: decl?.chu_dat_cccd !== undefined ? decl.chu_dat_cccd : curr.cccd,
                is_declared: true,
                trang_thai: isOnGgs ? 'DA_SO_HOA_XANH' : 'DA_KE_KHAI_CHUA_SO_HOA_LAM',
              };
            }
            if (curr.is_declared && !DIGITIZED_SET.has(curr.ma_thua)) {
              const isOnGgs = ggsCodes.has(curr.ma_thua);
              return {
                ...curr,
                is_declared: false,
                trang_thai: isOnGgs
                  ? 'DA_SO_HOA_XANH'
                  : curr.chu_ho
                  ? 'CO_TEN_CHUA_SO_HOA_VANG'
                  : 'CHUA_CO_TEN_XAM',
              };
            }
            return curr;
          });
        }
      }
    } catch (err) {
      console.warn('Lỗi khi tải dữ liệu Database từ cloud:', err);
    } finally {
      isFetchingCloudRef.current = false;
    }
  }, [ggsCodes]);

  useEffect(() => {
    clearLegacyLocalDataStorage();
    fetchCloudDeclarations(true);
  }, [fetchCloudDeclarations]);

  // Hàm đồng bộ Google Sheets realtime
  const fetchGgsCodes = useCallback(async (force = false) => {
    try {
      setIsSyncingGgs(true);
      const url = force ? '/api/sync-ggs?force=true' : '/data/ggs_snapshot.json';
      let res = await fetch(url);
      if (!res.ok) {
        res = await fetch(force ? '/data/ggs_snapshot.json' : '/api/sync-ggs');
      }
      if (!res.ok) throw new Error(`Lỗi HTTP ${res.status}`);
      const data: any = await res.json();
      if (data && data.success && Array.isArray(data.ggsCodes)) {
        if (data.ggsParcels) {
          setGgsParcelsMap(data.ggsParcels);
        }
        if (force || data.ggsCodes.length !== lastGgsCountRef.current) {
          lastGgsCountRef.current = data.ggsCodes.length;
          setGgsCodes(new Set(data.ggsCodes));
          setIsGgsLoaded(true);
        }
        setLastSyncTime(new Date().toLocaleTimeString('vi-VN'));
      }
    } catch (err: any) {
      console.warn('Lỗi kết nối /api/sync-ggs, kích hoạt dự phòng nạp từ snapshot tĩnh:', err);
      try {
        const directRes = await fetch('/data/ggs_snapshot.json');
        if (directRes.ok) {
          const data = (await directRes.json()) as any;
          if (data && Array.isArray(data.codes)) {
            if (data.parcels) setGgsParcelsMap(data.parcels);
            setGgsCodes(new Set(data.codes));
            setIsGgsLoaded(true);
            setLastSyncTime(new Date().toLocaleTimeString('vi-VN'));
          }
        }
      } catch (directErr) {
        console.error('Lỗi khi fetch ggs_snapshot:', directErr);
      }
    } finally {
      setIsSyncingGgs(false);
    }
  }, []);

  // Fetch GGS & Database Declarations lúc ban đầu và đồng bộ realtime giữa Admin & Mobile (Không cần F5)
  useEffect(() => {
    fetchGgsCodes(false);
    fetchCloudDeclarations(true);

    // Kiểm tra đồng bộ phiếu kê khai mỗi 15 giây khi tab đang mở (304 Not Modified < 1ms nếu không có thay đổi)
    const declInterval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchCloudDeclarations(false);
      }
    }, 15000);

    // Kiểm tra đồng bộ theo ETag khi chuyển tab hoặc mở màn hình điện thoại lên (304 nếu DB chưa đổi)
    const onInstantSync = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchCloudDeclarations(false);
      }
    };
    window.addEventListener('focus', onInstantSync);
    document.addEventListener('visibilitychange', onInstantSync);

    // Bắt lại vị trí và đồng bộ dữ liệu ngay lập tức khi thiết bị có mạng trở lại (Online event)
    const onOnlineReconnect = () => {
      fetchCloudDeclarations(true);
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

    // Lắng nghe sự kiện Realtime tức thì từ Dashboard / các tab khác (0ms)
    const unsubscribeRealtime = onRealtimeEvent((event) => {
      if (event.type === 'DECLARATION_SAVED' && event.maThua) {
        const targetMaThua = event.maThua;
        if (event.declaration) {
          setDeclarationsMap((prev) => {
            const next = { ...prev, [targetMaThua]: event.declaration };
            declarationsMapRef.current = next;
            return next;
          });
        }
        if (event.declaredCodes) {
          const nextSet = new Set(event.declaredCodes);
          declaredCodesRef.current = nextSet;
          setDeclaredParcelCodes(nextSet);
        } else {
          setDeclaredParcelCodes((prev) => {
            const nextSet = new Set([...prev, targetMaThua]);
            declaredCodesRef.current = nextSet;
            return nextSet;
          });
        }
      } else if (event.type === 'DECLARATION_DELETED' && event.maThua) {
        const targetMaThua = event.maThua;
        setDeclarationsMap((prev) => {
          const next = { ...prev };
          delete next[targetMaThua];
          declarationsMapRef.current = next;
          return next;
        });
        if (event.declaredCodes) {
          const nextSet = new Set(event.declaredCodes);
          declaredCodesRef.current = nextSet;
          setDeclaredParcelCodes(nextSet);
        } else {
          setDeclaredParcelCodes((prev) => {
            const next = new Set(prev);
            next.delete(targetMaThua);
            declaredCodesRef.current = next;
            return next;
          });
        }
      } else if (event.type === 'CELL_EDITS_SYNCED') {
        if (event.cellEdits) {
          setCellEdits((prev) => {
            const next = { ...prev };
            for (const [code, cols] of Object.entries(event.cellEdits || {})) {
              if (!code || !cols) continue;
              next[code] = {
                ...(next[code] || {}),
                ...cols,
              };
            }
            return next;
          });
        }
      } else if (event.type === 'FORCE_REFRESH_REPORT') {
        fetchCloudDeclarations(true);
      }
    });

    return () => {
      clearInterval(declInterval);
      clearInterval(ggsInterval);
      unsubscribeRealtime();
      window.removeEventListener('focus', onInstantSync);
      document.removeEventListener('visibilitychange', onInstantSync);
      window.removeEventListener('online', onOnlineReconnect);
    };
  }, [fetchGgsCodes, fetchCloudDeclarations]);

  // TÍNH TOÁN TRẠNG THÁI REALTIME VÀ ĐỒNG BỘ THÔNG TIN TỪ GOOGLE SHEETS:
  // (Đã loại trừ 1.330 thửa đất Nhóm 4 từ dòng 7917 đến 9246 theo yêu cầu)
  // 1. Thửa có trên Google Sheets -> Lấy Tên chủ hộ, CCCD từ GGS (thay thế bất kỳ dữ liệu excel lỗi thời nào)
  // 2. Thửa ĐÃ ĐƯỢC KÊ KHAI trên hệ thống web nhưng CHƯA có trên GGS -> Màu xanh lam
  // 3. Thửa có tên chủ đất (chưa kê khai, chưa có trên GGS) -> Màu vàng
  // 4. Thửa chưa có tên -> Màu trắng
  const computedParcels = useMemo<Parcel[]>(() => {
    return parcels
      .filter((p) => {
        if (HIDDEN_PARCEL_SET.has(p.ma_thua)) return false;
        if (isExcludedLandType(p.loai_dat)) return false;
        return true;
      })
      .map((p) => {
      const savedDecl = declarationsMap[p.ma_thua];
      const ggsInfo = ggsParcelsMap[p.ma_thua];

      let isGgsMatched = false;
      if (isGgsLoaded && ggsCodes.has(p.ma_thua)) {
        if (!savedDecl) {
          isGgsMatched = true;
        } else {
          const dCccd = (savedDecl.chu_dat_cccd || savedDecl.cccd || '').replace(/\D/g, '');
          const gCccd = (ggsInfo?.cccd || '').replace(/\D/g, '');
          const hasSameCccd = Boolean(dCccd.length >= 9 && gCccd.length >= 9 && dCccd === gCccd);
          const dName = cleanStrictName(savedDecl.chu_dat_ten || savedDecl.chu_ho);
          const gName = cleanStrictName(ggsInfo?.chu_ho);
          const hasSameName = Boolean(dName && gName && dName === gName);
          const hasSameNameNoAccent = Boolean(dName && gName && stripAccents(dName) === stripAccents(gName));
          isGgsMatched = hasSameCccd || hasSameName || hasSameNameNoAccent;
        }
      }

      const isDigitized = DIGITIZED_SET.has(p.ma_thua) || isGgsMatched;
      const isOnGgs = isDigitized;
      const isLocallyDeclared = declaredParcelCodes.has(p.ma_thua) || Boolean(savedDecl);

      // ĐỐI VỚI THỬA ĐÃ CÓ TRÊN GOOGLE SHEETS HOẶC ĐÃ KÊ KHAI:
      // ƯU TIÊN LẤY TÊN CHỦ THỬA VÀ CCCD TỪ GOOGLE SHEETS (loại bỏ hoàn toàn mã geohash rác w6jp...)

      let chu_ho = p.chu_ho;
      let cccd = p.cccd;

      const isInvalidName = (name?: string) => {
        if (!name) return true;
        const s = name.trim().toLowerCase();
        if (
          s === 'nam' ||
          s === 'nữ' ||
          s === 'nu' ||
          s === 'cá nhân' ||
          s === 'chung' ||
          s.startsWith('w6jp')
        ) return true;
        return !isPersonName(name);
      };

      // 1. Áp dụng thông tin từ Google Sheets (nếu có)
      if (ggsInfo?.chu_ho && !isInvalidName(ggsInfo.chu_ho)) {
        chu_ho = ggsInfo.chu_ho;
      } else if (isInvalidName(chu_ho)) {
        chu_ho = 'Không có trong dữ liệu';
      }

      if (ggsInfo?.cccd && ggsInfo.cccd.length >= 9) {
        cccd = ggsInfo.cccd;
      }

      const edits = cellEdits[p.ma_thua] || {};

      // 2. ƯU TIÊN TUYỆT ĐỐI dữ liệu kê khai thực địa của cán bộ (savedDecl) và chỉnh sửa nháp (cellEdits):
      // Phiếu kê khai thực địa do cán bộ lập/chỉnh sửa luôn là chân lý và ghi đè hoàn toàn Google Sheets
      if (savedDecl) {
        if (savedDecl.chu_dat_ten && !isInvalidName(savedDecl.chu_dat_ten)) chu_ho = savedDecl.chu_dat_ten;
        if (savedDecl.yeu_cau_thu_cccd) cccd = '';
        else if (savedDecl.chu_dat_cccd !== undefined) cccd = savedDecl.chu_dat_cccd;
      } else if (edits[3] !== undefined) {
        chu_ho = edits[3];
      }
      if (!savedDecl && edits[6] !== undefined) {
        cccd = edits[6];
      }

      let thon_xa = p.thon_xa || '';
      if (savedDecl) {
        const rawDeclThon = savedDecl.dia_chi_thua_dat || savedDecl.thon_xa || savedDecl.chu_dat_dia_chi || '';
        const cleanedDeclThon = cleanVillageDisplay(rawDeclThon, p.to_ban_do) || rawDeclThon;
        if (cleanedDeclThon) thon_xa = cleanedDeclThon;
      } else if (edits[2] !== undefined && String(edits[2]).trim()) {
        const cleanedEditThon = cleanVillageDisplay(edits[2], p.to_ban_do) || String(edits[2]).trim();
        thon_xa = cleanedEditThon;
      }

      let dien_tich = p.dien_tich ? String(p.dien_tich) : '';
      if ((!dien_tich || dien_tich.startsWith('w6jp')) && ggsInfo?.dien_tich) {
        dien_tich = String(ggsInfo.dien_tich);
      } else if (dien_tich?.startsWith('w6jp')) {
        dien_tich = '';
      }
      if (edits[7] !== undefined && String(edits[7]).trim()) {
        dien_tich = String(edits[7]).trim();
      } else if (savedDecl?.dien_tich) {
        dien_tich = String(savedDecl.dien_tich);
      }

      let loai_dat = p.loai_dat ? String(p.loai_dat) : '';
      if ((!loai_dat || loai_dat.includes('http') || loai_dat.startsWith('w6jp')) && ggsInfo?.loai_dat) {
        loai_dat = String(ggsInfo.loai_dat);
      } else if (loai_dat?.includes('http') || loai_dat?.startsWith('w6jp')) {
        loai_dat = '';
      }
      if (edits[8] !== undefined && String(edits[8]).trim()) {
        loai_dat = String(edits[8]).trim();
      } else if (savedDecl?.loai_dat) {
        loai_dat = String(savedDecl.loai_dat);
      }

      const ngay_sinh = String(edits[4] ?? savedDecl?.chu_dat_nam_sinh ?? savedDecl?.nam_sinh_chu_ho ?? (p as any).ngay_sinh ?? '').trim();
      const gioi_tinh = String(edits[5] ?? savedDecl?.chu_dat_gioi_tinh ?? savedDecl?.gioi_tinh_chu_ho ?? (p as any).gioi_tinh ?? '').trim();
      const nguon_goc = String(edits[9] ?? savedDecl?.nguon_goc ?? savedDecl?.nguon_goc_su_dung ?? (p as any).nguon_goc ?? '').trim();

      // XÁC ĐỊNH TRẠNG THÁI THỬA ĐẤT:
      // 1. Thửa ĐÃ SỐ HÓA (có trên Google Sheets hoặc cccd đã đóng tập hoặc thửa ONT coi như đã số hóa) -> Xanh lá
      // 2. Thửa ĐÃ KÊ KHAI (vừa kê khai trên web, chưa số hóa lên GGS, phi-ONT) -> Xanh lam
      // 3. Thửa CHƯA KÊ KHAI CÓ TÊN (tên người thật) -> Vàng
      // 4. Thửa CHƯA KÊ KHAI CHƯA CÓ TÊN (không phải tên người, địa danh, công cộng...) -> Trắng
      let trang_thai: ParcelStatus;
      const isGcnOntParcel = isGcnOntRoute(loai_dat, thon_xa, p.to_ban_do);
      const isBypassDigitizedOnt = isOntLand(loai_dat) && !isGcnOntParcel;

      if (isOnGgs || (DIGITIZED_SET.has(p.ma_thua) && !isBypassDigitizedOnt)) {
        trang_thai = 'DA_SO_HOA_XANH';
      } else if (isLocallyDeclared) {
        // Thửa đất thuộc danh sách GCN - ONT: coi như đã số hóa trên bản đồ (xanh lá) NẾU ĐÃ CÓ CCCD
        // Riêng 5 thôn Ea Bar, Ea Uôl, Ea Lang, Cư Tê, Ea Rớt vẫn đi theo quy trình kê khai thông thường
        const hasValidCccd = Boolean(cccd && cccd.length >= 9);
        if (isGcnOntParcel && hasValidCccd) {
          trang_thai = 'DA_SO_HOA_XANH';
        } else {
          trang_thai = 'DA_KE_KHAI_CHUA_SO_HOA_LAM';
        }
      } else if (p.trang_thai === 'DA_SO_HOA_XANH' && !isGgsLoaded) {
        trang_thai = 'DA_SO_HOA_XANH';
      } else if (chu_ho && chu_ho !== 'Không có trong dữ liệu' && isPersonName(chu_ho)) {
        trang_thai = 'CO_TEN_CHUA_SO_HOA_VANG';
      } else {
        trang_thai = 'CHUA_CO_TEN_XAM';
      }

      return {
        ...p,
        chu_ho,
        cccd,
        thon_xa,
        dien_tich,
        loai_dat,
        ngay_sinh: ngay_sinh || (p as any).ngay_sinh,
        gioi_tinh: gioi_tinh || (p as any).gioi_tinh,
        nguon_goc: nguon_goc || (p as any).nguon_goc,
        trang_thai,
        is_on_ggs: isOnGgs,
        is_declared: isLocallyDeclared,
      };
    });
  }, [parcels, ggsCodes, ggsParcelsMap, declaredParcelCodes, declarationsMap, cellEdits, isGgsLoaded]);

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
      if (!isAllStatusesSelected && selectedStatuses.size > 0) {
        if (!selectedStatuses.has(p.trang_thai)) {
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
  }, [computedParcels, searchQuery, selectedSheets, selectedStatuses, isAllStatusesSelected]);

  // 1. Danh sách các thửa đất cùng chủ CHÍNH XÁC theo CCCD (duy nhất) - Loại bỏ các thửa đã chọn gộp
  const sameCccdParcels = useMemo(() => {
    const selDecl = selectedParcel ? declarationsMap[selectedParcel.ma_thua] : undefined;
    const activeCccd = (selDecl?.chu_dat_cccd || selectedParcel?.cccd || '').trim();
    if (!selectedParcel || !activeCccd || activeCccd.length < 9) {
      return [];
    }
    const additionalCodes = new Set(additionalParcels.map((ap) => ap.ma_thua));
    return computedParcels.filter(
      (p) =>
        p.ma_thua !== selectedParcel.ma_thua &&
        !additionalCodes.has(p.ma_thua) &&
        (p.cccd?.trim() === activeCccd || declarationsMap[p.ma_thua]?.chu_dat_cccd?.trim() === activeCccd)
    );
  }, [selectedParcel, computedParcels, additionalParcels, declarationsMap]);

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

    const selDecl = selectedParcel ? declarationsMap[selectedParcel.ma_thua] : undefined;
    const activeOwner = (selDecl?.chu_dat_ten || selectedParcel?.chu_ho || '').trim();

    if (
      !selectedParcel ||
      !activeOwner ||
      nonPersonPlaceholders.some((np) => activeOwner.toLowerCase().includes(np.toLowerCase()))
    ) {
      return [];
    }
    const cleanOwner = activeOwner.toLowerCase();
    const cccdMatchedCodes = new Set(sameCccdParcels.map((p) => p.ma_thua));
    const additionalCodes = new Set(additionalParcels.map((ap) => ap.ma_thua));

    return computedParcels.filter(
      (p) =>
        p.ma_thua !== selectedParcel.ma_thua &&
        !additionalCodes.has(p.ma_thua) &&
        !cccdMatchedCodes.has(p.ma_thua) &&
        (p.chu_ho || declarationsMap[p.ma_thua]?.chu_dat_ten) &&
        !nonPersonPlaceholders.some((np) => (p.chu_ho || declarationsMap[p.ma_thua]?.chu_dat_ten || '').toLowerCase().includes(np.toLowerCase())) &&
        ((declarationsMap[p.ma_thua]?.chu_dat_ten || p.chu_ho || '').trim().toLowerCase() === cleanOwner)
    );
  }, [selectedParcel, computedParcels, sameCccdParcels, additionalParcels, declarationsMap]);

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
    setSelectedParcel({ ...latest, _forceZoom: Date.now() } as any);
    setIsPanelCollapsed(false);
    setIsCccdUploadOpen(false);
    setIsExportMissingCccdOpen(false);
    setIsCccdSplitView(false);

    // Kích hoạt animation trượt vào mượt mà
    requestAnimationFrame(() => {
      setIsPanelOpen(true);
    });
  };

  // Định vị zoom thửa đất trên bản đồ khi bấm loại đất từ danh sách thu thập CCCD, tự động chia 1:1 trên điện thoại
  const handleZoomToParcelKeepCccd = (p: Parcel) => {
    const latest = computedParcels.find((cp) => cp.ma_thua === p.ma_thua) || p;
    const nbs = findNearbyParcels(latest, computedParcels, 450, 12);
    setNeighborParcels(nbs);
    setSelectedParcel({ ...latest, _forceZoom: Date.now() } as any);
    setIsExportMissingCccdOpen(true);
    setIsCccdSplitView(true);
    setIsPanelOpen(true);
    setIsPanelCollapsed(false);
  };

  const handleClosePanel = () => {
    setIsPanelOpen(false);
    setIsExportMissingCccdOpen(false);
    setIsCccdSplitView(false);
    setIsPanelCollapsed(false);
    setIsPickingAdditional(false);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    }
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

  const handleSaveDeclaration = async (formData: DeclarationFormData) => {
    console.log('Phiếu kê khai / báo sai cần lưu Database:', formData);
    setPickToast('✓ Đang lưu trực tiếp vào Database...');

    if (formData.is_correction) {
      try {
        const res = await fetch('/api/declarations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'patch_declaration_fields',
            ma_thua: formData.ma_thua,
            fields: {
              ghi_chu: formData.ghi_chu,
              updated_at: new Date().toISOString(),
            },
            fallbackDecl: {
              ...formData,
              updated_at: new Date().toISOString(),
            },
          }),
          keepalive: true,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = (await res.json()) as any;
        if (!result?.success) throw new Error(result?.error || 'Lưu báo sai thất bại');

        const { updatedCodes, updatedMap } = applyDeclarationToState(
          declaredCodesRef.current,
          declarationsMapRef.current,
          result.declaration || formData
        );
        declaredCodesRef.current = new Set(updatedCodes);
        declarationsMapRef.current = updatedMap;
        setDeclaredParcelCodes(declaredCodesRef.current);
        setDeclarationsMap(updatedMap);
        broadcastRealtimeEvent({
          type: 'DECLARATION_SAVED',
          maThua: formData.ma_thua,
          declaration: result.declaration || formData,
          declaredCodes: updatedCodes,
        });
        setPickToast('✓ Đã lưu báo sai trực tiếp vào Database');
        setTimeout(() => setPickToast(null), 3000);
        return true;
      } catch (err) {
        console.error('Lỗi lưu báo sai vào Database:', err);
        setPickToast('❌ Lỗi lưu Database! Vui lòng kiểm tra mạng và thử lại.');
        setTimeout(() => setPickToast(null), 4000);
        return false;
      }
    }

    // Lưu trực tiếp vào Cloudflare D1 (có thử lại tối đa 3 lần khi mạng yếu, KHÔNG cất vào localStorage)
    const attemptSave = async (retryCount = 0): Promise<boolean> => {
      try {
        const res = await fetch('/api/declarations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
          keepalive: true,
        });

        if (res.ok) {
          const result = (await res.json()) as any;
          if (!result?.success) {
            throw new Error(result?.error || 'Server trả về thất bại');
          }

          const { updatedCodes, updatedMap } = applyDeclarationToState(
            declaredCodesRef.current,
            declarationsMapRef.current,
            formData
          );
          const nextSet = new Set(updatedCodes);
          if (Array.isArray(result.declaredCodes)) {
            result.declaredCodes.forEach((c: string) => nextSet.add(c));
          }
          const nextMap = {
            ...updatedMap,
            ...(result.declarationsMap && typeof result.declarationsMap === 'object' ? result.declarationsMap : {}),
          };

          const allSavedCodes = [
            formData.ma_thua,
            ...(Array.isArray(formData.thua_kem_theo) ? formData.thua_kem_theo.map((a) => a.ma_thua) : []),
          ].filter(Boolean);

          declaredCodesRef.current = nextSet;
          declarationsMapRef.current = nextMap;
          lastCloudSigRef.current = JSON.stringify({ codes: Array.from(nextSet), map: nextMap });
          setDeclaredParcelCodes(nextSet);
          setDeclarationsMap(nextMap);
          setCellEdits((prev) => {
            let changed = false;
            const nextEdits = { ...prev };
            allSavedCodes.forEach((c) => {
              if (nextEdits[c]) {
                delete nextEdits[c];
                changed = true;
              }
            });
            return changed ? nextEdits : prev;
          });
          setIsPickingAdditional(false);

          if (selectedParcel && selectedParcel.ma_thua === formData.ma_thua) {
            const ggsInfo = ggsParcelsMap[formData.ma_thua];
            let isGgsMatched = false;
            if (ggsCodes.has(formData.ma_thua)) {
              const dCccd = (formData.chu_dat_cccd || '').replace(/\D/g, '');
              const gCccd = (ggsInfo?.cccd || '').replace(/\D/g, '');
              const hasSameCccd = Boolean(dCccd.length >= 9 && gCccd.length >= 9 && dCccd === gCccd);
              const dName = cleanStrictName(formData.chu_dat_ten);
              const gName = cleanStrictName(ggsInfo?.chu_ho);
              const hasSameName = Boolean(dName && gName && dName === gName);
              isGgsMatched = hasSameCccd || hasSameName;
            }
            const isOnGgs = DIGITIZED_SET.has(formData.ma_thua) || isGgsMatched;
            setSelectedParcel({
              ...selectedParcel,
              chu_ho: formData.chu_dat_ten !== undefined ? formData.chu_dat_ten : selectedParcel.chu_ho,
              cccd: formData.chu_dat_cccd !== undefined ? formData.chu_dat_cccd : selectedParcel.cccd,
              giap_dong: formData.giap_dong || selectedParcel.giap_dong,
              giap_tay: formData.giap_tay || selectedParcel.giap_tay,
              giap_nam: formData.giap_nam || selectedParcel.giap_nam,
              giap_bac: formData.giap_bac || selectedParcel.giap_bac,
              trang_thai: isOnGgs ? 'DA_SO_HOA_XANH' : 'DA_KE_KHAI_CHUA_SO_HOA_LAM',
              is_declared: true,
            });
          }

          broadcastRealtimeEvent({
            type: 'DECLARATION_SAVED',
            maThua: formData.ma_thua,
            declaration: nextMap[formData.ma_thua] || formData,
            declaredCodes: Array.from(nextSet),
          });

          setPickToast('✓ Đã lưu trực tiếp vào Database thành công');
          setTimeout(() => setPickToast(null), 3000);

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
          return true;
        } else {
          const errBody = await res.text().catch(() => '');
          console.warn(`Lưu Database trả về mã lỗi ${res.status}: ${errBody} (thử lại lần ${retryCount + 1}/3)`);
          if (retryCount < 2) {
            await new Promise((r) => setTimeout(r, 600 * (retryCount + 1)));
            return await attemptSave(retryCount + 1);
          }
          setPickToast('❌ Lỗi lưu Database! Vui lòng kiểm tra mạng và thử lại.');
          setTimeout(() => setPickToast(null), 4000);
          return false;
        }
      } catch (err) {
        console.warn(`Lỗi kết nối khi lưu vào Database (thử lại lần ${retryCount + 1}/3):`, err);
        if (retryCount < 2) {
          await new Promise((r) => setTimeout(r, 800 * (retryCount + 1)));
          return await attemptSave(retryCount + 1);
        }
        setPickToast('❌ Lỗi kết nối Database! Vui lòng kiểm tra mạng và thử lại.');
        setTimeout(() => setPickToast(null), 4000);
        return false;
      }
    };

    return attemptSave(0);
  };

  const handleDeleteDeclaration = async (targetMaThua: string) => {
    setPickToast('✓ Đang xóa trên Database...');
    try {
      const res = await fetch(`/api/declarations?ma_thua=${encodeURIComponent(targetMaThua)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const result = (await res.json()) as any;
      const { removedCodes, updatedCodes, updatedMap } = removeDeclarationFromState(
        declaredCodesRef.current,
        declarationsMapRef.current,
        targetMaThua
      );

      const finalCodes =
        result?.success && Array.isArray(result.declaredCodes) ? (result.declaredCodes as string[]) : updatedCodes;
      const finalMap =
        result?.success && result.declarationsMap && typeof result.declarationsMap === 'object'
          ? result.declarationsMap
          : updatedMap;

      const finalSet = new Set<string>(finalCodes);
      declaredCodesRef.current = finalSet;
      declarationsMapRef.current = finalMap;
      lastCloudSigRef.current = JSON.stringify({ codes: finalCodes, map: finalMap });
      setDeclaredParcelCodes(finalSet);
      setDeclarationsMap(finalMap);

      broadcastRealtimeEvent({
        type: 'DECLARATION_DELETED',
        maThua: targetMaThua,
        declaredCodes: finalCodes,
      });
      setAdditionalParcels([]);
      setIsPickingAdditional(false);

      if (selectedParcel && removedCodes.includes(selectedParcel.ma_thua)) {
        const original = parcels.find((p) => p.ma_thua === selectedParcel.ma_thua);
        if (original) {
          const isOnGgs = ggsCodes.has(original.ma_thua) || DIGITIZED_SET.has(original.ma_thua);
          setSelectedParcel({
            ...original,
            trang_thai: isOnGgs ? 'DA_SO_HOA_XANH' : (original.trang_thai as ParcelStatus),
            is_declared: false,
          });
        }
      }

      setPickToast('✓ Đã xóa phiếu kê khai khỏi Database');
      setTimeout(() => setPickToast(null), 3000);
    } catch (err) {
      console.warn('Lỗi khi xóa trên Database:', err);
      setPickToast('❌ Không xóa được trên máy chủ! Đang đồng bộ lại...');
      setTimeout(() => setPickToast(null), 3500);
      fetchCloudDeclarations(true);
    }
  };

  return (
    <main className="h-screen w-screen overflow-hidden relative bg-slate-900 text-gray-900">
      {/* Main Content Area: Bản Đồ Vệ Tinh Toàn Màn Hình */}
      <div className="w-full h-full relative overflow-hidden">
            {/* Form chi tiết (Kê khai thửa hoặc Thu thập CCCD): Trượt từ trái qua (Desktop) hoặc từ dưới lên (Mobile) */}
            <div
              ref={panelRef}
              className={`absolute z-30 bg-white transition-all duration-300 ease-in-out shadow-2xl overflow-hidden ${
                (isPanelOpen && selectedParcel) || isExportMissingCccdOpen
                  ? isPanelCollapsed
                    ? 'w-full lg:w-[420px] h-[65vh] max-h-[85vh] lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-0 translate-y-full lg:-translate-x-full border-0 pointer-events-none'
                    : isExportMissingCccdOpen
                      ? isCccdSplitView
                        ? 'w-full lg:w-[420px] h-[60dvh] max-h-[60dvh] lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-100 translate-y-0 lg:translate-x-0 rounded-t-3xl lg:rounded-none border-t lg:border-t-0 lg:border-r border-gray-200 pointer-events-auto'
                        : 'w-full lg:w-[420px] h-[92dvh] max-h-[94dvh] lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-100 translate-y-0 lg:translate-x-0 rounded-t-3xl lg:rounded-none border-t lg:border-t-0 lg:border-r border-gray-200 pointer-events-auto'
                      : 'w-full lg:w-[420px] h-[65vh] max-h-[85vh] lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-100 translate-y-0 lg:translate-x-0 rounded-t-3xl lg:rounded-none border-t lg:border-t-0 lg:border-r border-gray-200 pointer-events-auto'
                  : 'w-full lg:w-0 h-0 lg:h-full lg:max-h-none lg:inset-y-0 bottom-0 lg:bottom-auto lg:top-0 left-0 opacity-0 translate-y-full lg:-translate-x-full border-0 pointer-events-none'
              }`}
            >
              <div className="w-full lg:w-[420px] h-full flex flex-col">
                {isExportMissingCccdOpen ? (
                  <CccdCollectPanel
                    onClose={handleClosePanel}
                    parcels={computedParcels}
                    declarationsMap={declarationsMap}
                    cellEdits={cellEdits}
                    ggsCodes={ggsCodes}
                    declaredParcelCodes={declaredParcelCodes}
                    onDeclarationUpdated={(updatedDecl) => {
                      if (updatedDecl?.ma_thua) {
                        const { updatedCodes, updatedMap } = applyDeclarationToState(
                          declaredCodesRef.current,
                          declarationsMapRef.current,
                          updatedDecl
                        );
                        declaredCodesRef.current = new Set(updatedCodes);
                        declarationsMapRef.current = updatedMap;
                        lastCloudSigRef.current = JSON.stringify({ codes: updatedCodes, map: updatedMap });
                        setDeclaredParcelCodes(declaredCodesRef.current);
                        setDeclarationsMap(updatedMap);
                      }
                    }}
                    onCellEditsUpdated={(patch) => {
                      setCellEdits((prev) => {
                        const next = { ...prev };
                        for (const [code, cols] of Object.entries(patch || {})) {
                          if (!code || !cols) continue;
                          next[code] = {
                            ...(next[code] || {}),
                            ...cols,
                          };
                        }
                        return next;
                      });
                    }}
                    onToggleCollapse={() => setIsPanelCollapsed((prev) => !prev)}
                    onZoomToParcel={handleZoomToParcelKeepCccd}
                    onSplitModeChange={setIsCccdSplitView}
                  />
                ) : selectedParcel ? (
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
                ) : null}
              </div>
            </div>

            {/* Nút mở lại bảng chi tiết khi đang thu gọn trên Desktop (nằm ở mép trái bản đồ) */}
            {isPanelCollapsed && (
              selectedParcel ? (
                <button
                  type="button"
                  onClick={() => setIsPanelCollapsed(false)}
                  className="absolute top-20 left-0 z-30 hidden lg:flex items-center gap-1.5 bg-white/95 backdrop-blur-md text-slate-800 hover:text-blue-600 hover:bg-blue-50 px-3 py-2.5 rounded-r-2xl shadow-2xl border-y border-r border-gray-200 font-bold text-xs transition-all active:scale-95 cursor-pointer animate-in slide-in-from-left duration-200"
                  title="Mở lại bảng chi tiết thửa đất"
                >
                  <ChevronRight className="w-4 h-4 text-blue-600" />
                  <span>Thửa {selectedParcel.so_thua} (Tờ {selectedParcel.to_ban_do})</span>
                </button>
              ) : isExportMissingCccdOpen ? (
                <button
                  type="button"
                  onClick={() => setIsPanelCollapsed(false)}
                  className="absolute top-20 left-0 z-30 hidden lg:flex items-center gap-1.5 bg-white/95 backdrop-blur-md text-slate-800 hover:text-blue-600 hover:bg-blue-50 px-3 py-2.5 rounded-r-2xl shadow-2xl border-y border-r border-gray-200 font-bold text-xs transition-all active:scale-95 cursor-pointer animate-in slide-in-from-left duration-200"
                  title="Mở lại danh sách thu thập CCCD"
                >
                  <ChevronRight className="w-4 h-4 text-blue-600" />
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  <span>Thu Thập CCCD</span>
                </button>
              ) : null
            )}

            {/* Nút mở lại bảng chi tiết khi đang thu gọn trên Điện thoại (nằm ở đáy màn hình) */}
            {isPanelCollapsed && (
              selectedParcel ? (
                <button
                  type="button"
                  onClick={() => setIsPanelCollapsed(false)}
                  className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 lg:hidden flex items-center gap-2 bg-white/95 backdrop-blur-md text-slate-800 px-4 py-2.5 rounded-full shadow-2xl border border-gray-200 font-extrabold text-xs transition-all active:scale-95 cursor-pointer animate-in slide-in-from-bottom duration-200"
                  title="Mở lại bảng chi tiết thửa đất"
                >
                  <ChevronUp className="w-4 h-4 text-blue-600 animate-bounce" />
                  <span>Xem Thửa {selectedParcel.so_thua} • Tờ {selectedParcel.to_ban_do}</span>
                </button>
              ) : isExportMissingCccdOpen ? (
                <button
                  type="button"
                  onClick={() => setIsPanelCollapsed(false)}
                  className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 lg:hidden flex items-center gap-2 bg-white/95 backdrop-blur-md text-slate-800 px-4 py-2.5 rounded-full shadow-2xl border border-gray-200 font-extrabold text-xs transition-all active:scale-95 cursor-pointer animate-in slide-in-from-bottom duration-200"
                  title="Mở lại danh sách thu thập CCCD"
                >
                  <ChevronUp className="w-4 h-4 text-blue-600 animate-bounce" />
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  <span>Xem Danh Sách Thu Thập CCCD</span>
                </button>
              ) : null
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

            {/* Cụm button điều khiển nổi: Trạng thái, Realtime GGS & Tìm kiếm (Luôn ghim cố định ở đỉnh, tự động trượt lên khi mở form) */}
            <div
              className={`fixed top-2.5 sm:top-3.5 z-20 flex flex-col gap-1.5 sm:gap-2 transition-all duration-300 ease-in-out left-2.5 sm:left-3.5 right-auto max-w-[calc(100vw-1.25rem)] ${
                ((isPanelOpen && selectedParcel) || isExportMissingCccdOpen) && !isPanelCollapsed
                  ? '-translate-y-[170%] opacity-0 pointer-events-none'
                  : 'translate-y-0 opacity-100 pointer-events-auto'
              }`}
            >

              {/* Row 1: Các button trạng thái đa lựa chọn (Multi-select: có thể chọn nhiều loại cùng lúc trên bản đồ) */}
              <div className="bg-white/95 backdrop-blur-md p-1 rounded-2xl border border-gray-200/90 shadow-xl w-fit max-w-[calc(100vw-1.5rem)] overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-1 sm:gap-1.5 w-max">
                  {/* Tất cả */}
                  <button
                    onClick={selectAllStatuses}
                    className={`flex items-center justify-center gap-1 py-1.5 px-1.5 sm:px-2.5 rounded-xl font-bold transition text-xs cursor-pointer whitespace-nowrap shrink-0 ${
                      isAllStatusesSelected
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                    title="Hiển thị tất cả thửa đất (bỏ lọc)"
                  >
                    <span className="hidden md:inline whitespace-nowrap">Tất cả</span><span className="whitespace-nowrap tabular-nums">({stats.total.toLocaleString('vi-VN')})</span>
                  </button>

                  {/* Đã số hóa (Xanh lá - Có trên GGS) */}
                  <button
                    onClick={() => toggleStatusFilter('DA_SO_HOA_XANH')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-1.5 sm:px-2.5 rounded-xl font-bold transition text-xs cursor-pointer whitespace-nowrap shrink-0 ${
                      !isAllStatusesSelected && selectedStatuses.has('DA_SO_HOA_XANH')
                        ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-400/50'
                        : 'bg-transparent text-emerald-700 hover:bg-emerald-50'
                    }`}
                    title="Bấm để bật/tắt hiển thị Thửa đã số hóa (có trên Google Sheets)"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${!isAllStatusesSelected && selectedStatuses.has('DA_SO_HOA_XANH') ? 'bg-white ring-1 ring-white/60' : 'bg-emerald-500'}`}></span>
                    <span className="hidden md:inline whitespace-nowrap">Đã số hóa</span><span className="whitespace-nowrap tabular-nums">({stats.green.toLocaleString('vi-VN')})</span>
                  </button>

                  {/* Đã kê khai (Xanh lam - Chưa có trên GGS) */}
                  <button
                    onClick={() => toggleStatusFilter('DA_KE_KHAI_CHUA_SO_HOA_LAM')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-1.5 sm:px-2.5 rounded-xl font-bold transition text-xs cursor-pointer whitespace-nowrap shrink-0 ${
                      !isAllStatusesSelected && selectedStatuses.has('DA_KE_KHAI_CHUA_SO_HOA_LAM')
                        ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-400/50'
                        : 'bg-transparent text-blue-700 hover:bg-blue-50'
                    }`}
                    title="Bấm để bật/tắt hiển thị Thửa đã được kê khai nhưng chưa số hóa"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${!isAllStatusesSelected && selectedStatuses.has('DA_KE_KHAI_CHUA_SO_HOA_LAM') ? 'bg-white ring-1 ring-white/60' : 'bg-blue-500'}`}></span>
                    <span className="hidden md:inline whitespace-nowrap">Đã kê khai</span><span className="whitespace-nowrap tabular-nums">({stats.blue.toLocaleString('vi-VN')})</span>
                  </button>

                  {/* Có tên (Màu vàng) */}
                  <button
                    onClick={() => toggleStatusFilter('CO_TEN_CHUA_SO_HOA_VANG')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-1.5 sm:px-2.5 rounded-xl font-bold transition text-xs cursor-pointer whitespace-nowrap shrink-0 ${
                      !isAllStatusesSelected && selectedStatuses.has('CO_TEN_CHUA_SO_HOA_VANG')
                        ? 'bg-amber-500 text-white shadow-xs ring-2 ring-amber-300/50'
                        : 'bg-transparent text-amber-700 hover:bg-amber-50'
                    }`}
                    title="Bấm để bật/tắt hiển thị Thửa chưa kê khai có tên người (màu vàng)"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${!isAllStatusesSelected && selectedStatuses.has('CO_TEN_CHUA_SO_HOA_VANG') ? 'bg-white ring-1 ring-white/60' : 'bg-amber-400'}`}></span>
                    <span className="hidden md:inline whitespace-nowrap">Có tên</span><span className="whitespace-nowrap tabular-nums">({stats.yellow.toLocaleString('vi-VN')})</span>
                  </button>

                  {/* Không có tên (Màu trắng/xám) */}
                  <button
                    onClick={() => toggleStatusFilter('CHUA_CO_TEN_XAM')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-1.5 sm:px-2.5 rounded-xl font-bold transition text-xs cursor-pointer whitespace-nowrap shrink-0 ${
                      !isAllStatusesSelected && selectedStatuses.has('CHUA_CO_TEN_XAM')
                        ? 'bg-gray-700 text-white shadow-xs ring-2 ring-gray-400/50'
                        : 'bg-transparent text-gray-700 hover:bg-gray-100'
                    }`}
                    title="Bấm để bật/tắt hiển thị Thửa chưa kê khai không có tên người (màu trắng/xám)"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${!isAllStatusesSelected && selectedStatuses.has('CHUA_CO_TEN_XAM') ? 'bg-white ring-1 ring-white/60' : 'bg-gray-400 ring-1 ring-gray-300'}`}></span>
                    <span className="hidden md:inline whitespace-nowrap">Không tên</span><span className="whitespace-nowrap tabular-nums">({stats.gray.toLocaleString('vi-VN')})</span>
                  </button>

                  {/* Nút bấm & Chỉ báo Realtime Google Sheets (Desktop) */}
                  <button
                    onClick={() => fetchGgsCodes(true)}
                    disabled={isSyncingGgs}
                    className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-bold transition text-xs shrink-0 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 disabled:opacity-60 cursor-pointer ml-auto"
                    title={
                      lastSyncTime
                        ? `Đồng bộ lúc: ${lastSyncTime}. Bấm để cập nhật lại từ Google Sheets ngay.`
                        : 'Bấm để đồng bộ từ Google Sheets ngay'
                    }
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        isSyncingGgs ? 'animate-spin text-blue-500' : 'text-blue-500'
                      }`}
                    />
                    <span className="hidden sm:inline">GGS Live</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  </button>

                  {/* Nút chỉ báo Database Realtime trực tiếp (Desktop) */}
                  <button
                    type="button"
                    onClick={() => fetchCloudDeclarations(true)}
                    className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-bold transition text-xs shrink-0 cursor-pointer bg-gray-50 hover:bg-gray-100 text-emerald-700 border border-emerald-200"
                    title="Dữ liệu đồng bộ trực tiếp từ Cloudflare D1 (tự cập nhật mỗi 5s). Bấm để làm mới ngay."
                  >
                    <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="hidden sm:inline">Realtime DB</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  </button>
                </div>
              </div>

              {/* Row 2: Thanh tìm kiếm & Các nút chức năng (Đã bỏ bộ lọc tờ bản đồ để tối ưu diện tích màn hình) */}
              <div className="flex items-center gap-1.5 sm:gap-2 bg-white/95 backdrop-blur-md p-1.5 rounded-2xl border border-gray-200/90 shadow-xl w-full max-w-xl sm:max-w-2xl">
                <div className="relative flex-1 min-w-[120px]">
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

                {(searchQuery || !isAllStatusesSelected) && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      selectAllStatuses();
                    }}
                    className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition font-medium shrink-0 cursor-pointer"
                    title="Khôi phục mặc định"
                  >
                    Đặt lại
                  </button>
                )}

                {/* Nút mở Dashboard quản trị & tiến độ (Ẩn trên điện thoại) */}
                <Link
                  href="/dashboard"
                  prefetch={false}
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 text-xs bg-cyan-50 hover:bg-cyan-100 text-cyan-800 font-bold rounded-xl transition shrink-0 border border-cyan-200 shadow-2xs"
                  title="Mở Dashboard thống kê & tiến độ số hóa"
                >
                  <BarChart3 className="w-3.5 h-3.5 text-cyan-600" />
                  <span className="hidden xs:inline">Dashboard</span>
                </Link>

                {/* Nút mở công cụ Tách PDF & CCCD ScanName (Ẩn trên điện thoại) */}
                <a
                  href="/scanname"
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold rounded-xl transition shrink-0 border border-indigo-200 shadow-2xs"
                  title="Mở công cụ Tách PDF & Quét CCCD ScanName"
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="hidden xs:inline">Tách PDF</span>
                </a>

                {/* Nút Tải Lên CCCD (Trượt form dưới lên như khi nhấn vào thửa đất) */}
                <button
                  type="button"
                  onClick={() => {
                    setIsPanelOpen(false);
                    setIsCccdUploadOpen(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold rounded-xl transition shrink-0 border border-purple-200 shadow-2xs cursor-pointer"
                  title="Tải lên ảnh CCCD từ máy (trượt form từ dưới lên)"
                >
                  <Camera className="w-3.5 h-3.5 text-purple-600" />
                  <span className="hidden xs:inline">Tải Lên CCCD</span>
                </button>

                {/* Nút DS Cần Thu Thập CCCD (Dạng Form Kê Khai Thửa Đất) */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedParcel(null);
                    setIsPanelOpen(false);
                    setIsPanelCollapsed(false);
                    setIsCccdSplitView(false);
                    setIsExportMissingCccdOpen((prev) => !prev);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl transition shrink-0 border border-blue-200 shadow-2xs cursor-pointer"
                  title="Danh sách thu thập CCCD theo từng thôn buôn"
                >
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  <span className="hidden xs:inline">Thu Thập CCCD</span>
                </button>

                {/* Nút Chế độ Đút Túi Quần (Ẩn trên map theo yêu cầu) */}
                <button
                  type="button"
                  onClick={togglePocketMode}
                  style={{ display: 'none' }}
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

                {/* Nút Hiển Thị / Đổi Tên Người Kê Khai (Ẩn trên map theo yêu cầu) */}
                <button
                  type="button"
                  onClick={() => setIsCadreModalOpen(true)}
                  style={{ display: 'none' }}
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
                <span className="text-xs font-semibold text-slate-200">Đang nạp 9.950 thửa đất bản đồ xã Cư Pui...</span>
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
              isBottomPanelActive={((isPanelOpen && !!selectedParcel) || isExportMissingCccdOpen) && !isPanelCollapsed}
              mobilePanelHeightRatio={isExportMissingCccdOpen ? (isCccdSplitView ? 0.6 : 0.92) : 0.65}
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
