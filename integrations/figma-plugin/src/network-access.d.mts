export type PluginNetworkAccess = {
  allowedDomains: string[];
  reasoning: string;
  devAllowedDomains: string[];
};

export function deriveStorageOrigin(supabaseUrl: string): string;
export function requireExactOrigin(value: string, expectedOrigin: string): string;
export function buildPluginNetworkAccess(handoffUrl: string, supabaseUrl: string): PluginNetworkAccess;
