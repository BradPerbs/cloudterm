/**
 * Sends off the boot splash, the logo index.html shows while the bundle loads
 * (see `.boot-splash` in input.css).
 *
 * The splash is plain markup, because nothing that needs a script can run
 * while it is up. By the time it leaves the scripts are in and the app has
 * drawn underneath it, so it leaves by uncovering that: the logo comes forward
 * a little as the splash fades. With reduced motion it only fades.
 */

/** How far the logo comes forward on the way out. */
const FORWARD = 1.12;

const OUT_MS = 480;
const STILL_MS = 200;

/** After the next frame has been painted. */
const painted = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)));

let sent = false;

/**
 * Called once the app (or the lock screen, or the error screen) has rendered.
 * Safe to call more than once, and where there is no splash.
 */
export function dismissBootSplash() {
    const splash = document.getElementById('boot-splash');
    if (sent || !splash) return;
    sent = true;

    const root = document.documentElement;
    // A window that never showed it: the screenshot viewer, an assistant
    // window. The markup goes, and nothing else happens.
    if (!root.classList.contains('booting')) {
        splash.remove();
        return;
    }

    // From here on it is only a picture of the way out. The app under it takes
    // the clicks, and the window its own drag regions, while it fades, so the
    // splash never stands between someone and an app that is ready.
    splash.style.pointerEvents = 'none';
    splash.style.setProperty('-webkit-app-region', 'no-drag');

    const still = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    // One painted frame first, so what it uncovers is the app rather than the
    // empty page before it. It does not wait for the logo to finish rising: a
    // quick start fades it out mid-rise, which reads as quick, where waiting
    // would hold a ready app back for the sake of an animation.
    painted()
        .then(() => leave(splash, still))
        .catch(() => splash.remove())
        .finally(() => root.classList.remove('booting', 'boot-light'));
}

/** The way out, resolving once the splash is gone from the page. */
function leave(splash, still) {
    const gone = (animation) => animation.finished.then(() => splash.remove(), () => splash.remove());

    if (still) {
        return gone(splash.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: STILL_MS,
            easing: 'ease-out',
            fill: 'forwards',
        }));
    }

    splash.querySelector('.boot-splash-track')?.animate([{ opacity: 0 }], { duration: 160, fill: 'forwards' });
    splash.querySelector('.boot-splash-mark')?.animate([
        { transform: 'none' },
        { transform: `scale(${FORWARD})` },
    ], { duration: OUT_MS, easing: 'cubic-bezier(0.55, 0, 0.85, 0.35)', fill: 'forwards' });

    return gone(splash.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: OUT_MS * 0.6,
        delay: OUT_MS * 0.4,
        easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
        fill: 'forwards',
    }));
}
