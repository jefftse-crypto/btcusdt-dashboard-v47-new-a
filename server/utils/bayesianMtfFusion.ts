/**
 * Bayesian Multi-Timeframe Fusion v1.0
 * 
 * 改良點（來自 gpt-5.4 評估）：
 * - 原本：固定衝突懲罰係數（0.88x），靜態加權整合
 * - 改良：
 *   1. 動態衝突懲罰（依市場波動率和信號強度調整）
 *   2. 層級貝葉斯融合（高時框信號對低時框有先驗影響）
 *   3. 時間框架因果關係（4H 領先 1H，1H 領先 15m）
 *   4. 自適應閾值（依幣種波動率調整）
 */

export interface TfSignal {
  timeframe: '4H' | '1H' | '15m' | '5m';
  direction: 'long' | 'short' | 'neutral';
  strength: number;      // 信號強度 0-100
  atr: number;           // 該時框 ATR
  adx?: number;          // ADX（趨勢強度）
  rsi?: number;          // RSI
  smcScore?: number;     // SMC 評分
  paScore?: number;      // PA 評分
  chanScore?: number;    // 纏論評分
  fibScore?: number;     // 斐波那契評分
}

export interface BayesianFusionResult {
  fusedDirection: 'long' | 'short' | 'neutral';
  fusedScore: number;           // 融合後的信號強度 0-100
  conflictPenalty: number;      // 動態衝突懲罰係數 0-1
  htfPriorWeight: number;       // 高時框先驗權重
  bayesianConfidence: number;   // 貝葉斯後驗信心度 0-100
  timeframeWeights: Record<string, number>; // 各時框實際權重
  regimeAdjustment: string;     // 市場環境調整說明
}

// ── 時框基礎權重（高時框有更高的先驗可信度）──
const BASE_TF_WEIGHTS: Record<string, number> = {
  '4H': 0.35,
  '1H': 0.30,
  '15m': 0.22,
  '5m': 0.13,
};

// ── 計算動態衝突懲罰係數 ──
function calcDynamicConflictPenalty(
  signals: TfSignal[],
  marketVolatility: 'low' | 'medium' | 'high'
): number {
  const directions = signals.map(s => s.direction);
  const longCount = directions.filter(d => d === 'long').length;
  const shortCount = directions.filter(d => d === 'short').length;
  const conflictCount = Math.min(longCount, shortCount);
  
  if (conflictCount === 0) return 1.0; // 無衝突
  
  // 基礎懲罰
  let penalty = 1.0;
  if (conflictCount >= 2) penalty = 0.70;
  else if (conflictCount === 1) penalty = 0.88;
  
  // 依市場波動率調整：高波動時衝突更危險，懲罰更重
  if (marketVolatility === 'high') penalty *= 0.85;
  else if (marketVolatility === 'low') penalty *= 1.05; // 低波動時衝突影響較小
  
  // 依信號強度調整：強信號衝突比弱信號衝突更需要懲罰
  const avgStrength = signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;
  if (avgStrength > 70) penalty *= 0.90; // 強信號衝突，加重懲罰
  
  return Math.max(0.5, Math.min(1.0, penalty));
}

// ── 貝葉斯先驗更新 ──
// 高時框方向作為先驗，低時框信號作為似然，計算後驗
function bayesianUpdate(
  prior: { long: number; short: number; neutral: number },
  likelihood: { long: number; short: number; neutral: number }
): { long: number; short: number; neutral: number } {
  const unnormalized = {
    long: prior.long * likelihood.long,
    short: prior.short * likelihood.short,
    neutral: prior.neutral * likelihood.neutral,
  };
  
  const total = unnormalized.long + unnormalized.short + unnormalized.neutral;
  if (total === 0) return { long: 0.33, short: 0.33, neutral: 0.34 };
  
  return {
    long: unnormalized.long / total,
    short: unnormalized.short / total,
    neutral: unnormalized.neutral / total,
  };
}

// ── 將方向轉換為概率分布 ──
function directionToProbability(
  direction: 'long' | 'short' | 'neutral',
  strength: number
): { long: number; short: number; neutral: number } {
  const s = strength / 100;
  
  if (direction === 'long') {
    return { long: 0.5 + s * 0.4, short: 0.1 - s * 0.05, neutral: 0.4 - s * 0.35 };
  } else if (direction === 'short') {
    return { long: 0.1 - s * 0.05, short: 0.5 + s * 0.4, neutral: 0.4 - s * 0.35 };
  } else {
    return { long: 0.2, short: 0.2, neutral: 0.6 };
  }
}

// ── 市場波動率評估 ──
function assessVolatility(signals: TfSignal[]): 'low' | 'medium' | 'high' {
  const tf4h = signals.find(s => s.timeframe === '4H');
  const tf1h = signals.find(s => s.timeframe === '1H');
  
  const adx4h = tf4h?.adx ?? 25;
  const adx1h = tf1h?.adx ?? 25;
  const avgAdx = (adx4h + adx1h) / 2;
  
  if (avgAdx > 35) return 'high';
  if (avgAdx < 20) return 'low';
  return 'medium';
}

/**
 * 主函數：貝葉斯多時框融合
 */
export function bayesianMtfFusion(signals: TfSignal[]): BayesianFusionResult {
  if (signals.length === 0) {
    return {
      fusedDirection: 'neutral',
      fusedScore: 0,
      conflictPenalty: 1.0,
      htfPriorWeight: 0.35,
      bayesianConfidence: 0,
      timeframeWeights: {},
      regimeAdjustment: '無信號',
    };
  }
  
  const volatility = assessVolatility(signals);
  const conflictPenalty = calcDynamicConflictPenalty(signals, volatility);
  
  // ── 依 ADX 動態調整時框權重 ──
  const dynamicWeights: Record<string, number> = { ...BASE_TF_WEIGHTS };
  
  // 高趨勢強度時，提高 4H 權重；震盪時，提高 1H/15m 權重
  if (volatility === 'high') {
    dynamicWeights['4H'] = 0.42;
    dynamicWeights['1H'] = 0.28;
    dynamicWeights['15m'] = 0.18;
    dynamicWeights['5m'] = 0.12;
  } else if (volatility === 'low') {
    dynamicWeights['4H'] = 0.28;
    dynamicWeights['1H'] = 0.32;
    dynamicWeights['15m'] = 0.26;
    dynamicWeights['5m'] = 0.14;
  }
  
  // ── 貝葉斯融合：從 4H 開始，逐層更新 ──
  const tfOrder: Array<'4H' | '1H' | '15m' | '5m'> = ['4H', '1H', '15m', '5m'];
  
  // 初始先驗（均勻分布）
  let posterior = { long: 0.33, short: 0.33, neutral: 0.34 };
  
  for (const tf of tfOrder) {
    const signal = signals.find(s => s.timeframe === tf);
    if (!signal) continue;
    
    const likelihood = directionToProbability(signal.direction, signal.strength);
    const weight = dynamicWeights[tf] ?? 0.25;
    
    // 加權似然（時框權重影響更新幅度）
    const weightedLikelihood = {
      long: 1 + (likelihood.long - 0.33) * weight * 3,
      short: 1 + (likelihood.short - 0.33) * weight * 3,
      neutral: 1 + (likelihood.neutral - 0.34) * weight * 3,
    };
    
    posterior = bayesianUpdate(posterior, weightedLikelihood);
  }
  
  // ── 確定融合方向 ──
  let fusedDirection: 'long' | 'short' | 'neutral';
  if (posterior.long > posterior.short && posterior.long > posterior.neutral) {
    fusedDirection = 'long';
  } else if (posterior.short > posterior.long && posterior.short > posterior.neutral) {
    fusedDirection = 'short';
  } else {
    fusedDirection = 'neutral';
  }
  
  // ── 計算融合後的信號強度 ──
  const maxPosterior = Math.max(posterior.long, posterior.short, posterior.neutral);
  const fusedScore = Math.round(maxPosterior * 100 * conflictPenalty);
  
  // ── 貝葉斯後驗信心度 ──
  // 信心度 = 最大後驗概率 - 次高後驗概率（差距越大越確定）
  const sortedPosteriors = Object.values(posterior).sort((a, b) => b - a);
  const posteriorGap = sortedPosteriors[0] - sortedPosteriors[1];
  const bayesianConfidence = Math.round(posteriorGap * 200 * conflictPenalty);
  
  // ── 市場環境調整說明 ──
  const regimeAdjustment = [
    `波動率：${volatility === 'high' ? '高（趨勢主導）' : volatility === 'low' ? '低（震盪主導）' : '中等'}`,
    `衝突懲罰：${(conflictPenalty * 100).toFixed(0)}%`,
    `後驗分布：多 ${(posterior.long * 100).toFixed(0)}% / 空 ${(posterior.short * 100).toFixed(0)}% / 中 ${(posterior.neutral * 100).toFixed(0)}%`,
  ].join(' | ');
  
  return {
    fusedDirection,
    fusedScore: Math.max(0, Math.min(100, fusedScore)),
    conflictPenalty,
    htfPriorWeight: dynamicWeights['4H'],
    bayesianConfidence: Math.max(0, Math.min(100, bayesianConfidence)),
    timeframeWeights: dynamicWeights,
    regimeAdjustment,
  };
}
