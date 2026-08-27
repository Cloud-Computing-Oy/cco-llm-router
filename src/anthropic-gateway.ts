import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';
import { resolveModel, type ResolveOptions } from './router';

type DataClass = NonNullable<ResolveOptions['dataClass']>;
type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean };
type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicBlock[] };
type AnthropicTool = { name: string; description?: string; input_schema: Record<string, unknown> };

export type AnthropicMessagesRequest = {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: 'text'; text: string }>;
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool' | 'none'; name?: string };
};

export type GatewayConfig = {
  alias: string;
  dataClass: DataClass;
  token: string;
  host?: string;
  port?: number;
  requestLimitBytes?: number;
  timeoutMs?: number;
};

type GatewayResult = {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  finishReason: string;
  usage: { inputTokens?: number; outputTokens?: number };
};

export type GatewayGenerate = (
  request: AnthropicMessagesRequest,
  config: GatewayConfig,
  signal: AbortSignal,
) => Promise<GatewayResult>;

const PROVIDER_SECRET_RE = /^(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|GROQ_API_KEY|OPENROUTER_API_KEY|DEEPINFRA_API_KEY|TOGETHER_API_KEY|DEEPSEEK_API_KEY|MOONSHOT_API_KEY|COHERE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY(?:_PAID|_\d+)?|GOOGLE_GENAI_API_KEY|GEMINI_API_KEY)$/;

export function createClaudeChildEnvironment(
  source: NodeJS.ProcessEnv,
  baseUrl: string,
  token: string,
): NodeJS.ProcessEnv {
  const child = Object.fromEntries(
    Object.entries(source).filter(([name]) => !PROVIDER_SECRET_RE.test(name)),
  );
  return {
    ...child,
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_API_KEY: '',
  };
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const apiError = (res: ServerResponse, status: number, message: string, type = 'invalid_request_error') =>
  json(res, status, { type: 'error', error: { type, message } });

function safeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req: IncomingMessage, token: string): boolean {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const apiKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '';
  return safeEqual(bearer, token) || safeEqual(apiKey, token);
}

async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid_json');
  }
}

function systemText(system: AnthropicMessagesRequest['system']): string | undefined {
  if (typeof system === 'string') return system;
  return system?.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

function displayContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        typeof part === 'object' && part !== null && 'text' in part
          ? String((part as { text: unknown }).text)
          : JSON.stringify(part),
      )
      .join('\n');
  }
  return JSON.stringify(value ?? '');
}

export function toModelMessages(messages: AnthropicMessage[]): ModelMessage[] {
  const output: ModelMessage[] = [];
  for (const message of messages) {
    if (typeof message.content === 'string') {
      output.push({ role: message.role, content: message.content });
      continue;
    }
    const textParts = message.content
      .filter((part): part is Extract<AnthropicBlock, { type: 'text' }> => part.type === 'text')
      .map((part) => ({ type: 'text' as const, text: part.text }));
    const toolUses = message.content
      .filter((part): part is Extract<AnthropicBlock, { type: 'tool_use' }> => part.type === 'tool_use')
      .map((part) => ({
        type: 'tool-call' as const,
        toolCallId: part.id,
        toolName: part.name,
        input: part.input,
      }));
    const toolResults = message.content
      .filter((part): part is Extract<AnthropicBlock, { type: 'tool_result' }> => part.type === 'tool_result')
      .map((part) => ({
        type: 'tool-result' as const,
        toolCallId: part.tool_use_id,
        toolName:
          [...messages]
            .reverse()
            .flatMap((candidate) =>
              Array.isArray(candidate.content) ? candidate.content : [],
            )
            .find(
              (candidate): candidate is Extract<AnthropicBlock, { type: 'tool_use' }> =>
                candidate.type === 'tool_use' && candidate.id === part.tool_use_id,
            )?.name ?? 'unknown_tool',
        output: {
          type: part.is_error ? ('error-text' as const) : ('text' as const),
          value: displayContent(part.content),
        },
      }));
    if (message.role === 'assistant') {
      output.push({ role: 'assistant', content: [...textParts, ...toolUses] });
    } else {
      if (textParts.length > 0) output.push({ role: 'user', content: textParts });
      if (toolResults.length > 0) output.push({ role: 'tool', content: toolResults });
    }
  }
  return output;
}

function gatewayTools(input: AnthropicTool[] | undefined): ToolSet | undefined {
  if (!input?.length) return undefined;
  return Object.fromEntries(
    input.map((item) => [
      item.name,
      tool({ description: item.description, inputSchema: jsonSchema(item.input_schema) }),
    ]),
  );
}

function gatewayToolChoice(choice: AnthropicMessagesRequest['tool_choice']) {
  if (!choice || choice.type === 'auto') return 'auto' as const;
  if (choice.type === 'any') return 'required' as const;
  if (choice.type === 'none') return 'none' as const;
  return { type: 'tool' as const, toolName: choice.name ?? '' };
}

export const defaultGatewayGenerate: GatewayGenerate = async (request, config, signal) => {
  const { model } = resolveModel(config.alias, { dataClass: config.dataClass });
  const result = await generateText({
    model,
    system: systemText(request.system),
    messages: toModelMessages(request.messages),
    allowSystemInMessages: true,
    tools: gatewayTools(request.tools),
    toolChoice: gatewayToolChoice(request.tool_choice),
    maxOutputTokens: request.max_tokens,
    temperature: request.temperature,
    topP: request.top_p,
    stopSequences: request.stop_sequences,
    maxRetries: 0,
    abortSignal: signal,
  });
  return {
    text: result.text,
    toolCalls: result.toolCalls.map((call) => ({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    })),
    finishReason: result.finishReason,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  };
};

function validateRequest(value: unknown): value is AnthropicMessagesRequest {
  if (!value || typeof value !== 'object') return false;
  const req = value as Partial<AnthropicMessagesRequest>;
  return (
    typeof req.model === 'string' &&
    Array.isArray(req.messages) &&
    Number.isInteger(req.max_tokens) &&
    Number(req.max_tokens) > 0
  );
}

type AnthropicResponseBlock = Exclude<AnthropicBlock, { type: 'tool_result' }>;

function responseBlocks(result: GatewayResult): AnthropicResponseBlock[] {
  const blocks: AnthropicResponseBlock[] = [];
  if (result.text) blocks.push({ type: 'text', text: result.text });
  for (const call of result.toolCalls) {
    blocks.push({ type: 'tool_use', id: call.toolCallId, name: call.toolName, input: call.input });
  }
  return blocks;
}

function stopReason(result: GatewayResult): 'tool_use' | 'max_tokens' | 'end_turn' {
  if (result.toolCalls.length > 0 || result.finishReason === 'tool-calls') return 'tool_use';
  if (result.finishReason === 'length') return 'max_tokens';
  return 'end_turn';
}

function tokenCount(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
}

function writeEvent(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function streamResponse(
  res: ServerResponse,
  request: AnthropicMessagesRequest,
  result: GatewayResult,
) {
  const id = `msg_${randomUUID().replaceAll('-', '')}`;
  const inputTokens = result.usage.inputTokens ?? tokenCount(request.messages);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  writeEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  });
  responseBlocks(result).forEach((block, index) => {
    if (block.type === 'text') {
      writeEvent(res, 'content_block_start', {
        type: 'content_block_start', index, content_block: { type: 'text', text: '' },
      });
      writeEvent(res, 'content_block_delta', {
        type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text },
      });
    } else {
      writeEvent(res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      writeEvent(res, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      });
    }
    writeEvent(res, 'content_block_stop', { type: 'content_block_stop', index });
  });
  writeEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason(result), stop_sequence: null },
    usage: { output_tokens: result.usage.outputTokens ?? tokenCount(responseBlocks(result)) },
  });
  writeEvent(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

export function createAnthropicGateway(
  config: GatewayConfig,
  generate: GatewayGenerate = defaultGatewayGenerate,
): Server {
  const limit = config.requestLimitBytes ?? 8 * 1024 * 1024;
  return createServer(async (req, res) => {
    if (process.env.CCO_CLAUDE_ROUTER_DEBUG === '1') {
      console.error(`[claude-router] ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'}`);
    }
    res.setHeader('x-content-type-options', 'nosniff');
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'HEAD' && pathname === '/api/hello') {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === 'GET' && pathname === '/health') {
      json(res, 200, { status: 'ok', alias: config.alias });
      return;
    }
    if (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(pathname)) {
      apiError(res, 404, 'Not found', 'not_found_error');
      return;
    }
    if (!authorized(req, config.token)) {
      apiError(res, 401, 'Invalid gateway token', 'authentication_error');
      return;
    }
    let body: unknown;
    try {
      body = await readBody(req, limit);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'request_too_large';
      apiError(res, tooLarge ? 413 : 400, tooLarge ? 'Request body too large' : 'Invalid JSON');
      return;
    }
    if (pathname === '/v1/messages/count_tokens') {
      json(res, 200, { input_tokens: tokenCount(body) });
      return;
    }
    if (!validateRequest(body)) {
      apiError(res, 400, 'model, messages, and positive max_tokens are required');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10 * 60_000);
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const result = await generate(body, config, controller.signal);
      if (body.stream) {
        streamResponse(res, body, result);
      } else {
        json(res, 200, {
          id: `msg_${randomUUID().replaceAll('-', '')}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: responseBlocks(result),
          stop_reason: stopReason(result),
          stop_sequence: null,
          usage: {
            input_tokens: result.usage.inputTokens ?? tokenCount(body.messages),
            output_tokens: result.usage.outputTokens ?? tokenCount(responseBlocks(result)),
          },
        });
      }
    } catch (error) {
      if (process.env.CCO_CLAUDE_ROUTER_DEBUG === '1') {
        const name = error instanceof Error ? error.name : 'UnknownError';
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[claude-router] ${name}: ${message}`);
      }
      if (!res.headersSent) {
        apiError(
          res,
          controller.signal.aborted ? 504 : 502,
          controller.signal.aborted ? 'Gateway request timed out' : 'Upstream generation failed',
          'api_error',
        );
      } else {
        res.destroy(error instanceof Error ? error : undefined);
      }
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function listenAnthropicGateway(config: GatewayConfig, generate?: GatewayGenerate) {
  const server = createAnthropicGateway(config, generate);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port ?? 0, config.host ?? '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Gateway did not bind to TCP');
  return { server, host: config.host ?? '127.0.0.1', port: address.port };
}
