import { useState } from "react";
import type {
  ChanMtfData,
  ChanResultData,
  ChanZhongshuData,
  ChanTimeframeSignalData,
  ChanMtfSummaryData,
  ChanData,
  ChanZhongshu,
} from "@shared/cryptoTypes";

interface Props {
  chanMtf?: ChanMtfData;
  // 舊版 fallback（只有 4H 資料，來自 pa.timeframes["4h"].chan）
  chan?: ChanData;
  timeframe?: string;
  isLoading: boolean;
}

const TIMEFRAMES = ["4h", "1h", "15m", "5m"] as const;
const TF_LABELS: Record<string, string> = { "4h": "4H", "1h": "1H", "15m": "15M", "5m": "5M" };

// ─── 工具函數 ─────────────────────────────────────────────────────────────────

function safeZhongshus(zhongshus: unknown[]): ChanZhongshuData[] {
  if (!Array.isArray(zhongshus)) return [];
  return zhongshus.filter(
    (z): z is ChanZhongshuData =>
      z != null &&
      typeof (z as ChanZhongshuData).top === "number" &&
      typeof (z as ChanZhongshuData).bottom === "number" &&
      typeof (z as ChanZhongshuData).mid === "number"
  );
}

function trendColorClass(trend: string) {
  if (trend === "bullish") return "text-bull";
  if (trend === "bearish") return "text-bear";
  return "text-muted-foreground";
}

function trendText(trend: string) {
  if (trend === "bullish") return "↑ 上升";
  if (trend === "bearish") return "↓ 下降";
  return "→ 震盪";
}

function signalBadgeClass(type: string) {
  if (type === "buy")   return "bg-bull/20 text-bull border border-bull/30";
  if (type === "sell")  return "bg-bear/20 text-bear border border-bear/30";
  if (type === "watch") return "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30";
  return "bg-secondary/40 text-muted-foreground border border-secondary/50";
}

function signalText(type: string) {
  if (type === "buy")   return "買入";
  if (type === "sell")  return "賣出";
  if (type === "watch") return "觀察";
  return "中性";
}

function AlignmentBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-bull" : score >= 50 ? "bg-yellow-500" : "bg-bear";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary/40 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-8 text-right">{score}%</span>
    </div>
  );
}

// ─── 單時段纏論詳情 ───────────────────────────────────────────────────────────

function ChanTfDetail({
  tf,
  chanResult,
  signal,
}: {
  tf: string;
  chanResult: ChanResultData;
  signal?: ChanTimeframeSignalData;
}) {
  const zhongshus = safeZhongshus(chanResult.zhongshus);
  const curZ =
    chanResult.current_zhongshu &&
    typeof chanResult.current_zhongshu.top === "number"
      ? chanResult.current_zhongshu
      : null;

  return (
    <div className="space-y-3">
      {/* 訊號卡 */}
      {signal && (
        <div className={`rounded-lg px-3 py-2 text-xs ${signalBadgeClass(signal.signal_type)}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold">{TF_LABELS[tf]} 操作訊號</span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${signalBadgeClass(signal.signal_type)}`}>
              {signalText(signal.signal_type)}
            </span>
          </div>
          <div className="text-xs opacity-90 leading-relaxed">{signal.signal}</div>
        </div>
      )}

      {/* 統計數字 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center bg-secondary/30 rounded p-2">
          <div className="text-xs text-muted-foreground mb-0.5">筆數量</div>
          <div className="text-base font-mono font-bold">{chanResult.bi_count}</div>
        </div>
        <div className="text-center bg-secondary/30 rounded p-2">
          <div className="text-xs text-muted-foreground mb-0.5">段數量</div>
          <div className="text-base font-mono font-bold">{chanResult.duan_count}</div>
        </div>
        <div className="text-center bg-secondary/30 rounded p-2">
          <div className="text-xs text-muted-foreground mb-0.5">中樞數</div>
          <div className="text-base font-mono font-bold">{zhongshus.length}</div>
        </div>
      </div>

      {/* 趨勢 + 中樞狀態 */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold ${trendColorClass(chanResult.trend)}`}>
          {trendText(chanResult.trend)}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            chanResult.in_zhongshu
              ? "bg-primary/10 text-primary"
              : "bg-secondary/30 text-muted-foreground"
          }`}
        >
          {chanResult.in_zhongshu ? "在中樞內" : "不在中樞"}
        </span>
      </div>

      {/* 當前中樞 */}
      {curZ && (
        <div className="crypto-panel">
          <div className="crypto-panel-header">當前中樞</div>
          <div className="p-2 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-muted-foreground">頂部</div>
              <div className="text-xs font-mono text-bear">
                {curZ.top.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">中點</div>
              <div className="text-xs font-mono">
                {curZ.mid.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">底部</div>
              <div className="text-xs font-mono text-bull">
                {curZ.bottom.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 最近中樞列表 */}
      {zhongshus.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1.5">最近中樞列表</div>
          <div className="space-y-1">
            {zhongshus
              .slice(-3)
              .reverse()
              .map((z, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs bg-secondary/20 rounded px-2 py-1.5"
                >
                  <span className="text-muted-foreground">#{zhongshus.length - i}</span>
                  <div className="flex gap-3">
                    <span className="text-bull">
                      底 {z.bottom.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-muted-foreground">
                      中 {z.mid.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-bear">
                      頂 {z.top.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 背馳判斷 */}
      {(chanResult as ChanResultData & { divergence?: { has_divergence: boolean; type: string; description: string } }).divergence?.has_divergence && (
        <div className="rounded-lg px-3 py-2 text-xs bg-yellow-500/10 border border-yellow-500/30">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-yellow-400 font-semibold">⚠ 背馳訊號</span>
            <span className="text-yellow-500/70">{(chanResult as ChanResultData & { divergence?: { has_divergence: boolean; type: string; description: string } }).divergence?.type}</span>
          </div>
          <div className="text-yellow-400/80 leading-relaxed">{(chanResult as ChanResultData & { divergence?: { has_divergence: boolean; type: string; description: string } }).divergence?.description}</div>
        </div>
      )}

      {/* 中樞進出提示 */}
      {(chanResult as ChanResultData & { zhongshu_entry_exit?: { status: string; description: string } }).zhongshu_entry_exit && (
        <div className={`rounded-lg px-3 py-2 text-xs ${
          (chanResult as ChanResultData & { zhongshu_entry_exit?: { status: string; description: string } }).zhongshu_entry_exit?.status === 'entering'
            ? 'bg-blue-500/10 border border-blue-500/30'
            : (chanResult as ChanResultData & { zhongshu_entry_exit?: { status: string; description: string } }).zhongshu_entry_exit?.status === 'exiting'
            ? 'bg-orange-500/10 border border-orange-500/30'
            : 'bg-secondary/20 border border-secondary/40'
        }`}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`font-semibold ${
              (chanResult as ChanResultData & { zhongshu_entry_exit?: { status: string; description: string } }).zhongshu_entry_exit?.status === 'entering' ? 'text-blue-400'
              : (chanResult as ChanResultData & { zhongshu_entry_exit?: { status: string; description: string } }).zhongshu_entry_exit?.status === 'exiting' ? 'text-orange-400'
              : 'text-muted-foreground'
            }`}>
              {(chanResult as ChanResultData & { zhongshu_entry_exit?: { status: string; description: string } }).zhongshu_entry_exit?.status === 'entering' ? '→ 進入中樞'
                : (chanResult as ChanResultData & { zhongshu_entry_exit?: { status: string; description: string } }).zhongshu_entry_exit?.status === 'exiting' ? '← 離開中樞'
                : '中樞內震盪'}
            </span>
          </div>
          <div className="text-muted-foreground leading-relaxed">{(chanResult as ChanResultData & { zhongshu_entry_exit?: { status: string; description: string } }).zhongshu_entry_exit?.description}</div>
        </div>
      )}

      {/* 操作說明 */}
      <div className="text-xs text-muted-foreground bg-secondary/10 rounded p-2">
        <span className="text-foreground/60">操作：</span>
        {chanResult.trend === "bullish"
          ? "上升趨勢中，中樞下沿為買點，突破中樞頂部確認延伸"
          : chanResult.trend === "bearish"
          ? "下降趨勢中，中樞上沿為賣點，跌破中樞底部確認延伸"
          : "震盪中，中樞上下沿為交易邊界，等待方向選擇"}
      </div>
    </div>
  );
}

// ─── 多時段總結卡 ─────────────────────────────────────────────────────────────

function ChanMtfSummaryCard({
  summary,
  signals,
}: {
  summary: ChanMtfSummaryData;
  signals: Record<string, ChanTimeframeSignalData>;
}) {
  const overallColor = trendColorClass(summary.overall_trend);
  const overallLabel =
    summary.overall_trend === "bullish"
      ? "多頭"
      : summary.overall_trend === "bearish"
      ? "空頭"
      : "震盪";

  return (
    <div className="space-y-3">
      {/* 總體趨勢 */}
      <div className="crypto-panel">
        <div className="crypto-panel-header">多時段纏論總結</div>
        <div className="p-3 space-y-3">
          {/* 趨勢共識 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">整體趨勢共識</span>
            <span className={`text-sm font-bold ${overallColor}`}>{overallLabel}</span>
          </div>

          {/* 趨勢分佈 */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-bull/10 rounded p-1.5">
              <div className="text-xs text-muted-foreground">看多</div>
              <div className="text-base font-bold text-bull">{summary.bullish_count}/4</div>
            </div>
            <div className="bg-secondary/30 rounded p-1.5">
              <div className="text-xs text-muted-foreground">震盪</div>
              <div className="text-base font-bold text-muted-foreground">{summary.ranging_count}/4</div>
            </div>
            <div className="bg-bear/10 rounded p-1.5">
              <div className="text-xs text-muted-foreground">看空</div>
              <div className="text-base font-bold text-bear">{summary.bearish_count}/4</div>
            </div>
          </div>

          {/* 趨勢一致性 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">趨勢一致性</span>
              <span className="text-xs font-mono text-foreground">{summary.trend_alignment}%</span>
            </div>
            <AlignmentBar score={summary.trend_alignment} />
          </div>

          {/* 主導時段 + 中樞內時段數 */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              主導時段：<span className="text-foreground font-semibold">{summary.dominant_timeframe}</span>
            </span>
            <span className="text-muted-foreground">
              在中樞內：<span className="text-primary font-semibold">{summary.in_zhongshu_count}/4</span>
            </span>
          </div>
        </div>
      </div>

      {/* 操作建議 */}
      <div className="crypto-panel">
        <div className="crypto-panel-header">操作建議</div>
        <div className="p-3 space-y-2">
          <div className="text-xs text-foreground/90 leading-relaxed">{summary.suggestion}</div>
          <div className="text-xs text-primary/80 bg-primary/5 rounded px-2 py-1.5">
            <span className="font-semibold">入場時機：</span>
            {summary.entry_timing}
          </div>
        </div>
      </div>

      {/* 各時段快速一覽 */}
      <div className="crypto-panel">
        <div className="crypto-panel-header">各時段快速一覽</div>
        <div className="p-2 space-y-1.5">
          {TIMEFRAMES.map((tf) => {
            const sig = signals[tf];
            if (!sig) return null;
            return (
              <div
                key={tf}
                className="flex items-center justify-between text-xs bg-secondary/20 rounded px-2 py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-semibold text-foreground/70 w-7">
                    {TF_LABELS[tf]}
                  </span>
                  <span className={`font-semibold shrink-0 ${trendColorClass(sig.trend)}`}>
                    {trendText(sig.trend)}
                  </span>
                  <span className="text-muted-foreground truncate hidden sm:block">{sig.signal}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-muted-foreground">
                    筆{sig.bi_count} 段{sig.duan_count}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-bold ${signalBadgeClass(
                      sig.signal_type
                    )}`}
                  >
                    {signalText(sig.signal_type)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 詳細數據 */}
      <div className="text-xs text-muted-foreground bg-secondary/10 rounded p-2 leading-relaxed">
        <div className="font-semibold text-foreground/70 mb-1">各時段詳細</div>
        {summary.detail.split(" ｜ ").map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}

// ─── 舊版 ChanData fallback ───────────────────────────────────────────────────

function LegacyChanPanel({
  chan,
  isLoading,
}: {
  chan: ChanData | undefined;
  isLoading: boolean;
}) {
  function isChanValid(c: ChanData): boolean {
    return (
      typeof c.bi_count === "number" &&
      typeof c.duan_count === "number" &&
      Array.isArray(c.zhongshus) &&
      typeof c.trend === "string" &&
      typeof c.in_zhongshu === "boolean"
    );
  }
  function safeZhongshuLegacy(c: ChanData): ChanZhongshu[] {
    if (!Array.isArray(c.zhongshus)) return [];
    return c.zhongshus.filter(
      (z) => z != null && typeof z.top === "number" && typeof z.bottom === "number"
    );
  }

  if (isLoading && !chan) {
    return (
      <div className="crypto-panel">
        <div className="crypto-panel-header">纏論分析</div>
        <div className="p-3 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 bg-secondary/50 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }
  if (!chan || !isChanValid(chan)) {
    return (
      <div className="crypto-panel p-6 text-center">
        <div className="text-muted-foreground text-sm">
          {isLoading ? "纏論計算中..." : "請點擊「分析」按鈕取得纏論分析數據"}
        </div>
      </div>
    );
  }
  const zhongshus = safeZhongshuLegacy(chan);
  const curZ =
    chan.current_zhongshu && typeof chan.current_zhongshu.top === "number"
      ? chan.current_zhongshu
      : null;
  return (
    <div className="space-y-3">
      <div className="crypto-panel">
        <div className="crypto-panel-header flex items-center justify-between">
          <span>纏論分析（4H）</span>
          <span className={`text-xs font-semibold ${trendColorClass(chan.trend)}`}>
            {trendText(chan.trend)}
          </span>
        </div>
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center bg-secondary/30 rounded p-2">
              <div className="text-xs text-muted-foreground mb-1">筆數量</div>
              <div className="text-lg font-mono font-bold">{chan.bi_count ?? 0}</div>
            </div>
            <div className="text-center bg-secondary/30 rounded p-2">
              <div className="text-xs text-muted-foreground mb-1">段數量</div>
              <div className="text-lg font-mono font-bold">{chan.duan_count ?? 0}</div>
            </div>
            <div className="text-center bg-secondary/30 rounded p-2">
              <div className="text-xs text-muted-foreground mb-1">中樞數量</div>
              <div className="text-lg font-mono font-bold">{zhongshus.length}</div>
            </div>
          </div>
          <div
            className={`text-xs px-2 py-1.5 rounded ${
              chan.in_zhongshu
                ? "bg-primary/10 text-primary"
                : "bg-secondary/30 text-muted-foreground"
            }`}
          >
            {chan.in_zhongshu ? "目前價格在中樞區間內" : "目前價格不在中樞區間內"}
          </div>
          {curZ && (
            <div className="crypto-panel">
              <div className="crypto-panel-header">當前中樞</div>
              <div className="p-2 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">頂部</div>
                  <div className="text-xs font-mono text-bear">
                    {curZ.top.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">中點</div>
                  <div className="text-xs font-mono">
                    {curZ.mid.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">底部</div>
                  <div className="text-xs font-mono text-bull">
                    {curZ.bottom.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>
          )}
          {zhongshus.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">最近中樞列表</div>
              <div className="space-y-1.5">
                {zhongshus
                  .slice(-3)
                  .reverse()
                  .map((z, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs bg-secondary/20 rounded px-2 py-1.5"
                    >
                      <span className="text-muted-foreground">#{zhongshus.length - i}</span>
                      <div className="flex gap-3">
                        <span className="text-bull">
                          底 {z.bottom.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-muted-foreground">
                          中 {z.mid.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-bear">
                          頂 {z.top.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 主元件 ───────────────────────────────────────────────────────────────────

export function ChanPanel({ chanMtf, chan, isLoading }: Props) {
  const [activeTab, setActiveTab] = useState<"summary" | "4h" | "1h" | "15m" | "5m">("summary");

  if (isLoading && !chanMtf && !chan) {
    return (
      <div className="crypto-panel">
        <div className="crypto-panel-header">纏論分析</div>
        <div className="p-3 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-4 bg-secondary/50 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // 若沒有新版 chan_mtf，fallback 到舊版
  if (!chanMtf) {
    return <LegacyChanPanel chan={chan} isLoading={isLoading} />;
  }

  const { timeframes, signals, summary } = chanMtf;

  return (
    <div className="space-y-3">
      {/* Tab 列 */}
      <div className="flex gap-1 bg-secondary/20 rounded-lg p-1">
        {(["summary", ...TIMEFRAMES] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
              activeTab === tab
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "summary" ? "總結" : TF_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* 總結 Tab */}
      {activeTab === "summary" && (
        <ChanMtfSummaryCard summary={summary} signals={signals} />
      )}

      {/* 各時段 Tab */}
      {TIMEFRAMES.map(
        (tf) =>
          activeTab === tf && (
            <div key={tf}>
              <div className="crypto-panel">
                <div className="crypto-panel-header flex items-center justify-between">
                  <span>纏論分析 — {TF_LABELS[tf]}</span>
                  {timeframes[tf] && (
                    <span className={`text-xs font-semibold ${trendColorClass(timeframes[tf].trend)}`}>
                      {trendText(timeframes[tf].trend)}
                    </span>
                  )}
                </div>
                <div className="p-3">
                  {timeframes[tf] ? (
                    <ChanTfDetail tf={tf} chanResult={timeframes[tf]} signal={signals[tf]} />
                  ) : (
                    <div className="text-xs text-muted-foreground text-center py-4">無資料</div>
                  )}
                </div>
              </div>

              {/* 纏論基礎概念說明 */}
              <div className="crypto-panel mt-3">
                <div className="crypto-panel-header">纏論基礎概念 + 訊號觸發條件</div>
                <div className="p-3 text-xs text-muted-foreground space-y-2">
                  <div className="rounded p-2" style={{ background: "#161616", border: "1px solid #1e1e1e" }}>
                    <div className="text-foreground/70 font-semibold mb-0.5">筆（Bi）</div>
                    <div>相鄰頂底分型之間的最小走勢單元（至少 5 根 K 線，無包含關係）</div>
                  </div>
                  <div className="rounded p-2" style={{ background: "#161616", border: "1px solid #1e1e1e" }}>
                    <div className="text-foreground/70 font-semibold mb-0.5">段（Duan）</div>
                    <div>由至少 3 筆構成，方向一致的走勢；段的終點為買賣點候選位置</div>
                  </div>
                  <div className="rounded p-2" style={{ background: "#161616", border: "1px solid #1e1e1e" }}>
                    <div className="text-foreground/70 font-semibold mb-0.5">中樞（Zhongshu）</div>
                    <div>三段走勢重疊區域，代表市場震盪均衡區。中樞上沿為阻力，下沿為支撐</div>
                  </div>
                  <div className="rounded p-2" style={{ background: "#4caf5012", border: "1px solid #4caf5030" }}>
                    <div className="text-green-400 font-semibold mb-0.5">買入訊號觸發條件</div>
                    <div className="space-y-0.5">
                      <div>• 上升趨勢中，段回調至中樞下沿附近（中樞進入）</div>
                      <div>• 出現底背馳（MACD 柱面積縮小，但價格未創新低）</div>
                      <div>• 突破中樞頂部並回測守住（中樞離開確認）</div>
                    </div>
                  </div>
                  <div className="rounded p-2" style={{ background: "#ef535012", border: "1px solid #ef535030" }}>
                    <div className="text-red-400 font-semibold mb-0.5">賣出訊號觸發條件</div>
                    <div className="space-y-0.5">
                      <div>• 下降趨勢中，段反彈至中樞上沿附近（中樞進入）</div>
                      <div>• 出現頂背馳（MACD 柱面積縮小，但價格未創新高）</div>
                      <div>• 跌破中樞底部並回測守住（中樞離開確認）</div>
                    </div>
                  </div>
                  <div className="text-muted-foreground">
                    <span className="text-foreground/60">多時段操作邏輯：</span>
                    大時段（4H）確認方向，中時段（1H）確認結構，小時段（15M/5M）尋找精確入場點
                  </div>
                </div>
              </div>
            </div>
          )
      )}
    </div>
  );
}
