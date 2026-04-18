/**
 * win_rate_booster.ts — 勝率提升引擎 v1.0
 *
 * 六大改良模組：
 *   1. 多策略共振投票（Cross-Strategy Consensus）
 *   2. 動態市況感知過濾（Regime-Aware Filter）
 *   3. 進場品質強化（Entry Quality Gate）
 *   4. 智能出場優化（Smart Exit）
 *   5. 時段過濾（Session Filter）
 *   6. 波動率自適應（Volatility Adaptive）
 */

import type { Candle } from "../shared/cryptoTypes.js";

// ─────────────────────────────────────────────────────────────────
// 1. 多策略共振投票（Cross-Strategy Consensus）
// ─────────────────────────────────────────────────────────────────
// 核心理念：當多個獨立策略同時指向同一方向時，勝率顯著提升。
// 實作：收集所有策略的信號方向，計算共識分數。

export interface StrategySignal {
  key: string;
  family: string;
  direction: "long" | "short" | null;
  score: number;
  confidence: number; // 0-100
}

export interface ConsensusResult {
  consensus_direction: "long" | "short" | null;
  consensus_score: number;       // 0-100
  agreeing_strategies: string[];
  total_active: number;
  is_strong_consensus: boolean;  // >= 3 策略同向
  boost_multiplier: number;      // 信心加乘倍數
}

export function calcCrossStrategyConsensus(signals: StrategySignal[]): ConsensusResult {
  const active = signals.filter(s => s.direction !== null);
  if (active.length === 0) {
    return { consensus_direction: null, consensus_score: 0, agreeing_strategies: [], total_active: 0, is_strong_consensus: false, boost_multiplier: 1.0 };
  }

  const longSignals = active.filter(s => s.direction === "long");
  const shortSignals = active.filter(s => s.direction === "short");

  // 加權投票（按 score * confidence）
  const longWeight = longSignals.reduce((sum, s) => sum + s.score * (s.confidence / 100), 0);
  const shortWeight = shortSignals.reduce((sum, s) => sum + s.score * (s.confidence / 100), 0);

  const totalWeight = longWeight + shortWeight;
  if (totalWeight === 0) {
    return { consensus_direction: null, consensus_score: 0, agreeing_strategies: [], total_active: active.length, is_strong_consensus: false, boost_multiplier: 1.0 };
  }

  const direction: "long" | "short" = longWeight >= shortWeight ? "long" : "short";
  const agreeing = direction === "long" ? longSignals : shortSignals;
  const dominantWeight = direction === "long" ? longWeight : shortWeight;

  // 共識分數 = 同向權重佔比 * 同向策略數量加成
  const weightRatio = dominantWeight / totalWeight;
  const countBonus = Math.min(agreeing.length / active.length, 1.0);
  const consensusScore = Math.round(weightRatio * 60 + countBonus * 40);

  // 跨家族共振：不同家族的策略同向 → 更強的共識
  const uniqueFamilies = new Set(agreeing.map(s => s.family));
  const isStrongConsensus = agreeing.length >= 2 && uniqueFamilies.size >= 2;

  // 加乘倍數：2 家族同向 → 1.3x，3+ 家族同向 → 1.5x
  const boost = uniqueFamilies.size >= 3 ? 1.5 : uniqueFamilies.size >= 2 ? 1.3 : 1.0;

  return {
    consensus_direction: direction,
    consensus_score: consensusScore,
    agreeing_strategies: agreeing.map(s => s.key),
    total_active: active.length,
    is_strong_consensus: isStrongConsensus,
    boost_multiplier: boost,
  };
}

// ─────────────────────────────────────────────────────────────────
// 2. 動態市況感知過濾（Regime-Aware Filter）
// ─────────────────────────────────────────────────────────────────
// 核心理念：不同市況下，不同策略的勝率差異極大。
// 趨勢市 → 趨勢策略勝率高；震盪市 → 均值回歸勝率高。

export type MarketRegime = "strong_trend" | "weak_trend" | "ranging" | "volatile" | "compressed";

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number;
  adx: number;
  atr_pct: number;
  bb_width_pct: number;
  recommended_families: string[];
  avoid_families: string[];
}

export function detectMarketRegime(candles: Candle[]): RegimeResult {
  if (candles.length < 50) {
    return { regime: "ranging", confidence: 30, adx: 0, atr_pct: 0, bb_width_pct: 0, recommended_families: [], avoid_families: [] };
  }

  const closes = candles.map(c => c.close);
  const n = closes.length;
  const lastClose = closes[n - 1];

  // ADX 計算（簡化版）
  let plusDmSum = 0, minusDmSum = 0, trSum = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    const high = candles[i].high, low = candles[i].low;
    const prevHigh = candles[i - 1].high, prevLow = candles[i - 1].low, prevClose = candles[i - 1].close;
    const plusDm = Math.max(0, high - prevHigh);
    const minusDm = Math.max(0, prevLow - low);
    if (plusDm > minusDm) { plusDmSum += plusDm; } else { minusDmSum += minusDm; }
    trSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  const plusDi = trSum > 0 ? (plusDmSum / trSum) * 100 : 0;
  const minusDi = trSum > 0 ? (minusDmSum / trSum) * 100 : 0;
  const diSum = plusDi + minusDi;
  const adx = diSum > 0 ? Math.abs(plusDi - minusDi) / diSum * 100 : 0;

  // ATR%
  let atrSum = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    const prevClose = candles[i - 1].close;
    atrSum += Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose));
  }
  const atr = atrSum / Math.min(14, n - 1);
  const atr_pct = lastClose > 0 ? (atr / lastClose) * 100 : 0;

  // Bollinger Band Width%
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const stdDev = Math.sqrt(closes.slice(-20).reduce((sum, c) => sum + Math.pow(c - sma20, 2), 0) / 20);
  const bb_width_pct = sma20 > 0 ? (stdDev * 4 / sma20) * 100 : 0;

  // 市況判斷
  let regime: MarketRegime;
  let confidence: number;
  let recommended: string[];
  let avoid: string[];

  if (adx >= 35 && atr_pct >= 1.5) {
    regime = "strong_trend";
    confidence = Math.min(95, 60 + adx);
    recommended = ["trend_pullback", "trend_confirm"];
    avoid = ["mean_reversion"];
  } else if (adx >= 25) {
    regime = "weak_trend";
    confidence = Math.min(80, 50 + adx);
    recommended = ["trend_pullback", "pa", "structure"];
    avoid = [];
  } else if (bb_width_pct < 2.0 && atr_pct < 1.0) {
    regime = "compressed";
    confidence = Math.min(85, 60 + (2.0 - bb_width_pct) * 20);
    recommended = ["structure"]; // 等待突破
    avoid = ["trend_pullback", "trend_confirm"];
  } else if (atr_pct >= 2.5) {
    regime = "volatile";
    confidence = Math.min(80, 50 + atr_pct * 10);
    recommended = ["pa", "structure"];
    avoid = ["trend_confirm", "mean_reversion"];
  } else {
    regime = "ranging";
    confidence = Math.min(75, 50 + (25 - adx) * 2);
    recommended = ["mean_reversion", "pa"];
    avoid = ["trend_pullback", "trend_confirm"];
  }

  return { regime, confidence, adx, atr_pct, bb_width_pct, recommended_families: recommended, avoid_families: avoid };
}

// ─────────────────────────────────────────────────────────────────
// 3. 進場品質強化（Entry Quality Gate）
// ─────────────────────────────────────────────────────────────────
// 核心理念：在原有信號基礎上，加入多維度品質檢查。

export interface EntryQualityResult {
  pass: boolean;
  quality_score: number;  // 0-100
  checks: {
    volume_confirmed: boolean;
    momentum_aligned: boolean;
    not_overextended: boolean;
    rsi_not_extreme: boolean;
    spread_healthy: boolean;
    higher_tf_aligned: boolean;
  };
  rejection_reason?: string;
}

export function checkEntryQuality(
  candles1h: Candle[],
  candles4h: Candle[],
  direction: "long" | "short",
  minQualityScore?: number
): EntryQualityResult {
  const minScore = minQualityScore ?? 60;
  const n = candles1h.length;
  if (n < 30) {
    return { pass: false, quality_score: 0, checks: { volume_confirmed: false, momentum_aligned: false, not_overextended: false, rsi_not_extreme: false, spread_healthy: false, higher_tf_aligned: false }, rejection_reason: "K 線不足" };
  }

  const close = candles1h[n - 1].close;
  const vol = candles1h[n - 1].volume;
  const avgVol = candles1h.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;

  // (a) 成交量確認：當前 >= 平均的 80%
  const volume_confirmed = vol >= avgVol * 0.8;

  // (b) 動量對齊：最近 3 根 K 線的收盤方向與信號一致
  const recent3 = candles1h.slice(-3);
  const bullBars = recent3.filter(c => c.close > c.open).length;
  const momentum_aligned = direction === "long" ? bullBars >= 2 : (3 - bullBars) >= 2;

  // (c) 未過度延伸：價格距離 EMA20 不超過 2 ATR
  const ema20Closes = candles1h.slice(-20).map(c => c.close);
  const ema20 = ema20Closes.reduce((a, b) => a + b, 0) / 20;
  let atrSum = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    const prev = candles1h[i - 1].close;
    atrSum += Math.max(candles1h[i].high - candles1h[i].low, Math.abs(candles1h[i].high - prev), Math.abs(candles1h[i].low - prev));
  }
  const atr = atrSum / Math.min(14, n - 1);
  const distFromEma = Math.abs(close - ema20);
  const not_overextended = distFromEma < atr * 2.5;

  // (d) RSI 非極端：RSI 不在超買/超賣區（做多時 RSI < 75，做空時 RSI > 25）
  const rsiPeriod = 14;
  let gains = 0, losses = 0;
  for (let i = n - rsiPeriod; i < n; i++) {
    const diff = candles1h[i].close - candles1h[i - 1].close;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
  const rsi = 100 - 100 / (1 + rs);
  const rsi_not_extreme = direction === "long" ? rsi < 75 : rsi > 25;

  // (e) 價差健康：最近 K 線的影線比例合理（非長上/下影線陷阱）
  const lastCandle = candles1h[n - 1];
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const range = lastCandle.high - lastCandle.low;
  const spread_healthy = range > 0 ? body / range >= 0.3 : true;

  // (f) 高週期對齊：4H EMA20 方向與信號一致
  let higher_tf_aligned = true;
  if (candles4h.length >= 25) {
    const closes4h = candles4h.slice(-25).map(c => c.close);
    const ema20_4h = closes4h.reduce((a, b) => a + b, 0) / closes4h.length;
    const last4hClose = closes4h[closes4h.length - 1];
    if (direction === "long" && last4hClose < ema20_4h * 0.998) higher_tf_aligned = false;
    if (direction === "short" && last4hClose > ema20_4h * 1.002) higher_tf_aligned = false;
  }

  // 計算品質分數
  const weights = {
    volume_confirmed: 15,
    momentum_aligned: 20,
    not_overextended: 15,
    rsi_not_extreme: 15,
    spread_healthy: 10,
    higher_tf_aligned: 25,
  };

  let score = 0;
  if (volume_confirmed) score += weights.volume_confirmed;
  if (momentum_aligned) score += weights.momentum_aligned;
  if (not_overextended) score += weights.not_overextended;
  if (rsi_not_extreme) score += weights.rsi_not_extreme;
  if (spread_healthy) score += weights.spread_healthy;
  if (higher_tf_aligned) score += weights.higher_tf_aligned;

  const checks = { volume_confirmed, momentum_aligned, not_overextended, rsi_not_extreme, spread_healthy, higher_tf_aligned };
  const pass = score >= minScore;

  let rejection_reason: string | undefined;
  if (!pass) {
    const failed: string[] = [];
    if (!volume_confirmed) failed.push("成交量不足");
    if (!momentum_aligned) failed.push("動量方向不一致");
    if (!not_overextended) failed.push("價格過度延伸");
    if (!rsi_not_extreme) failed.push("RSI 極端值");
    if (!spread_healthy) failed.push("K 線形態不健康");
    if (!higher_tf_aligned) failed.push("高週期方向不一致");
    rejection_reason = failed.join("、");
  }

  return { pass, quality_score: score, checks, rejection_reason };
}

// ─────────────────────────────────────────────────────────────────
// 4. 智能出場優化（Smart Exit Suggestions）
// ─────────────────────────────────────────────────────────────────
// 核心理念：根據市況動態調整 TP/SL 比例，而非固定倍數。

export interface SmartExitPlan {
  adjusted_tp_mult: number;
  adjusted_sl_mult: number;
  use_trailing: boolean;
  trailing_activation_r: number;  // 獲利幾 R 後啟動移動止損
  partial_exit_at_1r: boolean;    // 1R 獲利時平一半
  reasoning: string;
}

export function calcSmartExit(
  regime: MarketRegime,
  family: string,
  baseTpMult: number,
  baseSlMult: number,
  atr_pct: number
): SmartExitPlan {
  let tp = baseTpMult;
  let sl = baseSlMult;
  let trailing = false;
  let trailingR = 1.5;
  let partial = false;
  let reasoning = "";

  if (regime === "strong_trend") {
    // 強趨勢：放大 TP，啟用移動止損
    tp = baseTpMult * 1.5;
    trailing = true;
    trailingR = 1.0;
    reasoning = "強趨勢市況：放大止盈目標 1.5 倍，1R 後啟用移動止損追蹤利潤";
  } else if (regime === "weak_trend") {
    // 弱趨勢：適度放大 TP
    tp = baseTpMult * 1.2;
    trailing = true;
    trailingR = 1.5;
    reasoning = "弱趨勢市況：適度放大止盈 1.2 倍，1.5R 後啟用移動止損";
  } else if (regime === "ranging") {
    // 震盪市：縮小 TP，快速獲利了結
    tp = baseTpMult * 0.8;
    sl = baseSlMult * 0.9;
    partial = true;
    reasoning = "震盪市況：縮小止盈至 0.8 倍加速獲利，1R 時平倉一半鎖定利潤";
  } else if (regime === "volatile") {
    // 高波動：放寬 SL 避免被洗出，但也放大 TP
    tp = baseTpMult * 1.3;
    sl = baseSlMult * 1.3;
    trailing = true;
    trailingR = 1.0;
    reasoning = "高波動市況：SL/TP 同步放大 1.3 倍避免假突破洗出，1R 後啟用移動止損";
  } else if (regime === "compressed") {
    // 壓縮盤整：等待突破，一旦突破則追蹤
    tp = baseTpMult * 2.0;
    trailing = true;
    trailingR = 0.8;
    reasoning = "壓縮盤整：突破後目標放大 2 倍，0.8R 即啟用移動止損捕捉大行情";
  }

  return {
    adjusted_tp_mult: Math.round(tp * 100) / 100,
    adjusted_sl_mult: Math.round(sl * 100) / 100,
    use_trailing: trailing,
    trailing_activation_r: trailingR,
    partial_exit_at_1r: partial,
    reasoning,
  };
}

// ─────────────────────────────────────────────────────────────────
// 5. 時段過濾（Session Filter）
// ─────────────────────────────────────────────────────────────────
// 核心理念：BTC 在倫敦/紐約重疊時段的波動性和方向性最強。

export interface SessionInfo {
  session: "asia" | "london" | "newyork" | "overlap" | "offhours";
  is_high_quality: boolean;
  quality_multiplier: number;
}

export function getSessionInfo(timestampMs?: number): SessionInfo {
  const d = timestampMs ? new Date(timestampMs) : new Date();
  const utcHour = d.getUTCHours();

  // UTC 時段定義
  if (utcHour >= 13 && utcHour < 17) {
    return { session: "overlap", is_high_quality: true, quality_multiplier: 1.3 };
  } else if (utcHour >= 7 && utcHour < 13) {
    return { session: "london", is_high_quality: true, quality_multiplier: 1.15 };
  } else if (utcHour >= 13 && utcHour < 22) {
    return { session: "newyork", is_high_quality: true, quality_multiplier: 1.1 };
  } else if (utcHour >= 0 && utcHour < 7) {
    return { session: "asia", is_high_quality: false, quality_multiplier: 0.85 };
  } else {
    return { session: "offhours", is_high_quality: false, quality_multiplier: 0.7 };
  }
}

// ─────────────────────────────────────────────────────────────────
// 6. 波動率自適應（Volatility Adaptive）
// ─────────────────────────────────────────────────────────────────
// 核心理念：當波動率異常低或異常高時，調整信號門檻。

export interface VolatilityAdaptive {
  atr_percentile: number;  // ATR 在近 50 根中的百分位
  is_low_vol: boolean;     // < 25th percentile
  is_high_vol: boolean;    // > 75th percentile
  score_adjustment: number; // 對 signal_score 的調整
  reasoning: string;
}

export function calcVolatilityAdaptive(candles: Candle[]): VolatilityAdaptive {
  if (candles.length < 50) {
    return { atr_percentile: 50, is_low_vol: false, is_high_vol: false, score_adjustment: 0, reasoning: "K 線不足" };
  }

  // 計算每根 K 線的 TR
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prev), Math.abs(candles[i].low - prev)));
  }

  // 計算滾動 14 期 ATR
  const atrs: number[] = [];
  for (let i = 13; i < trs.length; i++) {
    const slice = trs.slice(i - 13, i + 1);
    atrs.push(slice.reduce((a, b) => a + b, 0) / 14);
  }

  if (atrs.length < 2) {
    return { atr_percentile: 50, is_low_vol: false, is_high_vol: false, score_adjustment: 0, reasoning: "ATR 數據不足" };
  }

  const currentAtr = atrs[atrs.length - 1];
  const sortedAtrs = [...atrs].sort((a, b) => a - b);
  const rank = sortedAtrs.findIndex(a => a >= currentAtr);
  const percentile = Math.round((rank / sortedAtrs.length) * 100);

  const is_low_vol = percentile < 25;
  const is_high_vol = percentile > 75;

  let score_adjustment = 0;
  let reasoning = "";

  if (is_low_vol) {
    score_adjustment = 1.0; // 低波動時提高門檻（加分要求更高）
    reasoning = `低波動環境（ATR 百分位 ${percentile}%）：提高進場門檻 +1.0 分，避免在死水市場中交易`;
  } else if (is_high_vol) {
    score_adjustment = -0.5; // 高波動時略微放寬（機會更多但風險也大）
    reasoning = `高波動環境（ATR 百分位 ${percentile}%）：略微放寬門檻 -0.5 分，但需配合移動止損`;
  } else {
    reasoning = `正常波動環境（ATR 百分位 ${percentile}%）：維持標準門檻`;
  }

  return { atr_percentile: percentile, is_low_vol, is_high_vol, score_adjustment, reasoning };
}

// ─────────────────────────────────────────────────────────────────
// 整合：勝率提升綜合評估
// ─────────────────────────────────────────────────────────────────

export interface WinRateBoostResult {
  should_trade: boolean;
  final_score: number;           // 綜合評分 0-100
  consensus: ConsensusResult;
  regime: RegimeResult;
  entry_quality: EntryQualityResult;
  exit_plan: SmartExitPlan;
  session: SessionInfo;
  volatility: VolatilityAdaptive;
  reasoning: string[];
}

export function evaluateSignal(
  signals: StrategySignal[],
  targetKey: string,
  candles1h: Candle[],
  candles4h: Candle[],
  family: string,
  baseTpMult: number,
  baseSlMult: number,
  minFinalScore?: number
): WinRateBoostResult {
  const threshold = minFinalScore ?? 40;
  const reasoning: string[] = [];

  // 1. 多策略共振
  const consensus = calcCrossStrategyConsensus(signals);
  if (consensus.is_strong_consensus) {
    reasoning.push(`多策略共振：${consensus.agreeing_strategies.length} 個策略同向 ${consensus.consensus_direction}（加乘 ${consensus.boost_multiplier}x）`);
  }

  // 2. 市況感知
  const regime = detectMarketRegime(candles1h);
  const isRecommended = regime.recommended_families.includes(family);
  const isAvoided = regime.avoid_families.includes(family);
  if (isRecommended) reasoning.push(`市況有利：${regime.regime} 推薦 ${family} 家族`);
  if (isAvoided) reasoning.push(`市況不利：${regime.regime} 不推薦 ${family} 家族`);

  // 3. 找到目標策略的信號
  const targetSignal = signals.find(s => s.key === targetKey);
  const direction = targetSignal?.direction ?? consensus.consensus_direction;
  if (!direction) {
    return {
      should_trade: false, final_score: 0, consensus, regime,
      entry_quality: { pass: false, quality_score: 0, checks: { volume_confirmed: false, momentum_aligned: false, not_overextended: false, rsi_not_extreme: false, spread_healthy: false, higher_tf_aligned: false }, rejection_reason: "無信號方向" },
      exit_plan: calcSmartExit(regime.regime, family, baseTpMult, baseSlMult, regime.atr_pct),
      session: getSessionInfo(), volatility: calcVolatilityAdaptive(candles1h),
      reasoning: ["無有效信號方向"],
    };
  }

  // 4. 進場品質
  const entryQuality = checkEntryQuality(candles1h, candles4h, direction);
  if (!entryQuality.pass) reasoning.push(`進場品質不足：${entryQuality.rejection_reason}`);

  // 5. 智能出場
  const exitPlan = calcSmartExit(regime.regime, family, baseTpMult, baseSlMult, regime.atr_pct);
  reasoning.push(exitPlan.reasoning);

  // 6. 時段
  const session = getSessionInfo();
  if (!session.is_high_quality) reasoning.push(`非最佳交易時段（${session.session}）：品質乘數 ${session.quality_multiplier}x`);

  // 7. 波動率
  const volatility = calcVolatilityAdaptive(candles1h);
  if (volatility.score_adjustment !== 0) reasoning.push(volatility.reasoning);

  // 綜合評分
  let score = 0;
  // 基礎分：進場品質（40%）
  score += entryQuality.quality_score * 0.4;
  // 共振分（25%）
  score += consensus.consensus_score * 0.25;
  // 市況匹配分（20%）
  score += (isRecommended ? 20 : isAvoided ? 5 : 12);
  // 時段分（15%）
  score += session.quality_multiplier * 12;

  // 乘數調整
  score *= consensus.boost_multiplier;
  score *= session.quality_multiplier;

  // 波動率調整（間接影響）
  if (volatility.is_low_vol) score *= 0.85;

  const finalScore = Math.round(Math.min(100, score));
  const shouldTrade = finalScore >= threshold && entryQuality.quality_score >= 30;

  return {
    should_trade: shouldTrade,
    final_score: finalScore,
    consensus, regime, entry_quality: entryQuality, exit_plan: exitPlan,
    session, volatility, reasoning,
  };
}
