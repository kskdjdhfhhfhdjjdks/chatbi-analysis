import type { ClarifyOption, Dimension, Metric, ParsedQuery, TimeRange } from '../types';
import { METRIC_ALIAS_INDEX, validateAliasUniqueness } from '../data/metrics';
import { DIMENSION_ALIAS_INDEX, VALUE_ALIAS_INDEX, dimensionLabel } from '../data/dimensions';
import { DATA_END, DATA_START, TODAY, addDays } from '../data/facts';

// ============================================================
// 语义理解层（NLU）
// 链路：意图识别 -> 术语归一化 -> 时间解析 -> 澄清判定
// ============================================================

// ---------- 1. 安全与意图的前置规则 ----------
const UNSAFE_PATTERNS = [
  // DDL / DML 显式语句
  /drop\s+(table|database|view|index)/i,
  /delete\s+from/i,
  /truncate\s+table/i,
  /update\s+\w+\s+set/i,
  /insert\s+into/i,
  /alter\s+table/i,
  /create\s+(table|database|view|user)/i,
  /rename\s+table/i,
  // 权限 / 执行
  /grant\s+/i,
  /revoke\s+/i,
  /exec(ute)?\s*\(/i,
  /xp_\w+/i,
  // 注入与探测
  /union\s+(all\s+)?select/i,
  /;\s*--/,
  /;\s*\S/,
  /information_schema/i,
  /sleep\s*\(/i,
  /benchmark\s*\(/i,
  /\/\*[\s\S]*?\*\//,
  /(^|\s)--\s/,
  /(^|\s)(show|desc|describe|explain|use|set)\s+\w/i,
  // 自然语言层面的越权/篡改意图
  /(删|清空|清除)(掉|除)?[^，,。？?]{0,6}(数据|表|记录|库)/,
  /(修改|改成|改为|改一下|更新|调整)[^，,。？?]{0,10}(数据|数值|记录|[\d０-９]+)/,
  /(新增|添加|插入)[^，,。？?]{0,6}(数据|记录|一条)/,
  /(绕过|跳过|关闭)[^，,。？?]{0,4}(校验|权限|限制|安全)/,
  // 批量导出：不要求后面一定跟「表/库/数据」
  // 反例教训：「把 dau 导出全部」同样属于越权取数，原规则要求跟名词导致漏拦
  /(导出|下载|dump)[^，,。？?]{0,6}(全部|所有|整张|整个|全量)/,
  // 敏感字段
  /手机号|身份证|真实姓名|password|密码|passwd|银行卡/i,
];

const SENSITIVE_FIELDS = /手机号|身份证|真实姓名|地址|password|passwd|phone|id_card|email/i;

/** 闲聊意图词 */
const CHAT_PATTERNS = [
  /^(你好|您好|hi|hello|hey|在吗|嗨)/i,
  /你是谁|你叫什么|你会什么|你能做什么/,
  /谢谢|感谢|thx|thanks/,
  /^测试$/,
  /讲个笑话/,
];

/** 策略咨询类问法（对应 Badcase BC-008）
 *
 *  注意：策略问法的「判定」与「可拆解性」是两件事。
 *  这里只负责判定「这是一个策略/决策类问法」（用于链路展示与澄清话术），
 *  真正能否拆解由 mece.ts 的策略模板决定（策略模式 + 可执行取数视角）。
 *  两张表故意保持独立：未命中模板的策略问题会走澄清引导，
 *  这正是我们希望暴露给用户的「能力边界」。
 */
const STRATEGY_PATTERNS = [
  /值得(加投|投放|投|做)/,
  /该(怎么|如何)(优化|调整|改进|关注)/,
  /该关注(什么|哪些|哪几|哪儿)/,
  /健康(吗|么)|是否健康/,
  /有(什么|啥)(建议|问题|风险)/,
  /怎么(提升|提高|增长|改善|优化)/,
  /如何(提升|提高|改善|优化)/,
  /要不要(继续|加大|停)/,
  /(大盘|整体|业务)(表现|情况|状况|怎么样)/,
];

/** 追问信号词（对应 Badcase BC-010） */
const FOLLOWUP_PATTERNS = [
  /^那(按|看|拆|分)/,
  /^(再|另外|接着)(按|看|拆|分)/,
  /^(按|拆)(一下|下)?$/,
  /^(那|就)?(按)?[^\n]{0,8}(拆|分)(一下|下|开)?[^\n]{0,6}$/,
  /^(还要|还要看|也想看|顺便)/,
  /^(换成|改看|改成)/,
];

// ---------- 2. 时间解析 ----------
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return toISO(d);
}

function monthStart(iso: string): string {
  return iso.slice(0, 8) + '01';
}

function monthEnd(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return toISO(d);
}

/** 自然语言时间解析 */
function parseTime(q: string): TimeRange | null {
  const TREND = /趋势|走势|变化|按天|每天|逐日|折线|随时间|日趋势|曲线/;
  const trend = TREND.test(q);

  const range = q.match(/(\d{4}-\d{2}-\d{2})\s*(?:至|到|~)\s*(\d{4}-\d{2}-\d{2})/);
  if (range) return { field: 'dt', start: range[1], end: range[2], label: `${range[1]} 至 ${range[2]}`, trend };

  const ymd = q.match(/(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})/);
  if (ymd) {
    const s = `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
    return { field: 'dt', start: s, end: s, label: s, trend };
  }

  const md = q.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (md) {
    const s = `2026-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
    return { field: 'dt', start: s, end: s, label: s, trend };
  }

  if (/今天|今日/.test(q)) return { field: 'dt', start: TODAY, end: TODAY, label: '今天', trend };
  if (/昨天|昨日/.test(q)) return { field: 'dt', start: '2026-09-13', end: '2026-09-13', label: '昨天', trend };

  // 上周（上一个完整自然周，对应 Badcase BC-001）
  if (/上周|上星期/.test(q)) {
    const thisMon = mondayOf(TODAY);
    const lastMon = addDays(thisMon, -7);
    const lastSun = addDays(thisMon, -1);
    return { field: 'dt', start: lastMon, end: lastSun, label: '上周（完整自然周）', trend };
  }
  if (/本周|这周|这星期/.test(q)) {
    const thisMon = mondayOf(TODAY);
    return { field: 'dt', start: thisMon, end: DATA_END, label: '本周', trend };
  }

  // 上个月
  if (/上个月|上月/.test(q)) {
    const firstOfThis = monthStart(TODAY);
    const d = new Date(firstOfThis + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - 1);
    const s = toISO(d);
    return { field: 'dt', start: s, end: monthEnd(s), label: '上个月（完整自然月）', trend };
  }
  if (/本月|这个月|当月/.test(q)) {
    return { field: 'dt', start: monthStart(TODAY), end: DATA_END, label: '本月', trend };
  }
  const ym = q.match(/(\d{1,2})月(份)?(?!\d)/);
  if (ym && !/月活|月留存|月经常/.test(q)) {
    const s = `2026-${ym[1].padStart(2, '0')}-01`;
    return { field: 'dt', start: s, end: monthEnd(s), label: `2026年${ym[1]}月`, trend };
  }

  const lastN = q.match(/(近|最近|过去|前)\s*(\d+)\s*(天|日)/);
  if (lastN) {
    const n = Number(lastN[2]);
    return {
      field: 'dt',
      start: addDays(DATA_END, -(n - 1)),
      end: DATA_END,
      label: `近${n}天`,
      trend: trend || n > 3,
    };
  }
  const lastNWeek = q.match(/(近|最近|过去|前)\s*(\d+)\s*(周|个?星期)/);
  if (lastNWeek) {
    const n = Number(lastNWeek[2]);
    return {
      field: 'dt',
      start: addDays(DATA_END, -(n * 7 - 1)),
      end: DATA_END,
      label: `近${n}周`,
      trend: true,
    };
  }

  if (/近7天|最近一周|近一周|过去7天/.test(q)) {
    return { field: 'dt', start: addDays(DATA_END, -6), end: DATA_END, label: '近7天', trend: true };
  }
  if (/近30天|最近一个月|近一月|过去30天/.test(q)) {
    return { field: 'dt', start: addDays(DATA_END, -29), end: DATA_END, label: '近30天', trend: true };
  }
  if (/近90天|最近三个月|近三个月|过去90天/.test(q)) {
    return { field: 'dt', start: addDays(DATA_END, -89), end: DATA_END, label: '近90天', trend: true };
  }
  if (/近14天|最近两周|近两周/.test(q)) {
    return { field: 'dt', start: addDays(DATA_END, -13), end: DATA_END, label: '近14天', trend: true };
  }

  // 仅说「趋势」而不给时间，默认近30天
  if (trend) {
    return { field: 'dt', start: addDays(DATA_END, -29), end: DATA_END, label: '近30天（默认）', trend: true };
  }

  return null;
}

// ---------- 3. 澄清规则 ----------
const CLARIFY_RULES: { pattern: RegExp; reason: string; options: ClarifyOption[] }[] = [
  {
    pattern: /留存/,
    reason: '「留存」是泛化指标，不同口径结论差异很大，需要先明确口径',
    options: [
      { label: '次日留存（D1）', value: '次日留存率', desc: '新增用户次日回访比例' },
      { label: '7日留存（D7）', value: '7日留存率', desc: '衡量产品初期粘性的核心口径' },
      { label: '30日留存（D30）', value: '30日留存率', desc: '衡量长期留存的行业通用口径' },
    ],
  },
  {
    pattern: /活跃情况|活跃表现|活跃度|怎么样|表现如何/,
    reason: '问题中缺少明确的指标口径，请选择你想看的指标',
    options: [
      { label: '日活跃用户数', value: '日活跃用户数' },
      { label: '活跃率（DAU/MAU）', value: '用户粘性（DAU/MAU）' },
      { label: '新增注册用户数', value: '新增注册用户数' },
    ],
  },
  {
    pattern: /收入情况|商业化情况|营收表现/,
    reason: '「收入情况」可对应多个商业化指标，请确认口径',
    options: [
      { label: '营收总额', value: '营收' },
      { label: '月度经常性收入（MRR）', value: '月度经常性收入' },
      { label: '每用户平均收入（ARPU）', value: '每用户平均收入' },
    ],
  },
  {
    pattern: /^按?[\u4e00-\u9fa5]{0,6}(?:拆|分)(?:一下|下|开)?$/,
    reason: '未识别到具体指标，请确认要下钻的指标',
    options: [
      { label: '日活跃用户数', value: '日活跃用户数' },
      { label: '营收', value: '营收' },
      { label: '付费用户数', value: '付费用户数' },
    ],
  },
  {
    pattern: /带量|效果好|表现好|哪(个|些)[\u4e00-\u9fa5]{0,4}(好|强|差|弱)/,
    reason: '这是一个主观评价类问题，需要先锚定一个客观指标',
    options: [
      { label: '按渠道看获客成本（CAC）', value: '各渠道获客成本' },
      { label: '按渠道看 LTV/CAC', value: '各渠道的LTV/CAC' },
      { label: '按渠道看付费转化率', value: '各渠道付费转化率' },
    ],
  },
];

// ---------- 4. 主解析函数 ----------
export interface ParseContext {
  lastMetric?: Metric;
  lastTime?: TimeRange | null;
  lastDimensions?: Dimension[];
  lastFilters?: ParsedQuery['dimensionValues'];
}

export function parseQuery(raw: string, ctx: ParseContext = {}): ParsedQuery {
  const q = raw.trim();

  // 空输入
  if (!q) {
    return {
      metrics: [], dimensions: [], dimensionValues: [], timeRange: null,
      matchedTokens: [], unknown: [], intent: 'chat', needClarify: false,
    };
  }

  // ---- 安全前置：命中直接拦截 ----
  if (UNSAFE_PATTERNS.some((p) => p.test(q)) || SENSITIVE_FIELDS.test(q)) {
    return {
      metrics: [], dimensions: [], dimensionValues: [], timeRange: null,
      matchedTokens: [], unknown: [], intent: 'unsafe', needClarify: false,
    };
  }

  // ---- 闲聊兜底 ----
  const isChat = CHAT_PATTERNS.some((p) => p.test(q));
  // ---- 策略咨询类 ----
  const isStrategy = STRATEGY_PATTERNS.some((p) => p.test(q));

  const matchedTokens: ParsedQuery['matchedTokens'] = [];

  // ---- 4.1 指标匹配（长别名优先，问题里被吃掉的字符要剔除防重叠） ----
  let work = q;
  const metrics: Metric[] = [];
  for (const { alias, metric } of METRIC_ALIAS_INDEX) {
    if (metrics.includes(metric)) continue;
    // 英文别名按词边界匹配，避免 Android 内的 roi 被识别为 ROI。
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = /[a-z]/i.test(alias) ? new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i') : null;
    if (pattern ? !pattern.test(work) : !work.includes(alias)) continue;
    metrics.push(metric);
    matchedTokens.push({ text: alias, kind: 'metric', label: metric.name });
    work = work.replace(pattern ?? alias, '　'.repeat(alias.length));
  }

  // ---- 4.2 维度值匹配 ----
  const dimensionValues: ParsedQuery['dimensionValues'] = [];
  const seenDimVal = new Set<string>();
  for (const { alias, dv } of VALUE_ALIAS_INDEX) {
    if (!work.includes(alias)) continue;
    const key = `${dv.dimension}:${dv.value}`;
    if (seenDimVal.has(key)) continue;
    seenDimVal.add(key);
    const dim = DIMENSION_ALIAS_INDEX.find((d) => d.dimension.key === dv.dimension)?.dimension;
    if (!dim) continue;
    dimensionValues.push({ dimension: dim, value: dv.value });
    matchedTokens.push({ text: alias, kind: 'value', label: `${dim.name}=${dv.value}` });
    work = work.replace(alias, '　'.repeat(alias.length));
  }

  // ---- 4.3 维度匹配 ----
  const dimensions: Dimension[] = [];
  for (const { alias, dimension } of DIMENSION_ALIAS_INDEX) {
    if (dimensions.includes(dimension)) continue;
    if (!work.includes(alias)) continue;
    // 该维度已被维度值锁定，仍允许作为分组维度
    dimensions.push(dimension);
    matchedTokens.push({ text: alias, kind: 'dimension', label: dimension.name });
    work = work.replace(alias, '　'.repeat(alias.length));
  }

  // ---- 4.4 时间解析 ----
  let timeRange = parseTime(q);

  // ---- 4.5 追问上下文继承（Badcase BC-010） ----
  const isFollowup = FOLLOWUP_PATTERNS.some((p) => p.test(q));
  if (isFollowup && ctx.lastFilters) {
    for (const filter of ctx.lastFilters) {
      if (!dimensionValues.some(v => v.dimension.key === filter.dimension.key)) dimensionValues.push(filter);
    }
  }
  if (isFollowup && ctx.lastMetric) {
    if (!metrics.includes(ctx.lastMetric)) metrics.push(ctx.lastMetric);
    if (!timeRange && ctx.lastTime) timeRange = ctx.lastTime;
  }
  // 「那按渠道拆一下」这类：有维度无指标 -> 继承上一轮指标
  if (metrics.length === 0 && dimensions.length > 0 && ctx.lastMetric) {
    metrics.push(ctx.lastMetric);
    if (!timeRange && ctx.lastTime) timeRange = ctx.lastTime;
  }

  // ---- 4.6 泛化词处理 ----
  const genericMetric = metrics.find((m) => m.generic);
  const unknown: string[] = work
    .replace(/[　\s]/g, ' ')
    .split(/[，。,.！!？?、；;：:\s]+/)
    .filter((s) => s.length >= 2)
    .slice(0, 6);

  // ---- 4.7 澄清判定 ----
  let needClarify = false;
  let clarifyOptions: ClarifyOption[] | undefined;
  let clarifyReason: string | undefined;

  if (genericMetric) {
    const rule = CLARIFY_RULES.find((r) => r.pattern.test(raw));
    needClarify = true;
    clarifyReason = rule?.reason ?? `「${genericMetric.name}」是上层概念，需要确认具体口径`;
    clarifyOptions =
      rule?.options ??
      [
        { label: '次日留存（D1）', value: '次日留存率' },
        { label: '7日留存（D7）', value: '7日留存率' },
        { label: '30日留存（D30）', value: '30日留存率' },
      ];
  } else if (metrics.length === 0 && !isChat) {
    const rule = CLARIFY_RULES.find((r) => r.pattern.test(raw));
    needClarify = true;
    clarifyReason = rule?.reason ?? '没有识别到明确的指标，请补充你想看的指标';
    clarifyOptions =
      rule?.options ??
      [
        { label: '日活跃用户数', value: '日活跃用户数' },
        { label: '营收', value: '营收' },
        { label: '付费转化率', value: '付费转化率' },
        { label: '获客成本', value: '获客成本' },
      ];
  }

  // 策略咨询类：转化为确定性查询
  let intent: ParsedQuery['intent'] = 'query';
  if (isChat && metrics.length === 0) intent = 'chat';
  else if (isStrategy) intent = 'strategy';

  const cleanedMetrics = metrics.filter((m) => !m.generic);

  return {
    metrics: cleanedMetrics,
    dimensions,
    dimensionValues,
    timeRange,
    matchedTokens,
    unknown,
    intent,
    needClarify: isChat ? false : needClarify,
    clarifyOptions,
    clarifyReason,
  };
}

/** 术语归一化的可读映射，供 UI 展示 */
export function explainMapping(parsed: ParsedQuery): { from: string; to: string; kind: string }[] {
  const out: { from: string; to: string; kind: string }[] = [];
  for (const t of parsed.matchedTokens) {
    const kindLabel =
      t.kind === 'metric' ? '指标' : t.kind === 'dimension' ? '维度' : t.kind === 'value' ? '维度值' : '时间';
    out.push({ from: t.text, to: t.label, kind: kindLabel });
  }
  return out;
}

/** 供 UI 使用的别名唯一性校验结果（内置在「知识库治理」中） */
export const ALIAS_CONFLICTS = validateAliasUniqueness();

export { DATA_START, DATA_END, dimensionLabel };
