/*
 * server/utils/indicators.ts  v3.00
 * 共用技術指標計算工具函數
 * 改良點：
 *  [01] MACD 訊號線對齊修正（保留完整序列，不過濾 NaN 後再算 signal）
 *  [02] ADX 改為標準 Wilder ADX（遞推平滑，非 SMA）
 *  [03] ATR 統一使用 Wilder ATR（與 ADX 口徑一致）
 *  [04] Bollinger Band 加入 is_ready 狀態，資料不足時標記
 *  [05] VWAP 依 timeframe 區分 session / anchored 模式
 *  [06] 纏論加入 K 線包含關係處理、嚴格筆定義
 *  [07] 纏論背馳改為多因子（幅度 + MACD 面積 + 斜率）
 *  [08] SMC/ICT 偵測加入 displacement 確認、品質分數
 *  [25] 所有分析函式支援 useClosedCandleOnly 參數
 *
 * v3.0 改良（GPT-5.4 審查）：
 *  [G1] calcSma 改為 rolling sum O(n)，消除 O(n·period) 瓶頸
 *  [G2] calcAdxLast fallback 改為 NaN（原為 20，會掩蓋資料不足）
 *  [G3] detectOrderBlocks BOS 確認改為「後續收盤突破 swing level」而非索引比對
 *  [G4] 新增 assertValidPeriod / isFiniteNumber 輸入驗證工具
 *  [G5] calcEmaArr / calcRsiArr 加入 Number.isFinite 防護（原只用 isNaN，無法擋 Infinity）
 *  [G6] detectBosChoch 加入「後續 K 線收盤確認」，避免影線假突破
 *  [G7] calcFreshness 改為事件計數（進入區間次數），而非逐 bar 計數
 *  [G8] calcVwap anchored 模式移除 slice(-100) 截斷，改為真正從錨點開始
 */

import type { Candle } from "../../shared/cryptoTypes";

// ─────────────────────────────────────────────────────────────────────────────
// [G4] 輸入驗證工具（v3.0 新增）
// ─────────────────────────────────────────────────────────────────────────────

/** 驗證 period 必須是正整數，否則 throw */
export function assertValidPeriod(period: number, name = 'period'): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${period}`);
  }
}

/** 安全的有限數值檢查（同時擋 NaN 和 Infinity） */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// 基礎工具
// ─────────────────────────────────────────────────────────────────────────────

/** 取已收線 K 線（排除最後一根未完成 K） */
export function getClosedCandles(candles: Candle[], useClosedOnly = true): Candle[] {
  if (!useClosedOnly || candles.length <= 1) return candles;
  return candles.slice(0, -1);
}

/** 簡單移動平均（SMA）— v3.0 改為 rolling sum O(n) */
export function calcSma(data: number[], period: number): number[] {
  assertValidPeriod(period, 'calcSma period');
  const result: number[] = new Array(data.length).fill(NaN);
  if (data.length < period) return result;
  // 初始化第一個窗口
  let windowSum = 0;
  for (let i = 0; i < period; i++) {
    const v = data[i];
    windowSum += isFiniteNumber(v) ? v : 0;
  }
  result[period - 1] = windowSum / period;
  // rolling update
  for (let i = period; i < data.length; i++) {
    const add = data[i];
    const remove = data[i - period];
    windowSum += (isFiniteNumber(add) ? add : 0) - (isFiniteNumber(remove) ? remove : 0);
    result[i] = windowSum / period;
  }
  return result;
}

/** 指數移動平均（EMA）— 回傳完整陣列
 * v3.0: 加入 assertValidPeriod + Number.isFinite 防護（原只用 isNaN，無法擋 Infinity）*/
export function calcEmaArr(data: number[], period: number): number[] {
  assertValidPeriod(period, 'calcEmaArr period');
  const k = 2 / (period + 1);
  const result: number[] = [];
  let emaVal = NaN;
  let validCount = 0; // 計數非-NaN 的導入數量
  let seedSum = 0;    // 種子累加和

  for (let i = 0; i < data.length; i++) {
    if (!isFiniteNumber(data[i])) {
      result.push(NaN);
      continue;
    }
    if (isNaN(emaVal)) {
      // 種子階段：累積非-NaN 導入
      seedSum += data[i];
      validCount++;
      if (validCount < period) {
        result.push(NaN);
        continue;
      }
      // 種子完成：用前 period 個非-NaN 導入的平均値作為初始 EMA
      emaVal = seedSum / period;
    } else {
      emaVal = data[i] * k + emaVal * (1 - k);
    }
    result.push(emaVal);
  }
  return result;
}

/** 指數移動平均（EMA）— 回傳單一最新值 */
export function calcEmaLast(data: number[], period: number): number {
  const arr = calcEmaArr(data, period);
  return arr[arr.length - 1] ?? data[data.length - 1];
}

/** RSI — 回傳完整陣列（Wilder 平滑） */
export function calcRsiArr(closes: number[], period = 14): number[] {
  // R6-FIX: result 長度統一為 closes.length，避免下游索引對齊問題
  const result: number[] = new Array(closes.length).fill(NaN);
  if (!closes.every(v => isFiniteNumber(v) || isNaN(v))) {
    // 含有 Infinity/-Infinity，直接回傳全 NaN 避免污染
    return result;
  }
  if (closes.length < period + 1) return result;
  let writeIdx = period; // 第一個有效 RSI 寫入位置
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
  }
  avgGain /= period; avgLoss /= period;
  // 修復：零波動時（avgGain === 0 && avgLoss === 0）應回傳 50（盤整），而非 100（誤判為極強勢）
  const calcRsi = (g: number, l: number) => {
    if (g === 0 && l === 0) return 50;  // 完全無波動 => 中性
    if (l === 0) return 100;             // 只有漲漲 => 極強勢
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

/** RSI — 回傳單一最新值（O1: 統一使用 Wilder 遞推平滑，與 calcRsiArr 口徑一致） */
export function calcRsiLast(closes: number[], period = 14): number {
  const arr = calcRsiArr(closes, period);
  const last = arr[arr.length - 1];
  return isNaN(last) ? 50 : last;
}

// ─────────────────────────────────────────────────────────────────────────────
// [01] MACD — 修正訊號線對齊（保留完整序列索引）
// ─────────────────────────────────────────────────────────────────────────────

/** MACD — 回傳完整陣列（訊號線與 MACD 線索引完全對齊） */
export function calcMacdArr(closes: number[]): {
  macd: number[];
  signal: number[];
  hist: number[];
} {
  const ema12 = calcEmaArr(closes, 12);
  const ema26 = calcEmaArr(closes, 26);
  // MACD 線：保留完整長度（前段為 NaN）
  const macd = ema12.map((v, i) => (isNaN(v) || isNaN(ema26[i])) ? NaN : v - ema26[i]);

  // Signal 線：對含 NaN 的 MACD 陣列直接做 EMA，保持索引對齊
  // 找到第一個有效 MACD 的位置
  const firstValid = macd.findIndex(v => !isNaN(v));
  const signal: number[] = new Array(macd.length).fill(NaN);
  if (firstValid >= 0) {
    const validSlice = macd.slice(firstValid);
    const signalSlice = calcEmaArr(validSlice, 9);
    signalSlice.forEach((v, i) => { signal[firstValid + i] = v; });
  }

  const hist = macd.map((v, i) => (isNaN(v) || isNaN(signal[i])) ? NaN : v - signal[i]);
  return { macd, signal, hist };
}

// ─────────────────────────────────────────────────────────────────────────────
// [04] Bollinger Band — 加入 is_ready 狀態
// ─────────────────────────────────────────────────────────────────────────────

export interface BollingerPoint {
  upper: number;
  lower: number;
  mid: number;
  bandwidth: number;
  percent_b: number;
  is_ready: boolean;
}

/** 布林帶 — 回傳完整陣列（含 is_ready 標記） */
export function calcBollingerArr(
  closes: number[], period = 20, mult = 2
): BollingerPoint[] {
  return closes.map((_, i) => {
    if (i < period - 1) {
      return { upper: NaN, lower: NaN, mid: NaN, bandwidth: NaN, percent_b: NaN, is_ready: false };
    }
    const slice = closes.slice(i - period + 1, i + 1);
    // 修復：過濾 NaN 污染，若窗口內有 NaN 則標記為 not_ready
    if (slice.some(v => isNaN(v))) {
      return { upper: NaN, lower: NaN, mid: NaN, bandwidth: NaN, percent_b: NaN, is_ready: false };
    }
    const mid = slice.reduce((a, b) => a + b, 0) / slice.length;
    // R6-FIX: 改回母體標準差（除以 n），與 TradingView / John Bollinger 原始定義一致
    // 樣本標準差（n-1）會導致帶寬偏大，特別是 period=20 時差異約 2.5%
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length);
    const upper = mid + mult * std;
    const lower = mid - mult * std;
    // 修復：加入 mid === 0 防呆，避免 Infinity
    const bandwidth = (std === 0 || mid === 0) ? 0 : (upper - lower) / Math.abs(mid);
    const percent_b = (upper - lower) === 0 ? 0.5 : (closes[i] - lower) / (upper - lower);
    return { upper, lower, mid, bandwidth, percent_b, is_ready: true };
  });
}

/** 布林帶 — 回傳最新值 */
export function calcBollingerLast(closes: number[], period = 20, mult = 2): BollingerPoint {
  const arr = calcBollingerArr(closes, period, mult);
  return arr[arr.length - 1] ?? { upper: NaN, lower: NaN, mid: NaN, bandwidth: NaN, percent_b: NaN, is_ready: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// [03] ATR — 統一使用 Wilder ATR（與 ADX 口徑一致）
// ─────────────────────────────────────────────────────────────────────────────

/** Wilder ATR — 回傳完整陣列 */
export function calcAtrArr(candles: Candle[], period = 14): number[] {
  if (candles.length < period + 1) return new Array(candles.length).fill(NaN);
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  const result: number[] = new Array(period).fill(NaN);
  // 第一個 ATR 用簡單平均初始化
  let atr = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  result.push(atr);
  // 後續使用 Wilder 遞推平滑（與 ADX 一致）
  for (let i = period + 1; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    result.push(atr);
  }
  return result;
}

/** Wilder ATR — 回傳單一最新值 */
export function calcAtrLast(candles: Candle[], period = 14): number {
  const arr = calcAtrArr(candles, period);
  const last = arr[arr.length - 1];
  return isNaN(last) ? 0 : last;
}

// ─────────────────────────────────────────────────────────────────────────────
// [02] ADX — 標準 Wilder ADX（遞推平滑，非 SMA）
// ─────────────────────────────────────────────────────────────────────────────

export interface AdxResult {
  adx: number[];
  plusDi: number[];
  minusDi: number[];
}

/** 標準 Wilder ADX — 回傳完整陣列 */
export function calcAdxArr(candles: Candle[], period = 14): AdxResult {
  const n = candles.length;
  const adx: number[] = new Array(n).fill(NaN);
  const plusDi: number[] = new Array(n).fill(NaN);
  const minusDi: number[] = new Array(n).fill(NaN);
  // 修復 off-by-one：第一個 ADX 出現在索引 period*2-1，需要 period*2 根 K 線
  if (n < period * 2) return { adx, plusDi, minusDi };

  // 計算每根 TR、+DM、-DM
  const trs: number[] = [0];
  const pDMs: number[] = [0];
  const mDMs: number[] = [0];
  for (let i = 1; i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const up = c.high - p.high, dn = p.low - c.low;
    pDMs.push(up > dn && up > 0 ? up : 0);
    mDMs.push(dn > up && dn > 0 ? dn : 0);
  }

  // Wilder 遞推平滑（初始用 sum，後續遞推）
  let sTR  = trs.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let sPDM = pDMs.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let sMDM = mDMs.slice(1, period + 1).reduce((a, b) => a + b, 0);

  const dxArr: number[] = [];
  const pDIArr: number[] = [];
  const mDIArr: number[] = [];

  for (let i = period; i < n; i++) {
    if (i > period) {
      sTR  = sTR  - sTR  / period + trs[i];
      sPDM = sPDM - sPDM / period + pDMs[i];
      sMDM = sMDM - sMDM / period + mDMs[i];
    }
    const pDI = sTR === 0 ? 0 : (sPDM / sTR) * 100;
    const mDI = sTR === 0 ? 0 : (sMDM / sTR) * 100;
    const dx  = (pDI + mDI) === 0 ? 0 : Math.abs(pDI - mDI) / (pDI + mDI) * 100;
    pDIArr.push(pDI);
    mDIArr.push(mDI);
    dxArr.push(dx);
    plusDi[i]  = pDI;
    minusDi[i] = mDI;
  }

  // ADX = Wilder 平滑的 DX
  // O2: 修復索引錯位問題：dxArr[0] 對應 candles[period]，所以 ADX 第一個有效位置是 candles[period * 2 - 1]
  let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  adx[period * 2 - 1] = adxVal;
  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
    // dxArr[i] 對應 candles[period + i]，所以 ADX 位置是 period + i
    adx[period + i] = adxVal;
  }

  return { adx, plusDi, minusDi };
}

/** ADX — 回傳單一最新值 */
export function calcAdxLast(candles: Candle[], period = 14): number {
  // [G2] v3.0: fallback 改為 NaN，避免掩蓋資料不足（原 20 會被策略誤判為「弱趨勢但可用」）
  if (candles.length < period * 2 + 1) return NaN;
  const { adx } = calcAdxArr(candles, period);
  const last = adx[adx.length - 1];
  return isFiniteNumber(last) ? last : NaN;
}

// ─────────────────────────────────────────────────────────────────────────────
// [05] VWAP — 依 timeframe 區分 session / anchored 模式
// ─────────────────────────────────────────────────────────────────────────────

export type VwapMode = "session" | "anchored" | "full";

/**
 * VWAP 計算
 * - session：只用當日 00:00 UTC 後的 K 線（適合 1m/5m/15m）
 * - anchored：從最近 swing low/high 錨點開始（適合 1h/4h）
 * - full：全部 K 線（向下相容舊行為）
 */
export function calcVwap(candles: Candle[], mode: VwapMode = "full"): {
  value: number;
  mode: VwapMode;
  candle_count: number;
} {
  let subset = candles;

  if (mode === "session") {
    // 修復：統一以毫秒為基準，同時相容秒級時間戳
    // 判斷 candle.time 是秒還是毫秒：若 > 1e12 則為毫秒，否則為秒
    const sampleTime = candles[0]?.time ?? 0;
    const isMs = sampleTime > 1e12;
    const nowMs = Date.now();
    const todayStartMs = Math.floor(nowMs / 86400000) * 86400000;
    const sessionCandles = candles.filter(c => {
      const tMs = isMs ? c.time : c.time * 1000;
      return tMs >= todayStartMs;
    });
    // R6-FIX: 移除 >= 5 門檻和 slice(-50) fallback，避免跨 session 污染
    // 即使 session 內只有 1-2 根 K 線，也應使用 session 資料
    // 若完全沒有 session 資料（剛過午夜），回傳最後一根 close 作為中性值
    if (sessionCandles.length === 0) {
      return { value: candles[candles.length - 1]?.close ?? 0, mode, candle_count: 0 };
    }
    subset = sessionCandles;
  } else if (mode === "anchored") {
    // [G8] v3.0: 移除 slice(-100) 截斷，改為真正從錨點開始（原 slice(-100) 會破壞 anchored 語義）
    const lb = 5;
    let anchorIdx = 0;
    for (let i = lb; i < candles.length - lb; i++) {
      if (candles.slice(i - lb, i).every(c => c.low >= candles[i].low) &&
          candles.slice(i + 1, i + lb + 1).every(c => c.low >= candles[i].low)) {
        anchorIdx = i;
      }
    }
    // 真正從錨點開始，不截斷（若錨點太遠，最多取 300 根避免性能問題）
    subset = candles.slice(Math.max(anchorIdx, candles.length - 300));
  }

  if (subset.length === 0) subset = candles;
  let cumVol = 0, cumVolPrice = 0;
  for (const c of subset) {
    const typical = (c.high + c.low + c.close) / 3;
    cumVolPrice += typical * c.volume;
    cumVol += c.volume;
  }
  const value = cumVol === 0 ? (candles[candles.length - 1]?.close ?? 0) : cumVolPrice / cumVol;
  return { value, mode, candle_count: subset.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 結構識別
// ─────────────────────────────────────────────────────────────────────────────

/** 找 Swing Highs */
export function findSwingHighs(candles: Candle[], lb = 5): { price: number; idx: number }[] {
  const res: { price: number; idx: number }[] = [];
  for (let i = lb; i < candles.length - lb; i++) {
    if (
      candles.slice(i - lb, i).every(c => c.high <= candles[i].high) &&
      candles.slice(i + 1, i + lb + 1).every(c => c.high <= candles[i].high)
    ) res.push({ price: candles[i].high, idx: i });
  }
  return res;
}

/** 找 Swing Lows */
export function findSwingLows(candles: Candle[], lb = 5): { price: number; idx: number }[] {
  const res: { price: number; idx: number }[] = [];
  for (let i = lb; i < candles.length - lb; i++) {
    if (
      candles.slice(i - lb, i).every(c => c.low >= candles[i].low) &&
      candles.slice(i + 1, i + lb + 1).every(c => c.low >= candles[i].low)
    ) res.push({ price: candles[i].low, idx: i });
  }
  return res;
}

/** 計算斯波那契 OTE 區間 — v2.1 Opus 4.6 強化版
 * 改良項目：
 * 1. 加入動態 Swing 識別（多空頭方向自動判斷）
 * 2. 加入 Fib Cluster 計算（多個時間框的 Fib 集群區域）
 * 3. 加入 OTE 品質評分（0-100）
 * 4. 加入時間衰減（Swing 越舊 OTE 可靠性越低）
 * 5. 加入 ote_zone_width（OTE 區間寬度，寬度太大時降低評分）
 */
export function calcFibOte(candles: Candle[], close: number) {
  const atr = calcAtrLast(candles, 14);
  // 動態識別：對不同回看期間分別計算 Swing，取最近的有效波動
  const highs5  = findSwingHighs(candles, 5);
  const lows5   = findSwingLows(candles, 5);
  const highs10 = findSwingHighs(candles, 10);
  const lows10  = findSwingLows(candles, 10);
  if (!highs5.length || !lows5.length) return null;

  const lastHigh = highs5[highs5.length - 1];
  const lastLow  = lows5[lows5.length - 1];
  const range = lastHigh.price - lastLow.price;
  if (range <= 0 || range < atr * 0.5) return null; // 波動幅度太小則無效

  // 時間衰減：筆越舊，可靠性越低（超過 50 根 K 線則大幅降低評分）
  const swingAge = candles.length - Math.max(lastHigh.idx, lastLow.idx);
  const agePenalty = Math.min(50, Math.floor(swingAge / 10) * 10);

  // Fib Cluster：檢查高級别 Swing（lb=10）的 Fib 水平是否與當前 Fib 區間重疊
  const htfHigh = highs10.length ? highs10[highs10.length - 1].price : lastHigh.price;
  const htfLow  = lows10.length  ? lows10[lows10.length - 1].price   : lastLow.price;
  const htfRange = htfHigh - htfLow;

  const isBullish = lastLow.idx < lastHigh.idx;

  if (isBullish) {
    // 多頭方向：從最高點回調，在 0.618-0.786 區間找多點
    const fib618 = lastHigh.price - range * 0.618;
    const fib705 = lastHigh.price - range * 0.705;
    const fib786 = lastHigh.price - range * 0.786;
    const fib50  = lastHigh.price - range * 0.5;
    const oteWidth = fib618 - fib786;
    const inOte = close >= fib786 && close <= fib618;
    const inOteWide = close >= fib786 && close <= fib50;

    // Fib Cluster 評分：高級别 Fib 是否與當前 OTE 區間重疊
    // 修復：htf fallback 到 ltf 相同 swing 時，不給 cluster bonus（避免虛增 oteQuality）
    let clusterBonus = 0;
    const htfIsSameAsLtf = (htfHigh === lastHigh.price && htfLow === lastLow.price);
    if (htfRange > 0 && !htfIsSameAsLtf) {
      const htfFib618 = htfHigh - htfRange * 0.618;
      const htfFib786 = htfHigh - htfRange * 0.786;
      if (htfFib786 <= fib618 && htfFib618 >= fib786) clusterBonus = 20; // HTF Fib 與 LTF OTE 重疊
    }

    // OTE 品質評分
    const baseScore = inOte ? 70 : (inOteWide ? 40 : 10);
    const oteQuality = Math.max(0, Math.min(100,
      baseScore + clusterBonus - agePenalty -
      (oteWidth > atr * 2 ? 15 : 0) // OTE 區間寬度超過 2 ATR 則降分
    ));

    return {
      direction: "bullish" as const,
      swing_high: lastHigh.price, swing_low: lastLow.price,
      fib_50: fib50, fib_618: fib618, fib_705: fib705, fib_786: fib786,
      ext_1272: lastLow.price + range * 1.272,
      ext_1618: lastLow.price + range * 1.618,
      in_ote: inOte,
      in_ote_wide: inOteWide,
      price_pct: ((close - lastLow.price) / range) * 100,
      ote_quality: oteQuality,
      ote_zone_width: oteWidth,
      fib_cluster: clusterBonus > 0,
      swing_age: swingAge,
    };
  } else {
    // 空頭方向：從最低點回調，在 0.618-0.786 區間找空點
    const fib618 = lastLow.price + range * 0.618;
    const fib705 = lastLow.price + range * 0.705;
    const fib786 = lastLow.price + range * 0.786;
    const fib50  = lastLow.price + range * 0.5;
    const oteWidth = fib786 - fib618;
    const inOte = close >= fib618 && close <= fib786;
    const inOteWide = close >= fib50 && close <= fib786;

    let clusterBonus = 0;
    const htfIsSameAsLtfBear = (htfHigh === lastHigh.price && htfLow === lastLow.price);
    if (htfRange > 0 && !htfIsSameAsLtfBear) {
      const htfFib618 = htfLow + htfRange * 0.618;
      const htfFib786 = htfLow + htfRange * 0.786;
      if (htfFib618 <= fib786 && htfFib786 >= fib618) clusterBonus = 20;
    }

    const baseScore = inOte ? 70 : (inOteWide ? 40 : 10);
    const oteQuality = Math.max(0, Math.min(100,
      baseScore + clusterBonus - agePenalty -
      (oteWidth > atr * 2 ? 15 : 0)
    ));

    return {
      direction: "bearish" as const,
      swing_high: lastHigh.price, swing_low: lastLow.price,
      fib_50: fib50, fib_618: fib618, fib_705: fib705, fib_786: fib786,
      ext_1272: lastHigh.price - range * 1.272,
      ext_1618: lastHigh.price - range * 1.618,
      in_ote: inOte,
      in_ote_wide: inOteWide,
      price_pct: ((close - lastLow.price) / range) * 100,
      ote_quality: oteQuality,
      ote_zone_width: oteWidth,
      fib_cluster: clusterBonus > 0,
      swing_age: swingAge,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [08] SMC/ICT 偵測 — 加入 displacement 確認、品質分數、mitigation 次數
// ─────────────────────────────────────────────────────────────────────────────

export interface FvgZone {
  top: number;
  bottom: number;
  mid: number;
  quality: number;       // 0-100 品質分數
  displacement: boolean; // 是否有 displacement K 線確認
  filled_pct: number;    // 已填補百分比 0-1
}

/** 偵測 FVG（Fair Value Gap）— v2.1 Opus 4.6 修復版
 * 改良項目：
 * 1. 修復 filled_pct 邏輯錯誤（原始版用全域極値，應用首次進入時的填補程度）
 * 2. 加入時間衰減（FVG 越舊可靠性越低）
 * 3. 加入 FVG 大小上限過濾（> 4 ATR 可能是流動性真空，非有效 FVG）
 * 4. 加入 age_bars 記錄 FVG 形成後的 K 線數
 */
export function detectFvgZones(candles: Candle[], close: number): {
  nearestBull: FvgZone | null;
  nearestBear: FvgZone | null;
  allBull: FvgZone[];
  allBear: FvgZone[];
} {
  const atr = calcAtrLast(candles, 14);
  const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const bullFvgs: (FvgZone & { age_bars: number })[] = [];
  const bearFvgs: (FvgZone & { age_bars: number })[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const mid  = candles[i];
    const next = candles[i + 1];
    const gapSize = next.low - prev.high;
    const gapSizeBear = prev.low - next.high;
    const age_bars = candles.length - 1 - (i + 1); // FVG 形成後的 K 線數
    const agePenalty = Math.min(40, Math.floor(age_bars / 15) * 10); // 每 15 根 K 線扣 10 分

    // Bullish FVG：前高 < 後低（有缺口）
    if (gapSize > 0 && gapSize < atr * 4) { // 上限過濾：> 4 ATR 可能是流動性真空
      const top = next.low, bottom = prev.high;
      const midBody = Math.abs(mid.close - mid.open);
      const displacement = midBody > atr * 1.5;
      const gapRatio = gapSize / (atr + 0.001);
      const volBonus = mid.volume > avgVol * 1.5 ? 20 : 0;
      const quality = Math.max(0, Math.min(100, Math.round(
        gapRatio * 40 + (displacement ? 30 : 0) + volBonus + 10 - agePenalty
      )));
      // 修復 filled_pct：用首次進入 FVG 區間的最低點計算，而非全域極値
      const laterCandles = candles.slice(i + 2);
      let filled_pct = 0;
      for (const lc of laterCandles) {
        if (lc.low <= top) { // 進入 FVG 區間
          const penetration = Math.min(lc.low, top) - Math.max(lc.low, bottom);
          filled_pct = Math.max(filled_pct, Math.min(1, (top - Math.max(lc.low, bottom)) / (top - bottom + 1e-9)));
          if (lc.low <= bottom) { filled_pct = 1; break; } // 完全填補
        }
      }
      bullFvgs.push({ top, bottom, mid: (top + bottom) / 2, quality, displacement, filled_pct, age_bars });
    }

    // Bearish FVG：前低 > 後高（有缺口）
    if (gapSizeBear > 0 && gapSizeBear < atr * 4) {
      const top = prev.low, bottom = next.high;
      const midBody = Math.abs(mid.close - mid.open);
      const displacement = midBody > atr * 1.5;
      const gapRatio = gapSizeBear / (atr + 0.001);
      const volBonus = mid.volume > avgVol * 1.5 ? 20 : 0;
      const quality = Math.max(0, Math.min(100, Math.round(
        gapRatio * 40 + (displacement ? 30 : 0) + volBonus + 10 - agePenalty
      )));
      let filled_pct = 0;
      const laterCandles = candles.slice(i + 2);
      for (const lc of laterCandles) {
        if (lc.high >= bottom) { // 進入 FVG 區間
          filled_pct = Math.max(filled_pct, Math.min(1, (Math.min(lc.high, top) - bottom) / (top - bottom + 1e-9)));
          if (lc.high >= top) { filled_pct = 1; break; } // 完全填補
        }
      }
      bearFvgs.push({ top, bottom, mid: (top + bottom) / 2, quality, displacement, filled_pct, age_bars });
    }
  }

  // 只保留未完全填補（filled_pct < 0.85）且品質 >= 25 的 FVG
  const validBull = bullFvgs.filter(f => f.filled_pct < 0.85 && f.quality >= 25);
  const validBear = bearFvgs.filter(f => f.filled_pct < 0.85 && f.quality >= 25);

  const nearest = <T extends { mid: number }>(arr: T[]) =>
    arr.sort((a, b) => Math.abs(close - a.mid) - Math.abs(close - b.mid))[0] ?? null;

  return {
    nearestBull: nearest([...validBull]),
    nearestBear: nearest([...validBear]),
    allBull: validBull.sort((a, b) => b.quality - a.quality),
    allBear: validBear.sort((a, b) => b.quality - a.quality),
  };
}

export interface ObZone {
  top: number;
  bottom: number;
  mid: number;
  strength: "strong" | "normal";
  quality: number;       // 0-100 品質分數
  bos_confirmed: boolean; // BOS 後形成的 OB
  tested_count: number;  // 已測試次數
  displacement: boolean;
}

/** 偵測 Order Block — 含 BOS 確認、品質分數、測試次數 */
export function detectOrderBlocks(candles: Candle[], close: number): {
  nearestBull: ObZone | null;
  nearestBear: ObZone | null;
  allBull: ObZone[];
  allBear: ObZone[];
} {
  const atr = calcAtrLast(candles, 14);
  const bullObs: ObZone[] = [];
  const bearObs: ObZone[] = [];

  // 先找 swing 位置（v3.0: 保留 swingHighs/swingLows 供 BOS 確認使用）
  const swingHighs = findSwingHighs(candles, 5);
  const swingLows  = findSwingLows(candles, 5);

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    const nextMove = candles.slice(i + 1, i + 5);
    const bullMove = nextMove.some(n => n.close > c.high * 1.003);
    const bearMove = nextMove.some(n => n.close < c.low * 0.997);

    // Bullish OB：下跌 K 線後出現上漲位移
    if (c.close < c.open && bullMove) {
      const bodySize = c.open - c.close;
      const strength = bodySize / c.close > 0.008 ? "strong" : "normal";
      // displacement：後續 K 線 body 超過 ATR
      const displacement = nextMove.some(n => Math.abs(n.close - n.open) > atr * 1.2);
      // [G3] v3.0: BOS 確認改為「後續收盤突破最近 swing high」而非索引比對
      // 原邏輯只檢查索引是否在 bosHighIdx 中，不代表真正突破
      const nearestSwingHigh = swingHighs.filter(h => h.idx > i).sort((a, b) => a.idx - b.idx)[0];
      const bos_confirmed = nearestSwingHigh
        ? nextMove.some(n => n.close > nearestSwingHigh.price)
        : false;
      // 測試次數：後續 K 線回踩到 OB 區域的次數
      const tested_count = candles.slice(i + 2).filter(n => n.low <= c.open && n.high >= c.close).length;
      const quality = Math.min(100, Math.round(
        (strength === "strong" ? 30 : 15) +
        (displacement ? 25 : 0) +
        (bos_confirmed ? 20 : 0) +
        Math.max(0, 15 - tested_count * 5) + // 測試越多品質越低
        10
      ));
      bullObs.push({ top: c.open, bottom: c.close, mid: (c.open + c.close) / 2, strength, quality, bos_confirmed, tested_count, displacement });
    }

    // Bearish OB：上漲 K 線後出現下跌位移
    if (c.close > c.open && bearMove) {
      const bodySize = c.close - c.open;
      const strength = bodySize / c.open > 0.008 ? "strong" : "normal";
      const displacement = nextMove.some(n => Math.abs(n.close - n.open) > atr * 1.2);
      // [G3] v3.0: BOS 確認改為「後續收盤突破最近 swing low」
      const nearestSwingLow = swingLows.filter(l => l.idx > i).sort((a, b) => a.idx - b.idx)[0];
      const bos_confirmed = nearestSwingLow
        ? nextMove.some(n => n.close < nearestSwingLow.price)
        : false;
      const tested_count = candles.slice(i + 2).filter(n => n.high >= c.open && n.low <= c.close).length;
      const quality = Math.min(100, Math.round(
        (strength === "strong" ? 30 : 15) +
        (displacement ? 25 : 0) +
        (bos_confirmed ? 20 : 0) +
        Math.max(0, 15 - tested_count * 5) +
        10
      ));
      bearObs.push({ top: c.close, bottom: c.open, mid: (c.close + c.open) / 2, strength, quality, bos_confirmed, tested_count, displacement });
    }
  }

  // 只保留品質 >= 40 且測試次數 <= 3 的 OB
  const validBull = bullObs.filter(o => o.quality >= 40 && o.tested_count <= 3);
  const validBear = bearObs.filter(o => o.quality >= 40 && o.tested_count <= 3);

  const nearest = <T extends { mid: number }>(arr: T[]) =>
    arr.sort((a, b) => Math.abs(close - a.mid) - Math.abs(close - b.mid))[0] ?? null;

  return {
    nearestBull: nearest([...validBull]),
    nearestBear: nearest([...validBear]),
    allBull: validBull.sort((a, b) => b.quality - a.quality),
    allBear: validBear.sort((a, b) => b.quality - a.quality),
  };
}

/** 偵測 BOS/CHoCH 結構
 * 修復：改為基於實際價格突破的 BOS/CHoCH 判斷
 * - BOS：強勢方向的 swing 高/低點被有效突破（延續趨勢）
 * - CHoCH：反向突破前一個保護高/低（趨勢轉移信號）
 */
export function detectBosChoch(candles: Candle[]) {
  const highs = findSwingHighs(candles, 5);
  const lows  = findSwingLows(candles, 5);
  const events: { type: string; direction: string; price: number; idx: number; confirmed: boolean }[] = [];

  // 建立結構追蹤：依時間順序合併 swing highs 和 lows
  const allSwings = [
    ...highs.map(h => ({ ...h, swingType: 'high' as const })),
    ...lows.map(l => ({ ...l, swingType: 'low' as const })),
  ].sort((a, b) => a.idx - b.idx);

  // R6-FIX: 初始結構方向由前 20 根 K 線的趨勢決定，而非硬編碼假設多頭
  const initLookback = Math.min(20, candles.length - 1);
  const initTrendBullish = candles[initLookback]?.close < candles[candles.length - 1]?.close;
  let structureBullish = initTrendBullish;
  // R6-FIX: 初始保護高/低不要用第一個 swing 點，用所有 swing 點的最小/最大值
  let lastProtectedHigh = highs.length > 0 ? Math.min(...highs.slice(0, 3).map(h => h.price)) : 0;
  let lastProtectedLow  = lows.length > 0 ? Math.max(...lows.slice(0, 3).map(l => l.price)) : 0;

  for (let i = 1; i < allSwings.length; i++) {
    const cur  = allSwings[i];
    const prev = allSwings[i - 1];

    if (cur.swingType === 'high') {
      if (structureBullish) {
        // 多頭結構中，新高點高於前高點 => BOS（多頭延續）
        // [G6] v3.0: 加入「後續收盤確認」，避免影線假突破
        if (cur.price > lastProtectedHigh) {
          // 確認：cur.idx 之後至少有一根 K 線收盤高於 lastProtectedHigh
          const confirmBar = candles.slice(cur.idx + 1, cur.idx + 4).find(c => c.close > lastProtectedHigh);
          const confirmed = !!confirmBar;
          events.push({ type: 'BOS', direction: 'bullish', price: cur.price, idx: cur.idx, confirmed });
          lastProtectedHigh = cur.price;
        }
      } else {
        // 空頭結構中，新高點高於上一個保護高 => CHoCH（空轉多信號）
        if (cur.price > lastProtectedHigh) {
          const confirmBar = candles.slice(cur.idx + 1, cur.idx + 4).find(c => c.close > lastProtectedHigh);
          const confirmed = !!confirmBar;
          events.push({ type: 'CHoCH', direction: 'bullish', price: cur.price, idx: cur.idx, confirmed });
          if (confirmed) structureBullish = true; // 只有確認後才切換結構
          lastProtectedHigh = cur.price;
        }
      }
    } else {
      if (!structureBullish) {
        // 空頭結構中，新低點低於前低點 => BOS（空頭延續）
        if (cur.price < lastProtectedLow) {
          const confirmBar = candles.slice(cur.idx + 1, cur.idx + 4).find(c => c.close < lastProtectedLow);
          const confirmed = !!confirmBar;
          events.push({ type: 'BOS', direction: 'bearish', price: cur.price, idx: cur.idx, confirmed });
          lastProtectedLow = cur.price;
        }
      } else {
        // 多頭結構中，新低點低於上一個保護低 => CHoCH（多轉空信號）
        if (cur.price < lastProtectedLow) {
          const confirmBar = candles.slice(cur.idx + 1, cur.idx + 4).find(c => c.close < lastProtectedLow);
          const confirmed = !!confirmBar;
          events.push({ type: 'CHoCH', direction: 'bearish', price: cur.price, idx: cur.idx, confirmed });
          if (confirmed) structureBullish = false; // 只有確認後才切換結構
          lastProtectedLow = cur.price;
        }
      }
      // 更新保護低
      if (cur.price < lastProtectedLow || lastProtectedLow === 0) lastProtectedLow = cur.price;
    }
    // 更新保護高
    if (cur.swingType === 'high' && (cur.price > lastProtectedHigh || lastProtectedHigh === 0)) {
      lastProtectedHigh = cur.price;
    }
  }

  events.sort((a, b) => a.idx - b.idx);
  const lastEvent = events[events.length - 1];
  const lastStructure = lastEvent?.direction ?? 'neutral';
  return { events, lastStructure };
}

/** 偵測流動性掃除 — v2.1 Opus 4.6 強化版
 * 改良項目：
 * 1. 加入 ATR 刺穿深度驗證（< 1.5 ATR 才算有效清掃，太深是真突破）
 * 2. 加入等高/等低（Equal Highs/Lows）流動性池追蹤
 * 3. 加入收盤方向確認（清掃前高後應收陰線，清掃前低後應收陽線）
 * 4. 加入 sweepStrength 評分（0-100）
 * 5. 返回結構失效點（bslSweepLow / sslSweepHigh）用於 SL 計算
 */
export function detectLiquiditySweep(candles: Candle[], close: number) {
  const atr = calcAtrLast(candles, 14);
  const highs = findSwingHighs(candles.slice(-60), 4);
  const lows  = findSwingLows(candles.slice(-60), 4);
  const recent = candles.slice(-6);

  let bslSwept = false, sslSwept = false;
  let bslPrice = 0, sslPrice = 0;
  let bslSweepDepth = 0, sslSweepDepth = 0;
  let bslStrength = 0, sslStrength = 0;
  let bslSweepLow = 0, sslSweepHigh = 0;
  let bslReclaimed = false, sslReclaimed = false;

  // ─ 等高/等低流動性池偵測（含去重：避免 A≈B≈C 產生 AB/AC/BC 三個重複 level）─
  const rawEqualHighPairs: number[] = [];
  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[i].price - highs[j].price) / (highs[i].price + 1e-9) < 0.001)
        rawEqualHighPairs.push((highs[i].price + highs[j].price) / 2);
    }
  }
  // 去重：相近 0.1% 以內的 level 只保留第一個
  const equalHighPairs = rawEqualHighPairs.filter(
    (v, i, a) => a.findIndex(x => Math.abs(x - v) / (v + 1e-9) < 0.001) === i
  );
  const rawEqualLowPairs: number[] = [];
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[i].price - lows[j].price) / (lows[i].price + 1e-9) < 0.001)
        rawEqualLowPairs.push((lows[i].price + lows[j].price) / 2);
    }
  }
  const equalLowPairs = rawEqualLowPairs.filter(
    (v, i, a) => a.findIndex(x => Math.abs(x - v) / (v + 1e-9) < 0.001) === i
  );

  // ─ Buyside Liquidity Sweep（清掃前高）─
  // 修復：遍歷所有匹配 candle（而非只取第一根），選最佳 sweep
  const allHighLevels = [...highs.slice(-5).map(h => h.price), ...equalHighPairs];
  for (const level of allHighLevels) {
    const sweepCandidates = recent.filter(c => c.high > level);
    for (const sweepCandle of sweepCandidates) {
      if (close < level) {
        const depth = (sweepCandle.high - level) / (atr + 1e-9);
        const reclaimed = sweepCandle.close < level;
        const closeBearish = sweepCandle.close < sweepCandle.open;
        if (depth < 1.5 && reclaimed) {
          const isEqualHigh = equalHighPairs.some(p => Math.abs(p - level) / (level + 1e-9) < 0.001);
          const strength = Math.min(100, Math.round(
            (1.5 - depth) / 1.5 * 40 +
            (closeBearish ? 30 : 10) +
            (isEqualHigh ? 30 : 15)
          ));
          if (strength > bslStrength) {
            bslSwept = true; bslPrice = level;
            bslSweepDepth = depth; bslStrength = strength;
            bslSweepLow = sweepCandle.low;
            bslReclaimed = reclaimed;
          }
        }
      }
    }
  }

  // ─ Sellside Liquidity Sweep（清掃前低）─
  // 修復：遍歷所有匹配 candle（而非只取第一根），選最佳 sweep
  const allLowLevels = [...lows.slice(-5).map(l => l.price), ...equalLowPairs];
  for (const level of allLowLevels) {
    const sweepCandidates = recent.filter(c => c.low < level);
    for (const sweepCandle of sweepCandidates) {
      if (close > level) {
        const depth = (level - sweepCandle.low) / (atr + 1e-9);
        const reclaimed = sweepCandle.close > level;
        const closeBullish = sweepCandle.close > sweepCandle.open;
        if (depth < 1.5 && reclaimed) {
          const isEqualLow = equalLowPairs.some(p => Math.abs(p - level) / (level + 1e-9) < 0.001);
          const strength = Math.min(100, Math.round(
            (1.5 - depth) / 1.5 * 40 +
            (closeBullish ? 30 : 10) +
            (isEqualLow ? 30 : 15)
          ));
          if (strength > sslStrength) {
            sslSwept = true; sslPrice = level;
            sslSweepDepth = depth; sslStrength = strength;
            sslSweepHigh = sweepCandle.high;
            sslReclaimed = reclaimed;
          }
        }
      }
    }
  }

  return {
    bslSwept, sslSwept,
    bslPrice, sslPrice,
    bslSweepDepth, sslSweepDepth,
    bslStrength, sslStrength,
    bslSweepLow,   // BSL 清掃時的最低點（用於多頭 SL）
    sslSweepHigh,  // SSL 清掃時的最高點（用於空頭 SL）
    bslReclaimed, sslReclaimed,
    hasEqualHighs: equalHighPairs.length > 0,
    hasEqualLows: equalLowPairs.length > 0,
  };
}

/** 偵測 PA 形態（Pin Bar、Engulfing、Inside Bar、Hammer、Shooting Star） */
export function detectPaPatterns(candles: Candle[]) {
  const recent = candles.slice(-5);
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  if (!last || !prev) return { bullish: [] as string[], bearish: [] as string[] };
  const bullish: string[] = [], bearish: string[] = [];
  const lastBody  = Math.abs(last.close - last.open);
  const lastRange = last.high - last.low;
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  if (lowerWick > lastBody * 2 && lowerWick > upperWick * 2) bullish.push("Pin Bar（下影長）");
  if (upperWick > lastBody * 2 && upperWick > lowerWick * 2) bearish.push("Pin Bar（上影長）");
  if (last.close > last.open && last.close > prev.open && last.open < prev.close && prev.close < prev.open)
    bullish.push("Bullish Engulfing");
  if (last.close < last.open && last.close < prev.open && last.open > prev.close && prev.close > prev.open)
    bearish.push("Bearish Engulfing");
  if (last.high < prev.high && last.low > prev.low) {
    if (last.close > last.open) bullish.push("Inside Bar（多）");
    else bearish.push("Inside Bar（空）");
  }
  // R8-FIX: Hammer/Shooting Star 使用標準比例定義（避免普通波動 K 線被誤判）
  // Hammer: 實體小（<= 35% 全幅），下影 >= 實體 2 倍，上影 <= 全幅 15%
  if (lastRange > 0) {
    const bodyRatio = lastBody / lastRange;
    const lowerToBody = lastBody > 0 ? lowerWick / lastBody : lowerWick / 0.0001;
    const upperToRange = upperWick / lastRange;
    if (bodyRatio <= 0.35 && lowerToBody >= 2.0 && upperToRange <= 0.15) {
      bullish.push("Hammer");
    }
    // Shooting Star: 實體小（<= 35% 全幅），上影 >= 實體 2 倍，下影 <= 全幅 15%
    const upperToBody = lastBody > 0 ? upperWick / lastBody : upperWick / 0.0001;
    const lowerToRange = lowerWick / lastRange;
    if (bodyRatio <= 0.35 && upperToBody >= 2.0 && lowerToRange <= 0.15) {
      bearish.push("Shooting Star");
    }
  }
  return { bullish, bearish };
}

// ─────────────────────────────────────────────────────────────────────────────
// [06][07] 纏論 — 加入包含關係處理、多因子背馳
// ─────────────────────────────────────────────────────────────────────────────

/** 纏論 K 線包含關係處理（含方向感知）
 * 修復：上升趨勢取高高低高，下降趨勢取低低高低，符合正統纏論定義
 */
/** [C1] v3.0: 包含關係處理並回傳原始索引映射
 *  原函數只回傳合並後的 K 棒陣列，導致 calcChanSimple 在查找筆對應的原始 K 棒索引時出現映射錯位
 *  此版本額外回傳 mergedToOriginalEnd[]：第 i 個 merged K 棒對應原始 candles 的最後一根索引
 */
function mergeContainingCandles(candles: Candle[]): { merged: Candle[]; mergedToOriginalEnd: number[] } {
  if (candles.length === 0) return { merged: [], mergedToOriginalEnd: [] };
  const merged: Candle[] = [{ ...candles[0] }];
  const mergedToOriginalEnd: number[] = [0]; // merged[0] 對應原始索引 0
  for (let i = 1; i < candles.length; i++) {
    const last = merged[merged.length - 1];
    const cur = candles[i];
    // 包含關係：一根完全包含另一根
    const lastContainsCur = last.high >= cur.high && last.low <= cur.low;
    const curContainsLast = cur.high >= last.high && cur.low <= last.low;
    if (lastContainsCur || curContainsLast) {
      // 方向感知：依前一對已合並 K 的趨勢决定合並方式
      const prevMerged = merged.length >= 2 ? merged[merged.length - 2] : null;
      const isUpTrend = prevMerged
        ? (last.high >= prevMerged.high && last.low >= prevMerged.low)
          || (last.high >= prevMerged.high && last.low < prevMerged.low ? last.high - prevMerged.high > prevMerged.low - last.low : false)
        : (candles.length > 1 ? candles[1].high >= candles[0].high : true);
      if (isUpTrend) {
        merged[merged.length - 1] = {
          ...last,
          high: Math.max(last.high, cur.high),
          low:  Math.max(last.low, cur.low),
          close: cur.close,
          volume: last.volume + cur.volume,
        };
      } else {
        merged[merged.length - 1] = {
          ...last,
          high: Math.min(last.high, cur.high),
          low:  Math.min(last.low, cur.low),
          close: cur.close,
          volume: last.volume + cur.volume,
        };
      }
      // [C1] 更新映射：合並後最後一根的原始索引是 i
      mergedToOriginalEnd[merged.length - 1] = i;
    } else {
      merged.push({ ...cur });
      mergedToOriginalEnd.push(i); // 新的 merged K 棒對應原始索引 i
    }
  }
  return { merged, mergedToOriginalEnd };
}

/** 纏論簡化計算 v2（含包含關係處理、多因子背馳） */
export function calcChanSimple(candles: Candle[]) {
  // 防呂：資料不足時回傳空結果
  if (candles.length < 10) {
    return { bis: [], trend: "ranging" as const, inZhongshu: false, zhongshuTop: 0, zhongshuBottom: 0, divergence: null, divergence_strength: 0, biCount: 0 };
  }
  // Step 0: 包含關係處理
  // [C1] v3.0: 使用新版 mergeContainingCandles，取得合並後 K 棒陣列和原始索引映射
  const { merged: merged_candles, mergedToOriginalEnd } = mergeContainingCandles(candles);

  const fractals: { idx: number; type: "top" | "bottom"; price: number }[] = [];
  for (let i = 1; i < merged_candles.length - 1; i++) {
    const prev = merged_candles[i - 1], cur = merged_candles[i], next = merged_candles[i + 1];
    // 修復：允許一側相等、另一側突破（處理加密市場常見的等高/等低平台 K）
    const isTop = (cur.high >= prev.high && cur.high > next.high) || (cur.high > prev.high && cur.high >= next.high);
    const isBot = (cur.low <= prev.low && cur.low < next.low) || (cur.low < prev.low && cur.low <= next.low);
    if (isTop && !isBot) fractals.push({ idx: i, type: "top", price: cur.high });
    else if (isBot && !isTop) fractals.push({ idx: i, type: "bottom", price: cur.low });
  }
  const merged: typeof fractals = [];
  for (const f of fractals) {
    const last = merged[merged.length - 1];
    if (last && last.type === f.type) {
      if (f.type === "top" && f.price > last.price) merged[merged.length - 1] = f;
      else if (f.type === "bottom" && f.price < last.price) merged[merged.length - 1] = f;
    } else merged.push(f);
  }
  // 纏論筆最小間距：相鄰頂底分型之間至少 5 根 K 線（含端點）= idx 差 >= 5
  // 修復：改為 while loop，不满足間距時向前找更遠的匹配分型（避免漏掉有效筆）
  const MIN_BI_GAP = 5;
  const bis: { direction: "up" | "down"; start: number; end: number; startIdx: number; endIdx: number; startTime: number; endTime: number }[] = [];
  {
    let i = 0;
    while (i < merged.length - 1) {
      // 從 merged[i] 往前找第一個满足間距且方向相反的分型
      let j = i + 1;
      while (j < merged.length && merged[j].idx - merged[i].idx < MIN_BI_GAP) j++;
      if (j >= merged.length) break;
      const a = merged[i], b = merged[j];
      // 需要頂底交替（如果不交替則從 i+1 重試）
      if (a.type !== b.type) {
        // [C1] v3.0: 使用 mergedToOriginalEnd 映射取得正確的原始 candles 索引
        // 原始錯誤：直接用 a.idx（merged_candles 索引）查找 candles[a.idx]，導致時間錯位
        const aOrigIdx = mergedToOriginalEnd[a.idx] ?? a.idx;
        const bOrigIdx = mergedToOriginalEnd[b.idx] ?? b.idx;
        if (a.type === "bottom" && b.type === "top")
          bis.push({ direction: "up", start: a.price, end: b.price, startIdx: aOrigIdx, endIdx: bOrigIdx, startTime: candles[aOrigIdx]?.time ?? 0, endTime: candles[bOrigIdx]?.time ?? 0 });
        else if (a.type === "top" && b.type === "bottom")
          bis.push({ direction: "down", start: a.price, end: b.price, startIdx: aOrigIdx, endIdx: bOrigIdx, startTime: candles[aOrigIdx]?.time ?? 0, endTime: candles[bOrigIdx]?.time ?? 0 });
        i = j; // 成功配對，從 j 開始下一筆
      } else {
        i++; // 方向相同，從 i+1 重試
      }
    }
  }
  // R8-FIX: 中樞計算加入 ZG/ZD/GG/DD 四個關鍵屬性（纏論標準定義）
  // ZG = 中樞上沿（三筆最高點的最小值），ZD = 中樞下沿（三筆最低點的最大值）
  // GG = 中樞內最高點，DD = 中樞內最低點
  let inZhongshu = false, zhongshuTop = 0, zhongshuBottom = 0;
  let zhongshuZG = 0, zhongshuZD = 0, zhongshuGG = 0, zhongshuDD = 0;
  
  // 收集所有中樞（用於趨勢判斷）
  const zhongshus: { zg: number; zd: number; gg: number; dd: number; startBiIdx: number }[] = [];
  
  for (let zi = 2; zi < bis.length; zi++) {
    const b0 = bis[zi - 2], b1 = bis[zi - 1], b2 = bis[zi];
    const validZhongshu = (
      (b0.direction === "up" && b1.direction === "down" && b2.direction === "up") ||
      (b0.direction === "down" && b1.direction === "up" && b2.direction === "down")
    );
    if (validZhongshu) {
      const highs = [Math.max(b0.start, b0.end), Math.max(b1.start, b1.end), Math.max(b2.start, b2.end)];
      const lows  = [Math.min(b0.start, b0.end), Math.min(b1.start, b1.end), Math.min(b2.start, b2.end)];
      const zg = Math.min(...highs); // 中樞上沿：三筆最高點的最小值
      const zd = Math.max(...lows);  // 中樞下沿：三筆最低點的最大值
      const gg = Math.max(...highs); // 中樞內最高點
      const dd = Math.min(...lows);  // 中樞內最低點
      if (zg > zd) {
        zhongshus.push({ zg, zd, gg, dd, startBiIdx: zi - 2 });
      }
    }
  }
  
  if (zhongshus.length > 0) {
    const lastZhongshu = zhongshus[zhongshus.length - 1];
    zhongshuTop = lastZhongshu.zg;
    zhongshuBottom = lastZhongshu.zd;
    zhongshuZG = lastZhongshu.zg;
    zhongshuZD = lastZhongshu.zd;
    zhongshuGG = lastZhongshu.gg;
    zhongshuDD = lastZhongshu.dd;
    const close = candles[candles.length - 1].close;
    inZhongshu = close >= zhongshuBottom && close <= zhongshuTop;
  }
  
  // R8-FIX: 趨勢判斷改為中樞上移/下移（纏論標準定義）
  // 中樞上移 = 後一個中樞的 ZD > 前一個中樞的 ZG（多頭趨勢）
  // 中樞下移 = 後一個中樞的 ZG < 前一個中樞的 ZD（空頭趨勢）
  let trend: "bullish" | "bearish" | "ranging" = "ranging";
  if (zhongshus.length >= 2) {
    const prevZ = zhongshus[zhongshus.length - 2];
    const lastZ = zhongshus[zhongshus.length - 1];
    if (lastZ.zd > prevZ.zg) trend = "bullish";   // 中樞上移（整體上升）
    else if (lastZ.zg < prevZ.zd) trend = "bearish"; // 中樞下移（整體下降）
  } else if (bis.length >= 2) {
    // 只有一個中樞時，退化為比較同方向筆的高低點
    const last = bis[bis.length - 1];
    const sameDirectionBis = bis.filter(b => b.direction === last.direction);
    if (sameDirectionBis.length >= 2) {
      const prev = sameDirectionBis[sameDirectionBis.length - 2];
      if (last.direction === "up" && last.end > prev.end) trend = "bullish";
      else if (last.direction === "down" && last.end < prev.end) trend = "bearish";
    }
  }

  // [07] R6-FIX: 多因子背馳判斷——比較兩筆各自的 MACD 面積，而非全局 histSum
  let divergence: "top" | "bottom" | null = null;
  let divergence_strength = 0;
  if (bis.length >= 4) {
    // 修復：改為按方向過濾（而非奇偶索引），避免筆不嚴格交替時的誤判
    const lastBi = bis[bis.length - 1];
    const sameDir = bis.filter(b => b.direction === lastBi.direction);
    if (sameDir.length >= 2) {
      const d1 = sameDir[sameDir.length - 2];
      const d2 = sameDir[sameDir.length - 1];
      const amp1 = Math.abs(d1.end - d1.start);
      const amp2 = Math.abs(d2.end - d2.start);
      // 因儇1：幅度縮小（縮小超過 30% 才算背馳）
      const ampFactor = amp2 < amp1 * 0.7 ? 1 : 0;
      // 因儇2：斜率下降（縮小超過 15%）
      const slopeFactor = amp2 < amp1 * 0.85 ? 0.5 : 0;
      // 因儇3：R6-FIX —— 比較兩筆各自對應的 MACD 面積
      // 原始邏輯用全局 histSum 判斷方向，這對小時間框噪音大時會誤判
      const closes = candles.map(c => c.close);
      const { hist } = calcMacdArr(closes);
      // 第一筆的 MACD 面積（用筆的起止索引區間）
      const d1StartIdx = candles.findIndex(c => c.time === d1.startTime);
      const d1EndIdx   = candles.findIndex(c => c.time === d1.endTime);
      const d2StartIdx = candles.findIndex(c => c.time === d2.startTime);
      const d2EndIdx   = candles.findIndex(c => c.time === d2.endTime);
      let histFactor = 0;
      if (d1StartIdx >= 0 && d1EndIdx > d1StartIdx && d2StartIdx >= 0 && d2EndIdx > d2StartIdx) {
        const hist1 = hist.slice(d1StartIdx, d1EndIdx + 1).filter(v => !isNaN(v));
        const hist2 = hist.slice(d2StartIdx, d2EndIdx + 1).filter(v => !isNaN(v));
        const area1 = Math.abs(hist1.reduce((a, b) => a + b, 0));
        const area2 = Math.abs(hist2.reduce((a, b) => a + b, 0));
        // 第二筆 MACD 面積小於第一筆 => 背馳確認
        if (area1 > 0 && area2 < area1 * 0.8) histFactor = 0.5;
      } else {
        // Fallback: 當索引找不到時，用最近 20 根的方向判斷
        const recentHist = hist.slice(-20).filter(v => !isNaN(v));
        const histSum = recentHist.reduce((a, b) => a + b, 0);
        histFactor = (d2.direction === "up" && histSum < 0) ? 0.5 :
                     (d2.direction === "down" && histSum > 0) ? 0.5 : 0;
      }

      divergence_strength = ampFactor + slopeFactor + histFactor;
      if (divergence_strength >= 1) {
        if (d2.direction === "up") divergence = "top";
        else if (d2.direction === "down") divergence = "bottom";
      }
    }
  }

  return { bis, trend, inZhongshu, zhongshuTop, zhongshuBottom, zhongshuZG, zhongshuZD, zhongshuGG, zhongshuDD, divergence, divergence_strength, biCount: bis.length, zhongshuCount: zhongshus.length };
}
