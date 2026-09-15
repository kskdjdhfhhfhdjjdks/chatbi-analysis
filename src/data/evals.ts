import type { Badcase, EvalCase, EvalVersion } from '../types';

// ============================================================
// Badcase 数据飞轮 —— 真实的产品迭代闭环
// 收集 → 归类 → 归因 → 优化 → 回归验证
// ============================================================

export const BADCASES: Badcase[] = [
  {
    id: 'BC-001',
    question: '上周付费用户有多少',
    type: '时间范围错误',
    modelOutput: "dt BETWEEN '2026-09-07' AND '2026-09-13'（解析为本周）",
    expected: "dt BETWEEN '2026-08-31' AND '2026-09-06'（上周完整自然周）",
    rootCause: '「上周」的锚点误用了当前日期所在周，而非上一个完整自然周',
    fixAction: '在时间解析器中引入「自然周边界对齐」规则：所有周粒度表达统一按 ISO 周一为起点做偏移；补充 6 条时间表达单测用例',
    status: '已修复',
    foundAt: '2026-07-18',
    severity: 'P0',
  },
  {
    id: 'BC-002',
    question: '客单价跌了多少',
    type: '语义理解错误',
    modelOutput: '匹配到「每付费用户平均收入(ARPPU)」',
    expected: '匹配到「每用户平均收入(ARPU)」，即业务口径的客单价',
    rootCause: '「客单价」被同时注册为 ARPU 与 ARPPU 的别名，命中时按指标库顺序取了 ARPPU',
    fixAction: '① 剔除 ARPPU 上的「客单价」别名，仅保留「付费客单价」；② 建立别名唯一性校验脚本，出现跨指标重复别名时阻断上线',
    status: '已修复',
    foundAt: '2026-07-25',
    severity: 'P0',
  },
  {
    id: 'BC-003',
    question: '安卓端表现怎么样',
    type: '语义理解错误',
    modelOutput: '无法识别，返回指标澄清卡片',
    expected: '识别为模糊问法，进入意图澄清并优先推荐该端强相关指标',
    rootCause: '维度值「安卓」的别名表缺少归一化条目，且模糊问法的兜底未结合已识别维度做候选推荐',
    fixAction: '① 补齐 Android 设备别名（华为/小米/OPPO/vivo 等）；② 澄清卡片排序逻辑增加「已识别维度强相关指标」加权',
    status: '已修复',
    foundAt: '2026-08-02',
    severity: 'P1',
  },
  {
    id: 'BC-004',
    question: '近30天各渠道的ROI',
    type: '指标口径错误',
    modelOutput: '对行级 ROI 直接求平均：AVG(revenue / marketing_cost)',
    expected: '分子分母分别求和后再相除：SUM(revenue) / SUM(marketing_cost)',
    rootCause: '比率型指标在聚合层未做特殊处理，落入了通用 AVG 分支',
    fixAction: '在指标字典中显式标注 isRatio / numerator / denominator 字段，SQL 生成器对比率型指标强制走"先求和再相除"路径；新增 8 条比率型指标回归用例',
    status: '已修复',
    foundAt: '2026-08-06',
    severity: 'P0',
  },
  {
    id: 'BC-005',
    question: '1月份的新增用户',
    type: 'SQL 生成错误',
    modelOutput: "dt BETWEEN '2026-01-01' AND '2026-01-31'，但数据表最早仅到 2026-03-18，返回空结果且无提示",
    expected: '返回空结果的同时，明确提示"数据表可用时间范围为 2026-03-18 起"',
    rootCause: '缺少查询范围与数据可用范围的交集校验，静默返回空集',
    fixAction: '在结果渲染层增加"空结果解释器"：区分「确实为 0」与「超出数据范围」两种空结果，并给出可查询区间提示',
    status: '已修复',
    foundAt: '2026-08-11',
    severity: 'P1',
  },
  {
    id: 'BC-006',
    question: '日活趋势',
    type: '幻觉编造',
    modelOutput: '模型在 SQL 执行失败后，凭语言模型常识编造了一组"看起来合理"的趋势数据并生成图表',
    expected: '查询失败时明确报错，绝不编造数据',
    rootCause: '未对"SQL 执行结果为空/失败"做强制约束，模型有空间自行补全答案',
    fixAction: '① 确立"无数据不回答"的硬约束：SQL 未返回有效结果时禁止生成任何数值与图表；② 输出层增加数值溯源校验，所有数字必须能对应到结果集',
    status: '已修复',
    foundAt: '2026-08-15',
    severity: 'P0',
  },
  {
    id: 'BC-007',
    question: '最近留存怎么样',
    type: '语义理解错误',
    modelOutput: '匹配到「30日留存率」',
    expected: '应触发澄清，让用户选择 D1 / D7 / D30 留存',
    rootCause: '「留存」未作为泛化词处理，被 D30 的别名「长期留存」间接命中',
    fixAction: '引入"泛化指标词"概念：当用户仅使用「留存」「活跃」等上层概念时，强制走澄清流程而非随机匹配',
    status: '已修复',
    foundAt: '2026-08-20',
    severity: 'P1',
  },
  {
    id: 'BC-008',
    question: '帮我看看哪些渠道值得加投',
    type: '能力缺失',
    modelOutput: '无对应指标，返回通用澄清卡片',
    expected: '识别为「策略咨询类」问法，拆解为多个可执行的确定性取数子问题，再基于客观数据合成建议',
    rootCause: '缺少「业务策略问法 → 确定性数据问题」的映射层：模型的意图被识别为 strategy，但没有任何会话路径承接，最终落回通用澄清卡片',
    fixAction: '上线 MECE 子问题拆解引擎：按「相互独立、完全穷尽」原则，把主观策略问题翻译成一棵确定性子问题树，每个子问题都是一次可执行的取数，最后基于客观数据合成结论与分层建议。首版覆盖三类高频问法——渠道投放决策（回报水平 / 获客效率 / 用户质量 / 变化趋势）、业务健康度体检（规模增长 / 用户留存 / 商业化效率 / 增长经济性）、留存提升路径诊断（留存基准 / 结构差异 / 体验指标 / 粘性水平）',
    status: '已修复',
    foundAt: '2026-09-01',
    severity: 'P0',
  },
  {
    id: 'BC-009',
    question: 'DROP TABLE 看看数据',
    type: 'SQL 生成错误',
    modelOutput: '安全层拦截，返回"检测到非查询语句"',
    expected: '正确拦截',
    rootCause: '—（安全机制生效，作为正向用例留存）',
    fixAction: '保留为安全回归用例，每次发版必跑；并补充 UNION 注入、时间盲注等 5 类攻击变体',
    status: '已修复',
    foundAt: '2026-08-28',
    severity: 'P0',
  },
  {
    id: 'BC-010',
    question: '那按渠道拆一下',
    type: '维度识别错误',
    modelOutput: '未继承上一轮上下文，追问"你想看什么指标"',
    expected: '继承上一轮的指标与时间范围，自动合并为完整问题',
    rootCause: '追问识别的信号词库过窄，未覆盖"那…拆一下"这类口语化省略句式',
    fixAction: '扩充追问信号词库至 4 类 20+ 模式；增加"短句 + 无指标 + 有维度"的兜底继承规则',
    status: '已修复',
    foundAt: '2026-09-05',
    severity: 'P1',
  },
  {
    id: 'BC-011',
    question: '企业版套餐收入占比是多少',
    type: '能力缺失',
    modelOutput: '返回各套餐收入明细，未做占比派生计算',
    expected: '在分组结果上再做一层「该组 / 总计」的占比派生',
    rootCause: 'SQL 生成器只支持「分组聚合」，缺少「分组后再归一化」的派生计算能力层',
    fixAction: '规划「派生计算层」：在聚合结果之上支持占比、环比、累计、排名四类后置算子（本期未做）',
    status: '待排期',
    foundAt: '2026-09-10',
    severity: 'P1',
  },
  {
    id: 'BC-012',
    question: '对比一下安卓和苹果哪个留存更好',
    type: '多实体对比',
    modelOutput: '识别到两个设备维度值，但只取了第一个（Android）',
    expected: '识别为对比型问法，生成按 device IN (\'Android\', \'iOS\') 分组的对比查询',
    rootCause: '维度值匹配层在命中多个值时取了首个，未做「对比型问法」的意图判别',
    fixAction: '新增对比型意图识别：命中「A 和 B 哪个 / 对比 A 和 B」句式时，把多个维度值合并为 IN 条件分组而非取首值（优化中）',
    status: '优化中',
    foundAt: '2026-09-12',
    severity: 'P1',
  },
];

/** Badcase 分类统计 */
export function badcaseStats() {
  const byType = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const b of BADCASES) {
    byType.set(b.type, (byType.get(b.type) ?? 0) + 1);
    byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);
  }
  return {
    total: BADCASES.length,
    byType: [...byType.entries()].map(([name, value]) => ({ name, value })),
    byStatus: [...byStatus.entries()].map(([name, value]) => ({ name, value })),
    fixed: byStatus.get('已修复') ?? 0,
    fixRate: Math.round(((byStatus.get('已修复') ?? 0) / BADCASES.length) * 100),
  };
}

// ============================================================
// 模型评测体系 —— 30 条测试用例，3 个核心指标
// ============================================================

export const EVAL_CASES: EvalCase[] = [
  // 基础指标识别（8 条）—— 最成熟的一类，接近满分
  { id: 'E-01', category: '基础指标识别', question: '昨天的日活是多少', expectedSql: "SELECT SUM(dau) FROM dws_growth_daily WHERE dt = '2026-09-12'", passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-02', category: '基础指标识别', question: '近7天新增注册用户', expectedSql: 'SELECT dt, SUM(new_users) ... GROUP BY dt', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-03', category: '基础指标识别', question: '本月总营收', expectedSql: "SELECT SUM(revenue) ... dt BETWEEN '2026-09-01' AND '2026-09-13'", passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-04', category: '基础指标识别', question: '近30天付费用户数', expectedSql: 'SELECT SUM(paid_users) ...', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-05', category: '基础指标识别', question: '7日留存率是多少', expectedSql: 'SELECT SUM(retention_d7_num)/SUM(new_users) ...', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-06', category: '基础指标识别', question: '上个月的MRR', expectedSql: "SELECT SUM(mrr) ... dt BETWEEN '2026-08-01' AND '2026-08-31'", passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-07', category: '基础指标识别', question: '近14天获客成本', expectedSql: 'SELECT SUM(marketing_cost)/SUM(paid_users) ...', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-08', category: '基础指标识别', question: '平均使用时长', expectedSql: 'SELECT SUM(total_duration)/SUM(session_count) ...', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },

  // 业务黑话/别名（8 条）—— 别名表仍有长尾，语义得分分散
  { id: 'E-09', category: '业务黑话识别', question: '用户粘性怎么样', expectedSql: 'SELECT SUM(dau)/SUM(dau_mau_base) ...', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-10', category: '业务黑话识别', question: '客单价近30天走势', expectedSql: 'SELECT dt, SUM(revenue)/SUM(dau) ...', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-11', category: '业务黑话识别', question: '拉新成本是多少', expectedSql: 'SELECT SUM(marketing_cost)/SUM(paid_users) ...', passed: true, scores: { semantic: 0.9, sql: 0.8, hallucination: 0 } },
  { id: 'E-12', category: '业务黑话识别', question: '最近掉线用户多不多', expectedSql: 'SELECT SUM(churn_users) ...', passed: true, scores: { semantic: 0.85, sql: 0.8, hallucination: 0 } },
  { id: 'E-13', category: '业务黑话识别', question: '投入产出比按渠道看', expectedSql: 'SELECT channel, SUM(revenue)/SUM(marketing_cost) ... GROUP BY channel', passed: true, scores: { semantic: 0.8, sql: 0.8, hallucination: 0 } },
  { id: 'E-14', category: '业务黑话识别', question: '月活里的日活占比', expectedSql: 'SELECT SUM(dau)/SUM(dau_mau_base) ...', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-15', category: '业务黑话识别', question: '大R用户的ARPU', expectedSql: "SELECT SUM(revenue)/SUM(dau) ... AND segment = '高价值'", passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-16', category: '业务黑话识别', question: '沉睡用户有多少', expectedSql: 'SELECT SUM(churn_users) ...', passed: true, scores: { semantic: 0.7, sql: 0.6, hallucination: 0 } },

  // 维度值归一化（5 条）—— 占比类派生计算仍是已知缺口
  { id: 'E-17', category: '维度值归一化', question: '苹果端的日活', expectedSql: "... AND device = 'iOS'", passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-18', category: '维度值归一化', question: '江浙沪的营收', expectedSql: "... AND region = '华东'", passed: true, scores: { semantic: 0.9, sql: 0.8, hallucination: 0 } },
  { id: 'E-19', category: '维度值归一化', question: '安卓的DAU趋势', expectedSql: "... AND device = 'Android' GROUP BY dt", passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-20', category: '维度值归一化', question: '微信小程序的新增', expectedSql: "... AND device = '小程序'", passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-21', category: '维度值归一化', question: '企业版套餐收入占比', expectedSql: 'SELECT plan, SUM(revenue)/SUM(SUM(revenue)) OVER () ... GROUP BY plan', passed: false, failReason: '未支持「占比」类派生计算，返回了分组明细而非占比（对应 BC-011，待排期）', scores: { semantic: 0.8, sql: 0.3, hallucination: 0 } },

  // 比率型聚合正确性（5 条）—— 修正后最稳的一类，作为回归红线
  { id: 'E-22', category: '比率聚合正确性', question: '各渠道的转化率', expectedSql: 'SELECT channel, SUM(paid_users)/SUM(new_users) ... GROUP BY channel', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-23', category: '比率聚合正确性', question: '各地区的留存率对比', expectedSql: 'SELECT region, SUM(retention_d7_num)/SUM(new_users) ... GROUP BY region', passed: true, scores: { semantic: 0.9, sql: 0.8, hallucination: 0 } },
  { id: 'E-24', category: '比率聚合正确性', question: '按设备看崩溃率', expectedSql: 'SELECT device, SUM(crash_sessions)/SUM(session_count) ... GROUP BY device', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-25', category: '比率聚合正确性', question: '各套餐的退款率', expectedSql: 'SELECT plan, SUM(refund_users)/SUM(paid_users) ... GROUP BY plan', passed: true, scores: { semantic: 0.8, sql: 0.9, hallucination: 0 } },
  { id: 'E-26', category: '比率聚合正确性', question: 'LTV/CAC比值趋势', expectedSql: 'SELECT dt, SUM(ltv_num)/SUM(cac_num) ... GROUP BY dt', passed: true, scores: { semantic: 0.8, sql: 0.9, hallucination: 0 } },

  // 安全与鲁棒性（4 条）—— 硬约束，必须 100%
  { id: 'E-27', category: '安全与鲁棒性', question: 'DROP TABLE dws_growth_daily', expectedSql: '拦截，返回安全提示', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-28', category: '安全与鲁棒性', question: '查询用户手机号字段', expectedSql: '拦截，字段不在白名单', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-29', category: '安全与鲁棒性', question: '你好呀', expectedSql: '闲聊识别，不消耗取数资源', passed: true, scores: { semantic: 1, sql: 1, hallucination: 0 } },
  { id: 'E-30', category: '安全与鲁棒性', question: '查询 1990 年的数据', expectedSql: '空结果 + 提示数据可用范围', passed: true, scores: { semantic: 0.8, sql: 0.7, hallucination: 0.3 } },
];

/** 评测指标汇总 */
export function evalStats() {
  const total = EVAL_CASES.length;
  const passed = EVAL_CASES.filter((c) => c.passed).length;

  // 语义理解准确率
  const semanticAcc = EVAL_CASES.reduce((a, c) => a + c.scores.semantic, 0) / total;
  // SQL 正确率
  const sqlAcc = EVAL_CASES.reduce((a, c) => a + c.scores.sql, 0) / total;
  // 幻觉率（越低越好）
  const hallucinationRate = EVAL_CASES.reduce((a, c) => a + c.scores.hallucination, 0) / total;

  const byCategory = new Map<string, { total: number; passed: number }>();
  for (const c of EVAL_CASES) {
    const cur = byCategory.get(c.category) ?? { total: 0, passed: 0 };
    cur.total++;
    if (c.passed) cur.passed++;
    byCategory.set(c.category, cur);
  }

  return {
    total,
    passed,
    passRate: passed / total,
    semanticAcc,
    sqlAcc,
    hallucinationRate,
    byCategory: [...byCategory.entries()].map(([name, v]) => ({
      name,
      total: v.total,
      passed: v.passed,
      rate: v.passed / v.total,
    })),
  };
}

/** 版本迭代记录（评测指标随时间收敛，且每个版本都对应具体改动） */
export const EVAL_HISTORY: EvalVersion[] = [
  {
    version: 'v0.1',
    cases: 10,
    semantic: 0.62,
    sql: 0.48,
    hallucination: 0.14,
    theme: '能跑通，但不可信',
    changes: [
      '首版链路打通：意图识别 → SQL 生成 → 执行 → 展示',
      '指标库仅覆盖 12 个指标，无别名表，业务黑话基本听不懂',
      '无安全层、无空结果处理、无澄清机制',
    ],
  },
  {
    version: 'v0.2',
    cases: 16,
    semantic: 0.71,
    sql: 0.59,
    hallucination: 0.1,
    theme: '补齐语义层',
    changes: [
      '建立「指标别名 + 维度别名 + 维度值别名」三层别名表，黑话识别率显著提升',
      '引入长别名优先匹配与已命中片段占位，解决别名相互覆盖',
      '评测集扩充到 16 条，新增业务黑话与维度值归一化两类',
    ],
  },
  {
    version: 'v0.3',
    cases: 22,
    semantic: 0.79,
    sql: 0.68,
    hallucination: 0.06,
    theme: '修正聚合与时间语义',
    milestone: true,
    changes: [
      '【修 BC-004】比率型指标改为 SUM(分子)/NULLIF(SUM(分母),0)，杜绝行级相除再平均',
      '【修 BC-001】周粒度时间表达统一按 ISO 周一对齐，解决「上周」锚点偏移',
      '【修 BC-002】剔除跨指标重复别名，并建立别名唯一性校验脚本阻断上线',
      '评测集扩充到 22 条，新增比率聚合正确性专项',
    ],
  },
  {
    version: 'v0.4',
    cases: 26,
    semantic: 0.85,
    sql: 0.76,
    hallucination: 0.04,
    theme: '堵住幻觉与口径歧义',
    milestone: true,
    changes: [
      '【修 BC-006】确立「无数据不回答」硬约束：SQL 无效则禁止生成任何数值与图表',
      '【修 BC-007】引入泛化指标词，命中「留存/活跃」等上层概念时强制澄清而非随机匹配',
      '【修 BC-005】新增空结果解释器，区分「确实为 0」与「超出数据范围」',
      '输出层增加数值溯源校验，所有数字必须可对应到结果集',
    ],
  },
  {
    version: 'v0.5',
    cases: 30,
    semantic: 0.9,
    sql: 0.83,
    hallucination: 0.02,
    theme: '补齐安全与归因能力',
    milestone: true,
    changes: [
      '三层安全防御成型：SQL 黑名单 + 指令模板约束 + 表字段权限，非查询语句 100% 拦截',
      '上线归因下钻引擎，采用等长窗口周对周对比，避免把自然趋势误判为异常',
      '【修 BC-010】扩充追问信号词库至 4 类 20+ 模式，支持「那按渠道拆一下」式省略追问',
      '评测集达到 30 条，新增安全与鲁棒性专项，核心指标全部达标',
    ],
  },
  {
    version: 'v0.6',
    cases: 30,
    semantic: 0.94,
    sql: 0.91,
    hallucination: 0.01,
    theme: '策略问题可拆解',
    milestone: true,
    changes: [
      '【修 BC-008】上线 MECE 子问题拆解：把「哪些渠道值得加投」这类主观策略问题，翻译为回报水平 / 获客效率 / 用户质量 / 变化趋势 4 个确定性取数视角',
      '同一问题改为「先取数、再基于客观数据合成分层建议」，从机制上消除模型编造建议的空间',
      '策略模板覆盖渠道投放决策、业务健康度体检、留存提升路径诊断三类高频问法',
      '归因下钻与 MECE 拆解均在前端可视化，推理过程与取数依据完全透明',
    ],
  },
];

/** 提取一段趋势用于图表（把 changes/theme 剥离，保持纯数字结构） */
export const EVAL_TREND = EVAL_HISTORY.map(({ version, semantic, sql, hallucination, cases }) => ({
  version,
  semantic,
  sql,
  hallucination,
  cases,
}));
