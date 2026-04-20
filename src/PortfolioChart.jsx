import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart, CartesianGrid, BarChart, Bar, Legend } from "recharts";

const colors = {
  bg: "#0a0a0a", card: "#0f0f0f", cardAlt: "#161616", border: "#1f1f1f",
  accent: "#f5a623", text: "#e8e8e3", textDim: "#8a8a82", textMuted: "#4a4a44",
  green: "#4ea96a", red: "#e25555", cyan: "#4ec9e6", magenta: "#d67ab5", violet: "#9b7ed6",
  gridLine: "rgba(245,166,35,0.1)",
};

const RANGES = [
  { key: "W", label: "1W", days: 7 },
  { key: "M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 90 },
  { key: "Y", label: "1Y", days: 365 },
  { key: "ALL", label: "All", days: 99999 },
];

const monoFont = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

const fmt = (n, c = "EUR") => {
  if (c === "INR") return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return "€" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const rangeBtn = (active) => ({
  padding: "4px 10px", borderRadius: 0, border: "none", cursor: "pointer",
  fontSize: "10px", fontWeight: 500, fontFamily: "'IBM Plex Mono', monospace",
  letterSpacing: "0.1em", textTransform: "uppercase",
  background: active ? colors.accent : "transparent",
  color: active ? colors.bg : colors.textDim,
});

export default function PortfolioChart({ history, title, color = colors.accent, currency = "EUR", height = 200 }) {
  const [range, setRange] = useState("ALL");
  const gradId = useMemo(() => `grad-${Math.random().toString(36).slice(2, 8)}`, []);

  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];
    const r = RANGES.find(r => r.key === range);
    const cutoff = Date.now() - (r.days * 24 * 60 * 60 * 1000);
    const filtered = history.filter(h => new Date(h.date).getTime() >= cutoff);
    const data = filtered.length >= 2 ? filtered : history;
    return data.map(h => ({
      date: new Date(h.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      value: h.value,
      rawDate: h.date,
    }));
  }, [history, range]);

  if (!history || history.length < 2) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center", fontSize: "10px", color: colors.textDim, letterSpacing: "0.1em", textTransform: "uppercase", ...monoFont }}>
        Need ≥2 data points · Refresh prices to build history
      </div>
    );
  }

  const first = chartData[0]?.value || 0;
  const last = chartData[chartData.length - 1]?.value || 0;
  const change = last - first;
  const changePct = first > 0 ? (change / first) * 100 : 0;
  const isUp = change >= 0;
  const lineColor = colors.accent;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
        <div>
          {title && <div style={{ fontSize: "10px", color: colors.text, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: "4px", ...monoFont }}><span style={{ color: colors.accent, marginRight: "6px" }}>&gt;</span>{title}</div>}
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <span style={{ fontSize: "20px", fontWeight: 500, letterSpacing: "-0.01em", ...monoFont }}>{fmt(last, currency)}</span>
            <span style={{ fontSize: "11px", color: isUp ? colors.green : colors.red, ...monoFont }}>
              {isUp ? "▲ +" : "▼ "}{fmt(change, currency)} · {isUp ? "+" : ""}{changePct.toFixed(2)}%
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "2px" }}>
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} style={rangeBtn(range === r.key)}>{r.label}</button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 15 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.18} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={colors.gridLine} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} width={55} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "#000", border: `1px solid ${colors.accent}`, borderRadius: 0, fontSize: "11px", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.05em" }}
            labelStyle={{ color: colors.textDim, textTransform: "uppercase", fontSize: "9px", letterSpacing: "0.14em" }}
            itemStyle={{ color: colors.accent }}
            formatter={(v) => [fmt(v, currency), "VALUE"]}
          />
          <Area type="monotone" dataKey="value" stroke={lineColor} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} activeDot={{ r: 3, fill: lineColor, stroke: "none" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MultiLineChart({ history, items, title, currency = "EUR", height = 250, customColors = null }) {
  const [range, setRange] = useState("ALL");
  const lineColors = customColors || [colors.accent, colors.cyan, colors.magenta, colors.green, colors.violet, colors.red, "#8a9a5b", "#d4a373"];

  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];
    const r = RANGES.find(r => r.key === range);
    const cutoff = Date.now() - (r.days * 24 * 60 * 60 * 1000);
    const filtered = history.filter(h => new Date(h.date).getTime() >= cutoff);
    const data = filtered.length >= 2 ? filtered : history;
    return data.map(h => {
      const point = { date: new Date(h.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) };
      for (const item of items) {
        point[item.key] = h.items?.[item.key] ?? 0;
      }
      return point;
    });
  }, [history, range, items]);

  if (!history || history.length < 2) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center", fontSize: "10px", color: colors.textDim, letterSpacing: "0.1em", textTransform: "uppercase", ...monoFont }}>
        Need ≥2 data points · Refresh prices to build history
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
        {title && <div style={{ fontSize: "10px", color: colors.text, letterSpacing: "0.14em", textTransform: "uppercase", ...monoFont }}><span style={{ color: colors.accent, marginRight: "6px" }}>&gt;</span>{title}</div>}
        <div style={{ display: "flex", gap: "2px" }}>
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} style={rangeBtn(range === r.key)}>{r.label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "10px" }}>
        {items.map((item, i) => (
          <div key={item.key} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "10px", height: "10px", background: lineColors[i % lineColors.length] }} />
            <span style={{ fontSize: "10px", color: colors.textDim, letterSpacing: "0.05em", ...monoFont }}>{item.label}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 15 }}>
          <CartesianGrid stroke={colors.gridLine} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} width={55} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "#000", border: `1px solid ${colors.accent}`, borderRadius: 0, fontSize: "11px", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.05em" }}
            labelStyle={{ color: colors.textDim, textTransform: "uppercase", fontSize: "9px", letterSpacing: "0.14em" }}
            itemStyle={{ color: colors.text }}
            formatter={(v, name) => [fmt(v, currency), name]}
          />
          {items.map((item, i) => (
            <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={lineColors[i % lineColors.length]} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Stacked bar chart for Cash Flow 12mo ──
// Bar height = Income. Segments = Fixed (red), SIPs (orange), One-offs (magenta), Surplus (green)
// For deficit months (where outflows > income), Deficit renders as red overflow above the income line.
export function CashFlowBarChart({ data: chartData, height = 220 }) {
  const [hoverKey, setHoverKey] = useState(null);
  const anyData = chartData.some(d => d.income > 0 || d.fixed > 0 || d.sips > 0 || d.oneOffs > 0);
  if (!anyData) return null;

  // Render opacity: non-hovered segments fade when any is hovered
  const op = (key) => hoverKey == null ? 1 : (hoverKey === key ? 1 : 0.25);

  // Custom tooltip: if a segment is hovered, show only that segment's value
  const CustomTip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const items = hoverKey ? payload.filter(p => p.dataKey === hoverKey) : payload.filter(p => p.value > 0);
    if (items.length === 0) return null;
    return <div style={{ background: "#000", border: `1px solid ${colors.accent}`, borderRadius: 0, fontSize: "11px", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.05em", padding: "8px 10px" }}>
      <div style={{ color: colors.accent, textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.14em", marginBottom: "4px" }}>{label}</div>
      {items.map((it, i) => <div key={i} style={{ color: it.color, padding: "1px 0", display: "flex", justifyContent: "space-between", gap: "12px" }}>
        <span>{it.name}</span><span>{fmt(it.value, "EUR")}</span>
      </div>)}
    </div>;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 15 }}>
        <CartesianGrid stroke={colors.gridLine} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} width={55} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)} />
        <Tooltip content={<CustomTip />} cursor={{ fill: "rgba(245,166,35,0.05)" }} />
        <Bar dataKey="fixed" stackId="cf" fill={colors.red} name="Fixed Exp" fillOpacity={op("fixed")} onMouseEnter={() => setHoverKey("fixed")} onMouseLeave={() => setHoverKey(null)} />
        <Bar dataKey="sips" stackId="cf" fill="#d67ab5" name="SIPs" fillOpacity={op("sips")} onMouseEnter={() => setHoverKey("sips")} onMouseLeave={() => setHoverKey(null)} />
        <Bar dataKey="oneOffs" stackId="cf" fill={colors.violet} name="One-offs" fillOpacity={op("oneOffs")} onMouseEnter={() => setHoverKey("oneOffs")} onMouseLeave={() => setHoverKey(null)} />
        <Bar dataKey="surplus" stackId="cf" fill={colors.green} name="Surplus" fillOpacity={op("surplus")} onMouseEnter={() => setHoverKey("surplus")} onMouseLeave={() => setHoverKey(null)} />
        <Bar dataKey="deficit" stackId="cf" fill={colors.red} fillOpacity={hoverKey == null ? 0.5 : (hoverKey === "deficit" ? 0.7 : 0.15)} stroke={colors.red} strokeWidth={1} name="Deficit" onMouseEnter={() => setHoverKey("deficit")} onMouseLeave={() => setHoverKey(null)} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Grouped bar chart for Amortization 12mo ──
export function AmortBarChart({ data: chartData, height = 220 }) {
  const [hoverKey, setHoverKey] = useState(null);
  const op = (key) => hoverKey == null ? 1 : (hoverKey === key ? 1 : 0.25);

  const CustomTip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const items = hoverKey ? payload.filter(p => p.dataKey === hoverKey) : payload.filter(p => p.value > 0);
    if (items.length === 0) return null;
    return <div style={{ background: "#000", border: `1px solid ${colors.accent}`, borderRadius: 0, fontSize: "11px", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.05em", padding: "8px 10px" }}>
      <div style={{ color: colors.accent, textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.14em", marginBottom: "4px" }}>{label}</div>
      {items.map((it, i) => <div key={i} style={{ color: it.color, padding: "1px 0", display: "flex", justifyContent: "space-between", gap: "12px" }}>
        <span>{it.name}</span><span>{fmt(it.value, "EUR")}</span>
      </div>)}
    </div>;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 15 }}>
        <CartesianGrid stroke={colors.gridLine} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: colors.textMuted, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} width={55} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)} />
        <Tooltip content={<CustomTip />} cursor={{ fill: "rgba(245,166,35,0.05)" }} />
        <Bar dataKey="principal" fill={colors.green} name="Principal" fillOpacity={op("principal")} onMouseEnter={() => setHoverKey("principal")} onMouseLeave={() => setHoverKey(null)} />
        <Bar dataKey="interest" fill={colors.red} name="Interest" fillOpacity={op("interest")} onMouseEnter={() => setHoverKey("interest")} onMouseLeave={() => setHoverKey(null)} />
      </BarChart>
    </ResponsiveContainer>
  );
}
