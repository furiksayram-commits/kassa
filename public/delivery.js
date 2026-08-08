var STORE = { lat: 42.311041, lon: 69.78032 };
var map = null;
var storePlacemark = null;
var userPlacemark = null;
var userCoords = null;
var route = null;
var lastAddress = '';
var lastDistance = 0;
var lastCost = 0;

function initMap() {
  ymaps.ready(function() {
    map = new ymaps.Map('map', {
      center: [STORE.lat, STORE.lon],
      zoom: 15,
      controls: ['zoomControl', 'fullscreenControl']
    });
    storePlacemark = new ymaps.Placemark(
      [STORE.lat, STORE.lon],
      { hintContent: 'МЕРОС', balloonContent: 'МЕРОС<br>Шымкент, Сатыбалдиева 43/1<br>+7 702 913 13 39' },
      { preset: 'islands#blueShopIcon', iconColor: '#667eea' }
    );
    map.geoObjects.add(storePlacemark);
    initAddressSearch();
    map.events.add('click', function(e) {
      var coords = e.get('coords');
      placeUserMarker(coords[0], coords[1]);
      getAddressByCoords(coords[0], coords[1]);
    });
  });
}

function initAddressSearch() {
  var addressInput = document.getElementById('address-input');
  var suggestionsBox = document.getElementById('suggestions');
  var suggestTimeout;
  addressInput.addEventListener('input', function() {
    clearTimeout(suggestTimeout);
    var query = this.value.trim();
    if (query.length < 3) { suggestionsBox.style.display = 'none'; return; }
    // Check if the input looks like coordinates (two numbers separated by comma or space)
    var coordsMatch = parseCoordsInput(query);
    if (coordsMatch) {
      suggestionsBox.style.display = 'none';
      findAddressByCoords(coordsMatch[0], coordsMatch[1]);
      return;
    }
    suggestTimeout = setTimeout(function() {
      ymaps.geocode('Шымкент, ' + query, { results: 7, boundedBy: [[42.2, 69.5], [42.5, 70.0]] })
      .then(function(res) {
        var items = [];
        res.geoObjects.each(function(obj) {
          items.push({ address: obj.properties.get('text'), coords: obj.geometry.getCoordinates(), description: obj.properties.get('description') || '' });
        });
        showSuggestions(items);
      }).catch(function(err) { console.error('Geocode error:', err); });
    }, 300);
  });
  document.addEventListener('click', function(e) {
    if (e.target !== addressInput && !suggestionsBox.contains(e.target)) { suggestionsBox.style.display = 'none'; }
  });
  function showSuggestions(items) {
    if (!items || items.length === 0) { suggestionsBox.style.display = 'none'; return; }
    suggestionsBox.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var div = document.createElement('div');
      div.className = 'suggestion-item';
      var displayText = item.address.replace('Kazakhstan, ', '');
      div.innerHTML = '<div class="suggestion-title">' + displayText + '</div>';
      if (item.description) { div.innerHTML += '<div class="suggestion-desc">' + item.description + '</div>'; }
      div.addEventListener('click', (function(addr, coords) {
        return function() {
          addressInput.value = addr;
          suggestionsBox.style.display = 'none';
          placeUserMarker(coords[0], coords[1]);
          lastAddress = addr;
          document.getElementById('address-value').textContent = addr;
        };
      })(displayText, item.coords));
      suggestionsBox.appendChild(div);
    }
    suggestionsBox.style.display = 'block';
  }
}

function getAddressByCoords(lat, lon) {
  ymaps.geocode([lat, lon]).then(function(res) {
    var first = res.geoObjects.get(0);
    if (first) {
      var address = first.properties.get('text', '');
      address = address.replace('Kazakhstan, ', '');
      lastAddress = address;
      document.getElementById('address-input').value = address;
      document.getElementById('address-value').textContent = address;
    }
  }).catch(function(err) { console.error('Reverse geocode error:', err); });
}

function placeUserMarker(lat, lon) {
  userCoords = { lat: lat, lon: lon };
  if (userPlacemark) { map.geoObjects.remove(userPlacemark); }
  userPlacemark = new ymaps.Placemark(
    [lat, lon],
    { hintContent: 'Адрес доставки', balloonContent: 'Адрес доставки' },
    { preset: 'islands#greenDotIcon', draggable: true }
  );
  map.geoObjects.add(userPlacemark);
  userPlacemark.events.add('dragend', function(e) {
    var coords = e.get('target').geometry.getCoordinates();
    userCoords = { lat: coords[0], lon: coords[1] };
    getAddressByCoords(coords[0], coords[1]);
    calculateDelivery(coords[0], coords[1]);
    buildRoute();
  });
  calculateDelivery(lat, lon);
  buildRoute();
  document.getElementById('build-route-btn').disabled = false;
  map.setCenter([lat, lon], 15, { checkZoomRange: true, duration: 300 });
}

async function calculateDelivery(lat, lon, routeDistance) {
  try {
    var body = { lat: lat, lon: lon };
    if (routeDistance !== undefined && routeDistance !== null) {
      body.routeDistance = routeDistance;
    }
    var response = await fetch('/api/delivery/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Server error');
    var data = await response.json();
    lastDistance = data.distance;
    lastCost = data.cost;
    showResult(data);
  } catch (error) { console.error('Error:', error); showError(); }
}

function showResult(data) {
  var box = document.getElementById('result-box');
  box.style.display = 'block';
  document.getElementById('distance-value').textContent = data.distance.toFixed(2) + ' км';
  document.getElementById('cost-value').textContent = data.cost.toLocaleString('ru-RU') + ' KZT';
}

function showError() {
  var box = document.getElementById('result-box');
  box.style.display = 'block';
  document.getElementById('distance-value').textContent = '---';
  document.getElementById('cost-value').textContent = 'Ошибка';
}

  function buildRoute() {
    if (!userCoords) return;
    if (route) { map.geoObjects.remove(route); }
    ymaps.route([[STORE.lat, STORE.lon], [userCoords.lat, userCoords.lon]], { mapStateAutoApply: true, routingMode: 'auto' })
    .then(function(routeResult) {
      route = routeResult;
      map.geoObjects.add(route);
      var distance = route.getLength();
      var time = route.getHumanJamsTime();
      var distanceKm = (distance / 1000).toFixed(1);
      document.getElementById('build-route-btn').style.display = 'none';
      document.getElementById('reset-route-btn').style.display = 'block';
      calculateDelivery(userCoords.lat, userCoords.lon, distanceKm);
      var box = document.getElementById('result-box');
      var routeInfo = document.createElement('div');
      routeInfo.className = 'route-info';
      routeInfo.innerHTML = '<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(16,185,129,0.3);font-size:13px;color:#374151;">Маршрут: ' + distanceKm + ' км, ~' + time + '</div>';
      var oldRouteInfo = box.querySelector('.route-info');
      if (oldRouteInfo) oldRouteInfo.remove();
      box.appendChild(routeInfo);
    }).catch(function(error) { console.error('Route error:', error); });
  }

function resetRoute() {
  if (route) { map.geoObjects.remove(route); route = null; }
  document.getElementById('build-route-btn').style.display = 'block';
  document.getElementById('reset-route-btn').style.display = 'none';
  var box = document.getElementById('result-box');
  var routeInfo = box.querySelector('.route-info');
  if (routeInfo) routeInfo.remove();
}

function getUserLocation() {
  if (!navigator.geolocation) { alert('Геолокация не поддерживается'); return; }
  var btn = document.getElementById('get-location-btn');
  btn.textContent = 'Определение...';
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    function(position) {
      var lat = position.coords.latitude;
      var lon = position.coords.longitude;
      placeUserMarker(lat, lon);
      getAddressByCoords(lat, lon);
      btn.textContent = 'Определить мое местоположение';
      btn.disabled = false;
    },
    function(error) {
      console.error('Geolocation error:', error);
      alert('Не удалось определить местоположение.');
      btn.textContent = 'Определить мое местоположение';
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function sendToWhatsApp() {
  if (!lastAddress || lastAddress === '---') { alert('Сначала выберите адрес доставки'); return; }
  var storePhone = '77029131339';
  var lat = userCoords ? userCoords.lat.toFixed(6) : '';
  var lon = userCoords ? userCoords.lon.toFixed(6) : '';
  var mapLink = 'https://www.google.com/maps?q=' + lat + ',' + lon;
  window.open('https://wa.me/' + storePhone + '?text=' + encodeURIComponent(mapLink), '_blank');
}

// Parse coordinate input like "42.311, 69.780" or "42.311 69.780"
function parseCoordsInput(str) {
  if (!str) return null;
  // Remove any whitespace and split by comma, semicolon, or space
  var parts = str.split(/[;,;\s]+/).filter(function(p) { return p.trim() !== ''; });
  if (parts.length >= 2) {
    var lat = parseFloat(parts[0].replace(',', '.'));
    var lon = parseFloat(parts[1].replace(',', '.'));
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return [lat, lon];
    }
  }
  return null;
}

// Find address by coordinates (reverse geocode) and place a marker
function findAddressByCoords(lat, lon) {
  var latInput = document.getElementById('lat-input');
  var lonInput = document.getElementById('lon-input');
  if (latInput && lonInput) {
    latInput.value = lat.toFixed(6);
    lonInput.value = lon.toFixed(6);
  }
  placeUserMarker(lat, lon);
  getAddressByCoords(lat, lon);
}

// Handle coordinate search button
function initCoordSearch() {
  var latInput = document.getElementById('lat-input');
  var lonInput = document.getElementById('lon-input');
  var findBtn = document.getElementById('find-by-coords-btn');
  if (!latInput || !lonInput || !findBtn) return;

  function doCoordSearch() {
    var lat = parseFloat(latInput.value.trim().replace(',', '.'));
    var lon = parseFloat(lonInput.value.trim().replace(',', '.'));
    if (isNaN(lat) || isNaN(lon)) {
      alert('Пожалуйста, введите корректные координаты (широта и долгота)');
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      alert('Координаты вне допустимого диапазона');
      return;
    }
    findAddressByCoords(lat, lon);
  }

  findBtn.addEventListener('click', doCoordSearch);
  latInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); lonInput.focus(); } });
  lonInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); doCoordSearch(); } });
}

document.addEventListener('DOMContentLoaded', function() {
  initMap();
  initCoordSearch();
  document.getElementById('get-location-btn').addEventListener('click', getUserLocation);
  document.getElementById('build-route-btn').addEventListener('click', buildRoute);
  document.getElementById('reset-route-btn').addEventListener('click', resetRoute);
  document.getElementById('send-wa-btn').addEventListener('click', sendToWhatsApp);
});
