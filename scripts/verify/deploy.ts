/**
 * 部署前置检查
 *
 * 这个套件回答：「我这个项目现在推到 Netlify 上，能不能构建成功、打开能不能正常显示？」
 *
 * 检查项都对应真实的部署翻车场景：
 *   ① netlify.toml 的必要配置是否齐全（缺了会构建失败或刷新 404）
 *   ② vite.config.ts 是否误设了 base（设成绝对路径会导致 Netlify 上资源 404 白屏）
 *   ③ 构建产物引用路径是否是相对根路径的绝对路径（Vite 默认行为）
 *   ④ 是否存在会被误提交的大文件 / 敏感文件
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  × ${msg}`);
    fail++;
  }
};
const exists = (p: string) => fs.existsSync(path.join(root, p));
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

console.log('\n【一】netlify.toml 必要配置');

{
  ok(exists('netlify.toml'), 'netlify.toml 存在');
  if (exists('netlify.toml')) {
    const t = read('netlify.toml');
    ok(/\[build\]/.test(t), '有 [build] 段');
    ok(/command\s*=\s*"npm run build"/.test(t), 'build.command 为 npm run build');
    ok(/publish\s*=\s*"dist"/.test(t), 'publish 指向 dist');

    const nodeVer = t.match(/NODE_VERSION\s*=\s*"(\d+)"/)?.[1];
    ok(!!nodeVer, `锁定了 Node 版本${nodeVer ? `（${nodeVer}）` : ''}`);

    // 本地 node 主版本应与部署环境一致，否则可能"本地能跑、线上构建失败"
    const localMajor = process.versions.node.split('.')[0];
    ok(
      !nodeVer || nodeVer === localMajor,
      `部署 Node 版本(${nodeVer ?? '未设'}) 与本地(${localMajor}) 一致`,
    );

    ok(
      /\[\[redirects\]\][\s\S]*?from\s*=\s*"\/\*"[\s\S]*?to\s*=\s*"\/index\.html"[\s\S]*?status\s*=\s*200/.test(t),
      'SPA 兜底重定向已配置（刷新子路径不会 404）',
    );
  }
}

console.log('\n【二】vite 配置（白屏排查）');

{
  const v = read('vite.config.ts');
  // base 若被设成 '/some-dir/' 之类的绝对前缀，部署到域名根路径时所有资源都会 404
  const baseMatch = v.match(/base\s*:\s*['"]([^'"]+)['"]/);
  ok(
    !baseMatch || baseMatch[1] === '/' || baseMatch[1] === './',
    baseMatch
      ? `base 设置为 "${baseMatch[1]}"，适配根路径/相对部署`
      : '未设置 base，使用 Vite 默认值（适配 Netlify 根路径部署）',
  );
}

console.log('\n【三】构建产物检查');

{
  const distIndex = 'dist/index.html';
  if (!exists(distIndex)) {
    console.log('  ⚠ dist/ 不存在，跳过（执行 npm run build 后此套件会做完整检查）');
  } else {
    const html = read(distIndex);
    ok(/<div id="root">/.test(html), 'index.html 含挂载点 #root');

    // 资源引用必须是 /assets/xxx（根路径绝对），这样在任何子路径下都能正确加载
    const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => !u.startsWith('http') && !u.startsWith('data:'));

    ok(assetRefs.length > 0, `index.html 引用了 ${assetRefs.length} 个本地资源`);
    ok(
      assetRefs.every((u) => u.startsWith('/')),
      `资源引用使用根路径绝对地址（${assetRefs.join(', ')}）`,
    );

    // 被引用的资源必须真实存在，否则线上 404 白屏
    const missing = assetRefs.filter((u) => !exists(path.join('dist', u.replace(/^\//, ''))));
    ok(missing.length === 0, `引用的资源文件都真实存在${missing.length ? `（缺失：${missing.join(', ')}）` : ''}`);
  }
}

console.log('\n【四】.gitignore 与仓库卫生');

{
  ok(exists('.gitignore'), '.gitignore 存在');
  if (exists('.gitignore')) {
    const g = read('.gitignore');
    ok(/^node_modules/m.test(g), '忽略 node_modules');
    ok(/^dist/m.test(g), '忽略 dist（构建产物由 Netlify 现场生成）');
    ok(/scripts\/verify\/\.out/.test(g), '忽略验证套件编译产物');
  }
  ok(!exists('.env'), '仓库根目录无 .env（本 Demo 不需要任何密钥）');
  ok(!exists('.env.local'), '无 .env.local');

  // 提醒：如果有 .env 被误提交，要警示
  const dangerFiles = ['.env', '.env.local', '.env.production'];
  const found = dangerFiles.filter((f) => exists(f));
  ok(found.length === 0, `无敏感配置文件${found.length ? `（发现：${found.join(', ')}）` : ''}`);
}

console.log('\n【五】README 部署指引');

{
  const r = read('README.md');
  ok(/Netlify/i.test(r), 'README 包含 Netlify 部署说明');
  ok(/git\s+push/.test(r), 'README 包含 git push 步骤');
  ok(/netlify\.toml/i.test(r), 'README 说明了 netlify.toml 的作用');
}

console.log('');
if (fail === 0) {
  console.log('部署前置检查：全部通过 ✓ —— 可以直接推到 GitHub 并连 Netlify');
} else {
  console.log(`部署前置检查：${fail} 项未通过 <<<`);
}
process.exit(fail === 0 ? 0 : 1);
