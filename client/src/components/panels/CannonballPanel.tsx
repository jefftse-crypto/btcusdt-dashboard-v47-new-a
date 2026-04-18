/**
 * CannonballPanel v2.0 — CannonBall 交易方法實時分析面板
 *
 * v2.0 新增：
 *  - 策略參數調整 UI（SL 倍數、TP2 倍數、Confluence 閾值、Avoid Extremes 閾值）
 *  - HTF/LTF 時間框架選擇（1H/2H/4H + 15m/30m/1H）
 *  - 內嵌仓位計算器（資金、風險比例 → 仓位大小、止損金額）
 *  - 參數持久化（localStorage）
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  TrendingUp, TrendingDown, Minus,
  Target, Shield, Zap,
  CheckCircle, XCircle, AlertTriangle,
  RefreshCw, ChevronDown, ChevronRight,
  Activity, Layers, ArrowUpRight, ArrowDownRight,
  BookOpen, Info, Settings, Calculator,
} from "lucide-react";

// ─── 型別 ─────────────────────────────────────────────────────────────────────
interface CannonballOB {
  top: number; bottom: number; mid: number;
  strength: "strong" | "normal"; quality: number;
  bos_confirmed: boolean; tested_count: number; in_mitigation: boolean;
}
interface CannonballStructureEvent {
  type: "BOS" | "CHoCH"; direction: "bullish" | "bearish";
  price: number; confirmed: boolean;
}
interface CannonballFilter {
  avoid_extremes: boolean; body_close_confirmed: boolean;
  confluence_score: number; money_flow_bullish: boolean;
  wick_clean: boolean; rvol: number;
}
interface CannonballChecklist {
  htf_structure_valid: boolean; price_in_ob: boolean;
  structure_event_confirmed: boolean; avoid_extremes_pass: boolean;
  confluence_pass: boolean; all_pass: boolean;
}
interface CannonballEntryPlan {
  direction: "long" | "short" | "wait";
  entry_zone_top: number; entry_zone_bottom: number;
  stop_loss: number; tp1: number; tp2: number;
  rr_ratio: number; sl_basis: string; tp_basis: string;
}
interface CannonballAnalysis {
  symbol: string; generated_at: string; current_price: number; atr_2h: number;
  htf_tf: string; ltf_tf: string; params_used: Record<string, unknown>;
  htf_structure: {
    direction: "bullish" | "bearish" | "ranging";
    last_event: CannonballStructureEvent | null;
    recent_hh: number | null; recent_ll: number | null;
    recent_hl: number | null; recent_lh: number | null;
    bull_obs: CannonballOB[]; bear_obs: CannonballOB[];
    nearest_bull_ob: CannonballOB | null; nearest_bear_ob: CannonballOB | null;
  };
  ltf_structure: {
    direction: "bullish" | "bearish" | "ranging";
    last_event: CannonballStructureEvent | null;
    recent_events: CannonballStructureEvent[];
    bull_obs: CannonballOB[]; bear_obs: CannonballOB[];
    nearest_bull_ob: CannonballOB | null; nearest_bear_ob: CannonballOB | null;
  };
  filters: CannonballFilter; checklist: CannonballChecklist; entry_plan: CannonballEntryPlan;
  status: "ready_long" | "ready_short" | "waiting_mitigation" | "waiting_confirmation" | "filtered_out" | "ranging";
  status_message: string; confidence: number;
}

// ─── 策略參數 ─────────────────────────────────────────────────────────────────
interface CannonballParams {
  htf_tf: string; ltf_tf: string;
  sl_atr_mult: number; tp2_atr_mult: number;
  confluence_threshold: number; avoid_extremes_atr: number;
}
const DEFAULT_PARAMS: CannonballParams = {
  htf_tf: "2H", ltf_tf: "30m",
  sl_atr_mult: 0.3, tp2_atr_mult: 2.5,
  confluence_threshold: 50, avoid_extremes_atr: 0.8,
};

function getFriendlyCannonballError(message?: string | null) {
  if (!message) return "CannonBall 分析暫時不可用，請稍後重試。";
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid arguments") || normalized.includes("kraken")) {
    return "週期資料暫時不可用，系統正改用可支援的資料重新整理。";
  }
  if (normalized.includes("timeout") || normalized.includes("network") || normalized.includes("fetch")) {
    return "資料連線暫時不穩定，請稍後重新整理。";
  }
  return "CannonBall 分析暫時不可用，請稍後重試。";
}
const STORAGE_KEY = "cannonball_params_v2";

interface Props { symbol: string; }

// ─── 小工具元件 ───────────────────────────────────────────────────────────────
function CheckItem({ pass, label, detail }: { pass: boolean; label: string; detail?: string }) {
  return (
    <div className={`flex items-start gap-2 p-2 rounded border text-xs ${pass ? "border-emerald-800/50 bg-emerald-950/30" : "border-zinc-700/50 bg-zinc-900/30"}`}>
      {pass ? <CheckCircle size={13} className="text-emerald-400 mt-0.5 shrink-0" /> : <XCircle size={13} className="text-zinc-500 mt-0.5 shrink-0" />}
      <div>
        <span className={`font-medium ${pass ? "text-emerald-300" : "text-zinc-400"}`}>{label}</span>
        {detail && <p className="text-zinc-500 mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

function OBCard({ ob, dir }: { ob: CannonballOB; dir: "bull" | "bear" }) {
  const isBull = dir === "bull";
  return (
    <div className={`p-2 rounded border text-xs ${ob.in_mitigation
      ? isBull ? "border-emerald-600 bg-emerald-900/40" : "border-rose-600 bg-rose-900/40"
      : "border-zinc-700/50 bg-zinc-900/20"}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`font-bold ${isBull ? "text-emerald-400" : "text-rose-400"}`}>
          {isBull ? "Bullish OB" : "Bearish OB"}
          {ob.strength === "strong" && <span className="ml-1 text-yellow-400">★</span>}
          {ob.in_mitigation && <span className={`ml-1 px-1 rounded text-[10px] font-bold ${isBull ? "bg-emerald-700 text-emerald-200" : "bg-rose-700 text-rose-200"}`}>回補中</span>}
        </span>
        <span className="text-zinc-400">品質 {ob.quality}</span>
      </div>
      <div className="font-mono text-zinc-300">{ob.bottom.toFixed(4)} – {ob.top.toFixed(4)}</div>
      <div className="flex gap-2 mt-1 text-zinc-500">
        {ob.bos_confirmed && <span className="text-emerald-600">BOS確認</span>}
        <span>測試 {ob.tested_count} 次</span>
      </div>
    </div>
  );
}

// ─── 主元件 ───────────────────────────────────────────────────────────────────
export function CannonballPanel({ symbol }: Props) {
  const [params, setParams] = useState<CannonballParams>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_PARAMS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_PARAMS;
  });
  const [showParams, setShowParams] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [showHtfOBs, setShowHtfOBs] = useState(true);
  const [showLtfOBs, setShowLtfOBs] = useState(true);
  const [showCalc, setShowCalc] = useState(false);
  const [capital, setCapital] = useState(() => localStorage.getItem("global_capital") ?? "10000");
  const [riskPct, setRiskPct] = useState(() => localStorage.getItem("global_risk_pct") ?? "1");

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch {}
  }, [params]);

  useEffect(() => {
    setCapital(localStorage.getItem("global_capital") ?? "10000");
    setRiskPct(localStorage.getItem("global_risk_pct") ?? "1");
  }, [symbol]);

  const updateParam = useCallback(<K extends keyof CannonballParams>(key: K, val: CannonballParams[K]) => {
    setParams(p => ({ ...p, [key]: val }));
  }, []);

  const { data, isLoading, error, refetch, isFetching } = trpc.cannonball.analyze.useQuery(
    { symbol, ...params },
    { refetchInterval: 60_000, staleTime: 55_000 }
  );
  const analysis = data as CannonballAnalysis | undefined;

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-zinc-700" />
            <div className="w-40 h-5 rounded bg-zinc-700" />
          </div>
          <div className="flex gap-1">
            <div className="w-8 h-8 rounded bg-zinc-800" />
            <div className="w-8 h-8 rounded bg-zinc-800" />
          </div>
        </div>
        <div className="w-full h-20 rounded-xl bg-zinc-800" />
        <div className="grid grid-cols-3 gap-3">
          {[0,1,2].map(i => <div key={i} className="h-14 rounded-lg bg-zinc-800" />)}
        </div>
        {[0,1,2,3].map(i => (
          <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-3">
            <div className="w-32 h-4 rounded bg-zinc-700" />
            <div className="w-full h-3 rounded bg-zinc-800" />
            <div className="w-4/5 h-3 rounded bg-zinc-800" />
          </div>
        ))}
        <div className="flex items-center justify-center gap-2 text-zinc-500 text-xs pt-2">
          <RefreshCw size={12} className="animate-spin" />
          <span>抓取 {params.htf_tf} + {params.ltf_tf} K 線並計算結構...</span>
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-rose-400">
        <AlertTriangle size={24} />
        <p className="text-sm">{getFriendlyCannonballError(error?.message)}</p>
        <p className="text-xs text-zinc-500">如剛調整參數或資料節點波動，稍後重試即可。</p>
        <button onClick={() => refetch()} className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded text-xs hover:bg-zinc-700">重試</button>
      </div>
    );
  }

  const { htf_structure: htf, ltf_structure: ltf, filters, checklist, entry_plan: ep } = analysis;
  const htfDir = htf.direction;
  const ltfDir = ltf.direction;

  // 仓位計算
  const cap = parseFloat(capital) || 0;
  const risk = parseFloat(riskPct) || 1;
  const riskAmt = cap * risk / 100;
  let positionSize = 0, leveragedSize = 0, slPct = 0;
  if (ep.direction !== "wait" && ep.stop_loss > 0 && analysis.current_price > 0) {
    slPct = Math.abs(analysis.current_price - ep.stop_loss) / analysis.current_price * 100;
    positionSize = slPct > 0 ? riskAmt / (slPct / 100) : 0;
    leveragedSize = positionSize / analysis.current_price;
  }

  const statusConfig = {
    ready_long:           { cls: "border-emerald-700/60 bg-emerald-950/40 text-emerald-300", icon: <TrendingUp size={15} />, label: "可做多 ✓" },
    ready_short:          { cls: "border-rose-700/60 bg-rose-950/40 text-rose-300",          icon: <TrendingDown size={15} />, label: "可做空 ✓" },
    waiting_mitigation:   { cls: "border-sky-700/40 bg-sky-950/30 text-sky-300",             icon: <Activity size={15} />, label: "等待回補 OB" },
    waiting_confirmation: { cls: "border-amber-700/40 bg-amber-950/30 text-amber-300",       icon: <Zap size={15} />, label: "等待收盤確認" },
    filtered_out:         { cls: "border-zinc-600/40 bg-zinc-800/40 text-zinc-400",          icon: <Shield size={15} />, label: "過濾器攔截" },
    ranging:              { cls: "border-zinc-700/40 bg-zinc-800/30 text-zinc-500",           icon: <Minus size={15} />, label: "震盪等待" },
  }[analysis.status] ?? { cls: "border-zinc-700/40 bg-zinc-800/30 text-zinc-500", icon: <Minus size={15} />, label: "等待" };

  return (
    <div className="space-y-4 p-4">
      {/* ── 頂部標題列 ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Target size={18} className="text-amber-400" />
          <h2 className="text-base font-bold text-white">CannonBall 分析</h2>
          <span className="text-xs text-zinc-500 font-mono">{analysis.symbol}</span>
          <span className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">
            {analysis.htf_tf}/{analysis.ltf_tf}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowParams(v => !v)}
            className={`p-1.5 rounded transition-colors ${showParams ? "bg-amber-900/60 text-amber-400" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
            title="策略參數設定"
          >
            <Settings size={14} />
          </button>
          <button onClick={() => refetch()} disabled={isFetching}
            className="p-1.5 bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded" title="刷新">
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── 策略參數面板 ── */}
      {showParams && (
        <div className="bg-zinc-900/80 border border-amber-800/40 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5"><Settings size={12} /> 策略參數設定</span>
            <button onClick={() => setParams(DEFAULT_PARAMS)} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline">重置預設</button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">HTF 大結構時間框架</label>
              <div className="flex gap-1">
                {["1H","2H","4H"].map(tf => (
                  <button key={tf} onClick={() => updateParam("htf_tf", tf)}
                    className={`flex-1 py-1 text-xs rounded font-mono ${params.htf_tf === tf ? "bg-amber-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">LTF 執行層時間框架</label>
              <div className="flex gap-1">
                {["15m","30m","1H"].map(tf => (
                  <button key={tf} onClick={() => updateParam("ltf_tf", tf)}
                    className={`flex-1 py-1 text-xs rounded font-mono ${params.ltf_tf === tf ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">
                止損 ATR 倍數：<span className="text-amber-400 font-mono">{params.sl_atr_mult}x</span>
              </label>
              <input type="range" min="0.1" max="0.8" step="0.1" value={params.sl_atr_mult}
                onChange={e => updateParam("sl_atr_mult", parseFloat(e.target.value))}
                className="w-full accent-amber-500" />
              <div className="flex justify-between text-[9px] text-zinc-600"><span>0.1（緊）</span><span>0.8（寬）</span></div>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">
                TP2 ATR 倍數：<span className="text-emerald-400 font-mono">{params.tp2_atr_mult}x</span>
              </label>
              <input type="range" min="1.0" max="4.0" step="0.5" value={params.tp2_atr_mult}
                onChange={e => updateParam("tp2_atr_mult", parseFloat(e.target.value))}
                className="w-full accent-emerald-500" />
              <div className="flex justify-between text-[9px] text-zinc-600"><span>1.0（保守）</span><span>4.0（激進）</span></div>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">
                Confluence 閾值：<span className="text-sky-400 font-mono">{params.confluence_threshold}</span>
              </label>
              <input type="range" min="40" max="80" step="5" value={params.confluence_threshold}
                onChange={e => updateParam("confluence_threshold", parseInt(e.target.value))}
                className="w-full accent-sky-500" />
              <div className="flex justify-between text-[9px] text-zinc-600"><span>40（寬鬆）</span><span>80（嚴格）</span></div>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">
                Avoid Extremes ATR：<span className="text-purple-400 font-mono">{params.avoid_extremes_atr}x</span>
              </label>
              <input type="range" min="0.3" max="1.5" step="0.1" value={params.avoid_extremes_atr}
                onChange={e => updateParam("avoid_extremes_atr", parseFloat(e.target.value))}
                className="w-full accent-purple-500" />
              <div className="flex justify-between text-[9px] text-zinc-600"><span>0.3（寬）</span><span>1.5（嚴）</span></div>
            </div>
          </div>

          <div className="flex items-start gap-1.5 bg-zinc-800/50 rounded p-2">
            <Info size={11} className="text-zinc-500 mt-0.5 shrink-0" />
            <p className="text-[10px] text-zinc-500">參數修改後將自動重新分析，並儲存至本地。不同幣種建議使用不同參數組合。</p>
          </div>
        </div>
      )}

      {/* ── 狀態橫幅 ── */}
      <div className={`rounded-xl border p-3 ${statusConfig.cls}`}>
        <div className="flex items-center gap-2 mb-1.5">
          {statusConfig.icon}
          <span className="font-bold text-sm">{statusConfig.label}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${analysis.confidence >= 70 ? "bg-emerald-500" : analysis.confidence >= 45 ? "bg-amber-500" : "bg-zinc-600"}`}
                style={{ width: `${analysis.confidence}%` }} />
            </div>
            <span className="text-xs font-bold opacity-80">{analysis.confidence}%</span>
          </div>
        </div>
        <p className="text-xs opacity-80 leading-relaxed">{analysis.status_message}</p>
      </div>

      {/* ── 快速信息欄 ── */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-900/60 border border-zinc-700/40 rounded-lg p-2.5 text-center">
          <div className="text-[10px] text-zinc-500 mb-1">當前價格</div>
          <div className="font-mono font-bold text-white text-sm">{analysis.current_price.toFixed(2)}</div>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-700/40 rounded-lg p-2.5 text-center">
          <div className="text-[10px] text-zinc-500 mb-1">{analysis.htf_tf} ATR</div>
          <div className="font-mono font-bold text-amber-400 text-sm">{analysis.atr_2h.toFixed(2)}</div>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-700/40 rounded-lg p-2.5 text-center">
          <div className="text-[10px] text-zinc-500 mb-1">Confluence</div>
          <div className={`font-mono font-bold text-sm ${filters.confluence_score >= params.confluence_threshold ? "text-emerald-400" : "text-zinc-400"}`}>
            {filters.confluence_score}/100
          </div>
        </div>
      </div>

      {/* ── 進場檢查清單 ── */}
      <div className="bg-zinc-900/40 border border-zinc-700/40 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle size={14} className={checklist.all_pass ? "text-emerald-400" : "text-zinc-500"} />
          <h3 className="text-sm font-bold text-zinc-200">進場檢查清單</h3>
          <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${checklist.all_pass ? "bg-emerald-900 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
            {[checklist.htf_structure_valid, checklist.price_in_ob, checklist.structure_event_confirmed, checklist.avoid_extremes_pass, checklist.confluence_pass].filter(Boolean).length}/5
          </span>
        </div>
        <div className="space-y-1.5 text-xs">
          <CheckItem pass={checklist.htf_structure_valid} label={`${analysis.htf_tf} 結構有明確方向`} detail={htfDir === "ranging" ? "目前震盪，等待選擇方向" : `${htfDir === "bullish" ? "看多" : "看空"}結構確立`} />
          <CheckItem pass={checklist.price_in_ob} label="價格回補至有效 OB" detail={checklist.price_in_ob ? "已進入 OB 回補區域" : "等待價格回調至 OB 區域"} />
          <CheckItem pass={checklist.structure_event_confirmed} label={`${analysis.ltf_tf} 收盤確認 CHoCH/BOS`} detail={checklist.structure_event_confirmed ? "已出現收盤確認的結構事件" : "等待執行層結構確認"} />
          <CheckItem pass={checklist.avoid_extremes_pass} label={`Avoid Extremes（> ${params.avoid_extremes_atr} ATR）`} detail={checklist.avoid_extremes_pass ? "距離前高/低足夠" : "當前位置過於接近前高/低"} />
          <CheckItem pass={checklist.confluence_pass} label={`Confluence ≥ ${params.confluence_threshold}`} detail={`當前 ${filters.confluence_score}/100，RVOL: ${filters.rvol}x`} />
        </div>
      </div>

      {/* ── HTF 大結構 ── */}
      <div className="bg-zinc-900/40 border border-zinc-700/40 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-3">
          <Layers size={14} className="text-sky-400" />
          <h3 className="text-sm font-bold text-zinc-200">{analysis.htf_tf} 大結構</h3>
          <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded ${htfDir === "bullish" ? "bg-emerald-900/60 text-emerald-300" : htfDir === "bearish" ? "bg-rose-900/60 text-rose-300" : "bg-zinc-800 text-zinc-400"}`}>
            {htfDir === "bullish" ? "↑ 看多" : htfDir === "bearish" ? "↓ 看空" : "— 震盪"}
          </span>
        </div>
        {htf.last_event && (
          <div className="text-xs text-zinc-500 mb-2">
            最近事件：<span className={htf.last_event.direction === "bullish" ? "text-emerald-400" : "text-rose-400"}>{htf.last_event.type}</span>
            {" @ "}<span className="font-mono text-zinc-300">{htf.last_event.price.toFixed(4)}</span>
            {htf.last_event.confirmed && <span className="ml-1 text-emerald-500 text-[10px]">✓ 收盤確認</span>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
          {htf.recent_hh && <div className="bg-emerald-950/30 rounded p-1.5"><span className="text-zinc-500">HH </span><span className="font-mono text-emerald-400">{htf.recent_hh.toFixed(4)}</span></div>}
          {htf.recent_hl && <div className="bg-emerald-950/30 rounded p-1.5"><span className="text-zinc-500">HL </span><span className="font-mono text-emerald-400">{htf.recent_hl.toFixed(4)}</span></div>}
          {htf.recent_lh && <div className="bg-rose-950/30 rounded p-1.5"><span className="text-zinc-500">LH </span><span className="font-mono text-rose-400">{htf.recent_lh.toFixed(4)}</span></div>}
          {htf.recent_ll && <div className="bg-rose-950/30 rounded p-1.5"><span className="text-zinc-500">LL </span><span className="font-mono text-rose-400">{htf.recent_ll.toFixed(4)}</span></div>}
        </div>
        <button onClick={() => setShowHtfOBs(v => !v)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mb-2">
          {showHtfOBs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Order Blocks（{htfDir === "bullish" ? htf.bull_obs.length : htf.bear_obs.length} 個）
        </button>
        {showHtfOBs && (
          <div className="space-y-1.5">
            {(htfDir === "bullish" ? htf.bull_obs : htf.bear_obs).map((ob, i) => (
              <OBCard key={i} ob={ob} dir={htfDir === "bullish" ? "bull" : "bear"} />
            ))}
            {(htfDir === "bullish" ? htf.bull_obs : htf.bear_obs).length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-2">暫無有效 OB</p>
            )}
          </div>
        )}
      </div>

      {/* ── LTF 執行層 ── */}
      <div className="bg-zinc-900/40 border border-zinc-700/40 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-amber-400" />
          <h3 className="text-sm font-bold text-zinc-200">{analysis.ltf_tf} 執行層</h3>
          <span className={`ml-auto text-xs font-bold ${ltfDir === "bullish" ? "text-emerald-400" : ltfDir === "bearish" ? "text-rose-400" : "text-zinc-500"}`}>
            {ltfDir === "bullish" ? "↑ 看多" : ltfDir === "bearish" ? "↓ 看空" : "— 震盪"}
          </span>
        </div>
        {ltf.recent_events.length > 0 && (
          <div className="space-y-1 mb-3">
            {ltf.recent_events.slice(-5).reverse().map((ev, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`font-bold ${ev.direction === "bullish" ? "text-emerald-400" : "text-rose-400"}`}>{ev.type}</span>
                <span className="text-zinc-500">{ev.direction === "bullish" ? "看多" : "看空"}</span>
                <span className="font-mono text-zinc-400">@ {ev.price.toFixed(4)}</span>
                {ev.confirmed && <span className="text-emerald-500 text-[10px]">✓</span>}
              </div>
            ))}
          </div>
        )}
        <button onClick={() => setShowLtfOBs(v => !v)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mb-2">
          {showLtfOBs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Order Blocks（{ltfDir === "bullish" ? ltf.bull_obs.length : ltf.bear_obs.length} 個）
        </button>
        {showLtfOBs && (
          <div className="space-y-1.5">
            {(ltfDir === "bullish" ? ltf.bull_obs : ltf.bear_obs).map((ob, i) => (
              <OBCard key={i} ob={ob} dir={ltfDir === "bullish" ? "bull" : "bear"} />
            ))}
            {(ltfDir === "bullish" ? ltf.bull_obs : ltf.bear_obs).length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-2">暫無有效 OB</p>
            )}
          </div>
        )}
      </div>

      {/* ── 過濾器狀態 ── */}
      <div className="bg-zinc-900/40 border border-zinc-700/40 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-3">
          <Shield size={14} className="text-purple-400" />
          <h3 className="text-sm font-bold text-zinc-200">過濾器狀態</h3>
          <span className="ml-auto text-xs text-zinc-500">RVOL {filters.rvol}x</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {[
            { pass: filters.avoid_extremes, label: "Avoid Extremes" },
            { pass: filters.body_close_confirmed, label: "Body Close 確認" },
            { pass: filters.wick_clean, label: "Wick Clean（實體 > 50%）" },
            { pass: filters.money_flow_bullish === (htfDir === "bullish"), label: `Money Flow（RVOL ${filters.rvol}x）` },
            { pass: filters.confluence_score >= params.confluence_threshold, label: `Confluence ≥ ${params.confluence_threshold}` },
          ].map((f, i) => (
            <div key={i} className={`flex items-center gap-1.5 px-2 py-1.5 rounded ${f.pass ? "bg-emerald-950/40 text-emerald-300" : "bg-zinc-800/60 text-zinc-500"}`}>
              {f.pass ? <CheckCircle size={11} /> : <XCircle size={11} />}
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 進場計劃 ── */}
      {ep.direction !== "wait" ? (
        <div className={`rounded-xl border p-3 ${ep.direction === "long" ? "bg-emerald-950/30 border-emerald-800/50" : "bg-rose-950/30 border-rose-800/50"}`}>
          <div className="flex items-center gap-2 mb-3">
            <Target size={14} className={ep.direction === "long" ? "text-emerald-400" : "text-rose-400"} />
            <h3 className="text-sm font-bold text-zinc-200">進場計劃</h3>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${ep.direction === "long" ? "bg-emerald-900 text-emerald-300" : "bg-rose-900 text-rose-300"}`}>
              {ep.direction === "long" ? "做多 LONG" : "做空 SHORT"}
            </span>
            {ep.rr_ratio > 0 && (
              <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded ${ep.rr_ratio >= 2 ? "bg-emerald-900 text-emerald-300" : "bg-amber-900 text-amber-300"}`}>
                RR {ep.rr_ratio.toFixed(2)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs mb-3">
            <div className="bg-zinc-900/50 rounded p-2">
              <div className="text-zinc-500 mb-1">進場區間</div>
              <div className="font-mono font-bold text-white">{ep.entry_zone_bottom.toFixed(4)}</div>
              <div className="text-zinc-500 text-[10px]">–</div>
              <div className="font-mono font-bold text-white">{ep.entry_zone_top.toFixed(4)}</div>
            </div>
            <div className="bg-zinc-900/50 rounded p-2">
              <div className="text-zinc-500 mb-1">止損 SL</div>
              <div className="font-mono font-bold text-rose-400">{ep.stop_loss.toFixed(4)}</div>
              <div className="text-zinc-600 mt-1 text-[10px] leading-tight">{ep.sl_basis}</div>
            </div>
            <div className="bg-zinc-900/50 rounded p-2">
              <div className="text-zinc-500 mb-1">止盈 TP</div>
              <div className="font-mono font-bold text-emerald-400">TP1: {ep.tp1.toFixed(4)}</div>
              <div className="font-mono font-bold text-emerald-300">TP2: {ep.tp2.toFixed(4)}</div>
              <div className="text-zinc-600 mt-1 text-[10px] leading-tight">{ep.tp_basis}</div>
            </div>
          </div>

          {/* ── 仓位計算器 ── */}
          <div className="border-t border-zinc-700/40 pt-3">
            <button onClick={() => setShowCalc(v => !v)}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 mb-2">
              <Calculator size={12} />
              <span className="font-medium">仓位計算器</span>
              {showCalc ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
            {showCalc && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1">總資金 (USDT)</label>
                    <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                      placeholder="10000" />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1">風險比例 (%)</label>
                    <input type="number" value={riskPct} min="0.1" max="10" step="0.1" onChange={e => setRiskPct(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                      placeholder="1" />
                  </div>
                </div>
                {cap > 0 && slPct > 0 && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-zinc-800/60 rounded p-2 text-center">
                      <div className="text-zinc-500 text-[10px] mb-1">風險金額</div>
                      <div className="font-mono font-bold text-amber-400">${riskAmt.toFixed(2)}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 text-center">
                      <div className="text-zinc-500 text-[10px] mb-1">仓位 (USDT)</div>
                      <div className="font-mono font-bold text-white">${positionSize.toFixed(2)}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 text-center">
                      <div className="text-zinc-500 text-[10px] mb-1">數量</div>
                      <div className="font-mono font-bold text-sky-400">{leveragedSize.toFixed(6)}</div>
                    </div>
                  </div>
                )}
                <div className="text-[10px] text-zinc-600">
                  止損距離：{slPct.toFixed(2)}% | 進場均價：{analysis.current_price.toFixed(4)}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Target size={14} className="text-zinc-500" />
            <h3 className="text-sm font-bold text-zinc-400">進場計劃</h3>
            <span className="text-xs text-zinc-600 ml-auto">等待條件對齊</span>
          </div>
          {(htf.nearest_bull_ob || htf.nearest_bear_ob) && (
            <p className="text-xs text-zinc-500">
              參考 OB 區域：{htfDir === "bullish"
                ? htf.nearest_bull_ob ? `${htf.nearest_bull_ob.bottom.toFixed(4)} – ${htf.nearest_bull_ob.top.toFixed(4)}` : "—"
                : htf.nearest_bear_ob ? `${htf.nearest_bear_ob.bottom.toFixed(4)} – ${htf.nearest_bear_ob.top.toFixed(4)}` : "—"}
            </p>
          )}
        </div>
      )}

      {/* ── 方法論說明 ── */}
      <div className="bg-zinc-900/30 border border-zinc-700/40 rounded-lg overflow-hidden">
        <button onClick={() => setShowMethodology(v => !v)}
          className="w-full flex items-center gap-2 p-3 text-left hover:bg-zinc-800/30">
          <BookOpen size={13} className="text-amber-400" />
          <span className="text-xs font-bold text-zinc-300">CannonBall 方法論說明</span>
          {showMethodology ? <ChevronDown size={12} className="ml-auto text-zinc-500" /> : <ChevronRight size={12} className="ml-auto text-zinc-500" />}
        </button>
        {showMethodology && (
          <div className="px-4 pb-4 space-y-3 text-xs text-zinc-400">
            <div className="border-t border-zinc-700/50 pt-3">
              <p className="font-bold text-zinc-200 mb-1">核心邏輯：市場結構驅動的 OB 回補交易法</p>
              <p>CannonBall 方法以「市場結構（Market Structure）」為核心，透過多時間框架的協同分析，在高品質的 Order Block 回補點進場，並以結構止損控制風險。</p>
            </div>
            <div>
              <p className="font-bold text-zinc-200 mb-1">時間框架分工（當前設定）</p>
              <ul className="space-y-1 ml-2">
                <li><span className="text-sky-400">{params.htf_tf}（背景層）</span>：判定大方向結構（HH/HL 看多 / LL/LH 看空），標記高品質 OB</li>
                <li><span className="text-amber-400">{params.ltf_tf}（執行層）</span>：等待價格回補 OB，偵測收盤確認的 CHoCH/BOS 作為進場觸發</li>
              </ul>
            </div>
            <div>
              <p className="font-bold text-zinc-200 mb-1">五大進場條件</p>
              <ol className="space-y-1 ml-2 list-decimal list-inside">
                <li>{params.htf_tf} 結構有明確方向（非震盪）</li>
                <li>價格回補至 {params.htf_tf} 或 {params.ltf_tf} 的有效 OB</li>
                <li>{params.ltf_tf} 出現收盤確認的同向 CHoCH 或 BOS</li>
                <li>Avoid Extremes：距離 {params.htf_tf} 前高/前低 &gt; {params.avoid_extremes_atr} ATR</li>
                <li>Confluence 評分 ≥ {params.confluence_threshold}（多因子共振）</li>
              </ol>
            </div>
            <div>
              <p className="font-bold text-zinc-200 mb-1">止損與止盈</p>
              <ul className="space-y-1 ml-2">
                <li><span className="text-rose-400">止損</span>：OB 底部/頂部外側 {params.sl_atr_mult} ATR</li>
                <li><span className="text-emerald-400">止盈</span>：TP1 = 最近 {params.htf_tf} 結構目標（HH/LL），TP2 = 第二結構目標或延伸 {params.tp2_atr_mult} ATR</li>
              </ul>
            </div>
            <div className="flex items-start gap-1.5 bg-amber-950/30 border border-amber-800/50 rounded p-2">
              <Info size={12} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-amber-300/80">本面板為輔助分析工具，所有交易決策請結合個人判斷與風險管理。市場存在不確定性，過去的結構分析不代表未來表現。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
