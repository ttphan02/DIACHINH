export function isLocalNodeRuntime(): boolean {
  if (typeof process === 'undefined' || !process.versions?.node) return false;
  if (process.env.NEXT_PUBLIC_PUBLIC_READONLY === 'true') return false;
  // Cloudflare Workers / Workerd luôn có WebSocketPair hoặc caches toàn cục
  if (typeof (globalThis as any).WebSocketPair !== 'undefined') return false;
  if (typeof (globalThis as any).caches !== 'undefined') return false;
  return true;
}

export async function readLocalJson<T = any>(filename: string): Promise<T | null> {
  if (!isLocalNodeRuntime()) return null;
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const filePath = path.join(process.cwd(), 'local-data', filename);
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const writeQueues = new Map<string, Promise<boolean>>();

export async function writeLocalJson(filename: string, data: any): Promise<boolean> {
  if (!isLocalNodeRuntime()) return false;
  const prev = writeQueues.get(filename) ?? Promise.resolve(true);
  const next = prev.then(async () => {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const dir = path.join(process.cwd(), 'local-data');
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(data), 'utf-8');
      await fs.rename(tmpPath, filePath);
      return true;
    } catch (err) {
      console.warn(`Lỗi ghi local-data/${filename}:`, err);
      return false;
    }
  });
  writeQueues.set(filename, next.catch(() => false));
  return next;
}
