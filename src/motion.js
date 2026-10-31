// 動態效果工具：依 Apple〈Designing Fluid Interfaces〉的做法
// - 彈簧用 Apple 的兩個參數：response（秒，越小越快）、damping（1 = 不回彈，0.8 = 微回彈）
// - 可中斷：隨時改目標，從「畫面上目前的值與速度」接著走，不會跳
// - 系統開了「減少動態效果」就直接到位
import React, { useEffect, useRef } from "react";

export const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// precision：離目標多近就算停（數字、比例用預設；像素位置可放寬到 0.5）
export function createSpring(initial, { response = 0.4, damping = 1, precision = 0.01 } = {}, onUpdate = () => {}) {
  let v = initial, vel = 0, target = initial, raf = 0, last = 0, onRest = null;
  const k = Math.pow((2 * Math.PI) / response, 2);
  const c = (4 * Math.PI * damping) / response;
  const settle = () => {
    raf = 0; v = target; vel = 0; onUpdate(v);
    const cb = onRest; onRest = null; if (cb) cb();
  };
  const tick = (t) => {
    const dt = Math.min(0.032, (t - last) / 1000 || 0.016); last = t;
    const steps = 4, h = dt / steps;
    for (let i = 0; i < steps; i++) { const a = -k * (v - target) - c * vel; vel += a * h; v += vel * h; }
    if (Math.abs(v - target) < precision && Math.abs(vel) < precision * 10) return settle();
    onUpdate(v); raf = requestAnimationFrame(tick);
  };
  return {
    // velocity：放開手指時的速度（每秒），讓動畫接住手勢，不會有斷點
    to(t, velocity, rest) {
      target = t; if (velocity !== undefined && velocity !== null) vel = velocity; onRest = rest || null;
      if (reducedMotion()) { if (raf) cancelAnimationFrame(raf); return settle(); }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    },
    set(x) { if (raf) { cancelAnimationFrame(raf); raf = 0; } v = x; target = x; vel = 0; onRest = null; onUpdate(v); },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; onRest = null; },
    get value() { return v; },
  };
}

// 邊界外越拉越緊（橡皮筋），不硬停
export const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
// 依放手速度推算「會停在哪」，再決定要彈回還是關掉（Apple 範例的公式）
export const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);
// 最近幾個點算放手速度（px/s）
// releaseT：放手的時間；手指停住超過 60ms 才放開，就當作沒有速度（不會誤判成甩動）
export function velocityOf(hist, key, releaseT) {
  if (hist.length < 2) return 0;
  const a = hist[0], b = hist[hist.length - 1];
  if (releaseT !== undefined && releaseT - b.t > 60) return 0;
  return b.t > a.t ? (b[key] - a[key]) / ((b.t - a.t) / 1000) : 0;
}

// 數字一路滾：值改變時從目前畫面上的數字滾到新數字（直接寫 DOM，不讓整頁重繪）
export function AnimNum({ value, format, className }) {
  const ref = useRef(null);
  const sp = useRef(null);
  const fmtRef = useRef(format); fmtRef.current = format;
  if (!sp.current) sp.current = createSpring(value, { response: 0.45, damping: 1, precision: 0.4 }, (x) => { if (ref.current) ref.current.textContent = fmtRef.current(x); });
  useEffect(() => { sp.current.to(value); }, [value]);
  useEffect(() => () => sp.current.stop(), []);
  return React.createElement("span", { ref, className }, format(sp.current.value));
}

// 圓環跟著動：ratio 0~1
export function AnimRing({ ratio, size = 64, stroke = 7, color = "#E0A458", overColor = "#F2A48E", over = false, children }) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r;
  const arc = useRef(null);
  const sp = useRef(null);
  if (!sp.current) sp.current = createSpring(ratio, { response: 0.45, damping: 1, precision: 0.001 }, (x) => {
    if (arc.current) arc.current.setAttribute("stroke-dashoffset", String(C * (1 - Math.max(0, Math.min(1, x)))));
  });
  useEffect(() => { sp.current.to(ratio); }, [ratio]);
  useEffect(() => () => sp.current.stop(), []);
  const h = React.createElement;
  return h("div", { className: "ring", style: { width: size, height: size } },
    h("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true" },
      h("circle", { cx: size / 2, cy: size / 2, r, fill: "none", stroke: "rgba(255,255,255,0.08)", strokeWidth: stroke }),
      h("circle", { ref: arc, cx: size / 2, cy: size / 2, r, fill: "none", stroke: over ? overColor : color, strokeWidth: stroke, strokeLinecap: "round",
        strokeDasharray: C, strokeDashoffset: C * (1 - Math.max(0, Math.min(1, sp.current.value))), transform: `rotate(-90 ${size / 2} ${size / 2})`,
        style: { transition: "stroke .3s" } })),
    children ? h("div", { className: "ring-c" }, children) : null);
}
