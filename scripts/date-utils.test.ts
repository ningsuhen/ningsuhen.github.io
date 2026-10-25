// Unit tests for the shared date helpers: the same calendar date in every timezone. Run: pnpm test:dates
// Date-only values parse to UTC midnight, exactly like front matter `published: 2026-10-24`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatDateToYYYYMMDD,
	formatMonthDay,
	getYearUTC,
	toFeedPubDate,
} from "../src/utils/date-utils.ts";

const ZONES = [
	"America/New_York",
	"Pacific/Kiritimati",
	"Pacific/Pago_Pago",
	"UTC",
];
const EDGE_DATES = ["2026-10-24", "2026-01-01", "2026-12-31", "2024-02-29"];

function formatAll(): string[] {
	return EDGE_DATES.flatMap((iso) => {
		const date = new Date(iso);
		return [
			formatDateToYYYYMMDD(date),
			formatMonthDay(date),
			String(getYearUTC(date)),
			toFeedPubDate(date).toISOString(),
		];
	});
}

test("helpers give the same output in every timezone", () => {
	const original = process.env.TZ;
	try {
		const expected = [
			"2026-10-24",
			"10-24",
			"2026",
			"2026-10-24T12:00:00.000Z",
			"2026-01-01",
			"01-01",
			"2026",
			"2026-01-01T12:00:00.000Z",
			"2026-12-31",
			"12-31",
			"2026",
			"2026-12-31T12:00:00.000Z",
			"2024-02-29",
			"02-29",
			"2024",
			"2024-02-29T12:00:00.000Z",
		];
		for (const zone of ZONES) {
			process.env.TZ = zone;
			// Guard: the runtime really switched zone, so the local getters shift and the test has teeth.
			if (zone === "America/New_York")
				assert.equal(new Date("2026-10-24").getDate(), 23);
			assert.deepEqual(
				formatAll(),
				expected,
				`output differs under TZ=${zone}`,
			);
		}
	} finally {
		if (original === undefined) delete process.env.TZ;
		else process.env.TZ = original;
	}
});

test("year grouping uses the UTC year at the New Year boundary", () => {
	const original = process.env.TZ;
	try {
		process.env.TZ = "America/New_York";
		// 2027-01-01 UTC midnight is still 2026-12-31 in New York; the archive groups by the UTC year.
		assert.equal(getYearUTC(new Date("2027-01-01")), 2027);
	} finally {
		if (original === undefined) delete process.env.TZ;
		else process.env.TZ = original;
	}
});
