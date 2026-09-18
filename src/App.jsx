import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart, Line, ComposedChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Plus, Trash2, Upload, Download, Plane, Wallet, AlertTriangle,
  TrendingUp, TrendingDown, FileText, X, Check, CreditCard, Pencil,
} from "lucide-react";
import { login, logout, watchAuth, cloudLoad, cloudSave } from "./firebase";

// ---------- Constants ----------
const CATEGORIES = {
  income: ["薪資", "獎金", "報帳退款", "利息", "其他收入"],
  expense: ["餐飲", "交通", "住宿", "設備耗材", "辦公", "通訊", "差旅", "房貸", "其他支出"],
};
const TRAVEL_TYPES = ["交通", "住宿", "餐飲", "雜支"];
const PALETTE = ["#2C6E7F", "#E0A458", "#B5533E", "#7A9E7E", "#8C6A9E", "#5B7C99", "#C97B84", "#A0A083"];

const fmt = (n) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(n || 0);
const fmt2 = (n) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n || 0);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const monthKey = (d) => (d || "").slice(0, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);

// 回饋計算：找出該卡回饋率，回傳現金回饋（單筆四捨五入到整數）
const rebateOf = (tx, cards) => {
  if (tx.type !== "expense" || !tx.cardId) return 0;
  const card = cards.find((c) => c.id === tx.cardId);
  if (!card) return 0;
  return Math.round(tx.amount * (card.rate || 0) / 100);
};
const cardName = (id, cards) => cards.find((c) => c.id === id)?.name || "";

// ---------- Storage：本機快取 + Firestore 雲端（雲端優先）----------
const KEYS = { tx: "transactions", bd: "budgets", tr: "trips", cd: "cards" };
const cacheKey = (uid, key) => `ledger:${uid}:${key}`;
// 本機快取讀寫（依 uid 分開，換帳號不會混）
function cacheLoad(uid, key, fallback) {
  try { const raw = localStorage.getItem(cacheKey(uid, key)); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function cacheSave(uid, key, value) {
  try { localStorage.setItem(cacheKey(uid, key), JSON.stringify(value)); } catch (e) { console.error(e); }
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined=檢查中, null=未登入, obj=已登入
  const [authErr, setAuthErr] = useState("");

  useEffect(() => watchAuth((u) => setUser(u || null)), []);

  const doLogin = async () => {
    setAuthErr("");
    try { await login(); } catch (e) { setAuthErr("登入失敗：" + (e?.code || e?.message || "")); }
  };

  if (user === undefined) return <div className="boot">載入中…</div>;
  if (user === null) return <LoginScreen onLogin={doLogin} err={authErr} />;
  return <LedgerApp user={user} />;
}

// ---------- 登入畫面 ----------
function LoginScreen({ onLogin, err }) {
  return (
    <div className="login-wrap">
      {/* 背景視覺：漸層 + 抽象圖表/能源意象 */}
      <div className="login-bg" aria-hidden="true">
        <svg className="bg-svg" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="area1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E0A458" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#E0A458" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="area2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5A9E8A" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#5A9E8A" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* 網格 */}
          <g stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1">
            {Array.from({ length: 9 }).map((_, i) => <line key={"h" + i} x1="0" y1={i * 100} x2="400" y2={i * 100} />)}
            {Array.from({ length: 5 }).map((_, i) => <line key={"v" + i} x1={i * 100} y1="0" x2={i * 100} y2="800" />)}
          </g>
          {/* 面積折線圖意象 1 */}
          <path d="M0,560 L50,540 L100,570 L150,500 L200,520 L250,440 L300,470 L350,400 L400,430 L400,800 L0,800 Z" fill="url(#area2)" />
          <path d="M0,560 L50,540 L100,570 L150,500 L200,520 L250,440 L300,470 L350,400 L400,430" fill="none" stroke="#5A9E8A" strokeOpacity="0.5" strokeWidth="2" />
          {/* 面積折線圖意象 2 */}
          <path d="M0,650 L50,640 L100,610 L150,640 L200,590 L250,610 L300,560 L350,585 L400,540 L400,800 L0,800 Z" fill="url(#area1)" />
          <path d="M0,650 L50,640 L100,610 L150,640 L200,590 L250,610 L300,560 L350,585 L400,540" fill="none" stroke="#E0A458" strokeOpacity="0.6" strokeWidth="2" />
          {/* 資料點光暈 */}
          {[[150,500],[250,440],[350,400],[300,560],[400,540]].map(([x,y],i)=>(
            <circle key={i} cx={x} cy={y} r="4" fill="#fff" fillOpacity="0.7" />
          ))}
          {/* 長條意象 */}
          <g fill="#ffffff" fillOpacity="0.06">
            {[120,180,90,220,150,200,110].map((h,i)=>(<rect key={i} x={20+i*55} y={720-h} width="26" height={h} rx="4" />))}
          </g>
        </svg>
        <div className="glow glow-1" />
        <div className="glow glow-2" />
      </div>

      {/* 前景：毛玻璃卡片 */}
      <div className="login-card glass">
        <div className="login-logo"><Wallet size={30} color="#E0A458" /></div>
        <h1>工程財務記帳台</h1>
        <p className="login-sub">收支・差旅・預算・回饋</p>

        <div className="feat-row">
          <div className="feat"><TrendingUp size={16} /><span>收支趨勢</span></div>
          <div className="feat"><CreditCard size={16} /><span>回饋試算</span></div>
          <div className="feat"><Plane size={16} /><span>差旅報帳</span></div>
          <div className="feat"><AlertTriangle size={16} /><span>預算預警</span></div>
        </div>

        <button className="btn-google" onClick={onLogin}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        使用 Google 登入
        </button>
        {err && <div className="login-err">{err}</div>}
        <p className="login-hint">登入後資料存到你的雲端，手機、電腦同帳號自動同步。</p>
      </div>
    </div>
  );
}

// ---------- 主程式（登入後）----------
function LedgerApp({ user }) {
  const uid = user.uid;
  const [tab, setTab] = useState("dashboard");
  // 先用本機快取初始化（秒開不白畫面），再從雲端覆蓋
  const [transactions, setTransactions] = useState(() => cacheLoad(uid, KEYS.tx, []));
  const [budgets, setBudgets] = useState(() => cacheLoad(uid, KEYS.bd, {}));
  const [trips, setTrips] = useState(() => cacheLoad(uid, KEYS.tr, []));
  const [cards, setCards] = useState(() => cacheLoad(uid, KEYS.cd, []));
  const [month, setMonth] = useState(monthKey(todayISO()));
  const [syncing, setSyncing] = useState(true);
  const ready = useRef(false); // 雲端載入完成前，不要把空值寫回雲端

  // 登入後：從雲端載入四類（雲端優先），載完才允許寫回
  useEffect(() => {
    let alive = true;
    setSyncing(true);
    (async () => {
      const [tx, bd, tr, cd] = await Promise.all([
        cloudLoad(uid, KEYS.tx, null), cloudLoad(uid, KEYS.bd, null),
        cloudLoad(uid, KEYS.tr, null), cloudLoad(uid, KEYS.cd, null),
      ]);
      if (!alive) return;
      if (tx !== null) setTransactions(tx);
      if (bd !== null) setBudgets(bd);
      if (tr !== null) setTrips(tr);
      if (cd !== null) setCards(cd);
      ready.current = true;
      setSyncing(false);
    })();
    return () => { alive = false; };
  }, [uid]);

  // 任何一類變動 → 寫本機快取 + 寫雲端（載入完成後才寫，避免覆蓋雲端）
  useEffect(() => { if (!ready.current) return; cacheSave(uid, KEYS.tx, transactions); cloudSave(uid, KEYS.tx, transactions); }, [transactions, uid]);
  useEffect(() => { if (!ready.current) return; cacheSave(uid, KEYS.bd, budgets); cloudSave(uid, KEYS.bd, budgets); }, [budgets, uid]);
  useEffect(() => { if (!ready.current) return; cacheSave(uid, KEYS.tr, trips); cloudSave(uid, KEYS.tr, trips); }, [trips, uid]);
  useEffect(() => { if (!ready.current) return; cacheSave(uid, KEYS.cd, cards); cloudSave(uid, KEYS.cd, cards); }, [cards, uid]);

  const months = useMemo(() => {
    const set = new Set(transactions.map((t) => monthKey(t.date)));
    set.add(monthKey(todayISO()));
    return [...set].sort().reverse();
  }, [transactions]);

  // 若目前選的月份已無資料而從清單消失，自動切回最新的可用月份，避免下拉卡住
  useEffect(() => {
    if (!months.includes(month)) setMonth(months[0]);
  }, [months, month]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Wallet size={24} color="#E0A458" />
          <div>
            <div className="brand-title">工程財務記帳台</div>
            <div className="brand-sub">{syncing ? "雲端同步中…" : "收支・差旅・預算・回饋"}</div>
          </div>
        </div>
        <div className="top-right">
          <select className="month-select" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="logout-btn" onClick={logout} title="登出">
            {user.photoURL ? <img src={user.photoURL} alt="" /> : "登出"}
          </button>
        </div>
      </header>

      <nav className="tabbar">
        {[
          { id: "dashboard", label: "儀表板", icon: TrendingUp },
          { id: "transactions", label: "收支", icon: FileText },
          { id: "cards", label: "信用卡", icon: CreditCard },
          { id: "travel", label: "差旅", icon: Plane },
          { id: "budget", label: "預算", icon: AlertTriangle },
          { id: "reports", label: "報表", icon: Download },
        ].map((t) => {
          const Icon = t.icon; const active = tab === t.id;
          return (
            <button key={t.id} className={"tab-btn" + (active ? " active" : "")} onClick={() => setTab(t.id)}>
              <Icon size={18} /><span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="content">
        {tab === "dashboard" && <Dashboard transactions={transactions} month={month} budgets={budgets} cards={cards} />}
        {tab === "transactions" && <Transactions transactions={transactions} setTransactions={setTransactions} month={month} cards={cards} />}
        {tab === "cards" && <Cards cards={cards} setCards={setCards} transactions={transactions} month={month} />}
        {tab === "travel" && <Travel trips={trips} setTrips={setTrips} setTransactions={setTransactions} />}
        {tab === "budget" && <Budget budgets={budgets} setBudgets={setBudgets} transactions={transactions} month={month} />}
        {tab === "reports" && <Reports transactions={transactions} trips={trips} month={month} cards={cards} budgets={budgets}
          setTransactions={setTransactions} setTrips={setTrips} setCards={setCards} setBudgets={setBudgets} />}
      </main>
    </div>
  );
}

// ---------- Shared ----------
function Card({ children, className = "", style }) { return <div className={"card " + className} style={style}>{children}</div>; }
function SectionTitle({ children, right }) { return <div className="section-title"><h2>{children}</h2>{right}</div>; }
function Empty({ text }) { return <div className="empty">{text}</div>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }

// ---------- Dashboard ----------
function Dashboard({ transactions, month, budgets, cards }) {
  const [range, setRange] = useState("month"); // "month" | "year"
  const mtx = transactions.filter((t) => monthKey(t.date) === month);
  const income = mtx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = mtx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;
  const monthRebate = mtx.reduce((s, t) => s + rebateOf(t, cards), 0);

  // 年檢視：近 12 個月
  const yearTrend = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      const k = monthKey(t.date); if (!k) return;
      map[k] = map[k] || { label: k, income: 0, expense: 0 };
      map[k][t.type] += t.amount;
    });
    return Object.values(map).sort((a, b) => a.label.localeCompare(b.label)).slice(-12)
      .map((r) => ({ ...r, balance: r.income - r.expense }));
  }, [transactions]);

  // 月檢視：當月每日累積結餘
  const monthTrend = useMemo(() => {
    const days = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
    const daily = Array.from({ length: days }, (_, i) => ({ label: String(i + 1).padStart(2, "0"), income: 0, expense: 0 }));
    mtx.forEach((t) => {
      const d = +t.date.slice(8, 10) - 1;
      if (d >= 0 && d < days) daily[d][t.type] += t.amount;
    });
    let cum = 0, cumExp = 0;
    return daily.map((r) => { cum += r.income - r.expense; cumExp += r.expense; return { ...r, balance: cum, cumExpense: cumExp }; });
  }, [mtx, month]);

  const trend = range === "year" ? yearTrend : monthTrend;

  const byCat = useMemo(() => {
    const map = {};
    mtx.filter((t) => t.type === "expense").forEach((t) => { map[t.category] = (map[t.category] || 0) + t.amount; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [mtx]);

  const overBudget = Object.entries(budgets).filter(([cat, lim]) => {
    const spent = mtx.filter((t) => t.type === "expense" && t.category === cat).reduce((s, t) => s + t.amount, 0);
    return lim > 0 && spent > lim;
  });

  return (
    <div className="stack">
      <div className="stat-grid four">
        <Stat label="本月收入" value={income} color="#2C6E7F" icon={TrendingUp} />
        <Stat label="本月支出" value={expense} color="#B5533E" icon={TrendingDown} />
        <Stat label="結餘" value={balance} color={balance >= 0 ? "#5A7D4E" : "#B5533E"} icon={Wallet} highlight />
        <Stat label="本月回饋" value={monthRebate} color="#8C6A9E" icon={CreditCard} />
      </div>

      {overBudget.length > 0 && (
        <Card className="alert">
          <div className="alert-head"><AlertTriangle size={18} /> 預算超支預警</div>
          {overBudget.map(([cat, lim]) => {
            const spent = mtx.filter((t) => t.type === "expense" && t.category === cat).reduce((s, t) => s + t.amount, 0);
            return <div key={cat} className="alert-line">「{cat}」已支出 <span className="mono">{fmt(spent)}</span>，超出上限 <span className="mono">{fmt(spent - lim)}</span></div>;
          })}
        </Card>
      )}

      <Card>
        <SectionTitle right={
          <div className="toggle">
            <button className={range === "month" ? "on" : ""} onClick={() => setRange("month")}>月</button>
            <button className={range === "year" ? "on" : ""} onClick={() => setRange("year")}>年</button>
          </div>
        }>{range === "year" ? "收支趨勢（近 12 個月）" : `當月每日走勢（${month}）`}</SectionTitle>
        {trend.length === 0 ? <Empty text="尚無資料，先到「收支」新增一筆" /> : range === "year" ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EDE9E0" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#7A857B" }} interval={0} />
              <YAxis tick={{ fontSize: 10, fill: "#7A857B" }} tickFormatter={(v) => (v / 1000) + "k"} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="income" name="收入" stroke="#2C6E7F" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="expense" name="支出" stroke="#B5533E" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="balance" name="結餘" stroke="#5A7D4E" strokeWidth={2} strokeDasharray="4 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={trend} margin={{ top: 8, right: 2, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EDE9E0" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#7A857B" }} interval={4} />
              <YAxis yAxisId="left" tick={{ fontSize: 9, fill: "#7A857B" }} width={34} tickFormatter={(v) => Math.round(v / 1000) + "k"} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: "#B5533E" }} width={30} tickFormatter={(v) => Math.round(v / 1000) + "k"} />
              <Tooltip formatter={(v) => fmt(v)} labelFormatter={(l) => `${month}-${l}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="right" dataKey="expense" name="當日支出" fill="#E0A458" radius={[2, 2, 0, 0]} maxBarSize={12} />
              <Line yAxisId="left" type="monotone" dataKey="cumExpense" name="累積支出" stroke="#B5533E" strokeWidth={2} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="balance" name="累積結餘" stroke="#5A7D4E" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card>
        <SectionTitle>本月支出結構</SectionTitle>
        {byCat.length === 0 ? <Empty text="本月尚無支出" /> : (
          <div className="pie-row">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byCat} dataKey="value" nameKey="name" innerRadius={42} outerRadius={75} paddingAngle={2} isAnimationActive={false}>
                  {byCat.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="legend-list">
              {byCat.map((c, i) => (
                <div key={c.name} className="legend-item">
                  <span className="legend-name"><span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />{c.name}</span>
                  <span className="mono">{fmt(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
function Stat({ label, value, color, icon: Icon, highlight, decimal }) {
  return (
    <div className={"stat" + (highlight ? " highlight" : "")} style={highlight ? { background: color } : {}}>
      <div className="stat-label"><Icon size={14} /> {label}</div>
      <div className="mono stat-value" style={{ color: highlight ? "#fff" : color }}>{decimal ? fmt2(value) : fmt(value)}</div>
    </div>
  );
}

// ---------- Transactions ----------
function Transactions({ transactions, setTransactions, month, cards }) {
  const [form, setForm] = useState({ date: todayISO(), type: "expense", category: "餐飲", amount: "", note: "", cardId: "" });
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState(null);
  const fileRef = useRef();

  const add = () => {
    if (!form.amount || +form.amount <= 0) return;
    setTransactions((p) => [{ id: uid(), ...form, amount: +form.amount }, ...p]);
    setForm((f) => ({ ...f, amount: "", note: "" }));
  };
  const remove = (id) => setTransactions((p) => p.filter((t) => t.id !== id));

  const startEdit = (t) => { setEditId(t.id); setDraft({ ...t, amount: String(t.amount) }); };
  const cancelEdit = () => { setEditId(null); setDraft(null); };
  const saveEdit = () => {
    if (!draft.amount || +draft.amount <= 0) return;
    setTransactions((p) => p.map((t) => t.id === editId ? { ...draft, amount: +draft.amount } : t));
    cancelEdit();
  };

  const importCSV = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = ev.target.result.split(/\r?\n/).filter((l) => l.trim());
      const rows = [];
      lines.forEach((line, i) => {
        if (i === 0 && /日期|date|type|類型/i.test(line)) return;
        const c = line.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
        if (c.length < 3) return;
        const amt = parseFloat(c[3] || c[2]);
        if (isNaN(amt)) return;
        rows.push({ id: uid(), date: c[0] || todayISO(), type: /收|income|\+/i.test(c[1]) ? "income" : "expense", category: c[2] || "其他支出", amount: Math.abs(amt), note: c[4] || "", cardId: "" });
      });
      if (rows.length) setTransactions((p) => [...rows, ...p]);
      e.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  };

  const mtx = transactions.filter((t) => monthKey(t.date) === month).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="stack">
      <Card>
        <SectionTitle right={<button className="ghost-btn" onClick={() => fileRef.current.click()}><Upload size={14} /> 匯入 CSV</button>}>新增一筆</SectionTitle>
        <input ref={fileRef} type="file" accept=".csv" onChange={importCSV} style={{ display: "none" }} />
        <div className="form-grid">
          <Field label="日期"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="類型">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, category: CATEGORIES[e.target.value][0], cardId: e.target.value === "income" ? "" : form.cardId })}>
              <option value="expense">支出</option><option value="income">收入</option>
            </select>
          </Field>
          <Field label="分類">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES[form.type].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="金額"><input type="number" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" /></Field>
          {form.type === "expense" && (
            <Field label="支付卡片">
              <select value={form.cardId} onChange={(e) => setForm({ ...form, cardId: e.target.value })}>
                <option value="">現金／未指定</option>
                {cards.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.rate}%）</option>)}
              </select>
            </Field>
          )}
          <Field label="備註"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="選填" /></Field>
        </div>
        <button className="primary-btn full" onClick={add}><Plus size={18} /> 加入</button>
        {form.type === "expense" && form.cardId && form.amount > 0 && (
          <div className="rebate-preview">預估回饋：<span className="mono">{fmt(Math.round(+form.amount * (cards.find((c) => c.id === form.cardId)?.rate || 0) / 100))}</span></div>
        )}
        <div className="hint">CSV 格式：日期,類型,分類,金額,備註（第一列可為標題）</div>
      </Card>

      <Card className="flush">
        <div className="card-pad"><SectionTitle>{month} 明細（{mtx.length} 筆）</SectionTitle></div>
        {mtx.length === 0 ? <Empty text="本月尚無紀錄" /> : (
          <div className="tx-list">
            {mtx.map((t) => {
              const reb = rebateOf(t, cards);
              if (editId === t.id) {
                return (
                  <div key={t.id} className="tx-edit">
                    <div className="form-grid">
                      <Field label="日期"><input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
                      <Field label="類型">
                        <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value, category: CATEGORIES[e.target.value][0], cardId: e.target.value === "income" ? "" : draft.cardId })}>
                          <option value="expense">支出</option><option value="income">收入</option>
                        </select>
                      </Field>
                      <Field label="分類">
                        <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                          {CATEGORIES[draft.type].map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </Field>
                      <Field label="金額"><input type="number" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></Field>
                      {draft.type === "expense" && (
                        <Field label="支付卡片">
                          <select value={draft.cardId || ""} onChange={(e) => setDraft({ ...draft, cardId: e.target.value })}>
                            <option value="">現金／未指定</option>
                            {cards.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.rate}%）</option>)}
                          </select>
                        </Field>
                      )}
                      <Field label="備註"><input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="選填" /></Field>
                    </div>
                    <div className="edit-actions">
                      <button className="teal-btn full" onClick={saveEdit}><Check size={16} /> 儲存</button>
                      <button className="ghost-btn full" onClick={cancelEdit}><X size={16} /> 取消</button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={t.id} className="tx-row">
                  <div className="tx-main">
                    <span className="mono tx-fulldate">{t.date.slice(8, 10)}</span>
                    <span className={"chip " + t.type}>{t.category}</span>
                    <span className="tx-note">
                      {t.cardId && <span className="card-tag"><CreditCard size={11} />{cardName(t.cardId, cards)}</span>}
                      {t.note || (t.cardId ? "" : "—")}
                    </span>
                  </div>
                  <div className="tx-right">
                    <span className="tx-nums">
                      <span className={"mono tx-amt " + t.type}>{t.type === "income" ? "+" : "−"}{fmt(t.amount)}</span>
                      {reb > 0 && <span className="mono tx-reb">回饋 {fmt(reb)}</span>}
                    </span>
                    <button className="icon-btn" onClick={() => startEdit(t)}><Pencil size={15} /></button>
                    <button className="icon-btn" onClick={() => remove(t.id)}><Trash2 size={16} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Cards ----------
function Cards({ cards, setCards, transactions, month }) {
  const [form, setForm] = useState({ name: "", rate: "" });
  const add = () => {
    if (!form.name || form.rate === "") return;
    setCards((p) => [...p, { id: uid(), name: form.name, rate: +form.rate || 0 }]);
    setForm({ name: "", rate: "" });
  };
  const remove = (id) => setCards((p) => p.filter((c) => c.id !== id));
  const updateRate = (id, rate) => setCards((p) => p.map((c) => c.id === id ? { ...c, rate: +rate || 0 } : c));

  const mtx = transactions.filter((t) => monthKey(t.date) === month && t.type === "expense" && t.cardId);
  const perCard = cards.map((c) => {
    const txs = mtx.filter((t) => t.cardId === c.id);
    const spent = txs.reduce((s, t) => s + t.amount, 0);
    const rebate = txs.reduce((s, t) => s + rebateOf(t, cards), 0); // 加總各筆四捨五入後的回饋
    return { ...c, spent, rebate, count: txs.length };
  });

  return (
    <div className="stack">
      <Card>
        <SectionTitle>新增信用卡</SectionTitle>
        <div className="form-grid">
          <Field label="卡片名稱"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：國泰 CUBE" /></Field>
          <Field label="回饋率 %"><input type="number" inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="1.2" /></Field>
        </div>
        <button className="primary-btn full" onClick={add}><Plus size={18} /> 新增卡片</button>
      </Card>

      <Card className="flush">
        <div className="card-pad"><SectionTitle>{month} 各卡回饋小計</SectionTitle></div>
        {cards.length === 0 ? <Empty text="尚無卡片，先新增一張" /> : (
          <div className="card-list">
            {perCard.map((c) => (
              <div key={c.id} className="card-row">
                <div className="card-info">
                  <div className="card-name"><CreditCard size={16} color="#8C6A9E" /> {c.name}</div>
                  <div className="card-detail">
                    回饋率 <input className="rate-inline" type="number" inputMode="decimal" value={c.rate} onChange={(e) => updateRate(c.id, e.target.value)} />%
                    ・本月 {c.count} 筆・消費 <span className="mono">{fmt(c.spent)}</span>
                  </div>
                </div>
                <div className="card-tail">
                  <span className="mono card-rebate">{fmt(c.rebate)}</span>
                  <button className="icon-btn" onClick={() => remove(c.id)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            <div className="card-total">
              本月回饋合計 <span className="mono">{fmt(perCard.reduce((s, c) => s + c.rebate, 0))}</span>
            </div>
          </div>
        )}
        <div className="card-pad hint">回饋率以「每張卡固定率」計算。改率會即時套用到所有用該卡的支出。</div>
      </Card>
    </div>
  );
}

// ---------- Travel ----------
function Travel({ trips, setTrips, setTransactions }) {
  const [form, setForm] = useState({ name: "", dest: "", start: todayISO(), end: todayISO() });
  const [expandedId, setExpandedId] = useState(null);
  const [item, setItem] = useState({ date: todayISO(), type: "交通", amount: "", note: "" });

  const addTrip = () => {
    if (!form.name) return;
    const t = { id: uid(), ...form, items: [], reimbursed: false };
    setTrips((p) => [t, ...p]); setExpandedId(t.id);
    setForm({ name: "", dest: "", start: todayISO(), end: todayISO() });
  };
  const addItem = (tripId) => {
    if (!item.amount || +item.amount <= 0) return;
    setTrips((p) => p.map((t) => t.id === tripId ? { ...t, items: [...t.items, { id: uid(), ...item, amount: +item.amount }] } : t));
    setItem((i) => ({ ...i, amount: "", note: "" }));
  };
  const removeItem = (tripId, itemId) => setTrips((p) => p.map((t) => t.id === tripId ? { ...t, items: t.items.filter((x) => x.id !== itemId) } : t));
  const removeTrip = (id) => setTrips((p) => p.filter((t) => t.id !== id));

  const markReimbursed = (trip) => {
    const total = trip.items.reduce((s, x) => s + x.amount, 0);
    if (!trip.reimbursed) {
      // 標記已報帳 = 收到報帳退款，記一筆收入（用 refTripId 綁定此行程，方便取消時精準刪除）
      if (total > 0) {
        setTransactions((p) => [{ id: uid(), date: trip.end, type: "income", category: "報帳退款", amount: total, note: `差旅報帳：${trip.name}`, cardId: "", refTripId: trip.id }, ...p]);
      }
    } else {
      // 取消報帳狀態 = 沖掉那筆退款收入
      setTransactions((p) => p.filter((t) => t.refTripId !== trip.id));
    }
    setTrips((p) => p.map((t) => t.id === trip.id ? { ...t, reimbursed: !t.reimbursed } : t));
  };

  return (
    <div className="stack">
      <Card>
        <SectionTitle>新增差旅</SectionTitle>
        <div className="form-grid travel">
          <Field label="行程名稱"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：彰濱案場勘查" /></Field>
          <Field label="目的地"><input value={form.dest} onChange={(e) => setForm({ ...form, dest: e.target.value })} placeholder="選填" /></Field>
          <Field label="出發"><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
          <Field label="返回"><input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
        </div>
        <button className="primary-btn full" onClick={addTrip}><Plus size={18} /> 建立行程</button>
      </Card>

      {trips.length === 0 ? <Card><Empty text="尚無差旅紀錄" /></Card> : trips.map((trip) => {
        const total = trip.items.reduce((s, x) => s + x.amount, 0);
        const byType = TRAVEL_TYPES.map((tp) => ({ name: tp, value: trip.items.filter((x) => x.type === tp).reduce((s, x) => s + x.amount, 0) })).filter((x) => x.value > 0);
        const open = expandedId === trip.id;
        return (
          <Card key={trip.id} className="flush">
            <div className={"trip-head" + (open ? " open" : "")} onClick={() => setExpandedId(open ? null : trip.id)}>
              <div>
                <div className="trip-name">
                  <Plane size={16} color="#2C6E7F" /> {trip.name}
                  {trip.reimbursed && <span className="chip income sm"><Check size={11} />已報帳</span>}
                </div>
                <div className="trip-meta">{trip.dest && `${trip.dest}・`}{trip.start.slice(5)} ~ {trip.end.slice(5)}・{trip.items.length} 筆</div>
              </div>
              <div className="mono trip-total">{fmt(total)}</div>
            </div>
            {open && (
              <div className="trip-body">
                <div className="form-grid travel-item">
                  <Field label="日期"><input type="date" value={item.date} onChange={(e) => setItem({ ...item, date: e.target.value })} /></Field>
                  <Field label="項目"><select value={item.type} onChange={(e) => setItem({ ...item, type: e.target.value })}>{TRAVEL_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
                  <Field label="金額"><input type="number" inputMode="decimal" value={item.amount} onChange={(e) => setItem({ ...item, amount: e.target.value })} placeholder="0" /></Field>
                  <Field label="備註"><input value={item.note} onChange={(e) => setItem({ ...item, note: e.target.value })} placeholder="選填" /></Field>
                </div>
                <button className="teal-btn full" onClick={() => addItem(trip.id)}><Plus size={16} /> 加入項目</button>
                {trip.items.length > 0 && (
                  <>
                    <div className="item-list">
                      {trip.items.map((x) => (
                        <div key={x.id} className="item-row">
                          <span className="item-left"><span className="mono item-date">{x.date.slice(5)}</span><span className="chip neutral">{x.type}</span><span className="item-note">{x.note}</span></span>
                          <span className="item-right"><span className="mono">{fmt(x.amount)}</span><button className="icon-btn" onClick={() => removeItem(trip.id, x.id)}><X size={15} /></button></span>
                        </div>
                      ))}
                    </div>
                    {byType.length > 0 && (
                      <ResponsiveContainer width="100%" height={150}>
                        <PieChart><Pie data={byType} dataKey="value" nameKey="name" outerRadius={55} isAnimationActive={false}>{byType.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip formatter={(v) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
                      </ResponsiveContainer>
                    )}
                  </>
                )}
                <div className="trip-actions">
                  <button className={"full " + (trip.reimbursed ? "ghost-btn" : "green-btn")} onClick={() => markReimbursed(trip)}><Check size={15} /> {trip.reimbursed ? "取消報帳（沖銷收入）" : "標記已報帳並記入收入"}</button>
                  <button className="danger-btn full" onClick={() => removeTrip(trip.id)}><Trash2 size={15} /> 刪除行程</button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ---------- Budget ----------
function Budget({ budgets, setBudgets, transactions, month }) {
  const mtx = transactions.filter((t) => monthKey(t.date) === month && t.type === "expense");
  const setLimit = (cat, val) => setBudgets((p) => ({ ...p, [cat]: +val || 0 }));
  return (
    <Card>
      <SectionTitle>月度分類預算（{month}）</SectionTitle>
      <div className="hint" style={{ marginBottom: 16 }}>設定各分類上限，超支會在儀表板顯示紅色預警。</div>
      <div className="budget-list">
        {CATEGORIES.expense.map((cat) => {
          const spent = mtx.filter((t) => t.category === cat).reduce((s, t) => s + t.amount, 0);
          const lim = budgets[cat] || 0;
          const pct = lim > 0 ? Math.min(100, (spent / lim) * 100) : 0;
          const over = lim > 0 && spent > lim;
          return (
            <div key={cat} className="budget-row">
              <div className="budget-head">
                <span className="budget-cat">{cat}</span>
                <input type="number" inputMode="decimal" value={budgets[cat] || ""} onChange={(e) => setLimit(cat, e.target.value)} placeholder="上限" className="budget-input" />
              </div>
              <div className="bar"><div className="bar-fill" style={{ width: `${pct}%`, background: over ? "#B5533E" : pct > 80 ? "#E0A458" : "#2C6E7F" }} /></div>
              <div className={"mono budget-status" + (over ? " over" : "")}>{fmt(spent)}{lim > 0 && ` / ${fmt(lim)}`}{over && ` ⚠ 超支 ${fmt(spent - lim)}`}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- Reports ----------
function Reports({ transactions, trips, month, cards, budgets, setTransactions, setTrips, setCards, setBudgets }) {
  const restoreRef = useRef();
  const [restoreMsg, setRestoreMsg] = useState(null); // { type: "ok"|"err", text }

  const restore = (e, mode) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // 基本結構驗證
        if (!data || typeof data !== "object" || (!Array.isArray(data.transactions) && !Array.isArray(data.trips) && !Array.isArray(data.cards))) {
          throw new Error("檔案格式不符，這似乎不是本 App 匯出的備份");
        }
        const inTx = Array.isArray(data.transactions) ? data.transactions : [];
        const inTr = Array.isArray(data.trips) ? data.trips : [];
        const inCd = Array.isArray(data.cards) ? data.cards : [];
        const inBd = (data.budgets && typeof data.budgets === "object") ? data.budgets : {};

        if (mode === "replace") {
          setTransactions(inTx); setTrips(inTr); setCards(inCd); setBudgets(inBd);
          setRestoreMsg({ type: "ok", text: `已覆蓋還原：${inTx.length} 筆收支、${inTr.length} 趟差旅、${inCd.length} 張卡` });
        } else {
          // 合併：以 id 去重，備份資料補進現有資料（現有優先保留）
          const mergeById = (cur, add) => {
            const ids = new Set(cur.map((x) => x.id));
            return [...cur, ...add.filter((x) => x && x.id && !ids.has(x.id))];
          };
          setTransactions((p) => mergeById(p, inTx));
          setTrips((p) => mergeById(p, inTr));
          setCards((p) => mergeById(p, inCd));
          setBudgets((p) => ({ ...inBd, ...p })); // 現有預算優先
          setRestoreMsg({ type: "ok", text: `已合併匯入：新增 ${inTx.length} 筆收支、${inTr.length} 趟差旅、${inCd.length} 張卡（重複 id 自動略過）` });
        }
      } catch (err) {
        setRestoreMsg({ type: "err", text: "還原失敗：" + err.message });
      }
      e.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  };

  const pickRestore = (mode) => {
    if (mode === "replace" && !window.confirm("「覆蓋還原」會清掉目前所有資料，改用備份內容。確定要繼續嗎？\n（建議先做一次完整備份再操作）")) return;
    restoreRef.current.dataset.mode = mode;
    restoreRef.current.click();
  };

  const exportCSV = (rows, filename) => {
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  };
  const exportTx = () => {
    const rows = [["日期", "類型", "分類", "金額", "支付卡片", "回饋率%", "回饋金額", "備註"],
      ...transactions.filter((t) => monthKey(t.date) === month).sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => {
          const card = cards.find((c) => c.id === t.cardId);
          return [t.date, t.type === "income" ? "收入" : "支出", t.category, t.amount, card?.name || "", card?.rate ?? "", rebateOf(t, cards), t.note];
        })];
    exportCSV(rows, `收支明細_${month}.csv`);
  };
  const exportRebate = () => {
    const rows = [["日期", "分類", "金額", "卡片", "回饋率%", "回饋金額", "備註"]];
    transactions.filter((t) => monthKey(t.date) === month && t.type === "expense" && t.cardId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((t) => { const card = cards.find((c) => c.id === t.cardId); rows.push([t.date, t.category, t.amount, card?.name || "", card?.rate ?? "", rebateOf(t, cards), t.note]); });
    exportCSV(rows, `信用卡回饋明細_${month}.csv`);
  };
  const exportTravel = () => {
    const rows = [["行程", "目的地", "日期", "項目", "金額", "備註", "報帳狀態"]];
    trips.forEach((tr) => tr.items.forEach((x) => rows.push([tr.name, tr.dest, x.date, x.type, x.amount, x.note, tr.reimbursed ? "已報帳" : "未報帳"])));
    exportCSV(rows, `差旅報帳明細.csv`);
  };
  const backupAll = () => {
    const data = { transactions, trips, cards, budgets, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `記帳備份_${todayISO()}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const mtx = transactions.filter((t) => monthKey(t.date) === month);
  const income = mtx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = mtx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const rebate = mtx.reduce((s, t) => s + rebateOf(t, cards), 0);
  const pendingTravel = trips.filter((t) => !t.reimbursed).reduce((s, t) => s + t.items.reduce((a, x) => a + x.amount, 0), 0);

  return (
    <div className="stack">
      <Card>
        <SectionTitle>{month} 月報摘要</SectionTitle>
        <div className="summary-grid">
          <Summary label="收入" value={income} />
          <Summary label="支出" value={expense} />
          <Summary label="結餘" value={income - expense} accent />
          <Summary label="信用卡回饋" value={rebate} />
          <Summary label="待報帳差旅" value={pendingTravel} warn />
        </div>
        <div className="export-btns">
          <button className="teal-btn" onClick={exportTx}><Download size={15} /> 本月收支 CSV</button>
          <button className="teal-btn" onClick={exportRebate}><Download size={15} /> 回饋明細 CSV</button>
          <button className="teal-btn" onClick={exportTravel}><Download size={15} /> 差旅報帳 CSV</button>
          <button className="dark-btn" onClick={backupAll}><Download size={15} /> 完整備份 JSON</button>
        </div>
        <div className="hint" style={{ marginTop: 12 }}>資料只存在這支手機的瀏覽器裡。建議定期用「完整備份」存檔，換手機或清除瀏覽器資料前務必先備份。</div>
      </Card>

      <Card>
        <SectionTitle>還原備份</SectionTitle>
        <div className="hint" style={{ marginBottom: 14 }}>讀入之前匯出的「完整備份 JSON」。合併＝把備份資料補進現有資料（重複自動略過）；覆蓋＝清空現有再用備份取代。</div>
        <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: "none" }}
          onChange={(e) => restore(e, e.target.dataset.mode || "merge")} />
        <div className="export-btns">
          <button className="teal-btn" onClick={() => pickRestore("merge")}><Upload size={15} /> 合併匯入</button>
          <button className="danger-btn" onClick={() => pickRestore("replace")}><Upload size={15} /> 覆蓋還原</button>
        </div>
        {restoreMsg && (
          <div className={"restore-msg " + restoreMsg.type}>
            {restoreMsg.type === "ok" ? <Check size={15} /> : <AlertTriangle size={15} />} {restoreMsg.text}
          </div>
        )}
      </Card>
    </div>
  );
}
function Summary({ label, value, accent, warn, decimal }) {
  return (
    <div className={"summary" + (accent ? " accent" : "") + (warn ? " warn" : "")}>
      <div className="summary-label">{label}</div>
      <div className="mono summary-value">{decimal ? fmt2(value) : fmt(value)}</div>
    </div>
  );
}
