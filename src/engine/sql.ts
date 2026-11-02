import type { Metric, ParsedQuery, QueryResult, SqlResult } from '../types';
import { aggregate, buildFacts, outOfRange, rangeHint, type FactRow } from '../data/facts';

// ============================================================
// SQL 引擎
// 三层安全：① SQL 黑名单 ② 指令模板（只允许 SELECT 白名单）
//            ③ 字段/表级权限校验
// 生成 -> 校验 -> 执行（在事实表上模拟执行）
// ============================================================

export const WHITELIST_TABLE = 'dws_growth_daily';

/** 允许查询的字段白名单 */
export const ALLOWED_FIELDS = [
  'dt', 'channel', 'device', 'region', 'plan', 'segment', 'industry',
  'dau', 'mau', 'dau_mau_base', 'new_users', 'retention_d1_num', 'retention_d7_num',
  'retention_d30_num', 'churn_users', 'revenue', 'mrr', 'paid_users', 'refund_users',
  'marketing_cost', 'ltv_num', 'cac_num', 'session_count', 'total_duration',
  'crash_sessions', 'nps',
];

/** 明令禁止的字段（数据安全） */
export const FORBIDDEN_FIELDS = [
  'phone', 'mobile', 'id_card', 'idcard', 'email', 'password', 'passwd',
  'real_name', 'address', 'salary', 'bank_card', 'user_id',
];

/** 第一层：SQL 语句黑名单
 *
 *  设计要点：黑名单必须区分「破坏性/探测性语句」与「合法查询关键字」。
 *  早期版本把 `desc`、`set`、`show`、`sys` 这类词一并拉黑，导致
 *  `ORDER BY ... DESC` 这种完全正常的排序被误判为攻击（实测踩坑）。
 *  这里只保留真正具备破坏性或探测性、且不可能出现在合法 SELECT 中的模式。
 */
const BLACKLIST = [
  // DDL：破坏表结构
  /\bdrop\s+(table|database|view|index)\b/i,
  /\btruncate\s+table\b/i,
  /\balter\s+table\b/i,
  /\bcreate\s+(table|database|view|index|user)\b/i,
  /\brename\s+table\b/i,
  // DML：篡改数据
  /\bdelete\s+from\b/i,
  /\bupdate\s+\w+\s+set\b/i,
  /\binsert\s+into\b/i,
  /\breplace\s+into\b/i,
  // 权限与执行
  /\bgrant\b/i, /\brevoke\b/i,
  /\bexec(ute)?\s*\(/i, /\bcall\s+\w+\s*\(/i,
  /\bxp_\w+/i, /\bsp_\w+/i,
  // 注入特征
  /\bunion\s+(all\s+)?select\b/i,
  /\binformation_schema\b/i,
  /\b(load_file|into\s+outfile|into\s+dumpfile)\b/i,
  /\b(sleep|benchmark|waitfor\s+delay)\s*\(/i,
  // 注释绕过（只匹配语句级注释特征，不误伤字符串内的普通连字符）
  /(^|\s)--\s/,
  /\/\*[\s\S]*?\*\//,
  /;\s*\S/,
  // 探测型语句（要求出现在语句起始位置，避免误伤字段名/别名）
  /^\s*(show|desc|describe|explain|use|set)\b/i,
];

export interface SecurityCheck {
  passed: boolean;
  hits: string[];
  layer: string;
}

/** 三层安全检查 */
export function checkSecurity(sql: string, table: string, fields: string[]): SecurityCheck {
  const hits: string[] = [];

  // 层 1：黑名单
  for (const p of BLACKLIST) {
    if (p.test(sql)) {
      hits.push(`①SQL 黑名单拦截：命中危险模式 ${String(p).slice(0, 40)}`);
      break;
    }
  }
  // 层 2：指令模板 —— 必须是以 SELECT 开头的单语句
  const trimmed = sql.trim();
  if (!/^select\s/i.test(trimmed)) {
    hits.push('②指令模板拦截：非 SELECT 语句不在允许范围内');
  }
  if (trimmed.replace(/;+\s*$/, '').includes(';')) {
    hits.push('②指令模板拦截：检测到多语句拼接（SQL 注入特征）');
  }
  // 层 3：表 / 字段权限
  if (table !== WHITELIST_TABLE) {
    hits.push(`③权限校验拦截：无权访问表 ${table}`);
  }
  for (const f of fields) {
    if (FORBIDDEN_FIELDS.includes(f)) hits.push(`③权限校验拦截：字段 ${f} 属于敏感字段，禁止查询`);
    else if (!ALLOWED_FIELDS.includes(f)) hits.push(`③权限校验拦截：字段 ${f} 不在白名单内`);
  }

  return { passed: hits.length === 0, hits, layer: hits.length ? '3层安全' : '通过' };
}

/** SQL 生成主函数 */
export function generateSQL(parsed: ParsedQuery): SqlResult {
  if (parsed.intent === 'unsafe') {
    return {
      sql: '-- 已阻断：检测到非查询类指令',
      blocked: true,
      blockReason: '检测到非查询语句，已按安全策略阻断。本系统仅支持数据查询（SELECT），且不返回任何敏感字段。',
      securityHits: ['①SQL 黑名单：命中 DDL/DML 危险关键字', '③字段权限：敏感字段访问被拒绝'],
    };
  }
  if (parsed.metrics.length === 0) {
    return { sql: '-- 无可用指标，未生成 SQL', blocked: true, blockReason: '未识别到指标' };
  }

  const metric = parsed.metrics[0];
  const dims = parsed.dimensions.map((d) => d.field);
  const time = parsed.timeRange;

  const selectParts: string[] = [];
  const groupParts: string[] = [];
  const fields: string[] = [];

  // 维度列
  const groupDims = dims.filter((d) => d !== 'dt');
  const hasTrend = !!time?.trend;
  if (hasTrend) {
    selectParts.push('dt');
    groupParts.push('dt');
    fields.push('dt');
  }
  for (const d of groupDims) {
    selectParts.push(d);
    groupParts.push(d);
    fields.push(d);
  }

  // 指标表达式
  if (metric.isRatio && metric.numerator && metric.denominator) {
    selectParts.push(`SUM(${metric.numerator}) / NULLIF(SUM(${metric.denominator}), 0) AS ${metric.field}`);
    fields.push(metric.numerator, metric.denominator);
  } else {
    selectParts.push(`SUM(${metric.field}) AS ${metric.field}`);
    fields.push(metric.field);
  }

  const where: string[] = [];
  if (time) {
    where.push(`dt BETWEEN '${time.start}' AND '${time.end}'`);
  }
  for (const dv of parsed.dimensionValues) {
    where.push(`${dv.dimension.field} = '${dv.value}'`);
    fields.push(dv.dimension.field);
  }

  const lines: string[] = [];
  lines.push(`SELECT ${selectParts.join(', ')}`);
  lines.push(`FROM ${WHITELIST_TABLE}`);
  if (where.length) lines.push(`WHERE ${where.join('\n  AND ')}`);
  if (groupParts.length) lines.push(`GROUP BY ${groupParts.join(', ')}`);
  if (hasTrend) lines.push('ORDER BY dt ASC');
  else if (groupDims.length && metric.isRatio) lines.push(`ORDER BY 2 DESC`);

  const sql = lines.join('\n').replace(/ORDER BY 2 DESC/, `ORDER BY ${metric.field} DESC`);
  const fieldsUsed = [...new Set(fields)];
  const security = checkSecurity(sql, WHITELIST_TABLE, fieldsUsed);

  if (!security.passed) {
    return { sql, blocked: true, blockReason: security.hits.join('；'), securityHits: security.hits };
  }
  return { sql, blocked: false, securityHits: ['①SQL 黑名单：通过', '②指令模板：通过', '③字段权限：通过'] };
}

/** 执行 SQL（在事实表上真实聚合，非编造数据 —— 对应 Badcase BC-006） */
export function executeSQL(parsed: ParsedQuery): QueryResult {
  if (parsed.metrics.length === 0) {
    return { columns: [], rows: [], emptyReason: '未识别到指标，无可执行查询' };
  }
  const metric = parsed.metrics[0];
  const time = parsed.timeRange;

  // 空结果解释器（Badcase BC-005）
  if (time && outOfRange(time.start, time.end)) {
    return {
      columns: [],
      rows: [],
      emptyReason: `查询时间范围（${time.start} ~ ${time.end}）超出数据可用范围。${rangeHint()}`,
    };
  }

  const facts = buildFacts();
  let rows: FactRow[] = facts;
  if (time) rows = rows.filter((r) => r.dt >= time.start && r.dt <= time.end);
  for (const dv of parsed.dimensionValues) {
    rows = rows.filter((r) => String(r[dv.dimension.field]) === dv.value);
  }

  const groupDims = parsed.dimensions.filter((d) => d.field !== 'dt');
  const hasTrend = !!time?.trend;

  // 无分组：单值
  if (!hasTrend && groupDims.length === 0) {
    const value = aggregate(rows, metric);
    return {
      columns: [metric.name],
      rows: [{ [metric.name]: roundByUnit(value, metric) }],
      emptyReason: rows.length === 0 ? `该条件下没有匹配数据。${rangeHint()}` : undefined,
    };
  }

  // 按日期趋势
  if (hasTrend && groupDims.length === 0) {
    const byDate = new Map<string, FactRow[]>();
    for (const r of rows) {
      const arr = byDate.get(r.dt) ?? [];
      arr.push(r);
      byDate.set(r.dt, arr);
    }
    const out = [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([dt, rs]) => ({ dt, [metric.name]: roundByUnit(aggregate(rs, metric), metric) }));
    return { columns: ['dt', metric.name], rows: out };
  }

  // 按维度分组（+ 可选趋势）
  const groupKeyOf = (r: FactRow) => groupDims.map((d) => String(r[d.field])).join('|');
  if (hasTrend && groupDims.length > 0) {
    const byDate = new Map<string, Map<string, FactRow[]>>();
    for (const r of rows) {
      const d = r.dt;
      const inner = byDate.get(d) ?? new Map<string, FactRow[]>();
      const k = groupKeyOf(r);
      const arr = inner.get(k) ?? [];
      arr.push(r);
      inner.set(k, arr);
      byDate.set(d, inner);
    }
    const out: Record<string, string | number>[] = [];
    for (const [dt, inner] of [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const row: Record<string, string | number> = { dt };
      for (const [k, rs] of inner) row[k] = roundByUnit(aggregate(rs, metric), metric);
      out.push(row);
    }
    return { columns: ['dt', ...new Set(rows.map(groupKeyOf))], rows: out };
  }

  const byGroup = new Map<string, FactRow[]>();
  for (const r of rows) {
    const k = groupKeyOf(r);
    const arr = byGroup.get(k) ?? [];
    arr.push(r);
    byGroup.set(k, arr);
  }
  const out = [...byGroup.entries()]
    .map(([k, rs]) => ({ [groupDims[0].name]: k, [metric.name]: roundByUnit(aggregate(rs, metric), metric) }))
    .sort((a, b) => Number(b[metric.name]) - Number(a[metric.name]));

  return {
    columns: [groupDims[0].name, metric.name],
    rows: out,
    emptyReason: rows.length === 0 ? `该条件下没有匹配数据。${rangeHint()}` : undefined,
  };
}

/** 按指标单位做合理取值 */
export function roundByUnit(v: number, metric: Metric): number {
  switch (metric.unit) {
    case 'ratio':
      return Math.round(v * 10000) / 10000;
    case 'currency':
      return Math.round(v);
    case 'duration':
      return Math.round(v);
    case 'score':
      return Math.round(v * 100) / 100;
    default:
      return Math.round(v);
  }
}

/** 数值格式化 */
export function formatValue(v: number | string, unit?: Metric['unit']): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (unit === 'ratio') return `${(n * 100).toFixed(2)}%`;
  if (unit === 'currency') {
    if (Math.abs(n) >= 100000000) return `¥${(n / 100000000).toFixed(2)}亿`;
    if (Math.abs(n) >= 10000) return `¥${(n / 10000).toFixed(2)}万`;
    return `¥${n.toLocaleString('zh-CN')}`;
  }
  if (unit === 'duration') {
    if (n >= 60) return `${(n / 60).toFixed(1)}分钟`;
    return `${n}秒`;
  }
  if (n >= 100000000) return `${(n / 100000000).toFixed(2)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return n.toLocaleString('zh-CN');
}
