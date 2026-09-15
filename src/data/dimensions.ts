import type { Dimension, DimensionValue } from '../types';

// ============================================================
// 维度知识库（Dimensions Knowledge Base）
// 语义理解层的第二库：解决「业务口径 -> 物理维度」
// 包含维度名别名 + 维度值别名（苹果 -> iOS，江浙沪 -> 华东）
// ============================================================

export const DIMENSIONS: Dimension[] = [
  {
    key: 'channel',
    name: '渠道',
    field: 'channel',
    aliases: ['渠道', '来源', '获客渠道', '流量来源', '投放渠道'],
  },
  {
    key: 'device',
    name: '设备',
    field: 'device',
    aliases: ['设备', '端', '平台', '机型', '终端'],
  },
  {
    key: 'region',
    name: '地区',
    field: 'region',
    aliases: ['地区', '区域', '地域', '省份', '城市'],
  },
  {
    key: 'plan',
    name: '套餐',
    field: 'plan',
    aliases: ['套餐', '版本', '订阅类型', '付费版本'],
  },
  {
    key: 'segment',
    name: '用户分层',
    field: 'segment',
    aliases: ['用户分层', '用户分群', '人群', '分层', '用户等级'],
  },
  {
    key: 'industry',
    name: '行业',
    field: 'industry',
    aliases: ['行业', '客户行业', '所属行业'],
  },
  {
    key: 'dt',
    name: '日期',
    field: 'dt',
    aliases: ['日期', '每天', '趋势', '走势', '变化', '按天'],
  },
];

export const DIMENSION_ALIAS_INDEX: { alias: string; dimension: Dimension }[] = (() => {
  const list: { alias: string; dimension: Dimension }[] = [];
  for (const d of DIMENSIONS) {
    for (const a of d.aliases) list.push({ alias: a, dimension: d });
  }
  return list.sort((a, b) => b.alias.length - a.alias.length);
})();

// ============================================================
// 维度值别名表：业务口语 -> 数仓标准值
// ============================================================

export const DIMENSION_VALUES: DimensionValue[] = [
  {
    dimension: 'device',
    value: 'iOS',
    aliases: ['苹果', '苹果端', '苹果手机', 'iOS', 'ios', 'iPhone', 'ios端', '果机'],
  },
  {
    dimension: 'device',
    value: 'Android',
    aliases: [
      '安卓', '安卓端', 'Android', 'android', '华为', '小米', 'OPPO', 'vivo',
      '荣耀', '三星', '一加', 'realme', '红米', '安卓机',
    ],
  },
  {
    dimension: 'device',
    value: '小程序',
    aliases: ['小程序', '微信小程序', '小程序端', 'wechat', '微信端'],
  },
  {
    dimension: 'device',
    value: 'Web',
    aliases: ['网页', '网页端', 'Web', 'web', 'PC', 'pc端', '电脑端', '桌面端'],
  },
  {
    dimension: 'device',
    value: 'Pad',
    aliases: ['平板', 'iPad', 'ipad', 'Pad', 'pad端'],
  },
  {
    dimension: 'region',
    value: '华东',
    aliases: ['华东', '江浙沪', '江浙沪地区', '长三角', '上海', '江苏', '浙江'],
  },
  {
    dimension: 'region',
    value: '华北',
    aliases: ['华北', '京津冀', '北京', '天津', '河北', '环京'],
  },
  {
    dimension: 'region',
    value: '华南',
    aliases: ['华南', '珠三角', '广东', '广州', '深圳', '大湾区'],
  },
  {
    dimension: 'region',
    value: '西南',
    aliases: ['西南', '川渝', '四川', '重庆', '成都'],
  },
  {
    dimension: 'region',
    value: '海外',
    aliases: ['海外', '出海', '国外', '境外', '国际化'],
  },
  {
    dimension: 'channel',
    value: '自然流量',
    aliases: ['自然流量', '自然量', '自然增长', '口碑', '推荐', '自然'],
  },
  {
    dimension: 'channel',
    value: '付费广告',
    aliases: ['付费广告', '买量', '投放', '广告', '信息流', '竞价', '付费'],
  },
  {
    dimension: 'channel',
    value: '内容营销',
    aliases: ['内容营销', '内容', '公众号', '小红书', '知乎', '短视频', '种草'],
  },
  {
    dimension: 'channel',
    value: '渠道代理',
    aliases: ['渠道代理', '代理', '经销商', '合作渠道', '渠道商'],
  },
  {
    dimension: 'channel',
    value: 'SEO',
    aliases: ['SEO', 'seo', '搜索', '搜索流量', '自然搜索'],
  },
  {
    dimension: 'plan',
    value: '免费版',
    aliases: ['免费版', '免费', '基础版', 'Free', '试用版'],
  },
  {
    dimension: 'plan',
    value: '专业版',
    aliases: ['专业版', 'Pro', 'pro版', '进阶版', '标准版'],
  },
  {
    dimension: 'plan',
    value: '企业版',
    aliases: ['企业版', 'Enterprise', '旗舰版', '商业版', '大客户版'],
  },
  {
    dimension: 'segment',
    value: '高价值',
    aliases: ['高价值', '大R', '大R用户', '核心用户', '重度用户', '高净值', 'VIP'],
  },
  {
    dimension: 'segment',
    value: '中价值',
    aliases: ['中价值', '中R', '普通用户', '腰部用户'],
  },
  {
    dimension: 'segment',
    value: '低价值',
    aliases: ['低价值', '小R', '轻度用户', '长尾用户'],
  },
  {
    dimension: 'industry',
    value: '互联网',
    aliases: ['互联网', 'IT', '科技', '互联网行业'],
  },
  {
    dimension: 'industry',
    value: '金融',
    aliases: ['金融', '银行', '保险', '证券', 'fintech'],
  },
  {
    dimension: 'industry',
    value: '教育',
    aliases: ['教育', '培训', '在线教育', '教培'],
  },
  {
    dimension: 'industry',
    value: '医疗',
    aliases: ['医疗', '大健康', '医院', '健康'],
  },
  {
    dimension: 'industry',
    value: '制造业',
    aliases: ['制造业', '制造', '工业', '工厂'],
  },
];

/** 维度值别名索引 */
export const VALUE_ALIAS_INDEX: { alias: string; dv: DimensionValue }[] = (() => {
  const list: { alias: string; dv: DimensionValue }[] = [];
  for (const dv of DIMENSION_VALUES) {
    for (const a of dv.aliases) list.push({ alias: a, dv });
  }
  return list.sort((a, b) => b.alias.length - a.alias.length);
})();

/** 获取某维度的全部值 */
export function valuesOf(dimension: string): string[] {
  return DIMENSION_VALUES.filter((d) => d.dimension === dimension).map((d) => d.value);
}

export function findDimension(key: string): Dimension | undefined {
  return DIMENSIONS.find((d) => d.key === key);
}

/** 维度的业务展示名 */
export function dimensionLabel(key: string): string {
  return DIMENSIONS.find((d) => d.key === key)?.name ?? key;
}
