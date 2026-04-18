/**
 * sweepQualityV2.ts
 * SMC 流動性清掃品質評分 v2
 *
 * 改良重點（相較 v1）：
 * 1. 加入 reclaimClose：清掃後 1-3 根 K 是否快速收回流動性水位
 * 2. 加入 rejectionEfficiency：影線占比 / 實體方向 / close 位置
 * 3. 加入 postSweepFollowThrough：收回後 3-5 根是否延續，而非再度跌破
 * 4. penetration 門檻改為 ATR 比例（0.08x ~ 0.45x 最佳）
 * 5. sweepQuality < 55 不得啟動三部曲（門檻型條件）
 */

import type { Candle } from "../../shared/cryptoTypes.js";

export interface SweepQualityV2Input {
  candles: Candle[];
  sweepIdx: number;          // 清掃發生的 K 線索引
  side: "buy" | "sell";      // buy = 掃下方 SSL（看多），sell = 掃上方 BSL（看空）
  liquidityLevel: number;    // 被掃的流動性水位
  atr: number;
  rvol: number;              // 相對成交量
  htfPremiumDiscountScore: number; // 0-100，HTF dealing range 位置分
  htfTrend: "bullish" | "bearish" | "ranging";
}

export interface SweepQualityV2Result {
  score: number;             // 0-100
  reclaimConfirmed: boolean; // 是否快速收回
  followThroughConfirmed: boolean;
  penetrationRatio: number;  // 穿透深度 / ATR
  rejectionEfficiency: number; // 0-1
  isValidForChain: boolean;  // score >= 70 && reclaimConfirmed
  details: string[];
}

export function scoreSweepQualityV2(input: SweepQualityV2Input): SweepQualityV2Result {
  const { candles, sweepIdx, side, liquidityLevel, atr, rvol, htfPremiumDiscountScore, htfTrend } = input;

  const c = candles[sweepIdx];
  const next1 = candles[sweepIdx + 1];
  const next2 = candles[sweepIdx + 2];
  const next3 = candles[sweepIdx + 3];
  const next4 = candles[sweepIdx + 4];

  if (!c || !next1) {
    return {
      score: 0, reclaimConfirmed: false, followThroughConfirmed: false,
      penetrationRatio: 0, rejectionEfficiency: 0, isValidForChain: false,
      details: ["K 線資料不足"]
    };
  }

  const body = Math.abs(c.close - c.open);
  const range = Math.max(c.high - c.low, 1e-6);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  let score = 0;
  const details: string[] = [];

  // ── 1. 穿透深度（最佳 0.08x ~ 0.45x ATR）──
  const penetration = side === "buy"
    ? (liquidityLevel - c.low) / atr    // 掃 SSL：low 穿破水位
    : (c.high - liquidityLevel) / atr;  // 掃 BSL：high 穿破水位

  const penetrationRatio = penetration;
  if (penetration >= 0.08 && penetration <= 0.45) {
    score += 20;
    details.push(`✓ 穿透深度適中（${penetration.toFixed(2)}x ATR）`);
  } else if (penetration > 0.45 && penetration <= 0.80) {
    score += 8;
    details.push(`△ 穿透稍深（${penetration.toFixed(2)}x ATR）`);
  } else if (penetration < 0.08) {
    details.push(`✗ 穿透不足（${penetration.toFixed(2)}x ATR < 0.08x）`);
  } else {
    details.push(`✗ 穿透過深（${penetration.toFixed(2)}x ATR > 0.80x），可能是真突破`);
  }

  // ── 2. 快速收回流動性水位（1-3 根 K 內）──
  const reclaim1 = next1 ? (side === "buy"
    ? next1.close > liquidityLevel
    : next1.close < liquidityLevel) : false;
  const reclaim2 = next2 ? (side === "buy"
    ? next2.close > liquidityLevel
    : next2.close < liquidityLevel) : false;
  const reclaimConfirmed = reclaim1 || reclaim2;

  if (reclaim1) {
    score += 28;
    details.push("✓ 下一根 K 即收回水位（最強確認）");
  } else if (reclaim2) {
    score += 18;
    details.push("✓ 第 2 根 K 收回水位");
  } else {
    details.push("✗ 未在 2 根 K 內收回水位（假清掃風險高）");
  }

  // ── 3. 單根 Rejection 結構（影線比例 + 實體方向）──
  const rejectionRatio = side === "buy"
    ? lowerWick / range  // 掃 SSL：下影線越長越好
    : upperWick / range; // 掃 BSL：上影線越長越好

  const rejectionEfficiency = rejectionRatio;
  const closeOnCorrectSide = side === "buy"
    ? c.close > c.open   // 掃 SSL 後收陽線
    : c.close < c.open;  // 掃 BSL 後收陰線

  if (rejectionRatio >= 0.50) {
    score += 15;
    details.push(`✓ 強 rejection 影線（${(rejectionRatio * 100).toFixed(0)}%）`);
  } else if (rejectionRatio >= 0.30) {
    score += 8;
    details.push(`△ 中等 rejection 影線（${(rejectionRatio * 100).toFixed(0)}%）`);
  } else {
    details.push(`✗ rejection 影線不足（${(rejectionRatio * 100).toFixed(0)}%）`);
  }

  if (body / range <= 0.35) {
    score += 5;
    details.push("✓ 小實體（Doji/Pin Bar 結構）");
  }

  if (closeOnCorrectSide) {
    score += 5;
    details.push("✓ 收盤方向正確");
  }

  // ── 4. 收回後 Follow-Through（3-5 根延續）──
  let followThroughCount = 0;
  const followCandles = [next2, next3, next4].filter(Boolean);
  for (const fc of followCandles) {
    if (fc) {
      const extending = side === "buy"
        ? fc.close > liquidityLevel
        : fc.close < liquidityLevel;
      if (extending) followThroughCount++;
    }
  }
  const followThroughConfirmed = followThroughCount >= 2;

  if (followThroughCount >= 2) {
    score += 15;
    details.push(`✓ 收回後延續（${followThroughCount}/${followCandles.length} 根確認）`);
  } else if (followThroughCount === 1) {
    score += 5;
    details.push(`△ 收回後部分延續（${followThroughCount}/${followCandles.length} 根）`);
  } else {
    details.push("✗ 收回後無延續（可能是假清掃後橫盤）");
  }

  // ── 5. RVOL 確認 ──
  if (rvol >= 1.5) {
    score += 7;
    details.push(`✓ 放量清掃（RVOL ${rvol.toFixed(2)}）`);
  } else if (rvol >= 1.2) {
    score += 3;
    details.push(`△ 量能略增（RVOL ${rvol.toFixed(2)}）`);
  } else if (rvol <= 0.7) {
    score -= 8;
    details.push(`✗ 縮量清掃（RVOL ${rvol.toFixed(2)}），假清掃風險高`);
  }

  // ── 6. HTF Dealing Range 位置 ──
  if (htfPremiumDiscountScore >= 70) {
    score += 10;
    details.push("✓ 在 HTF Discount/Premium 極值區清掃");
  } else if (htfPremiumDiscountScore >= 50) {
    score += 4;
  }

  // ── 7. HTF 趨勢對齊 ──
  const htfAligned = (side === "buy" && htfTrend === "bullish") ||
                     (side === "sell" && htfTrend === "bearish");
  if (htfAligned) {
    score += 8;
    details.push("✓ HTF 趨勢對齊");
  } else if (htfTrend === "ranging") {
    score += 2;
  } else {
    score -= 10;
    details.push("✗ 逆 HTF 趨勢清掃（信號可靠性下降）");
  }

  score = Math.max(0, Math.min(100, score));

  // ── 門檻型條件判斷 ──
  const isValidForChain = score >= 70 && reclaimConfirmed;

  return {
    score,
    reclaimConfirmed,
    followThroughConfirmed,
    penetrationRatio,
    rejectionEfficiency,
    isValidForChain,
    details,
  };
}

/**
 * 判斷清掃是否可啟動三部曲
 * v2 版本：score >= 70 且 reclaimConfirmed 才允許
 */
export function isValidSweepForChain(sweepQuality: number, reclaimConfirmed: boolean): boolean {
  return sweepQuality >= 70 && reclaimConfirmed;
}
