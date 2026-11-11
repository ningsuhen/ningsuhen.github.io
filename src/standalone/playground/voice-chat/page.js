// The demo's behaviour lives in app.mjs next to the old page's runtime assets (pipeline, wasm, worklet).
// It finds its elements by id. Loaded with a module script tag rather than import(): the dev server
// refuses to bundle a script served from public/. Nothing downloads until the visitor presses Start.
export default function init({ root }) {
	const s = root.ownerDocument.createElement("script");
	s.type = "module";
	s.src = "/playground/voice-chat/app.mjs";
	root.append(s);
}
