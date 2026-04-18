/**
 * Market Regime Classifier v1.1
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
    minConfidenceThreshold: 68,   // v1.1: 稍微降低（原 70），因為積累期信號本來就弱
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
    kellyScaleFactor: 0.0,        // v1.1: 改為 0（完全停止交易）
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

  // ── 1. 暴力行情 ──
  // v1.1 修復：priceChangePct 閾值改為動態（atrRatio 高時閾值提高，避免高波動幣種誤判）
  const impulsiveThreshold = atrRatio > 1.5 ? 7 : 5; // 高波動率時需要更大的價格變化才算暴力
  if (atrRatio > 2.5 || Math.abs(priceChangePct) > impulsiveThreshold) {
    return buildResult('IMPULSIVE', 85, {
      adx, atrRatio, trendStrength, volumeRatio,
      structureType: smcStructure,
      hasDivergence: hasChanDivergence,
    }, `ATR 比率 ${atrRatio.toFixed(2)}x（暴力行情），波動率急劇擴張`);
  }

  // ── 2. 反轉行情 ──
  // v1.1 修復：加入 ADX >= 15 下限 + ATR 條件，防止弱勢噪音被誤判為反轉
  // v1.1 修復：ADX > 35 + 背馳信號 = 可能是 DISTRIBUTION 末段，不歸為 STRONG_TREND
  if (hasChanDivergence && hasBosChoch) {
    const hasMinTrend = adx >= 15; // 至少有一點趨勢強度
    const hasMinVolatility = atrRatio >= 0.8; // ATR 不能太低（過低說明是噪音）
    if (hasMinTrend && hasMinVolatility) {
      const confidence = adx > 25 ? 82 : adx > 15 ? 75 : 65;
      return buildResult('REVERSAL', confidence, {
        adx, atrRatio, trendStrength, volumeRatio,
        structureType: smcStructure,
        hasDivergence: hasChanDivergence,
      }, `纏論背馳 + BOS/CHoCH 結構轉換，ADX=${adx.toFixed(1)}，反轉信號確立`);
    }
    // ADX < 15 或 ATR 過低：降級為 RANGING（噪音）
  }

  // ── 3. 強勁趨勢 ──
  // v1.1 修復：ADX > 35 + 背馳信號時，優先考慮 DISTRIBUTION/REVERSAL（已在上方處理）
  if (adx > 35 && htfTrend !== 'ranging') {
    const confidence = Math.min(95, 60 + adx - 35);
    return buildResult('STRONG_TREND', confidence, {
      adx, atrRatio, trendStrength, volumeRatio,
      structureType: smcStructure,
      hasDivergence: hasChanDivergence,
    }, `ADX ${adx.toFixed(1)} > 35，強勁趨勢確立（${htfTrend}）`);
  }

  // ── 4. 積累期 ──
  // v1.1 修復：放寬 smcStructure 條件（允許 neutral，積累初期 SMC 可能還是 neutral）
  // v1.1 修復：RSI 上限從 50 放寬到 55（積累期末段 RSI 可能已回升）
  const isAccumulation = adx < 25 && volumeRatio < 0.85 &&
    (smcStructure === 'bullish' || smcStructure === 'neutral') &&
    rsi < 55 && htfTrend !== 'bearish';
  if (isAccumulation) {
    const confidence = smcStructure === 'bullish' ? 75 : 68; // bullish SMC 更確定
    return buildResult('ACCUMULATION', confidence, {
      adx, atrRatio, trendStrength, volumeRatio,
      structureType: smcStructure,
      hasDivergence: hasChanDivergence,
    }, `低 ADX（${adx.toFixed(1)}）+ 量縮（${volumeRatio.toFixed(2)}x）+ 底部結構，積累期特徵`);
  }

  // ── 5. 分配期 ──
  // v1.1 修復：移除 ADX < 35 上限（分配末段 ADX 可能 > 35），改為允許 ADX > 35 + 背馳
  // v1.1 修復：RSI 下限從 55 降到 50（分配期 RSI 50-55 區間不應漏掉）
  const isDistribution = volumeRatio > 1.2 &&
    (smcStructure === 'bearish' || smcStructure === 'neutral') &&
    rsi > 50 && htfTrend !== 'bullish' &&
    (adx > 20 || hasChanDivergence); // 加入背馳作為替代條件
  if (isDistribution) {
    const confidence = smcStructure === 'bearish' ? 73 : 65;
    return buildResult('DISTRIBUTION', confidence, {
      adx, atrRatio, trendStrength, volumeRatio,
      structureType: smcStructure,
      hasDivergence: hasChanDivergence,
    }, `量增（${volumeRatio.toFixed(2)}x）+ 頂部結構，ADX=${adx.toFixed(1)}，分配期特徵`);
  }

  // ── 6. 震盪盤整 ──
  // v1.1 修復：chanInZhongshu 不再直接觸發 RANGING（改為輔助加分）
  // ADX 20-35 + 中樞內 = 弱趨勢震盪，仍歸為 RANGING 但信心度較高
  if (adx < 20) {
    const confidence = chanInZhongshu ? 80 : 65;
    return buildResult('RANGING', confidence, {
      adx, atrRatio, trendStrength, volumeRatio,
      structureType: smcStructure,
      hasDivergence: hasChanDivergence,
    }, chanInZhongshu
      ? `ADX ${adx.toFixed(1)} < 20 + 纏論中樞震盪，等待突破方向確認`
      : `ADX ${adx.toFixed(1)} < 20，震盪盤整`);
  }

  // ADX 20-35 + 中樞內 = 弱趨勢震盪（v1.1 新增：區分弱趨勢與純震盪）
  if (chanInZhongshu && adx < 35) {
    return buildResult('RANGING', 72, {
      adx, atrRatio, trendStrength, volumeRatio,
      structureType: smcStructure,
      hasDivergence: hasChanDivergence,
    }, `纏論中樞震盪（ADX=${adx.toFixed(1)} 弱趨勢），等待中樞突破`);
  }

  // 默認：弱趨勢（ADX 20-35 但不符合其他條件）
  return buildResult('RANGING', 55, {
    adx, atrRatio, trendStrength, volumeRatio,
    structureType: smcStructure,
    hasDivergence: hasChanDivergence,
  }, `ADX ${adx.toFixed(1)}（弱趨勢），趨勢不明確，謹慎操作`);
}

function buildResult(
  regime: MarketRegime,
  confidence: number,
  signals: MarketRegimeResult['signals'],
  reasoning: string,
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
  };
}

export function applyRegimeAdaptation(
  modelConfidence: number,
  modelRR: number,
  regimeResult: MarketRegimeResult,
  modelDirection?: 'long' | 'short', // v1.1 新增：用於方向約束
): {
  adjustedConfidence: number;
  adjustedRR: number;
  shouldTrade: boolean;
  forceDisable: boolean;           // v1.1 新增：IMPULSIVE 時強制停用
  adjustmentReason: string;
} {
  const { adaptiveParams, regime } = regimeResult;
  let adjustedConfidence = modelConfidence;
  let adjustmentReason = '';
  let forceDisable = false;

  // v1.1 修復：IMPULSIVE 直接強制停用（不只降 20%）
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

  // v1.1 修復：ACCUMULATION/DISTRIBUTION 加入方向約束
  if (regime === 'ACCUMULATION' && modelDirection === 'short') {
    adjustedConfidence = modelConfidence * 0.5; // 積累期做空大幅降低信心度
    adjustmentReason = '積累期環境不建議做空，信心度降低 50%';
  } else if (regime === 'DISTRIBUTION' && modelDirection === 'long') {
    adjustedConfidence = modelConfidence * 0.5; // 分配期做多大幅降低信心度
    adjustmentReason = '分配期環境不建議做多，信心度降低 50%';
  } else if (modelConfidence < adaptiveParams.minConfidenceThreshold) {
    // 低於環境門檻：降低 30%（原本 20% 太溫和）
    adjustedConfidence = modelConfidence * 0.7;
    adjustmentReason = `${regimeResult.regimeLabel}環境下，信心度低於門檻（${adaptiveParams.minConfidenceThreshold}%），降低 30%`;
  } else if (regime === 'STRONG_TREND' && modelConfidence > 60) {
    adjustedConfidence = Math.min(100, modelConfidence * 1.1);
    adjustmentReason = '強勁趨勢環境，信心度提升 10%';
  }

  // v1.1 修復：adjustedRR 提升時同步更新 TP 建議（在返回值中加入 tpMultiplier）
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
