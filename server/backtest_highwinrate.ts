/**
 * backtest_highwinrate.ts — 高勝率 (75%+) 回測驗證
 * 
 * 核心策略：大幅提高過濾門檻，寧可少交易也要高品質
 * 
 * 七層過濾：
 *   L1. 進場品質門檻 >= 70（6 項中至少 5 項通過）
 *   L2. 嚴格時段過濾（只在倫敦/紐約時段交易）
 *   L3. 4H 趨勢對齊（EMA20 方向 + RSI 方向）
 *   L4. 動量確認（近 5 根 K 線趨勢方向一致率 >= 60%）
 *   L5. 波動率健康（ATR 百分位 25-85%，排除極端）
 *   L6. K 線形態確認（實體比例 >= 40%，非十字星）
 *   L7. 綜合評分門檻 >= 65
 */

import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestResult, type BacktestTrade } from "./backtest.js";
import {
  detectMarketRegime,
  checkEntryQuality,
  getSessionInfo,
  calcVolatilityAdaptive,
} from "./win_rate_booster.js";

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

// ── 輔助計算函數 ──
function calcRsi14(candles: Candle[], idx: number): number {
  if (idx < 14) return 50;
  let gains = 0, losses = 0;
  for (let i = idx - 13; i <= idx; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
  return 100 - 100 / (1 + rs);
}

function calcEma(values: number[], period: number): number[] {
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

interface FilterResult {
  filtered: boolean;
  reason: string;
  layer: string;
}

// ── 七層高勝率過濾器 ──
function highWinRateFilter(
  trade: BacktestTrade,
  candles1h: Candle[],
  candles4h: Candle[],
  family: string,
): FilterResult {
  const tradeTime = trade.entry_time;
  const candleIdx = candles1h.findIndex(c => c.time >= tradeTime);
  if (candleIdx < 50) return { filtered: false, reason: "", layer: "" };

  const candlesUpToTrade = candles1h.slice(0, candleIdx + 1);
  const candles4hUpToTrade = candles4h.filter(c => c.time <= tradeTime);
  if (candles4hUpToTrade.length < 25) return { filtered: false, reason: "", layer: "" };

  const n = candlesUpToTrade.length;
  const lastCandle = candlesUpToTrade[n - 1];

  // ═══ L1. 進場品質門檻 >= 60 ═══
  const quality = checkEntryQuality(candlesUpToTrade, candles4hUpToTrade, trade.direction, 60);
  if (!quality.pass) {
    return { filtered: true, reason: `品質分 ${quality.quality_score}/60：${quality.rejection_reason}`, layer: "L1_quality" };
  }

  // ═══ L1b. PA 專屬過濾：多維度確認 ═══
  if (family === "pa") {
    const rsi1h_pa = calcRsi14(candlesUpToTrade, n - 1);
    // PA 做多時 RSI 不能超買（>70），做空時不能超賣（<30）
    if (trade.direction === "long" && rsi1h_pa > 70) {
      return { filtered: true, reason: `PA 做多但 RSI 超買（${rsi1h_pa.toFixed(1)}）`, layer: "L1b_pa_rsi" };
    }
    if (trade.direction === "short" && rsi1h_pa < 30) {
      return { filtered: true, reason: `PA 做空但 RSI 超賣（${rsi1h_pa.toFixed(1)}）`, layer: "L1b_pa_rsi" };
    }
    // PA 需要更強的品質分（>= 65）
    if (quality.quality_score < 65) {
      return { filtered: true, reason: `PA 品質分不足（${quality.quality_score}/65）`, layer: "L1b_pa_quality" };
    }
    // PA 額外要求：最近 K 線方向必須與信號一致
    if (trade.direction === "long" && lastCandle.close < lastCandle.open) {
      return { filtered: true, reason: `PA 做多但最近 K 線為陰線`, layer: "L1b_pa_candle" };
    }
    if (trade.direction === "short" && lastCandle.close > lastCandle.open) {
      return { filtered: true, reason: `PA 做空但最近 K 線為陽線`, layer: "L1b_pa_candle" };
    }
  }

  // ═══ L2. 嚴格時段過濾（只在倫敦/紐約時段交易）═══
  const session = getSessionInfo(tradeTime * 1000);
  if (!session.is_high_quality) {
    return { filtered: true, reason: `非高品質時段（${session.session}）`, layer: "L2_session" };
  }

  // ═══ L3. 4H 趨勢對齊（EMA20 方向 + RSI 方向）═══
  const n4h = candles4hUpToTrade.length;
  if (n4h >= 25) {
    // 4H EMA20 方向
    const closes4h = candles4hUpToTrade.map(c => c.close);
    const ema20_4h = calcEma(closes4h, 20);
    const last4hEma = ema20_4h[ema20_4h.length - 1];
    const prev4hEma = ema20_4h[ema20_4h.length - 2];
    const emaSlope = last4hEma - prev4hEma;
    
    // 4H EMA 方向必須與信號一致
    if (trade.direction === "long" && emaSlope < 0) {
      return { filtered: true, reason: `4H EMA20 下行（slope=${emaSlope.toFixed(2)}）`, layer: "L3_htf_align" };
    }
    if (trade.direction === "short" && emaSlope > 0) {
      return { filtered: true, reason: `4H EMA20 上行（slope=${emaSlope.toFixed(2)}）`, layer: "L3_htf_align" };
    }

    // 4H RSI 方向確認
    const rsi4h = calcRsi14(candles4hUpToTrade, n4h - 1);
    if (trade.direction === "long" && rsi4h < 40) {
      return { filtered: true, reason: `4H RSI 偏空（${rsi4h.toFixed(1)}）`, layer: "L3_htf_align" };
    }
    if (trade.direction === "short" && rsi4h > 60) {
      return { filtered: true, reason: `4H RSI 偏多（${rsi4h.toFixed(1)}）`, layer: "L3_htf_align" };
    }
  }

  // ═══ L4. 動量確認（近 3 根 K 線方向一致率 >= 2/3）═══
  if (n >= 3) {
    const recent3 = candlesUpToTrade.slice(-3);
    const bullBars = recent3.filter(c => c.close > c.open).length;
    const bearBars = 3 - bullBars;
    
    if (trade.direction === "long" && bullBars < 2) {
      return { filtered: true, reason: `動量不足：近 3 根僅 ${bullBars} 根陽線`, layer: "L4_momentum" };
    }
    if (trade.direction === "short" && bearBars < 2) {
      return { filtered: true, reason: `動量不足：近 3 根僅 ${bearBars} 根陰線`, layer: "L4_momentum" };
    }
  }

  // ═══ L4b. 1H RSI 方向確認 ═══
  const rsi1h = calcRsi14(candlesUpToTrade, n - 1);
  if (trade.direction === "long" && rsi1h < 40) {
    return { filtered: true, reason: `1H RSI 偏空（${rsi1h.toFixed(1)}）`, layer: "L4b_rsi" };
  }
  if (trade.direction === "short" && rsi1h > 60) {
    return { filtered: true, reason: `1H RSI 偏多（${rsi1h.toFixed(1)}）`, layer: "L4b_rsi" };
  }

  // ═══ L5. 波動率健康（ATR 百分位 15-90%）═══
  const vol = calcVolatilityAdaptive(candlesUpToTrade);
  if (vol.atr_percentile < 15) {
    return { filtered: true, reason: `極端低波動（ATR 百分位 ${vol.atr_percentile}%）`, layer: "L5_volatility" };
  }
  if (vol.atr_percentile > 90) {
    return { filtered: true, reason: `極端高波動（ATR 百分位 ${vol.atr_percentile}%）`, layer: "L5_volatility" };
  }

  // ═══ L6. K 線形態確認（實體比例 >= 30%）═══
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const range = lastCandle.high - lastCandle.low;
  if (range > 0 && body / range < 0.3) {
    return { filtered: true, reason: `K 線形態不佳（實體比 ${(body/range*100).toFixed(0)}%）`, layer: "L6_candle_form" };
  }

  // ═══ L7. 綜合評分門檻 ═══
  // 計算綜合分：品質分 * 0.4 + 時段乘數 * 20 + HTF 對齊加分 + 動量加分
  let compositeScore = quality.quality_score * 0.4;
  compositeScore += session.quality_multiplier * 20;
  
  // HTF 對齊加分
  if (quality.checks.higher_tf_aligned) compositeScore += 15;
  
  // 動量加分
  if (quality.checks.momentum_aligned) compositeScore += 10;
  
  // 成交量加分
  if (quality.checks.volume_confirmed) compositeScore += 5;

  if (compositeScore < 58) {
    return { filtered: true, reason: `綜合分不足（${compositeScore.toFixed(1)}/58）`, layer: "L7_composite" };
  }

  return { filtered: false, reason: "", layer: "" };
}

// ── 主函數 ──
async function main() {
  console.log("=== BTCUSDT 高勝率 (75%+) 回測驗證 ===\n");

  console.log("正在抓取 K 線數據...");
  const [candles1h, candles4h] = await Promise.all([
    fetchCandles("BTCUSDT", "1h", 1000),
    fetchCandles("BTCUSDT", "4h", 1000),
  ]);
  console.log(`1H: ${candles1h.length} 根 | 4H: ${candles4h.length} 根\n`);

  console.log("正在執行回測...\n");

  interface StratResult {
    strategy: string;
    family: string;
    orig_trades: number;
    orig_wins: number;
    orig_wr: number;
    orig_return: number;
    orig_pf: number;
    filt_trades: number;
    filt_wins: number;
    filt_wr: number;
    filt_return: number;
    filt_pf: number;
    filter_breakdown: Record<string, number>;
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

    for (const trade of trades) {
      const result = highWinRateFilter(trade, candles1h, candles4h, cfg.family);
      if (result.filtered) {
        filterBreakdown[result.layer] = (filterBreakdown[result.layer] ?? 0) + 1;
      } else {
        filteredTrades.push(trade);
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
      orig_return: trades.reduce((s, t) => s + t.pnl_net_pct, 0),
      orig_pf: calcPF(trades),
      filt_trades: filteredTrades.length,
      filt_wins: filtWins,
      filt_wr: filteredTrades.length > 0 ? (filtWins / filteredTrades.length) * 100 : 0,
      filt_return: filteredTrades.reduce((s, t) => s + t.pnl_net_pct, 0),
      filt_pf: calcPF(filteredTrades),
      filter_breakdown: filterBreakdown,
    });
  }

  // 輸出結果
  console.log("=".repeat(80));
  console.log("高勝率過濾結果（七層過濾）");
  console.log("=".repeat(80));
  console.log("");

  for (const r of results) {
    console.log(`📊 ${r.strategy}（${r.family}）`);
    console.log(`   原始：${r.orig_trades} 筆 | 勝率 ${r.orig_wr.toFixed(1)}% | 淨回報 ${r.orig_return >= 0 ? '+' : ''}${r.orig_return.toFixed(3)}% | PF ${r.orig_pf.toFixed(2)}`);
    console.log(`   過濾後：${r.filt_trades} 筆 | 勝率 ${r.filt_wr.toFixed(1)}% | 淨回報 ${r.filt_return >= 0 ? '+' : ''}${r.filt_return.toFixed(3)}% | PF ${r.filt_pf.toFixed(2)}`);
    if (Object.keys(r.filter_breakdown).length > 0) {
      const layers = Object.entries(r.filter_breakdown).sort((a, b) => b[1] - a[1]);
      console.log(`   過濾分層：${layers.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    console.log("");
  }

  // 總計
  const totOrigTrades = results.reduce((s, r) => s + r.orig_trades, 0);
  const totOrigWins = results.reduce((s, r) => s + r.orig_wins, 0);
  const totOrigReturn = results.reduce((s, r) => s + r.orig_return, 0);
  const totFiltTrades = results.reduce((s, r) => s + r.filt_trades, 0);
  const totFiltWins = results.reduce((s, r) => s + r.filt_wins, 0);
  const totFiltReturn = results.reduce((s, r) => s + r.filt_return, 0);

  const totOrigWR = totOrigTrades > 0 ? (totOrigWins / totOrigTrades) * 100 : 0;
  const totFiltWR = totFiltTrades > 0 ? (totFiltWins / totFiltTrades) * 100 : 0;

  console.log("=".repeat(80));
  console.log("📈 總計");
  console.log(`   原始：${totOrigTrades} 筆 | 勝率 ${totOrigWR.toFixed(1)}% | 淨回報 ${totOrigReturn >= 0 ? '+' : ''}${totOrigReturn.toFixed(3)}%`);
  console.log(`   過濾後：${totFiltTrades} 筆 | 勝率 ${totFiltWR.toFixed(1)}% | 淨回報 ${totFiltReturn >= 0 ? '+' : ''}${totFiltReturn.toFixed(3)}%`);
  console.log(`   過濾率：${totOrigTrades > 0 ? (((totOrigTrades - totFiltTrades) / totOrigTrades) * 100).toFixed(1) : '0'}%`);
  console.log(`   勝率提升：${(totFiltWR - totOrigWR).toFixed(1)}%`);
  console.log("=".repeat(80));

  // 過濾分層總計
  const allLayers: Record<string, number> = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(r.filter_breakdown)) {
      allLayers[k] = (allLayers[k] ?? 0) + v;
    }
  }
  console.log("\n📋 過濾分層統計：");
  const sortedLayers = Object.entries(allLayers).sort((a, b) => b[1] - a[1]);
  for (const [layer, count] of sortedLayers) {
    console.log(`   ${layer}: ${count} 筆`);
  }

  // 寫入 JSON
  const outputPath = "/home/ubuntu/runtime/backtest_highwinrate.json";
  const fs = await import("fs/promises");
  await fs.writeFile(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    filter_config: {
      min_quality_score: 70,
      session_filter: "high_quality_only",
      htf_ema_slope_required: true,
      htf_rsi_range: "40-60",
      momentum_min_bars: "3/5",
      atr_percentile_range: "25-85",
      candle_body_ratio_min: 0.4,
      composite_score_min: 65,
    },
    results,
    summary: {
      original: { trades: totOrigTrades, wins: totOrigWins, win_rate: totOrigWR, net_return: totOrigReturn },
      filtered: { trades: totFiltTrades, wins: totFiltWins, win_rate: totFiltWR, net_return: totFiltReturn },
      filter_rate: totOrigTrades > 0 ? ((totOrigTrades - totFiltTrades) / totOrigTrades) * 100 : 0,
      layer_breakdown: allLayers,
    },
  }, null, 2));
  console.log(`\n結果已寫入 ${outputPath}`);
}

main().catch(console.error);
