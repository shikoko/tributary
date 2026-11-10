// The setup window's page, built into setup/dist for the setup program to carry.
//   npm run setup:build
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./ui", import.meta.url)),
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
  },
});
