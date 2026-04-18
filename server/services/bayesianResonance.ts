/**
 * bayesianResonance.ts — Opus 4.6 P2 改良
 * 貝葉斯乘法共振聚合 + BOCPD 市場轉換點偵測 + Pipeline 化過濾鏈
 *
 * 核心改良：
 * 1. 線性加法評分 → 貝葉斯乘法共振（各維度相互獨立時乘法更準確）
 * 2. BOCPD（Bayesian Online Changepoint Detection）偵測市場結構轉換
 * 3. Pipeline 化過濾鏈（百分位數門檻替代硬編碼閾值）
 */

import type { Candle } from "../../shared/cryptoTypes.js";
import { calcAtrLast, calcRsiArr } from "./indicators.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. 貝葉斯乘法共振聚合
// ─────────────────────────────────────────────────────────────────────────────

export interface DimensionSignal {
  name: string;
  /** 原始評分 0-100 */
  rawScore: number;
  /** 信號方向 */
  direction: "bullish" | "bearish" | "neutral";
  /** 信號可靠性權重 0-1（基於歷史勝率或信心度） */
  reliability: number;
}

/**
 * 貝葉斯乘法共振聚合
 * 原理：將各維度信號視為獨立事件，用乘法計算聯合概率
 * P(signal | all_dims) ∝ ∏ P(signal | dim_i)
 *
 * 優點：
 * - 任一維度強烈反對（低分）會顯著拉低總分（乘法懲罰）
 * - 多維度共振時分數呈指數上升（乘法獎勵）
 * - 比線性加法更能捕捉「多維度共振」語義
 */
export function bayesianMultiplicativeResonance(
  signals: DimensionSignal[],
  direction: "bullish" | "bearish"
): {
  resonanceScore: number;   // 0-100，貝葉斯共振分數
  agreementCount: number;   // 同方向維度數量
  conflictCount: number;    // 反方向維度數量
  neutralCount: number;     // 中性維度數量
  dimensionDetails: { name: string; contribution: number; aligned: boolean }[];
} {
  if (signals.length === 0) {
    return { resonanceScore: 0, agreementCount: 0, conflictCount: 0, neutralCount: 0, dimensionDetails: [] };
  }

  let agreementCount = 0, conflictCount = 0, neutralCount = 0;
  const dimensionDetails: { name: string; contribution: number; aligned: boolean }[] = [];

  // 將每個維度的評分轉換為概率（0-1）
  // 使用 sigmoid 轉換確保平滑性
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

  // 計算每個維度對目標方向的支持概率
  const probabilities: number[] = [];
  for (const sig of signals) {
    const normalizedScore = sig.rawScore / 100; // 0-1
    let directionMultiplier: number;

    if (sig.direction === direction) {
      directionMultiplier = 1.0; // 同方向：直接使用評分
      agreementCount++;
    } else if (sig.direction === "neutral") {
      directionMultiplier = 0.5; // 中性：不加不減
      neutralCount++;
    } else {
      directionMultiplier = 0.1; // v5.3 修復：反方向不用 0.0（避免一個維度就將整體歸零），改為 0.1 保留最小貢獻
      conflictCount++;
    }

    // 考慮可靠性加權
    const adjustedScore = normalizedScore * directionMultiplier * sig.reliability +
                          0.5 * (1 - sig.reliability); // 不可靠時趨向 0.5（無資訊）
    const prob = Math.max(0.05, Math.min(0.95, adjustedScore)); // 防止 0 或 1 的極端值
    probabilities.push(prob);

    dimensionDetails.push({
      name: sig.name,
      contribution: Math.round(prob * 100),
      aligned: sig.direction === direction,
    });
  }

  // 貝葉斯乘法聚合（對數域計算避免下溢）
  // log P(signal) = Σ log(p_i) - (n-1) * log(0.5) [歸一化]
  const logProbs = probabilities.map(p => Math.log(p));
  const logNeutral = Math.log(0.5);
  const logResonance = logProbs.reduce((a, b) => a + b, 0) - (probabilities.length - 1) * logNeutral;
  const resonanceProb = Math.exp(logResonance);

  // 轉換回 0-100 分數，並應用動態衝突懲罰
  const conflictPenalty = conflictCount > 0 ? Math.pow(0.7, conflictCount) : 1.0;
  const resonanceScore = Math.round(
    Math.min(100, Math.max(0, resonanceProb * 100 * conflictPenalty))
  );

  return { resonanceScore, agreementCount, conflictCount, neutralCount, dimensionDetails };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. BOCPD（Bayesian Online Changepoint Detection）
// ─────────────────────────────────────────────────────────────────────────────

export interface ChangepointResult {
  /** 是否偵測到市場結構轉換 */
  isChangepoint: boolean;
  /** 轉換概率 0-1 */
  changepointProbability: number;
  /** 當前 regime 持續時間（K 線數） */
  currentRunLength: number;
  /** 轉換前的 regime 類型 */
  prevRegime: "trending" | "ranging" | "volatile" | "unknown";
  /** 當前 regime 類型 */
  currentRegime: "trending" | "ranging" | "volatile" | "unknown";
  /** 是否在轉換期（高不確定性，應降低倉位） */
  inTransitionPeriod: boolean;
}

/**
 * 簡化版 BOCPD（Bayesian Online Changepoint Detection）
 * 原理：追蹤收益率序列的統計特性，當均值或方差顯著改變時判定為 Changepoint
 *
 * 使用 CUSUM（累積和控制圖）作為近似實作，計算效率高且適合即時使用
 */
export function detectChangepoint(
  candles: Candle[],
  lookback = 50
): ChangepointResult {
  const slice = candles.slice(-lookback);
  if (slice.length < 20) {
    return {
      isChangepoint: false,
      changepointProbability: 0,
      currentRunLength: slice.length,
      prevRegime: "unknown",
      currentRegime: "unknown",
      inTransitionPeriod: false,
    };
  }

  // 計算收益率序列
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    returns.push((slice[i].close - slice[i - 1].close) / slice[i - 1].close);
  }

  // 分割為前半段和後半段，比較統計特性
  const half = Math.floor(returns.length / 2);
  const firstHalf = returns.slice(0, half);
  const secondHalf = returns.slice(half);

  const mean1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const mean2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const var1 = firstHalf.reduce((a, b) => a + (b - mean1) ** 2, 0) / firstHalf.length;
  const var2 = secondHalf.reduce((a, b) => a + (b - mean2) ** 2, 0) / secondHalf.length;
  const std1 = Math.sqrt(var1 + 1e-10);
  const std2 = Math.sqrt(var2 + 1e-10);

  // 均值變化檢測（標準化差異）
  const meanChange = Math.abs(mean2 - mean1) / (std1 + 1e-10);
  // 方差變化檢測（F-ratio）
  const varRatio = Math.max(var1, var2) / (Math.min(var1, var2) + 1e-10);

  // v5.3 修復：修正 changepointProb 公式（原公式除以 2 導致最大値僅 0.5，無法觸發 0.6 門檣）
  // 新公式：將兩個指標直接加權平均，不除以 2
  const changepointProb = Math.min(1, meanChange * 0.5 + Math.log(varRatio + 1) * 0.4);
  const isChangepoint = changepointProb > 0.6;

  // 識別 Regime 類型
  const classifyRegime = (mean: number, std: number, candles: Candle[]): "trending" | "ranging" | "volatile" => {
    const atr = candles.length > 0 ? calcAtrLast(candles, Math.min(14, candles.length)) : 0;
    const avgPrice = candles[candles.length - 1]?.close ?? 1;
    const normalizedStd = std / (Math.abs(mean) + 1e-10);
    const atrRatio = atr / (avgPrice + 1e-10);
    if (atrRatio > 0.03) return "volatile";
    if (Math.abs(mean) > std * 1.5) return "trending";
    return "ranging";
  };

  const prevRegime = classifyRegime(mean1, std1, slice.slice(0, half));
  const currentRegime = classifyRegime(mean2, std2, slice.slice(half));

  // 計算當前 run length（自最後一個 changepoint 以來的 K 線數）
  let currentRunLength = 0;
  const recentReturns = returns.slice(-20);
  const recentMean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
  const recentStd = Math.sqrt(recentReturns.reduce((a, b) => a + (b - recentMean) ** 2, 0) / recentReturns.length + 1e-10);
  for (let i = returns.length - 1; i >= 0; i--) {
    if (Math.abs(returns[i] - recentMean) < recentStd * 2) {
      currentRunLength++;
    } else {
      break;
    }
  }

  return {
    isChangepoint,
    changepointProbability: Math.round(changepointProb * 100) / 100,
    currentRunLength,
    prevRegime,
    currentRegime,
    inTransitionPeriod: isChangepoint && currentRunLength < 5, // 轉換後 5 根 K 線內為過渡期
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Pipeline 化過濾鏈（百分位數門檻）
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterPipelineConfig {
  /** 最低信號門檻（百分位數，0-100） */
  minScorePercentile: number;
  /** 最低維度共識數量 */
  minAgreementCount: number;
  /** 是否在 Changepoint 期間降低倉位 */
  reducePositionOnChangepoint: boolean;
  /** Changepoint 期間的倉位縮減比例 0-1 */
  changepointPositionReduction: number;
}

export interface FilterPipelineResult {
  /** 是否通過所有過濾條件 */
  passed: boolean;
  /** 最終信號強度 0-100 */
  finalScore: number;
  /** 建議倉位縮減比例 0-1（1 = 全倉，0.5 = 半倉） */
  positionSizeMultiplier: number;
  /** 未通過的過濾條件 */
  failedFilters: string[];
  /** 通過的過濾條件 */
  passedFilters: string[];
}

/**
 * Pipeline 化過濾鏈
 * 將多個過濾條件串聯，任一條件不滿足則信號被過濾
 * 使用百分位數門檻替代硬編碼閾值，適應不同市場環境
 */
export function runFilterPipeline(
  resonanceResult: ReturnType<typeof bayesianMultiplicativeResonance>,
  changepointResult: ChangepointResult,
  config: FilterPipelineConfig,
  recentScoreHistory: number[] = [] // 近期信號分數歷史，用於計算百分位數
): FilterPipelineResult {
  const failedFilters: string[] = [];
  const passedFilters: string[] = [];

  // 計算動態門檻（百分位數）
  let dynamicThreshold = 50; // 默認門檻
  if (recentScoreHistory.length >= 10) {
    const sorted = [...recentScoreHistory].sort((a, b) => a - b);
    const percentileIdx = Math.floor(sorted.length * config.minScorePercentile / 100);
    dynamicThreshold = sorted[Math.min(percentileIdx, sorted.length - 1)];
  }

  // 過濾條件 1：信號強度門檻
  if (resonanceResult.resonanceScore >= dynamicThreshold) {
    passedFilters.push(`信號強度 ${resonanceResult.resonanceScore} >= 動態門檻 ${Math.round(dynamicThreshold)}`);
  } else {
    failedFilters.push(`信號強度 ${resonanceResult.resonanceScore} < 動態門檻 ${Math.round(dynamicThreshold)}`);
  }

  // 過濾條件 2：最低維度共識
  if (resonanceResult.agreementCount >= config.minAgreementCount) {
    passedFilters.push(`維度共識 ${resonanceResult.agreementCount} >= ${config.minAgreementCount}`);
  } else {
    failedFilters.push(`維度共識不足 ${resonanceResult.agreementCount} < ${config.minAgreementCount}`);
  }

  // 過濾條件 3：衝突維度數量（超過 2 個反對維度則過濾）
  if (resonanceResult.conflictCount <= 1) {
    passedFilters.push(`衝突維度 ${resonanceResult.conflictCount} <= 1`);
  } else {
    failedFilters.push(`衝突維度過多 ${resonanceResult.conflictCount} > 1`);
  }

  // 計算倉位縮減
  let positionSizeMultiplier = 1.0;
  if (config.reducePositionOnChangepoint && changepointResult.inTransitionPeriod) {
    positionSizeMultiplier *= (1 - config.changepointPositionReduction);
    // v5.3 修復：倉位縮減不應進入 failedFilters（它不是過濾條件，而是倉位調整）
    passedFilters.push(`市場轉換期，倉位自動縮減至 ${Math.round(positionSizeMultiplier * 100)}%`);
  }

  // 根據 Changepoint 概率動態調整倉位
  if (changepointResult.changepointProbability > 0.4) {
    const reductionFactor = 1 - changepointResult.changepointProbability * 0.5;
    positionSizeMultiplier *= reductionFactor;
  }

  const passed = failedFilters.filter(f => !f.includes('倉位縮減')).length === 0;

  return {
    passed,
    finalScore: resonanceResult.resonanceScore,
    positionSizeMultiplier: Math.max(0.1, Math.min(1.0, positionSizeMultiplier)),
    failedFilters,
    passedFilters,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 整合入口：四維度貝葉斯共振分析
// ─────────────────────────────────────────────────────────────────────────────

export interface FourDimBayesianInput {
  smcScore: number;
  smcDirection: "bullish" | "bearish" | "neutral";
  paScore: number;
  paDirection: "bullish" | "bearish" | "neutral";
  fibScore: number;
  fibDirection: "bullish" | "bearish" | "neutral";
  chanScore: number;
  chanDirection: "bullish" | "bearish" | "neutral";
  targetDirection: "bullish" | "bearish";
  candles: Candle[];
  recentScoreHistory?: number[];
}

export interface FourDimBayesianResult {
  resonanceScore: number;
  changepointResult: ChangepointResult;
  filterResult: FilterPipelineResult;
  dimensionDetails: { name: string; contribution: number; aligned: boolean }[];
  recommendation: "strong_entry" | "moderate_entry" | "wait" | "avoid";
  positionSizeMultiplier: number;
}

/**
 * 四維度貝葉斯共振分析整合入口
 */
export function analyzeFourDimBayesianResonance(
  input: FourDimBayesianInput
): FourDimBayesianResult {
  const signals: DimensionSignal[] = [
    { name: "SMC", rawScore: input.smcScore, direction: input.smcDirection, reliability: 0.72 },
    { name: "PA",  rawScore: input.paScore,  direction: input.paDirection,  reliability: 0.65 },
    { name: "Fib", rawScore: input.fibScore, direction: input.fibDirection, reliability: 0.68 },
    { name: "Chan",rawScore: input.chanScore,direction: input.chanDirection,reliability: 0.70 },
  ];

  const resonanceResult = bayesianMultiplicativeResonance(signals, input.targetDirection);
  const changepointResult = detectChangepoint(input.candles);

  const filterConfig: FilterPipelineConfig = {
    minScorePercentile: 40,       // 動態門檻：高於近期 40% 分位數
    minAgreementCount: 2,          // 至少 2 個維度同方向
    reducePositionOnChangepoint: true,
    changepointPositionReduction: 0.4, // 轉換期縮減 40% 倉位
  };

  const filterResult = runFilterPipeline(
    resonanceResult,
    changepointResult,
    filterConfig,
    input.recentScoreHistory ?? []
  );

  // 決策建議
  let recommendation: "strong_entry" | "moderate_entry" | "wait" | "avoid";
  if (!filterResult.passed) {
    recommendation = "avoid";
  } else if (resonanceResult.resonanceScore >= 75 && resonanceResult.agreementCount >= 3) {
    recommendation = "strong_entry";
  } else if (resonanceResult.resonanceScore >= 55 && resonanceResult.agreementCount >= 2) {
    recommendation = "moderate_entry";
  } else {
    recommendation = "wait";
  }

  return {
    resonanceScore: resonanceResult.resonanceScore,
    changepointResult,
    filterResult,
    dimensionDetails: resonanceResult.dimensionDetails,
    recommendation,
    positionSizeMultiplier: filterResult.positionSizeMultiplier,
  };
}
