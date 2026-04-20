import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { setPriority } from "os";
import { resolveBinaryPath, buildQmdEnv } from "./resolve-binary";
import type { QmdSearchResult } from "./types";

export class QmdMcpClient {
	private client: Client | null = null;
	private transport: StdioClientTransport | null = null;
	private closeCallback: (() => void) | null = null;
	private qmdBinaryPath: string;
	private niceLevel: number;

	constructor(qmdBinaryPath: string, niceLevel: number) {
		this.qmdBinaryPath = qmdBinaryPath;
		this.niceLevel = niceLevel;
	}

	async connect(): Promise<void> {
		const resolvedPath = resolveBinaryPath(this.qmdBinaryPath);
		const env = buildQmdEnv(resolvedPath);

		this.transport = new StdioClientTransport({
			command: resolvedPath,
			args: ["mcp"],
			env,
		});

		this.transport.onclose = () => {
			this.client = null;
			this.transport = null;
			this.closeCallback?.();
		};

		this.client = new Client(
			{ name: "qmd-search", version: "1.0.0" },
		);

		await this.client.connect(this.transport);

		if (this.niceLevel > 0 && this.transport.pid) {
			try { setPriority(this.transport.pid, this.niceLevel); } catch { /* ignore on Windows */ }
		}
	}

	async searchLex(
		query: string,
		collection: string,
		limit: number,
	): Promise<QmdSearchResult[]> {
		console.log(`[QMD] Lex query: "${query}"`);
		return this.callQuery({
			searches: [{ type: "lex", query }],
			collections: [collection],
			limit,
		});
	}

	async searchHybrid(
		query: string,
		collection: string,
		limit: number,
	): Promise<QmdSearchResult[]> {
		console.log(`[QMD] Hybrid query: "${query}"`);
		return this.callQuery({
			searches: [
				{ type: "lex", query },
				{ type: "vec", query },
			],
			collections: [collection],
			limit,
		});
	}

	async checkPending(): Promise<number> {
		if (!this.client) return 0;
		try {
			const result = await this.client.callTool({ name: "status", arguments: {} });
			if (result.isError) return 0;
			const structured = result.structuredContent as { needsEmbedding?: number } | undefined;
			return structured?.needsEmbedding ?? 0;
		} catch {
			return 0;
		}
	}

	async warmup(collection: string): Promise<void> {
		try {
			await this.searchHybrid("warmup", collection, 1);
		} catch {
			console.warn("[QMD] Warmup query failed — models may load on first real query");
		}
	}

	async close(): Promise<void> {
		const client = this.client;
		this.client = null;
		this.transport = null;
		try {
			await client?.close();
		} catch {
			// Process may already be gone
		}
	}

	isConnected(): boolean {
		return this.client !== null;
	}

	onClose(callback: () => void): void {
		this.closeCallback = callback;
	}

	applyNiceLevel(level: number): void {
		this.niceLevel = level;
		if (this.transport?.pid && level > 0) {
			try { setPriority(this.transport.pid, level); } catch { /* ignore */ }
		}
	}

	private async callQuery(
		args: Record<string, unknown>,
	): Promise<QmdSearchResult[]> {
		if (!this.client) throw new Error("QMD is not connected");

		const result = await this.client.callTool({ name: "query", arguments: args });

		if (result.isError) {
			const msg = Array.isArray(result.content)
				? result.content.map((c: { text?: string }) => c.text ?? "").join("")
				: String(result.content);
			const isTimeout = /timed?\s*out/i.test(msg);
			const err = new Error(`QMD query failed: ${msg}`);
			if (isTimeout) err.name = "TimeoutError";
			throw err;
		}

		const structured = result.structuredContent as { results?: QmdSearchResult[] } | undefined;
		if (structured?.results) {
			return structured.results;
		}

		return [];
	}
}
