const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const RAPID_API_HOST = "us-real-estate.p.rapidapi.com";
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const MIN_ALLOWED_YIELD_PCT = 1;
const MAX_ALLOWED_YIELD_PCT = 50;
const SIMILAR_SURFACE_RATIO = 0.3; // +/- 30% sqft

const PUBLIC_DIR = path.join(__dirname, "public");

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function pickNumber(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      const n = toNumber(obj[key]);
      if (n !== null) return n;
    }
  }
  return null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function extractListings(responseJson) {
  const data = responseJson?.data || responseJson;
  if (!data) return [];
  if (Array.isArray(data.home_search?.results)) return data.home_search.results;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.listings)) return data.listings;
  return [];
}

function buildListingUrl(home) {
  const candidate = home.href || home.permalink || null;
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return `https://www.realtor.com/realestateandhomes-detail/${candidate}`;
}

function normalizeSale(home) {
  const location = home.location || {};
  const address = location.address || {};
  const description = home.description || {};
  const coordinates = location.address?.coordinate || location.coordinate || {};

  const latitude = pickNumber(coordinates, ["lat", "latitude"]) ?? pickNumber(home, ["lat", "latitude"]);
  const longitude =
    pickNumber(coordinates, ["lon", "lng", "longitude"]) ??
    pickNumber(home, ["lon", "lng", "longitude"]);

  const listPrice =
    pickNumber(home, ["list_price", "price"]) ??
    pickNumber(home.listing, ["price"]) ??
    pickNumber(description, ["price"]);

  return {
    id: home.property_id || home.listing_id || home.permalink || `${address.line}-${address.city}`,
    address: [address.line, address.city, address.state_code, address.postal_code].filter(Boolean).join(", "),
    city: address.city || "",
    stateCode: address.state_code || "",
    postalCode: address.postal_code || "",
    latitude,
    longitude,
    beds: pickNumber(description, ["beds", "bedrooms"]),
    baths: pickNumber(description, ["baths", "bathrooms"]),
    sqft: pickNumber(description, ["sqft", "lot_sqft"]),
    listPrice,
    photo: home.primary_photo?.href || null,
    detailUrl: buildListingUrl(home),
  };
}

function normalizeRent(home) {
  const location = home.location || {};
  const address = location.address || {};
  const description = home.description || {};
  const coordinates = location.address?.coordinate || location.coordinate || {};

  const latitude = pickNumber(coordinates, ["lat", "latitude"]) ?? pickNumber(home, ["lat", "latitude"]);
  const longitude =
    pickNumber(coordinates, ["lon", "lng", "longitude"]) ??
    pickNumber(home, ["lon", "lng", "longitude"]);

  const monthlyRent =
    pickNumber(home, ["list_price", "price", "monthly_rent"]) ??
    pickNumber(description, ["price", "monthly_rent"]);

  return {
    id: home.property_id || home.listing_id || home.permalink || `${address.line}-${address.city}`,
    latitude,
    longitude,
    monthlyRent,
    sqft: pickNumber(description, ["sqft", "building_size", "lot_sqft"]),
    city: address.city || "",
    stateCode: address.state_code || "",
  };
}

function isSimilarSurface(saleSqft, rentSqft) {
  if (!saleSqft || !rentSqft) return false;
  const minSqft = saleSqft * (1 - SIMILAR_SURFACE_RATIO);
  const maxSqft = saleSqft * (1 + SIMILAR_SURFACE_RATIO);
  return rentSqft >= minSqft && rentSqft <= maxSqft;
}

function computeYield(sale, rentComps) {
  if (!sale.listPrice || !sale.latitude || !sale.longitude) return null;

  const nearbyByDistance = rentComps
    .filter((rent) => rent.monthlyRent && rent.latitude && rent.longitude)
    .map((rent) => ({
      rent,
      distanceKm: haversineKm(sale.latitude, sale.longitude, rent.latitude, rent.longitude),
    }))
    .filter((x) => x.distanceKm <= 50)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearby =
    sale.sqft && sale.sqft > 0
      ? nearbyByDistance
          .filter((x) => isSimilarSurface(sale.sqft, x.rent.sqft))
          .slice(0, 10)
      : nearbyByDistance.slice(0, 10);

  if (!nearby.length) return null;

  const usedSqftMatching = Boolean(sale.sqft && sale.sqft > 0);
  if (usedSqftMatching && !nearby.every((x) => isSimilarSurface(sale.sqft, x.rent.sqft))) {
    return null;
  }

  const avgMonthlyRent = nearby.reduce((acc, x) => acc + x.rent.monthlyRent, 0) / nearby.length;
  const annualRent = avgMonthlyRent * 12;
  const grossYieldPct = (annualRent / sale.listPrice) * 100;

  const avgDistanceKm = nearby.reduce((acc, x) => acc + x.distanceKm, 0) / nearby.length;
  const avgCompSqft =
    nearby.reduce((acc, x) => acc + (x.rent.sqft || 0), 0) /
    Math.max(
      1,
      nearby.reduce((acc, x) => acc + (x.rent.sqft ? 1 : 0), 0)
    );

  return {
    ...sale,
    avgMonthlyRent,
    annualRent,
    grossYieldPct,
    nearbyRentCount: nearby.length,
    avgDistanceKm,
    comparedBySimilarSurface: usedSqftMatching,
    avgCompSqft: Number.isFinite(avgCompSqft) ? avgCompSqft : null,
  };
}

async function fetchRapidApi(url) {
  if (!RAPID_API_KEY) {
    throw new Error("Missing RAPIDAPI_KEY environment variable");
  }

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": RAPID_API_HOST,
      "x-rapidapi-key": RAPID_API_KEY,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RapidAPI request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function handleYieldApi(reqUrl, res) {
  const stateCode = reqUrl.searchParams.get("state_code") || "MI";
  const city = reqUrl.searchParams.get("city") || "Detroit";
  const saleLimit = reqUrl.searchParams.get("sale_limit") || "42";
  const rentLimit = reqUrl.searchParams.get("rent_limit") || "50";

  const saleUrl = `https://us-real-estate.p.rapidapi.com/v3/for-sale?state_code=${encodeURIComponent(
    stateCode
  )}&city=${encodeURIComponent(city)}&sort=newest&offset=0&limit=${encodeURIComponent(saleLimit)}`;

  const rentUrl = `https://us-real-estate.p.rapidapi.com/v3/for-rent?city=${encodeURIComponent(
    city
  )}&state_code=${encodeURIComponent(stateCode)}&limit=${encodeURIComponent(
    rentLimit
  )}&offset=0&sort=lowest_price&beds_min=1&beds_max=5&baths_min=1&baths_max=5`;

  const [saleRaw, rentRaw] = await Promise.all([fetchRapidApi(saleUrl), fetchRapidApi(rentUrl)]);

  const sales = extractListings(saleRaw).map(normalizeSale).filter((x) => x.listPrice);
  const rents = extractListings(rentRaw).map(normalizeRent).filter((x) => x.monthlyRent);

  const yields = sales
    .map((sale) => computeYield(sale, rents))
    .filter(Boolean)
    .filter(
      (item) =>
        item.grossYieldPct >= MIN_ALLOWED_YIELD_PCT && item.grossYieldPct <= MAX_ALLOWED_YIELD_PCT
    )
    .sort((a, b) => b.grossYieldPct - a.grossYieldPct);

  return sendJson(res, 200, {
    query: { city, stateCode, saleLimit: Number(saleLimit), rentLimit: Number(rentLimit) },
    counts: {
      sales: sales.length,
      rents: rents.length,
      matched: yields.length,
      filteredYieldRange: `${MIN_ALLOWED_YIELD_PCT}-${MAX_ALLOWED_YIELD_PCT}%`,
    },
    items: yields,
  });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

async function serveStatic(reqPath, res) {
  const filePath = reqPath === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, reqPath);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const file = await fs.readFile(normalized);
    const ext = path.extname(normalized).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(file);
  } catch (err) {
    sendJson(res, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 400, { error: "Invalid request" });
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);

    if (reqUrl.pathname === "/api/yields") {
      await handleYieldApi(reqUrl, res);
      return;
    }

    await serveStatic(reqUrl.pathname, res);
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Unexpected server error" });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${PORT}`);
});
