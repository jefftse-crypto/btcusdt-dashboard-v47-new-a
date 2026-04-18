/**
 * run_five_strategy_backtest.ts
 * 針對 v4.3 五策略執行完整回測，使用即時 K 線數據
 */
import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy } from "./backtest.js";
import { writeFileSync } from "fs";

interface StrategyConfig {
  key: string;
  label: string;
  family: string;
  strategy: BacktestStrategy;
  tp: number;
  sl: number;
  use_1d: boolean;
  use_15m: boolean;
  enable_mtf_filter: boolean;
  enable_adx_filter: boolean;
  enable_trailing_stop: boolean;
  enable_fee: boolean;
  use_pa_score_filter?: boolean;
  min_signal_score?: number;
}

const STRATEGIES: StrategyConfig[] = [
  {
    key: "pa_v4_focus",
    label: "PA 主力：1D EMA200 + 15m確認",
    family: "pa",
    strategy: "pa",
    tp: 0.5,
    sl: 1.95,
    use_1d: true,
    use_15m: true,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
    use_pa_score_filter: true,
    min_signal_score: 9.0,
  },
  {
    key: "hwr_b_guarded",
    label: "HWR-B：趨勢回踩延續（限流版）",
    family: "trend_pullback",
    strategy: "hwr_model_b",
    tp: 2.0,
    sl: 1.5,
    use_1d: false,
    use_15m: false,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
  },
  {
    key: "cannonball_guarded",
    label: "CannonBall：結構確認（保守版）",
    family: "structure",
    strategy: "cannonball",
    tp: 2.0,
    sl: 1.5,
    use_1d: true,
    use_15m: false,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
  },
  {
    key: "ema_cross_confirm",
    label: "EMA Cross：低頻確認版",
    family: "trend_confirm",
    strategy: "ema_cross",
    tp: 1.5,
    sl: 1.5,
    use_1d: false,
    use_15m: false,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
  },
  {
    key: "vwap_reversion_confirm",
    label: "VWAP Reversion：均值回歸確認版",
    family: "mean_reversion",
    strategy: "vwap_reversion",
    tp: 1.5,
    sl: 1.5,
    use_1d: false,
    use_15m: false,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
  },
];

async function main() {
  console.log("=".repeat(70));
  console.log("  BTCUSDT v4.3 五策略回測（即時 K 線）");
  console.log("=".repeat(70));

  // 抓取 K 線
  console.log("  正在抓取 K 線...");
  const [candles1h, candles4h] = await Promise.all([
    fetchCandles("BTCUSDT", "1h", 500),
    fetchCandles("BTCUSDT", "4h", 500),
  ]);
  console.log(`  1H K 線：${candles1h.length} 根`);
  console.log(`  4H K 線：${candles4h.length} 根`);
  console.log();

  const results: any[] = [];

  for (const strat of STRATEGIES) {
    console.log("-".repeat(70));
    console.log(`📊 ${strat.label} (${strat.key})`);
    console.log(`   Family: ${strat.family} | SL×${strat.sl} / TP×${strat.tp}`);

    try {
      const result = runBacktest({
        candles: candles1h,
        strategy: strat.strategy,
        symbol: "BTCUSDT",
        interval: "1h",
        atr_sl_mult: strat.sl,
        atr_tp_mult: strat.tp,
        enable_mtf_filter: strat.enable_mtf_filter,
        enable_adx_filter: strat.enable_adx_filter,
        enable_trailing_stop: strat.enable_trailing_stop,
        enable_fee: strat.enable_fee,
        candles_4h: candles4h,
      });

      const winRatePct = (result.win_rate * 100).toFixed(2);
      const netReturn = (result.total_return_net * 100).toFixed(2);
      const maxDD = (result.max_drawdown * 100).toFixed(2);

      console.log(`  總交易數：${result.total_trades}`);
      console.log(`  勝率：${winRatePct}%`);
      console.log(`  Profit Factor：${result.profit_factor.toFixed(3)}`);
      console.log(`  最大回撤：${maxDD}%`);
      console.log(`  總回報（net）：${netReturn}%`);
      console.log(`  Sharpe Ratio：${result.sharpe_ratio?.toFixed(3) ?? "N/A"}`);
      console.log(`  Sortino Ratio：${result.sortino_ratio?.toFixed(3) ?? "N/A"}`);
      console.log(`  Calmar Ratio：${result.calmar_ratio?.toFixed(3) ?? "N/A"}`);
      console.log(`  MTF 過濾：${result.mtf_filtered_count ?? 0} 筆`);
      console.log(`  ADX 過濾：${result.adx_filtered_count ?? 0} 筆`);
      console.log(`  最大連勝：${result.max_win_streak ?? 0}`);
      console.log(`  最大連敗：${result.max_loss_streak ?? 0}`);

      // 多空分布
      if (result.trades && result.trades.length > 0) {
        const longTrades = result.trades.filter((t: any) => t.direction === "long");
        const shortTrades = result.trades.filter((t: any) => t.direction === "short");
        const longWins = longTrades.filter((t: any) => t.pnl_net_pct > 0).length;
        const shortWins = shortTrades.filter((t: any) => t.pnl_net_pct > 0).length;
        console.log(`  多單：${longTrades.length} 筆，勝率 ${longTrades.length > 0 ? ((longWins / longTrades.length) * 100).toFixed(1) : 0}%`);
        console.log(`  空單：${shortTrades.length} 筆，勝率 ${shortTrades.length > 0 ? ((shortWins / shortTrades.length) * 100).toFixed(1) : 0}%`);

        // 出場原因
        const reasons: Record<string, number> = {};
        for (const t of result.trades) {
          reasons[t.exit_reason] = (reasons[t.exit_reason] ?? 0) + 1;
        }
        console.log(`  出場原因：${JSON.stringify(reasons)}`);
      }

      results.push({
        key: strat.key,
        label: strat.label,
        family: strat.family,
        total_trades: result.total_trades,
        win_rate: result.win_rate * 100,
        profit_factor: result.profit_factor,
        max_drawdown: result.max_drawdown * 100,
        total_return_net: result.total_return_net * 100,
        sharpe_ratio: result.sharpe_ratio,
        sortino_ratio: result.sortino_ratio,
        calmar_ratio: result.calmar_ratio,
        max_win_streak: result.max_win_streak,
        max_loss_streak: result.max_loss_streak,
        mtf_filtered: result.mtf_filtered_count ?? 0,
        adx_filtered: result.adx_filtered_count ?? 0,
        equity_curve: result.equity_curve,
        monthly_stats: result.monthly_stats,
        long_trades: result.trades?.filter((t: any) => t.direction === "long").length ?? 0,
        short_trades: result.trades?.filter((t: any) => t.direction === "short").length ?? 0,
        long_win_rate: (() => {
          const lt = result.trades?.filter((t: any) => t.direction === "long") ?? [];
          return lt.length > 0 ? (lt.filter((t: any) => t.pnl_net_pct > 0).length / lt.length) * 100 : 0;
        })(),
        short_win_rate: (() => {
          const st = result.trades?.filter((t: any) => t.direction === "short") ?? [];
          return st.length > 0 ? (st.filter((t: any) => t.pnl_net_pct > 0).length / st.length) * 100 : 0;
        })(),
      });

    } catch (err) {
      console.error(`  ❌ 回測失敗：${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
  }

  // 輸出 JSON
  writeFileSync(
    "/home/ubuntu/btcusdt/five_strategy_backtest_results.json",
    JSON.stringify(results, null, 2)
  );
  console.log("✅ 結果已儲存至 /home/ubuntu/btcusdt/five_strategy_backtest_results.json");
}

main().catch(err => {
  console.error("執行失敗：", err);
  process.exit(1);
});
