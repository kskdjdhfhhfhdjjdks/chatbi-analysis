import { useEffect, useState } from 'react';
import {
  MessageSquareText,
  BookOpen,
  Bug,
  Gauge,
  ShieldCheck,
  Sun,
  Moon,
  Menu,
  X,
} from 'lucide-react';
import { ChatBI } from './pages/ChatBI';
import { KnowledgeBase } from './pages/KnowledgeBase';
import { Badcase } from './pages/Badcase';
import { Evaluation } from './pages/Evaluation';
import { Security } from './pages/Security';

// ============================================================
// 应用外壳：侧边导航 + 主题切换
// ============================================================

const NAV = [
  { key: 'chat', label: '智能问数', icon: MessageSquareText, desc: '对话式 NL2SQL 主入口' },
  { key: 'kb', label: '语义知识库', icon: BookOpen, desc: '双知识库治理' },
  { key: 'badcase', label: 'Badcase 飞轮', icon: Bug, desc: '线上问题闭环' },
  { key: 'eval', label: '模型评测', icon: Gauge, desc: '指标量化与回归' },
  { key: 'security', label: '安全与链路', icon: ShieldCheck, desc: '三层安全机制' },
] as const;

type NavKey = (typeof NAV)[number]['key'];

export default function App() {
  const [tab, setTab] = useState<NavKey>('chat');
  const [dark, setDark] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const current = NAV.find((n) => n.key === tab)!;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* ---------- 侧边栏 ---------- */}
      <aside
        className="shrink-0 flex flex-col border-r z-30 fixed inset-y-0 left-0 w-[232px] lg:relative lg:translate-x-0 transition-transform duration-200"
        style={{
          background: 'var(--bg-elev)',
          borderColor: 'var(--border)',
          transform: navOpen ? 'translateX(0)' : undefined,
        }}
      >
        {/* Logo */}
        <div className="px-4 py-4 border-b flex items-center gap-2.5" style={{ borderColor: 'var(--border)' }}>
          <div
            className="rounded-lg flex items-center justify-center shrink-0"
            style={{ width: 32, height: 32, background: 'var(--brand)', color: '#fff' }}
          >
            <MessageSquareText size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold leading-5">ChatBI</div>
            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              对话式智能问数
            </div>
          </div>
          <button
            className="lg:hidden ml-auto p-1"
            onClick={() => setNavOpen(false)}
            style={{ color: 'var(--text-3)' }}
          >
            <X size={17} />
          </button>
        </div>

        {/* 导航 */}
        <nav className="flex-1 p-2.5 flex flex-col gap-1 overflow-y-auto">
          {NAV.map((n) => {
            const active = tab === n.key;
            const Icon = n.icon;
            return (
              <button
                key={n.key}
                onClick={() => {
                  setTab(n.key);
                  setNavOpen(false);
                }}
                className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all"
                style={{
                  background: active ? 'var(--brand-soft)' : 'transparent',
                  color: active ? 'var(--brand-text)' : 'var(--text-2)',
                  cursor: 'pointer',
                }}
              >
                <Icon size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5">{n.label}</div>
                  <div
                    className="text-[11px] mt-0.5"
                    style={{ color: active ? 'var(--brand-text)' : 'var(--text-3)', opacity: active ? 0.85 : 1 }}
                  >
                    {n.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* 底部 */}
        <div className="p-2.5 border-t flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => setDark((d) => !d)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] transition-colors"
            style={{ color: 'var(--text-2)', background: 'var(--bg-sub)', cursor: 'pointer' }}
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
            {dark ? '浅色模式' : '深色模式'}
          </button>
          <div className="text-[10.5px] px-1 leading-[1.6]" style={{ color: 'var(--text-3)' }}>
            纯前端 Demo · 内置模拟数据集
            <br />
            无后端依赖，可离线运行
          </div>
        </div>
      </aside>

      {/* 移动端遮罩 */}
      {navOpen && (
        <div
          className="fixed inset-0 z-20 lg:hidden"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* ---------- 主区 ---------- */}
      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* 顶栏 */}
        <header
          className="shrink-0 flex items-center gap-3 px-4 sm:px-6 border-b"
          style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', height: 52 }}
        >
          <button className="lg:hidden p-1" onClick={() => setNavOpen(true)} style={{ color: 'var(--text-2)' }}>
            <Menu size={18} />
          </button>
          <div className="text-[14px] font-semibold leading-5">{current.label}</div>
          <div className="ml-auto flex items-center gap-2">
            <span className="chip hidden sm:inline-flex" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
              ● 数据就绪
            </span>
          </div>
        </header>

        {/* 内容 */}
        <div key={tab} className="flex-1 min-h-0 overflow-hidden anim-in">
          {tab === 'chat' ? (
            <ChatBI />
          ) : (
            <div className="h-full overflow-y-auto">
              {tab === 'kb' && <KnowledgeBase />}
              {tab === 'badcase' && <Badcase />}
              {tab === 'eval' && <Evaluation />}
              {tab === 'security' && <Security />}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
