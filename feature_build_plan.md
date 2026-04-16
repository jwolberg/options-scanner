# Feature Build Plan

## Goal

Update the frontend to consume `trade_recommendation` and `market_state` from the `/api/v2/tickers/<ticker>` response while:

- fully replacing the frontend's current heuristic tiering with `trade_recommendation.opportunity_tier`
- keeping `call_flow.regime` visible as the existing flow regime signal
- adding `trade_recommendation.regime_label` as a separate gamma regime signal
- keeping `/market-structure` integrated for now as secondary context

## Phase 1: Data Model

### Ticket FBP-1
Normalize `trade_recommendation` into the frontend view model.

Acceptance criteria:
- `normalize()` exposes `opportunityScore`, `opportunityTier`, `tradeDirection`, `tradeBias`, `tradeType`, and `gammaRegimeLabel`
- null-safe handling for partial payloads

### Ticket FBP-2
Normalize `market_state` into the frontend view model.

Acceptance criteria:
- `normalize()` exposes trend, momentum, extension, realized vol, realized vol 20d, and trend alignment score/state pairs
- score ranges display correctly without double-scaling

### Ticket FBP-3
Replace heuristic opportunity tier derivation.

Acceptance criteria:
- current `computeTier()` no longer derives `READY`, `SETUP FORMING`, or `WATCH`
- displayed tier comes from `trade_recommendation.opportunity_tier`
- fallback behavior is safe when the field is missing

## Phase 2: Ticker Card UI

### Ticket FBP-4
Promote recommendation data into the ticker card header.

Acceptance criteria:
- header follows a top-down summary flow: identity, recommendation, thesis, context
- card header shows one canonical opportunity score treatment with no duplicate score labels
- card keeps `call_flow.regime` as secondary context rather than headline data
- card adds `trade_recommendation.regime_label` as a clearly labeled gamma regime badge
- card surfaces `direction` and `trade_type` in the primary recommendation block
- card presents `trade_bias` as a short thesis line instead of another peer badge

### Ticket FBP-5
Add a dedicated market state section.

Acceptance criteria:
- card shows trend, momentum, extension, realized vol, and trend alignment
- labels and score bars are compact and scannable
- realized vol 20d is displayed in a readable format

### Ticket FBP-6
Keep `/market-structure` visible as secondary context.

Acceptance criteria:
- existing market-structure headline/signal remains available
- UI hierarchy makes recommendation/state primary and market-structure secondary

### Ticket FBP-6A
Demote supporting diagnostics below the recommendation summary.

Acceptance criteria:
- IV/IVR and speculation no longer compete visually with opportunity score/tier
- the first screenful of the card answers what the recommendation is before showing diagnostic metrics
- more detailed context remains available lower in the card without removal of useful data

## Phase 3: Filtering and Ranking

### Ticket FBP-7
Update card filtering to use recommendation and market state.

Acceptance criteria:
- filters no longer depend on the replaced heuristic tier
- at least one filter targets opportunity tier
- regime and state-based filters use normalized v2 fields

### Ticket FBP-8
Preserve backward-safe behavior for missing fields.

Acceptance criteria:
- cards render without crashes if `trade_recommendation` or `market_state` is absent
- filters degrade safely on incomplete payloads

## Phase 4: AI Context

### Ticket FBP-9
Update single-ticker AI prompts to include recommendation and market state.

Acceptance criteria:
- prompt contains opportunity score/tier, gamma regime label, direction, trade type, trade bias
- prompt contains market state labels and scores
- existing supporting metrics remain available

### Ticket FBP-10
Update cross-ticker summary prompt to rank from recommendation output.

Acceptance criteria:
- per-ticker summary line includes opportunity score/tier and market state context
- AI summary prompt is aligned with opportunity-engine ranking semantics

## Phase 5: Verification

### Ticket FBP-11
Run frontend verification.

Acceptance criteria:
- project builds successfully
- no obvious null/formatting regressions in the updated UI code paths

## Build Order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5

## Notes

- `call_flow.regime` and `trade_recommendation.regime_label` must remain separate concepts in the UI
- `/market-structure` stays in place until there is a deliberate removal pass
- `opportunity_tier` replaces the frontend-only tier heuristic completely
