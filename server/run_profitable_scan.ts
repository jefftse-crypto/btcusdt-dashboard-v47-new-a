/**
 * 針對盈利策略的精準參數掃描
 * 只掃描：CannonBall、HWR-A、HWR-B
 * 搜索：SL(6) × TP(9) × 1D(2) × 固定配置(2) = 216 組/策略
 * 目標：正報酬 + 150~250 筆/年 + 最高 Sharpe
 */
import fs from "fs";
import path from "path";
import { runBacktest } from "./backtest.js";
import type { Candle } from "./backtest.js";

function loadCandles(file: string): Candle[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  return raw.map((c: any) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 1 }));
}

const BASE = "/home/ubuntu/btcusdt_backtest";
const c1h = loadCandles(path.join(BASE, "candles_1h.json"));
const c4h = loadCandles(path.join(BASE, "candles_4h.json"));
const c1d = loadCandles(path.join(BASE, "candles_1d.json"));

const ema200_1d: number[] = [];
{ let k = 2/201, ema = c1d[0].close; for (const c of c1d) { ema = c.close*k + ema*(1-k); ema200_1d.push(ema); } }

function apply1dFilter(trades: any[]): any[] {
  return trades.filter(t => {
    const ms = t.entry_time > 1e10 ? t.entry_time : t.entry_time * 1000;
    const idx = c1d.findIndex(c => (c.time > 1e10 ? c.time : c.time * 1000) > ms);
    const i = idx > 0 ? idx - 1 : c1d.length - 1;
    if (i < 200) return true;
    return t.direction === "long" ? c1d[i].close > ema200_1d[i] : c1d[i].close < ema200_1d[i];
  });
}

function calcStats(trades: any[]) {
  if (!trades.length) return { n: 0, wr: 0, pf: 0, dd: 0, ret: 0, sharpe: 0, eq: [1] };
  const wins = trades.filter(t => t.pnl_net_pct > 0).length;
  const gp = trades.filter(t => t.pnl_net_pct > 0).reduce((s, t) => s + t.pnl_net_pct, 0);
  const gl = Math.abs(trades.filter(t => t.pnl_net_pct <= 0).reduce((s, t) => s + t.pnl_net_pct, 0));
  const pf = gl > 0 ? gp/gl : gp > 0 ? 99 : 0;
  let eq = 1, peak = 1, maxDd = 0; const eqArr = [1];
  for (const t of trades) {
    eq *= (1 + t.pnl_net_pct);
    if (eq > peak) peak = eq;
    const dd = (peak - eq)/peak; if (dd > maxDd) maxDd = dd;
    eqArr.push(eq);
  }
  const ret = (eq-1)*100;
  const rets = trades.map(t => t.pnl_net_pct*100);
  const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
  const variance = rets.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,rets.length-1);
  const sharpe = Math.sqrt(variance) > 0 ? (mean/Math.sqrt(variance))*Math.sqrt(252) : 0;
  return { n: trades.length, wr: (wins/trades.length)*100, pf, dd: maxDd*100, ret, sharpe, eq: eqArr };
}

// 盈利策略：使用它們的原始固定配置（不改變 MTF/ADX/Trail）
const STRATEGIES = [
  { id: "hwr_model_b", label: "HWR-B", mtf: true, adx: true, trail: true, htf: true },
  { id: "cannonball",  label: "CannonBall", mtf: true, adx: true, trail: true, htf: true },
  { id: "hwr_model_a", label: "HWR-A", mtf: true, adx: true, trail: true, htf: true },
];

const SL_RANGE = [0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0];
const TP_RANGE = [0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
const MIN_TRADES = 150, MAX_TRADES = 250;

const allResults: any[] = [];

for (const strat of STRATEGIES) {
  const stratResults: any[] = [];
  const t0 = Date.now();
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 ${strat.label} 掃描中...`);

  for (const sl of SL_RANGE) {
    for (const tp of TP_RANGE) {
      for (const d1 of [true, false]) {
        try {
          const r = runBacktest({
            candles: c1h, strategy: strat.id as any, symbol: "BTCUSDT", interval: "1h",
            atr_sl_mult: sl, atr_tp_mult: tp,
            enable_mtf_filter: strat.mtf, enable_adx_filter: strat.adx, enable_trailing_stop: strat.trail,
            candles_4h: strat.htf ? c4h : undefined,
          });
          let trades = d1 ? apply1dFilter(r.trades) : r.trades;
          const s = calcStats(trades);
          stratResults.push({ sl, tp, d1, n: s.n, wr: s.wr, pf: s.pf, dd: s.dd, ret: s.ret, sharpe: s.sharpe, eq: s.eq });
        } catch (_) {}
      }
    }
  }

  // 找最優：在 150~250 筆範圍內，按報酬排序
  const inRange = stratResults.filter(r => r.n >= MIN_TRADES && r.n <= MAX_TRADES && r.ret > 0);
  inRange.sort((a, b) => b.ret - a.ret);

  console.log(`  完成 ${stratResults.length} 組，${inRange.length} 組符合條件`);
  console.log(`  Top 10 結果（150~250筆，正報酬）：`);
  for (const r of inRange.slice(0, 10)) {
    console.log(`    SL:${r.sl}  TP:${r.tp}  1D:${r.d1?'Y':'N'}  交易:${r.n}  報酬:${r.ret.toFixed(2)}%  勝率:${r.wr.toFixed(1)}%  PF:${r.pf.toFixed(3)}  回撤:${r.dd.toFixed(1)}%  Sharpe:${r.sharpe.toFixed(3)}`);
  }

  if (inRange.length > 0) {
    const best = inRange[0];
    allResults.push({ ...strat, ...best, label: strat.label });
  }

  const elapsed = ((Date.now()-t0)/1000).toFixed(1);
  console.log(`  耗時: ${elapsed}s`);
}

const outPath = path.join(BASE, "profitable_scan_results.json");
fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));

console.log(`\n${"=".repeat(80)}`);
console.log("  最終最優組合");
console.log("=".repeat(80));
for (const r of allResults) {
  console.log(`  🏆 ${r.label.padEnd(12)} 報酬:${r.ret.toFixed(2)}%  勝率:${r.wr.toFixed(1)}%  PF:${r.pf.toFixed(3)}  回撤:${r.dd.toFixed(1)}%  Sharpe:${r.sharpe.toFixed(3)}  交易:${r.n}  SL:${r.sl}×ATR  TP:${r.tp}×ATR  1D:${r.d1?'Y':'N'}`);
}
console.log(`\n✅ 結果已儲存：${outPath}`);
