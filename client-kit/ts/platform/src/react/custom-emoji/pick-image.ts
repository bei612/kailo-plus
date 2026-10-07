// Browser/WebView file selection is only a host adapter; the upload remains
// the existing captured-identity Blossom path in each host.
export function pickEmojiImage(upload: (bytes: number[]) => Promise<{ url: string; type: string }>) {
  return new Promise<Array<{ url: string; type: string; filename: string }>>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/gif,image/png,image/jpeg,image/webp";
    input.addEventListener("cancel", () => { input.remove(); resolve([]); }, { once: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) { resolve([]); return; }
      void file.arrayBuffer().then((bytes) => upload(Array.from(new Uint8Array(bytes))))
        .then((descriptor) => resolve([{ ...descriptor, filename: file.name }]), reject);
    }, { once: true });
    input.click();
  });
}
