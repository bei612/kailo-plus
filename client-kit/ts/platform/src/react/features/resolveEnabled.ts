// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/features/resolveEnabled.ts.
export function resolveEnabled(
	featureId: string,
	overrides: Record<string, boolean>,
	defaultEnabled = false,
): boolean {
	return overrides[featureId] ?? defaultEnabled;
}
