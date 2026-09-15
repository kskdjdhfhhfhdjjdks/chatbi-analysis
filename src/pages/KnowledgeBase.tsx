import { useState } from 'react';
import { BookOpen, Search, AlertTriangle, CheckCircle2, Layers, Tag, ArrowRight } from 'lucide-react';
import { METRICS, validateAliasUniqueness } from '../data/metrics';
import { DIMENSIONS, DIMENSION_VALUES } from '../data/dimensions';
import { SectionTitle, StatusChip } from '../components/ui';

// ============================================================
// 知识库页：双知识库治理视图
// 这是「语义理解准确率 >90%」的地基，也是产品差异化的关键
// ============================================================

const DOMAIN_TONE: Record<string, 'brand' | 'accent' | 'warn' | 'ok' | 'danger' | 'muted'> = {
  用户规模: 'brand',
  留存与流失: 'accent',
  商业化: 'warn',
  增长效率: 'ok',
  产品体验: 'muted',
};

export function KnowledgeBase() {
  const [tab, setTab] = useState<'metric' | 'dimension' | 'governance'>('metric');
  const [q, setQ] = useState('');

  const conflicts = validateAliasUniqueness();

  const filteredMetrics = METRICS.filter((m) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      m.name.toLowerCase().includes(s) ||
      m.key.toLowerCase().includes(s) ||
      m.aliases.some((a) => a.toLowerCase().includes(s))
    );
  });

  const domains = [...new Set(METRICS.map((m) => m.domain))];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6">
      <div className="mb-5">
        <h1 className="text-[18px] font-semibold mb-1">语义知识库</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
          ChatBI 语义理解层依赖两个知识库：<b style={{ color: 'var(--text)' }}>指标知识库</b>（业务黑话 → 标准指标）
          与<b style={{ color: 'var(--text)' }}>维度知识库</b>（业务口径 → 数仓维度）。知识库质量直接决定语义理解准确率。
        </p>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
        {[
          { label: '指标总数', value: METRICS.length, sub: `${METRICS.reduce((a, m) => a + m.aliases.length, 0)} 个别名` },
          { label: '维度总数', value: DIMENSIONS.length, sub: '覆盖 6 个分析维度' },
          { label: '维度值别名', value: DIMENSION_VALUES.reduce((a, d) => a + d.aliases.length, 0), sub: `${DIMENSION_VALUES.length} 个标准值` },
          {
            label: '别名冲突',
            value: conflicts.length,
            sub: conflicts.length === 0 ? '校验通过' : '需处理',
          },
        ].map((s) => (
          <div key={s.label} className="card p-3.5">
            <div className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              {s.label}
            </div>
            <div className="text-[24px] font-semibold tracking-tight leading-8" style={{ color: s.label === '别名冲突' && s.value > 0 ? 'var(--danger)' : 'var(--text)' }}>
              {s.value}
            </div>
            <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Tab */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[
          { k: 'metric', label: '指标知识库', icon: <BookOpen size={14} /> },
          { k: 'dimension', label: '维度知识库', icon: <Layers size={14} /> },
          { k: 'governance', label: '知识库治理', icon: <CheckCircle2 size={14} /> },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as any)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all"
            style={{
              background: tab === t.k ? 'var(--brand)' : 'var(--bg-elev)',
              color: tab === t.k ? '#fff' : 'var(--text-2)',
              border: `1px solid ${tab === t.k ? 'var(--brand)' : 'var(--border)'}`,
              cursor: 'pointer',
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------- 指标知识库 ---------- */}
      {tab === 'metric' && (
        <div className="anim-in">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索指标名或别名，例如：客单价、ARPU、DAU"
              className="w-full rounded-lg border pl-9 pr-3 py-2 text-[13px] outline-none"
              style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>

          <div className="flex flex-col gap-3">
            {domains.map((d) => {
              const list = filteredMetrics.filter((m) => m.domain === d);
              if (!list.length) return null;
              return (
                <div key={d}>
                  <div className="flex items-center gap-2 mb-2">
                    <StatusChip tone={DOMAIN_TONE[d] ?? 'muted'}>{d}</StatusChip>
                    <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                      {list.length} 个指标
                    </span>
                  </div>
                  <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
                    {list.map((m) => (
                      <div key={m.key} className="p-3 first:pt-3" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-start gap-2 flex-wrap">
                          <span className="text-[13.5px] font-medium">{m.name}</span>
                          <span className="mono text-[11px] px-1.5 rounded" style={{ background: 'var(--bg-sub)', color: 'var(--text-3)' }}>
                            {m.key}
                          </span>
                          {m.isRatio && <StatusChip tone="accent">比率型</StatusChip>}
                          {m.generic && <StatusChip tone="warn">泛化词·强制澄清</StatusChip>}
                          <span className="text-[11.5px] ml-auto" style={{ color: 'var(--text-3)' }}>
                            单位：{{ count: '人数', ratio: '百分比', currency: '金额', duration: '秒', score: '分值' }[m.unit]}
                          </span>
                        </div>
                        <div className="text-[12px] mt-1" style={{ color: 'var(--text-2)' }}>
                          {m.desc}
                        </div>
                        <div className="flex items-start gap-1.5 mt-2 flex-wrap">
                          <Tag size={11} className="mt-1 shrink-0" style={{ color: 'var(--text-3)' }} />
                          {m.aliases.map((a) => (
                            <span
                              key={a}
                              className="text-[11.5px] px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--brand-soft)', color: 'var(--brand-text)' }}
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                        {m.isRatio && (
                          <div className="text-[11.5px] mt-2 mono" style={{ color: 'var(--text-3)' }}>
                            聚合口径：SUM({m.numerator}) / NULLIF(SUM({m.denominator}), 0)
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- 维度知识库 ---------- */}
      {tab === 'dimension' && (
        <div className="anim-in flex flex-col gap-3">
          {DIMENSIONS.map((d) => {
            const vals = DIMENSION_VALUES.filter((v) => v.dimension === d.key);
            return (
              <div key={d.key} className="card p-3.5">
                <SectionTitle
                  icon={<Layers size={14} />}
                  title={d.name}
                  desc={`物理字段：${d.field}${vals.length ? ` · ${vals.length} 个标准值` : ''}`}
                />
                <div className="flex items-start gap-1.5 flex-wrap mb-2">
                  <span className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    维度别名：
                  </span>
                  {d.aliases.map((a) => (
                    <span key={a} className="text-[11.5px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-sub)', color: 'var(--text-2)' }}>
                      {a}
                    </span>
                  ))}
                </div>

                {vals.length > 0 && (
                  <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                    <div className="text-[11.5px] mb-1.5" style={{ color: 'var(--text-3)' }}>
                      维度值归一化（业务口语 → 数仓标准值）：
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {vals.map((v) => (
                        <div key={v.value} className="flex items-start gap-2 flex-wrap">
                          <span className="text-[12px] font-medium shrink-0" style={{ minWidth: 56, color: 'var(--accent)' }}>
                            {v.value}
                          </span>
                          <ArrowRight size={11} className="mt-1 shrink-0" style={{ color: 'var(--text-3)' }} />
                          <div className="flex items-center gap-1 flex-wrap flex-1">
                            {v.aliases.map((a) => (
                              <span key={a} className="text-[11.5px] px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                                {a}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- 知识库治理 ---------- */}
      {tab === 'governance' && (
        <div className="anim-in flex flex-col gap-4">
          <div className="card p-4">
            <SectionTitle
              icon={conflicts.length ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
              title="别名唯一性校验"
              desc="禁止同一别名同时挂在两个指标上——这是 Badcase BC-002「客单价歧义」的直接防线，出现冲突时阻断上线。"
            />
            {conflicts.length === 0 ? (
              <div
                className="rounded-lg p-3 flex items-center gap-2 text-[13px]"
                style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}
              >
                <CheckCircle2 size={15} />
                校验通过：当前 {METRICS.length} 个指标、{METRICS.reduce((a, m) => a + m.aliases.length, 0)} 个别名，无跨指标重复。
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {conflicts.map((c) => (
                  <div
                    key={c.alias}
                    className="rounded-lg p-3 text-[12.5px]"
                    style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)' }}
                  >
                    <div className="font-medium" style={{ color: 'var(--danger)' }}>
                      别名「{c.alias}」被 {c.owners.length} 个指标共用
                    </div>
                    <div className="mt-1" style={{ color: 'var(--text-2)' }}>
                      归属：{c.owners.join('、')} —— 需剔除其一后重新上线。
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4">
            <SectionTitle
              icon={<BookOpen size={15} />}
              title="知识库建设方法论"
              desc="从 0 到 1 沉淀业务语言，是语义理解准确率的根本来源。"
            />
            <div className="flex flex-col gap-2">
              {[
                {
                  t: '第一步：收集真实问法',
                  d: '从客服工单、数据群聊、BI 查询日志中批量捞取业务同学的原话，建立「问法语料库」，而不是闭门造词。',
                },
                {
                  t: '第二步：识别术语与歧义',
                  d: '按词频与歧义度分层：高频无歧义词直接入库；高频有歧义词（如「客单价」）必须做唯一化，或转为泛化词强制澄清。',
                },
                {
                  t: '第三步：绑定数仓口径',
                  d: '每个别名必须映射到唯一的物理字段与聚合口径（尤其是比率型指标，必须显式声明分子分母）。',
                },
                {
                  t: '第四步：建立治理机制',
                  d: '别名唯一性校验脚本 + 上线前评审 + 每周从 Badcase 回捞新词，形成「用起来 → 发现缺口 → 补齐 → 复测」的闭环。',
                },
              ].map((s, i) => (
                <div key={i} className="rounded-lg p-3" style={{ background: 'var(--bg-sub)' }}>
                  <div className="text-[13px] font-medium mb-1">{s.t}</div>
                  <div className="text-[12.5px] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
                    {s.d}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <SectionTitle
              icon={<AlertTriangle size={15} />}
              title="泛化词处理策略"
              desc="当用户只给上层概念时，绝不猜测，而是澄清。"
            />
            <div className="flex flex-col gap-2">
              {METRICS.filter((m) => m.generic).map((m) => (
                <div key={m.key} className="flex items-start gap-2 flex-wrap text-[12.5px]">
                  <StatusChip tone="warn">{m.name}</StatusChip>
                  <span style={{ color: 'var(--text-2)' }}>
                    触发词：{m.aliases.join('、')} —— 命中后强制进入澄清流程
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
