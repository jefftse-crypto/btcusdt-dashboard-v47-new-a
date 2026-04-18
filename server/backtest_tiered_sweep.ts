/**
 * backtest_tiered_sweep.ts — 階梯式分級篩選掃描
 *
 * 策略：不靠單純放寬容錯（因為這只是讓低品質信號通過）
 * 改為「強信號通道 + 次級信號通道」雙閘門：
 *   - Tier S：核心 ≥ N_strong/8 通過 → 必放
 *   - Tier A：核心 ≥ N_relax/8 通過 且 必含關鍵項目 → 放行
 *   - 其他：不放行
 *
 * 同時嘗試「家族特定門檻」（PA 較嚴，HWR/CBALL 較寬）。
 */

import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestTrade } from "./backtest.js";

const STRATEGIES: { key: string; strategy: BacktestStrategy; family: string; tp: number; sl: number; }[] = [
  { key: "pa_v4_focus",            strategy: "pa",             family: "pa",              tp: 0.5, sl: 1.95 },
  { key: "hwr_b_guarded",          strategy: "hwr_model_b",    family: "trend_pullback",  tp: 2,   sl: 1.5  },
  { key: "cannonball_guarded",     strategy: "cannonball",     family: "structure",       tp: 2,   sl: 1.5  },
];

interface TierConfig {
  name: string;
  // 強通道門檻（核心通過數 ≥ strong_pass）
  strong_core_pass: number;
  // 次級通道門檻（核心通過數 ≥ relax_pass 且 必含 must_have_checks）
  relax_core_pass: number;
  must_have_core: string[]; // 例如 ["C2_htf_trend", "C4_volume"] 表示這些項目必須通過
  // PA 容錯
  pa_max_fail: number;
  pa_must_have: string[]; // 例如 ["PA1_candle_dir"]
  // 微調
  rvol_min: number;
  ema_atr_max: number;
  body_min: number;
}

const MODES: TierConfig[] = [
  { name: "T1_strict_only_strong", strong_core_pass: 7, relax_core_pass: 99, must_have_core: [], pa_max_fail: 0, pa_must_have: ["PA1_candle_dir"], rvol_min: 0.9, ema_atr_max: 1.8, body_min: 0.35 },
  { name: "T2_dual_gate_a",        strong_core_pass: 7, relax_core_pass: 6,  must_have_core: ["C2_htf_trend","C4_volume","C5_overextended"], pa_max_fail: 1, pa_must_have: ["PA1_candle_dir"], rvol_min: 0.85, ema_atr_max: 2.0, body_min: 0.30 },
  { name: "T3_dual_gate_b",        strong_core_pass: 7, relax_core_pass: 6,  must_have_core: ["C2_htf_trend","C4_volume"],                  pa_max_fail: 1, pa_must_have: ["PA1_candle_dir"], rvol_min: 0.85, ema_atr_max: 2.0, body_min: 0.30 },
  { name: "T4_dual_gate_loose",    strong_core_pass: 7, relax_core_pass: 6,  must_have_core: ["C2_htf_trend"],                              pa_max_fail: 1, pa_must_have: ["PA1_candle_dir"], rvol_min: 0.80, ema_atr_max: 2.2, body_min: 0.30 },
  { name: "T5_relax5_with_htf",    strong_core_pass: 7, relax_core_pass: 5,  must_have_core: ["C2_htf_trend","C4_volume","C5_overextended"], pa_max_fail: 0, pa_must_have: ["PA1_candle_dir"], rvol_min: 0.85, ema_atr_max: 2.0, body_min: 0.30 },
  { name: "T6_relax6_pa_strict",   strong_core_pass: 7, relax_core_pass: 6,  must_have_core: ["C2_htf_trend","C4_volume"],                  pa_max_fail: 0, pa_must_have: ["PA1_candle_dir"], rvol_min: 0.85, ema_atr_max: 2.0, body_min: 0.30 },
];

// ── helpers ──
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
  for (let i = 1; i < values.length; i++) ema.push(values[i] * k + ema[i - 1] * (1 - k));
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

function evalChecks(
  trade: BacktestTrade, candles1h: Candle[], candles4h: Candle[], family: string, cfg: TierConfig,
): { core_failed: string[]; pa_failed: string[]; } {
  const tradeTime = trade.entry_time;
  const candleIdx = candles1h.findIndex(c => c.time >= tradeTime);
  if (candleIdx < 50) return { core_failed: [], pa_failed: [] };
  const n = candleIdx + 1;
  const candles = candles1h.slice(0, n);
  const closes = candles.map(c => c.close);
  const lastCandle = candles[n - 1];
  const dir = trade.direction;
  const core: string[] = [];
  const pa: string[] = [];

  const utcHour = new Date(tradeTime * 1000).getUTCHours();
  if (!(utcHour >= 7 && utcHour < 22)) core.push("C1_session");

  const c4hUp = candles4h.filter(c => c.time <= tradeTime);
  let rsi4h = 50;
  if (c4hUp.length >= 25) {
    const c4h = c4hUp.map(c => c.close);
    const e4 = calcEmaArr(c4h, 20);
    const last = e4[e4.length - 1], prev = e4[e4.length - 2];
    const slopeOk = dir === "long" ? (last - prev) >= 0 : (last - prev) <= 0;
    const posOk = dir === "long" ? c4h[c4h.length - 1] >= last * 0.995 : c4h[c4h.length - 1] <= last * 1.005;
    if (!slopeOk || !posOk) core.push("C2_htf_trend");
    rsi4h = calcRsi14(c4h, c4h.length - 1);
  }

  const rsi1h = calcRsi14(closes, n - 1);
  const rsiOk = dir === "long" ? (rsi1h >= 42 && rsi1h <= 72) : (rsi1h >= 28 && rsi1h <= 58);
  if (!rsiOk) core.push("C3_rsi");

  const avgVol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const rvol = avgVol20 > 0 ? lastCandle.volume / avgVol20 : 1;
  if (rvol < cfg.rvol_min) core.push("C4_volume");

  const ema20 = calcEmaArr(closes, 20);
  const atr = calcAtr(candles, n - 1);
  const atrDist = atr > 0 ? Math.abs(lastCandle.close - ema20[n - 1]) / atr : 0;
  if (atrDist > cfg.ema_atr_max) core.push("C5_overextended");

  const body = Math.abs(lastCandle.close - lastCandle.open);
  const range = lastCandle.high - lastCandle.low;
  const bodyRatio = range > 0 ? body / range : 1;
  if (bodyRatio < cfg.body_min) core.push("C6_candle_form");

  if (n >= 2) {
    const r2 = candles.slice(-2);
    const aligned = r2.filter(c => dir === "long" ? c.close > c.open : c.close < c.open).length;
    if (aligned < 1) core.push("C7_momentum");
  }

  if (n >= 50) {
    const arr: number[] = [];
    for (let i = Math.max(1, n - 50); i < n; i++) arr.push(calcAtr(candles, i));
    arr.sort((a, b) => a - b);
    const pct = Math.round((arr.filter(a => a <= atr).length / arr.length) * 100);
    if (pct < 20 || pct > 88) core.push("C8_atr_health");
  }

  if (family === "pa") {
    const paCand = dir === "long" ? lastCandle.close >= lastCandle.open : lastCandle.close <= lastCandle.open;
    if (!paCand) pa.push("PA1_candle_dir");
    const paRsiOk = dir === "long" ? rsi1h < 65 : rsi1h > 35;
    if (!paRsiOk) pa.push("PA2_rsi_extreme");
    const pa4hOk = dir === "long" ? rsi4h > 45 : rsi4h < 55;
    if (!pa4hOk) pa.push("PA3_4h_rsi");
  }

  return { core_failed: core, pa_failed: pa };
}

function tierGate(coreFailed: string[], paFailed: string[], cfg: TierConfig, family: string): { pass: boolean; tier: string; } {
  const corePass = 8 - coreFailed.length;

  // PA 必須項
  if (family === "pa") {
    for (const m of cfg.pa_must_have) if (paFailed.includes(m)) return { pass: false, tier: "rejected_pa_must" };
    if (paFailed.length > cfg.pa_max_fail) return { pass: false, tier: "rejected_pa_count" };
  }

  // Tier S：核心強通道
  if (corePass >= cfg.strong_core_pass) return { pass: true, tier: "S" };

  // Tier A：放寬通道，但必含關鍵項
  if (corePass >= cfg.relax_core_pass) {
    for (const m of cfg.must_have_core) if (coreFailed.includes(m)) return { pass: false, tier: "rejected_must" };
    return { pass: true, tier: "A" };
  }

  return { pass: false, tier: "rejected_count" };
}

async function main() {
  console.log("=== 階梯式分級篩選掃描 ===\n");
  const [c1h, c4h] = await Promise.all([
    fetchCandles("BTCUSDT", "1h", 1000),
    fetchCandles("BTCUSDT", "4h", 1000),
  ]);
  const periodDays = (c1h[c1h.length - 1].time - c1h[0].time) / 3600 / 24;
  console.log(`資料區間：${periodDays.toFixed(1)} 天\n`);

  const stratTrades: Record<string, { family: string; trades: BacktestTrade[]; }> = {};
  for (const cfg of STRATEGIES) {
    const r = runBacktest({
      candles: c1h, strategy: cfg.strategy, symbol: "BTCUSDT", interval: "1h",
      atr_sl_mult: cfg.sl, atr_tp_mult: cfg.tp,
      enable_mtf_filter: true, enable_fee: true, enable_trailing_stop: false, enable_adx_filter: true,
    });
    stratTrades[cfg.key] = { family: cfg.family, trades: r.trades ?? [] };
    console.log(`  ${cfg.key}: ${stratTrades[cfg.key].trades.length} 筆原始交易`);
  }

  console.log("\n" + "=".repeat(110));
  console.log("掃描結果");
  console.log("=".repeat(110));
  console.log("模式".padEnd(28) + "筆數".padStart(6) + "S級".padStart(6) + "A級".padStart(6) +
              "勝率".padStart(9) + "S勝率".padStart(9) + "A勝率".padStart(9) +
              "PF".padStart(7) + "淨回報%".padStart(11) + "天/筆".padStart(9) + "  目標");
  console.log("-".repeat(110));

  interface ModeOut { mode: string; total: number; tierS: number; tierA: number; wins: number; sWins: number; aWins: number; wr: number; sWr: number; aWr: number; pf: number; ret: number; dpt: number; per_strategy: any; }
  const out: ModeOut[] = [];

  for (const mode of MODES) {
    let total = 0, tierS = 0, tierA = 0, wins = 0, sWins = 0, aWins = 0, gp = 0, gl = 0, ret = 0;
    const ps: Record<string, { trades: number; wins: number; tierS: number; tierA: number; }> = {};
    for (const cfg of STRATEGIES) {
      const sd = stratTrades[cfg.key];
      let st = 0, sw = 0, sts = 0, sta = 0;
      for (const t of sd.trades) {
        const ck = evalChecks(t, c1h, c4h, sd.family, mode);
        const g = tierGate(ck.core_failed, ck.pa_failed, mode, sd.family);
        if (g.pass) {
          total++; st++;
          if (g.tier === "S") { tierS++; sts++; if (t.pnl_net_pct > 0) sWins++; }
          else                 { tierA++; sta++; if (t.pnl_net_pct > 0) aWins++; }
          ret += t.pnl_net_pct;
          if (t.pnl_net_pct > 0) { wins++; sw++; gp += t.pnl_net_pct; }
          else                   { gl += Math.abs(t.pnl_net_pct); }
        }
      }
      ps[cfg.key] = { trades: st, wins: sw, tierS: sts, tierA: sta };
    }
    const wr = total > 0 ? wins / total * 100 : 0;
    const sWr = tierS > 0 ? sWins / tierS * 100 : 0;
    const aWr = tierA > 0 ? aWins / tierA * 100 : 0;
    const pf = gl > 0 ? gp / gl : (gp > 0 ? 99 : 0);
    const dpt = total > 0 ? periodDays / total : Infinity;
    const dp = dpt === Infinity ? "—" : dpt.toFixed(2);
    const ok = wr >= 75 && dpt >= 1 && dpt <= 3;

    out.push({ mode: mode.name, total, tierS, tierA, wins, sWins, aWins, wr, sWr, aWr, pf, ret, dpt, per_strategy: ps });

    console.log(
      mode.name.padEnd(28) +
      total.toString().padStart(6) +
      tierS.toString().padStart(6) +
      tierA.toString().padStart(6) +
      (wr.toFixed(1) + "%").padStart(9) +
      (sWr.toFixed(1) + "%").padStart(9) +
      (aWr.toFixed(1) + "%").padStart(9) +
      pf.toFixed(2).padStart(7) +
      ((ret >= 0 ? "+" : "") + ret.toFixed(3)).padStart(11) +
      dp.padStart(9) +
      "  " + (ok ? "✅" : (wr >= 75 ? "勝率達標" : (dpt <= 3 ? "頻率達標" : "—")))
    );
  }
  console.log("=".repeat(110));

  console.log("\n各模式策略明細：");
  for (const o of out) {
    console.log(`\n[${o.mode}] 共 ${o.total} 筆 (S=${o.tierS} A=${o.tierA}) / 勝率 ${o.wr.toFixed(1)}%`);
    for (const [k, v] of Object.entries(o.per_strategy as any)) {
      const vv = v as any;
      console.log(`   ${k.padEnd(24)} ${vv.trades} 筆 (S=${vv.tierS} A=${vv.tierA})  勝${vv.wins}`);
    }
  }

  const fs = await import("fs/promises");
  await fs.writeFile("/home/ubuntu/runtime/backtest_tiered_sweep.json",
    JSON.stringify({ timestamp: new Date().toISOString(), period_days: periodDays, modes: out }, null, 2));
  console.log("\n結果已寫入 /home/ubuntu/runtime/backtest_tiered_sweep.json");
}

main().catch(console.error);
