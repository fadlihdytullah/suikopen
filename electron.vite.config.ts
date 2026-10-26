import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const root = import.meta.dirname

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve(root, 'src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve(root, 'src/preload/index.ts') } },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(root, 'src/renderer/index.html') } },
  },
})
