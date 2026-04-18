/**
 * CompositeAlertsPanel.tsx
 * Phase 4：多條件組合警報系統
 * 支援 AND/OR 邏輯組合多個條件，每個警報最多 5 個子條件
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { SUPPORTED_SYMBOLS } from "@shared/cryptoTypes";
import {
  Bell, BellRing, Plus, Trash2, RefreshCw, ChevronDown, ChevronUp,
  AlertTriangle, ToggleLeft, ToggleRight, Clock, Layers, X,
} from "lucide-react";
import { toast } from "sonner";

// ── 條件類型定義 ──
type AlertCondition =
  | "price_above" | "price_below"
  | "rsi_above" | "rsi_below"
  | "macd_cross_up" | "macd_cross_down"
  | "bb_squeeze" | "volume_spike"
  | "smc_bos" | "fvg_touch";

const CONDITION_LABELS: Record<AlertCondition, string> = {
  price_above:    "價格突破",
  price_below:    "價格跌破",
  rsi_above:      "RSI 超過",
  rsi_below:      "RSI 低於",
  macd_cross_up:  "MACD 金叉",
  macd_cross_down:"MACD 死叉",
  bb_squeeze:     "布林帶收縮",
  volume_spike:   "成交量爆增",
  smc_bos:        "SMC 結構突破",
  fvg_touch:      "觸及 FVG",
};

const CONDITIONS_WITH_VALUE: AlertCondition[] = ["price_above", "price_below", "rsi_above", "rsi_below"];

// ── 組合警報資料結構 ──
interface ConditionItem {
  condition: AlertCondition;
  value?: number;
}

interface CompositeAlert {
  id: string;
  symbol: string;
  label: string;
  enabled: boolean;
  logic: "AND" | "OR";
  conditions: ConditionItem[];
  lastTriggered?: number;
  matchedConditions?: string[];
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── 條件標籤顯示 ──
function ConditionBadge({ cond }: { cond: ConditionItem }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: "#1e1e1e", border: "1px solid #2a2a2a", color: "#aaa" }}>
      {CONDITION_LABELS[cond.condition]}
      {cond.value !== undefined && <span className="font-mono text-[#ffd740]">{cond.value}</span>}
    </span>
  );
}

// ── 新增條件子表單 ──
function ConditionForm({
  conditions,
  onChange,
}: {
  conditions: ConditionItem[];
  onChange: (c: ConditionItem[]) => void;
}) {
  const [newCond, setNewCond] = useState<AlertCondition>("rsi_above");
  const [newVal, setNewVal] = useState("");

  const addCond = () => {
    if (conditions.length >= 5) return;
    const needsVal = CONDITIONS_WITH_VALUE.includes(newCond);
    const val = needsVal ? parseFloat(newVal) : undefined;
    if (needsVal && (isNaN(val!) || val! <= 0)) return;
    onChange([...conditions, { condition: newCond, value: val }]);
    setNewVal("");
  };

  const removeCond = (idx: number) => {
    onChange(conditions.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      {/* 已加入的條件列表 */}
      {conditions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }}>
              <span className="text-[#aaa]">{CONDITION_LABELS[c.condition]}</span>
              {c.value !== undefined && <span className="font-mono text-[#ffd740]">{c.value}</span>}
              <button onClick={() => removeCond(i)} className="text-[#555] hover:text-[#ef5350] ml-0.5">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* 新增條件輸入 */}
      {conditions.length < 5 && (
        <div className="flex items-center gap-2">
          <select
            value={newCond}
            onChange={e => setNewCond(e.target.value as AlertCondition)}
            className="flex-1 text-xs px-2 py-1 rounded border bg-[#0d0d0d] text-[#ccc] focus:outline-none"
            style={{ borderColor: "#2a2a2a" }}
          >
            {Object.entries(CONDITION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {CONDITIONS_WITH_VALUE.includes(newCond) && (
            <input
              type="number"
              value={newVal}
              onChange={e => setNewVal(e.target.value)}
              placeholder={newCond.includes("rsi") ? "如：70" : "如：50000"}
              className="w-24 text-xs px-2 py-1 rounded border bg-[#0d0d0d] text-[#ccc] focus:outline-none"
              style={{ borderColor: "#2a2a2a" }}
            />
          )}
          <button
            onClick={addCond}
            disabled={conditions.length >= 5}
            className="text-xs px-2 py-1 rounded border transition-colors disabled:opacity-40"
            style={{ borderColor: "#ffd740", color: "#ffd740", background: "#ffd74015" }}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="text-[9px] text-[#444]">最多 5 個條件 · 已加入 {conditions.length}/5</div>
    </div>
  );
}

// ── 主元件 ──
export default function CompositeAlertsPanel() {
  const [alerts, setAlerts] = useState<CompositeAlert[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("composite_alerts") ?? "[]");
    } catch { return []; }
  });

  const [triggeredIds, setTriggeredIds] = useState<Set<string>>(new Set());
  const [triggeredMessages, setTriggeredMessages] = useState<{ id: string; label: string; message: string; time: number; matchedConditions: string[] }[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [symbolSearch, setSymbolSearch] = useState("");

  // 新增表單狀態
  const [newSymbol, setNewSymbol] = useState("BTCUSDT");
  const [newLabel, setNewLabel] = useState("");
  const [newLogic, setNewLogic] = useState<"AND" | "OR">("AND");
  const [newConditions, setNewConditions] = useState<ConditionItem[]>([]);

  const checkMutation = trpc.alerts.checkCompositeAlerts.useMutation();

  // 儲存到 localStorage
  const saveAlerts = useCallback((updated: CompositeAlert[]) => {
    setAlerts(updated);
    localStorage.setItem("composite_alerts", JSON.stringify(updated));
  }, []);

  const checkAlerts = useCallback(async () => {
    const enabledAlerts = alerts.filter(a => a.enabled && a.conditions.length > 0);
    if (enabledAlerts.length === 0) return;
    setIsChecking(true);
    try {
      const result = await checkMutation.mutateAsync({
        compositeAlerts: enabledAlerts.map(a => ({
          id: a.id,
          symbol: a.symbol,
          label: a.label,
          enabled: a.enabled,
          logic: a.logic,
          conditions: a.conditions,
        })),
      });
      const newTriggered = new Set<string>();
      const newMessages: typeof triggeredMessages = [];
      for (const t of result.triggered) {
        newTriggered.add(t.id);
        newMessages.push({
          id: t.id,
          label: t.label,
          message: t.message,
          time: t.time,
          matchedConditions: t.matchedConditions,
        });
        if (!triggeredIds.has(t.id)) {
          toast.warning(`🔔 ${t.label}`, {
            description: t.matchedConditions.join(" · "),
            duration: 10000,
          });
        }
      }
      setTriggeredIds(newTriggered);
      setTriggeredMessages(newMessages);
      setLastCheckTime(result.checked_at);
      const updated = alerts.map(a =>
        newTriggered.has(a.id)
          ? { ...a, lastTriggered: Date.now(), matchedConditions: newMessages.find(m => m.id === a.id)?.matchedConditions }
          : a
      );
      saveAlerts(updated);
    } catch (e) {
      console.error("組合警報檢查失敗:", e);
    } finally {
      setIsChecking(false);
    }
  }, [alerts, checkMutation, triggeredIds, saveAlerts]);

  // 每 60 秒自動檢查
  useEffect(() => {
    const interval = setInterval(checkAlerts, 60_000);
    return () => clearInterval(interval);
  }, [checkAlerts]);

  function addAlert() {
    if (!newLabel.trim() || newConditions.length === 0) return;
    const alert: CompositeAlert = {
      id: generateId(),
      symbol: newSymbol,
      label: newLabel,
      enabled: true,
      logic: newLogic,
      conditions: newConditions,
    };
    saveAlerts([alert, ...alerts]);
    setShowAddForm(false);
    setNewLabel("");
    setNewConditions([]);
    setNewLogic("AND");
    toast.success("組合警報已新增");
  }

  function removeAlert(id: string) {
    saveAlerts(alerts.filter(a => a.id !== id));
    setTriggeredIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    setTriggeredMessages(prev => prev.filter(m => m.id !== id));
  }

  function toggleAlert(id: string) {
    saveAlerts(alerts.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
  }

  // 動態幣種搜索過濾
  const filteredSymbols = symbolSearch
    ? SUPPORTED_SYMBOLS.filter(s =>
        s.value.toLowerCase().includes(symbolSearch.toLowerCase()) ||
        s.label.toLowerCase().includes(symbolSearch.toLowerCase())
      )
    : SUPPORTED_SYMBOLS;

  const triggeredCount = triggeredIds.size;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
        <div className="flex items-center gap-2">
          {triggeredCount > 0 ? (
            <BellRing className="w-4 h-4 text-[#ffd740] animate-pulse" />
          ) : (
            <Layers className="w-4 h-4 text-[#888]" />
          )}
          <span className="text-sm font-semibold text-[#ccc]">多條件組合警報</span>
          {triggeredCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-xs font-bold"
              style={{ background: "#ffd74020", color: "#ffd740", border: "1px solid #ffd74030" }}>
              {triggeredCount} 觸發
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastCheckTime && (
            <div className="flex items-center gap-1 text-[10px] text-[#555]">
              <Clock className="w-3 h-3" />
              <span>{new Date(lastCheckTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </div>
          )}
          <button
            onClick={checkAlerts}
            disabled={isChecking}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs border transition-colors disabled:opacity-50"
            style={{ borderColor: "#2a2a2a", color: "#888", background: "#161616" }}
          >
            <RefreshCw className={`w-3 h-3 ${isChecking ? "animate-spin" : ""}`} />
            立即檢查
          </button>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors"
            style={{ background: "#ffd740", color: "#000" }}
          >
            <Plus className="w-3 h-3" />
            新增組合警報
          </button>
        </div>
      </div>

      {/* 新增表單 */}
      {showAddForm && (
        <div className="px-4 py-3 border-b space-y-3" style={{ borderColor: "#1e1e1e", background: "#0a0a0a" }}>
          <div className="text-xs font-semibold text-[#ccc]">設定組合警報</div>

          {/* 幣種選擇（含搜索）*/}
          <div>
            <label className="text-[10px] text-[#666] mb-1 block">幣種</label>
            <div className="relative">
              <input
                value={symbolSearch}
                onChange={e => setSymbolSearch(e.target.value)}
                placeholder="搜索幣種..."
                className="w-full text-xs px-2 py-1.5 rounded border bg-[#0d0d0d] text-[#ccc] focus:outline-none mb-1"
                style={{ borderColor: "#2a2a2a" }}
              />
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {filteredSymbols.map(s => (
                  <button
                    key={s.value}
                    onClick={() => { setNewSymbol(s.value); setSymbolSearch(""); }}
                    className="text-[10px] px-2 py-0.5 rounded border transition-colors"
                    style={{
                      borderColor: newSymbol === s.value ? "#ffd740" : "#2a2a2a",
                      color: newSymbol === s.value ? "#ffd740" : "#888",
                      background: newSymbol === s.value ? "#ffd74015" : "transparent",
                    }}
                  >
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 警報名稱 */}
          <div>
            <label className="text-[10px] text-[#666] mb-1 block">警報名稱</label>
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="如：BTC 超買 + MACD 死叉"
              className="w-full text-xs px-2 py-1.5 rounded border bg-[#0d0d0d] text-[#ccc] focus:outline-none"
              style={{ borderColor: "#2a2a2a" }}
            />
          </div>

          {/* 邏輯選擇 */}
          <div>
            <label className="text-[10px] text-[#666] mb-1 block">觸發邏輯</label>
            <div className="flex gap-2">
              {(["AND", "OR"] as const).map(logic => (
                <button
                  key={logic}
                  onClick={() => setNewLogic(logic)}
                  className="flex-1 text-xs py-1.5 rounded border transition-colors font-semibold"
                  style={{
                    borderColor: newLogic === logic ? "#ffd740" : "#2a2a2a",
                    color: newLogic === logic ? "#ffd740" : "#666",
                    background: newLogic === logic ? "#ffd74015" : "transparent",
                  }}
                >
                  {logic === "AND" ? "AND（全部符合）" : "OR（任一符合）"}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-[#444] mt-1">
              {newLogic === "AND"
                ? "所有條件同時成立才觸發警報（更精確）"
                : "任一條件成立即觸發警報（更靈敏）"}
            </div>
          </div>

          {/* 條件設定 */}
          <div>
            <label className="text-[10px] text-[#666] mb-1 block">觸發條件（1-5 個）</label>
            <ConditionForm conditions={newConditions} onChange={setNewConditions} />
          </div>

          {/* 提交按鈕 */}
          <div className="flex gap-2">
            <button
              onClick={addAlert}
              disabled={!newLabel.trim() || newConditions.length === 0}
              className="px-4 py-1.5 rounded text-xs font-semibold transition-colors disabled:opacity-40"
              style={{ background: "#ffd740", color: "#000" }}
            >
              確認新增
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-1.5 rounded text-xs border transition-colors"
              style={{ borderColor: "#2a2a2a", color: "#666" }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 觸發訊息 */}
      {triggeredMessages.length > 0 && (
        <div className="px-4 py-2 border-b" style={{ borderColor: "#1e1e1e", background: "#1a1a00" }}>
          <div className="text-[10px] font-semibold text-[#ffd740] mb-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> 已觸發組合警報
          </div>
          <div className="space-y-1.5">
            {triggeredMessages.map(m => (
              <div key={m.id} className="rounded p-2" style={{ background: "#1e1a00", border: "1px solid #3a3000" }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#ffd740]">{m.label}</span>
                  <span className="text-[9px] text-[#666]">{new Date(m.time).toLocaleTimeString("zh-TW")}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {m.matchedConditions.map((c, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded"
                      style={{ background: "#4caf5020", color: "#4caf50", border: "1px solid #4caf5030" }}>
                      ✓ {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 警報列表 */}
      <div className="divide-y" style={{ borderColor: "#1e1e1e" }}>
        {alerts.length === 0 ? (
          <div className="text-center py-10 text-[#555]">
            <Layers className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">尚無組合警報</p>
            <p className="text-[10px] mt-1 text-[#444]">點擊「新增組合警報」設定多條件觸發規則</p>
          </div>
        ) : alerts.map(alert => {
          const isTriggered = triggeredIds.has(alert.id);
          return (
            <AlertRow
              key={alert.id}
              alert={alert}
              isTriggered={isTriggered}
              onToggle={() => toggleAlert(alert.id)}
              onRemove={() => removeAlert(alert.id)}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t text-[10px] text-[#444] flex items-center gap-3"
        style={{ borderColor: "#1e1e1e", background: "#0d0d0d" }}>
        <span>{alerts.filter(a => a.enabled).length}/{alerts.length} 個警報啟用</span>
        <span>·</span>
        <span>每 60 秒自動檢查</span>
        <span>·</span>
        <span>支援 AND/OR 邏輯組合</span>
      </div>
    </div>
  );
}

// ── 警報列表項目 ──
function AlertRow({
  alert, isTriggered, onToggle, onRemove,
}: {
  alert: CompositeAlert;
  isTriggered: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const symbolInfo = SUPPORTED_SYMBOLS.find(s => s.value === alert.symbol);

  return (
    <div
      className="px-4 py-3 transition-colors"
      style={{
        background: isTriggered ? "#1a1a00" : "transparent",
        borderBottom: "1px solid #1e1e1e",
        opacity: alert.enabled ? 1 : 0.5,
      }}
    >
      <div className="flex items-center gap-3">
        {/* 狀態圖示 */}
        {isTriggered ? (
          <BellRing className="w-4 h-4 text-[#ffd740] flex-shrink-0 animate-pulse" />
        ) : (
          <Bell className={`w-4 h-4 flex-shrink-0 ${alert.enabled ? "text-[#555]" : "text-[#333]"}`} />
        )}

        {/* 主要資訊 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#ccc] truncate">{alert.label}</span>
            {isTriggered && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: "#ffd74020", color: "#ffd740", border: "1px solid #ffd74030" }}>
                觸發
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#555]">
            <span>{symbolInfo?.icon ?? ""} {alert.symbol.replace("USDT", "/USDT")}</span>
            <span className="px-1 rounded text-[9px]"
              style={{
                background: alert.logic === "AND" ? "#3b82f620" : "#f59e0b20",
                color: alert.logic === "AND" ? "#3b82f6" : "#f59e0b",
              }}>
              {alert.logic}
            </span>
            <span>{alert.conditions.length} 個條件</span>
            {alert.lastTriggered && (
              <span className="text-[#444]">上次：{new Date(alert.lastTriggered).toLocaleTimeString("zh-TW")}</span>
            )}
          </div>
        </div>

        {/* 展開按鈕 */}
        <button onClick={() => setExpanded(v => !v)} className="p-1 text-[#444] hover:text-[#888] transition-colors">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {/* 開關 */}
        <button onClick={onToggle} className="p-1 hover:opacity-80 transition-opacity">
          {alert.enabled
            ? <ToggleRight className="w-5 h-5 text-[#ffd740]" />
            : <ToggleLeft className="w-5 h-5 text-[#444]" />
          }
        </button>

        {/* 刪除 */}
        <button onClick={onRemove} className="p-1 text-[#444] hover:text-[#ef5350] transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 展開條件詳情 */}
      {expanded && (
        <div className="mt-2 pl-7">
          <div className="text-[9px] text-[#555] mb-1">觸發條件（{alert.logic} 邏輯）：</div>
          <div className="flex flex-wrap gap-1">
            {alert.conditions.map((c, i) => (
              <ConditionBadge key={i} cond={c} />
            ))}
          </div>
          {alert.matchedConditions && alert.matchedConditions.length > 0 && (
            <div className="mt-1.5">
              <div className="text-[9px] text-[#4caf50] mb-0.5">已匹配條件：</div>
              <div className="flex flex-wrap gap-1">
                {alert.matchedConditions.map((c, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: "#4caf5015", color: "#4caf50", border: "1px solid #4caf5030" }}>
                    ✓ {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
