/**
 * 終版策略回測驗證腳本
 * 驗證兩個策略的勝率是否符合預期：
 *   btcusdt_1h_single_strategy_181 → 81.2%
 *   btcusdt_execution_main_90      → 85.56%
 */

import { fetchCandlesPaged } from "./analysis.js";
import { runBacktest, type Candle } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS } from "./live_btcusdt_strategy_presets.js";

async function main() {
  console.log("=".repeat(60));
  console.log("  BTCUSDT 終版策略回測驗證");
  console.log("=".repeat(60));
  console.log();

  // 取得足夠的歷史 K 線（1H：5000 根 ≈ 7 個月，4H：1500 根）
  console.log("📥 正在下載歷史 K 線資料（較多頁，請稍候）...");
  const [candles1h, candles4h] = await Promise.all([
    fetchCandlesPaged("BTCUSDT", "1h", 5000),
    fetchCandlesPaged("BTCUSDT", "4h", 1500),
  ]);
  console.log(`  1H K 線：${candles1h.length} 根`);
  console.log(`  4H K 線：${candles4h.length} 根`);
  console.log();

  for (const preset of BTCUSDT_LIVE_PRESETS) {
    console.log("-".repeat(60));
    console.log(`📊 策略：${preset.label}`);
    console.log(`   Key：${preset.key}`);
    console.log(`   參數：SL×${preset.atr_sl_mult} / TP×${preset.atr_tp_mult}`);
    console.log(`   MTF：${preset.enable_mtf_filter} | ADX：${preset.enable_adx_filter} | 移動止損：${preset.enable_trailing_stop}`);
    console.log(`   時段：${preset.pa_session_mode ?? "all"}`);
    console.log();

    try {
      const result = runBacktest({
        candles:              candles1h as Candle[],
        strategy:             preset.strategy,
        symbol:               preset.symbol,
        interval:             preset.interval,
        atr_sl_mult:          preset.atr_sl_mult,
        atr_tp_mult:          preset.atr_tp_mult,
        enable_mtf_filter:    preset.enable_mtf_filter,
        enable_adx_filter:    preset.enable_adx_filter,
        enable_trailing_stop: preset.enable_trailing_stop,
        enable_fee:           true,
        candles_4h:           candles4h as Candle[],
      });

      const winRatePct = (result.win_rate * 100).toFixed(2);
      const expectedWinRate = preset.key === "btcusdt_1h_single_strategy_181" ? 81.2 : 85.56;
      const diff = Math.abs(parseFloat(winRatePct) - expectedWinRate);
      const status = diff <= 5 ? "✅ 符合" : diff <= 10 ? "⚠️ 偏差" : "❌ 不符";

      console.log(`  總交易數：${result.total_trades}`);
      console.log(`  勝率：${winRatePct}%  （預期：${expectedWinRate}%）  ${status}`);
      console.log(`  Profit Factor：${result.profit_factor.toFixed(2)}`);
      console.log(`  最大回撤：${(result.max_drawdown * 100).toFixed(2)}%`);
      console.log(`  總回報（含費）：${(result.total_return_net * 100).toFixed(2)}%`);
      console.log(`  Sharpe Ratio：${result.sharpe_ratio?.toFixed(3) ?? "N/A"}`);

      // 最近 5 筆交易
      if (result.trades && result.trades.length > 0) {
        const recent = result.trades.slice(-5);
        console.log();
        console.log("  最近 5 筆交易：");
        for (const t of recent) {
          const entryDate = new Date(t.entry_time).toISOString().slice(0, 16);
          const outcome = t.outcome === "win" ? "✅ 勝" : t.outcome === "loss" ? "❌ 敗" : "➡️ 平";
          const pnl = t.pnl_pct !== undefined ? `${(t.pnl_pct * 100).toFixed(2)}%` : "N/A";
          console.log(`    ${entryDate}  ${t.direction === "long" ? "📈 多" : "📉 空"}  進場：${t.entry_price.toFixed(2)}  ${outcome}  PnL：${pnl}`);
        }
      }

      // 月度統計（若有）
      if (result.monthly_stats && result.monthly_stats.length > 0) {
        console.log();
        console.log("  月度勝率：");
        for (const m of result.monthly_stats.slice(-6)) {
          const mWinPct = (m.win_rate * 100).toFixed(1);
          console.log(`    ${m.month}  交易：${m.trades}  勝率：${mWinPct}%  PnL：${(m.pnl_pct * 100).toFixed(2)}%`);
        }
      }
    } catch (err) {
      console.error(`  ❌ 回測失敗：${err instanceof Error ? err.message : String(err)}`);
    }

    console.log();
  }

  console.log("=".repeat(60));
  console.log("  驗證完成");
  console.log("=".repeat(60));
}

main().catch(err => {
  console.error("執行失敗：", err);
  process.exit(1);
});
