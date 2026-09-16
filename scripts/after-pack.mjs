import pandocAfterPack from './pandoc-package/after-pack.mjs'
import tikaAfterPack from './tika-package/after-pack.mjs'

export default async function afterPack(context) {
  await tikaAfterPack(context)
  await pandocAfterPack(context)
}
