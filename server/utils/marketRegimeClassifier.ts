/**
 * Market Regime Classifier v2.0
 *
 * v2.0 改良（GPT-5.4 分析報告修復）：
 * [R1] 改為 score-based ranking：為每個 regime 計算獨立分數，取最高分者，
 *      而非 first-match if/else 階梯（避免排序依賴和邊界遮蔽問題）
 * [R2] 每個 regime 的分數由多個正交條件加總，並附帶 reason 陣列，
 *      提升可解釋性（可看到哪些條件驅動了分類結果）
 * [R3] 新增 regimeScores 欄位到 MarketRegimeResult，供前端顯示各 regime 競爭分數
 * [R4] 保留 hysteresis 機制（v1.2 [H1-H3]）和 applyRegimeAdaptation（v1.1 修復）
 *
 * v1.2 改良（GPT-5.4 審查）：
 *  [H1] 加入 hysteresis 狀態記憶：連續 N 次檢測到同一 regime 才切換，防止邊界抖動
 *  [H2] 新增 createRegimeTracker()：建立帶狀態的 tracker 對象
 *  [H3] classifyMarketRegimeWithHysteresis()：帶 hysteresis 的分類入口
 *
 * Opus 4.6 審查修復（v5.3）：
 * 1. REVERSAL 加入 ADX 下限（>= 15）+ ATR 條件，防止弱勢噪音被誤判為反轉
 * 2. ACCUMULATION 放寬 smcStructure 條件（允許 neutral），加入 RSI 50-55 區間
 * 3. DISTRIBUTION 允許 ADX > 35 + 背馳信號（防止被 STRONG_TREND 搶先匹配）
 * 4. RANGING 的 chanInZhongshu 不再直接觸發（改為輔助加分，避免 ADX 20-35 + 中樞被誤判）
 * 5. IMPULSIVE 的 priceChangePct 閾值改為動態（根據 ATR 比率調整）
 * 6. applyRegimeAdaptation：IMPULSIVE 直接設 is_active = false（不只降 20%）
 * 7. applyRegimeAdaptation：ACCUMULATION/DISTRIBUTION 加入方向約束
 * 8. applyRegimeAdaptation：adjustedRR 提升時同步更新 TP 建議
 */

export type MarketRegime =
  | 'STRONG_TREND'
  | 'RANGING'
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  | 'IMPULSIVE'
  | 'REVERSAL';

export interface RegimeAdaptiveParams {
  preferredModel: 'A' | 'B' | 'C' | 'NONE';
  atrStopMultiplier: number;
  kellyScaleFactor: number;
  minConfidenceThreshold: number;
  recommendedRR: number;
  tradeFilter: 'proceed' | 'caution' | 'avoid';
  description: string;
  tradingTips: string[];
}

export interface MarketRegimeResult {
  regime: MarketRegime;
  regimeLabel: string;
  confidence: number;
  adaptiveParams: RegimeAdaptiveParams;
  signals: {
    adx: number;
    atrRatio: number;
    trendStrength: number;
    volumeRatio: number;
    structureType: string;
    hasDivergence: boolean;
  };
  reasoning: string;
  // [R3] v2.0 新增：各 regime 競爭分數（供前端顯示）
  regimeScores?: Partial<Record<MarketRegime, number>>;
}

const REGIME_PARAMS: Record<MarketRegime, RegimeAdaptiveParams> = {
  STRONG_TREND: {
    preferredModel: 'B',
    atrStopMultiplier: 2.0,
    kellyScaleFactor: 1.2,
    minConfidenceThreshold: 55,
    recommendedRR: 2.0,
    tradeFilter: 'proceed',
    description: '強勁趨勢：ADX > 35，方向明確，回踩進場機會最佳',
    tradingTips: [
      '優先使用趨勢回踩模型（B）',
      '止損放寬至 2.0x ATR，避免被正常回調洗出',
      '目標 2:1 以上 RR，順勢持倉',
      '避免逆勢操作，等待回踩確認再進場',
    ],
  },
  RANGING: {
    preferredModel: 'C',
    atrStopMultiplier: 1.2,
    kellyScaleFactor: 0.7,
    minConfidenceThreshold: 65,
    recommendedRR: 1.5,
    tradeFilter: 'caution',
    description: '震盪盤整：ADX < 20，在支撐/阻力區間操作',
    tradingTips: [
      '優先使用區間邊界模型（C）',
      '在明確支撐/阻力邊界操作，避免中間區域',
      '止損收緊至 1.2x ATR，快進快出',
      '降低倉位至正常的 70%',
    ],
  },
  ACCUMULATION: {
    preferredModel: 'A',
    atrStopMultiplier: 1.5,
    kellyScaleFactor: 0.8,
    minConfidenceThreshold: 68,
    recommendedRR: 2.5,
    tradeFilter: 'caution',
    description: '積累期：低波動量縮，大資金悄悄建倉，等待突破',
    tradingTips: [
      '等待清晰的流動性清掃信號（SSL 清掃）',
      '積累期突破前可能有多次假清掃，耐心等待',
      '一旦確認突破，目標 RR 可設 2.5:1 以上',
      '注意成交量放大確認突破真實性',
      '僅做多方向（積累期不做空）',
    ],
  },
  DISTRIBUTION: {
    preferredModel: 'A',
    atrStopMultiplier: 1.5,
    kellyScaleFactor: 0.8,
    minConfidenceThreshold: 68,
    recommendedRR: 2.5,
    tradeFilter: 'caution',
    description: '分配期：高波動量增，大資金出貨，頂部結構形成',
    tradingTips: [
      '等待 BSL 清掃後的做空信號',
      '分配期可能有多次假突破，需嚴格確認',
      '目標 RR 設 2.5:1 以上，做空潛力大',
      '注意量能放大後的急跌信號',
      '僅做空方向（分配期不做多）',
    ],
  },
  IMPULSIVE: {
    preferredModel: 'NONE',
    atrStopMultiplier: 2.5,
    kellyScaleFactor: 0.0,
    minConfidenceThreshold: 80,
    recommendedRR: 3.0,
    tradeFilter: 'avoid',
    description: '暴力行情：ATR 急劇擴張，波動極大，假信號頻繁',
    tradingTips: [
      '建議暫停交易，等待波動率回歸正常',
      '若必須操作，倉位降至正常的 50%',
      '止損必須放寬至 2.5x ATR',
      '等待行情穩定後再評估入場機會',
    ],
  },
  REVERSAL: {
    preferredModel: 'A',
    atrStopMultiplier: 1.8,
    kellyScaleFactor: 0.9,
    minConfidenceThreshold: 72,
    recommendedRR: 2.0,
    tradeFilter: 'proceed',
    description: '反轉行情：背馳信號 + 結構轉換，高勝率反轉機會',
    tradingTips: [
      '等待明確的背馳信號（MACD 面積背馳 + RSI 背離）',
      '確認 BOS/CHoCH 結構轉換後再進場',
      '止損設在清掃水位下方（多頭）或上方（空頭）',
      '目標 RR 2:1，分批出場',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// [R1] v2.0: Score-based regime ranking
// 為每個 regime 計算獨立分數，取最高分者
// ─────────────────────────────────────────────────────────────────────────────

interface RegimeScoreResult {
  score: number;
  reasons: string[];
}

function scoreImpulsive(params: {
  atrRatio: number;
  priceChangePct: number;
}): RegimeScoreResult {
  const { atrRatio, priceChangePct } = params;
  let score = 0;
  const reasons: string[] = [];

  // ATR 急劇擴張（核心條件）
  if (atrRatio > 2.5) {
    score += 60;
    reasons.push(`ATR 比率 ${atrRatio.toFixed(2)}x（極端擴張）`);
  } else if (atrRatio > 2.0) {
    score += 40;
    reasons.push(`ATR 比率 ${atrRatio.toFixed(2)}x（顯著擴張）`);
  } else if (atrRatio > 1.5) {
    score += 20;
    reasons.push(`ATR 比率 ${atrRatio.toFixed(2)}x（輕微擴張）`);
  }

  // 動態價格變化閾值（高波動率時需要更大的變化才算暴力）
  const impulsiveThreshold = atrRatio > 1.5 ? 7 : 5;
  if (Math.abs(priceChangePct) > impulsiveThreshold) {
    score += 40;
    reasons.push(`價格急變 ${Math.abs(priceChangePct).toFixed(1)}%（超過 ${impulsiveThreshold}% 閾值）`);
  } else if (Math.abs(priceChangePct) > impulsiveThreshold * 0.7) {
    score += 15;
    reasons.push(`價格快速移動 ${Math.abs(priceChangePct).toFixed(1)}%`);
  }

  return { score: Math.min(100, score), reasons };
}

function scoreReversal(params: {
  hasChanDivergence: boolean;
  hasBosChoch: boolean;
  adx: number;
  atrRatio: number;
}): RegimeScoreResult {
  const { hasChanDivergence, hasBosChoch, adx, atrRatio } = params;
  let score = 0;
  const reasons: string[] = [];

  // 核心條件：背馳 + 結構轉換
  if (hasChanDivergence) {
    score += 35;
    reasons.push('纏論背馳信號');
  }
  if (hasBosChoch) {
    score += 35;
    reasons.push('BOS/CHoCH 結構轉換');
  }

  // ADX 輔助條件（至少有一點趨勢強度，防止弱勢噪音）
  if (adx >= 25) {
    score += 20;
    reasons.push(`ADX ${adx.toFixed(1)}（趨勢充分）`);
  } else if (adx >= 15) {
    score += 10;
    reasons.push(`ADX ${adx.toFixed(1)}（趨勢適中）`);
  } else {
    score -= 20; // ADX 過低，可能是噪音
    reasons.push(`ADX ${adx.toFixed(1)}（過低，可能是噪音）`);
  }

  // ATR 條件（不能太低，過低說明是噪音）
  if (atrRatio >= 0.8) {
    score += 10;
    reasons.push(`ATR 比率 ${atrRatio.toFixed(2)}x（波動充分）`);
  } else {
    score -= 15;
    reasons.push(`ATR 比率 ${atrRatio.toFixed(2)}x（波動過低）`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function scoreStrongTrend(params: {
  adx: number;
  htfTrend: string;
  hasChanDivergence: boolean;
  atrRatio: number;
}): RegimeScoreResult {
  const { adx, htfTrend, hasChanDivergence, atrRatio } = params;
  let score = 0;
  const reasons: string[] = [];

  // ADX 核心條件
  if (adx > 45) {
    score += 50;
    reasons.push(`ADX ${adx.toFixed(1)}（極強趨勢）`);
  } else if (adx > 35) {
    score += 40;
    reasons.push(`ADX ${adx.toFixed(1)}（強勁趨勢）`);
  } else if (adx > 25) {
    score += 20;
    reasons.push(`ADX ${adx.toFixed(1)}（中等趨勢）`);
  }

  // HTF 趨勢確認
  if (htfTrend !== 'ranging') {
    score += 25;
    reasons.push(`HTF 趨勢確認（${htfTrend}）`);
  }

  // 背馳信號存在時降分（可能是趨勢末段）
  if (hasChanDivergence) {
    score -= 20;
    reasons.push('纏論背馳（趨勢可能末段）');
  }

  // ATR 穩定（不是暴力行情）
  if (atrRatio >= 0.8 && atrRatio <= 2.0) {
    score += 10;
    reasons.push(`ATR 比率 ${atrRatio.toFixed(2)}x（波動穩定）`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function scoreAccumulation(params: {
  adx: number;
  volumeRatio: number;
  smcStructure: string;
  rsi: number;
  htfTrend: string;
  chanInZhongshu: boolean;
}): RegimeScoreResult {
  const { adx, volumeRatio, smcStructure, rsi, htfTrend, chanInZhongshu } = params;
  let score = 0;
  const reasons: string[] = [];

  // 低 ADX（震盪特徵）
  if (adx < 20) {
    score += 25;
    reasons.push(`ADX ${adx.toFixed(1)}（低趨勢強度）`);
  } else if (adx < 25) {
    score += 15;
    reasons.push(`ADX ${adx.toFixed(1)}（弱趨勢）`);
  }

  // 量縮（機構悄悄建倉）
  if (volumeRatio < 0.75) {
    score += 25;
    reasons.push(`量縮 ${volumeRatio.toFixed(2)}x（顯著量縮）`);
  } else if (volumeRatio < 0.85) {
    score += 15;
    reasons.push(`量縮 ${volumeRatio.toFixed(2)}x（輕微量縮）`);
  }

  // SMC 結構（底部建倉）
  if (smcStructure === 'bullish') {
    score += 20;
    reasons.push('SMC 多頭結構');
  } else if (smcStructure === 'neutral') {
    score += 10;
    reasons.push('SMC 中性結構（積累初期）');
  }

  // RSI 低位（未過熱）
  if (rsi < 50) {
    score += 15;
    reasons.push(`RSI ${rsi.toFixed(1)}（低位未過熱）`);
  } else if (rsi < 55) {
    score += 8;
    reasons.push(`RSI ${rsi.toFixed(1)}（積累末段）`);
  }

  // HTF 非空頭
  if (htfTrend !== 'bearish') {
    score += 10;
    reasons.push(`HTF 趨勢非空頭（${htfTrend}）`);
  } else {
    score -= 15;
    reasons.push('HTF 空頭趨勢（不利積累）');
  }

  // 纏論中樞輔助
  if (chanInZhongshu) {
    score += 5;
    reasons.push('纏論中樞震盪');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function scoreDistribution(params: {
  volumeRatio: number;
  smcStructure: string;
  rsi: number;
  htfTrend: string;
  adx: number;
  hasChanDivergence: boolean;
}): RegimeScoreResult {
  const { volumeRatio, smcStructure, rsi, htfTrend, adx, hasChanDivergence } = params;
  let score = 0;
  const reasons: string[] = [];

  // 量增（機構出貨）
  if (volumeRatio > 1.4) {
    score += 25;
    reasons.push(`量增 ${volumeRatio.toFixed(2)}x（顯著量增）`);
  } else if (volumeRatio > 1.2) {
    score += 15;
    reasons.push(`量增 ${volumeRatio.toFixed(2)}x（輕微量增）`);
  }

  // SMC 結構（頂部出貨）
  if (smcStructure === 'bearish') {
    score += 20;
    reasons.push('SMC 空頭結構');
  } else if (smcStructure === 'neutral') {
    score += 10;
    reasons.push('SMC 中性結構（分配初期）');
  }

  // RSI 高位（過熱）
  if (rsi > 65) {
    score += 15;
    reasons.push(`RSI ${rsi.toFixed(1)}（高位過熱）`);
  } else if (rsi > 50) {
    score += 8;
    reasons.push(`RSI ${rsi.toFixed(1)}（中高位）`);
  }

  // HTF 非多頭
  if (htfTrend !== 'bullish') {
    score += 10;
    reasons.push(`HTF 趨勢非多頭（${htfTrend}）`);
  } else {
    score -= 10;
    reasons.push('HTF 多頭趨勢（不利分配）');
  }

  // ADX 或背馳輔助
  if (adx > 20) {
    score += 10;
    reasons.push(`ADX ${adx.toFixed(1)}（有趨勢強度）`);
  }
  if (hasChanDivergence) {
    score += 15;
    reasons.push('纏論背馳（頂部信號）');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function scoreRanging(params: {
  adx: number;
  chanInZhongshu: boolean;
  atrRatio: number;
}): RegimeScoreResult {
  const { adx, chanInZhongshu, atrRatio } = params;
  let score = 0;
  const reasons: string[] = [];

  // 低 ADX（核心條件）
  if (adx < 15) {
    score += 50;
    reasons.push(`ADX ${adx.toFixed(1)}（極低趨勢強度）`);
  } else if (adx < 20) {
    score += 35;
    reasons.push(`ADX ${adx.toFixed(1)}（低趨勢強度）`);
  } else if (adx < 30) {
    score += 15;
    reasons.push(`ADX ${adx.toFixed(1)}（弱趨勢）`);
  }

  // 纏論中樞（震盪確認）
  if (chanInZhongshu) {
    score += 30;
    reasons.push('纏論中樞震盪');
  }

  // ATR 穩定（非暴力行情）
  if (atrRatio >= 0.7 && atrRatio <= 1.3) {
    score += 20;
    reasons.push(`ATR 比率 ${atrRatio.toFixed(2)}x（波動穩定）`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主分類函數（v2.0 score-based ranking）
// ─────────────────────────────────────────────────────────────────────────────

export function classifyMarketRegime(params: {
  adx: number;
  atr: number;
  atrHistory: number[];
  rsi: number;
  volume: number;
  avgVolume20: number;
  htfTrend: 'bullish' | 'bearish' | 'ranging';
  smcStructure: 'bullish' | 'bearish' | 'neutral';
  hasChanDivergence: boolean;
  hasBosChoch: boolean;
  chanInZhongshu: boolean;
  priceChangePct?: number;
}): MarketRegimeResult {
  const {
    adx, atr, atrHistory, rsi, volume, avgVolume20,
    htfTrend, smcStructure, hasChanDivergence, hasBosChoch,
    chanInZhongshu, priceChangePct = 0,
  } = params;

  const avgAtr20 = atrHistory.length > 0
    ? atrHistory.reduce((s, v) => s + v, 0) / atrHistory.length
    : atr;
  const atrRatio = avgAtr20 > 0 ? atr / avgAtr20 : 1.0;
  const volumeRatio = avgVolume20 > 0 ? volume / avgVolume20 : 1.0;
  const trendStrength = Math.min(100, adx * 2);

  const signalsBase = {
    adx, atrRatio, trendStrength, volumeRatio,
    structureType: smcStructure,
    hasDivergence: hasChanDivergence,
  };

  // [R1] v2.0: 為每個 regime 計算分數
  const impulsiveResult = scoreImpulsive({ atrRatio, priceChangePct });
  const reversalResult = scoreReversal({ hasChanDivergence, hasBosChoch, adx, atrRatio });
  const strongTrendResult = scoreStrongTrend({ adx, htfTrend, hasChanDivergence, atrRatio });
  const accumulationResult = scoreAccumulation({ adx, volumeRatio, smcStructure, rsi, htfTrend, chanInZhongshu });
  const distributionResult = scoreDistribution({ volumeRatio, smcStructure, rsi, htfTrend, adx, hasChanDivergence });
  const rangingResult = scoreRanging({ adx, chanInZhongshu, atrRatio });

  const regimeScores: Record<MarketRegime, number> = {
    IMPULSIVE: impulsiveResult.score,
    REVERSAL: reversalResult.score,
    STRONG_TREND: strongTrendResult.score,
    ACCUMULATION: accumulationResult.score,
    DISTRIBUTION: distributionResult.score,
    RANGING: rangingResult.score,
  };

  // IMPULSIVE 特殊處理：分數超過 60 時直接觸發（緊急狀態）
  if (impulsiveResult.score >= 60) {
    const confidence = Math.min(95, 60 + (impulsiveResult.score - 60));
    return buildResult('IMPULSIVE', confidence, signalsBase,
      `暴力行情：${impulsiveResult.reasons.join('，')}`,
      regimeScores,
    );
  }

  // [R1] 取最高分 regime（排除 IMPULSIVE，已在上方處理）
  const candidates: [MarketRegime, number, string[]][] = [
    ['REVERSAL', reversalResult.score, reversalResult.reasons],
    ['STRONG_TREND', strongTrendResult.score, strongTrendResult.reasons],
    ['ACCUMULATION', accumulationResult.score, accumulationResult.reasons],
    ['DISTRIBUTION', distributionResult.score, distributionResult.reasons],
    ['RANGING', rangingResult.score, rangingResult.reasons],
  ];

  // 按分數降序排列
  candidates.sort((a, b) => b[1] - a[1]);

  const [winnerRegime, winnerScore, winnerReasons] = candidates[0];
  const runnerUpScore = candidates[1][1];

  // 信心度：基於贏家分數，並考慮與第二名的差距
  const margin = winnerScore - runnerUpScore;
  const baseConfidence = Math.min(90, 40 + winnerScore * 0.5);
  // 差距越大，信心越高；差距小於 10 分時降低信心度
  const marginBonus = margin >= 20 ? 10 : margin >= 10 ? 5 : -5;
  const confidence = Math.max(50, Math.min(95, baseConfidence + marginBonus));

  const reasoning = `[Score-based] ${winnerRegime}（${winnerScore}分）> ${candidates[1][0]}（${runnerUpScore}分）。${winnerReasons.slice(0, 3).join('，')}`;

  return buildResult(winnerRegime, confidence, signalsBase, reasoning, regimeScores);
}

function buildResult(
  regime: MarketRegime,
  confidence: number,
  signals: MarketRegimeResult['signals'],
  reasoning: string,
  regimeScores?: Partial<Record<MarketRegime, number>>,
): MarketRegimeResult {
  const REGIME_LABELS: Record<MarketRegime, string> = {
    STRONG_TREND: '強勁趨勢',
    RANGING: '震盪盤整',
    ACCUMULATION: '積累期',
    DISTRIBUTION: '分配期',
    IMPULSIVE: '暴力行情',
    REVERSAL: '反轉行情',
  };
  return {
    regime,
    regimeLabel: REGIME_LABELS[regime],
    confidence: Math.max(0, Math.min(100, confidence)),
    adaptiveParams: REGIME_PARAMS[regime],
    signals,
    reasoning,
    regimeScores,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// [H1] Hysteresis 狀態記憶機制（v1.2 保留）
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeTracker {
  currentRegime: MarketRegime;
  pendingRegime: MarketRegime | null;
  pendingCount: number;       // 待定 regime 連續出現次數
  minConfirmBars: number;     // 切換需要的最少連續次數（預設 3）
  lastSwitchBar: number;      // 上次切換的 bar 索引
  totalBars: number;          // 累計處理 bar 數
}

/**
 * [H2] 建立帶狀態的 regime tracker
 */
export function createRegimeTracker(
  initialRegime: MarketRegime = 'RANGING',
  minConfirmBars = 3,
): RegimeTracker {
  return {
    currentRegime: initialRegime,
    pendingRegime: null,
    pendingCount: 0,
    minConfirmBars,
    lastSwitchBar: 0,
    totalBars: 0,
  };
}

/**
 * [H3] 帶 hysteresis 的 regime 分類入口
 */
export function classifyMarketRegimeWithHysteresis(
  params: Parameters<typeof classifyMarketRegime>[0],
  tracker: RegimeTracker,
): MarketRegimeResult {
  tracker.totalBars++;

  const rawResult = classifyMarketRegime(params);
  const candidateRegime = rawResult.regime;

  // IMPULSIVE 為緊急狀態，立即切換
  if (candidateRegime === 'IMPULSIVE') {
    tracker.currentRegime = 'IMPULSIVE';
    tracker.pendingRegime = null;
    tracker.pendingCount = 0;
    tracker.lastSwitchBar = tracker.totalBars;
    return rawResult;
  }

  // 候選 regime 與目前一致：重置 pending、回傳目前狀態
  if (candidateRegime === tracker.currentRegime) {
    tracker.pendingRegime = null;
    tracker.pendingCount = 0;
    return rawResult;
  }

  // 候選 regime 與目前不同：開始計數
  if (tracker.pendingRegime === candidateRegime) {
    tracker.pendingCount++;
  } else {
    tracker.pendingRegime = candidateRegime;
    tracker.pendingCount = 1;
  }

  // 連續達到閾值：切換到新 regime
  if (tracker.pendingCount >= tracker.minConfirmBars) {
    tracker.currentRegime = candidateRegime;
    tracker.pendingRegime = null;
    tracker.pendingCount = 0;
    tracker.lastSwitchBar = tracker.totalBars;
    return rawResult;
  }

  // 尚未達到閾值：回傳目前穩定 regime（但降低信心度表示「尚在轉換中」）
  const stableResult: MarketRegimeResult = {
    ...buildResult(
      tracker.currentRegime,
      rawResult.confidence * 0.7,
      rawResult.signals,
      `[Hysteresis] 候選 ${candidateRegime} (${tracker.pendingCount}/${tracker.minConfirmBars})，目前穩定於 ${tracker.currentRegime}`,
      rawResult.regimeScores,
    ),
  };
  return stableResult;
}

export function applyRegimeAdaptation(
  modelConfidence: number,
  modelRR: number,
  regimeResult: MarketRegimeResult,
  modelDirection?: 'long' | 'short',
): {
  adjustedConfidence: number;
  adjustedRR: number;
  shouldTrade: boolean;
  forceDisable: boolean;
  adjustmentReason: string;
} {
  const { adaptiveParams, regime } = regimeResult;
  let adjustedConfidence = modelConfidence;
  let adjustmentReason = '';
  let forceDisable = false;

  // IMPULSIVE 直接強制停用
  if (regime === 'IMPULSIVE') {
    forceDisable = true;
    adjustmentReason = '暴力行情：強制停用所有模型，等待波動率回歸';
    return {
      adjustedConfidence: 0,
      adjustedRR: modelRR,
      shouldTrade: false,
      forceDisable: true,
      adjustmentReason,
    };
  }

  // ACCUMULATION/DISTRIBUTION 方向約束
  if (regime === 'ACCUMULATION' && modelDirection === 'short') {
    adjustedConfidence = modelConfidence * 0.5;
    adjustmentReason = '積累期環境不建議做空，信心度降低 50%';
  } else if (regime === 'DISTRIBUTION' && modelDirection === 'long') {
    adjustedConfidence = modelConfidence * 0.5;
    adjustmentReason = '分配期環境不建議做多，信心度降低 50%';
  } else if (modelConfidence < adaptiveParams.minConfidenceThreshold) {
    adjustedConfidence = modelConfidence * 0.7;
    adjustmentReason = `${regimeResult.regimeLabel}環境下，信心度低於門檻（${adaptiveParams.minConfidenceThreshold}%），降低 30%`;
  } else if (regime === 'STRONG_TREND' && modelConfidence > 60) {
    adjustedConfidence = Math.min(100, modelConfidence * 1.1);
    adjustmentReason = '強勁趨勢環境，信心度提升 10%';
  }

  const adjustedRR = Math.max(modelRR, adaptiveParams.recommendedRR);
  if (adjustedRR > modelRR) {
    adjustmentReason += adjustmentReason ? ' | ' : '';
    adjustmentReason += `RR 提升至環境推薦值（${adaptiveParams.recommendedRR}:1），TP 目標相應調整`;
  }

  const shouldTrade = adaptiveParams.tradeFilter !== 'avoid' &&
    adjustedConfidence >= adaptiveParams.minConfidenceThreshold;

  if (!shouldTrade && adaptiveParams.tradeFilter === 'avoid') {
    adjustmentReason += adjustmentReason ? ' | ' : '';
    adjustmentReason += `${regimeResult.regimeLabel}環境建議迴避交易`;
  }

  return {
    adjustedConfidence: Math.max(0, Math.min(100, adjustedConfidence)),
    adjustedRR,
    shouldTrade,
    forceDisable,
    adjustmentReason: adjustmentReason || '無需調整',
  };
}
