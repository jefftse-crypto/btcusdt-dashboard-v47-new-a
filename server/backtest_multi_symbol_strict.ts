/**
 * backtest_multi_symbol_strict.ts — 對多個幣對跑 v4.5 strict 回測
 *
 * 目的：找出哪些幣對在 v4.5 strict（核心容錯 1 + PA 容錯 0）下
 *       能保持 ≥75% 勝率，並組合成多幣對 Live Worker 提升頻率。
 */

import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestTrade } from "./backtest.js";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT"];

const STRATEGIES: { key: string; strategy: BacktestStrategy; family: string; tp: number; sl: number; }[] = [
  { key: "pa_v4_focus",        strategy: "pa",          family: "pa",             tp: 0.5, sl: 1.95 },
  { key: "hwr_b_guarded",      strategy: "hwr_model_b", family: "trend_pullback", tp: 2,   sl: 1.5  },
  { key: "cannonball_guarded", strategy: "cannonball",  family: "structure",      tp: 2,   sl: 1.5  },
];

function calcRsi14(closes: number[], idx: number): number {
  if (idx < 14) return 50;
  let g = 0, l = 0;
  for (let i = idx - 13; i <= idx; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  const rs = l > 0 ? (g / 14) / (l / 14) : 100;
  return 100 - 100 / (1 + rs);
}
function calcEma(v: number[], p: number): number[] {
  const e = [v[0]]; const k = 2 / (p + 1);
  for (let i = 1; i < v.length; i++) e.push(v[i] * k + e[i - 1] * (1 - k));
  return e;
}
function calcAtr(c: Candle[], idx: number, p = 14): number {
  const s = Math.max(1, idx - p + 1);
  let sum = 0, n = 0;
  for (let i = s; i <= idx; i++) {
    const h = c[i].high, l = c[i].low, pc = c[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    n++;
  }
  return n > 0 ? sum / n : c[idx].high - c[idx].low;
}

function evalChecks(t: BacktestTrade, c1h: Candle[], c4h: Candle[], family: string) {
  const idx = c1h.findIndex(c => c.time >= t.entry_time);
  if (idx < 50) return { core: [] as string[], pa: [] as string[], rsi4h: 50 };
  const n = idx + 1;
  const cs = c1h.slice(0, n);
  const cl = cs.map(c => c.close);
  const last = cs[n - 1];
  const dir = t.direction;
  const core: string[] = [];
  const pa: string[] = [];

  const utc = new Date(t.entry_time * 1000).getUTCHours();
  if (!(utc >= 7 && utc < 22)) core.push("C1");

  let rsi4h = 50;
  const c4hUp = c4h.filter(c => c.time <= t.entry_time);
  if (c4hUp.length >= 25) {
    const cl4 = c4hUp.map(c => c.close);
    const e4 = calcEma(cl4, 20);
    const last4 = e4[e4.length - 1], prev4 = e4[e4.length - 2];
    const slopeOk = dir === "long" ? (last4 - prev4) >= 0 : (last4 - prev4) <= 0;
    const posOk = dir === "long" ? cl4[cl4.length - 1] >= last4 * 0.995 : cl4[cl4.length - 1] <= last4 * 1.005;
    if (!slopeOk || !posOk) core.push("C2");
    rsi4h = calcRsi14(cl4, cl4.length - 1);
  }

  const rsi1h = calcRsi14(cl, n - 1);
  const rsiOk = dir === "long" ? (rsi1h >= 42 && rsi1h <= 72) : (rsi1h >= 28 && rsi1h <= 58);
  if (!rsiOk) core.push("C3");

  const av = cs.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const rvol = av > 0 ? last.volume / av : 1;
  if (rvol < 0.9) core.push("C4");

  const e20 = calcEma(cl, 20);
  const atr = calcAtr(cs, n - 1);
  const ad = atr > 0 ? Math.abs(last.close - e20[n - 1]) / atr : 0;
  if (ad > 1.8) core.push("C5");

  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const br = range > 0 ? body / range : 1;
  if (br < 0.35) core.push("C6");

  if (n >= 2) {
    const r2 = cs.slice(-2);
    const al = r2.filter(c => dir === "long" ? c.close > c.open : c.close < c.open).length;
    if (al < 1) core.push("C7");
  }

  if (n >= 50) {
    const ar: number[] = [];
    for (let i = Math.max(1, n - 50); i < n; i++) ar.push(calcAtr(cs, i));
    ar.sort((a, b) => a - b);
    const pct = Math.round((ar.filter(a => a <= atr).length / ar.length) * 100);
    if (pct < 20 || pct > 88) core.push("C8");
  }

  if (family === "pa") {
    if (!(dir === "long" ? last.close >= last.open : last.close <= last.open)) pa.push("PA1");
    if (!(dir === "long" ? rsi1h < 65 : rsi1h > 35)) pa.push("PA2");
    if (!(dir === "long" ? rsi4h > 45 : rsi4h < 55)) pa.push("PA3");
  }
  return { core, pa, rsi4h };
}

function gateStrict(coreF: string[], paF: string[]): boolean {
  return coreF.length <= 1 && paF.length === 0;
}

interface SymbolResult {
  symbol: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  pf: number;
  net_return: number;
  days_per_trade: number;
  by_strategy: Record<string, { trades: number; wins: number; wr: number; }>;
}

async function main() {
  console.log("=== v4.5 strict 多幣對掃描（30 天）===\n");
  const allResults: SymbolResult[] = [];
  let totalDays = 0;

  for (const sym of SYMBOLS) {
    process.stdout.write(`[${sym}] 抓取資料... `);
    let c1h: Candle[], c4h: Candle[];
    try {
      [c1h, c4h] = await Promise.all([
        fetchCandles(sym, "1h", 720),
        fetchCandles(sym, "4h", 360),
      ]);
    } catch (e) {
      console.log(`失敗：${e}`);
      continue;
    }
    const days = (c1h[c1h.length - 1].time - c1h[0].time) / 3600 / 24;
    totalDays = days;
    process.stdout.write(`${c1h.length} 根 1H | ${c4h.length} 根 4H (${days.toFixed(1)} 天) | `);

    let total = 0, wins = 0, gp = 0, gl = 0, ret = 0;
    const byStrat: Record<string, { trades: number; wins: number; wr: number; }> = {};

    for (const cfg of STRATEGIES) {
      let st = 0, sw = 0;
      try {
        const r = runBacktest({
          candles: c1h, strategy: cfg.strategy, symbol: sym, interval: "1h",
          atr_sl_mult: cfg.sl, atr_tp_mult: cfg.tp,
          enable_mtf_filter: true, enable_fee: true, enable_trailing_stop: false, enable_adx_filter: true,
        });
        const trades = r.trades ?? [];
        for (const t of trades) {
          const e = evalChecks(t, c1h, c4h, cfg.family);
          if (gateStrict(e.core, e.pa)) {
            total++; st++;
            ret += t.pnl_net_pct;
            if (t.pnl_net_pct > 0) { wins++; sw++; gp += t.pnl_net_pct; }
            else { gl += Math.abs(t.pnl_net_pct); }
          }
        }
      } catch (e) {
        // skip strategy if backtest fails
      }
      byStrat[cfg.key] = { trades: st, wins: sw, wr: st > 0 ? sw / st * 100 : 0 };
    }

    const wr = total > 0 ? wins / total * 100 : 0;
    const pf = gl > 0 ? gp / gl : (gp > 0 ? 99 : 0);
    const dpt = total > 0 ? days / total : Infinity;

    allResults.push({
      symbol: sym, total_trades: total, wins, losses: total - wins,
      win_rate: wr, pf, net_return: ret, days_per_trade: dpt, by_strategy: byStrat,
    });
    console.log(`${total} 筆 / 勝率 ${wr.toFixed(1)}% / PF ${pf.toFixed(2)} / ${dpt === Infinity ? '—' : dpt.toFixed(2)}天/筆`);
  }

  // 輸出
  console.log("\n" + "=".repeat(95));
  console.log("各幣對 v4.5 strict 表現：");
  console.log("=".repeat(95));
  console.log("幣對".padEnd(12) + "筆數".padStart(6) + "勝率".padStart(9) + "PF".padStart(7) +
              "淨回報%".padStart(11) + "天/筆".padStart(10) + "  納入建議");
  console.log("-".repeat(95));
  for (const r of allResults) {
    const dp = r.days_per_trade === Infinity ? "—" : r.days_per_trade.toFixed(2);
    const include = r.win_rate >= 75 && r.total_trades >= 2;
    const tag = include ? "✅ 納入" : (r.total_trades === 0 ? "⚠️ 無信號" : "❌ 勝率不足");
    console.log(
      r.symbol.padEnd(12) +
      r.total_trades.toString().padStart(6) +
      (r.win_rate.toFixed(1) + "%").padStart(9) +
      r.pf.toFixed(2).padStart(7) +
      ((r.net_return >= 0 ? "+" : "") + r.net_return.toFixed(3)).padStart(11) +
      dp.padStart(10) +
      "  " + tag
    );
  }

  // 多幣對組合統計
  console.log("\n" + "=".repeat(95));
  console.log("多幣對組合（合計）：");
  console.log("=".repeat(95));
  const inc = allResults.filter(r => r.win_rate >= 75 && r.total_trades >= 2);
  const sumT = inc.reduce((s, r) => s + r.total_trades, 0);
  const sumW = inc.reduce((s, r) => s + r.wins, 0);
  const sumR = inc.reduce((s, r) => s + r.net_return, 0);
  const portWR = sumT > 0 ? sumW / sumT * 100 : 0;
  const portDPT = sumT > 0 ? totalDays / sumT : Infinity;
  console.log(`納入 ${inc.length} 個幣對：${inc.map(r => r.symbol).join(", ")}`);
  console.log(`合計：${sumT} 筆 | 勝率 ${portWR.toFixed(1)}% | 淨回報 ${sumR >= 0 ? '+' : ''}${sumR.toFixed(3)}% | ${portDPT === Infinity ? '—' : portDPT.toFixed(2)}天/筆`);

  // 寬鬆組（含勝率 ≥66%）
  const inc2 = allResults.filter(r => r.win_rate >= 66 && r.total_trades >= 2);
  const sumT2 = inc2.reduce((s, r) => s + r.total_trades, 0);
  const sumW2 = inc2.reduce((s, r) => s + r.wins, 0);
  const sumR2 = inc2.reduce((s, r) => s + r.net_return, 0);
  const portWR2 = sumT2 > 0 ? sumW2 / sumT2 * 100 : 0;
  const portDPT2 = sumT2 > 0 ? totalDays / sumT2 : Infinity;
  console.log(`\n（寬鬆閾值 ≥66%）納入 ${inc2.length} 個幣對：${inc2.map(r => r.symbol).join(", ")}`);
  console.log(`合計：${sumT2} 筆 | 勝率 ${portWR2.toFixed(1)}% | 淨回報 ${sumR2 >= 0 ? '+' : ''}${sumR2.toFixed(3)}% | ${portDPT2 === Infinity ? '—' : portDPT2.toFixed(2)}天/筆`);

  const fs = await import("fs/promises");
  await fs.writeFile("/home/ubuntu/runtime/multi_symbol_strict.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    period_days: totalDays,
    by_symbol: allResults,
    portfolio_strict: { symbols: inc.map(r => r.symbol), trades: sumT, wr: portWR, ret: sumR, dpt: portDPT },
    portfolio_loose:  { symbols: inc2.map(r => r.symbol), trades: sumT2, wr: portWR2, ret: sumR2, dpt: portDPT2 },
  }, null, 2));
  console.log("\n結果已寫入 /home/ubuntu/runtime/multi_symbol_strict.json");
}

main().catch(console.error);
