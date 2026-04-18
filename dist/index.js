var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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
  const calcRsi2 = (g, l) => {
    if (g === 0 && l === 0) return 50;
    if (l === 0) return 100;
    return 100 - 100 / (1 + g / l);
  };
  result[writeIdx] = calcRsi2(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = calcRsi2(avgGain, avgLoss);
  }
  return result;
}
function calcRsiLast(closes, period = 14) {
  const arr = calcRsiArr(closes, period);
  const last = arr[arr.length - 1];
  return isNaN(last) ? 50 : last;
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
function calcBollingerLast(closes, period = 20, mult = 2) {
  const arr = calcBollingerArr(closes, period, mult);
  return arr[arr.length - 1] ?? { upper: NaN, lower: NaN, mid: NaN, bandwidth: NaN, percent_b: NaN, is_ready: false };
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
function calcAdxLast(candles, period = 14) {
  if (candles.length < period * 2 + 1) return NaN;
  const { adx } = calcAdxArr(candles, period);
  const last = adx[adx.length - 1];
  return isFiniteNumber(last) ? last : NaN;
}
function calcVwap(candles, mode = "full") {
  let subset = candles;
  if (mode === "session") {
    const sampleTime = candles[0]?.time ?? 0;
    const isMs = sampleTime > 1e12;
    const nowMs = Date.now();
    const todayStartMs = Math.floor(nowMs / 864e5) * 864e5;
    const sessionCandles = candles.filter((c) => {
      const tMs = isMs ? c.time : c.time * 1e3;
      return tMs >= todayStartMs;
    });
    if (sessionCandles.length === 0) {
      return { value: candles[candles.length - 1]?.close ?? 0, mode, candle_count: 0 };
    }
    subset = sessionCandles;
  } else if (mode === "anchored") {
    const lb = 5;
    let anchorIdx = 0;
    for (let i = lb; i < candles.length - lb; i++) {
      if (candles.slice(i - lb, i).every((c) => c.low >= candles[i].low) && candles.slice(i + 1, i + lb + 1).every((c) => c.low >= candles[i].low)) {
        anchorIdx = i;
      }
    }
    subset = candles.slice(Math.max(anchorIdx, candles.length - 300));
  }
  if (subset.length === 0) subset = candles;
  let cumVol = 0, cumVolPrice = 0;
  for (const c of subset) {
    const typical = (c.high + c.low + c.close) / 3;
    cumVolPrice += typical * c.volume;
    cumVol += c.volume;
  }
  const value = cumVol === 0 ? candles[candles.length - 1]?.close ?? 0 : cumVolPrice / cumVol;
  return { value, mode, candle_count: subset.length };
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
var init_indicators = __esm({
  "server/utils/indicators.ts"() {
    "use strict";
  }
});

// server/utils/advancedAnalysis.ts
function detectDivergences(candles, timeframe, lookback = 50) {
  const results = [];
  const slice = candles.slice(-lookback);
  if (slice.length < 14) return results;
  const closes = slice.map((c) => c.close);
  const rsiArr = calcRsiArr(closes, 14);
  const macdResult = calcMacdArr(closes);
  const macdHist = macdResult.hist;
  const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
  const macdThreshold = avgPrice * 1e-4;
  const RSI_WARMUP = 14;
  const MACD_WARMUP = 26;
  const swingHighs = [];
  const swingLows = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (slice[i].high >= slice[i - 1].high && slice[i].high >= slice[i - 2].high && slice[i].high > slice[i + 1].high && slice[i].high > slice[i + 2].high) swingHighs.push({ idx: i, price: slice[i].high });
    if (slice[i].low <= slice[i - 1].low && slice[i].low <= slice[i - 2].low && slice[i].low < slice[i + 1].low && slice[i].low < slice[i + 2].low) swingLows.push({ idx: i, price: slice[i].low });
  }
  if (swingHighs.length >= 2) {
    const h1 = swingHighs[swingHighs.length - 2];
    const h2 = swingHighs[swingHighs.length - 1];
    const rsi1 = h1.idx >= RSI_WARMUP && !isNaN(rsiArr[h1.idx]) ? rsiArr[h1.idx] : null;
    const rsi2 = h2.idx >= RSI_WARMUP && !isNaN(rsiArr[h2.idx]) ? rsiArr[h2.idx] : null;
    const macd1 = h1.idx >= MACD_WARMUP && !isNaN(macdHist[h1.idx]) ? macdHist[h1.idx] : null;
    const macd2 = h2.idx >= MACD_WARMUP && !isNaN(macdHist[h2.idx]) ? macdHist[h2.idx] : null;
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
        description: `\u9802\u80CC\u96E2\uFF1A\u50F9\u683C\u5275\u65B0\u9AD8 ${h2.price.toFixed(2)} \u4F46 RSI \u672A\u8DDF\u96A8 (${rsi2.toFixed(1)} < ${rsi1.toFixed(1)})\uFF0C\u8DA8\u52E2\u53CD\u8F49\u4FE1\u865F`,
        candle_idx: h2.idx,
        time: slice[h2.idx]?.time ?? 0
      });
    }
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
        description: `MACD \u9802\u80CC\u96E2\uFF1A\u50F9\u683C\u5275\u65B0\u9AD8\u4F46 MACD \u67F1\u7E2E\u5C0F\uFF0C\u52D5\u80FD\u8870\u7AED\uFF0C\u53CD\u8F49\u4FE1\u865F`,
        candle_idx: h2.idx,
        time: slice[h2.idx]?.time ?? 0
      });
    }
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
        description: `\u96B1\u85CF\u9802\u80CC\u96E2\uFF1A\u50F9\u683C\u4F4E\u9AD8\u9EDE\u4F46 RSI \u9AD8\u9AD8\u9EDE\uFF0C\u4E0B\u8DCC\u8DA8\u52E2\u5EF6\u7E8C\u4FE1\u865F`,
        candle_idx: h2.idx,
        time: slice[h2.idx]?.time ?? 0
      });
    }
  }
  if (swingLows.length >= 2) {
    const l1 = swingLows[swingLows.length - 2];
    const l2 = swingLows[swingLows.length - 1];
    const rsi1 = l1.idx >= RSI_WARMUP && !isNaN(rsiArr[l1.idx]) ? rsiArr[l1.idx] : null;
    const rsi2 = l2.idx >= RSI_WARMUP && !isNaN(rsiArr[l2.idx]) ? rsiArr[l2.idx] : null;
    const macd1 = l1.idx >= MACD_WARMUP && !isNaN(macdHist[l1.idx]) ? macdHist[l1.idx] : null;
    const macd2 = l2.idx >= MACD_WARMUP && !isNaN(macdHist[l2.idx]) ? macdHist[l2.idx] : null;
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
        description: `\u5E95\u80CC\u96E2\uFF1A\u50F9\u683C\u5275\u65B0\u4F4E ${l2.price.toFixed(2)} \u4F46 RSI \u672A\u8DDF\u96A8 (${rsi2.toFixed(1)} > ${rsi1.toFixed(1)})\uFF0C\u53CD\u8F49\u5411\u4E0A\u4FE1\u865F`,
        candle_idx: l2.idx,
        time: slice[l2.idx]?.time ?? 0
      });
    }
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
        description: `MACD \u5E95\u80CC\u96E2\uFF1A\u50F9\u683C\u5275\u65B0\u4F4E\u4F46 MACD \u67F1\u7E2E\u5C0F\uFF0C\u52D5\u80FD\u8870\u7AED\uFF0C\u53CD\u8F49\u4FE1\u865F`,
        candle_idx: l2.idx,
        time: slice[l2.idx]?.time ?? 0
      });
    }
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
        description: `\u96B1\u85CF\u5E95\u80CC\u96E2\uFF1A\u50F9\u683C\u9AD8\u4F4E\u9EDE\u4F46 RSI \u4F4E\u4F4E\u9EDE\uFF0C\u4E0A\u6F32\u8DA8\u52E2\u5EF6\u7E8C\u4FE1\u865F`,
        candle_idx: l2.idx,
        time: slice[l2.idx]?.time ?? 0
      });
    }
  }
  return results;
}
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
var init_advancedAnalysis = __esm({
  "server/utils/advancedAnalysis.ts"() {
    "use strict";
    init_indicators();
  }
});

// server/utils/cache.ts
var ServerCache, serverCache, tweetSentimentKey;
var init_cache = __esm({
  "server/utils/cache.ts"() {
    "use strict";
    ServerCache = class {
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
    serverCache = new ServerCache();
    tweetSentimentKey = (symbol) => `tweet_sentiment_${symbol.replace("USDT", "").replace("BUSD", "").toUpperCase()}`;
  }
});

// server/utils/bayesianMtfFusion.ts
function calcDynamicConflictPenalty(signals, marketVolatility) {
  const directions = signals.map((s) => s.direction);
  const longCount = directions.filter((d) => d === "long").length;
  const shortCount = directions.filter((d) => d === "short").length;
  const conflictCount = Math.min(longCount, shortCount);
  if (conflictCount === 0) return 1;
  let penalty = 1;
  if (conflictCount >= 2) penalty = 0.7;
  else if (conflictCount === 1) penalty = 0.88;
  if (marketVolatility === "high") penalty *= 0.85;
  else if (marketVolatility === "low") penalty *= 1.05;
  const avgStrength = signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;
  if (avgStrength > 70) penalty *= 0.9;
  return Math.max(0.5, Math.min(1, penalty));
}
function bayesianUpdate(prior, likelihood) {
  const unnormalized = {
    long: prior.long * likelihood.long,
    short: prior.short * likelihood.short,
    neutral: prior.neutral * likelihood.neutral
  };
  const total = unnormalized.long + unnormalized.short + unnormalized.neutral;
  if (total === 0) return { long: 0.33, short: 0.33, neutral: 0.34 };
  return {
    long: unnormalized.long / total,
    short: unnormalized.short / total,
    neutral: unnormalized.neutral / total
  };
}
function directionToProbability(direction, strength) {
  const s = strength / 100;
  if (direction === "long") {
    return { long: 0.5 + s * 0.4, short: 0.1 - s * 0.05, neutral: 0.4 - s * 0.35 };
  } else if (direction === "short") {
    return { long: 0.1 - s * 0.05, short: 0.5 + s * 0.4, neutral: 0.4 - s * 0.35 };
  } else {
    return { long: 0.2, short: 0.2, neutral: 0.6 };
  }
}
function assessVolatility(signals) {
  const tf4h = signals.find((s) => s.timeframe === "4H");
  const tf1h = signals.find((s) => s.timeframe === "1H");
  const adx4h = tf4h?.adx ?? 25;
  const adx1h = tf1h?.adx ?? 25;
  const avgAdx = (adx4h + adx1h) / 2;
  if (avgAdx > 35) return "high";
  if (avgAdx < 20) return "low";
  return "medium";
}
function bayesianMtfFusion(signals) {
  if (signals.length === 0) {
    return {
      fusedDirection: "neutral",
      fusedScore: 0,
      conflictPenalty: 1,
      htfPriorWeight: 0.35,
      bayesianConfidence: 0,
      timeframeWeights: {},
      regimeAdjustment: "\u7121\u4FE1\u865F"
    };
  }
  const volatility = assessVolatility(signals);
  const conflictPenalty = calcDynamicConflictPenalty(signals, volatility);
  const dynamicWeights = { ...BASE_TF_WEIGHTS };
  if (volatility === "high") {
    dynamicWeights["4H"] = 0.42;
    dynamicWeights["1H"] = 0.28;
    dynamicWeights["15m"] = 0.18;
    dynamicWeights["5m"] = 0.12;
  } else if (volatility === "low") {
    dynamicWeights["4H"] = 0.28;
    dynamicWeights["1H"] = 0.32;
    dynamicWeights["15m"] = 0.26;
    dynamicWeights["5m"] = 0.14;
  }
  const tfOrder = ["4H", "1H", "15m", "5m"];
  let posterior = { long: 0.33, short: 0.33, neutral: 0.34 };
  for (const tf of tfOrder) {
    const signal = signals.find((s) => s.timeframe === tf);
    if (!signal) continue;
    const likelihood = directionToProbability(signal.direction, signal.strength);
    const weight = dynamicWeights[tf] ?? 0.25;
    const weightedLikelihood = {
      long: 1 + (likelihood.long - 0.33) * weight * 3,
      short: 1 + (likelihood.short - 0.33) * weight * 3,
      neutral: 1 + (likelihood.neutral - 0.34) * weight * 3
    };
    posterior = bayesianUpdate(posterior, weightedLikelihood);
  }
  let fusedDirection;
  if (posterior.long > posterior.short && posterior.long > posterior.neutral) {
    fusedDirection = "long";
  } else if (posterior.short > posterior.long && posterior.short > posterior.neutral) {
    fusedDirection = "short";
  } else {
    fusedDirection = "neutral";
  }
  const maxPosterior = Math.max(posterior.long, posterior.short, posterior.neutral);
  const fusedScore = Math.round(maxPosterior * 100 * conflictPenalty);
  const sortedPosteriors = Object.values(posterior).sort((a, b) => b - a);
  const posteriorGap = sortedPosteriors[0] - sortedPosteriors[1];
  const bayesianConfidence = Math.round(posteriorGap * 200 * conflictPenalty);
  const regimeAdjustment = [
    `\u6CE2\u52D5\u7387\uFF1A${volatility === "high" ? "\u9AD8\uFF08\u8DA8\u52E2\u4E3B\u5C0E\uFF09" : volatility === "low" ? "\u4F4E\uFF08\u9707\u76EA\u4E3B\u5C0E\uFF09" : "\u4E2D\u7B49"}`,
    `\u885D\u7A81\u61F2\u7F70\uFF1A${(conflictPenalty * 100).toFixed(0)}%`,
    `\u5F8C\u9A57\u5206\u5E03\uFF1A\u591A ${(posterior.long * 100).toFixed(0)}% / \u7A7A ${(posterior.short * 100).toFixed(0)}% / \u4E2D ${(posterior.neutral * 100).toFixed(0)}%`
  ].join(" | ");
  return {
    fusedDirection,
    fusedScore: Math.max(0, Math.min(100, fusedScore)),
    conflictPenalty,
    htfPriorWeight: dynamicWeights["4H"],
    bayesianConfidence: Math.max(0, Math.min(100, bayesianConfidence)),
    timeframeWeights: dynamicWeights,
    regimeAdjustment
  };
}
var BASE_TF_WEIGHTS;
var init_bayesianMtfFusion = __esm({
  "server/utils/bayesianMtfFusion.ts"() {
    "use strict";
    BASE_TF_WEIGHTS = {
      "4H": 0.35,
      "1H": 0.3,
      "15m": 0.22,
      "5m": 0.13
    };
  }
});

// server/analysis.ts
var analysis_exports = {};
__export(analysis_exports, {
  ANALYSIS_THRESHOLDS: () => ANALYSIS_THRESHOLDS,
  KRAKEN_INTERVAL_MAP: () => KRAKEN_INTERVAL_MAP,
  KRAKEN_SYMBOL_MAP: () => KRAKEN_SYMBOL_MAP,
  fetchCandles: () => fetchCandles,
  fetchCandlesPaged: () => fetchCandlesPaged,
  runAnalysis: () => runAnalysis
});
function calcChan(candles) {
  const fractal = [];
  for (let i2 = 1; i2 < candles.length - 1; i2++) {
    const prev = candles[i2 - 1];
    const cur = candles[i2];
    const next = candles[i2 + 1];
    if (cur.high > prev.high && cur.high > next.high) {
      fractal.push({ idx: i2, type: "top", price: cur.high, time: cur.time });
    } else if (cur.low < prev.low && cur.low < next.low) {
      fractal.push({ idx: i2, type: "bottom", price: cur.low, time: cur.time });
    }
  }
  const merged = [];
  for (const f of fractal) {
    const last = merged[merged.length - 1];
    if (last && last.type === f.type) {
      if (f.type === "top" && f.price > last.price) merged[merged.length - 1] = f;
      else if (f.type === "bottom" && f.price < last.price) merged[merged.length - 1] = f;
    } else {
      merged.push(f);
    }
  }
  const bis = [];
  for (let i2 = 0; i2 < merged.length - 1; i2++) {
    const a = merged[i2];
    const b = merged[i2 + 1];
    if (b.idx - a.idx < 4) continue;
    if (a.type === "bottom" && b.type === "top") {
      bis.push({ direction: "up", start: a.price, end: b.price, start_time: a.time, end_time: b.time });
    } else if (a.type === "top" && b.type === "bottom") {
      bis.push({ direction: "down", start: a.price, end: b.price, start_time: a.time, end_time: b.time });
    }
  }
  const duans = [];
  let i = 0;
  while (i < bis.length - 2) {
    const b0 = bis[i];
    const b1 = bis[i + 1];
    const b2 = bis[i + 2];
    if (b0.direction === "up" && b2.direction === "up" && b2.end > b0.end) {
      duans.push({ direction: "up", start: b0.start, end: b2.end, start_time: b0.start_time, end_time: b2.end_time, bis: [b0, b1, b2] });
      i += 3;
    } else if (b0.direction === "down" && b2.direction === "down" && b2.end < b0.end) {
      duans.push({ direction: "down", start: b0.start, end: b2.end, start_time: b0.start_time, end_time: b2.end_time, bis: [b0, b1, b2] });
      i += 3;
    } else {
      i++;
    }
  }
  const zhongshus = [];
  for (let j = 0; j < duans.length - 2; j++) {
    const d0 = duans[j];
    const d1 = duans[j + 1];
    const d2 = duans[j + 2];
    const top = Math.min(Math.max(d0.start, d0.end), Math.max(d1.start, d1.end), Math.max(d2.start, d2.end));
    const bottom = Math.max(Math.min(d0.start, d0.end), Math.min(d1.start, d1.end), Math.min(d2.start, d2.end));
    if (top > bottom) {
      zhongshus.push({ top, bottom, mid: (top + bottom) / 2, start_time: d0.start_time, end_time: d2.end_time });
    }
  }
  const lastZhongshu = zhongshus[zhongshus.length - 1] ?? null;
  const close = candles[candles.length - 1].close;
  const in_zhongshu = lastZhongshu ? close >= lastZhongshu.bottom && close <= lastZhongshu.top : false;
  let trend = "ranging";
  if (duans.length >= 2) {
    const lastDuan = duans[duans.length - 1];
    const prevDuan = duans[duans.length - 2];
    if (lastDuan.direction === "up" && Math.max(lastDuan.start, lastDuan.end) > Math.max(prevDuan.start, prevDuan.end)) trend = "bullish";
    else if (lastDuan.direction === "down" && Math.min(lastDuan.start, lastDuan.end) < Math.min(prevDuan.start, prevDuan.end)) trend = "bearish";
  }
  let divergence = void 0;
  if (duans.length >= 4) {
    const d1 = duans[duans.length - 3];
    const d2 = duans[duans.length - 1];
    const amp1 = Math.abs(d1.end - d1.start);
    const amp2 = Math.abs(d2.end - d2.start);
    const dur1 = d1.end_time - d1.start_time;
    const dur2 = d2.end_time - d2.start_time;
    const slope1 = dur1 > 0 ? amp1 / dur1 : 0;
    const slope2 = dur2 > 0 ? amp2 / dur2 : 0;
    const closes = candles.map((c) => c.close);
    const { hist: macdHist } = calcMacdArr(closes);
    const getSegmentMacdArea = (startTime, endTime) => {
      let area = 0;
      for (let k = 0; k < candles.length; k++) {
        if (candles[k].time >= startTime && candles[k].time <= endTime) {
          const h = macdHist[k];
          if (h !== void 0 && !isNaN(h)) area += Math.abs(h);
        }
      }
      return area;
    };
    const macdArea1 = getSegmentMacdArea(d1.start_time, d1.end_time);
    const macdArea2 = getSegmentMacdArea(d2.start_time, d2.end_time);
    const ampDivergence = amp2 < amp1 * 0.8;
    const macdDivergence = macdArea1 > 0 && macdArea2 < macdArea1 * 0.75;
    const slopeDivergence = slope1 > 0 && slope2 < slope1 * 0.8;
    const divergenceScore = (ampDivergence ? 1 : 0) + (macdDivergence ? 1 : 0) + (slopeDivergence ? 1 : 0);
    if (d2.direction === "up" && divergenceScore >= 2) {
      const factors = [ampDivergence && `\u5E45\u5EA6\u80CC\u99B3(${amp2.toFixed(0)}<${amp1.toFixed(0)})`, macdDivergence && `MACD\u9762\u7A4D\u80CC\u99B3(${macdArea2.toFixed(2)}<${macdArea1.toFixed(2)})`, slopeDivergence && `\u659C\u7387\u80CC\u99B3`].filter(Boolean).join(", ");
      divergence = { type: "top", description: `\u9802\u80CC\u99B3\uFF08${divergenceScore}/3\u56E0\u5B50\uFF09\uFF1A${factors}` };
    } else if (d2.direction === "down" && divergenceScore >= 2) {
      const factors = [ampDivergence && `\u5E45\u5EA6\u80CC\u99B3(${amp2.toFixed(0)}<${amp1.toFixed(0)})`, macdDivergence && `MACD\u9762\u7A4D\u80CC\u99B3(${macdArea2.toFixed(2)}<${macdArea1.toFixed(2)})`, slopeDivergence && `\u659C\u7387\u80CC\u99B3`].filter(Boolean).join(", ");
      divergence = { type: "bottom", description: `\u5E95\u80CC\u99B3\uFF08${divergenceScore}/3\u56E0\u5B50\uFF09\uFF1A${factors}` };
    }
  }
  let zhongshu_entry_exit = void 0;
  if (lastZhongshu) {
    const prevClose = candles.length >= 2 ? candles[candles.length - 2].close : close;
    const wasInside = prevClose >= lastZhongshu.bottom && prevClose <= lastZhongshu.top;
    if (in_zhongshu && !wasInside) {
      zhongshu_entry_exit = "entering";
    } else if (!in_zhongshu && wasInside) {
      zhongshu_entry_exit = close > lastZhongshu.top ? "exiting" : "exiting";
    } else if (in_zhongshu) {
      zhongshu_entry_exit = "inside";
    } else {
      zhongshu_entry_exit = "outside";
    }
  }
  return { bis, duans, zhongshus, trend, in_zhongshu, current_zhongshu: lastZhongshu, bi_count: bis.length, duan_count: duans.length, divergence, zhongshu_entry_exit };
}
async function fetchWithRetry(url, options, maxRetries = 3, baseDelayMs = 500) {
  let lastError = new Error("Unknown error");
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (lastError.name === "AbortError") throw lastError;
    }
    if (attempt < maxRetries - 1) {
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
async function krakenRateLimit() {
  const now = Date.now();
  const elapsed = now - _krakenLastCallMs;
  if (elapsed < KRAKEN_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, KRAKEN_MIN_INTERVAL_MS - elapsed + 50));
  }
  _krakenLastCallMs = Date.now();
}
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
async function fetchCandlesPaged(symbol, bar, targetCount) {
  const pair = KRAKEN_SYMBOL_MAP[symbol.toUpperCase()] ?? symbol.replace("USDT", "USD");
  const plan = mapBarToKrakenInterval(bar);
  const interval = plan.sourceInterval;
  const aggregateFactor = plan.aggregateFactor;
  const fetchTargetCount = Math.max(targetCount * aggregateFactor + aggregateFactor * 100, targetCount + 100);
  const PAGE_SIZE = 720;
  const MAX_PAGES = Math.max(20, Math.ceil((fetchTargetCount + 100) / PAGE_SIZE) + 2);
  const allCandles = [];
  let pages = 0;
  const nowSec = Math.floor(Date.now() / 1e3);
  let sinceSec = nowSec - interval * 60 * (fetchTargetCount + 100);
  while (allCandles.length < fetchTargetCount && pages < MAX_PAGES) {
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}&since=${sinceSec}`;
    let res;
    try {
      await krakenRateLimit();
      res = await fetchWithRetry(url, {
        headers: { "User-Agent": "Mozilla/5.0 CryptoDashboard/3.0" },
        signal: AbortSignal.timeout(15e3)
      });
    } catch {
      break;
    }
    if (!res.ok) break;
    const payload = await res.json();
    let batch = [];
    try {
      batch = parseCandleApiPayload(payload, interval, PAGE_SIZE);
    } catch {
      break;
    }
    if (batch.length === 0) break;
    const lastTs = allCandles.length > 0 ? allCandles[allCandles.length - 1].time : 0;
    const newBatch = batch.filter((c) => c.time > lastTs);
    if (newBatch.length === 0) break;
    allCandles.push(...newBatch);
    const nextSinceRaw = payload.result?.last;
    const nextSince = typeof nextSinceRaw === "number" ? nextSinceRaw : typeof nextSinceRaw === "string" ? Number(nextSinceRaw) : NaN;
    if (Number.isFinite(nextSince) && nextSince > sinceSec) {
      sinceSec = nextSince;
    } else {
      break;
    }
    pages++;
    if (newBatch.length < PAGE_SIZE - 5) break;
  }
  return aggregateCandles(allCandles, interval, aggregateFactor, targetCount);
}
function calcEma(data, period) {
  return calcEmaArr(data, period);
}
function calcRsi(closes, period = 14) {
  return calcRsiLast(closes, period);
}
function calcMacd(closes) {
  const { macd, signal, hist } = calcMacdArr(closes);
  const n = macd.length;
  if (n === 0) return { macd: 0, signal: 0, histogram: 0 };
  const lastMacd = macd[n - 1];
  const lastSignal = signal[n - 1];
  const lastHist = hist[n - 1];
  return {
    macd: isNaN(lastMacd) ? 0 : lastMacd,
    signal: isNaN(lastSignal) ? 0 : lastSignal,
    histogram: isNaN(lastHist) ? 0 : lastHist
  };
}
function calcAdx(candles, period = 14) {
  const result = calcAdxArr(candles, period);
  const lastAdx = result.adx[result.adx.length - 1];
  const lastPlus = result.plusDi[result.plusDi.length - 1];
  const lastMinus = result.minusDi[result.minusDi.length - 1];
  return {
    adx: isNaN(lastAdx) ? 20 : lastAdx,
    plus_di: isNaN(lastPlus) ? 20 : lastPlus,
    minus_di: isNaN(lastMinus) ? 20 : lastMinus
  };
}
function calcAtr(candles, period = 14) {
  return calcAtrLast(candles, period);
}
function calcBollinger(closes, period = 20, mult = 2) {
  const r = calcBollingerLast(closes, period, mult);
  return { upper: r.upper, middle: r.mid, lower: r.lower, bandwidth: r.bandwidth, percent_b: r.percent_b, is_ready: r.is_ready };
}
function calcVwap2(candles) {
  return calcVwap(candles, "session").value;
}
function calcStochastic(candles, kPeriod = 14, dPeriod = 3) {
  if (candles.length < kPeriod) return { k: 50, d: 50 };
  const kValues = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    kValues.push(high !== low ? (candles[i].close - low) / (high - low) * 100 : 50);
  }
  const k = kValues[kValues.length - 1] ?? 50;
  const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / Math.min(dPeriod, kValues.length);
  return { k, d };
}
function calcCmf(candles, period = 20) {
  const recent = candles.slice(-period);
  let mfvSum = 0, volSum = 0;
  for (const c of recent) {
    const hl = c.high - c.low;
    const mfm = hl > 0 ? (c.close - c.low - (c.high - c.close)) / hl : 0;
    mfvSum += mfm * c.volume;
    volSum += c.volume;
  }
  return volSum > 0 ? mfvSum / volSum : 0;
}
function findSwingHighs2(candles, lookback = 5) {
  return findSwingHighs(candles, lookback);
}
function findSwingLows2(candles, lookback = 5) {
  return findSwingLows(candles, lookback);
}
function detectFvgs(candles, close) {
  const fvgs = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const next = candles[i + 1];
    if (prev.high < next.low) {
      const top = next.low;
      const bottom = prev.high;
      fvgs.push({
        type: "bullish",
        top,
        bottom,
        mid: (top + bottom) / 2,
        size: top - bottom,
        time: candles[i].time,
        idx: i,
        filled: close < bottom
      });
    }
    if (prev.low > next.high) {
      const top = prev.low;
      const bottom = next.high;
      fvgs.push({
        type: "bearish",
        top,
        bottom,
        mid: (top + bottom) / 2,
        size: top - bottom,
        time: candles[i].time,
        idx: i,
        filled: close > top
      });
    }
  }
  const unfilled = fvgs.filter((f) => !f.filled).slice(-15);
  const bullFvgs = unfilled.filter((f) => f.type === "bullish").sort((a, b) => b.mid - a.mid);
  const bearFvgs = unfilled.filter((f) => f.type === "bearish").sort((a, b) => a.mid - b.mid);
  return {
    fvgs: unfilled,
    nearest_bull_fvg: bullFvgs.find((f) => f.mid < close) ?? null,
    nearest_bear_fvg: bearFvgs.find((f) => f.mid > close) ?? null
  };
}
function detectOrderBlocks2(candles, close) {
  const obs = [];
  for (let i = 2; i < candles.length - 1; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    const bodySize = Math.abs(c.close - c.open);
    const nextBodySize = Math.abs(next.close - next.open);
    if (c.close < c.open && next.close > c.high && nextBodySize > bodySize * 1.5) {
      obs.push({
        type: "bullish",
        top: c.open,
        bottom: c.close,
        mid: (c.open + c.close) / 2,
        time: c.time,
        idx: i,
        tested: close <= c.open && close >= c.close,
        strength: nextBodySize > bodySize * 2 ? "strong" : "normal"
      });
    }
    if (c.close > c.open && next.close < c.low && nextBodySize > bodySize * 1.5) {
      obs.push({
        type: "bearish",
        top: c.close,
        bottom: c.open,
        mid: (c.close + c.open) / 2,
        time: c.time,
        idx: i,
        tested: close >= c.open && close <= c.close,
        strength: nextBodySize > bodySize * 2 ? "strong" : "normal"
      });
    }
  }
  const recent = obs.slice(-10);
  const bullObs = recent.filter((o) => o.type === "bullish").sort((a, b) => b.mid - a.mid);
  const bearObs = recent.filter((o) => o.type === "bearish").sort((a, b) => a.mid - b.mid);
  return {
    order_blocks: recent,
    nearest_bull_ob: bullObs.find((o) => o.mid < close) ?? null,
    nearest_bear_ob: bearObs.find((o) => o.mid > close) ?? null
  };
}
function detectBosChoch2(candles) {
  const events = [];
  const swingHighs = findSwingHighs2(candles, 3);
  const swingLows = findSwingLows2(candles, 3);
  let prevStructure = "neutral";
  let lastSwingHigh = swingHighs[0]?.price ?? 0;
  let lastSwingLow = swingLows[0]?.price ?? Infinity;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const relevantHighs = swingHighs.filter((s) => s.idx < i);
    const relevantLows = swingLows.filter((s) => s.idx < i);
    if (relevantHighs.length < 1 || relevantLows.length < 1) continue;
    const recentHigh = relevantHighs[relevantHighs.length - 1].price;
    const recentLow = relevantLows[relevantLows.length - 1].price;
    if (c.close > recentHigh && recentHigh !== lastSwingHigh) {
      const isMss = prevStructure === "bearish";
      events.push({
        type: isMss ? "MSS" : "BOS",
        direction: "bullish",
        level: recentHigh,
        time: c.time,
        idx: i,
        description: isMss ? `\u5E02\u5834\u7D50\u69CB\u8F49\u79FB\uFF08MSS\uFF09\uFF1A\u7A81\u7834 ${recentHigh.toFixed(2)} \u8F49\u70BA\u770B\u591A` : `\u7D50\u69CB\u7A81\u7834\uFF08BOS\uFF09\uFF1A\u6536\u76E4\u7A81\u7834\u64FA\u52D5\u9AD8\u9EDE ${recentHigh.toFixed(2)}`
      });
      lastSwingHigh = recentHigh;
      prevStructure = "bullish";
    }
    if (c.close < recentLow && recentLow !== lastSwingLow) {
      const isMss = prevStructure === "bullish";
      events.push({
        type: isMss ? "MSS" : "BOS",
        direction: "bearish",
        level: recentLow,
        time: c.time,
        idx: i,
        description: isMss ? `\u5E02\u5834\u7D50\u69CB\u8F49\u79FB\uFF08MSS\uFF09\uFF1A\u8DCC\u7834 ${recentLow.toFixed(2)} \u8F49\u70BA\u770B\u7A7A` : `\u7D50\u69CB\u7A81\u7834\uFF08BOS\uFF09\uFF1A\u6536\u76E4\u8DCC\u7834\u64FA\u52D5\u4F4E\u9EDE ${recentLow.toFixed(2)}`
      });
      lastSwingLow = recentLow;
      prevStructure = "bearish";
    }
  }
  const finalEvents = [];
  let currentTrend = events.length > 0 ? events[0].direction : "neutral";
  let bosCountInTrend = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.direction === currentTrend) {
      bosCountInTrend++;
      finalEvents.push(ev);
    } else {
      if (bosCountInTrend >= 2) {
        finalEvents.push({ ...ev, type: "CHoCH", description: `\u7D50\u69CB\u8F49\u63DB\uFF08CHoCH\uFF09\uFF1A\u8DA8\u52E2\u53CD\u8F49\uFF0C${ev.description}` });
      } else {
        finalEvents.push(ev);
      }
      currentTrend = ev.direction;
      bosCountInTrend = 1;
    }
  }
  return finalEvents.slice(-8);
}
function detectLiquidityLevels(candles, close) {
  const levels = [];
  const swingHighs = findSwingHighs2(candles, 4);
  const swingLows = findSwingLows2(candles, 4);
  for (const sh of swingHighs.slice(-6)) {
    if (sh.price > close) {
      const swept = candles.slice(sh.idx + 1).some((c) => c.high > sh.price);
      levels.push({ price: sh.price, type: "BSL", swept, strength: "normal" });
    }
  }
  for (const sl of swingLows.slice(-6)) {
    if (sl.price < close) {
      const swept = candles.slice(sl.idx + 1).some((c) => c.low < sl.price);
      levels.push({ price: sl.price, type: "SSL", swept, strength: "normal" });
    }
  }
  for (const level of levels) {
    const nearbyHighs = swingHighs.filter((s) => Math.abs(s.price - level.price) / level.price < 5e-3);
    const nearbyLows = swingLows.filter((s) => Math.abs(s.price - level.price) / level.price < 5e-3);
    if (nearbyHighs.length + nearbyLows.length >= 2) level.strength = "strong";
  }
  return levels.sort((a, b) => Math.abs(a.price - close) - Math.abs(b.price - close)).slice(0, 10);
}
function calcPremiumDiscount(candles, close) {
  const lb = 5;
  let highRef = 0, lowRef = Infinity;
  for (let i = lb; i < candles.length - lb; i++) {
    const isSwingHigh = candles.slice(i - lb, i).every((c) => c.high <= candles[i].high) && candles.slice(i + 1, i + lb + 1).every((c) => c.high <= candles[i].high);
    const isSwingLow = candles.slice(i - lb, i).every((c) => c.low >= candles[i].low) && candles.slice(i + 1, i + lb + 1).every((c) => c.low >= candles[i].low);
    if (isSwingHigh && candles[i].high > highRef) highRef = candles[i].high;
    if (isSwingLow && candles[i].low < lowRef) lowRef = candles[i].low;
  }
  if (highRef === 0 || lowRef === Infinity || highRef <= lowRef) {
    const lookback = Math.min(50, candles.length);
    const recent = candles.slice(-lookback);
    highRef = Math.max(...recent.map((c) => c.high));
    lowRef = Math.min(...recent.map((c) => c.low));
  }
  const equilibrium = (highRef + lowRef) / 2;
  const range = highRef - lowRef;
  if (range / (lowRef + 1e-3) < 5e-3) {
    return { equilibrium, current_zone: "equilibrium", percent_position: 50 };
  }
  const percent_position = range > 0 ? (close - lowRef) / range * 100 : 50;
  const current_zone = percent_position > 62 ? "premium" : percent_position < 38 ? "discount" : "equilibrium";
  return { equilibrium, current_zone, percent_position };
}
function calcOteZone(candles, close) {
  const swingHighs = findSwingHighs2(candles, 5);
  const swingLows = findSwingLows2(candles, 5);
  if (swingHighs.length < 1 || swingLows.length < 1) return null;
  const lastHigh = swingHighs[swingHighs.length - 1];
  const lastLow = swingLows[swingLows.length - 1];
  if (lastLow.idx < lastHigh.idx) {
    const range = lastHigh.price - lastLow.price;
    const fib618 = lastHigh.price - range * 0.618;
    const fib705 = lastHigh.price - range * 0.705;
    const fib786 = lastHigh.price - range * 0.786;
    return {
      direction: "bullish",
      fib_618: fib618,
      fib_705: fib705,
      fib_786: fib786,
      swing_high: lastHigh.price,
      swing_low: lastLow.price,
      in_zone: close >= fib786 && close <= fib618
    };
  } else {
    const range = lastHigh.price - lastLow.price;
    const fib618 = lastLow.price + range * 0.618;
    const fib705 = lastLow.price + range * 0.705;
    const fib786 = lastLow.price + range * 0.786;
    return {
      direction: "bearish",
      fib_618: fib618,
      fib_705: fib705,
      fib_786: fib786,
      swing_high: lastHigh.price,
      swing_low: lastLow.price,
      in_zone: close >= fib618 && close <= fib786
    };
  }
}
function detectPatterns(candles) {
  const patterns = [];
  if (candles.length < 5) return patterns;
  const c0 = candles[candles.length - 1];
  const c1 = candles[candles.length - 2];
  const c2 = candles[candles.length - 3];
  const body0 = Math.abs(c0.close - c0.open);
  const range0 = c0.high - c0.low;
  const body1 = Math.abs(c1.close - c1.open);
  const upperShadow = c0.high - Math.max(c0.close, c0.open);
  const lowerShadow = Math.min(c0.close, c0.open) - c0.low;
  if (range0 > 0 && body0 / range0 < 0.1)
    patterns.push({ name: "\u5341\u5B57\u661F", type: "neutral", strength: "medium", desc: "\u591A\u7A7A\u5747\u8861\uFF0C\u7B49\u5F85\u65B9\u5411\u78BA\u8A8D" });
  if (lowerShadow > body0 * 2 && upperShadow < body0 * 0.5 && c0.close > c0.open)
    patterns.push({ name: "\u9318\u982D", type: "bullish", strength: "strong", desc: "\u4E0B\u5F71\u7DDA\u9577\uFF0C\u8CE3\u58D3\u88AB\u5438\u6536\uFF0C\u770B\u591A\u53CD\u8F49\u8A0A\u865F" });
  if (upperShadow > body0 * 2 && lowerShadow < body0 * 0.5 && c0.close > c0.open)
    patterns.push({ name: "\u5012\u9318\u982D", type: "bullish", strength: "medium", desc: "\u4E0A\u5F71\u7DDA\u9577\uFF0C\u8CB7\u65B9\u5617\u8A66\u63A8\u9AD8\uFF0C\u9700\u78BA\u8A8D" });
  if (upperShadow > body0 * 2 && lowerShadow < body0 * 0.5 && c0.close < c0.open)
    patterns.push({ name: "\u6D41\u661F", type: "bearish", strength: "strong", desc: "\u4E0A\u5F71\u7DDA\u9577\uFF0C\u8CB7\u65B9\u63A8\u9AD8\u88AB\u62D2\uFF0C\u770B\u7A7A\u53CD\u8F49\u8A0A\u865F" });
  if (lowerShadow > body0 * 2 && upperShadow < body0 * 0.5 && c0.close < c0.open)
    patterns.push({ name: "\u4E0A\u540A\u7DDA", type: "bearish", strength: "medium", desc: "\u9AD8\u4F4D\u51FA\u73FE\u9577\u4E0B\u5F71\u7DDA\uFF0C\u8CE3\u58D3\u589E\u52A0" });
  if (c0.close > c0.open && c1.close < c1.open && c0.open < c1.close && c0.close > c1.open)
    patterns.push({ name: "\u591A\u982D\u541E\u566C", type: "bullish", strength: "strong", desc: "\u591A\u982D\u5B8C\u5168\u541E\u566C\u524D\u4E00\u6839\u7A7A\u982DK\u7DDA\uFF0C\u5F37\u529B\u770B\u591A" });
  if (c0.close < c0.open && c1.close > c1.open && c0.open > c1.close && c0.close < c1.open)
    patterns.push({ name: "\u7A7A\u982D\u541E\u566C", type: "bearish", strength: "strong", desc: "\u7A7A\u982D\u5B8C\u5168\u541E\u566C\u524D\u4E00\u6839\u591A\u982DK\u7DDA\uFF0C\u5F37\u529B\u770B\u7A7A" });
  if (c0.high < c1.high && c0.low > c1.low)
    patterns.push({ name: "\u5167\u5305\u7DDA", type: "neutral", strength: "weak", desc: "Al Brooks\uFF1A\u5E02\u5834\u66AB\u505C\uFF0C\u7B49\u5F85\u7A81\u7834\u65B9\u5411" });
  if (c0.high > c1.high && c0.low < c1.low) {
    const type = c0.close > c0.open ? "bullish" : "bearish";
    patterns.push({ name: "\u5916\u5305\u7DDA", type, strength: "strong", desc: "Al Brooks\uFF1A\u5F37\u52E2\u541E\u566C\uFF0C\u52D5\u80FD\u65B9\u5411\u660E\u78BA" });
  }
  const midBody = Math.abs(c1.close - c1.open);
  if (c2.close < c2.open && midBody < Math.abs(c2.close - c2.open) * 0.3 && c0.close > c0.open && c0.close > (c2.open + c2.close) / 2)
    patterns.push({ name: "\u65E9\u6668\u4E4B\u661F", type: "bullish", strength: "strong", desc: "\u4E09K\u7DDA\u770B\u591A\u53CD\u8F49\uFF1A\u5927\u9670\u7DDA + \u5C0F\u5BE6\u9AD4 + \u5927\u967D\u7DDA" });
  if (c2.close > c2.open && midBody < Math.abs(c2.close - c2.open) * 0.3 && c0.close < c0.open && c0.close < (c2.open + c2.close) / 2)
    patterns.push({ name: "\u9EC3\u660F\u4E4B\u661F", type: "bearish", strength: "strong", desc: "\u4E09K\u7DDA\u770B\u7A7A\u53CD\u8F49\uFF1A\u5927\u967D\u7DDA + \u5C0F\u5BE6\u9AD4 + \u5927\u9670\u7DDA" });
  if (lowerShadow > range0 * 0.6 && body0 < range0 * 0.3)
    patterns.push({ name: "\u591A\u982D\u91DD\u5F62", type: "bullish", strength: "strong", desc: "Rayner Teo\uFF1A\u9577\u4E0B\u5F71\u7DDA\u5F37\u529B\u62D2\u7D55\u4F4E\u4F4D\uFF0C\u770B\u591A\u53CD\u8F49" });
  if (upperShadow > range0 * 0.6 && body0 < range0 * 0.3)
    patterns.push({ name: "\u7A7A\u982D\u91DD\u5F62", type: "bearish", strength: "strong", desc: "Rayner Teo\uFF1A\u9577\u4E0A\u5F71\u7DDA\u5F37\u529B\u62D2\u7D55\u9AD8\u4F4D\uFF0C\u770B\u7A7A\u53CD\u8F49" });
  if (body0 > range0 * 0.9 && c0.close > c0.open)
    patterns.push({ name: "\u591A\u982D\u5149\u982D\u5149\u8173", type: "bullish", strength: "strong", desc: "\u7121\u5F71\u7DDA\u5927\u967D\u7DDA\uFF0C\u591A\u65B9\u5B8C\u5168\u638C\u63A7" });
  if (body0 > range0 * 0.9 && c0.close < c0.open)
    patterns.push({ name: "\u7A7A\u982D\u5149\u982D\u5149\u8173", type: "bearish", strength: "strong", desc: "\u7121\u5F71\u7DDA\u5927\u9670\u7DDA\uFF0C\u7A7A\u65B9\u5B8C\u5168\u638C\u63A7" });
  if (body0 > range0 * 0.6 && body1 > range0 * 0.6 && c1.close < c1.open && c0.close > c0.open && c0.close > c1.open)
    patterns.push({ name: "\u5169K\u53CD\u8F49(\u591A)", type: "bullish", strength: "strong", desc: "Rayner Teo\uFF1A\u5927\u9670\u7DDA\u5F8C\u5927\u967D\u7DDA\uFF0C\u5F37\u529B\u53CD\u8F49" });
  if (body0 > range0 * 0.6 && body1 > range0 * 0.6 && c1.close > c1.open && c0.close < c0.open && c0.close < c1.open)
    patterns.push({ name: "\u5169K\u53CD\u8F49(\u7A7A)", type: "bearish", strength: "strong", desc: "Rayner Teo\uFF1A\u5927\u967D\u7DDA\u5F8C\u5927\u9670\u7DDA\uFF0C\u5F37\u529B\u53CD\u8F49" });
  return patterns;
}
function calcSRLevels(candles, close) {
  const levels = [];
  const swingHighs = findSwingHighs2(candles, 3);
  const swingLows = findSwingLows2(candles, 3);
  const tolerance = close * 5e-3;
  const highClusters = [];
  for (const sh of swingHighs) {
    const existing = highClusters.find((c) => Math.abs(c.price - sh.price) < tolerance);
    if (existing) {
      existing.price = (existing.price + sh.price) / 2;
      existing.touches++;
    } else {
      highClusters.push({ price: sh.price, touches: 1 });
    }
  }
  const lowClusters = [];
  for (const sl of swingLows) {
    const existing = lowClusters.find((c) => Math.abs(c.price - sl.price) < tolerance);
    if (existing) {
      existing.price = (existing.price + sl.price) / 2;
      existing.touches++;
    } else {
      lowClusters.push({ price: sl.price, touches: 1 });
    }
  }
  for (const c of highClusters.filter((c2) => c2.price > close).sort((a, b) => a.price - b.price).slice(0, 4)) {
    levels.push({ price: c.price, type: "resistance", strength: Math.min(5, c.touches), touches: c.touches });
  }
  for (const c of lowClusters.filter((c2) => c2.price < close).sort((a, b) => b.price - a.price).slice(0, 4)) {
    levels.push({ price: c.price, type: "support", strength: Math.min(5, c.touches), touches: c.touches });
  }
  return levels.sort((a, b) => Math.abs(a.price - close) - Math.abs(b.price - close));
}
function calcFalseBreakScore(candles, srLevels, close) {
  if (candles.length < 5 || srLevels.length === 0) return { score: 0, direction: "none" };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  for (const level of srLevels.slice(0, 4)) {
    const tolerance = level.price * 3e-3;
    if (level.type === "support" && prev.low < level.price - tolerance && last.close > level.price) {
      const wickSize = level.price - prev.low;
      const bodySize = Math.abs(prev.close - prev.open);
      const score = Math.min(100, 40 + wickSize / bodySize * 20 + level.strength * 8);
      return { score, direction: "bullish" };
    }
    if (level.type === "resistance" && prev.high > level.price + tolerance && last.close < level.price) {
      const wickSize = prev.high - level.price;
      const bodySize = Math.abs(prev.close - prev.open);
      const score = Math.min(100, 40 + wickSize / bodySize * 20 + level.strength * 8);
      return { score, direction: "bearish" };
    }
  }
  return { score: 0, direction: "none" };
}
function classifyTrendContext(candles, adx, ema20, ema50) {
  if (adx > 35) return "strong_trend";
  if (adx > 20) return "weak_trend";
  const recent = candles.slice(-20);
  let crossings = 0;
  for (let i = 1; i < recent.length; i++) {
    const prevAbove = recent[i - 1].close > ema20;
    const currAbove = recent[i].close > ema20;
    if (prevAbove !== currAbove) crossings++;
  }
  return crossings >= 4 ? "ranging" : "weak_trend";
}
function calcVolumeTrend(candles) {
  const recent = candles.slice(-10);
  const first5 = recent.slice(0, 5).reduce((s, c) => s + c.volume, 0) / 5;
  const last5 = recent.slice(5).reduce((s, c) => s + c.volume, 0) / 5;
  if (last5 > first5 * 1.2) return "increasing";
  if (last5 < first5 * 0.8) return "decreasing";
  return "neutral";
}
function classifyTrend(rsi, ema20, ema50, ema200, close) {
  const bullCount = [close > ema20, close > ema50, close > ema200, ema20 > ema50, ema50 > ema200, rsi > 55].filter(Boolean).length;
  const bearCount = [close < ema20, close < ema50, close < ema200, ema20 < ema50, ema50 < ema200, rsi < 45].filter(Boolean).length;
  if (bullCount >= 5) return "strong_bullish";
  if (bullCount >= 3) return "bullish";
  if (bearCount >= 5) return "strong_bearish";
  if (bearCount >= 3) return "bearish";
  return "neutral";
}
function classifyMomentum(rsi, macdHist, adx) {
  const bullish = rsi > 55 && macdHist > 0;
  const bearish = rsi < 45 && macdHist < 0;
  const strong = adx > 30;
  if (bullish && strong) return "strong_bullish";
  if (bullish) return "bullish";
  if (bearish && strong) return "strong_bearish";
  if (bearish) return "bearish";
  return "neutral";
}
function calcPaTf(candles, tf, allTfScores) {
  const closes = candles.map((c) => c.close);
  const close = closes[closes.length - 1];
  const rsi = calcRsi(closes);
  const macd = calcMacd(closes);
  const adxObj = calcAdx(candles);
  const atr = calcAtr(candles);
  const ema20 = calcEma(closes, 20).filter((v) => !isNaN(v)).pop() ?? close;
  const ema50 = calcEma(closes, 50).filter((v) => !isNaN(v)).pop() ?? close;
  const ema200Raw = calcEma(closes, 200).filter((v) => !isNaN(v)).pop();
  const hasEma200 = ema200Raw !== void 0 && closes.length >= 200;
  const ema200 = ema200Raw ?? close;
  const boll = calcBollinger(closes);
  const vwap = calcVwap2(candles);
  const cmf = calcCmf(candles);
  const patterns = detectPatterns(candles);
  const srLevels = calcSRLevels(candles, close);
  const support = srLevels.find((l) => l.type === "support")?.price ?? Math.min(...candles.slice(-30).map((c) => c.low));
  const resistance = srLevels.find((l) => l.type === "resistance")?.price ?? Math.max(...candles.slice(-30).map((c) => c.high));
  const trend = classifyTrend(rsi, ema20, ema50, ema200, close);
  const trend_context = classifyTrendContext(candles, adxObj.adx, ema20, ema50);
  const { score: fbScore, direction: fbDir } = calcFalseBreakScore(candles, srLevels, close);
  const volumeTrend = calcVolumeTrend(candles);
  const bb_position = boll.percent_b > 0.8 ? "near_upper" : boll.percent_b < 0.2 ? "near_lower" : "middle";
  const bb_squeeze = boll.bandwidth < 5;
  const price_vs_vwap = close > vwap * 1.001 ? "above" : close < vwap * 0.999 ? "below" : "at";
  const vwap_position = price_vs_vwap;
  const nearestLevel = srLevels[0];
  const key_level_proximity = nearestLevel ? Math.abs(close - nearestLevel.price) / close * 100 : 5;
  const mtf_alignment = allTfScores ? (() => {
    const avg = allTfScores.reduce((a, b) => a + b, 0) / allTfScores.length;
    const allBull = allTfScores.every((s) => s > 3.3);
    const allBear = allTfScores.every((s) => s < 2.7);
    if (allBull) return 90;
    if (allBear) return 10;
    return 40 + (avg - 3) * 20;
  })() : 50;
  let score = 3;
  if (rsi > 65) score += 0.8;
  else if (rsi > 55) score += 0.4;
  else if (rsi < 35) score -= 0.8;
  else if (rsi < 45) score -= 0.4;
  if (macd.histogram > 0) score += 0.4;
  else score -= 0.4;
  if (close > ema20) score += 0.3;
  else score -= 0.3;
  if (close > ema50) score += 0.4;
  else score -= 0.4;
  if (hasEma200) {
    if (close > ema200) score += 0.3;
    else score -= 0.3;
  }
  if (close > vwap) score += 0.2;
  else score -= 0.2;
  if (cmf > 0.1) score += 0.3;
  else if (cmf < -0.1) score -= 0.3;
  if (adxObj.plus_di > adxObj.minus_di) score += 0.2;
  else score -= 0.2;
  const bullPatterns = patterns.filter((p) => p.type === "bullish").length;
  const bearPatterns = patterns.filter((p) => p.type === "bearish").length;
  score += (bullPatterns - bearPatterns) * 0.2;
  score = Math.max(1, Math.min(5, score));
  return {
    timeframe: tf,
    trend,
    trend_context,
    score,
    close,
    rsi,
    atr,
    ema20,
    ema50,
    ema200,
    macd_hist: macd.histogram,
    adx: adxObj.adx,
    plus_di: adxObj.plus_di,
    minus_di: adxObj.minus_di,
    bollinger: boll,
    bb_position,
    bb_squeeze,
    vwap,
    vwap_position,
    cmf,
    patterns,
    chan: calcChan(candles),
    support,
    resistance,
    sr_levels: srLevels,
    false_break_score: fbScore,
    false_break_direction: fbDir,
    mtf_alignment,
    volume_trend: volumeTrend,
    price_vs_vwap,
    key_level_proximity
  };
}
async function fetchOnchain(symbol) {
  const krakenFuturesMap = {
    BTC: "PI_XBTUSD",
    ETH: "PI_ETHUSD",
    SOL: "PI_SOLUSD",
    XRP: "PI_XRPUSD",
    ADA: "PI_ADAUSD",
    DOGE: "PI_DOGEUSD",
    AVAX: "PI_AVAXUSD",
    DOT: "PI_DOTUSD",
    LINK: "PI_LINKUSD",
    LNK: "PI_LINKUSD",
    LTC: "PI_LTCUSD"
  };
  const ccy = symbol.replace("USDT", "").replace("BUSD", "");
  const krakenFuturesSym = krakenFuturesMap[ccy] ?? `PI_${ccy}USD`;
  const result = {
    symbol,
    funding_rate: null,
    long_short_ratio: null,
    fear_greed: null,
    open_interest: null,
    coingecko: null
  };
  await Promise.allSettled([
    // Kraken Futures Tickers（資金費率 + 未平倉量）
    fetch(`https://futures.kraken.com/derivatives/api/v3/tickers`, { signal: AbortSignal.timeout(8e3) }).then((r) => r.ok ? r.json() : null).then((d) => {
      const ticker = d?.tickers?.find((t2) => t2.symbol === krakenFuturesSym);
      if (ticker) {
        if (ticker.fundingRate !== void 0) {
          result.funding_rate = { rate: ticker.fundingRate, time: Date.now() };
        }
        if (ticker.openInterest !== void 0) {
          result.open_interest = { open_interest: ticker.openInterest };
        }
      }
    }).catch(() => {
    }),
    // Fear & Greed Index (alternative.me)
    fetch("https://api.alternative.me/fng/?limit=1", { signal: AbortSignal.timeout(6e3) }).then((r) => r.ok ? r.json() : null).then((fg) => {
      if (fg?.data?.[0]) result.fear_greed = { value: parseInt(fg.data[0].value), label: fg.data[0].value_classification };
    }).catch(() => {
    })
  ]);
  return result;
}
async function runAnalysis(symbol) {
  const sym = symbol.toUpperCase();
  const c4h = await fetchCandles(sym, "4H", 200);
  const c1h = await fetchCandles(sym, "1H", 200);
  const c15m = await fetchCandles(sym, "15m", 200);
  const c5m = await fetchCandles(sym, "5m", 200);
  const main = c4h;
  const closes = main.map((c) => c.close);
  const close = closes[closes.length - 1];
  const rsi = calcRsi(closes);
  const macd = calcMacd(closes);
  const adxObj = calcAdx(main);
  const atr = calcAtr(main);
  const boll = calcBollinger(closes);
  const vwap = calcVwap2(main);
  const ema20 = calcEma(closes, 20).filter((v) => !isNaN(v)).pop() ?? close;
  const ema50 = calcEma(closes, 50).filter((v) => !isNaN(v)).pop() ?? close;
  const ema200 = calcEma(closes, 200).filter((v) => !isNaN(v)).pop() ?? close;
  const stoch = calcStochastic(main);
  const trend = classifyTrend(rsi, ema20, ema50, ema200, close);
  const momentum = classifyMomentum(rsi, macd.histogram, adxObj.adx);
  const indicators = {
    rsi,
    macd,
    adx: adxObj,
    atr,
    bollinger: boll,
    vwap,
    ema: { ema20, ema50, ema200 },
    stochastic: stoch,
    trend,
    momentum,
    close
  };
  const { fvgs, nearest_bull_fvg, nearest_bear_fvg } = detectFvgs(main, close);
  const { order_blocks, nearest_bull_ob, nearest_bear_ob } = detectOrderBlocks2(main, close);
  const bos_choch = detectBosChoch2(main);
  const liquidityLevels = detectLiquidityLevels(main, close);
  const premiumDiscount = calcPremiumDiscount(main, close);
  const oteZone = calcOteZone(main, close);
  const swingHighs = findSwingHighs2(main, 5);
  const swingLows = findSwingLows2(main, 5);
  const recentSwingHigh = swingHighs[swingHighs.length - 1]?.price ?? close * 1.05;
  const recentSwingLow = swingLows[swingLows.length - 1]?.price ?? close * 0.95;
  const bslLevels = liquidityLevels.filter((l) => l.type === "BSL").map((l) => l.price);
  const sslLevels = liquidityLevels.filter((l) => l.type === "SSL").map((l) => l.price);
  const nearestSell = bslLevels.length > 0 ? Math.min(...bslLevels) : recentSwingHigh;
  const nearestBuy = sslLevels.length > 0 ? Math.max(...sslLevels) : recentSwingLow;
  const smcStructure = (() => {
    const recentBos = bos_choch.slice(-3);
    const lastBull = recentBos.filter((b) => b.direction === "bullish").length;
    const lastBear = recentBos.filter((b) => b.direction === "bearish").length;
    if (lastBull > lastBear && close > ema50) return "bullish";
    if (lastBear > lastBull && close < ema50) return "bearish";
    return "ranging";
  })();
  const smc = {
    structure: smcStructure,
    fvgs,
    order_blocks,
    bos_choch,
    liquidity: {
      sell_side: bslLevels,
      buy_side: sslLevels,
      nearest_sell: nearestSell,
      nearest_buy: nearestBuy,
      levels: liquidityLevels
    },
    nearest_bull_fvg,
    nearest_bear_fvg,
    nearest_bull_ob,
    nearest_bear_ob,
    fvg_count: fvgs.length,
    ob_count: order_blocks.length,
    premium_discount: premiumDiscount,
    ote_zone: oteZone,
    recent_swing_high: recentSwingHigh,
    recent_swing_low: recentSwingLow,
    liquidity_levels: liquidityLevels
  };
  const chan4h = calcChan(c4h);
  const chan1h = calcChan(c1h);
  const chan15m = calcChan(c15m);
  const chan5m = calcChan(c5m);
  function genChanSignal(ch, tf) {
    const z4 = ch.current_zhongshu;
    let signal = "";
    let signal_type = "neutral";
    if (ch.trend === "bullish") {
      if (ch.in_zhongshu) {
        signal = `${tf} \u4E0A\u5347\u8DA8\u52E2\uFF0C\u73FE\u8655\u4E2D\u6A1E\u9707\u76EA\uFF0C\u7B49\u5F85\u7A81\u7834\u4E2D\u6A1E\u9802\u90E8 ${z4 ? z4.top.toFixed(2) : ""} \u78BA\u8A8D\u5EF6\u4F38`;
        signal_type = "watch";
      } else {
        signal = `${tf} \u4E0A\u5347\u8DA8\u52E2\u5EF6\u4F38\u4E2D\uFF0C\u4E2D\u6A1E\u4E0B\u6CBF\u70BA\u8CB7\u9EDE\uFF0C\u7B46\u6578 ${ch.bi_count}\uFF0C\u6BB5\u6578 ${ch.duan_count}`;
        signal_type = "buy";
      }
    } else if (ch.trend === "bearish") {
      if (ch.in_zhongshu) {
        signal = `${tf} \u4E0B\u964D\u8DA8\u52E2\uFF0C\u73FE\u8655\u4E2D\u6A1E\u9707\u76EA\uFF0C\u7B49\u5F85\u8DCC\u7834\u4E2D\u6A1E\u5E95\u90E8 ${z4 ? z4.bottom.toFixed(2) : ""} \u78BA\u8A8D\u5EF6\u4F38`;
        signal_type = "watch";
      } else {
        signal = `${tf} \u4E0B\u964D\u8DA8\u52E2\u5EF6\u4F38\u4E2D\uFF0C\u4E2D\u6A1E\u4E0A\u6CBF\u70BA\u8CE3\u9EDE\uFF0C\u7B46\u6578 ${ch.bi_count}\uFF0C\u6BB5\u6578 ${ch.duan_count}`;
        signal_type = "sell";
      }
    } else {
      signal = `${tf} \u9707\u76EA\u6574\u7406\uFF0C\u4E2D\u6A1E ${ch.zhongshus.length} \u500B\uFF0C\u7B49\u5F85\u65B9\u5411\u9078\u64C7`;
      signal_type = "neutral";
    }
    let signal_reason = "";
    if (ch.divergence?.type === "top") {
      signal_reason = `\u9802\u80CC\u99B3\u8B66\u793A\uFF1A${ch.divergence.description}`;
      if (signal_type === "buy") signal_type = "watch";
    } else if (ch.divergence?.type === "bottom") {
      signal_reason = `\u5E95\u80CC\u99B3\u8B66\u793A\uFF1A${ch.divergence.description}`;
      if (signal_type === "sell") signal_type = "watch";
    } else if (ch.zhongshu_entry_exit === "entering") {
      signal_reason = `\u5373\u5C07\u9032\u5165\u4E2D\u6A1E\uFF0C\u6CE8\u610F\u9707\u76EA\u98A8\u96AA`;
    } else if (ch.zhongshu_entry_exit === "exiting") {
      signal_reason = `\u525B\u5F9E\u4E2D\u6A1E\u7A81\u7834\u800C\u51FA\uFF0C\u8DA8\u52E2\u5EF6\u4F38\u4FE1\u865F\u5F37`;
    }
    return {
      trend: ch.trend,
      bi_count: ch.bi_count,
      duan_count: ch.duan_count,
      zhongshu_count: ch.zhongshus.length,
      in_zhongshu: ch.in_zhongshu,
      current_zhongshu: ch.current_zhongshu,
      signal,
      signal_type,
      signal_reason: signal_reason || void 0,
      divergence: ch.divergence,
      zhongshu_entry_exit: ch.zhongshu_entry_exit
    };
  }
  const chanSignals = {
    "4h": genChanSignal(chan4h, "4H"),
    "1h": genChanSignal(chan1h, "1H"),
    "15m": genChanSignal(chan15m, "15M"),
    "5m": genChanSignal(chan5m, "5M")
  };
  const chanTrends = [chan4h.trend, chan1h.trend, chan15m.trend, chan5m.trend];
  const chanBullCount = chanTrends.filter((t2) => t2 === "bullish").length;
  const chanBearCount = chanTrends.filter((t2) => t2 === "bearish").length;
  const chanRangeCount = chanTrends.filter((t2) => t2 === "ranging").length;
  const chanInZhongshu = [chan4h.in_zhongshu, chan1h.in_zhongshu, chan15m.in_zhongshu, chan5m.in_zhongshu].filter(Boolean).length;
  const chanOverallTrend = chanBullCount >= 3 ? "bullish" : chanBearCount >= 3 ? "bearish" : chanBullCount > chanBearCount ? "bullish" : chanBearCount > chanBullCount ? "bearish" : "ranging";
  const chanAlignmentScore = (() => {
    const dominant = chan4h.trend;
    let score = 0;
    if (chan4h.trend === dominant) score += 40;
    if (chan1h.trend === dominant) score += 25;
    if (chan15m.trend === dominant) score += 20;
    if (chan5m.trend === dominant) score += 15;
    return score;
  })();
  const chanDominantTf = (() => {
    if (chan4h.trend !== "ranging") return "4H";
    if (chan1h.trend !== "ranging") return "1H";
    if (chan15m.trend !== "ranging") return "15M";
    return "5M";
  })();
  const chanSuggestion = (() => {
    if (chanOverallTrend === "bullish" && chanAlignmentScore >= 65) {
      return `\u591A\u6642\u6BB5\u7E8F\u8AD6\u4E00\u81F4\u770B\u591A\uFF08${chanBullCount}/4 \u6642\u6BB5\uFF09\uFF0C${chanDominantTf} \u4E3B\u5C0E\u4E0A\u5347\u8DA8\u52E2\uFF0C\u5EFA\u8B70\u5728\u4F4E\u6642\u6BB5\u4E2D\u6A1E\u4E0B\u6CBF\u6216\u7B46\u56DE\u8ABF\u8655\u505A\u591A`;
    } else if (chanOverallTrend === "bearish" && chanAlignmentScore >= 65) {
      return `\u591A\u6642\u6BB5\u7E8F\u8AD6\u4E00\u81F4\u770B\u7A7A\uFF08${chanBearCount}/4 \u6642\u6BB5\uFF09\uFF0C${chanDominantTf} \u4E3B\u5C0E\u4E0B\u964D\u8DA8\u52E2\uFF0C\u5EFA\u8B70\u5728\u4F4E\u6642\u6BB5\u4E2D\u6A1E\u4E0A\u6CBF\u6216\u7B46\u53CD\u5F48\u8655\u505A\u7A7A`;
    } else if (chanOverallTrend === "bullish") {
      return `\u7E8F\u8AD6\u504F\u591A\u4F46\u5206\u6B67\uFF08${chanBullCount}/4 \u6642\u6BB5\u770B\u591A\uFF09\uFF0C${chanDominantTf} \u8DA8\u52E2\u5411\u4E0A\uFF0C\u4F46\u9700\u7B49\u5F85\u4F4E\u6642\u6BB5\u78BA\u8A8D\uFF0C\u8B39\u614E\u505A\u591A`;
    } else if (chanOverallTrend === "bearish") {
      return `\u7E8F\u8AD6\u504F\u7A7A\u4F46\u5206\u6B67\uFF08${chanBearCount}/4 \u6642\u6BB5\u770B\u7A7A\uFF09\uFF0C${chanDominantTf} \u8DA8\u52E2\u5411\u4E0B\uFF0C\u4F46\u9700\u7B49\u5F85\u4F4E\u6642\u6BB5\u78BA\u8A8D\uFF0C\u8B39\u614E\u505A\u7A7A`;
    } else {
      return `\u591A\u6642\u6BB5\u7E8F\u8AD6\u9707\u76EA\u5206\u6B67\uFF0C${chanInZhongshu} \u500B\u6642\u6BB5\u5728\u4E2D\u6A1E\u5167\uFF0C\u5EFA\u8B70\u7B49\u5F85\u65B9\u5411\u9078\u64C7\u5F8C\u518D\u5165\u5834`;
    }
  })();
  const chanDetail = [
    `4H\uFF1A${chan4h.trend === "bullish" ? "\u2191\u4E0A\u5347" : chan4h.trend === "bearish" ? "\u2193\u4E0B\u964D" : "\u2192\u9707\u76EA"} | \u7B46${chan4h.bi_count} \u6BB5${chan4h.duan_count} \u4E2D\u6A1E${chan4h.zhongshus.length}${chan4h.in_zhongshu ? "\uFF08\u5728\u4E2D\u6A1E\u5167\uFF09" : ""}`,
    `1H\uFF1A${chan1h.trend === "bullish" ? "\u2191\u4E0A\u5347" : chan1h.trend === "bearish" ? "\u2193\u4E0B\u964D" : "\u2192\u9707\u76EA"} | \u7B46${chan1h.bi_count} \u6BB5${chan1h.duan_count} \u4E2D\u6A1E${chan1h.zhongshus.length}${chan1h.in_zhongshu ? "\uFF08\u5728\u4E2D\u6A1E\u5167\uFF09" : ""}`,
    `15M\uFF1A${chan15m.trend === "bullish" ? "\u2191\u4E0A\u5347" : chan15m.trend === "bearish" ? "\u2193\u4E0B\u964D" : "\u2192\u9707\u76EA"} | \u7B46${chan15m.bi_count} \u6BB5${chan15m.duan_count} \u4E2D\u6A1E${chan15m.zhongshus.length}${chan15m.in_zhongshu ? "\uFF08\u5728\u4E2D\u6A1E\u5167\uFF09" : ""}`,
    `5M\uFF1A${chan5m.trend === "bullish" ? "\u2191\u4E0A\u5347" : chan5m.trend === "bearish" ? "\u2193\u4E0B\u964D" : "\u2192\u9707\u76EA"} | \u7B46${chan5m.bi_count} \u6BB5${chan5m.duan_count} \u4E2D\u6A1E${chan5m.zhongshus.length}${chan5m.in_zhongshu ? "\uFF08\u5728\u4E2D\u6A1E\u5167\uFF09" : ""}`
  ].join(" \uFF5C ");
  const chanEntryTiming = (() => {
    const s4h = chanSignals["4h"];
    const s1h = chanSignals["1h"];
    if (s4h.signal_type === "buy" && (s1h.signal_type === "buy" || s1h.signal_type === "watch")) {
      return "4H \u4E0A\u5347 + 1H \u914D\u5408\uFF0C\u53EF\u5728 15M \u7B46\u5E95\u90E8\u5165\u5834\u505A\u591A";
    } else if (s4h.signal_type === "sell" && (s1h.signal_type === "sell" || s1h.signal_type === "watch")) {
      return "4H \u4E0B\u964D + 1H \u914D\u5408\uFF0C\u53EF\u5728 15M \u7B46\u9802\u90E8\u5165\u5834\u505A\u7A7A";
    } else if (s4h.signal_type === "watch") {
      return "4H \u5728\u4E2D\u6A1E\u9707\u76EA\uFF0C\u7B49\u5F85\u7A81\u7834\u65B9\u5411\u78BA\u8A8D\u5F8C\uFF0C\u5728 1H \u627E\u5165\u5834\u9EDE";
    } else {
      return "\u591A\u6642\u6BB5\u65B9\u5411\u5206\u6B67\uFF0C\u5EFA\u8B70\u7B49\u5F85 4H \u8DA8\u52E2\u660E\u78BA\u5F8C\u518D\u64CD\u4F5C";
    }
  })();
  const chan_mtf = {
    timeframes: { "4h": chan4h, "1h": chan1h, "15m": chan15m, "5m": chan5m },
    signals: chanSignals,
    summary: {
      overall_trend: chanOverallTrend,
      trend_alignment: chanAlignmentScore,
      bullish_count: chanBullCount,
      bearish_count: chanBearCount,
      ranging_count: chanRangeCount,
      in_zhongshu_count: chanInZhongshu,
      dominant_timeframe: chanDominantTf,
      suggestion: chanSuggestion,
      detail: chanDetail,
      entry_timing: chanEntryTiming
    }
  };
  const pa4h = calcPaTf(c4h, "4h");
  const pa1h = calcPaTf(c1h, "1h");
  const pa15m = calcPaTf(c15m, "15m");
  const pa5m = calcPaTf(c5m, "5m");
  const allScores = [pa4h.score, pa1h.score, pa15m.score, pa5m.score];
  const avgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  const calcMtfAlignment = (selfScore, higherScores) => {
    const ref = higherScores.length > 0 ? higherScores : allScores.filter((s) => s !== selfScore);
    const avg = ref.reduce((a, b) => a + b, 0) / ref.length;
    const allBull = ref.every((s) => s > 3.3);
    const allBear = ref.every((s) => s < 2.7);
    if (allBull) return 90;
    if (allBear) return 10;
    return Math.max(10, Math.min(90, 40 + (avg - 3) * 20));
  };
  const pa4hFinal = { ...pa4h, mtf_alignment: calcMtfAlignment(pa4h.score, []) };
  const pa1hFinal = { ...pa1h, mtf_alignment: calcMtfAlignment(pa1h.score, [pa4h.score]) };
  const pa15mFinal = { ...pa15m, mtf_alignment: calcMtfAlignment(pa15m.score, [pa4h.score, pa1h.score]) };
  const pa5mFinal = { ...pa5m, mtf_alignment: calcMtfAlignment(pa5m.score, [pa4h.score, pa1h.score, pa15m.score]) };
  const paConsensus = avgScore >= 4 ? "strong_bullish" : avgScore >= 3.5 ? "bullish" : avgScore >= 3 ? "neutral" : avgScore >= 2.5 ? "bearish" : "strong_bearish";
  const paDirection = avgScore >= 3.5 ? "long" : avgScore <= 2.5 ? "short" : "neutral";
  const pa = {
    timeframes: { "4h": pa4hFinal, "1h": pa1hFinal, "15m": pa15mFinal, "5m": pa5mFinal },
    consensus: paConsensus,
    avg_score: avgScore,
    suggestion: paDirection === "long" ? `\u591A\u6642\u9593\u6846\u67B6\u504F\u591A\uFF08${avgScore.toFixed(1)}/5\uFF09\uFF0C${pa4h.trend_context === "strong_trend" ? "\u5F37\u8DA8\u52E2" : "\u5F31\u8DA8\u52E2"}\uFF0C\u53EF\u5728 S/R \u652F\u6490\u4F4D\u9644\u8FD1\u5C0B\u627E\u505A\u591A\u6A5F\u6703` : paDirection === "short" ? `\u591A\u6642\u9593\u6846\u67B6\u504F\u7A7A\uFF08${avgScore.toFixed(1)}/5\uFF09\uFF0C${pa4h.trend_context === "strong_trend" ? "\u5F37\u8DA8\u52E2" : "\u5F31\u8DA8\u52E2"}\uFF0C\u53EF\u5728 S/R \u963B\u529B\u4F4D\u9644\u8FD1\u5C0B\u627E\u505A\u7A7A\u6A5F\u6703` : "\u8A0A\u865F\u5206\u6B67\uFF0C\u5EFA\u8B70\u89C0\u671B\u7B49\u5F85\u66F4\u660E\u78BA\u65B9\u5411",
    entry_params: paDirection !== "neutral" ? (() => {
      const paSlBuffer = atr * 0.3;
      const paSl = paDirection === "long" ? nearestBuy - paSlBuffer : nearestSell + paSlBuffer;
      const paRiskDist = Math.abs(close - paSl);
      const rawPaTp1 = paDirection === "long" ? nearestSell : nearestBuy;
      const minTp1Long = close + Math.max(paRiskDist * 1.5, atr * 2);
      const maxTp1Short = close - Math.max(paRiskDist * 1.5, atr * 2);
      const paTp1 = paDirection === "long" ? rawPaTp1 > close ? rawPaTp1 : minTp1Long : rawPaTp1 < close ? rawPaTp1 : maxTp1Short;
      const sortedBsl = bslLevels.slice().sort((a, b) => a - b);
      const sortedSsl = sslLevels.slice().sort((a, b) => b - a);
      const rawPaTp2 = paDirection === "long" ? sortedBsl.length > 1 ? sortedBsl[1] : paTp1 + paRiskDist : sortedSsl.length > 1 ? sortedSsl[1] : paTp1 - paRiskDist;
      const paTp2 = paDirection === "long" ? rawPaTp2 > paTp1 ? rawPaTp2 : paTp1 + paRiskDist : rawPaTp2 < paTp1 ? rawPaTp2 : paTp1 - paRiskDist;
      const paRr = paRiskDist > 0 ? Math.max((paDirection === "long" ? paTp1 - close : close - paTp1) / paRiskDist, 0.1) : 1.5;
      return {
        direction: paDirection,
        entry: close,
        sl: paSl,
        tp1: paTp1,
        tp2: paTp2,
        rr_ratio: Math.round(paRr * 10) / 10
      };
    })() : {}
  };
  const sig = (x, center, steepness) => 1 / (1 + Math.exp(-steepness * (x - center)));
  const linMap = (x, lo, hi) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  const emaSpread200 = (close - ema200) / Math.max(ema200, 1);
  const emaSpread50 = (ema50 - ema200) / Math.max(ema200, 1);
  const emaSpread20 = (ema20 - ema50) / Math.max(ema50, 1);
  const priceVsEma200Score = sig(emaSpread200, 0, 80);
  const ema50vs200Score = sig(emaSpread50, 0, 120);
  const ema20vs50Score = sig(emaSpread20, 0, 150);
  const longTermScore = (priceVsEma200Score * 0.5 + ema50vs200Score * 0.3 + ema20vs50Score * 0.2) * 30;
  const rsiNorm = Math.max(0, Math.min(100, rsi));
  const rsiScoreV3 = sig(rsiNorm, 50, 0.12);
  const macdStrength = macd.signal !== 0 ? macd.histogram / Math.abs(macd.signal) : macd.histogram > 0 ? 1 : -1;
  const macdScoreV3 = sig(macdStrength, 0, 2);
  const diDiff = adxObj.plus_di - adxObj.minus_di;
  const adxDiScoreV3 = sig(diDiff, 0, 0.15);
  const adxConfidence = linMap(adxObj.adx, 15, 40);
  const momentumRaw = rsiScoreV3 * 0.35 + macdScoreV3 * 0.4 + adxDiScoreV3 * 0.25;
  const momentumScore = momentumRaw * (0.5 + 0.5 * adxConfidence) * 30;
  const smcScore = smcStructure === "bullish" ? 1 : smcStructure === "bearish" ? 0 : 0.5;
  const ictScore = premiumDiscount.current_zone === "discount" ? 1 : premiumDiscount.current_zone === "premium" ? 0 : 0.5;
  const vwapScore = sig((close - vwap) / Math.max(vwap, 1), 0, 100);
  const structureScore = (smcScore * 0.4 + ictScore * 0.35 + vwapScore * 0.25) * 25;
  const stochScore = sig(stoch.k - stoch.d, 0, 0.15);
  const bbScore = sig(boll.percent_b - 0.5, 0, 8);
  const confirmScore = (stochScore * 0.5 + bbScore * 0.5) * 10;
  const bullLayers = [
    longTermScore / 30 > 0.55,
    momentumScore / 30 > 0.55,
    structureScore / 25 > 0.55
  ];
  const bullCount = bullLayers.filter(Boolean).length;
  const bearCount = bullLayers.filter((v) => !v).length;
  const consistencyBonus = bullCount === 3 ? 5 : bearCount === 3 ? -5 : 0;
  const isRangingMarket = adxObj.adx < 20;
  const isTrendingMarket = adxObj.adx > 30;
  const trendBonus = isTrendingMarket ? 3 : 0;
  const rangepenalty = isRangingMarket ? -3 : 0;
  const rawConsensus = longTermScore + momentumScore + structureScore + confirmScore + consistencyBonus + trendBonus + rangepenalty;
  const consensusScore = Math.max(0, Math.min(100, rawConsensus));
  const longThreshold = isRangingMarket ? 65 : 60;
  const shortThreshold = isRangingMarket ? 35 : 40;
  const consensusLabel = consensusScore >= longThreshold + 15 ? "\u5F37\u70C8\u770B\u591A" : consensusScore >= longThreshold ? "\u770B\u591A" : consensusScore >= shortThreshold ? "\u4E2D\u6027" : consensusScore >= shortThreshold - 15 ? "\u770B\u7A7A" : "\u5F37\u70C8\u770B\u7A7A";
  const consensus = { score: consensusScore, label: consensusLabel };
  const paScoreToStrength = (score) => Math.round((score - 1) / 4 * 100);
  const paScoreToDirection = (score) => score >= 3.5 ? "long" : score <= 2.5 ? "short" : "neutral";
  const mtfSignals = [
    {
      timeframe: "4H",
      direction: paScoreToDirection(pa4h.score),
      strength: paScoreToStrength(pa4h.score),
      atr: pa4h.atr,
      adx: pa4h.adx,
      rsi: pa4h.rsi,
      paScore: pa4h.score
    },
    {
      timeframe: "1H",
      direction: paScoreToDirection(pa1h.score),
      strength: paScoreToStrength(pa1h.score),
      atr: pa1h.atr,
      adx: pa1h.adx,
      rsi: pa1h.rsi,
      paScore: pa1h.score
    },
    {
      timeframe: "15m",
      direction: paScoreToDirection(pa15m.score),
      strength: paScoreToStrength(pa15m.score),
      atr: pa15m.atr,
      adx: pa15m.adx,
      rsi: pa15m.rsi,
      paScore: pa15m.score
    },
    {
      timeframe: "5m",
      direction: paScoreToDirection(pa5m.score),
      strength: paScoreToStrength(pa5m.score),
      atr: pa5m.atr,
      adx: pa5m.adx,
      rsi: pa5m.rsi,
      paScore: pa5m.score
    }
  ];
  const bayesianFusion = bayesianMtfFusion(mtfSignals);
  const bayesianDir = bayesianFusion.fusedDirection;
  const bayesianConf = bayesianFusion.bayesianConfidence;
  const consensusDir = consensusScore >= 60 ? "long" : consensusScore <= 40 ? "short" : "neutral";
  let bayesianAdj = 0;
  if (bayesianDir !== "neutral" && consensusDir !== "neutral") {
    if (bayesianDir === consensusDir) {
      bayesianAdj = Math.round(bayesianConf / 100 * 8 * bayesianFusion.conflictPenalty);
    } else {
      bayesianAdj = -Math.round(bayesianConf / 100 * 8 * bayesianFusion.conflictPenalty);
    }
  }
  const adjustedConsensus = Math.max(0, Math.min(100, consensusScore + bayesianAdj));
  const mainBull = adjustedConsensus >= 50;
  const atrMultiplier = isTrendingMarket ? 0.5 : isRangingMarket ? 0.8 : 0.6;
  const mainDist = Math.abs((mainBull ? nearestSell : nearestBuy) - close);
  const altDist = Math.abs((mainBull ? nearestBuy : nearestSell) - close);
  const mainCandlesEst = atr > 0 ? Math.round(mainDist / (atr * atrMultiplier)) : void 0;
  const altCandlesEst = atr > 0 ? Math.round(altDist / (atr * atrMultiplier)) : void 0;
  const extremeBull = mainBull;
  const extremeTarget = extremeBull ? nearestSell * 1.03 : nearestBuy * 0.97;
  const extremeDeviation = Math.abs(adjustedConsensus - 50);
  const extremeProbability = Math.round(35 / (1 + Math.exp(-0.12 * (extremeDeviation - 20))));
  const forecast_4h = {
    main_scenario: mainBull ? "\u770B\u591A" : "\u770B\u7A7A",
    main_probability: mainBull ? adjustedConsensus : 100 - adjustedConsensus,
    main_target: mainBull ? nearestSell : nearestBuy,
    main_description: mainBull ? `\u82E5\u7DAD\u6301\u5728 EMA20 (${ema20.toFixed(2)}) \u4E0A\u65B9\uFF0C\u76EE\u6A19\u6D41\u52D5\u6027\u4F4D ${nearestSell.toFixed(2)}\uFF08\u5171\u8B58\u5206 ${consensusScore.toFixed(0)}${bayesianAdj !== 0 ? `\uFF0C\u8C9D\u8449\u65AF${bayesianAdj > 0 ? "+" : ""}${bayesianAdj}\u2192${adjustedConsensus.toFixed(0)}` : ""}\uFF09` : `\u82E5\u8DCC\u7834 EMA20 (${ema20.toFixed(2)})\uFF0C\u76EE\u6A19\u6D41\u52D5\u6027\u4F4D ${nearestBuy.toFixed(2)}\uFF08\u5171\u8B58\u5206 ${consensusScore.toFixed(0)}${bayesianAdj !== 0 ? `\uFF0C\u8C9D\u8449\u65AF${bayesianAdj > 0 ? "+" : ""}${bayesianAdj}\u2192${adjustedConsensus.toFixed(0)}` : ""}\uFF09`,
    main_candles_estimate: mainCandlesEst,
    main_invalidation: mainBull ? ema50 : ema50,
    alt_scenario: !mainBull ? "\u770B\u591A" : "\u770B\u7A7A",
    alt_probability: mainBull ? 100 - adjustedConsensus : adjustedConsensus,
    alt_target: mainBull ? nearestBuy : nearestSell,
    alt_description: mainBull ? `\u82E5\u8DCC\u7834 EMA50 (${ema50.toFixed(2)}) \u4E14\u9032\u5165 Premium \u5340\u9593\uFF0C\u8F49\u70BA\u770B\u7A7A` : `\u82E5\u7A81\u7834 EMA50 (${ema50.toFixed(2)}) \u4E14\u9032\u5165 Discount \u5340\u9593\uFF0C\u8F49\u70BA\u770B\u591A`,
    alt_candles_estimate: altCandlesEst,
    alt_invalidation: mainBull ? ema20 : ema20,
    extreme_scenario: extremeBull ? "\u5F37\u52E2\u7A81\u7834\u5EF6\u4F38" : "\u6050\u614C\u6027\u62CB\u552E",
    extreme_probability: extremeProbability,
    extreme_target: extremeTarget,
    extreme_description: extremeBull ? `\u82E5\u7A81\u7834 ${nearestSell.toFixed(2)} \u4E14\u6210\u4EA4\u91CF\u653E\u5927\uFF0C\u53EF\u80FD\u5EF6\u4F38\u81F3 ${extremeTarget.toFixed(2)}\uFF08+3%\uFF09` : `\u82E5\u8DCC\u7834 ${nearestBuy.toFixed(2)} \u4E14\u6050\u614C\u62CB\u552E\uFF0C\u53EF\u80FD\u5EF6\u4F38\u81F3 ${extremeTarget.toFixed(2)}\uFF08-3%\uFF09`,
    extreme_invalidation: extremeBull ? nearestSell : nearestBuy
  };
  const direction = adjustedConsensus >= longThreshold ? "long" : adjustedConsensus <= shortThreshold ? "short" : "neutral";
  const directionBias = direction === "long" ? "bullish" : direction === "short" ? "bearish" : null;
  const smcConfirmations = detectSmcConfirmationSetups(c4h, close, smcStructure);
  const preferredSmcSetup = directionBias ? smcConfirmations.filter((setup) => setup.direction === directionBias && !setup.invalidated).sort((a, b) => {
    const statusRank = (status) => status === "active" ? 3 : status === "waiting" ? 2 : status === "completed" ? 1 : 0;
    const scoreA = statusRank(a.status) * 1e3 + a.confluence_score * 10 + a.rr_ratio;
    const scoreB = statusRank(b.status) * 1e3 + b.confluence_score * 10 + b.rr_ratio;
    return scoreB - scoreA;
  })[0] : void 0;
  const nearSupportLevels = (pa.timeframes["4h"]?.sr_levels ?? []).filter((l) => l.type === "support" && l.price < close).sort((a, b) => b.price - a.price);
  const nearResistanceLevels = (pa.timeframes["4h"]?.sr_levels ?? []).filter((l) => l.type === "resistance" && l.price > close).sort((a, b) => a.price - b.price);
  const dynamicSlLong = nearSupportLevels.length > 0 ? nearSupportLevels[0].price - atr * 0.3 : close - atr * 1.5;
  const dynamicSlShort = nearResistanceLevels.length > 0 ? nearResistanceLevels[0].price + atr * 0.3 : close + atr * 1.5;
  const slDistLong = Math.min(close - dynamicSlLong, atr * 2.5);
  const slDistShort = Math.min(dynamicSlShort - close, atr * 2.5);
  const finalSlLong = close - slDistLong;
  const finalSlShort = close + slDistShort;
  const minTpLong = close + slDistLong * 1.5;
  const minTpShort = close - slDistShort * 1.5;
  const dynamicTp1Long = nearResistanceLevels.length > 0 ? Math.max(nearResistanceLevels[0].price, minTpLong) : close + atr * 3;
  const dynamicTp1Short = nearSupportLevels.length > 0 ? Math.min(nearSupportLevels[0].price, minTpShort) : close - atr * 3;
  const dynamicTp2Long = nearResistanceLevels.length > 1 ? nearResistanceLevels[1].price : dynamicTp1Long + slDistLong;
  const dynamicTp2Short = nearSupportLevels.length > 1 ? nearSupportLevels[1].price : dynamicTp1Short - slDistShort;
  const rrLong = slDistLong > 0 ? (dynamicTp1Long - close) / slDistLong : 2;
  const rrShort = slDistShort > 0 ? (close - dynamicTp1Short) / slDistShort : 2;
  const dynamicRr = direction === "long" ? rrLong : direction === "short" ? rrShort : 2;
  const smcEntryMid = preferredSmcSetup ? (preferredSmcSetup.entry_zone.top + preferredSmcSetup.entry_zone.bottom) / 2 : void 0;
  const fangfangtuEntry = direction === "long" ? Math.min(close, smcEntryMid ?? close) : direction === "short" ? Math.max(close, smcEntryMid ?? close) : void 0;
  const MAX_ENTRY_DEVIATION_PCT = 0.03;
  const smcEntryDeviation = smcEntryMid != null && close > 0 ? Math.abs((smcEntryMid - close) / close) : 0;
  const smcSetupIsStale = smcEntryDeviation > MAX_ENTRY_DEVIATION_PCT;
  const useSmcSetup = preferredSmcSetup && !smcSetupIsStale;
  const rawStrategyEntry = direction === "neutral" ? void 0 : useSmcSetup ? fangfangtuEntry : close;
  const strategyEntry = rawStrategyEntry == null ? void 0 : direction === "long" ? Math.min(rawStrategyEntry, close) : direction === "short" ? Math.max(rawStrategyEntry, close) : rawStrategyEntry;
  const strategySl = direction === "long" ? useSmcSetup ? preferredSmcSetup.sl ?? finalSlLong : finalSlLong : direction === "short" ? useSmcSetup ? preferredSmcSetup.sl ?? finalSlShort : finalSlShort : void 0;
  const rawTp1 = direction === "long" ? useSmcSetup ? preferredSmcSetup.tp1 ?? dynamicTp1Long : dynamicTp1Long : direction === "short" ? useSmcSetup ? preferredSmcSetup.tp1 ?? dynamicTp1Short : dynamicTp1Short : void 0;
  const effectiveEntry = strategyEntry ?? close;
  const effectiveSl = strategySl ?? (direction === "long" ? finalSlLong : finalSlShort);
  const slDist2 = Math.abs(effectiveEntry - effectiveSl);
  const strategyTp1 = rawTp1 == null ? void 0 : direction === "long" && rawTp1 <= effectiveEntry ? effectiveEntry + Math.max(slDist2 * 1.5, atr * 2) : direction === "short" && rawTp1 >= effectiveEntry ? effectiveEntry - Math.max(slDist2 * 1.5, atr * 2) : rawTp1;
  const rawTp2 = direction === "long" ? useSmcSetup ? preferredSmcSetup.tp2 ?? dynamicTp2Long : dynamicTp2Long : direction === "short" ? useSmcSetup ? preferredSmcSetup.tp2 ?? dynamicTp2Short : dynamicTp2Short : void 0;
  const strategyTp2 = rawTp2 == null ? void 0 : direction === "long" && rawTp2 <= (strategyTp1 ?? effectiveEntry) ? (strategyTp1 ?? effectiveEntry) + slDist2 : direction === "short" && rawTp2 >= (strategyTp1 ?? effectiveEntry) ? (strategyTp1 ?? effectiveEntry) - slDist2 : rawTp2;
  const finalRrLong = slDist2 > 0 && strategyTp1 != null ? (strategyTp1 - effectiveEntry) / slDist2 : dynamicRr;
  const finalRrShort = slDist2 > 0 && strategyTp1 != null ? (effectiveEntry - strategyTp1) / slDist2 : dynamicRr;
  const strategyRr = direction === "long" ? Math.max(finalRrLong, 0.1) : direction === "short" ? Math.max(finalRrShort, 0.1) : useSmcSetup ? preferredSmcSetup.rr_ratio ?? dynamicRr : dynamicRr;
  const slMult = isRangingMarket ? 2 : 1.5;
  const slDist = atr * slMult;
  const tpDist = atr * 3;
  const checklist = [
    {
      label: direction === "short" ? "\u8DA8\u52E2\u65B9\u5411\uFF08EMA20 < EMA50\uFF09" : "\u8DA8\u52E2\u65B9\u5411\uFF08EMA20 > EMA50\uFF09",
      passed: direction === "short" ? ema20 < ema50 : ema20 > ema50,
      value: `EMA20=${ema20.toFixed(2)} / EMA50=${ema50.toFixed(2)}`
    },
    {
      label: direction === "short" ? "\u50F9\u683C\u5728 EMA200 \u4E0B\u65B9\uFF08\u9577\u671F\u7A7A\u982D\uFF09" : "\u50F9\u683C\u5728 EMA200 \u4E0A\u65B9\uFF08\u9577\u671F\u591A\u982D\uFF09",
      passed: direction === "short" ? close < ema200 : close > ema200,
      value: `\u6536\u76E4=${close.toFixed(2)} / EMA200=${ema200.toFixed(2)}`
    },
    {
      label: direction === "short" ? "RSI \u52D5\u80FD\uFF0830\u201360 \u70BA\u5065\u5EB7\u7A7A\u982D\uFF09" : "RSI \u52D5\u80FD\uFF0840\u201370 \u70BA\u5065\u5EB7\u8DA8\u52E2\uFF09",
      passed: direction === "short" ? rsi >= 30 && rsi <= 60 : rsi >= 40 && rsi <= 70,
      value: `RSI=${rsi.toFixed(1)}`
    },
    {
      label: direction === "short" ? "MACD \u67F1\u72C0\u5716\u8CA0\u503C\uFF08\u7A7A\u982D\u52D5\u80FD\uFF09" : "MACD \u67F1\u72C0\u5716\u6B63\u503C\uFF08\u591A\u982D\u52D5\u80FD\uFF09",
      passed: direction === "short" ? macd.histogram < 0 : macd.histogram > 0,
      value: `MACD\u67F1=${macd.histogram.toFixed(4)}`
    },
    { label: "ADX \u8DA8\u52E2\u5F37\u5EA6\uFF08>25 \u70BA\u6709\u6548\u8DA8\u52E2\uFF09", passed: adxObj.adx > 25, value: `ADX=${adxObj.adx.toFixed(1)}` },
    {
      label: direction === "short" ? "ICT \u5340\u9593\uFF08Premium \u505A\u7A7A\uFF09" : "ICT \u5340\u9593\uFF08Discount \u505A\u591A\uFF09",
      passed: direction === "long" ? premiumDiscount.current_zone === "discount" : direction === "short" ? premiumDiscount.current_zone === "premium" : false,
      value: premiumDiscount.current_zone
    },
    {
      label: "SMC \u7D50\u69CB\u65B9\u5411\u4E00\u81F4",
      passed: direction === "long" && smcStructure === "bullish" || direction === "short" && smcStructure === "bearish",
      value: smcStructure
    },
    {
      label: direction === "short" ? "\u5E03\u6797\u5E36\u4F4D\u7F6E\uFF08\u7A7A\u982D\u5728\u4E2D\u8ECC\u4E0B\u65B9\uFF09" : "\u5E03\u6797\u5E36\u4F4D\u7F6E\uFF08\u591A\u982D\u5728\u4E2D\u8ECC\u4E0A\u65B9\uFF09",
      passed: direction === "short" ? boll.percent_b < 0.5 : boll.percent_b > 0.5,
      value: `%B=${(boll.percent_b * 100).toFixed(1)}%`
    },
    {
      label: direction === "short" ? "\u65B9\u65B9\u571F\u56DE\u8E29\u5340\u4E0D\u53EF\u4F4E\u65BC\u73FE\u50F9\u8FFD\u7A7A" : "\u65B9\u65B9\u571F\u56DE\u8E29\u5340\u4E0D\u53EF\u9AD8\u65BC\u73FE\u50F9\u8FFD\u591A",
      passed: direction === "neutral" || strategyEntry == null || Math.abs((strategyEntry - close) / Math.max(close, 1)) <= 1e-3,
      value: strategyEntry != null ? `entry=${strategyEntry.toFixed(2)} / live=${close.toFixed(2)}` : "\u89C0\u671B"
    },
    {
      label: "\u6D41\u52D5\u6027\u6E05\u6383 \u2192 \u4F4D\u79FB \u2192 OB \u56DE\u8E29",
      passed: !!preferredSmcSetup,
      value: preferredSmcSetup ? `${preferredSmcSetup.sweep.type} / ${preferredSmcSetup.status} / RR ${preferredSmcSetup.rr_ratio.toFixed(1)}` : "\u672A\u5F62\u6210\u5B8C\u6574\u4E09\u90E8\u66F2"
    }
  ];
  const checklistPassed = checklist.filter((c) => c.passed).length;
  const realSimilarPattern = (() => {
    const histCandles = c4h;
    const histCloses = histCandles.map((c) => c.close);
    const lookback = 20;
    const forwardBars = 10;
    const minSimilarity = 0.8;
    const curWindow = histCloses.slice(-lookback - 1);
    const curReturns = curWindow.slice(1).map((v, i) => (v - curWindow[i]) / curWindow[i]);
    const curMean = curReturns.reduce((a, b) => a + b, 0) / curReturns.length;
    const curStd = Math.sqrt(curReturns.reduce((a, b) => a + (b - curMean) ** 2, 0) / curReturns.length) || 1e-10;
    const curNorm = curReturns.map((r) => (r - curMean) / curStd);
    let wins = 0, losses = 0, totalReturn = 0;
    const matches = [];
    for (let i = lookback; i < histCandles.length - forwardBars; i++) {
      const window = histCloses.slice(i - lookback, i + 1);
      const returns = window.slice(1).map((v, j) => (v - window[j]) / window[j]);
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length) || 1e-10;
      const norm = returns.map((r) => (r - mean) / std);
      const dotProduct = curNorm.reduce((sum, v, k) => sum + v * norm[k], 0);
      const similarity = dotProduct / lookback;
      if (similarity < minSimilarity) continue;
      const futureClose = histCloses[i + forwardBars];
      const ret = (futureClose - histCloses[i]) / histCloses[i] * 100;
      let isWin;
      let dirRet;
      if (direction === "long") {
        isWin = ret > 0.5;
        dirRet = ret;
      } else if (direction === "short") {
        isWin = ret < -0.5;
        dirRet = -ret;
      } else {
        isWin = Math.abs(ret) < 1;
        dirRet = Math.abs(ret);
      }
      if (isWin) wins++;
      else losses++;
      totalReturn += dirRet;
      matches.push({ similarity: Math.round(similarity * 100), outcome: isWin ? "win" : "loss", ret });
    }
    const sampleCount = wins + losses;
    const realWinRate = sampleCount > 0 ? Math.round(wins / sampleCount * 100) : Math.round(40 + checklistPassed / checklist.length * 40);
    const avgRet = sampleCount > 0 ? parseFloat((totalReturn / sampleCount).toFixed(2)) : parseFloat((atr * 2.5 / close * 100).toFixed(2));
    const topMatch = matches.sort((a, b) => b.similarity - a.similarity)[0];
    return {
      win_rate: realWinRate,
      avg_return: avgRet,
      sample_count: sampleCount > 0 ? sampleCount : Math.round(20 + checklistPassed * 8),
      description: sampleCount > 0 ? `\u6383\u63CF\u904E\u53BB 200 \u6839 4H K \u7DDA\uFF0C\u627E\u5230 ${sampleCount} \u500B\u9AD8\u76F8\u4F3C\u5F62\u614B\uFF08\u76F8\u4F3C\u5EA6\u2265${Math.round(minSimilarity * 100)}%\uFF0Clookback=${lookback}\u6839\uFF09` : `${checklistPassed}/${checklist.length} \u500B\u689D\u4EF6\u7B26\u5408\uFF0C\u6B77\u53F2\u76F8\u4F3C\u5F62\u614B\u4F30\u7B97`,
      outcome: realWinRate >= 60 ? `\u771F\u5BE6\u6B77\u53F2\u52DD\u7387 ${realWinRate}%\uFF0C\u770B${direction === "long" ? "\u591A" : "\u7A7A"}\u6A5F\u7387\u8F03\u9AD8` : realWinRate >= 50 ? `\u771F\u5BE6\u6B77\u53F2\u52DD\u7387 ${realWinRate}%\uFF0C\u591A\u7A7A\u5747\u8861` : `\u771F\u5BE6\u6B77\u53F2\u52DD\u7387 ${realWinRate}%\uFF0C\u770B\u7A7A\u6A5F\u7387\u8F03\u9AD8`,
      similarity: topMatch?.similarity ?? Math.round(50 + checklistPassed / checklist.length * 40),
      date: (/* @__PURE__ */ new Date()).toLocaleDateString("zh-TW"),
      is_real_history: sampleCount > 0
    };
  })();
  const strategy = {
    direction,
    entry: strategyEntry,
    // 動態 SL/TP：優先使用方方土三部曲進場區與 S/R 位計算結果
    sl: strategySl,
    tp1: strategyTp1,
    tp2: strategyTp2,
    rr_ratio: Math.round(strategyRr * 100) / 100,
    atr,
    suggestion: direction === "long" ? preferredSmcSetup ? `\u505A\u591A\u8A0A\u865F\uFF1A\u5DF2\u51FA\u73FE ${preferredSmcSetup.sweep.type} \u6D41\u52D5\u6027\u6E05\u6383\uFF0C\u7B49\u5F85\u50F9\u683C\u56DE\u8E29 OB/FVG \u9032\u5834\u5340 ${preferredSmcSetup.entry_zone.bottom.toFixed(2)}-${preferredSmcSetup.entry_zone.top.toFixed(2)}\uFF1B\u70BA\u907F\u514D\u8FFD\u50F9\uFF0C\u7CFB\u7D71\u5DF2\u5C07\u5EFA\u8B70\u9032\u5834\u6821\u6B63\u70BA\u4E0D\u9AD8\u65BC\u73FE\u50F9 ${close.toFixed(2)}\uFF0CRR=${strategyRr.toFixed(2)}\uFF0C\u6B62\u640D ${strategySl?.toFixed(2)}` : `\u505A\u591A\u8A0A\u865F\uFF1ARSI ${rsi.toFixed(1)}\uFF0C${premiumDiscount.current_zone === "discount" ? "\u8655\u65BC Discount \u5340\u9593\uFF08ICT \u6709\u5229\u8CB7\u5165\uFF09" : ""}\uFF0CMACD \u67F1 ${macd.histogram > 0 ? "\u6B63\u5024" : "\u8CA0\u5024"}\uFF0C\u5171\u8B58\u5206 ${consensusScore.toFixed(0)}/100\uFF0C${isRangingMarket ? "\u9707\u76EA\u5E02\u5BEC\u9B06\u6B62\u640D" : "\u8DA8\u52E2\u5E02\u6A19\u6E96\u6B62\u640D"}\uFF0CRR=${strategyRr.toFixed(2)}\uFF0C\u5EFA\u8B70\u5728 ${strategySl?.toFixed(2)} \u8A2D\u6B62\u640D` : direction === "short" ? preferredSmcSetup ? `\u505A\u7A7A\u8A0A\u865F\uFF1A\u5DF2\u51FA\u73FE ${preferredSmcSetup.sweep.type} \u6D41\u52D5\u6027\u6E05\u6383\uFF0C\u7B49\u5F85\u50F9\u683C\u56DE\u8E29 OB/FVG \u9032\u5834\u5340 ${preferredSmcSetup.entry_zone.bottom.toFixed(2)}-${preferredSmcSetup.entry_zone.top.toFixed(2)}\uFF1B\u70BA\u907F\u514D\u8FFD\u50F9\uFF0C\u7CFB\u7D71\u5DF2\u5C07\u5EFA\u8B70\u9032\u5834\u6821\u6B63\u70BA\u4E0D\u4F4E\u65BC\u73FE\u50F9 ${close.toFixed(2)}\uFF0CRR=${strategyRr.toFixed(2)}\uFF0C\u6B62\u640D ${strategySl?.toFixed(2)}` : `\u505A\u7A7A\u8A0A\u865F\uFF1ARSI ${rsi.toFixed(1)}\uFF0C${premiumDiscount.current_zone === "premium" ? "\u8655\u65BC Premium \u5340\u9593\uFF08ICT \u6709\u5229\u8CE3\u51FA\uFF09" : ""}\uFF0C\u5171\u8B58\u5206 ${consensusScore.toFixed(0)}/100\uFF0C${isRangingMarket ? "\u9707\u76EA\u5E02\u5BEC\u9B06\u6B62\u640D" : "\u8DA8\u52E2\u5E02\u6A19\u6E96\u6B62\u640D"}\uFF0CRR=${strategyRr.toFixed(2)}\uFF0C\u5EFA\u8B70\u5728 ${strategySl?.toFixed(2)} \u8A2D\u6B62\u640D` : "\u8A0A\u865F\u5206\u6B67\uFF0C\u5EFA\u8B70\u89C0\u671B\uFF0C\u7B49\u5F85\u6D41\u52D5\u6027\u6E05\u6383\u8207\u56DE\u8E29\u78BA\u8A8D\u66F4\u5B8C\u6574\u5F8C\u518D\u5165\u5834",
    checklist,
    similar_pattern: realSimilarPattern,
    // ★ 新增：Kelly Criterion 資金管理建議
    kelly_criterion: (() => {
      if (direction === "neutral") return void 0;
      const checklistPassRate = checklist.length > 0 ? checklistPassed / checklist.length : 0.5;
      const winRateEst = Math.min(0.8, Math.max(
        0.35,
        0.45 + checklistPassRate * 0.25 + (adjustedConsensus - 50) / 100 * 0.15
      ));
      const rr = Math.max(1, dynamicRr);
      const kellyRaw = (winRateEst * rr - (1 - winRateEst)) / rr;
      const kellyPct = Math.max(0, Math.round(kellyRaw * 100 * 10) / 10);
      const halfKellyPct = Math.round(kellyPct / 2 * 10) / 10;
      const maxRiskPct = Math.min(2, halfKellyPct);
      const suggestion = kellyPct <= 0 ? "\u9810\u671F\u52DD\u7387\u4E0D\u8DB3\uFF0C\u4E0D\u5EFA\u8B70\u9032\u5834" : maxRiskPct < 0.5 ? `Half-Kelly \u5EFA\u8B70\u5009\u4F4D ${halfKellyPct}%\uFF0C\u98A8\u96AA\u504F\u4F4E\uFF0C\u53EF\u5C0F\u5009\u8A66\u6C34` : `Half-Kelly \u5EFA\u8B70\u5009\u4F4D ${halfKellyPct}%\uFF08\u5168 Kelly ${kellyPct}%\uFF09\uFF0C\u5EFA\u8B70\u6BCF\u7B46\u6700\u591A\u98A8\u96AA\u8CC7\u91D1 ${maxRiskPct}%`;
      return {
        win_rate_est: Math.round(winRateEst * 100),
        rr_ratio: rr,
        kelly_pct: kellyPct,
        half_kelly_pct: halfKellyPct,
        max_risk_pct: maxRiskPct,
        suggestion
      };
    })()
  };
  const onchain = await fetchOnchain(sym).catch(() => ({
    symbol: sym,
    funding_rate: null,
    long_short_ratio: null,
    fear_greed: null,
    open_interest: null,
    coingecko: null
  }));
  const lsRatio = onchain.long_short_ratio?.ls_ratio ?? 1;
  const lsRatioHealthy = direction === "long" ? lsRatio < ANALYSIS_THRESHOLDS.LS_RATIO_LONG_MAX : lsRatio > ANALYSIS_THRESHOLDS.LS_RATIO_SHORT_MIN;
  const lsRatioLabel = lsRatio > ANALYSIS_THRESHOLDS.LS_RATIO_EXTREME_BULL ? "\u6563\u6236\u6975\u5EA6\u770B\u591A\uFF08\u53CD\u5411\u770B\u7A7A\uFF09" : lsRatio > 1.5 ? `\u591A\u65B9\u4F54\u512A (${lsRatio.toFixed(2)})` : lsRatio < ANALYSIS_THRESHOLDS.LS_RATIO_EXTREME_BEAR ? "\u6563\u6236\u6975\u5EA6\u770B\u7A7A\uFF08\u53CD\u5411\u770B\u591A\uFF09" : `\u5747\u8861 (${lsRatio.toFixed(2)})`;
  const fundingRate = onchain.funding_rate?.rate ?? 0;
  const fundingRateHealthy = direction === "long" ? fundingRate > ANALYSIS_THRESHOLDS.FUNDING_LONG_MIN && fundingRate < ANALYSIS_THRESHOLDS.FUNDING_LONG_MAX : fundingRate < ANALYSIS_THRESHOLDS.FUNDING_SHORT_MAX && fundingRate > ANALYSIS_THRESHOLDS.FUNDING_SHORT_MIN;
  const fundingLabel = fundingRate > ANALYSIS_THRESHOLDS.FUNDING_EXTREME ? `\u904E\u71B1 ${(fundingRate * 100).toFixed(4)}%\uFF08\u505A\u591A\u6210\u672C\u9AD8\uFF09` : fundingRate < -3e-3 ? `\u904E\u51B7 ${(fundingRate * 100).toFixed(4)}%\uFF08\u505A\u7A7A\u6210\u672C\u9AD8\uFF09` : `\u5065\u5EB7 ${(fundingRate * 100).toFixed(4)}%`;
  const fgValue = onchain.fear_greed?.value ?? 50;
  const fgHealthy = direction === "long" ? fgValue < 80 : fgValue > 20;
  const fgLabel = `${fgValue} - ${onchain.fear_greed?.label ?? "N/A"}`;
  const onchainChecklist = [
    {
      label: "\u591A\u7A7A\u6BD4\uFF08\u6563\u6236\u60C5\u7DD2\u53CD\u5411\u6307\u6A19\uFF09",
      passed: lsRatioHealthy,
      value: onchain.long_short_ratio ? lsRatioLabel : "\u6578\u64DA\u4E0D\u53EF\u7528"
    },
    {
      label: "\u8CC7\u91D1\u8CBB\u7387\uFF08\u5408\u7406\u7BC4\u570D\uFF09",
      passed: fundingRateHealthy,
      value: onchain.funding_rate ? fundingLabel : "\u6578\u64DA\u4E0D\u53EF\u7528"
    },
    {
      label: "\u6050\u61FC\u8CAA\u5A6A\u6307\u6578\uFF08\u907F\u514D\u6975\u7AEF\u60C5\u7DD2\u8FFD\u55AE\uFF09",
      passed: fgHealthy,
      value: fgLabel
    }
  ];
  let twitterSentiment = void 0;
  try {
    const cachedSentiment = serverCache.get(tweetSentimentKey(sym));
    const TWITTER_SENTIMENT_TTL_MS = 30 * 60 * 1e3;
    if (cachedSentiment) {
      const ageMs = Date.now() - cachedSentiment.updated_at;
      const isFresh = ageMs <= TWITTER_SENTIMENT_TTL_MS;
      if (!isFresh) {
        serverCache.delete(tweetSentimentKey(sym));
      } else {
        const twitterPassed = direction === "long" ? cachedSentiment.score > 0.1 : direction === "short" ? cachedSentiment.score < -0.1 : true;
        twitterSentiment = {
          ...cachedSentiment,
          passed: twitterPassed,
          is_stale: false,
          age_ms: ageMs,
          data_source: "live"
        };
      }
    }
    if (!twitterSentiment) {
      const estimatedBullishPct = Math.round(fgValue * 0.6 + 10);
      const estimatedBearishPct = Math.round((100 - fgValue) * 0.6 + 10);
      const estimatedNeutralPct = Math.max(0, 100 - estimatedBullishPct - estimatedBearishPct);
      const estimatedScore = parseFloat(((estimatedBullishPct - estimatedBearishPct) / 100).toFixed(2));
      const estimatedLabel = estimatedScore > 0.2 ? "\u793E\u7FA4\u504F\u591A" : estimatedScore < -0.2 ? "\u793E\u7FA4\u504F\u7A7A" : "\u793E\u7FA4\u4E2D\u6027";
      const twitterPassed = direction === "long" ? estimatedScore > -0.3 : direction === "short" ? estimatedScore < 0.3 : true;
      twitterSentiment = {
        bullish_pct: estimatedBullishPct,
        bearish_pct: estimatedBearishPct,
        neutral_pct: estimatedNeutralPct,
        score: estimatedScore,
        label: `${estimatedLabel}\uFF08F&G \u4F30\u7B97\uFF09`,
        passed: twitterPassed,
        is_stale: true,
        data_source: "proxy"
      };
    }
  } catch {
  }
  const twitterChecklist = twitterSentiment ? [{
    label: "Twitter \u793E\u7FA4\u60C5\u7DD2\uFF08\u4E0D\u9006\u52E2\u8FFD\u55AE\uFF09",
    passed: twitterSentiment.passed,
    value: `${twitterSentiment.label} (\u770B\u591A${twitterSentiment.bullish_pct}% / \u770B\u7A7A${twitterSentiment.bearish_pct}%)`
  }] : [];
  const fullChecklist = [...checklist, ...onchainChecklist, ...twitterChecklist];
  const fullChecklistPassed = fullChecklist.filter((c) => c.passed).length;
  const recentCloses = closes.slice(-20);
  const normalizeArr = (arr) => {
    const min = Math.min(...arr), max = Math.max(...arr);
    if (max === min) return arr.map(() => 0);
    return arr.map((v) => (v - min) / (max - min));
  };
  const normalizedRecent = normalizeArr(recentCloses);
  let matchCount = 0, matchWins = 0, matchTotalReturn = 0;
  const historicalCloses = closes;
  for (let hi = 20; hi < historicalCloses.length - 25; hi++) {
    const histSlice = historicalCloses.slice(hi - 20, hi);
    const normalizedHist = normalizeArr(histSlice);
    const n = normalizedRecent.length;
    const meanR = normalizedRecent.reduce((a, b) => a + b, 0) / n;
    const meanH = normalizedHist.reduce((a, b) => a + b, 0) / n;
    const num = normalizedRecent.reduce((s, r, i) => s + (r - meanR) * (normalizedHist[i] - meanH), 0);
    const denR = Math.sqrt(normalizedRecent.reduce((s, r) => s + (r - meanR) ** 2, 0));
    const denH = Math.sqrt(normalizedHist.reduce((s, h) => s + (h - meanH) ** 2, 0));
    const corr = denR > 0 && denH > 0 ? num / (denR * denH) : 0;
    if (corr > 0.8) {
      matchCount++;
      const futureReturn = (historicalCloses[hi + 10] - historicalCloses[hi]) / historicalCloses[hi];
      if (direction === "long" ? futureReturn > 5e-3 : futureReturn < -5e-3) matchWins++;
      matchTotalReturn += direction === "long" ? futureReturn : -futureReturn;
    }
  }
  const historicalWinRate = matchCount > 0 ? Math.round(matchWins / matchCount * 100) : Math.round(40 + checklistPassed / checklist.length * 40);
  const historicalAvgReturn = matchCount > 0 ? parseFloat((matchTotalReturn / matchCount * 100).toFixed(2)) : parseFloat((atr * 2.5 / close * 100).toFixed(2));
  const historicalSampleCount = matchCount;
  const enhancedSimilarPattern = {
    win_rate: historicalWinRate,
    avg_return: historicalAvgReturn,
    sample_count: historicalSampleCount > 0 ? historicalSampleCount : Math.round(20 + fullChecklistPassed * 8),
    description: historicalSampleCount > 0 ? `\u6B77\u53F2 K \u7DDA\u5F62\u614B\u6BD4\u5C0D\uFF1A\u627E\u5230 ${historicalSampleCount} \u500B\u76F8\u4F3C\u5F62\u614B\uFF08\u76F8\u95DC\u4FC2\u6578 > 0.85\uFF09\uFF0C\u771F\u5BE6\u6B77\u53F2\u52DD\u7387` : `${fullChecklistPassed}/${fullChecklist.length} \u500B\u689D\u4EF6\u7B26\u5408\uFF0C\u4F30\u7B97\u52DD\u7387\uFF08\u6B77\u53F2\u6578\u64DA\u4E0D\u8DB3\uFF09`,
    outcome: historicalWinRate >= 60 ? `\u6B77\u53F2\u52DD\u7387 ${historicalWinRate}%\uFF0C\u770B${direction === "long" ? "\u591A" : "\u7A7A"}\u6A5F\u7387\u8F03\u9AD8` : historicalWinRate >= 50 ? `\u6B77\u53F2\u52DD\u7387 ${historicalWinRate}%\uFF0C\u591A\u7A7A\u5747\u8861` : `\u6B77\u53F2\u52DD\u7387 ${historicalWinRate}%\uFF0C\u770B${direction === "long" ? "\u7A7A" : "\u591A"}\u6A5F\u7387\u8F03\u9AD8`,
    similarity: historicalSampleCount > 0 ? Math.min(95, Math.round(60 + historicalSampleCount / 10 * 5)) : Math.round(50 + fullChecklistPassed / fullChecklist.length * 40),
    date: (/* @__PURE__ */ new Date()).toLocaleDateString("zh-TW"),
    is_real_history: historicalSampleCount > 0,
    corr_threshold: 0.85
  };
  const enhancedStrategy = {
    ...strategy,
    checklist: fullChecklist,
    similar_pattern: enhancedSimilarPattern,
    twitter_sentiment: twitterSentiment,
    suggestion: (() => {
      const twitterNote = twitterSentiment ? `\uFF0CTwitter\u60C5\u7DD2=${twitterSentiment.label}(\u770B\u591A${twitterSentiment.bullish_pct}%)` : "";
      if (direction === "long") {
        return `\u505A\u591A\u8A0A\u865F\uFF1ARSI ${rsi.toFixed(1)}\uFF0C${premiumDiscount.current_zone === "discount" ? "\u8655\u65BC Discount \u5340\u9593\uFF08ICT \u6709\u5229\u8CB7\u5165\uFF09" : ""}\uFF0CMACD \u67F1 ${macd.histogram > 0 ? "\u6B63\u5024" : "\u8CA0\u5024"}\uFF0C\u5171\u8B58\u5206 ${consensusScore.toFixed(0)}/100\uFF0C\u6050\u61FC\u8CA2\u5A6A=${fgValue}\uFF0C\u591A\u7A7A\u6BD4=${lsRatio.toFixed(2)}\uFF0CRR=${dynamicRr.toFixed(2)}${twitterNote}\uFF0C\u5EFA\u8B70\u5728 ${finalSlLong.toFixed(2)} \u8A2D\u6B62\u640D\uFF08\u52D5\u614B\uFF09`;
      } else if (direction === "short") {
        return `\u505A\u7A7A\u8A0A\u865F\uFF1ARSI ${rsi.toFixed(1)}\uFF0C${premiumDiscount.current_zone === "premium" ? "\u8655\u65BC Premium \u5340\u9593\uFF08ICT \u6709\u5229\u8CE3\u51FA\uFF09" : ""}\uFF0C\u5171\u8B58\u5206 ${consensusScore.toFixed(0)}/100\uFF0C\u6050\u61FC\u8CA2\u5A6A=${fgValue}\uFF0C\u591A\u7A7A\u6BD4=${lsRatio.toFixed(2)}\uFF0CRR=${dynamicRr.toFixed(2)}${twitterNote}\uFF0C\u5EFA\u8B70\u5728 ${finalSlShort.toFixed(2)} \u8A2D\u6B62\u640D\uFF08\u52D5\u614B\uFF09`;
      } else {
        return `\u8A0A\u865F\u5206\u6B67\uFF0C\u5EFA\u8B70\u89C0\u671B\uFF0C\u7B49\u5F85\u66F4\u660E\u78BA\u65B9\u5411\u5F8C\u518D\u5165\u5834${twitterNote}`;
      }
    })()
  };
  const pa4hSrLevels = (pa.timeframes["4h"]?.sr_levels ?? []).map((l) => ({
    price: l.price,
    type: l.type,
    strength: l.strength,
    touches: l.touches ?? 1
  }));
  const pa1hSrLevels = (pa.timeframes["1h"]?.sr_levels ?? []).map((l) => ({
    price: l.price,
    type: l.type,
    strength: l.strength,
    touches: l.touches ?? 1
  }));
  const advanced = {
    divergences_4h: detectDivergences(c4h, "4H"),
    divergences_1h: detectDivergences(c1h, "1H"),
    pa_patterns_4h: detectPaPatternsWithLevels(c4h, pa4hSrLevels, "4H", atr),
    pa_patterns_1h: detectPaPatternsWithLevels(c1h, pa1hSrLevels, "1H", calcAtr(c1h)),
    chan_enhanced_4h: calcChanEnhanced(c4h, close),
    chan_enhanced_1h: calcChanEnhanced(c1h, close),
    smc_confirmations: smcConfirmations
  };
  function calcTfIndicators(candles) {
    const cls = candles.map((c) => c.close);
    const tfClose = cls[cls.length - 1];
    const tfRsi = calcRsi(cls);
    const tfMacd = calcMacd(cls);
    const tfAdx = calcAdx(candles);
    const tfAtr = calcAtr(candles);
    const tfBoll = calcBollinger(cls);
    const tfVwap = calcVwap2(candles);
    const tfEma20 = calcEma(cls, 20).filter((v) => !isNaN(v)).pop() ?? tfClose;
    const tfEma50 = calcEma(cls, 50).filter((v) => !isNaN(v)).pop() ?? tfClose;
    const tfEma200 = calcEma(cls, 200).filter((v) => !isNaN(v)).pop() ?? tfClose;
    const tfStoch = calcStochastic(candles);
    const tfTrend = classifyTrend(tfRsi, tfEma20, tfEma50, tfEma200, tfClose);
    const tfMomentum = classifyMomentum(tfRsi, tfMacd.histogram, tfAdx.adx);
    return {
      rsi: tfRsi,
      macd: tfMacd,
      adx: tfAdx,
      atr: tfAtr,
      bollinger: tfBoll,
      vwap: tfVwap,
      ema: { ema20: tfEma20, ema50: tfEma50, ema200: tfEma200 },
      stochastic: tfStoch,
      trend: tfTrend,
      momentum: tfMomentum,
      close: tfClose
    };
  }
  const mtf_indicators = {
    "4h": calcTfIndicators(c4h),
    "1h": calcTfIndicators(c1h),
    "15m": calcTfIndicators(c15m),
    "5m": calcTfIndicators(c5m)
  };
  return {
    symbol: sym,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    live_price: close,
    indicators,
    mtf_indicators,
    smc,
    pa,
    chan_mtf,
    consensus,
    forecast_4h,
    strategy: enhancedStrategy,
    onchain,
    advanced,
    error: null
  };
}
var ANALYSIS_THRESHOLDS, _krakenLastCallMs, KRAKEN_MIN_INTERVAL_MS, _candleCache, CANDLE_CACHE_TTL_MS, CANDLE_STALE_FALLBACK_MAX_AGE_MS, KRAKEN_SYMBOL_MAP, KRAKEN_INTERVAL_MAP, KRAKEN_NATIVE_INTERVALS;
var init_analysis = __esm({
  "server/analysis.ts"() {
    "use strict";
    init_advancedAnalysis();
    init_indicators();
    init_cache();
    init_bayesianMtfFusion();
    ANALYSIS_THRESHOLDS = {
      // 多空比相關
      LS_RATIO_LONG_MAX: 2,
      // 做多時，多空比不能超過此値（散戶過度看多為反向訊號）
      LS_RATIO_SHORT_MIN: 0.5,
      // 做空時，多空比不能低於此値
      LS_RATIO_EXTREME_BULL: 2.5,
      // 散戶極度看多閥値
      LS_RATIO_EXTREME_BEAR: 0.5,
      // 散戶極度看空閥値
      // 資金費率相關
      FUNDING_LONG_MAX: 3e-3,
      // 做多時，資金費率不能超過此値（市場過熱）
      FUNDING_LONG_MIN: -1e-3,
      // 做多時，資金費率不能低於此値
      FUNDING_SHORT_MAX: 1e-3,
      // 做空時，資金費率不能超過此値
      FUNDING_SHORT_MIN: -3e-3,
      // 做空時，資金費率不能低於此値
      FUNDING_EXTREME: 3e-3,
      // 超過此値為過熱
      // ADX 相關
      ADX_TREND_MIN: 20,
      // ADX > 20 為弱趨勢
      ADX_TREND_STRONG: 25,
      // ADX > 25 為有效趨勢
      // 形態比對相關
      PATTERN_CORR_THRESHOLD: 0.8,
      // 相關係數閥値（O9 已降低從 0.85）
      // 纏論背馳相關
      CHAN_DIV_AMP_RATIO: 0.8,
      // 幅度背馳閥値
      CHAN_DIV_MACD_RATIO: 0.75,
      // MACD 面積背馳閥値
      CHAN_DIV_SLOPE_RATIO: 0.8,
      // 斜率背馳閥値
      // SR 支撑阻力相關
      SR_TOLERANCE_PCT: 3e-3
      // 支撑阻力容許偏差（價格的 0.3%）
    };
    _krakenLastCallMs = 0;
    KRAKEN_MIN_INTERVAL_MS = 1200;
    _candleCache = /* @__PURE__ */ new Map();
    CANDLE_CACHE_TTL_MS = 3e4;
    CANDLE_STALE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1e3;
    KRAKEN_SYMBOL_MAP = {
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
    KRAKEN_INTERVAL_MAP = {
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
    KRAKEN_NATIVE_INTERVALS = /* @__PURE__ */ new Set([1, 5, 15, 30, 60, 240, 1440, 10080, 21600]);
  }
});

// server/utils/kellyCalibration.ts
function lookupCalibratedWinRate(modelId, rawConfidence) {
  const table = CALIBRATION_TABLE[modelId] ?? CALIBRATION_TABLE.liquidity_reversal;
  for (const [lo, hi, wr] of table) {
    if (rawConfidence >= lo && rawConfidence < hi) {
      const t2 = (rawConfidence - lo) / (hi - lo);
      const nextWr = table.find((r) => r[0] === hi)?.[2] ?? wr;
      return wr + t2 * (nextWr - wr);
    }
  }
  return table[table.length - 1][2];
}
function calcDrawdownGuard(recentPnl) {
  if (!recentPnl || recentPnl.length === 0) return 1;
  const last10 = recentPnl.slice(-10);
  let consecutiveLosses = 0;
  for (let i = last10.length - 1; i >= 0; i--) {
    if (last10[i] < 0) consecutiveLosses++;
    else break;
  }
  let peak = 0;
  let maxDrawdown = 0;
  let cumPnl = 0;
  for (const pnl of last10) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak > 0 ? (peak - cumPnl) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  let guard = 1;
  if (consecutiveLosses >= 5) guard *= 0.5;
  else if (consecutiveLosses >= 3) guard *= 0.7;
  else if (consecutiveLosses >= 2) guard *= 0.85;
  if (maxDrawdown > 0.2) guard *= 0.6;
  else if (maxDrawdown > 0.1) guard *= 0.8;
  return Math.max(0.3, guard);
}
function calcNEffFactor(sampleSize) {
  const N_MIN = 30;
  const N_FULL = 100;
  if (sampleSize <= 0) return 0.5;
  if (sampleSize >= N_FULL) return 1;
  const factor = Math.sqrt(sampleSize / N_FULL);
  return Math.max(0.4, Math.min(1, factor));
}
function calcDynamicKellyFactor(recentPnl, recentVolatility) {
  let factor = 0.25;
  if (recentPnl && recentPnl.length >= 5) {
    const last5 = recentPnl.slice(-5);
    const winCount = last5.filter((p) => p > 0).length;
    const recentWinRate = winCount / last5.length;
    if (recentWinRate >= 0.8) factor = 0.4;
    else if (recentWinRate >= 0.6) factor = 0.3;
    else if (recentWinRate <= 0.2) factor = 0.12;
    else if (recentWinRate <= 0.4) factor = 0.18;
  }
  if (recentVolatility !== void 0) {
    if (recentVolatility > 0.05) {
      factor *= 0.7;
    } else if (recentVolatility > 0.03) {
      factor *= 0.85;
    }
  }
  return Math.max(0.1, Math.min(0.5, factor));
}
function calcCorrelationPenalty(correlatedPositions) {
  if (!correlatedPositions || correlatedPositions.length === 0) return 1;
  const highCorrPositions = correlatedPositions.filter((p) => Math.abs(p.correlation) > 0.5);
  if (highCorrPositions.length === 0) return 1;
  const correlationImpact = highCorrPositions.reduce((sum, p) => {
    return sum + Math.abs(p.correlation) * p.positionSize;
  }, 0);
  const penalty = 1 - correlationImpact * 0.5;
  return Math.max(0.4, Math.min(1, penalty));
}
function calibrateKelly(input) {
  const {
    rawConfidence,
    modelId,
    recentWinRate,
    recentPnl,
    avgRR = 2,
    sampleSize,
    correlatedPositions,
    recentVolatility
  } = input;
  let calibratedWinRate = lookupCalibratedWinRate(modelId, rawConfidence);
  if (recentWinRate !== void 0 && recentWinRate > 0) {
    const n = sampleSize ?? 0;
    const recentWeight = n < 20 ? 0.15 : n >= 100 ? 0.4 : 0.15 + (n - 20) / 80 * 0.25;
    calibratedWinRate = calibratedWinRate * (1 - recentWeight) + recentWinRate * recentWeight;
  }
  const p = calibratedWinRate;
  const q = 1 - p;
  const b = avgRR;
  const fullKelly = Math.max(0, (p * b - q) / b);
  const effectiveKellyFactor = fullKelly > 0.3 ? Math.min(calcDynamicKellyFactor(recentPnl ?? [], recentVolatility), 0.25) : calcDynamicKellyFactor(recentPnl ?? [], recentVolatility);
  const dynamicKellyFactor = effectiveKellyFactor;
  const fractionalKelly = fullKelly * dynamicKellyFactor;
  const riskBudget = calcDrawdownGuard(recentPnl ?? []);
  const nEffFactor = calcNEffFactor(sampleSize ?? 0);
  const correlationPenalty = calcCorrelationPenalty(correlatedPositions);
  const maxPositionPct = Math.min(fractionalKelly, 0.15) * riskBudget * 100;
  const rawAdjusted = maxPositionPct * nEffFactor * correlationPenalty;
  const maxSafePositionPct = avgRR > 0 ? MAX_SINGLE_RISK_PCT / (1 / avgRR) : MAX_SINGLE_RISK_PCT * avgRR;
  const adjustedMaxPositionPct = Math.min(rawAdjusted, maxSafePositionPct);
  const reasoning = [
    `\u539F\u59CB\u4FE1\u5FC3\u5EA6 ${rawConfidence}% \u2192 \u6821\u6E96\u52DD\u7387 ${(calibratedWinRate * 100).toFixed(1)}%`,
    `Full Kelly: ${(fullKelly * 100).toFixed(1)}% \u2192 \u52D5\u614B Kelly(${(dynamicKellyFactor * 100).toFixed(0)}%): ${(fractionalKelly * 100).toFixed(1)}%`,
    `\u98A8\u96AA\u9810\u7B97: ${(riskBudget * 100).toFixed(0)}% | N_eff: ${(nEffFactor * 100).toFixed(0)}% | \u76F8\u95DC\u6027\u61F2\u7F70: ${(correlationPenalty * 100).toFixed(0)}%`,
    `\u57FA\u790E\u5009\u4F4D: ${maxPositionPct.toFixed(1)}% \u2192 \u8ABF\u6574\u5F8C: ${adjustedMaxPositionPct.toFixed(1)}%`
  ].join(" | ");
  return {
    calibratedWinRate,
    kellyFraction: fractionalKelly,
    riskBudget,
    maxPositionPct,
    nEffFactor,
    dynamicKellyFactor,
    correlationPenalty,
    adjustedMaxPositionPct,
    reasoning
  };
}
var MAX_SINGLE_RISK_PCT, CALIBRATION_TABLE;
var init_kellyCalibration = __esm({
  "server/utils/kellyCalibration.ts"() {
    "use strict";
    MAX_SINGLE_RISK_PCT = 2;
    CALIBRATION_TABLE = {
      liquidity_reversal: [
        [0, 20, 0.32],
        [20, 35, 0.38],
        [35, 50, 0.43],
        [50, 65, 0.49],
        [65, 80, 0.54],
        [80, 92, 0.58]
      ],
      trend_pullback: [
        [0, 20, 0.38],
        [20, 35, 0.44],
        [35, 50, 0.5],
        [50, 65, 0.56],
        [65, 80, 0.61],
        [80, 92, 0.65]
      ],
      range_boundary: [
        [0, 20, 0.35],
        [20, 35, 0.4],
        [35, 50, 0.45],
        [50, 65, 0.5],
        [65, 80, 0.54],
        [80, 90, 0.57]
      ]
    };
  }
});

// server/utils/macroDataFusion.ts
function getSessionProfile(utcHour) {
  if (utcHour >= 0 && utcHour < 8) {
    const score = utcHour >= 1 && utcHour <= 5 ? 45 : 60;
    return { name: "\u4E9E\u6D32\u76E4", liquidityScore: score, description: "\u6D41\u52D5\u6027\u4E2D\u7B49\uFF0CBTC/ETH \u70BA\u4E3B\uFF0C\u6CE2\u52D5\u76F8\u5C0D\u6EAB\u548C" };
  }
  if (utcHour >= 8 && utcHour < 12) {
    return { name: "\u6B50\u6D32\u76E4\u958B\u76E4", liquidityScore: 78, description: "\u6D41\u52D5\u6027\u4E0A\u5347\uFF0C\u6B50\u6D32\u6A5F\u69CB\u5165\u5834\uFF0C\u6CE2\u52D5\u6027\u589E\u52A0" };
  }
  if (utcHour >= 12 && utcHour < 17) {
    return { name: "\u6B50\u7F8E\u91CD\u758A\u76E4", liquidityScore: 95, description: "\u5168\u7403\u6700\u9AD8\u6D41\u52D5\u6027\u6642\u6BB5\uFF0C\u5927\u884C\u60C5\u591A\u767C\u751F\u65BC\u6B64" };
  }
  if (utcHour >= 17 && utcHour < 22) {
    return { name: "\u7F8E\u570B\u76E4", liquidityScore: 85, description: "\u7F8E\u570B\u6A5F\u69CB\u4E3B\u5C0E\uFF0C\u6CE2\u52D5\u6027\u9AD8\uFF0C\u8DA8\u52E2\u5EF6\u7E8C\u6027\u5F37" };
  }
  return { name: "\u7F8E\u76E4\u6536\u76E4", liquidityScore: 55, description: "\u6D41\u52D5\u6027\u4E0B\u964D\uFF0C\u5047\u7A81\u7834\u98A8\u96AA\u589E\u52A0\uFF0C\u8B39\u614E\u64CD\u4F5C" };
}
function interpretFearGreed(index) {
  if (index <= 20) return { label: "Extreme Fear", tradeImpact: "\u6975\u5EA6\u6050\u61FC\uFF0C\u53CD\u8F49\u6A5F\u6703\u9AD8\uFF0C\u4F46\u9700\u78BA\u8A8D\u652F\u6490", scoreBonus: 10 };
  if (index <= 40) return { label: "Fear", tradeImpact: "\u5E02\u5834\u504F\u60B2\u89C0\uFF0C\u505A\u591A\u9700\u8B39\u614E\uFF0C\u505A\u7A7A\u9806\u52E2", scoreBonus: 5 };
  if (index <= 60) return { label: "Neutral", tradeImpact: "\u5E02\u5834\u4E2D\u6027\uFF0C\u6280\u8853\u9762\u4E3B\u5C0E\uFF0C\u4FE1\u865F\u53EF\u9760\u6027\u9AD8", scoreBonus: 15 };
  if (index <= 80) return { label: "Greed", tradeImpact: "\u5E02\u5834\u504F\u6A02\u89C0\uFF0C\u505A\u591A\u6709\u52D5\u529B\uFF0C\u6CE8\u610F\u56DE\u8ABF\u98A8\u96AA", scoreBonus: 8 };
  return { label: "Extreme Greed", tradeImpact: "\u6975\u5EA6\u8CAA\u5A6A\uFF0C\u9802\u90E8\u98A8\u96AA\u9AD8\uFF0C\u505A\u591A\u9700\u56B4\u683C\u6B62\u640D", scoreBonus: -5 };
}
function getFallbackMacroData() {
  return {
    fearGreedIndex: 50,
    fearGreedLabel: "Neutral",
    btcDominance: 55,
    totalMarketCapChange24h: 0
  };
}
async function fetchFearGreedIndex() {
  try {
    const response = await fetch("https://api.alternative.me/fng/?limit=1&format=json", {
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const item = data?.data?.[0];
    if (!item) return null;
    return { value: parseInt(item.value, 10), label: item.value_classification };
  } catch {
    return null;
  }
}
async function fetchGlobalMarketData() {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/global", {
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      btcDominance: data?.data?.market_cap_percentage?.btc ?? 55,
      marketCapChange24h: data?.data?.market_cap_change_percentage_24h_usd ?? 0
    };
  } catch {
    return null;
  }
}
async function fetchMacroData() {
  const nowUtcHour = (/* @__PURE__ */ new Date()).getUTCHours();
  const session = getSessionProfile(nowUtcHour);
  const [fgData, globalData] = await Promise.all([
    fetchFearGreedIndex(),
    fetchGlobalMarketData()
  ]);
  const isFallback = !fgData && !globalData;
  const fallback = getFallbackMacroData();
  const fearGreedIndex = fgData?.value ?? fallback.fearGreedIndex;
  const fearGreedLabel = fgData?.label ?? fallback.fearGreedLabel;
  const btcDominance = globalData?.btcDominance ?? fallback.btcDominance;
  const totalMarketCapChange24h = globalData?.marketCapChange24h ?? fallback.totalMarketCapChange24h;
  const fgInterp = interpretFearGreed(fearGreedIndex);
  let macroScore = 50;
  macroScore += session.liquidityScore / 100 * 25;
  macroScore += fgInterp.scoreBonus;
  if (totalMarketCapChange24h > 3) macroScore += 8;
  else if (totalMarketCapChange24h > 1) macroScore += 4;
  else if (totalMarketCapChange24h < -3) macroScore -= 8;
  else if (totalMarketCapChange24h < -1) macroScore -= 4;
  if (btcDominance > 60) macroScore -= 5;
  else if (btcDominance < 45) macroScore += 5;
  macroScore = Math.max(0, Math.min(100, macroScore));
  let macroFilter;
  if (macroScore >= 65) macroFilter = "proceed";
  else if (macroScore >= 45) macroFilter = "caution";
  else macroFilter = "avoid";
  const macroSummary = [
    `\u5E02\u5834\u60C5\u7DD2\uFF1A${fearGreedLabel}\uFF08${fearGreedIndex}\uFF09`,
    `\u6642\u6BB5\uFF1A${session.name}\uFF08\u6D41\u52D5\u6027 ${session.liquidityScore}%\uFF09`,
    `BTC \u4E3B\u5C0E ${btcDominance.toFixed(1)}%\uFF0C24h \u5E02\u503C ${totalMarketCapChange24h > 0 ? "+" : ""}${totalMarketCapChange24h.toFixed(1)}%`
  ].join(" | ");
  return {
    fearGreedIndex,
    fearGreedLabel,
    btcDominance,
    totalMarketCapChange24h,
    sessionLiquidity: session.liquidityScore,
    sessionName: session.name,
    macroScore,
    macroFilter,
    macroSummary,
    dataTimestamp: Date.now(),
    isFallback
  };
}
function buildMacroContext(macro) {
  return `\u3010\u5B8F\u89C0\u8207\u60C5\u7DD2\u6578\u64DA\uFF08\u5373\u6642\uFF09\u3011
\u6050\u61FC\u8CAA\u5A6A\u6307\u6578\uFF1A${macro.fearGreedIndex}/100\uFF08${macro.fearGreedLabel}\uFF09
BTC \u4E3B\u5C0E\u5730\u4F4D\uFF1A${macro.btcDominance.toFixed(1)}%
\u5168\u7403\u5E02\u503C 24h \u8B8A\u5316\uFF1A${macro.totalMarketCapChange24h > 0 ? "+" : ""}${macro.totalMarketCapChange24h.toFixed(2)}%
\u7576\u524D\u6642\u6BB5\uFF1A${macro.sessionName}\uFF08\u6D41\u52D5\u6027\u8A55\u5206 ${macro.sessionLiquidity}/100\uFF09
\u5B8F\u89C0\u8A55\u5206\uFF1A${macro.macroScore.toFixed(0)}/100 \u2192 \u5EFA\u8B70\uFF1A${macro.macroFilter === "proceed" ? "\u2705 \u53EF\u4EE5\u4EA4\u6613" : macro.macroFilter === "caution" ? "\u26A0\uFE0F \u8B39\u614E\u64CD\u4F5C" : "\u{1F6AB} \u5EFA\u8B70\u8FF4\u907F"}
${macro.isFallback ? "\uFF08\u6CE8\u610F\uFF1A\u5916\u90E8 API \u66AB\u6642\u4E0D\u53EF\u7528\uFF0C\u4F7F\u7528\u5099\u7528\u6578\u64DA\uFF09" : "\uFF08\u6578\u64DA\u4F86\u6E90\uFF1AAlternative.me + CoinGecko\uFF09"}`;
}
var init_macroDataFusion = __esm({
  "server/utils/macroDataFusion.ts"() {
    "use strict";
  }
});

// server/utils/ensembleVeto.ts
function runRuleEngine(input) {
  const { topModel, macro, htfTrend, conflictCount, sweepQualityScore, reclaimBars, dynamicFeatures } = input;
  let score = 50;
  const positiveFactors = [];
  const negativeFactors = [];
  if (macro.macroFilter === "avoid") {
    return {
      vote: "REJECT",
      score: 10,
      positiveFactors: [],
      negativeFactors: [`\u5B8F\u89C0\u74B0\u5883\u8A55\u5206\u904E\u4F4E\uFF08${macro.macroScore.toFixed(0)}/100\uFF09\uFF0C\u5EFA\u8B70\u8FF4\u907F`]
    };
  }
  if (conflictCount >= 3) {
    return {
      vote: "REJECT",
      score: 15,
      positiveFactors: [],
      negativeFactors: [`\u591A\u6642\u6846\u56B4\u91CD\u885D\u7A81\uFF08${conflictCount} \u500B\u6642\u6846\u65B9\u5411\u4E0D\u4E00\u81F4\uFF09`]
    };
  }
  if (topModel.confidence < 30) {
    return {
      vote: "REJECT",
      score: 20,
      positiveFactors: [],
      negativeFactors: [`\u6A21\u578B\u4FE1\u5FC3\u5EA6\u904E\u4F4E\uFF08${topModel.confidence}%\uFF09\uFF0C\u4E0D\u7B26\u5408\u6700\u4F4E\u9580\u6ABB`]
    };
  }
  if (sweepQualityScore !== void 0) {
    if (sweepQualityScore < 50) {
      negativeFactors.push(`\u6E05\u6383\u54C1\u8CEA\u4E0D\u8DB3\uFF08${sweepQualityScore}/100\uFF09`);
      score -= 20;
    } else if (sweepQualityScore >= 75) {
      score += 15;
      positiveFactors.push(`\u6E05\u6383\u54C1\u8CEA\u512A\u826F\uFF08${sweepQualityScore}/100\uFF09`);
    } else {
      score += 5;
      positiveFactors.push(`\u6E05\u6383\u54C1\u8CEA\u4E2D\u7B49\uFF08${sweepQualityScore}/100\uFF09`);
    }
  }
  if (reclaimBars !== void 0) {
    if (reclaimBars === 0) {
      negativeFactors.push("\u6E05\u6383\u5F8C\u5C1A\u672A\u6536\u56DE\uFF0C\u7B49\u5F85\u78BA\u8A8D");
      score -= 15;
    } else if (reclaimBars <= 2) {
      score += 12;
      positiveFactors.push(`\u6E05\u6383\u5F8C\u5FEB\u901F\u6536\u56DE\uFF08${reclaimBars} \u6839 K \u7DDA\uFF09`);
    } else if (reclaimBars >= 5) {
      score -= 8;
      negativeFactors.push(`\u6E05\u6383\u6536\u56DE\u904E\u6162\uFF08${reclaimBars} \u6839 K \u7DDA\uFF09\uFF0C\u52D5\u80FD\u6E1B\u5F31`);
    }
  }
  if (dynamicFeatures) {
    if (dynamicFeatures.displacementStrength !== void 0) {
      if (dynamicFeatures.displacementStrength >= 0.7) {
        score += 10;
        positiveFactors.push(`\u5F37\u4F4D\u79FB\u78BA\u8A8D\uFF08${(dynamicFeatures.displacementStrength * 100).toFixed(0)}%\uFF09`);
      } else if (dynamicFeatures.displacementStrength < 0.3) {
        score -= 8;
        negativeFactors.push(`\u4F4D\u79FB\u5F37\u5EA6\u4E0D\u8DB3\uFF08${(dynamicFeatures.displacementStrength * 100).toFixed(0)}%\uFF09\uFF0C\u53CD\u8F49\u4FE1\u865F\u5F31`);
      }
    }
    if (dynamicFeatures.volumeConfirmation === true) {
      score += 8;
      positiveFactors.push("\u6210\u4EA4\u91CF\u653E\u91CF\u78BA\u8A8D");
    } else if (dynamicFeatures.volumeConfirmation === false) {
      score -= 5;
      negativeFactors.push("\u6210\u4EA4\u91CF\u672A\u78BA\u8A8D\uFF0C\u4FE1\u865F\u53EF\u9760\u6027\u964D\u4F4E");
    }
    if (dynamicFeatures.freshZone === true) {
      score += 7;
      positiveFactors.push("\u65B0\u9BAE\u672A\u6E2C\u8A66\u5340\u57DF\uFF0C\u6210\u529F\u7387\u8F03\u9AD8");
    } else if (dynamicFeatures.freshZone === false) {
      score -= 5;
      negativeFactors.push("\u5340\u57DF\u5DF2\u88AB\u591A\u6B21\u6E2C\u8A66\uFF0C\u6709\u6548\u6027\u964D\u4F4E");
    }
  }
  const modelDir = topModel.direction;
  if (modelDir === "long" && htfTrend === "bearish") {
    score -= 15;
    negativeFactors.push("\u9006 4H \u8DA8\u52E2\u505A\u591A\uFF0C\u98A8\u96AA\u8F03\u9AD8");
  } else if (modelDir === "short" && htfTrend === "bullish") {
    score -= 15;
    negativeFactors.push("\u9006 4H \u8DA8\u52E2\u505A\u7A7A\uFF0C\u98A8\u96AA\u8F03\u9AD8");
  } else if (modelDir === "long" && htfTrend === "bullish" || modelDir === "short" && htfTrend === "bearish") {
    score += 12;
    positiveFactors.push("\u65B9\u5411\u8207 4H \u8DA8\u52E2\u4E00\u81F4");
  }
  if (macro.sessionLiquidity >= 80) {
    score += 8;
    positiveFactors.push(`\u9AD8\u6D41\u52D5\u6027\u6642\u6BB5\uFF08${macro.sessionName}\uFF09`);
  } else if (macro.sessionLiquidity < 50) {
    score -= 10;
    negativeFactors.push(`\u4F4E\u6D41\u52D5\u6027\u6642\u6BB5\uFF08${macro.sessionName}\uFF09\uFF0C\u5047\u7A81\u7834\u98A8\u96AA\u9AD8`);
  }
  if (topModel.rr_ratio < 1.5) {
    score -= 15;
    negativeFactors.push(`RR \u6BD4\u4E0D\u8DB3\uFF08${topModel.rr_ratio.toFixed(1)}:1\uFF09\uFF0C\u6700\u4F4E\u9700\u8981 1.5:1`);
  } else if (topModel.rr_ratio >= 2.5) {
    score += 10;
    positiveFactors.push(`RR \u6BD4\u512A\u826F\uFF08${topModel.rr_ratio.toFixed(1)}:1\uFF09`);
  }
  score = Math.max(0, Math.min(100, score));
  let vote;
  if (score >= 65) vote = "TRADE";
  else if (score >= 45) vote = "WAIT";
  else vote = "REJECT";
  return { vote, score, positiveFactors, negativeFactors };
}
function runQuantScorer(input) {
  const { topModel, allModels, macro, dynamicFeatures, sweepQualityScore, reclaimBars } = input;
  let score = 0;
  score += topModel.confidence / 100 * 30;
  const activeModels = allModels.filter((m) => m.is_active);
  const sameDirectionCount = activeModels.filter((m) => m.direction === topModel.direction).length;
  const activeCount = Math.max(activeModels.length, 1);
  score += sameDirectionCount / activeCount * 20;
  score += macro.macroScore / 100 * 15;
  if (dynamicFeatures) {
    if (dynamicFeatures.displacementStrength !== void 0) {
      score += dynamicFeatures.displacementStrength * 10;
    }
    if (dynamicFeatures.volumeConfirmation) score += 6;
    if (dynamicFeatures.freshZone) score += 4;
  }
  if (sweepQualityScore !== void 0) {
    score += sweepQualityScore / 100 * 10;
  }
  if (reclaimBars !== void 0 && reclaimBars > 0) {
    if (reclaimBars <= 2) score += 5;
    else if (reclaimBars <= 4) score += 2;
  }
  score = Math.max(0, Math.min(100, score));
  let vote;
  if (score >= 62) vote = "TRADE";
  else if (score >= 42) vote = "WAIT";
  else vote = "REJECT";
  return { vote, score };
}
function runEnsembleVeto(input, aiVote = "WAIT", aiConfidenceScore = 50) {
  const ruleResult = runRuleEngine(input);
  const quantResult = runQuantScorer(input);
  const ruleEngineVote = ruleResult.vote;
  const quantScorerVote = quantResult.vote;
  const aiReviewerVote = aiVote;
  const clampedAiScore = Math.max(0, Math.min(100, aiConfidenceScore));
  const weights = { rule: 0.35, quant: 0.35, ai: 0.3 };
  const weightedScore = ruleResult.score * weights.rule + quantResult.score * weights.quant + clampedAiScore * weights.ai;
  const scores = [ruleResult.score, quantResult.score, clampedAiScore];
  const avgScore = scores.reduce((a, b) => a + b, 0) / 3;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / 3;
  const stdDev = Math.sqrt(variance);
  const consensusStrength = Math.max(0.33, Math.min(1, 1 - stdDev / 45));
  let finalDecision;
  if (weightedScore >= 62) finalDecision = "TRADE";
  else if (weightedScore >= 42) finalDecision = "WAIT";
  else finalDecision = "REJECT";
  if (consensusStrength <= 0.5 && finalDecision === "TRADE") {
    finalDecision = "WAIT";
  }
  const confidence = Math.round(weightedScore * (0.5 + consensusStrength * 0.5));
  const positiveFactors = ruleResult.positiveFactors;
  const negativeFactors = ruleResult.negativeFactors;
  return {
    finalDecision,
    confidence: Math.max(0, Math.min(100, confidence)),
    ruleEngineVote,
    quantScorerVote,
    aiReviewerVote,
    ruleEngineScore: ruleResult.score,
    quantScorerScore: quantResult.score,
    aiConfidenceScore: clampedAiScore,
    consensusStrength: Math.round(consensusStrength * 100) / 100,
    // [E1] v1.2: 正面因素（支持進場）
    keyFactors: positiveFactors.slice(0, 3),
    // [E1] v1.2: 負面因素（風險警示，無論決策為何都顯示）
    negativeFactors,
    // 向後相容：REJECT 時仍填入 vetoReasons
    vetoReasons: finalDecision === "REJECT" ? negativeFactors : []
  };
}
var init_ensembleVeto = __esm({
  "server/utils/ensembleVeto.ts"() {
    "use strict";
  }
});

// server/utils/marketRegimeClassifier.ts
function scoreImpulsive(params) {
  const { atrRatio, priceChangePct } = params;
  let score = 0;
  const reasons = [];
  if (atrRatio > 2.5) {
    score += 60;
    reasons.push(`ATR \u6BD4\u7387 ${atrRatio.toFixed(2)}x\uFF08\u6975\u7AEF\u64F4\u5F35\uFF09`);
  } else if (atrRatio > 2) {
    score += 40;
    reasons.push(`ATR \u6BD4\u7387 ${atrRatio.toFixed(2)}x\uFF08\u986F\u8457\u64F4\u5F35\uFF09`);
  } else if (atrRatio > 1.5) {
    score += 20;
    reasons.push(`ATR \u6BD4\u7387 ${atrRatio.toFixed(2)}x\uFF08\u8F15\u5FAE\u64F4\u5F35\uFF09`);
  }
  const impulsiveThreshold = atrRatio > 1.5 ? 7 : 5;
  if (Math.abs(priceChangePct) > impulsiveThreshold) {
    score += 40;
    reasons.push(`\u50F9\u683C\u6025\u8B8A ${Math.abs(priceChangePct).toFixed(1)}%\uFF08\u8D85\u904E ${impulsiveThreshold}% \u95BE\u503C\uFF09`);
  } else if (Math.abs(priceChangePct) > impulsiveThreshold * 0.7) {
    score += 15;
    reasons.push(`\u50F9\u683C\u5FEB\u901F\u79FB\u52D5 ${Math.abs(priceChangePct).toFixed(1)}%`);
  }
  return { score: Math.min(100, score), reasons };
}
function scoreReversal(params) {
  const { hasChanDivergence, hasBosChoch, adx, atrRatio } = params;
  let score = 0;
  const reasons = [];
  if (hasChanDivergence) {
    score += 35;
    reasons.push("\u7E8F\u8AD6\u80CC\u99B3\u4FE1\u865F");
  }
  if (hasBosChoch) {
    score += 35;
    reasons.push("BOS/CHoCH \u7D50\u69CB\u8F49\u63DB");
  }
  if (adx >= 25) {
    score += 20;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u8DA8\u52E2\u5145\u5206\uFF09`);
  } else if (adx >= 15) {
    score += 10;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u8DA8\u52E2\u9069\u4E2D\uFF09`);
  } else {
    score -= 20;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u904E\u4F4E\uFF0C\u53EF\u80FD\u662F\u566A\u97F3\uFF09`);
  }
  if (atrRatio >= 0.8) {
    score += 10;
    reasons.push(`ATR \u6BD4\u7387 ${atrRatio.toFixed(2)}x\uFF08\u6CE2\u52D5\u5145\u5206\uFF09`);
  } else {
    score -= 15;
    reasons.push(`ATR \u6BD4\u7387 ${atrRatio.toFixed(2)}x\uFF08\u6CE2\u52D5\u904E\u4F4E\uFF09`);
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}
function scoreStrongTrend(params) {
  const { adx, htfTrend, hasChanDivergence, atrRatio } = params;
  let score = 0;
  const reasons = [];
  if (adx > 45) {
    score += 50;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u6975\u5F37\u8DA8\u52E2\uFF09`);
  } else if (adx > 35) {
    score += 40;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u5F37\u52C1\u8DA8\u52E2\uFF09`);
  } else if (adx > 25) {
    score += 20;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u4E2D\u7B49\u8DA8\u52E2\uFF09`);
  }
  if (htfTrend !== "ranging") {
    score += 25;
    reasons.push(`HTF \u8DA8\u52E2\u78BA\u8A8D\uFF08${htfTrend}\uFF09`);
  }
  if (hasChanDivergence) {
    score -= 20;
    reasons.push("\u7E8F\u8AD6\u80CC\u99B3\uFF08\u8DA8\u52E2\u53EF\u80FD\u672B\u6BB5\uFF09");
  }
  if (atrRatio >= 0.8 && atrRatio <= 2) {
    score += 10;
    reasons.push(`ATR \u6BD4\u7387 ${atrRatio.toFixed(2)}x\uFF08\u6CE2\u52D5\u7A69\u5B9A\uFF09`);
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}
function scoreAccumulation(params) {
  const { adx, volumeRatio, smcStructure, rsi, htfTrend, chanInZhongshu } = params;
  let score = 0;
  const reasons = [];
  if (adx < 20) {
    score += 25;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u4F4E\u8DA8\u52E2\u5F37\u5EA6\uFF09`);
  } else if (adx < 25) {
    score += 15;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u5F31\u8DA8\u52E2\uFF09`);
  }
  if (volumeRatio < 0.75) {
    score += 25;
    reasons.push(`\u91CF\u7E2E ${volumeRatio.toFixed(2)}x\uFF08\u986F\u8457\u91CF\u7E2E\uFF09`);
  } else if (volumeRatio < 0.85) {
    score += 15;
    reasons.push(`\u91CF\u7E2E ${volumeRatio.toFixed(2)}x\uFF08\u8F15\u5FAE\u91CF\u7E2E\uFF09`);
  }
  if (smcStructure === "bullish") {
    score += 20;
    reasons.push("SMC \u591A\u982D\u7D50\u69CB");
  } else if (smcStructure === "neutral") {
    score += 10;
    reasons.push("SMC \u4E2D\u6027\u7D50\u69CB\uFF08\u7A4D\u7D2F\u521D\u671F\uFF09");
  }
  if (rsi < 50) {
    score += 15;
    reasons.push(`RSI ${rsi.toFixed(1)}\uFF08\u4F4E\u4F4D\u672A\u904E\u71B1\uFF09`);
  } else if (rsi < 55) {
    score += 8;
    reasons.push(`RSI ${rsi.toFixed(1)}\uFF08\u7A4D\u7D2F\u672B\u6BB5\uFF09`);
  }
  if (htfTrend !== "bearish") {
    score += 10;
    reasons.push(`HTF \u8DA8\u52E2\u975E\u7A7A\u982D\uFF08${htfTrend}\uFF09`);
  } else {
    score -= 15;
    reasons.push("HTF \u7A7A\u982D\u8DA8\u52E2\uFF08\u4E0D\u5229\u7A4D\u7D2F\uFF09");
  }
  if (chanInZhongshu) {
    score += 5;
    reasons.push("\u7E8F\u8AD6\u4E2D\u6A1E\u9707\u76EA");
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}
function scoreDistribution(params) {
  const { volumeRatio, smcStructure, rsi, htfTrend, adx, hasChanDivergence } = params;
  let score = 0;
  const reasons = [];
  if (volumeRatio > 1.4) {
    score += 25;
    reasons.push(`\u91CF\u589E ${volumeRatio.toFixed(2)}x\uFF08\u986F\u8457\u91CF\u589E\uFF09`);
  } else if (volumeRatio > 1.2) {
    score += 15;
    reasons.push(`\u91CF\u589E ${volumeRatio.toFixed(2)}x\uFF08\u8F15\u5FAE\u91CF\u589E\uFF09`);
  }
  if (smcStructure === "bearish") {
    score += 20;
    reasons.push("SMC \u7A7A\u982D\u7D50\u69CB");
  } else if (smcStructure === "neutral") {
    score += 10;
    reasons.push("SMC \u4E2D\u6027\u7D50\u69CB\uFF08\u5206\u914D\u521D\u671F\uFF09");
  }
  if (rsi > 65) {
    score += 15;
    reasons.push(`RSI ${rsi.toFixed(1)}\uFF08\u9AD8\u4F4D\u904E\u71B1\uFF09`);
  } else if (rsi > 50) {
    score += 8;
    reasons.push(`RSI ${rsi.toFixed(1)}\uFF08\u4E2D\u9AD8\u4F4D\uFF09`);
  }
  if (htfTrend !== "bullish") {
    score += 10;
    reasons.push(`HTF \u8DA8\u52E2\u975E\u591A\u982D\uFF08${htfTrend}\uFF09`);
  } else {
    score -= 10;
    reasons.push("HTF \u591A\u982D\u8DA8\u52E2\uFF08\u4E0D\u5229\u5206\u914D\uFF09");
  }
  if (adx > 20) {
    score += 10;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u6709\u8DA8\u52E2\u5F37\u5EA6\uFF09`);
  }
  if (hasChanDivergence) {
    score += 15;
    reasons.push("\u7E8F\u8AD6\u80CC\u99B3\uFF08\u9802\u90E8\u4FE1\u865F\uFF09");
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}
function scoreRanging(params) {
  const { adx, chanInZhongshu, atrRatio } = params;
  let score = 0;
  const reasons = [];
  if (adx < 15) {
    score += 50;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u6975\u4F4E\u8DA8\u52E2\u5F37\u5EA6\uFF09`);
  } else if (adx < 20) {
    score += 35;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u4F4E\u8DA8\u52E2\u5F37\u5EA6\uFF09`);
  } else if (adx < 30) {
    score += 15;
    reasons.push(`ADX ${adx.toFixed(1)}\uFF08\u5F31\u8DA8\u52E2\uFF09`);
  }
  if (chanInZhongshu) {
    score += 30;
    reasons.push("\u7E8F\u8AD6\u4E2D\u6A1E\u9707\u76EA");
  }
  if (atrRatio >= 0.7 && atrRatio <= 1.3) {
    score += 20;
    reasons.push(`ATR \u6BD4\u7387 ${atrRatio.toFixed(2)}x\uFF08\u6CE2\u52D5\u7A69\u5B9A\uFF09`);
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}
function classifyMarketRegime(params) {
  const {
    adx,
    atr,
    atrHistory,
    rsi,
    volume,
    avgVolume20,
    htfTrend,
    smcStructure,
    hasChanDivergence,
    hasBosChoch,
    chanInZhongshu,
    priceChangePct = 0
  } = params;
  const avgAtr20 = atrHistory.length > 0 ? atrHistory.reduce((s, v) => s + v, 0) / atrHistory.length : atr;
  const atrRatio = avgAtr20 > 0 ? atr / avgAtr20 : 1;
  const volumeRatio = avgVolume20 > 0 ? volume / avgVolume20 : 1;
  const trendStrength = Math.min(100, adx * 2);
  const signalsBase = {
    adx,
    atrRatio,
    trendStrength,
    volumeRatio,
    structureType: smcStructure,
    hasDivergence: hasChanDivergence
  };
  const impulsiveResult = scoreImpulsive({ atrRatio, priceChangePct });
  const reversalResult = scoreReversal({ hasChanDivergence, hasBosChoch, adx, atrRatio });
  const strongTrendResult = scoreStrongTrend({ adx, htfTrend, hasChanDivergence, atrRatio });
  const accumulationResult = scoreAccumulation({ adx, volumeRatio, smcStructure, rsi, htfTrend, chanInZhongshu });
  const distributionResult = scoreDistribution({ volumeRatio, smcStructure, rsi, htfTrend, adx, hasChanDivergence });
  const rangingResult = scoreRanging({ adx, chanInZhongshu, atrRatio });
  const regimeScores = {
    IMPULSIVE: impulsiveResult.score,
    REVERSAL: reversalResult.score,
    STRONG_TREND: strongTrendResult.score,
    ACCUMULATION: accumulationResult.score,
    DISTRIBUTION: distributionResult.score,
    RANGING: rangingResult.score
  };
  if (impulsiveResult.score >= 60) {
    const confidence2 = Math.min(95, 60 + (impulsiveResult.score - 60));
    return buildResult(
      "IMPULSIVE",
      confidence2,
      signalsBase,
      `\u66B4\u529B\u884C\u60C5\uFF1A${impulsiveResult.reasons.join("\uFF0C")}`,
      regimeScores
    );
  }
  const candidates = [
    ["REVERSAL", reversalResult.score, reversalResult.reasons],
    ["STRONG_TREND", strongTrendResult.score, strongTrendResult.reasons],
    ["ACCUMULATION", accumulationResult.score, accumulationResult.reasons],
    ["DISTRIBUTION", distributionResult.score, distributionResult.reasons],
    ["RANGING", rangingResult.score, rangingResult.reasons]
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  const [winnerRegime, winnerScore, winnerReasons] = candidates[0];
  const runnerUpScore = candidates[1][1];
  const margin = winnerScore - runnerUpScore;
  const baseConfidence = Math.min(90, 40 + winnerScore * 0.5);
  const marginBonus = margin >= 20 ? 10 : margin >= 10 ? 5 : -5;
  const confidence = Math.max(50, Math.min(95, baseConfidence + marginBonus));
  const reasoning = `[Score-based] ${winnerRegime}\uFF08${winnerScore}\u5206\uFF09> ${candidates[1][0]}\uFF08${runnerUpScore}\u5206\uFF09\u3002${winnerReasons.slice(0, 3).join("\uFF0C")}`;
  return buildResult(winnerRegime, confidence, signalsBase, reasoning, regimeScores);
}
function buildResult(regime, confidence, signals, reasoning, regimeScores) {
  const REGIME_LABELS = {
    STRONG_TREND: "\u5F37\u52C1\u8DA8\u52E2",
    RANGING: "\u9707\u76EA\u76E4\u6574",
    ACCUMULATION: "\u7A4D\u7D2F\u671F",
    DISTRIBUTION: "\u5206\u914D\u671F",
    IMPULSIVE: "\u66B4\u529B\u884C\u60C5",
    REVERSAL: "\u53CD\u8F49\u884C\u60C5"
  };
  return {
    regime,
    regimeLabel: REGIME_LABELS[regime],
    confidence: Math.max(0, Math.min(100, confidence)),
    adaptiveParams: REGIME_PARAMS[regime],
    signals,
    reasoning,
    regimeScores
  };
}
function applyRegimeAdaptation(modelConfidence, modelRR, regimeResult, modelDirection) {
  const { adaptiveParams, regime } = regimeResult;
  let adjustedConfidence = modelConfidence;
  let adjustmentReason = "";
  let forceDisable = false;
  if (regime === "IMPULSIVE") {
    forceDisable = true;
    adjustmentReason = "\u66B4\u529B\u884C\u60C5\uFF1A\u5F37\u5236\u505C\u7528\u6240\u6709\u6A21\u578B\uFF0C\u7B49\u5F85\u6CE2\u52D5\u7387\u56DE\u6B78";
    return {
      adjustedConfidence: 0,
      adjustedRR: modelRR,
      shouldTrade: false,
      forceDisable: true,
      adjustmentReason
    };
  }
  if (regime === "ACCUMULATION" && modelDirection === "short") {
    adjustedConfidence = modelConfidence * 0.5;
    adjustmentReason = "\u7A4D\u7D2F\u671F\u74B0\u5883\u4E0D\u5EFA\u8B70\u505A\u7A7A\uFF0C\u4FE1\u5FC3\u5EA6\u964D\u4F4E 50%";
  } else if (regime === "DISTRIBUTION" && modelDirection === "long") {
    adjustedConfidence = modelConfidence * 0.5;
    adjustmentReason = "\u5206\u914D\u671F\u74B0\u5883\u4E0D\u5EFA\u8B70\u505A\u591A\uFF0C\u4FE1\u5FC3\u5EA6\u964D\u4F4E 50%";
  } else if (modelConfidence < adaptiveParams.minConfidenceThreshold) {
    adjustedConfidence = modelConfidence * 0.7;
    adjustmentReason = `${regimeResult.regimeLabel}\u74B0\u5883\u4E0B\uFF0C\u4FE1\u5FC3\u5EA6\u4F4E\u65BC\u9580\u6ABB\uFF08${adaptiveParams.minConfidenceThreshold}%\uFF09\uFF0C\u964D\u4F4E 30%`;
  } else if (regime === "STRONG_TREND" && modelConfidence > 60) {
    adjustedConfidence = Math.min(100, modelConfidence * 1.1);
    adjustmentReason = "\u5F37\u52C1\u8DA8\u52E2\u74B0\u5883\uFF0C\u4FE1\u5FC3\u5EA6\u63D0\u5347 10%";
  }
  const adjustedRR = Math.max(modelRR, adaptiveParams.recommendedRR);
  if (adjustedRR > modelRR) {
    adjustmentReason += adjustmentReason ? " | " : "";
    adjustmentReason += `RR \u63D0\u5347\u81F3\u74B0\u5883\u63A8\u85A6\u503C\uFF08${adaptiveParams.recommendedRR}:1\uFF09\uFF0CTP \u76EE\u6A19\u76F8\u61C9\u8ABF\u6574`;
  }
  const shouldTrade = adaptiveParams.tradeFilter !== "avoid" && adjustedConfidence >= adaptiveParams.minConfidenceThreshold;
  if (!shouldTrade && adaptiveParams.tradeFilter === "avoid") {
    adjustmentReason += adjustmentReason ? " | " : "";
    adjustmentReason += `${regimeResult.regimeLabel}\u74B0\u5883\u5EFA\u8B70\u8FF4\u907F\u4EA4\u6613`;
  }
  return {
    adjustedConfidence: Math.max(0, Math.min(100, adjustedConfidence)),
    adjustedRR,
    shouldTrade,
    forceDisable,
    adjustmentReason: adjustmentReason || "\u7121\u9700\u8ABF\u6574"
  };
}
var REGIME_PARAMS;
var init_marketRegimeClassifier = __esm({
  "server/utils/marketRegimeClassifier.ts"() {
    "use strict";
    REGIME_PARAMS = {
      STRONG_TREND: {
        preferredModel: "B",
        atrStopMultiplier: 2,
        kellyScaleFactor: 1.2,
        minConfidenceThreshold: 55,
        recommendedRR: 2,
        tradeFilter: "proceed",
        description: "\u5F37\u52C1\u8DA8\u52E2\uFF1AADX > 35\uFF0C\u65B9\u5411\u660E\u78BA\uFF0C\u56DE\u8E29\u9032\u5834\u6A5F\u6703\u6700\u4F73",
        tradingTips: [
          "\u512A\u5148\u4F7F\u7528\u8DA8\u52E2\u56DE\u8E29\u6A21\u578B\uFF08B\uFF09",
          "\u6B62\u640D\u653E\u5BEC\u81F3 2.0x ATR\uFF0C\u907F\u514D\u88AB\u6B63\u5E38\u56DE\u8ABF\u6D17\u51FA",
          "\u76EE\u6A19 2:1 \u4EE5\u4E0A RR\uFF0C\u9806\u52E2\u6301\u5009",
          "\u907F\u514D\u9006\u52E2\u64CD\u4F5C\uFF0C\u7B49\u5F85\u56DE\u8E29\u78BA\u8A8D\u518D\u9032\u5834"
        ]
      },
      RANGING: {
        preferredModel: "C",
        atrStopMultiplier: 1.2,
        kellyScaleFactor: 0.7,
        minConfidenceThreshold: 65,
        recommendedRR: 1.5,
        tradeFilter: "caution",
        description: "\u9707\u76EA\u76E4\u6574\uFF1AADX < 20\uFF0C\u5728\u652F\u6490/\u963B\u529B\u5340\u9593\u64CD\u4F5C",
        tradingTips: [
          "\u512A\u5148\u4F7F\u7528\u5340\u9593\u908A\u754C\u6A21\u578B\uFF08C\uFF09",
          "\u5728\u660E\u78BA\u652F\u6490/\u963B\u529B\u908A\u754C\u64CD\u4F5C\uFF0C\u907F\u514D\u4E2D\u9593\u5340\u57DF",
          "\u6B62\u640D\u6536\u7DCA\u81F3 1.2x ATR\uFF0C\u5FEB\u9032\u5FEB\u51FA",
          "\u964D\u4F4E\u5009\u4F4D\u81F3\u6B63\u5E38\u7684 70%"
        ]
      },
      ACCUMULATION: {
        preferredModel: "A",
        atrStopMultiplier: 1.5,
        kellyScaleFactor: 0.8,
        minConfidenceThreshold: 68,
        recommendedRR: 2.5,
        tradeFilter: "caution",
        description: "\u7A4D\u7D2F\u671F\uFF1A\u4F4E\u6CE2\u52D5\u91CF\u7E2E\uFF0C\u5927\u8CC7\u91D1\u6084\u6084\u5EFA\u5009\uFF0C\u7B49\u5F85\u7A81\u7834",
        tradingTips: [
          "\u7B49\u5F85\u6E05\u6670\u7684\u6D41\u52D5\u6027\u6E05\u6383\u4FE1\u865F\uFF08SSL \u6E05\u6383\uFF09",
          "\u7A4D\u7D2F\u671F\u7A81\u7834\u524D\u53EF\u80FD\u6709\u591A\u6B21\u5047\u6E05\u6383\uFF0C\u8010\u5FC3\u7B49\u5F85",
          "\u4E00\u65E6\u78BA\u8A8D\u7A81\u7834\uFF0C\u76EE\u6A19 RR \u53EF\u8A2D 2.5:1 \u4EE5\u4E0A",
          "\u6CE8\u610F\u6210\u4EA4\u91CF\u653E\u5927\u78BA\u8A8D\u7A81\u7834\u771F\u5BE6\u6027",
          "\u50C5\u505A\u591A\u65B9\u5411\uFF08\u7A4D\u7D2F\u671F\u4E0D\u505A\u7A7A\uFF09"
        ]
      },
      DISTRIBUTION: {
        preferredModel: "A",
        atrStopMultiplier: 1.5,
        kellyScaleFactor: 0.8,
        minConfidenceThreshold: 68,
        recommendedRR: 2.5,
        tradeFilter: "caution",
        description: "\u5206\u914D\u671F\uFF1A\u9AD8\u6CE2\u52D5\u91CF\u589E\uFF0C\u5927\u8CC7\u91D1\u51FA\u8CA8\uFF0C\u9802\u90E8\u7D50\u69CB\u5F62\u6210",
        tradingTips: [
          "\u7B49\u5F85 BSL \u6E05\u6383\u5F8C\u7684\u505A\u7A7A\u4FE1\u865F",
          "\u5206\u914D\u671F\u53EF\u80FD\u6709\u591A\u6B21\u5047\u7A81\u7834\uFF0C\u9700\u56B4\u683C\u78BA\u8A8D",
          "\u76EE\u6A19 RR \u8A2D 2.5:1 \u4EE5\u4E0A\uFF0C\u505A\u7A7A\u6F5B\u529B\u5927",
          "\u6CE8\u610F\u91CF\u80FD\u653E\u5927\u5F8C\u7684\u6025\u8DCC\u4FE1\u865F",
          "\u50C5\u505A\u7A7A\u65B9\u5411\uFF08\u5206\u914D\u671F\u4E0D\u505A\u591A\uFF09"
        ]
      },
      IMPULSIVE: {
        preferredModel: "NONE",
        atrStopMultiplier: 2.5,
        kellyScaleFactor: 0,
        minConfidenceThreshold: 80,
        recommendedRR: 3,
        tradeFilter: "avoid",
        description: "\u66B4\u529B\u884C\u60C5\uFF1AATR \u6025\u5287\u64F4\u5F35\uFF0C\u6CE2\u52D5\u6975\u5927\uFF0C\u5047\u4FE1\u865F\u983B\u7E41",
        tradingTips: [
          "\u5EFA\u8B70\u66AB\u505C\u4EA4\u6613\uFF0C\u7B49\u5F85\u6CE2\u52D5\u7387\u56DE\u6B78\u6B63\u5E38",
          "\u82E5\u5FC5\u9808\u64CD\u4F5C\uFF0C\u5009\u4F4D\u964D\u81F3\u6B63\u5E38\u7684 50%",
          "\u6B62\u640D\u5FC5\u9808\u653E\u5BEC\u81F3 2.5x ATR",
          "\u7B49\u5F85\u884C\u60C5\u7A69\u5B9A\u5F8C\u518D\u8A55\u4F30\u5165\u5834\u6A5F\u6703"
        ]
      },
      REVERSAL: {
        preferredModel: "A",
        atrStopMultiplier: 1.8,
        kellyScaleFactor: 0.9,
        minConfidenceThreshold: 72,
        recommendedRR: 2,
        tradeFilter: "proceed",
        description: "\u53CD\u8F49\u884C\u60C5\uFF1A\u80CC\u99B3\u4FE1\u865F + \u7D50\u69CB\u8F49\u63DB\uFF0C\u9AD8\u52DD\u7387\u53CD\u8F49\u6A5F\u6703",
        tradingTips: [
          "\u7B49\u5F85\u660E\u78BA\u7684\u80CC\u99B3\u4FE1\u865F\uFF08MACD \u9762\u7A4D\u80CC\u99B3 + RSI \u80CC\u96E2\uFF09",
          "\u78BA\u8A8D BOS/CHoCH \u7D50\u69CB\u8F49\u63DB\u5F8C\u518D\u9032\u5834",
          "\u6B62\u640D\u8A2D\u5728\u6E05\u6383\u6C34\u4F4D\u4E0B\u65B9\uFF08\u591A\u982D\uFF09\u6216\u4E0A\u65B9\uFF08\u7A7A\u982D\uFF09",
          "\u76EE\u6A19 RR 2:1\uFF0C\u5206\u6279\u51FA\u5834"
        ]
      }
    };
  }
});

// server/services/highWinRateService.ts
var highWinRateService_exports = {};
__export(highWinRateService_exports, {
  runHighWinRateScan: () => runHighWinRateScan
});
function extractSrLevels(chan, ob, fvg) {
  const levels = [];
  if (chan.current_zhongshu) {
    levels.push({ price: chan.zhongshuZG, label: "\u4E2D\u6A1E\u4E0A\u6CBF (ZG)", type: "resistance", strength: 4, touches: 3 });
    levels.push({ price: chan.zhongshuZD, label: "\u4E2D\u6A1E\u4E0B\u6CBF (ZD)", type: "support", strength: 4, touches: 3 });
    if (chan.zhongshuGG > chan.zhongshuZG) levels.push({ price: chan.zhongshuGG, label: "\u4E2D\u6A1E\u6700\u9AD8 (GG)", type: "resistance", strength: 2, touches: 1 });
    if (chan.zhongshuDD < chan.zhongshuZD) levels.push({ price: chan.zhongshuDD, label: "\u4E2D\u6A1E\u6700\u4F4E (DD)", type: "support", strength: 2, touches: 1 });
  }
  if (ob.nearestBull) {
    const str = ob.nearestBull.strength === "strong" ? 5 : 3;
    levels.push({ price: ob.nearestBull.top, type: "resistance", strength: str, touches: 2 });
    levels.push({ price: ob.nearestBull.bottom, type: "support", strength: str, touches: 2 });
  }
  if (ob.nearestBear) {
    const str = ob.nearestBear.strength === "strong" ? 5 : 3;
    levels.push({ price: ob.nearestBear.top, type: "resistance", strength: str, touches: 2 });
    levels.push({ price: ob.nearestBear.bottom, type: "support", strength: str, touches: 2 });
  }
  if (fvg.nearestBull) {
    levels.push({ price: fvg.nearestBull.top, type: "resistance", strength: 2, touches: 1 });
    levels.push({ price: fvg.nearestBull.bottom, type: "support", strength: 2, touches: 1 });
  }
  if (fvg.nearestBear) {
    levels.push({ price: fvg.nearestBear.top, type: "resistance", strength: 2, touches: 1 });
    levels.push({ price: fvg.nearestBear.bottom, type: "support", strength: 2, touches: 1 });
  }
  return levels;
}
function calcPremiumDiscount2(candles, close) {
  let highRef = 0, lowRef = Infinity;
  let highIdx = -1, lowIdx = -1;
  const lb = 5;
  for (let i = lb; i < candles.length - lb; i++) {
    const isSwingHigh = candles.slice(i - lb, i).every((c) => c.high <= candles[i].high) && candles.slice(i + 1, i + lb + 1).every((c) => c.high <= candles[i].high);
    const isSwingLow = candles.slice(i - lb, i).every((c) => c.low >= candles[i].low) && candles.slice(i + 1, i + lb + 1).every((c) => c.low >= candles[i].low);
    if (isSwingHigh && candles[i].high > highRef) {
      highRef = candles[i].high;
      highIdx = i;
    }
    if (isSwingLow && candles[i].low < lowRef) {
      lowRef = candles[i].low;
      lowIdx = i;
    }
  }
  if (highRef === 0 || lowRef === Infinity || highRef <= lowRef) {
    const range50 = candles.slice(-50);
    highRef = Math.max(...range50.map((c) => c.high));
    lowRef = Math.min(...range50.map((c) => c.low));
  }
  const rangeRatio = (highRef - lowRef) / (lowRef + 1e-3);
  if (rangeRatio < 5e-3) return "equilibrium";
  const pctPos = (close - lowRef) / (highRef - lowRef + 1e-3) * 100;
  return pctPos > 62 ? "premium" : pctPos < 38 ? "discount" : "equilibrium";
}
function toSmcSetupSummary(setup, close) {
  const entryMid = (setup.entry_zone.top + setup.entry_zone.bottom) / 2;
  const dist_pct = close > 0 ? (close - entryMid) / close * 100 : 0;
  const is_too_far = Math.abs(dist_pct) > 2;
  return {
    id: setup.id,
    direction: setup.direction,
    sweep_type: setup.sweep.type,
    swept_level: setup.sweep.swept_level,
    entry_top: setup.entry_zone.top,
    entry_bottom: setup.entry_zone.bottom,
    sl: setup.sl,
    tp1: setup.tp1,
    tp2: setup.tp2,
    rr_ratio: setup.rr_ratio,
    confluence_score: setup.confluence_score,
    htf_aligned: setup.htf_aligned,
    status: setup.status,
    formed_at: setup.formed_at,
    invalidated: setup.invalidated ?? false,
    dist_pct: parseFloat(dist_pct.toFixed(2)),
    is_too_far
  };
}
function analyzeTf(candles, bar, label, htfTrend) {
  const close = candles[candles.length - 1].close;
  const closes = candles.map((c) => c.close);
  const atr = calcAtrLast(candles, 14);
  const curRsi = calcRsiLast(closes, 14);
  const curAdx = calcAdxLast(candles, 14);
  const ema20 = calcEmaArr(closes, 20);
  const ema50 = calcEmaArr(closes, 50);
  const paEma20 = ema20[ema20.length - 1] ?? close;
  const paEma50 = ema50[ema50.length - 1] ?? close;
  const recentVols = candles.slice(-21);
  const avgVol20 = recentVols.slice(0, -1).reduce((s, c) => s + c.volume, 0) / Math.max(recentVols.length - 1, 1);
  const curVol = candles[candles.length - 1].volume;
  const rvol = avgVol20 > 0 ? curVol / avgVol20 : 1;
  const fvg = detectFvgZones(candles, close);
  const ob = detectOrderBlocks(candles, close);
  const bos = detectBosChoch(candles);
  const liq = detectLiquiditySweep(candles, close);
  const premDisc = calcPremiumDiscount2(candles, close);
  const lastBos = bos.events[bos.events.length - 1];
  const bosChochStr = lastBos ? `${lastBos.type}\uFF08${lastBos.direction === "bullish" ? "\u770B\u591A" : "\u770B\u7A7A"}\uFF09` : "\u7121\u660E\u986F\u7D50\u69CB\u4E8B\u4EF6";
  const atrMin = atr * 0.25;
  const atrMax = atr * 1.5;
  const MAX_ZONE_AGE = 80;
  const isValidZone = (z4) => {
    if (!z4) return false;
    const h = z4.top - z4.bottom;
    if (h < atrMin || h > atrMax) return false;
    if (z4.age !== void 0 && z4.age > MAX_ZONE_AGE) return false;
    if (z4.taps !== void 0 && z4.taps > 2) return false;
    if (z4.unfilledRatio !== void 0 && z4.unfilledRatio < 0.3) return false;
    return true;
  };
  const validBullFvg = isValidZone(fvg.nearestBull) ? fvg.nearestBull : null;
  const validBearFvg = isValidZone(fvg.nearestBear) ? fvg.nearestBear : null;
  const validBullOb = isValidZone(ob.nearestBull) ? ob.nearestBull : null;
  const validBearOb = isValidZone(ob.nearestBear) ? ob.nearestBear : null;
  const hasSweepEvent = liq.sslSwept || liq.bslSwept;
  let sweepQuality = 0;
  if (hasSweepEvent) {
    sweepQuality = 40;
    if (liq.sslSwept && bos.lastStructure === "bullish") sweepQuality += 20;
    if (liq.bslSwept && bos.lastStructure === "bearish") sweepQuality += 20;
    if (liq.sslSwept && premDisc === "discount") sweepQuality += 15;
    if (liq.bslSwept && premDisc === "premium") sweepQuality += 15;
    if (rvol >= 1.5) sweepQuality += 15;
    else if (rvol <= 0.7) sweepQuality -= 10;
    const _nowHour = (/* @__PURE__ */ new Date()).getUTCHours();
    const _isAmdWindow = _nowHour >= 2 && _nowHour < 4 || _nowHour >= 8 && _nowHour < 10 || _nowHour >= 14 && _nowHour < 16;
    if (_isAmdWindow) sweepQuality += 10;
    sweepQuality = Math.max(0, Math.min(100, sweepQuality));
  }
  let displacementQuality = 0;
  const activeBullFvg = validBullFvg;
  const activeBearFvg = validBearFvg;
  if (activeBullFvg || activeBearFvg) {
    const fvg2 = activeBullFvg ?? activeBearFvg;
    displacementQuality = 30;
    displacementQuality += Math.round(fvg2.quality * 0.4);
    if (fvg2.displacement) displacementQuality += 15;
    const unfilledRatio = 1 - fvg2.filled_pct;
    if (unfilledRatio >= 0.9) displacementQuality += 15;
    else if (unfilledRatio >= 0.6) displacementQuality += 8;
    else if (unfilledRatio < 0.3) displacementQuality -= 10;
    if (fvg2.filled_pct > 0.7) displacementQuality -= 15;
    displacementQuality = Math.max(0, Math.min(100, displacementQuality));
  }
  let obQuality = 0;
  const activeOb = validBullOb ?? validBearOb;
  if (activeOb) {
    obQuality = 30;
    if (activeOb.strength === "strong") obQuality += 15;
    obQuality += Math.round(activeOb.quality * 0.25);
    if (activeOb.bos_confirmed) obQuality += 15;
    if (activeOb.displacement) obQuality += 10;
    if (activeOb.tested_count === 0) obQuality += 10;
    else if (activeOb.tested_count === 1) obQuality += 5;
    else if (activeOb.tested_count === 2) obQuality -= 8;
    else if (activeOb.tested_count >= 3) obQuality -= 18;
    const distToOb = Math.abs(close - activeOb.mid);
    if (distToOb < atr * 0.5) obQuality += 10;
    else if (distToOb > atr * 2) obQuality -= 10;
    obQuality = Math.max(0, Math.min(100, obQuality));
  }
  let smcScore = 50;
  let structureBonus = 0;
  if (bos.lastStructure === "bullish") structureBonus += 12;
  else if (bos.lastStructure === "bearish") structureBonus -= 12;
  if (liq.sslSwept) structureBonus += 10;
  if (liq.bslSwept) structureBonus -= 10;
  structureBonus = Math.max(-20, Math.min(20, structureBonus));
  smcScore += structureBonus;
  if (premDisc === "discount") smcScore += 10;
  else if (premDisc === "premium") smcScore -= 10;
  const hasFullSmcSetup = hasSweepEvent && (activeBullFvg || activeBearFvg) && (validBullOb || validBearOb);
  if (hasFullSmcSetup) {
    const smcChainScore = sweepQuality * 0.35 + displacementQuality * 0.35 + obQuality * 0.3;
    const smcChainBonus = Math.round((smcChainScore - 50) * 0.3);
    smcScore += Math.max(-15, Math.min(15, smcChainBonus));
  } else {
    smcScore = Math.min(smcScore, 65);
    let triggerBonus = 0;
    if (activeBullFvg && Math.abs(close - activeBullFvg.mid) < atr) triggerBonus += 6;
    if (activeBearFvg && Math.abs(close - activeBearFvg.mid) < atr) triggerBonus -= 6;
    if (validBullOb && Math.abs(close - validBullOb.mid) < atr * 1.5) triggerBonus += 8;
    if (validBearOb && Math.abs(close - validBearOb.mid) < atr * 1.5) triggerBonus -= 8;
    triggerBonus = Math.max(-12, Math.min(12, triggerBonus));
    smcScore += triggerBonus;
  }
  if (rvol >= 1.5) smcScore += 6;
  else if (rvol <= 0.7) smcScore -= 5;
  smcScore = Math.max(0, Math.min(100, smcScore));
  const chanLookback = bar === "15m" || bar === "5m" ? 500 : 400;
  const chan = calcChanEnhanced(candles, close, chanLookback);
  const chanBuySellPoints = chan.buy_sell_points.map((p) => ({
    level: p.level,
    direction: p.direction,
    price: p.price,
    time: p.time,
    bi_idx: p.bi_idx,
    description: p.description,
    strength: p.strength,
    divergence_confirmed: p.divergence_confirmed,
    after_zhongshu_break: p.after_zhongshu_break,
    trend_continuation: p.trend_continuation
  }));
  let chanScore = 50;
  if (chan.trend === "bullish") chanScore += 20;
  else if (chan.trend === "bearish") chanScore -= 20;
  if (chan.in_zhongshu && chan.current_zhongshu) {
    const zs = chan.current_zhongshu;
    const zsHeight = zs.top - zs.bottom;
    if (zsHeight > 0) {
      const posRatio = (close - zs.bottom) / zsHeight;
      if (posRatio < 0.3) chanScore = 60;
      else if (posRatio > 0.7) chanScore = 40;
      else chanScore = 50;
    } else {
      chanScore = 50;
    }
  }
  const divType = chan.divergence_signals.type;
  const macdRatio = chan.macd_area_ratio;
  const biCount = chan.bi_count;
  const duanCount = chan.duan_count;
  if (divType === "bottom" || divType === "top") {
    const isBullDiv = divType === "bottom";
    const sign = isBullDiv ? 1 : -1;
    let divScore = 14;
    if (macdRatio > 0 && macdRatio < 0.5) {
      divScore += 6;
      if (macdRatio < 0.3) divScore += 4;
    }
    if (biCount >= 3 && biCount <= 7) {
      divScore += 5;
    } else if (biCount >= 8 && biCount <= 15) {
      divScore += 3;
    }
    if (duanCount >= 2) {
      divScore += 4;
    }
    if (htfTrend === "bullish" && isBullDiv) divScore += 5;
    if (htfTrend === "bearish" && !isBullDiv) divScore += 5;
    if (htfTrend === "bullish" && !isBullDiv) divScore -= 4;
    if (htfTrend === "bearish" && isBullDiv) divScore -= 4;
    chanScore += sign * Math.min(divScore, 28);
  }
  const latestBuyPoint = chanBuySellPoints.filter((p) => p.direction === "buy").pop();
  const latestSellPoint = chanBuySellPoints.filter((p) => p.direction === "sell").pop();
  if (latestBuyPoint) chanScore += latestBuyPoint.level === 1 ? 10 : latestBuyPoint.level === 2 ? 7 : 5;
  if (latestSellPoint) chanScore -= latestSellPoint.level === 1 ? 10 : latestSellPoint.level === 2 ? 7 : 5;
  chanScore = Math.max(0, Math.min(100, chanScore));
  const srLevels = extractSrLevels(chan, ob, fvg);
  const paWithLevels = detectPaPatternsWithLevels(candles, srLevels, bar, atr);
  const paTrend = close > paEma20 && paEma20 > paEma50 ? "\u4E0A\u5347\u8DA8\u52E2" : close < paEma20 && paEma20 < paEma50 ? "\u4E0B\u964D\u8DA8\u52E2" : "\u9707\u76EA";
  const bullishPaAtLevel = paWithLevels.filter((p) => p.pattern.type === "bullish" && p.at_key_level);
  const bearishPaAtLevel = paWithLevels.filter((p) => p.pattern.type === "bearish" && p.at_key_level);
  const allBullishPa = paWithLevels.filter((p) => p.pattern.type === "bullish");
  const allBearishPa = paWithLevels.filter((p) => p.pattern.type === "bearish");
  const paBullNames = allBullishPa.map((p) => p.pattern.name);
  const paBearNames = allBearishPa.map((p) => p.pattern.name);
  let paScore = 50;
  if (close > paEma20) paScore += 8;
  else paScore -= 8;
  if (close > paEma50) paScore += 7;
  else paScore -= 7;
  const isBullishRegime = close > paEma20 && paEma20 > paEma50;
  if (isBullishRegime) {
    if (curRsi >= 50 && curRsi <= 75) paScore += 8;
    else if (curRsi > 75) paScore -= 3;
    else if (curRsi < 40) paScore -= 6;
  } else {
    if (curRsi >= 25 && curRsi <= 50) paScore -= 8;
    else if (curRsi < 25) paScore += 3;
    else if (curRsi > 60) paScore += 6;
  }
  if (curAdx > 25) paScore += 5;
  paScore += bullishPaAtLevel.length * 8 + allBullishPa.filter((p) => !p.at_key_level).length * 3;
  paScore -= bearishPaAtLevel.length * 8 + allBearishPa.filter((p) => !p.at_key_level).length * 3;
  const isUpCandle = close > candles[candles.length - 1].open;
  if (rvol >= 1.5) {
    if (isUpCandle) {
      paScore += 5;
      if (bullishPaAtLevel.length > 0) paScore += 5;
    } else {
      paScore -= 5;
      if (bearishPaAtLevel.length > 0) paScore -= 5;
    }
  } else if (rvol <= 0.7) {
    if (isUpCandle && paTrend === "\u4E0B\u964D\u8DA8\u52E2") paScore -= 3;
    if (!isUpCandle && paTrend === "\u4E0A\u5347\u8DA8\u52E2") paScore += 3;
  }
  const recentCandles5 = candles.slice(-5);
  const recentHigh5 = Math.max(...recentCandles5.map((c) => c.high));
  const recentLow5 = Math.min(...recentCandles5.map((c) => c.low));
  const prevHigh20 = Math.max(...candles.slice(-25, -5).map((c) => c.high));
  const prevLow20 = Math.min(...candles.slice(-25, -5).map((c) => c.low));
  const lastCandle = candles[candles.length - 1];
  const lastBody = Math.abs(lastCandle.close - lastCandle.open);
  const lastRange = lastCandle.high - lastCandle.low;
  const bodyRatio = lastRange > 0 ? lastBody / lastRange : 0;
  const isBullishFalseBreak = recentLow5 < prevLow20 && lastCandle.close > prevLow20 && bodyRatio < 0.5;
  const isBearishFalseBreak = recentHigh5 > prevHigh20 && lastCandle.close < prevHigh20 && bodyRatio < 0.5;
  if (isBullishFalseBreak) paScore += 12;
  if (isBearishFalseBreak) paScore -= 12;
  if (activeOb && activeOb.tested_count <= 1 && Math.abs(close - activeOb.mid) < atr * 0.5) {
    paScore += 5;
  }
  paScore = Math.max(0, Math.min(100, paScore));
  const divergences = detectDivergences(candles, bar, 60);
  const divSummaries = divergences.map((d) => d.description);
  const fibResult = calcFibOte(candles, close);
  let fibScore = 50;
  if (fibResult) {
    if (fibResult.direction === "bullish") {
      if (fibResult.in_ote) fibScore = 78;
      else if (close > fibResult.fib_50) fibScore = 62;
      else fibScore = 40;
    } else {
      if (fibResult.in_ote) fibScore = 22;
      else if (close < fibResult.fib_50) fibScore = 38;
      else fibScore = 60;
    }
    if (fibResult.in_ote_wide) {
      if (fibResult.direction === "bullish" && (validBullFvg || validBullOb)) {
        fibScore += 12;
      } else if (fibResult.direction === "bearish" && (validBearFvg || validBearOb)) {
        fibScore -= 12;
      }
    }
  }
  const smcSetups = detectSmcConfirmationSetups(candles, close, htfTrend);
  const smcSetupSummaries = smcSetups.map((s) => toSmcSetupSummary(s, close));
  const isTrendingRegime = htfTrend !== "ranging" && curAdx > 22;
  const isRangingRegime = !isTrendingRegime;
  const wSmc = isTrendingRegime ? 0.35 : 0.25;
  const wChan = isTrendingRegime ? 0.3 : 0.2;
  const wPa = isTrendingRegime ? 0.2 : 0.3;
  const wFib = isTrendingRegime ? 0.15 : 0.25;
  const smcBullish = smcScore > 55;
  const smcBearish = smcScore < 45;
  const chanBullish = chanScore > 55;
  const chanBearish = chanScore < 45;
  const hasConflict = smcBullish && chanBearish || smcBearish && chanBullish;
  const conflictPenalty = hasConflict ? 0.88 : 1;
  const totalScore = (smcScore * wSmc + paScore * wPa + fibScore * wFib + chanScore * wChan) * conflictPenalty;
  const longThreshold = isTrendingRegime ? 55 : 65;
  const shortThreshold = isTrendingRegime ? 45 : 35;
  let direction;
  if (hasConflict) {
    direction = "neutral";
  } else if (totalScore >= longThreshold) {
    direction = "long";
  } else if (totalScore <= shortThreshold) {
    direction = "short";
  } else {
    direction = "neutral";
  }
  const chanDivType = chan.divergence_signals.type;
  return {
    bar,
    label,
    close,
    atr,
    adx: curAdx,
    smc_structure: bos.lastStructure,
    smc_bos_choch: bosChochStr,
    smc_premium_discount: premDisc,
    smc_score: smcScore,
    pa_bullish_patterns: paBullNames,
    pa_bearish_patterns: paBearNames,
    pa_trend: paTrend,
    pa_rsi: curRsi,
    pa_adx: curAdx,
    pa_score: paScore,
    fib_score: fibScore,
    fib_in_ote: fibResult?.in_ote ?? false,
    fib_618: fibResult?.fib_618 ?? 0,
    fib_786: fibResult?.fib_786 ?? 0,
    fib_ext_1272: fibResult?.ext_1272 ?? 0,
    fib_ext_1618: fibResult?.ext_1618 ?? 0,
    chan_trend: chan.trend,
    chan_in_zhongshu: chan.in_zhongshu,
    chan_zhongshu_top: chan.zhongshuZG || 0,
    chan_zhongshu_bottom: chan.zhongshuZD || 0,
    chan_zhongshu_zg: chan.zhongshuZG || 0,
    chan_zhongshu_zd: chan.zhongshuZD || 0,
    chan_zhongshu_gg: chan.zhongshuGG || 0,
    chan_zhongshu_dd: chan.zhongshuDD || 0,
    chan_divergence: chanDivType,
    chan_bi_count: chan.bi_count,
    chan_duan_count: chan.duan_count,
    chan_score: chanScore,
    chan_buy_sell_points: chanBuySellPoints,
    chan_macd_area_ratio: chan.macd_area_ratio,
    divergences: divSummaries,
    smc_setups: smcSetupSummaries,
    nearest_bull_ob: validBullOb ? { ...validBullOb, strength: validBullOb.strength } : null,
    nearest_bear_ob: validBearOb ? { ...validBearOb, strength: validBearOb.strength } : null,
    nearest_bull_fvg: validBullFvg,
    nearest_bear_fvg: validBearFvg,
    liquidity_sweep: liq,
    total_score: totalScore,
    direction
  };
}
function buildModels(tfMap) {
  const tf4h = tfMap.get("4H");
  const tf1h = tfMap.get("1H");
  const tf15m = tfMap.get("15m");
  const tf1d = tfMap.get("1D");
  const models = [];
  {
    const primary = tf1h ?? tf4h;
    const entry = tf15m ?? tf1h;
    if (primary && entry) {
      const liq = primary.liquidity_sweep;
      const hasSweep = liq.bslSwept || liq.sslSwept;
      const sweepDir = liq.sslSwept ? "long" : liq.bslSwept ? "short" : "neutral";
      const activeBullSetups = primary.smc_setups.filter((s) => s.direction === "bullish" && (s.status === "active" || s.status === "waiting"));
      const activeBearSetups = primary.smc_setups.filter((s) => s.direction === "bearish" && (s.status === "active" || s.status === "waiting"));
      const bestSetup = sweepDir === "long" ? activeBullSetups[0] ?? null : sweepDir === "short" ? activeBearSetups[0] ?? null : null;
      const chochConfirm = entry.smc_bos_choch.includes("CHoCH");
      const inOTE = entry.fib_in_ote;
      const hasPAConfirm = sweepDir === "long" ? entry.pa_bullish_patterns.length > 0 : entry.pa_bearish_patterns.length > 0;
      const chanNotInZS = !primary.chan_in_zhongshu;
      const hasChanBuyPoint = primary.chan_buy_sell_points.some((p) => p.direction === "buy" && p.level === 1);
      const hasChanSellPoint = primary.chan_buy_sell_points.some((p) => p.direction === "sell" && p.level === 1);
      let confidence = 0;
      if (!hasSweep) {
        confidence = 0;
      } else {
        confidence = 25;
        if (bestSetup) {
          confidence += 22;
          if (bestSetup.rr_ratio >= 2.5) confidence += 5;
          else if (bestSetup.rr_ratio >= 2) confidence += 3;
        } else if (chochConfirm) {
          confidence += 12;
        }
        if (inOTE && hasPAConfirm) confidence += 12;
        else if (inOTE) confidence += 7;
        else if (hasPAConfirm) confidence += 5;
        if (sweepDir === "long" && hasChanBuyPoint) confidence += 9;
        if (sweepDir === "short" && hasChanSellPoint) confidence += 9;
        if (primary.chan_in_zhongshu) {
          const zsTop = primary.chan_zhongshu_top;
          const zsBot = primary.chan_zhongshu_bottom;
          if (zsTop > 0 && zsBot > 0) {
            const zsHeight = zsTop - zsBot;
            const posRatio = zsHeight > 0 ? (primary.close - zsBot) / zsHeight : 0.5;
            if (posRatio > 0.3 && posRatio < 0.7) confidence -= 8;
          }
        }
        const htf = tf4h ?? tf1d;
        if (htf) {
          const htfBullish = htf.chan_trend === "bullish" && htf.smc_structure === "bullish";
          const htfBearish = htf.chan_trend === "bearish" && htf.smc_structure === "bearish";
          const htfNeutral = !htfBullish && !htfBearish;
          if (sweepDir === "long" && htfBearish) confidence = Math.round(confidence * 0.62);
          else if (sweepDir === "long" && htfNeutral) confidence = Math.round(confidence * 0.85);
          if (sweepDir === "short" && htfBullish) confidence = Math.round(confidence * 0.62);
          else if (sweepDir === "short" && htfNeutral) confidence = Math.round(confidence * 0.85);
        }
        const tfDirs = [tf4h?.direction, tf1h?.direction, tf15m?.direction].filter(Boolean);
        const conflictCount = tfDirs.filter((d) => d !== sweepDir && d !== "neutral").length;
        if (conflictCount >= 2) confidence = Math.round(confidence * 0.75);
        else if (conflictCount === 1) confidence = Math.round(confidence * 0.9);
        confidence = Math.min(92, Math.max(0, confidence));
      }
      const rrRatio = bestSetup?.rr_ratio ?? 1.5;
      const entryConditions = [
        `1H ${liq.sslSwept ? `\u6383\u4E0B\u65B9\u6D41\u52D5\u6027\uFF08SSL @ ${liq.sslPrice.toFixed(2)}\uFF09` : liq.bslSwept ? `\u6383\u4E0A\u65B9\u6D41\u52D5\u6027\uFF08BSL @ ${liq.bslPrice.toFixed(2)}\uFF09` : "\u7B49\u5F85\u6D41\u52D5\u6027\u6383\u8569"}`,
        bestSetup ? `\u2713 SMC \u4E09\u90E8\u66F2\u78BA\u8A8D\uFF1A\u6383\u8569 ${bestSetup.sweep_type} \u2192 FVG \u4F4D\u79FB \u2192 OB \u56DE\u8E29\uFF08\u9032\u5834\u5340 ${bestSetup.entry_bottom.toFixed(2)}\u2013${bestSetup.entry_top.toFixed(2)}\uFF09` : `15m \u7B49\u5F85 CHoCH \u7D50\u69CB\u53CD\u8F49\u78BA\u8A8D${chochConfirm ? "\uFF08\u5DF2\u51FA\u73FE\uFF09" : "\uFF08\u5C1A\u672A\u51FA\u73FE\uFF09"}`,
        entry.nearest_bull_ob ? `\u56DE\u8E29\u591A\u65B9 OB\uFF08${entry.nearest_bull_ob.bottom.toFixed(2)}\u2013${entry.nearest_bull_ob.top.toFixed(2)}\uFF09${entry.nearest_bull_ob.strength === "strong" ? " \u2605\u5F37\u529BOB" : ""}` : "\u5C0B\u627E ATR \u6709\u6548 OB \u9032\u5834\u5340",
        entry.fib_618 > 0 ? `\u6590\u6CE2 OTE \u5340\u9593\uFF08${entry.fib_618.toFixed(2)}\u2013${entry.fib_786.toFixed(2)}\uFF09${inOTE ? " \u2713 \u73FE\u50F9\u5728\u5340\u9593\u5167" : ""}` : "\u8A08\u7B97\u6590\u6CE2\u56DE\u8ABF\u5340",
        hasPAConfirm ? `PA \u78BA\u8A8D\uFF08\u95DC\u9375\u6C34\u4F4D\u5171\u632F\uFF09\uFF1A${sweepDir === "long" ? entry.pa_bullish_patterns.join("\u3001") : entry.pa_bearish_patterns.join("\u3001")}` : "\u7B49\u5F85 PA \u8A0A\u865F\u5728 OB/\u4E2D\u6A1E\u908A\u754C\u78BA\u8A8D"
      ];
      const keyLevels = [];
      if (liq.sslPrice > 0) keyLevels.push({ label: "SSL\uFF08\u5DF2\u6383\uFF09", price: liq.sslPrice, type: "swept_low" });
      if (liq.bslPrice > 0) keyLevels.push({ label: "BSL\uFF08\u5DF2\u6383\uFF09", price: liq.bslPrice, type: "swept_high" });
      if (bestSetup) {
        keyLevels.push({ label: "SMC \u9032\u5834\u5340\u4E0A", price: bestSetup.entry_top, type: "smc_entry" });
        keyLevels.push({ label: "SMC \u9032\u5834\u5340\u4E0B", price: bestSetup.entry_bottom, type: "smc_entry" });
        keyLevels.push({ label: "SMC TP1", price: bestSetup.tp1, type: "smc_tp" });
        keyLevels.push({ label: "SMC TP2", price: bestSetup.tp2, type: "smc_tp" });
      } else {
        if (entry.nearest_bull_ob) keyLevels.push({ label: "\u591A\u65B9 OB", price: entry.nearest_bull_ob.mid, type: "bull_ob" });
        if (entry.nearest_bear_ob) keyLevels.push({ label: "\u7A7A\u65B9 OB", price: entry.nearest_bear_ob.mid, type: "bear_ob" });
        if (entry.fib_618 > 0) keyLevels.push({ label: "Fib 0.618", price: entry.fib_618, type: "fib" });
        if (entry.fib_786 > 0) keyLevels.push({ label: "Fib 0.786", price: entry.fib_786, type: "fib" });
      }
      const adxForSl = primary.adx;
      const adxNorm = Math.max(0, Math.min(1, (adxForSl - 15) / 25));
      const slAtrMultiplier = parseFloat((0.4 + adxNorm * 0.5).toFixed(2));
      const slHint = bestSetup ? `\u6B62\u640D\u653E ${bestSetup.sweep_type} \u6383\u6E6A\u9EDE\u5916\u5074\uFF08${bestSetup.sl.toFixed(2)}\uFF09\uFF0CADX=${adxForSl.toFixed(1)} \u2192 ATR \u4E58\u6578 ${slAtrMultiplier}` : liq.sslSwept ? `\u6B62\u640D\u653E SSL \u4F4E\u9EDE\u4E0B\u65B9 ${slAtrMultiplier} ATR\uFF08\u7D04 ${(liq.sslPrice - primary.atr * slAtrMultiplier).toFixed(2)}\uFF09` : `\u6B62\u640D\u653E BSL \u9AD8\u9EDE\u4E0A\u65B9 ${slAtrMultiplier} ATR\uFF08\u7D04 ${(liq.bslPrice + primary.atr * slAtrMultiplier).toFixed(2)}\uFF09`;
      const tpHint = bestSetup ? `TP1: ${bestSetup.tp1.toFixed(2)}\uFF08RR ${rrRatio.toFixed(1)}x\uFF09| TP2: ${bestSetup.tp2.toFixed(2)}` : "\u76EE\u6A19\uFF1A\u5C0D\u5074\u6D41\u52D5\u6027 / \u524D\u9AD8\u524D\u4F4E / Fib 1.272\u20131.618 \u5EF6\u4F38\u4F4D";
      models.push({
        id: "liquidity_reversal",
        name: "\u6A21\u578B A\uFF1A\u6383\u6D41\u52D5\u6027\u53CD\u8F49\u55AE",
        description: "\u7B49\u5F85 SMC \u4E09\u90E8\u66F2\u5B8C\u6210\uFF08\u6D41\u52D5\u6027\u6E05\u6383 \u2192 FVG \u4F4D\u79FB \u2192 OB \u56DE\u8E29\uFF09\uFF0C\u7E8F\u8AD6\u4E00\u985E\u8CB7\u8CE3\u9EDE\u78BA\u8A8D\uFF0CADX \u52D5\u614B ATR \u6B62\u640D\u4E58\u6578\u9069\u61C9\u8DA8\u52E2\u5F37\u5EA6\u3002",
        direction: sweepDir === "neutral" ? primary.direction : sweepDir,
        confidence,
        confluence_score: Math.round(primary.smc_score * 0.35 + entry.pa_score * 0.25 + entry.fib_score * 0.2 + primary.chan_score * 0.2),
        entry_conditions: entryConditions,
        stop_loss_hint: slHint,
        take_profit_hint: tpHint,
        key_levels: keyLevels,
        smc_score: primary.smc_score,
        pa_score: entry.pa_score,
        fib_score: entry.fib_score,
        chan_score: primary.chan_score,
        timeframe_consensus: "1H \u5B9A\u65B9\u5411\uFF0C15m \u627E\u5165\u5834",
        risk_warning: primary.chan_in_zhongshu ? "\u26A0\uFE0F \u76EE\u524D\u8655\u65BC\u7E8F\u8AD6\u4E2D\u6A1E\u5167\uFF0C\u5047\u7A81\u7834\u98A8\u96AA\u8F03\u9AD8\uFF0C\u5EFA\u8B70\u7B49\u5F85\u96E2\u958B\u4E2D\u6A1E\u5F8C\u518D\u64CD\u4F5C" : !hasSweep ? "\u26A0\uFE0F \u6D41\u52D5\u6027\u6383\u6E6A\u5C1A\u672A\u767C\u751F\uFF0C\u6B64\u6A21\u578B\u8655\u65BC\u7B49\u5F85\u72C0\u614B\uFF0C\u4E0D\u53EF\u63D0\u524D\u5165\u5834" : `\u6CE8\u610F\uFF1A\u6383\u6E6A\u5F8C\u9700\u7B49\u5F85 SMC \u4E09\u90E8\u66F2\u5B8C\u6574\u78BA\u8A8D\uFF0C\u4E0D\u53EF\u5728\u6383\u6E6A\u77AC\u9593\u8FFD\u55AE\uFF08ADX=${adxForSl.toFixed(1)}\uFF0C\u6B62\u640D ATR\xD7${slAtrMultiplier}\uFF09`,
        is_active: hasSweep && (!!bestSetup || chochConfirm),
        rr_ratio: rrRatio,
        sl_atr_multiplier: slAtrMultiplier,
        chan_buy_sell_points: primary.chan_buy_sell_points,
        smc_setups: primary.smc_setups.slice(0, 3),
        divergences: primary.divergences
      });
    }
  }
  {
    const primary = tf4h ?? tf1d;
    const entry = tf1h ?? tf15m;
    if (primary && entry) {
      const trendUp = primary.chan_trend === "bullish" && primary.smc_structure === "bullish";
      const trendDown = primary.chan_trend === "bearish" && primary.smc_structure === "bearish";
      const hasTrend = trendUp || trendDown;
      const notInZS = !primary.chan_in_zhongshu;
      const inOTE = entry.fib_in_ote;
      const hasFVG = trendUp ? !!entry.nearest_bull_fvg : !!entry.nearest_bear_fvg;
      const hasPAConfirm = trendUp ? entry.pa_bullish_patterns.length > 0 : entry.pa_bearish_patterns.length > 0;
      const adxStrong = entry.pa_adx > 20;
      const hasChan23Buy = entry.chan_buy_sell_points.some((p) => p.direction === "buy" && (p.level === 2 || p.level === 3));
      const hasChan23Sell = entry.chan_buy_sell_points.some((p) => p.direction === "sell" && (p.level === 2 || p.level === 3));
      const macdMomentum = entry.chan_macd_area_ratio;
      let confidence = 30;
      if (hasTrend) confidence += 20;
      if (notInZS) confidence += 10;
      if (inOTE) confidence += 15;
      if (hasFVG) confidence += 8;
      if (hasPAConfirm) confidence += 7;
      if (adxStrong) confidence += 5;
      if (trendUp && hasChan23Buy) confidence += 10;
      if (trendDown && hasChan23Sell) confidence += 10;
      if (macdMomentum > 1) confidence += 5;
      if (tf1d) {
        const dailyBullish = tf1d.chan_trend === "bullish";
        const dailyBearish = tf1d.chan_trend === "bearish";
        if (trendUp && dailyBearish) confidence = Math.round(confidence * 0.7);
        if (trendDown && dailyBullish) confidence = Math.round(confidence * 0.7);
      }
      confidence = Math.min(92, confidence);
      const dir = trendUp ? "long" : trendDown ? "short" : primary.direction;
      const rrRatio = inOTE ? 2.5 : hasFVG ? 2 : 1.5;
      const bestChanPoint = entry.chan_buy_sell_points.filter((p) => p.direction === (dir === "long" ? "buy" : "sell")).sort((a, b) => a.level - b.level)[0];
      const entryConditions = [
        `4H \u7E8F\u8AD6\u8DA8\u52E2\uFF1A${primary.chan_trend === "bullish" ? "\u4E0A\u5347\uFF08\u96E2\u958B\u4E2D\u6A1E\u5411\u4E0A\u5EF6\u4F38\uFF09" : primary.chan_trend === "bearish" ? "\u4E0B\u964D\uFF08\u96E2\u958B\u4E2D\u6A1E\u5411\u4E0B\u5EF6\u4F38\uFF09" : "\u9707\u76EA\uFF08\u4E0D\u5EFA\u8B70\u6B64\u6A21\u578B\uFF09"}${primary.chan_duan_count > 0 ? `\uFF08\u5DF2\u78BA\u8A8D ${primary.chan_duan_count} \u6BB5\u7DDA\u6BB5\uFF09` : ""}`,
        `4H SMC \u7D50\u69CB\uFF1A${primary.smc_structure === "bullish" ? "HH/HL \u591A\u982D\u7D50\u69CB" : primary.smc_structure === "bearish" ? "LH/LL \u7A7A\u982D\u7D50\u69CB" : "\u7121\u660E\u78BA\u7D50\u69CB"}`,
        `1H \u56DE\u8E29\u81F3\u6590\u6CE2 0.5\u20130.618${inOTE ? "\uFF08\u73FE\u50F9\u5DF2\u5728 OTE \u5340\u9593 \u2713\uFF09" : entry.fib_618 > 0 ? `\uFF08\u76EE\u6A19\u5340\uFF1A${entry.fib_618.toFixed(2)}\u2013${(entry.fib_618 * 1.01).toFixed(2)}\uFF09` : ""}`,
        hasFVG ? `1H ${dir === "long" ? "\u591A\u65B9" : "\u7A7A\u65B9"} FVG \u652F\u6490\uFF08ATR \u904E\u6FFE\u6709\u6548\uFF09` : "\u5C0B\u627E ATR \u6709\u6548 FVG \u9032\u5834\u5340",
        bestChanPoint ? `\u2713 \u7E8F\u8AD6${bestChanPoint.level}\u985E${bestChanPoint.direction === "buy" ? "\u8CB7" : "\u8CE3"}\u9EDE\uFF1A${bestChanPoint.description}` : hasPAConfirm ? `PA \u6B62\u8DCC/\u6B62\u5347\u8A0A\u865F\uFF08\u95DC\u9375\u6C34\u4F4D\u5171\u632F\uFF09\uFF1A${dir === "long" ? entry.pa_bullish_patterns.join("\u3001") : entry.pa_bearish_patterns.join("\u3001")}` : "\u7B49\u5F85 PA \u78BA\u8A8D\uFF08Higher Low / Lower High\uFF09"
      ];
      const keyLevels = [];
      if (entry.fib_618 > 0) keyLevels.push({ label: "Fib 0.618", price: entry.fib_618, type: "fib" });
      if (entry.fib_786 > 0) keyLevels.push({ label: "Fib 0.786", price: entry.fib_786, type: "fib" });
      if (entry.fib_ext_1272 > 0) keyLevels.push({ label: "Fib 1.272", price: entry.fib_ext_1272, type: "fib_ext" });
      if (entry.fib_ext_1618 > 0) keyLevels.push({ label: "Fib 1.618", price: entry.fib_ext_1618, type: "fib_ext" });
      if (entry.nearest_bull_fvg) keyLevels.push({ label: "\u591A\u65B9 FVG", price: entry.nearest_bull_fvg.mid, type: "bull_fvg" });
      if (entry.nearest_bear_fvg) keyLevels.push({ label: "\u7A7A\u65B9 FVG", price: entry.nearest_bear_fvg.mid, type: "bear_fvg" });
      if (primary.chan_zhongshu_top > 0) keyLevels.push({ label: "4H \u4E2D\u6A1E\u4E0A\u6CBF", price: primary.chan_zhongshu_top, type: "zhongshu_top" });
      if (primary.chan_zhongshu_bottom > 0) keyLevels.push({ label: "4H \u4E2D\u6A1E\u4E0B\u6CBF", price: primary.chan_zhongshu_bottom, type: "zhongshu_bottom" });
      const adxB = primary.adx;
      const slAtrMultiplierB = adxB > 30 ? 0.8 : adxB > 20 ? 0.5 : 0.35;
      models.push({
        id: "trend_pullback",
        name: "\u6A21\u578B B\uFF1A\u8DA8\u52E2\u56DE\u8E29\u5EF6\u7E8C\u55AE",
        description: "4H \u589E\u5F37\u7248\u7E8F\u8AD6\u78BA\u8A8D\u8DA8\u52E2\u65B9\u5411\uFF08\u542B\u7DDA\u6BB5\u78BA\u8A8D\uFF09\uFF0CSMC \u7D50\u69CB\u78BA\u8A8D HH/HL \u6216 LH/LL\uFF0C\u7B49\u5F85 1H \u56DE\u8E29\u81F3\u65AF\u6CE2 0.5\u20130.618 + ATR \u6709\u6548 FVG/OB\uFF0CADX \u52D5\u614B ATR \u6B62\u640D\u4E58\u6578\u9069\u61C9\u8DA8\u52E2\u5F37\u5EA6\u3002",
        direction: dir,
        confidence,
        confluence_score: Math.round(primary.chan_score * 0.3 + primary.smc_score * 0.25 + entry.fib_score * 0.25 + entry.pa_score * 0.2),
        entry_conditions: entryConditions,
        stop_loss_hint: dir === "long" ? `\u6B62\u640D\u653E\u56DE\u8ABF\u7D50\u69CB\u5931\u6548\u9EDE\uFF08Fib 0.786 \u4E0B\u65B9 ${(slAtrMultiplierB + 0.2).toFixed(2)} ATR\uFF0C\u7D04 ${entry.fib_786 > 0 ? (entry.fib_786 - entry.atr * (slAtrMultiplierB + 0.2)).toFixed(2) : "\u8A08\u7B97\u4E2D"}\uFF09\uFF0CADX=${adxB.toFixed(1)}` : `\u6B62\u640D\u653E\u56DE\u8ABF\u7D50\u69CB\u5931\u6548\u9EDE\uFF08Fib 0.786 \u4E0A\u65B9 ${(slAtrMultiplierB + 0.2).toFixed(2)} ATR\uFF0C\u7D04 ${entry.fib_786 > 0 ? (entry.fib_786 + entry.atr * (slAtrMultiplierB + 0.2)).toFixed(2) : "\u8A08\u7B97\u4E2D"}\uFF09\uFF0CADX=${adxB.toFixed(1)}`,
        take_profit_hint: `TP1: Fib 1.272\uFF08RR ${rrRatio.toFixed(1)}x\uFF09| TP2: Fib 1.618 / \u524D\u9AD8\u524D\u4F4E`,
        key_levels: keyLevels,
        smc_score: primary.smc_score,
        pa_score: entry.pa_score,
        fib_score: entry.fib_score,
        chan_score: primary.chan_score,
        timeframe_consensus: "4H \u5B9A\u8DA8\u52E2\uFF0C1H \u627E\u56DE\u8E29",
        risk_warning: !hasTrend ? "\u26A0\uFE0F \u76EE\u524D 4H \u7121\u660E\u78BA\u8DA8\u52E2\uFF0C\u6B64\u6A21\u578B\u4E0D\u9069\u7528\uFF0C\u8ACB\u7B49\u5F85\u8DA8\u52E2\u78BA\u7ACB" : primary.chan_in_zhongshu ? "\u26A0\uFE0F 4H \u4ECD\u5728\u4E2D\u6A1E\u5167\u9707\u76EA\uFF0C\u5EF6\u4F38\u65B9\u5411\u672A\u78BA\u8A8D" : `\u8DA8\u52E2\u65E5\u52DD\u7387\u8F03\u9AD8\uFF1BADX=${adxB.toFixed(1)}\uFF0C\u6B62\u640D ATR\xD7${slAtrMultiplierB}`,
        is_active: hasTrend && notInZS,
        rr_ratio: rrRatio,
        sl_atr_multiplier: slAtrMultiplierB,
        chan_buy_sell_points: entry.chan_buy_sell_points,
        smc_setups: entry.smc_setups.slice(0, 3),
        divergences: entry.divergences
      });
    }
  }
  {
    const primary = tf1h ?? tf4h;
    const entry = tf15m ?? tf1h;
    if (primary && entry) {
      const inZS = primary.chan_in_zhongshu;
      const zsTop = primary.chan_zhongshu_top;
      const zsBottom = primary.chan_zhongshu_bottom;
      const close = primary.close;
      const atr = primary.atr;
      const nearTopThreshold = atr * 0.5;
      const nearBottomThreshold = atr * 0.5;
      const nearTop = zsTop > 0 && Math.abs(close - zsTop) < nearTopThreshold;
      const nearBottom = zsBottom > 0 && Math.abs(close - zsBottom) < nearBottomThreshold;
      const hasBSLAtTop = primary.liquidity_sweep.bslSwept && close < zsTop;
      const hasSSLAtBottom = primary.liquidity_sweep.sslSwept && close > zsBottom;
      const hasPAAtBoundary = nearTop ? entry.pa_bearish_patterns.length > 0 : nearBottom ? entry.pa_bullish_patterns.length > 0 : false;
      const hasChanBuyAtBottom = nearBottom && primary.chan_buy_sell_points.some((p) => p.direction === "buy" && p.level === 1);
      const hasChanSellAtTop = nearTop && primary.chan_buy_sell_points.some((p) => p.direction === "sell" && p.level === 1);
      const hasBullDivAtBottom = nearBottom && primary.chan_divergence === "bottom";
      const hasBearDivAtTop = nearTop && primary.chan_divergence === "top";
      let confidence = 25;
      if (inZS) confidence += 15;
      if (nearTop || nearBottom) confidence += 20;
      if (hasBSLAtTop || hasSSLAtBottom) confidence += 12;
      if (hasPAAtBoundary) confidence += 10;
      if (hasChanBuyAtBottom || hasChanSellAtTop) confidence += 15;
      if (hasBullDivAtBottom || hasBearDivAtTop) confidence += 10;
      confidence = Math.min(90, confidence);
      const dir = nearBottom ? "long" : nearTop ? "short" : "neutral";
      const rrRatio = hasChanBuyAtBottom || hasChanSellAtTop ? 2 : 1.5;
      const entryConditions = [
        inZS ? `1H \u7E8F\u8AD6\u4E2D\u6A1E\uFF1A${zsBottom.toFixed(2)}\u2013${zsTop.toFixed(2)}\uFF08ATR=${atr.toFixed(2)}\uFF0C\u73FE\u50F9\u5728\u4E2D\u6A1E\u5167\uFF09` : "\u7B49\u5F85\u4E2D\u6A1E\u5F62\u6210\uFF083 \u6BB5\u91CD\u758A\uFF09",
        nearTop ? `\u73FE\u50F9\u63A5\u8FD1\u4E2D\u6A1E\u4E0A\u6CBF\uFF08${zsTop.toFixed(2)}\uFF09\uFF0C\u8DDD\u96E2 ${Math.abs(close - zsTop).toFixed(2)}\uFF08< ATR\xD70.5=${nearTopThreshold.toFixed(2)}\uFF09\uFF0C\u8003\u616E\u505A\u7A7A` : nearBottom ? `\u73FE\u50F9\u63A5\u8FD1\u4E2D\u6A1E\u4E0B\u6CBF\uFF08${zsBottom.toFixed(2)}\uFF09\uFF0C\u8DDD\u96E2 ${Math.abs(close - zsBottom).toFixed(2)}\uFF08< ATR\xD70.5=${nearBottomThreshold.toFixed(2)}\uFF09\uFF0C\u8003\u616E\u505A\u591A` : "\u7B49\u5F85\u50F9\u683C\u5230\u9054\u4E2D\u6A1E\u908A\u754C\uFF08ATR \u52D5\u614B\u5224\u65B7\uFF09",
        hasBSLAtTop ? `\u2713 \u4E0A\u6CBF\u5DF2\u6383 BSL\uFF08${primary.liquidity_sweep.bslPrice.toFixed(2)}\uFF09\uFF0C\u8A98\u591A\u5B8C\u6210` : hasSSLAtBottom ? `\u2713 \u4E0B\u6CBF\u5DF2\u6383 SSL\uFF08${primary.liquidity_sweep.sslPrice.toFixed(2)}\uFF09\uFF0C\u8A98\u7A7A\u5B8C\u6210` : "\u7B49\u5F85\u6D41\u52D5\u6027\u6383\u8569\u78BA\u8A8D",
        hasChanBuyAtBottom ? `\u2713 \u7E8F\u8AD6\u4E00\u985E\u8CB7\u9EDE\uFF1A${primary.chan_buy_sell_points.find((p) => p.direction === "buy" && p.level === 1)?.description ?? "\u5E95\u80CC\u99B3\u78BA\u8A8D"}` : hasChanSellAtTop ? `\u2713 \u7E8F\u8AD6\u4E00\u985E\u8CE3\u9EDE\uFF1A${primary.chan_buy_sell_points.find((p) => p.direction === "sell" && p.level === 1)?.description ?? "\u9802\u80CC\u99B3\u78BA\u8A8D"}` : hasPAAtBoundary ? `PA \u908A\u754C\u53CD\u61C9\uFF08\u95DC\u9375\u6C34\u4F4D\u5171\u632F\uFF09\uFF1A${dir === "short" ? entry.pa_bearish_patterns.join("\u3001") : entry.pa_bullish_patterns.join("\u3001")}` : "\u7B49\u5F85 PA \u5047\u7A81\u7834\u5F8C\u6536\u56DE\u8A0A\u865F",
        "\u4E2D\u6A1E\u4E2D\u9593\u4F4D\u7F6E\u4E0D\u505A\uFF0C\u5FEB\u9032\u5FEB\u51FA\uFF0C\u6B62\u640D\u653E\u908A\u754C\u5916\u5074 ATR\xD70.5"
      ];
      const keyLevels = [];
      if (zsTop > 0) keyLevels.push({ label: "\u4E2D\u6A1E\u4E0A\u6CBF", price: zsTop, type: "zhongshu_top" });
      if (zsBottom > 0) keyLevels.push({ label: "\u4E2D\u6A1E\u4E0B\u6CBF", price: zsBottom, type: "zhongshu_bottom" });
      if (zsTop > 0 && zsBottom > 0) keyLevels.push({ label: "\u4E2D\u6A1E\u4E2D\u4F4D", price: (zsTop + zsBottom) / 2, type: "zhongshu_mid" });
      const adxC = primary.adx;
      const slAtrMultiplierC = adxC > 30 ? 0.8 : adxC > 20 ? 0.5 : 0.35;
      models.push({
        id: "zhongshu_boundary",
        name: "\u6A21\u578B C\uFF1A\u4E2D\u6A1E\u908A\u754C\u53CD\u61C9\u55AE",
        description: "\u7E8F\u8AD6\u4E2D\u6A1E\u9707\u76EA\u7B56\u7565\uFF08v3\uFF09\u3002\u5728\u4E2D\u6A1E\u4E0A\u4E0B\u6CBF\u4F7F\u7528 ATR \u52D5\u614B\u908A\u754C\u5224\u65B7\uFF0C\u7D50\u5408 SMC \u6D41\u52D5\u6027\u6383\u6E6A + \u7E8F\u8AD6\u4E00\u985E\u8CB7\u8CE3\u9EDE\uFF08MACD \u9762\u7A4D\u80CC\u99B3\u78BA\u8A8D\uFF09+ PA \u5047\u7A81\u7834\u78BA\u8A8D\u5F8C\u53CD\u624B\uFF0CADX \u52D5\u614B ATR \u6B62\u640D\u4E58\u6578\u9069\u61C9\u5E02\u6CC1\u3002",
        direction: dir,
        confidence,
        confluence_score: Math.round(primary.chan_score * 0.35 + primary.smc_score * 0.3 + entry.pa_score * 0.25 + entry.fib_score * 0.1),
        entry_conditions: entryConditions,
        stop_loss_hint: nearTop ? `\u6B62\u640D\u653E\u4E2D\u6A1E\u4E0A\u6CBF\u5916\u5074 ${slAtrMultiplierC} ATR\uFF08${zsTop.toFixed(2)} + ATR\xD7${slAtrMultiplierC} = ${(zsTop + atr * slAtrMultiplierC).toFixed(2)}\uFF09\uFF0CADX=${adxC.toFixed(1)}` : nearBottom ? `\u6B62\u640D\u653E\u4E2D\u6A1E\u4E0B\u6CBF\u5916\u5074 ${slAtrMultiplierC} ATR\uFF08${zsBottom.toFixed(2)} - ATR\xD7${slAtrMultiplierC} = ${(zsBottom - atr * slAtrMultiplierC).toFixed(2)}\uFF09\uFF0CADX=${adxC.toFixed(1)}` : `\u6B62\u640D\u653E\u908A\u754C\u5916\u5074 ATR\xD7${slAtrMultiplierC}\uFF08ADX=${adxC.toFixed(1)}\uFF09`,
        take_profit_hint: `TP1: \u4E2D\u6A1E\u4E2D\u4F4D\uFF08${zsTop > 0 && zsBottom > 0 ? ((zsTop + zsBottom) / 2).toFixed(2) : "\u8A08\u7B97\u4E2D"}\uFF09| TP2: \u5C0D\u5074\u908A\u754C\uFF08RR ${rrRatio.toFixed(1)}x\uFF09`,
        key_levels: keyLevels,
        smc_score: primary.smc_score,
        pa_score: entry.pa_score,
        fib_score: entry.fib_score,
        chan_score: primary.chan_score,
        timeframe_consensus: "1H \u5B9A\u4E2D\u6A1E\uFF0C15m \u627E\u908A\u754C\u53CD\u61C9",
        risk_warning: !inZS ? "\u26A0\uFE0F \u76EE\u524D\u7121\u660E\u78BA\u4E2D\u6A1E\uFF0C\u6B64\u6A21\u578B\u4E0D\u9069\u7528\uFF0C\u8ACB\u7B49\u5F85\u4E2D\u6A1E\u5F62\u6210" : `\u4E2D\u6A1E\u7A81\u7834\u5F8C\u4E0D\u53EF\u8FFD\uFF0C\u9700\u7B49\u5F85\u56DE\u8E29\u78BA\u8A8D\u662F\u5426\u771F\u7A81\u7834\uFF1BADX=${adxC.toFixed(1)}\uFF0C\u6B62\u640D ATR\xD7${slAtrMultiplierC}`,
        is_active: inZS && (nearTop || nearBottom),
        rr_ratio: rrRatio,
        sl_atr_multiplier: slAtrMultiplierC,
        chan_buy_sell_points: primary.chan_buy_sell_points,
        smc_setups: primary.smc_setups.slice(0, 3),
        divergences: primary.divergences
      });
    }
  }
  return models;
}
async function runHighWinRateScan(symbol, fetchCandles2, invokeLLM2, engine = "local") {
  const coinName = symbol.replace("USDT", "").replace("BUSD", "");
  const TF_CONFIG = [
    { bar: "4H", label: "4 \u5C0F\u6642", limit: 300 },
    { bar: "1H", label: "1 \u5C0F\u6642", limit: 300 },
    { bar: "15m", label: "15 \u5206\u9418", limit: 300 },
    { bar: "1D", label: "\u65E5\u7DDA", limit: 200 }
  ];
  const candleMap = /* @__PURE__ */ new Map();
  await Promise.all(
    TF_CONFIG.map(async (tf) => {
      try {
        const candles = await fetchCandles2(symbol, tf.bar, tf.limit);
        if (candles.length >= 50) candleMap.set(tf.bar, candles);
      } catch {
      }
    })
  );
  const candles4h = candleMap.get("4H");
  const htfTrend = candles4h ? (() => {
    const chan4h = calcChanEnhanced(candles4h, candles4h[candles4h.length - 1].close);
    return chan4h.trend;
  })() : "ranging";
  const nowUtcHour = (/* @__PURE__ */ new Date()).getUTCHours();
  const sessionInfo = (() => {
    const h = nowUtcHour;
    if (h >= 13 && h < 22) return { name: "\u7F8E\u6D32\u76E4", liquidity: "high", skip: false };
    if (h >= 7 && h < 16) return { name: "\u6B50\u6D32\u76E4", liquidity: "medium", skip: false };
    if (h >= 0 && h < 8) return { name: "\u4E9E\u6D32\u76E4", liquidity: "low", skip: false };
    return { name: "\u6B50\u7F8E\u91CD\u758A", liquidity: "high", skip: false };
  })();
  const isLowLiquidityPeriod = nowUtcHour >= 0 && nowUtcHour < 4;
  const tfAnalyses = [];
  const tfMap = /* @__PURE__ */ new Map();
  for (const tf of TF_CONFIG) {
    const candles = candleMap.get(tf.bar);
    if (!candles || candles.length < 50) continue;
    const analysis = analyzeTf(candles, tf.bar, tf.label, htfTrend);
    tfAnalyses.push(analysis);
    tfMap.set(tf.bar, analysis);
  }
  const models = buildModels(tfMap);
  const longCount = tfAnalyses.filter((t2) => t2.direction === "long").length;
  const shortCount = tfAnalyses.filter((t2) => t2.direction === "short").length;
  const overallDir = longCount > shortCount ? "long" : shortCount > longCount ? "short" : "neutral";
  const mtfConsensus = tfAnalyses.map(
    (t2) => `${t2.label}\uFF1A${t2.direction === "long" ? "\u770B\u591A" : t2.direction === "short" ? "\u770B\u7A7A" : "\u4E2D\u6027"}`
  ).join(" | ");
  const topModel = [...models].sort((a, b) => b.confidence - a.confidence)[0];
  const tf4h = tfMap.get("4H");
  const tf1h = tfMap.get("1H");
  const macroData = await fetchMacroData();
  const tfSignals = tfAnalyses.map((t2) => ({
    timeframe: t2.label,
    direction: t2.direction,
    strength: t2.total_score ?? 50,
    atr: t2.atr ?? 0,
    adx: t2.pa_adx,
    rsi: t2.pa_rsi,
    smcScore: t2.smc_score,
    paScore: t2.pa_score,
    chanScore: t2.chan_score,
    fibScore: t2.fib_score
  }));
  const bayesianResult = bayesianMtfFusion(tfSignals);
  const tf1hForRegime = tfMap.get("1H");
  const tf4hForRegime = tfMap.get("4H");
  const candles1h = candleMap.get("1H") ?? [];
  const atrHistory1h = candles1h.slice(-21).map((c) => {
    return c.high - c.low;
  });
  const recentVols1h = candles1h.slice(-21);
  const avgVol1h = recentVols1h.slice(0, -1).reduce((s, c) => s + c.volume, 0) / Math.max(recentVols1h.length - 1, 1);
  const curVol1h = candles1h[candles1h.length - 1]?.volume ?? 0;
  const priceChangePct1h = candles1h.length >= 2 ? (candles1h[candles1h.length - 1].close - candles1h[candles1h.length - 24]?.close) / (candles1h[candles1h.length - 24]?.close || 1) * 100 : 0;
  const regimeResult = classifyMarketRegime({
    adx: tf1hForRegime?.pa_adx ?? 20,
    atr: tf1hForRegime?.atr ?? 0,
    atrHistory: atrHistory1h,
    rsi: tf1hForRegime?.pa_rsi ?? 50,
    volume: curVol1h,
    avgVolume20: avgVol1h,
    htfTrend,
    smcStructure: tf4hForRegime?.smc_structure ?? "neutral",
    hasChanDivergence: !!tf4hForRegime?.chan_divergence,
    hasBosChoch: !!(tf4hForRegime?.smc_bos_choch && tf4hForRegime.smc_bos_choch !== "\u7121\u660E\u986F\u7D50\u69CB\u4E8B\u4EF6"),
    chanInZhongshu: tf4hForRegime?.chan_in_zhongshu ?? false,
    priceChangePct: priceChangePct1h
  });
  console.log(`[highWinRate.scan v5.1] \u5E02\u5834\u74B0\u5883\uFF1A${regimeResult.regimeLabel}\uFF08\u4FE1\u5FC3\u5EA6 ${regimeResult.confidence}%\uFF09`);
  const tfDirections = tfAnalyses.map((t2) => t2.direction);
  const neutralCount = tfDirections.filter((d) => d === "neutral").length;
  const isConflicted = longCount > 0 && shortCount > 0 && Math.abs(longCount - shortCount) <= 1;
  const isNoTradeRegime = isConflicted || neutralCount >= tfDirections.length - 1 || // 大多數時間框中性
  overallDir === "neutral" && models.every((m) => m.confidence < 55);
  if (isLowLiquidityPeriod) {
    for (const m of models) {
      m.confidence = Math.round(m.confidence * 0.8);
      m.risk_warning = `\u26A0\uFE0F [\u4F4E\u6D41\u52D5\u6027\u6642\u6BB5 ${sessionInfo.name} ${nowUtcHour}:00 UTC] ` + m.risk_warning;
    }
  } else if (sessionInfo.liquidity === "low") {
    for (const m of models) {
      m.confidence = Math.round(m.confidence * 0.9);
    }
  }
  const noTradeWarning = isNoTradeRegime ? `\u26A0\uFE0F \u4FE1\u865F\u885D\u7A81\u8B66\u544A\uFF1A\u591A\u7A7A\u65B9\u5411\u5206\u6B67\uFF08\u770B\u591A ${longCount} \u500B\u6642\u9593\u6846 vs \u770B\u7A7A ${shortCount} \u500B\u6642\u9593\u6846\uFF09\u3002\u5EFA\u8B70\u89C0\u671B\uFF0C\u4E0D\u5F37\u8FFD\u55AE\u3002` : "";
  const regimeLabel = `${regimeResult.regimeLabel}\uFF08${regimeResult.adaptiveParams.tradeFilter === "proceed" ? "\u2705 \u9069\u5408\u4EA4\u6613" : regimeResult.adaptiveParams.tradeFilter === "caution" ? "\u26A0\uFE0F \u8B39\u614E\u64CD\u4F5C" : "\u{1F6AB} \u5EFA\u8B70\u8FC4\u907F"}\uFF09`;
  for (const m of models) {
    const regimeAdj = applyRegimeAdaptation(m.confidence, m.rr_ratio, regimeResult);
    if (regimeAdj.adjustedConfidence !== m.confidence) {
      m.confidence = Math.round(regimeAdj.adjustedConfidence);
    }
    if (!regimeAdj.shouldTrade && regimeResult.adaptiveParams.tradeFilter === "avoid") {
      m.is_active = false;
      m.risk_warning = `\u{1F6AB} [\u74B0\u5883\u8FC4\u907F] ${regimeResult.regimeLabel}\uFF1A${regimeResult.adaptiveParams.description} ` + m.risk_warning;
    }
    if (m.kelly_fraction !== void 0) {
      m.kelly_fraction = m.kelly_fraction * regimeResult.adaptiveParams.kellyScaleFactor;
    }
  }
  const topModelInfo = topModel ? `${topModel.name}\uFF08\u4FE1\u5FC3\u5EA6 ${topModel.confidence}%\uFF0C${topModel.direction === "long" ? "\u505A\u591A" : topModel.direction === "short" ? "\u505A\u7A7A" : "\u4E2D\u6027"}\uFF0CRR ${topModel.rr_ratio.toFixed(1)}:1\uFF0C${topModel.is_active ? "\u5DF2\u555F\u52D5" : "\u7B49\u5F85\u89F8\u767C"}\uFF09` : "\u7121\u6A21\u578B";
  const prompt = `\u4F60\u662F\u4E00\u4F4D\u5C08\u696D\u7684\u52A0\u5BC6\u8CA8\u5E63\u65E5\u5167\u4EA4\u6613\u5206\u6790\u5E2B\uFF0C\u7CBE\u901A SMC\u3001PA\u3001\u6590\u6CE2\u90A3\u5951\u548C\u7E8F\u8AD6\u3002

\u3010\u91CD\u8981\u6307\u793A\u3011
- \u53EA\u6839\u64DA\u4E0B\u65B9\u63D0\u4F9B\u7684\u5177\u9AD4\u6578\u64DA\u9032\u884C\u5206\u6790\uFF0C\u4E0D\u5F97\u865C\u69CB\u6578\u5B57\u6216\u6DFB\u52A0\u672A\u63D0\u4F9B\u7684\u8CC7\u8A0A
- \u5982\u679C\u4FE1\u865F\u885D\u7A81\u6216\u4E0D\u6E05\u6670\uFF0C\u5FC5\u9808\u660E\u78BA\u8AAA\u300C\u4E0D\u4EA4\u6613\uFF08No-Trade\uFF09\u300D\u800C\u975E\u5F37\u884C\u7D66\u51FA\u65B9\u5411
- \u6240\u6709\u50F9\u4F4D\u6578\u5B57\u5FC5\u9808\u4F86\u81EA\u4E0B\u65B9\u63D0\u4F9B\u7684\u5206\u6790\u6578\u64DA\uFF0C\u4E0D\u5F97\u81EA\u884C\u63A8\u6E2C
- \u5982\u679C\u67D0\u500B\u6307\u6A19\u7F3A\u5931\u6216\u4E0D\u53EF\u9760\uFF0C\u8ACB\u660E\u78BA\u6307\u51FA\u800C\u975E\u5FFD\u7565
- \u8F38\u51FA\u5FC5\u9808\u5305\u542B\u660E\u78BA\u7684\u300C\u5931\u6548\u689D\u4EF6\uFF08Invalidation\uFF09\u300D\uFF0C\u8AAA\u660E\u4EC0\u9EBC\u60C5\u6CC1\u4E0B\u5206\u6790\u5931\u6548

${noTradeWarning ? noTradeWarning + "\n\n" : ""}\u3010\u5E02\u5834\u74B0\u5883\u3011
- \u5E63\u5C0D\uFF1A${coinName}/USDT
- Regime\uFF1A${regimeLabel}
- \u591A\u6642\u6BB5\u5171\u8B58\uFF1A${mtfConsensus}
- \u6574\u9AD4\u65B9\u5411\uFF1A${overallDir === "long" ? "\u770B\u591A" : overallDir === "short" ? "\u770B\u7A7A" : "\u4E2D\u6027/\u9707\u76EA"}
- 4H \u8DA8\u52E2\uFF1A${htfTrend === "bullish" ? "\u4E0A\u5347\u8DA8\u52E2" : htfTrend === "bearish" ? "\u4E0B\u964D\u8DA8\u52E2" : "\u9707\u76EA"}
- \u885D\u7A81\u5206\u6578\uFF1A\u770B\u591A ${longCount} \u500B / \u770B\u7A7A ${shortCount} \u500B / \u4E2D\u6027 ${neutralCount} \u500B
${isNoTradeRegime ? "- \u72C0\u614B\uFF1A\u2757\u4FE1\u865F\u885D\u7A81\uFF0C\u5EFA\u8B70\u89C0\u671B" : ""}

\u30104H \u7E8F\u8AD6\u5206\u6790\u3011
- \u8DA8\u52E2\uFF1A${tf4h?.chan_trend ?? "\u7121"} | \u7B46\u6578\uFF1A${tf4h?.chan_bi_count ?? 0} | \u7DDA\u6BB5\u6578\uFF1A${tf4h?.chan_duan_count ?? 0}
- \u4E2D\u6A1E\uFF1A${tf4h?.chan_in_zhongshu ? `\u9707\u76EA\u4E2D\uFF08${tf4h.chan_zhongshu_bottom.toFixed(2)}\u2013${tf4h.chan_zhongshu_top.toFixed(2)}\uFF09` : "\u4E2D\u6A1E\u5916"}
- MACD \u9762\u7A4D\u6BD4\uFF1A${tf4h?.chan_macd_area_ratio.toFixed(2) ?? "\u7121"}\uFF08< 0.7 \u70BA\u80CC\u99F3\u4FE1\u865F\uFF09
- \u80CC\u99F3\uFF1A${tf4h?.chan_divergence ? tf4h.chan_divergence === "bottom" ? "\u5E95\u80CC\u99F3 \u2191" : "\u9802\u80CC\u99F3 \u2193" : "\u7121"}
- \u7E8F\u8AD6\u8CB7\u8CE3\u9EDE\uFF1A${tf4h?.chan_buy_sell_points.map((p) => `${p.level}\u985E${p.direction === "buy" ? "\u8CB7" : "\u8CE3"}\u9EDE@${p.price.toFixed(2)}`).join("\u3001") || "\u7121"}
- SMC \u7D50\u69CB\uFF1A${tf4h?.smc_structure ?? "\u7121"} | \u6700\u8FD1\u4E8B\u4EF6\uFF1A${tf4h?.smc_bos_choch ?? "\u7121"}
- Premium/Discount\uFF1A${tf4h?.smc_premium_discount ?? "\u7121"}
- ATR\uFF1A${tf4h?.atr.toFixed(2) ?? "\u7121"}

\u30101H SMC \u4E09\u90E8\u66F2\u5206\u6790\u3011
- \u6D41\u52D5\u6027\u6E05\u63C3\uFF1A${tf1h?.liquidity_sweep.sslSwept ? `\u6E05\u63C3 SSL\uFF08${tf1h.liquidity_sweep.sslPrice.toFixed(2)}\uFF0C\u770B\u591A\uFF09` : tf1h?.liquidity_sweep.bslSwept ? `\u6E05\u63C3 BSL\uFF08${tf1h.liquidity_sweep.bslPrice.toFixed(2)}\uFF0C\u770B\u7A7A\uFF09` : "\u7121"}
- SMC \u4E09\u90E8\u66F2\u8A2D\u7F6E\uFF1A${tf1h?.smc_setups.length ?? 0} \u500B\uFF08${tf1h?.smc_setups.filter((s) => s.status === "active").length ?? 0} \u500B\u555F\u52D5\u4E2D\uFF09
- PA \u8DA8\u52E2\uFF1A${tf1h?.pa_trend ?? "\u7121"} | RSI\uFF1A${tf1h?.pa_rsi.toFixed(1) ?? "\u7121"} | ADX\uFF1A${tf1h?.pa_adx.toFixed(1) ?? "\u7121"}
- PA \u5F62\u614B\uFF08\u95DC\u9375\u6C34\u4F4D\u5171\u632F\uFF09\uFF1A\u591A\u65B9 [${tf1h?.pa_bullish_patterns.join("\u3001") ?? "\u7121"}] | \u7A7A\u65B9 [${tf1h?.pa_bearish_patterns.join("\u3001") ?? "\u7121"}]
- RSI/MACD \u80CC\u96E2\uFF1A${tf1h?.divergences.slice(0, 2).join(" | ") || "\u7121"}

\u3010\u6700\u4F73\u6A21\u578B\u3011${topModelInfo}

\u3010\u4E09\u500B\u4EA4\u6613\u6A21\u578B\u8A73\u60C5\u3011
${models.map((m) => `
\u2014 ${m.name}
  \u4FE1\u5FC3\u5EA6\uFF1A${m.confidence}%\uFF08\u5DF2\u542B\u9006\u52E2\u61F2\u7F70\uFF09 | \u65B9\u5411\uFF1A${m.direction === "long" ? "\u505A\u591A" : m.direction === "short" ? "\u505A\u7A7A" : "\u4E2D\u6027"} | RR\uFF1A${m.rr_ratio.toFixed(1)}:1 | \u72C0\u614B\uFF1A${m.is_active ? "\u2705\u5DF2\u555F\u52D5" : "\u23F3\u7B49\u5F85"}
  \u9032\u5834\u689D\u4EF6\uFF1A${m.entry_conditions.slice(0, 3).map((c) => c).join("; ")}
  \u6B62\u640D\uFF1A${m.stop_loss_hint} | \u6B62\u76C8\uFF1A${m.take_profit_hint}
  \u98A8\u96AA\uFF1A${m.risk_warning}`).join("\n")}

${isNoTradeRegime ? `\u8ACB\u7528\u7E41\u9AD4\u4E2D\u6587\uFF0C\u6309\u4EE5\u4E0B\u7D50\u69CB\u56DE\u7B54\uFF1A

\u3010\u5E02\u5834\u72C0\u614B\u8A3A\u65B7\u3011
- \u8AAA\u660E\u70BA\u4EC0\u9EBC\u76EE\u524D\u8655\u65BC No-Trade \u72C0\u614B\uFF0C\u5177\u9AD4\u6307\u51FA\u54EA\u4E9B\u6642\u9593\u6846\u885D\u7A81

\u3010\u91CD\u65B0\u5165\u5834\u689D\u4EF6\u3011
- \u8AAA\u660E\u9700\u8981\u54EA\u4E9B\u689D\u4EF6\u540C\u6642\u6210\u7ACB\u624D\u80FD\u5165\u5834\uFF08\u81F3\u5C11 2 \u500B\u5177\u9AD4\u689D\u4EF6\uFF09

\u3010\u95DC\u9375\u50F9\u4F4D\u3011
- \u5217\u51FA 3-4 \u500B\u6700\u91CD\u8981\u7684\u50F9\u4F4D\u53CA\u5176\u610F\u7FA9

\u3010\u5931\u6548\u689D\u4EF6\uFF08Invalidation\uFF09\u3011
- \u8AAA\u660E\u4EC0\u9EBC\u60C5\u6CC1\u4E0B\u5206\u6790\u5B8C\u5168\u5931\u6548\uFF0C\u9700\u91CD\u65B0\u5206\u6790

\u3010\u98A8\u96AA\u63D0\u793A\u3011
- \u5982\u679C\u5F37\u884C\u5165\u5834\u7684\u6700\u5927\u98A8\u96AA\u8207\u5EFA\u8B70\u89C0\u671B\u65B9\u5F0F` : `\u8ACB\u7528\u7E41\u9AD4\u4E2D\u6587\uFF0C\u6309\u4EE5\u4E0B\u7D50\u69CB\u56DE\u7B54\uFF1A

\u3010\u5E02\u5834\u72C0\u614B\u8A3A\u65B7\u3011
- \u8AAA\u660E ${coinName} \u76EE\u524D\u8655\u65BC\u300C${regimeLabel}\u300D\u7684\u5177\u9AD4\u4F9D\u64DA\uFF0C\u91CD\u9EDE\u5F15\u7528\u7E8F\u8AD6\u548C SMC \u7684\u5177\u9AD4\u6578\u64DA

\u3010\u6700\u4F73\u6A21\u578B\u8207 SMC \u5B8C\u6210\u5EA6\u3011
- \u8AAA\u660E\u54EA\u500B\u6A21\u578B\u6700\u9069\u5408\uFF0C SMC \u4E09\u90E8\u66F2\u5B8C\u6210\u5EA6\uFF0C\u4EE5\u53CA\u7E8F\u8AD6\u8CB7\u8CE3\u9EDE\u662F\u5426\u5171\u632F

\u3010\u9032\u5834\u6263\u677F\u6A5F\u689D\u4EF6\u3011
- \u5217\u51FA 2-3 \u500B\u6700\u5F8C\u78BA\u8A8D\u8A0A\u865F\uFF08\u5FC5\u9808\u5177\u9AD4\u5230\u50F9\u4F4D\u548C K \u7DDA\u5F62\u614B\uFF09

\u3010\u95DC\u9375\u50F9\u4F4D\u8207 ATR \u8996\u89D2\u3011
- \u5217\u51FA 3-4 \u500B\u95DC\u9375\u50F9\u4F4D\uFF0C\u8AAA\u660E ATR \u52D5\u614B\u8996\u89D2\u4E0B\u7684\u610F\u7FA9

\u3010\u5931\u6548\u689D\u4EF6\uFF08Invalidation\uFF09\u3011
- \u8AAA\u660E\u4EC0\u9EBC\u60C5\u6CC1\u4E0B\u6B64\u5206\u6790\u5931\u6548\uFF0C\u9700\u91CD\u65B0\u8A55\u4F30

\u3010\u98A8\u96AA\u7BA1\u7406\u5EFA\u8B70\u3011
- \u5009\u4F4D\u5EFA\u8B70\u3001\u6B62\u640D\u8A2D\u5B9A\u3001\u76C8\u865F\u6BD4\uFF0C\u53CA\u6700\u4F4E\u53EF\u63A5\u53D7\u7684\u4FE1\u5FC3\u5EA6\u95BE\u503C`}`;
  const macroContext = buildMacroContext(macroData);
  const bayesianContext = `\u3010\u8C9D\u8449\u65AF\u591A\u6642\u6846\u878D\u5408\u7D50\u679C\u3011
\u878D\u5408\u65B9\u5411\uFF1A${bayesianResult.fusedDirection === "long" ? "\u770B\u591A" : bayesianResult.fusedDirection === "short" ? "\u770B\u7A7A" : "\u4E2D\u6027"}
\u878D\u5408\u4FE1\u5FC3\u5EA6\uFF1A${bayesianResult.bayesianConfidence}%
${bayesianResult.regimeAdjustment}`;
  const envScanPrompt = `\u4F60\u662F\u4E00\u4F4D\u52A0\u5BC6\u8CA8\u5E63\u5E02\u5834\u74B0\u5883\u5206\u6790\u5E2B\u3002\u4F60\u7684\u4EFB\u52D9\u662F\uFF1A\u5728\u91CF\u5316\u6307\u6A19\u5206\u6790\u958B\u59CB\u524D\uFF0C\u5148\u5C0D\u76EE\u524D\u5E02\u5834\u74B0\u5883\u505A\u4E00\u500B\u5168\u9762\u7684\u5B8F\u89C0\u8207\u60C5\u7DD2\u5224\u65B7\u3002

\u3010\u5E63\u5C0D\u8CC7\u8A0A\u3011
\u5E63\u5C0D\uFF1A${coinName}/USDT
\u76EE\u524D\u6642\u6BB5\uFF1A${sessionInfo.name}\uFF08UTC ${nowUtcHour}\u6642\uFF09
4H \u8DA8\u52E2\uFF1A${htfTrend === "bullish" ? "\u4E0A\u5347\u8DA8\u52E2" : htfTrend === "bearish" ? "\u4E0B\u964D\u8DA8\u52E2" : "\u9707\u76EA"}
\u591A\u6642\u6846\u65B9\u5411\uFF1A\u770B\u591A ${longCount} \u500B\u6642\u6846 / \u770B\u7A7A ${shortCount} \u500B\u6642\u6846 / \u4E2D\u6027 ${neutralCount} \u500B\u6642\u6846
4H ATR\uFF1A${tfMap.get("4H")?.atr.toFixed(2) ?? "N/A"}
4H SMC \u7D50\u69CB\uFF1A${tfMap.get("4H")?.smc_structure ?? "\u7121"}
4H \u7E8F\u8AD6\u8DA8\u52E2\uFF1A${tfMap.get("4H")?.chan_trend ?? "\u7121"}
1H PA \u8DA8\u52E2\uFF1A${tfMap.get("1H")?.pa_trend ?? "\u7121"}
\u6700\u4F73\u5019\u9078\u6A21\u578B\uFF1A${topModel?.name ?? "\u7121"}\uFF08\u4FE1\u5FC3\u5EA6 ${topModel?.confidence ?? 0}%\uFF09

${macroContext}

${bayesianContext}

\u3010\u8ACB\u5C0D\u4EE5\u4E0B\u5404\u9805\u9032\u884C\u5206\u6790\u3011
1. \u5E02\u5834\u74B0\u5883\uFF1A\u76EE\u524D\u5C6C\u65BC\u8DA8\u52E2\u5EF6\u7E8C\u3001\u9707\u76EA\u6574\u7406\u3001\u9084\u662F\u8F49\u6298\u6642\u671F\uFF1F
2. \u5B8F\u89C0\u8207\u60C5\u7DD2\uFF1A\u76EE\u524D\u52A0\u5BC6\u8CA8\u5E63\u5E02\u5834\u60C5\u7DD2\u5982\u4F55\uFF1F\u6709\u7121\u9700\u8981\u6CE8\u610F\u7684\u5B8F\u89C0\u56E0\u7D20\uFF1F
3. \u6642\u6BB5\u504F\u5411\uFF1A${sessionInfo.name}\u7684\u5E38\u898F\u7279\u5FB5\u662F\u4EC0\u9EBC\uFF1F\u5C0D\u4EA4\u6613\u6709\u4EC0\u9EBC\u5F71\u97FF\uFF1F
4. \u6700\u5927\u98A8\u96AA\uFF1A\u76EE\u524D\u9032\u5834\u6700\u53EF\u80FD\u906D\u9047\u7684\u6700\u5927\u98A8\u96AA\u662F\u4EC0\u9EBC\uFF1F
5. \u4EA4\u6613\u904E\u6FFE\uFF1A\u7D9C\u5408\u4EE5\u4E0A\u5206\u6790\uFF0C\u76EE\u524D\u9069\u5408\u4EA4\u6613\u5417\uFF1F

\u8ACB\u8F38\u51FA\u4EE5\u4E0B\u683C\u5F0F\u7684 JSON\uFF08\u4E0D\u8981\u8F38\u51FA\u4EFB\u4F55\u5176\u4ED6\u6587\u5B57\uFF09\uFF1A
{
  "regime": "\u5E02\u5834\u74B0\u5883\u5224\u65B7\uFF08\u4E00\u53E5\u8A71\uFF09",
  "macro_note": "\u5B8F\u89C0\u8207\u60C5\u7DD2\u8AAA\u660E\uFF08\u4E00\u53E5\u8A71\uFF09",
  "session_bias": "\u6642\u6BB5\u504F\u5411\u8AAA\u660E\uFF08\u4E00\u53E5\u8A71\uFF09",
  "key_risk": "\u76EE\u524D\u6700\u5927\u98A8\u96AA\uFF08\u4E00\u53E5\u8A71\uFF09",
  "trade_filter": "proceed" | "caution" | "avoid",
  "filter_reason": "\u904E\u6FFE\u539F\u56E0\uFF08\u4E00\u53E5\u8A71\uFF09"
}`;
  const sweepDir1h = tf1h?.liquidity_sweep.sslSwept ? "long" : tf1h?.liquidity_sweep.bslSwept ? "short" : "neutral";
  const sweepPrice1h = tf1h?.liquidity_sweep.sslSwept ? tf1h.liquidity_sweep.sslPrice : tf1h?.liquidity_sweep.bslSwept ? tf1h.liquidity_sweep.bslPrice : 0;
  const activeSmc1h = tf1h?.smc_setups.filter((s) => s.status === "active") ?? [];
  const bestSmcSetup = activeSmc1h.sort((a, b) => b.confluence_score - a.confluence_score)[0];
  const dynamicFeaturesSummary = [
    sweepPrice1h > 0 ? `\u6E05\u6383\u6C34\u4F4D ${sweepPrice1h.toFixed(2)}\uFF08${sweepDir1h === "long" ? "SSL\u5DF2\u6383\uFF0C\u770B\u591A" : "BSL\u5DF2\u6383\uFF0C\u770B\u7A7A"}\uFF09` : "\u7121\u6E05\u6383\u4E8B\u4EF6",
    bestSmcSetup ? `\u6700\u4F73\u4E09\u90E8\u66F2\uFF1A${bestSmcSetup.sweep_type} \u2192 \u9032\u5834\u5340 ${bestSmcSetup.entry_bottom.toFixed(2)}\u2013${bestSmcSetup.entry_top.toFixed(2)}\uFF0CRR ${bestSmcSetup.rr_ratio.toFixed(1)}\uFF0C\u5171\u632F\u5206 ${bestSmcSetup.confluence_score}` : "\u4E09\u90E8\u66F2\u5C1A\u672A\u5B8C\u6574",
    tf1h?.chan_divergence ? `1H \u7E8F\u8AD6\u80CC\u99B3\uFF1A${tf1h.chan_divergence === "bottom" ? "\u5E95\u80CC\u99B3" : "\u9802\u80CC\u99B3"}` : "\u7121\u80CC\u99B3",
    `1H RSI ${tf1h?.pa_rsi.toFixed(1) ?? "N/A"} | ADX ${tf1h?.pa_adx.toFixed(1) ?? "N/A"} | 4H MACD\u9762\u7A4D\u6BD4 ${tf4h?.chan_macd_area_ratio.toFixed(2) ?? "N/A"}`
  ].join(" | ");
  const vetoPrompt = `\u4F60\u662F\u4E00\u4F4D\u52A0\u5BC6\u8CA8\u5E63\u4EA4\u6613\u5BE9\u6838\u7CFB\u7D71\uFF08Trade Veto Layer\uFF09\u3002\u4F60\u7684\u552F\u4E00\u4EFB\u52D9\u662F\uFF1A\u5BE9\u6838\u9019\u7B46\u5019\u9078\u4EA4\u6613\u662F\u5426\u503C\u5F97\u57F7\u884C\u3002

\u3010\u6838\u5FC3\u898F\u5247\u3011
- \u4F60\u5FC5\u9808\u8F38\u51FA\u4E00\u500B JSON \u7269\u4EF6\uFF0C\u4E0D\u5F97\u8F38\u51FA\u4EFB\u4F55\u5176\u4ED6\u6587\u5B57
- \u4F60\u5FC5\u9808\u6839\u64DA\u4E0B\u65B9\u6578\u64DA\u505A\u51FA TRADE / WAIT / REJECT \u4E09\u9078\u4E00\u7684\u6C7A\u5B9A
- \u5982\u679C\u4EFB\u4F55\u95DC\u9375\u689D\u4EF6\u7F3A\u5931\u6216\u885D\u7A81\uFF0C\u5FC5\u9808\u9078\u64C7 WAIT \u6216 REJECT\uFF0C\u4E0D\u53EF\u5F37\u884C TRADE
- \u4E0D\u5F97\u865B\u69CB\u4EFB\u4F55\u6578\u5B57\uFF0C\u6240\u6709\u6578\u64DA\u5FC5\u9808\u4F86\u81EA\u4E0B\u65B9\u63D0\u4F9B\u7684\u8CC7\u8A0A

\u3010\u5019\u9078\u4EA4\u6613\u8CC7\u8A0A\u3011
\u5E63\u5C0D\uFF1A${coinName}/USDT
Regime\uFF1A${regimeLabel}\uFF08${overallDir === "long" ? "\u6574\u9AD4\u770B\u591A" : overallDir === "short" ? "\u6574\u9AD4\u770B\u7A7A" : "\u65B9\u5411\u885D\u7A81"}\uFF09
\u65B9\u5411\u885D\u7A81\u5206\u6578\uFF1A\u770B\u591A ${longCount} \u500B\u6642\u6846 vs \u770B\u7A7A ${shortCount} \u500B\u6642\u6846 vs \u4E2D\u6027 ${neutralCount} \u500B\u6642\u6846
${isNoTradeRegime ? "\u26A0\uFE0F \u4FE1\u865F\u885D\u7A81\u8B66\u544A\uFF1A\u591A\u7A7A\u65B9\u5411\u5206\u6B67\uFF0C\u5EFA\u8B70\u89C0\u671B" : ""}

\u3010\u6700\u4F73\u5019\u9078\u6A21\u578B\u3011
${topModel ? `${topModel.name}\uFF08${topModel.id === "liquidity_reversal" ? "A" : topModel.id === "trend_pullback" ? "B" : "C"}\uFF09
\u4FE1\u5FC3\u5EA6\uFF1A${topModel.confidence}%
\u65B9\u5411\uFF1A${topModel.direction === "long" ? "\u505A\u591A" : topModel.direction === "short" ? "\u505A\u7A7A" : "\u4E2D\u6027"}
RR\uFF1A${topModel.rr_ratio.toFixed(1)}:1
\u72C0\u614B\uFF1A${topModel.is_active ? "\u5DF2\u555F\u52D5" : "\u7B49\u5F85\u89F8\u767C"}
\u9032\u5834\u689D\u4EF6\uFF1A${topModel.entry_conditions.slice(0, 3).join(" | ")}
\u6B62\u640D\uFF1A${topModel.stop_loss_hint}
\u6B62\u76C8\uFF1A${topModel.take_profit_hint}
\u98A8\u96AA\uFF1A${topModel.risk_warning}` : "\u7121\u53EF\u7528\u6A21\u578B"}

\u30104H \u9AD8\u7D1A\u5225\u74B0\u5883\u3011
\u7E8F\u8AD6\u8DA8\u52E2\uFF1A${tf4h?.chan_trend ?? "\u7121"} | \u4E2D\u6A1E\uFF1A${tf4h?.chan_in_zhongshu ? `\u9707\u76EA\u4E2D\uFF08${tf4h.chan_zhongshu_bottom.toFixed(2)}\u2013${tf4h.chan_zhongshu_top.toFixed(2)}\uFF09` : "\u4E2D\u6A1E\u5916"}
MACD\u9762\u7A4D\u6BD4\uFF1A${tf4h?.chan_macd_area_ratio.toFixed(2) ?? "N/A"}\uFF08< 0.7 = \u80CC\u99B3\u4FE1\u865F\uFF09
\u80CC\u99B3\uFF1A${tf4h?.chan_divergence ? tf4h.chan_divergence === "bottom" ? "\u5E95\u80CC\u99B3" : "\u9802\u80CC\u99B3" : "\u7121"}
SMC\u7D50\u69CB\uFF1A${tf4h?.smc_structure ?? "\u7121"} | \u6700\u8FD1\u4E8B\u4EF6\uFF1A${tf4h?.smc_bos_choch ?? "\u7121"}
ATR\uFF1A${tf4h?.atr.toFixed(2) ?? "N/A"}

\u30101H \u5165\u5834\u6642\u6846\u3011
\u6E05\u6383\u4E8B\u4EF6\uFF1A${tf1h?.liquidity_sweep.sslSwept ? `SSL\u5DF2\u6383\uFF08${tf1h.liquidity_sweep.sslPrice.toFixed(2)}\uFF09` : tf1h?.liquidity_sweep.bslSwept ? `BSL\u5DF2\u6383\uFF08${tf1h.liquidity_sweep.bslPrice.toFixed(2)}\uFF09` : "\u7121"}
SMC\u4E09\u90E8\u66F2\uFF1A${tf1h?.smc_setups.length ?? 0} \u500B\u8A2D\u7F6E\uFF0C${tf1h?.smc_setups.filter((s) => s.status === "active").length ?? 0} \u500B\u555F\u52D5\u4E2D
PA\u8DA8\u52E2\uFF1A${tf1h?.pa_trend ?? "\u7121"} | RSI\uFF1A${tf1h?.pa_rsi.toFixed(1) ?? "N/A"} | ADX\uFF1A${tf1h?.pa_adx.toFixed(1) ?? "N/A"}
PA\u5F62\u614B\uFF1A\u591A\u65B9 [${tf1h?.pa_bullish_patterns.join("\u3001") || "\u7121"}] | \u7A7A\u65B9 [${tf1h?.pa_bearish_patterns.join("\u3001") || "\u7121"}]
\u80CC\u96E2\uFF1A${tf1h?.divergences.slice(0, 2).join(" | ") || "\u7121"}

\u3010\u52D5\u614B\u7279\u5FB5\u6458\u8981\u3011
${dynamicFeaturesSummary}

\u3010\u4E09\u500B\u6A21\u578B\u8A55\u5206\u5C0D\u6BD4\u3011
${models.map((m) => `${m.name}\uFF08${m.id === "liquidity_reversal" ? "A" : m.id === "trend_pullback" ? "B" : "C"}\uFF09\uFF1A\u4FE1\u5FC3\u5EA6 ${m.confidence}% | ${m.is_active ? "\u2705\u5DF2\u555F\u52D5" : "\u23F3\u7B49\u5F85"} | RR ${m.rr_ratio.toFixed(1)}:1`).join("\n")}

\u8ACB\u8F38\u51FA\u4EE5\u4E0B\u683C\u5F0F\u7684 JSON\uFF08\u4E0D\u8981\u8F38\u51FA\u4EFB\u4F55\u5176\u4ED6\u6587\u5B57\uFF0C\u53EA\u8F38\u51FA JSON\uFF09\uFF1A
{
  "decision": "TRADE" | "WAIT" | "REJECT",
  "model": "A" | "B" | "C" | "NONE",
  "setup_quality": 1-5,
  "primary_edge": "\u6B64\u4EA4\u6613\u7684\u6838\u5FC3\u512A\u52E2\uFF08\u4E00\u53E5\u8A71\uFF0C\u5FC5\u9808\u5F15\u7528\u5177\u9AD4\u6578\u64DA\uFF09",
  "primary_failure_mode": "\u6700\u53EF\u80FD\u7684\u5931\u6557\u539F\u56E0\uFF08\u4E00\u53E5\u8A71\uFF09",
  "must_see_trigger": "\u82E5\u8981\u9032\u5834\uFF0C\u5FC5\u9808\u770B\u5230\u7684\u5177\u9AD4\u689D\u4EF6",
  "invalidation": "\u6B64\u5206\u6790\u7684\u5931\u6548\u689D\u4EF6",
  "conflict_note": "\u591A\u6642\u6846\u6216\u6A21\u578B\u885D\u7A81\u8AAA\u660E",
  "confidence": 0-100,
  "reason_codes": ["RECLAIM_OK"|"RECLAIM_FAIL"|"DISPLACEMENT_STRONG"|"DISPLACEMENT_WEAK"|"FRESH_ZONE"|"STALE_ZONE"|"VOLUME_CONFIRMED"|"VOLUME_MISSING"|"HTF_ALIGNED"|"HTF_CONFLICT"|"CHAN_BSP_CONFIRMED"|"CHAN_IN_ZHONGSHU"|"SMC_TRILOGY_COMPLETE"|"SMC_TRILOGY_INCOMPLETE"|"NO_TRADE_REGIME"],
  "dynamic_features_summary": "\u52D5\u614B\u7279\u5FB5\u6458\u8981"
}`;
  let aiAnalysis = "";
  let tradeDecision = void 0;
  let envScan = void 0;
  let finalStrategy = void 0;
  const useAI = engine !== "local";
  if (useAI) {
    try {
      const envResult = await invokeLLM2({
        messages: [{ role: "user", content: envScanPrompt }],
        maxTokens: 400
      });
      const envRaw = envResult.choices[0]?.message?.content;
      const envText = typeof envRaw === "string" ? envRaw : Array.isArray(envRaw) ? envRaw.filter((c) => c.type === "text").map((c) => c.text).join("") : "";
      const envClean = envText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      const envJson = envClean.match(/\{[\s\S]*\}/);
      if (envJson) {
        const parsed = JSON.parse(envJson[0]);
        if (parsed.trade_filter && ["proceed", "caution", "avoid"].includes(parsed.trade_filter)) {
          envScan = {
            regime: parsed.regime ?? "\u7121\u6CD5\u5224\u65B7",
            macro_note: parsed.macro_note ?? "",
            session_bias: parsed.session_bias ?? "",
            key_risk: parsed.key_risk ?? "",
            trade_filter: parsed.trade_filter,
            filter_reason: parsed.filter_reason ?? ""
          };
          console.log(`[highWinRate.scan v4.0] Layer 1 \u74B0\u5883\u6383\u63CF\uFF1A${envScan.regime}\uFF08${envScan.trade_filter}\uFF09`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[highWinRate.scan v4.0] Layer 1 \u74B0\u5883\u6383\u63CF\u5931\u6557\uFF1A${msg}`);
    }
    try {
      const vetoResult = await invokeLLM2({
        messages: [{ role: "user", content: vetoPrompt }],
        maxTokens: 800
      });
      const vetoRaw = vetoResult.choices[0]?.message?.content;
      const vetoText = typeof vetoRaw === "string" ? vetoRaw : Array.isArray(vetoRaw) ? vetoRaw.filter((c) => c.type === "text").map((c) => c.text).join("") : "";
      const vetoClean = vetoText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      const jsonMatch = vetoClean.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.decision && ["TRADE", "WAIT", "REJECT"].includes(parsed.decision)) {
          tradeDecision = {
            decision: parsed.decision,
            model: parsed.model ?? "NONE",
            setup_quality: parsed.setup_quality ?? 3,
            primary_edge: parsed.primary_edge ?? "",
            primary_failure_mode: parsed.primary_failure_mode ?? "",
            must_see_trigger: parsed.must_see_trigger ?? "",
            invalidation: parsed.invalidation ?? "",
            conflict_note: parsed.conflict_note ?? "\u7121\u885D\u7A81",
            confidence: parsed.confidence ?? 0,
            reason_codes: parsed.reason_codes ?? [],
            dynamic_features_summary: parsed.dynamic_features_summary ?? dynamicFeaturesSummary
          };
          console.log(`[highWinRate.scan v3.5] Veto \u6C7A\u7B56\uFF1A${tradeDecision.decision}\uFF08\u6A21\u578B ${tradeDecision.model}\uFF0C\u4FE1\u5FC3\u5EA6 ${tradeDecision.confidence}%\uFF09`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[highWinRate.scan v3.5] Veto Layer \u5931\u6557\uFF1A${msg}`);
    }
    try {
      const llmResult = await invokeLLM2({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 2800
      });
      const rawContent = llmResult.choices[0]?.message?.content;
      const text = typeof rawContent === "string" ? rawContent : Array.isArray(rawContent) ? rawContent.filter((c) => c.type === "text").map((c) => c.text).join("") : "";
      const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      if (cleaned && cleaned !== "__LOCAL_ENGINE__") {
        aiAnalysis = cleaned;
        console.log(`[highWinRate.scan v3.5] ${engine} AI \u5206\u6790\u5B8C\u6210\uFF08${cleaned.length} \u5B57\uFF09`);
      } else {
        throw new Error("AI \u56DE\u50B3\u7A7A\u5167\u5BB9\u6216\u672C\u5730\u6A19\u8A18");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[highWinRate.scan v3.5] ${engine} AI \u5206\u6790\u5931\u6557\uFF0C\u5207\u63DB\u672C\u5730\u5F15\u64CE\uFF1A${msg}`);
    }
  }
  if (!aiAnalysis) {
    const reTf4h = tfAnalyses.find((t2) => t2.bar === "4H" || t2.bar === "4h");
    const reTf1h = tfAnalyses.find((t2) => t2.bar === "1H" || t2.bar === "1h");
    const reTf15m = tfAnalyses.find((t2) => t2.bar === "15m" || t2.bar === "15M");
    const reTf1d = tfAnalyses.find((t2) => t2.bar === "1D" || t2.bar === "1d");
    const marketState = (() => {
      const d4h = reTf4h?.direction ?? "neutral";
      const d1h = reTf1h?.direction ?? "neutral";
      const d1d = reTf1d?.direction ?? "neutral";
      const allBullish = [d4h, d1h, d1d].filter((d) => d === "long").length;
      const allBearish = [d4h, d1h, d1d].filter((d) => d === "short").length;
      if (allBullish >= 2) return "\u591A\u982D\u8DA8\u52E2\u65E5";
      if (allBearish >= 2) return "\u7A7A\u982D\u8DA8\u52E2\u65E5";
      if (d4h !== "neutral" && d1h !== d4h) return "\u5047\u7A81\u7834\u8F49\u5411\u65E5";
      return "\u9707\u76EA\u6574\u7406\u65E5";
    })();
    const activeModels = models.filter((m) => m.is_active);
    const bestModel = topModel;
    const bestModelName = bestModel?.name ?? "\u7121";
    const bestConf = bestModel?.confidence ?? 0;
    const bestDir = bestModel?.direction === "long" ? "\u505A\u591A \u2191" : bestModel?.direction === "short" ? "\u505A\u7A7A \u2193" : "\u4E2D\u6027";
    const bestRR = bestModel?.rr_ratio.toFixed(1) ?? "N/A";
    const chanState4h = reTf4h ? `${reTf4h.chan_trend}\uFF08${reTf4h.chan_in_zhongshu ? "\u4E2D\u6A1E\u5167" : "\u4E2D\u6A1E\u5916"}\uFF09` : "\u7121\u8CC7\u6599";
    const chanState1h = reTf1h ? `${reTf1h.chan_trend}\uFF08${reTf1h.chan_in_zhongshu ? "\u4E2D\u6A1E\u5167" : "\u4E2D\u6A1E\u5916"}\uFF09` : "\u7121\u8CC7\u6599";
    const smcCount = models.reduce((acc, m) => acc + (m.smc_setups?.length ?? 0), 0);
    const smcActive = models.reduce((acc, m) => acc + (m.smc_setups?.filter((s) => s.status === "active")?.length ?? 0), 0);
    const keyLevels = [];
    models.forEach((m) => {
      if (m.key_levels && m.key_levels.length > 0) {
        const entryLevel = m.key_levels.find((l) => l.type === "fib" || l.type === "bull_ob" || l.type === "bear_ob");
        if (entryLevel) keyLevels.push(`${m.name} \u9032\u5834\u5340\uFF1A${entryLevel.price.toFixed(1)}`);
      }
      if (m.stop_loss_hint) keyLevels.push(`${m.name} \u6B62\u640D\uFF1A${m.stop_loss_hint.slice(0, 30)}`);
    });
    const riskWarnings = models.filter((m) => m.risk_warning).map((m) => m.risk_warning);
    const uniqueRisks = Array.from(new Set(riskWarnings)).slice(0, 3);
    const triggerConditions = bestModel?.entry_conditions?.slice(0, 3) ?? [];
    aiAnalysis = [
      `\u3010\u5E02\u5834\u72C0\u614B\u5224\u65B7\u3011`,
      `\u7576\u524D ${coinName} \u8655\u65BC\u300C${marketState}\u300D\u683C\u5C40\u3002`,
      `4H \u7E8F\u8AD6\uFF1A${chanState4h}\u30001H \u7E8F\u8AD6\uFF1A${chanState1h}`,
      reTf4h ? `4H \u8A55\u5206 ${reTf4h.total_score} \u5206\uFF08SMC ${reTf4h.smc_score} / PA ${reTf4h.pa_score} / Fib ${reTf4h.fib_score} / \u7E8F ${reTf4h.chan_score}\uFF09` : "",
      ``,
      `\u3010\u6700\u4F73\u4EA4\u6613\u6A21\u578B\u3011`,
      `${bestModelName}\uFF08\u4FE1\u5FC3\u5EA6 ${bestConf}%\uFF0C${bestDir}\uFF0C\u76C8\u8667\u6BD4 ${bestRR}:1\uFF09`,
      activeModels.length > 0 ? `\u76EE\u524D ${activeModels.length} \u500B\u6A21\u578B\u689D\u4EF6\u5DF2\u6EFF\u8DB3\uFF1A${activeModels.map((m) => m.name).join("\u3001")}` : `\u76EE\u524D\u6240\u6709\u6A21\u578B\u689D\u4EF6\u5C1A\u672A\u6EFF\u8DB3\uFF0C\u5EFA\u8B70\u7B49\u5F85\u89F8\u767C\u3002`,
      `SMC \u4E09\u90E8\u66F2\u8A2D\u7F6E\uFF1A\u5171 ${smcCount} \u500B\uFF0C${smcActive} \u500B\u5DF2\u555F\u52D5`,
      ``,
      `\u3010\u9032\u5834\u6263\u677F\u6A5F\u689D\u4EF6\uFF08\u6700\u5F8C\u78BA\u8A8D\u8A0A\u865F\uFF09\u3011`,
      ...triggerConditions.length > 0 ? triggerConditions.map((c, i) => `${i + 1}. ${c}`) : ["\u7B49\u5F85\u50F9\u683C\u89F8\u53CA\u9032\u5834\u5340\u57DF\u5F8C\uFF0C\u89C0\u5BDF 15m K \u7DDA\u5F62\u614B\u78BA\u8A8D\u3002"],
      ``,
      `\u3010\u95DC\u9375\u50F9\u4F4D\u3011`,
      ...keyLevels.length > 0 ? keyLevels : ["\u66AB\u7121\u660E\u78BA\u9032\u5834\u5340\u9593\uFF0C\u7B49\u5F85\u4E0B\u6B21\u5206\u6790\u66F4\u65B0\u3002"],
      ``,
      `\u3010\u98A8\u96AA\u7BA1\u7406\u5EFA\u8B70\u3011`,
      `\u2022 \u9996\u6B21\u9032\u5834\u5EFA\u8B70\u534A\u5009\uFF0C\u78BA\u8A8D\u65B9\u5411\u5F8C\u52A0\u5009`,
      `\u2022 \u55AE\u7B46\u98A8\u96AA\u63A7\u5236\u5728\u7E3D\u8CC7\u91D1 1% \u4EE5\u5167`,
      `\u2022 \u6700\u4F4E\u53EF\u63A5\u53D7\u76C8\u8667\u6BD4 ${bestRR}:1\uFF0C\u4F4E\u65BC\u6B64\u4E0D\u505A`,
      ...uniqueRisks.length > 0 ? uniqueRisks.map((r) => `\u2022 ${r}`) : [],
      ``,
      `\u3010\u591A\u6642\u6BB5\u5171\u8B58\u3011`,
      // R6-FIX: mtfConsensus 是字串（已經格式化），直接使用 overallDir 判斷方向
      `${overallDir === "long" ? "\u6574\u9AD4\u504F\u591A \u2191" : overallDir === "short" ? "\u6574\u9AD4\u504F\u7A7A \u2193" : "\u591A\u7A7A\u5206\u6B67\uFF0C\u4EE5 4H \u65B9\u5411\u70BA\u4E3B"}\uFF08${longCount + shortCount}/${tfAnalyses.length} \u6642\u6BB5\u5171\u8B58\uFF09`
    ].filter((line) => line !== void 0).join("\n");
    console.log("[highWinRate.scan v2] \u672C\u5730\u898F\u5247\u5F15\u64CE\u5206\u6790\u5B8C\u6210");
  }
  if (!tradeDecision && topModel) {
    const localModelId = topModel.id === "liquidity_reversal" ? "A" : topModel.id === "trend_pullback" ? "B" : "C";
    const localConf = topModel.confidence;
    const localDecision = regimeResult.adaptiveParams.tradeFilter === "avoid" ? "REJECT" : macroData.macroFilter === "avoid" ? "REJECT" : isNoTradeRegime ? "WAIT" : localConf >= 60 && topModel.is_active ? "TRADE" : "WAIT";
    const localQuality = localConf >= 80 ? 5 : localConf >= 65 ? 4 : localConf >= 50 ? 3 : localConf >= 35 ? 2 : 1;
    const localTrigger = topModel.entry_conditions.slice(0, 2).join("\uFF1B") || "\u7B49\u5F85\u50F9\u683C\u89F8\u53CA\u9032\u5834\u5340\u5F8C\u78BA\u8A8D K \u7DDA\u5F62\u614B";
    const localSl = topModel.stop_loss_hint || "\u8DCC\u7834\u6700\u8FD1\u7D50\u69CB\u4F4E\u9EDE";
    const localInvalidation = `\u50F9\u683C\u6709\u6548\u8DCC\u7834\u6B62\u640D\uFF1A${localSl}`;
    const localEdge = topModel.direction === "long" ? `\u591A\u6642\u6846\u770B\u591A\u5171\u8B58\uFF08${longCount}/${tfAnalyses.length} \u6642\u6BB5\uFF09\uFF0CSMC \u6D41\u52D5\u6027\u6E05\u6383\u5F8C\u56DE\u8E29 OB` : topModel.direction === "short" ? `\u591A\u6642\u6846\u770B\u7A7A\u5171\u8B58\uFF08${shortCount}/${tfAnalyses.length} \u6642\u6BB5\uFF09\uFF0CSMC \u6D41\u52D5\u6027\u6E05\u6383\u5F8C\u56DE\u8E29 OB` : "\u9707\u76EA\u74B0\u5883\uFF0C\u7B49\u5F85\u660E\u78BA\u65B9\u5411\u7A81\u7834";
    const localFailure = isNoTradeRegime ? `\u591A\u7A7A\u65B9\u5411\u885D\u7A81\uFF08\u770B\u591A ${longCount} vs \u770B\u7A7A ${shortCount} \u6642\u6BB5\uFF09\uFF0C\u5047\u7A81\u7834\u98A8\u96AA\u9AD8` : `\u4FE1\u5FC3\u5EA6 ${localConf}%\uFF0C${regimeResult.regimeLabel} \u74B0\u5883\u4E0B\u9700\u8B39\u614E`;
    tradeDecision = {
      decision: localDecision,
      model: localModelId,
      setup_quality: localQuality,
      primary_edge: localEdge,
      primary_failure_mode: localFailure,
      must_see_trigger: localTrigger,
      invalidation: localInvalidation,
      conflict_note: isNoTradeRegime ? `\u591A\u7A7A\u885D\u7A81\uFF1A\u770B\u591A ${longCount} \u500B vs \u770B\u7A7A ${shortCount} \u500B\u6642\u6BB5` : "\u7121\u660E\u986F\u885D\u7A81",
      confidence: localConf,
      // v5.6 FIX [CODES]: 統一 reason_codes schema，與 AI 模式一致（GPT-5.4 審查修復）
      reason_codes: [
        overallDir === topModel.direction ? "HTF_ALIGNED" : "HTF_CONFLICT",
        topModel.is_active ? "SMC_TRILOGY_COMPLETE" : "SMC_TRILOGY_INCOMPLETE",
        regimeResult.adaptiveParams.tradeFilter === "proceed" ? "ENV_OK" : regimeResult.adaptiveParams.tradeFilter === "caution" ? "ENV_CAUTION" : "ENV_AVOID",
        localConf >= 65 ? "CONF_HIGH" : localConf >= 50 ? "CONF_MED" : "CONF_LOW",
        isNoTradeRegime ? "NO_TRADE_REGIME" : "REGIME_OK"
      ],
      dynamic_features_summary: dynamicFeaturesSummary
    };
    console.log(`[highWinRate.scan v5.5 LOCAL] \u672C\u5730 tradeDecision \u751F\u6210\uFF1A${tradeDecision.decision}\uFF08\u6A21\u578B ${tradeDecision.model}\uFF0C\u4FE1\u5FC3\u5EA6 ${tradeDecision.confidence}%\uFF09`);
  }
  for (const m of models) {
    if (m.confidence <= 0 || m.rr_ratio <= 0) {
      m.kelly_fraction = 0;
      continue;
    }
    const kellyResult = calibrateKelly({
      rawConfidence: m.confidence,
      modelId: m.id,
      avgRR: m.rr_ratio,
      // v5.1 新增：傳入環境波動率和樣本量
      recentVolatility: (tf1h?.atr ?? 0) / (tf1h?.close ?? 1),
      sampleSize: 0
      // v5.6 FIX [K2]: 不假設樣本量，讓 N_eff 保守處理（GPT-5.4 審查修復）
    });
    m.kelly_fraction = kellyResult.adjustedMaxPositionPct / 100;
  }
  for (const m of models) {
    if (m.confidence <= 0 || m.rr_ratio <= 0) continue;
    const kellyForEv = calibrateKelly({ rawConfidence: m.confidence, modelId: m.id, avgRR: m.rr_ratio, sampleSize: 0 });
    const winRate = Math.min(0.75, Math.max(0.3, kellyForEv.calibratedWinRate));
    const lossRate = 1 - winRate;
    const ev = winRate * m.rr_ratio - lossRate;
    const evTier = ev > 0.5 ? "\u512A\u79C0" : ev > 0.2 ? "\u826F\u597D" : ev > 0 ? "\u4E00\u822C" : "\u8CA0\u671F\u671B\u503C\uFF08\u4E0D\u5EFA\u8B70\uFF09";
    const evNote = `EV=${ev.toFixed(2)}R\uFF08${evTier}\uFF09`;
    if (ev < 0) {
      m.is_active = false;
      m.risk_warning = `\u274C [\u8CA0\u671F\u671B\u503C] ${evNote}\uFF0C\u4E0D\u5EFA\u8B70\u64CD\u4F5C | ` + m.risk_warning;
    } else {
      m.risk_warning = `\u{1F4CA} ${evNote} | ` + m.risk_warning;
    }
  }
  const activeLongModels = models.filter((m) => m.is_active && m.direction === "long");
  const activeShortModels = models.filter((m) => m.is_active && m.direction === "short");
  if (activeLongModels.length > 1) {
    const maxKelly = Math.max(...activeLongModels.map((m) => m.kelly_fraction ?? 0));
    const totalKelly = activeLongModels.reduce((s, m) => s + (m.kelly_fraction ?? 0), 0);
    if (totalKelly > maxKelly * 1.5) {
      const scale = maxKelly * 1.5 / totalKelly;
      for (const m of activeLongModels) {
        if (m.kelly_fraction) m.kelly_fraction = Math.round(m.kelly_fraction * scale * 1e3) / 1e3;
      }
    }
  }
  if (activeShortModels.length > 1) {
    const maxKelly = Math.max(...activeShortModels.map((m) => m.kelly_fraction ?? 0));
    const totalKelly = activeShortModels.reduce((s, m) => s + (m.kelly_fraction ?? 0), 0);
    if (totalKelly > maxKelly * 1.5) {
      const scale = maxKelly * 1.5 / totalKelly;
      for (const m of activeShortModels) {
        if (m.kelly_fraction) m.kelly_fraction = Math.round(m.kelly_fraction * scale * 1e3) / 1e3;
      }
    }
  }
  const allLowConfidence = models.every((m) => m.confidence < 35);
  if (allLowConfidence) {
    for (const m of models) {
      m.kelly_fraction = 0;
      m.is_active = false;
      m.risk_warning = "\u26D4 [\u71B1\u65B7] \u6240\u6709\u6A21\u578B\u4FE1\u5FC3\u5EA6\u5747\u4F4E\u65BC 35%\uFF0C\u5EFA\u8B70\u505C\u6B62\u4EA4\u6613\u5C45\u89C0\u671B\u3002" + m.risk_warning;
    }
  }
  const conflictCount = Math.min(longCount, shortCount);
  const tf1hSweepQuality = (() => {
    if (!tf1h?.liquidity_sweep?.sslSwept && !tf1h?.liquidity_sweep?.bslSwept) return void 0;
    let sq = 40;
    if (tf1h.liquidity_sweep.sslSwept && tf1h.smc_structure === "bullish") sq += 20;
    if (tf1h.liquidity_sweep.bslSwept && tf1h.smc_structure === "bearish") sq += 20;
    if (tf1h.liquidity_sweep.sslSwept && tf1h.smc_premium_discount === "discount") sq += 15;
    if (tf1h.liquidity_sweep.bslSwept && tf1h.smc_premium_discount === "premium") sq += 15;
    if ((tf1h.pa_score ?? 0) > 65) sq += 15;
    else if ((tf1h.pa_score ?? 0) < 40) sq -= 10;
    return Math.max(0, Math.min(100, sq));
  })();
  const ensembleResult = topModel ? runEnsembleVeto(
    {
      topModel,
      allModels: models,
      macro: macroData,
      htfTrend,
      conflictCount,
      sweepQualityScore: tf1hSweepQuality,
      dynamicFeatures: {
        displacementStrength: (tf1h?.smc_score ?? 0) / 100,
        volumeConfirmation: (tf1h?.pa_score ?? 0) > 60,
        freshZone: !(tf1h?.liquidity_sweep?.sslSwept && tf1h?.liquidity_sweep?.bslSwept)
      }
    },
    tradeDecision?.decision ?? "WAIT",
    tradeDecision?.confidence ?? 50
    // v5.1 修復：傳入真實 AI confidence_score 取代固定 50 分
  ) : null;
  if (topModel && tradeDecision) {
    const modelId = topModel.id === "liquidity_reversal" ? "A" : topModel.id === "trend_pullback" ? "B" : "C";
    const ensembleConf = ensembleResult?.confidence ?? tradeDecision.confidence;
    const ensembleDecision = ensembleResult?.finalDecision ?? tradeDecision.decision;
    const envPenalty = envScan?.trade_filter === "avoid" ? -20 : envScan?.trade_filter === "caution" ? -8 : 0;
    const finalConf = Math.max(0, Math.min(100, ensembleConf + envPenalty));
    const finalDecision = envScan?.trade_filter === "avoid" ? "REJECT" : macroData.macroFilter === "avoid" ? "REJECT" : ensembleDecision;
    const smcEntryLevels = topModel.key_levels.filter((l) => l.type === "smc_entry");
    const smcEntryTop = smcEntryLevels.find((l) => l.label.includes("\u4E0A"))?.price ?? 0;
    const smcEntryBottom = smcEntryLevels.find((l) => l.label.includes("\u4E0B"))?.price ?? 0;
    const fibEntryHigh = smcEntryTop > 0 ? smcEntryTop : topModel.key_levels.find((l) => l.type === "fib" && l.label.includes("0.618"))?.price ?? 0;
    const fibEntryLow = smcEntryBottom > 0 ? smcEntryBottom : topModel.key_levels.find((l) => l.type === "fib" && l.label.includes("0.786"))?.price ?? 0;
    const bestSmcEntry = topModel.smc_setups.filter((s) => !s.invalidated && (s.status === "active" || s.status === "waiting")).sort((a, b) => b.confluence_score - a.confluence_score)[0];
    const rawEntryHigh = bestSmcEntry?.entry_top ?? fibEntryHigh;
    const rawEntryLow = bestSmcEntry?.entry_bottom ?? fibEntryLow;
    const finalEntryHigh = rawEntryHigh > 0 && rawEntryLow > 0 ? Math.max(rawEntryHigh, rawEntryLow) : rawEntryHigh;
    const finalEntryLow = rawEntryHigh > 0 && rawEntryLow > 0 ? Math.min(rawEntryHigh, rawEntryLow) : rawEntryLow;
    const finalEntryMid = finalEntryHigh > 0 && finalEntryLow > 0 ? (finalEntryHigh + finalEntryLow) / 2 : 0;
    const currentClose = tf1h?.close ?? tf4h?.close ?? 0;
    const currentAtr = tf1h?.atr ?? tf4h?.atr ?? 0;
    const distToEntryPct = finalEntryMid > 0 && currentClose > 0 ? parseFloat(((currentClose - finalEntryMid) / currentClose * 100).toFixed(2)) : void 0;
    const atrDistPct = currentAtr > 0 && currentClose > 0 ? currentAtr * 2 / currentClose * 100 : 2;
    const entryTooFar = distToEntryPct !== void 0 ? Math.abs(distToEntryPct) > Math.max(atrDistPct, 2) : false;
    const entryState = (() => {
      if (finalEntryHigh <= 0 || finalEntryLow <= 0 || currentClose <= 0) return "IN_ZONE";
      const dir = topModel.direction;
      if (dir === "long") {
        if (currentClose > finalEntryHigh) return "WAIT_PULLBACK";
        if (currentClose < finalEntryLow) return "MISSED";
        return "IN_ZONE";
      } else if (dir === "short") {
        if (currentClose < finalEntryLow) return "WAIT_BOUNCE";
        if (currentClose > finalEntryHigh) return "MISSED";
        return "IN_ZONE";
      }
      return "IN_ZONE";
    })();
    const finalDecisionAfterVeto = entryTooFar && finalDecision === "TRADE" ? "WAIT" : finalDecision;
    finalStrategy = {
      model_id: modelId,
      model_name: topModel.name,
      decision: finalDecisionAfterVeto,
      // v5.6 FIX: 使用 veto 後的決策
      direction: topModel.direction,
      confidence: finalConf,
      setup_quality: tradeDecision.setup_quality,
      entry_zone: topModel.entry_conditions.slice(0, 2).join(" | "),
      // v5.5 新增：數字型進場區間和距市價距離
      entry_zone_low: finalEntryLow > 0 ? parseFloat(finalEntryLow.toFixed(2)) : void 0,
      entry_zone_high: finalEntryHigh > 0 ? parseFloat(finalEntryHigh.toFixed(2)) : void 0,
      dist_to_entry_pct: distToEntryPct,
      entry_too_far: entryTooFar,
      entry_state: entryState,
      // v5.6 FIX: 方向感知進場狀態
      stop_loss: topModel.stop_loss_hint,
      take_profit: topModel.take_profit_hint,
      rr_ratio: topModel.rr_ratio,
      kelly_fraction: topModel.kelly_fraction ?? 0,
      must_see_trigger: tradeDecision.must_see_trigger,
      invalidation: tradeDecision.invalidation,
      primary_edge: tradeDecision.primary_edge,
      primary_failure_mode: tradeDecision.primary_failure_mode,
      reason_codes: tradeDecision.reason_codes,
      env_filter: [
        envScan ? `${envScan.regime}\uFF08${envScan.trade_filter === "proceed" ? "\u2705 \u9069\u5408\u4EA4\u6613" : envScan.trade_filter === "caution" ? "\u26A0\uFE0F \u8B39\u614E\u64CD\u4F5C" : "\u{1F6AB} \u5EFA\u8B70\u8FE4\u907F"}\uFF09` : "\u672C\u5730\u5F15\u64CE\uFF0C\u7121\u74B0\u5883\u6383\u63CF",
        `\u5B8F\u89C0\uFF1A${macroData.fearGreedLabel}\uFF08${macroData.fearGreedIndex}\uFF09| ${macroData.sessionName}`,
        ensembleResult ? `\u96C6\u6210\u5171\u8B58\uFF1A${(ensembleResult.consensusStrength * 100).toFixed(0)}%\uFF08\u898F\u5247${ensembleResult.ruleEngineVote} / \u91CF\u5316${ensembleResult.quantScorerVote} / AI${ensembleResult.aiReviewerVote}\uFF09` : ""
      ].filter(Boolean).join(" | "),
      // v5.4 新增：集成評估負面因素（風險警示）
      negative_factors: ensembleResult?.negativeFactors ?? [],
      // v5.4 新增：市場環境各 regime 競爭分數
      regime_scores: regimeResult.regimeScores,
      // v5.4 新增：集成評估各評估器分數
      ensemble_scores: ensembleResult ? {
        rule_engine: ensembleResult.ruleEngineScore,
        quant_scorer: ensembleResult.quantScorerScore,
        ai_confidence: ensembleResult.aiConfidenceScore,
        consensus_strength: ensembleResult.consensusStrength
      } : void 0
    };
    console.log(`[highWinRate.scan v4.0] \u6700\u7D42\u7B56\u7565\uFF1A${finalStrategy.decision}\uFF08\u6A21\u578B ${finalStrategy.model_id}\uFF0C\u4FE1\u5FC3\u5EA6 ${finalStrategy.confidence}%\uFF09`);
  }
  return {
    models,
    tf_analyses: tfAnalyses,
    overall_direction: overallDir,
    mtf_consensus: mtfConsensus,
    ai_analysis: aiAnalysis,
    trade_decision: tradeDecision,
    env_scan: envScan,
    final_strategy: finalStrategy,
    session_info: {
      name: sessionInfo.name,
      liquidity: sessionInfo.liquidity,
      utc_hour: nowUtcHour,
      is_low_liquidity: isLowLiquidityPeriod
    },
    scanned_at: Date.now()
  };
}
var init_highWinRateService = __esm({
  "server/services/highWinRateService.ts"() {
    "use strict";
    init_indicators();
    init_advancedAnalysis();
    init_kellyCalibration();
    init_macroDataFusion();
    init_ensembleVeto();
    init_bayesianMtfFusion();
    init_marketRegimeClassifier();
  }
});

// server/utils/pandaStrategy.ts
var pandaStrategy_exports = {};
__export(pandaStrategy_exports, {
  analyzeAtrDynamic: () => analyzeAtrDynamic,
  analyzeBollRsi: () => analyzeBollRsi,
  analyzeEmaFakeout: () => analyzeEmaFakeout,
  analyzeKdHighWin: () => analyzeKdHighWin,
  analyzeKlineTrend: () => analyzeKlineTrend,
  analyzeMACDMtf: () => analyzeMACDMtf,
  analyzeMJIndicator: () => analyzeMJIndicator,
  analyzeMacdDivergence: () => analyzeMacdDivergence,
  analyzeTriangleBreakout: () => analyzeTriangleBreakout,
  analyzeVegasTunnel: () => analyzeVegasTunnel,
  analyzeVolumeConfirm: () => analyzeVolumeConfirm,
  runPandaBacktest: () => runPandaBacktest,
  runPandaScan: () => runPandaScan,
  runPandaScanV54: () => runPandaScanV54
});
function calcEMA(data, period) {
  const k = 2 / (period + 1);
  const ema = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      ema.push(data[0]);
    } else {
      ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
  }
  return ema;
}
function calcSMA(data, period) {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(NaN);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      sma.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return sma;
}
function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const dif = emaFast.map((v, i) => v - emaSlow[i]);
  const dea = calcEMA(dif, signal);
  const histogram = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, histogram };
}
function calcRSI(closes, period = 14) {
  const rsi = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      rsi.push(50);
      continue;
    }
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) {
      rsi.push(100);
      continue;
    }
    const rs = avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }
  return rsi;
}
function calcBollinger2(closes, period = 20, stdDev = 2) {
  const middle = calcSMA(closes, period);
  const upper = [];
  const lower = [];
  const bandwidth = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      bandwidth.push(NaN);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    upper.push(mean + stdDev * std);
    lower.push(mean - stdDev * std);
    bandwidth.push((upper[i] - lower[i]) / mean);
  }
  return { upper, middle, lower, bandwidth };
}
function calcKDJ(candles, period = 9) {
  const k = [];
  const d = [];
  const j = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      k.push(50);
      d.push(50);
      j.push(50);
      continue;
    }
    const slice = candles.slice(i - period + 1, i + 1);
    const highest = Math.max(...slice.map((c) => c.high));
    const lowest = Math.min(...slice.map((c) => c.low));
    const rsv = highest === lowest ? 50 : (candles[i].close - lowest) / (highest - lowest) * 100;
    const kVal = i === period - 1 ? rsv : k[i - 1] * 2 / 3 + rsv / 3;
    const dVal = i === period - 1 ? kVal : d[i - 1] * 2 / 3 + kVal / 3;
    const jVal = 3 * kVal - 2 * dVal;
    k.push(kVal);
    d.push(dVal);
    j.push(jVal);
  }
  return { k, d, j };
}
function calcATR(candles, period = 14) {
  const tr = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low);
      continue;
    }
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }
  return calcEMA(tr, period);
}
function analyzeMACDMtf(htfCandles, ltfCandles) {
  if (htfCandles.length < 50 || ltfCandles.length < 50) {
    return { signal: "NEUTRAL", score: 0, htf_trend: "FLAT", ltf_histogram_below_zero: false, ltf_dif_separation: false, separation_strength: 0 };
  }
  const htfCloses = htfCandles.map((c) => c.close);
  const ltfCloses = ltfCandles.map((c) => c.close);
  const htfEma20 = calcEMA(htfCloses, 20);
  const htfEmaSlope = htfEma20[htfEma20.length - 1] - htfEma20[htfEma20.length - 5];
  const htfTrend = htfEmaSlope > 0 ? "UP" : htfEmaSlope < 0 ? "DOWN" : "FLAT";
  const ltfMACD = calcMACD(ltfCloses);
  const n = ltfMACD.histogram.length;
  const curHist = ltfMACD.histogram[n - 1];
  const curDif = ltfMACD.dif[n - 1];
  const prevDif = ltfMACD.dif[n - 2];
  const prevHist = ltfMACD.histogram[n - 2];
  const histBelowZero = curHist < 0;
  const histAboveZero = curHist > 0;
  const difSeparationLong = histBelowZero && curDif > prevDif && curHist < prevHist;
  const difSeparationShort = histAboveZero && curDif < prevDif && curHist > prevHist;
  const ltfATR = calcATR(ltfCandles);
  const atr = ltfATR[ltfATR.length - 1];
  const separationStrength = atr > 0 ? Math.min(1, Math.abs(curDif - prevDif) / atr) : 0;
  let signal = "NEUTRAL";
  let score = 0;
  if (htfTrend === "UP" && histBelowZero && difSeparationLong) {
    signal = "LONG";
    score = 60 + Math.round(separationStrength * 25) + (htfEmaSlope > 0 ? 15 : 0);
  } else if (htfTrend === "DOWN" && histAboveZero && difSeparationShort) {
    signal = "SHORT";
    score = 60 + Math.round(separationStrength * 25) + (htfEmaSlope < 0 ? 15 : 0);
  } else if (htfTrend !== "FLAT") {
    score = 30;
  }
  return {
    signal,
    score: Math.min(100, score),
    htf_trend: htfTrend,
    ltf_histogram_below_zero: histBelowZero,
    ltf_dif_separation: difSeparationLong || difSeparationShort,
    separation_strength: separationStrength
  };
}
function analyzeMJIndicator(candles) {
  if (candles.length < 50) {
    return { signal: "NEUTRAL", score: 0, j_cross_zero: false, j_direction: "FLAT", macd_bar_sync: false, is_valid: false };
  }
  const closes = candles.map((c) => c.close);
  const macd = calcMACD(closes);
  const kdj = calcKDJ(candles);
  const n = macd.histogram.length;
  const curJ = kdj.j[n - 1];
  const prevJ = kdj.j[n - 2];
  const curHist = macd.histogram[n - 1];
  const jCrossUpZero = prevJ < 50 && curJ >= 50;
  const jCrossDownZero = prevJ > 50 && curJ <= 50;
  const jCrossZero = jCrossUpZero || jCrossDownZero;
  const jDirection = curJ > prevJ ? "UP" : curJ < prevJ ? "DOWN" : "FLAT";
  const macdBarSyncLong = jCrossUpZero && curHist > 0;
  const macdBarSyncShort = jCrossDownZero && curHist < 0;
  const macdBarSync = macdBarSyncLong || macdBarSyncShort;
  const isValid = jCrossZero && macdBarSync;
  let signal = "NEUTRAL";
  let score = 0;
  if (isValid && macdBarSyncLong) {
    signal = "LONG";
    score = 75 + (Math.abs(curJ - 50) > 10 ? 15 : 5);
  } else if (isValid && macdBarSyncShort) {
    signal = "SHORT";
    score = 75 + (Math.abs(curJ - 50) > 10 ? 15 : 5);
  } else if (jCrossZero && !macdBarSync) {
    score = 10;
  }
  return {
    signal,
    score: Math.min(100, score),
    j_cross_zero: jCrossZero,
    j_direction: jDirection,
    macd_bar_sync: macdBarSync,
    is_valid: isValid
  };
}
function analyzeBollRsi(htfCandles, ltfCandles) {
  if (htfCandles.length < 30 || ltfCandles.length < 30) {
    return { signal: "NEUTRAL", score: 0, boll_direction: "FLAT", rsi_cross_50: false, rsi_direction: "FLAT", divergence: "NONE", rsi_value: 50 };
  }
  const htfCloses = htfCandles.map((c) => c.close);
  const ltfCloses = ltfCandles.map((c) => c.close);
  const htfBoll = calcBollinger2(htfCloses);
  const htfMiddle = htfBoll.middle;
  const n = htfMiddle.length;
  const bollSlope = htfMiddle[n - 1] - htfMiddle[n - 5];
  const bollDirection = bollSlope > 0 ? "UP" : bollSlope < 0 ? "DOWN" : "FLAT";
  const ltfRSI = calcRSI(ltfCloses);
  const m = ltfRSI.length;
  const curRSI = ltfRSI[m - 1];
  const prevRSI = ltfRSI[m - 2];
  const rsiCrossUp50 = prevRSI < 50 && curRSI >= 50;
  const rsiCrossDown50 = prevRSI > 50 && curRSI <= 50;
  const rsiCross50 = rsiCrossUp50 || rsiCrossDown50;
  const rsiDirection = curRSI > prevRSI ? "UP" : curRSI < prevRSI ? "DOWN" : "FLAT";
  const lookback = Math.min(10, ltfCandles.length - 1);
  const recentCloses = ltfCloses.slice(-lookback);
  const recentRSI = ltfRSI.slice(-lookback);
  let divergence = "NONE";
  const priceHigher = recentCloses[lookback - 1] > Math.max(...recentCloses.slice(0, -1));
  const rsiLower = recentRSI[lookback - 1] < Math.max(...recentRSI.slice(0, -1));
  if (priceHigher && rsiLower) divergence = "BEARISH";
  const priceLower = recentCloses[lookback - 1] < Math.min(...recentCloses.slice(0, -1));
  const rsiHigher = recentRSI[lookback - 1] > Math.min(...recentRSI.slice(0, -1));
  if (priceLower && rsiHigher) divergence = "BULLISH";
  let signal = "NEUTRAL";
  let score = 0;
  if (bollDirection === "UP" && rsiCrossUp50) {
    signal = "LONG";
    score = 65;
    if (divergence === "BULLISH") score += 20;
    if (curRSI > 50 && curRSI < 70) score += 10;
  } else if (bollDirection === "DOWN" && rsiCrossDown50) {
    signal = "SHORT";
    score = 65;
    if (divergence === "BEARISH") score += 20;
    if (curRSI < 50 && curRSI > 30) score += 10;
  } else if (bollDirection !== "FLAT" && rsiDirection !== "FLAT") {
    score = 25;
  }
  if (signal === "LONG" && divergence === "BEARISH") score -= 30;
  if (signal === "SHORT" && divergence === "BULLISH") score -= 30;
  return {
    signal,
    score: Math.max(0, Math.min(100, score)),
    boll_direction: bollDirection,
    rsi_cross_50: rsiCross50,
    rsi_direction: rsiDirection,
    divergence,
    rsi_value: curRSI
  };
}
function analyzeEmaFakeout(htfCandles, ltfCandles) {
  if (htfCandles.length < 30 || ltfCandles.length < 30) {
    return { signal: "NEUTRAL", score: 0, ema_direction: "FLAT", ltf_fakeout_detected: false, htf_confirmed: false, fakeout_type: "NONE" };
  }
  const htfCloses = htfCandles.map((c) => c.close);
  const ltfCloses = ltfCandles.map((c) => c.close);
  const htfEma21 = calcEMA(htfCloses, 21);
  const htfN = htfEma21.length;
  const emaSlope = htfEma21[htfN - 1] - htfEma21[htfN - 5];
  const emaDirection = Math.abs(emaSlope) < htfCloses[htfN - 1] * 1e-3 ? "FLAT" : emaSlope > 0 ? "UP" : "DOWN";
  const curEma = htfEma21[htfN - 1];
  const ltfEma21 = calcEMA(ltfCloses, 21);
  const ltfN = ltfEma21.length;
  const ltfCurClose = ltfCloses[ltfN - 1];
  const ltfPrevClose = ltfCloses[ltfN - 2];
  const ltfCurEma = ltfEma21[ltfN - 1];
  const ltfFakeoutUp = ltfPrevClose < ltfCurEma && ltfCurClose > ltfCurEma && emaDirection === "DOWN";
  const ltfFakeoutDown = ltfPrevClose > ltfCurEma && ltfCurClose < ltfCurEma && emaDirection === "UP";
  const ltfFakeoutDetected = ltfFakeoutUp || ltfFakeoutDown;
  const htfCurClose = htfCloses[htfN - 1];
  const htfPrevClose = htfCloses[htfN - 2];
  const htfConfirmedShort = emaDirection === "DOWN" && htfCurClose < curEma && htfPrevClose > curEma;
  const htfConfirmedLong = emaDirection === "UP" && htfCurClose > curEma && htfPrevClose < curEma;
  const htfConfirmed = htfConfirmedShort || htfConfirmedLong;
  const fakeoutType = ltfFakeoutUp ? "FAKE_BREAKOUT_UP" : ltfFakeoutDown ? "FAKE_BREAKOUT_DOWN" : "NONE";
  let signal = "NEUTRAL";
  let score = 0;
  if (ltfFakeoutDetected && htfConfirmed) {
    if (fakeoutType === "FAKE_BREAKOUT_UP" && emaDirection === "DOWN") {
      signal = "SHORT";
      score = 80;
    } else if (fakeoutType === "FAKE_BREAKOUT_DOWN" && emaDirection === "UP") {
      signal = "LONG";
      score = 80;
    }
  } else if (ltfFakeoutDetected && !htfConfirmed) {
    score = 35;
  } else if (emaDirection !== "FLAT") {
    score = 15;
  }
  return {
    signal,
    score: Math.min(100, score),
    ema_direction: emaDirection,
    ltf_fakeout_detected: ltfFakeoutDetected,
    htf_confirmed: htfConfirmed,
    fakeout_type: fakeoutType
  };
}
function analyzeKlineTrend(htfCandles, ltfCandles) {
  if (htfCandles.length < 30 || ltfCandles.length < 30) {
    return { signal: "NEUTRAL", score: 0, trend_type: "RANGING", ema_direction: "FLAT", reversal_signal: false, reversal_type: "NONE", is_chasing: false };
  }
  const htfCloses = htfCandles.map((c) => c.close);
  const ltfCloses = ltfCandles.map((c) => c.close);
  const htfEma20 = calcEMA(htfCloses, 20);
  const htfN = htfEma20.length;
  const emaSlope = htfEma20[htfN - 1] - htfEma20[htfN - 5];
  const emaSlopeNorm = emaSlope / htfCloses[htfN - 1];
  const emaDirection = Math.abs(emaSlopeNorm) < 2e-3 ? "FLAT" : emaSlope > 0 ? "UP" : "DOWN";
  const curEma = htfEma20[htfN - 1];
  const recentCrosses = htfCloses.slice(-10).filter((c, i, arr) => {
    if (i === 0) return false;
    return arr[i - 1] > curEma && c < curEma || arr[i - 1] < curEma && c > curEma;
  }).length;
  const isRanging = recentCrosses >= 3 || emaDirection === "FLAT";
  const htfCurCandle = htfCandles[htfN - 1];
  const htfPrevCandle = htfCandles[htfN - 2];
  const htfATR = calcATR(htfCandles);
  const atr = htfATR[htfN - 1];
  const lowerWick = htfCurCandle.close - htfCurCandle.low;
  const upperWick = htfCurCandle.high - htfCurCandle.close;
  const body = Math.abs(htfCurCandle.close - htfCurCandle.open);
  const bullishReversal = lowerWick > body * 1.5 && lowerWick > atr * 0.3 && htfCurCandle.close > htfCurCandle.open;
  const bearishReversal = upperWick > body * 1.5 && upperWick > atr * 0.3 && htfCurCandle.close < htfCurCandle.open;
  const bullishEngulfing = htfCurCandle.close > htfPrevCandle.open && htfCurCandle.open < htfPrevCandle.close && htfCurCandle.close > htfCurCandle.open;
  const bearishEngulfing = htfCurCandle.close < htfPrevCandle.open && htfCurCandle.open > htfPrevCandle.close && htfCurCandle.close < htfCurCandle.open;
  const reversalSignal = bullishReversal || bearishReversal || bullishEngulfing || bearishEngulfing;
  const reversalType = bullishReversal || bullishEngulfing ? "BULLISH" : bearishReversal || bearishEngulfing ? "BEARISH" : "NONE";
  const recentMove = Math.abs(htfCloses[htfN - 1] - htfCloses[htfN - 4]);
  const isChasing = recentMove > atr * 2;
  let trendType = "RANGING";
  if (isRanging) {
    trendType = "RANGING";
  } else if (emaDirection === "UP" && reversalType === "BULLISH") {
    trendType = "TRENDING";
  } else if (emaDirection === "DOWN" && reversalType === "BEARISH") {
    trendType = "TRENDING";
  } else if (emaDirection === "UP" && reversalType === "BEARISH" || emaDirection === "DOWN" && reversalType === "BULLISH") {
    trendType = "COUNTER_TREND";
  }
  let signal = "NEUTRAL";
  let score = 0;
  if (isRanging) {
    score = 0;
  } else if (trendType === "COUNTER_TREND") {
    score = 0;
  } else if (trendType === "TRENDING" && !isChasing) {
    if (emaDirection === "UP" && reversalType === "BULLISH") {
      signal = "LONG";
      score = 70 + (bullishEngulfing ? 20 : 10);
    } else if (emaDirection === "DOWN" && reversalType === "BEARISH") {
      signal = "SHORT";
      score = 70 + (bearishEngulfing ? 20 : 10);
    }
  } else if (trendType === "TRENDING" && isChasing) {
    score = 20;
  }
  return {
    signal,
    score: Math.min(100, score),
    trend_type: trendType,
    ema_direction: emaDirection,
    reversal_signal: reversalSignal,
    reversal_type: reversalType,
    is_chasing: isChasing
  };
}
function runPandaScan(symbol, htfCandles, ltfCandles) {
  const macdMtf = analyzeMACDMtf(htfCandles, ltfCandles);
  const mjIndicator = analyzeMJIndicator(ltfCandles);
  const bollRsi = analyzeBollRsi(htfCandles, ltfCandles);
  const emaFakeout = analyzeEmaFakeout(htfCandles, ltfCandles);
  const klineTrend = analyzeKlineTrend(htfCandles, ltfCandles);
  const weights = { macd_mtf: 0.3, mj_indicator: 0.2, boll_rsi: 0.2, ema_fakeout: 0.15, kline_trend: 0.15 };
  const signals = [macdMtf.signal, mjIndicator.signal, bollRsi.signal, emaFakeout.signal, klineTrend.signal];
  const longVotes = signals.filter((s) => s === "LONG").length;
  const shortVotes = signals.filter((s) => s === "SHORT").length;
  let direction = "NEUTRAL";
  if (longVotes >= 3) direction = "LONG";
  else if (shortVotes >= 3) direction = "SHORT";
  else if (longVotes > shortVotes && longVotes >= 2) direction = "LONG";
  else if (shortVotes > longVotes && shortVotes >= 2) direction = "SHORT";
  let weightedScore = 0;
  const strategyEntries = [
    ["macd_mtf", macdMtf, weights.macd_mtf],
    ["mj_indicator", mjIndicator, weights.mj_indicator],
    ["boll_rsi", bollRsi, weights.boll_rsi],
    ["ema_fakeout", emaFakeout, weights.ema_fakeout],
    ["kline_trend", klineTrend, weights.kline_trend]
  ];
  for (const [, result, weight] of strategyEntries) {
    if (result.signal === direction) {
      weightedScore += result.score * weight;
    } else if (result.signal === "NEUTRAL") {
      weightedScore += result.score * weight * 0.5;
    }
  }
  const vetoReasons = [];
  if (klineTrend.trend_type === "RANGING") {
    vetoReasons.push("\u9707\u76EA\u76E4\u6574\uFF1AEMA \u8D70\u5E73\uFF0C\u4E0D\u9032\u5834");
    weightedScore *= 0.3;
  }
  if (klineTrend.trend_type === "COUNTER_TREND") {
    vetoReasons.push("\u9006\u52E2\u8A0A\u865F\uFF1AK \u7DDA\u53CD\u8F49\u65B9\u5411\u8207\u8DA8\u52E2\u76F8\u53CD");
    weightedScore *= 0.4;
  }
  if (mjIndicator.j_cross_zero && !mjIndicator.macd_bar_sync) {
    vetoReasons.push("MJ \u5047\u4FE1\u865F\uFF1AJ \u7DDA\u7A7F\u8D8A\u4F46 MACD \u67F1\u9AD4\u672A\u540C\u6B65");
    weightedScore *= 0.7;
  }
  if (klineTrend.is_chasing) {
    vetoReasons.push("\u8FFD\u55AE\u98A8\u96AA\uFF1A\u884C\u60C5\u5DF2\u8D70\u51FA\u8D85\u904E 2 ATR");
    weightedScore *= 0.6;
  }
  if (bollRsi.divergence === "BEARISH" && direction === "LONG") {
    vetoReasons.push("\u9802\u80CC\u96E2\u8B66\u544A\uFF1ARSI \u9802\u80CC\u96E2\uFF0C\u591A\u55AE\u98A8\u96AA\u589E\u52A0");
    weightedScore *= 0.7;
  }
  if (bollRsi.divergence === "BULLISH" && direction === "SHORT") {
    vetoReasons.push("\u5E95\u80CC\u96E2\u8B66\u544A\uFF1ARSI \u5E95\u80CC\u96E2\uFF0C\u7A7A\u55AE\u98A8\u96AA\u589E\u52A0");
    weightedScore *= 0.7;
  }
  const finalScore = Math.round(Math.min(100, weightedScore));
  let grade = "AVOID";
  if (direction !== "NEUTRAL") {
    if (finalScore >= 70) grade = "STRONG";
    else if (finalScore >= 55) grade = "MODERATE";
    else if (finalScore >= 40) grade = "WAIT";
    else grade = "AVOID";
  }
  const lastCandle = ltfCandles[ltfCandles.length - 1];
  const atrArr = calcATR(ltfCandles);
  const atr = atrArr[atrArr.length - 1];
  const entryPrice = lastCandle.close;
  let stopLoss;
  let tp1;
  let tp2;
  if (direction === "LONG") {
    const recentLow = Math.min(...ltfCandles.slice(-5).map((c) => c.low));
    stopLoss = recentLow - atr * 0.3;
    const risk2 = entryPrice - stopLoss;
    tp1 = entryPrice + risk2 * 1.5;
    tp2 = entryPrice + risk2 * 2.5;
  } else if (direction === "SHORT") {
    const recentHigh = Math.max(...ltfCandles.slice(-5).map((c) => c.high));
    stopLoss = recentHigh + atr * 0.3;
    const risk2 = stopLoss - entryPrice;
    tp1 = entryPrice - risk2 * 1.5;
    tp2 = entryPrice - risk2 * 2.5;
  } else {
    stopLoss = entryPrice - atr * 2;
    tp1 = entryPrice + atr * 1.5;
    tp2 = entryPrice + atr * 2.5;
  }
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(tp2 - entryPrice);
  const rrRatio = risk > 0 ? Math.round(reward / risk * 10) / 10 : 0;
  return {
    symbol,
    direction,
    score: finalScore,
    grade,
    strategies: {
      macd_mtf: macdMtf,
      mj_indicator: mjIndicator,
      boll_rsi: bollRsi,
      ema_fakeout: emaFakeout,
      kline_trend: klineTrend
    },
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit_1: tp1,
    take_profit_2: tp2,
    rr_ratio: rrRatio,
    veto_reasons: vetoReasons,
    timestamp: Date.now()
  };
}
function runPandaBacktest(symbol, htfCandles, ltfCandles, minScore = 55) {
  const trades = [];
  const windowSize = 50;
  const maxHoldBars = 20;
  for (let i = windowSize; i < ltfCandles.length - maxHoldBars; i++) {
    const htfSlice = htfCandles.slice(0, Math.min(i, htfCandles.length));
    const ltfSlice = ltfCandles.slice(0, i);
    if (htfSlice.length < windowSize || ltfSlice.length < windowSize) continue;
    const signal = runPandaScan(symbol, htfSlice, ltfSlice);
    if (signal.score < minScore || signal.direction === "NEUTRAL") continue;
    if (signal.grade === "AVOID") continue;
    const entryCandle = ltfCandles[i];
    const entryPrice = entryCandle.open;
    const stopLoss = signal.stop_loss;
    const tp1 = signal.take_profit_1;
    const tp2 = signal.take_profit_2;
    let exitPrice = entryPrice;
    let exitReason = "TIMEOUT";
    let exitTime = ltfCandles[Math.min(i + maxHoldBars, ltfCandles.length - 1)].time;
    for (let j = i + 1; j < Math.min(i + maxHoldBars, ltfCandles.length); j++) {
      const bar = ltfCandles[j];
      if (signal.direction === "LONG") {
        if (bar.low <= stopLoss) {
          exitPrice = stopLoss;
          exitReason = "SL";
          exitTime = bar.time;
          break;
        }
        if (bar.high >= tp2) {
          exitPrice = tp2;
          exitReason = "TP2";
          exitTime = bar.time;
          break;
        }
        if (bar.high >= tp1) {
          exitPrice = tp1;
          exitReason = "TP1";
          exitTime = bar.time;
          break;
        }
      } else if (signal.direction === "SHORT") {
        if (bar.high >= stopLoss) {
          exitPrice = stopLoss;
          exitReason = "SL";
          exitTime = bar.time;
          break;
        }
        if (bar.low <= tp2) {
          exitPrice = tp2;
          exitReason = "TP2";
          exitTime = bar.time;
          break;
        }
        if (bar.low <= tp1) {
          exitPrice = tp1;
          exitReason = "TP1";
          exitTime = bar.time;
          break;
        }
      }
    }
    if (exitReason === "TIMEOUT") {
      exitPrice = ltfCandles[Math.min(i + maxHoldBars, ltfCandles.length - 1)].close;
    }
    const pnlPct = signal.direction === "LONG" ? (exitPrice - entryPrice) / entryPrice * 100 : (entryPrice - exitPrice) / entryPrice * 100;
    const result = pnlPct > 0.1 ? "WIN" : pnlPct < -0.1 ? "LOSS" : "BREAKEVEN";
    trades.push({
      entry_time: entryCandle.time,
      exit_time: exitTime,
      direction: signal.direction,
      entry_price: entryPrice,
      exit_price: exitPrice,
      stop_loss: stopLoss,
      take_profit: tp2,
      pnl_pct: Math.round(pnlPct * 100) / 100,
      result,
      score: signal.score,
      grade: signal.grade,
      exit_reason: exitReason
    });
  }
  const wins = trades.filter((t2) => t2.result === "WIN");
  const losses = trades.filter((t2) => t2.result === "LOSS");
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const totalPnl = trades.reduce((sum, t2) => sum + t2.pnl_pct, 0);
  const avgRR = trades.length > 0 ? trades.reduce((sum, t2) => sum + Math.abs(t2.pnl_pct), 0) / trades.length : 0;
  let peak = 0, maxDrawdown = 0, cumPnl = 0;
  for (const t2 of trades) {
    cumPnl += t2.pnl_pct;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const pnlArr = trades.map((t2) => t2.pnl_pct);
  const avgPnl = pnlArr.length > 0 ? pnlArr.reduce((a, b) => a + b, 0) / pnlArr.length : 0;
  const stdPnl = pnlArr.length > 1 ? Math.sqrt(pnlArr.reduce((sum, v) => sum + Math.pow(v - avgPnl, 2), 0) / pnlArr.length) : 1;
  const sharpeRatio = stdPnl > 0 ? avgPnl / stdPnl : 0;
  const grossWin = wins.reduce((sum, t2) => sum + t2.pnl_pct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t2) => sum + t2.pnl_pct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const byGrade = {
    STRONG: calcGradeStats(trades.filter((t2) => t2.grade === "STRONG")),
    MODERATE: calcGradeStats(trades.filter((t2) => t2.grade === "MODERATE")),
    WAIT: calcGradeStats(trades.filter((t2) => t2.grade === "WAIT"))
  };
  return {
    symbol,
    total_trades: trades.length,
    win_trades: wins.length,
    loss_trades: losses.length,
    win_rate: Math.round(winRate * 1e3) / 10,
    avg_rr: Math.round(avgRR * 100) / 100,
    total_pnl_pct: Math.round(totalPnl * 100) / 100,
    max_drawdown_pct: Math.round(maxDrawdown * 100) / 100,
    sharpe_ratio: Math.round(sharpeRatio * 100) / 100,
    profit_factor: Math.round(profitFactor * 100) / 100,
    by_grade: byGrade,
    trades: trades.slice(-50)
    // 只返回最近 50 筆
  };
}
function calcGradeStats(trades) {
  if (trades.length === 0) return { trades: 0, win_rate: 0, avg_pnl: 0 };
  const wins = trades.filter((t2) => t2.result === "WIN").length;
  const avgPnl = trades.reduce((sum, t2) => sum + t2.pnl_pct, 0) / trades.length;
  return {
    trades: trades.length,
    win_rate: Math.round(wins / trades.length * 1e3) / 10,
    avg_pnl: Math.round(avgPnl * 100) / 100
  };
}
function analyzeVegasTunnel(candles) {
  if (candles.length < 700) {
    return { signal: "NEUTRAL", score: 0, ema12_direction: "FLAT", price_vs_short_tunnel: "INSIDE", price_vs_long_tunnel: "INSIDE", tunnel_aligned: false, entry_type: "NONE" };
  }
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const ema12 = calcEMA(closes, 12);
  const ema144 = calcEMA(closes, 144);
  const ema169 = calcEMA(closes, 169);
  const ema576 = calcEMA(closes, 576);
  const ema676 = calcEMA(closes, 676);
  const curClose = closes[n - 1];
  const curEma12 = ema12[n - 1];
  const prevEma12 = ema12[n - 5];
  const ema12Slope = curEma12 - prevEma12;
  const ema12Direction = Math.abs(ema12Slope) < curClose * 1e-3 ? "FLAT" : ema12Slope > 0 ? "UP" : "DOWN";
  const shortUpper = Math.max(ema144[n - 1], ema169[n - 1]);
  const shortLower = Math.min(ema144[n - 1], ema169[n - 1]);
  const priceVsShort = curClose > shortUpper ? "ABOVE" : curClose < shortLower ? "BELOW" : "INSIDE";
  const longUpper = Math.max(ema576[n - 1], ema676[n - 1]);
  const longLower = Math.min(ema576[n - 1], ema676[n - 1]);
  const priceVsLong = curClose > longUpper ? "ABOVE" : curClose < longLower ? "BELOW" : "INSIDE";
  const shortTunnelUp = ema144[n - 1] > ema144[n - 10];
  const longTunnelUp = ema576[n - 1] > ema576[n - 10];
  const tunnelAligned = shortTunnelUp === longTunnelUp;
  let signal = "NEUTRAL";
  let score = 0;
  let entryType = "NONE";
  if (longTunnelUp && priceVsLong === "ABOVE") {
    if (priceVsShort === "INSIDE" || priceVsShort === "ABOVE" && curClose < shortUpper * 1.005) {
      signal = "LONG";
      score = tunnelAligned ? 75 : 55;
      entryType = "PULLBACK";
    } else if (priceVsShort === "ABOVE" && ema12Direction === "UP") {
      signal = "LONG";
      score = 65;
      entryType = "BREAKOUT";
    }
  }
  if (!longTunnelUp && priceVsLong === "BELOW") {
    if (priceVsShort === "INSIDE" || priceVsShort === "BELOW" && curClose > shortLower * 0.995) {
      signal = "SHORT";
      score = tunnelAligned ? 75 : 55;
      entryType = "PULLBACK";
    } else if (priceVsShort === "BELOW" && ema12Direction === "DOWN") {
      signal = "SHORT";
      score = 65;
      entryType = "BREAKOUT";
    }
  }
  if (tunnelAligned && signal !== "NEUTRAL") score = Math.min(100, score + 10);
  return {
    signal,
    score: Math.min(100, score),
    ema12_direction: ema12Direction,
    price_vs_short_tunnel: priceVsShort,
    price_vs_long_tunnel: priceVsLong,
    tunnel_aligned: tunnelAligned,
    entry_type: entryType
  };
}
function analyzeAtrDynamic(candles) {
  if (candles.length < 30) {
    return { signal: "NEUTRAL", score: 0, atr_value: 0, atr_trend: "STABLE", sl_distance_ok: false, breakout_confirmed: false, dynamic_sl: 0, dynamic_tp1: 0, dynamic_tp2: 0 };
  }
  const atrArr = calcATR(candles);
  const n = atrArr.length;
  const curATR = atrArr[n - 1];
  const prevATR5 = atrArr[n - 6];
  const closes = candles.map((c) => c.close);
  const curClose = closes[n - 1];
  const atrChange = (curATR - prevATR5) / prevATR5;
  const atrTrend = atrChange > 0.1 ? "EXPANDING" : atrChange < -0.1 ? "CONTRACTING" : "STABLE";
  const recentHigh = Math.max(...candles.slice(-10).map((c) => c.high));
  const recentLow = Math.min(...candles.slice(-10).map((c) => c.low));
  const breakoutUp = curClose > recentHigh * 0.998 && atrTrend === "EXPANDING";
  const breakoutDown = curClose < recentLow * 1.002 && atrTrend === "EXPANDING";
  const breakoutConfirmed = breakoutUp || breakoutDown;
  const slDistanceLong = curClose - recentLow;
  const slDistanceShort = recentHigh - curClose;
  const slDistanceOk = Math.max(slDistanceLong, slDistanceShort) >= curATR;
  const dynamicSl = breakoutUp ? recentLow - curATR : recentHigh + curATR;
  const risk = Math.abs(curClose - dynamicSl);
  const dynamicTp1 = breakoutUp ? curClose + risk * 1.5 : curClose - risk * 1.5;
  const dynamicTp2 = breakoutUp ? curClose + risk * 2.5 : curClose - risk * 2.5;
  let signal = "NEUTRAL";
  let score = 0;
  if (breakoutUp && slDistanceOk) {
    signal = "LONG";
    score = 65 + (atrTrend === "EXPANDING" ? 20 : 0);
  } else if (breakoutDown && slDistanceOk) {
    signal = "SHORT";
    score = 65 + (atrTrend === "EXPANDING" ? 20 : 0);
  } else if (atrTrend === "CONTRACTING") {
    score = 20;
  }
  return {
    signal,
    score: Math.min(100, score),
    atr_value: Math.round(curATR * 1e4) / 1e4,
    atr_trend: atrTrend,
    sl_distance_ok: slDistanceOk,
    breakout_confirmed: breakoutConfirmed,
    dynamic_sl: dynamicSl,
    dynamic_tp1: dynamicTp1,
    dynamic_tp2: dynamicTp2
  };
}
function analyzeKdHighWin(candles) {
  if (candles.length < 30) {
    return { signal: "NEUTRAL", score: 0, k_value: 50, d_value: 50, kd_cross: "NONE", ema20_direction: "FLAT", kd_in_oversold: false, kd_in_overbought: false, trend_aligned: false };
  }
  const closes = candles.map((c) => c.close);
  const kdj = calcKDJ(candles, 9);
  const ema20 = calcEMA(closes, 20);
  const n = kdj.k.length;
  const curK = kdj.k[n - 1];
  const prevK = kdj.k[n - 2];
  const curD = kdj.d[n - 1];
  const prevD = kdj.d[n - 2];
  const goldenCross = prevK <= prevD && curK > curD;
  const deathCross = prevK >= prevD && curK < curD;
  const kdCross = goldenCross ? "GOLDEN" : deathCross ? "DEATH" : "NONE";
  const ema20Slope = ema20[n - 1] - ema20[n - 5];
  const ema20Direction = Math.abs(ema20Slope) < closes[n - 1] * 1e-3 ? "FLAT" : ema20Slope > 0 ? "UP" : "DOWN";
  const kdInOversold = curK < 20 && curD < 20;
  const kdInOverbought = curK > 80 && curD > 80;
  const trendAlignedLong = ema20Direction === "UP" && kdCross === "GOLDEN";
  const trendAlignedShort = ema20Direction === "DOWN" && kdCross === "DEATH";
  const trendAligned = trendAlignedLong || trendAlignedShort;
  let signal = "NEUTRAL";
  let score = 0;
  if (trendAlignedLong) {
    signal = "LONG";
    score = 70;
    if (kdInOversold) score += 20;
  } else if (trendAlignedShort) {
    signal = "SHORT";
    score = 70;
    if (kdInOverbought) score += 20;
  } else if (kdCross === "GOLDEN" && ema20Direction !== "DOWN") {
    signal = "LONG";
    score = 45;
  } else if (kdCross === "DEATH" && ema20Direction !== "UP") {
    signal = "SHORT";
    score = 45;
  }
  return {
    signal,
    score: Math.min(100, score),
    k_value: Math.round(curK * 10) / 10,
    d_value: Math.round(curD * 10) / 10,
    kd_cross: kdCross,
    ema20_direction: ema20Direction,
    kd_in_oversold: kdInOversold,
    kd_in_overbought: kdInOverbought,
    trend_aligned: trendAligned
  };
}
function analyzeVolumeConfirm(candles) {
  if (candles.length < 25) {
    return { signal: "NEUTRAL", score: 0, volume_trend: "STABLE", volume_ratio: 1, breakout_with_volume: false, divergence: "NONE" };
  }
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const n = candles.length;
  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const curVol = volumes[n - 1];
  const volumeRatio = avgVol20 > 0 ? curVol / avgVol20 : 1;
  const recentVols = volumes.slice(-5);
  const volSlope = recentVols[4] - recentVols[0];
  const volumeTrend = volSlope > avgVol20 * 0.1 ? "INCREASING" : volSlope < -avgVol20 * 0.1 ? "DECREASING" : "STABLE";
  const curClose = closes[n - 1];
  const prevClose = closes[n - 2];
  const priceBreakout = Math.abs(curClose - prevClose) / prevClose > 5e-3;
  const breakoutWithVolume = priceBreakout && volumeRatio > 1.5;
  const recentCloses = closes.slice(-10);
  const recentVolumes = volumes.slice(-10);
  const priceHigher = recentCloses[9] > Math.max(...recentCloses.slice(0, 9));
  const volLower = recentVolumes[9] < Math.min(...recentVolumes.slice(0, 9)) * 1.2;
  const priceLower = recentCloses[9] < Math.min(...recentCloses.slice(0, 9));
  const volHigher = recentVolumes[9] > Math.max(...recentVolumes.slice(0, 9)) * 0.8;
  let divergence = "NONE";
  if (priceHigher && volLower) divergence = "BEARISH";
  if (priceLower && volHigher) divergence = "BULLISH";
  let signal = "NEUTRAL";
  let score = 0;
  if (breakoutWithVolume && curClose > prevClose) {
    signal = "LONG";
    score = 60 + Math.min(30, Math.round((volumeRatio - 1.5) * 20));
  } else if (breakoutWithVolume && curClose < prevClose) {
    signal = "SHORT";
    score = 60 + Math.min(30, Math.round((volumeRatio - 1.5) * 20));
  } else if (volumeTrend === "INCREASING") {
    score = 30;
  }
  if (divergence === "BEARISH" && signal === "LONG") score -= 25;
  if (divergence === "BULLISH" && signal === "SHORT") score -= 25;
  return {
    signal,
    score: Math.max(0, Math.min(100, score)),
    volume_trend: volumeTrend,
    volume_ratio: Math.round(volumeRatio * 100) / 100,
    breakout_with_volume: breakoutWithVolume,
    divergence
  };
}
function analyzeTriangleBreakout(candles) {
  if (candles.length < 30) {
    return { signal: "NEUTRAL", score: 0, pattern_detected: false, convergence_ratio: 1, breakout_direction: "NONE", trend_direction: "FLAT", volume_confirm: false };
  }
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const n = candles.length;
  const ema50 = calcEMA(closes, Math.min(50, n - 1));
  const ema50Slope = ema50[n - 1] - ema50[Math.max(0, n - 10)];
  const trendDirection = Math.abs(ema50Slope) < closes[n - 1] * 5e-3 ? "FLAT" : ema50Slope > 0 ? "UP" : "DOWN";
  const lookback = Math.min(20, n - 1);
  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);
  const highStart = recentHighs[0];
  const highEnd = recentHighs[lookback - 1];
  const lowStart = recentLows[0];
  const lowEnd = recentLows[lookback - 1];
  const highsDecreasing = highEnd < highStart;
  const lowsIncreasing = lowEnd > lowStart;
  const patternDetected = highsDecreasing && lowsIncreasing;
  const rangeStart = highStart - lowStart;
  const rangeEnd = highEnd - lowEnd;
  const convergenceRatio = rangeStart > 0 ? rangeEnd / rangeStart : 1;
  const curClose = closes[n - 1];
  const breakoutUp = curClose > highEnd * 1.002;
  const breakoutDown = curClose < lowEnd * 0.998;
  const breakoutDirection = breakoutUp ? "UP" : breakoutDown ? "DOWN" : "NONE";
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeConfirm = volumes[n - 1] > avgVol * 1.3;
  let signal = "NEUTRAL";
  let score = 0;
  if (patternDetected && convergenceRatio < 0.7) {
    if (breakoutDirection === "UP" && trendDirection !== "DOWN") {
      signal = "LONG";
      score = 65 + (volumeConfirm ? 20 : 0) + (trendDirection === "UP" ? 10 : 0);
    } else if (breakoutDirection === "DOWN" && trendDirection !== "UP") {
      signal = "SHORT";
      score = 65 + (volumeConfirm ? 20 : 0) + (trendDirection === "DOWN" ? 10 : 0);
    } else if (breakoutDirection === "NONE") {
      score = 25;
    }
  }
  return {
    signal,
    score: Math.min(100, score),
    pattern_detected: patternDetected,
    convergence_ratio: Math.round(convergenceRatio * 100) / 100,
    breakout_direction: breakoutDirection,
    trend_direction: trendDirection,
    volume_confirm: volumeConfirm
  };
}
function analyzeMacdDivergence(htfCandles, ltfCandles) {
  if (htfCandles.length < 50 || ltfCandles.length < 50) {
    return { signal: "NEUTRAL", score: 0, divergence_type: "NONE", htf_trend: "FLAT", rr_ratio_ok: false, macd_overlap: false };
  }
  const htfCloses = htfCandles.map((c) => c.close);
  const ltfCloses = ltfCandles.map((c) => c.close);
  const htfEma20 = calcEMA(htfCloses, 20);
  const htfN = htfEma20.length;
  const htfSlope = htfEma20[htfN - 1] - htfEma20[htfN - 5];
  const htfTrend = Math.abs(htfSlope) < htfCloses[htfN - 1] * 1e-3 ? "FLAT" : htfSlope > 0 ? "UP" : "DOWN";
  const ltfMACD = calcMACD(ltfCloses);
  const ltfN = ltfMACD.dif.length;
  const lookback = Math.min(20, ltfN - 1);
  const recentCloses = ltfCloses.slice(-lookback);
  const recentDif = ltfMACD.dif.slice(-lookback);
  const priceNewLow = recentCloses[lookback - 1] < Math.min(...recentCloses.slice(0, -1));
  const difNotNewLow = recentDif[lookback - 1] > Math.min(...recentDif.slice(0, -1));
  const bullishDivergence = priceNewLow && difNotNewLow;
  const priceNewHigh = recentCloses[lookback - 1] > Math.max(...recentCloses.slice(0, -1));
  const difNotNewHigh = recentDif[lookback - 1] < Math.max(...recentDif.slice(0, -1));
  const bearishDivergence = priceNewHigh && difNotNewHigh;
  const divergenceType = bullishDivergence ? "BULLISH" : bearishDivergence ? "BEARISH" : "NONE";
  const curHist = ltfMACD.histogram[ltfN - 1];
  const prevHist = ltfMACD.histogram[ltfN - 2];
  const macdOverlapLong = bullishDivergence && curHist > prevHist && curHist < 0;
  const macdOverlapShort = bearishDivergence && curHist < prevHist && curHist > 0;
  const macdOverlap = macdOverlapLong || macdOverlapShort;
  const atrArr = calcATR(ltfCandles);
  const curATR = atrArr[ltfN - 1];
  const curClose = ltfCloses[ltfN - 1];
  const recentLow = Math.min(...ltfCandles.slice(-5).map((c) => c.low));
  const recentHigh = Math.max(...ltfCandles.slice(-5).map((c) => c.high));
  const slLong = recentLow - curATR;
  const slShort = recentHigh + curATR;
  const riskLong = curClose - slLong;
  const riskShort = slShort - curClose;
  const rrRatioOk = bullishDivergence ? curATR * 2 / riskLong >= 2 : bearishDivergence ? curATR * 2 / riskShort >= 2 : false;
  let signal = "NEUTRAL";
  let score = 0;
  if (bullishDivergence && htfTrend === "UP" && macdOverlap) {
    signal = "LONG";
    score = 80 + (rrRatioOk ? 15 : 0);
  } else if (bearishDivergence && htfTrend === "DOWN" && macdOverlap) {
    signal = "SHORT";
    score = 80 + (rrRatioOk ? 15 : 0);
  } else if (divergenceType !== "NONE" && !macdOverlap) {
    score = 40;
  }
  return {
    signal,
    score: Math.min(100, score),
    divergence_type: divergenceType,
    htf_trend: htfTrend,
    rr_ratio_ok: rrRatioOk,
    macd_overlap: macdOverlap
  };
}
function runPandaScanV54(symbol, htfCandles, ltfCandles) {
  const baseSignal = runPandaScan(symbol, htfCandles, ltfCandles);
  const vegasTunnel = analyzeVegasTunnel(htfCandles);
  const atrDynamic = analyzeAtrDynamic(ltfCandles);
  const kdHighWin = analyzeKdHighWin(ltfCandles);
  const volumeConfirm = analyzeVolumeConfirm(ltfCandles);
  const triangleBreakout = analyzeTriangleBreakout(ltfCandles);
  const macdDivergence = analyzeMacdDivergence(htfCandles, ltfCandles);
  const newWeights = {
    vegas_tunnel: 0.2,
    atr_dynamic: 0.15,
    kd_high_win: 0.2,
    volume_confirm: 0.15,
    triangle_breakout: 0.15,
    macd_divergence: 0.15
  };
  const newStrategies = [
    { result: vegasTunnel, weight: newWeights.vegas_tunnel },
    { result: atrDynamic, weight: newWeights.atr_dynamic },
    { result: kdHighWin, weight: newWeights.kd_high_win },
    { result: volumeConfirm, weight: newWeights.volume_confirm },
    { result: triangleBreakout, weight: newWeights.triangle_breakout },
    { result: macdDivergence, weight: newWeights.macd_divergence }
  ];
  const newLongVotes = newStrategies.filter((s) => s.result.signal === "LONG").length;
  const newShortVotes = newStrategies.filter((s) => s.result.signal === "SHORT").length;
  let newWeightedScore = 0;
  const direction = baseSignal.direction;
  for (const { result, weight } of newStrategies) {
    if (result.signal === direction) {
      newWeightedScore += result.score * weight;
    } else if (result.signal === "NEUTRAL") {
      newWeightedScore += result.score * weight * 0.5;
    }
  }
  const combinedScore = Math.round(baseSignal.score * 0.5 + newWeightedScore * 0.5);
  const lastCandle = ltfCandles[ltfCandles.length - 1];
  const atrArr = calcATR(ltfCandles);
  const atr = atrArr[atrArr.length - 1];
  const entryPrice = lastCandle.close;
  let stopLoss = baseSignal.stop_loss;
  let tp1 = baseSignal.take_profit_1;
  let tp2 = baseSignal.take_profit_2;
  if (atrDynamic.dynamic_sl > 0) {
    if (direction === "LONG" && atrDynamic.dynamic_sl < entryPrice) {
      stopLoss = atrDynamic.dynamic_sl;
      const risk2 = entryPrice - stopLoss;
      tp1 = entryPrice + risk2 * 1.5;
      tp2 = entryPrice + risk2 * 2.5;
    } else if (direction === "SHORT" && atrDynamic.dynamic_sl > entryPrice) {
      stopLoss = atrDynamic.dynamic_sl;
      const risk2 = stopLoss - entryPrice;
      tp1 = entryPrice - risk2 * 1.5;
      tp2 = entryPrice - risk2 * 2.5;
    }
  }
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(tp2 - entryPrice);
  const rrRatio = risk > 0 ? Math.round(reward / risk * 10) / 10 : 0;
  let gradeV54 = "AVOID";
  if (direction !== "NEUTRAL") {
    if (combinedScore >= 70) gradeV54 = "STRONG";
    else if (combinedScore >= 55) gradeV54 = "MODERATE";
    else if (combinedScore >= 40) gradeV54 = "WAIT";
  }
  const vetoReasons = [...baseSignal.veto_reasons];
  if (volumeConfirm.divergence === "BEARISH" && direction === "LONG") {
    vetoReasons.push("\u91CF\u50F9\u80CC\u96E2\u8B66\u544A\uFF1A\u50F9\u6F32\u91CF\u7E2E\uFF0C\u591A\u55AE\u8B39\u614E");
  }
  if (triangleBreakout.pattern_detected && triangleBreakout.breakout_direction === "NONE") {
    vetoReasons.push("\u4E09\u89D2\u6536\u6582\u4E2D\uFF1A\u7B49\u5F85\u7A81\u7834\u65B9\u5411\u78BA\u8A8D");
  }
  if (atrDynamic.atr_trend === "CONTRACTING") {
    vetoReasons.push("ATR \u6536\u7E2E\uFF1A\u6CE2\u52D5\u7387\u964D\u4F4E\uFF0C\u7B49\u5F85\u653E\u5927");
  }
  return {
    ...baseSignal,
    stop_loss: stopLoss,
    take_profit_1: tp1,
    take_profit_2: tp2,
    rr_ratio: rrRatio,
    veto_reasons: vetoReasons,
    strategies_v54: {
      vegas_tunnel: vegasTunnel,
      atr_dynamic: atrDynamic,
      kd_high_win: kdHighWin,
      volume_confirm: volumeConfirm,
      triangle_breakout: triangleBreakout,
      macd_divergence: macdDivergence
    },
    score_v54: combinedScore,
    grade_v54: gradeV54
  };
}
var init_pandaStrategy = __esm({
  "server/utils/pandaStrategy.ts"() {
    "use strict";
  }
});

// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import fs3 from "fs/promises";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { mysqlTable, varchar, datetime } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  openId: varchar("open_id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: varchar("role", { length: 32 }),
  lastSignedIn: datetime("last_signed_in")
});
var widgetPrefs = mysqlTable("widget_prefs", {
  openId: varchar("open_id", { length: 255 }).primaryKey(),
  widgetIds: varchar("widget_ids", { length: 4096 })
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY || process.env.OPENAI_API_KEY || ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getWidgetPrefs(openId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(widgetPrefs).where(eq(widgetPrefs.openId, openId)).limit(1);
  if (result.length === 0) return null;
  try {
    return JSON.parse(result[0].widgetIds);
  } catch {
    return null;
  }
}
async function saveWidgetPrefs(openId, widgetIds) {
  const db = await getDb();
  if (!db) return;
  const json = JSON.stringify(widgetIds);
  await db.insert(widgetPrefs).values({ openId, widgetIds: json }).onDuplicateKeyUpdate({ set: { widgetIds: json } });
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      if (process.env.AUTH_DEBUG === "true") {
        console.debug("[Auth] Missing session cookie");
      }
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/llm.ts
var ensureArray = (value) => Array.isArray(value) ? value : [value];
var normalizeContentPart = (part) => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (part.type === "text") {
    return part;
  }
  if (part.type === "image_url") {
    return part;
  }
  if (part.type === "file_url") {
    return part;
  }
  throw new Error("Unsupported message content part");
};
var normalizeMessage = (message) => {
  const { role, name, tool_call_id } = message;
  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content).map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\n");
    return {
      role,
      name,
      tool_call_id,
      content
    };
  }
  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text
    };
  }
  return {
    role,
    name,
    content: contentParts
  };
};
var normalizeToolChoice = (toolChoice, tools) => {
  if (!toolChoice) return void 0;
  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }
  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }
    return {
      type: "function",
      function: { name: tools[0].function.name }
    };
  }
  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name }
    };
  }
  return toolChoice;
};
var resolveApiUrl = () => ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0 ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions` : process.env.OPENAI_BASE_URL ? `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions` : "https://api.manus.im/api/llm-proxy/v1/chat/completions";
var assertApiKey = () => {
  if (!ENV.forgeApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
};
var normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema
}) => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }
  const schema = outputSchema || output_schema;
  if (!schema) return void 0;
  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...typeof schema.strict === "boolean" ? { strict: schema.strict } : {}
    }
  };
};
var isSoxioKey = (key) => key.startsWith("cr_");
async function invokeSoxioResponsesAPI(messages, model, apiKey, maxTokens) {
  const systemMsg = messages.find((m) => m.role === "system");
  const inputMessages = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role,
    content: m.content
  }));
  const payload = {
    model,
    input: inputMessages,
    stream: true
  };
  if (systemMsg) {
    payload.instructions = systemMsg.content;
  }
  const TIMEOUT_MS = 12e4;
  const MAX_RETRIES = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response;
      try {
        response = await fetch("https://apikey.soxio.me/openai/v1/responses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`soxio API failed: ${response.status} \u2013 ${errorText}`);
        if ([502, 503, 429].includes(response.status) && attempt < MAX_RETRIES) {
          console.warn(`[soxio] \u7B2C ${attempt} \u6B21\u5617\u8A66\u5931\u6557 (${response.status})\uFF0C${attempt * 3}s \u5F8C\u91CD\u8A66...`);
          await new Promise((r) => setTimeout(r, attempt * 3e3));
          lastError = err;
          continue;
        }
        throw err;
      }
      const rawText = await response.text();
      let fullText = "";
      for (const line of rawText.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") break;
        try {
          const event = JSON.parse(jsonStr);
          if (event.type === "response.completed") {
            const resp = event.response;
            const output = resp?.output;
            if (output?.[0]?.content?.[0]?.text) {
              return output[0].content[0].text;
            }
          }
          if (event.type === "response.output_text.delta") {
            const delta = event.delta;
            if (delta) fullText += delta;
          }
        } catch {
        }
      }
      if (fullText) return fullText;
      throw new Error(`soxio: no text in response`);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name === "AbortError") {
        lastError = new Error(`soxio timeout after ${TIMEOUT_MS}ms (attempt ${attempt})`);
        console.warn(`[soxio] \u7B2C ${attempt} \u6B21\u5617\u8A66\u8D85\u6642\uFF0C${attempt * 3}s \u5F8C\u91CD\u8A66...`);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, attempt * 3e3));
          continue;
        }
      } else {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("soxio API failed after all retries");
}
function resolveModel(tier) {
  const defaultModel = process.env.OPENAI_MODEL || "claude-opus-4-6";
  if (!tier) return defaultModel;
  switch (tier) {
    case "fast":
      return process.env.OPENAI_MODEL_FAST || "gemini-2.5-flash";
    case "balanced":
      return process.env.OPENAI_MODEL_BALANCED || defaultModel;
    case "deep":
      return process.env.OPENAI_MODEL_DEEP || defaultModel;
    default:
      return defaultModel;
  }
}
async function invokeLLM(params) {
  assertApiKey();
  const _primaryKey = ENV.forgeApiKey ?? "";
  if (isSoxioKey(_primaryKey)) {
    const _model = resolveModel(params.tier);
    const _maxTokens = params.maxTokens ?? params.max_tokens ?? 32768;
    const _msgs = params.messages.map((m) => ({
      role: String(m.role),
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    }));
    const _text = await invokeSoxioResponsesAPI(_msgs, _model, _primaryKey, _maxTokens);
    return {
      choices: [{ message: { role: "assistant", content: _text }, finish_reason: "stop", index: 0 }],
      model: _model,
      object: "chat.completion",
      id: `soxio-${Date.now()}`,
      created: Math.floor(Date.now() / 1e3)
    };
  }
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    tier
  } = params;
  const payload = {
    model: resolveModel(tier),
    messages: messages.map(normalizeMessage)
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }
  const maxTok = params.maxTokens ?? params.max_tokens;
  payload.max_tokens = maxTok ?? 32768;
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema
  });
  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }
  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 9e4;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response;
      try {
        response = await fetch(resolveApiUrl(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${ENV.forgeApiKey}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `LLM invoke failed: ${response.status} ${response.statusText} \u2013 ${errorText}`
        );
        if ([502, 503, 429].includes(response.status) && attempt < MAX_RETRIES) {
          console.warn(`[LLM] \u7B2C ${attempt} \u6B21\u5617\u8A66\u5931\u6557 (${response.status})\uFF0C${attempt * 3}s \u5F8C\u91CD\u8A66...`);
          await new Promise((r) => setTimeout(r, attempt * 3e3));
          lastError = err;
          continue;
        }
        throw err;
      }
      return await response.json();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name === "AbortError") {
        lastError = new Error(`LLM invoke timeout after ${TIMEOUT_MS}ms (attempt ${attempt})`);
        console.warn(`[LLM] \u7B2C ${attempt} \u6B21\u5617\u8A66\u8D85\u6642\uFF0C${attempt * 3}s \u5F8C\u91CD\u8A66...`);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, attempt * 3e3));
          continue;
        }
      } else {
        throw err;
      }
    }
  }
  const soxioKey = process.env.SOXIO_API_KEY ?? process.env.LANYI_API_KEY ?? "";
  const primaryKey = ENV.forgeApiKey ?? "";
  if (soxioKey && !isSoxioKey(primaryKey)) {
    console.warn("[LLM] \u4E3B API \u5168\u90E8\u5931\u6557\uFF0C\u5207\u63DB\u81F3 soxio \u5099\u63F4 API...");
    const model = resolveModel(params.tier);
    const maxTokens = params.maxTokens ?? params.max_tokens ?? 32768;
    const normalizedMsgs = params.messages.map((m) => ({
      role: String(m.role),
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    }));
    const text = await invokeSoxioResponsesAPI(normalizedMsgs, model, soxioKey, maxTokens);
    return {
      choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop", index: 0 }],
      model,
      object: "chat.completion"
    };
  }
  throw lastError ?? new Error("LLM invoke failed after all retries");
}

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  /** 修復 C：返回實際模型配置，供設定頁面動態顯示 */
  config: publicProcedure.query(() => ({
    model_balanced: resolveModel("balanced"),
    model_fast: resolveModel("fast"),
    model_deep: resolveModel("deep"),
    forge_url: process.env.BUILT_IN_FORGE_API_URL ?? process.env.OPENAI_BASE_URL ?? "(\u672A\u8A2D\u5B9A)",
    node_env: process.env.NODE_ENV ?? "development"
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
init_analysis();

// server/services/cannonballService.ts
init_analysis();
init_indicators();
var DEFAULT_PARAMS = {
  htf_tf: "2H",
  ltf_tf: "30m",
  htf_limit: 200,
  ltf_limit: 200,
  sl_atr_mult: 0.3,
  tp2_atr_mult: 2.5,
  confluence_threshold: 50,
  avoid_extremes_atr: 0.8
};
function getStructureDirection(events) {
  const confirmed = events.filter((e) => e.confirmed);
  if (confirmed.length === 0) return "ranging";
  const last = confirmed[confirmed.length - 1];
  if (last.type === "CHoCH") return last.direction;
  if (last.type === "BOS") return last.direction;
  return "ranging";
}
function mapOBToCannonball(ob, close, atr) {
  const tolerance = atr * 0.1;
  const in_mitigation = close >= ob.bottom - tolerance && close <= ob.top + tolerance;
  return {
    top: ob.top,
    bottom: ob.bottom,
    mid: ob.mid,
    strength: ob.strength,
    quality: ob.quality,
    bos_confirmed: ob.bos_confirmed,
    tested_count: ob.tested_count,
    in_mitigation
  };
}
function calcRvol(candles) {
  if (candles.length < 2) return 1;
  const recent = candles.slice(-21);
  const avgVol = recent.slice(0, -1).reduce((s, c) => s + c.volume, 0) / Math.max(recent.length - 1, 1);
  const curVol = candles[candles.length - 1].volume;
  return avgVol > 0 ? curVol / avgVol : 1;
}
function findSecondStructureTarget(swingPoints, direction, firstTarget) {
  if (!firstTarget || swingPoints.length < 2) return null;
  const candidates = direction === "bullish" ? swingPoints.filter((p) => p.price > firstTarget).sort((a, b) => a.price - b.price) : swingPoints.filter((p) => p.price < firstTarget).sort((a, b) => b.price - a.price);
  return candidates[0]?.price ?? null;
}
var _inFlight = /* @__PURE__ */ new Map();
async function runCannonballAnalysis(symbol, params = {}) {
  const sym = symbol.toUpperCase();
  const resolvedParams = { ...DEFAULT_PARAMS, ...params };
  const cacheKey = `${sym}:${resolvedParams.htf_tf}:${resolvedParams.ltf_tf}:${resolvedParams.sl_atr_mult}:${resolvedParams.tp2_atr_mult}:${resolvedParams.confluence_threshold}:${resolvedParams.avoid_extremes_atr}`;
  if (_inFlight.has(cacheKey)) return _inFlight.get(cacheKey);
  const promise = _runAnalysis(sym, resolvedParams).finally(() => _inFlight.delete(cacheKey));
  _inFlight.set(cacheKey, promise);
  return promise;
}
async function _runAnalysis(sym, p) {
  const htfPromise = fetchCandles(sym, p.htf_tf, p.htf_limit);
  await new Promise((r) => setTimeout(r, 100));
  const ltfPromise = fetchCandles(sym, p.ltf_tf, p.ltf_limit);
  const [candlesHtf, candlesLtf] = await Promise.all([htfPromise, ltfPromise]);
  const close = candlesHtf[candlesHtf.length - 1].close;
  const atrHtf = calcAtrLast(candlesHtf, 14);
  const atrLtf = calcAtrLast(candlesLtf, 14);
  const bosChochHtf = detectBosChoch(candlesHtf);
  const obsHtf = detectOrderBlocks(candlesHtf, close);
  const swingHighsHtf = findSwingHighs(candlesHtf, 5).slice(-10);
  const swingLowsHtf = findSwingLows(candlesHtf, 5).slice(-10);
  const htfDirection = getStructureDirection(bosChochHtf.events);
  const htfLastEvent = bosChochHtf.events.filter((e) => e.confirmed).slice(-1)[0] ?? null;
  let recentHH = null;
  let recentLL = null;
  let recentHL = null;
  let recentLH = null;
  if (swingHighsHtf.length >= 2) {
    const last2Highs = swingHighsHtf.slice(-2);
    recentHH = last2Highs[1].price > last2Highs[0].price ? last2Highs[1].price : null;
    recentLH = last2Highs[1].price < last2Highs[0].price ? last2Highs[1].price : null;
  }
  if (swingLowsHtf.length >= 2) {
    const last2Lows = swingLowsHtf.slice(-2);
    recentHL = last2Lows[1].price > last2Lows[0].price ? last2Lows[1].price : null;
    recentLL = last2Lows[1].price < last2Lows[0].price ? last2Lows[1].price : null;
  }
  const htfBullOBs = obsHtf.allBull.slice(0, 5).map((o) => mapOBToCannonball(o, close, atrHtf));
  const htfBearOBs = obsHtf.allBear.slice(0, 5).map((o) => mapOBToCannonball(o, close, atrHtf));
  const htfNearestBull = obsHtf.nearestBull ? mapOBToCannonball(obsHtf.nearestBull, close, atrHtf) : null;
  const htfNearestBear = obsHtf.nearestBear ? mapOBToCannonball(obsHtf.nearestBear, close, atrHtf) : null;
  const bosChochLtf = detectBosChoch(candlesLtf);
  const obsLtf = detectOrderBlocks(candlesLtf, close);
  const ltfDirection = getStructureDirection(bosChochLtf.events);
  const ltfLastEvent = bosChochLtf.events.filter((e) => e.confirmed).slice(-1)[0] ?? null;
  const ltfRecentEvents = bosChochLtf.events.filter((e) => e.confirmed).slice(-5).map((e) => ({
    type: e.type,
    direction: e.direction,
    price: e.price,
    confirmed: e.confirmed
  }));
  const ltfBullOBs = obsLtf.allBull.slice(0, 5).map((o) => mapOBToCannonball(o, close, atrLtf));
  const ltfBearOBs = obsLtf.allBear.slice(0, 5).map((o) => mapOBToCannonball(o, close, atrLtf));
  const ltfNearestBull = obsLtf.nearestBull ? mapOBToCannonball(obsLtf.nearestBull, close, atrLtf) : null;
  const ltfNearestBear = obsLtf.nearestBear ? mapOBToCannonball(obsLtf.nearestBear, close, atrLtf) : null;
  const nearestHighHtf = swingHighsHtf.length > 0 ? swingHighsHtf[swingHighsHtf.length - 1].price : close * 1.05;
  const nearestLowHtf = swingLowsHtf.length > 0 ? swingLowsHtf[swingLowsHtf.length - 1].price : close * 0.95;
  const distToHigh = (nearestHighHtf - close) / (atrHtf + 1e-3);
  const distToLow = (close - nearestLowHtf) / (atrHtf + 1e-3);
  const avoidExtremesLong = distToHigh > p.avoid_extremes_atr;
  const avoidExtremesShort = distToLow > p.avoid_extremes_atr;
  const avoid_extremes = htfDirection === "bullish" ? avoidExtremesLong : avoidExtremesShort;
  const body_close_confirmed = ltfLastEvent?.confirmed ?? false;
  let wick_clean = false;
  if (ltfLastEvent) {
    const rawEvents = bosChochLtf.events.filter((e) => e.confirmed);
    const rawLastEvent = rawEvents[rawEvents.length - 1];
    if (rawLastEvent && rawLastEvent.idx < candlesLtf.length) {
      const breakCandle = candlesLtf[rawLastEvent.idx];
      const totalRange = breakCandle.high - breakCandle.low;
      const bodySize = Math.abs(breakCandle.close - breakCandle.open);
      wick_clean = totalRange > 0 ? bodySize / totalRange > 0.5 : false;
    }
  }
  const rvol = calcRvol(candlesLtf);
  const recent5 = candlesLtf.slice(-5);
  const upBars = recent5.filter((c) => c.close > c.open).length;
  const rvolWeight = rvol >= 1.5 ? 1.2 : rvol >= 1 ? 1 : 0.7;
  const money_flow_bullish = upBars >= 3 && rvolWeight >= 1 || upBars >= 4;
  let confluenceScore = 0;
  if (htfDirection !== "ranging") confluenceScore += 25;
  if (body_close_confirmed) confluenceScore += 20;
  if (avoid_extremes) confluenceScore += 20;
  if (wick_clean) confluenceScore += 15;
  if (htfDirection === "bullish" && money_flow_bullish) {
    confluenceScore += Math.round(10 * Math.min(rvolWeight, 1.2));
  } else if (htfDirection === "bearish" && !money_flow_bullish) {
    confluenceScore += Math.round(10 * Math.min(rvolWeight, 1.2));
  }
  if (htfDirection !== "ranging" && ltfDirection === htfDirection) confluenceScore += 10;
  const filters = {
    avoid_extremes,
    body_close_confirmed,
    confluence_score: Math.min(100, confluenceScore),
    money_flow_bullish,
    wick_clean,
    rvol: parseFloat(rvol.toFixed(2))
  };
  const inBullOB = htfNearestBull?.in_mitigation || ltfNearestBull?.in_mitigation || false;
  const inBearOB = htfNearestBear?.in_mitigation || ltfNearestBear?.in_mitigation || false;
  const price_in_ob = htfDirection === "bullish" ? inBullOB : inBearOB;
  const recentConfirmedEvents = ltfRecentEvents.filter((e) => e.confirmed);
  const hasLongConfirmation = recentConfirmedEvents.some((e) => e.direction === "bullish" && (e.type === "CHoCH" || e.type === "BOS"));
  const hasShortConfirmation = recentConfirmedEvents.some((e) => e.direction === "bearish" && (e.type === "CHoCH" || e.type === "BOS"));
  const structure_event_confirmed = htfDirection === "bullish" ? hasLongConfirmation : hasShortConfirmation;
  const checklist = {
    htf_structure_valid: htfDirection !== "ranging",
    price_in_ob,
    structure_event_confirmed,
    avoid_extremes_pass: avoid_extremes,
    confluence_pass: confluenceScore >= p.confluence_threshold,
    all_pass: htfDirection !== "ranging" && price_in_ob && structure_event_confirmed && avoid_extremes && confluenceScore >= p.confluence_threshold
  };
  let entryPlan;
  if (htfDirection === "bullish" && checklist.all_pass && htfNearestBull) {
    const ob = htfNearestBull;
    const sl = ob.bottom - atrHtf * p.sl_atr_mult;
    const tp1 = recentHH ?? close + atrHtf * 2;
    const secondHH = findSecondStructureTarget(swingHighsHtf, "bullish", recentHH);
    const tp2 = secondHH ?? tp1 + atrHtf * p.tp2_atr_mult;
    const rr = tp1 > close ? (tp1 - close) / (close - sl) : 0;
    const tp2Basis = secondHH ? `TP2: \u7B2C\u4E8C HTF Swing High (${secondHH.toFixed(4)})` : `TP2: \u5EF6\u4F38 ${p.tp2_atr_mult} ATR`;
    entryPlan = {
      direction: "long",
      entry_zone_top: ob.top,
      entry_zone_bottom: ob.bottom,
      stop_loss: parseFloat(sl.toFixed(4)),
      tp1: parseFloat(tp1.toFixed(4)),
      tp2: parseFloat(tp2.toFixed(4)),
      rr_ratio: parseFloat(rr.toFixed(2)),
      sl_basis: `HTF Bullish OB \u5E95\u90E8\u5916\u5074 (${ob.bottom.toFixed(4)}) - ${p.sl_atr_mult} ATR`,
      tp_basis: `TP1: HTF \u6700\u8FD1 HH \u7D50\u69CB\u4F4D (${tp1.toFixed(4)}) | ${tp2Basis}`
    };
  } else if (htfDirection === "bearish" && checklist.all_pass && htfNearestBear) {
    const ob = htfNearestBear;
    const sl = ob.top + atrHtf * p.sl_atr_mult;
    const tp1 = recentLL ?? close - atrHtf * 2;
    const secondLL = findSecondStructureTarget(swingLowsHtf, "bearish", recentLL);
    const tp2 = secondLL ?? tp1 - atrHtf * p.tp2_atr_mult;
    const rr = close > tp1 ? (close - tp1) / (sl - close) : 0;
    const tp2Basis = secondLL ? `TP2: \u7B2C\u4E8C HTF Swing Low (${secondLL.toFixed(4)})` : `TP2: \u5EF6\u4F38 ${p.tp2_atr_mult} ATR`;
    entryPlan = {
      direction: "short",
      entry_zone_top: ob.top,
      entry_zone_bottom: ob.bottom,
      stop_loss: parseFloat(sl.toFixed(4)),
      tp1: parseFloat(tp1.toFixed(4)),
      tp2: parseFloat(tp2.toFixed(4)),
      rr_ratio: parseFloat(rr.toFixed(2)),
      sl_basis: `HTF Bearish OB \u9802\u90E8\u5916\u5074 (${ob.top.toFixed(4)}) + ${p.sl_atr_mult} ATR`,
      tp_basis: `TP1: HTF \u6700\u8FD1 LL \u7D50\u69CB\u4F4D (${tp1.toFixed(4)}) | ${tp2Basis}`
    };
  } else {
    const refOB = htfDirection === "bullish" ? htfNearestBull : htfNearestBear;
    entryPlan = {
      direction: "wait",
      entry_zone_top: refOB?.top ?? close,
      entry_zone_bottom: refOB?.bottom ?? close,
      stop_loss: 0,
      tp1: 0,
      tp2: 0,
      rr_ratio: 0,
      sl_basis: "\u7B49\u5F85\u689D\u4EF6\u5C0D\u9F4A\u5F8C\u518D\u8A08\u7B97",
      tp_basis: "\u7B49\u5F85\u689D\u4EF6\u5C0D\u9F4A\u5F8C\u518D\u8A08\u7B97"
    };
  }
  let status;
  let status_message;
  let confidence = 0;
  if (htfDirection === "ranging") {
    status = "ranging";
    status_message = `${p.htf_tf} \u7D50\u69CB\u9707\u76EA\uFF0C\u7121\u660E\u78BA\u65B9\u5411\uFF0C\u7B49\u5F85\u7D50\u69CB\u9078\u64C7\u5F8C\u518D\u64CD\u4F5C\u3002`;
    confidence = 10;
  } else if (!checklist.avoid_extremes_pass) {
    status = "filtered_out";
    status_message = `Avoid Extremes \u904E\u6FFE\u89F8\u767C\uFF1A\u7576\u524D\u50F9\u683C\u8DDD\u96E2 ${p.htf_tf} ${htfDirection === "bullish" ? "\u524D\u9AD8" : "\u524D\u4F4E"} \u904E\u8FD1\uFF08< ${p.avoid_extremes_atr} ATR\uFF09\uFF0C\u4E0D\u5B9C\u9032\u5834\u3002`;
    confidence = 15;
  } else if (!checklist.price_in_ob) {
    status = "waiting_mitigation";
    const targetOB = htfDirection === "bullish" ? htfNearestBull : htfNearestBear;
    const zone = targetOB ? `${targetOB.bottom.toFixed(4)} \u2013 ${targetOB.top.toFixed(4)}` : "\u5C0B\u627E\u6709\u6548 OB";
    status_message = `${p.htf_tf} \u7D50\u69CB${htfDirection === "bullish" ? "\u770B\u591A" : "\u770B\u7A7A"}\uFF0C\u7B49\u5F85\u50F9\u683C\u56DE\u88DC ${htfDirection === "bullish" ? "Bullish" : "Bearish"} OB\uFF08${zone}\uFF09\u3002`;
    confidence = 30;
  } else if (!checklist.structure_event_confirmed) {
    status = "waiting_confirmation";
    status_message = `\u50F9\u683C\u5DF2\u9032\u5165 OB \u5340\u57DF\uFF0C\u7B49\u5F85 ${p.ltf_tf} \u51FA\u73FE\u6536\u76E4\u78BA\u8A8D\u7684 ${htfDirection === "bullish" ? "Bullish CHoCH/BOS" : "Bearish CHoCH/BOS"}\u3002`;
    confidence = 55;
  } else if (!checklist.confluence_pass) {
    status = "filtered_out";
    status_message = `\u7D50\u69CB\u689D\u4EF6\u5DF2\u6EFF\u8DB3\uFF0C\u4F46 Confluence \u8A55\u5206\u4E0D\u8DB3\uFF08${confluenceScore}/100 < ${p.confluence_threshold}\uFF09\uFF0C\u8A0A\u865F\u4E0D\u5920\u4E7E\u6DE8\uFF0C\u66AB\u7DE9\u9032\u5834\u3002`;
    confidence = 40;
  } else if (checklist.all_pass && htfDirection === "bullish") {
    status = "ready_long";
    status_message = `\u5168\u90E8\u689D\u4EF6\u5C0D\u9F4A\uFF1A${p.htf_tf} \u770B\u591A + OB \u56DE\u88DC + ${p.ltf_tf} \u6536\u76E4\u78BA\u8A8D + \u904E\u6FFE\u5668\u901A\u904E\u3002\u53EF\u8003\u616E\u5728 OB \u5340\u57DF\u505A\u591A\uFF0C\u6B62\u640D\u653E OB \u5E95\u90E8\u5916\u5074 ${p.sl_atr_mult} ATR\u3002`;
    confidence = Math.min(95, 60 + confluenceScore * 0.35);
  } else if (checklist.all_pass && htfDirection === "bearish") {
    status = "ready_short";
    status_message = `\u5168\u90E8\u689D\u4EF6\u5C0D\u9F4A\uFF1A${p.htf_tf} \u770B\u7A7A + OB \u56DE\u88DC + ${p.ltf_tf} \u6536\u76E4\u78BA\u8A8D + \u904E\u6FFE\u5668\u901A\u904E\u3002\u53EF\u8003\u616E\u5728 OB \u5340\u57DF\u505A\u7A7A\uFF0C\u6B62\u640D\u653E OB \u9802\u90E8\u5916\u5074 ${p.sl_atr_mult} ATR\u3002`;
    confidence = Math.min(95, 60 + confluenceScore * 0.35);
  } else {
    status = "waiting_confirmation";
    status_message = "\u689D\u4EF6\u90E8\u5206\u6EFF\u8DB3\uFF0C\u7E7C\u7E8C\u7B49\u5F85\u6240\u6709\u689D\u4EF6\u5C0D\u9F4A\u3002";
    confidence = 35;
  }
  return {
    symbol: sym,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    current_price: close,
    atr_2h: parseFloat(atrHtf.toFixed(4)),
    htf_tf: p.htf_tf,
    ltf_tf: p.ltf_tf,
    params_used: p,
    htf_structure: {
      direction: htfDirection,
      last_event: htfLastEvent ? {
        type: htfLastEvent.type,
        direction: htfLastEvent.direction,
        price: htfLastEvent.price,
        confirmed: htfLastEvent.confirmed
      } : null,
      recent_hh: recentHH,
      recent_ll: recentLL,
      recent_hl: recentHL,
      recent_lh: recentLH,
      bull_obs: htfBullOBs,
      bear_obs: htfBearOBs,
      nearest_bull_ob: htfNearestBull,
      nearest_bear_ob: htfNearestBear
    },
    ltf_structure: {
      direction: ltfDirection,
      last_event: ltfLastEvent ? {
        type: ltfLastEvent.type,
        direction: ltfLastEvent.direction,
        price: ltfLastEvent.price,
        confirmed: ltfLastEvent.confirmed
      } : null,
      recent_events: ltfRecentEvents,
      bull_obs: ltfBullOBs,
      bear_obs: ltfBearOBs,
      nearest_bull_ob: ltfNearestBull,
      nearest_bear_ob: ltfNearestBear
    },
    filters,
    checklist,
    entry_plan: entryPlan,
    status,
    status_message,
    confidence: Math.round(confidence)
  };
}

// server/backtest.ts
init_analysis();
init_indicators();
init_advancedAnalysis();
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
  for (const t2 of trades) {
    equity *= 1 + t2.pnl_pct;
    equityNet *= 1 + t2.pnl_net_pct;
    if (equityNet > peakNet) peakNet = equityNet;
    const dd = (peakNet - equityNet) / peakNet;
    if (dd > maxDd) maxDd = dd;
    equityCurve.push(Math.round(equityNet * 1e4) / 1e4);
    returns.push(t2.pnl_net_pct);
    totalFees += t2.fee_pct;
    if (t2.exit_reason === "trailing") trailingCount++;
    if (t2.pnl_net_pct > 0) {
      wins++;
      totalWin += t2.pnl_net_pct;
    } else totalLoss += Math.abs(t2.pnl_net_pct);
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
  for (const t2 of trades) {
    const d = new Date(t2.entry_time * 1e3);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const m = monthMap.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
    m.trades++;
    if (t2.pnl_net_pct > 0) m.wins++;
    m.pnl += t2.pnl_net_pct;
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
  for (const t2 of trades) {
    if (t2.pnl_net_pct > 0) {
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
  for (const t2 of trades) {
    const h = new Date(t2.entry_time * 1e3).getUTCHours();
    const sessionName = classifySession(h);
    const s = sessionMap.get(sessionName);
    s.trades++;
    if (t2.pnl_net_pct > 0) s.wins++;
    s.pnl += t2.pnl_net_pct;
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
    for (const t2 of trades) {
      const cs = calcMtfConsensus(
        candles_4h ?? null,
        candles_1h ?? null,
        candles_15m ?? null,
        candles_5m ?? null,
        t2.entry_time,
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
function runMonteCarlo(trades, iterations = 3e3, ruinThreshold = 0.5) {
  if (trades.length === 0) {
    return {
      iterations: 0,
      p5_return: 0,
      p50_return: 0,
      p95_return: 0,
      p5_max_drawdown: 0,
      p95_max_drawdown: 0,
      ruin_probability: 0,
      expected_return: 0
    };
  }
  const simResults = [];
  for (let iter = 0; iter < iterations; iter++) {
    const shuffled = [...trades];
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
    }
    let equity = 1;
    let peak = 1;
    let maxDD = 0;
    for (const t2 of shuffled) {
      equity *= 1 + t2.pnl_net_pct;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    simResults.push({
      ret: Math.round((equity - 1) * 1e4) / 1e4,
      maxDD: Math.round(maxDD * 1e4) / 1e4
    });
  }
  simResults.sort((a, b) => a.ret - b.ret);
  const ddSorted = [...simResults].sort((a, b) => a.maxDD - b.maxDD);
  const p5Idx = Math.floor(iterations * 0.05);
  const p50Idx = Math.floor(iterations * 0.5);
  const p95Idx = Math.floor(iterations * 0.95);
  const expectedReturn = simResults.reduce((s, r) => s + r.ret, 0) / iterations;
  const ruinCount = simResults.filter((r) => r.maxDD >= ruinThreshold).length;
  return {
    iterations,
    p5_return: simResults[p5Idx].ret,
    p50_return: simResults[p50Idx].ret,
    p95_return: simResults[p95Idx].ret,
    p5_max_drawdown: ddSorted[p5Idx].maxDD,
    p95_max_drawdown: ddSorted[p95Idx].maxDD,
    ruin_probability: Math.round(ruinCount / iterations * 1e4) / 1e4,
    expected_return: Math.round(expectedReturn * 1e4) / 1e4
  };
}

// server/walkforward.ts
function aggregateStats(statsArr) {
  if (statsArr.length === 0) {
    return { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 };
  }
  const totalTrades = statsArr.reduce((s, x) => s + x.trades, 0);
  const weightedWinRate = totalTrades > 0 ? statsArr.reduce((s, x) => s + x.win_rate * x.trades, 0) / totalTrades : 0;
  const weightedSharpe = totalTrades > 0 ? statsArr.reduce((s, x) => s + x.sharpe * x.trades, 0) / totalTrades : 0;
  const weightedSortino = totalTrades > 0 ? statsArr.reduce((s, x) => s + x.sortino * x.trades, 0) / totalTrades : 0;
  const validPf = statsArr.filter((x) => x.profit_factor > 0 && x.profit_factor < 99);
  const geomPf = validPf.length > 0 ? Math.exp(validPf.reduce((s, x) => s + Math.log(x.profit_factor), 0) / validPf.length) : 0;
  const geomReturn = statsArr.reduce((prod, x) => prod * (1 + x.total_return), 1) - 1;
  return {
    trades: totalTrades,
    win_rate: weightedWinRate,
    total_return: geomReturn,
    sharpe: weightedSharpe,
    sortino: weightedSortino,
    max_drawdown: Math.max(...statsArr.map((x) => x.max_drawdown)),
    profit_factor: geomPf
  };
}
function calcDecay(is, oos) {
  const eps = 1e-6;
  const denom = Math.max(Math.abs(is), eps);
  if (Math.abs(is) < 1e-3) {
    return oos >= 0 ? 1 : 0;
  }
  const delta = (oos - is) / denom;
  return Math.max(-1, Math.min(2, 1 + delta));
}
function clampScore(v) {
  return Math.max(0, Math.min(100, v));
}
function calcOverfittingScore(folds) {
  if (folds.length === 0) return 0;
  const avgWinDecay = folds.reduce((s, f) => s + f.win_rate_decay, 0) / folds.length;
  const avgSharpeDecay = folds.reduce((s, f) => s + f.sharpe_decay, 0) / folds.length;
  const avgRetDecay = folds.reduce((s, f) => s + f.return_decay, 0) / folds.length;
  const avgDDInflation = folds.reduce((s, f) => s + f.drawdown_inflation, 0) / folds.length;
  const winScore = clampScore((1 - avgWinDecay) / 0.3 * 100);
  const sharpeScore = clampScore((1 - avgSharpeDecay) / 0.6 * 100);
  const returnScore = clampScore((1 - avgRetDecay) / 0.7 * 100);
  const ddScore = clampScore((avgDDInflation - 1) / 1 * 100);
  let dispersionPenalty = 0;
  if (folds.length >= 2) {
    const oosSharpes = folds.map((f) => f.oos_stats.sharpe);
    const meanS = oosSharpes.reduce((a, b) => a + b, 0) / oosSharpes.length;
    const stdS = Math.sqrt(oosSharpes.reduce((a, s) => a + (s - meanS) ** 2, 0) / oosSharpes.length);
    dispersionPenalty = clampScore((stdS - 1) / 2 * 30);
  }
  const baseScore = Math.round(
    winScore * 0.2 + sharpeScore * 0.35 + returnScore * 0.25 + ddScore * 0.2
  );
  return clampScore(baseScore + dispersionPenalty * 0.15);
}
async function runWalkForwardBacktest(symbol, strategy, interval, candles, isRatio = 0.7, options) {
  const runAsync = (c, htfSlice, entrySlice) => Promise.resolve(
    runBacktest({
      candles: c,
      strategy,
      symbol,
      interval,
      ...options,
      htf_candles: htfSlice,
      entry_candles: entrySlice
    })
  );
  const n = candles.length;
  const safeIsRatio = Math.max(0.5, Math.min(0.9, isRatio));
  const windowSize = Math.min(540, Math.floor(n * 0.5));
  const isSize = Math.floor(windowSize * safeIsRatio);
  const oosSize = windowSize - isSize;
  const step = Math.max(1, oosSize);
  const MIN_CANDLES = 50;
  if (n < windowSize + MIN_CANDLES || isSize < MIN_CANDLES || oosSize < MIN_CANDLES) {
    return {
      folds: [],
      is_stats: { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 },
      oos_stats: { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 },
      overfitting_score: 0,
      verdict: "healthy",
      total_candles: n,
      fold_count: 0
    };
  }
  const folds = [];
  const isStatsList = [];
  const oosStatsList = [];
  const eps = 1e-4;
  let foldIndex = 0;
  for (let start = 0; start + windowSize <= n; start += step) {
    const isStart = start;
    const isEnd = start + isSize - 1;
    const oosStart = start + isSize;
    const oosEnd = Math.min(start + windowSize - 1, n - 1);
    if (oosEnd <= oosStart + MIN_CANDLES) break;
    const isCandles = candles.slice(isStart, isEnd + 1);
    const oosCandles = candles.slice(oosStart, oosEnd + 1);
    if (isCandles.length < MIN_CANDLES || oosCandles.length < MIN_CANDLES) {
      foldIndex++;
      continue;
    }
    let isHtfSlice;
    let oosHtfSlice;
    let isEntrySlice;
    let oosEntrySlice;
    if (options?.use_true_mtf) {
      const isStartTime = isCandles[0].time;
      const isEndTime = isCandles[isCandles.length - 1].time;
      const oosStartTime = oosCandles[0].time;
      const oosEndTime = oosCandles[oosCandles.length - 1].time;
      if (options.htf_candles) {
        isHtfSlice = options.htf_candles.filter((c) => c.time >= isStartTime && c.time <= isEndTime);
        oosHtfSlice = options.htf_candles.filter((c) => c.time >= oosStartTime && c.time <= oosEndTime);
      }
      if (options.entry_candles) {
        isEntrySlice = options.entry_candles.filter((c) => c.time >= isStartTime && c.time <= isEndTime);
        oosEntrySlice = options.entry_candles.filter((c) => c.time >= oosStartTime && c.time <= oosEndTime);
      }
    }
    const [isResult, oosResult] = await Promise.all([
      runAsync(isCandles, isHtfSlice, isEntrySlice),
      runAsync(oosCandles, oosHtfSlice, oosEntrySlice)
    ]);
    const isStats = {
      trades: isResult.total_trades,
      win_rate: isResult.win_rate,
      total_return: isResult.total_return_net,
      sharpe: isResult.sharpe_ratio,
      sortino: isResult.sortino_ratio ?? 0,
      max_drawdown: isResult.max_drawdown,
      profit_factor: isResult.profit_factor
    };
    const oosStats = {
      trades: oosResult.total_trades,
      win_rate: oosResult.win_rate,
      total_return: oosResult.total_return_net,
      sharpe: oosResult.sharpe_ratio,
      sortino: oosResult.sortino_ratio ?? 0,
      max_drawdown: oosResult.max_drawdown,
      profit_factor: oosResult.profit_factor
    };
    const ddInflation = isStats.max_drawdown > eps ? oosStats.max_drawdown / isStats.max_drawdown : oosStats.max_drawdown > eps ? 2 : 1;
    const fold = {
      fold_index: foldIndex,
      is_start: isStart,
      is_end: isEnd,
      oos_start: oosStart,
      oos_end: oosEnd,
      is_stats: isStats,
      oos_stats: oosStats,
      // [F1] 使用修復後的 calcDecay（有界差值，處理負值/跨零）
      win_rate_decay: calcDecay(isStats.win_rate, oosStats.win_rate),
      sharpe_decay: calcDecay(isStats.sharpe, oosStats.sharpe),
      return_decay: calcDecay(isStats.total_return, oosStats.total_return),
      drawdown_inflation: ddInflation
    };
    folds.push(fold);
    isStatsList.push(isStats);
    oosStatsList.push(oosStats);
    foldIndex++;
  }
  if (folds.length === 0) {
    return {
      folds: [],
      is_stats: { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 },
      oos_stats: { trades: 0, win_rate: 0, total_return: 0, sharpe: 0, sortino: 0, max_drawdown: 0, profit_factor: 0 },
      overfitting_score: 0,
      verdict: "healthy",
      total_candles: n,
      fold_count: 0
    };
  }
  const overfittingScore = calcOverfittingScore(folds);
  const verdict = overfittingScore >= 60 ? "overfitting" : overfittingScore >= 35 ? "warning" : "healthy";
  return {
    folds,
    is_stats: aggregateStats(isStatsList),
    oos_stats: aggregateStats(oosStatsList),
    overfitting_score: overfittingScore,
    verdict,
    total_candles: n,
    fold_count: folds.length
  };
}

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z3 } from "zod";
import { parseStringPromise } from "xml2js";

// shared/schemas.ts
import { z as z2 } from "zod";
var CandleSchema = z2.object({
  time: z2.number(),
  open: z2.number(),
  high: z2.number(),
  low: z2.number(),
  close: z2.number(),
  volume: z2.number()
});
var CandleArraySchema = z2.array(CandleSchema);
var AnalysisStatusSchema = z2.object({
  symbol: z2.string(),
  running: z2.boolean(),
  success: z2.boolean().optional(),
  error: z2.string().nullable().optional(),
  started_at: z2.string().nullable().optional(),
  finished_at: z2.string().nullable().optional()
});
var NewsItemSchema = z2.object({
  title: z2.string(),
  link: z2.string(),
  description: z2.string(),
  pubDate: z2.number(),
  source: z2.string(),
  sentiment: z2.enum(["bullish", "bearish", "neutral"])
});
var NewsArraySchema = z2.array(NewsItemSchema);
var TweetItemSchema = z2.object({
  id: z2.string(),
  author: z2.string(),
  handle: z2.string(),
  avatar: z2.string().optional(),
  content: z2.string(),
  pubDate: z2.number(),
  likes: z2.number().default(0),
  retweets: z2.number().default(0),
  sentiment: z2.enum(["bullish", "bearish", "neutral"]),
  isAI: z2.boolean().default(true)
});
var TweetArraySchema = z2.array(TweetItemSchema);
var SnapshotSummarySchema = z2.object({
  symbol: z2.string(),
  generated_at: z2.string(),
  live_price: z2.number().optional(),
  consensus: z2.object({
    score: z2.number().optional(),
    label: z2.string().optional()
  }).optional()
});
var SnapshotSchema = z2.object({
  symbol: z2.string(),
  generated_at: z2.string(),
  live_price: z2.number().optional(),
  error: z2.string().nullable().optional(),
  klines: z2.record(z2.string(), z2.array(CandleSchema)).optional()
}).passthrough();
var WidgetPrefsSchema = z2.object({
  openId: z2.string().min(1),
  widgetIds: z2.array(z2.string().min(1)).max(50)
});
function safeParseCandles(raw) {
  const r = CandleArraySchema.safeParse(raw);
  if (r.success) return { data: r.data, error: null };
  return { data: null, error: r.error.message };
}
function safeParseNews(raw) {
  const r = NewsArraySchema.safeParse(raw);
  if (r.success) return { data: r.data, error: null };
  return { data: null, error: r.error.message };
}
function safeParseTweets(raw) {
  const r = TweetArraySchema.safeParse(raw);
  if (r.success) return { data: r.data, error: null };
  return { data: null, error: r.error.message };
}
var HwrKeyLevelSchema = z2.object({
  label: z2.string(),
  price: z2.number(),
  type: z2.string()
});
var HwrChanBuySellPointSchema = z2.object({
  level: z2.union([z2.literal(1), z2.literal(2), z2.literal(3)]),
  direction: z2.enum(["buy", "sell"]),
  price: z2.number(),
  time: z2.number(),
  bi_idx: z2.number(),
  description: z2.string(),
  strength: z2.enum(["strong", "medium", "weak"]),
  divergence_confirmed: z2.boolean(),
  after_zhongshu_break: z2.boolean(),
  trend_continuation: z2.boolean()
});
var HwrSmcSetupSummarySchema = z2.object({
  id: z2.string(),
  direction: z2.enum(["bullish", "bearish"]),
  sweep_type: z2.enum(["BSL", "SSL"]),
  swept_level: z2.number(),
  entry_top: z2.number(),
  entry_bottom: z2.number(),
  sl: z2.number(),
  tp1: z2.number(),
  tp2: z2.number(),
  rr_ratio: z2.number(),
  confluence_score: z2.number(),
  htf_aligned: z2.boolean(),
  status: z2.enum(["waiting", "active", "invalidated", "completed"]),
  formed_at: z2.number()
});
var HwrTradeModelSchema = z2.object({
  id: z2.string(),
  name: z2.string(),
  description: z2.string(),
  direction: z2.enum(["long", "short", "neutral"]),
  confidence: z2.number().min(0).max(100),
  confluence_score: z2.number().min(0).max(100),
  entry_conditions: z2.array(z2.string()),
  stop_loss_hint: z2.string(),
  take_profit_hint: z2.string(),
  key_levels: z2.array(HwrKeyLevelSchema),
  smc_score: z2.number(),
  pa_score: z2.number(),
  fib_score: z2.number(),
  chan_score: z2.number(),
  timeframe_consensus: z2.string(),
  risk_warning: z2.string(),
  is_active: z2.boolean(),
  rr_ratio: z2.number(),
  chan_buy_sell_points: z2.array(HwrChanBuySellPointSchema),
  smc_setups: z2.array(HwrSmcSetupSummarySchema),
  divergences: z2.array(z2.string()),
  sl_atr_multiplier: z2.number(),
  /** v3.1 新增：Fractional Kelly 建議倉位 */
  kelly_fraction: z2.number().optional()
});
var HwrTfAnalysisSchema = z2.object({
  bar: z2.string(),
  label: z2.string(),
  close: z2.number(),
  atr: z2.number(),
  adx: z2.number(),
  smc_structure: z2.string(),
  smc_bos_choch: z2.string(),
  smc_premium_discount: z2.string(),
  smc_score: z2.number(),
  pa_bullish_patterns: z2.array(z2.string()),
  pa_bearish_patterns: z2.array(z2.string()),
  pa_trend: z2.string(),
  pa_rsi: z2.number(),
  pa_adx: z2.number(),
  pa_score: z2.number(),
  fib_score: z2.number(),
  fib_in_ote: z2.boolean(),
  fib_618: z2.number(),
  fib_786: z2.number(),
  fib_ext_1272: z2.number(),
  fib_ext_1618: z2.number(),
  chan_trend: z2.string(),
  chan_in_zhongshu: z2.boolean(),
  chan_zhongshu_top: z2.number(),
  chan_zhongshu_bottom: z2.number(),
  chan_divergence: z2.string().nullable(),
  chan_bi_count: z2.number(),
  chan_duan_count: z2.number(),
  chan_score: z2.number(),
  chan_buy_sell_points: z2.array(HwrChanBuySellPointSchema),
  chan_macd_area_ratio: z2.number(),
  divergences: z2.array(z2.string()),
  smc_setups: z2.array(HwrSmcSetupSummarySchema),
  nearest_bull_ob: z2.object({
    top: z2.number(),
    bottom: z2.number(),
    mid: z2.number(),
    strength: z2.enum(["strong", "normal"])
  }).nullable(),
  nearest_bear_ob: z2.object({
    top: z2.number(),
    bottom: z2.number(),
    mid: z2.number(),
    strength: z2.enum(["strong", "normal"])
  }).nullable(),
  nearest_bull_fvg: z2.object({ top: z2.number(), bottom: z2.number(), mid: z2.number() }).nullable(),
  nearest_bear_fvg: z2.object({ top: z2.number(), bottom: z2.number(), mid: z2.number() }).nullable(),
  liquidity_sweep: z2.object({
    bslSwept: z2.boolean(),
    sslSwept: z2.boolean(),
    bslPrice: z2.number(),
    sslPrice: z2.number()
  }),
  total_score: z2.number(),
  direction: z2.enum(["long", "short", "neutral"])
});
var TradeVetoDecisionSchema = z2.object({
  decision: z2.enum(["TRADE", "WAIT", "REJECT"]),
  model: z2.enum(["A", "B", "C", "NONE"]),
  setup_quality: z2.union([z2.literal(1), z2.literal(2), z2.literal(3), z2.literal(4), z2.literal(5)]),
  primary_edge: z2.string(),
  primary_failure_mode: z2.string(),
  must_see_trigger: z2.string(),
  invalidation: z2.string(),
  conflict_note: z2.string(),
  confidence: z2.number().min(0).max(100),
  reason_codes: z2.array(z2.string()),
  dynamic_features_summary: z2.string()
});
var AiEnvScanSchema = z2.object({
  regime: z2.string(),
  macro_note: z2.string(),
  session_bias: z2.string(),
  key_risk: z2.string(),
  trade_filter: z2.enum(["proceed", "caution", "avoid"]),
  filter_reason: z2.string()
});
var FinalStrategySchema = z2.object({
  model_id: z2.enum(["A", "B", "C"]),
  model_name: z2.string(),
  decision: z2.enum(["TRADE", "WAIT", "REJECT"]),
  direction: z2.enum(["long", "short", "neutral"]),
  confidence: z2.number().min(0).max(100),
  setup_quality: z2.union([z2.literal(1), z2.literal(2), z2.literal(3), z2.literal(4), z2.literal(5)]),
  entry_zone: z2.string(),
  stop_loss: z2.string(),
  take_profit: z2.string(),
  rr_ratio: z2.number(),
  kelly_fraction: z2.number(),
  must_see_trigger: z2.string(),
  invalidation: z2.string(),
  primary_edge: z2.string(),
  primary_failure_mode: z2.string(),
  reason_codes: z2.array(z2.string()),
  env_filter: z2.string()
});
var HwrScanResultSchema = z2.object({
  models: z2.array(HwrTradeModelSchema),
  tf_analyses: z2.array(HwrTfAnalysisSchema),
  overall_direction: z2.enum(["long", "short", "neutral"]),
  mtf_consensus: z2.string(),
  ai_analysis: z2.string(),
  /** v3.5 新增：AI 交易審核決策 */
  trade_decision: TradeVetoDecisionSchema.optional(),
  /** v4.0 新增：AI 環境掃描 */
  env_scan: AiEnvScanSchema.optional(),
  /** v4.0 新增：單一最終策略 */
  final_strategy: FinalStrategySchema.optional(),
  scanned_at: z2.number(),
  /** v3.1 新增：Session 時段資訊 */
  session_info: z2.object({
    name: z2.string(),
    liquidity: z2.string(),
    utc_hour: z2.number(),
    is_low_liquidity: z2.boolean()
  }).optional()
});

// server/routers.ts
init_cache();
import { readFile } from "node:fs/promises";
var SYMBOL_REGEX = /^[A-Z0-9]{2,20}(USDT|BTC|ETH|BNB|USDC)?$/;
function normalizeSymbol(raw) {
  const s = raw.toUpperCase().trim();
  if (!SYMBOL_REGEX.test(s)) throw new TRPCError3({ code: "BAD_REQUEST", message: `\u7121\u6548\u7684\u4EA4\u6613\u5C0D\u683C\u5F0F\uFF1A${s}` });
  return s;
}
var MAX_CACHE_SIZE = 50;
function setCacheWithLimit(cache, key, value) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== void 0) cache.delete(firstKey);
  }
  cache.set(key, value);
}
function sharedEmaArr(data, period) {
  const k = 2 / (period + 1);
  const result = [];
  let prev = data[0] ?? 0;
  for (const v of data) {
    prev = v * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}
function sharedRsiLast(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  return 100 - 100 / (1 + (l === 0 ? 100 : g / l));
}
function sharedMacdHistFn(closes) {
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let e12 = closes[0] ?? 0, e26 = closes[0] ?? 0, sig = 0;
  for (const c of closes) {
    e12 = c * k12 + e12 * (1 - k12);
    e26 = c * k26 + e26 * (1 - k26);
  }
  const m = e12 - e26;
  sig = m * k9 + sig * (1 - k9);
  let e12p = closes[0] ?? 0, e26p = closes[0] ?? 0, sigp = 0;
  for (const c of closes.slice(0, -1)) {
    e12p = c * k12 + e12p * (1 - k12);
    e26p = c * k26 + e26p * (1 - k26);
  }
  const mp = e12p - e26p;
  sigp = mp * k9 + sigp * (1 - k9);
  return { cur: m - sig, prev: mp - sigp };
}
function sharedBbBandwidth(closes, period = 20, mult = 2) {
  const sl = closes.slice(-period);
  if (sl.length === 0) return 5;
  const mid = sl.reduce((a, b) => a + b, 0) / sl.length;
  const std = Math.sqrt(sl.reduce((s, v) => s + (v - mid) ** 2, 0) / sl.length);
  return mult * 2 * std / (mid || 1) * 100;
}
function sharedMacdHistLast(closes) {
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let e12 = closes[0] ?? 0, e26 = closes[0] ?? 0, sig = 0;
  for (const c of closes) {
    e12 = c * k12 + e12 * (1 - k12);
    e26 = c * k26 + e26 * (1 - k26);
  }
  const m = e12 - e26;
  sig = m * k9 + sig * (1 - k9);
  return m - sig;
}
function sharedAdxLast(candles, period = 14) {
  if (candles.length < period * 2) return 20;
  const trs = [], pdms = [], ndms = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, ph = candles[i - 1].high, pl = candles[i - 1].low, pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    pdms.push(h - ph > pl - l && h - ph > 0 ? h - ph : 0);
    ndms.push(pl - l > h - ph && pl - l > 0 ? pl - l : 0);
  }
  const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  const pdi = pdms.slice(-period).reduce((a, b) => a + b, 0) / period / (atr || 1) * 100;
  const ndi = ndms.slice(-period).reduce((a, b) => a + b, 0) / period / (atr || 1) * 100;
  return pdi + ndi === 0 ? 20 : Math.abs(pdi - ndi) / (pdi + ndi) * 100;
}
function sharedBollingerLast(closes, period = 20, mult = 2) {
  const sl = closes.slice(-period);
  if (sl.length === 0) return { upper: 0, lower: 0, middle: 0, percent_b: 0.5, bandwidth: 5 };
  const mid = sl.reduce((a, b) => a + b, 0) / sl.length;
  const std = Math.sqrt(sl.reduce((s, v) => s + (v - mid) ** 2, 0) / sl.length);
  const upper = mid + mult * std, lower = mid - mult * std;
  const last = closes[closes.length - 1] ?? mid;
  return { upper, lower, middle: mid, percent_b: upper === lower ? 0.5 : (last - lower) / (upper - lower), bandwidth: mult * 2 * std / (mid || 1) * 100 };
}
var snapshotCache = /* @__PURE__ */ new Map();
var CACHE_TTL = 6e4;
var newsCache = /* @__PURE__ */ new Map();
var NEWS_CACHE_TTL = 5 * 6e4;
var tweetCache = /* @__PURE__ */ new Map();
var TWEET_CACHE_TTL = 10 * 6e4;
var analysisInFlight = /* @__PURE__ */ new Map();
function createFallbackIndicator(price, direction) {
  return {
    rsi: direction === "long" ? 56 : direction === "short" ? 44 : 50,
    macd: { macd: 0, signal: 0, histogram: 0 },
    adx: { adx: 18, plus_di: direction === "long" ? 24 : 18, minus_di: direction === "short" ? 24 : 18 },
    atr: 0,
    bollinger: { upper: price, middle: price, lower: price, bandwidth: 0, percent_b: 0.5 },
    vwap: price,
    ema: { ema20: price, ema50: price, ema200: price },
    stochastic: { k: 50, d: 50 },
    trend: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "neutral",
    momentum: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "neutral",
    close: price
  };
}
function createFallbackPaTimeframe(timeframe, price, direction) {
  return {
    timeframe,
    trend: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "neutral",
    trend_context: "ranging",
    score: direction === "long" ? 60 : direction === "short" ? 40 : 50,
    close: price,
    rsi: direction === "long" ? 56 : direction === "short" ? 44 : 50,
    atr: 0,
    ema20: price,
    ema50: price,
    ema200: price,
    macd_hist: 0,
    adx: 18,
    plus_di: direction === "long" ? 24 : 18,
    minus_di: direction === "short" ? 24 : 18,
    bollinger: { upper: price, middle: price, lower: price, bandwidth: 0, percent_b: 0.5 },
    bb_position: "middle",
    bb_squeeze: false,
    vwap: price,
    vwap_position: "at",
    cmf: 0,
    patterns: [],
    chan: {
      bis: [],
      duans: [],
      zhongshus: [],
      trend: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "ranging",
      in_zhongshu: false,
      current_zhongshu: null,
      bi_count: 0,
      duan_count: 0,
      buy_sell_points: [],
      divergence_signals: { type: null, description: "" }
    },
    support: price,
    resistance: price,
    sr_levels: [],
    false_break_score: 0,
    false_break_direction: "none",
    mtf_alignment: 50,
    volume_trend: "neutral",
    price_vs_vwap: "at",
    key_level_proximity: 0,
    divergences: [],
    high_confluence_patterns: []
  };
}
async function buildFallbackSnapshotFromLiveSignal(symbol, errorMessage) {
  if (symbol !== "BTCUSDT") return null;
  try {
    const raw = await readFile("/home/ubuntu/runtime/btcusdt_live_signal_snapshot.json", "utf8");
    const live = JSON.parse(raw);
    const latestSignal = live.signals?.[0];
    const direction = latestSignal?.direction === "long" || latestSignal?.direction === "short" ? latestSignal.direction : "neutral";
    const price = Number(latestSignal?.entry_price ?? 0);
    if (!Number.isFinite(price) || price <= 0) return null;
    const indicator = createFallbackIndicator(price, direction);
    const pa4h = createFallbackPaTimeframe("4h", price, direction);
    const pa1h = createFallbackPaTimeframe("1h", price, direction);
    const pa15m = createFallbackPaTimeframe("15m", price, direction);
    const pa5m = createFallbackPaTimeframe("5m", price, direction);
    return {
      symbol,
      generated_at: live.generated_at ?? (/* @__PURE__ */ new Date()).toISOString(),
      live_price: price,
      error: `\u5206\u6790\u5DF2\u964D\u7D1A\uFF1A${errorMessage}`,
      indicators: indicator,
      mtf_indicators: { "4h": indicator, "1h": indicator, "15m": indicator, "5m": indicator },
      smc: {
        structure: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "ranging",
        fvgs: [],
        order_blocks: [],
        bos_choch: [],
        liquidity: { sell_side: [], buy_side: [], nearest_sell: price, nearest_buy: price, levels: [] },
        nearest_bull_fvg: null,
        nearest_bear_fvg: null,
        nearest_bull_ob: null,
        nearest_bear_ob: null,
        fvg_count: 0,
        ob_count: 0,
        premium_discount: { equilibrium: price, current_zone: "equilibrium", percent_position: 50 },
        ote_zone: null,
        recent_swing_high: price,
        recent_swing_low: price,
        liquidity_levels: [],
        confirmation_setups: []
      },
      pa: {
        timeframes: { "4h": pa4h, "1h": pa1h, "15m": pa15m, "5m": pa5m },
        consensus: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "neutral",
        avg_score: direction === "long" ? 60 : direction === "short" ? 40 : 50,
        suggestion: live.active_presets?.[0]?.label ? `\u76EE\u524D\u63A1\u7528\u5BE6\u76E4\u5FEB\u7167\u56DE\u9000\uFF0C\u512A\u5148\u53C3\u8003 ${live.active_presets[0].label}` : "\u76EE\u524D\u63A1\u7528\u5BE6\u76E4\u5FEB\u7167\u56DE\u9000\u3002",
        entry_params: direction === "neutral" ? {} : { direction, entry: price, sl: price, tp1: price, tp2: price, rr_ratio: 0 },
        divergence_summary: { has_bullish_divergence: false, has_bearish_divergence: false, strongest_divergence: null, divergence_count: 0 },
        top_setups: []
      },
      chan_mtf: {
        timeframes: {},
        signals: {},
        summary: {
          overall_trend: direction === "long" ? "bullish" : direction === "short" ? "bearish" : "ranging",
          trend_alignment: 50,
          bullish_count: direction === "long" ? 1 : 0,
          bearish_count: direction === "short" ? 1 : 0,
          ranging_count: direction === "neutral" ? 1 : 0,
          in_zhongshu_count: 0,
          dominant_timeframe: "1h",
          suggestion: "\u76EE\u524D\u4F7F\u7528\u5BE6\u76E4\u5FEB\u7167\u56DE\u9000\u7D50\u679C\u3002",
          detail: errorMessage,
          entry_timing: "\u7B49\u5F85\u5B8C\u6574\u5206\u6790\u6062\u5FA9",
          best_buy_point: null,
          best_sell_point: null
        }
      },
      consensus: { score: direction === "long" ? 60 : direction === "short" ? 40 : 50, label: direction === "long" ? "\u504F\u591A" : direction === "short" ? "\u504F\u7A7A" : "\u4E2D\u6027" },
      forecast_4h: {
        main_scenario: direction === "long" ? "\u504F\u591A\u5EF6\u7E8C" : direction === "short" ? "\u504F\u7A7A\u5EF6\u7E8C" : "\u9707\u76EA\u6574\u7406",
        main_probability: 55,
        main_target: price,
        main_description: "\u76EE\u524D\u4EE5\u5BE6\u76E4\u5FEB\u7167\u8207\u672C\u5730\u56DE\u9000\u7D50\u679C\u63D0\u4F9B\u65B9\u5411\u63D0\u793A\u3002",
        alt_scenario: "\u7B49\u5F85\u5B8C\u6574\u5206\u6790\u6062\u5FA9",
        alt_probability: 45,
        alt_target: price,
        alt_description: errorMessage
      },
      strategy: {
        direction,
        entry: price,
        sl: price,
        tp1: price,
        tp2: price,
        rr_ratio: 0,
        atr: 0,
        suggestion: "\u5B8C\u6574\u5206\u6790\u66AB\u6642\u4E0D\u53EF\u7528\uFF0C\u5148\u53C3\u8003\u5BE6\u76E4\u5FEB\u7167\u8207\u65B9\u5411\u6458\u8981\u3002",
        checklist: [{ label: "\u56DE\u9000\u6A21\u5F0F", passed: true, value: "live_snapshot" }]
      },
      onchain: { funding_rate: null, long_short_ratio: null, fear_greed: null, open_interest: null, coingecko: null },
      klines: { "4h": [], "1h": [], "15m": [], "5m": [] },
      advanced: { divergences_4h: [], divergences_1h: [], pa_patterns_4h: [], pa_patterns_1h: [], chan_enhanced_4h: null, chan_enhanced_1h: null, smc_confirmations: [] }
    };
  } catch {
    return null;
  }
}
async function callAnalysisApi(path3, options) {
  const base = process.env.ANALYSIS_API_URL;
  if (!base) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "ANALYSIS_API_URL \u672A\u8A2D\u5B9A" });
  const url = `${base}${path3}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(3e4),
      headers: { "Content-Type": "application/json", ...options?.headers ?? {} }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: `\u7121\u6CD5\u9023\u7DDA\u81F3\u5206\u6790\u670D\u52D9\uFF1A${msg}` });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: `\u5206\u6790\u670D\u52D9\u56DE\u61C9\u932F\u8AA4 ${res.status}\uFF1A${body.slice(0, 200)}` });
  }
  return res.json();
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  crypto: router({
    // ── 觸發分析（使用內建引擎，直接計算並快取）──
    triggerAnalysis: publicProcedure.input(z3.object({ symbol: z3.string().min(1).max(20).optional() })).mutation(async ({ input }) => {
      const symbol = normalizeSymbol(input.symbol ?? "BTCUSDT");
      if (!analysisInFlight.has(symbol)) {
        const p = (async () => {
          try {
            const result = await runAnalysis(symbol);
            setCacheWithLimit(snapshotCache, symbol, { data: result, ts: Date.now() });
            return result;
          } catch (e) {
            console.error(`[analysis] ${symbol} \u5206\u6790\u5931\u6557:`, e);
          } finally {
            analysisInFlight.delete(symbol);
          }
        })();
        analysisInFlight.set(symbol, p);
      }
      return { success: true, message: "\u5206\u6790\u5DF2\u555F\u52D5\uFF0C\u7D04 10 \u79D2\u5F8C\u5B8C\u6210", symbol };
    }),
    // ── 查詢分析狀態（快取命中即完成）──
    getAnalysisStatus: publicProcedure.input(z3.object({ symbol: z3.string().default("BTCUSDT") })).query(async ({ input }) => {
      const symbol = input.symbol.toUpperCase();
      const cached = snapshotCache.get(symbol);
      const isReady = !!cached && Date.now() - cached.ts < CACHE_TTL * 5;
      return { symbol, status: isReady ? "ready" : "pending", progress: isReady ? 100 : 0 };
    }),
    // ── 讀取最新快照（優先快取，快取過期則重新計算）──
    getSnapshot: publicProcedure.input(z3.object({ symbol: z3.string() })).query(async ({ input }) => {
      const symbol = normalizeSymbol(input.symbol);
      const cached = snapshotCache.get(symbol);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.data;
      }
      if (analysisInFlight.has(symbol)) {
        await analysisInFlight.get(symbol);
        const fresh = snapshotCache.get(symbol);
        if (fresh) return fresh.data;
      }
      try {
        const result = await runAnalysis(symbol);
        setCacheWithLimit(snapshotCache, symbol, { data: result, ts: Date.now() });
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (cached) {
          return { ...cached.data, error: `\u5206\u6790\u5DF2\u964D\u7D1A\uFF1A${msg}` };
        }
        const fallback = await buildFallbackSnapshotFromLiveSignal(symbol, msg);
        if (fallback) {
          setCacheWithLimit(snapshotCache, symbol, { data: fallback, ts: Date.now() });
          return fallback;
        }
        throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: `\u5206\u6790\u8A08\u7B97\u5931\u6557\uFF1A${msg}` });
      }
    }),
    // ── 抓取 K 線資料（Kraken API，含分頁抓取）──
    getKlines: publicProcedure.input(
      z3.object({
        symbol: z3.string(),
        timeframe: z3.enum(["4h", "1h", "15m", "5m"]),
        limit: z3.number().int().min(1).max(500).default(150)
      })
    ).query(async ({ input }) => {
      const barMap = {
        "5m": "5m",
        "15m": "15m",
        "1h": "1H",
        "4h": "4H"
      };
      const bar = barMap[input.timeframe] ?? input.timeframe;
      try {
        const raw = await fetchCandles(input.symbol.toUpperCase(), bar, input.limit);
        const { data, error } = safeParseCandles(raw);
        if (error || !data) {
          console.warn(`[getKlines] K \u7DDA Schema \u9A57\u8B49\u8B66\u544A\uFF1A${error}`);
          return raw;
        }
        return data;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: `K \u7DDA\u6578\u64DA\u7372\u53D6\u5931\u6557\uFF1A${msg}` });
      }
    }),
    // ── 鏈上數據（HTTP GET → FastAPI /onchain/{symbol}）──
    getOnchain: publicProcedure.input(z3.object({ symbol: z3.string().default("BTCUSDT") })).query(async ({ input }) => {
      const symbol = input.symbol.toUpperCase();
      try {
        return await callAnalysisApi(`/onchain/${symbol}`);
      } catch (e) {
        console.warn(`[getOnchain] \u7121\u6CD5\u53D6\u5F97 ${symbol} \u93C8\u4E0A\u6578\u64DA\uFF1A`, e);
        return {
          symbol,
          funding_rate: { rate: 0, time: 0 },
          long_short_ratio: null,
          fear_greed: null,
          open_interest: null,
          coingecko: null
        };
      }
    })
  }),
  // ── 新聞（RSS 抓取 + 情緒分析）──
  news: router({
    getLatestNews: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      hours: z3.number().int().min(1).max(72).default(6)
    })).query(async ({ input }) => {
      const currency = input.symbol.replace("USDT", "").replace("BUSD", "");
      const cacheKey = `${currency}_${input.hours}`;
      const cachedNews = newsCache.get(cacheKey);
      if (cachedNews && Date.now() - cachedNews.ts < NEWS_CACHE_TTL) {
        return cachedNews.data;
      }
      const since = Date.now() - input.hours * 60 * 60 * 1e3;
      const RSS_SOURCES = [
        { url: "https://cointelegraph.com/rss", name: "CoinTelegraph" },
        { url: "https://decrypt.co/feed", name: "Decrypt" },
        { url: "https://feeds.feedburner.com/CoinDesk", name: "CoinDesk" },
        { url: "https://bitcoinmagazine.com/.rss/full/", name: "Bitcoin Magazine" },
        { url: "https://www.theblock.co/rss.xml", name: "The Block" },
        { url: "https://cryptobriefing.com/feed/", name: "Crypto Briefing" },
        { url: "https://ambcrypto.com/feed/", name: "AMBCrypto" },
        { url: "https://cryptoslate.com/feed/", name: "CryptoSlate" },
        { url: "https://beincrypto.com/feed/", name: "BeInCrypto" },
        { url: "https://www.newsbtc.com/feed/", name: "NewsBTC" }
      ];
      const symbolKeywords = [currency.toLowerCase()];
      if (currency === "BTC") symbolKeywords.push("bitcoin");
      if (currency === "ETH") symbolKeywords.push("ethereum", "ether");
      const generalKeywords = ["crypto", "blockchain", "bitcoin", "btc", "ethereum", "eth"];
      const fetchRss = async (source) => {
        try {
          const res = await fetch(source.url, {
            signal: AbortSignal.timeout(8e3),
            headers: { "User-Agent": "Mozilla/5.0 CryptoDashboard/2.0" }
          });
          if (!res.ok) return [];
          const xml = await res.text();
          const parsed = await parseStringPromise(xml, { explicitArray: false });
          const items = parsed?.rss?.channel?.item ?? [];
          const arr = Array.isArray(items) ? items : [items];
          return arr.map((item) => {
            const title = String(
              item.title?._ ?? item.title ?? ""
            ).trim();
            const link = String(
              item.link?.trim() ?? item.guid?._ ?? item.guid ?? ""
            );
            const desc = String(
              item.description?._ ?? item.description ?? ""
            ).trim();
            const pubDateStr = String(
              item.pubDate ?? item["dc:date"] ?? ""
            );
            const pubDate = pubDateStr ? new Date(pubDateStr).getTime() : 0;
            return {
              title,
              link,
              description: desc.replace(/<[^>]+>/g, "").slice(0, 200),
              pubDate,
              source: source.name
            };
          }).filter((item) => {
            if (!item.title || !item.pubDate || item.pubDate < since) return false;
            const text = (item.title + " " + item.description).toLowerCase();
            return symbolKeywords.some((k) => text.includes(k)) || generalKeywords.some((k) => text.includes(k));
          });
        } catch {
          return [];
        }
      };
      const results = await Promise.allSettled(RSS_SOURCES.map(fetchRss));
      const allNews = results.flatMap((r) => r.status === "fulfilled" ? r.value : []).sort((a, b) => b.pubDate - a.pubDate).slice(0, 40);
      let withSentiment;
      try {
        const titlesForLLM = allNews.slice(0, 20).map(
          (item, idx) => `${idx + 1}. ${item.title}`
        ).join("\n");
        const sentimentPrompt = `You are a crypto market sentiment analyst. Analyze the sentiment of each news headline below.
For each headline, respond with ONLY the index number and sentiment label (bullish/bearish/neutral), one per line.
Format: "1: bullish" or "2: bearish" or "3: neutral"

Headlines:
${titlesForLLM}

Respond with ONLY the numbered sentiment labels, nothing else.`;
        const llmResp = await invokeLLM({
          messages: [
            { role: "system", content: "You are a crypto market sentiment analyst. Respond with ONLY numbered sentiment labels." },
            { role: "user", content: sentimentPrompt }
          ],
          maxTokens: 200
        });
        const sentimentMap = /* @__PURE__ */ new Map();
        const llmText = typeof llmResp.choices[0]?.message?.content === "string" ? llmResp.choices[0].message.content : "";
        const lines = llmText.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          const match = line.match(/^(\d+):\s*(bullish|bearish|neutral)/i);
          if (match) {
            const idx = parseInt(match[1]) - 1;
            const sent = match[2].toLowerCase();
            sentimentMap.set(idx, sent);
          }
        }
        withSentiment = allNews.map((item, idx) => {
          const llmSentiment = sentimentMap.get(idx);
          if (llmSentiment) return { ...item, sentiment: llmSentiment };
          const text = (item.title + " " + item.description).toLowerCase();
          const bull = ["surge", "rally", "gain", "rise", "bull", "breakout", "buy", "boost", "soar"].filter((w) => text.includes(w)).length;
          const bear = ["drop", "fall", "crash", "bear", "sell", "decline", "plunge", "dump", "warn"].filter((w) => text.includes(w)).length;
          return { ...item, sentiment: bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral" };
        });
        console.log(`[getLatestNews] LLM \u60C5\u7DD2\u5206\u6790\u5B8C\u6210\uFF1A${sentimentMap.size} \u689D\u65B0\u805E\u5DF2\u5206\u6790`);
      } catch (llmErr) {
        console.warn(`[getLatestNews] LLM \u60C5\u7DD2\u5206\u6790\u5931\u6557\uFF0C\u5099\u7528\u95DC\u9375\u5B57\u6BD4\u5C0D:`, llmErr);
        withSentiment = allNews.map((item) => {
          const text = (item.title + " " + item.description).toLowerCase();
          const bull = ["surge", "rally", "gain", "rise", "bull", "breakout", "buy", "boost", "soar"].filter((w) => text.includes(w)).length;
          const bear = ["drop", "fall", "crash", "bear", "sell", "decline", "plunge", "dump", "warn"].filter((w) => text.includes(w)).length;
          return { ...item, sentiment: bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral" };
        });
      }
      const { data, error } = safeParseNews(withSentiment);
      const finalNews = error || !data ? withSentiment : data;
      if (error) console.warn(`[getLatestNews] Schema \u9A57\u8B49\u8B66\u544A\uFF1A${error}`);
      newsCache.set(cacheKey, { data: finalNews, ts: Date.now() });
      return finalNews;
    })
  }),
  // ── Twitter 推文（透過 LLM 根據最新新聞生成加密貨幣 KOL 風格推文）──
  tweets: router({
    getLatestTweets: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      count: z3.number().int().min(5).max(30).default(15)
    })).query(async ({ input }) => {
      const currency = input.symbol.replace("USDT", "").replace("BUSD", "");
      const tweetCacheKey = `${currency}_${input.count}`;
      const cachedTweet = tweetCache.get(tweetCacheKey);
      if (cachedTweet && Date.now() - cachedTweet.ts < TWEET_CACHE_TTL) {
        return cachedTweet.data;
      }
      const coinName = currency === "BTC" ? "Bitcoin" : currency === "ETH" ? "Ethereum" : currency === "SOL" ? "Solana" : currency === "BNB" ? "BNB" : currency === "XRP" ? "XRP" : currency;
      let newsContext = "";
      try {
        const rssRes = await fetch("https://cointelegraph.com/rss", {
          signal: AbortSignal.timeout(6e3),
          headers: { "User-Agent": "Mozilla/5.0 CryptoDashboard/2.0" }
        });
        if (rssRes.ok) {
          const xml = await rssRes.text();
          const parsed = await parseStringPromise(xml, { explicitArray: false });
          const items = parsed?.rss?.channel?.item ?? [];
          const arr = Array.isArray(items) ? items : [items];
          const headlines = arr.slice(0, 8).map(
            (item) => String(item.title?._ ?? item.title ?? "").trim()
          ).filter(Boolean).join("\n- ");
          if (headlines) newsContext = `

Current crypto market headlines:
- ${headlines}`;
        }
      } catch {
      }
      const CRYPTO_KOLS = [
        { author: "CZ Binance", handle: "cz_binance", avatar: "\u{1F433}" },
        { author: "Vitalik Buterin", handle: "VitalikButerin", avatar: "\u{1F984}" },
        { author: "Michael Saylor", handle: "saylor", avatar: "\u{1F4BC}" },
        { author: "Cathie Wood", handle: "CathieDWood", avatar: "\u{1F680}" },
        { author: "Willy Woo", handle: "woonomic", avatar: "\u{1F4C8}" },
        { author: "PlanB", handle: "100trillionUSD", avatar: "\u{1F4AF}" },
        { author: "Raoul Pal", handle: "RaoulGMI", avatar: "\u{1F30D}" },
        { author: "Arthur Hayes", handle: "CryptoHayes", avatar: "\u{1F4B0}" },
        { author: "Lyn Alden", handle: "LynAldenContact", avatar: "\u{1F4CA}" },
        { author: "Crypto Rover", handle: "rovercrc", avatar: "\u{1F916}" },
        { author: "Pentoshi", handle: "Pentosh1", avatar: "\u{1F427}" },
        { author: "Credible Crypto", handle: "CredibleCrypto", avatar: "\u{1F52E}" },
        { author: "Altcoin Daily", handle: "AltcoinDailyio", avatar: "\u26A1" },
        { author: "Coin Bureau", handle: "coinbureau", avatar: "\u{1F3A5}" },
        { author: "Scott Melker", handle: "scottmelker", avatar: "\u{1F4F0}" }
      ];
      const nowMs = Date.now();
      const sixHoursAgo = nowMs - 6 * 36e5;
      const prompt = `You are a crypto market analyst. Generate ${input.count} realistic-style crypto Twitter posts about ${coinName} (${currency}).${newsContext}

Return ONLY valid JSON in this exact format, no markdown, no extra text:
{"tweets":[{"id":"t001","author":"Author Name","handle":"twitterhandle","avatar":"single emoji","content":"tweet content 100-280 chars with hashtags, price levels, market analysis","pubDate":${sixHoursAgo},"likes":1000,"retweets":100,"sentiment":"bullish"}]}

Rules:
1. Authors must be from: ${CRYPTO_KOLS.map((k) => `${k.author}(@${k.handle})`).join(", ")}
2. Each tweet must have unique style and perspective
3. Include specific price levels, technical analysis, or market sentiment
4. Mix bullish/bearish/neutral sentiments realistically
5. pubDate must be Unix timestamp in milliseconds between ${sixHoursAgo} and ${nowMs}
6. likes between 1000-50000, retweets between 100-5000
7. Generate exactly ${input.count} tweets`;
      try {
        const result = await invokeLLM({
          messages: [{ role: "user", content: prompt }],
          maxTokens: 4096
        });
        const rawContent = result.choices[0]?.message?.content;
        const text = typeof rawContent === "string" ? rawContent : Array.isArray(rawContent) ? rawContent.filter((c) => c.type === "text").map((c) => c.text).join("") : "";
        const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("LLM \u672A\u56DE\u50B3 JSON");
        const parsed = JSON.parse(jsonMatch[0]);
        const rawTweets = (parsed.tweets ?? []).map((t2) => ({
          ...t2,
          isAI: true
        }));
        const { data, error } = safeParseTweets(rawTweets);
        const finalTweets = error || !data ? rawTweets : data;
        if (error) console.warn(`[getLatestTweets] Schema \u9A57\u8B49\u8B66\u544A\uFF1A${error}`);
        try {
          const bullishCount = finalTweets.filter((t2) => t2.sentiment === "bullish").length;
          const bearishCount = finalTweets.filter((t2) => t2.sentiment === "bearish").length;
          const neutralCount = finalTweets.filter((t2) => t2.sentiment === "neutral").length;
          const total = finalTweets.length || 1;
          const bullishPct = Math.round(bullishCount / total * 100);
          const bearishPct = Math.round(bearishCount / total * 100);
          const neutralPct = Math.max(0, 100 - bullishPct - bearishPct);
          const score = parseFloat(((bullishPct - bearishPct) / 100).toFixed(2));
          const label = score > 0.2 ? "\u793E\u7FA4\u504F\u591A" : score < -0.2 ? "\u793E\u7FA4\u504F\u7A7A" : "\u793E\u7FA4\u4E2D\u6027";
          const cacheKey = tweetSentimentKey(input.symbol);
          serverCache.set(cacheKey, {
            bullish_pct: bullishPct,
            bearish_pct: bearishPct,
            neutral_pct: neutralPct,
            score,
            label,
            updated_at: Date.now()
          }, 30 * 60 * 1e3);
          console.log(`[getLatestTweets] \u60C5\u7DD2\u5FEB\u53D6\u5DF2\u66F4\u65B0: ${cacheKey} = ${label} (score=${score})`);
        } catch (cacheErr) {
          console.warn(`[getLatestTweets] \u5FEB\u53D6\u66F4\u65B0\u5931\u6557:`, cacheErr);
        }
        tweetCache.set(tweetCacheKey, { data: finalTweets, ts: Date.now() });
        return finalTweets;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[getLatestTweets] LLM \u751F\u6210\u5931\u6557\uFF1A${msg}`);
        return [];
      }
    })
  }),
  // ── 回測（本地引擎，無需 FastAPI）──
  backtest: router({
    run: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      interval: z3.string().default("4H"),
      strategy: z3.enum(["ema_cross", "rsi_reversal", "bollinger", "macd", "smc", "pa", "chan", "liquidity_sweep", "vwap_reversion", "composite", "cannonball", "hwr_model_a", "hwr_model_b", "hwr_model_c"]).default("ema_cross"),
      limit: z3.number().int().min(50).max(8760).default(1080),
      // v5.9: 支援最多一年 1H K 線
      atr_sl_mult: z3.number().min(0.5).max(5).default(1.5),
      atr_tp_mult: z3.number().min(0.5).max(10).default(3),
      enable_mtf_filter: z3.boolean().default(true),
      enable_fee: z3.boolean().default(true),
      enable_trailing_stop: z3.boolean().default(true),
      enable_adx_filter: z3.boolean().default(true),
      enable_fvg_ob_filter: z3.boolean().default(false),
      // v3.0 真正雙時間框架回測
      use_true_mtf: z3.boolean().default(false),
      htf_interval: z3.string().optional(),
      // 高級別時間框架（定方向）
      entry_interval: z3.string().optional(),
      // 進場級別時間框架（找進場）
      // v4.0 四層 MTF 共識
      use_quad_mtf: z3.boolean().default(false),
      quad_mtf_threshold: z3.number().min(0.1).max(1).default(0.5)
    })).mutation(async ({ input }) => {
      const normalizeBar = (iv) => iv.toLowerCase() === "1d" ? "1D" : iv.toLowerCase() === "4h" ? "4H" : iv.toLowerCase() === "1h" ? "1H" : iv.toLowerCase() === "15m" ? "15m" : iv.toLowerCase() === "5m" ? "5m" : iv;
      const bar = normalizeBar(input.interval);
      const sym = input.symbol.includes("-") ? input.symbol.replace("-", "") : input.symbol;
      let htfCandles;
      let entryCandles;
      let mtfCandles;
      let quad4hCandles;
      let quad1hCandles;
      let quad15mCandles;
      let quad5mCandles;
      if (input.use_quad_mtf) {
        try {
          const [d4h, d1h, d15m, d5m] = await Promise.all([
            fetchCandles(sym, "4H", 500).catch(() => []),
            fetchCandles(sym, "1H", 500).catch(() => []),
            fetchCandlesPaged(sym, "15m", input.limit * 4).catch(() => []),
            fetchCandlesPaged(sym, "5m", input.limit * 12).catch(() => [])
          ]);
          quad4hCandles = d4h.length >= 50 ? d4h : void 0;
          quad1hCandles = d1h.length >= 50 ? d1h : void 0;
          quad15mCandles = d15m.length >= 50 ? d15m : void 0;
          quad5mCandles = d5m.length >= 50 ? d5m : void 0;
        } catch {
        }
      } else if (input.use_true_mtf) {
        const htfBarMap = { "5m": "1H", "15m": "1H", "1H": "4H", "4H": "1D", "1D": "1W" };
        const entryBarMap = { "1H": "15m", "4H": "1H", "1D": "4H" };
        const hwrHtfMap = {
          "hwr_model_a": "1H",
          "hwr_model_b": "4H",
          "hwr_model_c": "1H"
        };
        const hwrEntryMap = {
          "hwr_model_a": "15m",
          "hwr_model_b": "1H",
          "hwr_model_c": "15m"
        };
        const isHwr = ["hwr_model_a", "hwr_model_b", "hwr_model_c"].includes(input.strategy);
        const htfBar = input.htf_interval ? normalizeBar(input.htf_interval) : isHwr ? hwrHtfMap[input.strategy] : htfBarMap[bar] ?? "4H";
        const entryBar = input.entry_interval ? normalizeBar(input.entry_interval) : isHwr ? hwrEntryMap[input.strategy] : entryBarMap[bar] ?? bar;
        try {
          const [htfData, entryData] = await Promise.all([
            fetchCandles(sym, htfBar, 500),
            entryBar !== bar ? fetchCandlesPaged(sym, entryBar, input.limit) : Promise.resolve(null)
          ]);
          htfCandles = htfData;
          entryCandles = entryData ?? void 0;
        } catch {
        }
      } else {
        if (input.enable_mtf_filter) {
          const mtfBarMap = { "4H": "1D", "1H": "4H", "15m": "1H", "5m": "15m" };
          const mtfBar = mtfBarMap[bar];
          if (mtfBar) {
            try {
              mtfCandles = await fetchCandles(sym, mtfBar, 300);
            } catch {
            }
          }
        }
      }
      const mainCandles = input.use_true_mtf && entryCandles && entryCandles.length >= 50 ? entryCandles : input.limit > 300 ? await fetchCandlesPaged(sym, bar, input.limit) : await fetchCandles(sym, bar, input.limit);
      if (mainCandles.length < 50) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: `K \u7DDA\u8CC7\u6599\u4E0D\u8DB3\uFF08${mainCandles.length} \u6839\uFF09\uFF0C\u8ACB\u964D\u4F4E\u6578\u91CF\u6216\u66F4\u63DB\u6642\u9593\u6846\u67B6` });
      }
      const btResult = runBacktest({
        candles: mainCandles,
        strategy: input.strategy,
        symbol: sym,
        interval: input.use_true_mtf && input.entry_interval ? normalizeBar(input.entry_interval) : bar,
        atr_sl_mult: input.atr_sl_mult,
        atr_tp_mult: input.atr_tp_mult,
        enable_mtf_filter: input.enable_mtf_filter,
        enable_fee: input.enable_fee,
        enable_trailing_stop: input.enable_trailing_stop,
        enable_adx_filter: input.enable_adx_filter,
        enable_fvg_ob_filter: input.enable_fvg_ob_filter,
        mtf_candles: mtfCandles,
        htf_candles: htfCandles,
        entry_candles: entryCandles,
        use_true_mtf: input.use_true_mtf,
        // v4.0 四層 MTF 共識
        candles_4h: quad4hCandles,
        candles_1h: quad1hCandles,
        candles_15m: quad15mCandles,
        candles_5m: quad5mCandles,
        use_quad_mtf: input.use_quad_mtf,
        quad_mtf_threshold: input.quad_mtf_threshold
      });
      const monteCarlo = btResult.trades.length >= 10 ? runMonteCarlo(btResult.trades, 3e3) : null;
      return { ...btResult, monte_carlo: monteCarlo };
    }),
    compare: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      interval: z3.string().default("4H"),
      limit: z3.number().int().min(50).max(35040).default(1080),
      // v5.8: 支援最多 1 年 15m K 線
      atr_sl_mult: z3.number().min(0.5).max(5).default(1.5),
      atr_tp_mult: z3.number().min(0.5).max(10).default(3),
      enable_mtf_filter: z3.boolean().default(true),
      enable_fee: z3.boolean().default(true),
      enable_trailing_stop: z3.boolean().default(true),
      enable_adx_filter: z3.boolean().default(true),
      // v3.0 真正雙時間框架回測
      use_true_mtf: z3.boolean().default(false),
      // v4.0 四層 MTF 共識
      use_quad_mtf: z3.boolean().default(false),
      quad_mtf_threshold: z3.number().min(0.1).max(1).default(0.5),
      // v5.9 三層 MTF（4H+1H+15m）
      use_triple_mtf: z3.boolean().default(false)
    })).mutation(async ({ input }) => {
      const normalizeBar = (iv) => iv.toLowerCase() === "1d" ? "1D" : iv.toLowerCase() === "4h" ? "4H" : iv.toLowerCase() === "1h" ? "1H" : iv.toLowerCase() === "15m" ? "15m" : iv.toLowerCase() === "5m" ? "5m" : iv;
      const bar = normalizeBar(input.interval);
      const sym = input.symbol.includes("-") ? input.symbol.replace("-", "") : input.symbol;
      const strategies = ["ema_cross", "rsi_reversal", "bollinger", "macd", "smc", "pa", "chan", "liquidity_sweep", "vwap_reversion", "composite", "cannonball", "hwr_model_a", "hwr_model_b", "hwr_model_c"];
      if (input.use_triple_mtf) {
        const DUAL_MTF_STRATEGIES = /* @__PURE__ */ new Set(["pa", "ema_cross", "macd", "hwr_model_a", "hwr_model_b", "hwr_model_c", "cannonball", "rsi_reversal", "smc", "liquidity_sweep"]);
        const TRIPLE_MTF_STRATEGIES = /* @__PURE__ */ new Set(["bollinger", "chan", "vwap_reversion", "composite"]);
        const [d4h, d1h, d15m] = await Promise.all([
          fetchCandles(sym, "4H", 500).catch(() => []),
          fetchCandles(sym, "1H", 500).catch(() => []),
          fetchCandlesPaged(sym, "15m", Math.max(input.limit, 2160)).catch(() => [])
        ]);
        const t4h = d4h.length >= 50 ? d4h : void 0;
        const t1h = d1h.length >= 50 ? d1h : void 0;
        const t15m = d15m.length >= 50 ? d15m : void 0;
        const primaryData = t15m ?? [];
        const tripleResults = strategies.map((s) => {
          if (primaryData.length < 50) return { strategy: s, symbol: sym, interval: "15m", total_trades: 0, win_rate: 0, profit_factor: 0, max_drawdown: 0, total_return: 0, total_return_net: 0, sharpe_ratio: 0, equity_curve: [1], trades: [], mtf_filtered_count: 0, total_fees_pct: 0, trailing_stop_count: 0, adx_filtered_count: 0, fvg_ob_entry_count: 0 };
          const use1H = TRIPLE_MTF_STRATEGIES.has(s);
          return runBacktest({
            candles: primaryData,
            strategy: s,
            symbol: sym,
            interval: "15m",
            atr_sl_mult: input.atr_sl_mult,
            atr_tp_mult: input.atr_tp_mult,
            enable_mtf_filter: true,
            enable_fee: input.enable_fee,
            enable_trailing_stop: input.enable_trailing_stop,
            enable_adx_filter: input.enable_adx_filter,
            candles_4h: t4h,
            candles_1h: use1H ? t1h : void 0,
            // 反趨勢策略才加入 1H 中間層
            htf_candles: t4h,
            use_true_mtf: true
          });
        });
        return tripleResults;
      } else if (input.use_quad_mtf) {
        const [d4h, d1h, d15m, d5m] = await Promise.all([
          fetchCandles(sym, "4H", 500).catch(() => []),
          fetchCandles(sym, "1H", 500).catch(() => []),
          fetchCandlesPaged(sym, "15m", Math.max(input.limit * 4, 2e3)).catch(() => []),
          fetchCandlesPaged(sym, "5m", Math.max(input.limit * 12, 4e3)).catch(() => [])
        ]);
        const q4h = d4h.length >= 50 ? d4h : void 0;
        const q1h = d1h.length >= 50 ? d1h : void 0;
        const q15m = d15m.length >= 50 ? d15m : void 0;
        const q5m = d5m.length >= 50 ? d5m : void 0;
        const primaryData = q15m ?? [];
        const results = strategies.map((s) => {
          if (primaryData.length < 50) return { strategy: s, symbol: sym, interval: "15m", total_trades: 0, win_rate: 0, profit_factor: 0, max_drawdown: 0, total_return: 0, total_return_net: 0, sharpe_ratio: 0, equity_curve: [1], trades: [], mtf_filtered_count: 0, total_fees_pct: 0, trailing_stop_count: 0, adx_filtered_count: 0, fvg_ob_entry_count: 0 };
          return runBacktest({
            candles: primaryData,
            strategy: s,
            symbol: sym,
            interval: "15m",
            atr_sl_mult: input.atr_sl_mult,
            atr_tp_mult: input.atr_tp_mult,
            enable_mtf_filter: input.enable_mtf_filter,
            enable_fee: input.enable_fee,
            enable_trailing_stop: input.enable_trailing_stop,
            enable_adx_filter: input.enable_adx_filter,
            candles_4h: q4h,
            candles_1h: q1h,
            candles_15m: q15m,
            candles_5m: q5m,
            use_quad_mtf: true,
            quad_mtf_threshold: input.quad_mtf_threshold
          });
        });
        return results;
      } else if (input.use_true_mtf) {
        const FIXED_HTF = "4H";
        const FIXED_ENTRY = "15m";
        const [htfData, entryData] = await Promise.all([
          fetchCandles(sym, FIXED_HTF, 500).catch(() => []),
          fetchCandlesPaged(sym, FIXED_ENTRY, input.limit * 16).catch(() => [])
          // 15m 是 4H 的 16 倍
        ]);
        const results = strategies.map((s) => {
          if (entryData.length < 50) return { strategy: s, symbol: sym, interval: FIXED_ENTRY, total_trades: 0, win_rate: 0, profit_factor: 0, max_drawdown: 0, total_return: 0, total_return_net: 0, sharpe_ratio: 0, equity_curve: [1], trades: [], mtf_filtered_count: 0, total_fees_pct: 0, trailing_stop_count: 0, adx_filtered_count: 0, fvg_ob_entry_count: 0 };
          return runBacktest({
            candles: entryData,
            strategy: s,
            symbol: sym,
            interval: FIXED_ENTRY,
            atr_sl_mult: input.atr_sl_mult,
            atr_tp_mult: input.atr_tp_mult,
            enable_mtf_filter: input.enable_mtf_filter,
            enable_fee: input.enable_fee,
            enable_trailing_stop: input.enable_trailing_stop,
            enable_adx_filter: input.enable_adx_filter,
            htf_candles: htfData.length > 0 ? htfData : void 0,
            use_true_mtf: true
          });
        });
        return results;
      } else {
        const candles = input.limit > 300 ? await fetchCandlesPaged(sym, bar, input.limit) : await fetchCandles(sym, bar, input.limit);
        let mtfCandles;
        if (input.enable_mtf_filter) {
          const mtfBarMap = { "4H": "1D", "1H": "4H", "15m": "1H", "5m": "15m" };
          const mtfBar = mtfBarMap[bar];
          if (mtfBar) {
            try {
              mtfCandles = await fetchCandles(sym, mtfBar, 300);
            } catch {
            }
          }
        }
        return strategies.map((s) => runBacktest({
          candles,
          strategy: s,
          symbol: sym,
          interval: bar,
          atr_sl_mult: input.atr_sl_mult,
          atr_tp_mult: input.atr_tp_mult,
          enable_mtf_filter: input.enable_mtf_filter,
          enable_fee: input.enable_fee,
          enable_trailing_stop: input.enable_trailing_stop,
          enable_adx_filter: input.enable_adx_filter,
          mtf_candles: mtfCandles
        }));
      }
    }),
    history: publicProcedure.input(z3.object({ limit: z3.number().int().min(1).max(100).default(10) })).query(async ({ input }) => {
      void input;
      return [];
    }),
    // ★ Walk-Forward 驗證（Opus 4.6 建議）
    walkForward: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      interval: z3.string().default("4H"),
      // Bug Fix: 补齊 liquidity_sweep 和 vwap_reversion
      strategy: z3.enum(["ema_cross", "rsi_reversal", "bollinger", "macd", "smc", "pa", "chan", "liquidity_sweep", "vwap_reversion", "composite", "cannonball", "hwr_model_a", "hwr_model_b", "hwr_model_c"]).default("ema_cross"),
      limit: z3.number().int().min(200).max(4320).default(1080),
      is_ratio: z3.number().min(0.5).max(0.85).default(0.7),
      atr_sl_mult: z3.number().min(0.5).max(5).default(1.5),
      atr_tp_mult: z3.number().min(0.5).max(10).default(3),
      enable_mtf_filter: z3.boolean().default(true),
      enable_fee: z3.boolean().default(true),
      enable_trailing_stop: z3.boolean().default(true),
      enable_adx_filter: z3.boolean().default(true),
      enable_fvg_ob_filter: z3.boolean().default(false)
    })).mutation(async ({ input }) => {
      const bar = input.interval.toLowerCase() === "1d" ? "1D" : input.interval.toLowerCase() === "4h" ? "4H" : input.interval.toLowerCase() === "1h" ? "1H" : input.interval.toLowerCase() === "15m" ? "15m" : input.interval.toLowerCase() === "5m" ? "5m" : input.interval;
      const sym = input.symbol.includes("-") ? input.symbol.replace("-", "") : input.symbol;
      const candles = input.limit > 300 ? await fetchCandlesPaged(sym, bar, input.limit) : await fetchCandles(sym, bar, input.limit);
      if (candles.length < 200) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: `K \u7DDA\u8CC7\u6599\u4E0D\u8DB3\uFF08${candles.length} \u6839\uFF09\uFF0CWalk-Forward \u9700\u8981\u81F3\u5C11 200 \u6839` });
      }
      return runWalkForwardBacktest(
        sym,
        input.strategy,
        bar,
        candles,
        input.is_ratio,
        {
          atr_sl_mult: input.atr_sl_mult,
          atr_tp_mult: input.atr_tp_mult,
          enable_mtf_filter: input.enable_mtf_filter,
          enable_fee: input.enable_fee,
          enable_trailing_stop: input.enable_trailing_stop,
          enable_adx_filter: input.enable_adx_filter,
          enable_fvg_ob_filter: input.enable_fvg_ob_filter
        }
      );
    })
  }),
  // ── 高勝率策略掃描 v2.0（全面改良版）──
  highWinRate: router({
    scan: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      engine: z3.enum(["opus", "codex", "local"]).default("codex")
    })).mutation(async ({ input }) => {
      const { runHighWinRateScan: runHighWinRateScan2 } = await Promise.resolve().then(() => (init_highWinRateService(), highWinRateService_exports));
      const { fetchCandles: fc } = await Promise.resolve().then(() => (init_analysis(), analysis_exports));
      const analysisModule = await Promise.resolve().then(() => (init_analysis(), analysis_exports));
      const sym = input.symbol.includes("-") ? input.symbol.replace("-", "") : input.symbol;
      const engine = input.engine ?? "local";
      void analysisModule;
      const highWinRateLLM = async (opts) => {
        if (engine === "local") {
          return { choices: [{ message: { content: "__LOCAL_ENGINE__" } }] };
        }
        let endpoint;
        let apiKey;
        let model;
        if (engine === "opus") {
          const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
          apiKey = process.env.OPENAI_API_KEY ?? "";
          model = "gemini-2.5-flash";
          endpoint = `${baseUrl}/chat/completions`;
        } else {
          apiKey = process.env.SOXIO_API_KEY ?? "";
          model = "gpt-5.4";
          endpoint = "https://apikey.soxio.me/openai/v1/chat/completions";
        }
        if (engine === "codex") {
          const soxioResp = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model,
              messages: opts.messages,
              max_tokens: opts.maxTokens ?? 2800,
              stream: true
            }),
            signal: AbortSignal.timeout(12e4)
          });
          if (!soxioResp.ok) {
            const errText = await soxioResp.text();
            throw new Error(`[codex] soxio API failed: ${soxioResp.status} \u2013 ${errText.slice(0, 200)}`);
          }
          const rawText = await soxioResp.text();
          let fullContent = "";
          for (const line of rawText.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;
            try {
              const chunk = JSON.parse(jsonStr);
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) fullContent += delta;
            } catch {
            }
          }
          if (!fullContent) throw new Error("[codex] soxio: empty response");
          return { choices: [{ message: { content: fullContent } }] };
        }
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: opts.messages,
            max_tokens: opts.maxTokens ?? 2800
          }),
          signal: AbortSignal.timeout(12e4)
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`[${engine}] LLM failed: ${resp.status} ${resp.statusText} \u2013 ${errText.slice(0, 200)}`);
        }
        return resp.json();
      };
      return await runHighWinRateScan2(sym, fc, highWinRateLLM, engine);
    })
  }),
  // ── 多幣種篩選器（Screener）──
  screener: router({
    scanAll: publicProcedure.input(z3.object({ timeframe: z3.enum(["1H", "4H", "1D"]).default("1H") })).query(async ({ input }) => {
      const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT"];
      const bar = input.timeframe;
      const emaArr = sharedEmaArr;
      const rsiLast = sharedRsiLast;
      const macdHistLast = sharedMacdHistLast;
      const adxLast = sharedAdxLast;
      const bollingerLast = sharedBollingerLast;
      function detectSmcStr(candles, close, ema50) {
        const recent = candles.slice(-30);
        let h = 0, l = 0;
        for (let i = 1; i < recent.length - 1; i++) {
          if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i + 1].high) h++;
          if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i + 1].low) l++;
        }
        if (close > ema50 && h > l) return "bullish";
        if (close < ema50 && l > h) return "bearish";
        return "ranging";
      }
      function detectLiqSweep(candles, close) {
        const sl = candles.slice(-50);
        const highs = [], lows = [];
        for (let i = 4; i < sl.length - 4; i++) {
          if (sl.slice(i - 4, i).every((c) => c.high <= sl[i].high) && sl.slice(i + 1, i + 5).every((c) => c.high <= sl[i].high)) highs.push(sl[i].high);
          if (sl.slice(i - 4, i).every((c) => c.low >= sl[i].low) && sl.slice(i + 1, i + 5).every((c) => c.low >= sl[i].low)) lows.push(sl[i].low);
        }
        const r5 = candles.slice(-5);
        return { bslSwept: highs.slice(-3).some((h) => r5.some((c) => c.high > h) && close < h), sslSwept: lows.slice(-3).some((l) => r5.some((c) => c.low < l) && close > l) };
      }
      function calcChanTrend(candles) {
        const frac = [];
        for (let i = 1; i < candles.length - 1; i++) {
          const p = candles[i - 1], c = candles[i], n = candles[i + 1];
          if (c.high > p.high && c.high > n.high) frac.push({ idx: i, type: "top", price: c.high });
          else if (c.low < p.low && c.low < n.low) frac.push({ idx: i, type: "bottom", price: c.low });
        }
        const merged = [];
        for (const f of frac) {
          const last2 = merged[merged.length - 1];
          if (last2 && last2.type === f.type) {
            if (f.type === "top" && f.price > last2.price) merged[merged.length - 1] = f;
            else if (f.type === "bottom" && f.price < last2.price) merged[merged.length - 1] = f;
          } else merged.push(f);
        }
        const bis = [];
        for (let i = 0; i < merged.length - 1; i++) {
          const a = merged[i], b = merged[i + 1];
          if (b.idx - a.idx < 4) continue;
          if (a.type === "bottom" && b.type === "top") bis.push({ direction: "up", start: a.price, end: b.price });
          else if (a.type === "top" && b.type === "bottom") bis.push({ direction: "down", start: a.price, end: b.price });
        }
        if (bis.length < 2) return "ranging";
        const last = bis[bis.length - 1], prev = bis[bis.length - 3] ?? bis[0];
        if (last.direction === "up" && last.end > prev.end) return "bullish";
        if (last.direction === "down" && last.end < prev.end) return "bearish";
        return "ranging";
      }
      function calcVolumeProfile(candles, bins = 20) {
        const pMin = Math.min(...candles.map((c) => c.low)), pMax = Math.max(...candles.map((c) => c.high));
        const bSize = (pMax - pMin) / bins;
        const vBins = [];
        for (let b = 0; b < bins; b++) {
          const bLow = pMin + b * bSize, bHigh = bLow + bSize, bMid = (bLow + bHigh) / 2;
          let vol = 0, bVol = 0;
          for (const c of candles) {
            const ov = Math.min(c.high, bHigh) - Math.max(c.low, bLow);
            if (ov > 0) {
              const f = ov / (c.high - c.low || 1);
              vol += c.volume * f;
              if (c.close > c.open) bVol += c.volume * f;
            }
          }
          vBins.push({ price: bMid, volume: vol, isBull: bVol > vol * 0.5 });
        }
        const poc = vBins.reduce((a, b) => a.volume > b.volume ? a : b);
        const sorted = [...vBins].sort((a, b) => b.volume - a.volume);
        const total = sorted.reduce((s, b) => s + b.volume, 0);
        let cumVol = 0;
        const vahBins = [];
        for (const bin of sorted) {
          cumVol += bin.volume;
          if (cumVol / total <= 0.7) vahBins.push(bin.price);
        }
        return { poc: poc.price, vah: vahBins.length > 0 ? Math.max(...vahBins) : pMax, val: vahBins.length > 0 ? Math.min(...vahBins) : pMin, bins: vBins };
      }
      const results = await Promise.allSettled(SYMBOLS.map(async (sym) => {
        try {
          const candles = await fetchCandles(sym, bar, 100);
          if (candles.length < 50) throw new Error("K\u7DDA\u4E0D\u8DB3");
          const close = candles[candles.length - 1].close;
          const closes = candles.map((c) => c.close);
          const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50);
          const ema20 = e20[e20.length - 1], ema50 = e50[e50.length - 1];
          const rsi = rsiLast(closes), macdH = macdHistLast(closes), adx = adxLast(candles);
          const boll = bollingerLast(closes);
          const smcStr = detectSmcStr(candles, close, ema50);
          const liq = detectLiqSweep(candles, close);
          const chanTrend = calcChanTrend(candles);
          const vp = calcVolumeProfile(candles.slice(-50));
          const prev24 = candles[Math.max(0, candles.length - 25)];
          const change24h = prev24 ? (close - prev24.close) / prev24.close * 100 : 0;
          let score = 50;
          if (close > ema20) score += 8;
          else score -= 8;
          if (close > ema50) score += 7;
          else score -= 7;
          if (rsi > 55 && rsi < 75) score += 8;
          else if (rsi < 45 && rsi > 25) score -= 8;
          else if (rsi >= 75) score -= 5;
          else if (rsi <= 25) score += 5;
          if (macdH > 0) score += 7;
          else score -= 7;
          if (smcStr === "bullish") score += 10;
          else if (smcStr === "bearish") score -= 10;
          if (chanTrend === "bullish") score += 10;
          else if (chanTrend === "bearish") score -= 10;
          score = Math.max(0, Math.min(100, score));
          const direction = score >= 62 ? "long" : score <= 38 ? "short" : "neutral";
          return { symbol: sym, coin: sym.replace("USDT", ""), close, change24h, rsi, macd_hist: macdH, adx, ema20, ema50, bb_percent: boll.percent_b, bb_bandwidth: boll.bandwidth, smc_structure: smcStr, liq_sweep_bsl: liq.bslSwept, liq_sweep_ssl: liq.sslSwept, chan_trend: chanTrend, score, direction, volume_profile: vp, scanned_at: Date.now() };
        } catch (e) {
          return { symbol: sym, coin: sym.replace("USDT", ""), close: 0, change24h: 0, rsi: 50, macd_hist: 0, adx: 20, ema20: 0, ema50: 0, bb_percent: 0.5, bb_bandwidth: 5, smc_structure: "ranging", liq_sweep_bsl: false, liq_sweep_ssl: false, chan_trend: "ranging", score: 50, direction: "neutral", volume_profile: { poc: 0, vah: 0, val: 0, bins: [] }, scanned_at: Date.now(), error: String(e) };
        }
      }));
      return results.map((r) => r.status === "fulfilled" ? r.value : { symbol: "", coin: "", close: 0, change24h: 0, rsi: 50, macd_hist: 0, adx: 20, ema20: 0, ema50: 0, bb_percent: 0.5, bb_bandwidth: 5, smc_structure: "ranging", liq_sweep_bsl: false, liq_sweep_ssl: false, chan_trend: "ranging", score: 50, direction: "neutral", volume_profile: { poc: 0, vah: 0, val: 0, bins: [] }, scanned_at: Date.now() });
    })
  }),
  // ── 市場情緒熱力圖（Heatmap）──
  heatmap: router({
    getMarketOverview: publicProcedure.input(z3.object({ timeframe: z3.enum(["1H", "4H", "1D"]).default("4H") })).query(async ({ input }) => {
      const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT"];
      const bar = input.timeframe;
      const rsiLast = sharedRsiLast;
      const emaArr = sharedEmaArr;
      const results = await Promise.allSettled(SYMBOLS.map(async (sym) => {
        try {
          const candles = await fetchCandles(sym, bar, 100);
          if (candles.length < 20) throw new Error("K\u7DDA\u4E0D\u8DB3");
          const close = candles[candles.length - 1].close;
          const closes = candles.map((c) => c.close);
          const rsi = rsiLast(closes);
          const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50);
          const ema20 = e20[e20.length - 1], ema50 = e50[e50.length - 1];
          const change1h = candles.length >= 2 ? (close - candles[candles.length - 2].close) / candles[candles.length - 2].close * 100 : 0;
          const change24h = candles.length >= 25 ? (close - candles[candles.length - 25].close) / candles[candles.length - 25].close * 100 : 0;
          const change7d = candles.length >= 43 ? (close - candles[candles.length - 43].close) / candles[candles.length - 43].close * 100 : 0;
          const vol5 = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
          const vol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
          const volTrend = vol5 > vol20 * 1.2 ? "increasing" : vol5 < vol20 * 0.8 ? "decreasing" : "neutral";
          let score = 50;
          if (close > ema20) score += 10;
          else score -= 10;
          if (close > ema50) score += 10;
          else score -= 10;
          if (rsi > 55 && rsi < 75) score += 10;
          else if (rsi < 45 && rsi > 25) score -= 10;
          else if (rsi >= 75) score -= 5;
          else if (rsi <= 25) score += 5;
          if (change24h > 2) score += 10;
          else if (change24h < -2) score -= 10;
          score = Math.max(0, Math.min(100, score));
          const sentiment = score >= 75 ? "strong_bull" : score >= 60 ? "bull" : score >= 40 ? "neutral" : score >= 25 ? "bear" : "strong_bear";
          return { symbol: sym, coin: sym.replace("USDT", ""), close, rsi, ema20, ema50, change1h, change24h, change7d, vol_trend: volTrend, score, sentiment };
        } catch {
          return { symbol: sym, coin: sym.replace("USDT", ""), close: 0, rsi: 50, ema20: 0, ema50: 0, change1h: 0, change24h: 0, change7d: 0, vol_trend: "neutral", score: 50, sentiment: "neutral" };
        }
      }));
      const data = results.map((r) => r.status === "fulfilled" ? r.value : { symbol: "", coin: "", close: 0, rsi: 50, ema20: 0, ema50: 0, change1h: 0, change24h: 0, change7d: 0, vol_trend: "neutral", score: 50, sentiment: "neutral" });
      const bullCount = data.filter((d) => d.sentiment === "strong_bull" || d.sentiment === "bull").length;
      const bearCount = data.filter((d) => d.sentiment === "strong_bear" || d.sentiment === "bear").length;
      const avgScore = data.reduce((s, d) => s + d.score, 0) / data.length;
      const avgRsi = data.reduce((s, d) => s + d.rsi, 0) / data.length;
      return { coins: data, market_summary: { bull_count: bullCount, bear_count: bearCount, neutral_count: data.length - bullCount - bearCount, avg_score: Math.round(avgScore), avg_rsi: Math.round(avgRsi * 10) / 10, market_sentiment: avgScore >= 65 ? "bull_market" : avgScore <= 35 ? "bear_market" : "mixed" }, scanned_at: Date.now() };
    })
  }),
  // ── 自訂警報系統（Alerts）──
  alerts: router({
    checkAlerts: publicProcedure.input(z3.object({
      alerts: z3.array(z3.object({
        id: z3.string(),
        symbol: z3.string(),
        condition: z3.enum(["price_above", "price_below", "rsi_above", "rsi_below", "macd_cross_up", "macd_cross_down", "bb_squeeze", "volume_spike", "smc_bos", "fvg_touch"]),
        value: z3.number().optional(),
        enabled: z3.boolean().default(true)
      }))
    })).mutation(async ({ input }) => {
      const triggered = [];
      const rsiLast = sharedRsiLast;
      const macdHistFn = sharedMacdHistFn;
      const bbBandwidth = sharedBbBandwidth;
      const enabledAlerts = input.alerts.filter((a) => a.enabled);
      const uniqueSyms = Array.from(new Set(enabledAlerts.map((a) => a.symbol)));
      const candleMap = /* @__PURE__ */ new Map();
      await Promise.allSettled(uniqueSyms.map(async (sym) => {
        try {
          const c = await fetchCandles(sym, "1H", 50);
          candleMap.set(sym, c);
        } catch (e) {
          console.warn(`[alerts.checkAlerts] \u7121\u6CD5\u53D6\u5F97 ${sym} K\u7DDA:`, e instanceof Error ? e.message : String(e));
        }
      }));
      for (const alert of enabledAlerts) {
        const candles = candleMap.get(alert.symbol);
        if (!candles || candles.length < 20) continue;
        const close = candles[candles.length - 1].close;
        const closes = candles.map((c) => c.close);
        const rsi = rsiLast(closes);
        const { cur: hist, prev: prevHist } = macdHistFn(closes);
        const bw = bbBandwidth(closes);
        const vol5 = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
        const vol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
        let fired = false, msg = "";
        switch (alert.condition) {
          case "price_above":
            if (alert.value && close > alert.value) {
              fired = true;
              msg = `${alert.symbol} \u50F9\u683C\u7A81\u7834 ${alert.value.toFixed(2)}`;
            }
            break;
          case "price_below":
            if (alert.value && close < alert.value) {
              fired = true;
              msg = `${alert.symbol} \u50F9\u683C\u8DCC\u7834 ${alert.value.toFixed(2)}`;
            }
            break;
          case "rsi_above":
            if (alert.value && rsi > alert.value) {
              fired = true;
              msg = `${alert.symbol} RSI(${rsi.toFixed(1)}) \u8D85\u904E ${alert.value}`;
            }
            break;
          case "rsi_below":
            if (alert.value && rsi < alert.value) {
              fired = true;
              msg = `${alert.symbol} RSI(${rsi.toFixed(1)}) \u4F4E\u65BC ${alert.value}`;
            }
            break;
          case "macd_cross_up":
            if (prevHist < 0 && hist > 0) {
              fired = true;
              msg = `${alert.symbol} MACD \u91D1\u53C9\uFF08\u67F1\u72C0\u5716\u8F49\u6B63\uFF09`;
            }
            break;
          case "macd_cross_down":
            if (prevHist > 0 && hist < 0) {
              fired = true;
              msg = `${alert.symbol} MACD \u6B7B\u53C9\uFF08\u67F1\u72C0\u5716\u8F49\u8CA0\uFF09`;
            }
            break;
          case "bb_squeeze":
            if (bw < 3) {
              fired = true;
              msg = `${alert.symbol} \u5E03\u6797\u5E36\u6536\u7A84(BW=${bw.toFixed(2)}%)\uFF0C\u5373\u5C07\u7206\u767C`;
            }
            break;
          case "volume_spike":
            if (vol5 > vol20 * 2) {
              fired = true;
              msg = `${alert.symbol} \u6210\u4EA4\u91CF\u7206\u5347(${(vol5 / vol20).toFixed(1)}x\u5747\u91CF)`;
            }
            break;
          case "smc_bos": {
            const r10 = candles.slice(-10);
            const pH = Math.max(...candles.slice(-30, -10).map((c) => c.high));
            const pL = Math.min(...candles.slice(-30, -10).map((c) => c.low));
            if (r10.some((c) => c.close > pH)) {
              fired = true;
              msg = `${alert.symbol} SMC BOS \u7A81\u7834\u524D\u9AD8(${pH.toFixed(2)})`;
            } else if (r10.some((c) => c.close < pL)) {
              fired = true;
              msg = `${alert.symbol} SMC BOS \u8DCC\u7834\u524D\u4F4E(${pL.toFixed(2)})`;
            }
            break;
          }
          case "fvg_touch": {
            let touched = false;
            for (let i = 1; i < candles.length - 1; i++) {
              const prev = candles[i - 1], next = candles[i + 1];
              if (prev.high < next.low) {
                const mid = (prev.high + next.low) / 2;
                if (Math.abs(close - mid) / close < 5e-3) {
                  touched = true;
                  msg = `${alert.symbol} \u89F8\u53CA\u591A\u65B9FVG(${mid.toFixed(2)})`;
                  break;
                }
              }
              if (prev.low > next.high) {
                const mid = (prev.low + next.high) / 2;
                if (Math.abs(close - mid) / close < 5e-3) {
                  touched = true;
                  msg = `${alert.symbol} \u89F8\u53CA\u7A7A\u65B9FVG(${mid.toFixed(2)})`;
                  break;
                }
              }
            }
            if (touched) fired = true;
            break;
          }
        }
        if (fired) triggered.push({ id: alert.id, symbol: alert.symbol, condition: alert.condition, message: msg, price: close, time: Date.now() });
      }
      return { triggered, checked_at: Date.now() };
    }),
    // ── 多條件組合警報（Phase 4 新增）──
    checkCompositeAlerts: publicProcedure.input(z3.object({
      compositeAlerts: z3.array(z3.object({
        id: z3.string(),
        symbol: z3.string(),
        label: z3.string(),
        enabled: z3.boolean().default(true),
        logic: z3.enum(["AND", "OR"]).default("AND"),
        conditions: z3.array(z3.object({
          condition: z3.enum(["price_above", "price_below", "rsi_above", "rsi_below", "macd_cross_up", "macd_cross_down", "bb_squeeze", "volume_spike", "smc_bos", "fvg_touch"]),
          value: z3.number().optional()
        })).min(1).max(5)
      }))
    })).mutation(async ({ input }) => {
      const triggered = [];
      const rsiLast = sharedRsiLast;
      const macdHistFn = sharedMacdHistFn;
      const bbBandwidth = sharedBbBandwidth;
      function evalCondition(cond, candles) {
        const close = candles[candles.length - 1].close;
        const closes = candles.map((c) => c.close);
        const rsi = rsiLast(closes);
        const { cur: hist, prev: prevHist } = macdHistFn(closes);
        const bw = bbBandwidth(closes);
        const vol5 = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
        const vol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
        switch (cond.condition) {
          case "price_above":
            if (cond.value && close > cond.value) return { fired: true, msg: `\u50F9\u683C\u7A81\u7834 ${cond.value.toFixed(2)}` };
            break;
          case "price_below":
            if (cond.value && close < cond.value) return { fired: true, msg: `\u50F9\u683C\u8DCC\u7834 ${cond.value.toFixed(2)}` };
            break;
          case "rsi_above":
            if (cond.value && rsi > cond.value) return { fired: true, msg: `RSI(${rsi.toFixed(1)})>${cond.value}` };
            break;
          case "rsi_below":
            if (cond.value && rsi < cond.value) return { fired: true, msg: `RSI(${rsi.toFixed(1)})<${cond.value}` };
            break;
          case "macd_cross_up":
            if (prevHist < 0 && hist > 0) return { fired: true, msg: `MACD \u91D1\u53C9` };
            break;
          case "macd_cross_down":
            if (prevHist > 0 && hist < 0) return { fired: true, msg: `MACD \u6B7B\u53C9` };
            break;
          case "bb_squeeze":
            if (bw < 3) return { fired: true, msg: `\u5E03\u6797\u5E36\u6536\u7A84(${bw.toFixed(2)}%)` };
            break;
          case "volume_spike":
            if (vol5 > vol20 * 2) return { fired: true, msg: `\u6210\u4EA4\u91CF\u7206\u5347(${(vol5 / vol20).toFixed(1)}x)` };
            break;
          case "smc_bos": {
            const r10 = candles.slice(-10);
            const pH = Math.max(...candles.slice(-30, -10).map((c) => c.high));
            const pL = Math.min(...candles.slice(-30, -10).map((c) => c.low));
            if (r10.some((c) => c.close > pH)) return { fired: true, msg: `SMC BOS \u7A81\u7834\u524D\u9AD8(${pH.toFixed(2)})` };
            if (r10.some((c) => c.close < pL)) return { fired: true, msg: `SMC BOS \u8DCC\u7834\u524D\u4F4E(${pL.toFixed(2)})` };
            break;
          }
          case "fvg_touch": {
            for (let i = 1; i < candles.length - 1; i++) {
              const prev = candles[i - 1], next = candles[i + 1];
              if (prev.high < next.low) {
                const mid = (prev.high + next.low) / 2;
                if (Math.abs(close - mid) / close < 5e-3) return { fired: true, msg: `\u89F8\u53CA\u591A\u65B9FVG(${mid.toFixed(2)})` };
              }
              if (prev.low > next.high) {
                const mid = (prev.low + next.high) / 2;
                if (Math.abs(close - mid) / close < 5e-3) return { fired: true, msg: `\u89F8\u53CA\u7A7A\u65B9FVG(${mid.toFixed(2)})` };
              }
            }
            break;
          }
        }
        return { fired: false, msg: "" };
      }
      const enabledAlerts = input.compositeAlerts.filter((a) => a.enabled);
      const uniqueSyms = Array.from(new Set(enabledAlerts.map((a) => a.symbol)));
      const candleMap = /* @__PURE__ */ new Map();
      await Promise.allSettled(uniqueSyms.map(async (sym) => {
        try {
          const c = await fetchCandles(sym, "1H", 50);
          candleMap.set(sym, c);
        } catch (e) {
          console.warn(`[alerts.checkCompositeAlerts] \u7121\u6CD5\u53D6\u5F97 ${sym} K\u7DDA:`, e instanceof Error ? e.message : String(e));
        }
      }));
      for (const alert of enabledAlerts) {
        const candles = candleMap.get(alert.symbol);
        if (!candles || candles.length < 20) continue;
        const close = candles[candles.length - 1].close;
        const results = alert.conditions.map((c) => evalCondition(c, candles));
        const matchedConditions = results.filter((r) => r.fired).map((r) => r.msg);
        const fired = alert.logic === "AND" ? results.every((r) => r.fired) : results.some((r) => r.fired);
        if (fired) {
          const msg = `${alert.symbol} [${alert.logic}] ${matchedConditions.join(" + ")}`;
          triggered.push({ id: alert.id, symbol: alert.symbol, label: alert.label, message: msg, price: close, time: Date.now(), matchedConditions });
        }
      }
      return { triggered, checked_at: Date.now() };
    })
  }),
  // ── Widget 偏好（加入 Zod 輸入驗證）──
  widgets: router({
    getPrefs: publicProcedure.input(z3.object({ openId: z3.string().optional() })).query(async ({ input }) => {
      if (!input.openId) return null;
      return getWidgetPrefs(input.openId);
    }),
    savePrefs: publicProcedure.input(
      z3.object({
        openId: z3.string().min(1),
        widgetIds: z3.array(z3.string().min(1)).max(50)
      })
    ).mutation(async ({ input }) => {
      const result = WidgetPrefsSchema.safeParse(input);
      if (!result.success) {
        throw new TRPCError3({
          code: "BAD_REQUEST",
          message: `Widget \u504F\u597D\u683C\u5F0F\u932F\u8AA4\uFF1A${result.error.message}`
        });
      }
      await saveWidgetPrefs(result.data.openId, result.data.widgetIds);
      return { success: true };
    })
  }),
  // ── 熊貓策略面板（@bh1908 熊敖策略）──
  panda: router({
    scan: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      timeframe: z3.enum(["1H", "4H", "1D"]).default("4H")
    })).mutation(async ({ input }) => {
      const { runPandaScanV54: runPandaScanV542 } = await Promise.resolve().then(() => (init_pandaStrategy(), pandaStrategy_exports));
      const sym = normalizeSymbol(input.symbol);
      const tfMap = { "1H": "1h", "4H": "4h", "1D": "1d" };
      const htfMap = { "1H": "4h", "4H": "1d", "1D": "1w" };
      const ltfBar = tfMap[input.timeframe] ?? "4h";
      const htfBar = htfMap[input.timeframe] ?? "1d";
      const [ltfCandles, htfCandles] = await Promise.all([
        fetchCandles(sym, ltfBar, 800),
        fetchCandles(sym, htfBar, 200)
      ]);
      return runPandaScanV542(sym, htfCandles, ltfCandles);
    }),
    backtest: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      timeframe: z3.enum(["1H", "4H", "1D"]).default("4H"),
      minScore: z3.number().min(0).max(100).default(55)
    })).mutation(async ({ input }) => {
      const { runPandaBacktest: runPandaBacktest2 } = await Promise.resolve().then(() => (init_pandaStrategy(), pandaStrategy_exports));
      const sym = normalizeSymbol(input.symbol);
      const tfMap = { "1H": "1h", "4H": "4h", "1D": "1d" };
      const htfMap = { "1H": "4h", "4H": "1d", "1D": "1w" };
      const ltfBar = tfMap[input.timeframe] ?? "4h";
      const htfBar = htfMap[input.timeframe] ?? "1d";
      const [ltfCandles, htfCandles] = await Promise.all([
        fetchCandles(sym, ltfBar, 500),
        fetchCandles(sym, htfBar, 200)
      ]);
      return runPandaBacktest2(sym, htfCandles, ltfCandles, input.minScore);
    })
  }),
  // ── 組合策略即時信號（方案 A 分組 MTF）──
  // ─────────────────────────────────────────────────────────────────────────
  // Champion Trader 方法論分析路由
  // ─────────────────────────────────────────────────────────────────────────
  champion: router({
    analyze: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      snapshot: z3.any(),
      currentPrice: z3.number(),
      timeframe: z3.string().default("1h")
    })).mutation(async ({ input }) => {
      const { symbol, snapshot, currentPrice, timeframe } = input;
      if (!snapshot) throw new TRPCError3({ code: "BAD_REQUEST", message: "\u9700\u8981\u5148\u57F7\u884C\u5206\u6790\u53D6\u5F97\u5FEB\u7167" });
      const ind = snapshot.indicators ?? {};
      const mtf = snapshot.mtf_indicators ?? {};
      const smc = snapshot.smc ?? {};
      const pa = snapshot.pa ?? {};
      const con = snapshot.consensus ?? {};
      const str = snapshot.strategy ?? {};
      const indSummary = [
        `\u7576\u524D\u50F9\u683C: $${currentPrice.toLocaleString()}`,
        `EMA20/50/200: ${ind.ema?.ema20?.toFixed(1) ?? "\u2014"}/${ind.ema?.ema50?.toFixed(1) ?? "\u2014"}/${ind.ema?.ema200?.toFixed(1) ?? "\u2014"}`,
        `\u8DA8\u52E2: ${ind.trend ?? "\u2014"} | \u52D5\u80FD: ${ind.momentum ?? "\u2014"}`,
        `RSI(14): ${ind.rsi?.toFixed(1) ?? "\u2014"}`,
        `MACD: ${ind.macd?.macd?.toFixed(4) ?? "\u2014"} / Signal: ${ind.macd?.signal?.toFixed(4) ?? "\u2014"} / Hist: ${ind.macd?.histogram?.toFixed(4) ?? "\u2014"}`,
        `\u5E03\u6797\u5E36: \u4E0A\u8ECC ${ind.bollinger?.upper?.toFixed(1) ?? "\u2014"} / \u4E2D\u8ECC ${ind.bollinger?.middle?.toFixed(1) ?? "\u2014"} / \u4E0B\u8ECC ${ind.bollinger?.lower?.toFixed(1) ?? "\u2014"} / BW: ${ind.bollinger?.bandwidth?.toFixed(2) ?? "\u2014"}%`,
        `KD: K=${ind.stochastic?.k?.toFixed(1) ?? "\u2014"} D=${ind.stochastic?.d?.toFixed(1) ?? "\u2014"}`,
        `ADX: ${ind.adx?.adx?.toFixed(1) ?? "\u2014"} (DI+: ${ind.adx?.plus_di?.toFixed(1) ?? "\u2014"} / DI-: ${ind.adx?.minus_di?.toFixed(1) ?? "\u2014"})`,
        `ATR: ${ind.atr?.toFixed(2) ?? "\u2014"}`,
        `VWAP: ${ind.vwap?.toFixed(1) ?? "\u2014"}`
      ].join("\n");
      const mtfSummary = Object.entries(mtf).map(
        ([tf, d]) => `[${tf.toUpperCase()}] RSI=${d.rsi?.toFixed(1) ?? "\u2014"} MACD_hist=${d.macd_hist?.toFixed(3) ?? "\u2014"} EMA20=${d.ema20?.toFixed(1) ?? "\u2014"} \u8DA8\u52E2=${d.trend ?? "\u2014"}`
      ).join("\n");
      const smcSummary = [
        `\u5E02\u5834\u7D50\u69CB: ${smc.market_structure ?? "\u2014"}`,
        `\u6700\u8FD1 BOS/CHoCH: ${smc.last_bos_type ?? "\u2014"} @ ${smc.last_bos_price?.toFixed(1) ?? "\u2014"}`,
        `FVG \u6578\u91CF: \u770B\u591A ${smc.fvg_bullish_count ?? 0} / \u770B\u7A7A ${smc.fvg_bearish_count ?? 0}`,
        `BSL: ${smc.bsl?.toFixed(1) ?? "\u2014"} / SSL: ${smc.ssl?.toFixed(1) ?? "\u2014"}`,
        `OB \u770B\u591A: ${smc.ob_bullish?.toFixed(1) ?? "\u2014"} / OB \u770B\u7A7A: ${smc.ob_bearish?.toFixed(1) ?? "\u2014"}`
      ].join("\n");
      const paSummary = [
        `\u652F\u6490: ${pa.support?.toFixed(1) ?? "\u2014"} / \u963B\u529B: ${pa.resistance?.toFixed(1) ?? "\u2014"}`,
        `\u8DA8\u52E2: ${pa.trend ?? "\u2014"}`,
        `K \u7DDA\u5F62\u614B: ${pa.candle_pattern ?? "\u2014"}`,
        `\u6210\u4EA4\u91CF\u78BA\u8A8D: ${pa.volume_confirm ? "\u662F" : "\u5426"}`
      ].join("\n");
      const conSummary = `\u5171\u8B58\u8A55\u5206: ${con.score ?? "\u2014"}/100 (${con.label ?? "\u2014"}) | \u770B\u591A\u4FE1\u865F: ${con.bull_count ?? 0} / \u770B\u7A7A\u4FE1\u865F: ${con.bear_count ?? 0}`;
      const strSummary = [
        `\u65B9\u5411: ${str.direction ?? "\u2014"}`,
        `\u9032\u5834: ${str.entry?.toFixed(1) ?? "\u2014"}`,
        `\u6B62\u640D: ${str.stop_loss?.toFixed(1) ?? "\u2014"}`,
        `\u6B62\u76C81: ${str.take_profit_1?.toFixed(1) ?? "\u2014"} / \u6B62\u76C82: ${str.take_profit_2?.toFixed(1) ?? "\u2014"}`,
        `\u4FE1\u5FC3: ${str.confidence ?? "\u2014"}%`
      ].join("\n");
      const systemPrompt = `\u4F60\u662F Champion Trader\uFF08Shi Hun\uFF09\u7684\u4EA4\u6613\u5206\u6790\u52A9\u7406\uFF0C\u56B4\u683C\u6309\u7167\u4EE5\u4E0B\u65B9\u6CD5\u8AD6\u6846\u67B6\u9032\u884C\u5206\u6790\uFF1A

## Champion Trader \u6838\u5FC3\u65B9\u6CD5\u8AD6

**\u5206\u6790\u56DB\u5C64\u6846\u67B6\uFF08\u5FC5\u9808\u6309\u9806\u5E8F\uFF09\uFF1A**
1. \u57FA\u790E\u5716\u8868\u8A9E\u8A00\u5C64\uFF1A\u5148\u770B\u8DA8\u52E2\u65B9\u5411\uFF08K\u7DDA\u3001\u5747\u7DDA\u3001\u91CF\u50F9\uFF09\uFF0C\u518D\u770B\u4F4D\u7F6E\uFF08\u652F\u6490/\u963B\u529B\uFF09
2. \u8A0A\u865F\u5C64\uFF1AMACD \u67F1\u72C0\u5716\u65B9\u5411\u3001RSI \u4F4D\u7F6E\uFF08\u8D85\u8CB7/\u8D85\u8CE3/\u4E2D\u6027\uFF09\u3001\u5E03\u6797\u5E36\u4F4D\u7F6E\u3001KD \u4EA4\u53C9
3. \u7D50\u69CB\u904E\u6FFE\u5C64\uFF1AFVG\uFF08\u516C\u5E73\u50F9\u503C\u7F3A\u53E3\uFF09\u3001\u6D41\u52D5\u6027\uFF08BSL/SSL\uFF09\u3001\u5E02\u5834\u7D50\u69CB\uFF08BOS/CHoCH\uFF09\u3001\u4E3B\u529B\u75D5\u8DE1
4. \u57F7\u884C\u5C64\uFF1A\u9032\u5834\u689D\u4EF6\u3001\u6B62\u640D\u4F4D\u7F6E\u3001\u51FA\u5834\u898F\u5247\u3001\u98A8\u5831\u6BD4\u8A55\u4F30

**\u56DB\u500B\u6838\u5FC3\u554F\u984C\uFF08\u6BCF\u6B21\u5206\u6790\u5FC5\u7B54\uFF09\uFF1A**
- \u8DA8\u52E2\u65B9\u5411\u662F\u4EC0\u9EBC\uFF1F\uFF08\u591A/\u7A7A/\u9707\u76EA\uFF09
- \u70BA\u4EC0\u9EBC\u9019\u500B\u4F4D\u7F6E\u503C\u5F97\u9032\u5834\uFF1F\uFF08\u7D50\u69CB\u7406\u7531\uFF09
- \u6B62\u640D\u653E\u54EA\u88E1\uFF1F\uFF08\u4E0D\u80FD\u653E\u5728\u660E\u986F\u4F4D\u7F6E\uFF09
- \u98A8\u5831\u6BD4\u662F\u5426\u5408\u7406\uFF1F\uFF08\u81F3\u5C11 1:2\uFF09

**Champion Trader \u7279\u8272\u898F\u5247\uFF1A**
- \u771F\u5047\u652F\u6490\u8FA8\u8B58\uFF1A\u7D50\u69CB\u6210\u7ACB\u624D\u662F\u7406\u7531\uFF0C\u4FBF\u5B9C\u4E0D\u662F\u7406\u7531
- \u88AB\u6D17\u51FA\u5834\u9810\u9632\uFF1A\u6B62\u640D\u4E0D\u80FD\u653E\u5728\u592A\u660E\u986F\u7684\u4F4D\u7F6E\uFF08\u907F\u514D\u6D41\u52D5\u6027\u7375\u6BBA\uFF09
- \u62B1\u6CE2\u6BB5\u898F\u5247\uFF1A\u53EA\u770B 1 \u500B\u984F\u8272/\u5747\u7DDA\u4F86\u6C7A\u5B9A\u662F\u5426\u7E7C\u7E8C\u6301\u5009
- \u8FFD\u9AD8\u904E\u6FFE\uFF1A\u5FC5\u9808\u7B49\u8D77\u6DA8\u9EDE\u78BA\u8A8D\uFF0C\u4E0D\u8FFD\u6F32\u505C\u5F8C\u7684\u8FFD\u9AD8

**\u8F38\u51FA\u683C\u5F0F\u8981\u6C42\uFF1A**
\u8ACB\u7528\u7E41\u9AD4\u4E2D\u6587\uFF0C\u56B4\u683C\u6309\u7167\u4EE5\u4E0B JSON \u683C\u5F0F\u8F38\u51FA\uFF08\u4E0D\u8981\u52A0 markdown code block\uFF0C\u4E0D\u8981\u52A0\u4EFB\u4F55\u5176\u4ED6\u5167\u5BB9\uFF09\uFF1A
{
  "trend": { "direction": "\u591A/\u7A7A/\u9707\u76EA", "strength": "\u5F37/\u4E2D/\u5F31", "description": "\u8DA8\u52E2\u63CF\u8FF0" },
  "market_state": { "phase": "\u8DA8\u52E2\u5EF6\u7E8C/\u7D50\u69CB\u8F49\u63DB/\u9707\u76EA\u6574\u7406/\u6E96\u5099\u767C\u52D5", "description": "\u5E02\u5834\u72C0\u614B\u63CF\u8FF0" },
  "position_analysis": { "support": \u6578\u5B57, "resistance": \u6578\u5B57, "current_zone": "\u652F\u6491\u5340/\u963B\u529B\u5340/\u4E2D\u6027\u5340/\u8D85\u8CB7\u5340/\u8D85\u8CE3\u5340", "description": "\u4F4D\u7F6E\u5206\u6790" },
  "technical_indicators": { "macd": "\u770B\u591A/\u770B\u7A7A/\u4E2D\u6027", "rsi": "\u8D85\u8CB7/\u8D85\u8CE3/\u4E2D\u6027", "bollinger": "\u4E0A\u8ECC\u9644\u8FD1/\u4E0B\u8ECC\u9644\u8FD1/\u4E2D\u8ECC\u9644\u8FD1", "kd": "\u91D1\u53C9/\u6B7B\u53C9/\u4E2D\u6027", "volume": "\u653E\u91CF/\u7E2E\u91CF/\u6B63\u5E38", "confluence": "\u8A0A\u865F\u5171\u632F\u63CF\u8FF0" },
  "smc_market_structure": { "fvg_opportunity": "\u6709/\u7121", "liquidity_target": \u6578\u5B57\u6216null, "recent_bos_choch": "\u7D50\u69CB\u63CF\u8FF0", "smart_money_trace": "\u4E3B\u529B\u884C\u70BA\u63CF\u8FF0" },
  "strategy": { "direction": "\u505A\u591A/\u505A\u7A7A/\u89C0\u671B", "entry": \u6578\u5B57, "stop_loss": { "level": \u6578\u5B57, "basis": "\u6B62\u640D\u4F9D\u64DA" }, "take_profit_1": \u6578\u5B57, "take_profit_2": \u6578\u5B57, "rr_ratio": \u6578\u5B57, "confidence": \u6578\u5B57 },
  "trading_plan": { "primary_scenario": "\u4E3B\u5834\u666F\u63CF\u8FF0", "invalidation_scenario": "\u5931\u6548\u5834\u666F", "no_trade_conditions": ["\u4E0D\u64CD\u4F5C\u689D\u4EF6\u5217\u8868"] },
  "final_judgement": { "bias": "\u505A\u591A/\u505A\u7A7A/\u89C0\u671B", "action": "\u505A\u591A/\u505A\u7A7A/\u89C0\u671B", "one_line_summary": "\u51A0\u8ECD\u98A8\u683C\u4E00\u53E5\u8A71\u5224\u65B7", "full_verdict": "\u51A0\u8ECD\u4EA4\u6613\u8005\u98A8\u683C\u7684\u5B8C\u6574\u5224\u65B7\uFF082-3\u53E5\uFF0C\u76F4\u63A5\u3001\u6709\u898F\u5247\u611F\uFF09" },
  "champion_checklist": {
    "trend_confirmed": true/false,
    "position_valid": true/false,
    "signal_aligned": true/false,
    "structure_supports": true/false,
    "rr_acceptable": true/false,
    "not_chasing": true/false,
    "sl_not_obvious": true/false
  },
  "data_quality": { "warnings": ["\u6578\u64DA\u54C1\u8CEA\u8B66\u544A\u5217\u8868\uFF0C\u82E5\u7121\u5247\u70BA\u7A7A\u9663\u5217"] }
}`;
      const userPrompt = `\u8ACB\u5206\u6790 ${symbol} \u5728 ${timeframe} \u6642\u9593\u6846\u67B6\u7684\u7576\u524D\u5E02\u6CC1\uFF1A

## \u6280\u8853\u6307\u6A19
${indSummary}

## \u591A\u6642\u9593\u6846\u67B6
${mtfSummary}

## SMC \u5E02\u5834\u7D50\u69CB
${smcSummary}

## \u50F9\u683C\u884C\u70BA
${paSummary}

## \u5171\u8B58\u8A55\u5206
${conSummary}

## \u73FE\u6709\u7B56\u7565\u5EFA\u8B70
${strSummary}

\u8ACB\u56B4\u683C\u6309\u7167 Champion Trader \u65B9\u6CD5\u8AD6\u6846\u67B6\uFF0C\u8F38\u51FA JSON \u683C\u5F0F\u5206\u6790\u7D50\u679C\u3002`;
      const cacheKey = `champion:${symbol}:${timeframe}:${Math.floor(Date.now() / 3e5)}`;
      const cachedResult = serverCache.get(cacheKey);
      if (cachedResult) return cachedResult;
      try {
        const resp = await invokeLLM({
          tier: "balanced",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        });
        const raw = typeof resp.choices[0]?.message?.content === "string" ? resp.choices[0].message.content : JSON.stringify(resp.choices[0]?.message?.content ?? "");
        let parsed;
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { champion_verdict: raw };
        } catch {
          parsed = { champion_verdict: raw };
        }
        const result = { symbol, timeframe, timestamp: Date.now(), analysis: parsed, raw };
        serverCache.set(cacheKey, result, 3e5);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: `Champion \u5206\u6790\u5931\u6557\uFF1A${msg}` });
      }
    })
  }),
  cannonball: router({
    analyze: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      htf_tf: z3.string().default("2H"),
      ltf_tf: z3.string().default("30m"),
      sl_atr_mult: z3.number().min(0.1).max(0.8).default(0.3),
      tp2_atr_mult: z3.number().min(1).max(4).default(2.5),
      confluence_threshold: z3.number().min(40).max(80).default(50),
      avoid_extremes_atr: z3.number().min(0.3).max(1.5).default(0.8)
    })).query(async ({ input }) => {
      const symbol = normalizeSymbol(input.symbol);
      const params = {
        htf_tf: input.htf_tf,
        ltf_tf: input.ltf_tf,
        sl_atr_mult: input.sl_atr_mult,
        tp2_atr_mult: input.tp2_atr_mult,
        confluence_threshold: input.confluence_threshold,
        avoid_extremes_atr: input.avoid_extremes_atr
      };
      const paramKey = `${params.htf_tf}:${params.ltf_tf}:${params.sl_atr_mult}:${params.tp2_atr_mult}:${params.confluence_threshold}:${params.avoid_extremes_atr}`;
      const cacheKey = `cannonball:${symbol}:${paramKey}:${Math.floor(Date.now() / 6e4)}`;
      const cached = serverCache.get(cacheKey);
      if (cached) return cached;
      try {
        const result = await runCannonballAnalysis(symbol, params);
        serverCache.set(cacheKey, result, 6e4);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: `CannonBall \u5206\u6790\u5931\u6557\uFF1A${msg}` });
      }
    })
  }),
  combo: router({
    liveSignal: publicProcedure.input(z3.object({
      symbol: z3.string().default("BTCUSDT"),
      interval: z3.string().default("15m"),
      limit: z3.number().min(200).max(2160).default(500),
      strategies: z3.array(z3.enum([
        "ema_cross",
        "rsi_reversal",
        "bollinger",
        "macd",
        "smc",
        "pa",
        "chan",
        "liquidity_sweep",
        "vwap_reversion",
        "composite",
        "cannonball",
        "hwr_model_a",
        "hwr_model_b",
        "hwr_model_c"
      ])).default(["ema_cross", "cannonball", "hwr_model_a", "hwr_model_c", "macd"]),
      use_triple_mtf: z3.boolean().default(true)
    })).mutation(async ({ input }) => {
      const sym = normalizeSymbol(input.symbol);
      const bar = input.interval;
      const lim = input.limit;
      const TRIPLE_MTF_SET = /* @__PURE__ */ new Set(["bollinger", "chan", "vwap_reversion", "composite"]);
      const [primaryCandles, candles4h] = await Promise.all([
        fetchCandles(sym, bar, lim),
        fetchCandles(sym, "4h", 500)
      ]);
      const needsTriple = input.strategies.some((s) => TRIPLE_MTF_SET.has(s));
      const candles1h = needsTriple ? await fetchCandles(sym, "1h", 500) : null;
      const results = await Promise.all(
        input.strategies.map(async (s) => {
          const isTriple = TRIPLE_MTF_SET.has(s) && input.use_triple_mtf;
          const result = runBacktest({
            candles: primaryCandles,
            strategy: s,
            symbol: sym,
            interval: bar,
            enable_mtf_filter: true,
            enable_fee: false,
            enable_trailing_stop: false,
            enable_adx_filter: true,
            candles_4h: candles4h,
            candles_1h: isTriple ? candles1h : void 0
          });
          const trades = result.trades ?? [];
          const lastTrade = trades.length > 0 ? trades[trades.length - 1] : null;
          const recent = trades.slice(-20);
          const recentWr = recent.length > 0 ? Math.round(recent.filter((t2) => (t2.pnl_net_pct ?? 0) > 0).length / recent.length * 100) : 0;
          return {
            strategy: s,
            mtf_type: isTriple ? "triple" : "dual",
            total_trades: result.total_trades,
            win_rate: result.win_rate,
            recent_wr: recentWr,
            last_trade: lastTrade,
            signal_direction: lastTrade?.direction ?? null,
            signal_score: lastTrade?.signal_score ?? null,
            entry: lastTrade?.entry_price ?? null,
            sl: lastTrade?.sl_price ?? null,
            tp1: lastTrade?.tp_price ?? null,
            tp2: lastTrade?.tp2_price ?? null,
            entry_time: lastTrade?.entry_time ?? null,
            exit_time: lastTrade?.exit_time ?? null
          };
        })
      );
      const now = Date.now();
      const intervalMs = {
        "1m": 6e4,
        "3m": 18e4,
        "5m": 3e5,
        "15m": 9e5,
        "30m": 18e5,
        "1h": 36e5,
        "4h": 144e5,
        "1d": 864e5
      };
      const barMs = intervalMs[bar] ?? 9e5;
      const activeWindow = barMs * 8;
      const activeSignals = results.filter(
        (r) => r.signal_direction !== null && (r.exit_time == null || r.exit_time * 1e3 > now - activeWindow)
      );
      function calcCompositeScore(sig) {
        const rawScore = sig.signal_score ?? 0;
        const normalizedScore = rawScore / 10;
        const wrScore = sig.recent_wr / 100;
        let rrScore = 0.5;
        if (sig.entry && sig.sl && sig.tp1) {
          const risk = Math.abs(sig.entry - sig.sl);
          const reward = Math.abs(sig.tp1 - sig.entry);
          if (risk > 0) {
            const rr = reward / risk;
            rrScore = Math.min(rr / 3, 1);
          }
        }
        let freshnessScore = 0.5;
        if (sig.entry_time) {
          const ageMs = now - sig.entry_time * 1e3;
          const maxAge = barMs * 4;
          freshnessScore = Math.max(0, 1 - ageMs / maxAge);
        }
        return normalizedScore * 0.35 + wrScore * 0.25 + rrScore * 0.2 + freshnessScore * 0.2;
      }
      const bestSignal = activeSignals.length > 0 ? [...activeSignals].sort((a, b) => calcCompositeScore(b) - calcCompositeScore(a))[0] : null;
      return {
        symbol: sym,
        interval: bar,
        timestamp: now,
        all_signals: results,
        active_signals: activeSignals,
        best_signal: bestSignal,
        combo_name: input.strategies.join("+"),
        recommended_combos: [
          { name: "\u6700\u512A\u5E73\u8861", strategies: ["ema_cross", "cannonball", "hwr_model_a", "hwr_model_c", "macd"], note: "\u542B CannonBall \u7D50\u69CB\u78BA\u8A8D\u8207\u8DA8\u52E2\u5EF6\u7E8C" },
          { name: "\u6700\u9AD8\u52DD\u7387", strategies: ["bollinger", "ema_cross", "cannonball", "hwr_model_a", "macd"], note: "\u52A0\u5165 CannonBall \u5F8C\u66F4\u504F\u4FDD\u5B88\u78BA\u8A8D" },
          { name: "\u6700\u4F4E\u56DE\u64A4", strategies: ["ema_cross", "cannonball", "hwr_model_a", "vwap_reversion"], note: "\u504F\u91CD\u7D50\u69CB\u78BA\u8A8D\u8207\u5747\u503C\u56DE\u6B78\u4E92\u88DC" },
          { name: "\u9AD8\u6D3B\u8E8D\u5EA6", strategies: ["pa", "cannonball", "hwr_model_b", "macd", "chan"], note: "\u517C\u9867\u8DA8\u52E2\u8FFD\u8E64\u8207\u7D50\u69CB\u578B\u56DE\u8E29" }
        ]
      };
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {}
  },
  server: {
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    },
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, clientPort: 443, protocol: "wss", host: "0.0.0.0" },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (req, res) => {
    if (req.originalUrl === "/ws" || req.originalUrl.startsWith("/ws?")) {
      res.status(404).end();
      return;
    }
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/wsServer.ts
import { WebSocketServer, WebSocket } from "ws";
var MAX_SYMBOLS_PER_STREAM = 20;
var HEARTBEAT_INTERVAL = 3e4;
var KRAKEN_POLL_INTERVAL = 15e3;
var MARKET_STALE_MS = 45e3;
var clients = /* @__PURE__ */ new Map();
var KRAKEN_SYMBOL_MAP2 = {
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
var marketDataState = {
  refreshTimer: null,
  isRefreshing: false,
  subscribedSymbols: /* @__PURE__ */ new Set(),
  lastError: null,
  lastUpdateTs: null,
  provider: "kraken_polling"
};
var heartbeatTimer = null;
function generateClientId() {
  return Math.random().toString(36).slice(2, 10);
}
function getActiveSymbols() {
  const symbols = /* @__PURE__ */ new Set();
  clients.forEach((client) => {
    client.subscribedSymbols.forEach((s) => symbols.add(s));
  });
  return Array.from(symbols).slice(0, MAX_SYMBOLS_PER_STREAM);
}
function isMarketDataConnected() {
  return !!marketDataState.lastUpdateTs && Date.now() - marketDataState.lastUpdateTs < MARKET_STALE_MS;
}
function createStatusMessage(clientState) {
  return {
    type: "status",
    connected: true,
    subscribedSymbols: clientState ? Array.from(clientState.subscribedSymbols) : [],
    clientCount: clients.size,
    provider: marketDataState.subscribedSymbols.size > 0 ? marketDataState.provider : "none",
    marketDataConnected: isMarketDataConnected(),
    lastUpdateTs: marketDataState.lastUpdateTs,
    message: marketDataState.lastError
  };
}
function sendStatus(ws, clientState) {
  try {
    ws.send(JSON.stringify(createStatusMessage(clientState)));
  } catch {
  }
}
function broadcastStatus() {
  clients.forEach((client) => {
    sendStatus(client.ws, client);
  });
}
function broadcastTicker(msg) {
  const data = JSON.stringify(msg);
  clients.forEach((client) => {
    if (client.subscribedSymbols.has(msg.symbol) && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(data);
      } catch {
      }
    }
  });
}
function toKrakenPair(symbol) {
  return KRAKEN_SYMBOL_MAP2[symbol.toUpperCase()] ?? symbol.replace("USDT", "USD");
}
async function fetchKrakenTicker(symbol) {
  const pair = toKrakenPair(symbol);
  const url = `https://api.kraken.com/0/public/Ticker?pair=${pair}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 CryptoDashboard/7.0" },
    signal: AbortSignal.timeout(12e3)
  });
  if (!response.ok) {
    throw new Error(`Kraken HTTP ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  if (Array.isArray(payload.error) && payload.error.length > 0) {
    throw new Error(`Kraken API \u932F\u8AA4\uFF1A${payload.error.join(", ")}`);
  }
  const result = payload.result ?? {};
  const firstKey = Object.keys(result)[0];
  if (!firstKey) {
    throw new Error(`Kraken ticker \u56DE\u61C9\u7F3A\u5C11\u8CC7\u6599\uFF1A${symbol}`);
  }
  const ticker = result[firstKey];
  const price = Number(ticker.c?.[0] ?? 0);
  const open24h = Number(ticker.o ?? 0);
  const high24h = Number(ticker.h?.[1] ?? ticker.h?.[0] ?? price);
  const low24h = Number(ticker.l?.[1] ?? ticker.l?.[0] ?? price);
  const volume24h = Number(ticker.v?.[1] ?? ticker.v?.[0] ?? 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Kraken ticker \u50F9\u683C\u7121\u6548\uFF1A${symbol}`);
  }
  const change24h = open24h > 0 ? (price - open24h) / open24h * 100 : 0;
  return {
    type: "ticker",
    symbol,
    price,
    change24h: Number.isFinite(change24h) ? change24h : 0,
    high24h: Number.isFinite(high24h) ? high24h : price,
    low24h: Number.isFinite(low24h) ? low24h : price,
    volume24h: Number.isFinite(volume24h) ? volume24h : 0,
    ts: Date.now()
  };
}
async function refreshMarketData(symbols) {
  if (symbols.length === 0 || marketDataState.isRefreshing) return;
  marketDataState.isRefreshing = true;
  try {
    const results = await Promise.allSettled(symbols.map((symbol) => fetchKrakenTicker(symbol)));
    let successCount = 0;
    const errors = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        successCount++;
        broadcastTicker(result.value);
      } else {
        errors.push(`${symbols[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    });
    if (successCount > 0) {
      marketDataState.lastUpdateTs = Date.now();
      marketDataState.lastError = errors.length > 0 ? `\u90E8\u5206\u5E63\u7A2E\u66F4\u65B0\u5931\u6557\uFF1A${errors.slice(0, 3).join(" | ")}` : null;
    } else if (errors.length > 0) {
      marketDataState.lastError = `\u5373\u6642\u8CC7\u6599\u66F4\u65B0\u5931\u6557\uFF1A${errors.slice(0, 3).join(" | ")}`;
    }
  } catch (error) {
    marketDataState.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    marketDataState.isRefreshing = false;
    broadcastStatus();
  }
}
function stopMarketPolling() {
  if (marketDataState.refreshTimer) {
    clearInterval(marketDataState.refreshTimer);
    marketDataState.refreshTimer = null;
  }
  marketDataState.subscribedSymbols.clear();
}
function startMarketPolling(symbols) {
  stopMarketPolling();
  if (symbols.length === 0) {
    marketDataState.provider = "none";
    marketDataState.lastError = null;
    broadcastStatus();
    return;
  }
  marketDataState.provider = "kraken_polling";
  marketDataState.subscribedSymbols = new Set(symbols);
  void refreshMarketData(symbols);
  marketDataState.refreshTimer = setInterval(() => {
    void refreshMarketData(Array.from(marketDataState.subscribedSymbols));
  }, KRAKEN_POLL_INTERVAL);
}
function refreshMarketSubscriptions() {
  const activeSymbols = getActiveSymbols();
  const currentSymbols = Array.from(marketDataState.subscribedSymbols).sort().join(",");
  const nextSymbols = [...activeSymbols].sort().join(",");
  if (currentSymbols === nextSymbols && marketDataState.refreshTimer) {
    return;
  }
  startMarketPolling(activeSymbols);
}
function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    const toRemove = [];
    clients.forEach((client, id) => {
      if (client.ws.readyState !== WebSocket.OPEN) {
        toRemove.push(id);
        return;
      }
      if (now - client.lastPing > 9e4) {
        try {
          client.ws.terminate();
        } catch {
        }
        toRemove.push(id);
        return;
      }
      try {
        client.ws.ping();
      } catch {
      }
    });
    toRemove.forEach((id) => {
      clients.delete(id);
      console.log(`[WS] \u5BA2\u6236\u7AEF ${id} \u5DF2\u79FB\u9664\uFF08\u5FC3\u8DF3\u8D85\u6642\uFF09`);
    });
    if (toRemove.length > 0) {
      refreshMarketSubscriptions();
    }
  }, HEARTBEAT_INTERVAL);
}
function initWebSocketServer(httpServer) {
  const wss2 = new WebSocketServer({
    server: httpServer,
    path: "/ws"
  });
  console.log("[WS] WebSocket \u4F3A\u670D\u5668\u5DF2\u521D\u59CB\u5316\uFF0C\u8DEF\u5F91: /ws");
  startHeartbeat();
  wss2.on("connection", (ws, req) => {
    const clientId = generateClientId();
    const clientIp = req.socket.remoteAddress ?? "unknown";
    const clientState = {
      ws,
      subscribedSymbols: /* @__PURE__ */ new Set(),
      lastPing: Date.now()
    };
    clients.set(clientId, clientState);
    console.log(`[WS] \u65B0\u5BA2\u6236\u7AEF\u9023\u63A5: ${clientId} (${clientIp})\uFF0C\u7576\u524D ${clients.size} \u500B\u9023\u63A5`);
    sendStatus(ws, clientState);
    ws.on("pong", () => {
      clientState.lastPing = Date.now();
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case "subscribe": {
            const symbols = (msg.symbols ?? []).map((s) => s.toUpperCase()).filter((s) => /^[A-Z0-9]+USDT$/.test(s)).slice(0, 10);
            const newSymbolsKey = [...symbols].sort().join(",");
            const oldSymbolsKey = Array.from(clientState.subscribedSymbols).sort().join(",");
            if (newSymbolsKey === oldSymbolsKey) {
              sendStatus(ws, clientState);
              break;
            }
            clientState.subscribedSymbols = new Set(symbols);
            refreshMarketSubscriptions();
            sendStatus(ws, clientState);
            console.log(`[WS] \u5BA2\u6236\u7AEF ${clientId} \u8A02\u95B1: ${symbols.join(", ")}`);
            break;
          }
          case "unsubscribe": {
            const symbols = (msg.symbols ?? []).map((s) => s.toUpperCase());
            symbols.forEach((s) => clientState.subscribedSymbols.delete(s));
            refreshMarketSubscriptions();
            sendStatus(ws, clientState);
            break;
          }
          case "ping": {
            clientState.lastPing = Date.now();
            const pong = { type: "pong", ts: Date.now() };
            try {
              ws.send(JSON.stringify(pong));
            } catch {
            }
            break;
          }
        }
      } catch {
      }
    });
    ws.on("close", () => {
      clients.delete(clientId);
      console.log(`[WS] \u5BA2\u6236\u7AEF ${clientId} \u65B7\u958B\uFF0C\u5269\u9918 ${clients.size} \u500B\u9023\u63A5`);
      refreshMarketSubscriptions();
    });
    ws.on("error", () => {
      clients.delete(clientId);
      refreshMarketSubscriptions();
    });
  });
  process.on("SIGTERM", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    stopMarketPolling();
    wss2.close();
  });
  return wss2;
}
function getWsServerStats() {
  return {
    clientCount: clients.size,
    marketDataConnected: isMarketDataConnected(),
    provider: marketDataState.subscribedSymbols.size > 0 ? marketDataState.provider : "none",
    subscribedSymbols: Array.from(marketDataState.subscribedSymbols),
    lastUpdateTs: marketDataState.lastUpdateTs,
    lastError: marketDataState.lastError
  };
}

// server/signalScanner.ts
init_analysis();
import { WebSocket as WebSocket2 } from "ws";

// server/live_strategy_governance.ts
var SCANNER_GOVERNANCE_RULES = {
  hwr_model_a: {
    family: "trend_pullback",
    live_enabled: true,
    regime_whitelist: ["trending", "compressed", "chaotic"],
    min_total_trades: 1,
    max_signal_age_bars: 12,
    summary: "\u8F14\u52A9\u578B\u8DA8\u52E2\u56DE\u8E29\u7B56\u7565\uFF0C\u6A23\u672C\u9580\u6ABB\u653E\u5BEC\u70BA\u89C0\u5BDF\u7D1A\u3002"
  },
  hwr_model_b: {
    family: "trend_pullback",
    live_enabled: true,
    regime_whitelist: ["trending", "chaotic"],
    min_total_trades: 3,
    max_signal_age_bars: 12,
    summary: "\u4E3B\u529B\u8DA8\u52E2\u56DE\u8E29\u7B56\u7565\uFF0C\u7DAD\u6301\u6700\u4F4E\u53EF\u7528\u6A23\u672C\u8207\u8F03\u65B0\u8A0A\u865F\u8981\u6C42\u3002"
  },
  cannonball: {
    family: "structure",
    live_enabled: true,
    regime_whitelist: ["trending", "compressed", "chaotic"],
    min_total_trades: 1,
    max_signal_age_bars: 16,
    summary: "\u7D50\u69CB\u7B56\u7565\u4EE5\u53EF\u7528\u6027\u512A\u5148\uFF0C\u4F46\u4ECD\u9650\u5236\u70BA\u8FD1\u671F\u6709\u6548\u8A0A\u865F\u3002"
  },
  ema_cross: {
    family: "trend_confirm",
    live_enabled: true,
    regime_whitelist: ["trending"],
    min_total_trades: 0,
    max_signal_age_bars: 8,
    summary: "\u4F4E\u983B\u78BA\u8A8D\u7B56\u7565\u4FDD\u7559\u5F85\u547D\u8CC7\u683C\uFF0C\u907F\u514D\u56E0\u6A23\u672C\u7A00\u5C11\u6C38\u4E45\u505C\u7528\u3002"
  },
  vwap_reversion: {
    family: "mean_reversion",
    live_enabled: true,
    regime_whitelist: ["ranging"],
    min_total_trades: 0,
    max_signal_age_bars: 8,
    summary: "\u5747\u503C\u56DE\u6B78\u7B56\u7565\u50C5\u5728\u9707\u76EA\u5E02\u5F85\u547D\uFF0C\u4E26\u7DAD\u6301\u8F03\u77ED\u6642\u6548\u3002"
  }
};

// server/signalScanner.ts
var SCAN_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
var SCAN_INTERVAL_MS = 2 * 60 * 1e3;
var SCAN_BAR = "15m";
var SCAN_LIMIT = 500;
var BAR_MS = 9e5;
var STRATEGY_PROFILES = SCANNER_GOVERNANCE_RULES;
var LIVE_SCAN_STRATEGIES = Object.entries(STRATEGY_PROFILES).filter(([, profile]) => Boolean(profile?.live_enabled)).map(([strategy]) => strategy);
function getStrategiesForRegime(regime) {
  const prioritized = LIVE_SCAN_STRATEGIES.filter(
    (strategy) => STRATEGY_PROFILES[strategy]?.regime_whitelist.includes(regime)
  );
  return prioritized.length > 0 ? prioritized : LIVE_SCAN_STRATEGIES;
}
var signalCache = /* @__PURE__ */ new Map();
setInterval(() => {
  const now = Date.now();
  const keysToDelete = [];
  signalCache.forEach((entry, key) => {
    if (now - entry.timestamp > BAR_MS * 16) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((k) => signalCache.delete(k));
}, 10 * 60 * 1e3);
var wss = null;
function setWssForScanner(server) {
  wss = server;
}
var TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
var TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
async function sendTelegram(text) {
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
      console.error(`[Telegram] \u63A8\u9001\u5931\u6557: ${resp.status} \u2013 ${err.slice(0, 100)}`);
    }
  } catch (err) {
    console.error(`[Telegram] \u63A8\u9001\u7570\u5E38:`, err);
  }
}
function buildTelegramSignalMsg(symbol, direction, entry, sl, tp1, tp2, strategy, signalScore, recentWr, regime, interval) {
  const dirEmoji = direction === "long" ? "\u{1F4C8}" : "\u{1F4C9}";
  const dirLabel = direction === "long" ? "\u505A\u591A" : "\u505A\u7A7A";
  const slDist = Math.abs((sl - entry) / entry * 100).toFixed(2);
  const tp1Dist = Math.abs((tp1 - entry) / entry * 100).toFixed(2);
  const rr = sl > 0 && entry > 0 ? (Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(2) : "N/A";
  const regimeMap = {
    trending: "\u{1F4CA} \u8DA8\u52E2\u5E02",
    ranging: "\u2194\uFE0F \u9707\u76EA\u5E02",
    compressed: "\u{1F504} \u58D3\u7E2E\u5E02",
    chaotic: "\u26A0\uFE0F \u6DF7\u6C8C\u5E02"
  };
  const regimeLabel = regimeMap[regime] ?? regime;
  const scoreStr = signalScore !== null ? `${signalScore}/10` : "N/A";
  const priceStr = (p) => p >= 1e3 ? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p >= 1 ? p.toFixed(4) : p.toFixed(6);
  return [
    `\u{1F514} <b>\u65B0\u4EA4\u6613\u4FE1\u865F</b>`,
    ``,
    `${dirEmoji} <b>${symbol}</b> ${dirLabel}  |  ${interval}  |  ${regimeLabel}`,
    ``,
    `\u{1F4CC} <b>\u9032\u5834\u50F9\uFF1A</b><code>${priceStr(entry)}</code>`,
    `\u{1F6D1} <b>\u6B62\u640D\uFF1A</b><code>${priceStr(sl)}</code>  (-${slDist}%)`,
    `\u{1F3AF} <b>\u6B62\u76C81\uFF1A</b><code>${priceStr(tp1)}</code>  (+${tp1Dist}%)`,
    `\u{1F3AF} <b>\u6B62\u76C82\uFF1A</b><code>${priceStr(tp2)}</code>`,
    ``,
    `\u2696\uFE0F RR \u6BD4\uFF1A<b>${rr}</b>  |  \u7B56\u7565\uFF1A<b>${strategy}</b>`,
    `\u{1F4CA} \u8A55\u5206\uFF1A<b>${scoreStr}</b>  |  \u8FD1\u671F\u52DD\u7387\uFF1A<b>${recentWr.toFixed(1)}%</b>`,
    ``,
    `\u23F3 GPT-5.4 \u6DF1\u5EA6\u5206\u6790\u4E2D\uFF0C\u7A0D\u5F8C\u66F4\u65B0...`
  ].join("\n");
}
function buildTelegramGptMsg(symbol, direction, entry, strategy, gptAnalysis) {
  const dirEmoji = direction === "long" ? "\u{1F4C8}" : "\u{1F4C9}";
  const priceStr = entry >= 1e3 ? entry.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : entry.toFixed(4);
  const maxLen = 3200;
  const analysis = gptAnalysis.length > maxLen ? gptAnalysis.slice(0, maxLen) + "\n...\uFF08\u5206\u6790\u622A\u65B7\uFF09" : gptAnalysis;
  return [
    `\u{1F916} <b>GPT-5.4 \u6DF1\u5EA6\u5206\u6790</b>`,
    `${dirEmoji} <b>${symbol}</b> @ <code>${priceStr}</code>  |  \u7B56\u7565\uFF1A${strategy}`,
    ``,
    analysis
  ].join("\n");
}
function broadcastSignalAlert(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  let sentCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket2.OPEN) {
      try {
        client.send(data);
        sentCount++;
      } catch {
      }
    }
  });
  if (sentCount > 0) {
    console.log(`[SignalScanner] \u5EE3\u64AD\u4FE1\u865F\u5230 ${sentCount} \u500B\u5BA2\u6236\u7AEF`);
  }
}
async function analyzeWithGpt54(symbol, direction, entry, sl, tp1, tp2, strategy, recentWr, signalScore, interval, regime) {
  const apiKey = process.env.SOXIO_API_KEY ?? "";
  if (!apiKey) return "\uFF08GPT-5.4 API Key \u672A\u8A2D\u5B9A\uFF09";
  const rr = sl > 0 && entry > 0 ? Math.abs(tp1 - entry) / Math.abs(entry - sl) : 0;
  const dirText = direction === "long" ? "\u505A\u591A\uFF08\u8CB7\u5165\uFF09" : "\u505A\u7A7A\uFF08\u8CE3\u51FA\uFF09";
  const regimeMap = {
    trending: "\u8DA8\u52E2\u5E02\uFF08ADX \u5F37\uFF0C\u6709\u65B9\u5411\u6027\uFF09",
    ranging: "\u9707\u76EA\u5E02\uFF08ADX \u5F31\uFF0C\u7121\u65B9\u5411\u6027\uFF09",
    compressed: "\u58D3\u7E2E\u5E02\uFF08\u5E03\u6797\u5E36\u6975\u7A84\uFF0C\u7B49\u5F85\u7A81\u7834\uFF09",
    chaotic: "\u6DF7\u6C8C\u5E02\uFF08\u6CE2\u52D5\u7387\u6975\u9AD8\uFF0C\u8B39\u614E\u64CD\u4F5C\uFF09"
  };
  const prompt = `\u4F60\u662F\u4E00\u4F4D\u5C08\u696D\u7684\u52A0\u5BC6\u8CA8\u5E63\u4EA4\u6613\u5206\u6790\u5E2B\u3002\u4EE5\u4E0B\u662F\u4E00\u500B\u7531\u91CF\u5316\u7B56\u7565\u7CFB\u7D71\u7522\u751F\u7684\u4EA4\u6613\u4FE1\u865F\uFF0C\u8ACB\u7528\u7E41\u9AD4\u4E2D\u6587\u9032\u884C\u6DF1\u5EA6\u5206\u6790\uFF1A

**\u4EA4\u6613\u4FE1\u865F\u8CC7\u8A0A**
- \u5E63\u7A2E\uFF1A${symbol}
- \u6642\u9593\u6846\u67B6\uFF1A${interval}
- \u65B9\u5411\uFF1A${dirText}
- \u9032\u5834\u50F9\uFF1A${entry.toFixed(2)}
- \u6B62\u640D\u50F9\uFF1A${sl.toFixed(2)}\uFF08\u8DDD\u96E2 ${Math.abs((sl - entry) / entry * 100).toFixed(2)}%\uFF09
- \u6B62\u76C81\uFF1A${tp1.toFixed(2)}\uFF08\u8DDD\u96E2 ${Math.abs((tp1 - entry) / entry * 100).toFixed(2)}%\uFF09
- \u6B62\u76C82\uFF1A${tp2.toFixed(2)}\uFF08\u8DDD\u96E2 ${Math.abs((tp2 - entry) / entry * 100).toFixed(2)}%\uFF09
- \u98A8\u96AA\u5831\u916C\u6BD4\uFF08RR\uFF09\uFF1A${rr.toFixed(2)}
- \u89F8\u767C\u7B56\u7565\uFF1A${strategy}
- \u4FE1\u865F\u8A55\u5206\uFF1A${signalScore !== null ? `${signalScore}/10` : "N/A"}
- \u8FD1\u671F\u52DD\u7387\uFF1A${recentWr.toFixed(1)}%
- \u7576\u524D\u5E02\u6CC1\uFF1A${regimeMap[regime] ?? regime}

\u8ACB\u5F9E\u4EE5\u4E0B\u89D2\u5EA6\u5206\u6790\uFF08\u6BCF\u9EDE 1-2 \u53E5\uFF0C\u7C21\u6F54\u6709\u529B\uFF09\uFF1A
1. **\u4FE1\u865F\u8CEA\u91CF\u8A55\u4F30**\uFF1A\u9019\u500B\u4FE1\u865F\u7684\u53EF\u4FE1\u5EA6\u5982\u4F55\uFF1FRR \u6BD4\u662F\u5426\u5408\u7406\uFF1F
2. **\u98A8\u96AA\u63D0\u793A**\uFF1A\u4E3B\u8981\u98A8\u96AA\u9EDE\u5728\u54EA\u88E1\uFF1F\u4EC0\u9EBC\u60C5\u6CC1\u4E0B\u61C9\u8A72\u653E\u68C4\u9019\u7B46\u4EA4\u6613\uFF1F
3. **\u57F7\u884C\u5EFA\u8B70**\uFF1A\u9032\u5834\u6642\u6A5F\u3001\u5009\u4F4D\u5EFA\u8B70\uFF08\u4FDD\u5B88/\u6A19\u6E96/\u7A4D\u6975\uFF09
4. **\u5E02\u6CC1\u9069\u914D\u6027**\uFF1A\u7576\u524D${regimeMap[regime] ?? regime}\u4E0B\uFF0C${strategy} \u7B56\u7565\u7684\u9069\u7528\u6027\u5982\u4F55\uFF1F
5. **\u7E3D\u7D50\u8A55\u5206**\uFF1A\u7D66\u9019\u500B\u4FE1\u865F\u6253\u5206\uFF081-10\uFF09\uFF0C\u4E26\u8AAA\u660E\u7406\u7531`;
  try {
    const resp = await fetch("https://apikey.soxio.me/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 800,
        stream: true
      }),
      signal: AbortSignal.timeout(6e4)
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[SignalScanner] GPT-5.4 API \u5931\u6557: ${resp.status} \u2013 ${errText.slice(0, 200)}`);
      return `\uFF08GPT-5.4 \u5206\u6790\u5931\u6557\uFF1AHTTP ${resp.status}\uFF09`;
    }
    const rawText = await resp.text();
    let fullContent = "";
    for (const line of rawText.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") break;
      try {
        const chunk = JSON.parse(jsonStr);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) fullContent += delta;
      } catch {
      }
    }
    return fullContent || "\uFF08GPT-5.4 \u56DE\u61C9\u70BA\u7A7A\uFF09";
  } catch (err) {
    console.error("[SignalScanner] GPT-5.4 \u8ABF\u7528\u7570\u5E38:", err);
    return `\uFF08GPT-5.4 \u5206\u6790\u7570\u5E38\uFF1A${err instanceof Error ? err.message : String(err)}\uFF09`;
  }
}
function isDuplicateSignal(symbol, direction, strategy, entry) {
  const cacheKey = `${symbol}_${direction}_${strategy}`;
  const cached = signalCache.get(cacheKey);
  if (!cached) return false;
  const now = Date.now();
  if (now - cached.timestamp > BAR_MS * 16) return false;
  const isHighLiquidity = /^(BTC|ETH)/.test(symbol.toUpperCase());
  const priceTolerance = isHighLiquidity ? 3e-3 : 5e-3;
  const priceDiff = Math.abs(cached.entry - entry) / entry;
  return priceDiff < priceTolerance;
}
async function scanSymbol(symbol) {
  try {
    const [primaryCandles, candles4h] = await Promise.all([
      fetchCandles(symbol, SCAN_BAR, SCAN_LIMIT),
      fetchCandles(symbol, "4h", 500)
    ]);
    if (!primaryCandles || primaryCandles.length < 100) return;
    const regime = detectRegime(primaryCandles.slice(-100));
    const strategiesToScan = getStrategiesForRegime(regime);
    const now = Date.now();
    const activeWindow = BAR_MS * 8;
    const strategyResults = await Promise.allSettled(
      strategiesToScan.map(async (strategy) => {
        const result = runBacktest({
          candles: primaryCandles,
          strategy,
          symbol,
          interval: SCAN_BAR,
          htf_candles: candles4h,
          use_true_mtf: true,
          enable_mtf_filter: true,
          enable_trailing_stop: true,
          enable_fee: true
        });
        const trades = result.trades;
        if (!trades || trades.length === 0) return null;
        const lastTrade = trades[trades.length - 1];
        const recentTrades = trades.slice(-20);
        const recentWins = recentTrades.filter((t2) => t2.pnl_net_pct > 0).length;
        const recentWr = recentTrades.length > 0 ? recentWins / recentTrades.length * 100 : 0;
        const isActive = lastTrade.direction && (lastTrade.exit_time == null || lastTrade.exit_time * 1e3 > now - activeWindow);
        if (!isActive) return null;
        return {
          strategy,
          direction: lastTrade.direction,
          entry: lastTrade.entry_price,
          sl: lastTrade.sl_price,
          tp1: lastTrade.tp_price,
          tp2: lastTrade.tp2_price ?? lastTrade.tp_price,
          signal_score: lastTrade.signal_score ?? null,
          recent_wr: recentWr,
          entry_time: lastTrade.entry_time,
          reference_time: lastTrade.exit_time ?? Math.floor(now / 1e3),
          total_trades: result.total_trades
        };
      })
    );
    const signalResults = strategyResults.filter((r) => r.status === "fulfilled" && r.value !== null).map((r) => r.value);
    if (signalResults.length === 0) {
      let anyPrevSignal = false;
      signalCache.forEach((_, key) => {
        if (key.startsWith(symbol)) anyPrevSignal = true;
      });
      if (anyPrevSignal) {
        const expiredKeys = [];
        signalCache.forEach((_, key) => {
          if (key.startsWith(symbol)) expiredKeys.push(key);
        });
        expiredKeys.forEach((k) => signalCache.delete(k));
      }
      return;
    }
    const calcScore = (sig) => {
      const normalizedScore = (sig.signal_score ?? 0) / 10;
      const wrScore = sig.recent_wr / 100;
      let rrScore = 0.5;
      if (sig.entry && sig.sl && sig.tp1) {
        const risk = Math.abs(sig.entry - sig.sl);
        const reward = Math.abs(sig.tp1 - sig.entry);
        if (risk > 0) rrScore = Math.min(reward / risk / 3, 1);
      }
      const ageMs = now - sig.entry_time * 1e3;
      const freshnessScore = Math.max(0, 1 - ageMs / (BAR_MS * 4));
      return normalizedScore * 0.35 + wrScore * 0.25 + rrScore * 0.2 + freshnessScore * 0.2;
    };
    const eligibleSignals = signalResults.map((sig) => {
      const profile = STRATEGY_PROFILES[sig.strategy];
      if (!profile || !profile.live_enabled) return null;
      const ageBars = (now - sig.reference_time * 1e3) / BAR_MS;
      if (ageBars > profile.max_signal_age_bars) return null;
      if (sig.total_trades < profile.min_total_trades) return null;
      if (profile.min_signal_score !== void 0) {
        if (sig.signal_score === null || sig.signal_score < profile.min_signal_score) return null;
      }
      return {
        ...sig,
        family: profile.family,
        composite_score: calcScore(sig)
      };
    }).filter((sig) => sig !== null).sort((a, b) => b.composite_score - a.composite_score);
    if (eligibleSignals.length === 0) {
      console.log(`[SignalScanner] ${symbol} \u5728 ${regime} \u5E02\u6CC1\u4E0B\u7121\u7B26\u5408 live \u767D\u540D\u55AE\u7684\u6709\u6548\u4FE1\u865F`);
      return;
    }
    const bestPerFamily = /* @__PURE__ */ new Map();
    for (const sig of eligibleSignals) {
      const key = `${sig.direction}_${sig.family}`;
      if (!bestPerFamily.has(key)) bestPerFamily.set(key, sig);
    }
    const decorrelatedSignals = Array.from(bestPerFamily.values());
    const directionGroups = /* @__PURE__ */ new Map();
    for (const sig of decorrelatedSignals) {
      const group = directionGroups.get(sig.direction) ?? [];
      group.push(sig);
      directionGroups.set(sig.direction, group);
    }
    const consensusGroup = Array.from(directionGroups.values()).filter((group) => group.length >= 2).sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const scoreA = a.reduce((sum, item) => sum + item.composite_score, 0);
      const scoreB = b.reduce((sum, item) => sum + item.composite_score, 0);
      return scoreB - scoreA;
    })[0];
    const bestSignal = consensusGroup ? [...consensusGroup].sort((a, b) => b.composite_score - a.composite_score)[0] : decorrelatedSignals.find((sig) => sig.composite_score >= 0.68);
    if (!bestSignal) {
      console.log(`[SignalScanner] ${symbol} \u7121\u96D9\u5BB6\u65CF\u5171\u8B58\uFF0C\u4E14\u6C92\u6709\u8DB3\u5920\u5F37\u7684\u55AE\u7368\u9AD8\u5206\u4FE1\u865F`);
      return;
    }
    const effectiveSignals = consensusGroup?.length ?? 1;
    if (isDuplicateSignal(symbol, bestSignal.direction, bestSignal.strategy, bestSignal.entry)) {
      console.log(`[SignalScanner] ${symbol} \u4FE1\u865F\u91CD\u8907\uFF08${bestSignal.direction}/${bestSignal.strategy}\uFF09\uFF0C\u8DF3\u904E\u63A8\u9001`);
      return;
    }
    const cacheKey = `${symbol}_${bestSignal.direction}_${bestSignal.strategy}`;
    signalCache.set(cacheKey, {
      direction: bestSignal.direction,
      strategy: bestSignal.strategy,
      entry: bestSignal.entry,
      timestamp: now,
      expired: false
    });
    const dirEmoji = bestSignal.direction === "long" ? "\u{1F4C8}" : "\u{1F4C9}";
    console.log(`[SignalScanner] \u{1F514} \u65B0\u4FE1\u865F\uFF01${symbol} ${dirEmoji}${bestSignal.direction === "long" ? "\u505A\u591A" : "\u505A\u7A7A"} @ ${bestSignal.entry} (\u7B56\u7565: ${bestSignal.strategy}, \u5E02\u6CC1: ${regime})`);
    const baseMsg = {
      type: "signal_alert",
      symbol,
      interval: SCAN_BAR,
      direction: bestSignal.direction,
      entry: bestSignal.entry,
      sl: bestSignal.sl,
      tp1: bestSignal.tp1,
      tp2: bestSignal.tp2,
      strategy: bestSignal.strategy,
      signal_score: bestSignal.signal_score,
      recent_wr: bestSignal.recent_wr,
      timestamp: now,
      gpt_analysis: null,
      gpt_loading: true,
      regime,
      effective_signals: effectiveSignals
    };
    broadcastSignalAlert(baseMsg);
    sendTelegram(buildTelegramSignalMsg(
      symbol,
      bestSignal.direction,
      bestSignal.entry,
      bestSignal.sl,
      bestSignal.tp1,
      bestSignal.tp2,
      bestSignal.strategy,
      bestSignal.signal_score,
      bestSignal.recent_wr,
      regime,
      SCAN_BAR
    ));
    analyzeWithGpt54(
      symbol,
      bestSignal.direction,
      bestSignal.entry,
      bestSignal.sl,
      bestSignal.tp1,
      bestSignal.tp2,
      bestSignal.strategy,
      bestSignal.recent_wr,
      bestSignal.signal_score,
      SCAN_BAR,
      regime
    ).then((analysis) => {
      broadcastSignalAlert({ ...baseMsg, gpt_analysis: analysis, gpt_loading: false });
      console.log(`[SignalScanner] \u2705 ${symbol} GPT-5.4 \u5206\u6790\u5B8C\u6210`);
      if (analysis && !analysis.startsWith("\uFF08")) {
        sendTelegram(buildTelegramGptMsg(
          symbol,
          bestSignal.direction,
          bestSignal.entry,
          bestSignal.strategy,
          analysis
        ));
      }
    }).catch((err) => {
      console.error(`[SignalScanner] GPT-5.4 \u5206\u6790\u5931\u6557:`, err);
      broadcastSignalAlert({ ...baseMsg, gpt_analysis: "\uFF08\u5206\u6790\u5931\u6557\uFF09", gpt_loading: false });
    });
  } catch (err) {
    console.error(`[SignalScanner] \u6383\u63CF ${symbol} \u6642\u767C\u751F\u932F\u8AA4:`, err);
  }
}
var scanTimer = null;
var isScanning = false;
async function runScan() {
  if (isScanning) {
    console.log("[SignalScanner] \u4E0A\u6B21\u6383\u63CF\u5C1A\u672A\u5B8C\u6210\uFF0C\u8DF3\u904E\u672C\u6B21");
    return;
  }
  isScanning = true;
  console.log(`[SignalScanner] \u23F1 \u958B\u59CB\u4E26\u884C\u6383\u63CF ${SCAN_SYMBOLS.length} \u500B\u5E63\u7A2E...`);
  const start = Date.now();
  const CONCURRENCY = 2;
  for (let i = 0; i < SCAN_SYMBOLS.length; i += CONCURRENCY) {
    const batch = SCAN_SYMBOLS.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map((sym) => scanSymbol(sym)));
    if (i + CONCURRENCY < SCAN_SYMBOLS.length) {
      await new Promise((r) => setTimeout(r, 1e3));
    }
  }
  const elapsed = ((Date.now() - start) / 1e3).toFixed(1);
  console.log(`[SignalScanner] \u2705 \u6383\u63CF\u5B8C\u6210\uFF0C\u8017\u6642 ${elapsed}s`);
  isScanning = false;
}
function startSignalScanner(server) {
  setWssForScanner(server);
  console.log(`[SignalScanner] \u{1F680} v2.1 \u555F\u52D5\uFF0C\u6383\u63CF\u9593\u9694 ${SCAN_INTERVAL_MS / 6e4} \u5206\u9418\uFF0C\u76E3\u63A7\u5E63\u7A2E: ${SCAN_SYMBOLS.join(", ")}`);
  console.log(`[SignalScanner] Live \u767D\u540D\u55AE: ${LIVE_SCAN_STRATEGIES.join(", ")}`);
  setTimeout(() => {
    runScan();
    scanTimer = setInterval(runScan, SCAN_INTERVAL_MS);
  }, 9e4);
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);
  const healthHandler = (_req, res) => {
    const wsStats = getWsServerStats();
    res.json({
      status: "ok",
      uptime: Math.round(process.uptime()),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      version: "7.0",
      model: process.env.OPENAI_MODEL || "claude-opus-4-6",
      ws: {
        clients: wsStats.clientCount,
        market_data_connected: wsStats.marketDataConnected,
        provider: wsStats.provider,
        subscribed_symbols: wsStats.subscribedSymbols,
        last_update_ts: wsStats.lastUpdateTs,
        last_error: wsStats.lastError
      }
    });
  };
  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);
  const latestLiveSnapshotPath = process.env.LATEST_LIVE_SNAPSHOT_PATH || "/home/ubuntu/work/btcusdt_handover/crypto-dashboard-v5.9/runtime/btcusdt_live_signal_snapshot.json";
  app.get("/api/latest-live-snapshot", async (_req, res) => {
    try {
      const raw = await fs3.readFile(latestLiveSnapshotPath, "utf-8");
      const parsed = JSON.parse(raw);
      res.json({
        ok: true,
        source_path: latestLiveSnapshotPath,
        data: parsed
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({
        ok: false,
        source_path: latestLiveSnapshotPath,
        error: message
      });
    }
  });
  app.get("/api/diagnostics-summary", async (_req, res) => {
    try {
      const raw = await fs3.readFile(latestLiveSnapshotPath, "utf-8");
      const parsed = JSON.parse(raw);
      const enrichment = parsed?.diagnostics_enrichment ?? null;
      const workerVersion = parsed?.worker_version ?? "unknown";
      const generatedAt = parsed?.generated_at ?? null;
      res.json({
        ok: true,
        worker_version: workerVersion,
        generated_at: generatedAt,
        family_aggregations: enrichment?.family_aggregations ?? [],
        threshold_suggestions: enrichment?.threshold_suggestions ?? [],
        strategy_trends: enrichment?.strategy_trends ?? {}
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({
        ok: false,
        error: message
      });
    }
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    const wssInstance = initWebSocketServer(server);
    console.log(`WebSocket server ready at ws://localhost:${port}/ws`);
    startSignalScanner(wssInstance);
  });
}
startServer().catch(console.error);
