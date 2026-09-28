// 收支月報：用當月真實資料產生一頁式報表（HTML 字串）
// 所有使用者輸入的文字都經過 esc() 轉義，避免被當成 HTML 執行

const PAL = ["#2C6E7F", "#E0A458", "#B5533E", "#7A9E7E", "#8C6A9E", "#5B7C99", "#C97B84"];
const FIXED_CATS = ["房貸", "通訊"]; // 視為固定支出的分類

const mk = (d) => (d || "").slice(0, 7);
const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
const sum = (a, f = (x) => x.amount) => a.reduce((s, x) => s + f(x), 0);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const prevMonth = (m) => { let [y, mm] = m.split("-").map(Number); mm--; if (mm === 0) { mm = 12; y--; } return y + "-" + String(mm).padStart(2, "0"); };
const niceStep = (v) => { const raw = v / 4; const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

function makeRebate(cards) {
  return (t) => {
    if (t.type !== "expense" || !t.cardId) return 0;
    const c = cards.find((x) => x.id === t.cardId);
    return c ? Math.round(t.amount * (c.rate || 0) / 100) : 0;
  };
}

function stats(transactions, m, rebateOf) {
  const txs = transactions.filter((t) => mk(t.date) === m);
  const inc = txs.filter((t) => t.type === "income"), exp = txs.filter((t) => t.type === "expense");
  const byCat = {}, byInc = {};
  exp.forEach((t) => (byCat[t.category] = (byCat[t.category] || 0) + t.amount));
  inc.forEach((t) => (byInc[t.category] = (byInc[t.category] || 0) + t.amount));
  return { m, inc, exp, income: sum(inc), expense: sum(exp), byCat, byInc, rebate: sum(exp, rebateOf) };
}

function delta(cur, prev, upGood) {
  if (!prev) return '<span class="mr-d flat">上月無資料</span>';
  const p = (cur - prev) / Math.abs(prev) * 100;
  if (Math.abs(p) < 0.05) return '<span class="mr-d flat">與上月持平</span>';
  const up = p > 0, good = up === upGood;
  return `<span class="mr-d ${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}%<small>比上月</small></span>`;
}

function chart6(transactions, ms, cur, rebateOf) {
  const data = ms.map((m) => { const s = stats(transactions, m, rebateOf); return { m, inc: s.income, exp: s.expense, bal: s.income - s.expense }; });
  const W = 560, H = 210, l = 46, r = 8, t = 12, b = 28;
  const hi = Math.max(...data.map((d) => Math.max(d.inc, d.exp)), 1);
  const step = niceStep(hi), top = Math.ceil(hi / step) * step;
  const lo = Math.min(0, ...data.map((d) => d.bal));
  const min = lo < 0 ? -Math.ceil(-lo / step) * step : 0;
  const y = (v) => t + (top - v) / (top - min) * (H - t - b);
  const gw = (W - l - r) / data.length, bw = Math.min(20, gw * 0.28);
  let g = "";
  for (let v = min; v <= top + 1; v += step) g += `<line class="mr-gl" x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"/><text class="mr-ax" x="${l - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v / 1000)}k</text>`;
  const pts = [];
  data.forEach((d, i) => {
    const x0 = l + gw * i + gw / 2;
    g += `<rect class="mr-inc" x="${x0 - bw - 2}" y="${y(d.inc)}" width="${bw}" height="${Math.max(0, y(0) - y(d.inc))}" rx="2"><title>${d.m} 收入 ${money(d.inc)}</title></rect>`;
    g += `<rect class="mr-exp" x="${x0 + 2}" y="${y(d.exp)}" width="${bw}" height="${Math.max(0, y(0) - y(d.exp))}" rx="2"><title>${d.m} 支出 ${money(d.exp)}</title></rect>`;
    g += `<text class="mr-ax${d.m === cur ? " cur" : ""}" x="${x0}" y="${H - 8}" text-anchor="middle">${+d.m.slice(5)}月</text>`;
    pts.push([x0, y(d.bal)]);
  });
  g += `<polyline class="mr-lnbal" points="${pts.map((p) => p.join(",")).join(" ")}"/>`;
  pts.forEach((p, i) => (g += `<circle class="mr-ptbal" cx="${p[0]}" cy="${p[1]}" r="3.5"><title>${data[i].m} 結餘 ${money(data[i].bal)}</title></circle>`));
  return `<svg class="mr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近六個月收支">${g}</svg>
  <div class="mr-legend"><span><i style="background:#2C6E7F"></i>收入</span><span><i style="background:#B5533E"></i>支出</span><span><i style="background:#5A7D4E"></i>結餘</span></div>`;
}

function donut(s) {
  const ent = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const top = ent.slice(0, 5), rest = ent.slice(5).reduce((a, x) => a + x[1], 0);
  if (rest > 0) top.push(["其他", rest]);
  const R = 58, C = 2 * Math.PI * R; let acc = 0, arcs = "";
  top.forEach(([k, v], i) => {
    const len = v / s.expense * C;
    arcs += `<circle r="${R}" cx="75" cy="75" fill="none" stroke="${PAL[i % PAL.length]}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 75 75)"><title>${esc(k)} ${money(v)}</title></circle>`;
    acc += len;
  });
  const leg = top.map(([k, v], i) => `<div class="mr-legrow"><span><i style="background:${PAL[i % PAL.length]}"></i>${esc(k)}<em>${(v / s.expense * 100).toFixed(0)}%</em></span><span class="mr-num">${money(v)}</span></div>`).join("");
  return `<div class="mr-donutwrap"><svg class="mr-donut" viewBox="0 0 150 150" role="img" aria-label="支出結構">${arcs}<text class="mr-dnl" x="75" y="70" text-anchor="middle">總支出</text><text class="mr-dnv" x="75" y="89" text-anchor="middle">${money(s.expense)}</text></svg><div class="mr-leglist">${leg}</div></div>`;
}

function daily(s) {
  const days = new Date(+s.m.slice(0, 4), +s.m.slice(5, 7), 0).getDate(), arr = Array(days).fill(0);
  s.exp.forEach((t) => { const d = +t.date.slice(8, 10) - 1; if (d >= 0 && d < days) arr[d] += t.amount; });
  const W = 560, H = 160, l = 46, r = 8, t = 10, b = 24;
  const mx = Math.max(...arr, 1), step = niceStep(mx), top = Math.ceil(mx / step) * step;
  const y = (v) => t + (top - v) / top * (H - t - b), bw = (W - l - r) / days, maxI = arr.indexOf(mx), avg = s.expense / days;
  let g = "";
  for (let v = 0; v <= top + 1; v += step) g += `<line class="mr-gl" x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"/><text class="mr-ax" x="${l - 6}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? Math.round(v / 1000) + "k" : v}</text>`;
  arr.forEach((v, i) => {
    if (v > 0) g += `<rect class="${i === maxI ? "mr-max" : "mr-soft"}" x="${l + bw * i + bw * 0.15}" y="${y(v)}" width="${bw * 0.7}" height="${y(0) - y(v)}" rx="1.5"><title>${i + 1} 日 ${money(v)}</title></rect>`;
    if ([0, 4, 9, 14, 19, 24, 29].includes(i)) g += `<text class="mr-ax" x="${l + bw * i + bw / 2}" y="${H - 6}" text-anchor="middle">${i + 1}</text>`;
  });
  g += `<line class="mr-lnavg" x1="${l}" x2="${W - r}" y1="${y(avg)}" y2="${y(avg)}"/>`;
  return `<svg class="mr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="每日支出">${g}</svg>
  <div class="mr-legend"><span><i style="background:#E0A458"></i>單日最高 ${maxI + 1} 日 ${money(mx)}</span><span><i style="background:#6F7A72;height:2px"></i>日均 ${money(avg)}</span></div>`;
}

function catTable(s, p, budgets) {
  const cats = [...new Set([...Object.keys(s.byCat), ...Object.keys(p.byCat)])].sort((a, b) => (s.byCat[b] || 0) - (s.byCat[a] || 0));
  const rows = cats.map((c) => {
    const v = s.byCat[c] || 0, pv = p.byCat[c] || 0, d = v - pv;
    const dcell = !p.expense ? '<span class="mr-flat">—</span>' : d === 0 ? '<span class="mr-flat">持平</span>' : `<span class="${d > 0 ? "mr-up" : "mr-down"}">${d > 0 ? "+" : "−"}${money(Math.abs(d))}</span>`;
    const lim = budgets[c]; let bud = '<span class="mr-flat">未設</span>';
    if (lim) {
      const pc = v / lim * 100, col = pc > 100 ? "#B5533E" : pc >= 80 ? "#E0A458" : "#2C6E7F";
      bud = `<div class="mr-bud"><div class="mr-bar"><div style="width:${Math.min(100, pc)}%;background:${col}"></div></div><span class="mr-num" style="color:${pc > 100 ? "#B5533E" : "inherit"}">${pc.toFixed(0)}%</span></div>`;
    }
    return `<tr><td>${esc(c)}</td><td class="r mr-num">${money(v)}</td><td class="r mr-num">${s.expense ? (v / s.expense * 100).toFixed(0) : 0}%</td><td class="r mr-num">${dcell}</td><td>${bud}</td></tr>`;
  }).join("");
  return `<div class="mr-tblwrap"><table class="mr-tbl"><thead><tr><th>分類</th><th class="r">金額</th><th class="r">占比</th><th class="r">比上月</th><th>預算執行</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function insights(s, p, budgets, cards, rebateOf) {
  const out = [], bal = s.income - s.expense, rate = s.income ? bal / s.income * 100 : 0;
  const prate = p.income ? (p.income - p.expense) / p.income * 100 : null;
  out.push([bal >= 0 ? "good" : "bad", `本月結餘 <b>${money(bal)}</b>，儲蓄率 <b>${s.income ? rate.toFixed(1) + "%" : "—"}</b>${prate !== null ? `（上月 ${prate.toFixed(1)}%）` : ""}。`]);
  if (p.expense) {
    const cats = [...new Set([...Object.keys(s.byCat), ...Object.keys(p.byCat)])], d = s.expense - p.expense;
    const diffs = cats.map((c) => [c, (s.byCat[c] || 0) - (p.byCat[c] || 0)]);
    if (d > 0) {
      const dr = diffs.filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => `${esc(x[0])} +${money(x[1])}`).join("、");
      out.push(["bad", `支出比上月多 <b>${money(d)}</b>，主要來自${dr}。`]);
    } else if (d < 0) {
      const dr = diffs.filter((x) => x[1] < 0).sort((a, b) => a[1] - b[1]).slice(0, 2).map((x) => `${esc(x[0])} −${money(-x[1])}`).join("、");
      out.push(["good", `支出比上月少 <b>${money(-d)}</b>，主要是${dr}。`]);
    }
  }
  const over = Object.entries(budgets).filter(([c, l]) => l > 0 && (s.byCat[c] || 0) > l);
  const near = Object.entries(budgets).filter(([c, l]) => { const v = s.byCat[c] || 0; return l > 0 && v < l && v >= l * 0.8; });
  if (over.length) out.push(["bad", `超出預算：${over.map(([c, l]) => `${esc(c)} 超 ${money(s.byCat[c] - l)}`).join("、")}。`]);
  if (near.length) out.push(["warn", `接近預算上限：${near.map(([c, l]) => `${esc(c)} 已用 ${((s.byCat[c] || 0) / l * 100).toFixed(0)}%`).join("、")}。`]);
  const fixed = FIXED_CATS.reduce((a, c) => a + (s.byCat[c] || 0), 0);
  if (s.expense && fixed) out.push(["", `固定支出（房貸＋通訊）<b>${money(fixed)}</b>，占總支出 ${(fixed / s.expense * 100).toFixed(0)}%。`]);
  const big = s.exp.filter((t) => !FIXED_CATS.includes(t.category)).sort((a, b) => b.amount - a.amount)[0];
  if (big) out.push(["", `最大一筆非固定支出：${esc(big.category)}${big.note ? `「${esc(big.note)}」` : ""} <b>${money(big.amount)}</b>（${+big.date.slice(5, 7)}/${+big.date.slice(8, 10)}）。`]);
  const byCard = {}; s.exp.forEach((t) => { if (t.cardId) byCard[t.cardId] = (byCard[t.cardId] || 0) + rebateOf(t); });
  const best = Object.entries(byCard).sort((a, b) => b[1] - a[1])[0];
  const bestCard = best && cards.find((c) => c.id === best[0]);
  if (best && best[1] > 0 && bestCard) out.push(["good", `信用卡回饋共 <b>${money(s.rebate)}</b>，${esc(bestCard.name)} 貢獻最多（${money(best[1])}）。`]);
  return `<ul class="mr-ins">${out.map(([k, h]) => `<li class="${k}">${h}</li>`).join("")}</ul>`;
}

export function buildMonthlyReport({ transactions = [], cards = [], budgets = {}, month }) {
  const rebateOf = makeRebate(cards);
  const s = stats(transactions, month, rebateOf), p = stats(transactions, prevMonth(month), rebateOf);
  const [yy, mm] = month.split("-").map(Number), last = new Date(yy, mm, 0).getDate();
  if (s.inc.length + s.exp.length === 0) {
    return `<div class="mr-empty">${yy} 年 ${mm} 月還沒有任何收支紀錄。到「收支」新增後，這裡會自動產生月報。</div>`;
  }
  const bal = s.income - s.expense, pbal = p.income - p.expense;
  const rate = s.income ? bal / s.income * 100 : 0, prate = p.income ? pbal / p.income * 100 : null;
  const ms = [...new Set(transactions.map((t) => mk(t.date)))].filter((x) => x && x <= month).sort().slice(-6);
  const ptTxt = prate === null || !s.income ? "" : `<span class="mr-d ${rate >= prate ? "good" : "bad"}">${rate >= prate ? "▲" : "▼"} ${Math.abs(rate - prate).toFixed(1)} 個百分點</span>`;
  const incRows = Object.entries(s.byInc).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="mr-src"><span>${esc(k)}</span><div class="mr-bar"><div style="width:${(v / s.income * 100).toFixed(1)}%;background:#2C6E7F"></div></div><span class="mr-num">${money(v)} <small>${(v / s.income * 100).toFixed(0)}%</small></span></div>`).join("") || '<div class="mr-flat">本月無收入</div>';
  const top5 = [...s.exp].sort((a, b) => b.amount - a.amount).slice(0, 5).map((t) => {
    const card = cards.find((c) => c.id === t.cardId);
    const nt = esc(t.note || "") + (card ? `${t.note ? "，" : ""}${esc(card.name)}` : "");
    return `<div class="mr-top"><span class="mr-dt mr-num">${t.date.slice(5)}</span><span class="mr-chip">${esc(t.category)}</span><span class="mr-nt">${nt}</span><span class="mr-amt mr-num">${money(t.amount)}</span></div>`;
  }).join("") || '<div class="mr-flat">本月無支出</div>';
  const today = new Date(), gen = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;

  return `
  <header class="mr-head">
    <div class="mr-headtop">
      <h1>${yy} 年 <span>${mm} 月</span>收支月報</h1>
      <div class="mr-meta">統計期間 ${mm}/1 至 ${mm}/${last}，共 ${s.inc.length + s.exp.length} 筆　產出日期 ${gen}</div>
    </div>
    <div class="mr-eq">
      <div class="mr-term inc"><div class="lbl">收入</div><div class="val mr-num">${money(s.income)}</div>${delta(s.income, p.income, true)}</div>
      <div class="mr-op">−</div>
      <div class="mr-term exp"><div class="lbl">支出</div><div class="val mr-num">${money(s.expense)}</div>${delta(s.expense, p.expense, false)}</div>
      <div class="mr-op eq">=</div>
      <div class="mr-term bal"><div class="lbl">結餘</div><div class="val mr-num">${money(bal)}</div>${delta(bal, pbal, true)}</div>
    </div>
    <div class="mr-sub">
      <span>儲蓄率<b class="mr-num">${s.income ? rate.toFixed(1) + "%" : "—"}</b>${ptTxt}</span>
      <span>信用卡回饋<b class="mr-num">${money(s.rebate)}</b>${delta(s.rebate, p.rebate, true)}</span>
      <span>日均支出<b class="mr-num">${money(s.expense / last)}</b></span>
    </div>
  </header>
  <section class="mr-sec"><h2>本月重點</h2>${insights(s, p, budgets, cards, rebateOf)}</section>
  <div class="mr-cols">
    <section class="mr-sec"><h2>近 ${ms.length} 個月收支<small>長條：收入／支出　折線：結餘</small></h2>${chart6(transactions, ms, month, rebateOf)}</section>
    <section class="mr-sec"><h2>支出結構</h2>${s.expense ? donut(s) : '<div class="mr-flat">本月無支出</div>'}</section>
    <section class="mr-sec"><h2>每日支出</h2>${s.expense ? daily(s) : '<div class="mr-flat">本月無支出</div>'}</section>
    <section class="mr-sec"><h2>分類明細<small>比上月為金額增減</small></h2>${s.expense || p.expense ? catTable(s, p, budgets) : '<div class="mr-flat">本月無支出</div>'}</section>
    <section class="mr-sec"><h2>收入來源</h2>${incRows}</section>
    <section class="mr-sec"><h2>前五大支出</h2>${top5}</section>
  </div>
  <footer class="mr-foot"><span>工程財務記帳台　收支月報</span><span>金額為新台幣，回饋採單筆四捨五入</span></footer>`;
}
