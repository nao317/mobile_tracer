// UI-only fixture. Authorization, transactions and concurrency are covered with
// the real PostgreSQL API in management_integration_test.go.
export function createManagementFixture() {
  const stamp = new Date().toISOString();
  const users = ["general", "admin"].map((role, i) => ({
    id: `10000000-0000-4000-8000-00000000000${i + 1}`,
    email: `${role}@management.example.com`,
    email_verified: true,
    display_name: role === "admin" ? "システム管理者" : "一般利用者",
    account_type: "general",
    status: "active",
    version: 0,
    created_at: stamp,
  }));
  const requests = [],
    companies = [];
  const initialGeneral = structuredClone(users[0]);
  const owned = new Map();
  const session = (role) => ({
    user: users[role === "admin" ? 1 : 0],
    memberships: [],
    selected_staff_id: null,
    system_admin: role === "admin",
    csrf_token: "fixture-csrf",
  });
  const page = (rows) => ({
    data: rows,
    pagination: { page: 1, page_size: 20, total: rows.length },
  });
  return {
    resetGeneral() {
      users[0] = structuredClone(initialGeneral);
      for (let i = requests.length - 1; i >= 0; i--)
        if (requests[i].requester_id === users[0].id) requests.splice(i, 1);
      for (let i = companies.length - 1; i >= 0; i--)
        if (owned.get(companies[i].id) === users[0].id) {
          owned.delete(companies[i].id);
          companies.splice(i, 1);
        }
    },
    session,
    async handle(request, url, send, role) {
      if (
        !url.pathname.startsWith("/api/me/") &&
        !url.pathname.startsWith("/api/admin/")
      )
        return false;
      const actor = session(role),
        path = url.pathname;
      if (path.startsWith("/api/admin/") && !actor.system_admin) {
        send(
          { error: { code: "forbidden", message: "権限がありません。" } },
          403,
        );
        return true;
      }
      const sendRows = (rows) => {
        const q = url.searchParams.get("q");
        rows = rows.filter((row) => !q || JSON.stringify(row).includes(q));
        for (const key of ["status", "kind", "account_type"])
          if (url.searchParams.get(key))
            rows = rows.filter((row) => row[key] === url.searchParams.get(key));
        send(page(rows));
      };
      if (request.method === "GET") {
        if (path === "/api/admin/overview")
          send({
            data: {
              users: users.length,
              business_users: users.filter((u) => u.account_type === "business")
                .length,
              companies: companies.length,
              pending_requests: requests.filter((r) => r.status === "pending")
                .length,
            },
          });
        else if (path === "/api/admin/users") sendRows(users);
        else if (path.startsWith("/api/admin/users/"))
          send({
            data: {
              user: users.find((u) => u.id === path.split("/")[4]),
              companies: [],
            },
          });
        else if (path === "/api/admin/companies") sendRows(companies);
        else if (path.startsWith("/api/admin/companies/"))
          send({
            data: {
              company: companies.find((c) => c.id === path.split("/")[4]),
              members: [],
            },
          });
        else if (path === "/api/admin/requests") sendRows(requests);
        else if (path === "/api/me/requests")
          sendRows(requests.filter((r) => r.requester_id === actor.user.id));
        else if (path === "/api/me/companies")
          send({
            data: companies.filter((c) => owned.get(c.id) === actor.user.id),
          });
        else send({ error: { code: "not_found" } }, 404);
        return true;
      }
      if (
        request.headers["x-csrf-token"] !== actor.csrf_token ||
        !request.headers.origin
      ) {
        send(
          {
            error: {
              code: "forbidden",
              message: "画面を再読み込みしてください。",
            },
          },
          403,
        );
        return true;
      }
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      if (path === "/api/me/requests") {
        const row = {
          ...body,
          id: crypto.randomUUID(),
          requester_id: actor.user.id,
          requester_email: actor.user.email,
          company_id: body.company_id ?? null,
          status: "pending",
          created_at: stamp,
          decided_by: null,
          decided_at: null,
          decision_reason: "",
        };
        requests.unshift(row);
        send({ data: row }, 201);
      } else if (path.endsWith("/decision")) {
        const row = requests.find((r) => r.id === path.split("/")[4]);
        if (body.decision === "approved") {
          if (row.kind === "business_upgrade")
            Object.assign(
              users.find((u) => u.id === row.requester_id),
              {
                account_type: "business",
                display_name: row.payload.display_name,
              },
            );
          if (row.kind === "company_create") {
            const company = {
              ...row.payload,
              id: crypto.randomUUID(),
              status: "active",
              created_at: stamp,
              version: 0,
            };
            companies.unshift(company);
            owned.set(company.id, row.requester_id);
            row.company_id = company.id;
          }
          if (row.kind === "company_profile_update") {
            const company = companies.find((c) => c.id === row.company_id);
            Object.assign(company, row.payload, {
              version: company.version + 1,
            });
          }
        }
        Object.assign(row, {
          status: body.decision,
          decided_by: actor.user.id,
          decider_email: actor.user.email,
          decided_at: stamp,
          decision_reason: body.reason,
        });
        send({ data: row });
      } else if (
        path.startsWith("/api/admin/users/") &&
        request.method === "PATCH"
      ) {
        const user = users.find((u) => u.id === path.split("/")[4]);
        Object.assign(user, body, { version: user.version + 1 });
        send({ data: user });
      } else
        send(
          {
            error: {
              code: "not_found",
              message: "この操作はUI用fixtureの対象外です。",
            },
          },
          404,
        );
      return true;
    },
  };
}
