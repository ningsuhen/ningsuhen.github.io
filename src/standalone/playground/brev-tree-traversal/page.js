// Walker (Walk tab) and the speed-test loader (Speed test tab), scoped to the fragment root.
//
// The walker's state is the hash on the Walk tab: ?tab=walk#m=<test index>&s=<step>. Next, Restart, the arrow keys and a
// message pick push one entry each; auto-play replaces the entry; Back steps back through history when the previous entry
// is the previous step (else it replaces). Back, Forward, hashchange and reload re-sync the walker from the hash and
// write nothing. With no walker hash it shows message DEFAULT_ID at the start and writes nothing (a fresh visit adds no
// entry). The hash is not an element id: #walker carries data-rd-hash, so the Doc design keeps the section that holds the
// walker shown, and rd.nav.hash / rd.nav.back do the history writes.
export default function init({ root, rd }) {
	const doc = root.ownerDocument;
	const view = doc.defaultView;
	const $ = (id) => doc.getElementById(id);

	// The speed test is a same-origin module; nothing external is fetched until the visitor presses Start.
	// Added as a script element, not import(): the dev server refuses to import a file under public/.
	const speed = doc.createElement("script");
	speed.type = "module";
	speed.src = "/playground/brev-tree-traversal/speed.js";
	doc.head.appendChild(speed);

	const D = JSON.parse($("tt-data").textContent);
	const T = D.tree;
	const M = D.msgs;
	const KIND = { all: "All 60 messages", correct: "Correct", wrong_root: "Wrong at the root", wrong_below: "Wrong below the root", low_conf: "Lowest confidence", short: "Shortest to read" };
	const DEFAULT_ID = D.dflt;
	let cur = null;
	let step = 0;
	let walk = [];
	let timer = null;
	let entry = "";

	function el(tag, cls, text) {
		const e = doc.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}
	function icon(name) {
		const t = doc.createElement("template");
		t.innerHTML = `<svg class="rd-icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
		return t.content.firstChild;
	}
	function chip(text, kind, ic) {
		const c = el("span", "rd-chip rd-chip--" + kind);
		if (ic) c.appendChild(icon(ic));
		c.appendChild(doc.createTextNode(text));
		return c;
	}
	const pct = (x) => (x * 100).toFixed(1) + "%";
	const short = (nid) => (nid === "root" ? "root" : nid.split("/").pop());

	function computeWalk(m) {
		const out = [];
		let nid = "root";
		while (nid) {
			const v = m.p[nid];
			let k = 0;
			for (let j = 1; j < v.length; j++) if (v[j] > v[k]) k = j;
			out.push({ nid, k });
			nid = T[nid].o[k][2];
		}
		return out;
	}
	function goldAt(m, nid) {
		for (let i = 0; i < m.g.length; i++) if (m.g[i][0] === nid) return m.g[i][1];
		return -1;
	}
	function divergence(m, w) {
		for (let i = 0; i < w.length; i++) if (!m.g[i] || m.g[i][0] !== w[i].nid || m.g[i][1] !== w[i].k) return i;
		return -1;
	}

	// ---- pickers ----
	function fillKind() {
		const s = $("f-kind");
		const n = { all: M.length };
		M.forEach((m) => { n[m.k] = (n[m.k] || 0) + 1; });
		Object.keys(KIND).forEach((k) => {
			const o = el("option", null, KIND[k] + " (" + (n[k] || 0) + ")");
			o.value = k;
			s.appendChild(o);
		});
	}
	function visible() {
		const kind = $("f-kind").value;
		const y = $("f-intent").value;
		return M.filter((m) => (kind === "all" || m.k === kind) && (!y || m.y === y));
	}
	function fillIntent() {
		const s = $("f-intent");
		const kind = $("f-kind").value;
		const prev = s.value;
		const seen = {};
		s.textContent = "";
		const a = el("option", null, "Any intent");
		a.value = "";
		s.appendChild(a);
		M.filter((m) => kind === "all" || m.k === kind).forEach((m) => { seen[m.y] = 1; });
		Object.keys(seen).sort().forEach((y) => {
			const o = el("option", null, y);
			o.value = y;
			s.appendChild(o);
		});
		if (seen[prev]) s.value = prev;
	}
	function fillMsg(keep) {
		const s = $("f-msg");
		s.textContent = "";
		visible().forEach((m) => {
			const o = el("option", null, m.t.length > 90 ? m.t.slice(0, 88) + "..." : m.t);
			o.value = m.i;
			s.appendChild(o);
		});
		if (keep != null && visible().some((m) => m.i === keep)) s.value = keep;
	}

	// ---- hash: #m=<id>[&s=<n>] (an old &sec=<section> suffix is accepted and ignored) ----
	function parse(h) {
		const x = /^#m=(\d+)(?:&s=(\d+))?(?:&sec=([\w-]+))?$/.exec(h || "");
		return x ? { i: +x[1], s: x[2] ? +x[2] : 0 } : null;
	}
	const entryOf = (h) => {
		const w = parse(h);
		return w ? w.i + ":" + w.s : DEFAULT_ID + ":0";
	};
	// push: one entry for this user action; else replace. state.w names the walker state of the entry before, so Back can tell
	// whether going back lands on the previous step.
	function writeHash(push) {
		const h = "#m=" + cur.i + (step ? "&s=" + step : "");
		if (view.location.hash === h) return;
		const w = entry;
		entry = cur.i + ":" + step;
		try { rd.nav.hash(h, push ? { push: true, state: { w } } : {}); } catch { /* ignore */ }
	}

	function select(i, s) {
		const m = M.filter((x) => x.i === i)[0] || visible()[0] || M[0];
		cur = m;
		walk = computeWalk(m);
		step = Math.max(0, Math.min(s || 0, walk.length));
		stop();
		if (visible().indexOf(m) < 0) {
			$("f-kind").value = "all";
			fillIntent();
			$("f-intent").value = "";
			fillMsg();
		}
		$("f-msg").value = m.i;
		$("msg-text").textContent = m.t;
		const meta = $("msg-meta");
		meta.textContent = "";
		meta.appendChild(chip("Gold intent: " + m.y, "neutral", "target"));
		meta.appendChild(chip(KIND[m.k], "neutral"));
		meta.appendChild(doc.createTextNode("Banking77 test #" + m.i));
		render();
	}
	function pick(i) {
		select(i, 0);
		writeHash(true);
	}

	// ---- render one step ----
	function render() {
		const m = cur;
		const n = walk.length;
		$("step-label").textContent = step === 0 ? "Start: " + n + " nodes on this walk" : "Node " + step + " of " + n;
		setDisabled("b-back", step === 0);
		setDisabled("b-next", step === n);
		setDisabled("b-play", step === n && !timer);

		const path = $("path");
		path.textContent = "";
		const r0 = el("li");
		r0.appendChild(chip("root", "neutral"));
		path.appendChild(r0);
		for (let i = 0; i < step; i++) {
			const w = walk[i];
			const li = el("li");
			li.appendChild(chip(T[w.nid].o[w.k][0], i === step - 1 ? "good" : "neutral"));
			path.appendChild(li);
		}
		const card = $("node-card");
		card.textContent = "";
		const ver = $("verdict");
		ver.textContent = "";
		let live = "";
		if (step === 0) {
			card.appendChild(el("p", "tt-node", "Nothing has been asked yet."));
			card.appendChild(el("p", null, "laya will first ask a root question with 7 group options, then follow its pick down. Press Next node."));
			live = "Start. Message: " + m.t;
		} else {
			const cw = walk[step - 1];
			const node = T[cw.nid];
			const probs = m.p[cw.nid];
			const gk = goldAt(m, cw.nid);
			let onGoldHere = true;
			for (let j = 0; j < step - 1; j++) if (goldAt(m, walk[j].nid) !== walk[j].k) onGoldHere = false;
			card.appendChild(el("p", "tt-node", cw.nid === "root" ? "Question at the root" : "Question inside group: " + cw.nid.split("/").slice(1).join(" / ")));
			card.appendChild(el("p", "tt-q", node.q));
			const ul = el("ul", "tt-opts");
			node.o.forEach((o, k) => {
				const li = el("li", "tt-opt" + (k === cw.k ? " is-chosen" : "") + (onGoldHere && k === gk ? " is-gold" : ""));
				const nm = el("span", "tt-name");
				nm.appendChild(doc.createTextNode(o[0]));
				if (k === cw.k) nm.appendChild(chip("laya chose", "good", "circle-check"));
				if (onGoldHere && k === gk) nm.appendChild(chip("gold", "neutral", "target"));
				li.appendChild(nm);
				li.appendChild(el("span", "tt-pct", pct(probs[k])));
				const bar = el("div", "tt-bar");
				const f = el("i");
				f.style.setProperty("--w", (probs[k] * 100).toFixed(1));
				bar.appendChild(f);
				li.appendChild(bar);
				li.appendChild(el("p", "tt-crit", o[1]));
				ul.appendChild(li);
			});
			card.appendChild(ul);
			const chosen = node.o[cw.k];
			live = "Node " + step + " of " + n + ". " + node.q + " laya chose " + chosen[0] + " at " + pct(probs[cw.k]) + ".";
			if (step === n) {
				const ok = chosen[0] === m.y;
				const d = divergence(m, walk);
				const box = el("div", "rd-callout rd-callout--" + (ok ? "good" : "bad"));
				const tt = el("p", "rd-callout__title");
				tt.appendChild(icon(ok ? "circle-check" : "circle-x"));
				tt.appendChild(doc.createTextNode(ok ? "Correct: walk ends at the gold intent" : "Wrong: walk ends at " + chosen[0]));
				box.appendChild(tt);
				let msg = "Predicted " + chosen[0] + ". Gold: " + m.y + ".";
				if (!ok && d >= 0) {
					const dn = T[walk[d].nid];
					const gi = m.g[d][1];
					msg += ' The walk left the gold path at "' + short(walk[d].nid) + '": it chose ' + dn.o[walk[d].k][0] + " (" + pct(m.p[walk[d].nid][walk[d].k]) + ") where the gold route needed " + dn.o[gi][0] + " (" + pct(m.p[walk[d].nid][gi]) + "). Nothing below could undo that.";
				}
				box.appendChild(doc.createTextNode(msg));
				ver.appendChild(box);
				live += " " + msg;
			}
		}
		$("live").textContent = live;
	}

	// ---- controls ----
	// aria-disabled, not disabled: a button that disables under keyboard focus drops the focus to the page top.
	function setDisabled(id, on) { $(id).setAttribute("aria-disabled", on ? "true" : "false"); }
	function go(d, push) {
		const s = Math.max(0, Math.min(step + d, walk.length));
		if (s === step) return;
		step = s;
		render();
		writeHash(push);
	}
	// Back: use the browser's history when the previous entry is exactly the previous step; otherwise step back in place.
	function back() {
		stop();
		const st = view.history.state;
		if (step > 0 && st && st.w === cur.i + ":" + (step - 1) && entry === cur.i + ":" + step) rd.nav.back();
		else go(-1, false);
	}
	function stop() {
		if (timer) { view.clearInterval(timer); timer = null; }
		const b = $("b-play");
		b.setAttribute("aria-pressed", "false");
		b.querySelector("span").textContent = "Auto-play";
		b.replaceChild(icon("play"), b.querySelector("svg"));
	}
	function play() {
		if (timer) { stop(); render(); return; }
		if (step === walk.length) step = 0;
		const b = $("b-play");
		b.setAttribute("aria-pressed", "true");
		b.querySelector("span").textContent = "Pause";
		b.replaceChild(icon("pause"), b.querySelector("svg"));
		go(1, false);
		timer = view.setInterval(() => {
			if (step >= walk.length) { stop(); render(); return; }
			go(1, false);
			if (step >= walk.length) { stop(); render(); }
		}, 1400);
	}
	function press(id, fn) {
		const b = $(id);
		b.addEventListener("click", () => { if (b.getAttribute("aria-disabled") !== "true") fn(); });
	}
	press("b-next", () => { stop(); go(1, true); });
	press("b-back", back);
	press("b-play", play);
	press("b-reset", () => { stop(); step = 0; render(); writeHash(true); });
	$("walker").addEventListener("keydown", (e) => {
		const t = e.target.tagName;
		if (t === "SELECT" || t === "INPUT" || e.altKey || e.ctrlKey || e.metaKey) return;
		if (e.key === "ArrowRight") { e.preventDefault(); stop(); go(1, true); }
		else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
	});
	$("f-kind").addEventListener("change", () => { fillIntent(); fillMsg(); pick(+$("f-msg").value); });
	$("f-intent").addEventListener("change", () => { fillMsg(); pick(+$("f-msg").value); });
	$("f-msg").addEventListener("change", () => pick(+$("f-msg").value));
	// Back, Forward, hashchange, bfcache: re-sync from the hash; writes nothing.
	function sync() {
		const h = parse(view.location.hash);
		const i = h ? h.i : DEFAULT_ID;
		const s = h ? h.s : 0;
		entry = entryOf(view.location.hash);
		if (!cur || i !== cur.i || s !== step) select(i, s);
	}
	view.addEventListener("popstate", sync);
	view.addEventListener("hashchange", sync);
	view.addEventListener("pageshow", (e) => { if (e.persisted) sync(); });

	// ---- static: replay numbers and failure strip ----
	$("replay-n").textContent = D.replay.correct.toLocaleString("en-US") + " of " + D.replay.n.toLocaleString("en-US");
	$("replay-acc").textContent = ((D.replay.correct / D.replay.n) * 100).toFixed(2) + "%";
	const F = D.fail;
	const N = D.replay.n;
	const parts = [["correct", "Correct end to end", "--rd-good"], ["root", "Left the gold path at the root question", "--rd-bad"], ["level2", "Left it at the second question", "--rd-warn"], ["level3", "Left it at the third question", "--rd-cat-3"]];
	const bar = $("fail-stack");
	const lg = $("fail-legend");
	parts.forEach((p) => {
		const s = el("span");
		s.style.setProperty("--w", ((F[p[0]] / N) * 100).toFixed(2));
		s.style.background = "var(" + p[2] + ")";
		bar.appendChild(s);
		const li = el("li");
		const sw = el("span", "rd-legend__swatch rd-legend__swatch--square");
		sw.style.setProperty("--c", "var(" + p[2] + ")");
		li.appendChild(sw);
		li.appendChild(doc.createTextNode(p[1] + ": " + F[p[0]].toLocaleString("en-US") + " (" + ((F[p[0]] / N) * 100).toFixed(1) + "%)"));
		lg.appendChild(li);
	});

	fillKind();
	fillIntent();
	fillMsg();
	sync();
}
