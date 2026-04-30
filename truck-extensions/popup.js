let isCalculating = false;

function normalizeTimocomText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emptyTimocomOffer(text = "") {
  return {
    source: "timocom",
    loading: "",
    unloading: "",
    truck_location: "",
    price: "",
    currency: "",
    cargoLength: "",
    cargoWeight: "",
    dates: [],
    fullText: text,
  };
}

function parseNumber(value) {
  if (!value) return "";

  return String(value)
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
}

function parseTimocomOffer(input) {
  const text = normalizeTimocomText(
    typeof input === "string" ? input : input?.fullText || ""
  );

   if (!text) return emptyTimocomOffer("");

   const isFilterText =
     text.includes("Search filter") &&
     text.includes("Country selection") &&
     !text.includes("Loading and unloading places");

   if (isFilterText) return emptyTimocomOffer(text);

   const priceMatch =
     text.match(/Price\s*\n?\s*([0-9][0-9 .,'-]*)\s*(EUR|€)/i) ||
     text.match(/([0-9][0-9 .,'-]*)\s*(EUR|€)/i);

   const lengthMatch = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*m\b/i);
   const weightMatch = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*t\b/i);

   const dates = [
     ...text.matchAll(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g),
   ].map((m) => m[0]);

   const routeBlockMatch = text.match(
     /Loading and unloading places\s+([\s\S]*?)(?:Contact details|Freight description|Vehicle requirements|Freight charge|$)/i
   );

   let loading = "";
   let unloading = "";

   if (routeBlockMatch) {
     const rawLines = routeBlockMatch[1]
       .split("\n")
       .map((x) => x.trim())
       .filter(Boolean);

     const addresses = [];

     for (let i = 0; i < rawLines.length; i++) {
       const line = rawLines[i];

       if (!/^[A-Z]{2}$/.test(line)) continue;

       const next = rawLines[i + 1] || "";

       if (/^,\s*\d{2,6}\s+.+/.test(next)) {
        addresses.push(`${line}${next}`);
         i++;
      }
    }

    if (addresses.length >= 2) {
      loading = addresses[0];
      unloading = addresses[1];
    }
  }

  return {
    source: "timocom",
    loading,
    unloading,
    truck_location: input?.truckLocation || loading,
    price: priceMatch ? parseNumber(priceMatch[1]) : "",
    currency: priceMatch ? "EUR" : "",
    cargoLength: lengthMatch ? parseNumber(lengthMatch[1]) : "",
    cargoWeight: weightMatch ? parseNumber(weightMatch[1]) : "",
    dates,
    fullText: text,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setValueIfExists(id, value) {
  const el = document.getElementById(id);
  if (!el || value === undefined || value === null || value === "") return;

  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setResult(html) {
  const el = document.getElementById("result");
  if (el) el.innerHTML = html || "";
}

function renderError(message) {
  const loading = document.getElementById("loading")?.value || "";
  const unloading = document.getElementById("unloading")?.value || "";
  const mapsUrl = buildGoogleMapsUrl(loading, unloading);

  setResult(`
    <div class="error">❌ ${escapeHtml(message)}</div>
    ${mapsUrl ? `<a class="maps-link" href="${mapsUrl}" target="_blank">🗺️ Open route in Google Maps</a>` : ""}
  `);
}

function buildGoogleMapsUrl(loading, unloading) {
  if (!loading || !unloading) return "";

  return (
    "https://www.google.com/maps/dir/?api=1" +
    `&origin=${encodeURIComponent(loading)}` +
    `&destination=${encodeURIComponent(unloading)}` +
    "&travelmode=driving"
  );
}

function renderRouteResult(data) {
  const loading = document.getElementById("loading")?.value || "";
  const unloading = document.getElementById("unloading")?.value || "";
  const mapsUrl = buildGoogleMapsUrl(loading, unloading);

  const decision = data.decision || "MAYBE";
  const decisionClass =
    {
      TAKE: "decision-take",
      MAYBE: "decision-maybe",
      SKIP: "decision-skip",
    }[decision] || "decision-maybe";

  const countryRows = Object.entries(data.country_details || {})
    .map(([country, item]) => {
      return `
        <tr>
          <td>${escapeHtml(country)}</td>
          <td>${item.km}</td>
          <td>€${item.fuel}</td>
          <td>€${item.toll}</td>
          <td>€${item.total}</td>
        </tr>
      `;
    })
    .join("");

  setResult(`
    <div class="decision ${decisionClass}">${escapeHtml(decision)}</div>

    ${mapsUrl ? `<a class="maps-link" href="${mapsUrl}" target="_blank">🗺️ Open route in Google Maps</a>` : ""}

    <div class="result-grid">
      <div>Route</div><b>${data.total_km} km</b>
      <div>Duration</div><b>${data.duration_h} h</b>
      <div>Fuel</div><b>€${data.fuel_cost}</b>
      <div>Tolls</div><b>€${data.tolls}</b>
      <div>Total cost</div><b>€${data.total_cost}</b>
      <div>Margin</div><b>€${data.margin}</b>
      <div>Rate</div><b>€${data.rate}/km</b>
      <div>Net rate</div><b>€${data.net_rate}/km</b>
    </div>

    <table class="country-table">
      <thead>
        <tr>
          <th>Country</th>
          <th>km</th>
          <th>Fuel</th>
          <th>Toll</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${countryRows}</tbody>
    </table>

    <details>
      <summary>Raw response</summary>
      <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
    </details>
  `);
}

async function getActiveTimocomTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tabs.find((tab) => tab.url && tab.url.includes("timocom.com"));
}

async function captureFromTimocomTabIfPossible() {
  const tab = await getActiveTimocomTab();
  if (!tab?.id) return null;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "CAPTURE_TIMOCOM_OFFER",
    });

    if (response?.ok) return response.offer;
    if (response?.error) throw new Error(response.error);
  } catch (err) {
    console.debug("[dispatcher-assistant] Cannot message TIMOCOM tab:", err);
  }

  return null;
}

function buildPayloadFromForm() {
  return {
    truck_location:
      document.getElementById("truck_location")?.value === "truck_location"
      ? ""
      : document.getElementById("truck_location")?.value || "",
    loading: document.getElementById("loading")?.value || "",
    unloading: document.getElementById("unloading")?.value || "",
    price: Number(document.getElementById("price")?.value || 0),
  };
}

async function calculateRoute() {
  if (isCalculating) return;

  const payload = buildPayloadFromForm();

  if (!payload.loading || !payload.unloading) {
    renderError("Нужны loading и unloading.");
    return;
  }

  isCalculating = true;
  setResult("Calculating...");

  const calculateBtn = document.getElementById("calculateBtn");
  if (calculateBtn) calculateBtn.disabled = true;

  try {
    const response = await fetch("http://127.0.0.1:8000/calculate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        typeof data.detail === "string"
          ? data.detail
          : data.detail?.message ||
            data.error ||
            JSON.stringify(data.detail || data, null, 2) ||
            `Backend error ${response.status}`;

      throw new Error(message);
    }

    renderRouteResult(data);
  } catch (err) {
    renderError(err.message || String(err));
  } finally {
    isCalculating = false;
    if (calculateBtn) calculateBtn.disabled = false;
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
        "timocomSelectedOfferText",
      ]);

      offer = stored.timocomSelectedOffer || {
        fullText: stored.timocomSelectedOfferText || "",
      };
    }

    const parsed = parseTimocomOffer(offer);

    if (debugTextarea) {
      debugTextarea.value = parsed.fullText || "";
    }

    if (!parsed.loading || !parsed.unloading) {
      throw new Error(
        "Не удалось распознать loading/unloading. Проверь, что открыт detail panel справа."
      );
    }

    setValueIfExists("truck_location", parsed.truck_location);
    setValueIfExists("loading", parsed.loading);
    setValueIfExists("unloading", parsed.unloading);
    setValueIfExists("price", parsed.price);

    await chrome.storage.local.set({
      timocomParsedOffer: parsed,
    });

    await calculateRoute();

    if (btn) btn.textContent = "✅ Offer taken";
  } catch (err) {
    renderError(err.message || String(err));
    if (btn) btn.textContent = "❌ TIMOCOM error";
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.textContent = "Take selected TIMOCOM offer";
        btn.disabled = false;
      }
    }, 1500);
  }
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