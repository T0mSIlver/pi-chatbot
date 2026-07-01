export function previewToolOutput(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
  if (text.length <= 8000) {
    return value;
  }
  return `${text.slice(0, 8000)}\n\n[truncated for display]`;
}
