# no-drone-zones

![Drone image](drone.png?raw=true "Drone image")

A web-based map of known no-drone-zones in your area using [jQuery](https://jquery.com/), [Mapbox drone data](https://github.com/mapbox/drone-feedback/tree/master/sources/geojson), [Google Maps API](https://developers.google.com/maps/), and [Turf.js](http://turfjs.org/).

See it running at [http://andrewmacheret.com/projects/no-drone-zones](http://andrewmacheret.com/projects/no-drone-zones).

Prereqs:
* A web server (like [Apache](https://httpd.apache.org/)).

Installation steps:
* `git clone <clone url>`

Test it:
* Open `index.html` in a browser.
 * For testing purposes, if you don't have a web server, running `python -m SimpleHTTPServer` in the project directory and navigating to [http://localhost:8000](http://localhost:8000) should do the trick.
* After a long loading period (~10 seconds on desktop browsers, longer on mobile), you should see a google map and the location of nearby drone zones.
* To troubleshoot, look for javascript errors in the browser console.

