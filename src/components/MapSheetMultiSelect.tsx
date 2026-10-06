'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Layers, ChevronDown, Check, X, Search, MapPin } from 'lucide-react';
import { removeVietnameseTones } from '@/utils/geo';

export interface VillageSheetCategory {
  id: string;
  stt: number;
  name: string;
  sheets: string[];
  note?: string;
}

export const VILLAGE_SHEET_CATEGORIES: VillageSheetCategory[] = [
  {
    id: 'buon_ngo',
    stt: 1,
    name: 'Buôn Ngô',
    sheets: ['51', '52', '55', '56', '57', '58', '94', '95', '96', '99', '100', '102'],
  },
  {
    id: 'thon_ba_phuong',
    stt: 2,
    name: 'Thôn Ba Phường',
    sheets: ['22', '32', '33', '43', '49', '50', '53', '54', '86', '88', '89'],
  },
  {
    id: 'thon_hoa_phong',
    stt: 3,
    name: 'Thôn Hòa Phong',
    sheets: ['23', '24', '25', '62', '63', '64', '67', '68', '69', '70', '71', '72', '77', '78'],
  },
  {
    id: 'buon_tlier',
    stt: 4,
    name: 'Buôn Tliêr',
    sheets: ['1', '2', '3', '4', '5', '8', '9', '10', '11', '12', '14', '15', '16', '59', '62', '63'],
  },
  {
    id: 'buon_cu_phiang',
    stt: 5,
    name: 'Buôn Cư Phiang',
    sheets: ['33', '34', '43', '44', '78', '82'],
  },
  {
    id: 'thon_cam_phong',
    stt: 6,
    name: 'Thôn Cẩm Phong',
    sheets: [
      '26',
      '27',
      '35',
      '36',
      '37',
      '38',
      '39',
      '40',
      '45',
      '46',
      '47',
      '48',
      '73',
      '74',
      '75',
      '79',
      '80',
      '81',
      '84',
      '85',
    ],
  },
  {
    id: 'thon_noh_prong',
    stt: 7,
    name: 'Thôn Noh Prông',
    sheets: ['21', '30', '31', '66', '76'],
  },
  {
    id: 'thon_ea_khiem',
    stt: 8,
    name: 'Thôn Ea Khiêm',
    sheets: ['12', '13', '19', '20', '60', '61', '65'],
  },
  {
    id: 'buon_bhung',
    stt: 9,
    name: 'Buôn Bhung',
    sheets: ['87', '88', '137', '138', '139', '140', '161', '162', '163', '164'],
    note: 'Tờ 88 (một phần), 164 (đo năm 2009)',
  },
  {
    id: 'buon_dak_tuor',
    stt: 10,
    name: 'Buôn Đăk Tuôr',
    sheets: [
      '3',
      '7',
      '8',
      '12',
      '13',
      '17',
      '18',
      '20',
      '21',
      '22',
      '23',
      '24',
      '25',
      '27',
      '34',
      '35',
      '88',
      '100',
      '102',
      '164',
      '186',
    ],
    note: 'Tờ 88 (một phần)',
  },
  {
    id: 'buon_khanh',
    stt: 11,
    name: 'Buôn Khanh',
    sheets: ['4', '5', '9', '10', '14', '15', '19', '26', '29', '30', '31', '32', '33', '107'],
  },
  {
    id: 'ea_uol',
    stt: 12,
    name: 'Ea Uôl',
    sheets: ['1', '2', '5', '6', '11', '16', '78', '89', '104'],
    note: 'Tờ 78, 89 (một phần)',
  },
  {
    id: 'thon_ea_lang',
    stt: 13,
    name: 'Thôn Ea Lang',
    sheets: ['68', '69', '78', '79', '89', '90', '105'],
    note: 'Tờ 68, 69, 78, 89 (một phần)',
  },
  {
    id: 'thon_cu_te',
    stt: 14,
    name: 'Thôn Cư Tê',
    sheets: ['63', '68', '69', '103'],
    note: 'Tờ 68, 69 (một phần)',
  },
  {
    id: 'thon_ea_bar',
    stt: 15,
    name: 'Thôn Ea Bar',
    sheets: ['81', '91', '92', '93', '94', '106'],
  },
  {
    id: 'thon_ea_rot',
    stt: 16,
    name: 'Thôn Ea Rớt',
    sheets: ['42', '43', '45', '46', '47', '50'],
  },
];

interface SheetInfo {
  sheet: string;
  count: number;
}

interface MapSheetMultiSelectProps {
  sheetList: SheetInfo[];
  selectedSheets: string[];
  onChange: (selected: string[]) => void;
}

export default function MapSheetMultiSelect({
  sheetList,
  selectedSheets,
  onChange,
}: MapSheetMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'villages' | 'sheets'>('villages');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Map tra cứu nhanh số lượng thửa của từng tờ bản đồ
  const sheetCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    sheetList.forEach((s) => {
      map[s.sheet] = s.count;
    });
    return map;
  }, [sheetList]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Lọc danh sách Thôn / Buôn theo từ khóa tìm kiếm (tên thôn hoặc số tờ)
  const filteredVillages = useMemo(() => {
    const sClean = removeVietnameseTones(search.trim().toLowerCase());
    if (!sClean) return VILLAGE_SHEET_CATEGORIES;
    return VILLAGE_SHEET_CATEGORIES.filter((v) => {
      const nameMatch = removeVietnameseTones(v.name.toLowerCase()).includes(sClean);
      const sheetMatch = v.sheets.some((sh) => sh.toLowerCase().includes(sClean));
      return nameMatch || sheetMatch;
    });
  }, [search]);

  // Filter sheets by search
  const filteredSheets = useMemo(() => {
    const sClean = search.trim().toLowerCase();
    if (!sClean) return sheetList;
    return sheetList.filter((s) => s.sheet.toLowerCase().includes(sClean));
  }, [sheetList, search]);

  const toggleSheet = (sheet: string) => {
    if (selectedSheets.includes(sheet)) {
      onChange(selectedSheets.filter((s) => s !== sheet));
    } else {
      onChange([...selectedSheets, sheet]);
    }
  };

  // Khi nhấn vào 1 Thôn/Buôn: Tự động chọn toàn bộ các tờ bản đồ của Thôn/Buôn đó
  // Nếu tất cả các tờ của Thôn/Buôn đó đã được chọn sẵn -> bỏ chọn các tờ đó
  const handleToggleVillage = (village: VillageSheetCategory) => {
    const isAllSelected =
      village.sheets.length > 0 && village.sheets.every((sh) => selectedSheets.includes(sh));

    if (isAllSelected) {
      // Nếu đang chỉ chọn đúng thôn này -> xóa hết; nếu đang gộp nhiều thôn -> bỏ các tờ của thôn này
      onChange(selectedSheets.filter((sh) => !village.sheets.includes(sh)));
    } else {
      // Chọn toàn bộ các tờ của thôn này (nếu chưa chọn tờ nào khác hoặc muốn chọn thẳng thôn này)
      const merged = Array.from(new Set([...selectedSheets, ...village.sheets]));
      onChange(merged);
    }
  };

  // Chọn duy nhất 1 Thôn/Buôn (thay thế lựa chọn cũ để xem nhanh đúng thôn đó)
  const handleSelectOnlyVillage = (village: VillageSheetCategory, e: React.MouseEvent) => {
    e.stopPropagation();
    const isExactMatch =
      selectedSheets.length === village.sheets.length &&
      village.sheets.every((sh) => selectedSheets.includes(sh));

    if (isExactMatch) {
      onChange([]);
    } else {
      onChange([...village.sheets]);
    }
  };

  const handleSelectAll = () => {
    onChange(filteredSheets.map((s) => s.sheet));
  };

  const handleClearAll = () => {
    onChange([]);
  };

  // Kiểm tra xem tập tờ đang chọn có khớp chính xác với 1 Thôn/Buôn nào không
  const matchedVillage = useMemo(() => {
    if (selectedSheets.length === 0) return null;
    return (
      VILLAGE_SHEET_CATEGORIES.find(
        (v) =>
          v.sheets.length === selectedSheets.length &&
          v.sheets.every((sh) => selectedSheets.includes(sh))
      ) || null
    );
  }, [selectedSheets]);

  // Label to display on the button
  const getButtonLabel = () => {
    if (selectedSheets.length === 0) {
      return (
        <>
          <span className="sm:hidden">Thôn / Tờ BĐ</span>
          <span className="hidden sm:inline">Thôn/Buôn & Tờ BĐ ({sheetList.length})</span>
        </>
      );
    }

    const totalCount = sheetList
      .filter((s) => selectedSheets.includes(s.sheet))
      .reduce((sum, s) => sum + s.count, 0);

    if (matchedVillage) {
      return (
        <>
          <span className="sm:hidden">{matchedVillage.name}</span>
          <span className="hidden sm:inline">
            {matchedVillage.name} ({matchedVillage.sheets.length} tờ • {totalCount} thửa)
          </span>
        </>
      );
    }

    if (selectedSheets.length === 1) {
      const s = sheetList.find((item) => item.sheet === selectedSheets[0]);
      return (
        <>
          <span className="sm:hidden">Tờ {selectedSheets[0]}</span>
          <span className="hidden sm:inline">Tờ {selectedSheets[0]} ({s ? s.count : 0} thửa)</span>
        </>
      );
    }

    return (
      <>
        <span className="sm:hidden">Đã chọn ({selectedSheets.length} tờ)</span>
        <span className="hidden sm:inline">Đã chọn {selectedSheets.length} tờ ({totalCount} thửa)</span>
      </>
    );
  };

  return (
    <div className="relative w-auto shrink-0" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs border rounded-xl flex items-center gap-1.5 font-bold transition shadow-xs cursor-pointer ${
          selectedSheets.length > 0
            ? 'bg-blue-50 border-blue-300 text-blue-700'
            : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-white'
        }`}
      >
        <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <span className="truncate max-w-[115px] sm:max-w-none">{getButtonLabel()}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-blue-600' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu - z-[100] ĐẢM BẢO LUÔN NẰM TRÊN BẢN ĐỒ VÀ VỪA KHUNG HÌNH MOBILE */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/25 z-[99] sm:hidden"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed inset-x-3 top-24 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full mt-1.5 w-auto sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 z-[100] p-3 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
            {/* Chuyển đổi giữa Danh mục Thôn/Buôn và Từng Tờ Bản Đồ */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveTab('villages')}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition cursor-pointer ${
                  activeTab === 'villages'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MapPin className="w-3.5 h-3.5 text-blue-600" />
                <span>Theo Thôn / Buôn (16)</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sheets')}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition cursor-pointer ${
                  activeTab === 'sheets'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span>Từng Tờ BĐ ({sheetList.length})</span>
              </button>
            </div>

            {/* Search box inside dropdown */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  activeTab === 'villages'
                    ? 'Tìm tên thôn/buôn hoặc số tờ...'
                    : 'Tìm số tờ bản đồ...'
                }
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Action buttons */}
            <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-gray-500 border-b border-gray-100 pb-2">
              {activeTab === 'villages' ? (
                <span className="text-slate-500">
                  Nhấn tên thôn/buôn để chọn nhanh toàn bộ tờ BĐ
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-blue-600 hover:underline hover:text-blue-800 cursor-pointer"
                >
                  Chọn tất cả ({filteredSheets.length})
                </button>
              )}
              <button
                type="button"
                onClick={handleClearAll}
                className="text-rose-500 hover:underline hover:text-rose-700 font-bold shrink-0 cursor-pointer"
              >
                Bỏ chọn ({selectedSheets.length})
              </button>
            </div>

            {/* Selected pills list (nếu có chọn) */}
            {selectedSheets.length > 0 && (
              <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto p-1.5 bg-blue-50/60 rounded-lg border border-blue-100">
                {selectedSheets.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white text-blue-700 border border-blue-200 shadow-2xs"
                  >
                    Tờ {s}
                    <button
                      type="button"
                      onClick={() => toggleSheet(s)}
                      className="hover:text-red-600 transition cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* TAB 1: DANH MỤC 16 THÔN / BUÔN */}
            {activeTab === 'villages' ? (
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {filteredVillages.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-4">
                    Không tìm thấy thôn/buôn hoặc tờ <strong>&quot;{search}&quot;</strong>
                  </p>
                ) : (
                  filteredVillages.map((village) => {
                    const selectedInVillage = village.sheets.filter((sh) =>
                      selectedSheets.includes(sh)
                    ).length;
                    const isAllSelected =
                      village.sheets.length > 0 && selectedInVillage === village.sheets.length;
                    const isPartialSelected = selectedInVillage > 0 && !isAllSelected;

                    const villageParcelCount = village.sheets.reduce(
                      (sum, sh) => sum + (sheetCountMap[sh] || 0),
                      0
                    );

                    return (
                      <div
                        key={village.id}
                        onClick={(e) => handleSelectOnlyVillage(village, e)}
                        className={`p-2 rounded-xl border transition cursor-pointer select-none ${
                          isAllSelected
                            ? 'bg-blue-50/90 border-blue-400 shadow-xs'
                            : isPartialSelected
                            ? 'bg-blue-50/40 border-blue-200'
                            : 'bg-white hover:bg-slate-50 border-gray-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {/* Checkbox Gộp / Bỏ gộp thôn */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleVillage(village);
                              }}
                              title="Tick để chọn gộp thêm thôn/buôn này cùng các thôn khác"
                              className={`w-4 h-4 rounded flex items-center justify-center border transition shrink-0 cursor-pointer ${
                                isAllSelected
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : isPartialSelected
                                  ? 'bg-blue-100 border-blue-500 text-blue-700'
                                  : 'border-gray-300 bg-white hover:border-blue-400'
                              }`}
                            >
                              {isAllSelected && <Check className="w-3 h-3 stroke-[3]" />}
                              {isPartialSelected && (
                                <span className="w-2 h-0.5 bg-blue-600 rounded-full" />
                              )}
                            </button>

                            <span
                              className={`text-xs truncate ${
                                isAllSelected
                                  ? 'font-extrabold text-blue-900'
                                  : 'font-bold text-slate-800'
                              }`}
                            >
                              {village.stt}. {village.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                isAllSelected
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {village.sheets.length} tờ
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono font-semibold border border-emerald-200/60">
                              {villageParcelCount} thửa
                            </span>
                          </div>
                        </div>

                        {/* Danh sách các tờ bản đồ thuộc Thôn/Buôn */}
                        <div className="mt-1.5 pl-6 flex flex-wrap gap-1">
                          {village.sheets.map((sh) => {
                            const isShSelected = selectedSheets.includes(sh);
                            const count = sheetCountMap[sh] || 0;
                            return (
                              <button
                                key={sh}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSheet(sh);
                                }}
                                title={`Tờ bản đồ ${sh} (${count} thửa) - Nhấn để bật/tắt riêng tờ này`}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer border ${
                                  isShSelected
                                    ? 'bg-blue-600 text-white border-blue-600 font-bold'
                                    : count > 0
                                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                                    : 'bg-gray-50 text-gray-400 border-gray-200'
                                }`}
                              >
                                {sh}
                              </button>
                            );
                          })}
                        </div>

                        {village.note && (
                          <p className="mt-1 pl-6 text-[10px] text-amber-700 italic">
                            * {village.note}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* TAB 2: DANH SÁCH TỪNG TỜ BẢN ĐỒ */
              <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1 divide-y divide-gray-50">
                {filteredSheets.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-4">
                    Không tìm thấy tờ số <strong>&quot;{search}&quot;</strong>
                  </p>
                ) : (
                  filteredSheets.map(({ sheet, count }) => {
                    const isSelected = selectedSheets.includes(sheet);
                    return (
                      <div
                        key={sheet}
                        onClick={() => toggleSheet(sheet)}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer select-none transition ${
                          isSelected
                            ? 'bg-blue-50 text-blue-900 font-bold'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 pointer-events-none">
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center border transition ${
                              isSelected
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'border-gray-300 bg-white'
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <span>Tờ bản đồ {sheet}</span>
                        </div>

                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded font-mono pointer-events-none ${
                            isSelected ? 'bg-blue-200/60 text-blue-800' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {count} thửa
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Footer note */}
            <div className="pt-1 border-t border-gray-100 text-[10px] text-gray-400 text-center">
              Nhấn tên Thôn/Buôn để chọn trọn bộ tờ BĐ hoặc nhấn ô vuông để gộp nhiều thôn
            </div>
          </div>
        </>
      )}
    </div>
  );
}
