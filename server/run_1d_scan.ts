/**
 * run_1d_scan.ts
 * 在 TP=0.5 + score9.0+bonus1.5 基礎上，加入 1D K 線過濾
 * 測試三種 1D 整合方式：
 *   A: 1D 作為 mtf_candles（HTF 趨勢過濾，取代 4H）
 *   B: 1D 作為額外後過濾（在 applyPaFilter 後再加 1D EMA 方向確認）
 *   C: 1D + 4H 雙層 HTF（先用 1D 過濾，再用 4H 確認）
 */
import { readFileSync, writeFileSync } from "fs";
import { runBacktest, type Candle } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS } from "./live_btcusdt_strategy_presets.js";

// ── 輔助函數 ──

function calcEma(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { ema.push(NaN); continue; }
    if (i === period - 1) {
      ema.push(values.slice(0, period).reduce((a, b) => a + b, 0) / period);
    } else {
      ema.push(values[i] * k + ema[i - 1] * (1 - k));
    }
  }
  return ema;
}

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

// 取得 1D 在某時間點的 EMA 方向
function get1dTrend(candles1d: Candle[], currentTime: number, emaPeriod = 50): "bullish" | "bearish" | "neutral" {
  const available = candles1d.filter(c => c.time <= currentTime);
  if (available.length < emaPeriod) return "neutral";
  const closes = available.map(c => c.close);
  const ema = calcEma(closes, emaPeriod);
  const lastEma = ema[ema.length - 1];
  const lastClose = closes[closes.length - 1];
  if (isNaN(lastEma)) return "neutral";
  if (lastClose > lastEma * 1.005) return "bullish";
  if (lastClose < lastEma * 0.995) return "bearish";
  return "neutral";
}

// 取得 1D 在某時間點的 EMA200 方向
function get1dEma200Trend(candles1d: Candle[], currentTime: number): "bullish" | "bearish" | "neutral" {
  const available = candles1d.filter(c => c.time <= currentTime);
  if (available.length < 50) return "neutral";
  const closes = available.map(c => c.close);
  const period = Math.min(200, closes.length);
  const ema = calcEma(closes, period);
  const lastEma = ema[ema.length - 1];
  const lastClose = closes[closes.length - 1];
  if (isNaN(lastEma)) return "neutral";
  if (lastClose > lastEma * 1.002) return "bullish";
  if (lastClose < lastEma * 0.998) return "bearish";
  return "neutral";
}

// applyPaFilter（score9.0+bonus1.5）
function checkRetestConfirmation(
  candles: Candle[], idx: number, direction: "long" | "short",
  entryPrice: number, atr: number,
  retestMode: string, lookbackBars: number,
  touchToleranceAtr: number, reclaimOffsetAtr: number,
  requireCandleColor: boolean
): boolean {
  const lookback = Math.min(lookbackBars, idx);
  const touchTol = atr * touchToleranceAtr;
  const reclaimOff = atr * reclaimOffsetAtr;
  for (let j = idx - lookback; j <= idx; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (direction === "long") {
      const touched   = c.low  <= entryPrice + touchTol;
      const reclaimed = c.close >= entryPrice - reclaimOff;
      const colorOk   = !requireCandleColor || c.close >= c.open;
      if (retestMode === "same_bar") { if (touched && reclaimed && colorOk) return true; }
      else if (retestMode === "next_bar_confirm") {
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
      if (retestMode === "same_bar") { if (touched && reclaimed && colorOk) return true; }
      else if (retestMode === "next_bar_confirm") {
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
  candles: Candle[], idx: number, direction: "long" | "short",
  biasWindowBars: number, minScore: number
): boolean {
  if (idx < biasWindowBars + 5) return false;
  const recentCandles = candles.slice(Math.max(0, idx - biasWindowBars), idx + 1);
  let bullCount = 0, bearCount = 0;
  for (const rc of recentCandles) { if (rc.close > rc.open) bullCount++; else bearCount++; }
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

function applyBaseFilter(
  preset: any, candles: Candle[],
  trade: { direction: string; entry_price: number; entry_time: number; entry_type?: string; signal_score?: number },
  lastDir: Map<string, string>,
  minScore = 9.0, bonus = 1.5, touchTol = 0.08
): boolean {
  if (!isInSession(trade.entry_time, preset.pa_session_mode)) return false;
  let idx = candles.findIndex(c => c.time >= trade.entry_time);
  if (idx < 0) idx = candles.length - 1;
  const atr = calcAtr(candles, idx);

  if (trade.entry_type === "PA_PATTERN"       && !preset.pa_allow_pattern)       return false;
  if (trade.entry_type === "PA_TRUE_BREAKOUT" && !preset.pa_allow_true_breakout) return false;
  if (trade.entry_type === "PA_2ND_LEG_TRAP"  && !preset.pa_allow_trap)          return false;

  if (preset.pa_require_retest_on_continuation) {
    const prevDir = lastDir.get(preset.key);
    if (prevDir && prevDir === trade.direction) {
      const retestOk = checkRetestConfirmation(
        candles, idx, trade.direction as "long" | "short",
        trade.entry_price, atr, preset.pa_retest_mode, preset.pa_retest_lookback_bars,
        preset.pa_retest_touch_tolerance_atr, preset.pa_retest_reclaim_offset_atr,
        preset.pa_retest_require_candle_color
      );
      if (!retestOk) return false;
    }
  }

  if (trade.signal_score !== undefined) {
    const hasRetest = checkRetestConfirmation(
      candles, idx, trade.direction as "long" | "short",
      trade.entry_price, atr, preset.pa_retest_mode, preset.pa_retest_lookback_bars,
      touchTol, preset.pa_retest_reclaim_offset_atr, preset.pa_retest_require_candle_color
    );
    const effectiveScore = trade.signal_score + (hasRetest ? bonus : 0);
    if (effectiveScore < minScore) return false;
  }

  if (preset.pa_dual_tf_resonance) {
    const resonanceOk = checkDualTfResonance(
      candles, idx, trade.direction as "long" | "short",
      preset.pa_resonance_bias_window_bars ?? 2,
      preset.pa_resonance_min_score ?? 40
    );
    if (!resonanceOk) return false;
  }

  return true;
}

// ── 計算績效 ──
function calcPerf(trades: any[]) {
  if (trades.length === 0) return {
    total_trades: 0, win_rate: 0, profit_factor: 0, max_drawdown: 0,
    total_return_net: 0, sharpe_ratio: 0, avg_win: 0, avg_loss: 0,
    rr_ratio: 0, breakeven_wr: 0, ev_per_trade: 0,
    equity_curve: [1.0], monthly_stats: [],
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
      win_rate: m.trades > 0 ? m.wins / m.trades : 0, pnl_pct: m.pnl,
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
  console.log("  BTCUSDT 1D 過濾層加入掃描（基於 TP=0.5 + score9.0+bonus1.5）");
  console.log("=".repeat(70));

  const candles1h: Candle[] = JSON.parse(readFileSync("/home/ubuntu/btcusdt_backtest/candles_1h.json", "utf-8"));
  const candles4h: Candle[] = JSON.parse(readFileSync("/home/ubuntu/btcusdt_backtest/candles_4h.json", "utf-8"));
  const candles1d: Candle[] = JSON.parse(readFileSync("/home/ubuntu/btcusdt_backtest/candles_1d.json", "utf-8"));
  console.log(`  1H: ${candles1h.length} 根 | 4H: ${candles4h.length} 根 | 1D: ${candles1d.length} 根\n`);

  const basePreset = BTCUSDT_LIVE_PRESETS.find(p => p.key === 'btcusdt_1h_single_strategy_181')!;
  const TP = 0.5;

  // ── 方案配置 ──
  const configs = [
    {
      label: '基準（TP=0.5 + score9.0，無1D）',
      mtf_candles: candles4h,
      post_1d_filter: false,
      post_1d_ema: 50,
      post_1d_strict: false,
    },
    {
      label: 'A: 1D作為HTF（取代4H）',
      mtf_candles: candles1d,
      post_1d_filter: false,
      post_1d_ema: 50,
      post_1d_strict: false,
    },
    {
      label: 'B: 1D EMA50 後過濾',
      mtf_candles: candles4h,
      post_1d_filter: true,
      post_1d_ema: 50,
      post_1d_strict: false,
    },
    {
      label: 'B2: 1D EMA50 嚴格後過濾',
      mtf_candles: candles4h,
      post_1d_filter: true,
      post_1d_ema: 50,
      post_1d_strict: true,
    },
    {
      label: 'C: 4H+1D雙層HTF（先1D後4H）',
      mtf_candles: candles4h,
      post_1d_filter: true,
      post_1d_ema: 200,
      post_1d_strict: false,
    },
    {
      label: 'D: 1D EMA200 後過濾',
      mtf_candles: candles4h,
      post_1d_filter: true,
      post_1d_ema: 200,
      post_1d_strict: false,
    },
    {
      label: 'E: 1D EMA20 後過濾（短期）',
      mtf_candles: candles4h,
      post_1d_filter: true,
      post_1d_ema: 20,
      post_1d_strict: false,
    },
  ];

  const allResults: any[] = [];

  for (const cfg of configs) {
    // 執行回測
    const result = runBacktest({
      candles:              candles1h,
      strategy:             basePreset.strategy,
      symbol:               basePreset.symbol,
      interval:             basePreset.interval,
      atr_sl_mult:          basePreset.atr_sl_mult,
      atr_tp_mult:          TP,
      enable_mtf_filter:    true,
      enable_adx_filter:    basePreset.enable_adx_filter,
      enable_trailing_stop: basePreset.enable_trailing_stop,
      enable_fee:           true,
      candles_4h:           cfg.mtf_candles,
    });
    const allTrades = result.trades ?? [];
    const tradeSummary = allTrades.map(t => ({
      direction: t.direction, entry_time: t.entry_time, entry_price: t.entry_price,
    }));

    // 套用 score9.0+bonus1.5 基礎過濾
    const lastDir = new Map<string, string>();
    let filteredTrades = allTrades.filter(t => {
      const pass = applyBaseFilter(
        basePreset, candles1h,
        { direction: t.direction, entry_price: t.entry_price, entry_time: t.entry_time,
          entry_type: t.entry_type, signal_score: t.signal_score },
        lastDir, 9.0, 1.5, 0.08
      );
      if (pass) lastDir.set(basePreset.key, t.direction);
      return pass;
    });

    // 套用 1D 後過濾
    let d1FilteredCount = 0;
    if (cfg.post_1d_filter) {
      filteredTrades = filteredTrades.filter(t => {
        const trend1d = cfg.post_1d_ema === 200
          ? get1dEma200Trend(candles1d, t.entry_time)
          : get1dTrend(candles1d, t.entry_time, cfg.post_1d_ema);
        if (trend1d === "neutral") {
          if (cfg.post_1d_strict) { d1FilteredCount++; return false; }
          return true; // 非嚴格模式：neutral 允許通過
        }
        const aligned = (t.direction === "long" && trend1d === "bullish") ||
                        (t.direction === "short" && trend1d === "bearish");
        if (!aligned) d1FilteredCount++;
        return aligned;
      });
    }

    const perf = calcPerf(filteredTrades);
    const profitable = perf.total_return_net > 0 ? '✅' : '❌';
    console.log(`${profitable} ${cfg.label.padEnd(35)} | 交易:${perf.total_trades.toString().padStart(3)} | 勝率:${perf.win_rate.toFixed(1).padStart(5)}% | PF:${perf.profit_factor.toFixed(3)} | 回撤:-${perf.max_drawdown.toFixed(1).padStart(5)}% | 報酬:${perf.total_return_net.toFixed(2).padStart(7)}% | Sharpe:${perf.sharpe_ratio.toFixed(3)}`);

    allResults.push({
      label: cfg.label,
      original_trades: allTrades.length,
      filtered_trades: filteredTrades.length,
      d1_filtered: d1FilteredCount,
      ...perf,
      trades: filteredTrades.map(t => ({
        direction: t.direction,
        entry_time: t.entry_time,
        exit_time: t.exit_time,
        pnl_net_pct: t.pnl_net_pct,
        exit_reason: t.exit_reason,
      })),
    });
  }

  writeFileSync(
    "/home/ubuntu/btcusdt_backtest/1d_scan_results.json",
    JSON.stringify(allResults, null, 2)
  );
  console.log("\n✅ 1D 掃描結果已儲存");

  // 找最佳
  const profitable = allResults.filter(r => r.total_return_net > 0 && r.filtered_trades >= 30);
  profitable.sort((a, b) => b.total_return_net - a.total_return_net);
  console.log(`\n🏆 盈利組合：`);
  for (const r of profitable) {
    console.log(`  ${r.label}: 報酬=${r.total_return_net.toFixed(2)}% | 勝率=${r.win_rate.toFixed(1)}% | PF=${r.profit_factor.toFixed(3)} | 回撤=-${r.max_drawdown.toFixed(1)}% | 交易=${r.filtered_trades}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
