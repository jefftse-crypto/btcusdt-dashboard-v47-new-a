/**
 * Signal Quality Filter v2.1
 * 
 * v5.1 改良點（來自深度分析報告）：
 * - 原本：清掃驗證僅依賴單一時框 K 線形態
 * - 改良：
 *   1. 多時框共振驗證：1H 清掃需要 4H 結構支撐（HTF 方向對齊）
 *   2. 時段流動性整合：低流動性時段（UTC 00-08）清掃品質自動降級
 *   3. 假清掃過濾器：連續多根 K 線未能收回 → 強制標記為 fake
 *   4. 量價背離檢測：清掃時縮量 + 後續放量反轉 = 更強信號
 *   5. SMC 清掃收回確認 v2（原有功能保留）
 *   6. PA 多階段 RSI 頻譜分析（原有功能保留）
 */

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface SweepQualityV2Result {
  isValidSweep: boolean;           // 是否為有效清掃
  qualityScore: number;            // 清掃品質分 0-100
  reclaimBars: number;             // 收回所需 K 線數
  reclaimDepth: number;            // 收回深度（佔清掃幅度的比例 0-1）
  volumeContraction: boolean;      // 收回時是否量能收縮（確認真實反轉）
  sweepType: 'strong' | 'moderate' | 'weak' | 'fake'; // 清掃類型
  reasoning: string;               // 評估說明
}

// v5.1 新增：多時框共振驗證結果
export interface MtfSweepResonanceResult {
  isResonant: boolean;             // 是否與高時框結構共振
  htfAlignment: 'aligned' | 'neutral' | 'conflicting'; // 高時框方向對齊
  sessionPenalty: number;          // 時段流動性懲罰係數 0-1（1=無懲罰）
  resonanceScore: number;          // 共振評分 0-100
  reasoning: string;
}

// v5.1 新增：量價背離結果
export interface VolumePriceDivergenceResult {
  hasDivergence: boolean;          // 是否存在量價背離
  divergenceType: 'bullish' | 'bearish' | 'none'; // 背離類型
  strength: 'strong' | 'moderate' | 'weak'; // 背離強度
  confirmationBars: number;        // 確認 K 線數
  reasoning: string;
}

export interface PaRsiFilterResult {
  rsiSpectrum: {
    zone: 'oversold' | 'bearish' | 'neutral' | 'bullish' | 'overbought';
    score: number;       // 0-100
    momentum: 'accelerating' | 'decelerating' | 'stable';
  };
  paSetupType: 'breakout' | 'pullback' | 'reversal' | 'range' | 'unclear';
  setupConfidence: number;  // 0-100
  filterResult: 'pass' | 'caution' | 'reject';
  reasoning: string;
}

// ── SMC 清掃收回確認 v2 ──
export function analyzeSweepQualityV2(
  sweepCandle: CandleData,
  sweepLevel: number,       // 被清掃的流動性水位
  direction: 'long' | 'short', // 清掃方向（long = 清掃下方低點，short = 清掃上方高點）
  subsequentCandles: CandleData[], // 清掃後的 K 線（最多取 5 根）
  avgVolume: number,        // 平均成交量（用於計算 RVOL）
): SweepQualityV2Result {
  
  // ── 1. 計算清掃幅度 ──
  const sweepExtent = direction === 'long'
    ? sweepLevel - sweepCandle.low   // 清掃了多少
    : sweepCandle.high - sweepLevel;
  
  if (sweepExtent <= 0) {
    return {
      isValidSweep: false, qualityScore: 0, reclaimBars: 0, reclaimDepth: 0,
      volumeContraction: false, sweepType: 'fake',
      reasoning: '清掃幅度為零，非有效清掃',
    };
  }
  
  // ── 2. 清掃 K 線本身的品質 ──
  let baseScore = 30;
  
  // 清掃 K 線是否有長下影線（多頭清掃）或長上影線（空頭清掃）
  const candleBody = Math.abs(sweepCandle.close - sweepCandle.open);
  const totalRange = sweepCandle.high - sweepCandle.low;
  const wickRatio = totalRange > 0 ? (totalRange - candleBody) / totalRange : 0;
  
  if (wickRatio > 0.6) {
    baseScore += 20; // 長影線，清掃後明顯拒絕
  } else if (wickRatio > 0.4) {
    baseScore += 10;
  }
  
  // 清掃 K 線的成交量
  const sweepRvol = avgVolume > 0 ? sweepCandle.volume / avgVolume : 1;
  if (sweepRvol > 1.5) {
    baseScore += 15; // 放量清掃，更有說服力
  } else if (sweepRvol < 0.8) {
    baseScore -= 10; // 縮量清掃，可能是假清掃
  }
  
  // ── 3. 分析後續 K 線的收回情況 ──
  let reclaimBars = 0;
  let reclaimDepth = 0;
  let volumeContraction = false;
  
  const maxBarsToCheck = Math.min(subsequentCandles.length, 5);
  
  for (let i = 0; i < maxBarsToCheck; i++) {
    const candle = subsequentCandles[i];
    
    // 計算收回深度
    const currentReclaim = direction === 'long'
      ? (candle.close - sweepCandle.low) / sweepExtent  // 多頭：收回到清掃水位以上多少
      : (sweepCandle.high - candle.close) / sweepExtent; // 空頭：收回到清掃水位以下多少
    
    if (currentReclaim > reclaimDepth) {
      reclaimDepth = currentReclaim;
      reclaimBars = i + 1;
    }
    
    // 收回時量能收縮確認（反轉更真實）
    const reclaimRvol = avgVolume > 0 ? candle.volume / avgVolume : 1;
    if (i > 0 && reclaimRvol < 0.8 && currentReclaim > 0.5) {
      volumeContraction = true; // 縮量收回，確認反轉
    }
  }
  
  // ── 4. 計算最終品質分 ──
  let qualityScore = baseScore;
  
  // 收回深度加分
  if (reclaimDepth >= 0.8) qualityScore += 25;
  else if (reclaimDepth >= 0.5) qualityScore += 15;
  else if (reclaimDepth >= 0.3) qualityScore += 5;
  else qualityScore -= 15; // 幾乎沒有收回
  
  // 收回速度加分（越快越強）
  if (reclaimBars <= 1) qualityScore += 15;
  else if (reclaimBars <= 2) qualityScore += 8;
  else if (reclaimBars >= 4) qualityScore -= 10;
  
  // 量能收縮加分
  if (volumeContraction) qualityScore += 10;
  
  qualityScore = Math.max(0, Math.min(100, qualityScore));
  
  // ── 5. 判斷清掃類型 ──
  let sweepType: 'strong' | 'moderate' | 'weak' | 'fake';
  const isValidSweep = reclaimDepth >= 0.3 && reclaimBars <= 4;
  
  if (!isValidSweep || qualityScore < 40) sweepType = 'fake';
  else if (qualityScore >= 75) sweepType = 'strong';
  else if (qualityScore >= 55) sweepType = 'moderate';
  else sweepType = 'weak';
  
  const reasoning = [
    `清掃幅度：${sweepExtent.toFixed(4)}`,
    `影線比例：${(wickRatio * 100).toFixed(0)}%`,
    `清掃量能：${sweepRvol.toFixed(2)}x`,
    `收回深度：${(reclaimDepth * 100).toFixed(0)}%（${reclaimBars} 根 K 線）`,
    volumeContraction ? '量能收縮確認' : '量能未收縮',
  ].join(' | ');
  
  return {
    isValidSweep,
    qualityScore,
    reclaimBars,
    reclaimDepth,
    volumeContraction,
    sweepType,
    reasoning,
  };
}

// ── v5.1 新增：多時框共振驗證 ──
/**
 * 驗證 1H 清掃信號是否與 4H 結構共振
 * 核心邏輯：
 * - 4H 看多 + 1H 清掃 SSL（做多）= 共振
 * - 4H 看空 + 1H 清掃 BSL（做空）= 共振
 * - 時段流動性低（亞洲盤深夜）= 清掃品質自動降級
 */
export function analyzeMtfSweepResonance(
  sweepDirection: 'long' | 'short',  // 清掃方向（long=清掃SSL做多，short=清掃BSL做空）
  htfTrend: 'bullish' | 'bearish' | 'ranging',  // 4H 高時框趨勢
  htfSmcStructure: 'bullish' | 'bearish' | 'neutral',  // 4H SMC 結構
  sessionLiquidity: number,  // 當前時段流動性 0-100
  sessionName: string,       // 時段名稱
): MtfSweepResonanceResult {
  let resonanceScore = 50;
  const reasons: string[] = [];
  
  // ── 1. 高時框趨勢對齊 ──
  let htfAlignment: 'aligned' | 'neutral' | 'conflicting';
  
  const isAligned = (sweepDirection === 'long' && htfTrend === 'bullish') ||
                    (sweepDirection === 'short' && htfTrend === 'bearish');
  const isConflicting = (sweepDirection === 'long' && htfTrend === 'bearish') ||
                        (sweepDirection === 'short' && htfTrend === 'bullish');
  
  if (isAligned) {
    htfAlignment = 'aligned';
    resonanceScore += 25;
    reasons.push(`4H 趨勢對齊（${htfTrend}）`);
  } else if (isConflicting) {
    htfAlignment = 'conflicting';
    resonanceScore -= 25;
    reasons.push(`4H 趨勢衝突（逆勢操作，${htfTrend}）`);
  } else {
    htfAlignment = 'neutral';
    reasons.push(`4H 趨勢中性（${htfTrend}），需額外確認`);
  }
  
  // ── 2. 4H SMC 結構對齊 ──
  const smcAligned = (sweepDirection === 'long' && htfSmcStructure === 'bullish') ||
                     (sweepDirection === 'short' && htfSmcStructure === 'bearish');
  const smcConflicting = (sweepDirection === 'long' && htfSmcStructure === 'bearish') ||
                         (sweepDirection === 'short' && htfSmcStructure === 'bullish');
  
  if (smcAligned) {
    resonanceScore += 15;
    reasons.push(`4H SMC 結構對齊（${htfSmcStructure}）`);
  } else if (smcConflicting) {
    resonanceScore -= 15;
    reasons.push(`4H SMC 結構衝突（${htfSmcStructure}）`);
  }
  
  // ── 3. 時段流動性懲罰 ──
  let sessionPenalty = 1.0; // 1.0 = 無懲罰
  
  if (sessionLiquidity < 50) {
    // 低流動性時段（亞洲盤深夜 UTC 01-05）
    sessionPenalty = 0.70;
    resonanceScore -= 20;
    reasons.push(`低流動性時段（${sessionName}，${sessionLiquidity}/100），假清掃風險高`);
  } else if (sessionLiquidity < 65) {
    sessionPenalty = 0.85;
    resonanceScore -= 10;
    reasons.push(`中等流動性時段（${sessionName}，${sessionLiquidity}/100）`);
  } else if (sessionLiquidity >= 80) {
    sessionPenalty = 1.0;
    resonanceScore += 10;
    reasons.push(`高流動性時段（${sessionName}，${sessionLiquidity}/100）`);
  }
  
  resonanceScore = Math.max(0, Math.min(100, resonanceScore));
  
  const isResonant = resonanceScore >= 55 && htfAlignment !== 'conflicting';
  
  return {
    isResonant,
    htfAlignment,
    sessionPenalty,
    resonanceScore,
    reasoning: reasons.join(' | '),
  };
}

// ── v5.1 新增：量價背離檢測 ──
/**
 * 檢測清掃前後的量價背離
 * 強信號：清掃時縮量（假突破）+ 後續收回時放量（真實反轉）
 */
export function detectVolumePriceDivergence(
  preSweepCandles: CandleData[],   // 清掃前 5-10 根 K 線
  sweepCandle: CandleData,         // 清掃 K 線
  postSweepCandles: CandleData[],  // 清掃後 3-5 根 K 線
  direction: 'long' | 'short',    // 清掃方向
  avgVolume: number,               // 平均成交量
): VolumePriceDivergenceResult {
  if (preSweepCandles.length < 3 || postSweepCandles.length < 2) {
    return {
      hasDivergence: false,
      divergenceType: 'none',
      strength: 'weak',
      confirmationBars: 0,
      reasoning: '數據不足，無法判斷量價背離',
    };
  }
  
  // ── 1. 清掃 K 線量能分析 ──
  const sweepRvol = avgVolume > 0 ? sweepCandle.volume / avgVolume : 1;
  const preSweepAvgVol = preSweepCandles.reduce((s, c) => s + c.volume, 0) / preSweepCandles.length;
  const sweepVsPreRatio = preSweepAvgVol > 0 ? sweepCandle.volume / preSweepAvgVol : 1;
  
  // 清掃時縮量（< 0.8x 前期均量）= 假突破信號
  const sweepIsLowVolume = sweepVsPreRatio < 0.8 || sweepRvol < 0.9;
  
  // ── 2. 清掃後收回量能分析 ──
  const postAvgVol = postSweepCandles.reduce((s, c) => s + c.volume, 0) / postSweepCandles.length;
  const postVsPreRatio = preSweepAvgVol > 0 ? postAvgVol / preSweepAvgVol : 1;
  
  // 收回時放量（> 1.2x 前期均量）= 真實反轉確認
  const reclaimIsHighVolume = postVsPreRatio > 1.2;
  
  // ── 3. 價格方向確認 ──
  // v5.3 修復：改為連續性判斷（要求大多數後續 K 線都在收回方向），而非只看最後一根
  const reverseCount = postSweepCandles.filter(c =>
    direction === 'long'
      ? c.close > sweepCandle.close
      : c.close < sweepCandle.close
  ).length;
  // 要求大於半數的後續 K 線都在收回方向（避免先繼續下跌再反彈的誤判）
  const priceReversed = reverseCount >= Math.ceil(postSweepCandles.length * 0.5);
  
  // ── 4. 判斷背離類型和強度 ──
  let hasDivergence = false;
  let divergenceType: 'bullish' | 'bearish' | 'none' = 'none';
  let strength: 'strong' | 'moderate' | 'weak' = 'weak';
  let confirmationBars = 0;
  
  if (sweepIsLowVolume && reclaimIsHighVolume && priceReversed) {
    // 完整量價背離：縮量清掃 + 放量收回 + 價格反轉
    hasDivergence = true;
    divergenceType = direction === 'long' ? 'bullish' : 'bearish';
    strength = 'strong';
    confirmationBars = postSweepCandles.length;
  } else if ((sweepIsLowVolume || reclaimIsHighVolume) && priceReversed) {
    // 部分量價背離
    hasDivergence = true;
    divergenceType = direction === 'long' ? 'bullish' : 'bearish';
    strength = 'moderate';
    confirmationBars = postSweepCandles.filter((c, i) => {
      return direction === 'long' ? c.close > sweepCandle.close : c.close < sweepCandle.close;
    }).length;
  } else if (priceReversed) {
    // 僅價格反轉，無量能確認
    hasDivergence = false;
    divergenceType = 'none';
    strength = 'weak';
  }
  
  const reasoning = [
    `清掃量能：${sweepRvol.toFixed(2)}x（${sweepIsLowVolume ? '縮量，假突破信號' : '正常量能'}）`,
    `收回量能：${postVsPreRatio.toFixed(2)}x（${reclaimIsHighVolume ? '放量，反轉確認' : '量能不足'}）`,
    `價格反轉：${priceReversed ? '✓' : '✗'}`,
    hasDivergence ? `量價背離：${divergenceType}（${strength}）` : '無明顯量價背離',
  ].join(' | ');
  
  return {
    hasDivergence,
    divergenceType,
    strength,
    confirmationBars,
    reasoning,
  };
}

// ── PA 多階段 RSI 頻譜分析 ──
export function analyzePaRsiSpectrum(
  rsi: number,
  rsiHistory: number[],   // 最近 5-10 根的 RSI 歷史
  price: number,
  priceHistory: number[], // 最近 5-10 根的收盤價歷史
  adx?: number,
): PaRsiFilterResult {
  
  // ── RSI 區間分類（多階段頻譜）──
  type RsiZone = 'oversold' | 'bearish' | 'neutral' | 'bullish' | 'overbought';
  let zone: RsiZone;
  let zoneScore: number;
  
  if (rsi <= 20) { zone = 'oversold'; zoneScore = 85; }
  else if (rsi <= 40) { zone = 'bearish'; zoneScore = 35; }
  else if (rsi <= 60) { zone = 'neutral'; zoneScore = 55; }
  else if (rsi <= 80) { zone = 'bullish'; zoneScore = 75; }
  else { zone = 'overbought'; zoneScore = 25; }
  
  // ── RSI 動能方向 ──
  type Momentum = 'accelerating' | 'decelerating' | 'stable';
  let momentum: Momentum = 'stable';
  if (rsiHistory.length >= 3) {
    const recent3 = rsiHistory.slice(-3);
    const rsiChange = recent3[2] - recent3[0];
    const rsiAccel = (recent3[2] - recent3[1]) - (recent3[1] - recent3[0]);
    
    if (Math.abs(rsiChange) > 5) {
      momentum = rsiAccel > 0 ? 'accelerating' : 'decelerating';
    }
  }
  
  // ── PA Setup 類型識別 ──
  type SetupType = 'breakout' | 'pullback' | 'reversal' | 'range' | 'unclear';
  let paSetupType: SetupType = 'unclear';
  let setupConfidence = 50;
  
  if (priceHistory.length >= 5) {
    const recentPrices = priceHistory.slice(-5);
    const priceRange = Math.max(...recentPrices) - Math.min(...recentPrices);
    const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const priceVol = priceRange / avgPrice;
    // v5.3 修復：實際使用 priceVol 區分 breakout vs range
    // 高波動率（> 3%）且 ADX 強 = breakout 機率更高
    const isHighVolatility = priceVol > 0.03;
    
    const isUptrend = recentPrices[4] > recentPrices[0];
    const isDowntrend = recentPrices[4] < recentPrices[0];
    
    // 突破：ADX > 30 + RSI 順勢 + 價格創新高/低
    // v5.3 修復：加入 isHighVolatility 作為額外確認
    if (adx && adx > 30) {
      if (isUptrend && rsi > 55) { paSetupType = 'breakout'; setupConfidence = isHighVolatility ? 78 : 72; }
      else if (isDowntrend && rsi < 45) { paSetupType = 'breakout'; setupConfidence = isHighVolatility ? 78 : 72; }
    }
    
    // 回踩：趨勢中的短期調整
    if (paSetupType === 'unclear' && adx && adx > 20) {
      const isRetracement = isUptrend && price < recentPrices[3] && rsi < 55;
      const isShortRetracement = isDowntrend && price > recentPrices[3] && rsi > 45;
      if (isRetracement || isShortRetracement) {
        paSetupType = 'pullback';
        setupConfidence = 68;
      }
    }
    
    // 反轉：極端 RSI + 動能減弱
    if (paSetupType === 'unclear') {
      if ((rsi <= 25 && momentum === 'decelerating') || (rsi >= 75 && momentum === 'decelerating')) {
        paSetupType = 'reversal';
        setupConfidence = 65;
      }
    }
    
    // 區間：低 ADX + 中性 RSI
    if (paSetupType === 'unclear' && (!adx || adx < 20) && rsi >= 40 && rsi <= 60) {
      paSetupType = 'range';
      setupConfidence = 60;
    }
  }
  
  // ── 過濾結果 ──
  type FilterResult = 'pass' | 'caution' | 'reject';
  let filterResult: FilterResult;
  const combinedScore = (zoneScore + setupConfidence) / 2;
  
  if (combinedScore >= 65) filterResult = 'pass';
  else if (combinedScore >= 45) filterResult = 'caution';
  else filterResult = 'reject';
  
  // 特殊情況：RSI 極端區域且動能加速
  // v5.3 修復：加入 ADX 強趨勢例外（牛市中 RSI > 85 不應直接 reject）
  const isStrongTrend = adx !== undefined && adx > 35;
  if (rsi < 15 && momentum === 'accelerating') {
    filterResult = 'reject'; // 接飛刀：無論趨勢如何都拒絕
  } else if (rsi > 85 && momentum === 'accelerating' && !isStrongTrend) {
    filterResult = 'reject'; // 弱趨勢中 RSI 極端才 reject（強趨勢中不 reject）
  }
  
  const reasoning = [
    `RSI ${rsi.toFixed(1)} → ${zone}（${zoneScore}分）`,
    `動能：${momentum === 'accelerating' ? '加速' : momentum === 'decelerating' ? '減速' : '穩定'}`,
    `Setup 類型：${paSetupType}（信心 ${setupConfidence}%）`,
    `過濾結果：${filterResult}`,
  ].join(' | ');
  
  return {
    rsiSpectrum: { zone, score: zoneScore, momentum },
    paSetupType,
    setupConfidence,
    filterResult,
    reasoning,
  };
}
