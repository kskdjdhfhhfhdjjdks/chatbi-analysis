import { ShieldCheck, Lock, FileCode2, KeyRound, Ban, GitBranch, Zap, Database, Target, CheckCircle2 } from 'lucide-react';
import { SectionTitle, StatusChip } from '../components/ui';
import { BLACKLIST_SAMPLES, TEMPLATE_RULES, PERMISSION_RULES, PIPELINE_STAGES, TEST_ATTACKS, TEST_PASS_THROUGH } from '../data/security';

// ============================================================
// 安全与链路页：三层安全机制 + 完整链路说明
// 这是「100% 拦截非查询语句」的产品承诺支撑
// ============================================================

export function Security() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6">
      <div className="mb-5">
        <h1 className="text-[18px] font-semibold mb-1">安全机制与处理链路</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
          NL2SQL 最大的生产风险是「模型生成危险语句」。ChatBI 采用
          <b style={{ color: 'var(--text)' }}>三层防御 + 只读执行</b>，确保非查询类指令 100% 被拦截。
        </p>
      </div>

      {/* 三层安全 */}
      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        {[
          {
            n: '第一层',
            t: 'SQL 语句黑名单',
            icon: <Ban size={16} />,
            tone: 'danger' as const,
            d: '正则匹配 DDL / DML / 系统表 / 注入特征，命中即拒。',
          },
          {
            n: '第二层',
            t: '指令模板约束',
            icon: <FileCode2 size={16} />,
            tone: 'warn' as const,
            d: '只接受以 SELECT 开头的单语句，禁止分号拼接与注释绕过。',
          },
          {
            n: '第三层',
            t: '表 / 字段权限',
            icon: <KeyRound size={16} />,
            tone: 'brand' as const,
            d: '表白名单 + 字段白名单，敏感字段（手机号/身份证）直接拒绝。',
          },
        ].map((l) => (
          <div key={l.n} className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="rounded-lg flex items-center justify-center"
                style={{
                  width: 30,
                  height: 30,
                  background: `var(--${l.tone}-soft)`,
                  color: `var(--${l.tone})`,
                }}
              >
                {l.icon}
              </span>
              <div>
                <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {l.n}
                </div>
                <div className="text-[13px] font-semibold leading-5">{l.t}</div>
              </div>
            </div>
            <p className="text-[12.5px] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
              {l.d}
            </p>
          </div>
        ))}
      </div>

      {/* 拦截样例 */}
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<Lock size={15} />}
          title="第一层：黑名单拦截规则"
          desc="覆盖 DDL / DML / 权限操作 / 系统表探测 / 时间盲注等典型攻击面"
        />
        <div className="grid sm:grid-cols-2 gap-2">
          {BLACKLIST_SAMPLES.map((b) => (
            <div
              key={b.pattern}
              className="rounded-lg p-2.5 flex items-start gap-2"
              style={{ background: 'var(--danger-soft)' }}
            >
              <Ban size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
              <div className="min-w-0">
                <div className="mono text-[12px] break-all" style={{ color: 'var(--danger)' }}>
                  {b.pattern}
                </div>
                <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                  {b.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 设计权衡：误拦也是成本 */}
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<Target size={15} />}
          title="设计权衡：过宽的黑名单会把正常查询一起拦掉"
          desc="安全机制真正的难点不是「拦得住」，而是「不误伤」——这是本项目实际踩过的坑。"
        />
        <div className="grid sm:grid-cols-2 gap-2.5">
          <div className="rounded-lg p-3" style={{ background: 'var(--danger-soft)' }}>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--danger)' }}>
              ❌ 早期实现：关键词一刀切
            </div>
            <div className="text-[12px] leading-[1.7]" style={{ color: 'var(--text)' }}>
              把 <span className="mono">desc</span> / <span className="mono">set</span> /{' '}
              <span className="mono">show</span> / <span className="mono">sys</span> 等词整体拉黑。
              结果 <span className="mono">ORDER BY cac DESC</span> 这种完全正常的降序排序被判定为攻击，
              <b style={{ color: 'var(--danger)' }}>所有带排序的查询全部被阻断</b>——比不拦截更糟，
              因为用户看到的是「安全拦截」而非「查询失败」，几乎无法自查。
            </div>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--ok-soft)' }}>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ok)' }}>
              ✅ 修正后：区分语句类型与语句位置
            </div>
            <div className="text-[12px] leading-[1.7]" style={{ color: 'var(--text)' }}>
              黑名单只保留真正具备破坏性、且不可能出现在合法 SELECT 中的模式：{' '}
              <span className="mono">DROP TABLE</span>、<span className="mono">UNION SELECT</span>、
              <span className="mono">information_schema</span>；对{' '}
              <span className="mono">DESC</span> 这类多义词，改为要求出现在<b>语句起始位置</b>才判定为探测行为。
              同时把「自然语言越权意图」前置到输入层识别。
            </div>
          </div>
        </div>
        <div
          className="rounded-lg px-3 py-2 mt-2.5 text-[11.5px] leading-[1.7] flex gap-2"
          style={{ background: 'var(--bg-sub)', color: 'var(--text-2)' }}
        >
          <Zap size={13} className="shrink-0 mt-[3px]" style={{ color: 'var(--brand)' }} />
          <span>
            结论：安全规则的正确性必须用<b style={{ color: 'var(--text)' }}>双向用例</b>验证——
            既测「该拦的拦住了」，也测「该放的放过去了」。只测攻击样本会漏掉误拦，
            而误拦对可用性的伤害往往不比漏放小。
          </span>
        </div>
      </div>
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<FileCode2 size={15} />}
          title="第二层：指令模板约束"
          desc="把模型的输出关进「模板笼子」，从根上消除多语句与注入的可能性"
        />
        <div className="flex flex-col gap-2">
          {TEMPLATE_RULES.map((r) => (
            <div key={r.rule} className="rounded-lg p-3" style={{ background: 'var(--bg-sub)' }}>
              <div className="text-[12.5px] font-medium mb-1">{r.rule}</div>
              <div className="mono text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                {r.example}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 第三层 */}
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<KeyRound size={15} />}
          title="第三层：表 / 字段权限"
          desc="最小权限原则：只开放分析所需字段，从数据源头阻断越权"
        />
        <div className="flex flex-col gap-2">
          {PERMISSION_RULES.map((p) => (
            <div key={p.item} className="flex items-start gap-2.5">
              <StatusChip tone={p.tone}>{p.tag}</StatusChip>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{p.item}</div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                  {p.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 完整链路 */}
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<GitBranch size={15} />}
          title="完整处理链路（9 个环节）"
          desc="从用户提问到答案呈现，每一步都可观测、可拦截、可解释"
        />
        <div className="flex flex-col gap-0">
          {PIPELINE_STAGES.map((s, i) => (
            <div key={s.name} className="relative flex gap-3 pb-3.5">
              {i < PIPELINE_STAGES.length - 1 && (
                <span
                  className="absolute left-[13px] top-[26px] w-px"
                  style={{ height: 'calc(100% - 18px)', background: 'var(--border-strong)' }}
                />
              )}
              <span
                className="relative z-10 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold"
                style={{
                  width: 27,
                  height: 27,
                  background: s.critical ? 'var(--warn-soft)' : 'var(--brand-soft)',
                  color: s.critical ? 'var(--warn)' : 'var(--brand-text)',
                  border: `1.5px solid ${s.critical ? 'var(--warn)' : 'var(--brand)'}`,
                }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold">{s.name}</span>
                  {s.critical && <StatusChip tone="warn">关键防线</StatusChip>}
                </div>
                <div className="text-[12.5px] mt-0.5 leading-[1.7]" style={{ color: 'var(--text-2)' }}>
                  {s.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 攻击用例 */}
      <div className="card p-4 mb-5">
        <SectionTitle
          icon={<Zap size={15} />}
          title="安全回归用例"
          desc="每次发版必跑；扩展攻击变体持续补充，保持对新型注入手法的防御"
        />
        <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr style={{ background: 'var(--bg-sub)' }}>
                {['攻击输入', '拦截层', '结果'].map((h) => (
                  <th
                    key={h}
                    className="text-left font-semibold px-3 py-2 whitespace-nowrap border-b"
                    style={{ color: 'var(--text-2)', borderColor: 'var(--border)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TEST_ATTACKS.map((t, i) => (
                <tr key={i} style={{ background: i % 2 ? 'transparent' : 'var(--bg-sub)' }}>
                  <td className="px-3 py-2 mono border-b" style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}>
                    {t.input}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap border-b" style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                    {t.layer}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap border-b" style={{ borderColor: 'var(--border)' }}>
                    <StatusChip tone="ok">{t.result}</StatusChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 mt-3 text-[12.5px]" style={{ color: 'var(--ok)' }}>
          <ShieldCheck size={14} />
          非查询类指令拦截率：<b>100%</b>（{TEST_ATTACKS.length}/{TEST_ATTACKS.length} 全部拦截）
        </div>

        {/* 反向用例：防止误拦 */}
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-2.5">
            <ShieldCheck size={14} style={{ color: 'var(--brand)' }} />
            <span className="text-[12.5px] font-semibold">反向用例：这些必须放行</span>
            <StatusChip tone="brand">零误拦</StatusChip>
          </div>
          <div className="text-[11.5px] mb-2" style={{ color: 'var(--text-3)' }}>
            只测攻击样本会漏掉「误拦」。以下均为正常业务查询，其上生成的 SQL 天然包含 ORDER BY / DESC / NULLIF
            等关键字，若黑名单设计过宽会被一并拦截。
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {TEST_PASS_THROUGH.map((t) => (
              <div
                key={t.input}
                className="rounded-lg px-3 py-2 flex items-start gap-2"
                style={{ background: 'var(--ok-soft)' }}
              >
                <CheckCircle2 size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
                <div className="min-w-0">
                  <div className="text-[12px] font-medium">{t.input}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                    {t.why}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 技术架构 */}
      <div className="card p-4">
        <SectionTitle
          icon={<Database size={15} />}
          title="本 Demo 的技术实现说明"
          desc="纯前端实现，但完整复刻了生产级 NL2SQL 的工程结构"
        />
        <div className="grid sm:grid-cols-2 gap-2.5">
          {[
            { t: '语义层', d: '双知识库（指标 30+ / 维度 7 + 40+ 值别名）+ 长别名优先匹配 + 术语占位防重叠 + 时间自然语言解析' },
            { t: '澄清层', d: '泛化词强制澄清 + 无指标兜底澄清 + 澄清选项结合已识别维度做候选加权' },
            { t: 'SQL 引擎', d: '按指标元数据生成 SQL；比率型指标显式走「先求和再相除」，规避行级平均的经典错误' },
            { t: '安全层', d: '黑名单 / 模板 / 权限三层校验，每次生成后强制过检，任一命中即阻断' },
            { t: '执行层', d: '在 20 万行种子明细上做真实聚合，绝不编造数据；空结果区分「真为 0」与「超出数据范围」' },
            { t: '归因层', d: '等长窗口周对周对比 + 逐层 MECE 拆解 + 贡献度排序，输出思维链与可执行结论' },
          ].map((x) => (
            <div key={x.t} className="rounded-lg p-3" style={{ background: 'var(--bg-sub)' }}>
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold mb-1">
                <Target size={12} style={{ color: 'var(--brand)' }} />
                {x.t}
              </div>
              <div className="text-[12px] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
                {x.d}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
