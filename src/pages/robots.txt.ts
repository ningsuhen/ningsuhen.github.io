import type { APIRoute } from "astro";

// AI training, AI search and AI assistant agents, each listed on its vendor's own documentation page.
// Normal search engines (Googlebot, Bingbot, Applebot, ...) stay allowed. robots.txt is voluntary:
// user-triggered fetchers (ChatGPT-User, Perplexity-User, Meta, Amazon, Google) say they may ignore it.
const AI_AGENTS = [
	// OpenAI: training, search, user fetch
	"GPTBot",
	"OAI-SearchBot",
	"ChatGPT-User",
	// Anthropic: training, user fetch, search
	"ClaudeBot",
	"Claude-User",
	"Claude-SearchBot",
	// Google: Gemini training/grounding control, Vertex agents, user-triggered AI fetchers
	"Google-Extended",
	"Google-CloudVertexBot",
	"Google-Agent",
	"Google-GeminiNotebook",
	"Google-NotebookLM",
	// Apple: opts out of foundation-model training only; Applebot (search) stays allowed
	"Applebot-Extended",
	// Common Crawl: open dataset used for training
	"CCBot",
	// Perplexity: search index, user fetch
	"PerplexityBot",
	"Perplexity-User",
	// Meta: training/indexing, search, user fetch
	"meta-externalagent",
	"Meta-WebIndexer",
	"meta-externalfetcher",
	// Amazon: product/AI training, search, user fetch
	"Amazonbot",
	"Amzn-SearchBot",
	"Amzn-User",
	// Mistral: training, index, user fetch
	"MistralAI-Training",
	"MistralAI-Index",
	"MistralAI-User",
	// DuckDuckGo AI answers
	"DuckAssistBot",
];

const robotsTxt = `
${AI_AGENTS.map((agent) => `User-agent: ${agent}`).join("\n")}
Disallow: /

User-agent: *
Disallow: /_astro/

Sitemap: ${new URL("sitemap-index.xml", import.meta.env.SITE).href}
`.trim();

export const GET: APIRoute = () => {
	return new Response(robotsTxt, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
