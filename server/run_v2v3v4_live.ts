/**
 * BTCUSDT Live Signal Worker v3.0
 * 三策略演化版本並行監控
 *
 * 策略版本：
 *   V2：TP=0.5 + score9.0+bonus1.5（無1D，無15m）             → 回測 +6.73%
 *   V3：TP=0.5 + score9.0+bonus1.5 + 1D EMA200               → 回測 +13.33%（最高報酬）
 *   V4：TP=0.5 + score9.0+bonus1.5 + 1D EMA200 + 15m確認     → 回測 +10.11%（最低回撤）
 *
 * 每 2 分鐘掃描一次，各策略獨立推送 Telegram 信號
 */
import fs from "fs/promises";
import path from "path";
import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS, type LivePreset } from "./live_btcusdt_strategy_presets.js";

// ── 設定 ──
const SNAPSHOT_PATH =
  process.env.LATEST_LIVE_SNAPSHOT_PATH ??
  "/home/ubuntu/runtime/btcusdt_live_signal_snapshot.json";
const INTERVAL_MS       = 2 * 60 * 1000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? "";

// ── 基礎策略 preset（使用 181 的所有參數，只覆蓋 TP）──
const BASE_PRESET = BTCUSDT_LIVE_PRESETS.find(p => p.key === 'btcusdt_1h_single_strategy_181')!;

// ── 三個策略版本定義 ──
const STRATEGY_VERSIONS = [
  {
    key:     'v2_tp05_score90',
    label:   '🔵 V2：TP=0.5 + score9.0（基礎版）',
    short:   'V2',
    tp:      0.5,
    use_1d:  false,
    use_15m: false,
    m15_mode: 'both' as const,
    m15_lookback: 3,
    backtest_return: '+6.73%',
  },
  {
    key:     'v3_tp05_score90_1d',
    label:   '🟡 V3：TP=0.5 + score9.0 + 1D EMA200',
    short:   'V3',
    tp:      0.5,
    use_1d:  true,
    use_15m: false,
    m15_mode: 'both' as const,
    m15_lookback: 3,
    backtest_return: '+13.33%',
  },
  {
    key:     'v4_tp05_score90_1d_15m',
    label:   '🟢 V4：TP=0.5 + score9.0 + 1D EMA200 + 15m確認',
    short:   'V4',
    tp:      0.5,
    use_1d:  true,
    use_15m: true,
    m15_mode: 'both' as const,
    m15_lookback: 3,
    backtest_return: '+10.11%',
  },
];

// ── 狀態追蹤 ──
const lastAlertKey  = new Map<string, string>();
const lastDirection = new Map<string, string>();

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
      console.error(`[LiveWorker] Telegram 推送失敗: ${resp.status} – ${err.slice(0, 100)}`);
    }
  } catch (err) {
    console.error(`[LiveWorker] Telegram 推送異常:`, err);
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

function calcAtr(candles: Candle[], idx: number): number {
  const start = Math.max(1, idx - 13);
  let sum = 0, count = 0;
  for (let i = start; i <= idx; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    count++;
  }
  return count > 0 ? sum / count : candles[idx].high - candles[idx].low;
}

// ── 1D EMA200 趨勢判斷 ──
function get1dEma200Trend(candles1d: Candle[]): "bullish" | "bearish" | "neutral" {
  if (candles1d.length < 50) return "neutral";
  const closes = candles1d.map(c => c.close);
  const period = Math.min(200, closes.length);
  const ema = calcEma(closes, period);
  const lastEma = ema[ema.length - 1];
  const lastClose = closes[closes.length - 1];
  if (isNaN(lastEma)) return "neutral";
  if (lastClose > lastEma * 1.002) return "bullish";
  if (lastClose < lastEma * 0.998) return "bearish";
  return "neutral";
}

// ── 15m 執行確認（EMA + 趨勢，lookback=3根）──
function check15mConfirmation(
  candles15m: Candle[],
  direction: "long" | "short"
): boolean {
  if (candles15m.length < 20) return true;
  const closes = candles15m.map(c => c.close);
  const ema20 = calcEma(closes, 20);
  const ema50 = calcEma(closes, 50);
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  // EMA 確認
  let emaOk = true;
  if (!isNaN(lastEma20) && !isNaN(lastEma50)) {
    if (direction === "long"  && lastEma20 < lastEma50 * 0.999) emaOk = false;
    if (direction === "short" && lastEma20 > lastEma50 * 1.001) emaOk = false;
  }
  // 趨勢確認（最近 3 根）
  const recent3 = candles15m.slice(-3);
  let bullCount = 0, bearCount = 0;
  for (const b of recent3) {
    if (b.close > b.open) bullCount++; else bearCount++;
  }
  const trendOk = direction === "long" ? bullCount > bearCount : bearCount > bullCount;
  return emaOk && trendOk;
}

// ── pa_* 後過濾（score9.0+bonus1.5）──
function checkRetestConfirmation(
  candles: Candle[], idx: number, direction: "long" | "short",
  entryPrice: number, atr: number,
  retestMode: string, lookbackBars: number,
  touchToleranceAtr: number, reclaimOffsetAtr: number,
  requireCandleColor: boolean
): boolean {
  const lookback = Math.min(lookbackBars, idx);
  const touchTol = atr * touchToleranceAtr;
  const reclaimOff = atr * reclaimOffsetAtr;
  for (let j = idx - lookback; j <= idx; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (direction === "long") {
      const touched   = c.low  <= entryPrice + touchTol;
      const reclaimed = c.close >= entryPrice - reclaimOff;
      const colorOk   = !requireCandleColor || c.close >= c.open;
      if (touched && reclaimed && colorOk) return true;
      if (touched && j + 1 <= idx) {
        const nx = candles[j + 1];
        if (nx.close >= entryPrice - reclaimOff && (!requireCandleColor || nx.close >= nx.open)) return true;
      }
    } else {
      const touched   = c.high >= entryPrice - touchTol;
      const reclaimed = c.close <= entryPrice + reclaimOff;
      const colorOk   = !requireCandleColor || c.close <= c.open;
      if (touched && reclaimed && colorOk) return true;
      if (touched && j + 1 <= idx) {
        const nx = candles[j + 1];
        if (nx.close <= entryPrice + reclaimOff && (!requireCandleColor || nx.close <= nx.open)) return true;
      }
    }
  }
  return false;
}

function checkDualTfResonance(
  candles: Candle[], idx: number, direction: "long" | "short",
  biasWindowBars: number, minScore: number
): boolean {
  if (idx < biasWindowBars + 5) return false;
  const recentCandles = candles.slice(Math.max(0, idx - biasWindowBars), idx + 1);
  let bullCount = 0, bearCount = 0;
  for (const rc of recentCandles) { if (rc.close > rc.open) bullCount++; else bearCount++; }
  if (direction === "long"  && bullCount <= bearCount) return false;
  if (direction === "short" && bearCount <= bullCount) return false;
  let score = 50;
  const c = candles[idx], prevC = candles[idx - 1];
  if (direction === "long"  && c.close > prevC.close) score += 20;
  if (direction === "short" && c.close < prevC.close) score += 20;
  const slice10 = candles.slice(Math.max(0, idx - 9), idx + 1);
  const high10 = Math.max(...slice10.map(c => c.high));
  const low10  = Math.min(...slice10.map(c => c.low));
  const range10 = high10 - low10;
  if (range10 > 0) {
    const pos = (c.close - low10) / range10;
    if (direction === "long"  && pos > 0.6) score += 15;
    if (direction === "short" && pos < 0.4) score += 15;
  }
  return score >= minScore;
}

function isInTradingSession(mode: string | undefined): boolean {
  if (!mode || mode === "all") return true;
  const utcHour = new Date().getUTCHours();
  if (mode === "exclude_offhours") return !(utcHour >= 0 && utcHour < 6);
  if (mode === "london_newyork")   return (utcHour >= 7 && utcHour <= 22);
  return true;
}

function applyScore90Filter(
  candles: Candle[],
  trade: { direction: string; entry_price: number; entry_time: number; entry_type?: string; signal_score?: number }
): { pass: boolean; reason?: string } {
  const preset = BASE_PRESET;
  if (!isInTradingSession(preset.pa_session_mode)) return { pass: false, reason: "非交易時段" };
  let idx = candles.findIndex(c => c.time >= trade.entry_time);
  if (idx < 0) idx = candles.length - 1;
  const atr = calcAtr(candles, idx);
  if (trade.entry_type === "PA_PATTERN"       && !preset.pa_allow_pattern)       return { pass: false, reason: "PA_PATTERN 不允許" };
  if (trade.entry_type === "PA_TRUE_BREAKOUT" && !preset.pa_allow_true_breakout) return { pass: false, reason: "PA_TRUE_BREAKOUT 不允許" };
  if (trade.entry_type === "PA_2ND_LEG_TRAP"  && !preset.pa_allow_trap)          return { pass: false, reason: "PA_2ND_LEG_TRAP 不允許" };
  if (trade.signal_score !== undefined) {
    const hasRetest = checkRetestConfirmation(
      candles, idx, trade.direction as "long" | "short",
      trade.entry_price, atr, preset.pa_retest_mode, preset.pa_retest_lookback_bars,
      0.08, preset.pa_retest_reclaim_offset_atr, preset.pa_retest_require_candle_color
    );
    const effectiveScore = trade.signal_score + (hasRetest ? 1.5 : 0);
    if (effectiveScore < 9.0) return { pass: false, reason: `評分不足（${effectiveScore.toFixed(1)} < 9.0）` };
  }
  if (preset.pa_dual_tf_resonance) {
    if (!checkDualTfResonance(candles, idx, trade.direction as "long" | "short",
        preset.pa_resonance_bias_window_bars ?? 2, preset.pa_resonance_min_score ?? 40)) {
      return { pass: false, reason: "未通過雙時間框架共振" };
    }
  }
  return { pass: true };
}

// ── 執行單個策略版本 ──
async function runVersion(
  version: typeof STRATEGY_VERSIONS[0],
  candles1h: Candle[],
  candles4h: Candle[],
  candles1d: Candle[],
  candles15m: Candle[]
): Promise<{
  version_key:      string;
  direction:        string | null;
  entry_price:      number | null;
  signal_time:      number | null;
  alert_key:        string | null;
  raw_win_rate:     number;
  raw_trades:       number;
  filtered_trades:  number;
  filtered_win_rate: number;
  filter_reason?:   string;
  d1_trend?:        string;
  m15_ok?:          boolean;
  error?:           string;
}> {
  try {
    // 執行回測
    const result = runBacktest({
      candles:              candles1h,
      strategy:             BASE_PRESET.strategy,
      symbol:               BASE_PRESET.symbol,
      interval:             BASE_PRESET.interval,
      atr_sl_mult:          BASE_PRESET.atr_sl_mult,
      atr_tp_mult:          version.tp,
      enable_mtf_filter:    BASE_PRESET.enable_mtf_filter,
      enable_adx_filter:    BASE_PRESET.enable_adx_filter,
      enable_trailing_stop: BASE_PRESET.enable_trailing_stop,
      enable_fee:           false,
      candles_4h:           candles4h,
    });
    const allTrades = result.trades ?? [];

    // 套用 score9.0+bonus1.5 過濾
    const filteredTrades = allTrades.filter(t =>
      applyScore90Filter(candles1h, {
        direction: t.direction, entry_price: t.entry_price,
        entry_time: t.entry_time, entry_type: t.entry_type,
        signal_score: t.signal_score,
      }).pass
    );

    const filteredWins    = filteredTrades.filter(t => t.pnl_pct > 0).length;
    const filteredWinRate = filteredTrades.length > 0
      ? (filteredWins / filteredTrades.length) * 100 : 0;

    if (filteredTrades.length === 0) {
      return {
        version_key: version.key, direction: null, entry_price: null,
        signal_time: null, alert_key: null,
        raw_win_rate: result.win_rate, raw_trades: result.total_trades,
        filtered_trades: 0, filtered_win_rate: 0,
      };
    }

    const lastTrade = filteredTrades[filteredTrades.length - 1];

    // 1D EMA200 過濾（V3/V4）
    let d1Trend: string = "neutral";
    if (version.use_1d) {
      d1Trend = get1dEma200Trend(candles1d);
      if (d1Trend !== "neutral") {
        const aligned = (lastTrade.direction === "long" && d1Trend === "bullish") ||
                        (lastTrade.direction === "short" && d1Trend === "bearish");
        if (!aligned) {
          console.log(`[${version.short}] 1D EMA200 過濾：${lastTrade.direction} vs ${d1Trend}`);
          return {
            version_key: version.key, direction: null, entry_price: null,
            signal_time: null, alert_key: null,
            raw_win_rate: result.win_rate, raw_trades: result.total_trades,
            filtered_trades: filteredTrades.length, filtered_win_rate: filteredWinRate,
            filter_reason: `1D EMA200 方向不符（1D=${d1Trend}，信號=${lastTrade.direction}）`,
            d1_trend: d1Trend,
          };
        }
      }
    }

    // 15m 確認（V4）
    let m15Ok = true;
    if (version.use_15m) {
      m15Ok = check15mConfirmation(candles15m, lastTrade.direction as "long" | "short");
      if (!m15Ok) {
        console.log(`[${version.short}] 15m 確認未通過（${lastTrade.direction}）`);
        return {
          version_key: version.key, direction: null, entry_price: null,
          signal_time: null, alert_key: null,
          raw_win_rate: result.win_rate, raw_trades: result.total_trades,
          filtered_trades: filteredTrades.length, filtered_win_rate: filteredWinRate,
          filter_reason: "15m EMA+趨勢確認未通過",
          d1_trend: d1Trend, m15_ok: false,
        };
      }
    }

    lastDirection.set(version.key, lastTrade.direction);
    const alertKey = `${version.key}_${lastTrade.direction}_${lastTrade.entry_time}`;
    console.log(
      `[${version.short}] 過濾後勝率 ${filteredWinRate.toFixed(1)}%（${filteredTrades.length}筆）` +
      (version.use_1d ? ` | 1D=${d1Trend}` : '') +
      (version.use_15m ? ` | 15m=${m15Ok ? '✅' : '❌'}` : '')
    );
    return {
      version_key: version.key, direction: lastTrade.direction,
      entry_price: lastTrade.entry_price, signal_time: lastTrade.entry_time,
      alert_key: alertKey, raw_win_rate: result.win_rate, raw_trades: result.total_trades,
      filtered_trades: filteredTrades.length, filtered_win_rate: filteredWinRate,
      d1_trend: d1Trend, m15_ok: m15Ok,
    };
  } catch (err) {
    return {
      version_key: version.key, direction: null, entry_price: null,
      signal_time: null, alert_key: null,
      raw_win_rate: 0, raw_trades: 0, filtered_trades: 0, filtered_win_rate: 0,
      error: String(err),
    };
  }
}

// ── 主掃描函數 ──
async function runOnce(): Promise<void> {
  const now = new Date().toISOString();
  console.log(`\n[LiveWorker v3.0] ========== 掃描開始 ${now} ==========`);

  // 一次性抓取所有 K 線（共用）
  let candles1h: Candle[], candles4h: Candle[], candles1d: Candle[], candles15m: Candle[];
  try {
    [candles1h, candles4h, candles1d, candles15m] = await Promise.all([
      fetchCandles("BTCUSDT", "1h",  500) as Promise<Candle[]>,
      fetchCandles("BTCUSDT", "4h",  200) as Promise<Candle[]>,
      fetchCandles("BTCUSDT", "1d",  250) as Promise<Candle[]>,
      fetchCandles("BTCUSDT", "15m", 200) as Promise<Candle[]>,
    ]);
    console.log(`[LiveWorker v3.0] K 線抓取完成：1H=${candles1h.length} 4H=${candles4h.length} 1D=${candles1d.length} 15m=${candles15m.length}`);
  } catch (err) {
    console.error(`[LiveWorker v3.0] K 線抓取失敗:`, err);
    return;
  }

  // 並行執行三個策略版本
  const versionResults = await Promise.allSettled(
    STRATEGY_VERSIONS.map(v => runVersion(v, candles1h, candles4h, candles1d, candles15m))
  );

  const signals: any[] = [];
  const dispatch_results: any[] = [];
  const strategy_errors: any[] = [];
  const state_strategies: Record<string, any> = {};

  for (let i = 0; i < STRATEGY_VERSIONS.length; i++) {
    const version = STRATEGY_VERSIONS[i];
    const settled = versionResults[i];

    if (settled.status === "rejected") {
      strategy_errors.push({ version_key: version.key, label: version.label, error: String(settled.reason) });
      continue;
    }

    const r = settled.value;
    if (r.error) {
      strategy_errors.push({ version_key: version.key, label: version.label, error: r.error });
    }

    if (r.direction && r.entry_price && r.alert_key) {
      signals.push({
        version_key:       version.key,
        version_label:     version.label,
        direction:         r.direction,
        entry_price:       r.entry_price,
        signal_time:       r.signal_time,
        alert_key:         r.alert_key,
        filtered_win_rate: r.filtered_win_rate,
        filtered_trades:   r.filtered_trades,
        d1_trend:          r.d1_trend,
        m15_ok:            r.m15_ok,
      });

      const prevAlertKey = lastAlertKey.get(version.key);
      const isNew = prevAlertKey !== r.alert_key;

      if (isNew) {
        const dirEmoji = r.direction === "long" ? "📈" : "📉";
        const dirLabel = r.direction === "long" ? "做多" : "做空";
        const priceStr = r.entry_price.toLocaleString("en-US", {
          minimumFractionDigits: 2, maximumFractionDigits: 2,
        });
        const d1Line = version.use_1d
          ? `1D EMA200：${r.d1_trend === "bullish" ? "📊 多頭" : r.d1_trend === "bearish" ? "📉 空頭" : "➖ 中性"}`
          : null;
        const m15Line = version.use_15m
          ? `15m 確認：${r.m15_ok ? "✅ 通過" : "❌ 未通過"}`
          : null;
        const msg = [
          `🔔 <b>BTCUSDT 實戰信號</b>`,
          ``,
          `${dirEmoji} <b>${version.label}</b>`,
          `方向：<b>${dirLabel}</b>`,
          `進場價：<code>${priceStr}</code>`,
          ``,
          `⚙️ 參數：SL×${BASE_PRESET.atr_sl_mult} / TP×${version.tp}`,
          `過濾後勝率：${r.filtered_win_rate.toFixed(1)}%（${r.filtered_trades} 筆）`,
          d1Line,
          m15Line,
          ``,
          `📊 回測績效（一年）：${version.backtest_return}`,
        ].filter(Boolean).join("\n");

        await sendTelegram(msg);
        lastAlertKey.set(version.key, r.alert_key);
        dispatch_results.push({
          version_key: version.key, alert_key: r.alert_key,
          status: "sent", sent_at: new Date().toISOString(),
        });
        state_strategies[version.key] = {
          last_alert_key: r.alert_key, last_entry_time: r.signal_time,
          last_sent_at: new Date().toISOString(),
        };
        console.log(`[${version.short}] ✅ 新信號 ${dirLabel} @ ${priceStr}，已推送 Telegram`);
      } else {
        dispatch_results.push({ version_key: version.key, alert_key: r.alert_key, status: "duplicate_skip" });
        console.log(`[${version.short}] ⏭ 信號重複，跳過推送`);
      }
    } else {
      console.log(`[${version.short}] 無信號${r.filter_reason ? `（${r.filter_reason}）` : ""}`);
    }
  }

  // ── 寫入 snapshot JSON ──
  const snapshot = {
    generated_at: now,
    worker_version: "v3.0",
    active_versions: STRATEGY_VERSIONS.map(v => ({
      key: v.key, label: v.label, tp: v.tp,
      use_1d: v.use_1d, use_15m: v.use_15m,
      backtest_return: v.backtest_return,
    })),
    signals,
    dispatch_results,
    strategy_errors,
    state_overview: {
      last_checked_at: now,
      last_error_message: strategy_errors.length > 0
        ? strategy_errors[0].error : undefined,
      strategies: state_strategies,
    },
  };

  try {
    await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
    await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
    console.log(`[LiveWorker v3.0] ✅ Snapshot 已寫入 ${SNAPSHOT_PATH}`);
  } catch (err) {
    console.error(`[LiveWorker v3.0] Snapshot 寫入失敗:`, err);
  }

  console.log(`[LiveWorker v3.0] ========== 掃描完成 ==========\n`);
}

// ── 啟動 ──
console.log(`[LiveWorker v3.0] 🚀 BTCUSDT 三策略並行 Worker 啟動`);
console.log(`[LiveWorker v3.0] 策略版本：V2 / V3 / V4`);
console.log(`[LiveWorker v3.0] Snapshot 路徑：${SNAPSHOT_PATH}`);
console.log(`[LiveWorker v3.0] 掃描間隔：${INTERVAL_MS / 60000} 分鐘`);
console.log(`[LiveWorker v3.0] V2：TP=0.5 + score9.0（回測 +6.73%）`);
console.log(`[LiveWorker v3.0] V3：TP=0.5 + score9.0 + 1D EMA200（回測 +13.33%）`);
console.log(`[LiveWorker v3.0] V4：TP=0.5 + score9.0 + 1D EMA200 + 15m確認（回測 +10.11%）`);

runOnce().catch(err => console.error("[LiveWorker v3.0] 首次執行失敗:", err));
setInterval(() => {
  runOnce().catch(err => console.error("[LiveWorker v3.0] 定期執行失敗:", err));
}, INTERVAL_MS);
