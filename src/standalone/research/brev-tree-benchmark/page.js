// Brev tree benchmark: tables, charts and the hypothesis ledger, built from data.json (same-origin sidecar).
// The shell passes { root, data, rd }; tabs, sections and the rail are the shell's, so this only fills the page.
export default async function init({ root }) {
	const doc = root.ownerDocument;
	const view = doc.defaultView;
	const $ = (id) => root.querySelector("#" + id);
	let D = { R: {}, V: {}, H: [] };
	try {
		D = await (await view.fetch("/research/brev-tree-benchmark/data.json")).json();
	} catch {
		root.querySelector("#progress")?.replaceChildren("The data file did not load.");
		return;
	}
	const { R, V } = D;
	const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
	const pc = (x) => (x == null ? '<span class="muted">–</span>' : (x * 100).toFixed(1) + '%');
	const ms = (x) => (x == null ? '<span class="muted">–</span>' : Math.round(x).toLocaleString() + ' ms');
	const tone = (a) => (a.side === 'laya' ? 'var(--rd-cat-2)' : a.side === '4B' ? 'var(--rd-cat-4)' : 'var(--rd-cat-1)');

	function progress() {
	  // Each arm's own target: the scaling test has 1,960 messages, the tournaments every fifth (616), the live GPU arms 300.
	  const target = (a) => (a.dataset === 'h5' ? 1960 : a.id.startsWith('F-tour') ? 616 : a.id.startsWith('G-') ? 300 : 3080);
	  $('progress').innerHTML = (R?.arms ?? []).map((a) => {
	    const n = R.progress?.[a.id] ?? 0;
	    const total = target(a);
	    return `<div class="prog"><span>${esc(a.id)} · ${n.toLocaleString()}/${total.toLocaleString()}</span><div class="bar" style="--c:${tone(a)}"><i style="--w:${Math.min(100, (100 * n) / total)}%"></i></div></div>`;
	  }).join('');
	}

	function board() {
	  const rows = (R?.arms ?? []).filter((a) => a.dataset !== 'h5').map((a) => `<tr>
	    <td><span class="armid" style="--c:${tone(a)}">${esc(a.id)}</span><span class="sub">${esc(a.label)}</span></td>
	    <td>${esc(a.reads) || '<span class="muted">–</span>'}</td>
	    <td class="rd-num">${pc(a.acc)}</td><td class="rd-num">${pc(a.f1)}</td>
	    <td class="rd-num">${ms(a.p50_ms)}</td><td class="rd-num">${ms(a.p95_ms)}</td>
	    <td class="rd-num">${a.n ? a.n.toLocaleString() : '<span class="muted">' + esc(a.status) + '</span>'}</td></tr>`).join('');
	  $('board').innerHTML = `<thead><tr><th>Arm</th><th>Reads per message</th><th class="rd-num">Accuracy</th><th class="rd-num">Macro-F1</th><th class="rd-num">p50</th><th class="rd-num">p95</th><th class="rd-num">n</th></tr></thead><tbody>${rows}</tbody>`;
	}

	function scaling() {
	  const s = R?.scaling ?? [];
	  $('scaling').innerHTML = `<thead><tr><th>Setup</th><th class="rd-num">77 intents</th><th class="rd-num">196 intents</th><th class="rd-num">p50, 77</th><th class="rd-num">p50, 196</th><th>At 196, reads</th></tr></thead><tbody>` +
	    s.map((r) => `<tr><td>${esc(r.family)}</td><td class="rd-num">${pc(r.b77_acc)}</td><td class="rd-num">${pc(r.h5_acc)}</td><td class="rd-num">${ms(r.b77_ms)}</td><td class="rd-num">${ms(r.h5_ms)}</td><td>${esc(r.h5_reads) || '<span class="muted">–</span>'}</td></tr>`).join('') + '</tbody>';
	  const rows = (R?.arms ?? []).filter((a) => a.dataset === 'h5').map((a) => `<tr>
	    <td><span class="armid" style="--c:${tone(a)}">${esc(a.id)}</span><span class="sub">${esc(a.label)}</span></td>
	    <td>${esc(a.reads) || '<span class="muted">–</span>'}</td>
	    <td class="rd-num">${pc(a.acc)}</td><td class="rd-num">${pc(a.f1)}</td>
	    <td class="rd-num">${ms(a.p50_ms)}</td><td class="rd-num">${ms(a.p95_ms)}</td>
	    <td class="rd-num">${a.n ? a.n.toLocaleString() : '<span class="muted">' + esc(a.status) + '</span>'}</td></tr>`).join('');
	  $('board-h5').innerHTML = `<thead><tr><th>Arm</th><th>Reads per message</th><th class="rd-num">Accuracy</th><th class="rd-num">Macro-F1</th><th class="rd-num">p50</th><th class="rd-num">p95</th><th class="rd-num">n</th></tr></thead><tbody>${rows}</tbody>`;
	}

	function axes(svg, { x0, x1, y0, y1, xl, yl, xlog }) {
	  const W = 720, H = 320, L = 52, Rr = 16, T = 14, B = 40;
	  const sx = (v) => L + ((xlog ? Math.log10(v) - Math.log10(x0) : v - x0) / (xlog ? Math.log10(x1) - Math.log10(x0) : x1 - x0)) * (W - L - Rr);
	  const sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
	  let g = '';
	  const yt = 5;
	  for (let i = 0; i <= yt; i++) {
	    const v = y0 + ((y1 - y0) * i) / yt;
	    g += `<line x1="${L}" x2="${W - Rr}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--rd-line)" stroke-width="1"/><text x="${L - 8}" y="${sy(v) + 4}" text-anchor="end">${(v * 100).toFixed(0)}%</text>`;
	  }
	  const xt = xlog ? [10, 30, 100, 300, 1000, 3000].filter((v) => v >= x0 && v <= x1) : [0, .1, .2, .3, .4, .5].filter((v) => v >= x0 && v <= x1);
	  for (const v of xt) g += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${H - B}" stroke="var(--rd-line)" stroke-width="1"/><text x="${sx(v)}" y="${H - B + 16}" text-anchor="middle">${xlog ? v + ' ms' : (v * 100).toFixed(0) + '%'}</text>`;
	  g += `<text x="${(L + W - Rr) / 2}" y="${H - 6}" text-anchor="middle">${xl}</text><text x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">${yl}</text>`;
	  svg.innerHTML = g;
	  return { sx, sy };
	}

	function scatter() {
	  const pts = (R?.arms ?? []).filter((a) => a.dataset !== 'h5' && a.acc != null && a.p50_ms != null && a.n >= 300);
	  const svg = $('scatter');
	  if (!pts.length) { svg.innerHTML = '<text x="360" y="160" text-anchor="middle">Waiting for an arm with both accuracy and latency</text>'; return; }
	  const lo = Math.max(0, Math.floor(Math.min(...pts.map((a) => a.acc)) * 10) / 10 - .05);
	  const { sx, sy } = axes(svg, { x0: 10, x1: 3000, y0: lo, y1: 1, xl: 'median latency (log)', yl: 'accuracy', xlog: true });
	  svg.innerHTML += pts.map((a) => `<circle cx="${sx(a.p50_ms)}" cy="${sy(a.acc)}" r="6" fill="${tone(a)}"/><text x="${sx(a.p50_ms) + 9}" y="${sy(a.acc) + 4}" class="rd-annot">${esc(a.id)}</text>`).join('');
	}

	function frontier() {
	  const f = R?.frontier ?? [];
	  const svg = $('frontier');
	  if (!f.length) { svg.innerHTML = '<text x="360" y="160" text-anchor="middle">Waiting for T-crit</text>'; return; }
	  const series = [['oracle_resolver', 'oracle', 'var(--rd-good)'], ['resolver_L-full', '27B full', 'var(--rd-cat-1)'], ['resolver_L-short', '27B short', 'var(--rd-text-muted)'], ['tree_only_on_kept', 'tree, kept only', 'var(--rd-cat-2)']]
	    .filter(([k]) => f.some((p) => p[k] != null));
	  const vals = f.flatMap((p) => series.map(([k]) => p[k]).filter((v) => v != null));
	  const lo = Math.max(0, Math.floor(Math.min(...vals) * 10) / 10 - .05);
	  const { sx, sy } = axes(svg, { x0: 0, x1: .5, y0: lo, y1: 1, xl: 'share of messages held', yl: 'accuracy' });
	  let g = '';
	  series.forEach(([k, name, color], si) => {
	    const p = f.filter((q) => q[k] != null);
	    g += `<polyline fill="none" stroke="${color}" stroke-width="2" points="${p.map((q) => `${sx(q.hold)},${sy(q[k])}`).join(' ')}"/>`;
	    g += `<circle cx="${sx(p.at(-1).hold)}" cy="${sy(p.at(-1)[k])}" r="3.5" fill="${color}"/>`;
	    g += `<rect x="${60 + si * 150}" y="3" width="10" height="10" rx="2" fill="${color}"/><text x="${60 + si * 150 + 16}" y="13">${name}</text>`;
	  });
	  svg.innerHTML += g;
	}

	// Hypothesis filter and paging. The state is the URL (?filter=confirmed&shown=16); every control is a real link, so a change is
	// one navigation and the page rebuilds the list from the address. With no JS every card shows.
	function ledger() {
	  const H = D.H;
	  const PAGE = 8;
	  const q = new view.URLSearchParams(view.location.search);
	  const shownParam = q.get('shown');
	  const shown = shownParam === 'all' ? Infinity : Math.max(1, parseInt(shownParam || '', 10) || PAGE);
	  const status = (id) => V?.[id]?.status ?? 'pending';
	  const tally = {};
	  H.forEach(([id]) => { tally[status(id)] = (tally[status(id)] || 0) + 1; });
	  const filter = q.get('filter') in tally ? q.get('filter') : 'all';
	  const url = (f, n, hash) => {
	    const p = new view.URLSearchParams({ tab: 'hypotheses' });
	    if (f !== 'all') p.set('filter', f);
	    if (n !== PAGE) p.set('shown', n === Infinity ? 'all' : String(n));
	    return '?' + p.toString() + (hash ? '#' + hash : '');
	  };
	  const tone = { supported: 'good', refuted: 'bad', mixed: 'warn', running: 'running', pending: 'pending', killed: 'neutral' };
	  const match = H.filter(([id]) => filter === 'all' || status(id) === filter);
	  const left = Math.max(0, match.length - shown);
	  $('ledger').innerHTML = match.slice(0, shown).map(([id, s, test]) => {
	    const v = V?.[id] ?? {};
	    const st = status(id);
	    return `<article class="hyp"><div class="top"><span class="id">${id}</span><span class="rd-chip rd-chip--${tone[st] ?? 'neutral'}${st === 'killed' ? ' is-killed' : ''}">${esc(st)}</span></div>
	      <div class="stmt">${esc(s)}</div><div class="ev">${esc(v.evidence ?? test)}</div></article>`;
	  }).join('');
	  const link = (f, label) => `<a class="chip" href="${url(f, PAGE)}"${f === filter ? ' aria-current="true"' : ''}>${label}</a>`;
	  $('ledger-filters').innerHTML = link('all', 'All (' + H.length + ')') +
	    Object.keys(tally).sort().map((s) => link(s, s.charAt(0).toUpperCase() + s.slice(1) + ' (' + tally[s] + ')')).join('');
	  $('ledger-count').textContent = 'Showing ' + Math.min(shown, match.length) + ' of ' + match.length + ' hypotheses';
	  const more = $('ledger-more');
	  const all = $('ledger-all');
	  more.hidden = all.hidden = left === 0;
	  more.textContent = 'Show ' + Math.min(PAGE, left) + ' more';
	  more.href = url(filter, shown + PAGE, 'ledger-count');
	  all.href = url(filter, Infinity, 'ledger-count');
	  $('ledger-tools').hidden = false;
	}

	function diffs() {
	  const d = R?.diffs ?? [];
	  if (!d.length) { $('diffs').innerHTML = '<tbody><tr><td class="muted">Waiting for two arms to overlap on 200 messages or more.</td></tr></tbody>'; return; }
	  const span = Math.max(10, ...d.map((x) => Math.max(Math.abs(x.lo), Math.abs(x.hi))));
	  const pos = (v) => 50 + (v / span) * 50;
	  $('diffs').innerHTML = `<thead><tr><th>First arm</th><th>Second arm</th><th class="rd-num">Δ points</th><th class="rd-num">95% CI</th><th>Interval</th><th class="rd-num">n</th></tr></thead><tbody>` +
	    d.map((x) => `<tr><td class="armid">${esc(x.a)}</td><td class="armid">${esc(x.b)}</td><td class="rd-num">${x.delta_pts > 0 ? '+' : ''}${x.delta_pts.toFixed(1)}</td>
	      <td class="rd-num">${x.lo.toFixed(1)} to ${x.hi.toFixed(1)}</td>
	      <td><div class="ci"><span class="axis"></span><span class="span" style="--l:${pos(x.lo)}%;--w:${pos(x.hi) - pos(x.lo)}%"></span><span class="pt" style="--l:${pos(x.delta_pts)}%"></span></div></td>
	      <td class="rd-num">${x.n.toLocaleString()}</td></tr>`).join('') + '</tbody>';
	}

	function inside() {
	  const arms = ['T-crit', 'T-v2', 'T-v3ex'].filter((a) => R?.policies?.[a]);
	  const head = arms.map((a) => `<th class="rd-num">${a}</th>`).join('');
	  const names = [['greedy', 'Greedy: one branch per level'], ['beam2', 'Beam of 2 by path product'], ['beam3', 'Beam of 3 by path product'], ['path_product', 'Every path, best product'], ['path_geomean', 'Every path, best per-level geometric mean']];
	  $('policies').innerHTML = arms.length ? `<thead><tr><th>Walk policy</th>${head}</tr></thead><tbody>` +
	    names.map(([k, n]) => `<tr><td>${n}</td>${arms.map((a) => `<td class="rd-num">${pc(R.policies[a][k])}</td>`).join('')}</tr>`).join('') +
	    `<tr><td>Margin AUROC for errors (${esc(R.frontier_tree || 'T-crit')})</td><td class="rd-num" colspan="${arms.length}">${R?.margin_auroc == null ? '–' : R.margin_auroc.toFixed(3)}</td></tr></tbody>`
	    : '<tbody><tr><td class="muted">Waiting for T-crit</td></tr></tbody>';
	  const levels = ['L1', 'L2', 'L3'];
	  $('levels').innerHTML = arms.length ? `<thead><tr><th>Right branch at</th>${head}</tr></thead><tbody>` +
	    levels.map((l) => `<tr><td>${l.replace('L', 'Level ')} (every message whose path has it)</td>${arms.map((a) => `<td class="rd-num">${pc(R.levels?.[a]?.[l]?.acc)}</td>`).join('')}</tr>`).join('') + '</tbody>'
	    : '<tbody><tr><td class="muted">Waiting for T-crit</td></tr></tbody>';
	}

	function brainstorm() {
	  const b = V?.brainstorm;
	  $('brainstorm').innerHTML = b ? b.map((s) => `<h3>${esc(s.h)}</h3><ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('') : '';
	}

	progress(); board(); scaling(); scatter(); frontier(); ledger(); diffs(); inside(); brainstorm();

}
