/**
 * Logging into a BMC's own web interface, by filling in its own login form.
 *
 * Kept free of dependencies (it builds a string and holds a table) so the
 * recipes can be read, and changed, without reading the pane runtime in bmc.js.
 *
 * ## Why the form, and not the API
 *
 * Every board here has some authentication endpoint underneath the UI:
 * Supermicro sets a `SID` cookie from `/cgi/login.cgi`, iLO and OpenBMC hand
 * out a Redfish session token, iDRAC has had three different session endpoints
 * across three firmware generations. Driving those directly is tempting, and it
 * is the wrong choice here for one reason: having got a token, we would then
 * have to put it wherever *that* firmware's UI expects to read it back from, be
 * that a cookie, `sessionStorage`, or a bootstrap request the SPA makes before
 * it will render. That target moves with every firmware revision, and when it
 * moves the pane shows a logged-out UI with a valid session it cannot see.
 *
 * Submitting the real form does not have that problem. The vendor's own code
 * performs its own login and stores its own session in its own way, exactly as
 * it would if the user had typed it. We only put the characters in the boxes.
 *
 * So the whole vendor table below is selectors, and a board it has never heard
 * of still works, because the generic heuristic underneath it is the one a
 * password manager uses: find the password box, and the username is the text
 * box in front of it.
 *
 * ## The one board this cannot serve
 *
 * A BMC that answers with HTTP 401 and no login page has no form to fill. That
 * is not handled here at all; it is the `basic` vendor, and bmc.js answers the
 * auth challenge from the main process instead. See onLogin there.
 */

/**
 * How long the injected script waits for a login form to turn up.
 *
 * Generous because it is waiting on a service processor, which is a 400MHz ARM
 * core serving an Angular application, and eight seconds to first paint is an
 * ordinary result for one rather than a broken one.
 */
const FORM_TIMEOUT = 20000;

/**
 * How much longer the username field gets, once the password field is up.
 *
 * A separate and much shorter clock than FORM_TIMEOUT, because it is answering a
 * different question. FORM_TIMEOUT is waiting for a slow board to render at all;
 * this is waiting out the gap between two fields of a form that has already
 * rendered, which is a frame or two on anything healthy. Spending the full
 * twenty seconds on it would mean a page that genuinely has no username box sits
 * there saying nothing for twenty seconds before saying so.
 */
const FIELD_GRACE = 4000;

/**
 * How long the submit control gets to become clickable after the fields are
 * filled. Short, because it is waiting on a validation pass over two fields
 * rather than on a network or a render.
 */
const SUBMIT_GRACE = 2500;

/*
 * The two patterns the injected script matches wording with.
 *
 * Held here, as strings, and injected through JSON.stringify rather than
 * written as regex literals inside the script itself. That is not a style
 * choice. The script is built as a template literal, so a backslash in it is a
 * *string* escape before it is ever a regex one: `\b` becomes a backspace
 * character and `\s` collapses to a plain `s`, and the result is a regex that
 * compiles cleanly, looks right in the source and matches nothing. Keeping the
 * backslashes on this side of the template is the only reliable fix, because
 * doubling them inside it has to be remembered every time.
 */
const USERNAME_WORDS = 'user|login|logon|account|uname|userid|email';
const SUBMIT_WORDS = '\\b(log\\s*in|sign\\s*in|login|logon|submit|continue|enter|ok)\\b';

/**
 * Per-firmware selectors, tried before the generic heuristic.
 *
 * Every field is optional. A vendor entry exists to skip a guess, never to
 * replace the fallback: if these match nothing, the heuristic still runs, so a
 * firmware revision that renames an input degrades to "works" rather than to
 * "fails".
 *
 * `path` is where the login page lives when the board does not redirect to it
 * from the root. Left blank wherever the board does redirect, which is most of
 * them, so that the record's own path field stays the thing in control.
 */
const RECIPES = {
    supermicro: {
        // The ASPEED reference UI, unchanged from X9 to X11. The submit control
        // is an <input type=image> on the older boards, which is why the submit
        // selector cannot just be button[type=submit].
        username: 'input[name="name"]',
        password: 'input[name="pwd"]',
        submit: 'input[name="Login"], input[type="submit"], input[type="image"]',
    },
    idrac: {
        // iDRAC 9 renders #user and #password; 7 and 8 use name= on the same
        // two fields. Both are listed rather than detected, because trying a
        // selector costs nothing and detecting the generation costs a request.
        username: '#user, input[name="user"], input[name="username"]',
        password: '#password, input[name="password"]',
        submit: '#btnLogin, button[type="submit"], input[type="submit"]',
    },
    ilo: {
        username: '#username, input[name="username"]',
        password: '#password, input[name="password"]',
        submit: 'button[type="submit"], input[type="submit"]',
    },
    openbmc: {
        // webui-vue. Vue writes through a value setter like React does, hence
        // the native-setter dance in the injected script.
        username: '#username, input[name="username"]',
        password: '#password, input[name="password"]',
        submit: 'button[type="submit"]',
    },
    ami: {
        // AMI MegaRAC, which is what most of the white-box world ships: Tyan,
        // ASRock Rack, Gigabyte, Quanta. Two generations with different names
        // for the same two fields, both listed rather than detected, because
        // trying a selector costs nothing and telling them apart costs a request.
        username: '#username, input[name="username"], input[name="WEBVAR_USERNAME"]',
        password: '#password, input[name="password"], input[name="WEBVAR_PASSWORD"]',
        submit: '#btn-login, #login-button, button[type="submit"], input[type="submit"]',
    },
};

/** Whether this vendor is filled in by script at all. */
function usesForm(vendor) {
    return vendor !== 'basic' && vendor !== 'manual';
}

/** The selectors for a vendor, or an empty recipe for one with no entry. */
function recipeFor(vendor) {
    return RECIPES[vendor] || {};
}

/**
 * Build the script that fills and submits the login form.
 *
 * Returned as source rather than run here because it is executed in the guest
 * page by bmc.js, which is the only part of this that needs Electron. It
 * resolves to `{ ok, reason }` and never throws: a rejected `executeJavaScript`
 * is indistinguishable from a page that navigated mid-call, and the pane wants
 * to tell those apart.
 *
 * Both credentials are embedded with JSON.stringify. That is not decoration: a
 * BMC password containing a quote or a backslash would otherwise be a syntax
 * error in the page, and one containing `');...` would be an injection into our
 * own script.
 */
function loginScript({ username, password, vendor, timeout = FORM_TIMEOUT }) {
    const recipe = recipeFor(vendor);

    return `(async () => {
    const USERNAME = ${JSON.stringify(username || '')};
    const PASSWORD = ${JSON.stringify(password || '')};
    const SELECTORS = ${JSON.stringify({
        username: recipe.username || '',
        password: recipe.password || '',
        submit: recipe.submit || '',
    })};
    const DEADLINE = Date.now() + ${Number(timeout) || FORM_TIMEOUT};
    const FIELD_GRACE = ${FIELD_GRACE};
    const SUBMIT_GRACE = ${SUBMIT_GRACE};

    /*
     * Every place on this page a form could be hiding.
     *
     * Three kinds, and each is a board that exists:
     *
     *   The document itself, which is most of them.
     *
     *   Same-origin frames, because the older Supermicro and iDRAC interfaces
     *   are framesets and the login form is not in the top document. The
     *   try/catch is for the odd board that embeds something cross-origin.
     *
     *   Open shadow roots. A component-based interface can put its login inputs
     *   inside one, and querySelectorAll on the document does not see through
     *   it: the page appears to contain no text inputs at all, which is
     *   indistinguishable from a page that genuinely has none.
     */
    const roots = () => {
        const found = [];

        const visit = (root) => {
            if (!root || found.includes(root)) return;
            found.push(root);

            for (const frame of root.querySelectorAll('iframe, frame')) {
                try {
                    if (frame.contentDocument) visit(frame.contentDocument);
                } catch { /* cross-origin, not ours to fill */ }
            }

            for (const el of root.querySelectorAll('*')) {
                if (el.shadowRoot) visit(el.shadowRoot);
            }
        };

        visit(document);
        return found;
    };

    /*
     * Hidden inputs are not the login form. Boards routinely ship a second,
     * display:none copy of it for a modal they never show.
     *
     * offsetParent is the cheap test and is null for a position:fixed element
     * as well as for a hidden one, so a rect check backs it up rather than
     * ruling out every login box that happens to be in a fixed panel.
     */
    const visible = (el) => Boolean(el && !el.disabled
        && (el.offsetParent !== null || el.getClientRects().length > 0));

    const pick = (doc, selector) => {
        if (!selector) return null;
        for (const el of doc.querySelectorAll(selector)) {
            if (visible(el)) return el;
        }
        return null;
    };

    /** The types a username can be typed into. No type at all means text. */
    const TEXTUAL = ['text', 'email', 'tel', 'search', ''];

    const textInputs = (root, password) =>
        [...root.querySelectorAll('input')].filter(el => el !== password
            && visible(el)
            && !el.readOnly
            && TEXTUAL.includes((el.getAttribute('type') || '').toLowerCase()));

    /** A field that says what it is, in any of the places a field can say it. */
    const NAMES = new RegExp(${JSON.stringify(USERNAME_WORDS)}, 'i');
    const selfNaming = (el) => NAMES.test([
        el.getAttribute('name') || '',
        el.id || '',
        el.getAttribute('autocomplete') || '',
        el.getAttribute('placeholder') || '',
        el.getAttribute('aria-label') || '',
    ].join(' '));

    const findPassword = (doc) => pick(doc, SELECTORS.password)
        || [...doc.querySelectorAll('input[type="password"]')].find(visible)
        || null;

    /*
     * The username, by four rules in descending confidence.
     *
     * The vendor's own selector first, then a field that names itself, then the
     * nearest text input above the password box, then whatever text input there
     * is. The last two are the generic heuristic and are why a board with no
     * recipe still works.
     *
     * The scope widens rather than being fixed at the password's own form. That
     * form was the only scope once, and it is the wrong one often enough to
     * matter: a framework that wraps each field in its own form, or renders the
     * username outside the form entirely, leaves the narrow search with nothing
     * to look at and reports a page with a perfectly ordinary login box on it as
     * having no username field.
     */
    const findUsername = (doc, password) => {
        const named = pick(doc, SELECTORS.username);
        if (named && named !== password) return named;

        let candidates = password.form ? textInputs(password.form, password) : [];
        if (!candidates.length) candidates = textInputs(doc, password);
        if (!candidates.length) return null;

        const declared = candidates.find(selfNaming);
        if (declared) return declared;

        // Document order, so the last candidate ahead of the password field is
        // the one sitting directly above it.
        const before = candidates.filter(el =>
            password.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);

        return before[before.length - 1] || candidates[0];
    };

    const find = () => {
        for (const doc of roots()) {
            const password = findPassword(doc);
            if (password) return { username: findUsername(doc, password), password, doc };
        }
        return null;
    };

    /**
     * What the page looked like when the search came up short.
     *
     * Reported rather than kept, because a fill that finds nothing is otherwise
     * indistinguishable from every other fill that finds nothing, and the thing
     * that tells them apart is on the far end of somebody else's network. The
     * counts say whether the fields were absent, invisible or somewhere this
     * script cannot reach.
     */
    const survey = () => {
        const found = roots();
        let inputs = 0;
        let hidden = 0;

        for (const root of found) {
            for (const el of root.querySelectorAll('input')) {
                inputs += 1;
                if (!visible(el)) hidden += 1;
            }
        }

        return { roots: found.length, inputs, hidden };
    };

    /*
     * Wait for the form. Polling rather than a MutationObserver because the
     * thing being waited for is often not a mutation at all: the first paint of
     * an Angular application arrives as one subtree replacement, and half the
     * boards here navigate to the login page rather than rendering it in place.
     */
    /*
     * The wait is for a *complete* form, not for a password box.
     *
     * Waiting only for the password box was wrong, and produced the most
     * misleading result this script can give. The search answers as soon as
     * there is something to type a password into, whether or not it also found
     * somewhere to type a username, so a loop testing only for an answer stops
     * on the first paint of the password field and reports the username field
     * missing a fraction of a second before it appears. On an application that
     * renders its two fields in separate frames, that is every single time.
     *
     * So an incomplete form is kept, and looked at again. The grace period is
     * short and separate from the overall deadline: once the password box is up
     * the page has clearly rendered, and a username box that is not there within
     * a few seconds is genuinely not coming.
     */
    let form = find();
    let sawPasswordAt = form ? Date.now() : 0;

    while (Date.now() < DEADLINE) {
        if (form?.username) break;
        if (form && Date.now() - sawPasswordAt > FIELD_GRACE) break;

        await new Promise(r => setTimeout(r, 200));

        const next = find();
        if (next) {
            if (!form) sawPasswordAt = Date.now();
            form = next;
        }
    }

    if (!form) return { ok: false, reason: 'no-form', survey: survey() };
    if (!form.username) return { ok: false, reason: 'no-username-field', survey: survey() };

    /*
     * Assigning .value directly is invisible to React, Angular and Vue: they
     * hold the last value they wrote and see no change, so the field looks
     * filled and the model behind it is still empty. Going through the
     * prototype's own setter and then dispatching the events the framework
     * listens for is what makes the model agree with the box.
     *
     * The setter is taken from the field's *own* window, because in a frameset
     * the input belongs to a different realm than this script does.
     */
    const set = (el, value) => {
        const view = el.ownerDocument.defaultView || window;
        const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    form.username.focus();
    set(form.username, USERNAME);
    form.password.focus();
    set(form.password, PASSWORD);

    /*
     * Find the control that submits it.
     *
     * A selector on type="submit" was the whole search here, and it misses the
     * most common button on the modern web. A <button> inside a form with no
     * type attribute *is* a submit button, because submit is the element's
     * default type per the HTML specification, but an attribute selector only
     * matches an attribute that is actually written, and component frameworks
     * almost never write it. So the board filled in correctly and sat there.
     */
    const kind = (el) => (el.getAttribute('type') || '').toLowerCase();

    /** Everything a person could plausibly be clicking to log in. */
    const clickables = (root) =>
        [...root.querySelectorAll('button, input, a, [role="button"]')].filter(visible);

    /** What a control says it does, wherever it says it. */
    const label = (el) => [
        el.textContent || '',
        el.getAttribute('value') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
    ].join(' ');

    const SAYS_LOGIN = new RegExp(${JSON.stringify(SUBMIT_WORDS)}, 'i');

    const findSubmit = () => {
        const named = pick(form.doc, SELECTORS.submit);
        if (named) return named;

        // The password's own form first, then the whole document, for the same
        // reason the username search widens: the button is not always inside it.
        for (const scope of [form.password.form, form.doc].filter(Boolean)) {
            const all = clickables(scope);

            const real = all.find(el =>
                (el.tagName === 'INPUT' && ['submit', 'image'].includes(kind(el)))
                || (el.tagName === 'BUTTON' && ['submit', ''].includes(kind(el))));
            if (real) return real;

            // A styled <a>, or a type="button" with a click handler on it. Last
            // resort, and only after every real submit control has been ruled
            // out, because this one matches on wording and wording can lie.
            const worded = all.find(el => SAYS_LOGIN.test(label(el)));
            if (worded) return worded;
        }

        return null;
    };

    /*
     * Wait for it to be clickable rather than clicking once and hoping.
     *
     * Frameworks routinely keep the submit disabled until their own validation
     * has run over the fields we just filled, and that validation is often a
     * tick or two behind the events. A disabled control does not count as
     * visible by this script's definition, so it simply is not found yet, and
     * looking again is the whole fix.
     */
    let submit = findSubmit();
    const submitBy = Date.now() + SUBMIT_GRACE;
    while (!submit && Date.now() < submitBy) {
        await new Promise(r => setTimeout(r, 150));
        submit = findSubmit();
    }

    if (submit) {
        submit.click();
        return { ok: true, reason: 'submitted' };
    }

    /*
     * No button we recognise. Enter in the password field is the last resort,
     * and it is a real one: a form with a single submit path fires it on
     * keydown, and boards whose "button" is a styled <a> with a click handler
     * generally bind it too.
     */
    for (const type of ['keydown', 'keypress', 'keyup']) {
        form.password.dispatchEvent(new KeyboardEvent(type, {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
        }));
    }

    if (form.password.form) {
        try {
            form.password.form.requestSubmit
                ? form.password.form.requestSubmit()
                : form.password.form.submit();
        } catch { /* a form with no action, or one already navigating */ }
    }

    return { ok: true, reason: 'submitted-without-button' };
})()`;
}

module.exports = {
    FORM_TIMEOUT,
    RECIPES,
    usesForm,
    recipeFor,
    loginScript,
};
