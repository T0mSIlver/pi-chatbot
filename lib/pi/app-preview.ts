// CDN origins that showcased HTML apps may load scripts, styles, and fonts
// from. Referenced both by the preview CSP (workspace app route) and by the
// showcase_file prompt guidelines, so the agent only reaches for CDNs the
// policy actually allows.
export const APP_PREVIEW_CDN_HOSTS = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://cdn.skypack.dev",
  "https://cdn.tailwindcss.com",
  "https://code.jquery.com",
  "https://d3js.org",
  "https://cdn.plot.ly",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

const cdnHosts = APP_PREVIEW_CDN_HOSTS.join(" ");

export const APP_PREVIEW_CSP = [
  "default-src 'none'",
  `script-src 'self' 'unsafe-inline' ${cdnHosts}`,
  `style-src 'self' 'unsafe-inline' ${cdnHosts}`,
  "img-src 'self' data: blob: https:",
  `font-src 'self' data: ${cdnHosts}`,
  "media-src 'self' data: blob:",
  // Lets CDN-hosted libraries fetch their own assets (wasm, workers, data
  // chunks); everything else stays unreachable.
  `connect-src 'self' ${cdnHosts}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");
