/* 通学路安全マップ v1 main.js */

// ---- Config ----
const DEFAULT_CENTER = [36.3407, 139.4495]; // 足利市役所 付近（おおよそ）
const DEFAULT_ZOOM = 13;
const DATA_CSV = "./data/hazards.csv";

// カテゴリ定義（コード: {label, colorClass}）
const CATEGORIES = {
  "sidewalk": { label: "歩道なし・狭い",   cls: "cat-sidewalk" },
  "crossing": { label: "横断困難・信号待ち長い", cls: "cat-crossing" },
  "blind":    { label: "見通し悪い・死角", cls: "cat-blind" },
  "speed":    { label: "スピード超過・抜け道", cls: "cat-speed" },
  "signal":   { label: "信号/標識不足",   cls: "cat-signal" },
  "dark":     { label: "夜間暗い・照明不足", cls: "cat-dark" },
  "nearmiss": { label: "ヒヤリハット頻発", cls: "cat-nearmiss" },
  "other":    { label: "その他",           cls: "cat-other" }
};

// ---- State ----
let map, cluster, allPoints = [], filtered = [];

// ---- Init ----
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initUI();
  loadCSV(DATA_CSV);
  document.getElementById("last-updated").textContent = new Date().toLocaleDateString("ja-JP");
});

function initMap(){
  map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 48
  });
  map.addLayer(cluster);
}

function initUI(){
  // Category checkboxes
  const wrap = document.getElementById("category-filters");
  Object.entries(CATEGORIES).forEach(([code, meta]) => {
    const id = `cat-${code}`;
    const row = document.createElement("label");
    row.className = "flex items-center gap-2 text-sm";
    row.innerHTML = `
      <input type="checkbox" id="${id}" data-code="${code}" checked class="accent-blue-600">
      <span class="inline-flex items-center gap-2">
        <span class="marker-dot ${meta.cls} sev-2"></span>
        ${meta.label}
      </span>`;
    wrap.appendChild(row);
  });

  // Severity slider label
  const sevMin = document.getElementById("severity-min");
  const sevLbl = document.getElementById("severity-min-label");
  sevMin.addEventListener("input", () => sevLbl.textContent = sevMin.value);

  // Buttons
  document.getElementById("apply-filters").addEventListener("click", applyFilters);
  document.getElementById("reset-filters").addEventListener("click", () => {
    document.querySelectorAll("#category-filters input[type=checkbox]").forEach(cb => cb.checked = true);
    document.getElementById("severity-min").value = 1;
    document.getElementById("severity-min-label").textContent = "1";
    document.getElementById("search-text").value = "";
    applyFilters();
  });

  document.getElementById("export-geojson").addEventListener("click", exportGeoJSON);
  document.getElementById("locate").addEventListener("click", locateMe);
}

function loadCSV(url){
  Papa.parse(url, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      allPoints = (results.data || []).map(cleanRow).filter(Boolean);
      renderMarkers(allPoints);
      applyFilters();
    },
    error: (err) => {
      console.error("CSV load error", err);
      alert("データ（CSV）の読み込みに失敗しました。data/hazards.csv を確認してください。");
    }
  });
}

function cleanRow(row){
  // 必須: lat, lng, category
  const lat = parseFloat(row.lat);
  const lng = parseFloat(row.lng);
  const category = (row.category || "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !category) return null;

  // 既知カテゴリにない場合は other
  const catCode = Object.keys(CATEGORIES).includes(category) ? category : "other";
  const sev = clamp(parseInt(row.severity || "2", 10), 1, 3);
  return {
    id: row.id || cryptoRandomId(),
    timestamp: row.timestamp || "",
    lat, lng,
    block: row.block || "",
    school: row.school || "",
    category: catCode,
    severity: sev,
    description: row.description || "",
    photo_url: row.photo_url || "",
    reporter_type: row.reporter_type || "",
    status: row.status || ""
  };
}

function cryptoRandomId(){
  // Simple random id
  return "P" + Math.random().toString(36).slice(2, 10);
}

function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

function makeDivIcon(p){
  const meta = CATEGORIES[p.category] || CATEGORIES.other;
  const div = L.divIcon({
    html: `<div class="marker-dot ${meta.cls} sev-${p.severity}" title="${meta.label}"></div>`,
    className: "", iconSize: [18,18]
  });
  return div;
}

function renderMarkers(points){
  cluster.clearLayers();
  points.forEach(p => {
    const m = L.marker([p.lat, p.lng], { icon: makeDivIcon(p) });
    m.bindPopup(popupHTML(p), { maxWidth: 320 });
    cluster.addLayer(m);
  });
}

function popupHTML(p){
  const meta = CATEGORIES[p.category] || CATEGORIES.other;
  const lines = [];
  if (p.block || p.school){
    lines.push(`<div class="text-xs text-gray-500">${[p.block, p.school].filter(Boolean).join(" / ")}</div>`);
  }
  lines.push(`<div class="font-semibold">${meta.label}（重大度${p.severity}）</div>`);
  if (p.description) lines.push(`<div class="mt-1 text-sm whitespace-pre-wrap">${escapeHTML(p.description)}</div>`);
  if (p.photo_url){
    lines.push(`<div class="mt-2"><a target="_blank" rel="noopener" class="text-blue-600 underline" href="${p.photo_url}">写真を見る</a></div>`);
  }
  if (p.status){
    lines.push(`<div class="mt-2 text-xs">対応状況：${escapeHTML(p.status)}</div>`);
  }
  if (p.timestamp){
    lines.push(`<div class="mt-2 text-xs text-gray-500">報告日時：${escapeHTML(p.timestamp)}</div>`);
  }
  return `<div class="p-1">${lines.join("")}</div>`;
}

function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[m]);
}

function applyFilters(){
  const activeCats = Array.from(document.querySelectorAll("#category-filters input[type=checkbox]"))
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.code);

  const sevMin = parseInt(document.getElementById("severity-min").value, 10);
  const q = (document.getElementById("search-text").value || "").toLowerCase();

  filtered = allPoints.filter(p => {
    const okCat = activeCats.includes(p.category);
    const okSev = p.severity >= sevMin;
    const okText = !q || (p.description + " " + p.status).toLowerCase().includes(q);
    return okCat && okSev && okText;
  });

  renderMarkers(filtered);
  updateStats(filtered);
}

function updateStats(points){
  const counts = {};
  Object.keys(CATEGORIES).forEach(k => counts[k]=0);
  points.forEach(p => counts[p.category]++);

  const box = document.getElementById("stats");
  box.innerHTML = "";
  Object.entries(CATEGORIES).forEach(([code, meta]) => {
    const n = counts[code] || 0;
    const card = document.createElement("div");
    card.className = "rounded-xl border p-3 flex items-center gap-3";
    card.innerHTML = `
      <span class="marker-dot ${meta.cls} sev-2"></span>
      <div class="text-sm">
        <div class="font-medium">${meta.label}</div>
        <div class="text-gray-500">${n} 件</div>
      </div>`;
    box.appendChild(card);
  });
}

function exportGeoJSON(){
  const features = filtered.map(p => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    properties: {
      id: p.id,
      timestamp: p.timestamp,
      block: p.block,
      school: p.school,
      category: p.category,
      severity: p.severity,
      description: p.description,
      photo_url: p.photo_url,
      reporter_type: p.reporter_type,
      status: p.status
    }
  }));
  const fc = { type: "FeatureCollection", features };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tsugakuro_filtered.geojson";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function locateMe(){
  if (!navigator.geolocation){
    alert("この端末は位置情報に対応していません。");
    return;
  }
  map.locate({ setView: true, maxZoom: 17 });
}

// ---- End ----
