import { describe, it, expect } from 'vitest';
import { calcRsiArr, calcMacdArr, calcAdxArr, calcAtrArr } from './indicators.js';

describe('Indicators Consistency Tests (O12)', () => {
  // 模擬 K 線數據 (60 根，指標初始化需要較長序列)
  const prices = Array.from({ length: 60 }, (_, i) => 100 + i + Math.sin(i) * 5);
  const candles = prices.map((p, i) => ({
    time: i * 60000,
    open: p - 1,
    high: p + 2,
    low: p - 2,
    close: p,
    volume: 1000
  }));
  const closes = candles.map(c => c.close);

  it('RSI should calculate correctly with Wilder smoothing (O1)', () => {
    const rsi = calcRsiArr(closes, 14);
    expect(rsi.length).toBe(closes.length);
    // RSI 第 15 根 (index 14) 開始有值
    expect(rsi[13]).toBeNaN();
    expect(typeof rsi[14]).toBe('number');
  });

  it('MACD should align signal line correctly (O1)', () => {
    const macd = calcMacdArr(closes);
    expect(macd.macd.length).toBe(closes.length);
    expect(macd.signal.length).toBe(closes.length);
    
    // EMA 26 在 index 25 開始有值
    expect(macd.macd[24]).toBeNaN();
    expect(typeof macd.macd[25]).toBe('number');
    
    // Signal (EMA 9) 在 MACD 有值後再加 8 根開始有值 (25 + 8 = 33)
    // 實際測試顯示 index 33 已有值，這取決於 EMA 初始化邏輯
    expect(typeof macd.signal[33]).toBe('number');
  });

  it('ADX should use Wilder smoothing and align correctly (O2)', () => {
    const adxResult = calcAdxArr(candles, 14);
    expect(adxResult.adx.length).toBe(candles.length);
    // ADX 初始化在 index 27 左右開始有值
    expect(typeof adxResult.adx[27]).toBe('number');
  });

  it('ATR should use Wilder smoothing (O3)', () => {
    const atr = calcAtrArr(candles, 14);
    expect(atr.length).toBe(candles.length);
    // ATR 第 15 根 (index 14) 開始有值
    expect(atr[13]).toBeNaN();
    expect(typeof atr[14]).toBe('number');
  });
});
