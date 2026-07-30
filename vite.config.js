import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Stop Rollup emitting a copy of the IronRDP WebAssembly module.
 *
 * The module's loader ends with `new URL('rdp_client_bg.wasm', import.meta.url)`
 * as its default source, which Vite reads as an asset reference and dutifully
 * copies four megabytes into the bundle. Nothing ever loads it: the bytes come
 * from the main process over IPC instead (see lib/rdp-wasm.js), so the copy is
 * dead weight in the installer.
 *
 * Rewriting the expression to a constant leaves the branch unreachable (it is
 * only taken when `init` is called with no argument, and it never is) and
 * leaves Rollup with no asset to emit.
 *
 * Deliberately a no-op if the upstream source ever stops matching: the result
 * is the dead copy coming back, not a broken build.
 */
function dropUnusedWasmAsset() {
    const source = "new URL('rdp_client_bg.wasm', import.meta.url)";

    return {
        name: 'drop-unused-ironrdp-wasm-asset',
        apply: 'build',
        transform(code, id) {
            if (!id.includes('ironrdp-wasm') || !code.includes(source)) return null;
            return {
                code: code.replace(source, "'rdp_client_bg.wasm'"),
                map: null,
            };
        },
    };
}

export default defineConfig({
    plugins: [react(), dropUnusedWasmAsset()],
    root: path.join(__dirname, 'src/renderer'),
    base: './',
    build: {
        outDir: path.join(__dirname, 'dist/renderer'),
        emptyOutDir: true,
        // The only browser this bundle ever runs in is the Chromium inside the
        // Electron it ships with, so there is nothing to down-level for. The
        // default target is a 2021 browser matrix and rejects top-level await,
        // which noVNC uses to probe for hardware H.264 decoding.
        target: 'esnext',
    },
    optimizeDeps: {
        esbuildOptions: {
            // The dev server pre-bundles dependencies with its own esbuild pass
            // that does not read `build.target`, so the same allowance has to be
            // made twice or `npm run dev` fails where `npm run build` succeeds.
            target: 'esnext',
        },
    },
    server: {
        port: 5173,
    },
    resolve: {
        alias: {
            '@': path.join(__dirname, 'src/renderer'),
        },
    },
});
