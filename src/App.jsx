import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchCryptoPrices, fetchHyperliquidPrices, fetchAllMFNavs, fetchEquityPricesFromSheet, generateSheetTemplate, fetchExchangeRates } from "./priceService.js";
import PortfolioChart, { MultiLineChart } from "./PortfolioChart.jsx";
import DonutChart from "./DonutChart.jsx";

const uid = () => Math.random().toString(36).slice(2, 9);
const STORE_KEY = "fin-dashboard-v3";

const defaultData = {
  settings: { eurToInr: 91.5, eurToUsd: 1.08, currentPhase: 2, lastUpdated: null, googleSheetUrl: "" },
  income: [
    { id: uid(), name: "Net Salary", amount: 4200, currency: "EUR", frequency: "monthly" },
  ],
  fixedExpenses: [
    { id: uid(), name: "Rent", amount: 750, currency: "EUR", frequency: "monthly" },
    { id: uid(), name: "Insurance", amount: 215, currency: "EUR", frequency: "monthly" },
    { id: uid(), name: "Groceries & Living", amount: 400, currency: "EUR", frequency: "monthly" },
    { id: uid(), name: "Subscriptions", amount: 50, currency: "EUR", frequency: "monthly" },
  ],
  oneOffExpenses: [],
  phases: [
    { id: 1, name: "Clear Credit Card", target: 2400, current: 2400, status: "complete", currency: "EUR", milestones: [] },
    { id: 2, name: "Build €10k Buffer", target: 10000, current: 1200, status: "active", currency: "EUR",
      milestones: [
        { name: "Book India Tickets", amount: 3000 },
        { name: "Breathing Room", amount: 5000 },
        { name: "Buffer Complete", amount: 10000 },
      ]
    },
    { id: 3, name: "Grow & Pay Down", target: 0, current: 0, status: "locked", currency: "EUR", milestones: [] },
  ],
  mutualFunds: [
    { id: uid(), name: "PPFAS Flexi Cap", units: 0, totalInvested: 0, currentPrice: 0, currency: "INR", liquid: true, schemeCode: "122639" },
    { id: uid(), name: "PPFAS Niece", units: 0, totalInvested: 0, currentPrice: 0, currency: "INR", liquid: false, schemeCode: "122639" },
  ],
  equityAccounts: [
    { id: uid(), name: "Zerodha", currency: "INR", stocks: [] },
    { id: uid(), name: "HDFC Sourabh", currency: "INR", stocks: [] },
    { id: uid(), name: "HDFC Upasana", currency: "INR", stocks: [] },
  ],
  cashSavings: [
    { id: uid(), name: "ING Sparren", type: "Bank", amount: 1000, currency: "EUR", liquid: true },
    { id: uid(), name: "Upasana Account (Buffer)", type: "Bank", amount: 200, currency: "EUR", liquid: true },
    { id: uid(), name: "Recurring Deposit", type: "RD", amount: 0, currency: "INR", liquid: false },
  ],
  crypto: [
    { id: uid(), name: "BTC", quantity: 0, costPrice: 0, currentPrice: 0, currency: "USD", liquid: true, coingeckoId: "bitcoin" },
    { id: uid(), name: "ETH", quantity: 0, costPrice: 0, currentPrice: 0, currency: "USD", liquid: true, coingeckoId: "ethereum" },
    { id: uid(), name: "MegaETH", quantity: 0, costPrice: 0, currentPrice: 0, currency: "USD", liquid: false, coingeckoId: "" },
  ],
  realEstate: [],
  esops: [
    { id: uid(), company: "Vay", strikePrice: 0, quantity: 0, currentPrice: 0, vestedQty: 0, unvestedQty: 0, currency: "EUR", liquid: false },
  ],
  sips: [
    { id: uid(), name: "PPFAS", amount: 11000, currency: "INR" },
    { id: uid(), name: "PPFAS Niece", amount: 1500, currency: "INR" },
    { id: uid(), name: "Recurring Deposit", amount: 15000, currency: "INR" },
    { id: uid(), name: "COPX", amount: 150, currency: "EUR" },
  ],
  surplusAllocation: [
    { id: uid(), name: "EUR Buffer (Bank)", amount: 1650, currency: "EUR", phase: 2 },
    { id: uid(), name: "COPX", amount: 400, currency: "EUR", phase: 3 },
    { id: uid(), name: "Vacation", amount: 300, currency: "EUR", phase: 3 },
    { id: uid(), name: "Kid/Life Fund", amount: 300, currency: "EUR", phase: 3 },
    { id: uid(), name: "Correction Fund", amount: 371, currency: "EUR", phase: 3 },
  ],
  liabilities: [
    { id: uid(), name: "Personal Loan", totalAmount: 0, interestRate: 4.7, monthlyEMI: 0, startDate: "", tenureMonths: 0, currency: "EUR", specialPayments: [] },
  ],
  snapshots: [],
  priceHistory: [],
  goals: [],
};

// ── Storage helpers (localStorage) ──
const storage = {
  get: (key) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    catch { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
};

const toEur = (amount, currency, rate, usdRate = 1.08) => {
  if (currency === "EUR") return amount;
  if (currency === "INR") return amount / rate;
  if (currency === "USD") return amount / usdRate;
  return amount;
};
const fmt = (n, c = "EUR") => {
  if (c === "INR") return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  if (c === "USD") return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return "€" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
};
const fmtBoth = (eurVal, rate) => `${fmt(eurVal, "EUR")} / ${fmt(eurVal * rate, "INR")}`;
const pct = (current, target) => target > 0 ? Math.min(100, (current / target) * 100) : 0;

const calcAmortization = (principal, annualRate, tenureMonths, monthsElapsed, specialPaymentsTotal = 0, manualEMI = 0, balloonAmount = 0) => {
  if (!principal || !tenureMonths || tenureMonths <= 0) return { remainingPrincipal: Math.max(0, (principal || 0) - specialPaymentsTotal), remainingInterest: 0, totalInterest: 0 };
  const r = annualRate / 100 / 12;
  const n = tenureMonths;
  const k = Math.min(Math.max(0, monthsElapsed), n);

  // Use manual EMI if provided (for balloon loans etc)
  if (manualEMI > 0) {
    const principalPaidByEMI = manualEMI * k;
    const rp = Math.max(0, principal - principalPaidByEMI - specialPaymentsTotal);
    const totalPaidAtEnd = (manualEMI * n) + balloonAmount + specialPaymentsTotal;
    const totalInterest = Math.max(0, totalPaidAtEnd - principal);
    const remainingPayments = rp > balloonAmount ? Math.ceil((rp - balloonAmount) / manualEMI) : 0;
    return { remainingPrincipal: rp, remainingInterest: Math.max(0, totalInterest * (rp / principal)), totalInterest, emi: manualEMI, monthsLeft: remainingPayments, balloonAmount };
  }

  if (r === 0) {
    const rp = Math.max(0, principal - (principal / n) * k - specialPaymentsTotal);
    return { remainingPrincipal: rp, remainingInterest: 0, totalInterest: 0 };
  }
  const emi = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  const rpBeforeSpecial = principal * (Math.pow(1 + r, n) - Math.pow(1 + r, k)) / (Math.pow(1 + r, n) - 1);
  const rp = Math.max(0, rpBeforeSpecial - specialPaymentsTotal);
  const totalInterest = Math.max(0, (emi * n) - principal);
  const interestPaid = (emi * k) - (principal - rpBeforeSpecial);
  const ri = Math.max(0, totalInterest - interestPaid);
  const monthsLeft = rp > 0 ? Math.ceil(Math.log(emi / (emi - rp * r)) / Math.log(1 + r)) : 0;
  return { remainingPrincipal: rp, remainingInterest: ri, totalInterest, emi, monthsLeft };
};

const getMonthsElapsed = (startDate) => {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  return now.getDate() >= start.getDate() ? Math.max(0, months) : Math.max(0, months - 1);
};

const colors = {
  bg: "#0a0a0a", card: "#0f0f0f", cardAlt: "#161616", border: "#1f1f1f", borderBright: "#2a2a2a",
  gridLine: "#141414",
  accent: "#f5a623", accentDim: "#c4841c", red: "#e25555", yellow: "#f5a623",
  text: "#e8e8e3", textDim: "#8a8a82", textMuted: "#4a4a44",
  green: "#4ea96a", greenBg: "rgba(78,169,106,0.08)", redBg: "rgba(226,85,85,0.08)",
  cyan: "#4ec9e6", magenta: "#d67ab5", violet: "#9b7ed6",
};

const s = {
  page: { fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', monospace", background: colors.bg, color: colors.text, minHeight: "100vh", padding: "20px 24px 60px", fontFeatureSettings: '"tnum" on, "zero" on' },
  h1: { fontSize: "20px", fontWeight: 700, letterSpacing: "-0.01em", margin: 0, color: colors.text, fontFamily: "'IBM Plex Mono', monospace" },
  h2: { fontSize: "10px", fontWeight: 400, margin: 0, color: colors.text, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace" },
  h3: { fontSize: "10px", fontWeight: 400, color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.14em", margin: "0 0 8px 0", fontFamily: "'IBM Plex Mono', monospace" },
  card: { background: colors.card, borderRadius: "0", padding: "16px", border: `1px solid ${colors.border}` },
  tab: (a) => ({ padding: "10px 16px", borderRadius: "0", border: "none", borderBottom: a ? `2px solid ${colors.accent}` : "2px solid transparent", cursor: "pointer", fontSize: "11px", fontWeight: 500, fontFamily: "'IBM Plex Mono', monospace", background: "transparent", color: a ? colors.accent : colors.textDim, letterSpacing: "0.1em", textTransform: "uppercase", transition: "none" }),
  btn: { padding: "6px 12px", borderRadius: "0", border: `1px solid ${colors.accent}`, cursor: "pointer", fontSize: "10px", fontWeight: 500, fontFamily: "'IBM Plex Mono', monospace", background: colors.accent, color: colors.bg, letterSpacing: "0.1em", textTransform: "uppercase" },
  btnOutline: { padding: "6px 12px", borderRadius: "0", border: `1px solid ${colors.border}`, cursor: "pointer", fontSize: "10px", fontWeight: 500, fontFamily: "'IBM Plex Mono', monospace", background: "transparent", color: colors.textDim, letterSpacing: "0.1em", textTransform: "uppercase" },
  btnDanger: { padding: "3px 8px", borderRadius: "0", border: `1px solid ${colors.red}40`, cursor: "pointer", fontSize: "10px", fontWeight: 500, fontFamily: "'IBM Plex Mono', monospace", background: "transparent", color: colors.red, letterSpacing: "0.1em" },
  input: { padding: "6px 10px", borderRadius: "0", border: `1px solid ${colors.border}`, background: colors.cardAlt, color: colors.text, fontSize: "12px", fontFamily: "'IBM Plex Mono', monospace", outline: "none", width: "100%" },
  select: { padding: "6px 10px", borderRadius: "0", border: `1px solid ${colors.border}`, background: colors.cardAlt, color: colors.text, fontSize: "11px", fontFamily: "'IBM Plex Mono', monospace", outline: "none" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "12px", fontFamily: "'IBM Plex Mono', monospace" },
  th: { textAlign: "left", padding: "8px 10px", color: colors.textDim, fontWeight: 400, fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.14em", borderBottom: `1px solid ${colors.border}`, fontFamily: "'IBM Plex Mono', monospace" },
  td: { padding: "8px 10px", borderBottom: `1px solid ${colors.gridLine}`, verticalAlign: "middle", fontSize: "12px" },
  badge: (c) => ({ display: "inline-block", padding: "2px 6px", borderRadius: "0", fontSize: "9px", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", border: `1px solid`, background: "transparent", borderColor: c === "green" ? colors.green : c === "red" ? colors.red : colors.accent, color: c === "green" ? colors.green : c === "red" ? colors.red : colors.accent, fontFamily: "'IBM Plex Mono', monospace" }),
  liqBadge: (l) => ({ display: "inline-block", padding: "2px 6px", borderRadius: "0", fontSize: "9px", fontWeight: 500, cursor: "pointer", background: "transparent", color: l ? colors.green : colors.violet, border: `1px solid ${l ? colors.green : colors.violet}`, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em" }),
  bigNum: { fontSize: "24px", fontWeight: 500, letterSpacing: "-0.01em", color: colors.text, fontFamily: "'IBM Plex Mono', monospace" },
  progressBar: { height: "6px", borderRadius: "0", background: colors.cardAlt, overflow: "hidden", width: "100%" },
  progressFill: (p, c = colors.accent) => ({ height: "100%", borderRadius: "0", background: c, width: `${Math.min(100, p)}%`, transition: "width 0.5s ease" }),
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" },
  flex: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  flexG: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  panelHead: { padding: "10px 16px", borderBottom: `1px solid ${colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", margin: "-16px -16px 12px -16px", background: colors.card },
  panelTitle: { fontSize: "10px", fontWeight: 400, color: colors.text, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace" },
  panelMeta: { fontSize: "10px", fontWeight: 400, color: colors.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace" },
};

const ECell = ({ value, onChange, type = "text", style = {}, multiline = false }) => {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!editing) return (
    <span style={{ cursor: "pointer", borderBottom: `1px dashed ${colors.border}`, whiteSpace: multiline ? "pre-wrap" : "nowrap", ...style }}
      onClick={() => setEditing(true)}>
      {type === "number" ? Number(v).toLocaleString() : v || "—"}
    </span>
  );
  if (multiline) return (
    <textarea style={{ ...s.input, width: "100%", minWidth: "200px", minHeight: "60px", resize: "vertical", fontFamily: "inherit" }}
      value={v} autoFocus
      onChange={e => setV(e.target.value)}
      onBlur={() => { setEditing(false); onChange(v); }} />
  );
  return (
    <input style={{ ...s.input, width: type === "number" ? "90px" : "120px" }} type={type}
      value={v} autoFocus
      onChange={e => setV(e.target.value)}
      onBlur={() => { setEditing(false); onChange(type === "number" ? parseFloat(v) || 0 : v); }}
      onKeyDown={e => { if (e.key === "Enter") { setEditing(false); onChange(type === "number" ? parseFloat(v) || 0 : v); }}} />
  );
};

const CurrSelect = ({ value, onChange }) => (
  <select style={s.select} value={value} onChange={e => onChange(e.target.value)}>
    <option value="EUR">EUR</option><option value="INR">INR</option><option value="USD">USD</option>
  </select>
);

const PanelHead = ({ title, meta, children }) => (
  <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", margin: "-16px -16px 12px -16px" }}>
    <span style={{ fontSize: "10px", fontWeight: 400, color: colors.text, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace" }}>
      <span style={{ color: colors.accent, marginRight: "6px" }}>&gt;</span>{title}
    </span>
    {(meta || children) && <span style={{ fontSize: "10px", fontWeight: 400, color: colors.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace", display: "flex", gap: "8px", alignItems: "center" }}>{meta}{children}</span>}
  </div>
);

const H2 = ({ children }) => (
  <div style={s.h2}><span style={{ color: colors.accent, marginRight: "6px" }}>&gt;</span>{children}</div>
);

const EXPENSE_CATEGORIES = ["Housing", "Transportation", "Utilities", "Living", "Subscriptions", "Insurance", "Loans", "Other"];
const CATEGORY_COLORS = {
  Housing: "#4ec9e6", Transportation: "#f5a623", Utilities: "#4ea96a",
  Living: "#9b7ed6", Subscriptions: "#d67ab5", Insurance: "#e25555",
  Loans: "#8a9a5b", Other: "#8a8a82"
};

const autoCategorize = (name) => {
  const n = name.toLowerCase();
  if (/parking|car.*loan|car.*emi|car charging|car insur|charging|tesla premium/.test(n)) return "Transportation";
  if (/rent(?!.*parking)/.test(n)) return "Housing";
  if (/loan|emi/.test(n)) return "Loans";
  if (/electric|internet|mobile/.test(n)) return "Utilities";
  if (/groc|eating|entertain|upasana/.test(n)) return "Living";
  if (/sub|apple|netflix|discord|viki|iqiyi|nitish|ard|claude/.test(n)) return "Subscriptions";
  if (/insur/.test(n)) return "Insurance";
  return "Other";
};

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [subTab, setSubTab] = useState("mf");
  const [expandedAccts, setExpandedAccts] = useState({});
  const [stockSort, setStockSort] = useState({ field: null, dir: "desc" });
  const [stockSearch, setStockSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = storage.get(STORE_KEY);
    if (saved) {
      const merged = { ...defaultData, ...saved };
      // Migrate: fix old snapshots where liquidNW was incorrectly negative (old formula subtracted liabilities)
      if (merged.snapshots) {
        let migrated = false;
        merged.snapshots = merged.snapshots.map(snap => {
          if (snap.liquidNW < 0 && snap.grossAssets && snap.illiquidNW >= 0) {
            migrated = true;
            return { ...snap, liquidNW: snap.grossAssets - snap.illiquidNW };
          }
          return snap;
        });
        if (migrated) storage.set(STORE_KEY, merged);
      }
      // Migrate: convert MF costPrice to totalInvested
      if (merged.mutualFunds) {
        let mfMigrated = false;
        merged.mutualFunds = merged.mutualFunds.map(f => {
          if (f.costPrice && f.totalInvested == null) {
            mfMigrated = true;
            return { ...f, totalInvested: f.units * f.costPrice };
          }
          return f;
        });
        if (mfMigrated) storage.set(STORE_KEY, merged);
      }
      // Migrate: auto-categorize expenses
      if (merged.fixedExpenses) {
        let expMigrated = false;
        merged.fixedExpenses = merged.fixedExpenses.map(e => {
          if (!e.category) {
            expMigrated = true;
            return { ...e, category: autoCategorize(e.name) };
          }
          return e;
        });
        if (expMigrated) storage.set(STORE_KEY, merged);
      }
      setData(merged);
    } else {
      setData(defaultData);
    }
    setLoading(false);
  }, []);

  const save = useCallback((d) => {
    const updated = { ...d, settings: { ...d.settings, lastUpdated: new Date().toISOString() } };
    setData(updated);
    storage.set(STORE_KEY, updated);
  }, []);

  const update = useCallback((key, value) => save({ ...data, [key]: value }), [data, save]);
  const updateItem = useCallback((key, id, field, value) => {
    update(key, data[key].map(i => i.id === id ? { ...i, [field]: value } : i));
  }, [data, update]);
  const addItem = useCallback((key, tmpl) => update(key, [...data[key], { ...tmpl, id: uid() }]), [data, update]);
  const removeItem = useCallback((key, id) => update(key, data[key].filter(i => i.id !== id)), [data, update]);

  // Phase helpers
  const updatePhase = useCallback((phaseId, field, value) => {
    const phases = data.phases.map(p => p.id === phaseId ? { ...p, [field]: value } : p);
    update("phases", phases);
  }, [data, update]);

  const moveToNextPhase = useCallback(() => {
    const currentIdx = data.phases.findIndex(p => p.status === "active");
    if (currentIdx === -1) return;
    const phases = data.phases.map((p, i) => {
      if (i === currentIdx) return { ...p, status: "complete", current: p.target };
      if (i === currentIdx + 1) return { ...p, status: "active" };
      return p;
    });
    const nextPhase = phases[currentIdx + 1];
    save({ ...data, phases, settings: { ...data.settings, currentPhase: nextPhase ? nextPhase.id : data.settings.currentPhase } });
  }, [data, save]);

  const addPhase = useCallback(() => {
    const maxId = Math.max(...data.phases.map(p => p.id), 0);
    const newPhase = { id: maxId + 1, name: "New Phase", target: 0, current: 0, status: "locked", currency: "EUR", milestones: [] };
    update("phases", [...data.phases, newPhase]);
  }, [data, update]);

  const removePhase = useCallback((phaseId) => {
    if (data.phases.length <= 1) return;
    const phase = data.phases.find(p => p.id === phaseId);
    if (phase.status === "active") return; // can't delete active phase
    update("phases", data.phases.filter(p => p.id !== phaseId));
  }, [data, update]);

  const addMilestone = useCallback((phaseId) => {
    const phases = data.phases.map(p => p.id === phaseId ? { ...p, milestones: [...(p.milestones || []), { name: "New Milestone", amount: 0 }] } : p);
    update("phases", phases);
  }, [data, update]);

  const updateMilestone = useCallback((phaseId, idx, field, value) => {
    const phases = data.phases.map(p => {
      if (p.id !== phaseId) return p;
      const ms = [...(p.milestones || [])];
      ms[idx] = { ...ms[idx], [field]: value };
      return { ...p, milestones: ms };
    });
    update("phases", phases);
  }, [data, update]);

  const removeMilestone = useCallback((phaseId, idx) => {
    const phases = data.phases.map(p => {
      if (p.id !== phaseId) return p;
      const ms = [...(p.milestones || [])];
      ms.splice(idx, 1);
      return { ...p, milestones: ms };
    });
    update("phases", phases);
  }, [data, update]);

  // Equity account helpers
  const addStockToAccount = useCallback((accountId) => {
    const accts = data.equityAccounts.map(a => a.id === accountId ? { ...a, stocks: [...a.stocks, { id: uid(), name: "New Stock", quantity: 0, costPrice: 0, currentPrice: 0, currency: a.currency || "INR", liquid: true, nseTicker: "" }] } : a);
    update("equityAccounts", accts);
  }, [data, update]);

  const updateStock = useCallback((accountId, stockId, field, value) => {
    const accts = data.equityAccounts.map(a => a.id === accountId ? { ...a, stocks: a.stocks.map(st => st.id === stockId ? { ...st, [field]: value } : st) } : a);
    update("equityAccounts", accts);
  }, [data, update]);

  const removeStock = useCallback((accountId, stockId) => {
    const accts = data.equityAccounts.map(a => a.id === accountId ? { ...a, stocks: a.stocks.filter(st => st.id !== stockId) } : a);
    update("equityAccounts", accts);
  }, [data, update]);

  const calc = useMemo(() => {
    if (!data) return {};
    const rate = data.settings.eurToInr;
    const usdRate = data.settings.eurToUsd || 1.08;
    const eur = (amount, currency) => toEur(amount, currency, rate, usdRate);
    const totalIncomeEur = data.income.reduce((s, i) => s + eur(i.frequency === "annual" ? i.amount / 12 : i.amount, i.currency), 0);
    const totalFixedEur = data.fixedExpenses.reduce((s, e) => s + eur(e.frequency === "annual" ? e.amount / 12 : e.amount, e.currency), 0);
    const totalSipsEur = data.sips.reduce((s, i) => s + eur(i.amount, i.currency), 0);
    const surplus = totalIncomeEur - totalFixedEur - totalSipsEur;
    const totalAllocEur = data.surplusAllocation.filter(a => a.phase === data.settings.currentPhase).reduce((s, a) => s + eur(a.amount, a.currency), 0);
    const unallocated = surplus - totalAllocEur;

    const mfValue = data.mutualFunds.reduce((s, f) => {
      const val = f.units * f.currentPrice;
      return { total: s.total + eur(val, f.currency), liquid: s.liquid + (f.liquid ? eur(val, f.currency) : 0) };
    }, { total: 0, liquid: 0 });

    const allStocks = (data.equityAccounts || []).flatMap(a => a.stocks || []);
    const eqValue = allStocks.reduce((s, e) => {
      const val = e.quantity * e.currentPrice;
      return { total: s.total + eur(val, e.currency), liquid: s.liquid + (e.liquid ? eur(val, e.currency) : 0) };
    }, { total: 0, liquid: 0 });

    const cashValue = data.cashSavings.reduce((s, c) => ({ total: s.total + eur(c.amount, c.currency), liquid: s.liquid + (c.liquid ? eur(c.amount, c.currency) : 0) }), { total: 0, liquid: 0 });
    const cryptoValue = data.crypto.reduce((s, c) => {
      const val = c.quantity * c.currentPrice;
      return { total: s.total + eur(val, c.currency), liquid: s.liquid + (c.liquid ? eur(val, c.currency) : 0) };
    }, { total: 0, liquid: 0 });
    const propValue = (data.realEstate || []).reduce((s, p) => ({ total: s.total + eur(p.value, p.currency), liquid: s.liquid + (p.liquid ? eur(p.value, p.currency) : 0) }), { total: 0, liquid: 0 });
    const esopValue = data.esops.reduce((s, e) => {
      const vv = Math.max(0, e.vestedQty * (e.currentPrice - e.strikePrice));
      const uv = Math.max(0, e.unvestedQty * (e.currentPrice - e.strikePrice));
      return { total: s.total + eur(vv + uv, e.currency), liquid: s.liquid + (e.liquid ? eur(vv, e.currency) : 0) };
    }, { total: 0, liquid: 0 });

    const totalLiabEur = data.liabilities.reduce((s, l) => {
      const spTotal = (l.specialPayments || []).reduce((s, p) => s + (p.amount || 0), 0);
      const amort = calcAmortization(l.totalAmount, l.interestRate, l.tenureMonths, getMonthsElapsed(l.startDate), spTotal, l.manualEMI || 0, l.balloonAmount || 0);
      return s + eur(amort.remainingPrincipal, l.currency);
    }, 0);

    const grossAssets = mfValue.total + eqValue.total + cashValue.total + cryptoValue.total + propValue.total + esopValue.total;
    const liquidAssets = mfValue.liquid + eqValue.liquid + cashValue.liquid + cryptoValue.liquid + propValue.liquid + esopValue.liquid;
    const illiquidAssets = grossAssets - liquidAssets;
    const netWorth = grossAssets - totalLiabEur;
    const liquidNW = liquidAssets;
    const illiquidNW = illiquidAssets;

    return { rate, totalIncomeEur, totalFixedEur, totalSipsEur, surplus, totalAllocEur, unallocated, mfValue, eqValue, cashValue, cryptoValue, propValue, esopValue, grossAssets, liquidAssets, illiquidAssets, totalLiabEur, netWorth, liquidNW, illiquidNW };
  }, [data]);

  const takeSnapshot = useCallback(() => {
    if (!data || !calc) return;
    update("snapshots", [...data.snapshots, {
      date: new Date().toISOString().slice(0, 10), netWorth: calc.netWorth, liquidNW: calc.liquidNW,
      illiquidNW: calc.illiquidNW, grossAssets: calc.grossAssets, liabilities: calc.totalLiabEur, phase: data.settings.currentPhase,
    }]);
  }, [data, calc, update]);

  const exportData = useCallback(() => {
    if (!data) return;
    const updated = { ...data, settings: { ...data.settings, lastExported: new Date().toISOString() } };
    const blob = new Blob([JSON.stringify(updated, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    save(updated);
  }, [data, save]);

  const importData = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (imported && imported.settings) {
            if (confirm("This will replace all current data. Continue?")) {
              save({ ...defaultData, ...imported });
            }
          } else {
            alert("Invalid file format.");
          }
        } catch { alert("Failed to parse file."); }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [save]);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");
  const [showPriceSetup, setShowPriceSetup] = useState(false);
  const [showDailyMovers, setShowDailyMovers] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [allocFilter, setAllocFilter] = useState({ liquid: true, illiquid: true });

  const refreshPrices = useCallback(async () => {
    if (!data || refreshing) return;
    setRefreshing(true);
    setRefreshMsg("Fetching exchange rates...");
    let updated = { ...data };
    let results = [];

    // 0. Exchange rates
    try {
      const rates = await fetchExchangeRates();
      if (rates.eurToInr) {
        updated.settings = { ...updated.settings, eurToInr: rates.eurToInr, eurToUsd: rates.eurToUsd || updated.settings.eurToUsd };
        results.push(`EUR/INR: ${rates.eurToInr.toFixed(2)}`);
      }
    } catch (e) { results.push("FX: failed"); }

    // 1. Crypto (CoinGecko + Hyperliquid)
    try {
      setRefreshMsg("Fetching crypto prices...");

      // CoinGecko (returns { id: { price, change24h } })
      const cryptoPrices = await fetchCryptoPrices(data.crypto);

      // Hyperliquid (for pre-market tokens)
      const hlTickers = data.crypto.filter(c => c.hyperliquidTicker).map(c => c.hyperliquidTicker);
      const hlPrices = await fetchHyperliquidPrices(hlTickers);

      let cryptoCount = 0;
      updated.crypto = updated.crypto.map(c => {
        // Hyperliquid takes priority if set
        if (c.hyperliquidTicker && hlPrices[c.hyperliquidTicker.toUpperCase()]) {
          const newPrice = hlPrices[c.hyperliquidTicker.toUpperCase()];
          const oldPrice = c.currentPrice || newPrice;
          cryptoCount++;
          return { ...c, currentPrice: newPrice, dailyChangePct: oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : 0 };
        }
        if (c.coingeckoId && cryptoPrices[c.coingeckoId]) {
          cryptoCount++;
          return { ...c, currentPrice: cryptoPrices[c.coingeckoId].price, dailyChangePct: cryptoPrices[c.coingeckoId].change24h };
        }
        return c;
      });
      results.push(`Crypto: ${cryptoCount} updated`);
    } catch (e) { results.push("Crypto: failed"); }

    // 2. Mutual Funds (mfapi.in)
    try {
      setRefreshMsg("Fetching MF NAVs...");
      const mfNavs = await fetchAllMFNavs(data.mutualFunds);
      if (Object.keys(mfNavs).length > 0) {
        updated.mutualFunds = updated.mutualFunds.map(f => {
          if (f.schemeCode && mfNavs[f.schemeCode]) {
            return { ...f, currentPrice: mfNavs[f.schemeCode] };
          }
          return f;
        });
        results.push(`MFs: ${Object.keys(mfNavs).length} updated`);
      }
    } catch (e) { results.push("MFs: failed"); }

    // 3. Indian Equities (Google Sheets)
    try {
      const sheetUrl = data.settings.googleSheetUrl;
      if (sheetUrl) {
        setRefreshMsg("Fetching equity prices...");
        const eqPrices = await fetchEquityPricesFromSheet(sheetUrl);
        if (Object.keys(eqPrices).length > 0) {
          updated.equityAccounts = updated.equityAccounts.map(acct => ({
            ...acct,
            stocks: acct.stocks.map(st => {
              const ticker = (st.nseTicker || st.name || "").toUpperCase().trim();
              if (ticker && eqPrices[ticker]) {
                return { ...st, currentPrice: eqPrices[ticker].price, dailyChangePct: eqPrices[ticker].changePct };
              }
              return st;
            })
          }));
          results.push(`Equities: ${Object.keys(eqPrices).length} prices found`);
        }
      } else {
        results.push("Equities: no sheet URL set");
      }
    } catch (e) { results.push("Equities: failed"); }

    // Save price history point
    const histRate = updated.settings.eurToInr;
    const histUsdRate = updated.settings.eurToUsd || 1.08;
    const histEntry = { date: new Date().toISOString(), items: {} };

    // Category totals
    let mfTotal = 0, eqTotal = 0, cashTotal = 0, cryptoTotal = 0, reTotal = 0, esopTotal = 0;

    updated.mutualFunds.forEach(f => {
      const val = toEur(f.units * f.currentPrice, f.currency, histRate, histUsdRate);
      mfTotal += val;
      if (f.units > 0) histEntry.items[`mf_${f.id}`] = val;
    });
    (updated.equityAccounts || []).forEach(acct => {
      let acctTotal = 0;
      (acct.stocks || []).forEach(st => {
        const val = toEur(st.quantity * st.currentPrice, st.currency, histRate, histUsdRate);
        eqTotal += val;
        acctTotal += val;
        if (st.quantity > 0) histEntry.items[`eq_${st.id}`] = val;
      });
      histEntry.items[`eqAcct_${acct.id}`] = acctTotal;
    });
    updated.cashSavings.forEach(c => {
      const val = toEur(c.amount, c.currency, histRate, histUsdRate);
      cashTotal += val;
      histEntry.items[`cash_${c.id}`] = val;
    });
    updated.crypto.forEach(c => {
      const val = toEur(c.quantity * c.currentPrice, "USD", histRate, histUsdRate);
      cryptoTotal += val;
      if (c.quantity > 0) histEntry.items[`crypto_${c.id}`] = val;
    });
    (updated.realEstate || []).forEach(p => {
      const val = toEur(p.value, p.currency, histRate, histUsdRate);
      reTotal += val;
      histEntry.items[`re_${p.id}`] = val;
    });
    updated.esops.forEach(e => {
      const vv = Math.max(0, e.vestedQty * (e.currentPrice - e.strikePrice));
      const uv = Math.max(0, e.unvestedQty * (e.currentPrice - e.strikePrice));
      const val = toEur(vv + uv, e.currency, histRate, histUsdRate);
      esopTotal += val;
      histEntry.items[`esop_${e.id}`] = val;
    });

    histEntry.mfTotal = mfTotal;
    histEntry.eqTotal = eqTotal;
    histEntry.cashTotal = cashTotal;
    histEntry.cryptoTotal = cryptoTotal;
    histEntry.reTotal = reTotal;
    histEntry.esopTotal = esopTotal;

    let histLiab = 0;
    updated.liabilities.forEach(l => {
      const spTotal = (l.specialPayments || []).reduce((s, p) => s + (p.amount || 0), 0);
      const amort = calcAmortization(l.totalAmount, l.interestRate, l.tenureMonths, getMonthsElapsed(l.startDate), spTotal, l.manualEMI || 0, l.balloonAmount || 0);
      histLiab += toEur(amort.remainingPrincipal, l.currency, histRate, histUsdRate);
    });
    histEntry.liabilities = histLiab;
    histEntry.grossAssets = mfTotal + eqTotal + cashTotal + cryptoTotal + reTotal + esopTotal;
    histEntry.netWorth = histEntry.grossAssets - histLiab;

    // Deduplicate: replace last entry if same day, otherwise append. Cap at 365.
    const today = histEntry.date.slice(0, 10);
    const existing = [...(updated.priceHistory || [])];
    const lastIdx = existing.length - 1;
    if (lastIdx >= 0 && existing[lastIdx].date.slice(0, 10) === today) {
      existing[lastIdx] = histEntry; // replace today's earlier entry
    } else {
      existing.push(histEntry);
    }
    updated.priceHistory = existing.slice(-365);

    save(updated);
    setRefreshMsg(results.join(" · "));
    setRefreshing(false);
    setTimeout(() => setRefreshMsg(""), 8000);
  }, [data, refreshing, save]);

  if (loading || !data) return (
    <div style={{ ...s.page, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div style={{ color: colors.accent, fontSize: "14px" }}>Loading dashboard...</div>
    </div>
  );

  const rate = data.settings.eurToInr;
  const tabs = [
    { key: "overview", label: "Overview" }, { key: "income", label: "Income & Expenses" },
    { key: "portfolio", label: "Portfolio" }, { key: "invest", label: "SIPs & Allocation" },
    { key: "liabilities", label: "Liabilities" }, { key: "history", label: "History" },
  ];

  const activePhase = data.phases.find(p => p.status === "active");
  const activePhaseIdx = data.phases.findIndex(p => p.status === "active");
  const hasNextPhase = activePhaseIdx >= 0 && activePhaseIdx < data.phases.length - 1;

  // ─── OVERVIEW ───
  const renderOverview = () => {
    // Calculate days since last export
    const lastExported = data.settings.lastExported;
    const daysSinceExport = lastExported ? Math.floor((Date.now() - new Date(lastExported).getTime()) / (86400000)) : null;
    const showBackupWarning = daysSinceExport === null || daysSinceExport > 7;

    return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {showBackupWarning && <div style={{ padding: "10px 14px", background: `${colors.accent}12`, border: `1px solid ${colors.accent}40`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "10px", color: colors.accent, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace" }}>
          ⚠ {daysSinceExport === null ? "No backup yet" : `Last backup was ${daysSinceExport} days ago`} · Your data lives only in this browser
        </span>
        <button style={{ ...s.btnOutline, borderColor: colors.accent, color: colors.accent }} onClick={exportData}>💾 EXPORT NOW</button>
      </div>}

      {/* KPI STRIP */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1px", background: colors.border, border: `1px solid ${colors.border}` }}>
        <div style={{ background: colors.card, padding: "14px 16px" }}>
          <div style={s.h3}>Net Worth</div>
          <div style={s.bigNum}>{fmt(calc.netWorth)}</div>
          <div style={{ fontSize: "10px", color: colors.textMuted, marginTop: "2px" }}>{fmt(calc.netWorth * rate, "INR")}</div>
        </div>
        <div style={{ background: colors.card, padding: "14px 16px" }}>
          <div style={s.h3}>Liquid</div>
          <div style={{ ...s.bigNum, color: colors.green }}>{fmt(calc.liquidNW)}</div>
          <div style={{ fontSize: "10px", color: colors.textMuted, marginTop: "2px" }}>{fmt(calc.liquidNW * rate, "INR")}</div>
        </div>
        <div style={{ background: colors.card, padding: "14px 16px" }}>
          <div style={s.h3}>Illiquid</div>
          <div style={{ ...s.bigNum, color: colors.violet }}>{fmt(calc.illiquidNW)}</div>
          <div style={{ fontSize: "10px", color: colors.textMuted, marginTop: "2px" }}>{fmt(calc.illiquidNW * rate, "INR")}</div>
        </div>
        <div style={{ background: colors.card, padding: "14px 16px" }}>
          <div style={s.h3}>Liabilities</div>
          <div style={{ ...s.bigNum, color: colors.red }}>{fmt(calc.totalLiabEur)}</div>
          <div style={{ fontSize: "10px", color: colors.textMuted, marginTop: "2px" }}>{fmt(calc.totalLiabEur * rate, "INR")}</div>
        </div>
        <div style={{ background: colors.card, padding: "14px 16px" }}>
          <div style={s.h3}>Surplus · {calc.totalIncomeEur > 0 ? ((calc.surplus / calc.totalIncomeEur) * 100).toFixed(0) : 0}%</div>
          <div style={{ ...s.bigNum, color: colors.accent }}>{fmt(calc.surplus)}</div>
          <div style={{ fontSize: "9px", color: colors.textMuted, marginTop: "2px", fontFamily: "'IBM Plex Mono', monospace" }}>IN {fmt(calc.totalIncomeEur)} · EX {fmt(calc.totalFixedEur)} · SIP {fmt(calc.totalSipsEur)}</div>
        </div>
      </div>

      {/* TWO-COLUMN GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: "14px" }} className="overview-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
          {/* Main column */}
          {(data.priceHistory || []).length >= 2 && <div style={s.card}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.netWorth || 0 }))} title="Net Worth" height={200} />
          </div>}

      {/* Daily Movers */}
      {(() => {
        const cryptoMovers = [];
        const equityMovers = [];
        data.crypto.forEach(c => {
          if (c.quantity > 0 && c.dailyChangePct != null && c.dailyChangePct !== 0) {
            const val = c.quantity * c.currentPrice;
            const prevVal = val / (1 + c.dailyChangePct / 100);
            cryptoMovers.push({ name: c.name, pct: c.dailyChangePct, changeEur: toEur(val - prevVal, "USD", rate) });
          }
        });
        (data.equityAccounts || []).forEach(acct => {
          (acct.stocks || []).forEach(st => {
            if (st.quantity > 0 && st.dailyChangePct != null && st.dailyChangePct !== 0) {
              const val = st.quantity * st.currentPrice;
              const prevVal = val / (1 + st.dailyChangePct / 100);
              equityMovers.push({ name: st.name, pct: st.dailyChangePct, changeEur: toEur(val - prevVal, st.currency, rate), acct: acct.name });
            }
          });
        });
        data.mutualFunds.forEach(f => {
          if (f.units > 0 && f.dailyChangePct != null && f.dailyChangePct !== 0) {
            const val = f.units * f.currentPrice;
            const prevVal = val / (1 + f.dailyChangePct / 100);
            equityMovers.push({ name: f.name, pct: f.dailyChangePct, changeEur: toEur(val - prevVal, f.currency, rate), acct: "MF" });
          }
        });

        const allMovers = [...cryptoMovers, ...equityMovers];
        if (allMovers.length === 0) return null;

        const totalDayChange = allMovers.reduce((s, m) => s + m.changeEur, 0);
        const totalDayPct = calc.grossAssets > 0 ? (totalDayChange / (calc.grossAssets - totalDayChange)) * 100 : 0;

        const cSorted = [...cryptoMovers].sort((a, b) => b.pct - a.pct);
        const cGainers = cSorted.filter(m => m.pct > 0).slice(0, 3);
        const cLosers = cSorted.filter(m => m.pct < 0).reverse().slice(0, 3);

        const eSorted = [...equityMovers].sort((a, b) => b.pct - a.pct);
        const eGainers = eSorted.filter(m => m.pct > 0).slice(0, 3);
        const eLosers = eSorted.filter(m => m.pct < 0).reverse().slice(0, 3);

        const MoverRow = ({ m, isGain }) => (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: "6px", background: isGain ? colors.greenBg : colors.redBg, marginBottom: "4px" }}>
            <div><span style={{ fontSize: "12px", fontWeight: 600 }}>{m.name}</span>{m.acct && <span style={{ fontSize: "10px", color: colors.textDim, marginLeft: "6px" }}>{m.acct}</span>}</div>
            <div style={{ textAlign: "right" }}><span style={{ fontSize: "12px", fontWeight: 700, color: isGain ? colors.green : colors.red }}>{isGain ? "+" : ""}{m.pct.toFixed(2)}%</span><span style={{ fontSize: "10px", color: colors.textDim, marginLeft: "6px" }}>{isGain ? "+" : ""}{fmt(m.changeEur)}</span></div>
          </div>
        );

        return (
          <div style={s.card}>
            <div style={{ ...s.flex, cursor: "pointer" }} onClick={() => setShowDailyMovers(!showDailyMovers)}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px", color: colors.textDim, width: "16px", transition: "transform 0.2s", transform: showDailyMovers ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                <H2>Daily Movers</H2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "11px", color: colors.textDim }}>Portfolio Today:</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: totalDayChange >= 0 ? colors.green : colors.red }}>
                  {totalDayChange >= 0 ? "+" : ""}{fmt(totalDayChange)} ({totalDayPct >= 0 ? "+" : ""}{totalDayPct.toFixed(2)}%)
                </span>
              </div>
            </div>
            {showDailyMovers && <>

            {cryptoMovers.length > 0 && <>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: "14px", marginBottom: "8px" }}>Crypto</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 600, color: colors.green, marginBottom: "4px" }}>Gainers</div>
                  {cGainers.length === 0 ? <div style={{ fontSize: "11px", color: colors.textDim }}>—</div> : cGainers.map((g, i) => <MoverRow key={i} m={g} isGain />)}
                </div>
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 600, color: colors.red, marginBottom: "4px" }}>Losers</div>
                  {cLosers.length === 0 ? <div style={{ fontSize: "11px", color: colors.textDim }}>—</div> : cLosers.map((l, i) => <MoverRow key={i} m={l} isGain={false} />)}
                </div>
              </div>
            </>}

            {equityMovers.length > 0 && <>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: "14px", marginBottom: "8px" }}>Direct Equity & MFs</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 600, color: colors.green, marginBottom: "4px" }}>Gainers</div>
                  {eGainers.length === 0 ? <div style={{ fontSize: "11px", color: colors.textDim }}>—</div> : eGainers.map((g, i) => <MoverRow key={i} m={g} isGain />)}
                </div>
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 600, color: colors.red, marginBottom: "4px" }}>Losers</div>
                  {eLosers.length === 0 ? <div style={{ fontSize: "11px", color: colors.textDim }}>—</div> : eLosers.map((l, i) => <MoverRow key={i} m={l} isGain={false} />)}
                </div>
              </div>
            </>}
          </>}
          </div>
        );
      })()}

      {/* Goals Timeline - inside left column */}
      <div style={s.card}>
        <div style={s.flex}>
          <H2>Goals Timeline</H2>
          <button style={s.btn} onClick={() => update("goals", [...(data.goals || []), { id: uid(), name: "New Goal", targetDate: "", notes: "" }])}>+ ADD GOAL</button>
        </div>
        {(!data.goals || data.goals.length === 0) ? <div style={{ fontSize: "10px", color: colors.textDim, padding: "16px 0", textAlign: "center", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace" }}>No goals · Add key dates like India move, kid planned, loan payoff</div> :
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
          {(data.goals || []).slice().sort((a, b) => (a.targetDate || "9999").localeCompare(b.targetDate || "9999")).map(g => {
            const targetMs = g.targetDate ? new Date(g.targetDate).getTime() : 0;
            const daysAway = targetMs > 0 ? Math.ceil((targetMs - Date.now()) / 86400000) : null;
            const isPast = daysAway !== null && daysAway < 0;
            return (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 12px", background: colors.cardAlt, border: `1px solid ${colors.border}`, opacity: isPast ? 0.6 : 1 }}>
                <div style={{ flex: 1 }}>
                  <ECell value={g.name} onChange={v => update("goals", data.goals.map(x => x.id === g.id ? { ...x, name: v } : x))} style={{ fontSize: "12px", fontWeight: 500 }} />
                  {g.notes && <div style={{ fontSize: "10px", color: colors.textDim, marginTop: "2px" }}><ECell value={g.notes} onChange={v => update("goals", data.goals.map(x => x.id === g.id ? { ...x, notes: v } : x))} multiline style={{ fontSize: "10px", color: colors.textDim }} /></div>}
                </div>
                <input type="date" style={{ ...s.input, padding: "4px 8px", fontSize: "11px", width: "130px" }} value={g.targetDate || ""} onChange={e => update("goals", data.goals.map(x => x.id === g.id ? { ...x, targetDate: e.target.value } : x))} />
                {daysAway !== null && <span style={{ fontSize: "10px", color: isPast ? colors.textMuted : daysAway < 90 ? colors.accent : colors.textDim, minWidth: "60px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  {isPast ? "Past" : daysAway < 30 ? `${daysAway}d` : daysAway < 365 ? `${Math.round(daysAway / 30)}mo` : `${(daysAway / 365).toFixed(1)}y`}
                </span>}
                {!g.notes && <button style={{ ...s.btnOutline, padding: "2px 6px", fontSize: "9px" }} onClick={() => update("goals", data.goals.map(x => x.id === g.id ? { ...x, notes: "Add note..." } : x))}>+ NOTE</button>}
                <button style={s.btnDanger} onClick={() => update("goals", data.goals.filter(x => x.id !== g.id))}>×</button>
              </div>
            );
          })}
        </div>}
      </div>
        </div>{/* end left column */}

        <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
          {/* Right rail */}
      <div style={s.card}>
        <div style={s.flex}>
          <H2>Allocation · Asset Class</H2>
          <div style={{ display: "flex", gap: "2px" }}>
            {[{ key: "liquid", label: "Liquid" }, { key: "illiquid", label: "Illiquid" }].map(f => {
              const active = allocFilter[f.key];
              return <button key={f.key} onClick={() => {
                const other = f.key === "liquid" ? "illiquid" : "liquid";
                if (active && !allocFilter[other]) return;
                setAllocFilter({ ...allocFilter, [f.key]: !active });
              }} style={{
                padding: "3px 8px", borderRadius: 0, border: `1px solid ${active ? colors.accent : colors.border}`, cursor: "pointer",
                fontSize: "9px", fontWeight: 500, fontFamily: "'IBM Plex Mono', monospace",
                letterSpacing: "0.1em", textTransform: "uppercase",
                background: active ? colors.accent : "transparent",
                color: active ? colors.bg : colors.textDim,
              }}>{f.label}</button>;
            })}
          </div>
        </div>
        {(() => {
          const useL = allocFilter.liquid, useI = allocFilter.illiquid;
          const pick = (v) => (useL && useI) ? v.total : useL ? v.liquid : (v.total - v.liquid);
          return <div style={{ marginTop: "12px" }}>
            <DonutChart
              segments={[
                { label: "MFs / ETFs", value: pick(calc.mfValue), color: colors.cyan },
                { label: "Direct Equity", value: pick(calc.eqValue), color: colors.accent },
                { label: "Cash", value: pick(calc.cashValue), color: colors.green },
                { label: "Crypto", value: pick(calc.cryptoValue), color: colors.magenta },
                { label: "Physical Assets", value: pick(calc.propValue), color: "#8a9a5b" },
                { label: "ESOPs", value: pick(calc.esopValue), color: colors.violet },
              ].filter(x => x.value > 0)}
            />
          </div>;
        })()}
      </div>

      {/* By Currency */}
      <div style={s.card}>
        <H2>By Currency</H2>
        {(() => {
          const useL = allocFilter.liquid, useI = allocFilter.illiquid;
          const currExp = { EUR: 0, INR: 0, USD: 0 };
          const usdRate = data.settings.eurToUsd || 1.08;
          const cvt = (amt, curr) => curr === "EUR" ? amt : curr === "INR" ? amt / rate : amt / usdRate;
          const match = (liq) => (useL && useI) || (useL && liq) || (useI && !liq);

          data.mutualFunds.forEach(f => { if (match(f.liquid)) { const v = f.units * f.currentPrice; currExp[f.currency] = (currExp[f.currency] || 0) + cvt(v, f.currency); }});
          (data.equityAccounts || []).forEach(a => a.stocks.forEach(st => { if (match(st.liquid)) { const v = st.quantity * st.currentPrice; currExp[st.currency] = (currExp[st.currency] || 0) + cvt(v, st.currency); }}));
          data.cashSavings.forEach(c => { if (match(c.liquid)) currExp[c.currency] = (currExp[c.currency] || 0) + cvt(c.amount, c.currency); });
          data.crypto.forEach(c => { if (match(c.liquid)) { const v = c.quantity * c.currentPrice; currExp["USD"] = (currExp["USD"] || 0) + v / usdRate; }});
          (data.realEstate || []).forEach(p => { if (match(p.liquid)) currExp[p.currency] = (currExp[p.currency] || 0) + cvt(p.value, p.currency); });
          data.esops.forEach(e => { if (match(e.liquid)) { const v = Math.max(0, (e.vestedQty + e.unvestedQty) * (e.currentPrice - e.strikePrice)); currExp[e.currency] = (currExp[e.currency] || 0) + cvt(v, e.currency); }});

          const total = currExp.EUR + currExp.INR + currExp.USD;
          const items = [
            { ccy: "EUR", val: currExp.EUR, color: colors.cyan },
            { ccy: "INR", val: currExp.INR, color: colors.accent },
            { ccy: "USD", val: currExp.USD, color: colors.green },
          ].filter(x => x.val > 0);

          return <div style={{ marginTop: "12px" }}>
            {items.map(c => {
              const pct = total > 0 ? (c.val / total * 100) : 0;
              return <div key={c.ccy} style={{ marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px", marginBottom: "6px" }}>
                  <span style={{ color: colors.text, fontWeight: 500 }}>{c.ccy}</span>
                  <span style={{ color: colors.textDim }}>{fmt(c.val)} · {pct.toFixed(1)}%</span>
                </div>
                <div style={{ height: "6px", background: colors.cardAlt, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: c.color, transition: "width 0.5s" }} />
                </div>
              </div>;
            })}
          </div>;
        })()}
      </div>

      {/* Phase Progress */}
      <div style={s.card}>
        <div style={s.flex}>
          <H2>Phase Progress</H2>
          <div style={s.flexG}>
            {hasNextPhase && <button style={s.btn} onClick={() => { if (confirm(`Complete Phase ${activePhase.id} and move to Phase ${data.phases[activePhaseIdx + 1].id}?`)) moveToNextPhase(); }}>→ Next Phase</button>}
            <button style={s.btnOutline} onClick={addPhase}>+ Add Phase</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
          {data.phases.map(p => {
            const prog = pct(p.current, p.target); const isA = p.status === "active"; const isD = p.status === "complete";
            const statusColor = isD ? colors.green : isA ? colors.accent : colors.textMuted;
            const statusLabel = isD ? "DONE" : isA ? "ACTIVE" : "LOCKED";
            return (
              <div key={p.id} style={{ padding: "12px", background: colors.cardAlt, border: `1px solid ${colors.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px" }}>
                    <span style={{ color: colors.textDim }}>P{p.id} · </span>
                    <ECell value={p.name} onChange={v => updatePhase(p.id, "name", v)} style={{ fontSize: "12px", fontWeight: 500, color: colors.text }} />
                  </div>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "0.14em", color: statusColor }}>{statusLabel}</span>
                </div>
                {p.target > 0 && <>
                  <div style={{ height: "6px", background: "#000", overflow: "hidden", marginBottom: "6px" }}>
                    <div style={{ height: "100%", background: statusColor, width: `${Math.min(100, prog)}%`, transition: "width 0.5s" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px", color: colors.textDim }}>
                    <span><ECell value={p.current} type="number" onChange={v => updatePhase(p.id, "current", v)} /> / <ECell value={p.target} type="number" onChange={v => updatePhase(p.id, "target", v)} style={{ color: colors.textDim }} /> {p.currency}</span>
                    <span>{prog.toFixed(0)}%</span>
                  </div>
                </>}
                {p.target === 0 && <div style={{ fontSize: "10px", color: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }}>Set target: <ECell value={p.target} type="number" onChange={v => updatePhase(p.id, "target", v)} /></div>}
                {(p.milestones || []).length > 0 && <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${colors.border}` }}>
                  {(p.milestones || []).map((m, i) => {
                    const done = p.current >= m.amount;
                    return <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px", padding: "3px 0", color: done ? colors.green : colors.textDim }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {done ? "✓" : "○"} <ECell value={m.name} onChange={v => updateMilestone(p.id, i, "name", v)} style={{ fontSize: "10px" }} />
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <ECell value={m.amount} type="number" onChange={v => updateMilestone(p.id, i, "amount", v)} style={{ fontSize: "10px" }} />
                        <button style={{ ...s.btnDanger, padding: "1px 5px", fontSize: "9px" }} onClick={() => removeMilestone(p.id, i)}>×</button>
                      </span>
                    </div>;
                  })}
                </div>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "6px", borderTop: `1px dashed ${colors.border}` }}>
                  <button style={{ ...s.btnOutline, padding: "2px 8px", fontSize: "9px" }} onClick={() => addMilestone(p.id)}>+ MILESTONE</button>
                  {p.status !== "active" && <button style={s.btnDanger} onClick={() => { if (confirm(`Delete Phase ${p.id}?`)) removePhase(p.id); }}>×</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
        </div>{/* end right rail */}
      </div>{/* end two-column grid */}

      {refreshMsg && <div style={{ padding: "8px 14px", background: `${colors.accent}15`, border: `1px solid ${colors.accent}30`, fontSize: "11px", color: colors.accent, letterSpacing: "0.05em" }}>{refreshMsg}</div>}

      {showPriceSetup && <div style={s.card}>
        <H2>Price Feed Setup</H2>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>Google Sheet URL (for Indian equities)</div>
          <div style={{ fontSize: "11px", color: colors.textDim, marginBottom: "6px" }}>
            Create a Google Sheet → paste the template below → File → Share → Publish to web → CSV → paste URL here
          </div>
          <input style={{ ...s.input, marginBottom: "8px" }} placeholder="https://docs.google.com/spreadsheets/d/.../pub?output=csv"
            value={data.settings.googleSheetUrl || ""} onChange={e => update("settings", { ...data.settings, googleSheetUrl: e.target.value })} />
          <button style={s.btnOutline} onClick={() => {
            const { text } = generateSheetTemplate(data.equityAccounts);
            navigator.clipboard.writeText(text).then(() => alert("Template copied! Paste it into Google Sheets column A & B."));
          }}>📋 Copy Sheet Template to Clipboard</button>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>Crypto — Price Sources</div>
          <div style={{ fontSize: "11px", color: colors.textDim, marginBottom: "6px" }}>
            Set CoinGecko ID or Hyperliquid ticker for each token. Hyperliquid is used for pre-market tokens. If both are set, Hyperliquid takes priority.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {data.crypto.filter(c => c.quantity > 0).map(c => (
              <div key={c.id} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ fontSize: "11px", width: "120px", color: colors.textDim }}>{c.name}</span>
                <input style={{ ...s.input, width: "160px" }} placeholder="CoinGecko ID"
                  value={c.coingeckoId || ""} onChange={e => updateItem("crypto", c.id, "coingeckoId", e.target.value)} />
                <input style={{ ...s.input, width: "120px" }} placeholder="HL ticker"
                  value={c.hyperliquidTicker || ""} onChange={e => updateItem("crypto", c.id, "hyperliquidTicker", e.target.value)} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>MF / ETF — AMFI Scheme Codes</div>
          <div style={{ fontSize: "11px", color: colors.textDim, marginBottom: "6px" }}>
            Find codes at mfapi.in (e.g. PPFAS Flexi Cap Direct = 122639)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {data.mutualFunds.map(f => (
              <div key={f.id} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ fontSize: "11px", width: "180px", color: colors.textDim }}>{f.name}</span>
                <input style={{ ...s.input, width: "120px" }} placeholder="scheme code"
                  value={f.schemeCode || ""} onChange={e => updateItem("mutualFunds", f.id, "schemeCode", e.target.value)} />
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: "12px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>Equity NSE Tickers</div>
          <div style={{ fontSize: "11px", color: colors.textDim, marginBottom: "6px" }}>
            By default, the stock name is used as the NSE ticker. Override below only if the name differs from the NSE symbol.
          </div>
          {(data.equityAccounts || []).map(acct => {
            const mismatched = acct.stocks.filter(st => st.quantity > 0 && st.nseTicker && st.nseTicker !== st.name);
            const hasStocks = acct.stocks.filter(st => st.quantity > 0);
            if (hasStocks.length === 0) return null;
            return (
              <div key={acct.id} style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "11px", fontWeight: 600, color: colors.accent, marginBottom: "4px" }}>{acct.name}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {hasStocks.map(st => (
                    <div key={st.id} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", color: colors.textDim, width: "80px" }}>{st.name}</span>
                      <input style={{ ...s.input, width: "90px", fontSize: "10px" }} placeholder={st.name}
                        value={st.nseTicker || ""} onChange={e => updateStock(acct.id, st.id, "nseTicker", e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>}
    </div>
    );
  };

  // ─── INCOME & EXPENSES ───
  const renderIncome = () => {
    // Build monthly income vs expense data from snapshots (1 per month)
    const monthlyData = (() => {
      const byMonth = {};
      (data.snapshots || []).forEach(snap => {
        const ym = snap.date?.slice(0, 7);
        if (!ym) return;
        // Snapshots don't store income/expense — just use current values as placeholder
        // Will show current month for now; over time, if we store them per snapshot, chart fills in
        if (!byMonth[ym] || new Date(snap.date) > new Date(byMonth[ym].date)) {
          byMonth[ym] = { date: snap.date, income: snap.totalIncome, expenses: snap.totalExpenses };
        }
      });
      return Object.entries(byMonth)
        .filter(([, v]) => v.income != null)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-12)
        .map(([ym, v]) => ({ ym, income: v.income, expenses: v.expenses }));
    })();

    return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={s.card}>
        <div style={s.flex}><H2>Income vs Expenses · 12mo</H2><span style={{ fontSize: "10px", color: colors.textDim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{monthlyData.length >= 2 ? `${monthlyData.length} MO` : "FILLS AS SNAPSHOTS ACCUMULATE"}</span></div>
        {monthlyData.length < 2 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: colors.textMuted, fontSize: "11px", letterSpacing: "0.1em", fontFamily: "'IBM Plex Mono', monospace" }}>
            CURRENT: IN {fmt(calc.totalIncomeEur)} · EX {fmt(calc.totalFixedEur)} · SURPLUS {fmt(calc.totalIncomeEur - calc.totalFixedEur)}<br/>
            <span style={{ fontSize: "10px" }}>TAKE A SNAPSHOT EACH MONTH TO BUILD TREND DATA</span>
          </div>
        ) : (() => {
          const W = 700, H = 180, padL = 40, padR = 10, padT = 10, padB = 22;
          const iw = W - padL - padR, ih = H - padT - padB;
          const max = Math.max(...monthlyData.flatMap(d => [d.income, d.expenses]));
          const slot = iw / monthlyData.length;
          const bw = slot * 0.32;
          return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block", marginTop: "12px" }}>
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
              const y = padT + ih - t * ih;
              return <line key={i} x1={padL} x2={W - padR} y1={y} y2={y} stroke={colors.gridLine} strokeWidth="1" strokeDasharray={i === 0 ? "0" : "2,4"} />;
            })}
            {monthlyData.map((d, i) => {
              const cx = padL + slot * (i + 0.5);
              const hi = (d.income / max) * ih;
              const he = (d.expenses / max) * ih;
              const monthLabel = new Date(d.ym + "-01").toLocaleDateString("en-US", { month: "short" }).charAt(0);
              return <g key={i}>
                <rect x={cx - bw - 1} y={padT + ih - hi} width={bw} height={hi} fill={colors.cyan} />
                <rect x={cx + 1} y={padT + ih - he} width={bw} height={he} fill={colors.red} />
                <text x={cx} y={H - 6} fontFamily="'IBM Plex Mono',monospace" fontSize="9" fill={colors.textDim} textAnchor="middle">{monthLabel}</text>
              </g>;
            })}
          </svg>;
        })()}
        {monthlyData.length >= 2 && <div style={{ display: "flex", gap: "20px", marginTop: "12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px", color: colors.textDim, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          <span><span style={{ display: "inline-block", width: "10px", height: "10px", background: colors.cyan, marginRight: "6px", verticalAlign: "middle" }} />Income</span>
          <span><span style={{ display: "inline-block", width: "10px", height: "10px", background: colors.red, marginRight: "6px", verticalAlign: "middle" }} />Expenses</span>
        </div>}
      </div>
      <div style={s.card}>
        <div style={s.flex}><H2>Income</H2><button style={s.btn} onClick={() => addItem("income", { name: "New", amount: 0, currency: "EUR", frequency: "monthly" })}>+ Add</button></div>
        <table style={s.table}><thead><tr><th style={s.th}>Source</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>Freq</th><th style={s.th}>EUR/mo</th><th style={s.th}></th></tr></thead>
        <tbody>{data.income.map(i => <tr key={i.id}><td style={s.td}><ECell value={i.name} onChange={v => updateItem("income", i.id, "name", v)} /></td><td style={s.td}><ECell value={i.amount} type="number" onChange={v => updateItem("income", i.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={i.currency} onChange={v => updateItem("income", i.id, "currency", v)} /></td><td style={s.td}><select style={s.select} value={i.frequency} onChange={e => updateItem("income", i.id, "frequency", e.target.value)}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></td><td style={s.td}>{fmt(toEur(i.frequency === "annual" ? i.amount / 12 : i.amount, i.currency, rate))}</td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("income", i.id)}>×</button></td></tr>)}</tbody></table>
        <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.totalIncomeEur, rate)}/mo</div>
      </div>
      <div style={s.card}>
        <div style={s.flex}><H2>Fixed Expenses</H2><button style={s.btn} onClick={() => addItem("fixedExpenses", { name: "New", amount: 0, currency: "EUR", frequency: "monthly", category: "Other" })}>+ Add</button></div>
        {(() => {
          const byCategory = {};
          data.fixedExpenses.forEach(e => {
            const cat = e.category || autoCategorize(e.name);
            const eurMo = toEur(e.frequency === "annual" ? e.amount / 12 : e.amount, e.currency, rate, data.settings.eurToUsd || 1.08);
            byCategory[cat] = (byCategory[cat] || 0) + eurMo;
          });
          const segments = EXPENSE_CATEGORIES
            .filter(c => byCategory[c] > 0)
            .map(c => ({ label: c, value: byCategory[c], color: CATEGORY_COLORS[c] }));
          if (segments.length === 0) return null;
          return <div style={{ marginBottom: "16px", padding: "12px", background: colors.bg, borderRadius: "8px" }}>
            <DonutChart title="By Category" segments={segments} currency="EUR" size={140} />
          </div>;
        })()}
        <table style={s.table}><thead><tr><th style={s.th}>Item</th><th style={s.th}>Category</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>Freq</th><th style={s.th}>EUR/mo</th><th style={s.th}></th></tr></thead>
        <tbody>{data.fixedExpenses.map(e => <tr key={e.id}><td style={s.td}><ECell value={e.name} onChange={v => updateItem("fixedExpenses", e.id, "name", v)} /></td><td style={s.td}><select style={s.select} value={e.category || autoCategorize(e.name)} onChange={ev => updateItem("fixedExpenses", e.id, "category", ev.target.value)}>{EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></td><td style={s.td}><ECell value={e.amount} type="number" onChange={v => updateItem("fixedExpenses", e.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={e.currency} onChange={v => updateItem("fixedExpenses", e.id, "currency", v)} /></td><td style={s.td}><select style={s.select} value={e.frequency} onChange={ev => updateItem("fixedExpenses", e.id, "frequency", ev.target.value)}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></td><td style={s.td}>{fmt(toEur(e.frequency === "annual" ? e.amount / 12 : e.amount, e.currency, rate))}</td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("fixedExpenses", e.id)}>×</button></td></tr>)}</tbody></table>
        <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.totalFixedEur, rate)}/mo</div>
      </div>
      <div style={s.card}>
        <div style={s.flex}><H2>One-off Expenses</H2><button style={s.btn} onClick={() => addItem("oneOffExpenses", { name: "Expense", amount: 0, currency: "EUR", date: new Date().toISOString().slice(0, 10) })}>+ Add</button></div>
        {data.oneOffExpenses.length === 0 ? <div style={{ fontSize: "12px", color: colors.textDim, padding: "12px 0" }}>No one-off expenses</div> :
        <table style={s.table}><thead><tr><th style={s.th}>Item</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>Date</th><th style={s.th}></th></tr></thead>
        <tbody>{data.oneOffExpenses.map(e => <tr key={e.id}><td style={s.td}><ECell value={e.name} onChange={v => updateItem("oneOffExpenses", e.id, "name", v)} /></td><td style={s.td}><ECell value={e.amount} type="number" onChange={v => updateItem("oneOffExpenses", e.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={e.currency} onChange={v => updateItem("oneOffExpenses", e.id, "currency", v)} /></td><td style={s.td}><input type="date" style={s.input} value={e.date} onChange={ev => updateItem("oneOffExpenses", e.id, "date", ev.target.value)} /></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("oneOffExpenses", e.id)}>×</button></td></tr>)}</tbody></table>}
      </div>
    </div>
    );
  };

  // ─── PORTFOLIO ───
  const renderPortfolio = () => {
    const subTabs = [{ key: "mf", label: "MFs / ETFs" }, { key: "eq", label: "Direct Equity" }, { key: "cash", label: "Cash & Savings" }, { key: "crypto", label: "Crypto" }, { key: "re", label: "Physical Assets" }, { key: "esop", label: "ESOPs" }];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={s.flexG}>{subTabs.map(t => <button key={t.key} style={s.tab(subTab === t.key)} onClick={() => setSubTab(t.key)}>{t.label}</button>)}</div>

        {subTab === "mf" && <div style={s.card}>
          <div style={s.flex}><H2>Mutual Funds / ETFs</H2><button style={s.btn} onClick={() => addItem("mutualFunds", { name: "New Fund", units: 0, totalInvested: 0, currentPrice: 0, currency: "INR", liquid: true })}>+ Add</button></div>
          {(data.priceHistory || []).length >= 2 && <div style={{ marginBottom: "14px" }}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.mfTotal || 0 }))} title="MF / ETF Total" />
            {data.mutualFunds.filter(f => f.units > 0).length > 1 && <div style={{ marginTop: "14px" }}>
              <MultiLineChart
                history={data.priceHistory}
                items={data.mutualFunds.filter(f => f.units > 0).map(f => ({ key: `mf_${f.id}`, label: f.name }))}
                title="Individual Funds"
              />
            </div>}
          </div>}
          <div style={{ overflowX: "auto" }}><table style={s.table}><thead><tr><th style={s.th}>Fund</th><th style={s.th}>Curr</th><th style={s.th}>Units</th><th style={s.th}>Invested</th><th style={s.th}>NAV</th><th style={s.th}>Avg Cost</th><th style={s.th}>Value</th><th style={s.th}>P/L</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.mutualFunds.map(f => {
            const invested = f.totalInvested != null ? f.totalInvested : (f.units * (f.costPrice || 0));
            const avgCost = f.units > 0 ? invested / f.units : 0;
            const cur = f.units * f.currentPrice, pl = cur - invested, plP = invested > 0 ? (pl / invested * 100) : 0;
            return <tr key={f.id}><td style={s.td}><ECell value={f.name} onChange={v => updateItem("mutualFunds", f.id, "name", v)} />{f.notes ? <div style={{ marginTop: "4px" }}><span style={{ display: "inline-block", background: colors.cardAlt, padding: "2px 8px", borderRadius: "4px", marginLeft: "-8px" }}><ECell value={f.notes} onChange={v => updateItem("mutualFunds", f.id, "notes", v)} multiline style={{ fontSize: "10px", color: "#c5cae0", background: "transparent" }} /></span></div> : <div style={{ marginTop: "2px" }}><span style={{ fontSize: "8px", color: colors.border, cursor: "pointer" }} onClick={() => updateItem("mutualFunds", f.id, "notes", "Add note...")}>+ note</span></div>}</td><td style={s.td}><CurrSelect value={f.currency} onChange={v => updateItem("mutualFunds", f.id, "currency", v)} /></td><td style={s.td}><ECell value={f.units} type="number" onChange={v => updateItem("mutualFunds", f.id, "units", v)} /></td><td style={s.td}><ECell value={invested} type="number" onChange={v => updateItem("mutualFunds", f.id, "totalInvested", v)} /></td><td style={s.td}>{f.currentPrice.toLocaleString()}</td><td style={s.td}><span style={{ color: colors.textDim }}>{avgCost > 0 ? avgCost.toFixed(2) : "—"}</span></td><td style={s.td}>{fmt(cur, f.currency)}</td><td style={s.td}><span style={{ color: pl >= 0 ? colors.green : colors.red }}>{fmt(pl, f.currency)} ({plP.toFixed(1)}%)</span></td><td style={s.td}><button style={s.liqBadge(f.liquid)} onClick={() => updateItem("mutualFunds", f.id, "liquid", !f.liquid)}>{f.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("mutualFunds", f.id)}>×</button></td></tr>;
          })}</tbody></table></div>
          <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.mfValue.total, rate)}</div>
        </div>}

        {subTab === "eq" && <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {(data.priceHistory || []).length >= 2 && <div style={s.card}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.eqTotal || 0 }))} title="Direct Equity Total" color="#8b5cf6" />
            {(data.equityAccounts || []).filter(a => a.stocks.some(st => st.quantity > 0)).length > 1 && <div style={{ marginTop: "14px" }}>
              <MultiLineChart
                history={data.priceHistory}
                items={(data.equityAccounts || []).filter(a => a.stocks.some(st => st.quantity > 0)).map(a => ({ key: `eqAcct_${a.id}`, label: a.name }))}
                title="Per Account"
              />
            </div>}
          </div>}
          <div style={s.flex}><H2>Direct Equity Accounts</H2><button style={s.btn} onClick={() => addItem("equityAccounts", { name: "New Account", currency: "INR", stocks: [] })}>+ Add Account</button></div>
          {(data.equityAccounts || []).map(acct => {
            const acctCurrency = acct.currency || "INR";
            const acctNativeTotal = acct.stocks.reduce((s, st) => s + st.quantity * st.currentPrice, 0);
            const acctNativeInvested = acct.stocks.reduce((s, st) => s + st.quantity * st.costPrice, 0);
            const acctNativePL = acctNativeTotal - acctNativeInvested;
            const acctEurTotal = acct.stocks.reduce((s, st) => s + toEur(st.quantity * st.currentPrice, st.currency, rate, data.settings.eurToUsd || 1.08), 0);
            const isExpanded = expandedAccts[acct.id] ?? false;
            const toggleExpand = () => setExpandedAccts(prev => ({ ...prev, [acct.id]: !prev[acct.id] }));
            return (
            <div key={acct.id} style={s.card}>
              <div style={{ ...s.flex, cursor: "pointer" }} onClick={toggleExpand}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "12px", color: colors.textDim, width: "16px", transition: "transform 0.2s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                  <div style={{ width: "4px", height: "24px", borderRadius: "2px", background: colors.accent }} />
                  <span style={{ fontSize: "14px", fontWeight: 600 }} onClick={e => e.stopPropagation()}><ECell value={acct.name} onChange={v => update("equityAccounts", data.equityAccounts.map(a => a.id === acct.id ? { ...a, name: v } : a))} style={{ fontSize: "14px", fontWeight: 600 }} /></span>
                  <span onClick={e => e.stopPropagation()}><CurrSelect value={acctCurrency} onChange={v => {
                    const accts = data.equityAccounts.map(a => a.id === acct.id ? { ...a, currency: v, stocks: a.stocks.map(st => ({ ...st, currency: v })) } : a);
                    update("equityAccounts", accts);
                  }} /></span>
                  <span style={{ fontSize: "11px", color: colors.textDim }}>({acct.stocks.filter(st => st.quantity > 0).length} stocks)</span>
                </div>
                <div style={s.flexG} onClick={e => e.stopPropagation()}>
                  <button style={s.btn} onClick={() => addStockToAccount(acct.id)}>+ Stock</button>
                  <button style={s.btnDanger} onClick={() => { if (confirm(`Delete "${acct.name}"?`)) removeItem("equityAccounts", acct.id); }}>Delete</button>
                </div>
              </div>
              {/* Always show totals */}
              {acct.stocks.length > 0 && <div style={{ marginTop: "8px", display: "flex", justifyContent: "flex-end", gap: "16px", fontSize: "12px", fontWeight: 600 }}>
                <span style={{ color: colors.textDim }}>Invested: {fmt(acctNativeInvested, acctCurrency)}</span>
                <span style={{ color: colors.textDim }}>Value: {fmt(acctNativeTotal, acctCurrency)}{acctCurrency !== "EUR" && <span style={{ fontSize: "10px" }}> ({fmt(acctEurTotal)})</span>}</span>
                <span style={{ color: acctNativePL >= 0 ? colors.green : colors.red }}>P/L: {fmt(acctNativePL, acctCurrency)} ({acctNativeInvested > 0 ? (acctNativePL / acctNativeInvested * 100).toFixed(1) : 0}%)</span>
              </div>}
              {/* Expandable stock table */}
              {isExpanded && <>
                {acct.stocks.length === 0 ? <div style={{ fontSize: "12px", color: colors.textDim, padding: "12px 0 0 14px" }}>No stocks</div> :
                (() => {
                  const toggleSort = (field) => setStockSort(prev => ({ field, dir: prev.field === field && prev.dir === "desc" ? "asc" : "desc" }));
                  const sortArrow = (field) => stockSort.field === field ? (stockSort.dir === "desc" ? " ↓" : " ↑") : "";
                  const thSort = (label, field) => ({ ...s.th, cursor: "pointer", userSelect: "none" });

                  const enriched = acct.stocks.map(st => {
                    const inv = st.quantity * st.costPrice, cur = st.quantity * st.currentPrice, pl = cur - inv;
                    const plP = inv > 0 ? (pl / inv * 100) : 0;
                    return { ...st, inv, cur, pl, plP };
                  });

                  let filtered = enriched;
                  if (stockSearch) {
                    const q = stockSearch.toLowerCase();
                    filtered = enriched.filter(st => st.name.toLowerCase().includes(q));
                  }

                  if (stockSort.field) {
                    const dir = stockSort.dir === "desc" ? -1 : 1;
                    const f = stockSort.field;
                    filtered.sort((a, b) => {
                      let va, vb;
                      if (f === "name") { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); return va < vb ? -dir : va > vb ? dir : 0; }
                      if (f === "qty") { va = a.quantity; vb = b.quantity; }
                      else if (f === "cost") { va = a.costPrice; vb = b.costPrice; }
                      else if (f === "price") { va = a.currentPrice; vb = b.currentPrice; }
                      else if (f === "inv") { va = a.inv; vb = b.inv; }
                      else if (f === "val") { va = a.cur; vb = b.cur; }
                      else if (f === "pl") { va = a.pl; vb = b.pl; }
                      else if (f === "plP") { va = a.plP; vb = b.plP; }
                      else { va = 0; vb = 0; }
                      return (va - vb) * dir;
                    });
                  }

                  return <>
                    <div style={{ marginTop: "10px", marginBottom: "6px" }}>
                      <input style={{ ...s.input, maxWidth: "250px" }} placeholder="Search stocks..." value={stockSearch} onChange={e => setStockSearch(e.target.value)} />
                    </div>
                    <div style={{ overflowX: "auto" }}><table style={s.table}><thead><tr>
                      <th style={thSort("name", "name")} onClick={() => toggleSort("name")}>Stock{sortArrow("name")}</th>
                      <th style={thSort("qty", "qty")} onClick={() => toggleSort("qty")}>Qty{sortArrow("qty")}</th>
                      <th style={thSort("cost", "cost")} onClick={() => toggleSort("cost")}>Cost{sortArrow("cost")}</th>
                      <th style={thSort("price", "price")} onClick={() => toggleSort("price")}>Current{sortArrow("price")}</th>
                      <th style={thSort("inv", "inv")} onClick={() => toggleSort("inv")}>Invested{sortArrow("inv")}</th>
                      <th style={thSort("val", "val")} onClick={() => toggleSort("val")}>Value{sortArrow("val")}</th>
                      <th style={thSort("plP", "plP")} onClick={() => toggleSort("plP")}>P/L{sortArrow("plP")}</th>
                      <th style={s.th}>Liq</th><th style={s.th}></th>
                    </tr></thead>
                    <tbody>{filtered.map(st => (
                      <tr key={st.id}><td style={s.td}><ECell value={st.name} onChange={v => updateStock(acct.id, st.id, "name", v)} />{st.notes ? <div style={{ marginTop: "4px" }}><span style={{ display: "inline-block", background: colors.cardAlt, padding: "2px 8px", borderRadius: "4px", marginLeft: "-8px" }}><ECell value={st.notes} onChange={v => updateStock(acct.id, st.id, "notes", v)} multiline style={{ fontSize: "10px", color: "#c5cae0", background: "transparent" }} /></span></div> : <div style={{ marginTop: "2px" }}><span style={{ fontSize: "8px", color: colors.border, cursor: "pointer" }} onClick={() => updateStock(acct.id, st.id, "notes", "Add note...")}>+ note</span></div>}</td><td style={s.td}><ECell value={st.quantity} type="number" onChange={v => updateStock(acct.id, st.id, "quantity", v)} /></td><td style={s.td}><ECell value={st.costPrice} type="number" onChange={v => updateStock(acct.id, st.id, "costPrice", v)} /></td><td style={s.td}><ECell value={st.currentPrice} type="number" onChange={v => updateStock(acct.id, st.id, "currentPrice", v)} /></td><td style={s.td}>{fmt(st.inv, st.currency)}</td><td style={s.td}>{fmt(st.cur, st.currency)}</td><td style={s.td}><span style={{ color: st.pl >= 0 ? colors.green : colors.red }}>{fmt(st.pl, st.currency)} ({st.plP.toFixed(1)}%)</span></td><td style={s.td}><button style={s.liqBadge(st.liquid)} onClick={() => updateStock(acct.id, st.id, "liquid", !st.liquid)}>{st.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeStock(acct.id, st.id)}>×</button></td></tr>
                    ))}</tbody></table></div>
                  </>;
                })()}
              </>}
            </div>
            );
          })}
          <div style={{ fontSize: "13px", fontWeight: 600, textAlign: "right" }}>All Direct Equity: {fmtBoth(calc.eqValue.total, rate)}</div>
        </div>}

        {subTab === "cash" && <div style={s.card}>
          <div style={s.flex}><H2>Cash & Savings</H2><button style={s.btn} onClick={() => addItem("cashSavings", { name: "New", type: "Bank", amount: 0, currency: "EUR", liquid: true })}>+ Add</button></div>
          {(data.priceHistory || []).length >= 2 && <div style={{ marginBottom: "14px" }}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.cashTotal || 0 }))} title="Cash & Savings Total" color="#22c997" />
          </div>}
          <table style={s.table}><thead><tr><th style={s.th}>Account</th><th style={s.th}>Type</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>EUR</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.cashSavings.map(c => <tr key={c.id}><td style={s.td}><ECell value={c.name} onChange={v => updateItem("cashSavings", c.id, "name", v)} />{c.notes ? <div style={{ marginTop: "4px" }}><span style={{ display: "inline-block", background: colors.cardAlt, padding: "2px 8px", borderRadius: "4px", marginLeft: "-8px" }}><ECell value={c.notes} onChange={v => updateItem("cashSavings", c.id, "notes", v)} multiline style={{ fontSize: "10px", color: "#c5cae0", background: "transparent" }} /></span></div> : <div style={{ marginTop: "2px" }}><span style={{ fontSize: "8px", color: colors.border, cursor: "pointer" }} onClick={() => updateItem("cashSavings", c.id, "notes", "Add note...")}>+ note</span></div>}</td><td style={s.td}><select style={s.select} value={c.type} onChange={e => updateItem("cashSavings", c.id, "type", e.target.value)}><option>Bank</option><option>FD</option><option>RD</option><option>Other</option></select></td><td style={s.td}><ECell value={c.amount} type="number" onChange={v => updateItem("cashSavings", c.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={c.currency} onChange={v => updateItem("cashSavings", c.id, "currency", v)} /></td><td style={s.td}>{fmt(toEur(c.amount, c.currency, rate))}</td><td style={s.td}><button style={s.liqBadge(c.liquid)} onClick={() => updateItem("cashSavings", c.id, "liquid", !c.liquid)}>{c.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("cashSavings", c.id)}>×</button></td></tr>)}</tbody></table>
          <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.cashValue.total, rate)}</div>
        </div>}

        {subTab === "crypto" && <div style={s.card}>
          <div style={s.flex}><H2>Crypto</H2><button style={s.btn} onClick={() => addItem("crypto", { name: "Token", quantity: 0, costPrice: 0, currentPrice: 0, currency: "USD", liquid: true })}>+ Add</button></div>
          {(data.priceHistory || []).length >= 2 && <div style={{ marginBottom: "14px" }}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.cryptoTotal || 0 }))} title="Crypto Total" color="#f59e0b" />
          </div>}
          <div style={{ overflowX: "auto" }}><table style={s.table}><thead><tr><th style={s.th}>Token</th><th style={s.th}>Qty</th><th style={s.th}>Cost</th><th style={s.th}>Current</th><th style={s.th}>Invested</th><th style={s.th}>Value</th><th style={s.th}>P/L</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.crypto.map(c => {
            const inv = c.quantity * c.costPrice, cur = c.quantity * c.currentPrice, pl = cur - inv, plP = inv > 0 ? (pl / inv * 100) : 0;
            return <tr key={c.id}><td style={s.td}><ECell value={c.name} onChange={v => updateItem("crypto", c.id, "name", v)} />{c.notes ? <div style={{ marginTop: "4px" }}><span style={{ display: "inline-block", background: colors.cardAlt, padding: "2px 8px", borderRadius: "4px", marginLeft: "-8px" }}><ECell value={c.notes} onChange={v => updateItem("crypto", c.id, "notes", v)} multiline style={{ fontSize: "10px", color: "#c5cae0", background: "transparent" }} /></span></div> : <div style={{ marginTop: "2px" }}><span style={{ fontSize: "8px", color: colors.border, cursor: "pointer" }} onClick={() => updateItem("crypto", c.id, "notes", "Add note...")}>+ note</span></div>}</td><td style={s.td}><ECell value={c.quantity} type="number" onChange={v => updateItem("crypto", c.id, "quantity", v)} /></td><td style={s.td}><ECell value={c.costPrice} type="number" onChange={v => updateItem("crypto", c.id, "costPrice", v)} /></td><td style={s.td}><ECell value={c.currentPrice} type="number" onChange={v => updateItem("crypto", c.id, "currentPrice", v)} /></td><td style={s.td}>{fmt(inv, c.currency)}</td><td style={s.td}>{fmt(cur, c.currency)}</td><td style={s.td}><span style={{ color: pl >= 0 ? colors.green : colors.red }}>{fmt(pl, c.currency)} ({plP.toFixed(1)}%)</span></td><td style={s.td}><button style={s.liqBadge(c.liquid)} onClick={() => updateItem("crypto", c.id, "liquid", !c.liquid)}>{c.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("crypto", c.id)}>×</button></td></tr>;
          })}</tbody></table></div>
          {(() => {
            const liquidUsd = data.crypto.filter(c => c.liquid).reduce((s, c) => s + c.quantity * c.currentPrice, 0);
            const illiquidUsd = data.crypto.filter(c => !c.liquid).reduce((s, c) => s + c.quantity * c.currentPrice, 0);
            const totalUsd = liquidUsd + illiquidUsd;
            const usdRate = data.settings.eurToUsd || 1.08;
            return <div style={{ marginTop: "10px", display: "flex", justifyContent: "flex-end", gap: "20px", fontSize: "12px", fontWeight: 600 }}>
              <span style={{ color: colors.green }}>Liquid: ${liquidUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} <span style={{ fontSize: "10px", color: colors.textDim }}>(€{(liquidUsd / usdRate).toLocaleString("en-US", { maximumFractionDigits: 0 })})</span></span>
              <span style={{ color: colors.yellow }}>Illiquid: ${illiquidUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} <span style={{ fontSize: "10px", color: colors.textDim }}>(€{(illiquidUsd / usdRate).toLocaleString("en-US", { maximumFractionDigits: 0 })})</span></span>
              <span>Total: ${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} <span style={{ fontSize: "10px", color: colors.textDim }}>({fmtBoth(calc.cryptoValue.total, rate)})</span></span>
            </div>;
          })()}
        </div>}

        {subTab === "re" && <div style={s.card}>
          <div style={s.flex}><H2>Real Estate</H2><button style={s.btn} onClick={() => update("realEstate", [...(data.realEstate || []), { id: uid(), name: "Property", value: 0, currency: "INR", liquid: false }])}>+ Add</button></div>
          {(data.priceHistory || []).length >= 2 && (data.priceHistory || []).some(h => h.reTotal > 0) && <div style={{ marginBottom: "14px" }}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.reTotal || 0 }))} title="Physical Assets Total" color="#3b82f6" />
          </div>}
          {(!data.realEstate || data.realEstate.length === 0) ? <div style={{ fontSize: "12px", color: colors.textDim, padding: "12px 0" }}>No real estate</div> :
          <table style={s.table}><thead><tr><th style={s.th}>Name</th><th style={s.th}>Value</th><th style={s.th}>Curr</th><th style={s.th}>EUR</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.realEstate.map(p => <tr key={p.id}><td style={s.td}><ECell value={p.name} onChange={v => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, name: v } : i))} />{p.notes ? <div style={{ marginTop: "4px" }}><span style={{ display: "inline-block", background: colors.cardAlt, padding: "2px 8px", borderRadius: "4px", marginLeft: "-8px" }}><ECell value={p.notes} onChange={v => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, notes: v } : i))} multiline style={{ fontSize: "10px", color: "#c5cae0", background: "transparent" }} /></span></div> : <div style={{ marginTop: "2px" }}><span style={{ fontSize: "8px", color: colors.border, cursor: "pointer" }} onClick={() => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, notes: "Add note..." } : i))}>+ note</span></div>}</td><td style={s.td}><ECell value={p.value} type="number" onChange={v => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, value: v } : i))} /></td><td style={s.td}><CurrSelect value={p.currency} onChange={v => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, currency: v } : i))} /></td><td style={s.td}>{fmt(toEur(p.value, p.currency, rate))}</td><td style={s.td}><button style={s.liqBadge(p.liquid)} onClick={() => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, liquid: !i.liquid } : i))}>{p.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => update("realEstate", data.realEstate.filter(i => i.id !== p.id))}>×</button></td></tr>)}</tbody></table>}
        </div>}

        {subTab === "esop" && <div style={s.card}>
          <div style={s.flex}><H2>ESOPs</H2><button style={s.btn} onClick={() => addItem("esops", { company: "Company", strikePrice: 0, quantity: 0, currentPrice: 0, vestedQty: 0, unvestedQty: 0, currency: "EUR", liquid: false })}>+ Add</button></div>
          {(data.priceHistory || []).length >= 2 && (data.priceHistory || []).some(h => h.esopTotal > 0) && <div style={{ marginBottom: "14px" }}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.esopTotal || 0 }))} title="ESOPs Total" color="#ec4899" />
          </div>}
          <div style={{ overflowX: "auto" }}><table style={s.table}><thead><tr><th style={s.th}>Company</th><th style={s.th}>Strike</th><th style={s.th}>Current</th><th style={s.th}>Total</th><th style={s.th}>Vested</th><th style={s.th}>Unvested</th><th style={s.th}>Vested Val</th><th style={s.th}>Unvested Val</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.esops.map(e => {
            const vv = Math.max(0, e.vestedQty * (e.currentPrice - e.strikePrice)), uv = Math.max(0, e.unvestedQty * (e.currentPrice - e.strikePrice));
            return <tr key={e.id}><td style={s.td}><ECell value={e.company} onChange={v => updateItem("esops", e.id, "company", v)} />{e.notes ? <div style={{ marginTop: "4px" }}><span style={{ display: "inline-block", background: colors.cardAlt, padding: "2px 8px", borderRadius: "4px", marginLeft: "-8px" }}><ECell value={e.notes} onChange={v => updateItem("esops", e.id, "notes", v)} multiline style={{ fontSize: "10px", color: "#c5cae0", background: "transparent" }} /></span></div> : <div style={{ marginTop: "2px" }}><span style={{ fontSize: "8px", color: colors.border, cursor: "pointer" }} onClick={() => updateItem("esops", e.id, "notes", "Add note...")}>+ note</span></div>}</td><td style={s.td}><ECell value={e.strikePrice} type="number" onChange={v => updateItem("esops", e.id, "strikePrice", v)} /></td><td style={s.td}><ECell value={e.currentPrice} type="number" onChange={v => updateItem("esops", e.id, "currentPrice", v)} /></td><td style={s.td}><ECell value={e.quantity} type="number" onChange={v => updateItem("esops", e.id, "quantity", v)} /></td><td style={s.td}><ECell value={e.vestedQty} type="number" onChange={v => updateItem("esops", e.id, "vestedQty", v)} /></td><td style={s.td}><ECell value={e.unvestedQty} type="number" onChange={v => updateItem("esops", e.id, "unvestedQty", v)} /></td><td style={s.td}><span style={{ color: colors.green }}>{fmt(vv, e.currency)}</span></td><td style={s.td}><span style={{ color: colors.yellow }}>{fmt(uv, e.currency)}</span></td><td style={s.td}><button style={s.liqBadge(e.liquid)} onClick={() => updateItem("esops", e.id, "liquid", !e.liquid)}>{e.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("esops", e.id)}>×</button></td></tr>;
          })}</tbody></table></div>
        </div>}
      </div>
    );
  };

  // ─── SIPs & ALLOCATION ───
  const renderInvest = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={s.card}>
        <div style={s.flex}><H2>Monthly SIPs</H2><button style={s.btn} onClick={() => addItem("sips", { name: "New SIP", amount: 0, currency: "INR" })}>+ Add</button></div>
        <table style={s.table}><thead><tr><th style={s.th}>Investment</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>EUR/mo</th><th style={s.th}></th></tr></thead>
        <tbody>{data.sips.map(i => <tr key={i.id}><td style={s.td}><ECell value={i.name} onChange={v => updateItem("sips", i.id, "name", v)} /></td><td style={s.td}><ECell value={i.amount} type="number" onChange={v => updateItem("sips", i.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={i.currency} onChange={v => updateItem("sips", i.id, "currency", v)} /></td><td style={s.td}>{fmt(toEur(i.amount, i.currency, rate))}</td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("sips", i.id)}>×</button></td></tr>)}</tbody></table>
        <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.totalSipsEur, rate)}/mo</div>
      </div>
      <div style={s.card}>
        <H2>Unallocated · After Expenses + SIPs</H2>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "13px", lineHeight: 2, marginTop: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: "11px" }}>Income</span>
            <span style={{ color: colors.green }}>{fmt(calc.totalIncomeEur)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: "11px" }}>− Fixed Expenses</span>
            <span style={{ color: colors.red }}>{fmt(calc.totalFixedEur)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: "11px" }}>− SIPs</span>
            <span style={{ color: colors.red }}>{fmt(calc.totalSipsEur)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${colors.border}`, paddingTop: "6px", marginTop: "6px" }}>
            <span style={{ color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: "11px" }}>= Surplus</span>
            <span>{fmt(calc.surplus)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: "11px" }}>− Allocated</span>
            <span style={{ color: colors.red }}>{fmt(calc.totalAllocEur)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: `2px solid ${colors.accent}`, paddingTop: "8px", marginTop: "8px", fontSize: "16px" }}>
            <span style={{ color: colors.accent, textTransform: "uppercase", letterSpacing: "0.14em", fontSize: "12px", fontWeight: 500 }}>Unallocated</span>
            <span style={{ color: colors.accent, fontWeight: 500 }}>{fmt(calc.unallocated)}</span>
          </div>
        </div>
      </div>
      <div style={s.card}>
        <div style={s.flex}><H2>Surplus Allocation (Phase {data.settings.currentPhase})</H2><button style={s.btn} onClick={() => addItem("surplusAllocation", { name: "New", amount: 0, currency: "EUR", phase: data.settings.currentPhase })}>+ Add</button></div>
        <table style={s.table}><thead><tr><th style={s.th}>Allocation</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>Phase</th><th style={s.th}>EUR/mo</th><th style={s.th}></th></tr></thead>
        <tbody>{data.surplusAllocation.map(a => <tr key={a.id} style={{ opacity: a.phase === data.settings.currentPhase ? 1 : 0.4 }}><td style={s.td}><ECell value={a.name} onChange={v => updateItem("surplusAllocation", a.id, "name", v)} /></td><td style={s.td}><ECell value={a.amount} type="number" onChange={v => updateItem("surplusAllocation", a.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={a.currency} onChange={v => updateItem("surplusAllocation", a.id, "currency", v)} /></td><td style={s.td}><select style={s.select} value={a.phase} onChange={e => updateItem("surplusAllocation", a.id, "phase", parseInt(e.target.value))}>{data.phases.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}</select></td><td style={s.td}>{fmt(toEur(a.amount, a.currency, rate))}</td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("surplusAllocation", a.id)}>×</button></td></tr>)}</tbody></table>
        <div style={{ marginTop: "12px", padding: "10px 14px", background: calc.unallocated >= 0 ? `${colors.green}10` : `${colors.red}10`, border: `1px solid ${calc.unallocated >= 0 ? colors.green : colors.red}40` }}>
          <div style={s.flex}>
            <span style={{ fontSize: "10px", color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'IBM Plex Mono', monospace" }}>Allocated: <span style={{ color: colors.text }}>{fmt(calc.totalAllocEur)}/mo</span></span>
            <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'IBM Plex Mono', monospace", color: colors.textDim }}>Unallocated: <span style={{ color: calc.unallocated >= 0 ? colors.green : colors.red }}>{fmt(calc.unallocated)}/mo</span></span>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── LIABILITIES ───
  const renderLiabilities = () => (
    <div style={s.card}>
      <div style={s.flex}><H2>Liabilities</H2><button style={s.btn} onClick={() => addItem("liabilities", { name: "New Loan", totalAmount: 0, interestRate: 0, monthlyEMI: 0, startDate: "", tenureMonths: 0, currency: "EUR", specialPayments: [] })}>+ Add</button></div>
      {data.liabilities.length === 0 ? <div style={{ fontSize: "12px", color: colors.textDim, padding: "12px 0" }}>No liabilities</div> :
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {data.liabilities.map(l => {
          const elapsed = getMonthsElapsed(l.startDate);
          const spTotal = (l.specialPayments || []).reduce((s, p) => s + (p.amount || 0), 0);
          const amort = calcAmortization(l.totalAmount, l.interestRate, l.tenureMonths, elapsed, spTotal, l.manualEMI || 0, l.balloonAmount || 0);
          const remaining = amort.monthsLeft != null ? amort.monthsLeft : Math.max(0, l.tenureMonths - elapsed);
          const prog = pct(elapsed, l.tenureMonths);
          return (
            <div key={l.id} style={{ padding: "14px", borderRadius: "8px", background: colors.cardAlt, border: `1px solid ${colors.border}` }}>
              <div style={s.flex}><ECell value={l.name} onChange={v => updateItem("liabilities", l.id, "name", v)} style={{ fontSize: "14px", fontWeight: 600 }} /><button style={s.btnDanger} onClick={() => removeItem("liabilities", l.id)}>×</button></div>
              {"linkedAsset" in l ? <div style={{ fontSize: "10px", color: colors.textDim, marginTop: "2px" }}>Secured by: <select style={{ ...s.select, fontSize: "10px", color: colors.accent }} value={l.linkedAsset || ""} onChange={e => updateItem("liabilities", l.id, "linkedAsset", e.target.value)}>
                <option value="">— Select asset —</option>
                {(data.realEstate || []).map(a => <option key={a.id} value={a.name}>{a.name} ({fmt(a.value, a.currency)})</option>)}
                {data.cashSavings.filter(c => c.amount > 0).map(a => <option key={a.id} value={a.name}>{a.name} ({fmt(a.amount, a.currency)})</option>)}
                {data.mutualFunds.filter(f => f.units > 0).map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                {(data.equityAccounts || []).map(a => <option key={a.id} value={a.name}>{a.name} ({a.stocks.length} stocks)</option>)}
              </select></div>
              : <div style={{ marginTop: "2px" }}><button style={{ ...s.btnOutline, padding: "2px 6px", fontSize: "8px" }} onClick={() => updateItem("liabilities", l.id, "linkedAsset", "")}>+ Link Asset</button></div>}
              {l.notes ? <div style={{ marginTop: "4px" }}><span style={{ display: "inline-block", background: colors.cardAlt, padding: "2px 8px", borderRadius: "4px", marginLeft: "-8px" }}><ECell value={l.notes} onChange={v => updateItem("liabilities", l.id, "notes", v)} multiline style={{ fontSize: "10px", color: "#c5cae0", background: "transparent" }} /></span></div> : <div style={{ marginTop: "2px" }}><span style={{ fontSize: "8px", color: colors.border, cursor: "pointer" }} onClick={() => updateItem("liabilities", l.id, "notes", "Add note...")}>+ note</span></div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "12px" }}>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Principal</div><ECell value={l.totalAmount} type="number" onChange={v => updateItem("liabilities", l.id, "totalAmount", v)} /></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Interest Rate (%)</div><ECell value={l.interestRate} type="number" onChange={v => updateItem("liabilities", l.id, "interestRate", v)} /></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Monthly EMI {l.manualEMI ? "" : "(auto)"}</div>
                  {l.manualEMI ? <ECell value={l.manualEMI} type="number" onChange={v => updateItem("liabilities", l.id, "manualEMI", v)} />
                  : <div style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ fontSize: "13px", fontWeight: 600 }}>{amort.emi ? fmt(amort.emi, l.currency) : "—"}</span><button style={{ ...s.btnOutline, padding: "2px 6px", fontSize: "8px" }} onClick={() => updateItem("liabilities", l.id, "manualEMI", amort.emi || 0)}>Override</button></div>}
                </div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Start Date</div><input type="date" style={{ ...s.input, width: "130px" }} value={l.startDate} onChange={e => updateItem("liabilities", l.id, "startDate", e.target.value)} /></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Tenure (months)</div><ECell value={l.tenureMonths} type="number" onChange={v => updateItem("liabilities", l.id, "tenureMonths", v)} /></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Balloon Payment</div><ECell value={l.balloonAmount || 0} type="number" onChange={v => updateItem("liabilities", l.id, "balloonAmount", v)} /></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Currency</div><CurrSelect value={l.currency} onChange={v => updateItem("liabilities", l.id, "currency", v)} /></div>
                {l.manualEMI > 0 && <div><div style={{ fontSize: "10px", color: colors.textDim }}>&nbsp;</div><button style={{ ...s.btnDanger, fontSize: "9px" }} onClick={() => updateItem("liabilities", l.id, "manualEMI", 0)}>Reset to auto EMI</button></div>}
              </div>
              {l.totalAmount > 0 && l.tenureMonths > 0 && (l.interestRate > 0 || l.manualEMI > 0) && (
                <div style={{ marginTop: "14px", padding: "14px", background: colors.card, border: `1px solid ${colors.border}` }}>
                  <div style={{ fontSize: "9px", fontWeight: 400, color: colors.textDim, marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.14em", fontFamily: "'IBM Plex Mono', monospace" }}><span style={{ color: colors.accent, marginRight: "6px" }}>&gt;</span>Amortization <span style={{ float: "right", color: colors.textDim }}>{l.interestRate}% APR</span></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "14px" }}>
                    <div><div style={{ fontSize: "9px", color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.14em" }}>Principal</div><div style={{ fontSize: "14px", fontWeight: 500, marginTop: "4px", fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(l.totalAmount, l.currency)}</div></div>
                    <div><div style={{ fontSize: "9px", color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.14em" }}>Remaining</div><div style={{ fontSize: "14px", fontWeight: 500, marginTop: "4px", color: colors.red, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(amort.remainingPrincipal, l.currency)}</div></div>
                    <div><div style={{ fontSize: "9px", color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.14em" }}>EMI</div><div style={{ fontSize: "14px", fontWeight: 500, marginTop: "4px", fontFamily: "'IBM Plex Mono', monospace" }}>{amort.emi ? fmt(amort.emi, l.currency) : "—"}<span style={{ fontSize: "10px", color: colors.textDim }}>/mo</span></div></div>
                    <div><div style={{ fontSize: "9px", color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.14em" }}>Months</div><div style={{ fontSize: "14px", fontWeight: 500, marginTop: "4px", fontFamily: "'IBM Plex Mono', monospace" }}>{elapsed} / {l.tenureMonths}</div></div>
                  </div>
                  {/* Principal paid back bar */}
                  {(() => {
                    const principalPaid = l.totalAmount - amort.remainingPrincipal;
                    const paidPct = l.totalAmount > 0 ? (principalPaid / l.totalAmount) * 100 : 0;
                    return <>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{ fontSize: "10px", color: colors.green, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>Paid {paidPct.toFixed(1)}%</span>
                        <span style={{ fontSize: "10px", color: colors.red, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>Remaining {(100 - paidPct).toFixed(1)}%</span>
                      </div>
                      <div style={{ height: "6px", background: colors.cardAlt, overflow: "hidden" }}>
                        <div style={{ height: "100%", background: colors.green, width: `${paidPct}%`, transition: "width 0.5s" }} />
                      </div>
                    </>;
                  })()}
                  {/* Interest breakdown */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "14px", paddingTop: "12px", borderTop: `1px solid ${colors.border}` }}>
                    <div><div style={{ fontSize: "9px", color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.14em" }}>Interest Paid</div><div style={{ fontSize: "13px", fontWeight: 500, marginTop: "4px", color: colors.green, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(amort.totalInterest - amort.remainingInterest, l.currency)}</div></div>
                    <div><div style={{ fontSize: "9px", color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.14em" }}>Total Interest</div><div style={{ fontSize: "13px", fontWeight: 500, marginTop: "4px", color: colors.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(amort.totalInterest, l.currency)}</div></div>
                    <div><div style={{ fontSize: "9px", color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.14em" }}>Interest Remaining</div><div style={{ fontSize: "13px", fontWeight: 500, marginTop: "4px", color: colors.red, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(amort.remainingInterest, l.currency)}</div></div>
                  </div>
                  {(l.balloonAmount || 0) > 0 && <div style={{ marginTop: "10px", padding: "8px 12px", background: `${colors.accent}10`, border: `1px solid ${colors.accent}30` }}>
                    <span style={{ fontSize: "9px", color: colors.accent, textTransform: "uppercase", letterSpacing: "0.14em" }}>Balloon (Schlussrate) </span>
                    <span style={{ fontSize: "12px", color: colors.accent, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>{fmt(l.balloonAmount, l.currency)}</span>
                  </div>}
                </div>
              )}
              {/* Special Payments */}
              <div style={{ marginTop: "14px", padding: "12px", borderRadius: "8px", background: colors.card, border: `1px solid ${colors.border}` }}>
                <div style={s.flex}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: colors.textDim, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Special Payments {spTotal > 0 && <span style={{ color: colors.green }}>({fmt(spTotal, l.currency)} total)</span>}
                  </div>
                  <button style={{ ...s.btnOutline, padding: "3px 8px", fontSize: "9px" }} onClick={() => {
                    const sp = [...(l.specialPayments || []), { id: uid(), date: new Date().toISOString().slice(0, 10), amount: 0, note: "" }];
                    updateItem("liabilities", l.id, "specialPayments", sp);
                  }}>+ Add</button>
                </div>
                {(l.specialPayments || []).length === 0 ? <div style={{ fontSize: "11px", color: colors.textMuted, marginTop: "6px" }}>No special payments recorded</div> :
                <table style={{ ...s.table, marginTop: "8px" }}>
                  <thead><tr><th style={s.th}>Date</th><th style={s.th}>Amount</th><th style={s.th}>Note</th><th style={s.th}></th></tr></thead>
                  <tbody>{(l.specialPayments || []).map((sp, idx) => (
                    <tr key={sp.id || idx}>
                      <td style={s.td}><input type="date" style={{ ...s.input, width: "130px" }} value={sp.date} onChange={e => {
                        const sps = [...(l.specialPayments || [])]; sps[idx] = { ...sps[idx], date: e.target.value };
                        updateItem("liabilities", l.id, "specialPayments", sps);
                      }} /></td>
                      <td style={s.td}><ECell value={sp.amount} type="number" onChange={v => {
                        const sps = [...(l.specialPayments || [])]; sps[idx] = { ...sps[idx], amount: v };
                        updateItem("liabilities", l.id, "specialPayments", sps);
                      }} /></td>
                      <td style={s.td}><ECell value={sp.note || ""} onChange={v => {
                        const sps = [...(l.specialPayments || [])]; sps[idx] = { ...sps[idx], note: v };
                        updateItem("liabilities", l.id, "specialPayments", sps);
                      }} /></td>
                      <td style={s.td}><button style={s.btnDanger} onClick={() => {
                        const sps = [...(l.specialPayments || [])]; sps.splice(idx, 1);
                        updateItem("liabilities", l.id, "specialPayments", sps);
                      }}>×</button></td>
                    </tr>
                  ))}</tbody>
                </table>}
              </div>
            </div>
          );
        })}
      </div>}
      <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total Outstanding: {fmtBoth(calc.totalLiabEur, rate)}</div>
    </div>
  );

  // ─── HISTORY ───
  const renderHistory = () => {
    const snaps = data.snapshots;
    return (
      <div style={s.card}>
        <div style={s.flex}><H2>Net Worth Over Time</H2><button style={s.btn} onClick={takeSnapshot}>📸 Save Snapshot</button></div>
        {snaps.length === 0 ? <div style={{ padding: "40px 0", textAlign: "center", color: colors.textDim, fontSize: "13px" }}>No snapshots yet.</div> : <>
          <PortfolioChart
            history={snaps.map(s => ({ date: s.date, value: s.netWorth }))}
            title="Net Worth"
          />
          {snaps.length >= 2 && <div style={{ marginTop: "20px" }}>
            <MultiLineChart
              history={snaps.map(s => ({ date: s.date, items: { liquid: s.liquidNW, illiquid: s.illiquidNW, liabilities: s.liabilities } }))}
              items={[
                { key: "liquid", label: "Liquid Assets" },
                { key: "illiquid", label: "Illiquid Assets" },
                { key: "liabilities", label: "Liabilities" },
              ]}
              title="Breakdown"
            />
          </div>}
          <table style={{ ...s.table, marginTop: "16px" }}><thead><tr><th style={s.th}>Date</th><th style={s.th}>Net Worth</th><th style={s.th}>Liquid</th><th style={s.th}>Illiquid</th><th style={s.th}>Liabilities</th><th style={s.th}>Phase</th><th style={s.th}></th></tr></thead>
          <tbody>{snaps.slice().reverse().map((snap, i) => <tr key={i}><td style={s.td}>{snap.date}</td><td style={s.td}>{fmt(snap.netWorth)}</td><td style={{ ...s.td, color: colors.green }}>{fmt(snap.liquidNW)}</td><td style={{ ...s.td, color: colors.yellow }}>{fmt(snap.illiquidNW)}</td><td style={{ ...s.td, color: colors.red }}>{fmt(snap.liabilities)}</td><td style={s.td}>{snap.phase}</td><td style={s.td}><button style={s.btnDanger} onClick={() => { const n = [...data.snapshots]; n.splice(data.snapshots.length - 1 - i, 1); update("snapshots", n); }}>×</button></td></tr>)}</tbody></table>
        </>}
      </div>
    );
  };

  const activePhaseForStrip = data.phases.find(p => p.status === "active");
  const phaseProgressPct = activePhaseForStrip && activePhaseForStrip.target > 0 ? (activePhaseForStrip.current / activePhaseForStrip.target * 100) : 0;

  // Portfolio today from daily movers
  let portfolioTodayAmt = 0, portfolioTodayPct = 0;
  data.crypto.forEach(c => {
    if (c.quantity > 0 && c.dailyChangePct != null) {
      const val = c.quantity * c.currentPrice;
      const prevVal = val / (1 + c.dailyChangePct / 100);
      portfolioTodayAmt += toEur(val - prevVal, "USD", rate, data.settings.eurToUsd);
    }
  });
  (data.equityAccounts || []).forEach(acct => acct.stocks.forEach(st => {
    if (st.quantity > 0 && st.dailyChangePct != null) {
      const val = st.quantity * st.currentPrice;
      const prevVal = val / (1 + st.dailyChangePct / 100);
      portfolioTodayAmt += toEur(val - prevVal, st.currency, rate);
    }
  }));
  data.mutualFunds.forEach(f => {
    if (f.units > 0 && f.dailyChangePct != null) {
      const val = f.units * f.currentPrice;
      const prevVal = val / (1 + f.dailyChangePct / 100);
      portfolioTodayAmt += toEur(val - prevVal, f.currency, rate);
    }
  });
  portfolioTodayPct = calc.grossAssets > 0 ? (portfolioTodayAmt / (calc.grossAssets - portfolioTodayAmt)) * 100 : 0;

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

  return (
    <div style={s.page}>
      {/* Top Strip */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, margin: "-20px -24px 16px -24px", padding: "10px 24px", background: "#000", borderBottom: `1px solid ${colors.border}`, fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px", color: colors.textDim, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontWeight: 700, color: colors.text, letterSpacing: "-0.01em" }}>FIN.CMD</span>
          <span>{timeStr} · {dateStr}</span>
          <span style={{ color: colors.accent }}>● LIVE · FX 1 EUR = {data.settings.eurToInr?.toFixed(2)} INR</span>
        </div>
        <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center" }}>
          <span>PORTF TODAY <span style={{ color: portfolioTodayAmt >= 0 ? colors.green : colors.red }}>{portfolioTodayAmt >= 0 ? "+" : ""}{portfolioTodayPct.toFixed(2)}%</span></span>
          {activePhaseForStrip && <span>PHASE {activePhaseForStrip.id} · {phaseProgressPct.toFixed(0)}%</span>}
          <span>NW <span style={{ color: colors.text }}>{fmt(calc.netWorth)}</span></span>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: "flex", borderBottom: `1px solid ${colors.border}`, marginBottom: "20px", gap: "4px", flexWrap: "wrap" }}>
        {tabs.map(t => <button key={t.key} style={s.tab(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      {tab === "overview" && renderOverview()}
      {tab === "income" && renderIncome()}
      {tab === "portfolio" && renderPortfolio()}
      {tab === "invest" && renderInvest()}
      {tab === "liabilities" && renderLiabilities()}
      {tab === "history" && renderHistory()}

      {/* Bottom Action Bar */}
      <div style={{ marginTop: "40px", padding: "12px 0", borderTop: `1px solid ${colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px", color: colors.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", gap: "20px" }}>
          <span>FX · {data.settings.eurToInr?.toFixed(2)} INR</span>
          {data.settings.lastUpdated && <span>LAST SAVED · {new Date(data.settings.lastUpdated).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase()}</span>}
        </div>
        <div style={{ position: "relative", display: "flex", gap: "8px" }}>
          <button style={{ ...s.btn, padding: "6px 12px" }} onClick={refreshPrices} disabled={refreshing}>{refreshing ? "⏳ REFRESHING..." : "↻ REFRESH"}</button>
          <button style={s.btnOutline} onClick={takeSnapshot}>📸 SNAPSHOT</button>
          <div style={{ position: "relative" }}>
            <button style={s.btnOutline} onClick={() => setShowSettingsMenu(!showSettingsMenu)}>⚙ SETTINGS ▾</button>
            {showSettingsMenu && <div style={{ position: "absolute", bottom: "100%", right: 0, marginBottom: "4px", background: colors.card, border: `1px solid ${colors.border}`, padding: "4px", zIndex: 10, display: "flex", flexDirection: "column", gap: "2px", minWidth: "180px" }}>
              <button style={{ ...s.btnOutline, textAlign: "left", border: "none", padding: "6px 10px" }} onClick={() => { setShowPriceSetup(!showPriceSetup); setShowSettingsMenu(false); }}>⚙ PRICE FEED SETUP</button>
              <button style={{ ...s.btnOutline, textAlign: "left", border: "none", padding: "6px 10px" }} onClick={() => { exportData(); setShowSettingsMenu(false); }}>💾 EXPORT DATA</button>
              <button style={{ ...s.btnOutline, textAlign: "left", border: "none", padding: "6px 10px" }} onClick={() => { importData(); setShowSettingsMenu(false); }}>📂 IMPORT DATA</button>
              <div style={{ borderTop: `1px solid ${colors.border}`, margin: "4px 0" }} />
              <button style={{ ...s.btnDanger, textAlign: "left", border: "none", padding: "6px 10px", background: "transparent" }} onClick={() => { if (confirm("Reset all data?")) save(defaultData); setShowSettingsMenu(false); }}>RESET ALL DATA</button>
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
