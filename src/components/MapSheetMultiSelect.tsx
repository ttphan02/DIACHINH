'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Layers, ChevronDown, Check, X, Search } from 'lucide-react';

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
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const handleSelectAll = () => {
    onChange(filteredSheets.map((s) => s.sheet));
  };

  const handleClearAll = () => {
    onChange([]);
  };

  // Label to display on the button
  const getButtonLabel = () => {
    if (selectedSheets.length === 0) {
      return (
        <>
          <span className="sm:hidden">Tờ bản đồ</span>
          <span className="hidden sm:inline">Tất cả tờ bản đồ ({sheetList.length})</span>
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
    const totalCount = sheetList
      .filter((s) => selectedSheets.includes(s.sheet))
      .reduce((sum, s) => sum + s.count, 0);
    return (
      <>
        <span className="sm:hidden">Đã chọn ({selectedSheets.length})</span>
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
        className={`px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs border rounded-xl flex items-center gap-1.5 font-bold transition shadow-xs ${
          selectedSheets.length > 0
            ? 'bg-blue-50 border-blue-300 text-blue-700'
            : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-white'
        }`}
      >
        <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <span className="truncate max-w-[100px] sm:max-w-none">{getButtonLabel()}</span>
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
          <div className="fixed inset-x-3.5 top-28 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full mt-1.5 w-auto sm:w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-[100] p-3 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
          {/* Search box inside dropdown */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm số tờ bản đồ..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              autoFocus
            />
          </div>

          {/* Quick Action buttons */}
          <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-gray-500 border-b border-gray-100 pb-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-blue-600 hover:underline hover:text-blue-800"
            >
              Chọn tất cả ({filteredSheets.length})
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-gray-400 hover:underline hover:text-red-500"
            >
              Bỏ chọn ({selectedSheets.length})
            </button>
          </div>

          {/* Selected pills list (nếu có chọn) */}
          {selectedSheets.length > 0 && (
            <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto p-1 bg-blue-50/50 rounded-lg border border-blue-100/60">
              {selectedSheets.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white text-blue-700 border border-blue-200 shadow-2xs"
                >
                  Tờ {s}
                  <button
                    type="button"
                    onClick={() => toggleSheet(s)}
                    className="hover:text-red-600 transition"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Sheets List */}
          <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1 divide-y divide-gray-50">
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

          {/* Footer note */}
          <div className="pt-1 border-t border-gray-100 text-[10px] text-gray-400 text-center">
            Có thể tick chọn nhiều tờ cùng lúc để khảo sát một vùng
          </div>
        </div>
        </>
      )}
    </div>
  );
}
