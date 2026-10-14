'use client';

import React, { useState, useRef } from 'react';
import { Eye, ExternalLink, FileText, User, CreditCard, HardDrive } from 'lucide-react';

interface CccdHoverPreviewProps {
  fileUrl: string;
  filename: string;
  cccdNumber?: string;
  ownerName?: string;
  fileSize?: string | number;
  children: React.ReactNode;
  theme?: 'dark' | 'light';
}

export default function CccdHoverPreviewCard({
  fileUrl,
  filename,
  cccdNumber,
  ownerName,
  fileSize,
  children,
  theme = 'dark',
}: CccdHoverPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, 200); // 200ms delay để tránh bật tắt liên tục
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const isLight = theme === 'light';

  return (
    <div
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      {isOpen && (
        <div
          className={`absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 rounded-2xl p-3 shadow-2xl border transition-all duration-150 animate-in fade-in zoom-in-95 pointer-events-auto ${
            isLight
              ? 'bg-white border-slate-200 text-slate-800 shadow-slate-300'
              : 'bg-slate-900 border-indigo-500/40 text-slate-100 shadow-black/80'
          }`}
          style={{ minWidth: '280px' }}
        >
          {/* Header Card */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-700/50">
            <div className="flex items-center gap-1.5 text-indigo-400">
              <FileText className="w-4 h-4 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider">Hồ Sơ CCCD (R2)</span>
            </div>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`p-1 rounded-lg transition text-xs font-semibold flex items-center gap-1 ${
                isLight
                  ? 'hover:bg-slate-100 text-indigo-600'
                  : 'hover:bg-slate-800 text-indigo-300'
              }`}
              title="Mở file gốc trong tab mới"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Info Details */}
          <div className="space-y-1.5 text-xs">
            {cccdNumber && (
              <div className="flex items-center justify-between">
                <span className={`text-[11px] flex items-center gap-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  <CreditCard className="w-3 h-3 text-indigo-400" /> Số CCCD:
                </span>
                <span className="font-mono font-bold text-indigo-400 tracking-wide">
                  {cccdNumber}
                </span>
              </div>
            )}

            {ownerName && (
              <div className="flex items-center justify-between">
                <span className={`text-[11px] flex items-center gap-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  <User className="w-3 h-3 text-emerald-400" /> Chủ hộ:
                </span>
                <span className={`font-semibold truncate max-w-[150px] ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                  {ownerName}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className={`text-[11px] flex items-center gap-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                <HardDrive className="w-3 h-3 text-amber-400" /> File:
              </span>
              <span className={`font-mono text-[10px] truncate max-w-[160px] ${isLight ? 'text-slate-600' : 'text-slate-300'}`} title={filename}>
                {filename}
              </span>
            </div>
          </div>

          {/* Preview Box / Quick action */}
          <div className={`mt-2.5 p-2 rounded-xl text-center border ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/70 border-slate-800'
          }`}>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] shadow-sm transition"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Bấm để xem PDF chi tiết</span>
            </a>
          </div>

          {/* Arrow Pointer */}
          <div
            className={`absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent ${
              isLight ? 'border-t-white' : 'border-t-slate-900'
            }`}
          />
        </div>
      )}
    </div>
  );
}
