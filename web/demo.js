// Demo connectors: sample feeds stand in for Grants.gov and Google Places so a
// Scout run finds something in the browser. Names stay placeholders; nothing
// here is a real opportunity or organization. Gmail, Docs and Meta are off, so
// approved sends and posts are logged as simulated.

const DAY = 86400000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

const SAMPLE_GRANTS = {
  naloxone: [{
    external_id: 'SAMPLE-101', funder: '[Federal agency]', title: '[Community naloxone distribution program]', amount_min: 50000, amount_max: 200000, days: 60,
    description: 'Supports community naloxone distribution and overdose education, including programs for adolescents and young adults.',
    eligibility_text: 'Eligible applicants: nonprofits with 501(c)(3) status, state and local governments. Louisiana applicants are eligible.',
  }],
  'opioid overdose prevention': [{
    external_id: 'SAMPLE-102', funder: '[Federal agency]', title: '[Rural overdose response planning grant]', amount_min: 100000, amount_max: 250000, days: 10,
    description: 'Planning grants for rural overdose prevention and response networks.',
    eligibility_text: 'Nonprofit 501(c)(3) organizations in rural communities, all states.',
  }],
  'youth substance use prevention': [{
    external_id: 'SAMPLE-103', funder: '[State agency]', title: '[Youth prevention mini-grants]', amount_min: 2500, amount_max: 10000, days: 35,
    description: 'Mini-grants for youth-led prevention projects in Louisiana parishes.',
    eligibility_text: 'Open to nonprofits and schools in Louisiana.',
  }],
  'harm reduction': [{
    external_id: 'SAMPLE-104', funder: '[Foundation]', title: '[Harm reduction capacity awards]', amount_min: null, amount_max: null, days: null,
    description: 'Capacity support for harm reduction organizations.',
    eligibility_text: 'Open only to organizations located in Texas.',
  }],
};

const SAMPLE_PLACES = [
  { q: 'high school', town: 'Zachary', name: '[High school name B]', address: '[Street], Zachary, LA', website: 'https://example.org/', note: 'Public high school; its website lists no naloxone training for students.', contact: { name: '[Counselor name B]', title: 'Counselor', email: 'counselor.b@example.org', verified: true, source_url: 'https://example.org/staff' } },
  { q: 'church youth ministry', town: 'Port Allen', name: '[Church name B] youth group', address: '[Street], Port Allen, LA', website: 'https://example.org/', note: 'Weekly youth group near the Port Allen access point.' },
  { q: 'coffee shop', town: 'St. Francisville', name: '[Coffee shop name]', address: '[Street], St. Francisville, LA', website: null, note: 'Busy spot near the West Feliciana library access point.' },
];

export function demoIntegrations() {
  return {
    mode: 'demo',
    grantsgov: {
      available: true,
      sample: true,
      name: 'sample',
      async search(keyword) {
        return (SAMPLE_GRANTS[keyword] || []).map((g) => ({
          source: 'grantsgov', sample: true, rfp_url: 'https://www.grants.gov/', deadline: g.days ? inDays(g.days) : null, ...g,
        }));
      },
    },
    places: {
      available: true,
      sample: true,
      name: 'sample',
      async search(query) {
        return SAMPLE_PLACES.filter((p) => query.startsWith(p.q) && query.includes(p.town)).map((p) => ({ ...p, sample: true, source_url: p.website }));
      },
    },
    gmail: { available: false },
    docs: { available: false },
    meta: { available: false },
  };
}
