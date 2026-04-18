/**
 * backtest_year_diagnostic.ts — 一年期 v4.6 雙閘門 多幣對 + 失敗診斷
 *
 * 1. 用 v4.6 雙閘門對 8 個幣對跑 365 天回測
 * 2. 統計 S 級 / A 級 / 拒絕的明細
 * 3. 對每個敗單記錄失敗的核心檢查項，分析系統性弱點
 */

import { fetchCandles, fetchCandlesPaged, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestTrade } from "./backtest.js";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT"];

const STRATEGIES: { key: string; strategy: BacktestStrategy; family: string; tp: number; sl: number; }[] = [
  { key: "pa_v4_focus",        strategy: "pa",          family: "pa",             tp: 0.5, sl: 1.95 },
  { key: "hwr_b_guarded",      strategy: "hwr_model_b", family: "trend_pullback", tp: 2,   sl: 1.5  },
  { key: "cannonball_guarded", strategy: "cannonball",  family: "structure",      tp: 2,   sl: 1.5  },
];

const MUST_HAVE = ["C2_htf_trend", "C4_volume", "C5_overextended"];

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

function evalChecks(t: BacktestTrade, c1h: Candle[], c4h: Candle[], family: string) {
  const idx = c1h.findIndex(c => c.time >= t.entry_time);
  if (idx < 50) return { core: [] as string[], pa: [] as string[] };
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

  if (n >= 50) {
    const ar: number[] = [];
    for (let i = Math.max(1, n - 50); i < n; i++) ar.push(calcAtr(cs, i));
    ar.sort((a, b) => a - b);
    const pct = Math.round((ar.filter(a => a <= atr).length / ar.length) * 100);
    if (pct < 20 || pct > 88) core.push("C8_atr_health");
  }

  if (family === "pa") {
    if (!(dir === "long" ? last.close >= last.open : last.close <= last.open)) pa.push("PA1_candle_dir");
    if (!(dir === "long" ? rsi1h < 65 : rsi1h > 35)) pa.push("PA2_rsi_extreme");
    if (!(dir === "long" ? rsi4h > 45 : rsi4h < 55)) pa.push("PA3_4h_rsi");
  }
  return { core, pa };
}

function gateBalanced(coreF: string[], paF: string[], family: string): { pass: boolean; tier: "S"|"A"|"-" } {
  const cp = 8 - coreF.length;
  if (family === "pa") {
    if (paF.includes("PA1_candle_dir")) return { pass: false, tier: "-" };
    if (paF.length > 1) return { pass: false, tier: "-" };
  }
  if (cp >= 7) return { pass: true, tier: "S" };
  if (cp >= 6) {
    const blocked = MUST_HAVE.filter(m => coreF.includes(m));
    if (blocked.length === 0) return { pass: true, tier: "A" };
  }
  return { pass: false, tier: "-" };
}
function gateStrict(coreF: string[], paF: string[]): boolean {
  return coreF.length <= 1 && paF.length === 0;
}

interface PerStrat { trades: number; wins: number; S: number; Sw: number; A: number; Aw: number; }
interface SymbolReport {
  symbol: string;
  days: number;
  raw_signals: number;
  strict: { total: number; wins: number; wr: number; pf: number; ret: number; dpt: number; };
  balanced: {
    total: number; S: number; Sw: number; A: number; Aw: number;
    wins: number; wr: number; sWr: number; aWr: number; pf: number; ret: number; dpt: number;
    by_strategy: Record<string, PerStrat>;
    fail_reasons_for_losses: Record<string, number>; // 敗單時最常通過的「邊緣」失敗組合
    avg_core_pass_win: number;
    avg_core_pass_loss: number;
  };
}

async function main() {
  console.log("=== v4.6 雙閘門 一年期 多幣對回測 + 失敗診斷 ===\n");
  // 一年 = 8760 根 1H，但 Kraken 720 根 / 請求；逐次抓並累積
  // 簡化：一次抓最大量 720 根 4H = 120 天，再抓 1h 720 根（30 天）會不夠
  // 改用：1h 取 5000 根 (~208 天)，4h 取 2160 根 (~360 天) — 取較少者為樣本期
  // Kraken 公開 API 上限是 720 根；我們需要分頁累積
  // 為簡化此次分析，使用單次最大可取的 720 根 1H + 720 根 4H
  // 但 720 1H 只有 30 天太短，改用 4H 資料 + 同等價策略
  // 折中方案：用 1H 720 + 4H 720 一輪，但回測時用「滑動樣本」方式重複多次
  // 實務上：先抓最大限額，若可以分頁就分頁

  const reports: SymbolReport[] = [];

  for (const sym of SYMBOLS) {
    process.stdout.write(`\n[${sym}] 抑取一年資料（分頁）...`);
    let c1h: Candle[] = [], c4h: Candle[] = [];
    try {
      // 使用分頁 API 抽一年資料
      c1h = await fetchCandlesPaged(sym, "1h", 8760);
      c4h = await fetchCandlesPaged(sym, "4h", 2200);
    } catch (e) {
      console.log(`抑取失敗: ${e}`);
      continue;
    }    const days = (c1h[c1h.length - 1].time - c1h[0].time) / 3600 / 24;
    console.log(` ${c1h.length} 根 1H (${days.toFixed(0)} 天) | ${c4h.length} 根 4H`);

    // strict 統計
    let sT = 0, sW = 0, sGp = 0, sGl = 0, sR = 0;
    // balanced 統計
    let bT = 0, bS = 0, bSw = 0, bA = 0, bAw = 0, bW = 0, bGp = 0, bGl = 0, bR = 0;
    let rawTotal = 0;
    const byStrat: Record<string, PerStrat> = {};
    const failReasons: Record<string, number> = {};
    let coreSumWin = 0, coreCntWin = 0, coreSumLoss = 0, coreCntLoss = 0;

    for (const cfg of STRATEGIES) {
      byStrat[cfg.key] = { trades: 0, wins: 0, S: 0, Sw: 0, A: 0, Aw: 0 };
      try {
        const r = runBacktest({
          candles: c1h, strategy: cfg.strategy, symbol: sym, interval: "1h",
          atr_sl_mult: cfg.sl, atr_tp_mult: cfg.tp,
          enable_mtf_filter: true, enable_fee: true, enable_trailing_stop: false, enable_adx_filter: true,
        });
        const trades = r.trades ?? [];
        rawTotal += trades.length;
        for (const t of trades) {
          const e = evalChecks(t, c1h, c4h, cfg.family);
          // strict
          if (gateStrict(e.core, e.pa)) {
            sT++; sR += t.pnl_net_pct;
            if (t.pnl_net_pct > 0) { sW++; sGp += t.pnl_net_pct; }
            else { sGl += Math.abs(t.pnl_net_pct); }
          }
          // balanced
          const g = gateBalanced(e.core, e.pa, cfg.family);
          if (g.pass) {
            bT++; bR += t.pnl_net_pct;
            byStrat[cfg.key].trades++;
            const corePass = 8 - e.core.length;
            if (t.pnl_net_pct > 0) {
              bW++; bGp += t.pnl_net_pct;
              byStrat[cfg.key].wins++;
              coreSumWin += corePass; coreCntWin++;
            } else {
              bGl += Math.abs(t.pnl_net_pct);
              coreSumLoss += corePass; coreCntLoss++;
              // 記錄敗單最常通過時還失敗了哪些次要項
              for (const f of e.core) failReasons[f] = (failReasons[f] || 0) + 1;
              for (const f of e.pa) failReasons[f] = (failReasons[f] || 0) + 1;
            }
            if (g.tier === "S") {
              bS++; byStrat[cfg.key].S++;
              if (t.pnl_net_pct > 0) { bSw++; byStrat[cfg.key].Sw++; }
            } else {
              bA++; byStrat[cfg.key].A++;
              if (t.pnl_net_pct > 0) { bAw++; byStrat[cfg.key].Aw++; }
            }
          }
        }
      } catch (e) {
        // skip
      }
    }

    const sWR = sT > 0 ? sW / sT * 100 : 0;
    const sPF = sGl > 0 ? sGp / sGl : (sGp > 0 ? 99 : 0);
    const sDPT = sT > 0 ? days / sT : Infinity;
    const bWR = bT > 0 ? bW / bT * 100 : 0;
    const bSWR = bS > 0 ? bSw / bS * 100 : 0;
    const bAWR = bA > 0 ? bAw / bA * 100 : 0;
    const bPF = bGl > 0 ? bGp / bGl : (bGp > 0 ? 99 : 0);
    const bDPT = bT > 0 ? days / bT : Infinity;

    reports.push({
      symbol: sym, days, raw_signals: rawTotal,
      strict: { total: sT, wins: sW, wr: sWR, pf: sPF, ret: sR, dpt: sDPT },
      balanced: {
        total: bT, S: bS, Sw: bSw, A: bA, Aw: bAw, wins: bW,
        wr: bWR, sWr: bSWR, aWr: bAWR, pf: bPF, ret: bR, dpt: bDPT,
        by_strategy: byStrat,
        fail_reasons_for_losses: failReasons,
        avg_core_pass_win: coreCntWin > 0 ? coreSumWin / coreCntWin : 0,
        avg_core_pass_loss: coreCntLoss > 0 ? coreSumLoss / coreCntLoss : 0,
      },
    });
  }

  // ── 主結果表 ──
  console.log("\n" + "=".repeat(120));
  console.log("【總表】v4.6 balanced（S+A）vs v4.5 strict 一年回測");
  console.log("=".repeat(120));
  console.log("幣對".padEnd(11) + "天數".padStart(6) + "原始".padStart(7) +
              "strict筆".padStart(10) + "strict勝".padStart(10) +
              "bal筆".padStart(8) + "S筆".padStart(6) + "A筆".padStart(6) +
              "整體勝".padStart(9) + "S勝率".padStart(9) + "A勝率".padStart(9) +
              "PF".padStart(7) + "天/筆".padStart(8));
  console.log("-".repeat(120));
  for (const r of reports) {
    const pct = (n: number) => n.toFixed(1) + "%";
    console.log(
      r.symbol.padEnd(11) +
      r.days.toFixed(0).padStart(6) +
      r.raw_signals.toString().padStart(7) +
      r.strict.total.toString().padStart(10) +
      pct(r.strict.wr).padStart(10) +
      r.balanced.total.toString().padStart(8) +
      r.balanced.S.toString().padStart(6) +
      r.balanced.A.toString().padStart(6) +
      pct(r.balanced.wr).padStart(9) +
      pct(r.balanced.sWr).padStart(9) +
      pct(r.balanced.aWr).padStart(9) +
      r.balanced.pf.toFixed(2).padStart(7) +
      (r.balanced.dpt === Infinity ? "—" : r.balanced.dpt.toFixed(2)).padStart(8)
    );
  }
  console.log("=".repeat(120));

  // ── 各幣對策略明細 ──
  console.log("\n【各幣對 × 策略 明細（balanced 模式）】");
  for (const r of reports) {
    if (r.balanced.total === 0) continue;
    console.log(`\n[${r.symbol}] ${r.days.toFixed(0)} 天 | 整體 ${r.balanced.total} 筆 / 勝率 ${r.balanced.wr.toFixed(1)}%`);
    for (const [k, v] of Object.entries(r.balanced.by_strategy)) {
      if (v.trades === 0) { console.log(`   ${k.padEnd(22)} 0 筆`); continue; }
      const wr = v.trades > 0 ? v.wins / v.trades * 100 : 0;
      const sWr = v.S > 0 ? v.Sw / v.S * 100 : 0;
      const aWr = v.A > 0 ? v.Aw / v.A * 100 : 0;
      console.log(`   ${k.padEnd(22)} ${v.trades.toString().padStart(3)}筆 (S=${v.S}/${sWr.toFixed(0)}%  A=${v.A}/${aWr.toFixed(0)}%) | 整體 ${wr.toFixed(1)}%`);
    }
  }

  // ── 失敗診斷 ──
  console.log("\n" + "=".repeat(120));
  console.log("【失敗診斷】勝率不足幣對的問題分析");
  console.log("=".repeat(120));
  const failed = reports.filter(r => r.balanced.total >= 5 && r.balanced.wr < 60);
  if (failed.length === 0) {
    console.log("（沒有勝率明顯不足的幣對）");
  } else {
    for (const r of failed) {
      console.log(`\n▶ ${r.symbol}（勝率 ${r.balanced.wr.toFixed(1)}% / ${r.balanced.total} 筆）`);
      console.log(`  S 級勝率 ${r.balanced.sWr.toFixed(1)}% (${r.balanced.S} 筆) | A 級勝率 ${r.balanced.aWr.toFixed(1)}% (${r.balanced.A} 筆)`);
      console.log(`  勝單平均核心通過數 ${r.balanced.avg_core_pass_win.toFixed(2)}/8 | 敗單平均通過數 ${r.balanced.avg_core_pass_loss.toFixed(2)}/8`);
      console.log(`  敗單最常缺項 (Top 5)：`);
      const sorted = Object.entries(r.balanced.fail_reasons_for_losses).sort((a, b) => b[1] - a[1]).slice(0, 5);
      for (const [k, v] of sorted) console.log(`    ${k.padEnd(22)} ${v} 次`);

      // 各策略表現
      console.log(`  策略勝率：`);
      for (const [k, v] of Object.entries(r.balanced.by_strategy)) {
        if (v.trades > 0) {
          console.log(`    ${k.padEnd(22)} ${v.trades} 筆 / 勝率 ${(v.wins / v.trades * 100).toFixed(1)}%`);
        }
      }
    }
  }

  // ── 多幣對組合（勝率 ≥ 75% 才納入）──
  console.log("\n" + "=".repeat(120));
  console.log("【建議組合】（balanced 勝率 ≥ 75%）");
  console.log("=".repeat(120));
  const inc = reports.filter(r => r.balanced.wr >= 75 && r.balanced.total >= 3);
  const sumT = inc.reduce((s, r) => s + r.balanced.total, 0);
  const sumW = inc.reduce((s, r) => s + r.balanced.wins, 0);
  const sumR = inc.reduce((s, r) => s + r.balanced.ret, 0);
  const days0 = reports[0]?.days ?? 365;
  console.log(`納入 ${inc.length} 個幣對：${inc.map(r => r.symbol).join(", ")}`);
  console.log(`合計：${sumT} 筆 / 勝率 ${sumT > 0 ? (sumW / sumT * 100).toFixed(1) : 0}% / 淨回報 ${sumR >= 0 ? '+' : ''}${sumR.toFixed(3)}% / ${sumT > 0 ? (days0 / sumT).toFixed(2) : '—'} 天/筆`);

  // ── S 級單獨組合（最高勝率精選）──
  console.log("\n【S 級單獨統計】（只交易 S 級信號的純高勝率組合）");
  let sumST = 0, sumSW = 0;
  for (const r of reports) { sumST += r.balanced.S; sumSW += r.balanced.Sw; }
  console.log(`8 幣對合計 S 級：${sumST} 筆 / 勝率 ${sumST > 0 ? (sumSW / sumST * 100).toFixed(1) : 0}% / 約 ${sumST > 0 ? (days0 / sumST).toFixed(2) : '—'} 天/筆`);

  // 寫檔
  const fs = await import("fs/promises");
  await fs.writeFile("/home/ubuntu/runtime/year_diagnostic.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    reports,
  }, null, 2));
  console.log("\n結果已寫入 /home/ubuntu/runtime/year_diagnostic.json");
}

main().catch(console.error);
