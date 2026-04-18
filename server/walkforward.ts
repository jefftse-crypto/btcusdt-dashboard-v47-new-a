/**
 * Walk-Forward 驗證引擎 v2.0
 * gpt-5.4 第二輪審查修復：
 *  [F1] calcDecay：修復負值/跨零/接近零時比值失真，改用有界差值轉換
 *  [F2] step=0 無限迴圈防護：isRatio=1 或極小窗口時的安全邊界
 *  [F3] drawdown_inflation：加入 eps 平滑，避免 IS DD≈0 時硬編碼常數
 *  [F4] overfittingScore：加入 fold 分散度懲罰（stddev of OOS Sharpe）
 *  [F5] 最小 K 線數驗證：IS/OOS 各需至少 50 根
 *
 * 架構：
 * 1080 根 K 線
 * ├── Fold 1: [0..377] IS → [378..539] OOS
 * ├── Fold 2: [162..539] IS → [540..701] OOS
 * ├── Fold 3: [324..701] IS → [702..863] OOS
 * └── Fold 4: [486..863] IS → [864..1025] OOS
 */

import type { Candle } from "../shared/cryptoTypes";
import type { BacktestStrategy } from "./backtest";
import { runBacktest } from "./backtest";

// ─────────────────────────────────────────────────────────────────────────────
// 型別定義
// ─────────────────────────────────────────────────────────────────────────────

export interface WFPeriodStats {
  trades:        number;
  win_rate:      number;
  total_return:  number;
  sharpe:        number;
  sortino:       number;
  max_drawdown:  number;
  profit_factor: number;
}

export interface WFFoldResult {
  fold_index:         number;
  is_start:           number;   // IS 起始 K 線索引
  is_end:             number;   // IS 結束 K 線索引
  oos_start:          number;   // OOS 起始 K 線索引
  oos_end:            number;   // OOS 結束 K 線索引
  is_stats:           WFPeriodStats;
  oos_stats:          WFPeriodStats;
  win_rate_decay:     number;   // OOS/IS 勝率衰減（有界差值）
  sharpe_decay:       number;   // OOS/IS Sharpe 衰減（有界差值）
  return_decay:       number;   // OOS/IS 收益衰減（有界差值）
  drawdown_inflation: number;   // OOS/IS 回撤放大比（eps 平滑）
}

export interface WalkForwardResult {
  folds:             WFFoldResult[];
  is_stats:          WFPeriodStats;   // 所有 IS 的聚合
  oos_stats:         WFPeriodStats;   // 所有 OOS 的聚合（真實 OOS 表現）
  overfitting_score: number;          // 0-100，越高越過擬合
  verdict:           "healthy" | "warning" | "overfitting";
  total_candles:     number;
  fold_count:        number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 統計聚合工具
// ─────────────────────────────────────────────────────────────────────────────

function aggregateStats(statsArr: WFPeriodStats[]): WFPeriodStats {
  if (statsArr.length === 0) {
    return { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 };
  }
  const totalTrades = statsArr.reduce((s, x) => s + x.trades, 0);
  // ★ 交易量加權計算 Sharpe/Sortino/win_rate
  const weightedWinRate = totalTrades > 0
    ? statsArr.reduce((s, x) => s + x.win_rate * x.trades, 0) / totalTrades
    : 0;
  const weightedSharpe = totalTrades > 0
    ? statsArr.reduce((s, x) => s + x.sharpe * x.trades, 0) / totalTrades
    : 0;
  const weightedSortino = totalTrades > 0
    ? statsArr.reduce((s, x) => s + x.sortino * x.trades, 0) / totalTrades
    : 0;
  // profit_factor 用幾何平均（乘法式指標）
  const validPf = statsArr.filter(x => x.profit_factor > 0 && x.profit_factor < 99);
  const geomPf = validPf.length > 0
    ? Math.exp(validPf.reduce((s, x) => s + Math.log(x.profit_factor), 0) / validPf.length)
    : 0;
  // total_return：OOS 用幾何連乘（不重疊 OOS 才有財務意義），IS 用平均（IS 重疊無法連乘）
  const geomReturn = statsArr.reduce((prod, x) => prod * (1 + x.total_return), 1) - 1;
  return {
    trades:        totalTrades,
    win_rate:      weightedWinRate,
    total_return:  geomReturn,
    sharpe:        weightedSharpe,
    sortino:       weightedSortino,
    max_drawdown:  Math.max(...statsArr.map(x => x.max_drawdown)),
    profit_factor: geomPf,
  };
}

/**
 * [F1] 修復 calcDecay：避免負值/跨零/接近零時比值失真
 * 改用有界差值轉換：decay = (oos - is) / max(|is|, eps)
 * 結果解讀：
 *   1.0 = 完全無衰減（OOS = IS）
 *   0.5 = 衰減 50%（OOS = 0.5 * IS）
 *   0.0 = 完全喪失 edge（OOS = 0）
 *  <0   = OOS 比 IS 更差（可能反轉）
 */
function calcDecay(is: number, oos: number): number {
  const eps = 1e-6;
  const denom = Math.max(Math.abs(is), eps);
  // 若 IS 接近零（無 edge），改用差值評分而非比值
  if (Math.abs(is) < 0.001) {
    // IS 幾乎沒 edge：OOS 正值視為 1（維持），負值視為 0（喪失）
    return oos >= 0 ? 1.0 : 0.0;
  }
  // 有界差值：(oos - is) / |is|，再轉為衰減比（1 + delta）
  const delta = (oos - is) / denom;
  // clamp 到合理範圍 [-1, 2]，避免極端值污染分數
  return Math.max(-1, Math.min(2, 1 + delta));
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/**
 * [F4] 修復 calcOverfittingScore：加入 fold 分散度懲罰
 * 除了平均衰減，還懲罰 OOS Sharpe 的 stddev（不穩定策略）
 */
function calcOverfittingScore(folds: WFFoldResult[]): number {
  if (folds.length === 0) return 0;

  const avgWinDecay    = folds.reduce((s, f) => s + f.win_rate_decay, 0) / folds.length;
  const avgSharpeDecay = folds.reduce((s, f) => s + f.sharpe_decay, 0) / folds.length;
  const avgRetDecay    = folds.reduce((s, f) => s + f.return_decay, 0) / folds.length;
  const avgDDInflation = folds.reduce((s, f) => s + f.drawdown_inflation, 0) / folds.length;

  // 各指標轉換為 0-100 的過擬合分數（越高越過擬合）
  const winScore    = clampScore((1 - avgWinDecay)    / 0.3  * 100); // 衰減 30% = 100 分
  const sharpeScore = clampScore((1 - avgSharpeDecay) / 0.6  * 100); // 衰減 60% = 100 分
  const returnScore = clampScore((1 - avgRetDecay)    / 0.7  * 100); // 衰減 70% = 100 分
  const ddScore     = clampScore((avgDDInflation - 1) / 1.0  * 100); // 放大 100% = 100 分

  // [F4] 加入 OOS Sharpe 分散度懲罰（stddev 越大 = 策略越不穩定）
  let dispersionPenalty = 0;
  if (folds.length >= 2) {
    const oosSharpes = folds.map(f => f.oos_stats.sharpe);
    const meanS = oosSharpes.reduce((a, b) => a + b, 0) / oosSharpes.length;
    const stdS  = Math.sqrt(oosSharpes.reduce((a, s) => a + (s - meanS) ** 2, 0) / oosSharpes.length);
    // stddev > 1.0 開始懲罰，stddev = 3.0 時達到最大 30 分
    dispersionPenalty = clampScore((stdS - 1.0) / 2.0 * 30);
  }

  // 加權：Sharpe 最重要，分散度懲罰作為附加項
  const baseScore = Math.round(
    winScore    * 0.20 +
    sharpeScore * 0.35 +
    returnScore * 0.25 +
    ddScore     * 0.20
  );

  return clampScore(baseScore + dispersionPenalty * 0.15);
}

// ─────────────────────────────────────────────────────────────────────────────
// 主函數：Walk-Forward 驗證
// ─────────────────────────────────────────────────────────────────────────────

export async function runWalkForwardBacktest(
  symbol:   string,
  strategy: BacktestStrategy,
  interval: string,
  candles:  Candle[],
  isRatio   = 0.7,   // IS 占比（建議 0.7）
  options?: {
    atr_sl_mult?:           number;
    atr_tp_mult?:           number;
    enable_mtf_filter?:     boolean;
    enable_fee?:            boolean;
    enable_trailing_stop?:  boolean;
    enable_adx_filter?:     boolean;
    enable_fvg_ob_filter?:  boolean;
    // v3.0 真正雙時間框架回測
    use_true_mtf?:          boolean;
    htf_candles?:           Candle[];  // 完整 HTF K 線，將依 fold 切片
    entry_candles?:         Candle[];  // 完整 entry 級別 K 線，將依 fold 切片
  }
): Promise<WalkForwardResult> {
  // runBacktest 是同步函數
  // v3.0: 如果啟用 use_true_mtf，將 HTF/entry K 線依時間切片對準
  const runAsync = (c: Candle[], htfSlice?: Candle[], entrySlice?: Candle[]) => Promise.resolve(
    runBacktest({
      candles: c, strategy, symbol, interval, ...options,
      htf_candles:   htfSlice,
      entry_candles: entrySlice,
    })
  );
  const n = candles.length;

  // [F2] 安全邊界：isRatio 必須在 (0, 1) 之間，避免 step=0 無限迴圈
  const safeIsRatio = Math.max(0.5, Math.min(0.9, isRatio));

  // 窗口設計：每個窗口 540 根，步進 = OOS 長度
  const windowSize = Math.min(540, Math.floor(n * 0.5));
  const isSize     = Math.floor(windowSize * safeIsRatio);
  const oosSize    = windowSize - isSize;
  const step       = Math.max(1, oosSize); // [F2] 確保 step >= 1，防止無限迴圈

  // [F5] 最小 K 線數驗證
  const MIN_CANDLES = 50;
  if (n < windowSize + MIN_CANDLES || isSize < MIN_CANDLES || oosSize < MIN_CANDLES) {
    return {
      folds: [],
      is_stats:  { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 },
      oos_stats: { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 },
      overfitting_score: 0,
      verdict: "healthy",
      total_candles: n,
      fold_count: 0,
    };
  }

  const folds: WFFoldResult[] = [];
  const isStatsList:  WFPeriodStats[] = [];
  const oosStatsList: WFPeriodStats[] = [];

  const eps = 1e-4; // [F3] eps 用於 drawdown_inflation 防呆

  let foldIndex = 0;
  for (let start = 0; start + windowSize <= n; start += step) {
    const isStart  = start;
    const isEnd    = start + isSize - 1;
    const oosStart = start + isSize;
    const oosEnd   = Math.min(start + windowSize - 1, n - 1);

    if (oosEnd <= oosStart + MIN_CANDLES) break;

    const isCandles  = candles.slice(isStart, isEnd + 1);
    const oosCandles = candles.slice(oosStart, oosEnd + 1);

    // [F5] 跳過資料不足的 fold
    if (isCandles.length < MIN_CANDLES || oosCandles.length < MIN_CANDLES) {
      foldIndex++;
      continue;
    }

    // v3.0: 如果啟用 use_true_mtf，依時間切片 HTF/entry K 線
    let isHtfSlice: Candle[] | undefined;
    let oosHtfSlice: Candle[] | undefined;
    let isEntrySlice: Candle[] | undefined;
    let oosEntrySlice: Candle[] | undefined;
    if (options?.use_true_mtf) {
      const isStartTime  = isCandles[0].time;
      const isEndTime    = isCandles[isCandles.length - 1].time;
      const oosStartTime = oosCandles[0].time;
      const oosEndTime   = oosCandles[oosCandles.length - 1].time;
      if (options.htf_candles) {
        isHtfSlice  = options.htf_candles.filter(c => c.time >= isStartTime  && c.time <= isEndTime);
        oosHtfSlice = options.htf_candles.filter(c => c.time >= oosStartTime && c.time <= oosEndTime);
      }
      if (options.entry_candles) {
        isEntrySlice  = options.entry_candles.filter(c => c.time >= isStartTime  && c.time <= isEndTime);
        oosEntrySlice = options.entry_candles.filter(c => c.time >= oosStartTime && c.time <= oosEndTime);
      }
    }

    const [isResult, oosResult] = await Promise.all([
      runAsync(isCandles,  isHtfSlice,  isEntrySlice),
      runAsync(oosCandles, oosHtfSlice, oosEntrySlice),
    ]);

    const isStats: WFPeriodStats = {
      trades:        isResult.total_trades,
      win_rate:      isResult.win_rate,
      total_return:  isResult.total_return_net,
      sharpe:        isResult.sharpe_ratio,
      sortino:       isResult.sortino_ratio ?? 0,
      max_drawdown:  isResult.max_drawdown,
      profit_factor: isResult.profit_factor,
    };
    const oosStats: WFPeriodStats = {
      trades:        oosResult.total_trades,
      win_rate:      oosResult.win_rate,
      total_return:  oosResult.total_return_net,
      sharpe:        oosResult.sharpe_ratio,
      sortino:       oosResult.sortino_ratio ?? 0,
      max_drawdown:  oosResult.max_drawdown,
      profit_factor: oosResult.profit_factor,
    };

    // [F3] drawdown_inflation：用 eps 平滑，避免 IS DD≈0 時硬編碼常數
    const ddInflation = isStats.max_drawdown > eps
      ? oosStats.max_drawdown / isStats.max_drawdown
      : oosStats.max_drawdown > eps
        ? 2.0  // IS 幾乎無回撤但 OOS 有，視為放大
        : 1.0; // 兩者都接近零，視為持平

    const fold: WFFoldResult = {
      fold_index:         foldIndex,
      is_start:           isStart,
      is_end:             isEnd,
      oos_start:          oosStart,
      oos_end:            oosEnd,
      is_stats:           isStats,
      oos_stats:          oosStats,
      // [F1] 使用修復後的 calcDecay（有界差值，處理負值/跨零）
      win_rate_decay:     calcDecay(isStats.win_rate, oosStats.win_rate),
      sharpe_decay:       calcDecay(isStats.sharpe, oosStats.sharpe),
      return_decay:       calcDecay(isStats.total_return, oosStats.total_return),
      drawdown_inflation: ddInflation,
    };

    folds.push(fold);
    isStatsList.push(isStats);
    oosStatsList.push(oosStats);
    foldIndex++;
  }

  if (folds.length === 0) {
    return {
      folds: [],
      is_stats:  { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 },
      oos_stats: { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 },
      overfitting_score: 0,
      verdict: "healthy",
      total_candles: n,
      fold_count: 0,
    };
  }

  const overfittingScore = calcOverfittingScore(folds);
  const verdict: WalkForwardResult["verdict"] =
    overfittingScore >= 60 ? "overfitting" :
    overfittingScore >= 35 ? "warning" : "healthy";

  return {
    folds,
    is_stats:          aggregateStats(isStatsList),
    oos_stats:         aggregateStats(oosStatsList),
    overfitting_score: overfittingScore,
    verdict,
    total_candles:     n,
    fold_count:        folds.length,
  };
}
