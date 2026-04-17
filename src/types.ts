export interface QmdSettings {
	qmdBinaryPath: string;
	host: string;
	port: number;
	collection: string;
	maxResults: number;
	autoUpdate: boolean;
	debounceDelayMs: number;
	niceLevel: number;
}

export const DEFAULT_SETTINGS: QmdSettings = {
	qmdBinaryPath: "qmd",
	host: "localhost",
	port: 0, // 0 = auto-assigned by daemon
	collection: "obsidian",
	maxResults: 20,
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
