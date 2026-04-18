/**
 * server/utils/cache.ts
 * 統一伺服器端快取管理模組
 * 取代分散在各處的 (global as any)[key] 反模式
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // milliseconds
}

class ServerCache {
  private store = new Map<string, CacheEntry<unknown>>();

  /** 設定快取（ttl 單位：毫秒） */
  set<T>(key: string, data: T, ttl = 10 * 60 * 1000): void {
    this.store.set(key, { data, timestamp: Date.now(), ttl });
  }

  /** 取得快取（若已過期則回傳 null） */
  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  /** 強制取得（不管是否過期） */
  getStale<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    return entry?.data ?? null;
  }

  /** 刪除快取 */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** 清除所有快取 */
  clear(): void {
    this.store.clear();
  }

  /** 取得快取的剩餘有效時間（毫秒），若不存在或已過期則回傳 0 */
  ttlRemaining(key: string): number {
    const entry = this.store.get(key);
    if (!entry) return 0;
    const remaining = entry.ttl - (Date.now() - entry.timestamp);
    return Math.max(0, remaining);
  }
}

// 全域單例（模組層級，比 global 物件更安全）
export const serverCache = new ServerCache();

// ─── 快取 Key 常數 ────────────────────────────────────────────────────────────

/** Twitter 情緒快取 key（依幣種） */
export const tweetSentimentKey = (symbol: string) =>
  `tweet_sentiment_${symbol.replace("USDT", "").replace("BUSD", "").toUpperCase()}`;

/** 快照快取 key（依幣種） */
export const snapshotKey = (symbol: string) => `snapshot_${symbol}`;

/** 高勝率掃描快取 key（依幣種） */
export const highWinRateKey = (symbol: string) => `high_win_rate_${symbol}`;
