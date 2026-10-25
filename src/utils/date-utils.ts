// Date-only values (front matter `published: 2026-10-24`) parse to UTC midnight. Every helper here reads the
// UTC fields, so the calendar date is the same for every viewer. Do not use local getters (getDate, getFullYear).

/** YYYY-MM-DD in UTC. */
export function formatDateToYYYYMMDD(date: Date): string {
	return date.toISOString().substring(0, 10);
}

/** MM-DD in UTC (archive day label). */
export function formatMonthDay(date: Date): string {
	return formatDateToYYYYMMDD(date).substring(5);
}

/** Calendar year in UTC (archive year groups). */
export function getYearUTC(date: Date): number {
	return date.getUTCFullYear();
}

/** RSS pubDate for a date-only value: noon UTC. Readers from UTC-12 to UTC+11 see the same day; UTC+12 and beyond see the next. */
export function toFeedPubDate(date: Date): Date {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
	);
}
