/**
 * Serve OpenCode out of the OpenCode Desktop install.
 *
 * The desktop app ships no `opencode` CLI. Its server is a JavaScript bundle
 * inside its app.asar, started by the app as a sidecar with a password it
 * makes up per launch and keeps in memory, so a running desktop cannot be
 * joined from outside. What can be done is what the app itself does: run its
 * own Electron as plain Node, import the bundle, and call `Server.listen`.
 * This script is that, started by the OpenCode provider with the app's
 * executable and `ELECTRON_RUN_AS_NODE=1`.
 *
 * Standalone on purpose: it runs under the desktop app's Node, outside this
 * app, so it requires nothing from it. It prints the same "listening on" line
 * the CLI prints, which is what the provider waits for.
 *
 *   OpenCode.exe opencode-desktop-serve.mjs <app.asar> <hostname> <port>
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [asar, hostname = '127.0.0.1', port = '0'] = process.argv.slice(2);

if (!asar) {
    console.error('opencode-desktop-serve: no app.asar given');
    process.exit(2);
}

// The bundle's file name carries a build hash, so it is read off the archive
// rather than spelled out. Electron's fs reads inside an asar.
const chunks = path.join(asar, 'out', 'main', 'chunks');
let bundle = '';
try {
    bundle = fs.readdirSync(chunks).find(name => /^node-.*\.js$/.test(name)) || '';
} catch (error) {
    console.error(`opencode-desktop-serve: cannot read ${chunks}: ${error.message}`);
    process.exit(2);
}
if (!bundle) {
    console.error('opencode-desktop-serve: the desktop bundle has no server chunk');
    process.exit(2);
}

// What the desktop sets around its sidecar, minus the password: this server
// listens on the loopback interface on a port nobody else knows, which is
// exactly the CLI's own arrangement.
process.env.OPENCODE_CLIENT = process.env.OPENCODE_CLIENT || 'desktop';
process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = 'true';
for (const key of ['NO_PROXY', 'no_proxy']) {
    const items = (process.env[key] || '').split(',').map(value => value.trim()).filter(Boolean);
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
        if (!items.some(value => value.toLowerCase() === host)) items.push(host);
    }
    process.env[key] = items.join(',');
}

try {
    const { Server } = await import(pathToFileURL(path.join(chunks, bundle)).href);
    const listener = await Server.listen({ port: Number(port) || 0, hostname });
    const url = String(listener?.url || `http://${hostname}:${listener?.port ?? port}`).replace(/\/+$/, '');
    console.log(`opencode server listening on ${url}`);
    const stop = () => {
        Promise.resolve(listener?.stop?.()).finally(() => process.exit(0));
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    process.on('SIGHUP', stop);
} catch (error) {
    console.error(`opencode-desktop-serve: ${error?.stack || error}`);
    process.exit(1);
}
