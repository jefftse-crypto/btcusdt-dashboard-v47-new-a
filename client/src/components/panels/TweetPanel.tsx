import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { ExternalLink, RefreshCw, Twitter } from "lucide-react";
import type { TweetItem } from "@shared/schemas";

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

  const cx = 40, cy = 40, r = 30, inner = 18;
  function arc(startAngle: number, endAngle: number, color: string, key: string) {
    if (endAngle - startAngle < 0.01) return null;
    const s  = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) };
    const e  = { x: cx + r * Math.cos(endAngle),   y: cy + r * Math.sin(endAngle) };
    const si = { x: cx + inner * Math.cos(startAngle), y: cy + inner * Math.sin(startAngle) };
    const ei = { x: cx + inner * Math.cos(endAngle),   y: cy + inner * Math.sin(endAngle) };
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

// ─── 單則推文卡片 ─────────────────────────────────────────────────────────────

function TweetCard({ tweet }: { tweet: TweetItem }) {
  const sentimentColor = tweet.sentiment === "bullish" ? "text-bull"
    : tweet.sentiment === "bearish" ? "text-bear"
    : "text-muted-foreground";
  const sentimentLabel = tweet.sentiment === "bullish" ? "看多"
    : tweet.sentiment === "bearish" ? "看空"
    : "中性";
  const timeAgo = Math.round((Date.now() - tweet.pubDate) / 60000);
  const timeStr = timeAgo < 60 ? `${timeAgo}m 前` : `${Math.round(timeAgo / 60)}h 前`;

  return (
    <div className="p-3 hover:bg-secondary/20 transition-colors border-b border-border last:border-0">
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-secondary/50 flex items-center justify-center text-base shrink-0 border border-border">
          {tweet.avatar ?? "🐦"}
        </div>
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-foreground">{tweet.author}</span>
            <span className="text-xs text-muted-foreground">@{tweet.handle}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{timeStr}</span>
            {tweet.isAI && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-secondary/60 text-muted-foreground border border-secondary/80 ml-auto">
                AI 生成
              </span>
            )}
          </div>
          {/* Content */}
          <p className="text-xs text-foreground mt-1 leading-relaxed whitespace-pre-wrap break-words">
            {tweet.content}
          </p>
          {/* Footer */}
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.638h-.014C9.403 21.59 1.95 14.856 1.95 8.478c0-3.064 2.525-5.754 5.403-5.754 2.29 0 3.83 1.58 4.646 2.73.814-1.148 2.354-2.73 4.645-2.73 2.88 0 5.404 2.69 5.404 5.755 0 6.376-7.454 13.11-10.037 13.157H12z"/>
              </svg>
              {tweet.likes.toLocaleString()}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.77 15.67c-.292-.293-.767-.293-1.06 0l-2.22 2.22V7.65c0-2.068-1.683-3.75-3.75-3.75h-5.85c-.414 0-.75.336-.75.75s.336.75.75.75h5.85c1.24 0 2.25 1.01 2.25 2.25v10.24l-2.22-2.22c-.293-.293-.768-.293-1.06 0s-.294.768 0 1.06l3.5 3.5c.145.147.337.22.53.22s.383-.072.53-.22l3.5-3.5c.294-.292.294-.767 0-1.06zm-10.66 3.28H7.26c-1.24 0-2.25-1.01-2.25-2.25V6.46l2.22 2.22c.148.147.34.22.532.22s.384-.073.53-.22c.293-.293.293-.768 0-1.06l-3.5-3.5c-.293-.294-.768-.294-1.06 0l-3.5 3.5c-.294.292-.294.767 0 1.06s.767.293 1.06 0l2.22-2.22V16.7c0 2.068 1.683 3.75 3.75 3.75h5.85c.414 0 .75-.336.75-.75s-.337-.75-.75-.75z"/>
              </svg>
              {tweet.retweets.toLocaleString()}
            </div>
            <span className={`text-xs font-medium ml-auto ${sentimentColor}`}>{sentimentLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SENTIMENT_FILTERS = ["all", "bullish", "bearish", "neutral"] as const;

export function TweetPanel({ symbol }: Props) {
  const [sentimentFilter, setSentimentFilter] = useState<typeof SENTIMENT_FILTERS[number]>("all");

  const { data: tweets, isLoading, refetch, isFetching } = trpc.tweets.getLatestTweets.useQuery(
    { symbol, count: 15 },
    {
      refetchInterval: 10 * 60 * 1000, // 每 10 分鐘刷新
      staleTime: 5 * 60 * 1000,
    }
  );

  const stats = useMemo(() => {
    if (!tweets) return { bullish: 0, bearish: 0, neutral: 0 };
    return {
      bullish: tweets.filter(t => t.sentiment === "bullish").length,
      bearish: tweets.filter(t => t.sentiment === "bearish").length,
      neutral: tweets.filter(t => t.sentiment === "neutral").length,
    };
  }, [tweets]);

  const filtered = useMemo(() => {
    if (!tweets) return [];
    if (sentimentFilter === "all") return tweets;
    return tweets.filter(t => t.sentiment === sentimentFilter);
  }, [tweets, sentimentFilter]);

  if (isLoading) {
    return (
      <div className="crypto-panel">
        <div className="crypto-panel-header flex items-center gap-2">
          <Twitter className="w-3.5 h-3.5 text-[#1DA1F2]" />
          <span>Twitter 動態</span>
        </div>
        <div className="p-3 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-2.5">
              <div className="w-8 h-8 rounded-full bg-secondary/50 animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-secondary/50 rounded animate-pulse w-1/3" />
                <div className="h-3 bg-secondary/30 rounded animate-pulse" />
                <div className="h-3 bg-secondary/30 rounded animate-pulse w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="crypto-panel">
        <div className="crypto-panel-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Twitter className="w-3.5 h-3.5 text-[#1DA1F2]" />
            <span>推文情緒統計</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{tweets?.length ?? 0} 則 · AI 生成</span>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1 rounded hover:bg-secondary/50 transition-colors disabled:opacity-50"
              title="重新生成推文"
            >
              <RefreshCw className={`w-3 h-3 text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <div className="p-3 space-y-3">
          {tweets && tweets.length > 0 ? (
            <SentimentPie bullish={stats.bullish} bearish={stats.bearish} neutral={stats.neutral} />
          ) : (
            <div className="text-xs text-muted-foreground text-center py-2">暫無資料</div>
          )}
        </div>
      </div>

      {/* AI 生成說明 */}
      <div className="crypto-panel">
        <div className="p-2.5 flex items-start gap-2 bg-secondary/20 rounded">
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/80 shrink-0 mt-1.5" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            以下推文由 AI 根據最新加密貨幣新聞生成，模擬市場 KOL 觀點，僅供參考，不代表真實人物言論。
          </p>
        </div>
      </div>

      {/* Sentiment filter */}
      <div className="crypto-panel">
        <div className="crypto-panel-header">篩選</div>
        <div className="p-2 flex gap-1">
          {SENTIMENT_FILTERS.map(s => (
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

      {/* Tweet list */}
      <div className="crypto-panel">
        <div className="crypto-panel-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Twitter className="w-3.5 h-3.5 text-[#1DA1F2]" />
            <span>推文列表</span>
          </div>
          <span className="text-xs text-muted-foreground">{filtered.length} 則</span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {isFetching ? "正在生成推文..." : "暫無推文，請點擊重新整理"}
          </div>
        ) : (
          <div>
            {filtered.map((tweet) => (
              <TweetCard key={tweet.id} tweet={tweet} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
