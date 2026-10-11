// Browser host for the original Buzz writeTextToClipboard contract.
// Extracted from the existing Web Profile copy consumer; no permission bypass.
export async function writeTextToClipboard(value: string): Promise<void> {
  if (typeof navigator.clipboard?.writeText === "function") {
    // A denied modern request stays denied; do not retry via another API.
    await navigator.clipboard.writeText(value);
    return;
  }
  // HTTP hosts have no Clipboard API. Keep this browser-native fallback
  // synchronous inside the original click gesture, without changing CSP,
  // permissions or identity. A false return is not a successful copy.
  const previousFocus = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.tabIndex = -1;
  field.setAttribute("aria-hidden", "true");
  field.style.cssText = "position:fixed;inset:0;opacity:0;pointer-events:none";
  document.body.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard copy was refused");
  } finally {
    field.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}
