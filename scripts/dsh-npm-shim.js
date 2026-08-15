#!/usr/bin/env node
/**
 * `deepseek-harness-cli` npm shim: resolve the per-platform runtime installed
 * through the main package's optionalDependencies aliases and hand control to
 * it, forwarding stdio and signals. POSIX packages contain one executable;
 * Windows packages contain node.exe plus the deployed CLI tree. npm installs
 * only the alias whose `os`/`cpu` match the host, so exactly one platform
 * package is present on a supported system. Unsupported platforms and missing
 * packages fail with a reinstall hint rather than a Node stack trace.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const OS = { darwin: 'macos', linux: 'linux', win32: 'windows' }
const CPU = { arm64: 'arm64', x64: 'x64' }

const os = OS[process.platform]
const cpu = CPU[process.arch]
if (!os || !cpu) {
  console.error(
      `deepseek-harness-cli: unsupported platform ${process.platform}-${process.arch}. ` +
      'Supported: macOS, Linux, and Windows on arm64 or x64.',
  )
  process.exit(1)
}

const packageName = `@peiyuwang54/deepseek-harness-cli-${os}-${cpu}`
let executable
let args = process.argv.slice(2)
try {
  if (os === 'windows') {
    executable = require.resolve(`${packageName}/bin/node.exe`)
    const entry = require.resolve(`${packageName}/bin/lib/bin.js`)
    if (args.length === 0) args = ['tui']
    args = [entry, ...args]
  } else {
    executable = require.resolve(`${packageName}/bin/deepseek-harness-cli`)
  }
} catch {
  console.error(
    `deepseek-harness-cli: the ${packageName} package is not installed. ` +
      'Reinstall with: npm install -g @peiyuwang54/deepseek-harness-cli',
  )
  process.exit(1)
}

const child = spawn(executable, args, { stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal))
}
