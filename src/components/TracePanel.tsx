import type { TraceStep } from '../types';
import { StatusChip } from './ui';

// ============================================================
// 链路透视面板：展示一次问答的完整处理链路
// 这是产品差异化的可视化 —— 让用户一眼看懂 NL2SQL 的可解释性
// ============================================================

const TONE: Record<TraceStep['status'], { tone: any; dot: string; label: string }> = {
  pass: { tone: 'ok', dot: 'var(--ok)', label: '通过' },
  hit: { tone: 'brand', dot: 'var(--brand)', label: '命中' },
  warn: { tone: 'warn', dot: 'var(--warn)', label: '告警' },
  skip: { tone: 'muted', dot: 'var(--text-3)', label: '跳过' },
};

export function TracePanel({ trace }: { trace: TraceStep[] }) {
  const last = trace[trace.length - 1];
  return (
    <div className="flex flex-col gap-0">
      <div
        className="flex items-center justify-between px-3 py-2 rounded-lg mb-2 text-[12px]"
        style={{ background: 'var(--bg-sub)', color: 'var(--text-2)' }}
      >
        <span>
          共 <b style={{ color: 'var(--text)' }}>{trace.length}</b> 个环节
        </span>
        <span className="mono">
          端到端 {last ? last.latency.toFixed(0) : 0} ms
        </span>
      </div>

      <div className="relative pl-1">
        {trace.map((s, i) => {
          const t = TONE[s.status];
          const isLast = i === trace.length - 1;
          return (
            <div key={s.id} className="relative flex gap-3 pb-3">
              {/* 连接线 */}
              {!isLast && (
                <span
                  className="absolute left-[7px] top-[18px] w-px"
                  style={{ height: 'calc(100% - 10px)', background: 'var(--border-strong)' }}
                />
              )}
              {/* 节点 */}
              <span
                className="relative z-10 shrink-0 rounded-full mt-[5px]"
                style={{
                  width: 15,
                  height: 15,
                  background: 'var(--bg-elev)',
                  border: `2.5px solid ${t.dot}`,
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium">{s.name}</span>
                  <StatusChip tone={t.tone}>{t.label}</StatusChip>
                  <span className="mono text-[11px] ml-auto" style={{ color: 'var(--text-3)' }}>
                    +{s.latency.toFixed(1)}ms
                  </span>
                </div>
                <p
                  className="text-[12px] mt-0.5 leading-[1.6] break-words"
                  style={{ color: 'var(--text-2)' }}
                >
                  {s.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] pt-1" style={{ color: 'var(--text-3)' }}>
        链路耗时以真实执行计时为准，非预估
      </div>
    </div>
  );
}
