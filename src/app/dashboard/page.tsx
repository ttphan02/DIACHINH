'use client';

import dynamic from 'next/dynamic';

// Vô hiệu hoá SSR (Server-Side Rendering) cho Dashboard
// Giúp Worker phản hồi ngay lập tức trong 0.5ms CPU và không vượt giới hạn tài nguyên 128MB RAM (Error 1102)
const DashboardClient = dynamic(() => import('@/components/DashboardClient'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
      <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="font-semibold text-lg text-indigo-400">Đang tải Bảng Điều Khiển Cư Pui...</p>
      <p className="text-xs text-slate-500 mt-2">Tối ưu hoá hiệu năng máy chủ Cloudflare</p>
    </div>
  ),
});

export default function DashboardPage() {
  return <DashboardClient />;
}
