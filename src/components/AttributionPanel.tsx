import type { Attribution, AttributionNode } from '../types';
import { StatusChip, ProgressBar } from './ui';
import { formatValue } from '../engine/sql';

// ============================================================
// 归因下钻可视化：思维链 + 贡献度瀑布 + 树形路径
// ============================================================

function contributionText(c: number): string {
  const pct = c * 100;
  if (Math.abs(pct) <= 100) return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  return `${pct > 0 ? '+' : '−'}${Math.min(Math.abs(pct), 999).toFixed(0)}%`;
}

function NodeRow({ node, depth, unit }: { node: AttributionNode; depth: number; unit?: string }) {
  const pos = node.contribution >= 0;
  const color = pos ? 'var(--up)' : 'var(--down)';
  const strength = Math.min(1, Math.abs(node.contribution));

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2.5 py-1.5 rounded-md px-2 transition-colors"
        style={{ marginLeft: depth * 18 }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: depth === 0 ? 'var(--brand)' : 'var(--border-strong)' }}
        />
        <span className="text-[12.5px] font-medium shrink-0">{node.value}</span>

        <div className="flex-1 min-w-0 max-w-[130px]">
          <ProgressBar value={strength} tone={pos ? 'danger' : 'ok'} />
        </div>

        <span className="text-[12px] font-semibold tabular-nums shrink-0" style={{ color, minWidth: 62, textAlign: 'right' }}>
          {contributionText(node.contribution)}
        </span>
        <span className="text-[11.5px] tabular-nums shrink-0 hidden sm:inline" style={{ color: 'var(--text-3)', minWidth: 72, textAlign: 'right' }}>
          环比 {(node.changeRate * 100).toFixed(1)}%
        </span>
      </div>

      {node.children?.map((c, i) => (
        <NodeRow key={`${c.dimension}-${c.value}-${i}`} node={c} depth={depth + 1} unit={unit} />
      ))}
    </div>
  );
}

export function AttributionPanel({ attr, unit }: { attr: Attribution; unit?: string }) {
  const pos = attr.changeRate >= 0;
  return (
    <div className="flex flex-col gap-3">
      {/* 顶部：异常判定 */}
      <div
        className="rounded-lg p-3 border"
        style={{
          background: attr.isAnomaly ? 'var(--warn-soft)' : 'var(--ok-soft)',
          borderColor: attr.isAnomaly ? 'var(--warn)' : 'var(--ok)',
        }}
      >
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <StatusChip tone={attr.isAnomaly ? 'warn' : 'ok'}>
            {attr.isAnomaly ? '异常告警' : '正常波动'}
          </StatusChip>
          <span className="text-[13px] font-medium">
            {attr.metricName} 环比
            <span style={{ color: pos ? 'var(--up)' : 'var(--down)' }}>
              {' '}
              {pos ? '+' : ''}
              {(attr.changeRate * 100).toFixed(1)}%
            </span>
          </span>
        </div>
        <div className="flex items-center gap-4 text-[12px] flex-wrap" style={{ color: 'var(--text-2)' }}>
          <span>本周 <b style={{ color: 'var(--text)' }}>{formatValue(attr.currentValue, unit as any)}</b></span>
          <span>上周 <b style={{ color: 'var(--text)' }}>{formatValue(attr.previousValue, unit as any)}</b></span>
          <span style={{ color: 'var(--text-3)' }}>
            阈值：{unit === 'ratio' ? '±8%' : '±5%'}
          </span>
        </div>
      </div>

      {/* 思维链 */}
      <div>
        <div className="text-[12.5px] font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
          分析思维链
        </div>
        <div className="flex flex-col gap-1.5">
          {attr.chain.map((c, i) => (
            <div key={i} className="flex gap-2 text-[12px] leading-[1.65]">
              <span
                className="mono shrink-0 mt-[3px] rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{
                  width: 16,
                  height: 16,
                  background: 'var(--brand-soft)',
                  color: 'var(--brand-text)',
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: 'var(--text-2)' }}>{c.replace(/^[①②③④⑤]\s*/, '')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 下钻树 */}
      {attr.nodes.length > 0 && (
        <div>
          <div className="text-[12.5px] font-semibold mb-1.5 flex items-center justify-between" style={{ color: 'var(--text-2)' }}>
            <span>逐层下钻（MECE 拆解）</span>
            <span className="text-[11px] font-normal" style={{ color: 'var(--text-3)' }}>
              贡献度 = 该成员变化量 / 总变化量
            </span>
          </div>
          <div className="card p-2">
            {attr.nodes.map((n, i) => (
              <NodeRow key={`${n.dimension}-${n.value}-${i}`} node={n} depth={0} unit={unit} />
            ))}
          </div>
        </div>
      )}

      {/* 结论 */}
      <div>
        <div className="text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
          归因结论
        </div>
        <div
          className="rounded-lg p-3 text-[12.5px] leading-[1.75] whitespace-pre-wrap border"
          style={{ background: 'var(--bg-sub)', borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          {attr.conclusion}
        </div>
      </div>
    </div>
  );
}
