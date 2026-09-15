import type { Metric } from '../types';
import { METRICS } from './metrics';

// ============================================================
// 事实表（Fact Table）—— 确定性种子数据
// 用可复现的伪随机数生成 180 天 × 多维度的行级明细
// 内置「异常」用于归因下钻演示：
//   1) 2026-09-08 起 Android 端 DAU 显著下滑（渠道"付费广告"停止投放导致）
//   2) 2026-09-05 起 转化率在 企业版 上异常走低
// ============================================================

export const DATA_START = '2026-03-18';
export const DATA_END = '2026-09-13';
export const TODAY = '2026-09-14';
export const YESTERDAY = '2026-09-13';

export const CHANNELS = ['自然流量', '付费广告', '内容营销', '渠道代理', 'SEO'];
export const DEVICES = ['iOS', 'Android', '小程序', 'Web', 'Pad'];
export const REGIONS = ['华东', '华北', '华南', '西南', '海外'];
export const PLANS = ['免费版', '专业版', '企业版'];
export const SEGMENTS = ['高价值', '中价值', '低价值'];
export const INDUSTRIES = ['互联网', '金融', '教育', '医疗', '制造业'];

export const DIMENSION_KEYS = ['channel', 'device', 'region', 'plan', 'segment', 'industry'] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_LEVELS: Record<DimensionKey, string[]> = {
  channel: CHANNELS,
  device: DEVICES,
  region: REGIONS,
  plan: PLANS,
  segment: SEGMENTS,
  industry: INDUSTRIES,
};

/** 行级明细 */
export interface FactRow {
  dt: string;
  channel: string;
  device: string;
  region: string;
  plan: string;
  segment: string;
  industry: string;
  [field: string]: string | number;
}

/** 指标底层的全部物理字段 */
export const FACT_FIELDS = [
  'dau', 'mau', 'dau_mau_base', 'new_users', 'active_rate',
  'retention_d1_num', 'retention_d7_num', 'retention_d30_num', 'churn_users',
  'revenue', 'mrr', 'paid_users', 'refund_users', 'marketing_cost',
  'ltv_num', 'cac_num', 'session_count', 'total_duration', 'crash_sessions',
  'nps',
];

/** 确定性伪随机：按字符串种子生成 [0,1) */
function seededRandom(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function dateList(): string[] {
  const out: string[] = [];
  const start = new Date(DATA_START + 'T00:00:00Z');
  const end = new Date(DATA_END + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const ALL_DATES = dateList();

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000,
  );
}

/** 生成全量事实表（模块级懒加载，只算一次） */
let cache: FactRow[] | null = null;

export function buildFacts(): FactRow[] {
  if (cache) return cache;
  const rows: FactRow[] = [];

  // 各渠道的规模权重（付费广告最大）
  const channelWeight: Record<string, number> = {
    自然流量: 0.26, 付费广告: 0.34, 内容营销: 0.16, 渠道代理: 0.11, SEO: 0.13,
  };
  const deviceWeight: Record<string, number> = {
    iOS: 0.28, Android: 0.42, 小程序: 0.16, Web: 0.1, Pad: 0.04,
  };
  const regionWeight: Record<string, number> = {
    华东: 0.32, 华北: 0.24, 华南: 0.22, 西南: 0.13, 海外: 0.09,
  };
  const planWeight: Record<string, number> = { 免费版: 0.66, 专业版: 0.24, 企业版: 0.1 };
  const segmentWeight: Record<string, number> = { 高价值: 0.14, 中价值: 0.36, 低价值: 0.5 };
  const industryWeight: Record<string, number> = {
    互联网: 0.36, 金融: 0.16, 教育: 0.14, 医疗: 0.12, 制造业: 0.22,
  };

  let dayIndex = 0;
  for (const dt of ALL_DATES) {
    // 大盘自然增长曲线 + 周末波动
    // 注意：全维度笛卡尔积为 5625 个格子/天，因此单格基数必须足够大，
    // 否则 Math.round 会把新增/留存这类小数值抹平成 0，导致比率失真
    const base = 6800000 * (1 + dayIndex * 0.0028);
    const dow = new Date(dt + 'T00:00:00Z').getUTCDay();
    const weekendFactor = dow === 0 || dow === 6 ? 0.86 : 1.06;
    const growth = base * weekendFactor;

    for (const channel of CHANNELS) {
      for (const device of DEVICES) {
        for (const region of REGIONS) {
          for (const plan of PLANS) {
            for (const segment of SEGMENTS) {
              {
                // industry 不进入笛卡尔积（否则行数 ×5），按通道派生即可
                const industry = INDUSTRIES[
                  Math.floor(seededRandom(`${channel}|${device}|${region}|${dt}`) * INDUSTRIES.length)
                ];
                const seed = `${dt}|${channel}|${device}|${region}|${plan}|${segment}`;
                const noise = 0.86 + seededRandom(seed) * 0.3;

                let dau =
                  growth *
                  channelWeight[channel] *
                  deviceWeight[device] *
                  regionWeight[region] *
                  planWeight[plan] *
                  segmentWeight[segment] *
                  industryWeight[industry] *
                  noise;

                // 【异常1】9/8 起 Android 端因付费广告停投而显著下滑
                if (device === 'Android' && dt >= '2026-09-08') {
                  const drop = dt >= '2026-09-10' ? 0.32 : 0.22;
                  dau *= 1 - drop;
                }
                // 内容营销持续小幅增长
                if (channel === '内容营销') dau *= 1 + dayIndex * 0.0016;

                dau = Math.max(1, Math.round(dau));

                // 派生字段
                // mau 由 dau 派生，但叠加「月活池」的独立累积效应：
                // 老用户月度回访池会随时间缓慢扩大，使 DAU/MAU 呈真实漂移，而非恒定值
                const mauFactor = 3.4 + seededRandom(seed + '#mau') * 0.5;
                const mauBase = Math.sqrt(dau * dau * mauFactor);
                const mau = Math.round(mauBase * (1 + dayIndex * 0.0011));
                // dau_mau_base 是「DAU 的月活分母」，随时间小幅抬升 → 粘性缓慢下滑
                const dauMauBase = Math.round(
                  Math.sqrt(mau * mau * (0.78 + seededRandom(seed + '#base') * 0.1)) *
                    (1 + dayIndex * 0.0014),
                );
                const newUsers = Math.round(dau * (0.052 + seededRandom(seed + '#nu') * 0.028));

                // 留存：默认 ~0.42/0.26/0.15
                let r1 = 0.4 + seededRandom(seed + '#r1') * 0.1;
                let r7 = 0.24 + seededRandom(seed + '#r7') * 0.08;
                let r30 = 0.13 + seededRandom(seed + '#r30') * 0.06;
                // 【异常2】9/5 起 企业版 留存异常走低
                if (plan === '企业版' && dt >= '2026-09-05') {
                  r7 *= 0.72;
                  r30 *= 0.68;
                }
                const retention_d1_num = Math.round(newUsers * r1);
                const retention_d7_num = Math.round(newUsers * r7);
                const retention_d30_num = Math.round(newUsers * r30);

                const churn_users = Math.round(dauMauBase * (0.028 + seededRandom(seed + '#ch') * 0.02));

                // ---- 商业化：不同维度有不同的付费质量，避免各维度聚合后趋同 ----
                // 渠道付费质量：付费广告 ARPU 高但转化率低；内容营销转化好但 ARPU 低
                const channelArpu: Record<string, number> = {
                  自然流量: 1.0, 付费广告: 1.32, 内容营销: 0.82, 渠道代理: 1.18, SEO: 0.94,
                };
                const channelPayRate: Record<string, number> = {
                  自然流量: 1.15, 付费广告: 0.78, 内容营销: 1.28, 渠道代理: 0.92, SEO: 1.05,
                };
                // 套餐付费质量
                const planArpu: Record<string, number> = { 免费版: 0.18, 专业版: 0.86, 企业版: 2.4 };
                const planPayRate: Record<string, number> = { 免费版: 0.36, 专业版: 1.4, 企业版: 2.1 };
                // 地区与分层
                const regionPayRate: Record<string, number> = {
                  华东: 1.22, 华北: 1.08, 华南: 1.12, 西南: 0.82, 海外: 0.9,
                };
                const segmentArpu: Record<string, number> = { 高价值: 2.6, 中价值: 1.05, 低价值: 0.42 };
                const segmentPayRate: Record<string, number> = { 高价值: 3.2, 中价值: 1.2, 低价值: 0.5 };

                const arpu =
                  (12 + seededRandom(seed + '#arpu') * 10) *
                  channelArpu[channel] *
                  planArpu[plan] *
                  segmentArpu[segment];
                // 付费质量因子：相乘后会远大于 1，因此先归一化到「相对倍数」再压缩
                const payQuality =
                  channelPayRate[channel] *
                  planPayRate[plan] *
                  regionPayRate[region] *
                  segmentPayRate[segment];
                // 相对基准的倍数（基准取各因子均值附近），再用饱和函数压到 (0,1)
                const basePay = 0.018 + seededRandom(seed + '#pr') * 0.012;
                const payRate = Math.min(0.92, basePay * Math.pow(payQuality, 0.62));
                const paid_users = Math.round(dau * payRate);
                let revenue = Math.round(dau * arpu);
                if (plan === '企业版' && dt >= '2026-09-05') revenue = Math.round(revenue * 0.93);

                const mrr = Math.round(revenue * (0.42 + seededRandom(seed + '#mrr') * 0.16));
                const refund_users = Math.round(paid_users * (0.012 + seededRandom(seed + '#rf') * 0.018));

                // ---- 增长效率 ----
                // 设计要点：LTV / CAC 必须由「渠道 × 套餐 × 分层」共同决定，
                // 且都按「人均口径」生成（再乘以对应人数得到可求和的分子），
                // 否则各维度聚合后会趋同，ROI 对比就失去意义。
                const channelCacMultiplier: Record<string, number> = {
                  自然流量: 0.32, 付费广告: 2.35, 内容营销: 0.72, 渠道代理: 1.45, SEO: 0.48,
                };
                // 渠道用户质量：自然流量/内容营销质量高，付费广告质量偏低
                const channelLtvMultiplier: Record<string, number> = {
                  自然流量: 1.55, 付费广告: 0.78, 内容营销: 1.32, 渠道代理: 0.95, SEO: 1.18,
                };
                const planLtvMultiplier: Record<string, number> =
                  { 免费版: 0.55, 专业版: 1.15, 企业版: 2.0 };
                const segmentLtvMultiplier: Record<string, number> =
                  { 高价值: 2.4, 中价值: 1.1, 低价值: 0.6 };

                // 人均 LTV（元/用户）
                const ltvPerUser =
                  42 * // 基准人均终身价值
                  (1 + seededRandom(seed + '#ltv') * 0.4) *
                  channelLtvMultiplier[channel] *
                  planLtvMultiplier[plan] *
                  segmentLtvMultiplier[segment];
                // 分子：用「人均 LTV × 活跃用户数」，保证 SUM(ltv_num)/SUM(dau) = 人均 LTV
                const ltv_num = Math.round(dau * ltvPerUser);

                const marketing_cost = Math.round(
                  dau * (3.1 + seededRandom(seed + '#mc') * 2.4) * channelCacMultiplier[channel],
                );
                // 人均 CAC（元/新增用户）
                const cacPerUser =
                  (18 + seededRandom(seed + '#cac') * 22) * channelCacMultiplier[channel];
                const cac_num = Math.round(newUsers * cacPerUser);

                // 产品体验
                const session_count = Math.round(dau * (1.6 + seededRandom(seed + '#sc') * 1.2));
                const total_duration = Math.round(session_count * (180 + seededRandom(seed + '#dur') * 260));
                let crash_sessions = Math.round(session_count * (0.004 + seededRandom(seed + '#cr') * 0.009));
                // 【异常3】9/10 起 iOS 端崩溃率走高
                if (device === 'iOS' && dt >= '2026-09-10') crash_sessions = Math.round(crash_sessions * 2.6);
                const nps = Math.round(28 + seededRandom(seed + '#nps') * 34);

                rows.push({
                  dt, channel, device, region, plan, segment, industry,
                  dau, mau, dau_mau_base: dauMauBase, new_users: newUsers,
                  active_rate: dauMauBase ? dau / dauMauBase : 0,
                  retention_d1_num, retention_d7_num, retention_d30_num, churn_users,
                  revenue, mrr, paid_users, refund_users, marketing_cost,
                  ltv_num, cac_num, session_count, total_duration, crash_sessions, nps,
                });
              }
            }
          }
        }
      }
    }
    dayIndex++;
  }
  cache = rows;
  return rows;
}

/** 计算某指标在给定行集合上的聚合值（比率型先求和再相除） */
export function aggregate(rows: FactRow[], metric: Metric): number {
  if (rows.length === 0) return 0;
  if (metric.isRatio && metric.numerator && metric.denominator) {
    let num = 0;
    let den = 0;
    for (const r of rows) {
      num += Number(r[metric.numerator] ?? 0);
      den += Number(r[metric.denominator] ?? 0);
    }
    return den === 0 ? 0 : num / den;
  }
  let sum = 0;
  for (const r of rows) sum += Number(r[metric.field] ?? 0);
  // NPS 是评分，取均值更符合业务语义
  if (metric.key === 'nps') return sum / rows.length;
  return sum;
}

/** 数据可查询范围提示（对应 Badcase BC-005） */
export function rangeHint(): string {
  return `数据表可用时间范围为 ${DATA_START} 起（当前至 ${DATA_END}）`;
}

/** 判断时间范围是否完全落在数据之外 */
export function outOfRange(start: string, end: string): boolean {
  return end < DATA_START || start > DATA_END;
}

export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}

export { daysBetween };

/** 供 UI 下拉使用的指标（排除泛化词） */
export const USABLE_METRICS = METRICS.filter((m) => !m.generic);
