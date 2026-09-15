/**
 * 验证套件统一入口
 *
 * 用法：
 *   node scripts/verify/run.mjs            # 跑全部
 *   node scripts/verify/run.mjs security   # 只跑 security
 *
 * 原理：用项目自带的 rolldown 把 TS 脚本打成 ESM，再交给 node 执行，
 * 无需额外安装 tsx / esbuild / vitest。
 */
import { build } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '.out');

/** 套件清单：name → 一句话说明 */
const SUITES = {
  security: '安全机制双向用例（该拦的拦住 / 不该拦的放行）',
  regress: '问法路由回归（意图识别分发是否正确）',
  consistency: '数据一致性（评测指标、统计文案、单调性）',
  render: '组件渲染（MecePanel 关键文案是否落地 DOM）',
  suggest: '追问建议引擎（元数据引用、上下文感知、排序去重）',
  demo: '演示动线走查（README 列出的每个示例问题能否跑通）',
  deploy: '部署前置检查（netlify 配置、vite base、产物引用、仓库卫生）',
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = wanted.length ? wanted : Object.keys(SUITES);

const unknown = targets.filter((t) => !SUITES[t]);
if (unknown.length) {
  console.error(`未知套件：${unknown.join(', ')}`);
  console.error(`可用：${Object.keys(SUITES).join(', ')}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

let failed = 0;
const summary = [];

for (const name of targets) {
  const entry = path.join(here, `${name}.ts`);
  if (!fs.existsSync(entry)) {
    console.error(`× 缺少脚本：${entry}`);
    failed++;
    continue;
  }

  const outfile = path.join(outDir, `${name}.mjs`);

  // 1) 打包
  try {
    await build({
      input: entry,
      output: { file: outfile, format: 'esm' },
      platform: 'node',
    });
  } catch (e) {
    console.error(`× ${name} 打包失败：${e.message}`);
    failed++;
    summary.push([name, '打包失败']);
    continue;
  }

  // 2) 执行
  console.log(`\n${'='.repeat(64)}`);
  console.log(`▶ ${name}  —— ${SUITES[name]}`);
  console.log('='.repeat(64));
  const r = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });

  const ok = r.status === 0;
  if (!ok) failed++;
  summary.push([name, ok ? '通过' : `失败 (exit ${r.status})`]);
}

// 汇总
console.log(`\n${'='.repeat(64)}`);
console.log('汇总');
console.log('='.repeat(64));
for (const [name, status] of summary) {
  const good = status === '通过';
  console.log(`${good ? '✓' : '×'} ${name.padEnd(13)} ${status}`);
}
console.log('');
console.log(failed === 0 ? '全部套件通过 ✓' : `${failed} 个套件未通过 <<<`);
process.exit(failed === 0 ? 0 : 1);
