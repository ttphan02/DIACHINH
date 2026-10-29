'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
} from 'lucide-react';
import { Parcel, DeclarationFormData } from '@/types';
import { getOrCreateDeviceId, getSavedCadreName, saveOrUpdateDeclaration } from '@/utils/declaration';
import { broadcastRealtimeEvent } from '@/utils/realtimeSync';
import { cleanCccd, stripAccents, CANONICAL_VILLAGES, getCanonicalVillage } from '@/utils/textHelpers';
import parcelsBriefData from '@/data/parcels_brief.json';

const parcelsBrief = parcelsBriefData as unknown as Record<string, [string, string, string, number]>;

export interface CccdCollectPanelProps {
  onClose: () => void;
  parcels: Parcel[];
  declarationsMap: Record<string, DeclarationFormData | any>;
  theme?: 'dark' | 'light';
  onDeclarationUpdated?: (updatedDecl: any) => void;
  onToggleCollapse?: () => void;
}

interface MissingCccdPerson {
  key: string;
  name: string;
  maThuaList: string[];
  soThuaList: string[];
  toBanDoList: string[];
  thonXa: string;
  cccdNumber?: string;
  deviceId?: string;
}

export default function CccdCollectPanel({
  onClose,
  parcels,
  declarationsMap,
  theme = 'light',
  onDeclarationUpdated,
  onToggleCollapse,
}: CccdCollectPanelProps) {
  const isLight = theme === 'light';

  // Lọc tìm kiếm & Thôn / Buôn
  const [selectedVillage, setSelectedVillage] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Danh sách CCCD & Tên file đã có trên Cloudflare R2
  const [existingCccdSet, setExistingCccdSet] = useState<Set<string>>(new Set());
  const [r2Filenames, setR2Filenames] = useState<string[]>([]);
  const [isLoadingR2, setIsLoadingR2] = useState(false);

  // Trạng thái đã tích chọn (lưu bền vững vào localStorage)
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());

  // Sub-modal di chuyển thôn / buôn
  const [movingPerson, setMovingPerson] = useState<MissingCccdPerson | null>(null);
  const [targetVillage, setTargetVillage] = useState<string>('');
  const [isSavingMove, setIsSavingMove] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
    try {
      localStorage.setItem('cccd_collect_selected_village', village);
    } catch {}
  };

  // Toggle trạng thái Đã thu thập (checkbox) và lưu vào localStorage
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

  // Kiểm tra 1 người đã có CCCD trên R2 hay chưa
  const hasCccdInR2 = useCallback(
    (decl: any, personName: string): boolean => {
      // 1. Nếu phiếu kê khai đã có liên kết file CCCD R2
      if (decl.cccd_url || decl.file_cccd_pdf || decl.cccd_file) {
        return true;
      }

      // 2. Nếu số CCCD đã có trong R2 Set
      const rawCccd = decl.chu_dat_cccd || decl.cccd_chu_ho || decl.cccd || '';
      const cccdClean = cleanCccd(rawCccd);
      if (cccdClean.length === 12 && existingCccdSet.has(cccdClean)) {
        return true;
      }
      if (cccdClean.length === 9 && existingCccdSet.has(cccdClean)) {
        return true;
      }

      // 3. Khớp tên file trên R2
      if (personName && r2Filenames.length > 0) {
        const normName = stripAccents(personName).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normName.length >= 4) {
          const matched = r2Filenames.some((fn) => {
            const normFn = stripAccents(fn).toLowerCase().replace(/[^a-z0-9]/g, '');
            return normFn.includes(normName);
          });
          if (matched) return true;
        }
      }

      return false;
    },
    [existingCccdSet, r2Filenames]
  );

  // Lập danh sách công dân ĐÃ KÊ KHAI nhưng CHƯA CÓ CCCD TRÊN R2
  // (Nếu đã có CCCD trên R2 thì tự động LOẠI BỎ khỏi danh sách này)
  const missingCccdList = useMemo(() => {
    const mapByCitizen = new Map<string, MissingCccdPerson>();

    Object.entries(declarationsMap).forEach(([parcelCode, decl]) => {
      if (!decl) return;

      const name = String(decl.chu_dat_ten || decl.chu_ho || '').trim();
      if (!name || name === 'Chưa có tên') return;

      // NẾU TÊN NÀO ĐÃ CÓ CCCD TRONG R2 THÌ BỎ TÊN ĐÓ KHỎI DANH SÁCH
      if (hasCccdInR2(decl, name)) {
        return;
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

      // Nhóm theo Tên + Thôn
      const groupKey = `${name.toLowerCase()}___${thonXa.toLowerCase()}`;
      if (mapByCitizen.has(groupKey)) {
        const existing = mapByCitizen.get(groupKey)!;
        if (maThua && !existing.maThuaList.includes(maThua)) existing.maThuaList.push(maThua);
        if (soThua && !existing.soThuaList.includes(soThua)) existing.soThuaList.push(soThua);
        if (toBanDo && !existing.toBanDoList.includes(toBanDo)) existing.toBanDoList.push(toBanDo);
      } else {
        const cccdClean = cleanCccd(decl.chu_dat_cccd || decl.cccd || '');
        mapByCitizen.set(groupKey, {
          key: groupKey,
          name,
          maThuaList: maThua ? [maThua] : [],
          soThuaList: soThua ? [soThua] : [],
          toBanDoList: toBanDo ? [toBanDo] : [],
          thonXa,
          cccdNumber: cccdClean.length === 12 ? cccdClean : undefined,
          deviceId: decl.device_id,
        });
      }
    });

    return Array.from(mapByCitizen.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [declarationsMap, hasCccdInR2]);

  // Danh sách các thôn có trong danh sách kèm số lượng
  const availableVillages = useMemo(() => {
    const counts: Record<string, number> = {};
    missingCccdList.forEach((i) => {
      if (i.thonXa) counts[i.thonXa] = (counts[i.thonXa] || 0) + 1;
    });

    return CANONICAL_VILLAGES.filter((v) => counts[v] && counts[v] > 0).map((v) => ({
      village: v,
      count: counts[v] || 0,
    }));
  }, [missingCccdList]);

  // Lọc theo Thôn được chọn và từ khóa tìm kiếm
  const filteredCitizens = useMemo(() => {
    let list = missingCccdList;

    if (selectedVillage !== 'ALL') {
      list = list.filter((item) => item.thonXa === selectedVillage);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.thonXa.toLowerCase().includes(q) ||
          item.maThuaList.some((mt) => mt.toLowerCase().includes(q)) ||
          item.soThuaList.some((st) => st.includes(q))
      );
    }

    return list;
  }, [missingCccdList, selectedVillage, searchQuery]);

  // Chia danh sách thành các cặp 2 người (TỐI THIỂU 4 Ô TRÊN 1 HÀNG)
  // Vừa khít 100% chiều rộng của form (420px / điện thoại), không bị tràn ngang
  const pairedRows = useMemo(() => {
    const pairs: [MissingCccdPerson, MissingCccdPerson | null][] = [];
    for (let i = 0; i < filteredCitizens.length; i += 2) {
      pairs.push([filteredCitizens[i], filteredCitizens[i + 1] || null]);
    }
    return pairs;
  }, [filteredCitizens]);

  // Đếm thống kê
  const totalInView = filteredCitizens.length;
  const checkedInView = filteredCitizens.filter((p) => checkedKeys.has(p.key)).length;

  // Mở popup di chuyển thôn / buôn
  const handleOpenMoveModal = (person: MissingCccdPerson) => {
    setMovingPerson(person);
    setTargetVillage(person.thonXa);
  };

  // Xác nhận di chuyển thôn / buôn và cập nhật vào Database
  const handleConfirmMoveVillage = async () => {
    if (!movingPerson || !targetVillage || targetVillage === movingPerson.thonXa) {
      setMovingPerson(null);
      return;
    }

    setIsSavingMove(true);
    const updatedDecls: any[] = [];
    const cellEditsToSync: Record<string, Record<number, string>> = {};

    try {
      const timestamp = new Date().toISOString();

      // Cập nhật tất cả các thửa đất của công dân này
      for (const maThua of movingPerson.maThuaList) {
        const existing = declarationsMap[maThua];
        let updated: any;
        if (existing) {
          updated = {
            ...existing,
            thon_xa: targetVillage,
            dia_chi_thua_dat: targetVillage,
            chu_dat_dia_chi: targetVillage,
            updated_at: timestamp,
          };
        } else {
          const [toP, thuaP] = maThua.split('_');
          updated = {
            ma_thua: maThua,
            to_ban_do: toP || '',
            so_thua: thuaP || '',
            chu_dat_ten: movingPerson.name,
            chu_ho: movingPerson.name,
            thon_xa: targetVillage,
            dia_chi_thua_dat: targetVillage,
            chu_dat_dia_chi: targetVillage,
            device_id: getSavedCadreName() || getOrCreateDeviceId(),
            created_at: timestamp,
            updated_at: timestamp,
          };
        }

        saveOrUpdateDeclaration(updated);
        updatedDecls.push(updated);
        cellEditsToSync[maThua] = { 2: targetVillage };

        onDeclarationUpdated?.(updated);
        broadcastRealtimeEvent({
          type: 'DECLARATION_SAVED',
          maThua,
          declaration: updated,
        });
      }

      // Lưu lên Cloudflare R2 & D1 Database qua API /api/declarations
      if (updatedDecls.length > 0) {
        await fetch('/api/declarations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: updatedDecls }),
        });

        await fetch('/api/declarations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'cell_edits', cellEdits: cellEditsToSync }),
        });
      }

      // Cập nhật trạng thái check key
      const oldKey = movingPerson.key;
      const newKey = `${movingPerson.name.toLowerCase()}___${targetVillage.toLowerCase()}`;
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

      movingPerson.thonXa = targetVillage;
      movingPerson.key = newKey;

      setToastMessage(`✓ Đã chuyển "${movingPerson.name}" sang ${targetVillage}!`);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      alert(`Lỗi khi cập nhật cơ sở dữ liệu: ${err.message || err}`);
    } finally {
      setIsSavingMove(false);
      setMovingPerson(null);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-slate-900 overflow-hidden select-none">
      {/* Mobile Drag Handle */}
      <div className="w-12 h-1.5 bg-gray-300 dark:bg-slate-700 rounded-full mx-auto mt-2 mb-0.5 lg:hidden shrink-0" />

      {/* Top Header của Panel - Giống hệt form kê khai thửa */}
      <div className="p-3 border-b border-gray-100 dark:border-slate-800 bg-gray-50/90 dark:bg-slate-950/70 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black text-gray-900 dark:text-white uppercase truncate flex items-center gap-1.5">
              <span>Thu Thập CCCD</span>
              {isLoadingR2 && <RefreshCw className="w-3 h-3 text-cyan-500 animate-spin" />}
            </h2>
            <p className="text-[10px] text-gray-500 dark:text-slate-400 truncate">
              {selectedVillage === 'ALL' ? 'Toàn xã Cư Pui' : selectedVillage} • {checkedInView}/{totalInView} đã thu
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-800 transition cursor-pointer"
            title="Đóng bảng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Thanh lọc Thôn / Buôn & Tìm kiếm - Vừa vặn 100% chiều rộng form */}
      <div className="p-2 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5 shrink-0">
        {/* Dropdown Thôn/Buôn (Có lưu vào localStorage) */}
        <div className="relative">
          <select
            value={selectedVillage}
            onChange={(e) => handleSelectVillage(e.target.value)}
            className="w-full pl-2.5 pr-7 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-bold bg-gray-50 dark:bg-slate-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer appearance-none"
          >
            <option value="ALL">-- Tất cả Thôn / Buôn ({missingCccdList.length} người) --</option>
            {availableVillages.map((v) => (
              <option key={v.village} value={v.village}>
                {v.village} ({v.count} người cần thu)
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Ô tìm kiếm họ tên & số thửa */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3 h-3 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên, số thửa..."
              className="w-full pl-6 pr-2 py-1 rounded-lg border border-gray-200 dark:border-slate-700 text-xs bg-gray-50 dark:bg-slate-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[10px] font-black text-emerald-700 dark:text-emerald-300 shrink-0">
            {totalInView > 0 ? `${Math.round((checkedInView / totalInView) * 100)}%` : '0%'}
          </div>
        </div>
      </div>

      {/* Thông báo Toast khi di chuyển thành công */}
      {toastMessage && (
        <div className="px-3 py-1.5 bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-between shrink-0 shadow-xs">
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

      {/* THÂN BẢNG: DANH SÁCH 4 Ô / HÀNG - VỪA KHÍT 100% FORM KHÔNG TRÀN NGANG */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-1.5 bg-gray-50/50 dark:bg-slate-950/30">
        {pairedRows.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500 space-y-1.5">
            <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 stroke-[1.5]" />
            <p className="text-xs font-bold text-gray-700 dark:text-slate-300">
              Không có công dân nào cần thu CCCD
            </p>
            <p className="text-[10px] text-gray-500 dark:text-slate-500 max-w-xs mx-auto">
              {selectedVillage !== 'ALL'
                ? `Toàn bộ công dân đã kê khai ở ${selectedVillage} đều đã có file CCCD trên R2.`
                : 'Tất cả các thửa đã kê khai đều đã có file CCCD.'}
            </p>
          </div>
        ) : (
          <div className="w-full border border-gray-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
            <table className="table-fixed w-full border-collapse border border-gray-200 dark:border-slate-800 text-xs">
              <thead>
                <tr className="bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 font-black border-b border-gray-200 dark:border-slate-800 text-[10px] uppercase">
                  <th className="border border-gray-200 dark:border-slate-800 px-1.5 py-1 text-left w-[calc(50%-28px)] truncate">
                    Họ và Tên
                  </th>
                  <th className="border border-gray-200 dark:border-slate-800 px-0.5 py-1 text-center w-[28px]">
                    Thu
                  </th>
                  <th className="border border-gray-200 dark:border-slate-800 px-1.5 py-1 text-left w-[calc(50%-28px)] truncate">
                    Họ và Tên
                  </th>
                  <th className="border border-gray-200 dark:border-slate-800 px-0.5 py-1 text-center w-[28px]">
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
                      className="transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/40"
                    >
                      {/* Ô 1: Họ tên người 1 (Bấm vào để mở form chuyển Thôn / Buôn) */}
                      <td
                        onClick={() => handleOpenMoveModal(p1)}
                        className={`border border-gray-200 dark:border-slate-800 px-1.5 py-1.5 cursor-pointer transition select-none overflow-hidden ${
                          isChecked1
                            ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-950 dark:text-emerald-100 font-bold'
                            : 'bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-100'
                        }`}
                        title="Bấm để chuyển thôn / buôn khác"
                      >
                        <div className="font-bold uppercase tracking-tight text-[11px] leading-tight truncate">
                          {p1.name}
                        </div>
                        <div className="flex items-center justify-between text-[9px] text-gray-400 dark:text-slate-500 leading-none mt-0.5">
                          <span className="truncate">
                            {p1.soThuaList.length > 0 ? `T${p1.soThuaList.join(',')}` : p1.thonXa}
                          </span>
                          <ArrowRightLeft className="w-2.5 h-2.5 text-gray-400 shrink-0 ml-0.5" />
                        </div>
                      </td>

                      {/* Ô 2: Checkbox thu xong người 1 */}
                      <td
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCheck(p1.key);
                        }}
                        className={`border border-gray-200 dark:border-slate-800 text-center cursor-pointer select-none p-0.5 transition w-[28px] ${
                          isChecked1
                            ? 'bg-emerald-100 dark:bg-emerald-950/70'
                            : 'bg-white dark:bg-slate-900'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked1}
                          onChange={() => toggleCheck(p1.key)}
                          className="w-3.5 h-3.5 text-emerald-600 rounded border-gray-300 focus:ring-0 cursor-pointer accent-emerald-600 mx-auto"
                        />
                      </td>

                      {/* Ô 3: Họ tên người 2 (hoặc ô trống) */}
                      {p2 ? (
                        <>
                          <td
                            onClick={() => handleOpenMoveModal(p2)}
                            className={`border border-gray-200 dark:border-slate-800 px-1.5 py-1.5 cursor-pointer transition select-none overflow-hidden ${
                              isChecked2
                                ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-950 dark:text-emerald-100 font-bold'
                                : 'bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-100'
                            }`}
                            title="Bấm để chuyển thôn / buôn khác"
                          >
                            <div className="font-bold uppercase tracking-tight text-[11px] leading-tight truncate">
                              {p2.name}
                            </div>
                            <div className="flex items-center justify-between text-[9px] text-gray-400 dark:text-slate-500 leading-none mt-0.5">
                              <span className="truncate">
                                {p2.soThuaList.length > 0 ? `T${p2.soThuaList.join(',')}` : p2.thonXa}
                              </span>
                              <ArrowRightLeft className="w-2.5 h-2.5 text-gray-400 shrink-0 ml-0.5" />
                            </div>
                          </td>

                          {/* Ô 4: Checkbox thu xong người 2 */}
                          <td
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCheck(p2.key);
                            }}
                            className={`border border-gray-200 dark:border-slate-800 text-center cursor-pointer select-none p-0.5 transition w-[28px] ${
                              isChecked2
                                ? 'bg-emerald-100 dark:bg-emerald-950/70'
                                : 'bg-white dark:bg-slate-900'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked2}
                              onChange={() => toggleCheck(p2.key)}
                              className="w-3.5 h-3.5 text-emerald-600 rounded border-gray-300 focus:ring-0 cursor-pointer accent-emerald-600 mx-auto"
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="border border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/40"></td>
                          <td className="border border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/40"></td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer mỏng dưới cùng */}
      <div className="p-2 border-t border-gray-100 dark:border-slate-800 bg-gray-50/90 dark:bg-slate-950/70 flex items-center justify-between text-[11px] text-gray-500 dark:text-slate-400 shrink-0">
        <div>
          <span>Tổng: </span>
          <strong className="text-gray-900 dark:text-white font-bold">{filteredCitizens.length}</strong>
          {' • '}
          <span>Đã thu: </span>
          <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{checkedInView}</strong>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 rounded-md bg-gray-200 dark:bg-slate-800 hover:bg-gray-300 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-200 font-bold text-[10px] transition cursor-pointer"
        >
          Thu gọn
        </button>
      </div>

      {/* SUB-MODAL: DI CHUYỂN TÊN ĐẾN THÔN BUÔN KHÁC */}
      {movingPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-2xs animate-in fade-in">
          <div className="w-full max-w-sm p-4 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-2xl bg-white dark:bg-slate-900 space-y-3 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-2">
              <div className="flex items-center gap-1.5">
                <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase text-gray-900 dark:text-white">
                    Chuyển Thôn / Buôn
                  </h3>
                  <p className="text-[10px] text-gray-500">Cập nhật thôn vào database</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMovingPerson(null)}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-slate-800/80 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-gray-400">Họ và tên:</span>
                  <strong className="uppercase text-indigo-600 dark:text-indigo-400">
                    {movingPerson.name}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Thôn hiện tại:</span>
                  <span className="font-semibold text-rose-500">{movingPerson.thonXa}</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-1 text-gray-700 dark:text-slate-300">
                  Chọn Thôn / Buôn mới:
                </label>
                <select
                  value={targetVillage}
                  onChange={(e) => setTargetVillage(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-bold bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {CANONICAL_VILLAGES.filter((v) => v !== 'Chưa xác định').map((v) => (
                    <option key={v} value={v}>
                      {v} {v === movingPerson.thonXa ? '(Hiện tại)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-slate-800">
              <button
                type="button"
                disabled={isSavingMove}
                onClick={() => setMovingPerson(null)}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-bold hover:bg-gray-100 dark:hover:bg-slate-800 transition"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSavingMove || targetVillage === movingPerson.thonXa}
                onClick={handleConfirmMoveVillage}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-xs transition flex items-center gap-1 cursor-pointer"
              >
                {isSavingMove ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Đang lưu...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3 h-3" />
                    <span>Xác nhận</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
