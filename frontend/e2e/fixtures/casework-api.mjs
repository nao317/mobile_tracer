// Browser-only lifecycle contracts. Real authorization, locking and transitions
// are tested against PostgreSQL in casework_integration_test.go.
export function createCaseworkFixture(snapshot, baseSession) {
  const customerID = "10000000-0000-4000-8000-000000000001";
  const businessID = baseSession.user.id;
  const cases = new Map();
  const session = (role) => ({
    ...baseSession,
    user: {
      ...baseSession.user,
      id: role === "customer" ? customerID : businessID,
      email:
        role === "customer"
          ? "customer@casework.example"
          : "business@casework.example",
      account_type: role === "customer" ? "general" : "business",
    },
    selected_staff_id:
      role === "customer" ? null : baseSession.selected_staff_id,
  });
  return {
    session,
    reset() {
      cases.clear();
    },
    async handle(request, url, send, role) {
      if (!url.pathname.startsWith("/api/casework")) return false;
      const parts = url.pathname.split("/").filter(Boolean);
      const actor = session(role).user.id;
      const document = (doc) => ({
        ...doc,
        can_manage: role === "business",
        api_configured: false,
      });
      if (request.method === "GET") {
        if (parts.length === 2) {
          send({
            data: [...cases.values()].map((d) => ({
              ...d.case,
              has_start: true,
            })),
            pagination: { page: 1, page_size: 20, total: cases.size },
            api_configured: false,
          });
          return true;
        }
        if (parts[2] === "starts") {
          send({
            data: [...cases.values()].map((d) => ({
              request: d.start,
              terms: d.terms,
            })),
          });
          return true;
        }
        const d = cases.get(parts[2]);
        if (!d) {
          send({ error: { message: "対象が見つかりません。" } }, 404);
          return true;
        }
        send({ data: document(d) });
        return true;
      }
      if (request.headers["x-csrf-token"] !== baseSession.csrf_token) {
        send({ error: { message: "CSRF検証に失敗しました。" } }, 403);
        return true;
      }
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || "{}");
      const stamp = new Date().toISOString();
      if (parts[2] === "starts" && parts.length === 3) {
        const id = crypto.randomUUID();
        const item = {
          ...snapshot.cases[0],
          id,
          store_id: body.store_id,
          vehicle_id: body.vehicle_id,
          case_type: body.case_type,
          configuration_version_id: body.configuration_version_id,
          assignee_id: body.assignee_id,
          created_by: businessID,
          status: "awaiting_customer",
          created_at: stamp,
        };
        snapshot.cases.push(item);
        const vehicle =
          snapshot.vehicles.find((v) => v.id === body.vehicle_id) ??
          snapshot.vehicles[0];
        const start = {
          id: crypto.randomUUID(),
          case_id: id,
          version_no: 1,
          customer_id: customerID,
          actor_id: businessID,
          terms_hash: "a".repeat(64),
          deadline: body.deadline,
          created_at: stamp,
          decision: null,
          responded_at: null,
        };
        const terms = {
          schema: "mobile-tracer/case-start/v1",
          case: item,
          vehicle,
          terms: body.terms,
          customer_id: customerID,
          actor_id: businessID,
          deadline: body.deadline,
        };
        cases.set(id, {
          case: item,
          vehicle,
          start,
          terms,
          events: [],
          registrations: [],
        });
        send({ data: start }, 201);
        return true;
      }
      if (parts[2] === "starts" && parts[4] === "respond") {
        const d = [...cases.values()].find((d) => d.start.id === parts[3]);
        d.start.decision = body.decision;
        d.start.responded_at = stamp;
        if (body.decision === "approved") d.case.status = "in_progress";
        send({ data: "saved" });
        return true;
      }
      const d = cases.get(parts[2]);
      if (!d) {
        send({ error: { message: "対象が見つかりません。" } }, 404);
        return true;
      }
      if (parts[3] === "events" && parts.length === 4) {
        const event = {
          ...body,
          id: crypto.randomUUID(),
          case_id: d.case.id,
          actor_id: actor,
          origin: role === "business" ? "business" : "customer",
          created_at: stamp,
        };
        d.events.push({
          event,
          state: "pending",
          actions: [],
          superseded: false,
        });
        send({ data: event }, 201);
        return true;
      }
      if (parts[3] === "events" && parts[5] === "actions") {
        const row = d.events.find((e) => e.event.id === parts[4]);
        row.actions.push({
          id: crypto.randomUUID(),
          event_id: row.event.id,
          actor_id: actor,
          action: body.action,
          detail: body.detail,
          sequence: row.actions.length + 1,
          created_at: stamp,
        });
        row.state =
          body.action === "executed"
            ? "in_progress"
            : body.action === "reported"
              ? "awaiting_completion"
              : body.action === "approved" &&
                  row.event.kind === "progress_report"
                ? "completed"
                : body.action;
        if (body.action === "executed" && row.event.target_stage)
          d.case.stage = row.event.target_stage;
        send({ data: "saved" });
        return true;
      }
      send({ error: { message: "対象が見つかりません。" } }, 404);
      return true;
    },
  };
}
