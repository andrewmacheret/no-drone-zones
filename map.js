"use strict";

var Map = function($options) {
  var $public = this;
  var $private = {
    showInfos: {},

    init: function() {
      if (!$options) $options = {};
      this.mapId = $options.mapId;
      this.mapOptions = $options.mapOptions || {
        zoom: 9
      };
      this.centerMarkerOptions = $options.centerMarkerOptions || {
        clickable: false,
        flat: true,
        draggable: false,
        cursor: 'pointer',
        optimized: false,
        title: 'Current Location',
        zIndex: 2,
        icon: {
          url: 'gpsloc.png',
          anchor: new google.maps.Point(7,7),
          scaledSize: new google.maps.Size(15,15)
        }
      };
      this.centerCircleOptions = $options.centerCircleOptions || {
        clickable: false,
        strokeColor: '1bb6ff',
        strokeOpacity: 0.4,
        strokeWeight: 1,
        fillColor: '61a0bf',
        fillOpacity: 0.4,
        zIndex: 1
      };

      $public.setPosition = this.setPosition.bind(this);
      $public.addGeoJSONs = this.addGeoJSONs.bind(this);
      $public.showError = this.showError.bind(this);
      $public.showInfo = this.showInfo.bind(this);

      var mapContainer = $('#' + this.mapId)[0];
      this.map = new google.maps.Map(mapContainer, this.mapOptions);

      return this;
    },

    setPosition: function(position, callback) {
      var center = {lat: position.coords.latitude, lng: position.coords.longitude};


      if (!this.centerMarker) {
        this.centerMarkerOptions.position = center;
        this.centerMarkerOptions.map = this.map;

        this.centerMarker = new google.maps.Marker(this.centerMarkerOptions);

        // also set the center to the mark
        this.map.setCenter(center);
      } else {
        this.centerMarker.setPosition(center);
      }

      if (!this.centerCircle) {
        this.centerCircleOptions.center = center;
        this.centerCircleOptions.map = this.map;
        this.centerCircleOptions.radius = position.coords.accuracy;

        this.centerCircle = new google.maps.Circle(this.centerCircleOptions);        
      } else {
        this.centerCircle.setCenter(center);
        this.centerCircle.setRadius(position.coords.accuracy);
      }

      google.maps.event.addListenerOnce(this.map, 'idle', function() {
        callback && callback();
      });
    },

    showError: function(err) {
      google.maps.event.trigger(this.map, 'geolocation_error', err);
    },

    showInfo: function(placeName) {
      var fn = this.showInfos[placeName].bind(this);
      if (fn) fn();
    },

    addGeoJSONs: function(geoJSONs, callback) {
      var colors = ['red', 'green', 'blue'];

      $.each(geoJSONs, function(g, geoJSON) {
        this.map.data.addGeoJson(geoJSON);

        var color = colors[g % colors.length];
        var icon = {
          url: 'http://maps.google.com/mapfiles/ms/icons/' + color + '-dot.png'
        };
        
        $.each(geoJSON.features, function(f, feature) {
          var placeName = feature.properties.name || feature.properties['INSTALLATI'] || feature.properties['PARKNAME'];
          var center = turf.centroid(feature);

          var marker = new google.maps.Marker({
            position: {lat: center.geometry.coordinates[1], lng: center.geometry.coordinates[0]},
            map: this.map,
            title: placeName,
            icon: icon
          });

          var infoWindow = new google.maps.InfoWindow({
            content: placeName
          });
          var showInfo = function() {
            if (this.openWindow === infoWindow || this.openWindow != null) {
              this.openWindow.close();
              this.openWindow = null;
              return;
            }

            infoWindow.open(this.map, marker);

            this.openWindow = infoWindow;
          };

          marker.addListener('click', showInfo.bind(this));

          this.showInfos[placeName] = showInfo;

        }.bind(this));
      }.bind(this));

      google.maps.event.addListenerOnce(this.map, 'idle', function() {
        callback && callback();
      });
    }
  }.init();
};
