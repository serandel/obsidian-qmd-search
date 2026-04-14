import { request as httpRequest } from "http";
import { type QmdSearchResult } from "./types";

export class QmdClient {
	private host: string;
	private port: number;

	constructor(host: string, port: number) {
		this.host = host;
		this.port = port;
	}

	updateBaseUrl(host: string, port: number) {
		this.host = host;
		this.port = port;
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
		return new Promise((resolve) => {
			const timeout = setTimeout(() => resolve(false), 2000);
			const req = httpRequest(
				{ hostname: this.host, port: this.port, path: "/status", method: "GET" },
				(res) => {
					clearTimeout(timeout);
					resolve(res.statusCode === 200);
					res.resume();
				}
			);
			req.on("error", () => {
				clearTimeout(timeout);
				resolve(false);
			});
			req.end();
		});
	}

	private doQuery(
		body: Record<string, unknown>,
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<QmdSearchResult[]> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new DOMException("The operation was aborted", "AbortError"));
				return;
			}

			const payload = JSON.stringify(body);
			const timeout = setTimeout(() => {
				req.destroy();
				reject(new DOMException("The operation was aborted", "AbortError"));
			}, timeoutMs);

			const req = httpRequest(
				{
					hostname: this.host,
					port: this.port,
					path: "/query",
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(payload),
					},
				},
				(res) => {
					let data = "";
					res.on("data", (chunk) => (data += chunk));
					res.on("end", () => {
						clearTimeout(timeout);
						if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
							try {
								const parsed = JSON.parse(data);
									const results = Array.isArray(parsed) ? parsed : parsed.results ?? [];
									resolve(results as QmdSearchResult[]);
							} catch {
								reject(new Error("QMD query returned invalid JSON"));
							}
						} else {
							reject(new Error(`QMD query failed: ${res.statusCode} ${res.statusMessage}`));
						}
					});
				}
			);

			req.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});

			if (signal) {
				signal.addEventListener("abort", () => {
					clearTimeout(timeout);
					req.destroy();
					reject(new DOMException("The operation was aborted", "AbortError"));
				});
			}

			req.write(payload);
			req.end();
		});
	}
}
