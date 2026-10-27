const assert = require('assert');
const os = require('os');

const { idleTimer, countCards } = require('../src/main/ai/providers/idle');
const grok = require('../src/main/ai/providers/grok');
const kimi = require('../src/main/ai/providers/kimi');

/**
 * The inactivity limit on the headless CLI runtimes.
 *
 * A turn used to be ended fifteen minutes after it started, however busy it
 * was. Now the clock is wound back by every line the CLI writes and held while
 * a card waits on the user, so the cases below are the three that matter: a
 * long turn that keeps talking, a hung one, and one that is quiet because a
 * person has not answered yet.
 */

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function timerTests() {
    let fired = 0;
    const timer = idleTimer({ timeout: 60, expire: () => { fired += 1; } });
    for (let i = 0; i < 5; i += 1) {
        await sleep(30);
        timer.rewind();
    }
    assert.strictEqual(fired, 0, 'rewinding keeps it from firing');
    await sleep(120);
    assert.strictEqual(fired, 1, 'quiet for the whole timeout fires it once');
    timer.rewind();
    await sleep(120);
    assert.strictEqual(fired, 1, 'a fired timer stays fired');

    let open = true;
    let held = 0;
    const holding = idleTimer({ timeout: 40, waiting: () => open, expire: () => { held += 1; } });
    await sleep(150);
    assert.strictEqual(held, 0, 'an open card holds it');
    open = false;
    await sleep(100);
    assert.strictEqual(held, 1, 'it runs out once the card is gone');

    let stoppedFired = false;
    const stopped = idleTimer({ timeout: 30, expire: () => { stoppedFired = true; } });
    stopped.stop();
    await sleep(80);
    assert.strictEqual(stoppedFired, false, 'a stopped timer never fires');
}

async function cardTests() {
    let release;
    const cards = countCards({
        requestApproval: () => new Promise((resolve) => { release = resolve; }),
        toolContext: () => ({ settings: {} }),
    });
    assert.strictEqual(cards.waiting(), false);
    const answer = cards.requestApproval({ name: 'run_command' });
    assert.strictEqual(cards.waiting(), true, 'an approval card is counted while open');
    release({ approved: true });
    assert.deepStrictEqual(await answer, { approved: true });
    assert.strictEqual(cards.waiting(), false);

    // A card that fails still closes.
    const failing = countCards({
        requestApproval: async () => { throw new Error('gone'); },
        toolContext: () => ({}),
    });
    await assert.rejects(failing.requestApproval({}));
    assert.strictEqual(failing.waiting(), false);

    // A tool context with no question callback goes through untouched.
    const plain = { settings: { a: 1 } };
    assert.strictEqual(countCards({ requestApproval: async () => ({}), toolContext: () => plain }).toolContext(), plain);

    // One with a question callback has it counted as well.
    let answerQuestion;
    const asking = countCards({
        requestApproval: async () => ({}),
        toolContext: () => ({ askUser: () => new Promise((resolve) => { answerQuestion = resolve; }) }),
    });
    const question = asking.toolContext().askUser({ question: 'Which one?' });
    assert.strictEqual(asking.waiting(), true, 'a question card is counted while open');
    answerQuestion({ answer: 'web-01' });
    await question;
    assert.strictEqual(asking.waiting(), false);
}

/** One CLI run, played by node itself. */
function run(provider, script, options = {}) {
    return provider._test.runTurn({
        binary: process.execPath,
        args: ['-e', script],
        directory: os.tmpdir(),
        env: process.env,
        translator: provider.createTranslator(() => {}),
        // Long enough for node to start on a slow machine, which is the
        // first stretch of quiet in every run.
        idleTimeout: 1200,
        ...options,
    });
}

// Talks every quarter second for two and a half, well past the limit.
const CHATTY = 'let n = 0; const t = setInterval(() => { console.log(JSON.stringify({ type: "text", data: "x" })); if (++n >= 10) { clearInterval(t); process.exit(0); } }, 250);';
// Says nothing for longer than the test is willing to wait.
const SILENT = 'setTimeout(() => process.exit(0), 20000);';
// Quiet for longer than the limit, then finishes cleanly.
const PAUSED = 'setTimeout(() => process.exit(0), 2500);';

async function runTurnTests(provider, label) {
    const chatty = await run(provider, CHATTY);
    assert.strictEqual(chatty.ok, true, `${label}: a turn that keeps talking is not ended`);

    const started = Date.now();
    const silent = await run(provider, SILENT);
    assert.strictEqual(silent.ok, false, `${label}: a silent turn is ended`);
    assert.match(silent.message, /went quiet/);
    assert(Date.now() - started < 10000, `${label}: and ended at the idle limit, not when the process chose to stop`);

    const waited = await run(provider, PAUSED, { waiting: () => true });
    assert.strictEqual(waited.ok, true, `${label}: a turn waiting on a card is not ended`);
}

async function main() {
    await timerTests();
    await cardTests();
    await runTurnTests(grok, 'grok');
    await runTurnTests(kimi, 'kimi');
    console.log('cli-idle tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
