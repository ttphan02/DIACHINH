import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { PDFDocument } from 'pdf-lib';
import { cleanCccd, cleanName } from '@/utils/textHelpers';
import { decodeCccd12 } from '@/utils/cccdOcrHelpers';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';

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

// Chuyển chuỗi base64 thành Uint8Array an toàn tuyệt đối
function base64ToUint8Array(base64: string): Uint8Array {
  const commaIdx = base64.indexOf(',');
  const clean = (commaIdx !== -1 ? base64.slice(commaIdx + 1) : base64).replace(/\s/g, '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(clean, 'base64');
  }
  const binaryString = atob(clean);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let frontBase64: any = null;
    let backBase64: any = null;
    let imageBase64: any = null;
    let so_cccd = '';
    let ho_va_ten = '';
    let nam_sinh = '';
    let gioi_tinh = '';
    let ma_thua = '';
    let skipSync = false;
    let customFileName = '';
    let prebuiltPdfBytes: Uint8Array | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const pdfEntry = formData.get('pdfFile');
      if (pdfEntry && typeof (pdfEntry as any).arrayBuffer === 'function') {
        prebuiltPdfBytes = new Uint8Array(await (pdfEntry as Blob).arrayBuffer());
      }
      so_cccd = String(formData.get('so_cccd') || '');
      ho_va_ten = String(formData.get('ho_va_ten') || '');
      nam_sinh = String(formData.get('nam_sinh') || '');
      gioi_tinh = String(formData.get('gioi_tinh') || '');
      ma_thua = String(formData.get('ma_thua') || '');
      customFileName = String(formData.get('fileName') || '').trim();
      skipSync = String(formData.get('skipSync') || '') === 'true';
    } else {
      const body = (await request.json()) as any;
      frontBase64 = body.frontBase64;
      backBase64 = body.backBase64;
      imageBase64 = body.imageBase64;
      so_cccd = body.so_cccd || '';
      ho_va_ten = body.ho_va_ten || '';
      nam_sinh = body.nam_sinh || '';
      gioi_tinh = body.gioi_tinh || '';
      ma_thua = body.ma_thua || '';
      skipSync = Boolean(body.skipSync);
      customFileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    }

    const imgPrimary = imageBase64 || frontBase64;

    if (!prebuiltPdfBytes && !imgPrimary && !backBase64) {
      return NextResponse.json({ success: false, error: 'Vui lòng cung cấp ít nhất một ảnh CCCD hoặc file PDF' }, { status: 400 });
    }

    const cccdClean = cleanCccd(so_cccd);
    const nameClean = cleanName(ho_va_ten);

    if (!cccdClean && !nameClean && !ma_thua && !customFileName) {
      return NextResponse.json({ success: false, error: 'Thiếu số CCCD, họ tên hoặc mã thửa để đặt tên file' }, { status: 400 });
    }

    // Đặt tên file chuẩn: ví dụ 020064002073_Phan Thanh Truc.pdf hoặc 13245_Phan Thanh Truc.pdf
    let fileName = '';
    if (customFileName) {
      fileName = customFileName.endsWith('.pdf') ? customFileName : `${customFileName}.pdf`;
    } else if (cccdClean && nameClean) {
      fileName = `${cccdClean}_${nameClean}.pdf`;
    } else if (cccdClean) {
      fileName = `${cccdClean}.pdf`;
    } else if (ma_thua && nameClean) {
      fileName = `${ma_thua}_${nameClean}.pdf`;
    } else if (nameClean) {
      fileName = `${nameClean}.pdf`;
    } else {
      fileName = `${ma_thua || 'CCCD'}_${Date.now()}.pdf`;
    }

    let pdfBytes: Uint8Array;
    if (prebuiltPdfBytes && prebuiltPdfBytes.byteLength > 0) {
      pdfBytes = prebuiltPdfBytes;
    } else {
      // Fallback: Tạo PDF chuẩn A4 trên server nếu client cũ gửi JSON base64
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]);
      const { width: pageWidth, height: pageHeight } = page.getSize();

      const embedImage = async (b64: string) => {
        const bytes = base64ToUint8Array(b64);
        const isPng = b64.toLowerCase().startsWith('data:image/png');
        try {
          return isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        } catch {
          try {
            return isPng ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
          } catch {
            throw new Error('Định dạng ảnh không được hỗ trợ (cần JPG/PNG) hoặc dữ liệu ảnh bị hỏng.');
          }
        }
      };

      if (frontBase64 && backBase64) {
        const imgFront = await embedImage(frontBase64);
        const imgBack = await embedImage(backBase64);

        const maxBoxW = pageWidth - 80;
        const maxBoxH = (pageHeight - 120) / 2;

        const scaleFront = imgFront.scaleToFit(maxBoxW, maxBoxH);
        page.drawImage(imgFront, {
          x: (pageWidth - scaleFront.width) / 2,
          y: pageHeight - 60 - maxBoxH + (maxBoxH - scaleFront.height) / 2,
          width: scaleFront.width,
          height: scaleFront.height,
        });

        const scaleBack = imgBack.scaleToFit(maxBoxW, maxBoxH);
        page.drawImage(imgBack, {
          x: (pageWidth - scaleBack.width) / 2,
          y: 60 + (maxBoxH - scaleBack.height) / 2,
          width: scaleBack.width,
          height: scaleBack.height,
        });
      } else {
        const singleB64 = frontBase64 || backBase64 || imgPrimary;
        const img = await embedImage(singleB64);
        const maxBoxW = pageWidth - 80;
        const maxBoxH = pageHeight - 120;
        const scale = img.scaleToFit(maxBoxW, maxBoxH);

        page.drawImage(img, {
          x: (pageWidth - scale.width) / 2,
          y: (pageHeight - scale.height) / 2,
          width: scale.width,
          height: scale.height,
        });
      }

      pdfBytes = await pdfDoc.save();
    }
    console.log(`>>> PDF tạo thành công (${pdfBytes.length} bytes). Đang lưu vào Cloudflare R2...`);

    // Lưu vào R2 bucket: cccd/{fileName}
    const bucket = await getR2Binding();
    const r2Key = `cccd/${fileName}`;

    if (bucket) {
      // NGUYÊN TẮC: Nếu số CCCD đã có trong R2 rồi thì lấy cái hiện tại thay thế cái đã có trong R2 đó luôn!
      if (cccdClean && cccdClean.length >= 9) {
        try {
          // List các file trong cccd/ để tìm bất kỳ file cũ nào mang số CCCD này
          const listRes: any = await bucket.list({ prefix: `cccd/${cccdClean}`, limit: 10 });
          for (const obj of listRes?.objects || []) {
            const key = obj.key;
            if (key !== r2Key) {
              console.log(`>>> Thay thế CCCD cũ trong R2: Xóa file cũ ${key} để cập nhật file mới ${r2Key}`);
              await bucket.delete(key);
            }
          }
        } catch (err) {
          console.warn('Lỗi khi rà soát và xóa file CCCD cũ trên R2:', err);
        }
      }

      await bucket.put(r2Key, pdfBytes, {
        httpMetadata: {
          contentType: 'application/pdf',
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
    } else {
      const s3 = await getS3Client();
      if (s3) {
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
        await s3.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: pdfBytes,
            ContentType: 'application/pdf',
            CacheControl: 'public, max-age=31536000, immutable',
          })
        );
      }
    }

    const r2PublicUrl = `/api/image/${encodeURI(r2Key)}`;

    // Xác định Năm sinh & Giới tính (từ tham số gửi lên hoặc tự động giải mã từ 12 số CCCD)
    let finalNamSinh = nam_sinh ? String(nam_sinh).trim() : '';
    let finalGioiTinh = gioi_tinh
      ? (String(gioi_tinh).toLowerCase().includes('nữ') || String(gioi_tinh).toLowerCase().includes('nu') ? 'Nữ' : 'Nam')
      : '';

    if (cccdClean && (!finalNamSinh || !finalGioiTinh)) {
      const decoded = decodeCccd12(cccdClean);
      if (!finalNamSinh && decoded.nam_sinh) finalNamSinh = decoded.nam_sinh;
      if (!finalGioiTinh && decoded.gioi_tinh) finalGioiTinh = decoded.gioi_tinh;
    }

    // Cập nhật thông tin phiếu kê khai nếu có liên kết thửa hoặc trùng số CCCD
    let updatedDeclarations: Record<string, any> = {};
    if (!skipSync && bucket) {
      try {
        const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
        if (declObj) {
          const payload = JSON.parse(await declObj.text());
          const map = payload.declarationsMap || {};
          let changed = false;

          for (const [code, decl] of Object.entries(map as Record<string, any>)) {
            const curCccd = cleanCccd(decl.cccd || decl.chu_dat_cccd || decl.cccd_chu_ho);
            if (
              (cccdClean && curCccd === cccdClean) ||
              (ma_thua && code === ma_thua)
            ) {
              if (cccdClean) {
                decl.cccd = cccdClean;
                decl.cccd_chu_ho = cccdClean;
                decl.chu_dat_cccd = cccdClean;
              }
              if (nameClean) {
                decl.chu_ho = nameClean;
                decl.chu_dat_ten = nameClean;
              }
              if (finalNamSinh) {
                decl.chu_dat_nam_sinh = finalNamSinh;
                decl.nam_sinh_chu_ho = finalNamSinh;
              }
              if (finalGioiTinh) {
                decl.chu_dat_gioi_tinh = finalGioiTinh;
                decl.gioi_tinh_chu_ho = finalGioiTinh;
              }
              decl.anh_cccd_pdf = r2PublicUrl;
              changed = true;
            }
          }

          if (changed) {
            payload.updatedAt = new Date().toISOString();
            await bucket.put(KEY_ALL_DECLARATIONS, JSON.stringify(payload), {
              httpMetadata: { contentType: 'application/json' },
            });
          }
          updatedDeclarations = map;
        }
      } catch (e) {
        console.warn('Lỗi cập nhật declarations sau upload CCCD:', e);
      }
    }



    return NextResponse.json({
      success: true,
      fileName,
      r2Key,
      r2Url: r2PublicUrl,
      message: 'Đã tạo PDF A4, lưu vào R2 và kích hoạt đồng bộ Google Sheet thành công!',
    });
  } catch (error: any) {
    console.error('Lỗi POST /api/upload-cccd-pdf:', error);
    return NextResponse.json({ success: false, error: error.message || 'Lỗi xử lý file' }, { status: 500 });
  }
}
