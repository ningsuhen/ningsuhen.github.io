// A post's source file. New posts are MDX (index.mdx); older posts stay Markdown (index.md).
import { existsSync } from "node:fs";
import path from "node:path";

/** Source file names in lookup order; the first is what new posts use. */
export const POST_SOURCES = /** @type {const} */ (["index.mdx", "index.md"]);

/** The source file of the post folder `dir`, or undefined when it has none. */
export const postSource = (dir) => POST_SOURCES.map((f) => path.join(dir, f)).find((f) => existsSync(f));
