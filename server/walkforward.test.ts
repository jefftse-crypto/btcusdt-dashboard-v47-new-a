import { beforeEach, describe, expect, it, vi } from "vitest";

const runBacktestMock = vi.fn();

vi.mock("./backtest", () => ({
  runBacktest: runBacktestMock,
}));

const candles = Array.from({ length: 720 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  open: 100 + i * 0.1,
  high: 101 + i * 0.1,
  low: 99 + i * 0.1,
  close: 100 + i * 0.1,
  volume: 1_000 + i,
}));

beforeEach(() => {
  vi.clearAllMocks();
  runBacktestMock.mockReturnValue({
    total_trades: 5,
    win_rate: 0.6,
    total_return_net: 0.12,
    sharpe_ratio: 1.4,
    sortino_ratio: 1.8,
    max_drawdown: 0.05,
    profit_factor: 1.6,
  });
});

describe("runWalkForwardBacktest option passthrough", () => {
  it("passes ATR and execution flags to every runBacktest call", async () => {
    const { runWalkForwardBacktest } = await import("./walkforward");

    await runWalkForwardBacktest("BTCUSDT", "cannonball", "15m", candles, 0.7, {
      atr_sl_mult: 1.7,
      atr_tp_mult: 3.4,
      enable_fee: true,
      enable_trailing_stop: true,
      enable_mtf_filter: true,
      enable_adx_filter: false,
      enable_fvg_ob_filter: true,
    });

    expect(runBacktestMock).toHaveBeenCalled();

    for (const [payload] of runBacktestMock.mock.calls) {
      expect(payload.strategy).toBe("cannonball");
      expect(payload.symbol).toBe("BTCUSDT");
      expect(payload.interval).toBe("15m");
      expect(payload.atr_sl_mult).toBe(1.7);
      expect(payload.atr_tp_mult).toBe(3.4);
      expect(payload.enable_fee).toBe(true);
      expect(payload.enable_trailing_stop).toBe(true);
      expect(payload.enable_mtf_filter).toBe(true);
      expect(payload.enable_adx_filter).toBe(false);
      expect(payload.enable_fvg_ob_filter).toBe(true);
    }
  });

  it("preserves true-MTF slices together with ATR options", async () => {
    const { runWalkForwardBacktest } = await import("./walkforward");
    const htfCandles = candles.filter((_, index) => index % 4 === 0);
    const entryCandles = candles;

    await runWalkForwardBacktest("ETHUSDT", "smc", "15m", candles, 0.7, {
      atr_sl_mult: 2.1,
      atr_tp_mult: 4.2,
      use_true_mtf: true,
      htf_candles: htfCandles,
      entry_candles: entryCandles,
    });

    expect(runBacktestMock).toHaveBeenCalled();
    const firstPayload = runBacktestMock.mock.calls[0][0];

    expect(firstPayload.atr_sl_mult).toBe(2.1);
    expect(firstPayload.atr_tp_mult).toBe(4.2);
    expect(Array.isArray(firstPayload.htf_candles)).toBe(true);
    expect(Array.isArray(firstPayload.entry_candles)).toBe(true);
    expect(firstPayload.htf_candles.length).toBeGreaterThan(0);
    expect(firstPayload.entry_candles.length).toBeGreaterThan(0);
  });
});
