'use client';

import React from 'react';
import { Layers, CheckCircle2, Clock, AlertCircle, HelpCircle, Navigation } from 'lucide-react';
import { ParcelStatus } from '@/types';

interface HeaderStatsProps {
  total: number;
  greenCount: number;
  blueCount: number;
  yellowCount: number;
  grayCount: number;
  gpsCount?: number;
  currentFilter: ParcelStatus | 'ALL';
  onSelectFilter: (status: ParcelStatus | 'ALL') => void;
}

export default function HeaderStats({
  total,
  greenCount,
  blueCount,
  yellowCount,
  grayCount,
  gpsCount,
  currentFilter,
  onSelectFilter,
}: HeaderStatsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3.5 mb-4 sm:mb-6">
      {/* Total */}
      <button
        onClick={() => onSelectFilter('ALL')}
        className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border text-left transition-all ${
          currentFilter === 'ALL'
            ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-300'
            : 'bg-white text-gray-800 border-gray-100 hover:border-blue-200 shadow-sm'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className={`text-[11px] sm:text-xs font-semibold ${currentFilter === 'ALL' ? 'text-blue-100' : 'text-gray-500'}`}>
            Tổng số thửa
          </span>
          <Layers className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${currentFilter === 'ALL' ? 'text-blue-200' : 'text-blue-600'}`} />
        </div>
        <p className="text-xl sm:text-2xl font-black mt-1">{total.toLocaleString('vi-VN')}</p>
        <span className={`text-[10px] sm:text-[11px] ${currentFilter === 'ALL' ? 'text-blue-200' : 'text-gray-400'}`}>
          Xã Cư Pui
        </span>
      </button>

      {/* Đã số hóa (Xanh lá) */}
      <button
        onClick={() => onSelectFilter('DA_SO_HOA_XANH')}
        className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border text-left transition-all ${
          currentFilter === 'DA_SO_HOA_XANH'
            ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-300'
            : 'bg-white text-gray-800 border-gray-100 hover:border-emerald-200 shadow-sm'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className={`text-[11px] sm:text-xs font-semibold ${currentFilter === 'DA_SO_HOA_XANH' ? 'text-emerald-100' : 'text-gray-500'}`}>
            Đã số hóa (GGS)
          </span>
          <CheckCircle2 className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${currentFilter === 'DA_SO_HOA_XANH' ? 'text-emerald-200' : 'text-emerald-600'}`} />
        </div>
        <p className="text-xl sm:text-2xl font-black mt-1 text-emerald-500">
          {greenCount.toLocaleString('vi-VN')}
        </p>
        <span className={`text-[10px] sm:text-[11px] ${currentFilter === 'DA_SO_HOA_XANH' ? 'text-emerald-100' : 'text-gray-400'}`}>
          Đạt {Math.round((greenCount / total) * 100)}% tổng số
        </span>
      </button>

      {/* Đã kê khai chưa số hóa (Xanh lam) */}
      <button
        onClick={() => onSelectFilter('DA_KE_KHAI_CHUA_SO_HOA_LAM')}
        className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border text-left transition-all ${
          currentFilter === 'DA_KE_KHAI_CHUA_SO_HOA_LAM'
            ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-300'
            : 'bg-white text-gray-800 border-gray-100 hover:border-blue-200 shadow-sm'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className={`text-[11px] sm:text-xs font-semibold ${currentFilter === 'DA_KE_KHAI_CHUA_SO_HOA_LAM' ? 'text-blue-100' : 'text-gray-500'}`}>
            Đã kê khai
          </span>
          <Clock className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${currentFilter === 'DA_KE_KHAI_CHUA_SO_HOA_LAM' ? 'text-blue-200' : 'text-blue-600'}`} />
        </div>
        <p className="text-xl sm:text-2xl font-black mt-1 text-blue-600">
          {blueCount.toLocaleString('vi-VN')}
        </p>
        <span className={`text-[10px] sm:text-[11px] ${currentFilter === 'DA_KE_KHAI_CHUA_SO_HOA_LAM' ? 'text-blue-200' : 'text-gray-400'}`}>
          Chưa lên GGS
        </span>
      </button>

      {/* Có tên chưa kê khai (Vàng) */}
      <button
        onClick={() => onSelectFilter('CO_TEN_CHUA_SO_HOA_VANG')}
        className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border text-left transition-all ${
          currentFilter === 'CO_TEN_CHUA_SO_HOA_VANG'
            ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-amber-300'
            : 'bg-white text-gray-800 border-gray-100 hover:border-amber-200 shadow-sm'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className={`text-[11px] sm:text-xs font-semibold ${currentFilter === 'CO_TEN_CHUA_SO_HOA_VANG' ? 'text-amber-100' : 'text-gray-500'}`}>
            Có tên chủ đất
          </span>
          <AlertCircle className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${currentFilter === 'CO_TEN_CHUA_SO_HOA_VANG' ? 'text-amber-200' : 'text-amber-600'}`} />
        </div>
        <p className="text-xl sm:text-2xl font-black mt-1 text-amber-500">
          {yellowCount.toLocaleString('vi-VN')}
        </p>
        <span className={`text-[10px] sm:text-[11px] ${currentFilter === 'CO_TEN_CHUA_SO_HOA_VANG' ? 'text-amber-100' : 'text-gray-400'}`}>
          Chiếm {Math.round((yellowCount / total) * 100)}% tổng số
        </span>
      </button>

      {/* Chưa có tên (Trắng/Xám) */}
      <button
        onClick={() => onSelectFilter('CHUA_CO_TEN_XAM')}
        className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border text-left transition-all ${
          currentFilter === 'CHUA_CO_TEN_XAM'
            ? 'bg-gray-700 text-white border-gray-700 shadow-md ring-2 ring-gray-400'
            : 'bg-white text-gray-800 border-gray-100 hover:border-gray-300 shadow-sm'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className={`text-[11px] sm:text-xs font-semibold ${currentFilter === 'CHUA_CO_TEN_XAM' ? 'text-gray-200' : 'text-gray-500'}`}>
            Chưa có tên
          </span>
          <HelpCircle className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${currentFilter === 'CHUA_CO_TEN_XAM' ? 'text-gray-300' : 'text-gray-400'}`} />
        </div>
        <p className="text-xl sm:text-2xl font-black mt-1 text-gray-500">
          {grayCount.toLocaleString('vi-VN')}
        </p>
        <span className={`text-[10px] sm:text-[11px] ${currentFilter === 'CHUA_CO_TEN_XAM' ? 'text-gray-200' : 'text-gray-400'}`}>
          Chiếm {Math.round((grayCount / total) * 100)}% tổng số
        </span>
      </button>
    </div>
  );
}
