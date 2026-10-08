// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/focusedThreadCloseRequest.ts.
const listeners = new Set<() => void>();
export function requestFocusedThreadClose(): void {
	for (const listener of listeners) listener();
}
export function subscribeToFocusedThreadCloseRequest(
	listener: () => void,
): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
