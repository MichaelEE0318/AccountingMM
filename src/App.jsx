import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Line, ComposedChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Plus, Trash2, Upload, Download, Plane, Wallet, AlertTriangle, X, Check, CreditCard, Globe,
  Utensils, Bus, BedDouble, Wrench, Briefcase, Smartphone, Home as HomeIcon, ShoppingBag,
  Banknote, Gift, RotateCcw, Percent, Coins, List, BarChart3, PieChart as PieChartIcon,
  MoreHorizontal, ChevronDown, ChevronRight, ChevronLeft, Delete, LogOut, User,
} from "lucide-react";
import { login, logout, watchAuth, cloudLoad, cloudSave } from "./firebase";
import { buildMonthlyReport } from "./monthlyReport";

// ---------- Constants ----------
const CATEGORIES = {
  income: ["薪資", "獎金", "報帳退款", "利息", "其他收入"],
  expense: ["餐飲", "交通", "住宿", "設備耗材", "辦公", "通訊", "差旅", "房貸", "出國消費", "其他支出"],
};
const TRAVEL_TYPES = ["交通", "住宿", "餐飲", "雜支"];
const OVERSEAS_TYPES = ["餐飲", "購物", "交通", "住宿", "雜支"];
// 台銀常用幣別
const CURRENCIES = ["USD", "JPY", "EUR", "CNY", "HKD", "GBP", "AUD", "KRW", "THB", "SGD", "MYR", "VND", "PHP", "IDR", "CAD", "CHF", "NZD", "ZAR", "SEK"];
const PALETTE = ["#2C6E7F", "#E0A458", "#B5533E", "#7A9E7E", "#8C6A9E", "#5B7C99", "#C97B84", "#A0A083"];

const fmt = (n) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(n || 0);
const fmt2 = (n) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n || 0);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const monthKey = (d) => (d || "").slice(0, 7);
// 以手機本地時區取今天日期（避免台灣清晨被算成前一天）
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// 即時匯率：抓 1 外幣 = ? TWD。免費 API，失敗時回 null 讓使用者手動填
async function fetchRate(currency) {
  if (currency === "TWD") return 1;
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
    const data = await res.json();
    const twd = data?.rates?.TWD;
    return typeof twd === "number" ? twd : null;
  } catch { return null; }
}

// 回饋計算：找出該卡回饋率，回傳現金回饋（單筆四捨五入到整數）
const rebateOf = (tx, cards) => {
  if (tx.type !== "expense" || !tx.cardId) return 0;
  const card = cards.find((c) => c.id === tx.cardId);
  if (!card) return 0;
  return Math.round(tx.amount * (card.rate || 0) / 100);
};
const cardName = (id, cards) => cards.find((c) => c.id === id)?.name || "";

// 分類的圖示與配色（深色主題）
const CAT_STYLE = {
  "餐飲": { Icon: Utensils, bg: "#1C2E26", fg: "#8FD3AE" },
  "交通": { Icon: Bus, bg: "#1F2536", fg: "#9DB1E8" },
  "住宿": { Icon: BedDouble, bg: "#2B2418", fg: "#E6BE82" },
  "設備耗材": { Icon: Wrench, bg: "#22272B", fg: "#AFC0CC" },
  "辦公": { Icon: Briefcase, bg: "#28251E", fg: "#D4C7A8" },
  "通訊": { Icon: Smartphone, bg: "#2A1F27", fg: "#E0A3C7" },
  "差旅": { Icon: Plane, bg: "#2C1F18", fg: "#F0A77E" },
  "房貸": { Icon: HomeIcon, bg: "#1E1D19", fg: "#B8B1A4" },
  "出國消費": { Icon: Globe, bg: "#17292C", fg: "#7FCAD4" },
  "其他支出": { Icon: ShoppingBag, bg: "#272A1C", fg: "#CFD68A" },
  "薪資": { Icon: Banknote, bg: "#16262E", fg: "#8FD0DE" },
  "獎金": { Icon: Gift, bg: "#2B2418", fg: "#E6BE82" },
  "報帳退款": { Icon: RotateCcw, bg: "#17292C", fg: "#7FCAD4" },
  "利息": { Icon: Percent, bg: "#1C2E26", fg: "#8FD3AE" },
  "其他收入": { Icon: Coins, bg: "#1E1D19", fg: "#B8B1A4" },
};
const catStyle = (c) => CAT_STYLE[c] || { Icon: Coins, bg: "#1E1D19", fg: "#B8B1A4" };
const num = (n) => Math.round(n || 0).toLocaleString("en-US");
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const prevMonthKey = (m) => { let [y, mm] = m.split("-").map(Number); mm--; if (mm === 0) { mm = 12; y--; } return y + "-" + String(mm).padStart(2, "0"); };


// ---------- Storage：本機快取 + Firestore 雲端（雲端優先）----------
const KEYS = { tx: "transactions", bd: "budgets", tr: "trips", cd: "cards", ov: "overseas" };
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
  const preview = ["餐飲", "交通", "出國消費", "通訊"];
  return (
    <div className="login">
      <div className="login-beam" aria-hidden="true" />
      <div className="login-line" aria-hidden="true" />
      <div className="login-preview" aria-hidden="true">
        <div className="lp-stack">
          {preview.map((c) => {
            const s = catStyle(c);
            return (
              <div key={c} className="lp-tile" style={{ background: s.bg, color: "#F2EEE6" }}>
                <span className="tile-ico" style={{ color: s.fg }}><s.Icon size={17} /></span>{c}
              </div>
            );
          })}
        </div>
      </div>
      <div className="login-brand">
        <div className="login-logo"><Wallet size={26} color="#E0A458" /></div>
        <h1>工程財務記帳台</h1>
        <p>點分類、打金額、記下。<br />收支、回饋、差旅代墊一次看清。</p>
      </div>
      <div className="login-actions">
        <button className="btn-google" onClick={onLogin}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          使用 Google 登入
        </button>
        {err && <div className="login-err">{err}</div>}
        <p className="login-hint">每次登入都可以選擇帳號，資料存在你的雲端，手機和電腦自動同步。</p>
      </div>
    </div>
  );
}

// ---------- 主程式（登入後）----------
const monthLabel = (m) => `${m.slice(0, 4)} 年 ${+m.slice(5)} 月`;
const NAV = [
  { id: "home", label: "記一筆", Icon: Plus },
  { id: "ledger", label: "明細", Icon: List },
  { id: "reports", label: "報表", Icon: BarChart3 },
  { id: "budget", label: "預算", Icon: PieChartIcon },
  { id: "more", label: "更多", Icon: MoreHorizontal },
];

function LedgerApp({ user }) {
  const uid = user.uid;
  const [tab, setTab] = useState("home");
  // 先用本機快取初始化（秒開不白畫面），再從雲端覆蓋
  const [transactions, setTransactions] = useState(() => cacheLoad(uid, KEYS.tx, []));
  const [budgets, setBudgets] = useState(() => cacheLoad(uid, KEYS.bd, {}));
  const [trips, setTrips] = useState(() => cacheLoad(uid, KEYS.tr, []));
  const [cards, setCards] = useState(() => cacheLoad(uid, KEYS.cd, []));
  const [overseas, setOverseas] = useState(() => cacheLoad(uid, KEYS.ov, []));
  const [month, setMonth] = useState(monthKey(todayISO()));
  const [syncing, setSyncing] = useState(true);
  const [quick, setQuick] = useState(null); // 記一筆面板：{ type, category }
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const ready = useRef(false); // 雲端載入完成前，不要把空值寫回雲端

  // 登入後：從雲端載入（雲端優先），載完才允許寫回
  useEffect(() => {
    let alive = true;
    setSyncing(true);
    (async () => {
      const [tx, bd, tr, cd, ov] = await Promise.all([
        cloudLoad(uid, KEYS.tx, null), cloudLoad(uid, KEYS.bd, null),
        cloudLoad(uid, KEYS.tr, null), cloudLoad(uid, KEYS.cd, null),
        cloudLoad(uid, KEYS.ov, null),
      ]);
      if (!alive) return;
      if (tx !== null) setTransactions(tx);
      if (bd !== null) setBudgets(bd);
      if (tr !== null) setTrips(tr);
      if (cd !== null) setCards(cd);
      if (ov !== null) setOverseas(ov);
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
  useEffect(() => { if (!ready.current) return; cacheSave(uid, KEYS.ov, overseas); cloudSave(uid, KEYS.ov, overseas); }, [overseas, uid]);

  const months = useMemo(() => {
    const set = new Set(transactions.map((t) => monthKey(t.date)));
    set.add(monthKey(todayISO()));
    return [...set].filter(Boolean).sort().reverse();
  }, [transactions]);

  // 若目前選的月份已無資料而從清單消失，自動切回最新的可用月份，避免下拉卡住
  useEffect(() => {
    if (!months.includes(month)) setMonth(months[0]);
  }, [months, month]);

  const goto = (t) => { setTab(t); window.scrollTo(0, 0); };
  const saveQuick = (tx) => {
    setTransactions((p) => [tx, ...p]);
    setQuick(null);
    setMonth(monthKey(tx.date));
    setToast(`已記下 ${tx.category} ${num(tx.amount)}`);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  };
  const navActive = ["cards", "travel", "overseas"].includes(tab) ? "more" : tab;

  return (
    <div className="app">
      <header className="hdr">
        <button className="brand" onClick={() => goto("home")} aria-label="回到記一筆">
          <Wallet size={22} color="#E0A458" /><span>記帳台</span><i className="brand-dot" />
        </button>
        <div className="hdr-right">
          <span className="sync"><i className={syncing ? "busy" : ""} />{syncing ? "同步中" : "已同步"}</span>
          <select className="month-pill" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="選擇月份">
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button className="avatar" onClick={() => goto("more")} aria-label="帳號與更多">
            {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <User size={18} />}
          </button>
        </div>
      </header>

      <main className="content">
        {tab === "home" && <HomeScreen transactions={transactions} budgets={budgets} cards={cards} trips={trips} month={month} onAdd={setQuick} goto={goto} />}
        {tab === "ledger" && <Ledger transactions={transactions} setTransactions={setTransactions} month={month} cards={cards} />}
        {tab === "reports" && <Reports transactions={transactions} trips={trips} month={month} cards={cards} budgets={budgets} overseas={overseas} setOverseas={setOverseas}
          setTransactions={setTransactions} setTrips={setTrips} setCards={setCards} setBudgets={setBudgets} />}
        {tab === "budget" && <Budget budgets={budgets} setBudgets={setBudgets} transactions={transactions} month={month} />}
        {tab === "more" && <More user={user} cards={cards} trips={trips} overseas={overseas} transactions={transactions} month={month} goto={goto} />}
        {tab === "cards" && <div className="stack"><SubHead title="信用卡" goto={goto} /><Cards cards={cards} setCards={setCards} transactions={transactions} month={month} /></div>}
        {tab === "travel" && <div className="stack"><SubHead title="差旅代墊" goto={goto} /><Travel trips={trips} setTrips={setTrips} setTransactions={setTransactions} /></div>}
        {tab === "overseas" && <div className="stack"><SubHead title="出國消費" goto={goto} /><Overseas overseas={overseas} setOverseas={setOverseas} cards={cards} setTransactions={setTransactions} /></div>}
      </main>

      <nav className="bnav" aria-label="主選單">
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} className={"bnav-item" + (navActive === id ? " on" : "")} aria-current={navActive === id ? "page" : undefined}
            onClick={() => (id === "home" && tab === "home" ? setQuick({ type: "expense", category: "餐飲" }) : goto(id))}>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>

      {quick && <QuickAdd init={quick} cards={cards} budgets={budgets} transactions={transactions} onSave={saveQuick} onClose={() => setQuick(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// ---------- 更多 ----------
function More({ user, cards, trips, overseas, transactions, month, goto }) {
  const mtx = transactions.filter((t) => monthKey(t.date) === month);
  const rebate = mtx.reduce((s, t) => s + rebateOf(t, cards), 0);
  const pend = trips.filter((t) => !t.reimbursed && t.items.length > 0);
  const pendAmt = pend.reduce((s, t) => s + t.items.reduce((a, x) => a + x.amount, 0), 0);
  const items = [
    { id: "cards", Icon: CreditCard, color: "#B99AD6", title: "信用卡", sub: cards.length ? `${cards.length} 張卡，本月回饋 ${num(rebate)}` : "新增卡片與回饋率" },
    { id: "travel", Icon: Plane, color: "#E0A458", title: "差旅代墊", sub: pend.length ? `${pend.length} 趟待報帳，共 ${num(pendAmt)}` : `${trips.length} 趟行程` },
    { id: "overseas", Icon: Globe, color: "#7FCAD4", title: "出國消費", sub: overseas.length ? `${overseas.length} 趟旅程` : "建立旅程，即時匯率換算" },
  ];
  return (
    <div className="stack">
      <div className="page-head"><h1>更多</h1></div>
      <div className="list-card">
        {items.map((it) => (
          <button key={it.id} className="list-row" onClick={() => goto(it.id)}>
            <span className="list-ico" style={{ color: it.color, background: it.color + "24" }}><it.Icon size={19} /></span>
            <span className="list-txt"><b>{it.title}</b><small>{it.sub}</small></span>
            <ChevronRight size={18} className="list-chev" />
          </button>
        ))}
      </div>
      <div className="list-card">
        <div className="acct">
          {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <span className="list-ico" style={{ color: "#E0A458", background: "#E0A45824" }}><User size={18} /></span>}
          <span className="list-txt"><b>{user.displayName || "已登入"}</b><small>{user.email}</small></span>
        </div>
        <button className="list-row" onClick={logout}>
          <span className="list-ico" style={{ color: "#F2A48E", background: "#F2A48E24" }}><LogOut size={18} /></span>
          <span className="list-txt"><b>登出</b><small>下次登入可以重新選擇帳號</small></span>
        </button>
      </div>
    </div>
  );
}
function SubHead({ title, goto }) {
  return (
    <div className="sub-head">
      <button className="back-btn" onClick={() => goto("more")}><ChevronLeft size={18} />更多</button>
      <h1>{title}</h1>
    </div>
  );
}


// ---------- Shared ----------
function Card({ children, className = "", style }) { return <div className={"card " + className} style={style}>{children}</div>; }
function SectionTitle({ children, right }) { return <div className="section-title"><h2>{children}</h2>{right}</div>; }
function Empty({ text }) { return <div className="empty">{text}</div>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }

// ---------- 記一筆（首頁）----------
function HomeScreen({ transactions, budgets, cards, trips, month, onAdd, goto }) {
  const mtx = useMemo(() => transactions.filter((t) => monthKey(t.date) === month), [transactions, month]);
  const spentBy = {};
  mtx.forEach((t) => { if (t.type === "expense") spentBy[t.category] = (spentBy[t.category] || 0) + t.amount; });
  const income = mtx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = mtx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const bal = income - expense;
  const rebate = mtx.reduce((s, t) => s + rebateOf(t, cards), 0);
  const budgeted = CATEGORIES.expense.filter((c) => (budgets[c] || 0) > 0);
  const hasBudget = budgeted.length > 0;
  const left = budgeted.reduce((s, c) => s + Math.max(0, budgets[c] - (spentBy[c] || 0)), 0);
  const pend = trips.filter((t) => !t.reimbursed && t.items.length > 0);
  const pendAmt = pend.reduce((s, t) => s + t.items.reduce((a, x) => a + x.amount, 0), 0);
  const mNum = +month.slice(5);

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" /><div className="hero-line" aria-hidden="true" />
        <div className="hero-body">
          <div className="hero-label">{hasBudget ? `${mNum} 月預算還能花` : `${mNum} 月結餘`}</div>
          <div className="hero-num"><span className="cur">NT$</span><span className={"big" + (!hasBudget && bal < 0 ? " neg" : "")}>{num(hasBudget ? left : bal)}</span></div>
          <div className="pills">
            {hasBudget && <span className="pill"><i style={{ background: bal >= 0 ? "#6FCF8F" : "#F2A48E" }} />結餘 {num(bal)}</span>}
            {pend.length > 0 && <button className="pill" onClick={() => goto("travel")}><i style={{ background: "#E0A458" }} />{pend.length} 趟差旅待報帳</button>}
            <span className="pill"><i style={{ background: "#B99AD6" }} />回饋 {num(rebate)}</span>
          </div>
          <div className="hero-cap">{hasBudget ? "只計有設預算的分類" : "到「預算」設定分類上限，這裡會改成顯示還能花多少"}</div>
        </div>
      </section>

      <div className="sec-head"><h2>這筆花在哪裡？</h2><span>點分類開始記帳</span></div>
      <div className="tiles">
        {CATEGORIES.expense.map((c) => {
          const s = catStyle(c);
          const lim = budgets[c] || 0, sp = spentBy[c] || 0;
          let status;
          if (lim > 0) status = sp > lim ? <small className="over">超支<em>{num(sp - lim)}</em></small> : <small>剩餘<em>{num(lim - sp)}</em></small>;
          else status = sp > 0 ? <small>已花<em>{num(sp)}</em></small> : <small>本月未記</small>;
          return (
            <button key={c} className="tile" style={{ background: s.bg, borderColor: s.fg + "2E" }} onClick={() => onAdd({ type: "expense", category: c })}>
              <span className="tile-ico" style={{ color: s.fg }}><s.Icon size={20} /></span>
              <span className="tile-txt"><b>{c}</b>{status}</span>
            </button>
          );
        })}
      </div>

      <button className="row-card" onClick={() => onAdd({ type: "income", category: "薪資" })}>
        <span className="list-ico" style={{ color: "#8FD0DE", background: "#8FD0DE24" }}><Banknote size={19} /></span>
        <span className="list-txt"><b>記一筆收入</b><small>薪資、獎金、報帳退款、利息</small></span>
        <span className="list-amt inc">{num(income)}</span>
        <ChevronRight size={18} className="list-chev" />
      </button>
      {pendAmt > 0 && (
        <button className="row-card" onClick={() => goto("travel")}>
          <span className="list-ico" style={{ color: "#E0A458", background: "#E0A45824" }}><Plane size={19} /></span>
          <span className="list-txt"><b>差旅代墊</b><small>{pend.map((t) => t.name).join("、")}，待報帳</small></span>
          <span className="list-amt">{num(pendAmt)}</span>
          <ChevronRight size={18} className="list-chev" />
        </button>
      )}
      <button className="row-card" onClick={() => goto("cards")}>
        <span className="list-ico" style={{ color: "#B99AD6", background: "#B99AD624" }}><CreditCard size={19} /></span>
        <span className="list-txt"><b>信用卡回饋</b><small>{cards.length ? `${mNum} 月累計` : "還沒有設定信用卡"}</small></span>
        <span className="list-amt">{num(rebate)}</span>
        <ChevronRight size={18} className="list-chev" />
      </button>
    </div>
  );
}

// ---------- 記一筆面板：選分類 → 打金額 → 記下 ----------
const KEYS_PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];
function QuickAdd({ init, cards, budgets, transactions, onSave, onClose }) {
  const [type, setType] = useState(init.type || "expense");
  const [category, setCategory] = useState(init.category || CATEGORIES[init.type || "expense"][0]);
  const [amt, setAmt] = useState("");
  const [cardId, setCardId] = useState(() => { try { return localStorage.getItem("ledger:lastCard") || ""; } catch { return ""; } });
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const n = parseFloat(amt) || 0;
  const validCard = cards.some((c) => c.id === cardId) ? cardId : "";
  const card = cards.find((c) => c.id === validCard);
  const rebate = type === "expense" && card ? Math.round(n * (card.rate || 0) / 100) : 0;
  const m = monthKey(date);
  const spent = transactions.filter((t) => t.type === "expense" && t.category === category && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0);
  const lim = budgets[category] || 0;
  const after = lim - spent - n;

  const press = (k) => {
    setAmt((a) => {
      if (k === "del") return a.slice(0, -1);
      if (k === ".") return a.includes(".") ? a : (a === "" ? "0" : a) + ".";
      if (a.includes(".") && a.split(".")[1].length >= 2) return a;
      if (a.replace(".", "").length >= 8) return a;
      return (a === "0" ? "" : a) + k;
    });
  };
  const switchType = (tp) => { if (tp === type) return; setType(tp); setCategory(CATEGORIES[tp][0]); };
  const save = () => {
    if (n <= 0) return;
    const cid = type === "expense" ? validCard : "";
    try { if (type === "expense") localStorage.setItem("ledger:lastCard", cid); } catch { /* 無痕模式可能無法寫入 */ }
    onSave({ id: uid(), date, type, category, amount: n, note: note.trim(), cardId: cid });
  };

  const parts = (amt === "" ? "0" : amt).split(".");
  const amtText = (parseInt(parts[0], 10) || 0).toLocaleString("en-US") + (parts.length > 1 ? "." + parts[1] : "");

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={type === "expense" ? "記一筆支出" : "記一筆收入"}>
      <div className="sheet-glow" aria-hidden="true" />
      <div className="sheet-inner">
        <header className="sheet-head">
          <button className="circle-btn" onClick={onClose} aria-label="關閉"><X size={18} /></button>
          <div className="seg">
            <button className={type === "expense" ? "on" : ""} onClick={() => switchType("expense")}>支出</button>
            <button className={type === "income" ? "on" : ""} onClick={() => switchType("income")}>收入</button>
          </div>
          <input className="date-pill" type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} aria-label="日期" />
        </header>

        <div className="cat-scroll">
          {CATEGORIES[type].map((c) => {
            const s = catStyle(c); const on = c === category;
            return (
              <button key={c} className={"cat-chip" + (on ? " on" : "")} aria-pressed={on}
                style={on ? { background: s.bg, borderColor: s.fg, color: "#F2EEE6" } : undefined} onClick={() => setCategory(c)}>
                <s.Icon size={15} color={s.fg} />{c}
              </button>
            );
          })}
        </div>

        <div className="amt-area">
          <div className="amt"><span className="cur">NT$</span><span className="big">{amtText}</span></div>
          {type === "expense" && lim > 0 && (after >= 0
            ? <div className="amt-sub">記下後{category}剩餘 <b>{num(after)}</b></div>
            : <div className="amt-sub over">記下後{category}會超支 <b>{num(-after)}</b></div>)}
          {type === "expense" && !lim && <div className="amt-sub">{category}本月已花 <b>{num(spent)}</b></div>}
        </div>

        {type === "expense" && (
          <div className="pay">
            <div className="pay-head"><span>付款方式</span>{card && <span>預估回饋 <b>+{num(rebate)}</b></span>}</div>
            <div className="pay-chips">
              <button className={"pay-chip" + (!validCard ? " on" : "")} aria-pressed={!validCard} onClick={() => setCardId("")}>現金</button>
              {cards.map((c) => (
                <button key={c.id} className={"pay-chip" + (validCard === c.id ? " on" : "")} aria-pressed={validCard === c.id} onClick={() => setCardId(c.id)}>
                  {c.name}{c.rate ? ` ${c.rate}%` : ""}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="note-row"><span>備註</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === "expense" ? "例如：午餐便當" : "例如：九月薪資"} /></label>

        <div className="keypad">
          {KEYS_PAD.map((k) => (
            <button key={k} onClick={() => press(k)} aria-label={k === "del" ? "刪除" : k}>{k === "del" ? <Delete size={22} /> : k}</button>
          ))}
        </div>

        <button className="save-btn" disabled={n <= 0} onClick={save}>記下</button>
      </div>
    </div>
  );
}

// ---------- 明細 ----------
function Ledger({ transactions, setTransactions, month, cards }) {
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState("");
  const fileRef = useRef();

  const startEdit = (t) => { setEditId(t.id); setDraft({ ...t, amount: String(t.amount), cardId: t.cardId || "", note: t.note || "" }); };
  const cancelEdit = () => { setEditId(null); setDraft(null); };
  const saveEdit = () => {
    if (!draft.amount || +draft.amount <= 0) return;
    setTransactions((p) => p.map((t) => t.id === editId ? { ...draft, amount: +draft.amount, cardId: draft.type === "expense" ? draft.cardId : "" } : t));
    cancelEdit();
  };
  const remove = (id) => {
    if (!window.confirm("確定要刪除這筆紀錄嗎？")) return;
    setTransactions((p) => p.filter((t) => t.id !== id));
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
      setMsg(rows.length ? `已匯入 ${rows.length} 筆` : "沒有讀到可匯入的資料，請確認 CSV 格式");
      e.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  };

  const mtx = transactions.filter((t) => monthKey(t.date) === month);
  const income = mtx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = mtx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const groups = useMemo(() => {
    const map = new Map();
    [...mtx].sort((a, b) => b.date.localeCompare(a.date)).forEach((t) => {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date).push(t);
    });
    return [...map.entries()];
  }, [mtx]);

  const editForm = (
    draft && <div className="tx-edit">
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
            <select value={draft.cardId} onChange={(e) => setDraft({ ...draft, cardId: e.target.value })}>
              <option value="">現金／未指定</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.rate}%）</option>)}
            </select>
          </Field>
        )}
        <Field label="備註"><input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="選填" /></Field>
      </div>
      <div className="edit-actions">
        <button className="gold-btn" onClick={saveEdit}><Check size={16} /> 儲存</button>
        <button className="ghost-btn" onClick={cancelEdit}>取消</button>
        <button className="danger-btn" onClick={() => remove(draft.id)}><Trash2 size={15} /> 刪除</button>
      </div>
    </div>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <h1>明細</h1>
        <button className="ghost-btn" onClick={() => fileRef.current.click()}><Upload size={15} /> 匯入 CSV</button>
      </div>
      <input ref={fileRef} type="file" accept=".csv" onChange={importCSV} style={{ display: "none" }} />
      {msg && <div className="hint" style={{ marginTop: 0 }}>{msg}</div>}

      <section className="sum3">
        <div className="hero-line" aria-hidden="true" />
        <div><small>收入</small><b style={{ color: "#8FD0DE" }}>{num(income)}</b></div>
        <div><small>支出</small><b style={{ color: "#F2A48E" }}>{num(expense)}</b></div>
        <div><small>結餘</small><b>{num(income - expense)}</b></div>
      </section>

      {groups.length === 0 ? <div className="card"><Empty text="本月還沒有紀錄，到「記一筆」新增" /></div> : groups.map(([date, list]) => {
        const dExp = list.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
        const dInc = list.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
        const wd = WEEK[new Date(date + "T00:00:00").getDay()];
        return (
          <div key={date} className="day">
            <div className="day-head">
              <span><b>{+date.slice(5, 7)}/{+date.slice(8, 10)}</b><em>週{wd}</em></span>
              <span>{dExp > 0 && <>支出 <b>{num(dExp)}</b></>}{dExp > 0 && dInc > 0 && "　"}{dInc > 0 && <>收入 <b>{num(dInc)}</b></>}</span>
            </div>
            <div className="day-list">
              {list.map((t) => {
                if (editId === t.id) return <React.Fragment key={t.id}>{editForm}</React.Fragment>;
                const s = catStyle(t.category);
                const reb = rebateOf(t, cards);
                const cn = cardName(t.cardId, cards);
                return (
                  <button key={t.id} className="tx" onClick={() => startEdit(t)} aria-label={`${t.category} ${num(t.amount)}，點擊修改`}>
                    <span className="tx-ico" style={{ background: s.bg, color: s.fg }}><s.Icon size={18} /></span>
                    <span className="tx-txt"><b>{t.note || t.category}</b><small>{t.type === "expense" ? (t.note ? `${t.category}，${cn || "現金"}` : (cn || "現金")) : (t.note ? t.category : "收入")}</small></span>
                    <span className="tx-val">
                      <b className={t.type}>{t.type === "income" ? "+" : "−"}{num(t.amount)}</b>
                      {reb > 0 && <small>回饋 {num(reb)}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="hint">點任一筆可以修改或刪除。CSV 格式：日期,類型,分類,金額,備註（第一列可為標題）</div>
    </div>
  );
}


// ---------- Cards ----------
function Cards({ cards, setCards, transactions, month }) {
  const [form, setForm] = useState({ name: "", rate: "", overseasRate: "", fxFee: "1.5" });
  const add = () => {
    if (!form.name || form.rate === "") return;
    setCards((p) => [...p, { id: uid(), name: form.name, rate: +form.rate || 0, overseasRate: +form.overseasRate || 0, fxFee: form.fxFee === "" ? 1.5 : +form.fxFee }]);
    setForm({ name: "", rate: "", overseasRate: "", fxFee: "1.5" });
  };
  const remove = (id) => setCards((p) => p.filter((c) => c.id !== id));
  const updateField = (id, field, val) => setCards((p) => p.map((c) => c.id === id ? { ...c, [field]: +val || 0 } : c));

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
          <Field label="國內回饋率 %"><input type="number" inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="1.2" /></Field>
          <Field label="海外回饋率 %"><input type="number" inputMode="decimal" value={form.overseasRate} onChange={(e) => setForm({ ...form, overseasRate: e.target.value })} placeholder="3" /></Field>
          <Field label="海外手續費 %"><input type="number" inputMode="decimal" value={form.fxFee} onChange={(e) => setForm({ ...form, fxFee: e.target.value })} placeholder="1.5" /></Field>
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
                  <div className="card-name"><CreditCard size={16} color="#B99AD6" /> {c.name}</div>
                  <div className="card-detail">
                    國內 <input className="rate-inline" type="number" inputMode="decimal" value={c.rate} onChange={(e) => updateField(c.id, "rate", e.target.value)} />%
                    ・海外 <input className="rate-inline" type="number" inputMode="decimal" value={c.overseasRate ?? 0} onChange={(e) => updateField(c.id, "overseasRate", e.target.value)} />%
                    ・手續費 <input className="rate-inline" type="number" inputMode="decimal" value={c.fxFee ?? 1.5} onChange={(e) => updateField(c.id, "fxFee", e.target.value)} />%
                  </div>
                  <div className="card-detail">本月 {c.count} 筆・消費 <span className="mono">{fmt(c.spent)}</span></div>
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
                  <Plane size={16} color="#E0A458" /> {trip.name}
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

// ---------- Overseas 出國消費 ----------
// 單筆台幣成本 = 原幣 × 匯率 ×(1 + 手續費%)，四捨五入到整數
function twdCost(item, cards) {
  const base = item.amount * item.rate;
  const card = cards.find((c) => c.id === item.cardId);
  const fee = card ? (card.fxFee ?? 1.5) : 0;
  return Math.round(base * (1 + fee / 100));
}
// 單筆海外回饋 = 台幣成本 × 海外回饋率%，四捨五入
function overseasRebate(item, cards) {
  if (!item.cardId) return 0;
  const card = cards.find((c) => c.id === item.cardId);
  if (!card) return 0;
  return Math.round(twdCost(item, cards) * (card.overseasRate || 0) / 100);
}

function Overseas({ overseas, setOverseas, cards, setTransactions }) {
  const [form, setForm] = useState({ name: "", country: "", currency: "USD", start: todayISO(), end: todayISO(), budget: "" });
  const [expandedId, setExpandedId] = useState(null);
  const [item, setItem] = useState({ date: todayISO(), type: "餐飲", amount: "", note: "", cardId: "", rate: "" });
  const [rateBusy, setRateBusy] = useState(false);
  const [rateMsg, setRateMsg] = useState("");

  const addTrip = () => {
    if (!form.name) return;
    const t = { id: uid(), ...form, budget: +form.budget || 0, items: [], settled: false };
    setOverseas((p) => [t, ...p]); setExpandedId(t.id);
    setForm({ name: "", country: "", currency: "USD", start: todayISO(), end: todayISO(), budget: "" });
  };
  const removeTrip = (id) => setOverseas((p) => p.filter((t) => t.id !== id));

  // 抓即時匯率填進「單筆匯率」
  const grabRate = async (currency) => {
    setRateBusy(true); setRateMsg("");
    const r = await fetchRate(currency);
    setRateBusy(false);
    if (r) { setItem((i) => ({ ...i, rate: String(r) })); setRateMsg(`1 ${currency} ≈ ${r.toFixed(3)} TWD`); }
    else setRateMsg("抓不到匯率，請手動輸入");
  };

  const addItem = (tripId, currency) => {
    if (!item.amount || +item.amount <= 0 || !item.rate || +item.rate <= 0) return;
    setOverseas((p) => p.map((t) => t.id === tripId
      ? { ...t, items: [...t.items, { id: uid(), ...item, amount: +item.amount, rate: +item.rate, currency }] } : t));
    setItem((i) => ({ ...i, amount: "", note: "" }));
  };
  const removeItem = (tripId, itemId) =>
    setOverseas((p) => p.map((t) => t.id === tripId ? { ...t, items: t.items.filter((x) => x.id !== itemId) } : t));

  const settle = (trip) => {
    const totalTWD = trip.items.reduce((s, x) => s + twdCost(x, cards), 0);
    if (!trip.settled) {
      if (totalTWD > 0) {
        setTransactions((p) => [{ id: uid(), date: trip.end, type: "expense", category: "出國消費", amount: totalTWD, note: `出國：${trip.name}`, cardId: "", refOverseasId: trip.id }, ...p]);
      }
    } else {
      setTransactions((p) => p.filter((t) => t.refOverseasId !== trip.id));
    }
    setOverseas((p) => p.map((t) => t.id === trip.id ? { ...t, settled: !t.settled } : t));
  };

  return (
    <div className="stack">
      <Card>
        <SectionTitle>新增出國旅程</SectionTitle>
        <div className="form-grid">
          <Field label="旅程名稱"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：東京五日" /></Field>
          <Field label="國家/地區"><input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="選填" /></Field>
          <Field label="幣別">
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="旅程預算 TWD"><input type="number" inputMode="decimal" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="選填" /></Field>
          <Field label="出發"><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
          <Field label="返回"><input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
        </div>
        <button className="primary-btn full" onClick={addTrip}><Plus size={18} /> 建立旅程</button>
      </Card>

      {overseas.length === 0 ? <Card><Empty text="尚無出國旅程" /></Card> : overseas.map((trip) => {
        const totalTWD = trip.items.reduce((s, x) => s + twdCost(x, cards), 0);
        const totalReb = trip.items.reduce((s, x) => s + overseasRebate(x, cards), 0);
        const byType = OVERSEAS_TYPES.map((tp) => ({ name: tp, value: trip.items.filter((x) => x.type === tp).reduce((s, x) => s + twdCost(x, cards), 0) })).filter((x) => x.value > 0);
        // 各卡在這趟的回饋，找出最划算
        const cardReb = {};
        trip.items.forEach((x) => { if (x.cardId) cardReb[x.cardId] = (cardReb[x.cardId] || 0) + overseasRebate(x, cards); });
        const bestCard = Object.entries(cardReb).sort((a, b) => b[1] - a[1])[0];
        const open = expandedId === trip.id;
        const overBudget = trip.budget > 0 && totalTWD > trip.budget;
        return (
          <Card key={trip.id} className="flush">
            <div className={"trip-head" + (open ? " open" : "")} onClick={() => setExpandedId(open ? null : trip.id)}>
              <div>
                <div className="trip-name">
                  <Globe size={16} color="#7FCAD4" /> {trip.name}
                  {trip.settled && <span className="chip income sm"><Check size={11} />已結算</span>}
                </div>
                <div className="trip-meta">{trip.country && `${trip.country}・`}{trip.currency}・{trip.start.slice(5)} ~ {trip.end.slice(5)}・{trip.items.length} 筆</div>
              </div>
              <div className="mono trip-total">{fmt(totalTWD)}</div>
            </div>

            {open && (
              <div className="trip-body">
                {/* 加一筆消費 */}
                <div className="form-grid">
                  <Field label="日期"><input type="date" value={item.date} onChange={(e) => setItem({ ...item, date: e.target.value })} /></Field>
                  <Field label="類別"><select value={item.type} onChange={(e) => setItem({ ...item, type: e.target.value })}>{OVERSEAS_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
                  <Field label={`原幣金額 (${trip.currency})`}><input type="number" inputMode="decimal" value={item.amount} onChange={(e) => setItem({ ...item, amount: e.target.value })} placeholder="0" /></Field>
                  <Field label="匯率 (1→TWD)"><input type="number" inputMode="decimal" value={item.rate} onChange={(e) => setItem({ ...item, rate: e.target.value })} placeholder="手動或按抓取" /></Field>
                  <Field label="刷卡">
                    <select value={item.cardId} onChange={(e) => setItem({ ...item, cardId: e.target.value })}>
                      <option value="">現金／未指定</option>
                      {cards.map((c) => <option key={c.id} value={c.id}>{c.name}（海外{c.overseasRate ?? 0}%）</option>)}
                    </select>
                  </Field>
                  <Field label="備註"><input value={item.note} onChange={(e) => setItem({ ...item, note: e.target.value })} placeholder="選填" /></Field>
                </div>
                <div className="ov-rate-row">
                  <button className="ghost-btn" onClick={() => grabRate(trip.currency)} disabled={rateBusy}>{rateBusy ? "抓取中…" : `抓 ${trip.currency} 即時匯率`}</button>
                  {rateMsg && <span className="ov-rate-msg">{rateMsg}</span>}
                </div>
                {item.amount > 0 && item.rate > 0 && (
                  <div className="ov-preview">
                    預估台幣：<span className="mono">{fmt(twdCost({ amount: +item.amount, rate: +item.rate, cardId: item.cardId }, cards))}</span>
                    {item.cardId && <> ・回饋 <span className="mono">{fmt(overseasRebate({ amount: +item.amount, rate: +item.rate, cardId: item.cardId }, cards))}</span></>}
                  </div>
                )}
                <button className="teal-btn full" onClick={() => addItem(trip.id, trip.currency)}><Plus size={16} /> 加入消費</button>

                {trip.items.length > 0 && (
                  <>
                    <div className="item-list">
                      {trip.items.map((x) => (
                        <div key={x.id} className="item-row">
                          <span className="item-left">
                            <span className="mono item-date">{x.date.slice(5)}</span>
                            <span className="chip neutral">{x.type}</span>
                            <span className="item-note">{x.amount} {x.currency}{x.note ? `・${x.note}` : ""}</span>
                          </span>
                          <span className="item-right">
                            <span className="mono">{fmt(twdCost(x, cards))}</span>
                            <button className="icon-btn" onClick={() => removeItem(trip.id, x.id)}><X size={15} /></button>
                          </span>
                        </div>
                      ))}
                    </div>
                    {byType.length > 0 && (
                      <ResponsiveContainer width="100%" height={150}>
                        <PieChart><Pie data={byType} dataKey="value" nameKey="name" outerRadius={55} isAnimationActive={false}>{byType.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip formatter={(v) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
                      </ResponsiveContainer>
                    )}
                    {/* 結算摘要 */}
                    <div className="ov-summary">
                      <div>總花費 <span className="mono">{fmt(totalTWD)}</span></div>
                      <div>總回饋 <span className="mono">{fmt(totalReb)}</span></div>
                      {bestCard && <div>最划算：{cardName(bestCard[0], cards)}（回饋 <span className="mono">{fmt(bestCard[1])}</span>）</div>}
                      {trip.budget > 0 && <div className={overBudget ? "ov-over" : ""}>預算 {fmt(trip.budget)}{overBudget && ` ⚠ 超支 ${fmt(totalTWD - trip.budget)}`}</div>}
                    </div>
                  </>
                )}

                <div className="trip-actions">
                  <button className={"full " + (trip.settled ? "ghost-btn" : "green-btn")} onClick={() => settle(trip)}><Check size={15} /> {trip.settled ? "取消結算（沖銷支出）" : "標記已結算並記入收支"}</button>
                  <button className="danger-btn full" onClick={() => removeTrip(trip.id)}><Trash2 size={15} /> 刪除旅程</button>
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
    <div className="stack">
      <div className="page-head"><h1>預算</h1></div>
      <div className="card">
        <div className="hint" style={{ marginTop: 0, marginBottom: 16 }}>設定各分類每月上限。有設上限的分類，首頁會顯示剩餘金額，超支時報表會出現警示。</div>
        <div className="budget-list">
          {CATEGORIES.expense.map((cat) => {
            const s = catStyle(cat);
            const spent = mtx.filter((t) => t.category === cat).reduce((sum, t) => sum + t.amount, 0);
            const lim = budgets[cat] || 0;
            const pct = lim > 0 ? Math.min(100, (spent / lim) * 100) : 0;
            const over = lim > 0 && spent > lim;
            return (
              <div key={cat} className="budget-row">
                <div className="budget-head">
                  <span className="budget-cat"><span className="tx-ico sm" style={{ background: s.bg, color: s.fg }}><s.Icon size={15} /></span>{cat}</span>
                  <input type="number" inputMode="decimal" value={budgets[cat] || ""} onChange={(e) => setLimit(cat, e.target.value)} placeholder="未設上限" className="budget-input" aria-label={`${cat} 每月上限`} />
                </div>
                <div className="bar"><div className="bar-fill" style={{ width: `${pct}%`, background: over ? "#E58A6F" : pct > 80 ? "#E0A458" : s.fg }} /></div>
                <div className={"mono budget-status" + (over ? " over" : "")}>
                  已花 {num(spent)}{lim > 0 && ` / ${num(lim)}`}{over ? `，超支 ${num(spent - lim)}` : lim > 0 ? `，剩餘 ${num(lim - spent)}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- 報表（含原儀表板）----------
const GRID = "rgba(255,255,255,0.06)";
const TICK = { fontSize: 10, fill: "#8E887D" };
const kfmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v / 1000) + "k" : v);
const TIP = {
  contentStyle: { background: "#1A1914", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 12 },
  labelStyle: { color: "#A39D92" }, itemStyle: { color: "#F2EEE6" },
  formatter: (v) => num(v), cursor: { fill: "rgba(255,255,255,0.04)" },
};

function Trend({ transactions, month }) {
  const [range, setRange] = useState("month");
  const mtx = useMemo(() => transactions.filter((t) => monthKey(t.date) === month), [transactions, month]);
  const monthData = useMemo(() => {
    const days = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
    const daily = Array.from({ length: days }, (_, i) => ({ label: String(i + 1), income: 0, expense: 0 }));
    mtx.forEach((t) => { const d = +t.date.slice(8, 10) - 1; if (d >= 0 && d < days) daily[d][t.type] += t.amount; });
    let cum = 0, cumExp = 0;
    return daily.map((r) => { cum += r.income - r.expense; cumExp += r.expense; return { ...r, balance: cum, cumExpense: cumExp }; });
  }, [mtx, month]);
  const yearData = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      const k = monthKey(t.date); if (!k || k > month) return;
      map[k] = map[k] || { key: k, income: 0, expense: 0 };
      map[k][t.type] += t.amount;
    });
    if (!map[month]) map[month] = { key: month, income: 0, expense: 0 };
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key)).slice(-6)
      .map((r) => ({ ...r, label: `${+r.key.slice(5)}月`, balance: r.income - r.expense }));
  }, [transactions, month]);
  const maxDay = monthData.reduce((m, r) => (r.expense > (m?.expense || 0) ? r : m), null);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{range === "month" ? `${+month.slice(5)} 月每日走勢` : `近 ${yearData.length} 個月收支`}</h2>
        <div className="seg" role="group" aria-label="切換期間">
          <button className={range === "month" ? "on" : ""} aria-pressed={range === "month"} onClick={() => setRange("month")}>月</button>
          <button className={range === "year" ? "on" : ""} aria-pressed={range === "year"} onClick={() => setRange("year")}>年</button>
        </div>
      </div>
      {range === "month" ? (mtx.length === 0 ? <Empty text="本月尚無資料" /> : (
        <>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={monthData} margin={{ top: 6, right: 0, left: -4, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} interval={4} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={TICK} width={40} axisLine={false} tickLine={false} tickFormatter={kfmt} />
              <YAxis yAxisId="right" orientation="right" tick={{ ...TICK, fill: "#C9955A" }} width={32} axisLine={false} tickLine={false} tickFormatter={kfmt} />
              <Tooltip {...TIP} labelFormatter={(l) => `${+month.slice(5)}/${l}`} />
              <Bar yAxisId="right" dataKey="expense" name="當日支出" fill="rgba(224,164,88,0.62)" radius={[2, 2, 0, 0]} maxBarSize={10} />
              <Line yAxisId="left" type="monotone" dataKey="cumExpense" name="累積支出" stroke="#E58A6F" strokeWidth={2} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="balance" name="累積結餘" stroke="#8DC48A" strokeWidth={2.2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="legend-row">
            <span><i style={{ background: "rgba(224,164,88,0.62)" }} />當日支出（右軸）</span>
            <span><i className="ln" style={{ background: "#E58A6F" }} />累積支出</span>
            <span><i className="ln" style={{ background: "#8DC48A" }} />累積結餘</span>
          </div>
          {maxDay && maxDay.expense > 0 && <div className="cap">單日最高 {+month.slice(5)}/{maxDay.label} 支出 {num(maxDay.expense)}</div>}
        </>
      )) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={yearData} margin={{ top: 6, right: 4, left: -4, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis tick={TICK} width={40} axisLine={false} tickLine={false} tickFormatter={kfmt} />
              <Tooltip {...TIP} />
              <Bar dataKey="income" name="收入" fill="#6FB6C6" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="expense" name="支出" fill="#E58A6F" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Line type="monotone" dataKey="balance" name="結餘" stroke="#8DC48A" strokeWidth={2.2} dot={{ r: 3.5, fill: "#15140F", stroke: "#8DC48A", strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="legend-row">
            <span><i style={{ background: "#6FB6C6" }} />收入</span>
            <span><i style={{ background: "#E58A6F" }} />支出</span>
            <span><i className="ln" style={{ background: "#8DC48A" }} />結餘</span>
          </div>
        </>
      )}
    </section>
  );
}

function Donut({ mtx }) {
  const map = {};
  mtx.filter((t) => t.type === "expense").forEach((t) => { map[t.category] = (map[t.category] || 0) + t.amount; });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, x) => s + x[1], 0);
  const data = sorted.slice(0, 6).map(([name, value]) => ({ name, value, color: catStyle(name).fg }));
  const rest = sorted.slice(6).reduce((s, x) => s + x[1], 0);
  if (rest > 0) data.push({ name: "其餘分類", value: rest, color: "#6E685E" });
  return (
    <section className="panel">
      <div className="panel-head"><h2>支出結構</h2></div>
      {total === 0 ? <Empty text="本月尚無支出" /> : (
        <div className="donut-row">
          <div className="donut-box">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={46} outerRadius={68} paddingAngle={1.5} stroke="none" isAnimationActive={false}>
                  {data.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center"><small>總支出</small><b>{num(total)}</b></div>
          </div>
          <div className="donut-legend">
            {data.map((d) => (
              <div key={d.name} className="dl-row"><i style={{ background: d.color }} /><span>{d.name}</span><em>{Math.round(d.value / total * 100)}%</em><b>{num(d.value)}</b></div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}


// ---------- Reports ----------
function Reports({ transactions, trips, month, cards, budgets, overseas, setOverseas, setTransactions, setTrips, setCards, setBudgets }) {
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
        const inOv = Array.isArray(data.overseas) ? data.overseas : [];
        const inBd = (data.budgets && typeof data.budgets === "object") ? data.budgets : {};

        if (mode === "replace") {
          setTransactions(inTx); setTrips(inTr); setCards(inCd); setBudgets(inBd); setOverseas(inOv);
          setRestoreMsg({ type: "ok", text: `已覆蓋還原：${inTx.length} 筆收支、${inTr.length} 趟差旅、${inOv.length} 趟出國、${inCd.length} 張卡` });
        } else {
          // 合併：以 id 去重，備份資料補進現有資料（現有優先保留）
          const mergeById = (cur, add) => {
            const ids = new Set(cur.map((x) => x.id));
            return [...cur, ...add.filter((x) => x && x.id && !ids.has(x.id))];
          };
          setTransactions((p) => mergeById(p, inTx));
          setTrips((p) => mergeById(p, inTr));
          setCards((p) => mergeById(p, inCd));
          setOverseas((p) => mergeById(p, inOv));
          setBudgets((p) => ({ ...inBd, ...p })); // 現有預算優先
          setRestoreMsg({ type: "ok", text: `已合併匯入：新增 ${inTx.length} 筆收支、${inTr.length} 趟差旅、${inOv.length} 趟出國、${inCd.length} 張卡（重複 id 自動略過）` });
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
    const data = { transactions, trips, cards, budgets, overseas, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `記帳備份_${todayISO()}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const pendingTravel = trips.filter((t) => !t.reimbursed).reduce((s, t) => s + t.items.reduce((a, x) => a + x.amount, 0), 0);

  const mtx = transactions.filter((t) => monthKey(t.date) === month);
  const income = mtx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = mtx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const rebate = mtx.reduce((s, t) => s + rebateOf(t, cards), 0);
  const bal = income - expense;
  const rate = income ? bal / income * 100 : null;
  const pm = prevMonthKey(month);
  const ptx = transactions.filter((t) => monthKey(t.date) === pm);
  const pIncome = ptx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const pExpense = ptx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const delta = (cur, prev, upGood) => {
    if (!prev) return null;
    const d = (cur - prev) / Math.abs(prev) * 100;
    if (Math.abs(d) < 0.05) return { t: "與上月持平", c: "flat" };
    const up = d > 0;
    return { t: `${up ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}% 比上月`, c: up === upGood ? "good" : "bad" };
  };
  const di = delta(income, pIncome, true), de = delta(expense, pExpense, false);
  const spentBy = {};
  mtx.forEach((t) => { if (t.type === "expense") spentBy[t.category] = (spentBy[t.category] || 0) + t.amount; });
  const over = Object.entries(budgets).filter(([c, l]) => l > 0 && (spentBy[c] || 0) > l);
  const near = Object.entries(budgets).filter(([c, l]) => { const v = spentBy[c] || 0; return l > 0 && v < l && v >= l * 0.8; });
  const mNum = +month.slice(5);

  // 產生一頁式月報 PDF 並下載（PDF 套件只在按下時才載入，不拖慢 App 開啟速度）
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  const downloadReport = async () => {
    if (mtx.length === 0) { setPdfMsg(`${month} 沒有任何收支紀錄，無法產生月報。`); return; }
    setPdfBusy(true); setPdfMsg("");
    const host = document.createElement("div");
    host.className = "mr-export";
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      host.innerHTML = `<article class="mr-sheet mr-print">${buildMonthlyReport({ transactions, cards, budgets, month })}</article>`;
      document.body.appendChild(host);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: "#ffffff", logging: false });
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const PW = 210, PH = 297, M = 8;
      let w = PW - M * 2, h = canvas.height * w / canvas.width;
      if (h > PH - M * 2) { h = PH - M * 2; w = canvas.width * h / canvas.height; } // 縮放到剛好一頁
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (PW - w) / 2, M, w, h);
      pdf.save(`收支月報_${month}.pdf`);
      setPdfMsg(`已產生「收支月報_${month}.pdf」`);
    } catch (e) {
      setPdfMsg("產生失敗：" + (e?.message || e));
    } finally {
      if (host.parentNode) host.parentNode.removeChild(host);
      setPdfBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head"><h1>報表</h1></div>

      <section className="hero">
        <div className="hero-glow" aria-hidden="true" /><div className="hero-line" aria-hidden="true" />
        <div className="hero-body">
          <div className="hero-label">{mNum} 月結餘</div>
          <div className="hero-num"><span className="cur">NT$</span><span className={"big" + (bal < 0 ? " neg" : "")}>{num(bal)}</span></div>
          <div className="mini2">
            <div className="mini"><small>收入</small><b className="inc">{num(income)}</b>{di && <em className={di.c}>{di.t}</em>}</div>
            <div className="mini"><small>支出</small><b className="exp">{num(expense)}</b>{de && <em className={de.c}>{de.t}</em>}</div>
          </div>
          <div className="pills">
            <span className="pill"><i style={{ background: "#6FCF8F" }} />儲蓄率 {rate === null ? "—" : rate.toFixed(1) + "%"}</span>
            <span className="pill"><i style={{ background: "#B99AD6" }} />回饋 {num(rebate)}</span>
            {pendingTravel > 0 && <span className="pill"><i style={{ background: "#E0A458" }} />待報帳 {num(pendingTravel)}</span>}
          </div>
        </div>
      </section>

      {(over.length > 0 || near.length > 0) && (
        <div className="warn-row">
          <span className="warn-ico"><AlertTriangle size={18} /></span>
          <span>
            <b>預算警示</b>
            <small>{[...over.map(([c, l]) => `${c}超支 ${num(spentBy[c] - l)}`), ...near.map(([c, l]) => `${c}已用 ${Math.round((spentBy[c] || 0) / l * 100)}%`)].join("；")}</small>
          </span>
        </div>
      )}

      <Trend transactions={transactions} month={month} />
      <Donut mtx={mtx} />

      <section className="panel">
        <div className="panel-head"><h2>月報與匯出</h2></div>
        <button className="gold-btn" onClick={downloadReport} disabled={pdfBusy}>
          <Download size={18} /> {pdfBusy ? "月報產生中…" : `下載 ${mNum} 月月報 PDF`}
        </button>
        {pdfMsg && <div className="hint" style={{ marginTop: 0 }}>{pdfMsg}</div>}
        <div className="csv3">
          <button className="soft-btn" onClick={exportTx}>收支 CSV</button>
          <button className="soft-btn" onClick={exportRebate}>回饋 CSV</button>
          <button className="soft-btn" onClick={exportTravel}>差旅 CSV</button>
        </div>
        <button className="list-row bordered" onClick={() => setShowBackup((v) => !v)} aria-expanded={showBackup}>
          <span className="list-txt"><b>備份與還原</b><small>完整備份 JSON，合併或覆蓋還原</small></span>
          <ChevronDown size={18} className={"list-chev" + (showBackup ? " up" : "")} />
        </button>
        {showBackup && (
          <div className="backup-box">
            <button className="soft-btn full" onClick={backupAll}><Download size={15} /> 下載完整備份 JSON</button>
            <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: "none" }}
              onChange={(e) => restore(e, e.target.dataset.mode || "merge")} />
            <div className="csv2">
              <button className="soft-btn" onClick={() => pickRestore("merge")}><Upload size={15} /> 合併匯入</button>
              <button className="danger-btn" onClick={() => pickRestore("replace")}><Upload size={15} /> 覆蓋還原</button>
            </div>
            <div className="hint" style={{ marginTop: 0 }}>合併：把備份資料補進現有資料，重複自動略過。覆蓋：清空現有資料再用備份取代。資料已自動同步雲端，備份是額外的保險。</div>
          </div>
        )}
        {restoreMsg && (
          <div className={"restore-msg " + restoreMsg.type}>
            {restoreMsg.type === "ok" ? <Check size={15} /> : <AlertTriangle size={15} />} {restoreMsg.text}
          </div>
        )}
      </section>
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
