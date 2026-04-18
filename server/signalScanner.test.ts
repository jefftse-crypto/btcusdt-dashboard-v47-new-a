import { describe, expect, it } from "vitest";
import {
  ALL_SCAN_STRATEGIES,
  CORE_STRATEGIES,
  AUX_STRATEGIES,
  getStrategiesForRegime,
  prioritizeStrategies,
} from "./signalScanner";

describe("signalScanner strategy coverage", () => {
  it("keeps all strategies exactly once after prioritization", () => {
    const prioritized = prioritizeStrategies(["cannonball", "hwr_model_a", "cannonball", "macd"]);

    expect(prioritized).toEqual([
      "cannonball",
      "hwr_model_a",
      "macd",
      ...ALL_SCAN_STRATEGIES.filter((strategy) => !["cannonball", "hwr_model_a", "macd"].includes(strategy)),
    ]);
    expect(new Set(prioritized).size).toBe(ALL_SCAN_STRATEGIES.length);
  });

  it.each([
    ["trending", [
      ...CORE_STRATEGIES,
      "ema_cross",
      "macd",
      "liquidity_sweep",
      "composite",
    ]],
    ["ranging", [
      ...CORE_STRATEGIES,
      "rsi_reversal",
      "bollinger",
      "vwap_reversion",
      "chan",
      "composite",
    ]],
    ["compressed", ["hwr_model_c", "bollinger", "hwr_model_a", "cannonball", "liquidity_sweep"]],
    ["chaotic", ["hwr_model_a", "hwr_model_c", "pa", "cannonball"]],
  ])("returns full coverage for %s regime while preserving priority prefix", (regime, expectedPrefix) => {
    const strategies = getStrategiesForRegime(regime);

    expect(strategies.slice(0, expectedPrefix.length)).toEqual(expectedPrefix);
    expect(strategies).toHaveLength(ALL_SCAN_STRATEGIES.length);
    expect(new Set(strategies)).toEqual(new Set(ALL_SCAN_STRATEGIES));
  });

  it("keeps core and auxiliary pools mutually exclusive and fully covered", () => {
    expect(new Set(CORE_STRATEGIES).size).toBe(CORE_STRATEGIES.length);
    expect(new Set(AUX_STRATEGIES).size).toBe(AUX_STRATEGIES.length);
    expect(CORE_STRATEGIES.filter((strategy) => AUX_STRATEGIES.includes(strategy))).toEqual([]);
    expect([...CORE_STRATEGIES, ...AUX_STRATEGIES]).toEqual(ALL_SCAN_STRATEGIES);
  });
});
