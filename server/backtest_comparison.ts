/**
 * backtest_comparison.ts — v4.3 vs v4.4 回測對比
 * 
 * 模擬 win_rate_booster 的六大模組對歷史信號的過濾效果，
 * 計算改良前後的勝率、淨回報、Profit Factor 等指標。
 */

import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestResult, type BacktestTrade } from "./backtest.js";
import {
  type StrategySignal,
  calcCrossStrategyConsensus,
  detectMarketRegime,
  checkEntryQuality,
  calcSmartExit,
  getSessionInfo,
  calcVolatilityAdaptive,
} from "./win_rate_booster.js";

// ── 策略配置（與 Live Worker 一致）──
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

// ── 市況 → 家族迴避映射 ──
// v4.4 改良：不再硬性阻擋任何家族，改由 evaluateSignal 內部的評分機制處理市況不利情況
const REGIME_AVOID: Record<string, string[]> = {
  strong_trend: [],
  weak_trend: [],
  ranging: [],
  volatile: [],
  compressed: [],
};

interface ComparisonResult {
  strategy: string;
  family: string;
  v43_trades: number;
  v43_wins: number;
  v43_win_rate: number;
  v43_net_return: number;
  v43_profit_factor: number;
  v44_trades: number;
  v44_wins: number;
  v44_win_rate: number;
  v44_net_return: number;
  v44_profit_factor: number;
  trades_filtered: number;
  win_rate_change: number;
  net_return_change: number;
  filter_reasons: Record<string, number>;
}

// ── 模擬 v4.4 過濾邏輯 ──
function shouldFilterTrade(
  trade: BacktestTrade,
  candles1h: Candle[],
  candles4h: Candle[],
  family: string,
): { filtered: boolean; reason: string } {
  const tradeTime = trade.entry_time;
  const candleIdx = candles1h.findIndex(c => c.time >= tradeTime);
  if (candleIdx < 50) return { filtered: false, reason: "" };

  const candlesUpToTrade = candles1h.slice(0, candleIdx + 1);
  const candles4hUpToTrade = candles4h.filter(c => c.time <= tradeTime);
  if (candles4hUpToTrade.length < 25) return { filtered: false, reason: "" };

  // 1. 市況過濾
  const regime = detectMarketRegime(candlesUpToTrade);
  const avoidFamilies = REGIME_AVOID[regime.regime] ?? [];
  if (avoidFamilies.includes(family)) {
    return { filtered: true, reason: `regime_${regime.regime}` };
  }

  // 2. 進場品質過濾
  const quality = checkEntryQuality(candlesUpToTrade, candles4hUpToTrade, trade.direction, 30);
  if (!quality.pass) {
    return { filtered: true, reason: `quality_${quality.rejection_reason ?? "low_score"}` };
  }

  // 3. 時段過濾（僅在非高品質時段且品質分 < 45 時過濾）
  const session = getSessionInfo(tradeTime * 1000);
  if (!session.is_high_quality && quality.quality_score < 45) {
    return { filtered: true, reason: `session_${session.session}` };
  }

  // 4. 波動率過濾（低波動 + 品質分 < 40 時過濾）
  const vol = calcVolatilityAdaptive(candlesUpToTrade);
  if (vol.is_low_vol && quality.quality_score < 40) {
    return { filtered: true, reason: "low_volatility" };
  }

  return { filtered: false, reason: "" };
}

// ── 主函數 ──
async function main() {
  console.log("=== BTCUSDT v4.3 vs v4.4 回測對比 ===\n");

  // 抓取 K 線
  console.log("正在抓取 K 線數據...");
  const [candles1h, candles4h] = await Promise.all([
    fetchCandles("BTCUSDT", "1h", 1000),
    fetchCandles("BTCUSDT", "4h", 1000),
  ]);
  console.log(`1H: ${candles1h.length} 根 | 4H: ${candles4h.length} 根\n`);

  // 執行回測
  console.log("正在執行回測...\n");
  const results: ComparisonResult[] = [];

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

    // v4.3 原始指標
    const v43_trades = trades.length;
    const v43_wins = trades.filter(t => t.pnl_net_pct > 0).length;
    const v43_win_rate = v43_trades > 0 ? (v43_wins / v43_trades) * 100 : 0;
    const v43_net_return = trades.reduce((sum, t) => sum + t.pnl_net_pct, 0);
    const v43_gross_profit = trades.filter(t => t.pnl_net_pct > 0).reduce((s, t) => s + t.pnl_net_pct, 0);
    const v43_gross_loss = Math.abs(trades.filter(t => t.pnl_net_pct < 0).reduce((s, t) => s + t.pnl_net_pct, 0));
    const v43_profit_factor = v43_gross_loss > 0 ? v43_gross_profit / v43_gross_loss : v43_gross_profit > 0 ? 99 : 0;

    // v4.4 過濾
    const filterReasons: Record<string, number> = {};
    const v44_trades_arr: BacktestTrade[] = [];

    for (const trade of trades) {
      const { filtered, reason } = shouldFilterTrade(trade, candles1h, candles4h, cfg.family);
      if (filtered) {
        filterReasons[reason] = (filterReasons[reason] ?? 0) + 1;
      } else {
        v44_trades_arr.push(trade);
      }
    }

    const v44_trades = v44_trades_arr.length;
    const v44_wins = v44_trades_arr.filter(t => t.pnl_net_pct > 0).length;
    const v44_win_rate = v44_trades > 0 ? (v44_wins / v44_trades) * 100 : 0;
    const v44_net_return = v44_trades_arr.reduce((sum, t) => sum + t.pnl_net_pct, 0);
    const v44_gross_profit = v44_trades_arr.filter(t => t.pnl_net_pct > 0).reduce((s, t) => s + t.pnl_net_pct, 0);
    const v44_gross_loss = Math.abs(v44_trades_arr.filter(t => t.pnl_net_pct < 0).reduce((s, t) => s + t.pnl_net_pct, 0));
    const v44_profit_factor = v44_gross_loss > 0 ? v44_gross_profit / v44_gross_loss : v44_gross_profit > 0 ? 99 : 0;

    results.push({
      strategy: cfg.key,
      family: cfg.family,
      v43_trades, v43_wins, v43_win_rate, v43_net_return, v43_profit_factor,
      v44_trades, v44_wins, v44_win_rate, v44_net_return, v44_profit_factor,
      trades_filtered: v43_trades - v44_trades,
      win_rate_change: v44_win_rate - v43_win_rate,
      net_return_change: v44_net_return - v43_net_return,
      filter_reasons: filterReasons,
    });
  }

  // 輸出結果
  console.log("=".repeat(80));
  console.log("策略對比結果");
  console.log("=".repeat(80));
  console.log("");

  for (const r of results) {
    console.log(`📊 ${r.strategy}（${r.family}）`);
    console.log(`   v4.3：${r.v43_trades} 筆 | 勝率 ${r.v43_win_rate.toFixed(1)}% | 淨回報 ${r.v43_net_return >= 0 ? '+' : ''}${r.v43_net_return.toFixed(2)}% | PF ${r.v43_profit_factor.toFixed(2)}`);
    console.log(`   v4.4：${r.v44_trades} 筆 | 勝率 ${r.v44_win_rate.toFixed(1)}% | 淨回報 ${r.v44_net_return >= 0 ? '+' : ''}${r.v44_net_return.toFixed(2)}% | PF ${r.v44_profit_factor.toFixed(2)}`);
    console.log(`   過濾：${r.trades_filtered} 筆 | 勝率變化 ${r.win_rate_change >= 0 ? '+' : ''}${r.win_rate_change.toFixed(1)}% | 回報變化 ${r.net_return_change >= 0 ? '+' : ''}${r.net_return_change.toFixed(2)}%`);
    if (Object.keys(r.filter_reasons).length > 0) {
      console.log(`   過濾原因：${JSON.stringify(r.filter_reasons)}`);
    }
    console.log("");
  }

  // 總計
  const totalV43Trades = results.reduce((s, r) => s + r.v43_trades, 0);
  const totalV43Wins = results.reduce((s, r) => s + r.v43_wins, 0);
  const totalV43Return = results.reduce((s, r) => s + r.v43_net_return, 0);
  const totalV44Trades = results.reduce((s, r) => s + r.v44_trades, 0);
  const totalV44Wins = results.reduce((s, r) => s + r.v44_wins, 0);
  const totalV44Return = results.reduce((s, r) => s + r.v44_net_return, 0);

  console.log("=".repeat(80));
  console.log("📈 總計");
  console.log(`   v4.3：${totalV43Trades} 筆 | 勝率 ${totalV43Trades > 0 ? ((totalV43Wins / totalV43Trades) * 100).toFixed(1) : '0.0'}% | 淨回報 ${totalV43Return >= 0 ? '+' : ''}${totalV43Return.toFixed(2)}%`);
  console.log(`   v4.4：${totalV44Trades} 筆 | 勝率 ${totalV44Trades > 0 ? ((totalV44Wins / totalV44Trades) * 100).toFixed(1) : '0.0'}% | 淨回報 ${totalV44Return >= 0 ? '+' : ''}${totalV44Return.toFixed(2)}%`);
  console.log(`   過濾：${totalV43Trades - totalV44Trades} 筆 | 勝率變化 ${totalV44Trades > 0 && totalV43Trades > 0 ? (((totalV44Wins / totalV44Trades) - (totalV43Wins / totalV43Trades)) * 100).toFixed(1) : '0.0'}% | 回報變化 ${(totalV44Return - totalV43Return) >= 0 ? '+' : ''}${(totalV44Return - totalV43Return).toFixed(2)}%`);
  console.log("=".repeat(80));

  // 寫入 JSON 結果
  const outputPath = "/home/ubuntu/runtime/backtest_comparison.json";
  const fs = await import("fs/promises");
  await fs.writeFile(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results,
    summary: {
      v43: { trades: totalV43Trades, wins: totalV43Wins, win_rate: totalV43Trades > 0 ? (totalV43Wins / totalV43Trades) * 100 : 0, net_return: totalV43Return },
      v44: { trades: totalV44Trades, wins: totalV44Wins, win_rate: totalV44Trades > 0 ? (totalV44Wins / totalV44Trades) * 100 : 0, net_return: totalV44Return }
    }
  }, null, 2));
  console.log(`\n結果已寫入 ${outputPath}`);
}

main().catch(console.error);
