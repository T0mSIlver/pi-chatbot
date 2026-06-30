import type { MetadataRoute } from "next";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const withBasePath = (path: string) => `${BASE_PATH}${path}`;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pi Chatbot",
    short_name: "Pi Chat",
    description:
      "Chat with AI, inspect tool runs, and work with generated files.",
    start_url: withBasePath("/"),
    scope: withBasePath("/"),
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "browser"],
    background_color: "#fafafa",
    theme_color: "#ffffff",
    orientation: "portrait-primary",
    categories: ["productivity", "utilities"],
    screenshots: [
      {
        src: withBasePath("/preview.png"),
        sizes: "1400x900",
        type: "image/png",
        form_factor: "wide",
      },
    ],
    icons: [
      {
        src: withBasePath("/icons/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: withBasePath("/icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: withBasePath("/icons/maskable-icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
