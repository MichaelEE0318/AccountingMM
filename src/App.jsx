import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Line, ComposedChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Plus, Trash2, Upload, Download, Plane, Wallet, AlertTriangle, X, Check, CreditCard, Globe,
  Utensils, Bus, BedDouble, Wrench, Briefcase, Smartphone, Home as HomeIcon, ShoppingBag,
  Banknote, Gift, RotateCcw, Percent, Coins, List, BarChart3, PieChart as PieChartIcon,
  MoreHorizontal, ChevronDown, ChevronRight, ChevronLeft, Delete, LogOut, User, Zap, Copy, RefreshCw, Eye, EyeOff,
} from "lucide-react";
import { login, logout, watchAuth, cloudLoad, cloudSave } from "./firebase";
import { buildMonthlyReport } from "./monthlyReport";
import { watchInbox, removeInbox, inboxEndpoint } from "./inbox";

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
// 資料清洗：日期只接受 YYYY-MM-DD；匯入或還原的交易一律整理成安全格式
const isISODate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + "T00:00:00"));
const cleanTx = (t) => (t && typeof t === "object" && isISODate(t.date) && Number.isFinite(+t.amount) && +t.amount > 0 ? {
  ...t, id: String(t.id || uid()), date: t.date, type: t.type === "income" ? "income" : "expense",
  category: String(t.category || "其他支出"), amount: +t.amount, note: String(t.note ?? ""), cardId: String(t.cardId ?? ""),
} : null);
// ===== 捷徑自動記帳 =====
// 依商店名稱猜分類：先看你上次同一家店記成什麼，沒有再用下面的關鍵字表（有問題直接改這張表）
const CAT_RULES = [
  ["餐飲", ["全家", "7-11", "7-ELEVEN", "統一超商", "萊爾富", "OK超商", "OK mart", "麥當勞", "肯德基", "摩斯", "漢堡王", "星巴克", "路易莎", "cama", "85度C", "Uber Eats", "foodpanda", "餐", "麵", "飯", "咖啡", "早餐", "鍋", "食", "壽司", "拉麵", "茶", "飲", "Steak", "牛排", "Restaurant", "餐廳", "Cafe", "Coffee", "Bakery", "麵包", "Pizza", "Burger"]],
  ["交通", ["中油", "台塑石化", "加油", "高鐵", "Taiwan High Sp", "THSR", "台鐵", "臺鐵", "捷運", "Parking", "Taxi", "悠遊卡", "一卡通", "Uber", "yoxi", "計程車", "大都會", "停車", "uTagGo", "遠通", "iRent", "GoShare", "WeMo"]],
  ["通訊", ["中華電信", "台灣大哥大", "遠傳", "台灣之星", "亞太電信"]],
  ["住宿", ["飯店", "旅館", "酒店", "Hotel", "Agoda", "Booking", "民宿", "Airbnb"]],
  ["設備耗材", ["特力屋", "五金", "燦坤", "全國電子", "順發", "大同3C", "電子股份", "電子材料"]],
  ["辦公", ["文具", "誠品", "金石堂", "影印"]],
];
const normTxt = (x) => String(x || "").toLowerCase().replace(/\s+/g, "");
function guessCategory(merchant, transactions) {
  const m = normTxt(merchant);
  if (m) {
    const past = transactions.filter((t) => t.type === "expense" && normTxt(t.note) === m && CATEGORIES.expense.includes(t.category))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (past) return { category: past.category, by: "上次同一家店" };
    for (const [cat, words] of CAT_RULES) if (words.some((w) => m.includes(normTxt(w)))) return { category: cat, by: "商店名稱" };
  }
  return { category: "其他支出", by: "預設" };
}
function matchCard(text, cards) {
  const q = normTxt(text);
  if (!q) return "";
  let c = cards.find((x) => { const n = normTxt(x.name); return n && (n.includes(q) || q.includes(n)); });
  if (!c) { // 錢包給的是銀行名（例：台新銀行），去掉「銀行、商業銀行、卡」再比一次
    const bank = q.replace(/(商業)?銀行|bank|信用卡|金融卡|卡$/g, "");
    if (bank.length >= 2) c = cards.find((x) => normTxt(x.name).includes(bank));
    // 再退一步：全名（國泰世華商業銀行）對卡片簡稱（國泰 CUBE），比前兩個字
    if (!c && bank.length >= 2 && /^[一-鿿]{2}/.test(bank)) c = cards.find((x) => normTxt(x.name).startsWith(bank.slice(0, 2)));
  }
  return c ? c.id : "";
}
// 解析網址 # 後面的資料：#add&k=金鑰&amt=金額&m=商店&card=卡片
// 金額：去掉 NT$、逗號、元；只收 1 ~ 9,999,999，其他回 0
function cleanAmount(v) {
  const raw = String(v ?? "").replace(/[,，\s]|NT\$|TWD|\$|元/gi, "");
  const amount = /^\d+(\.\d+)?$/.test(raw) ? Math.round(parseFloat(raw) * 100) / 100 : 0;
  return amount >= 1 && amount <= 9999999 ? amount : 0;
}
// 商店名：去掉控制字元與 < >，以及錢包附帶的「, 台北市大安區」
const cleanMerchant = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "")
  .replace(/[,，]\s*[^,，]{1,4}[市縣][^,，]{1,5}[區鄉鎮市]\s*$/, "").trim().slice(0, 60);
const cleanCardText = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 30);
// 收件匣的文字是捷徑先做過 URL 編碼的（避免商店名裡的引號弄壞 JSON），這裡解回來
function decodeSafe(v) {
  const s = String(v ?? "");
  try { return decodeURIComponent(s.replace(/\+/g, "%20")); } catch { return s; }
}
function parseShortcutLink(hash) {
  const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (!p.has("add")) return null;
  const amount = cleanAmount(p.get("amt")); // 超出範圍就不帶金額，讓你自己輸入
  const merchant = cleanMerchant(p.get("m"));
  const card = cleanCardText(p.get("card"));
  // 刷卡日期：接受 2026-10-22 或通知裡的 10/22（自動補年份，跨年時算去年）
  let date = "";
  const d = String(p.get("d") || "").trim();
  const md = d.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    const now = new Date(); let y = now.getFullYear();
    if (+md[1] > now.getMonth() + 1) y -= 1;
    date = `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  } else date = d;
  if (!isISODate(date) || date > todayISO()) date = "";
  return { key: String(p.get("k") || ""), amount, merchant, card, date };
}
function genKey() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// 防重複：記錄最近 10 分鐘「帶入過／記下過」的金額與日期，Safari 不同分頁之間共用
const RECENT_KEY = "ledger:recentLinks";
function recentLinks() {
  try {
    const now = Date.now();
    return (JSON.parse(localStorage.getItem(RECENT_KEY)) || []).filter((r) => now - r.at < 10 * 60 * 1000);
  } catch { return []; }
}
function logRecent(entry) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([...recentLinks(), { ...entry, at: Date.now() }].slice(-30))); } catch { /* 無法寫入就略過 */ }
}
const sameTx = (a, b) => a.date === b.date && Math.abs(a.amount - b.amount) < 0.01;
const minsAgo = (at) => Math.max(1, Math.round((Date.now() - at) / 60000));
const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// 收件匣一筆 → 明細一筆。回傳 { kind: "tx" | "ping" | "bad", tx?, merchant? }
// 日期用「付款當下」捷徑送出的時間（伺服器已檢查過在 10 分鐘內），不是你打開網頁的時間
function inboxToTx(item, existing, cards) {
  const merchant = cleanMerchant(decodeSafe(item.m));
  const cardText = cleanCardText(decodeSafe(item.card));
  const amount = cleanAmount(item.amt);
  if (!amount) return { kind: !merchant && !String(item.amt ?? "").trim() ? "ping" : "bad", merchant };
  const at = item.at && typeof item.at.toDate === "function" ? item.at.toDate() : new Date();
  const date = localISO(at);
  const g = guessCategory(merchant, existing);
  const me = { date, amount };
  const dupOf = existing.find((t) => t.type === "expense" && sameTx(t, me));
  return {
    kind: "tx",
    tx: {
      id: "ib_" + item.id, date, type: "expense", category: g.category, amount, note: merchant,
      cardId: matchCard(cardText, cards), src: "notify", paidAt: `${date} ${hhmm(at)}`,
      ...(dupOf ? { dup: true } : {}),
    },
  };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 改用舊方法 */ }
  try {
    const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
  } catch { return false; }
}

const prevMonthKey = (m) => { let [y, mm] = m.split("-").map(Number); mm--; if (mm === 0) { mm = 12; y--; } return y + "-" + String(mm).padStart(2, "0"); };


// ---------- Storage：本機快取 + Firestore 雲端（雲端優先）----------
const KEYS = { tx: "transactions", bd: "budgets", tr: "trips", cd: "cards", ov: "overseas", st: "settings" };
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
  const [settings, setSettings] = useState(() => cacheLoad(uid, KEYS.st, {}));
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
      const [tx, bd, tr, cd, ov, st] = await Promise.all([
        cloudLoad(uid, KEYS.tx, null), cloudLoad(uid, KEYS.bd, null),
        cloudLoad(uid, KEYS.tr, null), cloudLoad(uid, KEYS.cd, null),
        cloudLoad(uid, KEYS.ov, null), cloudLoad(uid, KEYS.st, null),
      ]);
      if (!alive) return;
      if (tx !== null) setTransactions(tx);
      if (bd !== null) setBudgets(bd);
      if (tr !== null) setTrips(tr);
      if (cd !== null) setCards(cd);
      if (ov !== null) setOverseas(ov);
      if (st !== null) setSettings(st);
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
  useEffect(() => { if (!ready.current) return; cacheSave(uid, KEYS.st, settings); cloudSave(uid, KEYS.st, settings); }, [settings, uid]);

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
  const notify = (msg, ms = 2400) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  };
  const saveQuick = (tx) => {
    setTransactions((p) => [tx, ...p]);
    setQuick(null);
    setMonth(monthKey(tx.date));
    notify(`已記下 ${tx.category} ${num(tx.amount)}`);
  };

  // 捷徑連結：讀到 #add 就先記下來，並立刻把網址清乾淨（金鑰與金額不留在網址列）
  const [pendingLink, setPendingLink] = useState(null);
  useEffect(() => {
    const grab = () => {
      if (!location.hash.startsWith("#add")) return;
      setPendingLink(location.hash);
      history.replaceState(null, "", location.pathname + location.search);
    };
    grab();
    window.addEventListener("hashchange", grab);
    return () => window.removeEventListener("hashchange", grab);
  }, []);
  const openFromLink = (link, { skipKey = false } = {}) => {
    if (!link) return;
    if (!skipKey) {
      if (!settings.shortcutKey) { notify("還沒設定捷徑金鑰，請到「更多 → 捷徑自動記帳」產生", 4000); return; }
      if (link.key !== settings.shortcutKey) { notify("連結的金鑰不符，已忽略這筆資料", 4000); return; }
    }
    const g = guessCategory(link.merchant, transactions);
    const day = link.date || todayISO();
    const me = { date: day, amount: link.amount };
    let dupNote = "";
    if (link.amount) {
      const saved = transactions.find((t) => t.type === "expense" && sameTx(t, me));
      const recent = recentLinks().filter((r) => sameTx(r, me)).pop();
      if (saved) dupNote = `${+day.slice(5, 7)}/${+day.slice(8)} 已經有一筆 ${num(saved.amount)}（${saved.note || saved.category}），可能重複，確認不是同一筆再記下`;
      else if (recent) dupNote = `${minsAgo(recent.at)} 分鐘內另一則通知也帶入了 ${num(link.amount)}${recent.note ? `（${recent.note}）` : ""}，多半是同一筆（Apple Pay 和銀行 App 都會通知）。只記其中一筆，另一個按關閉`;
      logRecent({ ...me, note: link.merchant, kind: "open" });
    }
    setQuick({ dupNote, type: "expense", category: g.category, guessBy: g.by, amount: link.amount, note: link.merchant, date: link.date,
      cardId: matchCard(link.card, cards), cardText: link.card, src: "notify", fromLink: true });
  };
  useEffect(() => {
    if (!pendingLink || syncing) return; // 等雲端設定載入完才比對金鑰
    openFromLink(parseShortcutLink(pendingLink));
    setPendingLink(null);
  }, [pendingLink, syncing]); // eslint-disable-line react-hooks/exhaustive-deps

  // 收件匣：捷徑在背景投遞的交易。網頁開著就即時監聽，一到就搬進明細，
  // 先確定明細已寫回雲端，才刪掉收件匣那筆（中途斷線也不會掉資料，下次打開會再搬一次，靠 id 去重）
  const txRef = useRef(transactions);
  txRef.current = transactions;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const inboxBusy = useRef(false);
  const inboxQueue = useRef(null);
  const [inboxErr, setInboxErr] = useState("");
  useEffect(() => {
    if (syncing) return;
    const handle = async (items) => {
      if (inboxBusy.current) { inboxQueue.current = items; return; }
      inboxBusy.current = true;
      try {
        let list = txRef.current;
        const added = [], done = [];
        let pings = 0, bad = 0, dups = 0;
        for (const it of [...items].sort((a, b) => (a.at?.seconds || 0) - (b.at?.seconds || 0))) {
          if (list.some((t) => t.id === "ib_" + it.id)) { done.push(it.id); continue; } // 已經搬過，只差刪除
          const r = inboxToTx(it, list, cardsRef.current);
          if (r.kind === "tx") { list = [r.tx, ...list]; added.push(r.tx); if (r.tx.dup) dups++; }
          else if (r.kind === "ping") pings++;
          else bad++;
          done.push(it.id);
        }
        if (added.length) {
          const ok = await cloudSave(uid, KEYS.tx, list);
          if (!ok) { notify("收件匣搬移失敗（雲端寫入沒成功），下次打開會再試", 4000); return; }
          // 合併進「目前」的明細（等雲端那幾百毫秒內你若剛好手動記了一筆，也不會被蓋掉）
          setTransactions((p) => { const ids = new Set(p.map((t) => t.id)); return [...added.filter((t) => !ids.has(t.id)).reverse(), ...p]; });
        }
        await Promise.all(done.map((id) => removeInbox(uid, id).catch((e) => console.error("刪除收件匣失敗", id, e))));
        const msg = [];
        if (added.length) msg.push(`已從收件匣記下 ${added.length} 筆${added.length === 1 ? `：${added[0].note || added[0].category} ${num(added[0].amount)}` : ""}`);
        if (dups) msg.push(`${dups} 筆可能重複，到明細確認`);
        if (bad) msg.push(`${bad} 筆金額無法辨識，已略過`);
        if (pings && !added.length) msg.push("收到捷徑的測試投遞，連線正常");
        if (msg.length) notify(msg.join("；"), 4500);
        if (added.length) setMonth(monthKey(added[added.length - 1].date));
      } finally {
        inboxBusy.current = false;
        const next = inboxQueue.current;
        inboxQueue.current = null;
        if (next) handle(next);
      }
    };
    const stop = watchInbox(uid, (items) => { setInboxErr(""); if (items.length) handle(items); },
      (e) => { console.error("收件匣監聽失敗", e); setInboxErr(e?.code || "error"); });
    return stop;
  }, [uid, syncing]); // eslint-disable-line react-hooks/exhaustive-deps

  const navActive = ["cards", "travel", "overseas", "shortcut"].includes(tab) ? "more" : tab;

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
        {tab === "more" && <More user={user} cards={cards} trips={trips} overseas={overseas} transactions={transactions} month={month} goto={goto} settings={settings} />}
        {tab === "cards" && <div className="stack"><SubHead title="信用卡" goto={goto} /><Cards cards={cards} setCards={setCards} transactions={transactions} month={month} /></div>}
        {tab === "travel" && <div className="stack"><SubHead title="差旅代墊" goto={goto} /><Travel trips={trips} setTrips={setTrips} setTransactions={setTransactions} /></div>}
        {tab === "overseas" && <div className="stack"><SubHead title="出國消費" goto={goto} /><Overseas overseas={overseas} setOverseas={setOverseas} cards={cards} setTransactions={setTransactions} /></div>}
        {tab === "shortcut" && <div className="stack"><SubHead title="捷徑自動記帳" goto={goto} /><ShortcutSettings uid={uid} inboxErr={inboxErr} settings={settings} setSettings={setSettings} cards={cards} notify={notify}
          onTest={() => openFromLink({ key: "", amount: 120, merchant: "全家便利商店（測試）", card: cards[0]?.name || "" }, { skipKey: true })} /></div>}
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

// ---------- 捷徑自動記帳設定 ----------
function inboxTemplate(key) {
  return `{"fields":{"k":{"stringValue":"${key}"},"amt":{"stringValue":"〔數量〕"},"m":{"stringValue":"〔URL 編碼商家〕"},"card":{"stringValue":"〔URL 編碼卡片〕"},"at":{"timestampValue":"〔格式化的日期〕"}}}`;
}
function ShortcutSettings({ uid, settings, setSettings, cards, notify, onTest, inboxErr }) {
  const [show, setShow] = useState(false);
  const [pinging, setPinging] = useState(false);
  const key = settings.shortcutKey || "";
  const base = `${location.origin}${location.pathname}#add&k=${key}`;
  const masked = key ? "•".repeat(Math.max(0, key.length - 4)) + key.slice(-4) : "";
  const endpoint = inboxEndpoint(uid);
  const tpl = inboxTemplate(key);
  // 從網頁模擬捷徑送一筆「空白測試」，走跟捷徑完全一樣的路（不登入、靠金鑰、經過安全規則）
  const ping = async () => {
    setPinging(true);
    try {
      const body = { fields: { k: { stringValue: key }, amt: { stringValue: "" }, at: { timestampValue: new Date().toISOString() } } };
      const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit" });
      if (!r.ok) notify(r.status === 403 ? "被安全規則擋下：確認 Firebase 規則已更新，且金鑰已同步到雲端" : `投遞失敗（${r.status}）`, 5000);
    } catch { notify("連不上 Firestore，檢查網路", 4000); }
    setPinging(false);
  };
  const create = () => {
    if (key && !window.confirm("重新產生後，舊的金鑰立刻失效，手機上的捷徑要換成新的網址才能用。確定嗎？")) return;
    setSettings((p) => ({ ...p, shortcutKey: genKey(), keyCreatedAt: new Date().toISOString() }));
    notify(key ? "已產生新金鑰，記得更新捷徑" : "已產生金鑰");
  };
  const copy = async (text, label) => notify((await copyText(text)) ? `已複製${label}` : "複製失敗，請長按文字手動複製");
  return (
    <>
      <div className="card">
        <div className="hint" style={{ marginTop: 0, lineHeight: 1.8 }}>
          兩種用法，可以並存：<br />
          <b style={{ color: "#F2EEE6" }}>背景記帳（收件匣）</b>：刷卡後捷徑在背景把交易丟進你的收件匣，不跳出 Safari；下次打開網頁自動記進明細，標「自動」，分類可再改。<br />
          <b style={{ color: "#F2EEE6" }}>打開確認</b>：捷徑打開這個網頁並填好，你按「記下」才存。
        </div>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>捷徑金鑰</h2></div>
        {key ? (
          <>
            <div className="key-box mono">{show ? key : masked}</div>
            <div className="csv3">
              <button className="soft-btn" onClick={() => setShow((v) => !v)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}{show ? "隱藏" : "顯示"}</button>
              <button className="soft-btn" onClick={() => copy(key, "金鑰")}><Copy size={15} />複製</button>
              <button className="danger-btn" onClick={create}><RefreshCw size={15} />換新</button>
            </div>
            <div className="hint" style={{ marginTop: 0 }}>網址裡的金鑰對不上時，網頁會直接忽略，別人傳來的假連結無法塞資料。金鑰外流時按「換新」。</div>
          </>
        ) : (
          <>
            <div className="hint" style={{ marginTop: 0 }}>先產生一組金鑰，捷徑每次打開網頁都要帶著它。</div>
            <button className="gold-btn" onClick={create}><Zap size={17} />產生金鑰</button>
          </>
        )}
      </section>

      {key && (
        <section className="panel">
          <div className="panel-head"><h2>背景記帳：投遞網址</h2></div>
          <div className="key-box small mono">{endpoint}</div>
          <button className="soft-btn full" onClick={() => copy(endpoint, "投遞網址")}><Copy size={15} />複製投遞網址</button>
          <div className="hint" style={{ marginTop: 0, lineHeight: 1.8 }}>
            貼進捷徑的「取得 URL 內容」，方法選 <span className="mono">POST</span>，標頭加 <span className="mono">Content-Type: application/json</span>，要求本文選「檔案」並放下面那段文字。
            這個網址本身不含金鑰；沒有金鑰的人送來會被 Firebase 安全規則擋掉，而且只能「新增」，讀不到也刪不掉你的任何資料。
          </div>
        </section>
      )}

      {key && (
        <section className="panel">
          <div className="panel-head"><h2>背景記帳：要送的文字</h2></div>
          <div className="key-box small mono">{show ? tpl : tpl.replace(key, masked)}</div>
          <button className="soft-btn full" onClick={() => copy(tpl, "文字範本")}><Copy size={15} />複製文字範本（含金鑰）</button>
          <div className="hint" style={{ marginTop: 0, lineHeight: 1.8 }}>
            貼進捷徑的「文字」動作後，把 4 個〔 〕整段刪掉，換成對應的藍色變數：〔數量〕→ 交易的「數量」、〔URL 編碼商家〕、〔URL 編碼卡片〕→ 前面兩個 URL 編碼的結果、〔格式化的日期〕→ 格式化日期（ISO 8601、含時間）。
            付款時間要在送達前 10 分鐘內，舊資料重送會被擋。
          </div>
          <button className="soft-btn full" disabled={pinging} onClick={ping}><Zap size={15} />{pinging ? "投遞中…" : "從網頁送一筆測試到收件匣"}</button>
          {inboxErr && <div className="hint" style={{ marginTop: 0, color: "#F2A48E" }}>收件匣讀取失敗（{inboxErr}）：通常是 Firebase 規則還沒更新。</div>}
        </section>
      )}

      {key && (
        <section className="panel">
          <div className="panel-head"><h2>打開確認：網址開頭</h2></div>
          <div className="key-box small mono">{show ? base : base.replace(key, masked)}</div>
          <button className="soft-btn full" onClick={() => copy(base, "網址開頭")}><Copy size={15} />複製網址開頭</button>
          <div className="hint" style={{ marginTop: 0, lineHeight: 1.8 }}>
            捷徑會在後面接上 <span className="mono">&amp;amt=金額&amp;m=商店&amp;card=卡片</span>。這段網址含金鑰，只貼進你自己的捷徑，不要傳給別人。
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><h2>試試看</h2></div>
        <div className="hint" style={{ marginTop: 0 }}>模擬一筆「全家便利商店 120 元」{cards[0] ? `，用 ${cards[0].name}` : ""}，看看帶入後的畫面。按關閉就不會記帳。</div>
        <button className="soft-btn full" onClick={onTest}><Zap size={15} />模擬一筆捷徑帶入</button>
      </section>
    </>
  );
}

// ---------- 更多 ----------
function More({ user, cards, trips, overseas, transactions, month, goto, settings }) {
  const mtx = transactions.filter((t) => monthKey(t.date) === month);
  const rebate = mtx.reduce((s, t) => s + rebateOf(t, cards), 0);
  const pend = trips.filter((t) => !t.reimbursed && t.items.length > 0);
  const pendAmt = pend.reduce((s, t) => s + t.items.reduce((a, x) => a + x.amount, 0), 0);
  const items = [
    { id: "cards", Icon: CreditCard, color: "#B99AD6", title: "信用卡", sub: cards.length ? `${cards.length} 張卡，本月回饋 ${num(rebate)}` : "新增卡片與回饋率" },
    { id: "travel", Icon: Plane, color: "#E0A458", title: "差旅代墊", sub: pend.length ? `${pend.length} 趟待報帳，共 ${num(pendAmt)}` : `${trips.length} 趟行程` },
    { id: "overseas", Icon: Globe, color: "#7FCAD4", title: "出國消費", sub: overseas.length ? `${overseas.length} 趟旅程` : "建立旅程，即時匯率換算" },
    { id: "shortcut", Icon: Zap, color: "#8FD3AE", title: "捷徑自動記帳", sub: settings.shortcutKey ? "已設定金鑰，收到刷卡通知自動帶入" : "用 iPhone 捷徑讀取刷卡通知" },
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
  const [amt, setAmt] = useState(init.amount ? String(init.amount) : "");
  const [cardId, setCardId] = useState(() => {
    if (init.fromLink) return init.cardId || ""; // 捷徑帶入：只用對到的卡，對不到就留空
    try { return localStorage.getItem("ledger:lastCard") || ""; } catch { return ""; }
  });
  const [note, setNote] = useState(init.note || "");
  const [date, setDate] = useState(init.date || todayISO());

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
    if (init.fromLink && type === "expense") {
      const me = { date, amount: n };
      const savedHere = transactions.find((t) => t.type === "expense" && sameTx(t, me));
      const savedElsewhere = recentLinks().filter((r) => r.kind === "saved" && sameTx(r, me)).pop();
      const hit = savedHere || savedElsewhere;
      if (hit && !window.confirm(`${+date.slice(5, 7)}/${+date.slice(8)} 已經記過一筆 ${num(n)}${hit.note ? `（${hit.note}）` : ""}。\n確定這是另一筆、還要再記一次嗎？`)) return;
      logRecent({ ...me, note: note.trim(), kind: "saved" });
    }
    const cid = type === "expense" ? validCard : "";
    try { if (type === "expense") localStorage.setItem("ledger:lastCard", cid); } catch { /* 無痕模式可能無法寫入 */ }
    onSave({ id: uid(), date, type, category, amount: n, note: note.trim(), cardId: cid, ...(init.src ? { src: init.src } : {}) });
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

        {init.dupNote && <div className="link-banner warn"><AlertTriangle size={16} /><span><b>可能重複記帳</b><small>{init.dupNote}</small></span></div>}
        {init.fromLink && (
          <div className="link-banner">
            <Zap size={16} />
            <span>
              <b>來自捷徑自動帶入，請確認後再記下</b>
              <small>{init.note ? `分類依${init.guessBy}猜測` : "通知裡沒有商店名稱，請選分類"}{init.cardText && !init.cardId ? `；卡片「${init.cardText}」沒有對應到你設定的卡，請手動選擇` : ""}{!init.amount ? "；沒有抓到金額，請自己輸入" : ""}</small>
            </span>
          </div>
        )}
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
    setTransactions((p) => p.map((t) => t.id === editId ? { ...draft, dup: false, amount: +draft.amount, cardId: draft.type === "expense" ? draft.cardId : "" } : t));
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
        if (!isISODate(c[0])) return; // 日期格式不對（應為 2026-10-02）就略過
        rows.push({ id: uid(), date: c[0], type: /收|income|\+/i.test(c[1]) ? "income" : "expense", category: c[2] || "其他支出", amount: Math.abs(amt), note: c[4] || "", cardId: "" });
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
                    <span className="tx-txt"><b>{t.note || t.category}{t.src === "notify" && <em className="src-tag">自動</em>}{t.dup && <em className="src-tag warn">可能重複</em>}</b><small>{t.type === "expense" ? (t.note ? `${t.category}，${cn || "現金"}` : (cn || "現金")) : (t.note ? t.category : "收入")}</small></span>
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
        const inTx = (Array.isArray(data.transactions) ? data.transactions : []).map(cleanTx).filter(Boolean);
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
    // 文字欄開頭是 = + - @ 時加上 ' ，避免 Excel 當成公式執行；純數字保持原樣
    const safe = (c) => { const v = String(c ?? ""); return typeof c !== "number" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v; };
    const csv = rows.map((r) => r.map((c) => `"${safe(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
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
