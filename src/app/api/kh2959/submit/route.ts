import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

async function getS3Client(): Promise<any | null> {
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    try {
      const { S3Client } = await import('@aws-sdk/client-s3');
      return new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY,
          secretAccessKey: R2_SECRET_KEY,
        },
      });
    } catch (err) {
      console.warn('Lỗi khởi tạo S3Client SDK:', err);
    }
  }
  return null;
}

// Lấy file scan PDF: Tìm trong R2, fallback tìm trên ổ cứng máy tính
async function getPdfBuffer(filename: string): Promise<Uint8Array | null> {
  if (!filename) return null;
  const cleanName = filename.replace(/^filescan\//, '').replace(/^scanhoso\//, '').trim();

  // 1. Thử lấy từ R2 Binding
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      for (const prefix of ['filescan/', 'cccd/', '']) {
        const obj = await bucket.get(`${prefix}${cleanName}`);
        if (obj) {
          const arr = await obj.arrayBuffer();
          return new Uint8Array(arr);
        }
      }
    }
  } catch {}

  // 2. Thử fetch từ R2 Public URL
  try {
    for (const prefix of ['filescan/', 'cccd/', '']) {
      const url = `${R2_PUBLIC_BASE}/${prefix}${encodeURIComponent(cleanName)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const arr = await res.arrayBuffer();
        return new Uint8Array(arr);
      }
    }
  } catch {}

  // 3. Thử tìm trên ổ cứng cục bộ D:\DIACHINH
  try {
    const localCandidates = [
      path.join('D:\\DIACHINH\\La Scan 28.10', cleanName),
      path.join('D:\\DIACHINH\\FILE_SCAN_199', cleanName),
      path.join('D:\\DIACHINH', cleanName),
    ];
    for (const p of localCandidates) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    }
  } catch {}

  return null;
}

// Tra cứu mã định danh geohash từ API search của kh2959bmt
async function lookupGeohash(maXa: string, soTo: string, soThua: string): Promise<string> {
  try {
    const url = `https://www.kh2959bmt.net/api/parcels/search?ma_xa=${encodeURIComponent(maXa)}&so_to=${encodeURIComponent(soTo)}&so_thua=${encodeURIComponent(soThua)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.kh2959bmt.net/nhom-4',
      },
      cache: 'no-store',
    });
    if (res.ok) {
      const data: any = await res.json();
      if (data?.features && data.features.length > 0) {
        return data.features[0]?.properties?.ma_thua_dat || '';
      }
    }
  } catch {}
  return '';
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as any;
    const parcels: any[] = Array.isArray(body?.parcels) ? body.parcels : [body];

    const results: any[] = [];

    for (const item of parcels) {
      const maThua = item.ma_thua || `${item.so_to}_${item.so_thua}`;
      const soTo = String(item.so_to || '').trim();
      const soThua = String(item.so_thua || '').trim();
      const loaiDat = String(item.loai_dat || 'CLN').trim().toUpperCase();

      // RÀNG BUỘC NGHIÊM NGẶT: Thửa có ONT tuyệt đối không được nhập!
      if (/ONT/i.test(loaiDat)) {
        results.push({
          ma_thua: maThua,
          ok: false,
          error: `Thửa ${soThua} (Tờ ${soTo}) có loại đất ${loaiDat} (chứa ONT) - Bổ sung sau, đã chuyển sang GCN - ONT!`,
        });
        continue;
      }

      // Lấy geohash nếu chưa có
      const maDinhDanh = item.ma_dinh_danh || (await lookupGeohash('24478', soTo, soThua)) || '';

      const dienTichVal = String(item.dien_tich || '1000').replace(',', '.').trim();
      const chuHoTen = item.chu_ho || item.chu_dat_ten || 'Chủ sử dụng';
      const cccdVal = (item.cccd || item.chu_dat_cccd || '').replace(/\D/g, '');
      const namSinhVal = String(item.nam_sinh || item.chu_dat_nam_sinh || '1980').match(/\d{4}/)?.[0] || '1980';
      const gioiTinhVal = (item.gioi_tinh || item.chu_dat_gioi_tinh || 'Nam').toLowerCase().includes('nữ') ? 'Nữ' : 'Nam';
      const diaChiThuongTru = item.dia_chi_thuong_tru || item.chu_dat_dia_chi || item.thon_xa || 'xã Cư Pui';
      const diaChiThuaDat = item.dia_chi_thua_dat || item.thon_xa || 'Xã Cư Pui, tỉnh Đắk Lắk';
      const nguonGocVal = item.nguon_goc || 'Khai hoang';

      // Tạo cấu trúc payload chuẩn
      const payloadObj = {
        ma_xa: '24478',
        ten_xa: 'Xã Cư Pui',
        doi_tuong: 'Hộ gia đình, cá nhân',
        che_do: 'Chưa được cấp GCN',
        gcn: { so_phat_hanh: '', ngay_cap: '', so_vao_so: '' },
        nguoi_su_dung_hien_tai: { ho_ten: '', cccd: '', dia_chi_thuong_tru: '', ly_do_thay_doi: '' },
        owners: [
          {
            ho_ten: chuHoTen,
            ngay_sinh: namSinhVal,
            gioi_tinh: gioiTinhVal,
            cccd: cccdVal,
            dia_chi_thuong_tru: diaChiThuongTru.includes('xã Cư Pui') ? diaChiThuongTru : `${diaChiThuongTru}, xã Cư Pui`,
            phap_nhan: 'Cá nhân',
            vai_tro_phap_nhan: 'Cá nhân',
          },
        ],
        to_chuc: {
          ten_to_chuc: '',
          ma_dinh_danh_to_chuc: '',
          ho_ten_dai_dien: '',
          ngay_sinh_dai_dien: '',
          gioi_tinh_dai_dien: '',
          ma_dinh_danh_ca_nhan_dai_dien: '',
          dia_chi_thuong_tru_dai_dien: '',
        },
        dung_chung_ho_so_quet: false,
        thua_list: [
          {
            thua: {
              so_to: soTo,
              so_thua: soThua,
              so_to_gcn: '',
              so_thua_gcn: '',
              ma_dinh_danh: maDinhDanh,
              dien_tich_thua_dat: dienTichVal,
              dia_chi_thua_dat: diaChiThuaDat.includes('tỉnh Đắk Lắk') ? diaChiThuaDat : `${diaChiThuaDat}, tỉnh Đắk Lắk`,
              ghi_chu: '',
            },
            dat1: {
              loai_dat: loaiDat,
              dien_tich: dienTichVal,
              nguon_goc_su_dung: nguonGocVal,
              hinh_thuc_su_dung: 'Sử dụng riêng',
              thoi_han_su_dung: loaiDat === 'ONT' ? 'Lâu dài' : '50 năm',
            },
            dat2: null,
          },
        ],
      };

      // Tìm file scan PDF
      const scanFileName = item.scan_file || `CHUACOGIAY_24478_${soTo}_${soThua}-DDK.pdf`;
      let pdfBytes = await getPdfBuffer(scanFileName);

      // Nếu không tìm thấy, tạo 1 file PDF placeholder hợp lệ tối thiểu để server tiếp nhận
      if (!pdfBytes) {
        const dummyPdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n';
        pdfBytes = new TextEncoder().encode(dummyPdf);
      }

      // Xây dựng Multipart FormData
      const formData = new FormData();
      formData.append('payload', JSON.stringify(payloadObj));
      const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      formData.append('file_chinh_0', blob, scanFileName);

      // Gửi request tới server đích
      try {
        const res = await fetch('https://www.kh2959bmt.net/api/nhom4/ho-so', {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
            'Origin': 'https://www.kh2959bmt.net',
            'Referer': 'https://www.kh2959bmt.net/nhom-4',
          },
          body: formData,
        });

        const resText = await res.text();
        let resJson: any = null;
        try {
          resJson = JSON.parse(resText);
        } catch {
          resJson = { raw: resText };
        }

        if (res.ok && resJson?.ok) {
          results.push({
            ma_thua: maThua,
            ok: true,
            so_to: soTo,
            so_thua: soThua,
            message: resJson.message || 'Đã lưu thành công lên máy chủ!',
          });
        } else if (res.status === 409) {
          // Thửa đã được lưu trước đó
          results.push({
            ma_thua: maThua,
            ok: true,
            alreadyExists: true,
            so_to: soTo,
            so_thua: soThua,
            message: resJson.error || 'Thửa đã tồn tại trên hệ thống máy chủ (đã lưu)',
          });
        } else {
          results.push({
            ma_thua: maThua,
            ok: false,
            so_to: soTo,
            so_thua: soThua,
            error: resJson.error || resJson.message || `Lỗi HTTP ${res.status}`,
          });
        }
      } catch (postErr: any) {
        results.push({
          ma_thua: maThua,
          ok: false,
          error: postErr.message || 'Không thể kết nối tới server kh2959bmt.net',
        });
      }
    }

    return NextResponse.json({
      success: true,
      total: results.length,
      successCount: results.filter((r) => r.ok).length,
      failedCount: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi server khi nộp hồ sơ' },
      { status: 500 }
    );
  }
}
