import { useState } from "react";
import { ALL_WIDGET_DEFINITIONS } from "@shared/cryptoTypes";
import { Button } from "@/components/ui/button";
import { X, Check } from "lucide-react";

interface Props {
  currentIds: string[];
  onSave: (ids: string[]) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  chart: "圖表",
  indicator: "技術指標",
  analysis: "分析",
  strategy: "策略",
  summary: "摘要",
  onchain: "鏈上數據",
  news: "新聞",
};

export function WidgetManager({ currentIds, onSave, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentIds));

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = () => {
    // Preserve order: keep existing order for already-selected, append new ones
    const ordered = ALL_WIDGET_DEFINITIONS
      .filter(w => selected.has(w.id))
      .map(w => w.id);
    onSave(ordered);
    onClose();
  };

  // Group by category
  const categories = Array.from(new Set(ALL_WIDGET_DEFINITIONS.map(w => w.category)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <div className="text-sm font-semibold text-foreground">管理指標卡片</div>
            <div className="text-xs text-muted-foreground mt-0.5">已選擇 {selected.size} 個卡片</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {categories.map(cat => {
            const widgets = ALL_WIDGET_DEFINITIONS.filter(w => w.category === cat);
            return (
              <div key={cat}>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {CATEGORY_LABELS[cat] ?? cat}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {widgets.map(w => {
                    const isSelected = selected.has(w.id);
                    return (
                      <button
                        key={w.id}
                        onClick={() => toggle(w.id)}
                        className={`relative text-left p-3 rounded-lg border transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        {isSelected && (
                          <div className="absolute top-2 right-2">
                            <Check className="w-3 h-3 text-primary" />
                          </div>
                        )}
                        <div className="text-xs font-medium pr-4">{w.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{w.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            取消
          </Button>
          <Button size="sm" onClick={handleSave} className="text-xs bg-primary hover:bg-primary/90">
            <Check className="w-3 h-3 mr-1.5" />
            儲存設定
          </Button>
        </div>
      </div>
    </div>
  );
}
