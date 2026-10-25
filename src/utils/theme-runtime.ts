/**
 * The one theme model, shared by the main site and every standalone page.
 *
 * localStorage "theme" holds "light" | "dark" | "auto". Anything else (unset, garbage) means light.
 * Only "auto" follows the OS, and only because the owner picked System in the display panel.
 * Nothing here writes storage except an explicit set() from a toggle.
 *
 * Returns a plain script (no imports) so it can run in <head> before first paint on every page, and so
 * the Node-side Astro integration can inline it into standalone HTML. The main site toggles the `dark`
 * class; standalone pages also get <html data-theme="light|dark"> (dataTheme=true), which their CSS reads,
 * and the stored theme hue ("hue", from the navbar slider) as --hue on <html>, which research.css derives from.
 * (The main site applies its hue in Layout.astro.)
 * Exposes window.siteTheme = { choice(), dark(), set(choice) } for the toggles.
 */
export function themeRuntimeScript(dataTheme: boolean): string {
	const setDataTheme = dataTheme ? 'r.setAttribute("data-theme",d?"dark":"light");' : "";
	const applyHue = dataTheme ? 'try{var h=localStorage.getItem("hue");if(h)r.style.setProperty("--hue",h)}catch(e){}' : "";
	return (
		"(function(){var r=document.documentElement,mq=window.matchMedia('(prefers-color-scheme: dark)');" +
		`function hue(){${applyHue}}hue();` +
		'function choice(){var v=null;try{v=localStorage.getItem("theme")}catch(e){}return v==="dark"||v==="auto"?v:"light"}' +
		'function dark(){var c=choice();return c==="dark"||(c==="auto"&&mq.matches)}' +
		`function apply(){var d=dark();r.classList.toggle("dark",d);${setDataTheme}}` +
		'function set(c){try{localStorage.setItem("theme",c)}catch(e){}apply()}' +
		"window.siteTheme={choice:choice,dark:dark,set:set};apply();" +
		'mq.addEventListener("change",apply);' +
		'addEventListener("storage",function(e){if(e.key===null||e.key==="theme")apply();if(e.key===null||e.key==="hue")hue()})})();'
	);
}
