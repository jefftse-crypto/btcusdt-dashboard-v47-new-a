// Shared types for crypto dashboard

export type Timeframe = "4h" | "1h" | "15m" | "5m";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorData {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  adx: { adx: number; plus_di: number; minus_di: number };
  atr: number;
  bollinger: { upper: number; middle: number; lower: number; bandwidth: number; percent_b: number };
  vwap: number;
  ema: { ema20: number; ema50: number; ema200: number };
  stochastic: { k: number; d: number };
  trend: "bullish" | "bearish" | "neutral";
  momentum: "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";
  close: number;
}

export interface FVG {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  mid: number;
  time: number;
  filled: boolean;
  size: number;
  idx: number;
}

export interface OrderBlock {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  mid: number;
  time: number;
  tested: boolean;
  strength: "strong" | "normal";
  idx: number;
}

export interface BosChoch {
  type: "BOS" | "CHoCH" | "MSS";
  direction: "bullish" | "bearish";
  level: number;
  time: number;
  idx: number;
  description: string;
}

export interface LiquidityLevel {
  price: number;
  type: "BSL" | "SSL";  // Buy-Side / Sell-Side Liquidity
  swept: boolean;
  strength: "strong" | "normal";
}

export interface OteZone {
  direction: "bullish" | "bearish";
  fib_618: number;
  fib_705: number;
  fib_786: number;
  swing_high: number;
  swing_low: number;
  in_zone: boolean;
}

// SMC Ultimate Confirmation: Sweep -> FVG (Displacement) -> OB (Retracement)
export interface SmcConfirmationSetup {
  id: string;
  direction: "bullish" | "bearish";
  // Act 1: Liquidity Sweep
  sweep: {
    type: "BSL" | "SSL";  // swept buy-side or sell-side liquidity
    swept_level: number;
    sweep_time: number;
    sweep_candle_idx: number;
  };
  // Act 2: Displacement + FVG
  fvg: FVG;
  // Act 3: Order Block (entry zone)
  ob: OrderBlock;
  // Confluence score 0-100
  confluence_score: number;
  htf_aligned: boolean;  // higher timeframe bias aligned
  entry_zone: { top: number; bottom: number };
  sl: number;
  tp1: number;
  tp2: number;
  rr_ratio: number;
  status: "waiting" | "active" | "invalidated" | "completed";
  formed_at: number;
  /** R6-FIX: 加入 invalidated 屬性，用於明確標記失效狀態 */
  invalidated?: boolean;
}

export interface SmcData {
  structure: "bullish" | "bearish" | "ranging";
  fvgs: FVG[];
  order_blocks: OrderBlock[];
  bos_choch: BosChoch[];
  liquidity: {
    sell_side: number[];
    buy_side: number[];
    nearest_sell: number;
    nearest_buy: number;
    levels: LiquidityLevel[];
  };
  nearest_bull_fvg: FVG | null;
  nearest_bear_fvg: FVG | null;
  nearest_bull_ob: OrderBlock | null;
  nearest_bear_ob: OrderBlock | null;
  fvg_count: number;
  ob_count: number;
  // ICT concepts
  premium_discount: {
    equilibrium: number;
    current_zone: "premium" | "discount" | "equilibrium";
    percent_position: number;
  };
  ote_zone: OteZone | null;
  recent_swing_high: number;
  recent_swing_low: number;
  liquidity_levels: LiquidityLevel[];
  // SMC Ultimate Confirmation Model (Sweep -> FVG -> OB)
  confirmation_setups: SmcConfirmationSetup[];
}

// PA Divergence Detection
export interface PaDivergence {
  type: "regular_bullish" | "regular_bearish" | "hidden_bullish" | "hidden_bearish";
  indicator: "rsi" | "macd";
  timeframe: string;
  price_high1?: number;
  price_high2?: number;
  price_low1?: number;
  price_low2?: number;
  indicator_val1: number;
  indicator_val2: number;
  strength: "strong" | "medium" | "weak";
  description: string;
  candle_idx: number;
  time: number;
}

// PA Pattern with Key Level Confluence
export interface PaPatternWithLevel {
  pattern: CandlestickPattern;
  at_key_level: boolean;
  nearest_level: SRLevel | null;
  distance_to_level_pct: number;  // % distance to nearest S/R
  liquidity_nearby: boolean;
  confluence_score: number;  // 0-100
  entry: number;
  sl: number;
  tp: number;
  timeframe: string;
  time: number;
}

export interface CandlestickPattern {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  strength: "strong" | "medium" | "weak";
  desc: string;
}

export interface ChanZhongshu {
  top: number;
  bottom: number;
  mid: number;
  start_time: number;
  end_time: number;
}

// Chan Theory Buy/Sell Points (一二三類買賣點)
export interface ChanBuyPoint {
  level: 1 | 2 | 3;  // 一買、二買、三買
  direction: "buy" | "sell";
  price: number;
  time: number;
  bi_idx: number;
  description: string;
  strength: "strong" | "medium" | "weak";
  // For level 1: confirmed by divergence
  divergence_confirmed: boolean;
  // For level 2: after zhongshu break, first pullback
  after_zhongshu_break: boolean;
  // For level 3: trend continuation
  trend_continuation: boolean;
}

export interface ChanData {
  bis: unknown[];
  duans: unknown[];
  zhongshus: ChanZhongshu[];
  trend: "bullish" | "bearish" | "ranging";
  in_zhongshu: boolean;
  current_zhongshu: ChanZhongshu | null;
  bi_count: number;
  duan_count: number;
  buy_sell_points?: ChanBuyPoint[];  // 一二三類買賣點
  divergence_signals?: { type: "top" | "bottom" | null; description: string; strength?: string };
}

export interface SRLevel {
  price: number;
  type: "support" | "resistance";
  strength: number;   // 1–5, based on touch count
  touches: number;
  label?: string;     // R8-FIX: 加入可選標籤
}

export interface TimeframePaResult {
  timeframe: string;
  trend: "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";
  trend_context: "strong_trend" | "weak_trend" | "ranging";  // Al Brooks
  score: number;
  close: number;
  rsi: number;
  atr: number;
  ema20: number;
  ema50: number;
  ema200: number;
  macd_hist: number;
  adx?: number;
  plus_di?: number;
  minus_di?: number;
  bollinger?: { upper: number; middle: number; lower: number; bandwidth: number; percent_b: number };
  bb_position?: string;
  bb_squeeze?: boolean;
  vwap?: number;
  vwap_position?: string;
  cmf?: number;
  patterns: CandlestickPattern[];
  chan: ChanData;
  support: number;
  resistance: number;
  // Enhanced PA fields
  sr_levels: SRLevel[];           // Multi-touch S/R levels
  false_break_score: number;      // 0-100, higher = more likely false break
  false_break_direction: "bullish" | "bearish" | "none";  // direction of potential false break
  mtf_alignment: number;          // 0-100, multi-timeframe trend alignment
  volume_trend: "increasing" | "decreasing" | "neutral";
  price_vs_vwap: "above" | "below" | "at";
  key_level_proximity: number;    // % distance to nearest key level
  // PA Divergence signals
  divergences?: PaDivergence[];
  // PA Patterns with key level confluence
  high_confluence_patterns?: PaPatternWithLevel[];
}

export interface PaData {
  timeframes: Record<string, TimeframePaResult>;
  consensus: "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";
  avg_score: number;
  suggestion: string;
  entry_params: {
    direction: "long" | "short";
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    rr_ratio: number;
  } | Record<string, never>;
  // Cross-timeframe divergence summary
  divergence_summary?: {
    has_bullish_divergence: boolean;
    has_bearish_divergence: boolean;
    strongest_divergence: PaDivergence | null;
    divergence_count: number;
  };
  // High confluence PA setups
  top_setups?: PaPatternWithLevel[];
}

export interface ConsensusData {
  score: number;
  label: string;
}

export interface ForecastData {
  main_scenario: string;
  main_probability: number;
  main_target: number;
  main_description: string;
  main_candles_estimate?: number;
  main_invalidation?: number;
  alt_scenario: string;
  alt_probability: number;
  alt_target: number;
  alt_description: string;
  alt_candles_estimate?: number;
  alt_invalidation?: number;
  extreme_scenario?: string;
  extreme_probability?: number;
  extreme_target?: number;
  extreme_description?: string;
  extreme_invalidation?: number;
}

export interface StrategyChecklist {
  label: string;
  passed: boolean;
  value?: string;
}
export interface StrategyData {
  direction: "long" | "short" | "neutral";
  entry?: number;
  sl?: number;
  tp1?: number;
  tp2?: number;
  rr_ratio?: number;
  atr: number;
  suggestion: string;
  checklist?: StrategyChecklist[];
  similar_pattern?: { win_rate: number; avg_return: number; sample_count: number; description: string };
}

export interface OnchainData {
  funding_rate: { rate: number; time: number } | null;
  long_short_ratio: { long_ratio: number; short_ratio: number; ls_ratio: number } | null;
  fear_greed: { value: number; label: string } | null;
  open_interest: { open_interest: number } | null;
  coingecko: {
    market_cap?: number;
    total_volume?: number;
    price_change_24h?: number;
    price_change_7d?: number;
    ath?: number;
    ath_change_pct?: number;
  } | null;
}

export interface ChanZhongshuData {
  top: number;
  bottom: number;
  mid: number;
  start_time: number;
  end_time: number;
}
export interface ChanBiData { direction: "up" | "down"; start: number; end: number; start_time: number; end_time: number; }
export interface ChanDuanData { direction: "up" | "down"; start: number; end: number; start_time: number; end_time: number; }
export interface ChanResultData {
  bis: ChanBiData[];
  duans: ChanDuanData[];
  zhongshus: ChanZhongshuData[];
  trend: "bullish" | "bearish" | "ranging";
  in_zhongshu: boolean;
  current_zhongshu: ChanZhongshuData | null;
  bi_count: number;
  duan_count: number;
  divergence?: { type: "top" | "bottom" | null; description: string };
  zhongshu_entry_exit?: "entering" | "exiting" | "inside" | "outside";
  // Enhanced: buy/sell points
  buy_sell_points?: ChanBuyPoint[];
  macd_area_ratio?: number;  // ratio of current MACD area vs previous (for divergence)
}
export interface ChanTimeframeSignalData {
  trend: "bullish" | "bearish" | "ranging";
  bi_count: number;
  duan_count: number;
  zhongshu_count: number;
  in_zhongshu: boolean;
  current_zhongshu: ChanZhongshuData | null;
  signal: string;
  signal_type: "buy" | "sell" | "watch" | "neutral";
  signal_reason?: string;
  divergence?: { type: "top" | "bottom" | null; description: string };
  zhongshu_entry_exit?: "entering" | "exiting" | "inside" | "outside";
  // Enhanced: buy/sell points
  buy_sell_points?: ChanBuyPoint[];
}
export interface ChanMtfSummaryData {
  overall_trend: "bullish" | "bearish" | "ranging";
  trend_alignment: number;
  bullish_count: number;
  bearish_count: number;
  ranging_count: number;
  in_zhongshu_count: number;
  dominant_timeframe: string;
  suggestion: string;
  detail: string;
  entry_timing: string;
  // Enhanced: best buy/sell point across timeframes
  best_buy_point?: { timeframe: string; point: ChanBuyPoint } | null;
  best_sell_point?: { timeframe: string; point: ChanBuyPoint } | null;
}
export interface ChanMtfData {
  timeframes: Record<string, ChanResultData>;
  signals: Record<string, ChanTimeframeSignalData>;
  summary: ChanMtfSummaryData;
}

export interface CryptoSnapshot {
  symbol: string;
  generated_at: string;
  live_price: number;
  error: string | null;
  indicators: IndicatorData;
  mtf_indicators?: {
    "4h": IndicatorData;
    "1h": IndicatorData;
    "15m": IndicatorData;
    "5m": IndicatorData;
  };
  smc: SmcData;
  pa: PaData;
  chan_mtf?: ChanMtfData;
  consensus: ConsensusData;
  forecast_4h: ForecastData;
  strategy: StrategyData;
  onchain: OnchainData;
  klines: Record<Timeframe, Candle[]>;
  advanced?: {
    divergences_4h: unknown[];
    divergences_1h: unknown[];
    pa_patterns_4h: unknown[];
    pa_patterns_1h: unknown[];
    chan_enhanced_4h: unknown;
    chan_enhanced_1h: unknown;
    smc_confirmations: unknown[];
  };
}

export interface NewsItem {
  title: string;
  link: string;
  description: string;
  pubDate: number;
  source: string;
  sentiment: "bullish" | "bearish" | "neutral";
}

// ─────────────────────────────────────────────────────────────────────────────
// High Win Rate Strategy — Shared DTOs (v3.0)
// ─────────────────────────────────────────────────────────────────────────────

/** 高勝率策略：關鍵水位標籤 */
export interface HwrKeyLevel {
  label: string;
  price: number;
  type: string;
}

/** 高勝率策略：纏論買賣點精簡 DTO（繼承 ChanBuyPoint 核心欄位） */
export interface HwrChanBuySellPoint {
  level: 1 | 2 | 3;
  direction: "buy" | "sell";
  price: number;
  time: number;
  bi_idx: number;
  description: string;
  strength: "strong" | "medium" | "weak";
  divergence_confirmed: boolean;
  after_zhongshu_break: boolean;
  trend_continuation: boolean;
}

/** 高勝率策略：SMC 三部曲設置精簡摘要 */
export interface HwrSmcSetupSummary {
  id: string;
  direction: "bullish" | "bearish";
  sweep_type: "BSL" | "SSL";
  swept_level: number;
  entry_top: number;
  entry_bottom: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr_ratio: number;
  confluence_score: number;
  htf_aligned: boolean;
  /** 與 SmcConfirmationSetup 保持一致，含 invalidated 狀態 */
  status: "waiting" | "active" | "invalidated" | "completed";
  formed_at: number;
  /** R6-FIX: 加入 invalidated 屬性，與 SmcConfirmationSetup 一致 */
  invalidated?: boolean;
  /** v5.5 新增：進場區中點距市價距離百分比（正數 = 需等待回踩；負數 = 已超過） */
  dist_pct?: number;
  /** v5.5 新增：進場區距市價是否過遠（超過 2%） */
  is_too_far?: boolean;
}

/** 高勝率策略：交易模型 */
export interface HwrTradeModel {
  id: string;
  name: string;
  description: string;
  direction: "long" | "short" | "neutral";
  confidence: number;
  confluence_score: number;
  entry_conditions: string[];
  stop_loss_hint: string;
  take_profit_hint: string;
  key_levels: HwrKeyLevel[];
  smc_score: number;
  pa_score: number;
  fib_score: number;
  chan_score: number;
  timeframe_consensus: string;
  risk_warning: string;
  is_active: boolean;
  rr_ratio: number;
  chan_buy_sell_points: HwrChanBuySellPoint[];
  smc_setups: HwrSmcSetupSummary[];
  divergences: string[];
  /** v3 新增：ADX 動態止損 ATR 乘數 */
  sl_atr_multiplier: number;
  /** v3.1 新增：Fractional Kelly 建議倉位（0-1，代表帳戶百分比） */
  kelly_fraction?: number;
}

/** 高勝率策略：單一時間框架分析結果 */
export interface HwrTfAnalysis {
  bar: string;
  label: string;
  close: number;
  atr: number;
  adx: number;
  smc_structure: string;
  smc_bos_choch: string;
  smc_premium_discount: string;
  smc_score: number;
  pa_bullish_patterns: string[];
  pa_bearish_patterns: string[];
  pa_trend: string;
  pa_rsi: number;
  pa_adx: number;
  pa_score: number;
  fib_score: number;
  fib_in_ote: boolean;
  fib_618: number;
  fib_786: number;
  fib_ext_1272: number;
  fib_ext_1618: number;
  chan_trend: string;
  chan_in_zhongshu: boolean;
  chan_zhongshu_top: number;
  chan_zhongshu_bottom: number;
  chan_zhongshu_zg: number;
  chan_zhongshu_zd: number;
  chan_zhongshu_gg: number;
  chan_zhongshu_dd: number;
  chan_divergence: string | null;
  chan_bi_count: number;
  chan_duan_count: number;
  chan_score: number;
  chan_buy_sell_points: HwrChanBuySellPoint[];
  chan_macd_area_ratio: number;
  divergences: string[];
  smc_setups: HwrSmcSetupSummary[];
  nearest_bull_ob: { top: number; bottom: number; mid: number; strength: "strong" | "normal" } | null;
  nearest_bear_ob: { top: number; bottom: number; mid: number; strength: "strong" | "normal" } | null;
  nearest_bull_fvg: { top: number; bottom: number; mid: number } | null;
  nearest_bear_fvg: { top: number; bottom: number; mid: number } | null;
  liquidity_sweep: { bslSwept: boolean; sslSwept: boolean; bslPrice: number; sslPrice: number };
  total_score: number;
  direction: "long" | "short" | "neutral";
}

/** AI 交易審核決策（Trade Veto Layer v3.5）*/
export interface TradeVetoDecision {
  decision: "TRADE" | "WAIT" | "REJECT";
  model: "A" | "B" | "C" | "NONE";
  setup_quality: 1 | 2 | 3 | 4 | 5;
  primary_edge: string;
  primary_failure_mode: string;
  must_see_trigger: string;
  invalidation: string;
  conflict_note: string;
  confidence: number;
  reason_codes: string[];
  dynamic_features_summary: string;
}

/** v4.0 新增：AI 環境掃描結果（第一層） */
export interface AiEnvScan {
  regime: string;               // 市場環境判斷（趨勢/震盪/轉折）
  macro_note: string;           // 宏觀與情緒說明
  session_bias: string;         // 時段偏向（多/空/觀望）
  key_risk: string;             // 此時最大風險
  trade_filter: "proceed" | "caution" | "avoid"; // 是否適合交易
  filter_reason: string;        // 過濾原因
}

/** v4.0 新增：單一最終策略（由三層合併產生） */
export interface FinalStrategy {
  model_id: "A" | "B" | "C";    // 被選中的模型
  model_name: string;           // 模型名稱
  decision: "TRADE" | "WAIT" | "REJECT"; // 最終決策
  direction: "long" | "short" | "neutral";
  confidence: number;           // 0-100
  setup_quality: 1 | 2 | 3 | 4 | 5;
  entry_zone: string;           // 進場區間（文字描述）
  /** v5.5 新增：數字型進場區間下沿（0 = 無資料） */
  entry_zone_low?: number;
  /** v5.5 新增：數字型進場區間上沿（0 = 無資料） */
  entry_zone_high?: number;
  /** v5.5 新增：進場區中點距市價距離百分比（正數 = 需等待回踩；負數 = 已超過） */
  dist_to_entry_pct?: number;
  /** v5.5 新增：進場區距市價是否過遠（超過 2 ATR 或 2%） */
  entry_too_far?: boolean;
  /** v5.6 新增：方向感知進場狀態（WAIT_PULLBACK=等待回踩/WAIT_BOUNCE=等待反彈/IN_ZONE=在進場區內/MISSED=已错過） */
  entry_state?: "WAIT_PULLBACK" | "WAIT_BOUNCE" | "IN_ZONE" | "MISSED";
  stop_loss: string;            // 止損
  take_profit: string;          // 止盈
  rr_ratio: number;             // 盈號比
  kelly_fraction: number;       // 建議倉位
  must_see_trigger: string;     // 進場必須觸發條件
  invalidation: string;         // 失效條件
  primary_edge: string;         // 核心優勢
  primary_failure_mode: string; // 主要風險
  reason_codes: string[];       // 審核標籤
  env_filter: string;           // 環境掃描結論
  /** v5.4 新增：集成評估負面因素（風險警示，無論最終決策為何都顯示） */
  negative_factors?: string[];
  /** v5.4 新增：市場環境各 regime 競爭分數 */
  regime_scores?: Partial<Record<string, number>>;
  /** v5.4 新增：集成評估各評估器分數 */
  ensemble_scores?: {
    rule_engine: number;
    quant_scorer: number;
    ai_confidence: number;
    consensus_strength: number;
  };
}

/** 高勝率策略：完整揃描結果 */
export interface HwrScanResult {
  models: HwrTradeModel[];
  tf_analyses: HwrTfAnalysis[];
  overall_direction: "long" | "short" | "neutral";
  mtf_consensus: string;
  ai_analysis: string;
  /** v3.5 新增：AI 交易審核決策 */
  trade_decision?: TradeVetoDecision;
  /** v4.0 新增：AI 環境掃描（第一層） */
  env_scan?: AiEnvScan;
  /** v4.0 新增：單一最終策略 */
  final_strategy?: FinalStrategy;
  scanned_at: number;
  /** v3.1 新增：Session 時段資訊 */
  session_info?: {
    name: string;
    liquidity: string;
    utc_hour: number;
    is_low_liquidity: boolean;
  };
}

export const SUPPORTED_SYMBOLS = [
  { value: "BTCUSDT",  label: "BTC/USDT",  icon: "₿" },
  { value: "ETHUSDT",  label: "ETH/USDT",  icon: "Ξ" },
  { value: "BNBUSDT",  label: "BNB/USDT",  icon: "B" },
  { value: "SOLUSDT",  label: "SOL/USDT",  icon: "◎" },
  { value: "XRPUSDT",  label: "XRP/USDT",  icon: "✕" },
  { value: "DOGEUSDT", label: "DOGE/USDT", icon: "Ð" },
  { value: "ADAUSDT",  label: "ADA/USDT",  icon: "₳" },
  { value: "TRXUSDT",  label: "TRX/USDT",  icon: "T" },
  { value: "AVAXUSDT", label: "AVAX/USDT", icon: "A" },
  { value: "LINKUSDT", label: "LINK/USDT", icon: "⬡" },
  { value: "DOTUSDT",  label: "DOT/USDT",  icon: "●" },
  { value: "SUIUSDT",  label: "SUI/USDT",  icon: "S" },
  { value: "NEARUSDT", label: "NEAR/USDT", icon: "N" },
  { value: "WLDUSDT",  label: "WLD/USDT",  icon: "W" },
  { value: "AAVEUSDT", label: "AAVE/USDT", icon: "A" },
  { value: "ENAUSDT",  label: "ENA/USDT",  icon: "E" },
  { value: "ZECUSDT",  label: "ZEC/USDT",  icon: "Z" },
  { value: "UNIUSDT",  label: "UNI/USDT",  icon: "🦄" },
  { value: "LTCUSDT",  label: "LTC/USDT",  icon: "Ł" },
  { value: "ATOMUSDT", label: "ATOM/USDT", icon: "⚛" },
];

export const DEFAULT_WIDGET_IDS = [
  "kline_chart",
  "technical_indicators",
  "smc_structure",
  "pa_analysis",
  "chan_analysis",
  "strategy_panel",
  "forecast_panel",
  "consensus_score",
  "onchain_funding",
  "onchain_ls_ratio",
  "onchain_fear_greed",
  "onchain_open_interest",
  "news_panel",
];

export const ALL_WIDGET_DEFINITIONS = [
  { id: "kline_chart", name: "K 線圖", category: "chart", desc: "多時間框架 K 線圖" },
  { id: "technical_indicators", name: "技術指標", category: "indicator", desc: "RSI / MACD / ADX / ATR / 布林帶 / VWAP" },
  { id: "smc_structure", name: "SMC 結構", category: "analysis", desc: "FVG / Order Block / BOS / CHoCH" },
  { id: "pa_analysis", name: "PA 分析", category: "analysis", desc: "K 線形態 + 多時間框架趨勢" },
  { id: "chan_analysis", name: "纏論分析", category: "analysis", desc: "筆 / 段 / 中樞識別" },
  { id: "strategy_panel", name: "策略建議", category: "strategy", desc: "ATR 計算止損止盈" },
  { id: "forecast_panel", name: "預測情境", category: "strategy", desc: "主要/備選情境預測" },
  { id: "consensus_score", name: "共識評分", category: "summary", desc: "多維度綜合評分" },
  { id: "onchain_funding", name: "資金費率", category: "onchain", desc: "永續合約資金費率" },
  { id: "onchain_ls_ratio", name: "多空比", category: "onchain", desc: "多空持倉比例" },
  { id: "onchain_fear_greed", name: "恐懼貪婪指數", category: "onchain", desc: "市場情緒指標" },
  { id: "onchain_open_interest", name: "未平倉量", category: "onchain", desc: "期貨未平倉合約量" },
  { id: "onchain_market_cap", name: "市值數據", category: "onchain", desc: "市值 / 24H 成交量" },
  { id: "onchain_price_change", name: "價格變化", category: "onchain", desc: "24H / 7D 漲跌幅" },
  { id: "news_panel", name: "最新資訊", category: "news", desc: "RSS 新聞 + 情緒分析" },
  { id: "rsi_gauge", name: "RSI 儀表", category: "indicator", desc: "RSI 視覺化儀表盤" },
  { id: "macd_chart", name: "MACD 圖表", category: "indicator", desc: "MACD 柱狀圖" },
  { id: "bollinger_info", name: "布林帶資訊", category: "indicator", desc: "布林帶寬度和位置" },
  { id: "ema_levels", name: "EMA 水平", category: "indicator", desc: "EMA 20/50/200 水平" },
  { id: "support_resistance", name: "支撐阻力", category: "analysis", desc: "關鍵支撐阻力位" },
  { id: "volume_profile", name: "成交量分析", category: "chart", desc: "成交量趨勢分析" },
  { id: "mtf_summary", name: "多時間框架摘要", category: "summary", desc: "各時間框架趨勢一覽" },
  { id: "backtest_panel", name: "回測分析", category: "strategy", desc: "5 種策略回測效果、資金曲線、交易記錄" },
];
