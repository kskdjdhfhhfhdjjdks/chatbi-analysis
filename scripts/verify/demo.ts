// 演示动线走查：逐条跑 README 列出的示例问题，确认都能产出预期效果
import { runPipeline } from '../../src/engine/pipeline';

type Ctx = Record<string, unknown>;
const demo: { q: string; note: string; ctx?: Ctx }[] = [
  { q: '昨天的日活是多少', note: '① 基础问数 —— 展示全链路 Trace' },
  { q: '用户粘性怎么样', note: '② 业务黑话 —— 粘性 → DAU/MAU' },
  { q: '留存怎么样', note: '③ 意图澄清 —— 泛化词强制反问' },
  { q: '近30天各渠道的获客成本对比', note: '④ 比率聚合 —— 先求和再相除' },
  { q: '安卓端DAU为什么掉了', note: '⑤ 异常归因 —— 定位到付费广告停投' },
  { q: '企业版的7日留存为什么降了', note: '⑤b 归因下钻' },
  { q: 'DROP TABLE dws_growth_daily', note: '⑥ 安全拦截' },
  { q: '哪些渠道值得加投', note: '⑦ MECE 拆解（王牌）' },
  { q: '怎么提升留存', note: '⑦b MECE 留存诊断' },
  { q: '那按渠道拆一下', note: '⑧ 上下文继承（需带 ctx）', ctx: { lastMetric: undefined, lastTime: undefined, lastDimensions: [] } },
];

for (const d of demo) {
  const out = runPipeline(d.q, d.ctx ?? {});
  const parts: string[] = [];
  parts.push(`intent=${out.parsed.intent}`);
  if (out.parsed.needClarify) parts.push(`澄清(${out.parsed.clarifyOptions?.length ?? 0}选项)`);
  if (out.sql) parts.push(`SQL=${out.sql.blocked ? '已拦截' : '通过'}`);
  if (out.result) parts.push(`结果${out.result.rows.length}行`);
  if (out.chart) parts.push(`图表=${out.chart.type}`);
  if (out.attribution) parts.push(`归因=${out.attribution.isAnomaly ? '异常' : '正常'}`);
  if (out.mece) parts.push(`MECE=${out.mece.intentTitle}/${out.mece.subQuestions.length}子问题`);
  console.log(`\n${d.note}`);
  console.log(`  Q: ${d.q}`);
  console.log(`  → ${parts.join(' | ')}`);
  console.log(`  A: ${out.answer.slice(0, 110).replace(/\n/g, ' ')}…`);
  const totalMs = out.trace.reduce((a, t) => a + (t.ms ?? 0), 0);
  console.log(`  链路耗时合计 ${totalMs}ms`);
}
