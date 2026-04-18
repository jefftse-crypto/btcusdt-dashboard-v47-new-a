/**
 * PaLevelPanel.tsx
 * PA 形態 + 關鍵水位結合面板
 * 顯示 Pin Bar、吞沒形態等 K 線形態與 S/R 水位的共振信號
 */

interface SRLevel {
  price: number;
  type: "support" | "resistance";
  strength: number;
  touches: number;
}

interface CandlestickPattern {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  strength: "strong" | "medium" | "weak";
  desc: string;
}

interface PaPatternWithLevel {
  pattern: CandlestickPattern;
  at_key_level: boolean;
  nearest_level: SRLevel | null;
  distance_to_level_pct: number;
  liquidity_nearby: boolean;
  confluence_score: number;
  entry: number;
  sl: number;
  tp: number;
  timeframe: string;
  time: number;
}

interface AdvancedData {
  pa_patterns_4h?: PaPatternWithLevel[];
  pa_patterns_1h?: PaPatternWithLevel[];
  [key: string]: unknown;
}

interface Props {
  advanced?: AdvancedData | null;
  isLoading?: boolean;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "#00e676" : score >= 50 ? "#ffd740" : "#ff9800";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[#222]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <span className="text-[10px] font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

function PatternCard({ item }: { item: PaPatternWithLevel }) {
  const isBullish = item.pattern.type === "bullish";
  const color = isBullish ? "#00e676" : "#f44336";
  const bgColor = isBullish ? "rgba(0,230,118,0.05)" : "rgba(244,67,54,0.05)";
  const borderColor = isBullish ? "rgba(0,230,118,0.2)" : "rgba(244,67,54,0.2)";
  const rrRatio = Math.abs(item.tp - item.entry) / Math.abs(item.entry - item.sl);

  return (
    <div
      className="rounded-lg p-3 space-y-2.5"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold" style={{ color }}>
            {isBullish ? "↑" : "↓"} {item.pattern.name}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e1e1e] text-[#888]">
            {item.timeframe}
          </span>
          {item.at_key_level && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ffd740]/20 text-[#ffd740] border border-[#ffd740]/30">
              ⚡ 關鍵水位
            </span>
          )}
          {item.liquidity_nearby && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/30">
              💧 流動性
            </span>
          )}
        </div>
      </div>

      {/* Confluence score */}
      <div>
        <div className="text-[10px] text-[#666] mb-1">共振評分</div>
        <ScoreBar score={item.confluence_score} />
      </div>

      {/* Pattern description */}
      <p className="text-xs text-[#bbb]">{item.pattern.desc}</p>

      {/* Nearest level */}
      {item.nearest_level && (
        <div className="text-[10px] text-[#777] bg-[#111] rounded px-2 py-1">
          最近{item.nearest_level.type === "support" ? "支撐" : "阻力"}位：
          <span className="text-[#aaa] font-mono">{item.nearest_level.price.toFixed(2)}</span>
          （距離 {item.distance_to_level_pct.toFixed(2)}%，強度 {item.nearest_level.strength}）
        </div>
      )}

      {/* Entry params */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded p-1.5 text-center" style={{ background: "#1a1a1a" }}>
          <div className="text-[#555] mb-0.5">進場</div>
          <div className="text-[#ccc] font-mono">{item.entry.toFixed(2)}</div>
        </div>
        <div className="rounded p-1.5 text-center" style={{ background: "#1a1a1a" }}>
          <div className="text-[#f44336]/70 mb-0.5">止損</div>
          <div className="text-[#f44336] font-mono">{item.sl.toFixed(2)}</div>
        </div>
        <div className="rounded p-1.5 text-center" style={{ background: "#1a1a1a" }}>
          <div className="text-[#00e676]/70 mb-0.5">目標</div>
          <div className="text-[#00e676] font-mono">{item.tp.toFixed(2)}</div>
        </div>
      </div>
      <div className="text-[10px] text-[#666] text-right">
        風報比：<span className="text-[#ffd740] font-semibold">1:{rrRatio.toFixed(1)}</span>
      </div>
    </div>
  );
}

export function PaLevelPanel({ advanced, isLoading }: Props) {
  const allPatterns: PaPatternWithLevel[] = [
    ...(advanced?.pa_patterns_4h ?? []),
    ...(advanced?.pa_patterns_1h ?? []),
  ].sort((a, b) => b.confluence_score - a.confluence_score);

  const bullish = allPatterns.filter(p => p.pattern.type === "bullish");
  const bearish = allPatterns.filter(p => p.pattern.type === "bearish");
  const highConf = allPatterns.filter(p => p.confluence_score >= 70);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-36 rounded-lg bg-[#1a1a1a] animate-pulse" />
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
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg p-3 text-center" style={{ background: "rgba(0,230,118,0.05)", border: "1px solid rgba(0,230,118,0.2)" }}>
          <div className="text-xl font-bold text-[#00e676]">{bullish.length}</div>
          <div className="text-[10px] text-[#888] mt-1">看多形態</div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "rgba(244,67,54,0.05)", border: "1px solid rgba(244,67,54,0.2)" }}>
          <div className="text-xl font-bold text-[#f44336]">{bearish.length}</div>
          <div className="text-[10px] text-[#888] mt-1">看空形態</div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "rgba(255,215,64,0.05)", border: "1px solid rgba(255,215,64,0.2)" }}>
          <div className="text-xl font-bold text-[#ffd740]">{highConf.length}</div>
          <div className="text-[10px] text-[#888] mt-1">高共振 (≥70)</div>
        </div>
      </div>

      {/* Theory */}
      <div className="rounded-lg p-3 text-xs text-[#777]" style={{ background: "#111", border: "1px solid #222" }}>
        <div className="font-semibold text-[#999] mb-1">📖 PA 水位共振理論</div>
        <div className="space-y-0.5">
          <div>• 單純的 K 線形態勝率約 40-55%，結合關鍵水位後可提升至 65-75%</div>
          <div>• 共振評分越高（≥70），代表形態、水位、流動性三重確認</div>
          <div>• <span className="text-[#ffd740]">⚡ 關鍵水位</span>：形態出現在 S/R 水位 0.5% 以內</div>
          <div>• <span className="text-[#4fc3f7]">💧 流動性</span>：附近有流動性池，可能觸發止損獵殺</div>
        </div>
      </div>

      {/* Pattern list */}
      {allPatterns.length === 0 ? (
        <div className="text-center py-8 text-[#555] text-sm">
          <div className="text-3xl mb-2">📊</div>
          <div>目前無高共振 PA 形態</div>
          <div className="text-xs mt-1 text-[#444]">等待形態在關鍵水位附近出現</div>
        </div>
      ) : (
        <div className="space-y-3">
          {highConf.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-[#ffd740] mb-2">⚡ 高共振形態 (評分 ≥ 70)</div>
              <div className="space-y-2">
                {highConf.map((item, i) => <PatternCard key={i} item={item} />)}
              </div>
            </div>
          )}
          {allPatterns.filter(p => p.confluence_score < 70).length > 0 && (
            <div>
              <div className="text-xs font-semibold text-[#888] mb-2">其他形態</div>
              <div className="space-y-2">
                {allPatterns.filter(p => p.confluence_score < 70).map((item, i) => (
                  <PatternCard key={i} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
