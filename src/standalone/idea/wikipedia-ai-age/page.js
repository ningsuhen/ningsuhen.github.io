// Idea-page behaviour, scoped to the fragment root (the shell passes { root, data, rd }).
// data is null here: the notes for the Ask tab live in the <script data-rd-data> in the body.
// ideaGo(sectionId) is set by rd.js (mountTabs) for same-page tab navigation.
export default function init({ root }) {
	const doc = root.ownerDocument;
	const view = doc.defaultView;

	// Step-through figures: Next and Previous move the highlight and the caption. No history entries.
	root.querySelectorAll(".idea-steps").forEach((fig) => {
		const total = parseInt(fig.getAttribute("data-steps"), 10) || 1;
		let cur = 1;
		const count = fig.querySelector(".idea-steps__count");
		const prev = fig.querySelector("[data-prev]");
		const next = fig.querySelector("[data-next]");
		function render() {
			fig.querySelectorAll("[data-s]").forEach((el) => {
				const sNo = parseInt(el.getAttribute("data-s"), 10);
				el.classList.toggle("is-on", sNo === cur);
				el.classList.toggle("is-past", sNo < cur);
			});
			fig.querySelectorAll(".idea-steps__list li").forEach((li) => {
				li.classList.toggle("is-on", li.getAttribute("data-s") === String(cur));
			});
			count.textContent = "Step " + cur + " of " + total;
			prev.disabled = cur <= 1;
			next.disabled = cur >= total;
			if (cur >= total && doc.activeElement === next) prev.focus(); // no focus on a disabled button
			if (cur <= 1 && doc.activeElement === prev) next.focus();
			const lit = fig.querySelector("svg [data-s].is-on");
			if (lit && fig.scrollWidth > fig.clientWidth + 1) {
				const fr = fig.getBoundingClientRect(),
					lr = lit.getBoundingClientRect();
				if (lr.left < fr.left || lr.right > fr.right)
					fig.scrollTo({
						left: fig.scrollLeft + (lr.left - fr.left) - 16,
						behavior: view.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
					});
			}
		}
		prev.addEventListener("click", () => {
			if (cur > 1) {
				cur -= 1;
				render();
			}
		});
		next.addEventListener("click", () => {
			if (cur < total) {
				cur += 1;
				render();
			}
		});
		fig.classList.add("is-js");
		render();
	});

	// Remove a source: pre-written notes only, nothing is computed.
	const claims = root.querySelector("#idea-claims");
	const note = root.querySelector("#idea-remove-note");
	if (claims && note) {
		const NOTES = {
			"": "All three sources are in place. Every claim has support.",
			A: "Source A is gone. Claim a has lost its only support, so it is now unsourced. Claim c still rests on source C. Claim b is untouched.",
			B: "Source B is gone. Claim b has lost its only support, so it is now unsourced. Claims a and c keep theirs.",
			C: "Source C is gone. Claim c still rests on source A, so nothing loses support.",
		};
		const LOST = { "": [], A: ["a"], B: ["b"], C: [] };
		const buttons = [...root.querySelectorAll("[data-remove]")];
		buttons.forEach((b) => {
			b.addEventListener("click", () => {
				const k = b.getAttribute("data-remove");
				claims.querySelectorAll("[data-claim]").forEach((c) => c.classList.toggle("is-lost", LOST[k].includes(c.getAttribute("data-claim"))));
				buttons.forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
				note.textContent = NOTES[k];
			});
		});
	}

	// Quiz: a pick shows right or not quite, with an icon, and opens the explanation. Nothing is stored.
	const answers = { q1: "a", q2: "b", q3: "b", q4: "c" };
	const NS = root.querySelector("svg").namespaceURI; // the SVG namespace, from the page's own icons
	function icon(name) {
		const svg = doc.createElementNS(NS, "svg");
		svg.setAttribute("class", "rd-icon");
		svg.setAttribute("aria-hidden", "true");
		const use = doc.createElementNS(NS, "use");
		use.setAttribute("href", "#i-" + name);
		svg.appendChild(use);
		return svg;
	}
	root.querySelectorAll(".idea-quiz fieldset").forEach((fs) => {
		const key = "q" + fs.getAttribute("data-q");
		const verdict = fs.querySelector(".idea-verdict");
		fs.querySelectorAll('input[type="radio"]').forEach((r) => {
			r.addEventListener("change", () => {
				const ok = r.value === answers[key];
				verdict.textContent = "";
				verdict.appendChild(icon(ok ? "circle-check" : "circle-x"));
				verdict.appendChild(doc.createTextNode(ok ? "Right." : "Not quite. The answer is open below."));
				verdict.className = "idea-verdict " + (ok ? "idea-verdict--ok" : "idea-verdict--no");
				const det = fs.querySelector("details");
				if (det) det.open = true;
			});
		});
	});

	// Ask this idea: local retrieval over the notes in the body. BM25 over each note's question,
	// keywords and answer; the top note answers, with a link to its section; below the threshold it says it does not know.
	const kbEl = root.querySelector('script[data-rd-data][id="idea-kb"]');
	const form = root.querySelector("#idea-ask-form");
	const input = root.querySelector("#idea-ask-input");
	const log = root.querySelector("#idea-log");
	if (kbEl && form && input && log) {
		const KB = JSON.parse(kbEl.textContent || "[]");
		const STOP = { a: 1, an: 1, the: 1, is: 1, are: 1, of: 1, to: 1, in: 1, on: 1, and: 1, or: 1, it: 1, this: 1, that: 1, do: 1, does: 1, for: 1, be: 1, with: 1, my: 1, i: 1, what: 1, how: 1, can: 1, if: 1, so: 1, at: 1, by: 1, as: 1, from: 1, about: 1, me: 1, you: 1, your: 1, we: 1, they: 1, their: 1, there: 1, which: 1, who: 1, why: 1, its: 1, was: 1, were: 1, will: 1, has: 1, have: 1, any: 1, one: 1, page: 1, idea: 1 };
		function tok(s) {
			return s
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, " ")
				.split(" ")
				.filter((w) => w.length > 1 && !STOP[w])
				.map((w) => (w.length > 4 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w)); // plural to singular, roughly
		}
		const docs = KB.map((e) => tok(e.q + " " + e.q + " " + (e.k || "") + " " + e.a));
		const N = docs.length;
		const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(N, 1);
		const df = {};
		docs.forEach((d) => {
			const seen = {};
			d.forEach((w) => {
				if (!seen[w]) {
					seen[w] = 1;
					df[w] = (df[w] || 0) + 1;
				}
			});
		});
		function score(q, d) {
			const tf = {};
			d.forEach((w) => (tf[w] = (tf[w] || 0) + 1));
			let s = 0;
			q.forEach((w) => {
				const f = tf[w] || 0;
				if (!f) return;
				const idf = Math.log(1 + (N - (df[w] || 0) + 0.5) / ((df[w] || 0) + 0.5));
				s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / avg)));
			});
			return s;
		}
		function rank(q) {
			return KB.map((e, i) => ({ e: e, s: score(q, docs[i]) })).sort((a, b) => b.s - a.s);
		}
		const TAB = {};
		root.querySelectorAll('[data-rd-tab]').forEach((t) => (TAB[t.id] = t.getAttribute("data-rd-label")));
		function tabOfSection(id) {
			const el = doc.getElementById(id);
			const p = el ? el.closest(".rd-tabpanel") : null;
			return p ? p.id : "";
		}
		function bubble(cls) {
			const div = doc.createElement("div");
			div.className = "idea-msg" + (cls ? " " + cls : "");
			log.appendChild(div);
			return div;
		}
		function para(div, text) {
			const p = doc.createElement("p");
			p.textContent = text;
			div.appendChild(p);
			return p;
		}
		function suggest(div, items) {
			if (!items.length) return;
			const ul = doc.createElement("ul");
			ul.className = "idea-chips";
			ul.setAttribute("aria-label", "Related questions");
			items.forEach((x) => {
				const li = doc.createElement("li");
				const b = doc.createElement("button");
				b.type = "button";
				b.className = "rd-btn";
				b.textContent = x.e.q;
				b.addEventListener("click", () => ask(x.e.q));
				li.appendChild(b);
				ul.appendChild(li);
			});
			div.appendChild(ul);
		}
		function ask(text) {
			const q = tok(text);
			para(bubble("idea-msg--me"), text);
			const r = rank(q);
			const top = r[0];
			const threshold = 2.2;
			const div = bubble("");
			if (!q.length || !top || top.s < threshold) {
				para(div, "I do not know. The notes on this page do not cover that.");
				suggest(div, r.slice(0, 3).filter((x) => x.s > 0));
			} else {
				para(div, top.e.a);
				const tab = tabOfSection(top.e.s);
				const p = doc.createElement("p");
				p.className = "rd-source";
				p.appendChild(doc.createTextNode("From: "));
				const a = doc.createElement("a");
				a.href = "?tab=" + tab + "#" + top.e.s; // a real navigation to that tab and section
				a.textContent = top.e.t + " (" + (TAB[tab] || tab) + " tab)";
				p.appendChild(a);
				div.appendChild(p);
				suggest(div, r.slice(1, 4).filter((x) => x.s >= threshold));
			}
			log.scrollTop = log.scrollHeight;
		}
		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const v = input.value.trim();
			input.value = "";
			if (v) ask(v);
		});
		root.querySelectorAll("[data-ask]").forEach((b) => {
			b.addEventListener("click", () => ask(b.getAttribute("data-ask")));
		});
	}
}
