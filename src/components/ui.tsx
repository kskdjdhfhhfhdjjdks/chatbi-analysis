import type { ReactNode } from 'react';
import clsx from 'clsx';

/** 语义化状态标签 */
export function StatusChip({
  tone,
  children,
  icon,
}: {
  tone: 'brand' | 'accent' | 'warn' | 'danger' | 'ok' | 'muted';
  children: ReactNode;
  icon?: ReactNode;
}) {
  const map = {
    brand: { bg: 'var(--brand-soft)', fg: 'var(--brand-text)' },
    accent: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
    warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
    danger: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
    ok: { bg: 'var(--ok-soft)', fg: 'var(--ok)' },
    muted: { bg: 'var(--bg-sub)', fg: 'var(--text-2)' },
  }[tone];
  return (
    <span className="chip" style={{ background: map.bg, color: map.fg }}>
      {icon}
      {children}
    </span>
  );
}

/** 区块标题 */
export function SectionTitle({
  icon,
  title,
  desc,
  right,
}: {
  icon?: ReactNode;
  title: string;
  desc?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && (
          <span
            className="mt-0.5 shrink-0"
            style={{ color: 'var(--brand)' }}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold text-[14px] leading-6">{title}</h3>
          {desc && (
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
              {desc}
            </p>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}

/** 指标数字卡片 */
export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'up' | 'down' | 'brand';
}) {
  const color =
    tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : tone === 'brand' ? 'var(--brand)' : 'var(--text)';
  return (
    <div className="card p-3.5">
      <div className="text-[12px] mb-1" style={{ color: 'var(--text-2)' }}>
        {label}
      </div>
      <div className="text-[22px] font-semibold tracking-tight leading-7" style={{ color }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11.5px] mt-1" style={{ color: 'var(--text-3)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** 进度条 */
export function ProgressBar({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'accent' | 'warn' | 'danger' | 'ok' }) {
  const color = {
    brand: 'var(--brand)',
    accent: 'var(--accent)',
    warn: 'var(--warn)',
    danger: 'var(--danger)',
    ok: 'var(--ok)',
  }[tone];
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-sub)' }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }}
      />
    </div>
  );
}

/** 空状态 */
export function Empty({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-12 gap-2 text-center"
      style={{ color: 'var(--text-3)' }}
    >
      {icon}
      <span className="text-[13px]">{text}</span>
    </div>
  );
}

/** 表格 */
export function DataTable({
  columns,
  rows,
  maxHeight = 320,
}: {
  columns: string[];
  rows: Record<string, string | number>[];
  maxHeight?: number;
}) {
  return (
    <div className="overflow-auto rounded-lg border" style={{ maxHeight }}>
      <table className="w-full text-[12.5px] border-collapse">
        <thead className="sticky top-0 z-10">
          <tr style={{ background: 'var(--bg-sub)' }}>
            {columns.map((c) => (
              <th
                key={c}
                className="text-left font-semibold px-3 py-2 whitespace-nowrap border-b"
                style={{ color: 'var(--text-2)' }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="transition-colors" style={{ background: i % 2 ? 'transparent' : 'var(--bg-sub)' }}>
              {columns.map((c) => (
                <td key={c} className="px-3 py-1.5 whitespace-nowrap tabular-nums border-b" style={{ borderColor: 'var(--border)' }}>
                  {typeof r[c] === 'number' ? formatCell(r[c] as number) : r[c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(n: number): string {
  if (Math.abs(n) < 1 && n !== 0) return `${(n * 100).toFixed(2)}%`;
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(2)}亿`;
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return n.toLocaleString('zh-CN');
}

/** 代码块 */
export function CodeBlock({ code, lang = 'sql' }: { code: string; lang?: string }) {
  return (
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
      <div
        className="flex items-center justify-between px-3 py-1.5 text-[11px] font-medium border-b"
        style={{ background: 'var(--bg-sub)', color: 'var(--text-3)', borderColor: 'var(--border)' }}
      >
        <span className="mono uppercase tracking-wide">{lang}</span>
      </div>
      <pre
        className="p-3 text-[12.5px] leading-[1.7] overflow-auto mono"
        style={{ background: 'var(--code-bg)', margin: 0, maxHeight: 260 }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** 可折叠面板 */
export function Collapse({
  title,
  icon,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary
        className={clsx(
          'flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg text-[13px] font-medium transition-colors list-none',
        )}
        style={{ color: 'var(--text-2)' }}
      >
        <span
          className="transition-transform group-open:rotate-90 shrink-0"
          style={{ color: 'var(--text-3)' }}
        >
          ▶
        </span>
        {icon}
        <span className="flex-1">{title}</span>
        {badge}
      </summary>
      <div className="pt-2 pl-1 anim-in">{children}</div>
    </details>
  );
}
