// rd-fullscreen: expand a container to fill the viewport. Uses the Fullscreen API when available
// (with the -webkit- prefix on older Safari); on iOS Safari, which has no Fullscreen API, it falls
// back to an "expanded" fixed overlay that covers the viewport. Esc, the toggle button or the F key
// exits. A ResizeObserver fires rd:resize so charts re-render; focus is kept inside; scroll is locked
// and restored; safe-area insets are honoured.
//
// Opt-in: a page puts data-rd="fullscreen" on the container and provides a toggle button
// (data-rd-fullscreen-toggle, an aria-pressed button with a Lucide maximize/minimize icon). rd.js
// (index.js) mounts this. Without JS the button is inert (no expansion), which is the safe default.

// Pure: which Fullscreen API method, if any, a document exposes. Returns the method name or null.
// (Older Safari exposes webkitRequestFullscreen; modern browsers requestFullscreen.)
export function fullscreenMethod(doc) {
	if (doc.requestFullscreen) return "requestFullscreen";
	if (doc.webkitRequestFullscreen) return "webkitRequestFullscreen";
	return null;
}

// Pure: the focusable elements inside a root, in DOM order, used to trap Tab. The standard focusable
// set is exactly the elements whose effective tabindex is >= 0 (a disabled control reports -1, so it
// is excluded for free).
export function focusable(root) {
	return Array.from(root.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")).filter((el) => el.tabIndex >= 0);
}

// Mount fullscreen on a container. opts: { toggle: the button element }. Returns { toggle, exit, dispose }.
export function mountFullscreen(container, opts = {}) {
	const toggle = opts.toggle || container.querySelector("[data-rd-fullscreen-toggle]");
	const method = fullscreenMethod(document);
	let mode = "none"; // "none" | "fullscreen" | "overlay"
	let prevOverflow = "";
	let prevFocus = null;

	function icon(name) {
		if (!toggle) return;
		const use = toggle.querySelector("use");
		if (use) use.setAttribute("href", `#i-${name}`);
		toggle.setAttribute("aria-pressed", mode === "none" ? "false" : "true");
	}
	function lockScroll() {
		prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
	}
	function unlockScroll() {
		document.body.style.overflow = prevOverflow;
	}
	function enterOverlay() {
		mode = "overlay";
		lockScroll();
		container.classList.add("is-expanded");
		const first = focusable(container)[0];
		if (first) first.focus();
	}
	function enter() {
		if (mode !== "none") return;
		prevFocus = document.activeElement;
		if (method) {
			const p = container[method]();
			if (p && p.catch) p.catch(enterOverlay); // request failed (e.g. iOS) → overlay
			else mode = "fullscreen";
		} else enterOverlay();
		icon("minimize");
	}
	function exit() {
		if (mode === "fullscreen") {
			const ex = document.exitFullscreen || document.webkitExitFullscreen;
			if (ex) ex.call(document);
		} else if (mode === "overlay") {
			container.classList.remove("is-expanded");
			unlockScroll();
			if (prevFocus && prevFocus.focus) prevFocus.focus();
		}
		mode = "none";
		icon("maximize");
	}
	function onFsChange() {
		const active = document.fullscreenElement || document.webkitFullscreenElement;
		if (!active && mode === "fullscreen") exit();
	}
	function onKey(e) {
		if (mode === "none") {
			if (e.key === "f" || e.key === "F") enter();
			return;
		}
		if (e.key === "Escape" && mode === "overlay") exit(); // native Esc covers real fullscreen
		// Trap Tab inside the container while expanded.
		if (e.key === "Tab") {
			const items = focusable(container);
			if (!items.length) return;
			const first = items[0], last = items[items.length - 1];
			if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
		}
	}
	const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => container.dispatchEvent(new CustomEvent("rd:resize"))) : null;
	if (ro) ro.observe(container);

	const onToggle = () => (mode === "none" ? enter() : exit());
	if (toggle) toggle.addEventListener("click", onToggle);
	document.addEventListener("fullscreenchange", onFsChange);
	document.addEventListener("webkitfullscreenchange", onFsChange);
	document.addEventListener("keydown", onKey, true);

	return {
		toggle: enter,
		exit,
		dispose() {
			if (mode !== "none") exit();
			if (ro) ro.disconnect();
			if (toggle) toggle.removeEventListener("click", onToggle);
			document.removeEventListener("fullscreenchange", onFsChange);
			document.removeEventListener("webkitfullscreenchange", onFsChange);
			document.removeEventListener("keydown", onKey, true);
		},
	};
}
