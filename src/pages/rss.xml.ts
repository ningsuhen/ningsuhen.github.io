import { loadRenderers } from "astro:container";
import { type CollectionEntry, render } from "astro:content";
import { getContainerRenderer as mdxRenderer } from "@astrojs/mdx/container-renderer";
import rss from "@astrojs/rss";
import { getContainerRenderer as svelteRenderer } from "@astrojs/svelte/container-renderer";
import { getSortedPosts } from "@utils/content-utils";
import { toFeedPubDate } from "@utils/date-utils";
import { url } from "@utils/url-utils";
import type { APIContext } from "astro";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { siteConfig } from "@/config";
import { stripOwnerMarkers } from "../plugins/owner-markers.mjs";

const parser = new MarkdownIt();

function stripInvalidXmlChars(str: string): string {
	return str.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: https://www.w3.org/TR/xml/#charsets
		/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFDD0-\uFDEF\uFFFE\uFFFF]/g,
		"",
	);
}

let container: AstroContainer | undefined;

const hasClass = (attribs: Record<string, string>, name: string) =>
	(attribs.class ?? "").split(/\s+/).includes(name);

/** Rendered HTML carries KaTeX twice (visual spans and MathML, plus its TeX annotation) and a "#"
 * link per heading. Drop all but the MathML; the sanitizer below then strips classes and the rest. */
const dropDuplicates = (html: string) =>
	sanitizeHtml(html, {
		allowedTags: false,
		allowedAttributes: false,
		allowVulnerableTags: true, // the sanitizer below removes them
		exclusiveFilter: (f) =>
			f.tag === "annotation" ||
			hasClass(f.attribs, "katex-html") ||
			hasClass(f.attribs, "anchor"),
	});

/** Feed HTML of a post. MDX (imports, components, expressions) only means something rendered, so it
 * goes through Astro's container like the page does; markers are already dropped by the remark chain.
 * Markdown keeps the raw-body render it always had, minus the owner markers. */
async function feedHtml(post: CollectionEntry<"posts">): Promise<string> {
	if (post.filePath?.endsWith(".mdx")) {
		container ??= await AstroContainer.create({
			renderers: await loadRenderers([mdxRenderer(), svelteRenderer()]),
		});
		const { Content } = await render(post);
		return dropDuplicates(await container.renderToString(Content));
	}
	const body =
		typeof post.body === "string" ? post.body : String(post.body || "");
	return parser.render(stripOwnerMarkers(body));
}

// KaTeX's MathML output, so feed readers can show the math of rendered (MDX) posts.
const MATHML = [
	"math",
	"semantics",
	"mrow",
	"mi",
	"mn",
	"mo",
	"ms",
	"mtext",
	"mspace",
	"msup",
	"msub",
	"msubsup",
	"mfrac",
	"msqrt",
	"mroot",
	"mover",
	"munder",
	"munderover",
	"mtable",
	"mtr",
	"mtd",
	"mstyle",
	"mpadded",
	"mphantom",
	"menclose",
];
const SANITIZE: sanitizeHtml.IOptions = {
	allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", ...MATHML],
	allowedAttributes: {
		...sanitizeHtml.defaults.allowedAttributes,
		math: ["xmlns", "display"],
		mi: ["mathvariant"],
		mo: [
			"stretchy",
			"fence",
			"separator",
			"lspace",
			"rspace",
			"minsize",
			"maxsize",
			"accent",
		],
		mover: ["accent"],
		munder: ["accentunder"],
		mspace: ["width"],
		mpadded: ["width", "height", "depth", "lspace", "voffset"],
		mstyle: ["displaystyle", "scriptlevel", "mathcolor"],
		mtable: [
			"rowspacing",
			"columnspacing",
			"columnalign",
			"columnlines",
			"rowlines",
		],
		menclose: ["notation"],
	},
};

export async function GET(context: APIContext) {
	const blog = await getSortedPosts();
	const html = await Promise.all(blog.map(feedHtml));

	return rss({
		title: siteConfig.title,
		description: siteConfig.subtitle || "No description",
		site: context.site ?? "https://ningsuhen.github.io",
		items: blog.map((post, i) => ({
			title: post.data.title,
			pubDate: toFeedPubDate(post.data.published),
			description: post.data.description || "",
			link: url(`/posts/${post.id}/`),
			content: sanitizeHtml(stripInvalidXmlChars(html[i]), SANITIZE),
		})),
		customData: `<language>${siteConfig.lang}</language>`,
	});
}
