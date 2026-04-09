import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchCryptoPrices, fetchHyperliquidPrices, fetchAllMFNavs, fetchEquityPricesFromSheet, generateSheetTemplate, fetchExchangeRates } from "./priceService.js";
import PortfolioChart, { MultiLineChart } from "./PortfolioChart.jsx";

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
    { id: uid(), name: "PPFAS Flexi Cap", units: 0, costPrice: 0, currentPrice: 0, currency: "INR", liquid: true, schemeCode: "122639" },
    { id: uid(), name: "PPFAS Niece", units: 0, costPrice: 0, currentPrice: 0, currency: "INR", liquid: false, schemeCode: "122639" },
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
    { id: uid(), name: "EUR Buffer", amount: 1444, currency: "EUR", phase: 2 },
    { id: uid(), name: "COPX SIP", amount: 150, currency: "EUR", phase: 2 },
  ],
  liabilities: [
    { id: uid(), name: "Personal Loan", totalAmount: 0, interestRate: 4.7, monthlyEMI: 0, startDate: "", tenureMonths: 0, currency: "EUR" },
  ],
  snapshots: [],
  priceHistory: [],
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

const calcAmortization = (principal, annualRate, tenureMonths, monthsElapsed) => {
  if (!principal || !annualRate || !tenureMonths || tenureMonths <= 0) return { remainingPrincipal: principal || 0, remainingInterest: 0, totalInterest: 0 };
  const r = annualRate / 100 / 12;
  const n = tenureMonths;
  const k = Math.min(Math.max(0, monthsElapsed), n);
  if (r === 0) return { remainingPrincipal: principal - (principal / n) * k, remainingInterest: 0, totalInterest: 0 };
  const emi = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  const rp = principal * (Math.pow(1 + r, n) - Math.pow(1 + r, k)) / (Math.pow(1 + r, n) - 1);
  const ri = (emi * (n - k)) - rp;
  const totalInterest = (emi * n) - principal;
  return { remainingPrincipal: Math.max(0, rp), remainingInterest: Math.max(0, ri), totalInterest: Math.max(0, totalInterest), emi };
};

const getMonthsElapsed = (startDate) => {
  if (!startDate) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(startDate)) / (30.44 * 24 * 60 * 60 * 1000)));
};

const colors = {
  bg: "#0f1119", card: "#181b27", cardAlt: "#1e2235", border: "#2a2e42",
  accent: "#22c997", accentDim: "#1a9e78", red: "#ef4444", yellow: "#eab308",
  text: "#e2e5f0", textDim: "#8b90a5", textMuted: "#5a5f75",
  green: "#22c997", greenBg: "rgba(34,201,151,0.1)", redBg: "rgba(239,68,68,0.1)",
};

const s = {
  page: { fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace", background: colors.bg, color: colors.text, minHeight: "100vh", padding: "20px" },
  h1: { fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px", margin: 0, color: colors.text },
  h2: { fontSize: "15px", fontWeight: 600, margin: "0 0 12px 0", color: colors.text, letterSpacing: "-0.3px" },
  h3: { fontSize: "12px", fontWeight: 600, color: colors.textDim, textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 8px 0" },
  card: { background: colors.card, borderRadius: "10px", padding: "18px", border: `1px solid ${colors.border}` },
  tab: (a) => ({ padding: "8px 16px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "inherit", background: a ? colors.accent : "transparent", color: a ? colors.bg : colors.textDim, transition: "all 0.2s" }),
  btn: { padding: "6px 14px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "11px", fontWeight: 600, fontFamily: "inherit", background: colors.accent, color: colors.bg },
  btnOutline: { padding: "6px 14px", borderRadius: "6px", border: `1px solid ${colors.accent}`, cursor: "pointer", fontSize: "11px", fontWeight: 600, fontFamily: "inherit", background: "transparent", color: colors.accent },
  btnDanger: { padding: "4px 10px", borderRadius: "4px", border: "none", cursor: "pointer", fontSize: "10px", fontWeight: 600, fontFamily: "inherit", background: colors.redBg, color: colors.red },
  input: { padding: "6px 10px", borderRadius: "5px", border: `1px solid ${colors.border}`, background: colors.cardAlt, color: colors.text, fontSize: "12px", fontFamily: "inherit", outline: "none", width: "100%" },
  select: { padding: "6px 10px", borderRadius: "5px", border: `1px solid ${colors.border}`, background: colors.cardAlt, color: colors.text, fontSize: "12px", fontFamily: "inherit", outline: "none" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "12px" },
  th: { textAlign: "left", padding: "8px 10px", color: colors.textDim, fontWeight: 600, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}` },
  td: { padding: "8px 10px", borderBottom: `1px solid ${colors.border}20`, verticalAlign: "middle" },
  badge: (c) => ({ display: "inline-block", padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 600, background: c === "green" ? colors.greenBg : c === "red" ? colors.redBg : `${colors.yellow}15`, color: c === "green" ? colors.green : c === "red" ? colors.red : colors.yellow }),
  liqBadge: (l) => ({ display: "inline-block", padding: "2px 6px", borderRadius: "3px", fontSize: "9px", fontWeight: 700, cursor: "pointer", background: l ? colors.greenBg : `${colors.yellow}15`, color: l ? colors.green : colors.yellow, border: "none", fontFamily: "inherit" }),
  bigNum: { fontSize: "28px", fontWeight: 700, letterSpacing: "-1px", color: colors.text },
  progressBar: { height: "8px", borderRadius: "4px", background: colors.cardAlt, overflow: "hidden", width: "100%" },
  progressFill: (p, c = colors.accent) => ({ height: "100%", borderRadius: "4px", background: c, width: `${Math.min(100, p)}%`, transition: "width 0.5s ease" }),
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" },
  flex: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  flexG: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
};

const ECell = ({ value, onChange, type = "text", style = {} }) => {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!editing) return (
    <span style={{ cursor: "pointer", borderBottom: `1px dashed ${colors.border}`, ...style }}
      onClick={() => setEditing(true)}>
      {type === "number" ? Number(v).toLocaleString() : v || "—"}
    </span>
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

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [subTab, setSubTab] = useState("mf");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = storage.get(STORE_KEY);
    setData(saved ? { ...defaultData, ...saved } : defaultData);
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
      const amort = calcAmortization(l.totalAmount, l.interestRate, l.tenureMonths, getMonthsElapsed(l.startDate));
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
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

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
      (acct.stocks || []).forEach(st => {
        const val = toEur(st.quantity * st.currentPrice, st.currency, histRate, histUsdRate);
        eqTotal += val;
        if (st.quantity > 0) histEntry.items[`eq_${st.id}`] = val;
      });
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
      const amort = calcAmortization(l.totalAmount, l.interestRate, l.tenureMonths, getMonthsElapsed(l.startDate));
      histLiab += toEur(amort.remainingPrincipal, l.currency, histRate, histUsdRate);
    });
    histEntry.liabilities = histLiab;
    histEntry.grossAssets = mfTotal + eqTotal + cashTotal + cryptoTotal + reTotal + esopTotal;
    histEntry.netWorth = histEntry.grossAssets - histLiab;

    // Keep max 365 entries to avoid localStorage bloat
    const history = [...(updated.priceHistory || []), histEntry].slice(-365);
    updated.priceHistory = history;

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
  const renderOverview = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={s.card}>
        <div style={s.flex}>
          <div><div style={s.h3}>Net Worth</div><div style={s.bigNum}>{fmtBoth(calc.netWorth, rate)}</div></div>
          <div style={{ textAlign: "right" }}>
            <div style={s.h3}>Exchange Rate</div>
            <div style={s.flexG}>
              <span style={{ fontSize: "12px", color: colors.textDim }}>1 EUR =</span>
              <ECell value={data.settings.eurToInr} type="number" onChange={v => update("settings", { ...data.settings, eurToInr: v })} />
              <span style={{ fontSize: "12px", color: colors.textDim }}>INR</span>
              <button style={{ ...s.btnOutline, padding: "3px 8px", fontSize: "9px" }} onClick={async () => {
                const rates = await fetchExchangeRates();
                if (rates.eurToInr) update("settings", { ...data.settings, eurToInr: rates.eurToInr, eurToUsd: rates.eurToUsd || data.settings.eurToUsd });
              }}>↻ Live</button>
            </div>
          </div>
        </div>
      </div>
      {(data.priceHistory || []).length >= 2 && <div style={s.card}>
        <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.netWorth || 0 }))} title="Net Worth" height={160} />
      </div>}
      <div style={s.grid3}>
        <div style={s.card}><div style={s.h3}>Liquid Assets</div><div style={{ fontSize: "20px", fontWeight: 700, color: colors.green }}>{fmt(calc.liquidNW)}</div><div style={{ fontSize: "11px", color: colors.textDim }}>{fmt(calc.liquidNW * rate, "INR")}</div></div>
        <div style={s.card}><div style={s.h3}>Illiquid Assets</div><div style={{ fontSize: "20px", fontWeight: 700, color: colors.yellow }}>{fmt(calc.illiquidNW)}</div><div style={{ fontSize: "11px", color: colors.textDim }}>{fmt(calc.illiquidNW * rate, "INR")}</div></div>
        <div style={s.card}><div style={s.h3}>Total Liabilities</div><div style={{ fontSize: "20px", fontWeight: 700, color: colors.red }}>{fmt(calc.totalLiabEur)}</div><div style={{ fontSize: "11px", color: colors.textDim }}>{fmt(calc.totalLiabEur * rate, "INR")}</div></div>
      </div>

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
            <div style={s.flex}>
              <div style={s.h2}>Daily Movers</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "11px", color: colors.textDim }}>Portfolio Today:</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: totalDayChange >= 0 ? colors.green : colors.red }}>
                  {totalDayChange >= 0 ? "+" : ""}{fmt(totalDayChange)} ({totalDayPct >= 0 ? "+" : ""}{totalDayPct.toFixed(2)}%)
                </span>
              </div>
            </div>

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
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: "14px", marginBottom: "8px" }}>Equity & MFs</div>
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
          </div>
        );
      })()}

      <div style={s.card}>
        <div style={s.h2}>Asset Breakdown</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {[{ label: "Mutual Funds / ETFs", val: calc.mfValue.total, color: "#6366f1" }, { label: "Equity", val: calc.eqValue.total, color: "#8b5cf6" }, { label: "Cash", val: calc.cashValue.total, color: colors.green }, { label: "Crypto", val: calc.cryptoValue.total, color: "#f59e0b" }, { label: "Real Estate", val: calc.propValue.total, color: "#3b82f6" }, { label: "ESOPs", val: calc.esopValue.total, color: "#ec4899" }].filter(x => x.val > 0).map(x => (
            <div key={x.label} style={{ padding: "8px 14px", borderRadius: "8px", background: `${x.color}15`, border: `1px solid ${x.color}30`, flex: "1", minWidth: "120px" }}>
              <div style={{ fontSize: "10px", color: x.color, fontWeight: 600, marginBottom: "4px" }}>{x.label}</div>
              <div style={{ fontSize: "15px", fontWeight: 700 }}>{fmt(x.val)}</div>
              <div style={{ fontSize: "10px", color: colors.textDim }}>{calc.grossAssets > 0 ? (x.val / calc.grossAssets * 100).toFixed(1) : 0}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Phase Progress */}
      <div style={s.card}>
        <div style={s.flex}>
          <div style={s.h2}>Phase Progress</div>
          <div style={s.flexG}>
            {hasNextPhase && <button style={s.btn} onClick={() => { if (confirm(`Complete Phase ${activePhase.id} and move to Phase ${data.phases[activePhaseIdx + 1].id}?`)) moveToNextPhase(); }}>→ Next Phase</button>}
            <button style={s.btnOutline} onClick={addPhase}>+ Add Phase</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "10px" }}>
          {data.phases.map(p => {
            const prog = pct(p.current, p.target); const isA = p.status === "active"; const isD = p.status === "complete";
            return (
              <div key={p.id} style={{ padding: "12px", borderRadius: "8px", background: isA ? colors.greenBg : isD ? `${colors.green}08` : colors.cardAlt, border: isA ? `1px solid ${colors.green}30` : `1px solid ${colors.border}` }}>
                <div style={s.flex}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={s.badge(isD ? "green" : isA ? "yellow" : "red")}>{isD ? "✓ Done" : isA ? "Active" : "Locked"}</span>
                    <span style={{ fontSize: "11px", color: colors.textMuted }}>Phase {p.id}:</span>
                    <ECell value={p.name} onChange={v => updatePhase(p.id, "name", v)} style={{ fontSize: "13px", fontWeight: 600 }} />
                  </div>
                  <div style={s.flexG}>
                    {p.target > 0 && <span style={{ fontSize: "12px", color: colors.textDim }}>
                      <ECell value={p.current} type="number" onChange={v => updatePhase(p.id, "current", v)} /> / <ECell value={p.target} type="number" onChange={v => updatePhase(p.id, "target", v)} style={{ color: colors.textDim }} /> {p.currency}
                    </span>}
                    {p.target === 0 && <span style={{ fontSize: "11px", color: colors.textMuted }}>Target: <ECell value={p.target} type="number" onChange={v => updatePhase(p.id, "target", v)} /></span>}
                    {p.status !== "active" && <button style={s.btnDanger} onClick={() => { if (confirm(`Delete Phase ${p.id}?`)) removePhase(p.id); }}>×</button>}
                  </div>
                </div>
                {p.target > 0 && <div style={{ marginTop: "8px" }}><div style={s.progressBar}><div style={s.progressFill(prog)} /></div><div style={{ fontSize: "10px", color: colors.textDim, marginTop: "4px" }}>{prog.toFixed(1)}%</div></div>}
                {/* Milestones */}
                <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  {(p.milestones || []).map((m, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", padding: "3px 8px", borderRadius: "4px", background: p.current >= m.amount ? colors.greenBg : colors.cardAlt, color: p.current >= m.amount ? colors.green : colors.textDim }}>
                      {p.current >= m.amount ? "✓" : "○"}
                      <ECell value={m.amount} type="number" onChange={v => updateMilestone(p.id, i, "amount", v)} style={{ fontSize: "10px" }} />
                      <span>—</span>
                      <ECell value={m.name} onChange={v => updateMilestone(p.id, i, "name", v)} style={{ fontSize: "10px" }} />
                      <button style={{ ...s.btnDanger, padding: "1px 4px", fontSize: "8px" }} onClick={() => removeMilestone(p.id, i)}>×</button>
                    </div>
                  ))}
                  <button style={{ ...s.btnOutline, padding: "2px 8px", fontSize: "9px" }} onClick={() => addMilestone(p.id)}>+ milestone</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={s.card}>
        <div style={s.h2}>Monthly Flow</div>
        <div style={s.grid3}>
          <div><div style={{ fontSize: "10px", color: colors.textDim, marginBottom: "4px" }}>Total Income</div><div style={{ fontSize: "18px", fontWeight: 700, color: colors.green }}>{fmt(calc.totalIncomeEur)}</div></div>
          <div><div style={{ fontSize: "10px", color: colors.textDim, marginBottom: "4px" }}>Expenses + SIPs</div><div style={{ fontSize: "18px", fontWeight: 700, color: colors.red }}>{fmt(calc.totalFixedEur + calc.totalSipsEur)}</div></div>
          <div><div style={{ fontSize: "10px", color: colors.textDim, marginBottom: "4px" }}>Available Surplus</div><div style={{ fontSize: "18px", fontWeight: 700, color: colors.accent }}>{fmt(calc.surplus)}</div><div style={{ fontSize: "10px", color: colors.textDim }}>Allocated: {fmt(calc.totalAllocEur)} · Free: {fmt(calc.unallocated)}</div></div>
        </div>
      </div>
      <div style={{ ...s.flexG, justifyContent: "flex-end" }}>
        <button style={{ ...s.btn, background: "#6366f1" }} onClick={refreshPrices} disabled={refreshing}>
          {refreshing ? "⏳ Refreshing..." : "🔄 Refresh Prices"}
        </button>
        <button style={s.btnOutline} onClick={() => setShowPriceSetup(!showPriceSetup)}>⚙ Price Feed Setup</button>
        <button style={s.btnOutline} onClick={importData}>📂 Import</button>
        <button style={s.btnOutline} onClick={exportData}>💾 Export</button>
        <button style={s.btn} onClick={takeSnapshot}>📸 Save Snapshot</button>
        <button style={s.btnDanger} onClick={() => { if (confirm("Reset all data?")) save(defaultData); }}>Reset All</button>
      </div>
      {refreshMsg && <div style={{ padding: "8px 14px", borderRadius: "6px", background: `${colors.accent}15`, border: `1px solid ${colors.accent}30`, fontSize: "11px", color: colors.accent }}>{refreshMsg}</div>}

      {showPriceSetup && <div style={s.card}>
        <div style={s.h2}>Price Feed Setup</div>

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

  // ─── INCOME & EXPENSES ───
  const renderIncome = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={s.card}>
        <div style={s.flex}><div style={s.h2}>Income</div><button style={s.btn} onClick={() => addItem("income", { name: "New", amount: 0, currency: "EUR", frequency: "monthly" })}>+ Add</button></div>
        <table style={s.table}><thead><tr><th style={s.th}>Source</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>Freq</th><th style={s.th}>EUR/mo</th><th style={s.th}></th></tr></thead>
        <tbody>{data.income.map(i => <tr key={i.id}><td style={s.td}><ECell value={i.name} onChange={v => updateItem("income", i.id, "name", v)} /></td><td style={s.td}><ECell value={i.amount} type="number" onChange={v => updateItem("income", i.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={i.currency} onChange={v => updateItem("income", i.id, "currency", v)} /></td><td style={s.td}><select style={s.select} value={i.frequency} onChange={e => updateItem("income", i.id, "frequency", e.target.value)}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></td><td style={s.td}>{fmt(toEur(i.frequency === "annual" ? i.amount / 12 : i.amount, i.currency, rate))}</td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("income", i.id)}>×</button></td></tr>)}</tbody></table>
        <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.totalIncomeEur, rate)}/mo</div>
      </div>
      <div style={s.card}>
        <div style={s.flex}><div style={s.h2}>Fixed Expenses</div><button style={s.btn} onClick={() => addItem("fixedExpenses", { name: "New", amount: 0, currency: "EUR", frequency: "monthly" })}>+ Add</button></div>
        <table style={s.table}><thead><tr><th style={s.th}>Item</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>Freq</th><th style={s.th}>EUR/mo</th><th style={s.th}></th></tr></thead>
        <tbody>{data.fixedExpenses.map(e => <tr key={e.id}><td style={s.td}><ECell value={e.name} onChange={v => updateItem("fixedExpenses", e.id, "name", v)} /></td><td style={s.td}><ECell value={e.amount} type="number" onChange={v => updateItem("fixedExpenses", e.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={e.currency} onChange={v => updateItem("fixedExpenses", e.id, "currency", v)} /></td><td style={s.td}><select style={s.select} value={e.frequency} onChange={ev => updateItem("fixedExpenses", e.id, "frequency", ev.target.value)}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></td><td style={s.td}>{fmt(toEur(e.frequency === "annual" ? e.amount / 12 : e.amount, e.currency, rate))}</td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("fixedExpenses", e.id)}>×</button></td></tr>)}</tbody></table>
        <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.totalFixedEur, rate)}/mo</div>
      </div>
      <div style={s.card}>
        <div style={s.flex}><div style={s.h2}>One-off Expenses</div><button style={s.btn} onClick={() => addItem("oneOffExpenses", { name: "Expense", amount: 0, currency: "EUR", date: new Date().toISOString().slice(0, 10) })}>+ Add</button></div>
        {data.oneOffExpenses.length === 0 ? <div style={{ fontSize: "12px", color: colors.textDim, padding: "12px 0" }}>No one-off expenses</div> :
        <table style={s.table}><thead><tr><th style={s.th}>Item</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>Date</th><th style={s.th}></th></tr></thead>
        <tbody>{data.oneOffExpenses.map(e => <tr key={e.id}><td style={s.td}><ECell value={e.name} onChange={v => updateItem("oneOffExpenses", e.id, "name", v)} /></td><td style={s.td}><ECell value={e.amount} type="number" onChange={v => updateItem("oneOffExpenses", e.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={e.currency} onChange={v => updateItem("oneOffExpenses", e.id, "currency", v)} /></td><td style={s.td}><input type="date" style={s.input} value={e.date} onChange={ev => updateItem("oneOffExpenses", e.id, "date", ev.target.value)} /></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("oneOffExpenses", e.id)}>×</button></td></tr>)}</tbody></table>}
      </div>
    </div>
  );

  // ─── PORTFOLIO ───
  const renderPortfolio = () => {
    const subTabs = [{ key: "mf", label: "MFs / ETFs" }, { key: "eq", label: "Equity" }, { key: "cash", label: "Cash & Savings" }, { key: "crypto", label: "Crypto" }, { key: "re", label: "Real Estate" }, { key: "esop", label: "ESOPs" }];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={s.flexG}>{subTabs.map(t => <button key={t.key} style={s.tab(subTab === t.key)} onClick={() => setSubTab(t.key)}>{t.label}</button>)}</div>

        {subTab === "mf" && <div style={s.card}>
          <div style={s.flex}><div style={s.h2}>Mutual Funds / ETFs</div><button style={s.btn} onClick={() => addItem("mutualFunds", { name: "New Fund", units: 0, costPrice: 0, currentPrice: 0, currency: "INR", liquid: true })}>+ Add</button></div>
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
          <div style={{ overflowX: "auto" }}><table style={s.table}><thead><tr><th style={s.th}>Fund</th><th style={s.th}>Curr</th><th style={s.th}>Units</th><th style={s.th}>Cost/Unit</th><th style={s.th}>Current</th><th style={s.th}>Invested</th><th style={s.th}>Value</th><th style={s.th}>P/L</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.mutualFunds.map(f => {
            const inv = f.units * f.costPrice, cur = f.units * f.currentPrice, pl = cur - inv, plP = inv > 0 ? (pl / inv * 100) : 0;
            return <tr key={f.id}><td style={s.td}><ECell value={f.name} onChange={v => updateItem("mutualFunds", f.id, "name", v)} /></td><td style={s.td}><CurrSelect value={f.currency} onChange={v => updateItem("mutualFunds", f.id, "currency", v)} /></td><td style={s.td}><ECell value={f.units} type="number" onChange={v => updateItem("mutualFunds", f.id, "units", v)} /></td><td style={s.td}><ECell value={f.costPrice} type="number" onChange={v => updateItem("mutualFunds", f.id, "costPrice", v)} /></td><td style={s.td}><ECell value={f.currentPrice} type="number" onChange={v => updateItem("mutualFunds", f.id, "currentPrice", v)} /></td><td style={s.td}>{fmt(inv, f.currency)}</td><td style={s.td}>{fmt(cur, f.currency)}</td><td style={s.td}><span style={{ color: pl >= 0 ? colors.green : colors.red }}>{fmt(pl, f.currency)} ({plP.toFixed(1)}%)</span></td><td style={s.td}><button style={s.liqBadge(f.liquid)} onClick={() => updateItem("mutualFunds", f.id, "liquid", !f.liquid)}>{f.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("mutualFunds", f.id)}>×</button></td></tr>;
          })}</tbody></table></div>
          <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.mfValue.total, rate)}</div>
        </div>}

        {subTab === "eq" && <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {(data.priceHistory || []).length >= 2 && <div style={s.card}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.eqTotal || 0 }))} title="Equity Total" color="#8b5cf6" />
          </div>}
          <div style={s.flex}><div style={s.h2}>Equity Accounts</div><button style={s.btn} onClick={() => addItem("equityAccounts", { name: "New Account", currency: "INR", stocks: [] })}>+ Add Account</button></div>
          {(data.equityAccounts || []).map(acct => {
            const acctCurrency = acct.currency || "INR";
            const acctNativeTotal = acct.stocks.reduce((s, st) => s + st.quantity * st.currentPrice, 0);
            const acctNativeInvested = acct.stocks.reduce((s, st) => s + st.quantity * st.costPrice, 0);
            const acctNativePL = acctNativeTotal - acctNativeInvested;
            const acctEurTotal = acct.stocks.reduce((s, st) => s + toEur(st.quantity * st.currentPrice, st.currency, rate, data.settings.eurToUsd || 1.08), 0);
            return (
            <div key={acct.id} style={s.card}>
              <div style={s.flex}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: "4px", height: "24px", borderRadius: "2px", background: colors.accent }} />
                  <ECell value={acct.name} onChange={v => update("equityAccounts", data.equityAccounts.map(a => a.id === acct.id ? { ...a, name: v } : a))} style={{ fontSize: "14px", fontWeight: 600 }} />
                  <CurrSelect value={acctCurrency} onChange={v => {
                    const accts = data.equityAccounts.map(a => a.id === acct.id ? { ...a, currency: v, stocks: a.stocks.map(st => ({ ...st, currency: v })) } : a);
                    update("equityAccounts", accts);
                  }} />
                  <span style={{ fontSize: "11px", color: colors.textDim }}>({acct.stocks.length})</span>
                </div>
                <div style={s.flexG}>
                  <button style={s.btn} onClick={() => addStockToAccount(acct.id)}>+ Stock</button>
                  <button style={s.btnDanger} onClick={() => { if (confirm(`Delete "${acct.name}"?`)) removeItem("equityAccounts", acct.id); }}>Delete</button>
                </div>
              </div>
              {acct.stocks.length === 0 ? <div style={{ fontSize: "12px", color: colors.textDim, padding: "12px 0 0 14px" }}>No stocks</div> :
              <div style={{ overflowX: "auto", marginTop: "10px" }}><table style={s.table}><thead><tr><th style={s.th}>Stock</th><th style={s.th}>Qty</th><th style={s.th}>Cost</th><th style={s.th}>Current</th><th style={s.th}>Invested</th><th style={s.th}>Value</th><th style={s.th}>P/L</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
              <tbody>{acct.stocks.map(st => {
                const inv = st.quantity * st.costPrice, cur = st.quantity * st.currentPrice, pl = cur - inv, plP = inv > 0 ? (pl / inv * 100) : 0;
                return <tr key={st.id}><td style={s.td}><ECell value={st.name} onChange={v => updateStock(acct.id, st.id, "name", v)} /></td><td style={s.td}><ECell value={st.quantity} type="number" onChange={v => updateStock(acct.id, st.id, "quantity", v)} /></td><td style={s.td}><ECell value={st.costPrice} type="number" onChange={v => updateStock(acct.id, st.id, "costPrice", v)} /></td><td style={s.td}><ECell value={st.currentPrice} type="number" onChange={v => updateStock(acct.id, st.id, "currentPrice", v)} /></td><td style={s.td}>{fmt(inv, st.currency)}</td><td style={s.td}>{fmt(cur, st.currency)}</td><td style={s.td}><span style={{ color: pl >= 0 ? colors.green : colors.red }}>{fmt(pl, st.currency)} ({plP.toFixed(1)}%)</span></td><td style={s.td}><button style={s.liqBadge(st.liquid)} onClick={() => updateStock(acct.id, st.id, "liquid", !st.liquid)}>{st.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeStock(acct.id, st.id)}>×</button></td></tr>;
              })}</tbody></table></div>}
              {acct.stocks.length > 0 && <div style={{ marginTop: "8px", display: "flex", justifyContent: "flex-end", gap: "16px", fontSize: "12px", fontWeight: 600 }}>
                <span style={{ color: colors.textDim }}>Invested: {fmt(acctNativeInvested, acctCurrency)}</span>
                <span style={{ color: colors.textDim }}>Value: {fmt(acctNativeTotal, acctCurrency)}{acctCurrency !== "EUR" && <span style={{ fontSize: "10px" }}> ({fmt(acctEurTotal)})</span>}</span>
                <span style={{ color: acctNativePL >= 0 ? colors.green : colors.red }}>P/L: {fmt(acctNativePL, acctCurrency)} ({acctNativeInvested > 0 ? (acctNativePL / acctNativeInvested * 100).toFixed(1) : 0}%)</span>
              </div>}
            </div>
            );
          })}
          <div style={{ fontSize: "13px", fontWeight: 600, textAlign: "right" }}>All Equity: {fmtBoth(calc.eqValue.total, rate)}</div>
        </div>}

        {subTab === "cash" && <div style={s.card}>
          <div style={s.flex}><div style={s.h2}>Cash & Savings</div><button style={s.btn} onClick={() => addItem("cashSavings", { name: "New", type: "Bank", amount: 0, currency: "EUR", liquid: true })}>+ Add</button></div>
          {(data.priceHistory || []).length >= 2 && <div style={{ marginBottom: "14px" }}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.cashTotal || 0 }))} title="Cash & Savings Total" color="#22c997" />
          </div>}
          <table style={s.table}><thead><tr><th style={s.th}>Account</th><th style={s.th}>Type</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>EUR</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.cashSavings.map(c => <tr key={c.id}><td style={s.td}><ECell value={c.name} onChange={v => updateItem("cashSavings", c.id, "name", v)} /></td><td style={s.td}><select style={s.select} value={c.type} onChange={e => updateItem("cashSavings", c.id, "type", e.target.value)}><option>Bank</option><option>FD</option><option>RD</option><option>Other</option></select></td><td style={s.td}><ECell value={c.amount} type="number" onChange={v => updateItem("cashSavings", c.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={c.currency} onChange={v => updateItem("cashSavings", c.id, "currency", v)} /></td><td style={s.td}>{fmt(toEur(c.amount, c.currency, rate))}</td><td style={s.td}><button style={s.liqBadge(c.liquid)} onClick={() => updateItem("cashSavings", c.id, "liquid", !c.liquid)}>{c.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("cashSavings", c.id)}>×</button></td></tr>)}</tbody></table>
          <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.cashValue.total, rate)}</div>
        </div>}

        {subTab === "crypto" && <div style={s.card}>
          <div style={s.flex}><div style={s.h2}>Crypto</div><button style={s.btn} onClick={() => addItem("crypto", { name: "Token", quantity: 0, costPrice: 0, currentPrice: 0, currency: "USD", liquid: true })}>+ Add</button></div>
          {(data.priceHistory || []).length >= 2 && <div style={{ marginBottom: "14px" }}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.cryptoTotal || 0 }))} title="Crypto Total" color="#f59e0b" />
          </div>}
          <div style={{ overflowX: "auto" }}><table style={s.table}><thead><tr><th style={s.th}>Token</th><th style={s.th}>Qty</th><th style={s.th}>Cost</th><th style={s.th}>Current</th><th style={s.th}>Invested</th><th style={s.th}>Value</th><th style={s.th}>P/L</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.crypto.map(c => {
            const inv = c.quantity * c.costPrice, cur = c.quantity * c.currentPrice, pl = cur - inv, plP = inv > 0 ? (pl / inv * 100) : 0;
            return <tr key={c.id}><td style={s.td}><ECell value={c.name} onChange={v => updateItem("crypto", c.id, "name", v)} /></td><td style={s.td}><ECell value={c.quantity} type="number" onChange={v => updateItem("crypto", c.id, "quantity", v)} /></td><td style={s.td}><ECell value={c.costPrice} type="number" onChange={v => updateItem("crypto", c.id, "costPrice", v)} /></td><td style={s.td}><ECell value={c.currentPrice} type="number" onChange={v => updateItem("crypto", c.id, "currentPrice", v)} /></td><td style={s.td}>{fmt(inv, c.currency)}</td><td style={s.td}>{fmt(cur, c.currency)}</td><td style={s.td}><span style={{ color: pl >= 0 ? colors.green : colors.red }}>{fmt(pl, c.currency)} ({plP.toFixed(1)}%)</span></td><td style={s.td}><button style={s.liqBadge(c.liquid)} onClick={() => updateItem("crypto", c.id, "liquid", !c.liquid)}>{c.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("crypto", c.id)}>×</button></td></tr>;
          })}</tbody></table></div>
          <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.cryptoValue.total, rate)}</div>
        </div>}

        {subTab === "re" && <div style={s.card}>
          <div style={s.flex}><div style={s.h2}>Real Estate</div><button style={s.btn} onClick={() => update("realEstate", [...(data.realEstate || []), { id: uid(), name: "Property", value: 0, currency: "INR", liquid: false }])}>+ Add</button></div>
          {(data.priceHistory || []).length >= 2 && (data.priceHistory || []).some(h => h.reTotal > 0) && <div style={{ marginBottom: "14px" }}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.reTotal || 0 }))} title="Real Estate Total" color="#3b82f6" />
          </div>}
          {(!data.realEstate || data.realEstate.length === 0) ? <div style={{ fontSize: "12px", color: colors.textDim, padding: "12px 0" }}>No real estate</div> :
          <table style={s.table}><thead><tr><th style={s.th}>Name</th><th style={s.th}>Value</th><th style={s.th}>Curr</th><th style={s.th}>EUR</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.realEstate.map(p => <tr key={p.id}><td style={s.td}><ECell value={p.name} onChange={v => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, name: v } : i))} /></td><td style={s.td}><ECell value={p.value} type="number" onChange={v => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, value: v } : i))} /></td><td style={s.td}><CurrSelect value={p.currency} onChange={v => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, currency: v } : i))} /></td><td style={s.td}>{fmt(toEur(p.value, p.currency, rate))}</td><td style={s.td}><button style={s.liqBadge(p.liquid)} onClick={() => update("realEstate", data.realEstate.map(i => i.id === p.id ? { ...i, liquid: !i.liquid } : i))}>{p.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => update("realEstate", data.realEstate.filter(i => i.id !== p.id))}>×</button></td></tr>)}</tbody></table>}
        </div>}

        {subTab === "esop" && <div style={s.card}>
          <div style={s.flex}><div style={s.h2}>ESOPs</div><button style={s.btn} onClick={() => addItem("esops", { company: "Company", strikePrice: 0, quantity: 0, currentPrice: 0, vestedQty: 0, unvestedQty: 0, currency: "EUR", liquid: false })}>+ Add</button></div>
          {(data.priceHistory || []).length >= 2 && (data.priceHistory || []).some(h => h.esopTotal > 0) && <div style={{ marginBottom: "14px" }}>
            <PortfolioChart history={(data.priceHistory || []).map(h => ({ date: h.date, value: h.esopTotal || 0 }))} title="ESOPs Total" color="#ec4899" />
          </div>}
          <div style={{ overflowX: "auto" }}><table style={s.table}><thead><tr><th style={s.th}>Company</th><th style={s.th}>Strike</th><th style={s.th}>Current</th><th style={s.th}>Total</th><th style={s.th}>Vested</th><th style={s.th}>Unvested</th><th style={s.th}>Vested Val</th><th style={s.th}>Unvested Val</th><th style={s.th}>Liq</th><th style={s.th}></th></tr></thead>
          <tbody>{data.esops.map(e => {
            const vv = Math.max(0, e.vestedQty * (e.currentPrice - e.strikePrice)), uv = Math.max(0, e.unvestedQty * (e.currentPrice - e.strikePrice));
            return <tr key={e.id}><td style={s.td}><ECell value={e.company} onChange={v => updateItem("esops", e.id, "company", v)} /></td><td style={s.td}><ECell value={e.strikePrice} type="number" onChange={v => updateItem("esops", e.id, "strikePrice", v)} /></td><td style={s.td}><ECell value={e.currentPrice} type="number" onChange={v => updateItem("esops", e.id, "currentPrice", v)} /></td><td style={s.td}><ECell value={e.quantity} type="number" onChange={v => updateItem("esops", e.id, "quantity", v)} /></td><td style={s.td}><ECell value={e.vestedQty} type="number" onChange={v => updateItem("esops", e.id, "vestedQty", v)} /></td><td style={s.td}><ECell value={e.unvestedQty} type="number" onChange={v => updateItem("esops", e.id, "unvestedQty", v)} /></td><td style={s.td}><span style={{ color: colors.green }}>{fmt(vv, e.currency)}</span></td><td style={s.td}><span style={{ color: colors.yellow }}>{fmt(uv, e.currency)}</span></td><td style={s.td}><button style={s.liqBadge(e.liquid)} onClick={() => updateItem("esops", e.id, "liquid", !e.liquid)}>{e.liquid ? "LIQ" : "ILLIQ"}</button></td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("esops", e.id)}>×</button></td></tr>;
          })}</tbody></table></div>
        </div>}
      </div>
    );
  };

  // ─── SIPs & ALLOCATION ───
  const renderInvest = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={s.card}>
        <div style={s.flex}><div style={s.h2}>Monthly SIPs</div><button style={s.btn} onClick={() => addItem("sips", { name: "New SIP", amount: 0, currency: "INR" })}>+ Add</button></div>
        <table style={s.table}><thead><tr><th style={s.th}>Investment</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>EUR/mo</th><th style={s.th}></th></tr></thead>
        <tbody>{data.sips.map(i => <tr key={i.id}><td style={s.td}><ECell value={i.name} onChange={v => updateItem("sips", i.id, "name", v)} /></td><td style={s.td}><ECell value={i.amount} type="number" onChange={v => updateItem("sips", i.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={i.currency} onChange={v => updateItem("sips", i.id, "currency", v)} /></td><td style={s.td}>{fmt(toEur(i.amount, i.currency, rate))}</td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("sips", i.id)}>×</button></td></tr>)}</tbody></table>
        <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, textAlign: "right" }}>Total: {fmtBoth(calc.totalSipsEur, rate)}/mo</div>
      </div>
      <div style={s.card}>
        <div style={s.h2}>Surplus Breakdown</div>
        <div style={s.grid3}>
          <div style={{ padding: "12px", background: colors.greenBg, borderRadius: "8px" }}><div style={{ fontSize: "10px", color: colors.green }}>Income</div><div style={{ fontSize: "18px", fontWeight: 700 }}>{fmt(calc.totalIncomeEur)}</div></div>
          <div style={{ padding: "12px", background: colors.redBg, borderRadius: "8px" }}><div style={{ fontSize: "10px", color: colors.red }}>Expenses + SIPs</div><div style={{ fontSize: "18px", fontWeight: 700 }}>{fmt(calc.totalFixedEur + calc.totalSipsEur)}</div></div>
          <div style={{ padding: "12px", background: `${colors.accent}15`, borderRadius: "8px" }}><div style={{ fontSize: "10px", color: colors.accent }}>Surplus</div><div style={{ fontSize: "18px", fontWeight: 700 }}>{fmt(calc.surplus)}</div></div>
        </div>
      </div>
      <div style={s.card}>
        <div style={s.flex}><div style={s.h2}>Surplus Allocation (Phase {data.settings.currentPhase})</div><button style={s.btn} onClick={() => addItem("surplusAllocation", { name: "New", amount: 0, currency: "EUR", phase: data.settings.currentPhase })}>+ Add</button></div>
        <table style={s.table}><thead><tr><th style={s.th}>Allocation</th><th style={s.th}>Amount</th><th style={s.th}>Curr</th><th style={s.th}>Phase</th><th style={s.th}>EUR/mo</th><th style={s.th}></th></tr></thead>
        <tbody>{data.surplusAllocation.map(a => <tr key={a.id} style={{ opacity: a.phase === data.settings.currentPhase ? 1 : 0.4 }}><td style={s.td}><ECell value={a.name} onChange={v => updateItem("surplusAllocation", a.id, "name", v)} /></td><td style={s.td}><ECell value={a.amount} type="number" onChange={v => updateItem("surplusAllocation", a.id, "amount", v)} /></td><td style={s.td}><CurrSelect value={a.currency} onChange={v => updateItem("surplusAllocation", a.id, "currency", v)} /></td><td style={s.td}><select style={s.select} value={a.phase} onChange={e => updateItem("surplusAllocation", a.id, "phase", parseInt(e.target.value))}>{data.phases.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}</select></td><td style={s.td}>{fmt(toEur(a.amount, a.currency, rate))}</td><td style={s.td}><button style={s.btnDanger} onClick={() => removeItem("surplusAllocation", a.id)}>×</button></td></tr>)}</tbody></table>
        <div style={{ marginTop: "12px", padding: "10px", borderRadius: "8px", background: calc.unallocated >= 0 ? colors.greenBg : colors.redBg }}>
          <div style={s.flex}><span style={{ fontSize: "12px", fontWeight: 600 }}>Allocated: {fmt(calc.totalAllocEur)}/mo</span><span style={{ fontSize: "12px", fontWeight: 600, color: calc.unallocated >= 0 ? colors.green : colors.red }}>Unallocated: {fmt(calc.unallocated)}/mo</span></div>
        </div>
      </div>
    </div>
  );

  // ─── LIABILITIES ───
  const renderLiabilities = () => (
    <div style={s.card}>
      <div style={s.flex}><div style={s.h2}>Liabilities</div><button style={s.btn} onClick={() => addItem("liabilities", { name: "New Loan", totalAmount: 0, interestRate: 0, monthlyEMI: 0, startDate: "", tenureMonths: 0, currency: "EUR" })}>+ Add</button></div>
      {data.liabilities.length === 0 ? <div style={{ fontSize: "12px", color: colors.textDim, padding: "12px 0" }}>No liabilities</div> :
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {data.liabilities.map(l => {
          const elapsed = getMonthsElapsed(l.startDate);
          const amort = calcAmortization(l.totalAmount, l.interestRate, l.tenureMonths, elapsed);
          const remaining = Math.max(0, l.tenureMonths - elapsed);
          const prog = pct(elapsed, l.tenureMonths);
          return (
            <div key={l.id} style={{ padding: "14px", borderRadius: "8px", background: colors.cardAlt, border: `1px solid ${colors.border}` }}>
              <div style={s.flex}><ECell value={l.name} onChange={v => updateItem("liabilities", l.id, "name", v)} style={{ fontSize: "14px", fontWeight: 600 }} /><button style={s.btnDanger} onClick={() => removeItem("liabilities", l.id)}>×</button></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "12px" }}>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Principal</div><ECell value={l.totalAmount} type="number" onChange={v => updateItem("liabilities", l.id, "totalAmount", v)} /></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Interest Rate (%)</div><ECell value={l.interestRate} type="number" onChange={v => updateItem("liabilities", l.id, "interestRate", v)} /></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Calculated EMI</div><div style={{ fontSize: "13px", fontWeight: 600 }}>{amort.emi ? fmt(amort.emi, l.currency) : "—"}</div></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Start Date</div><input type="date" style={{ ...s.input, width: "130px" }} value={l.startDate} onChange={e => updateItem("liabilities", l.id, "startDate", e.target.value)} /></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Tenure (months)</div><ECell value={l.tenureMonths} type="number" onChange={v => updateItem("liabilities", l.id, "tenureMonths", v)} /></div>
                <div><div style={{ fontSize: "10px", color: colors.textDim }}>Currency</div><CurrSelect value={l.currency} onChange={v => updateItem("liabilities", l.id, "currency", v)} /></div>
              </div>
              {l.totalAmount > 0 && l.tenureMonths > 0 && l.interestRate > 0 && (
                <div style={{ marginTop: "14px", padding: "12px", borderRadius: "8px", background: colors.card, border: `1px solid ${colors.border}` }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: colors.textDim, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Amortization</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                    <div><div style={{ fontSize: "10px", color: colors.textDim }}>Remaining Principal</div><div style={{ fontSize: "15px", fontWeight: 700, color: colors.red }}>{fmt(amort.remainingPrincipal, l.currency)}</div></div>
                    <div><div style={{ fontSize: "10px", color: colors.textDim }}>Remaining Interest</div><div style={{ fontSize: "15px", fontWeight: 700, color: colors.yellow }}>{fmt(amort.remainingInterest, l.currency)}</div></div>
                    <div><div style={{ fontSize: "10px", color: colors.textDim }}>Total Interest</div><div style={{ fontSize: "15px", fontWeight: 700, color: colors.textDim }}>{fmt(amort.totalInterest, l.currency)}</div></div>
                    <div><div style={{ fontSize: "10px", color: colors.textDim }}>Months Left</div><div style={{ fontSize: "15px", fontWeight: 700 }}>{remaining}</div></div>
                  </div>
                  <div style={{ marginTop: "10px" }}><div style={s.flex}><span style={{ fontSize: "10px", color: colors.textDim }}>Paid</span><span style={{ fontSize: "10px", color: colors.textDim }}>{remaining} mo left</span></div><div style={s.progressBar}><div style={s.progressFill(prog, colors.red)} /></div></div>
                </div>
              )}
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
        <div style={s.flex}><div style={s.h2}>Net Worth Over Time</div><button style={s.btn} onClick={takeSnapshot}>📸 Save Snapshot</button></div>
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

  return (
    <div style={s.page}>
      <div style={{ ...s.flex, marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div><h1 style={s.h1}>Financial Command Center</h1><div style={{ fontSize: "11px", color: colors.textDim, marginTop: "4px" }}>Phase {data.settings.currentPhase} · NW: {fmtBoth(calc.netWorth, rate)}{data.settings.lastUpdated && <span> · Last saved: {new Date(data.settings.lastUpdated).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}</div></div>
        <div style={s.flexG}>{tabs.map(t => <button key={t.key} style={s.tab(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>
      </div>
      {tab === "overview" && renderOverview()}
      {tab === "income" && renderIncome()}
      {tab === "portfolio" && renderPortfolio()}
      {tab === "invest" && renderInvest()}
      {tab === "liabilities" && renderLiabilities()}
      {tab === "history" && renderHistory()}
    </div>
  );
}
