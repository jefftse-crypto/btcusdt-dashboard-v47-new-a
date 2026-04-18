/**
 * backtest_expanded_sweep.ts — 擴大幣種回測掃描
 *
 * 在原有 8 幣對基礎上，加入 12 個熱門幣種（Binance Futures 交易量 Top 排名中
 * 有足夠歷史數據的主流幣），共 20 個幣對。
 *
 * 新增幣種：ADAUSDT, SUIUSDT, DOTUSDT, NEARUSDT, HYPEUSDT,
 *           TAOUSDT, ENAUSDT, WLDUSDT, 1000PEPEUSDT, ZECUSDT,
 *           AAVEUSDT, MATICUSDT
 */

import type { Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestTrade } from "./backtest.js";

// 原有 8 幣對
const ORIGINAL_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT"];

// 新增熱門幣種
const NEW_SYMBOLS = [
  "ADAUSDT",      // Cardano - 市值 Top 10
  "SUIUSDT",      // Sui - 2024-2025 熱門 L1
  "DOTUSDT",      // Polkadot - 老牌 L0
  "NEARUSDT",     // Near Protocol - AI 概念
  "HYPEUSDT",     // Hyperliquid - 2025 DeFi 熱門
  "TAOUSDT",      // Bittensor - AI 概念龍頭
  "ENAUSDT",      // Ethena - 2024-2025 DeFi 新星
  "WLDUSDT",      // Worldcoin - AI 概念
  "1000PEPEUSDT", // PEPE - Meme 龍頭
  "ZECUSDT",      // Zcash - 隱私幣
  "AAVEUSDT",     // Aave - DeFi 藍籌
  "TONUSDT",      // Toncoin - Telegram 生態
];

const ALL_SYMBOLS = [...ORIGINAL_SYMBOLS, ...NEW_SYMBOLS];

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

// ── 完整 8 項核心 + 3 項 PA 檢查 ──
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

// ── 篩選函數 ──
interface FilterConfig {
  name: string;
  strategies: string[];
  min_core_pass: number;
  must_have: string[];
  tier: "S" | "S+A";
  a_min_core_pass: number;
  pa_max_fail: number;
  session_restrict: boolean;
}

function passFilter(ev: TradeEval, family: string, cfg: FilterConfig): { pass: boolean; tier: "S"|"A"|"-" } {
  if (family === "pa") {
    if (ev.pa_failed.includes("PA1_candle_dir")) return { pass: false, tier: "-" };
    if (ev.pa_failed.length > cfg.pa_max_fail) return { pass: false, tier: "-" };
  }
  if (cfg.session_restrict && !(ev.session_hour >= 7 && ev.session_hour < 21)) return { pass: false, tier: "-" };

  const cp = 8 - ev.core_failed.length;
  if (cp >= cfg.min_core_pass) return { pass: true, tier: "S" };
  if (cfg.tier === "S+A" && cp >= cfg.a_min_core_pass) {
    const blocked = cfg.must_have.filter(m => ev.core_failed.includes(m));
    if (blocked.length === 0) return { pass: true, tier: "A" };
  }
  return { pass: false, tier: "-" };
}

// ── 篩選配置 ──
const FILTERS: FilterConfig[] = [
  { name: "S_PA",              strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false },
  { name: "S_PA_session",      strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: true },
  { name: "SA_PA",             strategies: ["pa_v4_focus"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S+A", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false },
  { name: "S_PA_HWR",          strategies: ["pa_v4_focus","hwr_b_guarded"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false },
  { name: "S_PA_HWR_session",  strategies: ["pa_v4_focus","hwr_b_guarded"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: true },
  { name: "ultra_8of8_PA",     strategies: ["pa_v4_focus"], min_core_pass: 8, must_have: [], tier: "S", a_min_core_pass: 99, pa_max_fail: 0, session_restrict: false },
  { name: "S_ALL3",            strategies: ["pa_v4_focus","hwr_b_guarded","cannonball_guarded"], min_core_pass: 7, must_have: ["C2_htf_trend","C4_volume","C5_overextended"], tier: "S", a_min_core_pass: 6, pa_max_fail: 0, session_restrict: false },
];

// ── 主程式 ──
interface TradeRecord {
  symbol: string;
  strategy: string;
  family: string;
  trade: BacktestTrade;
  eval: TradeEval;
}

interface SymbolStats {
  symbol: string;
  days: number;
  raw_signals: number;
  pa_s_trades: number;
  pa_s_wins: number;
  pa_s_wr: number;
  pa_sa_trades: number;
  pa_sa_wins: number;
  pa_sa_wr: number;
  hwr_s_trades: number;
  hwr_s_wins: number;
  hwr_s_wr: number;
  cb_s_trades: number;
  cb_s_wins: number;
  cb_s_wr: number;
}

async function main() {
  console.log("=== 擴大幣種回測掃描（20 幣對）===\n");

  const allData: Map<string, { c1h: Candle[]; c4h: Candle[]; days: number }> = new Map();
  const symbolStats: SymbolStats[] = [];

  for (const sym of ALL_SYMBOLS) {
    process.stdout.write(`[${sym}] 抓取...`);
    try {
      const c1h = await fetchBinanceKlines(sym, "1h", 8760);
      const c4h = await fetchBinanceKlines(sym, "4h", 2200);
      if (c1h.length < 200) { console.log(` 資料不足 (${c1h.length})`); continue; }
      const days = (c1h[c1h.length - 1].time - c1h[0].time) / 86400;
      allData.set(sym, { c1h, c4h, days });
      console.log(` 1H=${c1h.length} 4H=${c4h.length} (${days.toFixed(0)}天)`);
    } catch (e: any) {
      console.log(` 失敗: ${e.message}`);
    }
  }

  // 對每個幣對 × 策略 跑回測
  const allTrades: TradeRecord[] = [];
  const perSymbol: Map<string, TradeRecord[]> = new Map();

  for (const sym of ALL_SYMBOLS) {
    const d = allData.get(sym);
    if (!d) continue;
    const symTrades: TradeRecord[] = [];
    let rawTotal = 0;

    for (const cfg of STRATEGIES) {
      try {
        const r = runBacktest({
          candles: d.c1h, strategy: cfg.strategy, symbol: sym, interval: "1h",
          atr_sl_mult: cfg.sl, atr_tp_mult: cfg.tp,
          enable_mtf_filter: true, enable_fee: true, enable_trailing_stop: false, enable_adx_filter: true,
        });
        rawTotal += (r.trades ?? []).length;
        for (const t of (r.trades ?? [])) {
          const ev = evalTrade(t, d.c1h, d.c4h, cfg.family);
          if (ev) {
            const tr = { symbol: sym, strategy: cfg.key, family: cfg.family, trade: t, eval: ev };
            allTrades.push(tr);
            symTrades.push(tr);
          }
        }
      } catch {}
    }
    perSymbol.set(sym, symTrades);

    // 計算每幣對統計
    const paS = symTrades.filter(t => t.strategy === "pa_v4_focus" && (8 - t.eval.core_failed.length) >= 7 && !t.eval.pa_failed.includes("PA1_candle_dir") && t.eval.pa_failed.length === 0);
    const paSA = symTrades.filter(t => {
      if (t.strategy !== "pa_v4_focus") return false;
      if (t.eval.pa_failed.includes("PA1_candle_dir")) return false;
      if (t.eval.pa_failed.length > 0) return false;
      const cp = 8 - t.eval.core_failed.length;
      if (cp >= 7) return true;
      if (cp >= 6) {
        const blocked = ["C2_htf_trend","C4_volume","C5_overextended"].filter(m => t.eval.core_failed.includes(m));
        return blocked.length === 0;
      }
      return false;
    });
    const hwrS = symTrades.filter(t => t.strategy === "hwr_b_guarded" && (8 - t.eval.core_failed.length) >= 7);
    const cbS = symTrades.filter(t => t.strategy === "cannonball_guarded" && (8 - t.eval.core_failed.length) >= 7);

    symbolStats.push({
      symbol: sym,
      days: d.days,
      raw_signals: rawTotal,
      pa_s_trades: paS.length,
      pa_s_wins: paS.filter(t => t.trade.pnl_net_pct > 0).length,
      pa_s_wr: paS.length > 0 ? paS.filter(t => t.trade.pnl_net_pct > 0).length / paS.length * 100 : 0,
      pa_sa_trades: paSA.length,
      pa_sa_wins: paSA.filter(t => t.trade.pnl_net_pct > 0).length,
      pa_sa_wr: paSA.length > 0 ? paSA.filter(t => t.trade.pnl_net_pct > 0).length / paSA.length * 100 : 0,
      hwr_s_trades: hwrS.length,
      hwr_s_wins: hwrS.filter(t => t.trade.pnl_net_pct > 0).length,
      hwr_s_wr: hwrS.length > 0 ? hwrS.filter(t => t.trade.pnl_net_pct > 0).length / hwrS.length * 100 : 0,
      cb_s_trades: cbS.length,
      cb_s_wins: cbS.filter(t => t.trade.pnl_net_pct > 0).length,
      cb_s_wr: cbS.length > 0 ? cbS.filter(t => t.trade.pnl_net_pct > 0).length / cbS.length * 100 : 0,
    });
  }

  console.log(`\n總原始 trade: ${allTrades.length}\n`);

  // ── 各幣對統計表 ──
  console.log("=".repeat(140));
  console.log("【各幣對 × 策略 × S 級 勝率表】");
  console.log("=".repeat(140));
  console.log(
    "幣對".padEnd(16) + "天數".padStart(5) + "原始".padStart(6) +
    " PA-S筆".padStart(8) + " PA-S勝率".padStart(10) +
    " PA-SA筆".padStart(9) + " PA-SA勝率".padStart(11) +
    " HWR-S筆".padStart(9) + " HWR-S勝率".padStart(11) +
    " CB-S筆".padStart(8) + " CB-S勝率".padStart(10) +
    " 新/舊".padStart(6)
  );
  console.log("-".repeat(140));

  // 按 PA S 級勝率排序
  symbolStats.sort((a, b) => b.pa_s_wr - a.pa_s_wr);
  for (const s of symbolStats) {
    const isNew = NEW_SYMBOLS.includes(s.symbol) ? "★新" : "舊";
    console.log(
      s.symbol.padEnd(16) +
      s.days.toFixed(0).padStart(5) +
      s.raw_signals.toString().padStart(6) +
      s.pa_s_trades.toString().padStart(8) +
      `${s.pa_s_wr.toFixed(1)}%`.padStart(10) +
      s.pa_sa_trades.toString().padStart(9) +
      `${s.pa_sa_wr.toFixed(1)}%`.padStart(11) +
      s.hwr_s_trades.toString().padStart(9) +
      `${s.hwr_s_wr.toFixed(1)}%`.padStart(11) +
      s.cb_s_trades.toString().padStart(8) +
      `${s.cb_s_wr.toFixed(1)}%`.padStart(10) +
      isNew.padStart(6)
    );
  }

  // ── 找出高勝率新幣 ──
  console.log("\n" + "=".repeat(140));
  console.log("【★ 新幣種中 PA S 級勝率 >= 65% 且筆數 >= 3 的幣對】");
  console.log("=".repeat(140));
  const goodNew = symbolStats.filter(s => NEW_SYMBOLS.includes(s.symbol) && s.pa_s_wr >= 65 && s.pa_s_trades >= 3);
  goodNew.sort((a, b) => b.pa_s_wr - a.pa_s_wr);
  for (const s of goodNew) {
    console.log(`  ${s.symbol}: PA-S ${s.pa_s_trades}筆/${s.pa_s_wr.toFixed(1)}% | PA-SA ${s.pa_sa_trades}筆/${s.pa_sa_wr.toFixed(1)}% | HWR-S ${s.hwr_s_trades}筆/${s.hwr_s_wr.toFixed(1)}%`);
  }

  // ── 組合掃描 ──
  // 動態生成幣對組合：原有最佳 + 加入高勝率新幣
  const highWrSymbols = symbolStats.filter(s => s.pa_s_wr >= 70 && s.pa_s_trades >= 3).map(s => s.symbol);
  const medWrSymbols = symbolStats.filter(s => s.pa_s_wr >= 65 && s.pa_s_trades >= 3).map(s => s.symbol);
  const newHighWr = symbolStats.filter(s => NEW_SYMBOLS.includes(s.symbol) && s.pa_s_wr >= 65 && s.pa_s_trades >= 3).map(s => s.symbol);

  const COMBOS: { name: string; symbols: string[] }[] = [
    // 原有最佳
    { name: "ORIG_BTC_SOL_AVAX", symbols: ["BTCUSDT","SOLUSDT","AVAXUSDT"] },
    { name: "ORIG_TOP4", symbols: ["BTCUSDT","SOLUSDT","AVAXUSDT","ETHUSDT"] },
    { name: "ORIG_8", symbols: ORIGINAL_SYMBOLS },
    // 原有最佳 + 新幣
    { name: "ORIG3+NEW_HIGH", symbols: [...new Set(["BTCUSDT","SOLUSDT","AVAXUSDT", ...newHighWr])] },
    { name: "ORIG4+NEW_HIGH", symbols: [...new Set(["BTCUSDT","SOLUSDT","AVAXUSDT","ETHUSDT", ...newHighWr])] },
    { name: "ORIG8+NEW_HIGH", symbols: [...new Set([...ORIGINAL_SYMBOLS, ...newHighWr])] },
    // 全高勝率
    { name: "ALL_HIGH_WR70", symbols: highWrSymbols },
    { name: "ALL_MED_WR65", symbols: medWrSymbols },
    // 全部 20 幣
    { name: "ALL_20", symbols: ALL_SYMBOLS.filter(s => allData.has(s)) },
    // 只有新幣
    { name: "NEW_ONLY", symbols: newHighWr },
    // 特殊組合
    { name: "BNB_BTC_SOL+NEW", symbols: [...new Set(["BNBUSDT","BTCUSDT","SOLUSDT", ...newHighWr])] },
  ];

  const days = allData.get("BTCUSDT")?.days ?? 365;

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

  for (const combo of COMBOS) {
    for (const filter of FILTERS) {
      let total = 0, wins = 0, gp = 0, gl = 0, ret = 0;
      let sTotal = 0, sWins = 0, aTotal = 0, aWins = 0;

      for (const tr of allTrades) {
        if (!combo.symbols.includes(tr.symbol)) continue;
        if (!filter.strategies.includes(tr.strategy)) continue;
        const g = passFilter(tr.eval, tr.family, filter);
        if (!g.pass) continue;
        total++; ret += tr.trade.pnl_net_pct;
        if (tr.trade.pnl_net_pct > 0) { wins++; gp += tr.trade.pnl_net_pct; }
        else gl += Math.abs(tr.trade.pnl_net_pct);
        if (g.tier === "S") { sTotal++; if (tr.trade.pnl_net_pct > 0) sWins++; }
        else { aTotal++; if (tr.trade.pnl_net_pct > 0) aWins++; }
      }

      if (total >= 5) {
        results.push({
          combo_name: combo.name, filter_name: filter.name, symbols: combo.symbols,
          total, wins, wr: total > 0 ? wins / total * 100 : 0,
          pf: gl > 0 ? gp / gl : (gp > 0 ? 99 : 0), ret,
          dpt: total > 0 ? days / total : 999,
          s_total: sTotal, s_wins: sWins, a_total: aTotal, a_wins: aWins,
        });
      }
    }
  }

  results.sort((a, b) => Math.abs(a.wr - b.wr) > 0.1 ? b.wr - a.wr : a.dpt - b.dpt);

  // ── 輸出 80~90% 勝率區間 ──
  console.log("\n" + "=".repeat(160));
  console.log("【★★ 勝率 80~90% 區間】所有組合（筆數 >= 5）");
  console.log("=".repeat(160));
  console.log(
    "排名".padEnd(5) + "幣對組合".padEnd(24) + "篩選配置".padEnd(24) +
    "筆數".padStart(6) + "勝".padStart(5) + "勝率".padStart(8) +
    "PF".padStart(7) + "天/筆".padStart(8) + "淨回報".padStart(10) +
    "  幣對清單"
  );
  console.log("-".repeat(160));

  const band80_90 = results.filter(r => r.wr >= 80 && r.wr < 90 && r.total >= 5);
  for (let i = 0; i < band80_90.length; i++) {
    const r = band80_90[i];
    const syms = r.symbols.join(",");
    console.log(
      `#${i+1}`.padEnd(5) + r.combo_name.padEnd(24) + r.filter_name.padEnd(24) +
      r.total.toString().padStart(6) + r.wins.toString().padStart(5) +
      `${r.wr.toFixed(1)}%`.padStart(8) + r.pf.toFixed(2).padStart(7) +
      r.dpt.toFixed(1).padStart(8) + `${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(2)}%`.padStart(10) +
      `  ${syms}`
    );
  }

  // ── 輸出 >= 90% ──
  console.log("\n" + "=".repeat(160));
  console.log("【★★★ 勝率 >= 90%】所有組合（筆數 >= 5）");
  console.log("=".repeat(160));
  const above90 = results.filter(r => r.wr >= 90 && r.total >= 5);
  for (let i = 0; i < above90.length; i++) {
    const r = above90[i];
    const syms = r.symbols.join(",");
    console.log(
      `#${i+1}`.padEnd(5) + r.combo_name.padEnd(24) + r.filter_name.padEnd(24) +
      r.total.toString().padStart(6) + r.wins.toString().padStart(5) +
      `${r.wr.toFixed(1)}%`.padStart(8) + r.pf.toFixed(2).padStart(7) +
      r.dpt.toFixed(1).padStart(8) + `${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(2)}%`.padStart(10) +
      `  ${syms}`
    );
  }

  // ── 對比：加入新幣 vs 不加 ──
  console.log("\n" + "=".repeat(160));
  console.log("【對比】加入熱門幣種前後的改良");
  console.log("=".repeat(160));

  for (const filter of FILTERS) {
    const orig = results.find(r => r.combo_name === "ORIG_BTC_SOL_AVAX" && r.filter_name === filter.name);
    const expanded = results.find(r => r.combo_name === "ORIG3+NEW_HIGH" && r.filter_name === filter.name);
    if (orig && expanded) {
      console.log(`\n${filter.name}:`);
      console.log(`  原有(BTC+SOL+AVAX):  筆=${orig.total} 勝率=${orig.wr.toFixed(1)}% 天/筆=${orig.dpt.toFixed(1)} PF=${orig.pf.toFixed(2)} 回報=${orig.ret.toFixed(2)}%`);
      console.log(`  +新幣:               筆=${expanded.total} 勝率=${expanded.wr.toFixed(1)}% 天/筆=${expanded.dpt.toFixed(1)} PF=${expanded.pf.toFixed(2)} 回報=${expanded.ret.toFixed(2)}%`);
      const dptImprove = orig.dpt > 0 ? ((orig.dpt - expanded.dpt) / orig.dpt * 100).toFixed(1) : "N/A";
      console.log(`  頻率改善: ${dptImprove}% | 勝率變化: ${(expanded.wr - orig.wr).toFixed(1)}%`);
    }
  }

  // 寫入 JSON
  const fs = await import("fs/promises");
  await fs.writeFile("/home/ubuntu/runtime/expanded_sweep_results.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    total_symbols: allData.size,
    original_symbols: ORIGINAL_SYMBOLS,
    new_symbols: NEW_SYMBOLS.filter(s => allData.has(s)),
    symbol_stats: symbolStats,
    total_trades: allTrades.length,
    days,
    combos: COMBOS,
    results: results.slice(0, 300),
  }, null, 2));
  console.log("\n結果已寫入 /home/ubuntu/runtime/expanded_sweep_results.json");
}

main().catch(console.error);
