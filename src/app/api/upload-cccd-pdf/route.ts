import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { PDFDocument } from 'pdf-lib';
import { cleanCccd, cleanName } from '@/utils/textHelpers';

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

// Chuyển chuỗi base64 thành Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
  const binaryString = atob(clean);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as any;
    const { frontBase64, backBase64, imageBase64, so_cccd, ho_va_ten, ma_thua, skipSync } = body;
    const imgPrimary = imageBase64 || frontBase64;

    if (!imgPrimary && !backBase64) {
      return NextResponse.json({ success: false, error: 'Vui lòng cung cấp ít nhất một ảnh CCCD' }, { status: 400 });
    }

    const cccdClean = cleanCccd(so_cccd);
    const nameClean = cleanName(ho_va_ten);
    const customFileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';

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

    console.log(`>>> Đang tạo file PDF khổ A4: ${fileName}`);

    // Tạo PDF chuẩn A4 (595.28 pt x 841.89 pt = 210mm x 297mm)
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    const embedImage = async (b64: string) => {
      const bytes = base64ToUint8Array(b64);
      const isPng = b64.startsWith('data:image/png');
      try {
        return isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      } catch {
        // Thử ngược lại nếu sai định dạng
        return isPng ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
      }
    };

    if (frontBase64 && backBase64) {
      // 2 mặt: Canh chỉnh chuẩn bản photocopy A4 (Mặt trước ở nửa trên, Mặt sau ở nửa dưới)
      const imgFront = await embedImage(frontBase64);
      const imgBack = await embedImage(backBase64);

      const maxBoxW = pageWidth - 80; // 515.28 pt
      const maxBoxH = (pageHeight - 120) / 2; // ~360 pt

      // Nửa trên (Mặt trước)
      const scaleFront = imgFront.scaleToFit(maxBoxW, maxBoxH);
      const xFront = (pageWidth - scaleFront.width) / 2;
      const yFront = pageHeight - 60 - maxBoxH + (maxBoxH - scaleFront.height) / 2;
      page.drawImage(imgFront, {
        x: xFront,
        y: yFront,
        width: scaleFront.width,
        height: scaleFront.height,
      });

      // Nửa dưới (Mặt sau)
      const scaleBack = imgBack.scaleToFit(maxBoxW, maxBoxH);
      const xBack = (pageWidth - scaleBack.width) / 2;
      const yBack = 60 + (maxBoxH - scaleBack.height) / 2;
      page.drawImage(imgBack, {
        x: xBack,
        y: yBack,
        width: scaleBack.width,
        height: scaleBack.height,
      });
    } else {
      // 1 ảnh (Mặt trước hoặc ảnh chụp gộp): Canh giữa trang A4
      const singleB64 = frontBase64 || backBase64 || imgPrimary;
      const img = await embedImage(singleB64);
      const maxBoxW = pageWidth - 80;
      const maxBoxH = pageHeight - 120;
      const scale = img.scaleToFit(maxBoxW, maxBoxH);

      const x = (pageWidth - scale.width) / 2;
      const y = (pageHeight - scale.height) / 2;
      page.drawImage(img, {
        x,
        y,
        width: scale.width,
        height: scale.height,
      });
    }

    const pdfBytes = await pdfDoc.save();
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

    const r2PublicUrl = `https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev/${r2Key}`;

    // Cập nhật thông tin phiếu kê khai nếu có liên kết thửa hoặc trùng số CCCD
    let updatedDeclarations: Record<string, any> = {};
    if (bucket) {
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

    // Tự động kích hoạt đồng bộ sang Google Sheet Realtime tức thì (nếu không bật cờ skipSync của tải hàng loạt)
    if (bucket && !skipSync && Object.keys(updatedDeclarations).length > 0) {
      import('@/utils/syncGoogleSheets')
        .then(({ executeSyncToGoogleSheet }) => {
          executeSyncToGoogleSheet(updatedDeclarations, bucket).catch((err) =>
            console.error('Lỗi sync Google Sheet sau khi upload CCCD:', err)
          );
        })
        .catch((err) => console.warn('Lỗi nạp module syncGoogleSheets:', err));
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
