/**
 * Copies text to the clipboard with a fallback for insecure contexts.
 *
 * `navigator.clipboard` is only available in secure contexts (HTTPS or
 * localhost). When the app is reached over a LAN IP — common for the
 * self-hosted PWA — `navigator.clipboard` is `undefined`, so we fall back to a
 * hidden textarea + `document.execCommand("copy")`. Throws if both paths fail
 * so callers can surface an error toast.
 */
export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the selection-based copy path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy command was rejected");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
