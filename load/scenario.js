import http from 'k6/http';
import exec from 'k6/execution';
import crypto from 'k6/crypto';
import { Counter, Rate, Trend } from 'k6/metrics';
import { sleep } from 'k6';

const targets = JSON.parse(open('/state/targets.json'));
const uploadImages = Array.from({ length: 20 }, (_, index) =>
  open(`/state/upload-${String(index + 1).padStart(2, '0')}.jpeg`, 'b'));
const scenario = __ENV.SCENARIO;
const vus = Number(__ENV.VUS);
const rate = Number(__ENV.RATE);
const startRate = Number(__ENV.START_RATE || rate);
const maxVUs = Number(__ENV.MAX_VUS || vus);
const profile = __ENV.PROFILE || 'load';
const imageCount = Number(__ENV.IMAGE_COUNT || 10);
const seconds = Number(__ENV.SECONDS);
const once = __ENV.ONCE === '1' || scenario === 'conflict';
const base = 'http://nginx:8080';
const host = 'localhost:' + __ENV.LOAD_HTTP_PORT;
const origin = 'http://' + host;
const firebase = 'http://firebase-auth:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key';
const failed = new Rate('business_failed');
const iterationFailed = new Rate('iteration_failed');
const iterationStarted = new Counter('iteration_started');
const iterationCompleted = new Counter('iteration_completed');
const uploadRate = new Trend('image_upload_bytes_per_second');
const downloadRate = new Trend('image_download_bytes_per_second');
const status = new Counter('operation_status');
const timedOut = new Counter('operation_timeout');
const conflicts = new Counter('expected_conflicts');
const writes = ['write', 'images', 'mixed', 'registration', 'conflict'].includes(scenario);
const readShare = scenario === 'mixed' ? Number(__ENV.READ_PERCENT) / 100 : 0;
const profileFactor = profile === 'spike' ? 5 : profile === 'stress' ? 3 : 1;
const maxIterations = once ? 1 : rate ? rate * seconds * profileFactor + 1 : vus * seconds * 2;
const writeLimit = Math.min(targets.write.length, maxIterations - Math.floor(maxIterations * readShare));
const readSlots = targets.read.slice(0, Math.max(4, vus * 2));
const mediaSlots = targets.read.filter(row => row.sample_media).slice(0, Math.max(4, vus * 2));
const warmupUsers = readSlots.concat(mediaSlots);
const accepted = http.expectedStatuses({min: 200, max: 299});
const one = { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: `${Math.max(seconds, 15)}s` };
const operationNames = [
  'firebase_token', 'login_challenge', 'session', 'me', 'case_list', 'case_detail', 'history', 'transactions',
  'scoped_search', 'transaction_detail', 'photo_read', 'case_start_present', 'case_start_replay', 'case_start_wrong_actor',
  'cross_customer', 'cross_company', 'cross_store', 'pending_start', 'event_before_approval', 'case_start_correct',
  'superseded_start', 'case_start_approve', 'active_case', 'event_replay', 'competing_execution', 'event_completed',
  'draft_create', 'photo_upload', 'photo_uploaded_read', 'record_present', 'presented_record', 'record_approve',
  ...['work', 'progress_report', 'request'].flatMap(kind =>
    ['create', 'approved', 'executed', 'reported', 'completed'].map(action => kind + '_' + action)),
];
const operationMetrics = {};
for (const op of operationNames) {
  // k6 includes tagged aggregates in its end-of-test JSON only when selected.
  operationMetrics[`http_req_duration{phase:business,operation:${op}}`] = ['max>=0'];
  operationMetrics[`http_req_failed{phase:business,operation:${op}}`] = ['rate>=0'];
  operationMetrics[`business_failed{operation:${op}}`] = ['rate>=0'];
  operationMetrics[`operation_timeout{operation:${op}}`] = ['count>=0'];
  operationMetrics[`expected_conflicts{operation:${op}}`] = ['count>=0'];
  for (const code of [0, 200, 201, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]) {
    operationMetrics[`operation_status{operation:${op},code:${code}}`] = ['count>=0'];
  }
}

function mainScenario() {
  if (once) return one;
  if (!rate) return { executor: 'constant-vus', vus, duration: `${seconds}s`, gracefulStop: '15s' };
  if (profile === 'stress') return {
    executor: 'ramping-arrival-rate', startRate, timeUnit: '1s', preAllocatedVUs: vus, maxVUs,
    stages: [{ target: rate, duration: `${Math.max(1, Math.floor(seconds / 3))}s` },
      { target: rate * 2, duration: `${Math.max(1, Math.floor(seconds / 3))}s` },
      { target: rate * 3, duration: `${Math.max(1, seconds - 2 * Math.floor(seconds / 3))}s` }], gracefulStop: '15s',
  };
  if (profile === 'spike') return {
    executor: 'ramping-arrival-rate', startRate, timeUnit: '1s', preAllocatedVUs: vus, maxVUs,
    stages: [{ target: rate, duration: `${Math.max(1, Math.floor(seconds / 4))}s` },
      { target: rate * 5, duration: `${Math.max(1, Math.floor(seconds / 4))}s` },
      { target: rate, duration: `${Math.max(1, seconds - 2 * Math.floor(seconds / 4))}s` }], gracefulStop: '15s',
  };
  return { executor: 'constant-arrival-rate', rate, timeUnit: '1s', duration: `${seconds}s`,
    preAllocatedVUs: vus, maxVUs, gracefulStop: '15s' };
}

export const options = {
  setupTimeout: '15m',
  scenarios: { main: mainScenario() },
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response', 'error_code'],
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds: {
    ...operationMetrics,
    iteration_started: ['count>0'],
    business_failed: ['rate==0'],
    iteration_failed: ['rate==0'],
    'http_req_duration{phase:business}': ['p(99)<15000'],
    'http_req_failed{phase:business}': ['rate==0'],
  },
};

function safeJSON(response) {
  try { return response.json(); } catch (_) { return null; }
}

function session(email, phase) {
  const jar = new http.CookieJar();
  const request = (method, path, body, key, csrf) => http.request(method, base + path,
    body === null ? null : JSON.stringify(body),
    { jar, headers: { Host: host, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
      tags: { name: key, operation: key, phase }, redirects: 0, timeout: '15s', responseCallback: accepted });
  const token = http.post(firebase, JSON.stringify({ email, password: __ENV.LOAD_USER_PASSWORD, returnSecureToken: true }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'firebase_token', operation: 'firebase_token', phase }, timeout: '15s' });
  const identity = safeJSON(token);
  const challenge = request('GET', '/api/auth/login-challenge', null, 'login_challenge');
  const csrf = safeJSON(challenge)?.data?.csrf_token;
  if (!identity?.idToken || !csrf) throw new Error(`login prerequisites failed: ${token.status}/${challenge.status}`);
  const login = request('POST', '/api/auth/session', { id_token: identity.idToken }, 'session', csrf);
  const me = request('GET', '/api/auth/me', null, 'me');
  const data = safeJSON(me)?.data;
  if (login.status !== 200 || me.status !== 200 || !data?.csrf_token || data.user?.email !== email) {
    throw new Error(`session failed: ${login.status}/${me.status}`);
  }
  const cookies = Object.fromEntries(Object.entries(jar.cookiesForURL(base + '/api/auth/me'))
    .map(([name, values]) => [name, { value: values[0], replace: true }]));
  return { cookies, csrf: data.csrf_token };
}

function conflictPeers(row) {
  const customer = targets.read.find(item => item.customer_email !== row.customer_email);
  const company = targets.read.find(item => item.tenant !== row.tenant);
  const store = targets.read.find(item => item.tenant === row.tenant && item.store !== row.store);
  if (!customer || !company || !store) {
    exec.test.abort('conflict requires a second customer, company and store in the fixture');
  }
  return [['cross_customer', customer.customer_email], ['cross_company', company.manager_email],
    ['cross_store', store.manager_email]];
}

export function setup() {
  if (!readSlots.length || (writes && readShare !== 1 && !writeLimit)) exec.test.abort('dataset has no targets for the scenario');
  const writeSlots = targets.write.slice(0, writeLimit);
  const emails = new Set();
  for (const row of warmupUsers) {
    emails.add(row.customer_email);
    emails.add(row.manager_email);
    emails.add(row.staff_email);
  }
  if (writes) {
    for (const row of writeSlots) {
      emails.add(row.customer_email);
      emails.add(row.manager_email);
      emails.add(row.staff_email);
    }
  }
  if (scenario === 'conflict') {
    for (const [, email] of conflictPeers(writeSlots[0])) emails.add(email);
  }
  const sessions = {};
  if (scenario !== 'login') {
    for (const email of emails) sessions[email] = session(email, 'prepare');
  }
  return sessions;
}

function record(op, response, ok, expected = []) {
  status.add(1, { operation: op, code: String(response.status) });
  timedOut.add(response.error_code === 1050 ? 1 : 0, { operation: op });
  conflicts.add(ok && expected.includes(409) && response.status === 409 ? 1 : 0, { operation: op });
  failed.add(!ok, { operation: op });
  if (!ok) throw new Error(`${op} failed: HTTP ${response.status}`);
}

function params(user, op, expected, binary = false, multipart = false) {
  return {
    jar: new http.CookieJar(),
    cookies: user.cookies,
    headers: { Host: host, Origin: origin, 'X-CSRF-Token': user.csrf, 'X-Load-Phase': 'business',
      ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    tags: { name: op, operation: op, phase: 'business' }, redirects: 0, timeout: '15s',
    responseType: binary ? 'binary' : 'text', responseCallback: http.expectedStatuses(...expected),
  };
}

function api(user, op, method, path, body, expected, check, opts = {}) {
  const { binary = false, multipart = false, observe = null } = opts;
  const response = http.request(method, base + path, multipart ? body : body === null ? null : JSON.stringify(body),
    params(user, op, expected, binary, multipart));
  if (observe) observe(response);
  const data = binary ? response.body : safeJSON(response)?.data;
  record(op, response, expected.includes(response.status) && check(data, response), expected);
  return data;
}

function get(user, op, path, check) {
  return api(user, op, 'GET', path, null, [200], check);
}

function post(user, op, path, body, code, check, opts) {
  return api(user, op, 'POST', path, body, [code], check, opts);
}

function key() {
  const raw = new Uint8Array(crypto.randomBytes(16));
  raw[6] = (raw[6] & 15) | 64;
  raw[8] = (raw[8] & 63) | 128;
  const hex = Array.from(raw, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const deadline = () => new Date(Date.now() + 3600000).toISOString();

function read(sessions, i) {
  const isHot = (i * 37 + 17) % 100 < targets.hot_percent;
  const row = isHot ? readSlots[0] : readSlots[i % readSlots.length];
  const customer = sessions[row.customer_email];
  const business = sessions[i % 2 ? row.staff_email : row.manager_email];
  get(customer, 'case_list', '/api/casework', Array.isArray);
  get(customer, 'case_detail', '/api/casework/' + row.id, data => data?.case?.id === row.id);
  get(customer, 'history', '/api/me/history', Array.isArray);
  get(customer, 'transactions', '/api/transactions', Array.isArray);
  get(business, 'scoped_search', '/api/casework?q=Load', rows =>
    Array.isArray(rows) && rows.every(item => item.configuration_version_id === row.config && item.store_id === row.store));
  if (row.sample_media) get(customer, 'transaction_detail', '/api/transactions/' + row.sample_version,
    data => data?.content?.version?.id === row.sample_version && data?.content?.vehicle?.id === row.vehicle &&
      Array.isArray(data?.content?.vehicle?.identifiers));
}

function mediaRead(sessions, i) {
  if (!mediaSlots.length) return;
  const row = mediaSlots[i % mediaSlots.length];
  api(sessions[row.customer_email], 'photo_read', 'GET',
    `/api/transactions/${row.sample_version}/media/${row.sample_media}`, null, [200],
    (body, response) => body?.byteLength === targets.photo_bytes &&
      response.headers['Content-Type'] === targets.photo_mime && crypto.sha256(body, 'hex') === row.sample_media_sha256,
    { binary: true, observe: response => {
      if (response.timings.duration > 0) downloadRate.add(response.body.byteLength * 1000 / response.timings.duration);
    } });
}

function start(row, staff, customer, validate = false, others = null) {
  const path = '/api/casework/starts';
  const request = { case_id: row.id, email: row.customer_email, terms: 'Synthetic load-test terms',
    deadline: deadline(), request_key: key() };
  const check = data => data?.case_id === row.id && !!data.id;
  const created = post(staff, 'case_start_present', path, request, 201, check);
  const reply = `${path}/${created.id}/respond`;
  const detail = '/api/casework/' + row.id;
  if (validate) {
    post(staff, 'case_start_replay', path, request, 201, data => data?.id === created.id);
    post(staff, 'case_start_wrong_actor', reply, { decision: 'approved' }, 404, () => true);
    for (const [op, user] of others) api(user, op, 'GET', detail, null, [404], () => true);
    get(customer, 'pending_start', detail, data => data?.case?.status === 'awaiting_customer' &&
        !data.registrations?.some(reg => reg.subject_id === created.id));
    post(staff, 'event_before_approval', detail + '/events',
      { kind: 'work', title: 'Invalid before approval', description: 'Negative probe', deadline: deadline(), request_key: key() },
      409, () => true);
    const revised = post(staff, 'case_start_correct', path,
      { ...request, terms: 'Revised test terms', request_key: key() }, 201, data => check(data) && data.version_no === 2);
    post(customer, 'superseded_start', reply, { decision: 'approved' }, 409, () => true);
    post(customer, 'case_start_approve', `${path}/${revised.id}/respond`, { decision: 'approved' }, 200, data => data === 'saved');
  } else {
    post(customer, 'case_start_approve', reply, { decision: 'approved' }, 200, data => data === 'saved');
  }
  get(customer, 'active_case', detail, data => data?.case?.status === 'in_progress' &&
    data.registrations?.some(reg => reg.subject_type === 'case_start'));
}

function event(row, maker, approver, staff, customer, kind, conflict = false) {
  const path = `/api/casework/${row.id}/events`;
  const request = { kind, title: 'Synthetic work', description: 'Synthetic test action', deadline: deadline(), request_key: key() };
  let created;
  if (conflict) {
    const responses = http.batch([0, 1].map(() => ['POST', base + path, JSON.stringify(request),
      params(maker, 'event_replay', [201])]));
    const first = safeJSON(responses[0])?.data?.id;
    for (const response of responses) record('event_replay', response,
      response.status === 201 && !!first && safeJSON(response)?.data?.id === first);
    created = { id: first };
  } else {
    created = post(maker, kind + '_create', path, request, 201, data => !!data?.id);
  }
  const actionPath = `${path}/${created.id}/actions`;
  const act = (user, action) => post(user, kind + '_' + action, actionPath,
    { action, request_key: key(), detail: 'Synthetic result' }, 200, data => data === 'saved');
  act(approver, 'approved');
  if (conflict) {
    const responses = http.batch([0, 1].map(() => ['POST', base + actionPath,
      JSON.stringify({ action: 'executed', request_key: key() }), params(staff, 'competing_execution', [200, 409])]));
    const valid = responses.map(item => item.status).sort().join(',') === '200,409';
    for (const response of responses) record('competing_execution', response, valid, [200, 409]);
  } else if (kind !== 'progress_report') {
    act(staff, 'executed');
  }
  if (kind !== 'progress_report') {
    act(staff, 'reported');
    act(customer, 'completed');
  }
  get(customer, 'event_completed', '/api/casework/' + row.id,
    data => data?.events?.some(item => item.event.id === created.id && item.state === 'completed'));
}

function upload(row, staff, customer) {
  const positions = {
    rental: ['正面', '右前', '右後', '後面', '左後', '左前'],
    dealer: ['正面', '右前', '右側面', '右後', '後面', '左後', '左側面', '左前'],
    repair: ['正面', '右前', '右後', '後面', '左後', '左前'],
  }[row.kind];
  const qualification = { rental: 'renter', dealer: 'purchaser', repair: 'repair_requester' }[row.kind];
  let uploaded = 0;
  while (uploaded < imageCount) {
    const draft = post(staff, 'draft_create', `/api/cases/${row.id}/records`,
      { record_kind: 'inspection', entries: { odometer: 12000 + uploaded } }, 201, data => !!data?.draft?.id).draft;
    const path = '/api/transactions/' + draft.id;
    const media = [];
    const batchImages = [];
    const batch = Math.min(positions.length, imageCount - uploaded);
    for (let n = 0; n < batch; n++) {
      const image = uploadImages[uploaded + n];
      batchImages.push(image);
      media.push(post(staff, 'photo_upload', path + '/media', {
        photo: http.file(image, `fixture-${uploaded + n + 1}.jpg`, 'image/jpeg'), request_key: key(), position: positions[n],
        device_captured_at: new Date().toISOString(), latitude: '35', longitude: '139',
        location_label: 'Synthetic test location', captured_at_source: 'metadata', location_source: 'metadata',
      }, 201, data => !!data?.id, { multipart: true, observe: response => {
        if (response.timings.duration > 0) uploadRate.add(image.byteLength * 1000 / response.timings.duration);
      } }));
    }
    api(staff, 'photo_uploaded_read', 'GET', path + '/media/' + media[0].id, null, [200],
      body => body?.byteLength === batchImages[0].byteLength &&
        crypto.sha256(body, 'hex') === crypto.sha256(batchImages[0], 'hex'),
      { binary: true });
    post(staff, 'record_present', path + '/present', { request_key: key(), lock_version: draft.lock_version,
      recipients: [{ email: row.customer_email, qualification, kind: 'state_agreement', statement: 'Review the photo', deadline: deadline() }] },
      200, data => !!data);
    const presented = get(customer, 'presented_record', path, data =>
      data?.content?.version?.id === draft.id && !!data.requests?.[0]?.id && !data.anchor);
    post(customer, 'record_approve', path + '/respond',
      { request_id: presented.requests[0].id, decision: 'approved' }, 200, data => data === 'answered');
    uploaded += batch;
  }
}

function mutate(sessions, i, mode) {
  if (i >= writeLimit) exec.test.abort('write targets exhausted; reseed or lower duration/arrival rate');
  const row = targets.write[i];
  const staff = sessions[i % 2 ? row.staff_email : row.manager_email];
  const customer = sessions[row.customer_email];
  const others = mode === 'conflict' ? conflictPeers(row).map(([op, email]) => [op, sessions[email]]) : null;
  start(row, staff, customer, mode === 'conflict', others);
  if (mode === 'registration') return;
  if (mode === 'images') return upload(row, staff, customer);
  event(row, staff, customer, staff, customer, 'work', mode === 'conflict');
  event(row, staff, customer, staff, customer, 'progress_report');
  event(row, customer, staff, staff, customer, 'request');
}

export default function (sessions) {
  iterationStarted.add(1);
  const index = exec.scenario.iterationInTest;
  try {
    if (scenario === 'login') {
      session(readSlots[index % readSlots.length].customer_email, 'business');
      failed.add(false, { operation: 'login' });
    } else if (scenario === 'read') {
      read(sessions, index);
    } else if (scenario === 'mixed' && Math.floor((index + 1) * Number(__ENV.READ_PERCENT) / 100) >
        Math.floor(index * Number(__ENV.READ_PERCENT) / 100)) {
      read(sessions, index);
      mediaRead(sessions, index);
    } else {
      const readPercent = Number(__ENV.READ_PERCENT);
      const slot = scenario === 'mixed' ? index - Math.floor(index * readPercent / 100) : index;
      mutate(sessions, slot, scenario === 'mixed' && index % 2 === 0 ? 'images' : scenario);
      if (scenario === 'images') mediaRead(sessions, index);
    }
    iterationFailed.add(false);
  } catch (error) {
    iterationFailed.add(true);
    if (scenario === 'login') failed.add(true, { operation: 'login' });
    console.error(String(error));
  }
  iterationCompleted.add(1);
  if (!once && !rate && writes) sleep(0.5);
}

export function handleSummary(data) {
  return { [`/results/${__ENV.RESULT}/k6.json`]: JSON.stringify(data, null, 2) };
}
