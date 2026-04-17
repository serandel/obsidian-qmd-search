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
