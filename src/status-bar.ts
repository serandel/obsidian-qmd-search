import type { IndexerState } from "./types";

export class QmdStatusBar {
	private lastError = "";
	private openSettings: (() => void) | null = null;
	private openSearch: (() => void) | null = null;

	constructor(private el: HTMLElement) {
		this.el.addClass("qmd-status-bar");
		this.update({ phase: "idle" });
	}

	onOpenSettings(callback: () => void): void {
		this.openSettings = callback;
	}

	onOpenSearch(callback: () => void): void {
		this.openSearch = callback;
	}

	update(state: IndexerState): void {
		switch (state.phase) {
			case "idle":
				this.el.setText("QMD \u2713");
				this.el.title = "QMD index is up to date — click to search";
				this.el.onclick = () => this.openSearch?.();
				break;
			case "updating":
				this.el.setText("QMD: Indexing\u2026");
				this.el.title = "Updating QMD index";
				this.el.onclick = null;
				break;
			case "embedding": {
				const label = state.pending > 0
					? `QMD: Embeddings (${state.pending} pending)`
					: "QMD: Embeddings\u2026";
				this.el.setText(label);
				this.el.title = "Generating vector embeddings";
				this.el.onclick = null;
				break;
			}
			case "error":
				this.el.setText("QMD: Error");
				this.el.title = state.message;
				this.lastError = state.message;
				this.el.onclick = () => this.openSettings?.();
				break;
		}
	}

	setDaemonDown(): void {
		this.el.setText("QMD \u2717");
		this.el.addClass("qmd-status-bar-down");
		this.el.title = "QMD daemon is not running — click to open settings";
		this.el.onclick = () => this.openSettings?.();
	}

	clearDaemonDown(): void {
		this.el.removeClass("qmd-status-bar-down");
	}
}
