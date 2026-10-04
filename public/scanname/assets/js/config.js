// Config & Constants
const GROUP_COLORS = [
  { name: 'Purple', bg: 'rgba(139, 92, 246, 0.85)', border: '#8b5cf6', tagBg: '#7c3aed' },
  { name: 'Emerald', bg: 'rgba(16, 185, 129, 0.85)', border: '#10b981', tagBg: '#059669' },
  { name: 'Rose', bg: 'rgba(244, 63, 94, 0.85)', border: '#f43f5e', tagBg: '#e11d48' },
  { name: 'Amber', bg: 'rgba(245, 158, 11, 0.85)', border: '#f59e0b', tagBg: '#d97706' },
  { name: 'Cyan', bg: 'rgba(6, 182, 212, 0.85)', border: '#06b6d4', tagBg: '#0891b2' },
  { name: 'Pink', bg: 'rgba(236, 72, 153, 0.85)', border: '#ec4899', tagBg: '#db2777' },
  { name: 'Blue', bg: 'rgba(59, 130, 246, 0.85)', border: '#3b82f6', tagBg: '#2563eb' },
  { name: 'Lime', bg: 'rgba(132, 204, 22, 0.85)', border: '#84cc16', tagBg: '#65a30d' }
];

const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1c2xAknmc1fx-xKBJhLp-EcmZwAAnDIgCPf-pj6wmCHc';
const SHEET_CACHE_TTL = 3 * 60 * 1000; // Lưu cache 3 phút

const DEFAULT_GEMINI_KEYS = [];
