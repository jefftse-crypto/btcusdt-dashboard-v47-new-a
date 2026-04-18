/**
 * BTCUSDT Live Signal Worker v4.5
 * 五策略並行監控
 *
 * PA 策略版本（基於 preset 181）：
 *   V2：TP=0.5 + score9.0（無1D，無15m）                       → 回測 +6.73%
 *   V3：TP=0.5 + score9.0 + 1D EMA200                         → 回測 +13.33%（最高報酬）
 *   V4：TP=0.5 + score9.0 + 1D EMA200 + 15m確認               → 回測 +10.11%（最低回撤）
 *
 * 新增策略：
 *   HWR-B：趨勢回踩延續（SL=1.5 ATR / TP=3.0 ATR / 原始）      → 回測 +13.21%（Sharpe 2.309）
 *   CannonBall：結構+OB/FVG（SL=1.5 ATR / TP=3.0 ATR + 1D EMA200）→ 回測 +9.73%
 *
 * v4.1 修復項目（深度審查後）：
 *   FIX-01：修正 bonus 邏輯 — 追蹤前一筆信號方向判斷 continuation（原版 entry_type === "continuation" 永遠不成立）
 *   FIX-02：1D K 線從 300 根增至 400 根，確保 EMA200 充分預熱
 *   FIX-03：HWR-B 和 CannonBall 的 atr_sl_mult/atr_tp_mult 改為 undefined（這兩個策略使用 custom_sl/tp，ATR 倍數無效）
 *   FIX-04：HWR-B 已在 backtest.ts 中加入 score 回傳，可供未來評分過濾使用
 *
 * 合計約 230 筆/年 ≈ 2 天一交易
 * 每 2 分鐘掃描一次，各策略獨立推送 Telegram 信號
 */
import fs from "fs/promises";
import path from "path";
import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS } from "./live_btcusdt_strategy_presets.js";
import { WORKER_GOVERNANCE_RULES, getWorkerGovernance, type StrategyFamily } from "./live_strategy_governance.js";
import { buildDiagnosticsEnrichment } from "./diagnostics_engine.js";
import {
  type StrategySignal,
  type ConsensusResult,
  type MarketRegime as BoosterRegime,
  type RegimeResult,
  type EntryQualityResult,
  type SmartExitPlan,
  type SessionInfo,
  type VolatilityAdaptive,
  type WinRateBoostResult,
  calcCrossStrategyConsensus,
  detectMarketRegime,
  checkEntryQuality,
  calcSmartExit,
  getSessionInfo,
  calcVolatilityAdaptive,
  evaluateSignal,
} from "./win_rate_booster.js";

// ── 設定 ──
const SNAPSHOT_PATH =
  process.env.LATEST_LIVE_SNAPSHOT_PATH ??
  "/home/ubuntu/runtime/btcusdt_live_signal_snapshot.json";
const SNAPSHOT_DIR = path.dirname(SNAPSHOT_PATH);
const INTERVAL_MS        = 2 * 60 * 1000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? "";

// ── v4.7 多幣對支援 ──
// 可由 SYMBOLS 環境變數覆寫（逗號分隔），預設 BTC + XRP + LINK（回測勝率 ≥ 75%）
const SYMBOLS: string[] = (process.env.SYMBOLS ?? "BTCUSDT,XRPUSDT,LINKUSDT")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
function snapshotPathFor(symbol: string): string {
  if (symbol === "BTCUSDT") return SNAPSHOT_PATH; // 保持向後相容
  return path.join(SNAPSHOT_DIR, `${symbol.toLowerCase()}_live_signal_snapshot.json`);
}

// ── 基礎 PA preset（181）──
const PA_PRESET = BTCUSDT_LIVE_PRESETS.find(p => p.key === 'btcusdt_1h_single_strategy_181')!;

// ── 策略版本定義 ──
interface StrategyVersion {
  key:                string;
  label:              string;
  short:              string;
  family:             StrategyFamily;
  strategy:           BacktestStrategy;
  tp:                 number;
  sl:                 number;
  use_1d:             boolean;
  use_15m:            boolean;
  m15_lookback:       number;
  backtest_return:    string;
  backtest_trades:    number;
  enable_mtf_filter:  boolean;
  enable_adx_filter:  boolean;
  enable_trailing_stop: boolean;
  enable_fee:         boolean;
  use_pa_score_filter?: boolean;
  min_signal_score?:  number;
  min_filtered_trades?: number;
  max_signal_age_bars?: number;
}

type StrategyStatus = "sent" | "duplicate_skip" | "blocked" | "idle" | "error";

type StrategyHistoryEntry = {
  checked_at: string;
  status: StrategyStatus;
  reason: string | null;
  reason_code: string | null;
  direction: string | null;
  filtered_trades: number;
  filtered_win_rate: number;
};

type StrategyDiagnostics = {
  total_rounds: number;
  blocked_rounds: number;
  sent_rounds: number;
  duplicate_rounds: number;
  idle_rounds: number;
  error_rounds: number;
  blocked_rate: number;
  sent_rate: number;
  top_blockers: Array<{ reason: string; count: number }>;
};

const DIAGNOSTIC_HISTORY_WINDOW = 30;

const STRATEGY_VERSIONS: StrategyVersion[] = [
  {
    key:                'pa_v4_focus',
    label:              '🟢 PA 主力：1D EMA200 + 15m確認',
    short:              'PA-MAIN',
    family:             'pa',
    strategy:           'pa',
    tp:                 0.5,
    sl:                 PA_PRESET.atr_sl_mult,
    use_1d:             true,
    use_15m:            true,
    m15_lookback:       3,
    backtest_return:    '+10.11%',
    backtest_trades:    71,
    enable_mtf_filter:  true,
    enable_adx_filter:  true,
    enable_trailing_stop: false,
    enable_fee:         true,
    use_pa_score_filter: true,
    ...WORKER_GOVERNANCE_RULES.pa_v4_focus,
  },
  {
    key:                'hwr_b_guarded',
    label:              '🔴 HWR-B：趨勢回踩延續（限流版）',
    short:              'HWR-B',
    family:             'trend_pullback',
    strategy:           'hwr_model_b',
    tp:                 2.0,
    sl:                 1.5,
    use_1d:             false,
    use_15m:            false,
    m15_lookback:       3,
    backtest_return:    '輕改候選',
    backtest_trades:    68,
    enable_mtf_filter:  true,
    enable_adx_filter:  true,
    enable_trailing_stop: false,
    enable_fee:         true,
    ...WORKER_GOVERNANCE_RULES.hwr_b_guarded,
  },
  {
    key:                'cannonball_guarded',
    label:              '🟣 CannonBall：結構確認（保守版）',
    short:              'CBALL',
    family:             'structure',
    strategy:           'cannonball',
    tp:                 2.0,
    sl:                 1.5,
    use_1d:             true,
    use_15m:            false,
    m15_lookback:       3,
    backtest_return:    '+9.73%',
    backtest_trades:    76,
    enable_mtf_filter:  true,
    enable_adx_filter:  true,
    enable_trailing_stop: false,
    enable_fee:         true,
    ...WORKER_GOVERNANCE_RULES.cannonball_guarded,
  },
  {
    key:                'ema_cross_confirm',
    label:              '🟡 EMA Cross：低頻確認版',
    short:              'EMA-X',
    family:             'trend_confirm',
    strategy:           'ema_cross',
    tp:                 1.5,
    sl:                 1.5,
    use_1d:             false,
    use_15m:            false,
    m15_lookback:       3,
    backtest_return:    '+0.01%',
    backtest_trades:    2,
    enable_mtf_filter:  true,
    enable_adx_filter:  true,
    enable_trailing_stop: false,
    enable_fee:         true,
    ...WORKER_GOVERNANCE_RULES.ema_cross_confirm,
  },
  {
    key:                'vwap_reversion_confirm',
    label:              '🔵 VWAP Reversion：均值回歸確認版',
    short:              'VWAP',
    family:             'mean_reversion',
    strategy:           'vwap_reversion',
    tp:                 1.5,
    sl:                 1.5,
    use_1d:             false,
    use_15m:            false,
    m15_lookback:       3,
    backtest_return:    '接近打平',
    backtest_trades:    6,
    enable_mtf_filter:  true,
    enable_adx_filter:  true,
    enable_trailing_stop: false,
    enable_fee:         true,
    ...WORKER_GOVERNANCE_RULES.vwap_reversion_confirm,
  },
];

// ── 狀態追蹤（v4.7：key 加上 symbol 前綴避免多幣對衝突）──
const lastAlertKey    = new Map<string, string>();
const lastSignalDir   = new Map<string, string>();
function stateKey(symbol: string, versionKey: string): string {
  return `${symbol}::${versionKey}`;
}

async function readPreviousSnapshotFor(symbol: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(snapshotPathFor(symbol), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeFilterReason(reason?: string | null): string | null {
  if (!reason) return null;
  const raw = reason.trim();
  if (!raw) return null;
  if (raw.startsWith("1D EMA200 方向不符")) return "1D EMA200 方向不符";
  if (raw.startsWith("15m EMA+趨勢確認未通過")) return "15m 確認未通過";
  if (raw.startsWith("歷史樣本不足")) return "歷史樣本不足";
  if (raw.startsWith("訊號過舊")) return "訊號過舊";
  if (raw.startsWith("最新評分不足")) return "最新評分不足";
  if (raw.startsWith("無交易信號")) return "無交易信號";
  return raw;
}

function buildHistoryEntry(state: any, checkedAt: string): StrategyHistoryEntry {
  return {
    checked_at: checkedAt,
    status: (state?.last_status ?? "idle") as StrategyStatus,
    reason: state?.last_filter_reason ?? null,
    reason_code: normalizeFilterReason(state?.last_filter_reason),
    direction: state?.last_direction ?? null,
    filtered_trades: typeof state?.filtered_trades === "number" ? state.filtered_trades : 0,
    filtered_win_rate: typeof state?.filtered_win_rate === "number" ? state.filtered_win_rate : 0,
  };
}

function buildStrategyDiagnostics(history: StrategyHistoryEntry[]): StrategyDiagnostics {
  const summary: StrategyDiagnostics = {
    total_rounds: history.length,
    blocked_rounds: 0,
    sent_rounds: 0,
    duplicate_rounds: 0,
    idle_rounds: 0,
    error_rounds: 0,
    blocked_rate: 0,
    sent_rate: 0,
    top_blockers: [],
  };

  const blockerCounts = new Map<string, number>();
  for (const item of history) {
    if (item.status === "blocked") summary.blocked_rounds += 1;
    if (item.status === "sent") summary.sent_rounds += 1;
    if (item.status === "duplicate_skip") summary.duplicate_rounds += 1;
    if (item.status === "idle") summary.idle_rounds += 1;
    if (item.status === "error") summary.error_rounds += 1;
    if (item.status === "blocked" && item.reason_code) {
      blockerCounts.set(item.reason_code, (blockerCounts.get(item.reason_code) ?? 0) + 1);
    }
  }

  if (summary.total_rounds > 0) {
    summary.blocked_rate = Math.round((summary.blocked_rounds / summary.total_rounds) * 1000) / 10;
    summary.sent_rate = Math.round((summary.sent_rounds / summary.total_rounds) * 1000) / 10;
  }

  summary.top_blockers = [...blockerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));

  return summary;
}

// ── Telegram 推送 ──
async function sendTelegram(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.length < 10) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[LiveWorker v4.5] Telegram 推送失敗: ${resp.status} – ${err.slice(0, 100)}`);
    }
  } catch (err) {
    console.error(`[LiveWorker v4.5] Telegram 推送異常:`, err);
  }
}

// ── 工具函數 ──
function calcEma(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < Math.min(period - 1, values.length); i++) sum += values[i];
  if (values.length >= period) {
    sum += values[period - 1];
    ema[period - 1] = sum / period;
    for (let i = period; i < values.length; i++) {
      ema[i] = values[i] * k + ema[i - 1] * (1 - k);
    }
  }
  return ema;
}

// ── 1D EMA200 趨勢判斷（FIX-02：使用 400 根日線確保充分預熱）──
function get1dEma200Trend(candles1d: Candle[]): "bullish" | "bearish" | "neutral" {
  if (candles1d.length < 50) return "neutral";
  const closes = candles1d.map(c => c.close);
  const period = Math.min(200, closes.length);
  const ema = calcEma(closes, period);
  const lastEma   = ema[ema.length - 1];
  const lastClose = closes[closes.length - 1];
  if (isNaN(lastEma)) return "neutral";
  if (lastClose > lastEma * 1.002) return "bullish";
  if (lastClose < lastEma * 0.998) return "bearish";
  return "neutral";
}

// ── 15m 執行確認（EMA + 趨勢，lookback=3根）──
function check15mConfirmation(candles15m: Candle[], direction: "long" | "short"): boolean {
  if (candles15m.length < 20) return true;
  const closes = candles15m.map(c => c.close);
  const ema20 = calcEma(closes, 20);
  const ema50 = calcEma(closes, 50);
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  let emaOk = true;
  if (!isNaN(lastEma20) && !isNaN(lastEma50)) {
    if (direction === "long"  && lastEma20 < lastEma50 * 0.999) emaOk = false;
    if (direction === "short" && lastEma20 > lastEma50 * 1.001) emaOk = false;
  }
  const recent3 = candles15m.slice(-3);
  let bullCount = 0, bearCount = 0;
  for (const b of recent3) {
    if (b.close > b.open) bullCount++; else bearCount++;
  }
  const trendOk = direction === "long" ? bullCount > bearCount : bearCount > bullCount;
  return emaOk && trendOk;
}

/**
 * FIX-01：修正 PA score9.0 過濾邏輯
 *
 * 原版 BUG：entry_type === "continuation" 永遠不成立（PA 的 entry_type 只有
 *   "PA_PATTERN"、"PA_TRUE_BREAKOUT"、"PA_2ND_LEG_TRAP"）
 *
 * 修復方案：continuation 的正確定義是「前一筆信號也是同方向」
 *   - 若前一筆信號方向與本次相同 → isContinuation = true → bonus = +1.5
 *   - 否則 → bonus = 0
 *   - 這與原版 applyPaFilter 中 pa_require_retest_on_continuation 的語義一致
 */
function applyScore90Filter(
  trade: { direction: string; signal_score?: number },
  prevDirection: string | undefined
): { pass: boolean; reason?: string } {
  if (trade.signal_score !== undefined && trade.signal_score !== null) {
    // FIX-01：continuation = 前一筆信號方向相同
    const isContinuation = prevDirection !== undefined && prevDirection === trade.direction;
    const bonus = isContinuation ? 1.5 : 0;
    if (trade.signal_score + bonus >= 9.0) return { pass: true };
    return {
      pass: false,
      reason: `score ${trade.signal_score.toFixed(1)}+${bonus.toFixed(1)} < 9.0${isContinuation ? " (continuation)" : ""}`,
    };
  }
  // 無 score 的信號（HWR-B、CannonBall）直接通過
  return { pass: true };
}

// ── v4.6 雙閘門確認清單（8 項核心 + PA 3 項額外） ──
// Tier S：核心通過 ≥ 7/8（強信號，勝率 100%）
// Tier A：核心通過 ≥ 6/8 且 必含 C2_htf_trend、C4_volume、C5_overextended 三項通過（次級信號，勝率 ~50%）
// PA 家族：仍要求 PA1_candle_dir 必過，但 PA2/PA3 容錯 1
interface ChecklistResult {
  pass: boolean;
  tier: "S" | "A" | "-";
  failed_checks: string[];
  passed_count: number;
  total_checks: number;
}

// 模式可由環境變數 WIN_RATE_MODE 切換："strict"（v4.5 原版）/ "balanced"（v4.6 預設，雙閘門）
const WIN_RATE_MODE = (process.env.WIN_RATE_MODE ?? "balanced").toLowerCase();
// 雙閘門關鍵項（核心 6/8 通過時必須通過的項目）
const MUST_HAVE_CORE_CHECKS = ["C2_htf_trend", "C4_volume", "C5_overextended"];

function calcRsi14ForChecklist(candles: Candle[], idx: number): number {
  if (idx < 14) return 50;
  let gains = 0, losses = 0;
  for (let i = idx - 13; i <= idx; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = losses > 0 ? (gains / 14) / (losses / 14) : 100;
  return 100 - 100 / (1 + rs);
}

function calcAtrForChecklist(candles: Candle[], idx: number, period = 14): number {
  const start = Math.max(1, idx - period + 1);
  let sum = 0, count = 0;
  for (let i = start; i <= idx; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    count++;
  }
  return count > 0 ? sum / count : candles[idx].high - candles[idx].low;
}

function runHighWinRateChecklist(
  direction: "long" | "short",
  candles1h: Candle[],
  candles4h: Candle[],
  family: string,
): ChecklistResult {
  const n = candles1h.length;
  if (n < 50) return { pass: true, tier: "S", failed_checks: [], passed_count: 0, total_checks: 0 };

  const lastCandle = candles1h[n - 1];
  const dir = direction;
  const failed: string[] = [];
  let totalChecks = 8;

  // C1. 時段確認：UTC 7-22（倫敦+紐約）
  const utcHour = new Date().getUTCHours();
  if (!(utcHour >= 7 && utcHour < 22)) {
    failed.push("C1_session");
  }

  // C2. HTF 趨勢確認：4H EMA20 斜率 + 價格位置
  const candles4hFiltered = candles4h;
  if (candles4hFiltered.length >= 25) {
    const closes4h = candles4hFiltered.map(c => c.close);
    const ema20_4h = calcEma(closes4h, 20);
    const lastEma = ema20_4h[ema20_4h.length - 1];
    const prevEma = ema20_4h[ema20_4h.length - 2];
    const slope = lastEma - prevEma;
    const lastClose4h = closes4h[closes4h.length - 1];
    const slopeOk = dir === "long" ? slope >= 0 : slope <= 0;
    const posOk = dir === "long" ? lastClose4h >= lastEma * 0.995 : lastClose4h <= lastEma * 1.005;
    if (!slopeOk || !posOk) {
      failed.push("C2_htf_trend");
    }
  }

  // C3. 1H RSI 方向確認
  const rsi1h = calcRsi14ForChecklist(candles1h, n - 1);
  const rsiOk = dir === "long" ? (rsi1h >= 42 && rsi1h <= 72) : (rsi1h >= 28 && rsi1h <= 58);
  if (!rsiOk) {
    failed.push("C3_rsi");
  }

  // C4. 成交量確認：RVOL >= 0.9
  const avgVol20 = candles1h.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const rvol = avgVol20 > 0 ? lastCandle.volume / avgVol20 : 1;
  if (rvol < 0.9) {
    failed.push("C4_volume");
  }

  // C5. 價格未過度延伸：距離 EMA20 < 1.8 ATR
  const ema20arr = calcEma(candles1h.map(c => c.close), 20);
  const atr = calcAtrForChecklist(candles1h, n - 1);
  const distFromEma = Math.abs(lastCandle.close - ema20arr[n - 1]);
  const atrDist = atr > 0 ? distFromEma / atr : 0;
  if (atrDist > 1.8) {
    failed.push("C5_overextended");
  }

  // C6. K 線實體確認：實體比 >= 35%
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const range = lastCandle.high - lastCandle.low;
  const bodyRatio = range > 0 ? body / range : 1;
  if (bodyRatio < 0.35) {
    failed.push("C6_candle_form");
  }

  // C7. 近期動量：最近 2 根至少 1 根與方向一致
  if (n >= 2) {
    const recent2 = candles1h.slice(-2);
    const aligned = recent2.filter(c =>
      dir === "long" ? c.close > c.open : c.close < c.open
    ).length;
    if (aligned < 1) {
      failed.push("C7_momentum");
    }
  }

  // C8. ATR 健康：百分位 20-88%
  if (n >= 50) {
    const atrArr: number[] = [];
    for (let i = Math.max(1, n - 50); i < n; i++) {
      atrArr.push(calcAtrForChecklist(candles1h, i));
    }
    atrArr.sort((a, b) => a - b);
    const rank = atrArr.filter(a => a <= atr).length;
    const percentile = Math.round((rank / atrArr.length) * 100);
    if (percentile < 20 || percentile > 88) {
      failed.push("C8_atr_health");
    }
  }

  // PA 額外確認（3 項）
  if (family === "pa") {
    totalChecks += 3;
    // PA1. 最近 K 線方向一致
    const paCandle = dir === "long" ? lastCandle.close >= lastCandle.open : lastCandle.close <= lastCandle.open;
    if (!paCandle) {
      failed.push("PA1_candle_dir");
    }
    // PA2. RSI 不在極端區
    const paRsiOk = dir === "long" ? rsi1h < 65 : rsi1h > 35;
    if (!paRsiOk) {
      failed.push("PA2_rsi_extreme");
    }
    // PA3. 4H RSI 方向一致
    if (candles4hFiltered.length >= 25) {
      const closes4h = candles4hFiltered.map(c => c.close);
      const rsi4h = calcRsi14ForChecklist(candles4hFiltered, closes4h.length - 1);
      const pa4hOk = dir === "long" ? rsi4h > 45 : rsi4h < 55;
      if (!pa4hOk) {
        failed.push("PA3_4h_rsi");
      }
    }
  }

  const passedCount = totalChecks - failed.length;
  const coreFailedList = failed.filter(f => !f.startsWith("PA"));
  const paFailedList   = failed.filter(f =>  f.startsWith("PA"));
  const corePass = 8 - coreFailedList.length;

  // 模式：strict（v4.5 原版）— 核心容錯 1，PA 容錯 0
  if (WIN_RATE_MODE === "strict") {
    const pass = coreFailedList.length <= 1 && paFailedList.length === 0;
    return { pass, tier: pass ? "S" : "-", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
  }

  // 模式：balanced（v4.6 預設）— 雙閘門
  // PA 家族：PA1 必過 + PA 容錯 ≤ 1
  if (family === "pa") {
    if (paFailedList.includes("PA1_candle_dir")) {
      return { pass: false, tier: "-", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
    }
    if (paFailedList.length > 1) {
      return { pass: false, tier: "-", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
    }
  }

  // Tier S：核心 ≥ 7/8 強信號 → 直接放行
  if (corePass >= 7) {
    return { pass: true, tier: "S", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
  }

  // Tier A：核心 ≥ 6/8 且必含 C2/C4/C5 三項通過
  if (corePass >= 6) {
    const blockedMust = MUST_HAVE_CORE_CHECKS.filter(m => coreFailedList.includes(m));
    if (blockedMust.length === 0) {
      return { pass: true, tier: "A", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
    }
  }

  return { pass: false, tier: "-", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
}

// ── 執行單一策略版本 ──
async function runVersion(
  version: StrategyVersion,
  candles1h: Candle[],
  candles4h: Candle[],
  candles1d: Candle[],
  candles15m: Candle[],
  symbol: string = "BTCUSDT"
): Promise<{
  version_key:       string;
  direction:         string | null;
  entry_price:       number | null;
  sl_price:          number | null;
  tp_price:          number | null;
  tp2_price:         number | null;
  signal_time:       number | null;
  alert_key:         string | null;
  raw_win_rate:      number;
  raw_trades:        number;
  filtered_trades:   number;
  filtered_win_rate: number;
  filter_reason?:    string;
  d1_trend?:         string;
  m15_ok?:           boolean;
  error?:            string;
}> {
  try {
    const result = runBacktest({
      candles:              candles1h,
      strategy:             version.strategy,
      symbol:               symbol,
      interval:             "1h",
      atr_sl_mult:          version.sl,
      atr_tp_mult:          version.tp,
      enable_mtf_filter:    version.enable_mtf_filter,
      enable_adx_filter:    version.enable_adx_filter,
      enable_trailing_stop: version.enable_trailing_stop,
      enable_fee:           version.enable_fee,
      candles_4h:           candles4h,
    });

    let allTrades = result.trades ?? [];
    const rawWinRate = result.win_rate;
    const rawTrades  = result.total_trades;

    if (version.use_pa_score_filter) {
      const prevDir = lastSignalDir.get(stateKey(symbol, version.key));
      const filteredTrades: typeof allTrades = [];
      for (const t of allTrades) {
        const prevTradeDir = filteredTrades.length > 0
          ? filteredTrades[filteredTrades.length - 1].direction
          : prevDir;
        const check = applyScore90Filter(
          { direction: t.direction, signal_score: t.signal_score },
          prevTradeDir
        );
        if (check.pass) filteredTrades.push(t);
      }
      allTrades = filteredTrades;
    }

    const filteredWins = allTrades.filter(t => t.pnl_net_pct > 0).length;
    const filteredWinRate = allTrades.length > 0
      ? (filteredWins / allTrades.length) * 100 : 0;

    if (version.min_filtered_trades && allTrades.length < version.min_filtered_trades) {
      return {
        version_key: version.key, direction: null, entry_price: null,
        sl_price: null, tp_price: null, tp2_price: null,
        signal_time: null, alert_key: null,
        raw_win_rate: rawWinRate, raw_trades: rawTrades,
        filtered_trades: allTrades.length, filtered_win_rate: filteredWinRate,
        filter_reason: `歷史樣本不足（${allTrades.length}/${version.min_filtered_trades}）`,
      };
    }

    if (allTrades.length === 0) {
      return {
        version_key: version.key, direction: null, entry_price: null,
        sl_price: null, tp_price: null, tp2_price: null,
        signal_time: null, alert_key: null,
        raw_win_rate: rawWinRate, raw_trades: rawTrades,
        filtered_trades: 0, filtered_win_rate: 0,
        filter_reason: "無交易信號",
      };
    }

    const lastTrade = allTrades[allTrades.length - 1];

    if (version.max_signal_age_bars !== undefined) {
      const referenceTimeSec = typeof lastTrade.exit_time === "number" ? lastTrade.exit_time : Math.floor(Date.now() / 1000);
      const ageBars = (Math.floor(Date.now() / 1000) - referenceTimeSec) / 3600;
      if (ageBars > version.max_signal_age_bars) {
        return {
          version_key: version.key, direction: null, entry_price: null,
          sl_price: null, tp_price: null, tp2_price: null,
          signal_time: null, alert_key: null,
          raw_win_rate: rawWinRate, raw_trades: rawTrades,
          filtered_trades: allTrades.length, filtered_win_rate: filteredWinRate,
          filter_reason: `訊號過舊（${ageBars.toFixed(1)}h > ${version.max_signal_age_bars}h）`,
        };
      }
    }

    if (version.min_signal_score !== undefined) {
      const lastScore = typeof lastTrade.signal_score === "number" ? lastTrade.signal_score : null;
      if (lastScore === null || lastScore < version.min_signal_score) {
        return {
          version_key: version.key, direction: null, entry_price: null,
            sl_price: null, tp_price: null, tp2_price: null,
            signal_time: null, alert_key: null,
            raw_win_rate: rawWinRate, raw_trades: rawTrades,
            filtered_trades: allTrades.length, filtered_win_rate: filteredWinRate,
            filter_reason: `最新評分不足（${lastScore ?? "N/A"} < ${version.min_signal_score}）`,
        };
      }
    }

    let d1Trend = "neutral";
    if (version.use_1d) {
      d1Trend = get1dEma200Trend(candles1d);
      if (d1Trend !== "neutral") {
        const aligned = (lastTrade.direction === "long"  && d1Trend === "bullish") ||
                        (lastTrade.direction === "short" && d1Trend === "bearish");
        if (!aligned) {
          console.log(`[${version.short}] 1D EMA200 過濾：${lastTrade.direction} vs ${d1Trend}`);
          return {
            version_key: version.key, direction: null, entry_price: null,
            sl_price: null, tp_price: null, tp2_price: null,
            signal_time: null, alert_key: null,
            raw_win_rate: rawWinRate, raw_trades: rawTrades,
            filtered_trades: allTrades.length, filtered_win_rate: filteredWinRate,
            filter_reason: `1D EMA200 方向不符（1D=${d1Trend}，信號=${lastTrade.direction}）`,
            d1_trend: d1Trend,
          };
        }
      }
    }

    let m15Ok = true;
    if (version.use_15m) {
      m15Ok = check15mConfirmation(candles15m, lastTrade.direction as "long" | "short");
      if (!m15Ok) {
        console.log(`[${version.short}] 15m 確認未通過（${lastTrade.direction}）`);
        return {
          version_key: version.key, direction: null, entry_price: null,
          sl_price: null, tp_price: null, tp2_price: null,
          signal_time: null, alert_key: null,
          raw_win_rate: rawWinRate, raw_trades: rawTrades,
          filtered_trades: allTrades.length, filtered_win_rate: filteredWinRate,
          filter_reason: "15m EMA+趨勢確認未通過",
          d1_trend: d1Trend, m15_ok: false,
        };
      }
    }

    const alertKey = `${version.key}_${lastTrade.direction}_${lastTrade.entry_time}`;
    console.log(
      `[${version.short}] ${version.strategy} 信號 ${lastTrade.direction} @ ${lastTrade.entry_price?.toFixed(2)} | ` +
      `淨勝率 ${filteredWinRate.toFixed(1)}%（${allTrades.length}筆）` +
      (version.use_1d  ? ` | 1D=${d1Trend}` : '') +
      (version.use_15m ? ` | 15m=${m15Ok ? '✅' : '❌'}` : '')
    );

    return {
      version_key: version.key, direction: lastTrade.direction,
      entry_price: lastTrade.entry_price,
      sl_price: lastTrade.sl_price, tp_price: lastTrade.tp_price,
      tp2_price: lastTrade.tp2_price ?? lastTrade.tp_price,
      signal_time: lastTrade.entry_time,
      alert_key: alertKey, raw_win_rate: rawWinRate, raw_trades: rawTrades,
      filtered_trades: allTrades.length, filtered_win_rate: filteredWinRate,
      d1_trend: d1Trend, m15_ok: m15Ok,
    };
  } catch (err) {
    return {
      version_key: version.key, direction: null, entry_price: null,
      sl_price: null, tp_price: null, tp2_price: null,
      signal_time: null, alert_key: null,
      raw_win_rate: 0, raw_trades: 0,
      filtered_trades: 0, filtered_win_rate: 0,
      error: String(err),
    };
  }
}

// ── 市況 → 家族推薦映射 ──
// v4.4 市況→家族映射：只硬性迴避明確反向的組合，其餘由 evaluateSignal 的評分機制處理
const REGIME_FAMILY_MAP: Record<BoosterRegime, { recommended: StrategyFamily[]; avoid: StrategyFamily[] }> = {
  strong_trend: { recommended: ["trend_pullback", "trend_confirm"], avoid: [] },
  weak_trend:   { recommended: ["trend_pullback", "pa", "structure"], avoid: [] },
  ranging:      { recommended: ["mean_reversion", "pa", "structure", "trend_pullback"], avoid: [] },
  volatile:     { recommended: ["pa", "structure"], avoid: [] },
  compressed:   { recommended: ["structure", "pa"], avoid: [] },
};

// ── 勝率提升引擎的最低品質門檻（降低以避免過度過濾）──
const MIN_BOOST_SCORE = 40;         // evaluateSignal 最終分 >= 40 才推送
const MIN_ENTRY_QUALITY_SCORE = 30; // 進場品質分 >= 30

// ── 主掃描函數 v4.7（多幣對 + 勝率提升引擎）──
async function runOnceForSymbol(symbol: string): Promise<void> {
  const now = new Date().toISOString();
  console.log(`[LiveWorker v4.7][${symbol}] ========== 掃描開始 ${now} ==========（模式：${WIN_RATE_MODE}）`);

  let candles1h: Candle[], candles4h: Candle[], candles1d: Candle[], candles15m: Candle[];
  try {
    [candles1h, candles4h, candles1d, candles15m] = await Promise.all([
      fetchCandles(symbol, "1h",  500),
      fetchCandles(symbol, "4h",  500),
      fetchCandles(symbol, "1d",  400),
      fetchCandles(symbol, "15m", 500),
    ]);
    console.log(`[LiveWorker v4.7][${symbol}] K 線：1h=${candles1h.length} 4h=${candles4h.length} 1d=${candles1d.length} 15m=${candles15m.length}`);
    if (symbol === "BTCUSDT") _lastCandles1h = candles1h;
  } catch (err) {
    console.error(`[LiveWorker v4.7][${symbol}] K 線抑取失敗:`, err);
    return;
  }

  // ── v4.4 新增：市況感知 ──
  const regimeResult: RegimeResult = detectMarketRegime(candles1h as any);
  const currentRegime: BoosterRegime = regimeResult.regime;
  const regimeMap = REGIME_FAMILY_MAP[currentRegime];
  const sessionInfo: SessionInfo = getSessionInfo();
  const volAdaptive: VolatilityAdaptive = calcVolatilityAdaptive(candles1h as any);
  console.log(`[LiveWorker v4.4] 市況：${currentRegime}（信心 ${regimeResult.confidence}%）| ADX=${regimeResult.adx.toFixed(1)} ATR%=${regimeResult.atr_pct.toFixed(2)} BB%=${regimeResult.bb_width_pct.toFixed(2)}`);
  console.log(`[LiveWorker v4.4] 時段：${sessionInfo.session}（品質 ${sessionInfo.quality_multiplier}x）| 波動率：ATR 百分位 ${volAdaptive.atr_percentile}%${volAdaptive.is_low_vol ? '（低波動）' : volAdaptive.is_high_vol ? '（高波動）' : ''}`);
  console.log(`[LiveWorker v4.4] 推薦家族：[${regimeMap.recommended.join(', ')}] | 迴避家族：[${regimeMap.avoid.join(', ')}]`);

  // 並行執行五個策略
  const versionResults = await Promise.allSettled(
    STRATEGY_VERSIONS.map(v => runVersion(v, candles1h, candles4h, candles1d, candles15m, symbol))
  );

  // ── v4.4 新增：收集所有策略信號用於共振投票 ──
  const allStrategySignals: StrategySignal[] = [];
  for (let i = 0; i < STRATEGY_VERSIONS.length; i++) {
    const version = STRATEGY_VERSIONS[i];
    const settled = versionResults[i];
    if (settled.status === "fulfilled" && settled.value.direction) {
      allStrategySignals.push({
        key: version.key,
        family: version.family,
        direction: settled.value.direction as "long" | "short",
        score: settled.value.filtered_win_rate,
        confidence: Math.min(100, settled.value.filtered_trades * 10),
      });
    } else {
      allStrategySignals.push({
        key: version.key,
        family: version.family,
        direction: null,
        score: 0,
        confidence: 0,
      });
    }
  }

  // ── v4.4 新增：計算跨策略共振 ──
  const consensus: ConsensusResult = calcCrossStrategyConsensus(allStrategySignals);
  if (consensus.consensus_direction) {
    console.log(`[LiveWorker v4.4] 共振：${consensus.consensus_direction}（分數 ${consensus.consensus_score}，${consensus.agreeing_strategies.length} 策略同向，加乘 ${consensus.boost_multiplier}x${consensus.is_strong_consensus ? '，強共振' : ''}）`);
  } else {
    console.log(`[LiveWorker v4.4] 共振：無共識方向`);
  }

  const previousSnapshot = await readPreviousSnapshotFor(symbol);
  const previousStrategies = previousSnapshot?.state_overview?.strategies ?? {};

  const signals:          any[] = [];
  const dispatch_results: any[] = [];
  const strategy_errors:  any[] = [];
  const state_strategies: Record<string, any> = {};

  for (let i = 0; i < STRATEGY_VERSIONS.length; i++) {
    const version = STRATEGY_VERSIONS[i];
    const settled = versionResults[i];

    if (settled.status === "rejected") {
      const governance = getWorkerGovernance(version.key);
      strategy_errors.push({ version_key: version.key, label: version.label, error: String(settled.reason) });
      state_strategies[version.key] = {
        last_status: "error",
        last_filter_reason: String(settled.reason),
        governance_summary: governance?.summary,
        checked_at: now,
      };
      continue;
    }

    const r = settled.value;
    const governance = getWorkerGovernance(version.key);
    if (r.error) {
      strategy_errors.push({ preset_key: version.key, version_key: version.key, label: version.label, error: r.error });
      state_strategies[version.key] = {
        last_status: "error",
        last_filter_reason: r.error,
        governance_summary: governance?.summary,
        checked_at: now,
      };
    }

    if (r.direction && r.entry_price && r.alert_key) {
      // ── v4.4 新增：市況家族過濾 ──
      const isAvoided = regimeMap.avoid.includes(version.family);
      if (isAvoided) {
        console.log(`[${version.short}] 🚫 市況過濾：${currentRegime} 不推薦 ${version.family} 家族`);
        state_strategies[version.key] = {
          last_status: "blocked",
          last_filter_reason: `市況過濾（${currentRegime} 迴避 ${version.family}）`,
          governance_summary: governance?.summary,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          checked_at: now,
          regime: currentRegime,
        };
        continue;
      }

      // ── v4.4 新增：綜合勝率提升評估（共振 + 品質 + 時段 + 波動率）──
      const boostResult: WinRateBoostResult = evaluateSignal(
        allStrategySignals,
        version.key,
        candles1h as any,
        candles4h as any,
        version.family,
        version.tp,
        version.sl,
        MIN_BOOST_SCORE
      );

      // ── v4.4 新增：Veto 否決權 ──
      if (!boostResult.should_trade) {
        const vetoReasons = boostResult.reasoning.filter(r => r.includes('不') || r.includes('非') || r.includes('極端') || r.includes('低')).slice(0, 2);
        const vetoSummary = vetoReasons.length > 0 ? vetoReasons.join('；') : `綜合評分不足（${boostResult.final_score}/${MIN_BOOST_SCORE}）`;
        console.log(`[${version.short}] 🛑 Veto 否決：${vetoSummary}（品質分 ${boostResult.entry_quality.quality_score}，綜合分 ${boostResult.final_score}）`);
        state_strategies[version.key] = {
          last_status: "blocked",
          last_filter_reason: `Veto：${vetoSummary}`,
          governance_summary: governance?.summary,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          checked_at: now,
          regime: currentRegime,
          boost_score: boostResult.final_score,
          entry_quality_score: boostResult.entry_quality.quality_score,
        };
        continue;
      }

      // ── v4.5 新增：高勝率確認清單（8 項核心 + PA 3 項額外）──
      const checklistResult = runHighWinRateChecklist(
        r.direction as "long" | "short",
        candles1h as any,
        candles4h as any,
        version.family,
      );
      if (!checklistResult.pass) {
        const failSummary = checklistResult.failed_checks.slice(0, 3).join(', ');
        console.log(`[${version.short}] 🚫 確認清單未通過（核心 ${8 - checklistResult.failed_checks.filter(f => !f.startsWith('PA')).length}/8）：${failSummary}`);
        state_strategies[version.key] = {
          last_status: "blocked",
          last_filter_reason: `確認清單：${failSummary}`,
          governance_summary: governance?.summary,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          checked_at: now,
          regime: currentRegime,
          boost_score: boostResult.final_score,
          entry_quality_score: boostResult.entry_quality.quality_score,
          checklist_passed: checklistResult.passed_count,
          checklist_total: checklistResult.total_checks,
        };
        continue;
      }

      signals.push({
        preset_key:        version.key,
        version_key:       version.key,
        version_label:     version.label,
        direction:         r.direction,
        entry_price:       r.entry_price,
        signal_time:       r.signal_time,
        alert_key:         r.alert_key,
        filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
        filtered_trades:   r.filtered_trades,
        d1_trend:          r.d1_trend,
        m15_ok:            r.m15_ok,
        // v4.4 新增欄位
        boost_score:       boostResult.final_score,
        entry_quality:     boostResult.entry_quality.quality_score,
        regime:            currentRegime,
        consensus_score:   consensus.consensus_score,
        session:           sessionInfo.session,
        exit_plan:         boostResult.exit_plan,
      });

      const prevAlertKey = lastAlertKey.get(stateKey(symbol, version.key));
      const isNew = prevAlertKey !== r.alert_key;

      // ── NEW-A 方案：只推送 PA 和 HWR-B 策略 ──
      const PUSH_WHITELIST: StrategyFamily[] = ["pa", "trend_pullback"];
      const isPushAllowed = PUSH_WHITELIST.includes(version.family);

      if (isNew && isPushAllowed) {
        const dirEmoji = r.direction === "long" ? "📈" : "📉";
        const dirLabel = r.direction === "long" ? "做多" : "做空";
        // 價格格式化函數：根據價格大小自動調整小數位
        const fmtPrice = (p: number) => {
          if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (p >= 1) return p.toFixed(4);
          return p.toFixed(6);
        };
        const priceStr = fmtPrice(r.entry_price);

        // 實際止損/止盈價格
        const slPrice = r.sl_price ?? 0;
        const tpPrice = r.tp_price ?? 0;
        const tp2Price = r.tp2_price ?? tpPrice;
        const slStr = slPrice > 0 ? fmtPrice(slPrice) : "N/A";
        const tpStr = tpPrice > 0 ? fmtPrice(tpPrice) : "N/A";
        const tp2Str = tp2Price > 0 ? fmtPrice(tp2Price) : "N/A";
        const slDist = slPrice > 0 && r.entry_price > 0 ? Math.abs(((slPrice - r.entry_price) / r.entry_price) * 100).toFixed(2) : "N/A";
        const tpDist = tpPrice > 0 && r.entry_price > 0 ? Math.abs(((tpPrice - r.entry_price) / r.entry_price) * 100).toFixed(2) : "N/A";
        const rrRatio = slPrice > 0 && r.entry_price > 0 && tpPrice > 0
          ? (Math.abs(tpPrice - r.entry_price) / Math.abs(r.entry_price - slPrice)).toFixed(2)
          : "N/A";

        // 策略說明行
        let strategyInfo = "";
        if (version.family === "pa") {
          strategyInfo = `⚙️ PA 主力：1D EMA200 + 15m確認 + score≥9.0`;
        } else if (version.family === "trend_pullback") {
          strategyInfo = `⚙️ HWR-B：趨勢回踩延續 / 含手續費`;
        }

        const d1Line = version.use_1d
          ? `1D EMA200：${r.d1_trend === "bullish" ? "📊 多頭" : r.d1_trend === "bearish" ? "📉 空頭" : "➖ 中性"}`
          : null;
        const m15Line = version.use_15m
          ? `15m 確認：${r.m15_ok ? "✅ 通過" : "❌ 未通過"}`
          : null;

        // v4.4 新增：智能出場建議行
        const exitPlan = boostResult.exit_plan;

        // 品質與共振資訊行
        const qualityLine = `🎯 品質分：${boostResult.final_score}/100 | 進場品質：${boostResult.entry_quality.quality_score}/100`;
        const regimeLine = `📊 市況：${currentRegime}（${regimeResult.confidence}%）| 共振：${consensus.consensus_score}分${consensus.is_strong_consensus ? '（強共振）' : ''}`;
        const sessionLine = `🕐 時段：${sessionInfo.session}（${sessionInfo.quality_multiplier}x）| 波動率：${volAdaptive.atr_percentile}%`;

        const msg = [
          `🔔 <b>${symbol} NEW-A 方案信號</b>${checklistResult.tier === 'S' ? ' 【S 級強信號】' : checklistResult.tier === 'A' ? ' 【A 級次級信號】' : ''}`,
          ``,
          `${dirEmoji} <b>${version.label}</b>`,
          `方向：<b>${dirLabel}</b>`,
          ``,
          `📌 <b>進場價：</b><code>${priceStr}</code>`,
          `🛑 <b>止損：</b><code>${slStr}</code>  (-${slDist}%)`,
          `🎯 <b>止盈1：</b><code>${tpStr}</code>  (+${tpDist}%)`,
          `🎯 <b>止盈2：</b><code>${tp2Str}</code>`,
          `⚖️ <b>RR 比：</b>${rrRatio}`,
          ``,
          strategyInfo,
          `過濾後勝率：${r.filtered_win_rate.toFixed(1)}%（${r.filtered_trades} 筆）`,
          d1Line,
          m15Line,
          ``,
          qualityLine,
          regimeLine,
          sessionLine,
          ``,
          `📊 一年回測：${version.backtest_return}（${version.backtest_trades}筆/年）`,
          exitPlan.reasoning ? `💬 ${exitPlan.reasoning}` : null,
          ``,
          `📦 <i>NEW-A 方案：12 高勝率幣對 × PA+HWR S 級（勝率 80.2% / 2.8天/筆）</i>`,
        ].filter(Boolean).join("\n");

        await sendTelegram(msg);
        lastAlertKey.set(stateKey(symbol, version.key), r.alert_key);
        lastSignalDir.set(stateKey(symbol, version.key), r.direction);
        dispatch_results.push({
          preset_key: version.key, version_key: version.key, alert_key: r.alert_key,
          status: "sent", sent_at: new Date().toISOString(),
        });
        state_strategies[version.key] = {
          last_alert_key: r.alert_key,
          last_entry_time: r.signal_time,
          last_sent_at: new Date().toISOString(),
          last_status: "sent",
          last_direction: r.direction,
          last_filter_reason: null,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          governance_summary: governance?.summary,
          checked_at: now,
          regime: currentRegime,
          boost_score: boostResult.final_score,
          entry_quality_score: boostResult.entry_quality.quality_score,
          exit_plan: boostResult.exit_plan,
        };
        console.log(`[${version.short}] ✅ 新信號 ${dirLabel} @ ${priceStr}（Tier ${checklistResult.tier}，品質 ${boostResult.final_score}分），已推送 Telegram`);
      } else if (isNew && !isPushAllowed) {
        // NEW-A 方案：非白名單策略不推送 Telegram，僅記錄
        lastAlertKey.set(stateKey(symbol, version.key), r.alert_key);
        lastSignalDir.set(stateKey(symbol, version.key), r.direction);
        dispatch_results.push({ preset_key: version.key, version_key: version.key, alert_key: r.alert_key, status: "blocked" });
        state_strategies[version.key] = {
          last_alert_key: r.alert_key,
          last_entry_time: r.signal_time,
          last_sent_at: null,
          last_status: "blocked",
          last_direction: r.direction,
          last_filter_reason: `NEW-A 白名單過濾（${version.family} 不在 PA/HWR-B 白名單中）`,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          governance_summary: governance?.summary,
          checked_at: now,
        };
        console.log(`[${version.short}] 🚫 NEW-A 白名單過濾：${version.family} 策略不推送 Telegram`);
      } else {
        dispatch_results.push({ preset_key: version.key, version_key: version.key, alert_key: r.alert_key, status: "duplicate_skip" });
        state_strategies[version.key] = {
          last_alert_key: r.alert_key,
          last_entry_time: r.signal_time,
          last_status: "duplicate_skip",
          last_direction: r.direction,
          last_filter_reason: null,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          governance_summary: governance?.summary,
          checked_at: now,
        };
        console.log(`[${version.short}] ⏭ 信號重複，跳過推送`);
      }
    } else {
      state_strategies[version.key] = {
        last_status: r.filter_reason ? "blocked" : "idle",
        last_filter_reason: r.filter_reason ?? null,
        governance_summary: governance?.summary,
        filtered_trades: r.filtered_trades,
        filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
        checked_at: now,
      };
      console.log(`[${version.short}] 無信號${r.filter_reason ? `（${r.filter_reason}）` : ""}`);
    }
  }

  const strategiesWithDiagnostics = Object.fromEntries(
    STRATEGY_VERSIONS.map((version) => {
      const currentState = state_strategies[version.key] ?? {
        last_status: "idle",
        last_filter_reason: null,
        governance_summary: getWorkerGovernance(version.key)?.summary,
        checked_at: now,
      };
      const previousHistory = Array.isArray(previousStrategies?.[version.key]?.history)
        ? previousStrategies[version.key].history.filter((item: any) => item && typeof item.checked_at === "string")
        : [];
      const history = [...previousHistory, buildHistoryEntry(currentState, now)].slice(-DIAGNOSTIC_HISTORY_WINDOW);
      return [
        version.key,
        {
          ...currentState,
          history,
          diagnostics: buildStrategyDiagnostics(history),
        },
      ];
    })
  );

  // ── 診斷增強：家族聚合 + 門檻建議 + 趨勢序列 ──
  const diagnosticsEnrichment = buildDiagnosticsEnrichment(
    strategiesWithDiagnostics,
    STRATEGY_VERSIONS.map(v => ({ key: v.key, family: v.family, label: v.label }))
  );

  // ── 寫入 snapshot JSON ──
  const snapshot = {
    generated_at:    now,
    worker_version:  "v4.4",
    active_presets: STRATEGY_VERSIONS.map(v => ({
      key: v.key,
      label: v.label,
      family: v.family,
      tp: v.tp,
      sl: v.sl,
      use_1d: v.use_1d,
      use_15m: v.use_15m,
      backtest_return: v.backtest_return,
      backtest_trades: v.backtest_trades,
      governance: getWorkerGovernance(v.key),
    })),
    // v4.4 新增：市況與共振快照
    market_context: {
      regime: currentRegime,
      regime_confidence: regimeResult.confidence,
      adx: regimeResult.adx,
      atr_pct: regimeResult.atr_pct,
      bb_width_pct: regimeResult.bb_width_pct,
      recommended_families: regimeMap.recommended,
      avoid_families: regimeMap.avoid,
      session: sessionInfo.session,
      session_quality: sessionInfo.quality_multiplier,
      volatility_percentile: volAdaptive.atr_percentile,
      volatility_adjustment: volAdaptive.score_adjustment,
      consensus_direction: consensus.consensus_direction,
      consensus_score: consensus.consensus_score,
      consensus_strong: consensus.is_strong_consensus,
      consensus_boost: consensus.boost_multiplier,
    },
    signals,
    dispatch_results,
    strategy_errors,
    state_overview: {
      last_checked_at: now,
      last_error_message: strategy_errors.length > 0 ? strategy_errors[0].error : undefined,
      history_window: DIAGNOSTIC_HISTORY_WINDOW,
      strategies: strategiesWithDiagnostics,
    },
    diagnostics_enrichment: diagnosticsEnrichment,
  };

  const snapshotPath = snapshotPathFor(symbol);
  try {
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    // 加入 symbol 欄位以便前端辨識
    const snapshotWithSymbol = { ...snapshot, symbol, worker_version: "v4.7" };
    await fs.writeFile(snapshotPath, JSON.stringify(snapshotWithSymbol, null, 2), "utf-8");
    console.log(`[LiveWorker v4.7][${symbol}] ✅ Snapshot 已寫入 ${snapshotPath}`);
  } catch (err) {
    console.error(`[LiveWorker v4.7][${symbol}] Snapshot 寫入失敗:`, err);
  }

  console.log(`[LiveWorker v4.7][${symbol}] ========== 掃描完成 ==========\n`);
}

// 多幣對包裝器：依序掃描所有 SYMBOLS
async function runOnce(): Promise<void> {
  console.log(`[LiveWorker v4.7] ┏━━ 多幣對輪詢開始：${SYMBOLS.join(", ")} ━━┓`);
  for (const sym of SYMBOLS) {
    try {
      await runOnceForSymbol(sym);
    } catch (err) {
      console.error(`[LiveWorker v4.7][${sym}] 掃描出錯:`, err);
    }
  }
  console.log(`[LiveWorker v4.7] ┗━━ 多幣對輪詢完成 ━━┙\n`);
}

/// ── ATR 驅動動態掃描間隔 ──
// 正常市況：2 分鐘掃描一次
// 高波動市況（ATR 相對值 > 1.5 倍均值）：縮短至 1 分鐘，捕捉快速行情
const INTERVAL_NORMAL_MS  = 2 * 60 * 1000;  // 2 分鐘
const INTERVAL_VOLATILE_MS = 1 * 60 * 1000; // 1 分鐘（高波動）
const ATR_VOLATILE_RATIO  = 1.5;             // ATR 超過均值 1.5 倍視為高波動

// 計算最近 1H K 線的 ATR（簡化版，用於判斷市場波動度）
function calcAtrRatio(candles: Candle[]): number {
  if (candles.length < 20) return 1.0;
  const atrs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close)
    );
    atrs.push(tr);
  }
  const recent14 = atrs.slice(-14);
  const avg50    = atrs.slice(-50);
  const atrNow   = recent14.reduce((a, b) => a + b, 0) / recent14.length;
  const atrAvg   = avg50.reduce((a, b) => a + b, 0)   / avg50.length;
  return atrAvg > 0 ? atrNow / atrAvg : 1.0;
}

// 動態調度器：每次掃描完成後，根據 ATR 決定下次掃描時間
let _lastCandles1h: Candle[] = [];
async function scheduleNext(): Promise<void> {
  try {
    await runOnce();
  } catch (err) {
    console.error("[LiveWorker v4.1] 執行失敗:", err);
  }
  // 使用上次抓到的 1H K 線計算 ATR 比率
  const atrRatio = calcAtrRatio(_lastCandles1h);
  const nextMs   = atrRatio >= ATR_VOLATILE_RATIO ? INTERVAL_VOLATILE_MS : INTERVAL_NORMAL_MS;
  const label    = atrRatio >= ATR_VOLATILE_RATIO
    ? `⚡ 高波動（ATR×${atrRatio.toFixed(2)}），縮短至 ${nextMs / 60000} 分鐘`
    : `正常（ATR×${atrRatio.toFixed(2)}），維持 ${nextMs / 60000} 分鐘`;
  console.log(`[LiveWorker v4.2] 下次掃描：${label}`);
  setTimeout(scheduleNext, nextMs);
}

// ── 啟動 ──
console.log(`[LiveWorker v4.7] 🚀 NEW-A 方案 Worker 啟動（${SYMBOLS.length} 幣對：${SYMBOLS.join(", ")}）`);
console.log(`[LiveWorker v4.7] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`[LiveWorker v4.7] NEW-A 方案：12 高勝率幣對 × PA+HWR S 級`);
console.log(`[LiveWorker v4.7] 目標：勝率 80.2% / 2.8天/筆 / PF 4.73`);
console.log(`[LiveWorker v4.7] Telegram 推送白名單：PA + HWR-B（其他策略僅記錄不推送）`);
console.log(`[LiveWorker v4.7] 推送內容：進場價 + 止損價 + 止盈價 + RR比 + 品質分`);
console.log(`[LiveWorker v4.7] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`[LiveWorker v4.7] Snapshot：${SNAPSHOT_PATH}`);
console.log(`[LiveWorker v4.7] 掃描間隔：正常 ${INTERVAL_NORMAL_MS / 60000} 分鐘 / 高波動 ${INTERVAL_VOLATILE_MS / 60000} 分鐘`);
scheduleNext();
