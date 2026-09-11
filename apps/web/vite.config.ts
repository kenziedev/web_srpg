import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Opt in when native file watching hangs on a local filesystem.
    watch:
      process.env.CHOKIDAR_USEPOLLING === "1"
        ? { usePolling: true }
        : undefined,
  },
});
