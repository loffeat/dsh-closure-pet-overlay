// 打包桌面浮窗前端：assets/src/desktop-entry.js -> assets/client.js
// 用法：node tools/build-client.mjs
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(root, 'assets/src/desktop-entry.js')],
  bundle: true,
  format: 'iife',
  charset: 'utf8',
  outfile: path.join(root, 'assets/client.js'),
  logLevel: 'info',
})

console.log('built assets/client.js')
