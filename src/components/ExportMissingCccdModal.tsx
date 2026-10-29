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
  FileSpreadsheet,
  AlertCircle,
} from 'lucide-react';
import { Parcel, DeclarationFormData } from '@/types';
import { getOrCreateDeviceId, getSavedCadreName, saveOrUpdateDeclaration } from '@/utils/declaration';
import { broadcastRealtimeEvent } from '@/utils/realtimeSync';
import { cleanCccd, stripAccents, CANONICAL_VILLAGES, getCanonicalVillage } from '@/utils/textHelpers';
import parcelsBriefData from '@/data/parcels_brief.json';

const parcelsBrief = parcelsBriefData as unknown as Record<string, [string, string, string, number]>;

interface ExportMissingCccdModalProps {
  isOpen: boolean;
  onClose: () => void;
  parcels: Parcel[];
  declarationsMap: Record<string, DeclarationFormData | any>;
  theme?: 'dark' | 'light';
  onDeclarationUpdated?: (updatedDecl: any) => void;
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

export default function ExportMissingCccdModal({
  isOpen,
  onClose,
  parcels,
  declarationsMap,
  theme = 'dark',
  onDeclarationUpdated,
}: ExportMissingCccdModalProps) {
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

  // 1. Phục hồi trạng thái đã chọn từ localStorage khi mở modal
  useEffect(() => {
    if (!isOpen) return;

    try {
      const savedVillage = localStorage.getItem('cccd_collect_selected_village');
      if (savedVilageValid(savedVillage)) {
        setSelectedVillage(savedVillage!);
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
  }, [isOpen]);

  function savedVilageValid(v: string | null): boolean {
    if (!v) return false;
    return v === 'ALL' || CANONICAL_VILLAGES.includes(v);
  }

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

  // Lưu trạng thái Thôn được chọn vào localStorage
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

    // Liệt kê theo đúng thứ tự các thôn buôn chuẩn của xã Cư Pui
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

  // Chia danh sách thành các cặp 2 người để tạo ra TỐI THIỂU 4 Ô TRÊN 1 HÀNG
  // (Ô 1: Tên người 1 | Ô 2: Checkbox 1 | Ô 3: Tên người 2 | Ô 4: Checkbox 2)
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

        // Báo cho các component khác biết qua callback và Realtime Broadcast
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

      // Cập nhật trạng thái check key nếu key có chứa tên thôn
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

      // Cập nhật trực tiếp đối tượng người trong bộ nhớ
      movingPerson.thonXa = targetVillage;
      movingPerson.key = newKey;

      setToastMessage(`✓ Đã di chuyển "${movingPerson.name}" sang ${targetVillage} thành công!`);
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err: any) {
      alert(`Lỗi khi cập nhật cơ sở dữ liệu: ${err.message || err}`);
    } finally {
      setIsSavingMove(false);
      setMovingPerson(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xs animate-in fade-in">
      {/* Container: Trên Mobile trượt từ dưới lên như form kê khai đất đai; Trên Desktop là hộp thoại cân đối */}
      <div
        className={`relative w-full sm:max-w-4xl max-h-[92vh] sm:h-[86vh] flex flex-col rounded-t-3xl sm:rounded-2xl border shadow-2xl overflow-hidden transition-all duration-300 ease-out animate-in slide-in-from-bottom sm:slide-in-from-bottom-4 ${
          isLight
            ? 'bg-white border-slate-200 text-slate-800'
            : 'bg-slate-900 border-slate-700/80 text-slate-100'
        }`}
      >
        {/* Nút kéo / pill handle trên màn hình điện thoại */}
        <div className="w-full flex items-center justify-center pt-2.5 pb-1 sm:hidden shrink-0">
          <div className="w-12 h-1.5 bg-slate-400/50 dark:bg-slate-600 rounded-full" />
        </div>

        {/* Header Modal */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-600/15 text-rose-500 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black uppercase tracking-tight">
                  Danh Sách Thu Thập CCCD
                </h2>
                {isLoadingR2 && (
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Nhấn vào ô tên để di chuyển sang thôn khác • Tích xanh khi đã thu xong
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thanh công cụ: Chọn Thôn / Buôn, Tìm kiếm & Thống kê */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3">
            {/* Dropdown chọn Thôn/Buôn (Có lưu vào localStorage) */}
            <div className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-1.5 text-xs shrink-0 font-bold text-slate-600 dark:text-slate-300">
                <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>Thôn/Buôn:</span>
              </div>
              <select
                value={selectedVillage}
                onChange={(e) => handleSelectVillage(e.target.value)}
                className={`flex-1 sm:max-w-xs px-3 py-1.5 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer ${
                  isLight
                    ? 'bg-slate-50 border-slate-300 text-slate-800'
                    : 'bg-slate-800 border-slate-700 text-slate-100'
                }`}
              >
                <option value="ALL">
                  -- Tất cả 16 Thôn / Buôn ({missingCccdList.length} người) --
                </option>
                {availableVillages.map((v) => (
                  <option key={v.village} value={v.village}>
                    {v.village} ({v.count} người cần thu)
                  </option>
                ))}
              </select>
            </div>

            {/* Ô tìm kiếm & Thống kê */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-56">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm họ tên, số thửa..."
                  className={`w-full pl-8 pr-3 py-1.5 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-800'
                      : 'bg-slate-800 border-slate-700 text-slate-100'
                  }`}
                />
              </div>

              {/* Huy hiệu tiến độ */}
              <div className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] font-black shrink-0 border border-slate-200 dark:border-slate-700">
                <span className="text-emerald-500 font-bold">{checkedInView}</span>
                <span className="text-slate-400">/{totalInView}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Thông báo Toast khi di chuyển thành công */}
        {toastMessage && (
          <div className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold flex items-center justify-between shrink-0 shadow-sm animate-in fade-in">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-white hover:opacity-80"
            >
              ✕
            </button>
          </div>
        )}

        {/* Thân bảng: DANH SÁCH DẠNG EXCEL TỐI THIỂU 4 Ô TRÊN 1 HÀNG */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4 bg-slate-100/60 dark:bg-slate-950/40">
          {pairedRows.length === 0 ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 stroke-[1.5]" />
              <p className="text-sm font-semibold text-slate-300">
                Không có công dân nào cần thu thập CCCD
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {selectedVillage !== 'ALL'
                  ? `Toàn bộ công dân đã kê khai ở ${selectedVillage} đều đã có file ảnh CCCD trên Cloudflare R2.`
                  : 'Tất cả các thửa đã kê khai đều đã có file CCCD hợp lệ trên hệ thống.'}
              </p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-700 shadow-xs bg-white dark:bg-slate-900">
              <table className="w-full border-collapse border border-slate-300 dark:border-slate-700 text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 font-black border-b border-slate-300 dark:border-slate-700 uppercase tracking-tight text-[11px] sm:text-xs">
                    <th className="border border-slate-300 dark:border-slate-700 px-3 py-2 text-left w-[40%]">
                      Họ và Tên (Bấm để chuyển thôn)
                    </th>
                    <th className="border border-slate-300 dark:border-slate-700 px-1 py-2 text-center w-12 sm:w-16">
                      Thu xong
                    </th>
                    <th className="border border-slate-300 dark:border-slate-700 px-3 py-2 text-left w-[40%]">
                      Họ và Tên (Bấm để chuyển thôn)
                    </th>
                    <th className="border border-slate-300 dark:border-slate-700 px-1 py-2 text-center w-12 sm:w-16">
                      Thu xong
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
                        className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        {/* Ô 1: Họ tên người 1 (Bấm vào để mở form chuyển Thôn / Buôn) */}
                        <td
                          onClick={() => handleOpenMoveModal(p1)}
                          className={`border border-slate-300 dark:border-slate-700 px-2.5 sm:px-3 py-2 cursor-pointer transition select-none ${
                            isChecked1
                              ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-950 dark:text-emerald-100 font-semibold'
                              : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100'
                          }`}
                          title="Bấm vào tên để chuyển công dân sang Thôn / Buôn khác"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-bold uppercase tracking-tight text-xs sm:text-sm">
                              {p1.name}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {p1.soThuaList.length > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                                  T{p1.soThuaList.join(',')}
                                </span>
                              )}
                              <ArrowRightLeft className="w-3 h-3 text-slate-400 hover:text-indigo-500" />
                            </div>
                          </div>
                          {selectedVillage === 'ALL' && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                              {p1.thonXa}
                            </div>
                          )}
                        </td>

                        {/* Ô 2: Checkbox thu xong người 1 */}
                        <td
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCheck(p1.key);
                          }}
                          className={`border border-slate-300 dark:border-slate-700 text-center cursor-pointer select-none p-1 sm:p-2 transition ${
                            isChecked1
                              ? 'bg-emerald-100 dark:bg-emerald-950/70'
                              : 'bg-white dark:bg-slate-900'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked1}
                            onChange={() => toggleCheck(p1.key)}
                            className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer accent-emerald-600"
                          />
                        </td>

                        {/* Ô 3: Họ tên người 2 (hoặc ô trống nếu số người lẻ) */}
                        {p2 ? (
                          <>
                            <td
                              onClick={() => handleOpenMoveModal(p2)}
                              className={`border border-slate-300 dark:border-slate-700 px-2.5 sm:px-3 py-2 cursor-pointer transition select-none ${
                                isChecked2
                                  ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-950 dark:text-emerald-100 font-semibold'
                                  : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100'
                              }`}
                              title="Bấm vào tên để chuyển công dân sang Thôn / Buôn khác"
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="font-bold uppercase tracking-tight text-xs sm:text-sm">
                                  {p2.name}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  {p2.soThuaList.length > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                                      T{p2.soThuaList.join(',')}
                                    </span>
                                  )}
                                  <ArrowRightLeft className="w-3 h-3 text-slate-400 hover:text-indigo-500" />
                                </div>
                              </div>
                              {selectedVillage === 'ALL' && (
                                <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                                  {p2.thonXa}
                                </div>
                              )}
                            </td>

                            {/* Ô 4: Checkbox thu xong người 2 */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCheck(p2.key);
                              }}
                              className={`border border-slate-300 dark:border-slate-700 text-center cursor-pointer select-none p-1 sm:p-2 transition ${
                                isChecked2
                                  ? 'bg-emerald-100 dark:bg-emerald-950/70'
                                  : 'bg-white dark:bg-slate-900'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked2}
                                onChange={() => toggleCheck(p2.key)}
                                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer accent-emerald-600"
                              />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="border border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40"></td>
                            <td className="border border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40"></td>
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

        {/* Footer Modal */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 shrink-0 text-xs text-slate-500 dark:text-slate-400">
          <div>
            <span>Tổng số: </span>
            <strong className="text-slate-800 dark:text-slate-200">{filteredCitizens.length}</strong> công dân
            {' • '}
            <span>Đã thu: </span>
            <strong className="text-emerald-500 font-bold">{checkedInView}</strong>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* SUB-MODAL: DI CHUYỂN TÊN ĐẾN THÔN BUÔN KHÁC */}
      {movingPerson && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in">
          <div
            className={`w-full max-w-md p-5 rounded-2xl border shadow-2xl space-y-4 animate-in zoom-in-95 ${
              isLight
                ? 'bg-white border-slate-200 text-slate-800'
                : 'bg-slate-900 border-slate-700 text-slate-100'
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-600/15 text-indigo-500">
                  <ArrowRightLeft className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase">Chuyển Thôn / Buôn</h3>
                  <p className="text-[11px] text-slate-500">
                    Cập nhật thôn buôn người này vào cơ sở dữ liệu
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMovingPerson(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Họ và tên:</span>
                  <strong className="text-sm uppercase text-indigo-400">{movingPerson.name}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Thôn hiện tại:</span>
                  <span className="font-semibold text-rose-400">{movingPerson.thonXa}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Các thửa đất:</span>
                  <span className="font-semibold text-slate-300">
                    {movingPerson.soThuaList.length > 0
                      ? `Thửa ${movingPerson.soThuaList.join(', ')}`
                      : movingPerson.maThuaList.join(', ')}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5 text-slate-300">
                  Chọn Thôn / Buôn mới để di chuyển đến:
                </label>
                <select
                  value={targetVillage}
                  onChange={(e) => setTargetVillage(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-800'
                      : 'bg-slate-800 border-slate-700 text-slate-100'
                  }`}
                >
                  {CANONICAL_VILLAGES.filter((v) => v !== 'Chưa xác định').map((v) => (
                    <option key={v} value={v}>
                      {v} {v === movingPerson.thonXa ? '(Hiện tại)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={isSavingMove}
                onClick={() => setMovingPerson(null)}
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSavingMove || targetVillage === movingPerson.thonXa}
                onClick={handleConfirmMoveVillage}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-black shadow-md transition flex items-center gap-1.5 cursor-pointer"
              >
                {isSavingMove ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang lưu...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Xác nhận di chuyển</span>
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
