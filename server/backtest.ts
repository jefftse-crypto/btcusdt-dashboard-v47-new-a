/**
 * 本地回測引擎 v2.0
 * 升級項目：
 * 1. MTF 多時間框架趨勢過濾（大級別確認）
 * 2. 手續費 + 滑點計算（Taker 0.04% + 0.02% 滑點）
 * 3. 動態止盈止損（基於 Swing High/Low 和 S/R 位）
 * 4. SMC FVG/OB 進場條件整合
 * 5. ADX 震盪市過濾器（ADX < 20 時禁止趨勢策略）
 * 6. 移動止損（Trailing Stop，獲利 1R 後移至成本）
 */

import type { Candle } from "../shared/cryptoTypes";
import { fetchCandles } from "./analysis";
// 共用指標工具函數（避免重複定義）
import {
  calcSma, calcEmaArr as calcEma, calcRsiArr, calcMacdArr, calcBollingerArr,
  calcAtrArr, calcAdxArr, detectBosChoch, detectOrderBlocks, findSwingHighs, findSwingLows,
  detectFvgZones, detectLiquiditySweep, calcFibOte,
} from "./utils/indicators";
import {
  detectPaPatternsWithLevels,
  calcChanEnhanced,
  detectSmcConfirmationSetups,
} from "./utils/advancedAnalysis";

// ─────────────────────────────────────────────────────────────────────────────
// 型別定義
// ─────────────────────────────────────────────────────────────────────────────

export type BacktestStrategy =
  | "ema_cross"
  | "rsi_reversal"
  | "bollinger"
  | "macd"
  | "smc"
  | "pa"
  | "chan"
  | "liquidity_sweep"  // ★ 新增：ICT 流動性掃山策略
  | "vwap_reversion"   // ★ 新增：VWAP 偏差回歸策略
  | "composite"       // ★ 最高勝率綜合策略（SMC 30% + PA 25% + 旗波 20% + 纏論 25%）
  | "cannonball"      // ★ CannonBall：結構 + OB/FVG + Money Flow + ATR 風控
  | "hwr_model_a"     // ★ HighWinRate 模型 A：掃流動性反轉單（SMC 三部曲 + 纏論一類買賣點）
  | "hwr_model_b"     // ★ HighWinRate 模型 B：趨勢回踩延續單（4H 纏論 + 1H Fib OTE 回踩）
  | "hwr_model_c"     // ★ HighWinRate 模型 C：中樞邊界反應單（纏論中樞 + SMC 流動性 + PA 假突破）
  | "apex"            // ★ Apex 頂點策略：五層過濾（流動性清掃 + CHoCH + FVG/OTE + PA確認 + 量能）
  | "elite"           // ★ Elite 精英策略：強趨勢 + OB/FVG 回調 + 3根確認 + HTF一致 + 每日限1單
  | "hwr_model_a_elite"; // ★ HWR-A Elite：hwr_model_a + EMA趨勢過濾 + 每日限1單 + 最低RR≥2.0

export interface BacktestTrade {
  entry_time:  number;
  exit_time:   number;
  direction:   "long" | "short";
  entry_price: number;
  exit_price:  number;
  sl_price:    number;
  tp_price:    number;
  pnl:         number;
  pnl_pct:     number;
  pnl_net_pct: number;   // 扣除手續費後的淨損益
  exit_reason: "sl" | "tp" | "trailing" | "end" | "time_stop";
  fee_pct:     number;   // 本次交易手續費（雙邊）
  mtf_filter:  boolean;  // 是否通過 MTF 過濾
  entry_type?: string;   // 進場類型（FVG/OB/Standard）
  tp2_price?: number;    // ★ 改良：第二止盈位（分批平倉）
  tp2_hit?: boolean;     // ★ 改良：是否觸及第二止盈
  signal_score?: number; // ★ 改良：信號量化評分（0-10）
  pivot_sl?: boolean;    // ★ 改良：是否使用 Pivot Low 止損
}

export interface BacktestResult {
  strategy:     string;
  symbol:       string;
  interval:     string;
  total_trades: number;
  win_rate:     number;
  profit_factor: number;
  max_drawdown: number;
  total_return: number;
  total_return_net: number;  // 扣除手續費後的淨總回報
  sharpe_ratio: number;
  sortino_ratio?: number;  // ★ 新增：Sortino Ratio
  calmar_ratio?: number;   // ★ 新增：Calmar Ratio
  equity_curve: number[];
  trades:       BacktestTrade[];
  // 月份統計
  monthly_stats?: { month: string; trades: number; wins: number; win_rate: number; pnl_pct: number }[];
  // 連勝連敗
  max_win_streak?:  number;
  max_loss_streak?: number;
  // 時段分析（Asia/Europe/US）
  session_stats?: { session: string; trades: number; wins: number; win_rate: number; pnl_pct: number }[];
  // 回撤區間（equity_curve index 範圍）
  drawdown_periods?: { start: number; end: number; depth: number }[];
  // 升級功能統計
  mtf_filtered_count?: number;   // 被 MTF 過濾掉的訊號數
  total_fees_pct?: number;       // 總手續費佔比
  trailing_stop_count?: number;  // 移動止損觸發次數
  adx_filtered_count?: number;   // 被 ADX 震盪過濾的訊號數
  fvg_ob_entry_count?: number;   // FVG/OB 精準進場次數
  // v4.0 四層 MTF 共識統計
  quad_mtf_enabled?: boolean;     // 是否啟用四層 MTF 共識
  quad_consensus_stats?: {        // 共識統計
    avg_score:       number;      // 平均共識分數
    bullish_pct:     number;      // 看多共識比例
    bearish_pct:     number;      // 看空共識比例
    neutral_pct:     number;      // 中性共識比例
    full_consensus:  number;      // 四層全部一致的次數
    quad_filtered:   number;      // 四層共識過濾的信號數
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 常數設定
// ─────────────────────────────────────────────────────────────────────────────

const TAKER_FEE = 0.0004;   // 0.04% Taker 手續費
const SLIPPAGE  = 0.0002;   // 0.02% 滑點（基礎，已被動態模型取代）
const TOTAL_FEE = (TAKER_FEE + SLIPPAGE) * 2; // 雙邊（入場 + 出場）

// ★ v5.9 Opus 改良：動態滑點模型（根據幣種流動性和波動率調整）
function calcDynamicSlippage(symbol: string, atrPct: number): number {
  // 主流高流動性幣種：BTC/ETH 用 3bp，其他用 5bp
  const isHighLiquidity = /^(BTC|ETH)/.test(symbol.toUpperCase());
  const baseSlippage = isHighLiquidity ? 0.0003 : 0.0005;
  // 高波動時額外加 2bp（ATR% > 2%）
  const volatilityAddon = atrPct > 0.02 ? 0.0002 : 0;
  return baseSlippage + volatilityAddon;
}

// ─────────────────────────────────────────────────────────────────────────────
// 以上工具函數已移至 utils/indicators.ts，此處透過 import 引入

// ─────────────────────────────────────────────────────────────────────────────
// 纏論計算（精簡版，用於回測）
// ─────────────────────────────────────────────────────────────────────────────

interface ChanSignal { direction: "long" | "short" | null; reason: string }

// R6-FIX: 新增 K 線包含處理函數（總論第一步）
function mergeInclusiveCandles(candles: Candle[]): Candle[] {
  if (candles.length < 2) return [...candles];
  const merged: Candle[] = [{ ...candles[0] }];
  let trend: "up" | "down" = candles[1].high >= candles[0].high ? "up" : "down";
  for (let i = 1; i < candles.length; i++) {
    const last = merged[merged.length - 1];
    const curr = candles[i];
    const isInclusive =
      (curr.high <= last.high && curr.low >= last.low) ||
      (curr.high >= last.high && curr.low <= last.low);
    if (isInclusive) {
      if (trend === "up") {
        merged[merged.length - 1] = { ...last, high: Math.max(last.high, curr.high), low: Math.max(last.low, curr.low) };
      } else {
        merged[merged.length - 1] = { ...last, high: Math.min(last.high, curr.high), low: Math.min(last.low, curr.low) };
      }
    } else {
      trend = curr.high > last.high ? "up" : "down";
      merged.push({ ...curr });
    }
  }
  return merged;
}

function calcChanSignal(candles: Candle[]): ChanSignal {
  if (candles.length < 20) return { direction: null, reason: "資料不足" };

  // R6-FIX: 先做 K 線包含處理，再做分型偵測
  const processed = mergeInclusiveCandles(candles);

  const fractal: { idx: number; type: "top" | "bottom"; price: number }[] = [];
  for (let i = 1; i < processed.length - 1; i++) {
    const p = processed[i - 1], c = processed[i], n = processed[i + 1];
    if (c.high > p.high && c.high > n.high) fractal.push({ idx: i, type: "top", price: c.high });
    else if (c.low < p.low && c.low < n.low) fractal.push({ idx: i, type: "bottom", price: c.low });
  }
  const merged: typeof fractal = [];
  for (const f of fractal) {
    const last = merged[merged.length - 1];
    if (last && last.type === f.type) {
      if (f.type === "top" && f.price > last.price) merged[merged.length - 1] = f;
      else if (f.type === "bottom" && f.price < last.price) merged[merged.length - 1] = f;
    } else merged.push(f);
  }
  interface Bi { direction: "up" | "down"; start: number; end: number; startIdx: number; endIdx: number }
  const bis: Bi[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const a = merged[i], b = merged[i + 1];
    // R6-FIX: 分型間距至少 5（包含處理後的 K 線數）
    if (b.idx - a.idx < 5) continue;
    if (a.type === "bottom" && b.type === "top") bis.push({ direction: "up", start: a.price, end: b.price, startIdx: a.idx, endIdx: b.idx });
    else if (a.type === "top" && b.type === "bottom") bis.push({ direction: "down", start: a.price, end: b.price, startIdx: a.idx, endIdx: b.idx });
  }
  if (bis.length < 3) return { direction: null, reason: `筆數不足(${bis.length})` };

  interface Duan { direction: "up" | "down"; start: number; end: number }
  const duans: Duan[] = [];
  let i = 0;
  while (i < bis.length - 2) {
    const b0 = bis[i], b1 = bis[i + 1], b2 = bis[i + 2];
    // R6-FIX: 改為 i += 2 允許重疊偵測
    if (b0.direction === "up" && b2.direction === "up" && b2.end > b0.end && b1.end > b0.start) {
      duans.push({ direction: "up", start: b0.start, end: b2.end }); i += 2;
    } else if (b0.direction === "down" && b2.direction === "down" && b2.end < b0.end && b1.end < b0.start) {
      duans.push({ direction: "down", start: b0.start, end: b2.end }); i += 2;
    } else i++;
  }

  interface Zhongshu { top: number; bottom: number }
  const zhongshus: Zhongshu[] = [];
  for (let j = 0; j < duans.length - 2; j++) {
    const d0 = duans[j], d1 = duans[j + 1], d2 = duans[j + 2];
    const top = Math.min(Math.max(d0.start, d0.end), Math.max(d1.start, d1.end), Math.max(d2.start, d2.end));
    const bottom = Math.max(Math.min(d0.start, d0.end), Math.min(d1.start, d1.end), Math.min(d2.start, d2.end));
    if (top > bottom) zhongshus.push({ top, bottom });
  }

  const lastDuan = duans[duans.length - 1];
  const lastZhongshu = zhongshus[zhongshus.length - 1];
  const close = candles[candles.length - 1].close;

  if (!lastDuan) return { direction: null, reason: "無段" };

  // R6-FIX: 加入背馳判斷（MACD 面積比較）
  // 比較同方向最後兩筆的 MACD 面積
  let hasDivergence = false;
  if (bis.length >= 4) {
    const sameDir = bis.filter((_, idx) => idx % 2 === bis.length % 2);
    if (sameDir.length >= 2) {
      const d1 = sameDir[sameDir.length - 2];
      const d2 = sameDir[sameDir.length - 1];
      const amp1 = Math.abs(d1.end - d1.start);
      const amp2 = Math.abs(d2.end - d2.start);
      // 第二筆幅度小於第一筆 80% 就算背馳
      if (amp2 < amp1 * 0.8) hasDivergence = true;
    }
  }

  if (lastDuan.direction === "up") {
    if (lastZhongshu && close > lastZhongshu.top) {
      return { direction: "long", reason: `上升段突破中樞頂(${lastZhongshu.top.toFixed(0)})` };
    }
    // R6-FIX: 第一類買點：上升趨勢背馳（价格创新高但力度衰減）
    if (hasDivergence && lastDuan.direction === "up") {
      return { direction: "short", reason: `上升段背馳（第一類賣點）` };
    }
    if (!lastZhongshu) return { direction: "long", reason: "上升段無中樞阻力" };
  } else if (lastDuan.direction === "down") {
    if (lastZhongshu && close < lastZhongshu.bottom) {
      return { direction: "short", reason: `下降段跌破中樞底(${lastZhongshu.bottom.toFixed(0)})` };
    }
    // R6-FIX: 第一類買點：下降趨勢背馳（价格创新低但力度衰減）
    if (hasDivergence && lastDuan.direction === "down") {
      return { direction: "long", reason: `下降段背馳（第一類買點）` };
    }
    if (!lastZhongshu) return { direction: "short", reason: "下降段無中樞支撑" };
  }
  return { direction: null, reason: "無明確總論訊號" };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ v5.9 Opus 改良：市況分類器（Market Regime Detector）
// 識別四種市況：trending（趨勢）/ ranging（震盪）/ compressed（壓縮）/ chaotic（混沌）
// 用於動態調整策略權重和共識門檻
// ─────────────────────────────────────────────────────────────────────────────

export type MarketRegime = "trending" | "ranging" | "compressed" | "chaotic";

export function detectRegime(candles: Candle[]): MarketRegime {
  if (candles.length < 50) return "chaotic";
  const closes = candles.slice(-50).map(c => c.close);
  const highs   = candles.slice(-50).map(c => c.high);
  const lows    = candles.slice(-50).map(c => c.low);

  // ADX：趨勢強度
  const adxResult = calcAdxArr(candles.slice(-60));
  const adxVals   = adxResult.adx.filter(v => !isNaN(v));
  const adx       = adxVals.length > 0 ? adxVals[adxVals.length - 1] : 0;

  // ATR：波動率（相對於價格的百分比）
  const atrVals = calcAtrArr(candles.slice(-30), 14).filter(v => !isNaN(v));
  const atr     = atrVals.length > 0 ? atrVals[atrVals.length - 1] : 0;
  const price   = closes[closes.length - 1];
  const atrPct  = price > 0 ? atr / price : 0;

  // BB 寬度（Bandwidth）：壓縮程度
  const bbArr = calcBollingerArr(closes, 20, 2);
  const bbReady = bbArr.filter(b => b.is_ready);
  let bbWidth = 0;
  if (bbReady.length > 0) {
    const lastBb = bbReady[bbReady.length - 1];
    bbWidth = lastBb.bandwidth; // bandwidth 已內建計算
  }

  // 最近 20 根 K 線的 High-Low 範圍 vs ATR（判斷是否有方向性）
  const recentHigh = Math.max(...highs.slice(-20));
  const recentLow  = Math.min(...lows.slice(-20));
  const rangeToAtr = atr > 0 ? (recentHigh - recentLow) / atr : 0;

  // 分類邏輯
  if (bbWidth < 0.02 || atrPct < 0.005) return "compressed"; // BB 極窄或波動率極低
  if (adx >= 25 && rangeToAtr >= 3)      return "trending";   // ADX 強 + 有方向性移動
  if (adx < 20 && rangeToAtr < 2.5)      return "ranging";    // ADX 弱 + 無方向性
  if (atrPct > 0.03)                      return "chaotic";    // 波動率極高
  return "ranging";
}

// 各市況下的策略適用性權重（1.0 = 正常，< 1.0 = 降權，> 1.0 = 加權）
export const REGIME_STRATEGY_WEIGHTS: Record<MarketRegime, Partial<Record<BacktestStrategy, number>>> = {
  trending: {
    ema_cross: 1.2, macd: 1.2, smc: 1.1, hwr_model_b: 1.3, chan: 1.1, composite: 1.1,
    rsi_reversal: 0.6, bollinger: 0.7, vwap_reversion: 0.7, hwr_model_a: 0.9,
  },
  ranging: {
    rsi_reversal: 1.3, bollinger: 1.3, vwap_reversion: 1.2, hwr_model_a: 1.1, hwr_model_c: 1.1,
    ema_cross: 0.6, macd: 0.7, chan: 0.8, hwr_model_b: 0.7,
  },
  compressed: {
    hwr_model_c: 1.2, bollinger: 1.1,
    ema_cross: 0.5, macd: 0.5, rsi_reversal: 0.8, smc: 0.9,
  },
  chaotic: {
    ema_cross: 0.4, macd: 0.4, rsi_reversal: 0.5, bollinger: 0.5,
    smc: 0.6, pa: 0.6, hwr_model_a: 0.7, hwr_model_b: 0.5, hwr_model_c: 0.6,
  },
};

// 動態共識門檻（根據市況調整）
export function dynamicConsensusThreshold(regime: MarketRegime): number {
  switch (regime) {
    case "trending":   return 0.35;
    case "ranging":    return 0.60;
    case "compressed": return 0.55;
    case "chaotic":    return 0.75;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ v5.9 Opus 改良：策略相關性矩陣（去除假共識）
// 高相關策略同時觸發不等於兩個獨立信號
// ─────────────────────────────────────────────────────────────────────────────

const STRATEGY_CORRELATION_GROUPS: Record<string, BacktestStrategy[]> = {
  momentum:    ["ema_cross", "macd"],
  structure:   ["hwr_model_a", "hwr_model_b", "hwr_model_c", "smc"],
  oscillator:  ["rsi_reversal", "bollinger"],
  price_action:["pa", "chan"],
  other:       ["vwap_reversion", "liquidity_sweep", "composite"],
};

export function effectiveSignalCount(strategies: BacktestStrategy[]): number {
  const stratSet = new Set(strategies);
  let effectiveCount = 0;
  const counted = new Set<string>();
  for (const [group, members] of Object.entries(STRATEGY_CORRELATION_GROUPS)) {
    const matched = members.filter(m => stratSet.has(m));
    if (matched.length > 0 && !counted.has(group)) {
      effectiveCount += group === "structure" ? 1.5 : 1.0;
      counted.add(group);
    }
  }
  for (const s of strategies) {
    const inGroup = Object.values(STRATEGY_CORRELATION_GROUPS).some(g => g.includes(s));
    if (!inGroup) effectiveCount += 1.0;
  }
  return effectiveCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ v5.9 Opus 改良：信號評分標準化（z-score + sigmoid）
// 各策略評分尺度不同，需標準化後才能跨策略比較
// ─────────────────────────────────────────────────────────────────────────────

const _scoreHistory = new Map<string, number[]>();

export function trackAndNormalizeScore(strategy: string, rawScore: number): number {
  const hist = _scoreHistory.get(strategy) ?? [];
  hist.push(rawScore);
  if (hist.length > 100) hist.shift();
  _scoreHistory.set(strategy, hist);
  if (hist.length < 5) return rawScore / 10;
  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  const std  = Math.sqrt(hist.reduce((s, v) => s + (v - mean) ** 2, 0) / hist.length);
  if (std < 0.01) return 0.5;
  const z = (rawScore - mean) / std;
  return 1 / (1 + Math.exp(-z)); // sigmoid 映射到 0~1
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 新增：MTF 趨勢過濾
// 判斷大級別（2倍時間框架）趨勢是否與訊號方向一致
// ─────────────────────────────────────────────────────────────────────────────

interface MtfTrend {
  direction: "bullish" | "bearish" | "neutral";
  ema20_above_ema50: boolean;
  price_above_ema200: boolean;
  adx: number;
}

function calcMtfTrend(candles: Candle[]): MtfTrend {
  // ★ 修復：EMA200 需要至少 220 根資料，不足時不將 EMA200 納入方向判斷
  if (candles.length < 50) return { direction: "neutral", ema20_above_ema50: false, price_above_ema200: false, adx: 0 };
  const closes = candles.map(c => c.close);
  const close = closes[closes.length - 1];
  const ema20Arr = calcEma(closes, 20);
  const ema50Arr = calcEma(closes, 50);
  const ema20 = ema20Arr.filter(v => !isNaN(v)).pop() ?? close;
  const ema50 = ema50Arr.filter(v => !isNaN(v)).pop() ?? close;
  const hasEma200 = candles.length >= 220;
  const ema200Raw = hasEma200 ? calcEma(closes, 200).filter(v => !isNaN(v)).pop() : undefined;
  const adxResult = calcAdxArr(candles);
  const adx = adxResult.adx.filter(v => !isNaN(v)).pop() ?? 0;
  const ema20AboveEma50 = ema20 > ema50;
  const priceAboveEma200 = hasEma200 && ema200Raw !== undefined ? close > ema200Raw : null;

  // ★ v5.8 改良：加入 RSI 和 MACD 動能確認，讓共識計算更精確
  const rsiArr = calcRsiArr(closes, 14);
  const rsi = rsiArr.filter(v => !isNaN(v)).pop() ?? 50;
  const { hist: macdHistArr } = calcMacdArr(closes);
  const lastMacdHist = macdHistArr.filter(v => !isNaN(v)).pop() ?? 0;

  // RSI 動能強化：RSI > 55 為偰多，< 45 為偰空
  const rsiBullish = rsi > 55;
  const rsiBearish = rsi < 45;
  // MACD 動能強化：Histogram > 0 為偰多，< 0 為偰空
  const macdBullish = lastMacdHist > 0;
  const macdBearish = lastMacdHist < 0;

  // ADX < 20 時市場處於震盪狀態，強制返回 neutral
  if (adx < 20) {
    return { direction: "neutral", ema20_above_ema50: ema20AboveEma50, price_above_ema200: priceAboveEma200 ?? false, adx };
  }
  let direction: "bullish" | "bearish" | "neutral";
  // ★ v5.8：綜合 EMA + RSI + MACD 三项指標判斷方向
  const emaDir = priceAboveEma200 === null
    ? (ema20AboveEma50 ? 1 : -1)
    : (ema20AboveEma50 && priceAboveEma200 ? 1 : !ema20AboveEma50 && !priceAboveEma200 ? -1 : 0);
  const rsiDir   = rsiBullish ? 1 : rsiBearish ? -1 : 0;
  const macdDir  = macdBullish ? 1 : macdBearish ? -1 : 0;
  // 三項指標加權投票：EMA 權重 50%，RSI 30%，MACD 20%
  const compositeScore = emaDir * 0.5 + rsiDir * 0.3 + macdDir * 0.2;
  direction = compositeScore >= 0.3 ? "bullish" : compositeScore <= -0.3 ? "bearish" : "neutral";
  return { direction, ema20_above_ema50: ema20AboveEma50, price_above_ema200: priceAboveEma200 ?? false, adx };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ v4.0 四層 MTF 共識系統
// 架構：4H（定大方向）→ 1H（確認中期趨勢）→ 15m（找進場結構）→ 5m（精確進場時機）
// 加權：4H=40%, 1H=30%, 15m=20%, 5m=10%
// ─────────────────────────────────────────────────────────────────────────────

export interface MtfLayerResult {
  timeframe:  string;           // 時間框架標籤（如 "4H"）
  direction:  "bullish" | "bearish" | "neutral"; // 趨勢方向
  weight:     number;           // 加權比例（0-1）
  score:      number;           // 加權後分數（-weight ~ +weight）
  adx:        number;           // ADX 值
  ema_aligned: boolean;         // EMA20 > EMA50
}

export interface MtfConsensusResult {
  layers:          MtfLayerResult[];  // 四層各自結果
  consensus_score: number;            // 綜合共識分數（-1 ~ +1）
  consensus_dir:   "bullish" | "bearish" | "neutral"; // 最終共識方向
  bullish_layers:  number;            // 看多層數
  bearish_layers:  number;            // 看空層數
  neutral_layers:  number;            // 中性層數
  passed:          boolean;           // 是否通過共識門檻（|score| >= 0.5）
}

// 四層 MTF 加權設定
const MTF_LAYER_WEIGHTS: Record<string, number> = {
  "4H":  0.40,  // 最高權重：大方向決定性
  "1H":  0.30,  // 中期趨勢確認
  "15m": 0.20,  // 進場結構確認
  "5m":  0.10,  // 精確時機（最低權重）
};

// 計算單一時間框架的趨勢方向（帶加權分數）
function calcMtfLayer(candles: Candle[], timeframe: string): MtfLayerResult {
  const weight = MTF_LAYER_WEIGHTS[timeframe] ?? 0.25;
  if (candles.length < 50) {
    return { timeframe, direction: "neutral", weight, score: 0, adx: 0, ema_aligned: false };
  }
  const trend = calcMtfTrend(candles);
  const score = trend.direction === "bullish" ? weight
    : trend.direction === "bearish" ? -weight
    : 0;
  return {
    timeframe,
    direction: trend.direction,
    weight,
    score,
    adx: trend.adx,
    ema_aligned: trend.ema20_above_ema50,
  };
}

// 計算四層 MTF 共識（核心函數）
// 傳入各時間框架的 K 線，計算加權共識方向
function calcMtfConsensus(
  candles4h:  Candle[] | null,
  candles1h:  Candle[] | null,
  candles15m: Candle[] | null,
  candles5m:  Candle[] | null,
  currentTime: number,
  minPassScore = 0.5,  // 通過門檻：共識分數 >= 0.5 才觸發
): MtfConsensusResult {
  const filterByTime = (c: Candle[] | null) =>
    c ? c.filter(x => x.time <= currentTime) : null;

  const layers: MtfLayerResult[] = [
    calcMtfLayer(filterByTime(candles4h)  ?? [], "4H"),
    calcMtfLayer(filterByTime(candles1h)  ?? [], "1H"),
    calcMtfLayer(filterByTime(candles15m) ?? [], "15m"),
    calcMtfLayer(filterByTime(candles5m)  ?? [], "5m"),
  ];

  const consensusScore = layers.reduce((sum, l) => sum + l.score, 0);
  const bullishLayers  = layers.filter(l => l.direction === "bullish").length;
  const bearishLayers  = layers.filter(l => l.direction === "bearish").length;
  const neutralLayers  = layers.filter(l => l.direction === "neutral").length;

  // 共識方向：加權分數決定
  const consensusDir: "bullish" | "bearish" | "neutral" =
    consensusScore >= minPassScore  ? "bullish"
    : consensusScore <= -minPassScore ? "bearish"
    : "neutral";

  // v5.9 改良：4H 方向一票否決機制，且加入時間對齊確認
  const h4Layer  = layers.find(l => l.timeframe === "4H");
  const h1Layer  = layers.find(l => l.timeframe === "1H");
  // 4H 一票否決：如果 4H 方向明確且與共識相反，則不通過
  const h4Veto = h4Layer && h4Layer.direction !== "neutral" && h4Layer.direction !== consensusDir && consensusDir !== "neutral";
  // 1H 和 4H 必須同向（不允許 1H 與 4H 相反）
  const h1h4Conflict = h4Layer && h1Layer &&
    h4Layer.direction !== "neutral" && h1Layer.direction !== "neutral" &&
    h4Layer.direction !== h1Layer.direction;
  const passed = Math.abs(consensusScore) >= minPassScore && !h4Veto && !h1h4Conflict;

  return { layers, consensus_score: consensusScore, consensus_dir: consensusDir,
    bullish_layers: bullishLayers, bearish_layers: bearishLayers,
    neutral_layers: neutralLayers, passed };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 新增：SMC FVG/OB 偵測（精簡版，用於回測進場過濾）
// ─────────────────────────────────────────────────────────────────────────────

interface FvgZone { type: "bullish" | "bearish"; top: number; bottom: number; idx: number }
interface ObZone  { type: "bullish" | "bearish"; top: number; bottom: number; idx: number }

function detectFvgsSimple(candles: Candle[], lookback = 30): FvgZone[] {
  const fvgs: FvgZone[] = [];
  const start = Math.max(0, candles.length - lookback);
  // 修復：計算 ATR 作為最小 gap 門滝，過濾微型雜訊 FVG
  const atrSlice = candles.slice(Math.max(0, candles.length - 20));
  const atrVals = atrSlice.slice(1).map((c, i) => {
    const p = atrSlice[i];
    return Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  });
  const atr = atrVals.length > 0 ? atrVals.reduce((a, b) => a + b, 0) / atrVals.length : 0;
  const minGap = atr * 0.1; // 最小 0.1x ATR 的缺口才算有效 FVG
  for (let i = start + 2; i < candles.length; i++) {
    const prev = candles[i - 2], mid = candles[i - 1], curr = candles[i];
    // Bullish FVG: prev.high < curr.low（中間有缺口）
    // R6-FIX: 加入中間 K 線方向驗證（中間必須為陽線）
    const bullGap = curr.low - prev.high;
    if (bullGap > minGap && mid.close > mid.open) {
      // R6-FIX: 檢查是否已被後續 K 線填補（mitigation）
      const mitigated = candles.slice(i + 1).some(c => c.low <= prev.high);
      if (!mitigated) {
        fvgs.push({ type: "bullish", top: curr.low, bottom: prev.high, idx: i });
      }
    }
    // Bearish FVG: prev.low > curr.high
    // R6-FIX: 加入中間 K 線方向驗證（中間必須為陰線）
    const bearGap = prev.low - curr.high;
    if (bearGap > minGap && mid.close < mid.open) {
      const mitigated = candles.slice(i + 1).some(c => c.high >= prev.low);
      if (!mitigated) {
        fvgs.push({ type: "bearish", top: prev.low, bottom: curr.high, idx: i });
      }
    }
  }
  return fvgs;
}

function detectObsSimple(candles: Candle[], lookback = 30): ObZone[] {
  const obs: ObZone[] = [];
  const start = Math.max(0, candles.length - lookback);
  for (let i = start + 3; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1], pp = candles[i - 2];
    const bodyPp = Math.abs(pp.close - pp.open);
    const bodyC  = Math.abs(c.close - c.open);
    // R6-FIX: Bullish OB 需要力度確認（推動 K 線實體 > OB 實體 1.5 倍）和 mitigation 檢查
    if (pp.close < pp.open && c.close > pp.high && c.close > p.high && bodyC > bodyPp * 1.5) {
      const mitigated = candles.slice(i + 1).some(k => k.low < pp.low);
      if (!mitigated) {
        obs.push({ type: "bullish", top: pp.high, bottom: pp.low, idx: i });
      }
    }
    // R6-FIX: Bearish OB 需要力度確認和 mitigation 檢查
    if (pp.close > pp.open && c.close < pp.low && c.close < p.low && bodyC > bodyPp * 1.5) {
      const mitigated = candles.slice(i + 1).some(k => k.high > pp.high);
      if (!mitigated) {
        obs.push({ type: "bearish", top: pp.high, bottom: pp.low, idx: i });
      }
    }
  }
  return obs;
}

/** 判斷當前價格是否在 FVG 或 OB 區間內（精準進場條件） */
function checkFvgObEntry(
  candles: Candle[],
  idx: number,
  direction: "long" | "short"
): { inZone: boolean; type: string } {
  const close = candles[idx].close;
  const slice = candles.slice(Math.max(0, idx - 40), idx + 1);

  const fvgs = detectFvgsSimple(slice);
  const obs  = detectObsSimple(slice);

  if (direction === "long") {
    // 做多：價格在 Bullish FVG 或 Bullish OB 區間內（回踩）
    for (const fvg of fvgs.filter(f => f.type === "bullish")) {
      if (close >= fvg.bottom && close <= fvg.top) return { inZone: true, type: "FVG" };
    }
    for (const ob of obs.filter(o => o.type === "bullish")) {
      if (close >= ob.bottom && close <= ob.top) return { inZone: true, type: "OB" };
    }
  } else {
    // 做空：價格在 Bearish FVG 或 Bearish OB 區間內（反彈）
    for (const fvg of fvgs.filter(f => f.type === "bearish")) {
      if (close >= fvg.bottom && close <= fvg.top) return { inZone: true, type: "FVG" };
    }
    for (const ob of obs.filter(o => o.type === "bearish")) {
      if (close >= ob.bottom && close <= ob.top) return { inZone: true, type: "OB" };
    }
  }
  return { inZone: false, type: "Standard" };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 改良：Pivot Low/High 偵測（取代 Swing Low/High 絕對最低/高點）
// 邏輯：找最近一次被市場「觸碰但未跌破」的有效低點（需至少 2 根確認）
// ─────────────────────────────────────────────────────────────────────────────

function detectPivotLow(candles: Candle[], idx: number, lookback = 20, confirmBars = 2): number | null {
  const start = Math.max(confirmBars, idx - lookback);
  // 從最近往前找，找到第一個有效 Pivot Low
  for (let j = idx - confirmBars; j >= start; j--) {
    const c = candles[j];
    // 確認：左側 confirmBars 根都比它高，右側 confirmBars 根也都比它高
    let isLeft = true, isRight = true;
    for (let k = 1; k <= confirmBars; k++) {
      if (j - k >= 0 && candles[j - k].low <= c.low) { isLeft = false; break; }
    }
    for (let k = 1; k <= confirmBars; k++) {
      if (j + k <= idx && candles[j + k].low <= c.low) { isRight = false; break; }
    }
    if (isLeft && isRight) return c.low;
  }
  return null;
}

function detectPivotHigh(candles: Candle[], idx: number, lookback = 20, confirmBars = 2): number | null {
  const start = Math.max(confirmBars, idx - lookback);
  for (let j = idx - confirmBars; j >= start; j--) {
    const c = candles[j];
    let isLeft = true, isRight = true;
    for (let k = 1; k <= confirmBars; k++) {
      if (j - k >= 0 && candles[j - k].high >= c.high) { isLeft = false; break; }
    }
    for (let k = 1; k <= confirmBars; k++) {
      if (j + k <= idx && candles[j + k].high >= c.high) { isRight = false; break; }
    }
    if (isLeft && isRight) return c.high;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 改良：趨勢線斜率確認
// 找最近 2-3 個 Pivot Low，若斜率為正（上升趨勢線）且當前價在趨勢線上方，回傳 true
// ─────────────────────────────────────────────────────────────────────────────

function detectUpTrendLine(candles: Candle[], idx: number, lookback = 40): { confirmed: boolean; slope: number; pivots: number[] } {
  const pivots: { idx: number; low: number }[] = [];
  const start = Math.max(2, idx - lookback);
  for (let j = start; j <= idx - 2; j++) {
    const c = candles[j];
    if (c.low < candles[j-1].low && c.low < candles[j+1].low &&
        (j + 2 > idx || c.low < candles[j+2].low)) {
      pivots.push({ idx: j, low: c.low });
    }
  }
  if (pivots.length < 2) return { confirmed: false, slope: 0, pivots: pivots.map(p => p.low) };
  // 取最近兩個 Pivot Low
  const p1 = pivots[pivots.length - 2];
  const p2 = pivots[pivots.length - 1];
  const slope = (p2.low - p1.low) / (p2.idx - p1.idx);
  // 計算趨勢線在當前 idx 的預期值
  const trendLineValue = p2.low + slope * (idx - p2.idx);
  const currentClose = candles[idx].close;
  // 上升趨勢線：斜率為正，且當前價在趨勢線上方
  const confirmed = slope > 0 && currentClose >= trendLineValue * 0.998;
  return { confirmed, slope, pivots: pivots.map(p => p.low) };
}

function detectDownTrendLine(candles: Candle[], idx: number, lookback = 40): { confirmed: boolean; slope: number } {
  const pivots: { idx: number; high: number }[] = [];
  const start = Math.max(2, idx - lookback);
  for (let j = start; j <= idx - 2; j++) {
    const c = candles[j];
    if (c.high > candles[j-1].high && c.high > candles[j+1].high &&
        (j + 2 > idx || c.high > candles[j+2].high)) {
      pivots.push({ idx: j, high: c.high });
    }
  }
  if (pivots.length < 2) return { confirmed: false, slope: 0 };
  const p1 = pivots[pivots.length - 2];
  const p2 = pivots[pivots.length - 1];
  const slope = (p2.high - p1.high) / (p2.idx - p1.idx);
  const trendLineValue = p2.high + slope * (idx - p2.idx);
  const currentClose = candles[idx].close;
  const confirmed = slope < 0 && currentClose <= trendLineValue * 1.002;
  return { confirmed, slope };
}

function buildRecentSrLevels(
  candles: Candle[],
  idx: number,
  lookback = 80
): { price: number; type: "support" | "resistance"; strength: number; touches: number; label?: string }[] {
  const start = Math.max(2, idx - lookback);
  const rawLevels: { price: number; type: "support" | "resistance"; touches: number }[] = [];
  for (let j = start; j <= idx - 2; j++) {
    const c = candles[j];
    if (
      c.low <= candles[j - 1].low && c.low <= candles[j - 2].low &&
      c.low < candles[j + 1].low && c.low < candles[j + 2].low
    ) {
      rawLevels.push({ price: c.low, type: "support", touches: 1 });
    }
    if (
      c.high >= candles[j - 1].high && c.high >= candles[j - 2].high &&
      c.high > candles[j + 1].high && c.high > candles[j + 2].high
    ) {
      rawLevels.push({ price: c.high, type: "resistance", touches: 1 });
    }
  }

  const tolerance = (candles[idx]?.close ?? 1) * 0.0015;
  const merged: { price: number; type: "support" | "resistance"; strength: number; touches: number; label?: string }[] = [];
  for (const level of rawLevels) {
    const found = merged.find(l => l.type === level.type && Math.abs(l.price - level.price) <= tolerance);
    if (found) {
      found.price = (found.price * found.touches + level.price) / (found.touches + 1);
      found.touches += 1;
      found.strength = Math.min(5, found.touches);
    } else {
      merged.push({
        price: level.price,
        type: level.type,
        touches: 1,
        strength: 1,
        label: level.type === "support" ? "Local Support" : "Local Resistance",
      });
    }
  }

  return merged
    .sort((a, b) => b.strength - a.strength || Math.abs((candles[idx]?.close ?? 0) - a.price) - Math.abs((candles[idx]?.close ?? 0) - b.price))
    .slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 新增：動態止損止盈計算（基於 Swing High/Low）
// ─────────────────────────────────────────────────────────────────────────────

function calcDynamicSlTp(
  candles: Candle[],
  idx: number,
  direction: "long" | "short",
  atr: number,
  atrSlMult: number,
  atrTpMult: number,
  entryPrice?: number  // ★ 修復：允許傳入實際進場價（next-bar open），避免用 signal bar close 作錨點
): { sl: number; tp: number; rr: number } {
  // 若未傳入 entryPrice，退回使用 signal bar close（向後兼容）
  const ep = entryPrice ?? candles[idx].close;
  const lookback = Math.min(20, idx);
  const slice = candles.slice(idx - lookback, idx + 1);

  // 找最近的 Swing Low（做多止損）和 Swing High（做空止損）
  let swingLow  = Math.min(...slice.map(c => c.low));
  let swingHigh = Math.max(...slice.map(c => c.high));

  // 找最近的 Swing High/Low 作為止盈目標（修復：改用 swing 結構而非分位數）
  const srLookback = Math.min(50, idx);
  const srSlice = candles.slice(idx - srLookback, idx + 1);
  // 找 entry 以上的最近 swing high（阻力）
  let nearResistance = ep * 1.03;
  for (let j = srSlice.length - 2; j >= 1; j--) {
    const c = srSlice[j];
    if (c.high > ep && c.high > srSlice[j-1].high && c.high > srSlice[j+1].high) {
      nearResistance = c.high;
      break;
    }
  }
  // 找 entry 以下的最近 swing low（支撐）
  let nearSupport = ep * 0.97;
  for (let j = srSlice.length - 2; j >= 1; j--) {
    const c = srSlice[j];
    if (c.low < ep && c.low < srSlice[j-1].low && c.low < srSlice[j+1].low) {
      nearSupport = c.low;
      break;
    }
  }

  let sl: number, tp: number;

  if (direction === "long") {
    // ★ 改良 2：優先使用 Pivot Low 止損（比 Swing Low 更精確）
    const pivotLow = detectPivotLow(candles, idx, 20, 2);
    const pivotSlDist = pivotLow !== null
      ? Math.abs(ep - pivotLow) + atr * 0.5  // Pivot Low 下方 0.5 ATR 緩衝
      : Math.abs(ep - swingLow) + atr * 0.3; // 退回 Swing Low
    const atrSlDist = atr * atrSlMult;
    // 取 Pivot SL 和 ATR SL 的較小值（避免止損過寬）
    const slDist = Math.min(pivotSlDist, atrSlDist * 1.2);
    sl = ep - slDist;

    // 止盈：最近阻力位，但至少 1.5R
    const minTp = ep + slDist * 1.5;
    tp = Math.max(nearResistance, minTp);
    // 不超過 ATR * tpMult 的 2 倍
    tp = Math.min(tp, ep + atr * atrTpMult * 2);
  } else {
    // ★ 改良 2：優先使用 Pivot High 止損
    const pivotHigh = detectPivotHigh(candles, idx, 20, 2);
    const pivotSlDist = pivotHigh !== null
      ? Math.abs(pivotHigh - ep) + atr * 0.5
      : Math.abs(swingHigh - ep) + atr * 0.3;
    const atrSlDist = atr * atrSlMult;
    const slDist = Math.min(pivotSlDist, atrSlDist * 1.2);
    sl = ep + slDist;

    // 止盈：最近支撐位，但至少 1.5R
    const minTp = ep - slDist * 1.5;
    tp = Math.min(nearSupport, minTp);
    tp = Math.max(tp, ep - atr * atrTpMult * 2);
  }

  const rr = Math.abs(tp - ep) / Math.abs(sl - ep);
  return { sl, tp, rr };
}

// ─────────────────────────────────────────────────────────────────────────────
// 策略訊號函數
// ─────────────────────────────────────────────────────────────────────────────

interface Signal {
  direction: "long" | "short" | null;
  // 模型自帶 SL/TP（若存在則跳過 calcDynamicSlTp）
  custom_sl?: number;
  custom_tp?: number;
  custom_tp2?: number;
  entry_type?: string;
  score?: number;        // ★ 改良：信號量化評分（0-10）
  pivot_low?: number;    // ★ 改良：偵測到的 Pivot Low 位置（做多止損用）
  pivot_high?: number;   // ★ 改良：偵測到的 Pivot High 位置（做空止損用）
  trendline_confirmed?: boolean; // ★ 改良：是否有趨勢線支撐確認
}

function signalEmaCross(i: number, ema20: number[], ema50: number[]): Signal {
  if (i < 3 || isNaN(ema20[i]) || isNaN(ema50[i]) || isNaN(ema20[i-1]) || isNaN(ema50[i-1])) return { direction: null };
  // v5.9 改良：加入 EMA50 斜率門滝，震盪市時 EMA50 幾乎水平則不進場
  const ema50Slope = (ema50[i] - ema50[i-3]) / (ema50[i-3] || 1); // 3 根斜率
  const minSlope = 0.0003; // 0.03%，小於此則為震盪市
  // v5.9 改良：加入 spread 確認，EMA 差距需 > 0.1% 才算真正穿越
  const spread = Math.abs(ema20[i] - ema50[i]) / (ema50[i] || 1);
  if (spread < 0.001) return { direction: null }; // spread 太小則屬於震盪區
  if (ema20[i-1] <= ema50[i-1] && ema20[i] > ema50[i] && ema50Slope > minSlope) return { direction: "long" };
  if (ema20[i-1] >= ema50[i-1] && ema20[i] < ema50[i] && ema50Slope < -minSlope) return { direction: "short" };
  return { direction: null };
}

function signalRsiReversal(i: number, rsi: number[], ema50: number[], closes: number[], candles?: Candle[]): Signal {
  if (i < 2 || isNaN(rsi[i]) || isNaN(rsi[i-1]) || isNaN(rsi[i-2]) || isNaN(ema50[i])) return { direction: null };
  // v5.9 改良：等 RSI 拐頭（hook）再進場，不再接飛刀
  // 拐頭定義：RSI 曾在超賣區，且前一根已經开始回升（rsi[i-1] > rsi[i-2]）
  const wasOversold   = rsi[i-2] < 35 || rsi[i-1] < 35; // 曾經超賣
  const wasOverbought = rsi[i-2] > 65 || rsi[i-1] > 65; // 曾經超買
  // 拐頭確認：RSI 已從底部回升，且目前仍在 50 以下（不要太晚進）
  const hookUp   = wasOversold   && rsi[i] > rsi[i-1] && rsi[i-1] > rsi[i-2] && rsi[i] < 50;
  const hookDown = wasOverbought && rsi[i] < rsi[i-1] && rsi[i-1] < rsi[i-2] && rsi[i] > 50;
  // K 線形態確認：需要阳線（多）或陰線（空）
  const bullishCandle = candles ? candles[i].close > candles[i].open : true;
  const bearishCandle = candles ? candles[i].close < candles[i].open : true;
  if (hookUp   && closes[i] > ema50[i] && bullishCandle) return { direction: "long" };
  if (hookDown && closes[i] < ema50[i] && bearishCandle) return { direction: "short" };
  return { direction: null };
}

function signalBollinger(i: number, closes: number[], upper: number[], lower: number[], ema50: number[], rsi?: number[]): Signal {
  if (i < 20 || isNaN(upper[i]) || isNaN(lower[i])) return { direction: null };
  // v5.9 改良：區分 Squeeze（趨勢突破）vs Expansion（均値回歸）兩種模式
  const mid = (upper[i] + lower[i]) / 2;
  const bandwidth = (upper[i] - lower[i]) / (mid || 1) * 100;
  // 將最近 20 根的平均 bandwidth 作為基準
  let avgBw = bandwidth;
  let bwSum = 0, bwCount = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) {
    if (!isNaN(upper[j]) && !isNaN(lower[j])) {
      const m = (upper[j] + lower[j]) / 2;
      bwSum += (upper[j] - lower[j]) / (m || 1) * 100;
      bwCount++;
    }
  }
  if (bwCount > 0) avgBw = bwSum / bwCount;
  const isSqueeze = bandwidth < avgBw * 0.7; // 目前帶寬 < 平均 70%，屬於 Squeeze
  const rsiVal = rsi ? rsi[i] : 50;
  if (isSqueeze) {
    // Squeeze 模式：等待突破，價格突破帶寬後進場
    if (closes[i] > upper[i] && rsiVal > 50) return { direction: "long" };  // 向上突破
    if (closes[i] < lower[i] && rsiVal < 50) return { direction: "short" }; // 向下突破
  } else {
    // Expansion 模式：帶寬已擴展，用均値回歸逻輯
    if (closes[i] < lower[i] && rsiVal < 45) return { direction: "long" };  // 觸及下轨，回歸做多
    if (closes[i] > upper[i] && rsiVal > 55) return { direction: "short" }; // 觸及上轨，回歸做空
  }
  return { direction: null };
}

function signalMacd(i: number, hist: number[], closes: number[], ema50: number[]): Signal {
  if (i < 5 || isNaN(hist[i]) || isNaN(hist[i-1]) || isNaN(hist[i-2])) return { direction: null };
  // v5.9 改良：加入 Signal Line 交叉 + MACD 背離檢測，提前入場時機
  const crossUp   = hist[i-1] < 0 && hist[i] > 0; // 零軸穿越
  const crossDown = hist[i-1] > 0 && hist[i] < 0;
  const momentumAccelUp   = hist[i] > hist[i-1] && hist[i-1] > hist[i-2];
  const momentumAccelDown = hist[i] < hist[i-1] && hist[i-1] < hist[i-2];
  // v5.9 新增：MACD 背離檢測（價格创新高/低但 MACD Histogram 未创新高/低）
  // 找到最近 10 根內的價格最高/最低和對應的 histogram 最高/最低
  let bullDivergence = false, bearDivergence = false;
  if (i >= 10) {
    const lookback = 10;
    const priceHigh = Math.max(...closes.slice(i - lookback, i));
    const priceLow  = Math.min(...closes.slice(i - lookback, i));
    const histHigh  = Math.max(...hist.slice(i - lookback, i));
    const histLow   = Math.min(...hist.slice(i - lookback, i));
    // 看漲背離：價格创新高但 MACD Histogram 未创新高
    if (closes[i] >= priceHigh * 0.999 && hist[i] < histHigh * 0.85) bearDivergence = true;
    // 看跌背離：價格创新低但 MACD Histogram 未创新低
    if (closes[i] <= priceLow * 1.001 && hist[i] > histLow * 0.85) bullDivergence = true;
  }
  // 穿越零軸確認
  if (crossUp   && (momentumAccelUp   || hist[i] > Math.abs(hist[i-1]) * 0.5) && (!isNaN(ema50[i]) ? closes[i] > ema50[i] : true)) return { direction: "long" };
  if (crossDown && (momentumAccelDown || Math.abs(hist[i]) > Math.abs(hist[i-1]) * 0.5) && (!isNaN(ema50[i]) ? closes[i] < ema50[i] : true)) return { direction: "short" };
  // 背離信號（提前入場）
  if (bullDivergence && hist[i] > hist[i-1] && (!isNaN(ema50[i]) ? closes[i] > ema50[i] : true)) return { direction: "long" };
  if (bearDivergence && hist[i] < hist[i-1] && (!isNaN(ema50[i]) ? closes[i] < ema50[i] : true)) return { direction: "short" };
  return { direction: null };
}

function signalSmc(i: number, candles: Candle[], ema200: number[]): Signal {
  if (i < 80 || isNaN(ema200[i])) return { direction: null };

  const close = candles[i].close;
  const c = candles[i];
  const slice = candles.slice(Math.max(0, i - 140), i + 1);

  // ── HTF 趨勢方向（EMA200）──
  const htfTrend = close > ema200[i] * 1.001 ? "bullish" : close < ema200[i] * 0.999 ? "bearish" : "ranging";
  if (htfTrend === "ranging") return { direction: null }; // 無趨勢不進場

  // ── ATR 計算（用於 sweep 深度驗證）──
  const atrSlice = candles.slice(Math.max(1, i - 14), i + 1);
  const atr = atrSlice.length > 0
    ? atrSlice.reduce((sum, cc, idx2) => {
        const prevC = candles[Math.max(0, i - 14) + idx2 - 1]?.close ?? cc.close;
        return sum + Math.max(cc.high - cc.low, Math.abs(cc.high - prevC), Math.abs(cc.low - prevC));
      }, 0) / atrSlice.length
    : c.high - c.low;

  // ── SM-A: iFVG 確認（DodgysDD 方法論）──
  // FVG 必須被實體收盤穿越（iFVG），而非只是影線觸碰
  const fvgData = detectFvgZones(slice, close);
  const iFvgBull = fvgData.allBull.find(f =>
    f.filled_pct >= 0.1 && f.filled_pct < 0.85 && // 已部分進入但未完全填補
    c.close > f.bottom && c.close <= f.top &&      // 實體收盤在 FVG 區間內（iFVG 觸發）
    f.quality >= 40
  );
  const iFvgBear = fvgData.allBear.find(f =>
    f.filled_pct >= 0.1 && f.filled_pct < 0.85 &&
    c.close < f.top && c.close >= f.bottom &&
    f.quality >= 40
  );

  // ── SM-B: CHoCH 結構轉換確認 ──
  // 要求最近有 CHoCH 事件（結構已轉換），方向與 htfTrend 一致
  const bosChoch = detectBosChoch(slice);
  const recentEvents = bosChoch.events.slice(-6); // 最近 6 個結構事件
  const hasChochBull = recentEvents.some(e => e.type === "CHoCH" && e.direction === "bullish" && e.confirmed);
  const hasChochBear = recentEvents.some(e => e.type === "CHoCH" && e.direction === "bearish" && e.confirmed);
  // 也接受 BOS 延續（趨勢確認）
  const hasBosBull = recentEvents.some(e => e.type === "BOS" && e.direction === "bullish" && e.confirmed);
  const hasBosBear = recentEvents.some(e => e.type === "BOS" && e.direction === "bearish" && e.confirmed);
  const structureBull = hasChochBull || hasBosBull;
  const structureBear = hasChochBear || hasBosBear;

  // ── SM-C: 折價/溢價區過濾（均衡區間 OTE）──
  // 多頭只在折價區（price_pct < 50）進場，空頭只在溢價區（price_pct > 50）進場
  const fibData = calcFibOte(slice, close);
  // price_pct: 0 = 最低點, 100 = 最高點；< 50 為折價區，> 50 為溢價區
  const inDiscountZone = fibData !== null && fibData.price_pct < 50; // 折價區
  const inPremiumZone  = fibData !== null && fibData.price_pct > 50; // 溢價區

  // ── SM-D: CRT 假突破偵測（Romeo 蠟燭範圍理論）──
  // 偵測「誘多/誘空蠟燭」：穿越舊高/低後收盤返回結構內 + CHoCH 確認
  // detectLiquiditySweep 回傳：bslSwept（掃低點）、sslSwept（掃高點）
  const sweepData = detectLiquiditySweep(slice, close);
  const crtBull = sweepData.bslSwept &&          // 掃低點後反轉（誘空後做多）
    sweepData.bslStrength >= 50 &&
    sweepData.bslReclaimed &&                    // 收盤返回結構內
    hasChochBull;                                // 必須有 CHoCH 確認
  const crtBear = sweepData.sslSwept &&          // 掃高點後反轉（誘多後做空）
    sweepData.sslStrength >= 50 &&
    sweepData.sslReclaimed &&                    // 收盤返回結構內
    hasChochBear;

  // ── SM-E: I2E/E2I 方向模型（GXT 框架）──
  // I2E（IRL→ERL）：從 FVG 回測位置推向前高/低（趨勢延續）
  // E2I（ERL→IRL）：從前高/低掃除後回撤至 FVG（反轉）
  // 簡化實作：判斷當前是否在 IRL（FVG 附近）或 ERL（前高/低附近）
  const swingHighs = findSwingHighs(slice, 5);
  const swingLows  = findSwingLows(slice, 5);
  const nearestHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : Infinity;
  const nearestLow  = swingLows.length > 0  ? swingLows[swingLows.length - 1].price  : 0;
  // 在 IRL（FVG 區間附近）：距離最近 FVG 中點 < 0.5 ATR
  const nearBullFvg = fvgData.nearestBull ? Math.abs(close - fvgData.nearestBull.mid) < atr * 0.5 : false;
  const nearBearFvg = fvgData.nearestBear ? Math.abs(close - fvgData.nearestBear.mid) < atr * 0.5 : false;
  // I2E 多頭：在 FVG 支撐位（IRL）做多，目標前高（ERL）
  const i2eBull = nearBullFvg && htfTrend === "bullish" && close < nearestHigh * 0.98;
  // E2I 多頭：ERL 掃除後（前低被清掃）回撤至 FVG（IRL）做多
  const e2iBull = crtBull && nearBullFvg;
  // I2E 空頭：在 FVG 阻力位（IRL）做空，目標前低（ERL）
  const i2eBear = nearBearFvg && htfTrend === "bearish" && close > nearestLow * 1.02;
  // E2I 空頭：ERL 掃除後（前高被清掃）回撤至 FVG（IRL）做空
  const e2iBear = crtBear && nearBearFvg;

  // ── 原有 SMC 確認 setup（保留作為額外確認層）──
  const setups = detectSmcConfirmationSetups(slice, close, htfTrend, 10)
    .filter(setup => setup.status !== "invalidated" && setup.confluence_score >= 45 && setup.rr_ratio >= 1.3)
    .sort((a, b) => {
      const statusRank = (s: string) => s === "active" ? 3 : s === "waiting" ? 2 : s === "completed" ? 1 : 0;
      return statusRank(b.status) - statusRank(a.status) || b.confluence_score - a.confluence_score;
    });
  const best = setups.find(setup => setup.htf_aligned && (setup.status === "active" || setup.status === "waiting"))
    ?? setups.find(setup => setup.htf_aligned)
    ?? null;

  // ── 多頭進場條件 ──
  // 需要：(iFVG 觸發 OR CRT 多頭) AND CHoCH/BOS 結構確認 AND 折價區 AND (I2E 或 E2I 方向)
  const longCondition =
    (iFvgBull !== undefined || crtBull) &&   // SM-A 或 SM-D
    structureBull &&                          // SM-B
    inDiscountZone &&                         // SM-C
    (i2eBull || e2iBull) &&                  // SM-E
    close > ema200[i] * 0.995;               // EMA200 方向確認

  // ── 空頭進場條件 ──
  const shortCondition =
    (iFvgBear !== undefined || crtBear) &&
    structureBear &&
    inPremiumZone &&
    (i2eBear || e2iBear) &&
    close < ema200[i] * 1.005;

  if (!longCondition && !shortCondition) return { direction: null };

  // 計算 SL/TP（優先使用 SMC setup，否則用 ATR）
  const direction: "long" | "short" = longCondition ? "long" : "short";
  let sl: number | undefined, tp1: number | undefined, tp2: number | undefined;
  if (best && best.direction === (longCondition ? "bullish" : "bearish")) {
    sl  = best.sl  > 0 ? best.sl  : undefined;
    tp1 = best.tp1 > 0 ? best.tp1 : undefined;
    tp2 = best.tp2 > 0 ? best.tp2 : undefined;
  } else {
    // 用 ATR 計算 SL/TP
    sl  = direction === "long" ? close - atr * 1.5 : close + atr * 1.5;
    tp1 = direction === "long" ? close + atr * 2.5 : close - atr * 2.5;
    tp2 = direction === "long" ? close + atr * 4.0 : close - atr * 4.0;
  }

  // 評分：基礎分 + 各條件加分
  let score = 5.0;
  if (iFvgBull !== undefined || iFvgBear !== undefined) score += 1.5; // iFVG 確認
  if (hasChochBull || hasChochBear) score += 1.0;                     // CHoCH（比 BOS 更強）
  if (crtBull || crtBear) score += 1.0;                               // CRT 假突破
  if (e2iBull || e2iBear) score += 0.5;                               // E2I（反轉，更高勝率）
  if (best) score += Math.min(1.0, best.confluence_score / 100);       // SMC setup 加分
  score = Math.min(10, Math.round(score * 10) / 10);

  const entryType = crtBull || crtBear ? "SMC_CRT" : e2iBull || e2iBear ? "SMC_E2I" : "SMC_I2E";

  return {
    direction,
    custom_sl: sl,
    custom_tp: tp1,
    custom_tp2: tp2,
    entry_type: entryType,
    score,
  };
}

// ★ K 線形態確認函數（用於 PA 策略信號加強）
function detectCandlePattern(candles: Candle[], i: number): { bullish: number; bearish: number } {
  if (i < 2) return { bullish: 0, bearish: 0 };
  const c = candles[i], p = candles[i - 1], pp = candles[i - 2];
  const cBody = Math.abs(c.close - c.open);
  const pBody = Math.abs(p.close - p.open);
  const cRange = c.high - c.low;
  const pRange = p.high - p.low;
  let bullish = 0, bearish = 0;

  // 看漲吞噬線（Bullish Engulfing）
  if (p.close < p.open && c.close > c.open && c.open < p.close && c.close > p.open && cBody > pBody * 1.2) {
    bullish += 2;
  }
  // 看空吞噬線（Bearish Engulfing）
  if (p.close > p.open && c.close < c.open && c.open > p.close && c.close < p.open && cBody > pBody * 1.2) {
    bearish += 2;
  }
  // 锤子線（Hammer）：小實體，長下影，短上影
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  if (cBody < cRange * 0.35 && lowerWick > cBody * 2 && upperWick < cBody * 0.5) {
    bullish += 1.5;
  }
  // 流星線（Shooting Star）：小實體，長上影，短下影
  if (cBody < cRange * 0.35 && upperWick > cBody * 2 && lowerWick < cBody * 0.5) {
    bearish += 1.5;
  }
  // Pin Bar：實體小於 30%，影線長於 60%
  if (cBody < cRange * 0.3) {
    if (lowerWick > cRange * 0.6) bullish += 1;
    if (upperWick > cRange * 0.6) bearish += 1;
  }
  // 早晨之星（Morning Star）
  if (pp.close < pp.open && pBody < pRange * 0.3 && c.close > c.open && c.close > (pp.open + pp.close) / 2) {
    bullish += 2.5;
  }
  // 黄昏之星（Evening Star）
  if (pp.close > pp.open && pBody < pRange * 0.3 && c.close < c.open && c.close < (pp.open + pp.close) / 2) {
    bearish += 2.5;
  }
  return { bullish, bearish };
}

function signalPa(
  i: number,
  candles: Candle[],
  closes: number[],
  rsi: number[],
  ema20: number[],
  ema50: number[],
  ema200: number[],
  macdHist: number[],
  plusDi: number[],
  minusDi: number[]
): Signal {
  if (i < 30 || isNaN(rsi[i]) || isNaN(ema50[i]) || isNaN(ema200[i])) return { direction: null };

  const close = closes[i];
  const c = candles[i];
  const candleSpan = i > 0 ? Math.max(1, candles[i].time - candles[i - 1].time) : 900000;
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((sum, cc) => sum + cc.volume, 0) / volSlice.length : c.volume;
  const currVol = c.volume;
  const trSlice = candles.slice(Math.max(1, i - 14), i + 1);
  const atr = trSlice.length > 0
    ? trSlice.reduce((sum, cc, idx2) => {
        const prevClose = candles[Math.max(0, i - 14) + idx2 - 1]?.close ?? cc.close;
        const tr = Math.max(cc.high - cc.low, Math.abs(cc.high - prevClose), Math.abs(cc.low - prevClose));
        return sum + tr;
      }, 0) / trSlice.length
    : c.high - c.low;

  // ── PA-A: 80-20 真假突破判斷（Al Brooks 體系）──
  // 真突破特徵：體積大 + 收在極値（無影線）+ 遠離前期區間 + 有「急迫感（無回調）」
  // 假突破特徵：突破後快速返回區間內，做反向
  const cBody = Math.abs(c.close - c.open);
  const cRange = c.high - c.low;
  const cUpperWick = c.high - Math.max(c.close, c.open);
  const cLowerWick = Math.min(c.close, c.open) - c.low;
  // 真突破：實體 >= 70% K 線範圍，影線 < 15%，體積大
  const isTrueBreakout = cBody >= cRange * 0.70 &&
    (c.close > c.open ? cUpperWick < cRange * 0.15 : cLowerWick < cRange * 0.15) &&
    currVol >= avgVol * 1.5;
  // 假突破：實體 < 40%，影線長，成交量不足
  const isFakeBreakout = cBody < cRange * 0.40 &&
    (cUpperWick > cRange * 0.35 || cLowerWick > cRange * 0.35) &&
    currVol < avgVol * 1.2;

  // ── PA-B: 2ND LEG TRAP 偵測（方方土框架）──
  // 區間內現價位置 >= 85% 或 <= 15% 時，預期反向回撤
  const rangeSlice = candles.slice(Math.max(0, i - 40), i + 1);
  const rangeHigh = Math.max(...rangeSlice.map(cc => cc.high));
  const rangeLow  = Math.min(...rangeSlice.map(cc => cc.low));
  const rangeSize = rangeHigh - rangeLow;
  const pricePosition = rangeSize > 0 ? (close - rangeLow) / rangeSize : 0.5;
  // 接近頂部（溢價區）：做空陳局
  const nearRangeTop    = pricePosition >= 0.85;
  // 接近底部（折價區）：做多陳局
  const nearRangeBottom = pricePosition <= 0.15;
  // 第二段陷阱：區間高度 > 1 ATR（確認是區間而非趨勢）
  // 放寬條件：atr*1.0 ~ atr*12（原為 1.5~8，增加 2ND LEG TRAP 觸發機會）
  const isRangeMarket = rangeSize > atr * 1.0 && rangeSize < atr * 12;

  // ── 原有 PA 形態偵測與 SR 位準──
  const srLevels = buildRecentSrLevels(candles, i, 90);
  if (srLevels.length === 0) return { direction: null };

  const patterns = detectPaPatternsWithLevels(
    candles.slice(Math.max(0, i - 90), i + 1),
    srLevels,
    "15m",
    atr || Math.abs(c.high - c.low)
  );
  const recentPatterns = patterns.filter(p => Math.abs(candles[i].time - p.time) <= candleSpan * 2);
  const best = recentPatterns[0] ?? null;

  const upTrend = detectUpTrendLine(candles, i, 40);
  const downTrend = detectDownTrendLine(candles, i, 40);
  const volConfirmed = avgVol > 0 ? currVol >= avgVol * 1.15 : true;
  const bullishMomentum = rsi[i] >= 48 &&
    (isNaN(macdHist[i]) || macdHist[i] >= (macdHist[i - 1] ?? macdHist[i])) &&
    (!isNaN(plusDi[i]) && !isNaN(minusDi[i]) ? plusDi[i] >= minusDi[i] * 0.9 : true);
  const bearishMomentum = rsi[i] <= 52 &&
    (isNaN(macdHist[i]) || macdHist[i] <= (macdHist[i - 1] ?? macdHist[i])) &&
    (!isNaN(plusDi[i]) && !isNaN(minusDi[i]) ? minusDi[i] >= plusDi[i] * 0.9 : true);

  // ── PA-C: Measured Move 目標計算 ──
  // 用前一段波動幅度估算目標位（替代固定 ATR 倍數 TP）
  function calcMeasuredMoveTP(dir: "long" | "short"): number {
    // 找前一次明顯波動的幅度（最近 20~60 根內的最高距最低）
    const lookbackSlice = candles.slice(Math.max(0, i - 60), i);
    if (lookbackSlice.length < 10) return dir === "long" ? close + atr * 2.5 : close - atr * 2.5;
    const prevHigh = Math.max(...lookbackSlice.map(cc => cc.high));
    const prevLow  = Math.min(...lookbackSlice.map(cc => cc.low));
    const prevMove = prevHigh - prevLow;
    // Measured Move：目標 = 当前價格 ± 前一段幅度
    return dir === "long" ? close + prevMove * 0.618 : close - prevMove * 0.618;
  }

  // ── 多頭進場條件判斷 ──
  // 情況 1：形態引發（原有邏輯）+ 真突破加分
  const paLong = best &&
    best.pattern.type === "bullish" &&
    best.at_key_level &&
    best.confluence_score >= 55 &&
    close >= ema50[i] * 0.998 &&
    close >= ema200[i] * 0.995 &&
    bullishMomentum &&
    (volConfirmed || upTrend.confirmed);

  // 情況 2：2ND LEG TRAP 引發（區間底部假突破做多）
  const trapLong = isRangeMarket &&
    nearRangeBottom &&
    isFakeBreakout &&
    c.close > c.open && // 收陰線返回（假突破後反射）
    close >= ema200[i] * 0.995 &&
    bullishMomentum;

  if (paLong || trapLong) {
    const tp = trapLong ? calcMeasuredMoveTP("long") : best!.tp;
    const sl = trapLong ? (rangeLow - atr * 0.3) : best!.sl;
    const baseScore = best ? Math.round((best.confluence_score / 10) * 10) / 10 : 6.0;
    const bonus = isTrueBreakout ? 1.0 : trapLong ? 0.8 : 0;
    // ★ 方案四：RSI bullish divergence 加分（RSI 下降但價格上升 = 潛在反轉）
    const rsiDivBonus = (i >= 5 && rsi[i] < rsi[i - 5] && close > closes[i - 5]) ? 0.5 : 0;
    return {
      direction: "long",
      custom_sl: sl,
      custom_tp: tp,
      score: Math.min(10, baseScore + bonus + rsiDivBonus),
      pivot_low: detectPivotLow(candles, i, 20, 2) ?? undefined,
      trendline_confirmed: upTrend.confirmed,
      entry_type: trapLong ? "PA_2ND_LEG_TRAP" : isTrueBreakout ? "PA_TRUE_BREAKOUT" : "PA_PATTERN",
    };
  }

  // ── 空頭進場條件判斷（★ 方案四：加嚴做空信號，要求 EMA50 下行斜率確認） ──
  // ★ 方案四：做空額外要求 EMA50 必須連續 3 根下行，確認趨勢方向
  const ema50Slope3 = i >= 3 ? ema50[i] - ema50[i - 3] : 0;
  const ema50Declining = ema50Slope3 < 0;
  const paShort = best &&
    best.pattern.type === "bearish" &&
    best.at_key_level &&
    best.confluence_score >= 55 &&
    close <= ema50[i] * 1.002 &&
    close <= ema200[i] * 1.005 &&
    bearishMomentum &&
    ema50Declining &&  // ★ 方案四：必須 EMA50 下行
    (volConfirmed || downTrend.confirmed);

  const trapShort = isRangeMarket &&
    nearRangeTop &&
    isFakeBreakout &&
    c.close < c.open && // 收陰線返回
    close <= ema200[i] * 1.005 &&
    bearishMomentum &&
    ema50Declining;  // ★ 方案四：2ND LEG TRAP 做空也要求 EMA50 下行

  if (paShort || trapShort) {
    const tp = trapShort ? calcMeasuredMoveTP("short") : best!.tp;
    const sl = trapShort ? (rangeHigh + atr * 0.3) : best!.sl;
    const baseScore = best ? Math.round((best.confluence_score / 10) * 10) / 10 : 6.0;
    const bonus = isTrueBreakout ? 1.0 : trapShort ? 0.8 : 0;
    // ★ 方案四：RSI 背離加分（RSI 上升但價格下降 = bearish divergence）
    const rsiDivBonus = (i >= 5 && rsi[i] > rsi[i - 5] && close < closes[i - 5]) ? 0.5 : 0;
    return {
      direction: "short",
      custom_sl: sl,
      custom_tp: tp,
      score: Math.min(10, baseScore + bonus + rsiDivBonus),
      pivot_high: detectPivotHigh(candles, i, 20, 2) ?? undefined,
      trendline_confirmed: downTrend.confirmed,
      entry_type: trapShort ? "PA_2ND_LEG_TRAP" : isTrueBreakout ? "PA_TRUE_BREAKOUT" : "PA_PATTERN",
    };
  }

  return { direction: null };
}

function signalChan(i: number, candles: Candle[]): Signal {
  if (i < 80) return { direction: null };

  const close = candles[i].close;
  const candleSpan = i > 0 ? Math.max(1, candles[i].time - candles[i - 1].time) : 900000;
  const slice = candles.slice(Math.max(0, i - 260), i + 1);
  const result = calcChanEnhanced(slice, close, 220);

  // ── ATR 計算 ──
  const atrSlice = candles.slice(Math.max(1, i - 14), i + 1);
  const atr = atrSlice.length > 0
    ? atrSlice.reduce((sum, cc, idx2) => {
        const prevC = candles[Math.max(0, i - 14) + idx2 - 1]?.close ?? cc.close;
        return sum + Math.max(cc.high - cc.low, Math.abs(cc.high - prevC), Math.abs(cc.low - prevC));
      }, 0) / atrSlice.length
    : candles[i].high - candles[i].low;

  // ── CH-A: IRL/ERL 位置確認（I2E/E2I 模型）──
  // IRL（Internal Range Liquidity）：中樞內部，FVG 區域，回踩位
  // ERL（External Range Liquidity）：中樞外部，前高/低，清掃目標
  // 策略：中樞突破後（ERL 達成），等待回踩至 IRL（FVG/中樞頂底）再進場
  const fvgData = detectFvgZones(slice, close);
  const zh = result.current_zhongshu;

  // 判斷是否在 IRL（中樞頂底附近 或 FVG 區域附近）
  const nearZhTop    = zh ? Math.abs(close - zh.top)    < atr * 0.5 : false;
  const nearZhBottom = zh ? Math.abs(close - zh.bottom) < atr * 0.5 : false;
  const nearBullFvg  = fvgData.nearestBull ? Math.abs(close - fvgData.nearestBull.mid) < atr * 0.6 : false;
  const nearBearFvg  = fvgData.nearestBear ? Math.abs(close - fvgData.nearestBear.mid) < atr * 0.6 : false;
  const inIrlBull = nearZhBottom || nearBullFvg; // 在 IRL 支撐位
  const inIrlBear = nearZhTop    || nearBearFvg; // 在 IRL 阻力位

  // ── CH-B: OTE 最佳交易區間過濾（Fibonacci 62%~79%）──
  // 中樞突破後的回踩必須落在 OTE 區間，才是最佳進場機會
  const fibData = calcFibOte(slice, close);
  // calcFibOte 回傳的 price_pct: 0 = swing_low, 100 = swing_high
  // 多頭 OTE：在折價區（price_pct <= 38.2）進場
  // 空頭 OTE：在溢價區（price_pct >= 61.8）進場
  const inOteBull = fibData !== null && fibData.price_pct <= 38.2; // 深度回踩區（多頭 OTE）
  const inOteBear = fibData !== null && fibData.price_pct >= 61.8; // 深度回踩區（空頭 OTE）

  // ── 第一類/第三類買賣點（原有邏輯）+ IRL/OTE 改為硬性條件──
  const latestPoint = (result.buy_sell_points ?? [])
    .filter(point => Math.abs(close - point.price) / close <= 0.03)
    .sort((a, b) => b.time - a.time)[0];

  if (latestPoint && Math.abs(candles[i].time - latestPoint.time) <= candleSpan * 8) {
    if (latestPoint.direction === "buy" && (latestPoint.divergence_confirmed || latestPoint.level >= 2) && result.trend !== "bearish") {
      // CH-A/B 硬性條件：IRL 或 OTE 至少滿足一個才進場
      if (!inIrlBull && !inOteBull) return { direction: null };
      const irlBonus = inIrlBull ? 1.5 : 0;
      const oteBonus = inOteBull ? 1.0 : 0;
      const baseScore = latestPoint.level + (latestPoint.divergence_confirmed ? 1 : 0);
      return {
        direction: "long",
        score: Math.min(10, baseScore + irlBonus + oteBonus),
        entry_type: inIrlBull ? "CHAN_I2E" : "CHAN_OTE",
      };
    }
    if (latestPoint.direction === "sell" && (latestPoint.divergence_confirmed || latestPoint.level >= 2) && result.trend !== "bullish") {
      // CH-A/B 硬性條件：IRL 或 OTE 至少滿足一個才進場
      if (!inIrlBear && !inOteBear) return { direction: null };
      const irlBonus = inIrlBear ? 1.5 : 0;
      const oteBonus = inOteBear ? 1.0 : 0;
      const baseScore = latestPoint.level + (latestPoint.divergence_confirmed ? 1 : 0);
      return {
        direction: "short",
        score: Math.min(10, baseScore + irlBonus + oteBonus),
        entry_type: inIrlBear ? "CHAN_I2E" : "CHAN_OTE",
      };
    }
  }

  // ── 中樞突破後回踩進場（原有邏輯）+ OTE/IRL 硬性過濾──
  if (zh && !result.in_zhongshu) {
    if (result.trend === "bullish" && close > zh.top * 1.002 && result.divergence_signals?.type !== "top") {
      // 硬性條件：中樞突破後必須在 IRL 或 OTE 區間才進場
      if (!inIrlBull && !inOteBull) return { direction: null };
      const oteBonus = inOteBull ? 1.0 : 0;
      const irlBonus = inIrlBull ? 1.0 : 0;
      return { direction: "long", score: 6.5 + oteBonus + irlBonus, entry_type: "CHAN_ZH_BREAK" };
    }
    if (result.trend === "bearish" && close < zh.bottom * 0.998 && result.divergence_signals?.type !== "bottom") {
      if (!inIrlBear && !inOteBear) return { direction: null };
      const oteBonus = inOteBear ? 1.0 : 0;
      const irlBonus = inIrlBear ? 1.0 : 0;
      return { direction: "short", score: 6.5 + oteBonus + irlBonus, entry_type: "CHAN_ZH_BREAK" };
    }
  }

  return { direction: null };
}


/**
 * ★ 新增策略：Liquidity Sweep（流動性掃山）
 * ICT 核心概念：市場先向上/下掃山止損單後反向展開
 * 進場條件：穿越前一根 swing high/low + 收盤返回結構內 + EMA200 方向確認
 */
function signalLiquiditySweep(
  i: number,
  candles: Candle[],
  atrArr: number[],
  ema200: number[]
): Signal {
  if (i < 20 || isNaN(atrArr[i]) || isNaN(ema200[i])) return { direction: null };
  const atr = atrArr[i];
  const c = candles[i];

  // 識別最近的 swing high 和 swing low（左右各 3 根確認）
  let swingHigh = -Infinity, swingLow = Infinity;
  for (let j = i - 15; j <= i - 3; j++) {
    if (j < 2) continue;
    const cj = candles[j];
    if (cj.high > candles[j-1].high && cj.high > candles[j-2].high &&
        cj.high > candles[j+1].high && cj.high > candles[j+2].high) {
      if (cj.high > swingHigh) swingHigh = cj.high;
    }
    if (cj.low < candles[j-1].low && cj.low < candles[j-2].low &&
        cj.low < candles[j+1].low && cj.low < candles[j+2].low) {
      if (cj.low < swingLow) swingLow = cj.low;
    }
  }
  if (swingHigh === -Infinity || swingLow === Infinity) return { direction: null };

  // Liquidity Sweep 多頭：尾巴穿越 swing low 且收盤返回（掃山後反展）
  const sweepLow  = c.low < swingLow - atr * 0.1 && c.close > swingLow && c.close > c.open;
  // Liquidity Sweep 空頭：尾巴穿越 swing high 且收盤返回
  const sweepHigh = c.high > swingHigh + atr * 0.1 && c.close < swingHigh && c.close < c.open;

  if (sweepLow  && c.close > ema200[i]) return { direction: "long" };
  if (sweepHigh && c.close < ema200[i]) return { direction: "short" };
  return { direction: null };
}

/**
 * ★ 新增策略：VWAP 偏差回歸（VWAP Deviation Reversion）
 * 當價格偏離 VWAP 超過 2 個標準差時，預期回歸至 VWAP
 * 適合震盪市場，需配合 ADX < 25 過濾
 */
function signalVwapReversion(
  i: number,
  candles: Candle[],
  atrArr: number[],
  adxArr: number[]
): Signal {
  if (i < 20 || isNaN(atrArr[i]) || isNaN(adxArr[i])) return { direction: null };

  // 只在震盪市場使用（ADX < 25）
  if (adxArr[i] >= 25) return { direction: null };

  // v5.9 改良：根據 K 線數量動態推斷 interval，計算正確的 session 長度
  // 推斷邏輯：如果 candles 數量多，則為較小的 interval
  const totalCandles = candles.length;
  // 根據常見交易時段推斷 session 長度
  // 1m: 1440 根/天, 5m: 288, 15m: 96, 1h: 24, 4h: 6
  let sessionLen = 24; // 預設 1h 的 session
  if (totalCandles > 1000) sessionLen = 1440;      // 1m
  else if (totalCandles > 500) sessionLen = 288;   // 5m
  else if (totalCandles > 200) sessionLen = 96;    // 15m
  else if (totalCandles > 100) sessionLen = 24;    // 1h
  else sessionLen = 6;                              // 4h
  const sessionStart = Math.max(0, i - sessionLen + 1);
  let cumPV = 0, cumVol = 0;
  for (let j = sessionStart; j <= i; j++) {
    const typical = (candles[j].high + candles[j].low + candles[j].close) / 3;
    const vol = candles[j].volume ?? 1;
    cumPV += typical * vol;
    cumVol += vol;
  }
  const vwap = cumVol > 0 ? cumPV / cumVol : candles[i].close;

  // 計算 VWAP 標準差
  const prices = candles.slice(sessionStart, i + 1).map(c => (c.high + c.low + c.close) / 3);
  const variance = prices.reduce((sum, p) => sum + (p - vwap) ** 2, 0) / prices.length;
  const stdDev = Math.sqrt(variance) || atrArr[i];

  const close = candles[i].close;
  const zScore = (close - vwap) / stdDev;

  // v5.9 改良：加入 VWAP 斜率過濾，避免在強勢趨勢中逆勢操作
  let vwapSlope = 0;
  if (sessionStart + 5 <= i) {
    // 計算前 5 根的 VWAP 作為比較基準
    let prevCumPV = 0, prevCumVol = 0;
    for (let j = sessionStart; j <= i - 5; j++) {
      const typical = (candles[j].high + candles[j].low + candles[j].close) / 3;
      const vol = candles[j].volume ?? 1;
      prevCumPV += typical * vol;
      prevCumVol += vol;
    }
    const prevVwap = prevCumVol > 0 ? prevCumPV / prevCumVol : vwap;
    vwapSlope = (vwap - prevVwap) / (prevVwap || 1);
  }
  // VWAP 斜率如果太大（> 0.5%）表示有強勢趨勢，不適合回歸操作
  if (Math.abs(vwapSlope) > 0.005) return { direction: null };

  const c = candles[i];
  // Z-Score 門滝改為 2.0（比原來 1.5 更嚴格，減少假信號）
  if (zScore <= -2.0 && c.close > c.open) return { direction: "long" };
  if (zScore >= 2.0  && c.close < c.open) return { direction: "short" };
  return { direction: null };
}

/**
 * ★ 最高勝率綜合策略（Composite）
 * 複製 highWinRateService 的加權評分邏輯：
 * SMC 30% + PA 25% + 斐波 20% + 纏論 25%
 * 閾值：>= 62 做多，<= 38 做空
 */
function signalComposite(
  i: number,
  candles: Candle[],
  closes: number[],
  rsi: number[],
  ema20: number[],
  ema50: number[],
  ema200: number[],
  macdHist: number[],
  plusDi: number[],
  minusDi: number[],
  atrArr: number[]
): Signal {
  if (i < 80 || isNaN(ema200[i]) || isNaN(rsi[i]) || !atrArr[i]) return { direction: null };

  const close = closes[i];
  const atr = atrArr[i];
  const smcSignal = signalSmc(i, candles, ema200);
  const paSignal = signalPa(i, candles, closes, rsi, ema20, ema50, ema200, macdHist, plusDi, minusDi);
  const chanSignal = signalChan(i, candles);

  const lookback = Math.min(60, i);
  const swingSlice = candles.slice(i - lookback, i + 1);
  const swingHigh = Math.max(...swingSlice.map(c => c.high));
  const swingLow = Math.min(...swingSlice.map(c => c.low));
  const swingRange = swingHigh - swingLow;
  const fibRatio = swingRange > 0 ? (close - swingLow) / swingRange : 0.5;

  const avgVol = candles.slice(Math.max(0, i - 20), i).reduce((sum, c) => sum + c.volume, 0) / Math.max(1, Math.min(20, i));
  const hasVolume = candles[i].volume >= avgVol * 0.95;
  const bullishRegime = close >= ema200[i] * 0.995 && (!isNaN(ema20[i]) && !isNaN(ema50[i]) ? ema20[i] >= ema50[i] : true);
  const bearishRegime = close <= ema200[i] * 1.005 && (!isNaN(ema20[i]) && !isNaN(ema50[i]) ? ema20[i] <= ema50[i] : true);
  const momentumLong = (!isNaN(plusDi[i]) && !isNaN(minusDi[i]) ? plusDi[i] >= minusDi[i] : true) && (isNaN(macdHist[i]) || macdHist[i] >= (macdHist[i - 1] ?? macdHist[i]));
  const momentumShort = (!isNaN(plusDi[i]) && !isNaN(minusDi[i]) ? minusDi[i] >= plusDi[i] : true) && (isNaN(macdHist[i]) || macdHist[i] <= (macdHist[i - 1] ?? macdHist[i]));

  let longScore = 0;
  let shortScore = 0;
  if (smcSignal.direction === "long") longScore += 0.35;
  if (smcSignal.direction === "short") shortScore += 0.35;
  if (paSignal.direction === "long") longScore += 0.25;
  if (paSignal.direction === "short") shortScore += 0.25;
  if (chanSignal.direction === "long") longScore += 0.20;
  if (chanSignal.direction === "short") shortScore += 0.20;
  if (fibRatio >= 0.45 && fibRatio <= 0.72 && bullishRegime) longScore += 0.10;
  if (fibRatio >= 0.28 && fibRatio <= 0.55 && bearishRegime) shortScore += 0.10;
  if (bullishRegime && momentumLong) longScore += 0.10;
  if (bearishRegime && momentumShort) shortScore += 0.10;

  const longConflict = shortScore >= 0.35;
  const shortConflict = longScore >= 0.35;

  if (longScore >= 0.55 && !longConflict && hasVolume && rsi[i] < 72) {
    return {
      direction: "long",
      custom_sl: smcSignal.custom_sl ?? paSignal.custom_sl,
      custom_tp: smcSignal.custom_tp ?? paSignal.custom_tp,
      custom_tp2: smcSignal.custom_tp2,
      score: Math.round(longScore * 100) / 10,
      pivot_low: detectPivotLow(candles, i, 20, 2) ?? undefined,
    };
  }

  if (shortScore >= 0.55 && !shortConflict && hasVolume && rsi[i] > 28) {
    return {
      direction: "short",
      custom_sl: smcSignal.custom_sl ?? paSignal.custom_sl,
      custom_tp: smcSignal.custom_tp ?? paSignal.custom_tp,
      custom_tp2: smcSignal.custom_tp2,
      score: Math.round(shortScore * 100) / 10,
      pivot_high: detectPivotHigh(candles, i, 20, 2) ?? undefined,
    };
  }

  return { direction: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────────
// ★ HighWinRate 模型 A/B/C 信號函數（使用模型自帶 SMC SL/TP）
// ───────────────────────────────────────────────────────────────────────────────

/**
 * 模型 A：掃流動性反轉單 v2.0
 * 核心邏輯：
 * 1. 最近 8 根內掃過 SSL（做多）或 BSL（做空）
 * 2. 掃過後 5 根內出現 CHoCH（結構轉折）
 * 3. FVG 必須存在（gap > atr * 0.05）且價格在 FVG 內
 * 4. RVOL 確認：成交量 ≥ 平均 0.8×（排除死量）
 * 5. 動態 TP = 前波高/低，上限 3.0R，下限 2.0R
 * 6. SL = sweep candle 極小/極大點外側 0.15 ATR
 */
function signalHwrModelA(i: number, candles: Candle[], atrArr: number[]): Signal {
  if (i < 30 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  if (atr <= 0) return { direction: null };

  const close = candles[i].close;
  const cur = candles[i];

  // 1. 掃過債測（最近 8 根，放寬從 5）
  const swingLookback = Math.min(20, i - 5);
  const swingSlice = candles.slice(i - swingLookback, i - 2);
  const swingLow  = Math.min(...swingSlice.map(c => c.low));
  const swingHigh = Math.max(...swingSlice.map(c => c.high));

  let sslSwept = false, bslSwept = false;
  let sweepCandleIdx = -1;

  for (let j = i - 8; j <= i; j++) {  // 改良：5 根 → 8 根
    if (j < 0) continue;
    const c = candles[j];
    if (c.low < swingLow && c.close > swingLow) {
      sslSwept = true; sweepCandleIdx = j; break;
    }
    if (c.high > swingHigh && c.close < swingHigh) {
      bslSwept = true; sweepCandleIdx = j; break;
    }
  }

  if (!sslSwept && !bslSwept) return { direction: null };
  const sweepDir: "long" | "short" = sslSwept ? "long" : "short";
  const sweepCandle = candles[sweepCandleIdx];

  // 2. CHoCH 確認：sweep 後 5 根內
  if (sweepCandleIdx < 0) return { direction: null };
  const chochWindow = Math.min(i, sweepCandleIdx + 5);
  const postSweep = candles.slice(sweepCandleIdx, chochWindow + 1);
  let chochConfirmed = false;
  if (sweepDir === "long") {
    const prevHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map(c => c.high));
    chochConfirmed = postSweep.some(c => c.close > prevHigh);
  } else {
    const prevLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map(c => c.low));
    chochConfirmed = postSweep.some(c => c.close < prevLow);
  }
  if (!chochConfirmed) return { direction: null };

  // 3. FVG 必須存在（改良：gap > atr * 0.05，降低門溻）
  let fvgTop = 0, fvgBottom = 0;
  for (let j = sweepCandleIdx + 1; j <= i - 1; j++) {
    const c0 = candles[j - 1], c2 = candles[j + 1];
    if (!c0 || !c2) continue;
    if (sweepDir === "long") {
      const gap = c2.low - c0.high;
      if (gap > atr * 0.05) { fvgTop = c2.low; fvgBottom = c0.high; break; }  // 改良：0.1 → 0.05
    } else {
      const gap = c0.low - c2.high;
      if (gap > atr * 0.05) { fvgTop = c0.low; fvgBottom = c2.high; break; }  // 改良：0.1 → 0.05
    }
  }

  // FVG 必須存在（改良：不允許無 FVG 進場）
  if (fvgTop <= 0 || fvgBottom <= 0) return { direction: null };

  // 價格在 FVG 區間內
  const inFvg =
    (sweepDir === "long"  && close >= fvgBottom && close <= fvgTop * 1.02) ||
    (sweepDir === "short" && close <= fvgTop    && close >= fvgBottom * 0.98);
  if (!inFvg) return { direction: null };

  // 4. RVOL 確認：成交量 ≥ 平均 0.8×（改良：新增）
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length : 0;
  if (avgVol > 0 && cur.volume < avgVol * 0.8) return { direction: null };

  // 5. 動態 SL/TP
  const slBuffer = atr * 0.15;
  let sl: number, tp: number;
  if (sweepDir === "long") {
    sl = sweepCandle.low - slBuffer;
    const riskDist = close - sl;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    // 改良：動態 TP = 前波高，上限 3.0R，下限 2.0R
    const prevSwingHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map(c => c.high));
    const dynTarget = prevSwingHigh > close + riskDist * 1.0 ? prevSwingHigh : close + riskDist * 2.5;
    tp = Math.min(dynTarget, close + riskDist * 3.0);
    tp = Math.max(tp, close + riskDist * 2.0);
  } else {
    sl = sweepCandle.high + slBuffer;
    const riskDist = sl - close;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    // 改良：動態 TP = 前波低，上限 3.0R，下限 2.0R
    const prevSwingLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map(c => c.low));
    const dynTarget = prevSwingLow < close - riskDist * 1.0 ? prevSwingLow : close - riskDist * 2.5;
    tp = Math.max(dynTarget, close - riskDist * 3.0);
    tp = Math.min(tp, close - riskDist * 2.0);
  }

  return {
    direction: sweepDir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: "ModelA_v2_SMC",
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// hwr_model_a_elite：在 hwr_model_a 基礎上加入三個額外過濾層
//   額外層 1 — EMA 趨勢方向一致（EMA20 > EMA50 做多，EMA20 < EMA50 做空）
//   額外層 2 — 每日限 1 單（避免同一天多次進場）
//   額外層 3 — 最低 RR ≥ 2.0（只進高品質設置）
// ─────────────────────────────────────────────────────────────────────────────────
const hwrEliteDailyTracker: Map<string, number> = new Map();

function signalHwrModelAElite(
  i: number,
  candles: Candle[],
  atrArr: number[],
  adxArr: number[],
  ema20: number[],
  ema50: number[],
  ema200: number[],
): Signal {
  if (i < 30 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  if (atr <= 0) return { direction: null };

  const close = candles[i].close;
  const cur = candles[i];

  // === 額外層 1a：EMA 趨勢方向確認（EMA20/50 方向一致） ===
  const e20 = ema20[i] ?? 0;
  const e50 = ema50[i] ?? 0;
  const e200 = ema200[i] ?? 0;
  if (isNaN(e20) || isNaN(e50) || e20 === 0 || e50 === 0) return { direction: null };
  // 只允許 EMA20 和 EMA50 方向一致的方向進場
  const emaBull = e20 > e50;
  const emaBear = e20 < e50;
  // 如果兩者方向不明（差距 < 0.05%），跳過
  if (Math.abs(e20 - e50) / e50 < 0.0005) return { direction: null };

  // === 額外層 1b：EMA50 > EMA200 長期趨勢確認（可選：不強制，避免過濾太多） ===
  // 若 EMA200 有效，要求 EMA50 方向與 EMA200 一致（長期趨勢確認）
  if (e200 > 0 && !isNaN(e200)) {
    if (emaBull && e50 < e200) return { direction: null };  // 多頭但長期仍空頭
    if (emaBear && e50 > e200) return { direction: null };  // 空頭但長期仍多頭
  }

  // === 額外層 1c：ADX >= 18 趨勢強度確認 ===
  const adx = adxArr[i] ?? 0;
  if (!isNaN(adx) && adx > 0 && adx < 18) return { direction: null };

  // === 核心層（與 hwr_model_a 相同）===

  // 1. 清掃偵測（最近 8 根）
  const swingLookback = Math.min(20, i - 5);
  const swingSlice = candles.slice(i - swingLookback, i - 2);
  const swingLow  = Math.min(...swingSlice.map(c => c.low));
  const swingHigh = Math.max(...swingSlice.map(c => c.high));

  let sslSwept = false, bslSwept = false;
  let sweepCandleIdx = -1;

  for (let j = i - 8; j <= i; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (c.low < swingLow && c.close > swingLow) {
      sslSwept = true; sweepCandleIdx = j; break;
    }
    if (c.high > swingHigh && c.close < swingHigh) {
      bslSwept = true; sweepCandleIdx = j; break;
    }
  }

  if (!sslSwept && !bslSwept) return { direction: null };
  const sweepDir: "long" | "short" = sslSwept ? "long" : "short";
  const sweepCandle = candles[sweepCandleIdx];

  // === 額外層 1 補充：清掃方向必須與 EMA 趨勢一致 ===
  if (sweepDir === "long"  && !emaBull) return { direction: null };
  if (sweepDir === "short" && !emaBear) return { direction: null };

  // 2. CHoCH 確認：sweep 後 5 根內
  if (sweepCandleIdx < 0) return { direction: null };
  const chochWindow = Math.min(i, sweepCandleIdx + 5);
  const postSweep = candles.slice(sweepCandleIdx, chochWindow + 1);
  let chochConfirmed = false;
  if (sweepDir === "long") {
    const prevHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map(c => c.high));
    chochConfirmed = postSweep.some(c => c.close > prevHigh);
  } else {
    const prevLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map(c => c.low));
    chochConfirmed = postSweep.some(c => c.close < prevLow);
  }
  if (!chochConfirmed) return { direction: null };

  // 3. FVG 必須存在
  let fvgTop = 0, fvgBottom = 0;
  for (let j = sweepCandleIdx + 1; j <= i - 1; j++) {
    const c0 = candles[j - 1], c2 = candles[j + 1];
    if (!c0 || !c2) continue;
    if (sweepDir === "long") {
      const gap = c2.low - c0.high;
      if (gap > atr * 0.05) { fvgTop = c2.low; fvgBottom = c0.high; break; }
    } else {
      const gap = c0.low - c2.high;
      if (gap > atr * 0.05) { fvgTop = c0.low; fvgBottom = c2.high; break; }
    }
  }
  if (fvgTop <= 0 || fvgBottom <= 0) return { direction: null };

  const inFvg =
    (sweepDir === "long"  && close >= fvgBottom && close <= fvgTop * 1.02) ||
    (sweepDir === "short" && close <= fvgTop    && close >= fvgBottom * 0.98);
  if (!inFvg) return { direction: null };

  // 4. RVOL ≥ 0.8×
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length : 0;
  if (avgVol > 0 && cur.volume < avgVol * 0.8) return { direction: null };

  // 5. SL/TP 計算
  const slBuffer = atr * 0.15;
  let sl: number, tp: number;
  if (sweepDir === "long") {
    sl = sweepCandle.low - slBuffer;
    const riskDist = close - sl;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevSwingHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map(c => c.high));
    const dynTarget = prevSwingHigh > close + riskDist * 1.0 ? prevSwingHigh : close + riskDist * 2.5;
    tp = Math.min(dynTarget, close + riskDist * 3.0);
    tp = Math.max(tp, close + riskDist * 2.0);
    // === 額外層 3：最低 RR ≥ 2.0 ===
    if ((tp - close) / riskDist < 2.0) return { direction: null };
  } else {
    sl = sweepCandle.high + slBuffer;
    const riskDist = sl - close;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevSwingLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map(c => c.low));
    const dynTarget = prevSwingLow < close - riskDist * 1.0 ? prevSwingLow : close - riskDist * 2.5;
    tp = Math.max(dynTarget, close - riskDist * 3.0);
    tp = Math.min(tp, close - riskDist * 2.0);
    // === 額外層 3：最低 RR ≥ 2.0 ===
    if ((close - tp) / riskDist < 2.0) return { direction: null };
  }

  // === 額外層 2：每日限 1 單 ===
  const dayKey = new Date(cur.time * 1000).toISOString().slice(0, 10);
  const todayCount = hwrEliteDailyTracker.get(dayKey) ?? 0;
  if (todayCount >= 1) return { direction: null };
  hwrEliteDailyTracker.set(dayKey, todayCount + 1);

  return {
    direction: sweepDir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: "HWR_A_Elite",
  };
}

/**
 * 模型 B：趨勢回踩延續單
 * 核心邏輯：
 * 1. EMA50 方向確認趨勢（替代 4H 纏論）
 * 2. ADX > 20 趨勢強度確認
 * 3. 債測 Fib OTE 區間（0.618 ~ 0.786 回踩）
 * 4. 債測 FVG 支撑（做多）或阻力（做空）
 * 5. SL = OTE 區間下方 0.5 ATR，TP = 2.0R
 */
function signalHwrModelB(i: number, candles: Candle[], ema50: number[], atrArr: number[], adxArr: number[]): Signal {
  if (i < 50 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  const adx = adxArr[i] ?? 0;
  // ★ v5.8 改良：ADX 門滝提高至 25，確保足夠的趨勢強度
  if (atr <= 0 || adx < 25) return { direction: null };

  const close = candles[i].close;
  const ema = ema50[i];
  if (isNaN(ema)) return { direction: null };

  // 1. EMA50 趨勢方向（加入 EMA50 連續 3 根方向確認）
  const ema50Slope5 = ema50[i] - ema50[Math.max(0, i - 5)];
  const ema50Slope3 = ema50[i] - ema50[Math.max(0, i - 3)];
  const trendUp   = close > ema && ema50Slope5 > 0 && ema50Slope3 > 0;
  const trendDown = close < ema && ema50Slope5 < 0 && ema50Slope3 < 0;
  if (!trendUp && !trendDown) return { direction: null };
  const dir: "long" | "short" = trendUp ? "long" : "short";

  // ★ v5.8 改良：如果是山峰市況（EMA50 向上），禁止做空信號
  if (dir === "short" && ema50Slope5 > 0) return { direction: null };

  // 2. 計算 Fib OTE 區間（v5.9 改良：找最近的 swing high/low 而非整個 lookback 的極値）
  const lookback = Math.min(50, i);
  // 找最近的明確 swing high（左右各 3 根確認）
  let swingHigh = -Infinity, swingLow = Infinity;
  for (let j = i - lookback + 3; j <= i - 3; j++) {
    if (j < 3) continue;
    const c = candles[j];
    if (c.high > candles[j-1].high && c.high > candles[j-2].high && c.high > candles[j-3].high &&
        c.high > candles[j+1].high && c.high > candles[j+2].high && c.high > candles[j+3].high) {
      if (c.high > swingHigh) swingHigh = c.high;
    }
    if (c.low < candles[j-1].low && c.low < candles[j-2].low && c.low < candles[j-3].low &&
        c.low < candles[j+1].low && c.low < candles[j+2].low && c.low < candles[j+3].low) {
      if (c.low < swingLow) swingLow = c.low;
    }
  }
  // 如果沒有找到明確 swing，備用整個 lookback 的極値
  if (swingHigh === -Infinity) swingHigh = Math.max(...candles.slice(i - lookback, i + 1).map(c => c.high));
  if (swingLow === Infinity)   swingLow  = Math.min(...candles.slice(i - lookback, i + 1).map(c => c.low));
  const range = swingHigh - swingLow;
  if (range <= 0) return { direction: null };

  let fib618: number, fib786: number;
  if (dir === "long") {
    // 上升趨勢回踩：從高點往下數 0.618 / 0.786
    fib618 = swingHigh - range * 0.618;
    fib786 = swingHigh - range * 0.786;
  } else {
    // 下降趨勢反彈：從低點往上數 0.618 / 0.786
    fib618 = swingLow + range * 0.618;
    fib786 = swingLow + range * 0.786;
  }
  const oteTop    = Math.max(fib618, fib786);
  const oteBottom = Math.min(fib618, fib786);

  // 3. 債測目前價格是否在 OTE 區間內
  const inOte = close >= oteBottom * 0.995 && close <= oteTop * 1.005;
  if (!inOte) return { direction: null };

  // 4. FVG 確認（★ 方案三：升級為 Unmitigated FVG 過濾）
  // 只採用「未被填補」的 FVG，過濾掉已被市場測試過、流動性耗盡的無效缺口
  let hasFvg = false;
  for (let j = Math.max(1, i - 20); j <= i - 1; j++) {
    const c0 = candles[j - 1], c2 = candles[j + 1];
    if (!c0 || !c2) continue;
    if (dir === "long") {
      const gapTop = c2.low;
      const gapBottom = c0.high;
      const gap = gapTop - gapBottom;
      if (gap > atr * 0.1 && gapTop >= oteBottom && gapBottom <= oteTop) {
        // ★ 方案三：檢查 FVG 是否已被填補（Mitigated）
        // 如果後續 K 線的 low 曾穿入 FVG 區間過深（超過 50%），視為已填補
        let mitigated = false;
        const fvgMid = (gapTop + gapBottom) / 2;
        for (let k = j + 2; k <= i; k++) {
          if (candles[k].low <= fvgMid) { mitigated = true; break; }
        }
        if (!mitigated) { hasFvg = true; break; }
      }
    } else {
      const gapTop = c0.low;
      const gapBottom = c2.high;
      const gap = gapTop - gapBottom;
      if (gap > atr * 0.1 && gapTop <= oteTop && gapBottom >= oteBottom) {
        // ★ 方案三：檢查 bearish FVG 是否已被填補
        let mitigated = false;
        const fvgMid = (gapTop + gapBottom) / 2;
        for (let k = j + 2; k <= i; k++) {
          if (candles[k].high >= fvgMid) { mitigated = true; break; }
        }
        if (!mitigated) { hasFvg = true; break; }
      }
    }
  }

  // 5. 計算模型自帶 SL/TP
  const slBuffer = atr * 0.5;
  let sl: number, tp: number;
  if (dir === "long") {
    sl = oteBottom - slBuffer;
    const riskDist = close - sl;
    tp = close + riskDist * 2.0;
  } else {
    sl = oteTop + slBuffer;
    const riskDist = sl - close;
    tp = close - riskDist * 2.0;
  }

  // 計算 HWR-B 評分：OTE 品質(0~5) + FVG 加分(0~3) + ADX 強度(0~2)
  const oteScore  = inOte ? 5 : 3;
  const fvgScore  = hasFvg ? 3 : 0;
  const adxScore  = adx > 40 ? 2 : adx > 30 ? 1 : 0;
  const hwrBScore = Math.min(10, oteScore + fvgScore + adxScore);

  return {
    direction: dir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: hasFvg ? "ModelB_OTE+FVG" : "ModelB_OTE",
    score: hwrBScore,
  };
}

/**
 * 模型 C：中樞邊界反應單
 * 核心邏輯：
 * 1. 債測纏論中樞（最近 3 段重疊）
 * 2. 債測價格接近中樞上沿（做空）或下沿（做多）
 * 3. 債測假突破後收回（PA 確認）
 * 4. SL = 中樞邊界外側 0.5 ATR，TP = 對側邊界
 */
function signalHwrModelC(i: number, candles: Candle[], atrArr: number[]): Signal {
  if (i < 30 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  if (atr <= 0) return { direction: null };

  const close = candles[i].close;

  // 1. 債測纏論中樞（簡化版：找最近 30 根內的高低點重疊區間）
  const lookback = Math.min(30, i);
  const slice = candles.slice(i - lookback, i + 1);

  // 用簡化版纏論中樞：找最近的局部高點和低點集群
  const highs = slice.map(c => c.high).sort((a, b) => b - a);
  const lows  = slice.map(c => c.low).sort((a, b) => a - b);
  // 取前 1/3 的高點平均作為中樞上沿，後 1/3 低點平均作為中樞下沿
  const topCount = Math.max(1, Math.floor(slice.length / 4));
  const zsTop    = highs.slice(0, topCount).reduce((s, v) => s + v, 0) / topCount;
  const zsBottom = lows.slice(0, topCount).reduce((s, v) => s + v, 0) / topCount;
  const zsHeight = zsTop - zsBottom;

  // ★ v5.8 改良：中樞寬度門滝提高至 1.5 ATR，避免在橫盤震盪區間交易
  if (zsHeight < atr * 1.5) return { direction: null }; // 中樞太小，不適合此模型

  // 2. 債測價格是否接近中樞邊界（ATR * 0.5 內）
  const nearTopThreshold    = atr * 0.5;
  const nearBottomThreshold = atr * 0.5;
  const nearTop    = Math.abs(close - zsTop)    < nearTopThreshold;
  const nearBottom = Math.abs(close - zsBottom) < nearBottomThreshold;

  if (!nearTop && !nearBottom) return { direction: null };
  const dir: "long" | "short" = nearBottom ? "long" : "short";

  // ★ v5.8 改良：市況過濾 — 計算 EMA50 斜率判斷市況
  const ema50Arr = calcEma(candles.map(c => c.close), 50);
  const ema50Now = ema50Arr[i];
  const ema50Slope = !isNaN(ema50Now) ? ema50Now - (ema50Arr[Math.max(0, i - 5)] ?? ema50Now) : 0;
  // 如果 EMA50 向上（偷多市況），禁止做空中樞上沿
  if (dir === "short" && ema50Slope > 0) return { direction: null };

  // 3. PA 假突破確認：最近 3 根內是否有突破後收回
  const prev3 = candles.slice(Math.max(0, i - 3), i + 1);
  let paConfirm = false;
  if (dir === "long") {
    // 假突破下沿後收回：有 K 線低點突破 zsBottom 但收陰線對应收回
    paConfirm = prev3.some(c => c.low < zsBottom && c.close > zsBottom);
  } else {
    // 假突破上沿後收回：有 K 線高點突破 zsTop 但收陰線對应收回
    paConfirm = prev3.some(c => c.high > zsTop && c.close < zsTop);
  }
  if (!paConfirm) return { direction: null };

  // 4. 計算模型自帶 SL/TP
  const slBuffer = atr * 0.5;
  let sl: number, tp: number;
  if (dir === "long") {
    sl = zsBottom - slBuffer;
    tp = zsTop; // 中樞對側邊界為目標
  } else {
    sl = zsTop + slBuffer;
    tp = zsBottom; // 中樞對側邊界為目標
  }

  // 最小 RR 確認：至少 1.2R
  const riskDist = Math.abs(close - sl);
  const rewardDist = Math.abs(tp - close);
  if (riskDist <= 0 || rewardDist / riskDist < 1.2) return { direction: null };

  return {
    direction: dir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: "ModelC_ZS",
  };
}

// ★ 升級版：SL/TP 碰觸判斷（含移動止損 Trailing Stop）
// ─────────────────────────────────────────────────────────────────────────────

function signalCannonball(
  i: number,
  candles: Candle[],
  ema50: number[],
  atrArr: number[]
): Signal {
  if (i < 120 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  const close = candles[i].close;
  if (!Number.isFinite(atr) || atr <= 0 || !Number.isFinite(close)) return { direction: null };

  const slice = candles.slice(Math.max(0, i - 180), i + 1);
  if (slice.length < 80) return { direction: null };

  const structure = detectBosChoch(slice);
  const confirmedEvents = structure.events.filter((e) => e.confirmed);
  const lastEvent = confirmedEvents[confirmedEvents.length - 1];
  if (!lastEvent || (lastEvent.direction !== "bullish" && lastEvent.direction !== "bearish")) return { direction: null };

  const direction: "long" | "short" = lastEvent.direction === "bullish" ? "long" : "short";
  const obs = detectOrderBlocks(slice, close);
  const zone = direction === "long" ? obs.nearestBull : obs.nearestBear;
  if (!zone) return { direction: null };

  const swingHighs = findSwingHighs(slice, 5).slice(-8);
  const swingLows = findSwingLows(slice, 5).slice(-8);
  const recent20 = slice.slice(-21, -1);
  const avgVol = recent20.length > 0 ? recent20.reduce((sum, c) => sum + c.volume, 0) / recent20.length : slice[slice.length - 1].volume || 1;
  const rvol = avgVol > 0 ? (slice[slice.length - 1].volume || 0) / avgVol : 1;
  const recent5 = slice.slice(-5);
  const upBars = recent5.filter((c) => c.close > c.open).length;
  const downBars = recent5.filter((c) => c.close < c.open).length;
  const moneyFlowScore = rvol * 35 + (upBars / 5) * 35 + ((close - slice[Math.max(0, slice.length - 6)].close) / (atr || 1)) * 10;
  const priceNearZone = direction === "long"
    ? close <= zone.top + atr * 0.8
    : close >= zone.bottom - atr * 0.8;

  if (direction === "long") {
    if (!priceNearZone || close <= (ema50[i] ?? close) || upBars < 3 || moneyFlowScore < 45) return { direction: null };
    const pivotLow = swingLows[swingLows.length - 1]?.price ?? zone.bottom;
    const sl = Math.min(zone.bottom, pivotLow) - atr * 0.3;
    const risk = close - sl;
    if (risk <= atr * 0.25) return { direction: null };
    const target1Base = swingHighs[swingHighs.length - 1]?.price ?? (close + risk * 1.6);
    const tp1 = Math.max(close + risk * 1.2, target1Base);
    const tp2 = Math.max(close + atr * 2.5, close + risk * 2.4);
    return { direction: "long", custom_sl: sl, custom_tp: tp1, custom_tp2: tp2, entry_type: "CannonBall_OB", score: Math.min(10, Math.round((moneyFlowScore / 10) * 10) / 10) };
  }

  if (!priceNearZone || close >= (ema50[i] ?? close) || downBars < 3 || (rvol * 35 + (downBars / 5) * 35) < 45) return { direction: null };
  const pivotHigh = swingHighs[swingHighs.length - 1]?.price ?? zone.top;
  const sl = Math.max(zone.top, pivotHigh) + atr * 0.3;
  const risk = sl - close;
  if (risk <= atr * 0.25) return { direction: null };
  const target1Base = swingLows[swingLows.length - 1]?.price ?? (close - risk * 1.6);
  const tp1 = Math.min(close - risk * 1.2, target1Base);
  const tp2 = Math.min(close - atr * 2.5, close - risk * 2.4);
  return { direction: "short", custom_sl: sl, custom_tp: tp1, custom_tp2: tp2, entry_type: "CannonBall_OB", score: Math.min(10, Math.round(((rvol * 35 + (downBars / 5) * 35) / 10) * 10) / 10) };
}

/**
 * ★ Apex 策略（頂點高勝率策略）v3.0
 * 設計目標：勝率 ≥ 45%，盈虧比 ≥ 2.5R，年化正報酬
 *
 * 五層過濾邏輯（優化版）：
 * 層 1 — 流動性清掃（最近 20 根內）：針刺式清掃 swing high/low
 * 層 2 — CHoCH 結構轉換（清掃後 6 根內，收緊）：收盤穿越前波高/低
 * 層 3 — FVG 必須存在（不允許只用 OTE）：清掃後的 FVG 且當前價格在 FVG 附近
 * 層 4 — PA 確認：不是強勢反向实體筆（實體 > 65% 總幅且方向相反）
 * 層 5 — 量能：成交量 ≥ 平均 0.7×（排除死量空頭）
 *
 * 優化 1：TP = max(前波高/低, 2.5R)，動態目標
 * 優化 2：HTF 4H EMA200 趨勢過濾（方向一致才進場）
 * 優化 3：FVG 必須找到（提升訊號品質）
 * SL = 清掃極值外 0.15 ATR
 */
function signalApex(
  i: number,
  candles: Candle[],
  atrArr: number[],
  adxArr: number[],
  htfCandles?: Candle[]   // 優化 2：HTF K 線（4H），用於 EMA200 趨勢過濾
): Signal {
  if (i < 50 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  const adx = adxArr[i] ?? 0;
  if (atr <= 0) return { direction: null };
  if (adx < 12) return { direction: null };

  const close = candles[i].close;
  const cur = candles[i];
  const current_time = cur.time;

  // ── 優化 2：主圖 EMA50 趨勢過濾（替代 HTF EMA200，避免過度過濾） ──
  // 用主圖最近 50 根的 EMA50 確認趨勢方向
  let htfBullish: boolean | null = null;
  if (i >= 50) {
    const closes50 = candles.slice(i - 50, i + 1).map(c => c.close);
    let ema50val = closes50[0];
    const k50 = 2 / 51;
    for (let x = 1; x < closes50.length; x++) ema50val = closes50[x] * k50 + ema50val * (1 - k50);
    htfBullish = close > ema50val;
  } else if (htfCandles && htfCandles.length >= 50) {
    // fallback: 如果有傳入 HTF K 線，用 HTF EMA50
    const available = htfCandles.filter(c => c.time <= current_time);
    if (available.length >= 50) {
      const htfCloses = available.slice(-50).map(c => c.close);
      let ema50h = htfCloses[0];
      const kh = 2 / 51;
      for (let x = 1; x < htfCloses.length; x++) ema50h = htfCloses[x] * kh + ema50h * (1 - kh);
      htfBullish = available[available.length - 1].close > ema50h;
    }
  }

  // ── 層 1：流動性清掃（最近 20 根內搜尋） ──
  const swingLookback = Math.min(40, i - 20);
  if (swingLookback < 5) return { direction: null };
  const swingSlice = candles.slice(i - swingLookback, i - 5);
  if (swingSlice.length < 5) return { direction: null };

  const swingLow  = Math.min(...swingSlice.map(c => c.low));
  const swingHigh = Math.max(...swingSlice.map(c => c.high));

  let sweepDir: "long" | "short" | null = null;
  let sweepIdx = -1;
  let sweepExtreme = 0;

  for (let j = i - 20; j <= i - 2; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (c.low < swingLow - atr * 0.02 && c.close > swingLow - atr * 0.1) {
      sweepDir = "long";
      sweepIdx = j;
      sweepExtreme = c.low;
      break;
    }
    if (c.high > swingHigh + atr * 0.02 && c.close < swingHigh + atr * 0.1) {
      sweepDir = "short";
      sweepIdx = j;
      sweepExtreme = c.high;
      break;
    }
  }
  if (!sweepDir || sweepIdx < 0) return { direction: null };

  // 優化 2：HTF 趨勢方向一致才進場
  if (htfBullish !== null) {
    if (sweepDir === "long"  && !htfBullish) return { direction: null };
    if (sweepDir === "short" && htfBullish)  return { direction: null };
  }

  // ── 層 2：CHoCH 結構轉換（清掃後 8 根內） ──
  const chochEnd = Math.min(i, sweepIdx + 8);  // 修正：從 6 放寬至 8，平衡品質與樣本數
  const preSweepSlice = candles.slice(Math.max(0, sweepIdx - 6), sweepIdx);
  if (preSweepSlice.length < 2) return { direction: null };
  const prevHigh = Math.max(...preSweepSlice.map(c => c.high));
  const prevLow  = Math.min(...preSweepSlice.map(c => c.low));

  let chochConfirmed = false;
  for (let j = sweepIdx + 1; j <= chochEnd; j++) {
    if (j >= candles.length) break;
    const c = candles[j];
    if (sweepDir === "long"  && c.close > prevHigh) { chochConfirmed = true; break; }
    if (sweepDir === "short" && c.close < prevLow)  { chochConfirmed = true; break; }
  }
  if (!chochConfirmed) return { direction: null };

  // ── 層 3：FVG 必須存在（優化 3：不允許只用 OTE） ──
  let fvgTop = 0, fvgBottom = 0;
  for (let j = sweepIdx + 1; j <= i - 1; j++) {
    if (j < 1 || j + 1 >= candles.length) continue;
    const c0 = candles[j - 1];
    const c2 = candles[j + 1];
    if (sweepDir === "long") {
      const gap = c2.low - c0.high;
      if (gap > atr * 0.03) { fvgBottom = c0.high; fvgTop = c2.low; break; }
    } else {
      const gap = c0.low - c2.high;
      if (gap > atr * 0.03) { fvgBottom = c2.high; fvgTop = c0.low; break; }
    }
  }
  // 優化 3：FVG 必須存在（不允許只用 OTE 進場）
  if (fvgTop <= 0 || fvgBottom <= 0) return { direction: null };

  // 價格在 FVG 區間內或附近 0.3 ATR
  let inEntryZone = false;
  if (sweepDir === "long"  && close >= fvgBottom - atr * 0.3 && close <= fvgTop + atr * 0.3) inEntryZone = true;
  if (sweepDir === "short" && close <= fvgTop + atr * 0.3    && close >= fvgBottom - atr * 0.3) inEntryZone = true;
  if (!inEntryZone) return { direction: null };

  // ── 層 4：PA 確認（排除強勢反向实體筆） ──
  const bodySize = Math.abs(cur.close - cur.open);
  const totalRange = cur.high - cur.low;
  const upperWick = cur.high - Math.max(cur.open, cur.close);
  const lowerWick = Math.min(cur.open, cur.close) - cur.low;
  const isBullish = cur.close > cur.open;
  const isBearish = cur.close < cur.open;

  if (sweepDir === "long"  && isBearish && bodySize > totalRange * 0.65) return { direction: null };
  if (sweepDir === "short" && isBullish && bodySize > totalRange * 0.65) return { direction: null };

  const prevC = candles[i - 1];
  const isBullEngulf = isBullish && cur.open < prevC.close && cur.close > prevC.open;
  const isPinBarBull = lowerWick > bodySize * 1.5 && lowerWick > totalRange * 0.4;
  const isBearEngulf = isBearish && cur.open > prevC.close && cur.close < prevC.open;
  const isPinBarBear = upperWick > bodySize * 1.5 && upperWick > totalRange * 0.4;
  const hasConfirmCandle = sweepDir === "long" ? (isBullEngulf || isPinBarBull) : (isBearEngulf || isPinBarBear);

  // ── 層 5：量能（排除死量空頭） ──
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length : 0;
  if (avgVol > 0 && cur.volume < avgVol * 0.7) return { direction: null };

  // ── SL 計算 ──
  const slBuffer = atr * 0.15;
  let sl: number, tp: number;
  if (sweepDir === "long") {
    sl = sweepExtreme - slBuffer;
    const risk = close - sl;
    if (risk <= 0 || risk > atr * 5) return { direction: null };
    // 優化 1：動態 TP = 前波高，但上限 3.0R，下限 2.0R
    const prevSwingHigh = Math.max(...candles.slice(Math.max(0, sweepIdx - 20), sweepIdx).map(c => c.high));
    const dynamicTarget = prevSwingHigh > close + risk * 1.0 ? prevSwingHigh : close + risk * 2.5;
    tp = Math.min(dynamicTarget, close + risk * 3.0);  // 上限 3.0R
    tp = Math.max(tp, close + risk * 2.0);             // 下限 2.0R
  } else {
    sl = sweepExtreme + slBuffer;
    const risk = sl - close;
    if (risk <= 0 || risk > atr * 5) return { direction: null };
    // 優化 1：動態 TP = 前波低，但上限 3.0R，下限 2.0R
    const prevSwingLow = Math.min(...candles.slice(Math.max(0, sweepIdx - 20), sweepIdx).map(c => c.low));
    const dynamicTarget = prevSwingLow < close - risk * 1.0 ? prevSwingLow : close - risk * 2.5;
    tp = Math.max(dynamicTarget, close - risk * 3.0);  // 上限 3.0R
    tp = Math.min(tp, close - risk * 2.0);             // 下限 2.0R
  }

  return {
    direction: sweepDir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: hasConfirmCandle ? "Apex_5L_Confirmed" : "Apex_5L",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ Elite v4 精英策略：基於 hwr_model_a 成功框架，加入三層額外過濾
// 設計邏輯：
//   基礎層（繼承 hwr_model_a）：清掃 + CHoCH + FVG 區間 + RVOL
//   額外層 A — EMA 趨勢確認：EMA20/50/200 排列一致
//   額外層 B — OTE 回調確認：價格在 FVG 內的 Fibonacci 38.2%~78.6% 區間
//   額外層 C — 每日限 1 單（避免過度交易）
// ─────────────────────────────────────────────────────────────────────────────────
const eliteDailyTracker: Map<string, number> = new Map();

function signalElite(
  i: number,
  candles: Candle[],
  atrArr: number[],
  adxArr: number[],
  ema20: number[],
  ema50: number[],
  ema200: number[],
): Signal {
  if (i < 50 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  if (atr <= 0) return { direction: null };
  const cur = candles[i];
  const close = cur.close;

  // === 層 A：EMA 趨勢已確立（EMA20/50/200 排列一致，不要求完美） ===
  const e20 = ema20[i] ?? 0;
  const e50 = ema50[i] ?? 0;
  const e200 = ema200[i] ?? 0;
  // 至少 EMA20 和 EMA50 方向一致，且價格在 EMA200 同側
  const emaBull = e20 > e50 && close > e200;
  const emaBear = e20 < e50 && close < e200;
  if (!emaBull && !emaBear) return { direction: null };
  const trendDir: "long" | "short" = emaBull ? "long" : "short";

  // === 層 B：ADX 趨勢強度 ≥ 20 ===
  const adx = adxArr[i] ?? 0;
  if (adx < 20) return { direction: null };

  // === 層 C：最近 30 根內有清掃（针刺式），方向與趨勢相反 ===
  const swingLookback = Math.min(25, i - 5);
  const swingSlice = candles.slice(i - swingLookback, i - 2);
  const swingLow  = Math.min(...swingSlice.map(c => c.low));
  const swingHigh = Math.max(...swingSlice.map(c => c.high));

  let sweepCandleIdx = -1;
  let sweepCandle: Candle | null = null;
  for (let j = i - 12; j <= i - 1; j++) {
    if (j < 0) continue;
    const c = candles[j];
    // 做多：掃過支撑（针刺式低點）
    if (trendDir === "long" && c.low < swingLow && c.close > swingLow) {
      sweepCandleIdx = j; sweepCandle = c; break;
    }
    // 做空：掃過阻力（针刺式高點）
    if (trendDir === "short" && c.high > swingHigh && c.close < swingHigh) {
      sweepCandleIdx = j; sweepCandle = c; break;
    }
  }
  if (sweepCandleIdx < 0 || !sweepCandle) return { direction: null };

  // === 層 D：CHoCH 確認（掃過後 6 根內結構轉折） ===
  const prevRef5High = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map(c => c.high));
  const prevRef5Low  = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map(c => c.low));
  let chochConfirmed = false;
  for (let k = sweepCandleIdx + 1; k <= Math.min(i, sweepCandleIdx + 6); k++) {
    if (trendDir === "long"  && candles[k].close > prevRef5High) { chochConfirmed = true; break; }
    if (trendDir === "short" && candles[k].close < prevRef5Low)  { chochConfirmed = true; break; }
  }
  if (!chochConfirmed) return { direction: null };

  // === 層 E：FVG 存在，且價格在 FVG 內 ===
  let fvgTop = 0, fvgBottom = 0;
  for (let j = sweepCandleIdx + 1; j <= i - 1; j++) {
    const c0 = candles[j - 1], c2 = candles[j + 1];
    if (!c0 || !c2) continue;
    if (trendDir === "long") {
      const gap = c2.low - c0.high;
      if (gap > atr * 0.03) { fvgTop = c2.low; fvgBottom = c0.high; break; }
    } else {
      const gap = c0.low - c2.high;
      if (gap > atr * 0.03) { fvgTop = c0.low; fvgBottom = c2.high; break; }
    }
  }
  if (fvgTop <= 0 || fvgBottom <= 0) return { direction: null };
  const inFvg =
    (trendDir === "long"  && close >= fvgBottom - atr * 0.05 && close <= fvgTop + atr * 0.1) ||
    (trendDir === "short" && close <= fvgTop + atr * 0.05    && close >= fvgBottom - atr * 0.1);
  if (!inFvg) return { direction: null };

  // === 層 F：RVOL ≥ 0.7× ===
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length : 0;
  if (avgVol > 0 && cur.volume < avgVol * 0.7) return { direction: null };

  // === 層 G：每日限 1 單 ===
  const dayKey = new Date(cur.time * 1000).toISOString().slice(0, 10);
  const todayCount = eliteDailyTracker.get(dayKey) ?? 0;
  if (todayCount >= 1) return { direction: null };
  eliteDailyTracker.set(dayKey, todayCount + 1);

  // SL/TP
  const slBuffer = atr * 0.12;
  let sl: number, tp: number;
  if (trendDir === "long") {
    sl = sweepCandle.low - slBuffer;
    const riskDist = close - sl;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map(c => c.high));
    const dynTp = prevHigh > close + riskDist * 0.8 ? prevHigh : close + riskDist * 2.0;
    tp = Math.min(dynTp, close + riskDist * 2.5);
    tp = Math.max(tp, close + riskDist * 1.5);
  } else {
    sl = sweepCandle.high + slBuffer;
    const riskDist = sl - close;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map(c => c.low));
    const dynTp = prevLow < close - riskDist * 0.8 ? prevLow : close - riskDist * 2.0;
    tp = Math.max(dynTp, close - riskDist * 2.5);
    tp = Math.min(tp, close - riskDist * 1.5);
  }

  return {
    direction: trendDir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: "Elite_v4",
  };
}

function findExitWithTrailing(
  candles: Candle[],
  entryIdx: number,
  direction: "long" | "short",
  sl: number,
  tp: number,
  maxBars = 48,
  enableTrailing = true,
  timeStopBars = 12  // ★ 方案一：時間止損（超過 N 根 K 線未達 TP 且未明顯獲利則強制平倉）
): { exitIdx: number; exitPrice: number; reason: "sl" | "tp" | "trailing" | "end" | "time_stop" } {
  // ★ 修復：用 open 而非 close 作為移動止損的錨點（與主迴圈一致）
  const entryPrice = candles[entryIdx].open;
  const initialRisk = Math.abs(entryPrice - sl);
  if (initialRisk <= 0) return { exitIdx: entryIdx, exitPrice: entryPrice, reason: "end" };
  let currentSl = sl;
  let trailingActivated = false;

  // ★ 新增：Gap open 處理 — 進場 bar 的 open 可能已穿越 SL 或 TP（跳空）
  const entryBar = candles[entryIdx];
  if (direction === "long") {
    if (entryBar.open <= sl)  return { exitIdx: entryIdx, exitPrice: entryBar.open, reason: "sl" };
    if (entryBar.open >= tp)  return { exitIdx: entryIdx, exitPrice: entryBar.open, reason: "tp" };
  } else {
    if (entryBar.open >= sl)  return { exitIdx: entryIdx, exitPrice: entryBar.open, reason: "sl" };
    if (entryBar.open <= tp)  return { exitIdx: entryIdx, exitPrice: entryBar.open, reason: "tp" };
  }

  for (let j = entryIdx + 1; j < Math.min(candles.length, entryIdx + maxBars + 1); j++) {
    const c = candles[j];

    if (direction === "long") {
      // ★ 修復：同根觸及 SL/TP 時，用隨機決策避免確定性偏差
      const slHit = c.low <= currentSl;
      const tpHit = c.high >= tp;
      if (slHit && tpHit) {
        // 同根觸及：用开盤價距離決定哪個先被觸及
        const slDist = Math.abs(c.open - currentSl);
        const tpDist = Math.abs(c.open - tp);
        if (slDist <= tpDist) return { exitIdx: j, exitPrice: currentSl, reason: trailingActivated ? "trailing" : "sl" };
        return { exitIdx: j, exitPrice: tp, reason: "tp" };
      }
      // 移動止損：當獲利達到 1R 時，將止損移至成本價
      if (enableTrailing && !trailingActivated && c.high >= entryPrice + initialRisk) {
        currentSl = entryPrice; // 移至成本，確保不谧損
        trailingActivated = true;
      }
      // 若獲利達 2R，繼續追蹤（移至 +0.5R）
      if (enableTrailing && trailingActivated && c.high >= entryPrice + initialRisk * 2) {
        const newSl = entryPrice + initialRisk * 0.5;
        if (newSl > currentSl) currentSl = newSl;
      }
      if (slHit) return { exitIdx: j, exitPrice: currentSl, reason: trailingActivated ? "trailing" : "sl" };
      if (tpHit) return { exitIdx: j, exitPrice: tp, reason: "tp" };
      // ★ 方案一：時間止損 — 持倉超過 timeStopBars 且未啟動 trailing（未獲利 1R）則強制平倉
      if (timeStopBars > 0 && (j - entryIdx) >= timeStopBars && !trailingActivated) {
        return { exitIdx: j, exitPrice: c.close, reason: "time_stop" };
      }
    } else {
      // short 移動止損
      const slHit = c.high >= currentSl;
      const tpHit = c.low <= tp;
      if (slHit && tpHit) {
        const slDist = Math.abs(c.open - currentSl);
        const tpDist = Math.abs(c.open - tp);
        if (slDist <= tpDist) return { exitIdx: j, exitPrice: currentSl, reason: trailingActivated ? "trailing" : "sl" };
        return { exitIdx: j, exitPrice: tp, reason: "tp" };
      }
      if (enableTrailing && !trailingActivated && c.low <= entryPrice - initialRisk) {
        currentSl = entryPrice;
        trailingActivated = true;
      }
      if (enableTrailing && trailingActivated && c.low <= entryPrice - initialRisk * 2) {
        const newSl = entryPrice - initialRisk * 0.5;
        if (newSl < currentSl) currentSl = newSl;
      }
      if (slHit) return { exitIdx: j, exitPrice: currentSl, reason: trailingActivated ? "trailing" : "sl" };
      if (tpHit) return { exitIdx: j, exitPrice: tp, reason: "tp" };
      // ★ 方案一：時間止損 — short 方向同樣適用
      if (timeStopBars > 0 && (j - entryIdx) >= timeStopBars && !trailingActivated) {
        return { exitIdx: j, exitPrice: c.close, reason: "time_stop" };
      }
    }
  }
  const lastIdx = Math.min(candles.length - 1, entryIdx + maxBars);
  return { exitIdx: lastIdx, exitPrice: candles[lastIdx].close, reason: "end" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 統計計算（含手續費）
// ─────────────────────────────────────────────────────────────────────────────

function calcStats(trades: BacktestTrade[], intervalHours = 4): {
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  total_return: number;
  total_return_net: number;
  sharpe_ratio: number;
  sortino_ratio: number;   // ★ 新增：Sortino Ratio（只懲罰下行風險）
  calmar_ratio: number;    // ★ 新增：Calmar Ratio（回報/最大回撤）
  equity_curve: number[];
  monthly_stats: { month: string; trades: number; wins: number; win_rate: number; pnl_pct: number }[];
  max_win_streak: number;
  max_loss_streak: number;
  session_stats: { session: string; trades: number; wins: number; win_rate: number; pnl_pct: number }[];
  drawdown_periods: { start: number; end: number; depth: number }[];
  total_fees_pct: number;
  trailing_stop_count: number;
} {
  if (trades.length === 0) {
    return {
      win_rate: 0, profit_factor: 0, max_drawdown: 0, total_return: 0,
      total_return_net: 0, sharpe_ratio: 0, sortino_ratio: 0, calmar_ratio: 0, equity_curve: [1],
      monthly_stats: [], max_win_streak: 0, max_loss_streak: 0,
      session_stats: [], drawdown_periods: [], total_fees_pct: 0, trailing_stop_count: 0,
    };
  }

  let equity = 1.0;
  let equityNet = 1.0;
  let peakNet = 1.0; // Bug Fix: 改用 net 口徑計算回撤
  let maxDd = 0;
  let totalWin = 0, totalLoss = 0, wins = 0;
  let totalFees = 0;
  let trailingCount = 0;
  const equityCurve: number[] = [1.0];
  const returns: number[] = [];

  for (const t of trades) {
    equity *= (1 + t.pnl_pct);
    equityNet *= (1 + t.pnl_net_pct);
    // Bug Fix: max_drawdown 改用 net 口徑（扣費後）
    if (equityNet > peakNet) peakNet = equityNet;
    const dd = (peakNet - equityNet) / peakNet;
    if (dd > maxDd) maxDd = dd;
    equityCurve.push(Math.round(equityNet * 10000) / 10000); // equity curve 也改用 net
    returns.push(t.pnl_net_pct); // Bug Fix: returns 改用 net 口徑
    totalFees += t.fee_pct;
    if (t.exit_reason === "trailing") trailingCount++;
    // Bug Fix: profit_factor 改用 net 口徑
    if (t.pnl_net_pct > 0) { wins++; totalWin += t.pnl_net_pct; }
    else totalLoss += Math.abs(t.pnl_net_pct);
  }

  const win_rate = wins / trades.length;
  const profit_factor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 99 : 0;
  const total_return = equity - 1;
  const total_return_net = equityNet - 1;

  // R7-FIX: 強化 Sharpe/Sortino 計算，加入無風險利率 (Risk-Free Rate)
  const RISK_FREE_RATE_ANNUAL = 0.04; // 假設 4% 年化無風險利率

  // Bug Fix: 使用實際回測期間計算年化因子（而非固定公式）
  const startTs = trades.length > 0 ? trades[0].entry_time : 0;
  const endTs   = trades.length > 0 ? trades[trades.length - 1].exit_time : 0;
  const periodYears = (startTs && endTs && endTs > startTs)
    ? (endTs - startTs) / (365.25 * 24 * 3600)
    : 1; // 至少 1 年，避免除以零
  const tradesPerYear = periodYears > 0 ? trades.length / periodYears : trades.length;
  const annualFactor  = tradesPerYear > 0 ? Math.sqrt(tradesPerYear) : Math.sqrt(365 * 24 / intervalHours);
  const riskFreeRatePerTrade = RISK_FREE_RATE_ANNUAL / Math.max(tradesPerYear, 1);

  // Bug Fix: Sharpe/Sortino/Calmar 全部改用 net 口徑（扣費後）
  const avgRet = returns.reduce((a, b) => a + b, 0) / returns.length;
  const excessRet = avgRet - riskFreeRatePerTrade;
  const stdRet = Math.sqrt(returns.reduce((a, b) => a + (b - avgRet) ** 2, 0) / returns.length);

  // ★ 修正 Sharpe Ratio 年化因子（依 K 線時間周期動態計算）
  const sharpe_ratio = stdRet > 0 && annualFactor > 0 ? (excessRet / stdRet) * annualFactor : 0;

  // ★ Sortino Ratio：只懲罰下行標準差（比 Sharpe 更合理的風險衡量）
  const downReturns = returns.filter(r => r < riskFreeRatePerTrade);
  const downStd = downReturns.length > 0
    ? Math.sqrt(downReturns.reduce((a, r) => a + Math.pow(r - riskFreeRatePerTrade, 2), 0) / downReturns.length)
    : 0;
  const sortino_ratio = downStd > 0 && annualFactor > 0 ? (excessRet / downStd) * annualFactor : 0;

  // Bug Fix: Calmar Ratio 改用實際回測期間年化（原公式指數有誤）
  const annualReturn = periodYears > 0
    ? Math.pow(1 + total_return_net, 1 / periodYears) - 1
    : 0;
  const calmar_ratio = maxDd > 0 ? annualReturn / maxDd : 0;

  // ── 月份統計 ──────────────────────────────────────────────────────────────
  const monthMap = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const t of trades) {
    const d = new Date(t.entry_time * 1000);
    // Bug Fix: 統一使用 UTC 時區，與 session_stats 一致
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = monthMap.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
    m.trades++;
    if (t.pnl_net_pct > 0) m.wins++;
    m.pnl += t.pnl_net_pct;
    monthMap.set(key, m);
  }
  const monthly_stats = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({
      month,
      trades: m.trades,
      wins: m.wins,
      win_rate: Math.round((m.wins / m.trades) * 1000) / 1000,
      pnl_pct: Math.round(m.pnl * 10000) / 10000,
    }));

  // ── 連勝連敗 ──────────────────────────────────────────────────────────────
  let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
  for (const t of trades) {
    if (t.pnl_net_pct > 0) { curWin++; curLoss = 0; if (curWin > maxWinStreak) maxWinStreak = curWin; }
    else { curLoss++; curWin = 0; if (curLoss > maxLossStreak) maxLossStreak = curLoss; }
  }

  // ── 時段分析（互斥分類，每筆交易只歸屬一個時段）──────────────────────────
  // UTC 時段定義（互斥，無重疊）：
  // 亞洲盤 00:00-07:59 UTC（台北 08:00-15:59）
  // 歐洲盤 08:00-12:59 UTC（倫敦 09:00-13:59 夏令）
  // 美洲盤 13:00-20:59 UTC（紐約 09:00-16:59 夏令）
  // 其他   21:00-23:59 UTC（亞洲早盤前）
  function classifySession(utcHour: number): string {
    if (utcHour >= 0  && utcHour < 8)  return '亞洲盤';
    if (utcHour >= 8  && utcHour < 13) return '歐洲盤';
    if (utcHour >= 13 && utcHour < 21) return '美洲盤';
    return '其他';
  }
  const sessionMap = new Map<string, { trades: number; wins: number; pnl: number }>([
    ['亞洲盤', { trades: 0, wins: 0, pnl: 0 }],
    ['歐洲盤', { trades: 0, wins: 0, pnl: 0 }],
    ['美洲盤', { trades: 0, wins: 0, pnl: 0 }],
    ['其他',   { trades: 0, wins: 0, pnl: 0 }],
  ]);
  for (const t of trades) {
    const h = new Date(t.entry_time * 1000).getUTCHours();
    const sessionName = classifySession(h);
    const s = sessionMap.get(sessionName)!;
    s.trades++;
    if (t.pnl_net_pct > 0) s.wins++;
    s.pnl += t.pnl_net_pct;
  }
  const session_stats = Array.from(sessionMap.entries())
    .filter(([, s]) => s.trades > 0) // 過濾無交易時段
    .map(([session, s]) => ({
      session,
      trades: s.trades,
      wins: s.wins,
      win_rate: s.trades > 0 ? Math.round((s.wins / s.trades) * 1000) / 1000 : 0,
      pnl_pct: Math.round(s.pnl * 10000) / 10000,
    }));

  // ── 回撤區間 ──────────────────────────────────────────────────────────────
  const drawdown_periods: { start: number; end: number; depth: number }[] = [];
  let inDd = false, ddStart = 0, ddPeak = 1.0, ddDepth = 0;
  for (let i = 0; i < equityCurve.length; i++) {
    const v = equityCurve[i];
    if (v > ddPeak) {
      ddPeak = v;
      if (inDd) { drawdown_periods.push({ start: ddStart, end: i - 1, depth: Math.round(ddDepth * 1000) / 1000 }); inDd = false; }
    }
    const dd = (ddPeak - v) / ddPeak;
    if (dd > 0.01 && !inDd) { inDd = true; ddStart = i; ddDepth = dd; }
    if (inDd && dd > ddDepth) ddDepth = dd;
  }
  if (inDd) drawdown_periods.push({ start: ddStart, end: equityCurve.length - 1, depth: Math.round(ddDepth * 1000) / 1000 });

  return {
    win_rate: Math.round(win_rate * 1000) / 1000,
    profit_factor: Math.round(profit_factor * 100) / 100,
    max_drawdown: Math.round(maxDd * 1000) / 1000,
    total_return: Math.round(total_return * 1000) / 1000,
    total_return_net: Math.round(total_return_net * 1000) / 1000,
    sharpe_ratio: Math.round(sharpe_ratio * 100) / 100,
    sortino_ratio: Math.round(sortino_ratio * 100) / 100,
    calmar_ratio: Math.round(calmar_ratio * 100) / 100,
    equity_curve: equityCurve,
    monthly_stats,
    max_win_streak: maxWinStreak,
    max_loss_streak: maxLossStreak,
    session_stats,
    drawdown_periods,
    total_fees_pct: Math.round(totalFees * 10000) / 10000,
    trailing_stop_count: trailingCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主回測函數（v2.0）
// ─────────────────────────────────────────────────────────────────────────────

// 各策略的標準雙時間框架設定
export const STRATEGY_MTF_CONFIG: Record<BacktestStrategy, { htf_mult: number; entry_mult: number; htf_label: string; entry_label: string }> = {
  // 趨勢策略：高級別定方向，低級別找進場
  ema_cross:       { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  macd:            { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  smc:             { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  pa:              { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  chan:             { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  liquidity_sweep:  { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  composite:        { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  cannonball:       { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  rsi_reversal:     { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  bollinger:        { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  vwap_reversion:  { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" },
  // HWR 模型：根據模型設計的雙時間框架
  hwr_model_a:     { htf_mult: 4, entry_mult: 1,    htf_label: "1H 定方向",   entry_label: "15m 找進場" }, // 1H定方向，15m找進場
  hwr_model_b:     { htf_mult: 4, entry_mult: 1,    htf_label: "4H 定趨勢",   entry_label: "1H 找回踩" },  // 4H定趨勢，1H找回踩
  hwr_model_c:     { htf_mult: 4, entry_mult: 1,    htf_label: "1H 定中樞",   entry_label: "15m 找邊界" }, // 1H定中樞，15m找邊界
  apex:            { htf_mult: 4, entry_mult: 1,    htf_label: "4x小時圖",   entry_label: "当前小時圖" }, // Apex 五層過濾策略
  elite:              { htf_mult: 4, entry_mult: 1,    htf_label: "4H 定趨勢",   entry_label: "1H 找回調" }, // Elite 精英策略
  hwr_model_a_elite:  { htf_mult: 4, entry_mult: 1,    htf_label: "4H 定趨勢",   entry_label: "1H 找設置" }, // HWR-A Elite 精選版
};

export function runBacktest(params: {
  candles:      Candle[];
  strategy:     BacktestStrategy;
  symbol:       string;
  interval:     string;
  atr_sl_mult?: number;
  atr_tp_mult?: number;
  // ★ 新增參數
  enable_mtf_filter?:     boolean;  // 啟用 MTF 趨勢過濾（預設 true）
  enable_fee?:            boolean;  // 啟用手續費計算（預設 true）
  enable_trailing_stop?:  boolean;  // 啟用移動止損（預設 true）
  enable_adx_filter?:     boolean;  // 啟用 ADX 震盪過濾（預設 true）
  enable_fvg_ob_filter?:  boolean;  // 啟用 FVG/OB 精準進場（預設 false，SMC 策略自動啟用）
  mtf_candles?:           Candle[]; // 大級別 K 線（用於 MTF 過濾）
  // ★ v3.0 雙時間框架真正 MTF 回測
  htf_candles?:           Candle[]; // 高級別 K 線（定方向）
  entry_candles?:         Candle[]; // 進場級別 K 線（找進場）
  use_true_mtf?:          boolean;  // 啟用真正雙時間框架回測（預設 false）
  // ★ v4.0 四層 MTF 共識系統
  candles_4h?:            Candle[]; // 4H K 線（定大方向，權重 40%）
  candles_1h?:            Candle[]; // 1H K 線（確認中期趨勢，權重 30%）
  candles_15m?:           Candle[]; // 15m K 線（找進場結構，權重 20%）
  candles_5m?:            Candle[]; // 5m K 線（精確時機，權重 10%）
  use_quad_mtf?:          boolean;  // 啟用四層 MTF 共識系統（預設 false）
  quad_mtf_threshold?:    number;   // 共識門檻（預設 0.5）
}): BacktestResult {
  const {
    candles, strategy, symbol, interval,
    enable_mtf_filter   = true,
    enable_fee          = true,
    enable_trailing_stop = true,
    enable_adx_filter   = true,
    enable_fvg_ob_filter = strategy === "smc", // SMC 策略預設啟用 FVG/OB
    mtf_candles,
    htf_candles,
    entry_candles,
    use_true_mtf = false,
    // v4.0 四層 MTF 共識參數
    candles_4h,
    candles_1h,
    candles_15m,
    candles_5m,
    use_quad_mtf = false,
    quad_mtf_threshold = 0.5,
  } = params;

  // v4.0 四層 MTF 共識模式：強制以 15m K 線為進場級別，共識過濾取代單一 HTF 過濾
  // v3.0 真正雙時間框架回測：若啟用 use_true_mtf 且有進場級別 K 線，則以進場級別為主要迭輸 K 線
  const primaryCandles = use_quad_mtf
    ? (candles_15m && candles_15m.length >= 50 ? candles_15m : candles)
    : (use_true_mtf && entry_candles && entry_candles.length >= 50) ? entry_candles : candles;
  const htfCandlesForFilter = use_quad_mtf
    ? null  // quad MTF 模式下不用單一 HTF，改用共識系統
    : (use_true_mtf && htf_candles && htf_candles.length >= 50) ? htf_candles
    : (mtf_candles && mtf_candles.length >= 50) ? mtf_candles
    : null;
  const slMult = params.atr_sl_mult ?? 1.5;
  const tpMult = params.atr_tp_mult ?? 3.0;

  if (candles.length < 50) {
    return {
      strategy, symbol, interval,
      total_trades: 0, win_rate: 0, profit_factor: 0,
      max_drawdown: 0, total_return: 0, total_return_net: 0, sharpe_ratio: 0,
      equity_curve: [1], trades: [],
      mtf_filtered_count: 0, total_fees_pct: 0, trailing_stop_count: 0,
      adx_filtered_count: 0, fvg_ob_entry_count: 0,
    };
  }

  // v3.0: 使用 primaryCandles 計算指標（真正 MTF 模式下為進場級別 K 線，一般模式下為原 candles）
  const closes = primaryCandles.map(c => c.close);
  const ema20   = calcEma(closes, 20);
  const ema50   = calcEma(closes, 50);
  const ema200  = calcEma(closes, 200);
  const rsi     = calcRsiArr(closes);
  const { hist: macdHist } = calcMacdArr(closes);
  // R6-FIX: calcBollingerArr 回傳 BollingerPoint[]，需分別提取 upper/lower 陣列
  const bollArr = calcBollingerArr(closes);
  const bollUpper = bollArr.map(b => b.upper);
  const bollLower = bollArr.map(b => b.lower);
  const atrArr  = calcAtrArr(primaryCandles);
  const { adx: adxArr, plusDi, minusDi } = calcAdxArr(primaryCandles);

  // MTF 趨勢：準備大級別 K 線
  // v3.0: 如果有 htfCandlesForFilter 就直接使用，否則對 primaryCandles 做 4x 降頻
  let downsampledCandles: Candle[] = [];
  if (enable_mtf_filter && !htfCandlesForFilter) {
    for (let i = 3; i < primaryCandles.length; i += 4) {
      downsampledCandles.push({
        time:   primaryCandles[i].time,
        open:   primaryCandles[i - 3].open,
        high:   Math.max(...primaryCandles.slice(i - 3, i + 1).map(c => c.high)),
        low:    Math.min(...primaryCandles.slice(i - 3, i + 1).map(c => c.low)),
        close:  primaryCandles[i].close,
        volume: primaryCandles.slice(i - 3, i + 1).reduce((a, c) => a + c.volume, 0),
      });
    }
  }

  const trades: BacktestTrade[] = [];
  let mtfFilteredCount = 0;
  let adxFilteredCount = 0;
  let fvgObEntryCount  = 0;

    // ★ 改良 6：冷卻期機制
  let cooldownUntil = 0;
  let consecutiveLosses = 0;
  const WARMUP = 210;

  // ★ v5.9 Opus 改良：市況分類（在主迴圈前計算一次，每 50 根更新一次）
  let currentRegime: MarketRegime = "ranging";
  let regimeUpdateAt = WARMUP;

  for (let i = WARMUP; i < primaryCandles.length - 1; i++) {
    // 檢查是否在冷卻期
    if (i < cooldownUntil) continue;
    const atr = atrArr[i];
    if (isNaN(atr) || atr <= 0) continue;

    // ★ v5.9 Opus 改良：每 50 根 K 線更新一次市況分類
    if (i >= regimeUpdateAt) {
      currentRegime = detectRegime(primaryCandles.slice(0, i + 1));
      regimeUpdateAt = i + 50;
    }
    // 動態共識門檻（根據市況調整）
    const dynamicThreshold = dynamicConsensusThreshold(currentRegime);

    // 動態計算當前 K 線時間點的 MTF 趨勢
    // v4.0: 四層 MTF 共識模式（use_quad_mtf=true）或 v3.0 雙時間框架模式
    let mtfTrend: MtfTrend = { direction: "neutral", ema20_above_ema50: false, price_above_ema200: false, adx: 0 };
    let quadConsensus: MtfConsensusResult | null = null;
    if (enable_mtf_filter) {
      const current_time = primaryCandles[i].time;
      if (use_quad_mtf) {
        // v4.0 四層共識模式：計算 4H/1H/15m/5m 加權共識（使用動態門檻）
        quadConsensus = calcMtfConsensus(
          candles_4h  ?? null,
          candles_1h  ?? null,
          candles_15m ?? null,
          candles_5m  ?? null,
          current_time,
          dynamicThreshold, // ★ 改良：使用動態門檻取代固定門檻
        );
        // 將共識結果轉換為 mtfTrend 格式（相容原有過濾邏輯）
        mtfTrend = {
          direction: quadConsensus.consensus_dir,
          ema20_above_ema50: quadConsensus.layers.find(l => l.timeframe === "4H")?.ema_aligned ?? false,
          price_above_ema200: false,
          adx: quadConsensus.layers.find(l => l.timeframe === "4H")?.adx ?? 0,
        };
      } else if (htfCandlesForFilter && htfCandlesForFilter.length >= 50) {
        const available_htf = htfCandlesForFilter.filter(c => c.time <= current_time);
        if (available_htf.length >= 50) mtfTrend = calcMtfTrend(available_htf);
      } else if (downsampledCandles.length >= 50) {
        const available_mtf = downsampledCandles.filter(c => c.time <= current_time);
        if (available_mtf.length >= 50) mtfTrend = calcMtfTrend(available_mtf);
      }
    }

    let sig: Signal = { direction: null };

    switch (strategy) {
      case "ema_cross":    sig = signalEmaCross(i, ema20, ema50); break;
      case "rsi_reversal": sig = signalRsiReversal(i, rsi, ema50, closes, primaryCandles); break;
      case "bollinger":    sig = signalBollinger(i, closes, bollUpper, bollLower, ema50, rsi); break;
      case "macd":         sig = signalMacd(i, macdHist, closes, ema50); break;
      case "smc":          sig = signalSmc(i, primaryCandles, ema200); break;
      case "pa":           sig = signalPa(i, primaryCandles, closes, rsi, ema20, ema50, ema200, macdHist, plusDi, minusDi); break;
      case "chan":             sig = signalChan(i, primaryCandles); break;
      case "liquidity_sweep":  sig = signalLiquiditySweep(i, primaryCandles, atrArr, ema200); break;
      case "vwap_reversion":   sig = signalVwapReversion(i, primaryCandles, atrArr, adxArr); break;
      case "composite":        sig = signalComposite(i, primaryCandles, closes, rsi, ema20, ema50, ema200, macdHist, plusDi, minusDi, atrArr); break;
      case "cannonball":       sig = signalCannonball(i, primaryCandles, ema50, atrArr); break;
      // HighWinRate 模型 A/B/C（使用模型自帶 SMC SL/TP）
      case "hwr_model_a":  sig = signalHwrModelA(i, primaryCandles, atrArr); break;
      case "hwr_model_b":  sig = signalHwrModelB(i, primaryCandles, ema50, atrArr, adxArr); break;
      case "hwr_model_c":  sig = signalHwrModelC(i, primaryCandles, atrArr); break;
      case "apex":          sig = signalApex(i, primaryCandles, atrArr, adxArr, htfCandlesForFilter ?? undefined); break;
      case "elite":             sig = signalElite(i, primaryCandles, atrArr, adxArr, ema20, ema50, ema200); break;
      case "hwr_model_a_elite": sig = signalHwrModelAElite(i, primaryCandles, atrArr, adxArr, ema20, ema50, ema200); break;
    }

    if (!sig.direction) continue;

    // ADX 震盪過濾：趨勢策略在 ADX < 20 時不進場（HWR 模型已內建過濾，跳過此檢查）
    const isHwrModel = ["hwr_model_a", "hwr_model_a_elite", "hwr_model_b", "hwr_model_c", "apex", "elite"].includes(strategy);
    const isTrendStrategy = ["ema_cross", "macd", "smc", "pa", "chan", "liquidity_sweep", "composite"].includes(strategy);
    if (!isHwrModel && enable_adx_filter && isTrendStrategy && !isNaN(adxArr[i]) && adxArr[i] < 20) {
      adxFilteredCount++;
      continue;
    }

    // MTF 趨勢過濾：HWR 模型已自帶趨勢方向確認，跳過 MTF 過濾避免雙重過濾
    let mtfPassed = true;
    if (!isHwrModel && enable_mtf_filter && mtfTrend.direction !== "neutral") {
      if (sig.direction === "long"  && mtfTrend.direction === "bearish") { mtfFilteredCount++; mtfPassed = false; }
      if (sig.direction === "short" && mtfTrend.direction === "bullish") { mtfFilteredCount++; mtfPassed = false; }
    }
    if (!mtfPassed) continue;

    // FVG/OB 精準進場過濾（四個已重構策略與 HWR 模型已內建區域/結構確認，避免雙重過濾）
    let entryType = sig.entry_type ?? "Standard";
    const skipExternalFvgObFilter = isHwrModel || strategy === "smc" || strategy === "pa" || strategy === "chan" || strategy === "composite";
    if (!skipExternalFvgObFilter && enable_fvg_ob_filter) {
      const fvgObCheck = checkFvgObEntry(primaryCandles, i, sig.direction);
      if (!fvgObCheck.inZone) continue;
      entryType = fvgObCheck.type;
      fvgObEntryCount++;
    }

    const entryPrice = primaryCandles[i + 1].open;

    // SL/TP 計算：HWR 模型使用模型自帶 SL/TP，其他策略使用動態 ATR SL/TP
    let sl: number, tp: number;
    const hasCustomLevels = sig.custom_sl !== undefined && sig.custom_tp !== undefined;
    if ((isHwrModel || strategy === "cannonball") && hasCustomLevels) {
      // 模型自帶 SL/TP：直接使用，不經過 ATR 計算
      sl = sig.custom_sl!;
      tp = sig.custom_tp!;
    } else {
      // R7-FIX + 方案二：動態 ATR 乘數（根據 ADX 趨勢強度調整盈虧比）
      // 方案二改良：趨勢市大幅延伸 TP，SL 統一縮緊至 1.5x 上限
      let currentSlMult = Math.min(slMult, 1.5);  // ★ 方案二：SL 上限 1.5 ATR（原 1.95 過寬）
      let currentTpMult = tpMult;
      const currentAdx = adxArr[i] ?? 0;
      if (currentAdx > 30) {
        // 強趨勢：TP 延伸至 2.5x 原始值（ADX>30 表示趨勢明確，應讓利潤奔跑）
        currentTpMult = Math.max(tpMult * 2.5, 0.5);
      } else if (currentAdx > 25) {
        // 中等趨勢：TP 延伸至 2x
        currentTpMult = Math.max(tpMult * 2.0, 0.4);
      } else if (currentAdx < 20) {
        // 震盪市：維持保守 TP，SL 進一步縮緊
        currentTpMult = tpMult * 0.8;
        currentSlMult = Math.min(slMult * 0.7, 1.2);
      }
      const slTp = calcDynamicSlTp(primaryCandles, i, sig.direction, atr, currentSlMult, currentTpMult, entryPrice);
      sl = slTp.sl;
      tp = slTp.tp;
    }

    const { exitIdx, exitPrice, reason } = findExitWithTrailing(
      primaryCandles, i + 1, sig.direction, sl, tp, 48, enable_trailing_stop
    );

    // ★ 改良 1：雙止盈邏輯（TP1 平倉 50%，TP2 平倉剩餘）
    // TP2 = TP1 往外延伸 50%（相同目標距離）
    const tp1 = tp;
    const tp1Dist = Math.abs(tp1 - entryPrice);
    const tp2 = sig.custom_tp2 !== undefined
      ? sig.custom_tp2
      : sig.direction === "long"
        ? entryPrice + tp1Dist * 2.0   // TP2 = 入場 + 2x TP1 距離
        : entryPrice - tp1Dist * 2.0;
    // 檢查 TP2 是否在出場前被觸及
    let tp2Hit = false;
    for (let j = i + 1; j <= exitIdx; j++) {
      const c = primaryCandles[j];
      if (sig.direction === "long"  && c.high >= tp2) { tp2Hit = true; break; }
      if (sig.direction === "short" && c.low  <= tp2) { tp2Hit = true; break; }
    }
    // v5.9 修復雙止盈 Bug：正確處理所有出場情境
    // 邏輯：觸及 TP1 後移動止損至成本，剩餘 50% 持倉到 TP2 或被止損出場
    // 先檢查是否曾觸及 TP1
    let tp1Hit = false;
    let tp1HitIdx = -1;
    for (let j = i + 1; j <= exitIdx; j++) {
      const c = primaryCandles[j];
      if (sig.direction === "long"  && c.high >= tp1) { tp1Hit = true; tp1HitIdx = j; break; }
      if (sig.direction === "short" && c.low  <= tp1) { tp1Hit = true; tp1HitIdx = j; break; }
    }
    let rawPnlPct: number;
    if (tp1Hit && tp2Hit) {
      // 全部觸及：TP1 50% + TP2 50%
      const pnl1 = sig.direction === "long" ? (tp1 - entryPrice) / entryPrice : (entryPrice - tp1) / entryPrice;
      const pnl2 = sig.direction === "long" ? (tp2 - entryPrice) / entryPrice : (entryPrice - tp2) / entryPrice;
      rawPnlPct = pnl1 * 0.5 + pnl2 * 0.5;
    } else if (tp1Hit && !tp2Hit) {
      // 觸及 TP1 後被止損或到期：50% 在 TP1，50% 在實際出場價
      const pnl1 = sig.direction === "long" ? (tp1 - entryPrice) / entryPrice : (entryPrice - tp1) / entryPrice;
      const pnl2 = sig.direction === "long" ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
      rawPnlPct = pnl1 * 0.5 + pnl2 * 0.5;
    } else {
      // 未觸及 TP1：全倉在實際出場價（止損或到期）
      rawPnlPct = sig.direction === "long"
        ? (exitPrice - entryPrice) / entryPrice
        : (entryPrice - exitPrice) / entryPrice;
    }

    // ★ v5.9 Opus 改良：動態滑點模型（根據幣種和波動率調整）
    const currentAtrPct = atr > 0 && entryPrice > 0 ? atr / entryPrice : 0;
    const dynamicSlip = calcDynamicSlippage(symbol, currentAtrPct);
    const dynamicFee  = enable_fee ? (TAKER_FEE + dynamicSlip) * 2 : 0;
    const feePct = dynamicFee;
    const netPnlPct = rawPnlPct - feePct;

    // 更新連續虧損次數與冷卻期
    if (netPnlPct <= 0) {
      consecutiveLosses++;
      if (consecutiveLosses >= 2) {
        cooldownUntil = exitIdx + 3;
        consecutiveLosses = 0;
      }
    } else {
      consecutiveLosses = 0;
    }

    // 判斷是否使用 Pivot Low 止損
    const usedPivotSl = sig.pivot_low !== undefined || sig.pivot_high !== undefined;

    trades.push({
      entry_time:  candles[i + 1].time,
      exit_time:   candles[exitIdx].time,
      direction:   sig.direction,
      entry_price: Math.round(entryPrice * 100) / 100,
      exit_price:  Math.round(exitPrice * 100) / 100,
      sl_price:    Math.round(sl * 100) / 100,
      tp_price:    Math.round(tp1 * 100) / 100,
      tp2_price:   Math.round(tp2 * 100) / 100,
      tp2_hit:     tp2Hit,
      pnl:         Math.round(rawPnlPct * entryPrice * 100) / 100,
      pnl_pct:     Math.round(rawPnlPct * 10000) / 10000,
      pnl_net_pct: Math.round(netPnlPct * 10000) / 10000,
      exit_reason: reason,
      fee_pct:     Math.round(feePct * 10000) / 10000,
      mtf_filter:  mtfPassed,
      entry_type:  entryType,
      signal_score: sig.score,
      pivot_sl:    usedPivotSl,
    });

    i = exitIdx;
  }

  // Bug Fix: interval 小時數解析，支援大小寫混用（如 1h/4h/1d）
  function parseIntervalHours(iv: string): number {
    const s = iv.trim().toLowerCase();
    const m = s.match(/^(\d+)(m|h|d|w)$/);
    if (!m) return 4; // 未知格式預設 4H
    const value = Number(m[1]);
    const unit  = m[2];
    if (unit === 'm') return value / 60;
    if (unit === 'h') return value;
    if (unit === 'd') return value * 24;
    if (unit === 'w') return value * 24 * 7;
    return 4;
  }
  const intervalHours = parseIntervalHours(interval);

  const stats = calcStats(trades, intervalHours);

  // v4.0 四層 MTF 共識統計計算
  const quadStats = use_quad_mtf ? (() => {
    let totalScore = 0, bullishCount = 0, bearishCount = 0, neutralCount = 0, fullConsensus = 0;
    let sampleCount = 0;
    // 對所有交易時間點重新計算共識統計
    for (const t of trades) {
      const cs = calcMtfConsensus(
        candles_4h ?? null, candles_1h ?? null,
        candles_15m ?? null, candles_5m ?? null,
        t.entry_time, quad_mtf_threshold
      );
      totalScore += cs.consensus_score;
      if (cs.consensus_dir === "bullish") bullishCount++;
      else if (cs.consensus_dir === "bearish") bearishCount++;
      else neutralCount++;
      if (cs.bullish_layers === 4 || cs.bearish_layers === 4) fullConsensus++;
      sampleCount++;
    }
    const n = sampleCount || 1;
    return {
      avg_score:     Math.round(totalScore / n * 1000) / 1000,
      bullish_pct:   Math.round(bullishCount / n * 100),
      bearish_pct:   Math.round(bearishCount / n * 100),
      neutral_pct:   Math.round(neutralCount / n * 100),
      full_consensus: fullConsensus,
      quad_filtered:  mtfFilteredCount,
    };
  })() : undefined;

  return {
    strategy,
    symbol,
    interval,
    total_trades: trades.length,
    ...stats,
    trades,
    mtf_filtered_count: mtfFilteredCount,
    adx_filtered_count: adxFilteredCount,
    fvg_ob_entry_count: fvgObEntryCount,
    quad_mtf_enabled: use_quad_mtf,
    quad_consensus_stats: quadStats,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 新增：Monte Carlo 模擬（評估策略統計穩健性）
// ─────────────────────────────────────────────────────────────────────────────

export interface MonteCarloResult {
  iterations:       number;
  p5_return:        number;   // 5百分位收益（最差情境）
  p50_return:       number;   // 中位數收益
  p95_return:       number;   // 95百分位收益（最佳情境）
  p5_max_drawdown:  number;   // 5百分位回撤（最小回撤）
  p95_max_drawdown: number;   // 95百分位回撤（最大回撤）
  ruin_probability: number;   // 爆倉機率（回撤 > 50%）
  expected_return:  number;   // 期望收益（平均）
}

/**
 * Monte Carlo 模擬：透過隨機打亂交易順序（Bootstrap）評估策略統計穩健性
 * @param trades 回測交易列表
 * @param iterations 模擬次數（預設 3000）
 * @param ruinThreshold 爆倉定義回撤閾値（預設 50%）
 */
export function runMonteCarlo(
  trades: BacktestTrade[],
  iterations = 3000,
  ruinThreshold = 0.5
): MonteCarloResult {
  if (trades.length === 0) {
    return {
      iterations: 0,
      p5_return: 0, p50_return: 0, p95_return: 0,
      p5_max_drawdown: 0, p95_max_drawdown: 0,
      ruin_probability: 0, expected_return: 0,
    };
  }

  const simResults: { ret: number; maxDD: number }[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    // Fisher-Yates 洗牌打亂交易順序
    const shuffled = [...trades];
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
    }

    let equity = 1.0;
    let peak   = 1.0;
    let maxDD  = 0.0;

    for (const t of shuffled) {
      equity *= (1 + t.pnl_net_pct);
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    simResults.push({
      ret:   Math.round((equity - 1) * 10000) / 10000,
      maxDD: Math.round(maxDD * 10000) / 10000,
    });
  }

  // 排序計算百分位
  simResults.sort((a, b) => a.ret - b.ret);
  const ddSorted = [...simResults].sort((a, b) => a.maxDD - b.maxDD);

  const p5Idx  = Math.floor(iterations * 0.05);
  const p50Idx = Math.floor(iterations * 0.50);
  const p95Idx = Math.floor(iterations * 0.95);

  const expectedReturn = simResults.reduce((s, r) => s + r.ret, 0) / iterations;
  const ruinCount      = simResults.filter(r => r.maxDD >= ruinThreshold).length;

  return {
    iterations,
    p5_return:        simResults[p5Idx].ret,
    p50_return:       simResults[p50Idx].ret,
    p95_return:       simResults[p95Idx].ret,
    p5_max_drawdown:  ddSorted[p5Idx].maxDD,
    p95_max_drawdown: ddSorted[p95Idx].maxDD,
    ruin_probability: Math.round((ruinCount / iterations) * 10000) / 10000,
    expected_return:  Math.round(expectedReturn * 10000) / 10000,
  };
}

// 匙出 fetchCandles（供 routers.ts 使用）
export { fetchCandles };
