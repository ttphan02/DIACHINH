'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Download,
  Filter,
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Parcel, DeclarationFormData } from '@/types';
import { getOrCreateDeviceId } from '@/utils/declaration';
import { cleanCccd } from '@/utils/syncGoogleSheets';
import parcelsBriefData from '@/data/parcels_brief.json';

const parcelsBrief = parcelsBriefData as unknown as Record<string, [string, string, string, number]>;

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
  maThuaList: string[];
  soThuaList: string[];
  toBanDoList: string[];
  thonXa: string;
  cccdNumber?: string;
  deviceId?: string;
  createdAt?: string;
}

interface VillageImagePage {
  village: string;
  villagePageIndex: number;
  villageTotalPages: number;
  items: MissingCccdPerson[];
}

// Chuẩn hóa tên Thôn / Buôn theo đúng các sheet trên Google Sheets:
// https://docs.google.com/spreadsheets/d/1tRbIwKolgB6kcEsQoOOkI_uYtxc50AJA0I2VMP_u34w
export function getCanonicalVillageName(raw: string): string {
  if (!raw) return 'Chưa xác định';
  const a = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');

  if (a.includes('noh prong')) return 'Thôn Noh Prông';
  if (a.includes('cu phiang') || a.includes('cu piang')) return 'Buôn Cư Phiang';
  if (a.includes('ngo')) return 'Buôn Ngô';
  if (a.includes('tlier') || a.includes('tlia')) return 'Buôn Tliêr';
  if (a.includes('ba phuong') || a.includes('3 phuong')) return 'Thôn Ba Phường';
  if (a.includes('cam phong')) return 'Thôn Cẩm Phong';
  if (a.includes('ea uol')) return 'Thôn Ea Uôl';
  if (a.includes('ea khiem')) return 'Thôn Ea Khiêm';
  if (a.includes('cu te')) return 'Thôn Cư Tê';
  if (a.includes('cu rang')) return 'Thôn Cư Rang';
  if (a.includes('ea lang')) return 'Thôn Ea Lang';
  if (a.includes('ea bar') || a.includes('ea ba')) return 'Thôn Ea Bar';
  if (a.includes('rot')) return 'Thôn Ea Rớt';
  if (a.includes('dak tuor') || a.includes('dak tua')) return 'Buôn Đăk Tuôr';
  if (a.includes('khanh')) return 'Buôn Khanh';
  if (a.includes('khoa')) return 'Buôn Khóa';
  if (a.includes('bhung')) return 'Buôn Bhung';
  if (a.includes('blak')) return 'Buôn Blăk';
  if (a.includes('hoa phong') || a.includes('ho phong')) return 'Thôn Hòa Phong';
  return 'Chưa xác định';
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
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

  // Lọc: "Tôi kê khai" vs "Tất cả"
  const [filterDeviceMode, setFilterDeviceMode] = useState<'THIS_DEVICE' | 'ALL_DEVICES'>('THIS_DEVICE');
  const [selectedVillage, setSelectedVillage] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Danh sách CCCD đã có trên Cloudflare R2
  const [existingCccdSet, setExistingCccdSet] = useState<Set<string>>(new Set());

  // Phân trang ảnh: tối đa 24 cái tên / ảnh (chia làm 2 cột, mỗi cột 12 tên)
  const ITEMS_PER_PAGE = 24;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (isOpen) {
      const id = getOrCreateDeviceId();
      setDeviceId(id);
      fetchExistingCccdList();
    }
  }, [isOpen]);

  const fetchExistingCccdList = async () => {
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
    }
  };

  // Lập danh sách công dân ĐÃ KÊ KHAI nhưng CHƯA CÓ FILE ẢNH CCCD trên R2
  const missingCccdList = useMemo(() => {
    const mapByCitizen = new Map<string, MissingCccdPerson>();

    // Duyệt qua tất cả các bản ghi kê khai
    Object.entries(declarationsMap).forEach(([parcelCode, decl]) => {
      if (!decl) return;

      const declDeviceId = decl.device_id ? String(decl.device_id).trim() : 'MAY_DEF';

      // Lọc theo chế độ: "Tôi kê khai" vs "Tất cả"
      if (filterDeviceMode === 'THIS_DEVICE' && declDeviceId !== deviceId) {
        return;
      }

      // Lấy số CCCD (nếu đã nhập trong kê khai)
      const cccdRaw = decl.chu_dat_cccd || '';
      const cccdClean = cleanCccd(cccdRaw);

      // Nếu đã có file PDF trên R2 cho số CCCD này => KHÔNG THIẾU
      if (cccdClean.length === 12 && existingCccdSet.has(cccdClean)) {
        return;
      }

      // Lấy họ tên chủ đất
      const name = String(decl.chu_dat_ten || decl.chu_ho || '').trim();
      if (!name || name === 'Chưa có tên') return;

      // Lấy thông tin mã thửa, số thửa, tờ bản đồ
      const maThua = String(decl.ma_thua || parcelCode || '').trim();
      const soThua = String(decl.so_thua || '').trim();
      const toBanDo = String(decl.to_ban_do || '').trim();

      // Xác định địa chỉ Thôn / Buôn dựa vào Google Sheets
      // Nếu thửa a ở sheet b thì địa chỉ thửa a là sheet b
      let rawVillage = '';
      if (maThua && parcelsBrief[maThua]) {
        rawVillage = parcelsBrief[maThua][2];
      } else if (decl.dia_chi_thua_dat || decl.chu_dat_dia_chi) {
        rawVillage = decl.dia_chi_thua_dat || decl.chu_dat_dia_chi;
      }
      const thonXa = getCanonicalVillageName(rawVillage);

      // Gom nhóm theo Họ tên + Thôn (tránh trùng lặp 1 người có nhiều thửa trong 1 thôn)
      const groupKey = `${name.toLowerCase()}___${thonXa.toLowerCase()}`;
      if (mapByCitizen.has(groupKey)) {
        const existing = mapByCitizen.get(groupKey)!;
        if (maThua && !existing.maThuaList.includes(maThua)) existing.maThuaList.push(maThua);
        if (soThua && !existing.soThuaList.includes(soThua)) existing.soThuaList.push(soThua);
        if (toBanDo && !existing.toBanDoList.includes(toBanDo)) existing.toBanDoList.push(toBanDo);
      } else {
        mapByCitizen.set(groupKey, {
          key: groupKey,
          name,
          maThuaList: maThua ? [maThua] : [],
          soThuaList: soThua ? [soThua] : [],
          toBanDoList: toBanDo ? [toBanDo] : [],
          thonXa,
          cccdNumber: cccdClean.length === 12 ? cccdClean : undefined,
          deviceId: declDeviceId,
          createdAt: decl.created_at,
        });
      }
    });

    return Array.from(mapByCitizen.values());
  }, [declarationsMap, existingCccdSet, filterDeviceMode, deviceId]);

  // Danh sách các thôn có trong danh sách cần thu thập kèm số lượng
  const availableVillages = useMemo(() => {
    const counts: Record<string, number> = {};
    missingCccdList.forEach((i) => {
      if (i.thonXa) counts[i.thonXa] = (counts[i.thonXa] || 0) + 1;
    });
    return Object.keys(counts)
      .sort((a, b) => a.localeCompare(b, 'vi'))
      .map((v) => ({ village: v, count: counts[v] }));
  }, [missingCccdList]);

  // Danh sách sau khi lọc tìm kiếm và dropdown thôn
  const filteredCitizens = useMemo(() => {
    let list = missingCccdList;

    // Lọc theo dropdown Thôn/Buôn
    if (selectedVillage !== 'ALL') {
      list = list.filter((item) => item.thonXa === selectedVillage);
    }

    // Lọc theo tìm kiếm (tên hoặc mã thửa)
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

  // PHÂN TÁCH ẢNH THEO TỪNG THÔN BUÔN:
  // Kể cả khi chọn "Tất cả Thôn / Buôn", mỗi ảnh chỉ thuộc 1 thôn buôn duy nhất!
  const pageChunks = useMemo(() => {
    const chunks: VillageImagePage[] = [];

    // Gom nhóm người theo Thôn / Buôn
    const villageGroups: Record<string, MissingCccdPerson[]> = {};
    filteredCitizens.forEach((person) => {
      const v = person.thonXa || 'Chưa xác định';
      if (!villageGroups[v]) villageGroups[v] = [];
      villageGroups[v].push(person);
    });

    const sortedVillages = Object.keys(villageGroups).sort((a, b) => a.localeCompare(b, 'vi'));

    sortedVillages.forEach((village) => {
      const people = villageGroups[village].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      const totalVillagePages = Math.max(1, Math.ceil(people.length / ITEMS_PER_PAGE));
      for (let p = 0; p < totalVillagePages; p++) {
        chunks.push({
          village,
          villagePageIndex: p + 1,
          villageTotalPages: totalVillagePages,
          items: people.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE),
        });
      }
    });

    return chunks;
  }, [filteredCitizens]);

  const totalPages = Math.max(1, pageChunks.length);
  const activeChunk: VillageImagePage | undefined = pageChunks[currentPage - 1] || pageChunks[0];

  // Tự động điều chỉnh trang nếu vượt quá
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  // Vẽ Canvas Poster (1080 x 1920) tối ưu cho điện thoại
  useEffect(() => {
    if (!isOpen || !canvasRef.current || !activeChunk) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderCanvasImage(ctx, activeChunk);
  }, [isOpen, activeChunk, currentPage]);

  // Hàm vẽ poster chuẩn tỷ lệ 9:16 (1080x1920)
  // Tối giản tối đa: Chữ to rõ, không số thứ tự, chỉ có Tên & Mã thửa, không cơ quan/máy móc rườm rà
  const renderCanvasImage = (ctx: CanvasRenderingContext2D, chunk: VillageImagePage) => {
    const W = 1080;
    const H = 1920;

    // 1. Nền Gradient Sang trọng
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#090d16');
    bgGrad.addColorStop(0.5, '#0f172a');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Hoa văn lưới mờ
    ctx.fillStyle = 'rgba(255, 255, 255, 0.012)';
    for (let i = 0; i < W; i += 40) ctx.fillRect(i, 0, 1, H);
    for (let j = 0; j < H; j += 40) ctx.fillRect(0, j, W, 1);

    // Khung viền ngoài
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, W - 40, H - 40);

    // 2. HEADER - Tinh giản, chữ to
    // Dải băng màu nhỏ trên cùng
    const bannerGrad = ctx.createLinearGradient(0, 30, W, 30);
    bannerGrad.addColorStop(0, '#4338ca');
    bannerGrad.addColorStop(0.5, '#6366f1');
    bannerGrad.addColorStop(1, '#ec4899');
    ctx.fillStyle = bannerGrad;
    ctx.fillRect(30, 30, W - 60, 5);

    // Tiêu đề to nổi bật ở trên cùng
    ctx.fillStyle = '#f8fafc';
    ctx.font = "900 58px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText('CẦN THU THẬP CCCD', W / 2, 115);

    // Thanh tag Thôn / Buôn và Trang ảnh
    const tagY = 145;
    const tagW = 860;
    const tagH = 58;
    const tagX = (W - tagW) / 2;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(tagX, tagY, tagW, tagH, 29);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fca5a5';
    ctx.font = "bold 23px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = 'center';
    const nowStr = new Date().toLocaleDateString('vi-VN');
    const villageUpper = chunk.village.toUpperCase();
    const pageStr = chunk.villageTotalPages > 1 ? `ẢNH ${chunk.villagePageIndex}/${chunk.villageTotalPages}` : 'ẢNH 1/1';
    ctx.fillText(`${villageUpper} • ${pageStr} • NGÀY ${nowStr}`, W / 2, tagY + 38);

    // 3. NỘI DUNG 2 CỘT TÊN CÔNG DÂN (TỐI ĐA 12 HÀNG / CỘT)
    const colY = 230;
    const colBottom = 1835;
    const colH = colBottom - colY;
    const colW = 485;
    const col1X = 40;
    const col2X = 555;

    const items = chunk.items;
    const half = Math.ceil(items.length / 2);
    const col1Items = items.slice(0, half);
    const col2Items = items.slice(half);

    const renderColumn = (colItems: MissingCccdPerson[], startX: number) => {
      const maxRows = 12;
      const rowH = colH / maxRows;
      const cardH = rowH - 10;

      colItems.forEach((item, rIdx) => {
        const itemY = colY + rIdx * rowH;

        // Nền hàng (xen kẽ)
        if (rIdx % 2 === 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
        }
        ctx.beginPath();
        ctx.roundRect(startX, itemY, colW, cardH, 14);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        const textX = startX + 22;

        // 1. Tên công dân (Chữ in hoa, cỡ chữ 32px cực kỳ to, đậm và rõ)
        ctx.fillStyle = '#ffffff';
        ctx.font = "bold 32px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
        ctx.textAlign = 'left';
        const nameY = itemY + 46;

        let displayName = item.name.toUpperCase();
        if (ctx.measureText(displayName).width > 440) {
          while (displayName.length > 3 && ctx.measureText(displayName + '...').width > 440) {
            displayName = displayName.slice(0, -1);
          }
          displayName += '...';
        }
        ctx.fillText(displayName, textX, nameY);

        // 2. Mã thửa (Cỡ chữ 24px đậm, màu xanh cyan nổi bật)
        ctx.fillStyle = '#38bdf8';
        ctx.font = "bold 24px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
        const subY = itemY + 90;

        const maThuaDisplay =
          item.maThuaList.length > 0
            ? `Mã thửa: ${item.maThuaList.slice(0, 3).join(', ')}`
            : item.soThuaList.length > 0
            ? `Thửa: ${item.soThuaList.slice(0, 4).join(', ')}`
            : 'Chưa có mã thửa';

        let displaySub = maThuaDisplay;
        if (ctx.measureText(displaySub).width > 440) {
          while (displaySub.length > 3 && ctx.measureText(displaySub + '...').width > 440) {
            displaySub = displaySub.slice(0, -1);
          }
          displaySub += '...';
        }
        ctx.fillText(displaySub, textX, subY);
      });
    };

    renderColumn(col1Items, col1X);
    renderColumn(col2Items, col2X);

    // 4. FOOTER - 1 dòng ghi chú mảnh ở dưới cùng
    const footY = 1855;
    ctx.fillStyle = '#fca5a5';
    ctx.font = "bold 20px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText(
      '⚠ LƯU Ý: Vui lòng chụp rõ nét 2 mặt CCCD gửi Cán bộ để hoàn tất hồ sơ',
      W / 2,
      footY + 28
    );
  };

  // Tải ảnh trang hiện tại về máy
  const handleDownloadImage = () => {
    if (!canvasRef.current || !activeChunk) return;
    const canvas = canvasRef.current;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const vSlug = slugify(activeChunk.village);
      a.download = `CAN_THU_THAP_CCCD_${vSlug}_Trang_${activeChunk.villagePageIndex}_tren_${activeChunk.villageTotalPages}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.95);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div
        className={`relative w-full max-w-4xl max-h-[94vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden ${
          isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        {/* Header Modal - Tối giản */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-600/10 text-rose-500">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black">Xuất DS Cần Thu Thập CCCD</h2>
              <p className="text-[11px] text-slate-500">
                Ảnh 16:9 dọc tối ưu điện thoại • Phân chia theo từng Thôn/Buôn
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

        {/* Thanh công cụ: Chọn Thiết bị (Tôi kê khai / Tất cả), Thôn/Buôn & Tìm kiếm */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Phân loại: "Tôi kê khai" vs "Tất cả" */}
            <div className="flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950/80">
              <button
                type="button"
                onClick={() => setFilterDeviceMode('THIS_DEVICE')}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${
                  filterDeviceMode === 'THIS_DEVICE'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-200'
                }`}
              >
                Tôi kê khai
              </button>
              <button
                type="button"
                onClick={() => setFilterDeviceMode('ALL_DEVICES')}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${
                  filterDeviceMode === 'ALL_DEVICES'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-200'
                }`}
              >
                Tất cả
              </button>
            </div>

            {/* Lọc Thôn & Tìm kiếm */}
            <div className="flex items-center gap-2 flex-1 max-w-md justify-end">
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedVillage}
                  onChange={(e) => {
                    setSelectedVillage(e.target.value);
                    setCurrentPage(1);
                  }}
                  className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-slate-800 border-slate-700 text-slate-200'
                  }`}
                >
                  <option value="ALL">Tất cả thôn / buôn ({missingCccdList.length})</option>
                  {availableVillages.map((v) => (
                    <option key={v.village} value={v.village}>
                      {v.village} ({v.count})
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative min-w-[140px] sm:min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Tìm tên, mã thửa..."
                  className={`w-full pl-8 pr-3 py-1.5 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-slate-800 border-slate-700 text-slate-200'
                  }`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Thân Modal: Xem trước ảnh Canvas */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center bg-slate-950/40 min-h-[350px]">
          {pageChunks.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Users className="w-12 h-12 mx-auto text-slate-600 stroke-[1.5]" />
              <p className="text-sm font-semibold text-slate-300">Không tìm thấy công dân nào cần thu thập CCCD</p>
              <p className="text-xs text-slate-500">
                {filterDeviceMode === 'THIS_DEVICE'
                  ? 'Máy này chưa kê khai thửa nào thiếu CCCD, hoặc tất cả đều đã có ảnh trên hệ thống.'
                  : 'Tất cả các thửa đã kê khai đều đã có file ảnh CCCD trên Cloudflare R2.'}
              </p>
            </div>
          ) : (
            <div className="relative flex flex-col items-center">
              {/* Thẻ thông báo Thôn Buôn & Trang ảnh hiện tại */}
              {activeChunk && (
                <div className="mb-2.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-2">
                  <span className="text-sky-400">{activeChunk.village}</span>
                  <span className="text-slate-500">•</span>
                  <span>Trang {activeChunk.villagePageIndex} / {activeChunk.villageTotalPages}</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-rose-400">{activeChunk.items.length} công dân</span>
                </div>
              )}

              {/* Vùng hiển thị Canvas (thu nhỏ tỷ lệ responsive vừa vặn màn hình) */}
              <div className="rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-black flex items-center justify-center max-h-[58vh]">
                <canvas
                  ref={canvasRef}
                  width={1080}
                  height={1920}
                  style={{
                    maxHeight: '56vh',
                    width: 'auto',
                    aspectRatio: '9 / 16',
                    display: 'block',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Modal: Điều hướng ảnh & DUY NHẤT 1 NÚT "TẢI VỀ MÁY" */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 shrink-0">
          {/* Thanh phân trang điều hướng nếu có nhiều ảnh */}
          {totalPages > 1 ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer disabled:cursor-not-allowed"
                title="Ảnh trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800">
                Ảnh {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer disabled:cursor-not-allowed"
                title="Ảnh tiếp theo"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-500 font-semibold">
              {pageChunks.length === 1 ? '1 ảnh duy nhất' : ''}
            </div>
          )}

          {/* Nút hành động DUY NHẤT: Tải Về Máy */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              disabled={pageChunks.length === 0}
              onClick={handleDownloadImage}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition cursor-pointer bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-md shadow-rose-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Tải ảnh trang hiện tại về máy"
            >
              <Download className="w-4 h-4" />
              <span>
                {totalPages > 1 && activeChunk
                  ? `Tải Về Máy (${activeChunk.village} - Ảnh ${activeChunk.villagePageIndex}/${activeChunk.villageTotalPages})`
                  : 'Tải Về Máy'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
