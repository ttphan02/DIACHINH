'use client';

import React from 'react';
import { Parcel, DeclarationFormData } from '@/types';
import { Printer, X, Download, FileText, CheckCircle2, ShieldCheck, MapPin } from 'lucide-react';

export interface PrintableDeclarationItem {
  parcel: Parcel;
  declaration?: Partial<DeclarationFormData> & { created_at?: string };
}

interface DeclarationPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: PrintableDeclarationItem[];
  title?: string;
}

export default function DeclarationPrintModal({
  isOpen,
  onClose,
  items,
  title = 'Tập Đơn Kê Khai Đăng Ký Đất Đai',
}: DeclarationPrintModalProps) {
  if (!isOpen || items.length === 0) return null;

  const handlePrint = () => {
    window.print();
  };

  const currentDate = new Date();
  const day = currentDate.getDate();
  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/80 backdrop-blur-md overflow-hidden">
      {/* Header bar (Bị ẩn khi bấm In / Xuất PDF) */}
      <div className="no-print bg-slate-900 border-b border-slate-800 px-4 py-3 sm:px-6 flex items-center justify-between shadow-xl shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              {title}
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">
                {items.length} bộ hồ sơ
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Mỗi đơn kê khai tự động ngắt trên 1 trang A4 chuẩn • Chọn &quot;Lưu dưới dạng PDF&quot; (Save as PDF) trong hộp thoại in
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition transform active:scale-95 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>In / Lưu PDF ({items.length} đơn)</span>
          </button>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Đóng xem trước"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Vùng xem trước và in ấn A4 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-950/90 flex flex-col items-center gap-8">
        {items.map((item, index) => {
          const p = item.parcel;
          const decl = item.declaration || {};
          const chuHo = decl.chu_dat_ten || p.chu_ho || '...................................................';
          const cccd = decl.chu_dat_cccd || p.cccd || '.......................................';
          const sdt = decl.nguoi_ke_khai_sdt || p.sdt || '................................';
          const diaChi = decl.chu_dat_dia_chi || (p.thon_xa ? `${p.thon_xa}, xã Cư Pui` : 'Xã Cư Pui, huyện Krông Bông');
          const nguoiKekhai = decl.nguoi_ke_khai_ten || chuHo;
          const ghiChu = decl.ghi_chu || 'Đất sử dụng ổn định, không có tranh chấp.';
          const ngaySinh = decl.chu_dat_ngay_sinh || '.............';

          // Format ngày kê khai
          let declDateStr = `ngày ${day} tháng ${month} năm ${year}`;
          if (decl.created_at) {
            try {
              const d = new Date(decl.created_at);
              declDateStr = `ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
            } catch {}
          }

          return (
            <div
              key={p.ma_thua || index}
              className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] p-8 sm:p-12 shadow-2xl rounded-sm font-serif text-[13.5px] leading-relaxed relative flex flex-col justify-between"
              style={{ fontFamily: '"Times New Roman", Times, serif' }}
            >
              <div>
                {/* 1. Quốc hiệu, tiêu ngữ */}
                <div className="text-center space-y-1 pb-4">
                  <div className="font-bold text-[13px] tracking-wide uppercase">
                    CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                  </div>
                  <div className="font-bold text-[14px]">
                    Độc lập - Tự do - Hạnh phúc
                  </div>
                  <div className="w-36 h-[1px] bg-black mx-auto mt-1 mb-3"></div>
                  
                  <div className="text-[12px] italic text-gray-600 pt-1">
                    (Mẫu phiếu thu thập thông tin & Kê khai đăng ký địa chính cơ sở)
                  </div>
                </div>

                {/* 2. Tiêu đề đơn */}
                <div className="text-center my-4 space-y-1">
                  <h1 className="text-[16px] sm:text-[18px] font-bold uppercase tracking-tight">
                    ĐƠN ĐĂNG KÝ, KÊ KHAI ĐẤT ĐAI
                  </h1>
                  <p className="text-[13px] italic font-normal">
                    (Phục vụ công tác số hóa bản đồ & rà soát cấp Giấy chứng nhận QSDĐ)
                  </p>
                </div>

                {/* 3. Kính gửi */}
                <div className="my-3 pl-4 space-y-0.5 italic">
                  <div><strong>Kính gửi:</strong> - Ủy ban nhân dân xã Cư Pui, huyện Krông Bông;</div>
                  <div className="pl-14">- Chi nhánh Văn phòng Đăng ký Đất đai huyện Krông Bông.</div>
                </div>

                {/* 4. Phần I: Thông tin người sử dụng đất */}
                <div className="mt-5 space-y-2">
                  <div className="font-bold uppercase text-[13.5px] border-b border-gray-400 pb-0.5">
                    I. THÔNG TIN NGƯỜI SỬ DỤNG ĐẤT / CHỦ THỬA ĐẤT:
                  </div>
                  
                  <div className="grid grid-cols-1 gap-1.5 pt-1 pl-2">
                    <div>
                      1. Họ và tên người sử dụng đất: <strong className="uppercase text-[14px]">{chuHo}</strong>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1">
                      <div>2. Năm sinh: <strong>{ngaySinh}</strong></div>
                      <div>Số CCCD/CMND: <strong className="font-mono">{cccd}</strong></div>
                      <div>Số điện thoại: <strong>{sdt}</strong></div>
                    </div>
                    <div>
                      3. Địa chỉ thường trú: <strong>{diaChi}</strong>
                    </div>
                    <div>
                      4. Người thực hiện kê khai: <strong>{nguoiKekhai}</strong> (Quan hệ: {decl.mode === 'SURVEYOR' ? 'Cán bộ đo đạc / Kê khai hộ' : 'Chính chủ sử dụng đất'})
                    </div>
                  </div>
                </div>

                {/* 5. Phần II: Thông tin thửa đất kê khai */}
                <div className="mt-5 space-y-2">
                  <div className="font-bold uppercase text-[13.5px] border-b border-gray-400 pb-0.5">
                    II. THÔNG TIN THỬA ĐẤT KÊ KHAI, ĐĂNG KÝ:
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 pt-1 pl-2">
                    <div className="flex flex-wrap gap-x-8 gap-y-1">
                      <div>1. Thửa đất số: <strong className="text-[15px]">{p.so_thua}</strong></div>
                      <div>Tờ bản đồ số: <strong className="text-[15px]">{p.to_ban_do}</strong></div>
                      <div>Mã định danh thửa: <strong className="font-mono text-gray-700">{p.ma_thua}</strong></div>
                    </div>

                    <div>
                      2. Địa chỉ thửa đất: <strong>{p.thon_xa ? `${p.thon_xa}, xã Cư Pui` : 'Xã Cư Pui, huyện Krông Bông, tỉnh Đắk Lắk'}</strong>
                    </div>

                    <div className="flex flex-wrap gap-x-8 gap-y-1">
                      <div>3. Diện tích đo đạc / quản lý: <strong className="text-[15px]">{p.dien_tich ? `${p.dien_tich} m²` : '................ m²'}</strong></div>
                      <div>Mục đích sử dụng (Loại đất): <strong className="font-mono">{p.loai_dat || 'Chưa rõ'}</strong></div>
                    </div>

                    {p.lat && p.lng && (
                      <div className="text-[12px] text-gray-700 font-mono">
                        4. Tọa độ GPS vệ tinh: Vĩ độ (Lat): {p.lat} • Kinh độ (Lng): {p.lng}
                      </div>
                    )}
                  </div>
                </div>

                {/* 6. Phần III: Tài liệu minh chứng & Hiện trạng */}
                <div className="mt-5 space-y-2">
                  <div className="font-bold uppercase text-[13.5px] border-b border-gray-400 pb-0.5">
                    III. NGUỒN GỐC & TÀI LIỆU MINH CHỨNG ĐÍNH KÈM:
                  </div>
                  <div className="pt-1 pl-2 space-y-1">
                    <div>
                      - Nguồn gốc, hiện trạng sử dụng đất: <em>{ghiChu}</em>
                    </div>
                    <div>
                      - Giấy tờ kèm theo hồ sơ:
                      <span className="ml-1 text-[13px]">
                        [x] Bản sao CCCD chủ hộ • [x] Bản trích lục tọa độ bản đồ số hóa • {decl.anh_gcn ? '[x] Bản chụp Giấy chứng nhận' : '[ ] Chưa nộp GCN'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 7. Cam đoan */}
                <div className="mt-5 text-[13px] italic text-justify leading-normal pl-2">
                  Tôi xin cam đoan toàn bộ nội dung kê khai trên đây là hoàn toàn trung thực, đúng thực tế sử dụng đất, không có tranh chấp khiếu nại. Nếu có bất kỳ sự sai lệch nào, tôi xin chịu hoàn toàn trách nhiệm trước pháp luật.
                </div>
              </div>

              {/* 8. Ký tên và xác nhận */}
              <div className="mt-8 pt-4">
                <div className="text-right italic pr-6 mb-2">
                  Cư Pui, {declDateStr}
                </div>

                <div className="grid grid-cols-2 text-center text-[13.5px]">
                  <div>
                    <div className="font-bold uppercase">XÁC NHẬN CỦA UBND XÃ CƯ PUI</div>
                    <div className="italic text-[12px] text-gray-500">(Ký tên, đóng dấu)</div>
                    <div className="h-24"></div>
                  </div>

                  <div>
                    <div className="font-bold uppercase">NGƯỜI KÊ KHAI / CHỦ SỬ DỤNG ĐẤT</div>
                    <div className="italic text-[12px] text-gray-500">(Ký và ghi rõ họ tên)</div>
                    <div className="h-24 flex items-end justify-center font-bold text-gray-800">
                      {nguoiKekhai !== '...................................................' ? nguoiKekhai : ''}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-gray-400 italic text-center pt-4 border-t border-gray-200 mt-2">
                  Hồ sơ được số hóa tự động từ Hệ thống Bản đồ Địa chính điện tử Xã Cư Pui • Trang {index + 1}/{items.length}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
