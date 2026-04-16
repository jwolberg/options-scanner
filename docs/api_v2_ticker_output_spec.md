{
  "data": {
    "call_flow": {
      "regime": "hedging/overwrite",
      "speculative_interest_score": 0.2
    },
    "derived": {
      "dist_to_gex_flip_pct": -6.215652833049093,
      "distance_to_minus_1sigma_price": -8.375495976128125,
      "distance_to_plus_1sigma_price": 8.375495976128125
    },
    "expected_move": {
      "expected_move_pct_1d": 1.8276830615907218,
      "expected_move_pct_1w": 4.086823567041789,
      "expected_move_pct_30d": 8.375495976128121,
      "levels": {
        "price_minus_1sigma": 241.75125386698596,
        "price_plus_1sigma": 285.9487461330141
      },
      "sigma_wings": {
        "iv_at_minus_1sigma": 0.3358472414926309,
        "iv_at_plus_1sigma": 0.2869415486078851
      }
    },
    "gamma": {
      "flip": {
        "dist_pct": -6.215652833049093,
        "price": 247.45
      },
      "flow_context": {
        "avg_volume": 26169045,
        "gex_volume_ratio": 0.061
      },
      "gamma_notional_per_1pct_move_usd": 966965894.1765001,
      "structure": {
        "max_gamma_strike": 270,
        "nearest_exp_gamma_notional_per_1pct_move_usd": 453488422.36050004,
        "nearest_expiration_date": "2026-04-17",
        "pct_gamma_expiring_nearest_expiry": 0.46898078318129893
      }
    },
    "market_state": {
      "extension": {
        "score": 2.262242712026326,
        "state": "extended"
      },
      "model_version": "v1",
      "momentum": {
        "score": -0.09425707033314223,
        "state": "weakening"
      },
      "realized_vol": {
        "score": -0.20349775852214463,
        "state": "subdued"
      },
      "realized_vol_20d": 0.23880534191518293,
      "trend": {
        "score": 4.164910878660208,
        "state": "up"
      },
      "trend_alignment": {
        "score": 0,
        "state": "conflicting"
      }
    },
    "positioning": {
      "put_call": {
        "call_oi": 1487587,
        "call_vol": 0,
        "pcr_oi": 0.57,
        "pcr_oi_change": {
          "d30": -0.03,
          "d60": 0.05
        },
        "pcr_volume": 0.22,
        "put_oi": 851223,
        "put_vol": 0
      },
      "skew": {
        "baselines": {
          "put_call_iv_ratio_25delta": 0.2180009008590764,
          "put_call_iv_spread": 0.09082172392681954
        },
        "put_call_iv_ratio_25delta": 1.0950948463596462,
        "put_call_iv_spread": 0.04890569288474578,
        "skew_reference_dte_days": 29.27718781740741
      }
    },
    "trade_recommendation": {
      "direction": "short",
      "model_version": "1.0.0",
      "opportunity_score": 5.16,
      "opportunity_tier": "moderate",
      "regime_label": "trending_low_vol",
      "trade_bias": "Long breakouts, buy dips to MA",
      "trade_type": "mean_reversion"
    },
    "underlying": {
      "iv": {
        "atm_iv": 0.29013569138485185,
        "iv_1d_pct_chg": -0.71,
        "iv_rank": 20.6,
        "max_iv": 0.832450384789,
        "min_iv": 0.14968110119047617
      },
      "price": 263.85
    }
  },
  "meta": {
    "asof": "2026-04-16T13:35:55Z",
    "data_flags": {
      "chain_ok": true,
      "pcr_vol_from_yesterday": true
    },
    "model_versions": {
      "call_regime": null,
      "gex": null,
      "skew": null,
      "state_model": "v1",
      "trade_recommender": "1.0.0"
    },
    "schema": "tv.ticker.state.v2",
    "ticker": "AAPL"
  }
}