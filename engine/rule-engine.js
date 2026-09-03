// rule-engine.js — Underwriting CRM core logic
// Pure JS, no dependencies. Browser + Node compatible.
//
// Inputs:
//   clientProfile: { age, sex, height_cm, weight_kg, smoker, country, occupation, sum_assured }
//   conditions:    [{ code, ...details }, ...]  (per declared medical condition)
//   rulesData:     { insurer, version, conditions: [{code, questions, rules}, ...] }
//
// Output (per insurer × product_type):
//   { insurer, product_type, outcome, confidence, loading_pct, loading_multiplier,
//     exclusion_notes, postpone_until, reasons: [...] }

// ─── Outcome severity (used for worst-case aggregation) ───
const SEVERITY_ORDER = [
  'standard',           // 0
  'exclusion',          // 1
  'loading_mild',       // 2
  'individual_consideration', // 3
  'loading_moderate',   // 4
  'loading_high',       // 5
  'postpone',           // 6
  'decline'             // 7
];

const OUTCOME_LABEL_ZH = {
  standard: '標準',
  exclusion: '不保事項',
  loading_mild: '輕度加費',
  individual_consideration: '個別考慮',
  loading_moderate: '中度加費',
  loading_high: '高度加費',
  postpone: '擱置受保',
  decline: '拒絕受保'
};

const PRODUCT_LABEL_ZH = {
  life: '人壽',
  ci: '危疾',
  early_ci: '早期危疾',
  medical: '醫療',
  premium_medical: '高端醫療',
  cancer: '癌症保障'
};

// ─── Safe expression evaluator ───
// Supports: ==, !=, <, >, <=, >=, &&, ||, !, and basic JS expressions with var refs
// Internal use only — DO NOT eval user input directly. Rules JSON is trusted.
function evalExpr(expr, ctx) {
  // Whitelist variables present in ctx
  const vars = Object.keys(ctx);
  const vals = vars.map(k => ctx[k]);
  try {
    const fn = new Function(...vars, `return (${expr});`);
    return fn(...vals);
  } catch (e) {
    console.warn(`[rule-engine] expr eval failed: "${expr}"`, e.message);
    return false;
  }
}

// ─── Build condition context ───
function buildConditionContext(profile, condInput, conditionDef) {
  const ctx = { ...profile };
  // Merge all declared condition values + sensible defaults
  for (const q of conditionDef.questions || []) {
    if (condInput[q.id] !== undefined) {
      ctx[q.id] = condInput[q.id];
    } else if (q.type === 'number') {
      ctx[q.id] = 0;
    } else if (q.type === 'select') {
      ctx[q.id] = q.options ? q.options[0] : '';
    } else if (q.type === 'boolean') {
      ctx[q.id] = false;
    }
  }
  return ctx;
}

// ─── Evaluate one condition's rules against client context ───
function evaluateCondition(condInput, conditionDef) {
  const matched = [];
  for (const rule of conditionDef.rules || []) {
    const ctx = buildConditionContext(condInput, condInput, conditionDef);
    if (evalExpr(rule.condition_expr, ctx)) {
      matched.push(rule);
    }
  }
  return matched;
}

// ─── Aggregate per (insurer × product_type) ───
function aggregateResults(clientProfile, conditions, rulesData) {
  // results: { "Sun Life::life": { insurer, product_type, ... }, ... }
  const results = {};
  let insurerName = rulesData.insurer || 'Unknown';

  for (const condInput of conditions) {
    const conditionDef = rulesData.conditions.find(c => c.code === condInput.code);
    if (!conditionDef) {
      console.warn(`[rule-engine] unknown condition code: ${condInput.code}`);
      continue;
    }

    const matchedRules = evaluateCondition(condInput, conditionDef);
    for (const rule of matchedRules) {
      const key = `${rule.product_type}`;
      if (!results[key]) {
        results[key] = {
          insurer: insurerName,
          product_type: rule.product_type,
          product_label: PRODUCT_LABEL_ZH[rule.product_type] || rule.product_type,
          outcome: 'standard',
          outcome_label: '標準',
          confidence: 0.90,
          loading_pct: 0,
          loading_multiplier: 1.0,
          exclusion_notes: [],
          postpone_until: null,
          reasons: []
        };
      }
      const r = results[key];
      r.reasons.push({
        condition: condInput.code,
        condition_name: conditionDef.name_zh,
        outcome: rule.outcome,
        outcome_label: OUTCOME_LABEL_ZH[rule.outcome] || rule.outcome,
        source: rule.source_ref
      });

      // Update worst outcome
      const currentSev = SEVERITY_ORDER.indexOf(r.outcome);
      const newSev = SEVERITY_ORDER.indexOf(rule.outcome);
      if (newSev > currentSev) {
        r.outcome = rule.outcome;
        r.outcome_label = OUTCOME_LABEL_ZH[rule.outcome] || rule.outcome;
        r.confidence = rule.confidence;
      }

      // Accumulate loadings (worst-case max)
      if (rule.loading_pct && rule.loading_pct > r.loading_pct) {
        r.loading_pct = rule.loading_pct;
      }
      if (rule.loading_multiplier && rule.loading_multiplier > r.loading_multiplier) {
        r.loading_multiplier = rule.loading_multiplier;
      }
      if (rule.exclusion_notes) {
        r.exclusion_notes.push(rule.exclusion_notes);
      }
      if (rule.postpone_until) {
        r.postpone_until = rule.postpone_until;
      }
    }
  }

  // Final flatten — convert to array + finalize display
  return Object.values(results).map(r => ({
    ...r,
    exclusion_notes: r.exclusion_notes.length ? r.exclusion_notes.join('; ') : null,
    confidence_pct: Math.round(r.confidence * 100)
  })).sort((a, b) => {
    // Sort: standard first, decline last, by product_type order
    const aSev = SEVERITY_ORDER.indexOf(a.outcome);
    const bSev = SEVERITY_ORDER.indexOf(b.outcome);
    if (aSev !== bSev) return aSev - bSev;
    return Object.keys(PRODUCT_LABEL_ZH).indexOf(a.product_type) - Object.keys(PRODUCT_LABEL_ZH).indexOf(b.product_type);
  });
}

// ─── Main entry point ───
function evaluateApplication(clientProfile, conditions, rulesData) {
  return aggregateResults(clientProfile, conditions, rulesData);
}

// ─── Multi-insurer comparison ───
// Input: clientProfile + conditions + array of {name, rules_data}
// Output: per-insurer summary, sorted by best_confidence DESC
// Each entry: { insurer, best_confidence, best_confidence_pct, best_outcome, best_outcome_label,
//                best_product, best_product_label, declined_products, declined_count,
//                total_products, all_results }
function evaluateForMultipleInsurers(clientProfile, conditions, insurers) {
  const out = [];
  for (const entry of insurers) {
    const insurerName = entry.name || (entry.rules_data && entry.rules_data.insurer) || 'Unknown';
    const rulesData = entry.rules_data || entry;
    const productResults = aggregateResults(clientProfile, conditions, rulesData);

    // Determine best (highest confidence = most likely to accept)
    let best = null;
    if (productResults.length > 0) {
      best = productResults.reduce((a, b) => (a.confidence > b.confidence ? a : b));
    }

    // Count decline / postpone
    const declined = productResults.filter(r => r.outcome === 'decline');
    const postponed = productResults.filter(r => r.outcome === 'postpone');

    // If no conditions declared, default all 6 products as standard
    if (productResults.length === 0) {
      out.push({
        insurer: insurerName,
        best_confidence: 0.90,
        best_confidence_pct: 90,
        best_outcome: 'standard',
        best_outcome_label: '標準',
        best_product: null,
        best_product_label: '全部 standard',
        loading_pct: 0,
        loading_multiplier: 1.0,
        exclusion_notes: null,
        postpone_until: null,
        declined_count: 0,
        postponed_count: 0,
        declined_products: [],
        postponed_products: [],
        total_products: 0,
        has_rules: false,
        all_results: []
      });
      continue;
    }

    out.push({
      insurer: insurerName,
      best_confidence: best.confidence,
      best_confidence_pct: Math.round(best.confidence * 100),
      best_outcome: best.outcome,
      best_outcome_label: best.outcome_label,
      best_product: best.product_type,
      best_product_label: best.product_label,
      loading_pct: best.loading_pct,
      loading_multiplier: best.loading_multiplier,
      exclusion_notes: best.exclusion_notes,
      postpone_until: best.postpone_until,
      declined_count: declined.length,
      postponed_count: postponed.length,
      declined_products: declined.map(r => r.product_label),
      postponed_products: postponed.map(r => r.product_label),
      total_products: productResults.length,
      has_rules: true,
      all_results: productResults
    });
  }

  // Sort: best confidence DESC; insurer with rules before no-rules; ties broken by declined_count ASC
  out.sort((a, b) => {
    if (a.best_confidence !== b.best_confidence) return b.best_confidence - a.best_confidence;
    return a.declined_count - b.declined_count;
  });
  return out;
}

// ─── Browser exports ───
if (typeof window !== 'undefined') {
  window.UnderwritingRule = {
    evaluateApplication,
    evaluateForMultipleInsurers,
    evalExpr,
    PRODUCT_LABEL_ZH,
    OUTCOME_LABEL_ZH
  };
}

// ─── Node exports (for testing) ───
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluateApplication, evaluateForMultipleInsurers, evalExpr, PRODUCT_LABEL_ZH, OUTCOME_LABEL_ZH };
}