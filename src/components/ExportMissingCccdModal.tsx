'use client';

import React from 'react';
import CccdCollectPanel, { CccdListMode } from './CccdCollectPanel';
import { Parcel, DeclarationFormData } from '@/types';

interface ExportMissingCccdModalProps {
  isOpen: boolean;
  onClose: () => void;
  parcels: Parcel[];
  declarationsMap: Record<string, DeclarationFormData | any>;
  cellEdits?: Record<string, Record<number, string>>;
  ggsCodes?: Set<string>;
  kh2959ImportedCodes?: Set<string>;
  declaredParcelCodes?: Set<string>;
  initialListMode?: CccdListMode;
  theme?: 'dark' | 'light';
  onDeclarationUpdated?: (updatedDecl: any) => void;
  onCellEditsUpdated?: (patch: Record<string, Record<number, string>>) => void;
}

export default function ExportMissingCccdModal({
  isOpen,
  onClose,
  parcels,
  declarationsMap,
  cellEdits,
  ggsCodes,
  kh2959ImportedCodes,
  declaredParcelCodes,
  initialListMode = 'declared',
  theme = 'light',
  onDeclarationUpdated,
  onCellEditsUpdated,
}: ExportMissingCccdModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-start bg-black/40 backdrop-blur-2xs transition-all duration-300">
      <div className="w-full sm:w-[420px] h-[70vh] sm:h-full bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-none border-t sm:border-t-0 sm:border-r border-gray-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in slide-in-from-bottom sm:slide-in-from-left duration-300">
        <CccdCollectPanel
          onClose={onClose}
          parcels={parcels}
          declarationsMap={declarationsMap}
          cellEdits={cellEdits}
          ggsCodes={ggsCodes}
          kh2959ImportedCodes={kh2959ImportedCodes}
          declaredParcelCodes={declaredParcelCodes}
          initialListMode={initialListMode}
          theme={theme}
          onDeclarationUpdated={onDeclarationUpdated}
          onCellEditsUpdated={onCellEditsUpdated}
        />
      </div>
    </div>
  );
}
