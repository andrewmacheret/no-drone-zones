"use strict";

var Geo = function($options) {
  var $public = this;
  var $private = {
    geoJSONs: [],

    init: function() {
      $public.loadJSONs = this.loadJSONs.bind(this);
      $public.getJSONs = this.getJSONs.bind(this);
      $public.findNearest = this.findNearest.bind(this);

      return this;
    },

    loadJSONs: function(options, callback) {
      var urls = options.urls;

      var promises = [];
      $.each(urls, function(i, url) {
        promises.push($.getJSON(url));
      });

      return $.when.apply(
        $, promises
      ).fail(function(err) {
        callback && callback(null, err);
      }).done(function() {
        $.each(arguments, function(i, arg) {
          this.geoJSONs.push(arg[0]);
        }.bind(this));
        callback && callback(this.geoJSONs);
      }.bind(this));
    },

    getJSONs: function() {
      return this.geoJSONs;
    },

    findNearest: function(options) {
      var position = options.position;
      var maxDistance = options.maxDistance;
      var units = options.units;

      var point = turf.point([position.coords.longitude, position.coords.latitude]);
      var nearby = [];
      
      //console.log(new Date());

      $.each(this.geoJSONs, function(g, geoJSON) {
        $.each(geoJSON.features, function(f, feature) {
          // optimize by only checking locations within 10 * maxDistance
          var center = turf.center(feature);
          var distance = turf.distance(point, center, {units: units});
          if (distance <= maxDistance * 10) {

            var actualDistance = this.distanceToPolygon({
              point: point,
              feature: feature,
              units: units
            });

            if (actualDistance <= maxDistance) {
              nearby.push({
                //feature.properties.name + ' ' + actualDistance.toPrecision(3) + ' ' + units
                feature: feature,
                distance: actualDistance,
                units: units
              })
            }

          }
        }.bind(this));
      }.bind(this));
      
      //console.log(new Date());

      return nearby.sort(function(a, b) {
        return Math.sign(a.distance - b.distance);
      });
    },

    distanceToPolygon: function(options) {
      var startingPoint = options.point;
      var feature = options.feature;
      var units = options.units;

      // if the point is inside the polygon, distance will be negative (to leave!)
      var sign = 1;
      if (turf.booleanPointInPolygon(startingPoint, feature)) {
        sign = -1;
      }

      // the distance to the polygon is the distance to its closest edge
      // (works for polygons with holes and multipolygons too)
      var min = null;
      turf.flattenEach(turf.polygonToLine(feature), function(line) {
        var distance = turf.pointToLineDistance(startingPoint, line, {units: units});
        if (min == null || min > distance) min = distance;
      });

      // the minimum is the result
      return sign * min;
    }
  }.init();
};
