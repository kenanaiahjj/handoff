import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/workspace",
    name: "Asbir Handoff",
    short_name: "Asbir Handoff",
    description: "Review versioned design handoffs with your team.",
    start_url: "/workspace",
    scope: "/",
    display: "standalone",
    background_color: "#202020",
    theme_color: "#202020",
    categories: ["productivity"],
    icons: [
      {
        src: "/icons/asbir-handoff-v3-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/asbir-handoff-v3-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/asbir-handoff-v3-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
