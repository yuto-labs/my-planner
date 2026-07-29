// Stable geographic helpers for Knowledge entries. Country identifiers use ISO 3166-1 alpha-2.

export const LEARNING_REGIONS = [
  ['world', '世界'],
  ['europe', 'ヨーロッパ'],
  ['north_america', '北アメリカ'],
  ['latin_america_caribbean', '中南米・カリブ'],
  ['africa', 'アフリカ'],
  ['west_asia', '西アジア'],
  ['central_asia', '中央アジア'],
  ['south_asia', '南アジア'],
  ['east_asia', '東アジア'],
  ['southeast_asia', '東南アジア'],
  ['oceania', 'オセアニア'],
  ['polar_ocean', '極地・海洋'],
].map(([id, label]) => ({ id, label }));

const REGION_CODES = {
  europe: 'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA'.split(' '),
  north_america: 'BM CA GL PM US'.split(' '),
  latin_america_caribbean: 'AI AG AR AW BB BL BO BQ BR BS BZ CL CO CR CU CW DM DO EC FK GD GF GP GT GY HN HT JM KN KY LC MF MQ MS MX NI PA PE PR PY SR SV SX TC TT UY VC VE VG VI'.split(' '),
  africa: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW'.split(' '),
  west_asia: 'AE AM AZ BH GE IL IQ IR JO KW LB OM PS QA SA SY TR YE'.split(' '),
  central_asia: 'KZ KG TJ TM UZ'.split(' '),
  south_asia: 'AF BD BT IN LK MV NP PK'.split(' '),
  east_asia: 'CN HK JP KP KR MN MO TW'.split(' '),
  southeast_asia: 'BN ID KH LA MM MY PH SG TH TL VN'.split(' '),
  oceania: 'AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS'.split(' '),
  polar_ocean: 'AQ BV GS HM IO TF'.split(' '),
};

const COUNTRY_CODES = Object.freeze([...new Set(Object.values(REGION_CODES).flat())]);
const COUNTRY_CODE_SET = new Set(COUNTRY_CODES);
const regionByCode = new Map();
Object.entries(REGION_CODES).forEach(([regionId, codes]) => codes.forEach(code => regionByCode.set(code, regionId)));

export function getLearningCountryCodes() {
  return COUNTRY_CODES;
}

export function getLearningCountryLabel(code) {
  const clean = String(code || '').toUpperCase();
  try {
    return new Intl.DisplayNames(['ja'], { type: 'region' }).of(clean) || clean;
  } catch {
    return clean;
  }
}

export function getLearningRegionForCountry(code) {
  return regionByCode.get(String(code || '').toUpperCase()) || 'world';
}

export function getLearningCountriesForRegion(regionId) {
  if (regionId === 'world') return getLearningCountryCodes();
  return (REGION_CODES[regionId] || [])
    .sort((a, b) => getLearningCountryLabel(a).localeCompare(getLearningCountryLabel(b), 'ja'));
}

export function normalizeLearningCountryCodes(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').toUpperCase())
    .filter(code => COUNTRY_CODE_SET.has(code)))].slice(0, 12);
}

export function normalizeLearningRegionIds(values, countryCodes = []) {
  const allowed = new Set(LEARNING_REGIONS.map(region => region.id));
  const supplied = (Array.isArray(values) ? values : [])
    .map(value => String(value || ''))
    .filter(id => allowed.has(id));
  const inferred = countryCodes.map(getLearningRegionForCountry).filter(id => id !== 'world');
  const normalized = [...new Set([...supplied, ...inferred])];
  if (countryCodes.length || normalized.some(id => id !== 'world')) {
    return normalized.filter(id => id !== 'world').slice(0, 6);
  }
  return normalized.slice(0, 6);
}

export function getLearningTimelineBucket(timeline = {}) {
  const mode = ['timeless', 'cross_period', 'dated', 'unclassified'].includes(timeline.mode)
    ? timeline.mode
    : 'unclassified';
  if (mode !== 'dated') return { mode };
  const startYear = Number.isInteger(timeline.startYear) && timeline.startYear !== 0 ? timeline.startYear : null;
  const endYear = Number.isInteger(timeline.endYear) && timeline.endYear !== 0 ? timeline.endYear : startYear;
  if (!startYear || !endYear || startYear * endYear < 0) return { mode: 'cross_period' };
  const year = startYear;
  const era = year < 0 ? 'bce' : 'ce';
  const century = year < 0 ? Math.ceil(Math.abs(year) / 100) : Math.ceil(year / 100);
  const decade = year < 0 ? Math.ceil(Math.abs(year) / 10) * 10 : Math.floor(year / 10) * 10;
  return { mode, era, century, decade, startYear, endYear };
}

export function getLearningTimelineLabel(timeline = {}) {
  const bucket = getLearningTimelineBucket(timeline);
  if (bucket.mode === 'timeless') return '恒常';
  if (bucket.mode === 'cross_period') return '横断';
  if (bucket.mode !== 'dated') return '未整理';
  const era = bucket.era === 'bce' ? '紀元前' : '';
  const century = `${era}${bucket.century}世紀`;
  const range = bucket.startYear === bucket.endYear
    ? `${bucket.startYear < 0 ? `紀元前${Math.abs(bucket.startYear)}` : bucket.startYear}年`
    : `${bucket.startYear < 0 ? `紀元前${Math.abs(bucket.startYear)}` : bucket.startYear}–${bucket.endYear < 0 ? `紀元前${Math.abs(bucket.endYear)}` : bucket.endYear}年`;
  return [century, timeline.label, range].filter(Boolean).join(' / ');
}
