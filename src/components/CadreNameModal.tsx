'use client';

import React, { useState, useEffect } from 'react';
import { UserCheck, X, Check, ShieldCheck, Sparkles, Radio } from 'lucide-react';
import { formatCadreName, getSavedCadreName, saveCadreName } from '@/utils/declaration';

interface CadreNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (cadreName: string) => void;
  theme?: 'dark' | 'light';
  isFirstTime?: boolean;
}

export default function CadreNameModal({
  isOpen,
  onClose,
  onSaved,
  theme = 'dark',
  isFirstTime = false,
}: CadreNameModalProps) {
  const isLight = theme === 'light';
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      const current = getSavedCadreName();
      setName(current || '');
      setError('');
    }
  }, [isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const formatted = formatCadreName(raw);
    setName(formatted);
    if (formatted.length >= 2) {
      setError('');
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const formatted = formatCadreName(name);
    if (!formatted || formatted.length < 2) {
      setError('Vui lòng nhập tối thiểu 2 ký tự (Ví dụ: PHANTHANHTRUC)');
      return;
    }

    saveCadreName(formatted);
    if (onSaved) onSaved(formatted);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div
        className={`relative w-full max-w-md rounded-3xl border shadow-2xl overflow-hidden p-6 text-center ${
          isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        {/* Nút đóng nếu không bắt buộc lần đầu */}
        {!isFirstTime && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Icon & Tiêu đề */}
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
          <UserCheck className="w-7 h-7" />
        </div>

        <h3 className="text-lg font-black tracking-tight mb-1">
          {isFirstTime ? 'Chào Bạn! Nhập Tên Người Kê Khai' : 'Đổi Tên Người Kê Khai'}
        </h3>
        <p className="text-xs text-slate-400 mb-5 leading-relaxed">
          Tên định danh giúp hệ thống nhận diện chuẩn xác các thửa đất do bạn kê khai, lưu trữ an toàn và bảo lưu dữ liệu của bạn trên hệ thống.
        </p>

        {/* Form nhập tên */}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5 text-left">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Họ và tên người kê khai (In hoa liền không dấu):
            </label>
            <div className="relative">
              <input
                type="text"
                autoFocus
                value={name}
                onChange={handleChange}
                placeholder="Ví dụ: NGUYENVANA hoặc PHANTHANHTRUC"
                className={`w-full px-4 py-3 rounded-2xl text-center text-sm font-black tracking-widest border transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  isLight
                    ? 'bg-slate-50 border-slate-300 text-indigo-900 placeholder:text-slate-400'
                    : 'bg-slate-950 border-slate-700 text-cyan-300 placeholder:text-slate-600'
                }`}
              />
              {name.length >= 2 && (
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-400">
                  <Check className="w-5 h-5" />
                </div>
              )}
            </div>
            {error && <p className="text-[11px] text-rose-500 font-semibold">{error}</p>}
          </div>

          {/* Gợi ý định dạng */}
          <div className={`p-3 rounded-xl border text-left text-xs space-y-1 ${
            isLight ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-slate-950/60 border-slate-800 text-slate-400'
          }`}>
            <div className="flex items-center gap-1.5 text-indigo-400 font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Quy tắc đặt tên:</span>
            </div>
            <p className="text-[11px]">
              • Tự động viết hoa, viết liền, bỏ dấu tiếng Việt.
            </p>
            <p className="text-[11px]">
              • <strong className="text-slate-200">Ví dụ:</strong> <span className="text-cyan-400 font-mono font-bold">NGUYENVANA</span>, <span className="text-cyan-400 font-mono font-bold">PHANTHANHTRUC</span>, <span className="text-cyan-400 font-mono font-bold">TRANTHIB</span>.
            </p>
          </div>

          {/* Thông báo định vị GPS */}
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] text-left">
            <Radio className="w-4 h-4 shrink-0 animate-pulse text-emerald-400" />
            <span>Sau khi xác nhận, định vị GPS sẽ được kích hoạt để tự động tìm và dẫn đường chính xác đến thửa đất của bạn.</span>
          </div>

          {/* Nút Lưu */}
          <div className="pt-1 flex items-center gap-2">
            {!isFirstTime && (
              <button
                type="button"
                onClick={onClose}
                className={`w-1/3 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
                  isLight
                    ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                Hủy
              </button>
            )}
            <button
              type="submit"
              disabled={name.length < 2}
              className={`flex-1 py-3 rounded-2xl text-xs font-black transition cursor-pointer shadow-lg bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white shadow-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5`}
            >
              <Check className="w-4 h-4" />
              <span>Xác Nhận Tên</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
