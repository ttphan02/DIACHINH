import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { executeSyncToGoogleSheet, cleanCccd, cleanName } from '@/utils/syncGoogleSheets';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
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

function getS3Client(): S3Client | null {
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    });
  }
  return null;
}

async function deleteObjectFromR2(key: string) {
  const bucket = await getR2Binding();
  if (bucket) {
    await bucket.delete(key);
    return true;
  }
  const s3 = getS3Client();
  if (s3) {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    return true;
  }
  return false;
}

// GET /api/cccd - Lấy danh sách toàn bộ file CCCD trên R2 kèm thông tin liên kết thửa (hoặc kiểm tra 1 số CCCD cụ thể)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const checkParam = searchParams.get('check') || searchParams.get('cccd');

    // 1. Kiểm tra nhanh 1 số CCCD cụ thể có file PDF trên R2 hoặc có trên hệ thống hay chưa
    if (checkParam) {
      const clean = cleanCccd(checkParam);
      if (!clean) {
        return NextResponse.json({ exists: false });
      }

      const bucket = await getR2Binding();
      const s3 = getS3Client();
      const targetKey = `cccd/${clean}.pdf`;
      let found = false;
      let matchedKey = targetKey;

      if (bucket) {
        try {
          const obj = await bucket.head(targetKey);
          if (obj) found = true;
        } catch {}

        if (!found) {
          try {
            const listRes: any = await bucket.list({ prefix: `cccd/${clean}`, limit: 5 });
            if (listRes?.objects && listRes.objects.length > 0) {
              found = true;
              matchedKey = listRes.objects[0].key;
            }
          } catch {}
        }
      }

      if (!found && s3) {
        try {
          await s3.send(
            new HeadObjectCommand({
              Bucket: R2_BUCKET,
              Key: targetKey,
            })
          );
          found = true;
        } catch {}

        if (!found) {
          try {
            const listRes = await s3.send(
              new ListObjectsV2Command({
                Bucket: R2_BUCKET,
                Prefix: `cccd/${clean}`,
                MaxKeys: 5,
              })
            );
            if (listRes.Contents && listRes.Contents.length > 0) {
              found = true;
              matchedKey = listRes.Contents[0].Key || targetKey;
            }
          } catch {}
        }
      }

      if (found) {
        const filename = matchedKey.replace(/^cccd\//, '');
        return NextResponse.json({
          exists: true,
          inR2: true,
          filename,
          url: `/api/image/cccd/${encodeURIComponent(filename)}`,
          message: 'Đã có cccd trên hệ thống!',
        });
      }

      // Kiểm tra xem số CCCD đã có trên Google Sheets chính hay chưa
      try {
        const { fetchOrGetCachedGgsData } = await import('@/utils/ggsData');
        const ggs = await fetchOrGetCachedGgsData();
        if (ggs && Array.isArray(ggs.allCccds) && ggs.allCccds.includes(clean)) {
          return NextResponse.json({
            exists: true,
            inR2: false,
            inGgs: true,
            message: 'Đã có cccd trên hệ thống!',
          });
        }
      } catch {}

      return NextResponse.json({ exists: false });
    }

    // 2. Lấy danh sách tóm tắt tất cả các số CCCD đã có file PDF trên R2
    if (searchParams.get('list_only')) {
      const bucket = await getR2Binding();
      const s3 = getS3Client();
      let objects: Array<{ key: string }> = [];

      if (bucket) {
        try {
          const listRes: any = await bucket.list({ prefix: 'cccd/', limit: 1000 });
          objects = listRes.objects || [];
        } catch {}
      }
      if (objects.length === 0 && s3) {
        try {
          const res = await s3.send(
            new ListObjectsV2Command({
              Bucket: R2_BUCKET,
              Prefix: 'cccd/',
              MaxKeys: 1000,
            })
          );
          objects = (res.Contents || []).map((c) => ({ key: c.Key || '' }));
        } catch {}
      }

      const cccdNumbers = objects
        .map((o) => o.key.replace(/^cccd\//, '').replace(/\.pdf$/i, '').trim())
        .filter((c) => cleanCccd(c).length === 12);

      return NextResponse.json({
        success: true,
        count: cccdNumbers.length,
        cccdList: cccdNumbers,
      });
    }

    const bucket = await getR2Binding();
    const s3 = getS3Client();

    let objects: Array<{ key: string; size: number; uploaded?: string | Date | null }> = [];

    if (bucket) {
      try {
        const listRes: any = await bucket.list({ prefix: 'cccd/', limit: 1000 });
        objects = listRes.objects || [];
      } catch (err) {
        console.warn('Lỗi list CCCD qua R2 binding:', err);
      }
    }

    // Fallback qua S3 SDK nếu bucket binding không có hoặc lỗi
    if (objects.length === 0 && s3) {
      try {
        const cmd = new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: 'cccd/',
          MaxKeys: 1000,
        });
        const res = await s3.send(cmd);
        objects = (res.Contents || []).map((c) => ({
          key: c.Key || '',
          size: c.Size || 0,
          uploaded: c.LastModified || null,
        }));
      } catch (err) {
        console.warn('Lỗi list CCCD qua S3 SDK:', err);
      }
    }

    // Đọc declarations để tìm liên kết
    let declarationsMap: Record<string, any> = {};
    if (bucket) {
      try {
        const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
        if (declObj) {
          const payload = JSON.parse(await declObj.text());
          declarationsMap = payload.declarationsMap || {};
        }
      } catch (e) {
        console.warn('Lỗi đọc declarationsMap qua bucket:', e);
      }
    }
    if (Object.keys(declarationsMap).length === 0) {
      try {
        const res = await fetch(`${R2_PUBLIC_BASE}/${KEY_ALL_DECLARATIONS}?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const payload: any = await res.json();
          declarationsMap = payload.declarationsMap || {};
        }
      } catch (e) {
        console.warn('Lỗi fetch declarationsMap qua public URL:', e);
      }
    }

    // Lập bản đồ tra cứu từ cccd/ma_thua -> declaration
    const cccdToDecl = new Map<string, { maThua: string; chuHo: string }>();
    for (const [maThua, decl] of Object.entries(declarationsMap)) {
      const c1 = cleanCccd(decl.cccd_chu_ho || decl.cccd || decl.chu_dat_cccd);
      const name = cleanName(decl.ho_va_ten_chu_ho || decl.chu_ho || decl.chu_dat_ten);
      if (c1) {
        cccdToDecl.set(c1, { maThua, chuHo: name });
      }
    }

    const files = objects
      .map((obj: any) => {
        const fullKey = obj.key;
        const filename = fullKey.replace(/^cccd\//, '');
        if (!filename) return null;

        // Trích xuất số CCCD và Tên từ tên file: e.g. "020064002073_Phan Thanh Truc.pdf"
        const nameNoExt = filename.replace(/\.[^/.]+$/, '');
        const parts = nameNoExt.split('_');
        const cccdCandidate = cleanCccd(parts[0]);
        const nameCandidate = parts.slice(1).join(' ').trim();

        // Kiểm tra xem có khớp với thửa đất nào không
        let matchedParcel = '';
        let matchedOwner = nameCandidate;

        if (cccdCandidate && cccdToDecl.has(cccdCandidate)) {
          const match = cccdToDecl.get(cccdCandidate)!;
          matchedParcel = match.maThua;
          if (!matchedOwner && match.chuHo) matchedOwner = match.chuHo;
        } else {
          // Thử tìm theo mã thửa trong tên file
          for (const maThua of Object.keys(declarationsMap)) {
            if (nameNoExt.includes(maThua)) {
              matchedParcel = maThua;
              matchedOwner = declarationsMap[maThua]?.chu_ho || matchedOwner;
              break;
            }
          }
        }

        return {
          key: fullKey,
          filename,
          size: obj.size,
          uploadedAt: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
          url: `/api/image/${encodeURI(fullKey)}`,
          cccdNumber: cccdCandidate || '',
          ownerName: matchedOwner || '',
          matchedParcelCode: matchedParcel || '',
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const tA = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
        const tB = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        return tB - tA; // Mới nhất lên đầu
      });

    return NextResponse.json({
      success: true,
      total: files.length,
      files,
    });
  } catch (error: any) {
    console.error('Lỗi GET /api/cccd:', error);
    return NextResponse.json({
      success: true,
      total: 0,
      files: [],
      warning: error.message || 'Lỗi server',
    });
  }
}

// DELETE /api/cccd - Xóa file CCCD khỏi R2 và hủy liên kết khỏi thửa đất, sau đó tự động sync Google Sheet
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let filename = searchParams.get('file');

    if (!filename) {
      try {
        const body: any = await request.json();
        filename = body.filename || body.file;
      } catch {
        // không có body
      }
    }

    if (!filename) {
      return NextResponse.json({ success: false, error: 'Vui lòng cung cấp tên file cần xóa' }, { status: 400 });
    }

    const cleanFn = filename.replace(/^cccd\//, '');
    const r2Key = `cccd/${cleanFn}`;

    console.log(`>>> Đang xóa file CCCD: ${r2Key}`);
    await deleteObjectFromR2(r2Key);

    // Cập nhật declarations: hủy liên kết nếu có
    const bucket = await getR2Binding();
    const s3 = getS3Client();
    let updatedDeclarations: Record<string, any> = {};

    try {
      let payload: any = null;
      if (bucket) {
        const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
        if (declObj) payload = JSON.parse(await declObj.text());
      } else {
        const res = await fetch(`${R2_PUBLIC_BASE}/${KEY_ALL_DECLARATIONS}?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (res.ok) payload = await res.json();
      }

      if (payload) {
        const map = payload.declarationsMap || {};
        let changed = false;

        for (const [code, decl] of Object.entries(map as Record<string, any>)) {
          const cClean = cleanCccd(decl.cccd_chu_ho || decl.cccd);
          if (cleanFn.includes(code) || (cClean && cleanFn.includes(cClean)) || decl.anh_cccd_pdf?.includes(cleanFn)) {
            // Hủy liên kết file CCCD
            decl.anh_cccd_pdf = '';
            changed = true;
          }
        }

        if (changed) {
          payload.updatedAt = new Date().toISOString();
          const jsonStr = JSON.stringify(payload, null, 2);
          if (bucket) {
            await bucket.put(KEY_ALL_DECLARATIONS, jsonStr, {
              httpMetadata: { contentType: 'application/json' },
            });
          } else if (s3) {
            await s3.send(
              new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: KEY_ALL_DECLARATIONS,
                Body: Buffer.from(jsonStr, 'utf8'),
                ContentType: 'application/json',
              })
            );
          }
        }
        updatedDeclarations = map;
      }
    } catch (e) {
      console.warn('Lỗi cập nhật declarations khi xóa CCCD:', e);
    }

    // Tự động kích hoạt đồng bộ Google Sheet
    executeSyncToGoogleSheet(updatedDeclarations, bucket).catch((err) =>
      console.error('Lỗi sync Google Sheet sau khi xóa CCCD:', err)
    );

    return NextResponse.json({
      success: true,
      message: `Đã xóa file ${cleanFn} khỏi R2 và cập nhật đồng bộ Google Sheet!`,
    });
  } catch (error: any) {
    console.error('Lỗi DELETE /api/cccd:', error);
    return NextResponse.json({ success: false, error: error.message || 'Lỗi server' }, { status: 500 });
  }
}
