// Price fetching service for crypto (CoinGecko), mutual funds (mfapi.in), and equities (Google Sheets)

// ── CoinGecko (free, no API key, no CORS issues) ──
export async function fetchCryptoPrices(tokens) {
  // tokens = [{ id: "coingecko-id", ... }]
  const ids = tokens.filter(t => t.coingeckoId).map(t => t.coingeckoId);
  if (ids.length === 0) return {};

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    // Return { coingeckoId: priceUSD }
    const prices = {};
    for (const id of ids) {
      if (data[id]?.usd) prices[id] = data[id].usd;
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
    // Format: ticker,price (skip header if present)
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length >= 2) {
        const ticker = parts[0].trim().replace(/"/g, "");
        const price = parseFloat(parts[1].trim().replace(/"/g, ""));
        if (ticker && !isNaN(price) && price > 0 && ticker !== "Symbol" && ticker !== "Ticker") {
          prices[ticker.toUpperCase()] = price;
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
  let sheet = "Symbol\tPrice\n";
  for (const t of sorted) {
    sheet += `${t}\t=GOOGLEFINANCE("NSE:${t}")\n`;
  }
  return { text: sheet, tickers: sorted };
}
