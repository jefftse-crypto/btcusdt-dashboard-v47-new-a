import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useIsMobile } from "@/hooks/useMobile";
import type { Timeframe, CryptoSnapshot } from "@shared/cryptoTypes";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickSeriesOptions,
  type LineSeriesOptions,
  type HistogramSeriesOptions,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";

interface Props {
  symbol: string;
  timeframe: Timeframe;
  livePrice?: number | null;
  activeEmas?: number[];
  height?: number;
  snapshot?: CryptoSnapshot | null;
  showVolume?: boolean;
  showMacd?: boolean;
  showSR?: boolean;
  showOB?: boolean;
  showMarkers?: boolean;
}

const EMA_COLORS: Record<number, string> = {
  9:   "#f59e0b",
  20:  "#3b82f6",
  50:  "#a855f7",
  100: "#22c55e",
  200: "#ef4444",
};

// ── 進出場標記顏色定義 ──
const MARKER_COLORS = {
  entry_long:  "#4caf50",   // 多頭進場：綠色
  entry_short: "#ef5350",   // 空頭進場：紅色
  sl:          "#ef5350",   // 止損：紅色
  tp1:         "#26a69a",   // TP1：青色
  tp2:         "#00bcd4",   // TP2：淺藍
  pa_entry:    "#ffd740",   // PA 進場：金色
  smc_entry:   "#ab47bc",   // SMC 進場：紫色
  chan_buy:    "#00e676",   // 纏論買點：亮綠
  chan_sell:   "#ff5252",   // 纏論賣點：亮紅
};

function calcEma(data: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(data.length).fill(null);
  let ema: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (ema === null) {
      if (i + 1 >= period) {
        const sum = data.slice(i + 1 - period, i + 1).reduce((a, b) => a + b, 0);
        ema = sum / period;
        result[i] = ema;
      }
    } else {
      ema = data[i] * k + ema * (1 - k);
      result[i] = ema;
    }
  }
  return result;
}

function calcMacdArr(closes: number[]) {
  const ema12 = calcEma(closes, 12).map(v => v ?? NaN);
  const ema26 = calcEma(closes, 26).map(v => v ?? NaN);
  const macdLine = ema12.map((v, i) => (isNaN(v) || isNaN(ema26[i])) ? NaN : v - ema26[i]);
  const validMacd = macdLine.filter(v => !isNaN(v));
  const signalRaw = calcEma(validMacd, 9);
  const fullSignal: number[] = new Array(macdLine.length).fill(NaN);
  let si = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (!isNaN(macdLine[i])) { fullSignal[i] = signalRaw[si++] ?? NaN; }
  }
  const hist = macdLine.map((v, i) => (isNaN(v) || isNaN(fullSignal[i])) ? NaN : v - fullSignal[i]);
  return { macd: macdLine, signal: fullSignal, hist };
}

// ── 進出場標記介面 ──
interface TradeMarker {
  price: number;
  color: string;
  label: string;
  lineStyle?: number; // 0=solid, 1=dotted, 2=dashed, 3=large-dashed
  lineWidth?: number;
  source: "strategy" | "pa" | "smc" | "chan";
}

export function KlinePanel({
  symbol, timeframe, livePrice, activeEmas = [20, 50], height = 280,
  snapshot, showVolume = true, showMacd = false, showSR = true, showOB = true,
  showMarkers = true,
}: Props) {
  const isMobile = useIsMobile();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const volContainerRef   = useRef<HTMLDivElement>(null);
  const macdContainerRef  = useRef<HTMLDivElement>(null);

  const chartRef    = useRef<IChartApi | null>(null);
  const volChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);

  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef    = useRef<ISeriesApi<"Histogram"> | null>(null);
  const macdHistRef     = useRef<ISeriesApi<"Histogram"> | null>(null);
  const macdLineRef     = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSigRef      = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRefs   = useRef<Map<number, ISeriesApi<"Line">>>(new Map());
  const srLineRefs      = useRef<ISeriesApi<"Line">[]>([]);
  const obLineRefs      = useRef<ISeriesApi<"Line">[]>([]);
  const fvgLineRefs     = useRef<ISeriesApi<"Line">[]>([]);  // FVG 邊界線
  const liqLineRefs     = useRef<ISeriesApi<"Line">[]>([]);  // 流動性池線
  const bosLineRefs     = useRef<ISeriesApi<"Line">[]>([]);  // BOS/CHoCH 標記線
  const ifvgLineRefs    = useRef<ISeriesApi<"Line">[]>([]);  // ICT iFVG 線
  const mmxmLineRefs    = useRef<ISeriesApi<"Line">[]>([]);  // MMXM 緩解塊線
  const paMmLineRefs    = useRef<ISeriesApi<"Line">[]>([]);  // PA Measured Move 線
  const snrLineRefs     = useRef<ISeriesApi<"Line">[]>([]);  // SNR 區域帶線
  const markerLineRefs  = useRef<ISeriesApi<"Line">[]>([]);

  const [hoveredPrice, setHoveredPrice] = useState<number | null>(null);
  const [hoveredOhlcv, setHoveredOhlcv] = useState<{ o: number; h: number; l: number; c: number; v: number } | null>(null);
  const [markerSources, setMarkerSources] = useState<{ strategy: boolean; pa: boolean; smc: boolean; chan: boolean }>({
    strategy: true, pa: false, smc: true, chan: false,  // SMC 預設開啟
  });
  // SMC 疊加層開關
  const [showFvg, setShowFvg] = useState(true);
  const [showLiq, setShowLiq] = useState(true);
  const [showBosChoch, setShowBosChoch] = useState(true);
  // ICT 疊加層開關
  const [showIfvg, setShowIfvg] = useState(true);
  const [showMmxmMB, setShowMmxmMB] = useState(false);
  // PA 疊加層開關
  const [showPaMm, setShowPaMm] = useState(true);
  // SNR 疊加層開關
  const [showSnr, setShowSnr] = useState(true);
  // 高勝率訊號疊加層開關
  const [showHwr, setShowHwr] = useState(true);
  const hwrLineRefs = useRef<ISeriesApi<"Line">[]>([]);  // 高勝率訊號線
  // ── 全螢幕 ──
  const [isFullscreen, setIsFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleFullscreen = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const { data: candles, isLoading } = trpc.crypto.getKlines.useQuery(
    { symbol, timeframe, limit: 150 },
    { refetchInterval: 60_000 }
  );

  const tfLabel = timeframe.toUpperCase();

  // ── Create main chart ──
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#666", fontSize: 11 },
      grid: { vertLines: { color: "rgba(40,40,40,0.6)" }, horzLines: { color: "rgba(40,40,40,0.6)" } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(120,120,120,0.5)", labelBackgroundColor: "#1e1e1e" },
        horzLine: { color: "rgba(120,120,120,0.5)", labelBackgroundColor: "#1e1e1e" },
      },
      rightPriceScale: { borderColor: "#1e1e1e", scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale: { borderColor: "#1e1e1e", timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#4caf50", downColor: "#ef5350",
      borderUpColor: "#4caf50", borderDownColor: "#ef5350",
      wickUpColor: "#4caf50", wickDownColor: "#ef5350",
    } as Partial<CandlestickSeriesOptions>);
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    chart.subscribeCrosshairMove(param => {
      if (param.point) {
        const price = candleSeries.coordinateToPrice(param.point.y);
        setHoveredPrice(price);
        if (param.seriesData) {
          const d = param.seriesData.get(candleSeries) as { open?: number; high?: number; low?: number; close?: number } | undefined;
          if (d && d.open !== undefined) {
            setHoveredOhlcv({ o: d.open, h: d.high ?? 0, l: d.low ?? 0, c: d.close ?? 0, v: 0 });
          } else {
            setHoveredOhlcv(null);
          }
        }
      } else {
        setHoveredPrice(null);
        setHoveredOhlcv(null);
      }
    });

    const ro = new ResizeObserver(() => {
      if (container) chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaSeriesRefs.current.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create volume chart ──
  useEffect(() => {
    if (!showVolume) return;
    const container = volContainerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 60,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#555", fontSize: 9 },
      grid: { vertLines: { color: "rgba(40,40,40,0.4)" }, horzLines: { color: "rgba(40,40,40,0.4)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1e1e1e", scaleMargins: { top: 0.1, bottom: 0 } },
      timeScale: { borderColor: "#1e1e1e", timeVisible: false, visible: false },
      handleScroll: false,
      handleScale: false,
    });
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    } as Partial<HistogramSeriesOptions>);
    volChartRef.current = chart;
    volSeriesRef.current = volSeries;
    const ro = new ResizeObserver(() => {
      if (container) chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);
    return () => { ro.disconnect(); chart.remove(); volChartRef.current = null; volSeriesRef.current = null; };
  }, [showVolume]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create MACD chart ──
  useEffect(() => {
    if (!showMacd) return;
    const container = macdContainerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 70,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#555", fontSize: 9 },
      grid: { vertLines: { color: "rgba(40,40,40,0.4)" }, horzLines: { color: "rgba(40,40,40,0.4)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1e1e1e", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#1e1e1e", timeVisible: false, visible: false },
      handleScroll: false,
      handleScale: false,
    });
    const histSeries = chart.addSeries(HistogramSeries, { color: "#26a69a", priceLineVisible: false } as Partial<HistogramSeriesOptions>);
    const macdSeries = chart.addSeries(LineSeries, { color: "#2196F3", lineWidth: 1, priceLineVisible: false } as Partial<LineSeriesOptions>);
    const sigSeries  = chart.addSeries(LineSeries, { color: "#FF9800", lineWidth: 1, priceLineVisible: false } as Partial<LineSeriesOptions>);
    macdChartRef.current = chart;
    macdHistRef.current  = histSeries;
    macdLineRef.current  = macdSeries;
    macdSigRef.current   = sigSeries;
    const ro = new ResizeObserver(() => {
      if (container) chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);
    return () => { ro.disconnect(); chart.remove(); macdChartRef.current = null; };
  }, [showMacd]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update candle + volume + MACD data ──
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !candles?.length) return;
    const times = candles.map(c => c.time as unknown as import("lightweight-charts").Time);
    const chartData = candles.map((c, i) => ({ time: times[i], open: c.open, high: c.high, low: c.low, close: c.close }));
    series.setData(chartData);
    chartRef.current?.timeScale().fitContent();

    // Volume
    if (volSeriesRef.current) {
      const volData = candles.map((c, i) => ({
        time: times[i],
        value: c.volume,
        color: c.close >= c.open ? "rgba(76,175,80,0.5)" : "rgba(239,83,80,0.5)",
      }));
      volSeriesRef.current.setData(volData);
      volChartRef.current?.timeScale().fitContent();
    }

    // MACD
    if (macdHistRef.current && macdLineRef.current && macdSigRef.current) {
      const closes = candles.map(c => c.close);
      const { macd, signal, hist } = calcMacdArr(closes);
      const macdData = candles.map((c, i) => ({ time: c.time as unknown as import("lightweight-charts").Time, value: isNaN(macd[i]) ? 0 : macd[i] }));
      const sigData  = candles.map((c, i) => ({ time: c.time as unknown as import("lightweight-charts").Time, value: isNaN(signal[i]) ? 0 : signal[i] }));
      const histData = candles.map((c, i) => ({
        time: c.time as unknown as import("lightweight-charts").Time,
        value: isNaN(hist[i]) ? 0 : hist[i],
        color: (hist[i] ?? 0) >= 0 ? "rgba(38,166,154,0.7)" : "rgba(239,83,80,0.7)",
      }));
      macdHistRef.current.setData(histData);
      macdLineRef.current.setData(macdData);
      macdSigRef.current.setData(sigData);
      macdChartRef.current?.timeScale().fitContent();
    }
  }, [candles]);

  // ── livePrice 即時更新最後一根 K 棒（獨立 useEffect 避免重複 setData）──
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !candles?.length || !livePrice) return;
    const last = candles[candles.length - 1];
    try {
      series.update({
        time: last.time as unknown as import("lightweight-charts").Time,
        open: last.open,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice),
        close: livePrice,
      });
    } catch {
      // 如果 update 失敗（如圖表尚未初始化）就跳過
    }
  }, [livePrice, candles]);

  // ── EMA lines ──
  const emaData = useMemo(() => {
    if (!candles?.length) return new Map<number, (number | null)[]>();
    const closes = candles.map(c => c.close);
    const result = new Map<number, (number | null)[]>();
    for (const period of [9, 20, 50, 100, 200]) result.set(period, calcEma(closes, period));
    return result;
  }, [candles]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candles?.length) return;
    emaSeriesRefs.current.forEach(s => chart.removeSeries(s));
    emaSeriesRefs.current.clear();
    for (const period of activeEmas) {
      const values = emaData.get(period);
      if (!values) continue;
      const emaSeries = chart.addSeries(LineSeries, {
        color: EMA_COLORS[period] ?? "#888", lineWidth: 1,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      const lineData = candles.map((c, i) => ({ time: c.time as unknown as import("lightweight-charts").Time, value: values[i] }))
        .filter(d => d.value !== null) as { time: import("lightweight-charts").Time; value: number }[];
      emaSeries.setData(lineData);
      emaSeriesRefs.current.set(period, emaSeries);
    }
  }, [activeEmas, emaData, candles]);

  // ── SR lines ──
  const addSrLines = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || !showSR) return;
    srLineRefs.current.forEach(s => chart.removeSeries(s));
    srLineRefs.current = [];
    const srLevels = snapshot?.pa?.timeframes?.[timeframe]?.sr_levels ?? [];
    for (const lvl of srLevels.slice(0, 6)) {
      const s = chart.addSeries(LineSeries, {
        color: lvl.type === "support" ? "rgba(76,175,80,0.5)" : "rgba(239,83,80,0.5)",
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      if (candles?.length) {
        const first = candles[0].time as unknown as import("lightweight-charts").Time;
        const last  = candles[candles.length - 1].time as unknown as import("lightweight-charts").Time;
        s.setData([{ time: first, value: lvl.price }, { time: last, value: lvl.price }]);
      }
      srLineRefs.current.push(s);
    }
  }, [snapshot, timeframe, candles, showSR]);

  useEffect(() => { addSrLines(); }, [addSrLines]);

  // ── OB zone lines ──
  const addObLines = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || !showOB) return;
    obLineRefs.current.forEach(s => chart.removeSeries(s));
    obLineRefs.current = [];
    const obs = snapshot?.smc?.order_blocks ?? [];
    for (const ob of obs.slice(-4)) {
      const color = ob.type === "bullish" ? "rgba(76,175,80,0.35)" : "rgba(239,83,80,0.35)";
      for (const price of [ob.top, ob.bottom]) {
        const s = chart.addSeries(LineSeries, {
          color, lineWidth: 1, lineStyle: 3,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        } as Partial<LineSeriesOptions>);
        if (candles?.length) {
          const first = candles[0].time as unknown as import("lightweight-charts").Time;
          const last  = candles[candles.length - 1].time as unknown as import("lightweight-charts").Time;
          s.setData([{ time: first, value: price }, { time: last, value: price }]);
        }
        obLineRefs.current.push(s);
      }
    }
  }, [snapshot, candles, showOB]);

  useEffect(() => { addObLines(); }, [addObLines]);

  // ── FVG 區塊（公平價值缺口）──
  const addFvgLines = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    fvgLineRefs.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    fvgLineRefs.current = [];
    if (!showFvg || !candles?.length) return;
    const first = candles[0].time as unknown as import("lightweight-charts").Time;
    const last  = candles[candles.length - 1].time as unknown as import("lightweight-charts").Time;
    // SmcData.fvgs: FVG[]，使用 shared/cryptoTypes FVG 型別（high/low/mid）
    const fvgs = snapshot?.smc?.fvgs ?? [];
    // 只顯示未填補的最近 6 個 FVG
    const activeFvgs = fvgs.filter(f => !f.filled).slice(-6);
    for (const fvg of activeFvgs) {
      const isBull = fvg.type === "bullish";
      const topColor = isBull ? "rgba(76,175,80,0.6)" : "rgba(239,83,80,0.6)";
      const fillColor = isBull ? "rgba(76,175,80,0.08)" : "rgba(239,83,80,0.08)";
      const topVal = fvg.top;
      const botVal = fvg.bottom;
      // 頂部線（實線）
      const topSeries = chart.addSeries(LineSeries, {
        color: topColor, lineWidth: 1, lineStyle: 0,
        priceLineVisible: false, lastValueVisible: true,
        title: isBull ? `FVG↑` : `FVG↓`,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      topSeries.setData([{ time: first, value: topVal }, { time: last, value: topVal }]);
      fvgLineRefs.current.push(topSeries);
      // 底部線（虛線）
      const botSeries = chart.addSeries(LineSeries, {
        color: fillColor.replace("0.08", "0.4"), lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      botSeries.setData([{ time: first, value: botVal }, { time: last, value: botVal }]);
      fvgLineRefs.current.push(botSeries);
      // 中線（極細，表示 FVG 中點）
      const midVal = fvg.mid ?? (topVal + botVal) / 2;
      const midSeries = chart.addSeries(LineSeries, {
        color: topColor.replace("0.6", "0.2"), lineWidth: 1, lineStyle: 3,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      midSeries.setData([{ time: first, value: midVal }, { time: last, value: midVal }]);
      fvgLineRefs.current.push(midSeries);
    }
  }, [snapshot, candles, showFvg]);
  useEffect(() => { addFvgLines(); }, [addFvgLines]);

  // ── 流動性池（SSL/BSL）標記 ──
  const addLiqLines = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    liqLineRefs.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    liqLineRefs.current = [];
    if (!showLiq || !candles?.length) return;
    const first = candles[0].time as unknown as import("lightweight-charts").Time;
    const last  = candles[candles.length - 1].time as unknown as import("lightweight-charts").Time;
    const liqLevels = snapshot?.smc?.liquidity_levels ?? [];
    for (const liq of (liqLevels as Array<{ price: number; type: string; swept: boolean; strength: string }>).slice(-8)) {
      const isBsl = liq.type === "BSL";
      const isSwept = liq.swept;
      // 已清掃：顏色變暗；未清掃：顏色鮮明
      const color = isBsl
        ? (isSwept ? "rgba(255,215,64,0.25)" : "rgba(255,215,64,0.7)")
        : (isSwept ? "rgba(79,195,247,0.25)" : "rgba(79,195,247,0.7)");
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: isSwept ? 3 : 2,  // 已清掃用大虛線，未清掃用虛線
        priceLineVisible: false,
        lastValueVisible: true,
        title: `${liq.type}${isSwept ? "✓" : ""}`,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      s.setData([{ time: first, value: liq.price }, { time: last, value: liq.price }]);
      liqLineRefs.current.push(s);
    }
    // 也顯示 nearest_sell / nearest_buy（主要流動性目標）
    const nearSell = snapshot?.smc?.liquidity?.nearest_sell;
    const nearBuy  = snapshot?.smc?.liquidity?.nearest_buy;
    if (nearSell && nearSell > 0) {
      const s = chart.addSeries(LineSeries, {
        color: "rgba(255,215,64,1)", lineWidth: 2, lineStyle: 0,
        priceLineVisible: false, lastValueVisible: true,
        title: "BSL 目標", crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      s.setData([{ time: first, value: nearSell }, { time: last, value: nearSell }]);
      liqLineRefs.current.push(s);
    }
    if (nearBuy && nearBuy > 0) {
      const s = chart.addSeries(LineSeries, {
        color: "rgba(79,195,247,1)", lineWidth: 2, lineStyle: 0,
        priceLineVisible: false, lastValueVisible: true,
        title: "SSL 目標", crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      s.setData([{ time: first, value: nearBuy }, { time: last, value: nearBuy }]);
      liqLineRefs.current.push(s);
    }
  }, [snapshot, candles, showLiq]);
  useEffect(() => { addLiqLines(); }, [addLiqLines]);

  // ── BOS/CHoCH 水平標記線 ──
  const addBosChochLines = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    bosLineRefs.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    bosLineRefs.current = [];
    if (!showBosChoch || !candles?.length) return;
    const first = candles[0].time as unknown as import("lightweight-charts").Time;
    const last  = candles[candles.length - 1].time as unknown as import("lightweight-charts").Time;
    const bosChochs = snapshot?.smc?.bos_choch ?? [];
    // 只顯示最近 5 個 BOS/CHoCH
    for (const bc of (bosChochs as Array<{ type: string; direction: string; level: number }>).slice(-5)) {
      const isChoch = bc.type === "CHoCH" || bc.type === "MSS";
      const isBull  = bc.direction === "bullish";
      // CHoCH 用更鮮明的顏色（結構轉換更重要）
      const color = isChoch
        ? (isBull ? "rgba(171,71,188,0.9)" : "rgba(255,87,34,0.9)")   // CHoCH：紫/橘
        : (isBull ? "rgba(76,175,80,0.6)" : "rgba(239,83,80,0.6)");   // BOS：綠/紅
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: isChoch ? 2 : 1,
        lineStyle: isChoch ? 0 : 2,  // CHoCH 實線，BOS 虛線
        priceLineVisible: false,
        lastValueVisible: true,
        title: `${bc.type} ${isBull ? "▲" : "▼"}`,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      s.setData([{ time: first, value: bc.level }, { time: last, value: bc.level }]);
      bosLineRefs.current.push(s);
    }
  }, [snapshot, candles, showBosChoch]);
   useEffect(() => { addBosChochLines(); }, [addBosChochLines]);

  // ── ICT iFVG 標記（已被穿越的 FVG 反轉為支撃/阻力）──
  const addIfvgLines = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    ifvgLineRefs.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    ifvgLineRefs.current = [];
    if (!showIfvg || !candles?.length) return;
    const first = candles[0].time as unknown as import("lightweight-charts").Time;
    const last  = candles[candles.length - 1].time as unknown as import("lightweight-charts").Time;
    const fvgs = snapshot?.smc?.fvgs ?? [];
    // iFVG = filled FVG（已被穿越的 FVG，性質已反轉）
    const ifvgs = fvgs.filter((f: { filled: boolean }) => f.filled).slice(-4);
    for (const fvg of ifvgs as Array<{ type: string; top: number; bottom: number; mid: number }>) {
      const isBull = fvg.type === "bullish";
      // iFVG 看漲：原本是支撇，現在變阻力（絕層線）
      // iFVG 看跌：原本是阻力，現在變支撇（絕層線）
      const topColor = isBull ? "rgba(239,83,80,0.8)"  : "rgba(76,175,80,0.8)";
      const botColor = isBull ? "rgba(239,83,80,0.5)"  : "rgba(76,175,80,0.5)";
      const midColor = isBull ? "rgba(239,83,80,0.35)" : "rgba(76,175,80,0.35)";
      // 頂部線（實線）
      const topS = chart.addSeries(LineSeries, {
        color: topColor, lineWidth: 2, lineStyle: 0,
        priceLineVisible: false, lastValueVisible: true,
        title: `iFVG ${isBull ? "看跌阻力" : "看漲支撇"}`,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      topS.setData([{ time: first, value: fvg.top }, { time: last, value: fvg.top }]);
      ifvgLineRefs.current.push(topS);
      // 底部線（虛線）
      const botS = chart.addSeries(LineSeries, {
        color: botColor, lineWidth: 1, lineStyle: 1,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      botS.setData([{ time: first, value: fvg.bottom }, { time: last, value: fvg.bottom }]);
      ifvgLineRefs.current.push(botS);
      // 中點線（點線）
      const midS = chart.addSeries(LineSeries, {
        color: midColor, lineWidth: 1, lineStyle: 3,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      midS.setData([{ time: first, value: fvg.mid }, { time: last, value: fvg.mid }]);
      ifvgLineRefs.current.push(midS);
    }
  }, [snapshot, candles, showIfvg]);
  useEffect(() => { addIfvgLines(); }, [addIfvgLines]);

  // ── MMXM 緩解塊（Mitigation Blocks）—左側 OB 延伸到右側 ──
  const addMmxmMitigationBlocks = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    mmxmLineRefs.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    mmxmLineRefs.current = [];
    if (!showMmxmMB || !candles?.length) return;
    const first = candles[0].time as unknown as import("lightweight-charts").Time;
    const last  = candles[candles.length - 1].time as unknown as import("lightweight-charts").Time;
    const obs = snapshot?.smc?.order_blocks ?? [];
    // 緩解塊 = 已被測試的 OB（已被測試 = 左側 OB 在右側延伸為緩解塊）
    const mitigationBlocks = (obs as Array<{ type: string; top: number; bottom: number; mid: number; tested: boolean; strength: string }>)
      .filter(ob => ob.tested)
      .slice(-3);
    for (const mb of mitigationBlocks) {
      const isBull = mb.type === "bullish";
      const color  = isBull ? "rgba(79,195,247,0.7)" : "rgba(255,152,0,0.7)";
      const fillC  = isBull ? "rgba(79,195,247,0.12)" : "rgba(255,152,0,0.12)";
      // 頂部線
      const topS = chart.addSeries(LineSeries, {
        color, lineWidth: 1, lineStyle: 1,
        priceLineVisible: false, lastValueVisible: true,
        title: `MB ${isBull ? "看漲" : "看跌"}`,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      topS.setData([{ time: first, value: mb.top }, { time: last, value: mb.top }]);
      mmxmLineRefs.current.push(topS);
      // 底部線
      const botS = chart.addSeries(LineSeries, {
        color: fillC, lineWidth: 1, lineStyle: 1,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      botS.setData([{ time: first, value: mb.bottom }, { time: last, value: mb.bottom }]);
      mmxmLineRefs.current.push(botS);
    }
  }, [snapshot, candles, showMmxmMB]);
  useEffect(() => { addMmxmMitigationBlocks(); }, [addMmxmMitigationBlocks]);

  // ── PA Measured Move 目標線 ──────────────────────────────────────────────
  const addPaMmLines = useCallback(() => {
    if (!chartRef.current || !candles?.length) return;
    const chart = chartRef.current;
    paMmLineRefs.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    paMmLineRefs.current = [];
    if (!showPaMm || !snapshot?.pa) return;
    const tf4h = snapshot.pa.timeframes["4h"];
    if (!tf4h) return;
    const support    = tf4h.support;
    const resistance = tf4h.resistance;
    const atr        = tf4h.atr ?? 0;
    const close      = tf4h.close ?? 0;
    const ema20      = tf4h.ema20 ?? close;
    const ema50      = tf4h.ema50 ?? close;
    if (!support || !resistance || !close) return;
    const trHeight   = resistance - support;
    const leg1Height = Math.abs(ema20 - ema50);
    const consensus  = snapshot.pa.consensus;
    const isBullish  = consensus === "bullish" || consensus === "strong_bullish";
    const isBearish  = consensus === "bearish" || consensus === "strong_bearish";
    const mmTrBull   = resistance + trHeight;
    const mmTrBear   = support - trHeight;
    const mmLeg2Bull = close + leg1Height;
    const mmLeg2Bear = close - leg1Height;
    const mmBarBull  = close + atr * 2;
    const mmBarBear  = close - atr * 2;
    const firstTime  = candles[0].time as number;
    const lastTime   = candles[candles.length - 1].time as number;
    const futureTime = lastTime + 20 * 3600;
    const drawMmLine = (price: number, color: string, title: string, style: 0 | 2 | 3) => {
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: 1, lineStyle: style,
        priceLineVisible: true, lastValueVisible: true,
        title, crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      s.setData([{ time: firstTime as import("lightweight-charts").UTCTimestamp, value: price }, { time: futureTime as import("lightweight-charts").UTCTimestamp, value: price }]);
      paMmLineRefs.current.push(s);
    };
    if (isBullish || !isBearish) {
      drawMmLine(mmTrBull,   "rgba(255,152,0,0.9)",   "MM①TR↑",   0);
      drawMmLine(mmLeg2Bull, "rgba(255,215,64,0.75)", "MM②L1=L2↑", 2);
      drawMmLine(mmBarBull,  "rgba(179,136,255,0.6)", "MM③ATR↑",  3);
    }
    if (isBearish || !isBullish) {
      drawMmLine(mmTrBear,   "rgba(255,152,0,0.9)",   "MM①TR↓",   0);
      drawMmLine(mmLeg2Bear, "rgba(255,215,64,0.75)", "MM②L1=L2↓", 2);
      drawMmLine(mmBarBear,  "rgba(179,136,255,0.6)", "MM③ATR↓",  3);
    }
  }, [snapshot, candles, showPaMm]);
  useEffect(() => { addPaMmLines(); }, [addPaMmLines]);

  // ── SNR 區域帶（JiaSheng 機構畫法：新鮮度色碼 + 路障線）──
  const addSnrLines = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    snrLineRefs.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    snrLineRefs.current = [];
    if (!showSnr || !snapshot?.pa || !candles?.length) return;

    const tf4h = snapshot.pa.timeframes["4h"];
    if (!tf4h?.sr_levels?.length) return;

    const atr = tf4h.atr ?? 0;
    const firstTime = candles[0].time as import("lightweight-charts").UTCTimestamp;
    const lastTime  = candles[candles.length - 1].time as import("lightweight-charts").UTCTimestamp;
    const futureTime = (lastTime + 3600 * 24 * 7) as import("lightweight-charts").UTCTimestamp;

    const drawSnrLine = (price: number, color: string, style: 0 | 1 | 2 | 3, title: string, width: 1 | 2 | 3 = 1) => {
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: width, lineStyle: style,
        priceLineVisible: false, lastValueVisible: true,
        title, crosshairMarkerVisible: false,
      } as Partial<LineSeriesOptions>);
      s.setData([{ time: firstTime, value: price }, { time: futureTime, value: price }]);
      snrLineRefs.current.push(s);
    };

    tf4h.sr_levels.forEach(level => {
      const isRes = level.type === "resistance";
      const touches = level.touches ?? 1;
      // 新鮮度色碼（訂單消耗原理）
      let color: string;
      if (touches <= 1)      color = isRes ? "rgba(239,83,80,0.9)"  : "rgba(0,230,118,0.9)";
      else if (touches === 2) color = isRes ? "rgba(239,83,80,0.65)" : "rgba(76,175,80,0.65)";
      else if (touches === 3) color = isRes ? "rgba(255,152,0,0.55)" : "rgba(255,152,0,0.55)";
      else if (touches === 4) color = isRes ? "rgba(255,152,0,0.35)" : "rgba(255,152,0,0.35)";
      else                    color = "rgba(100,100,100,0.3)";

      // 主線（實線）
      drawSnrLine(level.price, color, 0, `${isRes ? "R" : "S"}(${touches}x)`, touches <= 2 ? 2 : 1);
      // 區域帶上下邊界（虛線，ATR×0.5）
      if (atr > 0) {
        const dimColor = color.replace(/[\d.]+\)$/, "0.25)");
        drawSnrLine(level.price + atr * 0.5, dimColor, 2, "", 1);
        drawSnrLine(level.price - atr * 0.5, dimColor, 2, "", 1);
      }
    });

    // 路障線（橙色點線）：在最近阻力與支撐之間的中間 SR
    const currentPrice = candles[candles.length - 1].close;
    const nearRes = tf4h.sr_levels.filter(l => l.type === "resistance" && l.price > currentPrice).sort((a, b) => a.price - b.price)[0];
    const nearSup = tf4h.sr_levels.filter(l => l.type === "support"    && l.price < currentPrice).sort((a, b) => b.price - a.price)[0];
    if (nearRes && nearSup) {
      const roadblocks = tf4h.sr_levels.filter(l =>
        l.price < nearRes.price && l.price > nearSup.price &&
        Math.abs(l.price - currentPrice) / currentPrice > 0.002
      );
      roadblocks.forEach(rb => {
        drawSnrLine(rb.price, "rgba(255,152,0,0.6)", 3, `路障(${rb.touches}x)`, 1);
      });
    }
  }, [snapshot, candles, showSnr]);
  useEffect(() => { addSnrLines(); }, [addSnrLines]);

  // ── 進出場標記（Phase 3 新增）──
  const tradeMarkers = useMemo((): TradeMarker[] => {
    if (!snapshot || !showMarkers) return [];
    const markers: TradeMarker[] = [];

    // 1. 策略進出場標記（主要）
    if (markerSources.strategy) {
      const strat = snapshot.strategy;
      if (strat && strat.direction !== "neutral") {
        const isLong = strat.direction === "long";
        if (strat.entry) {
          markers.push({
            price: strat.entry,
            color: isLong ? MARKER_COLORS.entry_long : MARKER_COLORS.entry_short,
            label: `策略進場 ${isLong ? "▲" : "▼"}`,
            lineStyle: 0, lineWidth: 2,
            source: "strategy",
          });
        }
        if (strat.sl) {
          markers.push({
            price: strat.sl,
            color: MARKER_COLORS.sl,
            label: "止損 SL",
            lineStyle: 2, lineWidth: 1,
            source: "strategy",
          });
        }
        if (strat.tp1) {
          markers.push({
            price: strat.tp1,
            color: MARKER_COLORS.tp1,
            label: "止盈 TP1",
            lineStyle: 1, lineWidth: 1,
            source: "strategy",
          });
        }
        if (strat.tp2) {
          markers.push({
            price: strat.tp2,
            color: MARKER_COLORS.tp2,
            label: "止盈 TP2",
            lineStyle: 1, lineWidth: 1,
            source: "strategy",
          });
        }
      }
    }

    // 2. PA 進出場標記
    if (markerSources.pa) {
      const paEntry = snapshot.pa?.entry_params;
      if (paEntry && "entry" in paEntry && paEntry.entry) {
        const isLong = paEntry.direction === "long";
        markers.push({
          price: paEntry.entry,
          color: MARKER_COLORS.pa_entry,
          label: `PA 進場 ${isLong ? "▲" : "▼"}`,
          lineStyle: 0, lineWidth: 1,
          source: "pa",
        });
        if (paEntry.sl) markers.push({ price: paEntry.sl, color: MARKER_COLORS.sl, label: "PA 止損", lineStyle: 2, lineWidth: 1, source: "pa" });
        if (paEntry.tp1) markers.push({ price: paEntry.tp1, color: MARKER_COLORS.tp1, label: "PA TP1", lineStyle: 1, lineWidth: 1, source: "pa" });
        if (paEntry.tp2) markers.push({ price: paEntry.tp2, color: MARKER_COLORS.tp2, label: "PA TP2", lineStyle: 1, lineWidth: 1, source: "pa" });
      }
    }

    // 3. SMC 確認設置標記
    if (markerSources.smc) {
      const smcSetups = (snapshot.advanced?.smc_confirmations ?? []) as Array<{
        direction: string; entry_zone: { top: number; bottom: number };
        sl: number; tp1: number; tp2: number; status: string;
      }>;
      const activeSetup = smcSetups.find(s => s.status === "active" || s.status === "waiting");
      if (activeSetup) {
        const isLong = activeSetup.direction === "bullish";
        const entryMid = (activeSetup.entry_zone.top + activeSetup.entry_zone.bottom) / 2;
        markers.push({
          price: entryMid,
          color: MARKER_COLORS.smc_entry,
          label: `SMC 進場 ${isLong ? "▲" : "▼"}`,
          lineStyle: 0, lineWidth: 1,
          source: "smc",
        });
        markers.push({ price: activeSetup.entry_zone.top, color: `${MARKER_COLORS.smc_entry}88`, label: "SMC 區上", lineStyle: 3, lineWidth: 1, source: "smc" });
        markers.push({ price: activeSetup.entry_zone.bottom, color: `${MARKER_COLORS.smc_entry}88`, label: "SMC 區下", lineStyle: 3, lineWidth: 1, source: "smc" });
        if (activeSetup.sl) markers.push({ price: activeSetup.sl, color: MARKER_COLORS.sl, label: "SMC 止損", lineStyle: 2, lineWidth: 1, source: "smc" });
        if (activeSetup.tp1) markers.push({ price: activeSetup.tp1, color: MARKER_COLORS.tp1, label: "SMC TP1", lineStyle: 1, lineWidth: 1, source: "smc" });
        if (activeSetup.tp2) markers.push({ price: activeSetup.tp2, color: MARKER_COLORS.tp2, label: "SMC TP2", lineStyle: 1, lineWidth: 1, source: "smc" });
      }
    }

    // 5. 高勝率多合一訊號標記（高信心度進場標記）
    // 當策略方向非中性且有高勝率樣本模式支撑時，顯示高勝率訊號標記
    if (showHwr && snapshot.strategy && snapshot.strategy.direction !== "neutral") {
      const strat = snapshot.strategy;
      const isLong = strat.direction === "long";
      const winRate = strat.similar_pattern?.win_rate ?? 0;
      // 當樣本勝率 >= 60% 或有進場價時，顯示高勝率訊號標記
      if ((winRate >= 60 || strat.entry) && candles && candles.length > 0) {
        const entryPrice = strat.entry ?? (livePrice ?? candles[candles.length - 1].close);
        const label = winRate > 0 ? `HWR ${isLong ? "▲" : "▼"} ${winRate.toFixed(0)}%` : `HWR ${isLong ? "▲" : "▼"}`;
        markers.push({
          price: entryPrice,
          color: isLong ? "#ffd700" : "#ff6b35",
          label,
          lineStyle: 0, lineWidth: 2,
          source: "strategy",
        });
      }
    }

    // 4. 纏論買賣點標記
    if (markerSources.chan) {
      const chanMtf = snapshot.chan_mtf;
      const tfResult = chanMtf?.timeframes?.[timeframe];
      const bsp = tfResult?.buy_sell_points ?? [];
      for (const pt of bsp.slice(-3)) {
        const isBuy = pt.direction === "buy";
        markers.push({
          price: pt.price,
          color: isBuy ? MARKER_COLORS.chan_buy : MARKER_COLORS.chan_sell,
          label: `${isBuy ? "纏買" : "纏賣"}${pt.level}`,
          lineStyle: 2, lineWidth: 1,
          source: "chan",
        });
      }
    }

    return markers;
  }, [snapshot, showMarkers, markerSources, timeframe]);

  // ── 渲染進出場標記線 ──
  const addMarkerLines = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    markerLineRefs.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    markerLineRefs.current = [];
    if (!candles?.length || !showMarkers) return;

    const first = candles[0].time as unknown as import("lightweight-charts").Time;
    const last  = candles[candles.length - 1].time as unknown as import("lightweight-charts").Time;

    for (const marker of tradeMarkers) {
      try {
        const s = chart.addSeries(LineSeries, {
          color: marker.color,
          lineWidth: (marker.lineWidth ?? 1) as 1 | 2 | 3 | 4,
          lineStyle: marker.lineStyle ?? 0,
          priceLineVisible: false,
          lastValueVisible: true,
          title: marker.label,
          crosshairMarkerVisible: false,
        } as Partial<LineSeriesOptions>);
        s.setData([{ time: first, value: marker.price }, { time: last, value: marker.price }]);
        markerLineRefs.current.push(s);
      } catch {}
    }
  }, [candles, tradeMarkers, showMarkers]);

  useEffect(() => { addMarkerLines(); }, [addMarkerLines]);

  const displayPrice = hoveredPrice ?? livePrice ?? (candles?.length ? candles[candles.length - 1].close : null);
  const lastCandle = candles?.length ? candles[candles.length - 1] : null;

  // 計算策略 RR 比例（用於標記面板顯示）
  const stratRR = useMemo(() => {
    const s = snapshot?.strategy;
    if (!s || !s.entry || !s.sl || !s.tp1) return null;
    const risk = Math.abs(s.entry - s.sl);
    const reward = Math.abs(s.tp1 - s.entry);
    return risk > 0 ? (reward / risk).toFixed(2) : null;
  }, [snapshot]);

  return (
    <div ref={panelRef} className={`bg-[#0d0d0d] border border-[#1e1e1e] rounded-lg overflow-hidden${isFullscreen ? " fixed inset-0 z-[9999] flex flex-col" : ""}`}>
      {/* Header */}
      <div className="flex flex-col gap-1.5 border-b border-[#1e1e1e] px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:py-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-[#888]">{tfLabel}</span>
          {candles?.length && <span className="text-[10px] text-[#555]">{candles.length} 根</span>}
          {!isMobile && activeEmas.map(p => (
            <span key={p} className="text-[10px] font-medium" style={{ color: EMA_COLORS[p] }}>EMA{p}</span>
          ))}
          {!isMobile && showSR && <span className="text-[10px] text-green-600">SR</span>}
          {!isMobile && showOB && <span className="text-[10px] text-red-600">OB</span>}
          {showMarkers && tradeMarkers.length > 0 && (
            <span className="text-[10px] text-[#ffd740]">標記 {tradeMarkers.length}</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-3">
          {/* 全螢幕按鈕 */}
          <button
            onClick={toggleFullscreen}
            className="p-1 rounded text-[#555] hover:text-[#ffd740] transition-colors"
            title={isFullscreen ? "退出全螢幕" : "全螢幕"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          {/* OHLCV hover info */}
          {!isMobile && hoveredOhlcv ? (
            <div className="flex items-center gap-1.5 text-[10px] font-mono">
              <span className="text-[#888]">O<span className="text-white ml-0.5">{hoveredOhlcv.o.toFixed(2)}</span></span>
              <span className="text-[#888]">H<span className="text-green-400 ml-0.5">{hoveredOhlcv.h.toFixed(2)}</span></span>
              <span className="text-[#888]">L<span className="text-red-400 ml-0.5">{hoveredOhlcv.l.toFixed(2)}</span></span>
              <span className="text-[#888]">C<span className={`ml-0.5 ${hoveredOhlcv.c >= hoveredOhlcv.o ? "text-green-400" : "text-red-400"}`}>{hoveredOhlcv.c.toFixed(2)}</span></span>
            </div>
          ) : !isMobile && lastCandle ? (
            <div className="flex items-center gap-1.5 text-[10px] font-mono">
              <span className="text-[#555]">O<span className="text-[#888] ml-0.5">{lastCandle.open.toFixed(2)}</span></span>
              <span className="text-[#555]">H<span className="text-[#888] ml-0.5">{lastCandle.high.toFixed(2)}</span></span>
              <span className="text-[#555]">L<span className="text-[#888] ml-0.5">{lastCandle.low.toFixed(2)}</span></span>
            </div>
          ) : null}
          {displayPrice && (
            <span className="text-xs font-mono text-[#3b82f6]">
              {displayPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
      </div>

      {/* Main chart */}
      <div className={`relative${isFullscreen ? " flex-1" : ""}`}>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d0d]/80 z-10">
            <div className="text-xs text-[#555] animate-pulse">載入 {tfLabel}...</div>
          </div>
        )}
        <div ref={chartContainerRef} style={{ height: isFullscreen ? "100%" : height, minHeight: isFullscreen ? 0 : undefined }} className={isFullscreen ? "absolute inset-0" : ""} />
      </div>

      {/* Volume sub-chart */}
      {showVolume && (
        <div className="border-t border-[#1e1e1e]">
          <div className="px-2 py-0.5 flex items-center gap-1">
            <span className="text-[9px] text-[#444]">VOL</span>
          </div>
          <div ref={volContainerRef} style={{ height: isMobile ? 44 : 60 }} />
        </div>
      )}

      {/* MACD sub-chart */}
      {showMacd && (
        <div className="border-t border-[#1e1e1e]">
          <div className="px-2 py-0.5 flex items-center gap-2">
            <span className="text-[9px] text-[#444]">MACD</span>
            <span className="text-[9px] text-[#2196F3]">MACD</span>
            <span className="text-[9px] text-[#FF9800]">Signal</span>
          </div>
          <div ref={macdContainerRef} style={{ height: isMobile ? 54 : 70 }} />
        </div>
      )}

      {/* ── SMC 圖層控制列 ── */}
      {snapshot && (
        <div className="border-t border-[#1e1e1e] px-3 py-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] text-[#444] uppercase tracking-wider mr-0.5">SMC 圖層</span>
            {/* FVG 開關 */}
            <button
              onClick={() => setShowFvg(p => !p)}
              className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: showFvg ? "rgba(76,175,80,0.7)" : "#2a2a2a",
                color: showFvg ? "rgba(76,175,80,0.9)" : "#555",
                background: showFvg ? "rgba(76,175,80,0.08)" : "transparent",
              }}
            >
              FVG
            </button>
            {/* 流動性池 開關 */}
            <button
              onClick={() => setShowLiq(p => !p)}
              className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: showLiq ? "rgba(255,215,64,0.7)" : "#2a2a2a",
                color: showLiq ? "rgba(255,215,64,0.9)" : "#555",
                background: showLiq ? "rgba(255,215,64,0.08)" : "transparent",
              }}
            >
              SSL/BSL
            </button>
            {/* BOS/CHoCH 開關 */}
            <button
              onClick={() => setShowBosChoch(p => !p)}
              className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: showBosChoch ? "rgba(171,71,188,0.7)" : "#2a2a2a",
                color: showBosChoch ? "rgba(171,71,188,0.9)" : "#555",
                background: showBosChoch ? "rgba(171,71,188,0.08)" : "transparent",
              }}
            >
              BOS/CHoCH
            </button>
            {/* OB 開關 */}
            {showOB && (
              <span className="text-[9px] px-1.5 py-0.5 rounded border" style={{ borderColor: "rgba(239,83,80,0.4)", color: "rgba(239,83,80,0.7)" }}>OB ✓</span>
            )}
            {/* 圖層小說明 */}
            {!isMobile && (
              <span className="text-[9px] text-[#333] ml-1">
                {showFvg && <span className="text-green-700">■ FVG缺口 </span>}
                {showLiq && <span className="text-yellow-600">— 流動性池 </span>}
                {showBosChoch && <span className="text-purple-600">— CHoCH </span>}
              </span>
            )}
          </div>
          {/* ICT 圖層 */}
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <span className="text-[9px] text-[#444] uppercase tracking-wider mr-0.5">ICT 圖層</span>
            {/* iFVG 開關 */}
            <button
              onClick={() => setShowIfvg(p => !p)}
              className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: showIfvg ? "rgba(239,83,80,0.7)" : "#2a2a2a",
                color: showIfvg ? "rgba(239,83,80,0.9)" : "#555",
                background: showIfvg ? "rgba(239,83,80,0.08)" : "transparent",
              }}
            >
              iFVG
            </button>
            {/* MMXM 緩解塊 */}
            <button
              onClick={() => setShowMmxmMB(p => !p)}
              className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: showMmxmMB ? "rgba(79,195,247,0.7)" : "#2a2a2a",
                color: showMmxmMB ? "rgba(79,195,247,0.9)" : "#555",
                background: showMmxmMB ? "rgba(79,195,247,0.08)" : "transparent",
              }}
            >
              MMXM 緩解塊
            </button>
            {!isMobile && (
              <span className="text-[9px] text-[#333] ml-1">
                {showIfvg && <span style={{ color: "rgba(239,83,80,0.6)" }}>— iFVG 阻力/支撇 </span>}
                {showMmxmMB && <span style={{ color: "rgba(79,195,247,0.6)" }}>— 緩解塊 </span>}
              </span>
            )}
          </div>
          {/* PA 圖層 */}
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <span className="text-[9px] text-[#444] uppercase tracking-wider mr-0.5">PA 圖層</span>
            {/* MM 目標線開關 */}
            <button
              onClick={() => setShowPaMm(p => !p)}
              className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: showPaMm ? "rgba(255,152,0,0.7)" : "#2a2a2a",
                color: showPaMm ? "rgba(255,152,0,0.9)" : "#555",
                background: showPaMm ? "rgba(255,152,0,0.08)" : "transparent",
              }}
            >
              MM 目標
            </button>
            {!isMobile && (
              <span className="text-[9px] text-[#333] ml-1">
                {showPaMm && (
                  <>
                    <span style={{ color: "rgba(255,152,0,0.8)" }}>— MM①TR </span>
                    <span style={{ color: "rgba(255,215,64,0.7)" }}>— MM②L1=L2 </span>
                    <span style={{ color: "rgba(179,136,255,0.7)" }}>— MM③ATR </span>
                  </>
                )}
              </span>
            )}
          </div>
          {/* SNR 圖層 */}
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <span className="text-[9px] text-[#444] uppercase tracking-wider mr-0.5">SNR 圖層</span>
            <button
              onClick={() => setShowSnr(p => !p)}
              className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: showSnr ? "rgba(100,200,100,0.7)" : "#2a2a2a",
                color: showSnr ? "rgba(100,220,100,0.9)" : "#555",
                background: showSnr ? "rgba(100,200,100,0.08)" : "transparent",
              }}
            >
              SNR 區域
            </button>
            {!isMobile && showSnr && (
              <span className="text-[9px] text-[#333] ml-1">
                <span style={{ color: "rgba(0,230,118,0.8)" }}>— 支撐(新鮮) </span>
                <span style={{ color: "rgba(239,83,80,0.8)" }}>— 阻力(新鮮) </span>
                <span style={{ color: "rgba(255,152,0,0.7)" }}>··· 路障 </span>
                <span style={{ color: "rgba(100,100,100,0.6)" }}>— 已耗盡 </span>
              </span>
            )}
          </div>
          {/* 高勝率訊號圖層 */}
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <span className="text-[9px] text-[#444] uppercase tracking-wider mr-0.5">高勝率訊號</span>
            <button
              onClick={() => setShowHwr(p => !p)}
              className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: showHwr ? "rgba(255,215,0,0.7)" : "#2a2a2a",
                color: showHwr ? "rgba(255,215,0,0.9)" : "#555",
                background: showHwr ? "rgba(255,215,0,0.08)" : "transparent",
              }}
            >
              多合一進場
            </button>
            {!isMobile && showHwr && (
              <span className="text-[9px] text-[#333] ml-1">
                <span style={{ color: "rgba(255,215,0,0.8)" }}>— HWR 高信心度 ≥ 65% </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Phase 3：進出場標記控制面板 ── */}
      {showMarkers && snapshot && (
        <div className="border-t border-[#1e1e1e] px-3 py-1.5">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto">
              <span className="text-[9px] text-[#444] uppercase tracking-wider mr-1">進出場</span>
              {/* 策略標記開關 */}
              <button
                onClick={() => setMarkerSources(p => ({ ...p, strategy: !p.strategy }))}
                className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
                style={{
                  borderColor: markerSources.strategy ? MARKER_COLORS.entry_long : "#2a2a2a",
                  color: markerSources.strategy ? MARKER_COLORS.entry_long : "#555",
                  background: markerSources.strategy ? `${MARKER_COLORS.entry_long}15` : "transparent",
                }}
              >
                策略
              </button>
              {/* PA 標記開關 */}
              <button
                onClick={() => setMarkerSources(p => ({ ...p, pa: !p.pa }))}
                className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
                style={{
                  borderColor: markerSources.pa ? MARKER_COLORS.pa_entry : "#2a2a2a",
                  color: markerSources.pa ? MARKER_COLORS.pa_entry : "#555",
                  background: markerSources.pa ? `${MARKER_COLORS.pa_entry}15` : "transparent",
                }}
              >
                PA
              </button>
              {/* SMC 標記開關 */}
              <button
                onClick={() => setMarkerSources(p => ({ ...p, smc: !p.smc }))}
                className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
                style={{
                  borderColor: markerSources.smc ? MARKER_COLORS.smc_entry : "#2a2a2a",
                  color: markerSources.smc ? MARKER_COLORS.smc_entry : "#555",
                  background: markerSources.smc ? `${MARKER_COLORS.smc_entry}15` : "transparent",
                }}
              >
                SMC
              </button>
              {/* 纏論標記開關 */}
              <button
                onClick={() => setMarkerSources(p => ({ ...p, chan: !p.chan }))}
                className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
                style={{
                  borderColor: markerSources.chan ? MARKER_COLORS.chan_buy : "#2a2a2a",
                  color: markerSources.chan ? MARKER_COLORS.chan_buy : "#555",
                  background: markerSources.chan ? `${MARKER_COLORS.chan_buy}15` : "transparent",
                }}
              >
                纏論
              </button>
            </div>
            {/* 策略摘要 */}
            {!isMobile && snapshot.strategy && snapshot.strategy.direction !== "neutral" && (
              <div className="flex items-center gap-1.5 text-[9px]">
                <span
                  className="px-1.5 py-0.5 rounded font-semibold"
                  style={{
                    background: snapshot.strategy.direction === "long" ? `${MARKER_COLORS.entry_long}20` : `${MARKER_COLORS.entry_short}20`,
                    color: snapshot.strategy.direction === "long" ? MARKER_COLORS.entry_long : MARKER_COLORS.entry_short,
                    border: `1px solid ${snapshot.strategy.direction === "long" ? MARKER_COLORS.entry_long : MARKER_COLORS.entry_short}40`,
                  }}
                >
                  {snapshot.strategy.direction === "long" ? "▲ 多" : "▼ 空"}
                </span>
                {snapshot.strategy.entry && (
                  <span className="text-[#888] font-mono">
                    進 {snapshot.strategy.entry.toFixed(2)}
                  </span>
                )}
                {snapshot.strategy.sl && (
                  <span className="font-mono" style={{ color: MARKER_COLORS.sl }}>
                    損 {snapshot.strategy.sl.toFixed(2)}
                  </span>
                )}
                {snapshot.strategy.tp1 && (
                  <span className="font-mono" style={{ color: MARKER_COLORS.tp1 }}>
                    盈 {snapshot.strategy.tp1.toFixed(2)}
                  </span>
                )}
                {stratRR && (
                  <span className="text-[#ffd740] font-mono">RR {stratRR}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
