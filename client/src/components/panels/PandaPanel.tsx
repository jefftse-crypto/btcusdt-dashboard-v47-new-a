/**
 * PandaPanel.tsx — 熊貓策略面板 v5.4
 * 基於 YouTube 頻道「投資腦袋の熊敖」(@bh1908) 策略
 * v5.3 整合：MACD 多週期分離法、MJ 指標、布林通道+RSI、EMA 假突破、K 線三走勢
 * v5.4 新增：Vegas 雙通道、ATR 動態止損、KD 高勝率、成交量確認、三角收斂、MACD 背離
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Activity,
  BarChart2, Target, AlertTriangle, CheckCircle, XCircle,
  ChevronDown, ChevronUp, Zap, Shield, BookOpen, Clock,
  Award, BarChart, PieChart, ArrowUpRight, ArrowDownRight,
  Layers, Volume2, Triangle, GitBranch, Radio, Cpu,
} from "lucide-react";

// ─── v5.3 型別定義 ────────────────────────────────────────────────────────────

interface MACDMtfResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  htf_trend: "UP" | "DOWN" | "FLAT";
  ltf_histogram_below_zero: boolean;
  ltf_dif_separation: boolean;
  separation_strength: number;
}

interface MJIndicatorResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  j_cross_zero: boolean;
  j_direction: "UP" | "DOWN" | "FLAT";
  macd_bar_sync: boolean;
  is_valid: boolean;
}

interface BollRsiResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  boll_direction: "UP" | "DOWN" | "FLAT";
  rsi_cross_50: boolean;
  rsi_direction: "UP" | "DOWN" | "FLAT";
  divergence: "BULLISH" | "BEARISH" | "NONE";
  rsi_value: number;
}

interface EmaFakeoutResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  ema_direction: "UP" | "DOWN" | "FLAT";
  ltf_fakeout_detected: boolean;
  htf_confirmed: boolean;
  fakeout_type: "FAKE_BREAKOUT_UP" | "FAKE_BREAKOUT_DOWN" | "NONE";
}

interface KlineTrendResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  trend_type: "TRENDING" | "COUNTER_TREND" | "RANGING";
  ema_direction: "UP" | "DOWN" | "FLAT";
  reversal_signal: boolean;
  reversal_type: "BULLISH" | "BEARISH" | "NONE";
  is_chasing: boolean;
}

// ─── v5.4 型別定義 ────────────────────────────────────────────────────────────

interface VegasTunnelResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  ema12_direction: "UP" | "DOWN" | "FLAT";
  price_vs_short_tunnel: "ABOVE" | "BELOW" | "INSIDE";
  price_vs_long_tunnel: "ABOVE" | "BELOW" | "INSIDE";
  tunnel_aligned: boolean;
  entry_type: "PULLBACK" | "BREAKOUT" | "NONE";
}

interface AtrDynamicResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  atr_value: number;
  atr_trend: "EXPANDING" | "CONTRACTING" | "STABLE";
  sl_distance_ok: boolean;
  breakout_confirmed: boolean;
  dynamic_sl: number;
  dynamic_tp1: number;
  dynamic_tp2: number;
}

interface KdHighWinResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  k_value: number;
  d_value: number;
  kd_cross: "GOLDEN" | "DEATH" | "NONE";
  ema20_direction: "UP" | "DOWN" | "FLAT";
  kd_in_oversold: boolean;
  kd_in_overbought: boolean;
  trend_aligned: boolean;
}

interface VolumeConfirmResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  volume_trend: "INCREASING" | "DECREASING" | "STABLE";
  volume_ratio: number;
  breakout_with_volume: boolean;
  divergence: "BULLISH" | "BEARISH" | "NONE";
}

interface TriangleBreakoutResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  pattern_detected: boolean;
  convergence_ratio: number;
  breakout_direction: "UP" | "DOWN" | "NONE";
  trend_direction: "UP" | "DOWN" | "FLAT";
  volume_confirm: boolean;
}

interface MacdDivergenceResult {
  signal: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  divergence_type: "BULLISH" | "BEARISH" | "NONE";
  htf_trend: "UP" | "DOWN" | "FLAT";
  rr_ratio_ok: boolean;
  macd_overlap: boolean;
}

// ─── 主信號型別 ───────────────────────────────────────────────────────────────

interface PandaSignalV54 {
  symbol: string;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  grade: "STRONG" | "MODERATE" | "WAIT" | "AVOID";
  strategies: {
    macd_mtf: MACDMtfResult;
    mj_indicator: MJIndicatorResult;
    boll_rsi: BollRsiResult;
    ema_fakeout: EmaFakeoutResult;
    kline_trend: KlineTrendResult;
  };
  strategies_v54: {
    vegas_tunnel: VegasTunnelResult;
    atr_dynamic: AtrDynamicResult;
    kd_high_win: KdHighWinResult;
    volume_confirm: VolumeConfirmResult;
    triangle_breakout: TriangleBreakoutResult;
    macd_divergence: MacdDivergenceResult;
  };
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  rr_ratio: number;
  veto_reasons: string[];
  score_v54: number;
  grade_v54: "STRONG" | "MODERATE" | "WAIT" | "AVOID";
  timestamp: number;
}

interface BacktestGradeStats {
  trades: number;
  win_rate: number;
  avg_pnl: number;
}

interface BacktestResult {
  symbol: string;
  total_trades: number;
  win_trades: number;
  loss_trades: number;
  win_rate: number;
  avg_rr: number;
  total_pnl_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  profit_factor: number;
  by_grade: {
    STRONG: BacktestGradeStats;
    MODERATE: BacktestGradeStats;
    WAIT: BacktestGradeStats;
  };
  trades: Array<{
    entry_time: number;
    exit_time: number;
    direction: "LONG" | "SHORT";
    entry_price: number;
    exit_price: number;
    stop_loss: number;
    take_profit: number;
    pnl_pct: number;
    result: "WIN" | "LOSS" | "BREAKEVEN";
    score: number;
    grade: "STRONG" | "MODERATE" | "WAIT" | "AVOID";
    exit_reason: "TP1" | "TP2" | "SL" | "TIMEOUT";
  }>;
}

// ─── 輔助元件 ─────────────────────────────────────────────────────────────────

const DirectionBadge = ({ dir }: { dir: "LONG" | "SHORT" | "NEUTRAL" }) => {
  const cfg = {
    LONG:    { bg: "#0d2b1a", border: "#22c55e", text: "#22c55e", icon: <TrendingUp size={12} />, label: "做多" },
    SHORT:   { bg: "#2b0d0d", border: "#ef4444", text: "#ef4444", icon: <TrendingDown size={12} />, label: "做空" },
    NEUTRAL: { bg: "#1a1a1a", border: "#666",    text: "#888",    icon: <Minus size={12} />, label: "觀望" },
  }[dir];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 20, background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.text, fontSize: 12, fontWeight: 700 }}>
      {cfg.icon} {cfg.label}
    </span>
  );
};

const GradeBadge = ({ grade, label }: { grade: "STRONG" | "MODERATE" | "WAIT" | "AVOID"; label?: string }) => {
  const cfg = {
    STRONG:   { bg: "#0d2b1a", border: "#22c55e", text: "#22c55e", label: "強烈進場" },
    MODERATE: { bg: "#1a1f0d", border: "#84cc16", text: "#84cc16", label: "中等進場" },
    WAIT:     { bg: "#1a1500", border: "#f59e0b", text: "#f59e0b", label: "等待確認" },
    AVOID:    { bg: "#2b0d0d", border: "#ef4444", text: "#ef4444", label: "避免進場" },
  }[grade];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 20, background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.text, fontSize: 12, fontWeight: 700 }}>
      {label ?? cfg.label}
    </span>
  );
};

const ScoreBar = ({ score, label, color }: { score: number; label: string; color: string }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 11, color: "#aaa" }}>
      <span>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{score}</span>
    </div>
    <div style={{ height: 4, background: "#222", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 2, transition: "width 0.5s ease" }} />
    </div>
  </div>
);

const SignalIcon = ({ signal }: { signal: "LONG" | "SHORT" | "NEUTRAL" }) => {
  if (signal === "LONG") return <ArrowUpRight size={14} color="#22c55e" />;
  if (signal === "SHORT") return <ArrowDownRight size={14} color="#ef4444" />;
  return <Minus size={14} color="#666" />;
};

const StatusDot = ({ ok }: { ok: boolean }) => (
  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: ok ? "#22c55e" : "#ef4444", marginRight: 4 }} />
);

// ─── 策略詳情卡片 ─────────────────────────────────────────────────────────────

const StrategyCard = ({ title, icon, result, expanded, onToggle, badge }: {
  title: string;
  icon: React.ReactNode;
  result: unknown;
  expanded: boolean;
  onToggle: () => void;
  badge?: string;
}) => {
  const r = result as { signal: "LONG" | "SHORT" | "NEUTRAL"; score: number; [key: string]: unknown };
  const signalColor = r.signal === "LONG" ? "#22c55e" : r.signal === "SHORT" ? "#ef4444" : "#666";

  // 友好的欄位名稱映射
  const fieldLabels: Record<string, string> = {
    htf_trend: "大週期趨勢",
    ltf_histogram_below_zero: "LTF 柱體在零軸下",
    ltf_dif_separation: "快線分離",
    separation_strength: "分離強度",
    j_cross_zero: "J 線穿越 0 軸",
    j_direction: "J 線方向",
    macd_bar_sync: "MACD 柱體同步",
    is_valid: "有效訊號",
    boll_direction: "布林方向",
    rsi_cross_50: "RSI 穿越 50",
    rsi_direction: "RSI 方向",
    divergence: "背離狀態",
    rsi_value: "RSI 值",
    ema_direction: "EMA 方向",
    ltf_fakeout_detected: "假突破偵測",
    htf_confirmed: "大週期確認",
    fakeout_type: "假突破類型",
    trend_type: "走勢類型",
    reversal_signal: "反轉訊號",
    reversal_type: "反轉類型",
    is_chasing: "追單風險",
    ema12_direction: "EMA12 方向",
    price_vs_short_tunnel: "相對短期通道",
    price_vs_long_tunnel: "相對長期通道",
    tunnel_aligned: "通道方向一致",
    entry_type: "進場類型",
    atr_value: "ATR 值",
    atr_trend: "ATR 趨勢",
    sl_distance_ok: "止損距離足夠",
    breakout_confirmed: "突破確認",
    dynamic_sl: "動態止損",
    dynamic_tp1: "動態止盈 1",
    dynamic_tp2: "動態止盈 2",
    k_value: "K 值",
    d_value: "D 值",
    kd_cross: "KD 交叉",
    ema20_direction: "EMA20 方向",
    kd_in_oversold: "KD 超賣區",
    kd_in_overbought: "KD 超買區",
    trend_aligned: "趨勢一致",
    volume_trend: "成交量趨勢",
    volume_ratio: "量比（/均量）",
    breakout_with_volume: "放量突破",
    pattern_detected: "型態偵測",
    convergence_ratio: "收斂比例",
    breakout_direction: "突破方向",
    trend_direction: "趨勢方向",
    volume_confirm: "成交量確認",
    divergence_type: "背離類型",
    rr_ratio_ok: "盈虧比 ≥ 2",
    macd_overlap: "MACD 重疊確認",
  };

  return (
    <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
      <button onClick={onToggle} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "transparent", border: "none", cursor: "pointer", color: "#ccc" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon}
          <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
          {badge && (
            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "#1a2a1a", border: "1px solid #22c55e44", color: "#22c55e88" }}>
              {badge}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SignalIcon signal={r.signal} />
          <span style={{ fontSize: 12, color: signalColor, fontWeight: 700 }}>{r.score}</span>
          {expanded ? <ChevronUp size={14} color="#666" /> : <ChevronDown size={14} color="#666" />}
        </div>
      </button>
      {expanded && (
        <div style={{ padding: "0 14px 12px", borderTop: "1px solid #1a1a1a" }}>
          <ScoreBar score={r.score} label="策略評分" color={signalColor} />
          {Object.entries(r).filter(([k]) => !["signal", "score"].includes(k)).map(([key, val]) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginTop: 4 }}>
              <span style={{ color: "#666" }}>{fieldLabels[key] ?? key.replace(/_/g, " ")}</span>
              <span style={{ color: typeof val === "boolean" ? (val ? "#22c55e" : "#ef4444") : "#aaa", fontWeight: 600 }}>
                {typeof val === "boolean" ? (val ? "✓" : "✗") : typeof val === "number" ? val.toFixed(val > 100 ? 2 : 3) : String(val)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── 雙評分對比卡片 ───────────────────────────────────────────────────────────

const DualScoreCard = ({ signal }: { signal: PandaSignalV54 }) => {
  const score53Color = signal.score >= 70 ? "#22c55e" : signal.score >= 55 ? "#f59e0b" : "#ef4444";
  const score54Color = signal.score_v54 >= 70 ? "#22c55e" : signal.score_v54 >= 55 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
      <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 10, padding: "12px", textAlign: "center" }}>
        <div style={{ fontSize: 9, color: "#555", marginBottom: 4 }}>v5.3 評分（5 策略）</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: score53Color }}>{signal.score}</div>
        <div style={{ marginTop: 4 }}><GradeBadge grade={signal.grade} /></div>
      </div>
      <div style={{ background: "#0a0f0a", border: "1px solid #22c55e22", borderRadius: 10, padding: "12px", textAlign: "center" }}>
        <div style={{ fontSize: 9, color: "#22c55e66", marginBottom: 4 }}>v5.4 評分（11 策略）</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: score54Color }}>{signal.score_v54}</div>
        <div style={{ marginTop: 4 }}><GradeBadge grade={signal.grade_v54} label={signal.grade_v54 === "STRONG" ? "強烈進場" : signal.grade_v54 === "MODERATE" ? "中等進場" : signal.grade_v54 === "WAIT" ? "等待確認" : "避免進場"} /></div>
      </div>
    </div>
  );
};

// ─── 回測面板 ─────────────────────────────────────────────────────────────────

const BacktestView = ({ data }: { data: BacktestResult }) => {
  const [showTrades, setShowTrades] = useState(false);

  return (
    <div>
      {/* 核心指標 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
        {[
          { label: "總交易數", value: data.total_trades, color: "#aaa" },
          { label: "勝率", value: `${data.win_rate}%`, color: data.win_rate >= 60 ? "#22c55e" : data.win_rate >= 50 ? "#f59e0b" : "#ef4444" },
          { label: "盈虧比", value: data.avg_rr.toFixed(2), color: data.avg_rr >= 1.5 ? "#22c55e" : "#f59e0b" },
          { label: "總收益", value: `${data.total_pnl_pct > 0 ? "+" : ""}${data.total_pnl_pct}%`, color: data.total_pnl_pct > 0 ? "#22c55e" : "#ef4444" },
          { label: "最大回撤", value: `${data.max_drawdown_pct}%`, color: data.max_drawdown_pct < 10 ? "#22c55e" : data.max_drawdown_pct < 20 ? "#f59e0b" : "#ef4444" },
          { label: "Sharpe", value: data.sharpe_ratio.toFixed(2), color: data.sharpe_ratio >= 1 ? "#22c55e" : data.sharpe_ratio >= 0.5 ? "#f59e0b" : "#ef4444" },
          { label: "盈利因子", value: data.profit_factor.toFixed(2), color: data.profit_factor >= 1.5 ? "#22c55e" : data.profit_factor >= 1 ? "#f59e0b" : "#ef4444" },
          { label: "勝場", value: data.win_trades, color: "#22c55e" },
          { label: "敗場", value: data.loss_trades, color: "#ef4444" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* 按等級分析 */}
      <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 10, fontWeight: 600 }}>按信號等級分析</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: "#666" }}>
              <th style={{ textAlign: "left", padding: "4px 0" }}>等級</th>
              <th style={{ textAlign: "right", padding: "4px 0" }}>交易數</th>
              <th style={{ textAlign: "right", padding: "4px 0" }}>勝率</th>
              <th style={{ textAlign: "right", padding: "4px 0" }}>平均收益</th>
            </tr>
          </thead>
          <tbody>
            {(["STRONG", "MODERATE", "WAIT"] as const).map(grade => {
              const stats = data.by_grade[grade];
              const gradeColor = grade === "STRONG" ? "#22c55e" : grade === "MODERATE" ? "#84cc16" : "#f59e0b";
              return (
                <tr key={grade} style={{ borderTop: "1px solid #1a1a1a" }}>
                  <td style={{ padding: "6px 0", color: gradeColor, fontWeight: 600 }}>
                    {grade === "STRONG" ? "強烈" : grade === "MODERATE" ? "中等" : "等待"}
                  </td>
                  <td style={{ textAlign: "right", color: "#aaa" }}>{stats.trades}</td>
                  <td style={{ textAlign: "right", color: stats.win_rate >= 60 ? "#22c55e" : stats.win_rate >= 50 ? "#f59e0b" : "#ef4444" }}>
                    {stats.win_rate}%
                  </td>
                  <td style={{ textAlign: "right", color: stats.avg_pnl > 0 ? "#22c55e" : "#ef4444" }}>
                    {stats.avg_pnl > 0 ? "+" : ""}{stats.avg_pnl}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 最近交易記錄 */}
      <button onClick={() => setShowTrades(!showTrades)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, cursor: "pointer", color: "#888", fontSize: 12, marginBottom: 8 }}>
        <span>最近交易記錄（{data.trades.length} 筆）</span>
        {showTrades ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {showTrades && (
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {data.trades.slice().reverse().map((trade, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#0d0d0d", borderBottom: "1px solid #111", fontSize: 11 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: trade.direction === "LONG" ? "#22c55e" : "#ef4444", fontWeight: 700, fontSize: 10 }}>
                  {trade.direction === "LONG" ? "多" : "空"}
                </span>
                <span style={{ color: "#666" }}>{new Date(trade.entry_time).toLocaleDateString()}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#555", fontSize: 10 }}>{trade.exit_reason}</span>
                <span style={{ color: trade.result === "WIN" ? "#22c55e" : trade.result === "LOSS" ? "#ef4444" : "#888", fontWeight: 700 }}>
                  {trade.pnl_pct > 0 ? "+" : ""}{trade.pnl_pct}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── 主面板組件 ───────────────────────────────────────────────────────────────

interface PandaPanelProps {
  symbol: string;
}

export default function PandaPanel({ symbol }: PandaPanelProps) {
  const [activeView, setActiveView] = useState<"signal" | "backtest">("signal");
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<"1H" | "4H" | "1D">("4H");
  const [showV53, setShowV53] = useState(false);

  const scanMutation = trpc.panda.scan.useMutation();
  const backtestMutation = trpc.panda.backtest.useMutation();

  const handleScan = () => {
    scanMutation.mutate({ symbol, timeframe });
  };

  const handleBacktest = () => {
    backtestMutation.mutate({ symbol, timeframe, minScore: 55 });
  };

  const signal = scanMutation.data as PandaSignalV54 | undefined;
  const backtest = backtestMutation.data as BacktestResult | undefined;

  // v5.3 原有 5 種策略
  const v53StrategyConfigs = signal ? [
    { key: "macd_mtf",     title: "MACD 多週期分離法",  icon: <Activity size={14} color="#60a5fa" />,  result: signal.strategies.macd_mtf },
    { key: "mj_indicator", title: "MJ 指標（MACD+KDJ）", icon: <BarChart2 size={14} color="#a78bfa" />, result: signal.strategies.mj_indicator },
    { key: "boll_rsi",     title: "布林通道 + RSI",      icon: <PieChart size={14} color="#34d399" />,  result: signal.strategies.boll_rsi },
    { key: "ema_fakeout",  title: "EMA 假突破 SMC",      icon: <Zap size={14} color="#fbbf24" />,       result: signal.strategies.ema_fakeout },
    { key: "kline_trend",  title: "K 線三走勢過濾",      icon: <BarChart size={14} color="#f87171" />,  result: signal.strategies.kline_trend },
  ] : [];

  // v5.4 新增 6 種策略
  const v54StrategyConfigs = signal?.strategies_v54 ? [
    { key: "vegas_tunnel",      title: "Vegas 雙通道",       icon: <Layers size={14} color="#38bdf8" />,    result: signal.strategies_v54.vegas_tunnel,      badge: "NEW" },
    { key: "atr_dynamic",       title: "ATR 動態止損",       icon: <Target size={14} color="#fb923c" />,    result: signal.strategies_v54.atr_dynamic,       badge: "NEW" },
    { key: "kd_high_win",       title: "KD 高勝率策略",      icon: <Award size={14} color="#c084fc" />,     result: signal.strategies_v54.kd_high_win,       badge: "NEW" },
    { key: "volume_confirm",    title: "成交量確認",         icon: <Volume2 size={14} color="#4ade80" />,   result: signal.strategies_v54.volume_confirm,    badge: "NEW" },
    { key: "triangle_breakout", title: "三角收斂突破",       icon: <Triangle size={14} color="#facc15" />,  result: signal.strategies_v54.triangle_breakout, badge: "NEW" },
    { key: "macd_divergence",   title: "MACD 背離高勝率",    icon: <GitBranch size={14} color="#f472b6" />, result: signal.strategies_v54.macd_divergence,   badge: "NEW" },
  ] : [];

  return (
    <div style={{ padding: "12px 0", color: "#ccc", fontFamily: "monospace" }}>
      {/* 標題列 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🐼</span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>熊貓策略面板</span>
              <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 10, background: "#0d2b1a", border: "1px solid #22c55e44", color: "#22c55e" }}>v5.4</span>
            </div>
            <div style={{ fontSize: 10, color: "#555" }}>基於「投資腦袋の熊敖」@bh1908 · 11 種策略</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["1H", "4H", "1D"] as const).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${timeframe === tf ? "#ffd740" : "#333"}`, background: timeframe === tf ? "#1a1500" : "transparent", color: timeframe === tf ? "#ffd740" : "#666", fontSize: 11, cursor: "pointer" }}>
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* 視圖切換 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setActiveView("signal")} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1px solid ${activeView === "signal" ? "#ffd740" : "#222"}`, background: activeView === "signal" ? "#1a1500" : "#111", color: activeView === "signal" ? "#ffd740" : "#666", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
          📡 即時信號
        </button>
        <button onClick={() => setActiveView("backtest")} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1px solid ${activeView === "backtest" ? "#ffd740" : "#222"}`, background: activeView === "backtest" ? "#1a1500" : "#111", color: activeView === "backtest" ? "#ffd740" : "#666", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
          📊 回測準確率
        </button>
      </div>

      {/* 即時信號視圖 */}
      {activeView === "signal" && (
        <>
          <button onClick={handleScan} disabled={scanMutation.isPending} style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid #ffd740", background: scanMutation.isPending ? "#111" : "#1a1500", color: scanMutation.isPending ? "#555" : "#ffd740", fontSize: 13, cursor: scanMutation.isPending ? "not-allowed" : "pointer", fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {scanMutation.isPending ? <><RefreshCw size={14} className="animate-spin" /> 掃描中（11 種策略）...</> : <><Zap size={14} /> 執行熊貓策略掃描 v5.4</>}
          </button>

          {scanMutation.isError && (
            <div style={{ background: "#1a0000", border: "1px solid #ef4444", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12, color: "#ef4444" }}>
              ⚠️ 掃描暫時不可用，資料可能正在重新整理，請稍後再試。
            </div>
          )}

          {signal && (
            <>
              {/* v5.4 主信號卡片 */}
              <div style={{ background: "#0d0d0d", border: "1px solid #22c55e22", borderRadius: 12, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{signal.symbol} · {timeframe} · v5.4</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <DirectionBadge dir={signal.direction} />
                      <GradeBadge grade={signal.grade_v54} />
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: signal.score_v54 >= 70 ? "#22c55e" : signal.score_v54 >= 55 ? "#f59e0b" : "#ef4444" }}>
                      {signal.score_v54}
                    </div>
                    <div style={{ fontSize: 10, color: "#555" }}>v5.4 綜合評分</div>
                  </div>
                </div>

                {/* 評分條 */}
                <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ height: "100%", width: `${signal.score_v54}%`, background: signal.score_v54 >= 70 ? "#22c55e" : signal.score_v54 >= 55 ? "#f59e0b" : "#ef4444", borderRadius: 3, transition: "width 0.8s ease" }} />
                </div>

                {/* 進出場價位 */}
                {signal.direction !== "NEUTRAL" && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                    {[
                      { label: "進場價", value: signal.entry_price.toFixed(2), color: "#aaa" },
                      { label: "止損（ATR 動態）", value: signal.stop_loss.toFixed(2), color: "#ef4444" },
                      { label: "止盈 1", value: signal.take_profit_1.toFixed(2), color: "#84cc16" },
                      { label: "止盈 2", value: signal.take_profit_2.toFixed(2), color: "#22c55e" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: "#111", borderRadius: 6, padding: "8px 10px" }}>
                        <div style={{ fontSize: 10, color: "#555", marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
                      </div>
                    ))}
                    <div style={{ gridColumn: "span 2", background: "#111", borderRadius: 6, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#555" }}>盈虧比 (RR)</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: signal.rr_ratio >= 2 ? "#22c55e" : signal.rr_ratio >= 1.5 ? "#f59e0b" : "#ef4444" }}>
                        1 : {signal.rr_ratio}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* v5.3 / v5.4 雙評分對比 */}
              <DualScoreCard signal={signal} />

              {/* 否決原因 */}
              {signal.veto_reasons.length > 0 && (
                <div style={{ background: "#1a1000", border: "1px solid #f59e0b", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertTriangle size={12} /> 風險警告
                  </div>
                  {signal.veto_reasons.map((reason, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#d97706", marginTop: 3 }}>• {reason}</div>
                  ))}
                </div>
              )}

              {/* v5.4 新增 6 種策略 */}
              <div style={{ fontSize: 12, color: "#22c55e88", marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <Cpu size={12} color="#22c55e88" /> v5.4 新增策略評分（6 種）
              </div>
              {v54StrategyConfigs.map(({ key, title, icon, result, badge }) => (
                <StrategyCard
                  key={key}
                  title={title}
                  icon={icon}
                  result={result as unknown}
                  expanded={expandedStrategy === key}
                  onToggle={() => setExpandedStrategy(expandedStrategy === key ? null : key)}
                  badge={badge}
                />
              ))}

              {/* v5.3 原有 5 種策略（可折疊） */}
              <button onClick={() => setShowV53(!showV53)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 8, cursor: "pointer", color: "#666", fontSize: 12, marginBottom: 8, marginTop: 4 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Radio size={12} color="#60a5fa88" />
                  <span style={{ color: "#60a5fa88" }}>v5.3 原有策略評分（5 種）</span>
                </span>
                {showV53 ? <ChevronUp size={14} color="#444" /> : <ChevronDown size={14} color="#444" />}
              </button>
              {showV53 && (
                <div style={{ marginBottom: 8 }}>
                  {v53StrategyConfigs.map(({ key, title, icon, result }) => (
                    <StrategyCard
                      key={key}
                      title={title}
                      icon={icon}
                      result={result as unknown}
                      expanded={expandedStrategy === key}
                      onToggle={() => setExpandedStrategy(expandedStrategy === key ? null : key)}
                    />
                  ))}
                </div>
              )}

              {/* 策略說明 */}
              <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 8, padding: 12, marginTop: 4 }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <BookOpen size={11} /> 熊貓策略 v5.4 核心規則
                </div>
                <div style={{ fontSize: 10, color: "#444", lineHeight: 1.7 }}>
                  • <span style={{ color: "#22c55e66" }}>Vegas 雙通道</span>：EMA 12/144/169/576/676，回撤到短期通道進場<br />
                  • <span style={{ color: "#22c55e66" }}>ATR 動態止損</span>：突破時 ATR 放大確認，止損 = 結構低點 - 1 ATR<br />
                  • <span style={{ color: "#22c55e66" }}>KD 高勝率</span>：超賣區黃金交叉 + EMA20 方向一致<br />
                  • <span style={{ color: "#22c55e66" }}>成交量確認</span>：放量突破 &gt;1.5 倍均量，量價背離過濾<br />
                  • <span style={{ color: "#22c55e66" }}>三角收斂</span>：高低點收斂比 &lt;0.7 後突破確認<br />
                  • <span style={{ color: "#22c55e66" }}>MACD 背離</span>：底/頂背離 + 盈虧比 ≥ 2 才進場
                </div>
              </div>
            </>
          )}

          {!signal && !scanMutation.isPending && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#333" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🐼</div>
              <div style={{ fontSize: 13 }}>點擊「執行熊貓策略掃描 v5.4」開始分析</div>
              <div style={{ fontSize: 11, color: "#2a2a2a", marginTop: 6 }}>整合 11 種策略，多維度確認信號</div>
            </div>
          )}
        </>
      )}

      {/* 回測視圖 */}
      {activeView === "backtest" && (
        <>
          <button onClick={handleBacktest} disabled={backtestMutation.isPending} style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid #60a5fa", background: backtestMutation.isPending ? "#111" : "#0d1a2b", color: backtestMutation.isPending ? "#555" : "#60a5fa", fontSize: 13, cursor: backtestMutation.isPending ? "not-allowed" : "pointer", fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {backtestMutation.isPending ? <><RefreshCw size={14} className="animate-spin" /> 回測計算中...</> : <><BarChart2 size={14} /> 執行回測分析</>}
          </button>

          {backtestMutation.isError && (
            <div style={{ background: "#1a0000", border: "1px solid #ef4444", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12, color: "#ef4444" }}>
              ⚠️ 回測暫時不可用，請稍後重新整理後再試。
            </div>
          )}

          {backtest && <BacktestView data={backtest} />}

          {!backtest && !backtestMutation.isPending && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#333" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 13 }}>點擊「執行回測分析」計算歷史準確率</div>
              <div style={{ fontSize: 11, color: "#2a2a2a", marginTop: 6 }}>使用 {symbol} 歷史 K 線數據回測熊貓策略</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
