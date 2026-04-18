/**
 * run_score_tp_scan.ts
 * 套用報告建議的 score8.5+bonus1.5 軟回踩過濾
 * 搭配多個 TP 倍數掃描，找出一年完整回測中真正能盈利的組合
 */
import { readFileSync, writeFileSync } from "fs";
import { runBacktest, type Candle } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS, type LivePreset } from "./live_btcusdt_strategy_presets.js";

// ── 複製 applyPaFilter 所需的輔助函數 ──

function calcAtr(candles: Candle[], idx: number): number {
  const start = Math.max(1, idx - 13);
  let sum = 0, count = 0;
  for (let i = start; i <= idx; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    count++;
  }
  return count > 0 ? sum / count : candles[idx].high - candles[idx].low;
}

function checkRetestConfirmation(
  candles: Candle[], idx: number,
  direction: "long" | "short",
  entryPrice: number, atr: number,
  retestMode: string, lookbackBars: number,
  touchToleranceAtr: number, reclaimOffsetAtr: number,
  requireCandleColor: boolean
): boolean {
  const lookback = Math.min(lookbackBars, idx);
  const touchTol  = atr * touchToleranceAtr;
  const reclaimOff = atr * reclaimOffsetAtr;
  for (let j = idx - lookback; j <= idx; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (direction === "long") {
      const touched   = c.low  <= entryPrice + touchTol;
      const reclaimed = c.close >= entryPrice - reclaimOff;
      const colorOk   = !requireCandleColor || c.close >= c.open;
      if (retestMode === "same_bar") {
        if (touched && reclaimed && colorOk) return true;
      } else if (retestMode === "next_bar_confirm") {
        if (touched && j + 1 <= idx) {
          const nx = candles[j + 1];
          if (nx.close >= entryPrice - reclaimOff && (!requireCandleColor || nx.close >= nx.open)) return true;
        }
      } else {
        if (touched && reclaimed && colorOk) return true;
        if (touched && j + 1 <= idx) {
          const nx = candles[j + 1];
          if (nx.close >= entryPrice - reclaimOff && (!requireCandleColor || nx.close >= nx.open)) return true;
        }
      }
    } else {
      const touched   = c.high >= entryPrice - touchTol;
      const reclaimed = c.close <= entryPrice + reclaimOff;
      const colorOk   = !requireCandleColor || c.close <= c.open;
      if (retestMode === "same_bar") {
        if (touched && reclaimed && colorOk) return true;
      } else if (retestMode === "next_bar_confirm") {
        if (touched && j + 1 <= idx) {
          const nx = candles[j + 1];
          if (nx.close <= entryPrice + reclaimOff && (!requireCandleColor || nx.close <= nx.open)) return true;
        }
      } else {
        if (touched && reclaimed && colorOk) return true;
        if (touched && j + 1 <= idx) {
          const nx = candles[j + 1];
          if (nx.close <= entryPrice + reclaimOff && (!requireCandleColor || nx.close <= nx.open)) return true;
        }
      }
    }
  }
  return false;
}

function checkDualTfResonance(
  candles: Candle[], idx: number,
  direction: "long" | "short",
  biasWindowBars: number, minScore: number,
  requireKeyLevel: boolean, requireMomentum: boolean,
  allTrades: Array<{ direction: string; entry_time: number; entry_price: number }>
): boolean {
  if (idx < biasWindowBars + 5) return false;
  const recentCandles = candles.slice(Math.max(0, idx - biasWindowBars), idx + 1);
  let bullCount = 0, bearCount = 0;
  for (const rc of recentCandles) {
    if (rc.close > rc.open) bullCount++; else bearCount++;
  }
  if (direction === "long"  && bullCount <= bearCount) return false;
  if (direction === "short" && bearCount <= bullCount) return false;
  let score = 50;
  const c = candles[idx], prevC = candles[idx - 1];
  if (direction === "long"  && c.close > prevC.close) score += 20;
  if (direction === "short" && c.close < prevC.close) score += 20;
  const slice10 = candles.slice(Math.max(0, idx - 9), idx + 1);
  const high10 = Math.max(...slice10.map(c => c.high));
  const low10  = Math.min(...slice10.map(c => c.low));
  const range10 = high10 - low10;
  if (range10 > 0) {
    const pos = (c.close - low10) / range10;
    if (direction === "long"  && pos > 0.6) score += 15;
    if (direction === "short" && pos < 0.4) score += 15;
  }
  return score >= minScore;
}

function isInSession(candleTime: number, mode: string | undefined): boolean {
  if (!mode || mode === "all") return true;
  const utcHour = new Date(candleTime).getUTCHours();
  if (mode === "exclude_offhours") return !(utcHour >= 0 && utcHour < 6);
  if (mode === "london_newyork")   return (utcHour >= 7 && utcHour <= 22);
  return true;
}

// ── 核心過濾函數（帶軟回踩評分覆蓋）──
function applyFilterWithScore(
  preset: LivePreset,
  candles: Candle[],
  trade: { direction: string; entry_price: number; entry_time: number; entry_type?: string; signal_score?: number },
  allTrades: Array<{ direction: string; entry_time: number; entry_price: number }>,
  lastDir: Map<string, string>,
  // 覆蓋參數
  overrideMinScore?: number,
  overrideBonus?: number,
  overrideTouchTol?: number
): { pass: boolean; reason?: string } {
  // session 過濾
  if (!isInSession(trade.entry_time, preset.pa_session_mode)) {
    return { pass: false, reason: `非交易時段` };
  }
  let idx = candles.findIndex(c => c.time >= trade.entry_time);
  if (idx < 0) idx = candles.length - 1;
  const atr = calcAtr(candles, idx);

  // entry_type 過濾
  if (trade.entry_type === "PA_PATTERN"       && !preset.pa_allow_pattern)       return { pass: false, reason: "PA_PATTERN 被過濾" };
  if (trade.entry_type === "PA_TRUE_BREAKOUT" && !preset.pa_allow_true_breakout) return { pass: false, reason: "PA_TRUE_BREAKOUT 被過濾" };
  if (trade.entry_type === "PA_2ND_LEG_TRAP"  && !preset.pa_allow_trap)          return { pass: false, reason: "PA_2ND_LEG_TRAP 被過濾" };

  // pa_require_retest_on_continuation
  if (preset.pa_require_retest_on_continuation) {
    const prevDir = lastDir.get(preset.key);
    if (prevDir && prevDir === trade.direction) {
      const retestOk = checkRetestConfirmation(
        candles, idx, trade.direction as "long" | "short",
        trade.entry_price, atr,
        preset.pa_retest_mode, preset.pa_retest_lookback_bars,
        preset.pa_retest_touch_tolerance_atr, preset.pa_retest_reclaim_offset_atr,
        preset.pa_retest_require_candle_color
      );
      if (!retestOk) return { pass: false, reason: "連續同向未通過回測確認" };
    }
  }

  // 軟回踩評分過濾（使用覆蓋參數）
  const useMinScore = overrideMinScore ?? preset.pa_retest_soft_min_score ?? 7.0;
  const useBonus    = overrideBonus    ?? preset.pa_retest_soft_bonus    ?? 0.5;
  const useTouchTol = overrideTouchTol ?? preset.pa_retest_touch_tolerance_atr ?? 0.08;

  if (trade.signal_score !== undefined) {
    const hasRetest = checkRetestConfirmation(
      candles, idx, trade.direction as "long" | "short",
      trade.entry_price, atr,
      preset.pa_retest_mode, preset.pa_retest_lookback_bars,
      useTouchTol, preset.pa_retest_reclaim_offset_atr,
      preset.pa_retest_require_candle_color
    );
    const effectiveScore = trade.signal_score + (hasRetest ? useBonus : 0);
    if (effectiveScore < useMinScore) {
      return { pass: false, reason: `評分 ${effectiveScore.toFixed(1)} < ${useMinScore}` };
    }
  }

  // pa_dual_tf_resonance
  if (preset.pa_dual_tf_resonance) {
    const resonanceOk = checkDualTfResonance(
      candles, idx, trade.direction as "long" | "short",
      preset.pa_resonance_bias_window_bars ?? 2,
      preset.pa_resonance_min_score ?? 40,
      preset.pa_resonance_require_key_level ?? false,
      preset.pa_resonance_require_momentum ?? false,
      allTrades
    );
    if (!resonanceOk) return { pass: false, reason: "未通過雙TF共振" };
  }

  return { pass: true };
}

// ── 計算績效 ──
function calcPerf(trades: any[]) {
  if (trades.length === 0) return {
    total_trades: 0, win_rate: 0, profit_factor: 0,
    max_drawdown: 0, total_return_net: 0, sharpe_ratio: 0,
    avg_win: 0, avg_loss: 0, rr_ratio: 0, breakeven_wr: 0,
    ev_per_trade: 0, equity_curve: [1.0], monthly_stats: [],
  };

  let equity = 1.0, peak = 1.0, maxDd = 0;
  let wins = 0, totalWin = 0, totalLoss = 0;
  const equityCurve: number[] = [1.0];
  const returns: number[] = [];
  const monthlyMap = new Map<string, { trades: number; wins: number; pnl: number }>();

  for (const t of trades) {
    equity *= (1 + t.pnl_net_pct);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
    equityCurve.push(Math.round(equity * 100000) / 100000);
    returns.push(t.pnl_net_pct);
    if (t.pnl_net_pct > 0) { wins++; totalWin += t.pnl_net_pct; }
    else totalLoss += Math.abs(t.pnl_net_pct);
    const d = new Date(t.entry_time);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = monthlyMap.get(month) ?? { trades: 0, wins: 0, pnl: 0 };
    m.trades++; if (t.pnl_net_pct > 0) m.wins++; m.pnl += t.pnl_net_pct;
    monthlyMap.set(month, m);
  }

  const winRate = wins / trades.length;
  const pf = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? 99 : 0);
  const totalReturn = equity - 1;
  const avgRet = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdRet = returns.length > 1
    ? Math.sqrt(returns.reduce((a, b) => a + (b - avgRet) ** 2, 0) / returns.length) : 0;
  const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(trades.length) : 0;

  const winPnls  = returns.filter(r => r > 0);
  const lossPnls = returns.filter(r => r <= 0);
  const avgWin  = winPnls.length  > 0 ? winPnls.reduce((a, b) => a + b, 0)  / winPnls.length  : 0;
  const avgLoss = lossPnls.length > 0 ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length : 0;
  const rrRatio = Math.abs(avgLoss) > 0 ? Math.abs(avgWin / avgLoss) : 0;
  const beWr    = rrRatio > 0 ? 1 / (1 + rrRatio) : 0;
  const ev      = winRate * avgWin + (1 - winRate) * avgLoss;

  const monthlyStats = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({
      month, trades: m.trades, wins: m.wins,
      win_rate: m.trades > 0 ? m.wins / m.trades : 0,
      pnl_pct: m.pnl,
    }));

  return {
    total_trades: trades.length, win_rate: winRate * 100,
    profit_factor: pf, max_drawdown: maxDd * 100,
    total_return_net: totalReturn * 100, sharpe_ratio: sharpe,
    avg_win: avgWin * 100, avg_loss: avgLoss * 100,
    rr_ratio: rrRatio, breakeven_wr: beWr * 100,
    ev_per_trade: ev * 100, equity_curve: equityCurve,
    monthly_stats: monthlyStats,
  };
}

// ── 主程式 ──
async function main() {
  console.log("=".repeat(70));
  console.log("  BTCUSDT 軟回踩評分 + TP 倍數掃描");
  console.log("=".repeat(70));

  const candles1h: Candle[] = JSON.parse(readFileSync("/home/ubuntu/btcusdt_backtest/candles_1h.json", "utf-8"));
  const candles4h: Candle[] = JSON.parse(readFileSync("/home/ubuntu/btcusdt_backtest/candles_4h.json", "utf-8"));
  console.log(`  1H K 線：${candles1h.length} 根 | 4H K 線：${candles4h.length} 根\n`);

  // 以策略181為基礎（pa_dual_tf_resonance + pa_retest_soft_score）
  const basePreset = BTCUSDT_LIVE_PRESETS.find(p => p.key === 'btcusdt_1h_single_strategy_181')!;

  // 掃描參數
  const scoreConfigs = [
    { label: '基線（score7.5+bonus0.5）', minScore: 7.5, bonus: 0.5 },
    { label: 'score8.0+bonus1.0',         minScore: 8.0, bonus: 1.0 },
    { label: 'score8.5+bonus1.5 ★',       minScore: 8.5, bonus: 1.5 },
    { label: 'score9.0+bonus1.5',         minScore: 9.0, bonus: 1.5 },
  ];
  const tpMults = [0.21, 0.30, 0.40, 0.50, 0.60, 0.80, 1.00];

  const allResults: any[] = [];

  // 先執行一次完整回測（只需一次，不同 TP 需重跑）
  for (const tp of tpMults) {
    // 執行回測
    const result = runBacktest({
      candles:              candles1h,
      strategy:             basePreset.strategy,
      symbol:               basePreset.symbol,
      interval:             basePreset.interval,
      atr_sl_mult:          basePreset.atr_sl_mult,
      atr_tp_mult:          tp,
      enable_mtf_filter:    basePreset.enable_mtf_filter,
      enable_adx_filter:    basePreset.enable_adx_filter,
      enable_trailing_stop: basePreset.enable_trailing_stop,
      enable_fee:           true,
      candles_4h:           candles4h,
    });
    const allTrades = result.trades ?? [];
    const tradeSummary = allTrades.map(t => ({
      direction: t.direction, entry_time: t.entry_time, entry_price: t.entry_price,
    }));

    for (const sc of scoreConfigs) {
      const lastDir = new Map<string, string>();
      const filteredTrades = allTrades.filter(t => {
        const r = applyFilterWithScore(
          basePreset, candles1h,
          { direction: t.direction, entry_price: t.entry_price, entry_time: t.entry_time,
            entry_type: t.entry_type, signal_score: t.signal_score },
          tradeSummary, lastDir,
          sc.minScore, sc.bonus, 0.08
        );
        if (r.pass) lastDir.set(basePreset.key, t.direction);
        return r.pass;
      });

      const perf = calcPerf(filteredTrades);
      const variant = `TP${tp}_${sc.label.replace(/[^a-zA-Z0-9+.★]/g, '_')}`;

      allResults.push({
        variant,
        tp_mult: tp,
        score_config: sc.label,
        min_score: sc.minScore,
        bonus: sc.bonus,
        original_trades: allTrades.length,
        filtered_trades: filteredTrades.length,
        ...perf,
        trades: filteredTrades.map(t => ({
          direction: t.direction,
          entry_time: t.entry_time,
          exit_time: t.exit_time,
          pnl_net_pct: t.pnl_net_pct,
          exit_reason: t.exit_reason,
        })),
      });

      const profitable = perf.total_return_net > 0 ? '✅' : '❌';
      console.log(`${profitable} TP=${tp} | ${sc.label.padEnd(30)} | 交易:${perf.total_trades.toString().padStart(3)} | 勝率:${perf.win_rate.toFixed(1).padStart(5)}% | PF:${perf.profit_factor.toFixed(3)} | 回撤:-${perf.max_drawdown.toFixed(1).padStart(5)}% | 報酬:${perf.total_return_net.toFixed(2).padStart(7)}% | EV:${perf.ev_per_trade.toFixed(4)}%`);
    }
    console.log();
  }

  writeFileSync(
    "/home/ubuntu/btcusdt_backtest/score_tp_scan_results.json",
    JSON.stringify(allResults, null, 2)
  );
  console.log("\n✅ 掃描結果已儲存");

  // 找出盈利組合
  const profitable = allResults.filter(r => r.total_return_net > 0 && r.filtered_trades >= 50);
  console.log(`\n🏆 盈利且交易數>=50的組合：${profitable.length} 個`);
  profitable.sort((a, b) => b.total_return_net - a.total_return_net);
  for (const r of profitable.slice(0, 10)) {
    console.log(`  ${r.variant}: 報酬=${r.total_return_net.toFixed(2)}% | 勝率=${r.win_rate.toFixed(1)}% | PF=${r.profit_factor.toFixed(3)} | 回撤=-${r.max_drawdown.toFixed(1)}% | 交易=${r.filtered_trades}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
