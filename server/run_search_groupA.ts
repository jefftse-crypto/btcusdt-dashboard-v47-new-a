/**
 * 參數搜索 - 組 A：SMC、纏論、EMA交叉、RSI反轉
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
const candles1h = loadCandles(path.join(BASE, "candles_1h.json"));
const candles4h = loadCandles(path.join(BASE, "candles_4h.json"));
const candles1d = loadCandles(path.join(BASE, "candles_1d.json"));

function calcEma200_1d() {
  const closes = candles1d.map(c => c.close);
  const ema200: number[] = [];
  let k = 2 / 201, ema = closes[0];
  for (const c of closes) { ema = c * k + ema * (1 - k); ema200.push(ema); }
  return ema200;
}
const ema200_1d = calcEma200_1d();

function apply1dFilter(trades: any[]): any[] {
  return trades.filter(t => {
    const ms = t.entry_time > 1e10 ? t.entry_time : t.entry_time * 1000;
    const idx = candles1d.findIndex(c => (c.time > 1e10 ? c.time : c.time * 1000) > ms);
    const i = idx > 0 ? idx - 1 : candles1d.length - 1;
    if (i < 200) return true;
    return t.direction === "long" ? candles1d[i].close > ema200_1d[i] : candles1d[i].close < ema200_1d[i];
  });
}

function calcStats(trades: any[]) {
  if (!trades.length) return { trades: 0, win_rate: 0, pf: 0, drawdown: 0, return: 0, sharpe: 0, equity_curve: [1] };
  const wins = trades.filter(t => t.pnl_net_pct > 0).length;
  const gp = trades.filter(t => t.pnl_net_pct > 0).reduce((s, t) => s + t.pnl_net_pct, 0);
  const gl = Math.abs(trades.filter(t => t.pnl_net_pct <= 0).reduce((s, t) => s + t.pnl_net_pct, 0));
  const pf = gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
  let eq = 1, peak = 1, maxDd = 0;
  const eqCurve = [1];
  for (const t of trades) {
    eq *= (1 + t.pnl_net_pct);
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
    eqCurve.push(eq);
  }
  const ret = (eq - 1) * 100;
  const rets = trades.map(t => t.pnl_net_pct * 100);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const sharpe = Math.sqrt(variance) > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  return { trades: trades.length, win_rate: (wins / trades.length) * 100, pf, drawdown: maxDd * 100, return: ret, sharpe, equity_curve: eqCurve };
}

const SL = [0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0];
const TP = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0];
const BOOLS = [true, false];
const MIN = 150, MAX = 250;

const configs = [
  { strategy: "smc", label: "SMC" },
  { strategy: "chan", label: "纏論" },
  { strategy: "ema_cross", label: "EMA交叉" },
  { strategy: "rsi_reversal", label: "RSI反轉" },
];

const results: any[] = [];

for (const cfg of configs) {
  let bestScore = -Infinity, best: any = null;
  process.stdout.write(`\n📊 ${cfg.label.padEnd(10)}`);
  const t0 = Date.now();
  for (const sl of SL) for (const tp of TP) for (const mtf of BOOLS) for (const adx of BOOLS) for (const trail of BOOLS) for (const d1 of BOOLS) for (const htf of BOOLS) {
    try {
      const r = runBacktest({ candles: candles1h, strategy: cfg.strategy as any, symbol: "BTCUSDT", interval: "1h", atr_sl_mult: sl, atr_tp_mult: tp, enable_mtf_filter: mtf, enable_adx_filter: adx, enable_trailing_stop: trail, candles_4h: htf ? candles4h : undefined });
      let trades = d1 ? apply1dFilter(r.trades) : r.trades;
      const s = calcStats(trades);
      if (s.trades < MIN || s.trades > MAX || s.return <= 0) continue;
      const score = s.return * (s.win_rate / 100) * s.pf * Math.max(0.1, s.sharpe) / Math.max(1, s.drawdown);
      if (score > bestScore) { bestScore = score; best = { ...cfg, sl, tp, mtf, adx, trail, d1, htf, ...s }; }
    } catch (_) {}
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (best) {
    results.push(best);
    process.stdout.write(` ✅ ${elapsed}s | 報酬:${best.return.toFixed(2)}%  勝率:${best.win_rate.toFixed(1)}%  PF:${best.pf.toFixed(3)}  回撤:${best.drawdown.toFixed(1)}%  Sharpe:${best.sharpe.toFixed(3)}  交易:${best.trades}  SL:${best.sl}  TP:${best.tp}  MTF:${best.mtf?'Y':'N'}  ADX:${best.adx?'Y':'N'}  Trail:${best.trail?'Y':'N'}  1D:${best.d1?'Y':'N'}  4H:${best.htf?'Y':'N'}`);
  } else {
    process.stdout.write(` ❌ ${elapsed}s | 無正報酬組合`);
  }
}

fs.writeFileSync(path.join(BASE, "search_groupA.json"), JSON.stringify(results, null, 2));
console.log("\n✅ 組A完成");
