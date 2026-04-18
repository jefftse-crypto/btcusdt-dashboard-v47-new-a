/**
 * BTCUSDT Live Signal Worker v2.0
 * 定期執行兩個終版策略的回測掃描，寫入 snapshot JSON，並推送 Telegram 通知
 *
 * 策略：
 *   1. btcusdt_1h_single_strategy_181 — 1H 单策略终版
 *   2. btcusdt_execution_main_90      — 实战执行终版
 *
 * v2.0 改良：加入完整的 pa_* 信號後過濾邏輯
 *   - pa_allow_pattern / pa_allow_true_breakout / pa_allow_trap：依 entry_type 過濾
 *   - pa_require_retest_on_continuation：連續同向信號需要回測確認
 *   - pa_retest_mode / pa_retest_lookback_bars：回測模式過濾
 *   - pa_retest_require_candle_color：回測蠟燭顏色確認
 *   - pa_retest_touch_tolerance_atr：回測觸及容差
 *   - pa_retest_reclaim_offset_atr：回測奪回偏移
 *   - pa_retest_soft_score / pa_retest_soft_bonus / pa_retest_soft_min_score：軟評分
 *   - pa_dual_tf_resonance / pa_resonance_*：雙時間框架共振過濾
 *   - pa_session_mode：交易時段過濾
 */

import fs from "fs/promises";
import path from "path";
import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS, type LivePreset, type RetestMode } from "./live_btcusdt_strategy_presets.js";

// ── 設定 ──
const SNAPSHOT_PATH =
  process.env.LATEST_LIVE_SNAPSHOT_PATH ??
  "/home/ubuntu/runtime/btcusdt_live_signal_snapshot.json";
const INTERVAL_MS = 2 * 60 * 1000; // 每 2 分鐘
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? "";

// ── 狀態追蹤（防重複推送）──
const lastAlertKey  = new Map<string, string>(); // preset_key → last alert_key
const lastDirection = new Map<string, string>(); // preset_key → last direction（用於 continuation 判斷）

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

// ── 判斷是否在交易時段（用於 exclude_offhours）──
function isInTradingSession(mode: string | undefined): boolean {
  if (!mode || mode === "all") return true;
  const now = new Date();
  const utcHour = now.getUTCHours();
  if (mode === "exclude_offhours") {
    return !(utcHour >= 0 && utcHour < 6);
  }
  if (mode === "london_newyork") {
    return (utcHour >= 7 && utcHour <= 22);
  }
  return true;
}

// ── 計算 ATR（最近 14 根）──
function calcAtr(candles: Candle[], idx: number): number {
  const start = Math.max(1, idx - 13);
  let sum = 0;
  let count = 0;
  for (let j = start; j <= idx; j++) {
    const prevClose = candles[j - 1]?.close ?? candles[j].close;
    const tr = Math.max(
      candles[j].high - candles[j].low,
      Math.abs(candles[j].high - prevClose),
      Math.abs(candles[j].low  - prevClose)
    );
    sum += tr;
    count++;
  }
  return count > 0 ? sum / count : candles[idx].high - candles[idx].low;
}

// ── 回測確認檢查 ──
function checkRetestConfirmation(
  candles: Candle[],
  idx: number,
  direction: "long" | "short",
  entryPrice: number,
  atr: number,
  mode: RetestMode,
  lookbackBars: number,
  touchToleranceAtr: number,
  reclaimOffsetAtr: number,
  requireCandleColor: boolean
): boolean {
  const start = Math.max(0, idx - lookbackBars);
  const touchZone    = touchToleranceAtr * atr;
  const reclaimDelta = reclaimOffsetAtr  * atr;

  for (let j = start; j <= idx; j++) {
    const c = candles[j];
    if (direction === "long") {
      const touched  = c.low  <= entryPrice + touchZone && c.low  >= entryPrice - touchZone * 3;
      const reclaimed = c.close >= entryPrice + reclaimDelta;
      const colorOk  = !requireCandleColor || c.close > c.open;
      if (touched && reclaimed && colorOk) {
        if (mode === "same_bar") return true;
        if (mode === "next_bar_confirm" && j < idx) {
          if (candles[j + 1].close >= entryPrice + reclaimDelta) return true;
        }
        if (mode === "either") return true;
      }
    } else {
      const touched  = c.high >= entryPrice - touchZone && c.high <= entryPrice + touchZone * 3;
      const reclaimed = c.close <= entryPrice - reclaimDelta;
      const colorOk  = !requireCandleColor || c.close < c.open;
      if (touched && reclaimed && colorOk) {
        if (mode === "same_bar") return true;
        if (mode === "next_bar_confirm" && j < idx) {
          if (candles[j + 1].close <= entryPrice - reclaimDelta) return true;
        }
        if (mode === "either") return true;
      }
    }
  }
  return false;
}

// ── 雙時間框架共振過濾 ──
function checkDualTfResonance(
  candles: Candle[],
  idx: number,
  direction: "long" | "short",
  biasWindowBars: number,
  minScore: number,
  requireKeyLevel: boolean,
  requireMomentum: boolean,
  allTrades: Array<{ direction: string; entry_time: number; entry_price: number }>
): boolean {
  // 用最近 biasWindowBars*4 根 K 線的時間範圍，統計同向交易比例
  const windowStart = candles[Math.max(0, idx - biasWindowBars * 4)]?.time ?? 0;
  const recentTrades = allTrades.filter(t => t.entry_time >= windowStart);
  if (recentTrades.length === 0) return true; // 無歷史：初始狀態通過

  const sameDir = recentTrades.filter(t => t.direction === direction).length;
  const resonanceScore = (sameDir / recentTrades.length) * 100;
  if (resonanceScore < minScore) return false;

  if (requireKeyLevel) {
    const atr = calcAtr(candles, idx);
    const close = candles[idx].close;
    const slice = candles.slice(Math.max(0, idx - 40), idx + 1);
    const nearLow  = slice.some(c => Math.abs(close - c.low)  <= atr * 0.5);
    const nearHigh = slice.some(c => Math.abs(close - c.high) <= atr * 0.5);
    if (direction === "long"  && !nearLow)  return false;
    if (direction === "short" && !nearHigh) return false;
  }

  if (requireMomentum) {
    const recent3 = candles.slice(Math.max(0, idx - 3), idx + 1);
    const bullish = recent3.filter(c => c.close > c.open).length;
    const bearish = recent3.filter(c => c.close < c.open).length;
    if (direction === "long"  && bullish < bearish) return false;
    if (direction === "short" && bearish < bullish) return false;
  }

  return true;
}

// ── pa_* 信號後過濾 ──
function applyPaFilter(
  preset: LivePreset,
  candles: Candle[],
  trade: {
    direction: string;
    entry_price: number;
    entry_time: number;
    entry_type?: string;
    signal_score?: number;
  },
  allTrades: Array<{ direction: string; entry_time: number; entry_price: number }>
): { pass: boolean; reason?: string } {
  const { entry_type, signal_score } = trade;

  // 找到對應的 K 線索引
  let idx = candles.findIndex(c => c.time >= trade.entry_time);
  if (idx < 0) idx = candles.length - 1;

  const atr = calcAtr(candles, idx);

  // 1. entry_type 過濾
  if (entry_type === "PA_PATTERN"      && !preset.pa_allow_pattern)       return { pass: false, reason: "PA_PATTERN 被 pa_allow_pattern=false 過濾" };
  if (entry_type === "PA_TRUE_BREAKOUT" && !preset.pa_allow_true_breakout) return { pass: false, reason: "PA_TRUE_BREAKOUT 被 pa_allow_true_breakout=false 過濾" };
  if (entry_type === "PA_2ND_LEG_TRAP"  && !preset.pa_allow_trap)          return { pass: false, reason: "PA_2ND_LEG_TRAP 被 pa_allow_trap=false 過濾" };

  // 2. pa_require_retest_on_continuation：連續同向需回測確認
  if (preset.pa_require_retest_on_continuation) {
    const prevDir = lastDirection.get(preset.key);
    if (prevDir && prevDir === trade.direction) {
      const retestOk = checkRetestConfirmation(
        candles, idx,
        trade.direction as "long" | "short",
        trade.entry_price, atr,
        preset.pa_retest_mode,
        preset.pa_retest_lookback_bars,
        preset.pa_retest_touch_tolerance_atr,
        preset.pa_retest_reclaim_offset_atr,
        preset.pa_retest_require_candle_color
      );
      if (!retestOk) return { pass: false, reason: "連續同向信號未通過回測確認" };
    }
  }

  // 3. pa_retest_soft_score：軟評分過濾
  if (preset.pa_retest_soft_score && signal_score !== undefined) {
    const minScore = preset.pa_retest_soft_min_score ?? 7.0;
    const bonus    = preset.pa_retest_soft_bonus    ?? 0.5;
    const hasRetest = checkRetestConfirmation(
      candles, idx,
      trade.direction as "long" | "short",
      trade.entry_price, atr,
      preset.pa_retest_mode,
      preset.pa_retest_lookback_bars,
      preset.pa_retest_touch_tolerance_atr,
      preset.pa_retest_reclaim_offset_atr,
      preset.pa_retest_require_candle_color
    );
    const effectiveScore = signal_score + (hasRetest ? bonus : 0);
    if (effectiveScore < minScore) {
      return { pass: false, reason: `信號評分 ${effectiveScore.toFixed(1)} < 最低要求 ${minScore}` };
    }
  }

  // 4. pa_dual_tf_resonance：雙時間框架共振
  if (preset.pa_dual_tf_resonance) {
    const resonanceOk = checkDualTfResonance(
      candles, idx,
      trade.direction as "long" | "short",
      preset.pa_resonance_bias_window_bars    ?? 2,
      preset.pa_resonance_min_score           ?? 40,
      preset.pa_resonance_require_key_level   ?? false,
      preset.pa_resonance_require_momentum    ?? false,
      allTrades
    );
    if (!resonanceOk) return { pass: false, reason: "未通過雙時間框架共振過濾" };
  }

  return { pass: true };
}

// ── 執行單個 preset 的回測並取得最新信號（含 pa_* 過濾）──
async function runPreset(preset: LivePreset): Promise<{
  preset_key:        string;
  direction:         string | null;
  entry_price:       number | null;
  signal_time:       number | null;
  alert_key:         string | null;
  win_rate:          number;
  total_trades:      number;
  filtered_win_rate?: number;
  filtered_trades?:  number;
  filter_reason?:    string;
  error?:            string;
}> {
  try {
    const [candles1h, candles4h] = await Promise.all([
      fetchCandles("BTCUSDT", "1h", 500),
      fetchCandles("BTCUSDT", "4h", 200),
    ]);

    const result = runBacktest({
      candles:              candles1h as Candle[],
      strategy:             preset.strategy,
      symbol:               preset.symbol,
      interval:             preset.interval,
      atr_sl_mult:          preset.atr_sl_mult,
      atr_tp_mult:          preset.atr_tp_mult,
      enable_mtf_filter:    preset.enable_mtf_filter,
      enable_adx_filter:    preset.enable_adx_filter,
      enable_trailing_stop: preset.enable_trailing_stop,
      enable_fee:           false,
      candles_4h:           candles4h as Candle[],
    });

    const trades = result.trades ?? [];
    const tradeSummary = trades.map(t => ({
      direction:   t.direction,
      entry_time:  t.entry_time,
      entry_price: t.entry_price,
    }));

    // ── pa_* 後過濾：計算過濾後勝率 ──
    const filteredTrades = trades.filter(t =>
      applyPaFilter(preset, candles1h as Candle[], {
        direction:    t.direction,
        entry_price:  t.entry_price,
        entry_time:   t.entry_time,
        entry_type:   t.entry_type,
        signal_score: t.signal_score,
      }, tradeSummary).pass
    );

    const filteredWins    = filteredTrades.filter(t => t.pnl_pct > 0).length;
    const filteredWinRate = filteredTrades.length > 0
      ? (filteredWins / filteredTrades.length) * 100
      : 0;

    // 無信號
    if (filteredTrades.length === 0) {
      return {
        preset_key:        preset.key,
        direction:         null,
        entry_price:       null,
        signal_time:       null,
        alert_key:         null,
        win_rate:          result.win_rate,
        total_trades:      result.total_trades,
        filtered_win_rate: filteredWinRate,
        filtered_trades:   0,
      };
    }

    // 時段過濾
    if (!isInTradingSession(preset.pa_session_mode)) {
      console.log(`[LiveWorker] ${preset.key}: 非交易時段（${preset.pa_session_mode}），跳過`);
      return {
        preset_key:        preset.key,
        direction:         null,
        entry_price:       null,
        signal_time:       null,
        alert_key:         null,
        win_rate:          result.win_rate,
        total_trades:      result.total_trades,
        filtered_win_rate: filteredWinRate,
        filtered_trades:   filteredTrades.length,
      };
    }

    const lastTrade = filteredTrades[filteredTrades.length - 1];

    // 對最新信號再次確認 pa_* 過濾
    const latestFilter = applyPaFilter(
      preset, candles1h as Candle[],
      {
        direction:    lastTrade.direction,
        entry_price:  lastTrade.entry_price,
        entry_time:   lastTrade.entry_time,
        entry_type:   lastTrade.entry_type,
        signal_score: lastTrade.signal_score,
      },
      tradeSummary
    );

    if (!latestFilter.pass) {
      console.log(`[LiveWorker] ${preset.key}: 最新信號被 pa_* 過濾（${latestFilter.reason}）`);
      return {
        preset_key:        preset.key,
        direction:         null,
        entry_price:       null,
        signal_time:       null,
        alert_key:         null,
        win_rate:          result.win_rate,
        total_trades:      result.total_trades,
        filtered_win_rate: filteredWinRate,
        filtered_trades:   filteredTrades.length,
        filter_reason:     latestFilter.reason,
      };
    }

    // 更新方向追蹤
    lastDirection.set(preset.key, lastTrade.direction);

    const alertKey = `${preset.key}_${lastTrade.direction}_${lastTrade.entry_time}`;

    console.log(
      `[LiveWorker] ${preset.key}: 過濾後勝率 ${filteredWinRate.toFixed(1)}% ` +
      `(${filteredTrades.length} 筆) | 原始 ${result.win_rate.toFixed(1)}% (${result.total_trades} 筆)`
    );

    return {
      preset_key:        preset.key,
      direction:         lastTrade.direction,
      entry_price:       lastTrade.entry_price,
      signal_time:       lastTrade.entry_time,
      alert_key:         alertKey,
      win_rate:          result.win_rate,
      total_trades:      result.total_trades,
      filtered_win_rate: filteredWinRate,
      filtered_trades:   filteredTrades.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[LiveWorker] ${preset.key} 執行失敗:`, msg);
    return {
      preset_key:   preset.key,
      direction:    null,
      entry_price:  null,
      signal_time:  null,
      alert_key:    null,
      win_rate:     0,
      total_trades: 0,
      error:        msg,
    };
  }
}

// ── 主掃描循環 ──
async function runOnce(): Promise<void> {
  const now = new Date().toISOString();
  console.log(`[LiveWorker] ⏱ 開始掃描 ${now}`);

  const results = await Promise.allSettled(
    BTCUSDT_LIVE_PRESETS.map(preset => runPreset(preset))
  );

  const signals: Array<{
    preset:            { key: string; label: string };
    preset_key:        string;
    direction:         string | null;
    entry_price:       number | null;
    signal_time:       number | null;
    alert_key:         string | null;
    filtered_win_rate?: number;
    filtered_trades?:  number;
  }> = [];

  const dispatch_results: Array<{
    preset_key: string;
    alert_key:  string | null;
    status:     "sent" | "failed" | "duplicate_skip";
    error?:     string;
    sent_at?:   string;
  }> = [];

  const strategy_errors: Array<{
    preset_key: string;
    label:      string;
    error:      string;
  }> = [];

  const state_strategies: Record<string, {
    last_alert_key?:  string;
    last_entry_time?: number;
    last_sent_at?:    string;
  }> = {};

  for (let i = 0; i < results.length; i++) {
    const preset = BTCUSDT_LIVE_PRESETS[i];
    const result = results[i];

    if (result.status === "rejected") {
      strategy_errors.push({ preset_key: preset.key, label: preset.label, error: String(result.reason) });
      continue;
    }

    const r = result.value;

    if (r.error) {
      strategy_errors.push({ preset_key: preset.key, label: preset.label, error: r.error });
    }

    if (r.direction && r.entry_price && r.alert_key) {
      signals.push({
        preset:            { key: preset.key, label: preset.label },
        preset_key:        preset.key,
        direction:         r.direction,
        entry_price:       r.entry_price,
        signal_time:       r.signal_time,
        alert_key:         r.alert_key,
        filtered_win_rate: r.filtered_win_rate,
        filtered_trades:   r.filtered_trades,
      });

      const prevAlertKey = lastAlertKey.get(preset.key);
      const isNew = prevAlertKey !== r.alert_key;

      if (isNew) {
        const dirEmoji = r.direction === "long" ? "📈" : "📉";
        const dirLabel = r.direction === "long" ? "做多" : "做空";
        const priceStr = r.entry_price.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const filteredWrLine = r.filtered_win_rate !== undefined
          ? `過濾後勝率：${r.filtered_win_rate.toFixed(1)}%（${r.filtered_trades} 筆）`
          : "";
        const msg = [
          `🔔 <b>終版策略新信號</b>`,
          ``,
          `${dirEmoji} <b>${preset.label}</b>`,
          `方向：<b>${dirLabel}</b>`,
          `進場價：<code>${priceStr}</code>`,
          `策略：${preset.strategy}  |  週期：${preset.interval}`,
          ``,
          `⚙️ 參數：SL×${preset.atr_sl_mult} / TP×${preset.atr_tp_mult}`,
          `原始勝率：${r.win_rate.toFixed(1)}%  |  總交易：${r.total_trades}`,
          filteredWrLine,
        ].filter(Boolean).join("\n");

        await sendTelegram(msg);
        lastAlertKey.set(preset.key, r.alert_key);

        dispatch_results.push({ preset_key: preset.key, alert_key: r.alert_key, status: "sent", sent_at: new Date().toISOString() });
        state_strategies[preset.key] = { last_alert_key: r.alert_key, last_entry_time: r.signal_time ?? undefined, last_sent_at: new Date().toISOString() };
        console.log(`[LiveWorker] ✅ ${preset.key}: 新信號 ${dirLabel} @ ${priceStr}，已推送 Telegram`);
      } else {
        dispatch_results.push({ preset_key: preset.key, alert_key: r.alert_key, status: "duplicate_skip" });
        state_strategies[preset.key] = state_strategies[preset.key] ?? { last_alert_key: r.alert_key, last_entry_time: r.signal_time ?? undefined };
        console.log(`[LiveWorker] ⏭ ${preset.key}: 信號重複，跳過推送`);
      }
    } else {
      console.log(`[LiveWorker] ${preset.key}: 無信號${r.filter_reason ? `（${r.filter_reason}）` : ""}`);
    }
  }

  // ── 寫入 snapshot JSON ──
  const snapshot = {
    generated_at: now,
    active_presets: BTCUSDT_LIVE_PRESETS.map(p => ({
      key:      p.key,
      label:    p.label,
      strategy: p.strategy,
      interval: p.interval,
    })),
    signals,
    dispatch_results,
    strategy_errors,
    state_overview: {
      last_checked_at:    now,
      last_error_message: strategy_errors.length > 0
        ? `[runOnce] ${strategy_errors[0].error}`
        : undefined,
      strategies: state_strategies,
    },
  };

  try {
    await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
    await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
    console.log(`[LiveWorker] ✅ Snapshot 已寫入 ${SNAPSHOT_PATH}`);
  } catch (err) {
    console.error(`[LiveWorker] Snapshot 寫入失敗:`, err);
  }
}

// ── 啟動 ──
console.log(`[LiveWorker] 🚀 BTCUSDT Live Signal Worker v2.0 啟動（含 pa_* 過濾）`);
console.log(`[LiveWorker] 策略數量: ${BTCUSDT_LIVE_PRESETS.length}`);
console.log(`[LiveWorker] Snapshot 路徑: ${SNAPSHOT_PATH}`);
console.log(`[LiveWorker] 掃描間隔: ${INTERVAL_MS / 60000} 分鐘`);

runOnce().catch(err => console.error("[LiveWorker] 首次執行失敗:", err));
setInterval(() => {
  runOnce().catch(err => console.error("[LiveWorker] 定期執行失敗:", err));
}, INTERVAL_MS);
