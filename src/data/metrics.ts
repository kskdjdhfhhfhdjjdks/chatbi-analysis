import type { Metric } from '../types';

// ============================================================
// 指标知识库（Metrics Knowledge Base）
// 语义理解层的第一库：解决「业务黑话 -> 标准指标」
// 每个指标都带别名表，别名冲突在上线前由校验脚本拦截
// ============================================================

export const METRICS: Metric[] = [
  // ---------- 用户规模 ----------
  {
    key: 'dau',
    name: '日活跃用户数',
    aliases: ['日活', 'DAU', '活跃用户', '日活跃', '活跃数', '活跃人数'],
    unit: 'count',
    field: 'dau',
    domain: '用户规模',
    desc: '统计周期内每日去重活跃用户数',
  },
  {
    key: 'mau',
    name: '月活跃用户数',
    aliases: ['月活', 'MAU', '月活跃', '月活跃用户'],
    unit: 'count',
    field: 'mau',
    domain: '用户规模',
    desc: '自然月内去重活跃用户数',
  },
  {
    key: 'new_users',
    name: '新增注册用户数',
    aliases: ['新增用户', '新增', '拉新数', '新用户', '注册用户', '新增注册'],
    unit: 'count',
    field: 'new_users',
    domain: '用户规模',
    desc: '首次完成注册的用户数',
  },
  {
    key: 'active_rate',
    name: '活跃率',
    aliases: ['活跃率', '活跃占比'],
    unit: 'ratio',
    field: 'active_rate',
    isRatio: true,
    numerator: 'dau',
    denominator: 'dau_mau_base',
    domain: '用户规模',
    desc: 'DAU / MAU，衡量用户粘性',
  },
  {
    key: 'dau_mau',
    name: '用户粘性（DAU/MAU）',
    aliases: ['用户粘性', '粘性', 'DAU/MAU', '互动率'],
    unit: 'ratio',
    field: 'dau_mau',
    isRatio: true,
    numerator: 'dau',
    denominator: 'dau_mau_base',
    domain: '用户规模',
    desc: '日活与月活的比值，反映产品使用频次',
  },

  // ---------- 留存与流失 ----------
  {
    key: 'retention_d1',
    name: '次日留存率',
    aliases: ['次日留存', 'D1留存', '1日留存', 'day1留存'],
    unit: 'ratio',
    field: 'retention_d1',
    isRatio: true,
    numerator: 'retention_d1_num',
    denominator: 'new_users',
    domain: '留存与流失',
    desc: '新增用户次日仍活跃的比例',
  },
  {
    key: 'retention_d7',
    name: '7日留存率',
    aliases: ['7日留存', 'D7留存', '周留存', '七日留存'],
    unit: 'ratio',
    field: 'retention_d7',
    isRatio: true,
    numerator: 'retention_d7_num',
    denominator: 'new_users',
    domain: '留存与流失',
    desc: '新增用户第 7 日仍活跃的比例',
  },
  {
    key: 'retention_d30',
    name: '30日留存率',
    aliases: ['30日留存', 'D30留存', '月留存', '三十日留存', '长期留存'],
    unit: 'ratio',
    field: 'retention_d30',
    isRatio: true,
    numerator: 'retention_d30_num',
    denominator: 'new_users',
    domain: '留存与流失',
    desc: '新增用户第 30 日仍活跃的比例',
  },
  {
    key: 'churn_users',
    name: '流失用户数',
    aliases: ['流失用户', '流失', '掉线用户', '沉睡用户', '沉默用户', '流失数'],
    unit: 'count',
    field: 'churn_users',
    domain: '留存与流失',
    desc: '连续 30 天未活跃的用户',
  },
  {
    key: 'churn_rate',
    name: '流失率',
    aliases: ['流失率', '掉线率', '流失占比'],
    unit: 'ratio',
    field: 'churn_rate',
    isRatio: true,
    numerator: 'churn_users',
    denominator: 'dau_mau_base',
    domain: '留存与流失',
    desc: '流失用户 / 期初活跃用户',
  },

  // ---------- 商业化 ----------
  {
    key: 'revenue',
    name: '营收',
    aliases: ['营收', '收入', '总收入', '流水', 'GMV'],
    unit: 'currency',
    field: 'revenue',
    domain: '商业化',
    desc: '周期内确认收入总额',
  },
  {
    key: 'mrr',
    name: '月度经常性收入',
    aliases: ['MRR', '月经常性收入', '经常性收入', '订阅收入'],
    unit: 'currency',
    field: 'mrr',
    domain: '商业化',
    desc: '订阅制产品的月度经常性收入',
  },
  {
    key: 'arpu',
    name: '每用户平均收入',
    aliases: ['客单价', 'ARPU', '人均付费', '人均收入', '单用户价值'],
    unit: 'currency',
    field: 'arpu',
    isRatio: true,
    numerator: 'revenue',
    denominator: 'dau',
    domain: '商业化',
    desc: '营收 / 活跃用户数，业务口径的客单价',
  },
  {
    key: 'arppu',
    name: '每付费用户平均收入',
    aliases: ['付费客单价', 'ARPPU', '付费人均'],
    unit: 'currency',
    field: 'arppu',
    isRatio: true,
    numerator: 'revenue',
    denominator: 'paid_users',
    domain: '商业化',
    desc: '营收 / 付费用户数',
  },
  {
    key: 'paid_users',
    name: '付费用户数',
    aliases: ['付费用户', '付费人数', '付费数', '付费用户数'],
    unit: 'count',
    field: 'paid_users',
    domain: '商业化',
    desc: '周期内产生付费行为的用户数',
  },
  {
    key: 'pay_rate',
    name: '付费转化率',
    aliases: ['付费转化率', '付费率', '转化率', '付费转化', '购买转化'],
    unit: 'ratio',
    field: 'pay_rate',
    isRatio: true,
    numerator: 'paid_users',
    denominator: 'new_users',
    domain: '商业化',
    desc: '付费用户 / 新增用户',
  },
  {
    key: 'refund_rate',
    name: '退款率',
    aliases: ['退款率', '退费率', '退款占比'],
    unit: 'ratio',
    field: 'refund_rate',
    isRatio: true,
    numerator: 'refund_users',
    denominator: 'paid_users',
    domain: '商业化',
    desc: '退款用户 / 付费用户',
  },

  // ---------- 增长效率 ----------
  {
    key: 'cac',
    name: '获客成本',
    aliases: ['获客成本', 'CAC', '拉新成本', '获客单价', '单人获客成本'],
    unit: 'currency',
    field: 'cac',
    isRatio: true,
    numerator: 'marketing_cost',
    denominator: 'new_users',
    domain: '增长效率',
    desc: '营销费用 / 新增用户数',
  },
  {
    key: 'ltv',
    name: '用户生命周期价值',
    aliases: ['LTV', '生命周期价值', '用户价值', '长期价值'],
    unit: 'currency',
    field: 'ltv',
    // LTV 是「人均」口径，必须用 总价值/总用户数，不能对行级值取平均
    isRatio: true,
    numerator: 'ltv_num',
    denominator: 'dau',
    domain: '增长效率',
    desc: '单个用户全生命周期贡献收入（总价值 / 活跃用户数）',
  },
  {
    key: 'ltv_cac',
    name: 'LTV/CAC 比值',
    aliases: ['LTV/CAC', '投产比', '投入产出比', 'ROI', 'roi', '回报率'],
    unit: 'score',
    field: 'ltv_cac',
    isRatio: true,
    numerator: 'ltv_num',
    denominator: 'cac_num',
    domain: '增长效率',
    desc: 'LTV 与 CAC 的比值，衡量投放健康度',
  },
  {
    key: 'marketing_cost',
    name: '营销费用',
    aliases: ['营销费用', '市场费用', '投放费用', '推广费', '广告花费'],
    unit: 'currency',
    field: 'marketing_cost',
    domain: '增长效率',
    desc: '周期内市场推广总支出',
  },

  // ---------- 产品体验 ----------
  {
    key: 'session_count',
    name: '会话次数',
    aliases: ['会话数', '会话次数', '访问次数', '启动次数'],
    unit: 'count',
    field: 'session_count',
    domain: '产品体验',
    desc: '用户会话总次数',
  },
  {
    key: 'avg_duration',
    name: '平均使用时长',
    aliases: ['平均使用时长', '使用时长', '人均时长', '平均时长', '停留时长'],
    unit: 'duration',
    field: 'avg_duration',
    isRatio: true,
    numerator: 'total_duration',
    denominator: 'session_count',
    domain: '产品体验',
    desc: '总时长 / 会话次数',
  },
  {
    key: 'crash_rate',
    name: '崩溃率',
    aliases: ['崩溃率', '闪退率', '异常率'],
    unit: 'ratio',
    field: 'crash_rate',
    isRatio: true,
    numerator: 'crash_sessions',
    denominator: 'session_count',
    domain: '产品体验',
    desc: '崩溃会话 / 总会话',
  },
  {
    key: 'nps',
    name: '净推荐值',
    aliases: ['NPS', '净推荐值', '推荐值', '满意度'],
    unit: 'score',
    field: 'nps',
    domain: '产品体验',
    desc: '用户推荐意愿评分（-100 ~ 100）',
  },

  // ---------- 泛化词（必须澄清） ----------
  {
    key: '__generic_retention',
    name: '留存',
    aliases: ['留存', '留存情况', '留存表现'],
    unit: 'ratio',
    field: 'retention',
    domain: '留存与流失',
    desc: '泛化词，需澄清 D1/D7/D30',
    generic: true,
  },
  {
    key: '__generic_active',
    name: '活跃',
    aliases: ['活跃情况', '活跃表现', '活跃度'],
    unit: 'count',
    field: 'dau',
    domain: '用户规模',
    desc: '泛化词，需澄清口径',
    generic: true,
  },
  {
    key: '__generic_revenue',
    name: '收入情况',
    aliases: ['收入情况', '营收表现', '商业化情况'],
    unit: 'currency',
    field: 'revenue',
    domain: '商业化',
    desc: '泛化词，需澄清指标',
    generic: true,
  },
];

/** 按别名长度倒序，保证「付费用户」优先于「用户」被匹配 */
export const METRIC_ALIAS_INDEX: { alias: string; metric: Metric }[] = (() => {
  const list: { alias: string; metric: Metric }[] = [];
  for (const m of METRICS) {
    for (const a of m.aliases) list.push({ alias: a, metric: m });
  }
  return list.sort((a, b) => b.alias.length - a.alias.length);
})();

/** 别名唯一性校验：返回冲突的别名（用于 Badcase BC-002 的防线） */
export function validateAliasUniqueness(): { alias: string; owners: string[] }[] {
  const map = new Map<string, string[]>();
  for (const m of METRICS) {
    for (const a of m.aliases) {
      const arr = map.get(a) ?? [];
      arr.push(m.name);
      map.set(a, arr);
    }
  }
  return [...map.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([alias, owners]) => ({ alias, owners }));
}

/** 获取指标 */
export function findMetric(key: string): Metric | undefined {
  return METRICS.find((m) => m.key === key);
}
