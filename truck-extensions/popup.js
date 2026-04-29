function cleanPlace(value) {
  return decodeURIComponent(value)
    .replace(/\+/g, " ")
    .replace(/%2C/g, ",")
    .trim();
}
function formatCountryDetails(details) {
  let text = "";

  for (const [country, data] of Object.entries(details)) {
    text += `${country}: ${data.km} км | ⛽ ${data.fuel}€ | 🛣 ${data.toll}€ | Σ ${data.total}€\n`;
  }

  return text.trim();
}
function parseGoogleMapsUrl(url) {
  const marker = "/dir/";
  const index = url.indexOf(marker);

  if (index === -1) {
    throw new Error("Это не маршрут Google Maps");
  }

  let routePart = url.substring(index + marker.length);

  const atIndex = routePart.indexOf("/@");
  if (atIndex !== -1) {
    routePart = routePart.substring(0, atIndex);
  }

  routePart = routePart.split("?")[0];

  const parts = routePart
    .split("/")
    .map(cleanPlace)
    .filter(Boolean)
    .filter(p => !p.startsWith("data="))
    .filter(p => !p.includes("!"))
    .filter(p => !p.match(/^@[0-9.,]+/));

  if (parts.length < 3) {
    throw new Error("Нужно 3 точки: машина → загрузка → выгрузка");
  }

  return parts.slice(0, 3);
}

document.getElementById("readGoogleMaps").addEventListener("click", async () => {
  const resultBox = document.getElementById("result");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    const points = parseGoogleMapsUrl(tab.url);

    document.getElementById("truck").value = points[0] || "";
    document.getElementById("loading").value = points[1] || "";
    document.getElementById("unloading").value = points[2] || "";

    resultBox.innerText =
      "Взял из Google Maps:\n" +
      points.map((p, i) => `${i + 1}. ${p}`).join("\n");

  } catch (e) {
    resultBox.innerText = e.message;
  }
});
function formatCountries(kmByCountry) {
  let text = "";

  for (const [country, km] of Object.entries(kmByCountry)) {
    text += `${country}: ${km} км\n`;
  }

  return text.trim();
}
document.getElementById("calc").addEventListener("click", async () => {
  const resultBox = document.getElementById("result");

  const payload = {
    truck_location: document.getElementById("truck").value,
    loading: document.getElementById("loading").value,
    unloading: document.getElementById("unloading").value,
    price: Number(document.getElementById("price").value),
    consumption: 15.5
  };

  resultBox.innerText = "Считаю...";

  try {
    const response = await fetch("http://localhost:8000/calculate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.error) {
      resultBox.innerText = data.error;
      return;
    }

    const decision =
      data.net_rate >= 0.45 ? "🟢 GOOD" :
      data.net_rate >= 0.30 ? "🟡 OK" :
      "🔴 BAD";

    resultBox.innerText =
      `${decision}\n\n` +
      `Всего: ${data.total_km} км\n` +
      `Время: ${data.duration_h} ч\n\n` +
      `По странам:\n${formatCountryDetails(data.country_details)}\n\n` +
      `Топливо: ${data.fuel_cost} €\n` +
      `Платки: ${data.tolls} €\n` +
      `Расходы: ${data.total_cost} €\n` +
      `Маржа: ${data.margin} €\n` +
      `Рейт: ${data.rate} €/км\n` +
      `Чистый: ${data.net_rate} €/км`;

  } catch (e) {
    resultBox.innerText = "Ошибка API. Проверь, запущен ли uvicorn.";
  }
});