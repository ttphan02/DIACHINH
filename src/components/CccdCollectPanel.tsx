'use client';

import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef } from 'react';
import {
  X,
  Search,
  Filter,
  Check,
  Users,
  RefreshCw,
  MapPin,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { Parcel, DeclarationFormData } from '@/types';
import { getOrCreateDeviceId, getSavedCadreName, saveOrUpdateDeclaration } from '@/utils/declaration';
import { broadcastRealtimeEvent } from '@/utils/realtimeSync';
import { cleanCccd, cleanName, stripAccents, CANONICAL_VILLAGES, getCanonicalVillage, NGUON_GOC_OPTIONS, normalizeNguonGoc } from '@/utils/textHelpers';
import parcelsBriefData from '@/data/parcels_brief.json';
import hiddenParcelsData from '@/data/hidden_parcels.json';
import digitizedParcelsData from '@/data/digitized_parcels.json';

const HIDDEN_PARCEL_SET = new Set(hiddenParcelsData as string[]);
const DIGITIZED_SET = new Set(digitizedParcelsData as string[]);

const parcelsBrief = parcelsBriefData as unknown as Record<string, [string, string, string, number]>;

export interface CccdCollectPanelProps {
  onClose: () => void;
  parcels: Parcel[];
  declarationsMap: Record<string, DeclarationFormData | any>;
  theme?: 'dark' | 'light';
  onDeclarationUpdated?: (updatedDecl: any) => void;
  onToggleCollapse?: () => void;
  onZoomToParcel?: (parcel: Parcel) => void;
}

interface MissingCccdPerson {
  key: string;
  name: string;
  maThuaList: string[];
  soThuaList: string[];
  toBanDoList: string[];
  loaiDatList: string[];
  parcelDetails: Array<{
    maThua: string;
    soThua: string;
    toBanDo: string;
    loaiDat: string;
  }>;
  thonXa: string;
  cccdNumber?: string;
  deviceId?: string;
}

const PAGE_BATCH_SIZE = 40; // Hiển thị 40 cặp (80 người) mỗi lần để điện thoại mượt mà 60fps

export default function CccdCollectPanel({
  onClose,
  parcels,
  declarationsMap,
  theme = 'light',
  onDeclarationUpdated,
  onToggleCollapse,
  onZoomToParcel,
}: CccdCollectPanelProps) {
  // Lọc tìm kiếm & Thôn / Buôn
  const [selectedVillage, setSelectedVillage] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Số lượng hàng đang hiển thị (cuộn vô tận phân đợt để tránh đơ DOM trên điện thoại)
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_BATCH_SIZE);

  // Danh sách CCCD & Tên file đã có trên Cloudflare R2
  const [existingCccdSet, setExistingCccdSet] = useState<Set<string>>(new Set());
  const [r2Filenames, setR2Filenames] = useState<string[]>([]);
  const [isLoadingR2, setIsLoadingR2] = useState(false);

  // Trạng thái đã tích chọn (lưu bền vững vào localStorage)
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());

  // Sub-modal sửa tên / nguồn gốc / di chuyển thôn / buôn
  const [movingPerson, setMovingPerson] = useState<MissingCccdPerson | null>(null);
  const [correctedName, setCorrectedName] = useState<string>('');
  const [targetVillage, setTargetVillage] = useState<string>('');
  const [selectedNguonGoc, setSelectedNguonGoc] = useState<string>('Khai Hoang');
  const [initialNguonGoc, setInitialNguonGoc] = useState<string>('Khai Hoang');
  const [isSavingMove, setIsSavingMove] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // 1. Phục hồi trạng thái từ localStorage
  useEffect(() => {
    try {
      const savedVillage = localStorage.getItem('cccd_collect_selected_village');
      if (savedVillage && (savedVillage === 'ALL' || CANONICAL_VILLAGES.includes(savedVillage))) {
        setSelectedVillage(savedVillage);
      }

      const savedChecked = localStorage.getItem('cccd_collect_checked_keys');
      if (savedChecked) {
        const parsed = JSON.parse(savedChecked);
        if (Array.isArray(parsed)) {
          setCheckedKeys(new Set(parsed));
        }
      }
    } catch {}

    fetchExistingCccdList();
  }, []);

  // Tải danh sách CCCD đã có trên Cloudflare R2
  const fetchExistingCccdList = async () => {
    setIsLoadingR2(true);
    try {
      const res = await fetch(`/api/cccd?list_only=1&t=${Date.now()}`);
      if (res.ok) {
        const data = (await res.json()) as {
          success?: boolean;
          cccdList?: string[];
          filenames?: string[];
        };
        if (Array.isArray(data.cccdList)) {
          setExistingCccdSet(new Set(data.cccdList));
        }
        if (Array.isArray(data.filenames)) {
          setR2Filenames(data.filenames);
        }
      }
    } catch (e) {
      console.warn('Lỗi fetch danh sách CCCD R2:', e);
    } finally {
      setIsLoadingR2(false);
    }
  };

  // Lưu trạng thái Thôn vào localStorage
  const handleSelectVillage = (village: string) => {
    setSelectedVillage(village);
    setVisibleCount(PAGE_BATCH_SIZE);
    try {
      localStorage.setItem('cccd_collect_selected_village', village);
    } catch {}
  };

  // Toggle trạng thái Đã thu thập (checkbox) và lưu vào localStorage (debounce nhẹ)
  const toggleCheck = (personKey: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(personKey)) {
        next.delete(personKey);
      } else {
        next.add(personKey);
      }
      try {
        localStorage.setItem('cccd_collect_checked_keys', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  // TỐI ƯU CỰC ĐỘ 1: Tiền chỉ mục hóa toàn bộ 2.490 tên file trên R2 vào Set O(1)
  // Tránh lặp regex 3 triệu lần trên main thread của điện thoại!
  const r2NormalizedIndex = useMemo(() => {
    const exactSet = new Set<string>();
    const sortedWordsSet = new Set<string>();
    const singleWordsSet = new Set<string>();

    for (let i = 0; i < r2Filenames.length; i++) {
      const fn = r2Filenames[i];
      const baseName = fn.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
      const nameInFile = baseName.replace(/^\d+[\-_\s]+/, '').trim();
      const cleanedFName = cleanName(nameInFile) || nameInFile;
      const normFn = stripAccents(cleanedFName).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
      if (!normFn) continue;

      exactSet.add(normFn);
      const fWords = normFn.split(/\s+/).filter(Boolean);
      if (fWords.length >= 2) {
        sortedWordsSet.add([...fWords].sort().join(' '));
      } else if (fWords.length === 1 && fWords[0].length >= 3) {
        singleWordsSet.add(fWords[0]);
      }
    }

    return { exactSet, sortedWordsSet, singleWordsSet };
  }, [r2Filenames]);

  // TỐI ƯU CỰC ĐỘ 2: Map tra cứu loại đất O(1) thay vì lặp qua 9.822 thửa
  const parcelsLoaiDatMap = useMemo(() => {
    const map = new Map<string, string>();
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      if (p.ma_thua && p.loai_dat) {
        map.set(p.ma_thua, p.loai_dat);
      }
    }
    return map;
  }, [parcels]);

  // Kiểm tra 1 người đã có CCCD trên R2 hay chưa - ĐỘ PHỨC TẠP O(1) THAY VÌ O(M)!
  const hasCccdInR2 = useCallback(
    (decl: any, personName: string): boolean => {
      // 1. Nếu phiếu kê khai đã có liên kết file CCCD R2
      if (decl.cccd_url || decl.file_cccd_pdf || decl.cccd_file) {
        return true;
      }

      // 2. Nếu số CCCD đã có trong R2 Set O(1)
      const rawCccd = decl.chu_dat_cccd || decl.cccd_chu_ho || decl.cccd || '';
      const cccdClean = cleanCccd(rawCccd);
      if ((cccdClean.length === 12 || cccdClean.length === 9) && existingCccdSet.has(cccdClean)) {
        return true;
      }

      // 3. Khớp tên file trên R2 qua Index O(1) (tốc độ siêu thanh, không lặp lại regex)
      if (personName && r2Filenames.length > 0) {
        const cleanedPName = cleanName(personName) || personName;
        const normPerson = stripAccents(cleanedPName).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
        if (!normPerson) return false;

        if (r2NormalizedIndex.exactSet.has(normPerson)) return true;

        const pWords = normPerson.split(/\s+/).filter(Boolean);
        if (pWords.length >= 2) {
          const sortedKey = [...pWords].sort().join(' ');
          if (r2NormalizedIndex.sortedWordsSet.has(sortedKey)) return true;
        } else if (pWords.length === 1 && pWords[0].length >= 3) {
          if (r2NormalizedIndex.singleWordsSet.has(pWords[0])) return true;
        }
      }

      return false;
    },
    [existingCccdSet, r2Filenames.length, r2NormalizedIndex]
  );

  // Lập danh sách công dân ĐÃ KÊ KHAI nhưng CHƯA CÓ CCCD TRÊN R2
  const missingCccdList = useMemo(() => {
    const mapByCitizen = new Map<string, MissingCccdPerson>();

    const declEntries = Object.entries(declarationsMap);
    for (let i = 0; i < declEntries.length; i++) {
      const [parcelCode, decl] = declEntries[i];
      if (!decl || HIDDEN_PARCEL_SET.has(parcelCode)) continue;

      // 1. Bỏ qua các thửa ĐÃ SỐ HÓA (đã hoàn tất trên GGS)
      if (DIGITIZED_SET.has(parcelCode)) continue;

      const pBrief = parcelsBrief[parcelCode];
      const ld = String(decl.loai_dat || (pBrief && pBrief[1]) || '').trim().toUpperCase();

      // 2. Bỏ qua các thửa GCN - ONT (đã có CCCD / coi như đã số hóa, không thuộc diện đi thu CCCD)
      if (/ONT/.test(ld)) continue;

      // 3. Bỏ qua thửa đất BCS < 100m2
      const dt = parseFloat(String(decl.dien_tich || (pBrief && pBrief[0]) || '').replace(',', '.'));
      if (ld === 'BCS' && !isNaN(dt) && dt < 100) continue;

      const name = String(decl.chu_dat_ten || decl.chu_ho || '').trim();
      if (!name || name === 'Chưa có tên') continue;

      // NẾU TÊN NÀO ĐÃ CÓ CCCD TRONG R2 THÌ BỎ TÊN ĐÓ KHỎI DANH SÁCH (Tra cứu O(1))
      if (hasCccdInR2(decl, name)) {
        continue;
      }

      const maThua = String(decl.ma_thua || parcelCode || '').trim();
      const soThua = String(decl.so_thua || '').trim();
      const toBanDo = String(decl.to_ban_do || '').trim();

      // Xác định Thôn / Buôn
      let rawVillage = '';
      if (decl.thon_xa) {
        rawVillage = decl.thon_xa;
      } else if (decl.dia_chi_thua_dat || decl.chu_dat_dia_chi) {
        rawVillage = decl.dia_chi_thua_dat || decl.chu_dat_dia_chi;
      } else if (maThua && parcelsBrief[maThua]) {
        rawVillage = parcelsBrief[maThua][2];
      }
      const thonXa = getCanonicalVillage(rawVillage);

      // Lấy loại đất từ kê khai, parcels_brief hoặc parcelsLoaiDatMap (O(1))
      let loaiDat = String(decl.loai_dat || '').trim();
      if (!loaiDat && maThua && parcelsBrief[maThua] && parcelsBrief[maThua][1]) {
        loaiDat = parcelsBrief[maThua][1];
      }
      if (!loaiDat && maThua) {
        loaiDat = parcelsLoaiDatMap.get(maThua) || '';
      }
      loaiDat = loaiDat.trim();

      const detailItem = {
        maThua,
        soThua,
        toBanDo,
        loaiDat,
      };

      // Nhóm theo Tên + Thôn
      const groupKey = `${name.toLowerCase()}___${thonXa.toLowerCase()}`;
      const existing = mapByCitizen.get(groupKey);
      if (existing) {
        if (maThua && !existing.maThuaList.includes(maThua)) existing.maThuaList.push(maThua);
        if (soThua && !existing.soThuaList.includes(soThua)) existing.soThuaList.push(soThua);
        if (toBanDo && !existing.toBanDoList.includes(toBanDo)) existing.toBanDoList.push(toBanDo);
        if (loaiDat && !existing.loaiDatList.includes(loaiDat)) existing.loaiDatList.push(loaiDat);
        if (maThua && !existing.parcelDetails.some((d) => d.maThua === maThua)) {
          existing.parcelDetails.push(detailItem);
        }
      } else {
        const cccdClean = cleanCccd(decl.chu_dat_cccd || decl.cccd || '');
        mapByCitizen.set(groupKey, {
          key: groupKey,
          name,
          maThuaList: maThua ? [maThua] : [],
          soThuaList: soThua ? [soThua] : [],
          toBanDoList: toBanDo ? [toBanDo] : [],
          loaiDatList: loaiDat ? [loaiDat] : [],
          parcelDetails: maThua ? [detailItem] : [],
          thonXa,
          cccdNumber: cccdClean.length === 12 ? cccdClean : undefined,
          deviceId: decl.device_id,
        });
      }
    }

    return Array.from(mapByCitizen.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [declarationsMap, hasCccdInR2, parcelsLoaiDatMap]);

  // Danh sách các thôn có trong danh sách kèm số lượng
  const availableVillages = useMemo(() => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < missingCccdList.length; i++) {
      const it = missingCccdList[i];
      if (it.thonXa) counts[it.thonXa] = (counts[it.thonXa] || 0) + 1;
    }

    return CANONICAL_VILLAGES.filter((v) => counts[v] && counts[v] > 0).map((v) => ({
      village: v,
      count: counts[v] || 0,
    }));
  }, [missingCccdList]);

  // Lọc theo Thôn được chọn và từ khóa tìm kiếm (sử dụng deferredSearchQuery để không đơ bàn phím điện thoại)
  const filteredCitizens = useMemo(() => {
    let list = missingCccdList;

    if (selectedVillage !== 'ALL') {
      list = list.filter((item) => item.thonXa === selectedVillage);
    }

    const q = deferredSearchQuery.toLowerCase().trim();
    if (q) {
      list = list.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.thonXa.toLowerCase().includes(q) ||
          item.maThuaList.some((mt) => mt.toLowerCase().includes(q)) ||
          item.soThuaList.some((st) => st.includes(q))
      );
    }

    return list;
  }, [missingCccdList, selectedVillage, deferredSearchQuery]);

  // TỐI ƯU CỰC ĐỘ 3: Phân đợt hiển thị cho điện thoại (chỉ render visibleCount người đầu tiên)
  const displayedCitizens = useMemo(() => {
    return filteredCitizens.slice(0, visibleCount);
  }, [filteredCitizens, visibleCount]);

  // Chia danh sách thành các cặp 2 người (4 Ô TRÊN 1 HÀNG)
  const pairedRows = useMemo(() => {
    const pairs: [MissingCccdPerson, MissingCccdPerson | null][] = [];
    for (let i = 0; i < displayedCitizens.length; i += 2) {
      pairs.push([displayedCitizens[i], displayedCitizens[i + 1] || null]);
    }
    return pairs;
  }, [displayedCitizens]);

  // Đếm thống kê
  const totalInView = filteredCitizens.length;
  const checkedInView = useMemo(() => {
    let cnt = 0;
    for (let i = 0; i < filteredCitizens.length; i++) {
      if (checkedKeys.has(filteredCitizens[i].key)) cnt++;
    }
    return cnt;
  }, [filteredCitizens, checkedKeys]);

  // Phóng to và định vị thửa đất trên bản đồ
  const handleZoomToParcel = (maThua: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!maThua) return;

    let targetParcel = parcels.find((p) => p.ma_thua === maThua);
    if (!targetParcel) {
      targetParcel = parcels.find((p) => p.so_thua === maThua);
    }

    if (targetParcel) {
      if (onZoomToParcel) {
        onZoomToParcel(targetParcel);
      }
      showToast(`📍 Đã định vị thửa đất (${targetParcel.loai_dat || targetParcel.so_thua}) trên bản đồ`);
    } else {
      showToast(`Chưa có toạ độ của thửa ${maThua}`);
    }
  };

  // Mở popup sửa tên đúng hoặc di chuyển thôn / buôn / nguồn gốc sử dụng
  const handleOpenMoveModal = (person: MissingCccdPerson) => {
    setMovingPerson(person);
    setCorrectedName(person.name);
    setTargetVillage(person.thonXa);

    let currentNguonGoc = 'Khai Hoang';
    for (const maThua of person.maThuaList) {
      const decl = declarationsMap[maThua];
      if (decl?.nguon_goc_su_dung) {
        currentNguonGoc = normalizeNguonGoc(decl.nguon_goc_su_dung);
        break;
      }
    }
    setSelectedNguonGoc(currentNguonGoc);
    setInitialNguonGoc(currentNguonGoc);
  };

  // Xác nhận sửa tên đúng, nguồn gốc sử dụng và/hoặc chuyển thôn / buôn vào Database
  const handleConfirmUpdatePerson = async () => {
    if (!movingPerson) return;

    const cleanNewName = cleanName(correctedName) || movingPerson.name;
    const finalVillage = targetVillage || movingPerson.thonXa;

    const isNameChanged = cleanNewName.toLowerCase() !== movingPerson.name.toLowerCase();
    const isVillageChanged = finalVillage !== movingPerson.thonXa;
    const isNguonGocChanged = selectedNguonGoc !== initialNguonGoc;

    if (!isNameChanged && !isVillageChanged && !isNguonGocChanged) {
      setMovingPerson(null);
      return;
    }

    setIsSavingMove(true);
    const updatedDecls: any[] = [];
    const cellEditsToSync: Record<string, Record<number, string>> = {};

    try {
      const timestamp = new Date().toISOString();

      for (const maThua of movingPerson.maThuaList) {
        const existing = declarationsMap[maThua];
        let updated: any;
        if (existing) {
          updated = {
            ...existing,
            chu_dat_ten: cleanNewName,
            chu_ho: cleanNewName,
            ho_va_ten_chu_ho: cleanNewName,
            thon_xa: finalVillage,
            dia_chi_thua_dat: finalVillage,
            chu_dat_dia_chi: finalVillage,
            nguon_goc_su_dung: selectedNguonGoc,
            updated_at: timestamp,
          };
        } else {
          const [toP, thuaP] = maThua.split('_');
          updated = {
            ma_thua: maThua,
            to_ban_do: toP || '',
            so_thua: thuaP || '',
            chu_dat_ten: cleanNewName,
            chu_ho: cleanNewName,
            ho_va_ten_chu_ho: cleanNewName,
            thon_xa: finalVillage,
            dia_chi_thua_dat: finalVillage,
            chu_dat_dia_chi: finalVillage,
            nguon_goc_su_dung: selectedNguonGoc,
            device_id: getSavedCadreName() || getOrCreateDeviceId(),
            created_at: timestamp,
            updated_at: timestamp,
          };
        }

        saveOrUpdateDeclaration(updated);
        updatedDecls.push(updated);
        cellEditsToSync[maThua] = { 0: cleanNewName, 2: finalVillage };

        onDeclarationUpdated?.(updated);
        broadcastRealtimeEvent({
          type: 'DECLARATION_SAVED',
          maThua,
          declaration: updated,
        });
      }

      if (updatedDecls.length > 0) {
        await fetch('/api/declarations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: updatedDecls, cellEdits: cellEditsToSync }),
        });
      }

      const oldKey = movingPerson.key;
      const newKey = `${cleanNewName.toLowerCase()}___${finalVillage.toLowerCase()}`;
      if (checkedKeys.has(oldKey)) {
        setCheckedKeys((prev) => {
          const next = new Set(prev);
          next.delete(oldKey);
          next.add(newKey);
          try {
            localStorage.setItem('cccd_collect_checked_keys', JSON.stringify(Array.from(next)));
          } catch {}
          return next;
        });
      }

      movingPerson.name = cleanNewName;
      movingPerson.thonXa = finalVillage;
      movingPerson.key = newKey;

      let msg = `✓ Đã cập nhật thành công: "${cleanNewName}"`;
      if (isNguonGocChanged) msg += ` [${selectedNguonGoc}]`;
      if (isVillageChanged) msg += ` sang ${finalVillage}`;
      setToastMessage(msg);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      alert(`Lỗi khi cập nhật cơ sở dữ liệu: ${err.message || err}`);
    } finally {
      setIsSavingMove(false);
      setMovingPerson(null);
    }
  };

  // Tải thêm công dân khi cuộn
  const handleLoadMore = () => {
    setVisibleCount((prev) => Math.min(prev + PAGE_BATCH_SIZE, filteredCitizens.length));
  };

  return (
    <div className="h-full w-full flex flex-col bg-white overflow-hidden select-none">
      {/* Mobile Drag Handle */}
      <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mt-2 mb-0.5 lg:hidden shrink-0" />

      {/* Top Header của Panel */}
      <div className="p-3.5 border-b border-gray-100 bg-gray-50/90 flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-black text-gray-900">
              Thu Thập <span className="text-blue-600 font-black">CCCD</span>
            </h2>
            <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200/60 inline-flex items-center gap-1 shadow-2xs">
              <Users className="w-3 h-3 text-blue-600" />
              <span>{filteredCitizens.length} người</span>
            </span>
            {isLoadingR2 && <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap">
            <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="capitalize font-medium text-gray-700">
              {selectedVillage === 'ALL' ? 'Toàn xã Cư Pui' : selectedVillage}
            </span>
            <span className="text-gray-300">•</span>
            <span className="text-[10px] font-bold bg-emerald-100/90 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-200 inline-flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              Đã thu: {checkedInView}/{totalInView}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50/80 rounded-xl transition border border-gray-200/80 shadow-2xs cursor-pointer flex items-center justify-center"
              title="Thu gọn bảng"
            >
              <ChevronLeft className="w-4 h-4 hidden lg:block" />
              <ChevronDown className="w-4 h-4 block lg:hidden" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 rounded-xl transition cursor-pointer"
            title="Đóng bảng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Thanh lọc & tìm kiếm chuẩn phản hồi nhanh (deferred search) */}
      <div className="p-3 border-b border-gray-100 bg-white space-y-2 shrink-0">
        {/* Dropdown Thôn/Buôn */}
        <div className="relative">
          <select
            value={selectedVillage}
            onChange={(e) => handleSelectVillage(e.target.value)}
            className="w-full pl-3 pr-8 py-2 rounded-xl border border-gray-200 text-xs font-bold bg-gray-50/70 text-gray-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition cursor-pointer appearance-none shadow-2xs"
          >
            <option value="ALL">-- Tất cả Thôn / Buôn ({missingCccdList.length} người) --</option>
            {availableVillages.map((v) => (
              <option key={v.village} value={v.village}>
                {v.village} ({v.count} người cần thu)
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Ô tìm kiếm họ tên & số thửa - Mượt mà trên điện thoại */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleCount(PAGE_BATCH_SIZE);
              }}
              placeholder="Tìm tên chủ đất, số thửa..."
              className="w-full pl-7 pr-3 py-1.5 rounded-xl border border-gray-200 text-xs bg-gray-50/70 text-gray-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition"
            />
          </div>

          <div className="px-2.5 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-[11px] font-black text-blue-700 shrink-0 shadow-2xs">
            {totalInView > 0 ? `${Math.round((checkedInView / totalInView) * 100)}%` : '0%'}
          </div>
        </div>
      </div>

      {/* Thông báo Toast */}
      {toastMessage && (
        <div className="px-3.5 py-2 bg-emerald-600 text-white text-xs font-bold flex items-center justify-between shrink-0 shadow-xs animate-in fade-in">
          <span className="truncate">{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-white hover:opacity-80 ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* THÂN BẢNG: 4 Ô / HÀNG - TỐI ƯU CỰC MƯỢT TRÊN ĐIỆN THOẠI */}
      <div 
        className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 bg-gray-50/70 overscroll-contain"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
            if (visibleCount < filteredCitizens.length) {
              handleLoadMore();
            }
          }
        }}
      >
        {pairedRows.length === 0 ? (
          <div className="py-12 text-center text-gray-400 space-y-2">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500 stroke-[1.5]" />
            <p className="text-xs font-bold text-gray-800">
              Không có công dân nào cần thu CCCD
            </p>
            <p className="text-[11px] text-gray-500 max-w-xs mx-auto">
              {selectedVillage !== 'ALL'
                ? `Toàn bộ công dân đã kê khai ở ${selectedVillage} đều đã có file CCCD trên R2.`
                : 'Tất cả các thửa đã kê khai đều đã có file CCCD.'}
            </p>
          </div>
        ) : (
          <div className="w-full border border-gray-200 rounded-xl overflow-hidden bg-white shadow-xs">
            <table className="table-fixed w-full border-collapse border border-gray-200 text-xs">
              <thead>
                <tr className="bg-gray-50/90 text-gray-600 font-black border-b border-gray-200 text-[10px] uppercase tracking-wide">
                  <th className="border border-gray-200 px-2 py-1.5 text-left w-[calc(50%-28px)] truncate">
                    Họ và Tên
                  </th>
                  <th className="border border-gray-200 px-0.5 py-1.5 text-center w-[28px]">
                    Thu
                  </th>
                  <th className="border border-gray-200 px-2 py-1.5 text-left w-[calc(50%-28px)] truncate">
                    Họ và Tên
                  </th>
                  <th className="border border-gray-200 px-0.5 py-1.5 text-center w-[28px]">
                    Thu
                  </th>
                </tr>
              </thead>
              <tbody>
                {pairedRows.map((pair, rIdx) => {
                  const p1 = pair[0];
                  const p2 = pair[1];
                  const isChecked1 = checkedKeys.has(p1.key);
                  const isChecked2 = p2 ? checkedKeys.has(p2.key) : false;

                  return (
                    <tr
                      key={rIdx}
                      className="transition-colors hover:bg-blue-50/30"
                      style={{ contentVisibility: 'auto' }}
                    >
                      {/* Ô 1: Họ tên người 1 */}
                      <td
                        onClick={() => handleOpenMoveModal(p1)}
                        className={`border border-gray-200 px-2 py-1.5 cursor-pointer transition select-none overflow-hidden ${
                          isChecked1
                            ? 'bg-emerald-50 text-emerald-950 font-bold border-emerald-200'
                            : 'bg-white text-gray-900'
                        }`}
                        title="Bấm để sửa tên đúng hoặc chuyển thôn / buôn"
                      >
                        <div className="font-black uppercase tracking-tight text-[11px] leading-tight truncate text-gray-900">
                          {p1.name}
                        </div>
                        <div className="flex items-center justify-between text-[10px] leading-none mt-1 text-gray-500">
                          <span className="font-mono bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-200 truncate">
                            {`${Math.max(p1.maThuaList.length, p1.soThuaList.length, 1)} thửa`}
                          </span>
                          <ArrowRightLeft className="w-2.5 h-2.5 text-gray-400 shrink-0 ml-auto" />
                        </div>
                      </td>

                      {/* Ô 2: Checkbox thu xong người 1 */}
                      <td
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleCheck(p1.key);
                        }}
                        className={`border border-gray-200 text-center cursor-pointer select-none p-1 transition w-[28px] active:scale-90 ${
                          isChecked1 ? 'bg-emerald-50' : 'bg-white'
                        }`}
                        title={isChecked1 ? 'Đã thu CCCD (bấm để hủy)' : 'Chưa thu CCCD (bấm để đánh dấu đã thu)'}
                      >
                        <div
                          className={`w-4 h-4 mx-auto rounded flex items-center justify-center transition-all ${
                            isChecked1
                              ? 'bg-blue-600 text-white shadow-2xs'
                              : 'border border-gray-300 bg-white hover:border-blue-400'
                          }`}
                        >
                          {isChecked1 && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </td>

                      {/* Ô 3: Họ tên người 2 (hoặc ô trống) */}
                      {p2 ? (
                        <>
                          <td
                            onClick={() => handleOpenMoveModal(p2)}
                            className={`border border-gray-200 px-2 py-1.5 cursor-pointer transition select-none overflow-hidden ${
                              isChecked2
                                ? 'bg-emerald-50 text-emerald-950 font-bold border-emerald-200'
                                : 'bg-white text-gray-900'
                            }`}
                            title="Bấm để sửa tên đúng hoặc chuyển thôn / buôn"
                          >
                            <div className="font-black uppercase tracking-tight text-[11px] leading-tight truncate text-gray-900">
                              {p2.name}
                            </div>
                            <div className="flex items-center justify-between text-[10px] leading-none mt-1 text-gray-500">
                                <span className="font-mono bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-200 truncate">
                                  {`${Math.max(p2.maThuaList.length, p2.soThuaList.length, 1)} thửa`}
                                </span>
                                <ArrowRightLeft className="w-2.5 h-2.5 text-gray-400 shrink-0 ml-auto" />
                              </div>
                          </td>

                          {/* Ô 4: Checkbox thu xong người 2 */}
                          <td
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleCheck(p2.key);
                            }}
                            className={`border border-gray-200 text-center cursor-pointer select-none p-1 transition w-[28px] active:scale-90 ${
                              isChecked2 ? 'bg-emerald-50' : 'bg-white'
                            }`}
                            title={isChecked2 ? 'Đã thu CCCD (bấm để hủy)' : 'Chưa thu CCCD (bấm để đánh dấu đã thu)'}
                          >
                            <div
                              className={`w-4 h-4 mx-auto rounded flex items-center justify-center transition-all ${
                                isChecked2
                                  ? 'bg-blue-600 text-white shadow-2xs'
                                  : 'border border-gray-300 bg-white hover:border-blue-400'
                              }`}
                            >
                              {isChecked2 && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="border border-gray-200 bg-gray-50/50"></td>
                          <td className="border border-gray-200 bg-gray-50/50"></td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Nút xem thêm nếu còn */}
            {visibleCount < filteredCitizens.length && (
              <div className="p-2 bg-gray-50 border-t border-gray-200 text-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold transition cursor-pointer"
                >
                  Xem thêm ({filteredCitizens.length - visibleCount} người nữa)...
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer mỏng dưới cùng với style màu chuẩn */}
      <div className="p-3 border-t border-gray-100 bg-gray-50/90 flex items-center justify-between text-xs text-gray-600 shrink-0">
        <div className="flex items-center gap-1.5">
          <span>Tổng số: </span>
          <strong className="text-gray-900 font-black">{filteredCitizens.length}</strong>
          <span className="text-gray-300">•</span>
          <span>Đã thu: </span>
          <strong className="text-emerald-600 font-black">{checkedInView}</strong>
        </div>

        <button
          type="button"
          onClick={onToggleCollapse || onClose}
          className="px-3 py-1.5 rounded-xl bg-white hover:bg-gray-100 text-gray-700 font-bold text-xs border border-gray-200 shadow-2xs transition cursor-pointer"
        >
          Thu gọn
        </button>
      </div>

      {/* SUB-MODAL: SỬA TÊN ĐÚNG, NGUỒN GỐC & CHUYỂN THÔN BUÔN */}
      {movingPerson && (() => {
        const cleanNewName = cleanName(correctedName);
        const isNameChanged = cleanNewName && cleanNewName.toLowerCase() !== movingPerson.name.toLowerCase();
        const isVillageChanged = targetVillage && targetVillage !== movingPerson.thonXa;
        const isNguonGocChanged = selectedNguonGoc !== initialNguonGoc;
        const canSave = (isNameChanged || isVillageChanged || isNguonGocChanged) && cleanNewName.length >= 2;

        return (
          <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center p-3 pb-6 sm:p-4 bg-black/40 backdrop-blur-2xs animate-in fade-in">
            <div className="w-full max-w-sm p-4 rounded-2xl border border-gray-200 shadow-2xl bg-white space-y-3 animate-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-200/60 shadow-2xs">
                    <ArrowRightLeft className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase text-gray-900">
                      Cập Nhật Thông Tin Thửa
                    </h3>
                    <p className="text-[10px] text-gray-500">Sửa tên, nguồn gốc & thôn buôn</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMovingPerson(null)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {/* Thông tin hiện tại */}
                <div className="p-2.5 rounded-xl bg-gray-50/90 border border-gray-100 space-y-1 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Tên hiện tại:</span>
                    <strong className="uppercase text-gray-700 font-bold">
                      {movingPerson.name}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Thôn hiện tại:</span>
                    <span className="font-bold text-rose-600">{movingPerson.thonXa}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-gray-500 font-medium">Loại đất:</span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {movingPerson.parcelDetails && movingPerson.parcelDetails.length > 0 ? (
                        movingPerson.parcelDetails.map((pd, pdIdx) => {
                          const loaiDatDisplay = pd.loaiDat
                            ? `(${pd.loaiDat})`
                            : (pd.soThua ? `(Thửa ${pd.soThua})` : '(Đất)');
                          return (
                            <button
                              key={pdIdx}
                              type="button"
                              onClick={() => handleZoomToParcel(pd.maThua)}
                              className="inline-flex items-center px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-black rounded-lg border border-blue-200 text-xs transition cursor-pointer shadow-2xs active:scale-95"
                              title="Bấm để định vị thửa đất này trên bản đồ"
                            >
                              <span>{loaiDatDisplay}</span>
                              <MapPin className="w-2.5 h-2.5 ml-0.5 text-blue-600" />
                            </button>
                          );
                        })
                      ) : (
                        <span className="text-gray-400">Chưa rõ</span>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Số thửa đất:</span>
                    <span className="font-black text-gray-900">
                      {movingPerson.soThuaList.join(', ') || movingPerson.maThuaList.join(', ')}
                    </span>
                  </div>
                </div>

                {/* Trường 1: Sửa lại tên đúng chuẩn */}
                <div>
                  <label className="block text-[11px] font-bold mb-1 text-gray-700">
                    Sửa lại họ và tên đúng (nếu sai chính tả):
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={correctedName}
                      onChange={(e) => setCorrectedName(e.target.value)}
                      placeholder="Nhập họ và tên đúng..."
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold uppercase bg-white text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition shadow-2xs"
                    />
                  </div>
                  {isNameChanged && (
                    <p className="text-[10px] text-blue-600 font-bold mt-1 flex items-center gap-1">
                      <span>✓ Tên mới:</span>
                      <strong className="uppercase">{cleanNewName}</strong>
                    </p>
                  )}
                </div>

                {/* Trường 2: Chọn kiểu Nguồn gốc sử dụng (Mặc định từ đơn, 4 options) */}
                <div>
                  <label className="block text-[11px] font-bold mb-1 text-gray-700 flex items-center justify-between">
                    <span>Nguồn gốc sử dụng đất:</span>
                    <span className="text-[10px] text-blue-600 font-bold">
                      {selectedNguonGoc} {selectedNguonGoc === initialNguonGoc ? '(Trong đơn)' : '(Đã đổi)'}
                    </span>
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {NGUON_GOC_OPTIONS.map((opt) => (
                      <button
                        type="button"
                        key={opt}
                        onClick={() => setSelectedNguonGoc(opt)}
                        className={`py-1.5 px-0.5 rounded-xl border text-[11px] font-bold transition text-center cursor-pointer ${
                          selectedNguonGoc === opt
                            ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                            : 'bg-gray-50/80 text-gray-700 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Trường 3: Chọn Thôn / Buôn mới */}
                <div>
                  <label className="block text-[11px] font-bold mb-1 text-gray-700">
                    Chọn Thôn / Buôn mới để chuyển:
                  </label>
                  <div className="relative">
                    <select
                      value={targetVillage}
                      onChange={(e) => setTargetVillage(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold bg-gray-50/70 text-gray-900 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition appearance-none cursor-pointer"
                    >
                      {CANONICAL_VILLAGES.filter((v) => v !== 'Chưa xác định').map((v) => (
                        <option key={v} value={v}>
                          {v} {v === movingPerson.thonXa ? '(Hiện tại)' : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  disabled={isSavingMove}
                  onClick={() => setMovingPerson(null)}
                  className="px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={isSavingMove || !canSave}
                  onClick={handleConfirmUpdatePerson}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-black shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  {isSavingMove ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang lưu...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Xác nhận</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
