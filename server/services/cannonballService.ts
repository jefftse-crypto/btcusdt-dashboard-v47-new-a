/**
 * cannonballService.ts — CannonBall 交易方法分析服務 v2.0
 *
 * 方法論來源：CannonBall (cannonball3d) @ LuxAlgo Discord
 * 核心邏輯：市場結構驅動的多時間框架 OB 回補交易法
 *
 * v2.0 改良：
 *  - 策略參數全部可配置（SL 倍數、TP2 倍數、Confluence 閾值、Avoid Extremes 閾值）
 *  - HTF/LTF 時間框架可配置（預設 2H / 30m）
 *  - Money Flow 改用 RVOL（相對成交量）加權判斷，取代簡單 K 線計數
 *  - TP2 優先使用第二個 HTF 結構目標（HH/LL），退而求其次才用 ATR 延伸
 */

import { fetchCandles } from "../analysis.js";
import {
  detectOrderBlocks,
  detectBosChoch,
  findSwingHighs,
  findSwingLows,
  calcAtrLast,
} from "../utils/indicators.js";

// ─── 策略參數介面 ─────────────────────────────────────────────────────────────

export interface CannonballParams {
  /** HTF 時間框架（預設 "2H"） */
  htf_tf?: string;
  /** LTF 時間框架（預設 "30m"） */
  ltf_tf?: string;
  /** HTF K 線數量（預設 200） */
  htf_limit?: number;
  /** LTF K 線數量（預設 200） */
  ltf_limit?: number;
  /** 止損 ATR 倍數（預設 0.3，範圍 0.1~0.8） */
  sl_atr_mult?: number;
  /** TP2 ATR 延伸倍數（預設 2.5，僅在無第二結構目標時使用，範圍 1.0~4.0） */
  tp2_atr_mult?: number;
  /** Confluence 評分閾值（預設 50，範圍 40~80） */
  confluence_threshold?: number;
  /** Avoid Extremes ATR 閾值（預設 0.8，範圍 0.3~1.5） */
  avoid_extremes_atr?: number;
}

// ─── 型別定義 ─────────────────────────────────────────────────────────────────

export interface CannonballOB {
  top: number;
  bottom: number;
  mid: number;
  strength: "strong" | "normal";
  quality: number;
  bos_confirmed: boolean;
  tested_count: number;
  in_mitigation: boolean;
}

export interface CannonballStructureEvent {
  type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  price: number;
  confirmed: boolean;
}

export interface CannonballFilter {
  avoid_extremes: boolean;
  body_close_confirmed: boolean;
  confluence_score: number;
  money_flow_bullish: boolean;
  wick_clean: boolean;
  rvol: number;
}

export interface CannonballChecklist {
  htf_structure_valid: boolean;
  price_in_ob: boolean;
  structure_event_confirmed: boolean;
  avoid_extremes_pass: boolean;
  confluence_pass: boolean;
  all_pass: boolean;
}

export interface CannonballEntryPlan {
  direction: "long" | "short" | "wait";
  entry_zone_top: number;
  entry_zone_bottom: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  rr_ratio: number;
  sl_basis: string;
  tp_basis: string;
}

export interface CannonballAnalysis {
  symbol: string;
  generated_at: string;
  current_price: number;
  atr_2h: number;
  htf_tf: string;
  ltf_tf: string;
  params_used: Required<CannonballParams>;
  htf_structure: {
    direction: "bullish" | "bearish" | "ranging";
    last_event: CannonballStructureEvent | null;
    recent_hh: number | null;
    recent_ll: number | null;
    recent_hl: number | null;
    recent_lh: number | null;
    bull_obs: CannonballOB[];
    bear_obs: CannonballOB[];
    nearest_bull_ob: CannonballOB | null;
    nearest_bear_ob: CannonballOB | null;
  };
  ltf_structure: {
    direction: "bullish" | "bearish" | "ranging";
    last_event: CannonballStructureEvent | null;
    recent_events: CannonballStructureEvent[];
    bull_obs: CannonballOB[];
    bear_obs: CannonballOB[];
    nearest_bull_ob: CannonballOB | null;
    nearest_bear_ob: CannonballOB | null;
  };
  filters: CannonballFilter;
  checklist: CannonballChecklist;
  entry_plan: CannonballEntryPlan;
  status: "ready_long" | "ready_short" | "waiting_mitigation" | "waiting_confirmation" | "filtered_out" | "ranging";
  status_message: string;
  confidence: number;
}

// ─── 預設參數 ─────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS: Required<CannonballParams> = {
  htf_tf: "2H",
  ltf_tf: "30m",
  htf_limit: 200,
  ltf_limit: 200,
  sl_atr_mult: 0.3,
  tp2_atr_mult: 2.5,
  confluence_threshold: 50,
  avoid_extremes_atr: 0.8,
};

// ─── 工具函數 ─────────────────────────────────────────────────────────────────

function getStructureDirection(
  events: { type: string; direction: string; confirmed: boolean }[]
): "bullish" | "bearish" | "ranging" {
  const confirmed = events.filter(e => e.confirmed);
  if (confirmed.length === 0) return "ranging";
  const last = confirmed[confirmed.length - 1];
  if (last.type === "CHoCH") return last.direction as "bullish" | "bearish";
  if (last.type === "BOS") return last.direction as "bullish" | "bearish";
  return "ranging";
}

function mapOBToCannonball(
  ob: { top: number; bottom: number; mid: number; strength: "strong" | "normal"; quality: number; bos_confirmed: boolean; tested_count: number; displacement?: boolean },
  close: number,
  atr: number
): CannonballOB {
  const tolerance = atr * 0.1;
  const in_mitigation = close >= ob.bottom - tolerance && close <= ob.top + tolerance;
  return {
    top: ob.top,
    bottom: ob.bottom,
    mid: ob.mid,
    strength: ob.strength,
    quality: ob.quality,
    bos_confirmed: ob.bos_confirmed,
    tested_count: ob.tested_count,
    in_mitigation,
  };
}

/** 計算 RVOL（相對成交量）：當前 K 線成交量 / 近 20 期均量 */
function calcRvol(candles: { volume: number }[]): number {
  if (candles.length < 2) return 1;
  const recent = candles.slice(-21);
  const avgVol = recent.slice(0, -1).reduce((s, c) => s + c.volume, 0) / Math.max(recent.length - 1, 1);
  const curVol = candles[candles.length - 1].volume;
  return avgVol > 0 ? curVol / avgVol : 1;
}

/** 找到第二個 HTF 結構目標（用於 TP2） */
function findSecondStructureTarget(
  swingPoints: { price: number; idx: number }[],
  direction: "bullish" | "bearish",
  firstTarget: number | null
): number | null {
  if (!firstTarget || swingPoints.length < 2) return null;
  const candidates = direction === "bullish"
    ? swingPoints.filter(p => p.price > firstTarget).sort((a, b) => a.price - b.price)
    : swingPoints.filter(p => p.price < firstTarget).sort((a, b) => b.price - a.price);
  return candidates[0]?.price ?? null;
}

// ─── 主分析函數 ───────────────────────────────────────────────────────────────

const _inFlight = new Map<string, Promise<CannonballAnalysis>>();

export async function runCannonballAnalysis(
  symbol: string,
  params: CannonballParams = {}
): Promise<CannonballAnalysis> {
  const sym = symbol.toUpperCase();
  const resolvedParams: Required<CannonballParams> = { ...DEFAULT_PARAMS, ...params };
  const cacheKey = `${sym}:${resolvedParams.htf_tf}:${resolvedParams.ltf_tf}:${resolvedParams.sl_atr_mult}:${resolvedParams.tp2_atr_mult}:${resolvedParams.confluence_threshold}:${resolvedParams.avoid_extremes_atr}`;
  if (_inFlight.has(cacheKey)) return _inFlight.get(cacheKey)!;
  const promise = _runAnalysis(sym, resolvedParams).finally(() => _inFlight.delete(cacheKey));
  _inFlight.set(cacheKey, promise);
  return promise;
}

async function _runAnalysis(sym: string, p: Required<CannonballParams>): Promise<CannonballAnalysis> {
  // 1. 抓取 HTF 與 LTF K 線（並行但加 100ms 間隔避免 Kraken 限速）
  const htfPromise = fetchCandles(sym, p.htf_tf, p.htf_limit);
  await new Promise(r => setTimeout(r, 100));
  const ltfPromise = fetchCandles(sym, p.ltf_tf, p.ltf_limit);
  const [candlesHtf, candlesLtf] = await Promise.all([htfPromise, ltfPromise]);

  const close = candlesHtf[candlesHtf.length - 1].close;
  const atrHtf = calcAtrLast(candlesHtf, 14);
  const atrLtf = calcAtrLast(candlesLtf, 14);

  // 2. HTF 大結構分析
  const bosChochHtf = detectBosChoch(candlesHtf);
  const obsHtf = detectOrderBlocks(candlesHtf, close);
  const swingHighsHtf = findSwingHighs(candlesHtf, 5).slice(-10);
  const swingLowsHtf  = findSwingLows(candlesHtf, 5).slice(-10);

  const htfDirection = getStructureDirection(bosChochHtf.events);
  const htfLastEvent = bosChochHtf.events.filter(e => e.confirmed).slice(-1)[0] ?? null;

  let recentHH: number | null = null;
  let recentLL: number | null = null;
  let recentHL: number | null = null;
  let recentLH: number | null = null;

  if (swingHighsHtf.length >= 2) {
    const last2Highs = swingHighsHtf.slice(-2);
    recentHH = last2Highs[1].price > last2Highs[0].price ? last2Highs[1].price : null;
    recentLH = last2Highs[1].price < last2Highs[0].price ? last2Highs[1].price : null;
  }
  if (swingLowsHtf.length >= 2) {
    const last2Lows = swingLowsHtf.slice(-2);
    recentHL = last2Lows[1].price > last2Lows[0].price ? last2Lows[1].price : null;
    recentLL = last2Lows[1].price < last2Lows[0].price ? last2Lows[1].price : null;
  }

  const htfBullOBs = obsHtf.allBull.slice(0, 5).map(o => mapOBToCannonball(o, close, atrHtf));
  const htfBearOBs = obsHtf.allBear.slice(0, 5).map(o => mapOBToCannonball(o, close, atrHtf));
  const htfNearestBull = obsHtf.nearestBull ? mapOBToCannonball(obsHtf.nearestBull, close, atrHtf) : null;
  const htfNearestBear = obsHtf.nearestBear ? mapOBToCannonball(obsHtf.nearestBear, close, atrHtf) : null;

  // 3. LTF 執行層分析
  const bosChochLtf = detectBosChoch(candlesLtf);
  const obsLtf = detectOrderBlocks(candlesLtf, close);
  const ltfDirection = getStructureDirection(bosChochLtf.events);
  const ltfLastEvent = bosChochLtf.events.filter(e => e.confirmed).slice(-1)[0] ?? null;
  const ltfRecentEvents: CannonballStructureEvent[] = bosChochLtf.events
    .filter(e => e.confirmed)
    .slice(-5)
    .map(e => ({
      type: e.type as "BOS" | "CHoCH",
      direction: e.direction as "bullish" | "bearish",
      price: e.price,
      confirmed: e.confirmed,
    }));

  const ltfBullOBs = obsLtf.allBull.slice(0, 5).map(o => mapOBToCannonball(o, close, atrLtf));
  const ltfBearOBs = obsLtf.allBear.slice(0, 5).map(o => mapOBToCannonball(o, close, atrLtf));
  const ltfNearestBull = obsLtf.nearestBull ? mapOBToCannonball(obsLtf.nearestBull, close, atrLtf) : null;
  const ltfNearestBear = obsLtf.nearestBear ? mapOBToCannonball(obsLtf.nearestBear, close, atrLtf) : null;

  // 4. 過濾器計算
  const nearestHighHtf = swingHighsHtf.length > 0 ? swingHighsHtf[swingHighsHtf.length - 1].price : close * 1.05;
  const nearestLowHtf  = swingLowsHtf.length > 0  ? swingLowsHtf[swingLowsHtf.length - 1].price  : close * 0.95;
  const distToHigh = (nearestHighHtf - close) / (atrHtf + 0.001);
  const distToLow  = (close - nearestLowHtf)  / (atrHtf + 0.001);
  const avoidExtremesLong  = distToHigh > p.avoid_extremes_atr;
  const avoidExtremesShort = distToLow  > p.avoid_extremes_atr;
  const avoid_extremes = htfDirection === "bullish" ? avoidExtremesLong : avoidExtremesShort;

  const body_close_confirmed = ltfLastEvent?.confirmed ?? false;

  // Wick Clean：突破 K 線實體佔比 > 50%
  let wick_clean = false;
  if (ltfLastEvent) {
    const rawEvents = bosChochLtf.events.filter(e => e.confirmed);
    const rawLastEvent = rawEvents[rawEvents.length - 1];
    if (rawLastEvent && rawLastEvent.idx < candlesLtf.length) {
      const breakCandle = candlesLtf[rawLastEvent.idx];
      const totalRange = breakCandle.high - breakCandle.low;
      const bodySize = Math.abs(breakCandle.close - breakCandle.open);
      wick_clean = totalRange > 0 ? (bodySize / totalRange) > 0.5 : false;
    }
  }

  // Money Flow：RVOL 加權（F 改良）
  const rvol = calcRvol(candlesLtf);
  const recent5 = candlesLtf.slice(-5);
  const upBars = recent5.filter(c => c.close > c.open).length;
  const rvolWeight = rvol >= 1.5 ? 1.2 : rvol >= 1.0 ? 1.0 : 0.7;
  const money_flow_bullish = (upBars >= 3 && rvolWeight >= 1.0) || (upBars >= 4);

  // Confluence 評分
  let confluenceScore = 0;
  if (htfDirection !== "ranging") confluenceScore += 25;
  if (body_close_confirmed) confluenceScore += 20;
  if (avoid_extremes) confluenceScore += 20;
  if (wick_clean) confluenceScore += 15;
  if (htfDirection === "bullish" && money_flow_bullish) {
    confluenceScore += Math.round(10 * Math.min(rvolWeight, 1.2));
  } else if (htfDirection === "bearish" && !money_flow_bullish) {
    confluenceScore += Math.round(10 * Math.min(rvolWeight, 1.2));
  }
  if (htfDirection !== "ranging" && ltfDirection === htfDirection) confluenceScore += 10;

  const filters: CannonballFilter = {
    avoid_extremes,
    body_close_confirmed,
    confluence_score: Math.min(100, confluenceScore),
    money_flow_bullish,
    wick_clean,
    rvol: parseFloat(rvol.toFixed(2)),
  };

  // 5. 進場檢查清單
  const inBullOB = htfNearestBull?.in_mitigation || ltfNearestBull?.in_mitigation || false;
  const inBearOB = htfNearestBear?.in_mitigation || ltfNearestBear?.in_mitigation || false;
  const price_in_ob = htfDirection === "bullish" ? inBullOB : inBearOB;

  const recentConfirmedEvents = ltfRecentEvents.filter(e => e.confirmed);
  const hasLongConfirmation  = recentConfirmedEvents.some(e => e.direction === "bullish" && (e.type === "CHoCH" || e.type === "BOS"));
  const hasShortConfirmation = recentConfirmedEvents.some(e => e.direction === "bearish" && (e.type === "CHoCH" || e.type === "BOS"));
  const structure_event_confirmed = htfDirection === "bullish" ? hasLongConfirmation : hasShortConfirmation;

  const checklist: CannonballChecklist = {
    htf_structure_valid: htfDirection !== "ranging",
    price_in_ob,
    structure_event_confirmed,
    avoid_extremes_pass: avoid_extremes,
    confluence_pass: confluenceScore >= p.confluence_threshold,
    all_pass: htfDirection !== "ranging" && price_in_ob && structure_event_confirmed && avoid_extremes && confluenceScore >= p.confluence_threshold,
  };

  // 6. 進場計劃（G 改良：TP2 優先使用第二個 HTF 結構目標）
  let entryPlan: CannonballEntryPlan;
  if (htfDirection === "bullish" && checklist.all_pass && htfNearestBull) {
    const ob = htfNearestBull;
    const sl = ob.bottom - atrHtf * p.sl_atr_mult;
    const tp1 = recentHH ?? close + atrHtf * 2;
    const secondHH = findSecondStructureTarget(swingHighsHtf, "bullish", recentHH);
    const tp2 = secondHH ?? (tp1 + atrHtf * p.tp2_atr_mult);
    const rr = tp1 > close ? (tp1 - close) / (close - sl) : 0;
    const tp2Basis = secondHH
      ? `TP2: 第二 HTF Swing High (${secondHH.toFixed(4)})`
      : `TP2: 延伸 ${p.tp2_atr_mult} ATR`;
    entryPlan = {
      direction: "long",
      entry_zone_top: ob.top,
      entry_zone_bottom: ob.bottom,
      stop_loss: parseFloat(sl.toFixed(4)),
      tp1: parseFloat(tp1.toFixed(4)),
      tp2: parseFloat(tp2.toFixed(4)),
      rr_ratio: parseFloat(rr.toFixed(2)),
      sl_basis: `HTF Bullish OB 底部外側 (${ob.bottom.toFixed(4)}) - ${p.sl_atr_mult} ATR`,
      tp_basis: `TP1: HTF 最近 HH 結構位 (${tp1.toFixed(4)}) | ${tp2Basis}`,
    };
  } else if (htfDirection === "bearish" && checklist.all_pass && htfNearestBear) {
    const ob = htfNearestBear;
    const sl = ob.top + atrHtf * p.sl_atr_mult;
    const tp1 = recentLL ?? close - atrHtf * 2;
    const secondLL = findSecondStructureTarget(swingLowsHtf, "bearish", recentLL);
    const tp2 = secondLL ?? (tp1 - atrHtf * p.tp2_atr_mult);
    const rr = close > tp1 ? (close - tp1) / (sl - close) : 0;
    const tp2Basis = secondLL
      ? `TP2: 第二 HTF Swing Low (${secondLL.toFixed(4)})`
      : `TP2: 延伸 ${p.tp2_atr_mult} ATR`;
    entryPlan = {
      direction: "short",
      entry_zone_top: ob.top,
      entry_zone_bottom: ob.bottom,
      stop_loss: parseFloat(sl.toFixed(4)),
      tp1: parseFloat(tp1.toFixed(4)),
      tp2: parseFloat(tp2.toFixed(4)),
      rr_ratio: parseFloat(rr.toFixed(2)),
      sl_basis: `HTF Bearish OB 頂部外側 (${ob.top.toFixed(4)}) + ${p.sl_atr_mult} ATR`,
      tp_basis: `TP1: HTF 最近 LL 結構位 (${tp1.toFixed(4)}) | ${tp2Basis}`,
    };
  } else {
    const refOB = htfDirection === "bullish" ? htfNearestBull : htfNearestBear;
    entryPlan = {
      direction: "wait",
      entry_zone_top: refOB?.top ?? close,
      entry_zone_bottom: refOB?.bottom ?? close,
      stop_loss: 0,
      tp1: 0,
      tp2: 0,
      rr_ratio: 0,
      sl_basis: "等待條件對齊後再計算",
      tp_basis: "等待條件對齊後再計算",
    };
  }

  // 7. 狀態判斷
  let status: CannonballAnalysis["status"];
  let status_message: string;
  let confidence = 0;

  if (htfDirection === "ranging") {
    status = "ranging";
    status_message = `${p.htf_tf} 結構震盪，無明確方向，等待結構選擇後再操作。`;
    confidence = 10;
  } else if (!checklist.avoid_extremes_pass) {
    status = "filtered_out";
    status_message = `Avoid Extremes 過濾觸發：當前價格距離 ${p.htf_tf} ${htfDirection === "bullish" ? "前高" : "前低"} 過近（< ${p.avoid_extremes_atr} ATR），不宜進場。`;
    confidence = 15;
  } else if (!checklist.price_in_ob) {
    status = "waiting_mitigation";
    const targetOB = htfDirection === "bullish" ? htfNearestBull : htfNearestBear;
    const zone = targetOB ? `${targetOB.bottom.toFixed(4)} – ${targetOB.top.toFixed(4)}` : "尋找有效 OB";
    status_message = `${p.htf_tf} 結構${htfDirection === "bullish" ? "看多" : "看空"}，等待價格回補 ${htfDirection === "bullish" ? "Bullish" : "Bearish"} OB（${zone}）。`;
    confidence = 30;
  } else if (!checklist.structure_event_confirmed) {
    status = "waiting_confirmation";
    status_message = `價格已進入 OB 區域，等待 ${p.ltf_tf} 出現收盤確認的 ${htfDirection === "bullish" ? "Bullish CHoCH/BOS" : "Bearish CHoCH/BOS"}。`;
    confidence = 55;
  } else if (!checklist.confluence_pass) {
    status = "filtered_out";
    status_message = `結構條件已滿足，但 Confluence 評分不足（${confluenceScore}/100 < ${p.confluence_threshold}），訊號不夠乾淨，暫緩進場。`;
    confidence = 40;
  } else if (checklist.all_pass && htfDirection === "bullish") {
    status = "ready_long";
    status_message = `全部條件對齊：${p.htf_tf} 看多 + OB 回補 + ${p.ltf_tf} 收盤確認 + 過濾器通過。可考慮在 OB 區域做多，止損放 OB 底部外側 ${p.sl_atr_mult} ATR。`;
    confidence = Math.min(95, 60 + confluenceScore * 0.35);
  } else if (checklist.all_pass && htfDirection === "bearish") {
    status = "ready_short";
    status_message = `全部條件對齊：${p.htf_tf} 看空 + OB 回補 + ${p.ltf_tf} 收盤確認 + 過濾器通過。可考慮在 OB 區域做空，止損放 OB 頂部外側 ${p.sl_atr_mult} ATR。`;
    confidence = Math.min(95, 60 + confluenceScore * 0.35);
  } else {
    status = "waiting_confirmation";
    status_message = "條件部分滿足，繼續等待所有條件對齊。";
    confidence = 35;
  }

  return {
    symbol: sym,
    generated_at: new Date().toISOString(),
    current_price: close,
    atr_2h: parseFloat(atrHtf.toFixed(4)),
    htf_tf: p.htf_tf,
    ltf_tf: p.ltf_tf,
    params_used: p,
    htf_structure: {
      direction: htfDirection,
      last_event: htfLastEvent
        ? {
            type: htfLastEvent.type as "BOS" | "CHoCH",
            direction: htfLastEvent.direction as "bullish" | "bearish",
            price: htfLastEvent.price,
            confirmed: htfLastEvent.confirmed,
          }
        : null,
      recent_hh: recentHH,
      recent_ll: recentLL,
      recent_hl: recentHL,
      recent_lh: recentLH,
      bull_obs: htfBullOBs,
      bear_obs: htfBearOBs,
      nearest_bull_ob: htfNearestBull,
      nearest_bear_ob: htfNearestBear,
    },
    ltf_structure: {
      direction: ltfDirection,
      last_event: ltfLastEvent
        ? {
            type: ltfLastEvent.type as "BOS" | "CHoCH",
            direction: ltfLastEvent.direction as "bullish" | "bearish",
            price: ltfLastEvent.price,
            confirmed: ltfLastEvent.confirmed,
          }
        : null,
      recent_events: ltfRecentEvents,
      bull_obs: ltfBullOBs,
      bear_obs: ltfBearOBs,
      nearest_bull_ob: ltfNearestBull,
      nearest_bear_ob: ltfNearestBear,
    },
    filters,
    checklist,
    entry_plan: entryPlan,
    status,
    status_message,
    confidence: Math.round(confidence),
  };
}
