import { useState, useEffect, useCallback, useMemo } from "react";

const PROXY_BASE = "http://localhost:3001";
const DEFAULT_TICKERS = ["AAPL", "VIX", "KO", "META", "AMZN", "XOM", "GM", "MCD"];
const STORAGE_KEY = "options-scanner-tickers";

async function loadSavedTickers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_TICKERS;
}

async function saveTickers(tickers) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers));
  } catch (e) {
    console.warn("Failed to save tickers:", e);
  }
}

async function fetchTicker(ticker) {
  const [stateRes, explainRes, msRes] = await Promise.all([
    fetch(`${PROXY_BASE}/tv/tickers/${ticker}`).then(r => r.json()),
    fetch(`${PROXY_BASE}/tv/tickers/${ticker}/explain`).then(r => r.json()),
    fetch(`${PROXY_BASE}/tv/tickers/${ticker}/market-structure`).then(r => r.json()).catch(() => null),
  ]);
  return { ticker, raw: stateRes, explain: explainRes, ms: msRes };
}

function reorderList(list, fromIndex, toIndex) {
  const copy = [...list];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

function computeTier(m, ms) {
  return m.opportunityTier ?? null;
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

function normalize(raw) {
  const d  = raw?.data ?? raw ?? {};
  const cf = d.call_flow    ?? {};
  const dv = d.derived      ?? {};
  const em = d.expected_move ?? {};
  const gm = d.gamma        ?? {};
  const ms = d.market_state ?? {};
  const ps = d.positioning  ?? {};
  const pc = ps.put_call    ?? {};
  const sk = ps.skew        ?? {};
  const tr = d.trade_recommendation ?? {};
  const un = d.underlying   ?? {};
  const uiv = un.iv         ?? {};

  return {
    regime:       cf.regime ?? null,
    specScore:    cf.speculative_interest_score ?? null,
    trendScore:   ms.trend?.score ?? null,
    trendState:   ms.trend?.state ?? null,
    momentumScore: ms.momentum?.score ?? null,
    momentumState: ms.momentum?.state ?? null,
    extensionScore: ms.extension?.score ?? null,
    extensionState: ms.extension?.state ?? null,
    realizedVolScore: ms.realized_vol?.score ?? null,
    realizedVolState: ms.realized_vol?.state ?? null,
    realizedVol20d: ms.realized_vol_20d ?? null,
    trendAlignmentScore: ms.trend_alignment?.score ?? null,
    trendAlignmentState:
      ms.trend_alignment?.state
        ? (
            ms.trend_alignment.state === "conflicting" && (ms.trend_alignment?.score ?? 0) > 0 ? "aligned"
            : ms.trend_alignment.state === "aligned" && (ms.trend_alignment?.score ?? 0) < 0 ? "conflicting"
            : ms.trend_alignment.state
          )
        : null,
    iv:           uiv.atm_iv ?? null,
    ivRank:       uiv.iv_rank ?? null,
    ivChg1d:      uiv.iv_1d_pct_chg ?? null,
    price:        un.price ?? null,
    em1d:         em.expected_move_pct_1d  ?? null,
    em1w:         em.expected_move_pct_1w  ?? null,
    em30d:        em.expected_move_pct_30d ?? null,
    emLow:        em.levels?.price_minus_1sigma ?? null,
    emHigh:       em.levels?.price_plus_1sigma  ?? null,
    ivAtLow:      em.sigma_wings?.iv_at_minus_1sigma ?? null,
    ivAtHigh:     em.sigma_wings?.iv_at_plus_1sigma  ?? null,
    gammaFlipDist:    gm.flip?.dist  ?? null,
    gammaFlipPrice:   gm.flip?.price ?? null,
    gammaNot1pct:     gm.gamma_notional_per_1pct_move_usd ?? null,
    maxGammaStrike:   gm.structure?.max_gamma_strike ?? null,
    nearestExpiry:    gm.structure?.nearest_expiration_date ?? null,
    pctGammaExpiring: gm.structure?.pct_gamma_expiring_nearest_expiry ?? null,
    gexVolRatio:      gm.flow_context?.gex_volume_ratio ?? null,
    distToGexFlip:    dv.dist_to_gex_flip_pct ?? null,
    callOI:    pc.call_oi  ?? null,
    putOI:     pc.put_oi   ?? null,
    callVol:   pc.call_vol ?? null,
    putVol:    pc.put_vol  ?? null,
    pcrOI:     pc.pcr_oi   ?? null,
    pcrVol:    pc.pcr_volume ?? null,
    pcrChg30d: pc.pcr_oi_change?.d30 ?? null,
    pcrChg60d: pc.pcr_oi_change?.d60 ?? null,
    skewRatio:    sk.put_call_iv_ratio_25delta  ?? null,
    skewSpread:   sk.put_call_iv_spread         ?? null,
    skewRefDte:   sk.skew_reference_dte_days    ?? null,
    opportunityScore: tr.opportunity_score ?? null,
    opportunityTier: tr.opportunity_tier ?? null,
    tradeDirection: tr.direction ?? null,
    gammaRegimeLabel: tr.regime_label ?? null,
    tradeBias: tr.trade_bias ?? null,
    tradeType: tr.trade_type ?? null,
    d,
  };
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function Bar({ 
  label,
  value,
  min,
  max,
  neutral = 0,
  invert = false,
  posColor,
  negColor,
  fmt,
  labelClassName = "w-24",
  trackClassName = "",
  valueClassName = "w-16",
}) {
  if (value === null || value === undefined) return null;

  const delta = value - neutral;
  const signed = invert ? -delta : delta;

  const positiveSpan = Math.max((max ?? neutral) - neutral, 0.0001);
  const negativeSpan = Math.max(neutral - (min ?? neutral), 0.0001);

  const isPos = signed > 0;
  const isNeutral = signed === 0;

  const pct = isNeutral
    ? 0
    : isPos
      ? Math.min(Math.abs(delta) / positiveSpan, 1) * 50
      : Math.min(Math.abs(delta) / negativeSpan, 1) * 50;

  const barColor = isNeutral
    ? "bg-zinc-600"
    : isPos
      ? (posColor ?? "bg-emerald-400")
      : (negColor ?? "bg-red-400");

  const textColor = isNeutral
    ? "text-zinc-400"
    : isPos
      ? "text-emerald-300"
      : "text-red-300";

  const display = fmt ? fmt(value) : value.toFixed(2);

  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={`text-[11px] text-zinc-300 shrink-0 ${labelClassName}`}>{label}</span>

      <div className={`relative flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden ${trackClassName}`}>
        {/* center marker */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-600/80 -translate-x-1/2" />

        {/* fill from center */}
        {!isNeutral && (
          <div
            className={`absolute top-0 h-full rounded-full transition-all duration-700 ${barColor}`}
            style={
              isPos
                ? { left: "50%", width: `${pct}%` }
                : { right: "50%", width: `${pct}%` }
            }
          />
        )}
      </div>

      <span className={`text-[11px] font-mono text-right ${textColor} ${valueClassName}`}>
        {display}
      </span>
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
        <span className="text-emerald-300">▲ {fmt(callOI)} calls</span>
        <span>OI split</span>
        <span className="text-red-300">puts {fmt(putOI)} ▼</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden">
        <div className="bg-emerald-500/80 transition-all duration-700" style={{ width: `${callPct}%` }} />
        <div className="bg-red-500/80 flex-1 transition-all duration-700" />
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

function OpportunityScorePill({ score }) {
  if (score === null || score === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono uppercase tracking-wider text-amber-300">
      Score {score.toFixed(2)}
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
      <span className="text-[9px] text-zinc-300 -mt-1">Call Speculation</span>
      <span className="text-[10px] font-mono font-bold" style={{ color }}>{(pct * 100).toFixed(0)}%</span>
    </div>
  );
}

// ── Ticker Tag (pill in the manage bar) ──────────────────────────────────────
function TickerTag({ ticker, onRemove, onDragStart, onDragOver, onDrop, dragging }) {
  return (
    <span
      draggable
      onDragStart={() => onDragStart(ticker)}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(ticker);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(ticker);
      }}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-mono text-zinc-100 group cursor-move select-none transition-all ${
        dragging
          ? "bg-amber-400/20 border-amber-400/40 opacity-60"
          : "bg-zinc-800 border-zinc-700 hover:border-zinc-500"
      }`}
      title={`Drag to reorder ${ticker}`}
    >
      <span className="text-zinc-500 mr-0.5">⋮⋮</span>
      {ticker}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(ticker);
        }}
        className="text-zinc-500 hover:text-red-400 transition-colors leading-none ml-0.5 text-[11px] cursor-pointer"
        title={`Remove ${ticker}`}
      >
        ×
      </button>
    </span>
  );
}

function SignalPill({ signal }) {
  if (!signal) return null;
  const s = signal.toLowerCase();
  let cls = "bg-zinc-700/60 text-zinc-300";
  if (s.includes("bullish") || s.includes("stabiliz")) cls = "bg-emerald-500/20 text-emerald-300";
  else if (s.includes("bearish") || s.includes("fragile")) cls = "bg-red-500/20 text-red-300";
  else if (s.includes("mixed") || s.includes("neutral")) cls = "bg-amber-500/20 text-amber-300";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider ${cls}`}>
      {signal}
    </span>
  );
}

function formatLabel(value) {
  if (!value) return null;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function TierBadge({ tier }) {
  if (!tier) return null;
  const normalized = String(tier).toLowerCase();
  let cls = "bg-zinc-700/60 text-zinc-300";
  if (normalized.includes("high")) cls = "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
  else if (normalized.includes("moderate")) cls = "bg-amber-500/20 text-amber-300 border border-amber-500/30";
  else if (normalized.includes("low")) cls = "bg-zinc-700/60 text-zinc-400 border border-zinc-600/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider ${cls}`}>
      {formatLabel(tier)}
    </span>
  );
}

function GammaRegimePill({ label }) {
  if (!label) return null;
  const display = formatLabel(label);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 text-[10px] font-mono uppercase tracking-wider text-fuchsia-200">
      Gamma {display}
    </span>
  );
}

function DirectionPill({ direction }) {
  if (!direction) return null;
  const d = direction.toLowerCase();
  let cls = "bg-zinc-700/60 text-zinc-300";
  if (d.includes("long")) cls = "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
  else if (d.includes("short")) cls = "bg-red-500/20 text-red-300 border border-red-500/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider ${cls}`}>
      {direction}
    </span>
  );
}

// ── Ticker Card ───────────────────────────────────────────────────────────────
function TickerCard({ data, onSelect, selected }) {
  const { ticker, explain, ms } = data;
  const m = normalize(data.raw);
  const msValid = ms && !ms.error;
  const tier = computeTier(m, ms);

  const explainText =
    (msValid ? ms?.data?.headline : null) ??
    (typeof explain === "string" ? explain : null) ??
    explain?.data?.summary ?? explain?.data?.bias ?? explain?.data?.explanation ??
    explain?.summary ?? explain?.bias ?? explain?.explanation ??
    (typeof explain?.data === "string" ? explain.data : null);

  const pcrColor = m.pcrOI > 1.5 ? "text-red-300" : m.pcrOI < 0.8 ? "text-emerald-300" : "text-zinc-50";

  const biasBorder = msValid
    ? ms?.data?.bias === "upside"   ? "border-l-4 border-l-emerald-500"
    : ms?.data?.bias === "downside" ? "border-l-4 border-l-red-500"
    : ""
    : "";

  return (
    <div onClick={() => onSelect(data)}
      className={`relative cursor-pointer rounded-xl border transition-all duration-300 p-4 hover:scale-[1.01] ${biasBorder} ${
        selected ? "border-amber-400/60 bg-amber-400/5 shadow-lg shadow-amber-400/10"
                 : "border-zinc-800 bg-zinc-900/80 hover:border-zinc-700"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="font-black text-xl tracking-tight text-white font-mono">{ticker}</span>
            {m.price && <span className="text-sm font-mono text-zinc-200">${m.price.toFixed(2)}</span>}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <OpportunityScorePill score={m.opportunityScore} />
            <GammaRegimePill label={m.gammaRegimeLabel} />
            {msValid && <SignalPill signal={ms?.data?.signal} />}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <TierBadge tier={tier} />
          <DirectionPill direction={m.tradeDirection} />
          {m.opportunityScore !== null && (
            <div className="text-right rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1">
              <div className="text-[9px] text-amber-200/80 uppercase tracking-widest">Score</div>
              <div className="text-xl font-mono font-black text-amber-300 leading-none">
                {m.opportunityScore.toFixed(2)}
              </div>
            </div>
          )}
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

      {(m.opportunityScore !== null || m.tradeDirection || m.tradeType || m.tradeBias) && (
        <div className="flex gap-1.5 flex-wrap mb-2">
          {m.opportunityScore !== null && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
              Score {m.opportunityScore.toFixed(2)}
            </span>
          )}
          {m.tradeDirection && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20">
              Direction {formatLabel(m.tradeDirection)}
            </span>
          )}
          {m.tradeType && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              Type {formatLabel(m.tradeType)}
            </span>
          )}
          {m.tradeBias && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200">
              Bias {m.tradeBias}
            </span>
          )}
        </div>
      )}

      {(m.em1d !== null || m.em1w !== null) && (
        <div className="flex gap-1.5 flex-wrap mb-2">
          {m.em1d  && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300">1d ±{(m.em1d).toFixed(1)}%</span>}
          {m.em1w  && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300/70">1w ±{(m.em1w).toFixed(1)}%</span>}
          {m.em30d && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300/50">30d ±{(m.em30d).toFixed(1)}%</span>}
        </div>
      )}

      {(m.trendScore !== null || m.momentumScore !== null || m.extensionScore !== null || m.realizedVolScore !== null || m.trendAlignmentScore !== null) && (
        <Section>
          <div className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Market State</div>
          <Bar label={`Trend: ${m.trendState ?? ""}`.trim()} value={m.trendScore} min={-5} max={5}
            fmt={() => ""} labelClassName="w-40" trackClassName="w-20 flex-none ml-auto" valueClassName="w-0" />
          <Bar label={`Momentum: ${m.momentumState ?? ""}`.trim()} value={m.momentumScore} min={-5} max={5}
            fmt={() => ""} labelClassName="w-40" trackClassName="w-20 flex-none ml-auto" valueClassName="w-0" />
          <Bar label={`Extension: ${m.extensionState ?? ""}`.trim()} value={m.extensionScore} min={-5} max={5}
            fmt={() => ""} labelClassName="w-40" trackClassName="w-20 flex-none ml-auto" valueClassName="w-0" />
          <Bar label={`Realized Vol: ${m.realizedVolState ?? ""}`.trim()} value={m.realizedVolScore} min={-5} max={5}
            fmt={() => ""} labelClassName="w-40" trackClassName="w-20 flex-none ml-auto" valueClassName="w-0" />
          <Bar label={`Alignment: ${m.trendAlignmentState ?? ""}`.trim()} value={m.trendAlignmentScore} min={-5} max={5}
            fmt={() => ""} labelClassName="w-40" trackClassName="w-20 flex-none ml-auto" valueClassName="w-0" />
          <Row
            label="20d Realized Vol"
            value={m.realizedVol20d !== null ? `${(m.realizedVol20d * 100).toFixed(1)}%` : null}
            color="text-zinc-100"
          />
        </Section>
      )}

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
    
      {(m.skewRatio !== null || m.skewSpread !== null) && (
        <Section>
          <div className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Skew {m.skewRefDte ? <span className="normal-case">({m.skewRefDte.toFixed(0)}d)</span> : ""}</div>
          <Bar
            label="P/C IV Ratio"
            value={m.skewRatio}
            min={0.2}
            max={2}
            neutral={1}
            invert
            posColor="bg-red-400"
            negColor="bg-emerald-400"
            fmt={v => v.toFixed(2)}
          />

          <Bar
            label="P-C IV Spread"
            value={m.skewSpread}
            min={-0.8}
            max={0.8}
            neutral={0}
            invert
            posColor="bg-red-400"
            negColor="bg-emerald-400"
            fmt={v => `${v > 0 ? "+" : ""}${v.toFixed(3)}`}
          />
        </Section>
      )}

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

GAMMA REGIME: ${formatLabel(m.gammaRegimeLabel) ?? "n/a"}
OPPORTUNITY: score=${m.opportunityScore ?? "n/a"} | tier=${formatLabel(m.opportunityTier) ?? "n/a"} | direction=${m.tradeDirection ?? "n/a"} | type=${formatLabel(m.tradeType) ?? "n/a"}
TRADE BIAS: ${m.tradeBias ?? "n/a"}
MARKET STATE: trend=${m.trendState ?? "n/a"} (${m.trendScore ?? "n/a"}) | momentum=${m.momentumState ?? "n/a"} (${m.momentumScore ?? "n/a"}) | extension=${m.extensionState ?? "n/a"} (${m.extensionScore ?? "n/a"}) | realized_vol=${m.realizedVolState ?? "n/a"} (${m.realizedVolScore ?? "n/a"}) | alignment=${m.trendAlignmentState ?? "n/a"} (${m.trendAlignmentScore ?? "n/a"}) | rv20=${m.realizedVol20d !== null ? (m.realizedVol20d*100).toFixed(1)+"%" : "n/a"}
SPEC INTEREST: ${m.specScore !== null ? (m.specScore*100).toFixed(0)+"%" : "n/a"}
IV: ${m.iv !== null ? (m.iv*100).toFixed(1)+"%" : "n/a"} | IVR: ${m.ivRank ?? "n/a"} | 1d chg: ${m.ivChg1d ?? "n/a"}%
Expected Move: 1d=±${m.em1d !== null ? m.em1d.toFixed(2)+"%" : "n/a"} | 1w=±${m.em1w !== null ? m.em1w.toFixed(2)+"%" : "n/a"} | 30d=±${m.em30d !== null ? m.em30d.toFixed(2)+"%" : "n/a"}
Gamma Flip: $${m.gammaFlipPrice ?? "n/a"} (${m.gammaFlipDist !== null ? (m.gammaFlipDist > 0 ? "+" : "")+m.gammaFlipDist.toFixed(2)+"% away" : "n/a"})
GEX per 1% move: ${m.gammaNot1pct !== null ? (m.gammaNot1pct/1e9).toFixed(2)+"B" : "n/a"}
Max gamma strike: $${m.maxGammaStrike ?? "n/a"} | ${m.pctGammaExpiring !== null ? (m.pctGammaExpiring*100).toFixed(1)+"% expiring "+m.nearestExpiry : ""}
Skew (25Δ P/C ratio): ${m.skewRatio ?? "n/a"} | Spread: ${m.skewSpread ?? "n/a"}
PCR (OI): ${m.pcrOI ?? "n/a"} | PCR (Vol): ${m.pcrVol ?? "n/a"} | 30d chg: ${m.pcrChg30d ?? "n/a"}
Call OI: ${m.callOI ? (m.callOI/1e6).toFixed(2)+"M" : "n/a"} | Put OI: ${m.putOI ? (m.putOI/1e6).toFixed(2)+"M" : "n/a"}

Cover: explain whether the engine recommendation makes sense, reconcile it with gamma/positioning/skew, identify the key invalidation, and give one specific trade idea with strikes/expiry. Be sharp.`;

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

function filterCards(cards, mode) {
  if (mode === "All") return cards;
  return cards.filter(card => {
    const m = normalize(card.raw);
    const ms = card.ms;
    const msValid = ms && !ms.error;
    if (mode === "Top Opportunities") return ["high", "moderate"].includes(String(computeTier(m, ms) ?? "").toLowerCase());
    if (mode === "Directional") return String(m.tradeDirection ?? "").toLowerCase() === "short";
    if (mode === "Mean Reversion") return String(m.tradeType ?? "").toLowerCase() === "mean_reversion";
    if (mode === "High IVR") return m.ivRank >= 50;
    if (mode === "Conflicting") return m.trendAlignmentState === "conflicting";
    if (mode === "Elevated Vol") return m.realizedVolState === "elevated";
    if (mode === "Fragile") return (msValid && ms?.data?.bias === "downside") ||
      (msValid && typeof ms?.data?.signal === "string" && ms.data.signal.toLowerCase().includes("fragile"));
    return true;
  });
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function OptionsScanner() {
  const [tickers, setTickers]           = useState(DEFAULT_TICKERS);
  const [addInput, setAddInput]         = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [tickerData, setTickerData]     = useState([]);
  const [loading, setLoading]           = useState(false);
  const [errors, setErrors]             = useState({});
  const [selected, setSelected]         = useState(null);
  const [aiSummary, setAiSummary]       = useState("");
  const [summarizing, setSummarizing]   = useState(false);
  const [summaryOpen, setSummaryOpen]   = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [saveStatus, setSaveStatus]     = useState(""); // "saved" | "saving" | ""

  // ── Key management ──
  const [keyStatus, setKeyStatus]   = useState({ tv: null, anthropic: null }); // null=unknown
  const [tvDraft, setTvDraft]       = useState("");
  const [anthDraft, setAnthDraft]   = useState("");
  const [keysSaving, setKeysSaving] = useState(false);
  const [keysError, setKeysError]   = useState(null);

  const [dragTicker, setDragTicker] = useState(null);
  const [dragOverTicker, setDragOverTicker] = useState(null);
  const [filterMode, setFilterMode] = useState("All");
  const visibleCards = useMemo(() => filterCards(tickerData, filterMode), [tickerData, filterMode]);

  const fetchKeyStatus = useCallback(async () => {
    try {
      const r = await fetch(`${PROXY_BASE}/keys/status`);
      const d = await r.json();
      setKeyStatus(d);
    } catch { /* proxy not up yet */ }
  }, []);

  const saveKeys = async () => {
    const payload = {};
    if (tvDraft.trim())   payload.tv        = tvDraft.trim();
    if (anthDraft.trim()) payload.anthropic = anthDraft.trim();
    if (!Object.keys(payload).length) return;
    setKeysSaving(true);
    setKeysError(null);
    try {
      const r = await fetch(`${PROXY_BASE}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await fetchKeyStatus();
      setTvDraft("");
      setAnthDraft("");
    } catch (e) {
      setKeysError(e.message);
    } finally {
      setKeysSaving(false);
    }
  };

  // Load saved tickers on mount
  useEffect(() => {
    loadSavedTickers().then(saved => {
      setTickers(saved);
      setStorageReady(true);
    });
  }, []);

  useEffect(() => {
    fetchKeyStatus();
  }, [fetchKeyStatus]);

  const scan = useCallback(async (list) => {
    setLoading(true);
    setErrors({});
    setLoadProgress(0);
  
    const collected = {};
    const errs = {};
  
    for (let i = 0; i < list.length; i++) {
      const t = list[i].toUpperCase().trim();
      try {
        const data = await fetchTicker(t);
        collected[t] = data;
  
        const ordered = list
          .map(sym => collected[sym])
          .filter(Boolean);
  
        setTickerData(ordered);
      } catch (e) {
        errs[t] = e.message;
        setErrors({ ...errs });
      }
  
      setLoadProgress(Math.round(((i + 1) / list.length) * 100));
    }
  
    setLoading(false);
  }, []);

  // Auto-scan when storage is ready
  useEffect(() => {
    if (storageReady) scan(tickers);
  }, [storageReady]);

  const persistTickers = useCallback(async (newList) => {
    setSaveStatus("saving");
    await saveTickers(newList);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus(""), 2000);
  }, []);

  const handleDragStart = useCallback((ticker) => {
    setDragTicker(ticker);
  }, []);
  
  const handleDragOver = useCallback((ticker) => {
    if (ticker !== dragOverTicker) setDragOverTicker(ticker);
  }, [dragOverTicker]);
  
  const handleDropTicker = useCallback((targetTicker) => {
    if (!dragTicker || dragTicker === targetTicker) {
      setDragTicker(null);
      setDragOverTicker(null);
      return;
    }
  
    const fromIndex = tickers.indexOf(dragTicker);
    const toIndex = tickers.indexOf(targetTicker);
  
    if (fromIndex === -1 || toIndex === -1) {
      setDragTicker(null);
      setDragOverTicker(null);
      return;
    }
  
    const newTickers = reorderList(tickers, fromIndex, toIndex);
    setTickers(newTickers);
  
    setTickerData(prev => {
      const byTicker = new Map(prev.map(item => [item.ticker, item]));
      return newTickers.map(t => byTicker.get(t)).filter(Boolean);
    });
  
    persistTickers(newTickers);
  
    setDragTicker(null);
    setDragOverTicker(null);
  }, [dragTicker, tickers, persistTickers]);



  const handleAddTicker = () => {
    const toAdd = addInput.split(",")
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0 && !tickers.includes(t));
    if (toAdd.length === 0) { setAddInput(""); return; }
    const newList = [...tickers, ...toAdd];
    setTickers(newList);
    persistTickers(newList);
    setAddInput("");
    scan(toAdd).then(() => {}); // scan only new ones, merge results
  };

  const handleRemoveTicker = useCallback((ticker) => {
    const newList = tickers.filter(t => t !== ticker);
    setTickers(newList);
    setTickerData(prev => prev.filter(d => d.ticker !== ticker));
    persistTickers(newList);
    if (selected?.ticker === ticker) setSelected(null);
  }, [tickers, selected, persistTickers]);

  const handleRescan = () => scan(tickers);

  // Add on Enter
  const handleAddKeyDown = (e) => {
    if (e.key === "Enter") handleAddTicker();
  };

  const handleAISummary = async () => {
    setSummarizing(true); setSummaryOpen(true); setAiSummary("");
    const lines = tickerData.map(d => {
      const m = normalize(d.raw);
      return `${d.ticker} $${m.price ?? ""}: opp=${m.opportunityScore !== null ? m.opportunityScore.toFixed(2) : "n/a"} tier=${formatLabel(m.opportunityTier) ?? "n/a"} flow=${m.regime ?? "n/a"} gammaRegime=${formatLabel(m.gammaRegimeLabel) ?? "n/a"} dir=${m.tradeDirection ?? "n/a"} type=${formatLabel(m.tradeType) ?? "n/a"} trend=${m.trendState ?? "n/a"} momentum=${m.momentumState ?? "n/a"} rv=${m.realizedVolState ?? "n/a"} align=${m.trendAlignmentState ?? "n/a"} iv=${m.iv !== null ? (m.iv * 100).toFixed(1) + "%" : "n/a"} ivr=${m.ivRank ?? ""} em1d=${m.em1d !== null ? "±" + m.em1d.toFixed(1) + "%" : "n/a"} gexFlip=${m.gammaFlipDist !== null ? (m.gammaFlipDist > 0 ? "+" : "") + m.gammaFlipDist.toFixed(1) + "%" : "n/a"}`;
    });
    try {
      setAiSummary(await askClaude(
        `Scan ${tickerData.length} tickers:\n${lines.join("\n")}\n\nRank the best setups from the opportunity output first. Then give 1) overall market regime 2) top 2-3 setups 3) divergences between flow/gamma/state 4) key risks. Punchy.`
      ));
    } catch (e) { setAiSummary("Error: " + e.message); }
    setSummarizing(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=Barlow+Condensed:wght@900&display=swap');
        .display { font-family: 'Barlow Condensed', sans-serif; }
      `}</style>

      <header className="border-b border-zinc-800 py-4">
  <div className="max-w-7xl mx-auto px-6 flex items-center justify-between flex-wrap gap-4">
    <div>
      <h1 className="display text-4xl font-black text-white tracking-tight">
        OPTIONS <span className="text-amber-400">SCANNER</span>
      </h1>
      <p className="text-xs text-zinc-300 mt-0.5">Trading Volatility API + Claude AI</p>
    </div>

    <button
      onClick={handleAISummary}
      disabled={summarizing || tickerData.length === 0}
      className="px-4 py-2 rounded-lg bg-amber-400 text-black text-sm font-bold hover:bg-amber-300 disabled:opacity-40 transition-all flex items-center gap-2"
    >
      {summarizing ? (
        <>
          <span className="inline-block w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
          Scanning...
        </>
      ) : (
        "⚡ Market Summary"
      )}
    </button>
  </div>

  {/* API key subrow */}
  <div
    className="mt-4 border-t border-white/[0.04]"
    style={{ background: "rgba(0,0,0,0.22)" }}
  >
    <div className="max-w-7xl mx-auto px-6 py-2 flex items-center gap-4 flex-wrap">
      {/* TV Key */}
      <div className="flex items-center gap-2">
        <span className="text-[0.9rem] tracking-[0.18em] text-slate-400 uppercase shrink-0">TV</span>
        {keyStatus.tv?.active ? (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            <span className="text-[1.0rem] text-slate-400 font-mono">{keyStatus.tv.masked}</span>
            <span className="text-[0.9rem] px-1.5 py-0.5 rounded border border-emerald-500/25 text-emerald-500 bg-emerald-500/[0.06] tracking-wider">
              FULL ACCESS
            </span>
          </div>
        ) : keyStatus.tv?.invalid ? (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            <span className="text-[1.0rem] text-slate-400 font-mono">{keyStatus.tv.masked}</span>
            <span className="text-[0.9rem] px-1.5 py-0.5 rounded border border-amber-500/25 text-amber-500 bg-amber-500/[0.06] tracking-wider">
              INVALID KEY
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span className="text-[0.9rem] text-slate-400">demo only</span>
          </div>
        )}
      </div>

      <div className="h-4 w-px bg-white/[0.06] shrink-0" />

      {/* Anthropic Key */}
      <div className="flex items-center gap-2">
        <span className="text-[0.9rem] tracking-[0.18em] text-slate-400 uppercase shrink-0">AI</span>
        {keyStatus.anthropic?.active ? (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
            <span className="text-[1.0rem] text-slate-400 font-mono">{keyStatus.anthropic.masked}</span>
            <span className="text-[0.9rem] px-1.5 py-0.5 rounded border border-amber-500/25 text-amber-600 bg-amber-500/[0.06] tracking-wider">
              ENABLED
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span className="text-[0.9rem] text-slate-400">ai disabled</span>
          </div>
        )}
      </div>

      <div className="h-4 w-px bg-white/[0.06] shrink-0" />

      {/* Key inputs */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="password"
          value={tvDraft}
          onChange={e => setTvDraft(e.target.value)}
          onKeyDown={e => e.key === "Enter" && saveKeys()}
          placeholder="TV key…"
          className="key-input w-32"
        />
        <input
          type="password"
          value={anthDraft}
          onChange={e => setAnthDraft(e.target.value)}
          onKeyDown={e => e.key === "Enter" && saveKeys()}
          placeholder="Anthropic key…"
          className="key-input w-40"
        />
        <button
          onClick={saveKeys}
          disabled={keysSaving || (!tvDraft.trim() && !anthDraft.trim())}
          className="text-[0.9rem] px-2.5 py-1.5 rounded border border-white/[0.08] text-slate-400 hover:border-amber-400/40 hover:text-amber-400 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer bg-transparent tracking-wider"
        >
          {keysSaving ? "SAVING…" : "SET"}
        </button>
        {keysError && <span className="text-[0.9rem] text-red-500">✗ {keysError}</span>}
      </div>
    </div>
  </div>
</header>

      {/* Ticker management bar */}
      <div className="border-b border-zinc-800 px-6 py-3 bg-zinc-900/50">
        <div className="max-w-7xl mx-auto space-y-2">
          {/* Tag row */}
          <div
            className="flex flex-wrap gap-1.5 items-center min-h-[28px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              setDragTicker(null);
              setDragOverTicker(null);
            }}
          >
            {tickers.map(t => (
              <TickerTag
                key={t}
                ticker={t}
                onRemove={handleRemoveTicker}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDropTicker}
                dragging={dragTicker === t}
              />
            ))}
            {tickers.length === 0 && (
              <span className="text-xs text-zinc-500 italic">No tickers — add some below</span>
            )}
            {saveStatus && (
              <span className={`text-[10px] ml-2 transition-opacity ${saveStatus === "saved" ? "text-emerald-400" : "text-zinc-400"}`}>
                {saveStatus === "saved" ? "✓ saved" : "saving..."}
              </span>
            )}
          </div>
            
          {/* Controls row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-zinc-400 text-xs uppercase tracking-widest shrink-0">Add</span>
            <input
              className="flex-1 min-w-40 max-w-xs bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400/60 transition-colors"
              value={addInput}
              onChange={e => setAddInput(e.target.value)}
              onKeyDown={handleAddKeyDown}
              placeholder="SPY, QQQ, ..."
            />
            <button
              onClick={handleAddTicker}
              disabled={!addInput.trim()}
              className="px-3 py-1.5 bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/30 disabled:opacity-30 rounded-lg text-xs text-amber-300 transition-colors font-mono"
            >
              + Add
            </button>
            <div className="w-px h-4 bg-zinc-700 mx-1" />
            <button
              onClick={handleRescan}
              disabled={loading || tickers.length === 0}
              className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded-lg text-xs transition-colors font-mono flex items-center gap-1.5"
            >
              {loading ? (
                <>
                  <span className="inline-block w-2.5 h-2.5 border border-zinc-300 border-t-transparent rounded-full animate-spin"/>
                  {loadProgress}%
                </>
              ) : "↻ Rescan"}
            </button>
            {loading && (
              <div className="flex items-center gap-2">
                <div className="h-1 w-24 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400 transition-all duration-300" style={{ width: `${loadProgress}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {Object.keys(errors).length > 0 && (
        <div className="px-6 py-2 bg-red-900/20 border-b border-red-800/30">
          <span className="text-xs text-red-400">Failed: {Object.keys(errors).join(", ")}</span>
        </div>
      )}

      {/* Filter bar */}
      <div className="border-b border-zinc-800 px-6 py-2 bg-zinc-900/30">
        <div className="max-w-7xl mx-auto flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-zinc-400 uppercase tracking-widest shrink-0">Filter</span>
          {["All", "Top Opportunities", "Directional", "Mean Reversion", "Conflicting", "Elevated Vol", "High IVR", "Fragile"].map(mode => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
                filterMode === mode
                  ? "border-amber-400/60 text-amber-400 bg-amber-400/10"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 bg-transparent"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {tickerData.length === 0 && !loading && (
          <div className="text-center py-20 text-zinc-400">
            <div className="display text-5xl mb-3">NO DATA</div>
            <p className="text-sm">Add tickers above and they'll be saved for next time</p>
          </div>
        )}
        {visibleCards.length === 0 && tickerData.length > 0 && !loading && (
          <div className="text-center py-20 text-zinc-500">
            <p className="text-sm">No tickers match <span className="text-amber-400">{filterMode}</span></p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibleCards.map(d => (
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
