let map;
let routeLayer;
const markers = [];

// Initialize Map
function initMap() {
  map = L.map('map').setView([51.505, -0.09], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

// GPX Handler
document.getElementById('gpxUpload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const startTime = new Date(document.getElementById('startTime').value);
  const avgSpeed = parseFloat(document.getElementById('avgSpeed').value);
  const intervalKm = parseInt(document.getElementById('weatherInterval').value);

  try {
    const text = await file.text();
    const parser = new DOMParser();
    const gpxDoc = parser.parseFromString(text, "text/xml");
    
    const points = processGPX(gpxDoc);
    const sampledPoints = samplePointsByDistance(points, intervalKm * 1000);
    const timedPoints = calculateTimedPoints(sampledPoints, startTime, avgSpeed);
    
    displayRoute(points); // Show full route
    await fetchWeatherData(timedPoints); // Show weather for sampled points
    
  } catch (error) {
    showError(`Error: ${error.message}`);
  }
});

function processGPX(gpxDoc) {
  const points = [];
  const trackPoints = gpxDoc.getElementsByTagName('trkpt');
  let cumulativeDistance = 0;
  let prevCoords = null;

  Array.from(trackPoints).forEach((pt, index) => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    
    const currentCoords = L.latLng(lat, lon);
    if (index > 0) {
      cumulativeDistance += currentCoords.distanceTo(prevCoords);
    }
    
    points.push({ 
      lat, 
      lon, 
      cumulativeDistance: cumulativeDistance 
    });
    
    prevCoords = currentCoords;
  });

  return points;
}

function samplePointsByDistance(points, intervalMeters) {
  if (points.length === 0 || intervalMeters <= 0) return points;

  const sampled = [];
  const totalDistance = points[points.length - 1].cumulativeDistance;
  let currentInterval = 0;

  while (currentInterval <= totalDistance) {
    // Find the first point that exceeds currentInterval
    const nextPoint = points.find(p => p.cumulativeDistance >= currentInterval);
    
    if (!nextPoint) break;

    const prevPoint = points[points.indexOf(nextPoint) - 1];
    
    // If exact match or first point
    if (nextPoint.cumulativeDistance === currentInterval || !prevPoint) {
      sampled.push(nextPoint);
    } else {
      // Interpolate between points
      const ratio = (currentInterval - prevPoint.cumulativeDistance) / 
                   (nextPoint.cumulativeDistance - prevPoint.cumulativeDistance);
      
      sampled.push({
        lat: prevPoint.lat + (nextPoint.lat - prevPoint.lat) * ratio,
        lon: prevPoint.lon + (nextPoint.lon - prevPoint.lon) * ratio,
        cumulativeDistance: currentInterval
      });
    }

    currentInterval += intervalMeters;
  }

  // Always include final point if not already added
  const lastPoint = points[points.length - 1];
  if (sampled.length === 0 || sampled[sampled.length - 1].cumulativeDistance < lastPoint.cumulativeDistance) {
    sampled.push(lastPoint);
  }

  return sampled;
}

function calculateTimedPoints(points, startTime, avgSpeed) {
  return points.map(point => ({
    lat: point.lat,
    lon: point.lon,
    time: new Date(startTime.getTime() + 
         (point.cumulativeDistance / 1000 / avgSpeed) * 3600000)
  }));
}

function displayRoute(points) {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.polyline(points.map(p => [p.lat, p.lon]), {
    color: '#e64980',
    weight: 4
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds());
}

async function fetchWeatherData(points) {
  clearMarkers();
  const weatherData = [];
  
  for (const point of points) {
    try {
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}` +
        `&hourly=temperature_2m,windspeed_10m,weathercode` +
        `&start_date=${formatDate(point.time)}&end_date=${formatDate(point.time)}`
      );
      
      const data = await response.json();
      const hourIndex = point.time.getHours();
      
      weatherData.push({
        ...point,
        temp: data.hourly.temperature_2m[hourIndex],
        wind: data.hourly.windspeed_10m[hourIndex],
        code: data.hourly.weathercode[hourIndex]
      });
      
      addMarker(point, data.hourly.temperature_2m[hourIndex]);
      
    } catch (error) {
      console.error('Weather fetch failed:', error);
    }
  }
  
  displayWeather(weatherData);
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function addMarker(point, temp) {
  const marker = L.marker([point.lat, point.lon], {
    icon: L.divIcon({
      className: 'weather-marker',
      html: `<div>${Math.round(temp)}°C</div>`
    })
  }).addTo(map);
  markers.push(marker);
}

function displayWeather(data) {
  const container = document.getElementById('weatherTimeline');
  container.innerHTML = data.map(point => `
    <div class="weather-card">
      <div>Time: ${point.time.toLocaleTimeString()}</div>
      <div>Distance: ${(point.cumulativeDistance/1000).toFixed(1)} km</div>
      <div>Temp: ${Math.round(point.temp)}°C</div>
      <div>Wind: ${point.wind} m/s</div>
      <div>Conditions: ${weatherCodeToText(point.code)}</div>
    </div>
  `).join('');
}

function weatherCodeToText(code) {
  const codes = {
    0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Freezing Fog', 51: 'Drizzle', 56: 'Freezing Drizzle',
    61: 'Rain', 63: 'Moderate Rain', 65: 'Heavy Rain', 66: 'Freezing Rain',
    71: 'Snow', 73: 'Moderate Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
    80: 'Showers', 85: 'Snow Showers', 95: 'Thunderstorm', 96: 'Thunderstorm + Hail'
  };
  return codes[code] || 'Unknown';
}

function clearMarkers() {
  markers.forEach(marker => map.removeLayer(marker));
  markers.length = 0;
}

function showError(message) {
  const errorContainer = document.getElementById('errorContainer');
  errorContainer.textContent = message;
  setTimeout(() => errorContainer.textContent = '', 5000);
}

// Initialize the app
initMap();