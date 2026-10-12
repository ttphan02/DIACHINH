import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { executeSyncToGoogleSheet, cleanCccd, cleanName } from '@/utils/syncGoogleSheets';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const R2_PUBLIC_BASE = 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

// GET /api/cccd - Lấy danh sách toàn bộ file CCCD trên R2 kèm thông tin liên kết thửa
export async function GET(request: Request) {
  try {
    const bucket = await getR2Binding();
    if (!bucket) {
      return NextResponse.json({ success: false, error: 'Không thể kết nối Cloudflare R2' }, { status: 500 });
    }

    // Đọc danh sách file trong cccd/
    const listRes: any = await bucket.list({ prefix: 'cccd/', limit: 1000 });
    const objects = listRes.objects || [];

    // Đọc declarations để tìm liên kết
    let declarationsMap: Record<string, any> = {};
    try {
      const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (declObj) {
        const payload = JSON.parse(await declObj.text());
        declarationsMap = payload.declarationsMap || {};
      }
    } catch (e) {
      console.warn('Lỗi đọc declarationsMap:', e);
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
          url: `${R2_PUBLIC_BASE}/${fullKey}`,
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
    return NextResponse.json({ success: false, error: error.message || 'Lỗi server' }, { status: 500 });
  }
}

// DELETE /api/cccd - Xóa file CCCD khỏi R2 và hủy liên kết khỏi thửa đất, sau đó tự động sync Google Sheet
export async function DELETE(request: Request) {
  try {
    const bucket = await getR2Binding();
    if (!bucket) {
      return NextResponse.json({ success: false, error: 'Không thể kết nối Cloudflare R2' }, { status: 500 });
    }

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
    await bucket.delete(r2Key);

    // Cập nhật declarations: hủy liên kết nếu có
    let updatedDeclarations: Record<string, any> = {};
    try {
      const declObj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (declObj) {
        const payload = JSON.parse(await declObj.text());
        const map = payload.declarationsMap || {};
        let changed = false;

        for (const [code, decl] of Object.entries(map as Record<string, any>)) {
          const cClean = cleanCccd(decl.cccd_chu_ho || decl.cccd);
          if (cleanFn.includes(code) || (cClean && cleanFn.includes(cClean)) || decl.anh_cccd_pdf?.includes(cleanFn)) {
            // Hủy liên kết file CCCD
            decl.anh_cccd_pdf = '';
            // Nếu file tên chứa CCCD thì vẫn giữ số CCCD hoặc xóa nếu là gán sai
            changed = true;
          }
        }

        if (changed) {
          payload.updatedAt = new Date().toISOString();
          await bucket.put(KEY_ALL_DECLARATIONS, JSON.stringify(payload, null, 2), {
            httpMetadata: { contentType: 'application/json' },
          });
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
