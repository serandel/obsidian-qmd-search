import { Notice, Plugin } from "obsidian";
import { QmdSettingsTab } from "./settings";
import { QmdDaemonManager } from "./daemon";
import { QmdClient } from "./client";
import { QmdSearchView, VIEW_TYPE_QMD_SEARCH } from "./view";
import { DEFAULT_SETTINGS, type QmdSettings } from "./types";

export default class QmdPlugin extends Plugin {
	settings: QmdSettings = DEFAULT_SETTINGS;
	daemon: QmdDaemonManager | null = null;
	client: QmdClient | null = null;
	daemonReady = false;
	daemonError: string | null = null;

	async onload() {
		await this.loadSettings();

		// Register view
		this.registerView(VIEW_TYPE_QMD_SEARCH, (leaf) => new QmdSearchView(leaf, this));

		// Ribbon icon to open search
		this.addRibbonIcon("search", "QMD Search", async () => {
			console.log("[QMD] Ribbon icon clicked");
			await this.activateView();
		});

		// Command to open search
		this.addCommand({
			id: "open-qmd-search",
			name: "Open QMD Search",
			callback: () => {
				this.activateView();
			},
		});

		// Settings tab
		this.addSettingTab(new QmdSettingsTab(this.app, this));

		// Start daemon in background — don't block plugin load
		this.startDaemon();
	}

	onunload() {
		this.shuttingDown = true;
		this.daemon?.stop();
	}

	private shuttingDown = false;
	private restartAttempts = 0;
	private readonly MAX_RESTART_ATTEMPTS = 3;

	private async startDaemon(): Promise<void> {
		this.daemonReady = false;
		this.daemonError = null;
		try {
			const pluginDir = `${(this.app.vault.adapter as any).basePath}/.obsidian/plugins/${this.manifest.id}`;

			this.daemon = new QmdDaemonManager(pluginDir, this.settings.qmdBinaryPath);
			const port = await this.daemon.start();

			this.client = new QmdClient(this.settings.host, port);
			this.daemonReady = true;
			this.restartAttempts = 0;

			// Monitor for unexpected exit and auto-restart
			this.daemon.onExit(() => {
				if (!this.shuttingDown) {
					console.warn("[QMD] Daemon exited unexpectedly");
					this.attemptRestart();
				}
			});

			// Async warmup — don't block
			this.daemon.warmup(this.client, this.settings.collection).catch(() => {});

			console.log(`[QMD] Daemon started on port ${port}`);
		} catch (err) {
			console.error("[QMD] Failed to start daemon:", err);
			this.daemonError = "Could not start QMD. Check that qmd is installed.";
			new Notice(
				"QMD Search: Could not start QMD daemon. Check that qmd is installed and on your PATH.",
				10000
			);
		}
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
