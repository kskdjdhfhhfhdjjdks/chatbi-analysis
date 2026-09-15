// ============================================================
// 安全机制的说明性数据（供「安全与链路」页展示）
// ============================================================

export const BLACKLIST_SAMPLES = [
  { pattern: 'DROP / TRUNCATE / ALTER TABLE', desc: 'DDL 语句，直接破坏表结构' },
  { pattern: 'DELETE FROM / UPDATE...SET / INSERT INTO', desc: 'DML 语句，篡改线上数据' },
  { pattern: 'UNION SELECT', desc: '联合查询注入，绕过字段白名单拖库' },
  { pattern: 'information_schema', desc: '系统元数据探测，摸清库表结构' },
  { pattern: 'SLEEP() / BENCHMARK()', desc: '时间盲注，通过响应延迟推断数据' },
  { pattern: 'LOAD_FILE / INTO OUTFILE', desc: '文件读写，可能导致服务器沦陷' },
  { pattern: '-- / /* */ / 分号拼接', desc: '注释与时序绕过，截断或追加恶意子句' },
  { pattern: 'GRANT / REVOKE / EXEC / xp_*', desc: '权限与执行类操作，越权风险' },
];

export const TEMPLATE_RULES = [
  {
    rule: '只接受以 SELECT 开头的单条语句',
    example: '✅ SELECT channel, SUM(revenue) FROM dws_growth_daily GROUP BY channel',
  },
  {
    rule: '禁止语句中出现分号（防多语句拼接）',
    example: '❌ SELECT * FROM t; DROP TABLE t;',
  },
  {
    rule: 'SQL 由指标元数据 + 固定模板拼装，模型不直接产出自由 SQL',
    example: '模板：SELECT {维度}, {指标聚合式} FROM {白名单表} WHERE {时间} GROUP BY {维度}',
  },
  {
    rule: '比率型指标聚合式由元数据强制指定，杜绝「行级平均」错误',
    example: 'SUM(numerator) / NULLIF(SUM(denominator), 0)',
  },
  {
    rule: '查询连接使用只读账号，数据库层再做一次兜底',
    example: 'GRANT SELECT ON dws_growth_daily TO chatbi_reader（无写权限）',
  },
];

export const PERMISSION_RULES = [
  {
    tag: '表白名单',
    tone: 'brand' as const,
    item: '仅允许访问分析表 dws_growth_daily',
    desc: '明细表、用户表、订单表等一律不可访问，避免绕过指标口径直查原始数据。',
  },
  {
    tag: '字段白名单',
    tone: 'accent' as const,
    item: '26 个分析字段（维度 + 指标口径字段）',
    desc: '不在白名单内的字段即使被问到也会被拒绝，例如 DROP、系统函数。',
  },
  {
    tag: '敏感字段',
    tone: 'danger' as const,
    item: '手机号 / 身份证 / 邮箱 / 密码 / 银行卡等直接拒绝',
    desc: '这类字段既不在白名单，也会被独立敏感词规则二次拦截，双重保险。',
  },
  {
    tag: '只读执行',
    tone: 'ok' as const,
    item: '所有查询以只读身份执行',
    desc: '即使黑名单与模板都被绕过，数据库账号权限也决定了无法造成写操作。',
  },
];

export const PIPELINE_STAGES = [
  {
    name: '① 意图识别',
    desc: '分流：数据问数 / 闲聊 / 策略咨询 / 安全风险。闲聊不消耗取数资源，安全风险直接转入拦截流程。',
    critical: false,
  },
  {
    name: '② 语义理解（双知识库）',
    desc: '指标知识库命中业务黑话（客单价、用户粘性 → 标准指标）；维度知识库命中维度与维度值（苹果 → iOS，江浙沪 → 华东）。',
    critical: false,
  },
  {
    name: '③ 预处理层（术语归一化）',
    desc: '长别名优先匹配、已命中片段占位防重叠、上下文继承追问改写（「那按渠道拆一下」自动补全为完整问题）。',
    critical: false,
  },
  {
    name: '④ 意图澄清判定',
    desc: '泛化词（留存/活跃）强制澄清；无指标时给出候选并通过已识别维度加权排序。宁可多问一句，绝不猜。',
    critical: false,
  },
  {
    name: '⑤ SQL 生成',
    desc: '按指标元数据与固定模板拼装 SQL，比率型指标强制走「先求和再相除」路径。',
    critical: false,
  },
  {
    name: '⑥ 三层安全校验',
    desc: '黑名单 → 指令模板 → 字段权限，逐层过检，任一命中即阻断并返回可解释原因。',
    critical: true,
  },
  {
    name: '⑦ 查询执行',
    desc: '只读执行；空结果区分「确实为 0」与「超出数据可用范围」，并对后者给出可查询区间提示。',
    critical: false,
  },
  {
    name: '⑧ 可视化与分析',
    desc: '按结果形态自适应选型：单值卡片 / 趋势折线 / 维度柱状 / 占比环形，并生成自然语言结论。',
    critical: false,
  },
  {
    name: '⑨ 归因下钻',
    desc: '当问题涉及「为什么 / 异常」或带维度时，自动触发等长窗口周对比 + 逐层 MECE 拆解，输出根因路径与建议。',
    critical: true,
  },
];

export const TEST_ATTACKS = [
  { input: 'DROP TABLE dws_growth_daily', layer: '①黑名单 + ②模板', result: '已拦截' },
  { input: "SELECT * FROM t; DELETE FROM t", layer: '②模板（分号检测）', result: '已拦截' },
  { input: "1' OR '1'='1 UNION SELECT password", layer: '①黑名单（UNION）', result: '已拦截' },
  { input: '查询所有用户的手机号', layer: '③敏感字段', result: '已拦截' },
  { input: 'SELECT * FROM information_schema.tables', layer: '①黑名单 + ③表白名单', result: '已拦截' },
  { input: "SELECT SLEEP(5)--", layer: '①黑名单（盲注/注释）', result: '已拦截' },
  { input: '帮我删掉昨天数据', layer: '①黑名单（自然语言越权）', result: '已拦截' },
  { input: 'TRUNCATE TABLE dws_growth_daily', layer: '①黑名单', result: '已拦截' },
  { input: 'DESC dws_growth_daily', layer: '①黑名单（语句起始位置判定）', result: '已拦截' },
];

/** 反向用例：这些是正常业务查询，必须放行（防止黑名单过宽造成误拦） */
export const TEST_PASS_THROUGH = [
  { input: '近30天各渠道的获客成本对比', why: '生成的 SQL 含 ORDER BY ... DESC 降序排序' },
  { input: '各渠道的ROI', why: '含 ORDER BY 排序 + 比率型聚合' },
  { input: '按设备看崩溃率', why: '含 ASC 升序排序（越小越好）' },
  { input: '各地区的留存率对比', why: '分组 + 排序组合' },
  { input: '拉新成本是多少', why: '含 NULLIF 除零保护' },
  { input: '沉睡用户有多少', why: '含 churn_users 字段' },
];
