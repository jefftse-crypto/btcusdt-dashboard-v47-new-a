/**
 * SignalAlertPanel.tsx v2.0 (Opus 4.6 全面升級)
 * 即時信號通知面板 — 顯示後端掃描器推送的組合策略信號與 GPT-5.4 深度分析
 *
 * 新增功能：
 * 1. 市況分類標籤（趨勢/震盪/壓縮/混沌）
 * 2. 信號失效標記（超過 2 小時自動灰化）
 * 3. 有效獨立信號數顯示（去相關後）
 * 4. 幣種訂閱過濾
 * 5. WebSocket 重連狀態顯示
 */

import { useState } from "react";
import { useDashboardWebSocket, type SignalAlert } from "@/hooks/useDashboardWebSocket";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

// ── 市況標籤設定 ──
const REGIME_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  trending:   { label: "趨勢市", color: "text-blue-400",   bg: "bg-blue-500/20 border-blue-500/30" },
  ranging:    { label: "震盪市", color: "text-yellow-400", bg: "bg-yellow-500/20 border-yellow-500/30" },
  compressed: { label: "壓縮市", color: "text-purple-400", bg: "bg-purple-500/20 border-purple-500/30" },
  chaotic:    { label: "混沌市", color: "text-red-400",    bg: "bg-red-500/20 border-red-500/30" },
};

// ── 工具函數 ──
function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTimeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "剛剛";
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前`;
  return `${Math.floor(diffHr / 24)} 天前`;
}

function calcRR(entry: number, sl: number, tp1: number): string {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp1 - entry);
  if (risk === 0) return "N/A";
  return (reward / risk).toFixed(2);
}

// ── 單一信號卡片 ──
function SignalCard({ alert, isExpanded, onToggle }: {
  alert: SignalAlert;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isLong = alert.direction === "long";
  const isExpired = alert.is_expired === true;
  const dirColor = isExpired ? "text-gray-500" : (isLong ? "text-green-400" : "text-red-400");
  const dirBg = isExpired
    ? "bg-gray-800/50 border-gray-700/50 opacity-60"
    : (isLong ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30");
  const dirLabel = isLong ? "📈 做多" : "📉 做空";
  const rr = calcRR(alert.entry, alert.sl, alert.tp1);
  const slDist = Math.abs(((alert.sl - alert.entry) / alert.entry) * 100).toFixed(2);
  const tp1Dist = Math.abs(((alert.tp1 - alert.entry) / alert.entry) * 100).toFixed(2);
  const regimeCfg = alert.regime ? REGIME_CONFIG[alert.regime] : null;

  return (
    <div
      className={`rounded-lg border p-3 mb-2 cursor-pointer transition-all ${dirBg} hover:opacity-90`}
      onClick={onToggle}
    >
      {/* 標題列 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-bold text-sm ${isExpired ? "text-gray-500" : "text-yellow-400"}`}>
            {alert.symbol}
          </span>
          <Badge variant="outline" className={`text-xs ${dirColor} border-current`}>
            {dirLabel}
          </Badge>
          <Badge variant="outline" className="text-xs text-gray-400 border-gray-600">
            {alert.interval}
          </Badge>
          {/* 市況標籤 */}
          {regimeCfg && (
            <Badge variant="outline" className={`text-xs ${regimeCfg.color} ${regimeCfg.bg}`}>
              {regimeCfg.label}
            </Badge>
          )}
          {/* 失效標籤 */}
          {isExpired && (
            <Badge variant="outline" className="text-xs text-gray-500 border-gray-700">
              ⏰ 已失效
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs" title={formatTime(alert.timestamp)}>
            {formatTimeAgo(alert.timestamp)}
          </span>
          <span className="text-gray-500 text-xs">{isExpanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* 策略和評分 */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs">
          {alert.strategy}
        </Badge>
        {alert.signal_score !== null && (
          <span className={`text-xs ${isExpired ? "text-gray-600" : "text-yellow-400"}`}>
            評分 {alert.signal_score}/10
          </span>
        )}
        <span className={`text-xs ${isExpired ? "text-gray-600" : "text-gray-400"}`}>
          勝率 {alert.recent_wr.toFixed(1)}%
        </span>
        {/* 有效獨立信號數 */}
        {alert.effective_signals !== undefined && alert.effective_signals > 1 && (
          <span className="text-xs text-cyan-400">
            ✦ {alert.effective_signals} 個策略共識
          </span>
        )}
      </div>

      {/* 價格資訊 */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div>
          <div className="text-gray-500">進場</div>
          <div className={`font-mono ${isExpired ? "text-gray-500" : "text-white"}`}>
            {formatPrice(alert.entry)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">止損 -{slDist}%</div>
          <div className={`font-mono ${isExpired ? "text-gray-600" : "text-red-400"}`}>
            {formatPrice(alert.sl)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">止盈1 +{tp1Dist}%</div>
          <div className={`font-mono ${isExpired ? "text-gray-600" : "text-green-400"}`}>
            {formatPrice(alert.tp1)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">RR 比</div>
          <div className={`font-mono font-bold ${
            isExpired ? "text-gray-600" :
            parseFloat(rr) >= 2 ? "text-green-400" :
            parseFloat(rr) >= 1.5 ? "text-yellow-400" : "text-gray-400"
          }`}>
            {rr}
          </div>
        </div>
      </div>

      {/* 止盈2 */}
      {alert.tp2 && alert.tp2 !== alert.tp1 && (
        <div className="mt-1 text-xs">
          <span className="text-gray-500">止盈2（分批平倉）：</span>
          <span className={`font-mono ${isExpired ? "text-gray-600" : "text-green-300"}`}>
            {formatPrice(alert.tp2)}
          </span>
        </div>
      )}

      {/* GPT-5.4 分析（展開時顯示）*/}
      {isExpanded && (
        <div className="mt-3">
          <Separator className="mb-2 bg-gray-700" />
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs text-blue-400 font-semibold">🤖 GPT-5.4 深度分析</span>
            {alert.gpt_loading && (
              <span className="text-xs text-gray-500 animate-pulse">分析中...</span>
            )}
          </div>
          {alert.gpt_loading && !alert.gpt_analysis ? (
            <div className="text-xs text-gray-500 animate-pulse">
              正在調用 GPT-5.4 進行深度分析，請稍候...
            </div>
          ) : alert.gpt_analysis ? (
            <div className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap bg-gray-900/50 rounded p-2">
              {alert.gpt_analysis}
            </div>
          ) : (
            <div className="text-xs text-gray-500">（暫無分析）</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 主面板 ──
const SYMBOL_FILTERS = ["全部", "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

interface SignalAlertPanelProps {
  symbol?: string;
}

export function SignalAlertPanel({ symbol: propSymbol }: SignalAlertPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState<string>(propSymbol ?? "全部");
  const [showExpired, setShowExpired] = useState(false);

  const { signalAlerts, status } = useDashboardWebSocket({
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
    enabled: true,
  });

  // 過濾邏輯
  let filteredAlerts = symbolFilter === "全部"
    ? signalAlerts
    : signalAlerts.filter(a => a.symbol === symbolFilter);

  if (!showExpired) {
    filteredAlerts = filteredAlerts.filter(a => !a.is_expired);
  }

  const isConnected = status === "connected" || status === "fallback";
  const isReconnecting = status === "connecting";
  const activeCount = signalAlerts.filter(a => !a.is_expired).length;
  const expiredCount = signalAlerts.filter(a => a.is_expired).length;

  return (
    <Card className="bg-gray-900 border-gray-700 h-full">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-yellow-400">🔔</span>
            <span className="text-white">即時信號推送</span>
            <Badge
              variant="outline"
              className={`text-xs ${
                isConnected ? "text-green-400 border-green-500/40" :
                isReconnecting ? "text-yellow-400 border-yellow-500/40 animate-pulse" :
                "text-gray-500 border-gray-600"
              }`}
            >
              {isConnected ? "● 已連線" : isReconnecting ? "◌ 重連中" : "○ 未連線"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {activeCount > 0 && (
              <span className="text-green-400 text-xs font-normal">{activeCount} 個活躍</span>
            )}
            {expiredCount > 0 && (
              <button
                className="text-gray-600 text-xs hover:text-gray-400 transition-colors"
                onClick={(e) => { e.stopPropagation(); setShowExpired(v => !v); }}
              >
                {showExpired ? "隱藏" : "顯示"} {expiredCount} 個失效
              </button>
            )}
          </div>
        </CardTitle>

        {/* 幣種過濾器 */}
        <div className="flex gap-1 mt-1 flex-wrap">
          {SYMBOL_FILTERS.map(sym => (
            <button
              key={sym}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                symbolFilter === sym
                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                  : "text-gray-500 border-gray-700 hover:text-gray-300"
              }`}
              onClick={() => setSymbolFilter(sym)}
            >
              {sym === "全部" ? sym : sym.replace("USDT", "")}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-500 mt-1">
          後端每 2 分鐘自動掃描，有新信號即時推送並附 GPT-5.4 分析 · 信號 2 小時後自動標記失效
        </p>
      </CardHeader>

      <CardContent className="px-3 pb-3">
        {filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="text-3xl mb-2">📡</div>
            <div className="text-gray-400 text-sm">
              {isReconnecting ? "正在重新連線..." : "正在監控市場信號..."}
            </div>
            <div className="text-gray-600 text-xs mt-1">
              {activeCount === 0 && expiredCount > 0
                ? `目前無活躍信號（${expiredCount} 個已失效，可點擊上方「顯示」查看）`
                : "系統啟動後 30 秒開始第一次掃描"}
            </div>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-320px)] min-h-[300px]">
            <div className="pr-2">
              {filteredAlerts.map((alert) => (
                <SignalCard
                  key={alert.id}
                  alert={alert}
                  isExpanded={expandedId === alert.id}
                  onToggle={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default SignalAlertPanel;
