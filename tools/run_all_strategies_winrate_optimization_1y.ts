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

type Variant = {
  key: string;
  title: string;
  atr_sl_mult: number;
  atr_tp_mult: number;
  enable_trailing_stop: boolean;
  enable_mtf_filter: boolean;
  enable_adx_filter: boolean;
};

type StrategyVariantRow = {
  strategy: string;
  variant: string;
  title: string;
  total_trades: number;
  win_rate: number;
  win_rate_pct: number;
  total_return_net: number;
  sharpe_ratio: number;
  max_drawdown: number;
  profit_factor: number;
  avg_trade_net_pct: number;
  mtf_filtered_count: number;
  adx_filtered_count: number;
  trailing_stop_count: number;
};

type BestRow = {
  strategy: string;
  baseline_win_rate_pct: number;
  best_variant: string;
  best_win_rate_pct: number;
  win_rate_delta_pct: number;
  baseline_return_net: number;
  best_return_net: number;
  return_delta_pct: number;
  baseline_trades: number;
  best_trades: number;
};

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
];

const VARIANTS: Variant[] = [
  {
    key: "baseline",
    title: "基準版：SL 1.5 / TP 3.0 / Trailing On / MTF On / ADX On",
    atr_sl_mult: 1.5,
    atr_tp_mult: 3.0,
    enable_trailing_stop: true,
    enable_mtf_filter: true,
    enable_adx_filter: true,
  },
  {
    key: "tp2_trailing_on",
    title: "提高命中率：SL 1.5 / TP 2.0 / Trailing On / MTF On / ADX On",
    atr_sl_mult: 1.5,
    atr_tp_mult: 2.0,
    enable_trailing_stop: true,
    enable_mtf_filter: true,
    enable_adx_filter: true,
  },
  {
    key: "tp2_trailing_off",
    title: "提高命中率：SL 1.5 / TP 2.0 / Trailing Off / MTF On / ADX On",
    atr_sl_mult: 1.5,
    atr_tp_mult: 2.0,
    enable_trailing_stop: false,
    enable_mtf_filter: true,
    enable_adx_filter: true,
  },
  {
    key: "tp1_5_trailing_off",
    title: "極致勝率：SL 1.5 / TP 1.5 / Trailing Off / MTF On / ADX On",
    atr_sl_mult: 1.5,
    atr_tp_mult: 1.5,
    enable_trailing_stop: false,
    enable_mtf_filter: true,
    enable_adx_filter: true,
  },
];

const SYMBOL = (process.argv[2] ?? "BTCUSDT").replace("-", "").toUpperCase();
const YEAR_DAYS = 365;
const COUNT_15M = 96 * YEAR_DAYS;
const COUNT_4H = 6 * YEAR_DAYS;
const OUT_DIR = path.resolve("/home/ubuntu/crypto-dashboard-v5.9/reports");
const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";
const PAGE_LIMIT = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isoTime(value: number | undefined): string {
  if (!value) return "";
  return new Date(value * 1000).toISOString();
}

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function num(value: number): string {
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

function summarize(result: BacktestResult, variant: Variant): StrategyVariantRow {
  const avgTradeNetPct = result.total_trades > 0
    ? result.trades.reduce((sum, trade) => sum + trade.pnl_net_pct, 0) / result.total_trades
    : 0;

  return {
    strategy: result.strategy,
    variant: variant.key,
    title: variant.title,
    total_trades: result.total_trades,
    win_rate: result.win_rate,
    win_rate_pct: result.win_rate * 100,
    total_return_net: result.total_return_net,
    sharpe_ratio: result.sharpe_ratio,
    max_drawdown: result.max_drawdown,
    profit_factor: result.profit_factor,
    avg_trade_net_pct: avgTradeNetPct,
    mtf_filtered_count: result.mtf_filtered_count ?? 0,
    adx_filtered_count: result.adx_filtered_count ?? 0,
    trailing_stop_count: result.trailing_stop_count ?? 0,
  };
}

async function main() {
  console.log(`[run] 開始執行 ${SYMBOL} 一年期全策略勝率優化對照回測...`);
  console.log(`[run] 測試變體：${VARIANTS.map((v) => v.key).join(", ")}`);

  const candles15m = await fetchBinanceCandles(SYMBOL, "15m", COUNT_15M);
  const candles4h = await fetchBinanceCandles(SYMBOL, "4h", COUNT_4H);

  if (candles15m.length < COUNT_15M * 0.95) {
    throw new Error(`15m 歷史資料不足，僅取得 ${candles15m.length} 根`);
  }
  if (candles4h.length < COUNT_4H * 0.95) {
    throw new Error(`4H 歷史資料不足，僅取得 ${candles4h.length} 根`);
  }

  const periodStart = isoTime(candles15m[0]?.time);
  const periodEnd = isoTime(candles15m[candles15m.length - 1]?.time);
  console.log(`[run] 實際資料範圍：${periodStart} -> ${periodEnd}`);

  const allRows: StrategyVariantRow[] = [];
  const rawResults: Array<{ strategy: string; variant: string; result: BacktestResult }> = [];

  for (const strategy of STRATEGIES) {
    console.log(`\n[strategy] ${strategy}`);
    for (const variant of VARIANTS) {
      console.log(`[variant] ${variant.key}`);
      const result = runBacktest({
        candles: candles15m,
        strategy,
        symbol: SYMBOL,
        interval: "15m",
        atr_sl_mult: variant.atr_sl_mult,
        atr_tp_mult: variant.atr_tp_mult,
        enable_mtf_filter: variant.enable_mtf_filter,
        enable_fee: true,
        enable_trailing_stop: variant.enable_trailing_stop,
        enable_adx_filter: variant.enable_adx_filter,
        htf_candles: candles4h,
        entry_candles: candles15m,
        use_true_mtf: true,
      });
      rawResults.push({ strategy, variant: variant.key, result });
      const row = summarize(result, variant);
      allRows.push(row);
      console.log(`[done] ${strategy}/${variant.key} trades=${row.total_trades} win=${row.win_rate_pct.toFixed(2)}% net=${row.total_return_net.toFixed(2)}%`);
    }
  }

  const baselineMap = new Map(allRows.filter((row) => row.variant === "baseline").map((row) => [row.strategy, row]));
  const bestRows: BestRow[] = STRATEGIES.map((strategy) => {
    const baseline = baselineMap.get(strategy)!;
    const variants = allRows.filter((row) => row.strategy === strategy);
    const best = [...variants].sort((a, b) => {
      if (b.win_rate_pct !== a.win_rate_pct) return b.win_rate_pct - a.win_rate_pct;
      if (b.total_return_net !== a.total_return_net) return b.total_return_net - a.total_return_net;
      return b.total_trades - a.total_trades;
    })[0];

    return {
      strategy,
      baseline_win_rate_pct: baseline.win_rate_pct,
      best_variant: best.variant,
      best_win_rate_pct: best.win_rate_pct,
      win_rate_delta_pct: best.win_rate_pct - baseline.win_rate_pct,
      baseline_return_net: baseline.total_return_net,
      best_return_net: best.total_return_net,
      return_delta_pct: best.total_return_net - baseline.total_return_net,
      baseline_trades: baseline.total_trades,
      best_trades: best.total_trades,
    };
  }).sort((a, b) => b.win_rate_delta_pct - a.win_rate_delta_pct);

  const variantSummary = VARIANTS.map((variant) => {
    const rows = allRows.filter((row) => row.variant === variant.key);
    const avgWinRatePct = rows.reduce((sum, row) => sum + row.win_rate_pct, 0) / rows.length;
    const avgReturnNet = rows.reduce((sum, row) => sum + row.total_return_net, 0) / rows.length;
    const profitableCount = rows.filter((row) => row.total_return_net > 0).length;
    const improvedWinCount = rows.filter((row) => {
      const baseline = baselineMap.get(row.strategy);
      return baseline ? row.win_rate_pct > baseline.win_rate_pct : false;
    }).length;
    return {
      variant: variant.key,
      title: variant.title,
      avg_win_rate_pct: avgWinRatePct,
      avg_return_net: avgReturnNet,
      profitable_count: profitableCount,
      improved_win_count: improvedWinCount,
    };
  }).sort((a, b) => b.avg_win_rate_pct - a.avg_win_rate_pct);

  const bestOverall = variantSummary[0];
  const bestRowsMd = bestRows.map((row) => `| ${row.strategy} | ${pct(row.baseline_win_rate_pct)} | ${row.best_variant} | ${pct(row.best_win_rate_pct)} | ${row.win_rate_delta_pct >= 0 ? "+" : ""}${pct(row.win_rate_delta_pct)} | ${pct(row.baseline_return_net)} | ${pct(row.best_return_net)} | ${row.return_delta_pct >= 0 ? "+" : ""}${pct(row.return_delta_pct)} | ${row.baseline_trades} | ${row.best_trades} |`).join("\n");
  const variantMd = variantSummary.map((row) => `| ${row.variant} | ${row.title} | ${pct(row.avg_win_rate_pct)} | ${pct(row.avg_return_net)} | ${row.profitable_count} / ${STRATEGIES.length} | ${row.improved_win_count} / ${STRATEGIES.length} |`).join("\n");

  const markdown = `# ${SYMBOL} 一年期全策略勝率優化對照回測\n\n本報告以 **${SYMBOL}** 為標的，採用 **4H 趨勢 + 15m 進場** 的真正雙時間框架回測，針對全部 14 個策略測試 4 種參數變體，重點觀察哪種設定最能提高整體勝率，同時評估淨報酬是否被犧牲。行情資料使用 Binance 公開 K 線端點 [1]。\n\n| 項目 | 值 |\n| --- | --- |\n| 標的 | ${SYMBOL} |\n| 資料範圍 | ${periodStart} -> ${periodEnd} |\n| 15m K 線數 | ${candles15m.length} |\n| 4H K 線數 | ${candles4h.length} |\n| 策略數 | ${STRATEGIES.length} |\n| 變體數 | ${VARIANTS.length} |\n| 整體平均勝率最高變體 | ${bestOverall.variant} |\n| 該變體平均勝率 | ${pct(bestOverall.avg_win_rate_pct)} |\n| 該變體平均淨報酬 | ${pct(bestOverall.avg_return_net)} |\n\n整體來看，如果目標是**單純提高勝率**，最常見且有效的做法通常不是增加更多訊號，而是**降低止盈距離**，讓交易更容易先達成獲利出場；但這通常會以犧牲單筆盈虧比為代價。因此，本報告把注意力放在 **ATR 止盈倍數** 與 **移動止損開關** 兩個最直接影響命中率的設定上。\n\n| 變體 | 設定 | 平均勝率 | 平均淨報酬 | 正報酬策略數 | 勝率高於基準的策略數 |\n| --- | --- | ---: | ---: | ---: | ---: |\n${variantMd}\n\n| 策略 | 基準勝率 | 最佳變體 | 最佳勝率 | 勝率變化 | 基準淨報酬 | 最佳淨報酬 | 淨報酬變化 | 基準交易數 | 最佳交易數 |\n| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${bestRowsMd}\n\n## 解讀重點\n\n如果某個策略在降低 TP 後勝率提升明顯，但淨報酬同步下滑，代表這個策略的問題更可能出在**盈虧比不足**，而不是訊號品質本身。反過來說，如果勝率提升且淨報酬也改善，則表示原本的止盈設得過遠，導致大量本可獲利的交易最後回吐。對於樣本數偏少的策略，還需要額外注意少量交易造成的統計擾動，不能只看表面勝率。\n\n## References\n\n[1]: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data "Binance Spot API Docs - Kline/Candlestick data"\n`;

  const detailHeader = [
    "strategy",
    "variant",
    "title",
    "total_trades",
    "win_rate",
    "win_rate_pct",
    "total_return_net",
    "sharpe_ratio",
    "max_drawdown",
    "profit_factor",
    "avg_trade_net_pct",
    "mtf_filtered_count",
    "adx_filtered_count",
    "trailing_stop_count",
  ].join(",");

  const detailBody = allRows.map((row) => [
    row.strategy,
    row.variant,
    row.title,
    row.total_trades,
    row.win_rate,
    row.win_rate_pct,
    row.total_return_net,
    row.sharpe_ratio,
    row.max_drawdown,
    row.profit_factor,
    row.avg_trade_net_pct,
    row.mtf_filtered_count,
    row.adx_filtered_count,
    row.trailing_stop_count,
  ].map(csvEscape).join(",")).join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(OUT_DIR, `backtest_all_strategies_winrate_optimization_1y_${SYMBOL}_${stamp}.json`);
  const csvPath = path.join(OUT_DIR, `backtest_all_strategies_winrate_optimization_1y_${SYMBOL}_${stamp}.csv`);
  const mdPath = path.join(OUT_DIR, `backtest_all_strategies_winrate_optimization_1y_${SYMBOL}_${stamp}.md`);

  await writeFile(jsonPath, JSON.stringify({
    symbol: SYMBOL,
    generated_at: new Date().toISOString(),
    data_source: {
      provider: "Binance Spot API",
      endpoint: BINANCE_KLINES_URL,
    },
    data_range: {
      start: periodStart,
      end: periodEnd,
      candles_15m: candles15m.length,
      candles_4h: candles4h.length,
    },
    strategies: STRATEGIES,
    variants: VARIANTS,
    variant_summary: variantSummary,
    best_by_strategy: bestRows,
    detailed_rows: allRows,
    raw_results: rawResults,
  }, null, 2));
  await writeFile(csvPath, `${detailHeader}\n${detailBody}\n`);
  await writeFile(mdPath, `${markdown}\n`);

  console.log(`[done] JSON: ${jsonPath}`);
  console.log(`[done] CSV: ${csvPath}`);
  console.log(`[done] MD: ${mdPath}`);
}

main().catch((error) => {
  console.error("[error] 全策略勝率優化對照回測失敗");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
