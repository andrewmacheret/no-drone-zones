import base64
import gzip
import json
import os
import sqlite3
import time

import zones

DB_BUCKET = os.environ.get("DB_BUCKET", "")
DB_KEY = f"zones-v{zones.SCHEMA_VERSION}.sqlite"
LOCAL_DB = "/tmp/zones.sqlite"
# How often a warm Lambda checks S3 for a newer database
CHECK_SECONDS = 600
# Biggest box /zones answers, in degrees. Keeps responses to a few MB.
MAX_SPAN = 10

HEADERS = {
  "Content-Type": "application/geo+json",
  "Access-Control-Allow-Origin": "*",
  # The data changes once a day at most
  "Cache-Control": "public, max-age=3600",
  "Vary": "Accept-Encoding",
}

_db = None
_db_etag = None
_db_checked_at = 0


def lambda_handler(event, context):
  # The daily schedule sends {"refresh": true}. API Gateway events never have that key.
  if event.get("refresh"):
    return refresh(force=bool(event.get("force")))

  path = event.get("rawPath", "/")
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
