import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';

const executable = process.argv[2];
const port = Number(process.argv[3] ?? 39460);

if (!executable || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: node scripts/smoke-packaged-web.mjs <executable> [port]');
  process.exit(2);
}

const smokeHome = await mkdtemp(join(tmpdir(), 'dsh-web-smoke-'));
const output = [];
const child = spawn(
  executable,
  ['web', '--host', '127.0.0.1', '--port', String(port)],
  {
    env: { ...process.env, DSH_HOME: smokeHome },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

const record = (chunk) => {
  output.push(String(chunk));
  if (output.length > 200) output.shift();
};
child.stdout?.on('data', record);
child.stderr?.on('data', record);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForExit = async (milliseconds) => {
  if (child.exitCode !== null) return;
  await Promise.race([once(child, 'exit'), wait(milliseconds)]);
};

const stop = async () => {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => resolve());
    });
  } else {
    child.kill('SIGTERM');
  }
  await waitForExit(5000);
  if (child.exitCode === null) child.kill('SIGKILL');
  await waitForExit(1000);
};

const reportOutput = () => {
  if (output.length > 0) console.error(output.join('').slice(-16_000));
};

try {
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      reportOutput();
      throw new Error(`packaged Web profile exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      const html = await response.text();
      if (response.ok && html.includes('<title>DeepSeek Harness</title>')) {
        ready = true;
        break;
      }
    } catch {
      // The profile may still be loading its embedded frontend assets.
    }
    await wait(250);
  }
  if (!ready) {
    reportOutput();
    throw new Error('packaged Web profile did not become ready within 30 seconds');
  }

  await wait(2_000);
  if (child.exitCode !== null) {
    reportOutput();
    throw new Error('packaged Web profile exited after its first response');
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
  const html = await response.text();
  if (!response.ok || !html.includes('<title>DeepSeek Harness</title>')) {
    throw new Error('packaged Web profile failed its second response check');
  }
  console.log('packaged Web profile served DeepSeek Harness successfully');
} finally {
  await stop();
  await rm(smokeHome, { recursive: true, force: true });
}
