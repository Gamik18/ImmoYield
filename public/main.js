const form = document.getElementById("search-form");
const filterForm = document.getElementById("filter-form");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const prevPageBtn = document.getElementById("prev_page");
const nextPageBtn = document.getElementById("next_page");
const pageInfoEl = document.getElementById("page_info");
const exportCsvBtn = document.getElementById("export_csv");

let allItems = [];
let filteredItems = [];
let currentPage = 1;
const MIN_ALLOWED_YIELD_PCT = 1;
const MAX_ALLOWED_YIELD_PCT = 50;

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function pct(value) {
  return `${(value || 0).toFixed(2)}%`;
}

function toCsv(items) {
  const headers = [
    "rank",
    "address",
    "city",
    "stateCode",
    "postalCode",
    "listPrice",
    "avgMonthlyRent",
    "annualRent",
    "grossYieldPct",
    "nearbyRentCount",
    "avgDistanceKm",
  ];

  const escapeValue = (value) => {
    const raw = value ?? "";
    const text = String(raw).replace(/"/g, "\"\"");
    return `"${text}"`;
  };

  const rows = items.map((item, index) => [
    index + 1,
    item.address,
    item.city,
    item.stateCode,
    item.postalCode,
    item.listPrice,
    item.avgMonthlyRent,
    item.annualRent,
    item.grossYieldPct,
    item.nearbyRentCount,
    item.avgDistanceKm,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeValue).join(",")).join("\n");
}

function exportCurrentCsv() {
  if (!filteredItems.length) return;
  const csv = toCsv(filteredItems);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "real-estate-yields.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getPageSize() {
  const pageSizeInput = document.getElementById("page_size");
  const pageSize = Number(pageSizeInput.value);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 10;
  return Math.min(Math.floor(pageSize), 100);
}

function getPagedItems(items) {
  const pageSize = getPageSize();
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  return {
    totalPages,
    pageItems: items.slice(start, end),
  };
}

function renderItems(items) {
  if (!items.length) {
    resultsEl.innerHTML = '<p class="card-soft">No matched listings after applying filters.</p>';
    pageInfoEl.textContent = "Page 1 / 1";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }

  const { totalPages, pageItems } = getPagedItems(items);
  pageInfoEl.textContent = `Page ${currentPage} / ${totalPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;

  resultsEl.innerHTML = pageItems
    .map(
      (item, pageIndex) => `
      <article class="card">
        ${
          item.photo
            ? `<img class="card-photo" src="${item.photo}" alt="Property photo for ${item.address || "listing"}" loading="lazy" />`
            : ""
        }
        <div class="topline">
          <p class="card-address">#${(currentPage - 1) * getPageSize() + pageIndex + 1} ${
        item.address || "Address unavailable"
      }</p>
          <span class="yield">Yield ${pct(item.grossYieldPct)}</span>
        </div>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Sale Price</span>
            <span class="stat-value">${currency(item.listPrice)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Avg Monthly Rent</span>
            <span class="stat-value">${currency(item.avgMonthlyRent)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Annual Rent</span>
            <span class="stat-value">${currency(item.annualRent)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Rent Comps</span>
            <span class="stat-value">${item.nearbyRentCount}</span>
          </div>
        </div>
        <div class="meta">
          Avg comparable distance: ${item.avgDistanceKm.toFixed(1)} km
        </div>
        <div class="meta">
          ${
            item.detailUrl
              ? `<a class="listing-link" href="${item.detailUrl}" target="_blank" rel="noopener noreferrer">View property details</a>`
              : "Details link unavailable"
          }
        </div>
      </article>
    `
    )
    .join("");
}

function applyFilters() {
  const minYieldInput = Number(document.getElementById("min_yield").value);
  const minYield = Math.max(MIN_ALLOWED_YIELD_PCT, Math.min(MAX_ALLOWED_YIELD_PCT, minYieldInput || 0));
  const maxPriceRaw = document.getElementById("max_price").value.trim();
  const maxPrice = maxPriceRaw ? Number(maxPriceRaw) : null;

  filteredItems = allItems.filter((item) => {
    if ((item.grossYieldPct || 0) < MIN_ALLOWED_YIELD_PCT) return false;
    if ((item.grossYieldPct || 0) > MAX_ALLOWED_YIELD_PCT) return false;
    if ((item.grossYieldPct || 0) < minYield) return false;
    if (maxPrice !== null && Number.isFinite(maxPrice) && (item.listPrice || 0) > maxPrice) return false;
    return true;
  });

  renderItems(filteredItems);
  statusEl.textContent = `Showing ${filteredItems.length} of ${allItems.length} listings. Yield window: ${MIN_ALLOWED_YIELD_PCT}% to ${MAX_ALLOWED_YIELD_PCT}%.`;
}

async function loadYields(city, stateCode) {
  statusEl.textContent = "Loading data...";
  resultsEl.innerHTML = "";

  const query = new URLSearchParams({
    city,
    state_code: stateCode,
    sale_limit: "42",
    rent_limit: "60",
  });

  const res = await fetch(`/api/yields?${query.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }

  const data = await res.json();
  allItems = data.items || [];
  currentPage = 1;
  statusEl.textContent = `Loaded ${data.counts.matched} matched listings (sales: ${data.counts.sales}, rents: ${data.counts.rents}).`;
  applyFilters();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const city = document.getElementById("city").value.trim();
  const stateCode = document.getElementById("state_code").value.trim().toUpperCase();

  try {
    await loadYields(city, stateCode);
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
});

filterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  currentPage = 1;
  applyFilters();
});

prevPageBtn.addEventListener("click", () => {
  currentPage -= 1;
  renderItems(filteredItems);
});

nextPageBtn.addEventListener("click", () => {
  currentPage += 1;
  renderItems(filteredItems);
});

exportCsvBtn.addEventListener("click", () => {
  exportCurrentCsv();
});

loadYields("Detroit", "MI").catch((error) => {
  statusEl.textContent = `Error: ${error.message}`;
});
