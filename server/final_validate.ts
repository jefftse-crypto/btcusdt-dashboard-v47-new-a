import { fetchCandles, type Candle } from "./analysis.js";
import { runBacktest, type BacktestStrategy, type BacktestTrade } from "./backtest.js";

const STRATEGIES: { key: string; strategy: BacktestStrategy; family: string; tp: number; sl: number; }[] = [
  { key: "pa_v4_focus",            strategy: "pa",             family: "pa",              tp: 0.5, sl: 1.95 },
  { key: "hwr_b_guarded",          strategy: "hwr_model_b",    family: "trend_pullback",  tp: 2,   sl: 1.5  },
  { key: "cannonball_guarded",     strategy: "cannonball",     family: "structure",       tp: 2,   sl: 1.5  },
];
function calcRsi14(closes: number[], idx: number): number { if (idx < 14) return 50; let g=0,l=0; for(let i=idx-13;i<=idx;i++){const d=closes[i]-closes[i-1]; if(d>0)g+=d; else l-=d;} const rs=l>0?(g/14)/(l/14):100; return 100-100/(1+rs);}
function calcEma(v: number[], p: number): number[] { const e=[v[0]]; const k=2/(p+1); for(let i=1;i<v.length;i++) e.push(v[i]*k+e[i-1]*(1-k)); return e; }
function calcAtr(c: Candle[], idx: number, p=14): number { const s=Math.max(1,idx-p+1); let sum=0,n=0; for(let i=s;i<=idx;i++){const h=c[i].high,l=c[i].low,pc=c[i-1].close; sum+=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)); n++;} return n>0?sum/n:c[idx].high-c[idx].low;}

function evalChecks(t: BacktestTrade, c1h: Candle[], c4h: Candle[], family: string) {
  const idx = c1h.findIndex(c => c.time >= t.entry_time);
  if (idx < 50) return { core: [], pa: [], rsi4h: 50 };
  const n = idx + 1;
  const cs = c1h.slice(0, n);
  const cl = cs.map(c => c.close);
  const last = cs[n-1];
  const dir = t.direction;
  const core: string[] = [];
  const pa: string[] = [];
  const utc = new Date(t.entry_time*1000).getUTCHours();
  if (!(utc>=7&&utc<22)) core.push("C1");
  let rsi4h = 50;
  const c4hUp = c4h.filter(c => c.time <= t.entry_time);
  if (c4hUp.length>=25) {
    const cl4 = c4hUp.map(c=>c.close);
    const e4 = calcEma(cl4,20);
    const last4 = e4[e4.length-1], prev4 = e4[e4.length-2];
    const slopeOk = dir==="long"? (last4-prev4)>=0 : (last4-prev4)<=0;
    const posOk = dir==="long"? cl4[cl4.length-1]>=last4*0.995 : cl4[cl4.length-1]<=last4*1.005;
    if (!slopeOk||!posOk) core.push("C2");
    rsi4h = calcRsi14(cl4, cl4.length-1);
  }
  const rsi1h = calcRsi14(cl, n-1);
  const rsiOk = dir==="long"? (rsi1h>=42&&rsi1h<=72) : (rsi1h>=28&&rsi1h<=58);
  if (!rsiOk) core.push("C3");
  const av = cs.slice(-20).reduce((s,c)=>s+c.volume,0)/20;
  const rvol = av>0? last.volume/av : 1;
  if (rvol<0.9) core.push("C4");
  const e20 = calcEma(cl,20);
  const atr = calcAtr(cs, n-1);
  const ad = atr>0? Math.abs(last.close-e20[n-1])/atr : 0;
  if (ad>1.8) core.push("C5");
  const body = Math.abs(last.close-last.open);
  const range = last.high-last.low;
  const br = range>0? body/range : 1;
  if (br<0.35) core.push("C6");
  if (n>=2) {
    const r2 = cs.slice(-2);
    const al = r2.filter(c=>dir==="long"? c.close>c.open : c.close<c.open).length;
    if (al<1) core.push("C7");
  }
  if (n>=50) {
    const ar: number[] = [];
    for (let i=Math.max(1,n-50);i<n;i++) ar.push(calcAtr(cs,i));
    ar.sort((a,b)=>a-b);
    const pct = Math.round((ar.filter(a=>a<=atr).length/ar.length)*100);
    if (pct<20||pct>88) core.push("C8");
  }
  if (family==="pa") {
    if (!(dir==="long"? last.close>=last.open : last.close<=last.open)) pa.push("PA1");
    if (!(dir==="long"? rsi1h<65 : rsi1h>35)) pa.push("PA2");
    if (!(dir==="long"? rsi4h>45 : rsi4h<55)) pa.push("PA3");
  }
  return { core, pa, rsi4h };
}

function gateBalanced(coreF: string[], paF: string[], family: string): { pass: boolean; tier: "S"|"A"|"-" } {
  const cp = 8 - coreF.length;
  if (family==="pa") {
    if (paF.includes("PA1")) return { pass:false, tier:"-" };
    if (paF.length>1) return { pass:false, tier:"-" };
  }
  if (cp>=7) return { pass:true, tier:"S" };
  if (cp>=6) {
    const must = ["C2","C4","C5"];
    if (!must.some(m => coreF.includes(m))) return { pass:true, tier:"A" };
  }
  return { pass:false, tier:"-" };
}
function gateStrict(coreF: string[], paF: string[]): boolean {
  return coreF.length<=1 && paF.length===0;
}

async function main() {
  console.log("=== v4.6 (balanced) vs v4.5 (strict) — 90 天驗證 ===\n");
  const [c1h, c4h] = await Promise.all([
    fetchCandles("BTCUSDT", "1h", 2160), // 90 天
    fetchCandles("BTCUSDT", "4h", 540),
  ]);
  const days = (c1h[c1h.length-1].time - c1h[0].time)/3600/24;
  console.log(`資料區間：${days.toFixed(1)} 天\n`);

  let strictTotal=0, strictWins=0, strictRet=0, strictGp=0, strictGl=0;
  let balTotal=0, balS=0, balA=0, balWins=0, balSWins=0, balAWins=0, balRet=0, balGp=0, balGl=0;
  const stratStat: Record<string,{strict:any; bal:any}> = {};

  for (const cfg of STRATEGIES) {
    const r = runBacktest({
      candles: c1h, strategy: cfg.strategy, symbol: "BTCUSDT", interval: "1h",
      atr_sl_mult: cfg.sl, atr_tp_mult: cfg.tp,
      enable_mtf_filter: true, enable_fee: true, enable_trailing_stop: false, enable_adx_filter: true,
    });
    const trades = r.trades ?? [];
    let st_t=0,st_w=0, b_t=0,b_w=0,b_s=0,b_a=0;
    for (const t of trades) {
      const e = evalChecks(t, c1h, c4h, cfg.family);
      if (gateStrict(e.core, e.pa)) {
        strictTotal++; st_t++;
        strictRet += t.pnl_net_pct;
        if (t.pnl_net_pct>0) { strictWins++; st_w++; strictGp += t.pnl_net_pct; }
        else                 { strictGl += Math.abs(t.pnl_net_pct); }
      }
      const g = gateBalanced(e.core, e.pa, cfg.family);
      if (g.pass) {
        balTotal++; b_t++;
        if (g.tier==="S") { balS++; b_s++; if (t.pnl_net_pct>0) balSWins++; }
        else              { balA++; b_a++; if (t.pnl_net_pct>0) balAWins++; }
        balRet += t.pnl_net_pct;
        if (t.pnl_net_pct>0) { balWins++; b_w++; balGp += t.pnl_net_pct; }
        else                 { balGl += Math.abs(t.pnl_net_pct); }
      }
    }
    stratStat[cfg.key] = {
      strict: {trades:st_t, wins:st_w, wr: st_t>0? st_w/st_t*100 : 0},
      bal:    {trades:b_t, wins:b_w, S:b_s, A:b_a, wr: b_t>0? b_w/b_t*100 : 0},
    };
  }

  const sf = (a:number,b:number)=>b>0?a/b:0;
  const strictWR = strictTotal>0? strictWins/strictTotal*100 : 0;
  const strictPF = strictGl>0? strictGp/strictGl : (strictGp>0?99:0);
  const strictDPT = strictTotal>0? days/strictTotal : Infinity;
  const balWR = balTotal>0? balWins/balTotal*100 : 0;
  const balSWR = balS>0? balSWins/balS*100 : 0;
  const balAWR = balA>0? balAWins/balA*100 : 0;
  const balPF = balGl>0? balGp/balGl : (balGp>0?99:0);
  const balDPT = balTotal>0? days/balTotal : Infinity;

  console.log("=".repeat(80));
  console.log("模式對比：");
  console.log("=".repeat(80));
  console.log(`v4.5 strict（原始）：${strictTotal} 筆 | 勝率 ${strictWR.toFixed(1)}% | PF ${strictPF.toFixed(2)} | 淨回報 ${strictRet>=0?'+':''}${strictRet.toFixed(3)}% | ${strictDPT===Infinity?'—':strictDPT.toFixed(2)} 天/筆`);
  console.log(`v4.6 balanced（部署）：${balTotal} 筆 (S=${balS} A=${balA}) | 勝率 ${balWR.toFixed(1)}% | PF ${balPF.toFixed(2)} | 淨回報 ${balRet>=0?'+':''}${balRet.toFixed(3)}% | ${balDPT===Infinity?'—':balDPT.toFixed(2)} 天/筆`);
  console.log(`  ├ S 級：${balS} 筆 | 勝率 ${balSWR.toFixed(1)}%`);
  console.log(`  └ A 級：${balA} 筆 | 勝率 ${balAWR.toFixed(1)}%`);
  console.log("=".repeat(80));

  console.log("\n各策略：");
  for (const [k,v] of Object.entries(stratStat)) {
    console.log(`${k}：strict ${v.strict.trades}筆/${v.strict.wr.toFixed(1)}% | balanced ${v.bal.trades}筆 (S${v.bal.S} A${v.bal.A})/${v.bal.wr.toFixed(1)}%`);
  }

  const fs = await import("fs/promises");
  await fs.writeFile("/home/ubuntu/runtime/v46_validation.json", JSON.stringify({
    period_days: days,
    strict: { total: strictTotal, wr: strictWR, pf: strictPF, ret: strictRet, dpt: strictDPT },
    balanced: { total: balTotal, S: balS, A: balA, wr: balWR, sWr: balSWR, aWr: balAWR, pf: balPF, ret: balRet, dpt: balDPT },
    by_strategy: stratStat,
  }, null, 2));
  console.log("\n結果已寫入 /home/ubuntu/runtime/v46_validation.json");
}
main().catch(console.error);
