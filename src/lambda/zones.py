"""Downloads FAA and National Park Service zones and saves them in a SQLite file."""

import json
import sqlite3
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# Bump this when the database layout changes, so the Lambda builds a new file
SCHEMA_VERSION = 1

USER_AGENT = "no-drone-zones (https://github.com/andrewmacheret/no-drone-zones)"
FAA = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services"
NPS = "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services"

# Simplify shapes to about 50 meters so the whole US fits in a few MB
SIMPLIFY_DEGREES = 0.0005


def airport_name(p):
  return p["NAME"].title()


def security_name(p):
  return (p.get("Base") or "").strip() or (p.get("Facility") or "").strip() or "National security area"


def prohibited_name(p):
  city = (p.get("CITY") or "").strip()
  return f"{city.title()} ({p['NAME']})" if city else p["NAME"]


def park_name(p):
  return p["UNIT_NAME"]


SOURCES = [
  {
    "kind": "airport",
    "title": "FAA Class Airspace",
    "page": "https://adds-faa.opendata.arcgis.com/datasets/c6a62360338e408cb1512366ad61559e_0",
    "url": f"{FAA}/Class_Airspace/FeatureServer/0",
    # Controlled airspace that starts at the ground. Drones need FAA permission (LAANC) to fly here.
    "where": "LOWER_CODE = 'SFC' AND LOCAL_TYPE IN ('CLASS_B','CLASS_C','CLASS_D','CLASS_E2','CLASS_E3','CLASS_E4')",
    "fields": "NAME",
    "order": "OBJECTID",
    "name": airport_name,
  },
  {
    "kind": "security",
    "title": "FAA National Security UAS Flight Restrictions",
    "page": "https://udds-faa.opendata.arcgis.com/datasets/0270b9d8a5d34217856cc03aaf833309_0",
    "url": f"{FAA}/DoD_Mar_13/FeatureServer/0",
    "where": "1=1",
    "fields": "Base,Facility",
    "order": "OBJECTID",
    "name": security_name,
  },
  {
    "kind": "prohibited",
    "title": "FAA Prohibited Areas",
    "page": "https://adds-faa.opendata.arcgis.com/datasets/faa::prohibited-areas/about",
    "url": f"{FAA}/Prohibited_Areas/FeatureServer/0",
    "where": "1=1",
    "fields": "NAME,CITY",
    "order": "OBJECTID",
    "name": prohibited_name,
  },
  {
    "kind": "park",
    "title": "National Park Service Boundaries",
    "page": "https://irma.nps.gov/DataStore/Reference/Profile/2321443",
    "url": f"{NPS}/National_Park_Service_Boundaries/FeatureServer/0",
    "where": "1=1",
    "fields": "UNIT_NAME",
    "order": "FID",
    "name": park_name,
  },
]


def get_json(url, params=None, retries=3):
  """POSTs to an ArcGIS URL and returns the JSON. Waits and retries when the server says slow down."""
  data = urlencode({"f": "json", **(params or {})}).encode()
  for attempt in range(retries + 1):
    with urlopen(Request(url, data=data, headers={"User-Agent": USER_AGENT}), timeout=120) as conn:
      result = json.load(conn)
    error = result.get("error")
    if not error:
      return result
    # The FAA server allows a set amount of work per minute, then answers 429
    if error.get("code") == 429 and attempt < retries:
      time.sleep(61)
      continue
    raise RuntimeError(f"{url}: {error.get('code')} {error.get('message')}")


def source_versions():
  """The last edit time of each source, like 'airport=1793274474770,...'. Empty if any are unknown."""
  versions = []
  for source in SOURCES:
    info = get_json(source["url"]).get("editingInfo") or {}
    edited = info.get("dataLastEditDate") or info.get("lastEditDate")
    if not edited:
      return ""
    versions.append(f"{source['kind']}={edited}")
  return ",".join(versions)


def fetch_features(source):
  features = []
  while True:
    page = get_json(f"{source['url']}/query", {
      "where": source["where"],
      "outFields": source["fields"],
      "orderByFields": source["order"],
      "outSR": 4326,
      "maxAllowableOffset": SIMPLIFY_DEGREES,
      "geometryPrecision": 5,
      "resultOffset": len(features),
      "f": "geojson",
    })
    features += page.get("features", [])
    if not (page.get("properties") or {}).get("exceededTransferLimit"):
      return features


def bbox(geometry):
  """[min lon, min lat, max lon, max lat] of a Polygon or MultiPolygon."""
  polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
  lons = [p[0] for polygon in polygons for ring in polygon for p in ring]
  lats = [p[1] for polygon in polygons for ring in polygon for p in ring]
  return [min(lons), min(lats), max(lons), max(lats)]


def build_db(path, features_by_kind, versions=""):
  """features_by_kind is {kind: [GeoJSON features]} in the same order as SOURCES."""
  db = sqlite3.connect(path)
  try:
    db.executescript("""
      drop table if exists zones;
      drop table if exists sources;
      drop table if exists info;
      create table zones (
        id integer primary key, kind text, name text,
        min_lon real, min_lat real, max_lon real, max_lat real,
        feature text
      );
      create table sources (kind text, title text, page text, count integer);
      create table info (built_at text, versions text);
    """)
    zone_id = 0
    for source in SOURCES:
      count = 0
      for feature in features_by_kind[source["kind"]]:
        geometry = feature.get("geometry")
        if not geometry or geometry["type"] not in ("Polygon", "MultiPolygon") or not geometry["coordinates"]:
          continue
        zone_id += 1
        count += 1
        name = source["name"](feature["properties"])
        text = json.dumps({
          "type": "Feature",
          "id": zone_id,
          "properties": {"kind": source["kind"], "name": name},
          "geometry": geometry,
        }, separators=(",", ":"))
        db.execute("insert into zones values (?, ?, ?, ?, ?, ?, ?, ?)",
                   (zone_id, source["kind"], name, *bbox(geometry), text))
      # An empty source means something broke upstream. Don't replace good data with nothing.
      if count == 0:
        raise RuntimeError(f"No zones from {source['title']}")
      db.execute("insert into sources values (?, ?, ?, ?)", (source["kind"], source["title"], source["page"], count))
    db.execute("insert into info values (?, ?)", (datetime.now(timezone.utc).isoformat(timespec="seconds"), versions))
    db.commit()
    db.execute("vacuum")
  finally:
    db.close()
