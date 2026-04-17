import { describe, expect, it, vi } from "vitest";
import { QmdStatusBar } from "./status-bar";
import type { IndexerState } from "./types";

const mockMenuItem = {
	setTitle: vi.fn().mockReturnThis(),
	setIcon: vi.fn().mockReturnThis(),
	onClick: vi.fn().mockReturnThis(),
};
const mockMenu = {
	addItem: vi.fn((cb: (item: typeof mockMenuItem) => void) => { cb(mockMenuItem); return mockMenu; }),
	showAtMouseEvent: vi.fn(),
};

vi.mock("obsidian", () => ({
	Notice: vi.fn(),
	Menu: function () { return mockMenu; },
}));

function createMockElement(): HTMLElement {
	const listeners: Record<string, EventListener[]> = {};
	const el = {
		textContent: "",
		title: "",
		onclick: null as (() => void) | null,
		setText(text: string) { this.textContent = text; },
		addClass(_cls: string) {},
		addEventListener(event: string, handler: EventListener) {
			(listeners[event] ??= []).push(handler);
		},
		_fire(event: string, data: Partial<MouseEvent> = {}) {
			for (const h of listeners[event] ?? []) h({ preventDefault: vi.fn(), ...data } as unknown as Event);
		},
	};
	return el as unknown as HTMLElement;
}

describe("QmdStatusBar", () => {
	it("shows idle state", () => {
		const el = createMockElement();
		const bar = new QmdStatusBar(el);
		bar.update({ phase: "idle" });
		expect(el.textContent).toBe("QMD \u2713");
	});

	it("shows updating state", () => {
		const el = createMockElement();
		const bar = new QmdStatusBar(el);
		bar.update({ phase: "updating" });
		expect(el.textContent).toBe("QMD: Indexing\u2026");
	});

	it("shows embedding state with unknown pending", () => {
		const el = createMockElement();
		const bar = new QmdStatusBar(el);
		bar.update({ phase: "embedding", pending: -1 });
		expect(el.textContent).toBe("QMD: Embeddings\u2026");
	});

	it("shows embedding state with pending count", () => {
		const el = createMockElement();
		const bar = new QmdStatusBar(el);
		bar.update({ phase: "embedding", pending: 42 });
		expect(el.textContent).toBe("QMD: Embeddings (42 pending)");
	});

	it("shows error state with click handler", () => {
		const el = createMockElement();
		const bar = new QmdStatusBar(el);
		bar.update({ phase: "error", message: "something broke" });
		expect(el.textContent).toBe("QMD: Error");
		expect(el.title).toBe("something broke");
		expect(el.onclick).not.toBeNull();
	});

	it("initializes to idle", () => {
		const el = createMockElement();
		new QmdStatusBar(el);
		expect(el.textContent).toBe("QMD \u2713");
	});

	it("right-click opens context menu with settings option", () => {
		const el = createMockElement();
		const bar = new QmdStatusBar(el);
		const settingsCb = vi.fn();
		bar.onOpenSettings(settingsCb);
		(el as any)._fire("contextmenu");
		expect(mockMenu.addItem).toHaveBeenCalled();
		expect(mockMenuItem.setTitle).toHaveBeenCalledWith("Settings");
		expect(mockMenuItem.setIcon).toHaveBeenCalledWith("settings");
		// Simulate clicking the menu item
		const onClickCb = mockMenuItem.onClick.mock.calls[0]![0] as () => void;
		onClickCb();
		expect(settingsCb).toHaveBeenCalledOnce();
	});

	it("idle state clicks open search panel", () => {
		const el = createMockElement();
		const bar = new QmdStatusBar(el);
		const searchCb = vi.fn();
		bar.onOpenSearch(searchCb);
		bar.update({ phase: "idle" });
		(el.onclick as () => void)();
		expect(searchCb).toHaveBeenCalledOnce();
	});
});
