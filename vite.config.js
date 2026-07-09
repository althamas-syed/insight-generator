import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// If deploying to GitHub Pages under a repo subpath (e.g. username.github.io/insight-generator),
// uncomment and set base to "/insight-generator/". Vercel/Netlify don't need this — leave as "/".
export default defineConfig({
  plugins: [react()],
  base: "/",
});
