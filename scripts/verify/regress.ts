// 回归验证：全量问法路由 + 链路完整性
import { runPipeline } from '../../src/engine/pipeline';
import { validateAliasUniqueness } from '../../src/data/metrics';

const cases: [string, string][] = [
  ['昨天的日活是多少', 'query'],
  ['近30天各渠道的获客成本对比', 'query'],
  ['安卓端DAU为什么掉了', 'query'],
  ['用户粘性怎么样', 'query'],
  ['各渠道的ROI', 'query'],
  ['留存怎么样', 'query+clarify'],
  ['企业版的7日留存为什么降了', 'query'],
  ['苹果端的日活趋势', 'query'],
  ['哪些渠道值得加投', 'MECE/渠道'],
  ['付费广告要不要继续投', 'MECE/渠道'],
  ['怎么提升留存', 'MECE/留存'],
  ['如何改善用户粘性', 'MECE/留存'],
  ['留存怎么提升', 'MECE/留存'],
  ['业务健康吗', 'MECE/健康'],
  ['大盘表现怎么样', 'MECE/健康'],
  ['该关注什么', 'MECE/健康'],
  ['DROP TABLE users', 'unsafe'],
  ['你好', 'chat'],
];

console.log('别名冲突数:', validateAliasUniqueness().length);
console.log('');
console.log('期望'.padEnd(14), '问题'.padEnd(24), 'intent', 'MECE');
console.log('-'.repeat(70));

let fail = 0;
for (const [q, expect] of cases) {
  const out = runPipeline(q, {});
  const meceName = out.mece ? out.mece.intentTitle : '—';
  const got = out.mece ? `MECE/${meceName.slice(0, 2)}` : out.parsed.intent;

  let ok = true;
  if (expect.startsWith('MECE')) {
    const want = expect.split('/')[1];
    ok = !!out.mece && meceName.includes(want === '渠道' ? '渠道' : want === '留存' ? '留存' : '健康');
  } else if (expect.startsWith('query+clarify')) {
    ok = out.parsed.intent === 'query' && out.parsed.needClarify === true;
  } else {
    ok = out.parsed.intent === expect && !out.mece;
  }
  if (!ok) fail++;

  console.log(
    expect.padEnd(14),
    q.padEnd(24),
    out.parsed.intent.padEnd(10),
    meceName,
    ok ? '' : '  <<< 不符',
  );

  // 链路完整性：MECE 时 SQL/执行应为 skip
  if (out.mece) {
    const bad = out.trace.filter((t) => (t.id === 'sql' || t.id === 'execute') && t.status !== 'skip');
    if (bad.length) { console.log('   !! MECE 路径 SQL/执行未跳过'); fail++; }
    // 每个子问题必须有 finding
    const noFinding = out.mece.subQuestions.filter((s) => s.status === 'ok' && !s.finding);
    if (noFinding.length) { console.log('   !! 有子问题缺少 finding'); fail++; }
    // 每个 ok 子问题必须有图表或行数据
    const noData = out.mece.subQuestions.filter((s) => s.status === 'ok' && s.rows.length === 0);
    if (noData.length) { console.log('   !! 有 ok 子问题无数据'); fail++; }
  }
}

console.log('');
console.log(fail === 0 ? '全部通过 ✓' : `${fail} 项不符 <<<`);
process.exit(fail === 0 ? 0 : 1);
