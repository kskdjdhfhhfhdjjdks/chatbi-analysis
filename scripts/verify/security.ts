// 安全层回归：必须「该拦的全拦，不该拦的别拦」
import { runPipeline } from '../../src/engine/pipeline';
import { checkSecurity, ALLOWED_FIELDS } from '../../src/engine/sql';

let fail = 0;
const mustBlock: [string, string][] = [
  ['DROP TABLE dws_growth_daily', 'DDL'],
  ['TRUNCATE TABLE dws_growth_daily', 'DDL'],
  ['ALTER TABLE dws_growth_daily ADD COLUMN x int', 'DDL'],
  ['DELETE FROM dws_growth_daily', 'DML'],
  ['UPDATE dws_growth_daily SET dau = 0', 'DML'],
  ['INSERT INTO dws_growth_daily VALUES (1)', 'DML'],
  ["1' OR '1'='1 UNION SELECT password FROM users", '注入'],
  ['SELECT * FROM information_schema.tables', '探测'],
  ['SELECT SLEEP(5)', '盲注'],
  ['查询所有用户的手机号', '敏感字段'],
  ['帮我删掉昨天数据', '自然语言越权'],
  ['帮我改成 100 万', '自然语言越权'],
  ["SELECT * FROM t; DROP TABLE t", '多语句'],
  ["SELECT * FROM t -- comment", '注释'],
  ['SELECT * FROM t /* x */ WHERE 1=1', '块注释'],
  ['GRANT ALL ON t TO u', '权限'],
  ['REVOKE SELECT ON t FROM u', '权限'],
  ['SHOW TABLES', '探测'],
  ['DESC dws_growth_daily', '探测'],
  ['USE mysql', '探测'],
];

console.log('=== 必须被拦截 ===');
for (const [q, tag] of mustBlock) {
  const out = runPipeline(q, {});
  const blocked = out.parsed.intent === 'unsafe' || !!out.sql?.blocked;
  if (!blocked) fail++;
  console.log(`${blocked ? '✓' : '× 漏放'} [${tag}] ${q}`);
}

// 合法查询绝不能误拦 —— 覆盖各种排序 / 字段组合
console.log('\n=== 绝不能误拦（合法业务查询）===');
const mustPass: string[] = [
  '各渠道的ROI',
  '近30天各渠道的获客成本对比',
  '昨天的日活是多少',
  '用户粘性怎么样',
  '近7天新增注册用户',
  '本月总营收',
  '7日留存率是多少',
  '上个月的MRR',
  '近14天获客成本',
  '平均使用时长',
  '客单价近30天走势',
  '拉新成本是多少',
  '最近掉线用户多不多',
  '投入产出比按渠道看',
  '月活里的日活占比',
  '大R用户的ARPU',
  '沉睡用户有多少',
  '苹果端的日活',
  '江浙沪的营收',
  '安卓的DAU趋势',
  '微信小程序的新增',
  '各渠道的转化率',
  '各地区的留存率对比',
  '按设备看崩溃率',
  '各套餐的退款率',
  'LTV/CAC比值趋势',
  '企业版的7日留存为什么降了',
  '安卓端DAU为什么掉了',
  '哪些渠道值得加投',
  '怎么提升留存',
  '业务健康吗',
];
for (const q of mustPass) {
  const out = runPipeline(q, {});
  const wronglyBlocked = out.parsed.intent === 'unsafe' || (out.sql?.blocked && out.parsed.intent !== 'strategy');
  // 策略类问题不走 SQL，跳过
  const isStrategy = out.parsed.intent === 'strategy';
  if (wronglyBlocked && !isStrategy) {
    fail++;
    console.log(`× 误拦 ${q}  → ${out.sql?.securityHits?.join('; ') ?? out.sql?.blockReason}`);
  } else {
    console.log(`✓ ${q}${isStrategy ? ' (MECE，不生成 SQL)' : ''}`);
  }
}

// 直接对「生成的合法 SQL」做单元级校验
console.log('\n=== 生成 SQL 层面的误拦检查 ===');
const legitSqls = [
  "SELECT channel, SUM(marketing_cost) / NULLIF(SUM(new_users), 0) AS cac FROM dws_growth_daily WHERE dt BETWEEN '2026-08-15' AND '2026-09-13' GROUP BY channel ORDER BY cac DESC",
  "SELECT dt, SUM(dau) AS dau FROM dws_growth_daily WHERE dt BETWEEN '2026-08-15' AND '2026-09-13' GROUP BY dt ORDER BY dt ASC",
  "SELECT device, SUM(crash_sessions) / NULLIF(SUM(session_count), 0) AS rate FROM dws_growth_daily GROUP BY device ORDER BY rate ASC",
];
for (const s of legitSqls) {
  const r = checkSecurity(s, 'dws_growth_daily', ALLOWED_FIELDS.filter((f) => s.includes(f)));
  if (!r.passed) { fail++; console.log(`× 合法 SQL 被拦: ${r.hits.join('; ')}`); }
  else console.log(`✓ 合法 SQL 通过（含 DESC/ASC 排序）`);
}

// 校验攻击 SQL 仍被拦（绕过输入层，直接测生成层）
console.log('\n=== 攻击 SQL 直测第三层 ===');
const attackSqls = [
  'SELECT * FROM dws_growth_daily; DROP TABLE x',
  "SELECT * FROM dws_growth_daily WHERE 1=1 UNION SELECT password FROM users",
  'SELECT * FROM information_schema.columns',
];
for (const s of attackSqls) {
  const r = checkSecurity(s, 'dws_growth_daily', []);
  if (r.passed) { fail++; console.log(`× 攻击 SQL 漏放: ${s}`); }
  else console.log(`✓ 已拦: ${s.slice(0, 46)}… → ${r.hits[0]?.slice(0, 50)}`);
}

console.log('\n' + (fail === 0 ? '全部通过 ✓' : `${fail} 项不符 <<<`));
process.exit(fail === 0 ? 0 : 1);
