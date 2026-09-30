'use client';

import React, { useState } from 'react';
import { Parcel, DeclarationFormData, AdditionalParcel } from '@/types';
import { Printer, X, FileText, Download, CheckCircle2, ShieldCheck, MapPin, Image as ImageIcon, Loader2 } from 'lucide-react';

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
  title = 'Tập Hồ Sơ Đăng Ký Đất Đai & CCCD / GCN',
}: DeclarationPrintModalProps) {
  const [isExportingLocalPdf, setIsExportingLocalPdf] = useState(false);

  if (!isOpen || items.length === 0) return null;

  const handlePrint = () => {
    window.print();
  };

  // Nút tải trực tiếp file PDF gốc chuẩn 100% template.pdf từ server local Python (port 5000)
  const handleDownloadLocalPdf = async () => {
    try {
      setIsExportingLocalPdf(true);
      const payloadItems = items.map((it) => {
        const p = it.parcel;
        const decl = it.declaration || {};
        const gcnList: string[] = [];
        if (decl.anh_gcn_list && decl.anh_gcn_list.length > 0) gcnList.push(...decl.anh_gcn_list);
        else if (decl.anh_gcn) gcnList.push(decl.anh_gcn);
        else if (p.gcn_urls) gcnList.push(...p.gcn_urls);

        return {
          ma_thua: p.ma_thua,
          to_ban_do: p.to_ban_do,
          so_thua: p.so_thua,
          dia_chi: decl.chu_dat_dia_chi || (p.thon_xa ? `${p.thon_xa}, xã Cư Pui` : 'Xã Cư Pui, huyện Krông Bông, tỉnh Đắk Lắk'),
          chu_ho: decl.chu_dat_ten || p.chu_ho,
          cccd: decl.chu_dat_cccd || p.cccd,
          loai_dat: p.loai_dat,
          dien_tich: p.dien_tich,
          nguon_goc: 'Khai hoang',
          has_gcn: gcnList.length > 0 || Boolean(p.has_gcn),
          anh_cccd_truoc: decl.anh_cccd_truoc || p.cccd_url,
          anh_gcn_list: gcnList,
        };
      });

      const resp = await fetch('http://localhost:5000/api/generate_pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payloadItems }),
      });

      if (!resp.ok) {
        throw new Error(`Máy chủ trả về mã lỗi: ${resp.status}`);
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tap_Ho_So_Chuan_Dong_Tap_${items.length}_bo.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(
        'Không thể kết nối đến máy chủ local PDF_Web_App (http://localhost:5000).\n\n' +
        '👉 Bạn hãy đảm bảo ứng dụng PDF_Web_App đang chạy tại cổng 5000 để tải file PDF gốc chuẩn 100% template.pdf.'
      );
    } finally {
      setIsExportingLocalPdf(false);
    }
  };

  const currentDate = new Date();
  const day = currentDate.getDate();
  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const getGcnLabel = (idx: number) => {
    const labels = [
      'MẶT TRƯỚC',
      'MẶT SAU',
      'MẶT TRƯỚC 1',
      'MẶT SAU 1',
      'MẶT TRƯỚC 2',
      'MẶT SAU 2',
      'MẶT TRƯỚC 3',
      'MẶT SAU 3',
    ];
    return labels[idx] || `TRANG ${idx + 1}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/80 backdrop-blur-md overflow-hidden">
      {/* Header bar (Ẩn khi In hoặc Xuất PDF) */}
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
              Trang 1: <strong>Chỉ ảnh CCCD mặt trước (không chữ)</strong> • 1 thửa: <strong>3 trang</strong> • Nhiều thửa: <strong>Trang 4 bảng 15b + Trang 5 trắng</strong> • Có GCN: <strong>Thay thế đơn bằng ảnh GCN</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Nút xuất PDF trực tiếp từ local PDF_Web_App (template.pdf gốc) */}
          <button
            onClick={handleDownloadLocalPdf}
            disabled={isExportingLocalPdf}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition transform active:scale-95 cursor-pointer disabled:opacity-50"
            title="Tải file PDF gốc 100% chuẩn template.pdf từ server local Python (PyMuPDF)"
          >
            {isExportingLocalPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>Tải PDF Chuẩn Local (template.pdf)</span>
          </button>

          {/* Nút In / Lưu PDF qua trình duyệt */}
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition transform active:scale-95 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>In Trình Duyệt</span>
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

          const isMultipleParcels = allDeclaredParcels.length > 1;

          // Format ngày kê khai
          let declDateStr = `ngày ${day} tháng ${month} năm ${year}`;
          if (decl.created_at) {
            try {
              const d = new Date(decl.created_at);
              declDateStr = `ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
            } catch {}
          }

          // Ảnh CCCD mặt trước
          const frontCccd = decl.anh_cccd_truoc || (p.cccd_url ? p.cccd_url : null);

          // Thu thập danh sách ảnh GCN và cờ GCN
          const gcnList: string[] = [];
          if (decl.anh_gcn_list && decl.anh_gcn_list.length > 0) {
            gcnList.push(...decl.anh_gcn_list);
          } else if (decl.anh_gcn) {
            gcnList.push(decl.anh_gcn);
          } else if (p.gcn_urls && p.gcn_urls.length > 0) {
            gcnList.push(...p.gcn_urls);
          }

          const hasGcn = gcnList.length > 0 || Boolean(p.has_gcn) || (p.trang_thai as string)?.includes('GCN');

          // Chuẩn bị 15 dòng cho bảng Mẫu 15b (khi nhiều thửa)
          const table15bRows = Array.from({ length: Math.max(15, allDeclaredParcels.length) }, (_, i) => {
            const dp = allDeclaredParcels[i];
            return {
              stt: i + 1,
              so_thua: dp ? dp.so_thua : '',
              to_ban_do: dp ? dp.to_ban_do : '',
              dia_chi: dp ? (dp.thon_xa ? `${dp.thon_xa}, Cư Pui` : 'Xã Cư Pui') : '',
              dien_tich: dp ? dp.dien_tich : '',
              loai_dat: dp ? dp.loai_dat : '',
              thoi_han: dp ? (dp.loai_dat?.includes('ONT') ? 'Lâu dài' : '50 năm') : '',
              nguon_goc: dp ? dp.nguon_goc : '',
            };
          });

          return (
            <React.Fragment key={p.ma_thua || index}>
              {/* ======================================================== */}
              {/* TRANG 1: CHỈ CẦN HÌNH ẢNH CCCD MẶT TRƯỚC, KHÔNG CÓ BẤT KỲ CHỮ NÀO KHÁC */}
              {/* ======================================================== */}
              <div
                className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] p-8 sm:p-12 shadow-2xl rounded-sm font-serif relative flex flex-col items-center justify-center"
                style={{ fontFamily: '"Times New Roman", Times, serif', pageBreakAfter: 'always' }}
              >
                {frontCccd ? (
                  <div className="w-full max-w-[480px] max-h-[320px] flex items-center justify-center">
                    <img
                      src={frontCccd}
                      alt=""
                      className="w-full h-auto object-contain max-h-[320px] rounded shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="border border-dashed border-gray-300 w-full max-w-[480px] h-[300px] rounded-xl flex items-center justify-center text-gray-300">
                    {/* Hoàn toàn không có chữ theo đúng yêu cầu người dùng */}
                  </div>
                )}
              </div>

              {/* ======================================================== */}
              {/* TRƯỜNG HỢP 1: CÓ GCN -> THAY THẾ ĐƠN KÊ KHAI BẰNG HÌNH ẢNH GCN */}
              {/* Thứ tự: CCCD -> GCN trước, GCN sau, GCN trước 1, GCN sau 1... */}
              {/* ======================================================== */}
              {hasGcn ? (
                <>
                  {gcnList.length > 0 ? (
                    gcnList.map((gcnUrl, gcnIdx) => {
                      const label = getGcnLabel(gcnIdx);
                      return (
                        <div
                          key={`gcn-${gcnIdx}`}
                          className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] p-6 sm:p-10 shadow-2xl rounded-sm font-serif relative flex flex-col items-center justify-center"
                          style={{ fontFamily: '"Times New Roman", Times, serif', pageBreakAfter: 'always' }}
                        >
                          <div className="w-full h-full flex flex-col items-center justify-center p-2">
                            <img
                              src={gcnUrl}
                              alt=""
                              className="w-full h-auto max-h-[720px] object-contain rounded shadow-sm"
                            />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    /* Được đánh dấu có GCN nhưng chưa tải file ảnh */
                    <div
                      className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] p-8 sm:p-12 shadow-2xl rounded-sm font-serif relative flex flex-col items-center justify-center"
                      style={{ fontFamily: '"Times New Roman", Times, serif', pageBreakAfter: 'always' }}
                    >
                      <div className="border border-dashed border-gray-300 w-full max-w-[500px] h-[700px] rounded-xl flex items-center justify-center text-gray-300">
                        {/* Khung dán bản sao GCN */}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* ======================================================== */
                /* TRƯỜNG HỢP 2: KHÔNG CÓ GCN */
                /* - Nếu 1 thửa: Chỉ xuất Trang 2 (Mẫu 15 p1) và Trang 3 (Mẫu 15 p2), KHÔNG CÓ TRANG 4 VÀ 5 */
                /* - Nếu nhiều thửa: Trang 2 (Mẫu 15 p1) + Trang 3 (Mẫu 15 p2) + Trang 4 (Mẫu 15b) + Trang 5 (TRẮNG TINH KHÔNG CHỮ) */
                /* ======================================================== */
                <>
                  {/* --- TRANG 2: MẪU SỐ 15 - TRANG 1 --- */}
                  <div
                    className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] p-8 sm:p-12 shadow-2xl rounded-sm font-serif text-[13px] leading-relaxed relative flex flex-col justify-between"
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
                        <div className="w-36 h-[1px] bg-black mx-auto mt-1 mb-2"></div>
                        <div className="text-[11px] italic text-gray-600">
                          Mẫu số 15. Đơn đăng ký đất đai, tài sản gắn liền với đất
                        </div>
                      </div>

                      {/* Tiêu đề đơn */}
                      <div className="text-center my-3 space-y-1">
                        <h1 className="text-[16px] font-bold uppercase tracking-tight">
                          ĐƠN ĐĂNG KÝ ĐẤT ĐAI, TÀI SẢN GẮN LIỀN VỚI ĐẤT
                        </h1>
                      </div>

                      {/* Kính gửi */}
                      <div className="my-2 pl-4 italic text-[13px]">
                        <strong>Kính gửi:</strong> UBND XÃ CƯ PUI
                      </div>

                      {/* 1. Người sử dụng đất */}
                      <div className="mt-3 space-y-1.5">
                        <div className="font-bold text-[13px]">
                          1. Người sử dụng đất, chủ sở hữu tài sản gắn liền với đất, người quản lý đất:
                        </div>
                        <p className="text-[11px] italic text-gray-600 pl-4 leading-normal">
                          (Trường hợp nhiều người cùng sử dụng đất, cùng sở hữu tài sản thì kê khai tên người cùng sử dụng)
                        </p>
                        <div className="pl-4 space-y-1 text-[13px]">
                          <div>
                            Tên (viết chữ in hoa): <strong className="uppercase text-[14px]">{chuHo}</strong>
                          </div>
                          <div>
                            Số định danh cá nhân / CCCD: <strong className="font-mono">{cccd}</strong>
                          </div>
                          <div>
                            Địa chỉ thường trú: <strong>{diaChi}</strong>
                          </div>
                          <div>
                            Số điện thoại liên hệ: <strong>{sdt}</strong>
                          </div>
                        </div>
                      </div>

                      {/* 2. Thửa đất đăng ký */}
                      <div className="mt-4 space-y-1.5">
                        <div className="font-bold text-[13px]">
                          2. Thửa đất đăng ký:
                        </div>
                        <div className="pl-4 space-y-1 text-[13px]">
                          <div>
                            a) Địa chỉ thửa đất: <strong>{diaChi}</strong>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              b) Thửa đất số:{' '}
                              <strong>
                                {allDeclaredParcels.length === 1
                                  ? p.so_thua
                                  : `${allDeclaredParcels.length.toString().padStart(2, '0')} thửa`}
                              </strong>
                            </div>
                            <div>
                              c) Tờ bản đồ số:{' '}
                              <strong>
                                {allDeclaredParcels.length === 1
                                  ? p.to_ban_do
                                  : Array.from(new Set(allDeclaredParcels.map((d) => d.to_ban_do))).join(', ')}
                              </strong>
                            </div>
                          </div>
                          <div>
                            d) Diện tích:{' '}
                            <strong>
                              {allDeclaredParcels.length === 1
                                ? p.dien_tich
                                : allDeclaredParcels
                                    .reduce((sum, d) => sum + (parseFloat(d.dien_tich?.replace(',', '.') || '0') || 0), 0)
                                    .toFixed(1)}
                            </strong>{' '}
                            m²
                          </div>
                          <div>
                            đ) Sử dụng vào mục đích:{' '}
                            <strong>
                              {allDeclaredParcels.length === 1
                                ? p.loai_dat
                                : Array.from(new Set(allDeclaredParcels.map((d) => d.loai_dat))).join(', ')}
                            </strong>
                          </div>
                          <div>
                            e) Thời hạn đề nghị được sử dụng đất:{' '}
                            <strong>
                              {allDeclaredParcels.some((d) => d.loai_dat?.includes('ONT')) ? 'Lâu dài' : '50 năm'}
                            </strong>
                          </div>
                          <div>
                            Nguồn gốc sử dụng đất: <strong>Khai hoang</strong>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Footer trang 1 */}
                    <div className="pt-3 border-t border-gray-300 flex justify-between items-center text-[11px] text-gray-600 italic">
                      <span>Mẫu số 15 ban hành kèm theo quy định quản lý đất đai • Xã Cư Pui</span>
                      <span className="font-bold not-italic">Trang 1 / Mẫu số 15</span>
                    </div>
                  </div>

                  {/* --- TRANG 3: MẪU SỐ 15 - TRANG 2 --- */}
                  <div
                    className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] p-8 sm:p-12 shadow-2xl rounded-sm font-serif text-[13px] leading-relaxed relative flex flex-col justify-between"
                    style={{ fontFamily: '"Times New Roman", Times, serif', pageBreakAfter: 'always' }}
                  >
                    <div>
                      {/* Tiêu đề phụ */}
                      <div className="text-right text-[11px] italic text-gray-500 pb-2">
                        Mẫu số 15 (tiếp theo)
                      </div>

                      <div className="space-y-4">
                        <div className="text-[13px]">
                          g) Có quyền hoặc hạn chế quyền đối với thửa đất liền kề: <em>Không có hạn chế quyền</em>
                        </div>

                        {/* 3. Nhà ở, công trình xây dựng */}
                        <div className="space-y-1">
                          <div className="font-bold text-[13px]">
                            3. Nhà ở, công trình xây dựng (người sử dụng đất là tổ chức thì không phải kê khai mục này):
                          </div>
                          <p className="text-[11px] italic text-gray-600 pl-4 leading-normal">
                            (Chỉ kê khai nếu có nhu cầu đăng ký hoặc chứng nhận quyền sở hữu tài sản)
                          </p>
                          <div className="pl-4 text-[13px] italic text-gray-700">
                            - Không có công trình xây dựng kiên cố đề nghị chứng nhận sở hữu riêng trên đất.
                          </div>
                        </div>

                        {/* 4. Rừng sản xuất là rừng trồng */}
                        <div className="space-y-1">
                          <div className="font-bold text-[13px]">
                            4. Rừng sản xuất là rừng trồng:
                          </div>
                          <div className="pl-4 text-[13px] italic text-gray-700">
                            - Không thuộc diện rừng sản xuất là rừng trồng.
                          </div>
                        </div>

                        {/* 5. Cây lâu năm */}
                        <div className="space-y-1">
                          <div className="font-bold text-[13px]">
                            5. Cây lâu năm:
                          </div>
                          <div className="pl-4 text-[13px] italic text-gray-700">
                            - Trồng cây nông nghiệp, cây lâu năm theo hiện trạng thực tế sản xuất tại địa phương.
                          </div>
                        </div>

                        {/* 6. Những giấy tờ nộp kèm theo đơn */}
                        <div className="space-y-1.5 pt-2">
                          <div className="font-bold text-[13px]">
                            6. Những giấy tờ nộp kèm theo đơn:
                          </div>
                          <div className="pl-4 space-y-1 text-[13px]">
                            <div className="flex items-center gap-2">
                              <span>[x]</span>
                              <span>01 Bản sao Căn cước công dân của chủ sử dụng đất (trang bìa trước)</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span>[x]</span>
                              <span>01 Bản trích lục sơ đồ tọa độ vị trí ranh giới thửa đất số hóa</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span>[ ]</span>
                              <span>Bản sao Giấy chứng nhận quyền sử dụng đất (chưa được cấp GCN)</span>
                            </div>
                          </div>
                        </div>

                        {/* 7. Đề nghị */}
                        <div className="space-y-1 pt-2">
                          <div className="font-bold text-[13px]">
                            7. Đề nghị khác:
                          </div>
                          <div className="pl-4 text-[13px] italic text-justify">
                            Đề nghị cơ quan chức năng có thẩm quyền kiểm tra hiện trạng, xác nhận đủ điều kiện và hoàn tất thủ tục đăng ký đất đai, cấp Giấy chứng nhận quyền sử dụng đất lần đầu theo đúng quy định.
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Footer trang 2 */}
                    <div className="pt-3 border-t border-gray-300 flex justify-between items-center text-[11px] text-gray-600 italic">
                      <span>Mẫu số 15 ban hành kèm theo quy định quản lý đất đai • Xã Cư Pui</span>
                      <span className="font-bold not-italic">Trang 2 / Mẫu số 15</span>
                    </div>
                  </div>

                  {/* NẾU LÀ NHIỀU THỬA (TỪ 2 THỬA TRỞ LÊN): XUẤT TRANG 4 (MẪU 15b) VÀ TRANG 5 (TRẮNG TINH) */}
                  {isMultipleParcels && (
                    <>
                      {/* --- TRANG 4: MẪU SỐ 15b (BẢNG 15 DÒNG CHUẨN TEMPLATE.PDF) --- */}
                      <div
                        className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] p-6 sm:p-10 shadow-2xl rounded-sm font-serif text-[12px] leading-tight relative flex flex-col justify-between"
                        style={{ fontFamily: '"Times New Roman", Times, serif', pageBreakAfter: 'always' }}
                      >
                        <div>
                          {/* Tiêu đề Mẫu 15b */}
                          <div className="text-center space-y-1 pb-2">
                            <div className="text-[11px] italic text-gray-600">
                              Mẫu số 15b. Danh sách các thửa đất của một hộ gia đình, cá nhân, cộng đồng dân cư
                            </div>
                            <h2 className="text-[13.5px] font-bold uppercase tracking-tight">
                              DANH SÁCH CÁC THỬA ĐẤT CỦA MỘT HỘ GIA ĐÌNH, CÁ NHÂN, CỘNG ĐỒNG DÂN CƯ
                            </h2>
                            <div className="text-[11.5px] italic text-gray-700">
                              (Kèm theo Mẫu số 15 • Chủ hộ: <strong className="uppercase">{chuHo}</strong>)
                            </div>
                          </div>

                          {/* Bảng danh sách chuẩn 15 dòng khớp 100% template.pdf */}
                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full text-center border-collapse border border-black text-[11px]">
                              <thead>
                                <tr className="bg-gray-100 font-bold">
                                  <th className="border border-black px-1 py-1.5 w-8">Số thứ tự</th>
                                  <th className="border border-black px-1.5 py-1.5 w-14">Thửa đất số</th>
                                  <th className="border border-black px-1.5 py-1.5 w-14">Tờ bản đồ số</th>
                                  <th className="border border-black px-2 py-1.5">Địa chỉ thửa đất</th>
                                  <th className="border border-black px-1.5 py-1.5 w-20">Diện tích (m²)</th>
                                  <th className="border border-black px-1.5 py-1.5 w-20">Sử dụng vào mục đích</th>
                                  <th className="border border-black px-2 py-1.5 w-24">Thời hạn đề nghị được SDĐ</th>
                                  <th className="border border-black px-2 py-1.5 w-24">Nguồn gốc sử dụng đất</th>
                                </tr>
                                <tr className="text-[10px] italic bg-gray-50 text-gray-600">
                                  <td className="border border-black py-0.5">(1)</td>
                                  <td className="border border-black py-0.5">(2)</td>
                                  <td className="border border-black py-0.5">(3)</td>
                                  <td className="border border-black py-0.5">(4)</td>
                                  <td className="border border-black py-0.5">(5)</td>
                                  <td className="border border-black py-0.5">(6)</td>
                                  <td className="border border-black py-0.5">(7)</td>
                                  <td className="border border-black py-0.5">(8)</td>
                                </tr>
                              </thead>
                              <tbody>
                                {table15bRows.map((row) => (
                                  <tr key={row.stt} className="h-7">
                                    <td className="border border-black px-1 py-1">{row.stt}</td>
                                    <td className="border border-black px-1.5 py-1 font-bold">{row.so_thua}</td>
                                    <td className="border border-black px-1.5 py-1 font-bold">{row.to_ban_do}</td>
                                    <td className="border border-black px-2 py-1 text-left">{row.dia_chi}</td>
                                    <td className="border border-black px-1.5 py-1 text-right pr-2 font-mono">
                                      {row.dien_tich}
                                    </td>
                                    <td className="border border-black px-1.5 py-1 font-mono">{row.loai_dat}</td>
                                    <td className="border border-black px-2 py-1">{row.thoi_han}</td>
                                    <td className="border border-black px-2 py-1 text-left">{row.nguon_goc}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Footer trang 4 */}
                        <div className="pt-3 border-t border-gray-300 flex justify-between items-center text-[11px] text-gray-600 italic">
                          <span>Mẫu số 15b • Danh sách các thửa đất đăng ký • Xã Cư Pui</span>
                          <span className="font-bold not-italic">Trang 4 / Mẫu số 15b</span>
                        </div>
                      </div>

                      {/* --- TRANG 5: TRANG TRỐNG HOÀN TOÀN KHÔNG CÓ CHỮ GÌ (THEO YÊU CẦU ĐỂ IN 2 MẶT) --- */}
                      <div
                        className="declaration-a4-sheet bg-white text-black w-full max-w-[210mm] min-h-[297mm] shadow-2xl rounded-sm"
                        style={{ pageBreakAfter: 'always' }}
                      >
                        {/* Trang 5 trắng tinh không có chữ gì */}
                      </div>
                    </>
                  )}
                </>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
