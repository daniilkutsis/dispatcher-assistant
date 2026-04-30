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

  return {
    source: "timocom",
    fullText,
    capturedAt: new Date().toISOString(),
    url: window.location.href,
  };
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