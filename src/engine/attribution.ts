import type { Attribution, AttributionNode, ParsedQuery } from '../types';
import { aggregate, buildFacts, addDays, type FactRow } from '../data/facts';
import { DIMENSIONS, dimensionLabel } from '../data/dimensions';

// ============================================================
// 归因下钻引擎（Attribution Drill-down）
// 链路：异常检测 -> 维度枚举拆解 -> 贡献度计算 -> 逐层下钻 -> 结论生成
// 核心思想：ΔTotal = Σ Δ(各维度成员)，按贡献度排序定位根因
//
// 对比期设计（关键）：
//   不比较「整段窗口的前半 vs 后半」——那会把自然增长趋势误判为异常。
//   改为「最近 N 天 vs 紧邻的前 N 天」，窗口等长、口径可比，
//   才能真正暴露突变型异常（如停投、版本故障）。
// ============================================================

/** 归因分析的维度优先顺序（越靠前越贴近业务操作面） */
export const ATTRIBUTION_DIMENSIONS = ['channel', 'device', 'region', 'plan', 'segment'];

const COMPARE_WINDOW = 7;

/** 主归因函数 */
export function attribute(query: ParsedQuery): Attribution | null {
  const metric = query.metrics[0];
  const time = query.timeRange;
  if (!metric) return null;

  const facts = buildFacts();

  // 观测期锚点：优先使用查询的时间范围末端，否则用全量数据末端
  const anchorEnd = time ? min(time.end, maxDate(facts)) : maxDate(facts);

  // 当前期：最近 7 天；对比期：紧邻的前 7 天
  const currStart = addDays(anchorEnd, -(COMPARE_WINDOW - 1));
  const prevEnd = addDays(currStart, -1);
  const prevStart = addDays(prevEnd, -(COMPARE_WINDOW - 1));

  // 已锁定的过滤条件（这些维度不再作为下钻维度，避免无效拆解）
  const lockedDims = new Set(query.dimensionValues.map((d) => d.dimension.key));

  let currRows = facts.filter((r) => r.dt >= currStart && r.dt <= anchorEnd);
  let prevRows = facts.filter((r) => r.dt >= prevStart && r.dt <= prevEnd);
  for (const dv of query.dimensionValues) {
    currRows = currRows.filter((r) => String(r[dv.dimension.field]) === dv.value);
    prevRows = prevRows.filter((r) => String(r[dv.dimension.field]) === dv.value);
  }
  if (currRows.length === 0 || prevRows.length === 0) return null;

  const currValue = aggregate(currRows, metric);
  const prevValue = aggregate(prevRows, metric);
  const changeRate = prevValue === 0 ? 0 : (currValue - prevValue) / prevValue;
  // 异常阈值：规模类 ±5%，比率类 ±8%（周对周对比更敏感）
  const threshold = metric.unit === 'ratio' ? 0.08 : 0.05;
  const isAnomaly = Math.abs(changeRate) >= threshold;
  const delta = currValue - prevValue;

  // ---- 逐层下钻：每层选一个维度，沿贡献度最大的成员收敛 ----
  const levelResults: { dimKey: string; nodes: AttributionNode[] }[] = [];
  const availableDims = ATTRIBUTION_DIMENSIONS.filter((d) => !lockedDims.has(d));

  let cRows = currRows;
  let pRows = prevRows;

  for (let level = 0; level < Math.min(3, availableDims.length); level++) {
    const dimKey = availableDims[level];
    const dim = DIMENSIONS.find((d) => d.key === dimKey);
    if (!dim) break;
    // 样本太少则停止下钻，避免小样本噪音
    if (cRows.length < 40) break;

    const values = new Set(cRows.map((r) => String(r[dim.field])));
    const nodes: AttributionNode[] = [];
    for (const v of values) {
      const cSub = cRows.filter((r) => String(r[dim.field]) === v);
      const pSub = pRows.filter((r) => String(r[dim.field]) === v);
      const c = aggregate(cSub, metric);
      const p = aggregate(pSub, metric);
      nodes.push({
        level,
        dimension: dimKey,
        value: v,
        contribution: delta === 0 ? 0 : (c - p) / delta,
        currentValue: c,
        previousValue: p,
        changeRate: p === 0 ? 0 : (c - p) / p,
      });
    }
    // 过滤掉样本过少的成员，避免单点波动主导结论
    const filtered = nodes.filter((n) =>
      prevRows.filter((r) => String(r[dim.field]) === n.value).length >= 20,
    );
    const pool = filtered.length ? filtered : nodes;
    pool.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const top = pool.slice(0, 4);
    levelResults.push({ dimKey, nodes: top });

    const lead = top[0];
    if (!lead) break;
    cRows = cRows.filter((r) => String(r[dim.field]) === lead.value);
    pRows = pRows.filter((r) => String(r[dim.field]) === lead.value);
  }

  // 组装树
  const rootNodes: AttributionNode[] = [];
  let cursor = rootNodes;
  for (let i = 0; i < levelResults.length; i++) {
    const built = levelResults[i].nodes.map((n) => ({
      ...n,
      level: i,
      children: [] as AttributionNode[],
    }));
    if (i === 0) {
      rootNodes.push(...built);
      cursor = built[0]?.children ?? [];
    } else {
      cursor.push(...built);
      cursor = built[0]?.children ?? [];
    }
  }

  const chain = buildChain(levelResults, metric.name, currStart, anchorEnd, prevStart, prevEnd);
  const conclusion = buildConclusion(
    levelResults, metric.name, currValue, prevValue, changeRate, isAnomaly, metric.unit,
  );

  return {
    metricName: metric.name,
    currentValue: currValue,
    previousValue: prevValue,
    changeRate,
    isAnomaly,
    nodes: rootNodes,
    conclusion,
    chain,
  };
}

function maxDate(rows: FactRow[]): string {
  let m = '0000-00-00';
  for (const r of rows) if (r.dt > m) m = r.dt;
  return m;
}
function min(a: string, b: string): string {
  return a < b ? a : b;
}

function fmtNum(v: number, unit?: string): string {
  if (unit === 'ratio') return `${(v * 100).toFixed(2)}%`;
  if (unit === 'currency') return v >= 10000 ? `¥${(v / 10000).toFixed(2)}万` : `¥${Math.round(v)}`;
  if (v >= 100000000) return `${(v / 100000000).toFixed(2)}亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(2)}万`;
  return String(Math.round(v));
}

/**
 * 展示用贡献度：数学上贡献度可能超出 ±100%（当总变化量接近 0 时各成员相互抵消）。
 * 展示层做一次收敛并标注，避免出现 -666% 这类令人困惑的数字。
 */
function fmtContribution(c: number): string {
  const pct = c * 100;
  if (Math.abs(pct) <= 100) return `${pct.toFixed(1)}%`;
  const sign = pct > 0 ? '+' : '−';
  return `${sign}${Math.min(Math.abs(pct), 999).toFixed(0)}%（方向性主导）`;
}

/** 生成思维链（可解释性） */
function buildChain(
  levels: { dimKey: string; nodes: AttributionNode[] }[],
  metricName: string,
  cs: string, ce: string, ps: string, pe: string,
): string[] {
  const chain: string[] = [];
  chain.push(
    `① 设定等长对比窗口：当前期 ${cs} ~ ${ce}，对比期 ${ps} ~ ${pe}（各 7 天，规避长期增长趋势带来的误判）`,
  );
  chain.push(`② 对「${metricName}」计算环比变化率，与异常阈值比对，判定是否触发告警`);
  levels.forEach((lv, i) => {
    const lead = lv.nodes[0];
    if (!lead) return;
    chain.push(
      `③ 第 ${i + 1} 层按「${dimensionLabel(lv.dimKey)}」做 MECE 拆解：定位到「${lead.value}」贡献了主要变化（贡献度 ${fmtContribution(lead.contribution)}）`,
    );
  });
  chain.push(`④ 沿贡献度最高的分支逐层下钻，锁定根因路径，排除样本不足的噪音维度`);
  chain.push(`⑤ 结合业务动作（投放、活动、版本发布）交叉验证，输出可执行的归因结论`);
  return chain;
}

/** 生成结构化结论 */
function buildConclusion(
  levels: { dimKey: string; nodes: AttributionNode[] }[],
  metricName: string,
  curr: number,
  prev: number,
  changeRate: number,
  isAnomaly: boolean,
  unit?: string,
): string {
  const dir = changeRate >= 0 ? '上升' : '下降';
  const head = isAnomaly
    ? `检测到异常：「${metricName}」本周（${fmtNum(curr, unit)}）相比上周（${fmtNum(prev, unit)}）${dir} ${Math.abs(changeRate * 100).toFixed(1)}%，已超出正常波动阈值。`
    : `「${metricName}」本周（${fmtNum(curr, unit)}）相比上周（${fmtNum(prev, unit)}）${dir} ${Math.abs(changeRate * 100).toFixed(1)}%，处于正常波动区间。`;

  const parts = levels
    .map((lv, i) => {
      const lead = lv.nodes[0];
      if (!lead) return '';
      return `第 ${i + 1} 层「${dimensionLabel(lv.dimKey)}」维度上，「${lead.value}」贡献了 ${fmtContribution(lead.contribution)}（该成员自身环比 ${(lead.changeRate * 100).toFixed(1)}%）`;
    })
    .filter(Boolean);

  if (parts.length === 0) return head;
  const path = levels.map((lv) => lv.nodes[0]?.value).filter(Boolean).join(' → ');
  const advice = buildAdvice(levels, changeRate, isAnomaly);
  return `${head}\n\n归因路径：${path}\n${parts.join('；')}。\n\n${advice}`;
}

/** 基于根因路径给出业务建议 */
function buildAdvice(
  levels: { dimKey: string; nodes: AttributionNode[] }[],
  changeRate: number,
  isAnomaly: boolean,
): string {
  const lead = levels[0]?.nodes[0];
  if (!lead) return '暂未定位到显著的单一维度根因，建议放宽时间窗口或补充维度后复看。';

  const dimName = dimensionLabel(lead.dimension);
  const second = levels[1]?.nodes[0];
  const secondText = second ? `，并进一步收窄到「${second.value}」` : '';

  if (!isAnomaly) {
    return `结论：「${lead.value}」是当前${dimName}维度上的最大波动来源，但整体仍在正常波动区间，暂不需要干预。建议持续观察该维度。`;
  }

  if (changeRate < 0) {
    return [
      `根因定位：${dimName}维度中的「${lead.value}」${secondText} 是本轮下滑的主要来源。`,
      `建议动作：① 优先排查「${lead.value}」在对比期内的业务动作（投放预算、渠道策略、版本发布、活动结束）；② 对该路径做同比交叉验证，区分结构性下滑与短期波动；③ 若为持续性下滑，需下钻至用户行为明细定位具体流失环节。`,
    ].join('\n');
  }
  return [
    `根因定位：${dimName}维度中的「${lead.value}」${secondText} 是本轮增长的主要来源。`,
    `建议动作：① 复盘「${lead.value}」上行的驱动因素（投放加码、内容爆发、渠道合作）；② 评估该增长的可持续性与边际成本；③ 若 ROI 健康，考虑将资源向该路径倾斜复制。`,
  ].join('\n');
}
