import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const pagesRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Static export of the Dissect landing page for GitHub project Pages.
 * The live site stays on Cloudflare (`vite.config.ts`). This build only
 * prerenders `/` and serves it from https://sirnosh.github.io/Dissect/.
 */
export default defineConfig((): UserConfig => {
  return {
    base: "/Dissect/",
    resolve: {
      alias: {
        "cloudflare:workers": path.resolve(pagesRoot, "cloudflare-workers.pages.ts"),
      },
      dedupe: ["react", "react-dom"],
    },
    ssr: {
      // These packages are hoisted to the repo root, so Node would load a
      // second React from there during prerender. Bundle them so their React
      // import is the website copy.
      noExternal: ["@gsap/react", "lucide-react"],
    },
    plugins: [
      tsConfigPaths(),
      tanstackStart({
        pages: [{ path: "/" }],
        sitemap: {
          enabled: false,
        },
        prerender: {
          enabled: true,
          crawlLinks: false,
          autoStaticPathsDiscovery: false,
        },
        router: {
          basepath: "/Dissect",
          quoteStyle: "double",
          semicolons: true,
        },
      }),
      react(),
      tailwindcss(),
    ],
  };
});
