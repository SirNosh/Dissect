import { createFileRoute } from "@tanstack/react-router";
import { DissectLanding } from "~/components/dissect-landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dissect — Understand the code your agent writes" },
      {
        name: "description",
        content:
          "Keep your coding agent. Dissect turns your actual codebase and Git changes into architecture maps and clear explanations, on demand.",
      },
      { property: "og:title", content: "Dissect — Make it make sense." },
      {
        property: "og:description",
        content:
          "The comprehension layer for your coding agent. Explore the architecture. Understand the changes. Own your code.",
      },
      { property: "og:site_name", content: "Dissect" },
      { name: "theme-color", content: "#111512" },
    ],
    links: [
      { rel: "icon", href: "/dissect.svg", type: "image/svg+xml" },
      {
        rel: "stylesheet",
        href: "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,900&display=swap",
      },
    ],
  }),
  component: DissectLanding,
});
