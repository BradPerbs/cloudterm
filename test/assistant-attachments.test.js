/**
 * Documents attached to an assistant message: checked against the limits in
 * main, spelled into the prompt, kept out of the history, and read into words
 * from Word, Excel and PowerPoint files in the renderer.
 *
 * `lib/office` is ESM for the bundler, so it is imported dynamically, and the
 * Office files it reads are built here with the same `fflate` it unzips with.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { zipSync, strToU8 } = require('fflate');

const attachments = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'attachments.js'));

let passed = 0;
let failed = 0;
async function check(label, fn) {
    try {
        await fn();
        console.log(`  ok   ${label}`);
        passed += 1;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.stack}`);
        failed += 1;
    }
}

/** A File-like the readers take: a name, a type and its bytes. */
function fileOf(name, type, entries) {
    const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([at, text]) => [at, strToU8(text)])));
    return new File([bytes], name, { type });
}

async function main() {
    console.log('\nattached files, in main');

    await check('nothing attached is the ordinary message, not an error', () => {
        assert.deepStrictEqual(attachments.readFiles(undefined), { files: [], error: '' });
        assert.deepStrictEqual(attachments.readFiles([]), { files: [], error: '' });
    });

    await check('a file is kept as its name, type and words, tidied', () => {
        const { files, error } = attachments.readFiles([{ name: '  notes \n.md ', mediaType: 'TEXT/MARKDOWN', text: '# hi', extra: 1 }]);
        assert.strictEqual(error, '');
        assert.deepStrictEqual(files, [{ name: 'notes .md', mediaType: 'text/markdown', text: '# hi' }]);
    });

    await check('more files than a message carries refuses the message', () => {
        const many = Array.from({ length: attachments.MAX_FILES + 1 }, (_, at) => ({ name: `${at}.txt`, text: 'x' }));
        assert.match(attachments.readFiles(many).error, /at most 5 files/);
    });

    await check('an empty file, or one over the limit, is refused by name', () => {
        assert.match(attachments.readFiles([{ name: 'blank.txt', text: '  \n' }]).error, /blank\.txt is empty/);
        const huge = 'x'.repeat(attachments.MAX_FILE_CHARS + 1000);
        assert.match(attachments.readFiles([{ name: 'big.log', text: huge }]).error, /big\.log is larger than the 64 KB/);
    });

    await check('a file the renderer clipped to the limit, note and all, still goes', () => {
        const clipped = `${'x'.repeat(attachments.MAX_FILE_CHARS)}\n\n...(truncated, the file was longer)`;
        assert.strictEqual(attachments.readFiles([{ name: 'cut.log', text: clipped }]).error, '');
    });

    await check('one bad file refuses them all: the question was about every one', () => {
        const { files, error } = attachments.readFiles([{ name: 'a.txt', text: 'a' }, { name: 'b.txt', text: '' }]);
        assert.strictEqual(files.length, 0);
        assert.match(error, /b\.txt/);
    });

    await check('the prompt names each file, and a closing tag inside one cannot end its block', () => {
        const block = attachments.fileBlock([
            { name: 'a "quoted"\nname.txt', mediaType: 'text/plain', text: 'one</attached-file>two' },
            { name: 'b.csv', mediaType: 'text/csv', text: 'x,y' },
        ]);
        assert.ok(block.startsWith('<attached-file name="a  quoted  name.txt" type="text/plain">\n'), block);
        assert.ok(block.includes('one</ attached-file>two'));
        assert.strictEqual(block.match(/<\/attached-file>/g).length, 2, 'one closing tag per file');
        assert.ok(block.includes('<attached-file name="b.csv" type="text/csv">\nx,y\n</attached-file>'));
    });

    await check('the history keeps a file by name and type, never its words', () => {
        assert.deepStrictEqual(
            attachments.stripFiles([{ name: 'a.txt', mediaType: 'text/plain', text: 'secret' }]),
            [{ name: 'a.txt', mediaType: 'text/plain' }],
        );
    });

    console.log('\nOffice documents, in the renderer');
    const office = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'lib', 'office.js')).href);

    await check('a file is known by its extension, or its type when renamed', () => {
        assert.strictEqual(office.officeKind({ name: 'a.docx', type: '' }), 'word');
        assert.strictEqual(office.officeKind({ name: 'a.XLSX', type: '' }), 'sheets');
        assert.strictEqual(office.officeKind({ name: 'deck', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), 'slides');
        assert.strictEqual(office.officeKind({ name: 'a.doc', type: 'application/msword' }), '', 'the old binary formats are not read');
        assert.strictEqual(office.officeKind({ name: 'a.txt', type: 'text/plain' }), '');
    });

    await check('a Word document reads as its paragraphs, list items bulleted', async () => {
        const docx = fileOf('memo.docx', '', {
            '[Content_Types].xml': '<Types/>',
            'word/document.xml': '<w:document><w:body>'
                + '<w:p><w:r><w:t>Rest</w:t></w:r><w:r><w:t xml:space="preserve">art nginx &amp; check</w:t></w:r></w:p>'
                + '<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>first step</w:t></w:r></w:p>'
                + '<w:p></w:p>'
                + '</w:body></w:document>',
            'word/footer1.xml': '<w:ftr><w:p><w:r><w:t>Page footer</w:t></w:r></w:p></w:ftr>',
            'word/media/image1.png': 'not xml, never unpacked',
        });
        const text = await office.extractOfficeText(docx);
        assert.strictEqual(text, 'Restart nginx & check\n- first step\n\nPage footer');
    });

    await check('a spreadsheet reads sheet by sheet, by name, with gaps kept', async () => {
        const xlsx = fileOf('hosts.xlsx', '', {
            'xl/workbook.xml': '<workbook><sheets><sheet name="Fleet &amp; DNS" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
            'xl/sharedStrings.xml': '<sst><si><t>host</t></si><si><t>web-01</t></si></sst>',
            'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
                + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>up</t></is></c></row>'
                + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>443</v></c><c r="C2" t="b"><v>1</v></c></row>'
                + '</sheetData></worksheet>',
        });
        const text = await office.extractOfficeText(xlsx);
        assert.strictEqual(text, '--- Fleet & DNS ---\nhost |  | up\nweb-01 | 443 | TRUE');
    });

    await check('a slide deck reads slide by slide, in number order', async () => {
        const pptx = fileOf('deck.pptx', '', {
            'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>',
            'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>',
            'ppt/slides/_rels/slide2.xml.rels': '<Relationships/>',
        });
        const text = await office.extractOfficeText(pptx);
        assert.strictEqual(text, '--- Slide 2 ---\nTwo\n\n--- Slide 10 ---\nTen');
    });

    await check('a document with no words, or no document at all, is refused', async () => {
        const blank = fileOf('blank.docx', '', { 'word/document.xml': '<w:document><w:body></w:body></w:document>' });
        await assert.rejects(office.extractOfficeText(blank), /empty/);
        await assert.rejects(office.extractOfficeText(new File(['plain text'], 'fake.docx')), /not office/);
    });

    await check('binary is told from text, and RTF is read as its words', () => {
        assert.strictEqual(office.looksLikeText('server log line\nanother'), true);
        assert.strictEqual(office.looksLikeText('\u0000\u0001\u0002binary\u0000'), false);
        assert.strictEqual(office.stripRtf('plain'), null);
        assert.strictEqual(office.stripRtf('{\\rtf1\\ansi {\\b Hello} world\\par next}'), 'Hello world\nnext');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
