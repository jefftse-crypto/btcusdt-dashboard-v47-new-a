/**
 * backtest_frequency_sweep.ts — 掃描多種容錯設定，尋找「勝率 ≥ 75% + 1~3 天/筆」的最佳模式
 *
 * 對五個策略各跑 1000 根 1H K 線（≈ 41 天），輸出每個模式的：
 *   - 總交易筆數
 *   - 平均交易間隔（小時 / 天）
 *   - 勝率
 *   - PF
 *   - 淨回報
 *
 * 模式組合：
 *   - 核心容錯 ∈ {0, 1, 2, 3}
 *   - PA 容錯 ∈ {0, 1, 2}
 *   - 加上是否「微調 RVOL 0.9 → 0.8」與「ATR 延伸 1.8 → 2.2」
 */

import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestResult, type BacktestTrade } from "./backtest.js";

const STRATEGIES: { key: string; strategy: BacktestStrategy; family: string; tp: number; sl: number; }[] = [
  { key: "pa_v4_focus",            strategy: "pa",             family: "pa",              tp: 0.5, sl: 1.95 },
  { key: "hwr_b_guarded",          strategy: "hwr_model_b",    family: "trend_pullback",  tp: 2,   sl: 1.5  },
  { key: "cannonball_guarded",     strategy: "cannonball",     family: "structure",       tp: 2,   sl: 1.5  },
  { key: "ema_cross_confirm",      strategy: "ema_cross",      family: "trend_confirm",   tp: 1.5, sl: 1.5  },
  { key: "vwap_reversion_confirm", strategy: "vwap_reversion", family: "mean_reversion",  tp: 1.5, sl: 1.5  },
];

interface ChecklistConfig {
  name: string;
  core_tolerance: number;
  pa_tolerance: number;
  rvol_min: number;        // 預設 0.9
  ema_atr_max: number;     // 預設 1.8
  body_min: number;        // 預設 0.35
}

const MODES: ChecklistConfig[] = [
  { name: "v45_strict (原始)",        core_tolerance: 1, pa_tolerance: 0, rvol_min: 0.9, ema_atr_max: 1.8, body_min: 0.35 },
  { name: "balanced_a",               core_tolerance: 2, pa_tolerance: 1, rvol_min: 0.9, ema_atr_max: 1.8, body_min: 0.35 },
  { name: "balanced_b (RVOL/ATR放寬)",core_tolerance: 2, pa_tolerance: 1, rvol_min: 0.8, ema_atr_max: 2.2, body_min: 0.30 },
  { name: "balanced_c",               core_tolerance: 2, pa_tolerance: 0, rvol_min: 0.8, ema_atr_max: 2.2, body_min: 0.30 },
  { name: "loose_a",                  core_tolerance: 3, pa_tolerance: 1, rvol_min: 0.8, ema_atr_max: 2.2, body_min: 0.30 },
  { name: "loose_b",                  core_tolerance: 3, pa_tolerance: 2, rvol_min: 0.7, ema_atr_max: 2.5, body_min: 0.25 },
];

// ── 輔助函數 ──
function calcRsi14(closes: number[], idx: number): number {
  if (idx < 14) return 50;
  let gains = 0, losses = 0;
  for (let i = idx - 13; i <= idx; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = losses > 0 ? (gains / 14) / (losses / 14) : 100;
  return 100 - 100 / (1 + rs);
}

function calcEmaArr(values: number[], period: number): number[] {
  const ema: number[] = [values[0]];
  const k = 2 / (period + 1);
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcAtr(candles: Candle[], idx: number, period = 14): number {
  const start = Math.max(1, idx - period + 1);
  let sum = 0, count = 0;
  for (let i = start; i <= idx; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    count++;
  }
  return count > 0 ? sum / count : candles[idx].high - candles[idx].low;
}

function getUtcHour(timestampMs: number): number { return new Date(timestampMs).getUTCHours(); }

function runChecklistWithCfg(
  trade: BacktestTrade,
  candles1h: Candle[],
  candles4h: Candle[],
  family: string,
  cfg: ChecklistConfig,
): { pass: boolean; failed_checks: string[]; } {
  const tradeTime = trade.entry_time;
  const candleIdx = candles1h.findIndex(c => c.time >= tradeTime);
  if (candleIdx < 50) return { pass: true, failed_checks: [] };

  const n = candleIdx + 1;
  const candles = candles1h.slice(0, n);
  const closes = candles.map(c => c.close);
  const lastCandle = candles[n - 1];
  const dir = trade.direction;
  const failed: string[] = [];

  const utcHour = getUtcHour(tradeTime * 1000);
  if (!(utcHour >= 7 && utcHour < 22)) failed.push("C1_session");

  const candles4hUp = candles4h.filter(c => c.time <= tradeTime);
  if (candles4hUp.length >= 25) {
    const closes4h = candles4hUp.map(c => c.close);
    const ema20_4h = calcEmaArr(closes4h, 20);
    const lastEma = ema20_4h[ema20_4h.length - 1];
    const prevEma = ema20_4h[ema20_4h.length - 2];
    const slope = lastEma - prevEma;
    const lastClose4h = closes4h[closes4h.length - 1];
    const slopeOk = dir === "long" ? slope >= 0 : slope <= 0;
    const posOk   = dir === "long" ? lastClose4h >= lastEma * 0.995 : lastClose4h <= lastEma * 1.005;
    if (!slopeOk || !posOk) failed.push("C2_htf_trend");
  }

  const rsi1h = calcRsi14(closes, n - 1);
  const rsiOk = dir === "long" ? (rsi1h >= 42 && rsi1h <= 72) : (rsi1h >= 28 && rsi1h <= 58);
  if (!rsiOk) failed.push("C3_rsi");

  const avgVol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const rvol = avgVol20 > 0 ? lastCandle.volume / avgVol20 : 1;
  if (rvol < cfg.rvol_min) failed.push("C4_volume");

  const ema20 = calcEmaArr(closes, 20);
  const atr = calcAtr(candles, n - 1);
  const distFromEma = Math.abs(lastCandle.close - ema20[n - 1]);
  const atrDist = atr > 0 ? distFromEma / atr : 0;
  if (atrDist > cfg.ema_atr_max) failed.push("C5_overextended");

  const body = Math.abs(lastCandle.close - lastCandle.open);
  const range = lastCandle.high - lastCandle.low;
  const bodyRatio = range > 0 ? body / range : 1;
  if (bodyRatio < cfg.body_min) failed.push("C6_candle_form");

  if (n >= 2) {
    const recent2 = candles.slice(-2);
    const aligned = recent2.filter(c => dir === "long" ? c.close > c.open : c.close < c.open).length;
    if (aligned < 1) failed.push("C7_momentum");
  }

  if (n >= 50) {
    const atrArr: number[] = [];
    for (let i = Math.max(1, n - 50); i < n; i++) atrArr.push(calcAtr(candles, i));
    atrArr.sort((a, b) => a - b);
    const rank = atrArr.filter(a => a <= atr).length;
    const percentile = Math.round((rank / atrArr.length) * 100);
    if (percentile < 20 || percentile > 88) failed.push("C8_atr_health");
  }

  if (family === "pa") {
    const paCandle = dir === "long" ? lastCandle.close >= lastCandle.open : lastCandle.close <= lastCandle.open;
    if (!paCandle) failed.push("PA1_candle_dir");
    const paRsiOk = dir === "long" ? rsi1h < 65 : rsi1h > 35;
    if (!paRsiOk) failed.push("PA2_rsi_extreme");
    if (candles4hUp.length >= 25) {
      const closes4h = candles4hUp.map(c => c.close);
      const rsi4h = calcRsi14(closes4h, closes4h.length - 1);
      const pa4hOk = dir === "long" ? rsi4h > 45 : rsi4h < 55;
      if (!pa4hOk) failed.push("PA3_4h_rsi");
    }
  }

  const coreFailed = failed.filter(f => !f.startsWith("PA")).length;
  const paFailed   = failed.filter(f =>  f.startsWith("PA")).length;
  const pass = coreFailed <= cfg.core_tolerance && paFailed <= cfg.pa_tolerance;
  return { pass, failed_checks: failed };
}

async function main() {
  console.log("=== BTCUSDT 頻率 vs 勝率掃描 ===\n");
  console.log("抓取 1000 根 1H + 1000 根 4H K 線（≈ 41 天）...");
  const [candles1h, candles4h] = await Promise.all([
    fetchCandles("BTCUSDT", "1h", 1000),
    fetchCandles("BTCUSDT", "4h", 1000),
  ]);
  const periodHours = (candles1h[candles1h.length - 1].time - candles1h[0].time) / 3600;
  const periodDays = periodHours / 24;
  console.log(`資料區間：${periodDays.toFixed(1)} 天\n`);

  // 預先跑每個策略的原始交易（避免重複）
  const stratTrades: Record<string, { family: string; trades: BacktestTrade[]; }> = {};
  for (const cfg of STRATEGIES) {
    try {
      const r = runBacktest({
        candles: candles1h, strategy: cfg.strategy, symbol: "BTCUSDT", interval: "1h",
        atr_sl_mult: cfg.sl, atr_tp_mult: cfg.tp,
        enable_mtf_filter: true, enable_fee: true, enable_trailing_stop: false, enable_adx_filter: true,
      });
      stratTrades[cfg.key] = { family: cfg.family, trades: r.trades ?? [] };
      console.log(`  ${cfg.key}: ${stratTrades[cfg.key].trades.length} 筆原始交易`);
    } catch (e) {
      console.log(`  ${cfg.key}: 回測失敗 ${e}`);
      stratTrades[cfg.key] = { family: cfg.family, trades: [] };
    }
  }

  // 對每個模式，匯總所有策略
  interface ModeSummary {
    mode: string;
    total_trades: number;
    wins: number;
    losses: number;
    win_rate: number;
    profit_factor: number;
    net_return_pct: number;
    days_per_trade: number;
    per_strategy: Record<string, { trades: number; wins: number; wr: number; }>;
  }
  const summaries: ModeSummary[] = [];

  for (const mode of MODES) {
    let total = 0, wins = 0, losses = 0;
    let gp = 0, gl = 0, ret = 0;
    const perStrat: Record<string, { trades: number; wins: number; wr: number; }> = {};

    for (const cfg of STRATEGIES) {
      const sd = stratTrades[cfg.key];
      let st = 0, sw = 0;
      for (const t of sd.trades) {
        const res = runChecklistWithCfg(t, candles1h, candles4h, sd.family, mode);
        if (res.pass) {
          total++; st++;
          ret += t.pnl_net_pct;
          if (t.pnl_net_pct > 0) { wins++; sw++; gp += t.pnl_net_pct; }
          else                   { losses++; gl += Math.abs(t.pnl_net_pct); }
        }
      }
      perStrat[cfg.key] = { trades: st, wins: sw, wr: st > 0 ? (sw / st) * 100 : 0 };
    }

    const wr = total > 0 ? (wins / total) * 100 : 0;
    const pf = gl > 0 ? gp / gl : (gp > 0 ? 99 : 0);
    const dpt = total > 0 ? periodDays / total : Infinity;

    summaries.push({
      mode: mode.name,
      total_trades: total, wins, losses,
      win_rate: wr,
      profit_factor: pf,
      net_return_pct: ret,
      days_per_trade: dpt,
      per_strategy: perStrat,
    });
  }

  // 輸出
  console.log("\n" + "=".repeat(105));
  console.log("掃描結果（跨 5 策略匯總）");
  console.log("=".repeat(105));
  console.log("模式".padEnd(34) + "筆數".padStart(6) + "勝率".padStart(9) + "PF".padStart(8) +
              "淨回報%".padStart(11) + "天/筆".padStart(10) + "  目標達成");
  console.log("-".repeat(105));
  for (const s of summaries) {
    const dp = s.days_per_trade === Infinity ? "—" : s.days_per_trade.toFixed(2);
    const targetOk = s.win_rate >= 75 && s.days_per_trade >= 1 && s.days_per_trade <= 3;
    const tag = targetOk ? "✅ (1~3天 + 勝率≥75%)" : (s.win_rate >= 75 ? "勝率達標" : (s.days_per_trade <= 3 ? "頻率達標" : "—"));
    console.log(
      s.mode.padEnd(34) +
      s.total_trades.toString().padStart(6) +
      (s.win_rate.toFixed(1) + "%").padStart(9) +
      s.profit_factor.toFixed(2).padStart(8) +
      ((s.net_return_pct >= 0 ? "+" : "") + s.net_return_pct.toFixed(3)).padStart(11) +
      dp.padStart(10) +
      "  " + tag
    );
  }
  console.log("=".repeat(105));

  console.log("\n各模式策略明細：");
  for (const s of summaries) {
    console.log(`\n[${s.mode}] 共 ${s.total_trades} 筆 / 勝率 ${s.win_rate.toFixed(1)}%`);
    for (const [k, v] of Object.entries(s.per_strategy)) {
      console.log(`   ${k.padEnd(24)} ${v.trades} 筆  ${v.wr.toFixed(1)}%`);
    }
  }

  const outputPath = "/home/ubuntu/runtime/backtest_frequency_sweep.json";
  const fs = await import("fs/promises");
  await fs.writeFile(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    period_days: periodDays,
    modes: summaries,
  }, null, 2));
  console.log(`\n結果已寫入 ${outputPath}`);
}

main().catch(console.error);
