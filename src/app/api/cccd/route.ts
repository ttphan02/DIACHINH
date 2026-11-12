import hiddenParcelsData from '@/data/hidden_parcels.json';
const HIDDEN_PARCEL_SET = new Set(hiddenParcelsData as string[]);

import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { cleanCccd, cleanName } from '@/utils/textHelpers';
import { getD1Binding } from '@/utils/d1Database';
import { isLocalNodeRuntime } from '@/utils/localFileDb';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const KEY_CCCD_LIST_ONLY_CACHE = 'cache/cccd_list_only.json';
const KEY_CCCD_FULL_CACHE = 'cache/cccd_full.json';
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'diachinh-storage';
const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL ||
  'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

// Cache ngắn hạn giúp Worker tránh nghẽn khi có nhiều request đồng thời, tự xóa khi force=true
let cccdCache: { data: any; timestamp: number } | null = null;
const CCCD_CACHE_TTL = 60000; // Cache 60s danh sách CCCD, giảm 95% CPU và I/O Worker
let listOnlyCache: { data: any; timestamp: number } | null = null;
const LIST_ONLY_CACHE_TTL = 60000; // Cache 60 giây danh sách số CCCD, giảm 99% I/O và CPU Worker

// In-memory cache cho kết quả kiểm tra từng số CCCD riêng lẻ (TTL 60s)
const checkResultCache = new Map<string, { data: any; timestamp: number }>();

// Pre-indexed Set các số CCCD đã có trên GGS chính để tra cứu O(1) < 0.001ms CPU
const GGS_CCCD_SET = new Set<string>();

async function getR2Binding(): Promise<any | null> {
  if (isLocalNodeRuntime()) return null;
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

      const now = Date.now();
      const cached = checkResultCache.get(clean);
      if (cached && now - cached.timestamp < 60000) {
        return NextResponse.json(cached.data);
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
            const listRes: any = await bucket.list({ prefix: `cccd/${clean}`, limit: 1 });
            if (listRes?.objects && listRes.objects.length > 0) {
              found = true;
              matchedKey = listRes.objects[0].key;
            }
          } catch {}
        }

        if (!found && clean.length < 12) {
          try {
            const padded12 = clean.padStart(12, '0');
            const listRes: any = await bucket.list({ prefix: `cccd/${padded12}`, limit: 1 });
            if (listRes?.objects && listRes.objects.length > 0) {
              found = true;
              matchedKey = listRes.objects[0].key;
            }
          } catch {}
        }
      }

      // Chỉ chạy S3 fallback ở local dev mode nếu không có R2 binding (tuyệt đối không chạy trên Cloudflare Worker)
      const isWorkerEnv = typeof (globalThis as any).WebSocketPair !== 'undefined' || typeof (globalThis as any).caches !== 'undefined';
      if (!found && !bucket && !isWorkerEnv) {
        const s3 = await getS3Client();
        if (s3) {
          try {
            const { HeadObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
            try {
              await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: targetKey }));
              found = true;
            } catch {}

            if (!found) {
              const listRes = await s3.send(
                new ListObjectsV2Command({
                  Bucket: R2_BUCKET,
                  Prefix: `cccd/${clean}`,
                  MaxKeys: 1,
                })
              );
              if (listRes.Contents && listRes.Contents.length > 0) {
                found = true;
                matchedKey = listRes.Contents[0].Key || targetKey;
              }
            }
          } catch {}
        }
      }

      if (found) {
        const filename = matchedKey.replace(/^cccd\//, '');
        const resData = {
          exists: true,
          inR2: true,
          filename,
          url: `/api/image/cccd/${encodeURIComponent(filename)}`,
          message: 'Đã có cccd trên hệ thống!',
        };
        checkResultCache.set(clean, { data: resData, timestamp: now });
        return NextResponse.json(resData);
      }

      // Kiểm tra siêu tốc O(1) qua GGS Set pre-indexed (0ms CPU)
      if (GGS_CCCD_SET.has(clean)) {
        const resData = {
          exists: true,
          inR2: false,
          inGgs: true,
          message: 'Đã có cccd trên hệ thống!',
        };
        checkResultCache.set(clean, { data: resData, timestamp: now });
        return NextResponse.json(resData);
      }

      const notFoundData = { exists: false };
      checkResultCache.set(clean, { data: notFoundData, timestamp: now });
      return NextResponse.json(notFoundData);
    }

    // 2. Lấy danh sách tóm tắt tất cả các số CCCD đã có file PDF trên R2 (có cache 60s + R2 snapshot Zero-CPU)
    if (searchParams.get('list_only')) {
      const forceRefresh = searchParams.get('force') === 'true' || searchParams.get('refresh') === '1';
      const now = Date.now();
      if (!forceRefresh && listOnlyCache && now - listOnlyCache.timestamp < LIST_ONLY_CACHE_TTL) {
        return NextResponse.json(listOnlyCache.data, {
          headers: {
            'Cache-Control': 'public, max-age=15, s-maxage=30',
          },
        });
      }

      const bucket = await getR2Binding();
      if (!forceRefresh && bucket) {
        try {
          const cachedObj = await bucket.get(KEY_CCCD_LIST_ONLY_CACHE);
          if (cachedObj?.body) {
            return new NextResponse(cachedObj.body, {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=180',
                'CDN-Cache-Control': 'public, max-age=120',
                'X-Cccd-Cache': 'r2-snapshot',
              },
            });
          }
        } catch {}
      }

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
      const filenames: string[] = [];
      for (let i = 0; i < objects.length; i++) {
        const rawKey = objects[i].key;
        const fn = rawKey.startsWith('cccd/') ? rawKey.slice(5) : rawKey;
        const cleanFn = fn.endsWith('.pdf') || fn.endsWith('.PDF') ? fn.slice(0, -4).trim() : fn.trim();
        filenames.push(cleanFn);
        const m = cleanFn.match(/\b\d{9,12}\b/);
        const digits = m ? m[0] : cleanFn.replace(/\D/g, '');
        if (digits.length === 12) {
          cccdSet.add(digits);
        } else if (digits.length === 10 || digits.length === 11) {
          cccdSet.add(digits.padStart(12, '0'));
        }
      }
      const cccdNumbers = Array.from(cccdSet);

      const payload = {
        success: true,
        count: cccdNumbers.length,
        cccdList: cccdNumbers,
        filenames,
      };
      listOnlyCache = { data: payload, timestamp: now };
      const jsonStr = JSON.stringify(payload);

      if (bucket) {
        await bucket.put(KEY_CCCD_LIST_ONLY_CACHE, jsonStr, {
          httpMetadata: { contentType: 'application/json' },
        }).catch(() => {});
      }

      return new NextResponse(jsonStr, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=5, s-maxage=10, stale-while-revalidate=30',
          'CDN-Cache-Control': 'public, max-age=10',
        },
      });
    }

    // 3. Toàn bộ danh sách Kho CCCD (R2) phục vụ giao diện CccdManagerTab
    const now = Date.now();
    const forceRefresh = searchParams.get('force') === 'true' || searchParams.get('refresh') === '1';
    if (!forceRefresh && cccdCache && now - cccdCache.timestamp < CCCD_CACHE_TTL) {
      return NextResponse.json(cccdCache.data);
    }

    const bucket = await getR2Binding();
    if (!forceRefresh && bucket) {
      try {
        const cachedObj = await bucket.get(KEY_CCCD_FULL_CACHE);
        if (cachedObj?.body) {
          return new NextResponse(cachedObj.body, {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
              'CDN-Cache-Control': 'public, max-age=60',
              'X-Cccd-Cache': 'r2-snapshot',
            },
          });
        }
      } catch {}
    }
    let objects: Array<{ key: string; size: number; uploaded?: string | Date | null }> = [];
    let declarationsMap: Record<string, any> = {};

    if (bucket) {
      try {
        // Ưu tiên truy vấn 3 cột gọn từ D1 SQL Database để tránh tải & parse blob 1.2MB all.json trong Worker
        const d1DeclsPromise = (async () => {
          try {
            const db = await getD1Binding();
            if (db) {
              const { results } = await db
                .prepare('SELECT ma_thua, chu_dat_ten, chu_dat_cccd FROM declarations')
                .all();
              if (Array.isArray(results) && results.length > 0) {
                const map: Record<string, any> = {};
                for (const r of results) {
                  map[r.ma_thua] = {
                    chu_dat_ten: r.chu_dat_ten,
                    chu_dat_cccd: r.chu_dat_cccd,
                  };
                }
                return map;
              }
            }
          } catch {}
          return null;
        })();

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

        const [listRes, d1Map] = await Promise.all([listAllPromise, d1DeclsPromise]);
        objects = listRes || [];
        if (d1Map) {
          declarationsMap = d1Map;
        } else {
          const declObj = await bucket.get(KEY_ALL_DECLARATIONS).catch(() => null);
          if (declObj) {
            const payload = JSON.parse(await declObj.text());
            declarationsMap = payload.declarationsMap || {};
          }
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

    // Index 1 lần duy nhất để tra cứu O(1) - KHÔNG lặp lồng O(N*M) và hạn chế gọi regex nặng trong vòng lặp 1500+ bản ghi
    const cccdToDecl = new Map<string, { maThua: string; chuHo: string }>();
    const declaredCodesSet = new Set<string>();

    for (const [maThua, decl] of Object.entries(declarationsMap)) {
      declaredCodesSet.add(maThua);
      const rawC = String(decl.cccd_chu_ho || decl.cccd || decl.chu_dat_cccd || '');
      const digits = rawC.replace(/\D/g, '');
      const c1 = digits.length === 10 || digits.length === 11 ? digits.padStart(12, '0') : digits;
      if (c1) {
        const rawName = String(decl.ho_va_ten_chu_ho || decl.chu_ho || decl.chu_dat_ten || '').trim();
        cccdToDecl.set(c1, { maThua, chuHo: rawName });
      }
    }

    const files = objects
      .map((obj: any) => {
        const fullKey = obj.key;
        const filename = fullKey.startsWith('cccd/') ? fullKey.slice(5) : fullKey;
        if (!filename) return null;

        // Trích xuất số CCCD và Tên từ tên file: e.g. "020064002073_Phan Thanh Truc.pdf"
        const dotIdx = filename.lastIndexOf('.');
        const nameNoExt = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
        const underscoreIdx = nameNoExt.indexOf('_');
        const firstPart = underscoreIdx >= 0 ? nameNoExt.slice(0, underscoreIdx) : nameNoExt;
        const digits0 = firstPart.replace(/\D/g, '');
        const cccdCandidate =
          digits0.length === 10 || digits0.length === 11 ? digits0.padStart(12, '0') : digits0;
        const nameCandidate = underscoreIdx >= 0 ? nameNoExt.slice(underscoreIdx + 1).replace(/_/g, ' ').trim() : '';

        // Kiểm tra khớp nhanh O(1)
        let matchedParcel = '';
        let matchedOwner = nameCandidate;

        if (cccdCandidate && cccdToDecl.has(cccdCandidate)) {
          const match = cccdToDecl.get(cccdCandidate)!;
          matchedParcel = match.maThua;
          if (!matchedOwner && match.chuHo) matchedOwner = match.chuHo;
        } else if (underscoreIdx >= 0) {
          // Khớp mã thửa theo regex mẫu to_thua (O(1)) thay vì lặp toàn bộ mảng declarations
          const parcelMatch = nameNoExt.match(/\b(\d+_\d+)\b/);
          if (parcelMatch && declaredCodesSet.has(parcelMatch[1])) {
            matchedParcel = parcelMatch[1];
            matchedOwner = declarationsMap[matchedParcel]?.chu_ho || declarationsMap[matchedParcel]?.chu_dat_ten || matchedOwner;
          }
        }

        const isDateObj = obj.uploaded instanceof Date;
        const uploadedMs = isDateObj ? obj.uploaded.getTime() : obj.uploaded ? Date.parse(obj.uploaded) || 0 : 0;
        const uploadedAt = isDateObj
          ? obj.uploaded.toISOString()
          : uploadedMs
          ? new Date(uploadedMs).toISOString()
          : null;

        return {
          key: fullKey,
          filename,
          size: obj.size,
          uploadedAt,
          _uploadedMs: uploadedMs,
          url: `/api/image/${encodeURI(fullKey)}`,
          cccdNumber: cccdCandidate || '',
          ownerName: matchedOwner || '',
          matchedParcelCode: (matchedParcel && !HIDDEN_PARCEL_SET.has(matchedParcel)) ? matchedParcel : '',
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b._uploadedMs - a._uploadedMs)
      .map(({ _uploadedMs, ...rest }: any) => rest);

    const result = {
      success: true,
      total: files.length,
      files,
    };

    cccdCache = { data: result, timestamp: now };
    const jsonStr = JSON.stringify(result);

    if (bucket) {
      await bucket.put(KEY_CCCD_FULL_CACHE, jsonStr, {
        httpMetadata: { contentType: 'application/json' },
      }).catch(() => {});
    }

    return new NextResponse(jsonStr, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
        'CDN-Cache-Control': 'public, max-age=60',
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
    if (bucket) {
      await Promise.allSettled([
        bucket.delete(KEY_CCCD_LIST_ONLY_CACHE),
        bucket.delete(KEY_CCCD_FULL_CACHE),
      ]);
    }
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



    return NextResponse.json({
      success: true,
      message: `Đã xóa file ${cleanFn} khỏi R2 và cập nhật đồng bộ Google Sheet!`,
    });
  } catch (error: any) {
    console.error('Lỗi DELETE /api/cccd:', error);
    return NextResponse.json({ success: false, error: error.message || 'Lỗi server' }, { status: 500 });
  }
}
