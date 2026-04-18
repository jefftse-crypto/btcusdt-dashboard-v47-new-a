/**
 * Ensemble Veto System v1.2
 *
 * v1.2 改良（GPT-5.4 分析報告修復）：
 * [E1] 修正說明非對稱問題：RuleEngine 現在分別回傳 positiveFactors / negativeFactors，
 *      不再將兩者混入同一個 reasons 陣列，最終結果的 keyFactors 展示正面因素，
 *      vetoReasons 展示負面因素（無論最終決策為何）
 * [E2] 修正 QuantScorer 分母問題：多模型共識改為只計算 is_active 的模型中同方向比例，
 *      而非用全部模型數量（含非活躍模型）作分母，避免低估共識強度
 * [E3] 改為 confidence-space 聚合：最終信心度由三個評估器的數值加權平均，
 *      而非先轉換為離散投票再聚合，保留更多量化資訊
 * [E4] 共識強度計算改為基於評分差異（而非離散投票數量），更能反映真實分歧程度
 *
 * v1.1 改良（v5.1）：
 * - Bug 修復：baseConfidence 計算中 AI 分固定為 50，導致信心度失真
 * - 強化 QuantScorer：加入 sweepQualityScore 和 reclaimBars 的量化評分
 * - 強化 RuleEngine：加入 dynamicFeatures 的規則判斷
 * - 新增 aiConfidenceScore 欄位到 EnsembleVetoResult，供前端顯示
 *
 * 三個評估器：
 * 1. RuleEngine：基於硬性規則（HTF 衝突、清掃品質、時段）
 * 2. QuantScorer：基於量化評分（信心度、RR、Kelly 校準後勝率）
 * 3. AiReviewer：AI 語義審核（Prompt 輸出 JSON）
 *
 * 聚合機制：confidence-space 加權平均（Rule: 35%, Quant: 35%, AI: 30%）
 */

import type { HwrTradeModel as TradeModel } from '../../shared/cryptoTypes.js';
import { MacroDataResult } from './macroDataFusion.js';

export interface EnsembleVetoInput {
  topModel: TradeModel;
  allModels: TradeModel[];
  macro: MacroDataResult;
  htfTrend: string;
  conflictCount: number;
  sweepQualityScore?: number;    // SMC 清掃品質分 0-100
  reclaimBars?: number;          // 清掃後收回 K 線數（越少越強）
  dynamicFeatures?: {
    displacementStrength?: number; // 位移強度 0-1
    volumeConfirmation?: boolean;  // 成交量確認
    freshZone?: boolean;           // 是否新鮮未測試區域
  };
}

export interface EnsembleVetoResult {
  finalDecision: 'TRADE' | 'WAIT' | 'REJECT';
  confidence: number;           // 集成決策信心度 0-100
  ruleEngineVote: 'TRADE' | 'WAIT' | 'REJECT';
  quantScorerVote: 'TRADE' | 'WAIT' | 'REJECT';
  aiReviewerVote: 'TRADE' | 'WAIT' | 'REJECT';
  ruleEngineScore: number;      // 規則引擎評分 0-100
  quantScorerScore: number;     // 量化評分 0-100
  aiConfidenceScore: number;    // AI 審核器真實信心度 0-100
  consensusStrength: number;    // 共識強度（基於評分差異，1.0=完全一致，0.0=完全分歧）
  // [E1] v1.2: 分離正負因子
  keyFactors: string[];         // 正面決策因素（支持進場的理由）
  negativeFactors: string[];    // 負面因素（風險警示，無論最終決策為何都顯示）
  vetoReasons: string[];        // 否決原因（REJECT 時的主要理由，向後相容保留）
}

// ── 評估器 1：規則引擎 ──
function runRuleEngine(input: EnsembleVetoInput): {
  vote: 'TRADE' | 'WAIT' | 'REJECT';
  score: number;
  // [E1] v1.2: 分離正負因子
  positiveFactors: string[];
  negativeFactors: string[];
} {
  const { topModel, macro, htfTrend, conflictCount, sweepQualityScore, reclaimBars, dynamicFeatures } = input;

  let score = 50;
  // [E1] v1.2: 分離正負因子（不再混入同一陣列）
  const positiveFactors: string[] = [];
  const negativeFactors: string[] = [];

  // 硬性否決條件
  if (macro.macroFilter === 'avoid') {
    return {
      vote: 'REJECT', score: 10,
      positiveFactors: [],
      negativeFactors: [`宏觀環境評分過低（${macro.macroScore.toFixed(0)}/100），建議迴避`],
    };
  }

  if (conflictCount >= 3) {
    return {
      vote: 'REJECT', score: 15,
      positiveFactors: [],
      negativeFactors: [`多時框嚴重衝突（${conflictCount} 個時框方向不一致）`],
    };
  }

  if (topModel.confidence < 30) {
    return {
      vote: 'REJECT', score: 20,
      positiveFactors: [],
      negativeFactors: [`模型信心度過低（${topModel.confidence}%），不符合最低門檻`],
    };
  }

  // SMC 清掃品質檢查
  if (sweepQualityScore !== undefined) {
    if (sweepQualityScore < 50) {
      negativeFactors.push(`清掃品質不足（${sweepQualityScore}/100）`);
      score -= 20;
    } else if (sweepQualityScore >= 75) {
      score += 15;
      positiveFactors.push(`清掃品質優良（${sweepQualityScore}/100）`);
    } else {
      score += 5;
      positiveFactors.push(`清掃品質中等（${sweepQualityScore}/100）`);
    }
  }

  // 清掃收回確認
  if (reclaimBars !== undefined) {
    if (reclaimBars === 0) {
      negativeFactors.push('清掃後尚未收回，等待確認');
      score -= 15;
    } else if (reclaimBars <= 2) {
      score += 12;
      positiveFactors.push(`清掃後快速收回（${reclaimBars} 根 K 線）`);
    } else if (reclaimBars >= 5) {
      score -= 8;
      negativeFactors.push(`清掃收回過慢（${reclaimBars} 根 K 線），動能減弱`);
    }
  }

  // 動態特徵規則判斷
  if (dynamicFeatures) {
    // 位移強度：強位移（>0.7）是有效反轉的重要確認
    if (dynamicFeatures.displacementStrength !== undefined) {
      if (dynamicFeatures.displacementStrength >= 0.7) {
        score += 10;
        positiveFactors.push(`強位移確認（${(dynamicFeatures.displacementStrength * 100).toFixed(0)}%）`);
      } else if (dynamicFeatures.displacementStrength < 0.3) {
        score -= 8;
        negativeFactors.push(`位移強度不足（${(dynamicFeatures.displacementStrength * 100).toFixed(0)}%），反轉信號弱`);
      }
    }
    // 成交量確認
    if (dynamicFeatures.volumeConfirmation === true) {
      score += 8;
      positiveFactors.push('成交量放量確認');
    } else if (dynamicFeatures.volumeConfirmation === false) {
      score -= 5;
      negativeFactors.push('成交量未確認，信號可靠性降低');
    }
    // 新鮮區域
    if (dynamicFeatures.freshZone === true) {
      score += 7;
      positiveFactors.push('新鮮未測試區域，成功率較高');
    } else if (dynamicFeatures.freshZone === false) {
      score -= 5;
      negativeFactors.push('區域已被多次測試，有效性降低');
    }
  }

  // HTF 方向一致性
  const modelDir = topModel.direction;
  if (modelDir === 'long' && htfTrend === 'bearish') {
    score -= 15;
    negativeFactors.push('逆 4H 趨勢做多，風險較高');
  } else if (modelDir === 'short' && htfTrend === 'bullish') {
    score -= 15;
    negativeFactors.push('逆 4H 趨勢做空，風險較高');
  } else if ((modelDir === 'long' && htfTrend === 'bullish') || (modelDir === 'short' && htfTrend === 'bearish')) {
    score += 12;
    positiveFactors.push('方向與 4H 趨勢一致');
  }

  // 時段流動性
  if (macro.sessionLiquidity >= 80) {
    score += 8;
    positiveFactors.push(`高流動性時段（${macro.sessionName}）`);
  } else if (macro.sessionLiquidity < 50) {
    score -= 10;
    negativeFactors.push(`低流動性時段（${macro.sessionName}），假突破風險高`);
  }

  // RR 比檢查
  if (topModel.rr_ratio < 1.5) {
    score -= 15;
    negativeFactors.push(`RR 比不足（${topModel.rr_ratio.toFixed(1)}:1），最低需要 1.5:1`);
  } else if (topModel.rr_ratio >= 2.5) {
    score += 10;
    positiveFactors.push(`RR 比優良（${topModel.rr_ratio.toFixed(1)}:1）`);
  }

  score = Math.max(0, Math.min(100, score));

  let vote: 'TRADE' | 'WAIT' | 'REJECT';
  if (score >= 65) vote = 'TRADE';
  else if (score >= 45) vote = 'WAIT';
  else vote = 'REJECT';

  return { vote, score, positiveFactors, negativeFactors };
}

// ── 評估器 2：量化評分器 ──
function runQuantScorer(input: EnsembleVetoInput): { vote: 'TRADE' | 'WAIT' | 'REJECT'; score: number } {
  const { topModel, allModels, macro, dynamicFeatures, sweepQualityScore, reclaimBars } = input;

  let score = 0;

  // 1. 模型信心度（最高 30 分）
  score += (topModel.confidence / 100) * 30;

  // 2. [E2] v1.2: 多模型共識改為只計算 is_active 的模型中同方向比例
  //    原版用全部模型數量（含非活躍）作分母，會低估共識強度
  const activeModels = allModels.filter(m => m.is_active);
  const sameDirectionCount = activeModels.filter(m => m.direction === topModel.direction).length;
  const activeCount = Math.max(activeModels.length, 1);
  score += (sameDirectionCount / activeCount) * 20;

  // 3. 宏觀評分（最高 15 分）
  score += (macro.macroScore / 100) * 15;

  // 4. 動態特徵（最高 20 分）
  if (dynamicFeatures) {
    if (dynamicFeatures.displacementStrength !== undefined) {
      score += dynamicFeatures.displacementStrength * 10;
    }
    if (dynamicFeatures.volumeConfirmation) score += 6;
    if (dynamicFeatures.freshZone) score += 4;
  }

  // 5. 清掃品質量化（最高 15 分）
  if (sweepQualityScore !== undefined) {
    score += (sweepQualityScore / 100) * 10;
  }
  if (reclaimBars !== undefined && reclaimBars > 0) {
    // 收回越快越好：1-2 根 = 5 分，3-4 根 = 2 分，5+ 根 = 0 分
    if (reclaimBars <= 2) score += 5;
    else if (reclaimBars <= 4) score += 2;
  }

  score = Math.max(0, Math.min(100, score));

  let vote: 'TRADE' | 'WAIT' | 'REJECT';
  if (score >= 62) vote = 'TRADE';
  else if (score >= 42) vote = 'WAIT';
  else vote = 'REJECT';

  return { vote, score };
}

// ── 集成決策 ──
export function runEnsembleVeto(
  input: EnsembleVetoInput,
  aiVote: 'TRADE' | 'WAIT' | 'REJECT' = 'WAIT',
  aiConfidenceScore: number = 50  // 傳入真實 AI confidence，取代固定 50 分
): EnsembleVetoResult {
  const ruleResult = runRuleEngine(input);
  const quantResult = runQuantScorer(input);

  const ruleEngineVote = ruleResult.vote;
  const quantScorerVote = quantResult.vote;
  const aiReviewerVote = aiVote;

  // [E3] v1.2: confidence-space 加權平均（取代離散投票）
  // 將 AI vote 轉換為數值分數（TRADE=75, WAIT=50, REJECT=25）
  const clampedAiScore = Math.max(0, Math.min(100, aiConfidenceScore));
  const weights = { rule: 0.35, quant: 0.35, ai: 0.30 };
  const weightedScore = ruleResult.score * weights.rule + quantResult.score * weights.quant + clampedAiScore * weights.ai;

  // [E4] v1.2: 共識強度改為基於評分差異（而非離散投票數量）
  // 三個評分的標準差越小，共識越強
  const scores = [ruleResult.score, quantResult.score, clampedAiScore];
  const avgScore = scores.reduce((a, b) => a + b, 0) / 3;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / 3;
  const stdDev = Math.sqrt(variance);
  // stdDev 0 → consensusStrength 1.0；stdDev 30+ → consensusStrength 0.33
  const consensusStrength = Math.max(0.33, Math.min(1.0, 1.0 - stdDev / 45));

  // 最終決策：基於加權評分
  let finalDecision: 'TRADE' | 'WAIT' | 'REJECT';
  if (weightedScore >= 62) finalDecision = 'TRADE';
  else if (weightedScore >= 42) finalDecision = 'WAIT';
  else finalDecision = 'REJECT';

  // 低共識時降級（TRADE → WAIT）
  if (consensusStrength <= 0.5 && finalDecision === 'TRADE') {
    finalDecision = 'WAIT';
  }

  // 最終信心度：加權評分 × 共識強度調整
  const confidence = Math.round(weightedScore * (0.5 + consensusStrength * 0.5));

  // [E1] v1.2: 分離正負因子輸出
  const positiveFactors = ruleResult.positiveFactors;
  const negativeFactors = ruleResult.negativeFactors;

  return {
    finalDecision,
    confidence: Math.max(0, Math.min(100, confidence)),
    ruleEngineVote,
    quantScorerVote,
    aiReviewerVote,
    ruleEngineScore: ruleResult.score,
    quantScorerScore: quantResult.score,
    aiConfidenceScore: clampedAiScore,
    consensusStrength: Math.round(consensusStrength * 100) / 100,
    // [E1] v1.2: 正面因素（支持進場）
    keyFactors: positiveFactors.slice(0, 3),
    // [E1] v1.2: 負面因素（風險警示，無論決策為何都顯示）
    negativeFactors: negativeFactors,
    // 向後相容：REJECT 時仍填入 vetoReasons
    vetoReasons: finalDecision === 'REJECT' ? negativeFactors : [],
  };
}
