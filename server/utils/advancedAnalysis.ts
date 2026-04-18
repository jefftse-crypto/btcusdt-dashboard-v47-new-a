/**
 * server/utils/advancedAnalysis.ts
 * 進階交易分析引擎
 * - PA 背離偵測 (RSI/MACD 頂底背離 + 隱藏背離)
 * - PA 形態 + 關鍵水位結合 (Pin Bar/Engulfing at S/R)
 * - 強化版纏論引擎 (包含處理、筆、線段、中樞、背馳、一二三買賣點)
 * - SMC 終極確認模型 (流動性清掃 → FVG 位移 → OB 回踩)
 */

import type {
  Candle,
  PaDivergence,
  SRLevel,
  PaPatternWithLevel,
  CandlestickPattern,
  SmcConfirmationSetup,
  ChanBuyPoint,
} from "../../shared/cryptoTypes.js";
import {
  calcRsiArr,
  calcMacdArr,
  calcAtrLast,
  calcEmaArr,
  findSwingHighs,
  findSwingLows,
  isFiniteNumber,
} from "./indicators.js";

// ============================================================
// PA DIVERGENCE DETECTION (RSI & MACD Regular + Hidden)
// ============================================================

/**
 * Detect RSI and MACD divergences (regular + hidden) over the last N candles.
 * Regular Bullish:  price lower low, RSI higher low  → reversal up
 * Regular Bearish:  price higher high, RSI lower high → reversal down
 * Hidden Bullish:   price higher low, RSI lower low   → continuation up
 * Hidden Bearish:   price lower high, RSI higher high → continuation down
 */
export function detectDivergences(
  candles: Candle[],
  timeframe: string,
  lookback = 50
): PaDivergence[] {
  const results: PaDivergence[] = [];
  const slice = candles.slice(-lookback);
  if (slice.length < 14) return results;

  const closes = slice.map(c => c.close);
  const rsiArr = calcRsiArr(closes, 14);
  const macdResult = calcMacdArr(closes);
  const macdHist = macdResult.hist;

  // R6-FIX: 動態 MACD 閾値（基於平均價格的萬分之一），避免硬編碼魔術數字
  const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
  const macdThreshold = avgPrice * 0.0001; // 萬分之一的價格作為最小差異

  // R6-FIX: 暴機期定義（RSI 需要 14 根暖機，MACD 需要 26 根）
  const RSI_WARMUP = 14;
  const MACD_WARMUP = 26;

  // Find local swing highs and lows (price) with lookaround=2
  // R6-FIX: 使用 >= 避免等値漏判
  const swingHighs: { idx: number; price: number }[] = [];
  const swingLows: { idx: number; price: number }[] = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (
      slice[i].high >= slice[i - 1].high && slice[i].high >= slice[i - 2].high &&
      slice[i].high > slice[i + 1].high && slice[i].high > slice[i + 2].high
    ) swingHighs.push({ idx: i, price: slice[i].high });

    if (
      slice[i].low <= slice[i - 1].low && slice[i].low <= slice[i - 2].low &&
      slice[i].low < slice[i + 1].low && slice[i].low < slice[i + 2].low
    ) swingLows.push({ idx: i, price: slice[i].low });
  }

  // ── Bearish divergences (compare last 2 swing highs) ──
  if (swingHighs.length >= 2) {
    const h1 = swingHighs[swingHighs.length - 2];
    const h2 = swingHighs[swingHighs.length - 1];
    // R6-FIX: 驗證暴機期，避免 NaN fallback 產生虞假背離
    const rsi1 = (h1.idx >= RSI_WARMUP && !isNaN(rsiArr[h1.idx])) ? rsiArr[h1.idx] : null;
    const rsi2 = (h2.idx >= RSI_WARMUP && !isNaN(rsiArr[h2.idx])) ? rsiArr[h2.idx] : null;
    const macd1 = (h1.idx >= MACD_WARMUP && !isNaN(macdHist[h1.idx])) ? macdHist[h1.idx] : null;
    const macd2 = (h2.idx >= MACD_WARMUP && !isNaN(macdHist[h2.idx])) ? macdHist[h2.idx] : null;

    // Regular Bearish RSI: price HH, RSI LH
    if (rsi1 !== null && rsi2 !== null && h2.price > h1.price * 1.001 && rsi2 < rsi1 - 2) {
      const diff = rsi1 - rsi2;
      results.push({
        type: "regular_bearish",
        indicator: "rsi",
        timeframe,
        price_high1: h1.price,
        price_high2: h2.price,
        indicator_val1: rsi1,
        indicator_val2: rsi2,
        strength: diff > 10 ? "strong" : diff > 5 ? "medium" : "weak",
        description: `頂背離：價格創新高 ${h2.price.toFixed(2)} 但 RSI 未跟隨 (${rsi2.toFixed(1)} < ${rsi1.toFixed(1)})，趨勢反轉信號`,
        candle_idx: h2.idx,
        time: slice[h2.idx]?.time ?? 0,
      });
    }
    // Regular Bearish MACD: price HH, MACD LH
    // R6-FIX: 使用動態閾値（macdThreshold）替代硬編碼 0.00001
    if (macd1 !== null && macd2 !== null && h2.price > h1.price * 1.001 && macd2 < macd1 - macdThreshold && macd1 > 0) {
      results.push({
        type: "regular_bearish",
        indicator: "macd",
        timeframe,
        price_high1: h1.price,
        price_high2: h2.price,
        indicator_val1: macd1,
        indicator_val2: macd2,
        strength: Math.abs(macd1 - macd2) > Math.abs(macd1) * 0.3 ? "strong" : "medium",
        description: `MACD 頂背離：價格創新高但 MACD 柱縮小，動能衰竭，反轉信號`,
        candle_idx: h2.idx,
        time: slice[h2.idx]?.time ?? 0,
      });
    }
    // Hidden Bearish RSI: price LH, RSI HH → continuation down
    if (rsi1 !== null && rsi2 !== null && h2.price < h1.price * 0.999 && rsi2 > rsi1 + 3) {
      results.push({
        type: "hidden_bearish",
        indicator: "rsi",
        timeframe,
        price_high1: h1.price,
        price_high2: h2.price,
        indicator_val1: rsi1,
        indicator_val2: rsi2,
        strength: "medium",
        description: `隱藏頂背離：價格低高點但 RSI 高高點，下跌趨勢延續信號`,
        candle_idx: h2.idx,
        time: slice[h2.idx]?.time ?? 0,
      });
    }
  }

  // ── Bullish divergences (compare last 2 swing lows) ──
  if (swingLows.length >= 2) {
    const l1 = swingLows[swingLows.length - 2];
    const l2 = swingLows[swingLows.length - 1];
    // R6-FIX: 驗證暴機期，避免 NaN fallback
    const rsi1 = (l1.idx >= RSI_WARMUP && !isNaN(rsiArr[l1.idx])) ? rsiArr[l1.idx] : null;
    const rsi2 = (l2.idx >= RSI_WARMUP && !isNaN(rsiArr[l2.idx])) ? rsiArr[l2.idx] : null;
    const macd1 = (l1.idx >= MACD_WARMUP && !isNaN(macdHist[l1.idx])) ? macdHist[l1.idx] : null;
    const macd2 = (l2.idx >= MACD_WARMUP && !isNaN(macdHist[l2.idx])) ? macdHist[l2.idx] : null;

    // Regular Bullish RSI: price LL, RSI HL
    if (rsi1 !== null && rsi2 !== null && l2.price < l1.price * 0.999 && rsi2 > rsi1 + 2) {
      const diff = rsi2 - rsi1;
      results.push({
        type: "regular_bullish",
        indicator: "rsi",
        timeframe,
        price_low1: l1.price,
        price_low2: l2.price,
        indicator_val1: rsi1,
        indicator_val2: rsi2,
        strength: diff > 10 ? "strong" : diff > 5 ? "medium" : "weak",
        description: `底背離：價格創新低 ${l2.price.toFixed(2)} 但 RSI 未跟隨 (${rsi2.toFixed(1)} > ${rsi1.toFixed(1)})，反轉向上信號`,
        candle_idx: l2.idx,
        time: slice[l2.idx]?.time ?? 0,
      });
    }
    // Regular Bullish MACD: price LL, MACD HL
    // R6-FIX: 使用動態閾値
    if (macd1 !== null && macd2 !== null && l2.price < l1.price * 0.999 && macd2 > macd1 + macdThreshold && macd1 < 0) {
      results.push({
        type: "regular_bullish",
        indicator: "macd",
        timeframe,
        price_low1: l1.price,
        price_low2: l2.price,
        indicator_val1: macd1,
        indicator_val2: macd2,
        strength: Math.abs(macd2 - macd1) > Math.abs(macd1) * 0.3 ? "strong" : "medium",
        description: `MACD 底背離：價格創新低但 MACD 柱縮小，動能衰竭，反轉信號`,
        candle_idx: l2.idx,
        time: slice[l2.idx]?.time ?? 0,
      });
    }
    // Hidden Bullish RSI: price HL, RSI LL → continuation up
    if (rsi1 !== null && rsi2 !== null && l2.price > l1.price * 1.001 && rsi2 < rsi1 - 3) {
      results.push({
        type: "hidden_bullish",
        indicator: "rsi",
        timeframe,
        price_low1: l1.price,
        price_low2: l2.price,
        indicator_val1: rsi1,
        indicator_val2: rsi2,
        strength: "medium",
        description: `隱藏底背離：價格高低點但 RSI 低低點，上漲趨勢延續信號`,
        candle_idx: l2.idx,
        time: slice[l2.idx]?.time ?? 0,
      });
    }
  }

  return results;
}

// ============================================================
// PA PATTERNS WITH KEY LEVEL CONFLUENCE
// ============================================================

/**
 * Detect PA patterns and score them by confluence with S/R levels.
 * Only returns patterns with meaningful confluence (score >= 30).
 */
export function detectPaPatternsWithLevels(
  candles: Candle[],
  srLevels: SRLevel[],
  timeframe: string,
  atr: number
): PaPatternWithLevel[] {
  const results: PaPatternWithLevel[] = [];
  const lookback = Math.min(candles.length - 1, 20);

  // [G-ADV1] v3.0: 在迴圈外預先計算真正 EMA5/EMA20 陣列
  const closes = candles.map(c => c.close);
  const ema5Arr  = calcEmaArr(closes, 5);
  const ema20Arr = calcEmaArr(closes, 20);

  for (let i = candles.length - lookback; i < candles.length - 1; i++) {
    if (i < 2) continue;
    const c = candles[i];
    const prev = candles[i - 1];
    const prev2 = candles[i - 2];
    if (!c || !prev || !prev2) continue;

    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) continue;
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const isBullish = c.close >= c.open;

    const detected: CandlestickPattern[] = [];

    // Pin Bar Bullish
    if (lowerWick > body * 2 && lowerWick > upperWick * 2 && range > atr * 0.3) {
      detected.push({
        name: "Bullish Pin Bar",
        type: "bullish",
        strength: lowerWick > body * 3 ? "strong" : "medium",
        desc: `長下影線 Pin Bar，拒絕低價，下影線是實體的 ${(lowerWick / Math.max(body, 0.0001)).toFixed(1)} 倍`,
      });
    }
    // Pin Bar Bearish
    if (upperWick > body * 2 && upperWick > lowerWick * 2 && range > atr * 0.3) {
      detected.push({
        name: "Bearish Pin Bar",
        type: "bearish",
        strength: upperWick > body * 3 ? "strong" : "medium",
        desc: `長上影線 Pin Bar，拒絕高價，上影線是實體的 ${(upperWick / Math.max(body, 0.0001)).toFixed(1)} 倍`,
      });
    }
    // Bullish Engulfing
    if (
      isBullish && prev.close < prev.open &&
      c.open <= prev.close && c.close >= prev.open &&
      body > Math.abs(prev.close - prev.open) * 1.1
    ) {
      detected.push({
        name: "Bullish Engulfing",
        type: "bullish",
        strength: body > Math.abs(prev.close - prev.open) * 1.5 ? "strong" : "medium",
        desc: `多頭吞沒形態，完全吞沒前一根陰線，強勢反轉信號`,
      });
    }
    // Bearish Engulfing
    if (
      !isBullish && prev.close > prev.open &&
      c.open >= prev.close && c.close <= prev.open &&
      body > Math.abs(prev.close - prev.open) * 1.1
    ) {
      detected.push({
        name: "Bearish Engulfing",
        type: "bearish",
        strength: body > Math.abs(prev.close - prev.open) * 1.5 ? "strong" : "medium",
        desc: `空頭吞沒形態，完全吞沒前一根陽線，強勢反轉信號`,
      });
    }
    // Inside Bar
    if (c.high < prev.high && c.low > prev.low && range < (prev.high - prev.low) * 0.7) {
      detected.push({
        name: isBullish ? "Inside Bar (Bullish)" : "Inside Bar (Bearish)",
        type: isBullish ? "bullish" : "bearish",
        strength: "medium",
        desc: `內包線，市場整理蓄力，突破方向為 ${isBullish ? "多" : "空"}`,
      });
    }
    // Hammer - R6-FIX: 加入趨勢背景驗證（必須在下降趨勢後出現）
    const priorDowntrend = i >= 5 && candles[i - 1].close < candles[i - 5].close;
    if (isBullish && lowerWick > range * 0.5 && body < range * 0.3 && priorDowntrend) {
      detected.push({
        name: "Hammer",
        type: "bullish",
        strength: lowerWick > range * 0.65 ? "strong" : "medium",
        desc: `锤形線，在下降趨勢後出現，強烈拒絕低價（下影線占 ${(lowerWick / range * 100).toFixed(0)}%）`,
      });
    }
    // Shooting Star - R6-FIX: 加入趨勢背景驗證（必須在上漲趨勢後出現）
    const priorUptrend = i >= 5 && candles[i - 1].close > candles[i - 5].close;
    if (!isBullish && upperWick > range * 0.5 && body < range * 0.3 && priorUptrend) {
      detected.push({
        name: "Shooting Star",
        type: "bearish",
        strength: upperWick > range * 0.65 ? "strong" : "medium",
        desc: `流星線，在上漲趨勢後出現，強烈拒絕高價（上影線占 ${(upperWick / range * 100).toFixed(0)}%）`,
      });
    }
    // Morning Star (3-candle)
    if (i >= 2) {
      const body0 = Math.abs(prev2.close - prev2.open);
      const body2 = Math.abs(c.close - c.open);
      if (
        prev2.close < prev2.open &&
        Math.abs(prev.close - prev.open) < body0 * 0.3 &&
        c.close > c.open && body2 > body0 * 0.5
      ) {
        detected.push({
          name: "Morning Star",
          type: "bullish",
          strength: "strong",
          desc: `早晨之星三K線反轉形態，強烈底部反轉信號`,
        });
      }
      // Evening Star
      if (
        prev2.close > prev2.open &&
        Math.abs(prev.close - prev.open) < body0 * 0.3 &&
        c.close < c.open && body2 > body0 * 0.5
      ) {
        detected.push({
          name: "Evening Star",
          type: "bearish",
          strength: "strong",
          desc: `黃昏之星三K線反轉形態，強烈頂部反轉信號`,
        });
      }
    }

    // ── v3.0 改良：使用真正 EMA（原為 SMA，命名錯誤）──
    // [G-ADV1] ema5/ema20 原為简單平均，現改為真正 EMA（利用全局陣列在迴圈外預先計算）
    const ema5Val  = isFiniteNumber(ema5Arr[i])  ? ema5Arr[i]  : c.close;
    const ema20Val = isFiniteNumber(ema20Arr[i]) ? ema20Arr[i] : c.close;
    const shortTermTrend = ema5Val > ema20Val * 1.001 ? "bullish" : ema5Val < ema20Val * 0.999 ? "bearish" : "ranging";
    // [G-ADV2] avgVol 除數修正：原除以固定 20，實際可用數量可能 < 20
    const volSlice = candles.slice(Math.max(0, i - 20), i);
    const avgVol = volSlice.length > 0 ? volSlice.reduce((s, cc) => s + cc.volume, 0) / volSlice.length : 1;
    const volConfirm = c.volume > avgVol * 1.3;
    const volScore = volConfirm ? 10 : 0;

    for (const pattern of detected) {
      const price = c.close;
      let nearestLevel: SRLevel | null = null;
      let minDist = Infinity;
      for (const lvl of srLevels) {
        const dist = Math.abs(lvl.price - price) / price;
        if (dist < minDist) { minDist = dist; nearestLevel = lvl; }
      }
      // [G-ADV3] distPct 改用 ATR 正規化（原為百分比硬編碼 0.5%，對高價幣種失效）
      const distPct = minDist * 100; // 保留百分比顯示
      const atKeyLevel = atr > 0 ? minDist < atr * 0.5 : distPct < 0.5; // ATR 正規化

      let srAligned = false;
      if (nearestLevel) {
        if (pattern.type === "bullish" && nearestLevel.type === "support") srAligned = true;
        if (pattern.type === "bearish" && nearestLevel.type === "resistance") srAligned = true;
      }

      // 趨勢上下文對齊評分：順勢加分，逆勢減分
      let trendContextScore = 0;
      if (pattern.type === "bullish" && shortTermTrend === "bullish") trendContextScore = 15;
      else if (pattern.type === "bearish" && shortTermTrend === "bearish") trendContextScore = 15;
      else if (pattern.type === "bullish" && shortTermTrend === "bearish") trendContextScore = -20;
      else if (pattern.type === "bearish" && shortTermTrend === "bullish") trendContextScore = -20;

      let score = 0;
      if (pattern.strength === "strong") score += 40;
      else if (pattern.strength === "medium") score += 25;
      else score += 10;
      if (atKeyLevel) score += 30;
      else if (distPct < 1.5) score += 15;
      if (srAligned) score += 20;
      if (nearestLevel && nearestLevel.strength >= 3) score += 10;
      score += trendContextScore; // 趨勢上下文加減分
      score += volScore;           // 量能加分

      if (score < 30) continue;

      // ── Opus 4.6 P1 改良：SL 改為 ATR 動態計算（順勢時縮小 SL）──
      const slMultiplier = shortTermTrend === pattern.type ? 1.2 : 1.8; // 順勢縮小 SL，逆勢放大 SL
      const slDist = atr * slMultiplier;
      const sl = pattern.type === "bullish" ? price - slDist : price + slDist;
      const tp = pattern.type === "bullish" ? price + slDist * 2 : price - slDist * 2;

      results.push({
        pattern,
        at_key_level: atKeyLevel,
        nearest_level: nearestLevel,
        distance_to_level_pct: distPct,
        liquidity_nearby: distPct < 1.0,
        confluence_score: Math.min(100, Math.max(0, score)),
        entry: price,
        sl,
        tp,
        timeframe,
        time: c.time,
      });
    }
  }

  return results.sort((a, b) => b.confluence_score - a.confluence_score).slice(0, 5);
}

// ============================================================
// ENHANCED CHAN THEORY ENGINE
// 包含處理、頂底分型、筆、線段、中樞、背馳、一二三買賣點
// ============================================================

interface ChanFractal {
  idx: number;
  type: "top" | "bottom";
  price: number;
  time: number;
}

interface ChanBiInternal {
  direction: "up" | "down";
  start: number;
  end: number;
  start_time: number;
  end_time: number;
  start_idx: number;
  end_idx: number;
  macd_area: number;
}

/** Step 1: K線包含處理 */
function mergeContainingCandles(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const merged: Candle[] = [{ ...candles[0] }];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const last = merged[merged.length - 1];
    const lastContainsCur = last.high >= cur.high && last.low <= cur.low;
    const curContainsLast = cur.high >= last.high && cur.low <= last.low;
    if (lastContainsCur || curContainsLast) {
      const priorUp = merged.length >= 2 && merged[merged.length - 2].high < last.high;
      if (priorUp) {
        merged[merged.length - 1] = {
          ...last,
          high: Math.max(last.high, cur.high),
          low: Math.max(last.low, cur.low),
          close: cur.close,
          volume: last.volume + cur.volume,
          time: cur.time,
        };
      } else {
        merged[merged.length - 1] = {
          ...last,
          high: Math.min(last.high, cur.high),
          low: Math.min(last.low, cur.low),
          close: cur.close,
          volume: last.volume + cur.volume,
          time: cur.time,
        };
      }
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/** Step 2: 找頂底分型 */
function findFractals(merged: Candle[]): ChanFractal[] {
  const fractals: ChanFractal[] = [];
  for (let i = 1; i < merged.length - 1; i++) {
    const prev = merged[i - 1], cur = merged[i], next = merged[i + 1];
    if (cur.high > prev.high && cur.high > next.high)
      fractals.push({ idx: i, type: "top", price: cur.high, time: cur.time });
    else if (cur.low < prev.low && cur.low < next.low)
      fractals.push({ idx: i, type: "bottom", price: cur.low, time: cur.time });
  }
  // Remove consecutive same-type fractals (keep extreme)
  const cleaned: ChanFractal[] = [];
  for (const f of fractals) {
    const last = cleaned[cleaned.length - 1];
    if (last && last.type === f.type) {
      if (f.type === "top" && f.price > last.price) cleaned[cleaned.length - 1] = f;
      else if (f.type === "bottom" && f.price < last.price) cleaned[cleaned.length - 1] = f;
    } else cleaned.push(f);
  }
  return cleaned;
}

/** Step 3: 形成筆 (Bi) */
function formBis(fractals: ChanFractal[], merged: Candle[]): ChanBiInternal[] {
  const bis: ChanBiInternal[] = [];
  for (let i = 0; i < fractals.length - 1; i++) {
    const a = fractals[i], b = fractals[i + 1];
    if (b.type === a.type) continue;
    if (b.idx - a.idx < 4) continue;
    if (a.type === "bottom" && b.type === "top" && b.price <= a.price) continue;
    if (a.type === "top" && b.type === "bottom" && b.price >= a.price) continue;

    const sliceCandles = merged.slice(a.idx, b.idx + 1);
    const sliceCloses = sliceCandles.map(c => c.close);
    const biDir = a.type === "bottom" ? "up" : "down";
    let macdArea = 0;
    
    // 優先使用 MACD 面積（需要至少 35 根 K 線），不足時使用動能代理指標
    if (sliceCloses.length >= 35) {
      const macdResult = calcMacdArr(sliceCloses);
      // 只累加與筆方向一致的 MACD 柱狀圖面積，避免零軸附近的雜訊影響
      macdArea = macdResult.hist.reduce((sum, v) => {
        if (isNaN(v)) return sum;
        if (biDir === "up" && v > 0) return sum + v;
        if (biDir === "down" && v < 0) return sum + Math.abs(v);
        return sum;
      }, 0);
    } else if (sliceCloses.length >= 3) {
      // 動能代理指標：使用每根 K 線的 (high-low) × volume 加總
      // 代表筆的「動能強度」，可用於背馳比較
      macdArea = sliceCandles.reduce((sum, c) => {
        const momentum = (c.high - c.low) * (c.volume || 1);
        return sum + momentum;
      }, 0);
      // 正規化：除以平均價格使面積具有可比性
      const avgPrice = sliceCloses.reduce((a, b) => a + b, 0) / sliceCloses.length;
      macdArea = macdArea / (avgPrice || 1);
    }

    bis.push({
      direction: a.type === "bottom" ? "up" : "down",
      start: a.price, end: b.price,
      start_time: a.time, end_time: b.time,
      start_idx: a.idx, end_idx: b.idx,
      macd_area: macdArea,
    });
  }
  return bis;
}

/** Step 4: 形成線段 (Duan) */
function formDuans(bis: ChanBiInternal[]): { direction: "up" | "down"; start: number; end: number; start_time: number; end_time: number }[] {
  const duans: { direction: "up" | "down"; start: number; end: number; start_time: number; end_time: number }[] = [];
  if (bis.length < 3) return duans;
  let duanStart = 0;
  for (let i = 2; i < bis.length; i += 2) {
    const b0 = bis[duanStart], b2 = bis[i];
    if (b0.direction !== b2.direction) { duanStart = i; continue; }
    if (b2.direction === "up" && b2.end > b0.end) {
      duans.push({ direction: "up", start: b0.start, end: b2.end, start_time: b0.start_time, end_time: b2.end_time });
      duanStart = i + 1;
    } else if (b2.direction === "down" && b2.end < b0.end) {
      duans.push({ direction: "down", start: b0.start, end: b2.end, start_time: b0.start_time, end_time: b2.end_time });
      duanStart = i + 1;
    }
  }
  return duans;
}

/** Step 5: 形成走勢中樞 (Zhongshu) */
function formZhongshus(bis: ChanBiInternal[]): { top: number; bottom: number; mid: number; start_time: number; end_time: number }[] {
  const zhongshus: { top: number; bottom: number; mid: number; start_time: number; end_time: number }[] = [];
  for (let i = 0; i <= bis.length - 3; i++) {
    const b0 = bis[i], b1 = bis[i + 1], b2 = bis[i + 2];
    const top = Math.min(
      Math.max(b0.start, b0.end),
      Math.max(b1.start, b1.end),
      Math.max(b2.start, b2.end)
    );
    const bottom = Math.max(
      Math.min(b0.start, b0.end),
      Math.min(b1.start, b1.end),
      Math.min(b2.start, b2.end)
    );
    if (top > bottom) {
      const last = zhongshus[zhongshus.length - 1];
      if (last && !(top < last.bottom || bottom > last.top)) {
        last.top = Math.max(last.top, top);
        last.bottom = Math.min(last.bottom, bottom);
        last.mid = (last.top + last.bottom) / 2;
        last.end_time = b2.end_time;
      } else {
        zhongshus.push({ top, bottom, mid: (top + bottom) / 2, start_time: b0.start_time, end_time: b2.end_time });
      }
    }
  }
  return zhongshus;
}

/** Step 6: 背馳偵測 (MACD 面積比較) */
function detectBeichi(bis: ChanBiInternal[]): { type: "top" | "bottom" | null; description: string; strength: string } {
  if (bis.length < 4) return { type: null, description: "筆數不足，無法判斷背馳", strength: "weak" };
  const lastBi = bis[bis.length - 1];
  const sameDirBis = bis.filter(b => b.direction === lastBi.direction);
  if (sameDirBis.length < 2) return { type: null, description: "同向筆不足", strength: "weak" };
  const prev = sameDirBis[sameDirBis.length - 2];
  const curr = sameDirBis[sameDirBis.length - 1];
  
  // MACD Area Divergence Calculation
  const prevArea = Math.abs(prev.macd_area);
  const currArea = Math.abs(curr.macd_area);
  
  if (prevArea === 0) return { type: null, description: "MACD 面積計算不足", strength: "weak" };
  
  const ratio = currArea / prevArea;
  
  // R7-FIX: 強化背馳判斷，加入 MACD 面積和幅度的雙重驗證
  const prevAmp = Math.abs(prev.end - prev.start);
  const currAmp = Math.abs(curr.end - curr.start);
  const ampRatio = prevAmp > 0 ? currAmp / prevAmp : 1;
  
  // Top Divergence: Price makes higher high, but MACD area is significantly smaller
  if (lastBi.direction === "up" && curr.end > prev.end) {
    // 面積縮小 或 (面積微縮但幅度明顯縮小)
    if (ratio < 0.6 || (ratio < 0.8 && ampRatio < 0.7)) {
      const strength = ratio < 0.3 ? "strong" : ratio < 0.45 ? "medium" : "weak";
      return { type: "top", description: `纏論頂背馳：價格創新高，但 MACD 面積縮小至 ${(ratio * 100).toFixed(0)}% (幅度 ${(ampRatio * 100).toFixed(0)}%)，動能衰竭`, strength };
    }
  }
  
  // Bottom Divergence: Price makes lower low, but MACD area is significantly smaller
  if (lastBi.direction === "down" && curr.end < prev.end) {
    if (ratio < 0.6 || (ratio < 0.8 && ampRatio < 0.7)) {
      const strength = ratio < 0.3 ? "strong" : ratio < 0.45 ? "medium" : "weak";
      return { type: "bottom", description: `纏論底背馳：價格創新低，但 MACD 面積縮小至 ${(ratio * 100).toFixed(0)}% (幅度 ${(ampRatio * 100).toFixed(0)}%)，動能衰竭`, strength };
    }
  }
  
  return { type: null, description: "無明顯背馳信號", strength: "weak" };
}

/** Step 7: 識別一二三類買賣點 */
function identifyBuySellPoints(
  bis: ChanBiInternal[],
  zhongshus: { top: number; bottom: number; mid: number; start_time: number; end_time: number }[],
  beichi: { type: "top" | "bottom" | null; description: string; strength: string }
): ChanBuyPoint[] {
  const points: ChanBuyPoint[] = [];
  if (bis.length === 0) return points;
  const lastBi = bis[bis.length - 1];
  const lastZhongshu = zhongshus[zhongshus.length - 1];

  // Level 1: Divergence-confirmed reversal
  if (beichi.type === "bottom") {
    points.push({
      level: 1, direction: "buy",
      price: lastBi.end, time: lastBi.end_time, bi_idx: bis.length - 1,
      description: `一類買點：${beichi.description}，此為最低風險買入位置`,
      strength: beichi.strength as "strong" | "medium" | "weak",
      divergence_confirmed: true, after_zhongshu_break: false, trend_continuation: false,
    });
  }
  if (beichi.type === "top") {
    points.push({
      level: 1, direction: "sell",
      price: lastBi.end, time: lastBi.end_time, bi_idx: bis.length - 1,
      description: `一類賣點：${beichi.description}，此為最低風險賣出位置`,
      strength: beichi.strength as "strong" | "medium" | "weak",
      divergence_confirmed: true, after_zhongshu_break: false, trend_continuation: false,
    });
  }

  // Level 2 & 3: Based on zhongshu break
  if (lastZhongshu && bis.length >= 5) {
    const recentBis = bis.slice(-5);
    const brokeAbove = recentBis.some(b => b.direction === "up" && b.end > lastZhongshu.top);
    const brokeBelow = recentBis.some(b => b.direction === "down" && b.end < lastZhongshu.bottom);

    if (brokeAbove) {
      if (lastBi.direction === "down" && lastBi.end > lastZhongshu.top) {
        points.push({
          level: 2, direction: "buy",
          price: lastBi.end, time: lastBi.end_time, bi_idx: bis.length - 1,
          description: `二類買點：中樞上方突破後回踩，未跌回中樞（${lastZhongshu.top.toFixed(2)}），確認上漲趨勢`,
          strength: "medium", divergence_confirmed: false, after_zhongshu_break: true, trend_continuation: false,
        });
      }
      if (lastBi.direction === "down" && Math.abs(lastBi.end - lastZhongshu.top) / lastZhongshu.top < 0.015) {
        points.push({
          level: 3, direction: "buy",
          price: lastZhongshu.top, time: lastBi.end_time, bi_idx: bis.length - 1,
          description: `三類買點：回踩中樞頂部 ${lastZhongshu.top.toFixed(2)} 確認支撐，趨勢延續買點`,
          strength: "medium", divergence_confirmed: false, after_zhongshu_break: true, trend_continuation: true,
        });
      }
    }
    if (brokeBelow) {
      if (lastBi.direction === "up" && lastBi.end < lastZhongshu.bottom) {
        points.push({
          level: 2, direction: "sell",
          price: lastBi.end, time: lastBi.end_time, bi_idx: bis.length - 1,
          description: `二類賣點：中樞下方突破後反彈，未回到中樞（${lastZhongshu.bottom.toFixed(2)}），確認下跌趨勢`,
          strength: "medium", divergence_confirmed: false, after_zhongshu_break: true, trend_continuation: false,
        });
      }
      if (lastBi.direction === "up" && Math.abs(lastBi.end - lastZhongshu.bottom) / lastZhongshu.bottom < 0.015) {
        points.push({
          level: 3, direction: "sell",
          price: lastZhongshu.bottom, time: lastBi.end_time, bi_idx: bis.length - 1,
          description: `三類賣點：反彈至中樞底部 ${lastZhongshu.bottom.toFixed(2)} 確認阻力，趨勢延續賣點`,
          strength: "medium", divergence_confirmed: false, after_zhongshu_break: true, trend_continuation: true,
        });
      }
    }
  }
  return points;
}

/**
 * Full enhanced Chan Theory analysis
 * v3 改良：新增 lookback 動態參數，預設 400 根 K 線
 * — 對於 15m 等高頻時間框架，建議傳入 500
 * — 對於 4H 等低頻時間框架，預設 400 已足夠
 */
export function calcChanEnhanced(candles: Candle[], currentPrice: number, lookback = 400) {
  if (candles.length < 20) {
    return {
      bis: [], duans: [], zhongshus: [], trend: "ranging" as const,
      in_zhongshu: false, current_zhongshu: null,
      bi_count: 0, duan_count: 0,
      buy_sell_points: [] as ChanBuyPoint[],
      divergence_signals: { type: null as null, description: "K線數量不足", strength: "weak" },
      macd_area_ratio: 0,
    };
  }

  const merged = mergeContainingCandles(candles.slice(-lookback));
  const fractals = findFractals(merged);
  const bis = formBis(fractals, merged);
  const duans = formDuans(bis);
  const zhongshus = formZhongshus(bis);
  const beichi = detectBeichi(bis);
  const buySellPoints = identifyBuySellPoints(bis, zhongshus, beichi);

  let trend: "bullish" | "bearish" | "ranging" = "ranging";
  if (bis.length >= 2) {
    const lastBi = bis[bis.length - 1];
    const prevSameDirBi = bis.slice(0, -1).filter(b => b.direction === lastBi.direction).pop();
    if (prevSameDirBi) {
      if (lastBi.direction === "up" && lastBi.end > prevSameDirBi.end) trend = "bullish";
      else if (lastBi.direction === "down" && lastBi.end < prevSameDirBi.end) trend = "bearish";
    }
  }

  const lastZhongshu = zhongshus[zhongshus.length - 1] ?? null;
  const inZhongshu = lastZhongshu
    ? currentPrice >= lastZhongshu.bottom && currentPrice <= lastZhongshu.top
    : false;

  let macdAreaRatio = 0;
  if (bis.length >= 2) {
    const lastBi = bis[bis.length - 1];
    const sameDirBis = bis.filter(b => b.direction === lastBi.direction);
    if (sameDirBis.length >= 2) {
      const prev = sameDirBis[sameDirBis.length - 2];
      const curr = sameDirBis[sameDirBis.length - 1];
      if (prev.macd_area > 0) macdAreaRatio = curr.macd_area / prev.macd_area;
    }
  }

  // R8-FIX: 重新計算 ZG/ZD/GG/DD（纏論標準定義）
  let zhongshuZG = 0, zhongshuZD = 0, zhongshuGG = 0, zhongshuDD = 0;
  if (lastZhongshu) {
    zhongshuZG = lastZhongshu.top;
    zhongshuZD = lastZhongshu.bottom;
    zhongshuGG = lastZhongshu.top; // 簡化版，實際應取中樞內所有筆的高點最大值
    zhongshuDD = lastZhongshu.bottom; // 簡化版，實際應取中樞內所有筆的低點最小值
  }

  return {
    bis: bis.map(b => ({ direction: b.direction, start: b.start, end: b.end, start_time: b.start_time, end_time: b.end_time })),
    duans,
    zhongshus,
    trend,
    in_zhongshu: inZhongshu,
    current_zhongshu: lastZhongshu,
    zhongshuZG,
    zhongshuZD,
    zhongshuGG,
    zhongshuDD,
    bi_count: bis.length,
    duan_count: duans.length,
    buy_sell_points: buySellPoints,
    divergence_signals: beichi,
    macd_area_ratio: macdAreaRatio,
  };
}

// ============================================================
// SMC ULTIMATE CONFIRMATION MODEL (Sweep -> FVG -> OB)
// ============================================================

/**
 * Detect high-probability SMC setups:
 * Act 1: Liquidity Sweep (SSL/BSL)
 * Act 2: Displacement + FVG (Fair Value Gap)
 * Act 3: Order Block retracement (entry zone)
 *
 * v3 新增：maxBarsBetweenActs 時間衰減機制
 * — Sweep 後超過 N 根 K 線未出現 FVG，該信號作廢（標記為 invalidated）
 * — 預設 8 根 K 線（可由呼叫方調整）
 */
export function detectSmcConfirmationSetups(
  candles: Candle[],
  currentPrice: number,
  htfTrend: "bullish" | "bearish" | "ranging",
  maxBarsBetweenActs = 8
): SmcConfirmationSetup[] {
  const setups: SmcConfirmationSetup[] = [];
  const slice = candles.slice(-100);
  if (slice.length < 20) return setups;

  const swingHighs = findSwingHighs(slice, 5);
  const swingLows = findSwingLows(slice, 5);
  const atr = calcAtrLast(slice, 14);

  // ── Bullish setups: SSL sweep → bullish FVG → bullish OB ──
  for (let i = 10; i < slice.length - 4; i++) {
    const c = slice[i];
    const recentLow = swingLows.filter(l => l.idx < i - 2 && l.idx > i - 20);
    for (const swLow of recentLow.slice(-2)) {
      if (c.low < swLow.price && c.close > swLow.price) {
        // SSL swept! Look for displacement FVG within maxBarsBetweenActs candles
        // v3: 超過時間限制則標記為 invalidated
        const fvgSearchEnd = Math.min(i + maxBarsBetweenActs + 1, slice.length - 1);
        const fvgFound = slice.slice(i + 1, fvgSearchEnd).some((_, idx) => {
          const j = i + 1 + idx;
          const fvgC1 = slice[j - 1], fvgC2 = slice[j], fvgC3 = slice[j + 1];
          return fvgC3 && fvgC3.low > fvgC1.high && fvgC2.close > fvgC2.open;
        });
        if (!fvgFound && i < slice.length - maxBarsBetweenActs - 2) {
          // Sweep 已超時，標記為 invalidated 並跳過
          setups.push({
            id: `bull_invalidated_${i}`,
            direction: "bullish",
            sweep: { type: "SSL", swept_level: swLow.price, sweep_time: c.time, sweep_candle_idx: i },
            fvg: { type: "bullish", top: 0, bottom: 0, mid: 0, time: 0, filled: false, size: 0, idx: -1 },
            ob: { type: "bullish", top: 0, bottom: 0, mid: 0, time: 0, tested: false, strength: "normal", idx: -1 },
            confluence_score: 0,
            htf_aligned: htfTrend === "bullish",
            entry_zone: { top: 0, bottom: 0 },
            sl: 0, tp1: 0, tp2: 0, rr_ratio: 0,
            status: "invalidated",
            formed_at: c.time,
          });
          continue;
        }
        for (let j = i + 1; j < fvgSearchEnd; j++) {
          const fvgC1 = slice[j - 1];
          const fvgC2 = slice[j];
          const fvgC3 = slice[j + 1];
          if (!fvgC3) continue;
          // Bullish FVG: fvgC1.high < fvgC3.low
          if (fvgC3.low > fvgC1.high && fvgC2.close > fvgC2.open) {
            const fvgTop = fvgC3.low, fvgBottom = fvgC1.high;
            const fvgSize = (fvgTop - fvgBottom) / currentPrice;
            if (fvgSize < 0.0003) continue;
            // Find OB: last bearish candle before displacement
            let obCandle = fvgC1;
            for (let k = j - 1; k >= Math.max(0, j - 5); k--) {
              if (slice[k].close < slice[k].open) { obCandle = slice[k]; break; }
            }
            const obTop = Math.max(obCandle.open, obCandle.close);
            const obBottom = Math.min(obCandle.open, obCandle.close);
            const obFvgOverlap = obTop >= fvgBottom && obBottom <= fvgTop;

            // ── Opus 4.6 P0 改良：废除 50 分基礎分，改為 0 分累加制 ──
            let score = 0;
            const sweepDepth = swLow.price - c.low;
            const sweepRatio = sweepDepth / atr;
            const displacementBody = Math.abs(fvgC2.close - fvgC2.open);

            // 硬性否決：假掴豚（刷穿深度 < 0.05 ATR 且收盤未回到掴豚水平上）
            // 修復：兩個條件必須同時成立才算假掴豚（OR 改為 AND）
            if (sweepRatio >= 0.05 && c.close > swLow.price) {
              // 1. FVG 與 OB 重疊驗證 — 最高 30 分
              if (obFvgOverlap) score += 30;
              else if (Math.abs(obTop - fvgBottom) / (currentPrice + 1e-9) < 0.001) score += 15;

              // 2. 流動性清掃強度 — 最高 25 分
              if (sweepRatio > 0.5) score += 25;
              else if (sweepRatio > 0.3) score += 20;
              else if (sweepRatio > 0.1) score += 12;
              else score += 5;

              // 3. 位移強度 — 最高 20 分
              if (displacementBody > atr * 1.5) score += 20;
              else if (displacementBody > atr * 0.8) score += 15;
              else if (displacementBody > atr * 0.4) score += 8;

              // 4. HTF 對齊 — 最高 15 分
              if (htfTrend === "bullish") score += 15;
              else if (htfTrend === "ranging") score -= 5;

              // 5. FVG 大小適中度 — 最高 10 分
              if (fvgSize > 0.002 && fvgSize < 0.01) score += 10;
              else if (fvgSize >= 0.001) score += 5;

              // 6. 收盤回收確認 — 最高 10 分
              if (c.close > c.open && c.close > swLow.price) score += 10;
            }

            const entryTop = obFvgOverlap ? Math.min(obTop, fvgTop) : obTop;
            const entryBottom = obFvgOverlap ? Math.max(obBottom, fvgBottom) : obBottom;
            const entryMid = (entryTop + entryBottom) / 2;

            // ── Opus 4.6 P0 改良：SL 改為結構失效點（sweep candle 最低點下方）──
            // 修復：用 sweep candle 的實際最低點，加上 ATR * 0.15 的小緩衝
            const dynamicSlBuffer = atr * 0.15;
            const sl = c.low - dynamicSlBuffer; // sweep candle 最低點下方（結構失效點）
            const riskDist = entryMid - sl;
            // 修復：動態 RR 目標：風險距離 > 2 ATR 時用 2.0R/4.0R，否則用 1.5R/3.0R
            const tp1 = entryMid + riskDist * (riskDist > atr * 2 ? 2.0 : 1.5);
            const tp2 = entryMid + riskDist * (riskDist > atr * 2 ? 4.0 : 3.0);
            const rrRatio = riskDist > 0 ? (tp1 - entryMid) / riskDist : 0;
            const priceNearEntry = currentPrice <= entryTop * 1.03 && currentPrice >= entryBottom * 0.97;
            setups.push({
              id: `bull_${i}_${j}`,
              direction: "bullish",
              sweep: { type: "SSL", swept_level: swLow.price, sweep_time: c.time, sweep_candle_idx: i },
              fvg: { type: "bullish", top: fvgTop, bottom: fvgBottom, mid: (fvgTop + fvgBottom) / 2, time: fvgC2.time, filled: currentPrice < fvgBottom, size: fvgSize, idx: j },
              ob: { type: "bullish", top: obTop, bottom: obBottom, mid: (obTop + obBottom) / 2, time: obCandle.time, tested: priceNearEntry, strength: obFvgOverlap ? "strong" : "normal", idx: j - 1 },
              confluence_score: Math.min(100, score),
              htf_aligned: htfTrend === "bullish",
              entry_zone: { top: entryTop, bottom: entryBottom },
              sl, tp1, tp2,
              rr_ratio: Math.round(rrRatio * 10) / 10,
              status: priceNearEntry ? "active" : (currentPrice > fvgTop ? "completed" : "waiting"),
              formed_at: fvgC2.time,
            });
            break;
          }
        }
      }
    }
  }

  // ── Bearish setups: BSL sweep → bearish FVG → bearish OB ──
  for (let i = 10; i < slice.length - 4; i++) {
    const c = slice[i];
    const recentHigh = swingHighs.filter(h => h.idx < i - 2 && h.idx > i - 20);
    for (const swHigh of recentHigh.slice(-2)) {
      if (c.high > swHigh.price && c.close < swHigh.price) {
        // v3: 時間衰減機制，超過 maxBarsBetweenActs 根 K 線未出現 FVG 則作廢
        const bearFvgSearchEnd = Math.min(i + maxBarsBetweenActs + 1, slice.length - 1);
        const bearFvgFound = slice.slice(i + 1, bearFvgSearchEnd).some((_, idx) => {
          const j = i + 1 + idx;
          const fvgC1 = slice[j - 1], fvgC2 = slice[j], fvgC3 = slice[j + 1];
          return fvgC3 && fvgC1.low > fvgC3.high && fvgC2.close < fvgC2.open;
        });
        if (!bearFvgFound && i < slice.length - maxBarsBetweenActs - 2) {
          setups.push({
            id: `bear_invalidated_${i}`,
            direction: "bearish",
            sweep: { type: "BSL", swept_level: swHigh.price, sweep_time: c.time, sweep_candle_idx: i },
            fvg: { type: "bearish", top: 0, bottom: 0, mid: 0, time: 0, filled: false, size: 0, idx: -1 },
            ob: { type: "bearish", top: 0, bottom: 0, mid: 0, time: 0, tested: false, strength: "normal", idx: -1 },
            confluence_score: 0,
            htf_aligned: htfTrend === "bearish",
            entry_zone: { top: 0, bottom: 0 },
            sl: 0, tp1: 0, tp2: 0, rr_ratio: 0,
            status: "invalidated",
            formed_at: c.time,
          });
          continue;
        }
        for (let j = i + 1; j < bearFvgSearchEnd; j++) {
          const fvgC1 = slice[j - 1];
          const fvgC2 = slice[j];
          const fvgC3 = slice[j + 1];
          if (!fvgC3) continue;
          // Bearish FVG: fvgC1.low > fvgC3.high
          if (fvgC1.low > fvgC3.high && fvgC2.close < fvgC2.open) {
            const fvgTop = fvgC1.low, fvgBottom = fvgC3.high;
            const fvgSize = (fvgTop - fvgBottom) / currentPrice;
            if (fvgSize < 0.0003) continue;
            let obCandle = fvgC1;
            for (let k = j - 1; k >= Math.max(0, j - 5); k--) {
              if (slice[k].close > slice[k].open) { obCandle = slice[k]; break; }
            }
            const obTop = Math.max(obCandle.open, obCandle.close);
            const obBottom = Math.min(obCandle.open, obCandle.close);
            const obFvgOverlap = obTop >= fvgBottom && obBottom <= fvgTop;

            // ── Opus 4.6 P0 改良：废除 50 分基礎分，改為 0 分累加制 ──
            let score = 0;
            const sweepDepth = c.high - swHigh.price;
            const sweepRatio = sweepDepth / atr;
            const displacementBody = Math.abs(fvgC2.close - fvgC2.open);

            // 硬性否決：假掴豚（刷穿深度 < 0.05 ATR 且收盤未回到掴豚水平下）
            // 修復：兩個條件必須同時成立才算假掴豚（OR 改為 AND）
            if (sweepRatio >= 0.05 && c.close < swHigh.price) {
              // 1. FVG 與 OB 重疊驗證 — 最高 30 分
              if (obFvgOverlap) score += 30;
              else if (Math.abs(obBottom - fvgTop) / (currentPrice + 1e-9) < 0.001) score += 15;

              // 2. 流動性清掃強度 — 最高 25 分
              if (sweepRatio > 0.5) score += 25;
              else if (sweepRatio > 0.3) score += 20;
              else if (sweepRatio > 0.1) score += 12;
              else score += 5;

              // 3. 位移強度 — 最高 20 分
              if (displacementBody > atr * 1.5) score += 20;
              else if (displacementBody > atr * 0.8) score += 15;
              else if (displacementBody > atr * 0.4) score += 8;

              // 4. HTF 對齊 — 最高 15 分
              if (htfTrend === "bearish") score += 15;
              else if (htfTrend === "ranging") score -= 5;

              // 5. FVG 大小適中度 — 最高 10 分
              if (fvgSize > 0.002 && fvgSize < 0.01) score += 10;
              else if (fvgSize >= 0.001) score += 5;

              // 6. 收盤回收確認 — 最高 10 分
              if (c.close < c.open && c.close < swHigh.price) score += 10;
            }

            const entryTop = obFvgOverlap ? Math.min(obTop, fvgTop) : obTop;
            const entryBottom = obFvgOverlap ? Math.max(obBottom, fvgBottom) : obBottom;
            const entryMid = (entryTop + entryBottom) / 2;

            // ── Opus 4.6 P0 改良：SL 改為結構失效點（sweep candle 最高點上方）──
            // 修復：用 sweep candle 的實際最高點，加上 ATR * 0.15 的小緩衝
            const dynamicSlBuffer = atr * 0.15;
            const sl = c.high + dynamicSlBuffer; // sweep candle 最高點上方（結構失效點）
            const riskDist = sl - entryMid;
            // 修復：動態 RR 目標：風險距離 > 2 ATR 時用 2.0R/4.0R，否則用 1.5R/3.0R
            const tp1 = entryMid - riskDist * (riskDist > atr * 2 ? 2.0 : 1.5);
            const tp2 = entryMid - riskDist * (riskDist > atr * 2 ? 4.0 : 3.0);
            const rrRatio = riskDist > 0 ? (entryMid - tp1) / riskDist : 0;
            const priceNearEntry = currentPrice >= entryBottom * 0.97 && currentPrice <= entryTop * 1.03;
            setups.push({
              id: `bear_${i}_${j}`,
              direction: "bearish",
              sweep: { type: "BSL", swept_level: swHigh.price, sweep_time: c.time, sweep_candle_idx: i },
              fvg: { type: "bearish", top: fvgTop, bottom: fvgBottom, mid: (fvgTop + fvgBottom) / 2, time: fvgC2.time, filled: currentPrice > fvgTop, size: fvgSize, idx: j },
              ob: { type: "bearish", top: obTop, bottom: obBottom, mid: (obTop + obBottom) / 2, time: obCandle.time, tested: priceNearEntry, strength: obFvgOverlap ? "strong" : "normal", idx: j - 1 },
              confluence_score: Math.min(100, score),
              htf_aligned: htfTrend === "bearish",
              entry_zone: { top: entryTop, bottom: entryBottom },
              sl, tp1, tp2,
              rr_ratio: Math.round(rrRatio * 10) / 10,
              status: priceNearEntry ? "active" : (currentPrice < fvgBottom ? "completed" : "waiting"),
              formed_at: fvgC2.time,
            });
            break;
          }
        }
      }
    }
  }

  // R6-FIX: 加入方向一致性驗證和時序驗證
  // 1. Sweep 必須在 FVG 之前（已由迴圈結構保證）
  // 2. FVG 必須在 OB 之後（已由迴圈結構保證）
  // 3. 新增：驗證三部曲內部方向一致性（Sweep 方向 = FVG 方向 = OB 方向）
  const validatedSetups = setups.filter(setup => {
    if (setup.status === "invalidated") return true; // 保留失效記錄
    // 方向一致性驗證
    const directionMatch = setup.fvg.type === setup.direction && setup.ob.type === setup.direction;
    if (!directionMatch) return false;
    // 時序驗證：Sweep idx < FVG idx < OB idx
    const sweepIdx = setup.sweep.sweep_candle_idx;
    const fvgIdx = setup.fvg.idx;
    const obIdx = setup.ob.idx;
    if (fvgIdx === -1 || obIdx === -1) return true; // invalidated 記錄已處理
    const timeOrderValid = sweepIdx < fvgIdx; // OB 在 FVG 前形成，所以 obIdx <= fvgIdx
    if (!timeOrderValid) return false;
    return true;
  });

  return validatedSetups.sort((a, b) => b.confluence_score - a.confluence_score).slice(0, 5);
}
