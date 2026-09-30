// Fills Play's data safety CSV export for one FEASTY app.
// usage: node fill-data-safety.mjs <in.csv> <out.csv> customer|partner
import fs from 'node:fs';

const [, , inPath, outPath, app] = process.argv;

// Minimal RFC4180 parser/serializer (fields may be quoted, contain commas/quotes).
const parse = (text) => {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
};
const esc = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// ---- the declaration -------------------------------------------------------
const REQ = 'PSL_DATA_USAGE_USER_CONTROL_REQUIRED';
const OPT = 'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL';
const common = {
  PSL_NAME: [REQ, ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT']],
  PSL_EMAIL: [REQ, ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT', 'PSL_DEVELOPER_COMMUNICATIONS']],
  PSL_USER_ACCOUNT: [REQ, ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT']],
  PSL_PHONE: [REQ, ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT']],
  PSL_OTHER_MESSAGES: [OPT, ['PSL_APP_FUNCTIONALITY']],
  PSL_CRASH_LOGS: [REQ, ['PSL_ANALYTICS']],
  PSL_PERFORMANCE_DIAGNOSTICS: [REQ, ['PSL_ANALYTICS']],
};
const perApp = {
  customer: {
    ...common,
    PSL_ADDRESS: [REQ, ['PSL_APP_FUNCTIONALITY']],
    PSL_APPROX_LOCATION: [OPT, ['PSL_APP_FUNCTIONALITY']],
    PSL_PRECISE_LOCATION: [OPT, ['PSL_APP_FUNCTIONALITY']],
    PSL_PHOTOS: [OPT, ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT']],
    PSL_PURCHASE_HISTORY: [REQ, ['PSL_APP_FUNCTIONALITY', 'PSL_FRAUD_PREVENTION_SECURITY']],
    PSL_USER_GENERATED_CONTENT: [OPT, ['PSL_APP_FUNCTIONALITY']],
  },
  partner: {
    ...common,
    PSL_ADDRESS: [REQ, ['PSL_APP_FUNCTIONALITY', 'PSL_FRAUD_PREVENTION_SECURITY']],
    PSL_OTHER_PERSONAL: [REQ, ['PSL_FRAUD_PREVENTION_SECURITY', 'PSL_ACCOUNT_MANAGEMENT']],
    PSL_PHOTOS: [REQ, ['PSL_APP_FUNCTIONALITY', 'PSL_FRAUD_PREVENTION_SECURITY']],
    PSL_OTHER: [REQ, ['PSL_APP_FUNCTIONALITY']],
  },
}[app];
if (!perApp) throw new Error('app must be customer|partner');

const top = {
  PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA: 'true',
  PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT: 'true',
  PSL_ACCOUNT_DELETION_URL: 'https://feasty.com.ng/account-deletion.html',
  PSL_DATA_DELETION_URL: 'https://feasty.com.ng/account-deletion.html',
};
const choice = {
  'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS|PSL_ACM_USER_ID_PASSWORD': 'true',
  'PSL_SUPPORT_DATA_DELETION_BY_USER|DATA_DELETION_YES': 'true',
};

// Data-type ids live under different category question ids; match on response id.
const selectedTypes = new Set(Object.keys(perApp));

const rows = parse(fs.readFileSync(inPath, 'utf8').replace(/^﻿/, ''));
const header = rows[0];
let set = 0;
for (const r of rows.slice(1)) {
  if (r.length < 3) continue;
  const [qid, rid] = r;
  let v = '';
  if (top[qid] !== undefined && !rid) v = top[qid];
  else if (choice[`${qid}|${rid}`]) v = choice[`${qid}|${rid}`];
  else if (qid.startsWith('PSL_DATA_TYPES_') && selectedTypes.has(rid)) v = 'true';
  else if (qid.startsWith('PSL_DATA_USAGE_RESPONSES:')) {
    const [, type, sub] = qid.split(':');
    const decl = perApp[type];
    if (decl) {
      if (sub === 'PSL_DATA_USAGE_COLLECTION_AND_SHARING' && rid === 'PSL_DATA_USAGE_ONLY_COLLECTED') v = 'true';
      else if (sub === 'PSL_DATA_USAGE_EPHEMERAL' && !rid) v = 'false';
      else if (sub === 'DATA_USAGE_USER_CONTROL' && rid === decl[0]) v = 'true';
      else if (sub === 'DATA_USAGE_COLLECTION_PURPOSE' && decl[1].includes(rid)) v = 'true';
    }
  }
  r[2] = v;
  if (v) set++;
}
const missing = [...selectedTypes].filter((t) => !rows.some((r) => r[1] === t));
if (missing.length) throw new Error('data type ids not in template: ' + missing.join(', '));
fs.writeFileSync(outPath, rows.filter((r) => r.length > 1).map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`${app}: ${set} answers set, ${selectedTypes.size} data types, header=${header.length} cols`);
