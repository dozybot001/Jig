import { randomBytes } from "node:crypto";

let lastMs = 0;
let counter = 0;

/**
 * UUIDv7 (RFC 9562). Ids from one process sort by creation order, which keyset pagination relies on:
 * within the same millisecond a 12-bit counter in `rand_a` keeps them increasing.
 */
export function newId(): string {
	const bytes = randomBytes(16);
	let ms = Date.now();
	if (ms > lastMs) {
		lastMs = ms;
		counter = bytes.readUInt16BE(6) & 0x7ff;
	} else {
		ms = lastMs;
		counter++;
		if (counter > 0xfff) {
			lastMs++;
			ms = lastMs;
			counter = 0;
		}
	}
	bytes.writeUIntBE(ms, 0, 6);
	bytes[6] = 0x70 | (counter >> 8);
	bytes[7] = counter & 0xff;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const h = bytes.toString("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
