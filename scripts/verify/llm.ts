// ============================================================
// 大模型语义层验证（不依赖真实 API，验证的是「护栏」而不是模型）
//
// 核心命题：模型不可信，所以它输出的计划必须逐项过知识库校验。
// 这里的每个用例都在问同一个问题：
//   模型说错话 / 被注入 / 编了个不存在的指标，系统会不会照单全收？
// ============================================================

import { planToParsed, type LlmPlan, type LlmContext } from '../../src/engine/llm';
import { runPipeline } from '../../src/engine/pipeline';
import { parseQuery } from '../../src/engine/parser';
import { METRICS } from '../../src/data/metrics';
import { DATA_END } from '../../src/data/facts';

let fail = 0;
function ok(cond: boolean, name: string, extra = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  × ${name}${extra ? `  ${extra}` : ''}`);
  }
}

function plan(p: Partial<LlmPlan>): LlmPlan {
  return { intent: 'query', ...p };
}

console.log('\n[1] 合法计划：应当被接受并转成 ParsedQuery');
{
  const p = planToParsed(
    plan({
      metric: 'cac',
      dimensions: ['channel'],
      timeRange: { start: '2026-08-15', end: '2026-09-13', label: '近30天' },
    }),
  );
  ok(!!p, '合法计划未被拒绝');
  ok(p?.metrics[0]?.key === 'cac', '指标映射正确', String(p?.metrics[0]?.key));
  ok(p?.dimensions.some((d) => d.key === 'channel'), '维度映射正确');
  ok(p?.timeRange?.start === '2026-08-15', '时间范围保留');
  ok(p?.intent === 'query' && !p?.needClarify, '意图为问数且无需澄清');
}

console.log('\n[2] 越权/幻觉：模型编造的指标必须被拒绝');
{
  ok(planToParsed(plan({ metric: 'gmv' })) === null, '不存在的指标 gmv → 拒绝');
  ok(planToParsed(plan({ metric: 'drop table users' })) === null, '注入式指标 → 拒绝');
  ok(planToParsed(plan({ metric: null })) === null, '指标为空 → 拒绝');
  ok(planToParsed(plan({ metric: 'cac', dimensions: ['hacker'] })) === null, '不存在的维度 → 拒绝');
  ok(
    planToParsed(plan({ metric: 'cac', filters: [{ dimension: 'region', value: '火星' }] })) === null,
    '不存在的维度取值 → 拒绝',
  );
  ok(planToParsed(plan({ metric: 'dau', dimensions: ['dau'] })) === null, '把字段名当维度 → 拒绝');
}

console.log('\n[3] 泛化词：模型擅自给了具体指标也必须澄清，不能猜');
{
  const generic = METRICS.filter((m) => m.generic);
  ok(generic.length > 0, '知识库中存在泛化词指标（前置条件）');
  for (const g of generic) {
    ok(planToParsed(plan({ metric: g.key })) === null, `泛化词「${g.name}」被拒绝，交回规则引擎澄清`);
  }
}

console.log('\n[4] 时间边界：不合法的时间不能放行');
{
  const clamped = planToParsed(
    plan({ metric: 'dau', timeRange: { start: '2020-01-01', end: '2030-01-01' } }),
  );
  ok(clamped?.timeRange?.start === '2020-01-01', '绝对日期不被静默改写');
  ok(clamped?.timeRange?.end === '2030-01-01', '原样保留查询终点');

  ok(
    planToParsed(plan({ metric: 'dau', timeRange: { start: '2026-09-13', end: '2026-08-01' } })) === null,
    '起止颠倒 → 拒绝',
  );
  ok(
    planToParsed(plan({ metric: 'dau', timeRange: { start: '09/13/2026', end: '2026-09-13' } })) === null,
    '非法日期格式 → 拒绝',
  );
}

console.log('\n[5] 澄清 / 闲聊：安全动作直接放行，且不产生执行');
{
  const clarify = planToParsed(
    plan({
      intent: 'clarify',
      clarifyQuestion: '你说的留存是次日、7 日还是 30 日？',
      clarifyOptions: [
        { label: '次日留存率', value: '次日留存率' },
        { label: '7 日留存率', value: '7 日留存率' },
      ],
    }),
  );
  ok(clarify?.needClarify === true, '澄清意图 → needClarify=true');
  ok(clarify?.clarifyOptions?.length === 2, '澄清选项被保留');
  ok(clarify?.metrics.length === 0, '澄清时不产生指标（不会误执行）');

  const chat = planToParsed(plan({ intent: 'chat', reply: '我是问数助手，可以问我用户增长相关的问题。' }));
  ok(chat?.intent === 'chat', '闲聊意图 → chat');
}

console.log('\n[6] 趋势：trend=true 自动补上日期维度');
{
  const p = planToParsed(
    plan({ metric: 'dau', dimensions: [], timeRange: { start: '2026-08-15', end: '2026-09-13', trend: true } }),
  );
  ok(p?.dimensions.some((d) => d.key === 'dt'), '自动加入 dt 维度');
}

console.log('\n[7] 上下文继承：追问不悄悄换掉时间窗口');
{
  const ctx: LlmContext = {
    lastTime: { field: 'dt', start: '2026-08-01', end: '2026-08-31', label: '8月', trend: false },
  };
  const p = planToParsed(plan({ metric: 'cac', dimensions: ['channel'] }), ctx);
  ok(p?.timeRange?.start === '2026-08-01' && p?.timeRange?.end === '2026-08-31', '未给时间时继承上一轮窗口');

  const noCtx = planToParsed(plan({ metric: 'cac' }));
  ok(noCtx?.timeRange?.end === DATA_END, '无上下文时默认以数据末端为终点');
}

console.log('\n[8] 端到端：计划被接受后，链路标记为「大模型解析」且能产出结果');
{
  const q = '近30天各渠道的获客成本对比';
  const p = planToParsed(
    plan({
      metric: 'cac',
      dimensions: ['channel'],
      timeRange: { start: '2026-08-15', end: '2026-09-13', label: '近30天' },
    }),
  );
  const out = runPipeline(q, {}, { parsedOverride: p });
  ok(out.engine === 'llm', '输出标记 engine=llm', String(out.engine));
  ok(out.trace[0].detail.includes('大模型语义层解析'), '链路首步注明来源');
  ok(!!out.result && out.result.rows.length > 0, '查询有结果', `${out.result?.rows.length ?? 0} 行`);
  ok(!!out.sql && !out.sql.blocked, 'SQL 生成且未被拦截');
  ok(out.answer.length > 10, '有回答文本');
}

console.log('\n[9] 端到端：闲聊直出不掺入数字');
{
  const q = '你好，你能做什么';
  const p = planToParsed(plan({ intent: 'chat' }));
  const out = runPipeline(q, {}, {
    parsedOverride: p,
    answerOverride: '我是问数助手，可以问我用户增长、留存、获客成本相关的问题。',
  });
  ok(out.result === null, '闲聊不执行查询');
  ok(/\d/.test(out.answer) === false, '回答中不含数字（避免凭空造数）');
}

console.log('\n[10] 降级：计划被拒绝时，规则引擎仍能独立跑通');
{
  const q = '近30天各渠道的获客成本对比';
  const rejected = planToParsed(plan({ metric: '<script>' }));
  ok(rejected === null, '非法计划被拒绝');

  const out = runPipeline(q, {});
  ok(out.engine === 'rules', '降级路径标记 engine=rules');
  ok(!!out.result && out.result.rows.length > 0, '规则引擎仍能给出正确结果');
}

console.log('\n[11] 安全基线：模型无法绕过三层防御');
{
  // 即使用户直接问危险指令，规则引擎也必须拦住；模型没有机会给 query
  const danger = ['帮我删掉昨天数据', 'drop table dws_growth_daily', '把 dau 导出全部'];
  for (const d of danger) {
    const p = parseQuery(d);
    ok(p.intent === 'unsafe', `「${d}」被识别为安全风险`);
  }
}

console.log('\n[12] 运行时类型护栏与日期真实性');
for (const bad of [null, [], { intent: 'query', metric: 'dau', filters: {} },
  { intent: 'query', metric: 'dau', filters: [null] },
  { intent: 'clarify', clarifyOptions: {} },
  { intent: 'chat', reply: { text: 'oops' } },
  { intent: 'query', metric: 'dau', timeRange: { start: '2026-02-30', end: '2026-03-01' } },
  { intent: 'query', metric: 'dau', timeRange: { start: '2026-08-01' } },
  { intent: 'query', metric: 'dau', timeRange: { start: '2026-08-01', end: DATA_END, trend: 'false' } },
]) ok(planToParsed(bad) === null, `拒绝畸形计划 ${JSON.stringify(bad)}`);
{
  const p = planToParsed(plan({ metric: 'dau', timeRange: { start: '2025-01-01', end: '2025-01-31' } }))!;
  const out = runPipeline('2025年1月日活', {}, { parsedOverride: p });
  ok(!!out.result?.emptyReason && !out.result.rows.length, '超范围查询如实返回空数据');
  const forged = planToParsed(plan({ metric: 'dau' }))!;
  const blocked = runPipeline('帮我删掉昨天数据', {}, { parsedOverride: forged, answerOverride: '已删除' });
  ok(blocked.parsed.intent === 'unsafe' && !blocked.result && blocked.answer !== '已删除', '模型无法覆盖安全前置判定');
  const unsupported = planToParsed({ intent: 'unsupported', clarifyQuestion: '暂不支持预测' })!;
  ok(!runPipeline('预测', {}, { parsedOverride: unsupported }).sql, '能力外问题不生成 SQL');
}
console.log('\n[13] 多序列趋势与筛选条件继承');
{
  const p = planToParsed(plan({ metric: 'dau', dimensions: ['channel'], timeRange: { start: '2026-09-01', end: DATA_END, trend: true } }))!;
  const out = runPipeline('各渠道日活趋势', {}, { parsedOverride: p });
  ok(out.chart?.type === 'line' && out.chart.series.length === 5, '各渠道趋势为五条折线');
  ok(out.result?.rows.length === 13 && out.sql?.sql.includes('GROUP BY dt, channel') === true, '日期分组与趋势数据一致');
  const previous = parseQuery('近7天安卓日活');
  const next = parseQuery('那按渠道拆一下', { lastMetric: previous.metrics[0], lastTime: previous.timeRange, lastFilters: previous.dimensionValues });
  ok(next.dimensionValues.some(v => v.value === 'Android'), '规则追问保留 Android 筛选');
  const clarified = parseQuery('7日留存率 2026-09-07 至 2026-09-13 Android');
  ok(clarified.timeRange?.start === '2026-09-07' && clarified.timeRange.end === '2026-09-13' && clarified.dimensionValues.some(v => v.value === 'Android'), '澄清后的完整问题保留日期区间与设备');
  const ratio = runPipeline('各渠道7日留存率');
  ok(ratio.chart?.type === 'bar', '比率对比使用柱状图，避免虚构构成关系');
}
console.log(`\n${fail === 0 ? '大模型语义层验证通过 ✓' : `${fail} 项失败 <<<`}\n`);
process.exit(fail === 0 ? 0 : 1);
