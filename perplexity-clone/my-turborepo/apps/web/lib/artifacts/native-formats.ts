import { deflateRawSync, inflateRawSync } from "node:zlib";

// Standard CRC32 table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let k = 0; k < 8; k++) {
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	CRC32_TABLE[i] = c >>> 0;
}

export function crc32(buf: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]!) & 0xff]!;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFileEntry {
	readonly path: string;
	readonly data: Uint8Array | string;
}

export interface UnzippedFile {
	readonly path: string;
	readonly data: Buffer;
}

/**
 * Pure TypeScript PKZIP archive generator using Node.js built-in deflate.
 * Produces standard zip archives readable by any OS and Office tool.
 */
export function buildZip(entries: readonly ZipFileEntry[]): Buffer {
	const localHeaders: Buffer[] = [];
	const centralHeaders: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const rawData = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.from(entry.data);
		const compressed = deflateRawSync(rawData);
		const useCompressed = compressed.length < rawData.length;
		const finalData = useCompressed ? compressed : rawData;
		const method = useCompressed ? 8 : 0;
		const entryCrc = crc32(rawData);

		const nameBuffer = Buffer.from(entry.path, "utf8");

		// Local file header (30 bytes + name + data)
		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034b50, 0); // signature
		localHeader.writeUInt16LE(20, 4); // version needed
		localHeader.writeUInt16LE(0, 6); // bit flag
		localHeader.writeUInt16LE(method, 8); // compression method
		localHeader.writeUInt16LE(0, 10); // last mod time
		localHeader.writeUInt16LE(0, 12); // last mod date
		localHeader.writeUInt32LE(entryCrc, 14); // crc-32
		localHeader.writeUInt32LE(finalData.length, 18); // compressed size
		localHeader.writeUInt32LE(rawData.length, 22); // uncompressed size
		localHeader.writeUInt16LE(nameBuffer.length, 26); // file name length
		localHeader.writeUInt16LE(0, 28); // extra field length

		const localBlock = Buffer.concat([localHeader, nameBuffer, finalData]);
		localHeaders.push(localBlock);

		// Central directory header (46 bytes + name)
		const centralHeader = Buffer.alloc(46);
		centralHeader.writeUInt32LE(0x02014b50, 0); // signature
		centralHeader.writeUInt16LE(20, 4); // version made by
		centralHeader.writeUInt16LE(20, 6); // version needed
		centralHeader.writeUInt16LE(0, 8); // bit flag
		centralHeader.writeUInt16LE(method, 10); // compression method
		centralHeader.writeUInt16LE(0, 12); // last mod time
		centralHeader.writeUInt16LE(0, 14); // last mod date
		centralHeader.writeUInt32LE(entryCrc, 16); // crc-32
		centralHeader.writeUInt32LE(finalData.length, 20); // compressed size
		centralHeader.writeUInt32LE(rawData.length, 24); // uncompressed size
		centralHeader.writeUInt16LE(nameBuffer.length, 28); // file name length
		centralHeader.writeUInt16LE(0, 30); // extra field length
		centralHeader.writeUInt16LE(0, 32); // comment length
		centralHeader.writeUInt16LE(0, 34); // disk number start
		centralHeader.writeUInt16LE(0, 36); // internal file attributes
		centralHeader.writeUInt32LE(0, 38); // external file attributes
		centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

		centralHeaders.push(Buffer.concat([centralHeader, nameBuffer]));
		offset += localBlock.length;
	}

	const centralDirOffset = offset;
	const centralDir = Buffer.concat(centralHeaders);
	const centralDirSize = centralDir.length;

	// End of central directory record (22 bytes)
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0); // signature
	eocd.writeUInt16LE(0, 4); // disk number
	eocd.writeUInt16LE(0, 6); // disk where central dir starts
	eocd.writeUInt16LE(entries.length, 8); // records on this disk
	eocd.writeUInt16LE(entries.length, 10); // total records
	eocd.writeUInt32LE(centralDirSize, 12); // size of central directory
	eocd.writeUInt32LE(centralDirOffset, 16); // offset of central directory
	eocd.writeUInt16LE(0, 20); // comment length

	return Buffer.concat([...localHeaders, centralDir, eocd]);
}

/**
 * Pure TypeScript PKZIP unpacker.
 */
export function unpackZip(buffer: Buffer): UnzippedFile[] {
	const files: UnzippedFile[] = [];
	let offset = 0;

	while (offset < buffer.length - 30) {
		const sig = buffer.readUInt32LE(offset);
		if (sig !== 0x04034b50) break; // Not local header

		const method = buffer.readUInt16LE(offset + 8);
		const compressedSize = buffer.readUInt32LE(offset + 18);
		const nameLength = buffer.readUInt16LE(offset + 26);
		const extraLength = buffer.readUInt16LE(offset + 28);

		const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
		const dataStart = offset + 30 + nameLength + extraLength;
		const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

		let decompressed: Buffer;
		if (method === 8) {
			decompressed = inflateRawSync(compressedData);
		} else {
			decompressed = Buffer.from(compressedData);
		}

		files.push({ path: name, data: decompressed });
		offset = dataStart + compressedSize;
	}

	return files;
}

/**
 * Generate native Office Open XML (.docx)
 */
export function generateNativeDocx(input: {
	readonly title: string;
	readonly headings: readonly string[];
	readonly paragraphs: readonly string[];
	readonly tables?: readonly { headers: readonly string[]; rows: readonly string[][] }[];
}): Buffer {
	const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

	const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

	let bodyContent = `    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${escapeXml(input.title)}</w:t></w:r></w:p>\n`;

	for (const heading of input.headings) {
		bodyContent += `    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(heading)}</w:t></w:r></w:p>\n`;
	}

	for (const p of input.paragraphs) {
		bodyContent += `    <w:p><w:r><w:t>${escapeXml(p)}</w:t></w:r></w:p>\n`;
	}

	if (input.tables) {
		for (const tbl of input.tables) {
			bodyContent += `    <w:tbl>\n`;
			bodyContent += `      <w:tr>\n`;
			for (const h of tbl.headers) {
				bodyContent += `        <w:tc><w:p><w:r><w:t>${escapeXml(h)}</w:t></w:r></w:p></w:tc>\n`;
			}
			bodyContent += `      </w:tr>\n`;
			for (const row of tbl.rows) {
				bodyContent += `      <w:tr>\n`;
				for (const cell of row) {
					bodyContent += `        <w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>\n`;
				}
				bodyContent += `      </w:tr>\n`;
			}
			bodyContent += `    </w:tbl>\n`;
		}
	}

	const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${bodyContent}
  </w:body>
</w:document>`;

	return buildZip([
		{ path: "[Content_Types].xml", data: contentTypes },
		{ path: "_rels/.rels", data: rels },
		{ path: "word/document.xml", data: docXml },
	]);
}

/**
 * Generate native Excel Open XML (.xlsx)
 */
function colToLetter(colIndex: number): string {
	let temp = colIndex;
	let letter = "";
	while (temp >= 0) {
		letter = String.fromCharCode((temp % 26) + 65) + letter;
		temp = Math.floor(temp / 26) - 1;
	}
	return letter;
}

export function generateNativeXlsx(
	sheets: readonly {
		readonly name: string;
		readonly headers: readonly string[];
		readonly rows: readonly (string | number)[][];
		readonly formulas?: Readonly<Record<string, string>>;
	}[],
): Buffer {
	const validSheets = sheets.length > 0 ? sheets : [{ name: "Sheet1", headers: [], rows: [] }];

	let contentTypesOverrides = "";
	let workbookRelsEntries = "";
	let workbookSheets = "";
	const zipFiles: { path: string; data: string | Buffer }[] = [];

	validSheets.forEach((sheet, idx) => {
		const sheetNum = idx + 1;
		const rId = `rId${sheetNum}`;
		const sheetPath = `xl/worksheets/sheet${sheetNum}.xml`;

		contentTypesOverrides += `  <Override PartName="/${sheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n`;
		workbookRelsEntries += `  <Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNum}.xml"/>\n`;
		workbookSheets += `    <sheet name="${escapeXml(sheet.name || `Sheet${sheetNum}`)}" sheetId="${sheetNum}" r:id="${rId}"/>\n`;

		let sheetData = "";
		if (sheet.headers.length > 0) {
			sheetData += `    <row r="1">\n`;
			sheet.headers.forEach((h, colIdx) => {
				const colLetter = colToLetter(colIdx);
				sheetData += `      <c r="${colLetter}1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>\n`;
			});
			sheetData += `    </row>\n`;
		}

		sheet.rows.forEach((row, rowIdx) => {
			const rNum = rowIdx + 2;
			sheetData += `    <row r="${rNum}">\n`;
			row.forEach((val, colIdx) => {
				const colLetter = colToLetter(colIdx);
				const cellRef = `${colLetter}${rNum}`;
				const formula = sheet.formulas?.[cellRef];

				if (formula) {
					sheetData += `      <c r="${cellRef}"><f>${escapeXml(formula)}</f><v>${escapeXml(String(val))}</v></c>\n`;
				} else if (typeof val === "number") {
					sheetData += `      <c r="${cellRef}"><v>${val}</v></c>\n`;
				} else {
					sheetData += `      <c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(String(val))}</t></is></c>\n`;
				}
			});
			sheetData += `    </row>\n`;
		});

		const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
${sheetData}  </sheetData>
</worksheet>`;

		zipFiles.push({ path: sheetPath, data: worksheetXml });
	});

	const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${contentTypesOverrides}</Types>`;

	const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

	const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${workbookRelsEntries}</Relationships>`;

	const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${workbookSheets}  </sheets>
</workbook>`;

	zipFiles.push(
		{ path: "[Content_Types].xml", data: contentTypes },
		{ path: "_rels/.rels", data: rels },
		{ path: "xl/_rels/workbook.xml.rels", data: workbookRels },
		{ path: "xl/workbook.xml", data: workbook },
	);

	return buildZip(zipFiles);
}

/**
 * Generate native PowerPoint Open XML (.pptx)
 */
export function generateNativePptx(input: {
	readonly title: string;
	readonly slides: readonly { readonly title: string; readonly bullets: readonly string[] }[];
}): Buffer {
	const slides = input.slides.length > 0 ? input.slides : [{ title: input.title, bullets: [] }];

	let contentTypesOverrides = "";
	let presRelsEntries = "";
	let sldIdEntries = "";
	const zipEntries: ZipFileEntry[] = [];

	for (let i = 0; i < slides.length; i++) {
		const slideIndex = i + 1;
		const slide = slides[i]!;

		contentTypesOverrides += `  <Override PartName="/ppt/slides/slide${slideIndex}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>\n`;
		presRelsEntries += `  <Relationship Id="rId${slideIndex}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideIndex}.xml"/>\n`;
		sldIdEntries += `    <p:sldId id="${255 + slideIndex}" r:id="rId${slideIndex}"/>\n`;

		let textContent = `            <a:p><a:r><a:t>${escapeXml(slide.title)}</a:t></a:r></a:p>\n`;
		for (const b of slide.bullets) {
			textContent += `            <a:p><a:r><a:t>• ${escapeXml(b)}</a:t></a:r></a:p>\n`;
		}

		const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:bodyPr/>
${textContent}        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

		zipEntries.push({ path: `ppt/slides/slide${slideIndex}.xml`, data: slideXml });
	}

	const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${contentTypesOverrides}</Types>`;

	const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

	const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${presRelsEntries}</Relationships>`;

	const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
${sldIdEntries}  </p:sldIdLst>
</p:presentation>`;

	return buildZip([
		{ path: "[Content_Types].xml", data: contentTypes },
		{ path: "_rels/.rels", data: rels },
		{ path: "ppt/_rels/presentation.xml.rels", data: presRels },
		{ path: "ppt/presentation.xml", data: presentationXml },
		...zipEntries,
	]);
}

/**
 * Generate native standard PDF-1.4 binary file
 */
export function generateNativePdf(input: {
	readonly title: string;
	readonly bodyLines: readonly string[];
}): Buffer {
	const lines = [input.title, "", ...input.bodyLines];
	let streamContent = "BT\n/F1 14 Tf\n50 750 Td\n";
	for (let i = 0; i < lines.length; i++) {
		const line = (lines[i] ?? "").replace(/[()\\]/g, "\\$&");
		streamContent += `(${line}) Tj\n0 -20 Td\n`;
	}
	streamContent += "ET\n";

	const streamLen = Buffer.byteLength(streamContent, "utf8");

	const bodyParts = [
		"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n",
		"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
		"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
		"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
		`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}endstream\nendobj\n`,
		"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
	];

	let offset = 0;
	const offsets: number[] = [0];
	for (let i = 0; i < bodyParts.length; i++) {
		if (i > 0) offsets.push(offset);
		offset += Buffer.byteLength(bodyParts[i]!, "utf8");
	}

	const xrefStart = offset;
	let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
	for (let i = 1; i < offsets.length; i++) {
		xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
	}

	const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

	return Buffer.from(bodyParts.join("") + xref + trailer, "utf8");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
