/**
 * paSetupClassifier.ts
 * PA Setup 分型分類器 v1.0
 *
 * 核心改良：將 1H PA 從單一評分拆成三種 setup 類型，分別設定：
 * - 進場條件門檻（session-specific）
 * - 目標 RR
 * - 出場模式
 *
 * 背景：1H PA 整體勝率 38%，但美洲盤勝率 60%，說明 session + setup 交互效應強
 * 拆分後預期：1H PA 勝率從 38% 提升到 44%~48%
 */

export type PASetupType =
  | "breakout_continuation"  // 強勢突破後回踩延續
  | "sweep_reversal"         // 流動性清掃後反轉
  | "range_rejection"        // 中樞/區間邊界拒絕
  | "invalid";               // 不符合任何有效類型

export type Session = "asia" | "london" | "newyork" | "offhours";
export type Direction = "long" | "short" | "neutral";

export interface PASetupInput {
  adx: number;                    // ADX 趨勢強度
  session: Session;               // 當前交易時段
  htfTrend: Direction;            // HTF 趨勢方向
  rangePosition: number;          // 0-1，在近期區間的位置（0=底部，1=頂部）
  sweepQuality: number;           // 0-100，清掃品質（v2）
  breakoutCloseStrength: number;  // 0-100，突破收盤強度
  retestHeld: boolean;            // 突破後回踩是否守住
  rejectionStrength: number;      // 0-100，邊界拒絕強度
  rvol: number;                   // 相對成交量
  rsi: number;                    // RSI
  direction: Direction;           // 訊號方向
}

export interface PASetupResult {
  setupType: PASetupType;
  minConfidence: number;          // 此 setup 在此 session 的最低信心度門檻
  targetRR: number;               // 建議目標 RR
  exitMode: "trailing" | "quick_tp" | "tight_tp";
  partialAtR: number;             // 第一次減倉的 R 倍數
  partialPct: number;             // 第一次減倉比例
  moveToBEAtR: number;            // 移動到保本的 R 倍數
  reason: string;
}

/**
 * 分類 PA Setup 類型
 */
export function classifyPASetup(x: PASetupInput): PASetupResult {
  // ── 類型 1：突破延續（breakout_continuation）──
  // 條件：強勢突破（收盤強度高）+ 回踩守住 + ADX 確認趨勢
  if (
    x.breakoutCloseStrength >= 65 &&
    x.retestHeld &&
    x.adx >= 20 &&
    x.htfTrend !== "neutral"
  ) {
    const minConf = minConfidenceBySetup("breakout_continuation", x.session);
    return {
      setupType: "breakout_continuation",
      minConfidence: minConf,
      targetRR: 2.8,
      exitMode: "trailing",
      partialAtR: 1.2,
      partialPct: 0.4,
      moveToBEAtR: 0.9,
      reason: `突破延續：收盤強度 ${x.breakoutCloseStrength}，回踩守住，ADX ${x.adx.toFixed(1)}`,
    };
  }

  // ── 類型 2：清掃反轉（sweep_reversal）──
  // 條件：高品質清掃 + 強拒絕
  if (
    x.sweepQuality >= 65 &&
    x.rejectionStrength >= 60
  ) {
    const minConf = minConfidenceBySetup("sweep_reversal", x.session);
    return {
      setupType: "sweep_reversal",
      minConfidence: minConf,
      targetRR: 1.8,
      exitMode: "quick_tp",
      partialAtR: 1.0,
      partialPct: 0.6,
      moveToBEAtR: 0.8,
      reason: `清掃反轉：sweepQuality ${x.sweepQuality}，拒絕強度 ${x.rejectionStrength}`,
    };
  }

  // ── 類型 3：區間邊界拒絕（range_rejection）──
  // 條件：低 ADX（震盪市）+ 邊界位置 + 強拒絕
  if (
    x.adx < 22 &&
    (x.rangePosition > 0.72 || x.rangePosition < 0.28) &&
    x.rejectionStrength >= 65
  ) {
    const minConf = minConfidenceBySetup("range_rejection", x.session);
    return {
      setupType: "range_rejection",
      minConfidence: minConf,
      targetRR: 1.4,
      exitMode: "tight_tp",
      partialAtR: 0.8,
      partialPct: 0.7,
      moveToBEAtR: 0.6,
      reason: `區間拒絕：ADX ${x.adx.toFixed(1)} 震盪，rangePos ${x.rangePosition.toFixed(2)}，拒絕強度 ${x.rejectionStrength}`,
    };
  }

  // ── 無效 Setup ──
  return {
    setupType: "invalid",
    minConfidence: 999,
    targetRR: 0,
    exitMode: "tight_tp",
    partialAtR: 0,
    partialPct: 0,
    moveToBEAtR: 0,
    reason: "不符合任何有效 PA setup 類型",
  };
}

/**
 * 各 setup 類型在各時段的最低信心度門檻
 * 核心邏輯：美洲盤/歐洲盤門檻較低（流動性高），亞洲盤門檻更嚴
 */
export function minConfidenceBySetup(setup: PASetupType, session: Session): number {
  const thresholds: Record<PASetupType, Record<Session, number>> = {
    breakout_continuation: {
      newyork: 60,
      london: 62,
      asia: 72,
      offhours: 80,
    },
    sweep_reversal: {
      newyork: 58,
      london: 63,
      asia: 72,
      offhours: 82,
    },
    range_rejection: {
      newyork: 65,
      london: 68,
      asia: 75,
      offhours: 85,
    },
    invalid: {
      newyork: 999,
      london: 999,
      asia: 999,
      offhours: 999,
    },
  };
  return thresholds[setup]?.[session] ?? 999;
}

/**
 * 15m MTF 進場門檻過濾
 * 解決：15m PF 1.86 但淨報酬 0% 的問題
 * 核心：強制 HTF 共振 + session 過濾 + 成本後 EV 門檻
 */
export interface MTFGateInput {
  direction: Direction;
  confidence: number;
  estimatedWinRate: number;   // 校準後勝率（0-1）
  expectedRR: number;
  regime: "trend" | "range";
  session: Session;
  h1Direction: Direction;
  h1Strength: number;         // 0-100
  h4Direction: Direction;
  h4Strength: number;         // 0-100
  feePct?: number;            // 手續費（預設 0.08%）
  slipPct?: number;           // 滑點（預設 0.07%）
}

export interface MTFGateResult {
  passes: boolean;
  reason: string;
  mtfAlignScore: number;      // 0-100
  netEV: number;              // 成本後期望值（R 倍數）
}

export function check15mMTFGate(x: MTFGateInput): MTFGateResult {
  const feePct = x.feePct ?? 0.0008;
  const slipPct = x.slipPct ?? 0.0007;

  if (x.direction === "neutral") {
    return { passes: false, reason: "方向中性，不進場", mtfAlignScore: 0, netEV: 0 };
  }

  // ── MTF 共振分數 ──
  let mtfScore = 0;
  if (x.direction === x.h1Direction) mtfScore += x.h1Strength * 0.6;
  if (x.direction === x.h4Direction) mtfScore += x.h4Strength * 0.4;
  if (x.direction !== x.h1Direction && x.h1Direction !== "neutral") mtfScore -= 20;
  if (x.direction !== x.h4Direction && x.h4Direction !== "neutral") mtfScore -= 15;
  mtfScore = Math.max(0, Math.min(100, mtfScore));

  if (mtfScore < 55) {
    return { passes: false, reason: `MTF 共振分數不足（${mtfScore.toFixed(0)}/100，需 ≥ 55）`, mtfAlignScore: mtfScore, netEV: 0 };
  }

  // ── Session 過濾 ──
  if (x.session === "offhours") {
    return { passes: false, reason: "非交易時段（offhours）", mtfAlignScore: mtfScore, netEV: 0 };
  }
  if (x.session === "asia" && x.confidence < 78) {
    return { passes: false, reason: `亞洲盤信心度不足（${x.confidence}%，需 ≥ 78%）`, mtfAlignScore: mtfScore, netEV: 0 };
  }

  // ── 成本後期望值 ──
  const cost = (feePct + slipPct) * 100; // 轉換為 R 倍數（假設 SL = 1%）
  const netEV = x.estimatedWinRate * x.expectedRR - (1 - x.estimatedWinRate) - cost;

  if (netEV < 0.12) {
    return { passes: false, reason: `成本後期望值不足（EV=${netEV.toFixed(3)}R，需 ≥ 0.12R）`, mtfAlignScore: mtfScore, netEV };
  }

  // ── 震盪市更嚴格 ──
  if (x.regime === "range" && x.confidence < 72) {
    return { passes: false, reason: `震盪市信心度不足（${x.confidence}%，需 ≥ 72%）`, mtfAlignScore: mtfScore, netEV };
  }

  return { passes: true, reason: `通過：MTF ${mtfScore.toFixed(0)}分，EV=${netEV.toFixed(3)}R`, mtfAlignScore: mtfScore, netEV };
}
