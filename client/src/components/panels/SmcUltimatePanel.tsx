/**
 * SmcUltimatePanel.tsx
 * SMC 終極確認模型面板
 * 顯示流動性清掃 → FVG 位移 → OB 回踩的三步確認交易機會
 */

interface SmcSweep {
  type: "SSL" | "BSL";
  swept_level: number;
  sweep_time: number;
  sweep_candle_idx: number;
}

interface SmcFvg {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  mid: number;
  time: number;
  filled: boolean;
  size: number;
  idx: number;
}

interface SmcOb {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  mid: number;
  time: number;
  tested: boolean;
  strength: "strong" | "normal";
  idx: number;
}

interface SmcConfirmationSetup {
  id: string;
  direction: "bullish" | "bearish";
  sweep: SmcSweep;
  fvg: SmcFvg;
  ob: SmcOb;
  confluence_score: number;
  htf_aligned: boolean;
  entry_zone: { top: number; bottom: number };
  sl: number;
  tp1: number;
  tp2: number;
  rr_ratio: number;
  status: "active" | "waiting" | "completed";
  formed_at: number;
}

interface AdvancedData {
  smc_confirmations?: SmcConfirmationSetup[];
  [key: string]: unknown;
}

interface Props {
  advanced?: AdvancedData | null;
  isLoading?: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    active:    { label: "● 進場中", color: "#00e676", bg: "rgba(0,230,118,0.15)" },
    waiting:   { label: "◐ 等待", color: "#ffd740", bg: "rgba(255,215,64,0.1)" },
    completed: { label: "✓ 已完成", color: "#888", bg: "rgba(136,136,136,0.1)" },
  };
  const c = config[status] ?? config.waiting;
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
      style={{ color: c.color, background: c.bg }}
    >
      {c.label}
    </span>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "#00e676" : score >= 65 ? "#ffd740" : "#ff9800";
  return (
    <div className="flex flex-col items-center">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold"
        style={{
          background: `conic-gradient(${color} ${score * 3.6}deg, #222 0deg)`,
          boxShadow: `0 0 8px ${color}40`,
        }}
      >
        <div className="w-9 h-9 rounded-full bg-[#0d0d0d] flex items-center justify-center">
          <span style={{ color }}>{score}</span>
        </div>
      </div>
      <div className="text-[9px] text-[#555] mt-1">評分</div>
    </div>
  );
}

function SetupCard({ setup }: { setup: SmcConfirmationSetup }) {
  const isBull = setup.direction === "bullish";
  const color = isBull ? "#00e676" : "#f44336";
  const bgColor = isBull ? "rgba(0,230,118,0.04)" : "rgba(244,67,54,0.04)";
  const borderColor = isBull ? "rgba(0,230,118,0.2)" : "rgba(244,67,54,0.2)";

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color }}>
              {isBull ? "↑ 看多確認模型" : "↓ 看空確認模型"}
            </span>
            <StatusBadge status={setup.status} />
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#666]">
            {setup.htf_aligned && (
              <span className="text-[#4fc3f7]">✓ 高時框對齊</span>
            )}
            <span>RR: 1:{setup.rr_ratio}</span>
          </div>
        </div>
        <ScoreRing score={setup.confluence_score} />
      </div>

      {/* 3-step confirmation */}
      <div className="space-y-2">
        <div className="text-[10px] text-[#666] font-semibold">三步確認流程</div>

        {/* Step 1: Sweep — 加入清掃品質評估 */}
        <div className="flex items-start gap-2 rounded p-2" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
          <div className="w-5 h-5 rounded-full bg-[#f44336]/20 text-[#f44336] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
            1
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-[#ccc]">
              流動性清掃 ({setup.sweep.type})
            </div>
            <div className="text-[10px] text-[#777] mt-0.5">
              清掃 {setup.sweep.type === "SSL" ? "賣方止損流動性（SSL）" : "買方止損流動性（BSL）"} @ {setup.sweep.swept_level.toFixed(2)}
            </div>
            <div className="text-[9px] mt-1" style={{ color: setup.ob.tested ? "#ffd740" : "#00e676" }}>
              {setup.ob.tested
                ? "⚠️ OB 已測試 — 注意 Inducement 風險"
                : "✓ OB 未測試 — 清掃品質良好"}
            </div>
          </div>
          <span className="text-[10px] text-[#00e676] flex-shrink-0">✓</span>
        </div>

        {/* Step 2: FVG */}
        <div className="flex items-start gap-2 rounded p-2" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
          <div className="w-5 h-5 rounded-full bg-[#ffd740]/20 text-[#ffd740] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
            2
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-[#ccc]">
              FVG 位移 ({setup.fvg.type === "bullish" ? "看多" : "看空"})
            </div>
            <div className="text-[10px] text-[#777] mt-0.5">
              {setup.fvg.bottom.toFixed(2)} – {setup.fvg.top.toFixed(2)}
              {setup.fvg.filled && " (已填補)"}
              {!setup.fvg.filled && ` (大小 ${(setup.fvg.size * 100).toFixed(2)}%)`}
            </div>
          </div>
          <span className="text-[10px] text-[#00e676] flex-shrink-0">✓</span>
        </div>

        {/* Step 3: OB */}
        <div className="flex items-start gap-2 rounded p-2" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
          <div
            className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{
              background: setup.ob.tested ? "rgba(0,230,118,0.2)" : "rgba(79,195,247,0.2)",
              color: setup.ob.tested ? "#00e676" : "#4fc3f7",
            }}
          >
            3
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-[#ccc]">
              OB 回踩 ({setup.ob.strength === "strong" ? "強" : "普通"} OB)
            </div>
            <div className="text-[10px] text-[#777] mt-0.5">
              {setup.ob.bottom.toFixed(2)} – {setup.ob.top.toFixed(2)}
              {setup.ob.tested ? " ✓ 已測試" : " ◐ 等待回踩"}
            </div>
          </div>
          <span className={`text-[10px] flex-shrink-0 ${setup.ob.tested ? "text-[#00e676]" : "text-[#ffd740]"}`}>
            {setup.ob.tested ? "✓" : "◐"}
          </span>
        </div>
      </div>

      {/* Inducement 風險提示 */}
      {setup.ob.tested && (
        <div className="rounded p-2" style={{ background: "rgba(255,215,64,0.05)", border: "1px solid rgba(255,215,64,0.2)" }}>
          <div className="text-[10px] text-[#ffd740] font-semibold">⚠️ LIT Inducement 注意</div>
          <div className="text-[9px] text-[#888] mt-0.5">
            此 OB 已被測試，強度降低。根據 Waqar Asim LIT 理論，已測試的 OB 可能是機構誘騙散戶的 Inducement 陷阱。建議搭配更高時間框架確認後再入場。
          </div>
        </div>
      )}

      {/* Entry zone */}
      <div className="rounded-lg p-3" style={{ background: "#0a0a0a", border: "1px solid #1a1a1a" }}>
        <div className="text-[10px] text-[#666] mb-2 font-semibold">進場參數</div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div>
            <div className="text-[#555]">進場區間</div>
            <div className="text-[#ccc] font-mono">
              {setup.entry_zone.bottom.toFixed(2)} – {setup.entry_zone.top.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[#f44336]/70">止損</div>
            <div className="text-[#f44336] font-mono">{setup.sl.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[#00e676]/70">目標 1</div>
            <div className="text-[#00e676] font-mono">{setup.tp1.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[#4fc3f7]/70">目標 2</div>
            <div className="text-[#4fc3f7] font-mono">{setup.tp2.toFixed(2)}</div>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-[#1a1a1a] flex items-center justify-between">
          <span className="text-[10px] text-[#555]">風報比</span>
          <span className="text-xs font-bold text-[#ffd740]">1:{setup.rr_ratio}</span>
        </div>
      </div>
    </div>
  );
}

export function SmcUltimatePanel({ advanced, isLoading }: Props) {
  const setups = (advanced?.smc_confirmations ?? []) as SmcConfirmationSetup[];
  const activeSetups = setups.filter(s => s.status === "active");
  const waitingSetups = setups.filter(s => s.status === "waiting");

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => (
          <div key={i} className="h-64 rounded-lg bg-[#1a1a1a] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!advanced) {
    return (
      <div className="text-center py-12 text-[#555] text-sm">
        請先選擇幣種並執行分析
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Theory — 強化版：加入 LIT Inducement 概念 */}
      <div className="rounded-lg p-3 text-xs text-[#777]" style={{ background: "#111", border: "1px solid #222" }}>
        <div className="font-semibold text-[#999] mb-2">📖 SMC 終極確認模型（三步法）+ LIT Inducement 理論</div>
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <span className="text-[#f44336] font-bold flex-shrink-0">1.</span>
            <span><span className="text-[#ccc]">流動性清掃（Liquidity Sweep）</span>：價格突破近期高/低點，清掃止損訂單（SSL/BSL）。<span className="text-[#ffd740]">關鍵：需區分「真實清掃」vs「誘騙清掃（Inducement）」</span></span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#ffd740] font-bold flex-shrink-0">2.</span>
            <span><span className="text-[#ccc]">位移 + FVG</span>：清掃後強勢反轉，留下公平價值缺口（Fair Value Gap），確認機構真實參與</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#4fc3f7] font-bold flex-shrink-0">3.</span>
            <span><span className="text-[#ccc]">OB 回踩</span>：價格回踩訂單塊（Order Block）+ FVG 重疊區。<span className="text-[#ffd740]">注意：已被多次測試的 OB 強度降低，可能是 Inducement 陷阱</span></span>
          </div>
          <div className="mt-1 pt-1.5 border-t border-[#1e1e1e] text-[#555]">
            <span className="text-[#888]">LIT 核心（Waqar Asim）：</span>機構常製造「看起來完美的 OB」誘騙散戶，真實清掃 = 乾淨的 SSL/BSL 獵取 + 未測試 OB + 隨後出現 CHoCH
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg p-3 text-center" style={{ background: "rgba(0,230,118,0.05)", border: "1px solid rgba(0,230,118,0.2)" }}>
          <div className="text-xl font-bold text-[#00e676]">{activeSetups.length}</div>
          <div className="text-xs text-[#888] mt-1">進場中機會</div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "rgba(255,215,64,0.05)", border: "1px solid rgba(255,215,64,0.2)" }}>
          <div className="text-xl font-bold text-[#ffd740]">{waitingSetups.length}</div>
          <div className="text-xs text-[#888] mt-1">等待回踩</div>
        </div>
      </div>

      {/* Setups */}
      {setups.length === 0 ? (
        <div className="text-center py-8 text-[#555] text-sm">
          <div className="text-3xl mb-2">🎯</div>
          <div>目前無完整的三步確認機會</div>
          <div className="text-xs mt-1 text-[#444]">等待流動性清掃 → FVG → OB 三步依序完成</div>
        </div>
      ) : (
        <div className="space-y-3">
          {activeSetups.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-[#00e676] mb-2">● 進場中機會</div>
              {activeSetups.map(s => <SetupCard key={s.id} setup={s} />)}
            </div>
          )}
          {waitingSetups.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-[#ffd740] mb-2">◐ 等待回踩</div>
              {waitingSetups.map(s => <SetupCard key={s.id} setup={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
