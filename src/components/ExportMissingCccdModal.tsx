'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Download,
  Share2,
  Copy,
  Smartphone,
  Filter,
  Users,
  Search,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Check,
} from 'lucide-react';
import { Parcel, DeclarationFormData } from '@/types';
import { getOrCreateDeviceId, setCustomDeviceId } from '@/utils/declaration';
import { cleanCccd } from '@/utils/syncGoogleSheets';

interface ExportMissingCccdModalProps {
  isOpen: boolean;
  onClose: () => void;
  parcels: Parcel[];
  declarationsMap: Record<string, DeclarationFormData | any>;
  theme?: 'dark' | 'light';
}

interface MissingCccdPerson {
  key: string;
  name: string;
  soThuaList: string[];
  toBanDoList: string[];
  thonXa: string;
  cccdNumber?: string;
  deviceId?: string;
  createdAt?: string;
}

export default function ExportMissingCccdModal({
  isOpen,
  onClose,
  parcels,
  declarationsMap,
  theme = 'dark',
}: ExportMissingCccdModalProps) {
  const isLight = theme === 'light';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Thiết bị
  const [deviceId, setDeviceId] = useState<string>('MAY_DEF');
  const [isEditingDeviceId, setIsEditingDeviceId] = useState(false);
  const [tempDeviceId, setTempDeviceId] = useState('');

  // Lọc
  const [filterDeviceMode, setFilterDeviceMode] = useState<'THIS_DEVICE' | 'ALL_DEVICES'>('THIS_DEVICE');
  const [selectedVillage, setSelectedVillage] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Danh sách CCCD đã có trên DB (fetch từ API /api/cccd?list_only=1)
  const [existingCccdSet, setExistingCccdSet] = useState<Set<string>>(new Set());
  const [isLoadingCccdList, setIsLoadingCccdList] = useState(false);

  // Phân trang ảnh nếu số người đông (> 40 người / trang)
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 40;

  // Trạng thái copy/share
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const id = getOrCreateDeviceId();
      setDeviceId(id);
      setTempDeviceId(id);
      fetchExistingCccdList();
    }
  }, [isOpen]);

  const fetchExistingCccdList = async () => {
    setIsLoadingCccdList(true);
    try {
      const res = await fetch(`/api/cccd?list_only=1&t=${Date.now()}`);
      if (res.ok) {
        const data = (await res.json()) as { success?: boolean; cccdList?: string[] };
        if (Array.isArray(data.cccdList)) {
          setExistingCccdSet(new Set(data.cccdList));
        }
      }
    } catch (e) {
      console.warn('Lỗi fetch danh sách CCCD:', e);
    } finally {
      setIsLoadingCccdList(false);
    }
  };

  const handleSaveDeviceId = () => {
    const trimmed = tempDeviceId.trim().toUpperCase() || 'MAY_DEF';
    setCustomDeviceId(trimmed);
    setDeviceId(trimmed);
    setIsEditingDeviceId(false);
  };

  // Tổng hợp danh sách người cần thu thập CCCD
  const missingCccdList: MissingCccdPerson[] = useMemo(() => {
    const mapByCitizen = new Map<string, MissingCccdPerson>();

    // Đọc mã thửa đã kê khai cục bộ trên máy này để hỗ trợ dữ liệu cũ
    let localDeclaredCodes = new Set<string>();
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('diachinh_declared_codes');
        if (saved) localDeclaredCodes = new Set(JSON.parse(saved));
      } catch {}
    }

    // Duyệt qua tất cả các phiếu kê khai
    Object.entries(declarationsMap || {}).forEach(([maThua, decl]: [string, any]) => {
      if (!decl) return;

      const cccdRaw = String(decl.chu_dat_cccd || decl.cccd || '').replace(/^="|"$/g, '').trim();
      const cccdClean = cleanCccd(cccdRaw);

      // Kiểm tra xem đã có hình ảnh / file CCCD trên DB chưa
      const hasCccdFileOnDb =
        (cccdClean.length === 12 && existingCccdSet.has(cccdClean)) ||
        Boolean(decl.anh_cccd_truoc) ||
        Boolean(decl.cccd_url);

      // Nếu đã có CCCD trên DB rồi thì BỎ QUA (không cần thu thập)
      if (hasCccdFileOnDb) return;

      // Xác định thiết bị kê khai
      const declDeviceId = decl.device_id || (localDeclaredCodes.has(maThua) ? deviceId : 'UNKNOWN');

      // Lọc theo thiết bị nếu chọn THIS_DEVICE
      if (filterDeviceMode === 'THIS_DEVICE') {
        const isMatch = declDeviceId === deviceId || localDeclaredCodes.has(maThua);
        if (!isMatch) return;
      }

      // Thông tin thửa & người
      const name = String(decl.chu_dat_ten || decl.chu_ho || 'Chưa rõ tên').trim();
      const soThua = String(decl.so_thua || '').trim();
      const toBanDo = String(decl.to_ban_do || '').trim();
      const thonXa = String(decl.chu_dat_dia_chi || decl.dia_chi_thua_dat || '').replace(/,\s*xã Cư Pui.*$/i, '').trim() || 'Chưa rõ thôn';

      // Gom nhóm theo Họ tên + Thôn (tránh trùng lặp 1 người có nhiều thửa)
      const groupKey = `${name.toLowerCase()}___${thonXa.toLowerCase()}`;
      if (mapByCitizen.has(groupKey)) {
        const existing = mapByCitizen.get(groupKey)!;
        if (soThua && !existing.soThuaList.includes(soThua)) existing.soThuaList.push(soThua);
        if (toBanDo && !existing.toBanDoList.includes(toBanDo)) existing.toBanDoList.push(toBanDo);
      } else {
        mapByCitizen.set(groupKey, {
          key: groupKey,
          name,
          soThuaList: soThua ? [soThua] : [],
          toBanDoList: toBanDo ? [toBanDo] : [],
          thonXa,
          cccdNumber: cccdClean.length === 12 ? cccdClean : undefined,
          deviceId: declDeviceId,
          createdAt: decl.created_at,
        });
      }
    });

    let list = Array.from(mapByCitizen.values());

    // Lọc theo thôn / buôn
    if (selectedVillage !== 'ALL') {
      list = list.filter((item) => item.thonXa.toLowerCase().includes(selectedVillage.toLowerCase()));
    }

    // Lọc theo tìm kiếm
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.thonXa.toLowerCase().includes(q) ||
          item.soThuaList.some((st) => st.includes(q))
      );
    }

    // Sắp xếp theo thứ tự bảng chữ cái tiếng Việt
    return list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [declarationsMap, existingCccdSet, filterDeviceMode, deviceId, selectedVillage, searchQuery]);

  // Danh sách các thôn có trong danh sách cần thu thập
  const availableVillages = useMemo(() => {
    const s = new Set<string>();
    missingCccdList.forEach((i) => {
      if (i.thonXa) s.add(i.thonXa);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [missingCccdList]);

  // Phân trang
  const totalPages = Math.max(1, Math.ceil(missingCccdList.length / ITEMS_PER_PAGE));
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return missingCccdList.slice(start, start + ITEMS_PER_PAGE);
  }, [missingCccdList, currentPage]);

  // Vẽ Canvas tỷ lệ 16:9 Dọc (1080 x 1920 px)
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderCanvasImage(ctx, pagedItems, {
      deviceId,
      pageIndex: currentPage,
      totalPages,
      totalCount: missingCccdList.length,
      villageName: selectedVillage !== 'ALL' ? selectedVillage : 'Toàn Xã',
    });
  }, [isOpen, pagedItems, deviceId, currentPage, totalPages, missingCccdList.length, selectedVillage]);

  // Hàm vẽ poster chuẩn tỷ lệ 9:16 (1080x1920)
  const renderCanvasImage = (
    ctx: CanvasRenderingContext2D,
    items: MissingCccdPerson[],
    meta: {
      deviceId: string;
      pageIndex: number;
      totalPages: number;
      totalCount: number;
      villageName: string;
    }
  ) => {
    const W = 1080;
    const H = 1920;

    // 1. Nền Gradient Sang trọng Hiện đại
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#090d16');
    bgGrad.addColorStop(0.5, '#0f172a');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Hoa văn tinh tế trên nền
    ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
    for (let i = 0; i < W; i += 40) {
      ctx.fillRect(i, 0, 1, H);
    }
    for (let j = 0; j < H; j += 40) {
      ctx.fillRect(0, j, W, 1);
    }

    // Khung viền ngoài
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, W - 40, H - 40);

    // 2. HEADER
    // Dải băng trên cùng
    const bannerGrad = ctx.createLinearGradient(0, 30, W, 30);
    bannerGrad.addColorStop(0, '#4338ca');
    bannerGrad.addColorStop(0.5, '#6366f1');
    bannerGrad.addColorStop(1, '#ec4899');
    ctx.fillStyle = bannerGrad;
    ctx.fillRect(30, 30, W - 60, 6);

    // Quốc hiệu / Tên cơ quan
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('UBND XÃ CƯ PUI • CÔNG TÁC ĐỊA CHÍNH - ĐO ĐẠC', W / 2, 85);

    // Tiêu đề to nổi bật
    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 52px Inter, sans-serif';
    ctx.fillText('CẦN THU THẬP CCCD', W / 2, 155);

    // Thanh tag thông tin
    const tagY = 185;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = 1.5;
    const tagW = 760;
    const tagH = 50;
    const tagX = (W - tagW) / 2;
    ctx.beginPath();
    ctx.roundRect(tagX, tagY, tagW, tagH, 25);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fca5a5';
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.textAlign = 'center';
    const nowStr = new Date().toLocaleDateString('vi-VN');
    ctx.fillText(
      `Máy: ${meta.deviceId} • Tổng: ${meta.totalCount} người • Ngày: ${nowStr} ${meta.totalPages > 1 ? `(Trang ${meta.pageIndex}/${meta.totalPages})` : ''}`,
      W / 2,
      tagY + 32
    );

    // 3. NỘI DUNG 2 CỘT TÊN CÔNG DÂN
    const colY = 265;
    const colBottom = 1800;
    const colH = colBottom - colY;
    const colW = 485;
    const col1X = 40;
    const col2X = 555;

    // Chia danh sách làm 2 cột
    const half = Math.ceil(items.length / 2);
    const col1Items = items.slice(0, half);
    const col2Items = items.slice(half);

    const renderColumn = (colItems: MissingCccdPerson[], startIdx: number, startX: number) => {
      // Header cột
      const headGrad = ctx.createLinearGradient(startX, colY, startX + colW, colY);
      headGrad.addColorStop(0, 'rgba(30, 41, 59, 0.9)');
      headGrad.addColorStop(1, 'rgba(51, 65, 85, 0.9)');
      ctx.fillStyle = headGrad;
      ctx.beginPath();
      ctx.roundRect(startX, colY, colW, 46, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 20px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        `DANH SÁCH (${startIdx + 1} - ${startIdx + colItems.length})`,
        startX + 18,
        colY + 30
      );

      // Render từng hàng
      const maxRows = Math.max(20, Math.ceil(ITEMS_PER_PAGE / 2));
      const rowH = (colH - 60) / maxRows;

      colItems.forEach((item, rIdx) => {
        const itemY = colY + 56 + rIdx * rowH;
        const globalIdx = startIdx + rIdx + 1;

        // Nền hàng (xen kẽ nhẹ)
        if (rIdx % 2 === 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
        }
        ctx.beginPath();
        ctx.roundRect(startX, itemY, colW, rowH - 6, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.stroke();

        // Huy hiệu STT tròn
        const badgeR = 16;
        const badgeX = startX + 26;
        const badgeY = itemY + (rowH - 6) / 2;
        ctx.fillStyle = '#6366f1';
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(globalIdx), badgeX, badgeY + 5);

        // Tên công dân (In hoa, to, đậm)
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 21px Inter, sans-serif';
        ctx.textAlign = 'left';
        const nameX = startX + 54;
        const nameY = itemY + (rowH - 6) / 2 - 4;
        
        // Cắt tên nếu quá dài
        let displayName = item.name.toUpperCase();
        if (ctx.measureText(displayName).width > 410) {
          displayName = displayName.substring(0, 24) + '...';
        }
        ctx.fillText(displayName, nameX, nameY);

        // Dòng phụ: Thửa / Tờ / Thôn
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px Inter, sans-serif';
        const subY = itemY + (rowH - 6) / 2 + 18;
        const thuaStr = item.soThuaList.length > 0 ? `Thửa ${item.soThuaList.slice(0, 3).join(', ')}` : '';
        const toStr = item.toBanDoList.length > 0 ? `(Tờ ${item.toBanDoList[0]})` : '';
        const thonStr = item.thonXa ? `• ${item.thonXa}` : '';
        const fullSub = `${thuaStr} ${toStr} ${thonStr}`.trim();
        ctx.fillText(fullSub.substring(0, 36), nameX, subY);
      });
    };

    // Vẽ cột 1 và cột 2
    renderColumn(col1Items, (meta.pageIndex - 1) * ITEMS_PER_PAGE, col1X);
    renderColumn(col2Items, (meta.pageIndex - 1) * ITEMS_PER_PAGE + col1Items.length, col2X);

    // 4. FOOTER
    const footY = 1825;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.beginPath();
    ctx.roundRect(40, footY, W - 80, 55, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fca5a5';
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      '⚠ LƯU Ý: Vui lòng chụp rõ nét 2 mặt CCCD gửi Cán bộ để hoàn tất đóng tập hồ sơ',
      W / 2,
      footY + 34
    );
  };

  // Tải ảnh về máy
  const handleDownloadImage = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DS_CAN_THU_THAP_CCCD_${deviceId}_Trang${currentPage}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.95);
  };

  // Chia sẻ Zalo hoặc lưu vào bộ sưu tập
  const handleShareImage = async () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `DS_CAN_THU_THAP_CCCD_${deviceId}.jpg`, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: 'Danh Sách Cần Thu Thập CCCD',
            text: `Danh sách công dân cần thu thập CCCD (Thiết bị: ${deviceId})`,
            files: [file],
          });
        } catch (e) {
          console.warn('Hủy chia sẻ:', e);
        }
      } else {
        // Fallback tải về nếu không hỗ trợ Web Share API
        handleDownloadImage();
      }
    }, 'image/jpeg', 0.95);
  };

  // Sao chép ảnh vào Clipboard
  const handleCopyImage = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2500);
      } catch (e) {
        console.warn('Lỗi copy clipboard:', e);
        handleDownloadImage();
      }
    }, 'image/png');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div
        className={`relative w-full max-w-4xl max-h-[94vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden ${
          isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        {/* Header Modal */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2">
                Xuất DS Cần Thu Thập CCCD
                <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-rose-500 text-white">
                  16:9 Dọc
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Tự động lọc những người đã kê khai nhưng chưa có ảnh CCCD trên hệ thống
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thanh công cụ lọc & chọn thiết bị */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Bộ lọc Thiết bị (Máy này vs Tất cả) */}
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-indigo-500" />
                Thiết bị:
              </span>
              <div className="inline-flex rounded-xl p-1 bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setFilterDeviceMode('THIS_DEVICE')}
                  className={`px-2.5 py-1 rounded-lg font-bold text-xs transition cursor-pointer ${
                    filterDeviceMode === 'THIS_DEVICE'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-indigo-400'
                  }`}
                >
                  Máy này ({deviceId})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterDeviceMode('ALL_DEVICES')}
                  className={`px-2.5 py-1 rounded-lg font-bold text-xs transition cursor-pointer ${
                    filterDeviceMode === 'ALL_DEVICES'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-indigo-400'
                  }`}
                >
                  Tất cả các máy
                </button>
              </div>

              {/* Sửa tên máy */}
              {isEditingDeviceId ? (
                <div className="flex items-center gap-1 ml-1">
                  <input
                    type="text"
                    value={tempDeviceId}
                    onChange={(e) => setTempDeviceId(e.target.value.toUpperCase())}
                    placeholder="Mã máy..."
                    className="w-24 px-2 py-0.5 text-xs rounded border border-indigo-500 bg-white dark:bg-slate-800 font-bold"
                  />
                  <button
                    type="button"
                    onClick={handleSaveDeviceId}
                    className="p-1 rounded bg-emerald-600 text-white text-xs"
                    title="Lưu mã máy"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingDeviceId(true)}
                  className="text-slate-400 hover:text-indigo-400 p-1"
                  title="Đổi tên thiết bị / tên cán bộ"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Thống kê số lượng */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
                Tìm thấy: <strong>{missingCccdList.length}</strong> công dân cần thu CCCD
              </span>
              {isLoadingCccdList && (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
              )}
            </div>
          </div>

          {/* Hàng lọc Thôn & Tìm kiếm */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Lọc theo Thôn */}
            <div className="flex items-center gap-1.5 text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedVillage}
                onChange={(e) => setSelectedVillage(e.target.value)}
                className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                  isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-slate-800 border-slate-700 text-slate-200'
                }`}
              >
                <option value="ALL">Tất cả thôn / buôn</option>
                {availableVillages.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Tìm kiếm */}
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm họ tên, số thửa..."
                className={`w-full pl-8 pr-3 py-1.5 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                  isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-slate-800 border-slate-700 text-slate-200'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Thân Modal: Xem trước ảnh Canvas */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center bg-slate-950/40 min-h-[350px]">
          {missingCccdList.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <p className="font-bold text-sm text-slate-300">
                Tuyệt vời! Không có công dân nào cần thu thập CCCD
              </p>
              <p className="text-xs text-slate-500">
                Toàn bộ hồ sơ do máy này kê khai đều đã có tệp hình ảnh CCCD trên hệ thống.
              </p>
            </div>
          ) : (
            <div className="relative flex flex-col items-center">
              {/* Canvas 1080x1920 (hiển thị co nhỏ vừa khung nhìn) */}
              <div className="rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-950 max-h-[58vh] aspect-[9/16] flex items-center justify-center">
                <canvas
                  ref={canvasRef}
                  className="w-full h-full object-contain"
                  style={{ maxHeight: '58vh' }}
                />
              </div>

              {/* Điều hướng trang nếu số người đông */}
              {totalPages > 1 && (
                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-bold text-slate-300">
                    Trang {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Hành Động */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-400">
            Ảnh chuẩn khổ <strong>1080 x 1920 px (16:9 Dọc)</strong> • Chia 2 cột sắc nét dễ xem trên điện thoại
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={missingCccdList.length === 0}
              onClick={handleCopyImage}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40 ${
                copySuccess
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : isLight
                  ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              {copySuccess ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copySuccess ? 'Đã sao chép ảnh' : 'Sao chép ảnh'}</span>
            </button>

            <button
              type="button"
              disabled={missingCccdList.length === 0}
              onClick={handleShareImage}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow-xs transition cursor-pointer disabled:opacity-40"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Gửi qua Zalo</span>
            </button>

            <button
              type="button"
              disabled={missingCccdList.length === 0}
              onClick={handleDownloadImage}
              className="px-4 py-2 rounded-xl text-xs font-black bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 shadow-md transition cursor-pointer disabled:opacity-40"
            >
              <Download className="w-4 h-4" />
              <span>Tải Ảnh Về Máy</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
