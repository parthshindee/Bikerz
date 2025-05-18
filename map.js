import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoicGFydGhzaGluZGUwNCIsImEiOiJjbWF0OHA0bGUwcnA2MmpwczRwN2JydnA3In0.EY6Wo08KbM2heV3dAqFobQ';

function formatTime(mins) {
  const dt = new Date(0, 0, 0, 0, mins);
  return dt.toLocaleString('en-US', { timeStyle: 'short' });
}
function minutesSinceMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}
function filterByMinute(buckets, minute) {
  if (minute === -1) return buckets.flat();
  const minM = (minute - 60 + 1440) % 1440;
  const maxM = (minute + 60) % 1440;
  if (minM > maxM) {
    return buckets.slice(minM).concat(buckets.slice(0, maxM)).flat();
  } else {
    return buckets.slice(minM, maxM).flat();
  }
}

function computeStationTraffic(stations, timeFilter = -1) {
  const depTrips = filterByMinute(departuresByMinute, timeFilter);
  const arrTrips = filterByMinute(arrivalsByMinute,   timeFilter);

  const depCount = d3.rollup(depTrips, v => v.length, d => d.start_station_id);
  const arrCount = d3.rollup(arrTrips, v => v.length, d => d.end_station_id);

  return stations.map(s => {
    const id = s.short_name;
    s.departures   = depCount.get(id) ?? 0;
    s.arrivals     = arrCount.get(id) ?? 0;
    s.totalTraffic = s.departures + s.arrivals;
    return s;
  });
}

const departuresByMinute = Array.from({ length: 1440 }, () => []);
const arrivalsByMinute   = Array.from({ length: 1440 }, () => []);

const map = new mapboxgl.Map({
  container: 'map',
  style:    'mapbox://styles/mapbox/streets-v12',
  center:   [-71.057083, 42.361145],
  zoom:     12,
  minZoom:  5,
  maxZoom:  18
});

map.on('load', async () => {
  const bikeLanePaint = {
    'line-color':   '#32D400',
    'line-width':   4,
    'line-opacity': 0.6
  };
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'data/Existing_Bike_Network_2022.geojson'
  });
  map.addLayer({
    id:     'boston-bike-lanes',
    type:   'line',
    source: 'boston_route',
    paint:  bikeLanePaint
  });
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'data/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({
    id:     'cambridge-bike-lanes',
    type:   'line',
    source: 'cambridge_route',
    paint:  bikeLanePaint
  });

  const stationData = await d3.json('data/bluebikes-stations.json');
  let stations      = stationData.data.stations;

  await d3.csv(
    'data/bluebikes-traffic-2024-03.csv',
    trip => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at   = new Date(trip.ended_at);
      const sm = minutesSinceMidnight(trip.started_at);
      const em = minutesSinceMidnight(trip.ended_at);
      departuresByMinute[sm].push(trip);
      arrivalsByMinute[em].push(trip);
      return trip;
    }
  );

  stations = computeStationTraffic(stations);
  const maxTraffic = d3.max(stations, d => d.totalTraffic);
  const radiusScale = d3.scaleSqrt()
    .domain([0, maxTraffic])
    .range([0, 25]);

  const stationFlow = d3.scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  const svg = d3.select('#map svg');
  let circles = svg.selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .style('--departure-ratio', d =>
        stationFlow(d.departures / d.totalTraffic)
      )
      .each(function(d) {
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} dep, ${d.arrivals} arr)`);
      });

  function updatePositions() {
    circles
      .attr('cx', d => map.project([+d.lon, +d.lat]).x)
      .attr('cy', d => map.project([+d.lon, +d.lat]).y);
  }
  updatePositions();
  ['move','zoom','resize','moveend'].forEach(evt =>
    map.on(evt, updatePositions)
  );
  const slider       = document.getElementById('time-slider');
  const displayTime  = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    if (timeFilter === -1) radiusScale.range([0, 25]);
    else                   radiusScale.range([3, 50]);

    const updatedStations = computeStationTraffic(stations, timeFilter);

    circles = svg.selectAll('circle')
      .data(updatedStations, d => d.short_name)
      .join('circle')
        .attr('r', d => radiusScale(d.totalTraffic))
        .style('--departure-ratio', d =>
          stationFlow(d.departures / d.totalTraffic)
        );

    updatePositions();
  }

  function updateTimeDisplay() {
    const t = +slider.value;
    if (t === -1) {
      displayTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      displayTime.textContent = formatTime(t);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(t);
  }

  slider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
