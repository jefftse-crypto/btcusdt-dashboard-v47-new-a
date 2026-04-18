/**
 * routers.ts — tRPC 路由
 * 加密貨幣技術分析儀表板後端路由
 */

import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getWidgetPrefs, saveWidgetPrefs } from "./db";
import { runAnalysis, fetchCandles, fetchCandlesPaged } from "./analysis";
import { runCannonballAnalysis } from "./services/cannonballService";
import { runBacktest, runMonteCarlo, type BacktestStrategy } from "./backtest";
import { runWalkForwardBacktest } from "./walkforward";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { parseStringPromise } from "xml2js";
import {
  SnapshotSchema,
  SnapshotSummarySchema,
  CandleArraySchema,
  AnalysisStatusSchema,
  NewsArraySchema,
  TweetArraySchema,
  WidgetPrefsSchema,
  safeParseSnapshot,
  safeParseCandles,
  safeParseNews,
  safeParseTweets,
  type Snapshot,
  type SnapshotSummary,
  type Candle,
  type NewsItem,
  type TweetItem,
} from "@shared/schemas";
import { COOKIE_NAME } from "@shared/const";
import { invokeLLM } from "./_core/llm";
import { serverCache, tweetSentimentKey, snapshotKey } from "./utils/cache";
import { readFile } from "node:fs/promises";

// ─────────────────────────────────────────────
// 內建分析引擎（無需 FastAPI）
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// [F-ROUTER] gpt-5.4 修復：快取安全強化
// ─────────────────────────────────────────────

// Symbol 嚴格白名單驗證（防止注入與資源濫用）
const SYMBOL_REGEX = /^[A-Z0-9]{2,20}(USDT|BTC|ETH|BNB|USDC)?$/;
function normalizeSymbol(raw: string): string {
  const s = raw.toUpperCase().trim();
  if (!SYMBOL_REGEX.test(s)) throw new TRPCError({ code: "BAD_REQUEST", message: `無效的交易對格式：${s}` });
  return s;
}

// 快取容量上限（LRU-like：超過上限時清除最舊的項目）
const MAX_CACHE_SIZE = 50;
function setCacheWithLimit<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    // 刪除最早插入的 key
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

// ─────────────────────────────────────────────
// 共用技術指標計算函數（P3 改良：消除重複定義）
// ─────────────────────────────────────────────
function sharedEmaArr(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = data[0] ?? 0;
  for (const v of data) { prev = v * k + prev * (1 - k); result.push(prev); }
  return result;
}
function sharedRsiLast(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  return 100 - 100 / (1 + (l === 0 ? 100 : g / l));
}
function sharedMacdHistFn(closes: number[]): { cur: number; prev: number } {
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let e12 = closes[0] ?? 0, e26 = closes[0] ?? 0, sig = 0;
  for (const c of closes) { e12 = c * k12 + e12 * (1 - k12); e26 = c * k26 + e26 * (1 - k26); }
  const m = e12 - e26; sig = m * k9 + sig * (1 - k9);
  let e12p = closes[0] ?? 0, e26p = closes[0] ?? 0, sigp = 0;
  for (const c of closes.slice(0, -1)) { e12p = c * k12 + e12p * (1 - k12); e26p = c * k26 + e26p * (1 - k26); }
  const mp = e12p - e26p; sigp = mp * k9 + sigp * (1 - k9);
  return { cur: m - sig, prev: mp - sigp };
}
function sharedBbBandwidth(closes: number[], period = 20, mult = 2): number {
  const sl = closes.slice(-period);
  if (sl.length === 0) return 5;
  const mid = sl.reduce((a, b) => a + b, 0) / sl.length;
  const std = Math.sqrt(sl.reduce((s, v) => s + (v - mid) ** 2, 0) / sl.length);
  return (mult * 2 * std) / (mid || 1) * 100;
}
function sharedMacdHistLast(closes: number[]): number {
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let e12 = closes[0] ?? 0, e26 = closes[0] ?? 0, sig = 0;
  for (const c of closes) { e12 = c * k12 + e12 * (1 - k12); e26 = c * k26 + e26 * (1 - k26); }
  const m = e12 - e26; sig = m * k9 + sig * (1 - k9); return m - sig;
}
function sharedAdxLast(candles: Candle[], period = 14): number {
  if (candles.length < period * 2) return 20;
  const trs: number[] = [], pdms: number[] = [], ndms: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, ph = candles[i-1].high, pl = candles[i-1].low, pc = candles[i-1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    pdms.push(h - ph > pl - l && h - ph > 0 ? h - ph : 0);
    ndms.push(pl - l > h - ph && pl - l > 0 ? pl - l : 0);
  }
  const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  const pdi = (pdms.slice(-period).reduce((a, b) => a + b, 0) / period) / (atr || 1) * 100;
  const ndi = (ndms.slice(-period).reduce((a, b) => a + b, 0) / period) / (atr || 1) * 100;
  return pdi + ndi === 0 ? 20 : Math.abs(pdi - ndi) / (pdi + ndi) * 100;
}
function sharedBollingerLast(closes: number[], period = 20, mult = 2): { upper: number; lower: number; middle: number; percent_b: number; bandwidth: number } {
  const sl = closes.slice(-period);
  if (sl.length === 0) return { upper: 0, lower: 0, middle: 0, percent_b: 0.5, bandwidth: 5 };
  const mid = sl.reduce((a, b) => a + b, 0) / sl.length;
  const std = Math.sqrt(sl.reduce((s, v) => s + (v - mid) ** 2, 0) / sl.length);
  const upper = mid + mult * std, lower = mid - mult * std;
  const last = closes[closes.length - 1] ?? mid;
  return { upper, lower, middle: mid, percent_b: upper === lower ? 0.5 : (last - lower) / (upper - lower), bandwidth: (mult * 2 * std) / (mid || 1) * 100 };
}

// 快取最近一次分析結果，避免重複計算
const snapshotCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 60_000; // 60 秒

// 新聞快取（5 分鐘 TTL，避免每次都抓 RSS + LLM）
const newsCache = new Map<string, { data: unknown; ts: number }>();
const NEWS_CACHE_TTL = 5 * 60_000; // 5 分鐘

// 推文快取（10 分鐘 TTL）
const tweetCache = new Map<string, { data: unknown; ts: number }>();
const TWEET_CACHE_TTL = 10 * 60_000; // 10 分鐘

// In-flight dedup：防止同一 symbol 重複觸發分析（cache stampede 防護）
const analysisInFlight = new Map<string, Promise<unknown>>();

function createFallbackIndicator(price: number, direction: "long" | "short" | "neutral") {
  return {
    rsi: direction === "long" ? 56 : direction === "short" ? 44 : 50,
    macd: { macd: 0, signal: 0, histogram: 0 },
    adx: { adx: 18, plus_di: direction === "long" ? 24 : 18, minus_di: direction === "short" ? 24 : 18 },
    atr: 0,
    bollinger: { upper: price, middle: price, lower: price, bandwidth: 0, percent_b: 0.5 },
    vwap: price,
    ema: { ema20: price, ema50: price, ema200: price },
    stochastic: { k: 50, d: 50 },
    trend: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "neutral",
    momentum: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "neutral",
    close: price,
  };
}

function createFallbackPaTimeframe(timeframe: string, price: number, direction: "long" | "short" | "neutral") {
  return {
    timeframe,
    trend: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "neutral",
    trend_context: "ranging",
    score: direction === "long" ? 60 : direction === "short" ? 40 : 50,
    close: price,
    rsi: direction === "long" ? 56 : direction === "short" ? 44 : 50,
    atr: 0,
    ema20: price,
    ema50: price,
    ema200: price,
    macd_hist: 0,
    adx: 18,
    plus_di: direction === "long" ? 24 : 18,
    minus_di: direction === "short" ? 24 : 18,
    bollinger: { upper: price, middle: price, lower: price, bandwidth: 0, percent_b: 0.5 },
    bb_position: "middle",
    bb_squeeze: false,
    vwap: price,
    vwap_position: "at",
    cmf: 0,
    patterns: [],
    chan: {
      bis: [], duans: [], zhongshus: [], trend: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "ranging",
      in_zhongshu: false, current_zhongshu: null, bi_count: 0, duan_count: 0, buy_sell_points: [], divergence_signals: { type: null, description: "" },
    },
    support: price,
    resistance: price,
    sr_levels: [],
    false_break_score: 0,
    false_break_direction: "none",
    mtf_alignment: 50,
    volume_trend: "neutral",
    price_vs_vwap: "at",
    key_level_proximity: 0,
    divergences: [],
    high_confluence_patterns: [],
  };
}

async function buildFallbackSnapshotFromLiveSignal(symbol: string, errorMessage: string): Promise<Snapshot | null> {
  if (symbol !== "BTCUSDT") return null;
  try {
    const raw = await readFile("/home/ubuntu/runtime/btcusdt_live_signal_snapshot.json", "utf8");
    const live = JSON.parse(raw) as {
      generated_at?: string;
      signals?: Array<{ direction?: "long" | "short" | "neutral"; entry_price?: number }>;
      active_presets?: Array<{ label?: string }>;
    };
    const latestSignal = live.signals?.[0];
    const direction = latestSignal?.direction === "long" || latestSignal?.direction === "short" ? latestSignal.direction : "neutral";
    const price = Number(latestSignal?.entry_price ?? 0);
    if (!Number.isFinite(price) || price <= 0) return null;
    const indicator = createFallbackIndicator(price, direction);
    const pa4h = createFallbackPaTimeframe("4h", price, direction);
    const pa1h = createFallbackPaTimeframe("1h", price, direction);
    const pa15m = createFallbackPaTimeframe("15m", price, direction);
    const pa5m = createFallbackPaTimeframe("5m", price, direction);
    return {
      symbol,
      generated_at: live.generated_at ?? new Date().toISOString(),
      live_price: price,
      error: `分析已降級：${errorMessage}`,
      indicators: indicator,
      mtf_indicators: { "4h": indicator, "1h": indicator, "15m": indicator, "5m": indicator },
      smc: {
        structure: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "ranging",
        fvgs: [], order_blocks: [], bos_choch: [],
        liquidity: { sell_side: [], buy_side: [], nearest_sell: price, nearest_buy: price, levels: [] },
        nearest_bull_fvg: null, nearest_bear_fvg: null, nearest_bull_ob: null, nearest_bear_ob: null,
        fvg_count: 0, ob_count: 0,
        premium_discount: { equilibrium: price, current_zone: "equilibrium", percent_position: 50 },
        ote_zone: null, recent_swing_high: price, recent_swing_low: price, liquidity_levels: [], confirmation_setups: [],
      },
      pa: {
        timeframes: { "4h": pa4h, "1h": pa1h, "15m": pa15m, "5m": pa5m },
        consensus: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "neutral",
        avg_score: direction === "long" ? 60 : direction === "short" ? 40 : 50,
        suggestion: live.active_presets?.[0]?.label ? `目前採用實盤快照回退，優先參考 ${live.active_presets[0].label}` : "目前採用實盤快照回退。",
        entry_params: direction === "neutral" ? {} : { direction, entry: price, sl: price, tp1: price, tp2: price, rr_ratio: 0 },
        divergence_summary: { has_bullish_divergence: false, has_bearish_divergence: false, strongest_divergence: null, divergence_count: 0 },
        top_setups: [],
      },
      chan_mtf: {
        timeframes: {},
        signals: {},
        summary: {
          overall_trend: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "ranging",
          trend_alignment: 50,
          bullish_count: direction === "long" ? 1 : 0,
          bearish_count: direction === "short" ? 1 : 0,
          ranging_count: direction === "neutral" ? 1 : 0,
          in_zhongshu_count: 0,
          dominant_timeframe: "1h",
          suggestion: "目前使用實盤快照回退結果。",
          detail: errorMessage,
          entry_timing: "等待完整分析恢復",
          best_buy_point: null,
          best_sell_point: null,
        },
      },
      consensus: { score: direction === "long" ? 60 : direction === "short" ? 40 : 50, label: direction === "long" ? "偏多" : direction === "short" ? "偏空" : "中性" },
      forecast_4h: {
        main_scenario: direction === "long" ? "偏多延續" : direction === "short" ? "偏空延續" : "震盪整理",
        main_probability: 55,
        main_target: price,
        main_description: "目前以實盤快照與本地回退結果提供方向提示。",
        alt_scenario: "等待完整分析恢復",
        alt_probability: 45,
        alt_target: price,
        alt_description: errorMessage,
      },
      strategy: {
        direction,
        entry: price,
        sl: price,
        tp1: price,
        tp2: price,
        rr_ratio: 0,
        atr: 0,
        suggestion: "完整分析暫時不可用，先參考實盤快照與方向摘要。",
        checklist: [{ label: "回退模式", passed: true, value: "live_snapshot" }],
      },
      onchain: { funding_rate: null, long_short_ratio: null, fear_greed: null, open_interest: null, coingecko: null },
      klines: { "4h": [], "1h": [], "15m": [], "5m": [] },
      advanced: { divergences_4h: [], divergences_1h: [], pa_patterns_4h: [], pa_patterns_1h: [], chan_enhanced_4h: null, chan_enhanced_1h: null, smc_confirmations: [] },
    } as Snapshot;
  } catch {
    return null;
  }
}

/**
 * 呼叫 FastAPI 服務的通用函數（可選，若有部署 FastAPI 則使用）。
 * 若未設定 ANALYSIS_API_URL 或連線失敗，fallback 到內建引擎。
 */
async function callAnalysisApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const base = process.env.ANALYSIS_API_URL;
  if (!base) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ANALYSIS_API_URL 未設定" });
  const url = `${base}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `無法連線至分析服務：${msg}` });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `分析服務回應錯誤 ${res.status}：${body.slice(0, 200)}` });
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────
// 路由定義
// ─────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  crypto: router({
    // ── 觸發分析（使用內建引擎，直接計算並快取）──
    triggerAnalysis: publicProcedure
      .input(z.object({ symbol: z.string().min(1).max(20).optional() }))
      .mutation(async ({ input }) => {
        const symbol = normalizeSymbol(input.symbol ?? "BTCUSDT");
        // In-flight dedup：若同一 symbol 已在分析中，直接回傳等待中
        if (!analysisInFlight.has(symbol)) {
          const p = (async () => {
            try {
              const result = await runAnalysis(symbol);
              setCacheWithLimit(snapshotCache, symbol, { data: result, ts: Date.now() });
              return result;
            } catch (e) {
              console.error(`[analysis] ${symbol} 分析失敗:`, e);
            } finally {
              analysisInFlight.delete(symbol);
            }
          })();
          analysisInFlight.set(symbol, p);
        }
        return { success: true, message: "分析已啟動，約 10 秒後完成", symbol };
      }),

    // ── 查詢分析狀態（快取命中即完成）──
    getAnalysisStatus: publicProcedure
      .input(z.object({ symbol: z.string().default("BTCUSDT") }))
      .query(async ({ input }) => {
        const symbol = input.symbol.toUpperCase();
        const cached = snapshotCache.get(symbol);
        const isReady = !!cached && (Date.now() - cached.ts < CACHE_TTL * 5);
        return { symbol, status: isReady ? "ready" : "pending", progress: isReady ? 100 : 0 };
      }),

    // ── 讀取最新快照（優先快取，快取過期則重新計算）──
    getSnapshot: publicProcedure
      .input(z.object({ symbol: z.string() }))
      .query(async ({ input }) => {
        const symbol = normalizeSymbol(input.symbol);
        const cached = snapshotCache.get(symbol);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          return cached.data;
        }
        // 快取不存在或過期：利用 in-flight dedup 避免重複計算
        if (analysisInFlight.has(symbol)) {
          await analysisInFlight.get(symbol);
          const fresh = snapshotCache.get(symbol);
          if (fresh) return fresh.data;
        }
        try {
          const result = await runAnalysis(symbol);
          setCacheWithLimit(snapshotCache, symbol, { data: result, ts: Date.now() });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (cached) {
            return { ...(cached.data as Snapshot), error: `分析已降級：${msg}` };
          }
          const fallback = await buildFallbackSnapshotFromLiveSignal(symbol, msg);
          if (fallback) {
            setCacheWithLimit(snapshotCache, symbol, { data: fallback, ts: Date.now() });
            return fallback;
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `分析計算失敗：${msg}` });
        }
      }),

    // ── 抓取 K 線資料（Kraken API，含分頁抓取）──
    getKlines: publicProcedure
      .input(
        z.object({
          symbol:    z.string(),
          timeframe: z.enum(["4h", "1h", "15m", "5m"]),
          limit:     z.number().int().min(1).max(500).default(150),
        })
      )
      .query(async ({ input }): Promise<Candle[]> => {
        // 使用 fetchCandles（已內建速率限制和快取）取代直接呼叫 Kraken API
        // 將 timeframe 對應到 fetchCandles 的 bar 格式
        const barMap: Record<string, string> = {
          "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H",
        };
        const bar = barMap[input.timeframe] ?? input.timeframe;
        try {
          const raw = await fetchCandles(input.symbol.toUpperCase(), bar, input.limit);
          const { data, error } = safeParseCandles(raw);
          if (error || !data) {
            console.warn(`[getKlines] K 線 Schema 驗證警告：${error}`);
            return raw as Candle[];
          }
          return data;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `K 線數據獲取失敗：${msg}` });
        }
      }),

    // ── 鏈上數據（HTTP GET → FastAPI /onchain/{symbol}）──
    getOnchain: publicProcedure
      .input(z.object({ symbol: z.string().default("BTCUSDT") }))
      .query(async ({ input }) => {
        const symbol = input.symbol.toUpperCase();
        try {
          return await callAnalysisApi<Record<string, unknown>>(`/onchain/${symbol}`);
        } catch (e) {
          console.warn(`[getOnchain] 無法取得 ${symbol} 鏈上數據：`, e);
          return {
            symbol,
            funding_rate:     { rate: 0, time: 0 },
            long_short_ratio: null,
            fear_greed:       null,
            open_interest:    null,
            coingecko:        null,
          };
        }
      }),

  }),

  // ── 新聞（RSS 抓取 + 情緒分析）──
  news: router({
    getLatestNews: publicProcedure
      .input(z.object({
        symbol: z.string().default("BTCUSDT"),
        hours:  z.number().int().min(1).max(72).default(6),
      }))
      .query(async ({ input }): Promise<NewsItem[]> => {
        const currency = input.symbol.replace("USDT", "").replace("BUSD", "");
        const cacheKey = `${currency}_${input.hours}`;
        const cachedNews = newsCache.get(cacheKey);
        if (cachedNews && Date.now() - cachedNews.ts < NEWS_CACHE_TTL) {
          return cachedNews.data as NewsItem[];
        }
        const since    = Date.now() - input.hours * 60 * 60 * 1000;

        const RSS_SOURCES = [
          { url: "https://cointelegraph.com/rss",              name: "CoinTelegraph" },
          { url: "https://decrypt.co/feed",                    name: "Decrypt" },
          { url: "https://feeds.feedburner.com/CoinDesk",      name: "CoinDesk" },
          { url: "https://bitcoinmagazine.com/.rss/full/",     name: "Bitcoin Magazine" },
          { url: "https://www.theblock.co/rss.xml",            name: "The Block" },
          { url: "https://cryptobriefing.com/feed/",           name: "Crypto Briefing" },
          { url: "https://ambcrypto.com/feed/",                name: "AMBCrypto" },
          { url: "https://cryptoslate.com/feed/",              name: "CryptoSlate" },
          { url: "https://beincrypto.com/feed/",               name: "BeInCrypto" },
          { url: "https://www.newsbtc.com/feed/",              name: "NewsBTC" },
        ];

        const symbolKeywords = [currency.toLowerCase()];
        if (currency === "BTC") symbolKeywords.push("bitcoin");
        if (currency === "ETH") symbolKeywords.push("ethereum", "ether");
        const generalKeywords = ["crypto", "blockchain", "bitcoin", "btc", "ethereum", "eth"];

        const fetchRss = async (source: { url: string; name: string }) => {
          try {
            const res = await fetch(source.url, {
              signal: AbortSignal.timeout(8_000),
              headers: { "User-Agent": "Mozilla/5.0 CryptoDashboard/2.0" },
            });
            if (!res.ok) return [];
            const xml    = await res.text();
            const parsed = await parseStringPromise(xml, { explicitArray: false });
            const items  = parsed?.rss?.channel?.item ?? [];
            const arr    = Array.isArray(items) ? items : [items];

            return arr
              .map((item: Record<string, unknown>) => {
                const title      = String(
                  (item.title as Record<string, string>)?._ ?? item.title ?? ""
                ).trim();
                const link       = String(
                  (item.link as string)?.trim() ??
                  (item.guid as Record<string, string>)?._ ??
                  item.guid ?? ""
                );
                const desc       = String(
                  (item.description as Record<string, string>)?._ ??
                  item.description ?? ""
                ).trim();
                const pubDateStr = String(
                  item.pubDate ?? (item as Record<string, string>)["dc:date"] ?? ""
                );
                const pubDate    = pubDateStr ? new Date(pubDateStr).getTime() : 0;
                return {
                  title,
                  link,
                  description: desc.replace(/<[^>]+>/g, "").slice(0, 200),
                  pubDate,
                  source: source.name,
                };
              })
              .filter((item) => {
                if (!item.title || !item.pubDate || item.pubDate < since) return false;
                const text = (item.title + " " + item.description).toLowerCase();
                return symbolKeywords.some((k) => text.includes(k)) ||
                       generalKeywords.some((k) => text.includes(k));
              });
          } catch {
            return [];
          }
        };

        const results = await Promise.allSettled(RSS_SOURCES.map(fetchRss));
        const allNews = results
          .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
          .sort((a, b) => b.pubDate - a.pubDate)
          .slice(0, 40);

        // ★ 升級：用 LLM 批次分析新聞情緒（取代關鍵字比對）
        let withSentiment: NewsItem[];
        try {
          const titlesForLLM = allNews.slice(0, 20).map((item, idx) =>
            `${idx + 1}. ${item.title}`
          ).join("\n");

          const sentimentPrompt = `You are a crypto market sentiment analyst. Analyze the sentiment of each news headline below.
For each headline, respond with ONLY the index number and sentiment label (bullish/bearish/neutral), one per line.
Format: "1: bullish" or "2: bearish" or "3: neutral"

Headlines:
${titlesForLLM}

Respond with ONLY the numbered sentiment labels, nothing else.`;

          const llmResp = await invokeLLM({
            messages: [
              { role: "system", content: "You are a crypto market sentiment analyst. Respond with ONLY numbered sentiment labels." },
              { role: "user", content: sentimentPrompt }
            ],
            maxTokens: 200,
          });

          // 解析 LLM 回應
          const sentimentMap = new Map<number, "bullish" | "bearish" | "neutral">();
          const llmText = typeof llmResp.choices[0]?.message?.content === "string" 
            ? llmResp.choices[0].message.content 
            : "";
          const lines = llmText.split("\n").filter((l: string) => l.trim());
          for (const line of lines as string[]) {
            const match = line.match(/^(\d+):\s*(bullish|bearish|neutral)/i);
            if (match) {
              const idx = parseInt(match[1]) - 1;
              const sent = match[2].toLowerCase() as "bullish" | "bearish" | "neutral";
              sentimentMap.set(idx, sent);
            }
          }

          withSentiment = allNews.map((item, idx) => {
            const llmSentiment = sentimentMap.get(idx);
            if (llmSentiment) return { ...item, sentiment: llmSentiment } as NewsItem;
            // 超出 LLM 分析範圍的新聞，用简單關鍵字備用
            const text = (item.title + " " + item.description).toLowerCase();
            const bull = ["surge","rally","gain","rise","bull","breakout","buy","boost","soar"].filter(w => text.includes(w)).length;
            const bear = ["drop","fall","crash","bear","sell","decline","plunge","dump","warn"].filter(w => text.includes(w)).length;
            return { ...item, sentiment: bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral" } as NewsItem;
          });
          console.log(`[getLatestNews] LLM 情緒分析完成：${sentimentMap.size} 條新聞已分析`);
        } catch (llmErr) {
          console.warn(`[getLatestNews] LLM 情緒分析失敗，備用關鍵字比對:`, llmErr);
          // Fallback 到關鍵字比對
          withSentiment = allNews.map((item) => {
            const text = (item.title + " " + item.description).toLowerCase();
            const bull = ["surge","rally","gain","rise","bull","breakout","buy","boost","soar"].filter(w => text.includes(w)).length;
            const bear = ["drop","fall","crash","bear","sell","decline","plunge","dump","warn"].filter(w => text.includes(w)).length;
            return { ...item, sentiment: bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral" } as NewsItem;
          });
        }

        const { data, error } = safeParseNews(withSentiment);
        const finalNews = (error || !data) ? withSentiment : data;
        if (error) console.warn(`[getLatestNews] Schema 驗證警告：${error}`);
        // 寫入快取
        newsCache.set(cacheKey, { data: finalNews, ts: Date.now() });
        return finalNews as NewsItem[];
      }),
  }),

  // ── Twitter 推文（透過 LLM 根據最新新聞生成加密貨幣 KOL 風格推文）──
  tweets: router({
    getLatestTweets: publicProcedure
      .input(z.object({
        symbol: z.string().default("BTCUSDT"),
        count:  z.number().int().min(5).max(30).default(15),
      }))
      .query(async ({ input }): Promise<TweetItem[]> => {
        const currency = input.symbol.replace("USDT", "").replace("BUSD", "");
        // 推文快取檢查
        const tweetCacheKey = `${currency}_${input.count}`;
        const cachedTweet = tweetCache.get(tweetCacheKey);
        if (cachedTweet && Date.now() - cachedTweet.ts < TWEET_CACHE_TTL) {
          return cachedTweet.data as TweetItem[];
        }
        const coinName = currency === "BTC" ? "Bitcoin"
          : currency === "ETH" ? "Ethereum"
          : currency === "SOL" ? "Solana"
          : currency === "BNB" ? "BNB"
          : currency === "XRP" ? "XRP"
          : currency;

        // 先從 RSS 拓取最新新聞標題作為背景資訊
        let newsContext = "";
        try {
          const rssRes = await fetch("https://cointelegraph.com/rss", {
            signal: AbortSignal.timeout(6_000),
            headers: { "User-Agent": "Mozilla/5.0 CryptoDashboard/2.0" },
          });
          if (rssRes.ok) {
            const xml = await rssRes.text();
            const parsed = await parseStringPromise(xml, { explicitArray: false });
            const items = parsed?.rss?.channel?.item ?? [];
            const arr = Array.isArray(items) ? items : [items];
            const headlines = arr
              .slice(0, 8)
              .map((item: Record<string, unknown>) =>
                String((item.title as Record<string, string>)?._ ?? item.title ?? "").trim()
              )
              .filter(Boolean)
              .join("\n- ");
            if (headlines) newsContext = `\n\nCurrent crypto market headlines:\n- ${headlines}`;
          }
        } catch {
          // 若無法拓取新聞，使用空背景
        }

        const CRYPTO_KOLS = [
          { author: "CZ Binance",        handle: "cz_binance",      avatar: "🐳" },
          { author: "Vitalik Buterin",   handle: "VitalikButerin",  avatar: "🦄" },
          { author: "Michael Saylor",    handle: "saylor",          avatar: "💼" },
          { author: "Cathie Wood",       handle: "CathieDWood",     avatar: "🚀" },
          { author: "Willy Woo",         handle: "woonomic",        avatar: "📈" },
          { author: "PlanB",             handle: "100trillionUSD",  avatar: "💯" },
          { author: "Raoul Pal",         handle: "RaoulGMI",        avatar: "🌍" },
          { author: "Arthur Hayes",      handle: "CryptoHayes",     avatar: "💰" },
          { author: "Lyn Alden",         handle: "LynAldenContact", avatar: "📊" },
          { author: "Crypto Rover",      handle: "rovercrc",        avatar: "🤖" },
          { author: "Pentoshi",          handle: "Pentosh1",        avatar: "🐧" },
          { author: "Credible Crypto",   handle: "CredibleCrypto",  avatar: "🔮" },
          { author: "Altcoin Daily",     handle: "AltcoinDailyio",  avatar: "⚡" },
          { author: "Coin Bureau",       handle: "coinbureau",      avatar: "🎥" },
          { author: "Scott Melker",      handle: "scottmelker",     avatar: "📰" },
        ];

        const nowMs = Date.now();
        const sixHoursAgo = nowMs - 6 * 3600000;

        const prompt = `You are a crypto market analyst. Generate ${input.count} realistic-style crypto Twitter posts about ${coinName} (${currency}).${newsContext}\n\nReturn ONLY valid JSON in this exact format, no markdown, no extra text:\n{"tweets":[{"id":"t001","author":"Author Name","handle":"twitterhandle","avatar":"single emoji","content":"tweet content 100-280 chars with hashtags, price levels, market analysis","pubDate":${sixHoursAgo},"likes":1000,"retweets":100,"sentiment":"bullish"}]}\n\nRules:\n1. Authors must be from: ${CRYPTO_KOLS.map(k => `${k.author}(@${k.handle})`).join(", ")}\n2. Each tweet must have unique style and perspective\n3. Include specific price levels, technical analysis, or market sentiment\n4. Mix bullish/bearish/neutral sentiments realistically\n5. pubDate must be Unix timestamp in milliseconds between ${sixHoursAgo} and ${nowMs}\n6. likes between 1000-50000, retweets between 100-5000\n7. Generate exactly ${input.count} tweets`;

        try {
          const result = await invokeLLM({
            messages: [{ role: "user", content: prompt }],
            maxTokens: 4096,
          });
          const rawContent = result.choices[0]?.message?.content;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = typeof rawContent === "string"
            ? rawContent
            : Array.isArray(rawContent)
              ? (rawContent as any[]).filter((c: any) => c.type === "text").map((c: any) => c.text as string).join("")
              : "";
          // 提取 JSON（跳過 <think> 標籤）
          const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error("LLM 未回傳 JSON");
          const parsed = JSON.parse(jsonMatch[0]) as { tweets: unknown[] };
          const rawTweets = (parsed.tweets ?? []).map((t: unknown) => ({
            ...(t as Record<string, unknown>),
            isAI: true,
          }));
          const { data, error } = safeParseTweets(rawTweets);
          const finalTweets = (error || !data) ? rawTweets as TweetItem[] : data;
          if (error) console.warn(`[getLatestTweets] Schema 驗證警告：${error}`);

          // ★ 更新情緒快取（供 analysis.ts 使用）—使用統一的 serverCache 取代 global 反模式
          try {
            const bullishCount = finalTweets.filter((t: TweetItem) => t.sentiment === "bullish").length;
            const bearishCount = finalTweets.filter((t: TweetItem) => t.sentiment === "bearish").length;
            const neutralCount = finalTweets.filter((t: TweetItem) => t.sentiment === "neutral").length;
            const total = finalTweets.length || 1;
            const bullishPct = Math.round((bullishCount / total) * 100);
            const bearishPct = Math.round((bearishCount / total) * 100);
            const neutralPct = Math.max(0, 100 - bullishPct - bearishPct);
            const score = parseFloat(((bullishPct - bearishPct) / 100).toFixed(2));
            const label = score > 0.2 ? "社群偏多" : score < -0.2 ? "社群偏空" : "社群中性";
            const cacheKey = tweetSentimentKey(input.symbol);
            serverCache.set(cacheKey, {
              bullish_pct: bullishPct,
              bearish_pct: bearishPct,
              neutral_pct: neutralPct,
              score,
              label,
              updated_at: Date.now(),
            }, 30 * 60 * 1000); // 30 分鐘 TTL
            console.log(`[getLatestTweets] 情緒快取已更新: ${cacheKey} = ${label} (score=${score})`);
          } catch (cacheErr) {
            console.warn(`[getLatestTweets] 快取更新失敗:`, cacheErr);
          }

          // 寫入推文快取
          tweetCache.set(tweetCacheKey, { data: finalTweets, ts: Date.now() });
          return finalTweets;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[getLatestTweets] LLM 生成失敗：${msg}`);
          return [];
        }
      }),
  }),

  // ── 回測（本地引擎，無需 FastAPI）──
  backtest: router({
    run: publicProcedure
      .input(z.object({
        symbol:               z.string().default("BTCUSDT"),
        interval:             z.string().default("4H"),
        strategy:             z.enum(["ema_cross", "rsi_reversal", "bollinger", "macd", "smc", "pa", "chan", "liquidity_sweep", "vwap_reversion", "composite", "cannonball", "hwr_model_a", "hwr_model_b", "hwr_model_c"]).default("ema_cross"),
        limit:                z.number().int().min(50).max(8760).default(1080),  // v5.9: 支援最多一年 1H K 線
        atr_sl_mult:          z.number().min(0.5).max(5).default(1.5),
        atr_tp_mult:          z.number().min(0.5).max(10).default(3.0),
        enable_mtf_filter:    z.boolean().default(true),
        enable_fee:           z.boolean().default(true),
        enable_trailing_stop: z.boolean().default(true),
        enable_adx_filter:    z.boolean().default(true),
        enable_fvg_ob_filter: z.boolean().default(false),
        // v3.0 真正雙時間框架回測
        use_true_mtf:         z.boolean().default(false),
        htf_interval:         z.string().optional(),   // 高級別時間框架（定方向）
        entry_interval:       z.string().optional(),   // 進場級別時間框架（找進場）
        // v4.0 四層 MTF 共識
        use_quad_mtf:         z.boolean().default(false),
        quad_mtf_threshold:   z.number().min(0.1).max(1.0).default(0.5),
      }))
      .mutation(async ({ input }) => {
        const normalizeBar = (iv: string) => iv.toLowerCase() === "1d" ? "1D"
          : iv.toLowerCase() === "4h" ? "4H"
          : iv.toLowerCase() === "1h" ? "1H"
          : iv.toLowerCase() === "15m" ? "15m"
          : iv.toLowerCase() === "5m" ? "5m" : iv;
        const bar = normalizeBar(input.interval);
        const sym = input.symbol.includes("-") ? input.symbol.replace("-", "") : input.symbol;

        // v3.0 真正雙時間框架回測
        let htfCandles: Candle[] | undefined;
        let entryCandles: Candle[] | undefined;
        let mtfCandles: Candle[] | undefined;

        // v4.0 四層 MTF 共識模式：並行抓取 4H/1H/15m/5m 四個時間框架
        let quad4hCandles:  Candle[] | undefined;
        let quad1hCandles:  Candle[] | undefined;
        let quad15mCandles: Candle[] | undefined;
        let quad5mCandles:  Candle[] | undefined;

        if (input.use_quad_mtf) {
          try {
            const [d4h, d1h, d15m, d5m] = await Promise.all([
              fetchCandles(sym, "4H",  500).catch(() => [] as Candle[]),
              fetchCandles(sym, "1H",  500).catch(() => [] as Candle[]),
              fetchCandlesPaged(sym, "15m", input.limit * 4).catch(() => [] as Candle[]),
              fetchCandlesPaged(sym, "5m",  input.limit * 12).catch(() => [] as Candle[]),
            ]);
            quad4hCandles  = d4h.length  >= 50 ? d4h  : undefined;
            quad1hCandles  = d1h.length  >= 50 ? d1h  : undefined;
            quad15mCandles = d15m.length >= 50 ? d15m : undefined;
            quad5mCandles  = d5m.length  >= 50 ? d5m  : undefined;
          } catch { /* 抓取失敗降級為單時間框架 */ }
        } else if (input.use_true_mtf) {
          // 真正 MTF 模式：分別抓取 HTF（定方向）和 entry（找進場）的 K 線
          // 自動測算預設雙時間框架：如果使用者沒指定，則依策略自動選擇
          const htfBarMap: Record<string, string> = { "5m": "1H", "15m": "1H", "1H": "4H", "4H": "1D", "1D": "1W" };
          const entryBarMap: Record<string, string> = { "1H": "15m", "4H": "1H", "1D": "4H" };
          // HWR 模型特殊處理：依模型設計自動選擇時間框架
          const hwrHtfMap: Record<string, string> = {
            "hwr_model_a": "1H", "hwr_model_b": "4H", "hwr_model_c": "1H"
          };
          const hwrEntryMap: Record<string, string> = {
            "hwr_model_a": "15m", "hwr_model_b": "1H", "hwr_model_c": "15m"
          };
          const isHwr = ["hwr_model_a", "hwr_model_b", "hwr_model_c"].includes(input.strategy);
          const htfBar = input.htf_interval
            ? normalizeBar(input.htf_interval)
            : isHwr ? hwrHtfMap[input.strategy] : htfBarMap[bar] ?? "4H";
          const entryBar = input.entry_interval
            ? normalizeBar(input.entry_interval)
            : isHwr ? hwrEntryMap[input.strategy] : entryBarMap[bar] ?? bar;
          try {
            const [htfData, entryData] = await Promise.all([
              fetchCandles(sym, htfBar, 500),
              entryBar !== bar ? fetchCandlesPaged(sym, entryBar, input.limit) : Promise.resolve(null),
            ]);
            htfCandles = htfData;
            entryCandles = entryData ?? undefined;
          } catch { /* 如果抓取失敗，降級為單時間框架回測 */ }
        } else {
          // 原有 MTF 過濾模式
          if (input.enable_mtf_filter) {
            const mtfBarMap: Record<string, string> = { "4H": "1D", "1H": "4H", "15m": "1H", "5m": "15m" };
            const mtfBar = mtfBarMap[bar];
            if (mtfBar) {
              try { mtfCandles = await fetchCandles(sym, mtfBar, 300); } catch { /* 忽略錯誤，降頻計算 */ }
            }
          }
        }

        // 主要 K 線：真正 MTF 模式下用 entryCandles，否則用主時間框架
        const mainCandles = (input.use_true_mtf && entryCandles && entryCandles.length >= 50)
          ? entryCandles
          : (input.limit > 300 ? await fetchCandlesPaged(sym, bar, input.limit) : await fetchCandles(sym, bar, input.limit));
        if (mainCandles.length < 50) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `K 線資料不足（${mainCandles.length} 根），請降低數量或更換時間框架` });
        }
        const btResult = runBacktest({
          candles:              mainCandles,
          strategy:             input.strategy as BacktestStrategy,
          symbol:               sym,
          interval:             input.use_true_mtf && input.entry_interval ? normalizeBar(input.entry_interval) : bar,
          atr_sl_mult:          input.atr_sl_mult,
          atr_tp_mult:          input.atr_tp_mult,
          enable_mtf_filter:    input.enable_mtf_filter,
          enable_fee:           input.enable_fee,
          enable_trailing_stop: input.enable_trailing_stop,
          enable_adx_filter:    input.enable_adx_filter,
          enable_fvg_ob_filter: input.enable_fvg_ob_filter,
          mtf_candles:          mtfCandles,
          htf_candles:          htfCandles,
          entry_candles:        entryCandles,
          use_true_mtf:         input.use_true_mtf,
          // v4.0 四層 MTF 共識
          candles_4h:           quad4hCandles,
          candles_1h:           quad1hCandles,
          candles_15m:          quad15mCandles,
          candles_5m:           quad5mCandles,
          use_quad_mtf:         input.use_quad_mtf,
          quad_mtf_threshold:   input.quad_mtf_threshold,
        });
        const monteCarlo = btResult.trades.length >= 10
          ? runMonteCarlo(btResult.trades, 3000)
          : null;
        return { ...btResult, monte_carlo: monteCarlo };
      }),

    compare: publicProcedure
      .input(z.object({
        symbol:               z.string().default("BTCUSDT"),
        interval:             z.string().default("4H"),
        limit:                z.number().int().min(50).max(35040).default(1080), // v5.8: 支援最多 1 年 15m K 線
        atr_sl_mult:          z.number().min(0.5).max(5).default(1.5),
        atr_tp_mult:          z.number().min(0.5).max(10).default(3.0),
        enable_mtf_filter:    z.boolean().default(true),
        enable_fee:           z.boolean().default(true),
        enable_trailing_stop: z.boolean().default(true),
        enable_adx_filter:    z.boolean().default(true),
        // v3.0 真正雙時間框架回測
        use_true_mtf:         z.boolean().default(false),
        // v4.0 四層 MTF 共識
        use_quad_mtf:         z.boolean().default(false),
        quad_mtf_threshold:   z.number().min(0.1).max(1.0).default(0.5),
        // v5.9 三層 MTF（4H+1H+15m）
        use_triple_mtf:       z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const normalizeBar = (iv: string) => iv.toLowerCase() === "1d" ? "1D"
          : iv.toLowerCase() === "4h" ? "4H"
          : iv.toLowerCase() === "1h" ? "1H"
          : iv.toLowerCase() === "15m" ? "15m"
          : iv.toLowerCase() === "5m" ? "5m" : iv;
        const bar = normalizeBar(input.interval);
        const sym = input.symbol.includes("-") ? input.symbol.replace("-", "") : input.symbol;
        const strategies: BacktestStrategy[] = ["ema_cross", "rsi_reversal", "bollinger", "macd", "smc", "pa", "chan", "liquidity_sweep", "vwap_reversion", "composite", "cannonball", "hwr_model_a", "hwr_model_b", "hwr_model_c"];

        if (input.use_triple_mtf) {
          // v5.9 方案 A — 策略分組 MTF：
          //   趨勢跟蹤策略（pa / ema_cross / macd / hwr* / rsi_reversal / smc / liquidity_sweep）
          //     → 雙層 MTF（4H+15m），保留最多有效趨勢信號
          //   反趨勢 / 震盪策略（bollinger / chan / vwap_reversion / composite）
          //     → 三層 MTF（4H+1H+15m），加強方向確認、降低誤信號
          const DUAL_MTF_STRATEGIES  = new Set(["pa", "ema_cross", "macd", "hwr_model_a", "hwr_model_b", "hwr_model_c", "cannonball", "rsi_reversal", "smc", "liquidity_sweep"]);
          const TRIPLE_MTF_STRATEGIES = new Set(["bollinger", "chan", "vwap_reversion", "composite"]);

          const [d4h, d1h, d15m] = await Promise.all([
            fetchCandles(sym, "4H",  500).catch(() => [] as Candle[]),
            fetchCandles(sym, "1H",  500).catch(() => [] as Candle[]),
            fetchCandlesPaged(sym, "15m", Math.max(input.limit, 2160)).catch(() => [] as Candle[]),
          ]);
          const t4h  = d4h.length  >= 50 ? d4h  : undefined;
          const t1h  = d1h.length  >= 50 ? d1h  : undefined;
          const t15m = d15m.length >= 50 ? d15m : undefined;
          const primaryData = t15m ?? ([] as Candle[]);

          const tripleResults = strategies.map(s => {
            if (primaryData.length < 50) return { strategy: s, symbol: sym, interval: "15m", total_trades: 0, win_rate: 0, profit_factor: 0, max_drawdown: 0, total_return: 0, total_return_net: 0, sharpe_ratio: 0, equity_curve: [1], trades: [], mtf_filtered_count: 0, total_fees_pct: 0, trailing_stop_count: 0, adx_filtered_count: 0, fvg_ob_entry_count: 0 };
            // 雙層 MTF：僅傳入 4H，不傳入 1H
            const use1H = TRIPLE_MTF_STRATEGIES.has(s);
            return runBacktest({
              candles: primaryData,
              strategy: s, symbol: sym, interval: "15m",
              atr_sl_mult: input.atr_sl_mult, atr_tp_mult: input.atr_tp_mult,
              enable_mtf_filter: true, enable_fee: input.enable_fee,
              enable_trailing_stop: input.enable_trailing_stop, enable_adx_filter: input.enable_adx_filter,
              candles_4h: t4h,
              candles_1h: use1H ? t1h : undefined,  // 反趨勢策略才加入 1H 中間層
              htf_candles: t4h,
              use_true_mtf: true,
            });
          });
          return tripleResults;
        } else if (input.use_quad_mtf) {
          // v4.0 四層 MTF 共識模式：並行抓取 4H/1H/15m/5m 四個時間框架
          // 進場級別固定為 15m，上方三層提供共識方向過濾
          const [d4h, d1h, d15m, d5m] = await Promise.all([
            fetchCandles(sym, "4H",  500).catch(() => [] as Candle[]),
            fetchCandles(sym, "1H",  500).catch(() => [] as Candle[]),
            fetchCandlesPaged(sym, "15m", Math.max(input.limit * 4, 2000)).catch(() => [] as Candle[]),
            fetchCandlesPaged(sym, "5m",  Math.max(input.limit * 12, 4000)).catch(() => [] as Candle[]),
          ]);
          const q4h  = d4h.length  >= 50 ? d4h  : undefined;
          const q1h  = d1h.length  >= 50 ? d1h  : undefined;
          const q15m = d15m.length >= 50 ? d15m : undefined;
          const q5m  = d5m.length  >= 50 ? d5m  : undefined;
          const primaryData = q15m ?? ([] as Candle[]);

          const results = strategies.map(s => {
            if (primaryData.length < 50) return { strategy: s, symbol: sym, interval: "15m", total_trades: 0, win_rate: 0, profit_factor: 0, max_drawdown: 0, total_return: 0, total_return_net: 0, sharpe_ratio: 0, equity_curve: [1], trades: [], mtf_filtered_count: 0, total_fees_pct: 0, trailing_stop_count: 0, adx_filtered_count: 0, fvg_ob_entry_count: 0 };
            return runBacktest({
              candles: primaryData,
              strategy: s, symbol: sym, interval: "15m",
              atr_sl_mult: input.atr_sl_mult, atr_tp_mult: input.atr_tp_mult,
              enable_mtf_filter: input.enable_mtf_filter, enable_fee: input.enable_fee,
              enable_trailing_stop: input.enable_trailing_stop, enable_adx_filter: input.enable_adx_filter,
              candles_4h: q4h, candles_1h: q1h, candles_15m: q15m, candles_5m: q5m,
              use_quad_mtf: true,
              quad_mtf_threshold: input.quad_mtf_threshold,
            });
          });
          return results;
        } else if (input.use_true_mtf) {
          // v3.0 真正 MTF 模式：統一使用 4H 定方向 + 15m 進場（使用者指定標準）
          // 所有策略一律：HTF = 4H（定趨勢方向），entry = 15m（找精確進場點）
          const FIXED_HTF = "4H";
          const FIXED_ENTRY = "15m";

          // 並行抓取 4H 和 15m K 線
          const [htfData, entryData] = await Promise.all([
            fetchCandles(sym, FIXED_HTF, 500).catch(() => [] as Candle[]),
            fetchCandlesPaged(sym, FIXED_ENTRY, input.limit * 16).catch(() => [] as Candle[]), // 15m 是 4H 的 16 倍
          ]);

          const results = strategies.map(s => {
            if (entryData.length < 50) return { strategy: s, symbol: sym, interval: FIXED_ENTRY, total_trades: 0, win_rate: 0, profit_factor: 0, max_drawdown: 0, total_return: 0, total_return_net: 0, sharpe_ratio: 0, equity_curve: [1], trades: [], mtf_filtered_count: 0, total_fees_pct: 0, trailing_stop_count: 0, adx_filtered_count: 0, fvg_ob_entry_count: 0 };
            return runBacktest({
              candles: entryData,
              strategy: s, symbol: sym, interval: FIXED_ENTRY,
              atr_sl_mult: input.atr_sl_mult, atr_tp_mult: input.atr_tp_mult,
              enable_mtf_filter: input.enable_mtf_filter, enable_fee: input.enable_fee,
              enable_trailing_stop: input.enable_trailing_stop, enable_adx_filter: input.enable_adx_filter,
              htf_candles: htfData.length > 0 ? htfData : undefined,
              use_true_mtf: true,
            });
          });
          return results;
        } else {
          // 原有單時間框架模式
          const candles = input.limit > 300
            ? await fetchCandlesPaged(sym, bar, input.limit)
            : await fetchCandles(sym, bar, input.limit);
          let mtfCandles: Candle[] | undefined;
          if (input.enable_mtf_filter) {
            const mtfBarMap: Record<string, string> = { "4H": "1D", "1H": "4H", "15m": "1H", "5m": "15m" };
            const mtfBar = mtfBarMap[bar];
            if (mtfBar) {
              try { mtfCandles = await fetchCandles(sym, mtfBar, 300); } catch { /* 忽略 */ }
            }
          }
          return strategies.map(s => runBacktest({
            candles, strategy: s, symbol: sym, interval: bar,
            atr_sl_mult: input.atr_sl_mult, atr_tp_mult: input.atr_tp_mult,
            enable_mtf_filter: input.enable_mtf_filter, enable_fee: input.enable_fee,
            enable_trailing_stop: input.enable_trailing_stop, enable_adx_filter: input.enable_adx_filter,
            mtf_candles: mtfCandles,
          }));
        }
      }),

    history: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(10) }))
      .query(async ({ input }) => {
        void input;
        return [] as unknown[];
      }),

    // ★ Walk-Forward 驗證（Opus 4.6 建議）
    walkForward: publicProcedure
      .input(z.object({
        symbol:               z.string().default("BTCUSDT"),
        interval:             z.string().default("4H"),
        // Bug Fix: 补齊 liquidity_sweep 和 vwap_reversion
        strategy:             z.enum(["ema_cross", "rsi_reversal", "bollinger", "macd", "smc", "pa", "chan", "liquidity_sweep", "vwap_reversion", "composite", "cannonball", "hwr_model_a", "hwr_model_b", "hwr_model_c"]).default("ema_cross"),
        limit:                z.number().int().min(200).max(4320).default(1080),
        is_ratio:             z.number().min(0.5).max(0.85).default(0.7),
        atr_sl_mult:          z.number().min(0.5).max(5).default(1.5),
        atr_tp_mult:          z.number().min(0.5).max(10).default(3.0),
        enable_mtf_filter:    z.boolean().default(true),
        enable_fee:           z.boolean().default(true),
        enable_trailing_stop: z.boolean().default(true),
        enable_adx_filter:    z.boolean().default(true),
        enable_fvg_ob_filter: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const bar = input.interval.toLowerCase() === "1d" ? "1D"
          : input.interval.toLowerCase() === "4h" ? "4H"
          : input.interval.toLowerCase() === "1h" ? "1H"
          : input.interval.toLowerCase() === "15m" ? "15m"
          : input.interval.toLowerCase() === "5m" ? "5m"
          : input.interval;
        const sym = input.symbol.includes("-") ? input.symbol.replace("-", "") : input.symbol;
        const candles = input.limit > 300
          ? await fetchCandlesPaged(sym, bar, input.limit)
          : await fetchCandles(sym, bar, input.limit);
        if (candles.length < 200) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `K 線資料不足（${candles.length} 根），Walk-Forward 需要至少 200 根` });
        }
        return runWalkForwardBacktest(
          sym,
          input.strategy as BacktestStrategy,
          bar,
          candles,
          input.is_ratio,
          {
            atr_sl_mult:          input.atr_sl_mult,
            atr_tp_mult:          input.atr_tp_mult,
            enable_mtf_filter:    input.enable_mtf_filter,
            enable_fee:           input.enable_fee,
            enable_trailing_stop: input.enable_trailing_stop,
            enable_adx_filter:    input.enable_adx_filter,
            enable_fvg_ob_filter: input.enable_fvg_ob_filter,
          }
        );
      }),
  }),

  // ── 高勝率策略掃描 v2.0（全面改良版）──
  highWinRate: router({
    scan: publicProcedure
      .input(z.object({
        symbol: z.string().default("BTCUSDT"),
        engine: z.enum(["opus", "codex", "local"]).default("codex"),
      }))
      .mutation(async ({ input }) => {
        const { runHighWinRateScan } = await import("./services/highWinRateService.js");
        const { fetchCandles: fc } = await import("./analysis.js");
        const analysisModule = await import("./analysis.js");
        const sym = input.symbol.includes("-") ? input.symbol.replace("-", "") : input.symbol;
        const engine = input.engine ?? "local";
        void analysisModule; // suppress unused warning

        // ─── 根據 engine 選擇 LLM ───
        const highWinRateLLM = async (opts: { messages: { role: string; content: string }[]; maxTokens?: number }) => {
          // local 引擎：直接回傳標記，由 highWinRateService 本地規則引擎處理
          if (engine === "local") {
            return { choices: [{ message: { content: "__LOCAL_ENGINE__" } }] };
          }

          let endpoint: string;
          let apiKey: string;
          let model: string;

          if (engine === "opus") {
            // 使用 gemini-2.5-flash（透過現有 OpenAI 相容 API）
            const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
            apiKey  = process.env.OPENAI_API_KEY ?? "";
            model   = "gemini-2.5-flash";
            endpoint = `${baseUrl}/chat/completions`;
          } else {
            // codex — soxio gpt-5.4（stream=true 必須）
            apiKey  = process.env.SOXIO_API_KEY ?? "";
            model   = "gpt-5.4";
            endpoint = "https://apikey.soxio.me/openai/v1/chat/completions";
          }

          // soxio (codex) 必須使用 stream=true，需特殊解析 SSE
          if (engine === "codex") {
            const soxioResp = await fetch(endpoint, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model,
                messages: opts.messages,
                max_tokens: opts.maxTokens ?? 2800,
                stream: true,
              }),
              signal: AbortSignal.timeout(120000),
            });
            if (!soxioResp.ok) {
              const errText = await soxioResp.text();
              throw new Error(`[codex] soxio API failed: ${soxioResp.status} – ${errText.slice(0, 200)}`);
            }
            // 解析 SSE 串流，累積 content delta
            const rawText = await soxioResp.text();
            let fullContent = "";
            for (const line of rawText.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const jsonStr = line.slice(6).trim();
              if (jsonStr === "[DONE]") break;
              try {
                const chunk = JSON.parse(jsonStr) as { choices?: Array<{ delta?: { content?: string } }> };
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) fullContent += delta;
              } catch { /* 忽略解析錯誤 */ }
            }
            if (!fullContent) throw new Error("[codex] soxio: empty response");
            // 包裝成標準 OpenAI 格式回傳
            return { choices: [{ message: { content: fullContent } }] };
          }

          const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: opts.messages,
              max_tokens: opts.maxTokens ?? 2800,
            }),
            signal: AbortSignal.timeout(120000),
          });
          if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`[${engine}] LLM failed: ${resp.status} ${resp.statusText} – ${errText.slice(0, 200)}`);
          }
          return resp.json() as Promise<{ choices: Array<{ message: { content: string } }> }>;
        };

        // ─── 呼叫全面改良版服務層 ───
        return await runHighWinRateScan(sym, fc, highWinRateLLM, engine);
      }),
  }),
    // ── 多幣種篩選器（Screener）──
  screener: router({
    scanAll: publicProcedure
      .input(z.object({ timeframe: z.enum(["1H", "4H", "1D"]).default("1H") }))
      .query(async ({ input }) => {
        const SYMBOLS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","DOTUSDT","LINKUSDT"];
        const bar = input.timeframe;
        // 使用頂部共用函數（P3 改良）
        const emaArr = sharedEmaArr;
        const rsiLast = sharedRsiLast;
        const macdHistLast = sharedMacdHistLast;
        const adxLast = sharedAdxLast;
        const bollingerLast = sharedBollingerLast;
        function detectSmcStr(candles: Candle[],close: number,ema50: number): string {
          const recent=candles.slice(-30); let h=0,l=0;
          for (let i=1;i<recent.length-1;i++) {
            if(recent[i].high>recent[i-1].high&&recent[i].high>recent[i+1].high) h++;
            if(recent[i].low<recent[i-1].low&&recent[i].low<recent[i+1].low) l++;
          }
          if(close>ema50&&h>l) return "bullish"; if(close<ema50&&l>h) return "bearish"; return "ranging";
        }
        function detectLiqSweep(candles: Candle[],close: number) {
          const sl=candles.slice(-50); const highs: number[]=[],lows: number[]=[];
          for (let i=4;i<sl.length-4;i++) {
            if(sl.slice(i-4,i).every(c=>c.high<=sl[i].high)&&sl.slice(i+1,i+5).every(c=>c.high<=sl[i].high)) highs.push(sl[i].high);
            if(sl.slice(i-4,i).every(c=>c.low>=sl[i].low)&&sl.slice(i+1,i+5).every(c=>c.low>=sl[i].low)) lows.push(sl[i].low);
          }
          const r5=candles.slice(-5);
          return { bslSwept:highs.slice(-3).some(h=>r5.some(c=>c.high>h)&&close<h), sslSwept:lows.slice(-3).some(l=>r5.some(c=>c.low<l)&&close>l) };
        }
        function calcChanTrend(candles: Candle[]): "bullish"|"bearish"|"ranging" {
          const frac: {idx:number;type:"top"|"bottom";price:number}[]=[];
          for (let i=1;i<candles.length-1;i++) {
            const p=candles[i-1],c=candles[i],n=candles[i+1];
            if(c.high>p.high&&c.high>n.high) frac.push({idx:i,type:"top",price:c.high});
            else if(c.low<p.low&&c.low<n.low) frac.push({idx:i,type:"bottom",price:c.low});
          }
          const merged: typeof frac=[];
          for (const f of frac) {
            const last=merged[merged.length-1];
            if(last&&last.type===f.type) { if(f.type==="top"&&f.price>last.price)merged[merged.length-1]=f; else if(f.type==="bottom"&&f.price<last.price)merged[merged.length-1]=f; }
            else merged.push(f);
          }
          const bis: {direction:"up"|"down";start:number;end:number}[]=[];
          for (let i=0;i<merged.length-1;i++) {
            const a=merged[i],b=merged[i+1];
            if(b.idx-a.idx<4) continue;
            if(a.type==="bottom"&&b.type==="top") bis.push({direction:"up",start:a.price,end:b.price});
            else if(a.type==="top"&&b.type==="bottom") bis.push({direction:"down",start:a.price,end:b.price});
          }
          if(bis.length<2) return "ranging";
          const last=bis[bis.length-1],prev=bis[bis.length-3]??bis[0];
          if(last.direction==="up"&&last.end>prev.end) return "bullish";
          if(last.direction==="down"&&last.end<prev.end) return "bearish";
          return "ranging";
        }
        function calcVolumeProfile(candles: Candle[],bins=20) {
          const pMin=Math.min(...candles.map(c=>c.low)),pMax=Math.max(...candles.map(c=>c.high));
          const bSize=(pMax-pMin)/bins;
          const vBins: {price:number;volume:number;isBull:boolean}[]=[];
          for (let b=0;b<bins;b++) {
            const bLow=pMin+b*bSize,bHigh=bLow+bSize,bMid=(bLow+bHigh)/2;
            let vol=0,bVol=0;
            for (const c of candles) {
              const ov=Math.min(c.high,bHigh)-Math.max(c.low,bLow);
              if(ov>0) { const f=ov/(c.high-c.low||1); vol+=c.volume*f; if(c.close>c.open)bVol+=c.volume*f; }
            }
            vBins.push({price:bMid,volume:vol,isBull:bVol>vol*0.5});
          }
          const poc=vBins.reduce((a,b)=>a.volume>b.volume?a:b);
          const sorted=[...vBins].sort((a,b)=>b.volume-a.volume);
          const total=sorted.reduce((s,b)=>s+b.volume,0);
          let cumVol=0; const vahBins: number[]=[];
          for (const bin of sorted) { cumVol+=bin.volume; if(cumVol/total<=0.7)vahBins.push(bin.price); }
          return { poc:poc.price, vah:vahBins.length>0?Math.max(...vahBins):pMax, val:vahBins.length>0?Math.min(...vahBins):pMin, bins:vBins };
        }
        const results = await Promise.allSettled(SYMBOLS.map(async (sym) => {
          try {
            const candles = await fetchCandles(sym,bar,100);
            if(candles.length<50) throw new Error("K線不足");
            const close=candles[candles.length-1].close;
            const closes=candles.map(c=>c.close);
            const e20=emaArr(closes,20),e50=emaArr(closes,50);
            const ema20=e20[e20.length-1],ema50=e50[e50.length-1];
            const rsi=rsiLast(closes),macdH=macdHistLast(closes),adx=adxLast(candles);
            const boll=bollingerLast(closes);
            const smcStr=detectSmcStr(candles,close,ema50);
            const liq=detectLiqSweep(candles,close);
            const chanTrend=calcChanTrend(candles);
            const vp=calcVolumeProfile(candles.slice(-50));
            const prev24=candles[Math.max(0,candles.length-25)];
            const change24h=prev24?((close-prev24.close)/prev24.close)*100:0;
            let score=50;
            if(close>ema20)score+=8;else score-=8;
            if(close>ema50)score+=7;else score-=7;
            if(rsi>55&&rsi<75)score+=8;else if(rsi<45&&rsi>25)score-=8;else if(rsi>=75)score-=5;else if(rsi<=25)score+=5;
            if(macdH>0)score+=7;else score-=7;
            if(smcStr==="bullish")score+=10;else if(smcStr==="bearish")score-=10;
            if(chanTrend==="bullish")score+=10;else if(chanTrend==="bearish")score-=10;
            score=Math.max(0,Math.min(100,score));
            const direction: "long"|"short"|"neutral"=score>=62?"long":score<=38?"short":"neutral";
            return { symbol:sym,coin:sym.replace("USDT",""),close,change24h,rsi,macd_hist:macdH,adx,ema20,ema50,bb_percent:boll.percent_b,bb_bandwidth:boll.bandwidth,smc_structure:smcStr,liq_sweep_bsl:liq.bslSwept,liq_sweep_ssl:liq.sslSwept,chan_trend:chanTrend,score,direction,volume_profile:vp,scanned_at:Date.now() };
          } catch(e) { return { symbol:sym,coin:sym.replace("USDT",""),close:0,change24h:0,rsi:50,macd_hist:0,adx:20,ema20:0,ema50:0,bb_percent:0.5,bb_bandwidth:5,smc_structure:"ranging",liq_sweep_bsl:false,liq_sweep_ssl:false,chan_trend:"ranging" as const,score:50,direction:"neutral" as const,volume_profile:{poc:0,vah:0,val:0,bins:[]},scanned_at:Date.now(),error:String(e) }; }
        }));
        return results.map(r=>r.status==="fulfilled"?r.value:{symbol:"",coin:"",close:0,change24h:0,rsi:50,macd_hist:0,adx:20,ema20:0,ema50:0,bb_percent:0.5,bb_bandwidth:5,smc_structure:"ranging",liq_sweep_bsl:false,liq_sweep_ssl:false,chan_trend:"ranging" as const,score:50,direction:"neutral" as const,volume_profile:{poc:0,vah:0,val:0,bins:[]},scanned_at:Date.now()});
      }),
  }),

  // ── 市場情緒熱力圖（Heatmap）──
  heatmap: router({
    getMarketOverview: publicProcedure
      .input(z.object({ timeframe: z.enum(["1H","4H","1D"]).default("4H") }))
      .query(async ({ input }) => {
        const SYMBOLS=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","DOTUSDT","LINKUSDT"];
        const bar=input.timeframe;
        // 使用頂部共用函數（P3 改良）
        const rsiLast = sharedRsiLast;
        const emaArr = sharedEmaArr;
        const results=await Promise.allSettled(SYMBOLS.map(async(sym)=>{
          try {
            const candles=await fetchCandles(sym,bar,100);
            if(candles.length<20) throw new Error("K線不足");
            const close=candles[candles.length-1].close;
            const closes=candles.map(c=>c.close);
            const rsi=rsiLast(closes);
            const e20=emaArr(closes,20),e50=emaArr(closes,50);
            const ema20=e20[e20.length-1],ema50=e50[e50.length-1];
            const change1h=candles.length>=2?((close-candles[candles.length-2].close)/candles[candles.length-2].close)*100:0;
            const change24h=candles.length>=25?((close-candles[candles.length-25].close)/candles[candles.length-25].close)*100:0;
            const change7d=candles.length>=43?((close-candles[candles.length-43].close)/candles[candles.length-43].close)*100:0;
            const vol5=candles.slice(-5).reduce((s,c)=>s+c.volume,0)/5;
            const vol20=candles.slice(-20).reduce((s,c)=>s+c.volume,0)/20;
            const volTrend=vol5>vol20*1.2?"increasing":vol5<vol20*0.8?"decreasing":"neutral";
            let score=50;
            if(close>ema20)score+=10;else score-=10;
            if(close>ema50)score+=10;else score-=10;
            if(rsi>55&&rsi<75)score+=10;else if(rsi<45&&rsi>25)score-=10;else if(rsi>=75)score-=5;else if(rsi<=25)score+=5;
            if(change24h>2)score+=10;else if(change24h<-2)score-=10;
            score=Math.max(0,Math.min(100,score));
            const sentiment: "strong_bull"|"bull"|"neutral"|"bear"|"strong_bear"=score>=75?"strong_bull":score>=60?"bull":score>=40?"neutral":score>=25?"bear":"strong_bear";
            return {symbol:sym,coin:sym.replace("USDT",""),close,rsi,ema20,ema50,change1h,change24h,change7d,vol_trend:volTrend,score,sentiment};
          } catch { return {symbol:sym,coin:sym.replace("USDT",""),close:0,rsi:50,ema20:0,ema50:0,change1h:0,change24h:0,change7d:0,vol_trend:"neutral" as const,score:50,sentiment:"neutral" as const}; }
        }));
        const data=results.map(r=>r.status==="fulfilled"?r.value:{symbol:"",coin:"",close:0,rsi:50,ema20:0,ema50:0,change1h:0,change24h:0,change7d:0,vol_trend:"neutral" as const,score:50,sentiment:"neutral" as const});
        const bullCount=data.filter(d=>d.sentiment==="strong_bull"||d.sentiment==="bull").length;
        const bearCount=data.filter(d=>d.sentiment==="strong_bear"||d.sentiment==="bear").length;
        const avgScore=data.reduce((s,d)=>s+d.score,0)/data.length;
        const avgRsi=data.reduce((s,d)=>s+d.rsi,0)/data.length;
        return { coins:data, market_summary:{ bull_count:bullCount, bear_count:bearCount, neutral_count:data.length-bullCount-bearCount, avg_score:Math.round(avgScore), avg_rsi:Math.round(avgRsi*10)/10, market_sentiment:avgScore>=65?"bull_market":avgScore<=35?"bear_market":"mixed" }, scanned_at:Date.now() };
      }),
  }),

  // ── 自訂警報系統（Alerts）──
  alerts: router({
    checkAlerts: publicProcedure
      .input(z.object({
        alerts: z.array(z.object({
          id: z.string(),
          symbol: z.string(),
          condition: z.enum(["price_above","price_below","rsi_above","rsi_below","macd_cross_up","macd_cross_down","bb_squeeze","volume_spike","smc_bos","fvg_touch"]),
          value: z.number().optional(),
          enabled: z.boolean().default(true),
        }))
      }))
      .mutation(async ({ input }) => {
        const triggered: {id:string;symbol:string;condition:string;message:string;price:number;time:number}[]=[];
        // 使用頂部共用函數（P3 改良）
        const rsiLast = sharedRsiLast;
        const macdHistFn = sharedMacdHistFn;
        const bbBandwidth = sharedBbBandwidth;
        const enabledAlerts=input.alerts.filter(a=>a.enabled);
        const uniqueSyms=Array.from(new Set(enabledAlerts.map(a=>a.symbol)));
        const candleMap=new Map<string,Candle[]>();
        // P2 改良：錯誤處理加入日誌，不再靜默吐掉
        await Promise.allSettled(uniqueSyms.map(async(sym)=>{
          try{const c=await fetchCandles(sym,"1H",50);candleMap.set(sym,c);}
          catch(e){console.warn(`[alerts.checkAlerts] 無法取得 ${sym} K線:`,e instanceof Error?e.message:String(e));}
        }));
        for(const alert of enabledAlerts) {
          const candles=candleMap.get(alert.symbol);
          if(!candles||candles.length<20) continue;
          const close=candles[candles.length-1].close;
          const closes=candles.map(c=>c.close);
          const rsi=rsiLast(closes);
          const {cur:hist,prev:prevHist}=macdHistFn(closes);
          const bw=bbBandwidth(closes);
          const vol5=candles.slice(-5).reduce((s,c)=>s+c.volume,0)/5;
          const vol20=candles.slice(-20).reduce((s,c)=>s+c.volume,0)/20;
          let fired=false,msg="";
          switch(alert.condition) {
            case "price_above": if(alert.value&&close>alert.value){fired=true;msg=`${alert.symbol} 價格突破 ${alert.value.toFixed(2)}`;} break;
            case "price_below": if(alert.value&&close<alert.value){fired=true;msg=`${alert.symbol} 價格跌破 ${alert.value.toFixed(2)}`;} break;
            case "rsi_above": if(alert.value&&rsi>alert.value){fired=true;msg=`${alert.symbol} RSI(${rsi.toFixed(1)}) 超過 ${alert.value}`;} break;
            case "rsi_below": if(alert.value&&rsi<alert.value){fired=true;msg=`${alert.symbol} RSI(${rsi.toFixed(1)}) 低於 ${alert.value}`;} break;
            case "macd_cross_up": if(prevHist<0&&hist>0){fired=true;msg=`${alert.symbol} MACD 金叉（柱狀圖轉正）`;} break;
            case "macd_cross_down": if(prevHist>0&&hist<0){fired=true;msg=`${alert.symbol} MACD 死叉（柱狀圖轉負）`;} break;
            case "bb_squeeze": if(bw<3){fired=true;msg=`${alert.symbol} 布林帶收窄(BW=${bw.toFixed(2)}%)，即將爆發`;} break;
            case "volume_spike": if(vol5>vol20*2){fired=true;msg=`${alert.symbol} 成交量爆升(${(vol5/vol20).toFixed(1)}x均量)`;} break;
            case "smc_bos": {
              const r10=candles.slice(-10);
              const pH=Math.max(...candles.slice(-30,-10).map(c=>c.high));
              const pL=Math.min(...candles.slice(-30,-10).map(c=>c.low));
              if(r10.some(c=>c.close>pH)){fired=true;msg=`${alert.symbol} SMC BOS 突破前高(${pH.toFixed(2)})`; }
              else if(r10.some(c=>c.close<pL)){fired=true;msg=`${alert.symbol} SMC BOS 跌破前低(${pL.toFixed(2)})`; }
              break;
            }
            case "fvg_touch": {
              let touched=false;
              for(let i=1;i<candles.length-1;i++) {
                const prev=candles[i-1],next=candles[i+1];
                if(prev.high<next.low){const mid=(prev.high+next.low)/2;if(Math.abs(close-mid)/close<0.005){touched=true;msg=`${alert.symbol} 觸及多方FVG(${mid.toFixed(2)})`;break;}}
                if(prev.low>next.high){const mid=(prev.low+next.high)/2;if(Math.abs(close-mid)/close<0.005){touched=true;msg=`${alert.symbol} 觸及空方FVG(${mid.toFixed(2)})`;break;}}
              }
              if(touched) fired=true;
              break;
            }
          }
          if(fired) triggered.push({id:alert.id,symbol:alert.symbol,condition:alert.condition,message:msg,price:close,time:Date.now()});
        }
        return {triggered,checked_at:Date.now()};
      }),

    // ── 多條件組合警報（Phase 4 新增）──
    checkCompositeAlerts: publicProcedure
      .input(z.object({
        compositeAlerts: z.array(z.object({
          id: z.string(),
          symbol: z.string(),
          label: z.string(),
          enabled: z.boolean().default(true),
          logic: z.enum(["AND", "OR"]).default("AND"),
          conditions: z.array(z.object({
            condition: z.enum(["price_above","price_below","rsi_above","rsi_below","macd_cross_up","macd_cross_down","bb_squeeze","volume_spike","smc_bos","fvg_touch"]),
            value: z.number().optional(),
          })).min(1).max(5),
        }))
      }))
      .mutation(async ({ input }) => {
        const triggered: {id:string;symbol:string;label:string;message:string;price:number;time:number;matchedConditions:string[]}[]=[];
        // 使用頂部共用函數（P3 改良）
        const rsiLast = sharedRsiLast;
        const macdHistFn = sharedMacdHistFn;
        const bbBandwidth = sharedBbBandwidth;
        function evalCondition(cond: {condition:string;value?:number}, candles: Candle[]): {fired:boolean;msg:string} {
          const close=candles[candles.length-1].close;
          const closes=candles.map(c=>c.close);
          const rsi=rsiLast(closes);
          const {cur:hist,prev:prevHist}=macdHistFn(closes);
          const bw=bbBandwidth(closes);
          const vol5=candles.slice(-5).reduce((s,c)=>s+c.volume,0)/5;
          const vol20=candles.slice(-20).reduce((s,c)=>s+c.volume,0)/20;
          switch(cond.condition) {
            case "price_above": if(cond.value&&close>cond.value) return {fired:true,msg:`價格突破 ${cond.value.toFixed(2)}`}; break;
            case "price_below": if(cond.value&&close<cond.value) return {fired:true,msg:`價格跌破 ${cond.value.toFixed(2)}`}; break;
            case "rsi_above": if(cond.value&&rsi>cond.value) return {fired:true,msg:`RSI(${rsi.toFixed(1)})>${cond.value}`}; break;
            case "rsi_below": if(cond.value&&rsi<cond.value) return {fired:true,msg:`RSI(${rsi.toFixed(1)})<${cond.value}`}; break;
            case "macd_cross_up": if(prevHist<0&&hist>0) return {fired:true,msg:`MACD 金叉`}; break;
            case "macd_cross_down": if(prevHist>0&&hist<0) return {fired:true,msg:`MACD 死叉`}; break;
            case "bb_squeeze": if(bw<3) return {fired:true,msg:`布林帶收窄(${bw.toFixed(2)}%)`}; break;
            case "volume_spike": if(vol5>vol20*2) return {fired:true,msg:`成交量爆升(${(vol5/vol20).toFixed(1)}x)`}; break;
            case "smc_bos": {
              const r10=candles.slice(-10);
              const pH=Math.max(...candles.slice(-30,-10).map(c=>c.high));
              const pL=Math.min(...candles.slice(-30,-10).map(c=>c.low));
              if(r10.some(c=>c.close>pH)) return {fired:true,msg:`SMC BOS 突破前高(${pH.toFixed(2)})`};
              if(r10.some(c=>c.close<pL)) return {fired:true,msg:`SMC BOS 跌破前低(${pL.toFixed(2)})`};
              break;
            }
            case "fvg_touch": {
              for(let i=1;i<candles.length-1;i++) {
                const prev=candles[i-1],next=candles[i+1];
                if(prev.high<next.low){const mid=(prev.high+next.low)/2;if(Math.abs(close-mid)/close<0.005) return {fired:true,msg:`觸及多方FVG(${mid.toFixed(2)})`};}
                if(prev.low>next.high){const mid=(prev.low+next.high)/2;if(Math.abs(close-mid)/close<0.005) return {fired:true,msg:`觸及空方FVG(${mid.toFixed(2)})`};}
              }
              break;
            }
          }
          return {fired:false,msg:""};
        }
        const enabledAlerts=input.compositeAlerts.filter(a=>a.enabled);
        const uniqueSyms=Array.from(new Set(enabledAlerts.map(a=>a.symbol)));
        const candleMap=new Map<string,Candle[]>();
        // P2 改良：錯誤處理加入日誌
        await Promise.allSettled(uniqueSyms.map(async(sym)=>{
          try{const c=await fetchCandles(sym,"1H",50);candleMap.set(sym,c);}
          catch(e){console.warn(`[alerts.checkCompositeAlerts] 無法取得 ${sym} K線:`,e instanceof Error?e.message:String(e));}
        }));
        for(const alert of enabledAlerts) {
          const candles=candleMap.get(alert.symbol);
          if(!candles||candles.length<20) continue;
          const close=candles[candles.length-1].close;
          const results=alert.conditions.map(c=>evalCondition(c,candles));
          const matchedConditions=results.filter(r=>r.fired).map(r=>r.msg);
          const fired=alert.logic==="AND"
            ?results.every(r=>r.fired)
            :results.some(r=>r.fired);
          if(fired) {
            const msg=`${alert.symbol} [${alert.logic}] ${matchedConditions.join(" + ")}`;
            triggered.push({id:alert.id,symbol:alert.symbol,label:alert.label,message:msg,price:close,time:Date.now(),matchedConditions});
          }
        }
        return {triggered,checked_at:Date.now()};
      }),
  }),

  // ── Widget 偏好（加入 Zod 輸入驗證）──
  widgets: router({
    getPrefs: publicProcedure
      .input(z.object({ openId: z.string().optional() }))
      .query(async ({ input }): Promise<string[] | null> => {
        if (!input.openId) return null;
        return getWidgetPrefs(input.openId);
      }),

    savePrefs: publicProcedure
      .input(
        z.object({
          openId:    z.string().min(1),
          widgetIds: z.array(z.string().min(1)).max(50),
        })
      )
      .mutation(async ({ input }) => {
        const result = WidgetPrefsSchema.safeParse(input);
        if (!result.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Widget 偏好格式錯誤：${result.error.message}`,
          });
        }
        await saveWidgetPrefs(result.data.openId, result.data.widgetIds);
        return { success: true };
      }),
  }),

  // ── 熊貓策略面板（@bh1908 熊敖策略）──
  panda: router({
    scan: publicProcedure
      .input(z.object({
        symbol: z.string().default("BTCUSDT"),
        timeframe: z.enum(["1H", "4H", "1D"]).default("4H"),
      }))
      .mutation(async ({ input }) => {
        const { runPandaScanV54 } = await import("./utils/pandaStrategy.js");
        const sym = normalizeSymbol(input.symbol);
        const tfMap: Record<string, string> = { "1H": "1h", "4H": "4h", "1D": "1d" };
        const htfMap: Record<string, string> = { "1H": "4h", "4H": "1d", "1D": "1w" };
        const ltfBar = tfMap[input.timeframe] ?? "4h";
        const htfBar = htfMap[input.timeframe] ?? "1d";
        // v5.4: Vegas 雙通道需要 700+ 根 K 棒，HTF 取 200 根，LTF 取 800 根
        const [ltfCandles, htfCandles] = await Promise.all([
          fetchCandles(sym, ltfBar, 800),
          fetchCandles(sym, htfBar, 200),
        ]);
        return runPandaScanV54(sym, htfCandles as any, ltfCandles as any);
      }),

    backtest: publicProcedure
      .input(z.object({
        symbol: z.string().default("BTCUSDT"),
        timeframe: z.enum(["1H", "4H", "1D"]).default("4H"),
        minScore: z.number().min(0).max(100).default(55),
      }))
      .mutation(async ({ input }) => {
        const { runPandaBacktest } = await import("./utils/pandaStrategy.js");
        const sym = normalizeSymbol(input.symbol);
        const tfMap: Record<string, string> = { "1H": "1h", "4H": "4h", "1D": "1d" };
        const htfMap: Record<string, string> = { "1H": "4h", "4H": "1d", "1D": "1w" };
        const ltfBar = tfMap[input.timeframe] ?? "4h";
        const htfBar = htfMap[input.timeframe] ?? "1d";
        const [ltfCandles, htfCandles] = await Promise.all([
          fetchCandles(sym, ltfBar, 500),
          fetchCandles(sym, htfBar, 200),
        ]);
        return runPandaBacktest(sym, htfCandles as any, ltfCandles as any, input.minScore);
      }),
  }),

  // ── 組合策略即時信號（方案 A 分組 MTF）──
  // ─────────────────────────────────────────────────────────────────────────
  // Champion Trader 方法論分析路由
  // ─────────────────────────────────────────────────────────────────────────
  champion: router({
    analyze: publicProcedure
      .input(z.object({
        symbol:        z.string().default("BTCUSDT"),
        snapshot:      z.any(),
        currentPrice:  z.number(),
        timeframe:     z.string().default("1h"),
      }))
      .mutation(async ({ input }) => {
        const { symbol, snapshot, currentPrice, timeframe } = input;
        if (!snapshot) throw new TRPCError({ code: "BAD_REQUEST", message: "需要先執行分析取得快照" });

        // 提取關鍵指標數據
        const ind = snapshot.indicators ?? {};
        const mtf = snapshot.mtf_indicators ?? {};
        const smc = snapshot.smc ?? {};
        const pa  = snapshot.pa  ?? {};
        const con = snapshot.consensus ?? {};
        const str = snapshot.strategy  ?? {};

        // 構建指標摘要
        const indSummary = [
          `當前價格: $${currentPrice.toLocaleString()}`,
          `EMA20/50/200: ${(ind.ema as any)?.ema20?.toFixed(1) ?? "—"}/${(ind.ema as any)?.ema50?.toFixed(1) ?? "—"}/${(ind.ema as any)?.ema200?.toFixed(1) ?? "—"}`,
          `趨勢: ${ind.trend ?? "—"} | 動能: ${ind.momentum ?? "—"}`,
          `RSI(14): ${(ind.rsi as number)?.toFixed(1) ?? "—"}`,
          `MACD: ${(ind.macd as any)?.macd?.toFixed(4) ?? "—"} / Signal: ${(ind.macd as any)?.signal?.toFixed(4) ?? "—"} / Hist: ${(ind.macd as any)?.histogram?.toFixed(4) ?? "—"}`,
          `布林帶: 上軌 ${(ind.bollinger as any)?.upper?.toFixed(1) ?? "—"} / 中軌 ${(ind.bollinger as any)?.middle?.toFixed(1) ?? "—"} / 下軌 ${(ind.bollinger as any)?.lower?.toFixed(1) ?? "—"} / BW: ${(ind.bollinger as any)?.bandwidth?.toFixed(2) ?? "—"}%`,
          `KD: K=${(ind.stochastic as any)?.k?.toFixed(1) ?? "—"} D=${(ind.stochastic as any)?.d?.toFixed(1) ?? "—"}`,
          `ADX: ${(ind.adx as any)?.adx?.toFixed(1) ?? "—"} (DI+: ${(ind.adx as any)?.plus_di?.toFixed(1) ?? "—"} / DI-: ${(ind.adx as any)?.minus_di?.toFixed(1) ?? "—"})`,
          `ATR: ${(ind.atr as number)?.toFixed(2) ?? "—"}`,
          `VWAP: ${(ind.vwap as number)?.toFixed(1) ?? "—"}`,
        ].join("\n");

        // MTF 多時間框架摘要
        const mtfSummary = Object.entries(mtf).map(([tf, d]: [string, any]) =>
          `[${tf.toUpperCase()}] RSI=${d.rsi?.toFixed(1) ?? "—"} MACD_hist=${d.macd_hist?.toFixed(3) ?? "—"} EMA20=${d.ema20?.toFixed(1) ?? "—"} 趨勢=${d.trend ?? "—"}`
        ).join("\n");

        // SMC 結構摘要
        const smcSummary = [
          `市場結構: ${smc.market_structure ?? "—"}`,
          `最近 BOS/CHoCH: ${smc.last_bos_type ?? "—"} @ ${smc.last_bos_price?.toFixed(1) ?? "—"}`,
          `FVG 數量: 看多 ${smc.fvg_bullish_count ?? 0} / 看空 ${smc.fvg_bearish_count ?? 0}`,
          `BSL: ${smc.bsl?.toFixed(1) ?? "—"} / SSL: ${smc.ssl?.toFixed(1) ?? "—"}`,
          `OB 看多: ${smc.ob_bullish?.toFixed(1) ?? "—"} / OB 看空: ${smc.ob_bearish?.toFixed(1) ?? "—"}`,
        ].join("\n");

        // PA 摘要
        const paSummary = [
          `支撐: ${pa.support?.toFixed(1) ?? "—"} / 阻力: ${pa.resistance?.toFixed(1) ?? "—"}`,
          `趨勢: ${pa.trend ?? "—"}`,
          `K 線形態: ${pa.candle_pattern ?? "—"}`,
          `成交量確認: ${pa.volume_confirm ? "是" : "否"}`,
        ].join("\n");

        // 共識評分
        const conSummary = `共識評分: ${con.score ?? "—"}/100 (${con.label ?? "—"}) | 看多信號: ${con.bull_count ?? 0} / 看空信號: ${con.bear_count ?? 0}`;

        // 策略建議
        const strSummary = [
          `方向: ${str.direction ?? "—"}`,
          `進場: ${str.entry?.toFixed(1) ?? "—"}`,
          `止損: ${str.stop_loss?.toFixed(1) ?? "—"}`,
          `止盈1: ${str.take_profit_1?.toFixed(1) ?? "—"} / 止盈2: ${str.take_profit_2?.toFixed(1) ?? "—"}`,
          `信心: ${str.confidence ?? "—"}%`,
        ].join("\n");

        const systemPrompt = `你是 Champion Trader（Shi Hun）的交易分析助理，嚴格按照以下方法論框架進行分析：

## Champion Trader 核心方法論

**分析四層框架（必須按順序）：**
1. 基礎圖表語言層：先看趨勢方向（K線、均線、量價），再看位置（支撐/阻力）
2. 訊號層：MACD 柱狀圖方向、RSI 位置（超買/超賣/中性）、布林帶位置、KD 交叉
3. 結構過濾層：FVG（公平價值缺口）、流動性（BSL/SSL）、市場結構（BOS/CHoCH）、主力痕跡
4. 執行層：進場條件、止損位置、出場規則、風報比評估

**四個核心問題（每次分析必答）：**
- 趨勢方向是什麼？（多/空/震盪）
- 為什麼這個位置值得進場？（結構理由）
- 止損放哪裡？（不能放在明顯位置）
- 風報比是否合理？（至少 1:2）

**Champion Trader 特色規則：**
- 真假支撐辨識：結構成立才是理由，便宜不是理由
- 被洗出場預防：止損不能放在太明顯的位置（避免流動性獵殺）
- 抱波段規則：只看 1 個顏色/均線來決定是否繼續持倉
- 追高過濾：必須等起涨點確認，不追漲停後的追高

**輸出格式要求：**
請用繁體中文，嚴格按照以下 JSON 格式輸出（不要加 markdown code block，不要加任何其他內容）：
{
  "trend": { "direction": "多/空/震盪", "strength": "強/中/弱", "description": "趨勢描述" },
  "market_state": { "phase": "趨勢延續/結構轉換/震盪整理/準備發動", "description": "市場狀態描述" },
  "position_analysis": { "support": 數字, "resistance": 數字, "current_zone": "支撑區/阻力區/中性區/超買區/超賣區", "description": "位置分析" },
  "technical_indicators": { "macd": "看多/看空/中性", "rsi": "超買/超賣/中性", "bollinger": "上軌附近/下軌附近/中軌附近", "kd": "金叉/死叉/中性", "volume": "放量/縮量/正常", "confluence": "訊號共振描述" },
  "smc_market_structure": { "fvg_opportunity": "有/無", "liquidity_target": 數字或null, "recent_bos_choch": "結構描述", "smart_money_trace": "主力行為描述" },
  "strategy": { "direction": "做多/做空/觀望", "entry": 數字, "stop_loss": { "level": 數字, "basis": "止損依據" }, "take_profit_1": 數字, "take_profit_2": 數字, "rr_ratio": 數字, "confidence": 數字 },
  "trading_plan": { "primary_scenario": "主場景描述", "invalidation_scenario": "失效場景", "no_trade_conditions": ["不操作條件列表"] },
  "final_judgement": { "bias": "做多/做空/觀望", "action": "做多/做空/觀望", "one_line_summary": "冠軍風格一句話判斷", "full_verdict": "冠軍交易者風格的完整判斷（2-3句，直接、有規則感）" },
  "champion_checklist": {
    "trend_confirmed": true/false,
    "position_valid": true/false,
    "signal_aligned": true/false,
    "structure_supports": true/false,
    "rr_acceptable": true/false,
    "not_chasing": true/false,
    "sl_not_obvious": true/false
  },
  "data_quality": { "warnings": ["數據品質警告列表，若無則為空陣列"] }
}`;

        const userPrompt = `請分析 ${symbol} 在 ${timeframe} 時間框架的當前市況：

## 技術指標
${indSummary}

## 多時間框架
${mtfSummary}

## SMC 市場結構
${smcSummary}

## 價格行為
${paSummary}

## 共識評分
${conSummary}

## 現有策略建議
${strSummary}

請嚴格按照 Champion Trader 方法論框架，輸出 JSON 格式分析結果。`;

        const cacheKey = `champion:${symbol}:${timeframe}:${Math.floor(Date.now() / 300000)}`;
        const cachedResult = serverCache.get<{ symbol: string; timeframe: string; timestamp: number; analysis: unknown; raw: string }>(cacheKey);
        if (cachedResult) return cachedResult;

        try {
          const resp = await invokeLLM({
            tier: "balanced",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user",   content: userPrompt },
            ],
          });
          const raw = typeof resp.choices[0]?.message?.content === "string"
            ? resp.choices[0].message.content
            : JSON.stringify(resp.choices[0]?.message?.content ?? "");
          // 嘗試解析 JSON
          let parsed: unknown;
          try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { champion_verdict: raw };
          } catch {
            parsed = { champion_verdict: raw };
          }
          const result = { symbol, timeframe, timestamp: Date.now(), analysis: parsed, raw };
          serverCache.set(cacheKey, result, 300_000); // 5 分鐘，Champion 專屬快取
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Champion 分析失敗：${msg}` });
        }
      }),
  }),

  cannonball: router({
    analyze: publicProcedure
      .input(z.object({
        symbol:               z.string().default("BTCUSDT"),
        htf_tf:               z.string().default("2H"),
        ltf_tf:               z.string().default("30m"),
        sl_atr_mult:          z.number().min(0.1).max(0.8).default(0.3),
        tp2_atr_mult:         z.number().min(1.0).max(4.0).default(2.5),
        confluence_threshold: z.number().min(40).max(80).default(50),
        avoid_extremes_atr:   z.number().min(0.3).max(1.5).default(0.8),
      }))
      .query(async ({ input }) => {
        const symbol = normalizeSymbol(input.symbol);
        const params = {
          htf_tf:               input.htf_tf,
          ltf_tf:               input.ltf_tf,
          sl_atr_mult:          input.sl_atr_mult,
          tp2_atr_mult:         input.tp2_atr_mult,
          confluence_threshold: input.confluence_threshold,
          avoid_extremes_atr:   input.avoid_extremes_atr,
        };
        const paramKey = `${params.htf_tf}:${params.ltf_tf}:${params.sl_atr_mult}:${params.tp2_atr_mult}:${params.confluence_threshold}:${params.avoid_extremes_atr}`;
        const cacheKey = `cannonball:${symbol}:${paramKey}:${Math.floor(Date.now() / 60000)}`;
        const cached = serverCache.get<Awaited<ReturnType<typeof runCannonballAnalysis>>>(cacheKey);
        if (cached) return cached;
        try {
          const result = await runCannonballAnalysis(symbol, params);
          serverCache.set(cacheKey, result, 60_000);
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `CannonBall 分析失敗：${msg}` });
        }
      }),
  }),
  combo: router({
    liveSignal: publicProcedure
      .input(z.object({
        symbol:         z.string().default("BTCUSDT"),
        interval:       z.string().default("15m"),
        limit:          z.number().min(200).max(2160).default(500),
        strategies:     z.array(z.enum([
          "ema_cross", "rsi_reversal", "bollinger", "macd", "smc", "pa",
          "chan", "liquidity_sweep", "vwap_reversion", "composite",
          "cannonball", "hwr_model_a", "hwr_model_b", "hwr_model_c"
        ])).default(["ema_cross", "cannonball", "hwr_model_a", "hwr_model_c", "macd"]),
        use_triple_mtf: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        const sym = normalizeSymbol(input.symbol);
        const bar = input.interval;
        const lim = input.limit;

        // 反趨勢策略（使用三層 MTF）
        const TRIPLE_MTF_SET = new Set(["bollinger", "chan", "vwap_reversion", "composite"]);

        // 抓取主要 K 線 + 4H K 線（雙層 MTF 基礎）
        const [primaryCandles, candles4h] = await Promise.all([
          fetchCandles(sym, bar, lim),
          fetchCandles(sym, "4h", 500),
        ]);

        // 若有反趨勢策略，額外抓取 1H K 線
        const needsTriple = input.strategies.some(s => TRIPLE_MTF_SET.has(s));
        const candles1h = needsTriple
          ? await fetchCandles(sym, "1h", 500)
          : null;

        // 並行執行所有策略的回測，取最後一筆交易作為「即時信號」
        const results = await Promise.all(
          input.strategies.map(async (s) => {
            const isTriple = TRIPLE_MTF_SET.has(s) && input.use_triple_mtf;
            const result = runBacktest({
              candles:              primaryCandles as Candle[],
              strategy:             s as BacktestStrategy,
              symbol:               sym,
              interval:             bar,
              enable_mtf_filter:    true,
              enable_fee:           false,
              enable_trailing_stop: false,
              enable_adx_filter:    true,
              candles_4h:           candles4h as Candle[],
              candles_1h:           isTriple ? (candles1h as Candle[]) : undefined,
            });

            // 取最後一筆交易（最近信號）
            const trades = result.trades ?? [];
            const lastTrade = trades.length > 0 ? trades[trades.length - 1] : null;

            // 計算近期勝率（最近 20 筆）
            const recent = trades.slice(-20);
            const recentWr = recent.length > 0
              ? Math.round(recent.filter(t => (t.pnl_net_pct ?? 0) > 0).length / recent.length * 100)
              : 0;

            return {
              strategy:         s,
              mtf_type:         isTriple ? "triple" : "dual",
              total_trades:     result.total_trades,
              win_rate:         result.win_rate,
              recent_wr:        recentWr,
              last_trade:       lastTrade,
              signal_direction: lastTrade?.direction ?? null,
              signal_score:     lastTrade?.signal_score ?? null,
              entry:            lastTrade?.entry_price ?? null,
              sl:               lastTrade?.sl_price ?? null,
              tp1:              lastTrade?.tp_price ?? null,
              tp2:              lastTrade?.tp2_price ?? null,
              entry_time:       lastTrade?.entry_time ?? null,
              exit_time:        lastTrade?.exit_time ?? null,
            };
          })
        );

        // 找出最近的活躍信號（exit_time 在最近 N 根 K 線內）
        const now = Date.now();
        const intervalMs: Record<string, number> = {
          "1m": 60_000, "3m": 180_000, "5m": 300_000,
          "15m": 900_000, "30m": 1_800_000,
          "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
        };
        const barMs = intervalMs[bar] ?? 900_000;
        const activeWindow = barMs * 8; // 最近 8 根 K 線內的信號視為活躍

        // 篩選活躍信號（exit_time > now - activeWindow 或 exit_time 為 null）
        const activeSignals = results.filter(r =>
          r.signal_direction !== null &&
          (r.exit_time == null || r.exit_time * 1000 > now - activeWindow)
        );

        // P1 改良：多維度加權評分（消除 ?? 5 預設值缺陷）
        // 公式： score(35%) + 勝率(25%) + RR比(20%) + 時效性(20%)
        function calcCompositeScore(sig: typeof activeSignals[0]): number {
          // 策略評分：無評分策略得 0 分（不再用 5 沙塔對最佳信號）
          const rawScore = sig.signal_score ?? 0;
          const normalizedScore = rawScore / 10; // 0~1
          // 勝率分：0~100% 歸一化
          const wrScore = sig.recent_wr / 100;
          // RR 比：計算 tp1/sl 的風險報酬比
          let rrScore = 0.5; // 預設中性
          if (sig.entry && sig.sl && sig.tp1) {
            const risk = Math.abs(sig.entry - sig.sl);
            const reward = Math.abs(sig.tp1 - sig.entry);
            if (risk > 0) {
              const rr = reward / risk;
              rrScore = Math.min(rr / 3, 1); // RR=3 時滿分
            }
          }
          // 時效性：信號越新得分越高
          let freshnessScore = 0.5;
          if (sig.entry_time) {
            const ageMs = now - sig.entry_time * 1000;
            const maxAge = barMs * 4;
            freshnessScore = Math.max(0, 1 - ageMs / maxAge);
          }
          return normalizedScore * 0.35 + wrScore * 0.25 + rrScore * 0.20 + freshnessScore * 0.20;
        }
        const bestSignal = activeSignals.length > 0
          ? [...activeSignals].sort((a, b) => calcCompositeScore(b) - calcCompositeScore(a))[0]
          : null;

        return {
          symbol:        sym,
          interval:      bar,
          timestamp:     now,
          all_signals:   results,
          active_signals: activeSignals,
          best_signal:   bestSignal,
          combo_name:    input.strategies.join("+"),
          recommended_combos: [
            { name: "最優平衡",   strategies: ["ema_cross", "cannonball", "hwr_model_a", "hwr_model_c", "macd"], note: "含 CannonBall 結構確認與趨勢延續" },
            { name: "最高勝率",   strategies: ["bollinger", "ema_cross", "cannonball", "hwr_model_a", "macd"], note: "加入 CannonBall 後更偏保守確認" },
            { name: "最低回撤",   strategies: ["ema_cross", "cannonball", "hwr_model_a", "vwap_reversion"], note: "偏重結構確認與均值回歸互補" },
            { name: "高活躍度",   strategies: ["pa", "cannonball", "hwr_model_b", "macd", "chan"],      note: "兼顧趨勢追蹤與結構型回踩" },
          ],
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
