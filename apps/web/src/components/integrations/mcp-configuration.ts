export function workspaceMcpEndpoint(origin: string, workspaceId: string) {
  const endpoint = new URL("/api/mcp", origin);
  endpoint.searchParams.set("workspaceId", workspaceId);
  return endpoint.toString();
}

export function codexMcpConfiguration(endpoint: string) {
  return [
    "[mcp_servers.asbir_handoff]",
    `url = ${JSON.stringify(endpoint)}`,
    'bearer_token_env_var = "ASBIR_MCP_TOKEN"',
  ].join("\n");
}

export function claudeCodeMcpConfiguration(endpoint: string) {
  return JSON.stringify({
    mcpServers: {
      asbir_handoff: {
        type: "http",
        url: endpoint,
        headers: {
          Authorization: "Bearer ${ASBIR_HANDOFF_ACCESS}",
        },
      },
    },
  }, null, 2);
}

export function geminiCliMcpConfiguration(endpoint: string) {
  return JSON.stringify({
    mcpServers: {
      asbir_handoff: {
        httpUrl: endpoint,
        headers: {
          Authorization: "Bearer ${ASBIR_HANDOFF_ACCESS}",
        },
      },
    },
  }, null, 2);
}

export function genericMcpConfiguration(endpoint: string) {
  return JSON.stringify({
    mcpServers: {
      asbir_handoff: {
        type: "http",
        url: endpoint,
        headers: {
          Authorization: "Bearer ${ASBIR_MCP_TOKEN}",
        },
      },
    },
  }, null, 2);
}
