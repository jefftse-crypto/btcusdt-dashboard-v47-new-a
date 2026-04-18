import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchCandlesMock = vi.fn();
const detectOrderBlocksMock = vi.fn();
const detectBosChochMock = vi.fn();
const findSwingHighsMock = vi.fn();
const findSwingLowsMock = vi.fn();
const calcAtrLastMock = vi.fn();

vi.mock("./analysis.js", () => ({
  fetchCandles: fetchCandlesMock,
}));

vi.mock("./utils/indicators.js", () => ({
  detectOrderBlocks: detectOrderBlocksMock,
  detectBosChoch: detectBosChochMock,
  findSwingHighs: findSwingHighsMock,
  findSwingLows: findSwingLowsMock,
  calcAtrLast: calcAtrLastMock,
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockCandles = Array.from({ length: 30 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
  volume: 1_000 + i,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.resetModules();

  detectOrderBlocksMock.mockReturnValue({
    allBull: [
      {
        top: 105,
        bottom: 100,
        mid: 102.5,
        strength: "strong",
        quality: 80,
        bos_confirmed: true,
        tested_count: 1,
      },
    ],
    allBear: [],
    nearestBull: {
      top: 105,
      bottom: 100,
      mid: 102.5,
      strength: "strong",
      quality: 80,
      bos_confirmed: true,
      tested_count: 1,
    },
    nearestBear: null,
  });

  detectBosChochMock.mockReturnValue({
    events: [{ type: "BOS", direction: "bullish", price: 110, confirmed: true }],
  });

  findSwingHighsMock.mockReturnValue([
    { price: 110, idx: 1 },
    { price: 120, idx: 2 },
    { price: 130, idx: 3 },
  ]);

  findSwingLowsMock.mockReturnValue([
    { price: 90, idx: 1 },
    { price: 95, idx: 2 },
    { price: 100, idx: 3 },
  ]);

  calcAtrLastMock.mockReturnValue(5);
});

afterEach(() => {
  vi.useRealTimers();
});

async function flushCannonballDelay() {
  await vi.advanceTimersByTimeAsync(100);
}

describe("runCannonballAnalysis cache key", () => {
  it("reuses the in-flight request when TP2 and avoid-extremes parameters are identical", async () => {
    const first = createDeferred<typeof mockCandles>();
    const second = createDeferred<typeof mockCandles>();
    fetchCandlesMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { runCannonballAnalysis } = await import("./services/cannonballService");

    const p1 = runCannonballAnalysis("BTCUSDT", { tp2_atr_mult: 2.5, avoid_extremes_atr: 0.8 });
    const p2 = runCannonballAnalysis("BTCUSDT", { tp2_atr_mult: 2.5, avoid_extremes_atr: 0.8 });

    expect(fetchCandlesMock).toHaveBeenCalledTimes(1);

    await flushCannonballDelay();
    expect(fetchCandlesMock).toHaveBeenCalledTimes(2);

    first.resolve(mockCandles);
    second.resolve(mockCandles);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(fetchCandlesMock).toHaveBeenCalledTimes(2);
    expect(r1.params_used.tp2_atr_mult).toBe(2.5);
    expect(r2.params_used.avoid_extremes_atr).toBe(0.8);
  });

  it("splits in-flight cache when TP2 differs", async () => {
    const deferreds = Array.from({ length: 4 }, () => createDeferred<typeof mockCandles>());
    deferreds.forEach((deferred) => {
      fetchCandlesMock.mockImplementationOnce(() => deferred.promise);
    });

    const { runCannonballAnalysis } = await import("./services/cannonballService");

    const p1 = runCannonballAnalysis("BTCUSDT", { tp2_atr_mult: 2.5, avoid_extremes_atr: 0.8 });
    const p2 = runCannonballAnalysis("BTCUSDT", { tp2_atr_mult: 3.1, avoid_extremes_atr: 0.8 });

    expect(fetchCandlesMock).toHaveBeenCalledTimes(2);

    await flushCannonballDelay();
    expect(fetchCandlesMock).toHaveBeenCalledTimes(4);

    deferreds.forEach((deferred) => deferred.resolve(mockCandles));
    await Promise.all([p1, p2]);

    expect(fetchCandlesMock).toHaveBeenCalledTimes(4);
  });

  it("splits in-flight cache when avoid-extremes threshold differs", async () => {
    const deferreds = Array.from({ length: 4 }, () => createDeferred<typeof mockCandles>());
    deferreds.forEach((deferred) => {
      fetchCandlesMock.mockImplementationOnce(() => deferred.promise);
    });

    const { runCannonballAnalysis } = await import("./services/cannonballService");

    const p1 = runCannonballAnalysis("BTCUSDT", { tp2_atr_mult: 2.5, avoid_extremes_atr: 0.8 });
    const p2 = runCannonballAnalysis("BTCUSDT", { tp2_atr_mult: 2.5, avoid_extremes_atr: 1.1 });

    expect(fetchCandlesMock).toHaveBeenCalledTimes(2);

    await flushCannonballDelay();
    expect(fetchCandlesMock).toHaveBeenCalledTimes(4);

    deferreds.forEach((deferred) => deferred.resolve(mockCandles));
    await Promise.all([p1, p2]);

    expect(fetchCandlesMock).toHaveBeenCalledTimes(4);
  });
});
