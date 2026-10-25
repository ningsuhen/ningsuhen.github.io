// Vendored no-op (Brev). Upstream sends a beacon to pyke's analytics endpoint on each session
// init. Every Brev crate turns telemetry off (`ort::init().with_telemetry(false)`), and a
// public site should not ship the endpoint or its loopback check at all. Same export, so
// binding/mod.rs is unchanged; restore upstream's file to re-enable.

/** @param {string} _version */
export function trackSessionInit(_version) {
	return false;
}
