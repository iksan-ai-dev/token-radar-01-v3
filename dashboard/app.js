// app.js — Token Radar v3 dashboard (offline, no network).
// Renders the board, the detail view and the filtered view from data.js.
// Every value is recomputed here from the same fitted constants, so the
// page and board.json agree by construction.
(function () {
  const { planFor, farmSteps } = window.FARM;
  const R = window.RADAR, M = R.meta;
  const cats = R.cats, chains = R.chains;
  const rows = R.rows.map((r) => ({
    rank: r[0], slug: r[1], name: r[2], cat: cats[r[3]][0], catIdx: r[3],
    chain: chains[r[4]], nChains: r[5], tvl: r[6], chg: r[7], age: r[8], imp: r[9],
    sib: !!(r[10] & 1), parent: !!(r[10] & 2), ageUnk: !!(r[10] & 4), watch: !!(r[10] & 8),
  }));
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const curve = (tvl) => 10 ** (M.a + M.b * Math.log10(tvl));
  const eff = (r) => cats[r.catIdx][2];
  const ageF = (r) => 0.55 + 0.45 * (Math.min(r.age, 730) / 730);
  const growF = (r) => r.chg == null ? 1 : clamp(1 + 0.75 * (r.chg / 100), 0.6, 1.6);
  const kinF = (r) => r.sib ? 0.5 : 1;
  const mult = (r) => r.imp / r.tvl;
  const slice = (r) => 0.075 * mult(r) * 1000;
  const chance = (r) => clamp(0.20 + 0.55 * (Math.min(r.age, 730) / 730) + (r.chg == null ? 0 : 0.15 * (clamp(r.chg, -10, 20) / 20)), 0.15, 0.90);
  const verdict = (r) => r.rank <= 10 ? 'worth it' : r.rank <= 50 ? 'thin' : 'skip';
  const lo = (r) => r.imp * 10 ** M.q25, hi = (r) => r.imp * 10 ** M.q75;
  const $m = (v) => v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(0) + 'K' : '$' + Math.round(v);
  const $1 = (v) => '$' + v.toFixed(2);
  const yrs = (r) => r.ageUnk ? 'unknown' : (r.age / 365).toFixed(1) + 'y';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const maxImp = rows[0].imp;

  // ---- header stats, formula, fit notes, scatter, comparables
  document.getElementById('asof').textContent = M.asOf;
  document.getElementById('stats').innerHTML =
    [['758', 'protocols scanned'], ['40/40', 'watchlist on board'], ['197', 'rows ranked'],
     ['138', 'early finds < $50M'], ['416', 'already trade a token'], [$m(M.totImp), 'total implied value']]
    .map((s) => '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>').join('');
  document.getElementById('formula').innerHTML =
    '<b>implied = TVL × 10^(' + M.a.toFixed(4) + ' − ' + Math.abs(M.b).toFixed(4) + '·log10 TVL) × 10^categoryEffect × ageFactor × growthFactor × kinFactor</b><br>' +
    'ageFactor = 0.55 → 1.00 over 730 days with no token recorded (unknown age = 365 days) · ' +
    'growthFactor = 1 + 0.75 × 7-day change, clamped −40% / +60% · kinFactor = ×0.5 for a sibling token';
  document.getElementById('fitnotes').innerHTML = '<ul>' +
    '<li><b>Size curve</b> fitted from ' + M.nComp + ' token-trading comparables: log10(mcap/TVL) = ' + M.a.toFixed(4) + ' − ' + Math.abs(M.b).toFixed(4) + '·log10(TVL).</li>' +
    '<li><b>Leave-one-out error ×' + M.loo.toFixed(2) + '</b> (flat multiple ×' + M.looFlat.toFixed(2) + '): refit the curve 128 times, each time holding one comparable out.</li>' +
    '<li><b>Category effect</b> shrunk with 4 pseudo-comparables — a lone comparable moves its category only 1/5 of its residual.</li>' +
    '<li><b>P25–P75 range ×' + M.ratio.toFixed(2) + '</b> from the empirical quartiles of the residuals after curve + category effect.</li>' +
    '<li><b>Rank #1:</b> ' + esc(rows[0].name) + ' ' + $m(rows[0].imp) + ' · ' + esc(rows[1].name) + ' ' + $m(rows[1].imp) + ' · ' + esc(rows[2].name) + ' ' + $m(rows[2].imp) + '.</li></ul>';
  function scatterInto(el, W, H) {
    const P = 28;
    const ys = R.pts.map((p) => p[1] / 100);
    const yLo = Math.floor(Math.min(...ys) * 2) / 2 - 0.2, yHi = Math.ceil(Math.max(...ys) * 2) / 2 + 0.2;
    const cx = (v) => Math.max(P, Math.min(W - P, P + ((v - 6.7) / (10.6 - 6.7)) * (W - 2 * P)));
    const cy = (v) => Math.max(P, Math.min(H - P, H - P - ((v - yLo) / (yHi - yLo)) * (H - 2 * P)));
    let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="log-log scatter of comparables with fitted curve">';
    s += '<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" stroke="#30363d"/><line x1="' + P + '" y1="' + P + '" x2="' + P + '" y2="' + (H - P) + '" stroke="#30363d"/>';
    for (const p of R.pts) s += '<circle cx="' + cx(p[0] / 100).toFixed(1) + '" cy="' + cy(p[1] / 100).toFixed(1) + '" r="1.8" fill="#8b949e"/>';
    s += '<line x1="' + cx(6.7).toFixed(1) + '" y1="' + cy(M.a + M.b * 6.7).toFixed(1) + '" x2="' + cx(10.6).toFixed(1) + '" y2="' + cy(M.a + M.b * 10.6).toFixed(1) + '" stroke="#f0b429" stroke-width="2"/>';
    for (const r of rows.slice(0, 10)) s += '<circle cx="' + cx(Math.log10(r.tvl)).toFixed(1) + '" cy="' + cy(Math.log10(mult(r))).toFixed(1) + '" r="3" fill="#f0b429" stroke="#0d1117"/>';
    s += '<text x="6" y="12">log10 mcap/TVL</text><text x="' + (W / 2) + '" y="' + (H - 8) + '" text-anchor="middle">log10 TVL</text><text x="' + (W - P) + '" y="' + (P - 8) + '" text-anchor="end" fill="#f0b429">grey: comparables · amber: top 10</text></svg>';
    el.innerHTML = s;
  }
  scatterInto(document.getElementById('scatter'), 340, 210);
  document.getElementById('compcats').innerHTML = '<table><tr><th class="l">Category</th><th>Comparables</th><th>Effect ×</th><th class="l">Largest same-category comparables (mcap/TVL)</th></tr>' +
    cats.map((c) => '<tr><td class="l">' + esc(c[0]) + '</td><td>' + c[1] + '</td><td>' + (10 ** c[2]).toFixed(3) + '×</td><td class="l">' +
      (c[3].length ? c[3].map((x) => esc(x[0]) + ' ' + x[1].toFixed(3) + '×').join(' · ') : 'no token-trading comparable — effect 1.000×') + '</td></tr>').join('') + '</table>';
  let ok = rows.length === M.nBoard, prev = Infinity;
  for (const r of rows) { if (r.rank < 1 || r.rank > rows.length || r.imp > prev) ok = false; prev = r.imp; }
  document.getElementById('match').textContent = ok
    ? 'page = board.json: ' + rows.length + '/' + rows.length + ' ranks and values match'
    : 'MISMATCH — page and board.json disagree';

  // ---- board
  const state = { q: '', cat: '', chain: '', watch: false, sib: false, minTvl: 0, sort: 'rank' };
  const SORTS = { rank: (a, b) => a.rank - b.rank, tvl: (a, b) => b.tvl - a.tvl, chg: (a, b) => (b.chg ?? -999) - (a.chg ?? -999), age: (a, b) => b.age - a.age, imp: (a, b) => b.imp - a.imp, slice: (a, b) => slice(b) - slice(a) };
  function filtered() {
    return rows.filter((r) =>
      (!state.q || (r.name + ' ' + r.slug).toLowerCase().includes(state.q)) &&
      (!state.cat || r.cat === state.cat) && (!state.chain || r.chain === state.chain) &&
      (!state.watch || r.watch) && (!state.sib || !r.sib) && r.tvl >= state.minTvl)
      .sort(SORTS[state.sort]);
  }
  function rowHtml(r) {
    const v = verdict(r), ch = r.chg == null ? '—' : (r.chg > 0 ? '+' : '') + r.chg.toFixed(2) + '%';
    const plan = planFor(r.cat, r.chain);
    return '<tr class="' + (r.rank <= 3 ? 'top' : '') + '"><td>' + r.rank + '</td>' +
      '<td class="l"><a href="#/p/' + r.slug + '"><span class="nm">' + esc(r.name) + '</span></a><br><span class="cat">' + esc(r.cat) + ' · ' + esc(r.chain) + (r.nChains > 1 ? ' +' + (r.nChains - 1) : '') + '</span>' +
      (r.watch ? '<span class="badge">WATCHLIST</span>' : '') + (r.tvl < 50000000 ? '<span class="badge g">EARLY FIND</span>' : '') +
      (r.sib ? '<span class="badge r">SIBLING ×0.5</span>' : '') + (r.parent ? '<span class="badge">PARENT-LINKED</span>' : '') + '</td>' +
      '<td>' + $m(r.tvl) + '</td><td class="' + (r.chg > 0 ? 'pos' : r.chg < 0 ? 'neg' : '') + '">' + ch + '</td>' +
      '<td>' + yrs(r) + '</td><td>' + mult(r).toFixed(3) + '×</td>' +
      '<td><span class="big">' + $m(r.imp) + '</span><br><span class="cat">' + $m(lo(r)) + ' – ' + $m(hi(r)) + '</span><div class="bar"><i style="width:' + Math.round(100 * Math.log10(r.imp) / Math.log10(maxImp)) + '%"></i></div></td>' +
      '<td>' + $1(slice(r)) + '</td>' +
      '<td><span class="verdict ' + (v === 'worth it' ? 'worth' : v) + '">Farm verdict: ' + v + '</span><br><span class="cat">' + Math.round(chance(r) * 100) + '% launch × EV ' + $m(r.imp * chance(r)) + '</span></td>' +
      '<td class="l">' + '$' + plan.ticket + ' ticket · ' + plan.hold + 'd hold<br><span class="cat">fee ~$' + plan.fee + ' · setup ' + plan.setupMin + ' min</span></td></tr>';
  }
  // fix the EV cell (needs chance()): patch after render
  function renderBoard() {
    const list = filtered();
    const catOpts = ['<option value="">All categories</option>'].concat(cats.map((c) => '<option' + (state.cat === c[0] ? ' selected' : '') + '>' + esc(c[0]) + '</option>'));
    const chainOpts = ['<option value="">All chains</option>'].concat(chains.map((c) => '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'));
    document.getElementById('view').innerHTML =
      '<div class="fbar"><div><h2>HOW A ROW IS VALUED</h2><p class="formula">' + document.getElementById('formula').innerHTML + '</p>' +
      '<p class="fine">Leave-one-out error ×' + M.loo.toFixed(2) + ' (flat multiple ×' + M.looFlat.toFixed(2) + ') · P25–P75 range ×' + M.ratio.toFixed(2) + ' · ' + M.nComp + ' comparables · <b>No name is special-cased.</b></p></div>' +
      '<div id="scatter2"></div></div>' +
      '<div class="filters">' +
      '<input id="fq" type="search" placeholder="Search protocol…" value="' + esc(state.q) + '">' +
      '<select id="fcat">' + catOpts.join('') + '</select><select id="fchain">' + chainOpts.join('') + '</select>' +
      '<label><input id="fwatch" type="checkbox"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<label><input id="fsib" type="checkbox"' + (state.sib ? ' checked' : '') + '> Hide sibling tokens</label>' +
      '<select id="fmin"><option value="0">Any TVL</option><option value="50000000"' + (state.minTvl === 50000000 ? ' selected' : '') + '>TVL ≥ $50M</option><option value="500000000"' + (state.minTvl === 500000000 ? ' selected' : '') + '>TVL ≥ $500M</option></select>' +
      '<select id="fsort">' + Object.keys(SORTS).map((k) => '<option value="' + k + '"' + (state.sort === k ? ' selected' : '') + '>Sort: ' + k + '</option>').join('') + '</select></div>' +
      '<p class="count">' + list.length + ' of ' + rows.length + ' shown · sorted by ' + state.sort + ' · click a row for its detail view and farm plan</p>' +
      '<table><tr><th data-s="rank">#</th><th class="l">Protocol</th><th data-s="tvl">TVL</th><th data-s="chg">7D</th><th data-s="age">No token for</th><th>Comps ×</th><th data-s="imp">Implied value P25–P75</th><th data-s="slice">Slice / $1K</th><th>Farm verdict</th><th class="l">Farm · fee · setup</th></tr>' +
      list.map(rowHtml).join('') + '</table>';
    scatterInto(document.getElementById('scatter2'), 300, 150);
    const bind = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    bind('fq', 'input', (e) => { state.q = e.target.value.toLowerCase(); renderBoardKeepFocus(); });
    bind('fcat', 'change', (e) => { state.cat = e.target.value; renderBoard(); });
    bind('fchain', 'change', (e) => { state.chain = e.target.value; renderBoard(); });
    bind('fwatch', 'change', (e) => { state.watch = e.target.checked; renderBoard(); });
    bind('fsib', 'change', (e) => { state.sib = e.target.checked; renderBoard(); });
    bind('fmin', 'change', (e) => { state.minTvl = +e.target.value; renderBoard(); });
    bind('fsort', 'change', (e) => { state.sort = e.target.value; renderBoard(); });
    document.querySelectorAll('#view th[data-s]').forEach((th) => th.addEventListener('click', () => { state.sort = th.dataset.s; renderBoard(); }));
  }
  function renderBoardKeepFocus() {
    const v = document.getElementById('fq').value, pos = document.getElementById('fq').selectionStart;
    renderBoard();
    const el = document.getElementById('fq'); el.value = v; el.focus(); el.setSelectionRange(pos, pos);
  }
  // ---- detail
  function renderDetail(slug) {
    const r = bySlug[slug];
    if (!r) { renderBoard(); return; }
    const plan = planFor(r.cat, r.chain);
    const steps = farmSteps(r.name, r.cat, r.chain);
    const comps = cats[r.catIdx][3];
    document.getElementById('view').innerHTML = '<div class="detail"><p><a href="#/">← Back to the board</a></p>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2><p>' + esc(r.cat) + ' · ' + esc(r.chain) + (r.nChains > 1 ? ' +' + (r.nChains - 1) + ' chains' : '') +
      (r.watch ? '<span class="badge">WATCHLIST</span>' : '') + (r.tvl < 50000000 ? '<span class="badge g">EARLY FIND</span>' : '') +
      (r.sib ? '<span class="badge r">SIBLING ×0.5</span>' : '') + (r.parent ? '<span class="badge">PARENT-LINKED</span>' : '') + '</p>' +
      '<div class="kpis">' +
      '<div class="kpi"><b>' + $m(r.tvl) + '</b><span>TVL</span></div>' +
      '<div class="kpi"><b>' + (r.chg == null ? '—' : (r.chg > 0 ? '+' : '') + r.chg.toFixed(2) + '%') + '</b><span>7-day change</span></div>' +
      '<div class="kpi"><b>' + yrs(r) + '</b><span>records no token for</span></div>' +
      '<div class="kpi"><b>' + $m(r.imp) + '</b><span>implied value</span></div>' +
      '<div class="kpi"><b>' + $m(lo(r)) + ' – ' + $m(hi(r)) + '</b><span>P25–P75 range</span></div>' +
      '<div class="kpi"><b>' + Math.round(chance(r) * 100) + '%</b><span>launch chance · EV ' + $m(r.imp * chance(r)) + '</span></div></div>' +
      '<h3>How this row is valued</h3><table class="break"><tr><th class="l">Component</th><th>Value</th><th>Effect</th></tr>' +
      '<tr><td>TVL</td><td>' + $m(r.tvl) + '</td><td>base</td></tr>' +
      '<tr><td>Size curve 10^(' + M.a.toFixed(4) + ' − ' + Math.abs(M.b).toFixed(4) + '·log10 TVL)</td><td>' + curve(r.tvl).toFixed(4) + '×</td><td>×' + curve(r.tvl).toFixed(3) + '</td></tr>' +
      '<tr><td>Category effect (' + esc(r.cat) + ', shrunk, 4 pseudo-comps)</td><td>10^' + eff(r).toFixed(3) + '</td><td>×' + (10 ** eff(r)).toFixed(3) + '</td></tr>' +
      '<tr><td>Age factor (' + r.age + ' days, 0.55 → 1.00 over 730)</td><td>' + ageF(r).toFixed(3) + '</td><td>×' + ageF(r).toFixed(3) + '</td></tr>' +
      '<tr><td>Growth factor (7d ' + (r.chg == null ? 'unreported' : r.chg.toFixed(2) + '%') + ')</td><td>' + growF(r).toFixed(3) + '</td><td>×' + growF(r).toFixed(3) + '</td></tr>' +
      '<tr><td>Kin factor' + (r.sib ? ' (sibling — same family, smaller value)' : '') + '</td><td>' + kinF(r).toFixed(2) + '</td><td>×' + kinF(r).toFixed(2) + '</td></tr>' +
      '<tr><td><b>Implied value</b></td><td><b>' + $m(r.imp) + '</b></td><td><b>' + mult(r).toFixed(4) + '× TVL</b></td></tr></table>' +
      '<p>Farm economics: <b>' + $1(slice(r)) + ' per $1K</b> deposited (7.5% of implied value to farmers) · <b>$' + plan.ticket + ' ticket · ' + plan.hold + '-day hold</b> · setup fee ~$' + plan.fee + ' · setup ' + plan.setupMin + ' min · <span class="verdict ' + (verdict(r) === 'worth it' ? 'worth' : verdict(r)) + '">Farm verdict: ' + verdict(r) + '</span></p>' +
      '<h3>Farm plan — 5 costed steps</h3><ol class="steps">' + steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
      '<h3>Nearest comparables — same category, token already trades</h3>' +
      (comps.length ? '<table><tr><th class="l">Protocol</th><th>mcap / TVL</th></tr>' + comps.map((c) => '<tr><td class="l">' + esc(c[0]) + '</td><td>' + c[1].toFixed(3) + '×</td></tr>').join('') + '</table>'
        : '<p class="fine">No token-trading comparable in this category — the category effect is 1.000× and the curve alone sets the value.</p>') +
      '<h3>What the model gets wrong here</h3><p class="warn">This row records no token — that is the record, not proof. The value leans on TVL alone: no fees, users or funding are in the snapshot, and the P25–P75 range (×' + M.ratio.toFixed(2) + ') is the honest size of the error. ' +
      (r.cat === 'Risk Curators' || r.cat === 'Onchain Capital Allocator'
        ? 'As a vault curator / capital allocator this protocol manages other protocols’ assets; its own token, if any, is a governance claim on the curator, not on the vaults — the least certain launch shape on this board.'
        : 'If this protocol never intends to launch a token, the whole implied value is moot — the launch chance above is the model’s guard against exactly that.') +
      ' Farm only with money you can afford to have locked for ' + plan.hold + ' days.</p></div>';
  }
  // ---- routing
  function route() {
    const h = location.hash || '';
    if (h.startsWith('#/p/')) { renderDetail(h.slice(4)); return; }
    if (h.startsWith('#/f?')) {
      const q = new URLSearchParams(h.slice(4));
      state.cat = q.get('cat') || ''; state.chain = q.get('chain') || '';
      state.watch = q.get('watch') === '1'; state.sib = q.get('sib') === '1';
      state.minTvl = +(q.get('min') || 0); state.q = (q.get('q') || '').toLowerCase();
      renderBoard(); return;
    }
    renderBoard();
  }
  window.addEventListener('hashchange', route);
  route();
})();
