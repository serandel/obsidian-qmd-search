export interface QmdSettings {
	qmdBinaryPath: string;
	host: string;
	port: number;
	collection: string;
	maxResults: number;
}

export const DEFAULT_SETTINGS: QmdSettings = {
	qmdBinaryPath: "qmd",
	host: "localhost",
	port: 0, // 0 = auto-assigned by daemon
	collection: "obsidian",
	maxResults: 20,
};

export interface QmdSearchResult {
	docid: string;
	score: number;
	file: string;
	title: string;
	context: string;
	snippet: string;
}

export type MatchType = "keyword" | "semantic";

export interface DisplayResult {
	result: QmdSearchResult;
	matchType: MatchType;
}
