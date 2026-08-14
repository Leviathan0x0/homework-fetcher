export interface DocxRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface DocxParagraph {
  type: 'paragraph';
  runs: DocxRun[];
  headingLevel?: number;
  listItem: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justify';
}

export interface DocxTable {
  type: 'table';
  rows: DocxParagraph[][][];
}

export type DocxBlock = DocxParagraph | DocxTable;

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function findZipEnd(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_SIGNATURE) return offset;
  }
  throw new Error('This Word file is not a valid DOCX archive.');
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DOCX preview is not supported by this browser.');
  }
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(buffer: ArrayBuffer, targetName: string): Promise<Uint8Array> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const endOffset = findZipEnd(view);
  const entryCount = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) break;

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (name === targetName) {
      if (view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
        throw new Error('The DOCX archive contains an invalid document entry.');
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);

      if (compressionMethod === 0) return compressed.slice();
      if (compressionMethod === 8) return inflateRaw(compressed);
      throw new Error('This DOCX file uses an unsupported compression format.');
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error('The DOCX file does not contain a readable document.');
}

function directChild(element: Element, localName: string): Element | undefined {
  return Array.from(element.children).find((child) => child.localName === localName);
}

function wordAttribute(element: Element | undefined, name: string): string | null {
  if (!element) return null;
  return element.getAttributeNS(WORD_NAMESPACE, name) || element.getAttribute(`w:${name}`);
}

function parseParagraph(element: Element): DocxParagraph {
  const properties = directChild(element, 'pPr');
  const styleValue = wordAttribute(directChild(properties || element, 'pStyle'), 'val') || '';
  const headingMatch = styleValue.match(/^Heading\s*([1-6])$/i);
  const alignmentValue = wordAttribute(directChild(properties || element, 'jc'), 'val') || '';
  const alignment = /^(?:left|center|right|justify)$/.test(alignmentValue)
    ? (alignmentValue as DocxParagraph['alignment'])
    : undefined;

  const runs = Array.from(element.getElementsByTagNameNS('*', 'r')).map((run) => {
    const runProperties = directChild(run, 'rPr');
    let text = '';
    for (const child of Array.from(run.children)) {
      if (child.localName === 't' || child.localName === 'instrText') text += child.textContent || '';
      else if (child.localName === 'tab') text += '\t';
      else if (child.localName === 'br' || child.localName === 'cr') text += '\n';
    }
    return {
      text,
      bold: Boolean(runProperties?.getElementsByTagNameNS('*', 'b').length),
      italic: Boolean(runProperties?.getElementsByTagNameNS('*', 'i').length),
      underline: Boolean(runProperties?.getElementsByTagNameNS('*', 'u').length),
    };
  }).filter((run) => run.text.length > 0);

  return {
    type: 'paragraph',
    runs,
    headingLevel: headingMatch ? Number(headingMatch[1]) : undefined,
    listItem: Boolean(properties?.getElementsByTagNameNS('*', 'numPr').length),
    alignment,
  };
}

function parseTable(element: Element): DocxTable {
  const rows = Array.from(element.children)
    .filter((child) => child.localName === 'tr')
    .map((row) =>
      Array.from(row.children)
        .filter((child) => child.localName === 'tc')
        .map((cell) =>
          Array.from(cell.children)
            .filter((child) => child.localName === 'p')
            .map(parseParagraph)
        )
    );
  return { type: 'table', rows };
}

/** Extracts a safe, text-first preview model from a DOCX archive. */
export async function parseDocx(buffer: ArrayBuffer): Promise<DocxBlock[]> {
  const documentBytes = await readZipEntry(buffer, 'word/document.xml');
  const xml = new TextDecoder().decode(documentBytes);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new Error('The DOCX document XML could not be read.');
  }

  const body = document.getElementsByTagNameNS('*', 'body')[0];
  if (!body) throw new Error('The DOCX file does not contain a document body.');

  return Array.from(body.children).flatMap((element): DocxBlock[] => {
    if (element.localName === 'p') return [parseParagraph(element)];
    if (element.localName === 'tbl') return [parseTable(element)];
    return [];
  });
}
