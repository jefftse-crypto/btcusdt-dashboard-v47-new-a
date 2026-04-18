import { useState, useEffect, useRef, useCallback } from "react";

interface UseKlineWebSocketOptions {
  symbol: string;
  timeframe: string;
  enabled?: boolean;
  mode?: "ticker" | "kline";
}

interface WebSocketState {
  livePrice: number | null;
  change24h: number | null;
  status: "connecting" | "connected" | "disconnected" | "error";
  isLive: boolean;
}

/**
 * Binance WebSocket hook for live price ticker or kline data.
 * Falls back gracefully when WebSocket is unavailable.
 */
export function useKlineWebSocket({
  symbol,
  timeframe,
  enabled = true,
  mode = "ticker",
}: UseKlineWebSocketOptions): WebSocketState {
  const [state, setState] = useState<WebSocketState>({
    livePrice: null,
    change24h: null,
    status: "disconnected",
    isLive: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!enabled || !symbol) return;

    const sym = symbol.toLowerCase();
    let wsUrl: string;

    if (mode === "ticker") {
      wsUrl = `wss://stream.binance.com:9443/ws/${sym}@ticker`;
    } else {
      const tfMap: Record<string, string> = {
        "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d",
      };
      const interval = tfMap[timeframe] ?? "1m";
      wsUrl = `wss://stream.binance.com:9443/ws/${sym}@kline_${interval}`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      setState(prev => ({ ...prev, status: "connecting" }));

      ws.onopen = () => {
        if (!mountedRef.current) return;
        reconnectCountRef.current = 0;
        setState(prev => ({ ...prev, status: "connected", isLive: true }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data as string);
          if (mode === "ticker") {
            const price = parseFloat(data.c);
            const change = parseFloat(data.P);
            if (!isNaN(price)) {
              setState(prev => ({
                ...prev,
                livePrice: price,
                change24h: isNaN(change) ? prev.change24h : change,
                isLive: true,
              }));
            }
          } else {
            const kline = data.k;
            if (kline) {
              const price = parseFloat(kline.c);
              if (!isNaN(price)) {
                setState(prev => ({ ...prev, livePrice: price, isLive: true }));
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setState(prev => ({ ...prev, status: "error", isLive: false }));
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setState(prev => ({ ...prev, status: "disconnected", isLive: false }));
        // Exponential backoff reconnect (max 30s)
        const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 30000);
        reconnectCountRef.current++;
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      };
    } catch {
      setState(prev => ({ ...prev, status: "error", isLive: false }));
    }
  }, [symbol, timeframe, enabled, mode]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return state;
}
