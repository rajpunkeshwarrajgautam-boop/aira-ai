export type ConnectorCategory =
	| "productivity"
	| "communication"
	| "cloud_storage"
	| "project_management"
	| "crm"
	| "analytics"
	| "ecommerce"
	| "developer_tools"
	| "advertising"
	| "social";

export type ConnectorHealthState =
	| "UNCONFIGURED"
	| "CONFIGURED"
	| "AUTHENTICATING"
	| "HEALTHY"
	| "DEGRADED"
	| "REAUTH_REQUIRED"
	| "REVOKED"
	| "ERROR";

export type ConnectorAuthType = "oauth2" | "api_key" | "webhook_signature" | "none";

export interface ConnectorActionSpec {
	readonly name: string;
	readonly description: string;
	readonly risk: "LOW" | "MEDIUM" | "HIGH" | "PROTECTED";
	readonly requiresApproval: boolean;
	readonly parametersSchema?: Record<string, unknown>;
}

export interface ConnectorManifest {
	readonly id: string;
	readonly name: string;
	readonly category: ConnectorCategory;
	readonly description: string;
	readonly version: string;
	readonly authType: ConnectorAuthType;
	readonly requiredScopes: readonly string[];
	readonly actions: readonly ConnectorActionSpec[];
	readonly isConfigured: boolean;
	readonly isEnabled: boolean;
	readonly health: ConnectorHealthState;
}

export interface ConnectorCredential {
	readonly tokenType: "bearer" | "oauth2" | "api_key";
	readonly accessToken?: string;
	readonly refreshToken?: string;
	readonly expiresAt?: number;
	readonly apiKey?: string;
	readonly scopes?: readonly string[];
}

export interface ConnectorAdapter {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
	readonly category: ConnectorCategory;
	readonly actions: readonly ConnectorActionSpec[];
	authenticate(params: { code?: string; redirectUri?: string; apiKey?: string }): Promise<{ credential: ConnectorCredential }>;
	refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }>;
	revoke(credential: ConnectorCredential): Promise<{ revoked: boolean }>;
	health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }>;
	listCapabilities(): readonly string[];
	executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>>;
	executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>>;
	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number };
}
