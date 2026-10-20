import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 설치된 Vitest의 Vite CLI를 재사용한다. 설치·전역 도구·운영 환경 파일은 필요 없다.
const require = createRequire(import.meta.resolve('vitest'))
const vite = resolve(dirname(require.resolve('vite')), '../../bin/vite.js')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const child = spawn(process.execPath, [vite, '--config', 'tests/editor-table/vite.config.ts'], { cwd: repo, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
