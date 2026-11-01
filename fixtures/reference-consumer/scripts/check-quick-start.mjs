/**
 * Runs the quick start from the documentation as written: starts `src/server.ts` with tsx and
 * logs in as its demo user. The runner copies the quick start's files to ./quick-start.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const port = await new Promise((resolve) => {
  const probe = createServer().listen(0, () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});

// Own the Node process itself; stopping an npx wrapper can leave its server running.
const server = spawn(process.execPath, ['--import', 'tsx', 'quick-start/src/server.ts'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'inherit'],
});

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Quick start exited with ${code}`)));
    server.stdout.on('data', (data) => {
      if (String(data).includes('Server is running')) resolve();
    });
  });

  const login = (password) =>
    fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', password }),
    });

  const accepted = await login('correct-horse');
  assert.equal(accepted.status, 200);
  assert.equal(typeof (await accepted.json()).token, 'string');
  assert.equal((await login('wrong-password')).status, 401);
  console.log('The quick start runs and its login route works.');
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
}
