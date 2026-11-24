import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLocalCityCatalog, COMPREHENSIVE_CITY_CATALOG } from './cityCatalog';
import { searchCitiesUnified } from './citySearch';
import { searchCityNominatim } from './osmService';

test('searchLocalCityCatalog returns exact Korean city matches instantly', () => {
  const daejeon = searchLocalCityCatalog('대전');
  assert.ok(daejeon.length > 0, 'Expected results for 대전');
  assert.equal(daejeon[0].name, '대전 (Daejeon)');
  assert.equal(daejeon[0].country, '대한민국');
  assert.ok(Math.abs(daejeon[0].lat - 36.3504) < 0.1);
  assert.ok(Math.abs(daejeon[0].lng - 127.3845) < 0.1);

  const suwon = searchLocalCityCatalog('수원');
  assert.ok(suwon.length > 0, 'Expected results for 수원');
  assert.equal(suwon[0].name, '수원 (Suwon)');

  const jeju = searchLocalCityCatalog('제주');
  assert.ok(jeju.length > 0, 'Expected results for 제주');
  assert.equal(jeju[0].name, '제주 (Jeju)');
});

test('searchLocalCityCatalog returns international cities by Korean or English name', () => {
  const munichKo = searchLocalCityCatalog('뮌헨');
  assert.ok(munichKo.length > 0, 'Expected results for 뮌헨');
  assert.equal(munichKo[0].country, '독일');

  const munichEn = searchLocalCityCatalog('Munich');
  assert.ok(munichEn.length > 0, 'Expected results for Munich');
  assert.equal(munichEn[0].country, '독일');

  const osakaKo = searchLocalCityCatalog('오사카');
  assert.ok(osakaKo.length > 0, 'Expected results for 오사카');
  assert.equal(osakaKo[0].country, '일본');

  const osakaEn = searchLocalCityCatalog('Osaka');
  assert.ok(osakaEn.length > 0, 'Expected results for Osaka');
  assert.equal(osakaEn[0].country, '일본');
});

test('searchLocalCityCatalog handles prefix search and empty queries safely', () => {
  assert.deepEqual(searchLocalCityCatalog(''), []);
  assert.deepEqual(searchLocalCityCatalog('   '), []);

  const results = searchLocalCityCatalog('대');
  assert.ok(results.length >= 2, 'Expected prefix matches starting with 대');
  assert.ok(results.some((r) => r.name.includes('대구')));
  assert.ok(results.some((r) => r.name.includes('대전')));
});

test('COMPREHENSIVE_CITY_CATALOG entries all have valid finite real coordinates', () => {
  assert.ok(COMPREHENSIVE_CITY_CATALOG.length >= 60);
  for (const city of COMPREHENSIVE_CITY_CATALOG) {
    assert.ok(Number.isFinite(city.lat), `City ${city.name} must have finite lat`);
    assert.ok(Number.isFinite(city.lng), `City ${city.name} must have finite lng`);
    assert.ok(city.lat >= -90 && city.lat <= 90);
    assert.ok(city.lng >= -180 && city.lng <= 180);
    assert.ok(city.aliases.length > 0, `City ${city.name} must have aliases`);
  }
});

test('searchCityNominatim falls back to local catalog when both network calls fail', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response('Network error', { status: 500 });
  }) as typeof fetch;

  try {
    const results = await searchCityNominatim('대전');
    assert.ok(results.length > 0, 'Fallback must find 대전 even with 500 error');
    assert.ok(results[0].name.includes('대전'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchCitiesUnified merges and returns valid cities', async () => {
  const results = await searchCitiesUnified('춘천');
  assert.ok(results.length > 0, 'Should find 춘천');
  assert.ok(results.some((r) => r.name.includes('춘천')));
});
