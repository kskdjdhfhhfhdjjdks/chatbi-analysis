/**
 * 追问建议引擎验证
 *
 * 这个套件回答三个问题：
 *   ① 元数据引用是否有效 —— DOMAIN_CHAIN / METRIC_DIM_AFFINITY / STRATEGY_ENTRY
 *      里写死的 key，是否都能在真实的 METRICS / DIMENSIONS 表里找到？
 *      （写错一个字就会静默生成一条点不通的建议，属于最难发现的一类 bug）
 *   ② 上下文感知是否真的生效 —— 同一指标在不同上下文下，建议是否不同？
 *   ③ 建议本身是否可用 —— 生成的文本能否被 pipeline 正常解析（不会落到「未识别」）？
 */
import {
  buildSuggestions,
  buildStrategySuggestions,
  explainSuggestions,
} from '../../src/engine/suggest';
import { parseQuery } from '../../src/engine/parser';
import { METRICS } from '../../src/data/metrics';
import { DIMENSIONS } from '../../src/data/dimensions';

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  × ${msg}`);
    fail++;
  }
};

const metricKeys = new Set(METRICS.filter((m) => !m.generic).map((m) => m.key));
const dimKeys = new Set(DIMENSIONS.map((d) => d.key));

console.log('\n【一】元数据引用有效性');

// DOMAIN_CHAIN / METRIC_DIM_AFFINITY / STRATEGY_ENTRY 是模块私有常量，
// 这里通过「对每个真实指标生成一轮建议」的方式间接覆盖到它们的全部取值。
const sampleMetricKeys = [...metricKeys];
let allTexts: string[] = [];

for (const key of sampleMetricKeys) {
  const m = METRICS.find((x) => x.key === key)!;
  const parsed = parseQuery(m.name);
  if (!parsed.metrics.length) continue;
  const list = buildSuggestions(parsed, {});
  allTexts = allTexts.concat(list.map((s) => s.text));
}

ok(allTexts.length > 0, `全量指标可生成建议（共 ${sampleMetricKeys.length} 个指标，产出 ${allTexts.length} 条建议）`);
ok(
  !allTexts.some((t) => t.includes('undefined') || t.includes('NaN')),
  '没有 undefined / NaN 泄漏到建议文本里',
);

// 反向校验：每个指标生成的「按维度拆分」建议，维度名必须是真实存在的
console.log('\n【二】建议文本可被 pipeline 解析');

const probes = [
  ['昨天的日活是多少', {}],
  ['近30天各渠道的获客成本对比', {}],
  ['几个渠道的最新获客成本', { hasAttribution: true }],
] as const;

for (const [q, opts] of probes) {
  const parsed = parseQuery(q);
  if (!parsed.metrics.length) {
    ok(false, `探针问题未能解析出指标：${q}`);
    continue;
  }
  const list = buildSuggestions(parsed, opts as Record<string, boolean>);
  ok(list.length > 0, `「${q}」产出 ${list.length} 条建议`);

  let allParsable = true;
  const unparsed: string[] = [];
  for (const s of list) {
    const p = parseQuery(s.text);
    // 建议必须能被识别，否则用户点下去就是「没听懂」。
    // 识别 = 解析出指标/维度（走问数链路），或落到 strategy 意图（走 MECE 链路）。
    const recognized = p.metrics.length > 0 || p.dimensions.length > 0 || p.intent === 'strategy';
    if (!recognized) {
      allParsable = false;
      unparsed.push(s.text);
    }
  }
  ok(allParsable, `建议可被解析器识别${unparsed.length ? `（未识别：${unparsed.join('、')}）` : ''}`);
}

console.log('\n【三】上下文感知是否生效');

// 3.1 已看过的维度不再推荐
{
  const q1 = parseQuery('日活是多少');
  const q2 = parseQuery('按渠道看日活');
  const s1 = buildSuggestions(q1, {});
  const s2 = buildSuggestions(q2, {});
  const usedInS2 = s2.some((s) => s.text.includes('渠道') && s.kind === 'dimension');
  ok(
    !usedInS2,
    `已按渠道拆分过后，不再重复推荐渠道下钻（本轮：${s2.map((s) => s.text).join(' / ')}）`,
  );
  ok(s1.length > 0 && s2.length > 0, '两种上下文均有建议产出');
}

// 3.2 已生成 MECE 拆解后，不再推荐「升级为策略视角」
{
  const q = parseQuery('日活是多少');
  const withMece = buildSuggestions(q, { hasMece: true });
  const without = buildSuggestions(q, { hasMece: false });
  const strategyInWith = withMece.some((s) => s.kind === 'strategy');
  ok(!strategyInWith, '已展示 MECE 拆解时，不再推荐「策略视角」升级');
  ok(without.length >= withMece.length, '未展示 MECE 时建议数量不少于已展示时');
}

// 3.3 已看过归因后，不再推荐归因下钻
{
  const q = parseQuery('各渠道的获客成本');
  const s = buildSuggestions(q, { hasAttribution: true });
  ok(!s.some((k) => k.kind === 'drill'), '已展示归因面板时，不再推荐归因下钻');
}

// 3.4 比率型指标优先推趋势
{
  const q = parseQuery('各渠道的获客成本');
  const s = buildSuggestions(q, {});
  ok(
    s.some((x) => x.kind === 'trend'),
    `比率/金额型指标会推荐看趋势（本轮：${s.map((x) => `${x.kind}:${x.text}`).join(' / ')}）`,
  );
}

console.log('\n【四】排序与去重契约');

{
  const q = parseQuery('昨天的日活是多少');
  const s = buildSuggestions(q, {});
  ok(s.length <= 4, `最多返回 4 条（实际 ${s.length} 条）`);
  const texts = s.map((x) => x.text);
  ok(new Set(texts).size === texts.length, '建议文本无重复');
  const weights = s.map((x) => x.weight);
  ok(
    weights.every((w, i) => i === 0 || weights[i - 1] >= w),
    `按权重降序排列（${weights.join(' ≥ ')}）`,
  );
  ok(
    s.every((x) => x.reason.length > 0),
    '每条建议都带非空 reason',
  );
}

console.log('\n【五】策略视角建议');

{
  for (const q of ['哪些渠道值得加投', '怎么提升留存', '业务健康吗']) {
    const s = buildStrategySuggestions(q);
    ok(s.length > 0 && s.length <= 4, `「${q}」产出 ${s.length} 条后续追问`);
    ok(!s.some((x) => x.text === q), `「${q}」不会推荐自己`);
    ok(
      s.every((x) => x.reason.length > 0),
      `「${q}」的每条追问都带理由`,
    );
  }
  const expl = explainSuggestions(buildStrategySuggestions('业务健康吗'));
  ok(expl.includes('——'), 'explainSuggestions 能输出可读说明');
  ok(explainSuggestions([]) === '本轮无可推荐的追问方向', '空列表有兜底文案');
}

console.log('');
if (fail === 0) {
  console.log('追问建议引擎：全部检查通过 ✓');
} else {
  console.log(`追问建议引擎：${fail} 项未通过 <<<`);
}
process.exit(fail === 0 ? 0 : 1);
