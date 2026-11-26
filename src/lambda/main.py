import base64
import gzip
import json
import os
import sqlite3
import time
from datetime import datetime, timezone

import zones

DB_BUCKET = os.environ.get("DB_BUCKET", "")
DB_KEY = f"zones-v{zones.SCHEMA_VERSION}.sqlite"
LOCAL_DB = "/tmp/zones.sqlite"
# How often a warm Lambda checks S3 for a newer database
CHECK_SECONDS = 600
# Biggest box /zones answers, in degrees. Keeps responses to a few MB.
MAX_SPAN = 10
# How the last daily refresh went, for /healthcheck
STATUS_KEY = "status.json"
# The refresh runs once a day, so anything older means it missed a day
STATUS_MAX_HOURS = 26

HEADERS = {
  "Content-Type": "application/geo+json",
  # The data changes once a day at most
  "Cache-Control": "public, max-age=3600",
  # API Gateway adds Access-Control-Allow-Origin for andrewmacheret.com and localhost:8000 only
  # so a cached response has to be kept per origin
  "Vary": "Accept-Encoding, Origin",
  # Keeps Google from listing the API in search results
  "X-Robots-Tag": "noindex",
}

_db = None
_db_etag = None
_db_checked_at = 0


def lambda_handler(event, context):
  # The daily schedule sends {"refresh": true}. API Gateway events never have that key.
  if event.get("refresh"):
    return refresh_and_save_status(force=bool(event.get("force")))

  path = event.get("rawPath", "/")
  if path == "/healthcheck":
    return healthcheck()
  if path != "/zones":
    return error(404, f"Not found: {path}. Try /zones?bbox=west,south,east,north")

  try:
    box = parse_bbox((event.get("queryStringParameters") or {}).get("bbox"))
  except ValueError as ex:
    return error(400, str(ex))

  try:
    body = find_zones(get_db(), box)
  except Exception as ex:
    return error(500, str(ex))

  accept = (event.get("headers") or {}).get("accept-encoding", "")
  if "gzip" in accept:
    return {
      "statusCode": 200,
      "headers": {**HEADERS, "Content-Encoding": "gzip"},
      "isBase64Encoded": True,
      "body": base64.b64encode(gzip.compress(body.encode(), 6)).decode(),
    }
  return {"statusCode": 200, "headers": HEADERS, "body": body}


def error(status, message):
  headers = {**HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store"}
  return {"statusCode": status, "headers": headers, "body": json.dumps({"errors": [message]})}


def parse_bbox(value):
  if not value:
    raise ValueError("Missing bbox. Use bbox=west,south,east,north in degrees.")
  try:
    west, south, east, north = (float(v) for v in value.split(","))
  except ValueError:
    raise ValueError("bbox needs 4 numbers: west,south,east,north")
  if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
    raise ValueError("bbox is out of range or backwards. Use west,south,east,north.")
  if east - west > MAX_SPAN or north - south > MAX_SPAN:
    raise ValueError(f"bbox is too big. Keep it under {MAX_SPAN} degrees each way.")
  return west, south, east, north


def find_zones(db, box):
  west, south, east, north = box
  features = [row[0] for row in db.execute(
    "select feature from zones where max_lon >= ? and min_lon <= ? and max_lat >= ? and min_lat <= ? order by id",
    (west, east, south, north)
  )]
  built_at = db.execute("select built_at from info").fetchone()[0]
  sources = [
    {"kind": kind, "title": title, "page": page, "count": count}
    for kind, title, page, count in db.execute("select kind, title, page, count from sources")
  ]
  # The features are already JSON, so join them as text instead of parsing them again
  head = json.dumps({"type": "FeatureCollection", "built_at": built_at, "sources": sources})
  return head[:-1] + ', "features": [' + ",".join(features) + "]}"


def get_db():
  global _db, _db_etag, _db_checked_at
  if _db is not None and time.time() - _db_checked_at < CHECK_SECONDS:
    return _db

  import boto3
  s3 = boto3.client("s3")
  try:
    etag = s3.head_object(Bucket=DB_BUCKET, Key=DB_KEY)["ETag"]
  except Exception:
    # Keep using the old copy if S3 has a hiccup
    if _db is not None:
      return _db
    raise

  if etag != _db_etag:
    s3.download_file(DB_BUCKET, DB_KEY, LOCAL_DB + ".new")
    if _db is not None:
      _db.close()
    os.replace(LOCAL_DB + ".new", LOCAL_DB)
    _db = sqlite3.connect(f"file:{LOCAL_DB}?mode=ro", uri=True)
    _db_etag = etag
  _db_checked_at = time.time()
  return _db


def refresh_and_save_status(force=False):
  try:
    result = refresh(force=force)
  except Exception as ex:
    save_status({"ok": False, "error": str(ex)})
    raise
  save_status({"ok": True, "updated": result["updated"]})
  return result


def save_status(status):
  import boto3
  status = {**status, "checked_at": datetime.now(timezone.utc).isoformat()}
  boto3.client("s3").put_object(Bucket=DB_BUCKET, Key=STATUS_KEY, Body=json.dumps(status),
                                ContentType="application/json")


def load_status():
  import boto3
  return json.loads(boto3.client("s3").get_object(Bucket=DB_BUCKET, Key=STATUS_KEY)["Body"].read())


def healthcheck(now=None):
  """GET /healthcheck, for the daily canary (github.com/andrewmacheret/canary).
  It's public, so it reads how the last refresh went instead of calling the FAA, which limits requests."""
  now = now or datetime.now(timezone.utc)
  checks = [run_check("Daily FAA and NPS refresh", lambda: refresh_status(now)), run_check("Zones", zones_status)]
  ok = all(c["ok"] for c in checks)
  headers = {**HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store"}
  return {
    "statusCode": 200 if ok else 503,
    "headers": headers,
    "body": json.dumps({"status": "ok" if ok else "fail", "checks": checks}),
  }


def run_check(name, check):
  try:
    return {"name": name, "ok": True, "detail": check()}
  except Exception as ex:
    return {"name": name, "ok": False, "detail": str(ex)}


def refresh_status(now):
  try:
    status = load_status()
  except Exception as ex:
    raise RuntimeError(f"couldn't read {STATUS_KEY}: {ex}")
  hours = (now - datetime.fromisoformat(status["checked_at"])).total_seconds() / 3600
  if not status["ok"]:
    raise RuntimeError(f"failed {hours:.0f} hours ago: {status['error']}")
  if hours > STATUS_MAX_HOURS:
    raise RuntimeError(f"last ran {hours:.0f} hours ago")
  return f"ran {hours:.0f} hours ago, {'rebuilt the zones' if status.get('updated') else 'sources unchanged'}"


def zones_status():
  db = get_db()
  count = db.execute("select count(*) from zones").fetchone()[0]
  built_at = db.execute("select built_at from info").fetchone()[0]
  if not count:
    raise RuntimeError("the database has no zones")
  return f"{count} zones, built {built_at}"


def refresh(force=False):
  import boto3
  s3 = boto3.client("s3")

  versions = zones.source_versions()
  if not force and versions:
    try:
      current = s3.head_object(Bucket=DB_BUCKET, Key=DB_KEY)["Metadata"].get("source-versions")
    except s3.exceptions.ClientError:
      current = None
    if current == versions:
      return {"updated": False, "versions": versions}

  features = {source["kind"]: zones.fetch_features(source) for source in zones.SOURCES}
  build_path = "/tmp/zones-build.sqlite"
  zones.build_db(build_path, features, versions)
  s3.upload_file(build_path, DB_BUCKET, DB_KEY, ExtraArgs={"Metadata": {"source-versions": versions}})
  os.remove(build_path)
  return {"updated": True, "versions": versions, "counts": {kind: len(f) for kind, f in features.items()}}
