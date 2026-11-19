/** Builds a minimal valid multi-page PDF buffer with the given text on each page (empty = scanned). */
export function buildPdf(pageTexts: string[]): Buffer {
	const objects: string[] = [];
	const pageIds: number[] = [];
	const contentStart = 4;
	for (let i = 0; i < pageTexts.length; i++) {
		pageIds.push(contentStart + i * 2);
	}
	objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
	objects.push(
		`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>\nendobj\n`,
	);
	objects.push("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
	for (let i = 0; i < pageTexts.length; i++) {
		const pageId = contentStart + i * 2;
		const streamId = pageId + 1;
		const raw = pageTexts[i] ?? "";
		const escaped = raw.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
		const stream = raw
			? `BT /F1 14 Tf 50 720 Td (${escaped}) Tj ET\n`
			: "q 0.9 0.9 0.9 rg 50 650 200 100 re f Q\n";
		objects.push(
			`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>\nendobj\n`,
		);
		objects.push(
			`${streamId} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`,
		);
	}

	const parts: string[] = ["%PDF-1.4\n"];
	const offsets: number[] = [0];
	let offset = Buffer.byteLength(parts[0] as string);
	for (const obj of objects) {
		offsets.push(offset);
		parts.push(obj);
		offset += Buffer.byteLength(obj);
	}
	const xrefPos = offset;
	parts.push(`xref\n0 ${objects.length + 1}\n`);
	parts.push("0000000000 65535 f \n");
	for (let i = 1; i <= objects.length; i++) {
		parts.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
	}
	parts.push(
		`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`,
	);
	return Buffer.from(parts.join(""), "utf8");
}
