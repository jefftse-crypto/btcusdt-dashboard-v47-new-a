/**
 * pandaStrategy.ts — 熊貓策略（熊敖 @bh1908）信號偵測服務
 *
 * 整合 5 種核心策略：
 * 1. MACD 多週期分離法（核心策略）
 * 2. MJ 指標（MACD + KDJ 組合）
 * 3. 布林通道 + RSI 組合
 * 4. EMA 假突破 SMC 策略
 * 5. K 線三走勢 + EMA 過濾
 */

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PandaSignal {
  symbol: string;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  score: number;           // 0-100 綜合評分
  grade: "STRONG" | "MODERATE" | "WAIT" | "AVOID";
  strategies: {
    macd_mtf: MACDMtfResult;
    mj_indicator: MJIndicatorResult;
    boll_rsi: BollRsiResult;
    ema_fakeout: EmaFakeoutResult;
    kline_trend: KlineTrendResult;
  };
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  rr_ratio: number;
  veto_reasons: string[];
  timestamp: number;
}

export interface MACDMtfResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  htf_trend: "UP" | "DOWN" | "FLAT";
  ltf_histogram_below_zero: boolean;  // 做多時柱體在 0 軸下
  ltf_dif_separation: boolean;         // 快線從柱體分離
  separation_strength: number;         // 分離強度 0-1
}

export interface MJIndicatorResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  j_cross_zero: boolean;              // J 線穿越 0 軸
  j_direction: "UP" | "DOWN" | "FLAT";
  macd_bar_sync: boolean;             // MACD 柱體同步
  is_valid: boolean;                  // 有效訊號（非假信號）
}

export interface BollRsiResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  boll_direction: "UP" | "DOWN" | "FLAT";
  rsi_cross_50: boolean;              // RSI 穿越 50
  rsi_direction: "UP" | "DOWN" | "FLAT";
  divergence: "BULLISH" | "BEARISH" | "NONE";  // 背離
  rsi_value: number;
}

export interface EmaFakeoutResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  ema_direction: "UP" | "DOWN" | "FLAT";
  ltf_fakeout_detected: boolean;      // 小週期假突破
  htf_confirmed: boolean;             // 大週期確認
  fakeout_type: "FAKE_BREAKOUT_UP" | "FAKE_BREAKOUT_DOWN" | "NONE";
}

export interface KlineTrendResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  trend_type: "TRENDING" | "COUNTER_TREND" | "RANGING";
  ema_direction: "UP" | "DOWN" | "FLAT";
  reversal_signal: boolean;
  reversal_type: "BULLISH" | "BEARISH" | "NONE";
  is_chasing: boolean;                // 是否追單（行情已走太遠）
}

// ─── 技術指標計算工具 ───────────────────────────────────────────────────────

function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      ema.push(data[0]);
    } else {
      ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
  }
  return ema;
}

function calcSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
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

function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): {
  dif: number[];
  dea: number[];
  histogram: number[];
} {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const dif = emaFast.map((v, i) => v - emaSlow[i]);
  const dea = calcEMA(dif, signal);
  const histogram = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, histogram };
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = [];
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
    if (avgLoss === 0) { rsi.push(100); continue; }
    const rs = avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }
  return rsi;
}

function calcBollinger(closes: number[], period = 20, stdDev = 2): {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
} {
  const middle = calcSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];
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

function calcKDJ(candles: Candle[], period = 9): {
  k: number[];
  d: number[];
  j: number[];
} {
  const k: number[] = [];
  const d: number[] = [];
  const j: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      k.push(50); d.push(50); j.push(50);
      continue;
    }
    const slice = candles.slice(i - period + 1, i + 1);
    const highest = Math.max(...slice.map(c => c.high));
    const lowest = Math.min(...slice.map(c => c.low));
    const rsv = highest === lowest ? 50 : ((candles[i].close - lowest) / (highest - lowest)) * 100;
    const kVal = i === period - 1 ? rsv : k[i - 1] * 2 / 3 + rsv / 3;
    const dVal = i === period - 1 ? kVal : d[i - 1] * 2 / 3 + kVal / 3;
    const jVal = 3 * kVal - 2 * dVal;
    k.push(kVal); d.push(dVal); j.push(jVal);
  }
  return { k, d, j };
}

function calcATR(candles: Candle[], period = 14): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { tr.push(candles[i].high - candles[i].low); continue; }
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }
  return calcEMA(tr, period);
}

// ─── 策略一：MACD 多週期分離法 ──────────────────────────────────────────────

export function analyzeMACDMtf(htfCandles: Candle[], ltfCandles: Candle[]): MACDMtfResult {
  if (htfCandles.length < 50 || ltfCandles.length < 50) {
    return { signal: "NEUTRAL", score: 0, htf_trend: "FLAT", ltf_histogram_below_zero: false, ltf_dif_separation: false, separation_strength: 0 };
  }

  const htfCloses = htfCandles.map(c => c.close);
  const ltfCloses = ltfCandles.map(c => c.close);

  // 大週期趨勢（EMA20 方向）
  const htfEma20 = calcEMA(htfCloses, 20);
  const htfEmaSlope = htfEma20[htfEma20.length - 1] - htfEma20[htfEma20.length - 5];
  const htfTrend: "UP" | "DOWN" | "FLAT" = htfEmaSlope > 0 ? "UP" : htfEmaSlope < 0 ? "DOWN" : "FLAT";

  // 小週期 MACD
  const ltfMACD = calcMACD(ltfCloses);
  const n = ltfMACD.histogram.length;
  const curHist = ltfMACD.histogram[n - 1];
  const curDif = ltfMACD.dif[n - 1];
  const prevDif = ltfMACD.dif[n - 2];
  const prevHist = ltfMACD.histogram[n - 2];

  // 做多條件：柱體在 0 軸下方
  const histBelowZero = curHist < 0;
  // 做空條件：柱體在 0 軸上方
  const histAboveZero = curHist > 0;

  // 快線分離：DIF 方向與柱體方向相反（快線開始脫離柱體）
  // 做多：柱體向下（curHist < prevHist）但 DIF 向上（curDif > prevDif）
  const difSeparationLong = histBelowZero && curDif > prevDif && curHist < prevHist;
  // 做空：柱體向上（curHist > prevHist）但 DIF 向下（curDif < prevDif）
  const difSeparationShort = histAboveZero && curDif < prevDif && curHist > prevHist;

  // 分離強度：DIF 變化量 / ATR
  const ltfATR = calcATR(ltfCandles);
  const atr = ltfATR[ltfATR.length - 1];
  const separationStrength = atr > 0 ? Math.min(1, Math.abs(curDif - prevDif) / atr) : 0;

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;

  if (htfTrend === "UP" && histBelowZero && difSeparationLong) {
    signal = "LONG";
    score = 60 + Math.round(separationStrength * 25) + (htfEmaSlope > 0 ? 15 : 0);
  } else if (htfTrend === "DOWN" && histAboveZero && difSeparationShort) {
    signal = "SHORT";
    score = 60 + Math.round(separationStrength * 25) + (htfEmaSlope < 0 ? 15 : 0);
  } else if (htfTrend !== "FLAT") {
    // 部分條件滿足
    score = 30;
  }

  return {
    signal,
    score: Math.min(100, score),
    htf_trend: htfTrend,
    ltf_histogram_below_zero: histBelowZero,
    ltf_dif_separation: difSeparationLong || difSeparationShort,
    separation_strength: separationStrength,
  };
}

// ─── 策略二：MJ 指標（MACD + KDJ 組合）────────────────────────────────────

export function analyzeMJIndicator(candles: Candle[]): MJIndicatorResult {
  if (candles.length < 50) {
    return { signal: "NEUTRAL", score: 0, j_cross_zero: false, j_direction: "FLAT", macd_bar_sync: false, is_valid: false };
  }

  const closes = candles.map(c => c.close);
  const macd = calcMACD(closes);
  const kdj = calcKDJ(candles);

  const n = macd.histogram.length;
  const curJ = kdj.j[n - 1];
  const prevJ = kdj.j[n - 2];
  const curHist = macd.histogram[n - 1];

  // J 線穿越 0 軸（以 50 為 KDJ 的 0 軸等效）
  const jCrossUpZero = prevJ < 50 && curJ >= 50;
  const jCrossDownZero = prevJ > 50 && curJ <= 50;
  const jCrossZero = jCrossUpZero || jCrossDownZero;

  const jDirection: "UP" | "DOWN" | "FLAT" = curJ > prevJ ? "UP" : curJ < prevJ ? "DOWN" : "FLAT";

  // MACD 柱體同步：J 線向上穿越時，柱體應為正（綠）
  const macdBarSyncLong = jCrossUpZero && curHist > 0;
  const macdBarSyncShort = jCrossDownZero && curHist < 0;
  const macdBarSync = macdBarSyncLong || macdBarSyncShort;

  // 有效訊號：J 線穿越 + MACD 柱體同步
  const isValid = jCrossZero && macdBarSync;

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;

  if (isValid && macdBarSyncLong) {
    signal = "LONG";
    score = 75 + (Math.abs(curJ - 50) > 10 ? 15 : 5); // J 線偏離越大，動能越強
  } else if (isValid && macdBarSyncShort) {
    signal = "SHORT";
    score = 75 + (Math.abs(curJ - 50) > 10 ? 15 : 5);
  } else if (jCrossZero && !macdBarSync) {
    // 假信號
    score = 10;
  }

  return {
    signal,
    score: Math.min(100, score),
    j_cross_zero: jCrossZero,
    j_direction: jDirection,
    macd_bar_sync: macdBarSync,
    is_valid: isValid,
  };
}

// ─── 策略三：布林通道 + RSI 組合 ────────────────────────────────────────────

export function analyzeBollRsi(htfCandles: Candle[], ltfCandles: Candle[]): BollRsiResult {
  if (htfCandles.length < 30 || ltfCandles.length < 30) {
    return { signal: "NEUTRAL", score: 0, boll_direction: "FLAT", rsi_cross_50: false, rsi_direction: "FLAT", divergence: "NONE", rsi_value: 50 };
  }

  const htfCloses = htfCandles.map(c => c.close);
  const ltfCloses = ltfCandles.map(c => c.close);

  // 大週期布林通道方向
  const htfBoll = calcBollinger(htfCloses);
  const htfMiddle = htfBoll.middle;
  const n = htfMiddle.length;
  const bollSlope = htfMiddle[n - 1] - htfMiddle[n - 5];
  const bollDirection: "UP" | "DOWN" | "FLAT" = bollSlope > 0 ? "UP" : bollSlope < 0 ? "DOWN" : "FLAT";

  // 小週期 RSI
  const ltfRSI = calcRSI(ltfCloses);
  const m = ltfRSI.length;
  const curRSI = ltfRSI[m - 1];
  const prevRSI = ltfRSI[m - 2];

  const rsiCrossUp50 = prevRSI < 50 && curRSI >= 50;
  const rsiCrossDown50 = prevRSI > 50 && curRSI <= 50;
  const rsiCross50 = rsiCrossUp50 || rsiCrossDown50;
  const rsiDirection: "UP" | "DOWN" | "FLAT" = curRSI > prevRSI ? "UP" : curRSI < prevRSI ? "DOWN" : "FLAT";

  // 背離偵測（最近 10 根 K 線）
  const lookback = Math.min(10, ltfCandles.length - 1);
  const recentCloses = ltfCloses.slice(-lookback);
  const recentRSI = ltfRSI.slice(-lookback);
  let divergence: "BULLISH" | "BEARISH" | "NONE" = "NONE";

  // 頂背離：價格新高但 RSI 未新高
  const priceHigher = recentCloses[lookback - 1] > Math.max(...recentCloses.slice(0, -1));
  const rsiLower = recentRSI[lookback - 1] < Math.max(...recentRSI.slice(0, -1));
  if (priceHigher && rsiLower) divergence = "BEARISH";

  // 底背離：價格新低但 RSI 未新低
  const priceLower = recentCloses[lookback - 1] < Math.min(...recentCloses.slice(0, -1));
  const rsiHigher = recentRSI[lookback - 1] > Math.min(...recentRSI.slice(0, -1));
  if (priceLower && rsiHigher) divergence = "BULLISH";

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;

  if (bollDirection === "UP" && rsiCrossUp50) {
    signal = "LONG";
    score = 65;
    if (divergence === "BULLISH") score += 20;
    if (curRSI > 50 && curRSI < 70) score += 10; // RSI 在健康區間
  } else if (bollDirection === "DOWN" && rsiCrossDown50) {
    signal = "SHORT";
    score = 65;
    if (divergence === "BEARISH") score += 20;
    if (curRSI < 50 && curRSI > 30) score += 10;
  } else if (bollDirection !== "FLAT" && rsiDirection !== "FLAT") {
    score = 25;
  }

  // 背離警告：方向相反時扣分
  if (signal === "LONG" && divergence === "BEARISH") score -= 30;
  if (signal === "SHORT" && divergence === "BULLISH") score -= 30;

  return {
    signal,
    score: Math.max(0, Math.min(100, score)),
    boll_direction: bollDirection,
    rsi_cross_50: rsiCross50,
    rsi_direction: rsiDirection,
    divergence,
    rsi_value: curRSI,
  };
}

// ─── 策略四：EMA 假突破 SMC 策略 ────────────────────────────────────────────

export function analyzeEmaFakeout(htfCandles: Candle[], ltfCandles: Candle[]): EmaFakeoutResult {
  if (htfCandles.length < 30 || ltfCandles.length < 30) {
    return { signal: "NEUTRAL", score: 0, ema_direction: "FLAT", ltf_fakeout_detected: false, htf_confirmed: false, fakeout_type: "NONE" };
  }

  const htfCloses = htfCandles.map(c => c.close);
  const ltfCloses = ltfCandles.map(c => c.close);

  // EMA 方向（大週期）
  const htfEma21 = calcEMA(htfCloses, 21);
  const htfN = htfEma21.length;
  const emaSlope = htfEma21[htfN - 1] - htfEma21[htfN - 5];
  const emaDirection: "UP" | "DOWN" | "FLAT" = Math.abs(emaSlope) < htfCloses[htfN - 1] * 0.001 ? "FLAT" : emaSlope > 0 ? "UP" : "DOWN";
  const curEma = htfEma21[htfN - 1];

  // 小週期假突破偵測
  const ltfEma21 = calcEMA(ltfCloses, 21);
  const ltfN = ltfEma21.length;
  const ltfCurClose = ltfCloses[ltfN - 1];
  const ltfPrevClose = ltfCloses[ltfN - 2];
  const ltfCurEma = ltfEma21[ltfN - 1];

  // 假突破向上：小週期 K 棒穿越 EMA 向上，但大週期 EMA 方向向下
  const ltfFakeoutUp = ltfPrevClose < ltfCurEma && ltfCurClose > ltfCurEma && emaDirection === "DOWN";
  // 假突破向下：小週期 K 棒穿越 EMA 向下，但大週期 EMA 方向向上
  const ltfFakeoutDown = ltfPrevClose > ltfCurEma && ltfCurClose < ltfCurEma && emaDirection === "UP";
  const ltfFakeoutDetected = ltfFakeoutUp || ltfFakeoutDown;

  // 大週期確認：最新 K 棒收盤在 EMA 同側（確認假突破）
  const htfCurClose = htfCloses[htfN - 1];
  const htfPrevClose = htfCloses[htfN - 2];
  const htfConfirmedShort = emaDirection === "DOWN" && htfCurClose < curEma && htfPrevClose > curEma; // 假突破向上後回落
  const htfConfirmedLong = emaDirection === "UP" && htfCurClose > curEma && htfPrevClose < curEma;   // 假跌破後回升
  const htfConfirmed = htfConfirmedShort || htfConfirmedLong;

  const fakeoutType: "FAKE_BREAKOUT_UP" | "FAKE_BREAKOUT_DOWN" | "NONE" =
    ltfFakeoutUp ? "FAKE_BREAKOUT_UP" : ltfFakeoutDown ? "FAKE_BREAKOUT_DOWN" : "NONE";

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;

  if (ltfFakeoutDetected && htfConfirmed) {
    if (fakeoutType === "FAKE_BREAKOUT_UP" && emaDirection === "DOWN") {
      signal = "SHORT"; // 假突破向上 → 做空
      score = 80;
    } else if (fakeoutType === "FAKE_BREAKOUT_DOWN" && emaDirection === "UP") {
      signal = "LONG"; // 假跌破向下 → 做多
      score = 80;
    }
  } else if (ltfFakeoutDetected && !htfConfirmed) {
    score = 35; // 等待大週期確認
  } else if (emaDirection !== "FLAT") {
    score = 15;
  }

  return {
    signal,
    score: Math.min(100, score),
    ema_direction: emaDirection,
    ltf_fakeout_detected: ltfFakeoutDetected,
    htf_confirmed: htfConfirmed,
    fakeout_type: fakeoutType,
  };
}

// ─── 策略五：K 線三走勢 + EMA 過濾 ─────────────────────────────────────────

export function analyzeKlineTrend(htfCandles: Candle[], ltfCandles: Candle[]): KlineTrendResult {
  if (htfCandles.length < 30 || ltfCandles.length < 30) {
    return { signal: "NEUTRAL", score: 0, trend_type: "RANGING", ema_direction: "FLAT", reversal_signal: false, reversal_type: "NONE", is_chasing: false };
  }

  const htfCloses = htfCandles.map(c => c.close);
  const ltfCloses = ltfCandles.map(c => c.close);

  // EMA 方向（大週期）
  const htfEma20 = calcEMA(htfCloses, 20);
  const htfN = htfEma20.length;
  const emaSlope = htfEma20[htfN - 1] - htfEma20[htfN - 5];
  const emaSlopeNorm = emaSlope / htfCloses[htfN - 1];
  const emaDirection: "UP" | "DOWN" | "FLAT" = Math.abs(emaSlopeNorm) < 0.002 ? "FLAT" : emaSlope > 0 ? "UP" : "DOWN";

  // 震盪判斷：最近 10 根 K 棒頻繁穿越 EMA
  const curEma = htfEma20[htfN - 1];
  const recentCrosses = htfCloses.slice(-10).filter((c, i, arr) => {
    if (i === 0) return false;
    return (arr[i - 1] > curEma && c < curEma) || (arr[i - 1] < curEma && c > curEma);
  }).length;
  const isRanging = recentCrosses >= 3 || emaDirection === "FLAT";

  // 反轉訊號偵測（K 線形態）
  const htfCurCandle = htfCandles[htfN - 1];
  const htfPrevCandle = htfCandles[htfN - 2];
  const htfATR = calcATR(htfCandles);
  const atr = htfATR[htfN - 1];

  // 看漲反轉：下影線長（空轉多）
  const lowerWick = htfCurCandle.close - htfCurCandle.low;
  const upperWick = htfCurCandle.high - htfCurCandle.close;
  const body = Math.abs(htfCurCandle.close - htfCurCandle.open);
  const bullishReversal = lowerWick > body * 1.5 && lowerWick > atr * 0.3 && htfCurCandle.close > htfCurCandle.open;

  // 看跌反轉：上影線長（多轉空）
  const bearishReversal = upperWick > body * 1.5 && upperWick > atr * 0.3 && htfCurCandle.close < htfCurCandle.open;

  // 吞噬形態
  const bullishEngulfing = htfCurCandle.close > htfPrevCandle.open && htfCurCandle.open < htfPrevCandle.close && htfCurCandle.close > htfCurCandle.open;
  const bearishEngulfing = htfCurCandle.close < htfPrevCandle.open && htfCurCandle.open > htfPrevCandle.close && htfCurCandle.close < htfCurCandle.open;

  const reversalSignal = bullishReversal || bearishReversal || bullishEngulfing || bearishEngulfing;
  const reversalType: "BULLISH" | "BEARISH" | "NONE" =
    (bullishReversal || bullishEngulfing) ? "BULLISH" :
    (bearishReversal || bearishEngulfing) ? "BEARISH" : "NONE";

  // 追單判斷：最近 3 根 K 棒單方向移動超過 2 ATR
  const recentMove = Math.abs(htfCloses[htfN - 1] - htfCloses[htfN - 4]);
  const isChasing = recentMove > atr * 2;

  // 走勢類型
  let trendType: "TRENDING" | "COUNTER_TREND" | "RANGING" = "RANGING";
  if (isRanging) {
    trendType = "RANGING";
  } else if (emaDirection === "UP" && reversalType === "BULLISH") {
    trendType = "TRENDING";
  } else if (emaDirection === "DOWN" && reversalType === "BEARISH") {
    trendType = "TRENDING";
  } else if ((emaDirection === "UP" && reversalType === "BEARISH") ||
             (emaDirection === "DOWN" && reversalType === "BULLISH")) {
    trendType = "COUNTER_TREND";
  }

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;

  if (isRanging) {
    // 震盪行情：不進場
    score = 0;
  } else if (trendType === "COUNTER_TREND") {
    // 逆勢：不進場
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
    // 追單：降低評分
    score = 20;
  }

  return {
    signal,
    score: Math.min(100, score),
    trend_type: trendType,
    ema_direction: emaDirection,
    reversal_signal: reversalSignal,
    reversal_type: reversalType,
    is_chasing: isChasing,
  };
}

// ─── 綜合評分與信號生成 ──────────────────────────────────────────────────────

export function runPandaScan(
  symbol: string,
  htfCandles: Candle[],
  ltfCandles: Candle[]
): PandaSignal {
  const macdMtf = analyzeMACDMtf(htfCandles, ltfCandles);
  const mjIndicator = analyzeMJIndicator(ltfCandles);
  const bollRsi = analyzeBollRsi(htfCandles, ltfCandles);
  const emaFakeout = analyzeEmaFakeout(htfCandles, ltfCandles);
  const klineTrend = analyzeKlineTrend(htfCandles, ltfCandles);

  // 加權評分
  const weights = { macd_mtf: 0.30, mj_indicator: 0.20, boll_rsi: 0.20, ema_fakeout: 0.15, kline_trend: 0.15 };

  // 方向投票
  const signals = [macdMtf.signal, mjIndicator.signal, bollRsi.signal, emaFakeout.signal, klineTrend.signal];
  const longVotes = signals.filter(s => s === "LONG").length;
  const shortVotes = signals.filter(s => s === "SHORT").length;

  let direction: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  if (longVotes >= 3) direction = "LONG";
  else if (shortVotes >= 3) direction = "SHORT";
  else if (longVotes > shortVotes && longVotes >= 2) direction = "LONG";
  else if (shortVotes > longVotes && shortVotes >= 2) direction = "SHORT";

  // 方向一致性加成：只計算與主方向一致的策略分數
  let weightedScore = 0;
  const strategyEntries: [string, { signal: string; score: number }, number][] = [
    ["macd_mtf", macdMtf, weights.macd_mtf],
    ["mj_indicator", mjIndicator, weights.mj_indicator],
    ["boll_rsi", bollRsi, weights.boll_rsi],
    ["ema_fakeout", emaFakeout, weights.ema_fakeout],
    ["kline_trend", klineTrend, weights.kline_trend],
  ];

  for (const [, result, weight] of strategyEntries) {
    if (result.signal === direction) {
      weightedScore += result.score * weight;
    } else if (result.signal === "NEUTRAL") {
      weightedScore += result.score * weight * 0.5;
    }
    // 反向信號不計分
  }

  // 硬性否決條件
  const vetoReasons: string[] = [];
  if (klineTrend.trend_type === "RANGING") {
    vetoReasons.push("震盪盤整：EMA 走平，不進場");
    weightedScore *= 0.3;
  }
  if (klineTrend.trend_type === "COUNTER_TREND") {
    vetoReasons.push("逆勢訊號：K 線反轉方向與趨勢相反");
    weightedScore *= 0.4;
  }
  if (mjIndicator.j_cross_zero && !mjIndicator.macd_bar_sync) {
    vetoReasons.push("MJ 假信號：J 線穿越但 MACD 柱體未同步");
    weightedScore *= 0.7;
  }
  if (klineTrend.is_chasing) {
    vetoReasons.push("追單風險：行情已走出超過 2 ATR");
    weightedScore *= 0.6;
  }
  if (bollRsi.divergence === "BEARISH" && direction === "LONG") {
    vetoReasons.push("頂背離警告：RSI 頂背離，多單風險增加");
    weightedScore *= 0.7;
  }
  if (bollRsi.divergence === "BULLISH" && direction === "SHORT") {
    vetoReasons.push("底背離警告：RSI 底背離，空單風險增加");
    weightedScore *= 0.7;
  }

  const finalScore = Math.round(Math.min(100, weightedScore));

  // 等級判斷
  let grade: "STRONG" | "MODERATE" | "WAIT" | "AVOID" = "AVOID";
  if (direction !== "NEUTRAL") {
    if (finalScore >= 70) grade = "STRONG";
    else if (finalScore >= 55) grade = "MODERATE";
    else if (finalScore >= 40) grade = "WAIT";
    else grade = "AVOID";
  }

  // 計算進出場價位
  const lastCandle = ltfCandles[ltfCandles.length - 1];
  const atrArr = calcATR(ltfCandles);
  const atr = atrArr[atrArr.length - 1];
  const entryPrice = lastCandle.close;

  let stopLoss: number;
  let tp1: number;
  let tp2: number;

  if (direction === "LONG") {
    // 止損：最近 5 根 K 棒最低點 - 0.5 ATR
    const recentLow = Math.min(...ltfCandles.slice(-5).map(c => c.low));
    stopLoss = recentLow - atr * 0.3;
    const risk = entryPrice - stopLoss;
    tp1 = entryPrice + risk * 1.5;
    tp2 = entryPrice + risk * 2.5;
  } else if (direction === "SHORT") {
    // 止損：最近 5 根 K 棒最高點 + 0.5 ATR
    const recentHigh = Math.max(...ltfCandles.slice(-5).map(c => c.high));
    stopLoss = recentHigh + atr * 0.3;
    const risk = stopLoss - entryPrice;
    tp1 = entryPrice - risk * 1.5;
    tp2 = entryPrice - risk * 2.5;
  } else {
    stopLoss = entryPrice - atr * 2;
    tp1 = entryPrice + atr * 1.5;
    tp2 = entryPrice + atr * 2.5;
  }

  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(tp2 - entryPrice);
  const rrRatio = risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0;

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
      kline_trend: klineTrend,
    },
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit_1: tp1,
    take_profit_2: tp2,
    rr_ratio: rrRatio,
    veto_reasons: vetoReasons,
    timestamp: Date.now(),
  };
}

// ─── 回測引擎 ────────────────────────────────────────────────────────────────

export interface BacktestTrade {
  entry_time: number;
  exit_time: number;
  direction: "LONG" | "SHORT";
  entry_price: number;
  exit_price: number;
  stop_loss: number;
  take_profit: number;
  pnl_pct: number;
  result: "WIN" | "LOSS" | "BREAKEVEN";
  score: number;
  grade: "STRONG" | "MODERATE" | "WAIT" | "AVOID";
  exit_reason: "TP1" | "TP2" | "SL" | "TIMEOUT";
}

export interface BacktestResult {
  symbol: string;
  total_trades: number;
  win_trades: number;
  loss_trades: number;
  win_rate: number;
  avg_rr: number;
  total_pnl_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  profit_factor: number;
  by_grade: {
    STRONG: { trades: number; win_rate: number; avg_pnl: number };
    MODERATE: { trades: number; win_rate: number; avg_pnl: number };
    WAIT: { trades: number; win_rate: number; avg_pnl: number };
  };
  trades: BacktestTrade[];
}

export function runPandaBacktest(
  symbol: string,
  htfCandles: Candle[],
  ltfCandles: Candle[],
  minScore = 55
): BacktestResult {
  const trades: BacktestTrade[] = [];
  const windowSize = 50; // 最少需要 50 根 K 棒計算指標
  const maxHoldBars = 20; // 最多持倉 20 根 K 棒

  for (let i = windowSize; i < ltfCandles.length - maxHoldBars; i++) {
    const htfSlice = htfCandles.slice(0, Math.min(i, htfCandles.length));
    const ltfSlice = ltfCandles.slice(0, i);

    if (htfSlice.length < windowSize || ltfSlice.length < windowSize) continue;

    const signal = runPandaScan(symbol, htfSlice, ltfSlice);

    // 只交易達到門檻的信號
    if (signal.score < minScore || signal.direction === "NEUTRAL") continue;
    if (signal.grade === "AVOID") continue;

    const entryCandle = ltfCandles[i];
    const entryPrice = entryCandle.open; // 下一根 K 棒開盤進場
    const stopLoss = signal.stop_loss;
    const tp1 = signal.take_profit_1;
    const tp2 = signal.take_profit_2;

    // 模擬持倉
    let exitPrice = entryPrice;
    let exitReason: "TP1" | "TP2" | "SL" | "TIMEOUT" = "TIMEOUT";
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

    const pnlPct = signal.direction === "LONG"
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - exitPrice) / entryPrice) * 100;

    const result: "WIN" | "LOSS" | "BREAKEVEN" =
      pnlPct > 0.1 ? "WIN" : pnlPct < -0.1 ? "LOSS" : "BREAKEVEN";

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
      exit_reason: exitReason,
    });
  }

  // 計算績效指標
  const wins = trades.filter(t => t.result === "WIN");
  const losses = trades.filter(t => t.result === "LOSS");
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl_pct, 0);
  const avgRR = trades.length > 0
    ? trades.reduce((sum, t) => sum + Math.abs(t.pnl_pct), 0) / trades.length
    : 0;

  // 最大回撤
  let peak = 0, maxDrawdown = 0, cumPnl = 0;
  for (const t of trades) {
    cumPnl += t.pnl_pct;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe Ratio（簡化版）
  const pnlArr = trades.map(t => t.pnl_pct);
  const avgPnl = pnlArr.length > 0 ? pnlArr.reduce((a, b) => a + b, 0) / pnlArr.length : 0;
  const stdPnl = pnlArr.length > 1
    ? Math.sqrt(pnlArr.reduce((sum, v) => sum + Math.pow(v - avgPnl, 2), 0) / pnlArr.length)
    : 1;
  const sharpeRatio = stdPnl > 0 ? avgPnl / stdPnl : 0;

  // Profit Factor
  const grossWin = wins.reduce((sum, t) => sum + t.pnl_pct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl_pct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

  // 按等級分析
  const byGrade = {
    STRONG: calcGradeStats(trades.filter(t => t.grade === "STRONG")),
    MODERATE: calcGradeStats(trades.filter(t => t.grade === "MODERATE")),
    WAIT: calcGradeStats(trades.filter(t => t.grade === "WAIT")),
  };

  return {
    symbol,
    total_trades: trades.length,
    win_trades: wins.length,
    loss_trades: losses.length,
    win_rate: Math.round(winRate * 1000) / 10,
    avg_rr: Math.round(avgRR * 100) / 100,
    total_pnl_pct: Math.round(totalPnl * 100) / 100,
    max_drawdown_pct: Math.round(maxDrawdown * 100) / 100,
    sharpe_ratio: Math.round(sharpeRatio * 100) / 100,
    profit_factor: Math.round(profitFactor * 100) / 100,
    by_grade: byGrade,
    trades: trades.slice(-50), // 只返回最近 50 筆
  };
}

function calcGradeStats(trades: BacktestTrade[]): { trades: number; win_rate: number; avg_pnl: number } {
  if (trades.length === 0) return { trades: 0, win_rate: 0, avg_pnl: 0 };
  const wins = trades.filter(t => t.result === "WIN").length;
  const avgPnl = trades.reduce((sum, t) => sum + t.pnl_pct, 0) / trades.length;
  return {
    trades: trades.length,
    win_rate: Math.round((wins / trades.length) * 1000) / 10,
    avg_pnl: Math.round(avgPnl * 100) / 100,
  };
}

// ─── v5.4 新增策略模組 ─────────────────────────────────────────────────────────

// ─── 策略六：Vegas 雙通道（維加斯隧道）────────────────────────────────────────

export interface VegasTunnelResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  ema12_direction: "UP" | "DOWN" | "FLAT";
  price_vs_short_tunnel: "ABOVE" | "BELOW" | "INSIDE";  // 相對短期通道位置
  price_vs_long_tunnel: "ABOVE" | "BELOW" | "INSIDE";   // 相對長期通道位置
  tunnel_aligned: boolean;   // 短期與長期通道方向一致
  entry_type: "PULLBACK" | "BREAKOUT" | "NONE";
}

export function analyzeVegasTunnel(candles: Candle[]): VegasTunnelResult {
  if (candles.length < 700) {
    return { signal: "NEUTRAL", score: 0, ema12_direction: "FLAT", price_vs_short_tunnel: "INSIDE", price_vs_long_tunnel: "INSIDE", tunnel_aligned: false, entry_type: "NONE" };
  }

  const closes = candles.map(c => c.close);
  const n = closes.length;

  // Vegas 通道：EMA 12（過濾線）、EMA 144/169（短期通道）、EMA 576/676（長期通道）
  const ema12 = calcEMA(closes, 12);
  const ema144 = calcEMA(closes, 144);
  const ema169 = calcEMA(closes, 169);
  const ema576 = calcEMA(closes, 576);
  const ema676 = calcEMA(closes, 676);

  const curClose = closes[n - 1];
  const curEma12 = ema12[n - 1];
  const prevEma12 = ema12[n - 5];

  // EMA12 方向
  const ema12Slope = curEma12 - prevEma12;
  const ema12Direction: "UP" | "DOWN" | "FLAT" = Math.abs(ema12Slope) < curClose * 0.001 ? "FLAT" : ema12Slope > 0 ? "UP" : "DOWN";

  // 短期通道（EMA144/169）
  const shortUpper = Math.max(ema144[n - 1], ema169[n - 1]);
  const shortLower = Math.min(ema144[n - 1], ema169[n - 1]);
  const priceVsShort: "ABOVE" | "BELOW" | "INSIDE" =
    curClose > shortUpper ? "ABOVE" : curClose < shortLower ? "BELOW" : "INSIDE";

  // 長期通道（EMA576/676）
  const longUpper = Math.max(ema576[n - 1], ema676[n - 1]);
  const longLower = Math.min(ema576[n - 1], ema676[n - 1]);
  const priceVsLong: "ABOVE" | "BELOW" | "INSIDE" =
    curClose > longUpper ? "ABOVE" : curClose < longLower ? "BELOW" : "INSIDE";

  // 通道方向一致性：短期通道與長期通道方向相同
  const shortTunnelUp = ema144[n - 1] > ema144[n - 10];
  const longTunnelUp = ema576[n - 1] > ema576[n - 10];
  const tunnelAligned = shortTunnelUp === longTunnelUp;

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;
  let entryType: "PULLBACK" | "BREAKOUT" | "NONE" = "NONE";

  // 做多：長期通道向上，價格回落到短期通道支撐（EMA144/169 附近）後反彈
  if (longTunnelUp && priceVsLong === "ABOVE") {
    if (priceVsShort === "INSIDE" || (priceVsShort === "ABOVE" && curClose < shortUpper * 1.005)) {
      // 回撤到短期通道
      signal = "LONG";
      score = tunnelAligned ? 75 : 55;
      entryType = "PULLBACK";
    } else if (priceVsShort === "ABOVE" && ema12Direction === "UP") {
      // 突破短期通道上軌
      signal = "LONG";
      score = 65;
      entryType = "BREAKOUT";
    }
  }

  // 做空：長期通道向下，價格反彈到短期通道壓力後回落
  if (!longTunnelUp && priceVsLong === "BELOW") {
    if (priceVsShort === "INSIDE" || (priceVsShort === "BELOW" && curClose > shortLower * 0.995)) {
      signal = "SHORT";
      score = tunnelAligned ? 75 : 55;
      entryType = "PULLBACK";
    } else if (priceVsShort === "BELOW" && ema12Direction === "DOWN") {
      signal = "SHORT";
      score = 65;
      entryType = "BREAKOUT";
    }
  }

  // 通道對齊加分
  if (tunnelAligned && signal !== "NEUTRAL") score = Math.min(100, score + 10);

  return {
    signal,
    score: Math.min(100, score),
    ema12_direction: ema12Direction,
    price_vs_short_tunnel: priceVsShort,
    price_vs_long_tunnel: priceVsLong,
    tunnel_aligned: tunnelAligned,
    entry_type: entryType,
  };
}

// ─── 策略七：ATR 動態止損確認 ────────────────────────────────────────────────

export interface AtrDynamicResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  atr_value: number;
  atr_trend: "EXPANDING" | "CONTRACTING" | "STABLE";  // ATR 趨勢
  sl_distance_ok: boolean;   // 止損距離 >= 1 ATR
  breakout_confirmed: boolean;  // 突破時 ATR 放大
  dynamic_sl: number;
  dynamic_tp1: number;
  dynamic_tp2: number;
}

export function analyzeAtrDynamic(candles: Candle[]): AtrDynamicResult {
  if (candles.length < 30) {
    return { signal: "NEUTRAL", score: 0, atr_value: 0, atr_trend: "STABLE", sl_distance_ok: false, breakout_confirmed: false, dynamic_sl: 0, dynamic_tp1: 0, dynamic_tp2: 0 };
  }

  const atrArr = calcATR(candles);
  const n = atrArr.length;
  const curATR = atrArr[n - 1];
  const prevATR5 = atrArr[n - 6];
  const closes = candles.map(c => c.close);
  const curClose = closes[n - 1];

  // ATR 趨勢
  const atrChange = (curATR - prevATR5) / prevATR5;
  const atrTrend: "EXPANDING" | "CONTRACTING" | "STABLE" =
    atrChange > 0.1 ? "EXPANDING" : atrChange < -0.1 ? "CONTRACTING" : "STABLE";

  // 最近支撐/壓力
  const recentHigh = Math.max(...candles.slice(-10).map(c => c.high));
  const recentLow = Math.min(...candles.slice(-10).map(c => c.low));

  // 突破確認：ATR 放大 + 價格突破關鍵位
  const breakoutUp = curClose > recentHigh * 0.998 && atrTrend === "EXPANDING";
  const breakoutDown = curClose < recentLow * 1.002 && atrTrend === "EXPANDING";
  const breakoutConfirmed = breakoutUp || breakoutDown;

  // 止損距離是否足夠（>= 1 ATR）
  const slDistanceLong = curClose - recentLow;
  const slDistanceShort = recentHigh - curClose;
  const slDistanceOk = Math.max(slDistanceLong, slDistanceShort) >= curATR;

  // 動態止損：結構低點/高點 - 1 ATR
  const dynamicSl = breakoutUp ? recentLow - curATR : recentHigh + curATR;
  const risk = Math.abs(curClose - dynamicSl);
  const dynamicTp1 = breakoutUp ? curClose + risk * 1.5 : curClose - risk * 1.5;
  const dynamicTp2 = breakoutUp ? curClose + risk * 2.5 : curClose - risk * 2.5;

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;

  if (breakoutUp && slDistanceOk) {
    signal = "LONG";
    score = 65 + (atrTrend === "EXPANDING" ? 20 : 0);
  } else if (breakoutDown && slDistanceOk) {
    signal = "SHORT";
    score = 65 + (atrTrend === "EXPANDING" ? 20 : 0);
  } else if (atrTrend === "CONTRACTING") {
    // 波動收縮，等待突破
    score = 20;
  }

  return {
    signal,
    score: Math.min(100, score),
    atr_value: Math.round(curATR * 10000) / 10000,
    atr_trend: atrTrend,
    sl_distance_ok: slDistanceOk,
    breakout_confirmed: breakoutConfirmed,
    dynamic_sl: dynamicSl,
    dynamic_tp1: dynamicTp1,
    dynamic_tp2: dynamicTp2,
  };
}

// ─── 策略八：KD 高勝率策略（搭配 EMA20）────────────────────────────────────

export interface KdHighWinResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  k_value: number;
  d_value: number;
  kd_cross: "GOLDEN" | "DEATH" | "NONE";   // KD 黃金/死亡交叉
  ema20_direction: "UP" | "DOWN" | "FLAT";
  kd_in_oversold: boolean;   // KD 在超賣區（<20）
  kd_in_overbought: boolean; // KD 在超買區（>80）
  trend_aligned: boolean;    // KD 方向與 EMA20 趨勢一致
}

export function analyzeKdHighWin(candles: Candle[]): KdHighWinResult {
  if (candles.length < 30) {
    return { signal: "NEUTRAL", score: 0, k_value: 50, d_value: 50, kd_cross: "NONE", ema20_direction: "FLAT", kd_in_oversold: false, kd_in_overbought: false, trend_aligned: false };
  }

  const closes = candles.map(c => c.close);
  const kdj = calcKDJ(candles, 9);
  const ema20 = calcEMA(closes, 20);
  const n = kdj.k.length;

  const curK = kdj.k[n - 1];
  const prevK = kdj.k[n - 2];
  const curD = kdj.d[n - 1];
  const prevD = kdj.d[n - 2];

  // KD 交叉
  const goldenCross = prevK <= prevD && curK > curD;
  const deathCross = prevK >= prevD && curK < curD;
  const kdCross: "GOLDEN" | "DEATH" | "NONE" = goldenCross ? "GOLDEN" : deathCross ? "DEATH" : "NONE";

  // EMA20 方向
  const ema20Slope = ema20[n - 1] - ema20[n - 5];
  const ema20Direction: "UP" | "DOWN" | "FLAT" = Math.abs(ema20Slope) < closes[n - 1] * 0.001 ? "FLAT" : ema20Slope > 0 ? "UP" : "DOWN";

  // 超買超賣
  const kdInOversold = curK < 20 && curD < 20;
  const kdInOverbought = curK > 80 && curD > 80;

  // 趨勢一致性
  const trendAlignedLong = ema20Direction === "UP" && kdCross === "GOLDEN";
  const trendAlignedShort = ema20Direction === "DOWN" && kdCross === "DEATH";
  const trendAligned = trendAlignedLong || trendAlignedShort;

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;

  if (trendAlignedLong) {
    signal = "LONG";
    score = 70;
    if (kdInOversold) score += 20; // 從超賣區黃金交叉，勝率更高
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
    trend_aligned: trendAligned,
  };
}

// ─── 策略九：成交量確認策略 ──────────────────────────────────────────────────

export interface VolumeConfirmResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  volume_trend: "INCREASING" | "DECREASING" | "STABLE";
  volume_ratio: number;       // 當前成交量 / 20 期均量
  breakout_with_volume: boolean;  // 突破時成交量放大
  divergence: "BULLISH" | "BEARISH" | "NONE";  // 量價背離
}

export function analyzeVolumeConfirm(candles: Candle[]): VolumeConfirmResult {
  if (candles.length < 25) {
    return { signal: "NEUTRAL", score: 0, volume_trend: "STABLE", volume_ratio: 1, breakout_with_volume: false, divergence: "NONE" };
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const n = candles.length;

  // 20 期均量
  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const curVol = volumes[n - 1];
  const volumeRatio = avgVol20 > 0 ? curVol / avgVol20 : 1;

  // 成交量趨勢（最近 5 根）
  const recentVols = volumes.slice(-5);
  const volSlope = recentVols[4] - recentVols[0];
  const volumeTrend: "INCREASING" | "DECREASING" | "STABLE" =
    volSlope > avgVol20 * 0.1 ? "INCREASING" : volSlope < -avgVol20 * 0.1 ? "DECREASING" : "STABLE";

  // 突破時成交量放大（>1.5 倍均量）
  const curClose = closes[n - 1];
  const prevClose = closes[n - 2];
  const priceBreakout = Math.abs(curClose - prevClose) / prevClose > 0.005;
  const breakoutWithVolume = priceBreakout && volumeRatio > 1.5;

  // 量價背離
  const recentCloses = closes.slice(-10);
  const recentVolumes = volumes.slice(-10);
  const priceHigher = recentCloses[9] > Math.max(...recentCloses.slice(0, 9));
  const volLower = recentVolumes[9] < Math.min(...recentVolumes.slice(0, 9)) * 1.2;
  const priceLower = recentCloses[9] < Math.min(...recentCloses.slice(0, 9));
  const volHigher = recentVolumes[9] > Math.max(...recentVolumes.slice(0, 9)) * 0.8;

  let divergence: "BULLISH" | "BEARISH" | "NONE" = "NONE";
  if (priceHigher && volLower) divergence = "BEARISH"; // 價漲量縮：頂背離
  if (priceLower && volHigher) divergence = "BULLISH"; // 價跌量增：底背離（可能反轉）

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
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

  // 背離調整
  if (divergence === "BEARISH" && signal === "LONG") score -= 25;
  if (divergence === "BULLISH" && signal === "SHORT") score -= 25;

  return {
    signal,
    score: Math.max(0, Math.min(100, score)),
    volume_trend: volumeTrend,
    volume_ratio: Math.round(volumeRatio * 100) / 100,
    breakout_with_volume: breakoutWithVolume,
    divergence,
  };
}

// ─── 策略十：三角收斂突破策略 ────────────────────────────────────────────────

export interface TriangleBreakoutResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  pattern_detected: boolean;
  convergence_ratio: number;   // 收斂比例（越小越收斂）
  breakout_direction: "UP" | "DOWN" | "NONE";
  trend_direction: "UP" | "DOWN" | "FLAT";  // 大趨勢方向
  volume_confirm: boolean;
}

export function analyzeTriangleBreakout(candles: Candle[]): TriangleBreakoutResult {
  if (candles.length < 30) {
    return { signal: "NEUTRAL", score: 0, pattern_detected: false, convergence_ratio: 1, breakout_direction: "NONE", trend_direction: "FLAT", volume_confirm: false };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const n = candles.length;

  // 大趨勢（EMA50）
  const ema50 = calcEMA(closes, Math.min(50, n - 1));
  const ema50Slope = ema50[n - 1] - ema50[Math.max(0, n - 10)];
  const trendDirection: "UP" | "DOWN" | "FLAT" = Math.abs(ema50Slope) < closes[n - 1] * 0.005 ? "FLAT" : ema50Slope > 0 ? "UP" : "DOWN";

  // 最近 20 根 K 棒的高低點收斂分析
  const lookback = Math.min(20, n - 1);
  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);

  // 計算高點趨勢（下降）和低點趨勢（上升）→ 三角收斂
  const highStart = recentHighs[0];
  const highEnd = recentHighs[lookback - 1];
  const lowStart = recentLows[0];
  const lowEnd = recentLows[lookback - 1];

  // 收斂：高點下降 + 低點上升
  const highsDecreasing = highEnd < highStart;
  const lowsIncreasing = lowEnd > lowStart;
  const patternDetected = highsDecreasing && lowsIncreasing;

  // 收斂比例
  const rangeStart = highStart - lowStart;
  const rangeEnd = highEnd - lowEnd;
  const convergenceRatio = rangeStart > 0 ? rangeEnd / rangeStart : 1;

  // 突破方向
  const curClose = closes[n - 1];
  const breakoutUp = curClose > highEnd * 1.002;
  const breakoutDown = curClose < lowEnd * 0.998;
  const breakoutDirection: "UP" | "DOWN" | "NONE" = breakoutUp ? "UP" : breakoutDown ? "DOWN" : "NONE";

  // 成交量確認
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeConfirm = volumes[n - 1] > avgVol * 1.3;

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;

  if (patternDetected && convergenceRatio < 0.7) {
    if (breakoutDirection === "UP" && trendDirection !== "DOWN") {
      signal = "LONG";
      score = 65 + (volumeConfirm ? 20 : 0) + (trendDirection === "UP" ? 10 : 0);
    } else if (breakoutDirection === "DOWN" && trendDirection !== "UP") {
      signal = "SHORT";
      score = 65 + (volumeConfirm ? 20 : 0) + (trendDirection === "DOWN" ? 10 : 0);
    } else if (breakoutDirection === "NONE") {
      // 等待突破
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
    volume_confirm: volumeConfirm,
  };
}

// ─── 策略十一：MACD 背離高勝率策略 ──────────────────────────────────────────

export interface MacdDivergenceResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  divergence_type: "BULLISH" | "BEARISH" | "NONE";
  htf_trend: "UP" | "DOWN" | "FLAT";
  rr_ratio_ok: boolean;   // 盈虧比 >= 2
  macd_overlap: boolean;  // MACD 柱體與均線重疊（進場確認）
}

export function analyzeMacdDivergence(htfCandles: Candle[], ltfCandles: Candle[]): MacdDivergenceResult {
  if (htfCandles.length < 50 || ltfCandles.length < 50) {
    return { signal: "NEUTRAL", score: 0, divergence_type: "NONE", htf_trend: "FLAT", rr_ratio_ok: false, macd_overlap: false };
  }

  const htfCloses = htfCandles.map(c => c.close);
  const ltfCloses = ltfCandles.map(c => c.close);

  // 大週期趨勢（EMA20）
  const htfEma20 = calcEMA(htfCloses, 20);
  const htfN = htfEma20.length;
  const htfSlope = htfEma20[htfN - 1] - htfEma20[htfN - 5];
  const htfTrend: "UP" | "DOWN" | "FLAT" = Math.abs(htfSlope) < htfCloses[htfN - 1] * 0.001 ? "FLAT" : htfSlope > 0 ? "UP" : "DOWN";

  // 小週期 MACD 背離（4H 圖）
  const ltfMACD = calcMACD(ltfCloses);
  const ltfN = ltfMACD.dif.length;

  // 尋找最近 20 根 K 棒的背離
  const lookback = Math.min(20, ltfN - 1);
  const recentCloses = ltfCloses.slice(-lookback);
  const recentDif = ltfMACD.dif.slice(-lookback);

  // 底背離：價格新低但 MACD DIF 未新低
  const priceNewLow = recentCloses[lookback - 1] < Math.min(...recentCloses.slice(0, -1));
  const difNotNewLow = recentDif[lookback - 1] > Math.min(...recentDif.slice(0, -1));
  const bullishDivergence = priceNewLow && difNotNewLow;

  // 頂背離：價格新高但 MACD DIF 未新高
  const priceNewHigh = recentCloses[lookback - 1] > Math.max(...recentCloses.slice(0, -1));
  const difNotNewHigh = recentDif[lookback - 1] < Math.max(...recentDif.slice(0, -1));
  const bearishDivergence = priceNewHigh && difNotNewHigh;

  const divergenceType: "BULLISH" | "BEARISH" | "NONE" =
    bullishDivergence ? "BULLISH" : bearishDivergence ? "BEARISH" : "NONE";

  // MACD 柱體重疊確認（柱體從分離回到均線附近）
  const curHist = ltfMACD.histogram[ltfN - 1];
  const prevHist = ltfMACD.histogram[ltfN - 2];
  const macdOverlapLong = bullishDivergence && curHist > prevHist && curHist < 0; // 柱體向上收縮
  const macdOverlapShort = bearishDivergence && curHist < prevHist && curHist > 0; // 柱體向下收縮
  const macdOverlap = macdOverlapLong || macdOverlapShort;

  // 盈虧比估算
  const atrArr = calcATR(ltfCandles);
  const curATR = atrArr[ltfN - 1];
  const curClose = ltfCloses[ltfN - 1];
  const recentLow = Math.min(...ltfCandles.slice(-5).map(c => c.low));
  const recentHigh = Math.max(...ltfCandles.slice(-5).map(c => c.high));
  const slLong = recentLow - curATR;
  const slShort = recentHigh + curATR;
  const riskLong = curClose - slLong;
  const riskShort = slShort - curClose;
  const rrRatioOk = bullishDivergence
    ? (curATR * 2 / riskLong >= 2)
    : bearishDivergence
    ? (curATR * 2 / riskShort >= 2)
    : false;

  let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 0;

  if (bullishDivergence && htfTrend === "UP" && macdOverlap) {
    signal = "LONG";
    score = 80 + (rrRatioOk ? 15 : 0);
  } else if (bearishDivergence && htfTrend === "DOWN" && macdOverlap) {
    signal = "SHORT";
    score = 80 + (rrRatioOk ? 15 : 0);
  } else if (divergenceType !== "NONE" && !macdOverlap) {
    // 背離出現但等待確認
    score = 40;
  }

  return {
    signal,
    score: Math.min(100, score),
    divergence_type: divergenceType,
    htf_trend: htfTrend,
    rr_ratio_ok: rrRatioOk,
    macd_overlap: macdOverlap,
  };
}

// ─── v5.4 擴展版 runPandaScan（整合 11 種策略）──────────────────────────────

export interface PandaSignalV54 extends PandaSignal {
  strategies_v54: {
    vegas_tunnel: VegasTunnelResult;
    atr_dynamic: AtrDynamicResult;
    kd_high_win: KdHighWinResult;
    volume_confirm: VolumeConfirmResult;
    triangle_breakout: TriangleBreakoutResult;
    macd_divergence: MacdDivergenceResult;
  };
  score_v54: number;  // v5.4 綜合評分（11 種策略）
  grade_v54: "STRONG" | "MODERATE" | "WAIT" | "AVOID";
}

export function runPandaScanV54(
  symbol: string,
  htfCandles: Candle[],
  ltfCandles: Candle[]
): PandaSignalV54 {
  // 先執行原有 5 種策略
  const baseSignal = runPandaScan(symbol, htfCandles, ltfCandles);

  // 執行 6 種新策略
  const vegasTunnel = analyzeVegasTunnel(htfCandles);
  const atrDynamic = analyzeAtrDynamic(ltfCandles);
  const kdHighWin = analyzeKdHighWin(ltfCandles);
  const volumeConfirm = analyzeVolumeConfirm(ltfCandles);
  const triangleBreakout = analyzeTriangleBreakout(ltfCandles);
  const macdDivergence = analyzeMacdDivergence(htfCandles, ltfCandles);

  // 新策略加權評分
  const newWeights = {
    vegas_tunnel: 0.20,
    atr_dynamic: 0.15,
    kd_high_win: 0.20,
    volume_confirm: 0.15,
    triangle_breakout: 0.15,
    macd_divergence: 0.15,
  };

  const newStrategies = [
    { result: vegasTunnel, weight: newWeights.vegas_tunnel },
    { result: atrDynamic, weight: newWeights.atr_dynamic },
    { result: kdHighWin, weight: newWeights.kd_high_win },
    { result: volumeConfirm, weight: newWeights.volume_confirm },
    { result: triangleBreakout, weight: newWeights.triangle_breakout },
    { result: macdDivergence, weight: newWeights.macd_divergence },
  ];

  // 方向投票（新策略）
  const newLongVotes = newStrategies.filter(s => s.result.signal === "LONG").length;
  const newShortVotes = newStrategies.filter(s => s.result.signal === "SHORT").length;

  let newWeightedScore = 0;
  const direction = baseSignal.direction;

  for (const { result, weight } of newStrategies) {
    if (result.signal === direction) {
      newWeightedScore += result.score * weight;
    } else if (result.signal === "NEUTRAL") {
      newWeightedScore += result.score * weight * 0.5;
    }
  }

  // 綜合 v5.3 和 v5.4 評分（各佔 50%）
  const combinedScore = Math.round((baseSignal.score * 0.5 + newWeightedScore * 0.5));

  // ATR 動態止損優化
  const lastCandle = ltfCandles[ltfCandles.length - 1];
  const atrArr = calcATR(ltfCandles);
  const atr = atrArr[atrArr.length - 1];
  const entryPrice = lastCandle.close;

  let stopLoss = baseSignal.stop_loss;
  let tp1 = baseSignal.take_profit_1;
  let tp2 = baseSignal.take_profit_2;

  // 使用 ATR 動態止損（如果計算有效）
  if (atrDynamic.dynamic_sl > 0) {
    if (direction === "LONG" && atrDynamic.dynamic_sl < entryPrice) {
      stopLoss = atrDynamic.dynamic_sl;
      const risk = entryPrice - stopLoss;
      tp1 = entryPrice + risk * 1.5;
      tp2 = entryPrice + risk * 2.5;
    } else if (direction === "SHORT" && atrDynamic.dynamic_sl > entryPrice) {
      stopLoss = atrDynamic.dynamic_sl;
      const risk = stopLoss - entryPrice;
      tp1 = entryPrice - risk * 1.5;
      tp2 = entryPrice - risk * 2.5;
    }
  }

  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(tp2 - entryPrice);
  const rrRatio = risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0;

  // v5.4 等級
  let gradeV54: "STRONG" | "MODERATE" | "WAIT" | "AVOID" = "AVOID";
  if (direction !== "NEUTRAL") {
    if (combinedScore >= 70) gradeV54 = "STRONG";
    else if (combinedScore >= 55) gradeV54 = "MODERATE";
    else if (combinedScore >= 40) gradeV54 = "WAIT";
  }

  // 額外否決條件
  const vetoReasons = [...baseSignal.veto_reasons];
  if (volumeConfirm.divergence === "BEARISH" && direction === "LONG") {
    vetoReasons.push("量價背離警告：價漲量縮，多單謹慎");
  }
  if (triangleBreakout.pattern_detected && triangleBreakout.breakout_direction === "NONE") {
    vetoReasons.push("三角收斂中：等待突破方向確認");
  }
  if (atrDynamic.atr_trend === "CONTRACTING") {
    vetoReasons.push("ATR 收縮：波動率降低，等待放大");
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
      macd_divergence: macdDivergence,
    },
    score_v54: combinedScore,
    grade_v54: gradeV54,
  };
}
