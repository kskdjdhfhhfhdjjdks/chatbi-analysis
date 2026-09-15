import { useState } from 'react';
import {
  ChevronRight,
  Network,
  Layers,
  Lightbulb,
  Table2,
  CircleCheck,
  CircleAlert,
  CircleSlash,
} from 'lucide-react';
import type { MecePlan, SubQuestionResult } from '../types';
import { StatusChip, DataTable } from './ui';
import { ChartView } from './Charts';

// ============================================================
// MECE 子问题拆解可视化
//
// 展示「主观策略问题 → 确定性取数子问题树 → 数据合成结论」的完整过程，
// 说明模型没有直接编造建议，而是把不可直接取数的问题
// 翻译成一组相互独立、可执行、可验证的子问题。
// ============================================================

const STATUS_META: Record<
  SubQuestionResult['status'],
  { tone: 'ok' | 'warn' | 'muted'; text: string; icon: typeof CircleCheck }
> = {
  ok: { tone: 'ok', text: '已取数', icon: CircleCheck },
  empty: { tone: 'warn', text: '无数据', icon: CircleAlert },
  unsupported: { tone: 'muted', text: '暂不支持', icon: CircleSlash },
};

const TONE_MAP = {
  ok: { bg: 'var(--ok-soft)', fg: 'var(--ok)', border: 'var(--ok)' },
  warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)', border: 'var(--warn)' },
  danger: { bg: 'var(--danger-soft)', fg: 'var(--danger)', border: 'var(--danger)' },
};

/** 单个子问题卡片 */
function SubQuestionCard({ node, index }: { node: SubQuestionResult; index: number }) {
  const [open, setOpen] = useState(node.status === 'ok');
  const meta = STATUS_META[node.status];
  const Icon = meta.icon;

  return (
    <div className="rounded-lg border overflow-hidden" style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}>
      {/* 头部 */}
      <button
        onClick={() => node.rows.length > 0 && setOpen((v) => !v)}
        className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors"
        style={{ cursor: node.rows.length > 0 ? 'pointer' : 'default' }}
      >
        <span
          className="mono shrink-0 mt-[2px] rounded-md flex items-center justify-center text-[11px] font-bold"
          style={{ width: 20, height: 20, background: 'var(--brand-soft)', color: 'var(--brand-text)' }}
        >
          {index + 1}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold">{node.title}</span>
            <StatusChip tone={meta.tone} icon={<Icon size={11} />}>
              {meta.text}
            </StatusChip>
          </div>

          {/* 发现 */}
          {node.finding && (
            <div className="text-[12.5px] leading-[1.7] mt-1" style={{ color: 'var(--text)' }}>
              {node.finding}
            </div>
          )}

          {/* 拆解理由 */}
          <div className="text-[11.5px] leading-[1.6] mt-1 flex gap-1.5" style={{ color: 'var(--text-3)' }}>
            <span className="shrink-0">拆解依据</span>
            <span className="min-w-0">{node.rationale}</span>
          </div>
        </div>

        {node.rows.length > 0 && (
          <ChevronRight
            size={15}
            className="shrink-0 mt-1 transition-transform"
            style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none' }}
          />
        )}
      </button>

      {/* 明细 */}
      {open && node.rows.length > 0 && (
        <div className="px-3 pb-3 anim-in flex flex-col gap-2">
          <div className="text-[11.5px] flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
            <Layers size={11} />
            <span className="mono">{node.impl}</span>
          </div>
          {node.chart && <ChartView spec={node.chart} height={200} />}
          <details>
            <summary
              className="text-[11.5px] cursor-pointer select-none flex items-center gap-1.5"
              style={{ color: 'var(--text-2)' }}
            >
              <Table2 size={11} /> 查看取数明细（{node.rows.length} 行）
            </summary>
            <div className="mt-2">
              <DataTable columns={node.columns} rows={node.rows} maxHeight={240} />
            </div>
          </details>
        </div>
      )}

      {/* 无数据说明 */}
      {node.status !== 'ok' && (
        <div className="px-3 pb-3 -mt-1">
          <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
            {node.impl}
          </div>
        </div>
      )}
    </div>
  );
}

export function MecePanel({ mece }: { mece: MecePlan }) {
  const okCount = mece.subQuestions.filter((s) => s.status === 'ok').length;

  return (
    <div className="flex flex-col gap-3">
      {/* ① 顶部：识别为策略问题 + 为什么不能直接答 */}
      <div
        className="rounded-lg p-3 border"
        style={{ background: 'var(--brand-soft)', borderColor: 'var(--brand)' }}
      >
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <StatusChip tone="brand" icon={<Network size={11} />}>
            策略类问题
          </StatusChip>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--brand-text)' }}>
            {mece.intentTitle}
          </span>
          <StatusChip tone="muted">
            {mece.subQuestions.length} 个子问题 · 成功取数 {okCount}
          </StatusChip>
        </div>
        <p className="text-[12.5px] leading-[1.75]" style={{ color: 'var(--text)' }}>
          这是一个主观决策问题，无法用单条 SQL 直接回答。系统将其翻译为
          <b> {mece.subQuestions.length} 个相互独立、可直接取数的子问题</b>，
          分别取数后再基于客观数据合成结论，避免模型直接编造建议。
        </p>
      </div>

      {/* ② 拆解思路 */}
      <div>
        <div className="text-[12.5px] font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
          <Lightbulb size={13} />
          拆解思路
        </div>
        <div
          className="rounded-lg p-3 text-[12.5px] leading-[1.8] border"
          style={{ background: 'var(--bg-sub)', borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          {mece.basis}
        </div>
      </div>

      {/* ③ 子问题树 */}
      <div>
        <div className="text-[12.5px] font-semibold mb-2 flex items-center justify-between" style={{ color: 'var(--text-2)' }}>
          <span>子问题拆解与取数（MECE）</span>
          <span className="text-[11px] font-normal" style={{ color: 'var(--text-3)' }}>
            相互独立 · 完全穷尽
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {mece.subQuestions.map((s, i) => (
            <SubQuestionCard key={s.id} node={s} index={i} />
          ))}
        </div>
      </div>

      {/* ④ 综合结论 */}
      <div>
        <div className="text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
          综合结论
        </div>
        <div
          className="rounded-lg p-3 text-[12.5px] leading-[1.8] whitespace-pre-wrap border"
          style={{ background: 'var(--bg-sub)', borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          {mece.synthesis}
        </div>
      </div>

      {/* ⑤ 分层建议 */}
      {mece.recommendation.length > 0 && (
        <div>
          <div className="text-[12.5px] font-semibold mb-2" style={{ color: 'var(--text-2)' }}>
            分层行动建议
          </div>
          <div className="flex flex-col gap-2">
            {mece.recommendation.map((rec) => {
              const tone = TONE_MAP[rec.tone];
              return (
                <div
                  key={rec.level}
                  className="rounded-lg border p-2.5"
                  style={{ background: tone.bg, borderColor: tone.border }}
                >
                  <div className="text-[12.5px] font-semibold mb-1.5" style={{ color: tone.fg }}>
                    {rec.level}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {rec.items.map((it, i) => (
                      <li key={i} className="flex gap-2 text-[12.5px] leading-[1.7]">
                        <span className="shrink-0 mt-[7px] w-1 h-1 rounded-full" style={{ background: tone.fg }} />
                        <span style={{ color: 'var(--text)' }}>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ⑥ MECE 自查 */}
      <div
        className="rounded-lg px-3 py-2 text-[11.5px] leading-[1.7] border flex gap-2"
        style={{ background: 'var(--bg-sub)', borderColor: 'var(--border)', color: 'var(--text-3)' }}
      >
        <CircleCheck size={13} className="shrink-0 mt-[3px]" style={{ color: 'var(--accent)' }} />
        <span>{mece.coverageNote}</span>
      </div>
    </div>
  );
}
