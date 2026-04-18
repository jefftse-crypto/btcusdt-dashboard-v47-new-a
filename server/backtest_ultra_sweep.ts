/**
 * backtest_ultra_sweep.ts — 多維度超級掃描
 *
 * 目標：找到 勝率 >80%, 天/筆 ≤ 3, 回報可觀 的策略組合
 *
 * 掃描維度：
 *   1. 幣對子集（單幣、2~4 幣組合、全部）
 *   2. 策略篩選（PA only / PA+HWR / 全策略）
 *   3. 閘門強度（核心通過 ≥7, ≥8; must-have 變體）
 *   4. 等級（S only / S+A）
 *   5. 額外過濾（時段、RSI 收緊、ATR 百分位收窄、C6 body 提高）
 */

import type { Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestTrade } from "./backtest.js";

const ALL_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT"];

const STRATEGIES: { key: string; strategy: BacktestStrategy; family: string; tp: number; sl: number; }[] = [
  { key: "pa_v4_focus",        strategy: "pa",          family: "pa",             tp: 0.5, sl: 1.95 },
  { key: "hwr_b_guarded",      strategy: "hwr_model_b", family: "trend_pullback", tp: 2,   sl: 1.5  },
  { key: "cannonball_guarded", strategy: "cannonball",  family: "structure",      tp: 2,   sl: 1.5  },
];

// ── Binance Futures 抓取 ──
async function fetchBinanceKlines(symbol: string, interval: string, target: number): Promise<Candle[]> {
  const out: Candle[] = [];
  const intervalMs = ({ "1h": 3600_000, "4h": 14400_000, "1d": 86400_000 } as any)[interval];
  if (!intervalMs) throw new Error("unsupported interval " + interval);
  const PAGE = 1500;
  let endTime = Date.now();
  while (out.length < target) {
    const need = Math.min(PAGE, target - out.length);
    const startTime = endTime - need * intervalMs;
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${need}&startTime=${startTime}&endTime=${endTime}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json() as any[];
    if (!Array.isArray(data) || data.length === 0) break;
    const batch: Candle[] = data.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
    out.unshift(...batch);
    if (data.length < need) break;
    endTime = batch[0].time * 1000 - 1;
    await new Promise(r => setTimeout(r, 200));
  }
  const seen = new Set<number>();
  const unique = out.filter(c => seen.has(c.time) ? false : (seen.add(c.time), true));
  unique.sort((a, b) => a.time - b.time);
  return unique;
}

// ── 指標計算 ──
function calcRsi14(closes: number[], idx: number): number {
  if (idx < 14) return 50;
  let g = 0, l = 0;
  for (let i = idx - 13; i <= idx; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  const rs = l > 0 ? (g / 14) / (l / 14) : 100;
  return 100 - 100 / (1 + rs);
}
function calcEma(v: number[], p: number): number[] {
  const e = [v[0]]; const k = 2 / (p + 1);
  for (let i = 1; i < v.length; i++) e.push(v[i] * k + e[i - 1] * (1 - k));
  return e;
}
function calcAtr(c: Candle[], idx: number, p = 14): number {
  const s = Math.max(1, idx - p + 1);
  let sum = 0, n = 0;
  for (let i = s; i <= idx; i++) {
    const h = c[i].high, l = c[i].low, pc = c[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    n++;
  }
  return n > 0 ? sum / n : c[idx].high - c[idx].low;
}

// ── 完整 8 項核心 + 3 項 PA 檢查 + 額外指標 ──
interface TradeEval {
  core_failed: string[];
  pa_failed: string[];
  session_hour: number;
  rsi1h: number;
  rsi4h: number;
  atr_pct: number;
  body_ratio: number;
  rvol: number;
  ema_atr_dist: number;
}

function evalTrade(t: BacktestTrade, c1h: Candle[], c4h: Candle[], family: string): TradeEval | null {
  const idx = c1h.findIndex(c => c.time >= t.entry_time);
  if (idx < 50) return null;
  const n = idx + 1;
  const cs = c1h.slice(0, n);
  const cl = cs.map(c => c.close);
  const last = cs[n - 1];
  const dir = t.direction;
  const core: string[] = [];
  const pa: string[] = [];

  const utc = new Date(t.entry_time * 1000).getUTCHours();
  if (!(utc >= 7 && utc < 22)) core.push("C1_session");

  let rsi4h = 50;
  const c4hUp = c4h.filter(c => c.time <= t.entry_time);
  if (c4hUp.length >= 25) {
    const cl4 = c4hUp.map(c => c.close);
    const e4 = calcEma(cl4, 20);
    const last4 = e4[e4.length - 1], prev4 = e4[e4.length - 2];
    const slopeOk = dir === "long" ? (last4 - prev4) >= 0 : (last4 - prev4) <= 0;
    const posOk = dir === "long" ? cl4[cl4.length - 1] >= last4 * 0.995 : cl4[cl4.length - 1] <= last4 * 1.005;
    if (!slopeOk || !posOk) core.push("C2_htf_trend");
    rsi4h = calcRsi14(cl4, cl4.length - 1);
  }

  const rsi1h = calcRsi14(cl, n - 1);
  const rsiOk = dir === "long" ? (rsi1h >= 42 && rsi1h <= 72) : (rsi1h >= 28 && rsi1h <= 58);
  if (!rsiOk) core.push("C3_rsi");

  const av = cs.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const rvol = av > 0 ? last.volume / av : 1;
  if (rvol < 0.9) core.push("C4_volume");

  const e20 = calcEma(cl, 20);
  const atr = calcAtr(cs, n - 1);
  const ad = atr > 0 ? Math.abs(last.close - e20[n - 1]) / atr : 0;
  if (ad > 1.8) core.push("C5_overextended");

  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const br = range > 0 ? body / range : 1;
  if (br < 0.35) core.push("C6_candle_form");

  if (n >= 2) {
    const r2 = cs.slice(-2);
    const al = r2.filter(c => dir === "long" ? c.close > c.open : c.close < c.open).length;
    if (al < 1) core.push("C7_momentum");
  }

  let atrPct = 50;
  if (n >= 50) {
    const ar: number[] = [];
    for (let i = Math.max(1, n - 50); i < n; i++) ar.push(calcAtr(cs, i));
    ar.sort((a, b) => a - b);
    atrPct = Math.round((ar.filter(a => a <= atr).length / ar.length) * 100);
    if (atrPct < 20 || atrPct > 88) core.push("C8_atr_health");
  }

  if (family === "pa") {
    if (!(dir === "long" ? last.close >= last.open : last.close <= last.open)) pa.push("PA1_candle_dir");
    if (!(dir === "long" ? rsi1h < 65 : rsi1h > 35)) pa.push("PA2_rsi_extreme");
    if (!(dir === "long" ? rsi4h > 45 : rsi4h < 55)) pa.push("PA3_4h_rsi");
  }

  return {
    core_failed: core, pa_failed: pa,
    session_hour: utc, rsi1h, rsi4h, atr_pct: atrPct, body_ratio: br, rvol, ema_atr_dist: ad,
  };
}

// ── 篩選配置 ──
interface FilterConfig {
  name: string;
  strategies: string[];          // 允許的策略 key
  min_core_pass: number;         // 核心最少通過數（S 級門檻）
  must_have: string[];           // 必須通過的核心項
  tier: "S" | "S+A";            // S only 或 S+A
  a_min_core_pass: number;       // A 級核心最少通過數
  pa_max_fail: number;           // PA 最大容錯
  // 額外過濾
  session_restrict: boolean;     // 限 London+NY (UTC 7-21)
  rsi_tighten: boolean;          // RSI 收緊 (long: 45-68, short: 32-55)
  atr_pct_min: number;           // ATR 百分位下限
  atr_pct_max: number;           // ATR 百分位上限
  body_min: number;              // K 線實體最低比例
  rvol_min: number;              // RVOL 最低值
}

function passFilter(ev: TradeEval, family: string, cfg: FilterConfig): { pass: boolean; tier: "S"|"A"|"-" } {
  // PA 檢查
  if (family === "pa") {
    if (ev.pa_failed.includes("PA1_candle_dir")) return { pass: false, tier: "-" };
    if (ev.pa_failed.length > cfg.pa_max_fail) return { pass: false, tier: "-" };
  }

  // 額外過濾
  if (cfg.session_restrict && !(ev.session_hour >= 7 && ev.session_hour < 21)) return { pass: false, tier: "-" };
  if (cfg.rsi_tighten) {
    // 更嚴格的 RSI 區間
    if (ev.rsi1h < 45 || ev.rsi1h > 68) return { pass: false, tier: "-" };
  }
  if (ev.atr_pct < cfg.atr_pct_min || ev.atr_pct > cfg.atr_pct_max) return { pass: false, tier: "-" };
  if (ev.body_ratio < cfg.body_min) return { pass: false, tier: "-" };
  if (ev.rvol < cfg.rvol_min) return { pass: false, tier: "-" };

  const cp = 8 - ev.core_failed.length;

  // S 級
  if (cp >= cfg.min_core_pass) return { pass: true, tier: "S" };

  // A 級
  if (cfg.tier === "S+A" && cp >= cfg.a_min_core_pass) {
    const blocked = cfg.must_have.filter(m => ev.core_failed.includes(m));
    if (blocked.length === 0) return { pass: true, tier: "A" };
  }

  return { pass: false, tier: "-" };
}

// ── 定義掃描配置 ──
const FILTERS: FilterConfig[] = [
  // === 基準 ===
  { name: "baseline_S_PA",     strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },
  { name: "baseline_SA_PA",    strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S+A", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === 超嚴格 S 級 (8/8) PA only ===
  { name: "ultra_strict_8of8_PA", strategies: ["pa_v4_focus"], min_core_pass: 8, must_have: [], tier: "S", a_min_core_pass: 99, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === S 級 + C6 must-have ===
  { name: "S_PA_c6must",       strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended","C6_candle_form"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === S 級 + C6 + C8 must-have ===
  { name: "S_PA_c6c8must",     strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended","C6_candle_form","C8_atr_health"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === S 級 + 時段限制 ===
  { name: "S_PA_session",      strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: true, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === S 級 + RSI 收緊 ===
  { name: "S_PA_rsi_tight",    strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: true, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === S 級 + ATR 收窄 (25-80) ===
  { name: "S_PA_atr_narrow",   strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 25, atr_pct_max: 80, body_min: 0.35, rvol_min: 0.9 },

  // === S 級 + body 提高 (0.45) ===
  { name: "S_PA_body45",       strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.45, rvol_min: 0.9 },

  // === S 級 + RVOL 提高 (1.1) ===
  { name: "S_PA_rvol11",       strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 1.1 },

  // === 組合：session + body45 + atr_narrow ===
  { name: "S_PA_combo1",       strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: true, rsi_tighten: false, atr_pct_min: 25, atr_pct_max: 80, body_min: 0.45, rvol_min: 0.9 },

  // === 組合：c6must + session + atr_narrow ===
  { name: "S_PA_combo2",       strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended","C6_candle_form"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: true, rsi_tighten: false, atr_pct_min: 25, atr_pct_max: 80, body_min: 0.35, rvol_min: 0.9 },

  // === 組合：c6must + rvol11 + body45 ===
  { name: "S_PA_combo3",       strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended","C6_candle_form"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.45, rvol_min: 1.1 },

  // === 全開：session + rsi_tight + atr_narrow + body45 + rvol11 ===
  { name: "S_PA_max_filter",   strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended","C6_candle_form"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: true, rsi_tighten: true, atr_pct_min: 25, atr_pct_max: 80, body_min: 0.45, rvol_min: 1.1 },

  // === PA + HWR 組合 ===
  { name: "S_PA_HWR",          strategies: ["pa_v4_focus","hwr_b_guarded"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === PA + HWR + C6 must ===
  { name: "S_PA_HWR_c6must",   strategies: ["pa_v4_focus","hwr_b_guarded"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended","C6_candle_form"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === S+A PA with C6 must-have ===
  { name: "SA_PA_c6must",      strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended","C6_candle_form"], tier: "S+A", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === S+A PA with C6+C8 must-have ===
  { name: "SA_PA_c6c8must",    strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended","C6_candle_form","C8_atr_health"], tier: "S+A", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },

  // === S+A PA + session + c6must ===
  { name: "SA_PA_c6_session",  strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended","C6_candle_form"], tier: "S+A", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: true, rsi_tighten: false, atr_pct_min: 20, atr_pct_max: 88, body_min: 0.35, rvol_min: 0.9 },
];

// ── 幣對組合 ──
// 高勝率候選幣對
const SYMBOL_COMBOS: { name: string; symbols: string[] }[] = [
  { name: "ALL_8", symbols: ALL_SYMBOLS },
  { name: "TOP4_PA", symbols: ["BTCUSDT","SOLUSDT","AVAXUSDT","ETHUSDT"] },
  { name: "TOP3_PA", symbols: ["SOLUSDT","AVAXUSDT","ETHUSDT"] },
  { name: "TOP5_PA", symbols: ["BTCUSDT","SOLUSDT","AVAXUSDT","ETHUSDT","DOGEUSDT"] },
  { name: "SOL_AVAX_ETH_DOGE", symbols: ["SOLUSDT","AVAXUSDT","ETHUSDT","DOGEUSDT"] },
  { name: "SOL_AVAX", symbols: ["SOLUSDT","AVAXUSDT"] },
  { name: "SOL_AVAX_ETH", symbols: ["SOLUSDT","AVAXUSDT","ETHUSDT"] },
  { name: "BTC_SOL_AVAX", symbols: ["BTCUSDT","SOLUSDT","AVAXUSDT"] },
  { name: "ETH_only", symbols: ["ETHUSDT"] },
  { name: "SOL_only", symbols: ["SOLUSDT"] },
  { name: "AVAX_only", symbols: ["AVAXUSDT"] },
  { name: "DOGE_only", symbols: ["DOGEUSDT"] },
  { name: "BTC_only", symbols: ["BTCUSDT"] },
  // 加入 BNB HWR 友好
  { name: "BNB_BTC_SOL", symbols: ["BNBUSDT","BTCUSDT","SOLUSDT"] },
  { name: "TOP6", symbols: ["BTCUSDT","SOLUSDT","AVAXUSDT","ETHUSDT","DOGEUSDT","XRPUSDT"] },
];

// ── 主程式 ──
interface TradeRecord {
  symbol: string;
  strategy: string;
  family: string;
  trade: BacktestTrade;
  eval: TradeEval;
}

async function main() {
  console.log("=== 多維度超級掃描回測 ===\n");

  // Step 1: 抓取所有幣對資料
  const allData: Map<string, { c1h: Candle[]; c4h: Candle[]; days: number }> = new Map();
  for (const sym of ALL_SYMBOLS) {
    process.stdout.write(`[${sym}] 抓取...`);
    try {
      const c1h = await fetchBinanceKlines(sym, "1h", 8760);
      const c4h = await fetchBinanceKlines(sym, "4h", 2200);
      const days = (c1h[c1h.length - 1].time - c1h[0].time) / 86400;
      allData.set(sym, { c1h, c4h, days });
      console.log(` 1H=${c1h.length} 4H=${c4h.length} (${days.toFixed(0)}天)`);
    } catch (e: any) {
      console.log(` 失敗: ${e.message}`);
    }
  }

  // Step 2: 對每個幣對 × 策略 跑回測，收集所有 trade + eval
  const allTrades: TradeRecord[] = [];
  for (const sym of ALL_SYMBOLS) {
    const d = allData.get(sym);
    if (!d) continue;
    for (const cfg of STRATEGIES) {
      try {
        const r = runBacktest({
          candles: d.c1h, strategy: cfg.strategy, symbol: sym, interval: "1h",
          atr_sl_mult: cfg.sl, atr_tp_mult: cfg.tp,
          enable_mtf_filter: true, enable_fee: true, enable_trailing_stop: false, enable_adx_filter: true,
        });
        for (const t of (r.trades ?? [])) {
          const ev = evalTrade(t, d.c1h, d.c4h, cfg.family);
          if (ev) allTrades.push({ symbol: sym, strategy: cfg.key, family: cfg.family, trade: t, eval: ev });
        }
      } catch {}
    }
  }
  console.log(`\n總原始 trade: ${allTrades.length}\n`);

  // Step 3: 對每個 (幣對組合 × 篩選配置) 計算結果
  interface Result {
    combo_name: string;
    filter_name: string;
    symbols: string[];
    total: number;
    wins: number;
    wr: number;
    pf: number;
    ret: number;
    dpt: number;
    s_total: number;
    s_wins: number;
    a_total: number;
    a_wins: number;
  }

  const results: Result[] = [];
  const days = allData.get("BTCUSDT")?.days ?? 365;

  for (const combo of SYMBOL_COMBOS) {
    for (const filter of FILTERS) {
      let total = 0, wins = 0, gp = 0, gl = 0, ret = 0;
      let sTotal = 0, sWins = 0, aTotal = 0, aWins = 0;

      for (const tr of allTrades) {
        if (!combo.symbols.includes(tr.symbol)) continue;
        if (!filter.strategies.includes(tr.strategy)) continue;

        const g = passFilter(tr.eval, tr.family, filter);
        if (!g.pass) continue;

        total++;
        ret += tr.trade.pnl_net_pct;
        if (tr.trade.pnl_net_pct > 0) { wins++; gp += tr.trade.pnl_net_pct; }
        else gl += Math.abs(tr.trade.pnl_net_pct);

        if (g.tier === "S") { sTotal++; if (tr.trade.pnl_net_pct > 0) sWins++; }
        else { aTotal++; if (tr.trade.pnl_net_pct > 0) aWins++; }
      }

      if (total >= 5) {
        results.push({
          combo_name: combo.name,
          filter_name: filter.name,
          symbols: combo.symbols,
          total, wins,
          wr: total > 0 ? wins / total * 100 : 0,
          pf: gl > 0 ? gp / gl : (gp > 0 ? 99 : 0),
          ret,
          dpt: total > 0 ? days / total : 999,
          s_total: sTotal, s_wins: sWins,
          a_total: aTotal, a_wins: aWins,
        });
      }
    }
  }

  // Step 4: 排序並輸出
  results.sort((a, b) => {
    // 優先勝率，次要天/筆
    if (Math.abs(a.wr - b.wr) > 0.1) return b.wr - a.wr;
    return a.dpt - b.dpt;
  });

  console.log("=".repeat(160));
  console.log("【掃描結果】勝率 >= 70% 且 筆數 >= 10");
  console.log("=".repeat(160));
  console.log(
    "排名".padEnd(5) +
    "幣對組合".padEnd(22) +
    "篩選配置".padEnd(26) +
    "筆數".padStart(6) +
    "勝".padStart(5) +
    "勝率".padStart(8) +
    "PF".padStart(7) +
    "天/筆".padStart(8) +
    "淨回報".padStart(10) +
    "S筆/勝".padStart(12) +
    "A筆/勝".padStart(12)
  );
  console.log("-".repeat(160));

  let rank = 0;
  const top70 = results.filter(r => r.wr >= 70 && r.total >= 10);
  for (const r of top70.slice(0, 80)) {
    rank++;
    console.log(
      `#${rank}`.padEnd(5) +
      r.combo_name.padEnd(22) +
      r.filter_name.padEnd(26) +
      r.total.toString().padStart(6) +
      r.wins.toString().padStart(5) +
      `${r.wr.toFixed(1)}%`.padStart(8) +
      r.pf.toFixed(2).padStart(7) +
      r.dpt.toFixed(1).padStart(8) +
      `${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(2)}%`.padStart(10) +
      `${r.s_total}/${r.s_wins}`.padStart(12) +
      `${r.a_total}/${r.a_wins}`.padStart(12)
    );
  }

  // 特別輸出：勝率 >= 75% 且 天/筆 <= 5
  console.log("\n" + "=".repeat(160));
  console.log("【★ 黃金組合】勝率 >= 75% 且 天/筆 <= 5 且 筆數 >= 10");
  console.log("=".repeat(160));
  const golden = results.filter(r => r.wr >= 75 && r.dpt <= 5 && r.total >= 10);
  rank = 0;
  for (const r of golden) {
    rank++;
    console.log(
      `#${rank}`.padEnd(5) +
      r.combo_name.padEnd(22) +
      r.filter_name.padEnd(26) +
      r.total.toString().padStart(6) +
      r.wins.toString().padStart(5) +
      `${r.wr.toFixed(1)}%`.padStart(8) +
      r.pf.toFixed(2).padStart(7) +
      r.dpt.toFixed(1).padStart(8) +
      `${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(2)}%`.padStart(10) +
      `${r.s_total}/${r.s_wins}`.padStart(12) +
      `${r.a_total}/${r.a_wins}`.padStart(12)
    );
  }

  // 特別輸出：勝率 >= 80%
  console.log("\n" + "=".repeat(160));
  console.log("【★★ 超級組合】勝率 >= 80% 且 筆數 >= 5");
  console.log("=".repeat(160));
  const super80 = results.filter(r => r.wr >= 80 && r.total >= 5);
  rank = 0;
  for (const r of super80) {
    rank++;
    console.log(
      `#${rank}`.padEnd(5) +
      r.combo_name.padEnd(22) +
      r.filter_name.padEnd(26) +
      r.total.toString().padStart(6) +
      r.wins.toString().padStart(5) +
      `${r.wr.toFixed(1)}%`.padStart(8) +
      r.pf.toFixed(2).padStart(7) +
      r.dpt.toFixed(1).padStart(8) +
      `${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(2)}%`.padStart(10) +
      `${r.s_total}/${r.s_wins}`.padStart(12) +
      `${r.a_total}/${r.a_wins}`.padStart(12)
    );
  }

  // 寫入 JSON
  const fs = await import("fs/promises");
  await fs.writeFile("/home/ubuntu/runtime/ultra_sweep_results.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    total_trades_scanned: allTrades.length,
    days,
    results: results.slice(0, 200),
  }, null, 2));
  console.log("\n結果已寫入 /home/ubuntu/runtime/ultra_sweep_results.json");
}

main().catch(console.error);
