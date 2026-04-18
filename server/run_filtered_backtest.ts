/**
 * run_filtered_backtest.ts
 * 套用完整 applyPaFilter 後過濾，執行一年回測
 * 輸出：只做「通過所有 pa_* 條件」的交易的真實績效
 */
import { readFileSync, writeFileSync } from "fs";
import { runBacktest, type Candle } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS, type LivePreset } from "./live_btcusdt_strategy_presets.js";

// ── 從 run_btcusdt_live_telegram 複製所需函數 ──

function calcAtr(candles: Candle[], idx: number): number {
  const start = Math.max(1, idx - 13);
  let sum = 0, count = 0;
  for (let i = start; i <= idx; i++) {
    const high = candles[i].high, low = candles[i].low, prevClose = candles[i - 1].close;
    sum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    count++;
  }
  return count > 0 ? sum / count : candles[idx].high - candles[idx].low;
}

function checkRetestConfirmation(
  candles: Candle[],
  idx: number,
  direction: "long" | "short",
  entryPrice: number,
  atr: number,
  retestMode: string,
  lookbackBars: number,
  touchToleranceAtr: number,
  reclaimOffsetAtr: number,
  requireCandleColor: boolean
): boolean {
  const lookback = Math.min(lookbackBars, idx);
  const touchTol = atr * touchToleranceAtr;
  const reclaimOff = atr * reclaimOffsetAtr;

  for (let j = idx - lookback; j <= idx; j++) {
    if (j < 0) continue;
    const c = candles[j];
    if (direction === "long") {
      const touched = c.low <= entryPrice + touchTol;
      const reclaimed = c.close >= entryPrice - reclaimOff;
      const colorOk = !requireCandleColor || c.close >= c.open;
      if (retestMode === "same_bar") {
        if (touched && reclaimed && colorOk) return true;
      } else if (retestMode === "next_bar_confirm") {
        if (touched && j + 1 <= idx) {
          const next = candles[j + 1];
          if (next.close >= entryPrice - reclaimOff && (!requireCandleColor || next.close >= next.open)) return true;
        }
      } else { // either
        if (touched && reclaimed && colorOk) return true;
        if (touched && j + 1 <= idx) {
          const next = candles[j + 1];
          if (next.close >= entryPrice - reclaimOff && (!requireCandleColor || next.close >= next.open)) return true;
        }
      }
    } else {
      const touched = c.high >= entryPrice - touchTol;
      const reclaimed = c.close <= entryPrice + reclaimOff;
      const colorOk = !requireCandleColor || c.close <= c.open;
      if (retestMode === "same_bar") {
        if (touched && reclaimed && colorOk) return true;
      } else if (retestMode === "next_bar_confirm") {
        if (touched && j + 1 <= idx) {
          const next = candles[j + 1];
          if (next.close <= entryPrice + reclaimOff && (!requireCandleColor || next.close <= next.open)) return true;
        }
      } else {
        if (touched && reclaimed && colorOk) return true;
        if (touched && j + 1 <= idx) {
          const next = candles[j + 1];
          if (next.close <= entryPrice + reclaimOff && (!requireCandleColor || next.close <= next.open)) return true;
        }
      }
    }
  }
  return false;
}

function checkDualTfResonance(
  candles: Candle[],
  idx: number,
  direction: "long" | "short",
  biasWindowBars: number,
  minScore: number,
  requireKeyLevel: boolean,
  requireMomentum: boolean,
  allTrades: Array<{ direction: string; entry_time: number; entry_price: number }>
): boolean {
  if (idx < biasWindowBars + 5) return false;
  // 計算最近 biasWindowBars 根的偏向
  const recentCandles = candles.slice(Math.max(0, idx - biasWindowBars), idx + 1);
  const closes = recentCandles.map(c => c.close);
  const opens  = recentCandles.map(c => c.open);
  let bullCount = 0, bearCount = 0;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] > opens[i]) bullCount++;
    else bearCount++;
  }
  const biasBull = bullCount > bearCount;
  const biasBear = bearCount > bullCount;
  // 方向與偏向一致
  if (direction === "long"  && !biasBull) return false;
  if (direction === "short" && !biasBear) return false;
  // 計算共振評分（簡化版）
  let score = 50;
  // 動量確認
  const c = candles[idx];
  const prevC = candles[idx - 1];
  if (direction === "long"  && c.close > prevC.close) score += 20;
  if (direction === "short" && c.close < prevC.close) score += 20;
  // 趨勢確認（最近 10 根）
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

// ── session 過濾（基於 K 線時間，非即時）──
function isInSession(candleTime: number, mode: string | undefined): boolean {
  if (!mode || mode === "all") return true;
  const d = new Date(candleTime); // candleTime 是毫秒
  const utcHour = d.getUTCHours();
  if (mode === "exclude_offhours") {
    return !(utcHour >= 0 && utcHour < 6);
  }
  if (mode === "london_newyork") {
    return (utcHour >= 7 && utcHour <= 22);
  }
  return true;
}

// ── applyPaFilter（完整版，含 session 過濾）──
const lastDirection = new Map<string, string>();

function applyPaFilter(
  preset: LivePreset,
  candles: Candle[],
  trade: {
    direction: string;
    entry_price: number;
    entry_time: number;
    entry_type?: string;
    signal_score?: number;
  },
  allTrades: Array<{ direction: string; entry_time: number; entry_price: number }>
): { pass: boolean; reason?: string } {
  const { entry_type, signal_score } = trade;

  // 0. session 過濾（基於進場 K 線時間）
  if (!isInSession(trade.entry_time, preset.pa_session_mode)) {
    return { pass: false, reason: `非交易時段（${preset.pa_session_mode}）` };
  }

  let idx = candles.findIndex(c => c.time >= trade.entry_time);
  if (idx < 0) idx = candles.length - 1;
  const atr = calcAtr(candles, idx);

  // 1. entry_type 過濾
  if (entry_type === "PA_PATTERN"       && !preset.pa_allow_pattern)       return { pass: false, reason: "PA_PATTERN 被過濾" };
  if (entry_type === "PA_TRUE_BREAKOUT" && !preset.pa_allow_true_breakout) return { pass: false, reason: "PA_TRUE_BREAKOUT 被過濾" };
  if (entry_type === "PA_2ND_LEG_TRAP"  && !preset.pa_allow_trap)          return { pass: false, reason: "PA_2ND_LEG_TRAP 被過濾" };

  // 2. pa_require_retest_on_continuation
  if (preset.pa_require_retest_on_continuation) {
    const prevDir = lastDirection.get(preset.key);
    if (prevDir && prevDir === trade.direction) {
      const retestOk = checkRetestConfirmation(
        candles, idx,
        trade.direction as "long" | "short",
        trade.entry_price, atr,
        preset.pa_retest_mode,
        preset.pa_retest_lookback_bars,
        preset.pa_retest_touch_tolerance_atr,
        preset.pa_retest_reclaim_offset_atr,
        preset.pa_retest_require_candle_color
      );
      if (!retestOk) return { pass: false, reason: "連續同向未通過回測確認" };
    }
  }

  // 3. pa_retest_soft_score
  if (preset.pa_retest_soft_score && signal_score !== undefined) {
    const minScore = preset.pa_retest_soft_min_score ?? 7.0;
    const bonus    = preset.pa_retest_soft_bonus    ?? 0.5;
    const hasRetest = checkRetestConfirmation(
      candles, idx,
      trade.direction as "long" | "short",
      trade.entry_price, atr,
      preset.pa_retest_mode,
      preset.pa_retest_lookback_bars,
      preset.pa_retest_touch_tolerance_atr,
      preset.pa_retest_reclaim_offset_atr,
      preset.pa_retest_require_candle_color
    );
    const effectiveScore = signal_score + (hasRetest ? bonus : 0);
    if (effectiveScore < minScore) {
      return { pass: false, reason: `評分 ${effectiveScore.toFixed(1)} < ${minScore}` };
    }
  }

  // 4. pa_dual_tf_resonance
  if (preset.pa_dual_tf_resonance) {
    const resonanceOk = checkDualTfResonance(
      candles, idx,
      trade.direction as "long" | "short",
      preset.pa_resonance_bias_window_bars    ?? 2,
      preset.pa_resonance_min_score           ?? 40,
      preset.pa_resonance_require_key_level   ?? false,
      preset.pa_resonance_require_momentum    ?? false,
      allTrades
    );
    if (!resonanceOk) return { pass: false, reason: "未通過雙時間框架共振" };
  }

  return { pass: true };
}

// ── 主程式 ──
async function main() {
  console.log("=".repeat(70));
  console.log("  BTCUSDT 套用 applyPaFilter 後過濾回測");
  console.log("=".repeat(70));

  const candles1h: Candle[] = JSON.parse(
    readFileSync("/home/ubuntu/btcusdt_backtest/candles_1h.json", "utf-8")
  );
  const candles4h: Candle[] = JSON.parse(
    readFileSync("/home/ubuntu/btcusdt_backtest/candles_4h.json", "utf-8")
  );

  console.log(`  1H K 線：${candles1h.length} 根`);
  console.log(`  4H K 線：${candles4h.length} 根`);
  console.log();

  const allResults: Record<string, any> = {};

  for (const preset of BTCUSDT_LIVE_PRESETS) {
    console.log("-".repeat(70));
    console.log(`📊 策略：${preset.label}`);
    console.log(`   過濾條件：`);
    console.log(`     pa_allow_pattern=${preset.pa_allow_pattern}`);
    console.log(`     pa_allow_true_breakout=${preset.pa_allow_true_breakout}`);
    console.log(`     pa_allow_trap=${preset.pa_allow_trap}`);
    console.log(`     pa_require_retest_on_continuation=${preset.pa_require_retest_on_continuation}`);
    console.log(`     pa_retest_soft_score=${preset.pa_retest_soft_score ?? false}`);
    console.log(`     pa_dual_tf_resonance=${preset.pa_dual_tf_resonance ?? false}`);
    console.log(`     pa_session_mode=${preset.pa_session_mode ?? "all"}`);
    console.log();

    // 先執行完整回測
    const result = runBacktest({
      candles:              candles1h,
      strategy:             preset.strategy,
      symbol:               preset.symbol,
      interval:             preset.interval,
      atr_sl_mult:          preset.atr_sl_mult,
      atr_tp_mult:          preset.atr_tp_mult,
      enable_mtf_filter:    preset.enable_mtf_filter,
      enable_adx_filter:    preset.enable_adx_filter,
      enable_trailing_stop: preset.enable_trailing_stop,
      enable_fee:           true,
      candles_4h:           candles4h,
    });

    const allTrades = result.trades ?? [];
    console.log(`  原始交易數：${allTrades.length} 筆`);

    // 重置 lastDirection
    lastDirection.clear();

    // 套用 applyPaFilter
    const tradeSummary = allTrades.map(t => ({
      direction:   t.direction,
      entry_time:  t.entry_time,
      entry_price: t.entry_price,
    }));

    const filterReasons: Record<string, number> = {};
    const filteredTrades = allTrades.filter(t => {
      const r = applyPaFilter(preset, candles1h, {
        direction:    t.direction,
        entry_price:  t.entry_price,
        entry_time:   t.entry_time,
        entry_type:   t.entry_type,
        signal_score: t.signal_score,
      }, tradeSummary);
      if (!r.pass) {
        const reason = r.reason ?? "unknown";
        filterReasons[reason] = (filterReasons[reason] ?? 0) + 1;
      } else {
        // 更新 lastDirection（通過過濾才更新）
        lastDirection.set(preset.key, t.direction);
      }
      return r.pass;
    });

    console.log(`  過濾後交易數：${filteredTrades.length} 筆`);
    console.log(`  過濾原因：`, JSON.stringify(filterReasons));

    // 計算過濾後的績效
    let equity = 1.0;
    let peak = 1.0;
    let maxDd = 0;
    let wins = 0, totalWin = 0, totalLoss = 0;
    const equityCurve: number[] = [1.0];
    const returns: number[] = [];

    for (const t of filteredTrades) {
      equity *= (1 + t.pnl_net_pct);
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDd) maxDd = dd;
      equityCurve.push(Math.round(equity * 10000) / 10000);
      returns.push(t.pnl_net_pct);
      if (t.pnl_net_pct > 0) { wins++; totalWin += t.pnl_net_pct; }
      else totalLoss += Math.abs(t.pnl_net_pct);
    }

    const winRate = filteredTrades.length > 0 ? wins / filteredTrades.length : 0;
    const pf = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? 99 : 0);
    const totalReturn = equity - 1;
    const avgRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdRet = returns.length > 1
      ? Math.sqrt(returns.reduce((a, b) => a + (b - avgRet) ** 2, 0) / returns.length)
      : 0;
    // 年化 Sharpe（1H 策略）
    const tradesPerYear = filteredTrades.length;
    const annualFactor = Math.sqrt(tradesPerYear);
    const sharpe = stdRet > 0 ? (avgRet / stdRet) * annualFactor : 0;

    // 月度統計
    const monthlyMap = new Map<string, { trades: number; wins: number; pnl: number }>();
    for (const t of filteredTrades) {
      const d = new Date(t.entry_time);
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const m = monthlyMap.get(month) ?? { trades: 0, wins: 0, pnl: 0 };
      m.trades++;
      if (t.pnl_net_pct > 0) m.wins++;
      m.pnl += t.pnl_net_pct;
      monthlyMap.set(month, m);
    }
    const monthlyStats = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) => ({
        month,
        trades: m.trades,
        wins: m.wins,
        win_rate: m.trades > 0 ? m.wins / m.trades : 0,
        pnl_pct: m.pnl,
      }));

    console.log(`  勝率：${(winRate * 100).toFixed(2)}%`);
    console.log(`  Profit Factor：${pf.toFixed(3)}`);
    console.log(`  最大回撤：${(maxDd * 100).toFixed(2)}%`);
    console.log(`  總報酬(net)：${(totalReturn * 100).toFixed(2)}%`);
    console.log(`  Sharpe Ratio：${sharpe.toFixed(3)}`);

    if (monthlyStats.length > 0) {
      console.log();
      console.log("  月度統計：");
      for (const m of monthlyStats) {
        console.log(`    ${m.month}  交易：${m.trades}  勝率：${(m.win_rate*100).toFixed(1)}%  PnL：${(m.pnl_pct*100).toFixed(2)}%`);
      }
    }

    // 出場原因
    const exitReasons: Record<string, number> = {};
    const entryTypes: Record<string, number> = {};
    for (const t of filteredTrades) {
      exitReasons[t.exit_reason] = (exitReasons[t.exit_reason] ?? 0) + 1;
      entryTypes[t.entry_type ?? "unknown"] = (entryTypes[t.entry_type ?? "unknown"] ?? 0) + 1;
    }
    console.log(`  出場原因：`, JSON.stringify(exitReasons));
    console.log(`  進場類型：`, JSON.stringify(entryTypes));

    allResults[preset.key] = {
      preset_key: preset.key,
      label: preset.label,
      original_trades: allTrades.length,
      filtered_trades: filteredTrades.length,
      filter_reasons: filterReasons,
      win_rate: winRate * 100,
      profit_factor: pf,
      max_drawdown: maxDd * 100,
      total_return_net: totalReturn * 100,
      sharpe_ratio: sharpe,
      equity_curve: equityCurve,
      monthly_stats: monthlyStats,
      trades: filteredTrades.map(t => ({
        direction: t.direction,
        entry_time: t.entry_time,
        exit_time: t.exit_time,
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        sl_price: t.sl_price,
        tp_price: t.tp_price,
        tp2_price: t.tp2_price,
        tp2_hit: t.tp2_hit,
        pnl_pct: t.pnl_pct,
        pnl_net_pct: t.pnl_net_pct,
        exit_reason: t.exit_reason,
        entry_type: t.entry_type,
        signal_score: t.signal_score,
      })),
    };
    console.log();
  }

  writeFileSync(
    "/home/ubuntu/btcusdt_backtest/filtered_backtest_results.json",
    JSON.stringify(allResults, null, 2)
  );
  console.log("✅ 結果已儲存至 /home/ubuntu/btcusdt_backtest/filtered_backtest_results.json");
}

main().catch(err => {
  console.error("執行失敗：", err);
  process.exit(1);
});
