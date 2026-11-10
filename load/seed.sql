BEGIN;
SET LOCAL TIME ZONE 'UTC';
SELECT pg_advisory_xact_lock(760076);
CREATE SCHEMA IF NOT EXISTS load_fixture;
CREATE TABLE IF NOT EXISTS load_fixture.dataset (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    digest text NOT NULL,
    config jsonb NOT NULL
);

CREATE TEMP TABLE source (payload jsonb) ON COMMIT DROP;
\copy source FROM '@FIXTURE_FILE@'
SELECT EXISTS(SELECT FROM load_fixture.dataset) AS already_loaded \gset
\if :already_loaded
DO $$
BEGIN
  IF EXISTS (SELECT FROM load_fixture.dataset,source WHERE digest<>payload->>'digest') THEN
    RAISE EXCEPTION 'different fixture already loaded';
  END IF;
END $$;
\else
DO $$
BEGIN
  IF current_database()<>'mobile_tracer_load' OR EXISTS(SELECT FROM app.tenants) THEN
    RAISE EXCEPTION 'a fresh dedicated load database is required';
  END IF;
END $$;
CREATE TEMP TABLE settings ON COMMIT DROP AS
SELECT payload->'config' AS cfg, (payload->'config'->>'reference_time')::timestamptz AS ref,
       decode(payload->>'photo','hex') AS photo FROM source;

CREATE FUNCTION pg_temp.fixture_id(id uuid, suffix text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT md5(id::text || ':' || suffix)::uuid $$;
CREATE FUNCTION pg_temp.iso(ts timestamptz) RETURNS text
LANGUAGE sql STABLE STRICT AS $$ SELECT to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
CREATE FUNCTION pg_temp.canonical(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
SELECT CASE jsonb_typeof(value)
  WHEN 'object' THEN (SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||pg_temp.canonical(val),',' ORDER BY key COLLATE "C"),'')||'}'
                     FROM jsonb_each(value) AS items(key,val))
  WHEN 'array' THEN (SELECT '['||coalesce(string_agg(pg_temp.canonical(val),',' ORDER BY n),'')||']'
                    FROM jsonb_array_elements(value) WITH ORDINALITY AS items(val,n))
  ELSE value::text END
$$;
CREATE FUNCTION pg_temp.bytes(value jsonb) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT AS $$
SELECT convert_to(pg_temp.canonical(value),'UTF8')
$$;

CREATE TEMP TABLE fixture_companies ON COMMIT DROP AS
SELECT c.* FROM source, jsonb_to_recordset(payload->'companies') c(id uuid, config uuid, name text, admin uuid);
CREATE TEMP TABLE fixture_stores ON COMMIT DROP AS
SELECT s.* FROM source, jsonb_to_recordset(payload->'stores') s(id uuid, tenant uuid, name text);
CREATE TEMP TABLE fixture_staff ON COMMIT DROP AS
SELECT s.* FROM source, jsonb_to_recordset(payload->'staff') s(id uuid, "user" uuid, email text, tenant uuid, store uuid, role text);
CREATE TEMP TABLE fixture_customers ON COMMIT DROP AS
SELECT c.* FROM source, jsonb_to_recordset(payload->'customers') c(id uuid,email text);
CREATE TEMP TABLE fixture_vehicles ON COMMIT DROP AS
SELECT v.* FROM source, jsonb_to_recordset(payload->'vehicles') v(id uuid,tenant uuid,name text);
CREATE TEMP TABLE fixture_cases ON COMMIT DROP AS
SELECT c.* FROM source, jsonb_to_recordset(payload->'cases') c(id uuid,tenant uuid,store uuid,customer uuid,
  staff uuid,actor uuid,config uuid,state text,kind text,vehicle uuid,ordinal integer,start uuid);
CREATE TEMP TABLE fixture_events ON COMMIT DROP AS
SELECT e.id,e."case" AS case_id,e.kind,e.ordinal FROM source,
  jsonb_to_recordset(payload->'events') e(id uuid,"case" uuid,kind text,ordinal integer);
CREATE TEMP TABLE fixture_records ON COMMIT DROP AS
SELECT r.id,r."case" AS case_id,r.photos FROM source,
  jsonb_to_recordset(payload->'records') r(id uuid,"case" uuid,photos boolean);
ALTER TABLE fixture_cases ADD PRIMARY KEY(id);
ALTER TABLE fixture_events ADD PRIMARY KEY(id);
ANALYZE fixture_cases;
ANALYZE fixture_events;

INSERT INTO app.tenants(id,name,created_at) SELECT id,name,ref FROM fixture_companies,settings;
INSERT INTO app.stores(id,tenant_id,name,created_at) SELECT id,tenant,name,ref FROM fixture_stores,settings;
INSERT INTO app.staff_members(id,tenant_id,display_name,email,status,created_at)
 SELECT id,tenant,split_part(email,'@',1),email,'active',ref FROM fixture_staff,settings;
INSERT INTO app.staff_role_assignments(id,tenant_id,staff_id,role,store_id,created_by_staff,created_at)
 SELECT pg_temp.fixture_id(s.id,'role'),s.tenant,s.id,s.role,s.store,c.admin,ref
 FROM fixture_staff s JOIN fixture_companies c ON c.id=s.tenant CROSS JOIN settings;
INSERT INTO auth.users(id,issuer,subject,email,email_verified,account_type,display_name,created_at)
 SELECT id,'https://securetoken.google.com/demo-mobile-tracer-load',id::text,email,true,'general',split_part(email,'@',1),ref
 FROM fixture_customers,settings
 UNION ALL
 SELECT "user",'https://securetoken.google.com/demo-mobile-tracer-load',"user"::text,email,true,'business',split_part(email,'@',1),ref
 FROM fixture_staff,settings;
INSERT INTO auth.staff_links(id,user_id,tenant_id,staff_id,created_at)
 SELECT pg_temp.fixture_id(id,'link'),"user",tenant,id,ref FROM fixture_staff,settings;

CREATE TEMP TABLE modules ON COMMIT DROP AS
 SELECT kind,md5('mobile-tracer-load/template/'||kind)::uuid AS id,
 '{"stages":["intake","inspection"],"transitions":{"intake":["inspection"]},"record_kinds":{"inspection":{"fields":{"odometer":{"type":"integer","minimum":0,"maximum":1000000000,"required":true}}}}}'::jsonb AS definition
 FROM unnest(ARRAY['rental','dealer','repair']) kind;
INSERT INTO app.business_templates(id,business_type,version_no,definition)
 SELECT id,kind,1,jsonb_build_object('schema_version',1,'businesses',jsonb_build_object(kind,definition)) FROM modules;
INSERT INTO app.configuration_versions(id,tenant_id,version_no,settings,created_by_staff,created_at)
 SELECT config,id,1,jsonb_build_object('schema_version',1,'businesses',(SELECT jsonb_object_agg(kind,definition) FROM modules)),admin,ref
 FROM fixture_companies,settings;
INSERT INTO app.configuration_modules(tenant_id,configuration_version_id,business_type,template_id)
 SELECT c.id,c.config,m.kind,m.id FROM fixture_companies c CROSS JOIN modules m;
UPDATE app.configuration_versions SET status='published',published_by=created_by_staff,published_at=created_at
 WHERE id IN (SELECT config FROM fixture_companies);
UPDATE app.tenants SET status='active' WHERE id IN (SELECT id FROM fixture_companies);
INSERT INTO app.vehicles(id,tenant_id,model_name,created_at) SELECT id,tenant,name,ref FROM fixture_vehicles,settings;

INSERT INTO app.cases(id,tenant_id,store_id,vehicle_id,case_type,configuration_version_id,assignee_id,stage,created_by,created_at)
 SELECT id,tenant,store,vehicle,kind,config,staff,'intake',staff,ref FROM fixture_cases,settings;
WITH requests AS (
 SELECT f.*, n, CASE WHEN f.state='expired' THEN ref + interval '1 hour'
        ELSE ref + interval '365 days' END AS deadline, ref
 FROM fixture_cases f CROSS JOIN settings
 CROSS JOIN LATERAL generate_series(1,CASE WHEN state='corrected' THEN 2 ELSE 1 END) n
 WHERE state<>'reserved'
), material AS (
 SELECT q.*,pg_temp.bytes(jsonb_build_object(
   'schema','mobile-tracer/case-start/v1','case',to_jsonb(c),'vehicle',to_jsonb(v),
   'company_name',t.name,'store_name',s.name,'terms','Synthetic starting terms, revision '||q.n,
   'actor_id',q.actor,'customer_id',q.customer,'deadline',pg_temp.iso(q.deadline))) AS terms
 FROM requests q JOIN app.cases c ON c.id=q.id JOIN app.vehicles v ON v.id=q.vehicle
 JOIN fixture_companies t ON t.id=q.tenant JOIN fixture_stores s ON s.id=q.store
)
INSERT INTO app.case_start_requests(id,case_id,version_no,customer_id,actor_id,terms,terms_hash,deadline,request_key,created_at)
 SELECT CASE WHEN n=1 THEN start ELSE pg_temp.fixture_id(start,'revision') END,id,n,customer,actor,terms,
   encode(sha256(terms),'hex'),deadline,pg_temp.fixture_id(start,'key:'||n),ref + make_interval(mins=>n)
 FROM material;
INSERT INTO app.case_start_responses(request_id,actor_id,decision,created_at)
 SELECT start,customer,CASE WHEN state='corrected' THEN 'held' ELSE state END,ref+interval '5 minutes'
 FROM fixture_cases,settings WHERE state IN ('approved','held','rejected','corrected');
UPDATE app.cases SET status='in_progress' WHERE id IN (SELECT id FROM fixture_cases WHERE state='approved');

INSERT INTO app.case_events(id,case_id,actor_id,origin,kind,title,description,deadline,request_key,created_at)
 SELECT e.id,c.id,CASE WHEN e.kind IN ('incident','request') THEN c.customer ELSE c.actor END,
   CASE WHEN e.kind IN ('incident','request') THEN 'customer' ELSE 'business' END,
   e.kind,'Synthetic '||e.kind,'Synthetic event description',ref+interval '2 days',
   pg_temp.fixture_id(e.id,'key'),ref+interval '1 hour'+make_interval(mins=>10*e.ordinal)
 FROM fixture_events e JOIN fixture_cases c ON c.id=e.case_id CROSS JOIN settings;
INSERT INTO app.case_event_actions(id,event_id,actor_id,action,detail,request_key,sequence,created_at)
 SELECT pg_temp.fixture_id(e.id,'action:'||n),e.id,
   CASE WHEN n=4 OR (n=1 AND e.origin='business') THEN c.customer ELSE c.actor END,
   (ARRAY['approved','executed','reported','completed'])[n],'Synthetic event action',
   pg_temp.fixture_id(e.id,'action-key:'||n),n,e.created_at+make_interval(mins=>n)
 FROM app.case_events e JOIN fixture_cases c ON c.id=e.case_id
 CROSS JOIN LATERAL generate_series(1,CASE WHEN e.kind='progress_report' THEN 1 ELSE 4 END) n;

WITH manifests AS (
 SELECT 'case_start'::text AS kind,q.id,pg_temp.bytes(jsonb_build_object(
   'schema','mobile-tracer/case-acceptance/v1','request_id',q.id,'case_id',q.case_id,
   'terms',convert_from(q.terms,'UTF8')::jsonb,'approval',
   jsonb_build_object('ActorID',r.actor_id,'Decision',r.decision,'CreatedAt',pg_temp.iso(r.created_at)))) AS raw
 FROM app.case_start_requests q JOIN app.case_start_responses r ON r.request_id=q.id AND r.decision='approved'
 UNION ALL
 SELECT registration.kind,e.id,pg_temp.bytes(jsonb_build_object(
   'schema','mobile-tracer/case-event/v1','subject_type',registration.kind,
   'event',(to_jsonb(e)-'request_key')||jsonb_build_object('created_at',pg_temp.iso(e.created_at),'deadline',pg_temp.iso(e.deadline)),
   'actions',(SELECT jsonb_agg((to_jsonb(a)-'request_key')||jsonb_build_object('created_at',pg_temp.iso(a.created_at)) ORDER BY a.sequence)
    FROM app.case_event_actions a WHERE a.event_id=e.id AND (registration.kind='event_completion' OR a.sequence=1))))
 FROM app.case_events e CROSS JOIN unnest(ARRAY['event_approval','event_completion']) AS registration(kind)
 WHERE registration.kind='event_approval' OR e.kind<>'progress_report'
)
INSERT INTO integrity.api_registrations(id,subject_type,subject_id,manifest,manifest_hash)
 SELECT pg_temp.fixture_id(id,kind),kind,id,raw,encode(sha256(raw),'hex') FROM manifests;

INSERT INTO app.records(id,tenant_id,case_id,record_kind,created_by,created_at)
 SELECT r.id,c.tenant,c.id,'inspection',c.staff,ref+interval '8 hours'
 FROM fixture_records r JOIN fixture_cases c ON c.id=r.case_id CROSS JOIN settings;

DO $$
DECLARE version integer; versions integer; per_version integer; mime text;
BEGIN
 SELECT (cfg->>'versions_per_record')::int,(cfg->>'photos_per_version')::int,'image/'||(cfg->>'photo_format')
 INTO versions,per_version,mime FROM settings;
 FOR version IN 1..versions LOOP
   INSERT INTO app.record_versions(id,tenant_id,case_id,record_id,version_no,based_on_version_id,
     change_kind,change_reason,configuration_version_id,created_by,created_at)
   SELECT pg_temp.fixture_id(r.id,'version:'||version),c.tenant,c.id,r.id,version,
     CASE WHEN version>1 THEN pg_temp.fixture_id(r.id,'version:'||(version-1)) END,
     CASE WHEN version>1 THEN 'correction' END,CASE WHEN version>1 THEN 'Synthetic correction' END,
     c.config,c.staff,ref+interval '8 hours'+make_interval(mins=>10*version)
   FROM fixture_records r JOIN fixture_cases c ON c.id=r.case_id CROSS JOIN settings
   WHERE version=1 OR r.photos;
   INSERT INTO app.record_entries(tenant_id,case_id,record_version_id,item_key,value)
   SELECT v.tenant_id,v.case_id,v.id,'odometer',to_jsonb(c.ordinal*10+version)
   FROM app.record_versions v JOIN fixture_cases c ON c.id=v.case_id WHERE v.version_no=version;
   INSERT INTO app.workflow_media(id,tenant_id,case_id,record_version_id,request_key,position,mime_type,bytes,sha256,actor_id,
      device_captured_at,latitude,longitude,location_label,captured_at_source,location_source,created_at)
   SELECT pg_temp.fixture_id(v.id,'photo:'||n),v.tenant_id,v.case_id,v.id,pg_temp.fixture_id(v.id,'photo-key:'||n),
     (ARRAY['正面','右前','右後','後面','左後','左前'])[n],mime,photo,encode(sha256(photo),'hex'),c.actor,
     v.created_at,35.000000,139.000000,'Synthetic test location','device','device',v.created_at
   FROM app.record_versions v JOIN fixture_records r ON r.id=v.record_id AND r.photos
   JOIN fixture_cases c ON c.id=v.case_id CROSS JOIN settings CROSS JOIN generate_series(1,per_version) n
   WHERE v.version_no=version;
   WITH content AS (
     SELECT v.id,c.actor,v.created_at,pg_temp.bytes(jsonb_build_object(
       'schema','mobile-tracer/record/v1','version',to_jsonb(v)||jsonb_build_object('status','submitted',
         'entries',jsonb_build_object('odometer',c.ordinal*10+version)),
       'case',to_jsonb(item),'vehicle',to_jsonb(vehicle),'presented_by',c.actor,'presented_at',pg_temp.iso(v.created_at),
       'media',(SELECT jsonb_agg(to_jsonb(m)-'bytes'-'request_key' ORDER BY m.position,m.id)
                FROM app.workflow_media m WHERE m.record_version_id=v.id))) AS raw
     FROM app.record_versions v JOIN fixture_records r ON r.id=v.record_id AND r.photos
     JOIN fixture_cases c ON c.id=v.case_id JOIN app.cases item ON item.id=c.id
     JOIN app.vehicles vehicle ON vehicle.id=c.vehicle WHERE v.version_no=version
   )
   INSERT INTO app.workflow_presentations(version_id,content,content_hash,actor_id,created_at)
   SELECT id,raw,encode(sha256(raw),'hex'),actor,created_at FROM content;
   UPDATE app.record_versions v SET status='submitted',vehicle_snapshot=to_jsonb(vehicle),hash_algorithm='sha256',
      content_hash=(SELECT p.content_hash FROM app.workflow_presentations p WHERE p.version_id=v.id),
      submit_idempotency_key=pg_temp.fixture_id(v.id,'submit'),submitted_by=v.created_by,submitted_at=v.created_at+interval '1 minute'
   FROM fixture_cases c JOIN app.vehicles vehicle ON vehicle.id=c.vehicle
   WHERE v.case_id=c.id AND v.version_no=version AND EXISTS(SELECT FROM app.workflow_presentations p WHERE p.version_id=v.id);
   INSERT INTO app.workflow_requests(id,version_id,user_id,qualification,kind,statement,deadline)
   SELECT pg_temp.fixture_id(v.id,'confirmation'),v.id,c.customer,
     CASE c.kind WHEN 'rental' THEN 'renter' WHEN 'dealer' THEN 'purchaser' ELSE 'repair_requester' END,
     'state_agreement','Synthetic record review',v.created_at+interval '1 day'
   FROM app.workflow_presentations p JOIN app.record_versions v ON v.id=p.version_id
   JOIN fixture_cases c ON c.id=v.case_id WHERE v.version_no=version;
 END LOOP;
END $$;

-- Only the first presentation is answered. Corrections require a new answer.
INSERT INTO app.workflow_responses(request_id,actor_id,decision,created_at)
 SELECT q.id,q.user_id,'approved',p.created_at+interval '2 minutes'
 FROM app.workflow_requests q JOIN app.workflow_presentations p ON p.version_id=q.version_id
 JOIN app.record_versions v ON v.id=q.version_id WHERE v.version_no=1;
WITH manifests AS (
 SELECT p.version_id,pg_temp.bytes(jsonb_build_object('schema','mobile-tracer/anchor/v1',
  'content_hash',p.content_hash,'approvals',jsonb_build_array(to_jsonb(q)||jsonb_build_object(
    'deadline',pg_temp.iso(q.deadline),'decision',r.decision,'responded_at',pg_temp.iso(r.created_at))))) AS raw
 FROM app.workflow_presentations p JOIN app.workflow_requests q ON q.version_id=p.version_id
 JOIN app.workflow_responses r ON r.request_id=q.id
)
INSERT INTO app.workflow_anchors(version_id,manifest,manifest_hash)
 SELECT version_id,raw,encode(sha256(raw),'hex') FROM manifests;
INSERT INTO integrity.api_registrations(id,subject_type,subject_id,manifest,manifest_hash)
 SELECT pg_temp.fixture_id(version_id,'record-registration'),'record',version_id,manifest,manifest_hash FROM app.workflow_anchors;

WITH history AS (
 SELECT c.tenant,q.actor_id actor,'case.start.present' AS action,'case' AS target_type,c.id AS target,q.created_at,q.id AS source_id
 FROM app.case_start_requests q JOIN fixture_cases c ON c.id=q.case_id
 UNION ALL
 SELECT c.tenant,r.actor_id,'case.start.respond','case',c.id,r.created_at,q.id
 FROM app.case_start_responses r JOIN app.case_start_requests q ON q.id=r.request_id JOIN fixture_cases c ON c.id=q.case_id
 UNION ALL
 SELECT c.tenant,e.actor_id,'case.event.create','case',c.id,e.created_at,e.id
 FROM app.case_events e JOIN fixture_cases c ON c.id=e.case_id
 UNION ALL
 SELECT c.tenant,a.actor_id,'case.event.'||a.action,'case',c.id,a.created_at,a.id
 FROM app.case_event_actions a JOIN app.case_events e ON e.id=a.event_id JOIN fixture_cases c ON c.id=e.case_id
 UNION ALL
 SELECT c.tenant,p.actor_id,'workflow.present','record_version',p.version_id,p.created_at,p.version_id
 FROM app.workflow_presentations p JOIN app.record_versions v ON v.id=p.version_id JOIN fixture_cases c ON c.id=v.case_id
 UNION ALL
 SELECT c.tenant,r.actor_id,'transaction.respond','record_version',q.version_id,r.created_at,q.id
 FROM app.workflow_responses r JOIN app.workflow_requests q ON q.id=r.request_id
 JOIN app.record_versions v ON v.id=q.version_id JOIN fixture_cases c ON c.id=v.case_id
)
INSERT INTO audit.events(tenant_id,created_at,actor_type,actor_id,action,target_type,target_id,result,details,entry_hash)
 SELECT tenant,created_at,'user',actor,action,target_type,target,'succeeded','{"fixture":true}',
  encode(sha256(convert_to(action||':'||source_id,'UTF8')),'hex') FROM history ORDER BY created_at,action,source_id;

INSERT INTO load_fixture.dataset(digest,config) SELECT payload->>'digest',payload->'config' FROM source;
\endif
COMMIT;
