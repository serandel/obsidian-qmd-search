import { addIcon, Notice, Plugin, type TAbstractFile } from "obsidian";
import { QmdSettingsTab } from "./settings";
import { QmdDaemonManager } from "./daemon";
import { QmdClient } from "./client";
import { QmdIndexer } from "./indexer";
import { QmdStatusBar } from "./status-bar";
import { QmdSearchView, VIEW_TYPE_QMD_SEARCH } from "./view";
import { DEFAULT_SETTINGS, type QmdSettings } from "./types";

const QMD_ICON = "qmd-search";
const QMD_ICON_SVG = `<circle cx="46" cy="46" r="33" fill="none" stroke="currentColor" stroke-width="6"/><line x1="52" y1="52" x2="88" y2="88" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>`;

export default class QmdPlugin extends Plugin {
	settings: QmdSettings = DEFAULT_SETTINGS;
	daemon: QmdDaemonManager | null = null;
	client: QmdClient | null = null;
	indexer: QmdIndexer | null = null;
	daemonReady = false;
	daemonError: string | null = null;
	private statusBar: QmdStatusBar | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	async onload() {
		await this.loadSettings();

		addIcon(QMD_ICON, QMD_ICON_SVG);

		// Status bar
		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new QmdStatusBar(statusBarEl);
		this.statusBar.onOpenSettings(() => {
			(this.app as any).setting.open();
			(this.app as any).setting.openTabById(this.manifest.id);
		});

		// Indexer
		this.indexer = new QmdIndexer(this.settings.qmdBinaryPath, this.settings.niceLevel);
		this.indexer.onStateChange((state) => this.statusBar!.update(state));

		// Register view
		this.registerView(VIEW_TYPE_QMD_SEARCH, (leaf) => new QmdSearchView(leaf, this));

		// Activate view in left sidebar when layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.activateView();
		});

		// Commands
		this.addCommand({
			id: "open-qmd-search",
			name: "Open QMD Search",
			callback: () => {
				this.activateView();
			},
		});

		this.addCommand({
			id: "update-index",
			name: "Update index",
			callback: () => {
				this.indexer?.requestUpdate();
			},
		});

		this.addCommand({
			id: "generate-embeddings",
			name: "Generate embeddings",
			callback: () => {
				this.indexer?.requestEmbeddings();
			},
		});

		// Auto-update on file changes
		if (this.settings.autoUpdate) {
			this.registerFileWatcher();
		}

		// Settings tab
		this.addSettingTab(new QmdSettingsTab(this.app, this));

		// Start daemon in background — don't block plugin load
		this.startDaemon();
	}

	onunload() {
		this.shuttingDown = true;
		this.indexer?.cancel();
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.daemon?.stop();
	}

	private shuttingDown = false;
	private restartAttempts = 0;
	private readonly MAX_RESTART_ATTEMPTS = 3;

	private registerFileWatcher(): void {
		const handler = (_file: TAbstractFile) => {
			if (this.debounceTimer) clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(() => {
				console.log("[QMD] File change debounce fired, requesting update");
				this.indexer?.requestUpdate();
			}, this.settings.debounceDelayMs);
		};

		this.registerEvent(this.app.vault.on("create", handler));
		this.registerEvent(this.app.vault.on("modify", handler));
		this.registerEvent(this.app.vault.on("delete", handler));
		this.registerEvent(this.app.vault.on("rename", handler));
	}

	private async startDaemon(): Promise<void> {
		this.daemonReady = false;
		this.daemonError = null;
		try {
			const pluginDir = `${(this.app.vault.adapter as any).basePath}/.obsidian/plugins/${this.manifest.id}`;

			this.daemon = new QmdDaemonManager(pluginDir, this.settings.qmdBinaryPath, this.settings.niceLevel);
			const port = await this.daemon.start();

			this.client = new QmdClient(this.settings.host, port);
			this.daemonReady = true;
			this.restartAttempts = 0;
			this.statusBar?.clearDaemonDown();

			// Monitor for unexpected exit and auto-restart
			this.daemon.onExit(() => {
				if (!this.shuttingDown) {
					console.warn("[QMD] Daemon exited unexpectedly");
					this.statusBar?.setDaemonDown();
					this.attemptRestart();
				}
			});

			// Async warmup — don't block. Run initial index update after warmup
			// completes so they don't compete for GPU resources.
			this.daemon.warmup(this.client, this.settings.collection)
				.then(() => this.indexer?.requestUpdate())
				.catch(() => this.indexer?.requestUpdate());

			console.log(`[QMD] Daemon started on port ${port}`);
		} catch (err) {
			console.error("[QMD] Failed to start daemon:", err);
			this.daemonError = "Could not start QMD. Check that qmd is installed.";
			this.statusBar?.setDaemonDown();
			new Notice(
				"QMD Search: Could not start QMD daemon. Check that qmd is installed and on your PATH.",
				10000
			);
		}
	}

	async ensureDaemon(): Promise<void> {
		if (this.daemon?.isRunning()) return;
		console.log("[QMD] Daemon not running, restarting on demand");
		this.restartAttempts = 0;
		await this.startDaemon();
	}

	private async attemptRestart(): Promise<void> {
		this.restartAttempts++;
		if (this.restartAttempts > this.MAX_RESTART_ATTEMPTS) {
			new Notice("QMD Search: Daemon keeps crashing. Please restart Obsidian or check QMD.", 10000);
			return;
		}
		console.log(`[QMD] Attempting restart (${this.restartAttempts}/${this.MAX_RESTART_ATTEMPTS})`);
		await this.startDaemon();
	}

	private async activateView(): Promise<void> {
		console.log("[QMD] activateView called");
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_QMD_SEARCH);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]!);
			return;
		}

		const leaf = this.app.workspace.getLeftLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_QMD_SEARCH,
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
