/**
 * First 4 hex chars of the sha256 — used as a short display name.
 * Note: 4 hex chars = 65,536 possible values. Collision is unlikely
 * within a single message's attachments but theoretically possible.
 * If collisions become an issue, extend to 6+ chars.
 */
export function shortHash(sha256: string): string {
  return sha256.slice(0, 4);
}

export type UploadingAttachmentPreview = {
  id: number;
  dim?: string;
  filename?: string;
  posterUrl?: string;
  /** Upload progress 0–100, or null while no byte counts exist yet
   * (e.g. video transcoding before the HTTP upload starts). */
  progress?: number | null;
  slotIndex?: number;
  spoilered?: boolean;
  type?: string;
  /**
   * Upload epoch this preview was created in. Cancel handling compares it
   * against the current epoch so a preview left over from a replaced draft
   * cannot null a slot belonging to the draft now on screen.
   */
  uploadEpoch?: number;
};
