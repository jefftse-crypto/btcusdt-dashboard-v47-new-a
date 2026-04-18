/**
 * backtest_highwinrate_v2.ts — 高勝率 (75%+) 回測驗證 v2
 * 
 * 核心策略改變：不再依賴單一品質分門檻，而是建立多維度「確認清單」
 * 每個確認項獨立判斷，必須全部通過才放行
 * 
 * 確認清單（8 項）：
 *   C1. 時段確認：倫敦/紐約/重疊時段
 *   C2. HTF 趨勢確認：4H EMA20 斜率 + 價格位置
 *   C3. 1H RSI 方向確認：做多 RSI 45-70，做空 RSI 30-55
 *   C4. 成交量確認：RVOL >= 0.9（當前成交量 >= 90% 平均）
 *   C5. 價格未過度延伸：距離 EMA20 < 1.8 ATR
 *   C6. K 線實體確認：實體比 >= 35%
 *   C7. 近期動量：最近 2 根 K 線至少 1 根與方向一致
 *   C8. ATR 健康：百分位 20-88%
 * 
 * PA 策略額外要求（3 項）：
 *   PA1. 最近 K 線方向一致
 *   PA2. RSI 不在極端區（做多 < 65，做空 > 35）
 *   PA3. 4H RSI 方向一致（做多 > 45，做空 < 55）
 */

import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestResult, type BacktestTrade } from "./backtest.js";

// ── 策略配置 ──
const STRATEGIES: {
  key: string;
  strategy: BacktestStrategy;
  family: string;
  tp: number;
  sl: number;
}[] = [
  { key: "pa_v4_focus", strategy: "pa", family: "pa", tp: 0.5, sl: 1.95 },
  { key: "hwr_b_guarded", strategy: "hwr_model_b", family: "trend_pullback", tp: 2, sl: 1.5 },
  { key: "cannonball_guarded", strategy: "cannonball", family: "structure", tp: 2, sl: 1.5 },
  { key: "ema_cross_confirm", strategy: "ema_cross", family: "trend_confirm", tp: 1.5, sl: 1.5 },
  { key: "vwap_reversion_confirm", strategy: "vwap_reversion", family: "mean_reversion", tp: 1.5, sl: 1.5 },
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

function getUtcHour(timestampMs: number): number {
  return new Date(timestampMs).getUTCHours();
}

interface CheckResult {
  pass: boolean;
  failed_checks: string[];
  passed_count: number;
  total_checks: number;
  details: Record<string, string>;
}

// ── 核心確認清單 ──
function runChecklist(
  trade: BacktestTrade,
  candles1h: Candle[],
  candles4h: Candle[],
  family: string,
): CheckResult {
  const tradeTime = trade.entry_time;
  const candleIdx = candles1h.findIndex(c => c.time >= tradeTime);
  if (candleIdx < 50) return { pass: true, failed_checks: [], passed_count: 0, total_checks: 0, details: {} };

  const n = candleIdx + 1;
  const candles = candles1h.slice(0, n);
  const closes = candles.map(c => c.close);
  const lastCandle = candles[n - 1];
  const dir = trade.direction;
  
  const failed: string[] = [];
  const details: Record<string, string> = {};
  let totalChecks = 8;

  // ═══ C1. 時段確認 ═══
  const utcHour = getUtcHour(tradeTime * 1000);
  const isGoodSession = (utcHour >= 7 && utcHour < 22); // 倫敦+紐約
  if (!isGoodSession) {
    failed.push("C1_session");
    details["C1"] = `UTC ${utcHour}h（亞洲/離峰）`;
  } else {
    details["C1"] = `UTC ${utcHour}h ✓`;
  }

  // ═══ C2. HTF 趨勢確認：4H EMA20 斜率 + 價格位置 ═══
  const candles4hUp = candles4h.filter(c => c.time <= tradeTime);
  if (candles4hUp.length >= 25) {
    const closes4h = candles4hUp.map(c => c.close);
    const ema20_4h = calcEmaArr(closes4h, 20);
    const lastEma = ema20_4h[ema20_4h.length - 1];
    const prevEma = ema20_4h[ema20_4h.length - 2];
    const slope = lastEma - prevEma;
    const lastClose4h = closes4h[closes4h.length - 1];
    
    // 斜率方向 + 價格在 EMA 正確側
    const slopeOk = dir === "long" ? slope >= 0 : slope <= 0;
    const posOk = dir === "long" ? lastClose4h >= lastEma * 0.995 : lastClose4h <= lastEma * 1.005;
    
    if (!slopeOk || !posOk) {
      failed.push("C2_htf_trend");
      details["C2"] = `4H EMA slope=${slope.toFixed(1)} pos=${(lastClose4h/lastEma*100-100).toFixed(2)}%`;
    } else {
      details["C2"] = `4H 趨勢對齊 ✓`;
    }
  }

  // ═══ C3. 1H RSI 方向確認 ═══
  const rsi1h = calcRsi14(closes, n - 1);
  const rsiOk = dir === "long" ? (rsi1h >= 42 && rsi1h <= 72) : (rsi1h >= 28 && rsi1h <= 58);
  if (!rsiOk) {
    failed.push("C3_rsi");
    details["C3"] = `RSI=${rsi1h.toFixed(1)}（${dir === "long" ? "需 42-72" : "需 28-58"}）`;
  } else {
    details["C3"] = `RSI=${rsi1h.toFixed(1)} ✓`;
  }

  // ═══ C4. 成交量確認：RVOL >= 0.9 ═══
  const avgVol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const rvol = avgVol20 > 0 ? lastCandle.volume / avgVol20 : 1;
  if (rvol < 0.9) {
    failed.push("C4_volume");
    details["C4"] = `RVOL=${rvol.toFixed(2)}（需 ≥ 0.9）`;
  } else {
    details["C4"] = `RVOL=${rvol.toFixed(2)} ✓`;
  }

  // ═══ C5. 價格未過度延伸 ═══
  const ema20 = calcEmaArr(closes, 20);
  const atr = calcAtr(candles, n - 1);
  const distFromEma = Math.abs(lastCandle.close - ema20[n - 1]);
  const atrDist = atr > 0 ? distFromEma / atr : 0;
  if (atrDist > 1.8) {
    failed.push("C5_overextended");
    details["C5"] = `距 EMA20 ${atrDist.toFixed(2)} ATR（需 < 1.8）`;
  } else {
    details["C5"] = `距 EMA20 ${atrDist.toFixed(2)} ATR ✓`;
  }

  // ═══ C6. K 線實體確認 ═══
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const range = lastCandle.high - lastCandle.low;
  const bodyRatio = range > 0 ? body / range : 1;
  if (bodyRatio < 0.35) {
    failed.push("C6_candle_form");
    details["C6"] = `實體比 ${(bodyRatio*100).toFixed(0)}%（需 ≥ 35%）`;
  } else {
    details["C6"] = `實體比 ${(bodyRatio*100).toFixed(0)}% ✓`;
  }

  // ═══ C7. 近期動量 ═══
  if (n >= 2) {
    const recent2 = candles.slice(-2);
    const aligned = recent2.filter(c => 
      dir === "long" ? c.close > c.open : c.close < c.open
    ).length;
    if (aligned < 1) {
      failed.push("C7_momentum");
      details["C7"] = `近 2 根 0 根方向一致`;
    } else {
      details["C7"] = `近 2 根 ${aligned} 根一致 ✓`;
    }
  }

  // ═══ C8. ATR 健康 ═══
  if (n >= 50) {
    const atrArr: number[] = [];
    for (let i = Math.max(1, n - 50); i < n; i++) {
      atrArr.push(calcAtr(candles, i));
    }
    atrArr.sort((a, b) => a - b);
    const currentAtr = atr;
    const rank = atrArr.filter(a => a <= currentAtr).length;
    const percentile = Math.round((rank / atrArr.length) * 100);
    if (percentile < 20 || percentile > 88) {
      failed.push("C8_atr_health");
      details["C8"] = `ATR 百分位 ${percentile}%（需 20-88%）`;
    } else {
      details["C8"] = `ATR 百分位 ${percentile}% ✓`;
    }
  }

  // ═══ PA 額外確認 ═══
  if (family === "pa") {
    totalChecks += 3;

    // PA1. 最近 K 線方向一致
    const paCandle = dir === "long" ? lastCandle.close >= lastCandle.open : lastCandle.close <= lastCandle.open;
    if (!paCandle) {
      failed.push("PA1_candle_dir");
      details["PA1"] = `K 線方向不一致`;
    } else {
      details["PA1"] = `K 線方向一致 ✓`;
    }

    // PA2. RSI 不在極端區
    const paRsiOk = dir === "long" ? rsi1h < 65 : rsi1h > 35;
    if (!paRsiOk) {
      failed.push("PA2_rsi_extreme");
      details["PA2"] = `RSI ${rsi1h.toFixed(1)} 極端`;
    } else {
      details["PA2"] = `RSI ${rsi1h.toFixed(1)} 正常 ✓`;
    }

    // PA3. 4H RSI 方向一致
    if (candles4hUp.length >= 25) {
      const closes4h = candles4hUp.map(c => c.close);
      const rsi4h = calcRsi14(closes4h, closes4h.length - 1);
      const pa4hOk = dir === "long" ? rsi4h > 45 : rsi4h < 55;
      if (!pa4hOk) {
        failed.push("PA3_4h_rsi");
        details["PA3"] = `4H RSI ${rsi4h.toFixed(1)} 方向不一致`;
      } else {
        details["PA3"] = `4H RSI ${rsi4h.toFixed(1)} ✓`;
      }
    }
  }

  const passedCount = totalChecks - failed.length;
  // 核心 8 項允許最多 1 項失敗，PA 額外 3 項必須全過
  const coreFailed = failed.filter(f => !f.startsWith("PA")).length;
  const paFailed = failed.filter(f => f.startsWith("PA")).length;
  const pass = coreFailed <= 1 && paFailed === 0;

  return { pass, failed_checks: failed, passed_count: passedCount, total_checks: totalChecks, details };
}

// ── 主函數 ──
async function main() {
  console.log("=== BTCUSDT 高勝率 (75%+) 回測驗證 v2 ===\n");
  console.log("策略：8 項確認清單（容錯 1）+ PA 3 項額外確認（零容錯）\n");

  console.log("正在抓取 K 線數據...");
  const [candles1h, candles4h] = await Promise.all([
    fetchCandles("BTCUSDT", "1h", 1000),
    fetchCandles("BTCUSDT", "4h", 1000),
  ]);
  console.log(`1H: ${candles1h.length} 根 | 4H: ${candles4h.length} 根\n`);

  interface StratResult {
    strategy: string;
    family: string;
    orig_trades: number;
    orig_wins: number;
    orig_wr: number;
    orig_pf: number;
    filt_trades: number;
    filt_wins: number;
    filt_wr: number;
    filt_pf: number;
    filt_return: number;
    filter_breakdown: Record<string, number>;
    passed_trades_detail: string[];
  }

  const results: StratResult[] = [];

  for (const cfg of STRATEGIES) {
    let btResult: BacktestResult;
    try {
      btResult = runBacktest({
        candles: candles1h,
        strategy: cfg.strategy,
        symbol: "BTCUSDT",
        interval: "1h",
        atr_sl_mult: cfg.sl,
        atr_tp_mult: cfg.tp,
        enable_mtf_filter: true,
        enable_fee: true,
        enable_trailing_stop: false,
        enable_adx_filter: true,
      });
    } catch (err) {
      console.log(`[${cfg.key}] 回測失敗: ${err}`);
      continue;
    }

    const trades = btResult.trades ?? [];
    const filterBreakdown: Record<string, number> = {};
    const filteredTrades: BacktestTrade[] = [];
    const passedDetails: string[] = [];

    for (const trade of trades) {
      const result = runChecklist(trade, candles1h, candles4h, cfg.family);
      if (!result.pass) {
        for (const f of result.failed_checks) {
          filterBreakdown[f] = (filterBreakdown[f] ?? 0) + 1;
        }
      } else {
        filteredTrades.push(trade);
        const win = trade.pnl_net_pct > 0 ? "WIN" : "LOSS";
        passedDetails.push(`${win} ${trade.direction} @ ${trade.entry_price.toFixed(0)} | PnL ${trade.pnl_net_pct >= 0 ? '+' : ''}${trade.pnl_net_pct.toFixed(4)}% | passed ${result.passed_count}/${result.total_checks} | failed: [${result.failed_checks.join(',')}]`);
      }
    }

    const calcPF = (arr: BacktestTrade[]) => {
      const gp = arr.filter(t => t.pnl_net_pct > 0).reduce((s, t) => s + t.pnl_net_pct, 0);
      const gl = Math.abs(arr.filter(t => t.pnl_net_pct < 0).reduce((s, t) => s + t.pnl_net_pct, 0));
      return gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
    };

    const origWins = trades.filter(t => t.pnl_net_pct > 0).length;
    const filtWins = filteredTrades.filter(t => t.pnl_net_pct > 0).length;

    results.push({
      strategy: cfg.key,
      family: cfg.family,
      orig_trades: trades.length,
      orig_wins: origWins,
      orig_wr: trades.length > 0 ? (origWins / trades.length) * 100 : 0,
      orig_pf: calcPF(trades),
      filt_trades: filteredTrades.length,
      filt_wins: filtWins,
      filt_wr: filteredTrades.length > 0 ? (filtWins / filteredTrades.length) * 100 : 0,
      filt_pf: calcPF(filteredTrades),
      filt_return: filteredTrades.reduce((s, t) => s + t.pnl_net_pct, 0),
      filter_breakdown: filterBreakdown,
      passed_trades_detail: passedDetails,
    });
  }

  // 輸出結果
  console.log("=".repeat(80));
  console.log("高勝率過濾結果 v2（確認清單模式）");
  console.log("=".repeat(80));
  console.log("");

  for (const r of results) {
    console.log(`📊 ${r.strategy}（${r.family}）`);
    console.log(`   原始：${r.orig_trades} 筆 | 勝率 ${r.orig_wr.toFixed(1)}% | PF ${r.orig_pf.toFixed(2)}`);
    console.log(`   過濾後：${r.filt_trades} 筆 | 勝率 ${r.filt_wr.toFixed(1)}% | PF ${r.filt_pf.toFixed(2)} | 淨回報 ${r.filt_return >= 0 ? '+' : ''}${r.filt_return.toFixed(4)}%`);
    if (r.passed_trades_detail.length > 0) {
      console.log(`   通過的交易：`);
      for (const d of r.passed_trades_detail) {
        console.log(`     → ${d}`);
      }
    }
    if (Object.keys(r.filter_breakdown).length > 0) {
      const layers = Object.entries(r.filter_breakdown).sort((a, b) => b[1] - a[1]);
      console.log(`   過濾原因：${layers.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    console.log("");
  }

  // 總計
  const totOrigTrades = results.reduce((s, r) => s + r.orig_trades, 0);
  const totOrigWins = results.reduce((s, r) => s + r.orig_wins, 0);
  const totFiltTrades = results.reduce((s, r) => s + r.filt_trades, 0);
  const totFiltWins = results.reduce((s, r) => s + r.filt_wins, 0);
  const totFiltReturn = results.reduce((s, r) => s + r.filt_return, 0);

  const totOrigWR = totOrigTrades > 0 ? (totOrigWins / totOrigTrades) * 100 : 0;
  const totFiltWR = totFiltTrades > 0 ? (totFiltWins / totFiltTrades) * 100 : 0;

  console.log("=".repeat(80));
  console.log("📈 總計");
  console.log(`   原始：${totOrigTrades} 筆 | 勝率 ${totOrigWR.toFixed(1)}%`);
  console.log(`   過濾後：${totFiltTrades} 筆 | 勝率 ${totFiltWR.toFixed(1)}% | 淨回報 ${totFiltReturn >= 0 ? '+' : ''}${totFiltReturn.toFixed(4)}%`);
  console.log(`   過濾率：${totOrigTrades > 0 ? (((totOrigTrades - totFiltTrades) / totOrigTrades) * 100).toFixed(1) : '0'}%`);
  console.log(`   勝率提升：+${(totFiltWR - totOrigWR).toFixed(1)}%`);
  console.log("=".repeat(80));

  // 過濾原因總計
  const allReasons: Record<string, number> = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(r.filter_breakdown)) {
      allReasons[k] = (allReasons[k] ?? 0) + v;
    }
  }
  console.log("\n📋 過濾原因統計（跨策略）：");
  const sortedReasons = Object.entries(allReasons).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sortedReasons) {
    console.log(`   ${reason}: ${count} 筆`);
  }

  // 寫入 JSON
  const outputPath = "/home/ubuntu/runtime/backtest_highwinrate_v2.json";
  const fs = await import("fs/promises");
  await fs.writeFile(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    version: "v2_checklist",
    config: {
      core_checks: 8,
      core_tolerance: 1,
      pa_extra_checks: 3,
      pa_tolerance: 0,
    },
    results,
    summary: {
      original: { trades: totOrigTrades, wins: totOrigWins, win_rate: totOrigWR },
      filtered: { trades: totFiltTrades, wins: totFiltWins, win_rate: totFiltWR, net_return: totFiltReturn },
      filter_rate: totOrigTrades > 0 ? ((totOrigTrades - totFiltTrades) / totOrigTrades) * 100 : 0,
      reason_breakdown: allReasons,
    },
  }, null, 2));
  console.log(`\n結果已寫入 ${outputPath}`);
}

main().catch(console.error);
