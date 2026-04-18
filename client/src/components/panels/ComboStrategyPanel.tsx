/**
 * ComboStrategyPanel.tsx
 * 組合策略即時信號面板 — 方案 A 分組 MTF
 * 同時監控多個策略，自動選出評分最高的信號
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { TrendingUp, TrendingDown, Minus, Zap, RefreshCw, Star, Shield, Activity } from "lucide-react";
import { toast } from "sonner";

type Strategy =
  | "ema_cross" | "rsi_reversal" | "bollinger" | "macd" | "smc" | "pa"
  | "chan" | "liquidity_sweep" | "vwap_reversion" | "composite"
  | "cannonball" | "hwr_model_a" | "hwr_model_b" | "hwr_model_c";

const STRATEGY_LABELS: Record<Strategy, string> = {
  ema_cross:       "EMA 交叉",
  rsi_reversal:    "RSI 反轉",
  bollinger:       "布林帶",
  macd:            "MACD",
  smc:             "SMC 結構",
  pa:              "PA 綜合",
  chan:             "纏論",
  liquidity_sweep: "ICT 流動性",
  vwap_reversion:  "VWAP 回歸",
  composite:       "綜合策略",
  cannonball:      "CannonBall",
  hwr_model_a:     "HWR-A",
  hwr_model_b:     "HWR-B",
  hwr_model_c:     "HWR-C",
};

// 預設推薦組合
const RECOMMENDED_COMBOS = [
  {
    name: "🏆 最優平衡",
    strategies: ["ema_cross", "cannonball", "hwr_model_a", "hwr_model_c", "macd"] as Strategy[],
    note: "含 CannonBall 結構確認與趨勢延續",
    color: "#ffd740",
  },
  {
    name: "🎯 最高勝率",
    strategies: ["bollinger", "ema_cross", "cannonball", "hwr_model_a", "macd"] as Strategy[],
    note: "加入 CannonBall 後更偏保守確認",
    color: "#4caf50",
  },
  {
    name: "🛡️ 最低回撤",
    strategies: ["ema_cross", "cannonball", "hwr_model_a", "vwap_reversion"] as Strategy[],
    note: "偏重結構確認與均值回歸互補",
    color: "#4fc3f7",
  },
  {
    name: "⚡ 高活躍度",
    strategies: ["pa", "cannonball", "hwr_model_b", "macd", "chan"] as Strategy[],
    note: "兼顧趨勢追蹤與結構型回踩",
    color: "#ab47bc",
  },
];

const ALL_STRATEGIES: Strategy[] = [
  "ema_cross", "cannonball", "hwr_model_a", "hwr_model_b", "hwr_model_c",
  "macd", "pa", "bollinger", "chan", "vwap_reversion",
  "rsi_reversal", "smc", "liquidity_sweep", "composite",
];

interface Props {
  symbol: string;
}

function formatPrice(p: number | null | undefined): string {
  if (p == null) return "—";
  return p >= 1000
    ? p.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : p.toFixed(4);
}

function formatTime(ts: number | null | undefined): string {
  if (ts == null) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

export function ComboStrategyPanel({ symbol }: Props) {
  const [selectedCombo, setSelectedCombo] = useState(0);
  const [customStrategies, setCustomStrategies] = useState<Strategy[]>([]);
  const [useCustom, setUseCustom] = useState(false);
  const [useTripleMtf, setUseTripleMtf] = useState(true);

  const activeStrategies = useCustom
    ? customStrategies
    : RECOMMENDED_COMBOS[selectedCombo].strategies;

  const mutation = trpc.combo.liveSignal.useMutation({
    onSuccess: () => {
      toast.success("組合信號已更新");
    },
    onError: (err) => {
      toast.error(`獲取信號失敗：${err.message}`);
    },
  });

  const handleScan = () => {
    if (activeStrategies.length === 0) {
      toast.error("請至少選擇一個策略");
      return;
    }
    mutation.mutate({
      symbol,
      interval: "15m",
      limit: 500,
      strategies: activeStrategies,
      use_triple_mtf: useTripleMtf,
    });
  };

  const data = mutation.data;
  const bestSignal = data?.best_signal;
  const activeSignals = data?.active_signals ?? [];
  const allSignals = data?.all_signals ?? [];

  const isLong = bestSignal?.signal_direction === "long";
  const isShort = bestSignal?.signal_direction === "short";
  const dirColor = isLong ? "#4caf50" : isShort ? "#ef5350" : "#ffd740";
  const dirLabel = isLong ? "做多" : isShort ? "做空" : "觀望";
  const DirIcon = isLong ? TrendingUp : isShort ? TrendingDown : Minus;

  return (
    <div className="space-y-4">
      {/* 標題 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#ffd740]" />
          <span className="text-sm font-bold text-[#ccc]">組合策略即時信號</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-[#666] cursor-pointer">
            <input
              type="checkbox"
              checked={useTripleMtf}
              onChange={e => setUseTripleMtf(e.target.checked)}
              className="w-3 h-3"
            />
            方案A MTF
          </label>
        </div>
      </div>

      {/* 推薦組合選擇 */}
      <div className="space-y-2">
        <div className="text-[10px] text-[#555] uppercase tracking-wider">推薦組合（已對齊最新 CannonBall 結構確認）</div>
        <div className="grid grid-cols-2 gap-2">
          {RECOMMENDED_COMBOS.map((combo, idx) => (
            <button
              key={idx}
              onClick={() => { setSelectedCombo(idx); setUseCustom(false); }}
              className="rounded-lg p-2.5 text-left transition-all"
              style={{
                background: !useCustom && selectedCombo === idx ? `${combo.color}15` : "#111",
                border: `1px solid ${!useCustom && selectedCombo === idx ? combo.color + "60" : "#1e1e1e"}`,
              }}
            >
              <div className="text-[11px] font-bold mb-0.5" style={{ color: !useCustom && selectedCombo === idx ? combo.color : "#888" }}>
                {combo.name}
              </div>
              <div className="text-[9px] text-[#555] leading-tight">{combo.note}</div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {combo.strategies.map(s => (
                  <span key={s} className="text-[8px] px-1 py-0.5 rounded" style={{ background: "#1a1a1a", color: "#666" }}>
                    {STRATEGY_LABELS[s]}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 自訂策略 */}
      <div className="rounded-lg p-3" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[#555] uppercase tracking-wider">自訂組合</span>
          <label className="flex items-center gap-1 text-[10px] text-[#666] cursor-pointer">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={e => setUseCustom(e.target.checked)}
              className="w-3 h-3"
            />
            啟用自訂
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_STRATEGIES.map(s => {
            const isSelected = customStrategies.includes(s);
            return (
              <button
                key={s}
                onClick={() => {
                  setUseCustom(true);
                  setCustomStrategies(prev =>
                    prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                  );
                }}
                className="text-[10px] px-2 py-1 rounded transition-all"
                style={{
                  background: isSelected ? "rgba(255,215,64,0.15)" : "#1a1a1a",
                  border: `1px solid ${isSelected ? "#ffd74060" : "#2a2a2a"}`,
                  color: isSelected ? "#ffd740" : "#666",
                }}
              >
                {STRATEGY_LABELS[s]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 執行按鈕 */}
      <button
        onClick={handleScan}
        disabled={mutation.isPending}
        className="w-full py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2"
        style={{
          background: mutation.isPending ? "#1a1a1a" : "rgba(255,215,64,0.15)",
          border: `1px solid ${mutation.isPending ? "#2a2a2a" : "#ffd74060"}`,
          color: mutation.isPending ? "#555" : "#ffd740",
        }}
      >
        {mutation.isPending ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            掃描中...（約 5-10 秒）
          </>
        ) : (
          <>
            <Zap className="w-4 h-4" />
            掃描 {activeStrategies.length} 個策略信號
          </>
        )}
      </button>

      {/* 最佳信號顯示 */}
      {bestSignal && (
        <div className="rounded-lg p-4" style={{ background: "#111", border: `1px solid ${dirColor}40` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-[#ffd740]" />
              <span className="text-xs font-bold text-[#ccc]">最佳信號</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded font-bold"
                style={{ background: `${dirColor}20`, color: dirColor, border: `1px solid ${dirColor}40` }}>
                {STRATEGY_LABELS[bestSignal.strategy as Strategy] ?? bestSignal.strategy}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded"
                style={{ background: "#1a1a1a", color: "#888" }}>
                {bestSignal.mtf_type === "triple" ? "三層MTF" : "雙層MTF"}
              </span>
            </div>
          </div>

          {/* 方向 */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: `${dirColor}15`, border: `1px solid ${dirColor}30` }}>
              <DirIcon className="w-5 h-5" style={{ color: dirColor }} />
            </div>
            <div>
              <div className="text-lg font-bold" style={{ color: dirColor }}>{dirLabel}</div>
              <div className="text-[10px] text-[#555]">
                評分 {bestSignal.signal_score?.toFixed(1) ?? "—"}/10 ·
                近期勝率 {bestSignal.recent_wr}% ·
                信號時間 {formatTime(bestSignal.entry_time)}
              </div>
            </div>
          </div>

          {/* 價格資訊 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded p-2.5 text-center" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
              <div className="text-[9px] text-[#555] mb-1">進場價</div>
              <div className="text-xs font-mono font-bold text-[#ccc]">{formatPrice(bestSignal.entry)}</div>
            </div>
            <div className="rounded p-2.5 text-center" style={{ background: "#161616", border: "1px solid #ef535030" }}>
              <div className="text-[9px] text-[#555] mb-1">止損</div>
              <div className="text-xs font-mono font-bold text-[#ef5350]">{formatPrice(bestSignal.sl)}</div>
            </div>
            <div className="rounded p-2.5 text-center" style={{ background: "#161616", border: "1px solid #4caf5030" }}>
              <div className="text-[9px] text-[#555] mb-1">止盈 1</div>
              <div className="text-xs font-mono font-bold text-[#4caf50]">{formatPrice(bestSignal.tp1)}</div>
            </div>
          </div>
          {bestSignal.tp2 && (
            <div className="mt-2 rounded p-2 text-center" style={{ background: "#161616", border: "1px solid #4caf5020" }}>
              <div className="text-[9px] text-[#555] mb-0.5">止盈 2（分批平倉）</div>
              <div className="text-xs font-mono font-bold text-[#81c784]">{formatPrice(bestSignal.tp2)}</div>
            </div>
          )}
        </div>
      )}

      {/* 所有活躍信號 */}
      {activeSignals.length > 1 && (
        <div className="rounded-lg overflow-hidden" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
          <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: "#1e1e1e", background: "#111" }}>
            <Activity className="w-3.5 h-3.5 text-[#4fc3f7]" />
            <span className="text-[11px] font-semibold text-[#888]">
              活躍信號（{activeSignals.length} 個）
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: "#1e1e1e" }}>
            {activeSignals.map((sig, idx) => {
              const isL = sig.signal_direction === "long";
              const isS = sig.signal_direction === "short";
              const c = isL ? "#4caf50" : isS ? "#ef5350" : "#ffd740";
              const isBest = sig === bestSignal;
              return (
                <div key={idx} className="px-3 py-2 flex items-center justify-between"
                  style={{ background: isBest ? `${c}08` : "transparent" }}>
                  <div className="flex items-center gap-2">
                    {isBest && <Star className="w-3 h-3 text-[#ffd740]" />}
                    <span className="text-[11px] font-medium" style={{ color: isBest ? "#ccc" : "#888" }}>
                      {STRATEGY_LABELS[sig.strategy as Strategy] ?? sig.strategy}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                      style={{ background: `${c}20`, color: c }}>
                      {isL ? "多" : isS ? "空" : "觀"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-[#555]">
                    <span>評分 {sig.signal_score?.toFixed(1) ?? "—"}</span>
                    <span>勝率 {sig.recent_wr}%</span>
                    <span className="font-mono text-[#666]">{formatPrice(sig.entry)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 全部策略狀態 */}
      {allSignals.length > 0 && (
        <div className="rounded-lg overflow-hidden" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
          <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: "#1e1e1e", background: "#111" }}>
            <Shield className="w-3.5 h-3.5 text-[#888]" />
            <span className="text-[11px] font-semibold text-[#888]">策略狀態總覽</span>
          </div>
          <div className="p-2 grid grid-cols-2 gap-1.5">
            {allSignals.map((sig, idx) => {
              const isL = sig.signal_direction === "long";
              const isS = sig.signal_direction === "short";
              const hasSignal = sig.signal_direction !== null;
              const c = isL ? "#4caf50" : isS ? "#ef5350" : "#555";
              return (
                <div key={idx} className="rounded p-2 flex items-center justify-between"
                  style={{ background: "#111", border: `1px solid ${hasSignal ? c + "30" : "#1e1e1e"}` }}>
                  <div>
                    <div className="text-[10px] font-medium" style={{ color: hasSignal ? "#aaa" : "#555" }}>
                      {STRATEGY_LABELS[sig.strategy as Strategy] ?? sig.strategy}
                    </div>
                    <div className="text-[9px]" style={{ color: "#555" }}>
                      {sig.total_trades} 筆 · {sig.win_rate}% 勝率
                    </div>
                  </div>
                  <div className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: `${c}20`, color: c }}>
                    {isL ? "多" : isS ? "空" : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 無信號提示 */}
      {data && !bestSignal && (
        <div className="rounded-lg p-4 text-center" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
          <Minus className="w-6 h-6 text-[#333] mx-auto mb-2" />
          <div className="text-sm text-[#555]">目前無活躍信號</div>
          <div className="text-[10px] text-[#444] mt-1">
            {allSignals.length} 個策略均無最近 8 根 K 線內的信號
          </div>
        </div>
      )}
    </div>
  );
}
