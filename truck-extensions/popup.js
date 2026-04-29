document.getElementById("readTimocom").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("lastTimocomText");
  const text = data.lastTimocomText || "";

  document.getElementById("timocomText").value = text;

  document.getElementById("result").innerText = text
    ? "Груз из TIMOCOM загружен в панель."
    : "Сначала нажми 🚚 Analyze на карточке TIMOCOM.";
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

  const titleMatch = text.match(
    /([A-Z]{1,3}\s+[^\n>]{2,80})\s*>\s*([A-Z]{1,3}\s+[^\n]{2,80})/
  );

  const priceMatch = text.match(
    /(?:Price|Preis|Prix|Cena|Frachtpreis)?\s*([0-9][0-9 .,'-]{1,12})\s*(EUR|€)/i
  );

  const weightMatch = text.match(
    /(?:Weight|Gewicht|Poids|Waga)[^\d]{0,20}([0-9]+(?:[.,][0-9]+)?)\s*(t|to|tons?|kg)/i
  );

  const lengthMatch = text.match(
    /(?:Length|Länge|Longueur|Długość)[^\d]{0,20}([0-9]+(?:[.,][0-9]+)?)\s*(m|meter|metres)/i
  );

  const dateMatch = text.match(
    /(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/
  );

  return {
    source: "timocom",
    loading: titleMatch ? titleMatch[1].trim() : "",
    unloading: titleMatch ? titleMatch[2].trim() : "",
    price: priceMatch ? priceMatch[1].trim().replace(",", ".") : "",
    currency: priceMatch ? "EUR" : "",
    cargoWeight: weightMatch ? weightMatch[1].replace(",", ".") : "",
    cargoLength: lengthMatch ? lengthMatch[1].replace(",", ".") : "",
    date: dateMatch ? dateMatch[1] : "",
    fullText: text
  };
}

function setValueIfExists(id, value) {
  const el = document.getElementById(id);
  if (el && value) {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

async function getActiveTimocomTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs.find(tab => tab.url && tab.url.includes("timocom.com"));
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

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("takeTimocomOfferBtn");
  const debugTextarea = document.getElementById("timocomDebugText");

  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.textContent = "Читаю TIMOCOM...";
    btn.disabled = true;

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

      setValueIfExists("truck_location", parsed.loading);
      setValueIfExists("loading", parsed.loading);
      setValueIfExists("unloading", parsed.unloading);
      setValueIfExists("price", parsed.price);

      await chrome.storage.local.set({
        timocomParsedOffer: parsed
      });

      btn.textContent = "✅ Груз взят";
    } catch (err) {
      console.error("[dispatcher-assistant] TIMOCOM take failed:", err);
      btn.textContent = "❌ Ошибка TIMOCOM";
    }

    setTimeout(() => {
      btn.textContent = "Взять выбранный груз TIMOCOM";
      btn.disabled = false;
    }, 1500);
  });
});
});