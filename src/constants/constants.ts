export const PAGE_SIZE = 8;

export const LIGHT_MODE = "light",
	DARK_MODE = "dark",
	AUTO_MODE = "auto";
// Default to light on first visit (ignores the OS preference); the dark toggle still works and is persisted.
export const DEFAULT_THEME = LIGHT_MODE;

// Banner height unit: vh
export const BANNER_HEIGHT = 26;
export const BANNER_HEIGHT_EXTEND = 10;
export const BANNER_HEIGHT_HOME = BANNER_HEIGHT + BANNER_HEIGHT_EXTEND;

// The height the main panel overlaps the banner, unit: rem
export const MAIN_PANEL_OVERLAPS_BANNER_HEIGHT = 3.5;

// Page width: rem
export const PAGE_WIDTH = 75;
