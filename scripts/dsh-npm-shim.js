#!/usr/bin/env node
/**
 * `deepseek-harness-cli` npm shim: resolve the per-platform single-file executable installed
 * through the main package's optionalDependencies aliases and hand control to
 * it, forwarding stdio and signals. npm installs only the alias whose `os`/`cpu`
 * match the host, so exactly one platform package is present on a supported
 * system. Unsupported platforms and missing platform packages fail with a
 * reinstall hint rather than a Node stack trace.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const OS = { darwin: 'macos', linux: 'linux', win32: 'win' }
const CPU = { arm64: 'arm64', x64: 'x64' }

const os = OS[process.platform]
const cpu = CPU[process.arch]
if (!os || !cpu || (os === 'win' && cpu !== 'x64')) {
  console.error(
    `deepseek-harness-cli: unsupported platform ${process.platform}-${process.arch}. ` +
      'Supported: macOS (arm64, x64), Linux (arm64, x64), and Windows (x64).',
  )
  process.exit(1)
}

const packageName = `@peiyu_wang/deepseek-harness-cli-${os}-${cpu}`
const exeName = os === 'win' ? 'deepseek-harness-cli.exe' : 'deepseek-harness-cli'
let executable
try {
  executable = require.resolve(`${packageName}/bin/${exeName}`)
} catch {
  console.error(
    `deepseek-harness-cli: the ${packageName} package is not installed. ` +
      'Reinstall with: npm install -g @peiyu_wang/deepseek-harness-cli',
  )
  process.exit(1)
}

const child = spawn(executable, process.argv.slice(2), { stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal))
}
