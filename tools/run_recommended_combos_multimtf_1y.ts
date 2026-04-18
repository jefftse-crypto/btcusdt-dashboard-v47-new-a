import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runBacktest, type BacktestResult, type BacktestStrategy, type BacktestTrade, effectiveSignalCount } from "../server/backtest.ts";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ComboDef {
  name: string;
  key: string;
  strategies: BacktestStrategy[];
  note: string;
}

interface VariantDef {
  key: string;
  label: string;
  minSignalScore: number;
  requireConsensus: number;
  consensusLookbackSec: number;
}

interface EnrichedTrade extends BacktestTrade {
  strategy: BacktestStrategy;
  recent_wr: number;
  rr_score: number;
  select_score: number;
}

interface ComboSummary {
  combo_name: string;
  combo_key: string;
  variant_key: string;
  variant_label: string;
  strategies: string[];
  effective_signal_count: number;
  total_trades: number;
  win_rate: number;
  profit_factor: number;
  total_return: number;
  total_return_net: number;
  max_drawdown: number;
  sharpe_ratio: number;
  avg_trade_net_pct: number;
  period_start: string;
  period_end: string;
}

const COMBOS: ComboDef[] = [
  {
    name: "最優平衡",
    key: "best_balance",
    strategies: ["ema_cross", "cannonball", "hwr_model_a", "hwr_model_c", "macd"],
    note: "含 CannonBall 結構確認與趨勢延續",
  },
  {
    name: "最高勝率",
    key: "highest_winrate",
    strategies: ["bollinger", "ema_cross", "cannonball", "hwr_model_a", "macd"],
    note: "加入 CannonBall 後更偏保守確認",
  },
  {
    name: "最低回撤",
    key: "lowest_drawdown",
    strategies: ["ema_cross", "cannonball", "hwr_model_a", "vwap_reversion"],
    note: "偏重結構確認與均值回歸互補",
  },
  {
    name: "高活躍度",
    key: "high_activity",
    strategies: ["pa", "cannonball", "hwr_model_b", "macd", "chan"],
    note: "兼顧趨勢追蹤與結構型回踩",
  },
];

const VARIANTS: VariantDef[] = [
  {
    key: "baseline",
    label: "基準版：單一最佳信號，無額外門檻",
    minSignalScore: 0,
    requireConsensus: 1,
    consensusLookbackSec: 0,
  },
  {
    key: "score6",
    label: "提高門檻：signal_score >= 6",
    minSignalScore: 6,
    requireConsensus: 1,
    consensusLookbackSec: 0,
  },
  {
    key: "score7",
    label: "提高門檻：signal_score >= 7",
    minSignalScore: 7,
    requireConsensus: 1,
    consensusLookbackSec: 0,
  },
  {
    key: "consensus2_4h",
    label: "雙策略共識：4 小時內至少 2 個同向信號",
    minSignalScore: 0,
    requireConsensus: 2,
    consensusLookbackSec: 4 * 3600,
  },
  {
    key: "consensus2_4h_score6",
    label: "雙策略共識 + 品質過濾：4 小時 2 同向且 signal_score >= 6",
    minSignalScore: 6,
    requireConsensus: 2,
    consensusLookbackSec: 4 * 3600,
  },
  {
    key: "consensus2_8h_score6",
    label: "雙策略共識 + 品質過濾：8 小時 2 同向且 signal_score >= 6",
    minSignalScore: 6,
    requireConsensus: 2,
    consensusLookbackSec: 8 * 3600,
  },
];

const SYMBOL = (process.argv[2] ?? "BTCUSDT").replace("-", "").toUpperCase();
const YEAR_DAYS = 365;
const COUNT_15M = 96 * YEAR_DAYS;
const COUNT_4H = 6 * YEAR_DAYS;
const ATR_SL = 1.5;
const ATR_TP = 3.0;
const OUT_DIR = path.resolve("/home/ubuntu/crypto-dashboard-v5.9/reports");
const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";
const PAGE_LIMIT = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isoTime(value: number | undefined): string {
  if (!value) return "";
  return new Date(value * 1000).toISOString();
}

function toPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
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

function calcRecentWr(trades: BacktestTrade[], index: number): number {
  const start = Math.max(0, index - 20);
  const sample = trades.slice(start, index);
  if (sample.length === 0) return 0.5;
  return sample.filter((t) => t.pnl_net_pct > 0).length / sample.length;
}

function calcRrScore(trade: BacktestTrade): number {
  const risk = Math.abs(trade.entry_price - trade.sl_price);
  const reward = Math.abs(trade.tp_price - trade.entry_price);
  if (!Number.isFinite(risk) || !Number.isFinite(reward) || risk <= 0) return 0.5;
  return Math.min(reward / risk / 3, 1);
}

function calcSelectScore(trade: BacktestTrade, recentWr: number, rrScore: number): number {
  const signalNorm = Math.max(0, Math.min((trade.signal_score ?? 0) / 10, 1));
  return signalNorm * 0.35 + recentWr * 0.25 + rrScore * 0.20 + 0.20;
}

function enrichTrades(strategy: BacktestStrategy, trades: BacktestTrade[]): EnrichedTrade[] {
  return trades.map((trade, index) => {
    const recent_wr = calcRecentWr(trades, index);
    const rr_score = calcRrScore(trade);
    const select_score = calcSelectScore(trade, recent_wr, rr_score);
    return { ...trade, strategy, recent_wr, rr_score, select_score };
  });
}

function hasConsensus(candidate: EnrichedTrade, pool: EnrichedTrade[], required: number, lookbackSec: number): boolean {
  if (required <= 1) return true;
  const aligned = new Set<string>([candidate.strategy]);
  const lowerBound = candidate.entry_time - lookbackSec;
  for (const trade of pool) {
    if (trade.strategy === candidate.strategy) continue;
    if (trade.direction !== candidate.direction) continue;
    if (trade.entry_time < lowerBound || trade.entry_time > candidate.entry_time) continue;
    aligned.add(trade.strategy);
    if (aligned.size >= required) return true;
  }
  return false;
}

function buildComboTrades(
  combo: ComboDef,
  tradeMap: Map<BacktestStrategy, EnrichedTrade[]>,
  variant: VariantDef,
): EnrichedTrade[] {
  const pool = combo.strategies
    .flatMap((strategy) => tradeMap.get(strategy) ?? [])
    .filter((trade) => (trade.signal_score ?? 0) >= variant.minSignalScore)
    .sort((a, b) => {
      if (a.entry_time !== b.entry_time) return a.entry_time - b.entry_time;
      return b.select_score - a.select_score;
    });

  const selected: EnrichedTrade[] = [];
  let currentExit = 0;
  let index = 0;
  const clusterWindowSec = 15 * 60;

  while (index < pool.length) {
    while (index < pool.length && pool[index].entry_time < currentExit) index++;
    if (index >= pool.length) break;

    const earliest = pool[index].entry_time;
    const cluster: EnrichedTrade[] = [];
    let j = index;
    while (j < pool.length && pool[j].entry_time <= earliest + clusterWindowSec) {
      const trade = pool[j];
      if (trade.entry_time >= currentExit && hasConsensus(trade, pool, variant.requireConsensus, variant.consensusLookbackSec)) {
        cluster.push(trade);
      }
      j++;
    }

    if (cluster.length === 0) {
      index = j;
      continue;
    }

    cluster.sort((a, b) => {
      if (b.select_score !== a.select_score) return b.select_score - a.select_score;
      if ((b.signal_score ?? 0) !== (a.signal_score ?? 0)) return (b.signal_score ?? 0) - (a.signal_score ?? 0);
      return a.exit_time - b.exit_time;
    });

    const chosen = cluster[0];
    selected.push(chosen);
    currentExit = chosen.exit_time;
    index = j;
  }

  return selected;
}

function summarizeTrades(combo: ComboDef, variant: VariantDef, trades: EnrichedTrade[]): ComboSummary {
  let equity = 1;
  let equityNet = 1;
  let peakNet = 1;
  let maxDd = 0;
  let wins = 0;
  let totalWin = 0;
  let totalLoss = 0;
  const returns: number[] = [];

  for (const t of trades) {
    equity *= (1 + t.pnl_pct);
    equityNet *= (1 + t.pnl_net_pct);
    if (equityNet > peakNet) peakNet = equityNet;
    const dd = (peakNet - equityNet) / peakNet;
    if (dd > maxDd) maxDd = dd;
    returns.push(t.pnl_net_pct);
    if (t.pnl_net_pct > 0) {
      wins++;
      totalWin += t.pnl_net_pct;
    } else {
      totalLoss += Math.abs(t.pnl_net_pct);
    }
  }

  const win_rate = trades.length > 0 ? wins / trades.length : 0;
  const profit_factor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 99 : 0;
  const total_return = equity - 1;
  const total_return_net = equityNet - 1;
  const avg_trade_net_pct = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.pnl_net_pct, 0) / trades.length
    : 0;

  const startTs = trades.length > 0 ? trades[0].entry_time : 0;
  const endTs = trades.length > 0 ? trades[trades.length - 1].exit_time : 0;
  const periodYears = (startTs && endTs && endTs > startTs)
    ? (endTs - startTs) / (365.25 * 24 * 3600)
    : 1;
  const tradesPerYear = periodYears > 0 ? trades.length / periodYears : trades.length;
  const mean = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const std = Math.sqrt(Math.max(variance, 0));
  const sharpe_ratio = std > 0 ? (mean / std) * Math.sqrt(Math.max(tradesPerYear, 1)) : 0;

  return {
    combo_name: combo.name,
    combo_key: combo.key,
    variant_key: variant.key,
    variant_label: variant.label,
    strategies: combo.strategies,
    effective_signal_count: effectiveSignalCount(combo.strategies),
    total_trades: trades.length,
    win_rate,
    profit_factor,
    total_return,
    total_return_net,
    max_drawdown: maxDd,
    sharpe_ratio,
    avg_trade_net_pct,
    period_start: isoTime(startTs),
    period_end: isoTime(endTs),
  };
}

function chooseImprovementCandidate(rows: ComboSummary[]): ComboSummary | null {
  const meaningful = rows.filter((row) => row.total_trades >= 20);
  if (meaningful.length === 0) return null;
  return [...meaningful].sort((a, b) => {
    if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
    if (b.total_return_net !== a.total_return_net) return b.total_return_net - a.total_return_net;
    return b.profit_factor - a.profit_factor;
  })[0];
}

async function main() {
  console.log(`[run] 開始執行 ${SYMBOL} 四個推薦組合一年期 MTF 回測（4H 趨勢 + 15m 進場）...`);
  const uniqueStrategies = Array.from(new Set(COMBOS.flatMap((combo) => combo.strategies)));
  console.log(`[run] 組合涉及 ${uniqueStrategies.length} 個唯一策略：${uniqueStrategies.join(", ")}`);

  const candles15m = await fetchBinanceCandles(SYMBOL, "15m", COUNT_15M);
  const candles4h = await fetchBinanceCandles(SYMBOL, "4h", COUNT_4H);

  if (candles15m.length < COUNT_15M * 0.95) {
    throw new Error(`15m 歷史資料不足，僅取得 ${candles15m.length} 根`);
  }
  if (candles4h.length < COUNT_4H * 0.95) {
    throw new Error(`4H 歷史資料不足，僅取得 ${candles4h.length} 根`);
  }

  const dataStart = isoTime(candles15m[0]?.time);
  const dataEnd = isoTime(candles15m[candles15m.length - 1]?.time);
  console.log(`[run] 實際資料範圍：${dataStart} -> ${dataEnd}`);

  const strategyResults = new Map<BacktestStrategy, BacktestResult>();
  const strategyTrades = new Map<BacktestStrategy, EnrichedTrade[]>();

  for (const strategy of uniqueStrategies) {
    console.log(`[run] 回測策略：${strategy}`);
    const result = runBacktest({
      candles: candles15m,
      strategy,
      symbol: SYMBOL,
      interval: "15m",
      atr_sl_mult: ATR_SL,
      atr_tp_mult: ATR_TP,
      enable_mtf_filter: true,
      enable_fee: true,
      enable_trailing_stop: true,
      enable_adx_filter: true,
      htf_candles: candles4h,
      entry_candles: candles15m,
      use_true_mtf: true,
    });
    strategyResults.set(strategy, result);
    strategyTrades.set(strategy, enrichTrades(strategy, result.trades));
    console.log(`[done] ${strategy} trades=${result.total_trades} win=${(result.win_rate * 100).toFixed(2)}% net=${(result.total_return_net * 100).toFixed(2)}%`);
  }

  const comboSummaries: ComboSummary[] = [];
  const comboTradeDetails: Record<string, unknown> = {};

  for (const combo of COMBOS) {
    const rows: ComboSummary[] = [];
    const tradeByVariant: Record<string, unknown> = {};
    console.log(`\n[combo] ${combo.name} = ${combo.strategies.join(" + ")}`);

    for (const variant of VARIANTS) {
      const selectedTrades = buildComboTrades(combo, strategyTrades, variant);
      const summary = summarizeTrades(combo, variant, selectedTrades);
      comboSummaries.push(summary);
      rows.push(summary);
      tradeByVariant[variant.key] = selectedTrades.map((t) => ({
        strategy: t.strategy,
        direction: t.direction,
        entry_time: t.entry_time,
        exit_time: t.exit_time,
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        signal_score: t.signal_score ?? null,
        recent_wr: t.recent_wr,
        rr_score: t.rr_score,
        select_score: t.select_score,
        pnl_net_pct: t.pnl_net_pct,
        exit_reason: t.exit_reason,
      }));
      console.log(`[variant] ${variant.key} trades=${summary.total_trades} win=${(summary.win_rate * 100).toFixed(2)}% net=${(summary.total_return_net * 100).toFixed(2)}% pf=${summary.profit_factor.toFixed(2)}`);
    }

    const bestImprove = chooseImprovementCandidate(rows);
    comboTradeDetails[combo.key] = {
      combo,
      baseline: rows.find((r) => r.variant_key === "baseline") ?? null,
      best_improvement: bestImprove,
      variants: rows,
      trades: tradeByVariant,
      components: combo.strategies.map((strategy) => {
        const result = strategyResults.get(strategy)!;
        return {
          strategy,
          total_trades: result.total_trades,
          win_rate: result.win_rate,
          total_return_net: result.total_return_net,
          profit_factor: result.profit_factor,
          max_drawdown: result.max_drawdown,
        };
      }),
    };
  }

  const baselineRows = comboSummaries
    .filter((row) => row.variant_key === "baseline")
    .sort((a, b) => {
      if (b.total_return_net !== a.total_return_net) return b.total_return_net - a.total_return_net;
      if (b.sharpe_ratio !== a.sharpe_ratio) return b.sharpe_ratio - a.sharpe_ratio;
      return b.win_rate - a.win_rate;
    });

  const improvementRows = COMBOS.map((combo) => {
    const rows = comboSummaries.filter((row) => row.combo_key === combo.key);
    const baseline = rows.find((row) => row.variant_key === "baseline")!;
    const improved = chooseImprovementCandidate(rows) ?? baseline;
    return { combo, baseline, improved };
  });

  const baselineTable = baselineRows.map((row, index) => `| ${index + 1} | ${row.combo_name} | ${row.strategies.join(" + ")} | ${row.total_trades} | ${toPct(row.win_rate)} | ${toPct(row.total_return_net)} | ${toNum(row.profit_factor)} | ${toPct(row.max_drawdown)} | ${toNum(row.sharpe_ratio)} |`).join("\n");
  const improveTable = improvementRows.map(({ combo, baseline, improved }) => `| ${combo.name} | ${baseline.variant_label} | ${toPct(baseline.win_rate)} | ${baseline.total_trades} | ${toPct(baseline.total_return_net)} | ${improved.variant_label} | ${toPct(improved.win_rate)} | ${improved.total_trades} | ${toPct(improved.total_return_net)} |`).join("\n");

  const markdown = `# ${SYMBOL} 一年期 MTF 推薦組合回測與勝率優化

本報告針對前端「組合策略即時信號」面板中的四個推薦組合，使用 **4H 趨勢 + 15m 進場** 的全年資料進行歷史模擬。資料來源為 Binance 公開 K 線端點 [1]。由於專案原本僅提供即時組合掃描，未提供組合層級的歷史回測引擎，因此本次採用一致口徑：先對組合內各策略完成單策略回測，再以 **單一倉位、同時間簇只取最高 select score、可選用品質門檻與雙策略同向共識** 的方式重建組合層級績效，以便和你截圖中的組合邏輯做接近的歷史比較。

| 項目 | 值 |
| --- | --- |
| 標的 | ${SYMBOL} |
| MTF 設定 | 4H 趨勢 + 15m 進場 |
| 風控設定 | ATR SL=${ATR_SL}, ATR TP=${ATR_TP}, Fee=On, Trailing=On, ADX=On |
| 15m K 線數 | ${candles15m.length} |
| 4H K 線數 | ${candles4h.length} |
| 資料起點 | ${dataStart} |
| 資料終點 | ${dataEnd} |
| 推薦組合數 | ${COMBOS.length} |
| 測試變體數 | ${VARIANTS.length} |

## 一、四個推薦組合的基準回測

下表只看最接近目前介面邏輯的 **基準版**，也就是不加額外 signal score 門檻、不加額外雙策略共識，只在同一時間簇內挑選評分最高的信號。

| 排名 | 組合 | 策略成員 | 交易數 | 勝率 | 淨報酬 | Profit Factor | 最大回撤 | Sharpe |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${baselineTable}

## 二、如何提高勝率：變體測試

為了回答「怎樣提高勝率」，本次對每個推薦組合另外測試了三種思路。第一種是 **提高 signal score 門檻**，只保留更高品質的進場；第二種是 **雙策略同向共識**，要求在最近 4 至 8 小時內至少有兩個不同策略給出同方向信號；第三種是 **品質門檻與共識疊加**。下表列出各組合的基準版與最佳改善版。

| 組合 | 基準版 | 基準勝率 | 基準交易數 | 基準淨報酬 | 最佳改善版 | 改善後勝率 | 改善後交易數 | 改善後淨報酬 |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
${improveTable}

## 三、解讀方式

如果某個改善版的勝率明顯變高，但交易數大幅縮水，就表示它的改善很大程度來自 **挑單更嚴**，而不是策略本身真正變穩。相反地，如果某個改善版在維持足夠交易數的前提下，同時提升勝率與 Profit Factor，這種改善才更接近可用的實戰優化方向。因此，本次我在挑選「最佳改善版」時，額外要求至少保留 **20 筆交易**，避免只靠過度過濾把勝率美化得太漂亮。

## References

[1]: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data "Binance Spot API Docs - Kline/Candlestick data"
`;

  const csvHeader = [
    "combo_name",
    "combo_key",
    "variant_key",
    "variant_label",
    "strategies",
    "effective_signal_count",
    "total_trades",
    "win_rate",
    "profit_factor",
    "total_return",
    "total_return_net",
    "max_drawdown",
    "sharpe_ratio",
    "avg_trade_net_pct",
    "period_start",
    "period_end",
  ].join(",");

  const csvBody = comboSummaries.map((row) => [
    row.combo_name,
    row.combo_key,
    row.variant_key,
    row.variant_label,
    row.strategies.join(" + "),
    row.effective_signal_count,
    row.total_trades,
    row.win_rate,
    row.profit_factor,
    row.total_return,
    row.total_return_net,
    row.max_drawdown,
    row.sharpe_ratio,
    row.avg_trade_net_pct,
    row.period_start,
    row.period_end,
  ].map(csvEscape).join(",")).join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(OUT_DIR, `backtest_recommended_combos_multimtf_1y_${SYMBOL}_${stamp}.json`);
  const csvPath = path.join(OUT_DIR, `backtest_recommended_combos_multimtf_1y_${SYMBOL}_${stamp}.csv`);
  const mdPath = path.join(OUT_DIR, `backtest_recommended_combos_multimtf_1y_${SYMBOL}_${stamp}.md`);

  await writeFile(jsonPath, JSON.stringify({
    symbol: SYMBOL,
    generated_at: new Date().toISOString(),
    data_source: {
      provider: "Binance Spot API",
      endpoint: BINANCE_KLINES_URL,
    },
    setup: {
      mtf_mode: "4H trend + 15m entry",
      use_true_mtf: true,
      atr_sl_mult: ATR_SL,
      atr_tp_mult: ATR_TP,
      enable_mtf_filter: true,
      enable_fee: true,
      enable_trailing_stop: true,
      enable_adx_filter: true,
      combo_reconstruction: "single-position sequential selection of best-scored trade cluster",
    },
    data_range: {
      start: dataStart,
      end: dataEnd,
      candles_15m: candles15m.length,
      candles_4h: candles4h.length,
    },
    combos: COMBOS,
    variants: VARIANTS,
    strategy_results: Object.fromEntries(Array.from(strategyResults.entries()).map(([k, v]) => [k, v])),
    combo_summaries: comboSummaries,
    combo_trade_details: comboTradeDetails,
  }, null, 2));
  await writeFile(csvPath, `${csvHeader}\n${csvBody}\n`);
  await writeFile(mdPath, `${markdown}\n`);

  console.log(`[done] JSON: ${jsonPath}`);
  console.log(`[done] CSV: ${csvPath}`);
  console.log(`[done] MD: ${mdPath}`);
}

main().catch((error) => {
  console.error("[error] 四個推薦組合一年期 MTF 回測失敗");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
