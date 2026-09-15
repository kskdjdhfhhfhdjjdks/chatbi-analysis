// 渲染验证：用真实引擎输出 server-render MecePanel，确认无渲染异常且关键文案落地
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MecePanel } from '../../src/components/MecePanel';
import { decompose } from '../../src/engine/mece';

const questions = ['哪些渠道值得加投', '怎么提升留存', '业务健康吗'];

for (const q of questions) {
  const plan = decompose(q);
  if (!plan) { console.log(`× ${q} 未产出 MecePlan`); continue; }

  let html = '';
  try {
    html = renderToStaticMarkup(createElement(MecePanel, { mece: plan }));
  } catch (e: any) {
    console.log(`× ${q} 渲染抛错: ${e.message}`);
    continue;
  }

  // 断言关键内容都在 DOM 里
  const checks: [string, boolean][] = [
    ['策略类问题标签', html.includes('策略类问题')],
    ['模板标题', html.includes(plan.intentTitle)],
    ['拆解思路', html.includes('拆解思路') && html.includes('basis') === false],
    ['拆解思路正文', html.includes(plan.basis.slice(0, 20))],
    ['子问题区块', html.includes('子问题拆解与取数')],
    ['MECE 释义', html.includes('相互独立') && html.includes('完全穷尽')],
    ['综合结论', html.includes('综合结论')],
    ['综合结论正文', html.includes(plan.synthesis.slice(0, 20))],
    ['分层建议', html.includes('分层行动建议')],
    ['MECE 自查', html.includes('MECE 自查')],
    ['无 undefined', !html.includes('undefined')],
    ['无 NaN', !html.includes('NaN')],
  ];

  const bad = checks.filter(([, ok]) => !ok);
  console.log(
    `${bad.length ? '×' : '✓'} ${q}  → ${plan.intentTitle} | HTML ${html.length} 字符 | ${bad.length ? bad.map(b => b[0]).join('、') + ' 缺失' : '全部命中'}`,
  );

  // 每个子问题标题都应出现
  const missTitles = plan.subQuestions.filter((s) => !html.includes(s.title));
  if (missTitles.length) console.log(`    !! 子问题标题未渲染: ${missTitles.map(s => s.title).join('、')}`);
  // 每个成功子问题的 finding 都应出现
  const missFind = plan.subQuestions.filter((s) => s.status === 'ok' && !html.includes(s.finding.slice(0, 12)));
  if (missFind.length) console.log(`    !! 子问题发现未渲染: ${missFind.map(s => s.id).join('、')}`);
  // 建议条目都应出现
  for (const r of plan.recommendation) {
    if (!html.includes(r.level)) console.log(`    !! 建议层级未渲染: ${r.level}`);
    for (const it of r.items) {
      if (!html.includes(it.slice(0, 14))) console.log(`    !! 建议条目未渲染: ${it.slice(0, 20)}`);
    }
  }
}
