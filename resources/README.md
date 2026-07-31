# CloudBlast SSH Resources

Application resources bundled into the packaged app (icons and similar assets).

Everything in this folder is copied verbatim into the installer via
`extraResources`, so do not leave build artifacts here.

The one exception is `hello-helper.exe`, which `npm run build:hello` compiles
and which only the Windows package carries. It is filtered out of the macOS and
Linux builds, and it is gitignored, so it is absent from a fresh checkout until
you build it.

## Icons

The app icon is not here. It lives at `build/icon.png` in the repo root, and
all three platform targets point at that one file: electron-builder generates
the Windows `.ico` and the macOS `.icns` from it, and Linux takes the PNG as
it is.

`win.icon` used to name `resources/icon.ico`, which was never committed, so
every Windows build up to now quietly shipped the default Electron logo.
electron-builder warns about a missing icon rather than failing, which is how
that went unnoticed.

**The current `build/icon.png` is `appicon.png` scaled up from 200x200**, since
that was the only app art in the tree and 200px is below the minimum every
target needs (256 for Linux and the Windows ico, 512 for the macOS icns). It is
clean but soft, and it is worth replacing with a real 1024x1024 export the next
time the source art is to hand. Dropping that in at the same path is the whole
job: no configuration changes with it.
