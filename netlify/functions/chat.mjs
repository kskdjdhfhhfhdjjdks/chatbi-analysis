// ============================================================
// DeepSeek 转发代理（Netlify Function，v2 格式）
//
// 这一层只做三件事，刻意不做别的：
//   1. 藏密钥 —— API Key 只存在于服务端环境变量，永远不进浏览器
//   2. 限流   —— 公开演示站，防止被刷爆额度
//   3. 转发   —— 原样把 messages 转给 DeepSeek，回传 content
//
// 为什么不在服务端做语义解析：
//   解析逻辑（schema、校验、执行）全在浏览器，服务端保持「哑管道」，
//   这样知识库只有一份，不会出现前后端口径漂移的问题。
// ============================================================

// 配置在每次请求时读取，而不是模块加载时固化：
// 这样同一份 handler 既能跑在 Netlify，也能被本地验证套件注入不同的上游地址。
function config() {
  return {
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  };
}

// 单次请求约束：宁可拒绝，也不让一次请求烧掉大量 token
const LIMITS = {
  maxMessages: 4,
  maxCharsPerMessage: 6000,
  maxTotalChars: 20000,
  maxTokens: 900,
  timeoutMs: 30000,
};

// 简易限流：进程内滑动窗口。
// 说明：Serverless 实例不共享内存，冷启动会重置，因此这是「成本兜底」而非严格配额。
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 30;
const rateBuckets = new Map();

function allowRequest(ip) {
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (bucket.length >= RATE_MAX) {
    rateBuckets.set(ip, bucket);
    return false;
  }
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  // 防止 Map 无限增长
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) rateBuckets.delete(k);
    }
  }
  return true;
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function badRequest(message) {
  return json(400, { ok: false, code: 'BAD_REQUEST', error: message });
}

export default async function handler(req, context) {
  // 健康检查：前端用它判断「服务端到底有没有配 Key」，避免用户误以为是大模型在答
  if (req.method === 'GET') {
    return json(200, {
      ok: true,
      configured: Boolean(process.env.DEEPSEEK_API_KEY),
      model: config().model,
      limits: { rateMax: RATE_MAX, rateWindowMinutes: RATE_WINDOW_MS / 60000 },
    });
  }

  if (req.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '只支持 POST' });

  if (!process.env.DEEPSEEK_API_KEY) {
    return json(503, {
      ok: false,
      code: 'NO_KEY',
      error: '服务端未配置 DEEPSEEK_API_KEY，已自动降级为规则引擎',
    });
  }

  const ip =
    (context && context.ip) ||
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for') ||
    'unknown';

  if (!allowRequest(ip)) {
    return json(429, {
      ok: false,
      code: 'RATE_LIMITED',
      error: '请求过于频繁，请稍后再试（已自动降级为规则引擎）',
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return badRequest('请求体不是合法 JSON');
  }

  const messages = payload && payload.messages;
  if (!Array.isArray(messages) || messages.length === 0) return badRequest('messages 必须是非空数组');
  if (messages.length > LIMITS.maxMessages) return badRequest(`messages 最多 ${LIMITS.maxMessages} 条`);

  let totalChars = 0;
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || typeof m.role !== 'string') return badRequest('messages 元素格式不合法');
    if (!['system', 'user', 'assistant'].includes(m.role)) return badRequest('不支持的消息角色');
    if (m.content.length > LIMITS.maxCharsPerMessage) return badRequest(`单条消息不得超过 ${LIMITS.maxCharsPerMessage} 字`);
    totalChars += m.content.length;
  }
  if (totalChars > LIMITS.maxTotalChars) return badRequest(`消息总长度不得超过 ${LIMITS.maxTotalChars} 字`);

  const startedAt = Date.now();
  const { baseUrl, model: modelName } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.timeoutMs);

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        // 关掉思考模式：语义解析要的是稳定、快、便宜，不需要长链推理
        thinking: { type: 'disabled' },
        temperature: 0,
        max_tokens: LIMITS.maxTokens,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: controller.signal,
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      // 只回传状态码与简要原因，绝不把上游响应里的敏感信息透给浏览器
      return json(502, {
        ok: false,
        code: 'UPSTREAM_ERROR',
        status: upstream.status,
        error: `上游返回 ${upstream.status}`,
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json(502, { ok: false, code: 'UPSTREAM_PARSE', error: '上游返回非 JSON' });
    }

    const choice = data.choices && data.choices[0];
    if (choice?.finish_reason === 'length') {
      return json(502, { ok: false, code: 'TRUNCATED', error: '模型输出被截断，请缩短问题后重试' });
    }
    const content = choice && choice.message && choice.message.content;
    if (typeof content !== 'string' || !content.trim()) {
      return json(502, {
        ok: false,
        code: 'EMPTY_CONTENT',
        error: '模型未返回内容',
        finishReason: choice && choice.finish_reason,
      });
    }

    return json(200, {
      ok: true,
      content,
      model: data.model || modelName,
      finishReason: choice.finish_reason,
      usage: data.usage
        ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens, total: data.usage.total_tokens }
        : null,
      latency: Date.now() - startedAt,
    });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return json(aborted ? 504 : 502, {
      ok: false,
      code: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      error: aborted ? `上游超时（>${LIMITS.timeoutMs / 1000}s）` : '网络请求失败',
    });
  } finally {
    clearTimeout(timer);
  }
}
