/**
 * AlertsPanel.tsx
 * 自訂警報系統 — 設定複合條件警報，即時檢查觸發狀態
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  Bell, BellRing, Plus, Trash2, RefreshCw, CheckCircle2,
  AlertTriangle, ToggleLeft, ToggleRight, Clock,
} from "lucide-react";
import { toast } from "sonner";

type AlertCondition =
  | "price_above" | "price_below"
  | "rsi_above" | "rsi_below"
  | "macd_cross_up" | "macd_cross_down"
  | "bb_squeeze" | "volume_spike"
  | "smc_bos" | "fvg_touch";

interface AlertItem {
  id: string;
  symbol: string;
  condition: AlertCondition;
  value?: number;
  enabled: boolean;
  label: string;
  lastTriggered?: number;
}

const CONDITION_LABELS: Record<AlertCondition, string> = {
  price_above: "價格突破",
  price_below: "價格跌破",
  rsi_above: "RSI 超過",
  rsi_below: "RSI 低於",
  macd_cross_up: "MACD 金叉",
  macd_cross_down: "MACD 死叉",
  bb_squeeze: "布林帶收縮",
  volume_spike: "成交量爆增",
  smc_bos: "SMC 結構突破",
  fvg_touch: "觸及 FVG",
};

const CONDITIONS_WITH_VALUE: AlertCondition[] = ["price_above", "price_below", "rsi_above", "rsi_below"];

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT"];

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function AlertsPanel() {
  const [alerts, setAlerts] = useState<AlertItem[]>([
    { id: generateId(), symbol: "BTCUSDT", condition: "rsi_above", value: 70, enabled: true, label: "BTC RSI 超買警報" },
    { id: generateId(), symbol: "BTCUSDT", condition: "rsi_below", value: 30, enabled: true, label: "BTC RSI 超賣警報" },
    { id: generateId(), symbol: "ETHUSDT", condition: "macd_cross_up", enabled: true, label: "ETH MACD 金叉" },
    { id: generateId(), symbol: "BTCUSDT", condition: "bb_squeeze", enabled: true, label: "BTC 布林帶收縮" },
  ]);
  const [triggeredIds, setTriggeredIds] = useState<Set<string>>(new Set());
  const [triggeredMessages, setTriggeredMessages] = useState<{ id: string; message: string; time: number }[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);

  // New alert form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState("BTCUSDT");
  const [newCondition, setNewCondition] = useState<AlertCondition>("price_above");
  const [newValue, setNewValue] = useState<string>("");
  const [newLabel, setNewLabel] = useState("");

  const checkMutation = trpc.alerts.checkAlerts.useMutation();

  const checkAlerts = useCallback(async () => {
    const enabledAlerts = alerts.filter(a => a.enabled);
    if (enabledAlerts.length === 0) return;
    setIsChecking(true);
    try {
      const result = await checkMutation.mutateAsync({
        alerts: enabledAlerts.map(a => ({
          id: a.id,
          symbol: a.symbol,
          condition: a.condition,
          value: a.value,
          enabled: a.enabled,
        })),
      });
      const newTriggered = new Set<string>();
      const newMessages: { id: string; message: string; time: number }[] = [];
      for (const t of result.triggered) {
        newTriggered.add(t.id);
        newMessages.push({ id: t.id, message: t.message, time: t.time });
        // Show toast for newly triggered alerts
        if (!triggeredIds.has(t.id)) {
          toast.warning(t.message, {
            description: `${new Date(t.time).toLocaleTimeString("zh-TW")} 觸發`,
            duration: 8000,
          });
        }
      }
      setTriggeredIds(newTriggered);
      setTriggeredMessages(newMessages);
      setLastCheckTime(result.checked_at);
      // Update lastTriggered time for triggered alerts
      setAlerts(prev => prev.map(a => newTriggered.has(a.id) ? { ...a, lastTriggered: Date.now() } : a));
    } catch (e) {
      console.error("警報檢查失敗:", e);
    } finally {
      setIsChecking(false);
    }
  }, [alerts, checkMutation, triggeredIds]);

  // Auto-check every 60 seconds
  useEffect(() => {
    const interval = setInterval(checkAlerts, 60_000);
    return () => clearInterval(interval);
  }, [checkAlerts]);

  function addAlert() {
    if (!newLabel.trim()) return;
    const needsValue = CONDITIONS_WITH_VALUE.includes(newCondition);
    const value = needsValue ? parseFloat(newValue) : undefined;
    if (needsValue && (isNaN(value!) || value! <= 0)) return;
    setAlerts(prev => [...prev, {
      id: generateId(),
      symbol: newSymbol,
      condition: newCondition,
      value,
      enabled: true,
      label: newLabel,
    }]);
    setShowAddForm(false);
    setNewLabel("");
    setNewValue("");
    toast.success("警報已新增");
  }

  function removeAlert(id: string) {
    setAlerts(prev => prev.filter(a => a.id !== id));
    setTriggeredIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    setTriggeredMessages(prev => prev.filter(m => m.id !== id));
  }

  function toggleAlert(id: string) {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
  }

  const triggeredCount = triggeredIds.size;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80">
        <div className="flex items-center gap-2">
          {triggeredCount > 0 ? (
            <BellRing className="w-4 h-4 text-yellow-400 animate-pulse" />
          ) : (
            <Bell className="w-4 h-4 text-primary" />
          )}
          <span className="font-semibold text-sm">自訂警報系統</span>
          {triggeredCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-400 border border-yellow-400/30">
              {triggeredCount} 觸發
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastCheckTime && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>上次檢查 {new Date(lastCheckTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </div>
          )}
          <button
            onClick={checkAlerts}
            disabled={isChecking}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isChecking ? "animate-spin" : ""}`} />
            立即檢查
          </button>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3 h-3" />
            新增警報
          </button>
        </div>
      </div>

      {/* Add Alert Form */}
      {showAddForm && (
        <div className="px-4 py-3 border-b border-border bg-background/40">
          <div className="text-xs font-semibold text-foreground mb-2">新增警報條件</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">幣種</label>
              <select
                value={newSymbol}
                onChange={e => setNewSymbol(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
              >
                {SYMBOLS.map(s => <option key={s} value={s}>{s.replace("USDT", "/USDT")}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">條件</label>
              <select
                value={newCondition}
                onChange={e => setNewCondition(e.target.value as AlertCondition)}
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
              >
                {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            {CONDITIONS_WITH_VALUE.includes(newCondition) && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">數值</label>
                <input
                  type="number"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  placeholder={newCondition.includes("rsi") ? "如：70" : "如：50000"}
                  className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
                />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">警報名稱</label>
              <input
                type="text"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="輸入警報名稱..."
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={addAlert}
              disabled={!newLabel.trim()}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              確認新增
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-xs bg-muted text-muted-foreground rounded hover:bg-accent transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Triggered Messages */}
      {triggeredMessages.length > 0 && (
        <div className="px-4 py-2 border-b border-border bg-yellow-400/5">
          <div className="text-xs font-semibold text-yellow-400 mb-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> 已觸發警報
          </div>
          <div className="space-y-1">
            {triggeredMessages.map(m => (
              <div key={m.id} className="flex items-center gap-2 text-xs">
                <BellRing className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                <span className="text-foreground">{m.message}</span>
                <span className="text-muted-foreground ml-auto">{new Date(m.time).toLocaleTimeString("zh-TW")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alert List */}
      <div className="divide-y divide-border/50">
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>尚無警報，點擊「新增警報」開始設定</p>
          </div>
        ) : alerts.map(alert => {
          const isTriggered = triggeredIds.has(alert.id);
          return (
            <div
              key={alert.id}
              className={`flex items-center gap-3 px-4 py-3 transition-colors ${isTriggered ? "bg-yellow-400/5" : alert.enabled ? "" : "opacity-50"}`}
            >
              {/* Status icon */}
              {isTriggered ? (
                <BellRing className="w-4 h-4 text-yellow-400 flex-shrink-0 animate-pulse" />
              ) : (
                <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${alert.enabled ? "text-muted-foreground" : "text-muted-foreground/30"}`} />
              )}
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{alert.label}</span>
                  {isTriggered && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 flex-shrink-0">觸發</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-mono">{alert.symbol.replace("USDT", "/USDT")}</span>
                  <span className="mx-1">·</span>
                  <span>{CONDITION_LABELS[alert.condition]}</span>
                  {alert.value !== undefined && <span className="ml-1 font-mono">{alert.value}</span>}
                  {alert.lastTriggered && (
                    <span className="ml-2 text-muted-foreground/60">
                      上次觸發：{new Date(alert.lastTriggered).toLocaleTimeString("zh-TW")}
                    </span>
                  )}
                </div>
              </div>
              {/* Toggle */}
              <button onClick={() => toggleAlert(alert.id)} className="flex-shrink-0 p-1 hover:bg-accent rounded transition-colors">
                {alert.enabled ? (
                  <ToggleRight className="w-5 h-5 text-primary" />
                ) : (
                  <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                )}
              </button>
              {/* Delete */}
              <button onClick={() => removeAlert(alert.id)} className="flex-shrink-0 p-1 hover:bg-destructive/10 rounded transition-colors">
                <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border bg-muted/10 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{alerts.filter(a => a.enabled).length}/{alerts.length} 個警報啟用</span>
        <span>·</span>
        <span>每 60 秒自動檢查</span>
        <span>·</span>
        <span>觸發時顯示通知</span>
      </div>
    </div>
  );
}
