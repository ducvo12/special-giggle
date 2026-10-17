import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('granite', {
  platform: process.platform
})
