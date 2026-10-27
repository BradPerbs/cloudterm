/**
 * How long a headless CLI turn may stay quiet before it is taken for a hang.
 *
 * Grok Build and Kimi Code run one process per turn, and a process can hang, so
 * something has to give up on it. That used to be a single fifteen minute limit
 * from the start of the turn, which ended turns that were working: one that
 * reads, runs and writes for twenty minutes is a long turn, not a stuck one.
 *
 * So the limit is measured from the last thing the CLI wrote, and it does not
 * run out while a card is waiting on the user. A process that has said nothing
 * because a person has not answered yet is not hung either.
 */
const IDLE_TIMEOUT = 30 * 60 * 1000;

/**
 * A timer that fires after `timeout` of quiet, wound back by `rewind`.
 *
 * When it runs out while `waiting()` says a card is open, it winds itself back
 * instead of firing. The CLI talks again as soon as the card is answered, and
 * that winds it back in the ordinary way.
 */
function idleTimer({ timeout = IDLE_TIMEOUT, waiting = () => false, expire }) {
    let timer = null;
    let done = false;

    const rewind = () => {
        if (done) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (waiting()) {
                rewind();
                return;
            }
            done = true;
            expire();
        }, timeout);
    };

    rewind();

    return {
        rewind,
        stop() {
            done = true;
            clearTimeout(timer);
        },
    };
}

/**
 * The approval and question callbacks a provider hands to `mcp-host`, counted
 * while they are open.
 *
 * Counted here rather than in the tool server so that each conversation knows
 * about its own cards and nobody else's. A question raised through the tool
 * context (an `askUser` on it, where one is offered) is counted the same way.
 */
function countCards({ requestApproval, toolContext }) {
    let open = 0;

    const counted = fn => async (...args) => {
        open += 1;
        try {
            return await fn(...args);
        } finally {
            open -= 1;
        }
    };

    return {
        requestApproval: counted(requestApproval),
        toolContext: () => {
            const context = toolContext();
            return typeof context?.askUser === 'function'
                ? { ...context, askUser: counted(context.askUser) }
                : context;
        },
        waiting: () => open > 0,
    };
}

module.exports = { IDLE_TIMEOUT, idleTimer, countCards };
