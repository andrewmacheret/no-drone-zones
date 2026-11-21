"use strict";

// The kinds of zones the API returns
var ZONE_KINDS = {
  airport: {label: 'Airport airspace', color: '#dc2626', note: 'Controlled airspace. Drones need FAA permission (LAANC) to fly here.'},
  security: {label: 'National security', color: '#16a34a', note: 'No drones below 400 feet, for national security.'},
  prohibited: {label: 'Prohibited area', color: '#9333ea', note: 'No aircraft at all, drones included.'},
  park: {label: 'National park', color: '#2563eb', note: 'The National Park Service bans drones here.'}
};

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
      $public.addZones = this.addZones.bind(this);
      $public.showInfo = this.showInfo.bind(this);
      $public.onMove = this.onMove.bind(this);
      $public.getZoom = function() { return this.map.getZoom(); }.bind(this);
      $public.getBounds = function() { return this.map.getBounds(); }.bind(this);

      // Canvas is much faster than SVG for thousands of zones
      this.map = L.map(this.mapId, {preferCanvas: true}).setView([39.8, -98.6], 4);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(this.map);

      return this;
    },

    onMove: function(callback) {
      this.map.on('moveend', callback);
    },

    setPosition: function(position) {
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
    },

    showInfo: function(id) {
      var fn = this.showInfos[id];
      if (fn) fn.call(this);
    },

    addZones: function(features) {
      features.forEach(function(feature) {
        var kind = ZONE_KINDS[feature.properties.kind] || {label: feature.properties.kind, color: 'gray', note: ''};

        L.geoJSON(feature, {
          interactive: false,
          style: {color: kind.color, weight: 1, opacity: 0.6, fillOpacity: 0.1}
        }).addTo(this.map);

        // Use text nodes so odd characters in place names can't become HTML
        var content = document.createElement('div');
        var name = document.createElement('strong');
        name.textContent = feature.properties.name;
        var note = document.createElement('div');
        note.textContent = kind.label + '. ' + kind.note;
        content.append(name, note);

        var center = turf.centroid(feature);
        var marker = L.circleMarker([center.geometry.coordinates[1], center.geometry.coordinates[0]], {
          radius: 6,
          color: 'white',
          weight: 1.5,
          fillColor: kind.color,
          fillOpacity: 1
        }).bindPopup(content).addTo(this.map);

        this.showInfos[feature.id] = function() {
          if (marker.isPopupOpen()) {
            marker.closePopup();
          } else {
            marker.openPopup();
          }
        };
      }.bind(this));
    }
  }.init();
};
