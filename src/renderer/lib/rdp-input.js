/**
 * Keyboard and pointer input for an RDP session.
 *
 * RDP carries keys as PS/2 Set 1 scancodes, what the hardware sent an XT
 * keyboard controller, so a browser `KeyboardEvent` has to be translated back
 * into one. `event.code` is the right source for this and `event.key` is not:
 * `code` names the physical key and does not change with the layout or with
 * Shift, which is exactly the property a scancode has. The remote machine
 * applies its own layout to it.
 *
 * Extended keys (the ones the XT keyboard did not have, and which the AT
 * keyboard prefixed with 0xE0) carry that prefix in the high byte here.
 */
export const SCANCODES = {
    Escape: 0x01,
    Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06,
    Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b,
    Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f,
    KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14,
    KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19,
    BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c, ControlLeft: 0x1d,
    KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22,
    KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26,
    Semicolon: 0x27, Quote: 0x28, Backquote: 0x29,
    ShiftLeft: 0x2a, Backslash: 0x2b,
    KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30,
    KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35,
    ShiftRight: 0x36, NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39,
    CapsLock: 0x3a,
    F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40,
    F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44,
    NumLock: 0x45, ScrollLock: 0x46,
    Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4a,
    Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d, NumpadAdd: 0x4e,
    Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52,
    NumpadDecimal: 0x53,
    F11: 0x57, F12: 0x58,

    // Extended (0xE0-prefixed).
    NumpadEnter: 0xe01c, ControlRight: 0xe01d, NumpadDivide: 0xe035,
    PrintScreen: 0xe037, AltRight: 0xe038,
    Home: 0xe047, ArrowUp: 0xe048, PageUp: 0xe049,
    ArrowLeft: 0xe04b, ArrowRight: 0xe04d,
    End: 0xe04f, ArrowDown: 0xe050, PageDown: 0xe051,
    Insert: 0xe052, Delete: 0xe053,
    MetaLeft: 0xe05b, MetaRight: 0xe05c, ContextMenu: 0xe05d,

    Pause: 0xe11d45,
};

/** The three that make up Ctrl+Alt+Del, which cannot be typed locally. */
const CTRL_ALT_DEL = [SCANCODES.ControlLeft, SCANCODES.AltLeft, SCANCODES.Delete];

const clamp = (value, max) => Math.max(0, Math.min(max, value));

/**
 * Attach input handling to a canvas.
 *
 * `getSession` is read on every event rather than the session being captured,
 * because a reconnect replaces it and the listeners outlive that. Returns a
 * function that removes every listener it added.
 */
export function attachInput(canvas, getSession, ironrdp, { isViewOnly } = {}) {
    const { DeviceEvent, InputTransaction, RotationUnit } = ironrdp;

    /** Everything currently held down, so it can be released if focus is lost. */
    const held = new Set();

    const apply = (...events) => {
        const session = getSession();
        if (!session) return;
        if (isViewOnly?.()) return;

        try {
            const transaction = new InputTransaction();
            for (const event of events) transaction.addEvent(event);
            session.applyInputs(transaction);
        } catch {
            // A session that has gone away mid-event is not worth a message;
            // the pane already knows it disconnected.
        }
    };

    const onKeyDown = (event) => {
        // The pane owns the keyboard while it has focus, including the browser's
        // own shortcuts; a remote desktop that swallows everything except
        // Ctrl+W is worse than one that swallows nothing.
        event.preventDefault();
        event.stopPropagation();

        const scancode = SCANCODES[event.code];
        if (scancode === undefined) return;

        held.add(scancode);
        apply(DeviceEvent.keyPressed(scancode));
    };

    const onKeyUp = (event) => {
        event.preventDefault();
        event.stopPropagation();

        const scancode = SCANCODES[event.code];
        if (scancode === undefined) return;

        held.delete(scancode);
        apply(DeviceEvent.keyReleased(scancode));
    };

    /**
     * Release everything on the way out.
     *
     * Without this, Alt+Tab leaves Alt down on the server: the keyup lands on
     * whatever took focus, the remote machine never hears it, and every
     * subsequent keystroke is an Alt chord until something clears it.
     */
    const releaseAll = () => {
        const session = getSession();
        if (!session) return;

        try {
            session.releaseAllInputs();
        } catch {
            // Gone already.
        }
        held.clear();
    };

    /**
     * Pane coordinates -> framebuffer coordinates.
     *
     * The canvas is drawn with `object-fit: contain`, which scales the picture
     * to fit and then *centres* it. So the moment the pane's aspect ratio and
     * the desktop's differ there are bars down two sides, and they are part of
     * the element's rectangle without being part of the picture. That is every
     * moment after the pane has been resized, since `fit` deliberately leaves
     * the resolution alone.
     *
     * Measuring against the rectangle therefore displaced the pointer by
     * whatever the bars were, and mis-scaled it by the same ratio. This measures
     * the drawn picture instead: one scale for both axes, which is what
     * `contain` means, and the offset of the picture within the box.
     *
     * The same arithmetic is right at actual size, where the box matches the
     * picture: the two ratios are equal, so the offsets come out zero.
     */
    const toRemote = (event) => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height || !canvas.width || !canvas.height) return null;

        const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
        if (!scale) return null;

        const left = rect.left + (rect.width - canvas.width * scale) / 2;
        const top = rect.top + (rect.height - canvas.height * scale) / 2;

        // A drag can carry the pointer off the picture, and the server expects a
        // point that is on it.
        return {
            x: clamp(Math.round((event.clientX - left) / scale), canvas.width - 1),
            y: clamp(Math.round((event.clientY - top) / scale), canvas.height - 1),
        };
    };

    const onMouseMove = (event) => {
        const point = toRemote(event);
        if (point) apply(DeviceEvent.mouseMove(point.x, point.y));
    };

    const onMouseDown = (event) => {
        event.preventDefault();
        canvas.focus();

        // Move first: a click that arrives before the pointer has been placed
        // lands wherever the server last thought the cursor was.
        const point = toRemote(event);
        if (point) apply(DeviceEvent.mouseMove(point.x, point.y));
        apply(DeviceEvent.mouseButtonPressed(event.button));
    };

    const onMouseUp = (event) => {
        event.preventDefault();
        apply(DeviceEvent.mouseButtonReleased(event.button));
    };

    const onWheel = (event) => {
        event.preventDefault();

        // IronRDP takes rotations, and the sign is inverted relative to the DOM:
        // a positive `deltaY` is a scroll *down*, which is a negative rotation.
        if (event.deltaY) {
            apply(DeviceEvent.wheelRotations(true, event.deltaY > 0 ? -1 : 1, RotationUnit.Line));
        }
        if (event.deltaX) {
            apply(DeviceEvent.wheelRotations(false, event.deltaX > 0 ? -1 : 1, RotationUnit.Line));
        }
    };

    // Right-click belongs to the desktop, not to Chromium's menu.
    const onContextMenu = (event) => event.preventDefault();

    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('blur', releaseAll);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('blur', releaseAll);

    return () => {
        canvas.removeEventListener('keydown', onKeyDown);
        canvas.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('blur', releaseAll);
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mouseup', onMouseUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('blur', releaseAll);
    };
}

/**
 * Send Ctrl+Alt+Del.
 *
 * The whole point of the button is that this combination cannot be typed: the
 * local machine takes it first, wherever the focus is.
 */
export function sendCtrlAltDel(session, ironrdp) {
    if (!session) return;

    const { DeviceEvent, InputTransaction } = ironrdp;

    try {
        const transaction = new InputTransaction();
        for (const code of CTRL_ALT_DEL) transaction.addEvent(DeviceEvent.keyPressed(code));
        // Released in reverse, as a real keyboard would.
        for (const code of [...CTRL_ALT_DEL].reverse()) {
            transaction.addEvent(DeviceEvent.keyReleased(code));
        }
        session.applyInputs(transaction);
    } catch {
        // The session ended between the click and the send.
    }
}
