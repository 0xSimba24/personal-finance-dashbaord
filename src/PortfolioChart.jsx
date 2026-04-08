import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

const colors = {
  bg: "#0f1119", card: "#181b27", cardAlt: "#1e2235", border: "#2a2e42",
  accent: "#22c997", text: "#e2e5f0", textDim: "#8b90a5", textMuted: "#5a5f75",
  green: "#22c997", red: "#ef4444",
};

const RANGES = [
  { key: "W", label: "1W", days: 7 },
  { key: "M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 90 },
  { key: "Y", label: "1Y", days: 365 },
  { key: "ALL", label: "All", days: 99999 },
];

const fmt = (n, c = "EUR") => {
  if (c === "INR") return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return "€" + Number(n).toLocaleString("de-DE", { maximumFractionDigits: 0 });
};

export default function PortfolioChart({ history, title, color = colors.accent, currency = "EUR", height = 200 }) {
  const [range, setRange] = useState("ALL");

  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];
    const r = RANGES.find(r => r.key === range);
    const cutoff = Date.now() - (r.days * 24 * 60 * 60 * 1000);
    const filtered = history.filter(h => new Date(h.date).getTime() >= cutoff);
    // If filtered is too sparse, show all
    const data = filtered.length >= 2 ? filtered : history;
    return data.map(h => ({
      date: new Date(h.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      value: h.value,
      rawDate: h.date,
    }));
  }, [history, range]);

  if (!history || history.length < 2) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center", fontSize: "12px", color: colors.textDim }}>
        Need at least 2 data points. Hit "Refresh Prices" on different days to build history.
      </div>
    );
  }

  const first = chartData[0]?.value || 0;
  const last = chartData[chartData.length - 1]?.value || 0;
  const change = last - first;
  const changePct = first > 0 ? (change / first) * 100 : 0;
  const isUp = change >= 0;
  const lineColor = isUp ? colors.green : colors.red;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div>
          {title && <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "2px" }}>{title}</div>}
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: "18px", fontWeight: 700 }}>{fmt(last, currency)}</span>
            <span style={{ fontSize: "12px", fontWeight: 600, color: isUp ? colors.green : colors.red }}>
              {isUp ? "+" : ""}{fmt(change, currency)} ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} style={{
              padding: "4px 10px", borderRadius: "4px", border: "none", cursor: "pointer",
              fontSize: "10px", fontWeight: 600, fontFamily: "inherit",
              background: range === r.key ? colors.accent : colors.cardAlt,
              color: range === r.key ? colors.bg : colors.textDim,
            }}>{r.label}</button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.2} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: colors.textMuted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: "6px", fontSize: "11px", fontFamily: "inherit" }}
            labelStyle={{ color: colors.textDim }}
            formatter={(v) => [fmt(v, currency), "Value"]}
          />
          <Area type="monotone" dataKey="value" stroke={lineColor} strokeWidth={2} fill={`url(#grad-${title})`} dot={false} activeDot={{ r: 4, fill: lineColor }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Multi-line chart for individual items within a category
export function MultiLineChart({ history, items, title, currency = "EUR", height = 250 }) {
  const [range, setRange] = useState("ALL");
  const lineColors = ["#22c997", "#6366f1", "#f59e0b", "#ec4899", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6"];

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
      <div style={{ padding: "20px 0", textAlign: "center", fontSize: "12px", color: colors.textDim }}>
        Need at least 2 data points. Hit "Refresh Prices" on different days to build history.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        {title && <div style={{ fontSize: "13px", fontWeight: 600 }}>{title}</div>}
        <div style={{ display: "flex", gap: "4px" }}>
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} style={{
              padding: "4px 10px", borderRadius: "4px", border: "none", cursor: "pointer",
              fontSize: "10px", fontWeight: 600, fontFamily: "inherit",
              background: range === r.key ? colors.accent : colors.cardAlt,
              color: range === r.key ? colors.bg : colors.textDim,
            }}>{r.label}</button>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "8px" }}>
        {items.map((item, i) => (
          <div key={item.key} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: lineColors[i % lineColors.length] }} />
            <span style={{ fontSize: "10px", color: colors.textDim }}>{item.label}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: colors.textMuted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: "6px", fontSize: "11px", fontFamily: "inherit" }}
            labelStyle={{ color: colors.textDim }}
            formatter={(v, name) => [fmt(v, currency), name]}
          />
          {items.map((item, i) => (
            <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={lineColors[i % lineColors.length]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
