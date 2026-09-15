import { useState } from 'react';
import { Bug, TrendingUp, CheckCircle2, Clock, AlertOctagon, Filter, ArrowRight, Recycle } from 'lucide-react';
import { BADCASES, badcaseStats } from '../data/evals';
import { SectionTitle, StatusChip, ProgressBar } from '../components/ui';

// ============================================================
// Badcase 数据飞轮页
// 展示「发现 → 归因 → 修复 → 回归」的完整产品迭代闭环
// ============================================================

const SEVERITY_TONE: Record<string, any> = { P0: 'danger', P1: 'warn', P2: 'muted' };
const STATUS_TONE: Record<string, any> = { 已修复: 'ok', 优化中: 'warn', 待排期: 'muted' };

export function Badcase() {
  const stats = badcaseStats();
  const [filter, setFilter] = useState<string>('全部');
  const [expanded, setExpanded] = useState<string | null>(BADCASES[0]?.id ?? null);

  const types = ['全部', ...new Set(BADCASES.map((b) => b.type))];
  const list = filter === '全部' ? BADCASES : BADCASES.filter((b) => b.type === filter);

  // 统计文案严格跟随数据，避免写死造成与列表不一致
  const p0List = BADCASES.filter((b) => b.severity === 'P0');
  const p0Total = p0List.length;
  const p0Open = p0List.filter((b) => b.status !== '已修复').length;
  const inProgress = BADCASES.filter((b) => b.status === '优化中').length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6">
      <div className="mb-5">
        <h1 className="text-[18px] font-semibold mb-1">Badcase 数据飞轮</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
          ChatBI 的效果不是一次性调出来的，而是靠
          <b style={{ color: 'var(--text)' }}>「线上发现 → 分类归因 → 修复知识库/链路 → 回归验证」</b>
          的飞轮持续打磨。每一条 Badcase 都会沉淀为一条回归用例。
        </p>
      </div>

      {/* 飞轮示意 */}
      <div className="card p-4 mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { icon: <Bug size={14} />, label: '线上发现', desc: '用户反馈 + 日志巡检' },
            { icon: <Filter size={14} />, label: '分类归因', desc: '定位失败环节' },
            { icon: <AlertOctagon size={14} />, label: '根因分析', desc: '知识库 or 链路' },
            { icon: <CheckCircle2 size={14} />, label: '修复优化', desc: '补别名/改逻辑' },
            { icon: <Recycle size={14} />, label: '回归验证', desc: '沉淀为测试用例' },
          ].map((s, i, arr) => (
            <div key={s.label} className="flex items-center gap-2">
              <div className="rounded-lg px-3 py-2" style={{ background: 'var(--brand-soft)' }}>
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: 'var(--brand-text)' }}>
                  {s.icon}
                  {s.label}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {s.desc}
                </div>
              </div>
              {i < arr.length - 1 && <ArrowRight size={13} style={{ color: 'var(--text-3)' }} />}
            </div>
          ))}
        </div>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
        <div className="card p-3.5">
          <div className="text-[12px]" style={{ color: 'var(--text-2)' }}>
            累计收集
          </div>
          <div className="text-[24px] font-semibold leading-8">{stats.total}</div>
          <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
            条 Badcase
          </div>
        </div>
        <div className="card p-3.5">
          <div className="text-[12px]" style={{ color: 'var(--text-2)' }}>
            修复率
          </div>
          <div className="text-[24px] font-semibold leading-8" style={{ color: 'var(--ok)' }}>
            {stats.fixRate}%
          </div>
          <div className="mt-1.5">
            <ProgressBar value={stats.fixRate / 100} tone="ok" />
          </div>
        </div>
        <div className="card p-3.5">
          <div className="text-[12px]" style={{ color: 'var(--text-2)' }}>
            P0 严重问题
          </div>
          <div className="text-[24px] font-semibold leading-8" style={{ color: 'var(--danger)' }}>
            {p0Total}
          </div>
          <div className="text-[11.5px]" style={{ color: p0Open ? 'var(--warn)' : 'var(--ok)' }}>
            {p0Open ? `${p0Open} 条修复中` : '全部已修复'}
          </div>
        </div>
        <div className="card p-3.5">
          <div className="text-[12px]" style={{ color: 'var(--text-2)' }}>
            优化中
          </div>
          <div className="text-[24px] font-semibold leading-8" style={{ color: 'var(--warn)' }}>
            {inProgress}
          </div>
          <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
            {inProgress > 0 ? '条推进中' : '无遗留项'}
          </div>
        </div>
      </div>

      {/* 分类分布 */}
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<TrendingUp size={15} />}
          title="问题类型分布"
          desc="按失败环节归类，识别系统性的能力短板"
        />
        <div className="flex flex-col gap-2.5">
          {stats.byType
            .sort((a, b) => b.value - a.value)
            .map((t) => (
              <div key={t.name} className="flex items-center gap-3">
                <span className="text-[12.5px] shrink-0" style={{ minWidth: 88, color: 'var(--text-2)' }}>
                  {t.name}
                </span>
                <div className="flex-1">
                  <ProgressBar value={t.value / stats.total} tone="brand" />
                </div>
                <span className="text-[12.5px] font-semibold tabular-nums shrink-0" style={{ minWidth: 30, textAlign: 'right' }}>
                  {t.value}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* 过滤 */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className="rounded-full px-3 py-1 text-[12px] font-medium transition-all"
            style={{
              background: filter === t ? 'var(--brand)' : 'var(--bg-elev)',
              color: filter === t ? '#fff' : 'var(--text-2)',
              border: `1px solid ${filter === t ? 'var(--brand)' : 'var(--border)'}`,
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="flex flex-col gap-2.5">
        {list.map((b) => {
          const open = expanded === b.id;
          return (
            <div key={b.id} className="card overflow-hidden">
              <button
                onClick={() => setExpanded(open ? null : b.id)}
                className="w-full text-left p-3.5 transition-colors"
                style={{ cursor: 'pointer' }}
              >
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="mono text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    {b.id}
                  </span>
                  <StatusChip tone={SEVERITY_TONE[b.severity]}>{b.severity}</StatusChip>
                  <StatusChip tone={STATUS_TONE[b.status]}>{b.status}</StatusChip>
                  <StatusChip tone="muted">{b.type}</StatusChip>
                  <span className="text-[11.5px] ml-auto flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                    <Clock size={11} /> {b.foundAt}
                  </span>
                </div>
                <div className="text-[13.5px] font-medium">「{b.question}」</div>
              </button>

              {open && (
                <div className="px-3.5 pb-3.5 anim-in">
                  <div className="grid sm:grid-cols-2 gap-2.5 mb-2.5">
                    <div className="rounded-lg p-2.5" style={{ background: 'var(--danger-soft)' }}>
                      <div className="text-[11.5px] font-semibold mb-1" style={{ color: 'var(--danger)' }}>
                        模型实际输出
                      </div>
                      <div className="text-[12.5px] leading-[1.65]" style={{ color: 'var(--text)' }}>
                        {b.modelOutput}
                      </div>
                    </div>
                    <div className="rounded-lg p-2.5" style={{ background: 'var(--ok-soft)' }}>
                      <div className="text-[11.5px] font-semibold mb-1" style={{ color: 'var(--ok)' }}>
                        期望输出
                      </div>
                      <div className="text-[12.5px] leading-[1.65]" style={{ color: 'var(--text)' }}>
                        {b.expected}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg p-2.5 mb-2" style={{ background: 'var(--bg-sub)' }}>
                    <div className="text-[11.5px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>
                      根因分析
                    </div>
                    <div className="text-[12.5px] leading-[1.65]" style={{ color: 'var(--text)' }}>
                      {b.rootCause}
                    </div>
                  </div>
                  <div className="rounded-lg p-2.5" style={{ background: 'var(--brand-soft)' }}>
                    <div className="text-[11.5px] font-semibold mb-1" style={{ color: 'var(--brand-text)' }}>
                      修复动作
                    </div>
                    <div className="text-[12.5px] leading-[1.65]" style={{ color: 'var(--text)' }}>
                      {b.fixAction}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
