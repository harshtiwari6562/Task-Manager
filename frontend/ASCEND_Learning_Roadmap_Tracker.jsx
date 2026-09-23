import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  LayoutDashboard, CalendarCheck, ListChecks, ChevronLeft, ChevronRight, CheckCircle2, Circle,
  Briefcase, Code2, Calculator, GitBranch, ClipboardList, Brain, BookOpen,
  Flame, Sparkles, ArrowRight, Settings, Plus, Trash2, RotateCcw, X, Shield, Calendar, Clock, Bell, BellRing, Check, Copy, Layers, CalendarDays, MoreVertical, Mic
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

function TaskRow({ title, subtitle, done, onToggle, color, onNavigate }) {
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
      {onNavigate && (
        <button onClick={onNavigate} className="shrink-0 p-1.5 sm:p-2 rounded-full transition-colors hover:bg-black/5 cursor-pointer" style={{ color }} aria-label="open roadmap">
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}

function SkillCard({ skill, percent, onClick, onEdit, onDelete }) {
  const [showMenu, setShowMenu] = useState(false);
  const Icon = getSkillIcon(skill.icon);

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

          <div className="relative" onClick={(e) => e.stopPropagation()}>
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

/* ---------------------------------- NAVBAR ---------------------------------- */
function NavBar({ view, setView }) {
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
        {/* Brand Logo */}
        <button onClick={() => setView('today')} className="flex items-center gap-2 shrink-0 cursor-pointer">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-400/20 flex items-center justify-center">
            <Sparkles size={17} color={COLORS.gold} />
          </div>
          <span style={{ fontFamily: 'Fraunces, serif', color: '#F5F3EE' }} className="text-base sm:text-xl font-bold tracking-wide">
            ASCEND
          </span>
        </button>

        {/* Responsive Navigation Tabs */}
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto py-0.5 no-scrollbar max-w-full">
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
                <span className="hidden xs:inline sm:inline">{it.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TaglineBanner() {
  return (
    <div style={{ background: '#0B2624', borderBottom: '1px solid rgba(255,255,255,0.06)' }} className="w-full">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-1.5 sm:py-2 flex items-center justify-between text-xs">
        <span style={{ fontFamily: 'Fraunces, serif', color: COLORS.goldLight }} className="italic font-medium tracking-wide text-[11px] sm:text-xs">
          "Ya Toh Win Hai, Ya Learn Hai"
        </span>
        <span className="text-emerald-400/80 font-mono text-[10px] sm:text-[11px] hidden xs:inline">
          ● Dynamic Day Pairing & Custom Schedules Enabled
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------- VIEWS ---------------------------------- */
function DashboardView({ skills, progress, overallPercent, streak, todayPercent, dayLabel, onOpenSkill, onGoToday, onAddSkill, onEditSkill, onDeleteSkill, dashboardPrefs }) {
  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Top Welcome Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl lg:text-3xl font-bold">
            Dashboard Overview
          </h1>
          <p className="text-xs sm:text-sm font-medium mt-0.5" style={{ color: COLORS.muted }}>
            Track overall progress, habits, and active learning roadmaps.
          </p>
        </div>
        <button
          onClick={onGoToday}
          className="flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-xs cursor-pointer transition-all hover:scale-[1.02] active:scale-95"
          style={{ background: COLORS.gold, color: COLORS.tealDeep }}
        >
          <CalendarCheck size={16} /> Open Today's Checklist ({todayPercent}%)
        </button>
      </div>

      {/* Responsive Stat Cards */}
      {(dashboardPrefs?.showOverall || dashboardPrefs?.showStreak || dashboardPrefs?.showToday) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-5">
          {/* Stat 1: Overall Progress */}
          {dashboardPrefs?.showOverall && (
            <div className="rounded-2xl p-4 sm:p-5 flex items-center gap-3.5 sm:gap-4 shadow-xs transition-all" style={{ background: COLORS.tealDeep }}>
              <ProgressRing percent={overallPercent} size={60} stroke={6} color={COLORS.gold} />
              <div className="min-w-0">
                <div className="text-2xl sm:text-3xl font-bold leading-tight" style={{ fontFamily: 'Fraunces, serif', color: '#F5F3EE' }}>
                  {overallPercent}%
                </div>
                <div className="text-xs font-medium truncate mt-0.5" style={{ color: '#B9C4C0' }}>Overall completion</div>
              </div>
            </div>
          )}

          {/* Stat 2: Day Streak */}
          {dashboardPrefs?.showStreak && (
            <div className="rounded-2xl p-4 sm:p-5 flex items-center gap-3.5 sm:gap-4 shadow-xs" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
              <div className="w-12 h-12 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center shrink-0" style={{ background: COLORS.gold + '22' }}>
                <Flame size={24} color={COLORS.gold} />
              </div>
              <div className="min-w-0">
                <div className="text-2xl sm:text-3xl font-bold leading-tight truncate" style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }}>
                  {streak} {streak === 1 ? 'Day' : 'Days'}
                </div>
                <div className="text-xs font-medium truncate mt-0.5" style={{ color: COLORS.muted }}>Active daily streak</div>
              </div>
            </div>
          )}

          {/* Stat 3: Today's Checklist */}
          {dashboardPrefs?.showToday && (
            <button onClick={onGoToday} className="rounded-2xl p-4 sm:p-5 flex items-center gap-3.5 sm:gap-4 text-left shadow-xs transition-all hover:border-teal-600 cursor-pointer" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
              <div className="w-12 h-12 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center shrink-0" style={{ background: COLORS.tealMid + '22' }}>
                <CalendarCheck size={24} color={COLORS.tealMid} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-2xl sm:text-3xl font-bold leading-tight truncate" style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }}>
                  {todayPercent}%
                </div>
                <div className="text-xs font-medium truncate mt-0.5" style={{ color: COLORS.muted }}>{dayLabel} checklist</div>
              </div>
            </button>
          )}
        </div>
      )}

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

function TodayView({ template, daily, onToggle, todayPercent, dateStr, onNavigateSkill, onViewHistory, missedTasks, catchup, onToggleCatchup, skillsById, extraTasks, onAddExtraTask, skills }) {
  const pendingMissed = missedTasks ? missedTasks.filter((m) => !catchup[`${m.date}|${m.task.id}`]).length : 0;
  const [showAddInline, setShowAddInline] = useState(false);
  const [extraTitle, setExtraTitle] = useState('');
  const [extraSkill, setExtraSkill] = useState('');
  const [extraDuration, setExtraDuration] = useState('');

  useEffect(() => {
    if (skills && skills.length > 0 && !extraSkill) {
      setExtraSkill(skills[0].id);
    }
  }, [skills, extraSkill]);

  function handleCreateExtra(e) {
    e.preventDefault();
    if (!extraTitle.trim()) return;
    onAddExtraTask({
      title: extraTitle.trim(),
      skill: extraSkill || skills[0]?.id || 'ba',
      duration: extraDuration.trim(),
    });
    setExtraTitle('');
    setExtraDuration('');
    setShowAddInline(false);
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="rounded-2xl p-5 sm:p-8 shadow-md" style={{ background: COLORS.tealDeep }}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: COLORS.goldLight }}>{template.label}</div>
            <div style={{ fontFamily: 'Fraunces, serif', color: '#F5F3EE' }} className="text-xl sm:text-3xl font-bold mt-1">{dateStr}</div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 bg-white/10 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl">
            <div className="text-right">
              <div className="text-xl sm:text-2xl font-bold" style={{ color: COLORS.gold, fontFamily: 'Fraunces, serif' }}>{todayPercent}%</div>
              <div className="text-[10px] sm:text-[11px]" style={{ color: '#B9C4C0' }}>completed today</div>
            </div>
            <ProgressRing percent={todayPercent} size={48} stroke={5} color={COLORS.gold} />
          </div>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden mt-4 sm:mt-6" style={{ background: 'rgba(255,255,255,0.12)' }}>
          <div className="h-full rounded-full" style={{ width: `${todayPercent}%`, background: COLORS.gold, transition: 'width .4s ease' }} />
        </div>
      </div>

      <div className="space-y-3">
        <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base sm:text-lg font-bold">Today's Action Items</h3>
        {template.tasks.map((task) => {
          const skill = skillsById[task.skill];
          const meta = [task.time, task.duration, skill?.name].filter(Boolean).join(' · ');
          return (
            <TaskRow
              key={task.id}
              title={task.title}
              subtitle={meta}
              done={!!daily[task.id]}
              onToggle={() => onToggle(task.id)}
              color={skill?.color || COLORS.tealMid}
              onNavigate={() => task.skill && onNavigateSkill(task.skill)}
            />
          );
        })}

        {extraTasks && extraTasks.map((task) => {
          const skill = skillsById[task.skill];
          const meta = ['Today Extra', task.duration, skill?.name].filter(Boolean).join(' · ');
          return (
            <TaskRow
              key={task.id}
              title={task.title}
              subtitle={meta}
              done={!!daily[task.id]}
              onToggle={() => onToggle(task.id)}
              color={skill?.color || COLORS.tealMid}
              onNavigate={() => task.skill && onNavigateSkill(task.skill)}
            />
          );
        })}

        {template.tasks.length === 0 && (!extraTasks || extraTasks.length === 0) && (
          <div className="text-center py-6 px-4 rounded-2xl border border-dashed bg-slate-50/50" style={{ borderColor: COLORS.border }}>
            <p className="text-xs sm:text-sm font-medium text-slate-500">
              No tasks scheduled for today yet. Add a task for today below or update your schedule in Settings → Weekly Schedule.
            </p>
          </div>
        )}

        {!showAddInline ? (
          <button
            onClick={() => setShowAddInline(true)}
            className="w-full py-3 rounded-2xl border-2 border-dashed flex items-center justify-center gap-2 text-xs font-bold transition-all hover:bg-slate-50 cursor-pointer"
            style={{ borderColor: COLORS.gold, color: COLORS.tealDeep }}
          >
            <Plus size={16} /> Add Task for Today Only
          </button>
        ) : (
          <form onSubmit={handleCreateExtra} className="rounded-2xl p-4 sm:p-5 border space-y-3 bg-white shadow-xs" style={{ borderColor: COLORS.gold }}>
            <div className="flex items-center justify-between font-bold text-xs" style={{ color: COLORS.ink }}>
              <span>Add Today's Extra Task</span>
              <button type="button" onClick={() => setShowAddInline(false)} className="text-slate-400 hover:text-slate-600">
                <X size={15} />
              </button>
            </div>
            <input
              required
              value={extraTitle}
              onChange={(e) => setExtraTitle(e.target.value)}
              placeholder="Task Title e.g. Extra BA Practice Session"
              className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-xl outline-none"
              style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={extraSkill}
                onChange={(e) => setExtraSkill(e.target.value)}
                className="text-xs px-3 py-2 rounded-xl outline-none flex-1 min-w-[130px] font-medium"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              >
                {skills && skills.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input
                value={extraDuration}
                onChange={(e) => setExtraDuration(e.target.value)}
                placeholder="Duration e.g. 30 min (optional)"
                className="text-xs px-3 py-2 rounded-xl outline-none flex-1 min-w-[140px]"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              />
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

      {missedTasks && missedTasks.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-slate-200">
          <div className="flex items-center gap-2 flex-wrap justify-between">
            <div>
              <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base sm:text-lg font-bold">Missed from Previous Days</h3>
              <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                Purane din Red hi rahenge — lekin yaha se aaj catch-up karke complete mark kar sakte ho!
              </p>
            </div>
            <span className="text-xs px-3 py-1 rounded-full font-bold shadow-xs" style={{ background: pendingMissed > 0 ? COLORS.learn + '22' : COLORS.tealMid + '22', color: pendingMissed > 0 ? COLORS.learn : COLORS.tealMid }}>
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
                  subtitle={`${m.dateLabel} · ${skill?.name || ''}`}
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
        <button onClick={onViewHistory} className="text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all hover:gap-2 cursor-pointer" style={{ color: COLORS.tealMid }}>
          View full weekly schedule & performance history <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------- PLANNER VIEW -------------------------------- */
function PlannerView({ plannerEvents, onAddEvent, onDeleteEvent, onToggleEvent }) {
  const [currentMonthDate, setCurrentMonthDate] = useState(() => new Date(2026, 7, 1));
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(new Date()));
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00 AM');
  const [category, setCategory] = useState('Study');
  const [enableNotification, setEnableNotification] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState('default');

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  function requestNotifPermission() {
    if ('Notification' in window) {
      Notification.requestPermission().then((perm) => setNotificationPermission(perm));
    }
  }

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

    if (enableNotification && 'Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }

  const selectedDateEvents = useMemo(() => {
    return (plannerEvents || []).filter((e) => e.dateKey === selectedDateKey);
  }, [plannerEvents, selectedDateKey]);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Top Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl font-bold mb-1">
            Interactive Calendar & Task Planner
          </h2>
          <p className="text-xs sm:text-sm" style={{ color: COLORS.muted }}>
            Schedule future tasks, set date-wise reminders, and receive browser notifications.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {notificationPermission !== 'granted' ? (
            <button
              onClick={requestNotifPermission}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 cursor-pointer"
            >
              <Bell size={14} /> Enable Notifications
            </button>
          ) : (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
              <BellRing size={14} color="#059669" /> Notifications Active
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Full Month Interactive Calendar */}
        <div className="lg:col-span-2 rounded-2xl p-4 sm:p-6 shadow-xs" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
          {/* Calendar Header Month Control */}
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

          {/* Weekday Labels */}
          <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs mb-2" style={{ color: COLORS.muted }}>
            {WEEKDAY_SHORT.map((w) => <div key={w} className="py-1">{w}</div>)}
          </div>

          {/* Month Days Grid */}
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
                        <span
                          key={eIdx}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: isSelected ? COLORS.gold : COLORS.tealMid }}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Col: Selected Date Events & Planner Panel */}
        <div className="rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col justify-between" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
          <div>
            <div className="flex items-center justify-between border-b pb-3 mb-4" style={{ borderColor: COLORS.border }}>
              <div>
                <h3 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-base sm:text-lg font-bold">
                  {new Date(selectedDateKey + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </h3>
                <span className="text-xs" style={{ color: COLORS.muted }}>{selectedDateEvents.length} Tasks Scheduled</span>
              </div>
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                style={{ background: COLORS.gold, color: COLORS.tealDeep }}
              >
                <Plus size={15} /> Add Task
              </button>
            </div>

            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {selectedDateEvents.length === 0 ? (
                <div className="text-center py-8 text-xs font-medium" style={{ color: COLORS.muted }}>
                  No planned tasks or reminders for this date. Click "+ Add Task" to schedule!
                </div>
              ) : (
                selectedDateEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-3 rounded-xl flex items-center justify-between gap-2 border transition-all"
                    style={{ background: evt.done ? COLORS.bg : COLORS.card, borderColor: COLORS.border }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button onClick={() => onToggleEvent(evt.id)} className="cursor-pointer shrink-0">
                        {evt.done ? <CheckCircle2 size={18} color={COLORS.tealMid} /> : <Circle size={18} color={COLORS.muted} />}
                      </button>
                      <div className="min-w-0">
                        <div className={`text-xs font-bold truncate ${evt.done ? 'line-through opacity-60' : ''}`} style={{ color: COLORS.ink }}>
                          {evt.title}
                        </div>
                        <div className="text-[11px] font-mono flex items-center gap-1.5 mt-0.5" style={{ color: COLORS.muted }}>
                          <Clock size={11} /> {evt.time} · <span className="font-semibold text-teal-800">{evt.category}</span>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => onDeleteEvent(evt.id)} className="text-slate-400 hover:text-red-500 p-1 cursor-pointer">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {showAddForm && (
            <form onSubmit={handleCreateEvent} className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: COLORS.border }}>
              <div className="flex items-center justify-between text-xs font-bold" style={{ color: COLORS.ink }}>
                <span>Schedule New Reminder</span>
                <button type="button" onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={15} />
                </button>
              </div>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task name e.g. Revise SQL Window Functions"
                className="w-full text-xs px-3 py-2 rounded-xl outline-none"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              />
              <div className="flex gap-2">
                <input
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  placeholder="Time e.g. 09:30 AM"
                  className="text-xs px-3 py-2 rounded-xl outline-none flex-1"
                  style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
                />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="text-xs px-3 py-2 rounded-xl outline-none flex-1 font-medium"
                  style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
                >
                  <option value="Study">Study</option>
                  <option value="Revision">Revision</option>
                  <option value="Mock Test">Mock Test</option>
                  <option value="Deadline">Deadline</option>
                  <option value="Personal">Personal</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                style={{ background: COLORS.gold, color: COLORS.tealDeep }}
              >
                Save & Set Reminder Notification
              </button>
            </form>
          )}
        </div>
      </div>
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

const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const HAS_SPEECH_RECOGNITION = !!SpeechRecognition;

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

function SkillModal({ isOpen, onClose, onSave, editingSkill }) {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [icon, setIcon] = useState('Code2');
  const [color, setColor] = useState('#1F6F68');
  const [steps, setSteps] = useState([]);

  useEffect(() => {
    if (editingSkill) {
      setName(editingSkill.name || '');
      setTagline(editingSkill.tagline || '');
      setIcon(editingSkill.icon || 'Code2');
      setColor(editingSkill.color || '#1F6F68');
      setSteps(editingSkill.steps ? editingSkill.steps.map((s) => ({ ...s })) : []);
    } else {
      setName('');
      setTagline('');
      setIcon('Code2');
      setColor('#1F6F68');
      setSteps([]);
    }
  }, [editingSkill, isOpen]);

  if (!isOpen) return null;

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
      });
    } else {
      onSave({
        id: `custom-${Date.now()}`,
        name: name.trim(),
        tagline: tagline.trim() || 'Learning track',
        icon,
        color,
        steps: cleanedSteps,
      });
    }
    onClose();
  }

  const iconKeys = Object.keys(ICON_MAP);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-xl w-full shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto space-y-5" onClick={(e) => e.stopPropagation()}>
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

          <div className="flex justify-end gap-3 pt-3 border-t" style={{ borderColor: COLORS.border }}>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-bold shadow-xs cursor-pointer"
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

function HistoryView({ historyDays, templates, skillsById }) {
  const last7 = useMemo(() => (historyDays ? historyDays.slice(-7) : []), [historyDays]);
  
  const weekChartData = useMemo(() => {
    return last7.map((d) => ({
      label: `${WEEKDAY_SHORT[d.date.getDay()]} ${d.date.getDate()}`,
      percent: d.total ? Math.round((d.done / d.total) * 100) : 0,
      status: getDayStatus(d.done, d.total),
    }));
  }, [last7]);

  const weekDone = useMemo(() => last7.reduce((a, d) => a + d.done, 0), [last7]);
  const weekPossible = useMemo(() => last7.reduce((a, d) => a + d.total, 0), [last7]);
  const weekPercent = weekPossible ? Math.round((weekDone / weekPossible) * 100) : 0;

  const pieChartData = useMemo(() => {
    if (!historyDays) return [];
    const counts = { superb: 0, good: 0, bad: 0, rest: 0 };
    historyDays.forEach((d) => {
      const status = getDayStatus(d.done, d.total);
      counts[status] = (counts[status] || 0) + 1;
    });

    return [
      { name: 'Superb (100% Win)', value: counts.superb, color: STATUS_META.superb.color },
      { name: 'Good (Partial)', value: counts.good, color: STATUS_META.good.color },
      { name: 'Bad (Waste Day)', value: counts.bad, color: STATUS_META.bad.color },
      { name: 'Rest Day', value: counts.rest, color: STATUS_META.rest.color },
    ].filter((item) => item.value > 0);
  }, [historyDays]);

  const skillBreakdown = useMemo(() => {
    const tally = {};
    last7.forEach((d) => (d.taskDetails || []).forEach((t) => {
      if (t.done) tally[t.skill] = (tally[t.skill] || 0) + 1;
    }));
    return Object.entries(tally).sort((a, b) => b[1] - a[1]);
  }, [last7]);

  return (
    <div className="space-y-8 sm:space-y-10">
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-xl sm:text-2xl font-bold">
            Performance Analytics & History
          </h2>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
            ● Tracking since 26 Aug 2026
          </span>
        </div>
        <p className="text-xs sm:text-sm mb-4" style={{ color: COLORS.muted }}>
          Analyze daily completion rates, performance ratings (Superb, Good, Bad, Rest), and habit consistency.
        </p>

        {!historyDays ? (
          <div className="p-8 text-center text-sm font-medium" style={{ color: COLORS.muted }}>Loading performance chart…</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap bg-white p-3.5 rounded-2xl border border-slate-200 text-xs font-bold">
              <span className="text-slate-500 mr-1">Day Status Legend:</span>
              {Object.entries(STATUS_META).map(([k, meta]) => (
                <div key={k} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: meta.bg, border: `1px solid ${meta.border}`, color: meta.text }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
                  <span>{meta.label}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 rounded-2xl p-4 sm:p-6 shadow-xs" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
                <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
                  <div>
                    <div style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-2xl sm:text-3xl font-bold">{weekPercent}%</div>
                    <div className="text-xs font-medium" style={{ color: COLORS.muted }}>{weekDone} of {weekPossible} tasks completed this week</div>
                  </div>
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                    Weekly Completion Rate
                  </span>
                </div>
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={weekChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="#ECE9E0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: COLORS.muted }} axisLine={false} tickLine={false} domain={[0, 100]} />
                      <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, fontSize: 12 }} />
                      <Bar dataKey="percent" radius={[6, 6, 0, 0]}>
                        {weekChartData.map((d, i) => <Cell key={i} fill={STATUS_META[d.status].color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col justify-between" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
                <div>
                  <h3 className="font-bold text-sm sm:text-base mb-0.5" style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }}>
                    Performance Breakdown
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
                <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.muted }}>Sessions Completed By Skill This Week</div>
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

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 style={{ fontFamily: 'Fraunces, serif', color: COLORS.ink }} className="text-lg sm:text-xl font-bold">
            Calendar Ratings (Active Since 26 Aug)
          </h2>
          <span className="text-xs font-medium text-slate-500">Green = Superb · Orange = Good · Red = Bad</span>
        </div>

        {!historyDays ? (
          <div className="text-sm font-medium" style={{ color: COLORS.muted }}>Loading calendar grid…</div>
        ) : (
          <div className="grid grid-cols-7 gap-2 sm:gap-3">
            {historyDays.map((d) => {
              const status = getDayStatus(d.done, d.total);
              const meta = STATUS_META[status];
              return (
                <div
                  key={d.key}
                  className="aspect-square rounded-2xl flex flex-col items-center justify-center gap-0.5 sm:gap-1 p-1 sm:p-2 transition-all hover:scale-105 shadow-xs cursor-pointer"
                  style={{ background: meta.bg, border: `1.5px solid ${meta.border}` }}
                  title={`${d.done}/${d.total} tasks completed · ${meta.label}`}
                >
                  <div className="text-[9px] sm:text-[10px] font-semibold uppercase" style={{ color: meta.text }}>{WEEKDAY_SHORT[d.date.getDay()]}</div>
                  <div className="text-sm sm:text-base font-extrabold" style={{ color: meta.text }}>{d.date.getDate()}</div>
                  <div className="text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 hidden sm:inline" style={{ background: meta.color, color: '#FFF' }}>
                    {meta.label.split(' ')[0]}
                  </div>
                  <span className="w-2 h-2 rounded-full sm:hidden" style={{ background: meta.color }} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- SCHEDULE VIEW -------------------------------- */
function ScheduleView({ templates, onUpdateTemplate, onToggleDayAssignment, onResetTemplate, onAddCustomTemplate, onDeleteTemplate, onCopyTemplate, skills }) {
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
      { id: `custom-${Date.now()}`, title: 'New Work Session', time: '8:00 PM', duration: '30 min', skill: skills[0]?.id || 'ba' },
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
            // Find template assigned to this dayNum
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
            
            // Check if assigned to another template
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
                value={task.skill}
                onChange={(e) => updateTask(idx, { skill: e.target.value })}
                className="text-xs px-3 py-1.5 rounded-xl outline-none flex-1 min-w-[130px] font-medium"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              >
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

        for (let i = 0; i < 14; i++) {
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
    <div className="min-h-screen pb-12" style={{ background: COLORS.bg, fontFamily: 'Inter, sans-serif' }}>
      <style>{FONT_IMPORT}</style>
      <NavBar view={view} setView={(v) => { setView(v); if (v !== 'skill') setActiveSkillId(null); }} />
      <TaglineBanner />
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
            skills={skills}
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
        {view === 'history' && <HistoryView historyDays={historyDays} templates={templates} skillsById={skillsById} />}
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
            dashboardPrefs={dashboardPrefs}
            onUpdateDashboardPrefs={updateDashboardPrefs}
            confirmReset={confirmReset}
            setConfirmReset={setConfirmReset}
            onResetAll={resetAll}
          />
        )}
      </div>

      <SkillModal
        isOpen={!!modalState}
        editingSkill={modalState?.skill}
        onClose={handleCloseModal}
        onSave={saveSkill}
      />
    </div>
  );
}
