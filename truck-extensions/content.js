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
function getTruckLocationFromFilter() {
  // ищем именно chips фильтра
  const chips = Array.from(
    document.querySelectorAll('[class*="chip"], [class*="tag"], [class*="Token"]')
  );

  for (const chip of chips) {
    const text = normalizeTimocomText(chip.innerText || "");

    // пример: "2950 Kapellen (Putte)"
    const match = text.match(
      /(\d{4,6})\s+([A-Za-zÀ-ž .'\-()]+)/
    );

    if (!match) continue;

    const zip = match[1];
    const city = match[2]  
    .replace(/\(.*?\)/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

    // теперь найдём страну рядом (слева от chip)
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
  if (message?.type !== "CAPTURE_TIMOCOM_OFFER") return;

  try {
    const offer = captureTimocomOffer();

    chrome.storage.local.set({
      timocomSelectedOffer: offer,
      timocomSelectedOfferText: offer.fullText,
    });

    sendResponse({
      ok: true,
      offer,
    });
  } catch (err) {
    sendResponse({
      ok: false,
      error: err.message || String(err),
    });
  }

  return true;
});