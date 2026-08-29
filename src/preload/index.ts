import { contextBridge } from 'electron'

const desktopApi = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  })
})

contextBridge.exposeInMainWorld('desktop', desktopApi)
