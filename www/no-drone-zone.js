"use strict";

var NoDroneZone = function($options) {
  var $public = this;
  var $private = {
    init: function() {
      $public.start = this.start.bind(this);

      this.geo = new Geo();

      this.map = new Map({
        mapId: 'map'
      });

      this.watcher = new LocationWatcher();

      this.maxDistance = parseFloat($('#max-distance').val());
      this.units = $('#units').val();

      this.initEvents();

      return this;
    },

    initEvents: function() {
      $('#max-distance').keypress(function() {
        this.maxDistance = parseFloat($('#max-distance').val());
        this.updateNearest();
      }.bind(this)).change(function() {
        this.maxDistance = parseFloat($('#max-distance').val());
        this.updateNearest();
      }.bind(this));

      $('#units').keypress(function() {
        this.units = $('#units').val();
        this.updateNearest();
      }.bind(this)).change(function() {
        this.units = $('#units').val();
        this.updateNearest();
      }.bind(this));
    },

    showPosition: function(position) {
      $('#latitude').text('Latitude: ' + position.coords.latitude.toPrecision(5) + '\u00b0');
      $('#longitude').text('Longitude: ' + position.coords.longitude.toPrecision(5) + '\u00b0');
      $('#accuracy').text('Accuracy: \u00b1' + position.coords.accuracy + 'm (95% confidence)');
      $('#altitude').text(position.coords.altitude != null ? 'Altitude: ' + position.coords.altitude + 'm' : '');
      $('#altitude').text(position.coords.altitudeAccuracy != null ? 'Altitude Accuracy: \u00b1' + position.coords.altitudeAccuracy + 'm (95% confidence)' : '');
      $('#time').text('Time: ' + new Date(position.timestamp));
    },

    showNearest: function(nearest) {
      var ul = $('<ul/>');
      $.each(nearest, function(i, place) {
        var className = place.distance > 0 ? 'outside' : 'inside';
        var distance = place.distance > 0
          ? place.distance.toPrecision(3) + ' ' + place.units + ' away from '
          : (-place.distance).toPrecision(3) + ' ' + place.units + ' inside ';
        var placeName = place.feature.properties.name || place.feature.properties['INSTALLATI'] || place.feature.properties['PARKNAME'];
        //var text = distance + placeName;

        var link = $('<a/>', {
          href: '#',
          text: placeName
        }).click(function() {
          this.map.showInfo(placeName);
        }.bind(this));

        var li = $('<li/>', {
          text: distance
        }).addClass(className).append(link);

        ul.append(li);
      }.bind(this));
      $('#nearest').empty().append(ul);

      $('#source').show();
    },

    start: function() {
      if (!navigator.geolocation) {
        $('#content').html('Geolocation is required for this demo. Try a <a href="https://www.google.com/chrome/browser/">different browser</a>.');
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
          console.error(this.watcher, err);
          $('#distance').text('Error loading: ' + (err.statusText || err));
          return;
        }

        this.map.addGeoJSONs(geoJSONs);

        this.watcher.startWatching(function(position, err) {
          if (err) {
            console.error(this.watcher, err);
            this.map.showError(err);
            return;
          }

          console.log(new Date(), position);

          this.position = position;

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
