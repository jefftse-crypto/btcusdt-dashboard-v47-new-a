/**
 * ChampionTraderPanel — Champion Trader 頻道學習中心
 *
 * 資料來源：Shi Hun / @championtrader YouTube 頻道
 * 設計風格：與 Dashboard 一致的深色終端風格
 *
 * 結構：
 *  1. 頻道簡介與核心學習邏輯
 *  2. 三層知識框架地圖
 *  3. 精選影片卡片（含 YouTube 連結）
 *  4. 7 天學習計劃（可折疊）
 *  5. 交易框架檢查表（4 大模組）
 *  6. 四個核心問題（學習提示）
 */
import { useState } from "react";
import {
  BookOpen, ChevronDown, ChevronRight, ExternalLink,
  CheckCircle, AlertTriangle, Target, TrendingUp,
  Zap, Shield, BarChart2, Layers, PlayCircle,
  Brain, ListChecks, HelpCircle, Award
} from "lucide-react";

// ─── 精選影片資料 ────────────────────────────────────────────────────────────
const FEATURED_VIDEOS = [
  {
    title: "布林指標搭配這1招，竟抱出7倍獲利！只看1個顏色，就能抱住大波段",
    url: "https://www.youtube.com/watch?v=lLjQicK95FA",
    tags: ["布林帶", "波段持有", "出場管理"],
    layer: 2,
    desc: "布林帶顏色規則 + 波段持有技巧，解決「賣太早」痛點。",
  },
  {
    title: "【重磅教學】股災怎麼撿便宜？1招看穿真正有效的支撐，不再越買越跌",
    url: "https://www.youtube.com/watch?v=MmYF9PNz-lY",
    tags: ["支撐壓力", "抄底過濾", "真假支撐"],
    layer: 2,
    desc: "真假支撐識別框架，解決「越買越跌」的抄底失敗問題。",
  },
  {
    title: "【RSI+KDJ】獲利狂飆1179%！神級 RJ 指標，比 RSI 快、比 KDJ 穩！",
    url: "https://www.youtube.com/watch?v=example3",
    tags: ["RSI", "KD", "指標優化"],
    layer: 1,
    desc: "RSI 與 KDJ 的升級版組合，減少雜訊、提早發現訊號。",
  },
  {
    title: "【3步驟跟單主力】不追高、不亂買，抓準 FVG 起漲區直接上車",
    url: "https://www.youtube.com/watch?v=2VeMETRW9Is",
    tags: ["FVG", "主力跟單", "起漲點"],
    layer: 3,
    desc: "FVG 公平價值缺口 + 主力發動點識別，3 步驟進場邏輯。",
  },
  {
    title: "RSI這樣改，15天暴賺66%｜比原版買更低賣更高",
    url: "https://www.youtube.com/watch?v=example5",
    tags: ["RSI", "改良指標", "進場優化"],
    layer: 1,
    desc: "改良版 RSI 參數設定，讓進場點更早、更低風險。",
  },
  {
    title: "【跟單主力】散戶反將一軍的「抄底密技」，反吃聰明錢豆腐",
    url: "https://www.youtube.com/watch?v=example6",
    tags: ["聰明錢", "SMC", "抄底"],
    layer: 3,
    desc: "從主力視角理解抄底條件，避免被洗出場後立刻反彈。",
  },
  {
    title: "【MACD大升級】神改版專抓主力發動點，不再怕被洗，爽抱大趨勢",
    url: "https://www.youtube.com/watch?v=example7",
    tags: ["MACD", "改良指標", "趨勢"],
    layer: 1,
    desc: "改良版 MACD 設定，專門識別主力發動點，減少假訊號。",
  },
  {
    title: "【揭密】止損底牌被主力看光？機構用「流動性」獵殺，散戶靠這2招保命再反殺！",
    url: "https://www.youtube.com/watch?v=dS6py6Wu4ZY",
    tags: ["流動性", "止損獵殺", "ICT"],
    layer: 3,
    desc: "流動性獵殺機制解析，學會把止損放在不明顯的位置。",
  },
  {
    title: "【僅3步驟】美股、幣圈及黃金崩盤前早有訊號？用這招提前逃頂，再精準抄底吃大魚！",
    url: "https://www.youtube.com/watch?v=example9",
    tags: ["逃頂", "抄底", "多市場"],
    layer: 2,
    desc: "跨市場通用的崩盤前訊號識別與逃頂 + 抄底 SOP。",
  },
  {
    title: "每天只看這根 K 線，不用指標，一眼看出短線機會",
    url: "https://www.youtube.com/watch?v=example10",
    tags: ["K線", "價格行為", "短線"],
    layer: 1,
    desc: "單根 K 線判讀法，純價格行為找短線機會，不依賴指標。",
  },
  {
    title: "【震撼真相】世界冠軍4個月45倍？2560戰法真正的來源與實戰 SOP",
    url: "https://www.youtube.com/watch?v=example11",
    tags: ["SOP", "實戰", "方法論"],
    layer: 2,
    desc: "2560 戰法解析，完整進場 / 止損 / 出場 SOP 拆解。",
  },
  {
    title: "別急著賣！大跌還沒破這條線先別慌，破了真的要快！",
    url: "https://www.youtube.com/watch?v=example12",
    tags: ["均線", "出場管理", "波段"],
    layer: 2,
    desc: "關鍵均線守住就不賣，破了立刻出場的波段持倉邏輯。",
  },
];

// ─── 三層知識框架 ────────────────────────────────────────────────────────────
const KNOWLEDGE_LAYERS = [
  {
    id: 1,
    label: "第一層：基礎圖表語言",
    icon: "📚",
    color: "#f59e0b",
    subtitle: "Foundation",
    desc: "解決「圖怎麼看、趨勢怎麼看、訊號怎麼看」",
    topics: ["K 線型態", "均線系統", "量價關係", "MACD", "RSI / KD", "布林通道"],
    keyPoint: "先看趨勢，再看位置；先看結構，再看訊號。",
  },
  {
    id: 2,
    label: "第二層：執行策略",
    icon: "⚡",
    color: "#3b82f6",
    subtitle: "Execution",
    desc: "解決「什麼時候進、什麼時候出、怎麼抱住」",
    topics: ["起漲點識別", "支撐壓力", "短線切入", "波段持有", "出場管理", "真假抄底"],
    keyPoint: "把痛點變成規則：追高 / 亂抄底 / 被洗 / 賣太早，每個都有對應的過濾條件。",
  },
  {
    id: 3,
    label: "第三層：結構框架",
    icon: "🎯",
    color: "#8b5cf6",
    subtitle: "Structure",
    desc: "解決「為什麼這個位置更有意義、為什麼會被洗」",
    topics: ["SMC / ICT", "FVG 公平價值缺口", "流動性獵殺", "主力成本區", "價格行為", "BOS / CHoCH"],
    keyPoint: "訊號不是獨立事件，要問：這個位置有沒有流動性被掃過、結構是否確認？",
  },
];

// ─── 7 天學習計劃 ────────────────────────────────────────────────────────────
const STUDY_PLAN_7D = [
  { day: 1, theme: "頻道地圖與基礎框架", task: "瀏覽頻道首頁與播放列表，理解三層結構", output: "列出你目前最缺的 3 個能力" },
  { day: 2, theme: "K 線與均線基礎", task: "看 K 線入門與均線相關內容，理解趨勢、反轉、支撐", output: "寫下 5 句自己的 K 線 / 均線判讀語言" },
  { day: 3, theme: "MACD、RSI、KD、布林", task: "比較各指標適合什麼情境，不要幻想一招通吃", output: "做一張對照表，寫清楚每個指標的用途與限制" },
  { day: 4, theme: "支撐壓力與量價關係", task: "看「真正有效的支撐」「越買越跌」類影片", output: "用 3 張歷史圖表練習標出有效與無效支撐" },
  { day: 5, theme: "短線節奏與抱單能力", task: "看短線、波段、出場管理相關影片", output: "寫出自己的進場、停損、出場三條規則" },
  { day: 6, theme: "主力邏輯與 FVG / 流動性", task: "接觸主力、FVG、流動性與止損獵殺等進階概念", output: "用自己的話解釋 FVG、流動性與主力吃貨各是什麼" },
  { day: 7, theme: "小結與系統化", task: "回頭整理 6 天學到的東西，只保留能說清楚、能複述的", output: "完成一頁「我的交易框架 1.0」" },
];

// ─── 交易框架檢查表 ──────────────────────────────────────────────────────────
const FRAMEWORK_MODULES = [
  {
    id: "market_read",
    label: "市場閱讀模組",
    icon: <BarChart2 size={14} />,
    color: "#f59e0b",
    items: [
      { label: "確認趨勢方向（上升 / 下降 / 盤整）", key: "trend" },
      { label: "標出關鍵支撐壓力位", key: "snr" },
      { label: "量價關係是否配合", key: "volume" },
      { label: "均線排列是否支持方向", key: "ema" },
    ],
  },
  {
    id: "signal",
    label: "訊號模組",
    icon: <Zap size={14} />,
    color: "#3b82f6",
    items: [
      { label: "選定 1-2 個熟悉的指標（MACD 或 RSI / 布林）", key: "indicator" },
      { label: "訊號出現在有意義的位置（非隨機）", key: "position" },
      { label: "多個時間框架方向一致（MTF 確認）", key: "mtf" },
      { label: "無明顯反向訊號干擾", key: "no_conflict" },
    ],
  },
  {
    id: "structure",
    label: "結構過濾模組",
    icon: <Layers size={14} />,
    color: "#8b5cf6",
    items: [
      { label: "FVG / Order Block 是否存在", key: "fvg" },
      { label: "流動性是否已被掃除（假突破 / 假跌破）", key: "liquidity" },
      { label: "BOS / CHoCH 結構確認", key: "bos" },
      { label: "主力成本區 / 真假支撐判斷", key: "smart_money" },
    ],
  },
  {
    id: "execution",
    label: "執行與風控模組",
    icon: <Shield size={14} />,
    color: "#10b981",
    items: [
      { label: "進場點明確（不追高、不亂抄底）", key: "entry" },
      { label: "停損位置設定（不放在明顯位置）", key: "sl" },
      { label: "盈虧比 ≥ 2:1", key: "rr" },
      { label: "連續虧損 3 筆停手檢查", key: "drawdown" },
    ],
  },
];

// ─── 四個核心問題 ────────────────────────────────────────────────────────────
const CORE_QUESTIONS = [
  {
    q: "這招在什麼市場環境最有效？",
    hint: "趨勢盤、盤整盤、反彈盤，還是恐慌盤？",
    icon: <TrendingUp size={14} />,
    color: "#f59e0b",
  },
  {
    q: "這招最容易在哪裡失效？",
    hint: "假突破、震盪洗盤、量能不足，還是結構未完成？",
    icon: <AlertTriangle size={14} />,
    color: "#ef4444",
  },
  {
    q: "如果我做錯了，怎麼退？",
    hint: "停損放哪裡，什麼情況直接離場？",
    icon: <Shield size={14} />,
    color: "#3b82f6",
  },
  {
    q: "就算做對了，怎麼拿住？",
    hint: "分批出、移動停利，還是等結構破壞再走？",
    icon: <Target size={14} />,
    color: "#10b981",
  },
];

// ─── 標籤顏色 ────────────────────────────────────────────────────────────────
const TAG_COLORS: Record<string, string> = {
  "布林帶": "#f59e0b", "MACD": "#3b82f6", "RSI": "#8b5cf6",
  "KD": "#8b5cf6", "K線": "#f59e0b", "均線": "#f59e0b",
  "FVG": "#8b5cf6", "SMC": "#8b5cf6", "ICT": "#8b5cf6",
  "流動性": "#8b5cf6", "聰明錢": "#8b5cf6", "主力跟單": "#8b5cf6",
  "支撐壓力": "#3b82f6", "真假支撐": "#3b82f6",
  "波段持有": "#10b981", "出場管理": "#10b981", "止損獵殺": "#ef4444",
  "起漲點": "#10b981", "抄底過濾": "#10b981", "逃頂": "#ef4444",
  "抄底": "#10b981", "短線": "#3b82f6", "趨勢": "#3b82f6",
  "指標優化": "#f59e0b", "改良指標": "#f59e0b", "進場優化": "#10b981",
  "SOP": "#10b981", "實戰": "#10b981", "方法論": "#8b5cf6",
  "多市場": "#3b82f6", "價格行為": "#8b5cf6",
};

const LAYER_COLORS = ["#f59e0b", "#3b82f6", "#8b5cf6"];
const LAYER_LABELS = ["基礎", "執行", "結構"];

// ─── 主組件 ──────────────────────────────────────────────────────────────────
export function ChampionTraderPanel() {
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [activeSection, setActiveSection] = useState<"framework" | "videos" | "plan" | "checklist" | "questions">("framework");
  const [videoFilter, setVideoFilter] = useState<number>(0); // 0 = all

  const toggleCheck = (key: string) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const totalChecks = Object.values(checklist).filter(Boolean).length;
  const maxChecks = FRAMEWORK_MODULES.reduce((s, m) => s + m.items.length, 0);

  const filteredVideos = videoFilter === 0
    ? FEATURED_VIDEOS
    : FEATURED_VIDEOS.filter(v => v.layer === videoFilter);

  return (
    <div className="p-3 space-y-3 text-sm" style={{ color: "#e2e8f0" }}>
      {/* ── 頻道標題 ── */}
      <div className="rounded-lg p-3" style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)", border: "1px solid #f59e0b33" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Award size={16} style={{ color: "#f59e0b" }} />
              <span className="font-bold text-base" style={{ color: "#f59e0b" }}>Champion Trader 學習中心</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44" }}>
                Shi Hun / @championtrader
              </span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "#94a3b8" }}>
              華語散戶技術分析教學頻道，566 支影片，核心邏輯：
              <span style={{ color: "#f59e0b" }}>「基礎圖表語言 → 規則化執行 → 結構過濾 → 風控思維」</span>
            </p>
          </div>
          <a
            href="https://www.youtube.com/@championtrader"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded"
            style={{ background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444", whiteSpace: "nowrap" }}
          >
            <PlayCircle size={12} /> 前往頻道
          </a>
        </div>

        {/* 核心一句話 */}
        <div className="mt-2 p-2 rounded text-xs italic" style={{ background: "#f59e0b11", borderLeft: "3px solid #f59e0b", color: "#fbbf24" }}>
          先用基礎圖表語言讀懂市場，再用規則化訊號決定動作，最後用結構邏輯過濾假機會，並用風控與出場規則守住結果。
        </div>
      </div>

      {/* ── 分區導航 ── */}
      <div className="flex gap-1 flex-wrap">
        {[
          { id: "framework", label: "知識框架", icon: <Layers size={12} /> },
          { id: "videos", label: "精選影片", icon: <PlayCircle size={12} /> },
          { id: "plan", label: "7天計劃", icon: <BookOpen size={12} /> },
          { id: "checklist", label: "交易檢查表", icon: <ListChecks size={12} /> },
          { id: "questions", label: "核心問題", icon: <HelpCircle size={12} /> },
        ].map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id as typeof activeSection)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all"
            style={{
              background: activeSection === s.id ? "#f59e0b" : "#1e293b",
              color: activeSection === s.id ? "#0f172a" : "#94a3b8",
              border: `1px solid ${activeSection === s.id ? "#f59e0b" : "#334155"}`,
              fontWeight: activeSection === s.id ? 700 : 400,
            }}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════ */}
      {/* 知識框架 */}
      {/* ══════════════════════════════════════════════════════ */}
      {activeSection === "framework" && (
        <div className="space-y-2">
          <div className="text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
            三層遞進式知識結構 — 按順序學習，不要亂跳
          </div>
          {KNOWLEDGE_LAYERS.map((layer, idx) => (
            <div key={layer.id} className="rounded-lg p-3" style={{ background: "#1e293b", border: `1px solid ${layer.color}44` }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{layer.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm" style={{ color: layer.color }}>{layer.label}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${layer.color}22`, color: layer.color }}>
                      {layer.subtitle}
                    </span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "#64748b" }}>{layer.desc}</div>
                </div>
                <span className="text-lg font-bold" style={{ color: `${layer.color}66` }}>0{idx + 1}</span>
              </div>

              {/* 主題標籤 */}
              <div className="flex flex-wrap gap-1 mb-2">
                {layer.topics.map(t => (
                  <span key={t} className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#0f172a", color: "#94a3b8", border: "1px solid #334155" }}>
                    {t}
                  </span>
                ))}
              </div>

              {/* 關鍵結論 */}
              <div className="text-xs p-2 rounded" style={{ background: `${layer.color}11`, borderLeft: `2px solid ${layer.color}`, color: "#cbd5e1" }}>
                💡 {layer.keyPoint}
              </div>
            </div>
          ))}

          {/* 箭頭連接 */}
          <div className="text-center text-xs" style={{ color: "#475569" }}>
            ↑ 按此順序學習，每一層都是下一層的地基 ↑
          </div>

          {/* 頻道最終判斷 */}
          <div className="rounded-lg p-3 mt-2" style={{ background: "#1e293b", border: "1px solid #334155" }}>
            <div className="font-semibold text-xs mb-2" style={{ color: "#f59e0b" }}>📋 學習這個頻道時的關鍵警覺</div>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-start gap-2">
                <CheckCircle size={12} className="mt-0.5 flex-shrink-0" style={{ color: "#10b981" }} />
                <div className="text-xs" style={{ color: "#94a3b8" }}>
                  <span style={{ color: "#10b981" }}>值得學：</span>規則化思維、結構過濾、圖表語言、執行導向
                </div>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" style={{ color: "#ef4444" }} />
                <div className="text-xs" style={{ color: "#94a3b8" }}>
                  <span style={{ color: "#ef4444" }}>必須警惕：</span>把簡化規則當成萬能公式、忽視失效條件、沉迷「1招暴賺」標題
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* 精選影片 */}
      {/* ══════════════════════════════════════════════════════ */}
      {activeSection === "videos" && (
        <div className="space-y-2">
          {/* 篩選器 */}
          <div className="flex gap-1 items-center">
            <span className="text-xs" style={{ color: "#64748b" }}>篩選：</span>
            {[
              { val: 0, label: "全部" },
              { val: 1, label: "基礎" },
              { val: 2, label: "執行" },
              { val: 3, label: "結構" },
            ].map(f => (
              <button
                key={f.val}
                onClick={() => setVideoFilter(f.val)}
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  background: videoFilter === f.val ? LAYER_COLORS[f.val - 1] || "#334155" : "#1e293b",
                  color: videoFilter === f.val ? "#0f172a" : "#94a3b8",
                  border: `1px solid ${videoFilter === f.val ? LAYER_COLORS[f.val - 1] || "#334155" : "#334155"}`,
                }}
              >
                {f.label}
              </button>
            ))}
            <span className="text-xs ml-auto" style={{ color: "#475569" }}>{filteredVideos.length} 支</span>
          </div>

          {/* 影片卡片 */}
          <div className="space-y-2">
            {filteredVideos.map((v, i) => (
              <div key={i} className="rounded-lg p-2.5" style={{ background: "#1e293b", border: "1px solid #334155" }}>
                <div className="flex items-start gap-2">
                  <div
                    className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-xs font-bold mt-0.5"
                    style={{ background: `${LAYER_COLORS[v.layer - 1]}22`, color: LAYER_COLORS[v.layer - 1] }}
                  >
                    {v.layer}
                  </div>
                  <div className="flex-1 min-w-0">
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium leading-tight hover:underline flex items-start gap-1"
                      style={{ color: "#e2e8f0" }}
                    >
                      <span className="flex-1">{v.title}</span>
                      <ExternalLink size={10} className="flex-shrink-0 mt-0.5" style={{ color: "#475569" }} />
                    </a>
                    <p className="text-xs mt-1" style={{ color: "#64748b" }}>{v.desc}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {v.tags.map(tag => (
                        <span
                          key={tag}
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            background: `${TAG_COLORS[tag] || "#334155"}22`,
                            color: TAG_COLORS[tag] || "#94a3b8",
                            border: `1px solid ${TAG_COLORS[tag] || "#334155"}44`,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                      <span
                        className="text-xs px-1.5 py-0.5 rounded ml-auto"
                        style={{ background: `${LAYER_COLORS[v.layer - 1]}22`, color: LAYER_COLORS[v.layer - 1] }}
                      >
                        {LAYER_LABELS[v.layer - 1]}層
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* 7 天學習計劃 */}
      {/* ══════════════════════════════════════════════════════ */}
      {activeSection === "plan" && (
        <div className="space-y-2">
          <div className="text-xs" style={{ color: "#64748b" }}>
            7 天版：快速建立頻道學習骨架。目標不是看完所有影片，而是建立可執行的判斷框架。
          </div>
          {STUDY_PLAN_7D.map(day => (
            <div key={day.day} className="rounded-lg overflow-hidden" style={{ border: "1px solid #334155" }}>
              <button
                onClick={() => setExpandedDay(expandedDay === day.day ? null : day.day)}
                className="w-full flex items-center gap-2 p-2.5 text-left"
                style={{ background: expandedDay === day.day ? "#1e293b" : "#0f172a" }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44" }}
                >
                  D{day.day}
                </div>
                <div className="flex-1">
                  <div className="text-xs font-semibold" style={{ color: "#e2e8f0" }}>{day.theme}</div>
                </div>
                {expandedDay === day.day
                  ? <ChevronDown size={14} style={{ color: "#475569" }} />
                  : <ChevronRight size={14} style={{ color: "#475569" }} />
                }
              </button>
              {expandedDay === day.day && (
                <div className="p-2.5 space-y-2" style={{ background: "#1e293b", borderTop: "1px solid #334155" }}>
                  <div className="flex items-start gap-2">
                    <BookOpen size={12} className="mt-0.5 flex-shrink-0" style={{ color: "#3b82f6" }} />
                    <div className="text-xs" style={{ color: "#94a3b8" }}>
                      <span style={{ color: "#3b82f6" }}>學習任務：</span>{day.task}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle size={12} className="mt-0.5 flex-shrink-0" style={{ color: "#10b981" }} />
                    <div className="text-xs" style={{ color: "#94a3b8" }}>
                      <span style={{ color: "#10b981" }}>當天產出：</span>{day.output}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* 30 天版說明 */}
          <div className="rounded-lg p-2.5" style={{ background: "#1e293b", border: "1px solid #334155" }}>
            <div className="text-xs font-semibold mb-1" style={{ color: "#8b5cf6" }}>📅 30 天版（進階）</div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {[
                { week: "第 1 週", theme: "基礎語言建立", color: "#f59e0b" },
                { week: "第 2 週", theme: "進出場與節奏", color: "#3b82f6" },
                { week: "第 3 週", theme: "結構與主力", color: "#8b5cf6" },
                { week: "第 4 週", theme: "回測與個人系統", color: "#10b981" },
              ].map(w => (
                <div key={w.week} className="p-1.5 rounded" style={{ background: "#0f172a", border: `1px solid ${w.color}33` }}>
                  <div style={{ color: w.color }}>{w.week}</div>
                  <div style={{ color: "#64748b" }}>{w.theme}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* 交易框架檢查表 */}
      {/* ══════════════════════════════════════════════════════ */}
      {activeSection === "checklist" && (
        <div className="space-y-2">
          {/* 進度條 */}
          <div className="rounded-lg p-2.5" style={{ background: "#1e293b", border: "1px solid #334155" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold" style={{ color: "#e2e8f0" }}>交易前檢查進度</span>
              <span className="text-xs font-bold" style={{ color: totalChecks === maxChecks ? "#10b981" : totalChecks >= maxChecks * 0.75 ? "#f59e0b" : "#ef4444" }}>
                {totalChecks} / {maxChecks}
              </span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "#0f172a" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(totalChecks / maxChecks) * 100}%`,
                  background: totalChecks === maxChecks ? "#10b981" : totalChecks >= maxChecks * 0.75 ? "#f59e0b" : "#3b82f6",
                }}
              />
            </div>
            {totalChecks === maxChecks && (
              <div className="text-xs mt-1 text-center" style={{ color: "#10b981" }}>✅ 所有條件確認，可以考慮進場</div>
            )}
            {totalChecks > 0 && totalChecks < maxChecks && (
              <div className="text-xs mt-1 text-center" style={{ color: "#f59e0b" }}>⚠️ 尚有 {maxChecks - totalChecks} 個條件未確認</div>
            )}
          </div>

          {FRAMEWORK_MODULES.map(mod => (
            <div key={mod.id} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${mod.color}33` }}>
              <div className="flex items-center gap-2 p-2" style={{ background: `${mod.color}11` }}>
                <span style={{ color: mod.color }}>{mod.icon}</span>
                <span className="text-xs font-semibold" style={{ color: mod.color }}>{mod.label}</span>
                <span className="text-xs ml-auto" style={{ color: "#475569" }}>
                  {mod.items.filter(item => checklist[`${mod.id}_${item.key}`]).length}/{mod.items.length}
                </span>
              </div>
              <div className="p-2 space-y-1" style={{ background: "#1e293b" }}>
                {mod.items.map(item => {
                  const key = `${mod.id}_${item.key}`;
                  const checked = !!checklist[key];
                  return (
                    <button
                      key={key}
                      onClick={() => toggleCheck(key)}
                      className="w-full flex items-center gap-2 p-1.5 rounded text-left transition-all"
                      style={{ background: checked ? `${mod.color}11` : "transparent" }}
                    >
                      <div
                        className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                        style={{ border: `1px solid ${checked ? mod.color : "#334155"}`, background: checked ? `${mod.color}33` : "transparent" }}
                      >
                        {checked && <CheckCircle size={10} style={{ color: mod.color }} />}
                      </div>
                      <span className="text-xs" style={{ color: checked ? "#e2e8f0" : "#64748b" }}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* 重置按鈕 */}
          <button
            onClick={() => setChecklist({})}
            className="w-full text-xs py-1.5 rounded"
            style={{ background: "#1e293b", color: "#475569", border: "1px solid #334155" }}
          >
            重置所有勾選
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* 四個核心問題 */}
      {/* ══════════════════════════════════════════════════════ */}
      {activeSection === "questions" && (
        <div className="space-y-2">
          <div className="text-xs" style={{ color: "#64748b" }}>
            無論學的是 MACD、RSI、布林、FVG 還是流動性，每學一招都要能回答這四個問題，才算真正「學會」。
          </div>

          {CORE_QUESTIONS.map((q, i) => (
            <div key={i} className="rounded-lg p-3" style={{ background: "#1e293b", border: `1px solid ${q.color}33` }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: `${q.color}22`, color: q.color }}>
                  {q.icon}
                </div>
                <span className="text-xs font-semibold" style={{ color: q.color }}>問題 {i + 1}</span>
              </div>
              <div className="text-sm font-medium mb-1" style={{ color: "#e2e8f0" }}>{q.q}</div>
              <div className="text-xs p-2 rounded" style={{ background: `${q.color}11`, color: "#94a3b8", borderLeft: `2px solid ${q.color}` }}>
                {q.hint}
              </div>
            </div>
          ))}

          {/* 學習建議 */}
          <div className="rounded-lg p-3" style={{ background: "#1e293b", border: "1px solid #334155" }}>
            <div className="text-xs font-semibold mb-2" style={{ color: "#f59e0b" }}>🎯 如果是我，我會這樣取捨</div>
            <div className="space-y-1.5 text-xs" style={{ color: "#94a3b8" }}>
              <div className="flex items-start gap-2">
                <span style={{ color: "#f59e0b" }}>主線 1：</span>
                <span>基礎圖表 + 支撐壓力 + 量價（最穩的地基）</span>
              </div>
              <div className="flex items-start gap-2">
                <span style={{ color: "#3b82f6" }}>主線 2：</span>
                <span>結構邏輯 + 一種熟悉的指標（FVG 搭配 MACD / RSI）</span>
              </div>
              <div className="flex items-start gap-2">
                <span style={{ color: "#10b981" }}>原則：</span>
                <span>太多招式只會增加猶豫。把頻道當資料庫，最後只沉澱出自己能重複執行的 1-2 套規則。</span>
              </div>
            </div>
          </div>

          {/* 實戰化步驟 */}
          <div className="rounded-lg p-3" style={{ background: "#1e293b", border: "1px solid #334155" }}>
            <div className="text-xs font-semibold mb-2" style={{ color: "#8b5cf6" }}>🚀 學完後的實戰化步驟</div>
            <div className="space-y-1.5">
              {[
                { step: "步驟一", text: "只保留 1-2 套最能理解的方法", color: "#f59e0b" },
                { step: "步驟二", text: "為每套方法寫清楚進場、停損、出場條件", color: "#3b82f6" },
                { step: "步驟三", text: "找至少 20 段歷史走勢做驗證（回測）", color: "#8b5cf6" },
                { step: "步驟四", text: "記錄失效場景與連續虧損應對方式", color: "#10b981" },
              ].map(s => (
                <div key={s.step} className="flex items-center gap-2 text-xs">
                  <span className="px-1.5 py-0.5 rounded text-xs font-bold" style={{ background: `${s.color}22`, color: s.color }}>
                    {s.step}
                  </span>
                  <span style={{ color: "#94a3b8" }}>{s.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 連結到 Dashboard 回測 */}
          <div className="rounded-lg p-2.5" style={{ background: "#0f3460", border: "1px solid #3b82f644" }}>
            <div className="flex items-center gap-2 text-xs">
              <Brain size={12} style={{ color: "#3b82f6" }} />
              <span style={{ color: "#94a3b8" }}>
                步驟三的回測，可直接使用 Dashboard 的
                <span style={{ color: "#3b82f6" }}>「回測記錄」</span>與
                <span style={{ color: "#f59e0b" }}>「組合信號」</span>面板進行歷史驗證。
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
