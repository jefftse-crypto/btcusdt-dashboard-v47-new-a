/**
 * useDashboardWebSocket.ts — Phase 7
 *
 * 連接後端 /ws WebSocket 伺服器，訂閱多幣種即時 ticker。
 *
 * 特性：
 * - 自動重連（指數退避，最大 30 秒）
 * - 支援動態更新訂閱幣種列表
 * - 心跳 ping/pong 保持連接
 * - 以後端提供的市場資料狀態為準，不再直連受限環境下容易失敗的第三方 WebSocket
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

export interface SignalAlert {
  symbol: string;
  interval: string;
  direction: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  strategy: string;
  signal_score: number | null;
  recent_wr: number;
  timestamp: number;
  gpt_analysis: string | null;
  gpt_loading: boolean;
  id: string; // 前端生成的唯一 ID
  regime?: string;           // 市況分類
  is_expired?: boolean;      // 信號是否已失效
  effective_signals?: number; // 有效獨立信號數
}

export interface TickerData {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  ts: number;
}

interface UseDashboardWebSocketOptions {
  symbols: string[];
  enabled?: boolean;
  fallbackToBinance?: boolean;
}

interface DashboardWsState {
  tickers: Map<string, TickerData>;
  status: "connecting" | "connected" | "disconnected" | "error" | "fallback";
  isLive: boolean;
  latency: number | null;
  provider: "kraken_polling" | "none" | null;
  lastUpdateTs: number | null;
  message: string | null;
  signalAlerts: SignalAlert[]; // 即時信號列表（最新 20 筆）
}

interface StatusMessage {
  type: "status";
  connected: boolean;
  subscribedSymbols: string[];
  clientCount: number;
  provider?: "kraken_polling" | "none";
  marketDataConnected?: boolean;
  lastUpdateTs?: number | null;
  message?: string | null;
}

const PING_INTERVAL = 25_000;
const MAX_RECONNECT_DELAY = 30_000;

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${proto}//${host}/ws`;
}

export function useDashboardWebSocket({
  symbols,
  enabled = true,
  fallbackToBinance = false,
}: UseDashboardWebSocketOptions): DashboardWsState {
  // 穩定 symbols 陣列引用，避免每次 render 傳入新陣列導致重複訂閱
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableSymbols = useMemo(() => symbols, [symbols.join(",")]);
  const [state, setState] = useState<DashboardWsState>({
    tickers: new Map(),
    status: "disconnected",
    isLive: false,
    latency: null,
    provider: null,
    lastUpdateTs: null,
    message: null,
    signalAlerts: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectCountRef = useRef(0);
  const mountedRef = useRef(true);
  const symbolsRef = useRef<string[]>(stableSymbols);
  const pingTimeRef = useRef<number | null>(null);

  useEffect(() => {
    symbolsRef.current = stableSymbols;
  }, [stableSymbols]);

  const startPing = useCallback((ws: WebSocket) => {
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    pingTimerRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        pingTimeRef.current = Date.now();
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {}
      }
    }, PING_INTERVAL);
  }, []);

  const subscribe = useCallback((ws: WebSocket, syms: string[]) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "subscribe", symbols: syms }));
      } catch {}
    }
  }, []);

  const applyStatusMessage = useCallback((msg: StatusMessage) => {
    setState((prev) => ({
      ...prev,
      status: msg.connected ? (msg.marketDataConnected ? "connected" : "fallback") : "error",
      isLive: !!msg.marketDataConnected,
      provider: msg.provider ?? prev.provider,
      lastUpdateTs: msg.lastUpdateTs ?? null,
      message: msg.message ?? null,
    }));
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return;

    const url = getWsUrl();
    setState((prev) => ({ ...prev, status: "connecting", message: null }));

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        reconnectCountRef.current = 0;
        setState((prev) => ({ ...prev, status: "connected" }));
        subscribe(ws, symbolsRef.current);
        startPing(ws);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data as string);

          switch (msg.type) {
            case "ticker": {
              const ticker: TickerData = {
                symbol: msg.symbol,
                price: msg.price,
                change24h: msg.change24h ?? 0,
                high24h: msg.high24h ?? msg.price,
                low24h: msg.low24h ?? msg.price,
                volume24h: msg.volume24h ?? 0,
                ts: msg.ts ?? Date.now(),
              };
              setState((prev) => {
                const newTickers = new Map(prev.tickers);
                newTickers.set(ticker.symbol, ticker);
                return {
                  ...prev,
                  tickers: newTickers,
                  isLive: true,
                  status: "connected",
                  lastUpdateTs: ticker.ts,
                  message: null,
                };
              });
              break;
            }

            case "pong": {
              if (pingTimeRef.current !== null) {
                const latency = Date.now() - pingTimeRef.current;
                pingTimeRef.current = null;
                setState((prev) => ({ ...prev, latency }));
              }
              break;
            }

            case "status": {
              applyStatusMessage(msg as StatusMessage);
              break;
            }

            case "signal_alert": {
              const alert = msg as Omit<SignalAlert, "id"> & { type: string; regime?: string; is_expired?: boolean; effective_signals?: number };
              const alertId = `${alert.symbol}_${alert.timestamp}`;
              const now = Date.now();
              const SIGNAL_EXPIRE_MS = 2 * 60 * 60 * 1000; // 2 小時後自動標記失效
              const newAlert: SignalAlert = {
                symbol: alert.symbol,
                interval: alert.interval,
                direction: alert.direction,
                entry: alert.entry,
                sl: alert.sl,
                tp1: alert.tp1,
                tp2: alert.tp2,
                strategy: alert.strategy,
                signal_score: alert.signal_score,
                recent_wr: alert.recent_wr,
                timestamp: alert.timestamp,
                gpt_analysis: alert.gpt_analysis,
                gpt_loading: alert.gpt_loading,
                id: alertId,
                regime: alert.regime,
                is_expired: alert.is_expired ?? (now - alert.timestamp > SIGNAL_EXPIRE_MS),
                effective_signals: alert.effective_signals,
              };
              setState((prev) => {
                // 更新現有或新增（同一 id 則更新，不同則新增）
                const existing = prev.signalAlerts.findIndex(a => a.id === alertId);
                let newAlerts: SignalAlert[];
                if (existing >= 0) {
                  newAlerts = prev.signalAlerts.map(a => a.id === alertId ? newAlert : a);
                } else {
                  // 新增時，自動標記超過 2 小時的舊信號為失效
                  const updatedOld = prev.signalAlerts.map(a => ({
                    ...a,
                    is_expired: a.is_expired || (now - a.timestamp > SIGNAL_EXPIRE_MS),
                  }));
                  newAlerts = [newAlert, ...updatedOld].slice(0, 30); // 最新 30 筆
                }
                return { ...prev, signalAlerts: newAlerts };
              });
              break;
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setState((prev) => ({
          ...prev,
          status: "error",
          isLive: false,
          message: fallbackToBinance
            ? "即時連線異常，已停用第三方直連回退以避免受限環境反覆失敗。"
            : "即時連線異常，系統將自動重試。",
        }));
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        wsRef.current = null;
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        setState((prev) => ({
          ...prev,
          status: "disconnected",
          isLive: false,
          message: prev.message ?? "即時連線已中斷，系統正在重連。",
        }));

        const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), MAX_RECONNECT_DELAY);
        reconnectCountRef.current++;
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      };
    } catch {
      setState((prev) => ({
        ...prev,
        status: "error",
        isLive: false,
        message: "即時連線初始化失敗。",
      }));
    }
  }, [enabled, subscribe, startPing, applyStatusMessage, fallbackToBinance]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, [connect, enabled]);

  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      subscribe(ws, stableSymbols);
    }
  }, [stableSymbols, subscribe]);

  return state;
}

export function useSignalAlerts(enabled = true) {
  const { signalAlerts } = useDashboardWebSocket({
    symbols: ["BTCUSDT"],
    enabled,
  });
  return signalAlerts;
}

export function useLiveTicker(symbol: string, enabled = true) {
  const { tickers, status, isLive, latency, provider, lastUpdateTs, message } = useDashboardWebSocket({
    symbols: enabled ? [symbol] : [],
    enabled,
  });

  const ticker = tickers.get(symbol);

  return {
    livePrice: ticker?.price ?? null,
    change24h: ticker?.change24h ?? null,
    high24h: ticker?.high24h ?? null,
    low24h: ticker?.low24h ?? null,
    volume24h: ticker?.volume24h ?? null,
    isLive,
    status,
    latency,
    provider,
    lastUpdateTs,
    message,
  };
}
