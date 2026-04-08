import { type QmdSearchResult } from "./types";

export class QmdClient {
	private baseUrl: string;

	constructor(host: string, port: number) {
		this.baseUrl = `http://${host}:${port}`;
	}

	updateBaseUrl(host: string, port: number) {
		this.baseUrl = `http://${host}:${port}`;
	}

	async searchLex(
		query: string,
		collection: string,
		limit: number,
		signal?: AbortSignal
	): Promise<QmdSearchResult[]> {
		return this.doQuery(
			{
				searches: [{ type: "lex", query }],
				collections: [collection],
				limit,
			},
			5000,
			signal
		);
	}

	async searchHybrid(
		query: string,
		collection: string,
		limit: number,
		signal?: AbortSignal
	): Promise<QmdSearchResult[]> {
		return this.doQuery(
			{
				searches: [{ type: "expand", query }],
				collections: [collection],
				limit,
			},
			60000,
			signal
		);
	}

	async healthCheck(): Promise<boolean> {
		try {
			const res = await fetch(`${this.baseUrl}/status`, {
				signal: AbortSignal.timeout(2000),
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	private async doQuery(
		body: Record<string, unknown>,
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<QmdSearchResult[]> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		if (signal) {
			signal.addEventListener("abort", () => controller.abort());
		}

		try {
			const res = await fetch(`${this.baseUrl}/query`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			if (!res.ok) {
				throw new Error(`QMD query failed: ${res.status} ${res.statusText}`);
			}

			return (await res.json()) as QmdSearchResult[];
		} finally {
			clearTimeout(timeout);
		}
	}
}
