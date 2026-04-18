import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, Cell,
  ReferenceLine, ReferenceArea,
} from "recharts";

interface Props {
  symbol: string;
}

type Strategy = "ema_cross" | "rsi_reversal" | "bollinger" | "macd" | "smc" | "pa" | "chan" | "liquidity_sweep" | "vwap_reversion" | "composite" | "cannonball" | "hwr_model_a" | "hwr_model_b" | "hwr_model_c";

const STRATEGY_LABELS: Record<Strategy, string> = {
  ema_cross:       "EMA 交叉",
  rsi_reversal:    "RSI 反轉",
  bollinger:       "布林帶",
  macd:            "MACD",
  smc:             "SMC 結構",
  pa:              "PA 綜合分析",
  chan:             "纏論策略",
  liquidity_sweep: "★ ICT 流動性掃山",
  vwap_reversion:  "★ VWAP 偏差回歸",
  composite:       "★ 最高勝率綜合",
  cannonball:      "★ CannonBall 結構動能",
  hwr_model_a:     "◆ HWR 模型 A：掃流動性反轉",
  hwr_model_b:     "◆ HWR 模型 B：趨勢回踩延續",
  hwr_model_c:     "◆ HWR 模型 C：中樞邊界反應",
};

const STRATEGY_DESC: Record<Strategy, string> = {
  ema_cross:       "EMA20 與 EMA50 黃金/死亡交叉",
  rsi_reversal:    "RSI 超買超賣反轉（<30 多 / >70 空）",
  bollinger:       "價格觸及布林帶上下軌反轉",
  macd:            "MACD 柱狀圖正負轉換",
  smc:             "SMC 結構突破（BOS）",
  pa:              "RSI + EMA + MACD + ADX 多因子評分",
  chan:             "纏論段方向 + 中樞突破訊號",
  liquidity_sweep: "ICT 核心：掃山止損單後反向展開，EMA200 方向確認",
  vwap_reversion:  "VWAP 偏離 2σ 回歸，ADX<25 震盪市場專用",
  composite:       "SMC 30% + PA 25% + 旗波 20% + 纏論 25%（最高勝率綜合策略）",
  cannonball:      "《模型自帶 SL/TP/TP2》結構突破 + 訂單塊回踩 + Money Flow / RVOL 確認，使用自定義風控與第二止盈目標",
  hwr_model_a:     "《模型自帶 SL/TP》SMC 三部曲：流動性掃過 → CHoCH 結構轉折 → FVG 回踩進場，止損放 sweep candle 外側 0.15 ATR",
  hwr_model_b:     "《模型自帶 SL/TP》EMA50 趨勢 + ADX>20 + Fib OTE 區間（0.618~0.786）回踩進場，止損放 OTE 下方 0.5 ATR",
  hwr_model_c:     "《模型自帶 SL/TP》纏論中樞邊界假突破反手，止損放邊界外側 0.5 ATR，目標為對側邊界",
};

// HWR 模型使用模型自帶 SL/TP，不需要 ATR 乘數設定
const HWR_STRATEGIES: Strategy[] = ["hwr_model_a", "hwr_model_b", "hwr_model_c"];
const NATIVE_RISK_STRATEGIES: Strategy[] = ["cannonball", ...HWR_STRATEGIES];

interface BacktestTrade {
  entry_time: number;
  exit_time: number;
  direction: "long" | "short";
  entry_price: number;
  exit_price: number;
  sl_price: number;
  tp_price: number;
  pnl: number;
  pnl_pct: number;
  pnl_net_pct?: number;      // ★ 扣除手續費後淨損益
  exit_reason: "sl" | "tp" | "trailing" | "end";  // ★ 新增 trailing
  fee_pct?: number;          // ★ 手續費
  mtf_filter?: boolean;      // ★ 是否通過 MTF 過濾
  entry_type?: string;       // ★ 進場類型（FVG/OB/Standard）
}

interface MonthStat {
  month: string;
  trades: number;
  wins: number;
  win_rate: number;
  pnl_pct: number;
}

interface SessionStat {
  session: string;
  trades: number;
  wins: number;
  win_rate: number;
  pnl_pct: number;
}

interface DrawdownPeriod {
  start: number;
  end: number;
  depth: number;
}

interface BacktestResult {
  strategy?: string;
  symbol?: string;
  interval?: string;
  total_trades?: number;
  win_rate?: number;
  profit_factor?: number;
  max_drawdown?: number;
  total_return?: number;
  total_return_net?: number;     // ★ 扣費後淨總回報
  sharpe_ratio?: number;
  sortino_ratio?: number;   // ★ 新增：Sortino Ratio
  calmar_ratio?: number;    // ★ 新增：Calmar Ratio
  equity_curve?: number[];
  trades?: BacktestTrade[];
  monthly_stats?: MonthStat[];
  max_win_streak?: number;
  max_loss_streak?: number;
  session_stats?: SessionStat[];
  drawdown_periods?: DrawdownPeriod[];
  // ★ 勝率提升統計
  mtf_filtered_count?: number;
  total_fees_pct?: number;
  trailing_stop_count?: number;
  adx_filtered_count?: number;
  fvg_ob_entry_count?: number;
  // ★ Monte Carlo 模擬結果
  monte_carlo?: MonteCarloResult | null;
}

interface MonteCarloResult {
  iterations:       number;
  p5_return:        number;
  p50_return:       number;
  p95_return:       number;
  p5_max_drawdown:  number;
  p95_max_drawdown: number;
  ruin_probability: number;
  expected_return:  number;
}

type ViewMode = "single" | "compare" | "walkforward";
type DetailTab = "equity" | "monthly" | "session" | "trades";

// Walk-Forward 型別
interface WFPeriodStats {
  trades:        number;
  win_rate:      number;
  total_return:  number;
  sharpe:        number;
  sortino:       number;
  max_drawdown:  number;
  profit_factor: number;
}
interface WFFoldResult {
  fold_index:         number;
  is_start:           number;
  is_end:             number;
  oos_start:          number;
  oos_end:            number;
  is_stats:           WFPeriodStats;
  oos_stats:          WFPeriodStats;
  win_rate_decay:     number;
  sharpe_decay:       number;
  return_decay:       number;
  drawdown_inflation: number;
}
interface WalkForwardResult {
  folds:             WFFoldResult[];
  is_stats:          WFPeriodStats;
  oos_stats:         WFPeriodStats;
  overfitting_score: number;
  verdict:           "healthy" | "warning" | "overfitting";
  total_candles:     number;
  fold_count:        number;
}

export function BacktestPanel({ symbol }: Props) {
  const [strategy, setStrategy] = useState<Strategy>("ema_cross");
  const [interval, setInterval] = useState("4H");
  const [limit, setLimit] = useState(1080);
  const [slMult, setSlMult] = useState(1.5);
  const [tpMult, setTpMult] = useState(3.0);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [compareResults, setCompareResults] = useState<BacktestResult[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [detailTab, setDetailTab] = useState<DetailTab>("equity");
  const [showTrades, setShowTrades] = useState(false);
  // ★ 勝率提升功能開關
  const [enableMtf,      setEnableMtf]      = useState(true);
  const [enableFee,      setEnableFee]      = useState(true);
  const [enableTrailing, setEnableTrailing] = useState(true);
  const [enableAdx,      setEnableAdx]      = useState(true);
  const [enableFvgOb,    setEnableFvgOb]    = useState(false);
  const [showAdvanced,   setShowAdvanced]   = useState(false);
  // v3.0 真正雙時間框架回測
  const [useTrueMtf,     setUseTrueMtf]     = useState(false);
  // v4.0 四層 MTF 共識
  const [useQuadMtf,     setUseQuadMtf]     = useState(false);
  const [quadThreshold,  setQuadThreshold]  = useState(0.5);

  const [wfResult, setWfResult] = useState<WalkForwardResult | null>(null);
  const [isRatio, setIsRatio] = useState(0.7);

  const wfMutation = trpc.backtest.walkForward.useMutation({
    onSuccess: (data) => {
      setWfResult(data as WalkForwardResult);
      setViewMode("walkforward");
      toast.success(`Walk-Forward 驗證完成！${(data as WalkForwardResult).fold_count} 個 Fold`);
    },
    onError: (err) => {
      toast.error(`Walk-Forward 失敗：${err.message}`);
    },
  });

  const runMutation = trpc.backtest.run.useMutation({
    onSuccess: (data) => {
      setResult(data as BacktestResult);
      setViewMode("single");
      setDetailTab("equity");
      toast.success("回測完成");
    },
    onError: (err) => {
      toast.error(`回測失敗：${err.message}`);
    },
  });

  const compareMutation = trpc.backtest.compare.useMutation({
    onSuccess: (data) => {
      setCompareResults(data as BacktestResult[]);
      setViewMode("compare");
      toast.success("策略比較完成");
    },
    onError: (err) => {
      toast.error(`比較失敗：${err.message}`);
    },
  });

  const handleRun = () => {
    runMutation.mutate({
      symbol, interval, strategy, limit,
      atr_sl_mult: slMult, atr_tp_mult: tpMult,
      enable_mtf_filter:    enableMtf,
      enable_fee:           enableFee,
      enable_trailing_stop: enableTrailing,
      enable_adx_filter:    enableAdx,
      enable_fvg_ob_filter: enableFvgOb,
      use_true_mtf:         useTrueMtf && !useQuadMtf,
      use_quad_mtf:         useQuadMtf,
      quad_mtf_threshold:   quadThreshold,
    });
  };

  const handleCompare = () => {
    compareMutation.mutate({
      symbol, interval, limit,
      atr_sl_mult: slMult, atr_tp_mult: tpMult,
      enable_mtf_filter:    enableMtf,
      enable_fee:           enableFee,
      enable_trailing_stop: enableTrailing,
      enable_adx_filter:    enableAdx,
      use_true_mtf:         useTrueMtf && !useQuadMtf,
      use_quad_mtf:         useQuadMtf,
      quad_mtf_threshold:   quadThreshold,
    });
  };

  const isLoading = runMutation.isPending || compareMutation.isPending || wfMutation.isPending;

  const handleWalkForward = () => {
    wfMutation.mutate({
      symbol, interval, strategy, limit,
      is_ratio:             isRatio,
      atr_sl_mult:          slMult,
      atr_tp_mult:          tpMult,
      enable_mtf_filter:    enableMtf,
      enable_fee:           enableFee,
      enable_trailing_stop: enableTrailing,
      enable_adx_filter:    enableAdx,
      enable_fvg_ob_filter: enableFvgOb,
    });
  };

  // 顏色工具
  const winRateColor = (wr: number) => wr >= 0.55 ? "#22c55e" : wr >= 0.45 ? "#eab308" : "#ef4444";
  const pfColor = (pf: number) => pf >= 1.5 ? "#22c55e" : pf >= 1.0 ? "#eab308" : "#ef4444";
  const retColor = (r: number) => r >= 0 ? "#22c55e" : "#ef4444";

  // 資金曲線數據（帶回撤標記）
  const equityCurveData = result?.equity_curve?.map((v, i) => ({ i, value: v })) ?? [];
  const drawdownPeriods = result?.drawdown_periods ?? [];

  return (
    <div className="space-y-3">
      {/* ── 回測設定 ── */}
      <div className="crypto-panel">
        <div className="crypto-panel-header">回測設定</div>
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* 策略 */}
            <div className="col-span-2 sm:col-span-1 lg:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">策略</label>
              <select
                value={strategy}
                onChange={e => setStrategy(e.target.value as Strategy)}
                className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {(Object.keys(STRATEGY_LABELS) as Strategy[]).map(s => (
                  <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
                ))}
              </select>
              <div className="text-[10px] text-muted-foreground mt-1 truncate">{STRATEGY_DESC[strategy]}</div>
            </div>
            {/* 時間框架 */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">時間框架</label>
              <select
                value={interval}
                onChange={e => setInterval(e.target.value)}
                className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {["5m", "15m", "1H", "4H", "1D"].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            {/* K 線數量 */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">K 線數量</label>
              <select
                value={limit}
                onChange={e => setLimit(Number(e.target.value))}
                className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {[
                  { v: 200,  label: "200 根" },
                  { v: 300,  label: "300 根" },
                  { v: 500,  label: "500 根" },
                  { v: 1080, label: "1080 根（4H 半年）" },
                  { v: 2160, label: "2160 根（1H 90天）" },
                  { v: 4320, label: "4320 根（1H 半年）" },
                ].map(({ v, label }) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            {/* SL/TP 倍數：HWR 模型使用模型自帶 SL/TP，其他策略使用 ATR 倍數 */}
            {HWR_STRATEGIES.includes(strategy) ? (
              <div className="col-span-2 flex items-center gap-2 p-2 bg-primary/10 border border-primary/30 rounded">
                <span className="text-primary text-xs font-bold">◆ SL/TP</span>
                <span className="text-xs text-muted-foreground">模型自帶（SMC 結構計算），不需要 ATR 乘數設定</span>
              </div>
            ) : (
              <>
                {strategy === "cannonball" && (
                  <div className="col-span-2 sm:col-span-3 lg:col-span-6 p-2 rounded border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-200 leading-relaxed">
                    CannonBall 在回測與 Walk-Forward 中目前使用策略內建的結構型進出場與風控位；下方 ATR 倍數主要影響一般策略，不作為 CannonBall 的主 SL/TP 來源。
                  </div>
                )}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">SL 倍數 (ATR)</label>
                  <select
                    value={slMult}
                    onChange={e => setSlMult(Number(e.target.value))}
                    className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {[0.5, 1.0, 1.5, 2.0, 2.5, 3.0].map(v => (
                      <option key={v} value={v}>{v}x</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">TP 倍數 (ATR)</label>
                  <select
                    value={tpMult}
                    onChange={e => setTpMult(Number(e.target.value))}
                    className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {[1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0].map(v => (
                      <option key={v} value={v}>{v}x</option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
          {!NATIVE_RISK_STRATEGIES.includes(strategy) && (
            <div className="text-xs text-muted-foreground">
              風險回報比：<span className="text-foreground font-mono">1 : {(tpMult / slMult).toFixed(2)}</span>
              <span className="ml-3">SL = {slMult}x ATR｜TP = {tpMult}x ATR</span>
            </div>
          )}
          {strategy === "cannonball" && (
            <div className="text-xs text-amber-300/90">
              CannonBall 的主要風控來自策略內建結構位與第二止盈邏輯；若需調整 CannonBall 專屬參數，請改用其獨立分析面板。
            </div>
          )}

          {/* ★ 勝率提升功能開關 */}
          <div>
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
            >
              <span>{showAdvanced ? "▼" : "▶"}</span>
              <span>勝率提升功能設定</span>
              <span className="text-muted-foreground ml-1">
                ({[enableMtf, enableFee, enableTrailing, enableAdx, enableFvgOb].filter(Boolean).length}/5 已啟用)
              </span>
            </button>
            {showAdvanced && (
              <div className="mt-2 p-3 bg-secondary/20 rounded border border-border/50 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {([
                  { key: "mtf",       label: "MTF 趨勢過濾",       desc: "大級別趨勢確認，過濾逆勢單",        val: enableMtf,      set: setEnableMtf },
                  { key: "fee",       label: "手續費計算",         desc: "Taker 0.04% + 滑點 0.02%",     val: enableFee,      set: setEnableFee },
                  { key: "trailing",  label: "移動止損",           desc: "獲利 1R 後移至成本價",          val: enableTrailing, set: setEnableTrailing },
                  { key: "adx",       label: "ADX 震盪過濾",       desc: "ADX<20 時禁止趨勢策略進場",     val: enableAdx,      set: setEnableAdx },
                  { key: "fvgob",     label: "FVG/OB 進場",         desc: "SMC 精準進場區間過濾",         val: enableFvgOb,    set: setEnableFvgOb },
                  { key: "truemtf",   label: "雙時間框架回測",   desc: "進場級別找入場 + 高級別定方向（模型 A/B/C 自動選擇 15m/1H/4H）", val: useTrueMtf && !useQuadMtf, set: (v) => { setUseTrueMtf(v); if (v) setUseQuadMtf(false); } },
                  { key: "quadmtf",   label: "四層 MTF 共識（4H+1H+15m+5m）",   desc: "四個時間框架加權共識評分，進場級別固定 15m，共識分數超過閾値才觸發信號", val: useQuadMtf, set: (v) => { setUseQuadMtf(v); if (v) setUseTrueMtf(false); } },
                ] as { key: string; label: string; desc: string; val: boolean; set: (v: boolean) => void }[]).map(item => (
                  <label key={item.key} className="flex items-start gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={item.val}
                      onChange={e => item.set(e.target.checked)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <div className="text-xs font-medium group-hover:text-primary transition-colors">{item.label}</div>
                      <div className="text-[10px] text-muted-foreground">{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {/* v4.0 四層 MTF 共識閾値設定 */}
            {useQuadMtf && (
              <div className="mt-2 p-3 bg-blue-500/10 rounded border border-blue-500/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-blue-400">四層 MTF 共識閾値：{Math.round(quadThreshold * 100)}%</span>
                  <span className="text-[10px] text-muted-foreground">超過此比例的層數看多/看空才觸發進場</span>
                </div>
                <input
                  type="range" min="0.25" max="1.0" step="0.25"
                  value={quadThreshold}
                  onChange={e => setQuadThreshold(Number(e.target.value))}
                  className="w-full accent-blue-400"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>25%（1層即可）</span>
                  <span>50%（2層以上）</span>
                  <span>75%（3層以上）</span>
                  <span>100%（4層全共識）</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={handleRun} disabled={isLoading} className="text-xs bg-primary hover:bg-primary/90">
              {runMutation.isPending ? "回測中..." : `執行回測（${STRATEGY_LABELS[strategy]}）`}
            </Button>
            <Button size="sm" variant="outline" onClick={handleCompare} disabled={isLoading} className="text-xs">
              {compareMutation.isPending ? "比較中..." : "比較所有策略"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleWalkForward}
              disabled={isLoading}
              className="text-xs border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
              title="Walk-Forward 驗證：滾動窗口 IS/OOS 分割，防止過度擬合（Opus 4.6 建議）"
            >
              {wfMutation.isPending ? "WF 驗證中..." : "Walk-Forward 驗證"}
            </Button>
          </div>
        </div>
      </div>

      {/* ── 策略比較 ── */}
      {viewMode === "compare" && compareResults.length > 0 && (
        <div className="space-y-3">
          <div className="crypto-panel">
            <div className="crypto-panel-header">策略比較 — {symbol} {interval}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">策略</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">交易次數</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">勝率</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">盈虧比</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">總回報</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">最大回撤</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">夏普比率</th>
                    {compareResults.some(r => (r as BacktestResult & { quad_mtf_enabled?: boolean }).quad_mtf_enabled) && (
                      <th className="text-right px-3 py-2 text-blue-400 font-medium">共識過濾</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {compareResults
                    .slice()
                    .sort((a, b) => (b.total_return ?? 0) - (a.total_return ?? 0))
                    .map((r, i) => {
                      const rExt = r as BacktestResult & { quad_mtf_enabled?: boolean; quad_consensus_stats?: { avg_score: number; full_consensus: number; quad_filtered: number } };
                      return (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-3 py-2 font-medium">{STRATEGY_LABELS[r.strategy as Strategy] ?? r.strategy}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.total_trades ?? 0}</td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: winRateColor(r.win_rate ?? 0) }}>
                        {((r.win_rate ?? 0) * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: pfColor(r.profit_factor ?? 0) }}>
                        {(r.profit_factor ?? 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: retColor(r.total_return ?? 0) }}>
                        {(r.total_return ?? 0) >= 0 ? "+" : ""}{((r.total_return ?? 0) * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-bear">
                        -{((r.max_drawdown ?? 0) * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: (r.sharpe_ratio ?? 0) >= 1 ? "#22c55e" : "#888" }}>
                        {(r.sharpe_ratio ?? 0).toFixed(2)}
                      </td>
                      {rExt.quad_mtf_enabled && (
                        <td className="px-3 py-2 text-right font-mono text-blue-400" title={`全共識 ${rExt.quad_consensus_stats?.full_consensus ?? 0} 次 | 平均分數 ${((rExt.quad_consensus_stats?.avg_score ?? 0) * 100).toFixed(0)}%`}>
                          -{rExt.quad_consensus_stats?.quad_filtered ?? 0}
                        </td>
                      )}
                    </tr>
                      );
                    })}
                  {/* 展示所有策略都沒有 quad_mtf 時的空列 */}
                  {!compareResults.some(r => (r as BacktestResult & { quad_mtf_enabled?: boolean }).quad_mtf_enabled) && null}
                </tbody>
              </table>
            </div>
          </div>
          <div className="crypto-panel">
            <div className="crypto-panel-header">策略勝率比較圖（橫向長條圖）</div>
            <div className="p-2">
              <ResponsiveContainer width="100%" height={Math.max(180, compareResults.length * 36 + 40)}>
                <BarChart
                  layout="vertical"
                  data={compareResults
                    .slice()
                    .sort((a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0))
                    .map(r => ({
                      name: STRATEGY_LABELS[r.strategy as Strategy] ?? r.strategy,
                      勝率: parseFloat(((r.win_rate ?? 0) * 100).toFixed(1)),
                      盈虧比: parseFloat((r.profit_factor ?? 0).toFixed(2)),
                      夏普比率: parseFloat((r.sharpe_ratio ?? 0).toFixed(2)),
                    }))}
                  margin={{ top: 5, right: 40, left: 60, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "oklch(0.55 0.01 240)" }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "oklch(0.75 0.01 240)" }} tickLine={false} axisLine={false} width={55} />
                  <Tooltip
                    contentStyle={{ background: "oklch(0.14 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "6px", fontSize: "11px" }}
                    formatter={(value: number, name: string) => [
                      name === "勝率" ? `${value}%` : String(value),
                      name
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "4px" }} />
                  <Bar dataKey="勝率" radius={[0,3,3,0]} barSize={12}>
                    {compareResults
                      .slice()
                      .sort((a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0))
                      .map((r, i) => (
                        <Cell key={i} fill={
                          (r.win_rate ?? 0) >= 0.6 ? "#22c55e" :
                          (r.win_rate ?? 0) >= 0.5 ? "#3b82f6" :
                          (r.win_rate ?? 0) >= 0.4 ? "#eab308" : "#ef4444"
                        } />
                      ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="crypto-panel">
            <div className="crypto-panel-header">盈虧比 vs 夏普比率比較</div>
            <div className="p-2">
              <ResponsiveContainer width="100%" height={Math.max(180, compareResults.length * 36 + 40)}>
                <BarChart
                  layout="vertical"
                  data={compareResults
                    .slice()
                    .sort((a, b) => (b.profit_factor ?? 0) - (a.profit_factor ?? 0))
                    .map(r => ({
                      name: STRATEGY_LABELS[r.strategy as Strategy] ?? r.strategy,
                      盈虧比: parseFloat((r.profit_factor ?? 0).toFixed(2)),
                      夏普比率: parseFloat((r.sharpe_ratio ?? 0).toFixed(2)),
                    }))}
                  margin={{ top: 5, right: 40, left: 60, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "oklch(0.55 0.01 240)" }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "oklch(0.75 0.01 240)" }} tickLine={false} axisLine={false} width={55} />
                  <Tooltip contentStyle={{ background: "oklch(0.14 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "6px", fontSize: "11px" }} />
                  <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "4px" }} />
                  <Bar dataKey="盈虧比" fill="#8b5cf6" radius={[0,3,3,0]} barSize={12} />
                  <Bar dataKey="夏普比率" fill="#f59e0b" radius={[0,3,3,0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ── 單策略回測結果 ── */}
      {viewMode === "single" && result && (
        <>
          {/* 統計摘要 */}
          <div className="crypto-panel">
            <div className="crypto-panel-header">
              回測結果 — {STRATEGY_LABELS[result.strategy as Strategy] ?? result.strategy}
              <span className="ml-2 text-muted-foreground text-xs font-normal">
                {result.symbol} {result.interval} · {result.total_trades} 筆交易
              </span>
            </div>
            <div className="p-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {[
                { label: "總交易次數", value: String(result.total_trades ?? 0), color: undefined, tip: "回測期間內總交易次數" },
                { label: "勝率", value: `${((result.win_rate ?? 0) * 100).toFixed(1)}%`, color: winRateColor(result.win_rate ?? 0), tip: "指標計算基於淨損益" },
                { label: "盈虧比", value: (result.profit_factor ?? 0).toFixed(2), color: pfColor(result.profit_factor ?? 0), tip: "總獲利 / 總虧損，>1.5 為良好" },
                { label: "總回報", value: `${(result.total_return ?? 0) >= 0 ? "+" : ""}${((result.total_return ?? 0) * 100).toFixed(1)}%`, color: retColor(result.total_return ?? 0), tip: "未扣除手續費" },
                { label: "最大回撤", value: `-${((result.max_drawdown ?? 0) * 100).toFixed(1)}%`, color: "#ef4444", tip: "歷史最大峰谷回撤" },
                { label: "夏普比率", value: (result.sharpe_ratio ?? 0).toFixed(2), color: (result.sharpe_ratio ?? 0) >= 1 ? "#22c55e" : "#888", tip: "已依 K 線週期修正年化因子" },
                { label: "Sortino", value: (result.sortino_ratio ?? 0).toFixed(2), color: (result.sortino_ratio ?? 0) >= 1 ? "#22c55e" : "#888", tip: "只懲罰下行風險，>1 為良好" },
                { label: "Calmar", value: (result.calmar_ratio ?? 0).toFixed(2), color: (result.calmar_ratio ?? 0) >= 0.5 ? "#22c55e" : "#888", tip: "年化回報/最大回撤，>0.5 為良好" },
              ].map(({ label, value, color, tip }) => (
                <div key={label} className="text-center bg-secondary/30 rounded p-2" title={tip}>
                  <div className="text-xs text-muted-foreground mb-1">{label}</div>
                  <div className="text-base font-mono font-bold" style={color ? { color } : undefined}>{value}</div>
                </div>
              ))}
            </div>

            {/* ★ 勝率提升統計摘要 */}
            {(result.mtf_filtered_count !== undefined || result.total_fees_pct !== undefined) && (
              <div className="px-3 pb-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5">MTF 過濾訊號</div>
                  <div className="text-sm font-mono font-bold text-blue-400">{result.mtf_filtered_count ?? 0} 個</div>
                  <div className="text-[10px] text-muted-foreground">進場前已過濾</div>
                </div>
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5">ADX 震盪過濾</div>
                  <div className="text-sm font-mono font-bold text-yellow-400">{result.adx_filtered_count ?? 0} 個</div>
                  <div className="text-[10px] text-muted-foreground">低趨勢已過濾</div>
                </div>
                <div className="bg-purple-500/10 border border-purple-500/20 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5">移動止損觸發</div>
                  <div className="text-sm font-mono font-bold text-purple-400">{result.trailing_stop_count ?? 0} 次</div>
                  <div className="text-[10px] text-muted-foreground">保護利潤</div>
                </div>
                <div className="bg-orange-500/10 border border-orange-500/20 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5">FVG/OB 進場</div>
                  <div className="text-sm font-mono font-bold text-orange-400">{result.fvg_ob_entry_count ?? 0} 次</div>
                  <div className="text-[10px] text-muted-foreground">精準區間進場</div>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5">總手續費</div>
                  <div className="text-sm font-mono font-bold text-red-400">
                    -{((result.total_fees_pct ?? 0) * 100).toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    淨回報: {(result.total_return_net ?? 0) >= 0 ? "+" : ""}{((result.total_return_net ?? 0) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            )}

            {/* 連勝連敗 + SL/TP 統計 */}
            <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
              {result.trades && (() => {
                const slCount = result.trades!.filter(t => t.exit_reason === "sl").length;
                const tpCount = result.trades!.filter(t => t.exit_reason === "tp").length;
                const trailingCount = result.trades!.filter(t => t.exit_reason === "trailing").length;
                const endCount = result.trades!.filter(t => t.exit_reason === "end").length;
                const total = result.trades!.length;
                return (
                  <>
                    <div className="bg-bear/10 border border-bear/20 rounded p-2 text-center">
                      <div className="text-xs text-muted-foreground mb-0.5">止損出場</div>
                      <div className="text-sm font-mono font-bold text-bear">{slCount} 筆</div>
                      <div className="text-[10px] text-muted-foreground">{((slCount/total)*100).toFixed(0)}%</div>
                    </div>
                    <div className="bg-bull/10 border border-bull/20 rounded p-2 text-center">
                      <div className="text-xs text-muted-foreground mb-0.5">止盈出場</div>
                      <div className="text-sm font-mono font-bold text-bull">{tpCount} 筆</div>
                      <div className="text-[10px] text-muted-foreground">{((tpCount/total)*100).toFixed(0)}%</div>
                    </div>
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded p-2 text-center">
                      <div className="text-xs text-muted-foreground mb-0.5">移動止損</div>
                      <div className="text-sm font-mono font-bold text-purple-400">{trailingCount} 筆</div>
                      <div className="text-[10px] text-muted-foreground">{total > 0 ? ((trailingCount/total)*100).toFixed(0) : 0}%</div>
                    </div>
                    <div className="bg-secondary/30 border border-border rounded p-2 text-center">
                      <div className="text-xs text-muted-foreground mb-0.5">超時平倉</div>
                      <div className="text-sm font-mono font-bold text-muted-foreground">{endCount} 筆</div>
                      <div className="text-[10px] text-muted-foreground">{total > 0 ? ((endCount/total)*100).toFixed(0) : 0}%</div>
                    </div>
                    <div className="bg-bull/5 border border-bull/20 rounded p-2 text-center">
                      <div className="text-xs text-muted-foreground mb-0.5">最長連勝</div>
                      <div className="text-sm font-mono font-bold text-bull">{result.max_win_streak ?? 0} 筆</div>
                    </div>
                    <div className="bg-bear/5 border border-bear/20 rounded p-2 text-center">
                      <div className="text-xs text-muted-foreground mb-0.5">最長連敗</div>
                      <div className="text-sm font-mono font-bold text-bear">{result.max_loss_streak ?? 0} 筆</div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

            {/* Monte Carlo 模擬結果 */}
            {result.monte_carlo && (
              <div className="px-3 pb-3">
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-semibold text-indigo-400">Monte Carlo 模擬</span>
                    <span className="text-xs text-muted-foreground">({result.monte_carlo.iterations.toLocaleString()} 次隨機模擬)</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-secondary/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground mb-0.5">P5 收益 (最差情境)</div>
                      <div className="text-sm font-mono font-bold" style={{ color: result.monte_carlo.p5_return >= 0 ? '#22c55e' : '#ef4444' }}>
                        {result.monte_carlo.p5_return >= 0 ? '+' : ''}{(result.monte_carlo.p5_return * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-secondary/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground mb-0.5">P50 收益 (中位數)</div>
                      <div className="text-sm font-mono font-bold" style={{ color: result.monte_carlo.p50_return >= 0 ? '#22c55e' : '#ef4444' }}>
                        {result.monte_carlo.p50_return >= 0 ? '+' : ''}{(result.monte_carlo.p50_return * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-secondary/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground mb-0.5">P95 收益 (最佳情境)</div>
                      <div className="text-sm font-mono font-bold text-green-400">
                        +{(result.monte_carlo.p95_return * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-secondary/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground mb-0.5">爆倉機率</div>
                      <div className="text-sm font-mono font-bold" style={{ color: result.monte_carlo.ruin_probability < 0.05 ? '#22c55e' : result.monte_carlo.ruin_probability < 0.2 ? '#eab308' : '#ef4444' }}>
                        {(result.monte_carlo.ruin_probability * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-muted-foreground">回撤&gt;50%</div>
                    </div>
                    <div className="bg-secondary/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground mb-0.5">P5 最大回撤</div>
                      <div className="text-sm font-mono font-bold text-green-400">
                        -{(result.monte_carlo.p5_max_drawdown * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-secondary/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground mb-0.5">P95 最大回撤</div>
                      <div className="text-sm font-mono font-bold text-red-400">
                        -{(result.monte_carlo.p95_max_drawdown * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-secondary/30 rounded p-2 text-center col-span-2">
                      <div className="text-[10px] text-muted-foreground mb-0.5">期望收益 (平均)</div>
                      <div className="text-sm font-mono font-bold" style={{ color: result.monte_carlo.expected_return >= 0 ? '#22c55e' : '#ef4444' }}>
                        {result.monte_carlo.expected_return >= 0 ? '+' : ''}{(result.monte_carlo.expected_return * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 詳細分析 Tab */}
            <div className="crypto-panel">
            <div className="crypto-panel-header">
              <div className="flex gap-1 flex-wrap">
                {([
                  { id: "equity", label: "資金曲線" },
                  { id: "monthly", label: "每月盈虧" },
                  { id: "session", label: "時段分析" },
                  { id: "trades", label: `交易記錄 (${result.trades?.length ?? 0})` },
                ] as { id: DetailTab; label: string }[]).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setDetailTab(tab.id)}
                    className={`text-xs px-3 py-1 rounded transition-colors ${
                      detailTab === tab.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 資金曲線（含回撤區域） */}
            {detailTab === "equity" && equityCurveData.length > 1 && (
              <div className="p-2">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={equityCurveData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" strokeOpacity={0.5} />
                    <XAxis dataKey="i" hide />
                    <YAxis
                      tick={{ fontSize: 10, fill: "oklch(0.55 0.01 240)" }}
                      tickLine={false} axisLine={false} width={55}
                      tickFormatter={v => `${((v - 1) * 100).toFixed(0)}%`}
                    />
                    <Tooltip
                      contentStyle={{ background: "oklch(0.14 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "4px", fontSize: "11px" }}
                      formatter={(v: number) => [`${((v - 1) * 100).toFixed(2)}%`, "累計回報"]}
                    />
                    <ReferenceLine y={1} stroke="oklch(0.35 0.01 240)" strokeDasharray="4 4" />
                    {/* 回撤區域標記（紅色陰影） */}
                    {drawdownPeriods.filter(d => d.depth > 0.02).slice(0, 8).map((d, i) => (
                      <ReferenceArea
                        key={i}
                        x1={d.start}
                        x2={d.end}
                        fill="#ef4444"
                        fillOpacity={Math.min(d.depth * 1.5, 0.25)}
                        stroke="none"
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="oklch(0.65 0.18 250)"
                      strokeWidth={1.5}
                      dot={false}
                      name="資金"
                    />
                  </LineChart>
                </ResponsiveContainer>
                {drawdownPeriods.length > 0 && (
                  <div className="text-[10px] text-muted-foreground text-center mt-1">
                    紅色陰影 = 回撤區間（共 {drawdownPeriods.filter(d => d.depth > 0.02).length} 個）
                  </div>
                )}
              </div>
            )}

            {/* 每月盈虧 */}
            {detailTab === "monthly" && (
              <div className="p-3 space-y-3">
                {result.monthly_stats && result.monthly_stats.length > 0 ? (
                  <>
                    {/* 月份 bar chart */}
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart
                        data={result.monthly_stats.map(m => ({
                          month: m.month.slice(5), // 只顯示 MM
                          盈虧: Math.round(m.pnl_pct * 10000) / 100,
                          勝率: Math.round(m.win_rate * 1000) / 10,
                        }))}
                        margin={{ top: 5, right: 5, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" strokeOpacity={0.5} />
                        <XAxis dataKey="month" tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} />
                        <YAxis tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                        <Tooltip
                          contentStyle={{ background: "oklch(0.14 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "4px", fontSize: "11px" }}
                          formatter={(v: number, name: string) => [`${v}%`, name]}
                        />
                        <ReferenceLine y={0} stroke="oklch(0.35 0.01 240)" />
                        <Bar dataKey="盈虧" radius={[2,2,0,0]}>
                          {result.monthly_stats.map((m, i) => (
                            <Cell key={i} fill={m.pnl_pct >= 0 ? "#22c55e" : "#ef4444"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    {/* 月份表格 */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left px-2 py-1.5 text-muted-foreground">月份</th>
                            <th className="text-right px-2 py-1.5 text-muted-foreground">交易</th>
                            <th className="text-right px-2 py-1.5 text-muted-foreground">勝率</th>
                            <th className="text-right px-2 py-1.5 text-muted-foreground">盈虧</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.monthly_stats.map((m, i) => (
                            <tr key={i} className="border-b border-border/40 hover:bg-secondary/20">
                              <td className="px-2 py-1.5 font-mono">{m.month}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{m.trades}</td>
                              <td className="px-2 py-1.5 text-right font-mono" style={{ color: winRateColor(m.win_rate) }}>
                                {(m.win_rate * 100).toFixed(0)}%
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: m.pnl_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                                {m.pnl_pct >= 0 ? "+" : ""}{(m.pnl_pct * 100).toFixed(2)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="text-center text-xs text-muted-foreground py-4">無月份數據</div>
                )}
              </div>
            )}

            {/* 時段分析 */}
            {detailTab === "session" && (
              <div className="p-3 space-y-3">
                {result.session_stats && result.session_stats.length > 0 ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      {result.session_stats.map((s, i) => (
                        <div key={i} className="bg-secondary/20 rounded p-3 text-center">
                          <div className="text-xs text-muted-foreground mb-1">{s.session}</div>
                          <div className="text-base font-mono font-bold" style={{ color: winRateColor(s.win_rate) }}>
                            {(s.win_rate * 100).toFixed(0)}%
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{s.trades} 筆交易</div>
                          <div className="text-[10px] font-mono mt-0.5" style={{ color: s.pnl_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                            {s.pnl_pct >= 0 ? "+" : ""}{(s.pnl_pct * 100).toFixed(2)}%
                          </div>
                        </div>
                      ))}
                    </div>
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart
                        data={result.session_stats.map(s => ({
                          name: s.session,
                          勝率: Math.round(s.win_rate * 1000) / 10,
                          盈虧: Math.round(s.pnl_pct * 10000) / 100,
                        }))}
                        margin={{ top: 5, right: 5, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" strokeOpacity={0.5} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "oklch(0.55 0.01 240)" }} />
                        <YAxis tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                        <Tooltip contentStyle={{ background: "oklch(0.14 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "4px", fontSize: "11px" }} />
                        <Legend wrapperStyle={{ fontSize: "10px" }} />
                        <Bar dataKey="勝率" fill="#3b82f6" radius={[2,2,0,0]} />
                        <Bar dataKey="盈虧" radius={[2,2,0,0]}>
                          {result.session_stats.map((s, i) => (
                            <Cell key={i} fill={s.pnl_pct >= 0 ? "#22c55e" : "#ef4444"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="text-[10px] text-muted-foreground bg-secondary/10 rounded p-2">
                      時段定義（UTC）：亞洲盤 00:00–08:00 · 歐洲盤 07:00–15:00 · 美洲盤 13:00–21:00
                    </div>
                  </>
                ) : (
                  <div className="text-center text-xs text-muted-foreground py-4">無時段數據</div>
                )}
              </div>
            )}

            {/* 交易記錄 */}
            {detailTab === "trades" && result.trades && result.trades.length > 0 && (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 text-muted-foreground font-medium">方向</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">入場價</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">SL</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">TP</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">出場價</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">出場原因</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">盈虧 %</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">入場時間</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">出場時間</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice().reverse().slice(0, 100).map((t, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-secondary/20">
                          <td className="px-3 py-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${t.direction === "long" ? "bg-bull/10 text-bull" : "bg-bear/10 text-bear"}`}>
                              {t.direction === "long" ? "多" : "空"}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-foreground">{t.entry_price?.toFixed(2) ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-bear">{t.sl_price?.toFixed(2) ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-bull">{t.tp_price?.toFixed(2) ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-foreground">{t.exit_price?.toFixed(2) ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              t.exit_reason === "tp" ? "bg-bull/10 text-bull" :
                              t.exit_reason === "sl" ? "bg-bear/10 text-bear" :
                              "bg-secondary/50 text-muted-foreground"
                            }`}>
                              {t.exit_reason === "tp" ? "止盈 ✔" : t.exit_reason === "sl" ? "止損 ✘" : "超時"}
                            </span>
                          </td>
                          <td className={`px-3 py-1.5 text-right font-mono font-bold ${(t.pnl_pct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                            {(t.pnl_pct ?? 0) >= 0 ? "+" : ""}{((t.pnl_pct ?? 0) * 100).toFixed(2)}%
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground text-[10px]">
                            <div>{t.entry_time ? new Date(t.entry_time * 1000).toLocaleDateString("zh-TW") : "—"}</div>
                            <div className="text-[9px] opacity-60">{t.entry_time ? new Date(t.entry_time * 1000).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground text-[10px]">
                            <div>{t.exit_time ? new Date(t.exit_time * 1000).toLocaleDateString("zh-TW") : "—"}</div>
                            <div className="text-[9px] opacity-60">{t.exit_time ? new Date(t.exit_time * 1000).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.trades.length > 100 && (
                    <div className="text-center text-xs text-muted-foreground py-2">
                      顯示最近 100 筆，共 {result.trades.length} 筆
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Walk-Forward 驗證結果 */}
      {viewMode === "walkforward" && wfResult && (() => {
        const verdictConfig = {
          healthy:     { label: "健康", color: "#22c55e", bg: "rgba(34,197,94,0.1)",  border: "rgba(34,197,94,0.3)" },
          warning:     { label: "警告", color: "#eab308", bg: "rgba(234,179,8,0.1)",  border: "rgba(234,179,8,0.3)" },
          overfitting: { label: "過度擬合", color: "#ef4444", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)" },
        };
        const v = verdictConfig[wfResult.verdict];
        const decayColor = (r: number) => r >= 0.9 ? "#22c55e" : r >= 0.7 ? "#eab308" : "#ef4444";
        return (
          <div className="space-y-3">
            {/* 總覽 */}
            <div className="crypto-panel">
              <div className="crypto-panel-header">Walk-Forward 驗證結果 — {symbol} {interval} {STRATEGY_LABELS[strategy]}</div>
              <div className="p-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div className="text-center rounded p-3" style={{ background: v.bg, border: `1px solid ${v.border}` }}>
                    <div className="text-xs text-muted-foreground mb-1">過擬合評分</div>
                    <div className="text-3xl font-mono font-bold" style={{ color: v.color }}>{wfResult.overfitting_score}</div>
                    <div className="text-sm mt-1" style={{ color: v.color }}>{v.label}</div>
                  </div>
                  <div className="text-center bg-secondary/30 rounded p-3">
                    <div className="text-xs text-muted-foreground mb-1">驗證 Folds</div>
                    <div className="text-3xl font-mono font-bold">{wfResult.fold_count}</div>
                    <div className="text-xs text-muted-foreground mt-1">滾動窗口</div>
                  </div>
                  <div className="text-center bg-secondary/30 rounded p-3">
                    <div className="text-xs text-muted-foreground mb-1">OOS 總交易</div>
                    <div className="text-3xl font-mono font-bold">{wfResult.oos_stats.trades}</div>
                    <div className="text-xs text-muted-foreground mt-1">真實樣本外表現</div>
                  </div>
                  <div className="text-center bg-secondary/30 rounded p-3">
                    <div className="text-xs text-muted-foreground mb-1">總 K 線數</div>
                    <div className="text-3xl font-mono font-bold">{wfResult.total_candles}</div>
                    <div className="text-xs text-muted-foreground mt-1">回測範圍</div>
                  </div>
                </div>

                {/* IS vs OOS 對比 */}
                <div className="bg-secondary/20 rounded p-3 mb-3">
                  <div className="text-xs font-medium mb-3">IS vs OOS 指標對比（越高越好）</div>
                  {[
                    { label: "勝率", is: wfResult.is_stats.win_rate, oos: wfResult.oos_stats.win_rate, fmt: (v: number) => `${(v*100).toFixed(1)}%` },
                    { label: "Sharpe", is: wfResult.is_stats.sharpe, oos: wfResult.oos_stats.sharpe, fmt: (v: number) => v.toFixed(2) },
                    { label: "總回報", is: wfResult.is_stats.total_return, oos: wfResult.oos_stats.total_return, fmt: (v: number) => `${(v*100).toFixed(1)}%` },
                    { label: "盈號比", is: wfResult.is_stats.profit_factor, oos: wfResult.oos_stats.profit_factor, fmt: (v: number) => v.toFixed(2) },
                  ].map(({ label, is, oos, fmt }) => {
                    const ratio = is !== 0 ? oos / is : 1;
                    const barW = Math.min(100, Math.max(0, ratio * 100));
                    return (
                      <div key={label} className="mb-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">{label}</span>
                          <span>IS: <span className="font-mono">{fmt(is)}</span> → OOS: <span className="font-mono" style={{ color: decayColor(ratio) }}>{fmt(oos)}</span> <span className="text-muted-foreground">({(ratio*100).toFixed(0)}%)</span></span>
                        </div>
                        <div className="bg-secondary/50 rounded h-1.5 overflow-hidden">
                          <div className="h-full rounded transition-all" style={{ width: `${barW}%`, background: decayColor(ratio) }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 詠告文字 */}
                <div className="text-xs rounded p-2" style={{ background: v.bg, border: `1px solid ${v.border}`, color: v.color }}>
                  {wfResult.verdict === "healthy" && "✅ 策略健康：OOS 表現與 IS 接近，過度擬合風險低，可信度較高"}
                  {wfResult.verdict === "warning" && "⚠️ 試策略警告：OOS 表現有明顯衰減，建議降低仓位大小或增加實盤驗證期"}
                  {wfResult.verdict === "overfitting" && "🚨 過度擬合：OOS 表現大幅衰減，策略可能對歷史數擬合，不建議實盤使用"}
                </div>
              </div>
            </div>

            {/* 各 Fold 明細 */}
            <div className="crypto-panel">
              <div className="crypto-panel-header">各 Fold 明細（滾動窗口 IS/OOS 分割）</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 text-muted-foreground">Fold</th>
                      <th className="text-right px-3 py-2 text-muted-foreground">IS K線</th>
                      <th className="text-right px-3 py-2 text-muted-foreground">OOS K線</th>
                      <th className="text-right px-3 py-2 text-muted-foreground">IS 勝率</th>
                      <th className="text-right px-3 py-2 text-muted-foreground">OOS 勝率</th>
                      <th className="text-right px-3 py-2 text-muted-foreground">IS Sharpe</th>
                      <th className="text-right px-3 py-2 text-muted-foreground">OOS Sharpe</th>
                      <th className="text-right px-3 py-2 text-muted-foreground">Sharpe 衰減</th>
                      <th className="text-right px-3 py-2 text-muted-foreground">回撤放大</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wfResult.folds.map(f => (
                      <tr key={f.fold_index} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="px-3 py-2 font-medium">#{f.fold_index + 1}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{f.is_end - f.is_start + 1}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{f.oos_end - f.oos_start + 1}</td>
                        <td className="px-3 py-2 text-right font-mono">{(f.is_stats.win_rate * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: decayColor(f.win_rate_decay) }}>{(f.oos_stats.win_rate * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right font-mono">{f.is_stats.sharpe.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: decayColor(f.sharpe_decay) }}>{f.oos_stats.sharpe.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: decayColor(f.sharpe_decay) }}>{(f.sharpe_decay * 100).toFixed(0)}%</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: f.drawdown_inflation <= 1.3 ? "#22c55e" : f.drawdown_inflation <= 1.8 ? "#eab308" : "#ef4444" }}>
                          {f.drawdown_inflation.toFixed(2)}x
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-2 text-[10px] text-muted-foreground">
                勝率衰減 &ge;90% 健康 · Sharpe 衰減 &ge;70% 健康 · 回撤放大 &le;1.3x 健康
              </div>
            </div>
          </div>
        );
      })()}

      {!result && compareResults.length === 0 && !wfResult && !isLoading && (
        <div className="crypto-panel p-6 text-center">
          <div className="text-muted-foreground text-sm mb-2">選擇策略和時間框架後，點擊「執行回測」開始分析</div>
          <div className="text-xs text-muted-foreground">
            回測邏輯：在歷史 K 線上觸發訊號後，掃描未來 K 線判斷是否先碰到 SL 或 TP
          </div>
        </div>
      )}
    </div>
  );
}
