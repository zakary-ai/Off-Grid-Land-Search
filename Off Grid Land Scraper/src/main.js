/**
 * Off-Grid Land Scraper – Apify Actor
 * Scrapes LandSearch listings, normalizes data, scores for off-grid suitability,
 * and outputs app-ready property cards.
 */

import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { createHash } from 'crypto';

const LABELS = { SEARCH: 'SEARCH', DETAIL: 'DETAIL' };
const LANDSEARCH_BASE = 'https://www.landsearch.com/properties';

// ---------------------------------------------------------------------------
// LandSearch filter URL builder
// URL format: /properties/{location}/filter/tag=tag1%2Btag2%2Btag3
// ---------------------------------------------------------------------------
function buildFilterUrl(locationSlug, tagSlugs) {
  if (!tagSlugs?.length) return `${LANDSEARCH_BASE}/${locationSlug}`;
  const tagParam = tagSlugs.map(t => encodeURIComponent(t)).join('%2B');
  return `${LANDSEARCH_BASE}/${locationSlug}/filter/tag=${tagParam}`;
}

// ---------------------------------------------------------------------------
// Helpers: numbers and text
// ---------------------------------------------------------------------------

function cleanNumber(value) {
  if (value == null || value === '') return null;
  const str = String(value).replace(/[^\d.-]/g, '');
  const num = parseFloat(str);
  return Number.isFinite(num) ? num : null;
}

function normalizeText(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

const STATE_ABBREV = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
  texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

function normalizeState(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v.length === 2) return v.toUpperCase();
  return STATE_ABBREV[v] || null;
}

function extractPrice(text) {
  if (!text) return null;
  const match = String(text).replace(/,/g, '').match(/\$[\d,]+(?:\.\d{2})?/);
  return match ? cleanNumber(match[0]) : null;
}

function extractAcres(text) {
  if (!text) return null;
  const str = String(text);
  const match = str.match(/([\d.,]+)\s*(?:acres?|ac\.?)/i) || str.match(/([\d.,]+)\s*ac/i);
  return match ? cleanNumber(match[1]) : cleanNumber(str);
}

// ---------------------------------------------------------------------------
// Stable ID from URL
// ---------------------------------------------------------------------------

function stableId(url) {
  const normalized = (url || '').split('?')[0].replace(/\/+$/, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Scoring: off-grid suitability 0–100, grade, whyItRanks, redFlags, badges
// ---------------------------------------------------------------------------

function scoreListing(record, options = {}) {
  const {
    price = null,
    acres = null,
    pricePerAcre = null,
    description = '',
    title = '',
    tags = [],
  } = record;

  const combined = `${normalizeText(title)} ${normalizeText(description)} ${(tags || []).join(' ')}`.toLowerCase();
  let score = 50;
  const whyItRanks = [];
  const redFlags = [];
  const badges = [];

  // Positive: acreage in sweet spot
  if (acres != null) {
    if (acres >= 2 && acres <= 40) {
      score += 12;
      whyItRanks.push('Good acreage range (2–40 acres)');
      badges.push('good-acreage');
    } else if (acres > 40 && acres <= 80) {
      score += 6;
      whyItRanks.push('Large parcel (40–80 acres)');
    }
  }

  // Positive: low price per acre
  if (pricePerAcre != null && pricePerAcre > 0) {
    if (pricePerAcre < 3000) {
      score += 15;
      whyItRanks.push('Low price per acre');
      badges.push('low-price-per-acre');
    } else if (pricePerAcre < 6000) {
      score += 8;
      whyItRanks.push('Reasonable price per acre');
    }
  }

  // Positive: off-grid language
  if (/off[- ]?grid|offgrid|no utilities|unimproved|raw land|undeveloped/i.test(combined)) {
    score += 10;
    whyItRanks.push('Off-grid or unimproved land mentioned');
    badges.push('off-grid');
  }

  // Positive: owner/seller financing
  if (/owner financ|seller financ|owner will carry|owc|seller carry/i.test(combined)) {
    score += 10;
    whyItRanks.push('Owner financing mentioned');
    badges.push('owner-financing');
  }

  // Positive: road access
  if (/road access|access road|county road|driveway|easement|ingress|egress/i.test(combined)) {
    score += 6;
    whyItRanks.push('Road access mentioned');
    badges.push('road-access');
  }

  // Positive: no restrictions
  if (/no hoa|no restrictions|unrestricted|no deed restrictions|no covenants/i.test(combined)) {
    score += 8;
    whyItRanks.push('Unrestricted / no HOA');
    badges.push('unrestricted');
  }

  // Positive: water
  if (/well|water rights|creek|spring|pond|river|water available|drill well/i.test(combined)) {
    score += 7;
    whyItRanks.push('Water-related feature or rights');
    badges.push('water');
  }

  // Positive: desirable land type
  if (/mountain|wooded|forest|remote|homestead|buildable|agricultural|recreational|hunting|rural/i.test(combined)) {
    score += 5;
    whyItRanks.push('Desirable land type (e.g. wooded, remote, buildable)');
  }

  // Negative: under 1 acre
  if (acres != null && acres > 0 && acres < 1) {
    score -= 15;
    redFlags.push('Under 1 acre');
  }

  // Negative: very high price per acre
  if (pricePerAcre != null && pricePerAcre > 15000) {
    score -= 12;
    redFlags.push('Very high price per acre');
  }

  // Negative: flood
  if (/flood plain|flood zone|flood zone|in flood/i.test(combined)) {
    score -= 15;
    redFlags.push('Flood plain/zone mentioned');
  }

  // Negative: HOA / restrictions
  if (/hoa|homeowners association|deed restrictions|covenants|subdivision rules/i.test(combined)) {
    score -= 10;
    redFlags.push('HOA or deed restrictions');
  }

  // Negative: suburban
  if (/subdivision|residential subdivision|suburban|neighborhood association/i.test(combined)) {
    score -= 8;
    redFlags.push('Suburban/subdivision type');
  }

  // Negative: auction (can be risky)
  if (/auction|bid|absolute auction/i.test(combined)) {
    score -= 5;
    redFlags.push('Auction');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let grade = 'D';
  if (score >= 80) grade = 'A';
  else if (score >= 65) grade = 'B';
  else if (score >= 50) grade = 'C';

  return { score, grade, whyItRanks, redFlags, badges };
}

// ---------------------------------------------------------------------------
// Filters from input
// ---------------------------------------------------------------------------

function passesFilters(record, input) {
  const { location = {}, metrics = {} } = record;
  const state = (location.state || '').toUpperCase();

  if (input.includeStates?.length && !input.includeStates.map(s => s.toUpperCase()).includes(state)) return false;
  if (input.excludeStates?.length && input.excludeStates.map(s => s.toUpperCase()).includes(state)) return false;

  const acres = metrics.acres ?? record.acres;
  if (input.minAcres != null && input.minAcres > 0 && (acres == null || acres < input.minAcres)) return false;
  if (input.maxAcres != null && input.maxAcres > 0 && (acres != null && acres > input.maxAcres)) return false;

  const price = metrics.price ?? record.price;
  if (input.maxPrice != null && input.maxPrice > 0 && (price != null && price > input.maxPrice)) return false;

  const badges = record.badges || [];
  const hasOffGrid = badges.includes('off-grid') || /off[- ]?grid|offgrid/i.test(record.description || '');
  if (input.requireOffGridTag && !hasOffGrid) return false;

  const hasOwnerFinancing = badges.includes('owner-financing');
  if (input.requireOwnerFinancing && !hasOwnerFinancing) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Build final output record for dataset
// ---------------------------------------------------------------------------

function buildOutputRecord(raw, input) {
  const price = raw.price != null ? raw.price : extractPrice(raw.priceText);
  const acres = raw.acres != null ? raw.acres : extractAcres(raw.acresText);
  const pricePerAcre = (price != null && acres != null && acres > 0) ? Math.round(price / acres) : null;

  const recordForScoring = {
    price,
    acres,
    pricePerAcre,
    description: raw.description,
    title: raw.title,
    tags: raw.tags || [],
  };
  const { score, grade, whyItRanks, redFlags, badges } = scoreListing(recordForScoring);

  const city = raw.city ? normalizeText(raw.city) : null;
  const county = raw.county ? normalizeText(raw.county) : null;
  const state = raw.state ? normalizeState(raw.state) : null;

  const headline = raw.title ? normalizeText(raw.title) : (acres != null && state ? `${acres} Acres in ${state}` : 'Land listing');
  const subParts = [];
  if (price != null) subParts.push(`$${price.toLocaleString()}`);
  if (acres != null) subParts.push(`${acres} acres`);
  if (county) subParts.push(county);
  const subheadline = subParts.length ? subParts.join(' • ') : '';

  const url = raw.url || raw.sourceUrl || '';
  const id = raw.id || stableId(url);

  const out = {
    id,
    headline,
    subheadline,
    score,
    grade,
    badges,
    whyItRanks,
    redFlags,
    location: { city: city || null, county: county || null, state: state || null },
    metrics: { price: price ?? null, acres: acres ?? null, pricePerAcre: pricePerAcre ?? null },
    image: raw.image || null,
    description: raw.description ? normalizeText(raw.description).slice(0, 5000) : null,
    source: 'LandSearch',
    sourceUrl: url,
  };
  if (raw.broker) out.broker = raw.broker;
  if (raw.updatedAt) out.updatedAt = raw.updatedAt;
  if (raw.coordinates) out.coordinates = raw.coordinates;

  return out;
}

// ---------------------------------------------------------------------------
// Extraction from DOM (LandSearch-oriented selectors with fallbacks)
// ---------------------------------------------------------------------------

function isListingDetailUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  return u.includes('landsearch.com/properties/') && !u.includes('/filter/') && !u.includes('/sitemap');
}

function getListingUrls($, baseUrl) {
  const seen = new Set();
  const urls = [];
  $('a[href*="/properties/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const full = new URL(href, baseUrl).href;
    if (!isListingDetailUrl(full)) return;
    const normalized = full.split('?')[0];
    if (seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(full);
  });
  return urls;
}

function extractDetail($, url) {
  const raw = { url, title: null, priceText: null, acresText: null, description: null, city: null, county: null, state: null, image: null, tags: [], broker: null, updatedAt: null, coordinates: null };

  // Title: h1 or meta og:title or first big heading
  raw.title = $('h1').first().text() || $('meta[property="og:title"]').attr('content') || $('[data-testid="listing-title"]').text() || '';
  raw.title = normalizeText(raw.title);

  // Price: common patterns
  const priceSel = $('[class*="price"], [data-testid*="price"], .listing-price, .price').first();
  raw.priceText = priceSel.text() || $('*:contains("$")').filter((i, el) => $(el).children().length === 0).first().text();
  raw.price = extractPrice(raw.priceText) || extractPrice($('body').text());

  // Acres
  const bodyText = $('body').text();
  raw.acresText = $('[class*="acres"], [class*="acre"], [class*="size"], [data-testid*="acres"]').first().text() || bodyText.slice(0, 3000);
  raw.acres = extractAcres(raw.acresText) || extractAcres(bodyText);

  // Location: try structured fields then text
  raw.city = $('[class*="city"], [data-testid*="city"]').first().text() || '';
  raw.county = $('[class*="county"], [data-testid*="county"]').first().text() || '';
  raw.state = $('[class*="state"], [data-testid*="state"]').first().text() || '';
  if (!raw.state) {
    const stateMatch = bodyText.match(/\b(AZ|NM|TX|CO|MT|ID|OR|WA|NV|UT|WY|OK|AR|MO|KS|NE|SD|ND|IA|MN|WI|IL|IN|OH|KY|TN|MS|AL|GA|SC|NC|VA|WV|PA|NY|VT|NH|ME|FL|CA)\b/);
    if (stateMatch) raw.state = stateMatch[1];
  }
  raw.city = normalizeText(raw.city) || null;
  raw.county = normalizeText(raw.county) || null;
  raw.state = normalizeText(raw.state) || null;

  // Image
  raw.image = $('meta[property="og:image"]').attr('content') || $('img[src*="property"], img[src*="listing"], .gallery img, [class*="gallery"] img').first().attr('src');
  if (raw.image && !raw.image.startsWith('http')) raw.image = new URL(raw.image, url).href;

  // Description
  raw.description = $('[class*="description"], [data-testid*="description"], .listing-description, .description, [itemprop="description"]').first().text() || $('meta[property="og:description"]').attr('content') || '';

  // Tags/badges from pills or keywords
  $('[class*="tag"], [class*="badge"], [class*="pill"], .amenities span').each((_, el) => {
    const t = normalizeText($(el).text());
    if (t && t.length < 50) raw.tags.push(t);
  });

  // Broker/source
  raw.broker = $('[class*="broker"], [class*="agent"], [class*="listing-agent"]').first().text() || null;
  raw.broker = raw.broker ? normalizeText(raw.broker) : null;

  // Updated
  const updatedStr = $('[class*="updated"], [class*="date"]').first().text() || '';
  raw.updatedAt = updatedStr || null;

  // Coordinates
  const lat = $('meta[property="place:location:latitude"]').attr('content') || $('[data-lat]').attr('data-lat');
  const lon = $('meta[property="place:location:longitude"]').attr('content') || $('[data-lon]').attr('data-lon');
  if (lat && lon) raw.coordinates = { lat: parseFloat(lat), lon: parseFloat(lon) };

  return raw;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

await Actor.init();

const input = await Actor.getInput();
const {
  startUrls = [],
  filterLocations = [],
  filterTags = [],
  maxListings = 50,
  maxRequestsPerCrawl = 200,
} = input;

// Build start URLs: from filterLocations + filterTags, then add any raw startUrls
const locations = filterLocations.length ? filterLocations : (filterTags.length ? ['United-States'] : []);
const filterUrls = locations.flatMap(loc => [buildFilterUrl(loc, filterTags)].filter(Boolean));
const allStartUrls = [...filterUrls, ...startUrls.map(u => (typeof u === 'string' ? u : u.url))].filter(Boolean);

const dataset = await Actor.openDataset();
const listingCount = { current: 0 };
const requestCount = { current: 0 };

const crawler = new CheerioCrawler({
  maxRequestsPerCrawl,
  requestHandler: async ({ request, $, log }) => {
    requestCount.current += 1;
    const label = request.userData?.label || LABELS.SEARCH;
    const url = request.url;

    if (label === LABELS.SEARCH) {
      log.info(`[SEARCH] Scanning: ${url}`);
      const detailUrls = getListingUrls($, url);
      log.info(`[SEARCH] Found ${detailUrls.length} listing links`);
      for (const u of detailUrls) {
        if (listingCount.current >= maxListings) break;
        await crawler.addRequests([{ url: u, userData: { label: LABELS.DETAIL } }]);
      }
      return;
    }

    if (label === LABELS.DETAIL) {
      if (listingCount.current >= maxListings) return;
      listingCount.current += 1;
      log.info(`[DETAIL] (${listingCount.current}/${maxListings}) ${url}`);

      let raw;
      try {
        raw = extractDetail($, url);
      } catch (err) {
        log.warning(`[DETAIL] Extract error: ${err.message}`);
        return;
      }

      const record = buildOutputRecord(raw, input);
      if (!passesFilters(record, input)) {
        log.debug(`[DETAIL] Filtered out: ${url}`);
        return;
      }
      await dataset.pushData(record);
    }
  },
  failedRequestHandler: async ({ request, log }) => {
    log.warning(`Request failed: ${request.url} (${request.userData?.label || 'unknown'})`);
  },
});

const sources = allStartUrls.map(url => ({ url }));
const initialRequests = sources.map(({ url }) => ({ url, userData: { label: LABELS.SEARCH } }));

await crawler.run(initialRequests);

const count = listingCount.current;
console.log(`Finished. Processed ${count} listings, ${requestCount.current} requests.`);
await Actor.exit();
