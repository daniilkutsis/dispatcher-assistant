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

  if (
    text.includes("Search filter") &&
    text.includes("Country selection") &&
    !text.includes("Loading and unloading places")
  ) {
    return emptyTimocomOffer(text);
  }

  const titleMatch = text.match(
    /([A-Z]{2}\s+[A-Za-zÀ-ž .'-]+)\s*>\s*([A-Z]{2}\s+[A-Za-zÀ-ž .'-]+)/
  );

  const routeMatch = text.match(
    /Loading and unloading places\s+([A-Z]{2},?\s*[0-9A-Z -]*\s*[A-Za-zÀ-ž .'-]+).*?\n([A-Z]{2},?\s*[0-9A-Z -]*\s*[A-Za-zÀ-ž .'-]+)/s
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
}

function emptyTimocomOffer(text) {
  return {
    source: "timocom",
    loading: "",
    unloading: "",
    truck_location: "",
    price: "",
    currency: "",
    cargoLength: "",
    cargoWeight: "",
    fullText: text || ""
  };
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

    if (response?.ok) return response.offer;
  } catch (err) {
    console.warn("[dispatcher-assistant] Cannot message TIMOCOM tab:", err);
  }

  return null;
}

async function calculateRoute() {
  const resultEl = document.getElementById("result");

  const payload = {
    truck_location: document.getElementById("truck_location")?.value || "",
    loading: document.getElementById("loading")?.value || "",
    unloading: document.getElementById("unloading")?.value || "",
    price: Number(document.getElementById("price")?.value || 0)
  };

  if (resultEl) resultEl.innerHTML = "Calculating...";

  try {
    const response = await fetch("http://127.0.0.1:8000/calculate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || JSON.stringify(data));
    }

    if (resultEl) {
      resultEl.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    }

    console.log("[dispatcher-assistant] route result:", data);
  } catch (err) {
    console.error("[dispatcher-assistant] calculate failed:", err);

    if (resultEl) {
      resultEl.innerHTML = `Error: ${err.message}`;
    }
  }
}

async function handleTakeTimocomOffer() {
  const btn = document.getElementById("takeTimocomOfferBtn");
  const debugTextarea = document.getElementById("timocomDebugText");

  if (btn) {
    btn.textContent = "Reading TIMOCOM...";
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

    await chrome.storage.local.set({
      timocomParsedOffer: parsed
    });

    await calculateRoute();

    if (btn) {
      btn.textContent = "✅ Offer taken";
    }
  } catch (err) {
    console.error("[dispatcher-assistant] TIMOCOM take failed:", err);

    if (btn) {
      btn.textContent = "❌ TIMOCOM error";
    }
  }

  setTimeout(() => {
    if (btn) {
      btn.textContent = "Take selected TIMOCOM offer";
      btn.disabled = false;
    }
  }, 1500);
}

document.addEventListener("DOMContentLoaded", () => {
  const takeTimocomOfferBtn = document.getElementById("takeTimocomOfferBtn");
  const calculateBtn = document.getElementById("calculateBtn");

  if (takeTimocomOfferBtn) {
    takeTimocomOfferBtn.addEventListener("click", handleTakeTimocomOffer);
  }

  if (calculateBtn) {
    calculateBtn.addEventListener("click", calculateRoute);
  }
});