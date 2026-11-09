import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  build: {
    rolldownOptions: {
      output: {
        // The libraries in files of their own, apart from the app's code.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "highlight", test: /node_modules[\\/]highlight\.js[\\/]/ },
            { name: "tauri", test: /node_modules[\\/]@tauri-apps[\\/]/ },
          ],
        },
      },
    },
    // The 3D model viewer is about 720 kB, nearly all three.js, which can't be made much
    // smaller; it's only loaded when a model is shown, from disk. Everything else is well
    // under the usual 500 kB.
    chunkSizeWarningLimit: 750,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
