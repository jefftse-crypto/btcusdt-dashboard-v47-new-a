/**
 * 全策略升級潛力掃描
 * 對系統中所有 14 個策略執行：
 *   1. 原始參數回測（使用 runBacktest 預設值）
 *   2. 升級後回測（TP=0.5 + 1D EMA200 過濾）
 * 比較改善幅度，找出升級潛力最大的策略
 */
import fs from "fs/promises";
import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy } from "./backtest.js";

// ── 所有策略定義（含各自最佳 SL 參數）──
const ALL_STRATEGIES: Array<{
  strategy: BacktestStrategy;
  label: string;
  atr_sl_mult: number;
  atr_tp_mult_orig: number;  // 原始 TP
  atr_tp_mult_upg: number;   // 升級後 TP
  enable_mtf_filter: boolean;
  enable_adx_filter: boolean;
  enable_trailing_stop: boolean;
  family: string;
}> = [
  // ── PA 系列（已知最佳參數）──
  { strategy: "pa",            label: "PA 形態（終版 181）",      atr_sl_mult: 1.95, atr_tp_mult_orig: 0.21, atr_tp_mult_upg: 0.5, enable_mtf_filter: true,  enable_adx_filter: true,  enable_trailing_stop: false, family: "pa" },
  // ── SMC 系列 ──
  { strategy: "smc",           label: "SMC 市場結構",             atr_sl_mult: 1.5,  atr_tp_mult_orig: 3.0,  atr_tp_mult_upg: 2.0, enable_mtf_filter: true,  enable_adx_filter: false, enable_trailing_stop: true,  family: "smc" },
  // ── 纏論 ──
  { strategy: "chan",          label: "纏論（Chan Theory）",       atr_sl_mult: 1.5,  atr_tp_mult_orig: 2.0,  atr_tp_mult_upg: 2.0, enable_mtf_filter: true,  enable_adx_filter: false, enable_trailing_stop: false, family: "chan" },
  // ── 傳統技術指標 ──
  { strategy: "ema_cross",     label: "EMA 交叉",                 atr_sl_mult: 1.5,  atr_tp_mult_orig: 3.0,  atr_tp_mult_upg: 2.0, enable_mtf_filter: true,  enable_adx_filter: true,  enable_trailing_stop: true,  family: "classic" },
  { strategy: "rsi_reversal",  label: "RSI 反轉",                 atr_sl_mult: 1.5,  atr_tp_mult_orig: 2.0,  atr_tp_mult_upg: 2.0, enable_mtf_filter: true,  enable_adx_filter: false, enable_trailing_stop: false, family: "classic" },
  { strategy: "bollinger",     label: "布林帶",                   atr_sl_mult: 1.5,  atr_tp_mult_orig: 2.0,  atr_tp_mult_upg: 2.0, enable_mtf_filter: false, enable_adx_filter: false, enable_trailing_stop: false, family: "classic" },
  { strategy: "macd",          label: "MACD",                    atr_sl_mult: 1.5,  atr_tp_mult_orig: 3.0,  atr_tp_mult_upg: 2.0, enable_mtf_filter: true,  enable_adx_filter: true,  enable_trailing_stop: true,  family: "classic" },
  // ── ICT / 流動性 ──
  { strategy: "liquidity_sweep", label: "ICT 流動性掃山",         atr_sl_mult: 1.5,  atr_tp_mult_orig: 3.0,  atr_tp_mult_upg: 2.5, enable_mtf_filter: true,  enable_adx_filter: false, enable_trailing_stop: true,  family: "ict" },
  { strategy: "vwap_reversion", label: "VWAP 偏差回歸",           atr_sl_mult: 1.2,  atr_tp_mult_orig: 2.0,  atr_tp_mult_upg: 1.5, enable_mtf_filter: false, enable_adx_filter: false, enable_trailing_stop: false, family: "ict" },
  // ── 複合策略 ──
  { strategy: "composite",     label: "複合策略（SMC+PA+纏論）",   atr_sl_mult: 1.5,  atr_tp_mult_orig: 3.0,  atr_tp_mult_upg: 2.0, enable_mtf_filter: true,  enable_adx_filter: true,  enable_trailing_stop: true,  family: "composite" },
  { strategy: "cannonball",    label: "CannonBall（結構+OB/FVG）", atr_sl_mult: 1.5,  atr_tp_mult_orig: 3.0,  atr_tp_mult_upg: 2.5, enable_mtf_filter: true,  enable_adx_filter: true,  enable_trailing_stop: true,  family: "composite" },
  // ── HWR 高勝率系列 ──
  { strategy: "hwr_model_a",   label: "HWR-A（掃流動性反轉）",    atr_sl_mult: 1.5,  atr_tp_mult_orig: 3.0,  atr_tp_mult_upg: 2.5, enable_mtf_filter: true,  enable_adx_filter: false, enable_trailing_stop: true,  family: "hwr" },
  { strategy: "hwr_model_b",   label: "HWR-B（趨勢回踩延續）",    atr_sl_mult: 1.5,  atr_tp_mult_orig: 3.0,  atr_tp_mult_upg: 2.5, enable_mtf_filter: true,  enable_adx_filter: false, enable_trailing_stop: true,  family: "hwr" },
  { strategy: "hwr_model_c",   label: "HWR-C（中樞邊界反應）",    atr_sl_mult: 1.5,  atr_tp_mult_orig: 3.0,  atr_tp_mult_upg: 2.5, enable_mtf_filter: true,  enable_adx_filter: false, enable_trailing_stop: true,  family: "hwr" },
];

// ── EMA 計算 ──
function calcEma(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < Math.min(period - 1, values.length); i++) sum += values[i];
  if (values.length >= period) {
    sum += values[period - 1];
    ema[period - 1] = sum / period;
    for (let i = period; i < values.length; i++) {
      ema[i] = values[i] * k + ema[i - 1] * (1 - k);
    }
  }
  return ema;
}

// ── 1D EMA200 過濾 ──
function apply1dEma200Filter(
  trades: any[],
  candles1h: Candle[],
  candles1d: Candle[]
): any[] {
  if (candles1d.length < 50) return trades;
  const closes1d = candles1d.map(c => c.close);
  const period = Math.min(200, closes1d.length);
  const ema200 = calcEma(closes1d, period);

  return trades.filter(trade => {
    // 找到對應的 1D K 線（entry_time 之前最近的 1D 收盤）
    const entryTimeSec = trade.entry_time > 1e10 ? trade.entry_time / 1000 : trade.entry_time;
    let d1Idx = candles1d.findIndex(c => {
      const t = c.time > 1e10 ? c.time / 1000 : c.time;
      return t > entryTimeSec;
    });
    if (d1Idx < 0) d1Idx = candles1d.length - 1;
    else d1Idx = Math.max(0, d1Idx - 1);

    const ema = ema200[d1Idx];
    if (isNaN(ema)) return true; // 無法計算時放行
    const close = candles1d[d1Idx].close;
    const isBullish = close > ema * 1.002;
    const isBearish = close < ema * 0.998;
    if (trade.direction === "long"  && isBearish) return false;
    if (trade.direction === "short" && isBullish) return false;
    return true;
  });
}

// ── 主函數 ──
async function main() {
  console.log("=".repeat(80));
  console.log("  全策略升級潛力掃描（一年回測）");
  console.log("=".repeat(80));

  // 抓取 K 線
  console.log("📥 抓取 K 線資料...");
  const [candles1h, candles4h, candles1d] = await Promise.all([
    fetchCandles("BTCUSDT", "1h",  500) as Promise<Candle[]>,
    fetchCandles("BTCUSDT", "4h",  200) as Promise<Candle[]>,
    fetchCandles("BTCUSDT", "1d",  250) as Promise<Candle[]>,
  ]);
  console.log(`  1H: ${candles1h.length} 根  4H: ${candles4h.length} 根  1D: ${candles1d.length} 根`);
  console.log();

  const results: any[] = [];

  for (const s of ALL_STRATEGIES) {
    console.log(`\n📊 ${s.label}（${s.strategy}）`);

    // ── 原始回測 ──
    let origResult: any = null;
    try {
      origResult = runBacktest({
        candles: candles1h,
        strategy: s.strategy,
        symbol: "BTCUSDT",
        interval: "1h",
        atr_sl_mult: s.atr_sl_mult,
        atr_tp_mult: s.atr_tp_mult_orig,
        enable_mtf_filter: s.enable_mtf_filter,
        enable_adx_filter: s.enable_adx_filter,
        enable_trailing_stop: s.enable_trailing_stop,
        enable_fee: true,
        candles_4h: candles4h,
      });
    } catch (e) {
      console.log(`  ❌ 原始回測失敗：${e}`);
    }

    // ── 升級後回測（TP 調整）──
    let upgResult: any = null;
    try {
      upgResult = runBacktest({
        candles: candles1h,
        strategy: s.strategy,
        symbol: "BTCUSDT",
        interval: "1h",
        atr_sl_mult: s.atr_sl_mult,
        atr_tp_mult: s.atr_tp_mult_upg,
        enable_mtf_filter: s.enable_mtf_filter,
        enable_adx_filter: s.enable_adx_filter,
        enable_trailing_stop: s.enable_trailing_stop,
        enable_fee: true,
        candles_4h: candles4h,
      });
    } catch (e) {
      console.log(`  ❌ 升級後回測失敗：${e}`);
    }

    // ── 升級後 + 1D EMA200 過濾 ──
    let upgWith1dResult: any = null;
    if (upgResult && upgResult.trades) {
      const filtered1dTrades = apply1dEma200Filter(upgResult.trades, candles1h, candles1d);
      // 重新計算統計
      const wins = filtered1dTrades.filter((t: any) => t.pnl_net_pct > 0).length;
      const losses = filtered1dTrades.filter((t: any) => t.pnl_net_pct <= 0).length;
      const winRate = filtered1dTrades.length > 0 ? (wins / filtered1dTrades.length) * 100 : 0;
      const totalPnl = filtered1dTrades.reduce((sum: number, t: any) => sum + (t.pnl_net_pct ?? 0), 0);
      const grossProfit = filtered1dTrades.filter((t: any) => t.pnl_net_pct > 0).reduce((s: number, t: any) => s + t.pnl_net_pct, 0);
      const grossLoss   = Math.abs(filtered1dTrades.filter((t: any) => t.pnl_net_pct <= 0).reduce((s: number, t: any) => s + t.pnl_net_pct, 0));
      const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
      // Equity curve & max drawdown
      let equity = 1.0;
      let peak = 1.0;
      let maxDd = 0;
      const eqCurve: number[] = [1.0];
      for (const t of filtered1dTrades) {
        equity *= (1 + (t.pnl_net_pct ?? 0) / 100);
        if (equity > peak) peak = equity;
        const dd = (peak - equity) / peak;
        if (dd > maxDd) maxDd = dd;
        eqCurve.push(equity);
      }
      const totalReturnNet = (equity - 1) * 100;
      // Sharpe
      const returns = filtered1dTrades.map((t: any) => t.pnl_net_pct ?? 0);
      const mean = returns.length > 0 ? returns.reduce((a: number, b: number) => a + b, 0) / returns.length : 0;
      const variance = returns.length > 1 ? returns.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1) : 0;
      const std = Math.sqrt(variance);
      const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

      upgWith1dResult = {
        total_trades: filtered1dTrades.length,
        win_rate: winRate,
        profit_factor: pf,
        max_drawdown: maxDd * 100,
        total_return_net: totalReturnNet,
        sharpe_ratio: sharpe,
        equity_curve: eqCurve,
        trades: filtered1dTrades,
      };
    }

    const origRet  = origResult  ? (origResult.total_return_net  * 100).toFixed(2) : "N/A";
    const upgRet   = upgResult   ? (upgResult.total_return_net   * 100).toFixed(2) : "N/A";
    const upg1dRet = upgWith1dResult ? upgWith1dResult.total_return_net.toFixed(2) : "N/A";

    console.log(`  原始：${origRet}%  |  升級TP：${upgRet}%  |  升級TP+1D：${upg1dRet}%`);
    if (origResult)  console.log(`    原始：勝率${origResult.win_rate.toFixed(1)}%  PF=${origResult.profit_factor.toFixed(3)}  回撤=${(origResult.max_drawdown*100).toFixed(1)}%  交易=${origResult.total_trades}`);
    if (upgWith1dResult) console.log(`    升級：勝率${upgWith1dResult.win_rate.toFixed(1)}%  PF=${upgWith1dResult.profit_factor.toFixed(3)}  回撤=${upgWith1dResult.max_drawdown.toFixed(1)}%  交易=${upgWith1dResult.total_trades}`);

    results.push({
      strategy: s.strategy,
      label: s.label,
      family: s.family,
      atr_sl_mult: s.atr_sl_mult,
      atr_tp_orig: s.atr_tp_mult_orig,
      atr_tp_upg: s.atr_tp_mult_upg,
      orig: origResult ? {
        trades: origResult.total_trades,
        win_rate: origResult.win_rate,
        pf: origResult.profit_factor,
        drawdown: origResult.max_drawdown * 100,
        return: origResult.total_return_net * 100,
        sharpe: origResult.sharpe_ratio ?? 0,
        equity_curve: origResult.equity_curve,
      } : null,
      upg_tp: upgResult ? {
        trades: upgResult.total_trades,
        win_rate: upgResult.win_rate,
        pf: upgResult.profit_factor,
        drawdown: upgResult.max_drawdown * 100,
        return: upgResult.total_return_net * 100,
        sharpe: upgResult.sharpe_ratio ?? 0,
        equity_curve: upgResult.equity_curve,
      } : null,
      upg_tp_1d: upgWith1dResult ? {
        trades: upgWith1dResult.total_trades,
        win_rate: upgWith1dResult.win_rate,
        pf: upgWith1dResult.profit_factor,
        drawdown: upgWith1dResult.max_drawdown,
        return: upgWith1dResult.total_return_net,
        sharpe: upgWith1dResult.sharpe_ratio,
        equity_curve: upgWith1dResult.equity_curve,
      } : null,
    });
  }

  await fs.writeFile(
    "/home/ubuntu/btcusdt_backtest/all_strategy_upgrade_results.json",
    JSON.stringify(results, null, 2)
  );
  console.log("\n✅ 結果已儲存至 all_strategy_upgrade_results.json");

  // ── 排名輸出 ──
  console.log("\n" + "=".repeat(80));
  console.log("  升級後（TP + 1D EMA200）排名（按報酬）");
  console.log("=".repeat(80));
  const ranked = results
    .filter(r => r.upg_tp_1d !== null)
    .sort((a, b) => b.upg_tp_1d.return - a.upg_tp_1d.return);
  console.log(`  ${'策略'.padEnd(28)} ${'原始報酬'.padStart(10)} ${'升級報酬'.padStart(10)} ${'改善'.padStart(8)} ${'PF'.padStart(7)} ${'回撤'.padStart(8)} ${'交易'.padStart(6)}`);
  console.log("  " + "-".repeat(80));
  for (const r of ranked) {
    const orig = r.orig?.return ?? 0;
    const upg  = r.upg_tp_1d?.return ?? 0;
    const diff = upg - orig;
    const mark = upg > 0 ? "✅" : "❌";
    console.log(
      `  ${mark} ${r.label.padEnd(26)} ${orig.toFixed(2).padStart(9)}%  ${upg.toFixed(2).padStart(9)}%  ${(diff >= 0 ? "+" : "") + diff.toFixed(2).padStart(7)}%  ${r.upg_tp_1d.pf.toFixed(3).padStart(6)}  -${r.upg_tp_1d.drawdown.toFixed(1).padStart(6)}%  ${String(r.upg_tp_1d.trades).padStart(5)}`
    );
  }
}

main().catch(console.error);
