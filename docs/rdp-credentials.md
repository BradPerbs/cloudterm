# RDP credentials (CredSSP exception)

Most secrets in CloudTerm never leave the main process. RDP is the documented
exception: Network Level Authentication (CredSSP) runs inside IronRDP’s
WebAssembly client in the renderer, so the decrypted password must reach that
client once when a session opens.

## Lifetime

1. **Vault / store** — `rdpPassword` is encrypted at rest like other host
   secrets (`src/main/store.js`).
2. **Open** — `rdp.open` decrypts via `resolveDesktop`, returns
   `{ username, domain, password, … }` once over IPC, and does **not** keep the
   password on the live session object or in `snapshot()`.
3. **Renderer** — `RdpView` loads IronRDP **before** calling `open`, so the
   secret does not sit on the IPC result through WASM compile. It passes the
   password into `SessionBuilder`, then clears `result.password` in a `finally`
   that covers every post-open exit (missing canvas, cancel, connect error).
4. **Reconnect** — always re-calls `open`; nothing retains the password for
   reuse.

## Logging and redaction

- Host list IPC redacts `rdpPassword` (exposes `hasRdpPassword` only).
- Activity change diffs treat `rdpPassword` and `bmcPassword` as secrets
  (`secret: true`, empty `from`/`to`).
- Error paths describe rejected credentials without echoing the value.

## Residual risk

JavaScript strings are immutable: clearing a property drops the reference; the
engine may retain the buffer until GC. IronRDP’s WASM heap is opaque to the
app — there is no upstream API to zeroize credentials after NLA. Treat the
renderer process as a higher-trust surface for the duration of CredSSP, then
minimize lifetime as above.

## Contrast with VNC / BMC

VNC authenticates in the main process; the viewer never receives the password.
BMC uses a sandboxed webview with its own auto-login path — also not this
CredSSP handoff.
