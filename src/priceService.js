// Price fetching service for crypto (CoinGecko + Hyperliquid), mutual funds (mfapi.in), and equities (Google Sheets)

// ── Hyperliquid (pre-market & spot prices) ──
export async function fetchHyperliquidPrices(tickers) {
  // tickers = ["MEGAETH", "HYPE", ...]
  const validTickers = tickers.filter(Boolean);
  if (validTickers.length === 0) return {};

  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
    const data = await res.json();
    // data is { "TICKER": "price_string", ... }
    const prices = {};
    for (const ticker of validTickers) {
      const key = ticker.toUpperCase();
      if (data[key]) {
        prices[key] = parseFloat(data[key]);
      }
    }
    return prices;
  } catch (e) {
    console.error("Hyperliquid fetch failed:", e);
    return {};
  }
}

// ── CoinGecko (free, no API key, no CORS issues) ──
export async function fetchCryptoPrices(tokens) {
  const ids = tokens.filter(t => t.coingeckoId).map(t => t.coingeckoId);
  if (ids.length === 0) return {};

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    const prices = {};
    for (const id of ids) {
      if (data[id]?.usd) {
        prices[id] = { price: data[id].usd, change24h: data[id].usd_24h_change || 0 };
      }
    }
    return prices;
  } catch (e) {
    console.error("CoinGecko fetch failed:", e);
    return {};
  }
}

// ── mfapi.in (free, CORS-friendly, Indian MF NAVs) ──
export async function fetchMFNav(schemeCode) {
  if (!schemeCode) return null;
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}/latest`);
    if (!res.ok) throw new Error(`mfapi ${res.status}`);
    const data = await res.json();
    if (data?.data?.[0]?.nav) return parseFloat(data.data[0].nav);
    return null;
  } catch (e) {
    console.error(`MF NAV fetch failed for ${schemeCode}:`, e);
    return null;
  }
}

export async function fetchAllMFNavs(funds) {
  const results = {};
  for (const fund of funds) {
    if (fund.schemeCode) {
      const nav = await fetchMFNav(fund.schemeCode);
      if (nav) results[fund.schemeCode] = nav;
    }
  }
  return results;
}

// ── Google Sheets (published CSV for Indian equities) ──
export async function fetchEquityPricesFromSheet(csvUrl) {
  if (!csvUrl) return {};
  try {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`Sheet fetch ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split("\n");
    const prices = {};
    // Format: ticker,price,changepct (skip header if present)
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length >= 2) {
        const ticker = parts[0].trim().replace(/"/g, "");
        const price = parseFloat(parts[1].trim().replace(/"/g, ""));
        const changePct = parts.length >= 3 ? parseFloat(parts[2].trim().replace(/"/g, "")) : null;
        if (ticker && !isNaN(price) && price > 0 && ticker !== "Symbol" && ticker !== "Ticker") {
          prices[ticker.toUpperCase()] = { price, changePct: isNaN(changePct) ? null : changePct };
        }
      }
    }
    return prices;
  } catch (e) {
    console.error("Google Sheet fetch failed:", e);
    return {};
  }
}

// ── Generate Google Sheet template ──
export function generateSheetTemplate(equityAccounts) {
  const tickers = new Set();
  for (const acct of equityAccounts || []) {
    for (const stock of acct.stocks || []) {
      const ticker = (stock.nseTicker || stock.name || "").toUpperCase().trim();
      if (ticker && ticker !== "NEW STOCK" && stock.quantity > 0) {
        tickers.add(ticker);
      }
    }
  }

  const sorted = [...tickers].sort();
  let sheet = "Symbol\tPrice\tChange%\n";
  for (const t of sorted) {
    sheet += `${t}\t=GOOGLEFINANCE("NSE:${t}")\t=GOOGLEFINANCE("NSE:${t}","changepct")\n`;
  }
  return { text: sheet, tickers: sorted };
}
