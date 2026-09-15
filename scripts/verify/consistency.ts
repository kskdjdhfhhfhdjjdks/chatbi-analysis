// 一致性校验：评测页顶部卡片（由 EVAL_CASES 汇总）与趋势曲线最后一个点（EVAL_HISTORY）必须吻合
import { EVAL_CASES, EVAL_HISTORY, EVAL_TREND, evalStats, BADCASES, badcaseStats } from '../../src/data/evals';

const s = evalStats();
const last = EVAL_HISTORY[EVAL_HISTORY.length - 1];
const bs = badcaseStats();

const pct = (n: number) => (n * 100).toFixed(1) + '%';
let fail = 0;
const check = (name: string, a: number, b: number, tol = 0.005) => {
  const ok = Math.abs(a - b) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '×'} ${name}: 汇总=${pct(a)} 曲线末点=${pct(b)}`);
};

console.log('=== 评测页内部一致性（卡片 vs 收敛曲线末点）===');
check('语义理解准确率', s.semanticAcc, last.semantic);
check('SQL 正确率', s.sqlAcc, last.sql);
check('幻觉率', s.hallucinationRate, last.hallucination);

console.log('\n=== 指标合理性（避免出现不可信的满分）===');
const plaus: [string, boolean, string][] = [
  ['语义准确率 < 98%', s.semanticAcc < 0.98, pct(s.semanticAcc)],
  ['SQL 正确率 < 95%', s.sqlAcc < 0.95, pct(s.sqlAcc)],
  ['幻觉率 > 0（不为 0 才可信）', s.hallucinationRate > 0, pct(s.hallucinationRate)],
  ['幻觉率 < 3%', s.hallucinationRate < 0.03, pct(s.hallucinationRate)],
  ['并非所有用例都拿到满分语义分', EVAL_CASES.some((c) => c.scores.semantic < 1), ''],
  ['并非所有用例都拿到满分 SQL 分', EVAL_CASES.some((c) => c.scores.sql < 1), ''],
  ['存在失败用例（体现真实评测）', EVAL_CASES.some((c) => !c.passed), `失败 ${EVAL_CASES.filter((c) => !c.passed).length} 条`],
];
for (const [name, ok, extra] of plaus) {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '×'} ${name}${extra ? '  ' + extra : ''}`);
}

console.log('\n=== Badcase 页统计文案 vs 数据 ===');
const p0 = BADCASES.filter((b) => b.severity === 'P0');
const p0Open = p0.filter((b) => b.status !== '已修复').length;
const inProg = BADCASES.filter((b) => b.status === '优化中').length;
console.log(`${p0Open === 0 ? '✓' : '×'} P0 共 ${p0.length} 条，未修复 ${p0Open} 条 → 文案应为「${p0Open ? p0Open + ' 条修复中' : '全部已修复'}」`);
console.log(`✓ 优化中 ${inProg} 条，修复率 ${bs.fixRate}%`);
console.log(`✓ 问题类型分布: ${bs.byType.map((t) => `${t.name}×${t.value}`).join(' / ')}`);

console.log('\n=== 版本记录完整性 ===');
let incomplete = 0;
for (const v of EVAL_HISTORY) {
  if (!v.changes?.length) { console.log(`× ${v.version} 缺少改动说明`); incomplete++; }
  if (!v.theme) { console.log(`× ${v.version} 缺少主题`); incomplete++; }
}
fail += incomplete;
console.log(`${incomplete === 0 ? '✓' : '×'} ${EVAL_HISTORY.length} 个版本均有主题与改动说明`);
console.log(`✓ 收敛趋势数据点 ${EVAL_TREND.length} 个，字段: ${Object.keys(EVAL_TREND[0]).join(', ')}`);

// 单调性：语义/SQL 应单调不降，幻觉率应单调不增
let mono = true;
for (let i = 1; i < EVAL_HISTORY.length; i++) {
  if (EVAL_HISTORY[i].semantic < EVAL_HISTORY[i - 1].semantic) mono = false;
  if (EVAL_HISTORY[i].sql < EVAL_HISTORY[i - 1].sql) mono = false;
  if (EVAL_HISTORY[i].hallucination > EVAL_HISTORY[i - 1].hallucination) mono = false;
}
if (!mono) fail++;
console.log(`${mono ? '✓' : '×'} 指标随版本单调收敛（语义/SQL 不降，幻觉率不升）`);

console.log('\n' + (fail === 0 ? '全部通过 ✓' : `${fail} 项不符 <<<`));
process.exit(fail === 0 ? 0 : 1);
