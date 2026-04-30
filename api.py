import os, json, re, requests, logging
from pathlib import Path
from math import radians, sin, cos, asin, sqrt
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

log = logging.getLogger("dispatcher-assistant")
logging.basicConfig(level=logging.INFO)

load_dotenv()
ORS_API_KEY = os.getenv("ORS_API_KEY", "")
RATES_PATH = Path("country_rates.json")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RouteRequest(BaseModel):
    truck_location: str = ""
    loading: str
    unloading: str
    price: float = 0


COUNTRY_ID_MAP = {
    # ISO numeric
    40: "AUT",
    56: "BEL",
    100: "BGR",
    191: "HRV",
    203: "CZE",
    208: "DNK",
    233: "EST",
    246: "FIN",
    250: "FRA",
    276: "DEU",
    300: "GRC",
    348: "HUN",
    372: "IRL",
    380: "ITA",
    428: "LVA",
    440: "LTU",
    442: "LUX",
    528: "NLD",
    578: "NOR",
    616: "POL",
    620: "PRT",
    642: "ROU",
    688: "SRB",
    703: "SVK",
    705: "SVN",
    724: "ESP",
    752: "SWE",
    756: "CHE",
    792: "TUR",
    804: "UKR",
    826: "GBR",

    # ORS internal IDs seen
    17: "BEL",
    49: "AUT",
    70: "FRA",
    74: "DEU",
    88: "HUN",
    97: "ITA",
    175: "HUN",
    180: "SVN",
    187: "ESP",
    193: "CHE",
    200: "FRA",
    213: "BEL",
}


def load_rates():
    if not RATES_PATH.exists():
        return {}
    with open(RATES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_place(place: str):
    place = (place or "").strip()
    place = re.sub(r"\s+", " ", place)

    # "DE, Berlin" -> "Berlin, DE"
    m = re.match(r"^([A-Z]{2})[,\s]+(.+)$", place)
    if m:
        return f"{m.group(2).strip()}, {m.group(1).strip()}"

    return place


def parse_coords(place: str):
    # accepts: "13.405,52.52"
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", place or "")
    if not m:
        return None
    return [float(m.group(1)), float(m.group(2))]


def geocode(place: str):
    place = normalize_place(place)

    if not place:
        raise HTTPException(status_code=400, detail="Пустой адрес для геокодинга")

    coords = parse_coords(place)
    if coords:
        return coords

    try:
        r = requests.get(
            "https://api.openrouteservice.org/geocode/search",
            params={
                "api_key": ORS_API_KEY,
                "text": place,
                "size": 1,
                "boundary.rect.min_lon": -11,
                "boundary.rect.min_lat": 35,
                "boundary.rect.max_lon": 35,
                "boundary.rect.max_lat": 72,
            },
            timeout=20,
        )
    except requests.Timeout:
        raise HTTPException(status_code=504, detail=f"ORS geocode timeout: {place}")
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"ORS geocode error: {e}")

    if not r.ok:
        raise HTTPException(status_code=502, detail=f"ORS geocode failed: {r.text[:500]}")

    data = r.json()

    if not data.get("features"):
        raise HTTPException(status_code=400, detail=f"Не нашёл координаты: {place}")

    return data["features"][0]["geometry"]["coordinates"]


def country_km_from_route(route):
    total_km = route["summary"]["distance"] / 1000

    values = (
        route.get("extras", {})
        .get("countryinfo", {})
        .get("values", [])
    )

    if not values:
        return {"OTHER": total_km}

    country_counts = {}

    for segment in values:
        start_idx, end_idx, country_id = segment
        country_code = COUNTRY_ID_MAP.get(country_id)

        if not country_code:
            log.warning("UNKNOWN ORS COUNTRY ID: %s", country_id)
            country_code = "OTHER"

        points_count = max(1, end_idx - start_idx)
        country_counts[country_code] = country_counts.get(country_code, 0) + points_count

    total_points = sum(country_counts.values())

    if total_points <= 0:
        return {"OTHER": total_km}

    return {
        country: total_km * count / total_points
        for country, count in country_counts.items()
    }


def build_route_coordinates(req: RouteRequest):
    coords = []

    for place in [req.truck_location, req.loading, req.unloading]:
        place = (place or "").strip()
        if place:
            coords.append(geocode(place))

    deduped = []

    for coord in coords:
        if not deduped or coord != deduped[-1]:
            deduped.append(coord)

    if len(deduped) < 2:
        raise HTTPException(
            status_code=400,
            detail="Need at least loading and unloading coordinates",
        )

    log.info("ROUTE COORDS: %s", deduped)
    return deduped


def request_ors_route(coordinates):
    body = {
        "coordinates": coordinates,
        "radiuses": [25000] * len(coordinates),
        "geometry": True,
        "extra_info": ["countryinfo"],
        "options": {
            "vehicle_type": "hgv",
            "profile_params": {
                "restrictions": {
                    "height": 3.0,
                    "width": 2.55,
                    "length": 7.5,
                    "weight": 7.2,
                }
            },
        },
    }

    try:
        response = requests.post(
            "https://api.openrouteservice.org/v2/directions/driving-hgv",
            json=body,
            headers={
                "Authorization": ORS_API_KEY,
                "Content-Type": "application/json",
            },
            timeout=60,
        )
    except requests.Timeout:
        raise HTTPException(status_code=504, detail="ORS route timeout")
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"ORS route error: {e}")

    try:
        data = response.json()
    except Exception:
        data = {"raw": response.text[:500]}

    if not response.ok:
        log.warning("ORS ROUTE FAILED %s: %s", response.status_code, data)
        raise HTTPException(
            status_code=400,
            detail="ORS не нашёл HGV route. Проверь адреса или выбери ближайший город/дорогу.",
        )

    return data


def make_decision(margin: float, net_rate: float, rate: float):
    if margin >= 250 and net_rate >= 0.35 and rate >= 0.75:
        return "TAKE"
    if margin >= 80 and net_rate >= 0.18:
        return "MAYBE"
    return "SKIP"


@app.post("/calculate")
def calculate(req: RouteRequest):
    rates = load_rates()
    coordinates = build_route_coordinates(req)

    data = request_ors_route(coordinates)
    route = data["routes"][0]

    total_km = route["summary"]["distance"] / 1000
    duration_h = route["summary"]["duration"] / 3600

    km_by_country = country_km_from_route(route)

    fuel_per_100km = 15

    country_details = {}
    total_toll = 0
    total_fuel_cost = 0
    total_fuel_liters = 0

    for country, km in km_by_country.items():
        country_rate = rates.get(country, {})
        diesel_price = country_rate.get("diesel", 1.65)
        toll_per_km = country_rate.get("toll_per_km", 0)

        fuel_liters_part = km * fuel_per_100km / 100
        fuel_cost_part = fuel_liters_part * diesel_price
        toll = km * toll_per_km
        country_total = fuel_cost_part + toll

        total_fuel_liters += fuel_liters_part
        total_fuel_cost += fuel_cost_part
        total_toll += toll

        country_details[country] = {
            "km": round(km, 1),
            "diesel": diesel_price,
            "fuel_liters": round(fuel_liters_part, 1),
            "fuel": round(fuel_cost_part, 1),
            "toll_per_km": toll_per_km,
            "toll": round(toll, 1),
            "total": round(country_total, 1),
        }

    fuel_liters = total_fuel_liters
    fuel_cost = total_fuel_cost
    total_cost = fuel_cost + total_toll
    margin = req.price - total_cost
    rate = req.price / total_km if total_km else 0
    net_rate = margin / total_km if total_km else 0

    return {
        "total_km": round(total_km, 1),
        "duration_h": round(duration_h, 2),
        "km_by_country": {
            country: round(km, 1)
            for country, km in km_by_country.items()
        },
        "country_details": country_details,
        "fuel_liters": round(fuel_liters, 1),
        "fuel_cost": round(fuel_cost, 1),
        "tolls": round(total_toll, 1),
        "total_cost": round(total_cost, 1),
        "margin": round(margin, 1),
        "rate": round(rate, 2),
        "net_rate": round(net_rate, 2),
        "decision": make_decision(margin, net_rate, rate),
    }