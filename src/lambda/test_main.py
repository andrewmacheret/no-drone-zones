import base64
import gzip
import json
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

import main
import zones


def square(lon, lat, size=0.1):
  return {"type": "Polygon", "coordinates": [[
    [lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]
  ]]}


FEATURES = {
  "airport": [
    {"type": "Feature", "properties": {"NAME": "SAN FRANCISCO CLASS B"}, "geometry": square(-122.4, 37.6)},
    # Bad rows get skipped
    {"type": "Feature", "properties": {"NAME": "NO SHAPE"}, "geometry": None},
    {"type": "Feature", "properties": {"NAME": "A POINT"}, "geometry": {"type": "Point", "coordinates": [0, 0]}},
  ],
  "security": [
    {"type": "Feature", "properties": {"Base": " ", "Facility": "Minot H-2"}, "geometry": square(-101.3, 48.4)},
  ],
  "prohibited": [
    {"type": "Feature", "properties": {"NAME": "P-40", "CITY": "THURMONT"}, "geometry": square(-77.5, 39.6)},
    {"type": "Feature", "properties": {"NAME": "P3002", "CITY": None}, "geometry": square(145.7, 15.2)},
  ],
  "park": [
    {"type": "Feature", "properties": {"UNIT_NAME": "Golden Gate National Recreation Area"}, "geometry": {
      "type": "MultiPolygon",
      "coordinates": [square(-122.6, 37.8)["coordinates"], square(-122.5, 37.5)["coordinates"]],
    }},
  ],
}

BAY_AREA = (-123.0, 37.0, -122.0, 38.0)


class DbTestCase(unittest.TestCase):
  @classmethod
  def setUpClass(cls):
    cls.tmp = tempfile.TemporaryDirectory()
    cls.path = os.path.join(cls.tmp.name, "zones.sqlite")
    zones.build_db(cls.path, FEATURES, "airport=1")
    cls.db = sqlite3.connect(cls.path)

  @classmethod
  def tearDownClass(cls):
    cls.db.close()
    cls.tmp.cleanup()


class TestBuildDb(DbTestCase):
  def test_names(self):
    names = [row[0] for row in self.db.execute("select name from zones order by id")]
    self.assertEqual(names, [
      "San Francisco Class B",
      "Minot H-2",
      "Thurmont (P-40)",
      "P3002",
      "Golden Gate National Recreation Area",
    ])

  def test_bbox_covers_every_polygon(self):
    row = self.db.execute("select min_lon, min_lat, max_lon, max_lat from zones where kind = 'park'").fetchone()
    self.assertEqual(row, (-122.6, 37.5, -122.4, 37.9))

  def test_sources(self):
    rows = self.db.execute("select kind, count from sources").fetchall()
    self.assertEqual(rows, [("airport", 1), ("security", 1), ("prohibited", 2), ("park", 1)])

  def test_empty_source_fails(self):
    with self.assertRaises(RuntimeError):
      zones.build_db(os.path.join(self.tmp.name, "empty.sqlite"), {**FEATURES, "park": []})


class TestFindZones(DbTestCase):
  def test_only_zones_in_the_box(self):
    body = json.loads(main.find_zones(self.db, BAY_AREA))
    self.assertEqual(body["type"], "FeatureCollection")
    self.assertEqual([f["properties"] for f in body["features"]], [
      {"kind": "airport", "name": "San Francisco Class B"},
      {"kind": "park", "name": "Golden Gate National Recreation Area"},
    ])
    self.assertEqual(body["features"][0]["geometry"], square(-122.4, 37.6))
    self.assertEqual(len(body["sources"]), 4)
    self.assertTrue(body["built_at"])

  def test_empty_box(self):
    body = json.loads(main.find_zones(self.db, (0, 0, 1, 1)))
    self.assertEqual(body["features"], [])


class TestHandler(DbTestCase):
  def call(self, bbox, path="/zones", headers=None):
    event = {"rawPath": path, "queryStringParameters": {"bbox": bbox} if bbox else None, "headers": headers or {}}
    with mock.patch.object(main, "get_db", return_value=self.db):
      return main.lambda_handler(event, None)

  def test_zones(self):
    result = self.call("-123,37,-122,38")
    self.assertEqual(result["statusCode"], 200)
    self.assertEqual(result["headers"]["Vary"], "Accept-Encoding, Origin")
    self.assertEqual(result["headers"]["X-Robots-Tag"], "noindex")
    self.assertEqual(len(json.loads(result["body"])["features"]), 2)

  def test_gzip(self):
    result = self.call("-123,37,-122,38", headers={"accept-encoding": "gzip, br"})
    self.assertEqual(result["headers"]["Content-Encoding"], "gzip")
    self.assertTrue(result["isBase64Encoded"])
    body = json.loads(gzip.decompress(base64.b64decode(result["body"])))
    self.assertEqual(len(body["features"]), 2)

  def test_bad_bbox(self):
    for bbox in (None, "1,2,3", "a,b,c,d", "-122,38,-123,37", "-200,0,0,1", "-130,30,-110,40"):
      with self.subTest(bbox=bbox):
        result = self.call(bbox)
        self.assertEqual(result["statusCode"], 400)
        self.assertIn("bbox", json.loads(result["body"])["errors"][0])

  def test_not_found(self):
    self.assertEqual(self.call("-123,37,-122,38", path="/nope")["statusCode"], 404)


class TestRefreshEvent(unittest.TestCase):
  @mock.patch("main.save_status")
  @mock.patch("main.refresh", return_value={"updated": True, "versions": "airport=1"})
  def test_saves_status(self, refresh, save_status):
    self.assertEqual(main.lambda_handler({"refresh": True}, None)["updated"], True)
    refresh.assert_called_once_with(force=False)
    save_status.assert_called_once_with({"ok": True, "updated": True})

  @mock.patch("main.save_status")
  @mock.patch("main.refresh", side_effect=Exception("HTTP Error 429"))
  def test_saves_the_error(self, _, save_status):
    with self.assertRaises(Exception):
      main.lambda_handler({"refresh": True}, None)
    save_status.assert_called_once_with({"ok": False, "error": "HTTP Error 429"})


class TestHealthcheck(DbTestCase):
  NOW = datetime(2026, 11, 20, 15, tzinfo=timezone.utc)

  def check(self, status):
    with mock.patch.object(main, "get_db", return_value=self.db), mock.patch.object(main, "load_status", return_value=status):
      result = main.healthcheck(self.NOW)
    return result["statusCode"], json.loads(result["body"])

  def ran(self, hours_ago):
    return (self.NOW - timedelta(hours=hours_ago)).isoformat()

  def test_ok(self):
    status, body = self.check({"ok": True, "updated": True, "checked_at": self.ran(4)})
    self.assertEqual(status, 200)
    self.assertEqual(body["checks"][0]["detail"], "ran 4 hours ago, rebuilt the zones")
    self.assertTrue(body["checks"][1]["detail"].startswith("5 zones, built "))

  def test_failed_refresh(self):
    status, body = self.check({"ok": False, "error": "HTTP Error 429", "checked_at": self.ran(4)})
    self.assertEqual(status, 503)
    self.assertEqual(body["status"], "fail")
    self.assertEqual(body["checks"][0]["detail"], "failed 4 hours ago: HTTP Error 429")

  def test_missed_a_day(self):
    status, body = self.check({"ok": True, "checked_at": self.ran(28)})
    self.assertEqual(status, 503)
    self.assertEqual(body["checks"][0]["detail"], "last ran 28 hours ago")

  def test_through_the_handler(self):
    with mock.patch.object(main, "get_db", return_value=self.db), \
        mock.patch.object(main, "load_status", side_effect=Exception("NoSuchKey")):
      result = main.lambda_handler({"rawPath": "/healthcheck"}, None)
    self.assertEqual(result["statusCode"], 503)
    self.assertEqual(result["headers"]["Content-Type"], "application/json")
    self.assertEqual(result["headers"]["Cache-Control"], "no-store")


class TestFetch(unittest.TestCase):
  def test_pages(self):
    pages = [
      {"features": [1, 2], "properties": {"exceededTransferLimit": True}},
      {"features": [3]},
    ]
    with mock.patch.object(zones, "get_json", side_effect=pages) as get_json:
      self.assertEqual(zones.fetch_features(zones.SOURCES[0]), [1, 2, 3])
    self.assertEqual([c.args[1]["resultOffset"] for c in get_json.call_args_list], [0, 2])

  def test_waits_when_rate_limited(self):
    replies = [{"error": {"code": 429, "message": "Too many requests"}}, {"features": []}]
    with mock.patch.object(zones, "urlopen") as urlopen, \
         mock.patch.object(zones.json, "load", side_effect=replies), \
         mock.patch.object(zones.time, "sleep") as sleep:
      self.assertEqual(zones.get_json("https://example.com"), {"features": []})
    sleep.assert_called_once()
    self.assertEqual(urlopen.call_count, 2)

  def test_other_errors_fail(self):
    with mock.patch.object(zones, "urlopen"), \
         mock.patch.object(zones.json, "load", return_value={"error": {"code": 400, "message": "Bad"}}):
      with self.assertRaises(RuntimeError):
        zones.get_json("https://example.com")


class TestLiveSources(unittest.TestCase):
  """Hits the real FAA and NPS servers, so these catch changes on their side."""

  def test_versions(self):
    versions = zones.source_versions()
    self.assertEqual([v.split("=")[0] for v in versions.split(",")], [s["kind"] for s in zones.SOURCES])

  def test_prohibited_areas(self):
    features = zones.fetch_features(zones.SOURCES[2])
    names = [zones.prohibited_name(f["properties"]) for f in features]
    self.assertIn("District Of Columbia (P-56)", names)


if __name__ == "__main__":
  unittest.main()
