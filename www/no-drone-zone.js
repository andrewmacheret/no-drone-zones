"use strict";

var NoDroneZone = function($options) {
  var $public = this;
  var $private = {
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

      return this;
    },

    initEvents: function() {
      var maxDistance = document.getElementById('max-distance');
      var onMaxDistance = function() {
        this.maxDistance = parseFloat(maxDistance.value);
        this.updateNearest();
      }.bind(this);
      maxDistance.addEventListener('input', onMaxDistance);
      maxDistance.addEventListener('change', onMaxDistance);

      var units = document.getElementById('units');
      units.addEventListener('change', function() {
        this.units = units.value;
        this.updateNearest();
      }.bind(this));
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
      status.classList.remove('error');
      status.textContent = text;
      status.hidden = !text;
    },

    showError: function(text) {
      var status = document.getElementById('status');
      status.hidden = false;
      status.classList.add('error');
      status.setAttribute('role', 'alert');
      status.textContent = text;
    },

    showNearest: function(nearest) {
      var ul = document.createElement('ul');
      nearest.forEach(function(place) {
        var className = place.distance > 0 ? 'outside' : 'inside';
        var distance = place.distance > 0
          ? place.distance.toPrecision(3) + ' ' + place.units + ' away from '
          : (-place.distance).toPrecision(3) + ' ' + place.units + ' inside ';
        var placeName = place.feature.properties.name || place.feature.properties['INSTALLATI'] || place.feature.properties['PARKNAME'];
        //var text = distance + placeName;

        var link = document.createElement('a');
        link.setAttribute('href', '#');
        link.textContent = placeName;
        link.addEventListener('click', function(e) {
          e.preventDefault();
          this.map.showInfo(placeName);
        }.bind(this));

        var li = document.createElement('li');
        li.textContent = distance;
        li.classList.add(className);
        li.append(link);

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

    start: function() {
      if (!navigator.geolocation) {
        this.showError('Your browser doesn\'t support location, which this page needs.');
        return;
      }

      this.geo.loadJSONs({
        urls: [
          /*'https://raw.githubusercontent.com/mapbox/drone-feedback/master/sources/geojson/*/ '5_mile_airport.geojson',
          /*'https://raw.githubusercontent.com/mapbox/drone-feedback/master/sources/geojson/*/ 'us_military.geojson',
          /*'https://raw.githubusercontent.com/mapbox/drone-feedback/master/sources/geojson/*/ 'us_national_park.geojson'
        ]
      }, function(geoJSONs, err) {
        if (err) {
          console.error(err);
          this.showError('Could not load the no-drone zones: ' + (err.statusText || err));
          return;
        }

        this.map.addGeoJSONs(geoJSONs);

        this.watcher.startWatching(function(position, err) {
          if (err) {
            console.error(err);
            this.showError(err.code === 1
              ? 'Location access was denied. Allow location for this site, then reload.'
              : 'Could not get your location: ' + err.message);
            return;
          }

          console.log(new Date(), position);

          this.position = position;
          this.showStatus('');

          this.showPosition(position);

          this.map.setPosition(position, function(gmap, err) {
            if (err) {
              console.error(this.map, err);
              return;
            }

            // do nothing?
          }.bind(this));

          this.updateNearest();

        }.bind(this));
      
      }.bind(this));

    },

    updateNearest: function() {
      if (!this.position) {
        return;
      }

      var nearest = this.geo.findNearest({
        position: this.position,
        maxDistance: this.maxDistance,
        units: this.units
      });

      this.showNearest(nearest);
    }
  }.init();
};
