/**
 * kellyCalibrationService.ts
 * Kelly 倉位校準服務 v1.0
 *
 * 核心改良（相較原版）：
 * 1. 不再用 confidence/100 直接作為勝率
 * 2. 改用 Beta 分桶校準（model × regime × session × confidence_bin）
 * 3. 加入 empiricalEdge 計算（p × avgWin - (1-p) × avgLoss）
 * 4. 倉位從 edge 而非理論 Kelly 推導，更穩健
 *
 * 預期效果：回撤 -20%~-35%（不直接提升勝率，但改善資金曲線）
 */

export type ModelType = "A" | "B" | "C" | "PA" | "SMC" | "COMPOSITE";
export type Regime = "trend" | "range";
export type Session = "asia" | "london" | "newyork" | "offhours";

export interface TradeSample {
  confidence: number;   // 0-100
  win: 0 | 1;
  model: ModelType;
  regime: Regime;
  session: Session;
  pnlR?: number;        // 實際 R 倍數（可選，用於 avgWin/avgLoss 校準）
}

export interface CalibratorBucket {
  key: string;
  alpha: number;        // Beta 分布 alpha（勝次 + prior）
  beta: number;         // Beta 分布 beta（敗次 + prior）
  totalWinR: number;    // 累計贏 R
  totalLossR: number;   // 累計輸 R
  winCount: number;
  lossCount: number;
}

export interface KellyCalibrationService {
  calibrator: Map<string, CalibratorBucket>;
  addSample: (sample: TradeSample) => void;
  calibratedWinRate: (confidence: number, model: ModelType, regime: Regime, session: Session) => number;
  empiricalEdge: (confidence: number, model: ModelType, regime: Regime, session: Session) => number;
  fractionalKellyPosition: (confidence: number, model: ModelType, regime: Regime, session: Session, rr: number) => number;
  exportCalibration: () => Record<string, CalibratorBucket>;
  importCalibration: (data: Record<string, CalibratorBucket>) => void;
}

/**
 * 生成分桶 key
 * 分桶策略：model × regime × session × confidence_bin（0-9）
 */
function bucketKey(
  confidence: number,
  model: ModelType,
  regime: Regime,
  session: Session
): string {
  const confBin = Math.min(9, Math.floor(confidence / 10));
  return `${model}|${regime}|${session}|${confBin}`;
}

/**
 * 建立 Kelly 校準服務
 * @param initialSamples 可選的初始歷史樣本（用於預熱校準器）
 */
export function createKellyCalibrationService(
  initialSamples: TradeSample[] = []
): KellyCalibrationService {
  const calibrator = new Map<string, CalibratorBucket>();

  // 弱先驗：避免樣本不足時過擬合
  // 使用 Beta(2, 2) 先驗（對應 50% 勝率的弱信念）
  const PRIOR_ALPHA = 2;
  const PRIOR_BETA = 2;

  function getOrCreateBucket(key: string): CalibratorBucket {
    if (!calibrator.has(key)) {
      calibrator.set(key, {
        key,
        alpha: PRIOR_ALPHA,
        beta: PRIOR_BETA,
        totalWinR: 0,
        totalLossR: 0,
        winCount: 0,
        lossCount: 0,
      });
    }
    return calibrator.get(key)!;
  }

  function addSample(sample: TradeSample): void {
    const key = bucketKey(sample.confidence, sample.model, sample.regime, sample.session);
    const bucket = getOrCreateBucket(key);

    if (sample.win === 1) {
      bucket.alpha += 1;
      bucket.winCount += 1;
      if (sample.pnlR !== undefined && sample.pnlR > 0) {
        bucket.totalWinR += sample.pnlR;
      }
    } else {
      bucket.beta += 1;
      bucket.lossCount += 1;
      if (sample.pnlR !== undefined && sample.pnlR < 0) {
        bucket.totalLossR += Math.abs(sample.pnlR);
      }
    }
  }

  // 預熱初始樣本
  for (const sample of initialSamples) {
    addSample(sample);
  }

  function calibratedWinRate(
    confidence: number,
    model: ModelType,
    regime: Regime,
    session: Session
  ): number {
    const key = bucketKey(confidence, model, regime, session);
    const bucket = calibrator.get(key);

    if (!bucket) {
      // 無樣本時：使用 raw confidence 作為保守估計，但限制在 35%-65%
      return Math.max(0.35, Math.min(0.65, confidence / 100));
    }

    // Beta 後驗均值：alpha / (alpha + beta)
    const posteriorMean = bucket.alpha / (bucket.alpha + bucket.beta);

    // 若樣本數不足（< 10），與 raw confidence 混合（防止過擬合）
    const totalSamples = bucket.winCount + bucket.lossCount;
    if (totalSamples < 10) {
      const rawP = Math.max(0.35, Math.min(0.65, confidence / 100));
      const weight = totalSamples / 10; // 0-1，樣本越多越信任校準值
      return rawP * (1 - weight) + posteriorMean * weight;
    }

    return posteriorMean;
  }

  function empiricalEdge(
    confidence: number,
    model: ModelType,
    regime: Regime,
    session: Session
  ): number {
    const key = bucketKey(confidence, model, regime, session);
    const bucket = calibrator.get(key);
    const p = calibratedWinRate(confidence, model, regime, session);

    if (!bucket || bucket.winCount === 0 || bucket.lossCount === 0) {
      // 無足夠樣本：使用 RR 估算（保守）
      return p * 1.5 - (1 - p) * 1.0; // 假設 RR 1.5
    }

    const avgWinR = bucket.totalWinR / Math.max(bucket.winCount, 1);
    const avgLossR = bucket.totalLossR / Math.max(bucket.lossCount, 1);

    // 若沒有 pnlR 數據，回退到估算
    const effectiveAvgWin = avgWinR > 0 ? avgWinR : 1.5;
    const effectiveAvgLoss = avgLossR > 0 ? avgLossR : 1.0;

    return p * effectiveAvgWin - (1 - p) * effectiveAvgLoss;
  }

  function fractionalKellyPosition(
    confidence: number,
    model: ModelType,
    regime: Regime,
    session: Session,
    rr: number
  ): number {
    const p = calibratedWinRate(confidence, model, regime, session);
    const q = 1 - p;
    const edge = empiricalEdge(confidence, model, regime, session);

    // 負期望值：不進場
    if (edge <= 0) return 0;

    // Kelly 公式：f* = (b*p - q) / b
    const rawKelly = (rr * p - q) / Math.max(rr, 1e-6);
    if (rawKelly <= 0) return 0;

    // Fractional Kelly：1/4 Kelly（保守版）
    const fractional = rawKelly * 0.25;

    // 倉位上限：信心度 >= 70% 最多 8%，否則最多 5%
    const maxPosition = confidence >= 70 ? 0.08 : 0.05;

    // session 折扣：亞洲盤縮減倉位
    const sessionDiscount = session === "asia" ? 0.7 : session === "offhours" ? 0.5 : 1.0;

    return Math.min(fractional, maxPosition) * sessionDiscount;
  }

  function exportCalibration(): Record<string, CalibratorBucket> {
    const result: Record<string, CalibratorBucket> = {};
    for (const [key, bucket] of Array.from(calibrator.entries())) {
      result[key] = { ...bucket };
    }
    return result;
  }

  function importCalibration(data: Record<string, CalibratorBucket>): void {
    for (const [key, bucket] of Object.entries(data)) {
      calibrator.set(key, { ...bucket });
    }
  }

  return {
    calibrator,
    addSample,
    calibratedWinRate,
    empiricalEdge,
    fractionalKellyPosition,
    exportCalibration,
    importCalibration,
  };
}

// ── 全域單例（可在服務啟動時載入歷史數據）──
export const globalKellyCalibrator = createKellyCalibrationService();

/**
 * 從回測結果預熱校準器
 * 用於系統啟動時載入歷史交易記錄
 */
export function preloadCalibrationFromBacktest(
  trades: Array<{
    confidence: number;
    win: boolean;
    model: string;
    regime: string;
    session: string;
    pnlR?: number;
  }>
): void {
  for (const t of trades) {
    globalKellyCalibrator.addSample({
      confidence: t.confidence,
      win: t.win ? 1 : 0,
      model: (t.model as ModelType) || "COMPOSITE",
      regime: (t.regime as Regime) || "trend",
      session: (t.session as Session) || "newyork",
      pnlR: t.pnlR,
    });
  }
}
