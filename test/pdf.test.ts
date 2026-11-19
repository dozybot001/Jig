import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { inspectPdf, isPdfBuffer, parsePageRange, readPdf } from "../src/server/pdf.ts";
import { readTool } from "../src/server/tools/files.ts";
import { Jobs } from "../src/server/tools/jobs.ts";
import { ReadState } from "../src/server/tools/read-state.ts";
import type { ToolContext } from "../src/server/tools/types.ts";
import { buildPdf } from "./helpers/pdf.ts";
import { newStore, sessionInput, tempDir } from "./helpers/store.ts";

function toolCtx(cwd: string): ToolContext {
	const { store } = newStore();
	const session = store.createSession({ ...sessionInput("pdf-test"), cwd });
	return {
		session,
		signal: new AbortController().signal,
		readState: new ReadState(),
		jobs: new Jobs(() => {}),
		tmpDir: tempDir("yew-pdf-out-"),
		acceptsImages: true,
		version: "0.0.0",
		output: () => {},
		setTodos: () => {},
		ask: async () => "yes",
		mail: {} as ToolContext["mail"],
		helper: async () => ({ text: "", calls: 0 }),
	};
}

describe("pdf parser and read tool", () => {
	test("parsePageRange handles single pages, ranges, deduplication, and caps", () => {
		assert.deepEqual(parsePageRange(undefined, 5, 20), {
			pages: [1, 2, 3, 4, 5],
			truncated: false,
		});
		assert.deepEqual(parsePageRange("3, 1-2, 2", 10, 20), {
			pages: [1, 2, 3],
			truncated: false,
		});
		assert.deepEqual(parsePageRange("1-25", 30, 10), {
			pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			truncated: true,
		});
		assert.throws(() => parsePageRange("5-2", 10, 20), /invalid page range/i);
		assert.throws(() => parsePageRange("99", 5, 20), /out of range/i);
	});

	test("inspectPdf and readPdf extract text offline and render scanned pages as PNG", async () => {
		const pdf = buildPdf([
			"First page of the quarterly engineering report for Tenon AI.",
			"",
			"Third page concludes the technical architecture review.",
		]);
		assert.equal(isPdfBuffer(pdf), true);
		assert.equal(isPdfBuffer(Buffer.from("plain text")), false);

		const info = await inspectPdf(pdf);
		assert.equal(info.pages, 3);

		const result = await readPdf(pdf, { pages: "1-3", renderScanned: true });
		assert.equal(result.totalPages, 3);
		assert.deepEqual(result.readPages, [1, 2, 3]);
		assert.match(result.text, /quarterly engineering report/);
		assert.match(result.text, /technical architecture review/);
		// Page 2 has no text: rendered as PNG via @napi-rs/canvas.
		assert.equal(result.images.length, 1);
		assert.equal(result.images[0]?.page, 2);
		assert.equal(result.images[0]?.mimeType, "image/png");
		assert.deepEqual(
			result.images[0]?.data.subarray(0, 8),
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		);
	});

	test("readTool reads PDF files with page ranges and still rejects other binaries", async () => {
		const dir = tempDir("yew-pdf-ws-");
		const pdfPath = join(dir, "spec.pdf");
		writeFileSync(
			pdfPath,
			buildPdf([
				"Page one covers requirements and milestones in full detail.",
				"Page two lists verification checks and security boundaries.",
			]),
		);
		const binPath = join(dir, "blob.bin");
		writeFileSync(binPath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]));

		const ctx = toolCtx(dir);
		const page2 = await readTool.run({ path: "spec.pdf", pages: "2" }, ctx);
		assert.equal(page2.isError, undefined);
		const textBlock = page2.content.find((b) => b.type === "text");
		assert.ok(textBlock && textBlock.type === "text");
		assert.match(textBlock.text, /verification checks/);
		assert.doesNotMatch(textBlock.text, /Page one covers/);

		const binary = await readTool.run({ path: "blob.bin" }, ctx);
		assert.equal(binary.isError, true);
	});
});
