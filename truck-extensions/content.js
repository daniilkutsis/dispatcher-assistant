(function () {
  if (!location.hostname.includes("timocom.com")) return;

  console.log("[dispatcher-assistant] TIMOCOM content.js loaded");

  function normalizeText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getRightPanelText() {
    const elements = Array.from(
      document.querySelectorAll("div, section, article, aside")
    );

    const candidates = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = normalizeText(el.innerText);

        let score = 0;

        if (text.includes("Loading and unloading places")) score += 50;
        if (text.includes("Freight description")) score += 30;
        if (text.includes("Vehicle requirements")) score += 30;
        if (text.includes("Freight charge")) score += 30;
        if (text.includes("Price")) score += 10;

        if (text.includes("Search filter")) score -= 100;
        if (text.includes("Country selection")) score -= 100;
        if (text.includes("New offers only")) score -= 50;

        return {
          el,
          rect,
          text,
          score
        };
      })
      .filter((item) => {
        return (
          item.score > 50 &&
          item.text.length > 150 &&
          item.rect.width > 300 &&
          item.rect.height > 250
        );
      })
      .sort((a, b) => b.score - a.score);

    if (candidates.length) {
      console.log("[dispatcher-assistant] TIMOCOM detail candidate:", {
        score: candidates[0].score,
        rect: {
          left: candidates[0].rect.left,
          top: candidates[0].rect.top,
          width: candidates[0].rect.width,
          height: candidates[0].rect.height
        },
        preview: candidates[0].text.slice(0, 500)
      });

      return candidates[0].text;
    }

    console.warn("[dispatcher-assistant] TIMOCOM detail panel not found");
    return "";
  }

  function parseQuickTimocomText(text) {
    const clean = normalizeText(text);

    const titleMatch = clean.match(
      /([A-Z]{2}\s+[A-Za-zÀ-ž .'-]+)\s*>\s*([A-Z]{2}\s+[A-Za-zÀ-ž .'-]+)/
    );

    const priceMatch = clean.match(/Price\s*\n?\s*([0-9][0-9 .,'-]*)\s*EUR/i);

    return {
      source: "timocom",
      title: titleMatch ? `${titleMatch[1].trim()} > ${titleMatch[2].trim()}` : "",
      loading: titleMatch ? titleMatch[1].trim() : "",
      unloading: titleMatch ? titleMatch[2].trim() : "",
      price: priceMatch ? priceMatch[1].trim() : "",
      fullText: clean,
      capturedAt: new Date().toISOString(),
      url: location.href
    };
  }

  async function captureTimocomOffer() {
    const text = getRightPanelText();
    const offer = parseQuickTimocomText(text);

    try {
      await chrome.storage.local.set({
        timocomSelectedOfferText: text,
        timocomSelectedOffer: offer
      });
    } catch (err) {
      console.warn("[dispatcher-assistant] chrome.storage failed:", err);
    }

    try {
      chrome.runtime.sendMessage({
        type: "TIMOCOM_OFFER_CAPTURED",
        payload: offer
      });
    } catch (err) {
      console.warn("[dispatcher-assistant] chrome.runtime.sendMessage failed:", err);
    }

    console.log("[dispatcher-assistant] TIMOCOM offer captured:", offer);
    return offer;
  }

  function injectAnalyzeButton() {
    if (document.getElementById("dispatcher-analyze-timocom-btn")) return;

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
        const offer = await captureTimocomOffer();

        if (!offer.fullText) {
          btn.textContent = "❌ Panel not found";
        } else {
          btn.textContent = "✅ Offer saved";
        }
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

  function attachRuntimeListener() {
    try {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type === "CAPTURE_TIMOCOM_OFFER") {
          captureTimocomOffer()
            .then((offer) => sendResponse({ ok: true, offer }))
            .catch((error) => sendResponse({ ok: false, error: String(error) }));

          return true;
        }

        return false;
      });
    } catch (err) {
      console.warn("[dispatcher-assistant] runtime listener failed:", err);
    }
  }

  injectAnalyzeButton();

  const observer = new MutationObserver(() => {
    injectAnalyzeButton();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  attachRuntimeListener();
})();