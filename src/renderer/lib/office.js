/**
 * Office documents on their way into the composer.
 *
 * Word, Excel and PowerPoint files (and their OpenDocument cousins) are ZIPs
 * of XML, so their words come out without a heavyweight library: `fflate`
 * unzips, small regular expressions pull the text runs, and the composer
 * sends the result as words like any other document. No DOM is touched, so
 * this module also runs under plain node, where its tests live.
 *
 * Numbers in Excel stay numbers: dates ride as serials, since resolving a
 * cell's number format means reading the stylesheet too, and the shape of
 * the data matters more than its Sunday best.
 */

/** How many bytes of Office ZIP one file may bring in for extraction. */
export const MAX_OFFICE_BYTES = 25 * 1024 * 1024;

/** `officeKind`: what each supported file is. */
const KINDS = {
    word: 'word',
    slides: 'slides',
    sheets: 'sheets',
    odt: 'odt',
    ods: 'ods',
    odp: 'odp',
};

const CANONICAL_TYPE = {
    word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    slides: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sheets: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odp: 'application/vnd.oasis.opendocument.presentation',
};

function extensionOf(name) {
    const dot = String(name || '').lastIndexOf('.');
    if (dot < 0) return '';
    return String(name).slice(dot).toLowerCase();
}

/**
 * Which document `file` is, or '' when it is none of them. The extension
 * leads, since pickers on some platforms hand over no type at all; the
 * type catches a renamed file the other way round.
 */
export function officeKind(file) {
    if (!file) return '';
    const type = String(file.type || '').toLowerCase();
    const ext = extensionOf(file.name);
    if (ext === '.docx' || type.includes('wordprocessingml')) return KINDS.word;
    if (ext === '.pptx' || type.includes('presentationml')) return KINDS.slides;
    if (ext === '.xlsx' || type.includes('spreadsheetml')) return KINDS.sheets;
    if (ext === '.odt' || (type.includes('oasis.opendocument') && type.includes('text'))) return KINDS.odt;
    if (ext === '.ods' || (type.includes('oasis.opendocument') && type.includes('spreadsheet'))) return KINDS.ods;
    if (ext === '.odp' || (type.includes('oasis.opendocument') && type.includes('presentation'))) return KINDS.odp;
    return '';
}

/** Whether `file` is a supported Office or OpenDocument file. */
export function isOfficeFile(file) {
    return officeKind(file) !== '';
}

/** The media type the extracted words travel under. */
export function officeMediaType(file) {
    const kind = officeKind(file);
    return String(file?.type || '').toLowerCase() || CANONICAL_TYPE[kind] || 'application/octet-stream';
}

let fflatePromise = null;
/** `fflate`, loaded only when an Office file is attached. */
function loadFflate() {
    if (!fflatePromise) fflatePromise = import('fflate');
    return fflatePromise;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** `&lt;` and friends back into characters. */
export function unescapeXml(s) {
    return String(s || '').replace(
        /&#(\d+);|&#x([0-9a-fA-F]+);|&(amp|lt|gt|quot|apos);/g,
        (match, dec, hex, name) => {
            if (dec) return String.fromCodePoint(Number(dec));
            if (hex) return String.fromCodePoint(parseInt(hex, 16));
            return ENTITIES[name] || match;
        },
    );
}

/**
 * The text runs inside one Word paragraph: joined bare, since Word splits
 * a run mid-word wherever the bold starts. Tabs and line breaks keep their
 * shape.
 */
function wordRuns(inner) {
    const shaped = String(inner || '')
        .replace(/<w:tab[^>]*\/>/g, '<w:t>\uE000</w:t>')
        .replace(/<w:br[^>]*\/>/g, '<w:t>\uE001</w:t>');
    const runs = [...shaped.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => unescapeXml(m[1]));
    return runs.join('').replace(/\uE000/g, '\t').replace(/\uE001/g, '\n');
}

/** A Word document's paragraphs, list items bulleted. */
function wordParagraphs(xml) {
    const blocks = [...String(xml || '').matchAll(/<w:p(\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m => m[0]);
    return blocks
        .map(block => `${/<w:numPr[\s>/]/.test(block) ? '- ' : ''}${wordRuns(block)}`)
        .map(line => line.split('\n').map(part => part.trimEnd()).join('\n'))
        .filter(line => line.trim() !== '')
        .join('\n');
}

/** The words of a `.docx`: the body, then headers, footers and footnotes. */
export function extractDocxText(entries) {
    const chunks = [];
    const body = wordParagraphs(entries['word/document.xml']);
    if (body) chunks.push(body);
    for (const path of Object.keys(entries).sort()) {
        if (path === 'word/document.xml') continue;
        if (!/^word\/(header\d*|footer\d*|footnotes)\.xml$/.test(path)) continue;
        const text = wordParagraphs(entries[path]);
        if (text) chunks.push(text);
    }
    return chunks.join('\n\n').trim();
}

/**
 * The text runs inside one PowerPoint paragraph. Same shape as Word's,
 * under DrawingML's `a:` prefix.
 */
function slideRuns(inner) {
    const shaped = String(inner || '')
        .replace(/<a:tab[^>]*\/>/g, '<a:t>\uE000</a:t>')
        .replace(/<a:br[^>]*\/>/g, '<a:t>\uE001</a:t>');
    const runs = [...shaped.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => unescapeXml(m[1]));
    return runs.join('').replace(/\uE000/g, '\t').replace(/\uE001/g, '\n');
}

/** The words of a `.pptx`, slide by slide, tables included. */
export function extractPptxText(entries) {
    const slides = Object.keys(entries)
        .map(path => ({ path, found: /^ppt\/slides\/slide(\d+)\.xml$/.exec(path) }))
        .filter(entry => entry.found)
        .map(({ path, found }) => ({ number: Number(found[1]), path }))
        .sort((a, b) => a.number - b.number);
    const chunks = slides
        .map(({ number, path }) => {
            const blocks = [...String(entries[path] || '').matchAll(/<a:p(\s[^>]*)?>[\s\S]*?<\/a:p>/g)].map(m => m[0]);
            const lines = blocks
                .map(block => slideRuns(block).trimEnd())
                .filter(line => line.trim() !== '');
            return lines.length > 0 ? `--- Slide ${number} ---\n${lines.join('\n')}` : '';
        })
        .filter(Boolean);
    return chunks.join('\n\n').trim();
}

/** `B2` to a zero-based column index, for lining sparse rows back up. */
export function columnIndex(ref) {
    const letters = (/^([A-Z]+)/.exec(String(ref || '')) || [])[1] || '';
    let index = 0;
    for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
    return index - 1;
}

/**
 * One Excel sheet's rows. Shared strings are resolved, inline strings kept,
 * booleans spelled out, everything else read as the number it is. Cells
 * land in their own columns, so a gap in the sheet stays a gap in the text.
 */
function sheetRows(xml, shared) {
    const rows = [];
    for (const row of String(xml || '').matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        let column = 0;
        for (const cell of row[2].matchAll(/<c\b[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const open = cell[0].slice(0, cell[0].indexOf('>') + 1);
            const inner = cell[1] || '';
            const ref = (/r="([A-Z]+\d+)"/.exec(open) || [])[1] || '';
            const type = (/t="([a-zA-Z]+)"/.exec(open) || [])[1] || 'n';
            const index = ref ? columnIndex(ref) : column;
            while (cells.length < index) cells.push('');
            let value = '';
            if (type === 's') {
                const at = (/<v>(-?\d+)<\/v>/.exec(inner) || [])[1];
                value = at !== undefined ? (shared[Number(at)] ?? '') : '';
            } else if (type === 'inlineStr') {
                value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1])).join('');
            } else if (type === 'b') {
                value = /<v>1<\/v>/.test(inner) ? 'TRUE' : 'FALSE';
            } else if (type !== 'e') {
                value = unescapeXml((/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1] ?? '');
            }
            cells[index] = value;
            column = index + 1;
        }
        while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
        if (cells.some(cell => cell !== '')) rows.push(cells.join(' | '));
    }
    return rows.join('\n');
}

/**
 * The words of an `.xlsx`, sheet by sheet. Sheet names come from the
 * workbook via its relationships, so a reordered workbook still names
 * its sheets right; without a workbook the files stand in order.
 */
export function extractXlsxText(entries) {
    const idToTarget = {};
    for (const tag of String(entries['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship(\s[^>]*)?>/g)) {
        const id = (/Id="([^"]+)"/.exec(tag[0]) || [])[1];
        const target = (/Target="([^"]+)"/.exec(tag[0]) || [])[1];
        if (id && target) idToTarget[id] = target;
    }
    let sheets = [];
    for (const tag of String(entries['xl/workbook.xml'] || '').matchAll(/<sheet(\s[^>]*)?>/g)) {
        const name = (/name="([^"]+)"/.exec(tag[0]) || [])[1];
        const rid = (/r:id="([^"]+)"/.exec(tag[0]) || [])[1];
        const target = (rid && idToTarget[rid]) || '';
        if (name && target) sheets.push({ name: unescapeXml(name), path: `xl/${target.replace(/^\//, '')}` });
    }
    if (sheets.length === 0) {
        sheets = Object.keys(entries)
            .filter(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
            .sort()
            .map((path, at) => ({ name: `Sheet${at + 1}`, path }));
    }
    const shared = [];
    for (const item of String(entries['xl/sharedStrings.xml'] || '').matchAll(/<si(\s[^>]*)?>[\s\S]*?<\/si>/g)) {
        shared.push([...item[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1])).join(''));
    }
    const chunks = sheets
        .map(({ name, path }) => {
            const rows = sheetRows(entries[path], shared);
            return rows ? `--- ${name} ---\n${rows}` : '';
        })
        .filter(Boolean);
    return chunks.join('\n\n').trim();
}

/** An OpenDocument paragraph: spans and stray text, tags aside. */
function odfParagraph(inner) {
    const shaped = String(inner || '')
        .replace(/<text:tab[^>]*\/>/g, '\t')
        .replace(/<text:line-break[^>]*\/>/g, '\n');
    return unescapeXml(shaped.replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').trimEnd();
}

/** Every `text:p` in some XML, in order. */
function odfParagraphs(xml) {
    return [...String(xml || '').matchAll(/<text:p(\s[^>]*)?>([\s\S]*?)<\/text:p>/g)]
        .map(m => odfParagraph(m[2]))
        .filter(line => line.trim() !== '')
        .join('\n');
}

/** The words of an `.odt`. */
export function extractOdtText(entries) {
    return odfParagraphs(entries['content.xml']).trim();
}

/** The words of an `.odp`, slide by slide. */
export function extractOdpText(entries) {
    const pages = [...String(entries['content.xml'] || '').matchAll(/<draw:page(\s[^>]*)?>([\s\S]*?)<\/draw:page>/g)]
        .map(m => m[2]);
    const chunks = pages
        .map((page, at) => {
            const text = odfParagraphs(page);
            return text ? `--- Slide ${at + 1} ---\n${text}` : '';
        })
        .filter(Boolean);
    return chunks.join('\n\n').trim();
}

/** The words of an `.ods`, sheet by sheet. */
export function extractOdsText(entries) {
    const tables = [...String(entries['content.xml'] || '').matchAll(/<table:table(\s[^>]*)?>([\s\S]*?)<\/table:table>/g)]
        .map(m => ({ tag: m[0].slice(0, m[0].indexOf('>') + 1), body: m[2] }));
    const chunks = tables
        .map(({ tag, body }) => {
            const name = unescapeXml((/table:name="([^"]+)"/.exec(tag) || [])[1] || 'Sheet');
            const rows = [];
            for (const row of body.matchAll(/<table:table-row(\s[^>]*)?>([\s\S]*?)<\/table:table-row>/g)) {
                const cells = [];
                for (const cell of row[2].matchAll(/<(table:table-cell|table:covered-table-cell)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
                    const covered = cell[1] === 'table:covered-table-cell';
                    const attrs = cell[2] || '';
                    const inner = cell[3] || '';
                    const repeated = Number((/table:number-columns-repeated="(\d+)"/.exec(attrs) || [])[1] || '1');
                    const value = covered ? '' : odfParagraphs(inner).split('\n').join(' ');
                    for (let at = 0; at < Math.min(repeated, 256); at += 1) cells.push(value);
                }
                while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
                if (cells.some(cell => cell !== '')) rows.push(cells.join(' | '));
            }
            return rows.length > 0 ? `--- ${name} ---\n${rows.join('\n')}` : '';
        })
        .filter(Boolean);
    return chunks.join('\n\n').trim();
}

/**
 * One Office file's words from its already-unzipped XML (`path` to text).
 * Rejects with 'empty' when the document has no words to give.
 */
export function officeTextFromEntries(kind, entries) {
    let text = '';
    if (kind === 'word') text = extractDocxText(entries);
    else if (kind === 'slides') text = extractPptxText(entries);
    else if (kind === 'sheets') text = extractXlsxText(entries);
    else if (kind === 'odt') text = extractOdtText(entries);
    else if (kind === 'ods') text = extractOdsText(entries);
    else if (kind === 'odp') text = extractOdpText(entries);
    if (!String(text || '').trim()) throw new Error('empty');
    return text.trim();
}

/**
 * Whether one part of the ZIP is worth unpacking: the XML that holds the
 * words and the relationships that name the sheets. Pictures and embedded
 * media are skipped unread, and so is a part that claims to inflate past
 * what any document's text needs, which is what a ZIP bomb looks like.
 */
const MAX_PART_BYTES = 64 * 1024 * 1024;
const wanted = part => /\.(xml|rels)$/.test(part.name)
    && part.originalSize <= MAX_PART_BYTES
    && (part.compression === 0 || part.compression === 8);

/**
 * One Office file's words, in document order. Rejects with 'too large' past
 * what extraction takes on, 'not office' when the ZIP is no document, and
 * 'empty' when it holds no words.
 */
export async function extractOfficeText(file, kind) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_OFFICE_BYTES) throw new Error('too large');
    const { unzipSync, strFromU8 } = await loadFflate();
    let raw;
    try {
        raw = unzipSync(bytes, { filter: wanted });
    } catch {
        throw new Error('not office');
    }
    const entries = {};
    for (const [path, data] of Object.entries(raw)) {
        try {
            entries[path] = strFromU8(data);
        } catch {
            // A single undecodable part never sinks the document.
        }
    }
    return officeTextFromEntries(kind || officeKind(file), entries);
}

/**
 * Whether decoded `text` reads like words rather than binary. NUL never
 * lies, and beyond a stray or two the C0 controls and decoding failures
 * mean the file was never text.
 */
export function looksLikeText(text) {
    const sample = String(text || '').slice(0, 8000);
    if (!sample) return false;
    const bad = sample.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g);
    return !bad || bad.length / sample.length < 0.02;
}

/**
 * RTF stripped to words, or null when `text` is no RTF document. Enough
 * for a memo: hex escapes, unicode escapes, paragraph breaks, and the
 * control words and braces gone.
 */
export function stripRtf(text) {
    const source = String(text || '');
    if (!/^\s*{\\rtf/i.test(source)) return null;
    const words = source
        .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u(-?\d+)\??/g, (_, code) => String.fromCharCode((Number(code) + 65536) % 65536))
        .replace(/\\(par|line|row|lbr\d*)\b\d* ?/g, '\n')
        .replace(/\\tab\b\d* ?/g, '\t')
        .replace(/\\(~|-|_)/g, ' ')
        .replace(/\\[a-zA-Z]+\d* ?/g, '')
        .replace(/[{}]/g, '');
    return words
        .split('\n')
        .map(line => line.replace(/ {2,}/g, ' ').trim())
        .filter(line => line !== '')
        .join('\n');
}
