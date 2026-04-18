import { useState, useEffect, useCallback, useMemo, lazy, Suspense, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useKlineWebSocket } from "@/hooks/useKlineWebSocket";
import { useLiveTicker } from "@/hooks/useDashboardWebSocket";
import { useIsMobile } from "@/hooks/useMobile";
import { WidgetManager } from "@/components/WidgetManager";

const CHUNK_RETRY_PREFIX = "dashboard:chunk-retry:";

function isChunkLoadError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = `${error.message}\n${error.stack ?? ""}`;
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Failed to fetch") ||
    message.includes("Loading chunk") ||
    message.includes("ChunkLoadError")
  );
}

function lazyWithRetry<T extends { default: any }>(key: string, importer: () => Promise<T>) {
  return lazy(async () => {
    try {
      const module = await importer();
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(`${CHUNK_RETRY_PREFIX}${key}`);
      }
      return module;
    } catch (error) {
      if (typeof window !== "undefined" && isChunkLoadError(error)) {
        const retryKey = `${CHUNK_RETRY_PREFIX}${key}`;
        const alreadyRetried = window.sessionStorage.getItem(retryKey) === "1";

        if (!alreadyRetried) {
          window.sessionStorage.setItem(retryKey, "1");
          window.location.reload();
          return new Promise<T>(() => {});
        }

        window.sessionStorage.removeItem(retryKey);
      }

      throw error;
    }
  });
}

// 懶加載所有面板元件，減少首屏 bundle 大小，並在 chunk 失配時自動重試一次
const IndicatorsPanel      = lazyWithRetry("IndicatorsPanel", () => import("@/components/panels/IndicatorsPanel").then(m => ({ default: m.IndicatorsPanel })));
const SmcPanel             = lazyWithRetry("SmcPanel", () => import("@/components/panels/SmcPanel").then(m => ({ default: m.SmcPanel })));
const PaPanel              = lazyWithRetry("PaPanel", () => import("@/components/panels/PaPanel").then(m => ({ default: m.PaPanel })));
const ChanPanel            = lazyWithRetry("ChanPanel", () => import("@/components/panels/ChanPanel").then(m => ({ default: m.ChanPanel })));
const StrategyPanel        = lazyWithRetry("StrategyPanel", () => import("@/components/panels/StrategyPanel").then(m => ({ default: m.StrategyPanel })));
const ForecastPanel        = lazyWithRetry("ForecastPanel", () => import("@/components/panels/ForecastPanel").then(m => ({ default: m.ForecastPanel })));
const OnchainPanel         = lazyWithRetry("OnchainPanel", () => import("@/components/panels/OnchainPanel").then(m => ({ default: m.OnchainPanel })));
const NewsPanel            = lazyWithRetry("NewsPanel", () => import("@/components/panels/NewsPanel").then(m => ({ default: m.NewsPanel })));
const TweetPanel           = lazyWithRetry("TweetPanel", () => import("@/components/panels/TweetPanel").then(m => ({ default: m.TweetPanel })));
const BacktestPanel        = lazyWithRetry("BacktestPanel", () => import("@/components/panels/BacktestPanel").then(m => ({ default: m.BacktestPanel })));
const HighWinRatePanel     = lazyWithRetry("HighWinRatePanel", () => import("@/components/panels/HighWinRatePanel"));
const KlinePanel           = lazyWithRetry("KlinePanel", () => import("@/components/panels/KlinePanel").then(m => ({ default: m.KlinePanel })));
const ScreenerPanel        = lazyWithRetry("ScreenerPanel", () => import("@/components/panels/ScreenerPanel"));
const HeatmapPanel         = lazyWithRetry("HeatmapPanel", () => import("@/components/panels/HeatmapPanel"));
const AlertsPanel          = lazyWithRetry("AlertsPanel", () => import("@/components/panels/AlertsPanel"));
const CompositeAlertsPanel = lazyWithRetry("CompositeAlertsPanel", () => import("@/components/panels/CompositeAlertsPanel"));
const VolumeProfilePanel   = lazyWithRetry("VolumeProfilePanel", () => import("@/components/panels/VolumeProfilePanel"));
const DivergencePanel      = lazyWithRetry("DivergencePanel", () => import("@/components/panels/DivergencePanel").then(m => ({ default: m.DivergencePanel })));
const PaLevelPanel         = lazyWithRetry("PaLevelPanel", () => import("@/components/panels/PaLevelPanel").then(m => ({ default: m.PaLevelPanel })));
const ChanEnhancedPanel    = lazyWithRetry("ChanEnhancedPanel", () => import("@/components/panels/ChanEnhancedPanel").then(m => ({ default: m.ChanEnhancedPanel })));
const SmcUltimatePanel     = lazyWithRetry("SmcUltimatePanel", () => import("@/components/panels/SmcUltimatePanel").then(m => ({ default: m.SmcUltimatePanel })));
const SmcConfirmPanel      = lazyWithRetry("SmcConfirmPanel", () => import("@/components/panels/SmcConfirmPanel").then(m => ({ default: m.SmcConfirmPanel })));
const ConsensusPanel       = lazyWithRetry("ConsensusPanel", () => import("@/components/panels/ConsensusPanel").then(m => ({ default: m.ConsensusPanel })));
const PandaPanel           = lazyWithRetry("PandaPanel", () => import("@/components/panels/PandaPanel"));
const SmcLearningPanel     = lazyWithRetry("SmcLearningPanel", () => import("@/components/panels/SmcLearningPanel").then(m => ({ default: m.SmcLearningPanel })));
const IctAnalysisPanel     = lazyWithRetry("IctAnalysisPanel", () => import("@/components/panels/IctAnalysisPanel").then(m => ({ default: m.IctAnalysisPanel })));
const PaLouiePanel         = lazyWithRetry("PaLouiePanel", () => import("@/components/panels/PaLouiePanel").then(m => ({ default: m.PaLouiePanel })));
const SnrPanel             = lazyWithRetry("SnrPanel", () => import("@/components/panels/SnrPanel").then(m => ({ default: m.SnrPanel })));
const ComboStrategyPanel   = lazyWithRetry("ComboStrategyPanel", () => import("@/components/panels/ComboStrategyPanel").then(m => ({ default: m.ComboStrategyPanel })));
const SignalAlertPanel     = lazyWithRetry("SignalAlertPanel", () => import("@/components/panels/SignalAlertPanel").then(m => ({ default: m.SignalAlertPanel })));
const ChampionTraderPanel  = lazyWithRetry("ChampionTraderPanel", () => import("@/components/panels/ChampionTraderPanel").then(m => ({ default: m.ChampionTraderPanel })));
const ChampionAnalysisPanel = lazyWithRetry("ChampionAnalysisPanel", () => import("@/components/panels/ChampionAnalysisPanel").then(m => ({ default: m.ChampionAnalysisPanel })));
const CannonballPanel      = lazyWithRetry("CannonballPanel", () => import("@/components/panels/CannonballPanel").then(m => ({ default: m.CannonballPanel })));
import { toast } from "sonner";
import {
  RefreshCw, Wifi, WifiOff, Star, Settings,
  TrendingUp, TrendingDown, Minus, Zap, ChevronDown, ChevronUp,
  BarChart2, Activity, Brain, Link, Bell, Search, MessageSquare,
  AlertTriangle, CheckCircle, XCircle, Info, Clock, Target,
  DollarSign, Shield, Layers, Eye, EyeOff,
} from "lucide-react";
import {
  SUPPORTED_SYMBOLS,
  DEFAULT_WIDGET_IDS,
  type Timeframe,
  type CryptoSnapshot,
} from "@shared/cryptoTypes";

// ─────────────────────────────────────────────────────────────────────────────
// 兩層導航結構（改良 1-1：Tab 導航重構）
// ─────────────────────────────────────────────────────────────────────────────
const NAV_CATEGORIES = [
  {
    id: "overview",
    label: "市場總覽",
    icon: "📊",
    tabs: [
      { id: "screener",    label: "篩選器",    icon: "🔍" },
      { id: "heatmap",     label: "熱力圖",    icon: "🌡️" },
      { id: "vpvr",        label: "成交量分佈", icon: "📊" },
    ],
  },
  {
    id: "technical",
    label: "技術分析",
    icon: "📈",
    tabs: [
      { id: "indicators",   label: "技術指標",   icon: "📈" },
      { id: "smc",          label: "SMC 結構",   icon: "🎯" },
      { id: "smc_ultimate", label: "SMC 終極",   icon: "🎯" },
      { id: "smc_confirm",  label: "SMC 確認",   icon: "✅" },
      { id: "pa",           label: "PA 分析",    icon: "📊" },
      { id: "pa_level",     label: "PA 水位",    icon: "📊" },
      { id: "divergence",   label: "背離偵測",   icon: "📉" },
      { id: "chan",         label: "纏論",       icon: "🌀" },
      { id: "chan_enhanced", label: "纏論強化",  icon: "🌀" },
    ],
  },
  {
    id: "strategy",
    label: "智能策略",
    icon: "💡",
    tabs: [
      { id: "strategy",    label: "策略建議",   icon: "💡" },
      { id: "forecast",    label: "預測情境",   icon: "🔮" },
      { id: "highwinrate", label: "高勝率",     icon: "🏆" },
      { id: "history",     label: "回測記錄",   icon: "📜" },
      { id: "consensus",   label: "共識評分",   icon: "⚖️" },
      { id: "panda",       label: "🐼 熊貓策略", icon: "🐼" },
      { id: "combo",        label: "⚡ 組合信號",  icon: "⚡" },
      { id: "signal_alert", label: "🔔 即時推送",  icon: "🔔" },
    ],
  },
  {
    id: "intel",
    label: "鏈上情報",
    icon: "⛓️",
    tabs: [
      { id: "onchain",     label: "鏈上數據",   icon: "⛓️" },
      { id: "alerts",      label: "警報",       icon: "🔔" },
      { id: "news",        label: "新聞推文",   icon: "📰" },
    ],
  },
  {
    id: "settings",
    label: "設定",
    icon: "⚙️",
    tabs: [
      { id: "settings",    label: "設定",       icon: "⚙️" },
    ],
  },
  {
    id: "learning",
    label: "SMC 學習",
    icon: "🎓",
    tabs: [
      { id: "smc_learning", label: "學習資源", icon: "🎓" },
    ],
  },
  {
    id: "ict",
    label: "ICT 分析",
    icon: "🧠",
    tabs: [
      { id: "ict_analysis", label: "ICT 框架", icon: "🧠" },
    ],
  },
  {
    id: "pa_louie",
    label: "PA 分析",
    icon: "📊",
    tabs: [
      { id: "pa_louie", label: "方方土 PA", icon: "📊" },
    ],
  },
  {
    id: "snr_analysis",
    label: "SNR 分析",
    icon: "📐",
    tabs: [
      { id: "snr_analysis", label: "支撐阻力", icon: "📐" },
    ],
  },
  {
    id: "champion_trader",
    label: "冠軍交易者",
    icon: "🏆",
    tabs: [
      { id: "champion_analysis", label: "冠軍分析", icon: "⚡" },
      { id: "champion_trader",   label: "學習資源", icon: "📚" },
    ],
  },
  {
    id: "cannonball",
    label: "CannonBall",
    icon: "🎯",
    tabs: [
      { id: "cannonball", label: "OB 策略分析", icon: "🎯" },
    ],
  },
];

const MOBILE_PRIMARY_CATEGORY_IDS = ["technical", "strategy", "intel", "overview"];
const MOBILE_PRIORITY_TAB_IDS = ["indicators", "strategy", "consensus", "smc", "pa", "onchain", "news", "settings"];

function getCategoryForTab(tabId: string): string {
  for (const cat of NAV_CATEGORIES) {
    if (cat.tabs.some(t => t.id === tabId)) return cat.id;
  }
  return "technical";
}

// #10 修復：自動推導不需要快照的 Tab 白名單（不再手動維護兩處字串）
const NO_SNAPSHOT_TABS = new Set(
  NAV_CATEGORIES
    .filter(cat => ["intel", "settings", "learning", "ict", "pa_louie", "snr_analysis", "champion_trader", "cannonball"].includes(cat.id))
    .flatMap(cat => cat.tabs.map(t => t.id))
    .concat(["news", "history", "highwinrate", "screener", "heatmap", "alerts", "vpvr", "panda", "combo", "signal_alert", "champion_analysis"])
);

const EMA_PERIODS = [9, 20, 50, 100, 200];
const DEFAULT_REFRESH_INTERVAL_SECS = 300;
const CANNONBALL_SETTINGS_KEY = "cannonball_params_v2";
const DEFAULT_CANNONBALL_PARAMS = {
  htf_tf: "2H",
  ltf_tf: "30m",
  sl_atr_mult: 0.3,
  tp2_atr_mult: 2.5,
  confluence_threshold: 50,
  avoid_extremes_atr: 0.8,
};
type CannonballSettings = typeof DEFAULT_CANNONBALL_PARAMS;

function clampRefreshIntervalSecs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REFRESH_INTERVAL_SECS;
  return Math.max(60, Math.min(3600, Math.round(value)));
}

function formatRefreshInterval(value: number): string {
  if (value % 60 === 0) return `${value / 60} 分鐘`;
  return `${value} 秒`;
}

function formatFriendlyRuntimeError(message?: string | null): string {
  if (!message) return "資料暫時不可用，請稍後再試。";
  const raw = String(message).trim();
  if (!raw) return "資料暫時不可用，請稍後再試。";
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  const normalized = raw.toLowerCase();
  if (normalized.includes("invalid arguments") || normalized.includes("kraken")) {
    return "交易所回傳的週期資料暫時不可用，系統會改用可用資料重新整理。";
  }
  if (normalized.includes("http 451")) {
    return "資料來源目前受節點或區域限制，系統稍後會自動重試。";
  }
  if (normalized.includes("timeout") || normalized.includes("network") || normalized.includes("fetch")) {
    return "資料連線暫時不穩定，請稍後重新整理。";
  }
  return raw;
}

function formatForgeUrl(url: string): string {
  if (!url || url === "(未設定)") return "(未設定)";
  return url.length > 48 ? `${url.slice(0, 48)}…` : url;
}

function getModelDisplayName(model?: string): string {
  return model?.trim() || "未提供";
}

function getInitialCannonballSettings(): CannonballSettings {
  try {
    const saved = localStorage.getItem(CANNONBALL_SETTINGS_KEY);
    if (saved) return { ...DEFAULT_CANNONBALL_PARAMS, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_CANNONBALL_PARAMS;
}

function getInitialRefreshInterval(): number {
  const raw = Number(localStorage.getItem("global_refresh_interval_secs") ?? DEFAULT_REFRESH_INTERVAL_SECS);
  return clampRefreshIntervalSecs(raw);
}

function getInitialGlobalSetting(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

function parseNumericInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDecimal(value: number, digits = 2): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function settingInputClassName() {
  return "mt-1 w-full rounded border border-[#2a2a2a] bg-[#101010] px-3 py-2 text-sm text-[#ddd] outline-none transition-colors focus:border-[#ffd740]";
}

function settingLabelClassName() {
  return "text-[11px] font-medium uppercase tracking-wide text-[#777]";
}

function settingCardClassName() {
  return "rounded p-4";
}

function settingCardStyle() {
  return { background: "#161616", border: "1px solid #2a2a2a" };
}

function sectionHintClassName() {
  return "text-[10px] text-[#555] mt-1 leading-relaxed";
}

function sliderClassName() {
  return "mt-2 w-full accent-[#ffd740]";
}

function getRefreshThresholdHint(): string {
  return "價格偏離 0.5 ATR 時會提前觸發重跑。";
}

function numericStepValue(key: keyof CannonballSettings): string {
  return key === "confluence_threshold" ? "1" : "0.1";
}

function clampCannonballValue(key: keyof CannonballSettings, value: number): number {
  if (key === "sl_atr_mult") return Math.max(0.1, Math.min(0.8, value));
  if (key === "tp2_atr_mult") return Math.max(1.0, Math.min(4.0, value));
  if (key === "confluence_threshold") return Math.max(40, Math.min(80, Math.round(value)));
  if (key === "avoid_extremes_atr") return Math.max(0.3, Math.min(1.5, value));
  return value;
}

function getCannonballRangeConfig(key: keyof CannonballSettings): { min: number; max: number; step: number } {
  if (key === "sl_atr_mult") return { min: 0.1, max: 0.8, step: 0.1 };
  if (key === "tp2_atr_mult") return { min: 1.0, max: 4.0, step: 0.1 };
  if (key === "confluence_threshold") return { min: 40, max: 80, step: 1 };
  return { min: 0.3, max: 1.5, step: 0.1 };
}

function parseCannonballInput(key: keyof CannonballSettings, value: string): number {
  return clampCannonballValue(key, parseNumericInput(value, DEFAULT_CANNONBALL_PARAMS[key] as number));
}

function getRefreshInputHint(value: number): string {
  return `目前基礎刷新間隔為 ${formatRefreshInterval(value)}。`;
}

function modelCardRows(config?: { model_balanced?: string; model_fast?: string; model_deep?: string; forge_url?: string; node_env?: string }) {
  return [
    { label: "Balanced", value: getModelDisplayName(config?.model_balanced) },
    { label: "Fast", value: getModelDisplayName(config?.model_fast) },
    { label: "Deep", value: getModelDisplayName(config?.model_deep) },
    { label: "Forge URL", value: formatForgeUrl(config?.forge_url ?? "(未設定)") },
    { label: "環境", value: config?.node_env ?? "development" },
  ];
}

function refreshIntervalOptions() {
  return [60, 120, 300, 900, 1800];
}

function timeframeOptions(kind: "htf" | "ltf") {
  return kind === "htf" ? ["1H", "2H", "4H"] : ["15m", "30m", "1H"];
}

function parsePercentInput(value: string, fallback: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return String(Math.max(0.1, Math.min(20, parsed)));
}

function parseCapitalInput(value: string, fallback: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return String(Math.max(100, Math.min(100000000, parsed)));
}

function getSettingsGridClassName() {
  return "grid gap-3 sm:grid-cols-2";
}

function getWideSettingsGridClassName() {
  return "grid gap-3 lg:grid-cols-2";
}

function getModelRowsGridClassName() {
  return "mt-3 grid gap-2 sm:grid-cols-2";
}

function getMiniCardClassName() {
  return "rounded border border-[#242424] bg-[#101010] px-3 py-2";
}

function getResetButtonClassName() {
  return "rounded border border-[#2a2a2a] px-3 py-2 text-xs text-[#ccc] transition-colors hover:border-[#ffd740] hover:text-[#ffd740]";
}

function getPrimaryTextClassName() {
  return "text-sm font-semibold text-[#ccc]";
}

function getMutedTextClassName() {
  return "text-xs text-[#888]";
}

function getSubtleTextClassName() {
  return "text-[10px] text-[#555]";
}

function getAccentValueClassName() {
  return "text-xs font-semibold text-[#ffd740]";
}

function getSectionHeaderClassName() {
  return "flex items-center justify-between gap-3";
}

function getFormGridThreeClassName() {
  return "grid gap-3 sm:grid-cols-3";
}

function getFormGridTwoClassName() {
  return "grid gap-3 sm:grid-cols-2";
}

function getSliderValueLabel(value: number, suffix = ""): string {
  return `${formatDecimal(value)}${suffix}`;
}

function getSettingsNoteClassName() {
  return "rounded border border-[#2a2a2a] bg-[#111] px-3 py-2 text-[11px] text-[#777]";
}

function getModelLoadingLabel(isLoading: boolean, isError: boolean): string {
  if (isLoading) return "正在讀取系統模型設定…";
  if (isError) return "模型設定讀取失敗，先顯示已知資訊。";
  return "以下資訊由系統動態回傳，方便核對目前實際模型與執行環境。";
}

function getSettingsSectionTitleClassName() {
  return "text-xs text-[#888] mb-3";
}

function getRangeRowClassName() {
  return "rounded border border-[#242424] bg-[#101010] p-3";
}

function getSmallBadgeClassName() {
  return "inline-flex items-center rounded-full border border-[#2a2a2a] bg-[#101010] px-2 py-1 text-[10px] text-[#8a8a8a]";
}

function getSelectClassName() {
  return settingInputClassName();
}

function getInputClassName() {
  return settingInputClassName();
}

function getSliderHintClassName() {
  return "mt-1 flex items-center justify-between text-[10px] text-[#555]";
}

function getInfoPanelClassName() {
  return "space-y-4";
}

function getSettingsDescriptionClassName() {
  return "text-[11px] text-[#666] leading-relaxed";
}

function getValueTextClassName() {
  return "mt-1 text-sm font-medium text-[#ddd] break-all";
}

function getInlineGroupClassName() {
  return "flex flex-wrap items-center gap-2";
}

function getPillClassName(active = false) {
  return `rounded-full border px-2 py-1 text-[10px] ${active ? "border-[#ffd740] text-[#ffd740] bg-[#ffd740]/10" : "border-[#2a2a2a] text-[#666]"}`;
}

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 100)   return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

// ─────────────────────────────────────────────────────────────────────────────
// 改良 1-4：共識評分輔助函數（含 bgColor）
// ─────────────────────────────────────────────────────────────────────────────
function getConsensusLabel(score: number | null): { label: string; color: string; bgColor: string } {
  if (score === null) return { label: "—", color: "text-[#888]", bgColor: "#888" };
  if (score >= 70) return { label: "強烈看多", color: "text-[#00e676]", bgColor: "#00e676" };
  if (score >= 55) return { label: "看多", color: "text-[#4caf50]", bgColor: "#4caf50" };
  if (score >= 45) return { label: "分歧", color: "text-[#ffd740]", bgColor: "#ffd740" };
  if (score >= 30) return { label: "看空", color: "text-[#ef5350]", bgColor: "#ef5350" };
  return { label: "強烈看空", color: "text-[#f44336]", bgColor: "#f44336" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 改良 1-4：環形儀表盤元件
// ─────────────────────────────────────────────────────────────────────────────
function ConsensusGauge({ score, size = 80 }: { score: number | null; size?: number }) {
  const { label, bgColor } = getConsensusLabel(score);
  const radius = (size - 10) / 2;
  const circumference = Math.PI * radius;
  const pct = score !== null ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const strokeDashoffset = circumference * (1 - pct);
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`}>
        <path d={`M 5 ${size / 2 + 5} A ${radius} ${radius} 0 0 1 ${size - 5} ${size / 2 + 5}`}
          fill="none" stroke="#1e1e1e" strokeWidth="8" strokeLinecap="round" />
        {score !== null && (
          <path d={`M 5 ${size / 2 + 5} A ${radius} ${radius} 0 0 1 ${size - 5} ${size / 2 + 5}`}
            fill="none" stroke={bgColor} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            style={{ transition: "stroke-dashoffset 0.5s ease" }} />
        )}
        <text x={size / 2} y={size / 2 + 2} textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold" fontFamily="monospace">
          {score !== null ? score.toFixed(0) : "—"}
        </text>
      </svg>
      <div className="text-[10px] mt-0.5" style={{ color: bgColor }}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 改良 1-3：可折疊區塊（資訊密度分層）
// ─────────────────────────────────────────────────────────────────────────────
function CollapsibleSection({ title, children, defaultOpen = false, storageKey }: {
  title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; storageKey?: string;
}) {
  const [open, setOpen] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`section_${storageKey}`);
      if (saved !== null) return saved === "true";
    }
    return defaultOpen;
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) localStorage.setItem(`section_${storageKey}`, String(next));
  };
  return (
    <div>
      <button onClick={toggle} className="w-full flex items-center justify-between px-3 py-2 text-xs text-[#888] hover:text-[#ccc] transition-colors"
        style={{ background: "#0d0d0d", borderBottom: "1px solid #1e1e1e" }}>
        <span className="font-medium">{title}</span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && children}
    </div>
  );
}

function CompactAnalysisShell({
  icon,
  title,
  subtitle,
  badges = [],
  defaultOpen = false,
  storageKey,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badges?: string[];
  defaultOpen?: boolean;
  storageKey: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(`compact_panel_${storageKey}`);
    if (saved !== null) return saved === "true";
    return defaultOpen;
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(`compact_panel_${storageKey}`, String(next));
  };

  return (
    <div className="overflow-hidden rounded-xl border" style={{ background: "#111", borderColor: "#242424" }}>
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#171717]"
      >
        <div className="min-w-0 flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#2a2a2a] bg-[#161616] text-sm text-[#ffd740]">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-[#8a8a8a]">{subtitle}</div>
            {badges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[#9a9a9a]">
                {badges.map((badge) => (
                  <span key={badge} className="rounded-full border border-[#2a2a2a] px-2 py-0.5">{badge}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-[#2a2a2a] px-2.5 py-1 text-[10px] text-[#888]">
          {open ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          <span>{open ? "收合" : "展開"}</span>
        </div>
      </button>
      {open && <div className="border-t border-[#1e1e1e] p-3">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 改良 4-3：AI 可解釋性面板
// ─────────────────────────────────────────────────────────────────────────────
function AIExplainPanel({ snapshot }: { snapshot: CryptoSnapshot | null }) {
  if (!snapshot) return null;
  const consensus = snapshot.consensus as unknown as {
    bullish_factors?: string[]; bearish_factors?: string[];
  };
  const bullFactors = consensus.bullish_factors ?? [];
  const bearFactors = consensus.bearish_factors ?? [];

  const derivedSubsystems: Array<{ name: string; score: number; direction: string; color: string }> = [];
  const smcTrend = (snapshot.smc as unknown as { trend?: string })?.trend;
  if (smcTrend) derivedSubsystems.push({
    name: "SMC 結構", score: smcTrend === "bullish" ? 75 : smcTrend === "bearish" ? 25 : 50,
    direction: smcTrend === "bullish" ? "看多" : smcTrend === "bearish" ? "看空" : "中性",
    color: smcTrend === "bullish" ? "#4caf50" : smcTrend === "bearish" ? "#ef5350" : "#ffd740",
  });
  const paTrend = (snapshot.pa as unknown as { trend?: string })?.trend;
  if (paTrend) derivedSubsystems.push({
    name: "PA 分析", score: paTrend === "bullish" ? 70 : paTrend === "bearish" ? 30 : 50,
    direction: paTrend === "bullish" ? "看多" : paTrend === "bearish" ? "看空" : "中性",
    color: paTrend === "bullish" ? "#4caf50" : paTrend === "bearish" ? "#ef5350" : "#ffd740",
  });
  const chanTrend = snapshot.chan_mtf?.summary?.overall_trend;
  if (chanTrend) derivedSubsystems.push({
    name: "纏論", score: chanTrend === "bullish" ? 72 : chanTrend === "bearish" ? 28 : 50,
    direction: chanTrend === "bullish" ? "看多" : chanTrend === "bearish" ? "看空" : "中性",
    color: chanTrend === "bullish" ? "#4caf50" : chanTrend === "bearish" ? "#ef5350" : "#ffd740",
  });
  const rsi = snapshot.indicators?.rsi;
  if (rsi !== undefined) {
    const rsiNum = typeof rsi === "number" ? rsi : (rsi as unknown as { value?: number })?.value ?? 50;
    derivedSubsystems.push({
      name: "RSI 指標", score: rsiNum > 70 ? 80 : rsiNum < 30 ? 20 : rsiNum,
      direction: rsiNum > 60 ? "偏多" : rsiNum < 40 ? "偏空" : "中性",
      color: rsiNum > 60 ? "#4caf50" : rsiNum < 40 ? "#ef5350" : "#ffd740",
    });
  }
  const fundingRate = (snapshot.onchain as unknown as { funding_rate?: { rate?: number } })?.funding_rate?.rate;
  if (fundingRate !== undefined) derivedSubsystems.push({
    name: "鏈上數據", score: fundingRate > 0.001 ? 65 : fundingRate < -0.001 ? 35 : 50,
    direction: fundingRate > 0.001 ? "偏多" : fundingRate < -0.001 ? "偏空" : "中性",
    color: fundingRate > 0.001 ? "#4caf50" : fundingRate < -0.001 ? "#ef5350" : "#ffd740",
  });

  const bullCount = derivedSubsystems.filter(s => s.score >= 55).length;
  const bearCount = derivedSubsystems.filter(s => s.score <= 45).length;

  return (
    <div className="space-y-3">
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #1e1e1e" }}>
        <div className="px-3 py-2 text-xs font-semibold text-[#ccc] flex items-center justify-between"
          style={{ background: "#0d0d0d", borderBottom: "1px solid #1e1e1e" }}>
          <span>子系統評分</span>
          <span className="text-[10px] font-normal text-[#888]">{bullCount} 看多 / {bearCount} 看空</span>
        </div>
        <div className="p-2 space-y-1.5" style={{ background: "#111" }}>
          {derivedSubsystems.map((sys, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="text-[11px] text-[#888] w-16 shrink-0">{sys.name}</div>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#1e1e1e" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${sys.score}%`, background: sys.color }} />
              </div>
              <div className="text-[10px] w-8 text-right shrink-0" style={{ color: sys.color }}>{sys.direction}</div>
            </div>
          ))}
        </div>
      </div>
      {(bullFactors.length > 0 || bearFactors.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded p-2" style={{ background: "#0d1a0d", border: "1px solid #1a3a1a" }}>
            <div className="text-[10px] text-[#4caf50] font-semibold mb-1.5 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> 看多因素
            </div>
            {bullFactors.slice(0, 4).map((f, i) => (
              <div key={i} className="text-[10px] text-[#aaa] mb-0.5">· {f}</div>
            ))}
          </div>
          <div className="rounded p-2" style={{ background: "#1a0d0d", border: "1px solid #3a1a1a" }}>
            <div className="text-[10px] text-[#ef5350] font-semibold mb-1.5 flex items-center gap-1">
              <TrendingDown className="w-3 h-3" /> 看空因素
            </div>
            {bearFactors.slice(0, 4).map((f, i) => (
              <div key={i} className="text-[10px] text-[#aaa] mb-0.5">· {f}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 改良 2-3：交易日誌
// ─────────────────────────────────────────────────────────────────────────────
function TradeJournalPanel({ symbol, snapshot }: { symbol: string; snapshot: CryptoSnapshot | null }) {
  type Trade = {
    id: string; symbol: string; direction: "long" | "short";
    entryPrice: number; exitPrice?: number; stopLoss?: number; takeProfit?: number;
    status: "open" | "closed"; aiScore?: number; createdAt: Date; note?: string;
  };
  const [trades, setTrades] = useState<Trade[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("trade_journal") ?? "[]").map((t: unknown) => ({
        ...(t as object), createdAt: new Date((t as { createdAt: string }).createdAt),
      }));
    } catch { return []; }
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    direction: "long" as "long" | "short",
    entryPrice: "", stopLoss: "", takeProfit: "", note: "",
  });

  useEffect(() => {
    if (snapshot?.strategy) {
      setForm(prev => ({
        ...prev,
        entryPrice: String(snapshot.strategy.entry ?? prev.entryPrice),
        stopLoss: String(snapshot.strategy.sl ?? prev.stopLoss),
        takeProfit: String(snapshot.strategy.tp1 ?? prev.takeProfit),
        direction: snapshot.strategy.direction === "long" ? "long" : "short",
      }));
    }
  }, [snapshot]);

  const saveTrade = () => {
    // ★ 修復：加入輸入驗證，防止無效資料寫入
    const entryPrice = parseFloat(form.entryPrice);
    const stopLoss   = form.stopLoss   ? parseFloat(form.stopLoss)   : undefined;
    const takeProfit = form.takeProfit ? parseFloat(form.takeProfit) : undefined;

    if (!form.entryPrice || isNaN(entryPrice) || entryPrice <= 0) {
      toast.error("請輸入有效的進場價格（必須大於 0）");
      return;
    }
    if (entryPrice > 10_000_000) {
      toast.error("進場價格超出合理範圍");
      return;
    }
    if (stopLoss !== undefined && (isNaN(stopLoss) || stopLoss <= 0)) {
      toast.error("止損價格必須大於 0");
      return;
    }
    if (takeProfit !== undefined && (isNaN(takeProfit) || takeProfit <= 0)) {
      toast.error("止盈價格必須大於 0");
      return;
    }
    // 方向邏輯驗證
    if (stopLoss !== undefined) {
      if (form.direction === "long"  && stopLoss >= entryPrice) { toast.error("做多時止損必須低於進場價"); return; }
      if (form.direction === "short" && stopLoss <= entryPrice) { toast.error("做空時止損必須高於進場價"); return; }
    }
    if (takeProfit !== undefined) {
      if (form.direction === "long"  && takeProfit <= entryPrice) { toast.error("做多時止盈必須高於進場價"); return; }
      if (form.direction === "short" && takeProfit >= entryPrice) { toast.error("做空時止盈必須低於進場價"); return; }
    }
    // note 長度限制
    const note = form.note.slice(0, 500);

    const newTrade: Trade = {
      id: Date.now().toString(), symbol, direction: form.direction,
      entryPrice, stopLoss, takeProfit,
      status: "open",
      aiScore: (snapshot?.consensus as unknown as { score?: number })?.score ?? undefined,
      createdAt: new Date(), note,
    };
    const updated = [newTrade, ...trades].slice(0, 500); // 最多保留 500 筆
    setTrades(updated);
    try {
      localStorage.setItem("trade_journal", JSON.stringify(updated));
    } catch (e) {
      // localStorage 可能已滿
      toast.error("儲存失敗：本地儲存空間不足，請清理舊記錄");
      return;
    }
    setShowForm(false);
    toast.success("交易記錄已新增！");
  };

  const closedTrades = trades.filter(t => t.status === "closed" && t.exitPrice);
  const winTrades = closedTrades.filter(t => {
    const pnl = t.direction === "long" ? (t.exitPrice! - t.entryPrice) : (t.entryPrice - t.exitPrice!);
    return pnl > 0;
  });
  const winRate = closedTrades.length > 0 ? (winTrades.length / closedTrades.length * 100).toFixed(1) : "—";
  const totalPnl = closedTrades.reduce((sum, t) => {
    const pnl = t.direction === "long"
      ? (t.exitPrice! - t.entryPrice) / t.entryPrice * 100
      : (t.entryPrice - t.exitPrice!) / t.entryPrice * 100;
    return sum + pnl;
  }, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "勝率", value: winRate === "—" ? "—" : `${winRate}%`, color: "#4caf50" },
          { label: "已結算", value: String(closedTrades.length), color: "#ccc" },
          { label: "總盈虧", value: closedTrades.length > 0 ? `${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}%` : "—", color: totalPnl >= 0 ? "#4caf50" : "#ef5350" },
        ].map((stat, i) => (
          <div key={i} className="rounded p-2 text-center" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
            <div className="text-[10px] text-[#555] mb-0.5">{stat.label}</div>
            <div className="text-sm font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>
      <button onClick={() => setShowForm(!showForm)} className="w-full py-2 rounded text-xs font-medium transition-colors"
        style={{ background: "#1a3a1a", border: "1px solid #2a5a2a", color: "#4caf50" }}>
        + 新增交易記錄
      </button>
      {showForm && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: "#111", border: "1px solid #2a2a2a" }}>
          <div className="grid grid-cols-2 gap-2">
            {(["long", "short"] as const).map(dir => (
              <button key={dir} onClick={() => setForm(f => ({ ...f, direction: dir }))}
                className="py-1.5 rounded text-xs font-medium transition-colors"
                style={{
                  background: form.direction === dir ? (dir === "long" ? "#1a3a1a" : "#3a1a1a") : "#161616",
                  border: `1px solid ${form.direction === dir ? (dir === "long" ? "#4caf50" : "#ef5350") : "#2a2a2a"}`,
                  color: form.direction === dir ? (dir === "long" ? "#4caf50" : "#ef5350") : "#888",
                }}>
                {dir === "long" ? "做多 Long" : "做空 Short"}
              </button>
            ))}
          </div>
          {[{ key: "entryPrice", label: "進場價" }, { key: "stopLoss", label: "止損價" }, { key: "takeProfit", label: "止盈價" }].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <label className="text-[10px] text-[#888] w-12 shrink-0">{label}</label>
              <input value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="flex-1 text-xs px-2 py-1 rounded border bg-[#0d0d0d] text-[#ccc] focus:outline-none"
                style={{ borderColor: "#2a2a2a" }} placeholder="0.00" />
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={saveTrade} className="flex-1 py-1.5 rounded text-xs font-medium" style={{ background: "#4caf50", color: "#000" }}>確認新增</button>
            <button onClick={() => setShowForm(false)} className="flex-1 py-1.5 rounded text-xs" style={{ background: "#1e1e1e", color: "#888", border: "1px solid #2a2a2a" }}>取消</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {trades.length === 0 && <div className="text-center text-[#555] text-xs py-6">尚無交易記錄</div>}
        {trades.slice(0, 8).map(trade => {
          const pnl = trade.exitPrice
            ? (trade.direction === "long" ? (trade.exitPrice - trade.entryPrice) / trade.entryPrice * 100 : (trade.entryPrice - trade.exitPrice) / trade.entryPrice * 100)
            : null;
          return (
            <div key={trade.id} className="rounded p-2.5" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold" style={{ color: trade.direction === "long" ? "#4caf50" : "#ef5350" }}>
                    {trade.direction === "long" ? "▲ 做多" : "▼ 做空"}
                  </span>
                  {trade.aiScore !== undefined && (
                    <span className="text-[9px] px-1 rounded" style={{ background: "#1e1e1e", color: "#ffd740" }}>AI {trade.aiScore.toFixed(0)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {pnl !== null && <span className="text-xs font-mono font-bold" style={{ color: pnl >= 0 ? "#4caf50" : "#ef5350" }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%</span>}
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: trade.status === "open" ? "#1a3a1a" : "#1e1e1e", color: trade.status === "open" ? "#4caf50" : "#888" }}>
                    {trade.status === "open" ? "持倉中" : "已結算"}
                  </span>
                </div>
              </div>
              <div className="flex gap-3 text-[10px] text-[#888]">
                <span>進場 <span className="text-[#ccc] font-mono">{formatPrice(trade.entryPrice)}</span></span>
                {trade.stopLoss && <span>止損 <span className="text-[#ef5350] font-mono">{formatPrice(trade.stopLoss)}</span></span>}
                {trade.takeProfit && <span>止盈 <span className="text-[#4caf50] font-mono">{formatPrice(trade.takeProfit)}</span></span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 改良 2-5：智能警報
// ─────────────────────────────────────────────────────────────────────────────
function SmartAlertsPanel({ symbol, snapshot, currentPrice }: {
  symbol: string; snapshot: CryptoSnapshot | null; currentPrice: number | null;
}) {
  type Alert = {
    id: string; symbol: string; type: "price" | "consensus" | "rsi";
    condition: "above" | "below"; value: number; label: string; triggered: boolean; createdAt: Date;
  };
  const [alerts, setAlerts] = useState<Alert[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("smart_alerts") ?? "[]").map((a: unknown) => ({
        ...(a as object), createdAt: new Date((a as { createdAt: string }).createdAt),
      }));
    } catch { return []; }
  });
  const [form, setForm] = useState({ type: "price", condition: "above", value: "", label: "" });

  useEffect(() => {
    if (!currentPrice) return;
    const consensusScore = (snapshot?.consensus as unknown as { score?: number })?.score;
    const rsiVal = typeof snapshot?.indicators?.rsi === "number" ? snapshot.indicators.rsi : undefined;
    const updated = alerts.map(alert => {
      if (alert.triggered) return alert;
      let currentVal: number | undefined;
      if (alert.type === "price") currentVal = currentPrice;
      else if (alert.type === "consensus") currentVal = consensusScore;
      else if (alert.type === "rsi") currentVal = rsiVal;
      if (currentVal === undefined) return alert;
      const triggered = (alert.condition === "above" && currentVal >= alert.value) || (alert.condition === "below" && currentVal <= alert.value);
      if (triggered) {
        toast.success(`🔔 警報觸發：${alert.label || `${alert.type} ${alert.condition} ${alert.value}`}`);
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(`Crypto Alert: ${symbol}`, { body: alert.label || `${alert.type} ${alert.condition} ${alert.value}` });
        }
      }
      return triggered ? { ...alert, triggered } : alert;
    });
    if (JSON.stringify(updated) !== JSON.stringify(alerts)) {
      setAlerts(updated);
      localStorage.setItem("smart_alerts", JSON.stringify(updated));
    }
  }, [currentPrice, snapshot, alerts, symbol]);

  const addAlert = () => {
    if (!form.value) return;
    const newAlert: Alert = {
      id: Date.now().toString(), symbol, type: form.type as "price" | "consensus" | "rsi",
      condition: form.condition as "above" | "below", value: parseFloat(form.value),
      label: form.label, triggered: false, createdAt: new Date(),
    };
    const updated = [newAlert, ...alerts];
    setAlerts(updated);
    localStorage.setItem("smart_alerts", JSON.stringify(updated));
    setForm({ type: "price", condition: "above", value: "", label: "" });
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    toast.success("警報已設定！");
  };

  const removeAlert = (id: string) => {
    const updated = alerts.filter(a => a.id !== id);
    setAlerts(updated);
    localStorage.setItem("smart_alerts", JSON.stringify(updated));
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg p-3 space-y-2" style={{ background: "#111", border: "1px solid #2a2a2a" }}>
        <div className="text-xs font-semibold text-[#ccc]">新增智能警報</div>
        <div className="grid grid-cols-2 gap-2">
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            className="text-xs px-2 py-1.5 rounded border bg-[#0d0d0d] text-[#ccc] focus:outline-none" style={{ borderColor: "#2a2a2a" }}>
            <option value="price">價格</option>
            <option value="consensus">共識評分</option>
            <option value="rsi">RSI</option>
          </select>
          <select value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
            className="text-xs px-2 py-1.5 rounded border bg-[#0d0d0d] text-[#ccc] focus:outline-none" style={{ borderColor: "#2a2a2a" }}>
            <option value="above">高於</option>
            <option value="below">低於</option>
          </select>
        </div>
        <input value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
          placeholder="數值" className="w-full text-xs px-2 py-1.5 rounded border bg-[#0d0d0d] text-[#ccc] focus:outline-none" style={{ borderColor: "#2a2a2a" }} />
        <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          placeholder="警報說明（可選）" className="w-full text-xs px-2 py-1.5 rounded border bg-[#0d0d0d] text-[#ccc] focus:outline-none" style={{ borderColor: "#2a2a2a" }} />
        <button onClick={addAlert} disabled={!form.value} className="w-full py-1.5 rounded text-xs font-medium disabled:opacity-40" style={{ background: "#ffd740", color: "#000" }}>
          設定警報
        </button>
      </div>
      <div className="space-y-2">
        {alerts.filter(a => a.symbol === symbol).length === 0 && <div className="text-center text-[#555] text-xs py-4">尚無警報</div>}
        {alerts.filter(a => a.symbol === symbol).map(alert => (
          <div key={alert.id} className="flex items-center justify-between rounded p-2.5"
            style={{ background: alert.triggered ? "#1a2a1a" : "#161616", border: `1px solid ${alert.triggered ? "#2a5a2a" : "#2a2a2a"}` }}>
            <div>
              <div className="text-xs text-[#ccc]">{alert.label || `${alert.type} ${alert.condition === "above" ? "高於" : "低於"} ${alert.value}`}</div>
              <div className="text-[10px] text-[#555]">{alert.type} · {alert.condition === "above" ? ">" : "<"} {alert.value}</div>
            </div>
            <div className="flex items-center gap-2">
              {alert.triggered && <span className="text-[10px] text-[#4caf50]">已觸發</span>}
              <button onClick={() => removeAlert(alert.id)} className="text-[#555] hover:text-[#ef5350] transition-colors">
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type LatestLiveSnapshotSummary = {
  generated_at?: string;
  active_presets?: Array<{
    key?: string;
    label?: string;
    strategy?: string;
    interval?: string;
    family?: string;
    governance?: {
      min_filtered_trades?: number;
      max_signal_age_bars?: number;
      min_signal_score?: number;
      summary?: string;
    };
  }>;
  signals?: Array<{
    preset?: { key?: string; label?: string };
    preset_key?: string;
    direction?: string;
    entry_price?: number;
    signal_time?: number;
    used_15m_execution?: boolean;
    alert_key?: string;
  }>;
  dispatch_results?: Array<{
    preset_key?: string;
    alert_key?: string;
    status?: "sent" | "failed" | "duplicate_skip";
    error?: string;
    sent_at?: string;
  }>;
  strategy_errors?: Array<{
    preset_key?: string;
    label?: string;
    error?: string;
  }>;
  state_overview?: {
    last_checked_at?: string;
    last_error_message?: string;
    history_window?: number;
    strategies?: Record<string, {
      last_alert_key?: string;
      last_entry_time?: number;
      last_sent_at?: string;
      last_status?: "sent" | "duplicate_skip" | "blocked" | "idle" | "error";
      last_direction?: string;
      last_filter_reason?: string | null;
      filtered_trades?: number;
      filtered_win_rate?: number;
      governance_summary?: string;
      checked_at?: string;
      history?: Array<{
        checked_at?: string;
        status?: "sent" | "duplicate_skip" | "blocked" | "idle" | "error";
        reason?: string | null;
        reason_code?: string | null;
        direction?: string | null;
        filtered_trades?: number;
        filtered_win_rate?: number;
      }>;
      diagnostics?: {
        total_rounds?: number;
        blocked_rounds?: number;
        sent_rounds?: number;
        duplicate_rounds?: number;
        idle_rounds?: number;
        error_rounds?: number;
        blocked_rate?: number;
        sent_rate?: number;
        top_blockers?: Array<{
          reason?: string;
          count?: number;
        }>;
      };
    }>;
  };
  diagnostics_enrichment?: {
    family_aggregations?: Array<{
      family?: string;
      family_label?: string;
      strategy_count?: number;
      total_rounds?: number;
      blocked_rounds?: number;
      sent_rounds?: number;
      duplicate_rounds?: number;
      idle_rounds?: number;
      error_rounds?: number;
      blocked_rate?: number;
      sent_rate?: number;
      active_rate?: number;
      top_blockers?: Array<{ reason?: string; count?: number }>;
      strategies?: string[];
    }>;
    threshold_suggestions?: Array<{
      strategy_key?: string;
      strategy_label?: string;
      family?: string;
      severity?: "info" | "warning" | "critical";
      category?: string;
      current_value?: string;
      suggested_action?: string;
      reason?: string;
    }>;
    strategy_trends?: Record<string, Array<{
      status?: "sent" | "duplicate_skip" | "blocked" | "idle" | "error";
      reason_code?: string | null;
    }>>;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const [symbol, setSymbol]           = useState("BTCUSDT");
  const [symbolInput, setSymbolInput] = useState("");
  const [showSymbolSearch, setShowSymbolSearch] = useState(false);
  const [activeCategory, setActiveCategory] = useState("technical");
  const [activeTab, setActiveTab]     = useState("indicators");
  const [newsSubTab, setNewsSubTab]   = useState<"news" | "tweets">("news");
  const [activeEmas, setActiveEmas]   = useState<number[]>([20, 50]);
  const [showWidgetMgr, setShowWidgetMgr] = useState(false);
  const [widgetIds, setWidgetIds]     = useState<string[]>(DEFAULT_WIDGET_IDS);
  const [snapshot, setSnapshot]       = useState<CryptoSnapshot | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [watchlist, setWatchlist]     = useState<string[]>([]);
  const [showExplain, setShowExplain] = useState(false);
  const [nextRefreshSecs, setNextRefreshSecs] = useState<number | null>(null);
  const [latestLiveSnapshot, setLatestLiveSnapshot] = useState<LatestLiveSnapshotSummary | null>(null);
  const isMobile = useIsMobile();
  const [showMobileCategoryMenu, setShowMobileCategoryMenu] = useState(false);
  const [showMobileTabMenu, setShowMobileTabMenu] = useState(false);
  const [showMobileHeroDetails, setShowMobileHeroDetails] = useState(false);
  const [showLivePresetDetails, setShowLivePresetDetails] = useState(false);
  const [showMobileIndicators, setShowMobileIndicators] = useState(false);
  const [mobileKlineTf, setMobileKlineTf] = useState<Timeframe>("1h");
  const [expandedKlineCards, setExpandedKlineCards] = useState<Timeframe[]>([]);
  const lastAnalyzedPriceRef = useRef<number | null>(null);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAnalyzeSymbolRef = useRef<string | null>(null);

  // Phase 7：使用新的後端 WebSocket（/ws），自動回退到 Binance 直連
  const {
    livePrice,
    change24h,
    isLive,
    status: wsStatus,
    latency: wsLatency,
    provider: wsProvider,
    lastUpdateTs: wsLastUpdateTs,
    message: wsMessage,
  } = useLiveTicker(symbol, true);
  // 保留舊 hook 作為備用（若新 hook 無資料時使用）
  const { livePrice: fallbackPrice } = useKlineWebSocket({
    symbol, timeframe: "1h", enabled: !isLive, mode: "ticker",
  });
  const effectiveLivePrice = livePrice ?? fallbackPrice;

  const widgetPrefsQuery = trpc.widgets.getPrefs.useQuery(
    { openId: user?.openId ?? undefined }, { enabled: !!user?.openId }
  );
  const saveWidgetPrefsMutation = trpc.widgets.savePrefs.useMutation();
  useEffect(() => {
    if (widgetPrefsQuery.data) setWidgetIds(widgetPrefsQuery.data);
  }, [widgetPrefsQuery.data]);

  // 修復 C：動態讀取實際模型配置
  const systemConfigQuery = trpc.system.config.useQuery(undefined, { staleTime: 300_000 });
  // 修復 D / H：全局設定與 CannonBall 預設值持久化
  const [globalCapital, setGlobalCapital] = useState<string>(() => getInitialGlobalSetting("global_capital", "10000"));
  const [globalRiskPct, setGlobalRiskPct] = useState<string>(() => getInitialGlobalSetting("global_risk_pct", "1"));
  const [refreshIntervalSecs, setRefreshIntervalSecs] = useState<number>(() => getInitialRefreshInterval());
  const [cannonballDefaults, setCannonballDefaults] = useState<CannonballSettings>(() => getInitialCannonballSettings());
  useEffect(() => { localStorage.setItem("global_capital", globalCapital); }, [globalCapital]);
  useEffect(() => { localStorage.setItem("global_risk_pct", globalRiskPct); }, [globalRiskPct]);
  useEffect(() => { localStorage.setItem("global_refresh_interval_secs", String(refreshIntervalSecs)); }, [refreshIntervalSecs]);
  useEffect(() => { localStorage.setItem(CANNONBALL_SETTINGS_KEY, JSON.stringify(cannonballDefaults)); }, [cannonballDefaults]);

  const utils = trpc.useUtils();

  useEffect(() => {
    let cancelled = false;
    const loadLatestLiveSnapshot = async () => {
      try {
        const response = await fetch("/api/latest-live-snapshot");
        const payload = await response.json();
        if (!cancelled && payload?.ok) {
          setLatestLiveSnapshot(payload.data as LatestLiveSnapshotSummary);
        }
      } catch {
        if (!cancelled) setLatestLiveSnapshot(null);
      }
    };
    void loadLatestLiveSnapshot();
    const timer = window.setInterval(loadLatestLiveSnapshot, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // 改良 1-5：智能刷新（ATR 驅動）
  const setupAutoRefresh = useCallback((atr: number | null) => {
    if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    const REFRESH_INTERVAL = refreshIntervalSecs;
    setNextRefreshSecs(REFRESH_INTERVAL);
    countdownTimerRef.current = setInterval(() => {
      setNextRefreshSecs(prev => {
        if (prev === null || prev <= 1) return REFRESH_INTERVAL;
        if (atr && effectiveLivePrice && lastAnalyzedPriceRef.current) {
          const deviation = Math.abs(effectiveLivePrice - lastAnalyzedPriceRef.current);
          if (deviation > atr * 0.5) return 1;
        }
        return prev - 1;
      });
    }, 1000);
    autoRefreshTimerRef.current = setInterval(() => { handleAnalyze(); }, REFRESH_INTERVAL * 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveLivePrice, refreshIntervalSecs]);

  useEffect(() => {
    return () => {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  const handleAnalyze = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    setIsAnalyzing(true);
    if (!silent) toast.info(`正在分析 ${symbol}，請稍候...`);
    try {
      const result = await utils.crypto.getSnapshot.fetch({ symbol }, { staleTime: 0 });
      if (result) {
        setSnapshot(result as CryptoSnapshot);
        setLastUpdated(new Date());
        lastAnalyzedPriceRef.current = (result as CryptoSnapshot).live_price;
        const atr = (result as CryptoSnapshot).indicators?.atr ?? null;
        setupAutoRefresh(atr);
        if (!silent) toast.success("分析完成！");
      } else if (!silent) {
        toast.error("分析返回空結果，請重試");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(formatFriendlyRuntimeError(msg));
    } finally {
      setIsAnalyzing(false);
    }
  }, [symbol, utils, setupAutoRefresh]);

  useEffect(() => {
    if (autoAnalyzeSymbolRef.current === symbol) return;
    autoAnalyzeSymbolRef.current = symbol;
    void handleAnalyze({ silent: true });
  }, [symbol, handleAnalyze]);

  const handleWidgetSave = (ids: string[]) => {
    setWidgetIds(ids);
    if (user?.openId) saveWidgetPrefsMutation.mutate({ openId: user.openId, widgetIds: ids });
  };

  const toggleWatchlist = () => {
    setWatchlist(prev => prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]);
  };

  const toggleEma = (period: number) => {
    setActiveEmas(prev => prev.includes(period) ? prev.filter(p => p !== period) : [...prev, period]);
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setActiveCategory(getCategoryForTab(tabId));
    if (isMobile) setShowMobileTabMenu(false);
  };

  const handleCategoryChange = (catId: string) => {
    setActiveCategory(catId);
    if (isMobile) {
      setShowMobileCategoryMenu(false);
      setShowMobileTabMenu(false);
    }
    const cat = NAV_CATEGORIES.find(c => c.id === catId);
    if (cat && cat.tabs.length > 0) setActiveTab(cat.tabs[0].id);
  };

  // Derived
  const displayPrice = effectiveLivePrice ?? snapshot?.live_price ?? null;
  const symbolInfo = SUPPORTED_SYMBOLS.find(s => s.value === symbol);
  const symbolBase = symbol.replace("USDT", "");
  const consensusScore = (snapshot?.consensus as unknown as { score?: number })?.score ?? null;
  const { label: consensusLabel, color: consensusColor, bgColor: consensusBgColor } = getConsensusLabel(consensusScore);
  const latestLiveSignal = latestLiveSnapshot?.signals?.[0] ?? null;
  const direction = snapshot?.strategy?.direction
    ?? (latestLiveSignal?.direction === "long" || latestLiveSignal?.direction === "short" ? latestLiveSignal.direction : null);
  const bullPct = consensusScore !== null ? Math.max(5, Math.min(90, consensusScore)) : null;
  const bearPct = bullPct !== null ? Math.max(5, Math.min(85, 100 - bullPct - 10)) : null;
  const sidePct = bullPct !== null && bearPct !== null ? Math.max(5, 100 - bullPct - bearPct) : null;
  const decisionConfig = direction === "long"
    ? {
        title: "偏多",
        subtitle: "等待回踩確認後優先找做多機會",
        color: "#4caf50",
        bg: "rgba(76,175,80,0.12)",
        border: "#245b2a",
      }
    : direction === "short"
      ? {
          title: "偏空",
          subtitle: "等待反彈確認後優先找做空機會",
          color: "#ef5350",
          bg: "rgba(239,83,80,0.12)",
          border: "#6b2a28",
        }
      : {
          title: "觀望",
          subtitle: "方向仍在整理，先等待突破與共振確認",
          color: "#ffd740",
          bg: "rgba(255,215,64,0.12)",
          border: "#6b5a1b",
        };
  const liveSnapshotSummary = !snapshot && latestLiveSnapshot && symbol === "BTCUSDT"
    ? latestLiveSignal
      ? `實盤快照最近檢出${latestLiveSignal.direction === "long" ? "做多" : latestLiveSignal.direction === "short" ? "做空" : "方向待確認"}信號，主決策卡先以即時價格與策略快照輔助判讀。`
      : `目前共有 ${latestLiveSnapshot.active_presets?.length ?? 0} 個實盤策略待命，主決策卡先以實盤快照摘要顯示。`
    : null;
  const liveStrategyStateMap = latestLiveSnapshot?.state_overview?.strategies ?? {};
  const livePresetSummaries = latestLiveSnapshot?.active_presets?.slice(0, 2).map((preset, index) => {
    const presetKey = preset.key ?? `preset_${index}`;
    const matchedSignal = latestLiveSnapshot?.signals?.find((signal) => (signal.preset?.key ?? signal.preset_key) === preset.key);
    const matchedDispatch = latestLiveSnapshot?.dispatch_results?.find((dispatch) => dispatch.preset_key === preset.key);
    const matchedError = latestLiveSnapshot?.strategy_errors?.find((item) => item.preset_key === preset.key);
    const state = liveStrategyStateMap[presetKey];

    const status = matchedDispatch?.status === "sent"
      ? "已發 Telegram"
      : matchedDispatch?.status === "failed"
        ? "發送失敗"
        : matchedDispatch?.status === "duplicate_skip" || state?.last_status === "duplicate_skip"
          ? "重複略過"
          : matchedSignal || state?.last_status === "sent"
            ? "已檢出信號"
            : state?.last_status === "blocked"
              ? "本輪被阻擋"
              : state?.last_status === "error"
                ? "策略錯誤"
                : state?.last_sent_at
                  ? "曾發送"
                  : "待機";

    const statusColor = matchedDispatch?.status === "sent"
      ? "#4caf50"
      : matchedDispatch?.status === "failed"
        ? "#ef5350"
        : matchedDispatch?.status === "duplicate_skip"
          ? "#38bdf8"
          : matchedSignal
            ? "#ffd740"
            : "#888";

    const directionLabel = matchedSignal?.direction === "long"
      ? "做多"
      : matchedSignal?.direction === "short"
        ? "做空"
        : direction === "long"
          ? "偏多"
          : direction === "short"
            ? "偏空"
            : "中性";

    const detailLabel = matchedDispatch?.sent_at
      ? `已發 ${new Date(matchedDispatch.sent_at).toLocaleString("zh-TW")}`
      : state?.last_sent_at
        ? `最近 ${new Date(state.last_sent_at).toLocaleString("zh-TW")}`
        : matchedError?.error
          ? "本輪檢查有錯誤"
          : state?.last_filter_reason
            ? formatFriendlyRuntimeError(state.last_filter_reason)
            : matchedSignal?.used_15m_execution
              ? "15m 共振觸發"
              : matchedSignal
                ? "1h 主信號觸發"
                : state?.governance_summary ?? preset.governance?.summary ?? "等待新信號";

    return {
      id: presetKey,
      shortLabel: preset.label?.replace(/^BTCUSDT\s*/i, "") ?? `策略 ${index + 1}`,
      key: preset.key ?? "—",
      interval: preset.interval ?? "—",
      strategy: preset.strategy ?? "—",
      status,
      statusColor,
      directionLabel,
      detailLabel,
      isHighlighted: matchedDispatch?.status === "sent",
      hasError: matchedDispatch?.status === "failed" || Boolean(matchedError) || state?.last_status === "error",
      lastSentAt: matchedDispatch?.sent_at ?? state?.last_sent_at,
      blockedReason: state?.last_filter_reason ?? null,
      governanceSummary: state?.governance_summary ?? preset.governance?.summary ?? null,
    };
  }) ?? [];

  const chanData = useMemo(() => {
    const pa = snapshot?.pa;
    if (!pa) return undefined;
    const tfData = pa.timeframes["4h"];
    if (!tfData) return undefined;
    return (tfData as { chan?: unknown }).chan as import("@shared/cryptoTypes").ChanData | undefined;
  }, [snapshot]);
  const chanMtfData = useMemo(() => {
    return snapshot?.chan_mtf as import("@shared/cryptoTypes").ChanMtfData | undefined;
  }, [snapshot]);

  const isWatchlisted = watchlist.includes(symbol);
  const filteredSymbols = symbolInput
    ? SUPPORTED_SYMBOLS.filter(s => s.value.toLowerCase().includes(symbolInput.toLowerCase()) || s.label.toLowerCase().includes(symbolInput.toLowerCase()))
    : SUPPORTED_SYMBOLS;
  const primaryMobileCategories = NAV_CATEGORIES.filter(cat => MOBILE_PRIMARY_CATEGORY_IDS.includes(cat.id));
  const secondaryMobileCategories = NAV_CATEGORIES.filter(cat => !MOBILE_PRIMARY_CATEGORY_IDS.includes(cat.id));
  const visibleNavCategories = isMobile ? primaryMobileCategories : NAV_CATEGORIES;
  const currentCategoryTabs = NAV_CATEGORIES.find(c => c.id === activeCategory)?.tabs ?? [];
  const prioritizedMobileTabs = currentCategoryTabs.filter(tab => MOBILE_PRIORITY_TAB_IDS.includes(tab.id));
  const primaryMobileTabs = (prioritizedMobileTabs.length > 0 ? prioritizedMobileTabs : currentCategoryTabs).slice(0, 4);
  const visibleCategoryTabs = isMobile ? primaryMobileTabs : currentCategoryTabs;
  const secondaryMobileTabs = currentCategoryTabs.filter(tab => !primaryMobileTabs.some(primary => primary.id === tab.id));
  const klineTimeframes: Timeframe[] = ["4h", "1h", "15m", "5m"];
  const visibleKlineTimeframes = isMobile ? [mobileKlineTf] : klineTimeframes;
  const klineCardMeta: Record<Timeframe, { label: string; description: string; accent: string }> = {
    "4h": { label: "4H 趨勢總覽", description: "先看較高週期結構與波段方向。", accent: "#8b5cf6" },
    "1h": { label: "1H 主執行圖", description: "主決策週期，適合觀察進場背景。", accent: "#ffd740" },
    "15m": { label: "15M 精細觸發", description: "縮小觀察共振與短線觸發位置。", accent: "#22c55e" },
    "5m": { label: "5M 微觀節奏", description: "只在需要時再打開查看細部波動。", accent: "#38bdf8" },
  };
  const toggleKlineCard = (tf: Timeframe) => {
    setExpandedKlineCards(prev => prev.includes(tf) ? prev.filter(item => item !== tf) : [...prev, tf]);
  };
  const expandAllKlines = () => setExpandedKlineCards([...visibleKlineTimeframes]);
  const collapseAllKlines = () => setExpandedKlineCards([]);
  const getCompactTabLabel = (tabId: string, label: string) => {
    if (!isMobile) return label;
    const compactLabels: Record<string, string> = {
      overview: "總覽",
      technical: "技術",
      strategy: "策略",
      intel: "鏈上",
      settings: "設定",
      learning: "學習",
      ict: "ICT",
      pa_louie: "PA+",
      snr_analysis: "SNR",
      champion_trader: "冠軍",
      cannonball: "CBALL",
      indicators: "技術",
      smc: "SMC",
      smc_ultimate: "終極",
      smc_confirm: "確認",
      pa: "PA",
      pa_level: "水位",
      divergence: "背離",
      chan: "纏論",
      chan_enhanced: "強化",
      strategy: "策略",
      forecast: "預測",
      onchain: "鏈上",
      consensus: "共識",
      news: "新聞",
      tweets: "推文",
      alerts: "警報",
      heatmap: "熱力",
      screener: "掃描",
      vpvr: "成交",
      history: "歷史",
      highwinrate: "高勝率",
      panda: "Panda",
      settings: "設定",
    };
    return compactLabels[tabId] ?? label;
  };

  const marketDataAgeSecs = wsLastUpdateTs ? Math.floor((Date.now() - wsLastUpdateTs) / 1000) : null;
  const hasSnapshotFallback = !isLive && displayPrice !== null;
  const marketFreshnessLabel = marketDataAgeSecs === null
    ? snapshot
      ? "使用分析快照"
      : "尚無即時資料"
    : marketDataAgeSecs < 20
      ? "即時正常"
      : marketDataAgeSecs < 45
        ? `${marketDataAgeSecs}s 前更新`
        : "即時延遲";
  const marketStatusConfig = wsStatus === "connected" && isLive
    ? { label: "即時正常", color: "#4caf50", bg: "rgba(76,175,80,0.14)", border: "#245b2a" }
    : hasSnapshotFallback
      ? { label: "快照模式", color: "#ffd740", bg: "rgba(255,215,64,0.12)", border: "#6b5a1b" }
      : wsStatus === "connecting"
        ? { label: "連線中", color: "#3b82f6", bg: "rgba(59,130,246,0.12)", border: "#1d3d6b" }
        : wsStatus === "fallback"
          ? { label: "資料降級", color: "#ffd740", bg: "rgba(255,215,64,0.12)", border: "#6b5a1b" }
          : { label: "已中斷", color: "#ef5350", bg: "rgba(239,83,80,0.12)", border: "#6b1d1d" };
  const providerLabel = wsProvider === "kraken_polling" ? "Kraken 輪詢" : "未提供";
  const marketStatusDetail = wsMessage
    ? formatFriendlyRuntimeError(wsMessage)
    : hasSnapshotFallback
      ? "即時報價暫時不可用，先以最近一次分析價格顯示。"
      : providerLabel;
  const mobileStatusCards = [
    {
      key: "stream",
      label: "即時狀態",
      value: marketStatusConfig.label,
      tone: marketStatusConfig.color,
      detail: marketStatusDetail,
    },
    {
      key: "freshness",
      label: "資料新鮮度",
      value: marketFreshnessLabel,
      tone: marketDataAgeSecs !== null && marketDataAgeSecs >= 45 ? "#ffd740" : "#ccc",
      detail: lastUpdated
        ? `分析 ${lastUpdated.toLocaleTimeString("zh-TW")}`
        : wsLastUpdateTs
          ? `報價 ${new Date(wsLastUpdateTs).toLocaleTimeString("zh-TW")}`
          : "等待首次分析",
    },
    {
      key: "refresh",
      label: "下次刷新",
      value: nextRefreshSecs !== null && snapshot ? `${nextRefreshSecs}s` : "待分析",
      tone: "#3b82f6",
      detail: isAnalyzing ? "分析進行中" : "ATR 智能刷新",
    },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>

      {/* ══ TOP NAV ══ */}
      <header className="sticky top-0 z-40 border-b" style={{ background: "#111", borderColor: "#1e1e1e" }}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0 mr-1">
            <Zap className="w-4 h-4 text-[#ffd740]" />
            <span className="text-sm font-bold tracking-wide text-[#ffd740] hidden sm:block">CRYPTO ANALYST</span>
          </div>

          {/* 改良 2-2：動態幣種搜索 */}
          <div className="relative order-1 w-full sm:order-none sm:w-auto">
            <button onClick={() => setShowSymbolSearch(!showSymbolSearch)}
              className="flex w-full items-center justify-between gap-2 rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm font-semibold text-white transition-colors hover:border-[#ffd740] sm:w-auto sm:justify-start sm:py-1">
              <span>{symbolInfo?.icon ?? "₿"}</span>
              <span>{symbol}</span>
              <ChevronDown className="w-3 h-3 text-[#888]" />
            </button>
            {showSymbolSearch && (
              <div className="absolute top-full left-0 mt-1 z-50 w-full overflow-hidden rounded-lg shadow-xl sm:w-auto" style={{ background: "#161616", border: "1px solid #2a2a2a", minWidth: 200 }}>
                <div className="p-2 border-b" style={{ borderColor: "#2a2a2a" }}>
                  <div className="flex items-center gap-2 rounded px-2 py-1" style={{ background: "#0d0d0d", border: "1px solid #2a2a2a" }}>
                    <Search className="w-3 h-3 text-[#555]" />
                    <input value={symbolInput} onChange={e => setSymbolInput(e.target.value)}
                      placeholder="搜索幣種..." className="flex-1 text-xs bg-transparent text-[#ccc] focus:outline-none" autoFocus />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredSymbols.map(s => (
                    <button key={s.value} onClick={() => { setSymbol(s.value); setSnapshot(null); setShowSymbolSearch(false); setSymbolInput(""); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[#1e1e1e] transition-colors"
                      style={{ color: s.value === symbol ? "#ffd740" : "#ccc" }}>
                      <span className="w-4">{s.icon}</span>
                      <span className="font-medium">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Live Price */}
          {displayPrice && (
            <div className="flex items-center gap-2 rounded border border-[#1e1e1e] bg-[#0d0d0d] px-2 py-1 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <span className="text-sm font-mono font-bold text-white">${formatPrice(displayPrice)}</span>
              {isLive && <span className="w-1.5 h-1.5 rounded-full bg-[#4caf50] animate-pulse" />}
              {change24h !== null && (
                <span className={`text-xs font-mono ${change24h >= 0 ? "text-[#4caf50]" : "text-[#ef5350]"}`}>
                  {change24h >= 0 ? "+" : ""}{change24h.toFixed(2)}%
                </span>
              )}
            </div>
          )}

          <div className="flex-1" />

          {/* 改良 1-5：刷新倒數 */}
          {nextRefreshSecs !== null && snapshot && !isMobile && (
            <div className="flex items-center gap-1 text-[10px] text-[#555]">
              <Clock className="w-3 h-3" />
              <span>{nextRefreshSecs}s</span>
            </div>
          )}

          {/* WS indicator */}
          {isLive ? <Wifi className="w-3.5 h-3.5 text-[#4caf50]" /> : <WifiOff className="w-3.5 h-3.5 text-[#555]" />}

          {/* Watchlist */}
          <button onClick={toggleWatchlist}
            className={`p-1.5 rounded transition-colors ${isWatchlisted ? "text-[#ffd740]" : "text-[#555] hover:text-[#888]"}`}>
            <Star className="w-4 h-4" fill={isWatchlisted ? "#ffd740" : "none"} />
          </button>

          {/* Analyze Button */}
          <button onClick={handleAnalyze} disabled={isAnalyzing}
            className="order-last flex w-full items-center justify-center gap-1.5 rounded px-3 py-2 text-xs font-semibold transition-all disabled:opacity-60 sm:order-none sm:w-auto sm:py-1.5"
            style={{ background: isAnalyzing ? "#1a1a1a" : "#ffd740", color: isAnalyzing ? "#888" : "#000", border: isAnalyzing ? "1px solid #2a2a2a" : "none" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin" : ""}`} />
            {isAnalyzing ? "分析中..." : `分析 ${symbolBase}`}
          </button>
        </div>

        {/* 改良 1-1：兩層導航 - 第一層（主分類）*/}
        <div className="border-t" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
          <div className="flex items-center overflow-x-auto">
            {visibleNavCategories.map(cat => (
              <button key={cat.id} onClick={() => handleCategoryChange(cat.id)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2"
                style={{
                  color: activeCategory === cat.id ? "#ffd740" : "#666",
                  borderBottomColor: activeCategory === cat.id ? "#ffd740" : "transparent",
                  background: activeCategory === cat.id ? "#111" : "transparent",
                }}>
                <span>{cat.icon}</span>
                <span className={isMobile ? "" : "hidden sm:block"}>{isMobile ? getCompactTabLabel(cat.id, cat.label) : cat.label}</span>
              </button>
            ))}
            {isMobile && (
              <button
                onClick={() => setShowMobileCategoryMenu(v => !v)}
                className="ml-auto flex items-center gap-1 border-b-2 px-4 py-2 text-xs font-medium"
                style={{ color: showMobileCategoryMenu ? "#ffd740" : "#888", borderBottomColor: showMobileCategoryMenu ? "#ffd740" : "transparent" }}
              >
                <span>更多</span>
                {showMobileCategoryMenu ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          {isMobile && showMobileCategoryMenu && (
            <div className="grid grid-cols-2 gap-2 border-t px-3 py-2" style={{ borderColor: "#1e1e1e", background: "#101010" }}>
              {secondaryMobileCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryChange(cat.id)}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px]"
                  style={{
                    borderColor: activeCategory === cat.id ? "#ffd740" : "#2a2a2a",
                    color: activeCategory === cat.id ? "#ffd740" : "#aaa",
                    background: activeCategory === cat.id ? "rgba(255,215,64,0.12)" : "#161616",
                  }}
                >
                  <span>{cat.icon}</span>
                  <span className="truncate">{cat.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ══ 改良 1-4：概覽橫幅重設計 ══ */}
      <div className="px-3 py-3 border-b sm:px-4" style={{ background: "#0f0f0f", borderColor: "#1e1e1e" }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
          {/* 環形儀表盤 */}
          <div className="flex items-center gap-3 shrink-0">
            <ConsensusGauge score={consensusScore} size={90} />
            <div>
              <div className="text-[10px] text-[#555] mb-0.5">{symbolBase} 主決策卡</div>
              {displayPrice ? (
                <div className="text-xl font-bold font-mono text-white">${formatPrice(displayPrice)}</div>
              ) : (
                <div className="text-lg font-mono text-[#555]">—</div>
              )}
              {lastUpdated && (
                <div className="text-[10px] text-[#555] mt-0.5">
                  {Math.floor((Date.now() - lastUpdated.getTime()) / 60000)} 分鐘前更新
                </div>
              )}
            </div>
          </div>

          {/* 信心度 + 方向機率 */}
          <div className="w-full flex-1 min-w-0">
            {snapshot && (
              <div className="mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-[#888]">系統信心度</span>
                  <span className={`text-xs font-bold ${consensusColor}`}>{consensusLabel}</span>
                  {consensusScore !== null && (
                    <button onClick={() => setShowExplain(!showExplain)}
                      className="text-[10px] text-[#555] hover:text-[#888] flex items-center gap-0.5">
                      <Info className="w-3 h-3" />
                      {showExplain ? "收起" : "詳情"}
                    </button>
                  )}
                </div>
                {bullPct !== null && bearPct !== null && sidePct !== null && (
                  <div>
                    <div className="flex rounded overflow-hidden h-2 mb-1">
                      <div style={{ width: `${bullPct}%`, background: "#4caf50" }} />
                      <div style={{ width: `${sidePct}%`, background: "#ffd740" }} />
                      <div style={{ width: `${bearPct}%`, background: "#ef5350" }} />
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#4caf50]">看多 {bullPct.toFixed(0)}%</span>
                      <span className="text-[#ffd740]">震盪 {sidePct.toFixed(0)}%</span>
                      <span className="text-[#ef5350]">看空 {bearPct.toFixed(0)}%</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!snapshot && (
              <div className="space-y-2">
                <div className="rounded-xl border px-3 py-3 text-xs" style={{ background: "#121212", borderColor: isAnalyzing ? "#3b82f6" : "#252525", color: isAnalyzing ? "#93c5fd" : "#777" }}>
                  {isAnalyzing ? `系統正在自動分析 ${symbolBase}，完成後會自動更新主決策卡。` : "系統會自動分析市場概覽；你也可以手動點擊上方分析按鈕立即刷新。"}
                </div>
                {liveSnapshotSummary && (
                  <div className="rounded-xl border px-3 py-3" style={{ background: "#121212", borderColor: decisionConfig.border }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide" style={{ color: decisionConfig.color }}>實盤快照摘要</div>
                        <div className="mt-1 text-2xl font-bold leading-none" style={{ color: decisionConfig.color }}>
                          {direction === "long" ? "偏多待確認" : direction === "short" ? "偏空待確認" : "等待觸發"}
                        </div>
                        <div className="mt-1 text-[11px] text-[#b5b5b5]">{liveSnapshotSummary}</div>
                      </div>
                      <span className="rounded-full border px-2 py-1 text-[10px] font-semibold" style={{ borderColor: marketStatusConfig.border, color: marketStatusConfig.color, background: marketStatusConfig.bg }}>
                        {marketStatusConfig.label}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[#888]">
                      <span>資料 {marketFreshnessLabel}</span>
                      <span>實盤策略 {latestLiveSnapshot?.active_presets?.length ?? 0} 個</span>
                      <span>訊號 {latestLiveSnapshot?.signals?.length ?? 0} 筆</span>
                      {latestLiveSignal?.entry_price && <span>最新進場 {formatPrice(latestLiveSignal.entry_price)}</span>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {snapshot && (
              <div className="mt-2 space-y-2">
                <div className="rounded-xl border px-3 py-3" style={{ background: "#121212", borderColor: decisionConfig.border }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: decisionConfig.color }}>當前建議</div>
                      <div className="mt-1 text-2xl font-bold leading-none" style={{ color: decisionConfig.color }}>{decisionConfig.title}</div>
                      <div className="mt-1 text-[11px] text-[#b5b5b5]">{decisionConfig.subtitle}</div>
                    </div>
                    <span className="rounded-full border px-2 py-1 text-[10px] font-semibold" style={{ borderColor: marketStatusConfig.border, color: marketStatusConfig.color, background: marketStatusConfig.bg }}>
                      {marketStatusConfig.label}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[#888]">
                    <span className="rounded-full border px-2 py-1" style={{ borderColor: decisionConfig.border, color: decisionConfig.color, background: decisionConfig.bg }}>
                      {consensusLabel}
                    </span>
                    <span>資料 {marketFreshnessLabel}</span>
                    {nextRefreshSecs !== null && snapshot && <span>刷新 {nextRefreshSecs}s</span>}
                    {latestLiveSnapshot && symbol === "BTCUSDT" && <span>實盤策略 {latestLiveSnapshot.active_presets?.length ?? 0} 個</span>}
                    {latestLiveSnapshot && symbol === "BTCUSDT" && <span>訊號 {latestLiveSnapshot.signals?.length ?? 0} 筆</span>}
                  </div>
                </div>

                {latestLiveSnapshot && symbol === "BTCUSDT" && livePresetSummaries.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {livePresetSummaries.map((preset) => (
                      <div
                        key={preset.id}
                        className="rounded-xl border px-3 py-2.5"
                        style={{
                          background: preset.isHighlighted ? "rgba(76,175,80,0.10)" : preset.hasError ? "rgba(239,83,80,0.08)" : "#121212",
                          borderColor: preset.isHighlighted ? "#2f6f36" : preset.hasError ? "#7f2d2d" : "#252525",
                          boxShadow: preset.isHighlighted ? "0 0 0 1px rgba(76,175,80,0.12) inset" : "none",
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-semibold text-white line-clamp-2">{preset.shortLabel}</div>
                          <span className="text-[10px] font-semibold" style={{ color: preset.statusColor }}>{preset.status}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[#9a9a9a]">
                          <span className="rounded-full border border-[#2a2a2a] px-2 py-0.5">{preset.directionLabel}</span>
                          <span className="rounded-full border border-[#2a2a2a] px-2 py-0.5">{preset.interval}</span>
                          <span className="rounded-full border border-[#2a2a2a] px-2 py-0.5">{preset.strategy}</span>
                          {preset.lastSentAt && <span className="rounded-full border border-[#2a2a2a] px-2 py-0.5 text-[#4caf50]">已發送記錄</span>}
                        </div>
                        <div className="mt-2 text-[10px]" style={{ color: preset.hasError ? "#fca5a5" : "#7a7a7a" }}>{preset.detailLabel}</div>
                        <div className="mt-2 text-[10px] text-[#666] break-all">{preset.key}</div>
                      </div>
                    ))}
                  </div>
                )}

                {latestLiveSnapshot && symbol === "BTCUSDT" && (
                  <div className="rounded-xl border px-3 py-2.5" style={{ background: "#121212", borderColor: "#252525" }}>
                    <div className="grid gap-2 text-[11px] text-[#9a9a9a] sm:grid-cols-2">
                      <div>生成時間 {latestLiveSnapshot.generated_at ? new Date(latestLiveSnapshot.generated_at).toLocaleString("zh-TW") : "—"}</div>
                      <div>最後檢查 {latestLiveSnapshot.state_overview?.last_checked_at ? new Date(latestLiveSnapshot.state_overview.last_checked_at).toLocaleString("zh-TW") : "—"}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isMobile && snapshot && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => setShowMobileHeroDetails(v => !v)}
                  className="rounded-full border px-3 py-1 text-[11px] font-semibold"
                  style={{ borderColor: showMobileHeroDetails ? "#ffd740" : "#2a2a2a", color: showMobileHeroDetails ? "#ffd740" : "#aaa", background: showMobileHeroDetails ? "rgba(255,215,64,0.12)" : "#141414" }}
                >
                  {showMobileHeroDetails ? "收起決策重點" : "查看決策重點"}
                </button>
                {latestLiveSnapshot && symbol === "BTCUSDT" && (
                  <button
                    onClick={() => setShowLivePresetDetails(v => !v)}
                    className="rounded-full border px-3 py-1 text-[11px] font-semibold"
                    style={{ borderColor: showLivePresetDetails ? "#ffd740" : "#2a2a2a", color: showLivePresetDetails ? "#ffd740" : "#aaa", background: showLivePresetDetails ? "rgba(255,215,64,0.12)" : "#141414" }}
                  >
                    {showLivePresetDetails ? "收起實盤策略" : "查看實盤策略"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 三欄資訊卡 */}
          {snapshot && (!isMobile || showMobileHeroDetails) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-[340px] lg:shrink-0">
              <div className="rounded p-2" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
                <div className="text-[10px] font-semibold mb-1" style={{ color: direction === "long" ? "#4caf50" : direction === "short" ? "#ef5350" : "#ffd740" }}>
                  進場信號
                </div>
                <div className="text-[10px] text-[#aaa]">
                  {direction === "long" ? "看多確認，尋找回調做多機會" : direction === "short" ? "看空確認，尋找反彈做空機會" : "方向分歧，等待突破確認"}
                </div>
              </div>
              <div className="rounded p-2" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
                <div className="text-[10px] text-[#3b82f6] font-semibold mb-1">關鍵價位</div>
                <div className="text-[10px] text-[#aaa] space-y-0.5">
                  {snapshot.strategy?.entry && (() => {
                    const lp = displayPrice ?? snapshot.live_price;
                    const dir = snapshot.strategy?.direction;
                    // 做多時進場價不應高於市價；做空時進場價不應低於市價
                    const entryAboveMarket = dir === "long" && lp != null && snapshot.strategy.entry > lp;
                    const entryBelowMarket = dir === "short" && lp != null && snapshot.strategy.entry < lp;
                    const needsAdjust = entryAboveMarket || entryBelowMarket;
                    // 顯示值：若進場價偏離市價（快取舊值），改用即時市價
                    const displayEntry = needsAdjust ? (lp ?? snapshot.strategy.entry) : snapshot.strategy.entry;
                    return (
                      <div>
                        進場 <span className="font-mono text-[#ccc]">{formatPrice(displayEntry)}</span>
                        {needsAdjust && lp != null && (
                          <span className="ml-1 text-[#ffd740]" title={`分析時進場價 ${formatPrice(snapshot.strategy.entry)}，市價已變動，以即時市價為準`}>⚠</span>
                        )}
                      </div>
                    );
                  })()}
                  {snapshot.strategy?.sl && <div>止損 <span className="font-mono text-[#ef5350]">{formatPrice(snapshot.strategy.sl)}</span></div>}
                  {snapshot.strategy?.tp1 && <div>止盈 <span className="font-mono text-[#4caf50]">{formatPrice(snapshot.strategy.tp1)}</span></div>}
                </div>
              </div>
              <div className="rounded p-2" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
                <div className="text-[10px] text-[#ef5350] font-semibold mb-1">風險警示</div>
                <div className="text-[10px] text-[#aaa]">
                  {snapshot.strategy?.rr_ratio ? `RR 比 ${snapshot.strategy.rr_ratio.toFixed(2)}` : ""}
                  {snapshot.indicators?.atr ? ` · ATR ${snapshot.indicators.atr.toFixed(2)}` : ""}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* AI 可解釋性展開（改良 4-3）*/}
        {showExplain && snapshot && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: "#1e1e1e" }}>
            <AIExplainPanel snapshot={snapshot} />
          </div>
        )}

        {latestLiveSnapshot && symbol === "BTCUSDT" && (!isMobile || showLivePresetDetails) && (
          <div className="mt-3 rounded-xl border px-3 py-3" style={{ background: "#121212", borderColor: "#2a2a2a" }}>
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-semibold text-[#ffd740]">實盤資料明細</div>
                <div className="mt-1 text-[11px] text-[#888]">主決策卡上方先看結論與兩個核心策略；這裡保留完整策略清單與錯誤資訊。</div>
              </div>
              {latestLiveSnapshot.state_overview?.last_error_message && (
                <div className="max-w-xl text-[11px] leading-relaxed text-[#f59e0b]">
                  最近狀態：{formatFriendlyRuntimeError(latestLiveSnapshot.state_overview.last_error_message)}
                </div>
              )}
            </div>
            {latestLiveSnapshot.state_overview?.history_window && !!latestLiveSnapshot.active_presets?.length && (
              <div className="mt-3 rounded-xl border border-[#252525] bg-[#101010] px-3 py-3">
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-[#ffd740]">近 {latestLiveSnapshot.state_overview.history_window} 輪策略診斷</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-[#7a7a7a]">這裡先看每個策略最近多輪掃描的阻擋率、發送率與最常見阻擋類型，方便後續調參。</div>
                  </div>
                  <div className="text-[10px] text-[#666]">統計視窗會隨每輪 worker 掃描持續更新。</div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {latestLiveSnapshot.active_presets.map((preset, index) => {
                    const presetKey = preset.key ?? `${preset.label ?? 'preset'}_${index}`;
                    const strategyState = latestLiveSnapshot.state_overview?.strategies?.[presetKey];
                    const diagnostics = strategyState?.diagnostics;
                    const topBlocker = diagnostics?.top_blockers?.[0];
                    return (
                      <div key={`${presetKey}_diagnostics`} className="rounded-lg border border-[#202020] bg-[#0b0b0b] px-3 py-2">
                        <div className="text-[11px] font-semibold text-white">{preset.label ?? preset.key ?? `Preset ${index + 1}`}</div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                          <div className="rounded-md border border-[#1f1f1f] bg-[#121212] px-2 py-1.5">
                            <div className="text-[#666]">樣本輪次</div>
                            <div className="mt-1 font-semibold text-[#d6d6d6]">{diagnostics?.total_rounds ?? 0}</div>
                          </div>
                          <div className="rounded-md border border-[#1f1f1f] bg-[#121212] px-2 py-1.5">
                            <div className="text-[#666]">阻擋率</div>
                            <div className="mt-1 font-semibold text-[#f59e0b]">{typeof diagnostics?.blocked_rate === "number" ? `${diagnostics.blocked_rate.toFixed(1)}%` : "—"}</div>
                          </div>
                          <div className="rounded-md border border-[#1f1f1f] bg-[#121212] px-2 py-1.5">
                            <div className="text-[#666]">發送率</div>
                            <div className="mt-1 font-semibold text-[#4caf50]">{typeof diagnostics?.sent_rate === "number" ? `${diagnostics.sent_rate.toFixed(1)}%` : "—"}</div>
                          </div>
                        </div>
                        <div className="mt-2 text-[10px] leading-relaxed text-[#8a8a8a]">
                          {topBlocker?.reason
                            ? `最常見阻擋：${topBlocker.reason}${topBlocker.count ? ` × ${topBlocker.count}` : ""}`
                            : "目前還沒有足夠的阻擋歷史，可再累積幾輪掃描後觀察。"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {!!latestLiveSnapshot.active_presets?.length && (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {latestLiveSnapshot.active_presets.map((preset, index) => {
                  const presetKey = preset.key ?? `${preset.label ?? 'preset'}_${index}`;
                  const dispatch = latestLiveSnapshot.dispatch_results?.find((item) => item.preset_key === preset.key);
                  const strategyState = latestLiveSnapshot.state_overview?.strategies?.[presetKey];
                  const strategyError = latestLiveSnapshot.strategy_errors?.find((item) => item.preset_key === preset.key);
                  return (
                    <div
                      key={presetKey}
                      className="rounded-lg border px-3 py-2"
                      style={{
                        background: dispatch?.status === "sent" ? "rgba(76,175,80,0.10)" : strategyError ? "rgba(239,83,80,0.08)" : "#0d0d0d",
                        borderColor: dispatch?.status === "sent" ? "#2f6f36" : strategyError ? "#7f2d2d" : "#242424",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-white">{preset.label ?? preset.key ?? `Preset ${index + 1}`}</div>
                        <span className="text-[10px] font-semibold" style={{ color: dispatch?.status === "sent" ? "#4caf50" : dispatch?.status === "failed" || strategyError || strategyState?.last_status === "error" ? "#ef5350" : strategyState?.last_status === "blocked" ? "#f59e0b" : "#888" }}>
                          {dispatch?.status === "sent" ? "已發 Telegram" : dispatch?.status === "failed" ? "發送失敗" : strategyError || strategyState?.last_status === "error" ? "策略錯誤" : strategyState?.last_status === "blocked" ? "本輪被阻擋" : strategyState?.last_status === "duplicate_skip" ? "重複略過" : strategyState?.last_sent_at ? "曾發送" : "待機"}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-[#888] break-all">{preset.key ?? "—"}</div>
                      <div className="mt-1 text-[11px] text-[#aaa]">策略 {preset.strategy ?? "—"} · 週期 {preset.interval ?? "—"}</div>
                      {(dispatch?.sent_at || strategyState?.last_sent_at) && (
                        <div className="mt-1 text-[10px] text-[#4caf50]">最近發送 {new Date(dispatch?.sent_at ?? strategyState?.last_sent_at ?? "").toLocaleString("zh-TW")}</div>
                      )}
                      {(dispatch?.error || strategyError?.error) && (
                        <div className="mt-1 text-[10px] leading-relaxed text-[#fca5a5]">{dispatch?.error ?? strategyError?.error}</div>
                      )}
                      {strategyState?.last_filter_reason && !dispatch?.error && !strategyError?.error && (
                        <div className="mt-1 text-[10px] leading-relaxed text-[#fcd34d]">阻擋原因：{formatFriendlyRuntimeError(strategyState.last_filter_reason)}</div>
                      )}
                      {(strategyState?.governance_summary || preset.governance?.summary) && (
                        <div className="mt-1 text-[10px] leading-relaxed text-[#7a7a7a]">治理規則：{strategyState?.governance_summary ?? preset.governance?.summary}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ 家族聚合診斷面板 ══ */}
        {latestLiveSnapshot && symbol === "BTCUSDT" && latestLiveSnapshot.diagnostics_enrichment?.family_aggregations?.length && (!isMobile || showLivePresetDetails) && (
          <div className="mt-3 rounded-xl border px-3 py-3" style={{ background: "#121212", borderColor: "#2a2a2a" }}>
            <div className="text-xs font-semibold text-[#38bdf8] mb-1">策略家族聚合診斷</div>
            <div className="text-[10px] text-[#7a7a7a] mb-3">將五個策略按家族分組，快速總覽各家族的整體通過率與阻擋分佈。</div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {latestLiveSnapshot.diagnostics_enrichment.family_aggregations.map((fam) => {
                const familyColors: Record<string, string> = {
                  pa: "#4caf50", trend_pullback: "#ef5350", structure: "#8b5cf6",
                  trend_confirm: "#ffd740", mean_reversion: "#38bdf8",
                };
                const accent = familyColors[fam.family ?? ""] ?? "#888";
                return (
                  <div key={fam.family} className="rounded-lg border border-[#202020] bg-[#0b0b0b] px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold" style={{ color: accent }}>{fam.family_label ?? fam.family}</div>
                      <span className="text-[10px] text-[#666]">{fam.strategy_count ?? 0} 個策略</span>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10px]">
                      <div className="rounded border border-[#1f1f1f] bg-[#121212] px-1.5 py-1 text-center">
                        <div className="text-[#666]">發送率</div>
                        <div className="mt-0.5 font-semibold text-[#4caf50]">{typeof fam.sent_rate === "number" ? `${fam.sent_rate.toFixed(1)}%` : "—"}</div>
                      </div>
                      <div className="rounded border border-[#1f1f1f] bg-[#121212] px-1.5 py-1 text-center">
                        <div className="text-[#666]">活躍率</div>
                        <div className="mt-0.5 font-semibold text-[#38bdf8]">{typeof fam.active_rate === "number" ? `${fam.active_rate.toFixed(1)}%` : "—"}</div>
                      </div>
                      <div className="rounded border border-[#1f1f1f] bg-[#121212] px-1.5 py-1 text-center">
                        <div className="text-[#666]">阻擋率</div>
                        <div className="mt-0.5 font-semibold text-[#f59e0b]">{typeof fam.blocked_rate === "number" ? `${fam.blocked_rate.toFixed(1)}%` : "—"}</div>
                      </div>
                      <div className="rounded border border-[#1f1f1f] bg-[#121212] px-1.5 py-1 text-center">
                        <div className="text-[#666]">樣本</div>
                        <div className="mt-0.5 font-semibold text-[#d6d6d6]">{fam.total_rounds ?? 0}</div>
                      </div>
                    </div>
                    {fam.top_blockers && fam.top_blockers.length > 0 && (
                      <div className="mt-2 text-[10px] text-[#8a8a8a]">
                        主要阻擋：{fam.top_blockers.map(b => `${b.reason}×${b.count}`).join("、")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ 診斷趨勢迷你圖 ══ */}
        {latestLiveSnapshot && symbol === "BTCUSDT" && latestLiveSnapshot.diagnostics_enrichment?.strategy_trends && (!isMobile || showLivePresetDetails) && (
          <div className="mt-3 rounded-xl border px-3 py-3" style={{ background: "#121212", borderColor: "#2a2a2a" }}>
            <div className="text-xs font-semibold text-[#a78bfa] mb-1">策略趨勢序列（近 30 輪）</div>
            <div className="text-[10px] text-[#7a7a7a] mb-3">每個色塊代表一輪掃描結果：綠色=發送、藍色=重複、橙色=阻擋、灰色=待機、紅色=錯誤。</div>
            <div className="space-y-2">
              {latestLiveSnapshot.active_presets?.map((preset) => {
                const key = preset.key ?? "";
                const trend = latestLiveSnapshot.diagnostics_enrichment?.strategy_trends?.[key] ?? [];
                const statusColors: Record<string, string> = {
                  sent: "#4caf50", duplicate_skip: "#38bdf8", blocked: "#f59e0b", idle: "#444", error: "#ef5350",
                };
                return (
                  <div key={`trend_${key}`} className="flex items-center gap-2">
                    <div className="w-28 shrink-0 text-[10px] text-[#aaa] truncate" title={preset.label}>{preset.label?.replace(/^BTCUSDT\s*/i, "").replace(/^[🔴🟢🟣🟡🔵]\s*/, "") ?? key}</div>
                    <div className="flex gap-px flex-1">
                      {trend.map((t, i) => (
                        <div
                          key={i}
                          className="h-3 flex-1 rounded-sm"
                          style={{ background: statusColors[t.status ?? "idle"] ?? "#333", minWidth: 3, maxWidth: 8 }}
                          title={`#${i + 1}: ${t.status}${t.reason_code ? ` (${t.reason_code})` : ""}`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ 門檻建議引擎面板 ══ */}
        {latestLiveSnapshot && symbol === "BTCUSDT" && latestLiveSnapshot.diagnostics_enrichment?.threshold_suggestions?.length && (!isMobile || showLivePresetDetails) && (
          <div className="mt-3 rounded-xl border px-3 py-3" style={{ background: "#121212", borderColor: "#2a2a2a" }}>
            <div className="text-xs font-semibold text-[#fbbf24] mb-1">門檻調整建議</div>
            <div className="text-[10px] text-[#7a7a7a] mb-3">根據近期診斷數據自動生成的參數調整建議，僅供參考。</div>
            <div className="space-y-2">
              {latestLiveSnapshot.diagnostics_enrichment.threshold_suggestions.map((sug, i) => {
                const severityConfig: Record<string, { color: string; bg: string; border: string; label: string }> = {
                  critical: { color: "#ef5350", bg: "rgba(239,83,80,0.08)", border: "#7f2d2d", label: "❗ 重要" },
                  warning:  { color: "#fbbf24", bg: "rgba(251,191,36,0.08)", border: "#6b5a1b", label: "⚠️ 建議" },
                  info:     { color: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "#1d3d6b", label: "ℹ️ 參考" },
                };
                const cfg = severityConfig[sug.severity ?? "info"] ?? severityConfig.info;
                return (
                  <div key={`sug_${i}`} className="rounded-lg border px-3 py-2" style={{ background: cfg.bg, borderColor: cfg.border }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-white">{sug.strategy_label?.replace(/^[🔴🟢🟣🟡🔵]\s*/, "") ?? sug.strategy_key}</div>
                      <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-[#ccc]">{sug.suggested_action}</div>
                    <div className="mt-1 text-[10px] text-[#888]">目前值：{sug.current_value}</div>
                    <div className="mt-1 text-[10px] text-[#7a7a7a] leading-relaxed">{sug.reason}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI 分析摘要 */}
        {(snapshot?.consensus as unknown as { summary?: string })?.summary && (
          <div className="mt-2 text-xs text-[#aaa] leading-relaxed border-t pt-2" style={{ borderColor: "#1e1e1e" }}>
            {(snapshot?.consensus as unknown as { summary: string })?.summary}
          </div>
        )}

        {isMobile && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {mobileStatusCards.map(card => (
              <div
                key={card.key}
                className="rounded-xl px-3 py-2.5"
                style={{ background: "#121212", border: `1px solid ${card.key === "stream" ? marketStatusConfig.border : "#252525"}` }}
              >
                <div className="text-[10px] text-[#666] mb-1">{card.label}</div>
                <div className="text-sm font-semibold" style={{ color: card.tone }}>{card.value}</div>
                <div className="mt-1 text-[10px] leading-relaxed text-[#7a7a7a]">{card.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ INDICATOR CARDS ══ */}
      <div className="border-b" style={{ background: "#0f0f0f", borderColor: "#1e1e1e" }}>
        {isMobile && (
          <div className="flex items-center justify-between px-3 py-2 text-[11px] text-[#888]" style={{ borderBottom: "1px solid #1e1e1e" }}>
            <span>首屏只保留核心指標，其他指標可按需展開</span>
            <button
              onClick={() => setShowMobileIndicators(v => !v)}
              className="rounded-full border px-2.5 py-1 font-semibold"
              style={{ borderColor: showMobileIndicators ? "#ffd740" : "#2a2a2a", color: showMobileIndicators ? "#ffd740" : "#aaa", background: showMobileIndicators ? "rgba(255,215,64,0.12)" : "#141414" }}
            >
              {showMobileIndicators ? "收起附加指標" : "更多指標"}
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 sm:flex sm:items-stretch sm:gap-0 sm:overflow-x-auto">
        <div className="min-w-0 px-3 py-2.5 border-r border-b sm:flex-1 sm:min-w-[120px] sm:px-4 sm:border-b-0" style={{ borderColor: "#1e1e1e" }}>

          <div className="flex items-center gap-1.5 text-[10px] text-[#888] mb-1"><TrendingUp className="w-3 h-3" />當前價格</div>
          <div className="text-sm font-mono font-bold text-white">{displayPrice ? `$${formatPrice(displayPrice)}` : "—"}</div>
          <div className="text-[10px] text-[#555] mt-0.5">{change24h !== null ? `24H ${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%` : "即時"}</div>
        </div>
        <div className="min-w-0 px-3 py-2.5 border-r border-b sm:flex-1 sm:min-w-[120px] sm:px-4 sm:border-b-0" style={{ borderColor: "#1e1e1e" }}>

          <div className="flex items-center gap-1.5 text-[10px] text-[#888] mb-1"><Activity className="w-3 h-3" />RSI (14)</div>
          <div className={`text-sm font-mono font-bold ${(() => {
            const rsiVal = typeof snapshot?.indicators?.rsi === "number" ? snapshot.indicators.rsi : (snapshot?.indicators?.rsi as unknown as { value?: number })?.value;
            return rsiVal !== undefined ? (rsiVal > 70 ? "text-[#ef5350]" : rsiVal < 30 ? "text-[#4caf50]" : "text-white") : "text-white";
          })()}`}>
            {(() => {
              const rsiVal = typeof snapshot?.indicators?.rsi === "number" ? snapshot.indicators.rsi : (snapshot?.indicators?.rsi as unknown as { value?: number })?.value;
              return rsiVal !== undefined ? rsiVal.toFixed(2) : "—";
            })()}
          </div>
          <div className="text-[10px] text-[#555] mt-0.5">
            {(() => {
              const rsiVal = typeof snapshot?.indicators?.rsi === "number" ? snapshot.indicators.rsi : (snapshot?.indicators?.rsi as unknown as { value?: number })?.value;
              return rsiVal !== undefined ? (rsiVal > 70 ? "超買" : rsiVal < 30 ? "超賣" : "中性") : "技術指標";
            })()}
          </div>
        </div>
        {(!isMobile || showMobileIndicators) && (
          <>
            <div className="min-w-0 px-3 py-2.5 border-r border-b sm:flex-1 sm:min-w-[120px] sm:px-4 sm:border-b-0" style={{ borderColor: "#1e1e1e" }}>

              <div className="flex items-center gap-1.5 text-[10px] text-[#888] mb-1"><DollarSign className="w-3 h-3" />資金費率</div>
              <div className={`text-sm font-mono font-bold ${snapshot?.onchain?.funding_rate != null ? ((snapshot.onchain.funding_rate as { rate: number }).rate > 0 ? "text-[#4caf50]" : "text-[#ef5350]") : "text-white"}`}>
                {snapshot?.onchain?.funding_rate != null ? `${((snapshot.onchain.funding_rate as { rate: number }).rate * 100).toFixed(4)}%` : "—"}
              </div>
              <div className="text-[10px] text-[#555] mt-0.5">永續合約</div>
            </div>
            <div className="min-w-0 px-3 py-2.5 border-r border-b sm:flex-1 sm:min-w-[120px] sm:px-4 sm:border-b-0" style={{ borderColor: "#1e1e1e" }}>

              <div className="flex items-center gap-1.5 text-[10px] text-[#888] mb-1"><TrendingDown className="w-3 h-3" />多空比</div>
              <div className="text-sm font-mono font-bold text-white">
                {snapshot?.onchain?.long_short_ratio != null ? (snapshot.onchain.long_short_ratio as { ls_ratio: number }).ls_ratio.toFixed(3) : "—"}
              </div>
              <div className="text-[10px] text-[#555] mt-0.5">散戶多空比</div>
            </div>
          </>
        )}
        <div className="min-w-0 px-3 py-2.5 border-r border-b sm:flex-1 sm:min-w-[120px] sm:px-4 sm:border-b-0" style={{ borderColor: "#1e1e1e" }}>

          <div className="flex items-center gap-1.5 text-[10px] text-[#888] mb-1"><Shield className="w-3 h-3" />4H ATR</div>
          <div className="text-sm font-mono font-bold text-white">{snapshot?.indicators?.atr?.toFixed(2) ?? "—"}</div>
          <div className="text-[10px] text-[#555] mt-0.5">波動率指標</div>
        </div>
        <div className="col-span-2 px-3 py-2.5 flex items-center justify-center sm:col-span-1">
          <button onClick={() => setShowWidgetMgr(true)} className="flex flex-row items-center gap-1 text-[#555] hover:text-[#888] transition-colors sm:flex-col" title="管理指標卡片">
            <Settings className="w-3.5 h-3.5" />
            <span className="text-[10px]">管理</span>
          </button>
        </div>
        </div>
      </div>

      {/* ══ KLINE SECTION ══ */}
      <div className="border-b" style={{ background: "#0a0a0a", borderColor: "#1e1e1e" }}>
        <div className="flex flex-col gap-2 border-b px-3 py-2 sm:px-4" style={{ borderColor: "#1e1e1e" }}>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 text-xs text-[#888]">
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="font-medium text-[#ccc]">多時間框架 K 線圖</span>
              <span className="rounded-full border border-[#2a2a2a] px-2 py-0.5 text-[10px] text-[#666]">
                預設縮略，點擊卡片展開
              </span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
              <button
                onClick={() => expandedKlineCards.length === visibleKlineTimeframes.length ? collapseAllKlines() : expandAllKlines()}
                className="whitespace-nowrap rounded border border-[#2a2a2a] px-2.5 py-1 text-[10px] text-[#888] transition-colors hover:border-[#ffd740] hover:text-[#ffd740]"
              >
                {expandedKlineCards.length === visibleKlineTimeframes.length ? "收合全部圖表" : "展開全部圖表"}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 xl:pb-0">
              <span className="whitespace-nowrap text-[10px] text-[#555]">均線：</span>
              {EMA_PERIODS.map(p => (
                <button key={p} onClick={() => toggleEma(p)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${activeEmas.includes(p) ? "border-[#3b82f6] text-[#3b82f6] bg-[#3b82f6]/10" : "border-[#2a2a2a] text-[#555] hover:border-[#444]"}`}>
                  EMA{p}
                </button>
              ))}
              <button onClick={() => setActiveEmas([])} className="text-[10px] px-2 py-0.5 rounded border border-[#2a2a2a] text-[#555] hover:border-[#444] hover:text-[#888] transition-colors">清除</button>
            </div>
            {isMobile && (
              <div className="flex items-center gap-1 overflow-x-auto pb-1 xl:pb-0">
                <span className="whitespace-nowrap text-[10px] text-[#555]">週期：</span>
                {klineTimeframes.map(tf => (
                  <button
                    key={tf}
                    onClick={() => setMobileKlineTf(tf)}
                    className={`whitespace-nowrap rounded border px-2 py-0.5 text-[10px] transition-colors ${mobileKlineTf === tf ? "border-[#ffd740] bg-[#ffd740]/10 text-[#ffd740]" : "border-[#2a2a2a] text-[#666] hover:border-[#444]"}`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-px md:grid-cols-2" style={{ background: "#1e1e1e" }}>
          {visibleKlineTimeframes.map(tf => {
            const meta = klineCardMeta[tf];
            const isExpanded = expandedKlineCards.includes(tf);
            return (
              <div key={tf} className="border-b md:border-b-0" style={{ background: "#111", borderColor: "#1e1e1e" }}>
                <button
                  onClick={() => toggleKlineCard(tf)}
                  className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-[#151515] sm:px-4"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border"
                      style={{ borderColor: `${meta.accent}55`, background: `${meta.accent}14`, color: meta.accent }}
                    >
                      <BarChart2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white">{meta.label}</span>
                        <span className="rounded-full border border-[#2a2a2a] px-2 py-0.5 text-[10px] text-[#888]">{tf}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-[#777]">{meta.description}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[#666]">
                        <span className="rounded-full border border-[#202020] px-2 py-0.5">現價 {displayPrice ? `$${formatPrice(displayPrice)}` : "—"}</span>
                        <span className="rounded-full border border-[#202020] px-2 py-0.5">24H {change24h !== null ? `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%` : "—"}</span>
                        <span className="rounded-full border border-[#202020] px-2 py-0.5">ATR {snapshot?.indicators?.atr?.toFixed(2) ?? "—"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-full border border-[#2a2a2a] px-2.5 py-1 text-[10px] text-[#888]">
                    {isExpanded ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    <span>{isExpanded ? "收合" : "展開"}</span>
                  </div>
                </button>
                {isExpanded && (
                  <Suspense fallback={
                    <div className="animate-pulse px-3 pb-3 sm:px-4">
                      <div className="rounded-xl" style={{ height: isMobile ? 220 : 260, background: "#161616" }} />
                    </div>
                  }>
                    <KlinePanel
                      symbol={symbol}
                      timeframe={tf}
                      activeEmas={activeEmas}
                      height={isMobile ? 240 : 260}
                      showVolume={!isMobile}
                      snapshot={snapshot}
                    />
                  </Suspense>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ 改良 1-1：兩層導航 - 第二層（子 Tab）══ */}
      <div className="border-b z-30 md:sticky md:top-[88px]" style={{ background: "#0f0f0f", borderColor: "#1e1e1e" }}>
        <div className="flex items-center gap-2 overflow-x-auto px-2 py-2 scrollbar-thin snap-x snap-mandatory sm:gap-0 sm:px-0 sm:py-0">
          {visibleCategoryTabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className="snap-start shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors sm:flex sm:items-center sm:gap-1.5 sm:rounded-none sm:border-0 sm:px-4 sm:py-2.5 sm:text-xs sm:font-medium"
                style={{
                  color: isActive ? "#ffd740" : "#8a8a8a",
                  borderColor: isMobile ? (isActive ? "#ffd740" : "#2a2a2a") : "transparent",
                  borderBottomColor: !isMobile ? (isActive ? "#ffd740" : "transparent") : undefined,
                  background: isMobile ? (isActive ? "rgba(255,215,64,0.12)" : "#151515") : (isActive ? "#111" : "transparent"),
                  boxShadow: isMobile && isActive ? "inset 0 0 0 1px rgba(255,215,64,0.15)" : "none",
                }}
              >
                {!isMobile && <span>{tab.icon}</span>}
                <span>{getCompactTabLabel(tab.id, tab.label)}</span>
              </button>
            );
          })}
          {isMobile && secondaryMobileTabs.length > 0 && (
            <button
              onClick={() => setShowMobileTabMenu(v => !v)}
              className="snap-start shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors"
              style={{
                color: showMobileTabMenu ? "#ffd740" : "#8a8a8a",
                borderColor: showMobileTabMenu ? "#ffd740" : "#2a2a2a",
                background: showMobileTabMenu ? "rgba(255,215,64,0.12)" : "#151515",
              }}
            >
              {showMobileTabMenu ? "收起更多" : "更多功能"}
            </button>
          )}
        </div>
        {isMobile && showMobileTabMenu && secondaryMobileTabs.length > 0 && (
          <div className="grid grid-cols-2 gap-2 border-t px-3 py-2" style={{ borderColor: "#1e1e1e", background: "#101010" }}>
            {secondaryMobileTabs.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px]"
                  style={{
                    borderColor: isActive ? "#ffd740" : "#2a2a2a",
                    color: isActive ? "#ffd740" : "#aaa",
                    background: isActive ? "rgba(255,215,64,0.12)" : "#161616",
                  }}
                >
                  <span>{tab.icon}</span>
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ══ PANEL CONTENT ══ */}
      <div className="flex-1">
        <div className="p-3 sm:p-4">
          {!snapshot && !isAnalyzing && !NO_SNAPSHOT_TABS.has(activeTab) && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Zap className="w-12 h-12 text-[#ffd740] mb-4 opacity-50" />
              <div className="text-[#888] text-sm mb-2">尚未執行分析</div>
              <div className="text-[#555] text-xs mb-4">點擊右上角「分析 {symbolBase}」按鈕開始</div>
              <button onClick={handleAnalyze} className="px-6 py-2.5 rounded text-sm font-semibold" style={{ background: "#ffd740", color: "#000" }}>
                立即分析 {symbolBase}
              </button>
            </div>
          )}

          {(snapshot || NO_SNAPSHOT_TABS.has(activeTab)) && (
            <Suspense fallback={<div className="flex items-center justify-center h-40 text-[#555] text-sm">載入中...</div>}>
              {activeTab === "screener"     && <ScreenerPanel onSelectSymbol={(sym) => { setSymbol(sym); setSnapshot(null); handleTabChange("indicators"); }} />}
              {activeTab === "vpvr"         && <VolumeProfilePanel symbol={symbol} />}
              {activeTab === "heatmap"      && <HeatmapPanel onSelectSymbol={(sym) => { setSymbol(sym); setSnapshot(null); handleTabChange("indicators"); }} />}
              {activeTab === "alerts"       && (
                <div className="space-y-4">
                  {/* Phase 4：多條件組合警報（主要） */}
                  <CompositeAlertsPanel />
                  {/* 智能警報（快速設定） */}
                  <div className="border-t pt-4" style={{ borderColor: "#1e1e1e" }}>
                    <div className="text-xs text-[#888] mb-3">快速智能警報</div>
                    <SmartAlertsPanel symbol={symbol} snapshot={snapshot} currentPrice={displayPrice} />
                  </div>
                  <div className="border-t pt-4" style={{ borderColor: "#1e1e1e" }}>
                    <div className="text-xs text-[#888] mb-3">基本價格警報</div>
                    <AlertsPanel />
                  </div>
                </div>
              )}
              {activeTab === "indicators"   && (
                <CollapsibleSection title="技術指標詳情" defaultOpen={true} storageKey="indicators">
                  <IndicatorsPanel snap={snapshot} isAnalyzing={isAnalyzing} />
                </CollapsibleSection>
              )}
              {activeTab === "smc"          && <SmcPanel smc={snapshot?.smc} isLoading={isAnalyzing} currentPrice={displayPrice} />}
              {activeTab === "smc_ultimate" && <SmcUltimatePanel advanced={snapshot?.advanced as any} isLoading={isAnalyzing} />}
              {activeTab === "smc_confirm"  && <SmcConfirmPanel smc={snapshot?.smc} currentPrice={displayPrice} isLoading={isAnalyzing} />}
              {activeTab === "pa"           && <PaPanel pa={snapshot?.pa} isLoading={isAnalyzing} />}
              {activeTab === "pa_level"     && <PaLevelPanel advanced={snapshot?.advanced as any} isLoading={isAnalyzing} />}
              {activeTab === "divergence"   && <DivergencePanel advanced={snapshot?.advanced as any} isLoading={isAnalyzing} />}
              {activeTab === "chan"          && <ChanPanel chanMtf={chanMtfData} chan={chanData} timeframe="4h" isLoading={isAnalyzing} />}
              {activeTab === "chan_enhanced" && <ChanEnhancedPanel advanced={snapshot?.advanced as any} isLoading={isAnalyzing} />}
              {activeTab === "strategy"     && (
                <div className="space-y-4">
                  <StrategyPanel
                    strategy={snapshot?.strategy}
                    symbol={symbol}
                    isLoading={isAnalyzing}
                    currentPrice={displayPrice ?? null}
                    lastPriceUpdateTs={wsLastUpdateTs ?? null}
                    wsStatus={wsStatus}
                  />
                  <CollapsibleSection title="📒 交易日誌" defaultOpen={false} storageKey="trade_journal">
                    <div className="p-3">
                      <TradeJournalPanel symbol={symbol} snapshot={snapshot} />
                    </div>
                  </CollapsibleSection>
                </div>
              )}
              {activeTab === "forecast"     && <ForecastPanel forecast={snapshot?.forecast_4h} isLoading={isAnalyzing} />}
              {activeTab === "onchain"      && <OnchainPanel onchain={snapshot?.onchain ?? null} isLoading={isAnalyzing} />}
              {activeTab === "consensus"    && (
                <div className="space-y-4">
                  <ConsensusPanel consensus={snapshot?.consensus as never} isLoading={isAnalyzing} />
                  <CollapsibleSection title="🔍 AI 可解釋性分析" defaultOpen={true} storageKey="ai_explain">
                    <div className="p-3">
                      <AIExplainPanel snapshot={snapshot} />
                    </div>
                  </CollapsibleSection>
                </div>
              )}
              {activeTab === "news"         && (
                <div className="space-y-3">
                  <div className="flex rounded overflow-hidden border border-[#2a2a2a]">
                    <button onClick={() => setNewsSubTab("news")}
                      className={`flex-1 text-xs py-2 transition-colors ${newsSubTab === "news" ? "bg-[#1e1e1e] text-foreground font-medium" : "bg-[#111] text-muted-foreground hover:text-foreground"}`}>
                      📰 最新新聞
                    </button>
                    <button onClick={() => setNewsSubTab("tweets")}
                      className={`flex-1 text-xs py-2 transition-colors border-l border-[#2a2a2a] ${newsSubTab === "tweets" ? "bg-[#1e1e1e] text-foreground font-medium" : "bg-[#111] text-muted-foreground hover:text-foreground"}`}>
                      🐦 Twitter 動態
                    </button>
                  </div>
                  {newsSubTab === "news"   && <NewsPanel symbol={symbol} />}
                  {newsSubTab === "tweets" && <TweetPanel symbol={symbol} />}
                </div>
              )}
              {activeTab === "highwinrate"  && <HighWinRatePanel symbol={symbol} />}
              {activeTab === "history"      && <BacktestPanel symbol={symbol} />}
              {activeTab === "panda"        && <PandaPanel symbol={symbol} />}
              {activeTab === "combo"        && <ComboStrategyPanel symbol={symbol} />}
              {activeTab === "signal_alert" && <SignalAlertPanel symbol={symbol} />}
              {activeTab === "smc_learning"  && (
                <CompactAnalysisShell
                  icon="🎓"
                  title="SMC 學習資源中心"
                  subtitle="將學習路徑、頻道推薦與部署指南先濃縮成單一卡片入口，需要時再展開完整內容。"
                  badges={["學習路線", "頻道推薦", "部署指南"]}
                  defaultOpen={false}
                  storageKey="smc_learning"
                >
                  <SmcLearningPanel />
                </CompactAnalysisShell>
              )}
              {activeTab === "ict_analysis"  && (
                <CompactAnalysisShell
                  icon="🧠"
                  title="ICT 框架速覽"
                  subtitle="先看 AMD、iFVG、MMXM 與 I2E/E2I 的分析入口，避免長頁面一次展開全部模型。"
                  badges={["AMD", "iFVG", "MMXM", "1h"]}
                  defaultOpen={false}
                  storageKey="ict_analysis"
                >
                  <IctAnalysisPanel snapshot={snapshot} currentPrice={displayPrice} isLoading={isAnalyzing} timeframe="1h" />
                </CompactAnalysisShell>
              )}
              {activeTab === "pa_louie"      && (
                <CompactAnalysisShell
                  icon="📊"
                  title="PA 方方土分析速覽"
                  subtitle="先看假突破、第二段陷阱與 Measured Move 的摘要入口，再按需展開完整 Price Action 細節。"
                  badges={["80-20", "第二段陷阱", "Measured Move"]}
                  defaultOpen={false}
                  storageKey="pa_louie"
                >
                  <PaLouiePanel snapshot={snapshot} currentPrice={displayPrice} isLoading={isAnalyzing} />
                </CompactAnalysisShell>
              )}
              {activeTab === "snr_analysis"   && (
                <CompactAnalysisShell
                  icon="📐"
                  title="SNR 支撐阻力速覽"
                  subtitle="先看故事線、關鍵區域與多時間框架摘要，僅在需要時再展開全部 S/R 細節表格。"
                  badges={["故事線", "關鍵區域", "多時間框架"]}
                  defaultOpen={false}
                  storageKey="snr_analysis"
                >
                  <SnrPanel snapshot={snapshot} currentPrice={displayPrice} isLoading={isAnalyzing} />
                </CompactAnalysisShell>
              )}
              {activeTab === "champion_analysis" && (
                <CompactAnalysisShell
                  icon="⚡"
                  title="冠軍分析速覽"
                  subtitle="保留冠軍模型的核心判斷入口，避免完整分析區塊預設撐長整個頁面。"
                  badges={["冠軍模型", "執行偏向", symbol]}
                  defaultOpen={false}
                  storageKey="champion_analysis"
                >
                  <ChampionAnalysisPanel snapshot={snapshot} currentPrice={displayPrice} isLoading={isAnalyzing} symbol={symbol} />
                </CompactAnalysisShell>
              )}
              {activeTab === "champion_trader" && (
                <CompactAnalysisShell
                  icon="📚"
                  title="冠軍交易者學習資源"
                  subtitle="把學習清單與每日訓練內容收進單一卡片，讓導覽頁保持緊湊。"
                  badges={["學習資源", "日程", "清單"]}
                  defaultOpen={false}
                  storageKey="champion_trader"
                >
                  <ChampionTraderPanel />
                </CompactAnalysisShell>
              )}
              {activeTab === "cannonball" && (
                <CompactAnalysisShell
                  icon="🎯"
                  title="CannonBall 分析速覽"
                  subtitle="沿用主頁緊湊化原則，先看方法論入口與當前任務，再按需展開完整 OB 結構分析。"
                  badges={["Order Block", "結構確認", "實戰"]}
                  defaultOpen={true}
                  storageKey="cannonball"
                >
                  <CannonballPanel symbol={symbol} />
                </CompactAnalysisShell>
              )}
              {activeTab === "settings"     && (
                <div className={getInfoPanelClassName()}>
                  <div className="text-sm font-semibold text-[#ccc]">⚙️ 系統設定</div>

                  <div className={settingCardClassName()} style={settingCardStyle()}>
                    <div className={getSectionHeaderClassName()}>
                      <div>
                        <div className={getPrimaryTextClassName()}>指標卡片管理</div>
                        <div className={getSettingsDescriptionClassName()}>管理首頁顯示卡片與資訊密度，這部分沿用現有偏好設定。</div>
                      </div>
                      <span className={getSmallBadgeClassName()}>UI 管理</span>
                    </div>
                    <button onClick={() => setShowWidgetMgr(true)} className="mt-3 px-4 py-2 rounded text-xs text-[#ccc] border border-[#2a2a2a] hover:border-[#ffd740] hover:text-[#ffd740] transition-colors">
                      管理顯示卡片
                    </button>
                  </div>

                  <div className={settingCardClassName()} style={settingCardStyle()}>
                    <div className={getSectionHeaderClassName()}>
                      <div>
                        <div className={getPrimaryTextClassName()}>AI 模型設定</div>
                        <div className={getSettingsDescriptionClassName()}>{getModelLoadingLabel(systemConfigQuery.isLoading, !!systemConfigQuery.error)}</div>
                      </div>
                      <span className={getSmallBadgeClassName()}>{systemConfigQuery.data?.node_env ?? "development"}</span>
                    </div>
                    <div className={getModelRowsGridClassName()}>
                      {modelCardRows(systemConfigQuery.data).map((item) => (
                        <div key={item.label} className={getMiniCardClassName()}>
                          <div className={getMutedTextClassName()}>{item.label}</div>
                          <div className={getValueTextClassName()}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={getWideSettingsGridClassName()}>
                    <div className={settingCardClassName()} style={settingCardStyle()}>
                      <div className={getSectionHeaderClassName()}>
                        <div>
                          <div className={getPrimaryTextClassName()}>全域資金與風險</div>
                          <div className={getSettingsDescriptionClassName()}>作為策略與倉位估算的預設值，寫入本機後可供相關模組直接讀取。</div>
                        </div>
                        <span className={getSmallBadgeClassName()}>本機持久化</span>
                      </div>
                      <div className={getFormGridTwoClassName()}>
                        <label>
                          <div className={settingLabelClassName()}>預設資金</div>
                          <input
                            type="number"
                            min="100"
                            step="100"
                            value={globalCapital}
                            onChange={(e) => setGlobalCapital(parseCapitalInput(e.target.value, globalCapital))}
                            className={getInputClassName()}
                          />
                          <div className={sectionHintClassName()}>用於策略倉位計算的預設本金。</div>
                        </label>
                        <label>
                          <div className={settingLabelClassName()}>單筆風險比例 (%)</div>
                          <input
                            type="number"
                            min="0.1"
                            max="20"
                            step="0.1"
                            value={globalRiskPct}
                            onChange={(e) => setGlobalRiskPct(parsePercentInput(e.target.value, globalRiskPct))}
                            className={getInputClassName()}
                          />
                          <div className={sectionHintClassName()}>CannonBall 等策略會優先讀取此預設風險比例。</div>
                        </label>
                      </div>
                      <div className={`${getSettingsNoteClassName()} mt-3`}>目前全域預設：本金 <span className="text-[#ffd740]">{globalCapital}</span>，風險 <span className="text-[#ffd740]">{globalRiskPct}%</span>。</div>
                    </div>

                    <div className={settingCardClassName()} style={settingCardStyle()}>
                      <div className={getSectionHeaderClassName()}>
                        <div>
                          <div className={getPrimaryTextClassName()}>智能刷新設定</div>
                          <div className={getSettingsDescriptionClassName()}>保留 ATR 驅動的提前重跑邏輯，同時把基礎刷新間隔做成可調整設定。</div>
                        </div>
                        <span className={getSmallBadgeClassName()}>自動刷新</span>
                      </div>
                      <label>
                        <div className={settingLabelClassName()}>基礎刷新間隔</div>
                        <select
                          value={String(refreshIntervalSecs)}
                          onChange={(e) => setRefreshIntervalSecs(clampRefreshIntervalSecs(Number(e.target.value)))}
                          className={getSelectClassName()}
                        >
                          {refreshIntervalOptions().map((value) => (
                            <option key={value} value={value}>{formatRefreshInterval(value)}</option>
                          ))}
                        </select>
                      </label>
                      <div className={sectionHintClassName()}>{getRefreshInputHint(refreshIntervalSecs)} {getRefreshThresholdHint()}</div>
                      <div className={`${getSettingsNoteClassName()} mt-3`}>下次刷新：<span className="text-[#ffd740]">{nextRefreshSecs !== null ? `${nextRefreshSecs}s` : "等待分析啟動"}</span></div>
                    </div>
                  </div>

                  <div className={settingCardClassName()} style={settingCardStyle()}>
                    <div className={getSectionHeaderClassName()}>
                      <div>
                        <div className={getPrimaryTextClassName()}>CannonBall 預設值</div>
                        <div className={getSettingsDescriptionClassName()}>這些值會寫入 CannonBall 的本機預設參數。進入 CannonBall 分頁後，會以這組設定作為初始值。</div>
                      </div>
                      <div className={getInlineGroupClassName()}>
                        <span className={getPillClassName(cannonballDefaults.htf_tf === "2H")}>HTF {cannonballDefaults.htf_tf}</span>
                        <span className={getPillClassName(cannonballDefaults.ltf_tf === "30m")}>LTF {cannonballDefaults.ltf_tf}</span>
                        <button
                          type="button"
                          onClick={() => setCannonballDefaults(DEFAULT_CANNONBALL_PARAMS)}
                          className={getResetButtonClassName()}
                        >
                          還原預設
                        </button>
                      </div>
                    </div>

                    <div className={getFormGridTwoClassName()}>
                      <label>
                        <div className={settingLabelClassName()}>高週期 (HTF)</div>
                        <select
                          value={cannonballDefaults.htf_tf}
                          onChange={(e) => setCannonballDefaults(prev => ({ ...prev, htf_tf: e.target.value as CannonballSettings["htf_tf"] }))}
                          className={getSelectClassName()}
                        >
                          {timeframeOptions("htf").map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        <div className={settingLabelClassName()}>低週期 (LTF)</div>
                        <select
                          value={cannonballDefaults.ltf_tf}
                          onChange={(e) => setCannonballDefaults(prev => ({ ...prev, ltf_tf: e.target.value as CannonballSettings["ltf_tf"] }))}
                          className={getSelectClassName()}
                        >
                          {timeframeOptions("ltf").map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {([
                        ["sl_atr_mult", "止損 ATR 倍數", "越小代表停損更貼近 OB。", " 倍"],
                        ["tp2_atr_mult", "TP2 ATR 倍數", "第二目標的機械延伸距離。", " 倍"],
                        ["confluence_threshold", "共振門檻", "用來過濾訊號品質，數值越高越嚴格。", " 分"],
                        ["avoid_extremes_atr", "極端行情避讓", "避免在過度延伸位置追價。", " ATR"],
                      ] as const).map(([key, label, hint, suffix]) => {
                        const config = getCannonballRangeConfig(key);
                        const currentValue = cannonballDefaults[key];
                        return (
                          <div key={key} className={getRangeRowClassName()}>
                            <div className={getSectionHeaderClassName()}>
                              <div>
                                <div className={getPrimaryTextClassName()}>{label}</div>
                                <div className={getSubtleTextClassName()}>{hint}</div>
                              </div>
                              <span className={getAccentValueClassName()}>{getSliderValueLabel(currentValue, suffix)}</span>
                            </div>
                            <input
                              type="range"
                              min={config.min}
                              max={config.max}
                              step={config.step}
                              value={currentValue}
                              onChange={(e) => setCannonballDefaults(prev => ({ ...prev, [key]: parseCannonballInput(key, e.target.value) }))}
                              className={sliderClassName()}
                            />
                            <div className={getSliderHintClassName()}>
                              <span>{config.min}</span>
                              <input
                                type="number"
                                min={config.min}
                                max={config.max}
                                step={numericStepValue(key)}
                                value={currentValue}
                                onChange={(e) => setCannonballDefaults(prev => ({ ...prev, [key]: parseCannonballInput(key, e.target.value) }))}
                                className="w-24 rounded border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-1 text-right text-xs text-[#ddd] outline-none focus:border-[#ffd740]"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </Suspense>
          )}
        </div>
      </div>

      {/* ══ STATUS BAR ══ */}
      {(() => {
        // ★ 修復：資料新鮮度計算
        const dataAgeSecs = lastUpdated ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000) : null;
        const dataAgeMin  = dataAgeSecs !== null ? Math.floor(dataAgeSecs / 60) : null;
        const isStale     = dataAgeSecs !== null && dataAgeSecs > 300; // 超過 5 分鐘為過期
        const isCritical  = dataAgeSecs !== null && dataAgeSecs > 900; // 超過 15 分鐘為嚴重過期
        const freshnessColor = isCritical ? "#ef5350" : isStale ? "#ffd740" : "#555";
        const freshnessLabel = dataAgeMin !== null
          ? dataAgeMin === 0 ? "剛剛更新" : `${dataAgeMin} 分鐘前`
          : "尚未分析";
        return (
          <div
            className={`border-t ${isMobile ? "px-3 py-2" : "flex items-center justify-between px-4 py-1.5 text-[10px]"}`}
            style={{ background: "#0f0f0f", borderColor: "#1e1e1e" }}
          >
            {isMobile ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-[#666]">系統狀態</span>
                  <span
                    className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold"
                    style={{ color: marketStatusConfig.color, background: marketStatusConfig.bg, border: `1px solid ${marketStatusConfig.border}` }}
                  >
                    {marketStatusConfig.label}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-[#2a2a2a] px-2 py-1 text-[10px] text-[#8a8a8a]">
                    {providerLabel}
                  </span>
                  {wsLatency !== null && isLive && wsStatus === "connected" && (
                    <span className="inline-flex items-center rounded-full border border-[#1d3d6b] bg-[rgba(59,130,246,0.12)] px-2 py-1 text-[10px] text-[#60a5fa]">
                      {wsLatency}ms
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 text-[10px] sm:grid-cols-3">
                  <div className="rounded-lg border border-[#202020] bg-[#121212] px-2.5 py-2 text-[#8a8a8a]">
                    <div className="text-[#666] mb-1">即時資料</div>
                    <div className="text-[#d0d0d0]">{marketFreshnessLabel}</div>
                    {wsMessage && <div className="mt-1 text-[#777] leading-relaxed">{formatFriendlyRuntimeError(wsMessage)}</div>}
                  </div>
                  <div className="rounded-lg border border-[#202020] bg-[#121212] px-2.5 py-2 text-[#8a8a8a]">
                    <div className="text-[#666] mb-1">分析資料</div>
                    <div style={{ color: freshnessColor }}>資料：{freshnessLabel}</div>
                    {lastUpdated && <div className="mt-1 text-[#777]">{lastUpdated.toLocaleTimeString("zh-TW")}</div>}
                  </div>
                  <div className="rounded-lg border border-[#202020] bg-[#121212] px-2.5 py-2 text-[#8a8a8a]">
                    <div className="text-[#666] mb-1">刷新節奏</div>
                    <div className="text-[#d0d0d0]">{nextRefreshSecs !== null && snapshot ? `下次 ${nextRefreshSecs}s` : "等待分析啟動"}</div>
                    <div className="mt-1 text-[#777]">{isAnalyzing ? "分析中..." : isCritical ? "建議立即重跑" : "ATR 智能刷新"}</div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-[#555]">
                  <span>系統狀態</span>
                  <span className={isLive ? "text-[#4caf50]" : "text-[#ef5350]"}>●</span>
                  <span className={isLive ? "text-[#4caf50]" : hasSnapshotFallback ? "text-[#ffd740]" : "text-[#ef5350]"}>WS {wsStatus === "connected" ? "Kraken 輪詢正常" : hasSnapshotFallback ? "快照模式" : wsStatus === "fallback" ? "資料降級" : wsStatus === "connecting" ? "連接中" : "斷開"}</span>
                  {wsLatency !== null && isLive && wsStatus === "connected" && (
                    <span className="text-[#3b82f6]">{wsLatency}ms</span>
                  )}
                  {isAnalyzing && <span className="text-[#ffd740]">· 分析中...</span>}
                  <span className="text-[#444]">來源: {providerLabel}</span>
                  {wsMessage && <span className="text-[#666]">· {formatFriendlyRuntimeError(wsMessage)}</span>}
                </div>
                <div className="flex items-center gap-3 text-[#555]">
                  {nextRefreshSecs !== null && snapshot && (
                    <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />下次刷新 {nextRefreshSecs}s</span>
                  )}
                  {lastUpdated && (
                    <span className="flex items-center gap-1" style={{ color: freshnessColor }}>
                      {isStale && <span>⚠️</span>}
                      資料：{freshnessLabel}
                      {isCritical && <span>(請重新分析)</span>}
                    </span>
                  )}
                  {lastUpdated && <span>最後分析：{lastUpdated.toLocaleTimeString("zh-TW")}</span>}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* Widget Manager Modal */}
      {showWidgetMgr && (
        <WidgetManager currentIds={widgetIds} onSave={handleWidgetSave} onClose={() => setShowWidgetMgr(false)} />
      )}

      {/* 點擊外部關閉幣種搜索 */}
      {showSymbolSearch && <div className="fixed inset-0 z-40" onClick={() => setShowSymbolSearch(false)} />}
    </div>
  );
}
