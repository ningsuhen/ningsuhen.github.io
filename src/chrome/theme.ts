import { themeRuntimeScript } from "../utils/theme-runtime";

export const THEME_MARKER = "data-site-theme";
// Theme model in <head>, before first paint (see src/utils/theme-runtime.ts). Light unless the reader chose otherwise.
const HEAD_THEME = `<script ${THEME_MARKER}>${themeRuntimeScript(true)}</script>`;

// The theme script goes at the end of <head>, or right after <html> when the export has no </head>.
export function withThemeScript(html: string): string {
	if (html.includes(THEME_MARKER)) return html;
	const headEnd = html.search(/<\/head>/i);
	if (headEnd !== -1) return html.slice(0, headEnd) + HEAD_THEME + html.slice(headEnd);
	// No </head>: land after the page's charset/viewport metas, so they stay the first head elements.
	const metas = [...html.slice(0, 4096).matchAll(/<meta[^>]+(?:charset=|name=["']viewport["'])[^>]*>/gi)];
	if (metas.length) {
		const last = metas[metas.length - 1];
		const at = (last.index ?? 0) + last[0].length;
		return html.slice(0, at) + HEAD_THEME + html.slice(at);
	}
	return html.replace(/<html(?=[\s>])[^>]*>/i, (tag) => tag + HEAD_THEME);
}
