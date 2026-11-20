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

      var promises = urls.map(function(url) {
        return this.loadJSON(url);
      }.bind(this));

      return Promise.all(promises).then(function(results) {
        results.forEach(function(result) {
          this.geoJSONs.push(result);
        }.bind(this));
        callback && callback(this.geoJSONs);
      }.bind(this), function(err) {
        callback && callback(null, err);
      });
    },

    // fetch JSON, failing on HTTP errors and bad JSON too
    // err.statusText is set so the page can show why it failed
    loadJSON: function(url) {
      return fetch(url).then(function(response) {
        if (!response.ok) {
          var err = new Error(response.status + ' ' + response.statusText);
          err.statusText = response.statusText || 'error';
          throw err;
        }
        return response.json().catch(function(err) {
          err.statusText = 'parsererror';
          throw err;
        });
      }, function(err) {
        err.statusText = 'error';
        throw err;
      });
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

      this.geoJSONs.forEach(function(geoJSON) {
        geoJSON.features.forEach(function(feature) {
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
