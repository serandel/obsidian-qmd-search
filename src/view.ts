import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type QmdPlugin from "./main";
import { type DisplayResult, type MatchType, type QmdSearchResult } from "./types";
import { cleanSnippet, extractFilename, findLineInContent, extractPath, extractVaultPath, slugifyPath } from "./view-utils";

export const VIEW_TYPE_QMD_SEARCH = "qmd-search-view";

export class QmdSearchView extends ItemView {
	plugin: QmdPlugin;
	private searchInput: HTMLInputElement | null = null;
	private resultsContainer: HTMLElement | null = null;
	private results: DisplayResult[] = [];
	private matchType: MatchType = "keyword";
	private lexDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private lexAbortController: AbortController | null = null;
	private hybridAbortController: AbortController | null = null;
	private currentQuery: string = "";
	private lastFiredLexQuery: string = "";
	private errorMessage: string | null = null;
	private errorRetryType: "lex" | "hybrid" | null = null;

	private static isTimeoutError(err: unknown): boolean {
		if (!(err instanceof Error)) return false;
		return err.name === "TimeoutError" || /timed?\s*out/i.test(err.message);
	}
	private hybridButton: HTMLButtonElement | null = null;
	private lexLoading: boolean = false;
	private hybridLoading: boolean = false;
	private hybridTriggered: boolean = false;

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
				this.triggerHybridSearch();
			}
		});

		// Results container
		this.resultsContainer = container.createEl("div", {
			cls: "qmd-results-container",
		});

		this.renderEmptyState();
	}

	async onClose(): Promise<void> {
		this.cancelPendingQueries();
	}

	private onSearchInput(query: string): void {
		this.currentQuery = query.trim();

		if (!this.currentQuery) {
			this.results = [];
			this.matchType = "keyword";
			this.hybridTriggered = false;
			this.lastFiredLexQuery = "";
			this.renderResults();
			this.cancelPendingQueries();
			return;
		}

		this.errorMessage = null;
		this.errorRetryType = null;
		this.results = [];
		this.matchType = "keyword";
		this.hybridTriggered = false;
		this.hybridAbortController?.abort();

		// Debounced BM25 query (fast)
		if (this.lexDebounceTimer) clearTimeout(this.lexDebounceTimer);
		this.lexAbortController?.abort();
		this.lexDebounceTimer = setTimeout(() => {
			if (this.currentQuery === this.lastFiredLexQuery) return;
			this.lastFiredLexQuery = this.currentQuery;
			this.fireLexQuery(this.currentQuery);
		}, 300);
	}

	private triggerHybridSearch(): void {
		if (!this.currentQuery || this.hybridTriggered) return;
		this.hybridTriggered = true;
		this.hybridAbortController?.abort();
		this.hybridButton?.remove();
		this.hybridButton = null;
		// Abort lex if still in-flight — hybrid supersedes it
		this.lexAbortController?.abort();
		this.lexLoading = false;
		this.fireHybridQuery(this.currentQuery);
	}

	private async fireLexQuery(query: string): Promise<void> {
		const client = this.plugin.mcpClient;
		if (!client || !client.isConnected()) {
			if (this.plugin.mcpError) {
				this.errorMessage = this.plugin.mcpError;
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
			);
			if (query !== this.currentQuery) return; // stale
			this.results = results.map((r: QmdSearchResult) => ({
				result: r,
				matchType: "keyword" as const,
			}));
			this.matchType = "keyword";
		} catch (err) {
			if ((err as Error).name === "AbortError") return;
			console.error("[QMD] Lex query failed:", err);
			if (query !== this.currentQuery) return;
			if (QmdSearchView.isTimeoutError(err)) {
				this.errorMessage = "Search timed out — QMD may still be warming up";
				this.errorRetryType = "lex";
			} else {
				this.errorMessage = "Search failed — restarting QMD…";
				this.errorRetryType = null;
				this.renderResults();
				await this.plugin.ensureConnection();
				this.errorMessage = "Search failed";
				this.errorRetryType = "lex";
			}
		} finally {
			if (query === this.currentQuery) {
				this.lexLoading = false;
				this.renderResults();
			}
		}
	}

	private async fireHybridQuery(query: string): Promise<void> {
		const client = this.plugin.mcpClient;
		if (!client || !client.isConnected()) return; // lex already shows the status message
		this.hybridAbortController = new AbortController();
		this.hybridLoading = true;
		this.renderResults();
		try {
			const results = await client.searchHybrid(
				query,
				this.plugin.settings.collection,
				this.plugin.settings.maxResults,
			);
			if (query !== this.currentQuery) return; // stale
			this.results = results.map((r: QmdSearchResult) => ({
				result: r,
				matchType: "hybrid" as const,
			}));
			this.matchType = "hybrid";
		} catch (err) {
			if ((err as Error).name === "AbortError") return;
			console.error("[QMD] Hybrid query failed:", err);
			if (query !== this.currentQuery) return;
			if (QmdSearchView.isTimeoutError(err)) {
				this.errorMessage = "Semantic search timed out — QMD may still be warming up";
				this.errorRetryType = "hybrid";
			} else {
				this.errorMessage = "Hybrid search failed — restarting QMD…";
				this.errorRetryType = null;
				this.renderResults();
				await this.plugin.ensureConnection();
				this.errorMessage = "Semantic search failed";
				this.errorRetryType = "hybrid";
			}
		} finally {
			if (query === this.currentQuery) {
				this.hybridLoading = false;
				this.renderResults();
			}
		}
	}

	private renderResults(): void {
		if (!this.resultsContainer) return;
		this.resultsContainer.empty();

		if (this.errorMessage) {
			const errorEl = this.resultsContainer.createEl("div", {
				cls: "qmd-error",
			});
			errorEl.createEl("span", { text: this.errorMessage });
			if (this.errorRetryType) {
				const retryBtn = errorEl.createEl("button", {
					text: "Retry",
					cls: "qmd-retry-button",
				});
				const retryType = this.errorRetryType;
				retryBtn.addEventListener("click", () => {
					this.errorMessage = null;
					this.errorRetryType = null;
					if (retryType === "hybrid") {
						this.hybridTriggered = false;
						this.triggerHybridSearch();
					} else {
						this.lastFiredLexQuery = "";
						this.fireLexQuery(this.currentQuery);
					}
				});
			}
			// Show keyword results below the error if we have them
			if (this.results.length > 0 && this.matchType === "keyword") {
				const section = this.resultsContainer.createEl("div", {
					cls: "qmd-section qmd-section-keyword",
				});
				section.createEl("div", {
					cls: "qmd-section-header",
				}).createSpan({ text: `Keyword matches (${this.results.length})` });
				this.renderResultsInto(section, this.results, "keyword");
			}
			return;
		}

		if (!this.currentQuery) {
			this.renderEmptyState();
			return;
		}

		if (this.hybridLoading) {
			// Semantic spinner on top
			this.renderSpinnerInto(this.resultsContainer, "Searching semantically…");
			// Show keyword results below if we have them
			if (this.results.length > 0 && this.matchType === "keyword") {
				const section = this.resultsContainer.createEl("div", {
					cls: "qmd-section qmd-section-keyword",
				});
				section.createEl("div", {
					cls: "qmd-section-header",
				}).createSpan({ text: `Keyword matches (${this.results.length})` });
				this.renderResultsInto(section, this.results, "keyword");
			}
		} else if (this.lexLoading) {
			// Keyword spinner + button, no header
			this.renderSpinnerInto(this.resultsContainer, "Searching keywords…");
			this.renderHybridButton();
		} else if (this.results.length > 0) {
			// Show results with header
			const section = this.resultsContainer.createEl("div", {
				cls: `qmd-section qmd-section-${this.matchType}`,
			});
			const label = this.matchType === "hybrid"
				? `Matches (${this.results.length})`
				: `Keyword matches (${this.results.length})`;
			section.createEl("div", {
				cls: "qmd-section-header",
			}).createSpan({ text: label });
			this.renderResultsInto(section, this.results, this.matchType);
			if (!this.hybridTriggered) this.renderHybridButton();
		} else {
			this.resultsContainer.createEl("div", {
				text: "No results found",
				cls: "qmd-no-results",
			});
			if (!this.hybridTriggered) this.renderHybridButton();
		}
	}

	private renderHybridButton(): void {
		if (!this.resultsContainer) return;
		this.hybridButton = this.resultsContainer.createEl("button", {
			text: "Search semantically",
			cls: "qmd-hybrid-button",
		});
		this.hybridButton.addEventListener("click", () => {
			this.triggerHybridSearch();
		});
	}

	private renderSpinnerInto(parent: HTMLElement, label: string): void {
		const wrapper = parent.createEl("div", {
			cls: "qmd-spinner-wrapper",
		});
		wrapper.createEl("div", { cls: "qmd-spinner" });
		wrapper.createEl("span", { text: label, cls: "qmd-spinner-label" });
	}

	private renderEmptyState(): void {
		if (!this.resultsContainer) return;
		const wrapper = this.resultsContainer.createEl("div", {
			cls: "qmd-empty-state",
		});

		wrapper.createEl("div", {
			text: "How to search",
			cls: "qmd-empty-heading",
		});

		const tips = [
			{ label: "Type", description: "to search by keywords" },
			{ label: "Enter", description: "to also search semantically" },
			{ label: "Click", description: "a result to open the note" },
		];

		const list = wrapper.createEl("div", { cls: "qmd-empty-tips" });
		for (const tip of tips) {
			const row = list.createEl("div", { cls: "qmd-empty-tip" });
			row.createEl("kbd", { text: tip.label });
			row.createEl("span", { text: tip.description });
		}
	}

	private renderResultsInto(
		parent: HTMLElement,
		results: DisplayResult[],
		matchType: string
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
				cls: `qmd-result-score qmd-score-${matchType}`,
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
		this.hybridAbortController?.abort();
	}
}
