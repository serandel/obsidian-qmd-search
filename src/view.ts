import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type QmdPlugin from "./main";
import { type DisplayResult, type QmdSearchResult } from "./types";

export const VIEW_TYPE_QMD_SEARCH = "qmd-search-view";

export class QmdSearchView extends ItemView {
	plugin: QmdPlugin;
	private searchInput: HTMLInputElement | null = null;
	private resultsContainer: HTMLElement | null = null;
	private lexResults: DisplayResult[] = [];
	private hybridResults: DisplayResult[] = [];
	private lexDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private hybridDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private lexAbortController: AbortController | null = null;
	private hybridAbortController: AbortController | null = null;
	private currentQuery: string = "";
	private errorMessage: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: QmdPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_QMD_SEARCH;
	}

	getDisplayText(): string {
		return "QMD Search";
	}

	getIcon(): string {
		return "search";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1]!;
		container.empty();
		container.addClass("qmd-search-container");

		// Search input
		this.searchInput = container.createEl("input", {
			type: "text",
			placeholder: "Search notes...",
			cls: "qmd-search-input",
		});

		this.searchInput.addEventListener("input", () => {
			this.onSearchInput(this.searchInput!.value);
		});

		// Results container
		this.resultsContainer = container.createEl("div", {
			cls: "qmd-results-container",
		});
	}

	async onClose(): Promise<void> {
		this.cancelPendingQueries();
	}

	private onSearchInput(query: string): void {
		this.currentQuery = query.trim();

		if (!this.currentQuery) {
			this.lexResults = [];
			this.hybridResults = [];
			this.renderResults();
			this.cancelPendingQueries();
			return;
		}

		this.errorMessage = null;

		// Debounced BM25 query (fast)
		if (this.lexDebounceTimer) clearTimeout(this.lexDebounceTimer);
		this.lexAbortController?.abort();
		this.lexDebounceTimer = setTimeout(() => {
			this.fireLexQuery(this.currentQuery);
		}, 150);

		// Debounced hybrid query (slower)
		if (this.hybridDebounceTimer) clearTimeout(this.hybridDebounceTimer);
		this.hybridAbortController?.abort();
		this.hybridDebounceTimer = setTimeout(() => {
			this.fireHybridQuery(this.currentQuery);
		}, 800);
	}

	private async fireLexQuery(query: string): Promise<void> {
		const client = (this.plugin as any).client;
		if (!client) return;
		this.lexAbortController = new AbortController();
		try {
			const results = await client.searchLex(
				query,
				this.plugin.settings.collection,
				this.plugin.settings.maxResults,
				this.lexAbortController.signal
			);
			if (query !== this.currentQuery) return; // stale
			this.lexResults = results.map((r: QmdSearchResult) => ({
				result: r,
				matchType: "keyword" as const,
			}));
			this.renderResults();
		} catch (err) {
			if ((err as Error).name !== "AbortError") {
				console.error("[QMD] Lex query failed:", err);
				this.errorMessage = "Search failed — is QMD running?";
				this.renderResults();
			}
		}
	}

	private async fireHybridQuery(query: string): Promise<void> {
		const client = (this.plugin as any).client;
		if (!client) return;
		this.hybridAbortController = new AbortController();
		try {
			const results = await client.searchHybrid(
				query,
				this.plugin.settings.collection,
				this.plugin.settings.maxResults,
				this.hybridAbortController.signal
			);
			if (query !== this.currentQuery) return; // stale
			this.hybridResults = results.map((r: QmdSearchResult) => ({
				result: r,
				matchType: "semantic" as const,
			}));
			this.renderResults();
		} catch (err) {
			if ((err as Error).name !== "AbortError") {
				console.error("[QMD] Hybrid query failed:", err);
				this.errorMessage = "Semantic search failed";
				this.renderResults();
			}
		}
	}

	private renderResults(): void {
		if (!this.resultsContainer) return;
		this.resultsContainer.empty();

		// Show error if any
		if (this.errorMessage) {
			this.resultsContainer.createEl("div", {
				text: this.errorMessage,
				cls: "qmd-error",
			});
		}

		if (this.lexResults.length === 0 && this.hybridResults.length === 0) {
			if (this.currentQuery && !this.errorMessage) {
				this.resultsContainer.createEl("div", {
					text: "No results found",
					cls: "qmd-no-results",
				});
			}
			return;
		}

		// Keyword matches section
		if (this.lexResults.length > 0) {
			this.renderSection("Keyword matches", this.lexResults, "keyword");
		}

		// Semantic matches section
		if (this.hybridResults.length > 0) {
			this.renderSection("Semantic matches", this.hybridResults, "semantic");
		}
	}

	private renderSection(
		title: string,
		results: DisplayResult[],
		matchType: string
	): void {
		if (!this.resultsContainer) return;

		const section = this.resultsContainer.createEl("div", {
			cls: `qmd-section qmd-section-${matchType}`,
		});

		section.createEl("div", {
			text: title,
			cls: "qmd-section-header",
		});

		for (const { result } of results) {
			const item = section.createEl("div", {
				cls: "qmd-result-item",
			});

			const header = item.createEl("div", { cls: "qmd-result-header" });
			header.createEl("span", {
				text: result.title || this.extractFilename(result.file),
				cls: "qmd-result-title",
			});
			header.createEl("span", {
				text: result.score.toFixed(2),
				cls: `qmd-result-score qmd-score-${matchType}`,
			});

			// Snippet
			if (result.snippet) {
				const snippetText = this.cleanSnippet(result.snippet);
				if (snippetText) {
					item.createEl("div", {
						text: snippetText,
						cls: "qmd-result-snippet",
					});
				}
			}

			// Path
			item.createEl("div", {
				text: this.extractPath(result.file),
				cls: "qmd-result-path",
			});

			// Click to open
			item.addEventListener("click", () => {
				this.openResult(result);
			});
		}
	}

	private async openResult(result: QmdSearchResult): Promise<void> {
		// Extract vault-relative path from qmd:// URI
		const vaultPath = this.extractVaultPath(result.file);
		if (!vaultPath) return;

		const file = this.app.vault.getAbstractFileByPath(vaultPath);
		if (!(file instanceof TFile)) return;

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);

		// Try to scroll to matching line
		const line = this.extractLineFromSnippet(result.snippet);
		if (line !== null) {
			const view = leaf.view as any;
			if (view?.editor) {
				view.editor.setCursor({ line, ch: 0 });
				view.editor.scrollIntoView(
					{ from: { line, ch: 0 }, to: { line, ch: 0 } },
					true
				);
			}
		}
	}

	private extractVaultPath(qmdFile: string): string | null {
		// qmd://obsidian/path/to/note.md → path/to/note.md
		const match = qmdFile.match(/^qmd:\/\/[^/]+\/(.+)$/);
		return match?.[1] ?? null;
	}

	private extractLineFromSnippet(snippet: string): number | null {
		// @@ -6,4 @@ (5 before, 2 after) → line 6
		const match = snippet.match(/^@@ -(\d+)/);
		if (match) {
			return parseInt(match[1]!, 10) - 1; // 0-indexed
		}
		return null;
	}

	private cleanSnippet(snippet: string): string {
		// Remove the @@ header line
		return snippet.replace(/^@@[^\n]*\n/, "").trim();
	}

	private extractFilename(file: string): string {
		return file.split("/").pop()?.replace(/\.md$/, "") ?? file;
	}

	private extractPath(file: string): string {
		const vaultPath = this.extractVaultPath(file);
		if (!vaultPath) return file;
		// Remove filename, show directory path
		const parts = vaultPath.split("/");
		parts.pop();
		return parts.join("/") || "/";
	}

	private cancelPendingQueries(): void {
		if (this.lexDebounceTimer) clearTimeout(this.lexDebounceTimer);
		if (this.hybridDebounceTimer) clearTimeout(this.hybridDebounceTimer);
		this.lexAbortController?.abort();
		this.hybridAbortController?.abort();
	}
}
