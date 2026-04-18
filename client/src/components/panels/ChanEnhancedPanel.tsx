/**
 * ChanEnhancedPanel.tsx
 * 強化版纏論面板：包含處理後的筆/線段/中樞、背馳信號、一二三買賣點
 */

interface ChanBi {
  direction: "up" | "down";
  start: number;
  end: number;
  start_time: number;
  end_time: number;
}

interface ChanDuan {
  direction: "up" | "down";
  start: number;
  end: number;
  start_time: number;
  end_time: number;
}

interface ChanZhongshu {
  top: number;
  bottom: number;
  mid: number;
  start_time: number;
  end_time: number;
}

interface ChanBuyPoint {
  level: 1 | 2 | 3;
  direction: "buy" | "sell";
  price: number;
  time: number;
  bi_idx: number;
  description: string;
  strength: "strong" | "medium" | "weak";
  divergence_confirmed: boolean;
  after_zhongshu_break: boolean;
  trend_continuation: boolean;
}

interface DivergenceSignal {
  type: "top" | "bottom" | null;
  description: string;
  strength: string;
}

interface ChanEnhancedResult {
  bis: ChanBi[];
  duans: ChanDuan[];
  zhongshus: ChanZhongshu[];
  trend: "bullish" | "bearish" | "ranging";
  in_zhongshu: boolean;
  current_zhongshu: ChanZhongshu | null;
  bi_count: number;
  duan_count: number;
  buy_sell_points: ChanBuyPoint[];
  divergence_signals: DivergenceSignal;
  macd_area_ratio: number;
}

interface AdvancedData {
  chan_enhanced_4h?: ChanEnhancedResult;
  chan_enhanced_1h?: ChanEnhancedResult;
  [key: string]: unknown;
}

interface Props {
  advanced?: AdvancedData | null;
  isLoading?: boolean;
}

function TrendBadge({ trend }: { trend: string }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    bullish: { label: "↑ 上升趨勢", color: "#00e676", bg: "rgba(0,230,118,0.1)" },
    bearish: { label: "↓ 下降趨勢", color: "#f44336", bg: "rgba(244,67,54,0.1)" },
    ranging: { label: "→ 震盪整理", color: "#ffd740", bg: "rgba(255,215,64,0.1)" },
  };
  const c = config[trend] ?? config.ranging;
  return (
    <span
      className="text-xs px-2 py-1 rounded font-semibold"
      style={{ color: c.color, background: c.bg }}
    >
      {c.label}
    </span>
  );
}

function BuyPointCard({ point }: { point: ChanBuyPoint }) {
  const isBuy = point.direction === "buy";
  const color = isBuy ? "#00e676" : "#f44336";
  const bgColor = isBuy ? "rgba(0,230,118,0.05)" : "rgba(244,67,54,0.05)";
  const borderColor = isBuy ? "rgba(0,230,118,0.2)" : "rgba(244,67,54,0.2)";
  const levelColors: Record<number, string> = { 1: "#ff6b6b", 2: "#ffd740", 3: "#4fc3f7" };
  const levelDescs: Record<number, string> = {
    1: "背馳確認，最低風險",
    2: "中樞突破後回踩",
    3: "趨勢延續確認",
  };

  return (
    <div
      className="rounded-lg p-3 space-y-2"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-bold px-2 py-0.5 rounded"
            style={{ background: `${levelColors[point.level]}20`, color: levelColors[point.level], border: `1px solid ${levelColors[point.level]}40` }}
          >
            {point.level === 1 ? "一" : point.level === 2 ? "二" : "三"}類{isBuy ? "買" : "賣"}點
          </span>
          <span className="text-[10px] text-[#888]">{levelDescs[point.level]}</span>
        </div>
        <span className="text-sm font-bold font-mono" style={{ color }}>
          {point.price.toFixed(2)}
        </span>
      </div>

      <p className="text-xs text-[#bbb] leading-relaxed">{point.description}</p>

      <div className="flex gap-2 flex-wrap">
        {point.divergence_confirmed && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ff6b6b]/20 text-[#ff6b6b] border border-[#ff6b6b]/30">
            ✓ 背馳確認
          </span>
        )}
        {point.after_zhongshu_break && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ffd740]/20 text-[#ffd740] border border-[#ffd740]/30">
            ✓ 中樞突破
          </span>
        )}
        {point.trend_continuation && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/30">
            ✓ 趨勢延續
          </span>
        )}
      </div>
    </div>
  );
}

function ZhongshuCard({ z, isCurrent }: { z: ChanZhongshu; isCurrent: boolean }) {
  return (
    <div
      className="rounded p-2.5 text-xs"
      style={{
        background: isCurrent ? "rgba(255,215,64,0.08)" : "#111",
        border: `1px solid ${isCurrent ? "rgba(255,215,64,0.3)" : "#222"}`,
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[#888]">走勢中樞</span>
        {isCurrent && <span className="text-[10px] text-[#ffd740] font-semibold">● 當前</span>}
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div>
          <div className="text-[#555]">頂</div>
          <div className="text-[#f44336] font-mono">{z.top.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-[#555]">中</div>
          <div className="text-[#ffd740] font-mono">{z.mid.toFixed(2)}</div>
        </div>
        <div className="text-right">
          <div className="text-[#555]">底</div>
          <div className="text-[#00e676] font-mono">{z.bottom.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

function TimeframeSection({ label, data }: { label: string; data: ChanEnhancedResult }) {
  const buyPoints = data.buy_sell_points.filter(p => p.direction === "buy");
  const sellPoints = data.buy_sell_points.filter(p => p.direction === "sell");
  const beichi = data.divergence_signals;
  const beichiColor = beichi.type === "bottom" ? "#00e676" : beichi.type === "top" ? "#f44336" : "#555";

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#ccc]">{label}</span>
          <TrendBadge trend={data.trend} />
          {data.in_zhongshu && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ffd740]/10 text-[#ffd740]">
              在中樞內
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#555]">
          筆 {data.bi_count} ｜ 段 {data.duan_count} ｜ 中樞 {data.zhongshus.length}
        </div>
      </div>

      {/* MACD area ratio */}
      {data.macd_area_ratio > 0 && (
        <div className="rounded p-2 text-xs" style={{ background: "#111", border: "1px solid #222" }}>
          <div className="flex items-center justify-between">
            <span className="text-[#777]">MACD 面積比（背馳指標）</span>
            <span
              className="font-bold"
              style={{ color: data.macd_area_ratio < 0.7 ? "#f44336" : data.macd_area_ratio < 0.9 ? "#ffd740" : "#00e676" }}
            >
              {(data.macd_area_ratio * 100).toFixed(0)}%
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-[#222]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, data.macd_area_ratio * 100)}%`,
                background: data.macd_area_ratio < 0.7 ? "#f44336" : data.macd_area_ratio < 0.9 ? "#ffd740" : "#00e676",
              }}
            />
          </div>
          <div className="text-[10px] text-[#555] mt-1">
            {data.macd_area_ratio < 0.7 ? "⚠️ 面積縮小 < 70%，背馳確認" : data.macd_area_ratio < 0.9 ? "注意：面積縮小中" : "動能正常"}
          </div>
        </div>
      )}

      {/* Divergence signal */}
      {beichi.type && (
        <div
          className="rounded p-2.5 text-xs"
          style={{
            background: `${beichiColor}10`,
            border: `1px solid ${beichiColor}30`,
          }}
        >
          <div className="font-semibold mb-1" style={{ color: beichiColor }}>
            {beichi.type === "bottom" ? "🔔 底背馳信號" : "🔔 頂背馳信號"}
            <span className="ml-2 text-[10px] opacity-70">強度：{beichi.strength}</span>
          </div>
          <div className="text-[#bbb]">{beichi.description}</div>
        </div>
      )}

      {/* Zhongshus */}
      {data.zhongshus.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-[#666] font-semibold">走勢中樞</div>
          {data.zhongshus.slice(-3).map((z, i) => (
            <ZhongshuCard
              key={i}
              z={z}
              isCurrent={i === data.zhongshus.length - 1 && !!data.current_zhongshu}
            />
          ))}
        </div>
      )}

      {/* Buy/Sell points */}
      {(buyPoints.length > 0 || sellPoints.length > 0) && (
        <div className="space-y-2">
          <div className="text-[10px] text-[#666] font-semibold">買賣點</div>
          {buyPoints.map((p, i) => <BuyPointCard key={i} point={p} />)}
          {sellPoints.map((p, i) => <BuyPointCard key={i} point={p} />)}
        </div>
      )}

      {buyPoints.length === 0 && sellPoints.length === 0 && (
        <div className="text-center py-3 text-[#444] text-xs">
          目前無明確買賣點信號
        </div>
      )}
    </div>
  );
}

export function ChanEnhancedPanel({ advanced, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-32 rounded-lg bg-[#1a1a1a] animate-pulse" />
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

  const data4h = advanced.chan_enhanced_4h as ChanEnhancedResult | undefined;
  const data1h = advanced.chan_enhanced_1h as ChanEnhancedResult | undefined;

  return (
    <div className="space-y-4">
      {/* Theory explanation */}
      <div className="rounded-lg p-3 text-xs text-[#777]" style={{ background: "#111", border: "1px solid #222" }}>
        <div className="font-semibold text-[#999] mb-2">📖 纏論核心概念</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div><span className="text-[#ccc]">筆 (Bi)</span>：相鄰頂底分型之間的走勢</div>
          <div><span className="text-[#ccc]">線段 (Duan)</span>：至少三筆組成的方向走勢</div>
          <div><span className="text-[#ccc]">中樞 (Hub)</span>：三筆重疊區域，震盪核心</div>
          <div><span className="text-[#ccc]">背馳 (Beichi)</span>：MACD 面積縮小，動能衰竭</div>
          <div><span className="text-[#ff6b6b]">一類買點</span>：背馳後的最低風險進場</div>
          <div><span className="text-[#ffd740]">二類買點</span>：中樞突破後的回踩確認</div>
          <div><span className="text-[#4fc3f7]">三類買點</span>：趨勢延續的中樞頂部確認</div>
          <div><span className="text-[#ccc]">包含處理</span>：合併包含K線，消除噪音</div>
        </div>
      </div>

      {/* 4H section */}
      {data4h && (
        <div className="rounded-lg p-3 space-y-3" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
          <TimeframeSection label="4H 強化纏論" data={data4h} />
        </div>
      )}

      {/* 1H section */}
      {data1h && (
        <div className="rounded-lg p-3 space-y-3" style={{ background: "#0d0d0d", border: "1px solid #1e1e1e" }}>
          <TimeframeSection label="1H 強化纏論" data={data1h} />
        </div>
      )}
    </div>
  );
}
