import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { cleanCccd, cleanName } from '@/utils/textHelpers';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

// Cache ngắn hạn giúp Worker tránh nghẽn khi có nhiều request đồng thời, tự xóa khi force=true
let cccdCache: { data: any; timestamp: number } | null = null;
const CCCD_CACHE_TTL = 3000;
let listOnlyCache: { data: any; timestamp: number } | null = null;
const LIST_ONLY_CACHE_TTL = 30000; // Cache 30 giây danh sách số CCCD, giảm 99% I/O và CPU Worker

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

async function deleteObjectFromR2(key: string) {
  const bucket = await getR2Binding();
  if (bucket) {
    await bucket.delete(key);
    return true;
  }
  const s3 = await getS3Client();
  if (s3) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
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

      if (!found) {
        const s3 = await getS3Client();
        if (s3) {
          const { HeadObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
          try {
            await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: targetKey }));
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

    // 2. Lấy danh sách tóm tắt tất cả các số CCCD đã có file PDF trên R2 (có cache 30s)
    if (searchParams.get('list_only')) {
      const forceRefresh = searchParams.get('force') === 'true';
      const now = Date.now();
      if (!forceRefresh && listOnlyCache && now - listOnlyCache.timestamp < LIST_ONLY_CACHE_TTL) {
        return NextResponse.json(listOnlyCache.data, {
          headers: {
            'Cache-Control': 'public, max-age=15, s-maxage=30',
          },
        });
      }

      const bucket = await getR2Binding();
      let objects: Array<{ key: string }> = [];

      if (bucket) {
        try {
          let cursor: string | undefined = undefined;
          let it = 0;
          do {
            it++;
            const listRes: any = await bucket.list({ prefix: 'cccd/', limit: 1000, cursor });
            if (listRes?.objects) objects.push(...listRes.objects);
            cursor = listRes?.truncated ? listRes.cursor : undefined;
          } while (cursor && it < 10);
        } catch {}
      }
      if (objects.length === 0) {
        const s3 = await getS3Client();
        if (s3) {
          try {
            const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
            let token: string | undefined = undefined;
            let it = 0;
            do {
              it++;
              const res: any = await s3.send(
                new ListObjectsV2Command({
                  Bucket: R2_BUCKET,
                  Prefix: 'cccd/',
                  MaxKeys: 1000,
                  ContinuationToken: token,
                })
              );
              if (res.Contents) objects.push(...res.Contents.map((c: any) => ({ key: c.Key || '' })));
              token = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (token && it < 10);
          } catch {}
        }
      }

      const cccdSet = new Set<string>();
      for (const o of objects) {
        const fn = o.key.replace(/^cccd\//, '').replace(/\.pdf$/i, '').trim();
        const m = fn.match(/\b\d{9,12}\b/);
        const clean = m ? cleanCccd(m[0]) : cleanCccd(fn);
        if (clean && clean.length === 12) {
          cccdSet.add(clean);
        }
      }
      const cccdNumbers = Array.from(cccdSet);

      const payload = {
        success: true,
        count: cccdNumbers.length,
        cccdList: cccdNumbers,
      };
      listOnlyCache = { data: payload, timestamp: now };

      return NextResponse.json(payload, {
        headers: {
          'Cache-Control': 'public, max-age=15, s-maxage=30',
        },
      });
    }

    // 3. Toàn bộ danh sách Kho CCCD (R2) phục vụ giao diện CccdManagerTab
    const now = Date.now();
    const forceRefresh = searchParams.get('force') === 'true';
    if (!forceRefresh && cccdCache && now - cccdCache.timestamp < CCCD_CACHE_TTL) {
      return NextResponse.json(cccdCache.data);
    }

    const bucket = await getR2Binding();
    let objects: Array<{ key: string; size: number; uploaded?: string | Date | null }> = [];
    let declarationsMap: Record<string, any> = {};

    if (bucket) {
      try {
        const declPromise = bucket.get(KEY_ALL_DECLARATIONS).catch((e: any) => {
          console.warn('Lỗi bucket.get declarations:', e);
          return null;
        });

        // Phân trang toàn bộ để không bị thiếu bất kỳ file nào (vượt quá 1000 file)
        const listAllPromise = (async () => {
          let list: any[] = [];
          let cursor: string | undefined = undefined;
          let it = 0;
          do {
            it++;
            const listRes: any = await bucket.list({ prefix: 'cccd/', limit: 1000, cursor });
            if (listRes?.objects) list.push(...listRes.objects);
            cursor = listRes?.truncated ? listRes.cursor : undefined;
          } while (cursor && it < 10);
          return list;
        })();

        const [listRes, declObj] = await Promise.all([listAllPromise, declPromise]);
        objects = listRes || [];
        if (declObj) {
          const payload = JSON.parse(await declObj.text());
          declarationsMap = payload.declarationsMap || {};
        }
      } catch (err) {
        console.warn('Lỗi list CCCD qua R2 binding:', err);
      }
    }

    // Fallback qua S3 SDK nếu bucket binding không có
    if (objects.length === 0) {
      const s3 = await getS3Client();
      if (s3) {
        try {
          const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
          let token: string | undefined = undefined;
          let it = 0;
          do {
            it++;
            const res: any = await s3.send(
              new ListObjectsV2Command({
                Bucket: R2_BUCKET,
                Prefix: 'cccd/',
                MaxKeys: 1000,
                ContinuationToken: token,
              })
            );
            if (res.Contents) {
              objects.push(
                ...res.Contents.map((c: any) => ({
                  key: c.Key || '',
                  size: c.Size || 0,
                  uploaded: c.LastModified || null,
                }))
              );
            }
            token = res.IsTruncated ? res.NextContinuationToken : undefined;
          } while (token && it < 10);
        } catch (err) {
          console.warn('Lỗi list CCCD qua S3 SDK:', err);
        }
      }
    }

    // Fallback đọc declarations nếu chưa có
    if (Object.keys(declarationsMap).length === 0) {
      try {
        const res = await fetch(`${R2_PUBLIC_BASE}/${KEY_ALL_DECLARATIONS}?t=${now}`, {
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

    // Index 1 lần duy nhất để tra cứu O(1) - KHÔNG lặp lồng O(N*M) làm quá tải CPU Worker gây lỗi 503
    const cccdToDecl = new Map<string, { maThua: string; chuHo: string }>();
    const declaredCodesSet = new Set<string>();

    for (const [maThua, decl] of Object.entries(declarationsMap)) {
      declaredCodesSet.add(maThua);
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

        // Kiểm tra khớp nhanh O(1)
        let matchedParcel = '';
        let matchedOwner = nameCandidate;

        if (cccdCandidate && cccdToDecl.has(cccdCandidate)) {
          const match = cccdToDecl.get(cccdCandidate)!;
          matchedParcel = match.maThua;
          if (!matchedOwner && match.chuHo) matchedOwner = match.chuHo;
        } else {
          // Khớp mã thửa theo regex mẫu to_thua (O(1)) thay vì lặp toàn bộ mảng declarations
          const parcelMatch = nameNoExt.match(/\b(\d+_\d+)\b/);
          if (parcelMatch && declaredCodesSet.has(parcelMatch[1])) {
            matchedParcel = parcelMatch[1];
            matchedOwner = declarationsMap[matchedParcel]?.chu_ho || declarationsMap[matchedParcel]?.chu_dat_ten || matchedOwner;
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

    const result = {
      success: true,
      total: files.length,
      files,
    };

    cccdCache = { data: result, timestamp: now };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
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

    // Xóa cache để cập nhật tức thì
    cccdCache = null;
    listOnlyCache = null;

    // Trích xuất số CCCD từ tên file để hủy liên kết
    const cccdCandidate = cleanCccd(cleanFn.split('_')[0]);

    const bucket = await getR2Binding();
    let updatedDeclarations: Record<string, any> = {};

    try {
      let map: Record<string, any> = {};
      let fullPayload: any = null;

      if (bucket) {
        const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
        if (declObj) {
          fullPayload = JSON.parse(await declObj.text());
          map = fullPayload.declarationsMap || {};
        }
      }

      if (Object.keys(map).length > 0 && cccdCandidate) {
        let changed = false;
        for (const [maThua, decl] of Object.entries(map)) {
          const c1 = cleanCccd(decl.cccd_chu_ho || decl.cccd || decl.chu_dat_cccd);
          if (c1 === cccdCandidate) {
            delete decl.cccd_url;
            delete decl.cccd_file_name;
            changed = true;
          }
        }

        if (changed && fullPayload && bucket) {
          const jsonStr = JSON.stringify(fullPayload);
          await bucket.put(KEY_ALL_DECLARATIONS, jsonStr, {
            httpMetadata: { contentType: 'application/json' },
          });
        }
        updatedDeclarations = map;
      }
    } catch (e) {
      console.warn('Lỗi cập nhật declarations khi xóa CCCD:', e);
    }

    // Tự động kích hoạt đồng bộ Google Sheet
    import('@/utils/syncGoogleSheets')
      .then(({ executeSyncToGoogleSheet }) => {
        executeSyncToGoogleSheet(updatedDeclarations, bucket).catch((err) =>
          console.error('Lỗi sync Google Sheet sau khi xóa CCCD:', err)
        );
      })
      .catch((err) => console.error('Lỗi import syncGoogleSheets:', err));

    return NextResponse.json({
      success: true,
      message: `Đã xóa file ${cleanFn} khỏi R2 và cập nhật đồng bộ Google Sheet!`,
    });
  } catch (error: any) {
    console.error('Lỗi DELETE /api/cccd:', error);
    return NextResponse.json({ success: false, error: error.message || 'Lỗi server' }, { status: 500 });
  }
}
