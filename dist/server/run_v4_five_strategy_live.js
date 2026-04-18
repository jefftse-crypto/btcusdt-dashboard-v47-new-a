// server/run_v4_five_strategy_live.ts
import fs from "fs/promises";
import path from "path";

// server/utils/indicators.ts
function assertValidPeriod(period, name = "period") {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${period}`);
  }
}
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function calcEmaArr(data, period) {
  assertValidPeriod(period, "calcEmaArr period");
  const k = 2 / (period + 1);
  const result = [];
  let emaVal = NaN;
  let validCount = 0;
  let seedSum = 0;
  for (let i = 0; i < data.length; i++) {
    if (!isFiniteNumber(data[i])) {
      result.push(NaN);
      continue;
    }
    if (isNaN(emaVal)) {
      seedSum += data[i];
      validCount++;
      if (validCount < period) {
        result.push(NaN);
        continue;
      }
      emaVal = seedSum / period;
    } else {
      emaVal = data[i] * k + emaVal * (1 - k);
    }
    result.push(emaVal);
  }
  return result;
}
function calcRsiArr(closes, period = 14) {
  const result = new Array(closes.length).fill(NaN);
  if (!closes.every((v) => isFiniteNumber(v) || isNaN(v))) {
    return result;
  }
  if (closes.length < period + 1) return result;
  let writeIdx = period;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  const calcRsi = (g, l) => {
    if (g === 0 && l === 0) return 50;
    if (l === 0) return 100;
    return 100 - 100 / (1 + g / l);
  };
  result[writeIdx] = calcRsi(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = calcRsi(avgGain, avgLoss);
  }
  return result;
}
function calcMacdArr(closes) {
  const ema12 = calcEmaArr(closes, 12);
  const ema26 = calcEmaArr(closes, 26);
  const macd = ema12.map((v, i) => isNaN(v) || isNaN(ema26[i]) ? NaN : v - ema26[i]);
  const firstValid = macd.findIndex((v) => !isNaN(v));
  const signal = new Array(macd.length).fill(NaN);
  if (firstValid >= 0) {
    const validSlice = macd.slice(firstValid);
    const signalSlice = calcEmaArr(validSlice, 9);
    signalSlice.forEach((v, i) => {
      signal[firstValid + i] = v;
    });
  }
  const hist = macd.map((v, i) => isNaN(v) || isNaN(signal[i]) ? NaN : v - signal[i]);
  return { macd, signal, hist };
}
function calcBollingerArr(closes, period = 20, mult = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) {
      return { upper: NaN, lower: NaN, mid: NaN, bandwidth: NaN, percent_b: NaN, is_ready: false };
    }
    const slice = closes.slice(i - period + 1, i + 1);
    if (slice.some((v) => isNaN(v))) {
      return { upper: NaN, lower: NaN, mid: NaN, bandwidth: NaN, percent_b: NaN, is_ready: false };
    }
    const mid = slice.reduce((a, b) => a + b, 0) / slice.length;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length);
    const upper = mid + mult * std;
    const lower = mid - mult * std;
    const bandwidth = std === 0 || mid === 0 ? 0 : (upper - lower) / Math.abs(mid);
    const percent_b = upper - lower === 0 ? 0.5 : (closes[i] - lower) / (upper - lower);
    return { upper, lower, mid, bandwidth, percent_b, is_ready: true };
  });
}
function calcAtrArr(candles, period = 14) {
  if (candles.length < period + 1) return new Array(candles.length).fill(NaN);
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  const result = new Array(period).fill(NaN);
  let atr = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  result.push(atr);
  for (let i = period + 1; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    result.push(atr);
  }
  return result;
}
function calcAtrLast(candles, period = 14) {
  const arr = calcAtrArr(candles, period);
  const last = arr[arr.length - 1];
  return isNaN(last) ? 0 : last;
}
function calcAdxArr(candles, period = 14) {
  const n = candles.length;
  const adx = new Array(n).fill(NaN);
  const plusDi = new Array(n).fill(NaN);
  const minusDi = new Array(n).fill(NaN);
  if (n < period * 2) return { adx, plusDi, minusDi };
  const trs = [0];
  const pDMs = [0];
  const mDMs = [0];
  for (let i = 1; i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const up = c.high - p.high, dn = p.low - c.low;
    pDMs.push(up > dn && up > 0 ? up : 0);
    mDMs.push(dn > up && dn > 0 ? dn : 0);
  }
  let sTR = trs.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let sPDM = pDMs.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let sMDM = mDMs.slice(1, period + 1).reduce((a, b) => a + b, 0);
  const dxArr = [];
  const pDIArr = [];
  const mDIArr = [];
  for (let i = period; i < n; i++) {
    if (i > period) {
      sTR = sTR - sTR / period + trs[i];
      sPDM = sPDM - sPDM / period + pDMs[i];
      sMDM = sMDM - sMDM / period + mDMs[i];
    }
    const pDI = sTR === 0 ? 0 : sPDM / sTR * 100;
    const mDI = sTR === 0 ? 0 : sMDM / sTR * 100;
    const dx = pDI + mDI === 0 ? 0 : Math.abs(pDI - mDI) / (pDI + mDI) * 100;
    pDIArr.push(pDI);
    mDIArr.push(mDI);
    dxArr.push(dx);
    plusDi[i] = pDI;
    minusDi[i] = mDI;
  }
  let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  adx[period * 2 - 1] = adxVal;
  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
    adx[period + i] = adxVal;
  }
  return { adx, plusDi, minusDi };
}
function findSwingHighs(candles, lb = 5) {
  const res = [];
  for (let i = lb; i < candles.length - lb; i++) {
    if (candles.slice(i - lb, i).every((c) => c.high <= candles[i].high) && candles.slice(i + 1, i + lb + 1).every((c) => c.high <= candles[i].high)) res.push({ price: candles[i].high, idx: i });
  }
  return res;
}
function findSwingLows(candles, lb = 5) {
  const res = [];
  for (let i = lb; i < candles.length - lb; i++) {
    if (candles.slice(i - lb, i).every((c) => c.low >= candles[i].low) && candles.slice(i + 1, i + lb + 1).every((c) => c.low >= candles[i].low)) res.push({ price: candles[i].low, idx: i });
  }
  return res;
}
function calcFibOte(candles, close) {
  const atr = calcAtrLast(candles, 14);
  const highs5 = findSwingHighs(candles, 5);
  const lows5 = findSwingLows(candles, 5);
  const highs10 = findSwingHighs(candles, 10);
  const lows10 = findSwingLows(candles, 10);
  if (!highs5.length || !lows5.length) return null;
  const lastHigh = highs5[highs5.length - 1];
  const lastLow = lows5[lows5.length - 1];
  const range = lastHigh.price - lastLow.price;
  if (range <= 0 || range < atr * 0.5) return null;
  const swingAge = candles.length - Math.max(lastHigh.idx, lastLow.idx);
  const agePenalty = Math.min(50, Math.floor(swingAge / 10) * 10);
  const htfHigh = highs10.length ? highs10[highs10.length - 1].price : lastHigh.price;
  const htfLow = lows10.length ? lows10[lows10.length - 1].price : lastLow.price;
  const htfRange = htfHigh - htfLow;
  const isBullish = lastLow.idx < lastHigh.idx;
  if (isBullish) {
    const fib618 = lastHigh.price - range * 0.618;
    const fib705 = lastHigh.price - range * 0.705;
    const fib786 = lastHigh.price - range * 0.786;
    const fib50 = lastHigh.price - range * 0.5;
    const oteWidth = fib618 - fib786;
    const inOte = close >= fib786 && close <= fib618;
    const inOteWide = close >= fib786 && close <= fib50;
    let clusterBonus = 0;
    const htfIsSameAsLtf = htfHigh === lastHigh.price && htfLow === lastLow.price;
    if (htfRange > 0 && !htfIsSameAsLtf) {
      const htfFib618 = htfHigh - htfRange * 0.618;
      const htfFib786 = htfHigh - htfRange * 0.786;
      if (htfFib786 <= fib618 && htfFib618 >= fib786) clusterBonus = 20;
    }
    const baseScore = inOte ? 70 : inOteWide ? 40 : 10;
    const oteQuality = Math.max(0, Math.min(
      100,
      baseScore + clusterBonus - agePenalty - (oteWidth > atr * 2 ? 15 : 0)
      // OTE 區間寬度超過 2 ATR 則降分
    ));
    return {
      direction: "bullish",
      swing_high: lastHigh.price,
      swing_low: lastLow.price,
      fib_50: fib50,
      fib_618: fib618,
      fib_705: fib705,
      fib_786: fib786,
      ext_1272: lastLow.price + range * 1.272,
      ext_1618: lastLow.price + range * 1.618,
      in_ote: inOte,
      in_ote_wide: inOteWide,
      price_pct: (close - lastLow.price) / range * 100,
      ote_quality: oteQuality,
      ote_zone_width: oteWidth,
      fib_cluster: clusterBonus > 0,
      swing_age: swingAge
    };
  } else {
    const fib618 = lastLow.price + range * 0.618;
    const fib705 = lastLow.price + range * 0.705;
    const fib786 = lastLow.price + range * 0.786;
    const fib50 = lastLow.price + range * 0.5;
    const oteWidth = fib786 - fib618;
    const inOte = close >= fib618 && close <= fib786;
    const inOteWide = close >= fib50 && close <= fib786;
    let clusterBonus = 0;
    const htfIsSameAsLtfBear = htfHigh === lastHigh.price && htfLow === lastLow.price;
    if (htfRange > 0 && !htfIsSameAsLtfBear) {
      const htfFib618 = htfLow + htfRange * 0.618;
      const htfFib786 = htfLow + htfRange * 0.786;
      if (htfFib618 <= fib786 && htfFib786 >= fib618) clusterBonus = 20;
    }
    const baseScore = inOte ? 70 : inOteWide ? 40 : 10;
    const oteQuality = Math.max(0, Math.min(
      100,
      baseScore + clusterBonus - agePenalty - (oteWidth > atr * 2 ? 15 : 0)
    ));
    return {
      direction: "bearish",
      swing_high: lastHigh.price,
      swing_low: lastLow.price,
      fib_50: fib50,
      fib_618: fib618,
      fib_705: fib705,
      fib_786: fib786,
      ext_1272: lastHigh.price - range * 1.272,
      ext_1618: lastHigh.price - range * 1.618,
      in_ote: inOte,
      in_ote_wide: inOteWide,
      price_pct: (close - lastLow.price) / range * 100,
      ote_quality: oteQuality,
      ote_zone_width: oteWidth,
      fib_cluster: clusterBonus > 0,
      swing_age: swingAge
    };
  }
}
function detectFvgZones(candles, close) {
  const atr = calcAtrLast(candles, 14);
  const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const bullFvgs = [];
  const bearFvgs = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const mid = candles[i];
    const next = candles[i + 1];
    const gapSize = next.low - prev.high;
    const gapSizeBear = prev.low - next.high;
    const age_bars = candles.length - 1 - (i + 1);
    const agePenalty = Math.min(40, Math.floor(age_bars / 15) * 10);
    if (gapSize > 0 && gapSize < atr * 4) {
      const top = next.low, bottom = prev.high;
      const midBody = Math.abs(mid.close - mid.open);
      const displacement = midBody > atr * 1.5;
      const gapRatio = gapSize / (atr + 1e-3);
      const volBonus = mid.volume > avgVol * 1.5 ? 20 : 0;
      const quality = Math.max(0, Math.min(100, Math.round(
        gapRatio * 40 + (displacement ? 30 : 0) + volBonus + 10 - agePenalty
      )));
      const laterCandles = candles.slice(i + 2);
      let filled_pct = 0;
      for (const lc of laterCandles) {
        if (lc.low <= top) {
          const penetration = Math.min(lc.low, top) - Math.max(lc.low, bottom);
          filled_pct = Math.max(filled_pct, Math.min(1, (top - Math.max(lc.low, bottom)) / (top - bottom + 1e-9)));
          if (lc.low <= bottom) {
            filled_pct = 1;
            break;
          }
        }
      }
      bullFvgs.push({ top, bottom, mid: (top + bottom) / 2, quality, displacement, filled_pct, age_bars });
    }
    if (gapSizeBear > 0 && gapSizeBear < atr * 4) {
      const top = prev.low, bottom = next.high;
      const midBody = Math.abs(mid.close - mid.open);
      const displacement = midBody > atr * 1.5;
      const gapRatio = gapSizeBear / (atr + 1e-3);
      const volBonus = mid.volume > avgVol * 1.5 ? 20 : 0;
      const quality = Math.max(0, Math.min(100, Math.round(
        gapRatio * 40 + (displacement ? 30 : 0) + volBonus + 10 - agePenalty
      )));
      let filled_pct = 0;
      const laterCandles = candles.slice(i + 2);
      for (const lc of laterCandles) {
        if (lc.high >= bottom) {
          filled_pct = Math.max(filled_pct, Math.min(1, (Math.min(lc.high, top) - bottom) / (top - bottom + 1e-9)));
          if (lc.high >= top) {
            filled_pct = 1;
            break;
          }
        }
      }
      bearFvgs.push({ top, bottom, mid: (top + bottom) / 2, quality, displacement, filled_pct, age_bars });
    }
  }
  const validBull = bullFvgs.filter((f) => f.filled_pct < 0.85 && f.quality >= 25);
  const validBear = bearFvgs.filter((f) => f.filled_pct < 0.85 && f.quality >= 25);
  const nearest = (arr) => arr.sort((a, b) => Math.abs(close - a.mid) - Math.abs(close - b.mid))[0] ?? null;
  return {
    nearestBull: nearest([...validBull]),
    nearestBear: nearest([...validBear]),
    allBull: validBull.sort((a, b) => b.quality - a.quality),
    allBear: validBear.sort((a, b) => b.quality - a.quality)
  };
}
function detectOrderBlocks(candles, close) {
  const atr = calcAtrLast(candles, 14);
  const bullObs = [];
  const bearObs = [];
  const swingHighs = findSwingHighs(candles, 5);
  const swingLows = findSwingLows(candles, 5);
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    const nextMove = candles.slice(i + 1, i + 5);
    const bullMove = nextMove.some((n) => n.close > c.high * 1.003);
    const bearMove = nextMove.some((n) => n.close < c.low * 0.997);
    if (c.close < c.open && bullMove) {
      const bodySize = c.open - c.close;
      const strength = bodySize / c.close > 8e-3 ? "strong" : "normal";
      const displacement = nextMove.some((n) => Math.abs(n.close - n.open) > atr * 1.2);
      const nearestSwingHigh = swingHighs.filter((h) => h.idx > i).sort((a, b) => a.idx - b.idx)[0];
      const bos_confirmed = nearestSwingHigh ? nextMove.some((n) => n.close > nearestSwingHigh.price) : false;
      const tested_count = candles.slice(i + 2).filter((n) => n.low <= c.open && n.high >= c.close).length;
      const quality = Math.min(100, Math.round(
        (strength === "strong" ? 30 : 15) + (displacement ? 25 : 0) + (bos_confirmed ? 20 : 0) + Math.max(0, 15 - tested_count * 5) + // 測試越多品質越低
        10
      ));
      bullObs.push({ top: c.open, bottom: c.close, mid: (c.open + c.close) / 2, strength, quality, bos_confirmed, tested_count, displacement });
    }
    if (c.close > c.open && bearMove) {
      const bodySize = c.close - c.open;
      const strength = bodySize / c.open > 8e-3 ? "strong" : "normal";
      const displacement = nextMove.some((n) => Math.abs(n.close - n.open) > atr * 1.2);
      const nearestSwingLow = swingLows.filter((l) => l.idx > i).sort((a, b) => a.idx - b.idx)[0];
      const bos_confirmed = nearestSwingLow ? nextMove.some((n) => n.close < nearestSwingLow.price) : false;
      const tested_count = candles.slice(i + 2).filter((n) => n.high >= c.open && n.low <= c.close).length;
      const quality = Math.min(100, Math.round(
        (strength === "strong" ? 30 : 15) + (displacement ? 25 : 0) + (bos_confirmed ? 20 : 0) + Math.max(0, 15 - tested_count * 5) + 10
      ));
      bearObs.push({ top: c.close, bottom: c.open, mid: (c.close + c.open) / 2, strength, quality, bos_confirmed, tested_count, displacement });
    }
  }
  const validBull = bullObs.filter((o) => o.quality >= 40 && o.tested_count <= 3);
  const validBear = bearObs.filter((o) => o.quality >= 40 && o.tested_count <= 3);
  const nearest = (arr) => arr.sort((a, b) => Math.abs(close - a.mid) - Math.abs(close - b.mid))[0] ?? null;
  return {
    nearestBull: nearest([...validBull]),
    nearestBear: nearest([...validBear]),
    allBull: validBull.sort((a, b) => b.quality - a.quality),
    allBear: validBear.sort((a, b) => b.quality - a.quality)
  };
}
function detectBosChoch(candles) {
  const highs = findSwingHighs(candles, 5);
  const lows = findSwingLows(candles, 5);
  const events = [];
  const allSwings = [
    ...highs.map((h) => ({ ...h, swingType: "high" })),
    ...lows.map((l) => ({ ...l, swingType: "low" }))
  ].sort((a, b) => a.idx - b.idx);
  const initLookback = Math.min(20, candles.length - 1);
  const initTrendBullish = candles[initLookback]?.close < candles[candles.length - 1]?.close;
  let structureBullish = initTrendBullish;
  let lastProtectedHigh = highs.length > 0 ? Math.min(...highs.slice(0, 3).map((h) => h.price)) : 0;
  let lastProtectedLow = lows.length > 0 ? Math.max(...lows.slice(0, 3).map((l) => l.price)) : 0;
  for (let i = 1; i < allSwings.length; i++) {
    const cur = allSwings[i];
    const prev = allSwings[i - 1];
    if (cur.swingType === "high") {
      if (structureBullish) {
        if (cur.price > lastProtectedHigh) {
          const confirmBar = candles.slice(cur.idx + 1, cur.idx + 4).find((c) => c.close > lastProtectedHigh);
          const confirmed = !!confirmBar;
          events.push({ type: "BOS", direction: "bullish", price: cur.price, idx: cur.idx, confirmed });
          lastProtectedHigh = cur.price;
        }
      } else {
        if (cur.price > lastProtectedHigh) {
          const confirmBar = candles.slice(cur.idx + 1, cur.idx + 4).find((c) => c.close > lastProtectedHigh);
          const confirmed = !!confirmBar;
          events.push({ type: "CHoCH", direction: "bullish", price: cur.price, idx: cur.idx, confirmed });
          if (confirmed) structureBullish = true;
          lastProtectedHigh = cur.price;
        }
      }
    } else {
      if (!structureBullish) {
        if (cur.price < lastProtectedLow) {
          const confirmBar = candles.slice(cur.idx + 1, cur.idx + 4).find((c) => c.close < lastProtectedLow);
          const confirmed = !!confirmBar;
          events.push({ type: "BOS", direction: "bearish", price: cur.price, idx: cur.idx, confirmed });
          lastProtectedLow = cur.price;
        }
      } else {
        if (cur.price < lastProtectedLow) {
          const confirmBar = candles.slice(cur.idx + 1, cur.idx + 4).find((c) => c.close < lastProtectedLow);
          const confirmed = !!confirmBar;
          events.push({ type: "CHoCH", direction: "bearish", price: cur.price, idx: cur.idx, confirmed });
          if (confirmed) structureBullish = false;
          lastProtectedLow = cur.price;
        }
      }
      if (cur.price < lastProtectedLow || lastProtectedLow === 0) lastProtectedLow = cur.price;
    }
    if (cur.swingType === "high" && (cur.price > lastProtectedHigh || lastProtectedHigh === 0)) {
      lastProtectedHigh = cur.price;
    }
  }
  events.sort((a, b) => a.idx - b.idx);
  const lastEvent = events[events.length - 1];
  const lastStructure = lastEvent?.direction ?? "neutral";
  return { events, lastStructure };
}
function detectLiquiditySweep(candles, close) {
  const atr = calcAtrLast(candles, 14);
  const highs = findSwingHighs(candles.slice(-60), 4);
  const lows = findSwingLows(candles.slice(-60), 4);
  const recent = candles.slice(-6);
  let bslSwept = false, sslSwept = false;
  let bslPrice = 0, sslPrice = 0;
  let bslSweepDepth = 0, sslSweepDepth = 0;
  let bslStrength = 0, sslStrength = 0;
  let bslSweepLow = 0, sslSweepHigh = 0;
  let bslReclaimed = false, sslReclaimed = false;
  const rawEqualHighPairs = [];
  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[i].price - highs[j].price) / (highs[i].price + 1e-9) < 1e-3)
        rawEqualHighPairs.push((highs[i].price + highs[j].price) / 2);
    }
  }
  const equalHighPairs = rawEqualHighPairs.filter(
    (v, i, a) => a.findIndex((x) => Math.abs(x - v) / (v + 1e-9) < 1e-3) === i
  );
  const rawEqualLowPairs = [];
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[i].price - lows[j].price) / (lows[i].price + 1e-9) < 1e-3)
        rawEqualLowPairs.push((lows[i].price + lows[j].price) / 2);
    }
  }
  const equalLowPairs = rawEqualLowPairs.filter(
    (v, i, a) => a.findIndex((x) => Math.abs(x - v) / (v + 1e-9) < 1e-3) === i
  );
  const allHighLevels = [...highs.slice(-5).map((h) => h.price), ...equalHighPairs];
  for (const level of allHighLevels) {
    const sweepCandidates = recent.filter((c) => c.high > level);
    for (const sweepCandle of sweepCandidates) {
      if (close < level) {
        const depth = (sweepCandle.high - level) / (atr + 1e-9);
        const reclaimed = sweepCandle.close < level;
        const closeBearish = sweepCandle.close < sweepCandle.open;
        if (depth < 1.5 && reclaimed) {
          const isEqualHigh = equalHighPairs.some((p) => Math.abs(p - level) / (level + 1e-9) < 1e-3);
          const strength = Math.min(100, Math.round(
            (1.5 - depth) / 1.5 * 40 + (closeBearish ? 30 : 10) + (isEqualHigh ? 30 : 15)
          ));
          if (strength > bslStrength) {
            bslSwept = true;
            bslPrice = level;
            bslSweepDepth = depth;
            bslStrength = strength;
            bslSweepLow = sweepCandle.low;
            bslReclaimed = reclaimed;
          }
        }
      }
    }
  }
  const allLowLevels = [...lows.slice(-5).map((l) => l.price), ...equalLowPairs];
  for (const level of allLowLevels) {
    const sweepCandidates = recent.filter((c) => c.low < level);
    for (const sweepCandle of sweepCandidates) {
      if (close > level) {
        const depth = (level - sweepCandle.low) / (atr + 1e-9);
        const reclaimed = sweepCandle.close > level;
        const closeBullish = sweepCandle.close > sweepCandle.open;
        if (depth < 1.5 && reclaimed) {
          const isEqualLow = equalLowPairs.some((p) => Math.abs(p - level) / (level + 1e-9) < 1e-3);
          const strength = Math.min(100, Math.round(
            (1.5 - depth) / 1.5 * 40 + (closeBullish ? 30 : 10) + (isEqualLow ? 30 : 15)
          ));
          if (strength > sslStrength) {
            sslSwept = true;
            sslPrice = level;
            sslSweepDepth = depth;
            sslStrength = strength;
            sslSweepHigh = sweepCandle.high;
            sslReclaimed = reclaimed;
          }
        }
      }
    }
  }
  return {
    bslSwept,
    sslSwept,
    bslPrice,
    sslPrice,
    bslSweepDepth,
    sslSweepDepth,
    bslStrength,
    sslStrength,
    bslSweepLow,
    // BSL 清掃時的最低點（用於多頭 SL）
    sslSweepHigh,
    // SSL 清掃時的最高點（用於空頭 SL）
    bslReclaimed,
    sslReclaimed,
    hasEqualHighs: equalHighPairs.length > 0,
    hasEqualLows: equalLowPairs.length > 0
  };
}

// server/utils/advancedAnalysis.ts
function detectPaPatternsWithLevels(candles, srLevels, timeframe, atr) {
  const results = [];
  const lookback = Math.min(candles.length - 1, 20);
  const closes = candles.map((c) => c.close);
  const ema5Arr = calcEmaArr(closes, 5);
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
    const detected = [];
    if (lowerWick > body * 2 && lowerWick > upperWick * 2 && range > atr * 0.3) {
      detected.push({
        name: "Bullish Pin Bar",
        type: "bullish",
        strength: lowerWick > body * 3 ? "strong" : "medium",
        desc: `\u9577\u4E0B\u5F71\u7DDA Pin Bar\uFF0C\u62D2\u7D55\u4F4E\u50F9\uFF0C\u4E0B\u5F71\u7DDA\u662F\u5BE6\u9AD4\u7684 ${(lowerWick / Math.max(body, 1e-4)).toFixed(1)} \u500D`
      });
    }
    if (upperWick > body * 2 && upperWick > lowerWick * 2 && range > atr * 0.3) {
      detected.push({
        name: "Bearish Pin Bar",
        type: "bearish",
        strength: upperWick > body * 3 ? "strong" : "medium",
        desc: `\u9577\u4E0A\u5F71\u7DDA Pin Bar\uFF0C\u62D2\u7D55\u9AD8\u50F9\uFF0C\u4E0A\u5F71\u7DDA\u662F\u5BE6\u9AD4\u7684 ${(upperWick / Math.max(body, 1e-4)).toFixed(1)} \u500D`
      });
    }
    if (isBullish && prev.close < prev.open && c.open <= prev.close && c.close >= prev.open && body > Math.abs(prev.close - prev.open) * 1.1) {
      detected.push({
        name: "Bullish Engulfing",
        type: "bullish",
        strength: body > Math.abs(prev.close - prev.open) * 1.5 ? "strong" : "medium",
        desc: `\u591A\u982D\u541E\u6C92\u5F62\u614B\uFF0C\u5B8C\u5168\u541E\u6C92\u524D\u4E00\u6839\u9670\u7DDA\uFF0C\u5F37\u52E2\u53CD\u8F49\u4FE1\u865F`
      });
    }
    if (!isBullish && prev.close > prev.open && c.open >= prev.close && c.close <= prev.open && body > Math.abs(prev.close - prev.open) * 1.1) {
      detected.push({
        name: "Bearish Engulfing",
        type: "bearish",
        strength: body > Math.abs(prev.close - prev.open) * 1.5 ? "strong" : "medium",
        desc: `\u7A7A\u982D\u541E\u6C92\u5F62\u614B\uFF0C\u5B8C\u5168\u541E\u6C92\u524D\u4E00\u6839\u967D\u7DDA\uFF0C\u5F37\u52E2\u53CD\u8F49\u4FE1\u865F`
      });
    }
    if (c.high < prev.high && c.low > prev.low && range < (prev.high - prev.low) * 0.7) {
      detected.push({
        name: isBullish ? "Inside Bar (Bullish)" : "Inside Bar (Bearish)",
        type: isBullish ? "bullish" : "bearish",
        strength: "medium",
        desc: `\u5167\u5305\u7DDA\uFF0C\u5E02\u5834\u6574\u7406\u84C4\u529B\uFF0C\u7A81\u7834\u65B9\u5411\u70BA ${isBullish ? "\u591A" : "\u7A7A"}`
      });
    }
    const priorDowntrend = i >= 5 && candles[i - 1].close < candles[i - 5].close;
    if (isBullish && lowerWick > range * 0.5 && body < range * 0.3 && priorDowntrend) {
      detected.push({
        name: "Hammer",
        type: "bullish",
        strength: lowerWick > range * 0.65 ? "strong" : "medium",
        desc: `\u9524\u5F62\u7DDA\uFF0C\u5728\u4E0B\u964D\u8DA8\u52E2\u5F8C\u51FA\u73FE\uFF0C\u5F37\u70C8\u62D2\u7D55\u4F4E\u50F9\uFF08\u4E0B\u5F71\u7DDA\u5360 ${(lowerWick / range * 100).toFixed(0)}%\uFF09`
      });
    }
    const priorUptrend = i >= 5 && candles[i - 1].close > candles[i - 5].close;
    if (!isBullish && upperWick > range * 0.5 && body < range * 0.3 && priorUptrend) {
      detected.push({
        name: "Shooting Star",
        type: "bearish",
        strength: upperWick > range * 0.65 ? "strong" : "medium",
        desc: `\u6D41\u661F\u7DDA\uFF0C\u5728\u4E0A\u6F32\u8DA8\u52E2\u5F8C\u51FA\u73FE\uFF0C\u5F37\u70C8\u62D2\u7D55\u9AD8\u50F9\uFF08\u4E0A\u5F71\u7DDA\u5360 ${(upperWick / range * 100).toFixed(0)}%\uFF09`
      });
    }
    if (i >= 2) {
      const body0 = Math.abs(prev2.close - prev2.open);
      const body2 = Math.abs(c.close - c.open);
      if (prev2.close < prev2.open && Math.abs(prev.close - prev.open) < body0 * 0.3 && c.close > c.open && body2 > body0 * 0.5) {
        detected.push({
          name: "Morning Star",
          type: "bullish",
          strength: "strong",
          desc: `\u65E9\u6668\u4E4B\u661F\u4E09K\u7DDA\u53CD\u8F49\u5F62\u614B\uFF0C\u5F37\u70C8\u5E95\u90E8\u53CD\u8F49\u4FE1\u865F`
        });
      }
      if (prev2.close > prev2.open && Math.abs(prev.close - prev.open) < body0 * 0.3 && c.close < c.open && body2 > body0 * 0.5) {
        detected.push({
          name: "Evening Star",
          type: "bearish",
          strength: "strong",
          desc: `\u9EC3\u660F\u4E4B\u661F\u4E09K\u7DDA\u53CD\u8F49\u5F62\u614B\uFF0C\u5F37\u70C8\u9802\u90E8\u53CD\u8F49\u4FE1\u865F`
        });
      }
    }
    const ema5Val = isFiniteNumber(ema5Arr[i]) ? ema5Arr[i] : c.close;
    const ema20Val = isFiniteNumber(ema20Arr[i]) ? ema20Arr[i] : c.close;
    const shortTermTrend = ema5Val > ema20Val * 1.001 ? "bullish" : ema5Val < ema20Val * 0.999 ? "bearish" : "ranging";
    const volSlice = candles.slice(Math.max(0, i - 20), i);
    const avgVol = volSlice.length > 0 ? volSlice.reduce((s, cc) => s + cc.volume, 0) / volSlice.length : 1;
    const volConfirm = c.volume > avgVol * 1.3;
    const volScore = volConfirm ? 10 : 0;
    for (const pattern of detected) {
      const price = c.close;
      let nearestLevel = null;
      let minDist = Infinity;
      for (const lvl of srLevels) {
        const dist = Math.abs(lvl.price - price) / price;
        if (dist < minDist) {
          minDist = dist;
          nearestLevel = lvl;
        }
      }
      const distPct = minDist * 100;
      const atKeyLevel = atr > 0 ? minDist < atr * 0.5 : distPct < 0.5;
      let srAligned = false;
      if (nearestLevel) {
        if (pattern.type === "bullish" && nearestLevel.type === "support") srAligned = true;
        if (pattern.type === "bearish" && nearestLevel.type === "resistance") srAligned = true;
      }
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
      score += trendContextScore;
      score += volScore;
      if (score < 30) continue;
      const slMultiplier = shortTermTrend === pattern.type ? 1.2 : 1.8;
      const slDist = atr * slMultiplier;
      const sl = pattern.type === "bullish" ? price - slDist : price + slDist;
      const tp = pattern.type === "bullish" ? price + slDist * 2 : price - slDist * 2;
      results.push({
        pattern,
        at_key_level: atKeyLevel,
        nearest_level: nearestLevel,
        distance_to_level_pct: distPct,
        liquidity_nearby: distPct < 1,
        confluence_score: Math.min(100, Math.max(0, score)),
        entry: price,
        sl,
        tp,
        timeframe,
        time: c.time
      });
    }
  }
  return results.sort((a, b) => b.confluence_score - a.confluence_score).slice(0, 5);
}
function mergeContainingCandles(candles) {
  if (candles.length === 0) return [];
  const merged = [{ ...candles[0] }];
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
          time: cur.time
        };
      } else {
        merged[merged.length - 1] = {
          ...last,
          high: Math.min(last.high, cur.high),
          low: Math.min(last.low, cur.low),
          close: cur.close,
          volume: last.volume + cur.volume,
          time: cur.time
        };
      }
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}
function findFractals(merged) {
  const fractals = [];
  for (let i = 1; i < merged.length - 1; i++) {
    const prev = merged[i - 1], cur = merged[i], next = merged[i + 1];
    if (cur.high > prev.high && cur.high > next.high)
      fractals.push({ idx: i, type: "top", price: cur.high, time: cur.time });
    else if (cur.low < prev.low && cur.low < next.low)
      fractals.push({ idx: i, type: "bottom", price: cur.low, time: cur.time });
  }
  const cleaned = [];
  for (const f of fractals) {
    const last = cleaned[cleaned.length - 1];
    if (last && last.type === f.type) {
      if (f.type === "top" && f.price > last.price) cleaned[cleaned.length - 1] = f;
      else if (f.type === "bottom" && f.price < last.price) cleaned[cleaned.length - 1] = f;
    } else cleaned.push(f);
  }
  return cleaned;
}
function formBis(fractals, merged) {
  const bis = [];
  for (let i = 0; i < fractals.length - 1; i++) {
    const a = fractals[i], b = fractals[i + 1];
    if (b.type === a.type) continue;
    if (b.idx - a.idx < 4) continue;
    if (a.type === "bottom" && b.type === "top" && b.price <= a.price) continue;
    if (a.type === "top" && b.type === "bottom" && b.price >= a.price) continue;
    const sliceCandles = merged.slice(a.idx, b.idx + 1);
    const sliceCloses = sliceCandles.map((c) => c.close);
    const biDir = a.type === "bottom" ? "up" : "down";
    let macdArea = 0;
    if (sliceCloses.length >= 35) {
      const macdResult = calcMacdArr(sliceCloses);
      macdArea = macdResult.hist.reduce((sum, v) => {
        if (isNaN(v)) return sum;
        if (biDir === "up" && v > 0) return sum + v;
        if (biDir === "down" && v < 0) return sum + Math.abs(v);
        return sum;
      }, 0);
    } else if (sliceCloses.length >= 3) {
      macdArea = sliceCandles.reduce((sum, c) => {
        const momentum = (c.high - c.low) * (c.volume || 1);
        return sum + momentum;
      }, 0);
      const avgPrice = sliceCloses.reduce((a2, b2) => a2 + b2, 0) / sliceCloses.length;
      macdArea = macdArea / (avgPrice || 1);
    }
    bis.push({
      direction: a.type === "bottom" ? "up" : "down",
      start: a.price,
      end: b.price,
      start_time: a.time,
      end_time: b.time,
      start_idx: a.idx,
      end_idx: b.idx,
      macd_area: macdArea
    });
  }
  return bis;
}
function formDuans(bis) {
  const duans = [];
  if (bis.length < 3) return duans;
  let duanStart = 0;
  for (let i = 2; i < bis.length; i += 2) {
    const b0 = bis[duanStart], b2 = bis[i];
    if (b0.direction !== b2.direction) {
      duanStart = i;
      continue;
    }
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
function formZhongshus(bis) {
  const zhongshus = [];
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
function detectBeichi(bis) {
  if (bis.length < 4) return { type: null, description: "\u7B46\u6578\u4E0D\u8DB3\uFF0C\u7121\u6CD5\u5224\u65B7\u80CC\u99B3", strength: "weak" };
  const lastBi = bis[bis.length - 1];
  const sameDirBis = bis.filter((b) => b.direction === lastBi.direction);
  if (sameDirBis.length < 2) return { type: null, description: "\u540C\u5411\u7B46\u4E0D\u8DB3", strength: "weak" };
  const prev = sameDirBis[sameDirBis.length - 2];
  const curr = sameDirBis[sameDirBis.length - 1];
  const prevArea = Math.abs(prev.macd_area);
  const currArea = Math.abs(curr.macd_area);
  if (prevArea === 0) return { type: null, description: "MACD \u9762\u7A4D\u8A08\u7B97\u4E0D\u8DB3", strength: "weak" };
  const ratio = currArea / prevArea;
  const prevAmp = Math.abs(prev.end - prev.start);
  const currAmp = Math.abs(curr.end - curr.start);
  const ampRatio = prevAmp > 0 ? currAmp / prevAmp : 1;
  if (lastBi.direction === "up" && curr.end > prev.end) {
    if (ratio < 0.6 || ratio < 0.8 && ampRatio < 0.7) {
      const strength = ratio < 0.3 ? "strong" : ratio < 0.45 ? "medium" : "weak";
      return { type: "top", description: `\u7E8F\u8AD6\u9802\u80CC\u99B3\uFF1A\u50F9\u683C\u5275\u65B0\u9AD8\uFF0C\u4F46 MACD \u9762\u7A4D\u7E2E\u5C0F\u81F3 ${(ratio * 100).toFixed(0)}% (\u5E45\u5EA6 ${(ampRatio * 100).toFixed(0)}%)\uFF0C\u52D5\u80FD\u8870\u7AED`, strength };
    }
  }
  if (lastBi.direction === "down" && curr.end < prev.end) {
    if (ratio < 0.6 || ratio < 0.8 && ampRatio < 0.7) {
      const strength = ratio < 0.3 ? "strong" : ratio < 0.45 ? "medium" : "weak";
      return { type: "bottom", description: `\u7E8F\u8AD6\u5E95\u80CC\u99B3\uFF1A\u50F9\u683C\u5275\u65B0\u4F4E\uFF0C\u4F46 MACD \u9762\u7A4D\u7E2E\u5C0F\u81F3 ${(ratio * 100).toFixed(0)}% (\u5E45\u5EA6 ${(ampRatio * 100).toFixed(0)}%)\uFF0C\u52D5\u80FD\u8870\u7AED`, strength };
    }
  }
  return { type: null, description: "\u7121\u660E\u986F\u80CC\u99B3\u4FE1\u865F", strength: "weak" };
}
function identifyBuySellPoints(bis, zhongshus, beichi) {
  const points = [];
  if (bis.length === 0) return points;
  const lastBi = bis[bis.length - 1];
  const lastZhongshu = zhongshus[zhongshus.length - 1];
  if (beichi.type === "bottom") {
    points.push({
      level: 1,
      direction: "buy",
      price: lastBi.end,
      time: lastBi.end_time,
      bi_idx: bis.length - 1,
      description: `\u4E00\u985E\u8CB7\u9EDE\uFF1A${beichi.description}\uFF0C\u6B64\u70BA\u6700\u4F4E\u98A8\u96AA\u8CB7\u5165\u4F4D\u7F6E`,
      strength: beichi.strength,
      divergence_confirmed: true,
      after_zhongshu_break: false,
      trend_continuation: false
    });
  }
  if (beichi.type === "top") {
    points.push({
      level: 1,
      direction: "sell",
      price: lastBi.end,
      time: lastBi.end_time,
      bi_idx: bis.length - 1,
      description: `\u4E00\u985E\u8CE3\u9EDE\uFF1A${beichi.description}\uFF0C\u6B64\u70BA\u6700\u4F4E\u98A8\u96AA\u8CE3\u51FA\u4F4D\u7F6E`,
      strength: beichi.strength,
      divergence_confirmed: true,
      after_zhongshu_break: false,
      trend_continuation: false
    });
  }
  if (lastZhongshu && bis.length >= 5) {
    const recentBis = bis.slice(-5);
    const brokeAbove = recentBis.some((b) => b.direction === "up" && b.end > lastZhongshu.top);
    const brokeBelow = recentBis.some((b) => b.direction === "down" && b.end < lastZhongshu.bottom);
    if (brokeAbove) {
      if (lastBi.direction === "down" && lastBi.end > lastZhongshu.top) {
        points.push({
          level: 2,
          direction: "buy",
          price: lastBi.end,
          time: lastBi.end_time,
          bi_idx: bis.length - 1,
          description: `\u4E8C\u985E\u8CB7\u9EDE\uFF1A\u4E2D\u6A1E\u4E0A\u65B9\u7A81\u7834\u5F8C\u56DE\u8E29\uFF0C\u672A\u8DCC\u56DE\u4E2D\u6A1E\uFF08${lastZhongshu.top.toFixed(2)}\uFF09\uFF0C\u78BA\u8A8D\u4E0A\u6F32\u8DA8\u52E2`,
          strength: "medium",
          divergence_confirmed: false,
          after_zhongshu_break: true,
          trend_continuation: false
        });
      }
      if (lastBi.direction === "down" && Math.abs(lastBi.end - lastZhongshu.top) / lastZhongshu.top < 0.015) {
        points.push({
          level: 3,
          direction: "buy",
          price: lastZhongshu.top,
          time: lastBi.end_time,
          bi_idx: bis.length - 1,
          description: `\u4E09\u985E\u8CB7\u9EDE\uFF1A\u56DE\u8E29\u4E2D\u6A1E\u9802\u90E8 ${lastZhongshu.top.toFixed(2)} \u78BA\u8A8D\u652F\u6490\uFF0C\u8DA8\u52E2\u5EF6\u7E8C\u8CB7\u9EDE`,
          strength: "medium",
          divergence_confirmed: false,
          after_zhongshu_break: true,
          trend_continuation: true
        });
      }
    }
    if (brokeBelow) {
      if (lastBi.direction === "up" && lastBi.end < lastZhongshu.bottom) {
        points.push({
          level: 2,
          direction: "sell",
          price: lastBi.end,
          time: lastBi.end_time,
          bi_idx: bis.length - 1,
          description: `\u4E8C\u985E\u8CE3\u9EDE\uFF1A\u4E2D\u6A1E\u4E0B\u65B9\u7A81\u7834\u5F8C\u53CD\u5F48\uFF0C\u672A\u56DE\u5230\u4E2D\u6A1E\uFF08${lastZhongshu.bottom.toFixed(2)}\uFF09\uFF0C\u78BA\u8A8D\u4E0B\u8DCC\u8DA8\u52E2`,
          strength: "medium",
          divergence_confirmed: false,
          after_zhongshu_break: true,
          trend_continuation: false
        });
      }
      if (lastBi.direction === "up" && Math.abs(lastBi.end - lastZhongshu.bottom) / lastZhongshu.bottom < 0.015) {
        points.push({
          level: 3,
          direction: "sell",
          price: lastZhongshu.bottom,
          time: lastBi.end_time,
          bi_idx: bis.length - 1,
          description: `\u4E09\u985E\u8CE3\u9EDE\uFF1A\u53CD\u5F48\u81F3\u4E2D\u6A1E\u5E95\u90E8 ${lastZhongshu.bottom.toFixed(2)} \u78BA\u8A8D\u963B\u529B\uFF0C\u8DA8\u52E2\u5EF6\u7E8C\u8CE3\u9EDE`,
          strength: "medium",
          divergence_confirmed: false,
          after_zhongshu_break: true,
          trend_continuation: true
        });
      }
    }
  }
  return points;
}
function calcChanEnhanced(candles, currentPrice, lookback = 400) {
  if (candles.length < 20) {
    return {
      bis: [],
      duans: [],
      zhongshus: [],
      trend: "ranging",
      in_zhongshu: false,
      current_zhongshu: null,
      bi_count: 0,
      duan_count: 0,
      buy_sell_points: [],
      divergence_signals: { type: null, description: "K\u7DDA\u6578\u91CF\u4E0D\u8DB3", strength: "weak" },
      macd_area_ratio: 0
    };
  }
  const merged = mergeContainingCandles(candles.slice(-lookback));
  const fractals = findFractals(merged);
  const bis = formBis(fractals, merged);
  const duans = formDuans(bis);
  const zhongshus = formZhongshus(bis);
  const beichi = detectBeichi(bis);
  const buySellPoints = identifyBuySellPoints(bis, zhongshus, beichi);
  let trend = "ranging";
  if (bis.length >= 2) {
    const lastBi = bis[bis.length - 1];
    const prevSameDirBi = bis.slice(0, -1).filter((b) => b.direction === lastBi.direction).pop();
    if (prevSameDirBi) {
      if (lastBi.direction === "up" && lastBi.end > prevSameDirBi.end) trend = "bullish";
      else if (lastBi.direction === "down" && lastBi.end < prevSameDirBi.end) trend = "bearish";
    }
  }
  const lastZhongshu = zhongshus[zhongshus.length - 1] ?? null;
  const inZhongshu = lastZhongshu ? currentPrice >= lastZhongshu.bottom && currentPrice <= lastZhongshu.top : false;
  let macdAreaRatio = 0;
  if (bis.length >= 2) {
    const lastBi = bis[bis.length - 1];
    const sameDirBis = bis.filter((b) => b.direction === lastBi.direction);
    if (sameDirBis.length >= 2) {
      const prev = sameDirBis[sameDirBis.length - 2];
      const curr = sameDirBis[sameDirBis.length - 1];
      if (prev.macd_area > 0) macdAreaRatio = curr.macd_area / prev.macd_area;
    }
  }
  let zhongshuZG = 0, zhongshuZD = 0, zhongshuGG = 0, zhongshuDD = 0;
  if (lastZhongshu) {
    zhongshuZG = lastZhongshu.top;
    zhongshuZD = lastZhongshu.bottom;
    zhongshuGG = lastZhongshu.top;
    zhongshuDD = lastZhongshu.bottom;
  }
  return {
    bis: bis.map((b) => ({ direction: b.direction, start: b.start, end: b.end, start_time: b.start_time, end_time: b.end_time })),
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
    macd_area_ratio: macdAreaRatio
  };
}
function detectSmcConfirmationSetups(candles, currentPrice, htfTrend, maxBarsBetweenActs = 8) {
  const setups = [];
  const slice = candles.slice(-100);
  if (slice.length < 20) return setups;
  const swingHighs = findSwingHighs(slice, 5);
  const swingLows = findSwingLows(slice, 5);
  const atr = calcAtrLast(slice, 14);
  for (let i = 10; i < slice.length - 4; i++) {
    const c = slice[i];
    const recentLow = swingLows.filter((l) => l.idx < i - 2 && l.idx > i - 20);
    for (const swLow of recentLow.slice(-2)) {
      if (c.low < swLow.price && c.close > swLow.price) {
        const fvgSearchEnd = Math.min(i + maxBarsBetweenActs + 1, slice.length - 1);
        const fvgFound = slice.slice(i + 1, fvgSearchEnd).some((_, idx) => {
          const j = i + 1 + idx;
          const fvgC1 = slice[j - 1], fvgC2 = slice[j], fvgC3 = slice[j + 1];
          return fvgC3 && fvgC3.low > fvgC1.high && fvgC2.close > fvgC2.open;
        });
        if (!fvgFound && i < slice.length - maxBarsBetweenActs - 2) {
          setups.push({
            id: `bull_invalidated_${i}`,
            direction: "bullish",
            sweep: { type: "SSL", swept_level: swLow.price, sweep_time: c.time, sweep_candle_idx: i },
            fvg: { type: "bullish", top: 0, bottom: 0, mid: 0, time: 0, filled: false, size: 0, idx: -1 },
            ob: { type: "bullish", top: 0, bottom: 0, mid: 0, time: 0, tested: false, strength: "normal", idx: -1 },
            confluence_score: 0,
            htf_aligned: htfTrend === "bullish",
            entry_zone: { top: 0, bottom: 0 },
            sl: 0,
            tp1: 0,
            tp2: 0,
            rr_ratio: 0,
            status: "invalidated",
            formed_at: c.time
          });
          continue;
        }
        for (let j = i + 1; j < fvgSearchEnd; j++) {
          const fvgC1 = slice[j - 1];
          const fvgC2 = slice[j];
          const fvgC3 = slice[j + 1];
          if (!fvgC3) continue;
          if (fvgC3.low > fvgC1.high && fvgC2.close > fvgC2.open) {
            const fvgTop = fvgC3.low, fvgBottom = fvgC1.high;
            const fvgSize = (fvgTop - fvgBottom) / currentPrice;
            if (fvgSize < 3e-4) continue;
            let obCandle = fvgC1;
            for (let k = j - 1; k >= Math.max(0, j - 5); k--) {
              if (slice[k].close < slice[k].open) {
                obCandle = slice[k];
                break;
              }
            }
            const obTop = Math.max(obCandle.open, obCandle.close);
            const obBottom = Math.min(obCandle.open, obCandle.close);
            const obFvgOverlap = obTop >= fvgBottom && obBottom <= fvgTop;
            let score = 0;
            const sweepDepth = swLow.price - c.low;
            const sweepRatio = sweepDepth / atr;
            const displacementBody = Math.abs(fvgC2.close - fvgC2.open);
            if (sweepRatio >= 0.05 && c.close > swLow.price) {
              if (obFvgOverlap) score += 30;
              else if (Math.abs(obTop - fvgBottom) / (currentPrice + 1e-9) < 1e-3) score += 15;
              if (sweepRatio > 0.5) score += 25;
              else if (sweepRatio > 0.3) score += 20;
              else if (sweepRatio > 0.1) score += 12;
              else score += 5;
              if (displacementBody > atr * 1.5) score += 20;
              else if (displacementBody > atr * 0.8) score += 15;
              else if (displacementBody > atr * 0.4) score += 8;
              if (htfTrend === "bullish") score += 15;
              else if (htfTrend === "ranging") score -= 5;
              if (fvgSize > 2e-3 && fvgSize < 0.01) score += 10;
              else if (fvgSize >= 1e-3) score += 5;
              if (c.close > c.open && c.close > swLow.price) score += 10;
            }
            const entryTop = obFvgOverlap ? Math.min(obTop, fvgTop) : obTop;
            const entryBottom = obFvgOverlap ? Math.max(obBottom, fvgBottom) : obBottom;
            const entryMid = (entryTop + entryBottom) / 2;
            const dynamicSlBuffer = atr * 0.15;
            const sl = c.low - dynamicSlBuffer;
            const riskDist = entryMid - sl;
            const tp1 = entryMid + riskDist * (riskDist > atr * 2 ? 2 : 1.5);
            const tp2 = entryMid + riskDist * (riskDist > atr * 2 ? 4 : 3);
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
              sl,
              tp1,
              tp2,
              rr_ratio: Math.round(rrRatio * 10) / 10,
              status: priceNearEntry ? "active" : currentPrice > fvgTop ? "completed" : "waiting",
              formed_at: fvgC2.time
            });
            break;
          }
        }
      }
    }
  }
  for (let i = 10; i < slice.length - 4; i++) {
    const c = slice[i];
    const recentHigh = swingHighs.filter((h) => h.idx < i - 2 && h.idx > i - 20);
    for (const swHigh of recentHigh.slice(-2)) {
      if (c.high > swHigh.price && c.close < swHigh.price) {
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
            sl: 0,
            tp1: 0,
            tp2: 0,
            rr_ratio: 0,
            status: "invalidated",
            formed_at: c.time
          });
          continue;
        }
        for (let j = i + 1; j < bearFvgSearchEnd; j++) {
          const fvgC1 = slice[j - 1];
          const fvgC2 = slice[j];
          const fvgC3 = slice[j + 1];
          if (!fvgC3) continue;
          if (fvgC1.low > fvgC3.high && fvgC2.close < fvgC2.open) {
            const fvgTop = fvgC1.low, fvgBottom = fvgC3.high;
            const fvgSize = (fvgTop - fvgBottom) / currentPrice;
            if (fvgSize < 3e-4) continue;
            let obCandle = fvgC1;
            for (let k = j - 1; k >= Math.max(0, j - 5); k--) {
              if (slice[k].close > slice[k].open) {
                obCandle = slice[k];
                break;
              }
            }
            const obTop = Math.max(obCandle.open, obCandle.close);
            const obBottom = Math.min(obCandle.open, obCandle.close);
            const obFvgOverlap = obTop >= fvgBottom && obBottom <= fvgTop;
            let score = 0;
            const sweepDepth = c.high - swHigh.price;
            const sweepRatio = sweepDepth / atr;
            const displacementBody = Math.abs(fvgC2.close - fvgC2.open);
            if (sweepRatio >= 0.05 && c.close < swHigh.price) {
              if (obFvgOverlap) score += 30;
              else if (Math.abs(obBottom - fvgTop) / (currentPrice + 1e-9) < 1e-3) score += 15;
              if (sweepRatio > 0.5) score += 25;
              else if (sweepRatio > 0.3) score += 20;
              else if (sweepRatio > 0.1) score += 12;
              else score += 5;
              if (displacementBody > atr * 1.5) score += 20;
              else if (displacementBody > atr * 0.8) score += 15;
              else if (displacementBody > atr * 0.4) score += 8;
              if (htfTrend === "bearish") score += 15;
              else if (htfTrend === "ranging") score -= 5;
              if (fvgSize > 2e-3 && fvgSize < 0.01) score += 10;
              else if (fvgSize >= 1e-3) score += 5;
              if (c.close < c.open && c.close < swHigh.price) score += 10;
            }
            const entryTop = obFvgOverlap ? Math.min(obTop, fvgTop) : obTop;
            const entryBottom = obFvgOverlap ? Math.max(obBottom, fvgBottom) : obBottom;
            const entryMid = (entryTop + entryBottom) / 2;
            const dynamicSlBuffer = atr * 0.15;
            const sl = c.high + dynamicSlBuffer;
            const riskDist = sl - entryMid;
            const tp1 = entryMid - riskDist * (riskDist > atr * 2 ? 2 : 1.5);
            const tp2 = entryMid - riskDist * (riskDist > atr * 2 ? 4 : 3);
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
              sl,
              tp1,
              tp2,
              rr_ratio: Math.round(rrRatio * 10) / 10,
              status: priceNearEntry ? "active" : currentPrice < fvgBottom ? "completed" : "waiting",
              formed_at: fvgC2.time
            });
            break;
          }
        }
      }
    }
  }
  const validatedSetups = setups.filter((setup) => {
    if (setup.status === "invalidated") return true;
    const directionMatch = setup.fvg.type === setup.direction && setup.ob.type === setup.direction;
    if (!directionMatch) return false;
    const sweepIdx = setup.sweep.sweep_candle_idx;
    const fvgIdx = setup.fvg.idx;
    const obIdx = setup.ob.idx;
    if (fvgIdx === -1 || obIdx === -1) return true;
    const timeOrderValid = sweepIdx < fvgIdx;
    if (!timeOrderValid) return false;
    return true;
  });
  return validatedSetups.sort((a, b) => b.confluence_score - a.confluence_score).slice(0, 5);
}

// server/utils/cache.ts
var ServerCache = class {
  store = /* @__PURE__ */ new Map();
  /** 設定快取（ttl 單位：毫秒） */
  set(key, data, ttl = 10 * 60 * 1e3) {
    this.store.set(key, { data, timestamp: Date.now(), ttl });
  }
  /** 取得快取（若已過期則回傳 null） */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }
  /** 強制取得（不管是否過期） */
  getStale(key) {
    const entry = this.store.get(key);
    return entry?.data ?? null;
  }
  /** 刪除快取 */
  delete(key) {
    this.store.delete(key);
  }
  /** 清除所有快取 */
  clear() {
    this.store.clear();
  }
  /** 取得快取的剩餘有效時間（毫秒），若不存在或已過期則回傳 0 */
  ttlRemaining(key) {
    const entry = this.store.get(key);
    if (!entry) return 0;
    const remaining = entry.ttl - (Date.now() - entry.timestamp);
    return Math.max(0, remaining);
  }
};
var serverCache = new ServerCache();

// server/analysis.ts
var _krakenLastCallMs = 0;
var KRAKEN_MIN_INTERVAL_MS = 1200;
async function krakenRateLimit() {
  const now = Date.now();
  const elapsed = now - _krakenLastCallMs;
  if (elapsed < KRAKEN_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, KRAKEN_MIN_INTERVAL_MS - elapsed + 50));
  }
  _krakenLastCallMs = Date.now();
}
var _candleCache = /* @__PURE__ */ new Map();
var CANDLE_CACHE_TTL_MS = 3e4;
var CANDLE_STALE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1e3;
var KRAKEN_SYMBOL_MAP = {
  BTCUSDT: "XBTUSD",
  ETHUSDT: "ETHUSD",
  SOLUSDT: "SOLUSD",
  BNBUSDT: "BNBUSD",
  XRPUSDT: "XRPUSD",
  ADAUSDT: "ADAUSD",
  DOGEUSDT: "XDGUSD",
  AVAXUSDT: "AVAXUSD",
  DOTUSDT: "DOTUSD",
  LINKUSDT: "LINKUSD",
  LTCUSDT: "LTCUSD",
  MATICUSDT: "MATICUSD"
};
var KRAKEN_INTERVAL_MAP = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1H": 60,
  "1h": 60,
  "2H": 120,
  "2h": 120,
  "4H": 240,
  "4h": 240,
  "1D": 1440,
  "1d": 1440,
  "1W": 10080
};
var KRAKEN_NATIVE_INTERVALS = /* @__PURE__ */ new Set([1, 5, 15, 30, 60, 240, 1440, 10080, 21600]);
function getKrakenFetchPlan(bar) {
  const normalizedBar = bar in KRAKEN_INTERVAL_MAP ? bar : "1H";
  const requestedInterval = KRAKEN_INTERVAL_MAP[normalizedBar] ?? 60;
  if (KRAKEN_NATIVE_INTERVALS.has(requestedInterval)) {
    return {
      requestedBar: normalizedBar,
      requestedInterval,
      sourceBar: normalizedBar,
      sourceInterval: requestedInterval,
      aggregateFactor: 1
    };
  }
  if (requestedInterval === 120) {
    return {
      requestedBar: normalizedBar,
      requestedInterval,
      sourceBar: "1H",
      sourceInterval: 60,
      aggregateFactor: 2
    };
  }
  return {
    requestedBar: normalizedBar,
    requestedInterval,
    sourceBar: "1H",
    sourceInterval: 60,
    aggregateFactor: Math.max(1, Math.round(requestedInterval / 60))
  };
}
function aggregateCandles(candles, sourceIntervalMinutes, aggregateFactor, limit) {
  if (aggregateFactor <= 1) return candles.slice(-limit);
  const bucketSeconds = sourceIntervalMinutes * aggregateFactor * 60;
  const buckets = /* @__PURE__ */ new Map();
  for (const candle of candles) {
    const bucketStart = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
    const rows = buckets.get(bucketStart) ?? [];
    rows.push(candle);
    buckets.set(bucketStart, rows);
  }
  const aggregated = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([bucketStart, rows]) => {
    const sortedRows = rows.sort((a, b) => a.time - b.time);
    const first = sortedRows[0];
    const last = sortedRows[sortedRows.length - 1];
    return {
      time: bucketStart,
      open: first.open,
      high: Math.max(...sortedRows.map((row) => row.high)),
      low: Math.min(...sortedRows.map((row) => row.low)),
      close: last.close,
      volume: sortedRows.reduce((sum, row) => sum + row.volume, 0)
    };
  });
  return finalizeCandles(aggregated, sourceIntervalMinutes * aggregateFactor, limit);
}
function fetchLimitWithWarmup(limit, aggregateFactor) {
  return Math.max(limit * aggregateFactor + aggregateFactor * 20, limit + 20);
}
function computeSinceSeconds(intervalMinutes, fetchLimit) {
  const nowSec = Math.floor(Date.now() / 1e3);
  return nowSec - intervalMinutes * 60 * (fetchLimit + 20);
}
function buildKrakenOhlcUrl(pair, intervalMinutes, sinceSec) {
  return `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${intervalMinutes}&since=${sinceSec}`;
}
function getFetchCacheKey(symbol, bar, limit) {
  return `${symbol.toUpperCase()}_${bar}_${limit}`;
}
function cacheCandles(cacheKey, data) {
  _candleCache.set(cacheKey, { data, ts: Date.now() });
}
function findCompatibleCachedCandles(symbol, bar, limit, maxAgeMs) {
  const normalizedSymbol = symbol.toUpperCase();
  const normalizedBar = bar.toUpperCase();
  let best = null;
  for (const [key, cached] of _candleCache.entries()) {
    const parts = key.split("_");
    if (parts.length < 3) continue;
    const [entrySymbol, entryBar, entryLimitRaw] = parts;
    if (entrySymbol.toUpperCase() !== normalizedSymbol) continue;
    if (entryBar.toUpperCase() !== normalizedBar) continue;
    const entryLimit = Number(entryLimitRaw);
    if (!Number.isFinite(entryLimit) || entryLimit < limit) continue;
    if (cached.data.length < limit) continue;
    const ageMs = Date.now() - cached.ts;
    if (ageMs > maxAgeMs) continue;
    if (!best || ageMs < best.ageMs) {
      best = { data: cached.data.slice(-limit), ageMs };
    }
  }
  return best;
}
function getCachedCandles(symbol, bar, limit) {
  const cacheKey = getFetchCacheKey(symbol, bar, limit);
  const cached = _candleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CANDLE_CACHE_TTL_MS) {
    return cached.data;
  }
  return findCompatibleCachedCandles(symbol, bar, limit, CANDLE_CACHE_TTL_MS)?.data ?? null;
}
function getStaleCachedCandles(symbol, bar, limit) {
  const cacheKey = getFetchCacheKey(symbol, bar, limit);
  const cached = _candleCache.get(cacheKey);
  if (cached) {
    const ageMs = Date.now() - cached.ts;
    if (ageMs <= CANDLE_STALE_FALLBACK_MAX_AGE_MS && cached.data.length >= 50) {
      return { data: cached.data, ageMs };
    }
  }
  return findCompatibleCachedCandles(symbol, bar, limit, CANDLE_STALE_FALLBACK_MAX_AGE_MS);
}
function mapBarToKrakenInterval(bar) {
  return getKrakenFetchPlan(bar);
}
function finalizeFetchedCandles(payload, plan, fetchLimit, limit) {
  const baseCandles = parseCandleApiPayload(payload, plan.sourceInterval, fetchLimit);
  return aggregateCandles(baseCandles, plan.sourceInterval, plan.aggregateFactor, limit);
}
function getKrakenPair(symbol) {
  return KRAKEN_SYMBOL_MAP[symbol.toUpperCase()] ?? symbol.replace("USDT", "USD");
}
function getKrakenRequestLabel(plan) {
  return plan.aggregateFactor > 1 ? `${plan.requestedBar} via ${plan.sourceBar}` : plan.requestedBar;
}
function normalizeCandleRow(row, assumeMilliseconds = false) {
  if (Array.isArray(row)) {
    const rawTime = Number(row[0]);
    const time = assumeMilliseconds || rawTime > 1e12 ? Math.floor(rawTime / 1e3) : rawTime;
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[6] ?? row[5] ?? 0);
    if (![time, open, high, low, close, volume].every((n) => Number.isFinite(n))) return null;
    return { time, open, high, low, close, volume };
  }
  if (row && typeof row === "object") {
    const source = row;
    const rawTime = Number(source.time ?? source.ts ?? source.timestamp ?? 0);
    const time = rawTime > 1e12 ? Math.floor(rawTime / 1e3) : rawTime;
    const open = Number(source.open);
    const high = Number(source.high);
    const low = Number(source.low);
    const close = Number(source.close);
    const volume = Number(source.volume ?? source.vol ?? 0);
    if (![time, open, high, low, close, volume].every((n) => Number.isFinite(n))) return null;
    return { time, open, high, low, close, volume };
  }
  return null;
}
function finalizeCandles(candles, intervalMinutes, limit) {
  const sorted = candles.filter((c) => [c.time, c.open, c.high, c.low, c.close, c.volume].every((n) => Number.isFinite(n))).sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return [];
  const seen = /* @__PURE__ */ new Set();
  const deduped = sorted.filter((c) => {
    if (seen.has(c.time)) return false;
    seen.add(c.time);
    return true;
  });
  const now = Date.now() / 1e3;
  const intervalSec = intervalMinutes * 60;
  const confirmed = deduped.filter((c) => c.time + intervalSec <= now + 5);
  const stable = confirmed.length > 0 ? confirmed : deduped.slice(0, -1);
  const finalData = (stable.length > 0 ? stable : deduped).slice(-limit);
  return finalData;
}
function parseCandleApiPayload(payload, intervalMinutes, limit) {
  if (!payload || typeof payload !== "object") {
    throw new Error("K \u7DDA\u8CC7\u6599\u56DE\u61C9\u70BA\u7A7A");
  }
  const json = payload;
  if (Array.isArray(json.error) && json.error.length > 0) {
    throw new Error(`Kraken API \u932F\u8AA4\uFF1A${json.error.join(", ")}`);
  }
  if (Array.isArray(json.data)) {
    return finalizeCandles(
      json.data.map((row) => normalizeCandleRow(row, true)).filter((row) => row !== null),
      intervalMinutes,
      limit
    );
  }
  if (!json.result || typeof json.result !== "object") {
    throw new Error("K \u7DDA\u8CC7\u6599\u56DE\u61C9\u7F3A\u5C11 result/data \u6B04\u4F4D");
  }
  const resultKey = Object.keys(json.result).find((k) => k !== "last");
  if (!resultKey) {
    throw new Error("Kraken API \u56DE\u50B3\u683C\u5F0F\u7570\u5E38");
  }
  const rows = json.result[resultKey];
  if (!Array.isArray(rows)) {
    throw new Error("Kraken API K \u7DDA\u8CC7\u6599\u683C\u5F0F\u7570\u5E38");
  }
  return finalizeCandles(
    rows.map((row) => normalizeCandleRow(row)).filter((row) => row !== null),
    intervalMinutes,
    limit
  );
}
async function fetchCandles(symbol, bar, limit = 200) {
  const cacheKey = getFetchCacheKey(symbol, bar, limit);
  const cached = getCachedCandles(symbol, bar, limit);
  if (cached) return cached;
  const staleCached = getStaleCachedCandles(symbol, bar, limit);
  const pair = getKrakenPair(symbol);
  const plan = mapBarToKrakenInterval(bar);
  const fetchLimit = fetchLimitWithWarmup(limit, plan.aggregateFactor);
  const sinceSec = computeSinceSeconds(plan.sourceInterval, fetchLimit);
  const url = buildKrakenOhlcUrl(pair, plan.sourceInterval, sinceSec);
  const requestLabel = getKrakenRequestLabel(plan);
  await krakenRateLimit();
  let res;
  const maxAttempts = staleCached ? 1 : 2;
  const timeoutMs = staleCached ? 6e3 : 1e4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 CryptoDashboard/3.0" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (res.status === 429) {
        const waitMs = Math.min(1500 * Math.pow(2, attempt), 8e3);
        console.warn(`[Kraken] 429 Too Many Requests (${requestLabel}), \u7B49\u5F85 ${waitMs}ms \u5F8C\u91CD\u8A66...`);
        await new Promise((r) => setTimeout(r, waitMs));
        _krakenLastCallMs = Date.now();
        continue;
      }
      if (res.ok) break;
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (e) {
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt) {
        if (staleCached) {
          console.warn(`[Kraken] ${requestLabel} \u53D6\u5F97\u5931\u6557\uFF0C\u56DE\u9000\u5230 ${Math.round(staleCached.ageMs / 1e3)} \u79D2\u524D\u7684\u5FEB\u53D6\u8CC7\u6599`);
          return staleCached.data;
        }
        throw e;
      }
      await new Promise((r) => setTimeout(r, 1e3 * (attempt + 1)));
    }
  }
  if (!res) {
    if (staleCached) {
      console.warn(`[Kraken] ${requestLabel} \u672A\u53D6\u5F97\u56DE\u61C9\uFF0C\u56DE\u9000\u5230 ${Math.round(staleCached.ageMs / 1e3)} \u79D2\u524D\u7684\u5FEB\u53D6\u8CC7\u6599`);
      return staleCached.data;
    }
    throw new Error("K \u7DDA\u8CC7\u6599\u8ACB\u6C42\u672A\u53D6\u5F97\u56DE\u61C9");
  }
  let payload;
  try {
    payload = await res.json();
  } catch (error) {
    if (staleCached) {
      console.warn(`[Kraken] ${requestLabel} JSON \u89E3\u6790\u5931\u6557\uFF0C\u56DE\u9000\u5230 ${Math.round(staleCached.ageMs / 1e3)} \u79D2\u524D\u7684\u5FEB\u53D6\u8CC7\u6599`);
      return staleCached.data;
    }
    throw error;
  }
  const finalData = finalizeFetchedCandles(payload, plan, fetchLimit, limit);
  cacheCandles(cacheKey, finalData);
  return finalData;
}

// server/backtest.ts
var TAKER_FEE = 4e-4;
var SLIPPAGE = 2e-4;
var TOTAL_FEE = (TAKER_FEE + SLIPPAGE) * 2;
function calcDynamicSlippage(symbol, atrPct) {
  const isHighLiquidity = /^(BTC|ETH)/.test(symbol.toUpperCase());
  const baseSlippage = isHighLiquidity ? 3e-4 : 5e-4;
  const volatilityAddon = atrPct > 0.02 ? 2e-4 : 0;
  return baseSlippage + volatilityAddon;
}
function detectRegime(candles) {
  if (candles.length < 50) return "chaotic";
  const closes = candles.slice(-50).map((c) => c.close);
  const highs = candles.slice(-50).map((c) => c.high);
  const lows = candles.slice(-50).map((c) => c.low);
  const adxResult = calcAdxArr(candles.slice(-60));
  const adxVals = adxResult.adx.filter((v) => !isNaN(v));
  const adx = adxVals.length > 0 ? adxVals[adxVals.length - 1] : 0;
  const atrVals = calcAtrArr(candles.slice(-30), 14).filter((v) => !isNaN(v));
  const atr = atrVals.length > 0 ? atrVals[atrVals.length - 1] : 0;
  const price = closes[closes.length - 1];
  const atrPct = price > 0 ? atr / price : 0;
  const bbArr = calcBollingerArr(closes, 20, 2);
  const bbReady = bbArr.filter((b) => b.is_ready);
  let bbWidth = 0;
  if (bbReady.length > 0) {
    const lastBb = bbReady[bbReady.length - 1];
    bbWidth = lastBb.bandwidth;
  }
  const recentHigh = Math.max(...highs.slice(-20));
  const recentLow = Math.min(...lows.slice(-20));
  const rangeToAtr = atr > 0 ? (recentHigh - recentLow) / atr : 0;
  if (bbWidth < 0.02 || atrPct < 5e-3) return "compressed";
  if (adx >= 25 && rangeToAtr >= 3) return "trending";
  if (adx < 20 && rangeToAtr < 2.5) return "ranging";
  if (atrPct > 0.03) return "chaotic";
  return "ranging";
}
function dynamicConsensusThreshold(regime) {
  switch (regime) {
    case "trending":
      return 0.35;
    case "ranging":
      return 0.6;
    case "compressed":
      return 0.55;
    case "chaotic":
      return 0.75;
  }
}
function calcMtfTrend(candles) {
  if (candles.length < 50) return { direction: "neutral", ema20_above_ema50: false, price_above_ema200: false, adx: 0 };
  const closes = candles.map((c) => c.close);
  const close = closes[closes.length - 1];
  const ema20Arr = calcEmaArr(closes, 20);
  const ema50Arr = calcEmaArr(closes, 50);
  const ema20 = ema20Arr.filter((v) => !isNaN(v)).pop() ?? close;
  const ema50 = ema50Arr.filter((v) => !isNaN(v)).pop() ?? close;
  const hasEma200 = candles.length >= 220;
  const ema200Raw = hasEma200 ? calcEmaArr(closes, 200).filter((v) => !isNaN(v)).pop() : void 0;
  const adxResult = calcAdxArr(candles);
  const adx = adxResult.adx.filter((v) => !isNaN(v)).pop() ?? 0;
  const ema20AboveEma50 = ema20 > ema50;
  const priceAboveEma200 = hasEma200 && ema200Raw !== void 0 ? close > ema200Raw : null;
  const rsiArr = calcRsiArr(closes, 14);
  const rsi = rsiArr.filter((v) => !isNaN(v)).pop() ?? 50;
  const { hist: macdHistArr } = calcMacdArr(closes);
  const lastMacdHist = macdHistArr.filter((v) => !isNaN(v)).pop() ?? 0;
  const rsiBullish = rsi > 55;
  const rsiBearish = rsi < 45;
  const macdBullish = lastMacdHist > 0;
  const macdBearish = lastMacdHist < 0;
  if (adx < 20) {
    return { direction: "neutral", ema20_above_ema50: ema20AboveEma50, price_above_ema200: priceAboveEma200 ?? false, adx };
  }
  let direction;
  const emaDir = priceAboveEma200 === null ? ema20AboveEma50 ? 1 : -1 : ema20AboveEma50 && priceAboveEma200 ? 1 : !ema20AboveEma50 && !priceAboveEma200 ? -1 : 0;
  const rsiDir = rsiBullish ? 1 : rsiBearish ? -1 : 0;
  const macdDir = macdBullish ? 1 : macdBearish ? -1 : 0;
  const compositeScore = emaDir * 0.5 + rsiDir * 0.3 + macdDir * 0.2;
  direction = compositeScore >= 0.3 ? "bullish" : compositeScore <= -0.3 ? "bearish" : "neutral";
  return { direction, ema20_above_ema50: ema20AboveEma50, price_above_ema200: priceAboveEma200 ?? false, adx };
}
var MTF_LAYER_WEIGHTS = {
  "4H": 0.4,
  // 最高權重：大方向決定性
  "1H": 0.3,
  // 中期趨勢確認
  "15m": 0.2,
  // 進場結構確認
  "5m": 0.1
  // 精確時機（最低權重）
};
function calcMtfLayer(candles, timeframe) {
  const weight = MTF_LAYER_WEIGHTS[timeframe] ?? 0.25;
  if (candles.length < 50) {
    return { timeframe, direction: "neutral", weight, score: 0, adx: 0, ema_aligned: false };
  }
  const trend = calcMtfTrend(candles);
  const score = trend.direction === "bullish" ? weight : trend.direction === "bearish" ? -weight : 0;
  return {
    timeframe,
    direction: trend.direction,
    weight,
    score,
    adx: trend.adx,
    ema_aligned: trend.ema20_above_ema50
  };
}
function calcMtfConsensus(candles4h, candles1h, candles15m, candles5m, currentTime, minPassScore = 0.5) {
  const filterByTime = (c) => c ? c.filter((x) => x.time <= currentTime) : null;
  const layers = [
    calcMtfLayer(filterByTime(candles4h) ?? [], "4H"),
    calcMtfLayer(filterByTime(candles1h) ?? [], "1H"),
    calcMtfLayer(filterByTime(candles15m) ?? [], "15m"),
    calcMtfLayer(filterByTime(candles5m) ?? [], "5m")
  ];
  const consensusScore = layers.reduce((sum, l) => sum + l.score, 0);
  const bullishLayers = layers.filter((l) => l.direction === "bullish").length;
  const bearishLayers = layers.filter((l) => l.direction === "bearish").length;
  const neutralLayers = layers.filter((l) => l.direction === "neutral").length;
  const consensusDir = consensusScore >= minPassScore ? "bullish" : consensusScore <= -minPassScore ? "bearish" : "neutral";
  const h4Layer = layers.find((l) => l.timeframe === "4H");
  const h1Layer = layers.find((l) => l.timeframe === "1H");
  const h4Veto = h4Layer && h4Layer.direction !== "neutral" && h4Layer.direction !== consensusDir && consensusDir !== "neutral";
  const h1h4Conflict = h4Layer && h1Layer && h4Layer.direction !== "neutral" && h1Layer.direction !== "neutral" && h4Layer.direction !== h1Layer.direction;
  const passed = Math.abs(consensusScore) >= minPassScore && !h4Veto && !h1h4Conflict;
  return {
    layers,
    consensus_score: consensusScore,
    consensus_dir: consensusDir,
    bullish_layers: bullishLayers,
    bearish_layers: bearishLayers,
    neutral_layers: neutralLayers,
    passed
  };
}
function detectFvgsSimple(candles, lookback = 30) {
  const fvgs = [];
  const start = Math.max(0, candles.length - lookback);
  const atrSlice = candles.slice(Math.max(0, candles.length - 20));
  const atrVals = atrSlice.slice(1).map((c, i) => {
    const p = atrSlice[i];
    return Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  });
  const atr = atrVals.length > 0 ? atrVals.reduce((a, b) => a + b, 0) / atrVals.length : 0;
  const minGap = atr * 0.1;
  for (let i = start + 2; i < candles.length; i++) {
    const prev = candles[i - 2], mid = candles[i - 1], curr = candles[i];
    const bullGap = curr.low - prev.high;
    if (bullGap > minGap && mid.close > mid.open) {
      const mitigated = candles.slice(i + 1).some((c) => c.low <= prev.high);
      if (!mitigated) {
        fvgs.push({ type: "bullish", top: curr.low, bottom: prev.high, idx: i });
      }
    }
    const bearGap = prev.low - curr.high;
    if (bearGap > minGap && mid.close < mid.open) {
      const mitigated = candles.slice(i + 1).some((c) => c.high >= prev.low);
      if (!mitigated) {
        fvgs.push({ type: "bearish", top: prev.low, bottom: curr.high, idx: i });
      }
    }
  }
  return fvgs;
}
function detectObsSimple(candles, lookback = 30) {
  const obs = [];
  const start = Math.max(0, candles.length - lookback);
  for (let i = start + 3; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1], pp = candles[i - 2];
    const bodyPp = Math.abs(pp.close - pp.open);
    const bodyC = Math.abs(c.close - c.open);
    if (pp.close < pp.open && c.close > pp.high && c.close > p.high && bodyC > bodyPp * 1.5) {
      const mitigated = candles.slice(i + 1).some((k) => k.low < pp.low);
      if (!mitigated) {
        obs.push({ type: "bullish", top: pp.high, bottom: pp.low, idx: i });
      }
    }
    if (pp.close > pp.open && c.close < pp.low && c.close < p.low && bodyC > bodyPp * 1.5) {
      const mitigated = candles.slice(i + 1).some((k) => k.high > pp.high);
      if (!mitigated) {
        obs.push({ type: "bearish", top: pp.high, bottom: pp.low, idx: i });
      }
    }
  }
  return obs;
}
function checkFvgObEntry(candles, idx, direction) {
  const close = candles[idx].close;
  const slice = candles.slice(Math.max(0, idx - 40), idx + 1);
  const fvgs = detectFvgsSimple(slice);
  const obs = detectObsSimple(slice);
  if (direction === "long") {
    for (const fvg of fvgs.filter((f) => f.type === "bullish")) {
      if (close >= fvg.bottom && close <= fvg.top) return { inZone: true, type: "FVG" };
    }
    for (const ob of obs.filter((o) => o.type === "bullish")) {
      if (close >= ob.bottom && close <= ob.top) return { inZone: true, type: "OB" };
    }
  } else {
    for (const fvg of fvgs.filter((f) => f.type === "bearish")) {
      if (close >= fvg.bottom && close <= fvg.top) return { inZone: true, type: "FVG" };
    }
    for (const ob of obs.filter((o) => o.type === "bearish")) {
      if (close >= ob.bottom && close <= ob.top) return { inZone: true, type: "OB" };
    }
  }
  return { inZone: false, type: "Standard" };
}
function detectPivotLow(candles, idx, lookback = 20, confirmBars = 2) {
  const start = Math.max(confirmBars, idx - lookback);
  for (let j = idx - confirmBars; j >= start; j--) {
    const c = candles[j];
    let isLeft = true, isRight = true;
    for (let k = 1; k <= confirmBars; k++) {
      if (j - k >= 0 && candles[j - k].low <= c.low) {
        isLeft = false;
        break;
      }
    }
    for (let k = 1; k <= confirmBars; k++) {
      if (j + k <= idx && candles[j + k].low <= c.low) {
        isRight = false;
        break;
      }
    }
    if (isLeft && isRight) return c.low;
  }
  return null;
}
function detectPivotHigh(candles, idx, lookback = 20, confirmBars = 2) {
  const start = Math.max(confirmBars, idx - lookback);
  for (let j = idx - confirmBars; j >= start; j--) {
    const c = candles[j];
    let isLeft = true, isRight = true;
    for (let k = 1; k <= confirmBars; k++) {
      if (j - k >= 0 && candles[j - k].high >= c.high) {
        isLeft = false;
        break;
      }
    }
    for (let k = 1; k <= confirmBars; k++) {
      if (j + k <= idx && candles[j + k].high >= c.high) {
        isRight = false;
        break;
      }
    }
    if (isLeft && isRight) return c.high;
  }
  return null;
}
function detectUpTrendLine(candles, idx, lookback = 40) {
  const pivots = [];
  const start = Math.max(2, idx - lookback);
  for (let j = start; j <= idx - 2; j++) {
    const c = candles[j];
    if (c.low < candles[j - 1].low && c.low < candles[j + 1].low && (j + 2 > idx || c.low < candles[j + 2].low)) {
      pivots.push({ idx: j, low: c.low });
    }
  }
  if (pivots.length < 2) return { confirmed: false, slope: 0, pivots: pivots.map((p) => p.low) };
  const p1 = pivots[pivots.length - 2];
  const p2 = pivots[pivots.length - 1];
  const slope = (p2.low - p1.low) / (p2.idx - p1.idx);
  const trendLineValue = p2.low + slope * (idx - p2.idx);
  const currentClose = candles[idx].close;
  const confirmed = slope > 0 && currentClose >= trendLineValue * 0.998;
  return { confirmed, slope, pivots: pivots.map((p) => p.low) };
}
function detectDownTrendLine(candles, idx, lookback = 40) {
  const pivots = [];
  const start = Math.max(2, idx - lookback);
  for (let j = start; j <= idx - 2; j++) {
    const c = candles[j];
    if (c.high > candles[j - 1].high && c.high > candles[j + 1].high && (j + 2 > idx || c.high > candles[j + 2].high)) {
      pivots.push({ idx: j, high: c.high });
    }
  }
  if (pivots.length < 2) return { confirmed: false, slope: 0 };
  const p1 = pivots[pivots.length - 2];
  const p2 = pivots[pivots.length - 1];
  const slope = (p2.high - p1.high) / (p2.idx - p1.idx);
  const trendLineValue = p2.high + slope * (idx - p2.idx);
  const currentClose = candles[idx].close;
  const confirmed = slope < 0 && currentClose <= trendLineValue * 1.002;
  return { confirmed, slope };
}
function buildRecentSrLevels(candles, idx, lookback = 80) {
  const start = Math.max(2, idx - lookback);
  const rawLevels = [];
  for (let j = start; j <= idx - 2; j++) {
    const c = candles[j];
    if (c.low <= candles[j - 1].low && c.low <= candles[j - 2].low && c.low < candles[j + 1].low && c.low < candles[j + 2].low) {
      rawLevels.push({ price: c.low, type: "support", touches: 1 });
    }
    if (c.high >= candles[j - 1].high && c.high >= candles[j - 2].high && c.high > candles[j + 1].high && c.high > candles[j + 2].high) {
      rawLevels.push({ price: c.high, type: "resistance", touches: 1 });
    }
  }
  const tolerance = (candles[idx]?.close ?? 1) * 15e-4;
  const merged = [];
  for (const level of rawLevels) {
    const found = merged.find((l) => l.type === level.type && Math.abs(l.price - level.price) <= tolerance);
    if (found) {
      found.price = (found.price * found.touches + level.price) / (found.touches + 1);
      found.touches += 1;
      found.strength = Math.min(5, found.touches);
    } else {
      merged.push({
        price: level.price,
        type: level.type,
        touches: 1,
        strength: 1,
        label: level.type === "support" ? "Local Support" : "Local Resistance"
      });
    }
  }
  return merged.sort((a, b) => b.strength - a.strength || Math.abs((candles[idx]?.close ?? 0) - a.price) - Math.abs((candles[idx]?.close ?? 0) - b.price)).slice(0, 10);
}
function calcDynamicSlTp(candles, idx, direction, atr, atrSlMult, atrTpMult, entryPrice) {
  const ep = entryPrice ?? candles[idx].close;
  const lookback = Math.min(20, idx);
  const slice = candles.slice(idx - lookback, idx + 1);
  let swingLow = Math.min(...slice.map((c) => c.low));
  let swingHigh = Math.max(...slice.map((c) => c.high));
  const srLookback = Math.min(50, idx);
  const srSlice = candles.slice(idx - srLookback, idx + 1);
  let nearResistance = ep * 1.03;
  for (let j = srSlice.length - 2; j >= 1; j--) {
    const c = srSlice[j];
    if (c.high > ep && c.high > srSlice[j - 1].high && c.high > srSlice[j + 1].high) {
      nearResistance = c.high;
      break;
    }
  }
  let nearSupport = ep * 0.97;
  for (let j = srSlice.length - 2; j >= 1; j--) {
    const c = srSlice[j];
    if (c.low < ep && c.low < srSlice[j - 1].low && c.low < srSlice[j + 1].low) {
      nearSupport = c.low;
      break;
    }
  }
  let sl, tp;
  if (direction === "long") {
    const pivotLow = detectPivotLow(candles, idx, 20, 2);
    const pivotSlDist = pivotLow !== null ? Math.abs(ep - pivotLow) + atr * 0.5 : Math.abs(ep - swingLow) + atr * 0.3;
    const atrSlDist = atr * atrSlMult;
    const slDist = Math.min(pivotSlDist, atrSlDist * 1.2);
    sl = ep - slDist;
    const minTp = ep + slDist * 1.5;
    tp = Math.max(nearResistance, minTp);
    tp = Math.min(tp, ep + atr * atrTpMult * 2);
  } else {
    const pivotHigh = detectPivotHigh(candles, idx, 20, 2);
    const pivotSlDist = pivotHigh !== null ? Math.abs(pivotHigh - ep) + atr * 0.5 : Math.abs(swingHigh - ep) + atr * 0.3;
    const atrSlDist = atr * atrSlMult;
    const slDist = Math.min(pivotSlDist, atrSlDist * 1.2);
    sl = ep + slDist;
    const minTp = ep - slDist * 1.5;
    tp = Math.min(nearSupport, minTp);
    tp = Math.max(tp, ep - atr * atrTpMult * 2);
  }
  const rr = Math.abs(tp - ep) / Math.abs(sl - ep);
  return { sl, tp, rr };
}
function signalEmaCross(i, ema20, ema50) {
  if (i < 3 || isNaN(ema20[i]) || isNaN(ema50[i]) || isNaN(ema20[i - 1]) || isNaN(ema50[i - 1])) return { direction: null };
  const ema50Slope = (ema50[i] - ema50[i - 3]) / (ema50[i - 3] || 1);
  const minSlope = 3e-4;
  const spread = Math.abs(ema20[i] - ema50[i]) / (ema50[i] || 1);
  if (spread < 1e-3) return { direction: null };
  if (ema20[i - 1] <= ema50[i - 1] && ema20[i] > ema50[i] && ema50Slope > minSlope) return { direction: "long" };
  if (ema20[i - 1] >= ema50[i - 1] && ema20[i] < ema50[i] && ema50Slope < -minSlope) return { direction: "short" };
  return { direction: null };
}
function signalRsiReversal(i, rsi, ema50, closes, candles) {
  if (i < 2 || isNaN(rsi[i]) || isNaN(rsi[i - 1]) || isNaN(rsi[i - 2]) || isNaN(ema50[i])) return { direction: null };
  const wasOversold = rsi[i - 2] < 35 || rsi[i - 1] < 35;
  const wasOverbought = rsi[i - 2] > 65 || rsi[i - 1] > 65;
  const hookUp = wasOversold && rsi[i] > rsi[i - 1] && rsi[i - 1] > rsi[i - 2] && rsi[i] < 50;
  const hookDown = wasOverbought && rsi[i] < rsi[i - 1] && rsi[i - 1] < rsi[i - 2] && rsi[i] > 50;
  const bullishCandle = candles ? candles[i].close > candles[i].open : true;
  const bearishCandle = candles ? candles[i].close < candles[i].open : true;
  if (hookUp && closes[i] > ema50[i] && bullishCandle) return { direction: "long" };
  if (hookDown && closes[i] < ema50[i] && bearishCandle) return { direction: "short" };
  return { direction: null };
}
function signalBollinger(i, closes, upper, lower, ema50, rsi) {
  if (i < 20 || isNaN(upper[i]) || isNaN(lower[i])) return { direction: null };
  const mid = (upper[i] + lower[i]) / 2;
  const bandwidth = (upper[i] - lower[i]) / (mid || 1) * 100;
  let avgBw = bandwidth;
  let bwSum = 0, bwCount = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) {
    if (!isNaN(upper[j]) && !isNaN(lower[j])) {
      const m = (upper[j] + lower[j]) / 2;
      bwSum += (upper[j] - lower[j]) / (m || 1) * 100;
      bwCount++;
    }
  }
  if (bwCount > 0) avgBw = bwSum / bwCount;
  const isSqueeze = bandwidth < avgBw * 0.7;
  const rsiVal = rsi ? rsi[i] : 50;
  if (isSqueeze) {
    if (closes[i] > upper[i] && rsiVal > 50) return { direction: "long" };
    if (closes[i] < lower[i] && rsiVal < 50) return { direction: "short" };
  } else {
    if (closes[i] < lower[i] && rsiVal < 45) return { direction: "long" };
    if (closes[i] > upper[i] && rsiVal > 55) return { direction: "short" };
  }
  return { direction: null };
}
function signalMacd(i, hist, closes, ema50) {
  if (i < 5 || isNaN(hist[i]) || isNaN(hist[i - 1]) || isNaN(hist[i - 2])) return { direction: null };
  const crossUp = hist[i - 1] < 0 && hist[i] > 0;
  const crossDown = hist[i - 1] > 0 && hist[i] < 0;
  const momentumAccelUp = hist[i] > hist[i - 1] && hist[i - 1] > hist[i - 2];
  const momentumAccelDown = hist[i] < hist[i - 1] && hist[i - 1] < hist[i - 2];
  let bullDivergence = false, bearDivergence = false;
  if (i >= 10) {
    const lookback = 10;
    const priceHigh = Math.max(...closes.slice(i - lookback, i));
    const priceLow = Math.min(...closes.slice(i - lookback, i));
    const histHigh = Math.max(...hist.slice(i - lookback, i));
    const histLow = Math.min(...hist.slice(i - lookback, i));
    if (closes[i] >= priceHigh * 0.999 && hist[i] < histHigh * 0.85) bearDivergence = true;
    if (closes[i] <= priceLow * 1.001 && hist[i] > histLow * 0.85) bullDivergence = true;
  }
  if (crossUp && (momentumAccelUp || hist[i] > Math.abs(hist[i - 1]) * 0.5) && (!isNaN(ema50[i]) ? closes[i] > ema50[i] : true)) return { direction: "long" };
  if (crossDown && (momentumAccelDown || Math.abs(hist[i]) > Math.abs(hist[i - 1]) * 0.5) && (!isNaN(ema50[i]) ? closes[i] < ema50[i] : true)) return { direction: "short" };
  if (bullDivergence && hist[i] > hist[i - 1] && (!isNaN(ema50[i]) ? closes[i] > ema50[i] : true)) return { direction: "long" };
  if (bearDivergence && hist[i] < hist[i - 1] && (!isNaN(ema50[i]) ? closes[i] < ema50[i] : true)) return { direction: "short" };
  return { direction: null };
}
function signalSmc(i, candles, ema200) {
  if (i < 80 || isNaN(ema200[i])) return { direction: null };
  const close = candles[i].close;
  const c = candles[i];
  const slice = candles.slice(Math.max(0, i - 140), i + 1);
  const htfTrend = close > ema200[i] * 1.001 ? "bullish" : close < ema200[i] * 0.999 ? "bearish" : "ranging";
  if (htfTrend === "ranging") return { direction: null };
  const atrSlice = candles.slice(Math.max(1, i - 14), i + 1);
  const atr = atrSlice.length > 0 ? atrSlice.reduce((sum, cc, idx2) => {
    const prevC = candles[Math.max(0, i - 14) + idx2 - 1]?.close ?? cc.close;
    return sum + Math.max(cc.high - cc.low, Math.abs(cc.high - prevC), Math.abs(cc.low - prevC));
  }, 0) / atrSlice.length : c.high - c.low;
  const fvgData = detectFvgZones(slice, close);
  const iFvgBull = fvgData.allBull.find(
    (f) => f.filled_pct >= 0.1 && f.filled_pct < 0.85 && // 已部分進入但未完全填補
    c.close > f.bottom && c.close <= f.top && // 實體收盤在 FVG 區間內（iFVG 觸發）
    f.quality >= 40
  );
  const iFvgBear = fvgData.allBear.find(
    (f) => f.filled_pct >= 0.1 && f.filled_pct < 0.85 && c.close < f.top && c.close >= f.bottom && f.quality >= 40
  );
  const bosChoch = detectBosChoch(slice);
  const recentEvents = bosChoch.events.slice(-6);
  const hasChochBull = recentEvents.some((e) => e.type === "CHoCH" && e.direction === "bullish" && e.confirmed);
  const hasChochBear = recentEvents.some((e) => e.type === "CHoCH" && e.direction === "bearish" && e.confirmed);
  const hasBosBull = recentEvents.some((e) => e.type === "BOS" && e.direction === "bullish" && e.confirmed);
  const hasBosBear = recentEvents.some((e) => e.type === "BOS" && e.direction === "bearish" && e.confirmed);
  const structureBull = hasChochBull || hasBosBull;
  const structureBear = hasChochBear || hasBosBear;
  const fibData = calcFibOte(slice, close);
  const inDiscountZone = fibData !== null && fibData.price_pct < 50;
  const inPremiumZone = fibData !== null && fibData.price_pct > 50;
  const sweepData = detectLiquiditySweep(slice, close);
  const crtBull = sweepData.bslSwept && // 掃低點後反轉（誘空後做多）
  sweepData.bslStrength >= 50 && sweepData.bslReclaimed && // 收盤返回結構內
  hasChochBull;
  const crtBear = sweepData.sslSwept && // 掃高點後反轉（誘多後做空）
  sweepData.sslStrength >= 50 && sweepData.sslReclaimed && // 收盤返回結構內
  hasChochBear;
  const swingHighs = findSwingHighs(slice, 5);
  const swingLows = findSwingLows(slice, 5);
  const nearestHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : Infinity;
  const nearestLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : 0;
  const nearBullFvg = fvgData.nearestBull ? Math.abs(close - fvgData.nearestBull.mid) < atr * 0.5 : false;
  const nearBearFvg = fvgData.nearestBear ? Math.abs(close - fvgData.nearestBear.mid) < atr * 0.5 : false;
  const i2eBull = nearBullFvg && htfTrend === "bullish" && close < nearestHigh * 0.98;
  const e2iBull = crtBull && nearBullFvg;
  const i2eBear = nearBearFvg && htfTrend === "bearish" && close > nearestLow * 1.02;
  const e2iBear = crtBear && nearBearFvg;
  const setups = detectSmcConfirmationSetups(slice, close, htfTrend, 10).filter((setup) => setup.status !== "invalidated" && setup.confluence_score >= 45 && setup.rr_ratio >= 1.3).sort((a, b) => {
    const statusRank = (s) => s === "active" ? 3 : s === "waiting" ? 2 : s === "completed" ? 1 : 0;
    return statusRank(b.status) - statusRank(a.status) || b.confluence_score - a.confluence_score;
  });
  const best = setups.find((setup) => setup.htf_aligned && (setup.status === "active" || setup.status === "waiting")) ?? setups.find((setup) => setup.htf_aligned) ?? null;
  const longCondition = (iFvgBull !== void 0 || crtBull) && // SM-A 或 SM-D
  structureBull && // SM-B
  inDiscountZone && // SM-C
  (i2eBull || e2iBull) && // SM-E
  close > ema200[i] * 0.995;
  const shortCondition = (iFvgBear !== void 0 || crtBear) && structureBear && inPremiumZone && (i2eBear || e2iBear) && close < ema200[i] * 1.005;
  if (!longCondition && !shortCondition) return { direction: null };
  const direction = longCondition ? "long" : "short";
  let sl, tp1, tp2;
  if (best && best.direction === (longCondition ? "bullish" : "bearish")) {
    sl = best.sl > 0 ? best.sl : void 0;
    tp1 = best.tp1 > 0 ? best.tp1 : void 0;
    tp2 = best.tp2 > 0 ? best.tp2 : void 0;
  } else {
    sl = direction === "long" ? close - atr * 1.5 : close + atr * 1.5;
    tp1 = direction === "long" ? close + atr * 2.5 : close - atr * 2.5;
    tp2 = direction === "long" ? close + atr * 4 : close - atr * 4;
  }
  let score = 5;
  if (iFvgBull !== void 0 || iFvgBear !== void 0) score += 1.5;
  if (hasChochBull || hasChochBear) score += 1;
  if (crtBull || crtBear) score += 1;
  if (e2iBull || e2iBear) score += 0.5;
  if (best) score += Math.min(1, best.confluence_score / 100);
  score = Math.min(10, Math.round(score * 10) / 10);
  const entryType = crtBull || crtBear ? "SMC_CRT" : e2iBull || e2iBear ? "SMC_E2I" : "SMC_I2E";
  return {
    direction,
    custom_sl: sl,
    custom_tp: tp1,
    custom_tp2: tp2,
    entry_type: entryType,
    score
  };
}
function signalPa(i, candles, closes, rsi, ema20, ema50, ema200, macdHist, plusDi, minusDi) {
  if (i < 30 || isNaN(rsi[i]) || isNaN(ema50[i]) || isNaN(ema200[i])) return { direction: null };
  const close = closes[i];
  const c = candles[i];
  const candleSpan = i > 0 ? Math.max(1, candles[i].time - candles[i - 1].time) : 9e5;
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((sum, cc) => sum + cc.volume, 0) / volSlice.length : c.volume;
  const currVol = c.volume;
  const trSlice = candles.slice(Math.max(1, i - 14), i + 1);
  const atr = trSlice.length > 0 ? trSlice.reduce((sum, cc, idx2) => {
    const prevClose = candles[Math.max(0, i - 14) + idx2 - 1]?.close ?? cc.close;
    const tr = Math.max(cc.high - cc.low, Math.abs(cc.high - prevClose), Math.abs(cc.low - prevClose));
    return sum + tr;
  }, 0) / trSlice.length : c.high - c.low;
  const cBody = Math.abs(c.close - c.open);
  const cRange = c.high - c.low;
  const cUpperWick = c.high - Math.max(c.close, c.open);
  const cLowerWick = Math.min(c.close, c.open) - c.low;
  const isTrueBreakout = cBody >= cRange * 0.7 && (c.close > c.open ? cUpperWick < cRange * 0.15 : cLowerWick < cRange * 0.15) && currVol >= avgVol * 1.5;
  const isFakeBreakout = cBody < cRange * 0.4 && (cUpperWick > cRange * 0.35 || cLowerWick > cRange * 0.35) && currVol < avgVol * 1.2;
  const rangeSlice = candles.slice(Math.max(0, i - 40), i + 1);
  const rangeHigh = Math.max(...rangeSlice.map((cc) => cc.high));
  const rangeLow = Math.min(...rangeSlice.map((cc) => cc.low));
  const rangeSize = rangeHigh - rangeLow;
  const pricePosition = rangeSize > 0 ? (close - rangeLow) / rangeSize : 0.5;
  const nearRangeTop = pricePosition >= 0.85;
  const nearRangeBottom = pricePosition <= 0.15;
  const isRangeMarket = rangeSize > atr * 1 && rangeSize < atr * 12;
  const srLevels = buildRecentSrLevels(candles, i, 90);
  if (srLevels.length === 0) return { direction: null };
  const patterns = detectPaPatternsWithLevels(
    candles.slice(Math.max(0, i - 90), i + 1),
    srLevels,
    "15m",
    atr || Math.abs(c.high - c.low)
  );
  const recentPatterns = patterns.filter((p) => Math.abs(candles[i].time - p.time) <= candleSpan * 2);
  const best = recentPatterns[0] ?? null;
  const upTrend = detectUpTrendLine(candles, i, 40);
  const downTrend = detectDownTrendLine(candles, i, 40);
  const volConfirmed = avgVol > 0 ? currVol >= avgVol * 1.15 : true;
  const bullishMomentum = rsi[i] >= 48 && (isNaN(macdHist[i]) || macdHist[i] >= (macdHist[i - 1] ?? macdHist[i])) && (!isNaN(plusDi[i]) && !isNaN(minusDi[i]) ? plusDi[i] >= minusDi[i] * 0.9 : true);
  const bearishMomentum = rsi[i] <= 52 && (isNaN(macdHist[i]) || macdHist[i] <= (macdHist[i - 1] ?? macdHist[i])) && (!isNaN(plusDi[i]) && !isNaN(minusDi[i]) ? minusDi[i] >= plusDi[i] * 0.9 : true);
  function calcMeasuredMoveTP(dir) {
    const lookbackSlice = candles.slice(Math.max(0, i - 60), i);
    if (lookbackSlice.length < 10) return dir === "long" ? close + atr * 2.5 : close - atr * 2.5;
    const prevHigh = Math.max(...lookbackSlice.map((cc) => cc.high));
    const prevLow = Math.min(...lookbackSlice.map((cc) => cc.low));
    const prevMove = prevHigh - prevLow;
    return dir === "long" ? close + prevMove * 0.618 : close - prevMove * 0.618;
  }
  const paLong = best && best.pattern.type === "bullish" && best.at_key_level && best.confluence_score >= 55 && close >= ema50[i] * 0.998 && close >= ema200[i] * 0.995 && bullishMomentum && (volConfirmed || upTrend.confirmed);
  const trapLong = isRangeMarket && nearRangeBottom && isFakeBreakout && c.close > c.open && // 收陰線返回（假突破後反射）
  close >= ema200[i] * 0.995 && bullishMomentum;
  if (paLong || trapLong) {
    const tp = trapLong ? calcMeasuredMoveTP("long") : best.tp;
    const sl = trapLong ? rangeLow - atr * 0.3 : best.sl;
    const baseScore = best ? Math.round(best.confluence_score / 10 * 10) / 10 : 6;
    const bonus = isTrueBreakout ? 1 : trapLong ? 0.8 : 0;
    const rsiDivBonus = i >= 5 && rsi[i] < rsi[i - 5] && close > closes[i - 5] ? 0.5 : 0;
    return {
      direction: "long",
      custom_sl: sl,
      custom_tp: tp,
      score: Math.min(10, baseScore + bonus + rsiDivBonus),
      pivot_low: detectPivotLow(candles, i, 20, 2) ?? void 0,
      trendline_confirmed: upTrend.confirmed,
      entry_type: trapLong ? "PA_2ND_LEG_TRAP" : isTrueBreakout ? "PA_TRUE_BREAKOUT" : "PA_PATTERN"
    };
  }
  const ema50Slope3 = i >= 3 ? ema50[i] - ema50[i - 3] : 0;
  const ema50Declining = ema50Slope3 < 0;
  const paShort = best && best.pattern.type === "bearish" && best.at_key_level && best.confluence_score >= 55 && close <= ema50[i] * 1.002 && close <= ema200[i] * 1.005 && bearishMomentum && ema50Declining && // ★ 方案四：必須 EMA50 下行
  (volConfirmed || downTrend.confirmed);
  const trapShort = isRangeMarket && nearRangeTop && isFakeBreakout && c.close < c.open && // 收陰線返回
  close <= ema200[i] * 1.005 && bearishMomentum && ema50Declining;
  if (paShort || trapShort) {
    const tp = trapShort ? calcMeasuredMoveTP("short") : best.tp;
    const sl = trapShort ? rangeHigh + atr * 0.3 : best.sl;
    const baseScore = best ? Math.round(best.confluence_score / 10 * 10) / 10 : 6;
    const bonus = isTrueBreakout ? 1 : trapShort ? 0.8 : 0;
    const rsiDivBonus = i >= 5 && rsi[i] > rsi[i - 5] && close < closes[i - 5] ? 0.5 : 0;
    return {
      direction: "short",
      custom_sl: sl,
      custom_tp: tp,
      score: Math.min(10, baseScore + bonus + rsiDivBonus),
      pivot_high: detectPivotHigh(candles, i, 20, 2) ?? void 0,
      trendline_confirmed: downTrend.confirmed,
      entry_type: trapShort ? "PA_2ND_LEG_TRAP" : isTrueBreakout ? "PA_TRUE_BREAKOUT" : "PA_PATTERN"
    };
  }
  return { direction: null };
}
function signalChan(i, candles) {
  if (i < 80) return { direction: null };
  const close = candles[i].close;
  const candleSpan = i > 0 ? Math.max(1, candles[i].time - candles[i - 1].time) : 9e5;
  const slice = candles.slice(Math.max(0, i - 260), i + 1);
  const result = calcChanEnhanced(slice, close, 220);
  const atrSlice = candles.slice(Math.max(1, i - 14), i + 1);
  const atr = atrSlice.length > 0 ? atrSlice.reduce((sum, cc, idx2) => {
    const prevC = candles[Math.max(0, i - 14) + idx2 - 1]?.close ?? cc.close;
    return sum + Math.max(cc.high - cc.low, Math.abs(cc.high - prevC), Math.abs(cc.low - prevC));
  }, 0) / atrSlice.length : candles[i].high - candles[i].low;
  const fvgData = detectFvgZones(slice, close);
  const zh = result.current_zhongshu;
  const nearZhTop = zh ? Math.abs(close - zh.top) < atr * 0.5 : false;
  const nearZhBottom = zh ? Math.abs(close - zh.bottom) < atr * 0.5 : false;
  const nearBullFvg = fvgData.nearestBull ? Math.abs(close - fvgData.nearestBull.mid) < atr * 0.6 : false;
  const nearBearFvg = fvgData.nearestBear ? Math.abs(close - fvgData.nearestBear.mid) < atr * 0.6 : false;
  const inIrlBull = nearZhBottom || nearBullFvg;
  const inIrlBear = nearZhTop || nearBearFvg;
  const fibData = calcFibOte(slice, close);
  const inOteBull = fibData !== null && fibData.price_pct <= 38.2;
  const inOteBear = fibData !== null && fibData.price_pct >= 61.8;
  const latestPoint = (result.buy_sell_points ?? []).filter((point) => Math.abs(close - point.price) / close <= 0.03).sort((a, b) => b.time - a.time)[0];
  if (latestPoint && Math.abs(candles[i].time - latestPoint.time) <= candleSpan * 8) {
    if (latestPoint.direction === "buy" && (latestPoint.divergence_confirmed || latestPoint.level >= 2) && result.trend !== "bearish") {
      if (!inIrlBull && !inOteBull) return { direction: null };
      const irlBonus = inIrlBull ? 1.5 : 0;
      const oteBonus = inOteBull ? 1 : 0;
      const baseScore = latestPoint.level + (latestPoint.divergence_confirmed ? 1 : 0);
      return {
        direction: "long",
        score: Math.min(10, baseScore + irlBonus + oteBonus),
        entry_type: inIrlBull ? "CHAN_I2E" : "CHAN_OTE"
      };
    }
    if (latestPoint.direction === "sell" && (latestPoint.divergence_confirmed || latestPoint.level >= 2) && result.trend !== "bullish") {
      if (!inIrlBear && !inOteBear) return { direction: null };
      const irlBonus = inIrlBear ? 1.5 : 0;
      const oteBonus = inOteBear ? 1 : 0;
      const baseScore = latestPoint.level + (latestPoint.divergence_confirmed ? 1 : 0);
      return {
        direction: "short",
        score: Math.min(10, baseScore + irlBonus + oteBonus),
        entry_type: inIrlBear ? "CHAN_I2E" : "CHAN_OTE"
      };
    }
  }
  if (zh && !result.in_zhongshu) {
    if (result.trend === "bullish" && close > zh.top * 1.002 && result.divergence_signals?.type !== "top") {
      if (!inIrlBull && !inOteBull) return { direction: null };
      const oteBonus = inOteBull ? 1 : 0;
      const irlBonus = inIrlBull ? 1 : 0;
      return { direction: "long", score: 6.5 + oteBonus + irlBonus, entry_type: "CHAN_ZH_BREAK" };
    }
    if (result.trend === "bearish" && close < zh.bottom * 0.998 && result.divergence_signals?.type !== "bottom") {
      if (!inIrlBear && !inOteBear) return { direction: null };
      const oteBonus = inOteBear ? 1 : 0;
      const irlBonus = inIrlBear ? 1 : 0;
      return { direction: "short", score: 6.5 + oteBonus + irlBonus, entry_type: "CHAN_ZH_BREAK" };
    }
  }
  return { direction: null };
}
function signalLiquiditySweep(i, candles, atrArr, ema200) {
  if (i < 20 || isNaN(atrArr[i]) || isNaN(ema200[i])) return { direction: null };
  const atr = atrArr[i];
  const c = candles[i];
  let swingHigh = -Infinity, swingLow = Infinity;
  for (let j = i - 15; j <= i - 3; j++) {
    if (j < 2) continue;
    const cj = candles[j];
    if (cj.high > candles[j - 1].high && cj.high > candles[j - 2].high && cj.high > candles[j + 1].high && cj.high > candles[j + 2].high) {
      if (cj.high > swingHigh) swingHigh = cj.high;
    }
    if (cj.low < candles[j - 1].low && cj.low < candles[j - 2].low && cj.low < candles[j + 1].low && cj.low < candles[j + 2].low) {
      if (cj.low < swingLow) swingLow = cj.low;
    }
  }
  if (swingHigh === -Infinity || swingLow === Infinity) return { direction: null };
  const sweepLow = c.low < swingLow - atr * 0.1 && c.close > swingLow && c.close > c.open;
  const sweepHigh = c.high > swingHigh + atr * 0.1 && c.close < swingHigh && c.close < c.open;
  if (sweepLow && c.close > ema200[i]) return { direction: "long" };
  if (sweepHigh && c.close < ema200[i]) return { direction: "short" };
  return { direction: null };
}
function signalVwapReversion(i, candles, atrArr, adxArr) {
  if (i < 20 || isNaN(atrArr[i]) || isNaN(adxArr[i])) return { direction: null };
  if (adxArr[i] >= 25) return { direction: null };
  const totalCandles = candles.length;
  let sessionLen = 24;
  if (totalCandles > 1e3) sessionLen = 1440;
  else if (totalCandles > 500) sessionLen = 288;
  else if (totalCandles > 200) sessionLen = 96;
  else if (totalCandles > 100) sessionLen = 24;
  else sessionLen = 6;
  const sessionStart = Math.max(0, i - sessionLen + 1);
  let cumPV = 0, cumVol = 0;
  for (let j = sessionStart; j <= i; j++) {
    const typical = (candles[j].high + candles[j].low + candles[j].close) / 3;
    const vol = candles[j].volume ?? 1;
    cumPV += typical * vol;
    cumVol += vol;
  }
  const vwap = cumVol > 0 ? cumPV / cumVol : candles[i].close;
  const prices = candles.slice(sessionStart, i + 1).map((c2) => (c2.high + c2.low + c2.close) / 3);
  const variance = prices.reduce((sum, p) => sum + (p - vwap) ** 2, 0) / prices.length;
  const stdDev = Math.sqrt(variance) || atrArr[i];
  const close = candles[i].close;
  const zScore = (close - vwap) / stdDev;
  let vwapSlope = 0;
  if (sessionStart + 5 <= i) {
    let prevCumPV = 0, prevCumVol = 0;
    for (let j = sessionStart; j <= i - 5; j++) {
      const typical = (candles[j].high + candles[j].low + candles[j].close) / 3;
      const vol = candles[j].volume ?? 1;
      prevCumPV += typical * vol;
      prevCumVol += vol;
    }
    const prevVwap = prevCumVol > 0 ? prevCumPV / prevCumVol : vwap;
    vwapSlope = (vwap - prevVwap) / (prevVwap || 1);
  }
  if (Math.abs(vwapSlope) > 5e-3) return { direction: null };
  const c = candles[i];
  if (zScore <= -2 && c.close > c.open) return { direction: "long" };
  if (zScore >= 2 && c.close < c.open) return { direction: "short" };
  return { direction: null };
}
function signalComposite(i, candles, closes, rsi, ema20, ema50, ema200, macdHist, plusDi, minusDi, atrArr) {
  if (i < 80 || isNaN(ema200[i]) || isNaN(rsi[i]) || !atrArr[i]) return { direction: null };
  const close = closes[i];
  const atr = atrArr[i];
  const smcSignal = signalSmc(i, candles, ema200);
  const paSignal = signalPa(i, candles, closes, rsi, ema20, ema50, ema200, macdHist, plusDi, minusDi);
  const chanSignal = signalChan(i, candles);
  const lookback = Math.min(60, i);
  const swingSlice = candles.slice(i - lookback, i + 1);
  const swingHigh = Math.max(...swingSlice.map((c) => c.high));
  const swingLow = Math.min(...swingSlice.map((c) => c.low));
  const swingRange = swingHigh - swingLow;
  const fibRatio = swingRange > 0 ? (close - swingLow) / swingRange : 0.5;
  const avgVol = candles.slice(Math.max(0, i - 20), i).reduce((sum, c) => sum + c.volume, 0) / Math.max(1, Math.min(20, i));
  const hasVolume = candles[i].volume >= avgVol * 0.95;
  const bullishRegime = close >= ema200[i] * 0.995 && (!isNaN(ema20[i]) && !isNaN(ema50[i]) ? ema20[i] >= ema50[i] : true);
  const bearishRegime = close <= ema200[i] * 1.005 && (!isNaN(ema20[i]) && !isNaN(ema50[i]) ? ema20[i] <= ema50[i] : true);
  const momentumLong = (!isNaN(plusDi[i]) && !isNaN(minusDi[i]) ? plusDi[i] >= minusDi[i] : true) && (isNaN(macdHist[i]) || macdHist[i] >= (macdHist[i - 1] ?? macdHist[i]));
  const momentumShort = (!isNaN(plusDi[i]) && !isNaN(minusDi[i]) ? minusDi[i] >= plusDi[i] : true) && (isNaN(macdHist[i]) || macdHist[i] <= (macdHist[i - 1] ?? macdHist[i]));
  let longScore = 0;
  let shortScore = 0;
  if (smcSignal.direction === "long") longScore += 0.35;
  if (smcSignal.direction === "short") shortScore += 0.35;
  if (paSignal.direction === "long") longScore += 0.25;
  if (paSignal.direction === "short") shortScore += 0.25;
  if (chanSignal.direction === "long") longScore += 0.2;
  if (chanSignal.direction === "short") shortScore += 0.2;
  if (fibRatio >= 0.45 && fibRatio <= 0.72 && bullishRegime) longScore += 0.1;
  if (fibRatio >= 0.28 && fibRatio <= 0.55 && bearishRegime) shortScore += 0.1;
  if (bullishRegime && momentumLong) longScore += 0.1;
  if (bearishRegime && momentumShort) shortScore += 0.1;
  const longConflict = shortScore >= 0.35;
  const shortConflict = longScore >= 0.35;
  if (longScore >= 0.55 && !longConflict && hasVolume && rsi[i] < 72) {
    return {
      direction: "long",
      custom_sl: smcSignal.custom_sl ?? paSignal.custom_sl,
      custom_tp: smcSignal.custom_tp ?? paSignal.custom_tp,
      custom_tp2: smcSignal.custom_tp2,
      score: Math.round(longScore * 100) / 10,
      pivot_low: detectPivotLow(candles, i, 20, 2) ?? void 0
    };
  }
  if (shortScore >= 0.55 && !shortConflict && hasVolume && rsi[i] > 28) {
    return {
      direction: "short",
      custom_sl: smcSignal.custom_sl ?? paSignal.custom_sl,
      custom_tp: smcSignal.custom_tp ?? paSignal.custom_tp,
      custom_tp2: smcSignal.custom_tp2,
      score: Math.round(shortScore * 100) / 10,
      pivot_high: detectPivotHigh(candles, i, 20, 2) ?? void 0
    };
  }
  return { direction: null };
}
function signalHwrModelA(i, candles, atrArr) {
  if (i < 30 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  if (atr <= 0) return { direction: null };
  const close = candles[i].close;
  const cur = candles[i];
  const swingLookback = Math.min(20, i - 5);
  const swingSlice = candles.slice(i - swingLookback, i - 2);
  const swingLow = Math.min(...swingSlice.map((c) => c.low));
  const swingHigh = Math.max(...swingSlice.map((c) => c.high));
  let sslSwept = false, bslSwept = false;
  let sweepCandleIdx = -1;
  for (let j = i - 8; j <= i; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (c.low < swingLow && c.close > swingLow) {
      sslSwept = true;
      sweepCandleIdx = j;
      break;
    }
    if (c.high > swingHigh && c.close < swingHigh) {
      bslSwept = true;
      sweepCandleIdx = j;
      break;
    }
  }
  if (!sslSwept && !bslSwept) return { direction: null };
  const sweepDir = sslSwept ? "long" : "short";
  const sweepCandle = candles[sweepCandleIdx];
  if (sweepCandleIdx < 0) return { direction: null };
  const chochWindow = Math.min(i, sweepCandleIdx + 5);
  const postSweep = candles.slice(sweepCandleIdx, chochWindow + 1);
  let chochConfirmed = false;
  if (sweepDir === "long") {
    const prevHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map((c) => c.high));
    chochConfirmed = postSweep.some((c) => c.close > prevHigh);
  } else {
    const prevLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map((c) => c.low));
    chochConfirmed = postSweep.some((c) => c.close < prevLow);
  }
  if (!chochConfirmed) return { direction: null };
  let fvgTop = 0, fvgBottom = 0;
  for (let j = sweepCandleIdx + 1; j <= i - 1; j++) {
    const c0 = candles[j - 1], c2 = candles[j + 1];
    if (!c0 || !c2) continue;
    if (sweepDir === "long") {
      const gap = c2.low - c0.high;
      if (gap > atr * 0.05) {
        fvgTop = c2.low;
        fvgBottom = c0.high;
        break;
      }
    } else {
      const gap = c0.low - c2.high;
      if (gap > atr * 0.05) {
        fvgTop = c0.low;
        fvgBottom = c2.high;
        break;
      }
    }
  }
  if (fvgTop <= 0 || fvgBottom <= 0) return { direction: null };
  const inFvg = sweepDir === "long" && close >= fvgBottom && close <= fvgTop * 1.02 || sweepDir === "short" && close <= fvgTop && close >= fvgBottom * 0.98;
  if (!inFvg) return { direction: null };
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length : 0;
  if (avgVol > 0 && cur.volume < avgVol * 0.8) return { direction: null };
  const slBuffer = atr * 0.15;
  let sl, tp;
  if (sweepDir === "long") {
    sl = sweepCandle.low - slBuffer;
    const riskDist = close - sl;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevSwingHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map((c) => c.high));
    const dynTarget = prevSwingHigh > close + riskDist * 1 ? prevSwingHigh : close + riskDist * 2.5;
    tp = Math.min(dynTarget, close + riskDist * 3);
    tp = Math.max(tp, close + riskDist * 2);
  } else {
    sl = sweepCandle.high + slBuffer;
    const riskDist = sl - close;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevSwingLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map((c) => c.low));
    const dynTarget = prevSwingLow < close - riskDist * 1 ? prevSwingLow : close - riskDist * 2.5;
    tp = Math.max(dynTarget, close - riskDist * 3);
    tp = Math.min(tp, close - riskDist * 2);
  }
  return {
    direction: sweepDir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: "ModelA_v2_SMC"
  };
}
var hwrEliteDailyTracker = /* @__PURE__ */ new Map();
function signalHwrModelAElite(i, candles, atrArr, adxArr, ema20, ema50, ema200) {
  if (i < 30 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  if (atr <= 0) return { direction: null };
  const close = candles[i].close;
  const cur = candles[i];
  const e20 = ema20[i] ?? 0;
  const e50 = ema50[i] ?? 0;
  const e200 = ema200[i] ?? 0;
  if (isNaN(e20) || isNaN(e50) || e20 === 0 || e50 === 0) return { direction: null };
  const emaBull = e20 > e50;
  const emaBear = e20 < e50;
  if (Math.abs(e20 - e50) / e50 < 5e-4) return { direction: null };
  if (e200 > 0 && !isNaN(e200)) {
    if (emaBull && e50 < e200) return { direction: null };
    if (emaBear && e50 > e200) return { direction: null };
  }
  const adx = adxArr[i] ?? 0;
  if (!isNaN(adx) && adx > 0 && adx < 18) return { direction: null };
  const swingLookback = Math.min(20, i - 5);
  const swingSlice = candles.slice(i - swingLookback, i - 2);
  const swingLow = Math.min(...swingSlice.map((c) => c.low));
  const swingHigh = Math.max(...swingSlice.map((c) => c.high));
  let sslSwept = false, bslSwept = false;
  let sweepCandleIdx = -1;
  for (let j = i - 8; j <= i; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (c.low < swingLow && c.close > swingLow) {
      sslSwept = true;
      sweepCandleIdx = j;
      break;
    }
    if (c.high > swingHigh && c.close < swingHigh) {
      bslSwept = true;
      sweepCandleIdx = j;
      break;
    }
  }
  if (!sslSwept && !bslSwept) return { direction: null };
  const sweepDir = sslSwept ? "long" : "short";
  const sweepCandle = candles[sweepCandleIdx];
  if (sweepDir === "long" && !emaBull) return { direction: null };
  if (sweepDir === "short" && !emaBear) return { direction: null };
  if (sweepCandleIdx < 0) return { direction: null };
  const chochWindow = Math.min(i, sweepCandleIdx + 5);
  const postSweep = candles.slice(sweepCandleIdx, chochWindow + 1);
  let chochConfirmed = false;
  if (sweepDir === "long") {
    const prevHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map((c) => c.high));
    chochConfirmed = postSweep.some((c) => c.close > prevHigh);
  } else {
    const prevLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map((c) => c.low));
    chochConfirmed = postSweep.some((c) => c.close < prevLow);
  }
  if (!chochConfirmed) return { direction: null };
  let fvgTop = 0, fvgBottom = 0;
  for (let j = sweepCandleIdx + 1; j <= i - 1; j++) {
    const c0 = candles[j - 1], c2 = candles[j + 1];
    if (!c0 || !c2) continue;
    if (sweepDir === "long") {
      const gap = c2.low - c0.high;
      if (gap > atr * 0.05) {
        fvgTop = c2.low;
        fvgBottom = c0.high;
        break;
      }
    } else {
      const gap = c0.low - c2.high;
      if (gap > atr * 0.05) {
        fvgTop = c0.low;
        fvgBottom = c2.high;
        break;
      }
    }
  }
  if (fvgTop <= 0 || fvgBottom <= 0) return { direction: null };
  const inFvg = sweepDir === "long" && close >= fvgBottom && close <= fvgTop * 1.02 || sweepDir === "short" && close <= fvgTop && close >= fvgBottom * 0.98;
  if (!inFvg) return { direction: null };
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length : 0;
  if (avgVol > 0 && cur.volume < avgVol * 0.8) return { direction: null };
  const slBuffer = atr * 0.15;
  let sl, tp;
  if (sweepDir === "long") {
    sl = sweepCandle.low - slBuffer;
    const riskDist = close - sl;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevSwingHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map((c) => c.high));
    const dynTarget = prevSwingHigh > close + riskDist * 1 ? prevSwingHigh : close + riskDist * 2.5;
    tp = Math.min(dynTarget, close + riskDist * 3);
    tp = Math.max(tp, close + riskDist * 2);
    if ((tp - close) / riskDist < 2) return { direction: null };
  } else {
    sl = sweepCandle.high + slBuffer;
    const riskDist = sl - close;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevSwingLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map((c) => c.low));
    const dynTarget = prevSwingLow < close - riskDist * 1 ? prevSwingLow : close - riskDist * 2.5;
    tp = Math.max(dynTarget, close - riskDist * 3);
    tp = Math.min(tp, close - riskDist * 2);
    if ((close - tp) / riskDist < 2) return { direction: null };
  }
  const dayKey = new Date(cur.time * 1e3).toISOString().slice(0, 10);
  const todayCount = hwrEliteDailyTracker.get(dayKey) ?? 0;
  if (todayCount >= 1) return { direction: null };
  hwrEliteDailyTracker.set(dayKey, todayCount + 1);
  return {
    direction: sweepDir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: "HWR_A_Elite"
  };
}
function signalHwrModelB(i, candles, ema50, atrArr, adxArr) {
  if (i < 50 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  const adx = adxArr[i] ?? 0;
  if (atr <= 0 || adx < 25) return { direction: null };
  const close = candles[i].close;
  const ema = ema50[i];
  if (isNaN(ema)) return { direction: null };
  const ema50Slope5 = ema50[i] - ema50[Math.max(0, i - 5)];
  const ema50Slope3 = ema50[i] - ema50[Math.max(0, i - 3)];
  const trendUp = close > ema && ema50Slope5 > 0 && ema50Slope3 > 0;
  const trendDown = close < ema && ema50Slope5 < 0 && ema50Slope3 < 0;
  if (!trendUp && !trendDown) return { direction: null };
  const dir = trendUp ? "long" : "short";
  if (dir === "short" && ema50Slope5 > 0) return { direction: null };
  const lookback = Math.min(50, i);
  let swingHigh = -Infinity, swingLow = Infinity;
  for (let j = i - lookback + 3; j <= i - 3; j++) {
    if (j < 3) continue;
    const c = candles[j];
    if (c.high > candles[j - 1].high && c.high > candles[j - 2].high && c.high > candles[j - 3].high && c.high > candles[j + 1].high && c.high > candles[j + 2].high && c.high > candles[j + 3].high) {
      if (c.high > swingHigh) swingHigh = c.high;
    }
    if (c.low < candles[j - 1].low && c.low < candles[j - 2].low && c.low < candles[j - 3].low && c.low < candles[j + 1].low && c.low < candles[j + 2].low && c.low < candles[j + 3].low) {
      if (c.low < swingLow) swingLow = c.low;
    }
  }
  if (swingHigh === -Infinity) swingHigh = Math.max(...candles.slice(i - lookback, i + 1).map((c) => c.high));
  if (swingLow === Infinity) swingLow = Math.min(...candles.slice(i - lookback, i + 1).map((c) => c.low));
  const range = swingHigh - swingLow;
  if (range <= 0) return { direction: null };
  let fib618, fib786;
  if (dir === "long") {
    fib618 = swingHigh - range * 0.618;
    fib786 = swingHigh - range * 0.786;
  } else {
    fib618 = swingLow + range * 0.618;
    fib786 = swingLow + range * 0.786;
  }
  const oteTop = Math.max(fib618, fib786);
  const oteBottom = Math.min(fib618, fib786);
  const inOte = close >= oteBottom * 0.995 && close <= oteTop * 1.005;
  if (!inOte) return { direction: null };
  let hasFvg = false;
  for (let j = Math.max(1, i - 20); j <= i - 1; j++) {
    const c0 = candles[j - 1], c2 = candles[j + 1];
    if (!c0 || !c2) continue;
    if (dir === "long") {
      const gapTop = c2.low;
      const gapBottom = c0.high;
      const gap = gapTop - gapBottom;
      if (gap > atr * 0.1 && gapTop >= oteBottom && gapBottom <= oteTop) {
        let mitigated = false;
        const fvgMid = (gapTop + gapBottom) / 2;
        for (let k = j + 2; k <= i; k++) {
          if (candles[k].low <= fvgMid) {
            mitigated = true;
            break;
          }
        }
        if (!mitigated) {
          hasFvg = true;
          break;
        }
      }
    } else {
      const gapTop = c0.low;
      const gapBottom = c2.high;
      const gap = gapTop - gapBottom;
      if (gap > atr * 0.1 && gapTop <= oteTop && gapBottom >= oteBottom) {
        let mitigated = false;
        const fvgMid = (gapTop + gapBottom) / 2;
        for (let k = j + 2; k <= i; k++) {
          if (candles[k].high >= fvgMid) {
            mitigated = true;
            break;
          }
        }
        if (!mitigated) {
          hasFvg = true;
          break;
        }
      }
    }
  }
  const slBuffer = atr * 0.5;
  let sl, tp;
  if (dir === "long") {
    sl = oteBottom - slBuffer;
    const riskDist = close - sl;
    tp = close + riskDist * 2;
  } else {
    sl = oteTop + slBuffer;
    const riskDist = sl - close;
    tp = close - riskDist * 2;
  }
  const oteScore = inOte ? 5 : 3;
  const fvgScore = hasFvg ? 3 : 0;
  const adxScore = adx > 40 ? 2 : adx > 30 ? 1 : 0;
  const hwrBScore = Math.min(10, oteScore + fvgScore + adxScore);
  return {
    direction: dir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: hasFvg ? "ModelB_OTE+FVG" : "ModelB_OTE",
    score: hwrBScore
  };
}
function signalHwrModelC(i, candles, atrArr) {
  if (i < 30 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  if (atr <= 0) return { direction: null };
  const close = candles[i].close;
  const lookback = Math.min(30, i);
  const slice = candles.slice(i - lookback, i + 1);
  const highs = slice.map((c) => c.high).sort((a, b) => b - a);
  const lows = slice.map((c) => c.low).sort((a, b) => a - b);
  const topCount = Math.max(1, Math.floor(slice.length / 4));
  const zsTop = highs.slice(0, topCount).reduce((s, v) => s + v, 0) / topCount;
  const zsBottom = lows.slice(0, topCount).reduce((s, v) => s + v, 0) / topCount;
  const zsHeight = zsTop - zsBottom;
  if (zsHeight < atr * 1.5) return { direction: null };
  const nearTopThreshold = atr * 0.5;
  const nearBottomThreshold = atr * 0.5;
  const nearTop = Math.abs(close - zsTop) < nearTopThreshold;
  const nearBottom = Math.abs(close - zsBottom) < nearBottomThreshold;
  if (!nearTop && !nearBottom) return { direction: null };
  const dir = nearBottom ? "long" : "short";
  const ema50Arr = calcEmaArr(candles.map((c) => c.close), 50);
  const ema50Now = ema50Arr[i];
  const ema50Slope = !isNaN(ema50Now) ? ema50Now - (ema50Arr[Math.max(0, i - 5)] ?? ema50Now) : 0;
  if (dir === "short" && ema50Slope > 0) return { direction: null };
  const prev3 = candles.slice(Math.max(0, i - 3), i + 1);
  let paConfirm = false;
  if (dir === "long") {
    paConfirm = prev3.some((c) => c.low < zsBottom && c.close > zsBottom);
  } else {
    paConfirm = prev3.some((c) => c.high > zsTop && c.close < zsTop);
  }
  if (!paConfirm) return { direction: null };
  const slBuffer = atr * 0.5;
  let sl, tp;
  if (dir === "long") {
    sl = zsBottom - slBuffer;
    tp = zsTop;
  } else {
    sl = zsTop + slBuffer;
    tp = zsBottom;
  }
  const riskDist = Math.abs(close - sl);
  const rewardDist = Math.abs(tp - close);
  if (riskDist <= 0 || rewardDist / riskDist < 1.2) return { direction: null };
  return {
    direction: dir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: "ModelC_ZS"
  };
}
function signalCannonball(i, candles, ema50, atrArr) {
  if (i < 120 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  const close = candles[i].close;
  if (!Number.isFinite(atr) || atr <= 0 || !Number.isFinite(close)) return { direction: null };
  const slice = candles.slice(Math.max(0, i - 180), i + 1);
  if (slice.length < 80) return { direction: null };
  const structure = detectBosChoch(slice);
  const confirmedEvents = structure.events.filter((e) => e.confirmed);
  const lastEvent = confirmedEvents[confirmedEvents.length - 1];
  if (!lastEvent || lastEvent.direction !== "bullish" && lastEvent.direction !== "bearish") return { direction: null };
  const direction = lastEvent.direction === "bullish" ? "long" : "short";
  const obs = detectOrderBlocks(slice, close);
  const zone = direction === "long" ? obs.nearestBull : obs.nearestBear;
  if (!zone) return { direction: null };
  const swingHighs = findSwingHighs(slice, 5).slice(-8);
  const swingLows = findSwingLows(slice, 5).slice(-8);
  const recent20 = slice.slice(-21, -1);
  const avgVol = recent20.length > 0 ? recent20.reduce((sum, c) => sum + c.volume, 0) / recent20.length : slice[slice.length - 1].volume || 1;
  const rvol = avgVol > 0 ? (slice[slice.length - 1].volume || 0) / avgVol : 1;
  const recent5 = slice.slice(-5);
  const upBars = recent5.filter((c) => c.close > c.open).length;
  const downBars = recent5.filter((c) => c.close < c.open).length;
  const moneyFlowScore = rvol * 35 + upBars / 5 * 35 + (close - slice[Math.max(0, slice.length - 6)].close) / (atr || 1) * 10;
  const priceNearZone = direction === "long" ? close <= zone.top + atr * 0.8 : close >= zone.bottom - atr * 0.8;
  if (direction === "long") {
    if (!priceNearZone || close <= (ema50[i] ?? close) || upBars < 3 || moneyFlowScore < 45) return { direction: null };
    const pivotLow = swingLows[swingLows.length - 1]?.price ?? zone.bottom;
    const sl2 = Math.min(zone.bottom, pivotLow) - atr * 0.3;
    const risk2 = close - sl2;
    if (risk2 <= atr * 0.25) return { direction: null };
    const target1Base2 = swingHighs[swingHighs.length - 1]?.price ?? close + risk2 * 1.6;
    const tp12 = Math.max(close + risk2 * 1.2, target1Base2);
    const tp22 = Math.max(close + atr * 2.5, close + risk2 * 2.4);
    return { direction: "long", custom_sl: sl2, custom_tp: tp12, custom_tp2: tp22, entry_type: "CannonBall_OB", score: Math.min(10, Math.round(moneyFlowScore / 10 * 10) / 10) };
  }
  if (!priceNearZone || close >= (ema50[i] ?? close) || downBars < 3 || rvol * 35 + downBars / 5 * 35 < 45) return { direction: null };
  const pivotHigh = swingHighs[swingHighs.length - 1]?.price ?? zone.top;
  const sl = Math.max(zone.top, pivotHigh) + atr * 0.3;
  const risk = sl - close;
  if (risk <= atr * 0.25) return { direction: null };
  const target1Base = swingLows[swingLows.length - 1]?.price ?? close - risk * 1.6;
  const tp1 = Math.min(close - risk * 1.2, target1Base);
  const tp2 = Math.min(close - atr * 2.5, close - risk * 2.4);
  return { direction: "short", custom_sl: sl, custom_tp: tp1, custom_tp2: tp2, entry_type: "CannonBall_OB", score: Math.min(10, Math.round((rvol * 35 + downBars / 5 * 35) / 10 * 10) / 10) };
}
function signalApex(i, candles, atrArr, adxArr, htfCandles) {
  if (i < 50 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  const adx = adxArr[i] ?? 0;
  if (atr <= 0) return { direction: null };
  if (adx < 12) return { direction: null };
  const close = candles[i].close;
  const cur = candles[i];
  const current_time = cur.time;
  let htfBullish = null;
  if (i >= 50) {
    const closes50 = candles.slice(i - 50, i + 1).map((c) => c.close);
    let ema50val = closes50[0];
    const k50 = 2 / 51;
    for (let x = 1; x < closes50.length; x++) ema50val = closes50[x] * k50 + ema50val * (1 - k50);
    htfBullish = close > ema50val;
  } else if (htfCandles && htfCandles.length >= 50) {
    const available = htfCandles.filter((c) => c.time <= current_time);
    if (available.length >= 50) {
      const htfCloses = available.slice(-50).map((c) => c.close);
      let ema50h = htfCloses[0];
      const kh = 2 / 51;
      for (let x = 1; x < htfCloses.length; x++) ema50h = htfCloses[x] * kh + ema50h * (1 - kh);
      htfBullish = available[available.length - 1].close > ema50h;
    }
  }
  const swingLookback = Math.min(40, i - 20);
  if (swingLookback < 5) return { direction: null };
  const swingSlice = candles.slice(i - swingLookback, i - 5);
  if (swingSlice.length < 5) return { direction: null };
  const swingLow = Math.min(...swingSlice.map((c) => c.low));
  const swingHigh = Math.max(...swingSlice.map((c) => c.high));
  let sweepDir = null;
  let sweepIdx = -1;
  let sweepExtreme = 0;
  for (let j = i - 20; j <= i - 2; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (c.low < swingLow - atr * 0.02 && c.close > swingLow - atr * 0.1) {
      sweepDir = "long";
      sweepIdx = j;
      sweepExtreme = c.low;
      break;
    }
    if (c.high > swingHigh + atr * 0.02 && c.close < swingHigh + atr * 0.1) {
      sweepDir = "short";
      sweepIdx = j;
      sweepExtreme = c.high;
      break;
    }
  }
  if (!sweepDir || sweepIdx < 0) return { direction: null };
  if (htfBullish !== null) {
    if (sweepDir === "long" && !htfBullish) return { direction: null };
    if (sweepDir === "short" && htfBullish) return { direction: null };
  }
  const chochEnd = Math.min(i, sweepIdx + 8);
  const preSweepSlice = candles.slice(Math.max(0, sweepIdx - 6), sweepIdx);
  if (preSweepSlice.length < 2) return { direction: null };
  const prevHigh = Math.max(...preSweepSlice.map((c) => c.high));
  const prevLow = Math.min(...preSweepSlice.map((c) => c.low));
  let chochConfirmed = false;
  for (let j = sweepIdx + 1; j <= chochEnd; j++) {
    if (j >= candles.length) break;
    const c = candles[j];
    if (sweepDir === "long" && c.close > prevHigh) {
      chochConfirmed = true;
      break;
    }
    if (sweepDir === "short" && c.close < prevLow) {
      chochConfirmed = true;
      break;
    }
  }
  if (!chochConfirmed) return { direction: null };
  let fvgTop = 0, fvgBottom = 0;
  for (let j = sweepIdx + 1; j <= i - 1; j++) {
    if (j < 1 || j + 1 >= candles.length) continue;
    const c0 = candles[j - 1];
    const c2 = candles[j + 1];
    if (sweepDir === "long") {
      const gap = c2.low - c0.high;
      if (gap > atr * 0.03) {
        fvgBottom = c0.high;
        fvgTop = c2.low;
        break;
      }
    } else {
      const gap = c0.low - c2.high;
      if (gap > atr * 0.03) {
        fvgBottom = c2.high;
        fvgTop = c0.low;
        break;
      }
    }
  }
  if (fvgTop <= 0 || fvgBottom <= 0) return { direction: null };
  let inEntryZone = false;
  if (sweepDir === "long" && close >= fvgBottom - atr * 0.3 && close <= fvgTop + atr * 0.3) inEntryZone = true;
  if (sweepDir === "short" && close <= fvgTop + atr * 0.3 && close >= fvgBottom - atr * 0.3) inEntryZone = true;
  if (!inEntryZone) return { direction: null };
  const bodySize = Math.abs(cur.close - cur.open);
  const totalRange = cur.high - cur.low;
  const upperWick = cur.high - Math.max(cur.open, cur.close);
  const lowerWick = Math.min(cur.open, cur.close) - cur.low;
  const isBullish = cur.close > cur.open;
  const isBearish = cur.close < cur.open;
  if (sweepDir === "long" && isBearish && bodySize > totalRange * 0.65) return { direction: null };
  if (sweepDir === "short" && isBullish && bodySize > totalRange * 0.65) return { direction: null };
  const prevC = candles[i - 1];
  const isBullEngulf = isBullish && cur.open < prevC.close && cur.close > prevC.open;
  const isPinBarBull = lowerWick > bodySize * 1.5 && lowerWick > totalRange * 0.4;
  const isBearEngulf = isBearish && cur.open > prevC.close && cur.close < prevC.open;
  const isPinBarBear = upperWick > bodySize * 1.5 && upperWick > totalRange * 0.4;
  const hasConfirmCandle = sweepDir === "long" ? isBullEngulf || isPinBarBull : isBearEngulf || isPinBarBear;
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length : 0;
  if (avgVol > 0 && cur.volume < avgVol * 0.7) return { direction: null };
  const slBuffer = atr * 0.15;
  let sl, tp;
  if (sweepDir === "long") {
    sl = sweepExtreme - slBuffer;
    const risk = close - sl;
    if (risk <= 0 || risk > atr * 5) return { direction: null };
    const prevSwingHigh = Math.max(...candles.slice(Math.max(0, sweepIdx - 20), sweepIdx).map((c) => c.high));
    const dynamicTarget = prevSwingHigh > close + risk * 1 ? prevSwingHigh : close + risk * 2.5;
    tp = Math.min(dynamicTarget, close + risk * 3);
    tp = Math.max(tp, close + risk * 2);
  } else {
    sl = sweepExtreme + slBuffer;
    const risk = sl - close;
    if (risk <= 0 || risk > atr * 5) return { direction: null };
    const prevSwingLow = Math.min(...candles.slice(Math.max(0, sweepIdx - 20), sweepIdx).map((c) => c.low));
    const dynamicTarget = prevSwingLow < close - risk * 1 ? prevSwingLow : close - risk * 2.5;
    tp = Math.max(dynamicTarget, close - risk * 3);
    tp = Math.min(tp, close - risk * 2);
  }
  return {
    direction: sweepDir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: hasConfirmCandle ? "Apex_5L_Confirmed" : "Apex_5L"
  };
}
var eliteDailyTracker = /* @__PURE__ */ new Map();
function signalElite(i, candles, atrArr, adxArr, ema20, ema50, ema200) {
  if (i < 50 || i + 1 >= candles.length) return { direction: null };
  const atr = atrArr[i] ?? 0;
  if (atr <= 0) return { direction: null };
  const cur = candles[i];
  const close = cur.close;
  const e20 = ema20[i] ?? 0;
  const e50 = ema50[i] ?? 0;
  const e200 = ema200[i] ?? 0;
  const emaBull = e20 > e50 && close > e200;
  const emaBear = e20 < e50 && close < e200;
  if (!emaBull && !emaBear) return { direction: null };
  const trendDir = emaBull ? "long" : "short";
  const adx = adxArr[i] ?? 0;
  if (adx < 20) return { direction: null };
  const swingLookback = Math.min(25, i - 5);
  const swingSlice = candles.slice(i - swingLookback, i - 2);
  const swingLow = Math.min(...swingSlice.map((c) => c.low));
  const swingHigh = Math.max(...swingSlice.map((c) => c.high));
  let sweepCandleIdx = -1;
  let sweepCandle = null;
  for (let j = i - 12; j <= i - 1; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (trendDir === "long" && c.low < swingLow && c.close > swingLow) {
      sweepCandleIdx = j;
      sweepCandle = c;
      break;
    }
    if (trendDir === "short" && c.high > swingHigh && c.close < swingHigh) {
      sweepCandleIdx = j;
      sweepCandle = c;
      break;
    }
  }
  if (sweepCandleIdx < 0 || !sweepCandle) return { direction: null };
  const prevRef5High = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map((c) => c.high));
  const prevRef5Low = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 5), sweepCandleIdx).map((c) => c.low));
  let chochConfirmed = false;
  for (let k = sweepCandleIdx + 1; k <= Math.min(i, sweepCandleIdx + 6); k++) {
    if (trendDir === "long" && candles[k].close > prevRef5High) {
      chochConfirmed = true;
      break;
    }
    if (trendDir === "short" && candles[k].close < prevRef5Low) {
      chochConfirmed = true;
      break;
    }
  }
  if (!chochConfirmed) return { direction: null };
  let fvgTop = 0, fvgBottom = 0;
  for (let j = sweepCandleIdx + 1; j <= i - 1; j++) {
    const c0 = candles[j - 1], c2 = candles[j + 1];
    if (!c0 || !c2) continue;
    if (trendDir === "long") {
      const gap = c2.low - c0.high;
      if (gap > atr * 0.03) {
        fvgTop = c2.low;
        fvgBottom = c0.high;
        break;
      }
    } else {
      const gap = c0.low - c2.high;
      if (gap > atr * 0.03) {
        fvgTop = c0.low;
        fvgBottom = c2.high;
        break;
      }
    }
  }
  if (fvgTop <= 0 || fvgBottom <= 0) return { direction: null };
  const inFvg = trendDir === "long" && close >= fvgBottom - atr * 0.05 && close <= fvgTop + atr * 0.1 || trendDir === "short" && close <= fvgTop + atr * 0.05 && close >= fvgBottom - atr * 0.1;
  if (!inFvg) return { direction: null };
  const volSlice = candles.slice(Math.max(0, i - 20), i);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length : 0;
  if (avgVol > 0 && cur.volume < avgVol * 0.7) return { direction: null };
  const dayKey = new Date(cur.time * 1e3).toISOString().slice(0, 10);
  const todayCount = eliteDailyTracker.get(dayKey) ?? 0;
  if (todayCount >= 1) return { direction: null };
  eliteDailyTracker.set(dayKey, todayCount + 1);
  const slBuffer = atr * 0.12;
  let sl, tp;
  if (trendDir === "long") {
    sl = sweepCandle.low - slBuffer;
    const riskDist = close - sl;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevHigh = Math.max(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map((c) => c.high));
    const dynTp = prevHigh > close + riskDist * 0.8 ? prevHigh : close + riskDist * 2;
    tp = Math.min(dynTp, close + riskDist * 2.5);
    tp = Math.max(tp, close + riskDist * 1.5);
  } else {
    sl = sweepCandle.high + slBuffer;
    const riskDist = sl - close;
    if (riskDist <= 0 || riskDist > atr * 5) return { direction: null };
    const prevLow = Math.min(...candles.slice(Math.max(0, sweepCandleIdx - 20), sweepCandleIdx).map((c) => c.low));
    const dynTp = prevLow < close - riskDist * 0.8 ? prevLow : close - riskDist * 2;
    tp = Math.max(dynTp, close - riskDist * 2.5);
    tp = Math.min(tp, close - riskDist * 1.5);
  }
  return {
    direction: trendDir,
    custom_sl: sl,
    custom_tp: tp,
    entry_type: "Elite_v4"
  };
}
function findExitWithTrailing(candles, entryIdx, direction, sl, tp, maxBars = 48, enableTrailing = true, timeStopBars = 12) {
  const entryPrice = candles[entryIdx].open;
  const initialRisk = Math.abs(entryPrice - sl);
  if (initialRisk <= 0) return { exitIdx: entryIdx, exitPrice: entryPrice, reason: "end" };
  let currentSl = sl;
  let trailingActivated = false;
  const entryBar = candles[entryIdx];
  if (direction === "long") {
    if (entryBar.open <= sl) return { exitIdx: entryIdx, exitPrice: entryBar.open, reason: "sl" };
    if (entryBar.open >= tp) return { exitIdx: entryIdx, exitPrice: entryBar.open, reason: "tp" };
  } else {
    if (entryBar.open >= sl) return { exitIdx: entryIdx, exitPrice: entryBar.open, reason: "sl" };
    if (entryBar.open <= tp) return { exitIdx: entryIdx, exitPrice: entryBar.open, reason: "tp" };
  }
  for (let j = entryIdx + 1; j < Math.min(candles.length, entryIdx + maxBars + 1); j++) {
    const c = candles[j];
    if (direction === "long") {
      const slHit = c.low <= currentSl;
      const tpHit = c.high >= tp;
      if (slHit && tpHit) {
        const slDist = Math.abs(c.open - currentSl);
        const tpDist = Math.abs(c.open - tp);
        if (slDist <= tpDist) return { exitIdx: j, exitPrice: currentSl, reason: trailingActivated ? "trailing" : "sl" };
        return { exitIdx: j, exitPrice: tp, reason: "tp" };
      }
      if (enableTrailing && !trailingActivated && c.high >= entryPrice + initialRisk) {
        currentSl = entryPrice;
        trailingActivated = true;
      }
      if (enableTrailing && trailingActivated && c.high >= entryPrice + initialRisk * 2) {
        const newSl = entryPrice + initialRisk * 0.5;
        if (newSl > currentSl) currentSl = newSl;
      }
      if (slHit) return { exitIdx: j, exitPrice: currentSl, reason: trailingActivated ? "trailing" : "sl" };
      if (tpHit) return { exitIdx: j, exitPrice: tp, reason: "tp" };
      if (timeStopBars > 0 && j - entryIdx >= timeStopBars && !trailingActivated) {
        return { exitIdx: j, exitPrice: c.close, reason: "time_stop" };
      }
    } else {
      const slHit = c.high >= currentSl;
      const tpHit = c.low <= tp;
      if (slHit && tpHit) {
        const slDist = Math.abs(c.open - currentSl);
        const tpDist = Math.abs(c.open - tp);
        if (slDist <= tpDist) return { exitIdx: j, exitPrice: currentSl, reason: trailingActivated ? "trailing" : "sl" };
        return { exitIdx: j, exitPrice: tp, reason: "tp" };
      }
      if (enableTrailing && !trailingActivated && c.low <= entryPrice - initialRisk) {
        currentSl = entryPrice;
        trailingActivated = true;
      }
      if (enableTrailing && trailingActivated && c.low <= entryPrice - initialRisk * 2) {
        const newSl = entryPrice - initialRisk * 0.5;
        if (newSl < currentSl) currentSl = newSl;
      }
      if (slHit) return { exitIdx: j, exitPrice: currentSl, reason: trailingActivated ? "trailing" : "sl" };
      if (tpHit) return { exitIdx: j, exitPrice: tp, reason: "tp" };
      if (timeStopBars > 0 && j - entryIdx >= timeStopBars && !trailingActivated) {
        return { exitIdx: j, exitPrice: c.close, reason: "time_stop" };
      }
    }
  }
  const lastIdx = Math.min(candles.length - 1, entryIdx + maxBars);
  return { exitIdx: lastIdx, exitPrice: candles[lastIdx].close, reason: "end" };
}
function calcStats(trades, intervalHours = 4) {
  if (trades.length === 0) {
    return {
      win_rate: 0,
      profit_factor: 0,
      max_drawdown: 0,
      total_return: 0,
      total_return_net: 0,
      sharpe_ratio: 0,
      sortino_ratio: 0,
      calmar_ratio: 0,
      equity_curve: [1],
      monthly_stats: [],
      max_win_streak: 0,
      max_loss_streak: 0,
      session_stats: [],
      drawdown_periods: [],
      total_fees_pct: 0,
      trailing_stop_count: 0
    };
  }
  let equity = 1;
  let equityNet = 1;
  let peakNet = 1;
  let maxDd = 0;
  let totalWin = 0, totalLoss = 0, wins = 0;
  let totalFees = 0;
  let trailingCount = 0;
  const equityCurve = [1];
  const returns = [];
  for (const t of trades) {
    equity *= 1 + t.pnl_pct;
    equityNet *= 1 + t.pnl_net_pct;
    if (equityNet > peakNet) peakNet = equityNet;
    const dd = (peakNet - equityNet) / peakNet;
    if (dd > maxDd) maxDd = dd;
    equityCurve.push(Math.round(equityNet * 1e4) / 1e4);
    returns.push(t.pnl_net_pct);
    totalFees += t.fee_pct;
    if (t.exit_reason === "trailing") trailingCount++;
    if (t.pnl_net_pct > 0) {
      wins++;
      totalWin += t.pnl_net_pct;
    } else totalLoss += Math.abs(t.pnl_net_pct);
  }
  const win_rate = wins / trades.length;
  const profit_factor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 99 : 0;
  const total_return = equity - 1;
  const total_return_net = equityNet - 1;
  const RISK_FREE_RATE_ANNUAL = 0.04;
  const startTs = trades.length > 0 ? trades[0].entry_time : 0;
  const endTs = trades.length > 0 ? trades[trades.length - 1].exit_time : 0;
  const periodYears = startTs && endTs && endTs > startTs ? (endTs - startTs) / (365.25 * 24 * 3600) : 1;
  const tradesPerYear = periodYears > 0 ? trades.length / periodYears : trades.length;
  const annualFactor = tradesPerYear > 0 ? Math.sqrt(tradesPerYear) : Math.sqrt(365 * 24 / intervalHours);
  const riskFreeRatePerTrade = RISK_FREE_RATE_ANNUAL / Math.max(tradesPerYear, 1);
  const avgRet = returns.reduce((a, b) => a + b, 0) / returns.length;
  const excessRet = avgRet - riskFreeRatePerTrade;
  const stdRet = Math.sqrt(returns.reduce((a, b) => a + (b - avgRet) ** 2, 0) / returns.length);
  const sharpe_ratio = stdRet > 0 && annualFactor > 0 ? excessRet / stdRet * annualFactor : 0;
  const downReturns = returns.filter((r) => r < riskFreeRatePerTrade);
  const downStd = downReturns.length > 0 ? Math.sqrt(downReturns.reduce((a, r) => a + Math.pow(r - riskFreeRatePerTrade, 2), 0) / downReturns.length) : 0;
  const sortino_ratio = downStd > 0 && annualFactor > 0 ? excessRet / downStd * annualFactor : 0;
  const annualReturn = periodYears > 0 ? Math.pow(1 + total_return_net, 1 / periodYears) - 1 : 0;
  const calmar_ratio = maxDd > 0 ? annualReturn / maxDd : 0;
  const monthMap = /* @__PURE__ */ new Map();
  for (const t of trades) {
    const d = new Date(t.entry_time * 1e3);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const m = monthMap.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
    m.trades++;
    if (t.pnl_net_pct > 0) m.wins++;
    m.pnl += t.pnl_net_pct;
    monthMap.set(key, m);
  }
  const monthly_stats = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => ({
    month,
    trades: m.trades,
    wins: m.wins,
    win_rate: Math.round(m.wins / m.trades * 1e3) / 1e3,
    pnl_pct: Math.round(m.pnl * 1e4) / 1e4
  }));
  let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
  for (const t of trades) {
    if (t.pnl_net_pct > 0) {
      curWin++;
      curLoss = 0;
      if (curWin > maxWinStreak) maxWinStreak = curWin;
    } else {
      curLoss++;
      curWin = 0;
      if (curLoss > maxLossStreak) maxLossStreak = curLoss;
    }
  }
  function classifySession(utcHour) {
    if (utcHour >= 0 && utcHour < 8) return "\u4E9E\u6D32\u76E4";
    if (utcHour >= 8 && utcHour < 13) return "\u6B50\u6D32\u76E4";
    if (utcHour >= 13 && utcHour < 21) return "\u7F8E\u6D32\u76E4";
    return "\u5176\u4ED6";
  }
  const sessionMap = /* @__PURE__ */ new Map([
    ["\u4E9E\u6D32\u76E4", { trades: 0, wins: 0, pnl: 0 }],
    ["\u6B50\u6D32\u76E4", { trades: 0, wins: 0, pnl: 0 }],
    ["\u7F8E\u6D32\u76E4", { trades: 0, wins: 0, pnl: 0 }],
    ["\u5176\u4ED6", { trades: 0, wins: 0, pnl: 0 }]
  ]);
  for (const t of trades) {
    const h = new Date(t.entry_time * 1e3).getUTCHours();
    const sessionName = classifySession(h);
    const s = sessionMap.get(sessionName);
    s.trades++;
    if (t.pnl_net_pct > 0) s.wins++;
    s.pnl += t.pnl_net_pct;
  }
  const session_stats = Array.from(sessionMap.entries()).filter(([, s]) => s.trades > 0).map(([session, s]) => ({
    session,
    trades: s.trades,
    wins: s.wins,
    win_rate: s.trades > 0 ? Math.round(s.wins / s.trades * 1e3) / 1e3 : 0,
    pnl_pct: Math.round(s.pnl * 1e4) / 1e4
  }));
  const drawdown_periods = [];
  let inDd = false, ddStart = 0, ddPeak = 1, ddDepth = 0;
  for (let i = 0; i < equityCurve.length; i++) {
    const v = equityCurve[i];
    if (v > ddPeak) {
      ddPeak = v;
      if (inDd) {
        drawdown_periods.push({ start: ddStart, end: i - 1, depth: Math.round(ddDepth * 1e3) / 1e3 });
        inDd = false;
      }
    }
    const dd = (ddPeak - v) / ddPeak;
    if (dd > 0.01 && !inDd) {
      inDd = true;
      ddStart = i;
      ddDepth = dd;
    }
    if (inDd && dd > ddDepth) ddDepth = dd;
  }
  if (inDd) drawdown_periods.push({ start: ddStart, end: equityCurve.length - 1, depth: Math.round(ddDepth * 1e3) / 1e3 });
  return {
    win_rate: Math.round(win_rate * 1e3) / 1e3,
    profit_factor: Math.round(profit_factor * 100) / 100,
    max_drawdown: Math.round(maxDd * 1e3) / 1e3,
    total_return: Math.round(total_return * 1e3) / 1e3,
    total_return_net: Math.round(total_return_net * 1e3) / 1e3,
    sharpe_ratio: Math.round(sharpe_ratio * 100) / 100,
    sortino_ratio: Math.round(sortino_ratio * 100) / 100,
    calmar_ratio: Math.round(calmar_ratio * 100) / 100,
    equity_curve: equityCurve,
    monthly_stats,
    max_win_streak: maxWinStreak,
    max_loss_streak: maxLossStreak,
    session_stats,
    drawdown_periods,
    total_fees_pct: Math.round(totalFees * 1e4) / 1e4,
    trailing_stop_count: trailingCount
  };
}
function runBacktest(params) {
  const {
    candles,
    strategy,
    symbol,
    interval,
    enable_mtf_filter = true,
    enable_fee = true,
    enable_trailing_stop = true,
    enable_adx_filter = true,
    enable_fvg_ob_filter = strategy === "smc",
    // SMC 策略預設啟用 FVG/OB
    mtf_candles,
    htf_candles,
    entry_candles,
    use_true_mtf = false,
    // v4.0 四層 MTF 共識參數
    candles_4h,
    candles_1h,
    candles_15m,
    candles_5m,
    use_quad_mtf = false,
    quad_mtf_threshold = 0.5
  } = params;
  const primaryCandles = use_quad_mtf ? candles_15m && candles_15m.length >= 50 ? candles_15m : candles : use_true_mtf && entry_candles && entry_candles.length >= 50 ? entry_candles : candles;
  const htfCandlesForFilter = use_quad_mtf ? null : use_true_mtf && htf_candles && htf_candles.length >= 50 ? htf_candles : mtf_candles && mtf_candles.length >= 50 ? mtf_candles : null;
  const slMult = params.atr_sl_mult ?? 1.5;
  const tpMult = params.atr_tp_mult ?? 3;
  if (candles.length < 50) {
    return {
      strategy,
      symbol,
      interval,
      total_trades: 0,
      win_rate: 0,
      profit_factor: 0,
      max_drawdown: 0,
      total_return: 0,
      total_return_net: 0,
      sharpe_ratio: 0,
      equity_curve: [1],
      trades: [],
      mtf_filtered_count: 0,
      total_fees_pct: 0,
      trailing_stop_count: 0,
      adx_filtered_count: 0,
      fvg_ob_entry_count: 0
    };
  }
  const closes = primaryCandles.map((c) => c.close);
  const ema20 = calcEmaArr(closes, 20);
  const ema50 = calcEmaArr(closes, 50);
  const ema200 = calcEmaArr(closes, 200);
  const rsi = calcRsiArr(closes);
  const { hist: macdHist } = calcMacdArr(closes);
  const bollArr = calcBollingerArr(closes);
  const bollUpper = bollArr.map((b) => b.upper);
  const bollLower = bollArr.map((b) => b.lower);
  const atrArr = calcAtrArr(primaryCandles);
  const { adx: adxArr, plusDi, minusDi } = calcAdxArr(primaryCandles);
  let downsampledCandles = [];
  if (enable_mtf_filter && !htfCandlesForFilter) {
    for (let i = 3; i < primaryCandles.length; i += 4) {
      downsampledCandles.push({
        time: primaryCandles[i].time,
        open: primaryCandles[i - 3].open,
        high: Math.max(...primaryCandles.slice(i - 3, i + 1).map((c) => c.high)),
        low: Math.min(...primaryCandles.slice(i - 3, i + 1).map((c) => c.low)),
        close: primaryCandles[i].close,
        volume: primaryCandles.slice(i - 3, i + 1).reduce((a, c) => a + c.volume, 0)
      });
    }
  }
  const trades = [];
  let mtfFilteredCount = 0;
  let adxFilteredCount = 0;
  let fvgObEntryCount = 0;
  let cooldownUntil = 0;
  let consecutiveLosses = 0;
  const WARMUP = 210;
  let currentRegime = "ranging";
  let regimeUpdateAt = WARMUP;
  for (let i = WARMUP; i < primaryCandles.length - 1; i++) {
    if (i < cooldownUntil) continue;
    const atr = atrArr[i];
    if (isNaN(atr) || atr <= 0) continue;
    if (i >= regimeUpdateAt) {
      currentRegime = detectRegime(primaryCandles.slice(0, i + 1));
      regimeUpdateAt = i + 50;
    }
    const dynamicThreshold = dynamicConsensusThreshold(currentRegime);
    let mtfTrend = { direction: "neutral", ema20_above_ema50: false, price_above_ema200: false, adx: 0 };
    let quadConsensus = null;
    if (enable_mtf_filter) {
      const current_time = primaryCandles[i].time;
      if (use_quad_mtf) {
        quadConsensus = calcMtfConsensus(
          candles_4h ?? null,
          candles_1h ?? null,
          candles_15m ?? null,
          candles_5m ?? null,
          current_time,
          dynamicThreshold
          // ★ 改良：使用動態門檻取代固定門檻
        );
        mtfTrend = {
          direction: quadConsensus.consensus_dir,
          ema20_above_ema50: quadConsensus.layers.find((l) => l.timeframe === "4H")?.ema_aligned ?? false,
          price_above_ema200: false,
          adx: quadConsensus.layers.find((l) => l.timeframe === "4H")?.adx ?? 0
        };
      } else if (htfCandlesForFilter && htfCandlesForFilter.length >= 50) {
        const available_htf = htfCandlesForFilter.filter((c) => c.time <= current_time);
        if (available_htf.length >= 50) mtfTrend = calcMtfTrend(available_htf);
      } else if (downsampledCandles.length >= 50) {
        const available_mtf = downsampledCandles.filter((c) => c.time <= current_time);
        if (available_mtf.length >= 50) mtfTrend = calcMtfTrend(available_mtf);
      }
    }
    let sig = { direction: null };
    switch (strategy) {
      case "ema_cross":
        sig = signalEmaCross(i, ema20, ema50);
        break;
      case "rsi_reversal":
        sig = signalRsiReversal(i, rsi, ema50, closes, primaryCandles);
        break;
      case "bollinger":
        sig = signalBollinger(i, closes, bollUpper, bollLower, ema50, rsi);
        break;
      case "macd":
        sig = signalMacd(i, macdHist, closes, ema50);
        break;
      case "smc":
        sig = signalSmc(i, primaryCandles, ema200);
        break;
      case "pa":
        sig = signalPa(i, primaryCandles, closes, rsi, ema20, ema50, ema200, macdHist, plusDi, minusDi);
        break;
      case "chan":
        sig = signalChan(i, primaryCandles);
        break;
      case "liquidity_sweep":
        sig = signalLiquiditySweep(i, primaryCandles, atrArr, ema200);
        break;
      case "vwap_reversion":
        sig = signalVwapReversion(i, primaryCandles, atrArr, adxArr);
        break;
      case "composite":
        sig = signalComposite(i, primaryCandles, closes, rsi, ema20, ema50, ema200, macdHist, plusDi, minusDi, atrArr);
        break;
      case "cannonball":
        sig = signalCannonball(i, primaryCandles, ema50, atrArr);
        break;
      // HighWinRate 模型 A/B/C（使用模型自帶 SMC SL/TP）
      case "hwr_model_a":
        sig = signalHwrModelA(i, primaryCandles, atrArr);
        break;
      case "hwr_model_b":
        sig = signalHwrModelB(i, primaryCandles, ema50, atrArr, adxArr);
        break;
      case "hwr_model_c":
        sig = signalHwrModelC(i, primaryCandles, atrArr);
        break;
      case "apex":
        sig = signalApex(i, primaryCandles, atrArr, adxArr, htfCandlesForFilter ?? void 0);
        break;
      case "elite":
        sig = signalElite(i, primaryCandles, atrArr, adxArr, ema20, ema50, ema200);
        break;
      case "hwr_model_a_elite":
        sig = signalHwrModelAElite(i, primaryCandles, atrArr, adxArr, ema20, ema50, ema200);
        break;
    }
    if (!sig.direction) continue;
    const isHwrModel = ["hwr_model_a", "hwr_model_a_elite", "hwr_model_b", "hwr_model_c", "apex", "elite"].includes(strategy);
    const isTrendStrategy = ["ema_cross", "macd", "smc", "pa", "chan", "liquidity_sweep", "composite"].includes(strategy);
    if (!isHwrModel && enable_adx_filter && isTrendStrategy && !isNaN(adxArr[i]) && adxArr[i] < 20) {
      adxFilteredCount++;
      continue;
    }
    let mtfPassed = true;
    if (!isHwrModel && enable_mtf_filter && mtfTrend.direction !== "neutral") {
      if (sig.direction === "long" && mtfTrend.direction === "bearish") {
        mtfFilteredCount++;
        mtfPassed = false;
      }
      if (sig.direction === "short" && mtfTrend.direction === "bullish") {
        mtfFilteredCount++;
        mtfPassed = false;
      }
    }
    if (!mtfPassed) continue;
    let entryType = sig.entry_type ?? "Standard";
    const skipExternalFvgObFilter = isHwrModel || strategy === "smc" || strategy === "pa" || strategy === "chan" || strategy === "composite";
    if (!skipExternalFvgObFilter && enable_fvg_ob_filter) {
      const fvgObCheck = checkFvgObEntry(primaryCandles, i, sig.direction);
      if (!fvgObCheck.inZone) continue;
      entryType = fvgObCheck.type;
      fvgObEntryCount++;
    }
    const entryPrice = primaryCandles[i + 1].open;
    let sl, tp;
    const hasCustomLevels = sig.custom_sl !== void 0 && sig.custom_tp !== void 0;
    if ((isHwrModel || strategy === "cannonball") && hasCustomLevels) {
      sl = sig.custom_sl;
      tp = sig.custom_tp;
    } else {
      let currentSlMult = Math.min(slMult, 1.5);
      let currentTpMult = tpMult;
      const currentAdx = adxArr[i] ?? 0;
      if (currentAdx > 30) {
        currentTpMult = Math.max(tpMult * 2.5, 0.5);
      } else if (currentAdx > 25) {
        currentTpMult = Math.max(tpMult * 2, 0.4);
      } else if (currentAdx < 20) {
        currentTpMult = tpMult * 0.8;
        currentSlMult = Math.min(slMult * 0.7, 1.2);
      }
      const slTp = calcDynamicSlTp(primaryCandles, i, sig.direction, atr, currentSlMult, currentTpMult, entryPrice);
      sl = slTp.sl;
      tp = slTp.tp;
    }
    const { exitIdx, exitPrice, reason } = findExitWithTrailing(
      primaryCandles,
      i + 1,
      sig.direction,
      sl,
      tp,
      48,
      enable_trailing_stop
    );
    const tp1 = tp;
    const tp1Dist = Math.abs(tp1 - entryPrice);
    const tp2 = sig.custom_tp2 !== void 0 ? sig.custom_tp2 : sig.direction === "long" ? entryPrice + tp1Dist * 2 : entryPrice - tp1Dist * 2;
    let tp2Hit = false;
    for (let j = i + 1; j <= exitIdx; j++) {
      const c = primaryCandles[j];
      if (sig.direction === "long" && c.high >= tp2) {
        tp2Hit = true;
        break;
      }
      if (sig.direction === "short" && c.low <= tp2) {
        tp2Hit = true;
        break;
      }
    }
    let tp1Hit = false;
    let tp1HitIdx = -1;
    for (let j = i + 1; j <= exitIdx; j++) {
      const c = primaryCandles[j];
      if (sig.direction === "long" && c.high >= tp1) {
        tp1Hit = true;
        tp1HitIdx = j;
        break;
      }
      if (sig.direction === "short" && c.low <= tp1) {
        tp1Hit = true;
        tp1HitIdx = j;
        break;
      }
    }
    let rawPnlPct;
    if (tp1Hit && tp2Hit) {
      const pnl1 = sig.direction === "long" ? (tp1 - entryPrice) / entryPrice : (entryPrice - tp1) / entryPrice;
      const pnl2 = sig.direction === "long" ? (tp2 - entryPrice) / entryPrice : (entryPrice - tp2) / entryPrice;
      rawPnlPct = pnl1 * 0.5 + pnl2 * 0.5;
    } else if (tp1Hit && !tp2Hit) {
      const pnl1 = sig.direction === "long" ? (tp1 - entryPrice) / entryPrice : (entryPrice - tp1) / entryPrice;
      const pnl2 = sig.direction === "long" ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
      rawPnlPct = pnl1 * 0.5 + pnl2 * 0.5;
    } else {
      rawPnlPct = sig.direction === "long" ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
    }
    const currentAtrPct = atr > 0 && entryPrice > 0 ? atr / entryPrice : 0;
    const dynamicSlip = calcDynamicSlippage(symbol, currentAtrPct);
    const dynamicFee = enable_fee ? (TAKER_FEE + dynamicSlip) * 2 : 0;
    const feePct = dynamicFee;
    const netPnlPct = rawPnlPct - feePct;
    if (netPnlPct <= 0) {
      consecutiveLosses++;
      if (consecutiveLosses >= 2) {
        cooldownUntil = exitIdx + 3;
        consecutiveLosses = 0;
      }
    } else {
      consecutiveLosses = 0;
    }
    const usedPivotSl = sig.pivot_low !== void 0 || sig.pivot_high !== void 0;
    trades.push({
      entry_time: candles[i + 1].time,
      exit_time: candles[exitIdx].time,
      direction: sig.direction,
      entry_price: Math.round(entryPrice * 100) / 100,
      exit_price: Math.round(exitPrice * 100) / 100,
      sl_price: Math.round(sl * 100) / 100,
      tp_price: Math.round(tp1 * 100) / 100,
      tp2_price: Math.round(tp2 * 100) / 100,
      tp2_hit: tp2Hit,
      pnl: Math.round(rawPnlPct * entryPrice * 100) / 100,
      pnl_pct: Math.round(rawPnlPct * 1e4) / 1e4,
      pnl_net_pct: Math.round(netPnlPct * 1e4) / 1e4,
      exit_reason: reason,
      fee_pct: Math.round(feePct * 1e4) / 1e4,
      mtf_filter: mtfPassed,
      entry_type: entryType,
      signal_score: sig.score,
      pivot_sl: usedPivotSl
    });
    i = exitIdx;
  }
  function parseIntervalHours(iv) {
    const s = iv.trim().toLowerCase();
    const m = s.match(/^(\d+)(m|h|d|w)$/);
    if (!m) return 4;
    const value = Number(m[1]);
    const unit = m[2];
    if (unit === "m") return value / 60;
    if (unit === "h") return value;
    if (unit === "d") return value * 24;
    if (unit === "w") return value * 24 * 7;
    return 4;
  }
  const intervalHours = parseIntervalHours(interval);
  const stats = calcStats(trades, intervalHours);
  const quadStats = use_quad_mtf ? (() => {
    let totalScore = 0, bullishCount = 0, bearishCount = 0, neutralCount = 0, fullConsensus = 0;
    let sampleCount = 0;
    for (const t of trades) {
      const cs = calcMtfConsensus(
        candles_4h ?? null,
        candles_1h ?? null,
        candles_15m ?? null,
        candles_5m ?? null,
        t.entry_time,
        quad_mtf_threshold
      );
      totalScore += cs.consensus_score;
      if (cs.consensus_dir === "bullish") bullishCount++;
      else if (cs.consensus_dir === "bearish") bearishCount++;
      else neutralCount++;
      if (cs.bullish_layers === 4 || cs.bearish_layers === 4) fullConsensus++;
      sampleCount++;
    }
    const n = sampleCount || 1;
    return {
      avg_score: Math.round(totalScore / n * 1e3) / 1e3,
      bullish_pct: Math.round(bullishCount / n * 100),
      bearish_pct: Math.round(bearishCount / n * 100),
      neutral_pct: Math.round(neutralCount / n * 100),
      full_consensus: fullConsensus,
      quad_filtered: mtfFilteredCount
    };
  })() : void 0;
  return {
    strategy,
    symbol,
    interval,
    total_trades: trades.length,
    ...stats,
    trades,
    mtf_filtered_count: mtfFilteredCount,
    adx_filtered_count: adxFilteredCount,
    fvg_ob_entry_count: fvgObEntryCount,
    quad_mtf_enabled: use_quad_mtf,
    quad_consensus_stats: quadStats
  };
}

// server/live_btcusdt_strategy_presets.ts
var BTCUSDT_LIVE_PRESETS = [
  {
    key: "btcusdt_1h_single_strategy_181",
    label: "BTCUSDT 1H \u5355\u7B56\u7565\u7EC8\u7248 181 / 81.2 / PF1.28",
    family: "single_strategy_terminal",
    symbol: "BTCUSDT",
    strategy: "pa",
    interval: "1h",
    atr_sl_mult: 1.95,
    atr_tp_mult: 0.21,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: true,
    pa_allow_pattern: true,
    pa_allow_true_breakout: false,
    pa_allow_trap: true,
    pa_require_retest_on_continuation: false,
    pa_retest_soft_score: true,
    pa_retest_soft_bonus: 0.5,
    pa_retest_soft_min_score: 7.5,
    pa_retest_touch_tolerance_atr: 0.04,
    pa_retest_mode: "same_bar",
    pa_retest_require_candle_color: true,
    pa_retest_lookback_bars: 20,
    pa_retest_reclaim_offset_atr: 0.03,
    pa_dual_tf_resonance: true,
    pa_resonance_bias_window_bars: 2,
    pa_resonance_min_score: 40,
    pa_resonance_require_key_level: true,
    pa_resonance_require_momentum: false,
    pa_session_mode: "all",
    expected_summary: "\u65E7\u7248 1H \u5355\u7B56\u7565\u7EC8\u7ED3\u7248\uFF0C\u7528 1H \u504F\u89C1 + 15m \u5171\u632F\u89E6\u53D1\u5B9E\u9645\u4E70\u5356\u70B9\u3002"
  },
  {
    key: "btcusdt_execution_main_90",
    label: "BTCUSDT \u5B9E\u6218\u6267\u884C\u7EC8\u7248 90 / 85.56",
    family: "execution_terminal",
    symbol: "BTCUSDT",
    strategy: "pa",
    interval: "1h",
    atr_sl_mult: 1.75,
    atr_tp_mult: 0.19,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    pa_allow_pattern: true,
    pa_allow_true_breakout: false,
    pa_allow_trap: true,
    pa_require_retest_on_continuation: true,
    pa_retest_touch_tolerance_atr: 0.08,
    pa_retest_mode: "either",
    pa_retest_require_candle_color: false,
    pa_retest_lookback_bars: 12,
    pa_retest_reclaim_offset_atr: 0.03,
    pa_session_mode: "exclude_offhours",
    expected_summary: "\u540E\u7EED\u7CBE\u70BC\u540E\u7684\u9ED8\u8BA4\u5B9E\u6218\u4E3B\u7248\u672C\uFF0C\u6838\u5FC3\u8FC7\u6EE4\u4E3A exclude_offhours + ADX >= 20\u3002"
  }
];

// server/live_strategy_governance.ts
var WORKER_GOVERNANCE_RULES = {
  pa_v4_focus: {
    family: "pa",
    min_filtered_trades: 6,
    max_signal_age_bars: 24,
    min_signal_score: 9,
    summary: "PA \u4E3B\u529B\u7248\uFF0C\u4FDD\u7559\u9AD8\u5206\u9580\u6ABB\uFF0C\u4E26\u8981\u6C42\u8F03\u65B0\u8A0A\u865F\u8207\u8DB3\u5920\u904E\u6FFE\u5F8C\u6A23\u672C\u3002"
  },
  hwr_b_guarded: {
    family: "trend_pullback",
    min_filtered_trades: 3,
    max_signal_age_bars: 48,
    summary: "\u8DA8\u52E2\u56DE\u8E29\u5BB6\u65CF\uFF0C\u5141\u8A31\u8F03\u4F4E\u6A23\u672C\u9580\u6ABB\uFF0C\u4F46\u4FDD\u7559\u6642\u6548\u9650\u5236\u907F\u514D\u6CBF\u7528\u904E\u820A\u6CE2\u6BB5\u3002"
  },
  cannonball_guarded: {
    family: "structure",
    min_filtered_trades: 3,
    max_signal_age_bars: 48,
    summary: "\u7D50\u69CB\u78BA\u8A8D\u5BB6\u65CF\uFF0C\u4FDD\u7559\u4F4E\u6A23\u672C\u53EF\u7528\u6027\uFF0C\u540C\u6642\u8981\u6C42\u9AD8\u9031\u671F\u65B9\u5411\u8207\u5408\u7406\u6642\u6548\u3002"
  },
  ema_cross_confirm: {
    family: "trend_confirm",
    min_filtered_trades: 0,
    max_signal_age_bars: 12,
    summary: "\u4F4E\u983B\u8DA8\u52E2\u78BA\u8A8D\u5BB6\u65CF\uFF0C\u4E0D\u4EE5\u6A23\u672C\u91CF\u5361\u6B7B\uFF0C\u4F46\u53EA\u63A5\u53D7\u8F03\u65B0\u7684\u8A0A\u865F\u3002"
  },
  vwap_reversion_confirm: {
    family: "mean_reversion",
    min_filtered_trades: 0,
    max_signal_age_bars: 12,
    summary: "\u5747\u503C\u56DE\u6B78\u5BB6\u65CF\uFF0C\u5141\u8A31\u4F4E\u983B\u7B56\u7565\u5F85\u547D\uFF0C\u4F46\u8981\u6C42\u8F03\u77ED\u6642\u6548\u3002"
  }
};
function getWorkerGovernance(versionKey) {
  return WORKER_GOVERNANCE_RULES[versionKey];
}

// server/diagnostics_engine.ts
var FAMILY_LABELS = {
  pa: "PA \u50F9\u683C\u884C\u70BA",
  trend_pullback: "\u8DA8\u52E2\u56DE\u8E29",
  structure: "\u7D50\u69CB\u78BA\u8A8D",
  trend_confirm: "\u8DA8\u52E2\u78BA\u8A8D",
  mean_reversion: "\u5747\u503C\u56DE\u6B78"
};
function buildFamilyAggregations(strategies, activePresets) {
  const familyMap = /* @__PURE__ */ new Map();
  for (const preset of activePresets) {
    const family = preset.family;
    if (!familyMap.has(family)) {
      familyMap.set(family, {
        keys: [],
        totalRounds: 0,
        blocked: 0,
        sent: 0,
        duplicate: 0,
        idle: 0,
        error: 0,
        blockerCounts: /* @__PURE__ */ new Map()
      });
    }
    const agg = familyMap.get(family);
    agg.keys.push(preset.key);
    const stratState = strategies[preset.key];
    const diag = stratState?.diagnostics;
    if (diag) {
      agg.totalRounds += diag.total_rounds;
      agg.blocked += diag.blocked_rounds;
      agg.sent += diag.sent_rounds;
      agg.duplicate += diag.duplicate_rounds;
      agg.idle += diag.idle_rounds;
      agg.error += diag.error_rounds;
      for (const b of diag.top_blockers) {
        agg.blockerCounts.set(b.reason, (agg.blockerCounts.get(b.reason) ?? 0) + b.count);
      }
    }
  }
  const results = [];
  for (const [family, agg] of familyMap) {
    const topBlockers = [...agg.blockerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count }));
    results.push({
      family,
      family_label: FAMILY_LABELS[family] ?? family,
      strategy_count: agg.keys.length,
      total_rounds: agg.totalRounds,
      blocked_rounds: agg.blocked,
      sent_rounds: agg.sent,
      duplicate_rounds: agg.duplicate,
      idle_rounds: agg.idle,
      error_rounds: agg.error,
      blocked_rate: agg.totalRounds > 0 ? Math.round(agg.blocked / agg.totalRounds * 1e3) / 10 : 0,
      sent_rate: agg.totalRounds > 0 ? Math.round(agg.sent / agg.totalRounds * 1e3) / 10 : 0,
      active_rate: agg.totalRounds > 0 ? Math.round((agg.sent + agg.duplicate) / agg.totalRounds * 1e3) / 10 : 0,
      top_blockers: topBlockers,
      strategies: agg.keys
    });
  }
  return results.sort((a, b) => b.sent_rate - a.sent_rate);
}
function generateThresholdSuggestions(strategies, activePresets) {
  const suggestions = [];
  for (const preset of activePresets) {
    const state = strategies[preset.key];
    const diag = state?.diagnostics;
    const governance = WORKER_GOVERNANCE_RULES[preset.key];
    if (!diag || !governance || diag.total_rounds < 5) continue;
    if (diag.blocked_rate > 80) {
      const topBlocker = diag.top_blockers[0];
      if (topBlocker?.reason === "\u8A0A\u865F\u904E\u820A") {
        suggestions.push({
          strategy_key: preset.key,
          strategy_label: preset.label,
          family: preset.family,
          severity: "warning",
          category: "signal_age",
          current_value: `max_signal_age_bars = ${governance.max_signal_age_bars}`,
          suggested_action: `\u5EFA\u8B70\u5C07 max_signal_age_bars \u5F9E ${governance.max_signal_age_bars} \u653E\u5BEC\u81F3 ${Math.min(governance.max_signal_age_bars * 2, 96)}`,
          reason: `\u8FD1 ${diag.total_rounds} \u8F2A\u4E2D\u6709 ${diag.blocked_rate.toFixed(1)}% \u88AB\u963B\u64CB\uFF0C\u4E3B\u56E0\u70BA\u300C\u8A0A\u865F\u904E\u820A\u300D\uFF08${topBlocker.count} \u6B21\uFF09\uFF0C\u53EF\u8003\u616E\u653E\u5BEC\u6642\u6548\u9580\u6ABB\u3002`
        });
      }
    }
    if (diag.blocked_rate > 70) {
      const sampleBlocker = diag.top_blockers.find((b) => b.reason === "\u6B77\u53F2\u6A23\u672C\u4E0D\u8DB3");
      if (sampleBlocker && governance.min_filtered_trades > 0) {
        suggestions.push({
          strategy_key: preset.key,
          strategy_label: preset.label,
          family: preset.family,
          severity: "warning",
          category: "min_trades",
          current_value: `min_filtered_trades = ${governance.min_filtered_trades}`,
          suggested_action: `\u5EFA\u8B70\u5C07 min_filtered_trades \u5F9E ${governance.min_filtered_trades} \u964D\u81F3 ${Math.max(governance.min_filtered_trades - 2, 0)}`,
          reason: `\u300C\u6B77\u53F2\u6A23\u672C\u4E0D\u8DB3\u300D\u4F54 ${sampleBlocker.count} \u6B21\u963B\u64CB\uFF0C\u53EF\u964D\u4F4E\u6700\u4F4E\u6A23\u672C\u9580\u6ABB\u4EE5\u63D0\u9AD8\u53EF\u7528\u6027\u3002`
        });
      }
    }
    if (diag.blocked_rate > 60) {
      const scoreBlocker = diag.top_blockers.find((b) => b.reason === "\u6700\u65B0\u8A55\u5206\u4E0D\u8DB3");
      if (scoreBlocker && governance.min_signal_score !== void 0) {
        suggestions.push({
          strategy_key: preset.key,
          strategy_label: preset.label,
          family: preset.family,
          severity: "info",
          category: "signal_score",
          current_value: `min_signal_score = ${governance.min_signal_score}`,
          suggested_action: `\u5EFA\u8B70\u5C07 min_signal_score \u5F9E ${governance.min_signal_score} \u964D\u81F3 ${Math.max(governance.min_signal_score - 1, 6).toFixed(1)}`,
          reason: `\u300C\u6700\u65B0\u8A55\u5206\u4E0D\u8DB3\u300D\u4F54 ${scoreBlocker.count} \u6B21\u963B\u64CB\uFF0C\u53EF\u9069\u5EA6\u964D\u4F4E\u8A55\u5206\u9580\u6ABB\u4EE5\u589E\u52A0\u4FE1\u865F\u89F8\u767C\u6A5F\u6703\u3002`
        });
      }
    }
    if (diag.blocked_rate > 50) {
      const d1Blocker = diag.top_blockers.find((b) => b.reason === "1D EMA200 \u65B9\u5411\u4E0D\u7B26");
      if (d1Blocker && d1Blocker.count > diag.total_rounds * 0.4) {
        suggestions.push({
          strategy_key: preset.key,
          strategy_label: preset.label,
          family: preset.family,
          severity: "info",
          category: "d1_filter",
          current_value: "1D EMA200 \u904E\u6FFE\u555F\u7528\u4E2D",
          suggested_action: "\u5E02\u5834\u53EF\u80FD\u8655\u65BC\u76E4\u6574\u671F\uFF0C1D \u65B9\u5411\u904E\u6FFE\u6301\u7E8C\u963B\u64CB\u4FE1\u865F\u3002\u53EF\u8003\u616E\u5728\u9707\u76EA\u5E02\u66AB\u6642\u653E\u5BEC 1D \u904E\u6FFE\u689D\u4EF6\u3002",
          reason: `\u300C1D EMA200 \u65B9\u5411\u4E0D\u7B26\u300D\u4F54 ${d1Blocker.count} \u6B21\u963B\u64CB\uFF08${(d1Blocker.count / diag.total_rounds * 100).toFixed(0)}%\uFF09\uFF0C\u53EF\u80FD\u662F\u76E4\u6574\u884C\u60C5\u5C0E\u81F4\u3002`
        });
      }
    }
    if (diag.sent_rate === 0 && diag.idle_rounds > diag.total_rounds * 0.8) {
      suggestions.push({
        strategy_key: preset.key,
        strategy_label: preset.label,
        family: preset.family,
        severity: "info",
        category: "no_signal",
        current_value: `\u8FD1 ${diag.total_rounds} \u8F2A\u5168\u90E8 idle`,
        suggested_action: "\u6B64\u7B56\u7565\u8FD1\u671F\u7121\u4EFB\u4F55\u4FE1\u865F\u89F8\u767C\uFF0C\u5C6C\u6B63\u5E38\u4F4E\u983B\u72C0\u614B\u3002\u82E5\u9577\u671F\u7121\u4FE1\u865F\u53EF\u8003\u616E\u8ABF\u6574\u7B56\u7565\u53C3\u6578\u3002",
        reason: `\u8FD1 ${diag.total_rounds} \u8F2A\u4E2D ${diag.idle_rounds} \u8F2A\u70BA idle\uFF0C\u7B56\u7565\u53EF\u80FD\u8655\u65BC\u7B49\u5F85\u671F\u3002`
      });
    }
    if (diag.error_rounds > 0 && diag.error_rounds / diag.total_rounds > 0.1) {
      suggestions.push({
        strategy_key: preset.key,
        strategy_label: preset.label,
        family: preset.family,
        severity: "critical",
        category: "error_rate",
        current_value: `\u932F\u8AA4\u7387 ${(diag.error_rounds / diag.total_rounds * 100).toFixed(1)}%`,
        suggested_action: "\u5EFA\u8B70\u6AA2\u67E5\u7B56\u7565\u57F7\u884C\u65E5\u8A8C\uFF0C\u6392\u67E5\u932F\u8AA4\u539F\u56E0\u3002",
        reason: `\u8FD1 ${diag.total_rounds} \u8F2A\u4E2D\u6709 ${diag.error_rounds} \u8F2A\u51FA\u73FE\u932F\u8AA4\uFF0C\u9700\u8981\u95DC\u6CE8\u3002`
      });
    }
  }
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  return suggestions.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));
}
function buildStrategyTrends(strategies) {
  const trends = {};
  for (const [key, state] of Object.entries(strategies)) {
    const history = state?.history ?? [];
    trends[key] = history.map((h) => ({
      status: h.status,
      reason_code: h.reason_code
    }));
  }
  return trends;
}
function buildDiagnosticsEnrichment(strategies, activePresets) {
  return {
    family_aggregations: buildFamilyAggregations(strategies, activePresets),
    threshold_suggestions: generateThresholdSuggestions(strategies, activePresets),
    strategy_trends: buildStrategyTrends(strategies)
  };
}

// server/win_rate_booster.ts
function calcCrossStrategyConsensus(signals) {
  const active = signals.filter((s) => s.direction !== null);
  if (active.length === 0) {
    return { consensus_direction: null, consensus_score: 0, agreeing_strategies: [], total_active: 0, is_strong_consensus: false, boost_multiplier: 1 };
  }
  const longSignals = active.filter((s) => s.direction === "long");
  const shortSignals = active.filter((s) => s.direction === "short");
  const longWeight = longSignals.reduce((sum, s) => sum + s.score * (s.confidence / 100), 0);
  const shortWeight = shortSignals.reduce((sum, s) => sum + s.score * (s.confidence / 100), 0);
  const totalWeight = longWeight + shortWeight;
  if (totalWeight === 0) {
    return { consensus_direction: null, consensus_score: 0, agreeing_strategies: [], total_active: active.length, is_strong_consensus: false, boost_multiplier: 1 };
  }
  const direction = longWeight >= shortWeight ? "long" : "short";
  const agreeing = direction === "long" ? longSignals : shortSignals;
  const dominantWeight = direction === "long" ? longWeight : shortWeight;
  const weightRatio = dominantWeight / totalWeight;
  const countBonus = Math.min(agreeing.length / active.length, 1);
  const consensusScore = Math.round(weightRatio * 60 + countBonus * 40);
  const uniqueFamilies = new Set(agreeing.map((s) => s.family));
  const isStrongConsensus = agreeing.length >= 2 && uniqueFamilies.size >= 2;
  const boost = uniqueFamilies.size >= 3 ? 1.5 : uniqueFamilies.size >= 2 ? 1.3 : 1;
  return {
    consensus_direction: direction,
    consensus_score: consensusScore,
    agreeing_strategies: agreeing.map((s) => s.key),
    total_active: active.length,
    is_strong_consensus: isStrongConsensus,
    boost_multiplier: boost
  };
}
function detectMarketRegime(candles) {
  if (candles.length < 50) {
    return { regime: "ranging", confidence: 30, adx: 0, atr_pct: 0, bb_width_pct: 0, recommended_families: [], avoid_families: [] };
  }
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const lastClose = closes[n - 1];
  let plusDmSum = 0, minusDmSum = 0, trSum = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    const high = candles[i].high, low = candles[i].low;
    const prevHigh = candles[i - 1].high, prevLow = candles[i - 1].low, prevClose = candles[i - 1].close;
    const plusDm = Math.max(0, high - prevHigh);
    const minusDm = Math.max(0, prevLow - low);
    if (plusDm > minusDm) {
      plusDmSum += plusDm;
    } else {
      minusDmSum += minusDm;
    }
    trSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  const plusDi = trSum > 0 ? plusDmSum / trSum * 100 : 0;
  const minusDi = trSum > 0 ? minusDmSum / trSum * 100 : 0;
  const diSum = plusDi + minusDi;
  const adx = diSum > 0 ? Math.abs(plusDi - minusDi) / diSum * 100 : 0;
  let atrSum = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    const prevClose = candles[i - 1].close;
    atrSum += Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose));
  }
  const atr = atrSum / Math.min(14, n - 1);
  const atr_pct = lastClose > 0 ? atr / lastClose * 100 : 0;
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const stdDev = Math.sqrt(closes.slice(-20).reduce((sum, c) => sum + Math.pow(c - sma20, 2), 0) / 20);
  const bb_width_pct = sma20 > 0 ? stdDev * 4 / sma20 * 100 : 0;
  let regime;
  let confidence;
  let recommended;
  let avoid;
  if (adx >= 35 && atr_pct >= 1.5) {
    regime = "strong_trend";
    confidence = Math.min(95, 60 + adx);
    recommended = ["trend_pullback", "trend_confirm"];
    avoid = ["mean_reversion"];
  } else if (adx >= 25) {
    regime = "weak_trend";
    confidence = Math.min(80, 50 + adx);
    recommended = ["trend_pullback", "pa", "structure"];
    avoid = [];
  } else if (bb_width_pct < 2 && atr_pct < 1) {
    regime = "compressed";
    confidence = Math.min(85, 60 + (2 - bb_width_pct) * 20);
    recommended = ["structure"];
    avoid = ["trend_pullback", "trend_confirm"];
  } else if (atr_pct >= 2.5) {
    regime = "volatile";
    confidence = Math.min(80, 50 + atr_pct * 10);
    recommended = ["pa", "structure"];
    avoid = ["trend_confirm", "mean_reversion"];
  } else {
    regime = "ranging";
    confidence = Math.min(75, 50 + (25 - adx) * 2);
    recommended = ["mean_reversion", "pa"];
    avoid = ["trend_pullback", "trend_confirm"];
  }
  return { regime, confidence, adx, atr_pct, bb_width_pct, recommended_families: recommended, avoid_families: avoid };
}
function checkEntryQuality(candles1h, candles4h, direction, minQualityScore) {
  const minScore = minQualityScore ?? 60;
  const n = candles1h.length;
  if (n < 30) {
    return { pass: false, quality_score: 0, checks: { volume_confirmed: false, momentum_aligned: false, not_overextended: false, rsi_not_extreme: false, spread_healthy: false, higher_tf_aligned: false }, rejection_reason: "K \u7DDA\u4E0D\u8DB3" };
  }
  const close = candles1h[n - 1].close;
  const vol = candles1h[n - 1].volume;
  const avgVol = candles1h.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const volume_confirmed = vol >= avgVol * 0.8;
  const recent3 = candles1h.slice(-3);
  const bullBars = recent3.filter((c) => c.close > c.open).length;
  const momentum_aligned = direction === "long" ? bullBars >= 2 : 3 - bullBars >= 2;
  const ema20Closes = candles1h.slice(-20).map((c) => c.close);
  const ema20 = ema20Closes.reduce((a, b) => a + b, 0) / 20;
  let atrSum = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    const prev = candles1h[i - 1].close;
    atrSum += Math.max(candles1h[i].high - candles1h[i].low, Math.abs(candles1h[i].high - prev), Math.abs(candles1h[i].low - prev));
  }
  const atr = atrSum / Math.min(14, n - 1);
  const distFromEma = Math.abs(close - ema20);
  const not_overextended = distFromEma < atr * 2.5;
  const rsiPeriod = 14;
  let gains = 0, losses = 0;
  for (let i = n - rsiPeriod; i < n; i++) {
    const diff = candles1h[i].close - candles1h[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
  const rsi = 100 - 100 / (1 + rs);
  const rsi_not_extreme = direction === "long" ? rsi < 75 : rsi > 25;
  const lastCandle = candles1h[n - 1];
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const range = lastCandle.high - lastCandle.low;
  const spread_healthy = range > 0 ? body / range >= 0.3 : true;
  let higher_tf_aligned = true;
  if (candles4h.length >= 25) {
    const closes4h = candles4h.slice(-25).map((c) => c.close);
    const ema20_4h = closes4h.reduce((a, b) => a + b, 0) / closes4h.length;
    const last4hClose = closes4h[closes4h.length - 1];
    if (direction === "long" && last4hClose < ema20_4h * 0.998) higher_tf_aligned = false;
    if (direction === "short" && last4hClose > ema20_4h * 1.002) higher_tf_aligned = false;
  }
  const weights = {
    volume_confirmed: 15,
    momentum_aligned: 20,
    not_overextended: 15,
    rsi_not_extreme: 15,
    spread_healthy: 10,
    higher_tf_aligned: 25
  };
  let score = 0;
  if (volume_confirmed) score += weights.volume_confirmed;
  if (momentum_aligned) score += weights.momentum_aligned;
  if (not_overextended) score += weights.not_overextended;
  if (rsi_not_extreme) score += weights.rsi_not_extreme;
  if (spread_healthy) score += weights.spread_healthy;
  if (higher_tf_aligned) score += weights.higher_tf_aligned;
  const checks = { volume_confirmed, momentum_aligned, not_overextended, rsi_not_extreme, spread_healthy, higher_tf_aligned };
  const pass = score >= minScore;
  let rejection_reason;
  if (!pass) {
    const failed = [];
    if (!volume_confirmed) failed.push("\u6210\u4EA4\u91CF\u4E0D\u8DB3");
    if (!momentum_aligned) failed.push("\u52D5\u91CF\u65B9\u5411\u4E0D\u4E00\u81F4");
    if (!not_overextended) failed.push("\u50F9\u683C\u904E\u5EA6\u5EF6\u4F38");
    if (!rsi_not_extreme) failed.push("RSI \u6975\u7AEF\u503C");
    if (!spread_healthy) failed.push("K \u7DDA\u5F62\u614B\u4E0D\u5065\u5EB7");
    if (!higher_tf_aligned) failed.push("\u9AD8\u9031\u671F\u65B9\u5411\u4E0D\u4E00\u81F4");
    rejection_reason = failed.join("\u3001");
  }
  return { pass, quality_score: score, checks, rejection_reason };
}
function calcSmartExit(regime, family, baseTpMult, baseSlMult, atr_pct) {
  let tp = baseTpMult;
  let sl = baseSlMult;
  let trailing = false;
  let trailingR = 1.5;
  let partial = false;
  let reasoning = "";
  if (regime === "strong_trend") {
    tp = baseTpMult * 1.5;
    trailing = true;
    trailingR = 1;
    reasoning = "\u5F37\u8DA8\u52E2\u5E02\u6CC1\uFF1A\u653E\u5927\u6B62\u76C8\u76EE\u6A19 1.5 \u500D\uFF0C1R \u5F8C\u555F\u7528\u79FB\u52D5\u6B62\u640D\u8FFD\u8E64\u5229\u6F64";
  } else if (regime === "weak_trend") {
    tp = baseTpMult * 1.2;
    trailing = true;
    trailingR = 1.5;
    reasoning = "\u5F31\u8DA8\u52E2\u5E02\u6CC1\uFF1A\u9069\u5EA6\u653E\u5927\u6B62\u76C8 1.2 \u500D\uFF0C1.5R \u5F8C\u555F\u7528\u79FB\u52D5\u6B62\u640D";
  } else if (regime === "ranging") {
    tp = baseTpMult * 0.8;
    sl = baseSlMult * 0.9;
    partial = true;
    reasoning = "\u9707\u76EA\u5E02\u6CC1\uFF1A\u7E2E\u5C0F\u6B62\u76C8\u81F3 0.8 \u500D\u52A0\u901F\u7372\u5229\uFF0C1R \u6642\u5E73\u5009\u4E00\u534A\u9396\u5B9A\u5229\u6F64";
  } else if (regime === "volatile") {
    tp = baseTpMult * 1.3;
    sl = baseSlMult * 1.3;
    trailing = true;
    trailingR = 1;
    reasoning = "\u9AD8\u6CE2\u52D5\u5E02\u6CC1\uFF1ASL/TP \u540C\u6B65\u653E\u5927 1.3 \u500D\u907F\u514D\u5047\u7A81\u7834\u6D17\u51FA\uFF0C1R \u5F8C\u555F\u7528\u79FB\u52D5\u6B62\u640D";
  } else if (regime === "compressed") {
    tp = baseTpMult * 2;
    trailing = true;
    trailingR = 0.8;
    reasoning = "\u58D3\u7E2E\u76E4\u6574\uFF1A\u7A81\u7834\u5F8C\u76EE\u6A19\u653E\u5927 2 \u500D\uFF0C0.8R \u5373\u555F\u7528\u79FB\u52D5\u6B62\u640D\u6355\u6349\u5927\u884C\u60C5";
  }
  return {
    adjusted_tp_mult: Math.round(tp * 100) / 100,
    adjusted_sl_mult: Math.round(sl * 100) / 100,
    use_trailing: trailing,
    trailing_activation_r: trailingR,
    partial_exit_at_1r: partial,
    reasoning
  };
}
function getSessionInfo(timestampMs) {
  const d = timestampMs ? new Date(timestampMs) : /* @__PURE__ */ new Date();
  const utcHour = d.getUTCHours();
  if (utcHour >= 13 && utcHour < 17) {
    return { session: "overlap", is_high_quality: true, quality_multiplier: 1.3 };
  } else if (utcHour >= 7 && utcHour < 13) {
    return { session: "london", is_high_quality: true, quality_multiplier: 1.15 };
  } else if (utcHour >= 13 && utcHour < 22) {
    return { session: "newyork", is_high_quality: true, quality_multiplier: 1.1 };
  } else if (utcHour >= 0 && utcHour < 7) {
    return { session: "asia", is_high_quality: false, quality_multiplier: 0.85 };
  } else {
    return { session: "offhours", is_high_quality: false, quality_multiplier: 0.7 };
  }
}
function calcVolatilityAdaptive(candles) {
  if (candles.length < 50) {
    return { atr_percentile: 50, is_low_vol: false, is_high_vol: false, score_adjustment: 0, reasoning: "K \u7DDA\u4E0D\u8DB3" };
  }
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prev), Math.abs(candles[i].low - prev)));
  }
  const atrs = [];
  for (let i = 13; i < trs.length; i++) {
    const slice = trs.slice(i - 13, i + 1);
    atrs.push(slice.reduce((a, b) => a + b, 0) / 14);
  }
  if (atrs.length < 2) {
    return { atr_percentile: 50, is_low_vol: false, is_high_vol: false, score_adjustment: 0, reasoning: "ATR \u6578\u64DA\u4E0D\u8DB3" };
  }
  const currentAtr = atrs[atrs.length - 1];
  const sortedAtrs = [...atrs].sort((a, b) => a - b);
  const rank = sortedAtrs.findIndex((a) => a >= currentAtr);
  const percentile = Math.round(rank / sortedAtrs.length * 100);
  const is_low_vol = percentile < 25;
  const is_high_vol = percentile > 75;
  let score_adjustment = 0;
  let reasoning = "";
  if (is_low_vol) {
    score_adjustment = 1;
    reasoning = `\u4F4E\u6CE2\u52D5\u74B0\u5883\uFF08ATR \u767E\u5206\u4F4D ${percentile}%\uFF09\uFF1A\u63D0\u9AD8\u9032\u5834\u9580\u6ABB +1.0 \u5206\uFF0C\u907F\u514D\u5728\u6B7B\u6C34\u5E02\u5834\u4E2D\u4EA4\u6613`;
  } else if (is_high_vol) {
    score_adjustment = -0.5;
    reasoning = `\u9AD8\u6CE2\u52D5\u74B0\u5883\uFF08ATR \u767E\u5206\u4F4D ${percentile}%\uFF09\uFF1A\u7565\u5FAE\u653E\u5BEC\u9580\u6ABB -0.5 \u5206\uFF0C\u4F46\u9700\u914D\u5408\u79FB\u52D5\u6B62\u640D`;
  } else {
    reasoning = `\u6B63\u5E38\u6CE2\u52D5\u74B0\u5883\uFF08ATR \u767E\u5206\u4F4D ${percentile}%\uFF09\uFF1A\u7DAD\u6301\u6A19\u6E96\u9580\u6ABB`;
  }
  return { atr_percentile: percentile, is_low_vol, is_high_vol, score_adjustment, reasoning };
}
function evaluateSignal(signals, targetKey, candles1h, candles4h, family, baseTpMult, baseSlMult, minFinalScore) {
  const threshold = minFinalScore ?? 40;
  const reasoning = [];
  const consensus = calcCrossStrategyConsensus(signals);
  if (consensus.is_strong_consensus) {
    reasoning.push(`\u591A\u7B56\u7565\u5171\u632F\uFF1A${consensus.agreeing_strategies.length} \u500B\u7B56\u7565\u540C\u5411 ${consensus.consensus_direction}\uFF08\u52A0\u4E58 ${consensus.boost_multiplier}x\uFF09`);
  }
  const regime = detectMarketRegime(candles1h);
  const isRecommended = regime.recommended_families.includes(family);
  const isAvoided = regime.avoid_families.includes(family);
  if (isRecommended) reasoning.push(`\u5E02\u6CC1\u6709\u5229\uFF1A${regime.regime} \u63A8\u85A6 ${family} \u5BB6\u65CF`);
  if (isAvoided) reasoning.push(`\u5E02\u6CC1\u4E0D\u5229\uFF1A${regime.regime} \u4E0D\u63A8\u85A6 ${family} \u5BB6\u65CF`);
  const targetSignal = signals.find((s) => s.key === targetKey);
  const direction = targetSignal?.direction ?? consensus.consensus_direction;
  if (!direction) {
    return {
      should_trade: false,
      final_score: 0,
      consensus,
      regime,
      entry_quality: { pass: false, quality_score: 0, checks: { volume_confirmed: false, momentum_aligned: false, not_overextended: false, rsi_not_extreme: false, spread_healthy: false, higher_tf_aligned: false }, rejection_reason: "\u7121\u4FE1\u865F\u65B9\u5411" },
      exit_plan: calcSmartExit(regime.regime, family, baseTpMult, baseSlMult, regime.atr_pct),
      session: getSessionInfo(),
      volatility: calcVolatilityAdaptive(candles1h),
      reasoning: ["\u7121\u6709\u6548\u4FE1\u865F\u65B9\u5411"]
    };
  }
  const entryQuality = checkEntryQuality(candles1h, candles4h, direction);
  if (!entryQuality.pass) reasoning.push(`\u9032\u5834\u54C1\u8CEA\u4E0D\u8DB3\uFF1A${entryQuality.rejection_reason}`);
  const exitPlan = calcSmartExit(regime.regime, family, baseTpMult, baseSlMult, regime.atr_pct);
  reasoning.push(exitPlan.reasoning);
  const session = getSessionInfo();
  if (!session.is_high_quality) reasoning.push(`\u975E\u6700\u4F73\u4EA4\u6613\u6642\u6BB5\uFF08${session.session}\uFF09\uFF1A\u54C1\u8CEA\u4E58\u6578 ${session.quality_multiplier}x`);
  const volatility = calcVolatilityAdaptive(candles1h);
  if (volatility.score_adjustment !== 0) reasoning.push(volatility.reasoning);
  let score = 0;
  score += entryQuality.quality_score * 0.4;
  score += consensus.consensus_score * 0.25;
  score += isRecommended ? 20 : isAvoided ? 5 : 12;
  score += session.quality_multiplier * 12;
  score *= consensus.boost_multiplier;
  score *= session.quality_multiplier;
  if (volatility.is_low_vol) score *= 0.85;
  const finalScore = Math.round(Math.min(100, score));
  const shouldTrade = finalScore >= threshold && entryQuality.quality_score >= 30;
  return {
    should_trade: shouldTrade,
    final_score: finalScore,
    consensus,
    regime,
    entry_quality: entryQuality,
    exit_plan: exitPlan,
    session,
    volatility,
    reasoning
  };
}

// server/run_v4_five_strategy_live.ts
var SNAPSHOT_PATH = process.env.LATEST_LIVE_SNAPSHOT_PATH ?? "/home/ubuntu/runtime/btcusdt_live_signal_snapshot.json";
var SNAPSHOT_DIR = path.dirname(SNAPSHOT_PATH);
var INTERVAL_MS = 2 * 60 * 1e3;
var TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
var TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
var SYMBOLS = (process.env.SYMBOLS ?? "BTCUSDT,XRPUSDT,LINKUSDT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
function snapshotPathFor(symbol) {
  if (symbol === "BTCUSDT") return SNAPSHOT_PATH;
  return path.join(SNAPSHOT_DIR, `${symbol.toLowerCase()}_live_signal_snapshot.json`);
}
var PA_PRESET = BTCUSDT_LIVE_PRESETS.find((p) => p.key === "btcusdt_1h_single_strategy_181");
var DIAGNOSTIC_HISTORY_WINDOW = 30;
var STRATEGY_VERSIONS = [
  {
    key: "pa_v4_focus",
    label: "\u{1F7E2} PA \u4E3B\u529B\uFF1A1D EMA200 + 15m\u78BA\u8A8D",
    short: "PA-MAIN",
    family: "pa",
    strategy: "pa",
    tp: 0.5,
    sl: PA_PRESET.atr_sl_mult,
    use_1d: true,
    use_15m: true,
    m15_lookback: 3,
    backtest_return: "+10.11%",
    backtest_trades: 71,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
    use_pa_score_filter: true,
    ...WORKER_GOVERNANCE_RULES.pa_v4_focus
  },
  {
    key: "hwr_b_guarded",
    label: "\u{1F534} HWR-B\uFF1A\u8DA8\u52E2\u56DE\u8E29\u5EF6\u7E8C\uFF08\u9650\u6D41\u7248\uFF09",
    short: "HWR-B",
    family: "trend_pullback",
    strategy: "hwr_model_b",
    tp: 2,
    sl: 1.5,
    use_1d: false,
    use_15m: false,
    m15_lookback: 3,
    backtest_return: "\u8F15\u6539\u5019\u9078",
    backtest_trades: 68,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
    ...WORKER_GOVERNANCE_RULES.hwr_b_guarded
  },
  {
    key: "cannonball_guarded",
    label: "\u{1F7E3} CannonBall\uFF1A\u7D50\u69CB\u78BA\u8A8D\uFF08\u4FDD\u5B88\u7248\uFF09",
    short: "CBALL",
    family: "structure",
    strategy: "cannonball",
    tp: 2,
    sl: 1.5,
    use_1d: true,
    use_15m: false,
    m15_lookback: 3,
    backtest_return: "+9.73%",
    backtest_trades: 76,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
    ...WORKER_GOVERNANCE_RULES.cannonball_guarded
  },
  {
    key: "ema_cross_confirm",
    label: "\u{1F7E1} EMA Cross\uFF1A\u4F4E\u983B\u78BA\u8A8D\u7248",
    short: "EMA-X",
    family: "trend_confirm",
    strategy: "ema_cross",
    tp: 1.5,
    sl: 1.5,
    use_1d: false,
    use_15m: false,
    m15_lookback: 3,
    backtest_return: "+0.01%",
    backtest_trades: 2,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
    ...WORKER_GOVERNANCE_RULES.ema_cross_confirm
  },
  {
    key: "vwap_reversion_confirm",
    label: "\u{1F535} VWAP Reversion\uFF1A\u5747\u503C\u56DE\u6B78\u78BA\u8A8D\u7248",
    short: "VWAP",
    family: "mean_reversion",
    strategy: "vwap_reversion",
    tp: 1.5,
    sl: 1.5,
    use_1d: false,
    use_15m: false,
    m15_lookback: 3,
    backtest_return: "\u63A5\u8FD1\u6253\u5E73",
    backtest_trades: 6,
    enable_mtf_filter: true,
    enable_adx_filter: true,
    enable_trailing_stop: false,
    enable_fee: true,
    ...WORKER_GOVERNANCE_RULES.vwap_reversion_confirm
  }
];
var lastAlertKey = /* @__PURE__ */ new Map();
var lastSignalDir = /* @__PURE__ */ new Map();
function stateKey(symbol, versionKey) {
  return `${symbol}::${versionKey}`;
}
async function readPreviousSnapshotFor(symbol) {
  try {
    const raw = await fs.readFile(snapshotPathFor(symbol), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function normalizeFilterReason(reason) {
  if (!reason) return null;
  const raw = reason.trim();
  if (!raw) return null;
  if (raw.startsWith("1D EMA200 \u65B9\u5411\u4E0D\u7B26")) return "1D EMA200 \u65B9\u5411\u4E0D\u7B26";
  if (raw.startsWith("15m EMA+\u8DA8\u52E2\u78BA\u8A8D\u672A\u901A\u904E")) return "15m \u78BA\u8A8D\u672A\u901A\u904E";
  if (raw.startsWith("\u6B77\u53F2\u6A23\u672C\u4E0D\u8DB3")) return "\u6B77\u53F2\u6A23\u672C\u4E0D\u8DB3";
  if (raw.startsWith("\u8A0A\u865F\u904E\u820A")) return "\u8A0A\u865F\u904E\u820A";
  if (raw.startsWith("\u6700\u65B0\u8A55\u5206\u4E0D\u8DB3")) return "\u6700\u65B0\u8A55\u5206\u4E0D\u8DB3";
  if (raw.startsWith("\u7121\u4EA4\u6613\u4FE1\u865F")) return "\u7121\u4EA4\u6613\u4FE1\u865F";
  return raw;
}
function buildHistoryEntry(state, checkedAt) {
  return {
    checked_at: checkedAt,
    status: state?.last_status ?? "idle",
    reason: state?.last_filter_reason ?? null,
    reason_code: normalizeFilterReason(state?.last_filter_reason),
    direction: state?.last_direction ?? null,
    filtered_trades: typeof state?.filtered_trades === "number" ? state.filtered_trades : 0,
    filtered_win_rate: typeof state?.filtered_win_rate === "number" ? state.filtered_win_rate : 0
  };
}
function buildStrategyDiagnostics(history) {
  const summary = {
    total_rounds: history.length,
    blocked_rounds: 0,
    sent_rounds: 0,
    duplicate_rounds: 0,
    idle_rounds: 0,
    error_rounds: 0,
    blocked_rate: 0,
    sent_rate: 0,
    top_blockers: []
  };
  const blockerCounts = /* @__PURE__ */ new Map();
  for (const item of history) {
    if (item.status === "blocked") summary.blocked_rounds += 1;
    if (item.status === "sent") summary.sent_rounds += 1;
    if (item.status === "duplicate_skip") summary.duplicate_rounds += 1;
    if (item.status === "idle") summary.idle_rounds += 1;
    if (item.status === "error") summary.error_rounds += 1;
    if (item.status === "blocked" && item.reason_code) {
      blockerCounts.set(item.reason_code, (blockerCounts.get(item.reason_code) ?? 0) + 1);
    }
  }
  if (summary.total_rounds > 0) {
    summary.blocked_rate = Math.round(summary.blocked_rounds / summary.total_rounds * 1e3) / 10;
    summary.sent_rate = Math.round(summary.sent_rounds / summary.total_rounds * 1e3) / 10;
  }
  summary.top_blockers = [...blockerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count }));
  return summary;
}
async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.length < 10) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(1e4)
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[LiveWorker v4.5] Telegram \u63A8\u9001\u5931\u6557: ${resp.status} \u2013 ${err.slice(0, 100)}`);
    }
  } catch (err) {
    console.error(`[LiveWorker v4.5] Telegram \u63A8\u9001\u7570\u5E38:`, err);
  }
}
function calcEma(values, period) {
  const k = 2 / (period + 1);
  const ema = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < Math.min(period - 1, values.length); i++) sum += values[i];
  if (values.length >= period) {
    sum += values[period - 1];
    ema[period - 1] = sum / period;
    for (let i = period; i < values.length; i++) {
      ema[i] = values[i] * k + ema[i - 1] * (1 - k);
    }
  }
  return ema;
}
function get1dEma200Trend(candles1d) {
  if (candles1d.length < 50) return "neutral";
  const closes = candles1d.map((c) => c.close);
  const period = Math.min(200, closes.length);
  const ema = calcEma(closes, period);
  const lastEma = ema[ema.length - 1];
  const lastClose = closes[closes.length - 1];
  if (isNaN(lastEma)) return "neutral";
  if (lastClose > lastEma * 1.002) return "bullish";
  if (lastClose < lastEma * 0.998) return "bearish";
  return "neutral";
}
function check15mConfirmation(candles15m, direction) {
  if (candles15m.length < 20) return true;
  const closes = candles15m.map((c) => c.close);
  const ema20 = calcEma(closes, 20);
  const ema50 = calcEma(closes, 50);
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  let emaOk = true;
  if (!isNaN(lastEma20) && !isNaN(lastEma50)) {
    if (direction === "long" && lastEma20 < lastEma50 * 0.999) emaOk = false;
    if (direction === "short" && lastEma20 > lastEma50 * 1.001) emaOk = false;
  }
  const recent3 = candles15m.slice(-3);
  let bullCount = 0, bearCount = 0;
  for (const b of recent3) {
    if (b.close > b.open) bullCount++;
    else bearCount++;
  }
  const trendOk = direction === "long" ? bullCount > bearCount : bearCount > bullCount;
  return emaOk && trendOk;
}
function applyScore90Filter(trade, prevDirection) {
  if (trade.signal_score !== void 0 && trade.signal_score !== null) {
    const isContinuation = prevDirection !== void 0 && prevDirection === trade.direction;
    const bonus = isContinuation ? 1.5 : 0;
    if (trade.signal_score + bonus >= 9) return { pass: true };
    return {
      pass: false,
      reason: `score ${trade.signal_score.toFixed(1)}+${bonus.toFixed(1)} < 9.0${isContinuation ? " (continuation)" : ""}`
    };
  }
  return { pass: true };
}
var WIN_RATE_MODE = (process.env.WIN_RATE_MODE ?? "balanced").toLowerCase();
var MUST_HAVE_CORE_CHECKS = ["C2_htf_trend", "C4_volume", "C5_overextended"];
function calcRsi14ForChecklist(candles, idx) {
  if (idx < 14) return 50;
  let gains = 0, losses = 0;
  for (let i = idx - 13; i <= idx; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const rs = losses > 0 ? gains / 14 / (losses / 14) : 100;
  return 100 - 100 / (1 + rs);
}
function calcAtrForChecklist(candles, idx, period = 14) {
  const start = Math.max(1, idx - period + 1);
  let sum = 0, count = 0;
  for (let i = start; i <= idx; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    count++;
  }
  return count > 0 ? sum / count : candles[idx].high - candles[idx].low;
}
function runHighWinRateChecklist(direction, candles1h, candles4h, family) {
  const n = candles1h.length;
  if (n < 50) return { pass: true, tier: "S", failed_checks: [], passed_count: 0, total_checks: 0 };
  const lastCandle = candles1h[n - 1];
  const dir = direction;
  const failed = [];
  let totalChecks = 8;
  const utcHour = (/* @__PURE__ */ new Date()).getUTCHours();
  if (!(utcHour >= 7 && utcHour < 22)) {
    failed.push("C1_session");
  }
  const candles4hFiltered = candles4h;
  if (candles4hFiltered.length >= 25) {
    const closes4h = candles4hFiltered.map((c) => c.close);
    const ema20_4h = calcEma(closes4h, 20);
    const lastEma = ema20_4h[ema20_4h.length - 1];
    const prevEma = ema20_4h[ema20_4h.length - 2];
    const slope = lastEma - prevEma;
    const lastClose4h = closes4h[closes4h.length - 1];
    const slopeOk = dir === "long" ? slope >= 0 : slope <= 0;
    const posOk = dir === "long" ? lastClose4h >= lastEma * 0.995 : lastClose4h <= lastEma * 1.005;
    if (!slopeOk || !posOk) {
      failed.push("C2_htf_trend");
    }
  }
  const rsi1h = calcRsi14ForChecklist(candles1h, n - 1);
  const rsiOk = dir === "long" ? rsi1h >= 42 && rsi1h <= 72 : rsi1h >= 28 && rsi1h <= 58;
  if (!rsiOk) {
    failed.push("C3_rsi");
  }
  const avgVol20 = candles1h.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const rvol = avgVol20 > 0 ? lastCandle.volume / avgVol20 : 1;
  if (rvol < 0.9) {
    failed.push("C4_volume");
  }
  const ema20arr = calcEma(candles1h.map((c) => c.close), 20);
  const atr = calcAtrForChecklist(candles1h, n - 1);
  const distFromEma = Math.abs(lastCandle.close - ema20arr[n - 1]);
  const atrDist = atr > 0 ? distFromEma / atr : 0;
  if (atrDist > 1.8) {
    failed.push("C5_overextended");
  }
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const range = lastCandle.high - lastCandle.low;
  const bodyRatio = range > 0 ? body / range : 1;
  if (bodyRatio < 0.35) {
    failed.push("C6_candle_form");
  }
  if (n >= 2) {
    const recent2 = candles1h.slice(-2);
    const aligned = recent2.filter(
      (c) => dir === "long" ? c.close > c.open : c.close < c.open
    ).length;
    if (aligned < 1) {
      failed.push("C7_momentum");
    }
  }
  if (n >= 50) {
    const atrArr = [];
    for (let i = Math.max(1, n - 50); i < n; i++) {
      atrArr.push(calcAtrForChecklist(candles1h, i));
    }
    atrArr.sort((a, b) => a - b);
    const rank = atrArr.filter((a) => a <= atr).length;
    const percentile = Math.round(rank / atrArr.length * 100);
    if (percentile < 20 || percentile > 88) {
      failed.push("C8_atr_health");
    }
  }
  if (family === "pa") {
    totalChecks += 3;
    const paCandle = dir === "long" ? lastCandle.close >= lastCandle.open : lastCandle.close <= lastCandle.open;
    if (!paCandle) {
      failed.push("PA1_candle_dir");
    }
    const paRsiOk = dir === "long" ? rsi1h < 65 : rsi1h > 35;
    if (!paRsiOk) {
      failed.push("PA2_rsi_extreme");
    }
    if (candles4hFiltered.length >= 25) {
      const closes4h = candles4hFiltered.map((c) => c.close);
      const rsi4h = calcRsi14ForChecklist(candles4hFiltered, closes4h.length - 1);
      const pa4hOk = dir === "long" ? rsi4h > 45 : rsi4h < 55;
      if (!pa4hOk) {
        failed.push("PA3_4h_rsi");
      }
    }
  }
  const passedCount = totalChecks - failed.length;
  const coreFailedList = failed.filter((f) => !f.startsWith("PA"));
  const paFailedList = failed.filter((f) => f.startsWith("PA"));
  const corePass = 8 - coreFailedList.length;
  if (WIN_RATE_MODE === "strict") {
    const pass = coreFailedList.length <= 1 && paFailedList.length === 0;
    return { pass, tier: pass ? "S" : "-", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
  }
  if (family === "pa") {
    if (paFailedList.includes("PA1_candle_dir")) {
      return { pass: false, tier: "-", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
    }
    if (paFailedList.length > 1) {
      return { pass: false, tier: "-", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
    }
  }
  if (corePass >= 7) {
    return { pass: true, tier: "S", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
  }
  if (corePass >= 6) {
    const blockedMust = MUST_HAVE_CORE_CHECKS.filter((m) => coreFailedList.includes(m));
    if (blockedMust.length === 0) {
      return { pass: true, tier: "A", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
    }
  }
  return { pass: false, tier: "-", failed_checks: failed, passed_count: passedCount, total_checks: totalChecks };
}
async function runVersion(version, candles1h, candles4h, candles1d, candles15m, symbol = "BTCUSDT") {
  try {
    const result = runBacktest({
      candles: candles1h,
      strategy: version.strategy,
      symbol,
      interval: "1h",
      atr_sl_mult: version.sl,
      atr_tp_mult: version.tp,
      enable_mtf_filter: version.enable_mtf_filter,
      enable_adx_filter: version.enable_adx_filter,
      enable_trailing_stop: version.enable_trailing_stop,
      enable_fee: version.enable_fee,
      candles_4h: candles4h
    });
    let allTrades = result.trades ?? [];
    const rawWinRate = result.win_rate;
    const rawTrades = result.total_trades;
    if (version.use_pa_score_filter) {
      const prevDir = lastSignalDir.get(stateKey(symbol, version.key));
      const filteredTrades = [];
      for (const t of allTrades) {
        const prevTradeDir = filteredTrades.length > 0 ? filteredTrades[filteredTrades.length - 1].direction : prevDir;
        const check = applyScore90Filter(
          { direction: t.direction, signal_score: t.signal_score },
          prevTradeDir
        );
        if (check.pass) filteredTrades.push(t);
      }
      allTrades = filteredTrades;
    }
    const filteredWins = allTrades.filter((t) => t.pnl_net_pct > 0).length;
    const filteredWinRate = allTrades.length > 0 ? filteredWins / allTrades.length * 100 : 0;
    if (version.min_filtered_trades && allTrades.length < version.min_filtered_trades) {
      return {
        version_key: version.key,
        direction: null,
        entry_price: null,
        sl_price: null,
        tp_price: null,
        tp2_price: null,
        signal_time: null,
        alert_key: null,
        raw_win_rate: rawWinRate,
        raw_trades: rawTrades,
        filtered_trades: allTrades.length,
        filtered_win_rate: filteredWinRate,
        filter_reason: `\u6B77\u53F2\u6A23\u672C\u4E0D\u8DB3\uFF08${allTrades.length}/${version.min_filtered_trades}\uFF09`
      };
    }
    if (allTrades.length === 0) {
      return {
        version_key: version.key,
        direction: null,
        entry_price: null,
        sl_price: null,
        tp_price: null,
        tp2_price: null,
        signal_time: null,
        alert_key: null,
        raw_win_rate: rawWinRate,
        raw_trades: rawTrades,
        filtered_trades: 0,
        filtered_win_rate: 0,
        filter_reason: "\u7121\u4EA4\u6613\u4FE1\u865F"
      };
    }
    const lastTrade = allTrades[allTrades.length - 1];
    if (version.max_signal_age_bars !== void 0) {
      const referenceTimeSec = typeof lastTrade.exit_time === "number" ? lastTrade.exit_time : Math.floor(Date.now() / 1e3);
      const ageBars = (Math.floor(Date.now() / 1e3) - referenceTimeSec) / 3600;
      if (ageBars > version.max_signal_age_bars) {
        return {
          version_key: version.key,
          direction: null,
          entry_price: null,
          sl_price: null,
          tp_price: null,
          tp2_price: null,
          signal_time: null,
          alert_key: null,
          raw_win_rate: rawWinRate,
          raw_trades: rawTrades,
          filtered_trades: allTrades.length,
          filtered_win_rate: filteredWinRate,
          filter_reason: `\u8A0A\u865F\u904E\u820A\uFF08${ageBars.toFixed(1)}h > ${version.max_signal_age_bars}h\uFF09`
        };
      }
    }
    if (version.min_signal_score !== void 0) {
      const lastScore = typeof lastTrade.signal_score === "number" ? lastTrade.signal_score : null;
      if (lastScore === null || lastScore < version.min_signal_score) {
        return {
          version_key: version.key,
          direction: null,
          entry_price: null,
          sl_price: null,
          tp_price: null,
          tp2_price: null,
          signal_time: null,
          alert_key: null,
          raw_win_rate: rawWinRate,
          raw_trades: rawTrades,
          filtered_trades: allTrades.length,
          filtered_win_rate: filteredWinRate,
          filter_reason: `\u6700\u65B0\u8A55\u5206\u4E0D\u8DB3\uFF08${lastScore ?? "N/A"} < ${version.min_signal_score}\uFF09`
        };
      }
    }
    let d1Trend = "neutral";
    if (version.use_1d) {
      d1Trend = get1dEma200Trend(candles1d);
      if (d1Trend !== "neutral") {
        const aligned = lastTrade.direction === "long" && d1Trend === "bullish" || lastTrade.direction === "short" && d1Trend === "bearish";
        if (!aligned) {
          console.log(`[${version.short}] 1D EMA200 \u904E\u6FFE\uFF1A${lastTrade.direction} vs ${d1Trend}`);
          return {
            version_key: version.key,
            direction: null,
            entry_price: null,
            sl_price: null,
            tp_price: null,
            tp2_price: null,
            signal_time: null,
            alert_key: null,
            raw_win_rate: rawWinRate,
            raw_trades: rawTrades,
            filtered_trades: allTrades.length,
            filtered_win_rate: filteredWinRate,
            filter_reason: `1D EMA200 \u65B9\u5411\u4E0D\u7B26\uFF081D=${d1Trend}\uFF0C\u4FE1\u865F=${lastTrade.direction}\uFF09`,
            d1_trend: d1Trend
          };
        }
      }
    }
    let m15Ok = true;
    if (version.use_15m) {
      m15Ok = check15mConfirmation(candles15m, lastTrade.direction);
      if (!m15Ok) {
        console.log(`[${version.short}] 15m \u78BA\u8A8D\u672A\u901A\u904E\uFF08${lastTrade.direction}\uFF09`);
        return {
          version_key: version.key,
          direction: null,
          entry_price: null,
          sl_price: null,
          tp_price: null,
          tp2_price: null,
          signal_time: null,
          alert_key: null,
          raw_win_rate: rawWinRate,
          raw_trades: rawTrades,
          filtered_trades: allTrades.length,
          filtered_win_rate: filteredWinRate,
          filter_reason: "15m EMA+\u8DA8\u52E2\u78BA\u8A8D\u672A\u901A\u904E",
          d1_trend: d1Trend,
          m15_ok: false
        };
      }
    }
    const alertKey = `${version.key}_${lastTrade.direction}_${lastTrade.entry_time}`;
    console.log(
      `[${version.short}] ${version.strategy} \u4FE1\u865F ${lastTrade.direction} @ ${lastTrade.entry_price?.toFixed(2)} | \u6DE8\u52DD\u7387 ${filteredWinRate.toFixed(1)}%\uFF08${allTrades.length}\u7B46\uFF09` + (version.use_1d ? ` | 1D=${d1Trend}` : "") + (version.use_15m ? ` | 15m=${m15Ok ? "\u2705" : "\u274C"}` : "")
    );
    return {
      version_key: version.key,
      direction: lastTrade.direction,
      entry_price: lastTrade.entry_price,
      sl_price: lastTrade.sl_price,
      tp_price: lastTrade.tp_price,
      tp2_price: lastTrade.tp2_price ?? lastTrade.tp_price,
      signal_time: lastTrade.entry_time,
      alert_key: alertKey,
      raw_win_rate: rawWinRate,
      raw_trades: rawTrades,
      filtered_trades: allTrades.length,
      filtered_win_rate: filteredWinRate,
      d1_trend: d1Trend,
      m15_ok: m15Ok
    };
  } catch (err) {
    return {
      version_key: version.key,
      direction: null,
      entry_price: null,
      sl_price: null,
      tp_price: null,
      tp2_price: null,
      signal_time: null,
      alert_key: null,
      raw_win_rate: 0,
      raw_trades: 0,
      filtered_trades: 0,
      filtered_win_rate: 0,
      error: String(err)
    };
  }
}
var REGIME_FAMILY_MAP = {
  strong_trend: { recommended: ["trend_pullback", "trend_confirm"], avoid: [] },
  weak_trend: { recommended: ["trend_pullback", "pa", "structure"], avoid: [] },
  ranging: { recommended: ["mean_reversion", "pa", "structure", "trend_pullback"], avoid: [] },
  volatile: { recommended: ["pa", "structure"], avoid: [] },
  compressed: { recommended: ["structure", "pa"], avoid: [] }
};
var MIN_BOOST_SCORE = 40;
async function runOnceForSymbol(symbol) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  console.log(`[LiveWorker v4.7][${symbol}] ========== \u6383\u63CF\u958B\u59CB ${now} ==========\uFF08\u6A21\u5F0F\uFF1A${WIN_RATE_MODE}\uFF09`);
  let candles1h, candles4h, candles1d, candles15m;
  try {
    [candles1h, candles4h, candles1d, candles15m] = await Promise.all([
      fetchCandles(symbol, "1h", 500),
      fetchCandles(symbol, "4h", 500),
      fetchCandles(symbol, "1d", 400),
      fetchCandles(symbol, "15m", 500)
    ]);
    console.log(`[LiveWorker v4.7][${symbol}] K \u7DDA\uFF1A1h=${candles1h.length} 4h=${candles4h.length} 1d=${candles1d.length} 15m=${candles15m.length}`);
    if (symbol === "BTCUSDT") _lastCandles1h = candles1h;
  } catch (err) {
    console.error(`[LiveWorker v4.7][${symbol}] K \u7DDA\u6291\u53D6\u5931\u6557:`, err);
    return;
  }
  const regimeResult = detectMarketRegime(candles1h);
  const currentRegime = regimeResult.regime;
  const regimeMap = REGIME_FAMILY_MAP[currentRegime];
  const sessionInfo = getSessionInfo();
  const volAdaptive = calcVolatilityAdaptive(candles1h);
  console.log(`[LiveWorker v4.4] \u5E02\u6CC1\uFF1A${currentRegime}\uFF08\u4FE1\u5FC3 ${regimeResult.confidence}%\uFF09| ADX=${regimeResult.adx.toFixed(1)} ATR%=${regimeResult.atr_pct.toFixed(2)} BB%=${regimeResult.bb_width_pct.toFixed(2)}`);
  console.log(`[LiveWorker v4.4] \u6642\u6BB5\uFF1A${sessionInfo.session}\uFF08\u54C1\u8CEA ${sessionInfo.quality_multiplier}x\uFF09| \u6CE2\u52D5\u7387\uFF1AATR \u767E\u5206\u4F4D ${volAdaptive.atr_percentile}%${volAdaptive.is_low_vol ? "\uFF08\u4F4E\u6CE2\u52D5\uFF09" : volAdaptive.is_high_vol ? "\uFF08\u9AD8\u6CE2\u52D5\uFF09" : ""}`);
  console.log(`[LiveWorker v4.4] \u63A8\u85A6\u5BB6\u65CF\uFF1A[${regimeMap.recommended.join(", ")}] | \u8FF4\u907F\u5BB6\u65CF\uFF1A[${regimeMap.avoid.join(", ")}]`);
  const versionResults = await Promise.allSettled(
    STRATEGY_VERSIONS.map((v) => runVersion(v, candles1h, candles4h, candles1d, candles15m, symbol))
  );
  const allStrategySignals = [];
  for (let i = 0; i < STRATEGY_VERSIONS.length; i++) {
    const version = STRATEGY_VERSIONS[i];
    const settled = versionResults[i];
    if (settled.status === "fulfilled" && settled.value.direction) {
      allStrategySignals.push({
        key: version.key,
        family: version.family,
        direction: settled.value.direction,
        score: settled.value.filtered_win_rate,
        confidence: Math.min(100, settled.value.filtered_trades * 10)
      });
    } else {
      allStrategySignals.push({
        key: version.key,
        family: version.family,
        direction: null,
        score: 0,
        confidence: 0
      });
    }
  }
  const consensus = calcCrossStrategyConsensus(allStrategySignals);
  if (consensus.consensus_direction) {
    console.log(`[LiveWorker v4.4] \u5171\u632F\uFF1A${consensus.consensus_direction}\uFF08\u5206\u6578 ${consensus.consensus_score}\uFF0C${consensus.agreeing_strategies.length} \u7B56\u7565\u540C\u5411\uFF0C\u52A0\u4E58 ${consensus.boost_multiplier}x${consensus.is_strong_consensus ? "\uFF0C\u5F37\u5171\u632F" : ""}\uFF09`);
  } else {
    console.log(`[LiveWorker v4.4] \u5171\u632F\uFF1A\u7121\u5171\u8B58\u65B9\u5411`);
  }
  const previousSnapshot = await readPreviousSnapshotFor(symbol);
  const previousStrategies = previousSnapshot?.state_overview?.strategies ?? {};
  const signals = [];
  const dispatch_results = [];
  const strategy_errors = [];
  const state_strategies = {};
  for (let i = 0; i < STRATEGY_VERSIONS.length; i++) {
    const version = STRATEGY_VERSIONS[i];
    const settled = versionResults[i];
    if (settled.status === "rejected") {
      const governance2 = getWorkerGovernance(version.key);
      strategy_errors.push({ version_key: version.key, label: version.label, error: String(settled.reason) });
      state_strategies[version.key] = {
        last_status: "error",
        last_filter_reason: String(settled.reason),
        governance_summary: governance2?.summary,
        checked_at: now
      };
      continue;
    }
    const r = settled.value;
    const governance = getWorkerGovernance(version.key);
    if (r.error) {
      strategy_errors.push({ preset_key: version.key, version_key: version.key, label: version.label, error: r.error });
      state_strategies[version.key] = {
        last_status: "error",
        last_filter_reason: r.error,
        governance_summary: governance?.summary,
        checked_at: now
      };
    }
    if (r.direction && r.entry_price && r.alert_key) {
      const isAvoided = regimeMap.avoid.includes(version.family);
      if (isAvoided) {
        console.log(`[${version.short}] \u{1F6AB} \u5E02\u6CC1\u904E\u6FFE\uFF1A${currentRegime} \u4E0D\u63A8\u85A6 ${version.family} \u5BB6\u65CF`);
        state_strategies[version.key] = {
          last_status: "blocked",
          last_filter_reason: `\u5E02\u6CC1\u904E\u6FFE\uFF08${currentRegime} \u8FF4\u907F ${version.family}\uFF09`,
          governance_summary: governance?.summary,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          checked_at: now,
          regime: currentRegime
        };
        continue;
      }
      const boostResult = evaluateSignal(
        allStrategySignals,
        version.key,
        candles1h,
        candles4h,
        version.family,
        version.tp,
        version.sl,
        MIN_BOOST_SCORE
      );
      if (!boostResult.should_trade) {
        const vetoReasons = boostResult.reasoning.filter((r2) => r2.includes("\u4E0D") || r2.includes("\u975E") || r2.includes("\u6975\u7AEF") || r2.includes("\u4F4E")).slice(0, 2);
        const vetoSummary = vetoReasons.length > 0 ? vetoReasons.join("\uFF1B") : `\u7D9C\u5408\u8A55\u5206\u4E0D\u8DB3\uFF08${boostResult.final_score}/${MIN_BOOST_SCORE}\uFF09`;
        console.log(`[${version.short}] \u{1F6D1} Veto \u5426\u6C7A\uFF1A${vetoSummary}\uFF08\u54C1\u8CEA\u5206 ${boostResult.entry_quality.quality_score}\uFF0C\u7D9C\u5408\u5206 ${boostResult.final_score}\uFF09`);
        state_strategies[version.key] = {
          last_status: "blocked",
          last_filter_reason: `Veto\uFF1A${vetoSummary}`,
          governance_summary: governance?.summary,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          checked_at: now,
          regime: currentRegime,
          boost_score: boostResult.final_score,
          entry_quality_score: boostResult.entry_quality.quality_score
        };
        continue;
      }
      const checklistResult = runHighWinRateChecklist(
        r.direction,
        candles1h,
        candles4h,
        version.family
      );
      if (!checklistResult.pass) {
        const failSummary = checklistResult.failed_checks.slice(0, 3).join(", ");
        console.log(`[${version.short}] \u{1F6AB} \u78BA\u8A8D\u6E05\u55AE\u672A\u901A\u904E\uFF08\u6838\u5FC3 ${8 - checklistResult.failed_checks.filter((f) => !f.startsWith("PA")).length}/8\uFF09\uFF1A${failSummary}`);
        state_strategies[version.key] = {
          last_status: "blocked",
          last_filter_reason: `\u78BA\u8A8D\u6E05\u55AE\uFF1A${failSummary}`,
          governance_summary: governance?.summary,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          checked_at: now,
          regime: currentRegime,
          boost_score: boostResult.final_score,
          entry_quality_score: boostResult.entry_quality.quality_score,
          checklist_passed: checklistResult.passed_count,
          checklist_total: checklistResult.total_checks
        };
        continue;
      }
      signals.push({
        preset_key: version.key,
        version_key: version.key,
        version_label: version.label,
        direction: r.direction,
        entry_price: r.entry_price,
        signal_time: r.signal_time,
        alert_key: r.alert_key,
        filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
        filtered_trades: r.filtered_trades,
        d1_trend: r.d1_trend,
        m15_ok: r.m15_ok,
        // v4.4 新增欄位
        boost_score: boostResult.final_score,
        entry_quality: boostResult.entry_quality.quality_score,
        regime: currentRegime,
        consensus_score: consensus.consensus_score,
        session: sessionInfo.session,
        exit_plan: boostResult.exit_plan
      });
      const prevAlertKey = lastAlertKey.get(stateKey(symbol, version.key));
      const isNew = prevAlertKey !== r.alert_key;
      const PUSH_WHITELIST = ["pa", "trend_pullback"];
      const isPushAllowed = PUSH_WHITELIST.includes(version.family);
      if (isNew && isPushAllowed) {
        const dirEmoji = r.direction === "long" ? "\u{1F4C8}" : "\u{1F4C9}";
        const dirLabel = r.direction === "long" ? "\u505A\u591A" : "\u505A\u7A7A";
        const fmtPrice = (p) => {
          if (p >= 1e3) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (p >= 1) return p.toFixed(4);
          return p.toFixed(6);
        };
        const priceStr = fmtPrice(r.entry_price);
        const slPrice = r.sl_price ?? 0;
        const tpPrice = r.tp_price ?? 0;
        const tp2Price = r.tp2_price ?? tpPrice;
        const slStr = slPrice > 0 ? fmtPrice(slPrice) : "N/A";
        const tpStr = tpPrice > 0 ? fmtPrice(tpPrice) : "N/A";
        const tp2Str = tp2Price > 0 ? fmtPrice(tp2Price) : "N/A";
        const slDist = slPrice > 0 && r.entry_price > 0 ? Math.abs((slPrice - r.entry_price) / r.entry_price * 100).toFixed(2) : "N/A";
        const tpDist = tpPrice > 0 && r.entry_price > 0 ? Math.abs((tpPrice - r.entry_price) / r.entry_price * 100).toFixed(2) : "N/A";
        const rrRatio = slPrice > 0 && r.entry_price > 0 && tpPrice > 0 ? (Math.abs(tpPrice - r.entry_price) / Math.abs(r.entry_price - slPrice)).toFixed(2) : "N/A";
        let strategyInfo = "";
        if (version.family === "pa") {
          strategyInfo = `\u2699\uFE0F PA \u4E3B\u529B\uFF1A1D EMA200 + 15m\u78BA\u8A8D + score\u22659.0`;
        } else if (version.family === "trend_pullback") {
          strategyInfo = `\u2699\uFE0F HWR-B\uFF1A\u8DA8\u52E2\u56DE\u8E29\u5EF6\u7E8C / \u542B\u624B\u7E8C\u8CBB`;
        }
        const d1Line = version.use_1d ? `1D EMA200\uFF1A${r.d1_trend === "bullish" ? "\u{1F4CA} \u591A\u982D" : r.d1_trend === "bearish" ? "\u{1F4C9} \u7A7A\u982D" : "\u2796 \u4E2D\u6027"}` : null;
        const m15Line = version.use_15m ? `15m \u78BA\u8A8D\uFF1A${r.m15_ok ? "\u2705 \u901A\u904E" : "\u274C \u672A\u901A\u904E"}` : null;
        const exitPlan = boostResult.exit_plan;
        const qualityLine = `\u{1F3AF} \u54C1\u8CEA\u5206\uFF1A${boostResult.final_score}/100 | \u9032\u5834\u54C1\u8CEA\uFF1A${boostResult.entry_quality.quality_score}/100`;
        const regimeLine = `\u{1F4CA} \u5E02\u6CC1\uFF1A${currentRegime}\uFF08${regimeResult.confidence}%\uFF09| \u5171\u632F\uFF1A${consensus.consensus_score}\u5206${consensus.is_strong_consensus ? "\uFF08\u5F37\u5171\u632F\uFF09" : ""}`;
        const sessionLine = `\u{1F550} \u6642\u6BB5\uFF1A${sessionInfo.session}\uFF08${sessionInfo.quality_multiplier}x\uFF09| \u6CE2\u52D5\u7387\uFF1A${volAdaptive.atr_percentile}%`;
        const msg = [
          `\u{1F514} <b>${symbol} NEW-A \u65B9\u6848\u4FE1\u865F</b>${checklistResult.tier === "S" ? " \u3010S \u7D1A\u5F37\u4FE1\u865F\u3011" : checklistResult.tier === "A" ? " \u3010A \u7D1A\u6B21\u7D1A\u4FE1\u865F\u3011" : ""}`,
          ``,
          `${dirEmoji} <b>${version.label}</b>`,
          `\u65B9\u5411\uFF1A<b>${dirLabel}</b>`,
          ``,
          `\u{1F4CC} <b>\u9032\u5834\u50F9\uFF1A</b><code>${priceStr}</code>`,
          `\u{1F6D1} <b>\u6B62\u640D\uFF1A</b><code>${slStr}</code>  (-${slDist}%)`,
          `\u{1F3AF} <b>\u6B62\u76C81\uFF1A</b><code>${tpStr}</code>  (+${tpDist}%)`,
          `\u{1F3AF} <b>\u6B62\u76C82\uFF1A</b><code>${tp2Str}</code>`,
          `\u2696\uFE0F <b>RR \u6BD4\uFF1A</b>${rrRatio}`,
          ``,
          strategyInfo,
          `\u904E\u6FFE\u5F8C\u52DD\u7387\uFF1A${r.filtered_win_rate.toFixed(1)}%\uFF08${r.filtered_trades} \u7B46\uFF09`,
          d1Line,
          m15Line,
          ``,
          qualityLine,
          regimeLine,
          sessionLine,
          ``,
          `\u{1F4CA} \u4E00\u5E74\u56DE\u6E2C\uFF1A${version.backtest_return}\uFF08${version.backtest_trades}\u7B46/\u5E74\uFF09`,
          exitPlan.reasoning ? `\u{1F4AC} ${exitPlan.reasoning}` : null,
          ``,
          `\u{1F4E6} <i>NEW-A \u65B9\u6848\uFF1A12 \u9AD8\u52DD\u7387\u5E63\u5C0D \xD7 PA+HWR S \u7D1A\uFF08\u52DD\u7387 80.2% / 2.8\u5929/\u7B46\uFF09</i>`
        ].filter(Boolean).join("\n");
        await sendTelegram(msg);
        lastAlertKey.set(stateKey(symbol, version.key), r.alert_key);
        lastSignalDir.set(stateKey(symbol, version.key), r.direction);
        dispatch_results.push({
          preset_key: version.key,
          version_key: version.key,
          alert_key: r.alert_key,
          status: "sent",
          sent_at: (/* @__PURE__ */ new Date()).toISOString()
        });
        state_strategies[version.key] = {
          last_alert_key: r.alert_key,
          last_entry_time: r.signal_time,
          last_sent_at: (/* @__PURE__ */ new Date()).toISOString(),
          last_status: "sent",
          last_direction: r.direction,
          last_filter_reason: null,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          governance_summary: governance?.summary,
          checked_at: now,
          regime: currentRegime,
          boost_score: boostResult.final_score,
          entry_quality_score: boostResult.entry_quality.quality_score,
          exit_plan: boostResult.exit_plan
        };
        console.log(`[${version.short}] \u2705 \u65B0\u4FE1\u865F ${dirLabel} @ ${priceStr}\uFF08Tier ${checklistResult.tier}\uFF0C\u54C1\u8CEA ${boostResult.final_score}\u5206\uFF09\uFF0C\u5DF2\u63A8\u9001 Telegram`);
      } else if (isNew && !isPushAllowed) {
        lastAlertKey.set(stateKey(symbol, version.key), r.alert_key);
        lastSignalDir.set(stateKey(symbol, version.key), r.direction);
        dispatch_results.push({ preset_key: version.key, version_key: version.key, alert_key: r.alert_key, status: "blocked" });
        state_strategies[version.key] = {
          last_alert_key: r.alert_key,
          last_entry_time: r.signal_time,
          last_sent_at: null,
          last_status: "blocked",
          last_direction: r.direction,
          last_filter_reason: `NEW-A \u767D\u540D\u55AE\u904E\u6FFE\uFF08${version.family} \u4E0D\u5728 PA/HWR-B \u767D\u540D\u55AE\u4E2D\uFF09`,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          governance_summary: governance?.summary,
          checked_at: now
        };
        console.log(`[${version.short}] \u{1F6AB} NEW-A \u767D\u540D\u55AE\u904E\u6FFE\uFF1A${version.family} \u7B56\u7565\u4E0D\u63A8\u9001 Telegram`);
      } else {
        dispatch_results.push({ preset_key: version.key, version_key: version.key, alert_key: r.alert_key, status: "duplicate_skip" });
        state_strategies[version.key] = {
          last_alert_key: r.alert_key,
          last_entry_time: r.signal_time,
          last_status: "duplicate_skip",
          last_direction: r.direction,
          last_filter_reason: null,
          filtered_trades: r.filtered_trades,
          filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
          governance_summary: governance?.summary,
          checked_at: now
        };
        console.log(`[${version.short}] \u23ED \u4FE1\u865F\u91CD\u8907\uFF0C\u8DF3\u904E\u63A8\u9001`);
      }
    } else {
      state_strategies[version.key] = {
        last_status: r.filter_reason ? "blocked" : "idle",
        last_filter_reason: r.filter_reason ?? null,
        governance_summary: governance?.summary,
        filtered_trades: r.filtered_trades,
        filtered_win_rate: Math.round(r.filtered_win_rate * 10) / 10,
        checked_at: now
      };
      console.log(`[${version.short}] \u7121\u4FE1\u865F${r.filter_reason ? `\uFF08${r.filter_reason}\uFF09` : ""}`);
    }
  }
  const strategiesWithDiagnostics = Object.fromEntries(
    STRATEGY_VERSIONS.map((version) => {
      const currentState = state_strategies[version.key] ?? {
        last_status: "idle",
        last_filter_reason: null,
        governance_summary: getWorkerGovernance(version.key)?.summary,
        checked_at: now
      };
      const previousHistory = Array.isArray(previousStrategies?.[version.key]?.history) ? previousStrategies[version.key].history.filter((item) => item && typeof item.checked_at === "string") : [];
      const history = [...previousHistory, buildHistoryEntry(currentState, now)].slice(-DIAGNOSTIC_HISTORY_WINDOW);
      return [
        version.key,
        {
          ...currentState,
          history,
          diagnostics: buildStrategyDiagnostics(history)
        }
      ];
    })
  );
  const diagnosticsEnrichment = buildDiagnosticsEnrichment(
    strategiesWithDiagnostics,
    STRATEGY_VERSIONS.map((v) => ({ key: v.key, family: v.family, label: v.label }))
  );
  const snapshot = {
    generated_at: now,
    worker_version: "v4.4",
    active_presets: STRATEGY_VERSIONS.map((v) => ({
      key: v.key,
      label: v.label,
      family: v.family,
      tp: v.tp,
      sl: v.sl,
      use_1d: v.use_1d,
      use_15m: v.use_15m,
      backtest_return: v.backtest_return,
      backtest_trades: v.backtest_trades,
      governance: getWorkerGovernance(v.key)
    })),
    // v4.4 新增：市況與共振快照
    market_context: {
      regime: currentRegime,
      regime_confidence: regimeResult.confidence,
      adx: regimeResult.adx,
      atr_pct: regimeResult.atr_pct,
      bb_width_pct: regimeResult.bb_width_pct,
      recommended_families: regimeMap.recommended,
      avoid_families: regimeMap.avoid,
      session: sessionInfo.session,
      session_quality: sessionInfo.quality_multiplier,
      volatility_percentile: volAdaptive.atr_percentile,
      volatility_adjustment: volAdaptive.score_adjustment,
      consensus_direction: consensus.consensus_direction,
      consensus_score: consensus.consensus_score,
      consensus_strong: consensus.is_strong_consensus,
      consensus_boost: consensus.boost_multiplier
    },
    signals,
    dispatch_results,
    strategy_errors,
    state_overview: {
      last_checked_at: now,
      last_error_message: strategy_errors.length > 0 ? strategy_errors[0].error : void 0,
      history_window: DIAGNOSTIC_HISTORY_WINDOW,
      strategies: strategiesWithDiagnostics
    },
    diagnostics_enrichment: diagnosticsEnrichment
  };
  const snapshotPath = snapshotPathFor(symbol);
  try {
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    const snapshotWithSymbol = { ...snapshot, symbol, worker_version: "v4.7" };
    await fs.writeFile(snapshotPath, JSON.stringify(snapshotWithSymbol, null, 2), "utf-8");
    console.log(`[LiveWorker v4.7][${symbol}] \u2705 Snapshot \u5DF2\u5BEB\u5165 ${snapshotPath}`);
  } catch (err) {
    console.error(`[LiveWorker v4.7][${symbol}] Snapshot \u5BEB\u5165\u5931\u6557:`, err);
  }
  console.log(`[LiveWorker v4.7][${symbol}] ========== \u6383\u63CF\u5B8C\u6210 ==========
`);
}
async function runOnce() {
  console.log(`[LiveWorker v4.7] \u250F\u2501\u2501 \u591A\u5E63\u5C0D\u8F2A\u8A62\u958B\u59CB\uFF1A${SYMBOLS.join(", ")} \u2501\u2501\u2513`);
  for (const sym of SYMBOLS) {
    try {
      await runOnceForSymbol(sym);
    } catch (err) {
      console.error(`[LiveWorker v4.7][${sym}] \u6383\u63CF\u51FA\u932F:`, err);
    }
  }
  console.log(`[LiveWorker v4.7] \u2517\u2501\u2501 \u591A\u5E63\u5C0D\u8F2A\u8A62\u5B8C\u6210 \u2501\u2501\u2519
`);
}
var INTERVAL_NORMAL_MS = 2 * 60 * 1e3;
var INTERVAL_VOLATILE_MS = 1 * 60 * 1e3;
var ATR_VOLATILE_RATIO = 1.5;
function calcAtrRatio(candles) {
  if (candles.length < 20) return 1;
  const atrs = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    atrs.push(tr);
  }
  const recent14 = atrs.slice(-14);
  const avg50 = atrs.slice(-50);
  const atrNow = recent14.reduce((a, b) => a + b, 0) / recent14.length;
  const atrAvg = avg50.reduce((a, b) => a + b, 0) / avg50.length;
  return atrAvg > 0 ? atrNow / atrAvg : 1;
}
var _lastCandles1h = [];
async function scheduleNext() {
  try {
    await runOnce();
  } catch (err) {
    console.error("[LiveWorker v4.1] \u57F7\u884C\u5931\u6557:", err);
  }
  const atrRatio = calcAtrRatio(_lastCandles1h);
  const nextMs = atrRatio >= ATR_VOLATILE_RATIO ? INTERVAL_VOLATILE_MS : INTERVAL_NORMAL_MS;
  const label = atrRatio >= ATR_VOLATILE_RATIO ? `\u26A1 \u9AD8\u6CE2\u52D5\uFF08ATR\xD7${atrRatio.toFixed(2)}\uFF09\uFF0C\u7E2E\u77ED\u81F3 ${nextMs / 6e4} \u5206\u9418` : `\u6B63\u5E38\uFF08ATR\xD7${atrRatio.toFixed(2)}\uFF09\uFF0C\u7DAD\u6301 ${nextMs / 6e4} \u5206\u9418`;
  console.log(`[LiveWorker v4.2] \u4E0B\u6B21\u6383\u63CF\uFF1A${label}`);
  setTimeout(scheduleNext, nextMs);
}
console.log(`[LiveWorker v4.7] \u{1F680} NEW-A \u65B9\u6848 Worker \u555F\u52D5\uFF08${SYMBOLS.length} \u5E63\u5C0D\uFF1A${SYMBOLS.join(", ")}\uFF09`);
console.log(`[LiveWorker v4.7] \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
console.log(`[LiveWorker v4.7] NEW-A \u65B9\u6848\uFF1A12 \u9AD8\u52DD\u7387\u5E63\u5C0D \xD7 PA+HWR S \u7D1A`);
console.log(`[LiveWorker v4.7] \u76EE\u6A19\uFF1A\u52DD\u7387 80.2% / 2.8\u5929/\u7B46 / PF 4.73`);
console.log(`[LiveWorker v4.7] Telegram \u63A8\u9001\u767D\u540D\u55AE\uFF1APA + HWR-B\uFF08\u5176\u4ED6\u7B56\u7565\u50C5\u8A18\u9304\u4E0D\u63A8\u9001\uFF09`);
console.log(`[LiveWorker v4.7] \u63A8\u9001\u5167\u5BB9\uFF1A\u9032\u5834\u50F9 + \u6B62\u640D\u50F9 + \u6B62\u76C8\u50F9 + RR\u6BD4 + \u54C1\u8CEA\u5206`);
console.log(`[LiveWorker v4.7] \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
console.log(`[LiveWorker v4.7] Snapshot\uFF1A${SNAPSHOT_PATH}`);
console.log(`[LiveWorker v4.7] \u6383\u63CF\u9593\u9694\uFF1A\u6B63\u5E38 ${INTERVAL_NORMAL_MS / 6e4} \u5206\u9418 / \u9AD8\u6CE2\u52D5 ${INTERVAL_VOLATILE_MS / 6e4} \u5206\u9418`);
scheduleNext();
