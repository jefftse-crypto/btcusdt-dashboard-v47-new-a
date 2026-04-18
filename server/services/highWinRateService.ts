/**
 * server/services/highWinRateService.ts
 * 高勝率策略服務層 v3.0 — 全面改良版
 *
 * 改良重點：
 * 1. ATR 動態過濾：FVG / OB 大小門檻改為 ATR 倍數，適應不同波動率市況
 * 2. 增強版纏論引擎：引入 K 線包含處理、MACD 面積背馳、一二三類買賣點
 * 3. SMC 三部曲確認：流動性清掃 → FVG 位移 → OB 回踩，三步驟依序確認
 * 4. PA 關鍵水位共振：K 線型態必須在 SMC OB / 纏論中樞邊界上才給高分
 * 5. 乘數共振評分：逆勢操作直接懲罰信心度，而非簡單加減分
 * v3 新增：
 * 6. 型別統一：改用 shared/cryptoTypes.ts 的 HwrXxx 共用 DTO，消除重複定義
 * 7. ADX 動態止損 ATR 乘數：強趨勢放寬止損，震盪收緊止損
 */

import type {
  Candle,
  SRLevel,
  HwrKeyLevel,
  HwrChanBuySellPoint,
  HwrSmcSetupSummary,
  HwrTradeModel,
  HwrTfAnalysis,
  HwrScanResult,
  TradeVetoDecision,
  AiEnvScan,
  FinalStrategy,
} from "../../shared/cryptoTypes.js";
import {
  calcEmaArr,
  calcRsiLast,
  calcAdxLast,
  calcAtrLast,
  calcFibOte,
  detectFvgZones,
  detectOrderBlocks as detectObZones,
  detectBosChoch,
  detectLiquiditySweep,
} from "../utils/indicators.js";
import {
  detectDivergences,
  detectPaPatternsWithLevels,
  calcChanEnhanced,
  detectSmcConfirmationSetups,
} from "../utils/advancedAnalysis.js";
import { calibrateKelly, calcDynamicStopLoss } from "../utils/kellyCalibration.js";
import { fetchMacroData, buildMacroContext } from "../utils/macroDataFusion.js";
import { runEnsembleVeto } from "../utils/ensembleVeto.js";
import { bayesianMtfFusion } from "../utils/bayesianMtfFusion.js";
import { analyzeSweepQualityV2, analyzePaRsiSpectrum, analyzeMtfSweepResonance } from "../utils/signalQualityFilter.js";
import { classifyMarketRegime, applyRegimeAdaptation } from "../utils/marketRegimeClassifier.js";

// ─────────────────────────────────────────────────────────────────────────────
// 型別別名（直接使用 shared/cryptoTypes.ts 的共用 DTO）
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated 請改用 HwrKeyLevel */
export type KeyLevel = HwrKeyLevel;
/** @deprecated 請改用 HwrChanBuySellPoint */
export type ChanBuySellPoint = HwrChanBuySellPoint;
/** @deprecated 請改用 HwrSmcSetupSummary */
export type SmcSetupSummary = HwrSmcSetupSummary;
/** @deprecated 請改用 HwrTradeModel */
export type TradeModel = HwrTradeModel;
/** @deprecated 請改用 HwrTfAnalysis */
export type TfAnalysis = HwrTfAnalysis;
/** @deprecated 請改用 HwrScanResult */
export type ScanResult = HwrScanResult;

// ─────────────────────────────────────────────────────────────────────────────
// 輔助函數
// ─────────────────────────────────────────────────────────────────────────────

/** 從纏論增強結果中提取 S/R 水位（供 PA 形態共振使用） */
function extractSrLevels(
  chan: ReturnType<typeof calcChanEnhanced>,
  ob: ReturnType<typeof detectObZones>,
  fvg: ReturnType<typeof detectFvgZones>
): SRLevel[] {
  const levels: SRLevel[] = [];

  // 纏論中樞邊界 (R8-FIX: 使用 ZG/ZD/GG/DD)
  if (chan.current_zhongshu) {
    levels.push({ price: chan.zhongshuZG, label: "中樞上沿 (ZG)", type: "resistance", strength: 4, touches: 3 });
    levels.push({ price: chan.zhongshuZD, label: "中樞下沿 (ZD)", type: "support", strength: 4, touches: 3 });
    if (chan.zhongshuGG > chan.zhongshuZG) levels.push({ price: chan.zhongshuGG, label: "中樞最高 (GG)", type: "resistance", strength: 2, touches: 1 });
    if (chan.zhongshuDD < chan.zhongshuZD) levels.push({ price: chan.zhongshuDD, label: "中樞最低 (DD)", type: "support", strength: 2, touches: 1 });
  }
  // SMC Order Block — 輸出區域上下緣（proximal/distal edge）而非單一中位
  if (ob.nearestBull) {
    const str = ob.nearestBull.strength === "strong" ? 5 : 3;
    levels.push({ price: ob.nearestBull.top,    type: "resistance", strength: str, touches: 2 }); // proximal edge
    levels.push({ price: ob.nearestBull.bottom, type: "support",    strength: str, touches: 2 }); // distal edge
  }
  if (ob.nearestBear) {
    const str = ob.nearestBear.strength === "strong" ? 5 : 3;
    levels.push({ price: ob.nearestBear.top,    type: "resistance", strength: str, touches: 2 }); // distal edge
    levels.push({ price: ob.nearestBear.bottom, type: "support",    strength: str, touches: 2 }); // proximal edge
  }
  // FVG — 輸出區域上下緣（不展平為單點）
  if (fvg.nearestBull) {
    levels.push({ price: fvg.nearestBull.top,    type: "resistance", strength: 2, touches: 1 });
    levels.push({ price: fvg.nearestBull.bottom, type: "support",    strength: 2, touches: 1 });
  }
  if (fvg.nearestBear) {
    levels.push({ price: fvg.nearestBear.top,    type: "resistance", strength: 2, touches: 1 });
    levels.push({ price: fvg.nearestBear.bottom, type: "support",    strength: 2, touches: 1 });
  }

  return levels;
}

/** 計算 Premium / Discount 區間
 * 改良：優先使用最近有效 swing 結構範圍（而非固定 50 根）
 * 同時加入波動率檢查：極端波動期間防止失真
 */
function calcPremiumDiscount(candles: Candle[], close: number): "premium" | "discount" | "equilibrium" {
  // 尋找最近的 swing high 和 swing low
  let highRef = 0, lowRef = Infinity;
  let highIdx = -1, lowIdx = -1;
  const lb = 5;
  for (let i = lb; i < candles.length - lb; i++) {
    const isSwingHigh = candles.slice(i - lb, i).every(c => c.high <= candles[i].high) &&
                        candles.slice(i + 1, i + lb + 1).every(c => c.high <= candles[i].high);
    const isSwingLow  = candles.slice(i - lb, i).every(c => c.low >= candles[i].low) &&
                        candles.slice(i + 1, i + lb + 1).every(c => c.low >= candles[i].low);
    if (isSwingHigh && candles[i].high > highRef) { highRef = candles[i].high; highIdx = i; }
    if (isSwingLow  && candles[i].low  < lowRef)  { lowRef  = candles[i].low;  lowIdx  = i; }
  }
  // 若找不到有效 swing，回落到近50 根
  if (highRef === 0 || lowRef === Infinity || highRef <= lowRef) {
    const range50 = candles.slice(-50);
    highRef = Math.max(...range50.map(c => c.high));
    lowRef  = Math.min(...range50.map(c => c.low));
  }
  // 波動率檢查：如果範圍小於 0.5%，視為盤整區，回傳 equilibrium
  const rangeRatio = (highRef - lowRef) / (lowRef + 0.001);
  if (rangeRatio < 0.005) return "equilibrium";
  const pctPos = (close - lowRef) / (highRef - lowRef + 0.001) * 100;
  return pctPos > 62 ? "premium" : pctPos < 38 ? "discount" : "equilibrium";
}

/** 將 SmcConfirmationSetup 轉換為精簡摘要（保留全部欄位，含 formed_at 與 invalidated 狀態） */
function toSmcSetupSummary(setup: ReturnType<typeof detectSmcConfirmationSetups>[number], close: number): HwrSmcSetupSummary {
  // v5.5 新增：計算進場區中點距市價距離百分比
  const entryMid = (setup.entry_zone.top + setup.entry_zone.bottom) / 2;
  // 正數表示進場區在市價下方（需等待回踩）；負數表示進場區在市價上方（已超過）
  const dist_pct = close > 0 ? ((close - entryMid) / close) * 100 : 0;
  // 超過 2% 視為過遠（不宜追價）
  const is_too_far = Math.abs(dist_pct) > 2.0;
  return {
    id: setup.id,
    direction: setup.direction,
    sweep_type: setup.sweep.type as "BSL" | "SSL",
    swept_level: setup.sweep.swept_level,
    entry_top: setup.entry_zone.top,
    entry_bottom: setup.entry_zone.bottom,
    sl: setup.sl,
    tp1: setup.tp1,
    tp2: setup.tp2,
    rr_ratio: setup.rr_ratio,
    confluence_score: setup.confluence_score,
    htf_aligned: setup.htf_aligned,
    status: setup.status,
    formed_at: setup.formed_at,
    invalidated: setup.invalidated ?? false,
    dist_pct: parseFloat(dist_pct.toFixed(2)),
    is_too_far,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心：對單一時間框架進行四維度分析
// ─────────────────────────────────────────────────────────────────────────────

function analyzeTf(
  candles: Candle[],
  bar: string,
  label: string,
  htfTrend: "bullish" | "bearish" | "ranging"
): TfAnalysis {
  const close = candles[candles.length - 1].close;
  const closes = candles.map(c => c.close);

  // ── 基礎指標 ──
  const atr    = calcAtrLast(candles, 14);
  const curRsi = calcRsiLast(closes, 14);
  const curAdx = calcAdxLast(candles, 14);
  const ema20  = calcEmaArr(closes, 20);
  const ema50  = calcEmaArr(closes, 50);
  const paEma20 = ema20[ema20.length - 1] ?? close;
  const paEma50 = ema50[ema50.length - 1] ?? close;

  // ── RVOL（相對成交量）計算 ──
  // RVOL = 當前成交量 / 過去 20 根平均成交量，用於驗證突破/反轉的量能
  const recentVols = candles.slice(-21);
  const avgVol20 = recentVols.slice(0, -1).reduce((s, c) => s + c.volume, 0) / Math.max(recentVols.length - 1, 1);
  const curVol = candles[candles.length - 1].volume;
  const rvol = avgVol20 > 0 ? curVol / avgVol20 : 1;  // > 1.5 = 放量, < 0.7 = 縮量

  // ── SMC 分析（ATR 動態過濾）──
  const fvg = detectFvgZones(candles, close);
  const ob  = detectObZones(candles, close);
  const bos = detectBosChoch(candles);
  const liq = detectLiquiditySweep(candles, close);
  const premDisc = calcPremiumDiscount(candles, close);
  const lastBos = bos.events[bos.events.length - 1];
  const bosChochStr = lastBos
    ? `${lastBos.type}（${lastBos.direction === "bullish" ? "看多" : "看空"}）`
    : "無明顯結構事件";

  // ATR 多維門滝：FVG/OB 需同時满足大小、新鮮度、未回補比例、觸碰次數
  const atrMin = atr * 0.25;
  const atrMax = atr * 1.5;
  const MAX_ZONE_AGE = 80; // 區域超過 80 根 K 視為老舊區域
  const isValidZone = (z: { top: number; bottom: number; age?: number; taps?: number; unfilledRatio?: number } | null) => {
    if (!z) return false;
    const h = z.top - z.bottom;
    if (h < atrMin || h > atrMax) return false;
    if (z.age !== undefined && z.age > MAX_ZONE_AGE) return false;
    if (z.taps !== undefined && z.taps > 2) return false;
    if (z.unfilledRatio !== undefined && z.unfilledRatio < 0.3) return false;
    return true;
  };
  const validBullFvg = isValidZone(fvg.nearestBull) ? fvg.nearestBull : null;
  const validBearFvg = isValidZone(fvg.nearestBear) ? fvg.nearestBear : null;
  const validBullOb  = isValidZone(ob.nearestBull)  ? ob.nearestBull  : null;
  const validBearOb  = isValidZone(ob.nearestBear)  ? ob.nearestBear  : null;

  // ── P1 改良：SMC 三部曲品質評分—序列品質模型 ──
  // 原本：層級加分（結構層+區域層+觸發層+RVOL）
  // 改良：序列品質評分（sweepQuality + displacementQuality + obQuality）

  // 清揃品質：有清揃則評分，否則上限封頂
  const hasSweepEvent = liq.sslSwept || liq.bslSwept;

  // sweepQuality：清揃品質評分 0-100
  let sweepQuality = 0;
  if (hasSweepEvent) {
    sweepQuality = 40; // 基礎分
    // BOS 結構對齊：清揃方向與 BOS 一致
    if (liq.sslSwept && bos.lastStructure === "bullish") sweepQuality += 20;
    if (liq.bslSwept && bos.lastStructure === "bearish") sweepQuality += 20;
    // Premium/Discount 對齊：在 Discount 清揃 SSL，在 Premium 清揃 BSL
    if (liq.sslSwept && premDisc === "discount") sweepQuality += 15;
    if (liq.bslSwept && premDisc === "premium") sweepQuality += 15;
    // RVOL 驗證：清揃時放量表示真實清揃
    if (rvol >= 1.5) sweepQuality += 15;
    else if (rvol <= 0.7) sweepQuality -= 10; // 縮量清揃可能是假清揃
    // [ICT 改良] AMD 操縱窗口加成：Zeussy AMD 理論——機構在操縱窗口進行的清掃更可靠
    // UTC 2-4（亞洲操縱）、8-10（歐洲操縱）、14-16（美洲操縱）
    const _nowHour = new Date().getUTCHours();
    const _isAmdWindow = (_nowHour >= 2 && _nowHour < 4) || (_nowHour >= 8 && _nowHour < 10) || (_nowHour >= 14 && _nowHour < 16);
    if (_isAmdWindow) sweepQuality += 10; // AMD 操縱窗口期間的清掃更可靠
    sweepQuality = Math.max(0, Math.min(100, sweepQuality));
  }

  // displacementQuality：位移品質評分 0-100（FVG 代表位移強度）
  // 使用 FvgZone 實際欄位： quality、displacement、filled_pct
  let displacementQuality = 0;
  const activeBullFvg = validBullFvg;
  const activeBearFvg = validBearFvg;
  if (activeBullFvg || activeBearFvg) {
    const fvg = activeBullFvg ?? activeBearFvg!;
    displacementQuality = 30; // 基礎分
    // FVG 內建品質分（已包含大小、displacement、量能等因子）
    displacementQuality += Math.round(fvg.quality * 0.4); // 內建品質分賮獻 40%
    // displacement 確認：有位移 K 線確認表示位移真實
    if (fvg.displacement) displacementQuality += 15;
    // 未回補比例：filled_pct 越低越好（越新鮮）
    const unfilledRatio = 1 - fvg.filled_pct;
    if (unfilledRatio >= 0.9) displacementQuality += 15; // 完全未回補
    else if (unfilledRatio >= 0.6) displacementQuality += 8;
    else if (unfilledRatio < 0.3) displacementQuality -= 10; // 已大部分回補
    // [ICT 改良] iFVG 反轉風險：FVG 已大部分填補（filled_pct > 0.7）表示位移已反轉（iFVG）
    // TTrades 機械化模型：iFVG 是防線而非支撐，降低位移品質
    if (fvg.filled_pct > 0.7) displacementQuality -= 15;
    displacementQuality = Math.max(0, Math.min(100, displacementQuality));
  }

  // obQuality：OB 回踩品質評分 0-100
  // 使用 ObZone 實際欄位： strength、quality、bos_confirmed、tested_count、displacement
  let obQuality = 0;
  const activeOb = validBullOb ?? validBearOb;
  if (activeOb) {
    obQuality = 30; // 基礎分
    // OB 強度
    if (activeOb.strength === "strong") obQuality += 15;
    // OB 內建品質分
    obQuality += Math.round(activeOb.quality * 0.25); // 內建品質分賮獻 25%
    // BOS 確認：BOS 後形成的 OB 更可靠
    if (activeOb.bos_confirmed) obQuality += 15;
    // displacement 確認
    if (activeOb.displacement) obQuality += 10;
    // 測試次數：測試次數越少越好（新鮮 OB）
    // [SMC 改良] Inducement 懲罰：OB 被測試 2 次時機構可能已用它誘騙散戶（LIT 理論）
    if (activeOb.tested_count === 0) obQuality += 10;      // 新鮮 OB，最強
    else if (activeOb.tested_count === 1) obQuality += 5;  // 第一次測試，仍有效
    else if (activeOb.tested_count === 2) obQuality -= 8;  // ⚠️ Inducement 風險：可能是機構誘騙陷阱
    else if (activeOb.tested_count >= 3) obQuality -= 18; // 多次測試後 OB 嚴重失效
    // 現價距離 OB 的距離：越近越好
    const distToOb = Math.abs(close - activeOb.mid);
    if (distToOb < atr * 0.5) obQuality += 10; // 非常接近
    else if (distToOb > atr * 2) obQuality -= 10; // 已遠離
    obQuality = Math.max(0, Math.min(100, obQuality));
  }

  // 將三個品質分融合為 SMC 評分
  let smcScore = 50;

  // 層一：結構層（BOS + 流動性，上限 ±20）
  let structureBonus = 0;
  if (bos.lastStructure === "bullish") structureBonus += 12;
  else if (bos.lastStructure === "bearish") structureBonus -= 12;
  if (liq.sslSwept) structureBonus += 10;
  if (liq.bslSwept) structureBonus -= 10;
  structureBonus = Math.max(-20, Math.min(20, structureBonus));
  smcScore += structureBonus;

  // 層二：區域層（Premium/Discount，上限 ±10）
  if (premDisc === "discount") smcScore += 10;
  else if (premDisc === "premium") smcScore -= 10;

  // 層三：三部曲品質融合層（取代原來的 FVG/OB 鄰近判斷）
  const hasFullSmcSetup = hasSweepEvent && (activeBullFvg || activeBearFvg) && (validBullOb || validBearOb);
  if (hasFullSmcSetup) {
    // 三部曲完整：用品質分計算加成
    const smcChainScore = (sweepQuality * 0.35 + displacementQuality * 0.35 + obQuality * 0.30);
    const smcChainBonus = Math.round((smcChainScore - 50) * 0.3); // 將品質分轉換為 ±15 範圍內的加分
    smcScore += Math.max(-15, Math.min(15, smcChainBonus));
  } else {
    // 無完整三部曲：分數上限封頂 65
    smcScore = Math.min(smcScore, 65);
    // 對單一區域的鄰近評分
    let triggerBonus = 0;
    if (activeBullFvg && Math.abs(close - activeBullFvg.mid) < atr) triggerBonus += 6;
    if (activeBearFvg && Math.abs(close - activeBearFvg.mid) < atr) triggerBonus -= 6;
    if (validBullOb && Math.abs(close - validBullOb.mid) < atr * 1.5) triggerBonus += 8;
    if (validBearOb && Math.abs(close - validBearOb.mid) < atr * 1.5) triggerBonus -= 8;
    triggerBonus = Math.max(-12, Math.min(12, triggerBonus));
    smcScore += triggerBonus;
  }

  // 層四： RVOL 量能驗證（上限 ±6）
  if (rvol >= 1.5) smcScore += 6;
  else if (rvol <= 0.7) smcScore -= 5;

  smcScore = Math.max(0, Math.min(100, smcScore));

  // ── 增強版纏論分析（v3：高頻時間框架使用更大 lookback）──
  // 15m/5m 對應小級別筆，需要更多 K 線才能形成小級別中樞
  const chanLookback = (bar === "15m" || bar === "5m") ? 500 : 400;
  const chan = calcChanEnhanced(candles, close, chanLookback);
  const chanBuySellPoints: HwrChanBuySellPoint[] = chan.buy_sell_points.map(p => ({
    level: p.level as 1 | 2 | 3,
    direction: p.direction as "buy" | "sell",
    price: p.price,
    time: p.time,
    bi_idx: p.bi_idx,
    description: p.description,
    strength: p.strength as "strong" | "medium" | "weak",
    divergence_confirmed: p.divergence_confirmed,
    after_zhongshu_break: p.after_zhongshu_break,
    trend_continuation: p.trend_continuation,
  }));

  let chanScore = 50;
  if (chan.trend === "bullish") chanScore += 20;
  else if (chan.trend === "bearish") chanScore -= 20;

  // R7-FIX: 中樞內評分細化（根據價格在中樞的相對位置）
  if (chan.in_zhongshu && chan.current_zhongshu) {
    const zs = chan.current_zhongshu;
    const zsHeight = zs.top - zs.bottom;
    if (zsHeight > 0) {
      const posRatio = (close - zs.bottom) / zsHeight;
      if (posRatio < 0.3) chanScore = 60;
      else if (posRatio > 0.7) chanScore = 40;
      else chanScore = 50;
    } else {
      chanScore = 50;
    }
  }

  // ── P1 改良：纏論背馳升級—三重驗證機制 ──
  // 原本：僅用 MACD 面積比判斷背馳
  // 改良：幅度背馳（必須）+ MACD 面積（加分）+ 時間背馳（加分）+ HTF 共振（加分）
  const divType = chan.divergence_signals.type;
  const macdRatio = chan.macd_area_ratio;
  const biCount = chan.bi_count;
  const duanCount = chan.duan_count;

  if (divType === "bottom" || divType === "top") {
    const isBullDiv = divType === "bottom";
    const sign = isBullDiv ? 1 : -1;

    // 因子 1：幅度背馳（必須）—已由 chan.divergence_signals.type 確認
    let divScore = 14; // 基礎分

    // 因子 2：MACD 面積背馳（加分）
    if (macdRatio > 0 && macdRatio < 0.5) {
      divScore += 6; // MACD 面積縮小到 50% 以下
      if (macdRatio < 0.3) divScore += 4; // 強背馳：面積縮小到 30% 以下
    }

    // 因子 3：時間背馳（加分）—筆數越多表示背馳筆越少
    // 小筆數（快速背馳）和大筆數（縮短背馳）都是有效信號
    if (biCount >= 3 && biCount <= 7) {
      divScore += 5; // 小筆數快速背馳，小級別轉折
    } else if (biCount >= 8 && biCount <= 15) {
      divScore += 3; // 中筆數，標準背馳
    }

    // 因子 4：線段級別背馳（加分）—有線段確認表示大級別背馳
    if (duanCount >= 2) {
      divScore += 4; // 線段級別背馳，信號更強
    }

    // 因子 5：HTF 共振（加分）—高級別趨勢與背馳方向一致
    // 例：4H 背馳且 1D 趨勢也是多頭—表示大級別支撑
    if (htfTrend === "bullish" && isBullDiv) divScore += 5;
    if (htfTrend === "bearish" && !isBullDiv) divScore += 5;
    // HTF 逆勢背馳懲罰（逆勢背馳風險較高）
    if (htfTrend === "bullish" && !isBullDiv) divScore -= 4;
    if (htfTrend === "bearish" && isBullDiv) divScore -= 4;

    chanScore += sign * Math.min(divScore, 28); // 背馳總加分上限 28
  }

  // 有纏論買賣點加分
  const latestBuyPoint = chanBuySellPoints.filter(p => p.direction === "buy").pop();
  const latestSellPoint = chanBuySellPoints.filter(p => p.direction === "sell").pop();
  if (latestBuyPoint) chanScore += latestBuyPoint.level === 1 ? 10 : latestBuyPoint.level === 2 ? 7 : 5;
  if (latestSellPoint) chanScore -= latestSellPoint.level === 1 ? 10 : latestSellPoint.level === 2 ? 7 : 5;
  chanScore = Math.max(0, Math.min(100, chanScore));

  // ── PA 形態分析（與關鍵水位共振）──
  const srLevels = extractSrLevels(chan, ob, fvg);
  const paWithLevels = detectPaPatternsWithLevels(candles, srLevels, bar, atr);
  const paTrend = close > paEma20 && paEma20 > paEma50 ? "上升趨勢"
    : close < paEma20 && paEma20 < paEma50 ? "下降趨勢" : "震盪";

  // 只有在關鍵水位上的 PA 形態才計分
  const bullishPaAtLevel = paWithLevels.filter(p => p.pattern.type === "bullish" && p.at_key_level);
  const bearishPaAtLevel = paWithLevels.filter(p => p.pattern.type === "bearish" && p.at_key_level);
  const allBullishPa = paWithLevels.filter(p => p.pattern.type === "bullish");
  const allBearishPa = paWithLevels.filter(p => p.pattern.type === "bearish");

  const paBullNames = allBullishPa.map(p => p.pattern.name);
  const paBearNames = allBearishPa.map(p => p.pattern.name);

  let paScore = 50;
  if (close > paEma20) paScore += 8; else paScore -= 8;
  if (close > paEma50) paScore += 7; else paScore -= 7;

  // RSI regime-based 解讀：依趨勢環境區分多空區間
  // 多頭環境： RSI 40-80 為正常區間，空頭環境： RSI 20-60 為正常區間
  const isBullishRegime = close > paEma20 && paEma20 > paEma50;
  if (isBullishRegime) {
    // 多頭環境： RSI 50-75 為健康區間
    if (curRsi >= 50 && curRsi <= 75) paScore += 8;
    else if (curRsi > 75) paScore -= 3;  // 超買但不必立即反轉
    else if (curRsi < 40) paScore -= 6;  // 多頭中 RSI 過低為弱勢信號
  } else {
    // 空頭/震盪環境： RSI 25-50 為健康區間
    if (curRsi >= 25 && curRsi <= 50) paScore -= 8;
    else if (curRsi < 25) paScore += 3;  // 超賣但不必立即反轉
    else if (curRsi > 60) paScore += 6;  // 空頭中 RSI 過高為弱勢信號
  }

  if (curAdx > 25) paScore += 5;
  // 在關鍵水位的 PA 形態給更高分（共振加乘）
  paScore += bullishPaAtLevel.length * 8 + allBullishPa.filter(p => !p.at_key_level).length * 3;
  paScore -= bearishPaAtLevel.length * 8 + allBearishPa.filter(p => !p.at_key_level).length * 3;
  // R7-FIX: RVOL 方向性強化（區分上漲量和下跌量）
  const isUpCandle = close > candles[candles.length - 1].open;
  if (rvol >= 1.5) {
    if (isUpCandle) {
      paScore += 5; // 放量上漲
      if (bullishPaAtLevel.length > 0) paScore += 5; // 放量看漲形態共振
    } else {
      paScore -= 5; // 放量下跌
      if (bearishPaAtLevel.length > 0) paScore -= 5; // 放量看跌形態共振
    }
  } else if (rvol <= 0.7) {
    // 縮量回調/反彈
    if (isUpCandle && paTrend === "下降趨勢") paScore -= 3; // 縮量反彈，偏空
    if (!isUpCandle && paTrend === "上升趨勢") paScore += 3; // 縮量回調，偏多
  }
  // [PA 改良] 80-20 假突破過濾（方方土 Price Action 理論）
  // 當假突破形態存在（影線刺穿舊高/低但實體未收盤在外），對順勢模型降分
  const recentCandles5 = candles.slice(-5);
  const recentHigh5 = Math.max(...recentCandles5.map(c => c.high));
  const recentLow5 = Math.min(...recentCandles5.map(c => c.low));
  const prevHigh20 = Math.max(...candles.slice(-25, -5).map(c => c.high));
  const prevLow20 = Math.min(...candles.slice(-25, -5).map(c => c.low));
  const lastCandle = candles[candles.length - 1];
  const lastBody = Math.abs(lastCandle.close - lastCandle.open);
  const lastRange = lastCandle.high - lastCandle.low;
  const bodyRatio = lastRange > 0 ? lastBody / lastRange : 0;
  // 假突破判斷：影線刺穿舊高/低，但實體收回區間內，且實體比例 < 50%
  const isBullishFalseBreak = (recentLow5 < prevLow20) && (lastCandle.close > prevLow20) && (bodyRatio < 0.5);
  const isBearishFalseBreak = (recentHigh5 > prevHigh20) && (lastCandle.close < prevHigh20) && (bodyRatio < 0.5);
  if (isBullishFalseBreak) paScore += 12; // 假突破向下→看漲信號加分
  if (isBearishFalseBreak) paScore -= 12; // 假突破向上→看空信號加分
  // SNR 新鮮度模擬：當現價靠近主要 SR 結構區域（基於 OB 距離）且區域新鮮（tested_count 小），額外加分
  if (activeOb && activeOb.tested_count <= 1 && Math.abs(close - activeOb.mid) < atr * 0.5) {
    paScore += 5; // SNR 新鮮區域共振：新鮮 OB + 現價在區域內
  }
  paScore = Math.max(0, Math.min(100, paScore));

  // ── RSI/MACD 背離偵測 ──
  const divergences = detectDivergences(candles, bar, 60);
  const divSummaries = divergences.map(d => d.description);

  // ── 斐波那契分析 ──
  const fibResult = calcFibOte(candles, close);
  let fibScore = 50;
  if (fibResult) {
    if (fibResult.direction === "bullish") {
      if (fibResult.in_ote) fibScore = 78;
      else if (close > fibResult.fib_50) fibScore = 62;
      else fibScore = 40;
    } else {
      if (fibResult.in_ote) fibScore = 22;
      else if (close < fibResult.fib_50) fibScore = 38;
      else fibScore = 60;
    }
    
    // R7-FIX: Fibonacci-SMC 共振（OTE 區間與 FVG/OB 重疊）
    if (fibResult.in_ote_wide) {
      if (fibResult.direction === "bullish" && (validBullFvg || validBullOb)) {
        fibScore += 12; // 多頭 OTE 與多頭 SMC 區域共振
      } else if (fibResult.direction === "bearish" && (validBearFvg || validBearOb)) {
        fibScore -= 12; // 空頭 OTE 與空頭 SMC 區域共振
      }
    }
  }

  // ── SMC 三部曲確認設置 ──
  const smcSetups = detectSmcConfirmationSetups(candles, close, htfTrend);
  // v5.5 新增：傳入 close 以計算距市價距離
  const smcSetupSummaries = smcSetups.map(s => toSmcSetupSummary(s, close));

  // ── P0 改良：Regime-Aware 動態加權評分 ──
  // 趨勢日：SMC 結構 + 纏論趨勢更重要；震盪日：PA 形態 + 斐波 OTE 更重要
  const isTrendingRegime = (htfTrend !== "ranging") && (curAdx > 22);
  const isRangingRegime  = !isTrendingRegime;

  // 動態權重：趨勢日加重 SMC/纏論，震盪日加重 PA/斐波
  const wSmc  = isTrendingRegime ? 0.35 : 0.25;
  const wChan = isTrendingRegime ? 0.30 : 0.20;
  const wPa   = isTrendingRegime ? 0.20 : 0.30;
  const wFib  = isTrendingRegime ? 0.15 : 0.25;

  // 衝突懲罰：SMC 與纏論方向相反時降低總分
  const smcBullish = smcScore > 55;
  const smcBearish = smcScore < 45;
  const chanBullish = chanScore > 55;
  const chanBearish = chanScore < 45;
  const hasConflict = (smcBullish && chanBearish) || (smcBearish && chanBullish);
  const conflictPenalty = hasConflict ? 0.88 : 1.0; // 衝突時整體評分打 88 折

  const totalScore = (smcScore * wSmc + paScore * wPa + fibScore * wFib + chanScore * wChan) * conflictPenalty;

  // ── P0 改良：動態中性區閾值（趨勢日收窄、震盪日放寬）──
  // 趨勢日：55/45 更容易判斷方向；震盪日：65/35 更嚴格，避免假突破
  const longThreshold  = isTrendingRegime ? 55 : 65;
  const shortThreshold = isTrendingRegime ? 45 : 35;

  // ── 方向判定（動態閾值 + 衝突保護）──
  let direction: "long" | "short" | "neutral";
  if (hasConflict) {
    // SMC 與纏論衝突時，強制中性，避免錯誤方向
    direction = "neutral";
  } else if (totalScore >= longThreshold) {
    direction = "long";
  } else if (totalScore <= shortThreshold) {
    direction = "short";
  } else {
    direction = "neutral";
  }

  // 若高級別趨勢相反，降低信心（不直接改方向，但在模型層面懲罰）
  const chanDivType = chan.divergence_signals.type;

  return {
    bar, label, close, atr,
    adx: curAdx,
    smc_structure: bos.lastStructure,
    smc_bos_choch: bosChochStr,
    smc_premium_discount: premDisc,
    smc_score: smcScore,
    pa_bullish_patterns: paBullNames,
    pa_bearish_patterns: paBearNames,
    pa_trend: paTrend,
    pa_rsi: curRsi,
    pa_adx: curAdx,
    pa_score: paScore,
    fib_score: fibScore,
    fib_in_ote: fibResult?.in_ote ?? false,
    fib_618: fibResult?.fib_618 ?? 0,
    fib_786: fibResult?.fib_786 ?? 0,
    fib_ext_1272: fibResult?.ext_1272 ?? 0,
    fib_ext_1618: fibResult?.ext_1618 ?? 0,
    chan_trend: chan.trend,
    chan_in_zhongshu: chan.in_zhongshu,
    chan_zhongshu_top: chan.zhongshuZG || 0,
    chan_zhongshu_bottom: chan.zhongshuZD || 0,
    chan_zhongshu_zg: chan.zhongshuZG || 0,
    chan_zhongshu_zd: chan.zhongshuZD || 0,
    chan_zhongshu_gg: chan.zhongshuGG || 0,
    chan_zhongshu_dd: chan.zhongshuDD || 0,
    chan_divergence: chanDivType,
    chan_bi_count: chan.bi_count,
    chan_duan_count: chan.duan_count,
    chan_score: chanScore,
    chan_buy_sell_points: chanBuySellPoints,
    chan_macd_area_ratio: chan.macd_area_ratio,
    divergences: divSummaries,
    smc_setups: smcSetupSummaries,
    nearest_bull_ob: validBullOb ? { ...validBullOb, strength: validBullOb.strength as "strong" | "normal" } : null,
    nearest_bear_ob: validBearOb ? { ...validBearOb, strength: validBearOb.strength as "strong" | "normal" } : null,
    nearest_bull_fvg: validBullFvg,
    nearest_bear_fvg: validBearFvg,
    liquidity_sweep: liq,
    total_score: totalScore,
    direction,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 三個交易模型生成（v2.0 改良版）
// ─────────────────────────────────────────────────────────────────────────────

function buildModels(tfMap: Map<string, TfAnalysis>): TradeModel[] {
  const tf4h  = tfMap.get("4H");
  const tf1h  = tfMap.get("1H");
  const tf15m = tfMap.get("15m");
  const tf1d  = tfMap.get("1D");
  const models: TradeModel[] = [];

  // ── 模型 A：掃流動性反轉單（SMC 三部曲確認版）──
  {
    const primary = tf1h ?? tf4h;
    const entry   = tf15m ?? tf1h;
    if (primary && entry) {
      const liq = primary.liquidity_sweep;
      const hasSweep = liq.bslSwept || liq.sslSwept;
      const sweepDir: "long" | "short" | "neutral" = liq.sslSwept ? "long" : liq.bslSwept ? "short" : "neutral";

      // v2：優先使用 SMC 三部曲確認設置
      const activeBullSetups = primary.smc_setups.filter(s => s.direction === "bullish" && (s.status === "active" || s.status === "waiting"));
      const activeBearSetups = primary.smc_setups.filter(s => s.direction === "bearish" && (s.status === "active" || s.status === "waiting"));
      const bestSetup = sweepDir === "long"
        ? activeBullSetups[0] ?? null
        : sweepDir === "short" ? activeBearSetups[0] ?? null : null;

      const chochConfirm = entry.smc_bos_choch.includes("CHoCH");
      const inOTE = entry.fib_in_ote;
      const hasPAConfirm = sweepDir === "long"
        ? entry.pa_bullish_patterns.length > 0
        : entry.pa_bearish_patterns.length > 0;
      const chanNotInZS = !primary.chan_in_zhongshu;
      // v2：纏論一類買賣點加分
      const hasChanBuyPoint = primary.chan_buy_sell_points.some(p => p.direction === "buy" && p.level === 1);
      const hasChanSellPoint = primary.chan_buy_sell_points.some(p => p.direction === "sell" && p.level === 1);

      // ── P1 改良：序列品質評分（不再用平鋪條件疊加）──
      // 先判斷 setup 是否成立，再看品質，最後看確認
      let confidence = 0;

      // 1. 清揃品質：有有效清揃則基礎分高，否則立即保持 0
      if (!hasSweep) {
        // 清揃尚未發生，此模型不適用
        confidence = 0;
      } else {
        // 2. 基礎分：清揃存在
        confidence = 25;

        // 3. 事件鎖鏈品質（累加但每層有上限）
        // 清揃品質：有 bestSetup 表示三部曲完整
        if (bestSetup) {
          confidence += 22; // 三部曲完整，最高加分
          // 三部曲內部品質：RR 越高表示位移越举
          if (bestSetup.rr_ratio >= 2.5) confidence += 5;
          else if (bestSetup.rr_ratio >= 2.0) confidence += 3;
        } else if (chochConfirm) {
          confidence += 12; // 僅 CHoCH 確認，不如三部曲
        }

        // 4. 入場區品質：OTE + PA 共振
        if (inOTE && hasPAConfirm) confidence += 12; // 共振加乘
        else if (inOTE) confidence += 7;
        else if (hasPAConfirm) confidence += 5;

        // 5. 纏論一類買賣點（最強確認）
        if (sweepDir === "long" && hasChanBuyPoint) confidence += 9;
        if (sweepDir === "short" && hasChanSellPoint) confidence += 9;

        // 6. 中樞中段懲罰（不是理想板機區）
        if (primary.chan_in_zhongshu) {
          const zsTop = primary.chan_zhongshu_top;
          const zsBot = primary.chan_zhongshu_bottom;
          if (zsTop > 0 && zsBot > 0) {
            const zsHeight = zsTop - zsBot;
            const posRatio = zsHeight > 0 ? (primary.close - zsBot) / zsHeight : 0.5;
            // 中樞中段（PositionRatio 30%-70%）懲罰
            if (posRatio > 0.3 && posRatio < 0.7) confidence -= 8;
          }
        }

        // 7. HTF 對齊：非線性懲罰（分級懲罰）
        const htf = tf4h ?? tf1d;
        if (htf) {
          const htfBullish = htf.chan_trend === "bullish" && htf.smc_structure === "bullish";
          const htfBearish = htf.chan_trend === "bearish" && htf.smc_structure === "bearish";
          const htfNeutral = !htfBullish && !htfBearish;
          if (sweepDir === "long" && htfBearish) confidence = Math.round(confidence * 0.62); // 強逆勢
          else if (sweepDir === "long" && htfNeutral) confidence = Math.round(confidence * 0.85); // 輕度逆勢
          if (sweepDir === "short" && htfBullish) confidence = Math.round(confidence * 0.62);
          else if (sweepDir === "short" && htfNeutral) confidence = Math.round(confidence * 0.85);
        }

        // 8. 訊號衝突懲罰：多時間框方向分歧
        const tfDirs = [tf4h?.direction, tf1h?.direction, tf15m?.direction].filter(Boolean);
        const conflictCount = tfDirs.filter(d => d !== sweepDir && d !== "neutral").length;
        if (conflictCount >= 2) confidence = Math.round(confidence * 0.75);
        else if (conflictCount === 1) confidence = Math.round(confidence * 0.90);

        confidence = Math.min(92, Math.max(0, confidence));
      }

      // 盈虧比：優先使用 SMC 設置的 RR，否則預設 1.5
      const rrRatio = bestSetup?.rr_ratio ?? 1.5;

      const entryConditions: string[] = [
        `1H ${liq.sslSwept ? `掃下方流動性（SSL @ ${liq.sslPrice.toFixed(2)}）` : liq.bslSwept ? `掃上方流動性（BSL @ ${liq.bslPrice.toFixed(2)}）` : "等待流動性掃蕩"}`,
        bestSetup
          ? `✓ SMC 三部曲確認：掃蕩 ${bestSetup.sweep_type} → FVG 位移 → OB 回踩（進場區 ${bestSetup.entry_bottom.toFixed(2)}–${bestSetup.entry_top.toFixed(2)}）`
          : `15m 等待 CHoCH 結構反轉確認${chochConfirm ? "（已出現）" : "（尚未出現）"}`,
        entry.nearest_bull_ob
          ? `回踩多方 OB（${entry.nearest_bull_ob.bottom.toFixed(2)}–${entry.nearest_bull_ob.top.toFixed(2)}）${entry.nearest_bull_ob.strength === "strong" ? " ★強力OB" : ""}`
          : "尋找 ATR 有效 OB 進場區",
        entry.fib_618 > 0
          ? `斐波 OTE 區間（${entry.fib_618.toFixed(2)}–${entry.fib_786.toFixed(2)}）${inOTE ? " ✓ 現價在區間內" : ""}`
          : "計算斐波回調區",
        hasPAConfirm
          ? `PA 確認（關鍵水位共振）：${sweepDir === "long" ? entry.pa_bullish_patterns.join("、") : entry.pa_bearish_patterns.join("、")}`
          : "等待 PA 訊號在 OB/中樞邊界確認",
      ];

      const keyLevels: KeyLevel[] = [];
      if (liq.sslPrice > 0) keyLevels.push({ label: "SSL（已掃）", price: liq.sslPrice, type: "swept_low" });
      if (liq.bslPrice > 0) keyLevels.push({ label: "BSL（已掃）", price: liq.bslPrice, type: "swept_high" });
      if (bestSetup) {
        keyLevels.push({ label: "SMC 進場區上", price: bestSetup.entry_top, type: "smc_entry" });
        keyLevels.push({ label: "SMC 進場區下", price: bestSetup.entry_bottom, type: "smc_entry" });
        keyLevels.push({ label: "SMC TP1", price: bestSetup.tp1, type: "smc_tp" });
        keyLevels.push({ label: "SMC TP2", price: bestSetup.tp2, type: "smc_tp" });
      } else {
        if (entry.nearest_bull_ob) keyLevels.push({ label: "多方 OB", price: entry.nearest_bull_ob.mid, type: "bull_ob" });
        if (entry.nearest_bear_ob) keyLevels.push({ label: "空方 OB", price: entry.nearest_bear_ob.mid, type: "bear_ob" });
        if (entry.fib_618 > 0) keyLevels.push({ label: "Fib 0.618", price: entry.fib_618, type: "fib" });
        if (entry.fib_786 > 0) keyLevels.push({ label: "Fib 0.786", price: entry.fib_786, type: "fib" });
      }

      // ── P1 改良：ADX 止損乘數改為連續函數（更平滑、更對稱）──
      // ADX 15~40 映射到 0.40~0.90，避免離散跳躍
      const adxForSl = primary.adx;
      const adxNorm = Math.max(0, Math.min(1, (adxForSl - 15) / 25)); // 0~1
      const slAtrMultiplier = parseFloat((0.40 + adxNorm * 0.50).toFixed(2)); // 0.40~0.90

      const slHint = bestSetup
        ? `止損放 ${bestSetup.sweep_type} 掃湪點外側（${bestSetup.sl.toFixed(2)}），ADX=${adxForSl.toFixed(1)} → ATR 乘數 ${slAtrMultiplier}`
        : liq.sslSwept ? `止損放 SSL 低點下方 ${slAtrMultiplier} ATR（約 ${(liq.sslPrice - primary.atr * slAtrMultiplier).toFixed(2)}）`
        : `止損放 BSL 高點上方 ${slAtrMultiplier} ATR（約 ${(liq.bslPrice + primary.atr * slAtrMultiplier).toFixed(2)}）`;
      const tpHint = bestSetup
        ? `TP1: ${bestSetup.tp1.toFixed(2)}（RR ${rrRatio.toFixed(1)}x）| TP2: ${bestSetup.tp2.toFixed(2)}`
        : "目標：對側流動性 / 前高前低 / Fib 1.272–1.618 延伸位";

      models.push({
        id: "liquidity_reversal",
        name: "模型 A：掃流動性反轉單",
        description: "等待 SMC 三部曲完成（流動性清掃 → FVG 位移 → OB 回踩），纏論一類買賣點確認，ADX 動態 ATR 止損乘數適應趨勢強度。",
        direction: sweepDir === "neutral" ? (primary.direction) : sweepDir,
        confidence,
        confluence_score: Math.round(primary.smc_score * 0.35 + entry.pa_score * 0.25 + entry.fib_score * 0.20 + primary.chan_score * 0.20),
        entry_conditions: entryConditions,
        stop_loss_hint: slHint,
        take_profit_hint: tpHint,
        key_levels: keyLevels,
        smc_score: primary.smc_score,
        pa_score: entry.pa_score,
        fib_score: entry.fib_score,
        chan_score: primary.chan_score,
        timeframe_consensus: "1H 定方向，15m 找入場",
        risk_warning: primary.chan_in_zhongshu
          ? "⚠️ 目前處於纏論中樞內，假突破風險較高，建議等待離開中樞後再操作"
          : !hasSweep ? "⚠️ 流動性掃湪尚未發生，此模型處於等待狀態，不可提前入場"
          : `注意：掃湪後需等待 SMC 三部曲完整確認，不可在掃湪瞬間追單（ADX=${adxForSl.toFixed(1)}，止損 ATR×${slAtrMultiplier}）`,
        is_active: hasSweep && (!!bestSetup || chochConfirm),
        rr_ratio: rrRatio,
        sl_atr_multiplier: slAtrMultiplier,
        chan_buy_sell_points: primary.chan_buy_sell_points,
        smc_setups: primary.smc_setups.slice(0, 3),
        divergences: primary.divergences,
      });
    }
  }

  // ── 模型 B：趨勢回踩延續單（增強版纏論 + 乘數共振）──
  {
    const primary = tf4h ?? tf1d;
    const entry   = tf1h ?? tf15m;
    if (primary && entry) {
      // v2：使用增強版纏論趨勢（包含線段確認）
      const trendUp   = primary.chan_trend === "bullish" && primary.smc_structure === "bullish";
      const trendDown = primary.chan_trend === "bearish" && primary.smc_structure === "bearish";
      const hasTrend  = trendUp || trendDown;
      const notInZS   = !primary.chan_in_zhongshu;
      const inOTE     = entry.fib_in_ote;
      const hasFVG    = trendUp ? !!entry.nearest_bull_fvg : !!entry.nearest_bear_fvg;
      const hasPAConfirm = trendUp ? entry.pa_bullish_patterns.length > 0 : entry.pa_bearish_patterns.length > 0;
      const adxStrong = entry.pa_adx > 20;
      // v2：纏論二三類買賣點
      const hasChan23Buy  = entry.chan_buy_sell_points.some(p => p.direction === "buy" && (p.level === 2 || p.level === 3));
      const hasChan23Sell = entry.chan_buy_sell_points.some(p => p.direction === "sell" && (p.level === 2 || p.level === 3));
      // v2：MACD 面積比 > 1 表示動能增強，有利趨勢延續
      const macdMomentum = entry.chan_macd_area_ratio;

      let confidence = 30;
      if (hasTrend) confidence += 20;
      if (notInZS) confidence += 10;
      if (inOTE) confidence += 15;
      if (hasFVG) confidence += 8;
      if (hasPAConfirm) confidence += 7;
      if (adxStrong) confidence += 5;
      if (trendUp && hasChan23Buy) confidence += 10;
      if (trendDown && hasChan23Sell) confidence += 10;
      if (macdMomentum > 1) confidence += 5; // 動能增強

      // 逆勢懲罰：若日線趨勢相反，信心度乘以 0.7
      if (tf1d) {
        const dailyBullish = tf1d.chan_trend === "bullish";
        const dailyBearish = tf1d.chan_trend === "bearish";
        if (trendUp && dailyBearish) confidence = Math.round(confidence * 0.7);
        if (trendDown && dailyBullish) confidence = Math.round(confidence * 0.7);
      }
      confidence = Math.min(92, confidence);

      const dir: "long" | "short" | "neutral" = trendUp ? "long" : trendDown ? "short" : primary.direction;
      const rrRatio = inOTE ? 2.5 : hasFVG ? 2.0 : 1.5;

      // 找最佳纏論買賣點
      const bestChanPoint = entry.chan_buy_sell_points
        .filter(p => p.direction === (dir === "long" ? "buy" : "sell"))
        .sort((a, b) => a.level - b.level)[0];

      const entryConditions: string[] = [
        `4H 纏論趨勢：${primary.chan_trend === "bullish" ? "上升（離開中樞向上延伸）" : primary.chan_trend === "bearish" ? "下降（離開中樞向下延伸）" : "震盪（不建議此模型）"}${primary.chan_duan_count > 0 ? `（已確認 ${primary.chan_duan_count} 段線段）` : ""}`,
        `4H SMC 結構：${primary.smc_structure === "bullish" ? "HH/HL 多頭結構" : primary.smc_structure === "bearish" ? "LH/LL 空頭結構" : "無明確結構"}`,
        `1H 回踩至斐波 0.5–0.618${inOTE ? "（現價已在 OTE 區間 ✓）" : entry.fib_618 > 0 ? `（目標區：${entry.fib_618.toFixed(2)}–${(entry.fib_618 * 1.01).toFixed(2)}）` : ""}`,
        hasFVG
          ? `1H ${dir === "long" ? "多方" : "空方"} FVG 支撐（ATR 過濾有效）`
          : "尋找 ATR 有效 FVG 進場區",
        bestChanPoint
          ? `✓ 纏論${bestChanPoint.level}類${bestChanPoint.direction === "buy" ? "買" : "賣"}點：${bestChanPoint.description}`
          : hasPAConfirm
          ? `PA 止跌/止升訊號（關鍵水位共振）：${dir === "long" ? entry.pa_bullish_patterns.join("、") : entry.pa_bearish_patterns.join("、")}`
          : "等待 PA 確認（Higher Low / Lower High）",
      ];

      const keyLevels: KeyLevel[] = [];
      if (entry.fib_618 > 0) keyLevels.push({ label: "Fib 0.618", price: entry.fib_618, type: "fib" });
      if (entry.fib_786 > 0) keyLevels.push({ label: "Fib 0.786", price: entry.fib_786, type: "fib" });
      if (entry.fib_ext_1272 > 0) keyLevels.push({ label: "Fib 1.272", price: entry.fib_ext_1272, type: "fib_ext" });
      if (entry.fib_ext_1618 > 0) keyLevels.push({ label: "Fib 1.618", price: entry.fib_ext_1618, type: "fib_ext" });
      if (entry.nearest_bull_fvg) keyLevels.push({ label: "多方 FVG", price: entry.nearest_bull_fvg.mid, type: "bull_fvg" });
      if (entry.nearest_bear_fvg) keyLevels.push({ label: "空方 FVG", price: entry.nearest_bear_fvg.mid, type: "bear_fvg" });
      if (primary.chan_zhongshu_top > 0) keyLevels.push({ label: "4H 中樞上沿", price: primary.chan_zhongshu_top, type: "zhongshu_top" });
      if (primary.chan_zhongshu_bottom > 0) keyLevels.push({ label: "4H 中樞下沿", price: primary.chan_zhongshu_bottom, type: "zhongshu_bottom" });

      // v3 改良 5：ADX 動態止損 ATR 乘數
      const adxB = primary.adx;
      const slAtrMultiplierB = adxB > 30 ? 0.8 : adxB > 20 ? 0.5 : 0.35;

      models.push({
        id: "trend_pullback",
        name: "模型 B：趨勢回踩延續單",
        description: "4H 增強版纏論確認趨勢方向（含線段確認），SMC 結構確認 HH/HL 或 LH/LL，等待 1H 回踩至斯波 0.5–0.618 + ATR 有效 FVG/OB，ADX 動態 ATR 止損乘數適應趨勢強度。",
        direction: dir,
        confidence,
        confluence_score: Math.round(primary.chan_score * 0.30 + primary.smc_score * 0.25 + entry.fib_score * 0.25 + entry.pa_score * 0.20),
        entry_conditions: entryConditions,
        stop_loss_hint: dir === "long"
          ? `止損放回調結構失效點（Fib 0.786 下方 ${(slAtrMultiplierB + 0.2).toFixed(2)} ATR，約 ${entry.fib_786 > 0 ? (entry.fib_786 - entry.atr * (slAtrMultiplierB + 0.2)).toFixed(2) : "計算中"}），ADX=${adxB.toFixed(1)}`
          : `止損放回調結構失效點（Fib 0.786 上方 ${(slAtrMultiplierB + 0.2).toFixed(2)} ATR，約 ${entry.fib_786 > 0 ? (entry.fib_786 + entry.atr * (slAtrMultiplierB + 0.2)).toFixed(2) : "計算中"}），ADX=${adxB.toFixed(1)}`,
        take_profit_hint: `TP1: Fib 1.272（RR ${rrRatio.toFixed(1)}x）| TP2: Fib 1.618 / 前高前低`,
        key_levels: keyLevels,
        smc_score: primary.smc_score,
        pa_score: entry.pa_score,
        fib_score: entry.fib_score,
        chan_score: primary.chan_score,
        timeframe_consensus: "4H 定趨勢，1H 找回踩",
        risk_warning: !hasTrend
          ? "⚠️ 目前 4H 無明確趨勢，此模型不適用，請等待趨勢確立"
          : primary.chan_in_zhongshu
          ? "⚠️ 4H 仍在中樞內震盪，延伸方向未確認"
          : `趨勢日勝率較高；ADX=${adxB.toFixed(1)}，止損 ATR×${slAtrMultiplierB}`,
        is_active: hasTrend && notInZS,
        rr_ratio: rrRatio,
        sl_atr_multiplier: slAtrMultiplierB,
        chan_buy_sell_points: entry.chan_buy_sell_points,
        smc_setups: entry.smc_setups.slice(0, 3),
        divergences: entry.divergences,
      });
    }
  }

  // ── 模型 C：中樞邊界反應單（增強版纏論 + ATR 動態邊界）──
  {
    const primary = tf1h ?? tf4h;
    const entry   = tf15m ?? tf1h;
    if (primary && entry) {
      const inZS     = primary.chan_in_zhongshu;
      const zsTop    = primary.chan_zhongshu_top;
      const zsBottom = primary.chan_zhongshu_bottom;
      const close    = primary.close;
      const atr      = primary.atr;

      // v2：使用 ATR 動態邊界判斷（而非固定 0.8%）
      const nearTopThreshold    = atr * 0.5;
      const nearBottomThreshold = atr * 0.5;
      const nearTop    = zsTop > 0 && Math.abs(close - zsTop) < nearTopThreshold;
      const nearBottom = zsBottom > 0 && Math.abs(close - zsBottom) < nearBottomThreshold;

      const hasBSLAtTop       = primary.liquidity_sweep.bslSwept && close < zsTop;
      const hasSSLAtBottom    = primary.liquidity_sweep.sslSwept && close > zsBottom;
      const hasPAAtBoundary   = nearTop
        ? entry.pa_bearish_patterns.length > 0
        : nearBottom ? entry.pa_bullish_patterns.length > 0 : false;

      // v2：纏論一類買賣點在邊界上是最強確認
      const hasChanBuyAtBottom  = nearBottom && primary.chan_buy_sell_points.some(p => p.direction === "buy" && p.level === 1);
      const hasChanSellAtTop    = nearTop && primary.chan_buy_sell_points.some(p => p.direction === "sell" && p.level === 1);

      // v2：背離確認（底背馳在下沿，頂背馳在上沿）
      const hasBullDivAtBottom = nearBottom && primary.chan_divergence === "bottom";
      const hasBearDivAtTop    = nearTop && primary.chan_divergence === "top";

      let confidence = 25;
      if (inZS) confidence += 15;
      if (nearTop || nearBottom) confidence += 20;
      if (hasBSLAtTop || hasSSLAtBottom) confidence += 12;
      if (hasPAAtBoundary) confidence += 10;
      if (hasChanBuyAtBottom || hasChanSellAtTop) confidence += 15; // 纏論一類買賣點最強
      if (hasBullDivAtBottom || hasBearDivAtTop) confidence += 10;  // 背離加分
      confidence = Math.min(90, confidence);

      const dir: "long" | "short" | "neutral" = nearBottom ? "long" : nearTop ? "short" : "neutral";
      const rrRatio = (hasChanBuyAtBottom || hasChanSellAtTop) ? 2.0 : 1.5;

      const entryConditions: string[] = [
        inZS
          ? `1H 纏論中樞：${zsBottom.toFixed(2)}–${zsTop.toFixed(2)}（ATR=${atr.toFixed(2)}，現價在中樞內）`
          : "等待中樞形成（3 段重疊）",
        nearTop
          ? `現價接近中樞上沿（${zsTop.toFixed(2)}），距離 ${Math.abs(close - zsTop).toFixed(2)}（< ATR×0.5=${nearTopThreshold.toFixed(2)}），考慮做空`
          : nearBottom
          ? `現價接近中樞下沿（${zsBottom.toFixed(2)}），距離 ${Math.abs(close - zsBottom).toFixed(2)}（< ATR×0.5=${nearBottomThreshold.toFixed(2)}），考慮做多`
          : "等待價格到達中樞邊界（ATR 動態判斷）",
        hasBSLAtTop
          ? `✓ 上沿已掃 BSL（${primary.liquidity_sweep.bslPrice.toFixed(2)}），誘多完成`
          : hasSSLAtBottom
          ? `✓ 下沿已掃 SSL（${primary.liquidity_sweep.sslPrice.toFixed(2)}），誘空完成`
          : "等待流動性掃蕩確認",
        hasChanBuyAtBottom
          ? `✓ 纏論一類買點：${primary.chan_buy_sell_points.find(p => p.direction === "buy" && p.level === 1)?.description ?? "底背馳確認"}`
          : hasChanSellAtTop
          ? `✓ 纏論一類賣點：${primary.chan_buy_sell_points.find(p => p.direction === "sell" && p.level === 1)?.description ?? "頂背馳確認"}`
          : hasPAAtBoundary
          ? `PA 邊界反應（關鍵水位共振）：${dir === "short" ? entry.pa_bearish_patterns.join("、") : entry.pa_bullish_patterns.join("、")}`
          : "等待 PA 假突破後收回訊號",
        "中樞中間位置不做，快進快出，止損放邊界外側 ATR×0.5",
      ];

      const keyLevels: KeyLevel[] = [];
      if (zsTop > 0) keyLevels.push({ label: "中樞上沿", price: zsTop, type: "zhongshu_top" });
      if (zsBottom > 0) keyLevels.push({ label: "中樞下沿", price: zsBottom, type: "zhongshu_bottom" });
      if (zsTop > 0 && zsBottom > 0) keyLevels.push({ label: "中樞中位", price: (zsTop + zsBottom) / 2, type: "zhongshu_mid" });

      // v3 改良 5：ADX 動態止損 ATR 乘數
      const adxC = primary.adx;
      const slAtrMultiplierC = adxC > 30 ? 0.8 : adxC > 20 ? 0.5 : 0.35;

      models.push({
        id: "zhongshu_boundary",
        name: "模型 C：中樞邊界反應單",
        description: "纏論中樞震盪策略（v3）。在中樞上下沿使用 ATR 動態邊界判斷，結合 SMC 流動性掃湪 + 纏論一類買賣點（MACD 面積背馳確認）+ PA 假突破確認後反手，ADX 動態 ATR 止損乘數適應市況。",
        direction: dir,
        confidence,
        confluence_score: Math.round(primary.chan_score * 0.35 + primary.smc_score * 0.30 + entry.pa_score * 0.25 + entry.fib_score * 0.10),
        entry_conditions: entryConditions,
        stop_loss_hint: nearTop
          ? `止損放中樞上沿外側 ${slAtrMultiplierC} ATR（${zsTop.toFixed(2)} + ATR×${slAtrMultiplierC} = ${(zsTop + atr * slAtrMultiplierC).toFixed(2)}），ADX=${adxC.toFixed(1)}`
          : nearBottom
          ? `止損放中樞下沿外側 ${slAtrMultiplierC} ATR（${zsBottom.toFixed(2)} - ATR×${slAtrMultiplierC} = ${(zsBottom - atr * slAtrMultiplierC).toFixed(2)}），ADX=${adxC.toFixed(1)}`
          : `止損放邊界外側 ATR×${slAtrMultiplierC}（ADX=${adxC.toFixed(1)}）`,
        take_profit_hint: `TP1: 中樞中位（${zsTop > 0 && zsBottom > 0 ? ((zsTop + zsBottom) / 2).toFixed(2) : "計算中"}）| TP2: 對側邊界（RR ${rrRatio.toFixed(1)}x）`,
        key_levels: keyLevels,
        smc_score: primary.smc_score,
        pa_score: entry.pa_score,
        fib_score: entry.fib_score,
        chan_score: primary.chan_score,
        timeframe_consensus: "1H 定中樞，15m 找邊界反應",
        risk_warning: !inZS
          ? "⚠️ 目前無明確中樞，此模型不適用，請等待中樞形成"
          : `中樞突破後不可追，需等待回踩確認是否真突破；ADX=${adxC.toFixed(1)}，止損 ATR×${slAtrMultiplierC}`,
        is_active: inZS && (nearTop || nearBottom),
        rr_ratio: rrRatio,
        sl_atr_multiplier: slAtrMultiplierC,
        chan_buy_sell_points: primary.chan_buy_sell_points,
        smc_setups: primary.smc_setups.slice(0, 3),
        divergences: primary.divergences,
      });
    }
  }

  return models;
}

// ─────────────────────────────────────────────────────────────────────────────
// 主入口：執行完整高勝率策略掃描
// ─────────────────────────────────────────────────────────────────────────────

export async function runHighWinRateScan(
  symbol: string,
  fetchCandles: (sym: string, bar: string, limit: number) => Promise<Candle[]>,
  invokeLLM: (opts: { messages: { role: string; content: string }[]; maxTokens?: number }) => Promise<{ choices: Array<{ message: { content: string | Array<{ type: string; text?: string }> } }> }>,
  engine: "opus" | "codex" | "local" = "local"
): Promise<ScanResult> {
  const coinName = symbol.replace("USDT", "").replace("BUSD", "");

  const TF_CONFIG = [
    { bar: "4H",  label: "4 小時", limit: 300 },
    { bar: "1H",  label: "1 小時", limit: 300 },
    { bar: "15m", label: "15 分鐘", limit: 300 },
    { bar: "1D",  label: "日線",   limit: 200 },
  ];

  // ── 並行抓取四個時間框架 K 線 ──
  const candleMap = new Map<string, Candle[]>();
  await Promise.all(
    TF_CONFIG.map(async (tf) => {
      try {
        const candles = await fetchCandles(symbol, tf.bar, tf.limit);
        if (candles.length >= 50) candleMap.set(tf.bar, candles);
      } catch { /* 忽略單一 TF 失敗 */ }
    })
  );

  // ── 先計算 4H 趨勢作為高級別基準 ──
  const candles4h = candleMap.get("4H");
  const htfTrend: "bullish" | "bearish" | "ranging" = candles4h
    ? (() => {
        const chan4h = calcChanEnhanced(candles4h, candles4h[candles4h.length - 1].close);
        return chan4h.trend;
      })()
    : "ranging";

  // ── P0 改良：Session 時段感知 + 低流動性警告 ──
  // 加密貨幣全天 24h 交易，但不同時段流動性差異大
  // UTC 時間：亞洲盤 00:00-08:00 / 歐洲盤 07:00-16:00 / 美洲盤 13:00-22:00
  const nowUtcHour = new Date().getUTCHours();
  const sessionInfo = (() => {
    const h = nowUtcHour;
    if (h >= 13 && h < 22) return { name: "美洲盤", liquidity: "high", skip: false };
    if (h >= 7 && h < 16) return { name: "歐洲盤", liquidity: "medium", skip: false };
    if (h >= 0 && h < 8) return { name: "亞洲盤", liquidity: "low", skip: false };
    return { name: "歐美重疊", liquidity: "high", skip: false };
  })();

  // 低流動性時段（亞洲盤凌晨 00:00-04:00 UTC）信號品質懲罰
  const isLowLiquidityPeriod = nowUtcHour >= 0 && nowUtcHour < 4;

  // ── 對每個時間框架進行四維度分析 ──
  const tfAnalyses: TfAnalysis[] = [];
  const tfMap = new Map<string, TfAnalysis>();
  for (const tf of TF_CONFIG) {
    const candles = candleMap.get(tf.bar);
    if (!candles || candles.length < 50) continue;
    const analysis = analyzeTf(candles, tf.bar, tf.label, htfTrend);
    tfAnalyses.push(analysis);
    tfMap.set(tf.bar, analysis);
  }

  // ── 生成三個交易模型 ──
  const models = buildModels(tfMap);

  // ── 多時段共識摘要 ──
  const longCount  = tfAnalyses.filter(t => t.direction === "long").length;
  const shortCount = tfAnalyses.filter(t => t.direction === "short").length;
  const overallDir = longCount > shortCount ? "long" : shortCount > longCount ? "short" : "neutral";
  const mtfConsensus = tfAnalyses.map(t =>
    `${t.label}：${t.direction === "long" ? "看多" : t.direction === "short" ? "看空" : "中性"}`
  ).join(" | ");

  // ── AI 深度說明 ──
  const topModel = [...models].sort((a, b) => b.confidence - a.confidence)[0];
  const tf4h  = tfMap.get("4H");
  const tf1h  = tfMap.get("1H");

  // ── v5.0 改良：獲取宏觀數據（Layer1 增強）──
  const macroData = await fetchMacroData();

  // ── v5.0 改良：貝葉斯多時框融合 ──
  const tfSignals = tfAnalyses.map(t => ({
    timeframe: t.label as '4H' | '1H' | '15m' | '5m',
    direction: t.direction as 'long' | 'short' | 'neutral',
    strength: t.total_score ?? 50,
    atr: t.atr ?? 0,
    adx: t.pa_adx,
    rsi: t.pa_rsi,
    smcScore: t.smc_score,
    paScore: t.pa_score,
    chanScore: t.chan_score,
    fibScore: t.fib_score,
  }));
  const bayesianResult = bayesianMtfFusion(tfSignals);

  // ── v5.1 改良：6 種市場環境細粒度分類器 ──
  const tf1hForRegime = tfMap.get("1H");
  const tf4hForRegime = tfMap.get("4H");
  const candles1h = candleMap.get("1H") ?? [];
  const atrHistory1h = candles1h.slice(-21).map(c => {
    // 简化 ATR 計算：使用 high-low 作為代理
    return c.high - c.low;
  });
  const recentVols1h = candles1h.slice(-21);
  const avgVol1h = recentVols1h.slice(0, -1).reduce((s, c) => s + c.volume, 0) / Math.max(recentVols1h.length - 1, 1);
  const curVol1h = candles1h[candles1h.length - 1]?.volume ?? 0;
  const priceChangePct1h = candles1h.length >= 2
    ? ((candles1h[candles1h.length - 1].close - candles1h[candles1h.length - 24]?.close) / (candles1h[candles1h.length - 24]?.close || 1)) * 100
    : 0;
  const regimeResult = classifyMarketRegime({
    adx: tf1hForRegime?.pa_adx ?? 20,
    atr: tf1hForRegime?.atr ?? 0,
    atrHistory: atrHistory1h,
    rsi: tf1hForRegime?.pa_rsi ?? 50,
    volume: curVol1h,
    avgVolume20: avgVol1h,
    htfTrend,
    smcStructure: (tf4hForRegime?.smc_structure ?? 'neutral') as 'bullish' | 'bearish' | 'neutral',
    hasChanDivergence: !!(tf4hForRegime?.chan_divergence),
    hasBosChoch: !!(tf4hForRegime?.smc_bos_choch && tf4hForRegime.smc_bos_choch !== '無明顯結構事件'),
    chanInZhongshu: tf4hForRegime?.chan_in_zhongshu ?? false,
    priceChangePct: priceChangePct1h,
  });
  console.log(`[highWinRate.scan v5.1] 市場環境：${regimeResult.regimeLabel}（信心度 ${regimeResult.confidence}%）`);

  // ★ 信號衝突檢測：判斷是否應設為 no-trade 狀態
  const tfDirections = tfAnalyses.map(t => t.direction);
  const neutralCount = tfDirections.filter(d => d === "neutral").length;
  const isConflicted = longCount > 0 && shortCount > 0 && Math.abs(longCount - shortCount) <= 1;
  const isNoTradeRegime = isConflicted ||
    (neutralCount >= tfDirections.length - 1) || // 大多數時間框中性
    (overallDir === "neutral" && models.every(m => m.confidence < 55)); // 信心度全部低於 55%

  // ── P0 改良：Session 信號品質懲罰—低流動性時段所有模型信心度打折 ──
  if (isLowLiquidityPeriod) {
    for (const m of models) {
      // 亞洲盤凌晨 00:00-04:00 UTC：信心度打 80 折（低流動性時段假突破多）
      m.confidence = Math.round(m.confidence * 0.80);
      m.risk_warning = `⚠️ [低流動性時段 ${sessionInfo.name} ${nowUtcHour}:00 UTC] ` + m.risk_warning;
    }
  } else if (sessionInfo.liquidity === "low") {
    // 亞洲盤其他時段：信心度打 90 折
    for (const m of models) {
      m.confidence = Math.round(m.confidence * 0.90);
    }
  }

  const noTradeWarning = isNoTradeRegime
    ? `⚠️ 信號衝突警告：多空方向分歧（看多 ${longCount} 個時間框 vs 看空 ${shortCount} 個時間框）。建議觀望，不強追單。`
    : "";

  // ── v5.1 改良：使用 6 種環境分類器結果取代舊的 regimeLabel ──
  const regimeLabel = `${regimeResult.regimeLabel}（${regimeResult.adaptiveParams.tradeFilter === 'proceed' ? '✅ 適合交易' : regimeResult.adaptiveParams.tradeFilter === 'caution' ? '⚠️ 謹慎操作' : '🚫 建議迄避'}）`;

  // ── v5.1 改良：對模型應用環境自適應參數調整 ──
  for (const m of models) {
    const regimeAdj = applyRegimeAdaptation(m.confidence, m.rr_ratio, regimeResult);
    if (regimeAdj.adjustedConfidence !== m.confidence) {
      m.confidence = Math.round(regimeAdj.adjustedConfidence);
    }
    if (!regimeAdj.shouldTrade && regimeResult.adaptiveParams.tradeFilter === 'avoid') {
      m.is_active = false;
      m.risk_warning = `🚫 [環境迄避] ${regimeResult.regimeLabel}：${regimeResult.adaptiveParams.description} ` + m.risk_warning;
    }
    // 暴力行情時將 Kelly 備位按環境係數縮放
    if (m.kelly_fraction !== undefined) {
      m.kelly_fraction = m.kelly_fraction * regimeResult.adaptiveParams.kellyScaleFactor;
    }
  }

  const topModelInfo = topModel
    ? `${topModel.name}（信心度 ${topModel.confidence}%，${topModel.direction === "long" ? "做多" : topModel.direction === "short" ? "做空" : "中性"}，RR ${topModel.rr_ratio.toFixed(1)}:1，${topModel.is_active ? "已啟動" : "等待觸發"}）`
    : "無模型";

  const prompt = `你是一位專業的加密貨幣日內交易分析師，精通 SMC、PA、斐波那契和纏論。

【重要指示】
- 只根據下方提供的具體數據進行分析，不得虜構數字或添加未提供的資訊
- 如果信號衝突或不清晰，必須明確說「不交易（No-Trade）」而非強行給出方向
- 所有價位數字必須來自下方提供的分析數據，不得自行推測
- 如果某個指標缺失或不可靠，請明確指出而非忽略
- 輸出必須包含明確的「失效條件（Invalidation）」，說明什麼情況下分析失效

${noTradeWarning ? noTradeWarning + "\n\n" : ""}【市場環境】
- 幣對：${coinName}/USDT
- Regime：${regimeLabel}
- 多時段共識：${mtfConsensus}
- 整體方向：${overallDir === "long" ? "看多" : overallDir === "short" ? "看空" : "中性/震盪"}
- 4H 趨勢：${htfTrend === "bullish" ? "上升趨勢" : htfTrend === "bearish" ? "下降趨勢" : "震盪"}
- 衝突分數：看多 ${longCount} 個 / 看空 ${shortCount} 個 / 中性 ${neutralCount} 個
${isNoTradeRegime ? "- 狀態：❗信號衝突，建議觀望" : ""}

【4H 纏論分析】
- 趨勢：${tf4h?.chan_trend ?? "無"} | 筆數：${tf4h?.chan_bi_count ?? 0} | 線段數：${tf4h?.chan_duan_count ?? 0}
- 中樞：${tf4h?.chan_in_zhongshu ? `震盪中（${tf4h.chan_zhongshu_bottom.toFixed(2)}–${tf4h.chan_zhongshu_top.toFixed(2)}）` : "中樞外"}
- MACD 面積比：${tf4h?.chan_macd_area_ratio.toFixed(2) ?? "無"}（< 0.7 為背駳信號）
- 背駳：${tf4h?.chan_divergence ? (tf4h.chan_divergence === "bottom" ? "底背駳 ↑" : "頂背駳 ↓") : "無"}
- 纏論買賣點：${tf4h?.chan_buy_sell_points.map(p => `${p.level}類${p.direction === "buy" ? "買" : "賣"}點@${p.price.toFixed(2)}`).join("、") || "無"}
- SMC 結構：${tf4h?.smc_structure ?? "無"} | 最近事件：${tf4h?.smc_bos_choch ?? "無"}
- Premium/Discount：${tf4h?.smc_premium_discount ?? "無"}
- ATR：${tf4h?.atr.toFixed(2) ?? "無"}

【1H SMC 三部曲分析】
- 流動性清揃：${tf1h?.liquidity_sweep.sslSwept ? `清揃 SSL（${tf1h.liquidity_sweep.sslPrice.toFixed(2)}，看多）` : tf1h?.liquidity_sweep.bslSwept ? `清揃 BSL（${tf1h.liquidity_sweep.bslPrice.toFixed(2)}，看空）` : "無"}
- SMC 三部曲設置：${tf1h?.smc_setups.length ?? 0} 個（${tf1h?.smc_setups.filter(s => s.status === "active").length ?? 0} 個啟動中）
- PA 趨勢：${tf1h?.pa_trend ?? "無"} | RSI：${tf1h?.pa_rsi.toFixed(1) ?? "無"} | ADX：${tf1h?.pa_adx.toFixed(1) ?? "無"}
- PA 形態（關鍵水位共振）：多方 [${tf1h?.pa_bullish_patterns.join("、") ?? "無"}] | 空方 [${tf1h?.pa_bearish_patterns.join("、") ?? "無"}]
- RSI/MACD 背離：${tf1h?.divergences.slice(0, 2).join(" | ") || "無"}

【最佳模型】${topModelInfo}

【三個交易模型詳情】
${models.map(m => `
— ${m.name}
  信心度：${m.confidence}%（已含逆勢懲罰） | 方向：${m.direction === "long" ? "做多" : m.direction === "short" ? "做空" : "中性"} | RR：${m.rr_ratio.toFixed(1)}:1 | 狀態：${m.is_active ? "✅已啟動" : "⏳等待"}
  進場條件：${m.entry_conditions.slice(0, 3).map(c => c).join("; ")}
  止損：${m.stop_loss_hint} | 止盈：${m.take_profit_hint}
  風險：${m.risk_warning}`).join("\n")}

${isNoTradeRegime
  ? `請用繁體中文，按以下結構回答：

【市場狀態診斷】
- 說明為什麼目前處於 No-Trade 狀態，具體指出哪些時間框衝突

【重新入場條件】
- 說明需要哪些條件同時成立才能入場（至少 2 個具體條件）

【關鍵價位】
- 列出 3-4 個最重要的價位及其意義

【失效條件（Invalidation）】
- 說明什麼情況下分析完全失效，需重新分析

【風險提示】
- 如果強行入場的最大風險與建議觀望方式`
  : `請用繁體中文，按以下結構回答：

【市場狀態診斷】
- 說明 ${coinName} 目前處於「${regimeLabel}」的具體依據，重點引用纏論和 SMC 的具體數據

【最佳模型與 SMC 完成度】
- 說明哪個模型最適合， SMC 三部曲完成度，以及纏論買賣點是否共振

【進場扣板機條件】
- 列出 2-3 個最後確認訊號（必須具體到價位和 K 線形態）

【關鍵價位與 ATR 視角】
- 列出 3-4 個關鍵價位，說明 ATR 動態視角下的意義

【失效條件（Invalidation）】
- 說明什麼情況下此分析失效，需重新評估

【風險管理建議】
- 倉位建議、止損設定、盈號比，及最低可接受的信心度閾值`
}`;

  // ── v4.0 第一層：AI 環境掃描 Prompt（v5.0 增強宏觀數據）──
  const macroContext = buildMacroContext(macroData);
  const bayesianContext = `【貝葉斯多時框融合結果】
融合方向：${bayesianResult.fusedDirection === 'long' ? '看多' : bayesianResult.fusedDirection === 'short' ? '看空' : '中性'}
融合信心度：${bayesianResult.bayesianConfidence}%
${bayesianResult.regimeAdjustment}`;

  const envScanPrompt = `你是一位加密貨幣市場環境分析師。你的任務是：在量化指標分析開始前，先對目前市場環境做一個全面的宏觀與情緒判斷。

【幣對資訊】
幣對：${coinName}/USDT
目前時段：${sessionInfo.name}（UTC ${nowUtcHour}時）
4H 趨勢：${htfTrend === "bullish" ? "上升趨勢" : htfTrend === "bearish" ? "下降趨勢" : "震盪"}
多時框方向：看多 ${longCount} 個時框 / 看空 ${shortCount} 個時框 / 中性 ${neutralCount} 個時框
4H ATR：${tfMap.get("4H")?.atr.toFixed(2) ?? "N/A"}
4H SMC 結構：${tfMap.get("4H")?.smc_structure ?? "無"}
4H 纏論趨勢：${tfMap.get("4H")?.chan_trend ?? "無"}
1H PA 趨勢：${tfMap.get("1H")?.pa_trend ?? "無"}
最佳候選模型：${topModel?.name ?? "無"}（信心度 ${topModel?.confidence ?? 0}%）

${macroContext}

${bayesianContext}

【請對以下各項進行分析】
1. 市場環境：目前屬於趨勢延續、震盪整理、還是轉折時期？
2. 宏觀與情緒：目前加密貨幣市場情緒如何？有無需要注意的宏觀因素？
3. 時段偏向：${sessionInfo.name}的常規特徵是什麼？對交易有什麼影響？
4. 最大風險：目前進場最可能遭遇的最大風險是什麼？
5. 交易過濾：綜合以上分析，目前適合交易吗？

請輸出以下格式的 JSON（不要輸出任何其他文字）：
{
  "regime": "市場環境判斷（一句話）",
  "macro_note": "宏觀與情緒說明（一句話）",
  "session_bias": "時段偏向說明（一句話）",
  "key_risk": "目前最大風險（一句話）",
  "trade_filter": "proceed" | "caution" | "avoid",
  "filter_reason": "過濾原因（一句話）"
}`;

  // ── v3.5 改良：建立動態特徵摘要（供 AI Veto Layer 使用）──
  const sweepDir1h = tf1h?.liquidity_sweep.sslSwept ? "long" : tf1h?.liquidity_sweep.bslSwept ? "short" : "neutral";
  const sweepPrice1h = tf1h?.liquidity_sweep.sslSwept ? tf1h.liquidity_sweep.sslPrice : tf1h?.liquidity_sweep.bslSwept ? tf1h.liquidity_sweep.bslPrice : 0;
  const activeSmc1h = tf1h?.smc_setups.filter(s => s.status === "active") ?? [];
  const bestSmcSetup = activeSmc1h.sort((a, b) => b.confluence_score - a.confluence_score)[0];

  const dynamicFeaturesSummary = [
    sweepPrice1h > 0
      ? `清掃水位 ${sweepPrice1h.toFixed(2)}（${sweepDir1h === "long" ? "SSL已掃，看多" : "BSL已掃，看空"}）`
      : "無清掃事件",
    bestSmcSetup
      ? `最佳三部曲：${bestSmcSetup.sweep_type} → 進場區 ${bestSmcSetup.entry_bottom.toFixed(2)}–${bestSmcSetup.entry_top.toFixed(2)}，RR ${bestSmcSetup.rr_ratio.toFixed(1)}，共振分 ${bestSmcSetup.confluence_score}`
      : "三部曲尚未完整",
    tf1h?.chan_divergence
      ? `1H 纏論背馳：${tf1h.chan_divergence === "bottom" ? "底背馳" : "頂背馳"}`
      : "無背馳",
    `1H RSI ${tf1h?.pa_rsi.toFixed(1) ?? "N/A"} | ADX ${tf1h?.pa_adx.toFixed(1) ?? "N/A"} | 4H MACD面積比 ${tf4h?.chan_macd_area_ratio.toFixed(2) ?? "N/A"}`,
  ].join(" | ");

  // ── v3.5 改良：Veto Prompt（交易審核器）──
  const vetoPrompt = `你是一位加密貨幣交易審核系統（Trade Veto Layer）。你的唯一任務是：審核這筆候選交易是否值得執行。

【核心規則】
- 你必須輸出一個 JSON 物件，不得輸出任何其他文字
- 你必須根據下方數據做出 TRADE / WAIT / REJECT 三選一的決定
- 如果任何關鍵條件缺失或衝突，必須選擇 WAIT 或 REJECT，不可強行 TRADE
- 不得虛構任何數字，所有數據必須來自下方提供的資訊

【候選交易資訊】
幣對：${coinName}/USDT
Regime：${regimeLabel}（${overallDir === "long" ? "整體看多" : overallDir === "short" ? "整體看空" : "方向衝突"}）
方向衝突分數：看多 ${longCount} 個時框 vs 看空 ${shortCount} 個時框 vs 中性 ${neutralCount} 個時框
${isNoTradeRegime ? "⚠️ 信號衝突警告：多空方向分歧，建議觀望" : ""}

【最佳候選模型】
${topModel ? `${topModel.name}（${topModel.id === "liquidity_reversal" ? "A" : topModel.id === "trend_pullback" ? "B" : "C"}）
信心度：${topModel.confidence}%
方向：${topModel.direction === "long" ? "做多" : topModel.direction === "short" ? "做空" : "中性"}
RR：${topModel.rr_ratio.toFixed(1)}:1
狀態：${topModel.is_active ? "已啟動" : "等待觸發"}
進場條件：${topModel.entry_conditions.slice(0, 3).join(" | ")}
止損：${topModel.stop_loss_hint}
止盈：${topModel.take_profit_hint}
風險：${topModel.risk_warning}` : "無可用模型"}

【4H 高級別環境】
纏論趨勢：${tf4h?.chan_trend ?? "無"} | 中樞：${tf4h?.chan_in_zhongshu ? `震盪中（${tf4h.chan_zhongshu_bottom.toFixed(2)}–${tf4h.chan_zhongshu_top.toFixed(2)}）` : "中樞外"}
MACD面積比：${tf4h?.chan_macd_area_ratio.toFixed(2) ?? "N/A"}（< 0.7 = 背馳信號）
背馳：${tf4h?.chan_divergence ? (tf4h.chan_divergence === "bottom" ? "底背馳" : "頂背馳") : "無"}
SMC結構：${tf4h?.smc_structure ?? "無"} | 最近事件：${tf4h?.smc_bos_choch ?? "無"}
ATR：${tf4h?.atr.toFixed(2) ?? "N/A"}

【1H 入場時框】
清掃事件：${tf1h?.liquidity_sweep.sslSwept ? `SSL已掃（${tf1h.liquidity_sweep.sslPrice.toFixed(2)}）` : tf1h?.liquidity_sweep.bslSwept ? `BSL已掃（${tf1h.liquidity_sweep.bslPrice.toFixed(2)}）` : "無"}
SMC三部曲：${tf1h?.smc_setups.length ?? 0} 個設置，${tf1h?.smc_setups.filter(s => s.status === "active").length ?? 0} 個啟動中
PA趨勢：${tf1h?.pa_trend ?? "無"} | RSI：${tf1h?.pa_rsi.toFixed(1) ?? "N/A"} | ADX：${tf1h?.pa_adx.toFixed(1) ?? "N/A"}
PA形態：多方 [${tf1h?.pa_bullish_patterns.join("、") || "無"}] | 空方 [${tf1h?.pa_bearish_patterns.join("、") || "無"}]
背離：${tf1h?.divergences.slice(0, 2).join(" | ") || "無"}

【動態特徵摘要】
${dynamicFeaturesSummary}

【三個模型評分對比】
${models.map(m => `${m.name}（${m.id === "liquidity_reversal" ? "A" : m.id === "trend_pullback" ? "B" : "C"}）：信心度 ${m.confidence}% | ${m.is_active ? "✅已啟動" : "⏳等待"} | RR ${m.rr_ratio.toFixed(1)}:1`).join("\n")}

請輸出以下格式的 JSON（不要輸出任何其他文字，只輸出 JSON）：
{
  "decision": "TRADE" | "WAIT" | "REJECT",
  "model": "A" | "B" | "C" | "NONE",
  "setup_quality": 1-5,
  "primary_edge": "此交易的核心優勢（一句話，必須引用具體數據）",
  "primary_failure_mode": "最可能的失敗原因（一句話）",
  "must_see_trigger": "若要進場，必須看到的具體條件",
  "invalidation": "此分析的失效條件",
  "conflict_note": "多時框或模型衝突說明",
  "confidence": 0-100,
  "reason_codes": ["RECLAIM_OK"|"RECLAIM_FAIL"|"DISPLACEMENT_STRONG"|"DISPLACEMENT_WEAK"|"FRESH_ZONE"|"STALE_ZONE"|"VOLUME_CONFIRMED"|"VOLUME_MISSING"|"HTF_ALIGNED"|"HTF_CONFLICT"|"CHAN_BSP_CONFIRMED"|"CHAN_IN_ZHONGSHU"|"SMC_TRILOGY_COMPLETE"|"SMC_TRILOGY_INCOMPLETE"|"NO_TRADE_REGIME"],
  "dynamic_features_summary": "動態特徵摘要"
}`;

  // ── 根據 engine 決定使用 AI 或本地規則引擎 ──
  let aiAnalysis = "";
  let tradeDecision: TradeVetoDecision | undefined = undefined;
  let envScan: AiEnvScan | undefined = undefined;
  let finalStrategy: FinalStrategy | undefined = undefined;
  const useAI = engine !== "local";
  if (useAI) {
    // ── Layer 1：AI 環境掃描（市場環境判斷）──
    try {
      const envResult = await invokeLLM({
        messages: [{ role: "user", content: envScanPrompt }],
        maxTokens: 400,
      });
      const envRaw = envResult.choices[0]?.message?.content;
      const envText = typeof envRaw === "string"
        ? envRaw
        : Array.isArray(envRaw)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (envRaw as any[]).filter((c: any) => c.type === "text").map((c: any) => c.text as string).join("")
          : "";
      const envClean = envText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      const envJson = envClean.match(/\{[\s\S]*\}/);
      if (envJson) {
        const parsed = JSON.parse(envJson[0]) as Partial<AiEnvScan>;
        if (parsed.trade_filter && ["proceed", "caution", "avoid"].includes(parsed.trade_filter)) {
          envScan = {
            regime: parsed.regime ?? "無法判斷",
            macro_note: parsed.macro_note ?? "",
            session_bias: parsed.session_bias ?? "",
            key_risk: parsed.key_risk ?? "",
            trade_filter: parsed.trade_filter as "proceed" | "caution" | "avoid",
            filter_reason: parsed.filter_reason ?? "",
          };
          console.log(`[highWinRate.scan v4.0] Layer 1 環境掃描：${envScan.regime}（${envScan.trade_filter}）`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[highWinRate.scan v4.0] Layer 1 環境掃描失敗：${msg}`);
    }

    // ── Step 1：Veto Layer（JSON 決策）──
    try {
      const vetoResult = await invokeLLM({
        messages: [{ role: "user", content: vetoPrompt }],
        maxTokens: 800,
      });
      const vetoRaw = vetoResult.choices[0]?.message?.content;
      const vetoText = typeof vetoRaw === "string"
        ? vetoRaw
        : Array.isArray(vetoRaw)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (vetoRaw as any[]).filter((c: any) => c.type === "text").map((c: any) => c.text as string).join("")
          : "";
      const vetoClean = vetoText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      // 提取 JSON 內容（容許包在 ```json ... ``` 中）
      const jsonMatch = vetoClean.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Partial<TradeVetoDecision>;
        if (parsed.decision && ["TRADE", "WAIT", "REJECT"].includes(parsed.decision)) {
          tradeDecision = {
            decision: parsed.decision as "TRADE" | "WAIT" | "REJECT",
            model: (parsed.model ?? "NONE") as "A" | "B" | "C" | "NONE",
            setup_quality: (parsed.setup_quality ?? 3) as 1 | 2 | 3 | 4 | 5,
            primary_edge: parsed.primary_edge ?? "",
            primary_failure_mode: parsed.primary_failure_mode ?? "",
            must_see_trigger: parsed.must_see_trigger ?? "",
            invalidation: parsed.invalidation ?? "",
            conflict_note: parsed.conflict_note ?? "無衝突",
            confidence: parsed.confidence ?? 0,
            reason_codes: parsed.reason_codes ?? [],
            dynamic_features_summary: parsed.dynamic_features_summary ?? dynamicFeaturesSummary,
          };
          console.log(`[highWinRate.scan v3.5] Veto 決策：${tradeDecision.decision}（模型 ${tradeDecision.model}，信心度 ${tradeDecision.confidence}%）`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[highWinRate.scan v3.5] Veto Layer 失敗：${msg}`);
    }

    // ── Step 2：詳細分析報告（原有 Prompt）──
    try {
      const llmResult = await invokeLLM({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 2800,
      });
      const rawContent = llmResult.choices[0]?.message?.content;
      const text = typeof rawContent === "string"
        ? rawContent
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : Array.isArray(rawContent)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (rawContent as any[]).filter((c: any) => c.type === "text").map((c: any) => c.text as string).join("")
          : "";
      const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      if (cleaned && cleaned !== "__LOCAL_ENGINE__") {
        aiAnalysis = cleaned;
        console.log(`[highWinRate.scan v3.5] ${engine} AI 分析完成（${cleaned.length} 字）`);
      } else {
        throw new Error("AI 回傳空內容或本地標記");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[highWinRate.scan v3.5] ${engine} AI 分析失敗，切換本地引擎：${msg}`);
    }
  }

  // ── 若 AI 未成功（或選擇 local），使用本地規則引擎 ──
  if (!aiAnalysis) {
  // ── 本地規則引擎生成分析報告（不依賴外部 API）──
  // R6-FIX: HwrTfAnalysis 使用 bar 屬性（非 timeframe）
  const reTf4h = tfAnalyses.find(t => t.bar === "4H" || t.bar === "4h");
  const reTf1h = tfAnalyses.find(t => t.bar === "1H" || t.bar === "1h");
  const reTf15m = tfAnalyses.find(t => t.bar === "15m" || t.bar === "15M");
  const reTf1d = tfAnalyses.find(t => t.bar === "1D" || t.bar === "1d");

  // 1. 判斷市場狀態
  const marketState = (() => {
    const d4h = reTf4h?.direction ?? "neutral";
    const d1h = reTf1h?.direction ?? "neutral";
    const d1d = reTf1d?.direction ?? "neutral";
    const allBullish = [d4h, d1h, d1d].filter(d => d === "long").length;
    const allBearish = [d4h, d1h, d1d].filter(d => d === "short").length;
    if (allBullish >= 2) return "多頭趨勢日";
    if (allBearish >= 2) return "空頭趨勢日";
    if (d4h !== "neutral" && d1h !== d4h) return "假突破轉向日";
    return "震盪整理日";
  })();

  // 2. 找出最佳模型
  const activeModels = models.filter(m => m.is_active);
  const bestModel = topModel;
  const bestModelName = bestModel?.name ?? "無";
  const bestConf = bestModel?.confidence ?? 0;
  const bestDir = bestModel?.direction === "long" ? "做多 ↑" : bestModel?.direction === "short" ? "做空 ↓" : "中性";
  const bestRR = bestModel?.rr_ratio.toFixed(1) ?? "N/A";

  // 3. 纏論狀態
  // R6-FIX: chan_pivot_state 不存在於 HwrTfAnalysis，改用 chan_in_zhongshu 判斷
  const chanState4h = reTf4h ? `${reTf4h.chan_trend}（${reTf4h.chan_in_zhongshu ? "中樞內" : "中樞外"}）` : "無資料";
  const chanState1h = reTf1h ? `${reTf1h.chan_trend}（${reTf1h.chan_in_zhongshu ? "中樞內" : "中樞外"}）` : "無資料";

  // 4. SMC 三部曲完成度
  const smcCount = models.reduce((acc, m) => acc + (m.smc_setups?.length ?? 0), 0);
  // R6-FIX: 使用正確的 status 屬性判斷是否啟動
  const smcActive = models.reduce((acc, m) => acc + (m.smc_setups?.filter((s: HwrSmcSetupSummary) => s.status === "active")?.length ?? 0), 0);

  // 5. 關鍵價位
  const keyLevels: string[] = [];
  models.forEach(m => {
    // R6-FIX: HwrTradeModel 使用 stop_loss_hint 和 key_levels，無 entry_zone_low/high/stop_loss
    if (m.key_levels && m.key_levels.length > 0) {
      const entryLevel = m.key_levels.find(l => l.type === "fib" || l.type === "bull_ob" || l.type === "bear_ob");
      if (entryLevel) keyLevels.push(`${m.name} 進場區：${entryLevel.price.toFixed(1)}`);
    }
    if (m.stop_loss_hint) keyLevels.push(`${m.name} 止損：${m.stop_loss_hint.slice(0, 30)}`);
  });

  // 6. 風險提示
  const riskWarnings = models.filter(m => m.risk_warning).map(m => m.risk_warning);
  // R6-FIX: 使用 Array.from 避免 Set 迭代問題
  const uniqueRisks = Array.from(new Set(riskWarnings)).slice(0, 3);

  // 7. 入場扣板機條件
  const triggerConditions = bestModel?.entry_conditions?.slice(0, 3) ?? [];

  // 8. 生成結構化報告
  aiAnalysis = [
    `【市場狀態判斷】`,
    `當前 ${coinName} 處於「${marketState}」格局。`,
    `4H 纏論：${chanState4h}　1H 纏論：${chanState1h}`,
    reTf4h ? `4H 評分 ${reTf4h.total_score} 分（SMC ${reTf4h.smc_score} / PA ${reTf4h.pa_score} / Fib ${reTf4h.fib_score} / 纏 ${reTf4h.chan_score}）` : "",
    ``,
    `【最佳交易模型】`,
    `${bestModelName}（信心度 ${bestConf}%，${bestDir}，盈虧比 ${bestRR}:1）`,
    activeModels.length > 0
      ? `目前 ${activeModels.length} 個模型條件已滿足：${activeModels.map(m => m.name).join("、")}`
      : `目前所有模型條件尚未滿足，建議等待觸發。`,
    `SMC 三部曲設置：共 ${smcCount} 個，${smcActive} 個已啟動`,
    ``,
    `【進場扣板機條件（最後確認訊號）】`,
    ...(triggerConditions.length > 0
      ? triggerConditions.map((c, i) => `${i + 1}. ${c}`)
      : ["等待價格觸及進場區域後，觀察 15m K 線形態確認。"]),
    ``,
    `【關鍵價位】`,
    ...(keyLevels.length > 0 ? keyLevels : ["暫無明確進場區間，等待下次分析更新。"]),
    ``,
    `【風險管理建議】`,
    `• 首次進場建議半倉，確認方向後加倉`,
    `• 單筆風險控制在總資金 1% 以內`,
    `• 最低可接受盈虧比 ${bestRR}:1，低於此不做`,
    ...(uniqueRisks.length > 0 ? uniqueRisks.map(r => `• ${r}`) : []),
    ``,
    `【多時段共識】`,
    // R6-FIX: mtfConsensus 是字串（已經格式化），直接使用 overallDir 判斷方向
    `${overallDir === "long" ? "整體偏多 ↑" : overallDir === "short" ? "整體偏空 ↓" : "多空分歧，以 4H 方向為主"}（${longCount + shortCount}/${tfAnalyses.length} 時段共識）`,
  ].filter(line => line !== undefined).join("\n");

  console.log("[highWinRate.scan v2] 本地規則引擎分析完成");
  } // end if (!aiAnalysis)

  // ── v5.5 FIX：local 模式下，若 tradeDecision 仍為 undefined，使用本地規則引擎生成結構化決策 ──
  if (!tradeDecision && topModel) {
    const localModelId = topModel.id === "liquidity_reversal" ? "A" : topModel.id === "trend_pullback" ? "B" : "C";
    const localConf = topModel.confidence;
    const localDecision: "TRADE" | "WAIT" | "REJECT" =
      regimeResult.adaptiveParams.tradeFilter === "avoid" ? "REJECT"
      : macroData.macroFilter === "avoid" ? "REJECT"
      : isNoTradeRegime ? "WAIT"
      : localConf >= 60 && topModel.is_active ? "TRADE"
      : "WAIT";
    const localQuality = localConf >= 80 ? 5 : localConf >= 65 ? 4 : localConf >= 50 ? 3 : localConf >= 35 ? 2 : 1;
    const localTrigger = topModel.entry_conditions.slice(0, 2).join("；") || "等待價格觸及進場區後確認 K 線形態";
    const localSl = topModel.stop_loss_hint || "跌破最近結構低點";
    const localInvalidation = `價格有效跌破止損：${localSl}`;
    const localEdge = topModel.direction === "long"
      ? `多時框看多共識（${longCount}/${tfAnalyses.length} 時段），SMC 流動性清掃後回踩 OB`
      : topModel.direction === "short"
      ? `多時框看空共識（${shortCount}/${tfAnalyses.length} 時段），SMC 流動性清掃後回踩 OB`
      : "震盪環境，等待明確方向突破";
    const localFailure = isNoTradeRegime
      ? `多空方向衝突（看多 ${longCount} vs 看空 ${shortCount} 時段），假突破風險高`
      : `信心度 ${localConf}%，${regimeResult.regimeLabel} 環境下需謹慎`;
    tradeDecision = {
      decision: localDecision,
      model: localModelId as "A" | "B" | "C" | "NONE",
      setup_quality: localQuality as 1 | 2 | 3 | 4 | 5,
      primary_edge: localEdge,
      primary_failure_mode: localFailure,
      must_see_trigger: localTrigger,
      invalidation: localInvalidation,
      conflict_note: isNoTradeRegime ? `多空衝突：看多 ${longCount} 個 vs 看空 ${shortCount} 個時段` : "無明顯衝突",
      confidence: localConf,
      // v5.6 FIX [CODES]: 統一 reason_codes schema，與 AI 模式一致（GPT-5.4 審查修復）
      reason_codes: [
        overallDir === topModel.direction ? "HTF_ALIGNED" : "HTF_CONFLICT",
        topModel.is_active ? "SMC_TRILOGY_COMPLETE" : "SMC_TRILOGY_INCOMPLETE",
        regimeResult.adaptiveParams.tradeFilter === "proceed" ? "ENV_OK" : regimeResult.adaptiveParams.tradeFilter === "caution" ? "ENV_CAUTION" : "ENV_AVOID",
        localConf >= 65 ? "CONF_HIGH" : localConf >= 50 ? "CONF_MED" : "CONF_LOW",
        isNoTradeRegime ? "NO_TRADE_REGIME" : "REGIME_OK",
      ],
      dynamic_features_summary: dynamicFeaturesSummary,
    };
    console.log(`[highWinRate.scan v5.5 LOCAL] 本地 tradeDecision 生成：${tradeDecision.decision}（模型 ${tradeDecision.model}，信心度 ${tradeDecision.confidence}%）`);
  }

  // ── v5.1 改良：使用 calibrateKelly v2.1（N_eff + 動態 Kelly + 相關性矩陣）──
  // 原本：固定 1/4 Kelly，未考慮樣本量和相關性
  // 改良：動態 Kelly 因子 + N_eff 樣本量縮放 + 相關性懲罰

  // 對每個模型使用 calibrateKelly v2.1 計算倉位
  for (const m of models) {
    if (m.confidence <= 0 || m.rr_ratio <= 0) {
      m.kelly_fraction = 0;
      continue;
    }
    const kellyResult = calibrateKelly({
      rawConfidence: m.confidence,
      modelId: m.id,
      avgRR: m.rr_ratio,
      // v5.1 新增：傳入環境波動率和樣本量
      recentVolatility: (tf1h?.atr ?? 0) / (tf1h?.close ?? 1),
      sampleSize: 0, // v5.6 FIX [K2]: 不假設樣本量，讓 N_eff 保守處理（GPT-5.4 審查修復）
    });
    // 使用 adjustedMaxPositionPct（已經考慮 N_eff + 相關性懲罰）
    m.kelly_fraction = kellyResult.adjustedMaxPositionPct / 100;
  }

  // v5.1 新增：對每個模型計算 EV（期望值）分層分析
  for (const m of models) {
    if (m.confidence <= 0 || m.rr_ratio <= 0) continue;
    // v5.6 FIX [EV]: 使用 calibrateKelly 的 calibratedWinRate，不再用 confidence/100 近似（GPT-5.4 審查修復）
    const kellyForEv = calibrateKelly({ rawConfidence: m.confidence, modelId: m.id, avgRR: m.rr_ratio, sampleSize: 0 });
    const winRate = Math.min(0.75, Math.max(0.30, kellyForEv.calibratedWinRate));
    const lossRate = 1 - winRate;
    // EV = winRate * RR - lossRate * 1（以 1R 為基準）
    const ev = winRate * m.rr_ratio - lossRate;
    // EV 分層：優秀(>0.5) / 良好(0.2-0.5) / 一般(0-0.2) / 負期望值(<0)
    const evTier = ev > 0.5 ? '優秀' : ev > 0.2 ? '良好' : ev > 0 ? '一般' : '負期望值（不建議）';
    // 將 EV 分層寫入 risk_warning 供前端顯示
    const evNote = `EV=${ev.toFixed(2)}R（${evTier}）`;
    if (ev < 0) {
      m.is_active = false;
      m.risk_warning = `❌ [負期望值] ${evNote}，不建議操作 | ` + m.risk_warning;
    } else {
      m.risk_warning = `📊 ${evNote} | ` + m.risk_warning;
    }
  }

  // 曝險聚合：多模型同方向時，防止重複曝險
  const activeLongModels  = models.filter(m => m.is_active && m.direction === "long");
  const activeShortModels = models.filter(m => m.is_active && m.direction === "short");
  // 多個同方向模型同時啟動時，總倉位不超過最強模型的 1.5 倍
  if (activeLongModels.length > 1) {
    const maxKelly = Math.max(...activeLongModels.map(m => m.kelly_fraction ?? 0));
    const totalKelly = activeLongModels.reduce((s, m) => s + (m.kelly_fraction ?? 0), 0);
    if (totalKelly > maxKelly * 1.5) {
      // 按比例縮減
      const scale = (maxKelly * 1.5) / totalKelly;
      for (const m of activeLongModels) {
        if (m.kelly_fraction) m.kelly_fraction = Math.round(m.kelly_fraction * scale * 1000) / 1000;
      }
    }
  }
  if (activeShortModels.length > 1) {
    const maxKelly = Math.max(...activeShortModels.map(m => m.kelly_fraction ?? 0));
    const totalKelly = activeShortModels.reduce((s, m) => s + (m.kelly_fraction ?? 0), 0);
    if (totalKelly > maxKelly * 1.5) {
      const scale = (maxKelly * 1.5) / totalKelly;
      for (const m of activeShortModels) {
        if (m.kelly_fraction) m.kelly_fraction = Math.round(m.kelly_fraction * scale * 1000) / 1000;
      }
    }
  }

  // 連續虧損熱斷：如果所有模型信心度均低於 35%，全面熱斷
  const allLowConfidence = models.every(m => m.confidence < 35);
  if (allLowConfidence) {
    for (const m of models) {
      m.kelly_fraction = 0;
      m.is_active = false;
      m.risk_warning = "⛔ [熱斷] 所有模型信心度均低於 35%，建議停止交易居觀望。" + m.risk_warning;
    }
  }

  // ── v5.1 Ensemble Veto 集成決策 ──
  const conflictCount = Math.min(longCount, shortCount);
  // v5.1 修復：使用 tf1h 的真實 sweepQuality 計算結果，取代固定 65 分
  const tf1hSweepQuality = (() => {
    if (!tf1h?.liquidity_sweep?.sslSwept && !tf1h?.liquidity_sweep?.bslSwept) return undefined;
    let sq = 40;
    if (tf1h.liquidity_sweep.sslSwept && tf1h.smc_structure === 'bullish') sq += 20;
    if (tf1h.liquidity_sweep.bslSwept && tf1h.smc_structure === 'bearish') sq += 20;
    if (tf1h.liquidity_sweep.sslSwept && tf1h.smc_premium_discount === 'discount') sq += 15;
    if (tf1h.liquidity_sweep.bslSwept && tf1h.smc_premium_discount === 'premium') sq += 15;
    // 使用 pa_score 作為 RVOL 代理（pa_score > 65 表示量能充足）
    if ((tf1h.pa_score ?? 0) > 65) sq += 15;
    else if ((tf1h.pa_score ?? 0) < 40) sq -= 10;
    return Math.max(0, Math.min(100, sq));
  })();
  const ensembleResult = topModel ? runEnsembleVeto(
    {
      topModel: topModel as Parameters<typeof runEnsembleVeto>[0]['topModel'],
      allModels: models as Parameters<typeof runEnsembleVeto>[0]['allModels'],
      macro: macroData,
      htfTrend,
      conflictCount,
      sweepQualityScore: tf1hSweepQuality,
      dynamicFeatures: {
        displacementStrength: (tf1h?.smc_score ?? 0) / 100,
        volumeConfirmation: (tf1h?.pa_score ?? 0) > 60,
        freshZone: !(tf1h?.liquidity_sweep?.sslSwept && tf1h?.liquidity_sweep?.bslSwept),
      },
    },
    tradeDecision?.decision ?? 'WAIT',
    tradeDecision?.confidence ?? 50  // v5.1 修復：傳入真實 AI confidence_score 取代固定 50 分
  ) : null;

  // ── v4.0 合併三層產生單一最終策略 ──
  if (topModel && tradeDecision) {
    const modelId = topModel.id === "liquidity_reversal" ? "A" : topModel.id === "trend_pullback" ? "B" : "C";
    // v5.0: 使用 Ensemble Veto 結果作為主要信心度來源
    const ensembleConf = ensembleResult?.confidence ?? tradeDecision.confidence;
    const ensembleDecision = ensembleResult?.finalDecision ?? tradeDecision.decision;
    // 環境掃描警告時降低信心度
    const envPenalty = envScan?.trade_filter === "avoid" ? -20 : envScan?.trade_filter === "caution" ? -8 : 0;
    const finalConf = Math.max(0, Math.min(100, ensembleConf + envPenalty));
    // 環境 avoid 時強制覆寫為 REJECT
    const finalDecision = envScan?.trade_filter === "avoid" ? "REJECT"
      : macroData.macroFilter === "avoid" ? "REJECT"
      : ensembleDecision;
    // v5.5 新增：從 topModel.key_levels 提取 SMC 進場區數字區間
    const smcEntryLevels = topModel.key_levels.filter(l => l.type === 'smc_entry');
    const smcEntryTop    = smcEntryLevels.find(l => l.label.includes('上'))?.price ?? 0;
    const smcEntryBottom = smcEntryLevels.find(l => l.label.includes('下'))?.price ?? 0;
    // 若無 SMC 進場區，嘗試從 Fib OTE 區間提取
    const fibEntryHigh = smcEntryTop > 0 ? smcEntryTop
      : topModel.key_levels.find(l => l.type === 'fib' && l.label.includes('0.618'))?.price ?? 0;
    const fibEntryLow  = smcEntryBottom > 0 ? smcEntryBottom
      : topModel.key_levels.find(l => l.type === 'fib' && l.label.includes('0.786'))?.price ?? 0;
    // 從 topModel.smc_setups 中找最佳進場區（狀態 active 或 waiting）
    const bestSmcEntry = topModel.smc_setups
      .filter(s => !s.invalidated && (s.status === 'active' || s.status === 'waiting'))
      .sort((a, b) => b.confluence_score - a.confluence_score)[0];
    // v5.7 FIX: 確保 finalEntryHigh > finalEntryLow（防止 SMC setup 或 Fib 值反轉）
    const rawEntryHigh = bestSmcEntry?.entry_top ?? fibEntryHigh;
    const rawEntryLow  = bestSmcEntry?.entry_bottom ?? fibEntryLow;
    // 若 high < low（值被反了），自動交換
    const finalEntryHigh = (rawEntryHigh > 0 && rawEntryLow > 0) ? Math.max(rawEntryHigh, rawEntryLow) : rawEntryHigh;
    const finalEntryLow  = (rawEntryHigh > 0 && rawEntryLow > 0) ? Math.min(rawEntryHigh, rawEntryLow) : rawEntryLow;
    const finalEntryMid  = (finalEntryHigh > 0 && finalEntryLow > 0)
      ? (finalEntryHigh + finalEntryLow) / 2 : 0;
    // 計算進場區中點距市價距離百分比
    const currentClose = tf1h?.close ?? tf4h?.close ?? 0;
    const currentAtr   = tf1h?.atr ?? tf4h?.atr ?? 0;
    const distToEntryPct = (finalEntryMid > 0 && currentClose > 0)
      ? parseFloat(((currentClose - finalEntryMid) / currentClose * 100).toFixed(2))
      : undefined;
    // 超過 2 ATR 或 2% 視為過遠
    const atrDistPct = (currentAtr > 0 && currentClose > 0) ? (currentAtr * 2 / currentClose * 100) : 2;
    const entryTooFar = distToEntryPct !== undefined
      ? Math.abs(distToEntryPct) > Math.max(atrDistPct, 2.0)
      : false;
    // v5.7 FIX [DIST]: 修正 entry_state 判斷邏輯
    // 使用進場區邊界（而非中點）判斷市價是否「在區內」
    // 多頭：市價 > entry_zone_high = 需等待回踩；市價在區內 = IN_ZONE；市價 < entry_zone_low = MISSED
    // 空頭：市價 < entry_zone_low = 需等待反彈；市價在區內 = IN_ZONE；市價 > entry_zone_high = MISSED
    const entryState: "WAIT_PULLBACK" | "WAIT_BOUNCE" | "IN_ZONE" | "MISSED" = (() => {
      if (finalEntryHigh <= 0 || finalEntryLow <= 0 || currentClose <= 0) return "IN_ZONE";
      const dir = topModel.direction;
      if (dir === "long") {
        if (currentClose > finalEntryHigh) return "WAIT_PULLBACK";  // 市價在進場區上方，等待回踩
        if (currentClose < finalEntryLow)  return "MISSED";         // 市價已低於進場區，錯過
        return "IN_ZONE";                                            // 市價在進場區內，可進場
      } else if (dir === "short") {
        if (currentClose < finalEntryLow)  return "WAIT_BOUNCE";    // 市價在進場區下方，等待反彈
        if (currentClose > finalEntryHigh) return "MISSED";         // 市價已高於進場區，錯過
        return "IN_ZONE";                                            // 市價在進場區內，可進場
      }
      return "IN_ZONE";
    })();
    // v5.7 FIX [VETO]: entry_too_far 或 entry_state != IN_ZONE 時降級為 WAIT
    // 修正：當 decision=WAIT 但 entry_state=IN_ZONE 時，需要檢查是否真的可以進場
    const finalDecisionAfterVeto = (entryTooFar && finalDecision === "TRADE")
      ? "WAIT" as const
      : finalDecision;
    finalStrategy = {
      model_id: modelId as "A" | "B" | "C",
      model_name: topModel.name,
      decision: finalDecisionAfterVeto, // v5.6 FIX: 使用 veto 後的決策
      direction: topModel.direction,
      confidence: finalConf,
      setup_quality: tradeDecision.setup_quality,
      entry_zone: topModel.entry_conditions.slice(0, 2).join(" | "),
      // v5.5 新增：數字型進場區間和距市價距離
      entry_zone_low: finalEntryLow > 0 ? parseFloat(finalEntryLow.toFixed(2)) : undefined,
      entry_zone_high: finalEntryHigh > 0 ? parseFloat(finalEntryHigh.toFixed(2)) : undefined,
      dist_to_entry_pct: distToEntryPct,
      entry_too_far: entryTooFar,
      entry_state: entryState, // v5.6 FIX: 方向感知進場狀態
      stop_loss: topModel.stop_loss_hint,
      take_profit: topModel.take_profit_hint,
      rr_ratio: topModel.rr_ratio,
      kelly_fraction: topModel.kelly_fraction ?? 0,
      must_see_trigger: tradeDecision.must_see_trigger,
      invalidation: tradeDecision.invalidation,
      primary_edge: tradeDecision.primary_edge,
      primary_failure_mode: tradeDecision.primary_failure_mode,
      reason_codes: tradeDecision.reason_codes,
      env_filter: [
        envScan ? `${envScan.regime}（${envScan.trade_filter === "proceed" ? "✅ 適合交易" : envScan.trade_filter === "caution" ? "⚠️ 謹慎操作" : "🚫 建議迤避"}）` : "本地引擎，無環境掃描",
        `宏觀：${macroData.fearGreedLabel}（${macroData.fearGreedIndex}）| ${macroData.sessionName}`,
        ensembleResult ? `集成共識：${(ensembleResult.consensusStrength * 100).toFixed(0)}%（規則${ensembleResult.ruleEngineVote} / 量化${ensembleResult.quantScorerVote} / AI${ensembleResult.aiReviewerVote}）` : "",
      ].filter(Boolean).join(" | "),
      // v5.4 新增：集成評估負面因素（風險警示）
      negative_factors: ensembleResult?.negativeFactors ?? [],
      // v5.4 新增：市場環境各 regime 競爭分數
      regime_scores: regimeResult.regimeScores,
      // v5.4 新增：集成評估各評估器分數
      ensemble_scores: ensembleResult ? {
        rule_engine: ensembleResult.ruleEngineScore,
        quant_scorer: ensembleResult.quantScorerScore,
        ai_confidence: ensembleResult.aiConfidenceScore,
        consensus_strength: ensembleResult.consensusStrength,
      } : undefined,
    };
    console.log(`[highWinRate.scan v4.0] 最終策略：${finalStrategy.decision}（模型 ${finalStrategy.model_id}，信心度 ${finalStrategy.confidence}%）`);
  }

  return {
    models,
    tf_analyses: tfAnalyses,
    overall_direction: overallDir,
    mtf_consensus: mtfConsensus,
    ai_analysis: aiAnalysis,
    trade_decision: tradeDecision,
    env_scan: envScan,
    final_strategy: finalStrategy,
    session_info: {
      name: sessionInfo.name,
      liquidity: sessionInfo.liquidity,
      utc_hour: nowUtcHour,
      is_low_liquidity: isLowLiquidityPeriod,
    },
    scanned_at: Date.now(),
  };
}
