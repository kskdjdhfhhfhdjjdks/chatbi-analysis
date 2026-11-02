import type { Attribution, ChartSpec, MecePlan, ParsedQuery, QueryResult, SqlResult, TraceStep } from '../types';
import { parseQuery, type ParseContext } from './parser';
import { executeSQL, generateSQL, formatValue } from './sql';
import { attribute } from './attribution';
import { decompose, hasStrategyTemplate } from './mece';
import { DATA_END, DATA_START, rangeHint } from '../data/facts';
import { dimensionLabel } from '../data/dimensions';

// ============================================================
// 查询编排层（Orchestrator）
// 把 NLU -> SQL -> 执行 -> 归因 -> 可视化 串成一条可观测链路
// 每一步都产出 TraceStep，供「链路透视」面板展示
// ============================================================

const STEP_DEFS = [
  { id: 'intent', name: '意图识别', icon: 'target' },
  { id: 'nlu', name: '语义理解（双知识库）', icon: 'book' },
  { id: 'preprocess', name: '预处理层（术语归一化）', icon: 'filter' },
  { id: 'clarify', name: '意图澄清判定', icon: 'help' },
  { id: 'mece', name: 'MECE 子问题拆解', icon: 'split' },
  { id: 'sql', name: 'SQL 生成', icon: 'code' },
  { id: 'security', name: '三层安全校验', icon: 'shield' },
  { id: 'execute', name: '查询执行', icon: 'database' },
  { id: 'viz', name: '可视化与分析', icon: 'chart' },
  { id: 'attribution', name: '归因下钻', icon: 'search' },
];

export interface PipelineOutput {
  parsed: ParsedQuery;
  sql: SqlResult | null;
  result: QueryResult | null;
  attribution: Attribution | null;
  mece: MecePlan | null;
  chart: ChartSpec | null;
  trace: TraceStep[];
  answer: string;
  /** 本次由哪个引擎完成语义解析，用于界面如实标注 */
  engine: 'llm' | 'rules';
}

export interface PipelineOptions {
  /** 大模型已解析出的查询计划；校验通过后直接复用，跳过规则解析器 */
  parsedOverride?: ParsedQuery | null;
  /** 闲聊 / 能力外场景的直出回答（不含数字，由模型提供措辞） */
  answerOverride?: string;
  engine?: 'llm' | 'rules';
}

const COLORS = ['#2563eb', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#65a30d'];

/** 构造图表配置 */
function buildChart(result: QueryResult, metricName: string, unit?: string): ChartSpec | null {
  if (result.rows.length === 0) return null;
  const cols = result.columns;
  const valueKey = cols[cols.length - 1];

  // 单值 -> 数字卡片
  if (result.rows.length === 1 && cols.length === 1) {
    return {
      type: 'number',
      title: metricName,
      data: result.rows,
      series: [{ key: valueKey, name: metricName, color: COLORS[0] }],
      unit,
    };
  }

  // 含 dt 且行数 > 2 -> 折线
  const hasDt = cols[0] === 'dt';
  if (hasDt && result.rows.length > 2) {
    if (cols.length === 2) {
      return {
        type: 'line',
        title: `${metricName} 趋势`,
        data: result.rows,
        xKey: 'dt',
        series: [{ key: valueKey, name: metricName, color: COLORS[0] }],
        unit,
      };
    }
    // 多序列（按维度拆分）
    const seriesKeys = cols.slice(1);
    return {
      type: 'line',
      title: `${metricName} 趋势（按维度拆分）`,
      data: result.rows,
      xKey: 'dt',
      series: seriesKeys.slice(0, 6).map((k, i) => ({ key: k, name: k, color: COLORS[i % COLORS.length] })),
      unit,
    };
  }

  // 维度对比
  const dimKey = cols[0];
  return {
    type: 'bar',
    title: `${metricName}（按${dimKey}）`,
    data: result.rows,
    xKey: dimKey,
    series: [{ key: valueKey, name: metricName, color: COLORS[0] }],
    unit,
  };
}

/** 生成自然语言回答 */
function buildAnswer(
  parsed: ParsedQuery,
  result: QueryResult | null,
  sql: SqlResult | null,
  attr: Attribution | null,
): string {
  if (parsed.intent === 'unsafe') {
    return `${sql?.blockReason ?? '该请求已被安全策略拦截。'}\n\n为避免数据风险，系统对所有请求强制执行三层安全校验（SQL 黑名单 / 指令模板 / 字段权限），并始终以只读身份查询。`;
  }
  if (parsed.intent === 'chat') {
    return '你好，我是 ChatBI 数据助手。你可以直接用业务语言问我数据，比如：\n· 昨天的日活是多少\n· 近30天各渠道的获客成本对比\n· 安卓端DAU为什么掉了\n· 用户粘性怎么样';
  }
  if (!result) {
    if (parsed.needClarify) {
      return parsed.clarifyReason ?? '这条问题还需要再明确一下口径，请在下方选择你想看的具体指标。';
    }
    return '抱歉，这条问题暂时无法处理，请换一种问法。';
  }

  const metric = parsed.metrics[0];
  const unit = metric?.unit;

  if (result.emptyReason) return result.emptyReason;

  // 单值
  if (result.rows.length === 1 && result.columns.length === 1) {
    const v = result.rows[0][result.columns[0]];
    let text = `${parsed.timeRange?.label ?? '所选周期'}的${metric.name}为 ${formatValue(v, unit)}。`;
    if (parsed.dimensionValues.length) {
      const cond = parsed.dimensionValues.map((d) => `${d.dimension.name}=${d.value}`).join('、');
      text = `在「${cond}」条件下，${parsed.timeRange?.label ?? '所选周期'}的${metric.name}为 ${formatValue(v, unit)}。`;
    }
    // 追问原因类：先给结论，再让归因结论接管
    if (attr) {
      const dir = attr.changeRate >= 0 ? '上升' : '下滑';
      text =
        `你问的是「${metric.name}」的异常归因。我采用等长的周对周窗口做检测，${metric.name}环比${dir} ${Math.abs(attr.changeRate * 100).toFixed(1)}%，` +
        (attr.isAnomaly ? '已超出正常波动阈值，下面逐层下钻定位根因。' : '仍在正常波动区间。');
      text += `\n\n（参考：该条件下全周期累计值为 ${formatValue(v, unit)}）\n\n`;
      text += attr.conclusion;
      return text;
    }
    return text;
  }

  // 趋势
  if (result.columns[0] === 'dt') {
    if (result.columns.length > 2) {
      return `${parsed.timeRange?.label ?? '所选周期'}的${metric.name}按维度展示 ${result.columns.length - 1} 条趋势，共 ${result.rows.length} 个日期点。各序列独立计算，详见图表和查询结果。`;
    }
    const key = result.columns[result.columns.length - 1];
    const first = Number(result.rows[0][key]);
    const last = Number(result.rows[result.rows.length - 1][key]);
    const peak = result.rows.reduce((a, b) => (Number(b[key]) > Number(a[key]) ? b : a));
    const low = result.rows.reduce((a, b) => (Number(b[key]) < Number(a[key]) ? b : a));
    const chg = first === 0 ? 0 : (last - first) / first;
    let text = `${parsed.timeRange?.label ?? '所选周期'}的${metric.name}共 ${result.rows.length} 个数据点：期初 ${formatValue(first, unit)}，期末 ${formatValue(last, unit)}，区间变化 ${chg >= 0 ? '+' : ''}${(chg * 100).toFixed(1)}%。峰值出现在 ${peak.dt}（${formatValue(peak[key], unit)}），低点出现在 ${low.dt}（${formatValue(low[key], unit)}）。`;
    if (attr) text += `\n\n${attr.conclusion}`;
    return text;
  }

  // 维度对比
  const dimKey = result.columns[0];
  const key = result.columns[1];
  const sorted = [...result.rows].sort((a, b) => Number(b[key]) - Number(a[key]));
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const isRatioMetric = !!metric.isRatio || unit === 'ratio' || unit === 'score';
  const total = result.rows.reduce((a, r) => a + Number(r[key]), 0) || 1;
  const share = ((Number(top[key]) / total) * 100).toFixed(1);
  let text = isRatioMetric
    ? `按${dimKey}拆分，${metric.name}最高的是「${top[dimKey]}」（${formatValue(top[key], unit)}），最低的是「${bottom[dimKey]}」（${formatValue(bottom[key], unit)}），倍差约 ${(Number(top[key]) / (Number(bottom[key]) || 1)).toFixed(2)} 倍。`
    : `按${dimKey}拆分，${metric.name}最高的是「${top[dimKey]}」（${formatValue(top[key], unit)}，占比 ${share}%），最低的是「${bottom[dimKey]}」（${formatValue(bottom[key], unit)}）。`;
  if (attr) text += `\n\n${attr.conclusion}`;
  return text;
}

/** 主入口：跑完整个链路 */
export function runPipeline(
  question: string,
  ctx: ParseContext = {},
  opts: PipelineOptions = {},
): PipelineOutput {
  const t0 = performance.now();
  const trace: TraceStep[] = [];
  const push = (id: string, status: TraceStep['status'], detail: string) => {
    const def = STEP_DEFS.find((s) => s.id === id)!;
    trace.push({
      id,
      name: def.name,
      icon: def.icon,
      status,
      detail,
      latency: Math.round((performance.now() - t0) * 100) / 100,
    });
  };

  // 1. 意图识别（语义解析由大模型或规则引擎完成，此处如实标注来源）
  const baseline = parseQuery(question, ctx);
  const guarded = baseline.intent === 'unsafe';
  const engine: 'llm' | 'rules' = !guarded && opts.parsedOverride ? 'llm' : 'rules';
  const parsed = guarded ? baseline : (opts.parsedOverride ?? baseline);
  const intentLabel =
    parsed.intent === 'unsafe' ? '安全风险' :
    parsed.intent === 'chat' ? '闲聊' :
    parsed.intent === 'strategy' ? '策略咨询' :
    parsed.intent === 'ambiguous' ? '模糊' : '数据问数';

  push(
    'intent',
    parsed.intent === 'unsafe' ? 'warn' : 'pass',
    `${engine === 'llm' ? '大模型语义层解析' : '规则引擎解析'}：识别为「${intentLabel}」，决定是否进入取数流程`,
  );

  // 2. 语义理解
  const mNames = parsed.metrics.map((m) => m.name).join('、') || '—';
  const dNames = parsed.dimensions.map((d) => dimensionLabel(d.key)).join('、') || '—';
  push(
    'nlu',
    parsed.metrics.length || parsed.dimensions.length ? 'hit' : 'skip',
    `指标知识库命中：${mNames}；维度知识库命中：${dNames}`,
  );

  // 3. 预处理层
  const mappings = parsed.matchedTokens.map((t) => `${t.text}→${t.label}`).join('，') || '无术语需要归一化';
  push('preprocess', parsed.matchedTokens.length ? 'hit' : 'skip', mappings);

  // 4. 意图澄清
  if (parsed.needClarify) {
    push('clarify', 'warn', parsed.clarifyReason ?? '需要用户澄清');
  } else {
    push('clarify', 'pass', '语义明确，无需澄清');
  }

  // 4.5 MECE 子问题拆解（策略咨询类问法专属路径）
  // 产品设计：主观决策问题无法直接取数回答，改为拆成确定性子问题树，
  // 逐个取数后综合结论。这条路径优先于「无指标 → 澄清」的兜底分支。
  let mece: MecePlan | null = null;
  if (parsed.intent === 'strategy' && hasStrategyTemplate(question)) {
    mece = decompose(question);
  }
  if (mece) {
    const ok = mece.subQuestions.filter((s) => s.status === 'ok').length;
    push(
      'mece',
      'hit',
      `识别为「${mece.intentTitle}」，按 MECE 原则拆解为 ${mece.subQuestions.length} 个相互独立的子问题，成功取数 ${ok} 个`,
    );
    // 拆解成功即不再走澄清
    parsed.needClarify = false;
    parsed.clarifyOptions = undefined;
    parsed.clarifyReason = undefined;
  } else if (parsed.intent === 'strategy') {
    push('mece', 'skip', '未命中已知策略模板，转为澄清引导');
  } else {
    push('mece', 'skip', '非策略类问法，不触发拆解');
  }

  // 时间范围兜底：没有识别到时间时，默认近30天（问数场景）
  if (!parsed.timeRange && parsed.metrics.length > 0 && parsed.intent === 'query') {
    parsed.timeRange = { field: 'dt', start: DATA_START, end: DATA_END, label: '全部可用区间', trend: false };
  }

  // 5-7. SQL 生成 / 安全 / 执行
  let sql: SqlResult | null = null;
  let result: QueryResult | null = null;
  if (parsed.intent === 'unsafe') {
    sql = generateSQL(parsed);
    push('sql', 'warn', '未生成可执行 SQL，转交安全策略处理');
    push('security', 'warn', `三层安全校验拦截：${(sql.securityHits ?? []).join('；')}`);
    push('execute', 'skip', '已阻断，未执行任何查询');
  } else if (mece || parsed.needClarify || parsed.intent === 'chat') {
    push('sql', 'skip', mece ? '策略问题已拆解为多条子查询，主链路不生成单一 SQL' : '等待用户澄清后再生成 SQL');
    push('security', 'skip', mece ? '子查询各自独立过检，均未命中风险规则' : '未生成 SQL，无需校验');
    push('execute', 'skip', mece ? `已执行 ${mece.subQuestions.filter((s) => s.status === 'ok').length} 条子查询` : '未执行查询');
  } else {
    sql = generateSQL(parsed);
    push('sql', 'pass', `已生成 ${sql.sql.split('\n')[0].replace('SELECT ', '').slice(0, 60)}…`);
    push('security', sql.blocked ? 'warn' : 'pass', sql.blocked ? (sql.blockReason ?? '已阻断') : '①SQL 黑名单 ②指令模板 ③字段权限 三层校验通过，只读执行');
    result = sql.blocked ? null : executeSQL(parsed);
    push(
      'execute',
      sql.blocked ? 'skip' : 'pass',
      !result ? '安全校验未通过，未执行查询' : result.rows.length ? `返回 ${result.rows.length} 行（内置模拟数据，浏览器聚合）` : `空结果：${result.emptyReason ?? ''}`,
    );
  }

  // 8. 可视化（MECE 路径下由各子问题自带图表，主链路不再重复出图）
  const metric = parsed.metrics[0];
  const chart = !mece && result && metric ? buildChart(result, metric.name, metric.unit) : null;
  push('viz', chart ? 'pass' : mece ? 'hit' : 'skip', chart ? `生成${chart.type === 'number' ? '数值卡片' : chart.type === 'line' ? '折线图' : chart.type === 'pie' ? '占比图' : '柱状图'}：${chart.title}` : mece ? `每个子问题独立出图，共 ${mece.subQuestions.filter((s) => s.chart).length} 张` : '无数据可可视化');

  // 9. 归因下钻（MECE 路径已内含多视角分析，不再重复归因）
  const isWhy = /为什么|为啥|原因|怎么回事|什么导致/.test(question);
  const isAnomalyWord = /异常|掉了|降了|跌了|下滑|下跌|暴涨|涨了|波动|归因|下钻|拆解|排查/.test(question);
  const wantAttr =
    !mece &&
    parsed.metrics.length > 0 &&
    (isWhy || isAnomalyWord || parsed.dimensions.some((d) => d.key !== 'dt'));
  let attr: Attribution | null = null;
  if (wantAttr && result && result.rows.length) {
    attr = attribute(parsed);
  }
  push(
    'attribution',
    attr ? (attr.isAnomaly ? 'warn' : 'pass') : 'skip',
    attr
      ? attr.isAnomaly
        ? `识别到异常（环比 ${(attr.changeRate * 100).toFixed(1)}%），完成 3 层下钻定位根因`
        : '指标处于正常波动区间，无需告警'
      : mece
        ? '策略问题已在 MECE 拆解中完成多视角分析'
        : '该问题不涉及异常排查',
  );

  const answer =
    (!guarded && (parsed.intent === 'chat' || parsed.needClarify) ? opts.answerOverride : undefined) ||
    (mece ? buildMeceAnswer(mece) : buildAnswer(parsed, result, sql, attr));

  return { parsed, sql, result, attribution: attr, mece, chart, trace, answer, engine };
}

/** MECE 路径的回答文本 */
function buildMeceAnswer(mece: MecePlan): string {
  const lines: string[] = [];
  lines.push(`你问的是一个策略决策问题，我把它拆成了 ${mece.subQuestions.length} 个可量化验证的子问题，逐个取数后综合判断。`);
  lines.push('');
  lines.push('【拆解思路】');
  lines.push(mece.basis);
  lines.push('');
  lines.push('【各子问题的数据发现】');
  for (const s of mece.subQuestions) {
    const mark = s.status === 'ok' ? '·' : '×';
    lines.push(`${mark} ${s.title}`);
    lines.push(`    ${s.status === 'ok' ? s.finding : '— 该视角暂无可取数据'}`);
  }
  lines.push('');
  lines.push('【综合结论与建议】');
  lines.push(mece.synthesis);
  return lines.join('\n');
}

export { rangeHint, DATA_START, DATA_END, formatValue };
