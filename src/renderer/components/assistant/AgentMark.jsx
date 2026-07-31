import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * The assistant's mark: the cloud with two eyes in it.
 *
 * Inlined rather than loaded from `agent.svg` for two reasons. The gradient
 * needs an id, and an id repeated across every copy on screen is one gradient
 * that several elements fight over, so it is generated per instance. And the
 * eyes have to be reachable by a stylesheet, which is where the character
 * lives.
 *
 * The artwork is 338 x 281, so a square box letterboxes it: the mark comes out
 * about 0.83 of `size` tall, which is why the call sites ask for a couple of
 * pixels more than they did for the icon this replaced.
 *
 * `animated` is off by default and asked for in exactly one place: the empty
 * state, where the mark is large and is the thing being looked at. Everywhere
 * else it is a small button icon, and something drifting and blinking in the
 * corner of a terminal window is not charm, it is a distraction with a face on.
 *
 * `mono` is the same shape in `currentColor`, for when the mark is a control
 * rather than the subject. The rail button sits in a row of chrome that is one
 * grey in light mode and another in dark, and lifts to near-black or white
 * under the pointer; a blue and cyan cloud in the middle of that follows
 * nothing and reads as a sticker. The eyes are cut out rather than painted, so
 * they stay legible whatever the mark is tinted to and whatever it sits on.
 *
 * ## How it stays alive
 *
 * Two eyes is a small vocabulary, so what sells it is timing rather than
 * drawing. Expressions are picked at random and separated by uneven pauses,
 * because a face that cycles predictably reads as a loop within about twenty
 * seconds, and one that never rests reads as a nervous tic. The poses
 * themselves are in input.css; this only decides what happens when.
 *
 * On top of that it watches the pointer. Gaze is a translate on the group and
 * the expressions are transforms on each eye, so the two compose instead of
 * fighting: it can be mid-wink and still be looking at you.
 */

/** How far the pointer has to travel for the eyes to reach the end of their
 *  range, and how far that range goes, in the artwork's own units. */
const REACH_X = 300;
const REACH_Y = 220;
const GAZE_X = 14;
const GAZE_Y = 9;

/**
 * What it can do, and how often. Blinking dominates on purpose: it is the one
 * an eye does without meaning anything by it, and it is what makes the rest
 * land as deliberate when they come.
 */
const EXPRESSIONS = [
    { name: 'blink', weight: 38 },
    { name: 'look', weight: 17 },
    { name: 'curious', weight: 13 },
    { name: 'happy', weight: 12 },
    { name: 'wink', weight: 11 },
    { name: 'angry', weight: 9 },
];

const TOTAL = EXPRESSIONS.reduce((sum, expression) => sum + expression.weight, 0);

/**
 * The next expression, weighted, and not the one just played.
 *
 * Blink is exempt from that rule: two blinks in a row is something a face
 * actually does, while two winks in a row is a tic.
 */
function pickExpression(previous) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        let roll = Math.random() * TOTAL;
        const chosen = EXPRESSIONS.find((expression) => {
            roll -= expression.weight;
            return roll <= 0;
        }) || EXPRESSIONS[0];

        if (chosen.name !== previous || chosen.name === 'blink') return chosen.name;
    }
    return 'blink';
}

/** The rest between two expressions. Uneven, or it reads as a metronome. */
const restFor = () => 1100 + Math.random() * 3200;

/** The cloud, drawn twice in `mono`: once as the shape, once as the mask. */
const CLOUD = `M313.501 119.878C300.963 104.496 283.685 93.8215 264.437 89.5666C260.208 69.8728 252.425
    52.748 241.428 38.7057C241.131 38.2188 240.791 37.7604 240.413 37.3355C203.361 -8.04572
    142.624 -7.87449 101.681 15.5866C66.6589 35.7946 36.8826 78.4355 52.4473 139.571C16.5802
    148.477 0 180.158 0 208.757C0 240.781 20.6407 276.914 66.8282 280.168H241.766C265.791
    280.168 288.631 271.263 306.226 254.823C348.861 217.148 343.278 155.327 313.501 119.878Z`;

export default function AgentMark({ size = 18, animated = false, mono = false, className = '' }) {
    // Colons are fine in an id but read badly in a `url(#...)`, so they go.
    const unique = useId().replace(/:/g, '');
    const gradient = `agent-cloud-${unique}`;
    const holes = `agent-eyes-${unique}`;

    const [expression, setExpression] = useState('');
    const timer = useRef(null);
    const running = useRef(false);
    const previous = useRef('');
    const eyes = useRef(null);

    function play() {
        previous.current = pickExpression(previous.current);
        setExpression(previous.current);
    }

    function queue() {
        clearTimeout(timer.current);
        timer.current = setTimeout(play, restFor());
    }

    /**
     * One expression has finished. The stylesheet owns how long each pose
     * takes, so the end of the animation is the signal rather than a duration
     * repeated here that would drift out of step with it the first time one is
     * retimed.
     */
    function rest() {
        setExpression('');
        if (running.current) queue();
    }

    useEffect(() => {
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        running.current = Boolean(animated) && !still;
        if (!running.current) return undefined;

        queue();
        return () => {
            running.current = false;
            clearTimeout(timer.current);
        };
        // `queue` is recreated every render and closes over nothing but refs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animated]);

    /**
     * Follow the pointer.
     *
     * Written straight to the node rather than held in state: this fires on
     * every mouse move, and a re-render per frame to move two rects a few
     * pixels is the kind of thing that makes a whole window feel heavy. The
     * easing is a CSS transition on the group, so the eyes arrive a beat after
     * the cursor does, which is the difference between watching something and
     * being welded to it.
     *
     * `tanh` rather than a clamp. The eyes slow as they approach the edge of
     * their travel and never hit a wall, so a pointer crossing the far side of
     * the screen still moves them, just barely.
     */
    useLayoutEffect(() => {
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (!animated || still) return undefined;

        let frame = 0;
        let point = null;

        const settle = () => {
            frame = 0;
            const node = eyes.current;
            if (!node || !point) return;

            const box = node.ownerSVGElement?.getBoundingClientRect();
            if (!box?.width) return;

            const x = Math.tanh((point.x - (box.left + box.width / 2)) / REACH_X) * GAZE_X;
            const y = Math.tanh((point.y - (box.top + box.height / 2)) / REACH_Y) * GAZE_Y;
            node.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        };

        const onMove = (event) => {
            point = { x: event.clientX, y: event.clientY };
            if (!frame) frame = requestAnimationFrame(settle);
        };

        // Back to centre when the pointer leaves the window, rather than
        // staring at the corner it went out through.
        const onLeave = () => {
            point = null;
            if (eyes.current) eyes.current.style.transform = 'translate(0px, 0px)';
        };

        window.addEventListener('mousemove', onMove);
        document.addEventListener('mouseleave', onLeave);
        return () => {
            window.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseleave', onLeave);
            cancelAnimationFrame(frame);
        };
    }, [animated]);

    /**
     * The eyes, painted or cut out.
     *
     * One piece of markup either way: the classes and the ref the poses and the
     * gaze are driven through have to be on the same element in both, or the
     * mark would only be alive in one of its two colours.
     */
    const renderEyes = (fill) => (
        <g
            ref={eyes}
            className={`agent-eyes ${animated ? 'is-tracking' : ''} ${expression ? `is-${expression}` : ''}`}
        >
            {/* The left eye carries the handler. Every expression moves it,
                so it is the one that can be trusted to report the end. */}
            <rect
                className="agent-eye agent-eye-left"
                x="113"
                y="120"
                width="46"
                height="90"
                rx="23"
                fill={fill}
                onAnimationEnd={rest}
            />
            <rect
                className="agent-eye agent-eye-right"
                x="193"
                y="120"
                width="46"
                height="90"
                rx="23"
                fill={fill}
            />
        </g>
    );

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 338 281"
            fill="none"
            aria-hidden="true"
            focusable="false"
            className={`${animated ? 'agent-float' : ''} ${className}`}
        >
            {/* Black is a hole, white is kept, so the eyes are subtracted from
                the cloud and whatever the mark is sitting on shows through
                them: the hover wash on the button, the shell behind it. */}
            {mono && (
                <mask id={holes} maskUnits="userSpaceOnUse" x="0" y="0" width="338" height="281">
                    <path d={CLOUD} fill="#fff" />
                    {renderEyes('#000')}
                </mask>
            )}

            <path
                opacity="0.8"
                d={CLOUD}
                fill={mono ? 'currentColor' : `url(#${gradient})`}
                mask={mono ? `url(#${holes})` : undefined}
            />

            {!mono && renderEyes('#D9D9D9')}

            {!mono && (
                <defs>
                    <linearGradient
                        id={gradient}
                        x1="168.511"
                        y1="0"
                        x2="168.511"
                        y2="280.168"
                        gradientUnits="userSpaceOnUse"
                    >
                        <stop stopColor="#307AF0" />
                        <stop offset="1" stopColor="#0FCBE3" />
                    </linearGradient>
                </defs>
            )}
        </svg>
    );
}
