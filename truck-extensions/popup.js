function normalizeTimocomText(text) {
  return (text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseTimocomOffer(input) {
  const text = normalizeTimocomText(
    typeof input === "string" ? input : input?.fullText || ""
  );

  const routeMatch = text.match(
    /([A-Z]{2},?\s*[0-9A-Z -]*\s*[A-Za-zÀ-ž .'-]+)\s+.*?\n([A-Z]{2},?\s*[0-9A-Z -]*\s*[A-Za-zÀ-ž .'-]+)/s
  );

  const titleMatch = text.match(
    /([A-Z]{2}\s+[A-Za-zÀ-ž .'-]+)\s*>\s*([A-Z]{2}\s+[A-Za-zÀ-ž .'-]+)/
  );

  const priceMatch = text.match(/Price\s*\n?\s*([0-9][0-9 .,'-]*)\s*EUR/i);

  const lengthMatch = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*m\b/i);
  const weightMatch = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*t\b/i);

  let loading = "";
  let unloading = "";

  if (titleMatch) {
    loading = titleMatch[1].trim();
    unloading = titleMatch[2].trim();
  } else if (routeMatch) {
    loading = routeMatch[1].trim();
    unloading = routeMatch[2].trim();
  }

  return {
    source: "timocom",
    loading,
    unloading,
    truck_location: loading,
    price: priceMatch ? priceMatch[1].trim().replace(",", ".") : "",
    currency: priceMatch ? "EUR" : "",
    cargoLength: lengthMatch ? lengthMatch[1].replace(",", ".") : "",
    cargoWeight: weightMatch ? weightMatch[1].replace(",", ".") : "",
    fullText: text
  };
  if (
  text.includes("Search filter") &&
  text.includes("Country selection") &&
  !text.includes("Loading and unloading places")
) {
  return {
    source: "timocom",
    loading: "",
    unloading: "",
    truck_location: "",
    price: "",
    currency: "",
    cargoLength: "",
    cargoWeight: "",
    fullText: text
  };
}
}

function setValueIfExists(id, value) {
  const el = document.getElementById(id);

  if (!el || !value) return;

  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function getActiveTimocomTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs.find((tab) => tab.url && tab.url.includes("timocom.com"));
}

async function captureFromTimocomTabIfPossible() {
  const tab = await getActiveTimocomTab();

  if (!tab?.id) return null;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "CAPTURE_TIMOCOM_OFFER"
    });

    if (response?.ok) {
      return response.offer;
    }
  } catch (err) {
    console.warn("[dispatcher-assistant] Cannot message TIMOCOM tab:", err);
  }

  return null;
}

async function handleTakeTimocomOffer() {
  const btn = document.getElementById("takeTimocomOfferBtn");
  const debugTextarea = document.getElementById("timocomDebugText");

  if (btn) {
    btn.textContent = "Читаю TIMOCOM...";
    btn.disabled = true;
  }

  try {
    let offer = await captureFromTimocomTabIfPossible();

    if (!offer) {
      const stored = await chrome.storage.local.get([
        "timocomSelectedOffer",
        "timocomSelectedOfferText"
      ]);

      offer = stored.timocomSelectedOffer || {
        fullText: stored.timocomSelectedOfferText || ""
      };
    }

    const parsed = parseTimocomOffer(offer);

    if (debugTextarea) {
      debugTextarea.value = parsed.fullText || "";
    }

    setValueIfExists("truck_location", parsed.truck_location);
    setValueIfExists("loading", parsed.loading);
    setValueIfExists("unloading", parsed.unloading);
    setValueIfExists("price", parsed.price);
    const analyzeBtn =
    document.getElementById("calculateBtn") ||
    document.getElementById("analyzeBtn") ||
    document.getElementById("routeBtn") ||
    document.querySelector("[data-action='calculate-route']");

    if (analyzeBtn) {
     analyzeBtn.click();
      } else {
      console.warn("[dispatcher-assistant] analyze/calculate button not found");
    }

    await chrome.storage.local.set({
      timocomParsedOffer: parsed
    });

    if (btn) {
      btn.textContent = "✅ Груз взят";
    }
  } catch (err) {
    console.error("[dispatcher-assistant] TIMOCOM take failed:", err);

    if (btn) {
      btn.textContent = "❌ Ошибка TIMOCOM";
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
  const calculateBtn = document.getElementById("calculateBtn");

  if (calculateBtn) {
    calculateBtn.addEventListener("click", () => {
      console.log("[dispatcher-assistant] Analyze route clicked");
      alert("Analyze route clicked");
    });
  }
});

  setTimeout(() => {
    if (btn) {
      btn.textContent = "Взять выбранный груз TIMOCOM";
      btn.disabled = false;
    }
  }, 1500);
}

document.addEventListener("DOMContentLoaded", () => {
  const takeTimocomOfferBtn = document.getElementById("takeTimocomOfferBtn");

  if (takeTimocomOfferBtn) {
    takeTimocomOfferBtn.addEventListener("click", handleTakeTimocomOffer);
  } else {
    console.warn("[dispatcher-assistant] takeTimocomOfferBtn not found");
  }
});