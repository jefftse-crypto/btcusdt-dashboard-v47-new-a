/**
 * run_backtest_from_json.ts
 * 從本地 JSON 檔案讀取 K 線，執行原版 runBacktest，輸出詳細結果
 */
import { readFileSync } from "fs";
import { runBacktest, type Candle } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS } from "./live_btcusdt_strategy_presets.js";

async function main() {
  console.log("=".repeat(70));
  console.log("  BTCUSDT 終版策略回測（本地 JSON 資料）");
  console.log("=".repeat(70));

  const candles1h: Candle[] = JSON.parse(
    readFileSync("/home/ubuntu/btcusdt_backtest/candles_1h.json", "utf-8")
  );
  const candles4h: Candle[] = JSON.parse(
    readFileSync("/home/ubuntu/btcusdt_backtest/candles_4h.json", "utf-8")
  );

  console.log(`  1H K 線：${candles1h.length} 根`);
  console.log(`  4H K 線：${candles4h.length} 根`);
  console.log();

  const allResults: Record<string, any> = {};

  for (const preset of BTCUSDT_LIVE_PRESETS) {
    console.log("-".repeat(70));
    console.log(`📊 策略：${preset.label}`);
    console.log(`   Key：${preset.key}`);
    console.log(`   SL×${preset.atr_sl_mult} / TP×${preset.atr_tp_mult}`);
    console.log(`   MTF：${preset.enable_mtf_filter} | ADX：${preset.enable_adx_filter} | 移動止損：${preset.enable_trailing_stop}`);
    console.log(`   時段：${preset.pa_session_mode ?? "all"}`);
    console.log();

    try {
      const result = runBacktest({
        candles:              candles1h,
        strategy:             preset.strategy,
        symbol:               preset.symbol,
        interval:             preset.interval,
        atr_sl_mult:          preset.atr_sl_mult,
        atr_tp_mult:          preset.atr_tp_mult,
        enable_mtf_filter:    preset.enable_mtf_filter,
        enable_adx_filter:    preset.enable_adx_filter,
        enable_trailing_stop: preset.enable_trailing_stop,
        enable_fee:           true,
        candles_4h:           candles4h,
      });

      const winRatePct = (result.win_rate * 100).toFixed(2);
      console.log(`  總交易數：${result.total_trades}`);
      console.log(`  勝率：${winRatePct}%`);
      console.log(`  Profit Factor：${result.profit_factor.toFixed(3)}`);
      console.log(`  最大回撤：${(result.max_drawdown * 100).toFixed(2)}%`);
      console.log(`  總回報（net）：${(result.total_return_net * 100).toFixed(2)}%`);
      console.log(`  Sharpe Ratio：${result.sharpe_ratio?.toFixed(3) ?? "N/A"}`);
      console.log(`  MTF 過濾：${result.mtf_filtered_count} 筆`);
      console.log(`  ADX 過濾：${result.adx_filtered_count} 筆`);
      console.log(`  移動止損：${result.trailing_stop_count} 筆`);

      // 月度統計
      if (result.monthly_stats && result.monthly_stats.length > 0) {
        console.log();
        console.log("  月度統計：");
        for (const m of result.monthly_stats) {
          const mWinPct = (m.win_rate * 100).toFixed(1);
          const mPnl = (m.pnl_pct * 100).toFixed(2);
          console.log(`    ${m.month}  交易：${m.trades}  勝率：${mWinPct}%  PnL：${mPnl}%`);
        }
      }

      // 出場原因統計
      if (result.trades && result.trades.length > 0) {
        const reasons: Record<string, number> = {};
        const entryTypes: Record<string, number> = {};
        const directions: Record<string, number> = {};
        for (const t of result.trades) {
          reasons[t.exit_reason] = (reasons[t.exit_reason] ?? 0) + 1;
          entryTypes[t.entry_type ?? "unknown"] = (entryTypes[t.entry_type ?? "unknown"] ?? 0) + 1;
          directions[t.direction] = (directions[t.direction] ?? 0) + 1;
        }
        console.log();
        console.log("  出場原因：", JSON.stringify(reasons));
        console.log("  進場類型：", JSON.stringify(entryTypes));
        console.log("  多空分布：", JSON.stringify(directions));
      }

      // 儲存完整結果
      allResults[preset.key] = {
        preset_key: preset.key,
        label: preset.label,
        total_trades: result.total_trades,
        win_rate: result.win_rate * 100,
        profit_factor: result.profit_factor,
        max_drawdown: result.max_drawdown * 100,
        total_return_net: result.total_return_net * 100,
        sharpe_ratio: result.sharpe_ratio,
        mtf_filtered_count: result.mtf_filtered_count,
        adx_filtered_count: result.adx_filtered_count,
        trailing_stop_count: result.trailing_stop_count,
        equity_curve: result.equity_curve,
        monthly_stats: result.monthly_stats,
        trades: result.trades?.map(t => ({
          direction: t.direction,
          entry_time: t.entry_time,
          exit_time: t.exit_time,
          entry_price: t.entry_price,
          exit_price: t.exit_price,
          sl_price: t.sl_price,
          tp_price: t.tp_price,
          tp2_price: t.tp2_price,
          tp2_hit: t.tp2_hit,
          pnl_pct: t.pnl_pct,
          pnl_net_pct: t.pnl_net_pct,
          exit_reason: t.exit_reason,
          entry_type: t.entry_type,
          signal_score: t.signal_score,
        })),
      };

    } catch (err) {
      console.error(`  ❌ 回測失敗：${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof Error && err.stack) {
        console.error(err.stack.split('\n').slice(0, 5).join('\n'));
      }
    }
    console.log();
  }

  // 輸出 JSON 結果
  const { writeFileSync } = await import("fs");
  writeFileSync(
    "/home/ubuntu/btcusdt_backtest/ts_backtest_results.json",
    JSON.stringify(allResults, null, 2)
  );
  console.log("✅ 結果已儲存至 /home/ubuntu/btcusdt_backtest/ts_backtest_results.json");
}

main().catch(err => {
  console.error("執行失敗：", err);
  process.exit(1);
});
