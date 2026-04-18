import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runBacktest, type BacktestResult, type BacktestStrategy } from "../server/backtest.ts";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const STRATEGIES: BacktestStrategy[] = [
  "ema_cross",
  "rsi_reversal",
  "bollinger",
  "macd",
  "smc",
  "pa",
  "chan",
  "liquidity_sweep",
  "vwap_reversion",
  "composite",
  "cannonball",
  "hwr_model_a",
  "hwr_model_b",
  "hwr_model_c",
  "apex",
  "elite",
  "hwr_model_a_elite",
];

const SYMBOL = (process.argv[2] ?? "BTCUSDT").replace("-", "").toUpperCase();
const YEAR_DAYS = 365;
// 1H 進場框架：每天 24 根，HTF 使用 1D（每天 1 根）
const COUNT_1H  = 24 * YEAR_DAYS;   // 8760 根
const COUNT_1D  = 1  * YEAR_DAYS;   // 365 根
const ATR_SL = 1.5;
const ATR_TP = 3.0;
const OUT_DIR = path.resolve("/home/ubuntu/crypto-dashboard-v5.9/reports");
const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";
const PAGE_LIMIT = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SummaryRow = {
  rank: number;
  strategy: string;
  total_trades: number;
  win_rate: number;
  profit_factor: number;
  total_return: number;
  total_return_net: number;
  sharpe_ratio: number;
  max_drawdown: number;
  avg_trade_net_pct: number;
  mtf_filtered_count: number;
  adx_filtered_count: number;
  trailing_stop_count: number;
  fvg_ob_entry_count: number;
  period_start: string;
  period_end: string;
};

function isoTime(value: number | undefined): string {
  if (!value) return "";
  return new Date(value * 1000).toISOString();
}

function toPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function toNum(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function normalizeBinanceRow(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = Math.floor(Number(row[0]) / 1000);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);
  if (![time, open, high, low, close, volume].every((n) => Number.isFinite(n))) return null;
  return { time, open, high, low, close, volume };
}

async function fetchBinanceCandles(symbol: string, interval: string, targetCount: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  let endTime = Date.now();
  let page = 0;

  while (candles.length < targetCount) {
    page += 1;
    const params = new URLSearchParams({
      symbol,
      interval,
      limit: String(PAGE_LIMIT),
      endTime: String(endTime),
    });

    const res = await fetch(`${BINANCE_KLINES_URL}?${params.toString()}`, {
      headers: { "User-Agent": "Mozilla/5.0 CryptoDashboard/5.9" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Binance ${interval} K 線抓取失敗：HTTP ${res.status} ${text.slice(0, 200)}`);
    }

    const payload = await res.json();
    if (!Array.isArray(payload) || payload.length === 0) break;

    const batch = payload
      .map((row) => normalizeBinanceRow(row))
      .filter((row): row is Candle => row !== null)
      .sort((a, b) => a.time - b.time);

    const earliestExisting = candles.length > 0 ? candles[0].time : Number.POSITIVE_INFINITY;
    const uniqueBatch = candles.length === 0 ? batch : batch.filter((c) => c.time < earliestExisting);
    if (uniqueBatch.length === 0) break;

    candles.unshift(...uniqueBatch);
    endTime = Number(payload[0][0]) - 1;
    console.log(`[fetch] ${interval} 第 ${page} 頁，累計 ${candles.length} 根`);

    if (payload.length < PAGE_LIMIT) break;
    await sleep(120);
  }

  return candles.slice(-targetCount);
}

function summarize(result: BacktestResult, periodStart: string, periodEnd: string): Omit<SummaryRow, "rank"> {
  const avgTradeNetPct = result.total_trades > 0
    ? result.trades.reduce((sum, trade) => sum + trade.pnl_net_pct, 0) / result.total_trades
    : 0;

  return {
    strategy: result.strategy,
    total_trades: result.total_trades,
    win_rate: result.win_rate,
    profit_factor: result.profit_factor,
    total_return: result.total_return,
    total_return_net: result.total_return_net,
    sharpe_ratio: result.sharpe_ratio,
    max_drawdown: result.max_drawdown,
    avg_trade_net_pct: avgTradeNetPct,
    mtf_filtered_count: result.mtf_filtered_count ?? 0,
    adx_filtered_count: result.adx_filtered_count ?? 0,
    trailing_stop_count: result.trailing_stop_count ?? 0,
    fvg_ob_entry_count: result.fvg_ob_entry_count ?? 0,
    period_start: periodStart,
    period_end: periodEnd,
  };
}

async function main() {
  console.log(`[run] 開始執行 ${SYMBOL} 一年期 MTF 全策略回測（1D 趨勢 + 1H 進場）...`);
  console.log(`[run] 目標 K 線數：1H=${COUNT_1H}, 1D=${COUNT_1D}`);

  const candles1h = await fetchBinanceCandles(SYMBOL, "1h", COUNT_1H);
  const candles1d = await fetchBinanceCandles(SYMBOL, "1d", COUNT_1D);

  if (candles1h.length < COUNT_1H * 0.95) {
    throw new Error(`1H 歷史資料不足，僅取得 ${candles1h.length} 根`);
  }

  const periodStart = isoTime(candles1h[0]?.time);
  const periodEnd = isoTime(candles1h[candles1h.length - 1]?.time);
  console.log(`[run] 實際資料範圍：${periodStart} -> ${periodEnd}`);

  const rawResults: BacktestResult[] = [];
  for (const strategy of STRATEGIES) {
    console.log(`[run] 回測策略：${strategy}`);
    const result = runBacktest({
      candles: candles1h,
      strategy,
      symbol: SYMBOL,
      interval: "1h",
      atr_sl_mult: ATR_SL,
      atr_tp_mult: ATR_TP,
      enable_mtf_filter: true,
      enable_fee: true,
      enable_trailing_stop: true,
      enable_adx_filter: true,
      htf_candles: candles1d,
      entry_candles: candles1h,
      use_true_mtf: true,
    });
    rawResults.push(result);
    console.log(`[done] ${strategy} trades=${result.total_trades} net=${result.total_return_net.toFixed(2)}% sharpe=${result.sharpe_ratio.toFixed(2)}`);
  }

  const ranked = rawResults
    .map((result) => summarize(result, periodStart, periodEnd))
    .sort((a, b) => {
      if (b.total_return_net !== a.total_return_net) return b.total_return_net - a.total_return_net;
      if (b.sharpe_ratio !== a.sharpe_ratio) return b.sharpe_ratio - a.sharpe_ratio;
      return b.win_rate - a.win_rate;
    })
    .map((row, index) => ({ rank: index + 1, ...row }));

  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const profitable = ranked.filter((row) => row.total_return_net > 0).length;
  const mdRows = ranked.map((row) => `| ${row.rank} | ${row.strategy} | ${row.total_trades} | ${toPct(row.win_rate)} | ${toNum(row.profit_factor)} | ${toPct(row.total_return_net)} | ${toNum(row.sharpe_ratio)} | ${toPct(row.max_drawdown)} | ${toPct(row.avg_trade_net_pct)} | ${row.mtf_filtered_count} | ${row.adx_filtered_count} | ${row.trailing_stop_count} | ${row.fvg_ob_entry_count} |`).join("\n");

  const markdown = `# ${SYMBOL} 一年期 MTF 全策略回測結果（1H 進場框架）\n\n本次回測以 **${SYMBOL}** 為標的，採用 **1D 趨勢方向 + 1H 進場執行** 的 MTF 設定，並對全部策略統一啟用 MTF 過濾、手續費、移動止損與 ADX 濾網。行情資料使用 Binance 公開 K 線端點 [1]。\n\n| 項目 | 值 |\n| --- | --- |\n| 標的 | ${SYMBOL} |\n| MTF 設定 | 1D 趨勢 + 1H 進場 |\n| 使用風控 | ATR SL=${ATR_SL}, ATR TP=${ATR_TP}, Fee=On, Trailing=On, ADX=On |\n| 1H K 線數 | ${candles1h.length} |\n| 1D K 線數 | ${candles1d.length} |\n| 實際資料起點 | ${periodStart} |\n| 實際資料終點 | ${periodEnd} |\n| 正報酬策略數 | ${profitable} / ${ranked.length} |\n| 第一名策略 | ${best.strategy}（淨報酬 ${toPct(best.total_return_net)}，Sharpe ${toNum(best.sharpe_ratio)}） |\n| 最末名策略 | ${worst.strategy}（淨報酬 ${toPct(worst.total_return_net)}，Sharpe ${toNum(worst.sharpe_ratio)}） |\n\n從一年期排名來看，表現較佳的策略通常同時具備較高的 Sharpe Ratio 與較低的最大回撤，而交易數偏少的策略即使淨報酬靠前，也需要額外留意樣本不足帶來的不確定性。因此，最適合的解讀方式並不是只看第一名，而是把淨報酬、交易數與回撤一起評估。\n\n| 排名 | 策略 | 交易數 | 勝率 | Profit Factor | 淨報酬 | Sharpe | 最大回撤 | 單筆平均淨報酬 | MTF 過濾次數 | ADX 過濾次數 | Trailing 次數 | FVG/OB 進場次數 |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${mdRows}\n\n## References\n\n[1]: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data "Binance Spot API Docs - Kline/Candlestick data"\n`;

  const csvHeader = [
    "rank", "strategy", "total_trades", "win_rate", "profit_factor",
    "total_return", "total_return_net", "sharpe_ratio", "max_drawdown",
    "avg_trade_net_pct", "mtf_filtered_count", "adx_filtered_count",
    "trailing_stop_count", "fvg_ob_entry_count", "period_start", "period_end",
  ].join(",");

  const csvBody = ranked.map((row) => [
    row.rank, row.strategy, row.total_trades, row.win_rate, row.profit_factor,
    row.total_return, row.total_return_net, row.sharpe_ratio, row.max_drawdown,
    row.avg_trade_net_pct, row.mtf_filtered_count, row.adx_filtered_count,
    row.trailing_stop_count, row.fvg_ob_entry_count, row.period_start, row.period_end,
  ].map(csvEscape).join(",")).join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(OUT_DIR, `backtest_all_strategies_1d1h_1y_${SYMBOL}_${stamp}.json`);
  const csvPath  = path.join(OUT_DIR, `backtest_all_strategies_1d1h_1y_${SYMBOL}_${stamp}.csv`);
  const mdPath   = path.join(OUT_DIR, `backtest_all_strategies_1d1h_1y_${SYMBOL}_${stamp}.md`);

  await writeFile(jsonPath, JSON.stringify({
    symbol: SYMBOL,
    generated_at: new Date().toISOString(),
    data_source: { provider: "Binance Spot API", endpoint: BINANCE_KLINES_URL },
    setup: {
      mtf_mode: "1D trend + 1H entry",
      use_true_mtf: true,
      atr_sl_mult: ATR_SL,
      atr_tp_mult: ATR_TP,
      enable_mtf_filter: true,
      enable_fee: true,
      enable_trailing_stop: true,
      enable_adx_filter: true,
    },
    data_range: { start: periodStart, end: periodEnd, candles_1h: candles1h.length, candles_1d: candles1d.length },
    ranked_results: ranked,
    raw_results: rawResults,
  }, null, 2));
  await writeFile(csvPath, `${csvHeader}\n${csvBody}\n`);
  await writeFile(mdPath, `${markdown}\n`);

  console.log(`[done] JSON: ${jsonPath}`);
  console.log(`[done] CSV: ${csvPath}`);
  console.log(`[done] MD: ${mdPath}`);
}

main().catch((error) => {
  console.error("[error] 1H 全策略一年期 MTF 回測失敗");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
