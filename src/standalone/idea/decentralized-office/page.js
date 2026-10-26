// Idea-page behaviour, scoped to the fragment root (the shell passes { root, data, rd }).
// data is null here: the notes for the Ask tab live in the <script data-rd-data> in the body.
// ideaGo(sectionId) is set by rd.js (mountTabs) for same-page tab navigation.
export default function init({ root }) {
	const doc = root.ownerDocument;
	const view = doc.defaultView;

	// Step-through figures: Next and Back move the highlight and the caption. No history entries.
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

	// Who can read: pick a pre-written setup. The table text is written out by hand, nothing is computed.
	const table = root.querySelector(".idea-table");
	if (table) {
		function pick(p) {
			table.querySelectorAll("[data-p]").forEach((el) => el.classList.toggle("is-on", el.getAttribute("data-p") === p));
			const pick1 = root.querySelector('input[name="idea-preset"][value="' + p + '"]');
			const st = root.querySelector("#idea-preset-status");
			if (pick1 && st) st.textContent = "Showing: " + pick1.parentElement.textContent.trim();
		}
		root.querySelectorAll('input[name="idea-preset"]').forEach((r) => {
			r.addEventListener("change", () => {
				if (r.checked) pick(r.value);
			});
		});
		const checked = root.querySelector('input[name="idea-preset"]:checked');
		pick(checked ? checked.value : "sealed");
		table.classList.add("is-js");
	}

	// Quiz: a choice shows right or not quite; the explanation is always one tap away.
	const answers = { q1: "b", q2: "b", q3: "b", q4: "b" };
	root.querySelectorAll(".idea-quiz fieldset").forEach((fs) => {
		const key = "q" + fs.getAttribute("data-q");
		const verdict = fs.querySelector(".idea-verdict");
		fs.querySelectorAll('input[type="radio"]').forEach((r) => {
			r.addEventListener("change", () => {
				const ok = r.value === answers[key];
				verdict.textContent = ok ? "Right." : "Not quite. Open the answer.";
				verdict.className = "idea-verdict " + (ok ? "idea-verdict--ok" : "idea-verdict--no");
				const det = fs.querySelector("details");
				if (det) det.open = true;
			});
		});
	});

	// Ask this idea: local retrieval over the notes below. BM25 over the entries, top match, related chips, honest fallback.
	const kbEl = root.querySelector('script[data-rd-data][id="idea-kb"]');
	const form = root.querySelector("#idea-ask-form");
	const input = root.querySelector("#idea-ask-input");
	const log = root.querySelector("#idea-log");
	if (kbEl && form && input && log) {
		const KB = JSON.parse(kbEl.textContent || "[]");
		const STOP = { a: 1, an: 1, the: 1, is: 1, are: 1, of: 1, to: 1, in: 1, on: 1, and: 1, or: 1, it: 1, this: 1, that: 1, do: 1, does: 1, for: 1, be: 1, with: 1, my: 1, i: 1, what: 1, how: 1, can: 1, if: 1, so: 1, at: 1, by: 1, as: 1, from: 1, about: 1, me: 1, you: 1, your: 1, we: 1, they: 1, their: 1, not: 1 };
		function tok(s) {
			return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !STOP[w]);
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
		function bubble(cls, text) {
			const div = doc.createElement("div");
			div.className = "idea-msg" + (cls ? " " + cls : "");
			const p = doc.createElement("p");
			p.textContent = text;
			div.appendChild(p);
			log.appendChild(div);
			log.scrollTop = log.scrollHeight;
			return div;
		}
		function chip(label, fn) {
			const b = doc.createElement("button");
			b.type = "button";
			b.className = "idea-cite";
			b.textContent = label;
			b.addEventListener("click", fn);
			return b;
		}
		function ask(text) {
			const q = tok(text);
			if (!q.length) return;
			bubble("idea-msg--me", text);
			const r = rank(q);
			const top = r[0];
			const threshold = 2.2;
			let div;
			if (!top || top.s < threshold) {
				div = bubble("", "I do not know that from the notes on this page. Here are related topics:");
				r
					.slice(0, 3)
					.filter((x) => x.s > 0)
					.forEach((x) => {
						div.appendChild(chip(x.e.q, () => ask(x.e.q)));
					});
				return;
			}
			div = bubble("", top.e.a);
			const cite = doc.createElement("p");
			cite.appendChild(chip("Show the section: " + top.e.t, () => ideaGo(top.e.s)));
			div.appendChild(cite);
			const related = r.slice(1, 4).filter((x) => x.s >= threshold);
			if (related.length) {
				const rel = doc.createElement("p");
				related.forEach((x) => rel.appendChild(chip(x.e.q, () => ask(x.e.q))));
				div.appendChild(rel);
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
