const colors = {
  text: "#e2e5f0", textDim: "#8b90a5", textMuted: "#5a5f75", card: "#181b27", border: "#2a2e42",
};

const fmt = (n, c = "EUR") => {
  if (c === "INR") return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  if (c === "USD") return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return "€" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
};

export default function DonutChart({ segments, title, size = 160, currency = "EUR" }) {
  // segments = [{ label, value, color }]
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  const radius = 52;
  const strokeWidth = 24;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let offset = 0;
  const arcs = segments.filter(seg => seg.value > 0).map(seg => {
    const pct = seg.value / total;
    const dashArray = `${circumference * pct} ${circumference * (1 - pct)}`;
    const dashOffset = -offset * circumference;
    offset += pct;
    return { ...seg, pct, dashArray, dashOffset };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          {arcs.map((arc, i) => (
            <circle key={i} cx={center} cy={center} r={radius} fill="none"
              stroke={arc.color} strokeWidth={strokeWidth}
              strokeDasharray={arc.dashArray} strokeDashoffset={arc.dashOffset}
              transform={`rotate(-90 ${center} ${center})`}
              style={{ transition: "stroke-dasharray 0.5s, stroke-dashoffset 0.5s" }}
            />
          ))}
        </svg>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: colors.text }}>{fmt(total, currency)}</div>
          {title && <div style={{ fontSize: "9px", color: colors.textMuted, marginTop: "2px" }}>{title}</div>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
        {arcs.map((arc, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: arc.color, flexShrink: 0 }} />
              <span style={{ fontSize: "11px", color: colors.textDim }}>{arc.label}</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: colors.text }}>{fmt(arc.value, currency)}</span>
              <span style={{ fontSize: "10px", color: colors.textMuted, marginLeft: "4px" }}>({(arc.pct * 100).toFixed(1)}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
