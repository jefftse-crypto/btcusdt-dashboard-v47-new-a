import { z } from "zod";

// ── Candle ────────────────────────────────────────────────────────────────────
export const CandleSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});
export const CandleArraySchema = z.array(CandleSchema);
export type Candle = z.infer<typeof CandleSchema>;

// ── AnalysisStatus ────────────────────────────────────────────────────────────
export const AnalysisStatusSchema = z.object({
  symbol: z.string(),
  running: z.boolean(),
  success: z.boolean().optional(),
  error: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
});
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

// ── NewsItem ──────────────────────────────────────────────────────────────────
export const NewsItemSchema = z.object({
  title: z.string(),
  link: z.string(),
  description: z.string(),
  pubDate: z.number(),
  source: z.string(),
  sentiment: z.enum(["bullish", "bearish", "neutral"]),
});
export const NewsArraySchema = z.array(NewsItemSchema);
export type NewsItem = z.infer<typeof NewsItemSchema>;

// ── TweetItem ───────────────────────────────────────────────────────────────
export const TweetItemSchema = z.object({
  id: z.string(),
  author: z.string(),
  handle: z.string(),
  avatar: z.string().optional(),
  content: z.string(),
  pubDate: z.number(),
  likes: z.number().default(0),
  retweets: z.number().default(0),
  sentiment: z.enum(["bullish", "bearish", "neutral"]),
  isAI: z.boolean().default(true),
});
export const TweetArraySchema = z.array(TweetItemSchema);
export type TweetItem = z.infer<typeof TweetItemSchema>;

// ── SnapshotSummary ───────────────────────────────────────────────────────────
export const SnapshotSummarySchema = z.object({
  symbol: z.string(),
  generated_at: z.string(),
  live_price: z.number().optional(),
  consensus: z.object({
    score: z.number().optional(),
    label: z.string().optional(),
  }).optional(),
});
export type SnapshotSummary = z.infer<typeof SnapshotSummarySchema>;

// ── Snapshot (loose) ──────────────────────────────────────────────────────────
export const SnapshotSchema = z.object({
  symbol: z.string(),
  generated_at: z.string(),
  live_price: z.number().optional(),
  error: z.string().nullable().optional(),
  klines: z.record(z.string(), z.array(CandleSchema)).optional(),
}).passthrough();
export type Snapshot = z.infer<typeof SnapshotSchema>;

// ── WidgetPrefs ───────────────────────────────────────────────────────────────
export const WidgetPrefsSchema = z.object({
  openId: z.string().min(1),
  widgetIds: z.array(z.string().min(1)).max(50),
});
export type WidgetPrefs = z.infer<typeof WidgetPrefsSchema>;

// ── Safe parse helpers ────────────────────────────────────────────────────────
export function safeParseSnapshot(raw: unknown): { data: Snapshot; error: null } | { data: null; error: string } {
  const r = SnapshotSchema.safeParse(raw);
  if (r.success) return { data: r.data, error: null };
  return { data: null, error: r.error.message };
}

export function safeParseCandles(raw: unknown): { data: Candle[]; error: null } | { data: null; error: string } {
  const r = CandleArraySchema.safeParse(raw);
  if (r.success) return { data: r.data, error: null };
  return { data: null, error: r.error.message };
}

export function safeParseNews(raw: unknown): { data: NewsItem[]; error: null } | { data: null; error: string } {
  const r = NewsArraySchema.safeParse(raw);
  if (r.success) return { data: r.data, error: null };
  return { data: null, error: r.error.message };
}

export function safeParseTweets(raw: unknown): { data: TweetItem[]; error: null } | { data: null; error: string } {
  const r = TweetArraySchema.safeParse(raw);
  if (r.success) return { data: r.data, error: null };
  return { data: null, error: r.error.message };
}

// ─────────────────────────────────────────────────────────────────────────────
// High Win Rate Strategy Schemas (v3.0)
// ─────────────────────────────────────────────────────────────────────────────

export const HwrKeyLevelSchema = z.object({
  label: z.string(),
  price: z.number(),
  type: z.string(),
});

export const HwrChanBuySellPointSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  direction: z.enum(["buy", "sell"]),
  price: z.number(),
  time: z.number(),
  bi_idx: z.number(),
  description: z.string(),
  strength: z.enum(["strong", "medium", "weak"]),
  divergence_confirmed: z.boolean(),
  after_zhongshu_break: z.boolean(),
  trend_continuation: z.boolean(),
});

export const HwrSmcSetupSummarySchema = z.object({
  id: z.string(),
  direction: z.enum(["bullish", "bearish"]),
  sweep_type: z.enum(["BSL", "SSL"]),
  swept_level: z.number(),
  entry_top: z.number(),
  entry_bottom: z.number(),
  sl: z.number(),
  tp1: z.number(),
  tp2: z.number(),
  rr_ratio: z.number(),
  confluence_score: z.number(),
  htf_aligned: z.boolean(),
  status: z.enum(["waiting", "active", "invalidated", "completed"]),
  formed_at: z.number(),
});

export const HwrTradeModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  direction: z.enum(["long", "short", "neutral"]),
  confidence: z.number().min(0).max(100),
  confluence_score: z.number().min(0).max(100),
  entry_conditions: z.array(z.string()),
  stop_loss_hint: z.string(),
  take_profit_hint: z.string(),
  key_levels: z.array(HwrKeyLevelSchema),
  smc_score: z.number(),
  pa_score: z.number(),
  fib_score: z.number(),
  chan_score: z.number(),
  timeframe_consensus: z.string(),
  risk_warning: z.string(),
  is_active: z.boolean(),
  rr_ratio: z.number(),
  chan_buy_sell_points: z.array(HwrChanBuySellPointSchema),
  smc_setups: z.array(HwrSmcSetupSummarySchema),
  divergences: z.array(z.string()),
  sl_atr_multiplier: z.number(),
  /** v3.1 新增：Fractional Kelly 建議倉位 */
  kelly_fraction: z.number().optional(),
});

export const HwrTfAnalysisSchema = z.object({
  bar: z.string(),
  label: z.string(),
  close: z.number(),
  atr: z.number(),
  adx: z.number(),
  smc_structure: z.string(),
  smc_bos_choch: z.string(),
  smc_premium_discount: z.string(),
  smc_score: z.number(),
  pa_bullish_patterns: z.array(z.string()),
  pa_bearish_patterns: z.array(z.string()),
  pa_trend: z.string(),
  pa_rsi: z.number(),
  pa_adx: z.number(),
  pa_score: z.number(),
  fib_score: z.number(),
  fib_in_ote: z.boolean(),
  fib_618: z.number(),
  fib_786: z.number(),
  fib_ext_1272: z.number(),
  fib_ext_1618: z.number(),
  chan_trend: z.string(),
  chan_in_zhongshu: z.boolean(),
  chan_zhongshu_top: z.number(),
  chan_zhongshu_bottom: z.number(),
  chan_divergence: z.string().nullable(),
  chan_bi_count: z.number(),
  chan_duan_count: z.number(),
  chan_score: z.number(),
  chan_buy_sell_points: z.array(HwrChanBuySellPointSchema),
  chan_macd_area_ratio: z.number(),
  divergences: z.array(z.string()),
  smc_setups: z.array(HwrSmcSetupSummarySchema),
  nearest_bull_ob: z.object({
    top: z.number(), bottom: z.number(), mid: z.number(),
    strength: z.enum(["strong", "normal"]),
  }).nullable(),
  nearest_bear_ob: z.object({
    top: z.number(), bottom: z.number(), mid: z.number(),
    strength: z.enum(["strong", "normal"]),
  }).nullable(),
  nearest_bull_fvg: z.object({ top: z.number(), bottom: z.number(), mid: z.number() }).nullable(),
  nearest_bear_fvg: z.object({ top: z.number(), bottom: z.number(), mid: z.number() }).nullable(),
  liquidity_sweep: z.object({
    bslSwept: z.boolean(), sslSwept: z.boolean(),
    bslPrice: z.number(), sslPrice: z.number(),
  }),
  total_score: z.number(),
  direction: z.enum(["long", "short", "neutral"]),
});

export const TradeVetoDecisionSchema = z.object({
  decision: z.enum(["TRADE", "WAIT", "REJECT"]),
  model: z.enum(["A", "B", "C", "NONE"]),
  setup_quality: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  primary_edge: z.string(),
  primary_failure_mode: z.string(),
  must_see_trigger: z.string(),
  invalidation: z.string(),
  conflict_note: z.string(),
  confidence: z.number().min(0).max(100),
  reason_codes: z.array(z.string()),
  dynamic_features_summary: z.string(),
});

export const AiEnvScanSchema = z.object({
  regime: z.string(),
  macro_note: z.string(),
  session_bias: z.string(),
  key_risk: z.string(),
  trade_filter: z.enum(["proceed", "caution", "avoid"]),
  filter_reason: z.string(),
});

export const FinalStrategySchema = z.object({
  model_id: z.enum(["A", "B", "C"]),
  model_name: z.string(),
  decision: z.enum(["TRADE", "WAIT", "REJECT"]),
  direction: z.enum(["long", "short", "neutral"]),
  confidence: z.number().min(0).max(100),
  setup_quality: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  entry_zone: z.string(),
  stop_loss: z.string(),
  take_profit: z.string(),
  rr_ratio: z.number(),
  kelly_fraction: z.number(),
  must_see_trigger: z.string(),
  invalidation: z.string(),
  primary_edge: z.string(),
  primary_failure_mode: z.string(),
  reason_codes: z.array(z.string()),
  env_filter: z.string(),
});

export const HwrScanResultSchema = z.object({
  models: z.array(HwrTradeModelSchema),
  tf_analyses: z.array(HwrTfAnalysisSchema),
  overall_direction: z.enum(["long", "short", "neutral"]),
  mtf_consensus: z.string(),
  ai_analysis: z.string(),
  /** v3.5 新增：AI 交易審核決策 */
  trade_decision: TradeVetoDecisionSchema.optional(),
  /** v4.0 新增：AI 環境掃描 */
  env_scan: AiEnvScanSchema.optional(),
  /** v4.0 新增：單一最終策略 */
  final_strategy: FinalStrategySchema.optional(),
  scanned_at: z.number(),
  /** v3.1 新增：Session 時段資訊 */
  session_info: z.object({
    name: z.string(),
    liquidity: z.string(),
    utc_hour: z.number(),
    is_low_liquidity: z.boolean(),
  }).optional(),
});

export type HwrScanResultParsed = z.infer<typeof HwrScanResultSchema>;

/** 執行期安全解析 HighWinRate 掃描結果 */
export function safeParseHwrScanResult(
  raw: unknown
): { data: HwrScanResultParsed; error: null } | { data: null; error: string } {
  const r = HwrScanResultSchema.safeParse(raw);
  if (r.success) return { data: r.data, error: null };
  // 記錄詳細錯誤資訊（供开發調試用）
  const issues = r.error.issues.slice(0, 3).map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { data: null, error: `HwrScanResult 驗證失敗: ${issues}` };
}
