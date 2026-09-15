import type { Metric, ParsedQuery } from '../types';
import { DIMENSIONS } from '../data/dimensions';
import { METRICS } from '../data/metrics';

// ============================================================
// 上下文感知的追问建议引擎
//
// 设计目标：让追问建议「读懂这一轮对话」，而不是永远推同一组固定按钮。
//
// 四条排序策略：
//   ① 排除法      —— 已经拆过的维度不再推荐，避免推「按渠道拆分」给一个刚看完渠道对比的用户
//   ② 相关指标    —— 基于当前指标所在主题域，推荐同一分析链路的下一个指标
//      （如看到「获客成本」下一步自然想看「LTV/CAC」）
//   ③ 比率型识别  —— 比率型指标优先推「按 XX 拆分」做对比，绝对值指标优先推「趋势」看变化
//   ④ 策略升级    —— 单指标问数结束后，如果该指标能对应到策略模板，提示「用策略视角看」
//
// 每条建议都带 reason，让用户知道「为什么推荐这个」，而不是黑盒推荐。
// ============================================================

export interface Suggestion {
  /** 点击后提交的问题文本 */
  text: string;
  /** 推荐理由（悬浮/展示用） */
  reason: string;
  /** 分类：用于图标与视觉区分 */
  kind: 'dimension' | 'metric' | 'trend' | 'strategy' | 'drill';
  /** 权重，越大越靠前 */
  weight: number;
}

/** 主题域内的「分析链路」：看完 A 自然想看 B */
const DOMAIN_CHAIN: Record<string, string[]> = {
  用户规模: ['dau', 'mau', 'new_users', 'dau_mau', 'active_rate'],
  留存与流失: ['retention_d1', 'retention_d7', 'retention_d30', 'churn_rate', 'churn_users'],
  商业化: ['revenue', 'mrr', 'arpu', 'arppu', 'pay_rate', 'refund_rate'],
  增长效率: ['cac', 'ltv', 'ltv_cac', 'marketing_cost'],
  产品体验: ['crash_rate', 'avg_duration', 'session_count', 'nps'],
};

/** 维度推荐优先级（业务上最常被下钻的顺序） */
const DIM_PRIORITY: Record<string, number> = {
  channel: 100,
  device: 95,
  plan: 90,
  region: 85,
  segment: 80,
  industry: 70,
};

/** 某些指标与特定维度强相关，优先推荐 */
const METRIC_DIM_AFFINITY: Record<string, string[]> = {
  cac: ['channel'],
  ltv: ['channel', 'plan'],
  ltv_cac: ['channel'],
  marketing_cost: ['channel'],
  retention_d7: ['plan', 'segment'],
  retention_d30: ['plan', 'segment'],
  churn_rate: ['plan', 'segment'],
  pay_rate: ['plan'],
  revenue: ['plan', 'channel'],
  mrr: ['plan'],
  arpu: ['plan', 'segment'],
  refund_rate: ['plan'],
  crash_rate: ['device'],
  avg_duration: ['device'],
  dau: ['device', 'region'],
  new_users: ['channel', 'region'],
  dau_mau: ['device', 'segment'],
};

/** 该指标是否适合做趋势（比率型/效率型更关注变化趋势） */
function prefersTrend(m: Metric): boolean {
  return m.unit === 'ratio' || m.unit === 'score' || m.unit === 'currency';
}

function dimName(key: string): string {
  return DIMENSIONS.find((d) => d.key === key)?.name ?? key;
}

function metricByKey(key: string): Metric | undefined {
  return METRICS.find((m) => m.key === key && !m.generic);
}

/** 生成「按维度拆分」的问题文本 */
function dimQuestion(dimKey: string, metricName: string): string {
  const name = dimName(dimKey);
  // 渠道/地区 用「各…的…对比」，设备/套餐 用「按…看…」
  if (dimKey === 'channel' || dimKey === 'region' || dimKey === 'industry') {
    return `各${name}的${metricName}对比`;
  }
  if (dimKey === 'dt') return `${metricName}趋势`;
  return `按${name}看${metricName}`;
}

/**
 * 核心入口：基于当前消息的解析结果生成追问建议
 */
export function buildSuggestions(
  parsed: ParsedQuery,
  opts: { hasMece?: boolean; hasAttribution?: boolean; isAnomaly?: boolean } = {},
): Suggestion[] {
  const metric = parsed.metrics[0];
  if (!metric) return [];

  const usedDims = new Set(parsed.dimensions.map((d) => d.key));
  const usedValues = new Set(parsed.dimensionValues.map((v) => `${v.dimension.key}=${v.value}`));
  const out: Suggestion[] = [];

  // ---------- ① 维度下钻（排除已用维度，按亲和度 + 优先级加权）----------
  const affinity = METRIC_DIM_AFFINITY[metric.key] ?? [];
  const candidateDims = DIMENSIONS.filter((d) => d.key !== 'dt' && !usedDims.has(d.key));

  for (const d of candidateDims) {
    const affIdx = affinity.indexOf(d.key);
    const affBonus = affIdx >= 0 ? 60 - affIdx * 10 : 0; // 强相关维度大幅加权
    const base = DIM_PRIORITY[d.key] ?? 50;
    out.push({
      text: dimQuestion(d.key, metric.name),
      reason:
        affIdx >= 0
          ? `「${metric.name}」的业务差异主要来自${d.name}，拆开看能定位到具体短板`
          : `按${d.name}拆分，看「${metric.name}」在不同群体间的分布差异`,
      kind: 'dimension',
      weight: base + affBonus,
    });
  }

  // ---------- ② 同域下一个指标（分析链路推进）----------
  const chain = DOMAIN_CHAIN[metric.domain] ?? [];
  const idx = chain.indexOf(metric.key);
  const nextKeys = idx >= 0 ? chain.slice(idx + 1).concat(chain.slice(0, idx)) : chain;
  for (const key of nextKeys.slice(0, 3)) {
    const m = metricByKey(key);
    if (!m || m.key === metric.key) continue;
    // 已在指标列表里出现过的不推
    if (parsed.metrics.some((x) => x.key === m.key)) continue;
    out.push({
      text: `${m.name}`,
      reason: `与「${metric.name}」同属${metric.domain}，是这条分析链路的下一个常用指标`,
      kind: 'metric',
      weight: 70 - nextKeys.indexOf(key) * 8,
    });
  }

  // ---------- ③ 趋势（比率型优先，已看趋势则不推）----------
  if (!usedDims.has('dt') && prefersTrend(metric)) {
    out.push({
      text: `${metric.name}趋势`,
      reason: `「${metric.name}」是变化敏感型指标，趋势能看出是在改善还是恶化`,
      kind: 'trend',
      weight: 88,
    });
  }

  // ---------- ④ 归因（出现异常或尚未看过归因时）----------
  if (!opts.hasAttribution) {
    out.push({
      text: `${metric.name}为什么下降了`,
      reason: '触发归因下钻：等长窗口周对周对比 + 逐层拆解定位根因',
      kind: 'drill',
      weight: 78,
    });
  }

  // ---------- ⑤ 已识别维度值的定向建议 ----------
  if (usedValues.size > 0 && candidateDims.length > 0) {
    const target = candidateDims.find((d) => (DIM_PRIORITY[d.key] ?? 50) >= 85);
    if (target) {
      const val = [...parsed.dimensionValues][0];
      out.push({
        text: `各${target.name}的${metric.name}对比`,
        reason: `当前只看了一个${val.dimension.name}，换成${target.name}维度可以横向对比`,
        kind: 'dimension',
        weight: 72,
      });
    }
  }

  // ---------- ⑥ 策略视角升级（单指标问数 → MECE 拆解）----------
  if (!opts.hasMece) {
    const strategy = STRATEGY_ENTRY.find((s) => s.metrics.includes(metric.key));
    if (strategy) {
      out.push({
        text: strategy.question,
        reason: `升级为策略视角：${strategy.why}`,
        kind: 'strategy',
        weight: 96,
      });
    }
  }

  // ---------- 排序去重、取前 4 ----------
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.weight - a.weight)
    .filter((s) => {
      if (seen.has(s.text)) return false;
      seen.add(s.text);
      return true;
    })
    .slice(0, 4);
}

/** 单指标问数 → 策略问题的升级入口 */
const STRATEGY_ENTRY: { metrics: string[]; question: string; why: string }[] = [
  {
    metrics: ['cac', 'ltv', 'ltv_cac', 'marketing_cost'],
    question: '哪些渠道值得加投',
    why: '把「投放效率」放进回报水平 / 获客效率 / 用户质量 / 变化趋势四个视角综合判断',
  },
  {
    metrics: ['retention_d1', 'retention_d7', 'retention_d30', 'churn_rate', 'churn_users', 'dau_mau'],
    question: '怎么提升留存',
    why: '从留存基准 / 结构差异 / 体验指标 / 粘性水平四层定位改进抓手',
  },
  {
    metrics: ['dau', 'mau', 'new_users', 'revenue', 'pay_rate', 'active_rate'],
    question: '业务健康吗',
    why: '按增长健康模型体检：规模增长 / 用户留存 / 商业化效率 / 增长经济性',
  },
];

/** 策略类问题的后续追问（MECE 消息专用） */
export function buildStrategySuggestions(currentQuestion: string): Suggestion[] {
  const questions = [
    { q: '哪些渠道值得加投', why: '渠道投放决策视角' },
    { q: '怎么提升留存', why: '留存提升路径诊断' },
    { q: '业务健康吗', why: '业务健康度体检' },
  ];
  const out: Suggestion[] = [];
  for (const s of questions) {
    if (s.q === currentQuestion) continue;
    out.push({ text: s.q, reason: `切换到${s.why}`, kind: 'strategy', weight: 50 });
  }
  // 追加一个下钻型追问：把拆解出的结论落到具体维度
  out.push({
    text: '各套餐的7日留存对比',
    reason: '把策略结论落到具体产品线，验证短板是否集中在某个套餐',
    kind: 'drill',
    weight: 60,
  });
  return out.slice(0, 4);
}

/** 根据建议生成一条可读的补充说明（用于 trace / 调试展示） */
export function explainSuggestions(list: Suggestion[]): string {
  if (!list.length) return '本轮无可推荐的追问方向';
  return list.map((s, i) => `${i + 1}. ${s.text} —— ${s.reason}`).join('\n');
}
