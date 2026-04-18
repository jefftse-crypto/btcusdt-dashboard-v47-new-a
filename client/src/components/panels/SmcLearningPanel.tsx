/**
 * SmcLearningPanel — SMC 學習資源中心
 *
 * 設計風格：與 dashboard 一致的深色終端風格
 * 內容來源：SMC_Learning_Guide.md / SMC_Step_by_Step_Learning_Plan.md / SMC_Deployment_and_Learning_Guide.md
 *
 * 結構：
 *  1. 三階段學習路徑視覺化（快速索引）
 *  2. 頻道推薦卡片（含評分與標籤）
 *  3. 分階段學習計劃詳細內容（可折疊）
 *  4. 新環境部署指南（TradingView 設定、筆記工具）
 */

import { useState } from "react";
import {
  BookOpen, ChevronDown, ChevronRight, ExternalLink,
  Star, AlertTriangle, CheckCircle, XCircle, Wrench,
  GraduationCap, TrendingUp, Zap, Target, Monitor, FileText
} from "lucide-react";

// ─── 資料定義 ───────────────────────────────────────────────────────────────

const CHANNELS = [
  {
    name: "Lewis Kelly",
    url: "https://www.youtube.com/@Lewiskelly8",
    stars: 4,
    tags: ["新手", "進階", "免費"],
    status: "recommend",
    description: "被譽為「勞模」，提供大量免費影片，內容講解容易懂，是學習 SMC 的優質免費資源。",
    stage: 1,
  },
  {
    name: "SMC Gelo",
    url: "https://www.youtube.com/@smcgelo",
    stars: 4,
    tags: ["新手", "進階", "免費"],
    status: "recommend",
    description: "提供較多免費影片，講解方式容易理解，適合大眾學習，可搭配 Lewis Kelly 使用。",
    stage: 1,
  },
  {
    name: "liquidity university",
    url: "https://www.youtube.com/results?search_query=liquidity+university+SMC",
    stars: 3,
    tags: ["新手", "進階", "系統化"],
    status: "recommend",
    description: "課程內容相對容易理解，適合想要系統學習的交易者，將零散概念整合為可執行策略。",
    stage: 2,
  },
  {
    name: "Photon Trading",
    url: "https://www.youtube.com/c/photontrading",
    stars: 4,
    tags: ["進階", "機械化策略"],
    status: "recommend",
    description: "課程體系完整，網上資源豐富。推薦深入研究其「機械化策略」與「日內偏見」教學。",
    stage: 2,
  },
  {
    name: "Phantom Trading",
    url: "https://www.youtube.com/phantomtrading",
    stars: 4,
    tags: ["進階", "完整體系"],
    status: "recommend",
    description: "課程體系比較完整，網上資源豐富，適合想要深入研究 SMC 體系的交易者。",
    stage: 2,
  },
  {
    name: "Waqar Asim (LIT)",
    url: "https://www.youtube.com/@WaqarAsim.",
    stars: 5,
    tags: ["高階", "Inducement", "強烈推薦"],
    status: "highly_recommend",
    description: "核心是 Liquidity Inducement Theorem (LIT)。雖不標榜 SMC，但做法相似。主播最強烈推薦，是區分普通與頂尖交易者的關鍵。",
    stage: 3,
  },
  {
    name: "tradinghub 3.0",
    url: "#",
    stars: 1,
    tags: ["新手", "名詞參考"],
    status: "caution",
    description: "僅建議小白入門用於名詞解釋參考。評價指出本人較少實際交易，策略回測勝率極低，4.0 版本更被評為「純純搞笑」。",
    stage: 0,
  },
  {
    name: "The Trading Geek",
    url: "#",
    stars: 1,
    tags: ["不推薦"],
    status: "not_recommend",
    description: "知名大網紅，但影片內容被評價為「看了和沒看差不多」，缺乏實質幫助。",
    stage: 0,
  },
];

const STAGES = [
  {
    id: 1,
    title: "第一階段：基礎概念建立",
    subtitle: "Foundation",
    icon: "📚",
    color: "#f59e0b",
    channels: ["Lewis Kelly", "SMC Gelo"],
    topics: [
      {
        title: "市場結構 (Market Structure)",
        items: [
          "學習如何正確標記高低點",
          "BOS (Break of Structure)：順勢突破結構，確認趨勢延續",
          "CHOCH (Change of Character)：結構轉變，預示潛在趨勢反轉",
        ],
      },
      {
        title: "供需失衡區 (Order Blocks, OB)",
        items: [
          "識別機構大資金建倉留下的 K 線密集區",
          "如何區分有效與無效的 Order Block",
        ],
      },
      {
        title: "公允價值缺口 (Fair Value Gaps, FVG)",
        items: [
          "識別價格快速移動造成的跳空缺口",
          "理解價格回補 FVG 的特性，作為潛在入場點或目標位",
        ],
      },
    ],
    advice: "Lewis Kelly 與 SMC Gelo 皆以「簡化複雜概念」見長。建議先觀看 Lewis Kelly 的長篇基礎教學，搭配 SMC Gelo 的短影片加深印象。此階段重點在於「看懂圖表」，不急於實盤交易。",
    practice: {
      action: "在 TradingView 上打開 EURUSD 或 NAS100 的 1 小時圖",
      exercise: "純粹練習尋找並使用矩形工具標記明顯的 Order Blocks 和 FVG，使用趨勢線標記近期的 BOS 和 CHOCH",
      verify: "將標記與 Lewis Kelly 或 SMC Gelo 影片中的範例進行比對",
    },
  },
  {
    id: 2,
    title: "第二階段：系統化交易策略",
    subtitle: "Systematization",
    icon: "⚙️",
    color: "#3b82f6",
    channels: ["liquidity university", "Photon Trading", "Phantom Trading"],
    topics: [
      {
        title: "流動性概念 (Liquidity Concepts)",
        items: [
          "理解 Equal Highs (EQHs) / Equal Lows (EQLs) 與趨勢線流動性",
          "學習機構如何「獵取」散戶的止損單（Liquidity Sweep）",
        ],
      },
      {
        title: "多時間框架分析 (MTFA)",
        items: [
          "在大級別（4H/日線）確定方向與主要流動性目標",
          "在小級別（15M/5M）尋找精確的入場點",
        ],
      },
      {
        title: "進場模型 (Entry Models)",
        items: [
          "Risk Entry（風險進場）vs Confirmation Entry（確認進場）的區別與應用",
          "結合 OB、FVG 與流動性獵取，制定具體的 S.O.P",
        ],
      },
    ],
    advice: "Photon Trading 與 Phantom Trading 提供非常完整的課程體系。建議深入研究 Photon Trading 關於「機械化策略」與「日內偏見」的教學，有助於排除交易時的主觀情緒，建立客觀的交易規則。",
    practice: {
      action: "開始進行多時間框架分析 (MTFA)",
      exercise: "在 4 小時圖確定大方向 → 在 15 分鐘圖尋找流動性獵取 → 在 5 分鐘或 1 分鐘圖尋找 CHOCH 和入場的 OB/FVG",
      verify: "使用 TradingView 的「回放 (Replay)」功能或手動向左滾動圖表，測試進場模型勝率",
    },
  },
  {
    id: 3,
    title: "第三階段：高階流動性引誘",
    subtitle: "Advanced Inducement",
    icon: "🎯",
    color: "#10b981",
    channels: ["Waqar Asim (LIT)"],
    topics: [
      {
        title: "流動性引誘定理 (LIT - Liquidity Inducement Theorem)",
        items: [
          "理解為何傳統 SMC 概念（單純的 OB 或 FVG）經常失效（SMC Traps）",
          "學習區分「真正的流動性獵取」與「誘騙 (Inducement)」",
        ],
      },
      {
        title: "SMC 陷阱 (SMC Traps)",
        items: [
          "機構如何利用散戶對 SMC 的認知，故意製造看似完美的 OB 或 BOS 來誘騙散戶",
          "隨後反向獵取散戶的止損，完成流動性收割",
        ],
      },
      {
        title: "高階進場邏輯",
        items: [
          "只在價格完成「誘騙」並獵取流動性後才尋找入場機會",
          "將 Inducement 作為確認趨勢真實性的必要條件",
        ],
      },
    ],
    advice: "Waqar Asim 的教學直指 SMC 的痛點。建議仔細觀看其《Why I STOPPED Trading Smart Money (Complete SMC Traps Guide)》等核心影片。在這一階段，需要打破第一階段建立的部分固有認知，學會站在「做市商」的角度思考。",
    practice: {
      action: "專注於尋找「SMC 陷阱」",
      exercise: "在圖表上尋找那些看起來非常完美的 OB，但最終被價格突破的區域。分析為什麼這些 OB 會失效？是否只是為了引誘散戶做多/做空？",
      verify: "將觀察記錄在筆記軟體中，並對照 Waqar Asim (LIT) 的理論，深化對市場真實運作機制的理解",
    },
  },
];

const TRADINGVIEW_TOOLS = [
  { name: "趨勢線 (Trend Line)", use: "標記 BOS、CHOCH" },
  { name: "水平射線 (Horizontal Ray)", use: "標記 Equal Highs/Lows 等流動性池" },
  { name: "矩形 (Rectangle)", use: "標記 Order Blocks (OB) 和 Fair Value Gaps (FVG)" },
  { name: "多頭/空頭部位 (Long/Short Position)", use: "計算風險報酬比 (Risk/Reward Ratio)" },
  { name: "斐波那契回撤 (Fibonacci Retracement)", use: "自訂參數（0, 0.5, 1）尋找 Premium/Discount 區域" },
];

const NOTE_STRUCTURE = [
  { area: "理論學習區", desc: "記錄從 YouTube 影片學到的概念（如 LIT 的 Inducement 邏輯）" },
  { area: "圖表復盤區 (Backtesting)", desc: "存放歷史圖表的分析截圖，標註成功與失敗的案例" },
  { area: "實盤日誌區 (Forward Testing)", desc: "記錄每筆交易的進場理由、情緒狀態與最終結果" },
];

// ─── 子元件 ─────────────────────────────────────────────────────────────────

function StarRating({ count, max = 5 }: { count: number; max?: number }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          size={11}
          className={i < count ? "fill-[#ffd740] text-[#ffd740]" : "text-[#333]"}
        />
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "highly_recommend") return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-[#10b981] bg-[#10b98120] px-2 py-0.5 rounded">
      <CheckCircle size={9} /> 非常推薦
    </span>
  );
  if (status === "recommend") return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-[#3b82f6] bg-[#3b82f620] px-2 py-0.5 rounded">
      <CheckCircle size={9} /> 推薦
    </span>
  );
  if (status === "caution") return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-[#f59e0b] bg-[#f59e0b20] px-2 py-0.5 rounded">
      <AlertTriangle size={9} /> 謹慎
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-[#ef5350] bg-[#ef535020] px-2 py-0.5 rounded">
      <XCircle size={9} /> 不推薦
    </span>
  );
}

function StageBadge({ stage }: { stage: number }) {
  if (stage === 0) return null;
  const colors: Record<number, string> = { 1: "#f59e0b", 2: "#3b82f6", 3: "#10b981" };
  const labels: Record<number, string> = { 1: "第一階段", 2: "第二階段", 3: "第三階段" };
  return (
    <span
      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
      style={{ background: `${colors[stage]}20`, color: colors[stage], border: `1px solid ${colors[stage]}40` }}
    >
      {labels[stage]}
    </span>
  );
}

function CollapsibleSection({
  title, icon, defaultOpen = false, children
}: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "#111", border: "1px solid #222" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#1a1a1a] transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-[#ccc]">
          {icon}
          {title}
        </div>
        {open ? <ChevronDown size={14} className="text-[#555]" /> : <ChevronRight size={14} className="text-[#555]" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-[#1e1e1e]">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── 主元件 ─────────────────────────────────────────────────────────────────

export function SmcLearningPanel() {
  const [activeStage, setActiveStage] = useState<number | null>(null);

  return (
    <div className="space-y-4 pb-6">

      {/* ── 標題列 ── */}
      <div className="flex items-center gap-3 pb-1 border-b border-[#1e1e1e]">
        <GraduationCap size={18} className="text-[#3b82f6]" />
        <div>
          <div className="text-sm font-bold text-[#e0e0e0]">SMC 學習資源中心</div>
          <div className="text-[10px] text-[#555]">根據 Jerry 愛交易頻道推薦整理 · Smart Money Concepts</div>
        </div>
      </div>

      {/* ── 三階段學習路徑視覺化 ── */}
      <div>
        <div className="text-xs font-semibold text-[#888] mb-3 flex items-center gap-1.5">
          <TrendingUp size={12} />
          三階段學習路徑
        </div>
        <div className="grid grid-cols-3 gap-2">
          {STAGES.map((stage, idx) => (
            <button
              key={stage.id}
              onClick={() => setActiveStage(activeStage === stage.id ? null : stage.id)}
              className="relative rounded-lg p-3 text-left transition-all hover:scale-[1.02]"
              style={{
                background: activeStage === stage.id ? `${stage.color}15` : "#111",
                border: `1px solid ${activeStage === stage.id ? stage.color + "60" : "#222"}`,
              }}
            >
              {/* 連接箭頭 */}
              {idx < STAGES.length - 1 && (
                <div className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-[#333] text-xs">›</div>
              )}
              <div className="text-lg mb-1">{stage.icon}</div>
              <div className="text-[10px] font-bold" style={{ color: stage.color }}>
                第 {stage.id} 階段
              </div>
              <div className="text-[11px] font-semibold text-[#ccc] mt-0.5 leading-tight">
                {stage.subtitle}
              </div>
              <div className="text-[9px] text-[#555] mt-1">
                {stage.channels.join(" · ")}
              </div>
            </button>
          ))}
        </div>

        {/* 展開的階段詳細內容 */}
        {activeStage !== null && (() => {
          const stage = STAGES.find(s => s.id === activeStage)!;
          return (
            <div
              className="mt-3 rounded-lg p-4 space-y-3"
              style={{ background: "#0d0d0d", border: `1px solid ${stage.color}30` }}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{stage.icon}</span>
                <div>
                  <div className="text-sm font-bold" style={{ color: stage.color }}>{stage.title}</div>
                  <div className="text-[10px] text-[#555]">推薦頻道：{stage.channels.join("、")}</div>
                </div>
              </div>

              {/* 核心主題 */}
              <div className="space-y-2">
                {stage.topics.map((topic, ti) => (
                  <div key={ti} className="rounded p-2.5" style={{ background: "#111", border: "1px solid #1e1e1e" }}>
                    <div className="text-[11px] font-semibold text-[#ccc] mb-1.5">{topic.title}</div>
                    <ul className="space-y-1">
                      {topic.items.map((item, ii) => (
                        <li key={ii} className="flex items-start gap-1.5 text-[10px] text-[#777]">
                          <span style={{ color: stage.color }} className="mt-0.5 flex-shrink-0">▸</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* 實戰練習 */}
              <div className="rounded p-2.5" style={{ background: `${stage.color}08`, border: `1px solid ${stage.color}25` }}>
                <div className="text-[10px] font-semibold mb-1.5" style={{ color: stage.color }}>
                  <Target size={10} className="inline mr-1" />實戰練習
                </div>
                <div className="space-y-1 text-[10px] text-[#777]">
                  <div><span className="text-[#888]">行動：</span>{stage.practice.action}</div>
                  <div><span className="text-[#888]">練習：</span>{stage.practice.exercise}</div>
                  <div><span className="text-[#888]">驗證：</span>{stage.practice.verify}</div>
                </div>
              </div>

              {/* 學習建議 */}
              <div className="text-[10px] text-[#666] leading-relaxed border-l-2 pl-2.5" style={{ borderColor: stage.color + "60" }}>
                {stage.advice}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── 頻道推薦卡片 ── */}
      <CollapsibleSection title="推薦頻道總覽" icon={<BookOpen size={14} className="text-[#3b82f6]" />} defaultOpen>
        <div className="space-y-2 mt-2">
          {CHANNELS.map((ch) => (
            <div
              key={ch.name}
              className="rounded p-3"
              style={{
                background: "#0d0d0d",
                border: `1px solid ${ch.status === "not_recommend" ? "#ef535025" : ch.status === "caution" ? "#f59e0b25" : "#1e1e1e"}`,
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-[#ddd]">{ch.name}</span>
                  <StageBadge stage={ch.stage} />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <StatusBadge status={ch.status} />
                  {ch.url !== "#" && (
                    <a
                      href={ch.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mb-1.5">
                <StarRating count={ch.stars} />
                <div className="flex gap-1 flex-wrap">
                  {ch.tags.map(tag => (
                    <span key={tag} className="text-[9px] text-[#555] bg-[#1a1a1a] px-1.5 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-[#666] leading-relaxed">{ch.description}</div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* ── TradingView 設定指南 ── */}
      <CollapsibleSection title="TradingView 設定指南" icon={<Monitor size={14} className="text-[#f59e0b]" />}>
        <div className="mt-3 space-y-3">
          <div className="text-[10px] text-[#666] leading-relaxed">
            SMC 交易者最依賴的工具是圖表分析平台。強烈建議使用{" "}
            <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer"
              className="text-[#3b82f6] hover:underline">TradingView</a>。
            建議隱藏不必要的指標（如 RSI、MACD 等），保持圖表整潔。
          </div>
          <div>
            <div className="text-[10px] font-semibold text-[#888] mb-2">常用繪圖工具（加入最愛工具列）</div>
            <div className="space-y-1.5">
              {TRADINGVIEW_TOOLS.map((tool) => (
                <div key={tool.name} className="flex items-start gap-2 rounded p-2" style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
                  <Wrench size={10} className="text-[#f59e0b] mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-[10px] font-semibold text-[#ccc]">{tool.name}</div>
                    <div className="text-[9px] text-[#555]">{tool.use}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* ── 學習筆記工具 ── */}
      <CollapsibleSection title="學習筆記與復盤工具" icon={<FileText size={14} className="text-[#10b981]" />}>
        <div className="mt-3 space-y-3">
          <div className="text-[10px] text-[#666] leading-relaxed">
            交易日誌與復盤是 SMC 學習中不可或缺的一環。推薦使用{" "}
            <a href="https://www.notion.so/" target="_blank" rel="noopener noreferrer" className="text-[#3b82f6] hover:underline">Notion</a>、{" "}
            <a href="https://obsidian.md/" target="_blank" rel="noopener noreferrer" className="text-[#3b82f6] hover:underline">Obsidian</a>{" "}
            或 Evernote。這些工具支援 Markdown 語法，且方便插入圖表截圖。
          </div>
          <div>
            <div className="text-[10px] font-semibold text-[#888] mb-2">建議筆記結構</div>
            <div className="space-y-1.5">
              {NOTE_STRUCTURE.map((note) => (
                <div key={note.area} className="rounded p-2.5" style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
                  <div className="text-[10px] font-semibold text-[#10b981] mb-0.5">{note.area}</div>
                  <div className="text-[9px] text-[#555]">{note.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* ── SMC 核心概念速覽 ── */}
      <CollapsibleSection title="SMC 核心概念速覽" icon={<Zap size={14} className="text-[#ffd740]" />}>
        <div className="mt-3 space-y-2">
          {[
            {
              term: "Order Blocks (OB)",
              def: "價格快速大幅移動前形成的 K 線密集區域，代表大資金集中建倉或平倉的成本區。",
              color: "#3b82f6",
            },
            {
              term: "流動性池 (Liquidity Pools)",
              def: "大資金需要對手盤來完成大額交易，因此會將價格推向聚集大量散戶止損單或限價單的區域以「獵取」流動性。",
              color: "#f59e0b",
            },
            {
              term: "市場結構 (Market Structure)",
              def: "識別趨勢轉變信號，如「突破結構」(BOS) 和「結構轉變」(CHOCH)。",
              color: "#10b981",
            },
            {
              term: "公允價值缺口 (Fair Value Gaps, FVG)",
              def: "快速行情中形成的 K 線跳空區域，價格常會返回填補這些缺口。",
              color: "#a78bfa",
            },
            {
              term: "Inducement (流動性引誘)",
              def: "機構故意製造看似完美的 OB 或 BOS 來誘騙散戶入場，隨後反向獵取他們的止損，完成流動性收割。這是 LIT 理論的核心。",
              color: "#ef5350",
            },
          ].map((concept) => (
            <div key={concept.term} className="rounded p-2.5" style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
              <div className="text-[10px] font-bold mb-0.5" style={{ color: concept.color }}>{concept.term}</div>
              <div className="text-[10px] text-[#666] leading-relaxed">{concept.def}</div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* ── 結語 ── */}
      <div className="rounded-lg p-3 text-[10px] text-[#555] leading-relaxed" style={{ background: "#0a0a0a", border: "1px solid #1a1a1a" }}>
        <span className="text-[#3b82f6] font-semibold">SMC 學習心法：</span>{" "}
        SMC 是一段從「見山是山（基礎結構）」到「見山不是山（SMC 陷阱）」，最後「見山又是山（流動性引誘）」的過程。
        請務必按照三個階段循序漸進，並配合大量的圖表復盤（Backtesting），才能真正將這些知識轉化為交易利器。
        保持圖表整潔、堅持記錄交易日誌，是掌握這套語言的關鍵。
      </div>

    </div>
  );
}

export default SmcLearningPanel;
