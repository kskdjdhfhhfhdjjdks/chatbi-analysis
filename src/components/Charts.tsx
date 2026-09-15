import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import type { ChartSpec } from '../types';
import { formatValue } from '../engine/sql';

const PALETTE = ['#2563eb', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#65a30d'];

function fmtTick(v: number, unit?: string): string {
  if (unit === 'ratio') return `${(v * 100).toFixed(0)}%`;
  if (unit === 'currency') {
    if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(0)}万`;
    return `${v}`;
  }
  if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(1)}亿`;
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(0)}万`;
  return `${Math.round(v)}`;
}

const AXIS_STYLE = { fontSize: 11, fill: 'var(--text-3)' };

function ChartTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 shadow-lg text-[12px]"
      style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)' }}
    >
      {label !== undefined && (
        <div className="font-medium mb-1" style={{ color: 'var(--text-2)' }}>
          {label}
        </div>
      )}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color || p.fill }} />
          <span style={{ color: 'var(--text-2)' }}>{p.name}</span>
          <span className="font-semibold tabular-nums ml-auto pl-3" style={{ color: 'var(--text)' }}>
            {formatValue(p.value, unit)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 图表渲染器：根据 ChartSpec 选型 */
export function ChartView({ spec, height = 260 }: { spec: ChartSpec; height?: number }) {
  if (spec.type === 'number') {
    const row = spec.data[0];
    const key = spec.series[0].key;
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="text-[38px] font-semibold tracking-tight" style={{ color: 'var(--brand)' }}>
          {formatValue(row?.[key] ?? 0, spec.unit as any)}
        </div>
        <div className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
          {spec.title}
        </div>
      </div>
    );
  }

  if (spec.type === 'pie') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={spec.data}
            dataKey={spec.series[0].key}
            nameKey={spec.xKey}
            innerRadius={52}
            outerRadius={82}
            paddingAngle={2}
          >
            {spec.data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="var(--bg-elev)" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip unit={spec.unit} />} />
          <Legend
            verticalAlign="bottom"
            height={28}
            formatter={(v) => <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{v}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (spec.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={spec.data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={spec.xKey} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={24} />
          <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => fmtTick(v, spec.unit)} />
          <Tooltip content={<ChartTooltip unit={spec.unit} />} />
          {spec.series.length > 1 && (
            <Legend
              verticalAlign="top"
              height={28}
              formatter={(v) => <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{v}</span>}
            />
          )}
          {spec.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color || PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={spec.data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={spec.xKey} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={0} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => fmtTick(v, spec.unit)} />
        <Tooltip content={<ChartTooltip unit={spec.unit} />} cursor={{ fill: 'var(--bg-sub)' }} />
        <Bar dataKey={spec.series[0].key} name={spec.series[0].name} radius={[4, 4, 0, 0]} maxBarSize={56}>
          {spec.data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
