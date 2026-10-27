// Pure evaluation helpers for the LPM playground: no DOM, no GPU. Every number the page shows about accuracy is computed here
// from the model's real answers (rows) and from the datasets in data/*.json.
//
// A row is { id, text, gold, pred, margin, ambiguous, note }. "Auto-handled" means the program acts alone: the margin reached
// the threshold and the label is not one the rules always send to a person.

/** Wilson score interval for k successes in n trials (95% by default). Returns fractions in [0, 1]. */
export function wilson(k, n, z = 1.96) {
  if (n === 0) return { lo: 0, hi: 0, p: 0 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d), p };
}

export const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;

/** True when the program may act on this row alone. */
export function isAuto(row, threshold, alwaysHuman = []) {
  return row.margin >= threshold && !alwaysHuman.includes(row.pred);
}

/** Counts for one threshold over a list of rows. */
export function summarize(rows, threshold, alwaysHuman = []) {
  const n = rows.length;
  const correct = rows.filter((r) => r.pred === r.gold).length;
  const auto = rows.filter((r) => isAuto(r, threshold, alwaysHuman));
  const autoCorrect = auto.filter((r) => r.pred === r.gold).length;
  return { n, correct, auto: auto.length, autoCorrect, human: n - auto.length };
}

/**
 * The lowest threshold at which the auto-handled rows are at least `target` correct (and at least `minAuto` rows are
 * auto-handled, so one lucky row cannot set the bar). Candidates are 0 and every distinct margin in the rows.
 * If none qualifies, returns { reached: false } with the best auto-accuracy that did have `minAuto` rows.
 */
export function chooseThreshold(rows, alwaysHuman = [], target = 0.9, minAuto = 5) {
  const cands = [...new Set([0, ...rows.map((r) => r.margin)])].sort((a, b) => a - b);
  let best = null;
  for (const t of cands) {
    const s = summarize(rows, t, alwaysHuman);
    if (s.auto < minAuto) continue;
    const acc = s.autoCorrect / s.auto;
    if (acc >= target) return { reached: true, threshold: t, ...s, autoAcc: acc, target, minAuto };
    if (!best || acc > best.autoAcc) best = { threshold: t, ...s, autoAcc: acc };
  }
  return { reached: false, target, minAuto, best };
}

/** Confusion matrix: m[gold][pred] counts, over the label ids given. */
export function confusion(rows, labelIds) {
  const m = Object.fromEntries(labelIds.map((g) => [g, Object.fromEntries(labelIds.map((p) => [p, 0]))]));
  for (const r of rows) m[r.gold][r.pred] += 1;
  return m;
}

/** Margin curve for the slider chart: auto share and auto accuracy at each step from 0 to max. */
export function curve(rows, alwaysHuman, max, steps = 60) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (max * i) / steps;
    const s = summarize(rows, t, alwaysHuman);
    out.push({ t, share: s.n ? s.auto / s.n : 0, acc: s.auto ? s.autoCorrect / s.auto : null });
  }
  return out;
}

// ---- baselines (same rules as the Python reference, run in the browser) ------------------------------------

/** Majority label over dev + test, applied to every test row (the reference definition). */
export function majorityLabel(items) {
  const counts = new Map();
  // dev items first, then test: ties go to the label seen first, as in the reference (Counter over dev + test)
  const pool = [...items.filter((i) => i.split === "dev"), ...items.filter((i) => i.split === "test")];
  for (const i of pool) counts.set(i.label, (counts.get(i.label) ?? 0) + 1);
  let best = null;
  for (const [k, v] of counts) if (!best || v > best[1]) best = [k, v];
  return best[0];
}

function luhn(digits) {
  let s = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    s += d;
    alt = !alt;
  }
  return s % 10 === 0;
}

/** The plain regex check for personal data and secrets: returns clean | personal-data | secret-or-credential. */
export function sensitiveRegexCheck(rulesJson) {
  const R = rulesJson.sensitive;
  const secret = new RegExp(R.secret);
  const email = new RegExp(R.email);
  const phone = new RegExp(R.phone);
  const ssn = new RegExp(R.ssn);
  const card = new RegExp(R.card, "g");
  return (text) => {
    if (secret.test(text)) return "secret-or-credential";
    if (email.test(text) || phone.test(text) || ssn.test(text)) return "personal-data";
    for (const m of text.matchAll(card)) {
      const d = m[0].replace(/\D/g, "");
      if (d.length >= 13 && d.length <= 19 && luhn(d)) return "personal-data";
    }
    return "clean";
  };
}

/** Keyword/regex predictor for a dataset (the rules were written from the label definitions, before the texts). */
export function keywordPredictor(datasetId, labelIds, rulesJson) {
  if (datasetId === "sensitive-text-gate") return sensitiveRegexCheck(rulesJson);
  const rules = Object.fromEntries(
    Object.entries(rulesJson.keyword[datasetId]).map(([k, ps]) => [k, ps.map((p) => new RegExp(p, "i"))]),
  );
  const fallback = rulesJson.fallback[datasetId];
  return (text) => {
    let best = null;
    let bestScore = -1;
    for (const id of labelIds) {
      const score = (rules[id] ?? []).filter((re) => re.test(text)).length;
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : fallback;
  };
}

export const accuracyOf = (items, predict) => items.filter((i) => predict(i) === i.label).length;
