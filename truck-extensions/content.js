(function () {
  const isTimocom = location.hostname.includes("timocom.com");

  if (!isTimocom) return;

  console.log("[dispatcher-assistant] TIMOCOM content.js loaded");

  function normalizeText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getRightPanelText() {
    const candidates = [
      '[data-testid*="detail"]',
      '[class*="detail"]',
      '[class*="Detail"]',
      '[class*="side"]',
      '[class*="Side"]',
      '[class*="drawer"]',
      '[class*="Drawer"]',
      '[class*="panel"]',
      '[class*="Panel"]',
      "aside",
      '[role="dialog"]'
    ];

    let best = null;

    for (const selector of candidates) {
      document.querySelectorAll(selector).forEach((el) => {
        const rect = el.getBoundingClientRect();
        const text = normalizeText(el.innerText);

        if (
          rect.width > 250 &&
          rect.height > 300 &&
          rect.left > window.innerWidth * 0.35 &&
          text.length > 100
        ) {
          if (!best || text.length > best.text.length) {
            best = {
              el,
              text,
              selector
            };
          }
        }
      });
    }

    if (best) {
      console.log(
        "[dispatcher-assistant] TIMOCOM panel matched:",
        best.selector
      );

      return best.text;
    }

    console.warn(
      "[dispatcher-assistant] TIMOCOM detail panel not found, using body text"
    );

    return normalizeText(document.body.innerText);
  }

  function parseQuickTimocomText(text) {
    const clean = normalizeText(text);

    const titleMatch = clean.match(
      /([A-Z]{1,3}\s+[^\n>]{2,80})\s*>\s*([A-Z]{1,3}\s+[^\n]{2,80})/
    );

    const priceMatch = clean.match(
      /(?:Price|Preis|Prix|Cena|Frachtpreis)?\s*([0-9][0-9 .,'-]{1,12})\s*(EUR|€)/i
    );

    return {
      source: "timocom",
      title: titleMatch
        ? `${titleMatch[1].trim()} > ${titleMatch[2].trim()}`
        : "",
      loading: titleMatch ? titleMatch[1].trim() : "",
      unloading: titleMatch ? titleMatch[2].trim() : "",
      price: priceMatch
        ? `${priceMatch[1].trim()} ${priceMatch[2].trim()}`
        : "",
      fullText: clean,
      capturedAt: new Date().toISOString(),
      url: location.href
    };
  }

  async function saveToChromeStorage(offer, text) {
    try {
      if (!chrome?.storage?.local) {
        console.warn("[dispatcher-assistant] chrome.storage.local unavailable");
        return;
      }

      await chrome.storage.local.set({
        timocomSelectedOfferText: text,
        timocomSelectedOffer: offer
      });
    } catch (err) {
      console.warn("[dispatcher-assistant] chrome.storage failed:", err);
    }
  }

  function sendRuntimeMessage(offer) {
    try {
      if (!chrome?.runtime?.sendMessage) {
        console.warn("[dispatcher-assistant] chrome.runtime unavailable");
        return;
      }

      chrome.runtime.sendMessage({
        type: "TIMOCOM_OFFER_CAPTURED",
        payload: offer
      });
    } catch (err) {
      console.warn("[dispatcher-assistant] chrome.runtime.sendMessage failed:", err);
    }
  }

  async function captureTimocomOffer() {
    const text = getRightPanelText();
    const offer = parseQuickTimocomText(text);

    await saveToChromeStorage(offer, text);

    console.log("[dispatcher-assistant] TIMOCOM offer saved:", offer);

    sendRuntimeMessage(offer);

    return offer;
  }

  function injectAnalyzeButton() {
    if (document.getElementById("dispatcher-analyze-timocom-btn")) {
      return;
    }

    const btn = document.createElement("button");

    btn.id = "dispatcher-analyze-timocom-btn";
    btn.textContent = "🚚 Analyze open offer";

    Object.assign(btn.style, {
      position: "fixed",
      right: "24px",
      bottom: "24px",
      zIndex: "2147483647",
      padding: "12px 16px",
      borderRadius: "10px",
      border: "0",
      background: "#111827",
      color: "white",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      boxShadow: "0 8px 24px rgba(0,0,0,.25)"
    });

    btn.addEventListener("click", async () => {
      btn.textContent = "Reading TIMOCOM...";
      btn.disabled = true;

      try {
        await captureTimocomOffer();
        btn.textContent = "✅ Offer saved";
      } catch (err) {
        console.error("[dispatcher-assistant] TIMOCOM capture failed:", err);
        btn.textContent = "❌ Capture failed";
      }

      setTimeout(() => {
        btn.textContent = "🚚 Analyze open offer";
        btn.disabled = false;
      }, 1500);
    });

    document.body.appendChild(btn);
  }

  function startObserver() {
    injectAnalyzeButton();

    const observer = new MutationObserver(() => {
      injectAnalyzeButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function attachRuntimeListener() {
    try {
      if (!chrome?.runtime?.onMessage) {
        console.warn("[dispatcher-assistant] chrome.runtime.onMessage unavailable");
        return;
      }

      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type === "CAPTURE_TIMOCOM_OFFER") {
          captureTimocomOffer()
            .then((offer) => {
              sendResponse({
                ok: true,
                offer
              });
            })
            .catch((error) => {
              sendResponse({
                ok: false,
                error: String(error)
              });
            });

          return true;
        }

        return false;
      });
    } catch (err) {
      console.warn("[dispatcher-assistant] Cannot attach runtime listener:", err);
    }
  }

  startObserver();
  attachRuntimeListener();
})();