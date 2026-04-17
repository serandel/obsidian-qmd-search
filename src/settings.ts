import { App, PluginSettingTab, Setting } from "obsidian";
import type QmdPlugin from "./main";

export class QmdSettingsTab extends PluginSettingTab {
	plugin: QmdPlugin;

	constructor(app: App, plugin: QmdPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("QMD binary path")
			.setDesc("Path to the qmd executable. Leave as 'qmd' if it's on your PATH.")
			.addText((text) =>
				text
					.setPlaceholder("qmd")
					.setValue(this.plugin.settings.qmdBinaryPath)
					.onChange(async (value) => {
						this.plugin.settings.qmdBinaryPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Collection")
			.setDesc("QMD collection name to search")
			.addText((text) =>
				text
					.setPlaceholder("obsidian")
					.setValue(this.plugin.settings.collection)
					.onChange(async (value) => {
						this.plugin.settings.collection = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max results")
			.setDesc("Maximum search results per query")
			.addText((text) =>
				text
					.setPlaceholder("20")
					.setValue(String(this.plugin.settings.maxResults))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxResults = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Auto-update index")
			.setDesc("Automatically update the QMD index when files change in the vault")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoUpdate).onChange(async (value) => {
					this.plugin.settings.autoUpdate = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.registerFileWatcher();
					} else {
						this.plugin.unregisterFileWatcher();
					}
				})
			);

		// Advanced section (collapsed by default)
		const advancedDetails = containerEl.createEl("details");
		advancedDetails.createEl("summary", { text: "Advanced", cls: "qmd-advanced-summary" });

		new Setting(advancedDetails)
			.setName("Debounce delay")
			.setDesc("How long to wait (ms) after the last file change before triggering an index update")
			.addText((text) =>
				text
					.setPlaceholder("5000")
					.setValue(String(this.plugin.settings.debounceDelayMs))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 0) {
							this.plugin.settings.debounceDelayMs = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(advancedDetails)
			.setName("Process priority (nice level)")
			.setDesc("Lower CPU priority for QMD processes (0 = normal, 19 = lowest). Reduces system sluggishness during indexing. On Windows, maps to priority classes with fewer distinct levels.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 19, 1)
					.setValue(this.plugin.settings.niceLevel)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.niceLevel = value;
						this.plugin.daemon?.applyNiceLevel(value);
						await this.plugin.saveSettings();
					})
			);

		// Links
		const linksDiv = containerEl.createEl("div", { cls: "qmd-links" });
		const linksList = linksDiv.createEl("ul");
		for (const [label, url] of [
			["QMD on GitHub", "https://github.com/tobi/qmd"],
			["QMD Search on GitHub", "https://github.com/serandel/obsidian-qmd-search"],
			["www.SergioDelgado.tech", "https://www.sergiodelgado.tech"],
		]) {
			const li = linksList.createEl("li");
			li.createEl("a", { text: label, href: url });
		}

		// Ko-fi link
		const kofiDiv = containerEl.createEl("div", { cls: "qmd-kofi" });
		kofiDiv.createEl("p", {
			text: "If you find this plugin useful, consider supporting its development:",
		});
		const kofiLink = kofiDiv.createEl("a", {
			href: "https://ko-fi.com/serandel",
		});
		kofiLink.createEl("img", {
			attr: {
				src: "https://ko-fi.com/img/githubbutton_sm.svg",
				alt: "Buy me a coffee on Ko-fi",
				height: "36",
			},
		});
	}
}
