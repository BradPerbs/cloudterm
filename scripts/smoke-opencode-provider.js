const fs = require('fs');
const os = require('os');
const path = require('path');

const provider = require('../src/main/ai/providers/opencode');

/**
 * No prompt and no provider credentials: this only proves that the installed
 * CLI can be found, its native server starts, the SDK connects, and the whole
 * process tree shuts down. The Windows release job installs OpenCode through
 * npm deliberately, exercising the `.cmd` shim path that packaged apps meet.
 */
async function run() {
    const binary = provider.findOpenCode();
    if (!binary) throw new Error('The OpenCode CLI was not found');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudblast-opencode-'));
    let server;
    try {
        server = await provider._test.launchServer(binary, provider.serverConfig(), directory);
        const sdk = await import('@opencode-ai/sdk');
        const client = sdk.createOpencodeClient({
            baseUrl: server.url,
            directory,
            throwOnError: true,
        });
        const response = await client.path.get();
        if (!response?.data?.directory) throw new Error('OpenCode answered without its working directory');
        console.log(`OpenCode smoke test passed (${binary})`);
    } finally {
        provider._test.closeProcess(server?.child);
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
