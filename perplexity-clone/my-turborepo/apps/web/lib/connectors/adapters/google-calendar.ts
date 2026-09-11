import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class GoogleCalendarConnectorAdapter implements ConnectorAdapter {
	readonly id = "google_calendar";
	readonly name = "Google Calendar";
	readonly provider = "google";
	readonly category: ConnectorCategory = "productivity";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_events", description: "Query events in specified time range", risk: "LOW", requiresApproval: false },
		{ name: "get_event", description: "Retrieve single event details", risk: "LOW", requiresApproval: false },
		{ name: "free_busy", description: "Query participant calendar availability", risk: "LOW", requiresApproval: false },
		{ name: "create_event", description: "Schedule a new calendar event", risk: "HIGH", requiresApproval: true },
		{ name: "update_event", description: "Reschedule or modify existing event", risk: "HIGH", requiresApproval: true },
		{ name: "delete_event", description: "Cancel and remove event from calendar", risk: "HIGH", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	async authenticate(params: { code?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) throw new Error("OAuth authorization code required.");

		const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
		const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";

		const res = await this.http.request<{
			access_token: string;
			refresh_token?: string;
			expires_in: number;
			scope?: string;
		}>("https://oauth2.googleapis.com/token", {
			method: "POST",
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: params.code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: params.redirectUri ?? "http://localhost:3000/api/connectors/callback/calendar",
			}),
		});

		return {
			credential: {
				tokenType: "oauth2",
				accessToken: res.data.access_token,
				refreshToken: res.data.refresh_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
				scopes: res.data.scope ? res.data.scope.split(" ") : ["https://www.googleapis.com/auth/calendar"],
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		if (!credential.refreshToken) throw new Error("Missing refresh token.");

		const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
		const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";

		const res = await this.http.request<{
			access_token: string;
			expires_in: number;
			scope?: string;
		}>("https://oauth2.googleapis.com/token", {
			method: "POST",
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: credential.refreshToken,
				client_id: clientId,
				client_secret: clientSecret,
			}),
		});

		return {
			credential: {
				...credential,
				accessToken: res.data.access_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
				scopes: res.data.scope ? res.data.scope.split(" ") : credential.scopes,
			},
		};
	}

	async revoke(credential: ConnectorCredential): Promise<{ revoked: boolean }> {
		const token = credential.accessToken || credential.refreshToken;
		if (token) {
			await this.http.request(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
				method: "POST",
			}).catch(() => null);
		}
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)?.trim();
		if (!clientId) return { state: "UNCONFIGURED", detail: "Google Calendar client ID missing." };
		if (!credential?.accessToken) return { state: "CONFIGURED", detail: "OAuth client ready, authorization pending." };
		if (credential.expiresAt && credential.expiresAt < Date.now()) return { state: "REAUTH_REQUIRED", detail: "Token expired." };

		try {
			const res = await this.http.request<{ id?: string; summary?: string }>(
				"https://www.googleapis.com/calendar/v3/users/me/calendarList/primary",
				{
					method: "GET",
					headers: { Authorization: `Bearer ${credential.accessToken}` },
				},
			);
			return { state: "HEALTHY", detail: `Connected to Google Calendar: ${res.data.summary ?? "Primary"}.` };
		} catch (err: unknown) {
			const normalized = this.normalizeError(err);
			if (normalized.status === 401) return { state: "REAUTH_REQUIRED", detail: "Calendar OAuth token revoked." };
			return { state: "ERROR", detail: `Calendar health check error: ${normalized.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken) throw new Error("UNAUTHENTICATED: Google Calendar access token missing.");

		const headers = { Authorization: `Bearer ${credential.accessToken}` };

		switch (action) {
			case "list_events": {
				const calendarId = encodeURIComponent(String(params.calendarId ?? "primary"));
				const timeMin = params.timeMin ? encodeURIComponent(String(params.timeMin)) : encodeURIComponent(new Date().toISOString());
				const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMin}&singleEvents=true&orderBy=startTime`;
				const res = await this.http.request<{ items?: Array<{ id: string; summary: string; start?: unknown; end?: unknown }> }>(url, {
					method: "GET",
					headers,
				});
				return {
					events: res.data.items ?? [],
					calendarId: params.calendarId ?? "primary",
				};
			}

			case "get_event": {
				const calendarId = encodeURIComponent(String(params.calendarId ?? "primary"));
				const eventId = encodeURIComponent(String(params.eventId ?? ""));
				if (!eventId) throw new Error("eventId parameter required.");
				const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;
				const res = await this.http.request<Record<string, unknown>>(url, { method: "GET", headers });
				return res.data;
			}

			case "free_busy": {
				const timeMin = String(params.timeMin ?? new Date().toISOString());
				const timeMax = String(params.timeMax ?? new Date(Date.now() + 86400 * 1000 * 7).toISOString());
				const items = Array.isArray(params.items) ? params.items : [{ id: "primary" }];
				const res = await this.http.request<{ calendars?: Record<string, { busy: Array<{ start: string; end: string }> }> }>(
					"https://www.googleapis.com/calendar/v3/freeBusy",
					{
						method: "POST",
						headers: { ...headers, "Content-Type": "application/json" },
						body: { timeMin, timeMax, items },
					},
				);
				return {
					calendars: res.data.calendars ?? {},
					timeMin,
					timeMax,
				};
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken) throw new Error("UNAUTHENTICATED: Google Calendar access token missing.");

		const headers = {
			Authorization: `Bearer ${credential.accessToken}`,
			"Content-Type": "application/json",
		};
		const calendarId = encodeURIComponent(String(params.calendarId ?? "primary"));

		switch (action) {
			case "create_event": {
				const res = await this.http.request<{ id: string; summary: string; status: string; htmlLink?: string }>(
					`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
					{
						method: "POST",
						headers,
						body: {
							summary: params.summary,
							description: params.description,
							start: params.start ?? { dateTime: new Date().toISOString() },
							end: params.end ?? { dateTime: new Date(Date.now() + 3600 * 1000).toISOString() },
							attendees: params.attendees,
						},
					},
				);
				return {
					eventId: res.data.id,
					summary: res.data.summary,
					status: res.data.status ?? "confirmed",
					htmlLink: res.data.htmlLink,
				};
			}

			case "update_event": {
				const eventId = encodeURIComponent(String(params.eventId ?? ""));
				if (!eventId) throw new Error("eventId required for update.");
				const res = await this.http.request<{ id: string; summary: string; status: string }>(
					`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
					{
						method: "PATCH",
						headers,
						body: (params.updates as Record<string, unknown>) ?? { summary: params.summary, description: params.description },
					},
				);
				return { eventId: res.data.id, status: res.data.status ?? "updated" };
			}

			case "delete_event": {
				const eventId = encodeURIComponent(String(params.eventId ?? ""));
				if (!eventId) throw new Error("eventId required for deletion.");
				await this.http.request(
					`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
					{ method: "DELETE", headers },
				);
				return { eventId, status: "DELETED" };
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
		return { code: "CALENDAR_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const googleCalendarAdapter = new GoogleCalendarConnectorAdapter();
