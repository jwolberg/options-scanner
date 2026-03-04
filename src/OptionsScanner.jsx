import { useState, useEffect, useCallback } from "react";

const PROXY_BASE = "http://localhost:3001";
const DEFAULT_TICKERS = ["AAPL", "VIX", "KO", "META", "AMZN", "XOM", "GM", "MCD"];

async function fetchTicker(ticker) {
  const [stateRes, explainRes] = await Promise.all([
    fetch(`${PROXY_BASE}/tv/tickers/${ticker}`).then(r => r.json()),
    fetch(`${PROXY_BASE}/tv/tickers/${ticker}/explain`).then(r => r.json()),
  ]);
  return { ticker, raw: stateRes, explain: explainRes };
}

async function askClaude(prompt) {
  const res = await fetch(`${PROXY_BASE}/anthropic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: "You are an expert options trader and market analyst. Be concise, direct, insightful. Trader jargon OK. Short paragraphs, no markdown headers.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Proxy returned non-JSON (HTTP ${res.status}). Is the proxy running on port 3001?`);
  }

  // Surface API-level errors clearly
  if (data.error) {
    const msg = typeof data.error === "object"
      ? `${data.error.type}: ${data.error.message}`
      : String(data.error);
    throw new Error(msg);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);

  const text = data.content?.map(b => b.text).join("") ?? "";
  if (!text) throw new Error(`Anthropic returned no content. Full response: ${JSON.stringify(data).slice(0, 300)}`);
  return text;
}

// Exact schema from live API:
// raw.data = {
//   call_flow:    { regime, speculative_interest_score }
//   derived:      { dist_to_gex_flip, distance_to_minus/plus_1sigma_price }
//   expected_move:{ expected_move_pct_1d/1w/30d, levels:{...}, sigma_wings:{...} }
//   gamma:        { flip:{dist,price}, flow_context:{...}, gamma_notional_per_1pct_move_usd,
//                   structure:{max_gamma_strike, nearest_exp_gamma_notional_per_1pct_move_usd,
//                              nearest_expiration_date, pct_gamma_expiring_nearest_expiry} }
//   positioning:  { put_call:{call_oi,call_vol,pcr_oi,pcr_oi_change,pcr_volume,put_oi,put_vol},
//                   skew:{put_call_iv_ratio_25delta, put_call_iv_spread, skew_reference_dte_days,
//                         baselines:{put_call_iv_ratio_25delta_log, put_call_iv_spread}} }
//   underlying:   { iv:{atm_iv, iv_1d_pct_chg, iv_rank, max_iv, min_iv}, price }
// }
function normalize(raw) {
  const d  = raw?.data ?? raw ?? {};
  const cf = d.call_flow    ?? {};
  const dv = d.derived      ?? {};
  const em = d.expected_move ?? {};
  const gm = d.gamma        ?? {};
  const ps = d.positioning  ?? {};
  const pc = ps.put_call    ?? {};
  const sk = ps.skew        ?? {};
  const un = d.underlying   ?? {};
  const uiv = un.iv         ?? {};

  return {
    // call_flow
    regime:       cf.regime ?? null,
    specScore:    cf.speculative_interest_score ?? null,

    // underlying — primary IV source
    iv:           uiv.atm_iv ?? null,
    ivRank:       uiv.iv_rank ?? null,
    ivChg1d:      uiv.iv_1d_pct_chg ?? null,
    price:        un.price ?? null,

    // expected_move
    em1d:         em.expected_move_pct_1d  ?? null,
    em1w:         em.expected_move_pct_1w  ?? null,
    em30d:        em.expected_move_pct_30d ?? null,
    emLow:        em.levels?.price_minus_1sigma ?? null,
    emHigh:       em.levels?.price_plus_1sigma  ?? null,
    ivAtLow:      em.sigma_wings?.iv_at_minus_1sigma ?? null,
    ivAtHigh:     em.sigma_wings?.iv_at_plus_1sigma  ?? null,

    // gamma
    gammaFlipDist:    gm.flip?.dist  ?? null,
    gammaFlipPrice:   gm.flip?.price ?? null,
    gammaNot1pct:     gm.gamma_notional_per_1pct_move_usd ?? null,
    maxGammaStrike:   gm.structure?.max_gamma_strike ?? null,
    nearestExpiry:    gm.structure?.nearest_expiration_date ?? null,
    pctGammaExpiring: gm.structure?.pct_gamma_expiring_nearest_expiry ?? null,
    gexVolRatio:      gm.flow_context?.gex_volume_ratio ?? null,

    // derived
    distToGexFlip:    dv.dist_to_gex_flip ?? null,

    // positioning - put/call
    callOI:    pc.call_oi  ?? null,
    putOI:     pc.put_oi   ?? null,
    callVol:   pc.call_vol ?? null,
    putVol:    pc.put_vol  ?? null,
    pcrOI:     pc.pcr_oi   ?? null,
    pcrVol:    pc.pcr_volume ?? null,
    pcrChg30d: pc.pcr_oi_change?.d30 ?? null,
    pcrChg60d: pc.pcr_oi_change?.d60 ?? null,

    // positioning - skew
    skewRatio:    sk.put_call_iv_ratio_25delta  ?? null,
    skewSpread:   sk.put_call_iv_spread         ?? null,
    skewRefDte:   sk.skew_reference_dte_days    ?? null,

    d, // raw sections for fallback/AI
  };
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function Bar({ label, value, max, posColor, negColor, fmt }) {
  if (value === null || value === undefined) return null;
  const absMax = max ?? (Math.abs(value) * 2 || 1);
  const pct    = Math.min(Math.abs(value) / absMax, 1) * 100;
  const isPos  = value >= 0;
  const bar    = isPos ? (posColor ?? "bg-emerald-400") : (negColor ?? "bg-red-400");
  const text   = isPos ? "text-emerald-300" : "text-red-300";
  const display = fmt ? fmt(value) : value.toFixed(2);
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[11px] text-zinc-300 w-24 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] font-mono w-16 text-right ${text}`}>{display}</span>
    </div>
  );
}

function Row({ label, value, color, dim }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex items-baseline justify-between gap-2 py-[2px]">
      <span className="text-[11px] text-zinc-300 shrink-0">{label}</span>
      <span className={`text-[11px] font-mono text-right ${color ?? "text-zinc-50"}`}>
        {value}{dim && <span className="text-zinc-400 ml-0.5 text-[10px]">{dim}</span>}
      </span>
    </div>
  );
}

function Section({ children, className = "" }) {
  return <div className={`border-t border-zinc-800 pt-2 mt-2 space-y-[2px] ${className}`}>{children}</div>;
}

function OIBar({ callOI, putOI }) {
  if (!callOI && !putOI) return null;
  const total = (callOI + putOI) || 1;
  const fmt = v => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : `${(v/1e3).toFixed(0)}K`;
  const callPct = (callOI / total) * 100;
  return (
    <div className="py-1">
      <div className="flex justify-between text-[10px] text-zinc-300 mb-1">
        <span className="text-emerald-400/70">▲ {fmt(callOI)} calls</span>
        <span>OI split</span>
        <span className="text-red-400/70">puts {fmt(putOI)} ▼</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden">
        <div className="bg-emerald-500/60 transition-all duration-700" style={{ width: `${callPct}%` }} />
        <div className="bg-red-500/60 flex-1 transition-all duration-700" />
      </div>
    </div>
  );
}

function RegimePill({ regime }) {
  if (!regime) return null;
  const r = regime.toLowerCase();
  let cls = "bg-zinc-700/40 text-zinc-200 border-zinc-400/30"; let icon = "◆";
  if (r.includes("hedg") || r.includes("overwrit")) { cls = "bg-sky-500/20 text-sky-300 border-sky-500/30";       icon = "🛡"; }
  else if (r.includes("trend"))  { cls = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"; icon = "📈"; }
  else if (r.includes("explos")) { cls = "bg-red-500/20 text-red-300 border-red-500/30";             icon = "💥"; }
  else if (r.includes("pin"))    { cls = "bg-amber-500/20 text-amber-300 border-amber-500/30";       icon = "📌"; }
  else if (r.includes("range"))  { cls = "bg-violet-500/20 text-violet-300 border-violet-500/30";    icon = "↔";  }
  else if (r.includes("trans"))  { cls = "bg-zinc-300/20 text-zinc-200 border-zinc-300/30";          icon = "🔄"; }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wider ${cls}`}>
      {icon} {regime}
    </span>
  );
}

function SpecArc({ score }) {
  if (score === null) return null;
  const pct   = Math.min(Math.max(score, 0), 1);
  const color = pct > 0.5 ? "#f59e0b" : pct > 0.15 ? "#60a5fa" : "#6b7280";
  const dash  = Math.PI * 20 * pct;
  return (
    <div className="flex flex-col items-center">
      <svg width="48" height="30" viewBox="0 0 48 30">
        <path d="M 4 26 A 20 20 0 0 1 44 26" fill="none" stroke="#27272a" strokeWidth="4" strokeLinecap="round"/>
        <path d="M 4 26 A 20 20 0 0 1 44 26" fill="none" stroke={color} strokeWidth="4"
          strokeLinecap="round" strokeDasharray={`${dash * 2.15} 999`}/>
      </svg>
      <span className="text-[9px] text-zinc-300 -mt-1">spec</span>
      <span className="text-[10px] font-mono font-bold" style={{ color }}>{(pct * 100).toFixed(0)}%</span>
    </div>
  );
}

// ── Ticker Card ───────────────────────────────────────────────────────────────
function TickerCard({ data, onSelect, selected }) {
  const { ticker, explain } = data;
  const m = normalize(data.raw);

  const explainText =
    (typeof explain === "string" ? explain : null) ??
    explain?.data?.summary ?? explain?.data?.bias ?? explain?.data?.explanation ??
    explain?.summary ?? explain?.bias ?? explain?.explanation ??
    (typeof explain?.data === "string" ? explain.data : null);

  const pcrColor = m.pcrOI > 1.5 ? "text-red-300" : m.pcrOI < 0.8 ? "text-emerald-300" : "text-zinc-50";

  return (
    <div onClick={() => onSelect(data)}
      className={`relative cursor-pointer rounded-xl border transition-all duration-300 p-4 hover:scale-[1.01] ${
        selected ? "border-amber-400/60 bg-amber-400/5 shadow-lg shadow-amber-400/10"
                 : "border-zinc-800 bg-zinc-900/80 hover:border-zinc-700"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="font-black text-xl tracking-tight text-white font-mono">{ticker}</span>
            {m.price && <span className="text-sm font-mono text-zinc-200">${m.price.toFixed(2)}</span>}
          </div>
          <RegimePill regime={m.regime} />
        </div>
        <div className="flex flex-col items-end gap-1">
          {m.iv !== null && (
            <div className="text-right">
              <div className="text-[10px] text-zinc-300">
                IV ATM {m.ivRank !== null && <span className="text-amber-400/70 ml-1">IVR {m.ivRank.toFixed(0)}</span>}
              </div>
              <div className="text-xl font-mono font-black text-white leading-tight">
                {(m.iv * 100).toFixed(1)}%
                {m.ivChg1d !== null && (
                  <span className={`text-xs ml-1 ${m.ivChg1d >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                    {m.ivChg1d >= 0 ? "+" : ""}{m.ivChg1d.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )}
          <SpecArc score={m.specScore} />
        </div>
      </div>

      {/* Expected move pills */}
      {(m.em1d !== null || m.em1w !== null) && (
        <div className="flex gap-1.5 flex-wrap mb-2">
          {m.em1d  && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300">1d ±{(m.em1d*100).toFixed(1)}%</span>}
          {m.em1w  && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300/70">1w ±{(m.em1w*100).toFixed(1)}%</span>}
          {m.em30d && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300/50">30d ±{(m.em30d*100).toFixed(1)}%</span>}
        </div>
      )}

      {/* Gamma section */}
      {(m.gammaFlipDist !== null || m.gammaNot1pct !== null) && (
        <Section>
          <div className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Gamma</div>
          <Bar label="GEX Flip Dist" value={m.gammaFlipDist} max={20}
            fmt={v => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`} />
          {m.gammaFlipPrice && <Row label="GEX Flip Price" value={`$${m.gammaFlipPrice.toFixed(2)}`} />}
          {m.gammaNot1pct !== null && (
            <Bar label="GEX/1% Move" value={m.gammaNot1pct} max={8e9}
              fmt={v => `${v >= 0 ? "+" : ""}${(v/1e9).toFixed(2)}B`} />
          )}
          {m.maxGammaStrike && <Row label="Max GEX Strike" value={`$${m.maxGammaStrike}`} color="text-zinc-100" />}
          {m.pctGammaExpiring !== null && (
            <Row label="GEX Expiring" value={`${(m.pctGammaExpiring*100).toFixed(1)}%`}
              color="text-amber-300/80" dim={m.nearestExpiry ? ` (${m.nearestExpiry})` : ""} />
          )}
        </Section>
      )}

      {/* Skew section */}
      {(m.skewRatio !== null || m.skewSpread !== null) && (
        <Section>
          <div className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Skew {m.skewRefDte ? <span className="normal-case">({m.skewRefDte.toFixed(0)}d)</span> : ""}</div>
          <Bar label="P/C IV Ratio" value={m.skewRatio} max={3}
            posColor="bg-red-400" negColor="bg-emerald-400"
            fmt={v => v.toFixed(3)} />
          <Bar label="P/C IV Spread" value={m.skewSpread} max={0.3}
            posColor="bg-red-400" negColor="bg-emerald-400"
            fmt={v => `${v > 0 ? "+" : ""}${v.toFixed(4)}`} />
        </Section>
      )}

      {/* Positioning section */}
      {(m.callOI !== null || m.pcrOI !== null) && (
        <Section>
          <div className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Positioning</div>
          <OIBar callOI={m.callOI} putOI={m.putOI} />
          <Row label="PCR (OI)" value={m.pcrOI?.toFixed(2)} color={pcrColor} />
          <Row label="PCR (Vol)" value={m.pcrVol?.toFixed(2)} />
          {m.pcrChg30d !== null && (
            <Row label="PCR Δ 30d" value={`${m.pcrChg30d >= 0 ? "+" : ""}${m.pcrChg30d.toFixed(2)}`}
              color={m.pcrChg30d >= 0 ? "text-red-300" : "text-emerald-300"} />
          )}
        </Section>
      )}

      {/* Explain blurb */}
      {explainText && (
        <p className="text-[11px] text-zinc-200 line-clamp-3 leading-relaxed border-t border-zinc-800 pt-2 mt-2">
          {explainText}
        </p>
      )}

      {selected && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
    </div>
  );
}

// ── AI Panel ──────────────────────────────────────────────────────────────────
function AIPanel({ data, onClose }) {
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!data) return;
    setLoading(true);
    setAnalysis("");
    const m = normalize(data.raw);
    const prompt = `Analyze live options data for ${data.ticker} (price: $${m.price ?? "n/a"}):

REGIME: ${m.regime} | Spec Interest: ${m.specScore !== null ? (m.specScore*100).toFixed(0)+"%" : "n/a"}
IV: ${m.iv !== null ? (m.iv*100).toFixed(1)+"%" : "n/a"} | IVR: ${m.ivRank ?? "n/a"} | 1d chg: ${m.ivChg1d ?? "n/a"}%
Expected Move: 1d=±${m.em1d !== null ? (m.em1d*100).toFixed(2)+"%" : "n/a"} | 1w=±${m.em1w !== null ? (m.em1w*100).toFixed(2)+"%" : "n/a"} | 30d=±${m.em30d !== null ? (m.em30d*100).toFixed(2)+"%" : "n/a"}
Gamma Flip: $${m.gammaFlipPrice ?? "n/a"} (${m.gammaFlipDist !== null ? (m.gammaFlipDist > 0 ? "+" : "")+m.gammaFlipDist.toFixed(2)+"% away" : "n/a"})
GEX per 1% move: ${m.gammaNot1pct !== null ? (m.gammaNot1pct/1e9).toFixed(2)+"B" : "n/a"}
Max gamma strike: $${m.maxGammaStrike ?? "n/a"} | ${m.pctGammaExpiring !== null ? (m.pctGammaExpiring*100).toFixed(1)+"% expiring "+m.nearestExpiry : ""}
Skew (25Δ P/C ratio): ${m.skewRatio ?? "n/a"} | Spread: ${m.skewSpread ?? "n/a"}
PCR (OI): ${m.pcrOI ?? "n/a"} | PCR (Vol): ${m.pcrVol ?? "n/a"} | 30d chg: ${m.pcrChg30d ?? "n/a"}
Call OI: ${m.callOI ? (m.callOI/1e6).toFixed(2)+"M" : "n/a"} | Put OI: ${m.putOI ? (m.putOI/1e6).toFixed(2)+"M" : "n/a"}

Cover: positioning regime read, gamma exposure implications, skew signals, key risk, one specific trade idea with strikes/expiry. Be sharp.`;

    askClaude(prompt)
      .then(setAnalysis)
      .catch(e => setAnalysis("Error: " + e.message))
      .finally(() => setLoading(false));
  }, [data?.ticker]);

  if (!data) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl border border-amber-400/30 bg-zinc-950 shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-black font-mono text-white">{data.ticker}</h2>
            <p className="text-xs text-amber-400 uppercase tracking-widest">AI Deep Analysis</p>
          </div>
          <button onClick={onClose} className="text-zinc-300 hover:text-white text-2xl leading-none">×</button>
        </div>
        {loading ? (
          <div className="flex items-center gap-3 py-8">
            <div className="flex gap-1">{[0,1,2].map(i=>(
              <div key={i} className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{animationDelay:`${i*0.15}s`}}/>
            ))}</div>
            <span className="text-zinc-200 text-sm">Analyzing {data.ticker}...</span>
          </div>
        ) : (
          <div className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap">{analysis}</div>
        )}
        <details className="mt-6 pt-4 border-t border-zinc-800">
          <summary className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-200 select-none">Raw data</summary>
          <pre className="text-[10px] text-zinc-700 overflow-auto max-h-60 mt-2">{JSON.stringify(data.raw?.data ?? data.raw, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function OptionsScanner() {
  const [inputVal, setInputVal]         = useState(DEFAULT_TICKERS.join(", "));
  const [tickerData, setTickerData]     = useState([]);
  const [loading, setLoading]           = useState(false);
  const [errors, setErrors]             = useState({});
  const [selected, setSelected]         = useState(null);
  const [aiSummary, setAiSummary]       = useState("");
  const [summarizing, setSummarizing]   = useState(false);
  const [summaryOpen, setSummaryOpen]   = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  const scan = useCallback(async list => {
    setLoading(true); setTickerData([]); setErrors({}); setLoadProgress(0);
    const results = []; const errs = {};
    for (let i = 0; i < list.length; i++) {
      const t = list[i].toUpperCase().trim();
      try {
        const data = await fetchTicker(t);
        results.push(data);
        setTickerData([...results]);
      } catch (e) { errs[t] = e.message; setErrors({...errs}); }
      setLoadProgress(Math.round(((i+1)/list.length)*100));
    }
    setLoading(false);
  }, []);

  useEffect(() => { scan(DEFAULT_TICKERS); }, []);
  const handleScan = () => scan(inputVal.split(",").map(t => t.trim()).filter(Boolean));

  const handleAISummary = async () => {
    setSummarizing(true); setSummaryOpen(true); setAiSummary("");
    const lines = tickerData.map(d => {
      const m = normalize(d.raw);
      return `${d.ticker} $${m.price??""}: regime=${m.regime} iv=${m.iv!==null?(m.iv*100).toFixed(1)+"%":"n/a"} ivr=${m.ivRank??""} em1d=${m.em1d!==null?"±"+(m.em1d*100).toFixed(1)+"%":"n/a"} gexFlip=${m.gammaFlipDist!==null?(m.gammaFlipDist>0?"+":"")+m.gammaFlipDist.toFixed(1)+"%":"n/a"} pcr=${m.pcrOI??""} skew=${m.skewRatio??""} spec=${m.specScore!==null?(m.specScore*100).toFixed(0)+"%":"n/a"}`;
    });
    try {
      setAiSummary(await askClaude(
        `Scan ${tickerData.length} tickers:\n${lines.join("\n")}\n\n1) Overall regime  2) Top 2-3 setups  3) Divergences  4) Key risks. Punchy.`
      ));
    } catch (e) { setAiSummary("Error: " + e.message); }
    setSummarizing(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=Barlow+Condensed:wght@900&display=swap');
        .display { font-family: 'Barlow Condensed', sans-serif; }
        @keyframes scan-line { 0%{transform:translateY(-100%);opacity:.5;} 100%{transform:translateY(100vh);opacity:0;} }
        .scan-line { position:fixed;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#fbbf24,transparent);animation:scan-line 4s linear infinite;pointer-events:none;z-index:10; }
      `}</style>
      <div className="scan-line" />

      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="display text-4xl font-black text-white tracking-tight">OPTIONS <span className="text-amber-400">SCANNER</span></h1>
            <p className="text-xs text-zinc-300 mt-0.5">Trading Volatility API + Claude AI</p>
          </div>
          <button onClick={handleAISummary} disabled={summarizing || tickerData.length === 0}
            className="px-4 py-2 rounded-lg bg-amber-400 text-black text-sm font-bold hover:bg-amber-300 disabled:opacity-40 transition-all flex items-center gap-2">
            {summarizing ? <><span className="inline-block w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"/>Scanning...</> : "⚡ AI Market Summary"}
          </button>
        </div>
      </header>

      <div className="border-b border-zinc-800 px-6 py-3 bg-zinc-900/50">
        <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
          <span className="text-zinc-300 text-xs uppercase tracking-widest">Tickers</span>
          <input className="flex-1 min-w-60 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white placeholder-zinc-300 focus:outline-none focus:border-amber-400/60 transition-colors"
            value={inputVal} onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleScan()} placeholder="SPY, QQQ, AAPL, ..." />
          <button onClick={handleScan} disabled={loading}
            className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-400 disabled:opacity-50 rounded-lg text-sm transition-colors">
            {loading ? `${loadProgress}%` : "Scan →"}
          </button>
          {loading && (
            <div className="flex items-center gap-2">
              <div className="h-1 w-32 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 transition-all duration-300" style={{ width: `${loadProgress}%` }} />
              </div>
              <span className="text-xs text-zinc-300">{loadProgress}%</span>
            </div>
          )}
        </div>
      </div>

      {Object.keys(errors).length > 0 && (
        <div className="px-6 py-2 bg-red-900/20 border-b border-red-800/30">
          <span className="text-xs text-red-400">Failed: {Object.keys(errors).join(", ")}</span>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-6">
        {tickerData.length === 0 && !loading && (
          <div className="text-center py-20 text-zinc-400">
            <div className="display text-5xl mb-3">NO DATA</div>
            <p className="text-sm">Enter tickers above and hit Scan</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {tickerData.map(d => (
            <TickerCard key={d.ticker} data={d} onSelect={setSelected} selected={selected?.ticker === d.ticker} />
          ))}
        </div>
      </main>

      {summaryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setSummaryOpen(false)}>
          <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl border border-amber-400/30 bg-zinc-950 shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="display text-3xl font-black text-white">MARKET PULSE</h2>
                <p className="text-xs text-amber-400 uppercase tracking-widest">AI Cross-Ticker Analysis</p>
              </div>
              <button onClick={() => setSummaryOpen(false)} className="text-zinc-300 hover:text-white text-2xl">×</button>
            </div>
            {summarizing ? (
              <div className="flex items-center gap-3 py-8">
                <div className="flex gap-1">{[0,1,2].map(i=>(
                  <div key={i} className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{animationDelay:`${i*0.15}s`}}/>
                ))}</div>
                <span className="text-zinc-200 text-sm">Reading tape across {tickerData.length} tickers...</span>
              </div>
            ) : (
              <div className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap">{aiSummary}</div>
            )}
          </div>
        </div>
      )}

      {selected && <AIPanel data={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
