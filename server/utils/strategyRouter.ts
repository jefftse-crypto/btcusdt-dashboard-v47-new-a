/**
 * strategyRouter.ts  v1.0
 * 策略路由器：根據市場 Regime 動態啟停策略
 *
 * GPT-5.4 審查建議：
 *  - 在 RANGING 市場中停用趨勢跟蹤策略（Vegas、EMA、MACD 趨勢版）
 *  - 在 IMPULSIVE 市場中停用均值回歸策略（布林抄底、KD 超賣）
 *  - 在 VOLATILE 市場中收緊止損倍數、降低倉位
 *  - 根據 regime 自動調整策略權重
 *
 * 策略分類：
 *  - TREND_FOLLOWING: 趨勢跟蹤策略（需要 TRENDING/IMPULSIVE 市場）
 *  - MEAN_REVERSION: 均值回歸策略（需要 RANGING 市場）
 *  - BREAKOUT: 突破策略（TRENDING/IMPULSIVE 市場效果最佳）
 *  - STRUCTURE: 結構策略（所有市場均可，但 RANGING 時降低權重）
 *  - UNIVERSAL: 通用策略（所有市場均可）
 */

// ─────────────────────────────────────────────────────────────────────────────
// 市場 Regime 類型
// ─────────────────────────────────────────────────────────────────────────────

export type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGING"
  | "IMPULSIVE"
  | "VOLATILE"
  | "UNKNOWN";

// ─────────────────────────────────────────────────────────────────────────────
// 策略類型定義
// ─────────────────────────────────────────────────────────────────────────────

export type StrategyType =
  | "TREND_FOLLOWING"
  | "MEAN_REVERSION"
  | "BREAKOUT"
  | "STRUCTURE"
  | "UNIVERSAL";

export interface StrategyConfig {
  id: string;
  name: string;
  type: StrategyType;
  /** 各 regime 下的啟用狀態 */
  enabledRegimes: MarketRegime[];
  /** 各 regime 下的權重（0~1，預設 1.0） */
  regimeWeights: Partial<Record<MarketRegime, number>>;
  /** 各 regime 下的止損倍數調整（預設 1.0） */
  slMultipliers: Partial<Record<MarketRegime, number>>;
  /** 各 regime 下的倉位比例調整（預設 1.0） */
  positionMultipliers: Partial<Record<MarketRegime, number>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 策略配置表
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGY_CONFIGS: StrategyConfig[] = [
  // ── 趨勢跟蹤策略 ──────────────────────────────────────────────────────────
  {
    id: "vegas_tunnel",
    name: "Vegas 雙通道",
    type: "TREND_FOLLOWING",
    enabledRegimes: ["TRENDING_UP", "TRENDING_DOWN", "IMPULSIVE"],
    regimeWeights: {
      TRENDING_UP: 1.0,
      TRENDING_DOWN: 1.0,
      IMPULSIVE: 0.8,
      RANGING: 0,      // 震盪市停用
      VOLATILE: 0.5,
      UNKNOWN: 0.3,
    },
    slMultipliers: {
      IMPULSIVE: 1.5,  // 急漲急跌時放寬止損
      VOLATILE: 1.8,
    },
    positionMultipliers: {
      IMPULSIVE: 0.7,
      VOLATILE: 0.5,
    },
  },
  {
    id: "ema_signal",
    name: "EMA 信號",
    type: "TREND_FOLLOWING",
    enabledRegimes: ["TRENDING_UP", "TRENDING_DOWN", "IMPULSIVE"],
    regimeWeights: {
      TRENDING_UP: 1.0,
      TRENDING_DOWN: 1.0,
      IMPULSIVE: 0.7,
      RANGING: 0,
      VOLATILE: 0.4,
      UNKNOWN: 0.3,
    },
    slMultipliers: { VOLATILE: 1.5 },
    positionMultipliers: { VOLATILE: 0.5 },
  },
  {
    id: "macd_divergence",
    name: "MACD 背離",
    type: "TREND_FOLLOWING",
    enabledRegimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "IMPULSIVE"],
    regimeWeights: {
      TRENDING_UP: 0.9,
      TRENDING_DOWN: 0.9,
      RANGING: 0.6,    // 震盪市背離更可靠
      IMPULSIVE: 0.5,
      VOLATILE: 0.4,
      UNKNOWN: 0.3,
    },
    slMultipliers: {},
    positionMultipliers: { VOLATILE: 0.6 },
  },

  // ── 均值回歸策略 ──────────────────────────────────────────────────────────
  {
    id: "boll_reversion",
    name: "布林通道四招",
    type: "MEAN_REVERSION",
    enabledRegimes: ["RANGING", "VOLATILE"],
    regimeWeights: {
      RANGING: 1.0,    // 震盪市最佳
      VOLATILE: 0.7,
      TRENDING_UP: 0.3,   // 趨勢市謹慎使用（只做回調）
      TRENDING_DOWN: 0.3,
      IMPULSIVE: 0,    // 急漲急跌停用
      UNKNOWN: 0.2,
    },
    slMultipliers: { VOLATILE: 1.3 },
    positionMultipliers: { TRENDING_UP: 0.5, TRENDING_DOWN: 0.5, VOLATILE: 0.6 },
  },
  {
    id: "kd_high_win",
    name: "KD 高勝率",
    type: "MEAN_REVERSION",
    enabledRegimes: ["RANGING", "VOLATILE", "TRENDING_UP", "TRENDING_DOWN"],
    regimeWeights: {
      RANGING: 1.0,
      VOLATILE: 0.6,
      TRENDING_UP: 0.5,   // 趨勢中只做超賣回調
      TRENDING_DOWN: 0.5,
      IMPULSIVE: 0.2,
      UNKNOWN: 0.3,
    },
    slMultipliers: { VOLATILE: 1.4, IMPULSIVE: 1.8 },
    positionMultipliers: { IMPULSIVE: 0.4, VOLATILE: 0.6 },
  },

  // ── 突破策略 ──────────────────────────────────────────────────────────────
  {
    id: "triangle_breakout",
    name: "三角收斂突破",
    type: "BREAKOUT",
    enabledRegimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "IMPULSIVE"],
    regimeWeights: {
      TRENDING_UP: 0.9,
      TRENDING_DOWN: 0.9,
      RANGING: 0.8,    // 震盪末期突破
      IMPULSIVE: 1.0,  // 急漲急跌時突破最強
      VOLATILE: 0.6,
      UNKNOWN: 0.4,
    },
    slMultipliers: { IMPULSIVE: 1.3, VOLATILE: 1.5 },
    positionMultipliers: { VOLATILE: 0.6 },
  },
  {
    id: "atr_dynamic",
    name: "ATR 動態止損",
    type: "BREAKOUT",
    enabledRegimes: ["TRENDING_UP", "TRENDING_DOWN", "IMPULSIVE", "VOLATILE"],
    regimeWeights: {
      TRENDING_UP: 0.8,
      TRENDING_DOWN: 0.8,
      IMPULSIVE: 1.0,
      VOLATILE: 0.9,
      RANGING: 0.3,
      UNKNOWN: 0.4,
    },
    slMultipliers: { VOLATILE: 1.0 }, // ATR 已動態調整，不額外放寬
    positionMultipliers: { VOLATILE: 0.7 },
  },

  // ── 結構策略 ──────────────────────────────────────────────────────────────
  {
    id: "obv_divergence",
    name: "OBV 背離",
    type: "STRUCTURE",
    enabledRegimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "IMPULSIVE", "VOLATILE"],
    regimeWeights: {
      TRENDING_UP: 0.8,
      TRENDING_DOWN: 0.8,
      RANGING: 0.7,
      IMPULSIVE: 0.6,
      VOLATILE: 0.5,
      UNKNOWN: 0.4,
    },
    slMultipliers: {},
    positionMultipliers: { VOLATILE: 0.7 },
  },
  {
    id: "volume_confirm",
    name: "成交量確認",
    type: "STRUCTURE",
    enabledRegimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "IMPULSIVE", "VOLATILE", "UNKNOWN"],
    regimeWeights: {
      TRENDING_UP: 0.9,
      TRENDING_DOWN: 0.9,
      RANGING: 0.7,
      IMPULSIVE: 1.0,
      VOLATILE: 0.8,
      UNKNOWN: 0.5,
    },
    slMultipliers: {},
    positionMultipliers: {},
  },

  // ── 通用策略 ──────────────────────────────────────────────────────────────
  {
    id: "kdj",
    name: "KDJ 指標",
    type: "UNIVERSAL",
    enabledRegimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "IMPULSIVE", "VOLATILE", "UNKNOWN"],
    regimeWeights: {
      TRENDING_UP: 0.7,
      TRENDING_DOWN: 0.7,
      RANGING: 0.9,
      IMPULSIVE: 0.5,
      VOLATILE: 0.6,
      UNKNOWN: 0.5,
    },
    slMultipliers: { IMPULSIVE: 1.5, VOLATILE: 1.3 },
    positionMultipliers: { IMPULSIVE: 0.5, VOLATILE: 0.6 },
  },
  {
    id: "fib_retracement",
    name: "斐波那契回撤",
    type: "UNIVERSAL",
    enabledRegimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "IMPULSIVE", "VOLATILE", "UNKNOWN"],
    regimeWeights: {
      TRENDING_UP: 0.9,
      TRENDING_DOWN: 0.9,
      RANGING: 0.6,
      IMPULSIVE: 0.7,
      VOLATILE: 0.6,
      UNKNOWN: 0.5,
    },
    slMultipliers: {},
    positionMultipliers: {},
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 策略路由器核心函數
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyRouterResult {
  regime: MarketRegime;
  active_strategies: string[];
  disabled_strategies: string[];
  strategy_weights: Record<string, number>;
  strategy_sl_multipliers: Record<string, number>;
  strategy_position_multipliers: Record<string, number>;
  regime_description: string;
  recommended_approach: string;
}

/**
 * 根據市場 Regime 決定哪些策略應該啟用，以及各策略的權重和參數調整
 * @param regime 當前市場 Regime
 * @returns 策略路由結果
 */
export function routeStrategiesByRegime(regime: MarketRegime): StrategyRouterResult {
  const activeStrategies: string[] = [];
  const disabledStrategies: string[] = [];
  const strategyWeights: Record<string, number> = {};
  const strategySlMultipliers: Record<string, number> = {};
  const strategyPositionMultipliers: Record<string, number> = {};

  for (const config of STRATEGY_CONFIGS) {
    const weight = config.regimeWeights[regime] ?? 0.5;
    const slMult = config.slMultipliers[regime] ?? 1.0;
    const posMult = config.positionMultipliers[regime] ?? 1.0;

    if (weight > 0 && config.enabledRegimes.includes(regime)) {
      activeStrategies.push(config.id);
      strategyWeights[config.id] = weight;
      strategySlMultipliers[config.id] = slMult;
      strategyPositionMultipliers[config.id] = posMult;
    } else {
      disabledStrategies.push(config.id);
      strategyWeights[config.id] = 0;
    }
  }

  const regimeDescriptions: Record<MarketRegime, string> = {
    TRENDING_UP: "上升趨勢：趨勢跟蹤策略效果最佳，均值回歸謹慎使用",
    TRENDING_DOWN: "下降趨勢：趨勢跟蹤策略效果最佳，均值回歸謹慎使用",
    RANGING: "震盪盤整：均值回歸策略最佳，趨勢策略停用",
    IMPULSIVE: "急漲急跌：突破策略最佳，止損放寬，倉位縮小",
    VOLATILE: "高波動：所有策略降低倉位，止損放寬",
    UNKNOWN: "不明確：保守操作，降低所有策略權重",
  };

  const recommendedApproaches: Record<MarketRegime, string> = {
    TRENDING_UP: "順勢做多，回調進場，寬止損追趨勢",
    TRENDING_DOWN: "順勢做空，反彈進場，寬止損追趨勢",
    RANGING: "高賣低買，布林通道邊界進場，窄止損快出",
    IMPULSIVE: "等待回調確認，避免追高，止損放寬至 1.5-2x ATR",
    VOLATILE: "降低倉位至 50%，等待波動收斂後再進場",
    UNKNOWN: "觀望為主，只交易最高信心度信號（STRONG 等級）",
  };

  return {
    regime,
    active_strategies: activeStrategies,
    disabled_strategies: disabledStrategies,
    strategy_weights: strategyWeights,
    strategy_sl_multipliers: strategySlMultipliers,
    strategy_position_multipliers: strategyPositionMultipliers,
    regime_description: regimeDescriptions[regime],
    recommended_approach: recommendedApproaches[regime],
  };
}

/**
 * 根據策略路由結果，調整信號的最終分數
 * @param strategyId 策略 ID
 * @param rawScore 原始信號分數（0~100）
 * @param routerResult 策略路由結果
 * @returns 調整後的分數
 */
export function applyRegimeWeightToScore(
  strategyId: string,
  rawScore: number,
  routerResult: StrategyRouterResult,
): number {
  const weight = routerResult.strategy_weights[strategyId] ?? 0.5;
  return Math.round(rawScore * weight);
}

/**
 * 根據策略路由結果，調整止損距離
 * @param strategyId 策略 ID
 * @param rawSlDistance 原始止損距離
 * @param routerResult 策略路由結果
 * @returns 調整後的止損距離
 */
export function applyRegimeSlMultiplier(
  strategyId: string,
  rawSlDistance: number,
  routerResult: StrategyRouterResult,
): number {
  const mult = routerResult.strategy_sl_multipliers[strategyId] ?? 1.0;
  return rawSlDistance * mult;
}

/**
 * 根據策略路由結果，調整建議倉位比例
 * @param strategyId 策略 ID
 * @param basePositionPct 基礎倉位比例（0~1）
 * @param routerResult 策略路由結果
 * @returns 調整後的倉位比例
 */
export function applyRegimePositionMultiplier(
  strategyId: string,
  basePositionPct: number,
  routerResult: StrategyRouterResult,
): number {
  const mult = routerResult.strategy_position_multipliers[strategyId] ?? 1.0;
  return Math.min(basePositionPct * mult, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 輔助：將 marketRegimeClassifier 的輸出轉換為本模組的 MarketRegime 類型
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 將 marketRegimeClassifier 的 regime 字串轉換為 MarketRegime 類型
 */
export function normalizeRegime(rawRegime: string): MarketRegime {
  const map: Record<string, MarketRegime> = {
    "TRENDING_UP": "TRENDING_UP",
    "TRENDING_DOWN": "TRENDING_DOWN",
    "RANGING": "RANGING",
    "IMPULSIVE": "IMPULSIVE",
    "VOLATILE": "VOLATILE",
    "trending_up": "TRENDING_UP",
    "trending_down": "TRENDING_DOWN",
    "ranging": "RANGING",
    "impulsive": "IMPULSIVE",
    "volatile": "VOLATILE",
    "bullish": "TRENDING_UP",
    "bearish": "TRENDING_DOWN",
    "neutral": "RANGING",
  };
  return map[rawRegime] ?? "UNKNOWN";
}
