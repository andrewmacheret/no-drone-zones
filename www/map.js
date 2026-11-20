"use strict";

// Don't call this Map. That would replace the browser's built-in Map.
var DroneMap = function($options) {
  var $public = this;
  var $private = {
    showInfos: {},

    init: function() {
      if (!$options) $options = {};
      this.mapId = $options.mapId;
      this.zoom = $options.zoom || 9;
      this.centerIcon = L.icon({
        iconUrl: 'gpsloc.png',
        iconSize: [15, 15],
        iconAnchor: [7, 7]
      });
      this.centerCircleOptions = $options.centerCircleOptions || {
        interactive: false,
        color: '#1bb6ff',
        opacity: 0.4,
        weight: 1,
        fillColor: '#61a0bf',
        fillOpacity: 0.4
      };

      $public.setPosition = this.setPosition.bind(this);
      $public.addGeoJSONs = this.addGeoJSONs.bind(this);
      $public.showError = this.showError.bind(this);
      $public.showInfo = this.showInfo.bind(this);

      // Canvas is much faster than SVG for thousands of zones
      this.map = L.map(this.mapId, {preferCanvas: true}).setView([39.8, -98.6], 4);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(this.map);

      return this;
    },

    setPosition: function(position, callback) {
      var center = [position.coords.latitude, position.coords.longitude];

      if (!this.centerMarker) {
        this.centerMarker = L.marker(center, {
          icon: this.centerIcon,
          interactive: false,
          keyboard: false,
          title: 'Current Location',
          zIndexOffset: 1000
        }).addTo(this.map);

        // also center the map on the first position
        this.map.setView(center, this.zoom);
      } else {
        this.centerMarker.setLatLng(center);
      }

      if (!this.centerCircle) {
        this.centerCircle = L.circle(center, Object.assign({radius: position.coords.accuracy}, this.centerCircleOptions))
          .addTo(this.map);
      } else {
        this.centerCircle.setLatLng(center);
        this.centerCircle.setRadius(position.coords.accuracy);
      }

      callback && callback();
    },

    showError: function(err) {
      console.error(err);
    },

    showInfo: function(placeName) {
      var fn = this.showInfos[placeName];
      if (fn) fn.call(this);
    },

    addGeoJSONs: function(geoJSONs, callback) {
      var colors = ['red', 'green', 'blue'];

      geoJSONs.forEach(function(geoJSON, g) {
        var color = colors[g % colors.length];

        L.geoJSON(geoJSON, {
          interactive: false,
          style: {color: color, weight: 1, opacity: 0.6, fillOpacity: 0.1}
        }).addTo(this.map);

        geoJSON.features.forEach(function(feature) {
          var placeName = feature.properties.name || feature.properties['INSTALLATI'] || feature.properties['PARKNAME'];
          var center = turf.centroid(feature);

          // Use a text node so odd characters in place names can't become HTML
          var content = document.createElement('div');
          content.textContent = placeName;

          var marker = L.circleMarker([center.geometry.coordinates[1], center.geometry.coordinates[0]], {
            radius: 6,
            color: 'white',
            weight: 1.5,
            fillColor: color,
            fillOpacity: 1
          }).bindPopup(content).addTo(this.map);

          this.showInfos[placeName] = function() {
            if (marker.isPopupOpen()) {
              marker.closePopup();
            } else {
              marker.openPopup();
            }
          };
        }.bind(this));
      }.bind(this));

      callback && callback();
    }
  }.init();
};
