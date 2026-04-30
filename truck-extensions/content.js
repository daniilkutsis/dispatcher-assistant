function normalizeTimocomText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getTimocomOfferText() {
  const all = Array.from(document.querySelectorAll("div, section, aside"));

  const candidates = all
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const text = normalizeTimocomText(el.innerText || el.textContent || "");

      return { el, rect, text };
    })
    .filter(({ rect, text }) => {
      return (
        rect.width > 300 &&
        rect.height > 300 &&
        rect.left > window.innerWidth * 0.3 &&
        text.includes("Loading and unloading places") &&
        text.includes("Freight charge")
      );
    })
    .sort((a, b) => {
      const scoreA =
        a.text.length +
        (a.text.includes("Price") ? 1000 : 0) +
        (a.text.includes("Vehicle requirements") ? 1000 : 0);

      const scoreB =
        b.text.length +
        (b.text.includes("Price") ? 1000 : 0) +
        (b.text.includes("Vehicle requirements") ? 1000 : 0);

      return scoreB - scoreA;
    });

  if (!candidates.length) {
    throw new Error("Detail panel не найден. Открой груз справа в TIMOCOM.");
  }

  return candidates[0].text;
}

function captureTimocomOffer() {
  const fullText = getTimocomOfferText();
  const truckLocation = getTruckLocationFromFilter();

  return {
    source: "timocom",
    fullText,
    truckLocation,
    capturedAt: new Date().toISOString(),
    url: window.location.href,
  };
}

function getVisibleOfferRows() {
  const candidates = Array.from(
    document.querySelectorAll(
      '[role="row"], tr, article, [data-testid*="offer"], div'
    )
  );

  return candidates
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const text = normalizeTimocomText(el.innerText || el.textContent || "");

      return { el, rect, text };
    })
    .filter((item) => {
      if (!item.text) return false;
      if (item.rect.width < 400) return false;
      if (item.rect.height < 30) return false;
      if (item.rect.bottom < 0) return false;
      if (item.rect.top > window.innerHeight) return false;

      const looksLikeOffer =
        /EUR|€|Price|Loading|Unloading|LDM|t\b|kg|m\b/i.test(item.text) &&
        /[A-Z]{2}/.test(item.text);

      return looksLikeOffer;
    })
    .slice(0, 50);
}

function parseVisibleOfferRow(rowText, index) {
  const text = normalizeTimocomText(rowText);

  const priceMatch = text.match(/([0-9][0-9 .,'-]*)\s*(EUR|€)/i);
  const weightMatch = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*t\b/i);
  const lengthMatch = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*m\b/i);

  const routeMatch = text.match(
    /([A-Z]{2}[,\s]+[A-Za-zÀ-ž0-9 .'-]+).*?([A-Z]{2}[,\s]+[A-Za-zÀ-ž0-9 .'-]+)/s
  );

  return {
    source: "timocom",
    index,
    loading: routeMatch ? routeMatch[1].trim() : "",
    unloading: routeMatch ? routeMatch[2].trim() : "",
    truck_location: routeMatch ? routeMatch[1].trim() : "",
    price: priceMatch ? priceMatch[1].trim().replace(",", ".") : "",
    currency: priceMatch ? "EUR" : "",
    cargoWeight: weightMatch ? weightMatch[1].replace(",", ".") : "",
    cargoLength: lengthMatch ? lengthMatch[1].replace(",", ".") : "",
    fullText: text,
    capturedAt: new Date().toISOString(),
    url: location.href,
  };
}

async function scanVisibleTimocomOffers() {
  const rows = getVisibleOfferRows();

  const offers = rows.map((row, index) => {
    const parsed = parseVisibleOfferRow(row.text, index);

    if (row.el) {
      row.el.style.outline = "2px solid #2563eb";
      row.el.style.outlineOffset = "-2px";
    }

    return parsed;
  });

  await chrome.storage.local.set({
    timocomScannedOffers: offers,
  });

  console.log("[dispatcher-assistant] visible TIMOCOM offers scanned:", offers);

  return offers;
}

function getTruckLocationFromFilter() {
  const chips = Array.from(
    document.querySelectorAll('[class*="chip"], [class*="tag"], [class*="Token"]')
  );

  for (const chip of chips) {
    const text = normalizeTimocomText(chip.innerText || "");

    const match = text.match(/(\d{4,6})\s+([A-Za-zÀ-ž .'\-()]+)/);

    if (!match) continue;

    const zip = match[1];

    const city = match[2]
      .replace(/\(.*?\)/g, "")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const container = chip.closest("div");
    const containerText = normalizeTimocomText(container?.innerText || "");
    const countryMatch = containerText.match(/\b([A-Z]{2})\b/);
    const country = countryMatch ? countryMatch[1] : "";

    if (!country || !zip || !city) continue;

    return `${country}, ${zip} ${city}`;
  }

  return "";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CAPTURE_TIMOCOM_OFFER") {
    try {
      const offer = captureTimocomOffer();

      chrome.storage.local.set({
        timocomSelectedOffer: offer,
        timocomSelectedOfferText: offer.fullText,
      });

      sendResponse({ ok: true, offer });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }

    return true;
  }

  if (message?.type === "SCAN_VISIBLE_TIMOCOM_OFFERS") {
    scanVisibleTimocomOffers()
      .then((offers) => sendResponse({ ok: true, offers }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }
});