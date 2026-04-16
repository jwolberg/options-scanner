# Opportunity Engine

## PURPOSE
Scan a universe of tickers, evaluate market regime, rank opportunities, and generate high-quality, risk-defined trades.

---

## PIPELINE

Market Data → Regime Evaluation → Opportunity Scoring → Selection → Trade Construction

---

## INPUT CONTRACT

Each ticker payload contains:

- trend_score (-5 to +5)
- trend_state (up / down / sideways)
- momentum_score (-5 to +5)
- momentum_state (strong / improving / fading / weakening)
- extension_score (-5 to +5)
- extension_state (extended / oversold / neutral)
- realized_vol_20d (annualized)
- realized_vol_state (expanding / contracting / elevated / subdued)
- trend_alignment_state (aligned / conflicting)

---

## STEP 1: REGIME CLASSIFICATION

| Trend | Volatility | Regime |
|------|-----------|--------|
| up | subdued | Trending Low-Vol |
| up | elevated | Trending High-Vol |
| sideways | subdued | Range Bound |
| sideways | elevated | Choppy |
| down | subdued | Downtrend |
| down | elevated | Panic  |

---

## STEP 2: OPPORTUNITY SCORING

direction_score  = abs(trend_score)
momentum_bonus   = 1 if momentum_state in [strong, improving]
alignment_bonus  = 1.5 if aligned
vol_penalty      = -1 if sideways + elevated vol
mean_rev_bonus   = 1 if extension + conflicting

opportunity_score = clamp(total, 0–10)

---

## STEP 3: CROSS-TICKER SELECTION

- Rank by opportunity_score
- Select top 3–5
- Avoid duplicate exposures (same regime/sector)
- Flag correlation risks

---

## STEP 4: SIGNAL ARBITRATION

- Positive gamma → mean reversion bias
- Negative gamma → directional bias
- Elevated IV → prefer premium selling
- Conflicting signals → reduce score

---

## STEP 5: TIMEFRAME ALIGNMENT

- Short-term → momentum + extension
- Medium-term → trend + alignment
- Vol trades → volatility regime

---

## OUTPUT

For each selected ticker:

- Regime
- Opportunity Score
- Trade Idea
- Risk Plan

---

## SUCCESS CRITERIA

- Top setups only (no noise)
- Clean trade structures
- Clear invalidation