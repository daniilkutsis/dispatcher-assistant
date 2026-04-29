import os
import json
import re
import requests
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

ORS_API_KEY = os.getenv("ORS_API_KEY")
RATES_FILE = Path(__file__).parent / "country_rates.json"

TRUCK_RESTRICTIONS = {
    "height": 3.0,
    "width": 2.55,
    "length": 7.5,
    "weight": 7.2
}

COUNTRY_ID_MAP = {
    40: "AT",
    56: "BE",
    203: "CZ",
    276: "DE",
    208: "DK",
    724: "ES",
    250: "FR",
    826: "GB",
    348: "HU",
    380: "IT",
    528: "NL",
    616: "PL",
    620: "PT",
    642: "RO",
    703: "SK",
    705: "SI",
    752: "SE",
}

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://jeladjgafdnfiooadkfefibeadenmilk",
        "http://localhost",
        "http://127.0.0.1",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CalcRequest(BaseModel):
    truck_location: str
    loading: str
    unloading: str
    price: float
    consumption: float = 15.0


def load_rates():
    with open(RATES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_coords(place: str):
    if not place:
        return None

    pattern = r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$"
    match = re.match(pattern, place.strip())

    if not match:
        return None

    lat = float(match.group(1))
    lon = float(match.group(2))

    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None

    return [lon, lat]
def normalize_place(place: str):
    replacements = {
        "Бельгия": "Belgium",
        "Германия": "Germany",
        "Франция": "France",
        "Нидерланды": "Netherlands",
        "Голландия": "Netherlands",
        "Польша": "Poland",
        "Чехия": "Czech Republic",
        "Австрия": "Austria",
        "Италия": "Italy",
        "Испания": "Spain",
        "Литва": "Lithuania",
        "Латвия": "Latvia",
        "Эстония": "Estonia"
    }

    for ru, en in replacements.items():
        place = place.replace(ru, en)

    return place

def geocode(place: str):
    place = normalize_place(place)
    coords = parse_coords(place)

    if coords:
        print("PARSED COORDS:", place, "=>", coords)
        return coords

    url = "https://api.openrouteservice.org/geocode/search"

    params = {
        "api_key": ORS_API_KEY,
        "text": place,
        "size": 1,
        "boundary.rect.min_lon": -11,
        "boundary.rect.min_lat": 35,
        "boundary.rect.max_lon": 35,
        "boundary.rect.max_lat": 72,
    }

    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    data = r.json()

    if not data["features"]:
        raise ValueError(f"Не нашёл координаты в Европе: {place}")

    coords = data["features"][0]["geometry"]["coordinates"]
    label = data["features"][0]["properties"].get("label")

    print("GEOCODE:", place, "=>", label, coords)

    return coords


def truck_route(coords):
    print("ROUTE COORDS:", coords)

    url = "https://api.openrouteservice.org/v2/directions/driving-hgv"

    body = {
        "coordinates": coords,
        "extra_info": ["countryinfo"],
        "radiuses": [10000] * len(coords),
        "options": {
            "profile_params": {
                "restrictions": TRUCK_RESTRICTIONS
            }
        }
    }

    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json"
    }

    r = requests.post(url, json=body, headers=headers, timeout=60)

    if not r.ok:
        print("ORS ERROR:", r.status_code, r.text)
        return {
            "error": "ORS не нашёл грузовую дорогу рядом с одной из точек. Проверь точки или выбери ближайший город/дорогу.",
            "details": r.text
        }

    return r.json()


def country_km_from_route(route):
    summary = route["routes"][0]["summary"]
    total_km = summary["distance"] / 1000

    extras = route["routes"][0].get("extras", {})

    if "countryinfo" not in extras:
        return {}

    values = extras["countryinfo"]["values"]
    total_points = values[-1][1]

    result = {}

    for start, end, country in values:
        ratio = (end - start) / total_points
        km = total_km * ratio

        country_id = str(int(country))
        country_code = COUNTRY_MAP.get(country_id, f"UNK_{country_id}")

        result[country_code] = result.get(country_code, 0) + km

    return {k: round(v, 1) for k, v in result.items()}


@app.post("/calculate")
def calculate(req: CalcRequest):
    if not ORS_API_KEY:
        return {"error": "Нет ORS_API_KEY"}

    rates = load_rates()

    truck = geocode(req.truck_location)
    loading = geocode(req.loading)
    unloading = geocode(req.unloading)

    route = truck_route([truck, loading, unloading])

    if "error" in route:
        return route

    summary = route["routes"][0]["summary"]

    total_km = round(summary["distance"] / 1000, 1)
    duration_h = round(summary["duration"] / 3600, 2)

    km_by_country = country_km_from_route(route)

    fuel_liters = total_km * req.consumption / 100

    tolls = 0
    fuel_cost = 0
    country_details = {}

    for country, km in km_by_country.items():
        country_rate = rates.get(country, {})
        diesel = country_rate.get("diesel", 1.65)

        country_fuel = km * req.consumption / 100 * diesel

        if country_rate.get("mode") == "lsva":
            weight = country_rate.get("weight", 7.2)
            rate_per_tkm = country_rate.get("rate_per_tkm", 0.028)
            country_toll = km * weight * rate_per_tkm
        else:
            toll_per_km = country_rate.get("toll_per_km", 0)
            country_toll = km * toll_per_km

        fuel_cost += country_fuel
        tolls += country_toll

        country_details[country] = {
            "km": round(km, 1),
            "fuel": round(country_fuel, 2),
            "toll": round(country_toll, 2),
            "total": round(country_fuel + country_toll, 2)
        }
        
    total_cost = fuel_cost + tolls
    margin = req.price - total_cost

    rate = req.price / total_km if total_km else 0
    net_rate = margin / total_km if total_km else 0
    return {
        "total_km": total_km,
        "duration_h": duration_h,
        "km_by_country": km_by_country,
        "country_details": country_details,
        "fuel_liters": round(fuel_liters, 1),
        "fuel_cost": round(fuel_cost, 2),
        "tolls": round(tolls, 2),
        "total_cost": round(total_cost, 2),
        "margin": round(margin, 2),
        "rate": round(rate, 2),
        "net_rate": round(net_rate, 2)
    }