-- 0008_external_task_links copies old task references into the provider-neutral table.
-- The application no longer connects to external task MCP servers or stores their credentials.
DROP TABLE linked_task;
DROP TABLE task_mcp_connection;
