import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  LayoutDashboard, CalendarCheck, ListChecks, ChevronLeft, ChevronRight, CheckCircle2, Circle,
  Briefcase, Code2, Calculator, GitBranch, ClipboardList, Brain, BookOpen,
  Flame, Sparkles, ArrowRight, Settings, Plus, Trash2, RotateCcw, X, Shield, Calendar, Clock, Bell, BellRing, Check, Copy, Layers, CalendarDays, MoreVertical, Mic, SlidersHorizontal, FileText, Download, Filter, XCircle, User, Heart, Moon, HelpCircle, LogOut, Menu, Edit3, Target, Flag
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer, PieChart, Pie, Legend } from 'recharts';

/* ---------------------------------- THEME ---------------------------------- */
const COLORS = {
  bg: '#F5F3EE',
  tealDeep: '#123936',
  tealMid: '#1F6F68',
  gold: '#C79A3E',
  goldLight: '#E3C077',
  ink: '#1C2321',
  muted: '#6E7570',
  card: '#FFFFFF',
  border: '#E4E1D6',
  learn: '#B0453A',
  rest: '#C7C2B4',
};

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');`;

// App creation start date anchor (Yesterday: Aug 26, 2026)
const APP_START_DATE = '2026-08-26';

const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const HAS_SPEECH_RECOGNITION = !!SpeechRecognition;

/* ----------------------------- STORAGE HELPER ----------------------------- */
const storageHelper = {
  async get(key) {
    if (window.storage?.get) {
      try {
        const res = await window.storage.get(key, false);
        if (res) return res;
      } catch (e) {
        console.warn('window.storage.get error:', e);
      }
    }
    try {
      const val = localStorage.getItem(key);
      return val !== null ? { value: val } : null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    if (window.storage?.set) {
      try {
        await window.storage.set(key, value, false);
        return;
      } catch (e) {
        console.warn('window.storage.set error:', e);
      }
    }
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error('Failed to write to localStorage:', e);
    }
  },
  async delete(key) {
    if (window.storage?.delete) {
      try {
        await window.storage.delete(key, false);
        return;
      } catch (e) {
        console.warn('window.storage.delete error:', e);
      }
    }
    try {
      localStorage.removeItem(key);
    } catch {}
  },
  async list(prefix) {
    if (window.storage?.list) {
      try {
        const res = await window.storage.list(prefix, false);
        if (res) return res;
      } catch (e) {
        console.warn('window.storage.list error:', e);
      }
    }
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!prefix || (k && k.startsWith(prefix))) {
          keys.push(k);
        }
      }
      return { keys };
    } catch {
      return { keys: [] };
    }
  }
};

/* ------------------------------- ROADMAP DATA ------------------------------- */
const ICON_MAP = {
  Briefcase,
  Code2,
  Calculator,
  GitBranch,
  ClipboardList,
  Brain,
  BookOpen,
};

function getSkillIcon(icon) {
  if (typeof icon === 'string') {
    return ICON_MAP[icon] || Code2;
  }
  return icon || Code2;
}

const DEFAULT_SKILLS = [];

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_TEMPLATES = {
  A: {
    id: 'A',
    label: 'Schedule 1',
    days: [1, 3, 5], // Mon, Wed, Fri
    tasks: [],
  },
  B: {
    id: 'B',
    label: 'Schedule 2',
    days: [2, 4, 6], // Tue, Thu, Sat
    tasks: [],
  },
  S: {
    id: 'S',
    label: 'Schedule 3',
    days: [0], // Sun
    tasks: [],
  },
};

function cloneTemplates(src) {
  const result = {};
  for (const [k, v] of Object.entries(src)) {
    result[k] = {
      ...v,
      days: [...(v.days || [])],
      tasks: v.tasks.map((t) => ({ ...t })),
    };
  }
  return result;
}

/** Dynamic lookup for template by date day of week */
function getTemplateForDate(date, templates) {
  const dayNum = date.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  for (const tpl of Object.values(templates)) {
    if (tpl.days && tpl.days.includes(dayNum)) {
      return tpl;
    }
  }
  // Fallback
  if (dayNum === 0) return templates.S || Object.values(templates)[0];
  if ([1, 3, 5].includes(dayNum)) return templates.A || Object.values(templates)[0];
  return templates.B || Object.values(templates)[0];
}

/** Local timezone date formatting YYYY-MM-DD */
function dateKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function skillPercent(skill, progress) {
  const map = progress[skill.id] || {};
  const done = skill.steps.filter((s) => map[s.id]).length;
  return skill.steps.length ? Math.round((done / skill.steps.length) * 100) : 0;
}

/** Status Rating Logic */
function getDayStatus(done, total) {
  if (total === 0) return 'rest';
  if (done === total && total > 0) return 'superb';
  if (done > 0) return 'good';
  return 'bad';
}

const STATUS_META = {
  superb: { label: 'Superb (100% Win)', color: '#16A34A', bg: '#DCFCE7', border: '#86EFAC', text: '#15803D' },
  good:   { label: 'Good (Partial)', color: '#F59E0B', bg: '#FEF3C7', border: '#FDE047', text: '#B45309' },
  bad:    { label: 'Bad (Waste Day)', color: '#EF4444', bg: '#FEE2E2', border: '#FCA5A5', text: '#B91C1C' },
  rest:   { label: 'Rest Day', color: '#94A3B8', bg: '#F1F5F9', border: '#CBD5E1', text: '#475569' },
};

/* ------------------------------ UI PRIMITIVES ------------------------------ */
function ProgressRing({ percent, size = 64, stroke = 6, color, trackColor }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, percent)) / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor || 'rgba(255,255,255,0.15)'} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .5s ease' }}
        />
      </svg>
    </div>
  );
}

function TaskRow({ title, subtitle, done, onToggle, color, onNavigate, onAction }) {
  return (
    <div
      className="w-full flex items-center gap-3 rounded-2xl p-3.5 sm:p-4 transition-all hover:shadow-xs"
      style={{ background: done ? color + '12' : COLORS.card, border: `1px solid ${done ? color + '66' : COLORS.border}` }}
    >
      <button onClick={onToggle} className="shrink-0 transition-transform active:scale-90 p-1 cursor-pointer" aria-label="toggle done">
        {done ? <CheckCircle2 size={22} color={color} /> : <Circle size={22} color={COLORS.muted} />}
      </button>
      <div className="flex-1 min-w-0" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <div
          className="font-semibold text-xs sm:text-sm transition-all"
          style={{ color: COLORS.ink, textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.65 : 1 }}
        >
          {title}
        </div>
        {subtitle && <div className="text-[11px] sm:text-xs mt-0.5 font-medium truncate" style={{ color: COLORS.muted }}>{subtitle}</div>}
      </div>
      {(onAction || onNavigate) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onAction) onAction();
            else if (onNavigate) onNavigate();
          }}
          className="shrink-0 p-1.5 sm:p-2 rounded-full transition-colors hover:bg-black/5 cursor-pointer"
          style={{ color }}
          aria-label="task options"
        >
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}

function SkillCard({ skill, percent, onClick, onEdit, onDelete }) {
  const [showMenu, setShowMenu] = useState(false);
  const Icon = getSkillIcon(skill.icon);

  const targetDayLabel = useMemo(() => {
    if (skill.targetDays && Array.isArray(skill.targetDays) && skill.targetDays.length > 0) {
      return skill.targetDays.map((d) => WEEKDAY_SHORT[d]).join(', ');
    }
    if (skill.targetDay !== undefined && skill.targetDay !== null) {
      return WEEKDAY_SHORT[skill.targetDay];
    }
    return null;
  }, [skill]);

  return (
    <div
      onClick={onClick}
      className="text-left rounded-2xl p-4 sm:p-5 transition-all hover:-translate-y-1 hover:shadow-md cursor-pointer flex flex-col justify-between w-full h-full relative group"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-xs" style={{ background: (skill.color || COLORS.tealMid) + '1F' }}>
            <Icon size={20} color={skill.color || COLORS.tealMid} />
          </div>

          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {targetDayLabel && (
              <span
                className="px-2.5 py-1 rounded-full text-[10px] font-extrabold flex items-center gap-1 shadow-2xs border"
                style={{
                  background: (skill.color || COLORS.tealDeep) + '18',
                  color: skill.color || COLORS.tealDeep,
                  borderColor: (skill.color || COLORS.tealDeep) + '35',
                }}
                title={`Assigned Target Day: ${targetDayLabel}`}
              >
                <Calendar size={10} /> Day: {targetDayLabel}
              </span>
            )}

            <div className="relative">
              <button
                onClick={() => setShowMenu((prev) => !prev)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                title="Options"
              >
                <MoreVertical size={16} />
              </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-8 z-20 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[110px]">
                  <button
                    onClick={() => { setShowMenu(false); onEdit(skill); }}
                    className="w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Settings size={13} /> Edit
                  </button>
                  <button
                    onClick={() => { setShowMenu(false); onDelete(skill.id); }}
                    className="w-full px-3 py-1.5 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
        <div style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="font-bold text-base sm:text-lg mb-1 leading-snug">
          {skill.name}
        </div>
        <div className="text-xs line-clamp-2 mb-4 font-medium" style={{ color: COLORS.muted }}>
          {skill.tagline}
        </div>
      </div>
      
      <div className="space-y-2 pt-3" style={{ borderTop: `1px dashed ${COLORS.border}` }}>
        <div className="flex items-center justify-between text-xs font-semibold">
          <span style={{ color: COLORS.muted }}>{percent}% complete</span>
          <span style={{ fontFamily: 'Fraunces, serif', color: skill.color || COLORS.tealMid }} className="text-base sm:text-lg font-bold">{percent}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: COLORS.border }}>
          <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${percent}%`, background: skill.color || COLORS.tealMid }} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- MOBILE PROFILE DRAWER ---------------------------------- */
function ProfileDrawer({ isOpen, onClose, view, setView, pendingMissedCount = 0 }) {
  const [darkMode, setDarkMode] = useState(false);

  if (!isOpen) return null;

  const navItems = [
    { id: 'today', label: 'Today Plan', icon: CalendarCheck },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'planner', label: 'Planner', icon: Calendar },
    { id: 'skills', label: 'Skills', icon: ListChecks },
    { id: 'history', label: 'History', icon: Flame },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity" onClick={onClose} />

      {/* Drawer Panel */}
      <div className="relative w-80 max-w-[85vw] bg-[#0B2624] text-[#F5F3EE] p-5 flex flex-col justify-between shadow-2xl z-50 h-full overflow-y-auto">
        <div className="space-y-6">
          {/* User Profile Info */}
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-amber-400/20 border border-amber-400/40 flex items-center justify-center font-bold text-amber-300 text-lg">
                H
              </div>
              <div>
                <div className="font-bold text-sm">Harsh</div>
                <div className="text-[11px] text-emerald-200/70">harsh@example.com</div>
              </div>
            </div>
            <button onClick={() => { setView('settings'); onClose(); }} className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10 cursor-pointer">
              <Edit3 size={16} />
            </button>
          </div>

          {/* Pro Member Gold Banner */}
          <div className="rounded-2xl p-3.5 bg-gradient-to-r from-amber-600/30 to-amber-400/20 border border-amber-400/40 space-y-1">
            <div className="flex items-center gap-2 font-bold text-xs text-amber-300">
              <span>👑 Pro Member</span>
            </div>
            <div className="text-[11px] text-amber-100/80">Keep going! 🚀</div>
          </div>

          {/* Nav List */}
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = view === item.id || (item.id === 'skills' && view === 'skill');
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setView(item.id);
                    onClose();
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-xs sm:text-sm font-semibold transition-all text-left cursor-pointer ${
                    isActive ? 'bg-[#123936] text-amber-300 shadow-xs border border-amber-400/30 font-bold' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <Icon size={18} className={isActive ? 'text-amber-300' : 'text-emerald-300/70'} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-white/10 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300 px-2">
            <div className="flex items-center gap-2">
              <Moon size={16} /> Dark Mode
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`w-10 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                darkMode ? 'bg-amber-400 justify-end' : 'bg-slate-600 justify-start'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white shadow-xs" />
            </button>
          </div>

          <button className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-slate-300 hover:text-white text-left cursor-pointer">
            <HelpCircle size={16} /> Help & Feedback
          </button>

          <button className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-bold text-red-400 hover:text-red-300 text-left cursor-pointer">
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- MOBILE BOTTOM NAVIGATION ---------------------------------- */
function MobileBottomNav({ view, setView }) {
  const tabs = [
    { id: 'today', label: 'Today', icon: CalendarCheck },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'planner', label: 'Planner', icon: Calendar },
    { id: 'skills', label: 'Skills', icon: ListChecks },
    { id: 'history', label: 'History', icon: Flame },
  ];

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0B2624] border-t border-white/10 px-2 py-1.5 flex items-center justify-around shadow-2xl">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = view === tab.id || (tab.id === 'skills' && view === 'skill');
        return (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            className="flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all cursor-pointer min-w-[56px]"
          >
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                isActive ? 'bg-[#C79A3E] text-[#123936] shadow-sm scale-105' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Icon size={18} />
            </div>
            <span
              className={`text-[10px] mt-0.5 font-medium transition-colors ${
                isActive ? 'text-[#C79A3E] font-extrabold' : 'text-slate-400'
              }`}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------- NAVBAR ---------------------------------- */
function NavBar({ view, setView, onOpenDrawer, pendingMissedCount = 0 }) {
  const items = [
    { id: 'today', label: 'Today Plan', icon: CalendarCheck },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'planner', label: 'Planner', icon: Calendar },
    { id: 'skills', label: 'Skills', icon: ListChecks },
    { id: 'history', label: 'History', icon: Flame },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];
  return (
    <div style={{ background: COLORS.tealDeep }} className="w-full sticky top-0 z-30 shadow-md">
      <div className="max-w-6xl mx-auto px-3.5 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-4">
        {/* Mobile Left Hamburger Menu Button */}
        <button
          onClick={onOpenDrawer}
          className="md:hidden p-1.5 rounded-xl text-emerald-100 hover:bg-white/10 transition-colors cursor-pointer"
          title="Open Profile Menu"
        >
          <Menu size={22} />
        </button>

        {/* Brand Logo */}
        <button onClick={() => setView('today')} className="flex items-center gap-2 shrink-0 cursor-pointer">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-400/20 flex items-center justify-center">
            <Sparkles size={17} color={COLORS.gold} />
          </div>
          <span style={{ fontFamily: 'Fraunces, serif', color: '#F5F3EE' }} className="text-base sm:text-xl font-bold tracking-wide">
            ASCEND
          </span>
        </button>

        {/* Desktop Navigation Tabs */}
        <div className="hidden md:flex items-center gap-1 sm:gap-2 overflow-x-auto py-0.5 no-scrollbar max-w-full">
          {items.map((it) => {
            const Icon = it.icon;
            const active = view === it.id || (it.id === 'skills' && view === 'skill');
            return (
              <button
                key={it.id}
                onClick={() => setView(it.id)}
                style={{
                  background: active ? COLORS.gold : 'transparent',
                  color: active ? COLORS.tealDeep : '#D9D5C7',
                }}
                className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-all whitespace-nowrap cursor-pointer hover:bg-white/10"
                title={it.label}
              >
                <Icon size={16} />
                <span>{it.label}</span>
              </button>
            );
          })}
        </div>

        {/* Mobile Right Notification Bell Icon */}
        <div className="md:hidden relative">
          <button
            onClick={() => setView('today')}
            className="p-1.5 rounded-xl text-emerald-100 hover:bg-white/10 transition-colors cursor-pointer relative"
            title="Notifications"
          >
            <Bell size={20} />
            {pendingMissedCount > 0 && (
              <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-[#123936]" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaglineBanner() {
  return (
    <div style={{ background: '#0B2624', borderBottom: '1px solid rgba(255,255,255,0.06)' }} className="w-full overflow-hidden">
      <style>{`
        @keyframes pingPongQuote {
          0% {
            left: 0%;
            transform: translateY(-50%) translateX(0%);
          }
          50% {
            left: 100%;
            transform: translateY(-50%) translateX(-100%);
          }
          100% {
            left: 0%;
            transform: translateY(-50%) translateX(0%);
          }
        }
        .quote-ping-pong {
          position: absolute;
          top: 50%;
          animation: pingPongQuote 26s ease-in-out infinite;
          white-space: nowrap;
          line-height: 1;
        }
        .quote-ping-pong:hover {
          animation-play-state: paused;
        }
      `}</style>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 relative h-8 sm:h-9 flex items-center overflow-hidden">
        <div className="quote-ping-pong flex items-center gap-2.5 cursor-pointer leading-none">
          <span style={{ fontFamily: 'Fraunces, serif', color: COLORS.goldLight }} className="italic font-semibold tracking-wide text-xs sm:text-sm leading-none">
            "Ya Toh Win Hai, Ya Learn Hai"
          </span>
          <span className="text-emerald-400/80 font-mono text-[10px] sm:text-[11px] hidden xs:inline leading-none">
            ● Dynamic Day Pairing & Custom Schedules Enabled
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- VIEWS ---------------------------------- */
function DashboardView({ skills, progress, overallPercent, streak, todayPercent, dayLabel, onOpenSkill, onGoToday, onAddSkill, onEditSkill, onDeleteSkill, dashboardPrefs }) {
  const [activeSubTab, setActiveSubTab] = useState('overview'); // 'overview' | 'habits' | 'productivity'

  const weeklyData = [
    { day: 'Mon', val: 60 },
    { day: 'Tue', val: 40 },
    { day: 'Wed', val: 80 },
    { day: 'Thu', val: 40 },
    { day: 'Fri', val: 0 },
    { day: 'Sat', val: 0 },
    { day: 'Sun', val: 0 },
  ];

  const categoryProgress = [
    { id: 'study', label: 'Study', percent: 70, icon: BookOpen, color: '#10B981' },
    { id: 'health', label: 'Health', percent: 50, icon: Heart, color: '#F97316' },
    { id: 'personal', label: 'Personal', percent: 60, icon: User, color: '#3B82F6' },
    { id: 'work', label: 'Work', percent: 40, icon: Briefcase, color: '#8B5CF6' },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Top Welcome & Sub-tabs Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl lg:text-3xl font-bold">
            Dashboard Overview
          </h1>
          <p className="text-xs sm:text-sm font-medium mt-0.5" style={{ color: COLORS.muted }}>
            Track overall progress, habits, and active learning roadmaps.
          </p>
        </div>

        {/* Sub-tabs Segmented Switcher */}
        <div className="flex items-center p-1 bg-slate-200/60 rounded-2xl shrink-0 self-start sm:self-auto">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'habits', label: 'Habits' },
            { id: 'productivity', label: 'Productivity' },
          ].map((tab) => {
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isActive ? 'bg-[#0d2b26] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Side-by-Side Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 sm:gap-5">
        {/* Stat 1: Day Streak */}
        <div className="rounded-2xl p-4 sm:p-5 bg-white border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-amber-500/15 flex items-center justify-center shrink-0">
            <Flame size={22} className="text-amber-500" />
          </div>
          <div>
            <div className="text-xl sm:text-3xl font-bold text-slate-800" style={{ fontFamily: 'Fraunces, serif' }}>
              {streak || 12}
            </div>
            <div className="text-[11px] sm:text-xs font-semibold text-slate-500">Day Streak</div>
          </div>
        </div>

        {/* Stat 2: Overall Progress */}
        <div className="rounded-2xl p-4 sm:p-5 bg-white border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Target size={22} className="text-emerald-600" />
          </div>
          <div>
            <div className="text-xl sm:text-3xl font-bold text-slate-800" style={{ fontFamily: 'Fraunces, serif' }}>
              {overallPercent || 68}%
            </div>
            <div className="text-[11px] sm:text-xs font-semibold text-slate-500">Overall Progress</div>
          </div>
        </div>

        {/* Stat 3: Today's Checklist */}
        <button
          onClick={onGoToday}
          className="col-span-2 sm:col-span-1 rounded-2xl p-4 sm:p-5 bg-white border border-slate-200 shadow-xs flex items-center gap-3.5 text-left hover:border-emerald-600 transition-all cursor-pointer"
        >
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-teal-500/15 flex items-center justify-center shrink-0">
            <CalendarCheck size={22} className="text-teal-700" />
          </div>
          <div>
            <div className="text-xl sm:text-3xl font-bold text-slate-800" style={{ fontFamily: 'Fraunces, serif' }}>
              {todayPercent}%
            </div>
            <div className="text-[11px] sm:text-xs font-semibold text-slate-500">Today's Checklist</div>
          </div>
        </button>
      </div>

      {/* Weekly Progress Bar Chart Section */}
      <div className="rounded-2xl p-4 sm:p-6 bg-white border border-slate-200 shadow-xs space-y-4">
        <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base font-bold">
          Weekly Progress
        </h3>
        <div className="h-44 sm:h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B', fontWeight: 600 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B' }} unit="%" domain={[0, 100]} />
              <Tooltip formatter={(value) => [`${value}%`, 'Completion']} contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0' }} />
              <Bar dataKey="val" radius={[8, 8, 0, 0]}>
                {weeklyData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.val > 0 ? '#10B981' : '#CBD5E1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Category Progress Horizontal Progress Bars */}
      <div className="rounded-2xl p-4 sm:p-6 bg-white border border-slate-200 shadow-xs space-y-4">
        <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base font-bold">
          Category Progress
        </h3>
        <div className="space-y-3.5">
          {categoryProgress.map((cat) => {
            const Icon = cat.icon;
            return (
              <div key={cat.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Icon size={16} style={{ color: cat.color }} />
                    <span>{cat.label}</span>
                  </div>
                  <span className="font-bold text-slate-900">{cat.percent}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Skill Roadmaps Grid Section */}
      <div>
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className="flex items-center gap-3">
            <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-lg sm:text-xl font-bold">
              Skill Roadmaps
            </h2>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-200/70 text-slate-700">
              {skills.length} Active Tracks
            </span>
          </div>
          <button
            onClick={onAddSkill}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-all hover:scale-[1.02]"
            style={{ background: COLORS.gold, color: COLORS.tealDeep }}
          >
            <Plus size={15} /> Add Skill
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              percent={skillPercent(skill, progress)}
              onClick={() => onOpenSkill(skill.id)}
              onEdit={onEditSkill}
              onDelete={onDeleteSkill}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- VOICE MULTI-TASK QUICK ADD -------------------------------- */
function fallbackParseTasks(transcript) {
  if (!transcript || !transcript.trim()) return [];
  const pattern = /phir|uske\s+baad|after\s+that|and\s+then|then|\baur\b|\band\b|[,.\n;]+/gi;
  const parts = transcript.split(pattern);
  const tasks = parts
    .map((p) => {
      let cleaned = p
        .replace(/\b(hai|karna|karne|padhna|padhne|jana|jane|hona|hone|matlab|ok|umm|pls|please)\b/gi, '')
        .trim();
      if (!cleaned) return '';
      return cleaned
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    })
    .filter((t) => t.length > 1);
  return tasks.length > 0 ? tasks : [transcript.trim()];
}

function VoiceMultiTaskButton({ onTasksParsed }) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const recognitionRef = useRef(null);
  const fullTranscriptRef = useRef('');

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  if (!HAS_SPEECH_RECOGNITION) return null;

  function startRecording() {
    setErrorMsg('');
    setTranscript('');
    fullTranscriptRef.current = '';

    try {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        setErrorMsg('Microphone access unavailable in this browser.');
        return;
      }

      const recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'hi-IN';

      recognition.onstart = () => {
        setRecording(true);
      };

      recognition.onresult = (event) => {
        let current = '';
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i] && event.results[i][0]) {
            current += event.results[i][0].transcript + ' ';
          }
        }
        fullTranscriptRef.current = current.trim();
        setTranscript(fullTranscriptRef.current);
      };

      recognition.onerror = (e) => {
        console.warn('Voice Multi-Task Speech error:', e);
        if (e.error === 'not-allowed' || e.error === 'permission-denied') {
          setErrorMsg('Microphone access denied. Please allow microphone permission.');
        }
        setRecording(false);
      };

      recognition.onend = () => {
        setRecording(false);
        if (fullTranscriptRef.current.trim()) {
          processTranscript(fullTranscriptRef.current.trim());
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.warn('Start voice recording failed:', e);
      setErrorMsg('Microphone error. Please try again.');
      setRecording(false);
    }
  }

  function stopRecording() {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setRecording(false);
  }

  async function processTranscript(rawText) {
    if (!rawText || !rawText.trim()) {
      setErrorMsg('Kuch sunayi nahi diya, dobara try karein');
      return;
    }

    setProcessing(true);
    try {
      const token = window.__authToken || localStorage.getItem('traject_token') || '';
      const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const res = await fetch(`${BASE}/ai/parse-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transcript: rawText }),
      });
      const data = await res.json();
      let parsed = data?.tasks;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        parsed = fallbackParseTasks(rawText);
      }
      if (parsed && parsed.length > 0) {
        onTasksParsed(parsed);
      } else {
        setErrorMsg('Kuch sunayi nahi diya, dobara try karein');
      }
    } catch (err) {
      console.warn('AI task parsing failed, using fallback:', err);
      const fallback = fallbackParseTasks(rawText);
      if (fallback && fallback.length > 0) {
        onTasksParsed(fallback);
      } else {
        setErrorMsg('Kuch sunayi nahi diya, dobara try karein');
      }
    } finally {
      setProcessing(false);
      setTranscript('');
      fullTranscriptRef.current = '';
    }
  }

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        disabled={processing}
        className={`w-full py-3 px-4 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md ${
          recording
            ? 'bg-red-600 text-white ring-4 ring-red-300 animate-pulse'
            : 'bg-red-500 text-white hover:bg-red-600 active:scale-95'
        }`}
        style={{
          background: recording ? '#DC2626' : 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)',
          boxShadow: recording ? '0 0 20px rgba(239, 68, 68, 0.6)' : '0 4px 12px rgba(239, 68, 68, 0.25)',
        }}
        title={recording ? 'Tap to finish voice recording' : 'Voice Quick Add — Speak full day plan'}
      >
        <div className="relative flex items-center justify-center">
          <Mic size={16} className={recording ? 'animate-bounce' : ''} />
          {recording && (
            <span className="absolute -inset-1 rounded-full bg-red-400/50 animate-ping" />
          )}
        </div>
        <span className="truncate">
          {recording ? 'Stop Recording (Processing Tasks) ⏹' : '🎙 Voice Quick Add (Say All Tasks)'}
        </span>
      </button>

      {recording && (
        <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-700">
            <span className="w-2 h-2 rounded-full bg-red-600 animate-ping shrink-0" />
            <span>Listening... Speak day plan ("Gym, phir college, uske baad SQL...")</span>
          </div>
          {transcript && (
            <div className="text-[11px] text-red-900 bg-white p-2 rounded-lg border border-red-100 italic truncate max-h-16 overflow-y-auto">
              "{transcript}"
            </div>
          )}
        </div>
      )}

      {processing && (
        <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800">
          <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-600/30 border-t-emerald-700 rounded-full animate-spin shrink-0" />
          <span>Ascend AI is segmenting your tasks...</span>
        </div>
      )}

      {errorMsg && (
        <div className="text-[11px] font-semibold text-red-700 bg-red-50 p-2 rounded-xl border border-red-200 flex items-center justify-between gap-1">
          <span className="truncate">⚠ {errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="text-red-500 hover:text-red-700 p-0.5 shrink-0">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function VoiceTasksPreviewModal({ isOpen, tasks, onClose, onConfirm }) {
  const [draftTasks, setDraftTasks] = useState([]);

  useEffect(() => {
    if (tasks && Array.isArray(tasks)) {
      setDraftTasks(tasks.map((t) => (typeof t === 'string' ? t : t.title || '')));
    }
  }, [tasks, isOpen]);

  if (!isOpen) return null;

  function handleUpdateTask(index, val) {
    setDraftTasks((prev) => prev.map((item, i) => (i === index ? val : item)));
  }

  function handleRemoveTask(index) {
    setDraftTasks((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAddEmptyRow() {
    setDraftTasks((prev) => [...prev, '']);
  }

  function handleSave() {
    const valid = draftTasks.map((t) => t.trim()).filter(Boolean);
    if (valid.length > 0) {
      onConfirm(valid);
    }
    onClose();
  }

  const validCount = draftTasks.filter((t) => t.trim()).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: COLORS.border }}>
          <div>
            <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-lg font-bold flex items-center gap-2">
              <Sparkles size={18} className="text-amber-500" /> Confirm Voice Tasks ({validCount})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Review, edit, or delete tasks before adding to Today's Action Items.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
          {draftTasks.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-400 font-medium bg-slate-50 rounded-xl border border-dashed">
              No tasks remaining. Click "+ Add Item" below to add custom tasks.
            </div>
          ) : (
            draftTasks.map((taskText, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                <span className="text-xs font-bold text-slate-400 w-5 text-right shrink-0">{idx + 1}.</span>
                <input
                  type="text"
                  value={taskText}
                  onChange={(e) => handleUpdateTask(idx, e.target.value)}
                  placeholder="Task title..."
                  className="flex-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg outline-none bg-white border border-slate-200"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveTask(idx)}
                  className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 cursor-pointer shrink-0"
                  title="Remove task"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={handleAddEmptyRow}
          className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 cursor-pointer"
        >
          <Plus size={13} /> Add Another Task Item
        </button>

        <div className="flex justify-end gap-3 pt-3 border-t" style={{ borderColor: COLORS.border }}>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={validCount === 0}
            className="px-5 py-2 rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-all hover:scale-[1.02]"
            style={{ background: COLORS.gold, color: COLORS.tealDeep, opacity: validCount === 0 ? 0.5 : 1 }}
          >
            Confirm & Add All ({validCount})
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskDetailModal({ isOpen, activeItem, skills, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState('');
  const [skill, setSkill] = useState('personal');
  const [duration, setDuration] = useState('');

  useEffect(() => {
    if (activeItem && activeItem.task) {
      setTitle(activeItem.task.title || '');
      setSkill(activeItem.task.skill || 'personal');
      setDuration(activeItem.task.duration || activeItem.task.time || '');
    }
  }, [activeItem, isOpen]);

  if (!isOpen || !activeItem) return null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      skill: skill || 'personal',
      duration: duration.trim(),
      time: duration.trim() || 'Extra Task',
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div
        className="bg-white rounded-3xl p-5 sm:p-6 max-w-sm w-full shadow-2xl border border-slate-200 space-y-4 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-2.5" style={{ borderColor: COLORS.border }}>
          <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base font-bold flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-teal-700" /> Task Options & Details
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-bold mb-1" style={{ color: COLORS.ink }}>Task Title</label>
            <div className="flex items-center gap-1.5">
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Gym / Power BI Study"
                className="w-full text-xs font-semibold px-3 py-2 rounded-xl outline-none"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              />
              <MicButton fieldName="Task Title" currentValue={title} onAppendText={setTitle} />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-1" style={{ color: COLORS.ink }}>Skill / Category</label>
            <select
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-xl outline-none font-medium"
              style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
            >
              <option value="personal">Personal / General (No Skill)</option>
              {skills && skills.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-1" style={{ color: COLORS.ink }}>Duration / Details (Hours/Time)</label>
            <div className="flex items-center gap-1.5">
              <input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g. 30 min, 1 hr, 7:00 AM"
                className="w-full text-xs px-3 py-2 rounded-xl outline-none"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              />
              <MicButton fieldName="Duration" currentValue={duration} onAppendText={setDuration} />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t" style={{ borderColor: COLORS.border }}>
            <button
              type="button"
              onClick={onDelete}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 cursor-pointer flex items-center gap-1 transition-all active:scale-95 shrink-0"
              title="Delete this task"
            >
              <Trash2 size={13} /> Delete
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4.5 py-2 rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-all hover:scale-[1.02]"
                style={{ background: COLORS.gold, color: COLORS.tealDeep }}
              >
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------------------------- ADD NEW TASK MODAL ---------------------------------- */
function AddNewTaskModal({ isOpen, onClose, onAddTask, skills = [] }) {
  const [activeTab, setActiveTab] = useState('manual'); // 'manual' | 'voice'
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Personal');
  const [dateStr, setDateStr] = useState('Today, 25 Sept');
  const [priority, setPriority] = useState('Medium'); // 'Low', 'Medium', 'High'
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const categories = [
    { id: 'Personal', label: 'Personal', icon: User, color: '#0d2b26' },
    { id: 'Study', label: 'Study', icon: BookOpen, color: '#10B981' },
    { id: 'Health', label: 'Health', icon: Heart, color: '#EF4444' },
    { id: 'Work', label: 'Work', icon: Briefcase, color: '#3B82F6' },
    ...(skills || []).map((s) => ({
      id: s.id || s.name,
      label: s.name,
      icon: getSkillIcon(s.icon),
      color: s.color || '#1F6F68',
    })),
  ];

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onAddTask({
      title: title.trim(),
      skill: category.toLowerCase(),
      time: time.trim() || undefined,
      duration: time.trim() || undefined,
      priority,
      notes: notes.trim(),
      date: dateStr,
    });
    setTitle('');
    setTime('');
    setNotes('');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs">
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="w-12 h-1 bg-slate-300 rounded-full mx-auto sm:hidden mb-1" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: COLORS.border }}>
          <h3 style={{ fontFamily: 'Fraunces, serif', color: '#0d2b26' }} className="text-lg font-bold">
            Add New Task
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer">
            <X size={20} />
          </button>
        </div>

        {/* Manual Add / Voice Add Toggle Tabs */}
        <div className="flex items-center p-1 bg-slate-100 rounded-2xl">
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'manual' ? 'bg-[#0d2b26] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Edit3 size={15} /> Manual Add
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('voice')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'voice' ? 'bg-[#0d2b26] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mic size={15} /> Voice Add
          </button>
        </div>

        {activeTab === 'manual' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Task Title */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Task Title</label>
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-slate-400">
                  <User size={16} />
                </div>
                <input
                  required
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Read 1 Chapter"
                  className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs sm:text-sm outline-none focus:border-[#0d2b26] transition-colors"
                />
                <div className="absolute right-3">
                  <MicButton fieldName="Task Title" currentValue={title} onAppendText={setTitle} />
                </div>
              </div>
            </div>

            {/* Category Chips */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Category</label>
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                {categories.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = category.toLowerCase() === cat.label.toLowerCase() || category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.label)}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all border cursor-pointer ${
                        isSelected
                          ? 'bg-[#0d2b26] text-white border-[#0d2b26] shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Icon size={14} className={isSelected ? 'text-amber-300' : 'text-slate-500'} />
                      <span>{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Date</label>
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-slate-400">
                  <Calendar size={16} />
                </div>
                <input
                  type="text"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs sm:text-sm outline-none focus:border-[#0d2b26]"
                />
              </div>
            </div>

            {/* Priority Pills */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Priority</label>
              <div className="flex items-center gap-2">
                {[
                  { id: 'Low', label: 'Low', dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300' },
                  { id: 'Medium', label: 'Medium', dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300' },
                  { id: 'High', label: 'High', dot: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300' },
                ].map((p) => {
                  const isSel = priority === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPriority(p.id)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-2xl text-xs font-bold border transition-all cursor-pointer ${
                        isSel ? `${p.bg} ${p.text} ${p.border} ring-1 ring-current` : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${p.dot}`} />
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time (Optional) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Time (Optional)</label>
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-slate-400">
                  <Clock size={16} />
                </div>
                <input
                  type="text"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  placeholder="e.g. 2:00 PM"
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs sm:text-sm outline-none focus:border-[#0d2b26]"
                />
              </div>
            </div>

            {/* Notes (Optional) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Notes (Optional)</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes..."
                className="w-full p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs sm:text-sm outline-none focus:border-[#0d2b26] resize-none"
              />
            </div>

            {/* Sticky Bottom Add Task Button */}
            <div className="pt-2">
              <button
                type="submit"
                className="w-full py-3.5 rounded-2xl bg-[#0d2b26] hover:bg-[#123936] text-white font-bold text-sm shadow-md transition-all cursor-pointer active:scale-98"
              >
                Add Task
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 text-center py-4">
            <p className="text-xs text-slate-600">Speak all your tasks in one go (e.g. "College, Gym at 6pm, Read OS Notes").</p>
            <div className="flex justify-center">
              <VoiceMultiTaskButton
                onTasksParsed={(tasks) => {
                  if (typeof onAddTask === 'function') {
                    tasks.forEach((t) => onAddTask({ title: typeof t === 'string' ? t : t.title, skill: 'personal' }));
                  }
                  onClose();
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- TODAY VIEW ---------------------------------- */
function TodayView({
  template,
  daily,
  onToggle,
  todayPercent,
  dateStr,
  onNavigateSkill,
  onViewHistory,
  missedTasks,
  catchup,
  onToggleCatchup,
  skillsById,
  extraTasks,
  onAddExtraTask,
  onAddMultipleExtraTasks,
  onEditExtraTask,
  onDeleteExtraTask,
  onEditTemplateTask,
  onDeleteTemplateTask,
  skills,
  onOpenAddNewTask,
}) {
  const pendingMissed = missedTasks ? missedTasks.filter((m) => !catchup[`${m.date}|${m.task.id}`]).length : 0;
  const [showAddInline, setShowAddInline] = useState(false);
  const [extraTitle, setExtraTitle] = useState('');
  const [extraSkill, setExtraSkill] = useState('personal');
  const [extraDuration, setExtraDuration] = useState('');

  // Voice multi-task preview state
  const [voiceParsedTasks, setVoiceParsedTasks] = useState([]);
  const [showVoicePreviewModal, setShowVoicePreviewModal] = useState(false);

  // Task Edit/Delete Modal State
  const [activeTaskModal, setActiveTaskModal] = useState(null); // { task, isExtra }

  function handleOpenTaskModal(task, isExtra) {
    setActiveTaskModal({ task, isExtra });
  }

  function handleCloseTaskModal() {
    setActiveTaskModal(null);
  }

  function handleSaveTaskModal(updatedData) {
    if (!activeTaskModal) return;
    const { task, isExtra } = activeTaskModal;
    if (isExtra) {
      if (typeof onEditExtraTask === 'function') onEditExtraTask(task.id, updatedData);
    } else {
      if (typeof onEditTemplateTask === 'function') onEditTemplateTask(task.id, updatedData);
    }
    setActiveTaskModal(null);
  }

  function handleDeleteTaskModal() {
    if (!activeTaskModal) return;
    const { task, isExtra } = activeTaskModal;
    if (isExtra) {
      if (typeof onDeleteExtraTask === 'function') onDeleteExtraTask(task.id);
    } else {
      if (typeof onDeleteTemplateTask === 'function') onDeleteTemplateTask(task.id);
    }
    setActiveTaskModal(null);
  }

  function handleVoiceTasksParsed(tasks) {
    setVoiceParsedTasks(tasks);
    setShowVoicePreviewModal(true);
  }

  function handleConfirmVoiceTasks(tasksList) {
    if (typeof onAddMultipleExtraTasks === 'function') {
      onAddMultipleExtraTasks(tasksList);
    } else {
      tasksList.forEach((t) => {
        onAddExtraTask({
          title: t,
          skill: 'personal',
          duration: '',
        });
      });
    }
  }

  function handleCreateExtra(e) {
    e.preventDefault();
    if (!extraTitle.trim()) return;
    onAddExtraTask({
      title: extraTitle.trim(),
      skill: extraSkill || 'personal',
      duration: extraDuration.trim(),
    });
    setExtraTitle('');
    setExtraDuration('');
    setExtraSkill('personal');
    setShowAddInline(false);
  }

  const totalTasksCount = (template.tasks ? template.tasks.length : 0) + (extraTasks ? extraTasks.length : 0);
  const doneTasksCount = (template.tasks ? template.tasks.filter((t) => daily[t.id]).length : 0) + (extraTasks ? extraTasks.filter((t) => daily[t.id]).length : 0);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Dark Green Summary Card */}
      <div className="rounded-3xl p-5 sm:p-8 shadow-lg text-white" style={{ background: '#0d2b26' }}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div style={{ fontFamily: 'Fraunces, serif' }} className="text-xl sm:text-3xl font-bold">
              {dateStr}
            </div>
            <div className="text-xs font-medium text-emerald-200/80 mt-1">
              {doneTasksCount}/{totalTasksCount} completed today
            </div>
          </div>
          <div className="flex items-center gap-3 bg-white/10 px-4 py-2.5 rounded-2xl border border-white/10">
            <div className="text-right">
              <div className="text-xl sm:text-2xl font-bold text-amber-300" style={{ fontFamily: 'Fraunces, serif' }}>
                {todayPercent}%
              </div>
              <div className="text-[10px] text-emerald-100/70">completed today</div>
            </div>
            <ProgressRing percent={todayPercent} size={50} stroke={5} color="#C79A3E" />
          </div>
        </div>
        {/* Full-width progress bar */}
        <div className="h-2.5 rounded-full overflow-hidden mt-5 bg-black/30">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${todayPercent}%`, background: '#C79A3E' }} />
        </div>
      </div>

      {/* Today's Action Items Header & Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base sm:text-lg font-bold">
            Today's Action Items
          </h3>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
            {totalTasksCount} {totalTasksCount === 1 ? 'task' : 'tasks'}
          </span>
        </div>

        {template.tasks.map((task) => {
          const skill = task.skill && task.skill !== 'personal' ? skillsById[task.skill] : null;
          const skillName = skill ? skill.name : task.skill === 'personal' || !task.skill ? 'Personal' : task.skill;
          const meta = [task.time, task.duration, skillName].filter(Boolean).join(' · ');
          return (
            <TaskRow
              key={task.id}
              title={task.title}
              subtitle={meta}
              done={!!daily[task.id]}
              onToggle={() => onToggle(task.id)}
              color={skill?.color || COLORS.tealMid}
              onAction={() => handleOpenTaskModal(task, false)}
            />
          );
        })}

        {extraTasks &&
          extraTasks.map((task) => {
            const skill = task.skill && task.skill !== 'personal' ? skillsById[task.skill] : null;
            const skillName = skill ? skill.name : task.skill === 'personal' || !task.skill ? 'Personal' : task.skill;
            const meta = ['Today Extra', task.duration, skillName].filter(Boolean).join(' · ');
            return (
              <TaskRow
                key={task.id}
                title={task.title}
                subtitle={meta}
                done={!!daily[task.id]}
                onToggle={() => onToggle(task.id)}
                color={skill?.color || COLORS.tealMid}
                onAction={() => handleOpenTaskModal(task, true)}
              />
            );
          })}

        {template.tasks.length === 0 && (!extraTasks || extraTasks.length === 0) && (
          <div className="text-center py-6 px-4 rounded-2xl border border-dashed bg-slate-50/50" style={{ borderColor: COLORS.border }}>
            <p className="text-xs sm:text-sm font-medium text-slate-500">
              No tasks scheduled for today yet. Tap "+ Add Task" below to add a new task!
            </p>
          </div>
        )}

        {/* Action Buttons: Dashed + Add Task & Full-width Red Voice Quick Add */}
        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <button
            onClick={onOpenAddNewTask || (() => setShowAddInline(true))}
            className="flex-1 py-3.5 rounded-2xl border-2 border-dashed flex items-center justify-center gap-2 text-xs sm:text-sm font-bold transition-all hover:bg-amber-50/50 cursor-pointer"
            style={{ borderColor: COLORS.gold, color: COLORS.tealDeep }}
          >
            <Plus size={18} /> Add Task
          </button>

          <VoiceMultiTaskButton onTasksParsed={handleVoiceTasksParsed} />
        </div>

        {showAddInline && !onOpenAddNewTask && (
          <form onSubmit={handleCreateExtra} className="rounded-2xl p-4 sm:p-5 border space-y-3 bg-white shadow-xs" style={{ borderColor: COLORS.gold }}>
            <div className="flex items-center justify-between font-bold text-xs" style={{ color: COLORS.ink }}>
              <span>Add Today's Extra Task</span>
              <button type="button" onClick={() => setShowAddInline(false)} className="text-slate-400 hover:text-slate-600">
                <X size={15} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                required
                value={extraTitle}
                onChange={(e) => setExtraTitle(e.target.value)}
                placeholder="Task Title e.g. Extra BA Practice Session or Gym"
                className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-xl outline-none"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              />
              <MicButton fieldName="Task Title" currentValue={extraTitle} onAppendText={setExtraTitle} />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={extraSkill}
                onChange={(e) => setExtraSkill(e.target.value)}
                className="text-xs px-3 py-2 rounded-xl outline-none flex-1 min-w-[130px] font-medium"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              >
                <option value="personal">Personal / General (No Skill)</option>
                {skills &&
                  skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <div className="flex items-center gap-1.5 flex-1 min-w-[140px]">
                <input
                  value={extraDuration}
                  onChange={(e) => setExtraDuration(e.target.value)}
                  placeholder="Duration e.g. 30 min (optional)"
                  className="w-full text-xs px-3 py-2 rounded-xl outline-none"
                  style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
                />
                <MicButton fieldName="Duration" currentValue={extraDuration} onAppendText={setExtraDuration} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddInline(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
                style={{ background: COLORS.gold, color: COLORS.tealDeep }}
              >
                Add Task
              </button>
            </div>
          </form>
        )}
      </div>

      <VoiceTasksPreviewModal
        isOpen={showVoicePreviewModal}
        tasks={voiceParsedTasks}
        onClose={() => setShowVoicePreviewModal(false)}
        onConfirm={handleConfirmVoiceTasks}
      />

      <TaskDetailModal
        isOpen={!!activeTaskModal}
        activeItem={activeTaskModal}
        skills={skills}
        onClose={handleCloseTaskModal}
        onSave={handleSaveTaskModal}
        onDelete={handleDeleteTaskModal}
      />

      {/* Missed from Previous Days Collapsible Section */}
      {missedTasks && missedTasks.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-slate-200">
          <div className="flex items-center gap-2 flex-wrap justify-between">
            <div>
              <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base sm:text-lg font-bold">
                Missed from Previous Days
              </h3>
              <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                Catch-up and complete pending tasks from previous days.
              </p>
            </div>
            <span
              className="text-xs px-3 py-1 rounded-full font-bold shadow-xs"
              style={{
                background: pendingMissed > 0 ? '#FEE2E2' : '#DCFCE7',
                color: pendingMissed > 0 ? '#B9C4C0' : '#15803D',
              }}
            >
              {pendingMissed} Pending
            </span>
          </div>

          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {missedTasks.map((m) => {
              const skill = skillsById[m.task.skill];
              const key = `${m.date}|${m.task.id}`;
              return (
                <TaskRow
                  key={key}
                  title={m.task.title}
                  subtitle={`${m.dateLabel} · ${skill?.name || 'Personal'}`}
                  done={!!catchup[key]}
                  onToggle={() => onToggleCatchup(m.date, m.task.id)}
                  color={skill?.color || COLORS.tealMid}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={onViewHistory}
          className="text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all hover:gap-2 cursor-pointer"
          style={{ color: COLORS.tealMid }}
        >
          View full weekly schedule & performance history <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------- PLANNER VIEW -------------------------------- */
function PlannerView({ plannerEvents, onAddEvent, onDeleteEvent, onToggleEvent, onOpenAddNewTask }) {
  const [plannerTab, setPlannerTab] = useState('day'); // 'day' | 'week' | 'month'
  const [currentMonthDate, setCurrentMonthDate] = useState(() => new Date());
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(new Date()));
  const [selectedDayOffset, setSelectedDayOffset] = useState(3); // default Thu 25 / Thursday
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00 AM');
  const [category, setCategory] = useState('Study');
  const [enableNotification, setEnableNotification] = useState(true);

  // Days strip for Mon-Sun
  const weekDaysStrip = [
    { dayName: 'Mon', dateNum: 22, fullDate: 'Monday, 22 September', key: '2026-09-22' },
    { dayName: 'Tue', dateNum: 23, fullDate: 'Tuesday, 23 September', key: '2026-09-23' },
    { dayName: 'Wed', dateNum: 24, fullDate: 'Wednesday, 24 September', key: '2026-09-24' },
    { dayName: 'Thu', dateNum: 25, fullDate: 'Thursday, 25 September', key: '2026-09-25' },
    { dayName: 'Fri', dateNum: 26, fullDate: 'Friday, 26 September', key: '2026-09-26' },
    { dayName: 'Sat', dateNum: 27, fullDate: 'Saturday, 27 September', key: '2026-09-27' },
    { dayName: 'Sun', dateNum: 28, fullDate: 'Sunday, 28 September', key: '2026-09-28' },
  ];

  const currentSelectedDay = weekDaysStrip[selectedDayOffset] || weekDaysStrip[3];

  const sampleTimelineTasks = [
    { id: 't1', time: '08:00 AM', title: 'College', category: 'Personal', done: true, color: '#10B981' },
    { id: 't2', time: '02:00 PM', title: 'Read OS Notes', category: 'Study', done: false, color: '#F59E0B' },
    { id: 't3', time: '06:00 PM', title: 'Gym Workout', category: 'Health', done: false, color: '#EF4444' },
    { id: 't4', time: '08:00 PM', title: 'Build Starter UI', category: 'Work', done: false, color: '#3B82F6' },
    { id: 't5', time: '10:00 PM', title: 'Meditation', category: 'Personal', done: false, color: '#8B5CF6' },
  ];

  const daysInMonth = useMemo(() => {
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }
    for (let d = 1; d <= totalDays; d++) {
      const dateObj = new Date(year, month, d);
      days.push({
        dateObj,
        key: dateKey(dateObj),
        dayNum: d,
      });
    }
    return days;
  }, [currentMonthDate]);

  function handleCreateEvent(e) {
    e.preventDefault();
    if (!title.trim()) return;

    const newEvt = {
      id: `evt-${Date.now()}`,
      dateKey: selectedDateKey,
      title: title.trim(),
      time: time.trim() || '09:00 AM',
      category,
      done: false,
      enableNotification,
    };

    onAddEvent(newEvt);
    setTitle('');
    setShowAddForm(false);
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Top Bar (Mobile Reference Screen 4) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChevronLeft size={20} className="text-slate-700 cursor-pointer sm:hidden" />
          <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl font-bold">
            Planner
          </h2>
        </div>
        <button
          onClick={onOpenAddNewTask || (() => setShowAddForm(true))}
          className="w-9 h-9 rounded-full bg-amber-400 text-[#0d2b26] flex items-center justify-center font-bold shadow-xs hover:scale-105 active:scale-95 transition-all cursor-pointer"
          title="Add New Task"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Segmented Control Switcher (Day | Week | Month) */}
      <div className="flex items-center p-1 bg-slate-200/70 rounded-2xl max-w-sm">
        {['Day', 'Week', 'Month'].map((tab) => {
          const id = tab.toLowerCase();
          const isActive = plannerTab === id;
          return (
            <button
              key={id}
              onClick={() => setPlannerTab(id)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                isActive ? 'bg-[#0d2b26] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {plannerTab === 'day' && (
        <div className="space-y-5">
          {/* Horizontal Scrollable Day Strip (Mon-Sun) */}
          <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar py-1">
            {weekDaysStrip.map((item, idx) => {
              const isSelected = selectedDayOffset === idx;
              return (
                <button
                  key={item.dayName}
                  onClick={() => {
                    setSelectedDayOffset(idx);
                    setSelectedDateKey(item.key);
                  }}
                  className={`flex flex-col items-center justify-center min-w-[52px] py-2.5 rounded-2xl transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-[#0d2b26] text-white border-[#0d2b26] shadow-md scale-105'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[11px] font-semibold opacity-80">{item.dayName}</span>
                  <span className={`text-base font-bold mt-0.5 ${isSelected ? 'text-amber-300' : ''}`}>{item.dateNum}</span>
                </button>
              );
            })}
          </div>

          {/* Date Subheader */}
          <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base font-bold pt-1">
            {currentSelectedDay.fullDate}
          </h3>

          {/* Time Timeline Cards List */}
          <div className="space-y-3 relative pl-2">
            {/* Vertical timeline line */}
            <div className="absolute left-[78px] top-3 bottom-3 w-0.5 bg-slate-200 z-0" />

            {sampleTimelineTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3 relative z-10">
                {/* Time label */}
                <div className="w-16 text-[11px] font-bold text-slate-500 shrink-0 text-right">{task.time}</div>

                {/* Status Dot */}
                <div
                  className="w-3.5 h-3.5 rounded-full ring-4 ring-white shrink-0 z-10"
                  style={{ backgroundColor: task.done ? '#10B981' : task.color }}
                />

                {/* Task Card */}
                <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-3.5 flex items-center justify-between shadow-2xs hover:shadow-xs transition-all">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button className="cursor-pointer shrink-0">
                      {task.done ? <CheckCircle2 size={20} color="#10B981" /> : <Circle size={20} color="#94A3B8" />}
                    </button>
                    <div className="min-w-0">
                      <div className={`text-xs sm:text-sm font-bold truncate ${task.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                        {task.title}
                      </div>
                      <div className="text-[10px] font-medium text-slate-500 mt-0.5">{task.category}</div>
                    </div>
                  </div>
                  <button className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer">
                    <MoreVertical size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Motivation Banner Card */}
          <div className="rounded-2xl p-4 bg-emerald-50 border border-emerald-200/80 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-400/30 flex items-center justify-center shrink-0">
              <Sparkles size={18} className="text-amber-700" />
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-900">Stay Consistent!</div>
              <div className="text-[11px] text-emerald-700 font-medium mt-0.5">Small steps every day lead to big results.</div>
            </div>
          </div>
        </div>
      )}

      {(plannerTab === 'month' || plannerTab === 'week') && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl p-4 sm:p-6 bg-white border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-5">
              <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-lg font-bold">
                {currentMonthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1))}
                  className="p-1.5 rounded-xl hover:bg-slate-100 border border-slate-200 cursor-pointer"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={() => setCurrentMonthDate(new Date())}
                  className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 cursor-pointer"
                >
                  Today
                </button>
                <button
                  onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1))}
                  className="p-1.5 rounded-xl hover:bg-slate-100 border border-slate-200 cursor-pointer"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs mb-2 text-slate-500">
              {WEEKDAY_SHORT.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {daysInMonth.map((dayItem, idx) => {
                if (!dayItem) return <div key={`empty-${idx}`} className="aspect-square rounded-xl opacity-0" />;
                const isSelected = dayItem.key === selectedDateKey;
                const isToday = dayItem.key === dateKey(new Date());
                const dayEvts = (plannerEvents || []).filter((e) => e.dateKey === dayItem.key);
                const hasEvts = dayEvts.length > 0;

                return (
                  <button
                    key={dayItem.key}
                    onClick={() => setSelectedDateKey(dayItem.key)}
                    className={`aspect-square rounded-xl p-1 sm:p-2 flex flex-col items-center justify-between transition-all cursor-pointer relative ${
                      isSelected ? 'ring-2 ring-emerald-700 shadow-sm' : 'hover:bg-slate-50'
                    }`}
                    style={{
                      background: isSelected ? COLORS.tealDeep : isToday ? COLORS.gold + '22' : COLORS.bg,
                      color: isSelected ? '#F5F3EE' : COLORS.ink,
                      border: `1px solid ${isToday ? COLORS.gold : COLORS.border}`,
                    }}
                  >
                    <span className="text-xs sm:text-sm font-bold">{dayItem.dayNum}</span>
                    {hasEvts && (
                      <div className="flex items-center gap-0.5">
                        {dayEvts.slice(0, 3).map((_, eIdx) => (
                          <span key={eIdx} className="w-1.5 h-1.5 rounded-full" style={{ background: isSelected ? COLORS.gold : COLORS.tealMid }} />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillsGridView({ skills, progress, onOpenSkill, onAddSkill, onEditSkill, onDeleteSkill }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl font-bold mb-1">All Skill Roadmaps</h2>
          <p className="text-xs sm:text-sm" style={{ color: COLORS.muted }}>Track detailed step-by-step progress across all your active learning modules.</p>
        </div>
        <button
          onClick={onAddSkill}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-xs cursor-pointer transition-all hover:scale-[1.02]"
          style={{ background: COLORS.gold, color: COLORS.tealDeep }}
        >
          <Plus size={16} /> Add Skill
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
        {skills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            percent={skillPercent(skill, progress)}
            onClick={() => onOpenSkill(skill.id)}
            onEdit={onEditSkill}
            onDelete={onDeleteSkill}
          />
        ))}
      </div>
    </div>
  );
}

const PRESET_COLORS = ['#1F6F68', '#C79A3E', '#4E9E93', '#A67C27', '#2D5F5A', '#D4AF6A', '#0F3331', '#B0453A', '#9333EA', '#2563EB'];

function MicButton({ fieldName, currentValue, onAppendText }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const baseTextRef = useRef('');

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  if (!HAS_SPEECH_RECOGNITION) return null;

  function toggleListening() {
    if (listening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      setListening(false);
      return;
    }

    try {
      if (!SpeechRecognition) {
        setListening(false);
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      baseTextRef.current = currentValue || '';

      recognition.onstart = () => {
        setListening(true);
      };

      recognition.onresult = (event) => {
        try {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i] && event.results[i][0]) {
              transcript += event.results[i][0].transcript;
            }
          }
          const base = baseTextRef.current;
          const newText = base ? `${base.trim()} ${transcript.trim()}` : transcript.trim();
          if (typeof onAppendText === 'function') {
            onAppendText(newText);
          }
        } catch (err) {
          console.warn('Speech recognition result error:', err);
        }
      };

      recognition.onerror = (e) => {
        console.warn('SpeechRecognition error:', e);
        setListening(false);
      };

      recognition.onend = () => {
        setListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.warn('SpeechRecognition start failed:', e);
      setListening(false);
    }
  }

  try {
    return (
      <button
        type="button"
        onClick={toggleListening}
        className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center shrink-0 ${
          listening
            ? 'bg-red-500 text-white animate-pulse shadow-xs ring-2 ring-red-300'
            : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600 border border-slate-200'
        }`}
        title={listening ? 'Stop listening' : `Voice input for ${fieldName || 'field'}`}
      >
        <Mic size={14} />
      </button>
    );
  } catch {
    return null;
  }
}

/**
 * AiMicButton — voice input for the Ascend AI prompt.
 * Listens until the user stops speaking, then auto-submits for generation.
 */
function AiMicButton({ onTranscript, onAutoSubmit, disabled }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef('');

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  if (!HAS_SPEECH_RECOGNITION) return null;

  function startListening() {
    if (disabled || listening) return;
    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;      // stop after one utterance
      recognition.interimResults = true;
      recognition.lang = 'en-IN';          // works for both Hindi + English
      finalTranscriptRef.current = '';

      recognition.onstart = () => setListening(true);

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        finalTranscriptRef.current = final || interim;
        if (typeof onTranscript === 'function') {
          onTranscript(finalTranscriptRef.current);
        }
      };

      recognition.onerror = (e) => {
        console.warn('AiMic error:', e);
        setListening(false);
      };

      recognition.onend = () => {
        setListening(false);
        // Auto-submit once speech ends if we got a transcript
        if (finalTranscriptRef.current.trim() && typeof onAutoSubmit === 'function') {
          onAutoSubmit(finalTranscriptRef.current.trim());
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.warn('AiMic start failed:', e);
      setListening(false);
    }
  }

  function stopListening() {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setListening(false);
  }

  return (
    <button
      type="button"
      onClick={listening ? stopListening : startListening}
      disabled={disabled && !listening}
      className={`flex items-center justify-center shrink-0 transition-all cursor-pointer ${
        listening
          ? 'w-9 h-9 rounded-full bg-red-500 text-white shadow-lg ring-4 ring-red-300/60 animate-pulse'
          : 'w-9 h-9 rounded-xl border-2 text-white hover:scale-105 active:scale-95'
      }`}
      style={listening ? {} : {
        background: 'linear-gradient(135deg, #1F6F68 0%, #123936 100%)',
        borderColor: '#1F6F68',
        boxShadow: '0 2px 8px rgba(31,111,104,0.30)',
      }}
      title={listening ? 'Tap to stop — will auto-generate' : 'Speak your skill (auto-generates)'}
    >
      <Mic size={15} />
    </button>
  );
}

function SkillModal({ isOpen, onClose, onSave, editingSkill }) {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [icon, setIcon] = useState('Code2');
  const [color, setColor] = useState('#1F6F68');
  const [steps, setSteps] = useState([]);
  const [targetDays, setTargetDays] = useState([]);

  // AI generation state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiSubmitRef = useRef(null); // used by AiMicButton to trigger submit

  useEffect(() => {
    if (editingSkill) {
      setName(editingSkill.name || '');
      setTagline(editingSkill.tagline || '');
      setIcon(editingSkill.icon || 'Code2');
      setColor(editingSkill.color || '#1F6F68');
      setSteps(editingSkill.steps ? editingSkill.steps.map((s) => ({ ...s })) : []);
      setTargetDays(editingSkill.targetDays || (editingSkill.targetDay !== undefined && editingSkill.targetDay !== null ? [editingSkill.targetDay] : []));
    } else {
      setName('');
      setTagline('');
      setIcon('Code2');
      setColor('#1F6F68');
      setSteps([]);
      setTargetDays([]);
    }
  }, [editingSkill, isOpen]);

  // Reset AI panel when modal opens/closes
  useEffect(() => {
    setAiOpen(false);
    setAiPrompt('');
    setAiError('');
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleAIGenerate(e) {
    if (e && e.preventDefault) e.preventDefault();
    const promptText = typeof e === 'string' ? e : aiPrompt;
    if (!promptText.trim()) return;
    // If called with string directly from mic, update state too
    if (typeof e === 'string') setAiPrompt(e);
    setAiLoading(true);
    setAiError('');
    try {
      const token = window.__authToken || localStorage.getItem('traject_token') || '';
      const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const res = await fetch(`${BASE}/ai/generate-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: promptText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        const rawMsg = typeof data?.error === 'string' ? data.error : '';
        const isJsonOr503 = rawMsg.startsWith('{') || rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE') || rawMsg.includes('high demand');
        const friendlyMsg = isJsonOr503 || !rawMsg
          ? 'Model abhi busy hai, thodi der baad phir try karein'
          : rawMsg;
        throw new Error(friendlyMsg);
      }

      if (data.error === 'unclear_input') {
        throw new Error('Please describe the skill more clearly (e.g. "Power BI for data analytics")');
      }

      if (data.error) {
        const isJsonOr503 = String(data.error).startsWith('{') || String(data.error).includes('503') || String(data.error).includes('UNAVAILABLE');
        const friendlyMsg = isJsonOr503
          ? 'Model abhi busy hai, thodi der baad phir try karein'
          : String(data.error);
        throw new Error(friendlyMsg);
      }

      if (data.skillName || data.name) setName(data.skillName || data.name);
      if (data.tagline) setTagline(data.tagline);

      if (data.icon) {
        const iconMap = {
          briefcase: 'Briefcase',
          code: 'Code2',
          calculator: 'Calculator',
          branch: 'GitBranch',
          clipboard: 'ClipboardList',
          brain: 'Brain',
          book: 'BookOpen',
        };
        const mappedIcon = iconMap[String(data.icon).toLowerCase()] || data.icon;
        setIcon(mappedIcon);
      }

      if (data.accentColor) {
        const colorMap = {
          green: '#1F6F68',
          gold: '#C79A3E',
          teal: '#4E9E93',
          bronze: '#A67C27',
          darkTeal: '#2D5F5A',
          sand: '#D4AF6A',
          charcoal: '#0F3331',
          maroon: '#B0453A',
          purple: '#9333EA',
          blue: '#2563EB',
        };
        const mappedColor = colorMap[data.accentColor] || data.accentColor;
        setColor(mappedColor);
      }

      if (Array.isArray(data.steps) && data.steps.length > 0) {
        setSteps(
          data.steps.map((s, i) => ({
            id: `ai-step-${Date.now()}-${i}`,
            title: s.title || '',
            desc: s.description || s.desc || '',
          }))
        );
      }

      setAiOpen(false);
      setAiPrompt('');
    } catch (err) {
      const msg = err.message || 'Something went wrong. Please try again.';
      const cleanMsg = msg.startsWith('{') || msg.includes('503') || msg.includes('UNAVAILABLE')
        ? 'Model abhi busy hai, thodi der baad phir try karein'
        : msg;
      setAiError(cleanMsg);
      setAiOpen(true); // keep open to show error
    } finally {
      setAiLoading(false);
    }
  }

  // Called by AiMicButton when speech ends — sets prompt + auto-generates
  function handleVoiceAutoSubmit(transcript) {
    setAiOpen(true);
    setAiPrompt(transcript);
    handleAIGenerate(transcript);
  }

  function handleAddStep() {
    setSteps((prev) => [
      ...prev,
      { id: `step-${Date.now()}-${prev.length}`, title: '', desc: '' },
    ]);
  }

  function handleUpdateStep(idx, field, value) {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s))
    );
  }

  function handleRemoveStep(idx) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;

    const cleanedSteps = steps
      .filter((s) => s.title.trim() !== '')
      .map((s, i) => ({
        id: s.id || `step-${Date.now()}-${i}`,
        title: s.title.trim(),
        desc: s.desc.trim(),
      }));

    if (editingSkill) {
      onSave({
        ...editingSkill,
        name: name.trim(),
        tagline: tagline.trim(),
        icon,
        color,
        steps: cleanedSteps,
        targetDays,
        targetDay: targetDays[0] !== undefined ? targetDays[0] : null,
      });
    } else {
      onSave({
        id: `custom-${Date.now()}`,
        name: name.trim(),
        tagline: tagline.trim() || 'Learning track',
        icon,
        color,
        steps: cleanedSteps,
        targetDays,
        targetDay: targetDays[0] !== undefined ? targetDays[0] : null,
      });
    }
    onClose();
  }

  const iconKeys = Object.keys(ICON_MAP);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: COLORS.border }}>
          <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl font-bold">
            {editingSkill ? 'Edit Skill Roadmap' : 'Add New Skill Roadmap'}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: COLORS.ink }}>Skill Name *</label>
            <div className="flex items-center gap-2">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Data Engineering / AWS"
                className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl outline-none"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              />
              <MicButton fieldName="Skill Name" currentValue={name} onAppendText={setName} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: COLORS.ink }}>Tagline</label>
            <div className="flex items-center gap-2">
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. Key modules & daily hands-on practice"
                className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl outline-none"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              />
              <MicButton fieldName="Tagline" currentValue={tagline} onAppendText={setTagline} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: COLORS.ink }}>Select Icon</label>
            <div className="flex items-center gap-2 flex-wrap">
              {iconKeys.map((iconKey) => {
                const IconComp = ICON_MAP[iconKey];
                const isSelected = icon === iconKey;
                return (
                  <button
                    key={iconKey}
                    type="button"
                    onClick={() => setIcon(iconKey)}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-center ${
                      isSelected ? 'ring-2 ring-emerald-600 bg-emerald-50' : 'hover:bg-slate-50'
                    }`}
                    style={{ borderColor: isSelected ? COLORS.tealMid : COLORS.border }}
                    title={iconKey}
                  >
                    <IconComp size={20} color={isSelected ? COLORS.tealMid : COLORS.muted} />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: COLORS.ink }}>Accent Color</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-transform flex items-center justify-center cursor-pointer"
                  style={{
                    background: c,
                    transform: color === c ? 'scale(1.2)' : 'scale(1)',
                    boxShadow: color === c ? `0 0 0 2px #FFF, 0 0 0 4px ${c}` : 'none',
                  }}
                >
                  {color === c && <Check size={14} color="#FFF" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: COLORS.ink }}>Target Study Day(s) (Dashboard Badge Focus)</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {WEEKDAY_SHORT.map((dayName, idx) => {
                const isSelected = targetDays.includes(idx);
                return (
                  <button
                    key={dayName}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setTargetDays(targetDays.filter((d) => d !== idx));
                      } else {
                        setTargetDays([...targetDays, idx]);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                      isSelected
                        ? 'bg-teal-900 text-white border-teal-800 shadow-xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {dayName}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t" style={{ borderColor: COLORS.border }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold" style={{ color: COLORS.ink }}>
                Roadmap Steps ({steps.length})
              </label>
              <button
                type="button"
                onClick={handleAddStep}
                className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 cursor-pointer"
              >
                <Plus size={13} /> Add Step
              </button>
            </div>

            <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
              {steps.length === 0 ? (
                <div className="text-center py-4 text-xs text-slate-400 font-medium bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No steps added yet. Click "+ Add Step" to define roadmap modules.
                </div>
              ) : (
                steps.map((s, idx) => (
                  <div key={s.id || idx} className="p-2.5 rounded-xl border bg-slate-50/70 space-y-1.5 relative group" style={{ borderColor: COLORS.border }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400">{idx + 1}.</span>
                      <input
                        value={s.title}
                        onChange={(e) => handleUpdateStep(idx, 'title', e.target.value)}
                        placeholder="Step Title (e.g. Basics & Setup)"
                        className="flex-1 text-xs font-semibold px-2.5 py-1 rounded-lg outline-none bg-white border border-slate-200"
                      />
                      <MicButton
                        fieldName={`Step ${idx + 1} Title`}
                        currentValue={s.title}
                        onAppendText={(val) => handleUpdateStep(idx, 'title', val)}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveStep(idx)}
                        className="p-1 text-slate-400 hover:text-red-500 rounded-md hover:bg-red-50"
                        title="Delete Step"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={s.desc}
                        onChange={(e) => handleUpdateStep(idx, 'desc', e.target.value)}
                        placeholder="Description / Topics covered"
                        className="flex-1 text-[11px] px-2.5 py-1 rounded-lg outline-none bg-white border border-slate-200 text-slate-600"
                      />
                      <MicButton
                        fieldName={`Step ${idx + 1} Description`}
                        currentValue={s.desc}
                        onAppendText={(val) => handleUpdateStep(idx, 'desc', val)}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── AI Generate Panel ── full-width row, separate from footer buttons */}
          <div className="pt-3 border-t" style={{ borderColor: COLORS.border }}>
            {!aiOpen && !aiLoading ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAiOpen(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, #1F6F68 0%, #123936 100%)',
                    color: '#fff',
                    boxShadow: '0 2px 8px rgba(31,111,104,0.25)',
                  }}
                >
                  <Sparkles size={13} />
                  Generate with AI
                </button>
                <AiMicButton
                  disabled={false}
                  onTranscript={(t) => { setAiOpen(true); setAiPrompt(t); }}
                  onAutoSubmit={handleVoiceAutoSubmit}
                />
              </div>
            ) : aiLoading ? (
              <div className="flex items-center gap-2 py-2">
                <span className="inline-block w-4 h-4 border-2 border-teal-600/30 border-t-teal-700 rounded-full animate-spin" />
                <span className="text-xs font-semibold" style={{ color: COLORS.tealMid }}>Ascend is generating your roadmap…</span>
              </div>
            ) : (
              /* AI prompt panel — NOT a nested form, uses div + onKeyDown to avoid Enter-newline bug */
              <div className="space-y-2">
                <div className="flex items-center gap-1.5" style={{ color: COLORS.tealMid }}>
                  <Sparkles size={13} />
                  <span className="text-[11px] font-bold">Describe what you want to learn</span>
                  <button
                    type="button"
                    onClick={() => { setAiOpen(false); setAiError(''); setAiPrompt(''); }}
                    className="ml-auto text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    autoFocus
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (aiPrompt.trim() && !aiLoading) handleAIGenerate(aiPrompt);
                      }
                    }}
                    placeholder="e.g. Power BI for data analytics, daily 30 min"
                    className="flex-1 text-xs px-3 py-2.5 rounded-xl outline-none"
                    style={{
                      background: COLORS.bg,
                      border: `1.5px solid ${COLORS.tealMid}`,
                      color: COLORS.ink,
                    }}
                    disabled={aiLoading}
                  />
                  <AiMicButton
                    disabled={aiLoading}
                    onTranscript={(t) => setAiPrompt(t)}
                    onAutoSubmit={handleVoiceAutoSubmit}
                  />
                  <button
                    type="button"
                    onClick={() => { if (aiPrompt.trim() && !aiLoading) handleAIGenerate(aiPrompt); }}
                    disabled={aiLoading || !aiPrompt.trim()}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, #1F6F68 0%, #123936 100%)',
                      color: '#fff',
                      opacity: !aiPrompt.trim() ? 0.45 : 1,
                    }}
                  >
                    <Sparkles size={13} /> Generate
                  </button>
                </div>
                {aiError && (
                  <div className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-xl flex items-center justify-between gap-2 shadow-2xs">
                    <span className="truncate">⚠ {aiError}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (aiPrompt.trim() && !aiLoading) handleAIGenerate(aiPrompt);
                      }}
                      className="px-2.5 py-1 bg-red-600 hover:bg-red-700 active:scale-95 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all shrink-0 flex items-center gap-1"
                    >
                      <RotateCcw size={11} /> Retry
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Footer: Cancel + Create ── always visible, never overlaps AI panel */}
          <div className="flex justify-end gap-3 pt-3 border-t" style={{ borderColor: COLORS.border }}>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-all hover:scale-[1.02]"
              style={{ background: COLORS.gold, color: COLORS.tealDeep }}
            >
              {editingSkill ? 'Save Changes' : 'Create Skill Roadmap'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SkillDetailView({ skill, progress, onToggleStep, onBack }) {
  const map = progress[skill?.id] || {};
  const percent = skill ? skillPercent(skill, progress) : 0;
  const Icon = skill ? getSkillIcon(skill.icon) : Code2;
  const doneCount = skill?.steps ? skill.steps.filter((s) => map[s.id]).length : 0;
  if (!skill) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold cursor-pointer transition-all hover:-translate-x-1" style={{ color: COLORS.tealMid }}>
          <ChevronLeft size={18} /> Back to Skills
        </button>
        <div className="p-8 text-center text-sm font-medium" style={{ color: COLORS.muted }}>Skill roadmap not found.</div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold cursor-pointer transition-all hover:-translate-x-1" style={{ color: COLORS.tealMid }}>
        <ChevronLeft size={18} /> Back to Skills
      </button>
      <div className="rounded-2xl p-5 sm:p-8 flex items-center gap-5 sm:gap-6 flex-wrap shadow-xs" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
        <ProgressRing percent={percent} size={68} stroke={7} color={skill.color || COLORS.tealMid} trackColor={COLORS.border} />
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl" style={{ background: (skill.color || COLORS.tealMid) + '1A' }}>
              <Icon size={20} color={skill.color || COLORS.tealMid} />
            </div>
            <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl font-bold">{skill.name}</h2>
          </div>
          <div className="text-xs sm:text-sm mt-1 font-medium" style={{ color: COLORS.muted }}>{skill.tagline}</div>
          <div className="text-xs mt-2 font-semibold text-slate-500">{doneCount} of {skill.steps.length} steps completed</div>
        </div>
        <div style={{ fontFamily: 'Fraunces, serif', color: skill.color || COLORS.tealMid }} className="text-2xl sm:text-4xl font-bold">{percent}%</div>
      </div>
      <div className="space-y-2.5 sm:space-y-3">
        {skill.steps.map((step, idx) => (
          <TaskRow
            key={step.id}
            title={`${idx + 1}. ${step.title}`}
            subtitle={step.desc}
            done={!!map[step.id]}
            onToggle={() => onToggleStep(skill.id, step.id)}
            color={skill.color || COLORS.tealMid}
          />
        ))}
      </div>
    </div>
  );
}

function HistoryView({ historyDays, templates, skillsById, skills, progress }) {
  const [rangeFilter, setRangeFilter] = useState('weekly'); // 'weekly' | 'monthly' | 'yearly'
  const [selectedMonthDate, setSelectedMonthDate] = useState(() => new Date());

  const selectedYear = selectedMonthDate.getFullYear();
  const selectedMonth = selectedMonthDate.getMonth(); // 0-11

  // Month title formatted string e.g. "September 2026"
  const monthTitleLabel = selectedMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Map of date strings for easy lookup in calendar grid
  const historyDaysMap = useMemo(() => {
    if (!historyDays) return {};
    const map = {};
    historyDays.forEach((d) => {
      const key = `${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`;
      map[key] = d;
    });
    return map;
  }, [historyDays]);

  // Filter historyDays based on rangeFilter and selectedMonthDate
  const rangeDays = useMemo(() => {
    if (!historyDays) return [];
    if (rangeFilter === 'weekly') return historyDays.slice(-7);
    if (rangeFilter === 'monthly') {
      const monthDays = historyDays.filter(
        (d) => d.date.getFullYear() === selectedYear && d.date.getMonth() === selectedMonth
      );
      return monthDays.length > 0 ? monthDays : historyDays.slice(-30);
    }
    return historyDays; // yearly / all-time
  }, [historyDays, rangeFilter, selectedYear, selectedMonth]);

  const rangeChartData = useMemo(() => {
    return rangeDays.map((d) => ({
      label: `${WEEKDAY_SHORT[d.date.getDay()]} ${d.date.getDate()}`,
      fullDate: d.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      percent: d.total ? Math.round((d.done / d.total) * 100) : 0,
      status: getDayStatus(d.done, d.total),
    }));
  }, [rangeDays]);

  const rangeDone = useMemo(() => rangeDays.reduce((a, d) => a + d.done, 0), [rangeDays]);
  const rangePossible = useMemo(() => rangeDays.reduce((a, d) => a + d.total, 0), [rangeDays]);
  const rangePercent = rangePossible ? Math.round((rangeDone / rangePossible) * 100) : 0;

  const pieChartData = useMemo(() => {
    if (!rangeDays) return [];
    const counts = { superb: 0, good: 0, bad: 0, rest: 0 };
    rangeDays.forEach((d) => {
      const status = getDayStatus(d.done, d.total);
      counts[status] = (counts[status] || 0) + 1;
    });

    return [
      { name: 'Superb (100% Win)', value: counts.superb, color: STATUS_META.superb.color },
      { name: 'Good (Partial)', value: counts.good, color: STATUS_META.good.color },
      { name: 'Bad (Waste Day)', value: counts.bad, color: STATUS_META.bad.color },
      { name: 'Rest Day', value: counts.rest, color: STATUS_META.rest.color },
    ].filter((item) => item.value > 0);
  }, [rangeDays]);

  const statusCounts = useMemo(() => {
    const counts = { superb: 0, good: 0, bad: 0, rest: 0 };
    rangeDays.forEach((d) => {
      const status = getDayStatus(d.done, d.total);
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [rangeDays]);

  const skillBreakdown = useMemo(() => {
    const tally = {};
    rangeDays.forEach((d) => (d.taskDetails || []).forEach((t) => {
      if (t.done) tally[t.skill] = (tally[t.skill] || 0) + 1;
    }));
    return Object.entries(tally).sort((a, b) => b[1] - a[1]);
  }, [rangeDays]);

  // Calendar Grid calculation for selected Month
  const calendarCells = useMemo(() => {
    const firstDayObj = new Date(selectedYear, selectedMonth, 1);
    const startingWeekday = firstDayObj.getDay(); // 0 = Sun
    const totalDaysCount = new Date(selectedYear, selectedMonth + 1, 0).getDate();

    const cells = [];
    // Empty slots before starting weekday
    for (let i = 0; i < startingWeekday; i++) {
      cells.push({ type: 'empty', key: `empty-${i}` });
    }
    // Days of the month
    for (let dayNum = 1; dayNum <= totalDaysCount; dayNum++) {
      const key = `${selectedYear}-${selectedMonth}-${dayNum}`;
      const dayData = historyDaysMap[key];
      const dateObj = new Date(selectedYear, selectedMonth, dayNum);
      const dayOfWeek = WEEKDAY_SHORT[dateObj.getDay()];

      cells.push({
        type: 'day',
        key: `day-${key}`,
        dayNum,
        dayOfWeek,
        dateObj,
        dayData,
      });
    }
    return cells;
  }, [selectedYear, selectedMonth, historyDaysMap]);

  function handlePrevMonth() {
    setSelectedMonthDate(new Date(selectedYear, selectedMonth - 1, 1));
  }

  function handleNextMonth() {
    setSelectedMonthDate(new Date(selectedYear, selectedMonth + 1, 1));
  }

  function handleTodayMonth() {
    setSelectedMonthDate(new Date());
  }

  // Statement Download CSV Function
  function handleDownloadCSV() {
    if (!historyDays || historyDays.length === 0) return;

    const filterLabel = rangeFilter.toUpperCase();
    const dateStr = new Date().toISOString().split('T')[0];
    const csvRows = [];

    // Title & Header
    csvRows.push(['ASCEND PERFORMANCE & ACCURACY STATEMENT']);
    csvRows.push([`Report Period: ${filterLabel} (${rangeDays.length} Days)`]);
    csvRows.push([`Generated On: ${new Date().toLocaleString('en-IN')}`]);
    csvRows.push([]);

    // Executive Summary
    csvRows.push(['--- PERFORMANCE SUMMARY ---']);
    csvRows.push(['Metric', 'Value']);
    csvRows.push(['Overall Completion Rate (%)', `${rangePercent}%`]);
    csvRows.push(['Total Tasks Scheduled', rangePossible]);
    csvRows.push(['Total Tasks Completed', rangeDone]);
    csvRows.push(['Total Tasks Pending', rangePossible - rangeDone]);
    csvRows.push(['Superb Days (100% Win)', statusCounts.superb || 0]);
    csvRows.push(['Good Days (Partial Win)', statusCounts.good || 0]);
    csvRows.push(['Bad Days (Waste Day)', statusCounts.bad || 0]);
    csvRows.push(['Rest Days', statusCounts.rest || 0]);
    csvRows.push([]);

    // Section 1: Daily Plan Accuracy Table (Single Line Per Date)
    csvRows.push(['--- DAILY CHECKLIST ACCURACY LOG (DATE-WISE STATEMENT) ---']);
    csvRows.push(['Date', 'Scheduled Tasks', 'Completed Tasks (Done)', 'Pending Tasks', 'Daily Accuracy Rate (%)', 'Day Rating Status']);

    rangeDays.forEach((d) => {
      const dStr = d.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const pending = d.total - d.done;
      const acc = d.total ? Math.round((d.done / d.total) * 100) : 0;
      const status = STATUS_META[getDayStatus(d.done, d.total)]?.label || 'N/A';
      csvRows.push([`"${dStr}"`, d.total, d.done, pending, `${acc}%`, `"${status}"`]);
    });
    csvRows.push([]);

    // Section 2: Skill Roadmaps & Topic Completion History
    csvRows.push(['--- SKILL ROADMAPS & TOPIC ACCURACY LOG ---']);
    csvRows.push(['Skill Name', 'Total Roadmap Topics', 'Topics Completed', 'Pending Topics', 'Skill Accuracy (%)', 'Topic Frequencies & Details']);

    if (skills && Array.isArray(skills)) {
      skills.forEach((s) => {
        const map = (progress && progress[s.id]) || {};
        const totalSteps = s.steps ? s.steps.length : 0;
        const doneSteps = s.steps ? s.steps.filter((st) => map[st.id]).length : 0;
        const pendingSteps = totalSteps - doneSteps;
        const acc = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;
        const topicsText = s.steps
          ? s.steps
              .map((st) => `${st.title} [${map[st.id] ? 'DONE' : 'PENDING'}]`)
              .join(' ; ')
          : '';
        csvRows.push([`"${s.name}"`, totalSteps, doneSteps, pendingSteps, `${acc}%`, `"${topicsText}"`]);
      });
    }

    const csvContent = csvRows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ASCEND_Performance_Statement_${filterLabel}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // PDF Export Printable Statement Function
  function handleDownloadPDF() {
    if (!historyDays || historyDays.length === 0) return;

    const filterLabel = rangeFilter.toUpperCase();
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const dailyRowsHtml = rangeDays.map((d) => {
      const dStr = d.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const pending = d.total - d.done;
      const acc = d.total ? Math.round((d.done / d.total) * 100) : 0;
      const statusKey = getDayStatus(d.done, d.total);
      const meta = STATUS_META[statusKey] || { label: 'N/A', color: '#666', bg: '#f1f5f9', border: '#cbd5e1', text: '#334155' };

      return `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 9px 12px; font-weight: 600;">${dStr}</td>
          <td style="padding: 9px 12px; text-align: center;">${d.total} tasks</td>
          <td style="padding: 9px 12px; text-align: center; font-weight: bold; color: #047857;">${d.done}</td>
          <td style="padding: 9px 12px; text-align: center; font-weight: bold; color: #dc2626;">${pending}</td>
          <td style="padding: 9px 12px; text-align: center; font-weight: 800; color: #123936;">${acc}%</td>
          <td style="padding: 9px 12px; text-align: center;">
            <span style="background: ${meta.bg}; color: ${meta.text}; border: 1px solid ${meta.border}; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 800;">
              ${meta.label}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    let skillRowsHtml = '';
    if (skills && Array.isArray(skills)) {
      skillRowsHtml = skills.map((s) => {
        const map = (progress && progress[s.id]) || {};
        const totalSteps = s.steps ? s.steps.length : 0;
        const doneSteps = s.steps ? s.steps.filter((st) => map[st.id]).length : 0;
        const pendingSteps = totalSteps - doneSteps;
        const acc = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;
        const topicsText = s.steps
          ? s.steps.map((st) => `<span style="display:inline-block; margin:2px 4px; padding:3px 7px; border-radius:6px; font-size:10px; font-weight:600; background:${map[st.id] ? '#dcfce7; color:#166534; border:1px solid #86efac;' : '#f1f5f9; color:#475569; border:1px solid #cbd5e1;'}">${st.title} (${map[st.id] ? '✓ DONE' : 'PENDING'})</span>`).join('')
          : 'No topics registered';

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 10px 12px; font-weight: 700; color: #123936;">${s.name}</td>
            <td style="padding: 10px 12px; text-align: center;">${totalSteps}</td>
            <td style="padding: 10px 12px; text-align: center; font-weight: bold; color: #047857;">${doneSteps}</td>
            <td style="padding: 10px 12px; text-align: center; font-weight: bold; color: #dc2626;">${pendingSteps}</td>
            <td style="padding: 10px 12px; text-align: center; font-weight: 800; color: #123936;">${acc}%</td>
            <td style="padding: 10px 12px; font-size: 11px;">${topicsText}</td>
          </tr>
        `;
      }).join('');
    }

    const printWindow = window.open('', '_blank', 'width=950,height=1000');
    if (!printWindow) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>ASCEND Performance & Accuracy Statement - ${filterLabel} (${dateStr})</title>
        <style>
          @media print {
            @page { size: A4 portrait; margin: 12mm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
          }
          body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #fff; color: #1e293b; margin: 0; padding: 24px; font-size: 12px; }
          .statement-header { background: #123936; color: #fff; padding: 24px; border-radius: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid #C79A3E; }
          .statement-header h1 { margin: 0; font-size: 22px; font-weight: 800; color: #C79A3E; letter-spacing: 0.5px; }
          .statement-header p { margin: 4px 0 0 0; font-size: 12px; color: #E4E1D6; }
          .badge-period { background: #C79A3E; color: #123936; padding: 6px 14px; border-radius: 20px; font-weight: 800; font-size: 11px; text-transform: uppercase; }
          .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
          .summary-card { background: #F8FAFC; border: 1px solid #E2E8F0; padding: 14px 16px; border-radius: 10px; text-align: center; }
          .summary-card .val { font-size: 22px; font-weight: 800; color: #123936; }
          .summary-card .lbl { font-size: 10px; text-transform: uppercase; font-weight: 700; color: #64748B; margin-top: 3px; }
          .section-title { font-size: 13px; font-weight: 800; color: #123936; margin: 24px 0 10px 0; border-bottom: 2px solid #C79A3E; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
          th { background: #F1F5F9; color: #334155; font-weight: 700; text-transform: uppercase; font-size: 10px; padding: 9px 12px; text-align: left; border-bottom: 2px solid #CBD5E1; }
          .action-bar { margin-bottom: 20px; text-align: right; }
          .btn-print { background: #123936; color: #fff; border: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .footer-note { margin-top: 30px; border-top: 1px solid #E2E8F0; padding-top: 14px; font-size: 10px; color: #94A3B8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="action-bar no-print">
          <button class="btn-print" onclick="window.print()">📄 Save as PDF / Print Statement</button>
        </div>

        <div class="statement-header">
          <div>
            <h1>ASCEND PERFORMANCE STATEMENT</h1>
            <p>Official Learning Accuracy & Study Timeline Bank Audit Statement</p>
          </div>
          <div style="text-align: right;">
            <div class="badge-period">${filterLabel} STATEMENT</div>
            <p style="margin-top: 6px; font-size: 11px;">Generated: ${dateStr} at ${timeStr}</p>
          </div>
        </div>

        <div class="summary-grid">
          <div class="summary-card">
            <div class="val">${rangePercent}%</div>
            <div class="lbl">Overall Accuracy Rate</div>
          </div>
          <div class="summary-card">
            <div class="val" style="color: #047857;">${rangeDone} / ${rangePossible}</div>
            <div class="lbl">Tasks Done vs Total</div>
          </div>
          <div class="summary-card">
            <div class="val" style="color: #dc2626;">${rangePossible - rangeDone}</div>
            <div class="lbl">Pending Tasks</div>
          </div>
          <div class="summary-card">
            <div class="val" style="color: #047857;">${statusCounts.superb || 0}d</div>
            <div class="lbl">Superb (100% Win) Days</div>
          </div>
        </div>

        <div class="section-title">1. DAILY CHECKLIST ACCURACY LOG (DATE-WISE STATEMENT)</div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th style="text-align:center;">Scheduled Tasks</th>
              <th style="text-align:center;">Done (✓)</th>
              <th style="text-align:center;">Pending (✗)</th>
              <th style="text-align:center;">Daily Accuracy Rate</th>
              <th style="text-align:center;">Day Rating</th>
            </tr>
          </thead>
          <tbody>
            ${dailyRowsHtml || '<tr><td colspan="6" style="text-align:center; padding:12px;">No history records found.</td></tr>'}
          </tbody>
        </table>

        <div class="section-title">2. SKILL ROADMAPS & TOPIC TIMELINE ACCURACY LOG</div>
        <table>
          <thead>
            <tr>
              <th>Skill Name</th>
              <th style="text-align:center;">Total Topics</th>
              <th style="text-align:center;">Completed</th>
              <th style="text-align:center;">Pending</th>
              <th style="text-align:center;">Skill Accuracy</th>
              <th>Topic Breakdown & Details</th>
            </tr>
          </thead>
          <tbody>
            ${skillRowsHtml || '<tr><td colspan="6" style="text-align:center; padding:12px;">No skills registered.</td></tr>'}
          </tbody>
        </table>

        <div class="footer-note">
          This is an official computer-generated performance accuracy statement from ASCEND Tracker.<br/>
          Report Period: ${filterLabel} | Verified Student Activity Audit Log
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() { window.print(); }, 400);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }

  return (
    <div className="space-y-8 sm:space-y-10">
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
          <div>
            <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl font-bold">
              Performance Analytics & History
            </h2>
            <p className="text-xs sm:text-sm mt-0.5" style={{ color: COLORS.muted }}>
              Filter performance by Weekly, Monthly, or Yearly, and download complete bank-statement style accuracy audit in PDF or CSV format.
            </p>
          </div>

          {/* Range Filter Buttons */}
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-2xl border border-slate-200 shadow-2xs">
            <button
              type="button"
              onClick={() => setRangeFilter('weekly')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                rangeFilter === 'weekly' ? 'bg-teal-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Weekly (7d)
            </button>
            <button
              type="button"
              onClick={() => setRangeFilter('monthly')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                rangeFilter === 'monthly' ? 'bg-teal-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Monthly View
            </button>
            <button
              type="button"
              onClick={() => setRangeFilter('yearly')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                rangeFilter === 'yearly' ? 'bg-teal-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Yearly (All-Time)
            </button>
          </div>
        </div>

        {!historyDays ? (
          <div className="p-8 text-center text-sm font-medium" style={{ color: COLORS.muted }}>Loading performance chart…</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap bg-white p-3.5 rounded-2xl border border-slate-200 text-xs font-bold">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-500 mr-1">Day Status Legend:</span>
                {Object.entries(STATUS_META).map(([k, meta]) => (
                  <div key={k} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: meta.bg, border: `1px solid ${meta.border}`, color: meta.text }}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
                    <span>{meta.label}</span>
                  </div>
                ))}
              </div>

              {/* Download Buttons: PDF Statement & CSV Statement */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-xs text-white"
                  style={{ background: COLORS.learn }}
                  title="Download complete printable bank statement in PDF format"
                >
                  <FileText size={14} /> Download PDF Statement
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCSV}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-xs"
                  style={{ background: COLORS.gold, color: COLORS.tealDeep }}
                  title="Download complete statement report in CSV format"
                >
                  <Download size={14} /> Export CSV
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 rounded-2xl p-4 sm:p-6 shadow-xs" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
                <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
                  <div>
                    <div style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-2xl sm:text-3xl font-bold">{rangePercent}%</div>
                    <div className="text-xs font-medium" style={{ color: COLORS.muted }}>
                      {rangeDone} of {rangePossible} tasks completed ({rangeFilter.toUpperCase()} view)
                    </div>
                  </div>
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-700 capitalize">
                    {rangeFilter} Completion Rate
                  </span>
                </div>
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={rangeChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="#ECE9E0" vertical={false} />
                      <XAxis dataKey={rangeFilter === 'yearly' ? 'fullDate' : 'label'} tick={{ fontSize: 10, fill: COLORS.muted }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} domain={[0, 100]} />
                      <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, fontSize: 12 }} />
                      <Bar dataKey="percent" radius={[6, 6, 0, 0]}>
                        {rangeChartData.map((d, i) => <Cell key={i} fill={STATUS_META[d.status].color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col justify-between" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
                <div>
                  <h3 className="font-bold text-sm sm:text-base mb-0.5" style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }}>
                    Performance Breakdown ({rangeFilter.toUpperCase()})
                  </h3>
                  <p className="text-[11px]" style={{ color: COLORS.muted }}>Superb, Good, Bad & Rest Day Ratio</p>
                </div>

                <div style={{ width: '100%', height: 180 }} className="flex items-center justify-center my-2">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={pieChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {pieChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name) => [`${value} Days`, name]} contentStyle={{ borderRadius: 10, fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-2 border-t text-[11px]" style={{ borderColor: COLORS.border }}>
                  {pieChartData.map((p) => (
                    <div key={p.name} className="flex items-center gap-1.5 font-medium truncate">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
                      <span className="truncate">{p.name}: <strong style={{ color: COLORS.ink }}>{p.value}d</strong></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {skillBreakdown.length > 0 && (
              <div className="rounded-2xl p-4 sm:p-5 shadow-xs" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
                <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.muted }}>
                  Sessions Completed By Skill ({rangeFilter.toUpperCase()})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {skillBreakdown.map(([skillId, count]) => {
                    const s = skillsById[skillId];
                    return (
                      <div key={skillId} className="flex items-center justify-between text-xs sm:text-sm py-1.5 px-3 rounded-xl bg-slate-50">
                        <span className="flex items-center gap-2 font-medium" style={{ color: COLORS.ink }}>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s?.color || COLORS.tealMid }} /> {s?.name || skillId}
                        </span>
                        <span className="font-semibold text-xs px-2.5 py-0.5 rounded-full bg-white border border-slate-200" style={{ color: COLORS.ink }}>{count} sessions</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Interactive Month Navigation Calendar Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
          <div>
            <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <Calendar className="text-teal-800" size={20} /> Calendar Ratings & Monthly Grid
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Navigate between months to inspect ratings, topic accuracies, and daily win rates.
            </p>
          </div>

          {/* Month Navigation Controls (< Month Year >) */}
          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 cursor-pointer font-bold text-slate-700 transition-colors shadow-2xs"
              title="Previous Month"
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="font-bold text-sm sm:text-base px-2 min-w-[140px] text-center">
              {monthTitleLabel}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 cursor-pointer font-bold text-slate-700 transition-colors shadow-2xs"
              title="Next Month"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={handleTodayMonth}
              className="px-3 py-1 rounded-lg bg-teal-900 text-white text-xs font-bold cursor-pointer transition-all hover:bg-teal-800 shadow-2xs ml-1"
            >
              Today
            </button>
          </div>
        </div>

        {!historyDays ? (
          <div className="text-sm font-medium" style={{ color: COLORS.muted }}>Loading month calendar grid…</div>
        ) : (
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            {/* Weekday Labels Header */}
            <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <div>SUN</div>
              <div>MON</div>
              <div>TUE</div>
              <div>WED</div>
              <div>THU</div>
              <div>FRI</div>
              <div>SAT</div>
            </div>

            {/* 1 Month Calendar Grid */}
            <div className="grid grid-cols-7 gap-2 sm:gap-3">
              {calendarCells.map((cell) => {
                if (cell.type === 'empty') {
                  return (
                    <div key={cell.key} className="aspect-square rounded-2xl bg-slate-50/50 border border-dashed border-slate-200/60 opacity-40" />
                  );
                }

                const d = cell.dayData;
                if (!d) {
                  return (
                    <div
                      key={cell.key}
                      className="aspect-square rounded-2xl flex flex-col items-center justify-center p-1 border border-slate-100 bg-slate-50/70 text-slate-400"
                    >
                      <span className="text-xs font-semibold">{cell.dayNum}</span>
                      <span className="text-[9px] font-medium text-slate-400">Rest</span>
                    </div>
                  );
                }

                const status = getDayStatus(d.done, d.total);
                const meta = STATUS_META[status];

                return (
                  <div
                    key={cell.key}
                    className="aspect-square rounded-2xl flex flex-col items-center justify-center gap-0.5 sm:gap-1 p-1 sm:p-2 transition-all hover:scale-105 shadow-2xs cursor-pointer"
                    style={{ background: meta.bg, border: `1.5px solid ${meta.border}` }}
                    title={`${d.done}/${d.total} tasks completed on ${cell.dateObj.toDateString()} · ${meta.label}`}
                  >
                    <div className="text-[9px] font-semibold uppercase" style={{ color: meta.text }}>{cell.dayOfWeek}</div>
                    <div className="text-sm sm:text-base font-extrabold" style={{ color: meta.text }}>{cell.dayNum}</div>
                    <div className="text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 hidden sm:inline" style={{ background: meta.color, color: '#FFF' }}>
                      {meta.label.split(' ')[0]}
                    </div>
                    <div className="text-[9px] font-bold text-slate-600 sm:hidden">
                      {d.done}/{d.total}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Interactive Daily Accuracy & Task Statement Table (Bank Statement Style) */}
      <div className="rounded-2xl p-4 sm:p-6 shadow-xs bg-white border space-y-4" style={{ borderColor: COLORS.border }}>
        <div className="flex items-center justify-between flex-wrap gap-3 border-b pb-3" style={{ borderColor: COLORS.border }}>
          <div>
            <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base sm:text-lg font-bold flex items-center gap-2">
              <FileText size={18} className="text-teal-700" /> Daily Plan Accuracy Statement
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Bank-statement style breakdown of daily scheduled, completed (✓), and pending (✗) tasks with accuracy %.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleDownloadPDF}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all hover:scale-[1.02] shadow-xs text-white"
              style={{ background: COLORS.learn }}
            >
              <FileText size={14} /> Download PDF
            </button>
            <button
              type="button"
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all hover:scale-[1.02] shadow-xs"
              style={{ background: COLORS.gold, color: COLORS.tealDeep }}
            >
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        {/* Statement Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b bg-slate-50/80 text-slate-600 font-bold uppercase text-[10px] tracking-wider" style={{ borderColor: COLORS.border }}>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Scheduled Tasks</th>
                <th className="py-2.5 px-3 text-emerald-700">Done (✓)</th>
                <th className="py-2.5 px-3 text-red-600">Pending (✗)</th>
                <th className="py-2.5 px-3">Accuracy %</th>
                <th className="py-2.5 px-3">Day Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {rangeDays.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-6 text-center text-slate-400">No data available for this range filter.</td>
                </tr>
              ) : (
                rangeDays.map((d) => {
                  const pending = d.total - d.done;
                  const acc = d.total ? Math.round((d.done / d.total) * 100) : 0;
                  const statusKey = getDayStatus(d.done, d.total);
                  const meta = STATUS_META[statusKey];
                  const dStr = d.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

                  return (
                    <tr key={d.key} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-slate-800">{dStr}</td>
                      <td className="py-2.5 px-3">{d.total} tasks</td>
                      <td className="py-2.5 px-3 font-bold text-emerald-700">{d.done}</td>
                      <td className="py-2.5 px-3 font-bold text-red-600">{pending}</td>
                      <td className="py-2.5 px-3 font-extrabold">{acc}%</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: meta.bg, color: meta.text, border: `1px solid ${meta.border}` }}>
                          {meta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {rangeDays.length > 0 && (
              <tfoot>
                <tr className="border-t font-bold bg-slate-100/70 text-slate-900 text-xs">
                  <td className="py-3 px-3 font-extrabold">Total Statement</td>
                  <td className="py-3 px-3">{rangePossible} tasks</td>
                  <td className="py-3 px-3 text-emerald-700">{rangeDone}</td>
                  <td className="py-3 px-3 text-red-600">{rangePossible - rangeDone}</td>
                  <td className="py-3 px-3 font-extrabold text-teal-800">{rangePercent}%</td>
                  <td className="py-3 px-3 text-[11px] text-slate-600">{rangeDays.length} Days Filtered</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- SCHEDULE VIEW -------------------------------- */
function ScheduleView({ templates, onUpdateTemplate, onToggleDayAssignment, onResetTemplate, onAddCustomTemplate, onDeleteTemplate, onCopyTemplate, skills, onAssignSkillToDay }) {
  const [activeKey, setActiveKey] = useState(() => Object.keys(templates)[0] || 'A');
  const [viewMode, setViewMode] = useState('group'); // 'group' or 'individual'
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [newGroupLabel, setNewGroupLabel] = useState('');

  const templateKeys = Object.keys(templates);
  const currentTpl = templates[activeKey] || Object.values(templates)[0] || { label: 'Schedule', days: [], tasks: [] };

  function updateTask(idx, patch) {
    const tasks = currentTpl.tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    onUpdateTemplate(activeKey, { ...currentTpl, tasks });
  }

  function addTask() {
    const tasks = [
      ...currentTpl.tasks,
      { id: `custom-${Date.now()}`, title: 'New Work Session', time: '8:00 PM', duration: '30 min', skill: 'personal' },
    ];
    onUpdateTemplate(activeKey, { ...currentTpl, tasks });
  }

  function removeTask(idx) {
    const tasks = currentTpl.tasks.filter((_, i) => i !== idx);
    onUpdateTemplate(activeKey, { ...currentTpl, tasks });
  }

  function handleCreateCustomGroup(e) {
    e.preventDefault();
    if (!newGroupLabel.trim()) return;

    const newKey = `group-${Date.now()}`;
    const newTemplate = {
      id: newKey,
      label: newGroupLabel.trim(),
      days: [],
      tasks: [
        { id: `t-init-${Date.now()}`, title: 'Focus Work Session', time: '9:00 AM', duration: '1 hr', skill: skills[0]?.id || 'ba' },
      ],
      isCustom: true,
    };

    onAddCustomTemplate(newKey, newTemplate);
    setActiveKey(newKey);
    setNewGroupLabel('');
    setShowAddGroupModal(false);
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl font-bold mb-1">
            Custom Work Schedule & Day Pairing
          </h2>
          <p className="text-xs sm:text-sm" style={{ color: COLORS.muted }}>
            Customize your work plan for each day individually or pair multiple days together. Today & History views automatically follow your schedule!
          </p>
        </div>

        {/* View Mode Toggle: Group Pairs vs Separate 7 Days */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 rounded-2xl text-xs font-bold">
          <button
            onClick={() => setViewMode('group')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              viewMode === 'group' ? 'bg-white text-teal-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers size={14} /> Group Schedule Pairs
          </button>
          <button
            onClick={() => setViewMode('individual')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              viewMode === 'individual' ? 'bg-white text-teal-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarDays size={14} /> Separate 7 Days
          </button>
        </div>
      </div>

      {/* Mode 1: Group Schedule Pairs Tabs */}
      {viewMode === 'group' ? (
        <div className="flex gap-2 flex-wrap items-center">
          {templateKeys.map((key) => {
            const t = templates[key];
            const isActive = activeKey === key;
            const assignedDaysText = (t.days || []).map((d) => WEEKDAY_SHORT[d]).join(', ');

            return (
              <button
                key={key}
                onClick={() => setActiveKey(key)}
                style={{
                  background: isActive ? COLORS.tealDeep : COLORS.card,
                  color: isActive ? '#F5F3EE' : COLORS.ink,
                  border: `1.5px solid ${isActive ? COLORS.tealDeep : COLORS.border}`,
                }}
                className="px-4 py-2 rounded-2xl text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow-xs flex items-center gap-2"
              >
                <span>{t.label}</span>
                {assignedDaysText && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-mono ${isActive ? 'bg-amber-400/20 text-amber-300' : 'bg-slate-100 text-slate-600'}`}>
                    {assignedDaysText}
                  </span>
                )}
              </button>
            );
          })}

          <button
            onClick={() => setShowAddGroupModal(true)}
            className="px-3.5 py-2 rounded-2xl text-xs font-bold border border-amber-400/80 bg-amber-50 text-amber-800 hover:bg-amber-100 cursor-pointer flex items-center gap-1"
          >
            <Plus size={14} /> Add Schedule Group
          </button>
        </div>
      ) : (
        /* Mode 2: Separate 7 Individual Days Pills */
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {WEEKDAY_NAMES.map((dayName, dayNum) => {
            const assignedKey = templateKeys.find((k) => (templates[k].days || []).includes(dayNum)) || activeKey;
            const isSelectedDay = (templates[activeKey]?.days || []).includes(dayNum);

            return (
              <button
                key={dayName}
                onClick={() => {
                  setActiveKey(assignedKey);
                }}
                className={`py-2 px-1 rounded-2xl text-center flex flex-col items-center justify-center transition-all cursor-pointer border ${
                  isSelectedDay ? 'ring-2 ring-emerald-700 font-bold shadow-xs' : ''
                }`}
                style={{
                  background: isSelectedDay ? COLORS.tealDeep : COLORS.card,
                  color: isSelectedDay ? '#F5F3EE' : COLORS.ink,
                  borderColor: isSelectedDay ? COLORS.tealDeep : COLORS.border,
                }}
              >
                <span className="text-[10px] font-bold uppercase">{WEEKDAY_SHORT[dayNum]}</span>
                <span className="text-xs font-semibold mt-0.5 truncate max-w-full px-1">
                  {templates[assignedKey]?.label?.split(' ')[0] || 'Plan'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Day Assignment / Day Pairing Box */}
      <div className="rounded-2xl p-4 sm:p-5 shadow-xs" style={{ background: COLORS.card, border: `1.5px solid ${COLORS.gold}` }}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Calendar size={18} color={COLORS.gold} />
            <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base font-bold">
              Assigned Days for: <span className="text-teal-800">{currentTpl.label}</span>
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-medium">Click any day pill below to add or remove it from this work plan</span>
        </div>

        {/* 7 Days Interactive Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          {WEEKDAY_NAMES.map((dName, dayIndex) => {
            const isAssignedToThis = (currentTpl.days || []).includes(dayIndex);
            
            const otherAssignedKey = !isAssignedToThis && templateKeys.find((k) => k !== activeKey && (templates[k].days || []).includes(dayIndex));
            const otherAssignedLabel = otherAssignedKey ? templates[otherAssignedKey]?.label?.split(' ')[0] : null;

            return (
              <button
                key={dName}
                onClick={() => onToggleDayAssignment(activeKey, dayIndex)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                  isAssignedToThis
                    ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs scale-105'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {isAssignedToThis ? <Check size={13} color="#FFF" /> : <span className="w-2 h-2 rounded-full bg-slate-300" />}
                <span>{WEEKDAY_SHORT[dayIndex]}</span>
                {otherAssignedLabel && (
                  <span className="text-[9px] font-normal text-slate-400">({otherAssignedLabel})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Day-Wise Skill Focus Assignment (Dropdown for each Day) */}
      <div className="rounded-2xl p-4 sm:p-5 shadow-xs bg-white border space-y-3" style={{ borderColor: COLORS.border }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={18} color={COLORS.tealDeep} />
            <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base font-bold">
              Day-Wise Skill Focus Assignment
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-medium">Assign target skill to study on each day (e.g. Mon &rarr; DBMS)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {WEEKDAY_NAMES.map((dName, dayIndex) => {
            const assignedSkill = skills ? skills.find((s) => {
              if (s.targetDays && Array.isArray(s.targetDays)) {
                return s.targetDays.includes(dayIndex);
              }
              return s.targetDay === dayIndex;
            }) : null;

            return (
              <div key={dName} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-teal-700" />
                    {dName} ({WEEKDAY_SHORT[dayIndex]})
                  </span>
                  {assignedSkill && (
                    <span
                      className="text-[10px] font-extrabold px-2 py-0.5 rounded-full truncate max-w-[100px]"
                      style={{ background: (assignedSkill.color || COLORS.tealMid) + '20', color: assignedSkill.color || COLORS.tealMid }}
                    >
                      {assignedSkill.name}
                    </span>
                  )}
                </div>

                <select
                  value={assignedSkill ? assignedSkill.id : ''}
                  onChange={(e) => {
                    const skillId = e.target.value;
                    if (onAssignSkillToDay) {
                      onAssignSkillToDay(dayIndex, skillId);
                    }
                  }}
                  className="w-full bg-white text-slate-800 text-xs rounded-lg px-2.5 py-1.5 border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-teal-700 cursor-pointer shadow-2xs"
                >
                  <option value="">-- No Skill Focus --</option>
                  {skills && skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Task List Items for Selected Schedule */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-lg font-bold">
            Work Plan Items ({currentTpl.tasks.length} Sessions)
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onCopyTemplate(activeKey)}
              className="flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 cursor-pointer"
              title="Duplicate this schedule"
            >
              <Copy size={13} /> Duplicate Plan
            </button>
            {currentTpl.isCustom && (
              <button
                onClick={() => onDeleteTemplate(activeKey)}
                className="flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 cursor-pointer"
              >
                <Trash2 size={13} /> Delete Group
              </button>
            )}
          </div>
        </div>

        {currentTpl.tasks.length === 0 && (
          <div className="text-center py-6 px-4 rounded-xl border border-dashed text-slate-500 text-xs bg-slate-50">
            No tasks in this schedule group yet. Click "+ Add Session / Task" below to add tasks.
          </div>
        )}

        {currentTpl.tasks.map((task, idx) => (
          <div key={task.id} className="rounded-xl p-3.5 sm:p-4 space-y-3 shadow-xs" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
            <div className="flex items-center gap-2">
              <input
                value={task.title}
                onChange={(e) => updateTask(idx, { title: e.target.value })}
                className="flex-1 text-xs sm:text-sm font-semibold px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl outline-none transition-all focus:ring-2 focus:ring-teal-700/20"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
                placeholder="Task title"
              />
              <MicButton fieldName={`Task ${idx + 1} Title`} currentValue={task.title} onAppendText={(val) => updateTask(idx, { title: val })} />
              <button onClick={() => removeTask(idx)} className="p-1.5 sm:p-2 rounded-xl shrink-0 transition-colors hover:bg-red-50 cursor-pointer" style={{ color: COLORS.learn }} aria-label="remove task">
                <Trash2 size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={task.time || ''}
                onChange={(e) => updateTask(idx, { time: e.target.value })}
                className="text-xs px-3 py-1.5 rounded-xl outline-none flex-1 min-w-[110px]"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
                placeholder="Time e.g. 7:00 AM"
              />
              <input
                value={task.duration || ''}
                onChange={(e) => updateTask(idx, { duration: e.target.value })}
                className="text-xs px-3 py-1.5 rounded-xl outline-none flex-1 min-w-[100px]"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
                placeholder="Duration e.g. 1 hr"
              />
              <select
                value={task.skill || 'personal'}
                onChange={(e) => updateTask(idx, { skill: e.target.value })}
                className="text-xs px-3 py-1.5 rounded-xl outline-none flex-1 min-w-[130px] font-medium"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              >
                <option value="personal">Personal / General (No Skill)</option>
                {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 pt-2">
        <button onClick={addTask} className="flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-bold shadow-xs cursor-pointer transition-all hover:opacity-90" style={{ background: COLORS.gold, color: COLORS.tealDeep }}>
          <Plus size={15} /> Add Task Item
        </button>
        <button onClick={() => onResetTemplate(activeKey)} className="flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-semibold border cursor-pointer transition-all hover:bg-slate-100" style={{ background: COLORS.card, borderColor: COLORS.border, color: COLORS.muted }}>
          <RotateCcw size={14} /> Reset to Default
        </button>
      </div>

      {/* Modal / Add Group Form */}
      {showAddGroupModal && (
        <form onSubmit={handleCreateCustomGroup} className="rounded-2xl p-5 shadow-md border space-y-3 bg-white" style={{ borderColor: COLORS.gold }}>
          <div className="flex items-center justify-between font-bold text-sm" style={{ color: COLORS.ink }}>
            <span>Add Custom Schedule Group</span>
            <button type="button" onClick={() => setShowAddGroupModal(false)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          <input
            required
            value={newGroupLabel}
            onChange={(e) => setNewGroupLabel(e.target.value)}
            placeholder="Schedule Label e.g. Exam Sprint / Weekend Intensive"
            className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-xl outline-none"
            style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
          />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setShowAddGroupModal(false)} className="px-3 py-1.5 text-xs rounded-xl bg-slate-100">Cancel</button>
            <button type="submit" className="px-4 py-1.5 text-xs font-bold rounded-xl" style={{ background: COLORS.gold, color: COLORS.tealDeep }}>Create Schedule</button>
          </div>
        </form>
      )}
    </div>
  );
}

function AccountSettingsSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteMsg, setDeleteMsg] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'New passwords do not match' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'New password must be at least 6 characters long' });
      return;
    }

    setPasswordBusy(true);
    try {
      const token = localStorage.getItem('traject_token');
      const res = await fetch(`${API_BASE}/auth/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update password');
      }

      setPasswordMsg({ type: 'success', text: 'Password updated successfully!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordMsg({ type: 'error', text: err.message || 'Error updating password' });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleDeleteAccount(e) {
    e.preventDefault();
    setDeleteMsg(null);

    if (deleteConfirmInput !== 'DELETE') {
      setDeleteMsg({ type: 'error', text: 'Please type DELETE to confirm account deletion' });
      return;
    }

    setDeleteBusy(true);
    try {
      const token = localStorage.getItem('traject_token');
      const res = await fetch(`${API_BASE}/auth/account`, {
        method: 'DELETE',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete account');
      }

      localStorage.removeItem('traject_token');
      if (window.storage) delete window.storage;
      window.location.reload();
    } catch (err) {
      setDeleteMsg({ type: 'error', text: err.message || 'Error deleting account' });
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-5 sm:p-7 shadow-xs space-y-4 bg-white border" style={{ borderColor: COLORS.border }}>
        <div>
          <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base sm:text-lg font-bold mb-1">
            Change Password
          </h3>
          <p className="text-xs text-slate-500">Update your account login password.</p>
        </div>

        {passwordMsg && (
          <div className={`p-3 rounded-xl text-xs font-semibold ${
            passwordMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {passwordMsg.text}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-3 max-w-md">
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: COLORS.ink }}>Current Password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-xl outline-none"
              style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: COLORS.ink }}>New Password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min. 6 characters)"
              className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-xl outline-none"
              style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: COLORS.ink }}>Confirm New Password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-xl outline-none"
              style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
            />
          </div>

          <button
            type="submit"
            disabled={passwordBusy}
            className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-xs cursor-pointer disabled:opacity-50"
            style={{ background: COLORS.gold, color: COLORS.tealDeep }}
          >
            {passwordBusy ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>

      <div className="rounded-2xl p-5 sm:p-7 shadow-xs space-y-4 bg-white border" style={{ borderColor: COLORS.border }}>
        <div>
          <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.learn }} className="text-base sm:text-lg font-bold mb-1">
            Delete Account
          </h3>
          <p className="text-xs text-slate-500">
            Permanently delete your account and all associated schedule, progress, and skill data. This action cannot be undone.
          </p>
        </div>

        {deleteMsg && (
          <div className="p-3 rounded-xl text-xs font-semibold bg-red-50 text-red-800 border border-red-200">
            {deleteMsg.text}
          </div>
        )}

        <form onSubmit={handleDeleteAccount} className="space-y-3 max-w-md">
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: COLORS.ink }}>
              Type <span className="font-mono text-red-600 font-extrabold">DELETE</span> to confirm
            </label>
            <input
              type="text"
              required
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              placeholder="Type DELETE"
              className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-xl outline-none font-mono"
              style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
            />
          </div>

          <button
            type="submit"
            disabled={deleteConfirmInput !== 'DELETE' || deleteBusy}
            className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-xs cursor-pointer bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-700 transition-colors"
          >
            {deleteBusy ? 'Deleting Account...' : 'Permanently Delete Account'}
          </button>
        </form>
      </div>
    </div>
  );
}


/* -------------------------------- SETTINGS VIEW -------------------------------- */
function SettingsView({
  templates,
  onUpdateTemplate,
  onToggleDayAssignment,
  onResetTemplate,
  onAddCustomTemplate,
  onDeleteTemplate,
  onCopyTemplate,
  skills,
  onAssignSkillToDay,
  dashboardPrefs,
  onUpdateDashboardPrefs,
  confirmReset,
  setConfirmReset,
  onResetAll,
}) {
  const [subTab, setSubTab] = useState('schedule');

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl font-bold mb-1">
          Settings & Configuration
        </h2>
        <p className="text-xs sm:text-sm" style={{ color: COLORS.muted }}>
          Manage your schedule templates, dashboard display preferences, account, and data reset.
        </p>
      </div>

      <div className="flex items-center gap-2 border-b pb-3 flex-wrap" style={{ borderColor: COLORS.border }}>
        <button
          onClick={() => setSubTab('schedule')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            subTab === 'schedule' ? 'bg-teal-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Weekly Schedule
        </button>
        <button
          onClick={() => setSubTab('display')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            subTab === 'display' ? 'bg-teal-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Dashboard Display
        </button>
        <button
          onClick={() => setSubTab('account')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            subTab === 'account' ? 'bg-teal-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Account
        </button>
        <button
          onClick={() => setSubTab('data')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            subTab === 'data' ? 'bg-teal-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Data Management
        </button>
      </div>

      {subTab === 'schedule' && (
        <ScheduleView
          templates={templates}
          onUpdateTemplate={onUpdateTemplate}
          onToggleDayAssignment={onToggleDayAssignment}
          onResetTemplate={onResetTemplate}
          onAddCustomTemplate={onAddCustomTemplate}
          onDeleteTemplate={onDeleteTemplate}
          onCopyTemplate={onCopyTemplate}
          skills={skills}
          onAssignSkillToDay={onAssignSkillToDay}
        />
      )}

      {subTab === 'display' && (
        <div className="rounded-2xl p-5 sm:p-7 shadow-xs space-y-5 bg-white border" style={{ borderColor: COLORS.border }}>
          <div>
            <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base sm:text-lg font-bold mb-1">
              Dashboard Cards Preferences
            </h3>
            <p className="text-xs text-slate-500">Toggle which summary cards to display on your main Dashboard overview.</p>
          </div>

          <div className="space-y-3 pt-2">
            <label className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer transition-all hover:bg-slate-100">
              <input
                type="checkbox"
                checked={!!dashboardPrefs.showOverall}
                onChange={(e) => onUpdateDashboardPrefs({ ...dashboardPrefs, showOverall: e.target.checked })}
                className="w-4 h-4 rounded text-teal-700 accent-teal-700 cursor-pointer"
              />
              <div>
                <div className="text-xs sm:text-sm font-bold text-slate-800">Overall Progress Ring Card</div>
                <div className="text-[11px] text-slate-500">Shows overall completion percentage ring across all active roadmaps</div>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer transition-all hover:bg-slate-100">
              <input
                type="checkbox"
                checked={!!dashboardPrefs.showStreak}
                onChange={(e) => onUpdateDashboardPrefs({ ...dashboardPrefs, showStreak: e.target.checked })}
                className="w-4 h-4 rounded text-teal-700 accent-teal-700 cursor-pointer"
              />
              <div>
                <div className="text-xs sm:text-sm font-bold text-slate-800">Active Day Streak Card</div>
                <div className="text-[11px] text-slate-500">Shows flame counter for consecutive active days</div>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer transition-all hover:bg-slate-100">
              <input
                type="checkbox"
                checked={!!dashboardPrefs.showToday}
                onChange={(e) => onUpdateDashboardPrefs({ ...dashboardPrefs, showToday: e.target.checked })}
                className="w-4 h-4 rounded text-teal-700 accent-teal-700 cursor-pointer"
              />
              <div>
                <div className="text-xs sm:text-sm font-bold text-slate-800">Today's Checklist Card</div>
                <div className="text-[11px] text-slate-500">Displays today's completion rate and button to open Today view</div>
              </div>
            </label>
          </div>
        </div>
      )}

      {subTab === 'account' && <AccountSettingsSection />}

      {subTab === 'data' && (
        <div className="rounded-2xl p-5 sm:p-7 shadow-xs space-y-4 bg-white border" style={{ borderColor: COLORS.border }}>
          <div>
            <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base sm:text-lg font-bold mb-1">
              Reset Application Data
            </h3>
            <p className="text-xs text-slate-500">Resetting will clear all stored skill steps progress, daily task logs, custom skills, and schedules.</p>
          </div>

          <div className="pt-3 border-t" style={{ borderColor: COLORS.border }}>
            <button
              onClick={() => (confirmReset ? onResetAll() : setConfirmReset(true))}
              onBlur={() => setConfirmReset(false)}
              className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer shadow-xs"
              style={{
                color: confirmReset ? '#FFF' : COLORS.learn,
                background: confirmReset ? COLORS.learn : COLORS.learn + '1A',
                border: `1px solid ${COLORS.learn}`,
              }}
            >
              {confirmReset ? '⚠ Click again to confirm — this clears all progress' : 'Reset all progress'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------- APP ------------------------------------ */
export default function App() {
  // Default page set to 'today' (Today Plan opens first!)
  const [view, setView] = useState('today');
  const [activeSkillId, setActiveSkillId] = useState(null);
  const [skills, setSkills] = useState([]);
  const [plannerEvents, setPlannerEvents] = useState([]);
  const [progress, setProgress] = useState({});
  const [daily, setDaily] = useState({});
  const [catchup, setCatchup] = useState({});
  const [templates, setTemplates] = useState(() => cloneTemplates(DEFAULT_TEMPLATES));
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState(0);
  const [extraTasks, setExtraTasks] = useState([]);
  const [historyDays, setHistoryDays] = useState(null);
  const [missedTasks, setMissedTasks] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [modalState, setModalState] = useState(null); // null or { isOpen: true, skill: skillObj || null }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addNewTaskModalOpen, setAddNewTaskModalOpen] = useState(false);
  const [dashboardPrefs, setDashboardPrefs] = useState({
    showOverall: true,
    showStreak: true,
    showToday: true,
  });

  const updateDashboardPrefs = useCallback((newPrefs) => {
    setDashboardPrefs(newPrefs);
    storageHelper.set('dashboard-prefs', JSON.stringify(newPrefs)).catch(() => {});
  }, []);

  const handleOpenAddModal = useCallback(() => {
    setModalState({ isOpen: true, skill: null });
  }, []);

  const handleOpenEditModal = useCallback((skill) => {
    setModalState({ isOpen: true, skill });
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalState(null);
  }, []);

  const skillsById = useMemo(() => Object.fromEntries(skills.map((s) => [s.id, s])), [skills]);

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => dateKey(today), [today]);
  
  // Dynamic template selection based on day assignment
  const template = useMemo(() => getTemplateForDate(today, templates), [today, templates]);
  const dateStr = useMemo(() => today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }), [today]);

  const computeStreak = useCallback(async (currentDailyMap) => {
    let s = 0;
    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() - 1);
    for (let i = 0; i < 60; i++) {
      const k = dateKey(cursor);
      try {
        const r = await storageHelper.get(`daily:${k}`);
        if (!r) break;
        const map = JSON.parse(r.value);
        if (!Object.values(map).some(Boolean)) break;
        s++;
      } catch {
        break;
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    if (currentDailyMap && Object.values(currentDailyMap).some(Boolean)) {
      s++;
    }
    return s;
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Load Skills from user-skills (with one-time cleanup of legacy default keys)
      const OLD_DEFAULT_KEYS = [
        'skill-steps:ba',
        'skill-steps:fullstack',
        'skill-steps:aptitude',
        'skill-steps:dsa',
        'skill-steps:pm',
        'skill-steps:ml',
        'skill-steps:gita',
      ];

      let loadedSkills = null;
      try {
        const r = await storageHelper.get('user-skills');
        if (r && r.value !== undefined && r.value !== null) {
          loadedSkills = JSON.parse(r.value);
        }
      } catch (e) {
        console.warn('Error reading user-skills:', e);
      }

      if (Array.isArray(loadedSkills)) {
        loadedSkills = loadedSkills.filter((s) => !['ba', 'fullstack', 'aptitude', 'dsa', 'pm', 'ml', 'gita'].includes(s.id));
      } else {
        loadedSkills = [];
      }

      for (const oldKey of OLD_DEFAULT_KEYS) {
        await storageHelper.delete(oldKey).catch(() => {});
      }
      await storageHelper.set('user-skills', JSON.stringify(loadedSkills)).catch(() => {});

      // Load Planner Events
      let loadedPlanner = [];
      try {
        const r = await storageHelper.get('planner_events');
        if (r) loadedPlanner = JSON.parse(r.value);
      } catch {
        loadedPlanner = [];
      }

      // Load Custom Schedules / Templates
      let loadedTemplates = cloneTemplates(DEFAULT_TEMPLATES);
      try {
        const r = await storageHelper.get('schedule_templates_v2');
        if (r && r.value) {
          const parsed = JSON.parse(r.value);
          let hasOld = false;
          for (const key of Object.keys(parsed)) {
            if (parsed[key].tasks) {
              const cleanedTasks = parsed[key].tasks.filter(
                (t) => !['t-gita', 't-ba', 't-fs', 't-dsa', 't-ml', 't-ap', 't-pm', 't-ba-rev', 't-fs-proj', 't-mock', 't-ml-catch', 't-plan'].includes(t.id)
              );
              if (cleanedTasks.length !== parsed[key].tasks.length) {
                parsed[key].tasks = cleanedTasks;
                hasOld = true;
              }
            }
          }
          if (hasOld) {
            await storageHelper.set('schedule_templates_v2', JSON.stringify(parsed)).catch(() => {});
          }
          loadedTemplates = parsed;
        } else {
          await storageHelper.set('schedule_templates_v2', JSON.stringify(loadedTemplates)).catch(() => {});
        }
      } catch {
        loadedTemplates = cloneTemplates(DEFAULT_TEMPLATES);
      }

      const prog = {};
      for (const skill of loadedSkills) {
        try {
          const r = await storageHelper.get(`skill-steps:${skill.id}`);
          prog[skill.id] = r ? JSON.parse(r.value) : {};
        } catch {
          prog[skill.id] = {};
        }
      }

      let dailyMap = {};
      try {
        const r = await storageHelper.get(`daily:${todayKey}`);
        dailyMap = r ? JSON.parse(r.value) : {};
      } catch {
        dailyMap = {};
      }

      let catchupMap = {};
      try {
        const r = await storageHelper.get(`catchup:${todayKey}`);
        catchupMap = r ? JSON.parse(r.value) : {};
      } catch {
        catchupMap = {};
      }

      let loadedExtra = [];
      try {
        const r = await storageHelper.get(`extra-tasks:${todayKey}`);
        loadedExtra = r ? JSON.parse(r.value) : [];
      } catch {
        loadedExtra = [];
      }

      let loadedPrefs = { showOverall: true, showStreak: true, showToday: true };
      try {
        const r = await storageHelper.get('dashboard-prefs');
        if (r && r.value) {
          loadedPrefs = { ...loadedPrefs, ...JSON.parse(r.value) };
        }
      } catch {
        loadedPrefs = { showOverall: true, showStreak: true, showToday: true };
      }

      const calculatedStreak = await computeStreak(dailyMap);

      if (!cancelled) {
        setSkills(loadedSkills);
        setPlannerEvents(loadedPlanner);
        setProgress(prog);
        setTemplates(loadedTemplates);
        setDaily(dailyMap);
        setCatchup(catchupMap);
        setExtraTasks(loadedExtra);
        setDashboardPrefs(loadedPrefs);
        setStreak(calculatedStreak);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [todayKey, computeStreak]);

  // History tracking since Aug 26, 2026
  useEffect(() => {
    if (view === 'history' && historyDays === null && !loading) {
      (async () => {
        const days = [];
        const cursor = new Date();
        const startTimestamp = new Date(APP_START_DATE + 'T00:00:00').getTime();

        for (let i = 0; i < 365; i++) {
          if (cursor.getTime() < startTimestamp - 86400000) break;

          const k = dateKey(cursor);
          const tpl = getTemplateForDate(cursor, templates);
          let map = {};
          try {
            const r = await storageHelper.get(`daily:${k}`);
            map = r ? JSON.parse(r.value) : {};
          } catch {
            map = {};
          }
          let extraForDate = [];
          try {
            const r = await storageHelper.get(`extra-tasks:${k}`);
            extraForDate = r ? JSON.parse(r.value) : [];
          } catch {
            extraForDate = [];
          }
          const allDayTasks = [...tpl.tasks, ...extraForDate];
          const taskDetails = allDayTasks.map((t) => ({ skill: t.skill, done: !!map[t.id] }));
          const done = taskDetails.filter((t) => t.done).length;
          days.push({ key: k, date: new Date(cursor), done, total: allDayTasks.length, taskDetails });
          cursor.setDate(cursor.getDate() - 1);
        }
        setHistoryDays(days.reverse());
      })();
    }
  }, [view, historyDays, loading, templates]);

  // missed tasks from the last 5 days
  useEffect(() => {
    if (view === 'today' && missedTasks === null && !loading) {
      (async () => {
        const missed = [];
        const cursor = new Date();
        cursor.setDate(cursor.getDate() - 1);
        const startTimestamp = new Date(APP_START_DATE + 'T00:00:00').getTime();

        for (let i = 0; i < 5; i++) {
          if (cursor.getTime() < startTimestamp) break;

          const k = dateKey(cursor);
          const tpl = getTemplateForDate(cursor, templates);
          let map = {};
          try {
            const r = await storageHelper.get(`daily:${k}`);
            map = r ? JSON.parse(r.value) : {};
          } catch {
            map = {};
          }
          let extraForDate = [];
          try {
            const r = await storageHelper.get(`extra-tasks:${k}`);
            extraForDate = r ? JSON.parse(r.value) : [];
          } catch {
            extraForDate = [];
          }
          const dateLabel = cursor.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

          const validTasks = [...(tpl.tasks || []), ...extraForDate].filter(
            (t) => t.title && !['t-gita', 't-ba', 't-fs', 't-dsa', 't-ml', 't-ap', 't-pm', 't-ba-rev', 't-fs-proj', 't-mock', 't-ml-catch', 't-plan'].includes(t.id)
          );

          validTasks.forEach((t) => {
            if (!map[t.id]) missed.push({ date: k, dateLabel, task: t });
          });
          cursor.setDate(cursor.getDate() - 1);
        }
        setMissedTasks(missed);
      })();
    }
  }, [view, missedTasks, loading, templates]);

  const saveSkill = useCallback((skillData) => {
    setSkills((prev) => {
      const existingIdx = prev.findIndex((s) => s.id === skillData.id);
      let next;
      if (existingIdx >= 0) {
        next = prev.map((s) => (s.id === skillData.id ? skillData : s));
      } else {
        next = [...prev, skillData];
      }
      storageHelper.set('user-skills', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const assignSkillToDay = useCallback((dayIndex, skillId) => {
    setSkills((prev) => {
      const next = prev.map((s) => {
        const targetDays = Array.isArray(s.targetDays)
          ? [...s.targetDays]
          : (s.targetDay !== undefined && s.targetDay !== null ? [s.targetDay] : []);

        if (s.id === skillId) {
          if (!targetDays.includes(dayIndex)) {
            targetDays.push(dayIndex);
          }
          return { ...s, targetDays, targetDay: dayIndex };
        } else {
          const filtered = targetDays.filter((d) => d !== dayIndex);
          return { ...s, targetDays: filtered, targetDay: filtered.length > 0 ? filtered[0] : null };
        }
      });
      storageHelper.set('user-skills', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const deleteSkill = useCallback(async (skillId) => {
    if (!window.confirm('Delete this skill and all its progress?')) return;

    setSkills((prev) => {
      const next = prev.filter((s) => s.id !== skillId);
      storageHelper.set('user-skills', JSON.stringify(next)).catch(() => {});
      return next;
    });

    await storageHelper.delete(`skill-steps:${skillId}`).catch(() => {});
    setProgress((prev) => {
      const next = { ...prev };
      delete next[skillId];
      return next;
    });
  }, []);

  const addPlannerEvent = useCallback((newEvt) => {
    setPlannerEvents((prev) => {
      const next = [...prev, newEvt];
      storageHelper.set('planner_events', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const deletePlannerEvent = useCallback((evtId) => {
    setPlannerEvents((prev) => {
      const next = prev.filter((e) => e.id !== evtId);
      storageHelper.set('planner_events', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const togglePlannerEvent = useCallback((evtId) => {
    setPlannerEvents((prev) => {
      const next = prev.map((e) => (e.id === evtId ? { ...e, done: !e.done } : e));
      storageHelper.set('planner_events', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const toggleStep = useCallback((skillId, stepId) => {
    setProgress((prev) => {
      const skillMap = { ...(prev[skillId] || {}) };
      skillMap[stepId] = !skillMap[stepId];
      const next = { ...prev, [skillId]: skillMap };
      storageHelper.set(`skill-steps:${skillId}`, JSON.stringify(skillMap)).catch(() => {});
      return next;
    });
  }, []);

  const toggleDaily = useCallback((taskId) => {
    setDaily((prev) => {
      const next = { ...prev, [taskId]: !prev[taskId] };
      storageHelper.set(`daily:${todayKey}`, JSON.stringify(next)).catch(() => {});
      computeStreak(next).then(setStreak);
      return next;
    });
    setHistoryDays(null);
  }, [todayKey, computeStreak]);

  const toggleCatchup = useCallback((origDate, taskId) => {
    const key = `${origDate}|${taskId}`;
    setCatchup((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      storageHelper.set(`catchup:${todayKey}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [todayKey]);

  // Handle template updates & day assignments
  const updateTemplate = useCallback((templateKey, updatedTpl) => {
    setTemplates((prev) => {
      const next = { ...prev, [templateKey]: updatedTpl };
      storageHelper.set('schedule_templates_v2', JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
    setMissedTasks(null);
  }, []);

  const toggleDayAssignment = useCallback((targetKey, dayIndex) => {
    setTemplates((prev) => {
      const isAlreadyAssignedToTarget = (prev[targetKey]?.days || []).includes(dayIndex);
      const next = { ...prev };

      // Remove dayIndex from all templates
      for (const k of Object.keys(next)) {
        next[k] = {
          ...next[k],
          days: (next[k].days || []).filter((d) => d !== dayIndex),
        };
      }

      // If it was NOT assigned to targetKey, add it to targetKey (toggle ON).
      // If it WAS assigned to targetKey, leave it removed (toggle OFF).
      if (!isAlreadyAssignedToTarget) {
        const currentDays = next[targetKey].days || [];
        next[targetKey] = {
          ...next[targetKey],
          days: [...currentDays, dayIndex].sort(),
        };
      }

      storageHelper.set('schedule_templates_v2', JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
    setMissedTasks(null);
  }, []);

  const addCustomTemplate = useCallback((newKey, newTemplate) => {
    setTemplates((prev) => {
      const next = { ...prev, [newKey]: newTemplate };
      storageHelper.set('schedule_templates_v2', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const deleteTemplate = useCallback((targetKey) => {
    setTemplates((prev) => {
      const next = { ...prev };
      delete next[targetKey];
      storageHelper.set('schedule_templates_v2', JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
    setMissedTasks(null);
  }, []);

  const copyTemplate = useCallback((sourceKey) => {
    setTemplates((prev) => {
      const source = prev[sourceKey];
      if (!source) return prev;
      const copyKey = `copy-${Date.now()}`;
      const copyTpl = {
        ...source,
        id: copyKey,
        label: `${source.label} (Copy)`,
        days: [],
        tasks: source.tasks.map((t) => ({ ...t, id: `task-cp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}` })),
        isCustom: true,
      };
      const next = { ...prev, [copyKey]: copyTpl };
      storageHelper.set('schedule_templates_v2', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const resetTemplate = useCallback((type) => {
    setTemplates((prev) => {
      const next = cloneTemplates(DEFAULT_TEMPLATES);
      storageHelper.set('schedule_templates_v2', JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
    setMissedTasks(null);
  }, []);

  const openSkill = useCallback((skillId) => {
    setActiveSkillId(skillId);
    setView('skill');
  }, []);

  const addExtraTask = useCallback((taskData) => {
    const newTask = {
      id: `extra-${Date.now()}`,
      title: taskData.title,
      skill: taskData.skill,
      duration: taskData.duration || '',
      time: 'Extra Task',
    };
    setExtraTasks((prev) => {
      const next = [...prev, newTask];
      storageHelper.set(`extra-tasks:${todayKey}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
  }, [todayKey]);

  const addMultipleExtraTasks = useCallback((tasksList) => {
    if (!Array.isArray(tasksList) || tasksList.length === 0) return;
    const newTasks = tasksList
      .map((t, idx) => ({
        id: `extra-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
        title: typeof t === 'string' ? t : t.title || '',
        skill: 'personal',
        duration: '',
        time: 'Extra Task',
      }))
      .filter((t) => t.title.trim() !== '');

    if (newTasks.length === 0) return;

    setExtraTasks((prev) => {
      const next = [...prev, ...newTasks];
      storageHelper.set(`extra-tasks:${todayKey}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
  }, [todayKey]);

  const editExtraTask = useCallback((taskId, updatedData) => {
    setExtraTasks((prev) => {
      const next = prev.map((t) => (t.id === taskId ? { ...t, ...updatedData } : t));
      storageHelper.set(`extra-tasks:${todayKey}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
  }, [todayKey]);

  const deleteExtraTask = useCallback((taskId) => {
    setExtraTasks((prev) => {
      const next = prev.filter((t) => t.id !== taskId);
      storageHelper.set(`extra-tasks:${todayKey}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setDaily((prev) => {
      const next = { ...prev };
      delete next[taskId];
      storageHelper.set(`daily:${todayKey}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
  }, [todayKey]);

  const editTemplateTask = useCallback((taskId, updatedData) => {
    setTemplates((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[k].tasks) {
          next[k] = {
            ...next[k],
            tasks: next[k].tasks.map((t) => (t.id === taskId ? { ...t, ...updatedData } : t)),
          };
        }
      }
      storageHelper.set('schedule_templates_v2', JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
  }, []);

  const deleteTemplateTask = useCallback((taskId) => {
    setTemplates((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[k].tasks) {
          next[k] = {
            ...next[k],
            tasks: next[k].tasks.filter((t) => t.id !== taskId),
          };
        }
      }
      storageHelper.set('schedule_templates_v2', JSON.stringify(next)).catch(() => {});
      return next;
    });
    setDaily((prev) => {
      const next = { ...prev };
      delete next[taskId];
      storageHelper.set(`daily:${todayKey}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setHistoryDays(null);
  }, [todayKey]);

  async function resetAll() {
    try {
      for (const prefix of ['skill-steps:', 'daily:', 'catchup:', 'schedule:', 'schedule_templates_v2', 'user-skills', 'custom_skills', 'planner_events', 'extra-tasks:']) {
        const listed = await storageHelper.list(prefix);
        if (listed?.keys) {
          for (const k of listed.keys) await storageHelper.delete(k).catch(() => {});
        }
      }
    } catch {
      // ignore
    }
    await storageHelper.set('user-skills', JSON.stringify([])).catch(() => {});
    setSkills([]);
    setPlannerEvents([]);
    setProgress({});
    setDaily({});
    setCatchup({});
    setExtraTasks([]);
    setTemplates(cloneTemplates(DEFAULT_TEMPLATES));
    setHistoryDays(null);
    setMissedTasks(null);
    setStreak(0);
    setConfirmReset(false);
  }

  const combinedTodayTasks = useMemo(() => {
    return [...template.tasks, ...extraTasks];
  }, [template.tasks, extraTasks]);

  const overallTotal = skills.reduce((sum, s) => sum + s.steps.length, 0);
  const overallDone = skills.reduce((sum, s) => sum + s.steps.filter((step) => (progress[s.id] || {})[step.id]).length, 0);
  const overallPercent = overallTotal ? Math.round((overallDone / overallTotal) * 100) : 0;
  const todayDoneCount = combinedTodayTasks.filter((t) => daily[t.id]).length;
  const todayPercent = combinedTodayTasks.length ? Math.round((todayDoneCount / combinedTodayTasks.length) * 100) : 0;

  const pendingMissedCount = useMemo(() => {
    if (!missedTasks) return 0;
    return missedTasks.filter((m) => !catchup[`${m.date}|${m.task.id}`]).length;
  }, [missedTasks, catchup]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.bg }}>
        <style>{FONT_IMPORT}</style>
        <div className="flex flex-col items-center gap-4 bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
          <div className="w-12 h-12 rounded-full border-4 animate-spin" style={{ borderColor: COLORS.border, borderTopColor: COLORS.gold }} />
          <div className="text-sm font-semibold" style={{ color: COLORS.ink, fontFamily: 'Inter, sans-serif' }}>Loading your learning roadmap…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 md:pb-12" style={{ background: COLORS.bg, fontFamily: 'Inter, sans-serif' }}>
      <style>{FONT_IMPORT}</style>
      <NavBar
        view={view}
        setView={(v) => { setView(v); if (v !== 'skill') setActiveSkillId(null); }}
        onOpenDrawer={() => setDrawerOpen(true)}
        pendingMissedCount={pendingMissedCount}
      />
      <TaglineBanner />

      <ProfileDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        setView={(v) => { setView(v); if (v !== 'skill') setActiveSkillId(null); }}
        pendingMissedCount={pendingMissedCount}
      />

      <div className="max-w-6xl mx-auto px-3.5 sm:px-6 py-5 sm:py-8">
        {view === 'today' && (
          <TodayView
            template={template}
            daily={daily}
            onToggle={toggleDaily}
            todayPercent={todayPercent}
            dateStr={dateStr}
            onNavigateSkill={openSkill}
            onViewHistory={() => setView('history')}
            missedTasks={missedTasks}
            catchup={catchup}
            onToggleCatchup={toggleCatchup}
            skillsById={skillsById}
            extraTasks={extraTasks}
            onAddExtraTask={addExtraTask}
            onAddMultipleExtraTasks={addMultipleExtraTasks}
            onEditExtraTask={editExtraTask}
            onDeleteExtraTask={deleteExtraTask}
            onEditTemplateTask={editTemplateTask}
            onDeleteTemplateTask={deleteTemplateTask}
            skills={skills}
            onOpenAddNewTask={() => setAddNewTaskModalOpen(true)}
          />
        )}
        {view === 'dashboard' && (
          <DashboardView
            skills={skills}
            progress={progress}
            overallPercent={overallPercent}
            streak={streak}
            todayPercent={todayPercent}
            dayLabel={template.label}
            onOpenSkill={openSkill}
            onGoToday={() => setView('today')}
            onAddSkill={handleOpenAddModal}
            onEditSkill={handleOpenEditModal}
            onDeleteSkill={deleteSkill}
            dashboardPrefs={dashboardPrefs}
          />
        )}
        {view === 'planner' && (
          <PlannerView
            plannerEvents={plannerEvents}
            onAddEvent={addPlannerEvent}
            onDeleteEvent={deletePlannerEvent}
            onToggleEvent={togglePlannerEvent}
            onOpenAddNewTask={() => setAddNewTaskModalOpen(true)}
          />
        )}
        {view === 'skills' && (
          <SkillsGridView
            skills={skills}
            progress={progress}
            onOpenSkill={openSkill}
            onAddSkill={handleOpenAddModal}
            onEditSkill={handleOpenEditModal}
            onDeleteSkill={deleteSkill}
          />
        )}
        {view === 'skill' && activeSkillId && (
          <SkillDetailView skill={skillsById[activeSkillId]} progress={progress} onToggleStep={toggleStep} onBack={() => setView('skills')} />
        )}
        {view === 'history' && (
          <HistoryView
            historyDays={historyDays}
            templates={templates}
            skillsById={skillsById}
            skills={skills}
            progress={progress}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            templates={templates}
            onUpdateTemplate={updateTemplate}
            onToggleDayAssignment={toggleDayAssignment}
            onResetTemplate={resetTemplate}
            onAddCustomTemplate={addCustomTemplate}
            onDeleteTemplate={deleteTemplate}
            onCopyTemplate={copyTemplate}
            skills={skills}
            onAssignSkillToDay={assignSkillToDay}
            dashboardPrefs={dashboardPrefs}
            onUpdateDashboardPrefs={updateDashboardPrefs}
            confirmReset={confirmReset}
            setConfirmReset={setConfirmReset}
            onResetAll={resetAll}
          />
        )}
      </div>

      <MobileBottomNav view={view} setView={(v) => { setView(v); if (v !== 'skill') setActiveSkillId(null); }} />

      <AddNewTaskModal
        isOpen={addNewTaskModalOpen}
        onClose={() => setAddNewTaskModalOpen(false)}
        onAddTask={(taskData) => {
          addExtraTask(taskData);
        }}
        skills={skills}
      />

      <SkillModal
        isOpen={!!modalState}
        editingSkill={modalState?.skill}
        onClose={handleCloseModal}
        onSave={saveSkill}
      />
    </div>
  );
}
