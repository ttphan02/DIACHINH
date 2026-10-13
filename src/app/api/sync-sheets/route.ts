import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { executeSyncToGoogleSheet } from '@/utils/syncGoogleSheets';

export const dynamic = 'force-dynamic';

const KEY_ALL_DECLARATIONS = 'declarations/all.json';
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_URL || 'https://pub-8fc16192d16e4e6695117bf29e1314f4.r2.dev';

async function getR2Binding(): Promise<any | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as any)?.DIACHINH_STORAGE || null;
  } catch {
    return null;
  }
}

async function getDeclarationsMap(): Promise<Record<string, any>> {
  try {
    const bucket = await getR2Binding();
    if (bucket) {
      const obj = await bucket.get(KEY_ALL_DECLARATIONS);
      if (obj) {
        const text = await obj.text();
        const data = JSON.parse(text);
        return data.declarationsMap || {};
      }
    }
  } catch (err) {
    console.warn('Lỗi khi đọc declarations qua R2 binding:', err);
  }

  try {
    const res = await fetch(`${R2_PUBLIC_URL}/${KEY_ALL_DECLARATIONS}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return (data as any).declarationsMap || {};
    }
  } catch (err) {
    console.warn('Lỗi khi fetch declarations từ public R2:', err);
  }

  return {};
}

export async function GET() {
  const t0 = Date.now();
  try {
    const bucket = await getR2Binding();
    const declarationsMap = await getDeclarationsMap();
    const result = await executeSyncToGoogleSheet(declarationsMap, bucket);

    return NextResponse.json({
      success: result.success,
      message: result.message,
      durationMs: Date.now() - t0,
      totalDeclarations: Object.keys(declarationsMap).length,
      summary: (result as any).summary,
      sheetsData: (result as any).sheetsData,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi khi đồng bộ Google Sheet' },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
