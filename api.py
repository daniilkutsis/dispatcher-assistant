import os
import json
import re
import requests
from math import radians, cos, sin, asin, sqrt
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
ORS_API_KEY = os.getenv("ORS_API_KEY", "YOUR_ORS_KEY")
print("ORS key loaded:", ORS_API_KEY[:8], "...")
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
    # ISO numeric fallback
    40: "AT",
    56: "BE",
    100: "BG",
    191: "HR",
    203: "CZ",
    208: "DK",
    233: "EE",
    246: "FI",
    250: "FR",
    276: "DE",
    300: "GR",
    348: "HU",
    372: "IE",
    380: "IT",
    428: "LV",
    440: "LT",
    442: "LU",
    528: "NL",
    616: "PL",
    620: "PT",
    642: "RO",
    703: "SK",
    705: "SI",
    724: "ES",
    752: "SE",
    756: "CH",
    826: "GB",

    # ORS countryinfo internal IDs seen in responses
    187: "ES",
    70: "FR",
    97: "IT",
    180: "SI",
    88: "HU",
}


def load_rates():
    if not RATES_PATH.exists():
        return {}

    with open(RATES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def clean_place(place: str):
    place = (place or "").strip()

    match = re.match(r"^([A-Z]{2})[,\s]+(.+)$", place)
    if match:
        return match.group(2).strip(), match.group(1).strip()

    return place, None


def geocode(place: str):
    query, country_code = clean_place(place)

    params = {
        "api_key": ORS_API_KEY,
        "text": query,
        "size": 1,
    }

    if country_code:
        params["boundary.country"] = country_code

    response = requests.get(
        "https://api.openrouteservice.org/geocode/search",
        params=params,
        timeout=30,
    )

    data = response.json()

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail={
                "message": f"ORS geocode HTTP error for {place}",
                "ors_response": data,
            },
        )

    if not data.get("features"):
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"Geocode failed for {place}",
                "query": query,
                "country": country_code,
                "ors_response": data,
            },
        )

    feature = data["features"][0]
    coords = feature["geometry"]["coordinates"]
    label = feature.get("properties", {}).get("label", "")

    print(f"GEOCODE: {place} => {label} {coords}")

    return coords


def haversine(coord1, coord2):
    lon1, lat1 = coord1
    lon2, lat2 = coord2

    radius_km = 6371

    dlon = radians(lon2 - lon1)
    dlat = radians(lat2 - lat1)

    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1))
        * cos(radians(lat2))
        * sin(dlon / 2) ** 2
    )

    c = 2 * asin(sqrt(a))

    return radius_km * c


def country_km_from_route(route):
    total_km = route["summary"]["distance"] / 1000

    extras = route.get("extras", {})
    countryinfo = extras.get("countryinfo", {})
    values = countryinfo.get("values", [])

    if not values:
        return {"UNK": total_km}

    country_counts = {}

    for segment in values:
        start_idx, end_idx, country_id = segment
        country_code = COUNTRY_ID_MAP.get(country_id, f"UNK_{country_id}")
        if country_code.startswith("UNK_"):
            print("UNKNOWN COUNTRY ID:", country_id)
        points_count = max(1, end_idx - start_idx)

        country_counts[country_code] = country_counts.get(country_code, 0) + points_count

    total_points = sum(country_counts.values())

    if total_points <= 0:
        return {"UNK": total_km}

    return {
        country: total_km * count / total_points
        for country, count in country_counts.items()
    }


def build_route_coordinates(req: RouteRequest):
    coords = []

    places = [
        req.truck_location,
        req.loading,
        req.unloading,
    ]

    for place in places:
        place = (place or "").strip()

        if not place:
            continue

        coords.append(geocode(place))

    deduped = []

    for coord in coords:
        if not deduped or coord != deduped[-1]:
            deduped.append(coord)

    if len(deduped) < 2:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Need at least loading and unloading coordinates",
                "received": {
                    "truck_location": req.truck_location,
                    "loading": req.loading,
                    "unloading": req.unloading,
                },
            },
        )

    print("ROUTE COORDS:", deduped)

    return deduped


@app.post("/calculate")
def calculate(req: RouteRequest):
    rates = load_rates()

    coordinates = build_route_coordinates(req)

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

    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
    }

    response = requests.post(
        "https://api.openrouteservice.org/v2/directions/driving-hgv",
        json=body,
        headers=headers,
        timeout=60,
    )

    data = response.json()

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "ORS route failed",
                "ors_response": data,
            },
        )

    route = data["routes"][0]

    total_km = route["summary"]["distance"] / 1000
    duration_h = route["summary"]["duration"] / 3600

    km_by_country = country_km_from_route(route)

    fuel_per_100km = 15
    fuel_price = 1.65

    fuel_liters = total_km * fuel_per_100km / 100
    fuel_cost = fuel_liters * fuel_price

    country_details = {}
    total_toll = 0

    for country, km in km_by_country.items():
        country_rate = rates.get(country, {})
        toll_per_km = country_rate.get("toll_per_km", 0)

        toll = km * toll_per_km
        fuel_part = (km / total_km) * fuel_cost if total_km else 0
        country_total = fuel_part + toll

        total_toll += toll

        country_details[country] = {
            "km": round(km, 1),
            "fuel": round(fuel_part, 1),
            "toll": round(toll, 1),
            "total": round(country_total, 1),
        }

    total_cost = fuel_cost + total_toll
    margin = req.price - total_cost
    rate = req.price / total_km if total_km else 0
    net_rate = margin / total_km if total_km else 0

    return {
        "total_km": round(total_km, 1),
        "duration_h": round(duration_h, 2),
        "km_by_country": {
            country: round(km, 1) for country, km in km_by_country.items()
        },
        "country_details": country_details,
        "fuel_liters": round(fuel_liters, 1),
        "fuel_cost": round(fuel_cost, 1),
        "tolls": round(total_toll, 1),
        "total_cost": round(total_cost, 1),
        "margin": round(margin, 1),
        "rate": round(rate, 2),
        "net_rate": round(net_rate, 2),
    }