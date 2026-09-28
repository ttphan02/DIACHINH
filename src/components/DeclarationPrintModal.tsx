'use client';

import React from 'react';
import { Parcel, DeclarationFormData, AdditionalParcel } from '@/types';
import { Printer, X, FileText, CheckCircle2, ShieldCheck, MapPin } from 'lucide-react';

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
  title = 'Tập Đơn Kê Khai Đăng Ký Đất Đai & CCCD',
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
              Mỗi bộ gồm <strong>Trang CCCD trước</strong> + <strong>Đơn kê khai đất đai</strong> • Tự động ngắt trang A4 chuẩn
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition transform active:scale-95 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>In / Lưu PDF ({items.length} bộ)</span>
          </button>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Đóng xem trước"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Vùng xem trước và in ấn A4 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-950/90 flex flex-col items-center gap-10">
        {items.map((item, index) => {
          const p = item.parcel;
          const decl = item.declaration || {};
          const chuHo = decl.chu_dat_ten || p.chu_ho || '...................................................';
          const cccd = decl.chu_dat_cccd || p.cccd || '.......................................';
          const sdt = decl.nguoi_ke_khai_sdt || p.sdt || '................................';
          const diaChi = decl.chu_dat_dia_chi || (p.thon_xa ? `${p.thon_xa}, xã Cư Pui` : 'Xã Cư Pui, huyện Krông Bông, tỉnh Đắk Lắk');
          const nguoiKekhai = decl.nguoi_ke_khai_ten || chuHo;
          const ghiChu = decl.ghi_chu || 'Đất sử dụng ổn định, không có tranh chấp.';
          const ngaySinh = decl.chu_dat_ngay_sinh || '.............';

          // Danh sách các thửa kèm theo nếu kê khai nhiều thửa
          const additionalParcels: AdditionalParcel[] = decl.thua_kem_theo || [];
          const allDeclaredParcels = [
            {
              stt: 1,
              so_thua: p.so_thua,
              to_ban_do: p.to_ban_do,
              dien_tich: p.dien_tich,
              loai_dat: p.loai_dat,
              thon_xa: p.thon_xa,
              nguon_goc: 'Khai hoang',
            },
            ...additionalParcels.map((ap, i) => ({
              stt: i + 2,
              so_thua: ap.so_thua,
              to_ban_do: ap.to_ban_do,
              dien_tich: ap.dien_tich,
              loai_dat: ap.loai_dat,
              thon_xa: ap.thon_xa || p.thon_xa,
              nguon_goc: ap.nguon_goc || 'Khai hoang',
            })),
          ];

          // Format ngày kê khai
          let declDateStr = `ngày ${day} tháng ${month} năm ${year}`;
          if (decl.created_at) {
            try {
              const d = new Date(decl.created_at);
              declDateStr = `ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
            } catch {}
          }

          // Ảnh CCCD mặt trước và mặt sau
          const frontCccd = decl.anh_cccd_truoc || (p.cccd_url ? p.cccd_url : null);
          const backCccd = decl.anh_cccd_sau || null;

          return (
            <React.Fragment key={p.ma_thua || index}>
              {/* ======================================================== */}
              {/* TRANG 1: BẢN SAO CĂN CƯỚC CÔNG DÂN (TRƯỚC 4 TRANG ĐƠN) */}
              {/* ======================================================== */}
              <div
                className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] p-8 sm:p-12 shadow-2xl rounded-sm font-serif text-[13.5px] leading-relaxed relative flex flex-col justify-between"
                style={{ fontFamily: '"Times New Roman", Times, serif', pageBreakAfter: 'always' }}
              >
                <div>
                  {/* Tiêu ngữ */}
                  <div className="text-center space-y-1 pb-2">
                    <div className="font-bold text-[13px] tracking-wide uppercase">
                      CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                    </div>
                    <div className="font-bold text-[14px]">
                      Độc lập - Tự do - Hạnh phúc
                    </div>
                    <div className="w-36 h-[1.5px] bg-black mx-auto mt-1 mb-2"></div>
                  </div>

                  {/* Tiêu đề trang CCCD */}
                  <div className="text-center my-3 space-y-1">
                    <h1 className="text-[17px] font-bold uppercase tracking-tight">
                      BẢN SAO CĂN CƯỚC CÔNG DÂN
                    </h1>
                    <p className="text-[12px] italic text-gray-700">
                      (Đính kèm Đơn đăng ký đất đai, tài sản gắn liền với đất theo quy định)
                    </p>
                  </div>

                  {/* Khung tóm tắt thông tin chủ hộ */}
                  <div className="border border-gray-300 rounded-lg p-3 bg-gray-50/70 text-[13px] space-y-1 my-3">
                    <div className="flex justify-between items-baseline">
                      <div>
                        Chủ sử dụng đất: <strong className="uppercase text-[14px]">{chuHo}</strong>
                      </div>
                      <div>
                        Số CCCD/ĐDCN: <strong className="font-mono text-[14px] text-blue-900">{cccd}</strong>
                      </div>
                    </div>
                    <div>
                      Địa chỉ thường trú: <strong>{diaChi}</strong>
                    </div>
                    <div>
                      Số lượng thửa đất kê khai: <strong>{allDeclaredParcels.length} thửa</strong>{' '}
                      <span className="text-gray-600 italic">
                        ({allDeclaredParcels.map((dp) => `Thửa ${dp.so_thua} Tờ ${dp.to_ban_do}`).join(', ')})
                      </span>
                    </div>
                  </div>

                  {/* Vùng hiển thị ảnh CCCD */}
                  <div className="mt-4 space-y-4">
                    {/* Mặt trước */}
                    <div className="border border-gray-300 rounded-xl p-3 bg-white text-center flex flex-col items-center justify-center min-h-[220px]">
                      {frontCccd ? (
                        <div className="max-w-[440px] max-h-[220px] overflow-hidden rounded-lg shadow-sm border border-gray-200">
                          <img
                            src={frontCccd}
                            alt="Mặt trước CCCD"
                            className="w-full h-full object-contain max-h-[220px]"
                          />
                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-gray-300 w-full max-w-[440px] h-[190px] rounded-xl flex flex-col items-center justify-center text-gray-400 p-4">
                          <span className="font-bold text-xs uppercase text-gray-600 mb-1">
                            [ Vị trí dán / đính kèm Bản sao mặt trước CCCD ]
                          </span>
                          <span className="text-[11px] italic">
                            (Bản sao hoặc hình ảnh chụp CCCD mặt trước rõ số, rõ chữ)
                          </span>
                        </div>
                      )}
                      <span className="text-[11px] font-bold uppercase text-gray-700 mt-2 block tracking-wider">
                        ▲ Mặt trước Căn cước công dân
                      </span>
                    </div>

                    {/* Mặt sau */}
                    <div className="border border-gray-300 rounded-xl p-3 bg-white text-center flex flex-col items-center justify-center min-h-[220px]">
                      {backCccd ? (
                        <div className="max-w-[440px] max-h-[220px] overflow-hidden rounded-lg shadow-sm border border-gray-200">
                          <img
                            src={backCccd}
                            alt="Mặt sau CCCD"
                            className="w-full h-full object-contain max-h-[220px]"
                          />
                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-gray-300 w-full max-w-[440px] h-[190px] rounded-xl flex flex-col items-center justify-center text-gray-400 p-4">
                          <span className="font-bold text-xs uppercase text-gray-600 mb-1">
                            [ Vị trí dán / đính kèm Bản sao mặt sau CCCD ]
                          </span>
                          <span className="text-[11px] italic">
                            (Bản sao hoặc hình ảnh chụp CCCD mặt sau có vân tay và ngày cấp)
                          </span>
                        </div>
                      )}
                      <span className="text-[11px] font-bold uppercase text-gray-700 mt-2 block tracking-wider">
                        ▲ Mặt sau Căn cước công dân
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer trang CCCD */}
                <div className="pt-4 border-t border-gray-300 flex justify-between items-center text-[11px] text-gray-600 italic">
                  <span>Hồ sơ quản lý địa chính xã Cư Pui • Huyện Krông Bông, tỉnh Đắk Lắk</span>
                  <span className="font-bold not-italic">Trang 1 / Bản sao CCCD</span>
                </div>
              </div>

              {/* ======================================================== */}
              {/* TRANG 2: ĐƠN ĐĂNG KÝ, KÊ KHAI ĐẤT ĐAI (MẪU SỐ 15) */}
              {/* ======================================================== */}
              <div
                className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] p-8 sm:p-12 shadow-2xl rounded-sm font-serif text-[13.5px] leading-relaxed relative flex flex-col justify-between"
                style={{ fontFamily: '"Times New Roman", Times, serif', pageBreakAfter: 'always' }}
              >
                <div>
                  {/* 1. Quốc hiệu, tiêu ngữ */}
                  <div className="text-center space-y-1 pb-3">
                    <div className="font-bold text-[13px] tracking-wide uppercase">
                      CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                    </div>
                    <div className="font-bold text-[14px]">
                      Độc lập - Tự do - Hạnh phúc
                    </div>
                    <div className="w-36 h-[1px] bg-black mx-auto mt-1 mb-2"></div>
                    <div className="text-[11.5px] italic text-gray-600">
                      (Mẫu số 15 - Kê khai đăng ký đất đai, tài sản gắn liền với đất)
                    </div>
                  </div>

                  {/* 2. Tiêu đề đơn */}
                  <div className="text-center my-3 space-y-1">
                    <h1 className="text-[16px] sm:text-[18px] font-bold uppercase tracking-tight">
                      ĐƠN ĐĂNG KÝ, KÊ KHAI ĐẤT ĐAI
                    </h1>
                    <p className="text-[12.5px] italic font-normal">
                      (Phục vụ công tác số hóa bản đồ & rà soát cấp Giấy chứng nhận QSDĐ)
                    </p>
                  </div>

                  {/* 3. Kính gửi */}
                  <div className="my-2 pl-4 space-y-0.5 italic text-[13px]">
                    <div><strong>Kính gửi:</strong> - Ủy ban nhân dân xã Cư Pui, huyện Krông Bông;</div>
                    <div className="pl-14">- Chi nhánh Văn phòng Đăng ký Đất đai huyện Krông Bông.</div>
                  </div>

                  {/* 4. Phần I: Thông tin người sử dụng đất */}
                  <div className="mt-4 space-y-1.5">
                    <div className="font-bold uppercase text-[13px] border-b border-gray-400 pb-0.5">
                      I. THÔNG TIN NGƯỜI SỬ DỤNG ĐẤT / CHỦ HỘ:
                    </div>
                    
                    <div className="grid grid-cols-1 gap-1 pt-1 pl-2">
                      <div>
                        1. Họ và tên người sử dụng đất: <strong className="uppercase text-[14px]">{chuHo}</strong>
                      </div>
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        <div>2. Năm sinh: <strong>{ngaySinh}</strong></div>
                        <div>Số CCCD: <strong className="font-mono">{cccd}</strong></div>
                        <div>Số điện thoại: <strong>{sdt}</strong></div>
                      </div>
                      <div>
                        3. Địa chỉ thường trú: <strong>{diaChi}</strong>
                      </div>
                      <div>
                        4. Người thực hiện kê khai: <strong>{nguoiKekhai}</strong> (Quan hệ: {decl.mode === 'SURVEYOR' ? 'Cán bộ đo đạc / Kê khai thay' : 'Chính chủ sử dụng đất'})
                      </div>
                    </div>
                  </div>

                  {/* 5. Phần II: Danh sách các thửa đất kê khai (Hỗ trợ 1 hoặc nhiều thửa) */}
                  <div className="mt-4 space-y-1.5">
                    <div className="font-bold uppercase text-[13px] border-b border-gray-400 pb-0.5 flex justify-between items-center">
                      <span>II. DANH SÁCH THỬA ĐẤT KÊ KHAI, ĐĂNG KÝ ({allDeclaredParcels.length} THỬA):</span>
                    </div>

                    <div className="pt-1 overflow-x-auto">
                      <table className="w-full text-left border-collapse border border-gray-400 text-[12px]">
                        <thead>
                          <tr className="bg-gray-100 font-bold text-center">
                            <th className="border border-gray-400 px-2 py-1.5 w-10">STT</th>
                            <th className="border border-gray-400 px-2 py-1.5">Số Thửa</th>
                            <th className="border border-gray-400 px-2 py-1.5">Số Tờ BĐ</th>
                            <th className="border border-gray-400 px-2 py-1.5">Diện tích (m²)</th>
                            <th className="border border-gray-400 px-2 py-1.5">Loại đất</th>
                            <th className="border border-gray-400 px-2 py-1.5">Địa chỉ thửa</th>
                            <th className="border border-gray-400 px-2 py-1.5">Nguồn gốc</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allDeclaredParcels.map((dp) => (
                            <tr key={dp.stt} className="text-center">
                              <td className="border border-gray-400 px-2 py-1">{dp.stt}</td>
                              <td className="border border-gray-400 px-2 py-1 font-bold">{dp.so_thua}</td>
                              <td className="border border-gray-400 px-2 py-1 font-bold">{dp.to_ban_do}</td>
                              <td className="border border-gray-400 px-2 py-1 font-bold text-right pr-3">
                                {dp.dien_tich || '---'}
                              </td>
                              <td className="border border-gray-400 px-2 py-1 font-mono">{dp.loai_dat || '---'}</td>
                              <td className="border border-gray-400 px-2 py-1 text-left pl-2">
                                {dp.thon_xa ? `${dp.thon_xa}, Cư Pui` : 'Xã Cư Pui'}
                              </td>
                              <td className="border border-gray-400 px-2 py-1 text-left pl-2">{dp.nguon_goc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 6. Phần III: Tài liệu đính kèm & Hiện trạng */}
                  <div className="mt-4 space-y-1">
                    <div className="font-bold uppercase text-[13px] border-b border-gray-400 pb-0.5">
                      III. NGUỒN GỐC & TÀI LIỆU MINH CHỨNG ĐÍNH KÈM:
                    </div>
                    <div className="pt-1 pl-2 space-y-1 text-[12.5px]">
                      <div>
                        - Nguồn gốc, hiện trạng sử dụng đất: <em>{ghiChu}</em>
                      </div>
                      <div>
                        - Giấy tờ kèm theo hồ sơ:
                        <span className="ml-1">
                          [x] Bản sao Căn cước công dân (trang trước) • [x] Bản trích lục tọa độ số hóa • {decl.anh_gcn ? '[x] Bản chụp Giấy chứng nhận QSDĐ' : '[ ] Chưa có GCN'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 7. Cam đoan */}
                  <div className="mt-3 text-[12.5px] italic text-justify leading-normal pl-2">
                    Tôi xin cam đoan toàn bộ nội dung kê khai các thửa đất trên đây là đúng thực tế, sử dụng đất ổn định, không có tranh chấp hay khiếu nại. Nếu có bất kỳ sự sai lệch nào, tôi xin chịu hoàn toàn trách nhiệm trước pháp luật.
                  </div>
                </div>

                {/* 8. Ký tên và xác nhận */}
                <div className="mt-4 pt-2">
                  <div className="text-right italic pr-6 mb-2 text-[12.5px]">
                    Cư Pui, {declDateStr}
                  </div>

                  <div className="grid grid-cols-2 text-center text-[13px]">
                    <div className="space-y-1">
                      <div className="font-bold uppercase">XÁC NHẬN CỦA UBND XÃ CƯ PUI</div>
                      <div className="text-[11.5px] italic text-gray-500">(Ký, ghi rõ họ tên và đóng dấu)</div>
                      <div className="h-20"></div>
                      <div className="font-bold text-gray-400 text-xs">UBND XÃ CƯ PUI</div>
                    </div>

                    <div className="space-y-1">
                      <div className="font-bold uppercase">NGƯỜI KÊ KHAI / CHỦ HỘ</div>
                      <div className="text-[11.5px] italic text-gray-500">(Ký và ghi rõ họ tên)</div>
                      <div className="h-20"></div>
                      <div className="font-bold uppercase text-gray-800">{nguoiKekhai}</div>
                    </div>
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
