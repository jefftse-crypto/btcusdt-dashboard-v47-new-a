/**
 * Ensemble Veto System v1.1
 * 
 * v5.1 改良點（來自深度分析報告）：
 * - Bug 修復：baseConfidence 計算中 AI 分固定為 50，導致信心度失真
 *   → 新增 aiConfidenceScore 參數，傳入 Veto Layer 回傳的真實 confidence 值
 * - 強化 QuantScorer：加入 sweepQualityScore 和 reclaimBars 的量化評分
 * - 強化 RuleEngine：加入 dynamicFeatures 的規則判斷
 * - 新增 aiConfidenceScore 欄位到 EnsembleVetoResult，供前端顯示
 * 
 * 三個評估器：
 * 1. RuleEngine：基於硬性規則（HTF 衝突、清掃品質、時段）
 * 2. QuantScorer：基於量化評分（信心度、RR、Kelly 校準後勝率）
 * 3. AiReviewer：AI 語義審核（Prompt 輸出 JSON）
 * 
 * 投票機制：加權多數決（Rule: 35%, Quant: 35%, AI: 30%）
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
  aiConfidenceScore: number;    // v5.1 新增：AI 審核器真實信心度 0-100
  consensusStrength: number;    // 共識強度（三者一致=1.0，兩者一致=0.67，全分歧=0.33）
  keyFactors: string[];         // 關鍵決策因素
  vetoReasons: string[];        // 否決原因（若有）
}

// ── 評估器 1：規則引擎 ──
function runRuleEngine(input: EnsembleVetoInput): { vote: 'TRADE' | 'WAIT' | 'REJECT'; score: number; reasons: string[] } {
  const { topModel, macro, htfTrend, conflictCount, sweepQualityScore, reclaimBars, dynamicFeatures } = input;
  
  let score = 50;
  const reasons: string[] = [];
  const vetoReasons: string[] = [];
  
  // 硬性否決條件
  if (macro.macroFilter === 'avoid') {
    return { vote: 'REJECT', score: 10, reasons: [`宏觀環境評分過低（${macro.macroScore.toFixed(0)}/100），建議迴避`] };
  }
  
  if (conflictCount >= 3) {
    return { vote: 'REJECT', score: 15, reasons: [`多時框嚴重衝突（${conflictCount} 個時框方向不一致）`] };
  }
  
  if (topModel.confidence < 30) {
    return { vote: 'REJECT', score: 20, reasons: [`模型信心度過低（${topModel.confidence}%），不符合最低門檻`] };
  }
  
  // SMC 清掃品質檢查
  if (sweepQualityScore !== undefined) {
    if (sweepQualityScore < 50) {
      vetoReasons.push(`清掃品質不足（${sweepQualityScore}/100）`);
      score -= 20;
    } else if (sweepQualityScore >= 75) {
      score += 15;
      reasons.push(`清掃品質優良（${sweepQualityScore}/100）`);
    } else {
      score += 5;
      reasons.push(`清掃品質中等（${sweepQualityScore}/100）`);
    }
  }
  
  // 清掃收回確認
  if (reclaimBars !== undefined) {
    if (reclaimBars === 0) {
      vetoReasons.push('清掃後尚未收回，等待確認');
      score -= 15;
    } else if (reclaimBars <= 2) {
      score += 12;
      reasons.push(`清掃後快速收回（${reclaimBars} 根 K 線）`);
    } else if (reclaimBars >= 5) {
      score -= 8;
      vetoReasons.push(`清掃收回過慢（${reclaimBars} 根 K 線），動能減弱`);
    }
  }
  
  // v5.1 新增：動態特徵規則判斷
  if (dynamicFeatures) {
    // 位移強度：強位移（>0.7）是有效反轉的重要確認
    if (dynamicFeatures.displacementStrength !== undefined) {
      if (dynamicFeatures.displacementStrength >= 0.7) {
        score += 10;
        reasons.push(`強位移確認（${(dynamicFeatures.displacementStrength * 100).toFixed(0)}%）`);
      } else if (dynamicFeatures.displacementStrength < 0.3) {
        score -= 8;
        vetoReasons.push(`位移強度不足（${(dynamicFeatures.displacementStrength * 100).toFixed(0)}%），反轉信號弱`);
      }
    }
    // 成交量確認
    if (dynamicFeatures.volumeConfirmation === true) {
      score += 8;
      reasons.push('成交量放量確認');
    } else if (dynamicFeatures.volumeConfirmation === false) {
      score -= 5;
      vetoReasons.push('成交量未確認，信號可靠性降低');
    }
    // 新鮮區域
    if (dynamicFeatures.freshZone === true) {
      score += 7;
      reasons.push('新鮮未測試區域，成功率較高');
    } else if (dynamicFeatures.freshZone === false) {
      score -= 5;
      vetoReasons.push('區域已被多次測試，有效性降低');
    }
  }
  
  // HTF 方向一致性
  const modelDir = topModel.direction;
  if (modelDir === 'long' && htfTrend === 'bearish') {
    score -= 15;
    vetoReasons.push('逆 4H 趨勢做多，風險較高');
  } else if (modelDir === 'short' && htfTrend === 'bullish') {
    score -= 15;
    vetoReasons.push('逆 4H 趨勢做空，風險較高');
  } else if ((modelDir === 'long' && htfTrend === 'bullish') || (modelDir === 'short' && htfTrend === 'bearish')) {
    score += 12;
    reasons.push('方向與 4H 趨勢一致');
  }
  
  // 時段流動性
  if (macro.sessionLiquidity >= 80) {
    score += 8;
    reasons.push(`高流動性時段（${macro.sessionName}）`);
  } else if (macro.sessionLiquidity < 50) {
    score -= 10;
    vetoReasons.push(`低流動性時段（${macro.sessionName}），假突破風險高`);
  }
  
  // RR 比檢查
  if (topModel.rr_ratio < 1.5) {
    score -= 15;
    vetoReasons.push(`RR 比不足（${topModel.rr_ratio.toFixed(1)}:1），最低需要 1.5:1`);
  } else if (topModel.rr_ratio >= 2.5) {
    score += 10;
    reasons.push(`RR 比優良（${topModel.rr_ratio.toFixed(1)}:1）`);
  }
  
  score = Math.max(0, Math.min(100, score));
  
  let vote: 'TRADE' | 'WAIT' | 'REJECT';
  if (score >= 65) vote = 'TRADE';
  else if (score >= 45) vote = 'WAIT';
  else vote = 'REJECT';
  
  return { vote, score, reasons: vetoReasons.length > 0 ? vetoReasons : reasons };
}

// ── 評估器 2：量化評分器 ──
function runQuantScorer(input: EnsembleVetoInput): { vote: 'TRADE' | 'WAIT' | 'REJECT'; score: number } {
  const { topModel, allModels, macro, dynamicFeatures, sweepQualityScore, reclaimBars } = input;
  
  let score = 0;
  
  // 1. 模型信心度（最高 30 分）
  score += (topModel.confidence / 100) * 30;
  
  // 2. 多模型共識（最高 20 分）
  const sameDirectionCount = allModels.filter(m => m.direction === topModel.direction && m.is_active).length;
  score += (sameDirectionCount / Math.max(allModels.length, 1)) * 20;
  
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
  
  // 5. v5.1 新增：清掃品質量化（最高 15 分）
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

// ── 集成投票 ──
export function runEnsembleVeto(
  input: EnsembleVetoInput,
  aiVote: 'TRADE' | 'WAIT' | 'REJECT' = 'WAIT',
  aiConfidenceScore: number = 50  // v5.1 修復：傳入真實 AI confidence，取代固定 50 分
): EnsembleVetoResult {
  const ruleResult = runRuleEngine(input);
  const quantResult = runQuantScorer(input);
  
  const ruleEngineVote = ruleResult.vote;
  const quantScorerVote = quantResult.vote;
  const aiReviewerVote = aiVote;
  
  // 加權投票：Rule 35%, Quant 35%, AI 30%
  const voteScores = { TRADE: 0, WAIT: 0, REJECT: 0 };
  
  const weights = { rule: 0.35, quant: 0.35, ai: 0.30 };
  voteScores[ruleEngineVote] += weights.rule;
  voteScores[quantScorerVote] += weights.quant;
  voteScores[aiReviewerVote] += weights.ai;
  
  // 找出最高票
  let finalDecision: 'TRADE' | 'WAIT' | 'REJECT' = 'WAIT';
  let maxScore = 0;
  for (const [decision, score] of Object.entries(voteScores)) {
    if (score > maxScore) {
      maxScore = score;
      finalDecision = decision as 'TRADE' | 'WAIT' | 'REJECT';
    }
  }
  
  // 計算共識強度
  const votes = [ruleEngineVote, quantScorerVote, aiReviewerVote];
  const uniqueVotes = new Set(votes).size;
  const consensusStrength = uniqueVotes === 1 ? 1.0 : uniqueVotes === 2 ? 0.67 : 0.33;
  
  // 如果共識強度低，降級決策（TRADE → WAIT，WAIT 維持，REJECT 維持）
  if (consensusStrength <= 0.33 && finalDecision === 'TRADE') {
    finalDecision = 'WAIT';
  }
  
  // v5.1 修復：計算集成信心度時使用真實 AI confidence_score，取代固定 50 分
  // aiConfidenceScore 來自 Veto Layer 回傳的 confidence 字段（0-100）
  const clampedAiScore = Math.max(0, Math.min(100, aiConfidenceScore));
  const baseConfidence = (ruleResult.score * 0.35 + quantResult.score * 0.35 + clampedAiScore * 0.30);
  const confidence = Math.round(baseConfidence * consensusStrength + baseConfidence * (1 - consensusStrength) * 0.5);
  
  return {
    finalDecision,
    confidence: Math.max(0, Math.min(100, confidence)),
    ruleEngineVote,
    quantScorerVote,
    aiReviewerVote,
    ruleEngineScore: ruleResult.score,
    quantScorerScore: quantResult.score,
    aiConfidenceScore: clampedAiScore,  // v5.1 新增：回傳 AI 真實信心度供前端顯示
    consensusStrength,
    keyFactors: ruleResult.reasons.slice(0, 3),
    vetoReasons: finalDecision === 'REJECT' ? ruleResult.reasons : [],
  };
}
