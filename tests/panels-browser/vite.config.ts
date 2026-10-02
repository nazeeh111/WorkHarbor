import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repository = path.resolve(import.meta.dirname, "../..");
const ui = path.join(repository, "ui");
const { default: react } = await import(require.resolve("@vitejs/plugin-react", { paths: [ui] }));
const { default: tailwindcss } = await import(require.resolve("@tailwindcss/vite", { paths: [ui] }));

export default {
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: { alias: {
    "@": path.join(ui, "src"),
    "react": path.join(ui, "node_modules/react"),
    "react-dom": path.join(ui, "node_modules/react-dom"),
    "react-router-dom": path.join(ui, "node_modules/react-router-dom"),
    "@tanstack/react-query": path.join(ui, "node_modules/@tanstack/react-query"),
  } },
  server: { host: "127.0.0.1", port: 6138, strictPort: true, fs: { allow: [repository] } },
};
