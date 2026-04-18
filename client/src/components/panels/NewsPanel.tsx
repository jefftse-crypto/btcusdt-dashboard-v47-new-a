import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { ExternalLink, Search } from "lucide-react";

interface Props {
  symbol: string;
}

// ─── 情緒統計圓餅圖（SVG） ────────────────────────────────────────────────────

function SentimentPie({ bullish, bearish, neutral }: { bullish: number; bearish: number; neutral: number }) {
  const total = bullish + bearish + neutral;
  if (total === 0) return null;

  const bPct = bullish / total;
  const rPct = bearish / total;
  const nPct = neutral / total;

  // SVG donut chart
  const cx = 40, cy = 40, r = 30, inner = 18;
  function arc(startAngle: number, endAngle: number, color: string, key: string) {
    if (endAngle - startAngle < 0.01) return null;
    const s = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) };
    const e = { x: cx + r * Math.cos(endAngle), y: cy + r * Math.sin(endAngle) };
    const si = { x: cx + inner * Math.cos(startAngle), y: cy + inner * Math.sin(startAngle) };
    const ei = { x: cx + inner * Math.cos(endAngle), y: cy + inner * Math.sin(endAngle) };
    const large = endAngle - startAngle > Math.PI ? 1 : 0;
    return (
      <path
        key={key}
        d={`M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} L ${ei.x} ${ei.y} A ${inner} ${inner} 0 ${large} 0 ${si.x} ${si.y} Z`}
        fill={color}
        opacity={0.85}
      />
    );
  }

  const a0 = -Math.PI / 2;
  const a1 = a0 + bPct * 2 * Math.PI;
  const a2 = a1 + rPct * 2 * Math.PI;
  const a3 = a2 + nPct * 2 * Math.PI;

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 80 80" className="w-16 h-16 shrink-0">
        {arc(a0, a1, "#4caf50", "bull")}
        {arc(a1, a2, "#ef5350", "bear")}
        {arc(a2, a3, "#555", "neut")}
      </svg>
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-bull" />
          <span className="text-muted-foreground">看多</span>
          <span className="font-mono font-bold text-bull ml-1">{bullish}</span>
          <span className="text-muted-foreground">({Math.round(bPct * 100)}%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-bear" />
          <span className="text-muted-foreground">看空</span>
          <span className="font-mono font-bold text-bear ml-1">{bearish}</span>
          <span className="text-muted-foreground">({Math.round(rPct * 100)}%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-secondary" />
          <span className="text-muted-foreground">中性</span>
          <span className="font-mono font-bold text-muted-foreground ml-1">{neutral}</span>
          <span className="text-muted-foreground">({Math.round(nPct * 100)}%)</span>
        </div>
      </div>
    </div>
  );
}

// ─── 時間軸密度圖 ─────────────────────────────────────────────────────────────

function NewsTimeline({ pubDates }: { pubDates: number[] }) {
  // 24 buckets (1 hour each)
  const now = Date.now();
  const buckets = Array(24).fill(0);
  for (const d of pubDates) {
    const hoursAgo = Math.floor((now - d) / 3600000);
    if (hoursAgo >= 0 && hoursAgo < 24) {
      buckets[23 - hoursAgo]++;
    }
  }
  const maxCount = Math.max(...buckets, 1);

  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-1.5">過去 24 小時新聞密度</div>
      <div className="flex items-end gap-px h-8">
        {buckets.map((count, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm transition-all"
            style={{
              height: count === 0 ? "2px" : `${(count / maxCount) * 100}%`,
              background: count === 0 ? "#1e1e1e" : count >= 3 ? "#ef5350" : count >= 2 ? "#ffd740" : "#4caf50",
              opacity: count === 0 ? 0.3 : 0.8,
            }}
            title={`${23 - i}h 前: ${count} 則`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
        <span>24h 前</span>
        <span>現在</span>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const KEYWORDS = ["ETF", "監管", "升息", "SEC", "FED", "清算", "鯨魚", "機構", "halving", "黑天鵝"];

export function NewsPanel({ symbol }: Props) {
  const [keyword, setKeyword] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<"all" | "bullish" | "bearish" | "neutral">("all");

  const { data: news, isLoading } = trpc.news.getLatestNews.useQuery(
    { symbol, hours: 24 },
    { refetchInterval: 5 * 60 * 1000 }
  );

  const stats = useMemo(() => {
    if (!news) return { bullish: 0, bearish: 0, neutral: 0 };
    return {
      bullish: news.filter(n => n.sentiment === "bullish").length,
      bearish: news.filter(n => n.sentiment === "bearish").length,
      neutral: news.filter(n => n.sentiment === "neutral" || !n.sentiment).length,
    };
  }, [news]);

  const filtered = useMemo(() => {
    if (!news) return [];
    return news.filter(item => {
      const matchSentiment = sentimentFilter === "all" || item.sentiment === sentimentFilter;
      const matchKeyword = !keyword || item.title.toLowerCase().includes(keyword.toLowerCase()) || (item.description ?? "").toLowerCase().includes(keyword.toLowerCase());
      return matchSentiment && matchKeyword;
    });
  }, [news, keyword, sentimentFilter]);

  if (isLoading) {
    return (
      <div className="crypto-panel">
        <div className="crypto-panel-header">最新資訊</div>
        <div className="p-3 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-4 bg-secondary/50 rounded animate-pulse" />
              <div className="h-3 bg-secondary/30 rounded animate-pulse w-3/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!news || news.length === 0) {
    return (
      <div className="crypto-panel">
        <div className="crypto-panel-header">最新資訊</div>
        <div className="p-6 text-center text-muted-foreground text-sm">
          暫無相關新聞，請稍後再試
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats + Timeline */}
      <div className="crypto-panel">
        <div className="crypto-panel-header flex items-center justify-between">
          <span>情緒統計</span>
          <span className="text-xs text-muted-foreground">{news.length} 則 · 過去 24 小時</span>
        </div>
        <div className="p-3 space-y-3">
          <SentimentPie bullish={stats.bullish} bearish={stats.bearish} neutral={stats.neutral} />
          <NewsTimeline pubDates={news.map(n => n.pubDate)} />
        </div>
      </div>

      {/* Filters */}
      <div className="crypto-panel">
        <div className="p-3 space-y-2">
          {/* Keyword search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜尋關鍵字..."
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              className="w-full text-xs pl-8 pr-3 py-1.5 rounded outline-none bg-secondary/30 border border-secondary/50 focus:border-primary/50 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          {/* Quick keyword buttons */}
          <div className="flex flex-wrap gap-1">
            {KEYWORDS.map(kw => (
              <button
                key={kw}
                onClick={() => setKeyword(keyword === kw ? "" : kw)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  keyword === kw
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/30 text-muted-foreground border-secondary/50 hover:border-primary/30"
                }`}
              >
                {kw}
              </button>
            ))}
          </div>
          {/* Sentiment filter */}
          <div className="flex gap-1">
            {(["all", "bullish", "bearish", "neutral"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSentimentFilter(s)}
                className={`flex-1 text-[10px] py-1 rounded border transition-colors ${
                  sentimentFilter === s
                    ? s === "bullish" ? "bg-bull/20 text-bull border-bull/40"
                      : s === "bearish" ? "bg-bear/20 text-bear border-bear/40"
                      : s === "neutral" ? "bg-secondary/50 text-foreground border-secondary"
                      : "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/20 text-muted-foreground border-secondary/40 hover:border-secondary"
                }`}
              >
                {s === "all" ? "全部" : s === "bullish" ? "看多" : s === "bearish" ? "看空" : "中性"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* News list */}
      <div className="crypto-panel">
        <div className="crypto-panel-header flex items-center justify-between">
          <span>新聞列表</span>
          <span className="text-xs text-muted-foreground">{filtered.length} 則</span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">無符合條件的新聞</div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((item, i) => {
              const sentimentColor = item.sentiment === "bullish" ? "text-bull" : item.sentiment === "bearish" ? "text-bear" : "text-muted-foreground";
              const sentimentLabel = item.sentiment === "bullish" ? "看多" : item.sentiment === "bearish" ? "看空" : "中性";
              const timeAgo = Math.round((Date.now() - item.pubDate) / 3600000);

              return (
                <div key={i} className="p-3 hover:bg-secondary/20 transition-colors">
                  <div className="flex items-start gap-2">
                    {/* Sentiment dot */}
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                      item.sentiment === "bullish" ? "bg-bull" : item.sentiment === "bearish" ? "bg-bear" : "bg-secondary"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-foreground hover:text-primary transition-colors line-clamp-2 leading-relaxed"
                      >
                        {item.title}
                        <ExternalLink className="inline w-2.5 h-2.5 ml-1 opacity-50" />
                      </a>
                      {item.description && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{item.description}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-muted-foreground">{item.source}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">{timeAgo}h 前</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className={`text-xs font-medium ${sentimentColor}`}>{sentimentLabel}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
