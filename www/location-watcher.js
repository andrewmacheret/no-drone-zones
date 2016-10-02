"use strict";

var LocationWatcher = function($options) {
  var $public = this;
  var $private = {
    watchId: null,

    init: function() {
      if (!$options) $options = {};
      this.locationOptions = $options.locationOptions || {
        enableHighAccuracy: true,
        maximumAge: 1000
      };

      $public.startWatching = this.startWatching.bind(this);
      $public.stopWatching = this.stopWatching.bind(this);

      return this;
    },

    startWatching: function(callback) {
      this.watchId = navigator.geolocation.watchPosition(
        function(position) {
          callback && callback(position);
        },
        function(err) {
          callback && callback(null, err);
        },
        this.locationOptions
      );
    },

    stopWatching: function() {
      if (watchId != null) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
    }
  }.init();
};
