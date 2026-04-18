/**
 * 快速全策略參數搜索
 * 縮減搜索空間：SL(8) × TP(9) × 1D(2) = 144 組/策略
 * 固定：MTF=true, ADX=true, Trail=true, HTF4H=true（最常見最優配置）
 * 目標：正報酬 + 約 2 天一交易（150~250 筆/年）
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

// 預計算 1D EMA200
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

const SL_RANGE = [0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0];
const TP_RANGE = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0];
const MIN_TRADES = 150, MAX_TRADES = 250;

const STRATEGIES = [
  { id: "smc",              label: "SMC" },
  { id: "chan",             label: "纏論" },
  { id: "ema_cross",        label: "EMA交叉" },
  { id: "rsi_reversal",     label: "RSI反轉" },
  { id: "bollinger",        label: "布林帶" },
  { id: "macd",             label: "MACD" },
  { id: "liquidity_sweep",  label: "ICT流動性" },
  { id: "vwap_reversion",   label: "VWAP回歸" },
  { id: "composite",        label: "複合策略" },
  { id: "cannonball",       label: "CannonBall" },
  { id: "hwr_model_a",      label: "HWR-A" },
  { id: "hwr_model_b",      label: "HWR-B" },
  { id: "hwr_model_c",      label: "HWR-C" },
];

// 固定配置矩陣（4種組合）
const FIXED_CONFIGS = [
  { mtf: true,  adx: true,  trail: true,  htf: true  },
  { mtf: true,  adx: false, trail: true,  htf: true  },
  { mtf: false, adx: true,  trail: true,  htf: false },
  { mtf: false, adx: false, trail: false, htf: false },
];

const allBest: any[] = [];

for (const strat of STRATEGIES) {
  let bestScore = -Infinity, best: any = null;
  const t0 = Date.now();
  process.stdout.write(`\n📊 ${strat.label.padEnd(12)}`);

  for (const sl of SL_RANGE) {
    for (const tp of TP_RANGE) {
      for (const d1 of [true, false]) {
        for (const fc of FIXED_CONFIGS) {
          try {
            const r = runBacktest({
              candles: c1h, strategy: strat.id as any, symbol: "BTCUSDT", interval: "1h",
              atr_sl_mult: sl, atr_tp_mult: tp,
              enable_mtf_filter: fc.mtf, enable_adx_filter: fc.adx, enable_trailing_stop: fc.trail,
              candles_4h: fc.htf ? c4h : undefined,
            });
            let trades = d1 ? apply1dFilter(r.trades) : r.trades;
            const s = calcStats(trades);
            if (s.n < MIN_TRADES || s.n > MAX_TRADES || s.ret <= 0) continue;
            const score = s.ret * (s.wr/100) * s.pf * Math.max(0.1, s.sharpe) / Math.max(1, s.dd);
            if (score > bestScore) {
              bestScore = score;
              best = { id: strat.id, label: strat.label, sl, tp, d1, ...fc, trades: s.n, win_rate: s.wr, pf: s.pf, drawdown: s.dd, return: s.ret, sharpe: s.sharpe, equity_curve: s.eq };
            }
          } catch (_) {}
        }
      }
    }
  }

  const elapsed = ((Date.now()-t0)/1000).toFixed(1);
  if (best) {
    allBest.push(best);
    process.stdout.write(` ✅ ${elapsed}s | 報酬:${best.return.toFixed(2)}%  勝率:${best.win_rate.toFixed(1)}%  PF:${best.pf.toFixed(3)}  回撤:${best.drawdown.toFixed(1)}%  Sharpe:${best.sharpe.toFixed(3)}  交易:${best.trades}  SL:${best.sl}  TP:${best.tp}  MTF:${best.mtf?'Y':'N'}  ADX:${best.adx?'Y':'N'}  Trail:${best.trail?'Y':'N'}  1D:${best.d1?'Y':'N'}  4H:${best.htf?'Y':'N'}`);
  } else {
    process.stdout.write(` ❌ ${elapsed}s | 無正報酬組合（${MIN_TRADES}~${MAX_TRADES}筆）`);
  }
}

const outPath = path.join(BASE, "fast_search_results.json");
fs.writeFileSync(outPath, JSON.stringify(allBest, null, 2));

console.log(`\n\n${"=".repeat(120)}`);
console.log("  最終排名（按報酬降序）");
console.log("=".repeat(120));
allBest.sort((a, b) => b.return - a.return);
for (const r of allBest) {
  const mark = r.return > 15 ? "🏆" : r.return > 8 ? "✅" : "🔸";
  console.log(`  ${mark} ${r.label.padEnd(12)} 報酬:${r.return.toFixed(2).padStart(7)}%  勝率:${r.win_rate.toFixed(1).padStart(5)}%  PF:${r.pf.toFixed(3)}  回撤:${r.drawdown.toFixed(1).padStart(5)}%  Sharpe:${r.sharpe.toFixed(3)}  交易:${r.trades}  SL:${r.sl}×  TP:${r.tp}×  MTF:${r.mtf?'Y':'N'}  ADX:${r.adx?'Y':'N'}  Trail:${r.trail?'Y':'N'}  1D:${r.d1?'Y':'N'}  4H:${r.htf?'Y':'N'}`);
}
console.log(`\n✅ 結果已儲存：${outPath}`);
