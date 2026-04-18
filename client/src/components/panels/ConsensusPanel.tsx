import type { ConsensusData } from "@shared/cryptoTypes";

interface Props {
  consensus: ConsensusData | undefined;
  isLoading: boolean;
}

export function ConsensusPanel({ consensus, isLoading }: Props) {
  if (isLoading && !consensus) {
    return (
      <div className="crypto-panel">
        <div className="crypto-panel-header">共識評分</div>
        <div className="p-3 space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-4 bg-secondary/50 rounded animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!consensus) return null;

  const score = consensus.score;
  const deviation = score - 50;
  const color = score >= 60 ? "text-bull" : score <= 40 ? "text-bear" : "text-foreground";
  const bgColor = score >= 60 ? "bg-bull" : score <= 40 ? "bg-bear" : "bg-muted-foreground/50";

  return (
    <div className="crypto-panel">
      <div className="crypto-panel-header">綜合共識評分</div>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-2xl font-mono font-bold ${color}`}>
              {deviation > 0 ? "+" : ""}{deviation.toFixed(1)}
            </div>
            <div className={`text-sm font-semibold mt-0.5 ${color}`}>{consensus.label}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">原始分數</div>
            <div className="text-lg font-mono text-foreground">{score.toFixed(1)}</div>
          </div>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${bgColor}`}
            style={{ width: `${score}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>極度看空 (0)</span>
          <span>中性 (50)</span>
          <span>極度看多 (100)</span>
        </div>
      </div>
    </div>
  );
}
