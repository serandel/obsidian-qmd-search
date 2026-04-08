import { Plugin } from "obsidian";
import { QmdSettingsTab } from "./settings";
import { DEFAULT_SETTINGS, type QmdSettings } from "./types";

export default class QmdPlugin extends Plugin {
	settings: QmdSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new QmdSettingsTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
