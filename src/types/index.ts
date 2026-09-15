// ============================================================
// ChatBI 核心类型定义
// ============================================================

/** 指标定义 */
export interface Metric {
  key: string;
  name: string;
  aliases: string[];
  unit: 'count' | 'ratio' | 'currency' | 'duration' | 'score';
  /** 底层物理字段 */
  field: string;
  /** 比率型指标：分子/分母字段，聚合时先求和再相除 */
  isRatio?: boolean;
  numerator?: string;
  denominator?: string;
  /** 指标所属主题域 */
  domain: string;
  desc: string;
  /** 是否为泛化词，命中时必须走澄清 */
  generic?: boolean;
}

/** 维度定义 */
export interface Dimension {
  key: string;
  name: string;
  field: string;
  aliases: string[];
}

/** 维度值别名 */
export interface DimensionValue {
  dimension: string;
  value: string;
  aliases: string[];
}

/** 时间范围 */
export interface TimeRange {
  field: string;
  start: string;
  end: string;
  label: string;
  /** 是否为趋势（需要 GROUP BY dt） */
  trend?: boolean;
  granularity?: 'day' | 'week' | 'month';
}

/** 语义解析结果 */
export interface ParsedQuery {
  metrics: Metric[];
  dimensions: Dimension[];
  dimensionValues: { dimension: Dimension; value: string }[];
  timeRange: TimeRange | null;
  /** 原始问题中被识别到的术语（用于高亮） */
  matchedTokens: { text: string; kind: 'metric' | 'dimension' | 'value' | 'time'; label: string }[];
  /** 未识别的片段 */
  unknown: string[];
  /** 意图：问数 / 闲聊 / 安全风险 / 模糊 */
  intent: 'query' | 'chat' | 'unsafe' | 'ambiguous' | 'strategy';
  /** 是否需要澄清 */
  needClarify: boolean;
  clarifyOptions?: ClarifyOption[];
  clarifyReason?: string;
}

export interface ClarifyOption {
  label: string;
  value: string;
  desc?: string;
}

/** SQL 生成结果 */
export interface SqlResult {
  sql: string;
  blocked: boolean;
  blockReason?: string;
  /** 命中的安全规则 */
  securityHits?: string[];
}

/** 查询结果集 */
export interface QueryResult {
  columns: string[];
  rows: Record<string, string | number>[];
  /** 空结果解释 */
  emptyReason?: string;
}

/** 归因节点 */
export interface AttributionNode {
  level: number;
  dimension: string;
  value: string;
  contribution: number;
  currentValue: number;
  previousValue: number;
  changeRate: number;
  children?: AttributionNode[];
}

/** 归因结论 */
export interface Attribution {
  metricName: string;
  currentValue: number;
  previousValue: number;
  changeRate: number;
  isAnomaly: boolean;
  nodes: AttributionNode[];
  conclusion: string;
  chain: string[];
}

// ============================================================
// MECE 子问题拆解
// 设计原则：不直接回答主观问题，而是翻译成一棵「确定性子问题树」
// 每个子问题都可执行取数，最终基于客观结果合成结论
// ============================================================

/** 子问题的执行结果 */
export interface SubQuestionResult {
  id: string;
  /** 子问题标题（MECE 树的节点名） */
  title: string;
  /** 内部实现：这条子问题实际问到的东西 */
  impl: string;
  /** 拆解维度说明 */
  rationale: string;
  /** 取数状态 */
  status: 'ok' | 'empty' | 'unsupported';
  /** 该子问题的核心发现（一句话） */
  finding: string;
  /** 表格结果 */
  columns: string[];
  rows: Record<string, string | number>[];
  /** 图表 */
  chart?: ChartSpec;
  /** 该子问题用到的指标单位，用于格式化 */
  unit?: string;
}

/** MECE 拆解方案 */
export interface MecePlan {
  /** 匹配到的策略意图标题 */
  intentTitle: string;
  /** 用户原始问题 */
  question: string;
  /** 拆解依据说明 */
  basis: string;
  /** 子问题清单 */
  subQuestions: SubQuestionResult[];
  /** 综合结论 */
  synthesis: string;
  /** 决策建议（分层） */
  recommendation: { level: string; tone: 'ok' | 'warn' | 'danger'; items: string[] }[];
  /** 拆解是否完整覆盖（MECE 自查） */
  coverageNote: string;
}

/** 链路节点（用于可视化完整链路） */
export interface TraceStep {
  id: string;
  name: string;
  status: 'pass' | 'hit' | 'skip' | 'warn';
  detail: string;
  latency: number;
  icon: string;
}

/** Badcase */
export interface Badcase {
  id: string;
  question: string;
  type: string;
  modelOutput: string;
  expected: string;
  rootCause: string;
  fixAction: string;
  status: '已修复' | '优化中' | '待排期';
  foundAt: string;
  severity: 'P0' | 'P1' | 'P2';
}

/** 评测用例 */
export interface EvalCase {
  id: string;
  category: string;
  question: string;
  expectedSql: string;
  passed: boolean;
  failReason?: string;
  scores: { semantic: number; sql: number; hallucination: number };
}

/** 版本迭代记录：用于「效果对比」模块，说明指标是靠什么改动涨上来的 */
export interface EvalVersion {
  version: string;
  /** 该版本评测集规模 */
  cases: number;
  semantic: number;
  sql: number;
  hallucination: number;
  /** 本版本相对上一版做了什么（按重要性排序） */
  changes: string[];
  /** 是否为一个里程碑版本（用于视觉强调） */
  milestone?: boolean;
  /** 版本主题一句话概括 */
  theme: string;
}

/** 对话消息 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parsed?: ParsedQuery;
  sql?: SqlResult;
  result?: QueryResult;
  attribution?: Attribution;
  mece?: MecePlan;
  trace?: TraceStep[];
  chart?: ChartSpec;
  clarify?: ClarifyOption[];
  clarifyReason?: string;
  followups?: string[];
  timestamp: number;
}

/** 图表配置 */
export interface ChartSpec {
  type: 'line' | 'bar' | 'pie' | 'number' | 'table';
  title: string;
  data: Record<string, string | number>[];
  xKey?: string;
  series: { key: string; name: string; color: string }[];
  unit?: string;
}
