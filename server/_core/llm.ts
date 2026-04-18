import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const resolveApiUrl = () =>
  ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
    : process.env.OPENAI_BASE_URL
      ? `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`
      : "https://api.manus.im/api/llm-proxy/v1/chat/completions";

const assertApiKey = () => {
  if (!ENV.forgeApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};


// ── API 類型偵測 ──
const isSoxioKey = (key: string) => key.startsWith("cr_");
const isSoxioUrl = (url: string) => url.includes("soxio.me");

// ── soxio Responses API 呼叫（stream=true，SSE 格式）──
async function invokeSoxioResponsesAPI(
  messages: Array<{ role: string; content: string }>,
  model: string,
  apiKey: string,
  maxTokens: number
): Promise<string> {
  // soxio 使用 OpenAI Responses API 格式，input 必須是 list，且 stream=true
  const systemMsg = messages.find(m => m.role === "system");
  const inputMessages = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role,
    content: m.content,
  }));

  const payload: Record<string, unknown> = {
    model: model,
    input: inputMessages,
    stream: true,
  };
  if (systemMsg) {
    payload.instructions = systemMsg.content;
  }

  const TIMEOUT_MS = 120000;
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch("https://apikey.soxio.me/openai/v1/responses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`soxio API failed: ${response.status} – ${errorText}`);
        if ([502, 503, 429].includes(response.status) && attempt < MAX_RETRIES) {
          console.warn(`[soxio] 第 ${attempt} 次嘗試失敗 (${response.status})，${attempt * 3}s 後重試...`);
          await new Promise(r => setTimeout(r, attempt * 3000));
          lastError = err;
          continue;
        }
        throw err;
      }
      // 解析 SSE 串流，收集所有 output_text delta
      const rawText = await response.text();
      let fullText = "";
      for (const line of rawText.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") break;
        try {
          const event = JSON.parse(jsonStr) as Record<string, unknown>;
          // 最終完整回應在 response.completed 事件中
          if (event.type === "response.completed") {
            const resp = event.response as Record<string, unknown>;
            const output = resp?.output as Array<{ content: Array<{ type: string; text: string }> }>;
            if (output?.[0]?.content?.[0]?.text) {
              return output[0].content[0].text;
            }
          }
          // 也可從 delta 事件累積文字
          if (event.type === "response.output_text.delta") {
            const delta = event.delta as string;
            if (delta) fullText += delta;
          }
        } catch {
          // 忽略解析錯誤
        }
      }
      if (fullText) return fullText;
      throw new Error(`soxio: no text in response`);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name === "AbortError") {
        lastError = new Error(`soxio timeout after ${TIMEOUT_MS}ms (attempt ${attempt})`);
        console.warn(`[soxio] 第 ${attempt} 次嘗試超時，${attempt * 3}s 後重試...`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, attempt * 3000));
          continue;
        }
      } else {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("soxio API failed after all retries");
}

// ── 多模型策略：根據任務類型自動選擇模型，降低 API 成本 ──
export type ModelTier = "fast" | "balanced" | "deep";
export function resolveModel(tier?: ModelTier): string {
  const defaultModel = process.env.OPENAI_MODEL || "claude-opus-4-6";
  if (!tier) return defaultModel;
  switch (tier) {
    case "fast":     return process.env.OPENAI_MODEL_FAST     || "gemini-2.5-flash";
    case "balanced": return process.env.OPENAI_MODEL_BALANCED || defaultModel;
    case "deep":     return process.env.OPENAI_MODEL_DEEP     || defaultModel;
    default:         return defaultModel;
  }
}

export async function invokeLLM(params: InvokeParams & { tier?: ModelTier }): Promise<InvokeResult> {
  assertApiKey();
  // ── soxio key 快速路徑：cr_ 開頭的 key 必須走 Responses API（stream=true）──
  const _primaryKey = ENV.forgeApiKey ?? "";
  if (isSoxioKey(_primaryKey)) {
    const _model = resolveModel(params.tier);
    const _maxTokens = params.maxTokens ?? params.max_tokens ?? 32768;
    const _msgs = params.messages.map(m => ({
      role: String(m.role),
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
    const _text = await invokeSoxioResponsesAPI(_msgs, _model, _primaryKey, _maxTokens);
    return {
      choices: [{ message: { role: "assistant" as const, content: _text }, finish_reason: "stop", index: 0 }],
      model: _model,
      object: "chat.completion",
      id: `soxio-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
    } as InvokeResult;
  }
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    tier,
  } = params;

  const payload: Record<string, unknown> = {
    model: resolveModel(tier),
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  const maxTok = params.maxTokens ?? params.max_tokens;
  payload.max_tokens = maxTok ?? 32768;

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  // 重試機制：最多 3 次，每次超時 90 秒，502/503/429 自動重試
  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 90000;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(resolveApiUrl(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${ENV.forgeApiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
        );
        if ([502, 503, 429].includes(response.status) && attempt < MAX_RETRIES) {
          console.warn(`[LLM] 第 ${attempt} 次嘗試失敗 (${response.status})，${attempt * 3}s 後重試...`);
          await new Promise(r => setTimeout(r, attempt * 3000));
          lastError = err;
          continue;
        }
        throw err;
      }
      return (await response.json()) as InvokeResult;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name === "AbortError") {
        lastError = new Error(`LLM invoke timeout after ${TIMEOUT_MS}ms (attempt ${attempt})`);
        console.warn(`[LLM] 第 ${attempt} 次嘗試超時，${attempt * 3}s 後重試...`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, attempt * 3000));
          continue;
        }
      } else {
        throw err;
      }
    }
  }
  // ── 主 API 全部失敗，嘗試 soxio 備援 ──
  const soxioKey = process.env.SOXIO_API_KEY ?? process.env.LANYI_API_KEY ?? "";
  const primaryKey = ENV.forgeApiKey ?? "";
  if (soxioKey && !isSoxioKey(primaryKey)) {
    console.warn("[LLM] 主 API 全部失敗，切換至 soxio 備援 API...");
    const model = resolveModel(params.tier);
    const maxTokens = params.maxTokens ?? params.max_tokens ?? 32768;
    const normalizedMsgs = params.messages.map(m => ({
      role: String(m.role),
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
    const text = await invokeSoxioResponsesAPI(normalizedMsgs, model, soxioKey, maxTokens);
    return {
      choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop", index: 0 }],
      model,
      object: "chat.completion",
    } as unknown as InvokeResult;
  }
  throw lastError ?? new Error("LLM invoke failed after all retries");
}
