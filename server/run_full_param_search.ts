/**
 * 全策略參數搜索：從零開始，不依賴現有改良
 * 目標：正報酬 + 勝率提升 + 約 2 天一交易（約 160~200 筆/年）
 *
 * 搜索維度：
 *   1. atr_sl_mult: 0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5
 *   2. atr_tp_mult: 0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0
 *   3. enable_mtf_filter: true / false
 *   4. enable_adx_filter: true / false
 *   5. enable_trailing_stop: true / false
 *   6. 1D EMA200 後過濾: on / off
 *   7. 4H MTF: on / off
 */

import fs from "fs";
import path from "path";
import { runBacktest } from "./backtest.js";
import type { Candle } from "./backtest.js";

// ── 載入 Binance K 線 ──
function loadCandles(file: string): Candle[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  return raw.map((c: any) => ({
    time:   c.time,
    open:   c.open,
    high:   c.high,
    low:    c.low,
    close:  c.close,
    volume: c.volume ?? 1,
  }));
}

const BASE = "/home/ubuntu/btcusdt_backtest";
const candles1h = loadCandles(path.join(BASE, "candles_1h.json"));
const candles4h = loadCandles(path.join(BASE, "candles_4h.json"));
const candles1d = loadCandles(path.join(BASE, "candles_1d.json"));
const candles15m = loadCandles(path.join(BASE, "candles_15m.json"));

console.log(`1H: ${candles1h.length} 根  4H: ${candles4h.length} 根  1D: ${candles1d.length} 根  15m: ${candles15m.length} 根`);

// ── 計算統計 ──
function calcStats(trades: any[]) {
  if (trades.length === 0) return { trades: 0, win_rate: 0, pf: 0, drawdown: 0, return: 0, sharpe: 0, equity_curve: [1] };
  const wins = trades.filter((t: any) => t.pnl_net_pct > 0).length;
  const winRate = (wins / trades.length) * 100;
  const grossProfit = trades.filter((t: any) => t.pnl_net_pct > 0).reduce((s: number, t: any) => s + t.pnl_net_pct, 0);
  const grossLoss   = Math.abs(trades.filter((t: any) => t.pnl_net_pct <= 0).reduce((s: number, t: any) => s + t.pnl_net_pct, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  let equity = 1.0, peak = 1.0, maxDd = 0;
  const eqCurve: number[] = [1.0];
  for (const t of trades) {
    equity *= (1 + (t.pnl_net_pct ?? 0));
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
    eqCurve.push(equity);
  }
  const totalReturn = (equity - 1) * 100;
  const returns = trades.map((t: any) => (t.pnl_net_pct ?? 0) * 100);
  const mean = returns.reduce((a: number, b: number) => a + b, 0) / returns.length;
  const variance = returns.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / Math.max(1, returns.length - 1);
  const sharpe = Math.sqrt(variance) > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  return { trades: trades.length, win_rate: winRate, pf, drawdown: maxDd * 100, return: totalReturn, sharpe, equity_curve: eqCurve };
}

// ── 1D EMA200 後過濾 ──
function apply1dEma200Filter(trades: any[], candles1d: Candle[]): any[] {
  // 計算 1D EMA200
  const closes1d = candles1d.map(c => c.close);
  const ema200_1d: number[] = [];
  let k = 2 / (200 + 1);
  let ema = closes1d[0];
  for (const c of closes1d) { ema = c * k + ema * (1 - k); ema200_1d.push(ema); }
  return trades.filter(t => {
    const entryMs = t.entry_time > 1e10 ? t.entry_time : t.entry_time * 1000;
    const idx = candles1d.findIndex(c => {
      const cMs = c.time > 1e10 ? c.time : c.time * 1000;
      return cMs > entryMs;
    });
    const i1d = idx > 0 ? idx - 1 : candles1d.length - 1;
    if (i1d < 200) return true; // 預熱期不過濾
    const ema200 = ema200_1d[i1d];
    const price1d = candles1d[i1d].close;
    if (t.direction === "long") return price1d > ema200;
    if (t.direction === "short") return price1d < ema200;
    return true;
  });
}

// ── 策略列表 ──
const strategies = [
  "pa", "smc", "chan", "ema_cross", "rsi_reversal", "bollinger", "macd",
  "liquidity_sweep", "vwap_reversion", "composite", "cannonball",
  "hwr_model_a", "hwr_model_b", "hwr_model_c"
] as const;

// ── 搜索空間 ──
const SL_MULTS   = [0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0];
const TP_MULTS   = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0];
const MTF_FLAGS  = [true, false];
const ADX_FLAGS  = [true, false];
const TRAIL_FLAGS = [true, false];
const D1_FLAGS   = [true, false];
const HTF_FLAGS  = [true, false]; // 是否傳入 4H K 線作為 HTF

// 目標：160~220 筆/年，正報酬，勝率盡量高
const TARGET_MIN_TRADES = 150;
const TARGET_MAX_TRADES = 250;

type BestResult = {
  strategy: string;
  sl: number; tp: number;
  mtf: boolean; adx: boolean; trail: boolean; d1: boolean; htf: boolean;
  trades: number; win_rate: number; pf: number; drawdown: number;
  return: number; sharpe: number;
  equity_curve: number[];
};

const allBest: BestResult[] = [];

for (const strategy of strategies) {
  const label = strategy;
  let bestScore = -Infinity;
  let best: BestResult | null = null;
  let totalCombinations = 0;
  let testedCombinations = 0;

  process.stdout.write(`\n📊 ${label.padEnd(20)}`);

  for (const sl of SL_MULTS) {
    for (const tp of TP_MULTS) {
      for (const mtf of MTF_FLAGS) {
        for (const adx of ADX_FLAGS) {
          for (const trail of TRAIL_FLAGS) {
            for (const d1 of D1_FLAGS) {
              for (const htf of HTF_FLAGS) {
                totalCombinations++;
                try {
                  const result = runBacktest({
                    candles: candles1h,
                    strategy: strategy as any,
                    symbol: "BTCUSDT",
                    interval: "1h",
                    atr_sl_mult: sl,
                    atr_tp_mult: tp,
                    enable_mtf_filter: mtf,
                    enable_adx_filter: adx,
                    enable_trailing_stop: trail,
                    candles_4h: htf ? candles4h : undefined,
                  });

                  let trades = result.trades;
                  if (d1) trades = apply1dEma200Filter(trades, candles1d);

                  const stats = calcStats(trades);

                  // 過濾：交易數在目標範圍內
                  if (stats.trades < TARGET_MIN_TRADES || stats.trades > TARGET_MAX_TRADES) continue;
                  // 過濾：正報酬
                  if (stats.return <= 0) continue;

                  testedCombinations++;

                  // 評分：報酬 × 勝率 × PF / 回撤
                  const score = stats.return * (stats.win_rate / 100) * stats.pf / Math.max(1, stats.drawdown);

                  if (score > bestScore) {
                    bestScore = score;
                    best = {
                      strategy: label,
                      sl, tp, mtf, adx, trail, d1, htf,
                      ...stats,
                    };
                  }
                } catch (e) {
                  // 忽略錯誤
                }
              }
            }
          }
        }
      }
    }
  }

  if (best) {
    allBest.push(best);
    process.stdout.write(` ✅ 報酬:${best.return.toFixed(2)}%  勝率:${best.win_rate.toFixed(1)}%  PF:${best.pf.toFixed(3)}  回撤:${best.drawdown.toFixed(1)}%  交易:${best.trades}  SL:${best.sl}×ATR  TP:${best.tp}×ATR  MTF:${best.mtf}  ADX:${best.adx}  Trail:${best.trail}  1D:${best.d1}  HTF4H:${best.htf}`);
  } else {
    process.stdout.write(` ❌ 無法在目標範圍內找到正報酬組合（共測 ${totalCombinations} 組）`);
  }
}

// ── 儲存結果 ──
const outPath = path.join(BASE, "full_param_search_results.json");
fs.writeFileSync(outPath, JSON.stringify(allBest, null, 2));
console.log(`\n\n✅ 結果已儲存：${outPath}`);
console.log(`\n${"=".repeat(100)}`);
console.log("  最終排名（按報酬降序）");
console.log("=".repeat(100));
allBest.sort((a, b) => b.return - a.return);
for (const r of allBest) {
  console.log(`  ${r.strategy.padEnd(20)} 報酬:${r.return.toFixed(2).padStart(7)}%  勝率:${r.win_rate.toFixed(1).padStart(5)}%  PF:${r.pf.toFixed(3)}  回撤:${r.drawdown.toFixed(1).padStart(5)}%  Sharpe:${r.sharpe.toFixed(3)}  交易:${r.trades}  SL:${r.sl}×  TP:${r.tp}×  MTF:${r.mtf?'Y':'N'}  ADX:${r.adx?'Y':'N'}  Trail:${r.trail?'Y':'N'}  1D:${r.d1?'Y':'N'}  HTF4H:${r.htf?'Y':'N'}`);
}
