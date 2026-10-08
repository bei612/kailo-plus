// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/features/types.ts.
export type FeaturePlatform = "desktop" | "mobile";

export interface FeatureDefinition {
	id: string;
	name: string;
	description: string;
	defaultEnabled?: boolean;
	platforms?: FeaturePlatform[];
}

export interface FeaturesManifest {
	version: number;
	features: FeatureDefinition[];
}
