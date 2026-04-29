import math
from datetime import datetime, timedelta
import streamlit as st
import os
import requests
import json
from dotenv import load_dotenv

from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).parent / ".env")
ORS_API_KEY = os.getenv("ORS_API_KEY")
# --- НАСТРОЙКИ ---
ZONES_FILE = Path(__file__).parent / "zones.json"

def load_zones():
    with open(ZONES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

ZONES = load_zones()

DEFAULT_DIESEL_PRICE = 1.65
DEFAULT_CONSUMPTION = 11.0

# --- ФУНКЦИИ ---
def parse_hours(value: str) -> float:
    value = value.strip().replace(",", ".")
    if ":" in value:
        h, m = value.split(":")
        return float(h) + float(m) / 60
    return float(value)

def detect_zone(postal: str):
    if not postal:
        return "UNKNOWN", "нет данных", "зона не указана"

    clean = postal.upper().replace(" ", "").replace("-", "")
    country = clean[:2]
    index = clean[2:]

    matches = []

    for zone in ZONES:
        if country not in zone["countries"]:
            continue

        prefixes = zone.get("postal_prefixes", [])

        if not prefixes:
            matches.append(zone)
            continue

        for prefix in prefixes:
            if index.startswith(prefix):
                matches.append(zone)

    if not matches:
        return "UNKNOWN", f"{country}{index[:2]}", "зона пока не настроена"

    # выбираем самое точное совпадение — самый длинный postal_prefix
    best_zone = max(
        matches,
        key=lambda z: max([len(p) for p in z.get("postal_prefixes", [])] or [0])
    )

    return best_zone["rating"], best_zone["name"], best_zone["comment"]
def geocode(place: str):
    url = "https://api.openrouteservice.org/geocode/search"
    params = {
        "api_key": ORS_API_KEY,
        "text": place,
        "size": 1,
    }

    r = requests.get(url, params=params, timeout=50)
    r.raise_for_status()
    data = r.json()

    if not data["features"]:
        raise ValueError(f"Не нашёл координаты для: {place}")

    return data["features"][0]["geometry"]["coordinates"]


def route_km(from_place: str, to_place: str):
    start = geocode(from_place)
    end = geocode(to_place)

    url = "https://api.openrouteservice.org/v2/directions/driving-hgv"

    body = {
        "coordinates": [start, end],
        "options": {
            "profile_params": {
                "restrictions": {
                    "height": 3.0,
                    "width": 2.55,
                    "length": 7.5,
                    "weight": 7.2
                }
            }
        }
    }

    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json"
    }

    r = requests.post(url, json=body, headers=headers, timeout=60)
    r.raise_for_status()
    data = r.json()

    meters = data["routes"][0]["summary"]["distance"]
    seconds = data["routes"][0]["summary"]["duration"]

    return round(meters / 1000, 1), round(seconds / 3600, 2)
## --- UI ---
st.title("🚚 Dispatcher Assistant")

diesel_price = st.number_input("Цена дизеля", value=DEFAULT_DIESEL_PRICE)
consumption = st.number_input("Расход (л/100)", value=DEFAULT_CONSUMPTION)
avg_speed = st.number_input("Средняя скорость", value=75)

st.subheader("Груз")

col1, col2 = st.columns(2)

with col1:
    current_location = st.text_input("Где сейчас машина", "")
    loading = st.text_input("Загрузка", "")
    unloading = st.text_input("Выгрузка", "")
    price = st.number_input("Ставка €", value=0)

with col2:
    manual_deadhead = st.checkbox("Подачу ввести вручную", value=False)

    if manual_deadhead:
        deadhead = st.number_input("Подача км", value=120.0)
    else:
        deadhead = 0.0

    manual_cargo_km = st.checkbox("Км груза ввести вручную", value=False)

    if manual_cargo_km:
        cargo_km = st.number_input("Км груза", value=0.0)
    else:
        cargo_km = 0.0

    tolls = st.number_input("Платки €", value=60.0)

st.subheader("РТО")
driving_left = st.text_input("Остаток вождения", "7:30")

# --- РАСЧЁТ ---
if st.button("Оценить"):
    try:
        driving_hours_left = parse_hours(driving_left)

        if not ORS_API_KEY:
            st.error("Нет ORS_API_KEY в .env")
            st.stop()

        if manual_deadhead:
            deadhead_hours = deadhead / avg_speed
        else:
            deadhead, deadhead_hours = route_km(current_location, loading)

        if manual_cargo_km:
            cargo_hours = cargo_km / avg_speed
        else:
            cargo_km, cargo_hours = route_km(loading, unloading)

        total_km = deadhead + cargo_km

        if total_km <= 0:
            st.error("Общий километраж должен быть больше 0")
            st.stop()

        driving_time = deadhead_hours + cargo_hours

        fuel = total_km * consumption / 100
        fuel_cost = fuel * diesel_price

        costs = fuel_cost + tolls
        margin = price - costs

        rate = price / total_km
        net_rate = margin / total_km

        zone, zone_name, zone_comment = detect_zone(unloading)

        breaks = int(driving_time // 4.5)
        break_time = breaks * 0.75
        total_time = driving_time + break_time

        st.subheader("Результат")

        st.write(f"Подача: {round(deadhead, 1)} км")
        st.write(f"Км груза: {round(cargo_km, 1)} км")
        st.write(f"Всего км: {round(total_km, 1)}")
        st.write(f"Рейт: {round(rate, 2)} €/км")
        st.write(f"Чистый рейт: {round(net_rate, 2)} €/км")
        st.write(f"Маржа: {round(margin)} €")
        st.write(f"Зона: {zone_name}")
        st.write(f"Комментарий по зоне: {zone_comment}")
        st.write(f"Время вождения: {round(driving_time, 2)} ч")
        st.write(f"Паузы: {breaks} × 45 мин")
        st.write(f"Общее время: {round(total_time, 2)} ч")

        if total_time <= driving_hours_left:
            st.success("🟢 УСПЕВАЕТ БЕЗ ОТДЫХА")
        elif total_time <= driving_hours_left + 9:
            st.warning("🟡 НУЖЕН 9Ч ОТДЫХ")
        else:
            st.error("🔴 СЛОЖНЫЙ ГРУЗ / РИСК ПО РТО")

        if rate > 1.05 and zone == "GOOD":
            st.success("🟢 БРАТЬ")
        elif rate > 0.9:
            st.warning("🟡 МОЖНО")
        else:
            st.error("🔴 НЕ БРАТЬ")

    except Exception as e:
        st.error(f"Ошибка: {e}")