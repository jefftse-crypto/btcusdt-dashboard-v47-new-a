/**
 * ChampionAnalysisPanel — Champion Trader 方法論實時分析面板
 *
 * 核心功能：根據 Shi Hun / @championtrader 的四層分析框架，
 * 對當前幣種進行 GPT 驅動的結構化分析，輸出可執行的交易建議。
 *
 * 四層框架：
 *  1. 基礎圖表語言層（趨勢 + 位置）
 *  2. 訊號層（MACD / RSI / 布林帶 / KD）
 *  3. 結構過濾層（FVG / 流動性 / BOS / 主力痕跡）
 *  4. 執行層（進場 / 止損 / 出場 / 風報比）
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CryptoSnapshot } from "@shared/cryptoTypes";
import {
  TrendingUp, TrendingDown, Minus,
  Target, Shield, BarChart2,
  CheckCircle, XCircle, AlertTriangle,
  ChevronDown, ChevronRight,
  RefreshCw, Award, Layers, Activity,
  ArrowUpRight, ArrowDownRight
} from "lucide-react";

// ─── 類型定義（適配 LLM 實際返回的彈性結構）─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

interface Props {
  snapshot: CryptoSnapshot | null | undefined;
  currentPrice: number | null | undefined;
  isLoading?: boolean;
  symbol?: string;
}

// ─── 子組件：分析結果卡片 ─────────────────────────────────────────────────────
function LayerCard({
  icon, title, color, children, defaultOpen = true
}: {
  icon: React.ReactNode;
  title: string;
  color: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${color}33`, background: "#111" }}>
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:opacity-80 transition-opacity"
        style={{ background: `${color}11` }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ color }}>{icon}</span>
        <span className="text-sm font-semibold" style={{ color }}>{title}</span>
        <span className="ml-auto" style={{ color: "#555" }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && <div className="px-4 py-3 space-y-2">{children}</div>}
    </div>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string | number; highlight?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: "#888" }}>{label}</span>
      <span className="font-mono font-semibold" style={{ color: highlight ?? "#e0e0e0" }}>{value}</span>
    </div>
  );
}

function CheckItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok
        ? <CheckCircle size={13} className="flex-shrink-0" style={{ color: "#4caf50" }} />
        : <XCircle    size={13} className="flex-shrink-0" style={{ color: "#f44336" }} />
      }
      <span style={{ color: ok ? "#ccc" : "#888" }}>{label}</span>
    </div>
  );
}

// ─── 工具函數：安全讀取巢狀欄位 ──────────────────────────────────────────────
function safeStr(obj: AnyObj | undefined | null, ...keys: string[]): string {
  if (!obj) return "—";
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return "—";
    cur = (cur as AnyObj)[k];
  }
  return cur != null ? String(cur) : "—";
}

function safeNum(obj: AnyObj | undefined | null, ...keys: string[]): number | null {
  if (!obj) return null;
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as AnyObj)[k];
  }
  return typeof cur === "number" ? cur : null;
}

// 從 final_judgement.bias 或 strategy.direction 推導方向顏色
function resolveBiasColor(analysis: AnyObj): string {
  const bias = safeStr(analysis, "final_judgement", "bias").toLowerCase();
  const dir  = safeStr(analysis, "strategy", "direction").toLowerCase();
  if (bias.includes("bullish") || dir.includes("buy") || dir.includes("long")) return "#4caf50";
  if (bias.includes("bearish") || dir.includes("sell") || dir.includes("short")) return "#f44336";
  return "#ffd740";
}

function resolveBiasLabel(analysis: AnyObj): string {
  const dir = safeStr(analysis, "strategy", "direction").toLowerCase();
  if (dir.includes("buy") || dir.includes("long")) return "偏多";
  if (dir.includes("sell") || dir.includes("short")) return "偏空";
  const bias = safeStr(analysis, "final_judgement", "bias").toLowerCase();
  if (bias.includes("bullish")) return "偏多";
  if (bias.includes("bearish")) return "偏空";
  return "觀望";
}

function BiasIcon({ analysis }: { analysis: AnyObj }) {
  const label = resolveBiasLabel(analysis);
  if (label === "偏多") return <ArrowUpRight size={16} />;
  if (label === "偏空") return <ArrowDownRight size={16} />;
  return <Minus size={16} />;
}

// ─── 主組件 ──────────────────────────────────────────────────────────────────
export function ChampionAnalysisPanel({ snapshot, currentPrice, isLoading: parentLoading, symbol = "BTCUSDT" }: Props) {
  const [result, setResult] = useState<AnyObj | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState("1h");

  const analyzeMutation = trpc.champion.analyze.useMutation({
    onSuccess: (data) => {
      if (data?.analysis) {
        setResult(data.analysis as AnyObj);
        setError(null);
      }
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleAnalyze = () => {
    if (!snapshot || !currentPrice) return;
    setError(null);
    analyzeMutation.mutate({ symbol, snapshot, currentPrice, timeframe });
  };

  const isAnalyzing = analyzeMutation.isPending;
  const hasSnapshot = !!snapshot && !!currentPrice;

  const confColor = (conf: number) => {
    if (conf >= 75) return "#4caf50";
    if (conf >= 50) return "#ffd740";
    return "#f44336";
  };

  return (
    <div className="space-y-4">
      {/* ── 標題區 ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award size={18} style={{ color: "#ffd740" }} />
          <span className="text-sm font-bold" style={{ color: "#ffd740" }}>冠軍交易者分析</span>
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#ffd74022", color: "#ffd740", border: "1px solid #ffd74033" }}>
            @championtrader
          </span>
        </div>
        <div className="flex gap-1">
          {["15m", "1h", "4h"].map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className="px-2 py-1 rounded text-xs transition-colors"
              style={{
                background: timeframe === tf ? "#ffd74022" : "transparent",
                color: timeframe === tf ? "#ffd740" : "#666",
                border: `1px solid ${timeframe === tf ? "#ffd74044" : "#2a2a2a"}`,
              }}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* ── 方法論說明 ── */}
      <div className="rounded-lg p-3 text-xs" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="font-semibold mb-1" style={{ color: "#aaa" }}>📐 四層分析框架</div>
        <div className="grid grid-cols-2 gap-1" style={{ color: "#666" }}>
          <span>① 基礎圖表語言（趨勢+位置）</span>
          <span>② 訊號層（MACD/RSI/布林/KD）</span>
          <span>③ 結構過濾（FVG/流動性/BOS）</span>
          <span>④ 執行層（進場/止損/風報比）</span>
        </div>
      </div>

      {/* ── 分析按鈕 ── */}
      {!hasSnapshot ? (
        <div className="rounded-lg p-4 text-center" style={{ background: "#111", border: "1px solid #2a2a2a" }}>
          <AlertTriangle size={20} className="mx-auto mb-2" style={{ color: "#ffd740" }} />
          <div className="text-xs" style={{ color: "#888" }}>
            請先點擊上方「分析 {symbol.replace("USDT", "")}」按鈕取得市場快照
          </div>
        </div>
      ) : (
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing || parentLoading}
          className="w-full py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all"
          style={{
            background: isAnalyzing ? "#2a2a00" : "#ffd740",
            color: isAnalyzing ? "#ffd740" : "#000",
            border: isAnalyzing ? "1px solid #ffd74044" : "none",
            opacity: isAnalyzing ? 0.8 : 1,
          }}
        >
          {isAnalyzing ? (
            <><RefreshCw size={15} className="animate-spin" />冠軍交易者正在分析中...</>
          ) : (
            <><Award size={15} />用冠軍方法論分析 {symbol.replace("USDT", "")}</>
          )}
        </button>
      )}

      {/* ── 錯誤訊息 ── */}
      {error && (
        <div className="rounded-lg p-3 text-xs" style={{ background: "#1a0000", border: "1px solid #f4433633", color: "#f44336" }}>
          <AlertTriangle size={13} className="inline mr-1" />{error}
        </div>
      )}

      {/* ── 分析結果 ── */}
      {result && (() => {
        const biasColor = resolveBiasColor(result);
        const biasLabel = resolveBiasLabel(result);
        const confidence = safeNum(result, "strategy", "confidence") ?? safeNum(result, "consensus_score", "score") ?? 0;
        const confMax    = safeNum(result, "consensus_score", "max_score") ?? 100;
        const confPct    = confMax > 0 ? Math.round((confidence / confMax) * 100) : confidence;

        return (
          <div className="space-y-3">

            {/* ── 最終裁決橫幅 ── */}
            <div className="rounded-lg p-4" style={{ background: `${biasColor}11`, border: `1px solid ${biasColor}44` }}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: biasColor }}><BiasIcon analysis={result} /></span>
                <span className="text-base font-bold" style={{ color: biasColor }}>{biasLabel}</span>
                <span className="text-xs px-2 py-0.5 rounded ml-auto" style={{
                  background: confColor(confPct) + "22",
                  color: confColor(confPct),
                  border: `1px solid ${confColor(confPct)}44`,
                }}>
                  信心 {confPct}%
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "#ccc" }}>
                {safeStr(result, "final_judgement", "one_line_summary") ||
                 safeStr(result, "final_judgement", "action") ||
                 safeStr(result, "champion_verdict")}
              </p>
            </div>

            {/* ── ① 市場狀態 ── */}
            <LayerCard icon={<TrendingUp size={15} />} title="① 市場狀態" color="#4fc3f7">
              <InfoRow label="當前價格" value={`$${currentPrice?.toLocaleString() ?? "—"}`} highlight="#4fc3f7" />
              <InfoRow label="市場偏向" value={safeStr(result, "market_state", "session_bias")} />
              <InfoRow label="動能狀態" value={safeStr(result, "market_state", "momentum_state")} />
              <InfoRow label="市況" value={safeStr(result, "market_state", "market_condition")} />
            </LayerCard>

            {/* ── ② 技術指標 ── */}
            <LayerCard icon={<Activity size={15} />} title="② 訊號層 — 指標共振" color="#ffd740">
              <InfoRow label="RSI" value={safeStr(result, "technical_indicators", "rsi")} />
              <InfoRow label="MACD" value={safeStr(result, "technical_indicators", "macd")} />
              <InfoRow label="布林帶" value={safeStr(result, "technical_indicators", "bollinger_bands")} />
              <InfoRow label="KD" value={safeStr(result, "technical_indicators", "stochastic_kd")} />
              <InfoRow label="成交量確認" value={safeStr(result, "technical_indicators", "volume_confirmation")} />
              {safeStr(result, "consensus_score", "interpretation") !== "—" && (
                <div className="mt-2 pt-2 text-xs" style={{ borderTop: "1px solid #1e1e1e", color: "#aaa" }}>
                  <span style={{ color: "#ffd740" }}>共振評分：</span>
                  {safeStr(result, "consensus_score", "score")}/{safeStr(result, "consensus_score", "max_score")}
                  {" "}({safeStr(result, "consensus_score", "grade")})
                </div>
              )}
            </LayerCard>

            {/* ── ③ SMC 結構過濾 ── */}
            <LayerCard icon={<Layers size={15} />} title="③ 結構過濾層 — 主力痕跡" color="#ce93d8">
              <InfoRow label="市場結構" value={safeStr(result, "smc_market_structure", "structure")} />
              <InfoRow label="BOS/CHoCH" value={safeStr(result, "smc_market_structure", "recent_bos_choch")} />
              <InfoRow label="FVG" value={safeStr(result, "smc_market_structure", "fvg")} />
              <InfoRow label="流動性" value={safeStr(result, "smc_market_structure", "liquidity")} />
              {safeStr(result, "smc_market_structure", "interpretation") !== "—" && (
                <div className="text-xs mt-1" style={{ color: "#aaa" }}>
                  <span style={{ color: "#ce93d8" }}>解讀：</span>
                  {safeStr(result, "smc_market_structure", "interpretation")}
                </div>
              )}
            </LayerCard>

            {/* ── ④ 執行層 ── */}
            <LayerCard icon={<Target size={15} />} title="④ 執行層 — 進場計劃" color="#4caf50">
              <div className="text-xs space-y-1.5">
                <div>
                  <span style={{ color: "#888" }}>方向：</span>
                  <span style={{ color: biasColor }}>{safeStr(result, "strategy", "direction")}</span>
                </div>
                <div>
                  <span style={{ color: "#888" }}>主要進場：</span>
                  <span style={{ color: "#e0e0e0" }}>{safeStr(result, "strategy", "entry", "primary")}</span>
                </div>
                <div>
                  <span style={{ color: "#888" }}>觸發條件：</span>
                  <span style={{ color: "#e0e0e0" }}>{safeStr(result, "strategy", "entry", "trigger_condition")}</span>
                </div>
                <div style={{ borderTop: "1px solid #1e1e1e", paddingTop: "6px" }}>
                  <span style={{ color: "#f44336" }}>止損：</span>
                  <span style={{ color: "#e0e0e0" }}>{safeStr(result, "strategy", "stop_loss", "level")}</span>
                </div>
                <div>
                  <span style={{ color: "#4fc3f7" }}>止盈 1：</span>
                  <span style={{ color: "#e0e0e0" }}>{safeStr(result, "strategy", "take_profit", "tp1")}</span>
                </div>
                <div>
                  <span style={{ color: "#4fc3f7" }}>止盈 2：</span>
                  <span style={{ color: "#e0e0e0" }}>{safeStr(result, "strategy", "take_profit", "tp2")}</span>
                </div>
                <div style={{ borderTop: "1px solid #1e1e1e", paddingTop: "6px" }}>
                  <span style={{ color: "#888" }}>倉位：</span>
                  <span style={{ color: "#e0e0e0" }}>{safeStr(result, "strategy", "risk_management", "position_sizing")}</span>
                  <span style={{ color: "#888" }}> / 風報比偏好：</span>
                  <span style={{ color: "#e0e0e0" }}>{safeStr(result, "strategy", "risk_management", "rr_preference")}</span>
                </div>
              </div>
            </LayerCard>

            {/* ── 交易計劃 ── */}
            <LayerCard icon={<Shield size={15} />} title="交易計劃與失效條件" color="#80cbc4" defaultOpen={false}>
              <div className="text-xs space-y-1.5">
                <div>
                  <span style={{ color: "#80cbc4" }}>主要情境：</span>
                  <span style={{ color: "#ccc" }}>{safeStr(result, "trading_plan", "primary_scenario")}</span>
                </div>
                <div>
                  <span style={{ color: "#f44336" }}>失效條件：</span>
                  <span style={{ color: "#ccc" }}>{safeStr(result, "trading_plan", "invalidation_scenario")}</span>
                </div>
                {Array.isArray(result?.trading_plan?.no_trade_conditions) && (
                  <div>
                    <div style={{ color: "#ffd740" }} className="mb-1">不入場條件：</div>
                    {(result.trading_plan.no_trade_conditions as string[]).map((c: string, i: number) => (
                      <div key={i} className="flex gap-1">
                        <XCircle size={11} className="flex-shrink-0 mt-0.5" style={{ color: "#f44336" }} />
                        <span style={{ color: "#888" }}>{c}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </LayerCard>

            {/* ── 冠軍交易者五階段評估 ── */}
            {result?.champion_trader_assessment && (
              <LayerCard icon={<Award size={15} />} title="冠軍交易者五階段評估" color="#ffd740" defaultOpen={false}>
                {["stage_1_trend", "stage_2_momentum", "stage_3_structure", "stage_4_volume_confirmation", "stage_5_execution_readiness"].map((stage, i) => {
                  const val = safeStr(result, "champion_trader_assessment", stage);
                  if (val === "—") return null;
                  const labels = ["趨勢", "動能", "結構", "量能確認", "執行就緒"];
                  const passed = val.toLowerCase().includes("pass") || val.toLowerCase().includes("確認") || val.toLowerCase().includes("ok");
                  return (
                    <CheckItem key={stage} label={`${labels[i]}：${val}`} ok={passed} />
                  );
                })}
              </LayerCard>
            )}

            {/* ── Champion Trader 核心問題 ── */}
            <div className="rounded-lg p-3" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
              <div className="text-xs font-semibold mb-2" style={{ color: "#888" }}>
                <BarChart2 size={12} className="inline mr-1" />
                Champion Trader 四個核心問題
              </div>
              <div className="space-y-1.5 text-xs" style={{ color: "#666" }}>
                <div>
                  <span style={{ color: "#ffd740" }}>Q1 趨勢：</span>
                  {safeStr(result, "price_action", "trend")} — {safeStr(result, "multi_timeframe", "alignment")}
                </div>
                <div>
                  <span style={{ color: "#ffd740" }}>Q2 位置：</span>
                  支撐 {safeStr(result, "price_action", "support")} / 阻力 {safeStr(result, "price_action", "resistance")}
                </div>
                <div>
                  <span style={{ color: "#ffd740" }}>Q3 止損：</span>
                  {safeStr(result, "strategy", "stop_loss", "level")}
                </div>
                <div>
                  <span style={{ color: "#ffd740" }}>Q4 風報比：</span>
                  {safeStr(result, "strategy", "risk_management", "rr_preference")}
                </div>
              </div>
            </div>

            {/* ── 數據品質警告 ── */}
            {safeStr(result, "data_quality", "warning") !== "—" && (
              <div className="rounded-lg p-3 text-xs" style={{ background: "#1a1000", border: "1px solid #ffd74022" }}>
                <div className="flex items-start gap-2">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" style={{ color: "#ffd740" }} />
                  <span style={{ color: "#999" }}>{safeStr(result, "data_quality", "warning")}</span>
                </div>
              </div>
            )}

          </div>
        );
      })()}

      {/* ── 空狀態（有快照但未分析）── */}
      {hasSnapshot && !result && !isAnalyzing && !error && (
        <div className="rounded-lg p-6 text-center" style={{ background: "#0d0d0d", border: "1px dashed #2a2a2a" }}>
          <Award size={28} className="mx-auto mb-3" style={{ color: "#333" }} />
          <div className="text-xs" style={{ color: "#555" }}>
            點擊上方按鈕，用 Champion Trader 方法論分析當前市況
          </div>
          <div className="text-xs mt-1" style={{ color: "#444" }}>
            基礎圖表語言 → 訊號共振 → 結構過濾 → 執行建議
          </div>
        </div>
      )}
    </div>
  );
}

export default ChampionAnalysisPanel;
