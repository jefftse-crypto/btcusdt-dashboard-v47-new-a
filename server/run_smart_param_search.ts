/**
 * 智能參數搜索：縮減搜索空間，聚焦關鍵維度
 * 目標：正報酬 + 勝率提升 + 約 2 天一交易（約 160~220 筆/年）
 *
 * 策略：
 *   - 非 PA 策略：搜索 SL × TP × MTF × ADX × Trail × 1D = 8×9×2×2×2×2 = 576 組
 *   - PA 策略：固定 MTF=true, Trail=true，只搜索 SL × TP × ADX × 1D = 8×9×2×2 = 288 組
 */

import fs from "fs";
import path from "path";
import { runBacktest } from "./backtest.js";
import type { Candle } from "./backtest.js";

function loadCandles(file: string): Candle[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  return raw.map((c: any) => ({
    time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 1,
  }));
}

const BASE = "/home/ubuntu/btcusdt_backtest";
const candles1h  = loadCandles(path.join(BASE, "candles_1h.json"));
const candles4h  = loadCandles(path.join(BASE, "candles_4h.json"));
const candles1d  = loadCandles(path.join(BASE, "candles_1d.json"));

console.log(`1H: ${candles1h.length}  4H: ${candles4h.length}  1D: ${candles1d.length}`);

// ── 計算統計 ──
function calcStats(trades: any[]) {
  if (trades.length === 0) return { trades: 0, win_rate: 0, pf: 0, drawdown: 0, return: 0, sharpe: 0, equity_curve: [1] };
  const wins = trades.filter((t: any) => t.pnl_net_pct > 0).length;
  const winRate = (wins / trades.length) * 100;
  const gp = trades.filter((t: any) => t.pnl_net_pct > 0).reduce((s: number, t: any) => s + t.pnl_net_pct, 0);
  const gl = Math.abs(trades.filter((t: any) => t.pnl_net_pct <= 0).reduce((s: number, t: any) => s + t.pnl_net_pct, 0));
  const pf = gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
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
function apply1dEma200Filter(trades: any[]): any[] {
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
    if (i1d < 200) return true;
    const ema200 = ema200_1d[i1d];
    const price1d = candles1d[i1d].close;
    if (t.direction === "long") return price1d > ema200;
    if (t.direction === "short") return price1d < ema200;
    return true;
  });
}

// ── 策略配置 ──
const strategyConfigs: Array<{
  strategy: string;
  label: string;
  sl_range: number[];
  tp_range: number[];
  mtf_flags: boolean[];
  adx_flags: boolean[];
  trail_flags: boolean[];
  d1_flags: boolean[];
  htf_flags: boolean[];
}> = [
  // PA 策略：計算最慢，縮減搜索空間
  { strategy: "pa", label: "PA 形態", sl_range: [1.0, 1.5, 2.0, 2.5], tp_range: [0.5, 0.8, 1.0, 1.5, 2.0], mtf_flags: [true], adx_flags: [true, false], trail_flags: [true], d1_flags: [true, false], htf_flags: [false] },
  // 快速策略：完整搜索
  { strategy: "smc", label: "SMC", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "chan", label: "纏論", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "ema_cross", label: "EMA 交叉", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "rsi_reversal", label: "RSI 反轉", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "bollinger", label: "布林帶", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5], tp_range: [0.5, 0.8, 1.0, 1.5, 2.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "macd", label: "MACD", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "liquidity_sweep", label: "ICT 流動性", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "vwap_reversion", label: "VWAP 回歸", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5], tp_range: [0.5, 0.8, 1.0, 1.5, 2.0, 2.5], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "composite", label: "複合策略", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "cannonball", label: "CannonBall", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "hwr_model_a", label: "HWR-A", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "hwr_model_b", label: "HWR-B", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
  { strategy: "hwr_model_c", label: "HWR-C", sl_range: [0.8, 1.0, 1.5, 2.0, 2.5], tp_range: [0.8, 1.0, 1.5, 2.0, 2.5, 3.0], mtf_flags: [true, false], adx_flags: [true, false], trail_flags: [true, false], d1_flags: [true, false], htf_flags: [true, false] },
];

const TARGET_MIN = 150;
const TARGET_MAX = 250;

type BestResult = {
  strategy: string; label: string;
  sl: number; tp: number; mtf: boolean; adx: boolean; trail: boolean; d1: boolean; htf: boolean;
  trades: number; win_rate: number; pf: number; drawdown: number; return: number; sharpe: number;
  equity_curve: number[];
};

const allBest: BestResult[] = [];

for (const cfg of strategyConfigs) {
  let bestScore = -Infinity;
  let best: BestResult | null = null;
  let tested = 0;
  const startTime = Date.now();

  process.stdout.write(`\n📊 ${cfg.label.padEnd(14)}`);

  for (const sl of cfg.sl_range) {
    for (const tp of cfg.tp_range) {
      for (const mtf of cfg.mtf_flags) {
        for (const adx of cfg.adx_flags) {
          for (const trail of cfg.trail_flags) {
            for (const d1 of cfg.d1_flags) {
              for (const htf of cfg.htf_flags) {
                tested++;
                try {
                  const result = runBacktest({
                    candles: candles1h,
                    strategy: cfg.strategy as any,
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
                  if (d1) trades = apply1dEma200Filter(trades);

                  const stats = calcStats(trades);
                  if (stats.trades < TARGET_MIN || stats.trades > TARGET_MAX) continue;
                  if (stats.return <= 0) continue;

                  // 評分：綜合報酬、勝率、PF、Sharpe、回撤
                  const score = stats.return * (stats.win_rate / 100) * stats.pf * Math.max(0.1, stats.sharpe) / Math.max(1, stats.drawdown);

                  if (score > bestScore) {
                    bestScore = score;
                    best = { strategy: cfg.strategy, label: cfg.label, sl, tp, mtf, adx, trail, d1, htf, ...stats };
                  }
                } catch (_) {}
              }
            }
          }
        }
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (best) {
    allBest.push(best);
    process.stdout.write(` ✅ ${elapsed}s | 報酬:${best.return.toFixed(2)}%  勝率:${best.win_rate.toFixed(1)}%  PF:${best.pf.toFixed(3)}  回撤:${best.drawdown.toFixed(1)}%  Sharpe:${best.sharpe.toFixed(3)}  交易:${best.trades}  SL:${best.sl}  TP:${best.tp}  MTF:${best.mtf?'Y':'N'}  ADX:${best.adx?'Y':'N'}  Trail:${best.trail?'Y':'N'}  1D:${best.d1?'Y':'N'}  4H:${best.htf?'Y':'N'}`);
  } else {
    process.stdout.write(` ❌ ${elapsed}s | 無法在 ${TARGET_MIN}~${TARGET_MAX} 筆範圍內找到正報酬（共測 ${tested} 組）`);
  }
}

const outPath = path.join(BASE, "smart_param_search_results.json");
fs.writeFileSync(outPath, JSON.stringify(allBest, null, 2));
console.log(`\n\n✅ 結果已儲存：${outPath}`);
console.log(`\n${"=".repeat(110)}`);
console.log("  最終排名（按報酬降序）");
console.log("=".repeat(110));
allBest.sort((a, b) => b.return - a.return);
for (const r of allBest) {
  const mark = r.return > 10 ? "🏆" : r.return > 5 ? "✅" : "🔸";
  console.log(`  ${mark} ${r.label.padEnd(14)} 報酬:${r.return.toFixed(2).padStart(7)}%  勝率:${r.win_rate.toFixed(1).padStart(5)}%  PF:${r.pf.toFixed(3)}  回撤:${r.drawdown.toFixed(1).padStart(5)}%  Sharpe:${r.sharpe.toFixed(3)}  交易:${r.trades}  SL:${r.sl}×ATR  TP:${r.tp}×ATR  MTF:${r.mtf?'Y':'N'}  ADX:${r.adx?'Y':'N'}  Trail:${r.trail?'Y':'N'}  1D:${r.d1?'Y':'N'}  4H:${r.htf?'Y':'N'}`);
}
