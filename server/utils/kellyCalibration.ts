/**
 * Kelly Fraction Calibration Service v2.2
 * 
 * v5.1 改良點（來自深度分析報告）：
 * - 原本：靜態查找表 + 1/4 Kelly，未考慮多幣種相關性
 * - 改良：
 *   1. N_eff（有效交易數量）：樣本量不足時自動縮小 Kelly 倍數
 *   2. 動態 Kelly 因子：根據近期績效動態調整 Kelly 分數（0.1-0.5）
 *   3. 相關性矩陣調整：多幣種同時持倉時，按相關性降低總倉位
 *   4. Platt Scaling 校準（原有功能保留）
 *   5. Drawdown Guard（原有功能保留）
 *
 * v2.2 改良（GPT-5.4 審查）：
 *  [K1] 加入單筆最大風險上限 MAX_SINGLE_RISK_PCT = 2%（加密幣市場特性）
 *  [K2] 全 Kelly 超過 30% 時強制降至 0.25 Kelly（防止模型高信心度時超配）
 *  [K3] 加入歸一化說明字段（方便前端顯示完整風控決策進程）
 */

export interface KellyCalibrationInput {
  rawConfidence: number;    // 模型原始信心度 0-100
  modelId: string;          // "liquidity_reversal" | "trend_pullback" | "range_boundary"
  recentWinRate?: number;   // 近期實際勝率（可選，用於動態校準）
  recentPnl?: number[];     // 近期損益序列（用於 Drawdown Guard）
  avgRR?: number;           // 平均盈虧比（用於 Kelly 計算）
  // v5.1 新增
  sampleSize?: number;      // 近期有效樣本數量（用於 N_eff 計算）
  correlatedPositions?: {   // 當前持倉的相關幣種列表
    symbol: string;
    correlation: number;    // 與當前幣種的相關係數 -1 到 1
    positionSize: number;   // 已持倉比例 0-1
  }[];
  recentVolatility?: number; // 近期波動率（ATR/Price，用於動態 Kelly 因子）
}

export interface KellyCalibrationResult {
  calibratedWinRate: number;   // 校準後的勝率估計 0-1
  kellyFraction: number;       // 建議倉位比例 0-1
  riskBudget: number;          // 風險預算係數 0-1（1=正常，<1=降低暴露）
  maxPositionPct: number;      // 最大倉位百分比（考慮風險預算後）
  // v5.1 新增
  nEffFactor: number;          // N_eff 縮放因子 0-1（樣本量不足時 < 1）
  dynamicKellyFactor: number;  // 動態 Kelly 因子（0.1-0.5）
  correlationPenalty: number;  // 相關性懲罰係數 0-1（1=無懲罰）
  adjustedMaxPositionPct: number; // 最終調整後最大倉位（考慮所有因子）
  reasoning: string;           // 校準說明
}

// [K1] v2.2: 單筆最大風險上限（加密幣市場特性）
// 加密幣市場極端波動時，單筆風險不應超過資金的 2%
const MAX_SINGLE_RISK_PCT = 2.0; // 單筆最大風險百分比

// ── 分桶校準表（基於歷史回測數據，Platt Scaling 近似）──
// 格式：[信心度下限, 信心度上限, 校準後勝率]
const CALIBRATION_TABLE: Record<string, [number, number, number][]> = {
  liquidity_reversal: [
    [0,  20,  0.32],
    [20, 35,  0.38],
    [35, 50,  0.43],
    [50, 65,  0.49],
    [65, 80,  0.54],
    [80, 92,  0.58],
  ],
  trend_pullback: [
    [0,  20,  0.38],
    [20, 35,  0.44],
    [35, 50,  0.50],
    [50, 65,  0.56],
    [65, 80,  0.61],
    [80, 92,  0.65],
  ],
  range_boundary: [
    [0,  20,  0.35],
    [20, 35,  0.40],
    [35, 50,  0.45],
    [50, 65,  0.50],
    [65, 80,  0.54],
    [80, 90,  0.57],
  ],
};

/**
 * 查找校準後的勝率
 */
function lookupCalibratedWinRate(modelId: string, rawConfidence: number): number {
  const table = CALIBRATION_TABLE[modelId] ?? CALIBRATION_TABLE.liquidity_reversal;
  for (const [lo, hi, wr] of table) {
    if (rawConfidence >= lo && rawConfidence < hi) {
      // 線性插值：在桶內進行插值
      const t = (rawConfidence - lo) / (hi - lo);
      const nextWr = table.find(r => r[0] === hi)?.[2] ?? wr;
      return wr + t * (nextWr - wr);
    }
  }
  // 超出範圍時使用最後一個桶的值
  return table[table.length - 1][2];
}

/**
 * 計算 Drawdown Guard 係數
 * 連續虧損時自動降低風險暴露
 */
function calcDrawdownGuard(recentPnl: number[]): number {
  if (!recentPnl || recentPnl.length === 0) return 1.0;
  
  // 計算最近 10 筆的連續虧損次數
  const last10 = recentPnl.slice(-10);
  let consecutiveLosses = 0;
  for (let i = last10.length - 1; i >= 0; i--) {
    if (last10[i] < 0) consecutiveLosses++;
    else break;
  }
  
  // 計算最大回撤
  let peak = 0;
  let maxDrawdown = 0;
  let cumPnl = 0;
  for (const pnl of last10) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak > 0 ? (peak - cumPnl) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  // 根據連續虧損和最大回撤計算風險係數
  let guard = 1.0;
  if (consecutiveLosses >= 5) guard *= 0.5;
  else if (consecutiveLosses >= 3) guard *= 0.7;
  else if (consecutiveLosses >= 2) guard *= 0.85;
  
  if (maxDrawdown > 0.20) guard *= 0.6;
  else if (maxDrawdown > 0.10) guard *= 0.8;
  
  return Math.max(0.3, guard); // 最低保留 30% 的正常倉位
}

/**
 * v5.1 新增：計算 N_eff 有效樣本縮放因子
 * 
 * 當樣本量不足時，Kelly 公式的估計不可靠，需要縮小倍數
 * 公式：N_eff_factor = min(1, sqrt(N / N_min))
 * - N < 20：嚴重不足，縮小至 50% 以下
 * - N < 50：不足，縮小至 70%
 * - N >= 100：充足，不縮小
 */
function calcNEffFactor(sampleSize: number): number {
  const N_MIN = 30;   // 最低有效樣本量
  const N_FULL = 100; // 完全可信樣本量
  
  if (sampleSize <= 0) return 0.5; // 無數據，保守處理
  if (sampleSize >= N_FULL) return 1.0;
  
  // 平滑插值：sqrt(N / N_FULL)，最低 0.4
  const factor = Math.sqrt(sampleSize / N_FULL);
  return Math.max(0.4, Math.min(1.0, factor));
}

/**
 * v5.1 新增：計算動態 Kelly 因子
 * 
 * 根據近期績效和波動率動態調整 Kelly 分數
 * - 近期表現好 + 低波動率 → 使用較大 Kelly 分數（0.4-0.5）
 * - 近期表現差 + 高波動率 → 使用較小 Kelly 分數（0.1-0.2）
 * - 默認：0.25（1/4 Kelly）
 */
function calcDynamicKellyFactor(
  recentPnl: number[],
  recentVolatility?: number,
): number {
  let factor = 0.25; // 默認 1/4 Kelly
  
  // 近期績效調整
  if (recentPnl && recentPnl.length >= 5) {
    const last5 = recentPnl.slice(-5);
    const winCount = last5.filter(p => p > 0).length;
    const recentWinRate = winCount / last5.length;
    
    if (recentWinRate >= 0.8) factor = 0.40;       // 近期 80%+ 勝率，提升至 2/5 Kelly
    else if (recentWinRate >= 0.6) factor = 0.30;  // 近期 60%+ 勝率，提升至 3/10 Kelly
    else if (recentWinRate <= 0.2) factor = 0.12;  // 近期 20% 以下勝率，降至 1/8 Kelly
    else if (recentWinRate <= 0.4) factor = 0.18;  // 近期 40% 以下勝率，降至 ~1/5 Kelly
  }
  
  // 波動率調整：高波動率時縮小 Kelly
  if (recentVolatility !== undefined) {
    if (recentVolatility > 0.05) {
      // 高波動率（ATR/Price > 5%）：縮小 30%
      factor *= 0.70;
    } else if (recentVolatility > 0.03) {
      // 中等波動率（ATR/Price > 3%）：縮小 15%
      factor *= 0.85;
    }
    // 低波動率不調整
  }
  
  return Math.max(0.10, Math.min(0.50, factor));
}

/**
 * v5.1 新增：計算相關性懲罰係數
 * 
 * 多幣種同時持倉時，按相關性降低總倉位
 * 公式：penalty = 1 - sum(|corr_i| * positionSize_i) * 0.5
 * 
 * 例：同時持有 BTC（相關性 0.85，倉位 10%）和 ETH（相關性 0.90，倉位 8%）
 * penalty = 1 - (0.85 * 0.10 + 0.90 * 0.08) * 0.5 = 1 - 0.079 = 0.921
 */
function calcCorrelationPenalty(
  correlatedPositions?: KellyCalibrationInput['correlatedPositions'],
): number {
  if (!correlatedPositions || correlatedPositions.length === 0) return 1.0;
  
  // 只考慮高相關性幣種（|corr| > 0.5）
  const highCorrPositions = correlatedPositions.filter(p => Math.abs(p.correlation) > 0.5);
  
  if (highCorrPositions.length === 0) return 1.0;
  
  // 計算加權相關性影響
  const correlationImpact = highCorrPositions.reduce((sum, p) => {
    return sum + Math.abs(p.correlation) * p.positionSize;
  }, 0);
  
  // 懲罰係數：相關性影響越大，懲罰越重
  const penalty = 1 - correlationImpact * 0.5;
  // v5.3 修復：加入最大懲罰上限保護（懲罰不超過 60%）
  // 避免模型相關性極高時將倉位建議归零
  return Math.max(0.40, Math.min(1.0, penalty));
}

/**
 * 主校準函數 v2.1
 */
export function calibrateKelly(input: KellyCalibrationInput): KellyCalibrationResult {
  const {
    rawConfidence, modelId, recentWinRate, recentPnl, avgRR = 2.0,
    sampleSize, correlatedPositions, recentVolatility,
  } = input;
  
  // Step 1：查找校準後的勝率
  let calibratedWinRate = lookupCalibratedWinRate(modelId, rawConfidence);
  
  // Step 2：如果有近期實際勝率，進行動態混合（Bayesian Update）
  // v5.3 修復：混合比例改為動態（樣本量越大，近期數據權重越高）
  if (recentWinRate !== undefined && recentWinRate > 0) {
    const n = sampleSize ?? 0;
    // 樣本量 < 20：近期數據佔 15%（樣本不足，主要依賴校準表）
    // 樣本量 20-100：近期數據佔 15-40%（線性插値）
    // 樣本量 >= 100：近期數據佔 40%
    const recentWeight = n < 20 ? 0.15 : n >= 100 ? 0.40 : 0.15 + (n - 20) / 80 * 0.25;
    calibratedWinRate = calibratedWinRate * (1 - recentWeight) + recentWinRate * recentWeight;
  }
  
  // Step 3：計算 Kelly Fraction
  // Kelly = (p * b - q) / b，其中 b = 盈虧比，p = 勝率，q = 1-p
  const p = calibratedWinRate;
  const q = 1 - p;
  const b = avgRR;
  const fullKelly = Math.max(0, (p * b - q) / b);
  
  // [K2] v2.2: 全 Kelly 超過 30% 時強制降至 0.25 Kelly
  // 加密幣市場極端波動時，高信心度模型可能產生高達 60-80% 的 fullKelly
  // 這在加密幣市場極度危險，強制降至保守型
  const effectiveKellyFactor = fullKelly > 0.30
    ? Math.min(calcDynamicKellyFactor(recentPnl ?? [], recentVolatility), 0.25) // 高 Kelly 時上限 0.25
    : calcDynamicKellyFactor(recentPnl ?? [], recentVolatility);

  // Step 4：v5.1 新增 - 計算動態 Kelly 因子（取代固定 1/4）
  const dynamicKellyFactor = effectiveKellyFactor;
  const fractionalKelly = fullKelly * dynamicKellyFactor;
  
  // Step 5：計算 Drawdown Guard
  const riskBudget = calcDrawdownGuard(recentPnl ?? []);
  
  // Step 6：v5.1 新增 - N_eff 有效樣本縮放
  // v5.3 修復：默認假設 0（不假設有 30 個樣本），避免預設樣本量導致計算偏差
  const nEffFactor = calcNEffFactor(sampleSize ?? 0);
  
  // Step 7：v5.1 新增 - 相關性懲罰
  const correlationPenalty = calcCorrelationPenalty(correlatedPositions);
  
  // Step 8：計算最終倉位上限
  // 基礎最大倉位 = min(fractionalKelly, 0.15) * riskBudget（最大不超過 15%）
  const maxPositionPct = Math.min(fractionalKelly, 0.15) * riskBudget * 100;
  
  // v5.1：調整後最大倉位 = 基礎倉位 * N_eff 因子 * 相關性懲罰
  const rawAdjusted = maxPositionPct * nEffFactor * correlationPenalty;
  
  // [K1] v2.2: 單筆最大風險上限 MAX_SINGLE_RISK_PCT
  // 倉位百分比 * 風險百分比 = 資金風險百分比
  // 若 adjustedMaxPositionPct > MAX_SINGLE_RISK_PCT / avgRR，則將倉位降至安全線
  // 例：盈虧比 2:1，最大倉位 = 2% / (1/2) = 4%（止損後最大賠 2%）
  const maxSafePositionPct = avgRR > 0 ? (MAX_SINGLE_RISK_PCT / (1 / avgRR)) : MAX_SINGLE_RISK_PCT * avgRR;
  const adjustedMaxPositionPct = Math.min(rawAdjusted, maxSafePositionPct);
  
  // 生成說明
  const reasoning = [
    `原始信心度 ${rawConfidence}% → 校準勝率 ${(calibratedWinRate * 100).toFixed(1)}%`,
    `Full Kelly: ${(fullKelly * 100).toFixed(1)}% → 動態 Kelly(${(dynamicKellyFactor * 100).toFixed(0)}%): ${(fractionalKelly * 100).toFixed(1)}%`,
    `風險預算: ${(riskBudget * 100).toFixed(0)}% | N_eff: ${(nEffFactor * 100).toFixed(0)}% | 相關性懲罰: ${(correlationPenalty * 100).toFixed(0)}%`,
    `基礎倉位: ${maxPositionPct.toFixed(1)}% → 調整後: ${adjustedMaxPositionPct.toFixed(1)}%`,
  ].join(' | ');
  
  return {
    calibratedWinRate,
    kellyFraction: fractionalKelly,
    riskBudget,
    maxPositionPct,
    nEffFactor,
    dynamicKellyFactor,
    correlationPenalty,
    adjustedMaxPositionPct,
    reasoning,
  };
}

/**
 * 動態形態止損計算
 * 改良：結合技術形態（FVG/OB 邊界）+ ATR 波段止損 + 時間止損
 */
export interface DynamicStopLossInput {
  entryPrice: number;
  direction: 'long' | 'short';
  atr: number;
  fvgBottom?: number;    // FVG 底部（多頭）
  fvgTop?: number;       // FVG 頂部（空頭）
  obBottom?: number;     // OB 底部（多頭）
  obTop?: number;        // OB 頂部（空頭）
  sweepPrice?: number;   // 清掃水位（用作硬止損）
  modelId: string;
  // v5.1 新增
  regimeAtrMultiplier?: number; // 市場環境 ATR 乘數（來自 marketRegimeClassifier）
}

export interface DynamicStopLossResult {
  stopLoss: number;         // 止損價
  stopLossType: string;     // 止損類型說明
  invalidationLevel: number; // 失效水位（比止損更遠的硬止損）
  trailingActivation: number; // 移動止損啟動價（達到此價格後開始移動止損）
  partialExitAt: number;    // 分批出場價（第一目標）
  // v5.1 新增
  dynamicTpLevels: number[]; // 動態止盈水位（分批出場）
}

export function calcDynamicStopLoss(input: DynamicStopLossInput): DynamicStopLossResult {
  const {
    entryPrice, direction, atr, fvgBottom, fvgTop, obBottom, obTop,
    sweepPrice, modelId,
    regimeAtrMultiplier = 1.5, // v5.1：使用環境自適應 ATR 乘數
  } = input;
  void modelId; // suppress unused warning
  
  let stopLoss: number;
  let stopLossType: string;
  let invalidationLevel: number;
  
  if (direction === 'long') {
    // 多頭止損優先順序：FVG 底部 > OB 底部 > ATR 止損
    if (fvgBottom && fvgBottom < entryPrice && entryPrice - fvgBottom < atr * 1.5) {
      stopLoss = fvgBottom - atr * 0.1; // FVG 底部下方一點點
      stopLossType = 'FVG_BOTTOM';
    } else if (obBottom && obBottom < entryPrice && entryPrice - obBottom < atr * 2) {
      stopLoss = obBottom - atr * 0.1; // OB 底部下方
      stopLossType = 'OB_BOTTOM';
    } else {
      stopLoss = entryPrice - atr * regimeAtrMultiplier; // v5.1：使用環境自適應乘數
      stopLossType = `ATR_${regimeAtrMultiplier}x`;
    }
    
    // 硬止損：清掃水位下方（若有）
    invalidationLevel = sweepPrice 
      ? Math.min(stopLoss, sweepPrice - atr * 0.2)
      : stopLoss - atr * 0.5;
    
  } else {
    // 空頭止損
    if (fvgTop && fvgTop > entryPrice && fvgTop - entryPrice < atr * 1.5) {
      stopLoss = fvgTop + atr * 0.1;
      stopLossType = 'FVG_TOP';
    } else if (obTop && obTop > entryPrice && obTop - entryPrice < atr * 2) {
      stopLoss = obTop + atr * 0.1;
      stopLossType = 'OB_TOP';
    } else {
      stopLoss = entryPrice + atr * regimeAtrMultiplier; // v5.1：使用環境自適應乘數
      stopLossType = `ATR_${regimeAtrMultiplier}x`;
    }
    
    invalidationLevel = sweepPrice
      ? Math.max(stopLoss, sweepPrice + atr * 0.2)
      : stopLoss + atr * 0.5;
  }
  
  // 移動止損啟動價：達到 1.2R 後開始移動止損
  const riskAmount = Math.abs(entryPrice - stopLoss);
  const trailingActivation = direction === 'long'
    ? entryPrice + riskAmount * 1.2
    : entryPrice - riskAmount * 1.2;
  
  // 分批出場：第一目標 1.5R（出場 40%）
  const partialExitAt = direction === 'long'
    ? entryPrice + riskAmount * 1.5
    : entryPrice - riskAmount * 1.5;
  
  // v5.1 新增：動態止盈水位（三個分批出場點）
  // TP1: 1.5R（出場 40%），TP2: 2.5R（出場 40%），TP3: 4.0R（出場 20%）
  const dynamicTpLevels = direction === 'long'
    ? [
        entryPrice + riskAmount * 1.5,  // TP1
        entryPrice + riskAmount * 2.5,  // TP2
        entryPrice + riskAmount * 4.0,  // TP3（讓利潤奔跑）
      ]
    : [
        entryPrice - riskAmount * 1.5,
        entryPrice - riskAmount * 2.5,
        entryPrice - riskAmount * 4.0,
      ];
  
  return {
    stopLoss,
    stopLossType,
    invalidationLevel,
    trailingActivation,
    partialExitAt,
    dynamicTpLevels,
  };
}
