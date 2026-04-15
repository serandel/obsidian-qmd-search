import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type QmdPlugin from "./main";
import { type DisplayResult, type QmdSearchResult } from "./types";
import { cleanSnippet, extractFilename, findLineInContent, extractPath, extractVaultPath, slugifyPath } from "./view-utils";

export const VIEW_TYPE_QMD_SEARCH = "qmd-search-view";

export class QmdSearchView extends ItemView {
	plugin: QmdPlugin;
	private searchInput: HTMLInputElement | null = null;
	private resultsContainer: HTMLElement | null = null;
	private lexResults: DisplayResult[] = [];
	private semanticResults: DisplayResult[] = [];
	private lexDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private lexAbortController: AbortController | null = null;
	private semanticAbortController: AbortController | null = null;
	private currentQuery: string = "";
	private lastFiredLexQuery: string = "";
	private errorMessage: string | null = null;
	private semanticButton: HTMLButtonElement | null = null;
	private lexLoading: boolean = false;
	private semanticLoading: boolean = false;
	private semanticTriggered: boolean = false;
	private keywordCollapsed: boolean = false;
	private semanticCollapsed: boolean = false;

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
		return "qmd-search";
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

		this.searchInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.triggerSemanticSearch();
			}
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
			this.semanticResults = [];
			this.semanticTriggered = false;
			this.lastFiredLexQuery = "";
			this.renderResults();
			this.cancelPendingQueries();
			return;
		}

		this.errorMessage = null;
		this.semanticResults = [];
		this.semanticTriggered = false;
		this.semanticAbortController?.abort();

		// Debounced BM25 query (fast)
		if (this.lexDebounceTimer) clearTimeout(this.lexDebounceTimer);
		this.lexAbortController?.abort();
		this.lexDebounceTimer = setTimeout(() => {
			if (this.currentQuery === this.lastFiredLexQuery) return;
			this.lastFiredLexQuery = this.currentQuery;
			this.fireLexQuery(this.currentQuery);
		}, 300);
	}

	private triggerSemanticSearch(): void {
		if (!this.currentQuery || this.semanticTriggered) return;
		this.semanticTriggered = true;
		this.semanticAbortController?.abort();
		this.semanticButton?.remove();
		this.semanticButton = null;
		this.fireSemanticQuery(this.currentQuery);
	}

	private async fireLexQuery(query: string): Promise<void> {
		const client = (this.plugin as any).client;
		if (!client) {
			if ((this.plugin as any).daemonError) {
				this.errorMessage = (this.plugin as any).daemonError;
			} else {
				this.errorMessage = "QMD is starting...";
			}
			this.renderResults();
			return;
		}
		this.lexAbortController = new AbortController();
		this.lexLoading = true;
		this.renderResults();
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
		} catch (err) {
			if ((err as Error).name !== "AbortError") {
				console.error("[QMD] Lex query failed:", err);
				this.errorMessage = "Search failed — is QMD running?";
			}
		} finally {
			this.lexLoading = false;
			this.renderResults();
		}
	}

	private async fireSemanticQuery(query: string): Promise<void> {
		const client = (this.plugin as any).client;
		if (!client) return; // lex already shows the status message
		this.semanticAbortController = new AbortController();
		this.semanticLoading = true;
		this.renderResults();
		try {
			const results = await client.searchHybrid(
				query,
				this.plugin.settings.collection,
				this.plugin.settings.maxResults,
				this.semanticAbortController.signal
			);
			if (query !== this.currentQuery) return; // stale
			this.semanticResults = results.map((r: QmdSearchResult) => ({
				result: r,
				matchType: "semantic" as const,
			}));
		} catch (err) {
			if ((err as Error).name !== "AbortError") {
				console.error("[QMD] Hybrid query failed:", err);
				this.errorMessage = "Semantic search failed";
			}
		} finally {
			this.semanticLoading = false;
			this.renderResults();
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

		// Keyword section: always show header when there's a query
		if (this.currentQuery && !this.errorMessage) {
			const section = this.resultsContainer.createEl("div", {
				cls: `qmd-section qmd-section-keyword${this.keywordCollapsed ? " is-collapsed" : ""}`,
			});
			const keywordHeader = section.createEl("div", {
				cls: "qmd-section-header",
			});
			keywordHeader.createEl("span", {
				cls: "qmd-section-chevron",
				text: "›",
			});
			const keywordLabel = this.lexLoading
				? "Keyword matches"
				: `Keyword matches (${this.lexResults.length})`;
			keywordHeader.createSpan({ text: keywordLabel });
			keywordHeader.addEventListener("click", () => {
				this.keywordCollapsed = !this.keywordCollapsed;
				section.toggleClass("is-collapsed", this.keywordCollapsed);
			});

			if (this.lexLoading) {
				this.renderSpinnerInto(section, "Searching keywords…");
			} else if (this.lexResults.length > 0) {
				this.renderResultsInto(section, this.lexResults);
			} else {
				section.createEl("div", {
					text: "No results found",
					cls: "qmd-no-results",
				});
			}
		}

		// Semantic section: button, or header with spinner/results/no-results
		if (this.semanticTriggered && this.currentQuery && !this.errorMessage) {
			const section = this.resultsContainer.createEl("div", {
				cls: `qmd-section qmd-section-semantic${this.semanticCollapsed ? " is-collapsed" : ""}`,
			});
			const semanticHeader = section.createEl("div", {
				cls: "qmd-section-header",
			});
			semanticHeader.createEl("span", {
				cls: "qmd-section-chevron",
				text: "›",
			});
			const semanticLabel = this.semanticLoading
				? "Semantic matches"
				: `Semantic matches (${this.semanticResults.length})`;
			semanticHeader.createSpan({ text: semanticLabel });
			semanticHeader.addEventListener("click", () => {
				this.semanticCollapsed = !this.semanticCollapsed;
				section.toggleClass("is-collapsed", this.semanticCollapsed);
			});

			if (this.semanticLoading) {
				this.renderSpinnerInto(section, "Searching semantically…");
			} else if (this.semanticResults.length > 0) {
				this.renderResultsInto(section, this.semanticResults, "semantic");
			} else {
				section.createEl("div", {
					text: "No results found",
					cls: "qmd-no-results",
				});
			}
		} else if (this.currentQuery && !this.errorMessage) {
			this.semanticButton = this.resultsContainer.createEl("button", {
				text: "Search semantically",
				cls: "qmd-semantic-button",
			});
			this.semanticButton.addEventListener("click", () => {
				this.triggerSemanticSearch();
			});
		}
	}

	private renderSpinnerInto(parent: HTMLElement, label: string): void {
		const wrapper = parent.createEl("div", {
			cls: "qmd-spinner-wrapper",
		});
		wrapper.createEl("div", { cls: "qmd-spinner" });
		wrapper.createEl("span", { text: label, cls: "qmd-spinner-label" });
	}

	private renderResultsInto(
		parent: HTMLElement,
		results: DisplayResult[],
		matchType?: string
	): void {
		for (const { result } of results) {
			const item = parent.createEl("div", {
				cls: "qmd-result-item",
			});

			const header = item.createEl("div", { cls: "qmd-result-header" });
			header.createEl("span", {
				text: result.title || extractFilename(result.file),
				cls: "qmd-result-title",
			});
			header.createEl("span", {
				text: result.score.toFixed(2),
				cls: `qmd-result-score qmd-score-${matchType ?? "keyword"}`,
			});

			// Snippet
			if (result.snippet) {
				const snippetText = cleanSnippet(result.snippet);
				if (snippetText) {
					item.createEl("div", {
						text: snippetText,
						cls: "qmd-result-snippet",
					});
				}
			}

			// Path
			item.createEl("div", {
				text: extractPath(result.file),
				cls: "qmd-result-path",
			});

			// Click to open
			item.addEventListener("click", () => {
				this.openResult(result);
			});
		}
	}

	private async openResult(result: QmdSearchResult): Promise<void> {
		const vaultPath = extractVaultPath(result.file);
		if (!vaultPath) {
			console.error("[QMD] Could not extract vault path from:", result.file);
			new Notice(`QMD: Could not resolve file path: ${result.file}`);
			return;
		}

		const file = this.findVaultFile(vaultPath);
		if (!file) {
			console.error("[QMD] File not found in vault:", vaultPath);
			new Notice(`QMD: File not found in vault: ${vaultPath}`);
			return;
		}

		const content = await this.app.vault.cachedRead(file);
		const line = findLineInContent(content, result.snippet);

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);

		if (line !== null) {
			setTimeout(() => {
				const view = leaf.view as any;
				if (view?.editor) {
					view.editor.setCursor({ line, ch: 0 });
					view.editor.scrollIntoView(
						{ from: { line, ch: 0 }, to: { line, ch: 0 } },
						true
					);
				}
			}, 50);
		}
	}

	/** Find a vault file by path, falling back to slug-based matching
	 *  when QMD returns slugified paths that don't match the filesystem. */
	private findVaultFile(vaultPath: string): TFile | null {
		// Direct match first
		const direct = this.app.vault.getAbstractFileByPath(vaultPath);
		if (direct instanceof TFile) return direct;

		// Slug-based fallback: compare slugified vault paths against the slugified QMD path
		const slugTarget = slugifyPath(vaultPath);
		const allFiles = this.app.vault.getFiles();
		return allFiles.find((f) => slugifyPath(f.path) === slugTarget) ?? null;
	}

	private cancelPendingQueries(): void {
		if (this.lexDebounceTimer) clearTimeout(this.lexDebounceTimer);
		this.lexAbortController?.abort();
		this.semanticAbortController?.abort();
	}
}
