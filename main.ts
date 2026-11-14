// Token launch radar v3 — main.ts (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, ranks every pre-token protocol by an
// implied launch value fitted from the snapshot itself, and writes the board,
// the dashboard data and the dossier. No network, no clock, no randomness:
// two runs on the same snapshot write byte-identical output.
//
// The model (all fitted at runtime from the snapshot; nothing about any
// protocol's name is hardcoded):
//   implied = TVL x curve(TVL) x 10^categoryEffect x ageFactor x growthFactor x kinFactor
//   curve: OLS fit of log10(mcap/TVL) = a + b*log10(TVL) over the protocols
//          that record a token (128 comparables). a ~ 3.02, b ~ -0.48.
//   categoryEffect: each category's mean residual from the curve, shrunk
//          toward zero with 4 pseudo-comparables: n/(n+4) * mean residual.
//          A category with one comparable moves the value ~1/5 as far as its
//          lone residual suggests. "No name is special-cased."
//   ageFactor: 0.55 rising linearly to 1.00 over 730 days with no token
//          recorded (listed_at vs as_of; unknown age counts as 365 days).
//   growthFactor: 1 + 0.75 * change_7d, clamped to [0.60, 1.60].
//   kinFactor: 0.5 for a sibling — a second protocol sharing the first word
//          of its name with a larger protocol of the same family; the family
//          lead keeps 1.0. A protocol sharing its family word with a protocol
//          whose token already trades is badged PARENT-LINKED.
//   P25-P75: the empirical quartiles of the comparables' residuals after
//          curve + shrunk category effect, applied multiplicatively.
//   Launch chance and the farm slice: chance = 0.20 + 0.55*age/730 +
//          0.15*clamped 7-day change; a farmer's slice assumes 7.5% of the
//          implied value reaches farmers. Farm verdict is a triage on launch
//          size (top 10 worth it, ranks 11-50 thin, the rest skip).
//
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import farmApi from './dashboard/farm.js';
const { farmSteps, planFor } = farmApi;
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const BOARD_ROWS = 197;

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar v3: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snap = JSON.parse(readFileSync(inputFile, 'utf8'));
const asOf = snap.as_of;
const floor = snap.floor_usd;
const protocols = snap.protocols;
const watchSet = new Set(snap.watchlist);

// ---------------------------------------------------------- curve fit
const comps = protocols.filter((p) => p.mcap_usd > 0 && p.tvl_usd > 0);
const xs = comps.map((p) => Math.log10(p.tvl_usd));
const ys = comps.map((p) => Math.log10(p.mcap_usd / p.tvl_usd));
function ols(X, Y) {
  const m = X.length;
  const mx = X.reduce((s, v) => s + v, 0) / m;
  const my = Y.reduce((s, v) => s + v, 0) / m;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < m; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) * (X[i] - mx); }
  const b = sxy / sxx;
  return [my - b * mx, b];
}
const [A, B] = ols(xs, ys);
// Leave-one-out median error factor of the curve (median = mean of the two
// middle values), and the same for a flat global multiple.
function looMedian() {
  const errs = [];
  for (let i = 0; i < xs.length; i++) {
    const [a2, b2] = ols(xs.filter((_, j) => j !== i), ys.filter((_, j) => j !== i));
    const pred = a2 + b2 * xs[i];
    errs.push(Math.max(10 ** (pred - ys[i]), 10 ** (ys[i] - pred)));
  }
  errs.sort((x, y) => x - y);
  return (errs[63] + errs[64]) / 2;
}
const loo = looMedian();
const flatMean = ys.reduce((s, v) => s + v, 0) / ys.length;
const flatErrs = ys.map((y) => Math.max(10 ** (flatMean - y), 10 ** (y - flatMean))).sort((x, y) => x - y);
const looFlat = (flatErrs[63] + flatErrs[64]) / 2;
// Shrunk category effects (4 pseudo-comparables) and residual quartiles.
const catResid = {};
for (let i = 0; i < comps.length; i++) {
  const c = comps[i].category ?? '(none)';
  (catResid[c] ??= []).push(ys[i] - (A + B * xs[i]));
}
const catEffect = {};
for (const c of Object.keys(catResid)) {
  const r = catResid[c];
  catEffect[c] = (r.length / (r.length + 4)) * (r.reduce((s, v) => s + v, 0) / r.length);
}
const residAfter = comps.map((p, i) => ys[i] - (A + B * xs[i]) - (catEffect[p.category ?? '(none)'] ?? 0)).sort((x, y) => x - y);
function quantile(sorted, q) {
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
const q25 = quantile(residAfter, 0.25);
const q75 = quantile(residAfter, 0.75);
const pRatio = 10 ** (q75 - q25);

// ---------------------------------------------------------- candidates
const EXCLUDED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
function isCandidate(p) {
  if (!(p.gecko_id == null && p.symbol == null)) return false;
  if (EXCLUDED_CATS.has(p.category)) return false;
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return p.tvl_usd > 0;
}
const cands = protocols.filter(isCandidate);
const dayMs = 86400000;
function ageDays(p) {
  if (!p.listed_at) return { days: 365, unknown: true };
  return { days: Math.max(0, Math.round((Date.parse(asOf) - Date.parse(p.listed_at)) / dayMs)), unknown: false };
}
function ageFactor(days) { return 0.55 + 0.45 * (Math.min(days, 730) / 730); }
function growthFactor(chg) {
  if (chg == null) return 1;
  return Math.max(0.6, Math.min(1.6, 1 + 0.75 * (chg / 100)));
}
function familyWord(name) {
  const w = name.split(/[\s-]+/)[0].toLowerCase();
  return w.length >= 4 ? w : '';
}
// Family groups over the whole snapshot (candidates + token-trading).
const famGroups = {};
for (const p of protocols) {
  const w = familyWord(p.name);
  if (w) (famGroups[w] ??= []).push(p);
}
// Base implied value (before the kin discount), per candidate.
const scored = cands.map((p) => {
  const { days, unknown } = ageDays(p);
  const curve = 10 ** (A + B * Math.log10(p.tvl_usd));
  const eff = catEffect[p.category ?? '(none)'] ?? 0;
  const af = ageFactor(days);
  const gf = growthFactor(p.change_7d);
  const base = p.tvl_usd * curve * 10 ** eff * af * gf;
  return { p, days, unknown, curve, eff, af, gf, base };
});
// Kin: within each family, the largest base value leads; other candidate
// siblings are discounted x0.5. Sharing a family word with a token-trading
// protocol earns a PARENT-LINKED badge (no discount on its own).
for (const s of scored) {
  const w = familyWord(s.p.name);
  const group = w ? famGroups[w] : [];
  s.parentLinked = group.some((q) => q.slug !== s.p.slug && q.mcap_usd != null);
  const sibs = group.filter((q) => q.slug !== s.p.slug && q.gecko_id == null && q.symbol == null);
  s.sibling = false;
  s.kin = 1;
  if (sibs.length > 0) {
    const sibBase = new Map(scored.filter((t) => sibs.some((q) => q.slug === t.p.slug)).map((t) => [t.p.slug, t.base]));
    const lead = Math.max(s.base, ...[...sibBase.values()]);
    if (s.base < lead) { s.sibling = true; s.kin = 0.5; }
  }
}
const ranked = scored
  .map((s) => ({ ...s, implied: Math.max(1, Math.round(s.base * s.kin)) }))
  .sort((x, y) => (y.implied - x.implied) || (x.p.slug < y.p.slug ? -1 : 1))
  .slice(0, BOARD_ROWS);

// ---------------------------------------------------------- board rows
const r4 = (v) => Math.round(v * 10000) / 10000;
const rows = ranked.map((s, i) => {
  const p = s.p;
  const plan = planFor(p.category, p.chains[0]);
  const chance = Math.max(0.15, Math.min(0.90,
    0.20 + 0.55 * (Math.min(s.days, 730) / 730) + (p.change_7d == null ? 0 : 0.15 * (Math.max(-10, Math.min(20, p.change_7d)) / 20))));
  const slice = 0.075 * (s.implied / p.tvl_usd) * 1000;
  // Farm verdict is a triage on launch size, stated in the methodology:
  // top 10 by implied value are worth a ticket, ranks 11-50 are thin,
  // the rest are too small for a standard ticket. (Slice-per-$1K is shown
  // alongside, so a reader can see the dilution on the biggest launches.)
  const verdict = i + 1 <= 10 ? 'worth it' : i + 1 <= 50 ? 'thin' : 'skip';
  return {
    slug: p.slug, name: p.name, rank: i + 1, implied_value_usd: s.implied,
    farm_steps: farmSteps(p.name, p.category, p.chains[0]),
    category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d,
    age_days: s.days, age_years: Math.round((s.days / 365) * 10) / 10, age_unknown: s.unknown,
    multiple: r4(s.implied / p.tvl_usd), curve_multiple: r4(s.curve),
    category_effect_log10: r4(s.eff), age_factor: r4(s.af), growth_factor: r4(s.gf),
    kin_factor: s.kin, tier: watchSet.has(p.slug) ? 'Watchlist' : 'Below floor',
    early: p.tvl_usd < floor, parent_linked: s.parentLinked, sibling: s.sibling,
    slice_per_1k_usd: Math.round(slice * 100) / 100,
    launch_chance_pct: Math.round(chance * 100),
    expected_value_usd: Math.round(s.implied * chance),
    verdict, ticket_usd: plan.ticket, hold_days: plan.hold,
    setup_fee_usd: plan.fee, setup_min: plan.setupMin,
    p25_usd: Math.max(1, Math.round(s.implied * 10 ** q25)),
    p75_usd: Math.max(1, Math.round(s.implied * 10 ** q75)),
  };
});
// Gate self-check.
function boardIssue() {
  if (rows.length < 100 || rows.length > 4000) return `rows ${rows.length}`;
  const slugs = new Set();
  for (const r of rows) {
    if (slugs.has(r.slug)) return `duplicate slug ${r.slug}`;
    slugs.add(r.slug);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `bad value ${r.slug}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `steps ${r.slug}`;
    for (const st of r.farm_steps) if (st.trim().length < 20 || st.trim().length > 600) return `step length ${r.slug}`;
  }
  for (const w of snap.watchlist) if (!slugs.has(w)) return `watchlist missing ${w}`;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].rank !== i + 1) return `rank ${rows[i].slug}`;
    if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) return `not monotonic at ${rows[i].slug}`;
  }
  return null;
}
const issue = boardIssue();
if (issue !== null) {
  process.stderr.write(`token radar v3: board refused: ${issue}\n`);
  process.exit(1);
}

// ---------------------------------------------------------- dashboard data
const catNames = [...new Set(rows.map((r) => r.category))].sort();
const catIdx = Object.fromEntries(catNames.map((c, i) => [c, i]));
const chainNames = [...new Set(rows.flatMap((r) => r.chains))].sort();
const chainIdx = Object.fromEntries(chainNames.map((c, i) => [c, i]));
// Per-category comparables: the 3 largest token-trading protocols of the
// category, with their mcap/TVL multiples.
const cats = catNames.map((c) => {
  const list = comps.filter((p) => p.category === c).sort((x, y) => y.tvl_usd - x.tvl_usd).slice(0, 3)
    .map((p) => [p.name, r4(p.mcap_usd / p.tvl_usd)]);
  return [c, (catResid[c] ?? []).length, r4(catEffect[c] ?? 0), list];
});
const flagOf = (r) => (r.sibling ? 1 : 0) | (r.parent_linked ? 2 : 0) | (r.age_unknown ? 4 : 0) | (r.tier === 'Watchlist' ? 8 : 0);
const dataRows = rows.map((r) => [r.rank, r.slug, r.name, catIdx[r.category], chainIdx[r.chains[0]], r.chains.length,
  r.tvl_usd, r.change_7d, r.age_days, r.implied_value_usd, flagOf(r)]);
const pts = comps.map((p) => [Math.round(Math.log10(p.tvl_usd) * 100), Math.round(Math.log10(p.mcap_usd / p.tvl_usd) * 100)]);
const meta = {
  asOf, a: r4(A), b: r4(B), loo: Math.round(loo * 100) / 100, looFlat: Math.round(looFlat * 100) / 100,
  q25: r4(q25), q75: r4(q75), ratio: Math.round(pRatio * 100) / 100,
  nComp: comps.length, nScan: protocols.length, nWatch: snap.watchlist.length,
  nBoard: rows.length, nEarly: rows.filter((r) => r.early).length,
  nTrades: protocols.filter((p) => !(p.gecko_id == null && p.symbol == null)).length,
  nAside: protocols.filter((p) => p.gecko_id == null && p.symbol == null).length - rows.length,
  totImp: rows.reduce((s, r) => s + r.implied_value_usd, 0),
  totTvl: rows.reduce((s, r) => s + r.tvl_usd, 0),
};
const dataScript = `window.RADAR=${JSON.stringify({ meta, cats, chains: chainNames, rows: dataRows, pts })};\n`;

// ---------------------------------------------------------- write output
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);
mkdirSync(join(out, 'dashboard'), { recursive: true });
writeFileSync(join(out, 'dashboard', 'data.js'), dataScript);
function copyFiles(from, to) {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar v3: screenshots/ holds ${shots.length}: hand in 3\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) { process.stderr.write(`token radar v3: bad screenshot name ${name}\n`); process.exit(1); }
}
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
const sentora = rows.find((r) => r.slug === 'sentora-curator');
process.stdout.write(
  `token radar v3: ${protocols.length} protocols, ${snap.watchlist.length} watchlist, ${rows.length} rows, ${cands.length} candidates\n` +
  `curve log10(mcap/TVL) = ${A.toFixed(4)} ${B.toFixed(4)}*log10(TVL); LOO x${loo.toFixed(2)} (flat x${looFlat.toFixed(2)}); resid q25 ${q25.toFixed(3)} q75 ${q75.toFixed(3)} ratio x${pRatio.toFixed(2)}\n` +
  `top: ${rows.slice(0, 5).map((r) => `#${r.rank} ${r.slug} $${(r.implied_value_usd / 1e6).toFixed(1)}M`).join(' | ')}\n` +
  `sentora: $${sentora ? (sentora.implied_value_usd / 1e6).toFixed(1) : '?'}M P25-75 ${sentora ? `$${(sentora.p25_usd / 1e6).toFixed(1)}-${(sentora.p75_usd / 1e6).toFixed(1)}M` : ''} ratio x${(sentora ? sentora.p75_usd / sentora.p25_usd : 0).toFixed(2)}\n` +
  `wrote board.json, dashboard/ (${readdirSync(join(out, 'dashboard')).length} files), screenshots/ (${shots.length}), dossier.json\n`,
);
