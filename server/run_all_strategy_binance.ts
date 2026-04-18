/**
 * 全策略升級潛力掃描（使用 Binance 一年 K 線資料）
 * 對系統中所有策略執行：原始 vs 升級後（TP 調整 + 1D EMA200）
 */
import fs from "fs/promises";
import { runBacktest, type BacktestStrategy, type Candle } from "./backtest.js";

// ── 讀取 Binance K 線 JSON ──
async function loadCandles(path: string): Promise<Candle[]> {
  const raw = JSON.parse(await fs.readFile(path, "utf-8")) as Array<{
    time: number; open: number; high: number; low: number; close: number; volume: number;
  }>;
  return raw.map(c => ({
    time:   c.time > 1e12 ? c.time / 1000 : c.time,
    open:   c.open,
    high:   c.high,
    low:    c.low,
    close:  c.close,
    volume: c.volume,
  }));
}

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

// ── 1D EMA200 後過濾 ──
function apply1dEma200Filter(trades: any[], candles1d: Candle[]): any[] {
  if (candles1d.length < 50) return trades;
  const closes1d = candles1d.map(c => c.close);
  const period = Math.min(200, closes1d.length);
  const ema200 = calcEma(closes1d, period);
  return trades.filter(trade => {
    const entryTimeSec = trade.entry_time > 1e10 ? trade.entry_time / 1000 : trade.entry_time;
    let d1Idx = candles1d.findIndex(c => c.time > entryTimeSec);
    if (d1Idx < 0) d1Idx = candles1d.length - 1;
    else d1Idx = Math.max(0, d1Idx - 1);
    const ema = ema200[d1Idx];
    if (isNaN(ema)) return true;
    const close = candles1d[d1Idx].close;
    if (trade.direction === "long"  && close < ema * 0.998) return false;
    if (trade.direction === "short" && close > ema * 1.002) return false;
    return true;
  });
}

// ── 計算統計 ──
function calcStats(trades: any[]) {
  if (trades.length === 0) return { trades: 0, win_rate: 0, pf: 0, drawdown: 0, return: 0, sharpe: 0, equity_curve: [1], monthly: [] };
  // pnl_net_pct 是小數（如 -0.0078 = -0.78%）
  const wins = trades.filter((t: any) => t.pnl_net_pct > 0).length;
  const winRate = (wins / trades.length) * 100;
  const grossProfit = trades.filter((t: any) => t.pnl_net_pct > 0).reduce((s: number, t: any) => s + t.pnl_net_pct, 0);
  const grossLoss   = Math.abs(trades.filter((t: any) => t.pnl_net_pct <= 0).reduce((s: number, t: any) => s + t.pnl_net_pct, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  let equity = 1.0, peak = 1.0, maxDd = 0;
  const eqCurve: number[] = [1.0];
  for (const t of trades) {
    equity *= (1 + (t.pnl_net_pct ?? 0));  // pnl_net_pct 已是小數
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
    eqCurve.push(equity);
  }
  const totalReturn = (equity - 1) * 100;
  const returns = trades.map((t: any) => (t.pnl_net_pct ?? 0) * 100);  // 轉為百分比計算 Sharpe
  const mean = returns.reduce((a: number, b: number) => a + b, 0) / returns.length;
  const variance = returns.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / Math.max(1, returns.length - 1);
  const sharpe = Math.sqrt(variance) > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  // Monthly
  const monthlyMap = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const t of trades) {
    const d = new Date((t.entry_time > 1e10 ? t.entry_time : t.entry_time * 1000));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = monthlyMap.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
    m.trades++;
    if (t.pnl_net_pct > 0) m.wins++;
    m.pnl += t.pnl_net_pct ?? 0;
    monthlyMap.set(key, m);
  }
  const monthly = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({ month, trades: m.trades, win_rate: m.trades > 0 ? m.wins / m.trades * 100 : 0, pnl: m.pnl }));
  return { trades: trades.length, win_rate: winRate, pf, drawdown: maxDd * 100, return: totalReturn, sharpe, equity_curve: eqCurve, monthly };
}

// ── 策略定義 ──
const ALL_STRATEGIES: Array<{
  strategy: BacktestStrategy; label: string; family: string;
  atr_sl_mult: number; atr_tp_orig: number; atr_tp_upg: number;
  enable_mtf: boolean; enable_adx: boolean; enable_trailing: boolean;
}> = [
  { strategy: "pa",              label: "PA 形態（終版 181）",      family: "pa",        atr_sl_mult: 1.95, atr_tp_orig: 0.21, atr_tp_upg: 0.5,  enable_mtf: true,  enable_adx: true,  enable_trailing: false },
  { strategy: "smc",             label: "SMC 市場結構",             family: "smc",       atr_sl_mult: 1.5,  atr_tp_orig: 3.0,  atr_tp_upg: 2.0,  enable_mtf: true,  enable_adx: false, enable_trailing: true  },
  { strategy: "chan",             label: "纏論",                    family: "chan",       atr_sl_mult: 1.5,  atr_tp_orig: 2.0,  atr_tp_upg: 2.0,  enable_mtf: true,  enable_adx: false, enable_trailing: false },
  { strategy: "ema_cross",       label: "EMA 交叉",                family: "classic",   atr_sl_mult: 1.5,  atr_tp_orig: 3.0,  atr_tp_upg: 2.0,  enable_mtf: true,  enable_adx: true,  enable_trailing: true  },
  { strategy: "rsi_reversal",    label: "RSI 反轉",                family: "classic",   atr_sl_mult: 1.5,  atr_tp_orig: 2.0,  atr_tp_upg: 2.0,  enable_mtf: true,  enable_adx: false, enable_trailing: false },
  { strategy: "bollinger",       label: "布林帶",                  family: "classic",   atr_sl_mult: 1.5,  atr_tp_orig: 2.0,  atr_tp_upg: 2.0,  enable_mtf: false, enable_adx: false, enable_trailing: false },
  { strategy: "macd",            label: "MACD",                   family: "classic",   atr_sl_mult: 1.5,  atr_tp_orig: 3.0,  atr_tp_upg: 2.0,  enable_mtf: true,  enable_adx: true,  enable_trailing: true  },
  { strategy: "liquidity_sweep", label: "ICT 流動性掃山",           family: "ict",       atr_sl_mult: 1.5,  atr_tp_orig: 3.0,  atr_tp_upg: 2.5,  enable_mtf: true,  enable_adx: false, enable_trailing: true  },
  { strategy: "vwap_reversion",  label: "VWAP 偏差回歸",           family: "ict",       atr_sl_mult: 1.2,  atr_tp_orig: 2.0,  atr_tp_upg: 1.5,  enable_mtf: false, enable_adx: false, enable_trailing: false },
  { strategy: "composite",       label: "複合策略（SMC+PA+纏論）",  family: "composite", atr_sl_mult: 1.5,  atr_tp_orig: 3.0,  atr_tp_upg: 2.0,  enable_mtf: true,  enable_adx: true,  enable_trailing: true  },
  { strategy: "cannonball",      label: "CannonBall",             family: "composite", atr_sl_mult: 1.5,  atr_tp_orig: 3.0,  atr_tp_upg: 2.5,  enable_mtf: true,  enable_adx: true,  enable_trailing: true  },
  { strategy: "hwr_model_a",     label: "HWR-A（掃流動性反轉）",   family: "hwr",       atr_sl_mult: 1.5,  atr_tp_orig: 3.0,  atr_tp_upg: 2.5,  enable_mtf: true,  enable_adx: false, enable_trailing: true  },
  { strategy: "hwr_model_b",     label: "HWR-B（趨勢回踩延續）",   family: "hwr",       atr_sl_mult: 1.5,  atr_tp_orig: 3.0,  atr_tp_upg: 2.5,  enable_mtf: true,  enable_adx: false, enable_trailing: true  },
  { strategy: "hwr_model_c",     label: "HWR-C（中樞邊界反應）",   family: "hwr",       atr_sl_mult: 1.5,  atr_tp_orig: 3.0,  atr_tp_upg: 2.5,  enable_mtf: true,  enable_adx: false, enable_trailing: true  },
];

async function main() {
  console.log("=".repeat(80));
  console.log("  全策略升級潛力掃描（Binance 一年 K 線）");
  console.log("=".repeat(80));

  const [candles1h, candles4h, candles1d] = await Promise.all([
    loadCandles("/home/ubuntu/btcusdt_backtest/candles_1h.json"),
    loadCandles("/home/ubuntu/btcusdt_backtest/candles_4h.json"),
    loadCandles("/home/ubuntu/btcusdt_backtest/candles_1d.json"),
  ]);
  console.log(`  1H: ${candles1h.length} 根  4H: ${candles4h.length} 根  1D: ${candles1d.length} 根`);
  const firstDate = new Date(candles1h[0].time * 1000).toISOString().slice(0, 10);
  const lastDate  = new Date(candles1h[candles1h.length - 1].time * 1000).toISOString().slice(0, 10);
  console.log(`  區間：${firstDate} ~ ${lastDate}`);
  console.log();

  const results: any[] = [];

  for (const s of ALL_STRATEGIES) {
    process.stdout.write(`📊 ${s.label.padEnd(28)} `);

    // 原始回測
    let origStats: any = null;
    try {
      const r = runBacktest({
        candles: candles1h, strategy: s.strategy, symbol: "BTCUSDT", interval: "1h",
        atr_sl_mult: s.atr_sl_mult, atr_tp_mult: s.atr_tp_orig,
        enable_mtf_filter: s.enable_mtf, enable_adx_filter: s.enable_adx,
        enable_trailing_stop: s.enable_trailing, enable_fee: true, candles_4h: candles4h,
      });
      origStats = calcStats(r.trades ?? []);
    } catch (e) { origStats = null; }

    // 升級後回測（TP 調整）
    let upgStats: any = null;
    let upgWith1dStats: any = null;
    try {
      const r = runBacktest({
        candles: candles1h, strategy: s.strategy, symbol: "BTCUSDT", interval: "1h",
        atr_sl_mult: s.atr_sl_mult, atr_tp_mult: s.atr_tp_upg,
        enable_mtf_filter: s.enable_mtf, enable_adx_filter: s.enable_adx,
        enable_trailing_stop: s.enable_trailing, enable_fee: true, candles_4h: candles4h,
      });
      upgStats = calcStats(r.trades ?? []);
      // 再套 1D EMA200
      const filtered1d = apply1dEma200Filter(r.trades ?? [], candles1d);
      upgWith1dStats = calcStats(filtered1d);
    } catch (e) { upgStats = null; }

    const origRet  = origStats      ? `${origStats.return.toFixed(2)}%`      : "N/A";
    const upgRet   = upgStats       ? `${upgStats.return.toFixed(2)}%`       : "N/A";
    const upg1dRet = upgWith1dStats ? `${upgWith1dStats.return.toFixed(2)}%` : "N/A";
    const improvement = origStats && upgWith1dStats ? upgWith1dStats.return - origStats.return : null;
    const mark = upgWith1dStats && upgWith1dStats.return > 0 ? "✅" : "❌";
    console.log(`${mark}  原始:${origRet.padStart(8)}  升級TP:${upgRet.padStart(8)}  升級+1D:${upg1dRet.padStart(8)}  改善:${improvement !== null ? (improvement >= 0 ? "+" : "") + improvement.toFixed(2) + "%" : "N/A"}`);

    results.push({
      strategy: s.strategy, label: s.label, family: s.family,
      atr_sl_mult: s.atr_sl_mult, atr_tp_orig: s.atr_tp_orig, atr_tp_upg: s.atr_tp_upg,
      orig: origStats, upg_tp: upgStats, upg_tp_1d: upgWith1dStats,
    });
  }

  await fs.writeFile(
    "/home/ubuntu/btcusdt_backtest/all_strategy_upgrade_results.json",
    JSON.stringify(results, null, 2)
  );
  console.log("\n✅ 結果已儲存");

  // 排名
  console.log("\n" + "=".repeat(90));
  console.log("  升級後（TP + 1D EMA200）排名");
  console.log("=".repeat(90));
  const ranked = results
    .filter(r => r.upg_tp_1d !== null)
    .sort((a, b) => b.upg_tp_1d.return - a.upg_tp_1d.return);
  console.log(`  ${'策略'.padEnd(26)} ${'原始'.padStart(8)} ${'升級+1D'.padStart(9)} ${'改善'.padStart(8)} ${'PF'.padStart(6)} ${'回撤'.padStart(7)} ${'Sharpe'.padStart(7)} ${'交易'.padStart(5)}`);
  console.log("  " + "-".repeat(88));
  for (const r of ranked) {
    const orig = r.orig?.return ?? 0;
    const upg  = r.upg_tp_1d?.return ?? 0;
    const diff = upg - orig;
    const mark = upg > 0 ? "✅" : "❌";
    console.log(
      `  ${mark} ${r.label.padEnd(25)} ${orig.toFixed(2).padStart(7)}%  ${upg.toFixed(2).padStart(8)}%  ${((diff >= 0 ? "+" : "") + diff.toFixed(2)).padStart(7)}%  ${r.upg_tp_1d.pf.toFixed(3).padStart(5)}  -${r.upg_tp_1d.drawdown.toFixed(1).padStart(5)}%  ${r.upg_tp_1d.sharpe.toFixed(3).padStart(6)}  ${String(r.upg_tp_1d.trades).padStart(4)}`
    );
  }
}

main().catch(console.error);
