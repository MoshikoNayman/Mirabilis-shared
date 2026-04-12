/**
 * Mirabilis MCP Server
 *
 * Exposes Mirabilis as a Model Context Protocol (MCP) server over streamable-http.
 * VS Code, GitHub Copilot, or any MCP client can connect to POST /mcp and use
 * Mirabilis AI tools directly from the editor.
 *
 * Exposed tools:
 *   - mirabilis_chat         — Send a prompt and get an AI response
 *   - mirabilis_list_models  — List available providers and models
 *   - mirabilis_health       — Check provider readiness
 *
 * All requests are logged to mcp-server-audit.jsonl in the data directory.
 */

import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'mirabilis', version: '26.3R1-S3' };

const TOOLS = [
  {
    name: 'mirabilis_chat',
    description: 'Send a prompt to Mirabilis AI and receive a response. Supports all configured providers (ollama, openai-compatible, koboldcpp).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The message or question to send to the AI.'
        },
        provider: {
          type: 'string',
          enum: ['ollama', 'openai-compatible', 'koboldcpp'],
          description: 'AI provider to use. Defaults to the currently configured provider.'
        },
        model: {
          type: 'string',
          description: 'Model ID to use. Omit to use the current default.'
        },
        systemPrompt: {
          type: 'string',
          description: 'Optional system prompt to set context or persona.'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'mirabilis_list_models',
    description: 'List all available AI models for a given provider.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['ollama', 'openai-compatible', 'koboldcpp'],
          description: 'Provider to list models for. Defaults to current provider.'
        }
      },
      required: []
    }
  },
  {
    name: 'mirabilis_health',
    description: 'Check the health and readiness of all Mirabilis AI providers.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

function jsonRpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function mcpLog(level, message, meta = {}) {
  if (!LOGGING_ENABLED) return;
  const ts = new Date().toISOString();
  const metaStr = Object.keys(meta).length
    ? ' ' + Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';
  const prefix = level === 'ERROR' ? '[MCP-SERVER ERROR]' : level === 'WARN' ? '[MCP-SERVER WARN] ' : '[MCP-SERVER]      ';
  console.log(`${ts}  ${prefix}  ${message}${metaStr}`);
}

const LOGGING_ENABLED = String(process.env.MIRABILIS_LOG || '').trim() === '1';

async function appendServerAudit(auditLogPath, eventType, details = {}) {
  if (!LOGGING_ENABLED) return;
  const payload = { ts: new Date().toISOString(), eventType, source: 'mcp-server', ...details };
  try {
    await mkdir(dirname(auditLogPath), { recursive: true });
    await appendFile(auditLogPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // Best-effort; never fail the request path
  }
}

async function callMirabilisChat({ prompt, provider, model, systemPrompt }, config, streamWithProvider, getEffectiveModel, listModels) {
  const resolvedProvider = provider || config.aiProvider || 'ollama';
  const resolvedModel = model || await getEffectiveModel(config, resolvedProvider);

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: String(prompt) });

  let response = '';
  await streamWithProvider({
    provider: resolvedProvider,
    model: resolvedModel,
    messages,
    config,
    onToken: (token) => { response += token; }
  });

  return { response, provider: resolvedProvider, model: resolvedModel };
}

async function callMirabilisListModels({ provider }, config, listModels) {
  const resolvedProvider = provider || config.aiProvider || 'ollama';
  const models = await listModels(config, resolvedProvider);
  return {
    provider: resolvedProvider,
    models: models.map((m) => ({
      id: m.id,
      label: m.label || m.id,
      group: m.group || null,
      available: m.available !== false,
      size: m.size || null
    }))
  };
}

async function callMirabilisHealth(config) {
  const checks = await Promise.allSettled([
    fetch(`${String(config.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) }),
    fetch(`${String(config.openAIBaseUrl || 'http://127.0.0.1:8000/v1').replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(3000) }),
    fetch(`${String(config.koboldBaseUrl || 'http://127.0.0.1:5001/v1').replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(3000) })
  ]);

  const [ollama, openai, kobold] = checks.map((c) => c.status === 'fulfilled' && c.value.ok);

  return {
    activeProvider: config.aiProvider || 'ollama',
    providers: {
      ollama: { ready: ollama, url: config.ollamaBaseUrl },
      'openai-compatible': { ready: openai, url: config.openAIBaseUrl },
      koboldcpp: { ready: kobold, url: config.koboldBaseUrl }
    }
  };
}

/**
 * Creates the MCP server request handler.
 * Returns an Express middleware function to be mounted at POST /mcp.
 *
 * @param {object} deps - Injected dependencies from server.js
 * @param {object} deps.config - Application config
 * @param {Function} deps.streamWithProvider - LLM streaming function
 * @param {Function} deps.getEffectiveModel - Model resolver
 * @param {Function} deps.listModels - Model lister
 * @param {string} deps.auditLogPath - Path to mcp-server-audit.jsonl
 */
export function createMcpServerHandler({ config, streamWithProvider, getEffectiveModel, listModels, auditLogPath }) {
  const activeSessions = new Map(); // sessionId -> { createdAt }

  return async function mcpServerHandler(req, res) {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const body = req.body;
    const sessionId = req.headers['mcp-session-id'] || '';

    if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0') {
      res.status(400).json({ error: 'Invalid JSON-RPC 2.0 request' });
      return;
    }

    const { id, method, params = {} } = body;

    void appendServerAudit(auditLogPath, 'mcp_request', { method, clientIp, sessionId: sessionId || undefined });

    // ── initialize ────────────────────────────────────────────────────────
    if (method === 'initialize') {
      const newSessionId = randomUUID();
      activeSessions.set(newSessionId, { createdAt: Date.now() });

      mcpLog('INFO', `New session from ${clientIp}`, { session: newSessionId.slice(0, 8) });
      void appendServerAudit(auditLogPath, 'session_created', { sessionId: newSessionId, clientIp });

      res.setHeader('mcp-session-id', newSessionId);
      res.json(jsonRpcResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} }
      }));
      return;
    }

    // ── notifications/initialized ─────────────────────────────────────────
    if (method === 'notifications/initialized') {
      res.status(204).end();
      return;
    }

    // ── tools/list ────────────────────────────────────────────────────────
    if (method === 'tools/list') {
      res.json(jsonRpcResponse(id, { tools: TOOLS }));
      return;
    }

    // ── tools/call ────────────────────────────────────────────────────────
    if (method === 'tools/call') {
      const toolName = String(params?.name || '').trim();
      const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const startedAt = Date.now();

      if (!toolName) {
        void appendServerAudit(auditLogPath, 'tool_call_error', { toolName: '', clientIp, error: 'missing tool name' });
        res.status(400).json(jsonRpcError(id, -32602, 'params.name is required'));
        return;
      }

      const knownTool = TOOLS.find((t) => t.name === toolName);
      if (!knownTool) {
        mcpLog('WARN', `Unknown tool requested: ${toolName}`, { client: clientIp });
        void appendServerAudit(auditLogPath, 'tool_call_error', { toolName, clientIp, error: 'unknown tool' });
        res.status(404).json(jsonRpcError(id, -32601, `Unknown tool: ${toolName}`));
        return;
      }

      mcpLog('INFO', `Tool call: ${toolName}`, { client: clientIp });

      try {
        let toolResult;

        if (toolName === 'mirabilis_chat') {
          const prompt = String(args.prompt || '').trim();
          if (!prompt) {
            res.status(400).json(jsonRpcError(id, -32602, 'prompt is required'));
            return;
          }
          toolResult = await callMirabilisChat(args, config, streamWithProvider, getEffectiveModel, listModels);
        } else if (toolName === 'mirabilis_list_models') {
          toolResult = await callMirabilisListModels(args, config, listModels);
        } else if (toolName === 'mirabilis_health') {
          toolResult = await callMirabilisHealth(config);
        }

        const durationMs = Date.now() - startedAt;
        mcpLog('INFO', `Tool done: ${toolName}`, { ms: durationMs, client: clientIp });
        void appendServerAudit(auditLogPath, 'tool_call_success', {
          toolName, clientIp, durationMs
        });

        res.json(jsonRpcResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
        }));
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        mcpLog('ERROR', `Tool failed: ${toolName} — ${error.message || 'unknown'}`, { ms: durationMs, client: clientIp });
        void appendServerAudit(auditLogPath, 'tool_call_error', {
          toolName, clientIp, error: error.message || 'unknown', durationMs
        });
        res.status(503).json(jsonRpcError(id, -32603, error.message || 'Tool execution failed'));
      }
      return;
    }

    // ── unknown method ────────────────────────────────────────────────────
    void appendServerAudit(auditLogPath, 'unknown_method', { method, clientIp });
    res.status(404).json(jsonRpcError(id, -32601, `Method not found: ${method}`));
  };
}
