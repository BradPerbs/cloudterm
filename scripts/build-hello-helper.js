/**
 * Compile the Windows Hello helper.
 *
 * Uses the C# compiler that ships inside Windows, against the WinRT metadata
 * that also ships inside Windows. Nothing here needs the .NET SDK, the Windows
 * SDK, a Developer Pack, or a node-gyp toolchain — which is the whole reason
 * the helper is a tiny exe rather than a native node addon.
 *
 * Run by `npm run build:hello`, and folded into `npm run build`. On anything
 * other than Windows it does nothing and says so: the output is only reachable
 * from a Windows build, and failing the whole build over it would be wrong.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'tools', 'HelloHelper.cs');
const OUTPUT_DIR = path.join(ROOT, 'resources');
const OUTPUT = path.join(OUTPUT_DIR, 'hello-helper.exe');

const FRAMEWORK = path.join(
    process.env.WINDIR || 'C:\\Windows',
    'Microsoft.NET', 'Framework64', 'v4.0.30319',
);
const METADATA = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WinMetadata');

function main() {
    if (process.platform !== 'win32') {
        console.log('build-hello-helper: not Windows, nothing to build.');
        return;
    }

    const compiler = path.join(FRAMEWORK, 'csc.exe');
    const missing = [
        [compiler, 'the in-box C# compiler'],
        [path.join(METADATA, 'Windows.Security.winmd'), 'WinRT metadata'],
        [path.join(FRAMEWORK, 'System.Runtime.dll'), 'the .NET runtime facade'],
    ].filter(([file]) => !fs.existsSync(file));

    if (missing.length > 0) {
        for (const [file, what] of missing) console.error(`  missing ${what}: ${file}`);
        throw new Error('build-hello-helper: cannot compile the Windows Hello helper');
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    execFileSync(compiler, [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        `/out:${OUTPUT}`,
        `/reference:${path.join(METADATA, 'Windows.Security.winmd')}`,
        `/reference:${path.join(METADATA, 'Windows.Storage.winmd')}`,
        `/reference:${path.join(METADATA, 'Windows.Foundation.winmd')}`,
        `/reference:${path.join(FRAMEWORK, 'System.Runtime.dll')}`,
        SOURCE,
    ], { stdio: 'inherit' });

    const { size } = fs.statSync(OUTPUT);
    console.log(`build-hello-helper: wrote ${path.relative(ROOT, OUTPUT)} (${(size / 1024).toFixed(1)} KB)`);
}

try {
    main();
} catch (error) {
    // A compiler diagnostic has already been printed by csc; a node stack trace
    // on top of it only buries the line that says what is wrong.
    console.error(error.message);
    process.exit(1);
}
