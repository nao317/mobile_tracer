import { createServer } from "node:http";
import { createPreviewData } from "../../app/features/workspace/preview-data.ts";
import { createManagementFixture } from "./management-api.mjs";

// Loopback-only test API. The explicit fixture cookie is accepted here only;
// it never creates a Firebase session or runs in an application deployment.
const snapshot = createPreviewData();
const management = createManagementFixture();
const session = {
  user: {
    id: snapshot.context.principal.staff_id,
    email: "fixture@example.com",
    email_verified: true,
  },
  memberships: [],
  selected_staff_id: snapshot.context.principal.staff_id,
  system_admin: false,
  csrf_token: "fixture-csrf",
};
const config = {
  enabled: true,
  apiKey: "e2e-public-key",
  authDomain: "demo-e2e.firebaseapp.com",
  projectId: "demo-e2e",
  appId: "e2e-app",
  emulatorUrl: "",
};

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  const url = new URL(request.url, "http://fixture.local");
  const parts = url.pathname.split("/").filter(Boolean);
  const send = (data, status = 200) => {
    response.statusCode = status;
    response.end(JSON.stringify(data));
  };
  if (request.method === "GET" && request.url === "/api/auth/config") {
    response.end(JSON.stringify({ data: config }));
  } else if (request.method === "GET" && request.url === "/health") {
    response.end(JSON.stringify({ status: "ok" }));
  } else if ((request.headers.cookie ?? "").includes("ui_fixture_session=1")) {
    const role = (request.headers.cookie ?? "").match(
      /ui_fixture_role=(admin|general)/,
    )?.[1];
    if (url.pathname === "/api/auth/me")
      return send({ data: role ? management.session(role) : session });
    if (role && (await management.handle(request, url, send, role))) return;
    if (url.pathname === "/api/context")
      return send({ data: snapshot.context });
    let collection, item;
    if (parts[1] === "vehicles") {
      collection = snapshot.vehicles;
      item = collection.find((v) => v.id === parts[2]);
    }
    if (parts[1] === "cases") {
      collection = snapshot.cases;
      item = collection.find((c) => c.id === parts[2]);
      if (parts[3] === "records") {
        collection = snapshot.records.filter((r) => r.case_id === parts[2]);
        item = collection.find((r) => r.id === parts[4]);
        if (parts[5] === "versions") {
          collection = snapshot.versions.filter(
            (v) => v.record_id === parts[4] && v.case_id === parts[2],
          );
          item = collection.find((v) => v.id === parts[6]);
        }
      }
    }
    if (request.method === "GET") {
      if (!collection) return send({ error: { code: "not_found" } }, 404);
      if (parts.length % 2 === 1)
        return item
          ? send({ data: item })
          : send({ error: { code: "not_found" } }, 404);
      let rows = collection;
      for (const key of ["vehicle_id", "case_type", "status"])
        if (url.searchParams.get(key))
          rows = rows.filter((row) => row[key] === url.searchParams.get(key));
      if (url.searchParams.get("q"))
        rows = rows.filter((row) =>
          JSON.stringify(row)
            .toLowerCase()
            .includes(url.searchParams.get("q").toLowerCase()),
        );
      const page = Number(url.searchParams.get("page") ?? 1),
        pageSize = Number(url.searchParams.get("page_size") ?? 20);
      return send({
        data: rows.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, page_size: pageSize, total: rows.length },
      });
    }
    if (
      request.headers["x-csrf-token"] !== session.csrf_token ||
      !request.headers.origin
    )
      return send({ error: { code: "forbidden" } }, 403);
    try {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw),
        id = crypto.randomUUID(),
        created_at = new Date().toISOString();
      if (request.method === "POST" && url.pathname === "/api/vehicles") {
        const vehicle = {
          id,
          model_name: body.model_name,
          created_at,
          identifiers: body.identifiers.map((i) => ({
            ...i,
            id: crypto.randomUUID(),
            valid_from: null,
            valid_to: null,
            verified_at: null,
          })),
        };
        snapshot.vehicles.unshift(vehicle);
        return send({ data: vehicle }, 201);
      }
      if (request.method === "POST" && url.pathname === "/api/cases") {
        const business = {
          ...body,
          id,
          created_by: snapshot.context.principal.staff_id,
          created_at,
          stage:
            snapshot.context.configuration.settings.businesses[body.case_type]
              .stages[0],
          status: "in_progress",
        };
        snapshot.cases.unshift(business);
        return send({ data: business }, 201);
      }
      if (request.method === "POST" && parts[3] === "records") {
        const record = {
          id,
          case_id: parts[2],
          record_kind: body.record_kind,
          created_by: snapshot.context.principal.staff_id,
          created_at,
        };
        const draft = {
          id: crypto.randomUUID(),
          case_id: parts[2],
          record_id: id,
          version_no: 1,
          status: "draft",
          configuration_version_id: snapshot.context.configuration.id,
          lock_version: 0,
          based_on_version_id: null,
          change_reason: null,
          submitted_at: null,
          created_at,
          entries: body.entries,
        };
        snapshot.records.unshift(record);
        snapshot.versions.unshift(draft);
        return send({ data: { record, draft } }, 201);
      }
      if (request.method === "PUT" && item && parts[7] === "entries") {
        if (item.lock_version !== body.lock_version)
          return send({ error: { code: "version_conflict", fields: {} } }, 409);
        item.entries = body.entries;
        item.lock_version++;
        return send({ data: item });
      }
      if (request.method === "PATCH" && item) {
        Object.assign(item, body);
        return send({ data: item });
      }
      return send({ error: { code: "not_found" } }, 404);
    } catch {
      return send({ error: { code: "validation_error", fields: {} } }, 400);
    }
  } else {
    response.statusCode = request.url === "/api/auth/me" ? 401 : 404;
    response.end(JSON.stringify({ error: { code: "ui_fixture_only" } }));
  }
});

server.listen(18781, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.close());
}
