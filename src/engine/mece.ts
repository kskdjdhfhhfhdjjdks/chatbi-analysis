import type { MecePlan, Metric, SubQuestionResult } from '../types';
import { METRICS } from '../data/metrics';
import { buildFacts, aggregate, addDays, DATA_END } from '../data/facts';
import { formatValue } from './sql';

// ============================================================
// MECE 子问题拆解引擎
//
// 产品设计核心：
//   用户问的是「主观策略问题」（哪些渠道值得加投？业务健康吗？）
//   模型不该直接编主观建议，而应把问题翻译成
//   一棵「确定性子问题树」，每棵子树都是一次可执行的取数，
//   最后基于客观数据合成结论与分层建议。
//
// MECE 自查：
//   ME（相互独立）：每个子问题锚定不同的评估视角，不重复取数
//   CE（完全穷尽）：通过「评估视角矩阵」保证常见策略问题被完整覆盖
// ============================================================

const RECENT_DAYS = 30;
const PREV_DAYS = 30;

/** 策略意图模板：把主观问法映射到一组评估视角 */
interface StrategyTemplate {
  key: string;
  title: string;
  /** 匹配模式 */
  patterns: RegExp[];
  /** 拆解依据（为什么这么拆） */
  basis: string;
  /** 评估视角清单 */
  views: StrategyView[];
}

/** 一个评估视角 = 一个子问题 */
interface StrategyView {
  id: string;
  title: string;
  /** 内部实现说明 */
  impl: string;
  rationale: string;
  /** 主指标 key */
  metricKeys: string[];
  /** 分组维度 */
  groupBy: 'channel' | 'plan' | 'region' | 'device' | 'segment' | 'none';
  /** 是否需要计算环比 */
  needTrend?: boolean;
  /** 指标方向：higher 越大越好（默认），lower 越小越好（如崩溃率） */
  direction?: 'higher' | 'lower';
}

// ---------- 模板 1：渠道投放决策 ----------
const CHANNEL_INVESTMENT: StrategyTemplate = {
  key: 'channel_investment',
  title: '渠道投放价值评估',
  patterns: [
    /值得(加投|投放|投|做)/,
    /要不要(继续|加大|停)/,
    /哪(个|些)渠道/,
    /渠道(该|怎么)(优化|调整)/,
    /投(放|资)(效果|回报)/,
    /带量(效果|好)/,
  ],
  basis:
    '「值得加投」是一个主观决策问题，无法直接取数回答。按投放决策的因果链拆解为 4 个相互独立的评估视角：① 回报水平（ROI）② 回报效率（CAC）③ 用户质量（LTV）④ 变化趋势（是否在恶化）。四者共同构成「该不该加投」的完整判据。',
  views: [
    {
      id: 'roi',
      title: '各渠道回报水平（LTV/CAC）',
      impl: '按渠道分组计算 LTV/CAC 比值',
      rationale: '回报水平是投放决策的第一判据：比值越高，单位投入的长期回报越大',
      metricKeys: ['ltv_cac'],
      groupBy: 'channel',
    },
    {
      id: 'cac',
      title: '各渠道获客效率（CAC）',
      impl: '按渠道分组计算获客成本',
      rationale: '回报水平相同时，获客成本直接决定可规模化投放的空间',
      metricKeys: ['cac'],
      groupBy: 'channel',
    },
    {
      id: 'ltv',
      title: '各渠道用户质量（LTV）',
      impl: '按渠道分组计算用户生命周期价值',
      rationale: '区分「便宜但低质」与「贵但高质」渠道，避免被单一 CAC 指标误导',
      metricKeys: ['ltv'],
      groupBy: 'channel',
    },
    {
      id: 'trend',
      title: '各渠道回报效率趋势',
      impl: '按渠道分组计算 CAC 的近30天趋势',
      rationale: '静态快照会掩盖恶化中的渠道：效率下滑说明流量竞争加剧，需提前收缩',
      metricKeys: ['cac'],
      groupBy: 'channel',
      needTrend: true,
    },
  ],
};

// ---------- 模板 2：业务健康度体检 ----------
const BUSINESS_HEALTH: StrategyTemplate = {
  key: 'business_health',
  title: '业务健康度体检',
  patterns: [
    /健康(吗|么)/,
    /是否健康/,
    /(整体|大盘)(表现|情况|怎么样|状况)/,
    /业务(表现|状况|怎么样|情况)/,
    /有(什么|啥)(问题|风险)/,
    /该关注(什么|哪儿|哪些)/,
  ],
  basis:
    '「业务健康吗」缺少明确指标。按 SaaS 增长的标准健康模型拆解为 4 个独立维度：① 规模增长 ② 用户留存 ③ 商业化效率 ④ 增长经济性。这四者覆盖了 SaaS 从拉新到变现的完整循环。',
  views: [
    {
      id: 'growth',
      title: '规模增长：新增用户趋势',
      impl: '近30天新增注册用户趋势',
      rationale: '增长是 SaaS 的第一生命线，规模停滞会连带影响后续所有环节',
      metricKeys: ['new_users'],
      groupBy: 'none',
      needTrend: true,
    },
    {
      id: 'retention',
      title: '用户留存：7日留存率',
      impl: '近30天7日留存率趋势',
      rationale: '留存是增长质量的试金石：留存差意味着拉新投入无法沉淀',
      metricKeys: ['retention_d7'],
      groupBy: 'none',
      needTrend: true,
    },
    {
      id: 'monetization',
      title: '商业化效率：付费转化率',
      impl: '近30天付费转化率趋势',
      rationale: '转化率决定用户规模能否转化为收入，是商业化健康度的核心',
      metricKeys: ['pay_rate'],
      groupBy: 'none',
      needTrend: true,
    },
    {
      id: 'economics',
      title: '增长经济性：LTV/CAC 比值',
      impl: '近30天 LTV/CAC 趋势',
      rationale: '决定增长是否可持续：比值长期低于 3 说明增长在消耗现金而非创造价值',
      metricKeys: ['ltv_cac'],
      groupBy: 'none',
      needTrend: true,
    },
  ],
};

// ---------- 模板 3：留存提升诊断 ----------
const RETENTION_DIAGNOSIS: StrategyTemplate = {
  key: 'retention_diagnosis',
  title: '留存提升路径诊断',
  patterns: [
    // 允许动词与名词之间插入修饰语（如「改善/提升 用户 粘性」）
    /(怎么|如何|怎样|咋)[^，,。？?]{0,6}(提升|提高|改善|优化|增长)[^，,。？?]{0,4}(留存|粘性|活跃|复购)/,
    /(留存|粘性|活跃)[^，,。？?]{0,4}(低|差|不好|下降|掉|上不去)/,
    /(提升|提高|改善|优化)[^，,。？?]{0,4}(留存|粘性|活跃)/,
    // 名词前置语序（如「留存怎么提升」）
    /(留存|粘性|活跃)[^，,。？?]{0,4}(怎么|如何|怎样)(提升|提高|改善|优化)/,
  ],
  basis:
    '「怎么提升留存」是典型的归因型策略问题。拆解为 4 个独立视角：① 留存基准水平 ② 留存的分层差异（找出短板人群）③ 影响留存的体验指标 ④ 粘性水平。前两者定位问题，后两者定位抓手。',
  views: [
    {
      id: 'baseline',
      title: '留存基准：D1/D7/D30 三档留存',
      impl: '近30天三档留存率',
      rationale: '先确认短中长期留存的基准水位，判断问题出在「首次体验」还是「长期价值」',
      metricKeys: ['retention_d1', 'retention_d7', 'retention_d30'],
      groupBy: 'none',
    },
    {
      id: 'segment_gap',
      title: '结构差异：各套餐留存',
      impl: '按套餐分组计算7日留存率',
      rationale: '平均留存会掩盖结构性短板，必须找出留存最差的套餐，才能定向干预',
      metricKeys: ['retention_d7'],
      groupBy: 'plan',
    },
    {
      id: 'experience',
      title: '体验指标：崩溃率',
      impl: '按设备分组计算崩溃率',
      rationale: '稳定性是留存的地板：崩溃率高的端会显著拉低留存，是修复成本最低的抓手',
      metricKeys: ['crash_rate'],
      groupBy: 'device',
      direction: 'lower',
    },
    {
      id: 'stickiness',
      title: '粘性水平：DAU/MAU',
      impl: '近30天用户粘性趋势',
      rationale: '粘性反映使用频次，是留存的领先指标：粘性下滑往往先于留存下滑出现',
      metricKeys: ['dau_mau'],
      groupBy: 'none',
      needTrend: true,
    },
  ],
};

const TEMPLATES: StrategyTemplate[] = [
  CHANNEL_INVESTMENT,
  BUSINESS_HEALTH,
  RETENTION_DIAGNOSIS,
];

/** 判断问题是否命中某个策略模板 */
export function matchStrategyTemplate(question: string): StrategyTemplate | null {
  for (const t of TEMPLATES) {
    if (t.patterns.some((p) => p.test(question))) return t;
  }
  return null;
}

// ---------- 执行层 ----------

function findMetric(key: string): Metric | undefined {
  return METRICS.find((m) => m.key === key && !m.generic);
}

/** 执行一次取数 */
function runView(view: StrategyView): SubQuestionResult {
  const base: SubQuestionResult = {
    id: view.id,
    title: view.title,
    impl: view.impl,
    rationale: view.rationale,
    status: 'unsupported',
    finding: '',
    columns: [],
    rows: [],
  };

  const metrics = view.metricKeys.map(findMetric).filter(Boolean) as Metric[];
  if (metrics.length === 0) return base;

  const facts = buildFacts();
  const currStart = addDays(DATA_END, -(RECENT_DAYS - 1));
  const prevEnd = addDays(currStart, -1);
  const prevStart = addDays(prevEnd, -(PREV_DAYS - 1));

  // 多指标并列（如 D1/D7/D30 三档留存）
  if (metrics.length > 1 && view.groupBy === 'none') {
    const rows = metrics.map((m) => {
      const sub = facts.filter((r) => r.dt >= currStart && r.dt <= DATA_END);
      return { 口径: m.name, 数值: round(aggregate(sub, m), m) };
    });
    return {
      ...base,
      status: 'ok',
      columns: ['口径', '数值'],
      rows,
      unit: metrics[0].unit,
      finding: rows
        .map((r) => `${r.口径} ${formatValue(r.数值, metrics[0].unit)}`)
        .join('，'),
      chart: {
        type: 'bar',
        title: view.title,
        data: rows,
        xKey: '口径',
        series: [{ key: '数值', name: '数值', color: '#2563eb' }],
        unit: metrics[0].unit,
      },
    };
  }

  const metric = metrics[0];

  // 趋势型
  if (view.needTrend && view.groupBy === 'none') {
    const byDate = new Map<string, typeof facts>();
    for (const r of facts) {
      if (r.dt < currStart || r.dt > DATA_END) continue;
      const arr = byDate.get(r.dt) ?? [];
      arr.push(r);
      byDate.set(r.dt, arr);
    }
    const rows = [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([dt, rs]) => ({ dt, [metric.name]: round(aggregate(rs, metric), metric) }));

    const currVal = aggregate(facts.filter((r) => r.dt >= currStart && r.dt <= DATA_END), metric);
    const prevVal = aggregate(facts.filter((r) => r.dt >= prevStart && r.dt <= prevEnd), metric);
    const chg = prevVal === 0 ? 0 : (currVal - prevVal) / prevVal;
    const dir = chg >= 0 ? '上升' : '下降';

    return {
      ...base,
      status: 'ok',
      columns: ['dt', metric.name],
      rows,
      unit: metric.unit,
      finding: `近30天${metric.name}${dir} ${Math.abs(chg * 100).toFixed(1)}%（${formatValue(prevVal, metric.unit)} → ${formatValue(currVal, metric.unit)}）`,
      chart: {
        type: 'line',
        title: `${metric.name} · 近30天趋势`,
        data: rows,
        xKey: 'dt',
        series: [{ key: metric.name, name: metric.name, color: '#2563eb' }],
        unit: metric.unit,
      },
    };
  }

  // 趋势 + 分组
  if (view.needTrend && view.groupBy !== 'none') {
    const dim = view.groupBy;
    const byDate = new Map<string, Map<string, typeof facts>>();
    for (const r of facts) {
      if (r.dt < currStart || r.dt > DATA_END) continue;
      const inner = byDate.get(r.dt) ?? new Map();
      const k = String(r[dim]);
      const arr = inner.get(k) ?? [];
      arr.push(r);
      inner.set(k, arr);
      byDate.set(r.dt, inner);
    }
    const keys = [...new Set(facts.filter((r) => r.dt >= currStart).map((r) => String(r[dim])))];
    const rows = [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([dt, inner]) => {
        const row: Record<string, string | number> = { dt };
        for (const [k, rs] of inner) row[k] = round(aggregate(rs, metric), metric);
        return row;
      });
    const colors = ['#2563eb', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
    return {
      ...base,
      status: 'ok',
      columns: ['dt', ...keys],
      rows,
      unit: metric.unit,
      finding: `按${dim}拆分的${metric.name}趋势已生成，共 ${keys.length} 条序列`,
      chart: {
        type: 'line',
        title: `${metric.name}趋势 · 按${dim}`,
        data: rows,
        xKey: 'dt',
        series: keys.slice(0, 6).map((k, i) => ({ key: k, name: k, color: colors[i % colors.length] })),
        unit: metric.unit,
      },
    };
  }

  // 纯分组
  const dim = view.groupBy;
  const sub = facts.filter((r) => r.dt >= currStart && r.dt <= DATA_END);
  const byGroup = new Map<string, typeof facts>();
  for (const r of sub) {
    const k = String(r[dim]);
    const arr = byGroup.get(k) ?? [];
    arr.push(r);
    byGroup.set(k, arr);
  }
  const rows = [...byGroup.entries()]
    .map(([k, rs]) => ({ [dim]: k, [metric.name]: round(aggregate(rs, metric), metric) }))
    // 方向感知排序：越大越好则降序，越小越好则升序
    .sort((a, b) =>
      view.direction === 'lower'
        ? Number(a[metric.name]) - Number(b[metric.name])
        : Number(b[metric.name]) - Number(a[metric.name]),
    );

  if (rows.length === 0) {
    return { ...base, status: 'empty', finding: '该视角在当前数据范围内无有效结果' };
  }

  const best = rows[0];
  const worst = rows[rows.length - 1];
  const isRatio = metric.unit === 'ratio';
  const goodLabel = view.direction === 'lower' ? '最优' : '最高';
  const badLabel = view.direction === 'lower' ? '最差' : '最低';
  const bestV = Number(best[metric.name]);
  const worstV = Number(worst[metric.name]);
  // 倍差 = 优者 / 劣者，恒 ≥ 1；劣者为 0 时不展示倍差（除零无意义）
  const gap = worstV === 0 ? null : bestV / worstV;
  const gapText = gap !== null && gap >= 1 ? `，倍差 ${gap.toFixed(2)} 倍` : '';
  const finding = isRatio
    ? `${goodLabel}「${best[dim]}」${formatValue(best[metric.name], metric.unit)}，${badLabel}「${worst[dim]}」${formatValue(worst[metric.name], metric.unit)}${gapText}`
    : `${goodLabel}「${best[dim]}」${formatValue(best[metric.name], metric.unit)}，${badLabel}「${worst[dim]}」${formatValue(worst[metric.name], metric.unit)}`;

  const colors = ['#2563eb', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
  return {
    ...base,
    status: 'ok',
    columns: [dim, metric.name],
    rows,
    unit: metric.unit,
    finding,
    chart: {
      type: 'bar',
      title: `${metric.name} · 按${dim}`,
      data: rows,
      xKey: dim,
      series: [{ key: metric.name, name: metric.name, color: colors[0] }],
      unit: metric.unit,
    },
  };
}

function round(v: number, m: Metric): number {
  if (m.unit === 'ratio') return Math.round(v * 10000) / 10000;
  if (m.unit === 'score') return Math.round(v * 100) / 100;
  return Math.round(v);
}

// ---------- 综合结论与建议 ----------

/** 基于子问题结果生成分层建议 */
function synthesize(
  template: StrategyTemplate,
  results: SubQuestionResult[],
): { synthesis: string; recommendation: MecePlan['recommendation'] } {
  const byId = new Map(results.map((r) => [r.id, r]));

  if (template.key === 'channel_investment') {
    const roi = byId.get('roi');
    const cac = byId.get('cac');
    const trend = byId.get('trend');
    const rec = buildChannelRecommendation(roi, cac, trend);
    const lines: string[] = [];
    lines.push('综合 4 个独立视角的数据结论：');
    for (const r of results) lines.push(`· ${r.title}：${r.finding}`);
    lines.push('');
    lines.push(
      '判断逻辑：回报水平（LTV/CAC）决定「值不值得投」，获客成本（CAC）决定「能不能规模化投」，用户质量（LTV）用于识别被单一 CAC 误导的渠道，趋势用于排除「正在恶化」的渠道。四者交叉验证后给出分层建议。',
    );
    return { synthesis: lines.join('\n'), recommendation: rec };
  }

  if (template.key === 'business_health') {
    const lines: string[] = [];
    lines.push('按 SaaS 增长健康模型的 4 个维度体检结果：');
    for (const r of results) lines.push(`· ${r.title}：${r.finding}`);
    lines.push('');
    lines.push(
      '判断逻辑：四个维度覆盖「拉新 → 留存 → 变现 → 经济性」的完整增长循环。任一环节亮红灯，都会向上游传导，因此需要按循环顺序依次排查。',
    );

    const warnings: string[] = [];
    for (const r of results) {
      if (r.status !== 'ok') continue;
      if (r.id === 'retention' && /下降/.test(r.finding)) warnings.push(`${r.title}：${r.finding}`);
      if (r.id === 'economics' && /下降/.test(r.finding)) warnings.push(`${r.title}：${r.finding}`);
      if (r.id === 'growth' && /下降/.test(r.finding)) warnings.push(`${r.title}：${r.finding}`);
    }
    const rec: MecePlan['recommendation'] = warnings.length
      ? [
          { level: '需重点关注', tone: 'warn' as const, items: warnings },
          {
            level: '正常工作',
            tone: 'ok' as const,
            items: results.filter((r) => r.status === 'ok' && !warnings.some((w) => w.startsWith(r.title))).map((r) => `${r.title}：${r.finding}`),
          },
        ]
      : [{ level: '整体健康', tone: 'ok' as const, items: results.map((r) => `${r.title}：${r.finding}`) }];
    return { synthesis: lines.join('\n'), recommendation: rec };
  }

  // retention_diagnosis
  const lines: string[] = [];
  lines.push('按「先定位问题，再定位抓手」的顺序拆解 4 个视角：');
  for (const r of results) lines.push(`· ${r.title}：${r.finding}`);
  lines.push('');
    lines.push(
      '判断逻辑：先用留存基准（D1/D7/D30）判断问题出在首次体验还是长期价值；再用套餐对比找出留存最差的产品线；最后从体验指标（崩溃率）与粘性水平中寻找成本最低的改进抓手。',
    );
  return {
    synthesis: lines.join('\n'),
    recommendation: [
      {
        level: '优先抓手',
        tone: 'warn' as const,
        items: [
          '稳定性优先：修复崩溃率显著偏高的端，属于「投入小、见效快」的整改项',
          '定向产品线：对留存明显偏低的套餐单独排查（产品体验、客群匹配度、上手门槛）',
        ],
      },
      {
        level: '持续监测',
        tone: 'ok' as const,
        items: ['跟踪 D1 变化判断首次体验改动效果', '监测粘性（DAU/MAU）作为留存的领先指标'],
      },
    ],
  };
}

/** 渠道投放决策：基于三个数据视角生成分层建议 */
function buildChannelRecommendation(
  roi: SubQuestionResult | undefined,
  cac: SubQuestionResult | undefined,
  trend: SubQuestionResult | undefined,
): MecePlan['recommendation'] {
  const scaleUp: string[] = [];
  const watch: string[] = [];
  const shrink: string[] = [];

  if (roi?.status === 'ok' && cac?.status === 'ok') {
    const roiMap = new Map(roi.rows.map((r) => [String(r[roi.columns[0]]), Number(r[roi.columns[1]])]));
    const cacMap = new Map(cac.rows.map((r) => [String(r[cac.columns[0]]), Number(r[cac.columns[1]])]));
    // 计算 ROI 中位数，作为「高于平均水平」的分界线
    const roiVals = [...roiMap.values()].sort((a, b) => a - b);
    const median = roiVals[Math.floor(roiVals.length / 2)] ?? 0;

    // 判断哪些渠道趋势在恶化
    const deteriorating = new Set<string>();
    if (trend?.status === 'ok' && trend.rows.length >= 4) {
      const keys = trend.columns.filter((c) => c !== 'dt');
      const half = Math.floor(trend.rows.length / 2);
      for (const k of keys) {
        const firstHalf = trend.rows.slice(0, half).reduce((a, r) => a + Number(r[k] ?? 0), 0) / Math.max(1, half);
        const secondHalf = trend.rows.slice(half).reduce((a, r) => a + Number(r[k] ?? 0), 0) / Math.max(1, trend.rows.length - half);
        // CAC 上升 = 效率恶化
        if (secondHalf > firstHalf * 1.08) deteriorating.add(k);
      }
    }

    for (const [name, roiVal] of roiMap) {
      const cacVal = cacMap.get(name) ?? 0;
      const label = `${name}（ROI ${roiVal.toFixed(1)}，CAC ¥${cacVal.toFixed(0)}）`;
        if (deteriorating.has(name)) {
        shrink.push(`${label} —— 效率正在恶化（CAC 环比上升超 8%），建议先暂停加投并排查原因`);
      } else if (roiVal >= median * 1.15) {
        scaleUp.push(`${label} —— 回报显著高于渠道中位数，具备加投空间`);
      } else if (roiVal >= median * 0.85) {
        watch.push(`${label} —— 回报接近渠道平均水平，建议维持并做小流量测试`);
      } else {
        shrink.push(`${label} —— 回报低于渠道平均水平，建议收缩预算并优化投放策略`);
      }
    }
  }

  const out: MecePlan['recommendation'] = [];
  if (scaleUp.length) out.push({ level: '建议加投', tone: 'ok', items: scaleUp });
  if (watch.length) out.push({ level: '维持观察', tone: 'warn', items: watch });
  if (shrink.length) out.push({ level: '建议收缩', tone: 'danger', items: shrink });
  if (out.length === 0) {
    out.push({ level: '数据不足', tone: 'warn', items: ['当前筛选条件下缺少可比较的渠道数据'] });
  }
  return out;
}

/** 主入口：执行 MECE 拆解 */
export function decompose(question: string): MecePlan | null {
  const template = matchStrategyTemplate(question);
  if (!template) return null;

  const subQuestions = template.views.map((v) => runView(v));
  const { synthesis, recommendation } = synthesize(template, subQuestions);

  const okCount = subQuestions.filter((s) => s.status === 'ok').length;
  const coverageNote = `MECE 自查：本次拆解共 ${subQuestions.length} 个子问题，已成功取数 ${okCount} 个。各子问题锚定不同评估视角（相互独立），并覆盖了「${template.title}」的完整判据链（完全穷尽）。`;

  return {
    intentTitle: template.title,
    question,
    basis: template.basis,
    subQuestions,
    synthesis,
    recommendation,
    coverageNote,
  };
}

export { matchStrategyTemplate as hasStrategyTemplate };
