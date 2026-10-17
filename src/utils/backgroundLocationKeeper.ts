import { reportCadreLocation } from './cadreTracker';
import { getSavedCadreName } from './declaration';

class BackgroundLocationKeeper {
  private audioElement: HTMLAudioElement | null = null;
  private wakeLockSentinel: any = null;
  private watchdogInterval: any = null;
  private active: boolean = false;
  private audioUrl: string | null = null;

  /**
   * Tạo file âm thanh WAV 1 giây im lặng 0Hz hoàn toàn trong bộ nhớ
   */
  private createSilentAudioBlob(): Blob {
    const sampleRate = 8000;
    const numSamples = sampleRate; // 1 giây
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);

    // RIFF identifier
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    this.writeString(view, 8, 'WAVE');

    // fmt subchunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono channel
    view.setUint32(24, sampleRate, true); // Sample rate
    view.setUint32(28, sampleRate, true); // Byte rate
    view.setUint16(32, 1, true); // Block align
    view.setUint16(34, 8, true); // 8-bit depth

    // data subchunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, numSamples, true);

    // 128 là giá trị trung tính (zero amplitude) của 8-bit PCM = Im lặng 100%
    for (let i = 0; i < numSamples; i++) {
      view.setUint8(44 + i, 128);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  private writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Kích hoạt chế độ Chạy ngầm khi khóa màn hình (Đút túi quần)
   */
  public async start(customCadreName?: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    const cadreName = customCadreName || getSavedCadreName() || 'Cán bộ thực địa';

    try {
      // 1. Khởi tạo và phát luồng âm thanh im lặng (Silent Audio Loop)
      if (!this.audioElement) {
        const blob = this.createSilentAudioBlob();
        this.audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(this.audioUrl);
        audio.loop = true;
        // Đặt âm lượng cực nhỏ hoặc 0 (trên iOS volume 0.001 tránh bị OS chặn)
        audio.volume = 0.001;

        // Tự động phát lại nếu bị OS ngắt
        audio.addEventListener('pause', () => {
          if (this.active) {
            audio.play().catch(() => {});
          }
        });

        this.audioElement = audio;
      }

      await this.audioElement.play();

      // 2. Cài đặt MediaSession API (Hiển thị trạng thái giám sát trên Màn hình khóa của điện thoại)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Đang theo dõi GPS thực địa',
          artist: `${cadreName} • Cư Pui`,
          album: 'Hệ thống Quản lý Địa chính Cư Pui',
        });

        navigator.mediaSession.setActionHandler('play', () => {
          if (this.audioElement) this.audioElement.play().catch(() => {});
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          if (this.audioElement) this.audioElement.play().catch(() => {});
        });
      }

      // 3. Yêu cầu Screen WakeLock (khi màn hình đang mở)
      this.requestWakeLock();

      // 4. Kích hoạt Watchdog Interval gửi GPS định kỳ mỗi 15 giây
      if (this.watchdogInterval) clearInterval(this.watchdogInterval);
      this.watchdogInterval = setInterval(() => {
        if (!this.active) return;
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const { latitude, longitude, accuracy, speed, heading } = pos.coords;
              const spd = typeof speed === 'number' && !isNaN(speed) ? Math.round(speed * 3.6) : null;
              reportCadreLocation({
                lat: latitude,
                lng: longitude,
                accuracy: Math.round(accuracy),
                speed: spd,
                heading: typeof heading === 'number' && !isNaN(heading) ? Math.round(heading) : null,
                action: 'Đang khảo sát thực địa (Đút túi quần)',
              }).catch(() => {});
            },
            (err) => {
              console.warn('GPS watchdog ping note:', err.message);
            },
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 5000,
            }
          );
        }
      }, 15000);

      this.active = true;
      try {
        localStorage.setItem('diachinh_pocket_mode', 'true');
      } catch {}

      return true;
    } catch (err) {
      console.warn('Lỗi khi kích hoạt Background Audio Keep-Alive:', err);
      return false;
    }
  }

  /**
   * Tắt chế độ chạy ngầm
   */
  public stop() {
    this.active = false;
    if (this.audioElement) {
      try {
        this.audioElement.pause();
      } catch {}
    }
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    if (this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel.release();
        this.wakeLockSentinel = null;
      } catch {}
    }
    try {
      localStorage.setItem('diachinh_pocket_mode', 'false');
    } catch {}
  }

  public isActive(): boolean {
    return this.active;
  }

  private async requestWakeLock() {
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
        });
      }
    } catch {}
  }
}

export const backgroundKeeper = new BackgroundLocationKeeper();
