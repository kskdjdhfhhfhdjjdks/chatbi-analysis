// ============================================================
// 大模型代理层验证（HTTP 契约）
//
// 不起外部服务、不需要真实 API Key：
// 在同一个进程里起一个假的 DeepSeek 上游，然后把 Netlify Function
// 当成普通 handler 直接调用，验证的是「代理层的契约」——
//   · 没有 Key 时必须明确拒绝，而不是静默失败
//   · 转发给上游的参数必须是我们以为的那几个
//   · 超长 / 超量 / 非法请求必须被挡住
//   · 限流必须真的生效
//
// 这一层最容易出的事故是：密钥被写进前端、或者限流失效导致额度被刷。
// 所以它值得被断言守住，而不是靠人记得。
// ============================================================

import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { askLLM, planToParsed } from '../../src/engine/llm';
import { runPipeline } from '../../src/engine/pipeline';

let fail = 0;
function ok(cond: boolean, name: string, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    fail++;
    console.log(`  × ${name}${extra ? `  ${extra}` : ''}`);
  }
}

const PLAN = {
  intent: 'query',
  metric: 'cac',
  dimensions: ['channel'],
  filters: [],
  timeRange: { start: '2026-08-15', end: '2026-09-13', label: '近30天', trend: false, granularity: 'day' },
  clarifyQuestion: null,
  clarifyOptions: [],
  reply: null,
  reason: '各渠道获客成本对比',
};

interface Seen {
  model?: string;
  thinking?: { type?: string };
  responseFormat?: string;
  temperature?: number;
  maxTokens?: number;
  systemLen?: number;
}

const seen: Seen[] = [];

const upstream = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c as Buffer));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');

  seen.push({
    model: body.model,
    thinking: body.thinking,
    responseFormat: body.response_format?.type,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    systemLen: body.messages?.[0]?.content?.length ?? 0,
  });

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: JSON.stringify(PLAN) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1200, completion_tokens: 90, total_tokens: 1290 },
    }),
  );
});

await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const addr = upstream.address() as { port: number };

process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${addr.port}`;
process.env.DEEPSEEK_API_KEY = 'test-key';
process.env.DEEPSEEK_MODEL = 'deepseek-flash';

const mod = await import(pathToFileURL(path.resolve('netlify/functions/chat.mjs')).href);
const handler = mod.default as (req: Request, ctx: { ip: string }) => Promise<Response>;

function post(body: unknown, ip = '10.0.0.1'): Promise<Response> {
  return handler(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { ip },
  );
}

const goodBody = { messages: [{ role: 'user', content: '近30天各渠道获客成本对比' }] };

console.log('\n[0] 真实客户端提示词 → 代理 → 模拟上游 → 计划校验 → 聚合');
{
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => input === '/api/chat'
    ? handler(new Request('http://localhost/api/chat', init), { ip: '10.5.0.1' })
    : nativeFetch(input, init);
  try {
    const answer = await askLLM('近30天各渠道获客成本对比', {
      history: [{ role: 'user', content: '先看获客成本' }],
    });
    ok(answer.ok, '完整提示词通过代理参数限制', answer.error);
    if (answer.parsed) {
      const out = runPipeline('近30天各渠道获客成本对比', {}, { parsedOverride: answer.parsed });
      ok(out.engine === 'llm' && out.result?.rows.length === 5, '从真实客户端请求到五渠道结果闭环');
    }
  } finally { globalThis.fetch = nativeFetch; }
}

console.log('\n[1] 健康检查：如实报告服务端是否配置了 Key');
{
  const res = await handler(new Request('http://localhost/api/chat', { method: 'GET' }), { ip: '10.0.0.2' });
  const data = await res.json();
  ok(res.status === 200, 'GET 返回 200');
  ok(data.configured === true, '已配置 Key 时 configured=true');
  ok(data.model === 'deepseek-flash', '模型名可见（便于排查）', String(data.model));
  ok(!JSON.stringify(data).includes('test-key'), '响应中不包含密钥');
}

console.log('\n[2] 正常转发：上游收到的参数必须符合预期');
{
  const res = await post(goodBody, '10.0.0.3');
  const data = await res.json();
  ok(res.status === 200, '返回 200');
  ok(data.ok === true, 'ok=true');
  ok(data.usage?.total === 1290, 'usage 透传');

  const last = seen[seen.length - 1];
  ok(last.model === 'deepseek-flash', '模型名正确', String(last.model));
  ok(last.thinking?.type === 'disabled', '思考模式已关闭（语义解析要快、要稳）', JSON.stringify(last.thinking));
  ok(last.responseFormat === 'json_object', '强制 JSON 输出', String(last.responseFormat));
  ok(last.temperature === 0, 'temperature=0（可复现）', String(last.temperature));
  ok(last.maxTokens === 900, 'max_tokens 有上限', String(last.maxTokens));
  ok((last.systemLen ?? 0) < 12000, '系统提示词体积可控', `${last.systemLen} 字符`);
}

console.log('\n[3] 端到端闭环：代理返回的计划能被前端校验接受');
{
  const res = await post(goodBody, '10.0.0.4');
  const data = await res.json();
  const plan = JSON.parse(data.content);
  const parsed = planToParsed(plan);
  ok(!!parsed, '计划通过知识库校验');
  ok(parsed?.metrics[0]?.key === 'cac', '指标解析正确');
  ok(parsed?.dimensions.some((d) => d.key === 'channel'), '维度解析正确');
}

console.log('\n[4] 输入约束：超量 / 超长 / 非法格式必须被挡住');
{
  const many = { messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'hi' })) };
  const r1 = await post(many, '10.0.0.5');
  ok(r1.status === 400, '超过 4 条消息 → 400', String(r1.status));

  const huge = { messages: [{ role: 'user', content: 'x'.repeat(7000) }] };
  const r2 = await post(huge, '10.0.0.6');
  ok(r2.status === 400, '单条超 6000 字 → 400', String(r2.status));

  const bad = await handler(
    new Request('http://localhost/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }),
    { ip: '10.0.0.7' },
  );
  ok(bad.status === 400, '非法 JSON → 400', String(bad.status));

  const empty = await post({ messages: [] }, '10.0.0.8');
  ok(empty.status === 400, '空 messages → 400', String(empty.status));

  const wrongMethod = await handler(new Request('http://localhost/api/chat', { method: 'DELETE' }), { ip: '10.0.0.9' });
  ok(wrongMethod.status === 405, 'DELETE → 405', String(wrongMethod.status));
}

console.log('\n[5] 限流：公开演示站必须防止额度被刷');
{
  let limited = 0;
  for (let i = 0; i < 32; i++) {
    const r = await post(goodBody, '10.9.9.9');
    if (r.status === 429) limited++;
  }
  ok(limited >= 1, '同一 IP 高频请求会被限流', `429 次数=${limited}`);
  const other = await post(goodBody, '10.9.9.10');
  ok(other.status === 200, '限流按 IP 隔离，不影响其他用户', String(other.status));
}

console.log('\n[6] 未配置 Key：必须明确拒绝，而不是假装在答');
{
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  const res = await post(goodBody, '10.0.1.1');
  const data = await res.json();
  ok(res.status === 503, '返回 503', String(res.status));
  ok(data.code === 'NO_KEY', '错误码为 NO_KEY', String(data.code));
  process.env.DEEPSEEK_API_KEY = saved;
}

console.log('\n[7] 上游异常：错误信息不得泄露上游细节');
{
  const saved = process.env.DEEPSEEK_BASE_URL;
  process.env.DEEPSEEK_BASE_URL = 'http://127.0.0.1:1';
  const res = await post(goodBody, '10.0.2.1');
  const data = await res.json();
  ok(res.status === 502, '上游不可达 → 502', String(res.status));
  ok(data.code === 'NETWORK_ERROR', '错误码为 NETWORK_ERROR', String(data.code));
  ok(!JSON.stringify(data).includes('test-key'), '错误响应中不含密钥');
  process.env.DEEPSEEK_BASE_URL = saved;
}

upstream.closeAllConnections();
await new Promise<void>(resolve => upstream.close(() => resolve()));

console.log(`\n${fail === 0 ? '大模型代理层验证通过 ✓' : `${fail} 项失败 <<<`}\n`);
process.exitCode = fail === 0 ? 0 : 1;
