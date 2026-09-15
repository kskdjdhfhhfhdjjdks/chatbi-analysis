import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Gauge,
  Target,
  ShieldCheck,
  FlaskConical,
  CheckCircle2,
  XCircle,
  TrendingUp,
  ArrowRight,
  GitCommitVertical,
} from 'lucide-react';
import { EVAL_CASES, EVAL_HISTORY, EVAL_TREND, evalStats } from '../data/evals';
import { SectionTitle, StatusChip, ProgressBar } from '../components/ui';

// ============================================================
// 模型评测看板
// 3 个核心指标 + 30 条用例 + 版本收敛趋势
// ============================================================

export function Evaluation() {
  const stats = evalStats();
  const [cat, setCat] = useState<string>('全部');
  const cats = ['全部', ...stats.byCategory.map((c) => c.name)];
  const list = cat === '全部' ? EVAL_CASES : EVAL_CASES.filter((c) => c.category === cat);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6">
      <div className="mb-5">
        <h1 className="text-[18px] font-semibold mb-1">模型评测看板</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
          用 <b style={{ color: 'var(--text)' }}>{stats.total} 条标注用例</b> 量化 ChatBI 的三个核心指标，
          每次知识库或链路变更后全量回归，指标劣化即阻断发版。
        </p>
      </div>

      {/* 核心指标 */}
      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <MetricCard
          icon={<Target size={16} />}
          label="语义理解准确率"
          value={stats.semanticAcc}
          target={0.9}
          tone="brand"
          desc="指标 / 维度 / 时间 / 别名归一化综合正确率"
        />
        <MetricCard
          icon={<Gauge size={16} />}
          label="SQL 正确率"
          value={stats.sqlAcc}
          target={0.85}
          tone="accent"
          desc="生成 SQL 与标准答案的执行结果一致性"
        />
        <MetricCard
          icon={<ShieldCheck size={16} />}
          label="幻觉率"
          value={stats.hallucinationRate}
          target={0.02}
          tone="ok"
          invert
          desc="无数据却编造数值 / 图表的发生率，越低越好"
        />
      </div>

      {/* 效果对比：收敛曲线 + 版本迭代说明 */}
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<TrendingUp size={15} />}
          title="效果对比 · 指标是怎么涨上来的"
          desc="按版本迭代记录。用例数从 10 条逐步扩充到 30 条，指标随知识库与链路完善持续收敛；每个版本下方标注该版本的关键改动。"
        />
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={EVAL_TREND} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="version" tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-3)' }}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text)',
              }}
              formatter={(v: any, n: any) => [`${(Number(v) * 100).toFixed(1)}%`, n]}
            />
            <Legend
              formatter={(v) => <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{v}</span>}
              wrapperStyle={{ paddingTop: 6 }}
            />
            <Line type="monotone" dataKey="semantic" name="语义理解准确率" stroke="#2563eb" strokeWidth={2.2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="sql" name="SQL 正确率" stroke="#0d9488" strokeWidth={2.2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="hallucination" name="幻觉率" stroke="#d97706" strokeWidth={2.2} dot={{ r: 3 }} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>

        {/* 提升幅度摘要 */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { label: '语义理解准确率', from: EVAL_HISTORY[0].semantic, to: EVAL_HISTORY[EVAL_HISTORY.length - 1].semantic, tone: 'var(--brand)' },
            { label: 'SQL 正确率', from: EVAL_HISTORY[0].sql, to: EVAL_HISTORY[EVAL_HISTORY.length - 1].sql, tone: 'var(--accent)' },
            { label: '幻觉率', from: EVAL_HISTORY[0].hallucination, to: EVAL_HISTORY[EVAL_HISTORY.length - 1].hallucination, tone: 'var(--warn)', invert: true },
          ].map((m) => (
            <div key={m.label} className="rounded-lg p-2.5" style={{ background: 'var(--bg-sub)' }}>
              <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                {m.label}
              </div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {(m.from * 100).toFixed(0)}%
                </span>
                <ArrowRight size={11} style={{ color: 'var(--text-3)' }} />
                <span className="text-[17px] font-semibold tabular-nums" style={{ color: m.tone }}>
                  {(m.to * 100).toFixed(0)}%
                </span>
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: m.invert ? 'var(--ok)' : 'var(--text-3)' }}>
                {m.invert
                  ? `下降 ${((m.from - m.to) * 100).toFixed(0)} 个百分点`
                  : `提升 ${((m.to - m.from) * 100).toFixed(0)} 个百分点`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 版本迭代时间线 */}
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<GitCommitVertical size={15} />}
          title="版本迭代时间线"
          desc="每个版本的指标变化，都对应下方这些具体改动。指标不是调出来的，是一条条 Badcase 修出来的。"
        />
        <div className="flex flex-col">
          {EVAL_HISTORY.map((v, i) => {
            const prev = i > 0 ? EVAL_HISTORY[i - 1] : null;
            const dSemantic = prev ? v.semantic - prev.semantic : 0;
            return (
              <div key={v.version} className="flex gap-3">
                {/* 轴线 */}
                <div className="flex flex-col items-center shrink-0 pt-1">
                  <span
                    className="rounded-full shrink-0"
                    style={{
                      width: v.milestone ? 11 : 8,
                      height: v.milestone ? 11 : 8,
                      background: v.milestone ? 'var(--brand)' : 'var(--border-strong)',
                      marginTop: v.milestone ? 3 : 5,
                    }}
                  />
                  {i < EVAL_HISTORY.length - 1 && (
                    <span className="flex-1 w-px my-1" style={{ background: 'var(--border)', minHeight: 24 }} />
                  )}
                </div>

                {/* 内容 */}
                <div className="flex-1 min-w-0 pb-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="mono text-[13px] font-semibold">{v.version}</span>
                    <span className="text-[13px] font-medium">{v.theme}</span>
                    {v.milestone && <StatusChip tone="brand">里程碑</StatusChip>}
                    <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                      {v.cases} 条用例
                    </span>
                    {prev && (
                      <span className="text-[11.5px] tabular-nums ml-auto" style={{ color: dSemantic > 0 ? 'var(--ok)' : 'var(--text-3)' }}>
                        语义 {dSemantic > 0 ? '+' : ''}
                        {(dSemantic * 100).toFixed(0)}pp
                      </span>
                    )}
                  </div>

                  {/* 指标条 */}
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    {[
                      { k: '语义', v: v.semantic, c: '#2563eb' },
                      { k: 'SQL', v: v.sql, c: '#0d9488' },
                      { k: '幻觉', v: v.hallucination, c: '#d97706' },
                    ].map((m) => (
                      <span key={m.k} className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.c }} />
                        <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                          {m.k}
                        </span>
                        <span className="text-[11.5px] font-semibold tabular-nums">{(m.v * 100).toFixed(0)}%</span>
                      </span>
                    ))}
                  </div>

                  <ul className="flex flex-col gap-1 mt-2">
                    {v.changes.map((c, j) => (
                      <li key={j} className="flex gap-2 text-[12.5px] leading-[1.7]">
                        <span className="shrink-0 mt-[7px] w-1 h-1 rounded-full" style={{ background: 'var(--text-3)' }} />
                        <span style={{ color: 'var(--text-2)' }}>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 分类通过率 */}
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<FlaskConical size={15} />}
          title="用例分类通过率"
          desc={`当前整体通过 ${stats.passed}/${stats.total}（${(stats.passRate * 100).toFixed(0)}%）`}
        />
        <div className="flex flex-col gap-2.5">
          {stats.byCategory.map((c) => (
            <div key={c.name} className="flex items-center gap-3">
              <span className="text-[12.5px] shrink-0" style={{ minWidth: 96, color: 'var(--text-2)' }}>
                {c.name}
              </span>
              <div className="flex-1">
                <ProgressBar value={c.rate} tone={c.rate === 1 ? 'ok' : c.rate >= 0.8 ? 'brand' : 'warn'} />
              </div>
              <span className="text-[12px] tabular-nums shrink-0" style={{ color: 'var(--text-3)', minWidth: 46, textAlign: 'right' }}>
                {c.passed}/{c.total}
              </span>
              <span
                className="text-[12.5px] font-semibold tabular-nums shrink-0"
                style={{ minWidth: 42, textAlign: 'right', color: c.rate === 1 ? 'var(--ok)' : 'var(--text)' }}
              >
                {(c.rate * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 用例明细 */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className="rounded-full px-3 py-1 text-[12px] font-medium transition-all"
            style={{
              background: cat === c ? 'var(--brand)' : 'var(--bg-elev)',
              color: cat === c ? '#fff' : 'var(--text-2)',
              border: `1px solid ${cat === c ? 'var(--brand)' : 'var(--border)'}`,
              cursor: 'pointer',
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: 520 }}>
          <table className="w-full text-[12.5px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr style={{ background: 'var(--bg-sub)' }}>
                {['ID', '分类', '问法', '期望 SQL / 行为', '结果', '语义', 'SQL'].map((h) => (
                  <th
                    key={h}
                    className="text-left font-semibold px-3 py-2 whitespace-nowrap border-b"
                    style={{ color: 'var(--text-2)', borderColor: 'var(--border)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((c, i) => (
                <tr key={c.id} style={{ background: i % 2 ? 'transparent' : 'var(--bg-sub)' }}>
                  <td className="px-3 py-2 mono whitespace-nowrap border-b" style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}>
                    {c.id}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap border-b" style={{ borderColor: 'var(--border)' }}>
                    <StatusChip tone="muted">{c.category}</StatusChip>
                  </td>
                  <td className="px-3 py-2 border-b" style={{ borderColor: 'var(--border)', minWidth: 160 }}>
                    {c.question}
                  </td>
                  <td
                    className="px-3 py-2 mono border-b"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-2)', maxWidth: 320 }}
                  >
                    {c.expectedSql}
                    {c.failReason && (
                      <div className="text-[11.5px] mt-1" style={{ color: 'var(--danger)', fontFamily: 'inherit' }}>
                        失败原因：{c.failReason}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap border-b" style={{ borderColor: 'var(--border)' }}>
                    {c.passed ? (
                      <span className="flex items-center gap-1" style={{ color: 'var(--ok)' }}>
                        <CheckCircle2 size={13} /> 通过
                      </span>
                    ) : (
                      <span className="flex items-center gap-1" style={{ color: 'var(--danger)' }}>
                        <XCircle size={13} /> 未通过
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums border-b" style={{ borderColor: 'var(--border)', color: c.scores.semantic === 1 ? 'var(--ok)' : 'var(--warn)' }}>
                    {c.scores.semantic.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 tabular-nums border-b" style={{ borderColor: 'var(--border)', color: c.scores.sql === 1 ? 'var(--ok)' : 'var(--warn)' }}>
                    {c.scores.sql.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[11.5px] mt-3 leading-[1.7]" style={{ color: 'var(--text-3)' }}>
        注：语义 / SQL 为人工标注的 0~1 连续得分；幻觉率为「应有数据却未取数，或编造数值」的发生比例。
        评测集覆盖基础指标识别、业务黑话、维度值归一化、比率聚合正确性、安全与鲁棒性五类，共 {stats.total} 条。
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  target,
  tone,
  desc,
  invert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  target: number;
  tone: 'brand' | 'accent' | 'ok';
  desc: string;
  invert?: boolean;
}) {
  const color = { brand: 'var(--brand)', accent: 'var(--accent)', ok: 'var(--ok)' }[tone];
  const met = invert ? value <= target : value >= target;
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-[12.5px] mb-2" style={{ color: 'var(--text-2)' }}>
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-[30px] font-semibold tracking-tight leading-9" style={{ color }}>
          {(value * 100).toFixed(1)}
          <span className="text-[16px] font-normal">%</span>
        </span>
        <StatusChip tone={met ? 'ok' : 'warn'}>
          {met ? '达标' : '未达标'} · 目标 {invert ? '≤' : '≥'}
          {(target * 100).toFixed(0)}%
        </StatusChip>
      </div>
      <div className="mt-2.5">
        <ProgressBar value={invert ? Math.max(0, 1 - value) : value} tone={tone} />
      </div>
      <div className="text-[11.5px] mt-2 leading-[1.6]" style={{ color: 'var(--text-3)' }}>
        {desc}
      </div>
    </div>
  );
}
