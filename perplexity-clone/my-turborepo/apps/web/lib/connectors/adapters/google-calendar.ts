import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

export class GoogleCalendarConnectorAdapter implements ConnectorAdapter {
	readonly id = "google_calendar";
	readonly name = "Google Calendar";
	readonly provider = "google";
	readonly category: ConnectorCategory = "productivity";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_events", description: "List upcoming calendar events", risk: "LOW", requiresApproval: false },
		{ name: "find_free_busy", description: "Query free/busy attendee slots", risk: "LOW", requiresApproval: false },
		{ name: "create_event", description: "Schedule a meeting with attendees", risk: "HIGH", requiresApproval: true },
		{ name: "update_event", description: "Reschedule or modify meeting details", risk: "HIGH", requiresApproval: true },
		{ name: "delete_event", description: "Cancel and remove scheduled event", risk: "HIGH", requiresApproval: true },
	];

	async authenticate(params: { code?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) throw new Error("Authorization code required for Google Calendar OAuth.");
		return {
			credential: {
				tokenType: "oauth2",
				accessToken: `ya29.calendar.${params.code}`,
				refreshToken: `1//cal.${params.code}`,
				expiresAt: Date.now() + 3600 * 1000,
				scopes: ["https://www.googleapis.com/auth/calendar.events"],
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		if (!credential.refreshToken) throw new Error("Refresh token missing.");
		return {
			credential: {
				...credential,
				accessToken: `ya29.calendar.refreshed.${Date.now()}`,
				expiresAt: Date.now() + 3600 * 1000,
			},
		};
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
		if (!clientId) return { state: "UNCONFIGURED", detail: "GOOGLE_CALENDAR_CLIENT_ID missing." };
		if (!credential?.accessToken) return { state: "CONFIGURED", detail: "Client configured, awaiting authorization." };
		if (credential.expiresAt && credential.expiresAt < Date.now()) {
			return { state: "REAUTH_REQUIRED", detail: "Calendar token expired." };
		}
		return { state: "HEALTHY", detail: "Google Calendar API ready." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Google Calendar credential missing.");
		}

		switch (action) {
			case "list_events": {
				return {
					events: [
						{ id: "evt_1", summary: "Product Strategy Sync", start: "2026-09-08T10:00:00Z", end: "2026-09-08T11:00:00Z", attendees: ["eng@aira.ai"] },
						{ id: "evt_2", summary: "Weekly Sprint Review", start: "2026-09-08T15:00:00Z", end: "2026-09-08T16:00:00Z", attendees: ["team@aira.ai"] },
					],
					timezone: String(params.timezone ?? "UTC"),
				};
			}
			case "find_free_busy": {
				return {
					timeMin: "2026-09-08T09:00:00Z",
					timeMax: "2026-09-08T17:00:00Z",
					busySlots: [
						{ start: "2026-09-08T10:00:00Z", end: "2026-09-08T11:00:00Z" },
						{ start: "2026-09-08T15:00:00Z", end: "2026-09-08T16:00:00Z" },
					],
					availableSlots: [
						{ start: "2026-09-08T11:00:00Z", end: "2026-09-08T15:00:00Z" },
					],
				};
			}
			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Google Calendar credential missing.");
		}

		switch (action) {
			case "create_event": {
				return {
					eventId: `evt_${Date.now()}`,
					summary: String(params.summary ?? "New Meeting"),
					start: String(params.start ?? ""),
					end: String(params.end ?? ""),
					status: "CONFIRMED",
					hangoutLink: "https://meet.google.com/xyz-test",
				};
			}
			case "update_event": {
				return {
					eventId: String(params.eventId ?? ""),
					updated: true,
					status: "RESCHEDULED",
				};
			}
			case "delete_event": {
				return { eventId: String(params.eventId ?? ""), status: "CANCELLED" };
			}
			default:
				throw new Error(`Unsupported write action: ${action}`);
		}
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		if (msg.includes("401") || msg.includes("UNAUTHENTICATED")) {
			return { code: "UNAUTHORIZED", message: "Google Calendar authorization invalid.", retryable: false, status: 401 };
		}
		return { code: "CALENDAR_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const googleCalendarAdapter = new GoogleCalendarConnectorAdapter();
