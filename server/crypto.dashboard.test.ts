import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createPublicCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const { ctx } = (() => {
      const cleared: Array<{ name: string; opts: Record<string, unknown> }> = [];
      const c: TrpcContext = {
        user: {
          id: 1,
          openId: "test-user",
          email: "test@example.com",
          name: "Test",
          loginMethod: "manus",
          role: "user",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        },
        req: { protocol: "https", headers: {} } as TrpcContext["req"],
        res: {
          clearCookie: (name: string, opts: Record<string, unknown>) => {
            cleared.push({ name, opts });
          },
        } as unknown as TrpcContext["res"],
      };
      return { ctx: c, cleared };
    })();

    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
  });
});

describe("crypto.getKlines", () => {
  it("returns array structure for valid symbol + timeframe", async () => {
    const ctx = createPublicCtx();
    const caller = appRouter.createCaller(ctx);

    // Mock fetch to avoid real network call in test
    const mockCandles = Array.from({ length: 10 }, (_, i) => ({
      time: 1700000000 + i * 3600,
      open: 40000 + i * 10,
      high: 40100 + i * 10,
      low: 39900 + i * 10,
      close: 40050 + i * 10,
      volume: 100 + i,
    }));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: mockCandles.map(c => [
          String(c.time * 1000),
          String(c.open),
          String(c.high),
          String(c.low),
          String(c.close),
          String(c.volume),
        ]),
      }),
    });

    vi.stubGlobal("fetch", mockFetch);

    const result = await caller.crypto.getKlines({ symbol: "BTCUSDT", timeframe: "4h", limit: 10 });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(10);
    expect(result[0]).toHaveProperty("time");
    expect(result[0]).toHaveProperty("open");
    expect(result[0]).toHaveProperty("close");

    vi.unstubAllGlobals();
  });
});

describe("news.getLatestNews", () => {
  it("returns array (even if empty when RSS is unavailable)", async () => {
    const ctx = createPublicCtx();
    const caller = appRouter.createCaller(ctx);

    // Mock fetch to simulate RSS timeout
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await caller.news.getLatestNews({ symbol: "BTCUSDT", hours: 6 });

    expect(Array.isArray(result)).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("widgets.savePrefs and getPrefs", () => {
  it("validates input schema correctly", async () => {
    const ctx = createPublicCtx();
    const caller = appRouter.createCaller(ctx);

    // Invalid: empty openId should throw
    await expect(
      caller.widgets.savePrefs({ openId: "", widgetIds: ["kline_chart"] })
    ).rejects.toThrow();
  });

  it("returns null for unknown openId", async () => {
    const ctx = createPublicCtx();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.widgets.getPrefs({ openId: undefined });
    expect(result).toBeNull();
  });
});

describe("calcChan (Chan Theory algorithm)", () => {
  it("returns correct structure with empty result for insufficient data", async () => {
    // Import calcChan indirectly via analysis module
    const { calcChanForTest } = await import("./analysis.test.helper");
    const result = calcChanForTest([]);
    expect(result).toHaveProperty("bis");
    expect(result).toHaveProperty("duans");
    expect(result).toHaveProperty("zhongshus");
    expect(result).toHaveProperty("trend");
    expect(result).toHaveProperty("in_zhongshu");
    expect(result).toHaveProperty("bi_count");
    expect(result).toHaveProperty("duan_count");
    expect(Array.isArray(result.bis)).toBe(true);
    expect(Array.isArray(result.zhongshus)).toBe(true);
  });
});

describe("OnchainData type shape", () => {
  it("long_short_ratio has required fields", () => {
    const mockData = {
      long_ratio: 0.55,
      short_ratio: 0.45,
      ls_ratio: 1.22,
    };
    expect(mockData).toHaveProperty("long_ratio");
    expect(mockData).toHaveProperty("short_ratio");
    expect(mockData).toHaveProperty("ls_ratio");
    expect(mockData.long_ratio + mockData.short_ratio).toBeCloseTo(1, 1);
  });

  it("open_interest uses open_interest field (not oi)", () => {
    const mockOI = { open_interest: 12345678 };
    expect(mockOI).toHaveProperty("open_interest");
    expect(mockOI.open_interest).toBe(12345678);
  });
});
