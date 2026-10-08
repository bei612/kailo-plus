// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/features/store.ts.
import { manifest } from "./manifest";

export const OVERRIDES_KEY = `buzz-feature-overrides-v${manifest.version}`;
export type FeatureOverrides = Record<string, boolean>;

export function getOverrides(): FeatureOverrides {
	try {
		const raw = window.localStorage.getItem(OVERRIDES_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		const featureIds = new Set(manifest.features.map((feature) => feature.id));
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, boolean] =>
					featureIds.has(entry[0]) && typeof entry[1] === "boolean",
			),
		);
	} catch {
		return {};
	}
}

export function setOverride(featureId: string, enabled: boolean): void {
	const overrides = getOverrides();
	overrides[featureId] = enabled;
	window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

export function clearOverride(featureId: string): void {
	const overrides = getOverrides();
	delete overrides[featureId];
	window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}
