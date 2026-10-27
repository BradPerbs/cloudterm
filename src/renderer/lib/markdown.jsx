/**
 * Just enough markdown for a reply in a side panel.
 *
 * A library was not worth it here. The assistant writes prose, short lists and
 * code blocks, and that is the whole grammar this needs; the alternative was a
 * dependency whose main feature, HTML passthrough, is the one thing we would
 * have had to turn off anyway.
 *
 * Everything is built as React elements. Nothing goes near
 * dangerouslySetInnerHTML: the text here is model output that has quoted
 * arbitrary log lines and file contents from a server, and that is precisely
 * the input you do not hand to an HTML parser.
 *
 * The one thing here that is not self-contained is the copy button on a code
 * block, which is the same control the tool rows and approval cards use. A
 * second copy of it living in this file would be the worse trade.
 */

import { memo } from 'react';
import CopyButton from '../components/ui/CopyButton';

const FENCE = /^```([\w+-]*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;

/**
 * The rule under a table's header: `|---|---|`, `| :-- | --: |`, and so on.
 *
 * This is the whole of what makes a table a table. A line with pipes in it is
 * just a sentence with pipes in it, which is why the header row is never
 * matched on its own: the rule underneath is the thing that says the line above
 * it was a header, and the two are only believed together, with the same number
 * of cells in each.
 */
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * What a bare URL ends on. Prose puts a full stop or a closing bracket straight
 * after a link far more often than a URL ends in one, so those are left out.
 */
const URL_TAIL = /[.,;:!?'")\]]+$/;

/**
 * A link, opened in the browser rather than in the app.
 *
 * The click goes through main, which lets only http and https out: the text is
 * model output, and a `file:` or `ms-msdt:` link in it is not to be followed.
 * Only those two are ever made into links here in the first place. The href
 * stays so the address shows on hover, as a link's does anywhere.
 */
function Link({ href, children }) {
    const open = (event) => {
        event.preventDefault();
        window.api?.links?.open(href);
    };

    return (
        <a
            href={href}
            title={href}
            onClick={open}
            // A middle click would otherwise ask for a new window, which the
            // app refuses for anything but https.
            onAuxClick={(event) => {
                if (event.button === 1) open(event);
            }}
            className="underline underline-offset-2 decoration-gray-400 dark:decoration-gray-500
                hover:decoration-current text-gray-900 dark:text-white [overflow-wrap:anywhere] cursor-pointer"
        >
            {children}
        </a>
    );
}

/**
 * Inline spans: code first, so nothing inside backticks is styled further.
 *
 * `links` is off inside a link's own label, where an address is just its
 * words: a link inside a link is not something a page can hold.
 */
function inline(text, keyPrefix, links = true) {
    const nodes = [];
    // Code, links, bold, then italic. Ordered so `**` is never mistaken for
    // two `*`, and so a URL with an underscore in it stays one URL.
    const pattern = /(`[^`]+`)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s<>`]+)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)/g;
    let last = 0;
    let match;
    let index = 0;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) {
            nodes.push(text.slice(last, match.index));
        }
        let token = match[0];
        const key = `${keyPrefix}-i${index++}`;

        if ((match[2] || match[3]) && !links) {
            nodes.push(token);
        } else if (match[2]) {
            const split = token.indexOf('](');
            // The label is read again, so `[**docs**](...)` keeps its bold.
            nodes.push(<Link key={key} href={token.slice(split + 2, -1)}>{inline(token.slice(1, split), key, false)}</Link>);
        } else if (match[3]) {
            // The tail goes back to the text, and the scan resumes after it.
            const tail = token.match(URL_TAIL)?.[0] || '';
            token = token.slice(0, token.length - tail.length);
            nodes.push(<Link key={key} href={token}>{token}</Link>);
        } else if (token.startsWith('`')) {
            nodes.push(
                <code
                    key={key}
                    className="px-1 py-0.5 rounded bg-gray-900/[0.06] dark:bg-white/10 font-jetbrains text-[0.85em] break-words"
                >
                    {token.slice(1, -1)}
                </code>
            );
        } else if (token.startsWith('**') || token.startsWith('__')) {
            // Read again inside, so a link in bold is still a link.
            nodes.push(<strong key={key} className="font-semibold">{inline(token.slice(2, -2), key, links)}</strong>);
        } else {
            nodes.push(<em key={key}>{inline(token.slice(1, -1), key, links)}</em>);
        }
        last = match.index + token.length;
        pattern.lastIndex = last;
    }

    if (last < text.length) nodes.push(text.slice(last));
    return nodes.length > 0 ? nodes : [text];
}

function CodeBlock({ code, language }) {
    return (
        <div className="group relative [&:not(:first-child)]:mt-2 rounded-lg overflow-hidden
            border border-gray-200 dark:border-surface-control">
            {language && (
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-surface-base border-b border-gray-200 dark:border-surface-control">
                    {language}
                </div>
            )}

            {/* Most of what lands in one of these is a command somebody is
                about to run, so it is worth a click rather than a careful
                drag across three wrapped lines. Pinned to the block rather
                than dropped in the language bar, because half of them arrive
                with no language on the fence and would have nowhere to sit. */}
            <CopyButton
                text={code}
                label="Copy code"
                className={`absolute right-1 ${language ? 'top-1' : 'top-1.5'}`}
            />

            {/* The block scrolls on its own rather than widening the panel: a
                long command line must not push the whole conversation sideways. */}
            <pre className="px-3 py-2 overflow-x-auto bg-gray-50 dark:bg-surface-base">
                <code className="font-jetbrains text-xs leading-relaxed whitespace-pre">{code}</code>
            </pre>
        </div>
    );
}

/**
 * One row's cells.
 *
 * Split on pipes, with the border pair at each end dropped as delimiters rather
 * than as empty cells: `| | b |` is a blank first column, not a single column
 * called `b`. A pipe that is part of the text is written `\|` and is put back
 * here, which is the only escape this needs to understand.
 */
function splitCells(line) {
    let text = line.trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

    const cells = [];
    let current = '';

    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === '\\' && text[index + 1] === '|') {
            current += '|';
            index += 1;
        } else if (text[index] === '|') {
            cells.push(current);
            current = '';
        } else {
            current += text[index];
        }
    }
    cells.push(current);

    return cells.map(cell => cell.trim());
}

/** Which way a column is set, from the colons on its rule cell. */
function alignmentOf(cell) {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'text-center';
    if (right) return 'text-right';
    return 'text-left';
}

/** A short row is padded and a long one is cut, so every row is one width. */
function fitRow(cells, width) {
    const row = cells.slice(0, width);
    while (row.length < width) row.push('');
    return row;
}

/**
 * A table, sized for a side panel.
 *
 * The table takes the panel's width and its cells wrap, rather than running to
 * their natural width and scrolling: what the assistant puts in a table here is
 * usually sentences (a host and what is wrong with it), and a column of prose
 * that has to be scrolled sideways one line at a time is worse than a narrow
 * one that wraps. The wrapper still scrolls, for the table with six columns
 * that cannot be squeezed into 340px however hard it wraps.
 */
function Table({ header, rows, align }) {
    return (
        <div className="[&:not(:first-child)]:mt-2 overflow-x-auto rounded-lg
            border border-gray-200 dark:border-surface-control">
            <table className="w-full border-collapse text-[12px] leading-snug">
                <thead>
                    <tr className="bg-gray-50 dark:bg-surface-base">
                        {header.map((cell, column) => (
                            <th
                                key={`th${column}`}
                                scope="col"
                                className={`px-2.5 py-1.5 align-top break-words font-semibold
                                    text-gray-900 dark:text-white ${align[column]}`}
                            >
                                {inline(cell, `th${column}`)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr
                            key={`tr${index}`}
                            className="border-t border-gray-200 dark:border-surface-control"
                        >
                            {row.map((cell, column) => (
                                <td
                                    key={`td${index}-${column}`}
                                    className={`px-2.5 py-1.5 align-top break-words ${align[column]}`}
                                >
                                    {inline(cell, `td${index}-${column}`)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** A list as one element, however many lines it was written on. */
function List({ items, ordered, prefix }) {
    const className = '[&:not(:first-child)]:mt-2 pl-5 space-y-1 ' + (ordered ? 'list-decimal' : 'list-disc');
    const children = items.map((item, index) => (
        <li key={`${prefix}-li${index}`} className="pl-0.5">{inline(item, `${prefix}-li${index}`)}</li>
    ));
    return ordered
        ? <ol className={className}>{children}</ol>
        : <ul className={className}>{children}</ul>;
}

/**
 * The text as a list of blocks, each with a signature of what it holds.
 *
 * Kept apart from the drawing so a reply that is still streaming in can be
 * drawn block by block: every frame adds a few letters to the last block and
 * none to the others, and a block whose signature has not moved is not drawn
 * again. Parsing is a pass over the lines, which is cheap; building the
 * elements for every paragraph of a long reply sixty times a second was not.
 *
 * A code block says whether its fence was closed. One that was not is a reply
 * still arriving, or one cut off: a code block draws the same either way, but
 * anything drawn from a fence's contents (a chart, say) should wait for the
 * end of it.
 */
export function parse(text) {
    const lines = String(text).split('\n');
    const blocks = [];

    let listItems = [];
    let listOrdered = false;
    let paragraph = [];

    const closeList = () => {
        if (listItems.length === 0) return;
        blocks.push({ kind: 'list', ordered: listOrdered, items: listItems, sig: `${listOrdered}\u0000${listItems.join('\u0000')}` });
        listItems = [];
    };

    const closeParagraph = () => {
        if (paragraph.length === 0) return;
        const body = paragraph.join(' ');
        blocks.push({ kind: 'p', text: body, sig: body });
        paragraph = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const fence = line.match(FENCE);

        if (fence) {
            closeParagraph();
            closeList();
            const language = fence[1] || '';
            const collected = [];
            index += 1;
            while (index < lines.length && !FENCE.test(lines[index])) {
                collected.push(lines[index]);
                index += 1;
            }
            const code = collected.join('\n');
            const closed = index < lines.length;
            blocks.push({ kind: 'code', code, language, closed, sig: `${language}\u0000${closed}\u0000${code}` });
            continue;
        }

        if (!line.trim()) {
            closeParagraph();
            closeList();
            continue;
        }

        // A table, if the line under this one is a rule of the same width.
        // Checked before the block kinds below, because a header row is
        // otherwise indistinguishable from a paragraph with pipes in it.
        if (line.includes('|') && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1])) {
            const header = splitCells(line);
            const rule = splitCells(lines[index + 1]);

            if (header.length > 1 && header.length === rule.length) {
                closeParagraph();
                closeList();

                const rows = [];
                const start = index;
                index += 2;
                // Runs to the blank line that ends the block, or to the first
                // line with no pipe in it: the assistant writes a sentence
                // straight under a table often enough that swallowing it as a
                // one-cell row would be the more surprising reading.
                while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
                    rows.push(fitRow(splitCells(lines[index]), header.length));
                    index += 1;
                }
                blocks.push({
                    kind: 'table',
                    header,
                    rows,
                    align: rule.map(alignmentOf),
                    sig: lines.slice(start, index).join('\n'),
                });
                index -= 1;
                continue;
            }
        }

        const heading = line.match(HEADING);
        if (heading) {
            closeParagraph();
            closeList();
            blocks.push({ kind: 'h', text: heading[2], sig: heading[2] });
            continue;
        }

        const bullet = line.match(BULLET);
        const numbered = line.match(NUMBERED);
        if (bullet || numbered) {
            closeParagraph();
            const ordered = Boolean(numbered);
            if (listItems.length > 0 && ordered !== listOrdered) closeList();
            listOrdered = ordered;
            listItems.push(ordered ? numbered[2] : bullet[1]);
            continue;
        }

        closeList();
        paragraph.push(line.trim());
    }

    closeParagraph();
    closeList();
    return blocks;
}

/**
 * One block, drawn again only when what it holds has changed.
 *
 * Where a fenced block becomes something other than code (a chart from a
 * ```chart fence, for one) is the `code` case here, keyed on the language.
 */
const Block = memo(function Block({ block, prefix }) {
    switch (block.kind) {
        case 'code':
            return <CodeBlock code={block.code} language={block.language} />;
        case 'table':
            return <Table header={block.header} rows={block.rows} align={block.align} />;
        case 'h':
            return (
                <div className="[&:not(:first-child)]:mt-3 mb-1 font-semibold text-gray-900 dark:text-white">
                    {inline(block.text, prefix)}
                </div>
            );
        case 'list':
            return <List items={block.items} ordered={block.ordered} prefix={prefix} />;
        default:
            return <p className="[&:not(:first-child)]:mt-2 break-words">{inline(block.text, prefix)}</p>;
    }
}, (previous, next) => previous.block.sig === next.block.sig
    && previous.block.kind === next.block.kind
    && previous.prefix === next.prefix);

/**
 * Sized for a side panel rather than a page: 13px at a generous line height
 * reads better in a 400px column than the app's 14px body text. A thought,
 * which is read less closely, passes a smaller, quieter one.
 */
const BODY = 'text-[13px] leading-[1.65] text-gray-700 dark:text-gray-200';

function Markdown({ text = '', className = BODY }) {
    const blocks = parse(text);

    return (
        <div className={className}>
            {blocks.map((block, index) => (
                <Block key={`${block.kind}${index}`} block={block} prefix={`b${index}`} />
            ))}
        </div>
    );
}

/**
 * Drawn again only when the text changes: a finished reply in a long
 * transcript is never parsed twice.
 */
export default memo(Markdown);
