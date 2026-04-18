export interface QmdSettings {
	qmdBinaryPath: string;
	collection: string;
	maxResults: number;
	autoIndexOnStartup: boolean;
	autoUpdate: boolean;
	debounceDelayMs: number;
	niceLevel: number;
}

export const DEFAULT_SETTINGS: QmdSettings = {
	qmdBinaryPath: "qmd",
	collection: "obsidian",
	maxResults: 20,
	autoIndexOnStartup: true,
	autoUpdate: true,
	debounceDelayMs: 5000,
	niceLevel: 10,
};

export type IndexerState =
	| { phase: "idle" }
	| { phase: "updating" }
	| { phase: "embedding"; pending: number }
	| { phase: "error"; message: string };

export interface QmdSearchResult {
	docid: string;
	score: number;
	file: string;
	title: string;
	context: string;
	snippet: string;
}

export type MatchType = "keyword" | "hybrid";

export interface DisplayResult {
	result: QmdSearchResult;
	matchType: MatchType;
}
