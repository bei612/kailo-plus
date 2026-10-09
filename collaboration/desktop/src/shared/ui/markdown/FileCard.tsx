import { FileCard as SharedFileCard } from "@client-kit/platform/react/messages";
import { invokeTauri } from "@/shared/api/tauri";

/**
 * File card for a generic (non-image, non-video) attachment: icon, filename,
 * size, and a download action.
 *
 * Downloads go through the native `download_file` Tauri command (HTTP inside
 * the app's tunnel + a save dialog), not a plain `<a download>` link. A bare
 * link navigates the webview to the blob URL, which escapes to the OS browser
 * and gets bounced to a corporate CDN interstitial ("browser not supported").
 * The native command mirrors the image-download path.
 */
export function FileCard({
  href,
  filename,
  size,
}: {
  href: string;
  filename: string;
  size?: number;
}) {
  return (
    <SharedFileCard
      href={href}
      filename={filename}
      size={size}
      onDownload={(url, filename) =>
        invokeTauri("download_file", { url, filename })
      }
    />
  );
}
