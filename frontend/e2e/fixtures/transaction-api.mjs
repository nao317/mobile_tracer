// Read-only contracts for browser rendering tests. Authorization and writes are
// covered against PostgreSQL in backend/internal/authn/workflow_*test.go.
export function transactionFixture(request, url, send, snapshot, session) {
  if (!url.pathname.startsWith("/api/transactions")) return false;
  const parts = url.pathname.split("/").filter(Boolean);
  if (request.method !== "GET") return false;
  if (parts[2] === "shares") {
    send({ data: [] });
    return true;
  }
  if (!parts[2]) {
    send({
      data: snapshot.versions.map((version) => {
        const item = snapshot.cases.find((c) => c.id === version.case_id);
        const vehicle = snapshot.vehicles.find((v) => v.id === item.vehicle_id);
        return {
          version_id: version.id,
          case_id: item.id,
          record_id: version.record_id,
          version_no: version.version_no,
          status: version.status,
          vehicle_id: vehicle.id,
          model_name: vehicle.model_name,
        };
      }),
      pagination: { page: 1, page_size: 20, total: snapshot.versions.length },
    });
    return true;
  }
  if (parts[3] === "ownerships") {
    send({ data: [] });
    return true;
  }
  const version = snapshot.versions.find((v) => v.id === parts[2]);
  if (!version) {
    send({ error: { code: "not_found" } }, 404);
    return true;
  }
  const item = snapshot.cases.find((c) => c.id === version.case_id);
  const vehicle = snapshot.vehicles.find((v) => v.id === item.vehicle_id);
  send({
    data: {
      content: {
        schema: "mobile-tracer/record/v1",
        version,
        case: item,
        vehicle,
        media: [],
      },
      requests:
        version.status === "submitted"
          ? [
              {
                id: version.id,
                version_id: version.id,
                user_id: session.user.id,
                qualification: "owner",
                kind: "state_agreement",
                statement: "提示された車両状態への同意",
                deadline: "2030-11-09T10:00:00Z",
                decision: null,
                responded_at: null,
              },
            ]
          : [],
      can_manage: true,
      anchor: null,
    },
  });
  return true;
}
