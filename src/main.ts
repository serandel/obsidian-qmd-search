import { addIcon, type EventRef, Notice, Plugin, type TAbstractFile } from "obsidian";
import { QmdSettingsTab } from "./settings";
import { QmdMcpClient } from "./mcp-client";
import { QmdIndexer } from "./indexer";
import { QmdStatusBar } from "./status-bar";
import { QmdSearchView, VIEW_TYPE_QMD_SEARCH } from "./view";
import { DEFAULT_SETTINGS, type QmdSettings } from "./types";
import { checkPrerequisites, type CollectionInfo } from "./prerequisite-checker";
import {
	QmdNotFoundModal,
	CollectionChooserModal,
	ReadyToIndexModal,
} from "./onboarding-modals";

const QMD_ICON = "qmd-search";
const QMD_ICON_SVG = `<circle cx="46" cy="46" r="33" fill="none" stroke="currentColor" stroke-width="6"/><line x1="52" y1="52" x2="88" y2="88" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>`;

export default class QmdPlugin extends Plugin {
	settings: QmdSettings = DEFAULT_SETTINGS;
	mcpClient: QmdMcpClient | null = null;
	indexer: QmdIndexer | null = null;
	mcpConnected = false;
	mcpError: string | null = null;
	private statusBar: QmdStatusBar | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private fileWatcherRefs: EventRef[] = [];

	async onload() {
		await this.loadSettings();

		addIcon(QMD_ICON, QMD_ICON_SVG);

		// Status bar
		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new QmdStatusBar(statusBarEl);
		this.statusBar.onOpenSettings(() => this.openSettings());
		this.statusBar.onRecheck(() => this.runPrerequisiteCheck());
		this.statusBar.onOpenSearch(() => this.activateView());

		// Indexer (MCP client set after connection)
		this.indexer = new QmdIndexer(this.settings.qmdBinaryPath, this.settings.niceLevel, null);
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

		// Connect MCP client in background — don't block plugin load
		this.connectMcp();
	}

	onunload() {
		this.shuttingDown = true;
		this.indexer?.cancel();
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.mcpClient?.close();
	}

	private shuttingDown = false;
	private restartAttempts = 0;
	private readonly MAX_RESTART_ATTEMPTS = 3;

	registerFileWatcher(): void {
		if (this.fileWatcherRefs.length > 0) return; // already registered

		const handler = (_file: TAbstractFile) => {
			if (this.debounceTimer) clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(() => {
				console.log("[QMD] File change debounce fired, requesting update");
				this.indexer?.requestUpdate();
			}, this.settings.debounceDelayMs);
		};

		this.fileWatcherRefs.push(
			this.app.vault.on("create", handler),
			this.app.vault.on("modify", handler),
			this.app.vault.on("delete", handler),
			this.app.vault.on("rename", handler),
		);
		for (const ref of this.fileWatcherRefs) {
			this.registerEvent(ref);
		}
	}

	unregisterFileWatcher(): void {
		for (const ref of this.fileWatcherRefs) {
			this.app.vault.offref(ref);
		}
		this.fileWatcherRefs = [];
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private async connectMcp(): Promise<void> {
		this.mcpConnected = false;
		this.mcpError = null;
		try {
			this.mcpClient = new QmdMcpClient(this.settings.qmdBinaryPath, this.settings.niceLevel);

			this.mcpClient.onClose(() => {
				if (!this.shuttingDown) {
					console.warn("[QMD] MCP connection closed unexpectedly");
					this.mcpConnected = false;
					this.indexer?.setMcpClient(null);
					this.statusBar?.setDaemonDown();
					this.attemptRestart();
				}
			});

			await this.mcpClient.connect();

			this.mcpConnected = true;
			this.restartAttempts = 0;
			this.indexer?.setMcpClient(this.mcpClient);
			this.statusBar?.clearDaemonDown();

			console.log("[QMD] MCP client connected");

			// Run prerequisite check, then proceed with warmup/indexing
			await this.runPrerequisiteCheck();
		} catch (err) {
			console.error("[QMD] Failed to connect MCP client:", err);
			this.mcpError = "Could not start QMD. Check that qmd is installed.";
			this.statusBar?.setDaemonDown();
			new QmdNotFoundModal(this.app, () => this.openSettings()).open();
		}
	}

	async runPrerequisiteCheck(): Promise<void> {
		const vaultPath = (this.app.vault.adapter as any).basePath as string;
		const result = await checkPrerequisites(
			this.settings.qmdBinaryPath,
			vaultPath,
			this.mcpConnected,
		);

		console.log("[QMD] Prerequisite check result:", result.status);

		switch (result.status) {
			case "ready":
				// Auto-update collection setting if it differs
				if (this.settings.collection !== result.collection) {
					this.settings.collection = result.collection;
					await this.saveSettings();
					console.log(`[QMD] Auto-selected collection: ${result.collection}`);
				}
				this.startWarmupAndIndex();
				break;

			case "binary-missing":
				new QmdNotFoundModal(this.app, () => this.openSettings()).open();
				break;

			case "pick-collection":
			case "no-collection":
				this.openCollectionChooser(vaultPath, result.candidates);
				break;

			case "needs-indexing":
				if (this.settings.collection !== result.collection) {
					this.settings.collection = result.collection;
					await this.saveSettings();
				}
				new ReadyToIndexModal(this.app, () => {
					this.indexer?.requestUpdate();
				}).open();
				break;
		}
	}

	openCollectionChooser(vaultPath?: string, collections?: CollectionInfo[] | null): void {
		const vault = vaultPath ?? (this.app.vault.adapter as any).basePath as string;
		new CollectionChooserModal(
			this.app,
			vault,
			this.settings.qmdBinaryPath,
			collections ?? null,
			async (name) => {
				this.settings.collection = name;
				await this.saveSettings();
				if (this.mcpConnected) {
					this.startWarmupAndIndex();
				} else {
					new ReadyToIndexModal(this.app, () => {
						this.indexer?.requestUpdate();
					}).open();
				}
			},
		).open();
	}

	private startWarmupAndIndex(): void {
		if (!this.mcpClient) return;
		if (this.settings.autoIndexOnStartup) {
			this.mcpClient.warmup(this.settings.collection)
				.then(() => this.indexer?.requestUpdate())
				.catch(() => this.indexer?.requestUpdate());
		} else {
			this.mcpClient.warmup(this.settings.collection).catch(() => {});
		}
	}

	private openSettings(): void {
		(this.app as any).setting.open();
		(this.app as any).setting.openTabById(this.manifest.id);
	}

	async ensureConnection(): Promise<void> {
		if (this.mcpClient?.isConnected()) return;
		console.log("[QMD] MCP not connected, reconnecting on demand");
		this.restartAttempts = 0;
		await this.connectMcp();
	}

	private async attemptRestart(): Promise<void> {
		this.restartAttempts++;
		if (this.restartAttempts > this.MAX_RESTART_ATTEMPTS) {
			new Notice("QMD Search: QMD keeps crashing. Please restart Obsidian or check QMD.", 10000);
			return;
		}
		console.log(`[QMD] Attempting restart (${this.restartAttempts}/${this.MAX_RESTART_ATTEMPTS})`);
		await this.connectMcp();
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
