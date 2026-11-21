"use strict";

// Add ?api=http://localhost:8000 to the page URL to try a different server
var API_URL = new URLSearchParams(location.search).get('api') || 'https://no-drone-zones.andrewmacheret.com';
// The API answers boxes up to 10 degrees each way, so stay a bit under that
var MAX_SPAN = 9.9;
// Zoomed out further than this, the map would need more than one box
var MIN_ZOOM = 8;
// The nearby list looks this far at most, so its box always fits
var MAX_KM = 200;
var KM_PER_DEGREE = 111.32;

var NoDroneZone = function($options) {
  var $public = this;
  var $private = {
    // zone id -> GeoJSON feature, for every zone loaded so far
    features: new Map(),
    // boxes already loaded, as [west, south, east, north]
    loaded: [],

    init: function() {
      $public.start = this.start.bind(this);

      this.geo = new Geo();

      this.map = new DroneMap({
        mapId: 'map'
      });

      this.watcher = new LocationWatcher();

      this.maxDistance = parseFloat(document.getElementById('max-distance').value);
      this.units = document.getElementById('units').value;

      this.initEvents();
      this.showLegend();

      return this;
    },

    initEvents: function() {
      var maxDistance = document.getElementById('max-distance');
      var onMaxDistance = function() {
        this.maxDistance = parseFloat(maxDistance.value) || 0;
        this.loadNearby();
      }.bind(this);
      maxDistance.addEventListener('input', onMaxDistance);
      maxDistance.addEventListener('change', onMaxDistance);

      var units = document.getElementById('units');
      units.addEventListener('change', function() {
        this.units = units.value;
        maxDistance.max = this.units === 'miles' ? Math.floor(MAX_KM / 1.609) : MAX_KM;
        this.loadNearby();
      }.bind(this));

      this.map.onMove(this.loadView.bind(this));
    },

    showLegend: function() {
      var legend = document.getElementById('legend');
      Object.keys(ZONE_KINDS).forEach(function(key) {
        var dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = ZONE_KINDS[key].color;
        var li = document.createElement('li');
        li.title = ZONE_KINDS[key].note;
        li.append(dot, ZONE_KINDS[key].label);
        legend.append(li);
      });
    },

    showPosition: function(position) {
      document.getElementById('latitude').textContent = 'Latitude: ' + position.coords.latitude.toPrecision(5) + '\u00b0';
      document.getElementById('longitude').textContent = 'Longitude: ' + position.coords.longitude.toPrecision(5) + '\u00b0';
      document.getElementById('accuracy').textContent = 'Accuracy: \u00b1' + position.coords.accuracy + 'm (95% confidence)';
      document.getElementById('altitude').textContent = position.coords.altitude != null ? 'Altitude: ' + position.coords.altitude + 'm' : '';
      document.getElementById('altitudeAccuracy').textContent = position.coords.altitudeAccuracy != null ? 'Altitude Accuracy: \u00b1' + position.coords.altitudeAccuracy + 'm (95% confidence)' : '';
      document.getElementById('time').textContent = 'Updated ' + new Date(position.timestamp).toLocaleTimeString();
      document.getElementById('position').hidden = false;
    },

    showStatus: function(text) {
      var status = document.getElementById('status');
      status.classList.remove('alert');
      status.textContent = text;
      status.hidden = !text;
    },

    showError: function(text) {
      var status = document.getElementById('status');
      status.hidden = false;
      status.classList.add('alert');
      status.setAttribute('role', 'alert');
      status.textContent = text;
    },

    showSources: function(data) {
      var span = document.getElementById('data-source');
      var parts = ['Zones from '];
      data.sources.forEach(function(source, i) {
        var link = document.createElement('a');
        link.href = source.page;
        link.textContent = source.title;
        if (i > 0) parts.push(i === data.sources.length - 1 ? ' and ' : ', ');
        parts.push(link);
      });
      parts.push(', updated ' + new Date(data.built_at).toLocaleDateString());
      span.replaceChildren.apply(span, parts);
    },

    showNearest: function(nearest) {
      // Some places have several shapes with the same name, so only list the closest one
      var seen = new Set();
      nearest = nearest.filter(function(place) {
        var key = place.feature.properties.kind + ' ' + place.feature.properties.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      var ul = document.createElement('ul');
      nearest.forEach(function(place) {
        var className = place.distance > 0 ? 'outside' : 'inside';
        var unit = place.units === 'miles' ? 'mi' : 'km';
        var abs = Math.abs(place.distance);
        var distance = (abs < 9.95 ? abs.toFixed(1) : Math.round(abs)) + ' ' + unit + (place.distance > 0 ? '' : ' inside');
        var placeName = place.feature.properties.name;
        var kind = ZONE_KINDS[place.feature.properties.kind];

        var dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = kind ? kind.color : 'gray';
        dot.title = kind ? kind.label : '';

        var link = document.createElement('a');
        link.setAttribute('href', '#');
        link.textContent = placeName;
        link.addEventListener('click', function(e) {
          e.preventDefault();
          this.map.showInfo(place.feature.id);
        }.bind(this));

        link.title = placeName;

        var span = document.createElement('span');
        span.className = 'distance';
        span.textContent = distance;

        var li = document.createElement('li');
        li.classList.add(className);
        li.append(dot, link, span);

        ul.append(li);
      }.bind(this));
      if (!nearest.length) {
        ul = document.createElement('p');
        ul.className = 'empty';
        ul.textContent = 'None nearby.';
      }
      document.getElementById('nearest').replaceChildren(ul);
      document.getElementById('nearest-count').textContent = nearest.length;
      var wrapper = document.getElementById('nearest-wrapper');
      if (wrapper.hidden) {
        wrapper.hidden = false;
        // start open on big screens, closed on phones so the map has room
        wrapper.open = window.matchMedia('(min-width: 701px)').matches;
      }
    },

    // Shrink a box around its center so the API will accept it
    clampBox: function(west, south, east, north) {
      var lon = (west + east) / 2;
      var lat = (south + north) / 2;
      var halfLon = Math.min((east - west) / 2, MAX_SPAN / 2);
      var halfLat = Math.min((north - south) / 2, MAX_SPAN / 2);
      return [
        Math.max(-180, lon - halfLon), Math.max(-90, lat - halfLat),
        Math.min(180, lon + halfLon), Math.min(90, lat + halfLat)
      ];
    },

    // Load the zones in a box, skipping boxes that are already loaded
    load: function(box) {
      var covered = this.loaded.some(function(b) {
        return b[0] <= box[0] && b[1] <= box[1] && b[2] >= box[2] && b[3] >= box[3];
      });
      if (covered) return Promise.resolve();

      var url = API_URL + '/zones?bbox=' + box.map(function(n) { return n.toFixed(4); }).join(',');
      return this.geo.loadJSON(url).then(function(data) {
        this.loaded.push(box);
        var added = data.features.filter(function(feature) {
          return !this.features.has(feature.id);
        }.bind(this));
        added.forEach(function(feature) {
          this.features.set(feature.id, feature);
        }.bind(this));
        this.map.addZones(added);
        this.showSources(data);
        if (this.loadFailed) {
          this.loadFailed = false;
          this.showStatus('');
        }
      }.bind(this), function(err) {
        console.error(err);
        this.loadFailed = true;
        this.showError('Could not load the no-drone zones: ' + (err.statusText || err));
      }.bind(this));
    },

    // Load the zones the map is showing, plus a margin so small pans don't need another request
    loadView: function() {
      var tooFar = this.map.getZoom() < MIN_ZOOM;
      document.getElementById('zoom-hint').hidden = !tooFar;
      if (tooFar) return;

      var bounds = this.map.getBounds().pad(0.25);
      this.load(this.clampBox(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()));
    },

    // Load the zones within the chosen distance of the current position, then update the list
    loadNearby: function() {
      if (!this.position) return;

      var km = Math.min(this.units === 'miles' ? this.maxDistance * 1.609 : this.maxDistance, MAX_KM);
      var lat = this.position.coords.latitude;
      var lon = this.position.coords.longitude;
      var dLat = km / KM_PER_DEGREE;
      var dLon = km / (KM_PER_DEGREE * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
      this.load(this.clampBox(lon - dLon, lat - dLat, lon + dLon, lat + dLat)).then(this.updateNearest.bind(this));
    },

    start: function() {
      this.loadView();

      if (!navigator.geolocation) {
        this.showError('Your browser doesn\'t support location. You can still move the map to see zones.');
        return;
      }

      this.watcher.startWatching(function(position, err) {
        if (err) {
          console.error(err);
          this.showError(err.code === 1
            ? 'Location access was denied. You can still move the map to see zones, or allow location for this site and reload.'
            : 'Could not get your location: ' + err.message);
          return;
        }

        this.position = position;
        if (!this.loadFailed) this.showStatus('');

        this.showPosition(position);
        this.map.setPosition(position);
        this.loadNearby();
      }.bind(this));
    },

    updateNearest: function() {
      if (!this.position) {
        return;
      }

      var nearest = this.geo.findNearest({
        features: Array.from(this.features.values()),
        position: this.position,
        maxDistance: Math.min(this.maxDistance, this.units === 'miles' ? MAX_KM / 1.609 : MAX_KM),
        units: this.units
      });

      this.showNearest(nearest);
    }
  }.init();
};
