# no-drone-zones

[![Build Status](https://travis-ci.org/andrewmacheret/no-drone-zones.svg?branch=master)](https://travis-ci.org/andrewmacheret/no-drone-zones) [![License](https://img.shields.io/badge/license-MIT-lightgray.svg)](https://github.com/andrewmacheret/no-drone-zones/blob/master/LICENSE.md)

![Drone image](www/drone.png?raw=true "Drone image")

A web-based map of known no-drone-zones in your area using [Mapbox drone data](https://github.com/mapbox/drone-feedback/tree/master/sources/geojson), [Google Maps API](https://developers.google.com/maps/), [Turf.js](http://turfjs.org/), and [jQuery](https://jquery.com/).

See it running at [https://andrewmacheret.com/projects/no-drone-zones](https://andrewmacheret.com/projects/no-drone-zones).

Prereqs:
* A web server (like [Apache](https://httpd.apache.org/)).

Installation steps:
* `git clone <clone url>`

Test it:
* Open `index.html` in a browser.
 * For testing purposes, if you don't have a web server, running `python -m SimpleHTTPServer` in the project directory and navigating to [http://localhost:8000](http://localhost:8000) should do the trick.
* After a long loading period (~10 seconds on desktop browsers, longer on mobile), you should see a google map and the location of nearby drone zones.
* To troubleshoot, look for javascript errors in the browser console.

