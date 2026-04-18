/**
 * HighWinRatePanel.tsx v2.0
 * 高勝率策略面板 — 全面改良版
 * 新增：盈虧比、纏論買賣點、SMC 三部曲設置、ATR 動態過濾、RSI/MACD 背離
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Trophy, TrendingUp, TrendingDown, Minus, RefreshCw,
  ChevronDown, ChevronUp, AlertTriangle, Zap, Target,
  Activity, Layers, GitBranch, BarChart2, Shield, Crosshair,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// 型別定義（v2.0 — 與後端 highWinRateService.ts 回傳格式一致）
// ─────────────────────────────────────────────────────────────────────────────
interface KeyLevel {
  label: string;
  price: number;
  type:  string;
}

interface ChanBuySellPoint {
  level: 1 | 2 | 3;
  direction: "buy" | "sell";
  price: number;
  description: string;
  strength: string;
  divergence_confirmed: boolean;
}

interface SmcSetupSummary {
  id: string;
  direction: "bullish" | "bearish";
  sweep_type: string;
  swept_level: number;
  entry_top: number;
  entry_bottom: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr_ratio: number;
  confluence_score: number;
  htf_aligned: boolean;
  status: string;
  // v5.5 新增：進場區距市價距離
  dist_pct?: number;
  is_too_far?: boolean;
}

interface TradeModel {
  id:                  string;
  name:                string;
  description:         string;
  direction:           "long" | "short" | "neutral";
  confidence:          number;
  confluence_score:    number;
  entry_conditions:    string[];
  stop_loss_hint:      string;
  take_profit_hint:    string;
  key_levels:          KeyLevel[];
  smc_score:           number;
  pa_score:            number;
  fib_score:           number;
  chan_score:          number;
  timeframe_consensus: string;
  risk_warning:        string;
  is_active:           boolean;
  // v2 新增
  rr_ratio:            number;
  chan_buy_sell_points: ChanBuySellPoint[];
  smc_setups:          SmcSetupSummary[];
  divergences:         string[];
}

interface TfAnalysis {
  bar:                     string;
  label:                   string;
  close:                   number;
  atr:                     number;
  smc_structure:           string;
  smc_bos_choch:           string;
  smc_premium_discount:    string;
  smc_score:               number;
  pa_bullish_patterns:     string[];
  pa_bearish_patterns:     string[];
  pa_trend:                string;
  pa_rsi:                  number;
  pa_adx:                  number;
  pa_score:                number;
  fib_score:               number;
  fib_in_ote:              boolean;
  chan_trend:               string;
  chan_in_zhongshu:        boolean;
  chan_zhongshu_top:       number;
  chan_zhongshu_bottom:    number;
  chan_divergence:         string | null;
  chan_bi_count:           number;
  chan_duan_count:         number;
  chan_score:              number;
  chan_buy_sell_points:    ChanBuySellPoint[];
  chan_macd_area_ratio:    number;
  divergences:             string[];
  smc_setups:              SmcSetupSummary[];
  total_score:             number;
  direction:               "long" | "short" | "neutral";
}

interface TradeVetoDecision {
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

interface AiEnvScan {
  regime: string;
  macro_note: string;
  session_bias: string;
  key_risk: string;
  trade_filter: "proceed" | "caution" | "avoid";
  filter_reason: string;
}

interface FinalStrategy {
  model_id: "A" | "B" | "C";
  model_name: string;
  decision: "TRADE" | "WAIT" | "REJECT";
  direction: "long" | "short" | "neutral";
  confidence: number;
  setup_quality: 1 | 2 | 3 | 4 | 5;
  entry_zone: string;
  // v5.5 新增：數字型進場區間和距市價距離
  entry_zone_low?: number;
  entry_zone_high?: number;
  dist_to_entry_pct?: number;
  entry_too_far?: boolean;
  stop_loss: string;
  take_profit: string;
  rr_ratio: number;
  kelly_fraction: number;
  must_see_trigger: string;
  invalidation: string;
  primary_edge: string;
  primary_failure_mode: string;
  reason_codes: string[];
  env_filter: string;
  // v5.4 新增
  negative_factors?: string[];
  regime_scores?: Record<string, number>;
  ensemble_scores?: {
    rule_engine: number;
    quant_scorer: number;
    ai_confidence: number;
    consensus_strength: number;
  };
}

interface ScanResult {
  models:            TradeModel[];
  tf_analyses:       TfAnalysis[];
  overall_direction: string;
  mtf_consensus:     string;
  ai_analysis:       string;
  trade_decision?:   TradeVetoDecision;
  env_scan?:         AiEnvScan;
  final_strategy?:   FinalStrategy;
  scanned_at:        number;
}

interface Props {
  symbol: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具函數
// ─────────────────────────────────────────────────────────────────────────────
function getConfidenceColor(v: number): string {
  if (v >= 75) return "text-emerald-400";
  if (v >= 60) return "text-green-400";
  if (v >= 45) return "text-yellow-400";
  return "text-gray-400";
}

function getConfidenceBg(v: number): string {
  if (v >= 75) return "bg-emerald-500/20 border-emerald-500/40";
  if (v >= 60) return "bg-green-500/20 border-green-500/40";
  if (v >= 45) return "bg-yellow-500/20 border-yellow-500/40";
  return "bg-gray-500/20 border-gray-500/40";
}

function getScoreBar(score: number) {
  const pct = Math.round(score);
  const color = score >= 65 ? "bg-emerald-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}</span>
    </div>
  );
}

function getDirLabel(dir: string) {
  if (dir === "long")  return <span className="text-emerald-400 font-bold">做多 ↑</span>;
  if (dir === "short") return <span className="text-red-400 font-bold">做空 ↓</span>;
  return <span className="text-gray-400">中性</span>;
}

function getTrendLabel(trend: string) {
  if (trend === "bullish") return <span className="text-emerald-400">上升趨勢 ↑</span>;
  if (trend === "bearish") return <span className="text-red-400">下降趨勢 ↓</span>;
  return <span className="text-yellow-400">震盪 ↔</span>;
}

function getModelIcon(id: string) {
  if (id === "liquidity_reversal") return <Zap className="w-5 h-5 text-yellow-400" />;
  if (id === "trend_pullback")     return <TrendingUp className="w-5 h-5 text-emerald-400" />;
  return <Layers className="w-5 h-5 text-purple-400" />;
}

function getRrColor(rr: number): string {
  if (rr >= 2.5) return "text-emerald-400";
  if (rr >= 1.5) return "text-yellow-400";
  return "text-gray-400";
}

function getChanLevelColor(level: 1 | 2 | 3): string {
  if (level === 1) return "bg-emerald-500/20 border-emerald-500/40 text-emerald-300";
  if (level === 2) return "bg-blue-500/20 border-blue-500/40 text-blue-300";
  return "bg-purple-500/20 border-purple-500/40 text-purple-300";
}

function getSmcStatusColor(status: string): string {
  if (status === "active") return "text-emerald-400";
  if (status === "waiting") return "text-yellow-400";
  return "text-gray-400";
}

function formatAiText(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const isH2 = /^##\s/.test(line) || /^【/.test(line.trim());
    const isH3 = /^###\s/.test(line) || /^\*\*[^*]+\*\*$/.test(line.trim());
    const isBullet = /^[-•*]\s/.test(line.trim());
    const isNum = /^\d+\.\s/.test(line.trim());
    if (isH2) return <div key={i} className="mt-4 mb-1 text-[#f0b90b] font-semibold text-sm border-b border-[#f0b90b]/20 pb-1">{line.replace(/^#+\s/, "").replace(/[【】]/g, "")}</div>;
    if (isH3) return <div key={i} className="mt-3 mb-0.5 text-white font-medium text-sm">{line.replace(/\*\*/g, "").replace(/^#+\s/, "")}</div>;
    if (isBullet || isNum) return <div key={i} className="pl-3 text-gray-300 text-xs leading-relaxed">{line}</div>;
    if (line.trim() === "") return <div key={i} className="h-1" />;
    return <div key={i} className="text-gray-300 text-xs leading-relaxed">{line}</div>;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 子元件：纏論買賣點卡片
// ─────────────────────────────────────────────────────────────────────────────
function ChanBuySellPoints({ points }: { points: ChanBuySellPoint[] }) {
  if (!points || points.length === 0) return null;
  return (
    <div>
      <p className="text-gray-400 text-xs font-medium mb-2 flex items-center gap-1">
        <Layers className="w-3 h-3 text-purple-400" />纏論買賣點（增強版）
      </p>
      <div className="space-y-1.5">
        {points.map((p, i) => (
          <div key={i} className={`rounded-lg border px-2.5 py-2 text-xs ${getChanLevelColor(p.level)}`}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-semibold">
                {p.level}類{p.direction === "buy" ? "買點" : "賣點"}
                {p.divergence_confirmed && " ★背馳確認"}
              </span>
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs ${
                  p.strength === "strong" ? "bg-emerald-500/30 text-emerald-300" :
                  p.strength === "medium" ? "bg-yellow-500/30 text-yellow-300" :
                  "bg-gray-500/30 text-gray-400"
                }`}>{p.strength === "strong" ? "強" : p.strength === "medium" ? "中" : "弱"}</span>
                <span className="text-gray-400">@ {p.price.toFixed(2)}</span>
              </div>
            </div>
            <p className="text-gray-300/80 leading-relaxed">{p.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 子元件：SMC 三部曲設置卡片
// ─────────────────────────────────────────────────────────────────────────────
function SmcSetupCards({ setups }: { setups: SmcSetupSummary[] }) {
  if (!setups || setups.length === 0) return null;
  return (
    <div>
      <p className="text-gray-400 text-xs font-medium mb-2 flex items-center gap-1">
        <Crosshair className="w-3 h-3 text-blue-400" />SMC 三部曲確認設置
      </p>
      <div className="space-y-2">
        {setups.map((s) => (
          <div key={s.id} className={`rounded-lg border p-2.5 text-xs ${
            s.direction === "bullish"
              ? "bg-emerald-500/10 border-emerald-500/30"
              : "bg-red-500/10 border-red-500/30"
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className={`font-semibold ${s.direction === "bullish" ? "text-emerald-400" : "text-red-400"}`}>
                {s.direction === "bullish" ? "▲ 看多" : "▼ 看空"} — {s.sweep_type} 掃蕩
              </span>
              <div className="flex items-center gap-2">
                <span className={`font-bold ${getRrColor(s.rr_ratio)}`}>RR {s.rr_ratio.toFixed(1)}x</span>
                <span className={`px-1.5 py-0.5 rounded border text-xs ${
                  s.status === "active" ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300" :
                  s.status === "waiting" ? "bg-yellow-500/20 border-yellow-500/30 text-yellow-300" :
                  "bg-gray-500/20 border-gray-500/30 text-gray-400"
                }`}>
                  {s.status === "active" ? "啟動" : s.status === "waiting" ? "等待" : "完成"}
                </span>
                {s.htf_aligned && <span className="text-emerald-400 text-xs">HTF✓</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-gray-300">
              <div>揃蛙位：<span className="text-white">{s.swept_level.toFixed(2)}</span></div>
              <div className="flex items-center gap-1">
                進場區：<span className="text-white">{s.entry_bottom.toFixed(2)}–{s.entry_top.toFixed(2)}</span>
                {s.dist_pct !== undefined && (
                  <span className={`ml-1 text-[10px] px-1 py-0.5 rounded font-medium ${
                    s.is_too_far
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                      : Math.abs(s.dist_pct) <= 0.5
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                  }`}>
                    {s.dist_pct > 0 ? '↓' : '↑'}{Math.abs(s.dist_pct).toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="text-red-300">止損：{s.sl.toFixed(2)}</div>
              <div className="text-emerald-300">TP1：{s.tp1.toFixed(2)}</div>
              <div>評分：<span className={`font-bold ${s.confluence_score >= 70 ? "text-emerald-400" : "text-yellow-400"}`}>{s.confluence_score}</span></div>
              <div className="text-emerald-300">TP2：{s.tp2.toFixed(2)}</div>
            </div>
            {s.is_too_far && (
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-orange-300 bg-orange-500/10 border border-orange-500/20 rounded px-2 py-1">
                <span>⚠️</span>
                <span>進場區距市價過遠（{Math.abs(s.dist_pct ?? 0).toFixed(2)}%），建議等待回踩後再進場</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 主元件
// ─────────────────────────────────────────────────────────────────────────────
export default function HighWinRatePanel({ symbol }: Props) {
  const [result, setResult]           = useState<ScanResult | null>(null);
  const [expandedModel, setExpanded]  = useState<string | null>(null);
  const [showTfDetail, setShowTf]     = useState(false);
  const [showAI, setShowAI]           = useState(true);
  const [engine, setEngine]           = useState<"local" | "opus" | "codex">("local");

  const scanMutation = trpc.highWinRate.scan.useMutation({
    onSuccess: (data) => setResult(data as unknown as ScanResult),
  });

  const handleScan = () => scanMutation.mutate({ symbol, engine });
  const toggleModel = (id: string) => setExpanded(prev => prev === id ? null : id);

  return (
    <div className="space-y-4 p-4">
      {/* ── 標題列 ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-[#f0b90b]" />
            <h2 className="text-white font-semibold text-base">高勝率策略分析</h2>
            <span className="text-gray-400 text-sm">— {symbol.replace("USDT", "")}/USDT</span>
            <span className="px-1.5 py-0.5 rounded text-xs bg-[#f0b90b]/20 text-[#f0b90b] border border-[#f0b90b]/30">v2.0</span>
          </div>
          <button
            onClick={handleScan}
            disabled={scanMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f0b90b] text-black font-semibold text-sm hover:bg-[#f0b90b]/90 disabled:opacity-50 transition-all"
          >
            {scanMutation.isPending
              ? <><RefreshCw className="w-4 h-4 animate-spin" />分析中...</>
              : <><Zap className="w-4 h-4" />開始四維度分析</>}
          </button>
        </div>
        {/* AI 引擎選擇器 — 獨立一行完整顯示 */}
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">AI 引擎：</span>
          <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs font-medium">
            {(["local", "opus", "codex"] as const).map((e) => (
              <button
                key={e}
                onClick={() => setEngine(e)}
                disabled={scanMutation.isPending}
                className={`px-3 py-1.5 transition-all ${
                  engine === e
                    ? e === "local"
                      ? "bg-emerald-500/30 text-emerald-300"
                      : e === "opus"
                      ? "bg-blue-500/30 text-blue-300"
                      : "bg-purple-500/30 text-purple-300"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                } border-r border-white/10 last:border-r-0`}
              >
                {e === "local" ? "⚡ Local（本地）" : e === "opus" ? "💡 Gemini 2.5 Flash" : "🧠 GPT Codex"}
              </button>
            ))}
          </div>
          <span className="text-gray-600 text-xs">
            {engine === "local" ? "— 完全本地運算，不依賴外部 API" : engine === "opus" ? "— Google 最新模型，支持深度推理" : "— Soxio API 備用分析"}
          </span>
        </div>
      </div>

      {/* ── 說明卡片（未掃描時） ── */}
      {!result && !scanMutation.isPending && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
          <div className="text-center">
            <Trophy className="w-12 h-12 text-[#f0b90b]/60 mx-auto mb-3" />
            <p className="text-gray-300 text-sm">
              點擊「開始四維度分析」，系統將從 <span className="text-[#f0b90b] font-semibold">15m / 1H / 4H / 日線</span> 四個時間框架，
              以 <span className="text-white font-semibold">SMC + PA + 斐波那契 + 纏論</span> 四大維度進行共振評分，
              並生成三個具體交易模型。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-white/5 p-3 space-y-1.5">
              <p className="text-gray-400 text-xs font-medium">v2.0 改良重點</p>
              <div className="space-y-1 text-xs text-gray-300">
                <div className="flex items-center gap-1.5"><Activity className="w-3 h-3 text-blue-400" />SMC 三部曲確認（掃蕩→FVG→OB）</div>
                <div className="flex items-center gap-1.5"><BarChart2 className="w-3 h-3 text-green-400" />PA 關鍵水位共振過濾</div>
                <div className="flex items-center gap-1.5"><GitBranch className="w-3 h-3 text-yellow-400" />ATR 動態過濾有效結構</div>
                <div className="flex items-center gap-1.5"><Layers className="w-3 h-3 text-purple-400" />增強版纏論（MACD面積背馳）</div>
              </div>
            </div>
            <div className="rounded-lg bg-white/5 p-3 space-y-1.5">
              <p className="text-gray-400 text-xs font-medium">三個交易模型</p>
              <div className="space-y-1 text-xs text-gray-300">
                <div className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-yellow-400" />模型 A：掃流動性反轉（SMC三部曲）</div>
                <div className="flex items-center gap-1.5"><TrendingUp className="w-3 h-3 text-emerald-400" />模型 B：趨勢回踩延續（纏論線段）</div>
                <div className="flex items-center gap-1.5"><Layers className="w-3 h-3 text-purple-400" />模型 C：中樞邊界反應（ATR動態）</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 載入中 ── */}
      {scanMutation.isPending && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center space-y-3">
          <RefreshCw className="w-10 h-10 text-[#f0b90b] animate-spin mx-auto" />
          <p className="text-white font-medium">正在進行四維度多時段分析（v2.0）...</p>
          <p className="text-gray-400 text-xs">抓取 4 個時間框架 K 線 → ATR 動態過濾 → 增強版纏論 → SMC 三部曲 → AI 深度說明</p>
        </div>
      )}

      {/* ── 錯誤 ── */}
      {scanMutation.isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-red-400 font-medium text-sm">分析暫時不可用</p>
          <p className="text-red-300/70 text-xs mt-1">資料正在重新整理或節點暫時不穩定，請稍後再試。</p>
        </div>

        </div>
      )}

      {/* ── 結果 ── */}
      {result && (
        <div className="space-y-4">
          {/* 整體方向摘要 */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold text-sm">多時段共識</span>
              </div>
              <div className="flex items-center gap-2">
                {getDirLabel(result.overall_direction)}
                <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                  engine === "opus"
                    ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                    : engine === "codex"
                    ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
                    : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                }`}>
                  {engine === "opus" ? "💡 Gemini" : engine === "codex" ? "🧠 Codex" : "⚡ Local"}
                </span>
                <span className="text-gray-500 text-xs">
                  {new Date(result.scanned_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {result.tf_analyses.map(tf => (
                <div key={tf.bar} className={`rounded-lg p-2 text-center border ${
                  tf.direction === "long" ? "bg-emerald-500/10 border-emerald-500/30" :
                  tf.direction === "short" ? "bg-red-500/10 border-red-500/30" :
                  "bg-white/5 border-white/10"
                }`}>
                  <div className="text-gray-400 text-xs">{tf.label}</div>
                  <div className={`text-sm font-bold mt-0.5 ${
                    tf.direction === "long" ? "text-emerald-400" :
                    tf.direction === "short" ? "text-red-400" : "text-gray-400"
                  }`}>
                    {tf.direction === "long" ? "看多" : tf.direction === "short" ? "看空" : "中性"}
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5">{Math.round(tf.total_score)}</div>
                  {tf.atr > 0 && (
                    <div className="text-gray-600 text-xs mt-0.5">ATR {tf.atr.toFixed(1)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* v4.0 環境掃描卡片（第一層） */}
          {result.env_scan && (() => {
            const es = result.env_scan!;
            const filterColor = es.trade_filter === "proceed"
              ? "border-emerald-500/40 bg-emerald-500/8"
              : es.trade_filter === "caution"
              ? "border-yellow-500/40 bg-yellow-500/8"
              : "border-red-500/40 bg-red-500/8";
            const filterIcon = es.trade_filter === "proceed" ? "🟢" : es.trade_filter === "caution" ? "🟡" : "🔴";
            const filterText = es.trade_filter === "proceed" ? "適合交易" : es.trade_filter === "caution" ? "謹慎操作" : "建議迴避";
            return (
              <div className={`rounded-xl border ${filterColor} p-3 space-y-2`}>
                <div className="flex items-center justify-between">
                  <span className="text-white text-xs font-semibold flex items-center gap-1.5">
                    <span>{filterIcon}</span> Layer 1 — AI 環境掃描
                  </span>
                  <span className={`text-xs font-bold ${
                    es.trade_filter === "proceed" ? "text-emerald-400" : es.trade_filter === "caution" ? "text-yellow-400" : "text-red-400"
                  }`}>{filterText}</span>
                </div>
                <div className="grid grid-cols-1 gap-1 text-xs">
                  <div className="flex gap-2"><span className="text-gray-500 whitespace-nowrap">市場環境</span><span className="text-gray-200">{es.regime}</span></div>
                  <div className="flex gap-2"><span className="text-gray-500 whitespace-nowrap">宏觀情緒</span><span className="text-gray-200">{es.macro_note}</span></div>
                  <div className="flex gap-2"><span className="text-gray-500 whitespace-nowrap">時段偏向</span><span className="text-gray-200">{es.session_bias}</span></div>
                  <div className="flex gap-2"><span className="text-red-400 whitespace-nowrap">最大風險</span><span className="text-gray-200">{es.key_risk}</span></div>
                  {es.filter_reason && <div className="flex gap-2"><span className="text-gray-500 whitespace-nowrap">過濾原因</span><span className="text-gray-200">{es.filter_reason}</span></div>}
                </div>
              </div>
            );
          })()}

          {/* v4.0 單一最終策略卡片 */}
          {result.final_strategy ? (() => {
            const fs = result.final_strategy!;
            const decisionBg = fs.decision === "TRADE"
              ? "border-emerald-500/50 bg-emerald-500/10"
              : fs.decision === "WAIT"
              ? "border-yellow-500/50 bg-yellow-500/10"
              : "border-red-500/50 bg-red-500/10";
            const decisionColor = fs.decision === "TRADE" ? "text-emerald-400" : fs.decision === "WAIT" ? "text-yellow-400" : "text-red-400";
            const decisionIcon = fs.decision === "TRADE" ? "✅" : fs.decision === "WAIT" ? "⏳" : "❌";
            const dirIcon = fs.direction === "long" ? "↑" : fs.direction === "short" ? "↓" : "↔";
            const dirColor = fs.direction === "long" ? "text-emerald-400" : fs.direction === "short" ? "text-red-400" : "text-gray-400";
            const stars = "★".repeat(fs.setup_quality) + "☆".repeat(5 - fs.setup_quality);
            const kellyPct = (fs.kelly_fraction * 100).toFixed(1);
            return (
              <div className={`rounded-xl border ${decisionBg} overflow-hidden`}>
                {/* 標題列 */}
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className={`text-lg font-bold flex items-center gap-2 ${decisionColor}`}>
                        <span>{decisionIcon}</span>
                        {fs.decision}
                        <span className="text-sm font-normal text-gray-400">— {fs.model_name}（模型 {fs.model_id}）</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={`text-sm font-semibold ${dirColor}`}>{dirIcon} {fs.direction === "long" ? "做多" : fs.direction === "short" ? "做空" : "中性"}</span>
                        <span className="text-gray-400 text-xs">品質 {stars}</span>
                        <span className="text-gray-400 text-xs">RR {fs.rr_ratio.toFixed(1)}:1</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-3xl font-bold ${decisionColor}`}>{fs.confidence}%</div>
                      <div className="text-gray-500 text-xs">信心度</div>
                    </div>
                  </div>

                  {/* 進場 / 止損 / 止盈 */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className={`rounded-lg border p-2 ${
                      fs.entry_too_far
                        ? 'bg-orange-500/10 border-orange-500/30'
                        : 'bg-white/5 border-white/10'
                    }`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="text-gray-500 text-xs">進場區間</div>
                        {fs.dist_to_entry_pct !== undefined && (
                          <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                            fs.entry_too_far
                              ? 'bg-orange-500/20 text-orange-300'
                              : Math.abs(fs.dist_to_entry_pct) <= 0.5
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-yellow-500/20 text-yellow-300'
                          }`}>
                            {fs.dist_to_entry_pct > 0 ? '↓' : '↑'}{Math.abs(fs.dist_to_entry_pct).toFixed(2)}%
                          </span>
                        )}
                      </div>
                      {/* 數字型進場區間（優先顯示，確保 low-high 順序正確） */}
                      {fs.entry_zone_low && fs.entry_zone_high ? (
                        <div className="text-white text-xs font-bold leading-tight">
                          {Math.min(fs.entry_zone_low, fs.entry_zone_high).toFixed(2)}–{Math.max(fs.entry_zone_low, fs.entry_zone_high).toFixed(2)}
                        </div>
                      ) : (
                        <div className="text-white text-xs font-medium leading-tight">{fs.entry_zone || "等待觸發"}</div>
                      )}
                      {/* v5.7 FIX: 不論 entry_too_far，只要 entry_state 不是 IN_ZONE 就顯示警告 */}
                      {(fs as any).entry_state === 'WAIT_PULLBACK' && (
                        <div className="text-orange-300 text-[10px] mt-0.5">⚠️ 市價高於進場區，等待回踩</div>
                      )}
                      {(fs as any).entry_state === 'WAIT_BOUNCE' && (
                        <div className="text-orange-300 text-[10px] mt-0.5">⚠️ 市價低於進場區，等待反彈</div>
                      )}
                      {(fs as any).entry_state === 'MISSED' && (
                        <div className="text-red-400 text-[10px] mt-0.5">❌ 進場區已錯過，不建追價</div>
                      )}
                      {/* IN_ZONE：只有 decision=TRADE 才顯示「可進場」，WAIT/REJECT 顯示「等待確認」 */}
                      {(fs as any).entry_state === 'IN_ZONE' && fs.decision === 'TRADE' && (
                        <div className="text-emerald-300 text-[10px] mt-0.5">✅ 市價在進場區內，可進場</div>
                      )}
                      {(fs as any).entry_state === 'IN_ZONE' && fs.decision !== 'TRADE' && (
                        <div className="text-yellow-300 text-[10px] mt-0.5">⏳ 市價在進場區內，等待確認信號</div>
                      )}
                    </div>
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2">
                      <div className="text-red-400 text-xs mb-0.5">止損</div>
                      <div className="text-gray-200 text-xs font-medium leading-tight">{fs.stop_loss}</div>
                    </div>
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2">
                      <div className="text-emerald-400 text-xs mb-0.5">止盈</div>
                      <div className="text-gray-200 text-xs font-medium leading-tight">{fs.take_profit}</div>
                    </div>
                  </div>

                  {/* 倉位建議 */}
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-2.5 mb-3">
                    <div className="flex items-center justify-between">
                      <span className="text-blue-400 text-xs font-medium">建議倉位（Fractional Kelly）</span>
                      <span className="text-blue-300 text-sm font-bold">{kellyPct}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{width: `${Math.min(100, fs.kelly_fraction * 1000)}%`}} />
                    </div>
                  </div>

                  {/* 審核詳情 */}
                  <div className="space-y-1.5 text-xs">
                    {fs.primary_edge && (
                      <div className="flex gap-2">
                        <span className="text-emerald-400 font-medium whitespace-nowrap">核心優勢</span>
                        <span className="text-gray-300">{fs.primary_edge}</span>
                      </div>
                    )}
                    {fs.must_see_trigger && (
                      <div className="flex gap-2">
                        <span className="text-yellow-400 font-medium whitespace-nowrap">進場觸發</span>
                        <span className="text-gray-300">{fs.must_see_trigger}</span>
                      </div>
                    )}
                    {fs.primary_failure_mode && (
                      <div className="flex gap-2">
                        <span className="text-red-400 font-medium whitespace-nowrap">失敗風險</span>
                        <span className="text-gray-300">{fs.primary_failure_mode}</span>
                      </div>
                    )}
                    {fs.invalidation && (
                      <div className="flex gap-2">
                        <span className="text-orange-400 font-medium whitespace-nowrap">失效條件</span>
                        <span className="text-gray-300">{fs.invalidation}</span>
                      </div>
                    )}
                    {fs.env_filter && (
                      <div className="flex gap-2">
                        <span className="text-purple-400 font-medium whitespace-nowrap">環境掃描</span>
                        <span className="text-gray-300">{fs.env_filter}</span>
                      </div>
                    )}
                  </div>

                  {/* v5.4 風險警示：負面因素 */}
                  {fs.negative_factors && fs.negative_factors.length > 0 && (
                    <div className="mt-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20 p-2.5">
                      <div className="text-orange-400 text-xs font-medium mb-1.5">⚠️ 風險警示</div>
                      <div className="space-y-1">
                        {fs.negative_factors.map((factor, i) => (
                          <div key={i} className="text-orange-200 text-xs flex items-start gap-1.5">
                            <span className="text-orange-400 mt-0.5">&#x2022;</span>
                            <span>{factor}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* v5.4 集成評估分數 */}
                  {fs.ensemble_scores && (
                    <div className="mt-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 p-2.5">
                      <div className="text-indigo-400 text-xs font-medium mb-1.5">🧠 集成評估分數</div>
                      <div className="grid grid-cols-4 gap-1.5 text-center">
                        {[
                          { label: '規則引擎', value: fs.ensemble_scores.rule_engine, color: 'text-blue-300' },
                          { label: '量化評分', value: fs.ensemble_scores.quant_scorer, color: 'text-cyan-300' },
                          { label: 'AI 審核', value: fs.ensemble_scores.ai_confidence, color: 'text-violet-300' },
                          { label: '共識度', value: Math.round(fs.ensemble_scores.consensus_strength * 100), color: 'text-emerald-300' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="rounded bg-white/5 p-1.5">
                            <div className={`text-sm font-bold ${color}`}>{value}</div>
                            <div className="text-gray-500 text-[10px] mt-0.5">{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* v5.4 市場環境 Regime 競爭分數 */}
                  {fs.regime_scores && Object.keys(fs.regime_scores).length > 0 && (
                    <div className="mt-2.5 rounded-lg bg-slate-500/10 border border-slate-500/20 p-2.5">
                      <div className="text-slate-400 text-xs font-medium mb-1.5">🌏 市場環境競爭分數</div>
                      <div className="space-y-1">
                        {Object.entries(fs.regime_scores)
                          .sort(([, a], [, b]) => b - a)
                          .map(([regime, score]) => (
                            <div key={regime} className="flex items-center gap-2">
                              <span className="text-gray-400 text-[10px] w-24 shrink-0">{regime}</span>
                              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${Math.min(100, score)}%`,
                                    backgroundColor: score >= 60 ? '#10b981' : score >= 40 ? '#f59e0b' : '#6b7280'
                                  }}
                                />
                              </div>
                              <span className="text-gray-400 text-[10px] w-6 text-right">{score}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Reason Codes */}
                  {fs.reason_codes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {fs.reason_codes.map((code, i) => (
                        <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                          code.endsWith("_OK") || ["DISPLACEMENT_STRONG","FRESH_ZONE","VOLUME_CONFIRMED","HTF_ALIGNED","CHAN_BSP_CONFIRMED","SMC_TRILOGY_COMPLETE"].includes(code)
                            ? "bg-emerald-500/20 text-emerald-300"
                            : code.endsWith("_FAIL") || ["DISPLACEMENT_WEAK","STALE_ZONE","VOLUME_MISSING","HTF_CONFLICT","SMC_TRILOGY_INCOMPLETE","NO_TRADE_REGIME"].includes(code)
                            ? "bg-red-500/20 text-red-300"
                            : "bg-gray-500/20 text-gray-400"
                        }`}>{code}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })() : (
            /* 未使用 AI 引擎時，顯示三個模型列表（小卡片樣式） */
            <div className="space-y-2">
              <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                <Target className="w-4 h-4 text-[#f0b90b]" />
                交易模型評估（本地引擎）
              </h3>
            {result.models.map(model => (
              <div key={model.id} className={`rounded-xl border transition-all ${
                model.is_active
                  ? getConfidenceBg(model.confidence)
                  : "bg-white/3 border-white/10 opacity-60"
              }`}>
                {/* 模型標題列 */}
                <button
                  className="w-full p-4 flex items-center justify-between text-left"
                  onClick={() => toggleModel(model.id)}
                >
                  <div className="flex items-center gap-3">
                    {getModelIcon(model.id)}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold text-sm">{model.name}</span>
                        {model.is_active
                          ? <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">啟動中</span>
                          : <span className="px-1.5 py-0.5 rounded text-xs bg-gray-500/20 text-gray-400 border border-gray-500/30">條件未滿足</span>
                        }
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {getDirLabel(model.direction)}
                        <span className="text-gray-400 text-xs">{model.timeframe_consensus}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* 盈虧比 badge */}
                    <div className="text-right">
                      <div className={`text-sm font-bold ${getRrColor(model.rr_ratio)}`}>
                        RR {model.rr_ratio.toFixed(1)}x
                      </div>
                      <div className="text-gray-500 text-xs">盈虧比</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${getConfidenceColor(model.confidence)}`}>
                        {model.confidence}%
                      </div>
                      <div className="text-gray-500 text-xs">信心度</div>
                    </div>
                    {expandedModel === model.id
                      ? <ChevronUp className="w-4 h-4 text-gray-400" />
                      : <ChevronDown className="w-4 h-4 text-gray-400" />
                    }
                  </div>
                </button>

                {/* 展開詳情 */}
                {expandedModel === model.id && (
                  <div className="px-4 pb-4 space-y-4 border-t border-white/10 pt-3">
                    {/* 描述 */}
                    <p className="text-gray-300 text-xs leading-relaxed">{model.description}</p>

                    {/* 多合一確認雷達圖（SMC/ICT/PA/SNR 四維度視覺化） */}
                    {(() => {
                      const nowH = new Date().getUTCHours();
                      const isAmdM = (nowH >= 2 && nowH < 4) || (nowH >= 8 && nowH < 10) || (nowH >= 14 && nowH < 16);
                      const amdLabel = isAmdM ? (
                        nowH >= 14 ? '美洲操縱 M' : nowH >= 8 ? '歐洲操縱 M' : '亞洲操縱 M'
                      ) : (
                        nowH >= 16 ? '美洲派發 D' : nowH >= 10 ? '歐洲派發 D' : '亞洲累積 A'
                      );
                      // ICT 評分：基於 SMC 評分 + AMD 加成
                      const ictScore = Math.min(100, model.smc_score + (isAmdM ? 8 : 0));
                      // SNR 評分：基於 PA 評分
                      const snrScore = model.pa_score;
                      // 四維度資料
                      const dims = [
                        { label: 'SMC', score: model.smc_score, color: '#3b82f6' },
                        { label: 'ICT', score: ictScore,        color: '#a78bfa' },
                        { label: 'PA',  score: model.pa_score,  color: '#34d399' },
                        { label: 'SNR', score: snrScore,        color: '#fbbf24' },
                        { label: 'FIB', score: model.fib_score, color: '#f97316' },
                        { label: '纏論', score: model.chan_score, color: '#ec4899' },
                      ];
                      const cx = 80, cy = 80, r = 55;
                      const pts = dims.map((d, i) => {
                        const angle = (Math.PI * 2 * i / dims.length) - Math.PI / 2;
                        const rr = r * d.score / 100;
                        return { x: cx + rr * Math.cos(angle), y: cy + rr * Math.sin(angle), lx: cx + (r + 16) * Math.cos(angle), ly: cy + (r + 16) * Math.sin(angle) };
                      });
                      const polyPts = pts.map(p => `${p.x},${p.y}`).join(' ');
                      const gridPts3 = dims.map((_, i) => { const a = (Math.PI * 2 * i / dims.length) - Math.PI / 2; return `${cx + r * 0.5 * Math.cos(a)},${cy + r * 0.5 * Math.sin(a)}`; }).join(' ');
                      const gridPts7 = dims.map((_, i) => { const a = (Math.PI * 2 * i / dims.length) - Math.PI / 2; return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`; }).join(' ');
                      // Inducement 風險判斷：OB 被測試 2 次以上時顯示警告
                      const hasInducementRisk = model.smc_score < 55 && model.entry_conditions.some(c => c.includes('測試') || c.includes('OB'));
                      return (
                        <div className="space-y-3">
                          {/* AMD 時間窗口狀態 */}
                          <div className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
                            isAmdM ? 'bg-purple-500/15 border-purple-500/30' : 'bg-white/5 border-white/10'
                          }`}>
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${isAmdM ? 'bg-purple-400 animate-pulse' : 'bg-gray-500'}`} />
                              <span className="text-xs text-gray-400">AMD 算法窗口</span>
                            </div>
                            <span className={`text-xs font-mono font-bold ${isAmdM ? 'text-purple-300' : 'text-gray-500'}`}>
                              {amdLabel} · UTC {nowH}:xx
                            </span>
                          </div>
                          {/* Inducement 風險警告 */}
                          {hasInducementRisk && (
                            <div className="flex items-start gap-2 rounded-lg bg-orange-500/10 border border-orange-500/30 px-3 py-2">
                              <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-orange-300">⚠️ Inducement 風險：OB 可能已被機構用作誘騙陷阱（LIT 理論），建議等待 CHoCH 確認後再進場</span>
                            </div>
                          )}
                          {/* 四維度雷達圖 */}
                          <div className="flex items-center gap-4">
                            <svg width="160" height="160" viewBox="0 0 160 160">
                              {/* 背景網格 */}
                              <polygon points={gridPts3} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                              <polygon points={gridPts7} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
                              {/* 軸線 */}
                              {dims.map((_, i) => {
                                const a = (Math.PI * 2 * i / dims.length) - Math.PI / 2;
                                return <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />;
                              })}
                              {/* 評分多邊形 */}
                              <polygon points={polyPts} fill="rgba(59,130,246,0.2)" stroke="#3b82f6" strokeWidth="1.5" />
                              {/* 頂點圓點 */}
                              {pts.map((p, i) => (
                                <circle key={i} cx={p.x} cy={p.y} r="3" fill={dims[i].color} />
                              ))}
                              {/* 標籤 */}
                              {pts.map((p, i) => (
                                <text key={i} x={p.lx} y={p.ly} textAnchor="middle" dominantBaseline="middle"
                                  fontSize="9" fill={dims[i].color} fontWeight="600">
                                  {dims[i].label}
                                </text>
                              ))}
                            </svg>
                            <div className="flex-1 space-y-1.5">
                              {dims.map(d => (
                                <div key={d.label} className="flex items-center gap-2">
                                  <span className="text-xs w-6 text-right" style={{ color: d.color }}>{d.label}</span>
                                  <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${d.score}%`, backgroundColor: d.color, opacity: 0.8 }} />
                                  </div>
                                  <span className="text-xs text-gray-400 w-6 text-right">{Math.round(d.score)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 四維度評分（詳細條形圖） */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Activity className="w-3 h-3 text-blue-400" />
                          <span className="text-gray-400 text-xs">SMC 市場結構</span>
                        </div>
                        {getScoreBar(model.smc_score)}
                        <div className="flex items-center gap-1.5 mb-1 mt-2">
                          <BarChart2 className="w-3 h-3 text-green-400" />
                          <span className="text-gray-400 text-xs">PA 形態（水位共振）</span>
                        </div>
                        {getScoreBar(model.pa_score)}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <GitBranch className="w-3 h-3 text-yellow-400" />
                          <span className="text-gray-400 text-xs">斯波那契 OTE</span>
                        </div>
                        {getScoreBar(model.fib_score)}
                        <div className="flex items-center gap-1.5 mb-1 mt-2">
                          <Layers className="w-3 h-3 text-purple-400" />
                          <span className="text-gray-400 text-xs">纏論（增強版）</span>
                        </div>
                        {getScoreBar(model.chan_score)}
                      </div>
                    </div>

                    {/* 進場條件 */}
                    <div>
                      <p className="text-gray-400 text-xs font-medium mb-2 flex items-center gap-1">
                        <Target className="w-3 h-3" />進場條件（逐一確認）
                      </p>
                      <div className="space-y-1.5">
                        {model.entry_conditions.map((cond, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <span className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${
                              cond.includes("✓") || cond.includes("已出現") || cond.includes("在區間") || cond.includes("已掃")
                                ? "bg-emerald-500/30 text-emerald-400"
                                : "bg-white/10 text-gray-400"
                            }`}>{i + 1}</span>
                            <span className="text-gray-300 leading-relaxed">{cond}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 止損/止盈 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2.5">
                        <p className="text-red-400 text-xs font-medium mb-1 flex items-center gap-1">
                          <Shield className="w-3 h-3" />止損建議
                        </p>
                        <p className="text-gray-300 text-xs">{model.stop_loss_hint}</p>
                      </div>
                      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5">
                        <p className="text-emerald-400 text-xs font-medium mb-1 flex items-center gap-1">
                          <Target className="w-3 h-3" />止盈目標
                        </p>
                        <p className="text-gray-300 text-xs">{model.take_profit_hint}</p>
                      </div>
                    </div>

                    {/* SMC 三部曲設置 */}
                    {model.smc_setups && model.smc_setups.length > 0 && (
                      <SmcSetupCards setups={model.smc_setups} />
                    )}

                    {/* 纏論買賣點 */}
                    {model.chan_buy_sell_points && model.chan_buy_sell_points.length > 0 && (
                      <ChanBuySellPoints points={model.chan_buy_sell_points} />
                    )}

                    {/* RSI/MACD 背離 */}
                    {model.divergences && model.divergences.length > 0 && (
                      <div>
                        <p className="text-gray-400 text-xs font-medium mb-2 flex items-center gap-1">
                          <Activity className="w-3 h-3 text-orange-400" />RSI/MACD 背離信號
                        </p>
                        <div className="space-y-1">
                          {model.divergences.slice(0, 3).map((d, i) => (
                            <div key={i} className="text-xs text-orange-300/80 pl-2 border-l border-orange-500/30">
                              {d}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 關鍵價位 */}
                    {model.key_levels.length > 0 && (
                      <div>
                        <p className="text-gray-400 text-xs font-medium mb-2">關鍵價位</p>
                        <div className="flex flex-wrap gap-2">
                          {model.key_levels.map((level, i) => (
                            <div key={i} className={`px-2 py-1 rounded text-xs border ${
                              level.type.includes("bull") || level.type === "swept_low" || level.type === "zhongshu_bottom"
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                : level.type.includes("bear") || level.type === "swept_high" || level.type === "zhongshu_top"
                                ? "bg-red-500/10 border-red-500/30 text-red-300"
                                : level.type.includes("fib_ext")
                                ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                                : level.type.includes("smc")
                                ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
                                : "bg-blue-500/10 border-blue-500/30 text-blue-300"
                            }`}>
                              {level.label}: {level.price.toFixed(2)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 風險提示 */}
                    {model.risk_warning && (
                      <div className="flex items-start gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-2.5">
                        <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <p className="text-yellow-300/80 text-xs">{model.risk_warning}</p>
                      </div>
                    )}
                  </div>
                )}
                  </div>
            ))}
            </div>
          )}

          {/* 各時間框架詳細分析 */}
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
            <button
              className="w-full p-3 flex items-center justify-between text-left hover:bg-white/5"
              onClick={() => setShowTf(v => !v)}
            >
              <span className="text-gray-300 text-sm font-medium flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-gray-400" />各時間框架四維度詳情（v2.0）
              </span>
              {showTfDetail ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showTfDetail && (
              <div className="border-t border-white/10 divide-y divide-white/5">
                {result.tf_analyses.map(tf => (
                  <div key={tf.bar} className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-white font-medium text-sm">{tf.label}</span>
                      <div className="flex items-center gap-2">
                        {getDirLabel(tf.direction)}
                        <span className="text-gray-500 text-xs">總分 {Math.round(tf.total_score)}</span>
                        {tf.atr > 0 && <span className="text-gray-600 text-xs">ATR {tf.atr.toFixed(2)}</span>}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">SMC 結構</span>
                        <span className="text-gray-300">{tf.smc_bos_choch}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Premium/Discount</span>
                        <span className={tf.smc_premium_discount === "discount" ? "text-emerald-400" : tf.smc_premium_discount === "premium" ? "text-red-400" : "text-gray-300"}>
                          {tf.smc_premium_discount === "discount" ? "折扣區 ✓" : tf.smc_premium_discount === "premium" ? "溢價區 ✗" : "均衡"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">PA 趨勢</span>
                        <span className="text-gray-300">{tf.pa_trend}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">RSI / ADX</span>
                        <span className="text-gray-300">{tf.pa_rsi.toFixed(1)} / {tf.pa_adx.toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">纏論趨勢</span>
                        {getTrendLabel(tf.chan_trend)}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">中樞狀態</span>
                        <span className={tf.chan_in_zhongshu ? "text-yellow-400" : "text-gray-400"}>
                          {tf.chan_in_zhongshu ? `震盪中 (${tf.chan_zhongshu_bottom.toFixed(0)}–${tf.chan_zhongshu_top.toFixed(0)})` : "中樞外"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">筆/線段</span>
                        <span className="text-gray-300">{tf.chan_bi_count} 筆 / {tf.chan_duan_count} 段</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">MACD 面積比</span>
                        <span className={tf.chan_macd_area_ratio > 0 && tf.chan_macd_area_ratio < 0.7 ? "text-orange-400" : "text-gray-300"}>
                          {tf.chan_macd_area_ratio > 0 ? tf.chan_macd_area_ratio.toFixed(2) : "—"}
                          {tf.chan_macd_area_ratio > 0 && tf.chan_macd_area_ratio < 0.7 ? " ⚡背馳" : ""}
                        </span>
                      </div>
                      {tf.fib_in_ote && (
                        <div className="col-span-2 flex justify-between">
                          <span className="text-gray-500">斐波 OTE</span>
                          <span className="text-emerald-400">✓ 現價在 OTE 區間內</span>
                        </div>
                      )}
                      {tf.chan_divergence && (
                        <div className="col-span-2 flex justify-between">
                          <span className="text-gray-500">纏論背馳（MACD面積）</span>
                          <span className={tf.chan_divergence === "bottom" ? "text-emerald-400" : "text-red-400"}>
                            {tf.chan_divergence === "bottom" ? "底背馳 ↑" : "頂背馳 ↓"}
                          </span>
                        </div>
                      )}
                      {tf.pa_bullish_patterns.length > 0 && (
                        <div className="col-span-2 flex justify-between">
                          <span className="text-gray-500">多方形態（水位共振）</span>
                          <span className="text-emerald-400">{tf.pa_bullish_patterns.join("、")}</span>
                        </div>
                      )}
                      {tf.pa_bearish_patterns.length > 0 && (
                        <div className="col-span-2 flex justify-between">
                          <span className="text-gray-500">空方形態（水位共振）</span>
                          <span className="text-red-400">{tf.pa_bearish_patterns.join("、")}</span>
                        </div>
                      )}
                      {tf.divergences && tf.divergences.length > 0 && (
                        <div className="col-span-2">
                          <span className="text-gray-500">RSI/MACD 背離：</span>
                          <span className="text-orange-300/80 text-xs">{tf.divergences[0]}</span>
                        </div>
                      )}
                      {tf.smc_setups && tf.smc_setups.length > 0 && (
                        <div className="col-span-2 flex justify-between">
                          <span className="text-gray-500">SMC 三部曲設置</span>
                          <span className="text-blue-400">
                            {tf.smc_setups.length} 個
                            （{tf.smc_setups.filter(s => s.status === "active").length} 啟動，
                            {tf.smc_setups.filter(s => s.status === "waiting").length} 等待）
                          </span>
                        </div>
                      )}
                    </div>
                    {/* 纏論買賣點（精簡版） */}
                    {tf.chan_buy_sell_points && tf.chan_buy_sell_points.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {tf.chan_buy_sell_points.map((p, i) => (
                          <span key={i} className={`px-1.5 py-0.5 rounded text-xs border ${getChanLevelColor(p.level)}`}>
                            {p.level}類{p.direction === "buy" ? "買" : "賣"}@{p.price.toFixed(0)}
                            {p.divergence_confirmed ? "★" : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* 四維度評分條 */}
                    <div className="grid grid-cols-4 gap-2 mt-1">
                      {[
                        { label: "SMC", score: tf.smc_score, color: "text-blue-400" },
                        { label: "PA",  score: tf.pa_score,  color: "text-green-400" },
                        { label: "Fib", score: tf.fib_score, color: "text-yellow-400" },
                        { label: "纏",  score: tf.chan_score, color: "text-purple-400" },
                      ].map(d => (
                        <div key={d.label} className="text-center">
                          <div className={`text-xs font-medium ${d.color}`}>{d.label}</div>
                          <div className="text-white text-sm font-bold">{Math.round(d.score)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI 交易審核決策卡片（Trade Veto Layer v3.5） */}
          {result.trade_decision && (() => {
            const vd = result.trade_decision!;
            const decisionColor = vd.decision === "TRADE"
              ? "border-emerald-500/50 bg-emerald-500/10"
              : vd.decision === "WAIT"
              ? "border-yellow-500/50 bg-yellow-500/10"
              : "border-red-500/50 bg-red-500/10";
            const decisionTextColor = vd.decision === "TRADE"
              ? "text-emerald-400"
              : vd.decision === "WAIT"
              ? "text-yellow-400"
              : "text-red-400";
            const decisionIcon = vd.decision === "TRADE" ? "✅" : vd.decision === "WAIT" ? "⏳" : "❌";
            const qualityStars = "★".repeat(vd.setup_quality) + "☆".repeat(5 - vd.setup_quality);
            return (
              <div className={`rounded-xl border ${decisionColor} overflow-hidden`}>
                {/* 標題列 */}
                <div className="p-3 flex items-center justify-between">
                  <span className={`text-sm font-bold flex items-center gap-2 ${decisionTextColor}`}>
                    <span className="text-base">{decisionIcon}</span>
                    AI 審核決策：{vd.decision}
                    {vd.model !== "NONE" && <span className="text-xs font-normal text-gray-400">(模型 {vd.model})</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">品質 {qualityStars}</span>
                    <span className={`text-xs font-bold ${decisionTextColor}`}>{vd.confidence}%</span>
                  </div>
                </div>
                {/* 內容區 */}
                <div className="border-t border-white/10 p-3 space-y-2 text-xs">
                  {vd.primary_edge && (
                    <div className="flex gap-2">
                      <span className="text-emerald-400 font-medium whitespace-nowrap">核心優勢</span>
                      <span className="text-gray-300">{vd.primary_edge}</span>
                    </div>
                  )}
                  {vd.primary_failure_mode && (
                    <div className="flex gap-2">
                      <span className="text-red-400 font-medium whitespace-nowrap">失敗風險</span>
                      <span className="text-gray-300">{vd.primary_failure_mode}</span>
                    </div>
                  )}
                  {vd.must_see_trigger && (
                    <div className="flex gap-2">
                      <span className="text-yellow-400 font-medium whitespace-nowrap">進場觸發</span>
                      <span className="text-gray-300">{vd.must_see_trigger}</span>
                    </div>
                  )}
                  {vd.invalidation && (
                    <div className="flex gap-2">
                      <span className="text-orange-400 font-medium whitespace-nowrap">失效條件</span>
                      <span className="text-gray-300">{vd.invalidation}</span>
                    </div>
                  )}
                  {vd.conflict_note && vd.conflict_note !== "無衝突" && (
                    <div className="flex gap-2">
                      <span className="text-purple-400 font-medium whitespace-nowrap">衝突說明</span>
                      <span className="text-gray-300">{vd.conflict_note}</span>
                    </div>
                  )}
                  {vd.reason_codes.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {vd.reason_codes.map((code, i) => (
                        <span
                          key={i}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            code.endsWith("_OK") || code === "DISPLACEMENT_STRONG" || code === "FRESH_ZONE" || code === "VOLUME_CONFIRMED" || code === "HTF_ALIGNED" || code === "CHAN_BSP_CONFIRMED" || code === "SMC_TRILOGY_COMPLETE"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : code.endsWith("_FAIL") || code === "DISPLACEMENT_WEAK" || code === "STALE_ZONE" || code === "VOLUME_MISSING" || code === "HTF_CONFLICT" || code === "SMC_TRILOGY_INCOMPLETE" || code === "NO_TRADE_REGIME"
                              ? "bg-red-500/20 text-red-300"
                              : "bg-gray-500/20 text-gray-400"
                          }`}
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* AI 深度說明 */}
          {result.ai_analysis && (
            <div className="rounded-xl border border-[#f0b90b]/20 bg-[#f0b90b]/5 overflow-hidden">
              <button
                className="w-full p-3 flex items-center justify-between text-left hover:bg-[#f0b90b]/5"
                onClick={() => setShowAI(v => !v)}
              >
                <span className="text-[#f0b90b] text-sm font-medium flex items-center gap-2">
                  <Zap className="w-4 h-4" />AI 深度分析說明（v3.5 增強版）
                </span>
                {showAI ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {showAI && (
                <div className="border-t border-[#f0b90b]/10 p-4 space-y-0.5 max-h-[500px] overflow-y-auto">
                  {formatAiText(result.ai_analysis)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
