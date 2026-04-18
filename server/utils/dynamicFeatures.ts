/**
 * dynamicFeatures.ts
 * 動態特徵收集函數 — 為 AI Trade Veto Layer 提供四個關鍵動態特徵
 *
 * 四個特徵：
 * 1. Reclaim Quality（收回品質）：清掃後是否快速收回關鍵水位
 * 2. Displacement Quality（位移品質）：清掃後第一段位移是否強烈
 * 3. Freshness & Test Count（新鮮度與測試次數）：OB/FVG/邊界是否新鮮
 * 4. Volume Confirmation（量能確認）：背馳與反應是否伴隨量能
 */

export interface OhlcvBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

// ── 1. Reclaim Quality（收回品質）──────────────────────────────────────────
export interface ReclaimResult {
  reclaimed: boolean;          // 是否已收回
  bars_to_reclaim: number;     // 收回所用的 K 線數（0 = 尚未收回）
  reclaim_score: number;       // 0-100，越高越好（快速收回 = 高分）
  /** [D1] v2.0: 語義修正，同時支援 long/short
   *  long: 收盤站回水位上方 | short: 收盤突破水位下方 */
  close_beyond_level: boolean;
  /** @deprecated 請改用 close_beyond_level，此屬性保留向下相容 */
  close_above_level: boolean;
  description: string;
}

/**
 * 評估清掃後是否快速收回關鍵水位
 * @param bars 最近 N 根 K 線（從清掃點開始往後）
 * @param sweepLevel 被清掃的水位（SSL 或 BSL）
 * @param direction "long" = 清掃下方後需收回上方 | "short" = 清掃上方後需收回下方
 */
export function calcReclaimQuality(
  bars: OhlcvBar[],
  sweepLevel: number,
  direction: "long" | "short"
): ReclaimResult {
  if (!bars || bars.length === 0) {
    return { reclaimed: false, bars_to_reclaim: 0, reclaim_score: 0, close_beyond_level: false, close_above_level: false, description: "無 K 線數據" };
  }

  let barsToReclaim = 0;
  let closeAboveLevel = false;

  for (let i = 0; i < Math.min(bars.length, 5); i++) {
    const bar = bars[i];
    if (direction === "long" && bar.close > sweepLevel) {
      barsToReclaim = i + 1;
      closeAboveLevel = true;
      break;
    }
    if (direction === "short" && bar.close < sweepLevel) {
      barsToReclaim = i + 1;
      closeAboveLevel = true;
      break;
    }
  }

  const reclaimed = closeAboveLevel;

  // 評分：1 根收回 = 100分，2 根 = 80分，3 根 = 60分，4 根 = 40分，5 根 = 20分，未收回 = 0
  let reclaimScore = 0;
  if (reclaimed) {
    reclaimScore = Math.max(0, 100 - (barsToReclaim - 1) * 20);
  }

  const description = reclaimed
    ? `✓ 清掃後 ${barsToReclaim} 根 K 線收回（品質分 ${reclaimScore}）`
    : `✗ 清掃後 ${Math.min(bars.length, 5)} 根 K 線內未收回水位（假清掃風險高）`;

  // [D1] v2.0: 新增 close_beyond_level，保留 close_above_level 向下相容
  return {
    reclaimed,
    bars_to_reclaim: barsToReclaim,
    reclaim_score: reclaimScore,
    close_beyond_level: closeAboveLevel,
    close_above_level: closeAboveLevel,
    description,
  };
}

// ── 2. Displacement Quality（位移品質）────────────────────────────────────
export interface DisplacementResult {
  displacement_ratio: number;   // 位移幅度 / ATR，越大越強
  is_strong: boolean;           // 是否為強位移（> 1.5 ATR）
  displacement_score: number;   // 0-100
  description: string;
}

/**
 * 評估清掃後第一段位移的品質
 * @param bars 清掃後的 K 線（取前 3 根評估）
 * @param atr 當前 ATR 值
 * @param direction 位移方向
 */
export function calcDisplacementQuality(
  bars: OhlcvBar[],
  atr: number,
  direction: "long" | "short"
): DisplacementResult {
  if (!bars || bars.length === 0 || atr <= 0) {
    return { displacement_ratio: 0, is_strong: false, displacement_score: 0, description: "無數據" };
  }

  // [D3] v2.0: 移除 totalRange * 0.6 影線膨張，防止弱位移被影線號稱強
  // 原邏輯使用 max(bodySize, totalRange*0.6)，導致影線大的 K 線被誤判為強位移
  const evalBars = bars.slice(0, 3);
  let maxDisplacement = 0;

  for (const bar of evalBars) {
    const bodySize = Math.abs(bar.close - bar.open);
    // 位移只看實體大小（排除影線膨張）
    const displacement = direction === "long"
      ? (bar.close > bar.open ? bodySize : 0)  // 多方位移看陽線實體
      : (bar.close < bar.open ? bodySize : 0);  // 空方位移看陰線實體
    maxDisplacement = Math.max(maxDisplacement, displacement);
  }

  const displacementRatio = maxDisplacement / atr;
  const isStrong = displacementRatio >= 1.5;

  // 評分：0.5 ATR = 20分，1.0 ATR = 50分，1.5 ATR = 75分，2.0+ ATR = 100分
  const displacementScore = Math.min(100, Math.round(displacementRatio * 50));

  const description = isStrong
    ? `✓ 強位移（${displacementRatio.toFixed(2)} ATR），方向確認有效`
    : `⚠ 弱位移（${displacementRatio.toFixed(2)} ATR），需等待更強確認`;

  return { displacement_ratio: displacementRatio, is_strong: isStrong, displacement_score: displacementScore, description };
}

// ── 3. Freshness & Test Count（新鮮度與測試次數）──────────────────────────
export interface FreshnessResult {
  test_count: number;           // 已測試次數
  is_fresh: boolean;            // 是否為新鮮水位（測試 ≤ 1 次）
  freshness_score: number;      // 0-100，越新鮮越高
  bars_since_creation: number;  // 距離創建的 K 線數
  description: string;
}

/**
 * 評估 OB/FVG/邊界的新鮮度
 * @param levelHigh 水位上沿
 * @param levelLow 水位下沿
 * @param bars 歷史 K 線
 * @param creationBarIndex 水位創建時的 K 線索引（從 bars 陣列計算）
 */
export function calcFreshness(
  levelHigh: number,
  levelLow: number,
  bars: OhlcvBar[],
  creationBarIndex: number = 0
): FreshnessResult {
  if (!bars || bars.length === 0) {
    return { test_count: 0, is_fresh: true, freshness_score: 100, bars_since_creation: 0, description: "無數據，假設新鮮" };
  }

  let testCount = 0;
  const barsSinceCreation = bars.length - creationBarIndex;

  // [D2] v2.0: 改為事件計數（進入區間次數），而非逐 bar 計數
  // 原邏輯逐 bar 計數導致高測試次數計算偏差（連續在區間內的 K 線會被重複計數）
  // 改為：對進入區間的事件計數（進入後離開再進入才算新一次）
  let inZone = false;
  for (let i = creationBarIndex; i < bars.length; i++) {
    const bar = bars[i];
    const touchesZone = bar.low <= levelHigh && bar.high >= levelLow;
    if (touchesZone && !inZone) {
      testCount++;
      inZone = true;
    } else if (!touchesZone) {
      inZone = false; // 離開區間後重置狀態
    }
  }

  const isFresh = testCount <= 1;

  // 評分：0次 = 100分，1次 = 80分，2次 = 50分，3次 = 20分，4次+ = 0分
  const freshnessScore = Math.max(0, 100 - testCount * 25);

  // 時間衰減：超過 50 根 K 線的水位扣分
  const timeDecay = barsSinceCreation > 50 ? Math.max(0, freshnessScore - 20) : freshnessScore;

  const description = isFresh
    ? `✓ 新鮮水位（測試 ${testCount} 次，${barsSinceCreation} 根 K 前創建）`
    : `⚠ 已測試 ${testCount} 次（水位強度遞減，謹慎操作）`;

  return { test_count: testCount, is_fresh: isFresh, freshness_score: timeDecay, bars_since_creation: barsSinceCreation, description };
}

// ── 4. Volume Confirmation（量能確認）─────────────────────────────────────
export interface VolumeResult {
  volume_ratio: number;         // 當前量 / 20期均量
  has_volume_spike: boolean;    // 是否有量能放大（> 1.5x 均量）
  volume_score: number;         // 0-100
  is_divergence_confirmed: boolean; // 背馳是否有量能支持
  description: string;
}

/**
 * 評估量能確認
 * @param recentBars 最近 K 線（用於計算均量）
 * @param signalBar 訊號 K 線
 * @param isDivergence 是否為背馳訊號（背馳需要量縮確認）
 */
export function calcVolumeConfirmation(
  recentBars: OhlcvBar[],
  signalBar: OhlcvBar | null,
  isDivergence: boolean = false
): VolumeResult {
  if (!recentBars || recentBars.length < 5 || !signalBar) {
    return { volume_ratio: 1, has_volume_spike: false, volume_score: 50, is_divergence_confirmed: false, description: "量能數據不足" };
  }

  // 計算 20 期均量（或可用的最多期數）
  const lookback = Math.min(recentBars.length, 20);
  const avgVolume = recentBars.slice(-lookback).reduce((sum, b) => sum + b.volume, 0) / lookback;
  const volumeRatio = avgVolume > 0 ? signalBar.volume / avgVolume : 1;

  const hasVolumeSpike = volumeRatio >= 1.5;

  // 背馳訊號：需要量縮（< 0.8x 均量）才是真背馳
  const isDivergenceConfirmed = isDivergence ? volumeRatio < 0.8 : hasVolumeSpike;

  // 評分
  let volumeScore: number;
  if (isDivergence) {
    // 背馳：量縮越明顯越好
    volumeScore = volumeRatio < 0.5 ? 100 : volumeRatio < 0.8 ? 75 : volumeRatio < 1.0 ? 40 : 10;
  } else {
    // 突破/反轉：量增越明顯越好
    volumeScore = volumeRatio >= 2.0 ? 100 : volumeRatio >= 1.5 ? 80 : volumeRatio >= 1.2 ? 60 : volumeRatio >= 1.0 ? 40 : 20;
  }

  const description = isDivergence
    ? isDivergenceConfirmed
      ? `✓ 背馳量縮確認（量比 ${volumeRatio.toFixed(2)}x，真背馳信號）`
      : `⚠ 背馳但量未縮（量比 ${volumeRatio.toFixed(2)}x，假背馳風險）`
    : hasVolumeSpike
      ? `✓ 量能放大（量比 ${volumeRatio.toFixed(2)}x，方向確認有效）`
      : `⚠ 量能不足（量比 ${volumeRatio.toFixed(2)}x，突破可信度低）`;

  return { volume_ratio: volumeRatio, has_volume_spike: hasVolumeSpike, volume_score: volumeScore, is_divergence_confirmed: isDivergenceConfirmed, description };
}

// ── 綜合動態特徵評估 ──────────────────────────────────────────────────────
export interface DynamicFeatures {
  reclaim: ReclaimResult;
  displacement: DisplacementResult;
  freshness: FreshnessResult;
  volume: VolumeResult;
  overall_quality_score: number;  // 0-100，四個特徵的加權平均
  quality_label: "HIGH" | "MEDIUM" | "LOW" | "REJECT";
  summary: string;
}

/**
 * 綜合評估四個動態特徵，給出整體品質評分
 */
export function calcDynamicFeatures(
  reclaim: ReclaimResult,
  displacement: DisplacementResult,
  freshness: FreshnessResult,
  volume: VolumeResult
): DynamicFeatures {
  // 加權平均：收回品質 35% + 位移品質 30% + 新鮮度 20% + 量能 15%
  const overallScore = Math.round(
    reclaim.reclaim_score * 0.35 +
    displacement.displacement_score * 0.30 +
    freshness.freshness_score * 0.20 +
    volume.volume_score * 0.15
  );

  let qualityLabel: "HIGH" | "MEDIUM" | "LOW" | "REJECT";
  // [D4] v2.0: REJECT 條件放寬：未收回但位移強度 >= 80 時降級為 LOW
  // 原邏輯對所有未收回的設置一律 REJECT，會漏掉「位移強度大但尚未收回」的高賽率設置
  if (!reclaim.reclaimed) {
    if (displacement.displacement_score >= 80) {
      qualityLabel = "LOW"; // 位移強度大，降級為 LOW 而非 REJECT
    } else {
      qualityLabel = "REJECT"; // 位移弱且未收回 = 拒單
    }
  } else if (overallScore >= 70) {
    qualityLabel = "HIGH";
  } else if (overallScore >= 45) {
    qualityLabel = "MEDIUM";
  } else {
    qualityLabel = "LOW";
  }

  const summary = [
    `動態品質評分：${overallScore}/100（${qualityLabel}）`,
    reclaim.description,
    displacement.description,
    freshness.description,
    volume.description,
  ].join(" | ");

  return { reclaim, displacement, freshness, volume, overall_quality_score: overallScore, quality_label: qualityLabel, summary };
}
