/*
 * Runs in <head>, before the page has painted and long before the bundle has
 * loaded, which in a bundle this size is a second or more of empty window.
 *
 * Two things have to be known by the first frame rather than by the first
 * render. The theme, so the splash and everything after it come up in the
 * right one instead of in the wrong one and then switching (main.jsx applies
 * it again, fully, once it runs). And whether this window shows the boot
 * splash at all: the screenshot viewer and the assistant's own windows load
 * this same page, and open in a moment, from a bundle already in memory.
 *
 * A classic script from public/, not part of the bundle: a module would wait
 * for the rest of it. Kept to what cannot wait; anything that throws here
 * leaves the page as it was without this.
 */
(function () {
    var root = document.documentElement;
    try {
        var stored = localStorage.getItem('theme') || 'system';
        var custom = stored === 'custom';
        // Following the system is left to the stylesheet's media query: this
        // early, Electron has not yet told the page the system's scheme and
        // matchMedia says light whatever it is, where the media query catches
        // up by itself when it hears. A light theme chosen outright says so,
        // so that query leaves it alone.
        if (stored === 'dark' || custom) root.classList.add('dark');
        if (stored === 'light') root.classList.add('boot-light');
        // Only the background of a custom palette: it is all the splash shows.
        if (custom) {
            var base = (JSON.parse(localStorage.getItem('appColors') || 'null') || {}).base;
            if (/^#[0-9a-f]{6}$/i.test(base || '')) {
                var v = parseInt(base.slice(1), 16);
                root.style.setProperty('--app-base', (v >> 16) + ' ' + ((v >> 8) & 255) + ' ' + (v & 255));
            }
        }
    } catch (error) {
        // No storage, or a palette that does not parse: the defaults stand.
    }
    if (!/[#&](screenshot|assistant)=/.test(location.hash)) root.classList.add('booting');

    // A bundle that throws before it has drawn anything never gets as far as
    // sending the splash off, and the window would go on looking like a slow
    // start for good. Render errors have the error screen, which dismisses it;
    // this is for what fails before React is even running. The splash just
    // goes, so the console and the empty window say what happened. Only for a
    // real exception: the browser's own reports (a ResizeObserver loop, say)
    // carry no error object and are no reason to cut the splash short.
    window.addEventListener('error', function (event) {
        var splash = document.getElementById('boot-splash');
        if (!event.error || !splash || !root.classList.contains('booting')) return;
        splash.remove();
        root.classList.remove('booting', 'boot-light');
    });
})();
