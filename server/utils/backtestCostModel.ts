/**
 * backtestCostModel.ts  v1.0
 * Event-driven 回測成本模型
 *
 * GPT-5.4 審查建議：原回測系統缺少成本模型，導致回測獲利被高估
 * 本模組新增：
 *  [COST1] 手續費模型（Maker/Taker 分開計算）
 *  [COST2] 滑點模型（ATR 比例 + 流動性調整）
 *  [COST3] 資金費率模型（永續合約持倉成本，每 8 小時結算）
 *  [COST4] BacktestCostConfig 介面（可配置各交易所費率）
 *  [COST5] applyTradeCosts() 統一成本計算入口
 *  [COST6] calcNetBacktestStats() 扣除成本後的績效統計
 */

import type { Candle } from "../../shared/cryptoTypes.js";

// ─────────────────────────────────────────────────────────────────────────────
// [COST4] 成本配置介面
// ─────────────────────────────────────────────────────────────────────────────

export interface BacktestCostConfig {
  /** Maker 手續費率（限價單，預設 Binance Futures 0.02%） */
  makerFeeRate: number;
  /** Taker 手續費率（市價單，預設 Binance Futures 0.05%） */
  takerFeeRate: number;
  /** 進場是否使用限價單（true = Maker，false = Taker） */
  entryIsMaker: boolean;
  /** 出場是否使用限價單（TP 用限價，SL 用市價） */
  exitTpIsMaker: boolean;
  exitSlIsMaker: boolean;
  /** 滑點係數（ATR 的倍數，預設 0.1 = 10% ATR） */
  slippageAtrMultiplier: number;
  /** 資金費率（每 8 小時，預設 0.01% = 年化 10.95%） */
  fundingRatePer8h: number;
  /** K 棒時間框（分鐘），用於計算持倉時間 */
  timeframeMinutes: number;
}

/** 預設費率配置（Binance Futures 一般用戶） */
export const DEFAULT_COST_CONFIG: BacktestCostConfig = {
  makerFeeRate: 0.0002,       // 0.02%
  takerFeeRate: 0.0005,       // 0.05%
  entryIsMaker: false,        // 市價進場（Taker）
  exitTpIsMaker: true,        // 限價 TP（Maker）
  exitSlIsMaker: false,       // 市價 SL（Taker）
  slippageAtrMultiplier: 0.1, // 滑點 = 10% ATR
  fundingRatePer8h: 0.0001,   // 0.01% per 8h
  timeframeMinutes: 15,       // 預設 15 分鐘 K 棒
};

/** VIP 費率配置（Binance Futures VIP3+） */
export const VIP_COST_CONFIG: BacktestCostConfig = {
  makerFeeRate: 0.00012,
  takerFeeRate: 0.00030,
  entryIsMaker: true,         // 限價進場
  exitTpIsMaker: true,
  exitSlIsMaker: false,
  slippageAtrMultiplier: 0.05,
  fundingRatePer8h: 0.0001,
  timeframeMinutes: 15,
};

// ─────────────────────────────────────────────────────────────────────────────
// [COST1] 手續費計算
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 計算單筆交易的手續費成本（雙邊）
 * @returns 手續費佔進場價格的百分比（已包含進場 + 出場）
 */
export function calcCommissionCost(
  exitReason: "TP1" | "TP2" | "SL" | "TIMEOUT",
  config: BacktestCostConfig,
): number {
  const entryFee = config.entryIsMaker ? config.makerFeeRate : config.takerFeeRate;
  let exitFee: number;
  if (exitReason === "SL") {
    exitFee = config.exitSlIsMaker ? config.makerFeeRate : config.takerFeeRate;
  } else if (exitReason === "TIMEOUT") {
    exitFee = config.takerFeeRate; // 超時強平用市價
  } else {
    exitFee = config.exitTpIsMaker ? config.makerFeeRate : config.takerFeeRate;
  }
  // 雙邊手續費（進場 + 出場），以百分比表示
  return (entryFee + exitFee) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// [COST2] 滑點計算
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 計算滑點成本（基於 ATR 比例）
 * 原理：市場流動性越差（ATR 越大相對於價格），滑點越大
 * @param entryPrice 進場價格
 * @param atr 當前 ATR 值
 * @param config 成本配置
 * @returns 滑點佔進場價格的百分比（雙邊）
 */
export function calcSlippageCost(
  entryPrice: number,
  atr: number,
  exitReason: "TP1" | "TP2" | "SL" | "TIMEOUT",
  config: BacktestCostConfig,
): number {
  if (entryPrice <= 0 || atr <= 0) return 0;
  const atrRatio = atr / entryPrice; // ATR 相對於價格的比例
  // 進場滑點
  const entrySlippage = config.entryIsMaker ? 0 : atrRatio * config.slippageAtrMultiplier;
  // 出場滑點（SL 和 TIMEOUT 通常有更大滑點）
  const exitSlippageMultiplier = (exitReason === "SL" || exitReason === "TIMEOUT") ? 1.5 : 0.5;
  const exitSlippage = atrRatio * config.slippageAtrMultiplier * exitSlippageMultiplier;
  return (entrySlippage + exitSlippage) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// [COST3] 資金費率計算
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 計算持倉期間的資金費率成本
 * 永續合約每 8 小時結算一次資金費率
 * @param holdBars 持倉 K 棒數
 * @param timeframeMinutes K 棒時間框（分鐘）
 * @param fundingRatePer8h 每 8 小時資金費率
 * @returns 資金費率佔倉位的百分比
 */
export function calcFundingCost(
  holdBars: number,
  timeframeMinutes: number,
  fundingRatePer8h: number,
): number {
  // 持倉時間（小時）
  const holdHours = (holdBars * timeframeMinutes) / 60;
  // 資金費率結算次數（每 8 小時一次）
  const fundingPeriods = holdHours / 8;
  // 總資金費率成本（百分比）
  return fundingPeriods * fundingRatePer8h * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// [COST5] 統一成本計算入口
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeCostBreakdown {
  /** 毛利率（未扣除成本） */
  gross_pnl_pct: number;
  /** 手續費成本（百分比） */
  commission_pct: number;
  /** 滑點成本（百分比） */
  slippage_pct: number;
  /** 資金費率成本（百分比） */
  funding_pct: number;
  /** 總成本（百分比） */
  total_cost_pct: number;
  /** 淨利率（扣除所有成本後） */
  net_pnl_pct: number;
  /** 持倉 K 棒數 */
  hold_bars: number;
}

/**
 * [COST5] 計算單筆交易的完整成本明細
 * @param grossPnlPct 毛利率（未扣除成本）
 * @param entryPrice 進場價格
 * @param atr 進場時的 ATR
 * @param holdBars 持倉 K 棒數
 * @param exitReason 出場原因
 * @param config 成本配置
 * @returns 完整成本明細
 */
export function applyTradeCosts(
  grossPnlPct: number,
  entryPrice: number,
  atr: number,
  holdBars: number,
  exitReason: "TP1" | "TP2" | "SL" | "TIMEOUT",
  config: BacktestCostConfig = DEFAULT_COST_CONFIG,
): TradeCostBreakdown {
  const commissionPct = calcCommissionCost(exitReason, config);
  const slippagePct = calcSlippageCost(entryPrice, atr, exitReason, config);
  const fundingPct = calcFundingCost(holdBars, config.timeframeMinutes, config.fundingRatePer8h);
  const totalCostPct = commissionPct + slippagePct + fundingPct;
  const netPnlPct = grossPnlPct - totalCostPct;

  return {
    gross_pnl_pct: Math.round(grossPnlPct * 10000) / 10000,
    commission_pct: Math.round(commissionPct * 10000) / 10000,
    slippage_pct: Math.round(slippagePct * 10000) / 10000,
    funding_pct: Math.round(fundingPct * 10000) / 10000,
    total_cost_pct: Math.round(totalCostPct * 10000) / 10000,
    net_pnl_pct: Math.round(netPnlPct * 10000) / 10000,
    hold_bars: holdBars,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// [COST6] 扣除成本後的績效統計
// ─────────────────────────────────────────────────────────────────────────────

export interface CostAdjustedStats {
  /** 毛利率統計 */
  gross: {
    total_pnl_pct: number;
    win_rate: number;
    profit_factor: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
  };
  /** 淨利率統計（扣除成本後） */
  net: {
    total_pnl_pct: number;
    win_rate: number;
    profit_factor: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
  };
  /** 成本摘要 */
  cost_summary: {
    avg_commission_pct: number;
    avg_slippage_pct: number;
    avg_funding_pct: number;
    avg_total_cost_pct: number;
    total_cost_drag_pct: number; // 總成本拖累（所有交易的成本總和）
  };
  /** 成本侵蝕率（成本佔毛利的比例） */
  cost_erosion_rate: number;
}

/**
 * [COST6] 計算扣除成本後的完整績效統計
 * @param trades 包含 gross_pnl_pct 和 net_pnl_pct 的交易陣列
 */
export function calcNetBacktestStats(
  trades: TradeCostBreakdown[],
): CostAdjustedStats {
  if (trades.length === 0) {
    const empty = { total_pnl_pct: 0, win_rate: 0, profit_factor: 0, sharpe_ratio: 0, max_drawdown_pct: 0 };
    return { gross: empty, net: empty, cost_summary: { avg_commission_pct: 0, avg_slippage_pct: 0, avg_funding_pct: 0, avg_total_cost_pct: 0, total_cost_drag_pct: 0 }, cost_erosion_rate: 0 };
  }

  const calcStats = (pnlArr: number[]) => {
    const wins = pnlArr.filter(p => p > 0.01);
    const losses = pnlArr.filter(p => p < -0.01);
    const totalPnl = pnlArr.reduce((a, b) => a + b, 0);
    const winRate = pnlArr.length > 0 ? wins.length / pnlArr.length : 0;
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
    const avgPnl = totalPnl / pnlArr.length;
    const stdPnl = Math.sqrt(pnlArr.reduce((s, v) => s + Math.pow(v - avgPnl, 2), 0) / pnlArr.length);
    const sharpeRatio = stdPnl > 0 ? avgPnl / stdPnl : 0;
    // 最大回撤
    let peak = 0, maxDD = 0, cum = 0;
    for (const p of pnlArr) {
      cum += p;
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > maxDD) maxDD = dd;
    }
    return {
      total_pnl_pct: Math.round(totalPnl * 100) / 100,
      win_rate: Math.round(winRate * 1000) / 10,
      profit_factor: Math.round(profitFactor * 100) / 100,
      sharpe_ratio: Math.round(sharpeRatio * 100) / 100,
      max_drawdown_pct: Math.round(maxDD * 100) / 100,
    };
  };

  const grossStats = calcStats(trades.map(t => t.gross_pnl_pct));
  const netStats = calcStats(trades.map(t => t.net_pnl_pct));

  const avgCommission = trades.reduce((s, t) => s + t.commission_pct, 0) / trades.length;
  const avgSlippage = trades.reduce((s, t) => s + t.slippage_pct, 0) / trades.length;
  const avgFunding = trades.reduce((s, t) => s + t.funding_pct, 0) / trades.length;
  const avgTotalCost = trades.reduce((s, t) => s + t.total_cost_pct, 0) / trades.length;
  const totalCostDrag = trades.reduce((s, t) => s + t.total_cost_pct, 0);

  const grossTotalPnl = Math.abs(grossStats.total_pnl_pct);
  const costErosionRate = grossTotalPnl > 0 ? totalCostDrag / grossTotalPnl : 0;

  return {
    gross: grossStats,
    net: netStats,
    cost_summary: {
      avg_commission_pct: Math.round(avgCommission * 10000) / 10000,
      avg_slippage_pct: Math.round(avgSlippage * 10000) / 10000,
      avg_funding_pct: Math.round(avgFunding * 10000) / 10000,
      avg_total_cost_pct: Math.round(avgTotalCost * 10000) / 10000,
      total_cost_drag_pct: Math.round(totalCostDrag * 100) / 100,
    },
    cost_erosion_rate: Math.round(costErosionRate * 1000) / 10,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具：從 K 棒陣列計算 ATR（用於滑點估算）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 快速計算最近 N 根 K 棒的 ATR（用於成本模型中的滑點估算）
 */
export function quickAtr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const slice = candles.slice(-Math.min(period + 1, candles.length));
  let atrSum = 0;
  let count = 0;
  for (let i = 1; i < slice.length; i++) {
    const cur = slice[i];
    const prev = slice[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    atrSum += tr;
    count++;
  }
  return count > 0 ? atrSum / count : 0;
}
