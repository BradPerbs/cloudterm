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
 */

const FENCE = /^```([\w+-]*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;

/** Inline spans: code first, so nothing inside backticks is styled further. */
function inline(text, keyPrefix) {
    const nodes = [];
    // Code, bold, then italic. Ordered so `**` is never mistaken for two `*`.
    const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)/g;
    let last = 0;
    let match;
    let index = 0;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) {
            nodes.push(text.slice(last, match.index));
        }
        const token = match[0];
        const key = `${keyPrefix}-i${index++}`;

        if (token.startsWith('`')) {
            nodes.push(
                <code
                    key={key}
                    className="px-1 py-0.5 rounded bg-gray-900/[0.06] dark:bg-white/10 font-jetbrains text-[0.85em] break-words"
                >
                    {token.slice(1, -1)}
                </code>
            );
        } else if (token.startsWith('**') || token.startsWith('__')) {
            nodes.push(<strong key={key} className="font-semibold">{token.slice(2, -2)}</strong>);
        } else {
            nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
        }
        last = match.index + token.length;
    }

    if (last < text.length) nodes.push(text.slice(last));
    return nodes.length > 0 ? nodes : [text];
}

function CodeBlock({ code, language }) {
    return (
        <div className="[&:not(:first-child)]:mt-2 rounded-lg overflow-hidden
            border border-gray-200 dark:border-surface-control">
            {language && (
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-surface-base border-b border-gray-200 dark:border-surface-control">
                    {language}
                </div>
            )}
            {/* The block scrolls on its own rather than widening the panel: a
                long command line must not push the whole conversation sideways. */}
            <pre className="px-3 py-2 overflow-x-auto bg-gray-50 dark:bg-surface-base">
                <code className="font-jetbrains text-xs leading-relaxed whitespace-pre">{code}</code>
            </pre>
        </div>
    );
}

/** Group consecutive list lines so a list renders as one element. */
function flushList(items, ordered, key) {
    if (items.length === 0) return null;
    const className = '[&:not(:first-child)]:mt-2 pl-5 space-y-1 ' + (ordered ? 'list-decimal' : 'list-disc');
    const children = items.map((item, index) => (
        <li key={`${key}-li${index}`} className="pl-0.5">{inline(item, `${key}-li${index}`)}</li>
    ));
    return ordered
        ? <ol key={key} className={className}>{children}</ol>
        : <ul key={key} className={className}>{children}</ul>;
}

export default function Markdown({ text = '' }) {
    const lines = String(text).split('\n');
    const blocks = [];

    let listItems = [];
    let listOrdered = false;
    let paragraph = [];
    let key = 0;

    const closeList = () => {
        const node = flushList(listItems, listOrdered, `l${key++}`);
        if (node) blocks.push(node);
        listItems = [];
    };

    const closeParagraph = () => {
        if (paragraph.length === 0) return;
        const body = paragraph.join(' ');
        blocks.push(
            <p key={`p${key++}`} className="[&:not(:first-child)]:mt-2 break-words">{inline(body, `p${key}`)}</p>
        );
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
            blocks.push(<CodeBlock key={`c${key++}`} code={collected.join('\n')} language={language} />);
            continue;
        }

        if (!line.trim()) {
            closeParagraph();
            closeList();
            continue;
        }

        const heading = line.match(HEADING);
        if (heading) {
            closeParagraph();
            closeList();
            blocks.push(
                <div
                    key={`h${key++}`}
                    className="[&:not(:first-child)]:mt-3 mb-1 font-semibold text-gray-900 dark:text-white"
                >
                    {inline(heading[2], `h${key}`)}
                </div>
            );
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

    // Sized for a side panel rather than a page: 13px at a generous line height
    // reads better in a 400px column than the app's 14px body text.
    return (
        <div className="text-[13px] leading-[1.65] text-gray-700 dark:text-gray-200">
            {blocks}
        </div>
    );
}
