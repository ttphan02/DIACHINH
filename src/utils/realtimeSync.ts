'use client';

export type RealtimeEventType =
  | 'DECLARATION_SAVED'
  | 'DECLARATION_DELETED'
  | 'CELL_EDITS_SYNCED'
  | 'FORCE_REFRESH_REPORT';

export interface RealtimeEvent {
  type: RealtimeEventType;
  maThua?: string;
  declaration?: any;
  declaredCodes?: string[];
  cellEdits?: Record<string, Record<number, string>>;
  timestamp?: number;
}

const CHANNEL_NAME = 'diachinh_realtime_sync_channel';
const STORAGE_EVENT_KEY = 'diachinh_last_broadcast_event';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }
  return channel;
}

/**
 * Phát tín hiệu đồng bộ Realtime tới tất cả các tab / cửa sổ khác trên trình duyệt
 */
export function broadcastRealtimeEvent(event: RealtimeEvent): void {
  if (typeof window === 'undefined') return;
  const fullEvent = {
    ...event,
    timestamp: Date.now(),
  };

  // 1. Gửi qua BroadcastChannel (0ms, siêu nhanh)
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(fullEvent);
    } catch (e) {
      console.warn('Lỗi gửi qua BroadcastChannel:', e);
    }
  }

  // 2. Fallback qua localStorage event (cho các tab hoặc trình duyệt không hỗ trợ channel)
  try {
    localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(fullEvent));
  } catch {}
}

/**
 * Lắng nghe sự kiện đồng bộ Realtime từ các tab / cửa sổ khác
 */
export function onRealtimeEvent(callback: (event: RealtimeEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleMessage = (ev: MessageEvent) => {
    if (ev?.data && typeof ev.data === 'object' && ev.data.type) {
      callback(ev.data as RealtimeEvent);
    }
  };

  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_EVENT_KEY && ev.newValue) {
      try {
        const parsed = JSON.parse(ev.newValue);
        if (parsed && parsed.type) {
          callback(parsed as RealtimeEvent);
        }
      } catch {}
    }
  };

  const ch = getChannel();
  if (ch) {
    ch.addEventListener('message', handleMessage);
  }
  window.addEventListener('storage', handleStorage);

  return () => {
    if (ch) {
      ch.removeEventListener('message', handleMessage);
    }
    window.removeEventListener('storage', handleStorage);
  };
}
