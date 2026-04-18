/**
 * Test helper: exposes internal functions from analysis.ts for unit testing
 */
import type { Candle } from "./analysis";

// Re-implement calcChan logic for testing (mirrors the function in analysis.ts)
export function calcChanForTest(candles: Candle[]): {
  bis: unknown[];
  duans: unknown[];
  zhongshus: unknown[];
  trend: "bullish" | "bearish" | "ranging";
  in_zhongshu: boolean;
  current_zhongshu: unknown | null;
  bi_count: number;
  duan_count: number;
} {
  if (candles.length < 5) {
    return { bis: [], duans: [], zhongshus: [], trend: "ranging", in_zhongshu: false, current_zhongshu: null, bi_count: 0, duan_count: 0 };
  }
  // Minimal fractal detection
  const fractal: { idx: number; type: "top" | "bottom"; price: number; time: number }[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const cur  = candles[i];
    const next = candles[i + 1];
    if (cur.high > prev.high && cur.high > next.high) {
      fractal.push({ idx: i, type: "top", price: cur.high, time: cur.time });
    } else if (cur.low < prev.low && cur.low < next.low) {
      fractal.push({ idx: i, type: "bottom", price: cur.low, time: cur.time });
    }
  }
  return { bis: fractal, duans: [], zhongshus: [], trend: "ranging", in_zhongshu: false, current_zhongshu: null, bi_count: fractal.length, duan_count: 0 };
}
