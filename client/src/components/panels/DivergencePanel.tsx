/**
 * DivergencePanel.tsx
 * 顯示 RSI/MACD 頂底背離與隱藏背離信號
 */
import { useMemo } from "react";

interface PaDivergence {
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

interface AdvancedData {
  divergences_4h?: PaDivergence[];
  divergences_1h?: PaDivergence[];
  [key: string]: unknown;
}

interface Props {
  advanced?: AdvancedData | null;
  isLoading?: boolean;
}

function StrengthBadge({ strength }: { strength: string }) {
  const colors: Record<string, string> = {
    strong: "bg-[#f44336]/20 text-[#f44336] border border-[#f44336]/30",
    medium: "bg-[#ff9800]/20 text-[#ff9800] border border-[#ff9800]/30",
    weak:   "bg-[#888]/20 text-[#888] border border-[#888]/30",
  };
  const labels: Record<string, string> = { strong: "強", medium: "中", weak: "弱" };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[strength] ?? colors.weak}`}>
      {labels[strength] ?? strength}
    </span>
  );
}

function DivergenceCard({ div }: { div: PaDivergence }) {
  const isBullish = div.type.includes("bullish");
  const isHidden = div.type.includes("hidden");
  const color = isBullish ? "#00e676" : "#f44336";
  const bgColor = isBullish ? "rgba(0,230,118,0.05)" : "rgba(244,67,54,0.05)";
  const borderColor = isBullish ? "rgba(0,230,118,0.2)" : "rgba(244,67,54,0.2)";
  const icon = isBullish ? "↑" : "↓";
  const typeLabel = isHidden ? "隱藏" : "常規";
  const dirLabel = isBullish ? "底背離" : "頂背離";
  const indicatorLabel = div.indicator.toUpperCase();

  const priceLabel = isBullish
    ? `${div.price_low1?.toFixed(2)} → ${div.price_low2?.toFixed(2)}`
    : `${div.price_high1?.toFixed(2)} → ${div.price_high2?.toFixed(2)}`;

  const indicatorLabel2 = `${div.indicator_val1.toFixed(div.indicator === "rsi" ? 1 : 5)} → ${div.indicator_val2.toFixed(div.indicator === "rsi" ? 1 : 5)}`;

  return (
    <div
      className="rounded-lg p-3 space-y-2"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold" style={{ color }}>{icon}</span>
          <span className="text-xs font-semibold" style={{ color }}>
            {typeLabel}{dirLabel}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e1e1e] text-[#888]">
            {indicatorLabel}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e1e1e] text-[#888]">
            {div.timeframe}
          </span>
        </div>
        <StrengthBadge strength={div.strength} />
      </div>

      <p className="text-xs text-[#bbb] leading-relaxed">{div.description}</p>

      <div className="flex gap-4 text-[10px] text-[#666]">
        <span>價格：{priceLabel}</span>
        <span>{indicatorLabel}：{indicatorLabel2}</span>
      </div>

      {isHidden && (
        <div className="text-[10px] text-[#888] bg-[#1a1a1a] rounded px-2 py-1">
          💡 隱藏背離代表趨勢延續，而非反轉。{isBullish ? "上漲" : "下跌"}趨勢中的回調機會。
        </div>
      )}
    </div>
  );
}

export function DivergencePanel({ advanced, isLoading }: Props) {
  const allDivergences = useMemo(() => {
    const d4h = advanced?.divergences_4h ?? [];
    const d1h = advanced?.divergences_1h ?? [];
    return [...d4h, ...d1h].sort((a, b) => {
      const strengthOrder = { strong: 0, medium: 1, weak: 2 };
      return (strengthOrder[a.strength] ?? 2) - (strengthOrder[b.strength] ?? 2);
    });
  }, [advanced]);

  const bullish = allDivergences.filter(d => d.type.includes("bullish"));
  const bearish = allDivergences.filter(d => d.type.includes("bearish"));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 rounded-lg bg-[#1a1a1a] animate-pulse" />
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
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg p-3 text-center" style={{ background: "rgba(0,230,118,0.05)", border: "1px solid rgba(0,230,118,0.2)" }}>
          <div className="text-2xl font-bold text-[#00e676]">{bullish.length}</div>
          <div className="text-xs text-[#888] mt-1">底背離信號</div>
          <div className="text-[10px] text-[#555] mt-0.5">
            強：{bullish.filter(d => d.strength === "strong").length} ｜
            中：{bullish.filter(d => d.strength === "medium").length}
          </div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "rgba(244,67,54,0.05)", border: "1px solid rgba(244,67,54,0.2)" }}>
          <div className="text-2xl font-bold text-[#f44336]">{bearish.length}</div>
          <div className="text-xs text-[#888] mt-1">頂背離信號</div>
          <div className="text-[10px] text-[#555] mt-0.5">
            強：{bearish.filter(d => d.strength === "strong").length} ｜
            中：{bearish.filter(d => d.strength === "medium").length}
          </div>
        </div>
      </div>

      {/* Theory explanation */}
      <div className="rounded-lg p-3 text-xs text-[#777]" style={{ background: "#111", border: "1px solid #222" }}>
        <div className="font-semibold text-[#999] mb-1">📖 背離理論說明</div>
        <div className="space-y-1">
          <div><span className="text-[#00e676]">常規底背離</span>：價格創新低，RSI/MACD 未跟隨 → 趨勢反轉向上</div>
          <div><span className="text-[#f44336]">常規頂背離</span>：價格創新高，RSI/MACD 未跟隨 → 趨勢反轉向下</div>
          <div><span className="text-[#4fc3f7]">隱藏底背離</span>：價格高低點，RSI 低低點 → 上漲趨勢延續</div>
          <div><span className="text-[#ff8a65]">隱藏頂背離</span>：價格低高點，RSI 高高點 → 下跌趨勢延續</div>
        </div>
      </div>

      {/* Divergence list */}
      {allDivergences.length === 0 ? (
        <div className="text-center py-8 text-[#555] text-sm">
          <div className="text-3xl mb-2">🔍</div>
          <div>目前無明顯背離信號</div>
          <div className="text-xs mt-1 text-[#444]">市場動能與價格方向一致</div>
        </div>
      ) : (
        <div className="space-y-3">
          {bullish.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-[#00e676] mb-2 flex items-center gap-1">
                <span>↑</span> 看多背離信號 ({bullish.length})
              </div>
              <div className="space-y-2">
                {bullish.map((div, i) => <DivergenceCard key={i} div={div} />)}
              </div>
            </div>
          )}
          {bearish.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-[#f44336] mb-2 flex items-center gap-1">
                <span>↓</span> 看空背離信號 ({bearish.length})
              </div>
              <div className="space-y-2">
                {bearish.map((div, i) => <DivergenceCard key={i} div={div} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
