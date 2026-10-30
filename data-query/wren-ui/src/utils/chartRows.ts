// The chart renders from the rows the preview actually returned (query.data):
// a governed receipt carries them as receipt.data, while a non-governed native
// preview carries them only as independent rows with no platform receipt.
// Gating on receipt.data hid every chart in the non-governed deployment
// (acceptance batch 5).
export function chartRowsReady(query: {
  completed?: boolean;
  data?: { data?: unknown[]; columns?: unknown[] } | null;
}): boolean {
  return (
    !!query.completed &&
    Array.isArray(query.data?.data) &&
    Array.isArray(query.data?.columns)
  );
}
