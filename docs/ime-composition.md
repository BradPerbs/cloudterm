# IME composition positioning (CJK)

CloudTerm ships Chinese (`zh`) and other locales, but CJK Input Method Editor
(IME) candidate windows can appear mis-positioned in the terminal. This is a
known limitation tracked as GitHub
[#7](https://github.com/BradPerbs/cloudterm/issues/7).

## Symptom

While composing CJK (or other IME) text in an SSH/Telnet/serial pane, the
composition / candidate UI may not sit on the caret. English and dead-key Latin
input are unaffected.

## Current code

- Terminal: `src/renderer/components/TerminalView.jsx` (`@xterm/xterm` ^5.4)
- Styles: vendored `src/renderer/xterm.css` (upstream still carries
  `/* TODO: Composition position got messed up somewhere */` on
  `.xterm .composition-view`)
- No app-level `compositionstart` / IME hooks — positioning is entirely xterm’s
  `CompositionHelper` + CSS

Likely aggravators to test (not yet proven):

- Pane mount uses `p-3` + `overflow-hidden` on the open target
- WebGL addon vs DOM renderer
- Non-default `lineHeight` / `letterSpacing`
- Hardcoded black/white `.composition-view` vs themed terminal

## Repro matrix (for a later fix)

| Dimension | Values |
|-----------|--------|
| OS | Windows, macOS |
| IME | zh / ja / ko system IMEs |
| Renderer | WebGL on, WebGL off |
| Typography | default vs custom lineHeight / letterSpacing |

Compare against a stock xterm.js demo on the same Electron version to separate
CloudTerm layout from upstream bugs.

## Ranked options

1. **CSS / layout-only** — ensure composition view is not clipped; theme
   `.composition-view`; reduce padding/`overflow` interaction on the mount node.
2. **Bump `@xterm/xterm`** — evaluate 6.x for upstream IME fixes vs breakage in
   addons / WebGL.
3. **App composition sync** — listen for composition events and reposition
   (last resort; fights the library).
4. **Quarantine (this milestone)** — document the limitation, keep #7 open,
   cross-link the CSS TODO. Full N5 fix is out of M1 exit criteria.

## Quarantine stance (M1)

Until a verified fix lands: treat CJK IME in the terminal as best-effort.
Prefer composing in an external editor for critical CJK input if positioning
blocks work. Do not close #7 until zh QA passes on Windows and macOS with WebGL
on and off.
