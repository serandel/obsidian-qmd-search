import { Plugin } from "obsidian";

export default class QmdPlugin extends Plugin {
	async onload() {
		console.log("QMD Search plugin loaded");
	}

	onunload() {
		console.log("QMD Search plugin unloaded");
	}
}
