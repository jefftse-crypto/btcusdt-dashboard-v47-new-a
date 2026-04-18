/**
 * 終版策略回測驗證腳本 v2
 * 直接呼叫 runBacktest，使用 fetchCandlesPaged 取得最多可用的歷史資料
 * 並與預期勝率（81.2% / 85.56%）對比
 */

import { fetchCandlesPaged, fetchCandles } from "./analysis.js";
import { runBacktest, type Candle } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS } from "./live_btcusdt_strategy_presets.js";

async function main() {
  console.log("=".repeat(70));
  console.log("  BTCUSDT 終版策略回測驗證 v2");
  console.log("=".repeat(70));
  console.log();

  // 先確認 Kraken 實際能提供多少 1H K 線
  console.log("📥 正在下載最多可用的歷史 K 線...");
  const candles1h = await fetchCandlesPaged("BTCUSDT", "1h", 8760);
  const candles4h = await fetchCandles("BTCUSDT", "4H", 500);

  const firstDate = candles1h.length > 0
    ? new Date(candles1h[0].time * 1000).toISOString().slice(0, 10)
    : "N/A";
  const lastDate = candles1h.length > 0
    ? new Date(candles1h[candles1h.length - 1].time * 1000).toISOString().slice(0, 10)
    : "N/A";

  console.log(`  1H K 線：${candles1h.length} 根  (${firstDate} ~ ${lastDate})`);
  console.log(`  4H K 線：${candles4h.length} 根`);
  console.log();

  const results: Array<{
    key: string;
    label: string;
    expected_win_rate: number;
    actual_win_rate: number;
    total_trades: number;
    profit_factor: number;
    max_drawdown: number;
    total_return_net: number;
    status: string;
  }> = [];

  for (const preset of BTCUSDT_LIVE_PRESETS) {
    const expectedWinRate = preset.key === "btcusdt_1h_single_strategy_181" ? 81.2 : 85.56;

    console.log("-".repeat(70));
    console.log(`📊 ${preset.label}`);
    console.log(`   Key：${preset.key}`);
    console.log(`   SL×${preset.atr_sl_mult} / TP×${preset.atr_tp_mult}  |  MTF:${preset.enable_mtf_filter}  ADX:${preset.enable_adx_filter}  TrailingStop:${preset.enable_trailing_stop}`);
    console.log(`   時段過濾：${preset.pa_session_mode ?? "all"}`);
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

      const winRatePct = parseFloat((result.win_rate * 100).toFixed(2));
      const diff = Math.abs(winRatePct - expectedWinRate);
      const status = diff <= 3 ? "✅ 完全符合" : diff <= 8 ? "⚠️ 輕微偏差" : diff <= 15 ? "⚠️ 偏差較大" : "❌ 不符";

      console.log(`  📈 總交易數：${result.total_trades}  （預期：${preset.key === "btcusdt_1h_single_strategy_181" ? "181" : "90"} 筆）`);
      console.log(`  🎯 勝率：${winRatePct}%  （預期：${expectedWinRate}%）  ${status}`);
      console.log(`  📊 Profit Factor：${result.profit_factor.toFixed(2)}  （預期：${preset.key === "btcusdt_1h_single_strategy_181" ? "1.28" : "N/A"}）`);
      console.log(`  📉 最大回撤：${(result.max_drawdown * 100).toFixed(2)}%`);
      console.log(`  💰 總回報（含費）：${(result.total_return_net * 100).toFixed(2)}%`);
      console.log(`  📐 Sharpe Ratio：${result.sharpe_ratio?.toFixed(3) ?? "N/A"}`);

      // 月度統計
      if (result.monthly_stats && result.monthly_stats.length > 0) {
        console.log();
        console.log("  月度統計：");
        for (const m of result.monthly_stats) {
          const mWinPct = (m.win_rate * 100).toFixed(1);
          const pnlStr = (m.pnl_pct * 100).toFixed(2);
          const bar = m.wins > 0 ? "█".repeat(Math.min(m.wins, 10)) : "";
          console.log(`    ${m.month}  交易:${String(m.trades).padStart(3)}  勝:${String(m.wins).padStart(3)}  勝率:${mWinPct.padStart(6)}%  PnL:${pnlStr.padStart(7)}%  ${bar}`);
        }
      }

      results.push({
        key: preset.key,
        label: preset.label,
        expected_win_rate: expectedWinRate,
        actual_win_rate: winRatePct,
        total_trades: result.total_trades,
        profit_factor: result.profit_factor,
        max_drawdown: result.max_drawdown,
        total_return_net: result.total_return_net,
        status,
      });
    } catch (err) {
      console.error(`  ❌ 回測失敗：${err instanceof Error ? err.message : String(err)}`);
    }

    console.log();
  }

  // 總結
  console.log("=".repeat(70));
  console.log("  回測驗證總結");
  console.log("=".repeat(70));
  console.log();
  console.log(`  資料範圍：${firstDate} ~ ${lastDate}（${candles1h.length} 根 1H K 線）`);
  console.log();
  for (const r of results) {
    const diff = (r.actual_win_rate - r.expected_win_rate).toFixed(2);
    const diffStr = parseFloat(diff) >= 0 ? `+${diff}%` : `${diff}%`;
    console.log(`  ${r.status}  ${r.label}`);
    console.log(`    勝率：${r.actual_win_rate}%  vs 預期 ${r.expected_win_rate}%  差異：${diffStr}`);
    console.log(`    交易數：${r.total_trades}  |  PF：${r.profit_factor.toFixed(2)}  |  回報：${(r.total_return_net * 100).toFixed(2)}%`);
    console.log();
  }

  // 說明資料範圍限制
  if (candles1h.length < 1000) {
    console.log("  ⚠️  注意：Kraken 免費 API 最多只能回傳約 720 根 1H K 線（約 30 天）");
    console.log("  ⚠️  原始回測（181/90 筆交易）是在更長的歷史資料（數個月至一年）上執行的");
    console.log("  ⚠️  目前 30 天樣本數較少，勝率可能因市場狀況而有所偏差");
    console.log("  ⚠️  建議：在 Dashboard BacktestPanel 中手動執行，可選擇更長的時間範圍");
  }
}

main().catch(err => {
  console.error("執行失敗：", err);
  process.exit(1);
});
