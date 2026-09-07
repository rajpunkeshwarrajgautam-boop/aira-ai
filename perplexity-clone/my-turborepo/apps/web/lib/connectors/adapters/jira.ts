import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class JiraConnectorAdapter implements ConnectorAdapter {
	readonly id = "jira";
	readonly name = "Atlassian Jira";
	readonly provider = "atlassian";
	readonly category: ConnectorCategory = "project_management";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "search_issues", description: "Search Jira tickets by JQL query", risk: "LOW", requiresApproval: false },
		{ name: "get_issue", description: "Retrieve issue details and comments", risk: "LOW", requiresApproval: false },
		{ name: "create_issue", description: "Create backlog or sprint issue", risk: "MEDIUM", requiresApproval: true },
		{ name: "transition_issue", description: "Update ticket status", risk: "MEDIUM", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	private resolveBaseUrl(): string {
		const domain = process.env.JIRA_DOMAIN || "aira-team.atlassian.net";
		return domain.startsWith("http") ? domain : `https://${domain}`;
	}

	private buildHeaders(credential?: ConnectorCredential): Record<string, string> {
		const token = credential?.apiKey || credential?.accessToken || process.env.JIRA_API_TOKEN;
		if (!token) throw new Error("UNAUTHENTICATED: Jira API token or OAuth access token missing.");

		const email = process.env.JIRA_EMAIL;
		const authHeader = email && credential?.tokenType !== "oauth2"
			? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`
			: `Bearer ${token}`;

		return {
			Authorization: authHeader,
			Accept: "application/json",
			"Content-Type": "application/json",
		};
	}

	async authenticate(params: { apiKey?: string; code?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (params.apiKey) {
			return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
		}
		if (!params.code) throw new Error("Jira API token or OAuth code required.");

		const clientId = process.env.JIRA_CLIENT_ID || "";
		const clientSecret = process.env.JIRA_CLIENT_SECRET || "";

		const res = await this.http.request<{
			access_token: string;
			refresh_token?: string;
			expires_in: number;
			scope?: string;
		}>("https://auth.atlassian.com/oauth/token", {
			method: "POST",
			body: {
				grant_type: "authorization_code",
				client_id: clientId,
				client_secret: clientSecret,
				code: params.code,
				redirect_uri: params.redirectUri ?? "http://localhost:3000/api/connectors/callback/jira",
			},
		});

		return {
			credential: {
				tokenType: "oauth2",
				accessToken: res.data.access_token,
				refreshToken: res.data.refresh_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		if (!credential.refreshToken) return { credential };

		const clientId = process.env.JIRA_CLIENT_ID || "";
		const clientSecret = process.env.JIRA_CLIENT_SECRET || "";

		const res = await this.http.request<{ access_token: string; expires_in: number }>(
			"https://auth.atlassian.com/oauth/token",
			{
				method: "POST",
				body: {
					grant_type: "refresh_token",
					client_id: clientId,
					client_secret: clientSecret,
					refresh_token: credential.refreshToken,
				},
			},
		);

		return {
			credential: {
				...credential,
				accessToken: res.data.access_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
			},
		};
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const token = credential?.apiKey || credential?.accessToken || process.env.JIRA_API_TOKEN?.trim();
		if (!token) return { state: "UNCONFIGURED", detail: "JIRA_API_TOKEN missing." };

		try {
			const baseUrl = this.resolveBaseUrl();
			const headers = this.buildHeaders(credential);
			const res = await this.http.request<{ displayName?: string; emailAddress?: string }>(
				`${baseUrl}/rest/api/3/myself`,
				{ method: "GET", headers },
			);
			return { state: "HEALTHY", detail: `Jira connected as ${res.data.displayName || res.data.emailAddress || "user"}.` };
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			if (norm.status === 401) return { state: "REAUTH_REQUIRED", detail: "Jira token invalid." };
			return { state: "ERROR", detail: `Jira health check failed: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const baseUrl = this.resolveBaseUrl();
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "search_issues": {
				const jql = params.jql ? String(params.jql) : "ORDER BY created DESC";
				const maxResults = params.maxResults ? Number(params.maxResults) : 50;
				const url = `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`;
				const res = await this.http.request<{ issues?: Array<{ id: string; key: string; fields: Record<string, unknown> }>; total?: number }>(url, {
					method: "GET",
					headers,
				});
				return {
					issues: res.data.issues ?? [],
					total: res.data.total ?? 0,
					jql,
				};
			}

			case "get_issue": {
				const issueKey = encodeURIComponent(String(params.issueKey ?? params.issueId ?? ""));
				if (!issueKey) throw new Error("issueKey required.");
				const url = `${baseUrl}/rest/api/3/issue/${issueKey}`;
				const res = await this.http.request<Record<string, unknown>>(url, { method: "GET", headers });
				return res.data;
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const baseUrl = this.resolveBaseUrl();
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "create_issue": {
				const projectKey = String(params.projectKey ?? "AIRA");
				const summary = String(params.summary ?? "");
				const description = String(params.description ?? "");
				const issueType = String(params.issueType ?? "Task");

				const res = await this.http.request<{ id: string; key: string; self: string }>(
					`${baseUrl}/rest/api/3/issue`,
					{
						method: "POST",
						headers,
						body: {
							fields: {
								project: { key: projectKey },
								summary,
								description: {
									type: "doc",
									version: 1,
									content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
								},
								issuetype: { name: issueType },
							},
						},
					},
				);
				return {
					id: res.data.id,
					key: res.data.key,
					self: res.data.self,
					status: "CREATED",
				};
			}

			case "transition_issue": {
				const issueKey = encodeURIComponent(String(params.issueKey ?? ""));
				const transitionId = String(params.transitionId ?? "31");
				if (!issueKey) throw new Error("issueKey required for transition.");

				await this.http.request(`${baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
					method: "POST",
					headers,
					body: { transition: { id: transitionId } },
				});
				return { issueKey: params.issueKey, status: "TRANSITIONED" };
			}

			default:
				throw new Error(`Unsupported write action: ${action}`);
		}
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		if (error instanceof HttpTransportError) {
			return { code: error.code, message: error.message, retryable: error.retryable, status: error.status };
		}
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "JIRA_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const jiraAdapter = new JiraConnectorAdapter();
