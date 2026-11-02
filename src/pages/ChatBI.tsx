import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Sparkles,
  Send,
  Loader2,
  Code2,
  GitBranch,
  Table2,
  Lightbulb,
  HelpCircle,
  RotateCcw,
  CornerDownLeft,
} from 'lucide-react';
import type { ChatMessage, ClarifyOption } from '../types';
import { runPipeline } from '../engine/pipeline';
import { parseQuery } from '../engine/parser';
import { askLLM, isLlmEnabled, setLlmEnabled, probeLLM } from '../engine/llm';
import { ChartView } from '../components/Charts';
import { TracePanel } from '../components/TracePanel';
import { AttributionPanel } from '../components/AttributionPanel';
import { MecePanel } from '../components/MecePanel';
import { CodeBlock, DataTable, StatusChip, SectionTitle, Collapse } from '../components/ui';
import { validateAliasUniqueness } from '../data/metrics';
import { buildSuggestions, buildStrategySuggestions, type Suggestion } from '../engine/suggest';
import { DATA_START, DATA_END, TODAY } from '../data/facts';

// ============================================================
// ChatBI 主界面：对话式智能问数
// ============================================================

const SUGGESTIONS = [
  { text: '昨天的日活是多少', tag: '基础问数' },
  { text: '近30天各渠道的获客成本对比', tag: '维度对比' },
  { text: '安卓端DAU为什么掉了', tag: '异常归因' },
  { text: '用户粘性怎么样', tag: '业务黑话' },
  { text: '各渠道的ROI', tag: '黑话+对比' },
  { text: '留存怎么样', tag: '意图澄清' },
  { text: '企业版的7日留存为什么降了', tag: '归因下钻' },
  { text: '苹果端的日活趋势', tag: '维度值归一化' },
  { text: '哪些渠道值得加投', tag: 'MECE 子问题拆解' },
  { text: '怎么提升留存', tag: 'MECE 子问题拆解' },
];

let idSeq = 0;
const nextId = () => `m${++idSeq}`;

export function ChatBI() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [llmOn, setLlmOn] = useState<boolean>(() => isLlmEnabled());
  const [serverLlm, setServerLlm] = useState<{ configured: boolean; model: string } | null>(null);
  const [llmBroken, setLlmBroken] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, thinking]);

  // 探测服务端是否配置了 Key：没配就如实标注，而不是假装模型在答
  useEffect(() => {
    let alive = true;
    probeLLM().then((r) => {
      if (alive) setServerLlm(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  const aliasConflicts = validateAliasUniqueness();

  async function submit(text: string) {
    const q = text.trim();
    if (!q || busyRef.current) return;
    busyRef.current = true;
    setInput('');

    // 上下文继承：取上一条成功的问数结果
    const prevAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.result && m.parsed?.intent === 'query');
    const ctx = prevAssistant?.parsed
      ? {
          lastMetric: prevAssistant.parsed.metrics[0],
          lastTime: prevAssistant.parsed.timeRange,
          lastDimensions: prevAssistant.parsed.dimensions,
          lastFilters: prevAssistant.parsed.dimensionValues,
        }
      : {};

    setMessages((m) => [...m, { id: nextId(), role: 'user', content: q, timestamp: Date.now() }]);
    setThinking(true);

    const t0 = performance.now();
    let out: ReturnType<typeof runPipeline> | null = null;
    let engineNote = '';
    let engineLatency = 0;

    // 策略类问题走预定义 MECE 模板：模型没有参与拆解，如实说明，避免夸大
    try {
    const baseline = parseQuery(q, ctx);
    const isStrategy = baseline.intent === 'strategy';
    const canUseLLM = llmOn && !llmBroken && serverLlm?.configured !== false;

    if (baseline.intent === 'unsafe') {
      engineNote = '安全前置校验拦截，未发送给模型';
    } else if (canUseLLM && isStrategy) {
      engineNote = '策略问题走预定义 MECE 模板，未经过模型';
    } else if (canUseLLM) {
      const r = await askLLM(q, {
        lastMetric: ctx.lastMetric,
        lastTime: ctx.lastTime,
        lastDimensions: ctx.lastDimensions,
        lastFilters: ctx.lastFilters,
        history: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
      });
      engineLatency = r.latency;

      if (r.ok && r.parsed) {
        if (r.parsed.needClarify) {
          r.parsed.timeRange = baseline.timeRange;
          r.parsed.dimensionValues = baseline.dimensionValues;
          r.parsed.dimensions = baseline.dimensions;
        }
        out = runPipeline(q, ctx, { parsedOverride: r.parsed, answerOverride: r.answerOverride });
        engineNote = `${r.model ?? 'deepseek'} · ${r.latency}ms`;
      } else {
        engineNote = `已降级为规则引擎：${r.error ?? '模型不可用'}`;
        // 配置类 / 网络类错误只记一次，避免每条消息都白等一次超时
        if (r.code === 'NO_KEY') setLlmBroken(true);
      }
    }

    if (!out) {
      out = runPipeline(q, ctx);
      if (!engineNote) engineNote = !llmOn ? '已手动关闭大模型' : serverLlm?.configured === false || llmBroken ? '服务端未配置密钥，使用规则引擎' : '使用规则引擎';
    }

    // 保底动效：命中极快时也留一点「思考」节奏，避免闪烁
    const elapsed = performance.now() - t0;
    if (elapsed < 420) await new Promise((res) => setTimeout(res, 420 - elapsed));

    const msg: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: out.answer,
      parsed: out.parsed,
      sql: out.sql ?? undefined,
      result: out.result ?? undefined,
      attribution: out.attribution ?? undefined,
      mece: out.mece ?? undefined,
      trace: out.trace,
      chart: out.chart ?? undefined,
      clarify: out.parsed.needClarify ? out.parsed.clarifyOptions : undefined,
      clarifyReason: out.parsed.clarifyReason,
      engine: out.engine,
      engineNote,
      engineLatency,
      timestamp: Date.now(),
    };
    setMessages((m) => [...m, msg]);
    } catch {
      setMessages(m => [...m, { id: nextId(), role: 'assistant', content: '本次分析未完成，请重试或换一种问法。', timestamp: Date.now() }]);
    } finally {
      busyRef.current = false;
      setThinking(false);
    }
  }

  function onClarify(opt: ClarifyOption, source: ChatMessage) {
    // 用澄清选项替换原问题中的模糊部分，重新提问
    const parts: string[] = [opt.value];
    const lastTime = source.parsed?.timeRange;
    if (lastTime) parts.push(`${lastTime.start} 至 ${lastTime.end}`);
    for (const f of source.parsed?.dimensionValues ?? []) parts.push(f.value);
    for (const d of source.parsed?.dimensions ?? []) if (d.key !== 'dt') parts.push(`按${d.name}`);
    submit(parts.join(' '));
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ---------- 消息区 ---------- */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-8 py-6">
        <div className="max-w-4xl mx-auto flex flex-col gap-5">
          {isEmpty && <WelcomeCard onPick={submit} aliasConflictCount={aliasConflicts.length} />}

          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              onClarify={onClarify}
              onFollowup={submit}
            />
          ))}

          {thinking && (
            <div className="flex items-center gap-2.5 text-[13px]" style={{ color: 'var(--text-2)' }}>
              <Loader2 size={15} className="animate-spin" style={{ color: 'var(--brand)' }} />
              <span className="pulse">
                {llmOn && !llmBroken && serverLlm?.configured !== false
                  ? '大模型正在理解问题 → 生成查询计划 → 引擎执行…'
                  : '正在解析语义 → 生成 SQL → 执行查询…'}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ---------- 输入区 ---------- */}
      <div className="shrink-0 border-t px-4 sm:px-8 py-3" style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto">
          <div
            className="flex items-end gap-2 rounded-xl border px-3 py-2 transition-all"
            style={{ background: 'var(--bg)', borderColor: 'var(--border-strong)' }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              rows={1}
              maxLength={1500}
              placeholder="用业务语言提问，例如：近30天各渠道的获客成本对比"
              className="flex-1 resize-none bg-transparent outline-none text-[14px] leading-6 py-1.5 max-h-32"
              style={{ color: 'var(--text)' }}
            />
            <button
              onClick={() => submit(input)}
              disabled={!input.trim() || thinking}
              className="shrink-0 rounded-lg p-2 transition-all disabled:opacity-35"
              style={{ background: 'var(--brand)', color: '#fff' }}
              title="发送（Enter）"
            >
              <Send size={16} />
            </button>
          </div>
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              模拟数据 {DATA_START} 至 {DATA_END} · 演示时钟 {TODAY} · Enter 发送
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {!llmOn ? '规则模式' : serverLlm?.configured && !llmBroken ? `已配置 ${serverLlm.model}` : '规则模式 · 模型未连接'}
              </span>
              <button className="text-[11px]" disabled={thinking} onClick={async () => {
                setLlmBroken(false);
                setServerLlm(await probeLLM());
              }}>重新检测</button>
              <button
                disabled={thinking}
                onClick={() => {
                  const next = !llmOn;
                  setLlmOn(next);
                  setLlmEnabled(next);
                }}
                className="text-[11px] flex items-center gap-1.5 transition-opacity hover:opacity-70"
                style={{ color: llmOn ? 'var(--brand)' : 'var(--text-3)' }}
                title={
                  serverLlm && !serverLlm.configured
                    ? '服务端未配置 DEEPSEEK_API_KEY，当前实际由规则引擎回答'
                    : '关闭后使用确定性的规则引擎解析，便于对照两种实现'
                }
              >
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: 7,
                    height: 7,
                    background: llmOn && !llmBroken && serverLlm?.configured ? 'var(--brand)' : 'var(--text-3)',
                  }}
                />
                大模型语义层{llmOn ? ' 开' : ' 关'}
              </button>
              {messages.length > 0 && (
                <button
                  disabled={thinking}
                  onClick={() => setMessages([])}
                  className="text-[11px] flex items-center gap-1 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-3)' }}
                >
                  <RotateCcw size={11} /> 清空对话
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- 欢迎卡片 ----------
function WelcomeCard({ onPick, aliasConflictCount }: { onPick: (t: string) => void; aliasConflictCount: number }) {
  return (
    <div className="anim-in">
      <div className="card p-5 mb-4">
        <div className="flex items-start gap-3">
          <div
            className="rounded-xl flex items-center justify-center shrink-0"
            style={{ width: 42, height: 42, background: 'var(--brand)', color: '#fff' }}
          >
            <Sparkles size={21} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold mb-1">对话式智能问数（ChatBI）</h2>
            <p className="text-[13px] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
              用业务语言直接提问，系统自动完成
              <b style={{ color: 'var(--text)' }}> 语义理解 → SQL 生成 → 安全校验 → 查询执行 → 可视化归因 </b>
              全链路。数据为内置 SaaS 增长主题模拟数据集，共 200,000+ 行明细。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          {[
            { k: '指标知识库', v: '30+ 指标 / 别名' },
            { k: '维度知识库', v: '7 维度 / 40+ 值别名' },
            { k: '安全机制', v: '3 层拦截' },
            { k: '知识库校验', v: aliasConflictCount === 0 ? '别名零冲突' : `${aliasConflictCount} 处冲突` },
          ].map((s) => (
            <div key={s.k} className="rounded-lg p-2.5" style={{ background: 'var(--bg-sub)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {s.k}
              </div>
              <div className="text-[13px] font-semibold mt-0.5">{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[12.5px] font-medium mb-2 px-1" style={{ color: 'var(--text-2)' }}>
        试试这些问题（覆盖不同能力）：
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            onClick={() => onPick(s.text)}
            className="card p-3 text-left transition-all hover:-translate-y-0.5 flex items-center gap-2.5"
            style={{ cursor: 'pointer' }}
          >
            <span className="flex-1 text-[13px]">{s.text}</span>
            <StatusChip tone="muted">{s.tag}</StatusChip>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- 消息气泡 ----------
function MessageBubble({
  msg,
  onClarify,
  onFollowup,
}: {
  msg: ChatMessage;
  onClarify: (o: ClarifyOption, source: ChatMessage) => void;
  onFollowup: (t: string) => void;
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end anim-in">
        <div
          className="rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%] text-[14px]"
          style={{ background: 'var(--brand)', color: '#fff' }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  const metric = msg.parsed?.metrics[0];
  const unit = metric?.unit;
  const isUnsafe = msg.parsed?.intent === 'unsafe';
  const isChat = msg.parsed?.intent === 'chat';

  return (
    <div className="flex gap-3 anim-in">
      <div
        className="rounded-xl flex items-center justify-center shrink-0"
        style={{
          width: 32,
          height: 32,
          background: isUnsafe ? 'var(--danger-soft)' : 'var(--bg-sub)',
          color: isUnsafe ? 'var(--danger)' : 'var(--brand)',
        }}
      >
        <Bot size={17} />
      </div>

      <div className="min-w-0 flex-1">
        {/* 回答文本 */}
        <div
          className="rounded-2xl rounded-tl-sm px-4 py-3 text-[13.5px] leading-[1.75] whitespace-pre-wrap"
          style={{
            background: 'var(--bg-elev)',
            border: `1px solid ${isUnsafe ? 'var(--danger)' : 'var(--border)'}`,
            color: isUnsafe ? 'var(--danger)' : 'var(--text)',
          }}
        >
          {msg.content}
        </div>

        {/* 引擎来源：如实标注这条回答是谁解析的 */}
        {msg.engine && (
          <div
            className="mt-1.5 ml-1 flex items-center gap-1.5 text-[10.5px] flex-wrap"
            style={{ color: 'var(--text-3)' }}
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: 5,
                height: 5,
                background: msg.engine === 'llm' ? 'var(--brand)' : 'var(--text-3)',
              }}
            />
            <span style={{ color: msg.engine === 'llm' ? 'var(--brand)' : 'var(--text-2)' }}>
              {msg.engine === 'llm' ? '大模型语义解析' : '规则引擎解析'}
            </span>
            {msg.engineNote && <span>· {msg.engineNote}</span>}
          </div>
        )}

        {/* 意图澄清 */}
        {msg.clarify && msg.clarify.length > 0 && (
          <div className="card p-3 mt-2">
            <SectionTitle
              icon={<HelpCircle size={15} />}
              title="需要你确认口径"
              desc={msg.clarifyReason}
            />
            <div className="grid sm:grid-cols-2 gap-2">
              {msg.clarify.map((o) => (
                <button
                  key={o.value}
                  onClick={() => onClarify(o, msg)}
                  className="rounded-lg border p-2.5 text-left transition-all hover:-translate-y-0.5"
                  style={{ background: 'var(--brand-soft)', borderColor: 'var(--brand)', cursor: 'pointer' }}
                >
                  <div className="text-[13px] font-medium" style={{ color: 'var(--brand-text)' }}>
                    {o.label}
                  </div>
                  {o.desc && (
                    <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                      {o.desc}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 图表 */}
        {msg.chart && !msg.clarify?.length && (
          <div className="card p-3 mt-2">
            <ChartView spec={msg.chart} />
          </div>
        )}

        {/* MECE 子问题拆解（策略类问题专属） */}
        {msg.mece && (
          <>
            <div className="card p-3.5 mt-2">
              <MecePanel mece={msg.mece} />
            </div>
            {msg.trace && (
              <div className="mt-2">
                <Collapse title="处理链路透视" icon={<Sparkles size={14} />}>
                  <TracePanel trace={msg.trace} />
                </Collapse>
              </div>
            )}
          </>
        )}

        {/* 数据表 + SQL + 链路（折叠） */}
        {!isChat && !msg.clarify?.length && !msg.mece && (msg.result || msg.sql) && (
          <div className="mt-2 flex flex-col gap-1.5">
            {msg.result && msg.result.rows.length > 0 && (
              <Collapse
                title="查询结果明细"
                icon={<Table2 size={14} />}
                badge={<StatusChip tone="muted">{msg.result.rows.length} 行</StatusChip>}
              >
                <DataTable columns={msg.result.columns} rows={msg.result.rows} />
              </Collapse>
            )}

            {msg.sql?.sql && (
              <Collapse
                title={msg.sql.blocked ? 'SQL（已拦截，仅供参考）' : '生成的 SQL'}
                icon={<Code2 size={14} />}
                badge={
                  msg.sql.blocked ? (
                    <StatusChip tone="danger">已拦截</StatusChip>
                  ) : (
                    <StatusChip tone="ok">安全通过</StatusChip>
                  )
                }
              >
                <CodeBlock code={msg.sql.sql} />
                {msg.sql.securityHits && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {msg.sql.securityHits.map((h, i) => (
                      <StatusChip key={i} tone={msg.sql!.blocked ? 'danger' : 'ok'}>
                        {h}
                      </StatusChip>
                    ))}
                  </div>
                )}
              </Collapse>
            )}

            {msg.attribution && (
              <Collapse
                title="归因下钻分析"
                icon={<GitBranch size={14} />}
                defaultOpen={msg.attribution.isAnomaly}
                badge={
                  <StatusChip tone={msg.attribution.isAnomaly ? 'warn' : 'accent'}>
                    {msg.attribution.isAnomaly ? '已定位根因' : '正常波动'}
                  </StatusChip>
                }
              >
                <AttributionPanel attr={msg.attribution} unit={unit} />
              </Collapse>
            )}

            {msg.trace && (
              <Collapse title="处理链路透视" icon={<Sparkles size={14} />}>
                <TracePanel trace={msg.trace} />
              </Collapse>
            )}
          </div>
        )}

        {/* 追问建议 */}
        {!isUnsafe && !isChat && !msg.clarify?.length && msg.parsed && msg.parsed.metrics.length > 0 && (
          <Followups
            parsed={msg.parsed}
            onPick={onFollowup}
            hasMece={!!msg.mece}
            hasAttribution={!!msg.attribution}
            isAnomaly={!!msg.attribution?.isAnomaly}
          />
        )}
        {msg.mece && <MeceFollowups onPick={onFollowup} question={msg.mece.question} />}
      </div>
    </div>
  );
}

/** 建议类型 → 图标 + 文案标签 */
const SUGGESTION_META: Record<Suggestion['kind'], { icon: typeof Lightbulb; label: string }> = {
  dimension: { icon: Table2, label: '下钻维度' },
  metric: { icon: Sparkles, label: '相关指标' },
  trend: { icon: GitBranch, label: '看趋势' },
  drill: { icon: HelpCircle, label: '归因下钻' },
  strategy: { icon: Lightbulb, label: '策略视角' },
};

/**
 * 追问建议条：基于当前上下文动态生成，而不是固定一组按钮
 *
 * 交互约定：
 * - 首条（权重最高）内联展示 reason，让「为什么推荐它」一眼可见
 * - 其余条用 title 悬浮提示，鼠标移上去才展开，避免整行文字过密
 */
function FollowupBar({ suggestions, onPick, hint = '继续追问' }: {
  suggestions: Suggestion[];
  onPick: (t: string) => void;
  hint?: string;
}) {
  if (!suggestions.length) return null;
  const [first, ...rest] = suggestions;
  const FirstIcon = SUGGESTION_META[first.kind].icon;

  return (
    <div className="mt-2.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11.5px] flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
          <Lightbulb size={11} /> {hint}
        </span>

        {/* 首条：权重最高，把推荐理由直接写出来 */}
        <button
          onClick={() => onPick(first.text)}
          className="rounded-full border px-2.5 py-1 text-[11.5px] transition-all hover:-translate-y-0.5 flex items-center gap-1"
          style={{
            background: 'var(--accent-soft)',
            borderColor: 'var(--accent)',
            color: 'var(--accent)',
            cursor: 'pointer',
          }}
        >
          <FirstIcon size={10} />
          {first.text}
          <CornerDownLeft size={10} />
        </button>

        {rest.map((s) => {
          const Icon = SUGGESTION_META[s.kind].icon;
          return (
            <button
              key={s.text}
              onClick={() => onPick(s.text)}
              title={s.reason}
              className="rounded-full border px-2.5 py-1 text-[11.5px] transition-all hover:-translate-y-0.5 flex items-center gap-1"
              style={{ background: 'var(--bg-elev)', borderColor: 'var(--border-strong)', color: 'var(--text-2)', cursor: 'pointer' }}
            >
              <Icon size={10} style={{ opacity: 0.6 }} />
              {s.text}
              <CornerDownLeft size={10} />
            </button>
          );
        })}
      </div>

      {/* 首条推荐理由：一行小字，解释「为什么推荐这个方向」 */}
      <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
        推荐「{first.text}」：{first.reason}
      </div>
    </div>
  );
}

/** 基于当前上下文生成追问建议 */
function Followups({
  parsed,
  onPick,
  hasMece,
  hasAttribution,
  isAnomaly,
}: {
  parsed: NonNullable<ChatMessage['parsed']>;
  onPick: (t: string) => void;
  hasMece: boolean;
  hasAttribution: boolean;
  isAnomaly: boolean;
}) {
  const suggestions = buildSuggestions(parsed, { hasMece, hasAttribution, isAnomaly });
  return <FollowupBar suggestions={suggestions} onPick={onPick} />;
}

/** MECE 策略类问题的追问建议（引导继续用策略视角提问） */
function MeceFollowups({ onPick, question }: { onPick: (t: string) => void; question: string }) {
  const suggestions = buildStrategySuggestions(question);
  return <FollowupBar suggestions={suggestions} onPick={onPick} hint="换个策略视角" />;
}
