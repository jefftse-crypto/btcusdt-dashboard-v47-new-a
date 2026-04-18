/**
 * run_adv_scan.ts
 * 在最佳組合（TP=0.5 + score9.0+bonus1.5 + 1D EMA200）基礎上
 * 測試：
 *   1. 15m 執行確認（15m EMA/趨勢對齊）
 *   2. 動態 TP（ADX > 閾值時用大 TP，弱勢用 0.5）
 *   3. 兩者組合
 */
import { readFileSync, writeFileSync } from "fs";
import { runBacktest, type Candle } from "./backtest.js";
import { BTCUSDT_LIVE_PRESETS } from "./live_btcusdt_strategy_presets.js";

// ── 輔助函數 ──

function calcEma(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < period - 1 && i < values.length; i++) sum += values[i];
  if (values.length >= period) {
    sum += values[period - 1];
    ema[period - 1] = sum / period;
    for (let i = period; i < values.length; i++) {
      ema[i] = values[i] * k + ema[i - 1] * (1 - k);
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

function calcAdx(candles: Candle[], idx: number, period = 14): number {
  const start = Math.max(1, idx - period * 2);
  const trs: number[] = [], plusDMs: number[] = [], minusDMs: number[] = [];
  for (let i = start; i <= idx; i++) {
    const h = candles[i].high, l = candles[i].low;
    const ph = candles[i - 1].high, pl = candles[i - 1].low, pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const upMove = h - ph, downMove = pl - l;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  if (trs.length < period) return 0;
  let atr14 = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let plusDm14 = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let minusDm14 = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  const dxArr: number[] = [];
  for (let i = period; i < trs.length; i++) {
    atr14 = atr14 - atr14 / period + trs[i];
    plusDm14 = plusDm14 - plusDm14 / period + plusDMs[i];
    minusDm14 = minusDm14 - minusDm14 / period + minusDMs[i];
    const plusDi = atr14 > 0 ? (plusDm14 / atr14) * 100 : 0;
    const minusDi = atr14 > 0 ? (minusDm14 / atr14) * 100 : 0;
    const diSum = plusDi + minusDi;
    dxArr.push(diSum > 0 ? (Math.abs(plusDi - minusDi) / diSum) * 100 : 0);
  }
  if (dxArr.length < period) return dxArr.length > 0 ? dxArr[dxArr.length - 1] : 0;
  return dxArr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// 1D EMA200 趨勢
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

// 15m 執行確認：在 1H 信號後的 15m K 線中，確認方向對齊
function check15mConfirmation(
  candles15m: Candle[],
  entryTime: number,
  direction: "long" | "short",
  mode: "ema" | "trend" | "both",
  lookbackBars = 4  // 往前看幾根 15m K 線
): boolean {
  // 找到對應的 15m K 線索引
  const idx = candles15m.findIndex(c => c.time >= entryTime);
  if (idx < 20) return true; // 資料不足，放行

  const available = candles15m.slice(0, idx + 1);
  const closes15m = available.map(c => c.close);

  // EMA 確認：15m EMA20 > EMA50（做多）或 < EMA50（做空）
  const ema20 = calcEma(closes15m, 20);
  const ema50 = calcEma(closes15m, 50);
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];

  let emaOk = true;
  if (!isNaN(lastEma20) && !isNaN(lastEma50)) {
    if (direction === "long"  && lastEma20 < lastEma50 * 0.999) emaOk = false;
    if (direction === "short" && lastEma20 > lastEma50 * 1.001) emaOk = false;
  }

  // 趨勢確認：最近 lookbackBars 根 15m K 線中，多數為同向 K 線
  const recentBars = available.slice(-lookbackBars);
  let bullCount = 0, bearCount = 0;
  for (const b of recentBars) {
    if (b.close > b.open) bullCount++; else bearCount++;
  }
  const trendOk = direction === "long" ? bullCount > bearCount : bearCount > bullCount;

  if (mode === "ema")   return emaOk;
  if (mode === "trend") return trendOk;
  return emaOk && trendOk;
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
      else {
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
      else {
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
  return true;
}

function applyBaseFilter(
  preset: any, candles: Candle[],
  trade: { direction: string; entry_price: number; entry_time: number; entry_type?: string; signal_score?: number },
  lastDir: Map<string, string>
): boolean {
  if (!isInSession(trade.entry_time, preset.pa_session_mode)) return false;
  let idx = candles.findIndex(c => c.time >= trade.entry_time);
  if (idx < 0) idx = candles.length - 1;
  const atr = calcAtr(candles, idx);
  if (trade.entry_type === "PA_PATTERN"       && !preset.pa_allow_pattern)       return false;
  if (trade.entry_type === "PA_TRUE_BREAKOUT" && !preset.pa_allow_true_breakout) return false;
  if (trade.entry_type === "PA_2ND_LEG_TRAP"  && !preset.pa_allow_trap)          return false;
  if (trade.signal_score !== undefined) {
    const hasRetest = checkRetestConfirmation(
      candles, idx, trade.direction as "long" | "short",
      trade.entry_price, atr, preset.pa_retest_mode, preset.pa_retest_lookback_bars,
      0.08, preset.pa_retest_reclaim_offset_atr, preset.pa_retest_require_candle_color
    );
    const effectiveScore = trade.signal_score + (hasRetest ? 1.5 : 0);
    if (effectiveScore < 9.0) return false;
  }
  if (preset.pa_dual_tf_resonance) {
    if (!checkDualTfResonance(candles, idx, trade.direction as "long" | "short",
        preset.pa_resonance_bias_window_bars ?? 2, preset.pa_resonance_min_score ?? 40)) return false;
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
  console.log("=".repeat(75));
  console.log("  進階掃描：15m 執行確認 + 動態 TP");
  console.log("  基礎：TP=0.5 + score9.0+bonus1.5 + 1D EMA200");
  console.log("=".repeat(75));

  const candles1h:  Candle[] = JSON.parse(readFileSync("/home/ubuntu/btcusdt_backtest/candles_1h.json",  "utf-8"));
  const candles4h:  Candle[] = JSON.parse(readFileSync("/home/ubuntu/btcusdt_backtest/candles_4h.json",  "utf-8"));
  const candles1d:  Candle[] = JSON.parse(readFileSync("/home/ubuntu/btcusdt_backtest/candles_1d.json",  "utf-8"));
  const candles15m: Candle[] = JSON.parse(readFileSync("/home/ubuntu/btcusdt_backtest/candles_15m.json", "utf-8"));
  console.log(`  1H:${candles1h.length} | 4H:${candles4h.length} | 1D:${candles1d.length} | 15m:${candles15m.length}\n`);

  const basePreset = BTCUSDT_LIVE_PRESETS.find(p => p.key === 'btcusdt_1h_single_strategy_181')!;

  // 動態 TP 配置：[靜態TP, ADX閾值, 強勢TP]
  const dynamicTpConfigs = [
    { label: '靜態 TP=0.5（基準）',          static_tp: 0.5, adx_thresh: null, strong_tp: null },
    { label: '動態 TP（ADX>25: 0.6）',       static_tp: 0.5, adx_thresh: 25,   strong_tp: 0.6  },
    { label: '動態 TP（ADX>25: 0.7）',       static_tp: 0.5, adx_thresh: 25,   strong_tp: 0.7  },
    { label: '動態 TP（ADX>30: 0.6）',       static_tp: 0.5, adx_thresh: 30,   strong_tp: 0.6  },
    { label: '動態 TP（ADX>30: 0.7）',       static_tp: 0.5, adx_thresh: 30,   strong_tp: 0.7  },
    { label: '動態 TP（ADX>30: 0.8）',       static_tp: 0.5, adx_thresh: 30,   strong_tp: 0.8  },
    { label: '動態 TP（ADX>35: 0.7）',       static_tp: 0.5, adx_thresh: 35,   strong_tp: 0.7  },
    { label: '動態 TP（ADX>35: 0.8）',       static_tp: 0.5, adx_thresh: 35,   strong_tp: 0.8  },
  ];

  // 15m 確認模式
  const m15Configs = [
    { label: '無15m確認',        use15m: false, mode: 'ema'   as const, lookback: 4 },
    { label: '15m EMA確認',      use15m: true,  mode: 'ema'   as const, lookback: 4 },
    { label: '15m 趨勢確認',     use15m: true,  mode: 'trend' as const, lookback: 4 },
    { label: '15m EMA+趨勢確認', use15m: true,  mode: 'both'  as const, lookback: 4 },
    { label: '15m EMA+趨勢(3根)', use15m: true, mode: 'both'  as const, lookback: 3 },
  ];

  const allResults: any[] = [];

  // 先跑一次 TP=0.5 的回測（基礎）
  const baseResult = runBacktest({
    candles: candles1h, strategy: basePreset.strategy,
    symbol: basePreset.symbol, interval: basePreset.interval,
    atr_sl_mult: basePreset.atr_sl_mult, atr_tp_mult: 0.5,
    enable_mtf_filter: true, enable_adx_filter: basePreset.enable_adx_filter,
    enable_trailing_stop: basePreset.enable_trailing_stop,
    enable_fee: true, candles_4h: candles4h,
  });
  const baseTrades = baseResult.trades ?? [];

  // 對每個 TP 配置跑回測（動態 TP 需要不同 TP 跑不同回測）
  // 先收集所有需要的 TP 值
  const tpValues = [...new Set(dynamicTpConfigs.flatMap(c =>
    c.static_tp !== null ? [c.static_tp, c.strong_tp].filter(v => v !== null) as number[] : [c.static_tp]
  ))];

  // 為每個 TP 值跑一次回測
  const tpResults = new Map<number, any[]>();
  for (const tp of tpValues) {
    const r = runBacktest({
      candles: candles1h, strategy: basePreset.strategy,
      symbol: basePreset.symbol, interval: basePreset.interval,
      atr_sl_mult: basePreset.atr_sl_mult, atr_tp_mult: tp,
      enable_mtf_filter: true, enable_adx_filter: basePreset.enable_adx_filter,
      enable_trailing_stop: basePreset.enable_trailing_stop,
      enable_fee: true, candles_4h: candles4h,
    });
    tpResults.set(tp, r.trades ?? []);
  }

  // 組合所有配置
  for (const dtpCfg of dynamicTpConfigs) {
    for (const m15Cfg of m15Configs) {
      const label = `${dtpCfg.label} + ${m15Cfg.label}`;

      // 取得對應的交易清單（動態 TP 需要合併兩個 TP 的結果）
      let candidateTrades: any[];
      if (dtpCfg.adx_thresh === null) {
        candidateTrades = tpResults.get(dtpCfg.static_tp) ?? [];
      } else {
        // 動態 TP：根據每筆交易的 ADX 決定用哪個 TP
        const weakTrades   = tpResults.get(dtpCfg.static_tp) ?? [];
        const strongTrades = tpResults.get(dtpCfg.strong_tp!) ?? [];
        // 建立強勢交易的 entry_time 集合（ADX > 閾值的交易）
        const strongEntryTimes = new Set<number>();
        for (const t of weakTrades) {
          let idx = candles1h.findIndex(c => c.time >= t.entry_time);
          if (idx < 0) idx = candles1h.length - 1;
          const adx = calcAdx(candles1h, idx);
          if (adx > dtpCfg.adx_thresh!) strongEntryTimes.add(t.entry_time);
        }
        // 合併：強勢用大 TP 的結果，弱勢用小 TP 的結果
        const strongMap = new Map(strongTrades.map(t => [t.entry_time, t]));
        const weakMap   = new Map(weakTrades.map(t => [t.entry_time, t]));
        candidateTrades = [];
        for (const t of weakTrades) {
          if (strongEntryTimes.has(t.entry_time) && strongMap.has(t.entry_time)) {
            candidateTrades.push(strongMap.get(t.entry_time));
          } else {
            candidateTrades.push(weakMap.get(t.entry_time));
          }
        }
      }

      // 套用 score9.0+bonus1.5 基礎過濾
      const lastDir = new Map<string, string>();
      let filteredTrades = candidateTrades.filter(t => {
        const pass = applyBaseFilter(basePreset, candles1h,
          { direction: t.direction, entry_price: t.entry_price, entry_time: t.entry_time,
            entry_type: t.entry_type, signal_score: t.signal_score }, lastDir);
        if (pass) lastDir.set(basePreset.key, t.direction);
        return pass;
      });

      // 套用 1D EMA200 過濾
      filteredTrades = filteredTrades.filter(t => {
        const trend1d = get1dEma200Trend(candles1d, t.entry_time);
        if (trend1d === "neutral") return true;
        return (t.direction === "long" && trend1d === "bullish") ||
               (t.direction === "short" && trend1d === "bearish");
      });

      // 套用 15m 確認過濾
      if (m15Cfg.use15m) {
        filteredTrades = filteredTrades.filter(t =>
          check15mConfirmation(candles15m, t.entry_time,
            t.direction as "long" | "short", m15Cfg.mode, m15Cfg.lookback)
        );
      }

      const perf = calcPerf(filteredTrades);
      const mark = perf.total_return_net > 0 ? '✅' : '❌';
      console.log(`${mark} ${label.padEnd(50)} | ${perf.total_trades.toString().padStart(3)}筆 | 勝率:${perf.win_rate.toFixed(1).padStart(5)}% | PF:${perf.profit_factor.toFixed(3)} | 回撤:-${perf.max_drawdown.toFixed(1).padStart(5)}% | 報酬:${perf.total_return_net.toFixed(2).padStart(7)}% | Sharpe:${perf.sharpe_ratio.toFixed(3)}`);

      allResults.push({
        label,
        dtp_label: dtpCfg.label,
        m15_label: m15Cfg.label,
        adx_thresh: dtpCfg.adx_thresh,
        strong_tp: dtpCfg.strong_tp,
        use_15m: m15Cfg.use15m,
        m15_mode: m15Cfg.mode,
        filtered_trades: filteredTrades.length,
        ...perf,
        trades: filteredTrades.map(t => ({
          direction: t.direction, entry_time: t.entry_time, exit_time: t.exit_time,
          pnl_net_pct: t.pnl_net_pct, exit_reason: t.exit_reason,
        })),
      });
    }
    console.log();
  }

  writeFileSync("/home/ubuntu/btcusdt_backtest/adv_scan_results.json", JSON.stringify(allResults, null, 2));
  console.log("✅ 進階掃描結果已儲存\n");

  // 排名
  const profitable = allResults.filter(r => r.total_return_net > 0 && r.filtered_trades >= 30);
  profitable.sort((a, b) => b.total_return_net - a.total_return_net);
  console.log(`🏆 TOP 10 盈利組合：`);
  for (const r of profitable.slice(0, 10)) {
    console.log(`  ${r.label}: 報酬=${r.total_return_net.toFixed(2)}% | 勝率=${r.win_rate.toFixed(1)}% | PF=${r.profit_factor.toFixed(3)} | Sharpe=${r.sharpe_ratio.toFixed(3)} | 回撤=-${r.max_drawdown.toFixed(1)}% | 交易=${r.filtered_trades}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
