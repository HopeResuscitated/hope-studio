// Tables, states and program vocabulary. The program vocabulary comes from the
// Hope Responder Partner Guide 2026–27; change it there first, then here.

export const TABLES = [
  // Core
  'users', 'runs', 'review_results', 'approval_items', 'audit_log',
  // Knowledge
  'documents', 'chunks', 'facts',
  // Grant
  'grants', 'grant_drafts', 'draft_answers',
  // Outreach
  'prospects', 'contacts', 'messages', 'partnerships',
  // Social
  'media_assets', 'posts', 'month_copies', 'prompts',
  // Support tables
  'suppressions', 'kb_gaps', 'alerts',
];

// Approval state machine. The Executor may act only on `approved` items.
export const APPROVAL_TRANSITIONS = {
  drafted: ['in_review', 'rejected'],
  in_review: ['needs_you', 'rejected'],
  needs_you: ['approved', 'rejected', 'snoozed', 'in_review'],
  snoozed: ['needs_you', 'in_review', 'rejected'],
  approved: ['executed', 'in_review'],
  executed: [],
  rejected: ['in_review'],
};

export const STATE_LABEL = {
  drafted: 'Drafted', in_review: 'In review', needs_you: 'Needs your OK', approved: 'Approved',
  executed: 'Done', rejected: 'Rejected', snoozed: 'Snoozed',
};

export const AGENTS = {
  grant: { label: 'Grant Studio', role: 'Development Associate' },
  outreach: { label: 'Outreach Studio', role: 'Partnerships Coordinator' },
  social: { label: 'Social Studio', role: 'Social Media Coordinator' },
};

export const PILLARS = ['Educate', 'Equip', 'Empower', 'Respond', 'Lead'];

export const SEGMENTS = {
  school: { label: 'School', plural: 'Schools' },
  faith: { label: 'Faith community', plural: 'Youth groups & churches' },
  library: { label: 'Library', plural: 'Libraries & agencies' },
  agency: { label: 'Agency', plural: 'Libraries & agencies' },
  business: { label: 'Business', plural: 'Businesses' },
  youth: { label: 'Youth group', plural: 'Youth groups & churches' },
};

export const SEGMENT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'school', label: 'Schools', match: ['school'] },
  { key: 'faith', label: 'Youth groups & churches', match: ['faith', 'youth'] },
  { key: 'library', label: 'Libraries & agencies', match: ['library', 'agency'] },
  { key: 'business', label: 'Businesses', match: ['business'] },
];

export const OFFERINGS = {
  assembly: { label: 'Hope Responder Assembly', short: 'Assembly', detail: '30–40 min assembly for students' },
  training: { label: 'Hope Responder Training', short: 'Training', detail: 'Small-group, hands-on training' },
  corps: { label: 'Hope Responder Corps chapter', short: 'Corps chapter', detail: 'Founding partner pilot, 2026–27' },
  act378: { label: 'Act 378 support', short: 'Act 378 support', detail: 'Naloxone policy in practice' },
  family_night: { label: 'Family & Staff Night', short: 'Family & Staff Night', detail: 'Evening session for parents, guardians and staff' },
  group_training: { label: 'Group training', short: 'Group training', detail: 'Hope Responder training for youth groups and congregations' },
  purpose_project: { label: 'Purpose Project', short: 'Purpose Project', detail: 'Build day for access point stands or Hope Kits' },
  hope_friend: { label: 'Hope Friend', short: 'Hope Friend', detail: 'Display a QR resource placard' },
  safe_space: { label: 'Hope Safe Space', short: 'Hope Safe Space', detail: 'Indoor naloxone box, window decal, 10-minute staff orientation' },
  community_partner: { label: 'Hope Community Partner', short: 'Community Partner', detail: 'Sponsor an access point, host an event or fund Hope Kits' },
  sponsor: { label: 'Sponsor an access point', short: 'Sponsor', detail: 'Fund a year of naloxone for a public access point' },
  staff_orientation: { label: '10-minute staff orientation', short: 'Staff orientation', detail: 'Signs of an overdose, calling 911, naloxone demo' },
};

export const SEGMENT_OFFERINGS = {
  school: ['assembly', 'act378', 'corps', 'training', 'family_night'],
  faith: ['group_training', 'purpose_project', 'family_night'],
  youth: ['group_training', 'purpose_project'],
  library: ['community_partner', 'safe_space', 'sponsor', 'group_training'],
  agency: ['group_training', 'safe_space', 'community_partner'],
  business: ['safe_space', 'hope_friend', 'staff_orientation', 'sponsor'],
};

export const PARTNERSHIP_STEPS = [
  { step: 1, label: 'Intro call' },
  { step: 2, label: 'Choose offerings' },
  { step: 3, label: 'Approvals' },
  { step: 4, label: 'Delivery' },
  { step: 5, label: 'Impact summary' },
];

export const DELIVERY_CHECKLIST = [
  'Adult lead on site', 'Training devices', 'Box and decal', 'QR placard', 'Pre/post survey',
];

// Default RFP questions when a funder's RFP has not been parsed yet.
export const DEFAULT_GRANT_QUESTIONS = [
  { key: 'background', question: 'Organization background', prompt: 'Describe your organization, its mission and its history.', limit: 1000 },
  { key: 'need', question: 'Statement of need', prompt: 'Describe the problem your project addresses and who is affected.', limit: 800 },
  { key: 'program', question: 'Program design', prompt: 'Describe the activities this grant will fund and how they work.', limit: 1500 },
  { key: 'budget', question: 'Budget narrative', prompt: 'Explain how the requested funds will be spent.', limit: 750 },
  { key: 'evaluation', question: 'Evaluation plan', prompt: 'How will you measure results?', limit: 1000 },
];

export const DEFAULT_GRANT_RUBRIC = [
  'Names the population served',
  'Uses local evidence',
  'Every fact traced to a source',
  'Ties need to the budget request',
  'Within every character limit',
];

export const DEFAULT_ATTACHMENTS = ['Project budget (PDF)', 'IRS determination letter', 'Board of directors list'];

// Posting plan: Monday, Wednesday, Friday (weekday number → Central time).
export const DEFAULT_SLOT_PLAN = [
  { weekday: 1, hour: 18, minute: 30 },
  { weekday: 3, hour: 18, minute: 30 },
  { weekday: 5, hour: 12, minute: 0 },
];

// Models named in the build sheet. Override with env vars on the server.
export const MODELS = {
  draft: 'claude-sonnet-5',
  review: 'claude-sonnet-5',
  final: 'claude-opus-5-5',
  tag: 'claude-haiku-4-5-20251001',
};

// USD per million tokens (input, output), used by the cost guard.
export const PRICES = {
  'claude-sonnet-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'claude-haiku-4-5-20251001': [1, 5],
  'claude-haiku-4-5': [1, 5],
};

export const IG_CAPTION_LIMIT = 2200;
export const IG_HASHTAG_LIMIT = 30;
export const FB_CAPTION_LIMIT = 63206;

export const ROLES = { admin: 'Admin and approver', approver: 'Approver' };
