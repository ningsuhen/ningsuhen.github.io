// The playground's behaviour lives in the runtime assets next to this page (app.js, eval.js, lpm/).
// app.js finds its elements by id, so it only needs this fragment in the page. It is loaded with a module
// script tag rather than import(): the dev server refuses to bundle a script served from public/.
export default function init({ root }) {
	const s = root.ownerDocument.createElement("script");
	s.type = "module";
	s.src = "/playground/lpm-playground/app.js";
	root.append(s);
}
