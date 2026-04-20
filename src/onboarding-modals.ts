import { App, Modal, Notice, Setting } from "obsidian";
import {
	createCollection,
	listCollections,
	pathsOverlap,
	suggestCollectionName,
	type CollectionInfo,
} from "./prerequisite-checker";
import { resolveBinaryPath, buildQmdEnv } from "./resolve-binary";

const QMD_URL = "https://github.com/tobi/qmd";

type OnCollectionSelected = (collectionName: string) => Promise<void>;
type OnIndexRequested = () => void;
type OnOpenSettings = () => void;

export class QmdNotFoundModal extends Modal {
	private onOpenSettings: OnOpenSettings;

	constructor(app: App, onOpenSettings: OnOpenSettings) {
		super(app);
		this.onOpenSettings = onOpenSettings;
	}

	onOpen(): void {
		this.setTitle("QMD is not installed");

		this.contentEl.createEl("p", {
			text: "QMD is a fast local search engine for Markdown files. This plugin needs it to work.",
		});

		this.contentEl.createEl("p", {
			text: "Install QMD and make sure it's available on your PATH, then restart Obsidian.",
		});

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText("Open QMD download page").setCta().onClick(() => {
					window.open(QMD_URL);
				}),
			)
			.addButton((btn) =>
				btn.setButtonText("I've set a custom path").onClick(() => {
					this.close();
					this.onOpenSettings();
				}),
			);
	}
}

/**
 * Unified collection chooser modal. Lists all existing collections,
 * highlights vault-matching ones, and offers to create a new one.
 * Used both during onboarding and from the settings tab.
 */
export class CollectionChooserModal extends Modal {
	private vaultPath: string;
	private qmdBinaryPath: string;
	private collections: CollectionInfo[] | null;
	private onCollectionSelected: OnCollectionSelected;

	/**
	 * @param collections - pre-fetched collections, or null to fetch on open
	 */
	constructor(
		app: App,
		vaultPath: string,
		qmdBinaryPath: string,
		collections: CollectionInfo[] | null,
		onCollectionSelected: OnCollectionSelected,
	) {
		super(app);
		this.vaultPath = vaultPath;
		this.qmdBinaryPath = qmdBinaryPath;
		this.collections = collections;
		this.onCollectionSelected = onCollectionSelected;
	}

	async onOpen(): Promise<void> {
		this.setTitle("Choose a QMD collection");

		// Fetch collections if not pre-loaded
		if (this.collections === null) {
			this.contentEl.createEl("p", { text: "Loading collections..." });
			try {
				const resolvedPath = resolveBinaryPath(this.qmdBinaryPath);
				const env = buildQmdEnv(resolvedPath);
				this.collections = await listCollections(resolvedPath, env);
			} catch {
				this.contentEl.empty();
				this.contentEl.createEl("p", {
					text: "Failed to list collections. Check that QMD is installed and working.",
				});
				return;
			}
			this.contentEl.empty();
		}

		const normVault = this.vaultPath.replace(/[/\\]+$/, "");

		// Show existing collections
		if (this.collections.length > 0) {
			this.contentEl.createEl("h4", { text: "Existing collections" });

			let firstEntry = true;
			for (const collection of this.collections) {
				const normColl = collection.path.replace(/[/\\]+$/, "");
				const isExact = normColl === normVault;
				const isSubset = !isExact && pathsOverlap(collection.path, this.vaultPath);

				const setting = new Setting(this.contentEl)
					.setName(collection.name)
					.setDesc(collection.path)
					.addButton((btn) =>
						btn.setButtonText("Use this")
							.setCta()
							.onClick(async () => {
								this.close();
								await this.onCollectionSelected(collection.name);
							}),
					);

				if (firstEntry) {
					setting.settingEl.style.borderTop = "none";
					firstEntry = false;
				}

				if (isExact || isSubset) {
					const tag = setting.nameEl.createEl("span", {
						text: isExact ? "vault" : "vault subfolder",
						cls: "qmd-collection-tag",
					});
					tag.style.marginLeft = "8px";
				}
			}
		} else {
			this.contentEl.createEl("p", {
				text: "No existing QMD collections found.",
			});
		}

		// Create new collection section
		this.contentEl.createEl("hr");
		this.contentEl.createEl("h4", { text: "Create a new collection" });

		const vaultPathEl = this.contentEl.createEl("p", {
			cls: "qmd-vault-path",
		});
		vaultPathEl.createEl("span", { text: "Vault path: " });
		vaultPathEl.createEl("code", { text: this.vaultPath });

		const suggestedName = suggestCollectionName(this.vaultPath);
		let collectionName = suggestedName;

		const createSetting = new Setting(this.contentEl)
			.setName("Collection name")
			.addText((text) =>
				text
					.setPlaceholder(suggestedName)
					.setValue(suggestedName)
					.onChange((value) => {
						collectionName = value;
					}),
			)
			.addButton((btn) =>
				btn.setButtonText("Create collection").setCta().onClick(async () => {
					btn.setDisabled(true);
					btn.setButtonText("Creating...");
					try {
						await createCollection(this.qmdBinaryPath, this.vaultPath, collectionName);
						this.close();
						await this.onCollectionSelected(collectionName);
					} catch (err) {
						btn.setDisabled(false);
						btn.setButtonText("Create collection");
						new Notice(`Failed to create collection: ${(err as Error).message}`, 10000);
					}
				}),
			);
		createSetting.settingEl.style.borderTop = "none";
	}
}

export class ReadyToIndexModal extends Modal {
	private onIndexRequested: OnIndexRequested;

	constructor(app: App, onIndexRequested: OnIndexRequested) {
		super(app);
		this.onIndexRequested = onIndexRequested;
	}

	onOpen(): void {
		this.setTitle("Collection ready! Time to index");

		this.contentEl.createEl("p", {
			text: "Initial indexing and embedding generation may take a few minutes depending on vault size.",
		});

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText("Start indexing now").setCta().onClick(() => {
					this.close();
					this.onIndexRequested();
				}),
			)
			.addButton((btn) =>
				btn.setButtonText("I'll do it later").onClick(() => {
					this.close();
				}),
			);
	}
}
