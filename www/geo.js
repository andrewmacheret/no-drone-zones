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
          var distance = turf.distance(point, center, units);
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
      if (turf.inside(startingPoint, feature)) {
        sign = -1;
      }

      // find each line in each polygon...
      var min = null;
      $.each(feature.geometry.coordinates, function(i, coordinate) {
        $.each(coordinate, function(j, point1) {
          var point2 = coordinate[(j + 1) % coordinate.length];

          // compute the closest point on the line
          // the distance from the starting point to the polygon is the distance to this point
          var line = turf.linestring([point1, point2]);
          var closestPointOnLine = turf.pointOnLine(line, startingPoint);
          var distance = turf.distance(startingPoint, closestPointOnLine, units);

          // adjust the minimum
          if (min == null || min > distance) min = distance;
        });
      });

      // the minimum is the result
      return sign * min;
    }
  }.init();
};
