// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 preview-features.json
// and desktop/src/shared/features/manifest.ts. This static source is bundled by
// both hosts; it is not a runtime component catalog or an authorization source.
import manifestJson from "./preview-features.json";
import type { FeatureDefinition, FeaturesManifest } from "./types";

// The fixed checked-in JSON has the original FeaturePlatform values. No
// external manifest is accepted here, and no second validation dependency is
// introduced merely to read this bundled source.
export const manifest = manifestJson as FeaturesManifest;

export const allFeatures = manifest.features;
// The fifth original switch invokes setAgentManagedProfiles, whose production
// consumer is not present. Keep its original definition, not a fake switch.
export const desktopFeatures = manifest.features.filter(
	(feature) =>
		(!feature.platforms || feature.platforms.includes("desktop")) &&
		feature.id !== "agentManagedProfiles",
);

export function getFeature(id: string): FeatureDefinition | undefined {
	return manifest.features.find((feature) => feature.id === id);
}
