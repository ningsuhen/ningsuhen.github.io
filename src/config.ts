import type {
	CommentConfig,
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "Ning Waikhom",
	subtitle: "AI | ML | Rust | Python | TypeScript",
	lang: "en", // Language code, e.g. 'en', 'zh_CN', 'ja', etc.
	themeColor: {
		hue: 250, // Default hue for the theme color, from 0 to 360. e.g. red: 0, teal: 200, cyan: 250, pink: 345
		fixed: false, // Hide the theme color picker for visitors
	},
	banner: {
		enable: true,
		src: "assets/images/banner.png", // Relative to the /src directory. Relative to the /public directory if it starts with '/'
		position: "bottom", // Equivalent to object-position, only supports 'top', 'center', 'bottom'. 'center' by default
		credit: {
			enable: false, // Display the credit text of the banner image
			text: "", // Credit text to be displayed
			url: "", // (Optional) URL link to the original artwork or artist's page
		},
	},
	toc: {
		enable: true, // Display the table of contents on the right side of the post
		depth: 2, // Maximum heading depth to show in the table, from 1 to 3
	},
	favicon: [
		// Leave this array empty to use the default favicon
		// {
		//   src: '/favicon/icon.png',    // Path of the favicon, relative to the /public directory
		//   theme: 'light',              // (Optional) Either 'light' or 'dark', set only if you have different favicons for light and dark mode
		//   sizes: '32x32',              // (Optional) Size of the favicon, set only if you have favicons of different sizes
		// }
	],
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		LinkPreset.About,
		{
			name: "Experiments",
			url: "/experiments/",
		},
		{
			name: "GitHub",
			url: "https://github.com/ningsuhen", // Internal links should not include the base path, as it is automatically added
			external: true, // Show an external link icon and will open in a new tab
		},
	],
};

export const profileConfig: ProfileConfig = {
	avatar: "assets/images/avatar.jpg", // Relative to the /src directory. Relative to the /public directory if it starts with '/'
	name: "Ning Waikhom",
	bio: "AI | ML | Rust | Python | TypeScript",
	links: [
		{
			name: "GitHub",
			icon: "lucide:github",
			url: "https://github.com/ningsuhen",
		},
		{
			name: "LinkedIn",
			icon: "lucide:linkedin",
			url: "https://www.linkedin.com/in/ningsuhen/",
		},
		{
			name: "X (Twitter)",
			icon: "lucide:twitter",
			url: "https://twitter.com/ningsuhen",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: false,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

// Comments via Giscus (GitHub Discussions). The repo's discussions are enabled
// and use the "Announcements" category. The giscus GitHub App must be installed
// on this repo for the widget to load (see README).
export const commentConfig: CommentConfig = {
	enable: true,
	repo: "ningsuhen/ningsuhen.github.io",
	repoId: "MDEwOlJlcG9zaXRvcnkxODI0NTQzMw==",
	category: "Announcements",
	categoryId: "DIC_kwDOARZnOc4DJh9t",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	// Note: Some styles (such as background color) are being overridden, see the astro.config.mjs file.
	// Please select a dark theme, as this blog theme currently only supports dark background color
	theme: "github-dark",
};
