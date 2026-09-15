const { realpathSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { resolve, join } = require('node:path')

// Resolve the source directory physically so Vue resolves PPTist's own dependencies
// beside its pnpm package instead of beside the workspace symlink.
const outputRoot = resolve('out')
mkdirSync(outputRoot, { recursive: true })
const directory = mkdtempSync(join(outputRoot, '.pptist-typecheck-'))
const config = join(directory, 'tsconfig.json')
writeFileSync(config, JSON.stringify({
  extends: resolve('tsconfig.pptist.json'),
  compilerOptions: {
    paths: { '@/*': [join(realpathSync('node_modules/pptist'), 'src/*')] }
  }
}))
process.on('exit', () => rmSync(directory, { recursive: true, force: true }))
process.argv = [process.argv[0], process.argv[1], '--noEmit', '-p', config]
// Vue's checker needs the JavaScript compiler API, unavailable in TypeScript 7.
require('vue-tsc').run(require.resolve('typescript-vue/lib/tsc'))
