import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/casework-new";
import { requireSession, sessionHeaders, apiFetch } from "../lib/auth.server";
import { managementRead, validID } from "../features/management/api.server";
import {
  contextSchema,
  vehicleSchema,
  caseSchema,
  paginationSchema,
} from "../features/workspace/model";
import { caseworkSchema } from "../features/casework/model";
import { formDate, writeCasework } from "../features/casework/api.server";
import { CaseworkLayout } from "../features/casework/shared";
import { PageHeader } from "../components/ui/primitives";
export const headers = sessionHeaders;
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireSession(request);
  if (auth.session.user.account_type !== "business")
    throw new Response("業者の権限が必要です。", {
      status: 403,
      headers: auth.headers,
    });
  const search = new URL(request.url).searchParams;
  const context = await managementRead(
    request,
    auth,
    "/api/context",
    z.object({ data: contextSchema }),
  );
  const caseID = search.get("case");
  const existingCase = caseID
    ? (
        await managementRead(
          request,
          auth,
          `/api/cases/${validID(caseID)}`,
          z.object({ data: caseSchema }),
        )
      ).data
    : null;
  const existingResponse = caseID
    ? await apiFetch(request, `/api/casework/${validID(caseID)}`, auth.cookie)
    : null;
  if (
    existingResponse &&
    !existingResponse.ok &&
    existingResponse.status !== 404
  )
    throw new Response("案件条件を確認できません。", {
      status: existingResponse.status,
      headers: auth.headers,
    });
  const existing = existingResponse?.ok
    ? z.object({ data: caseworkSchema }).parse(await existingResponse.json())
        .data
    : null;
  const selectedID = existingCase?.vehicle_id || search.get("vehicle");
  const vehicles = selectedID
    ? {
        data: [
          (
            await managementRead(
              request,
              auth,
              `/api/vehicles/${validID(selectedID)}`,
              z.object({ data: vehicleSchema }),
            )
          ).data,
        ],
      }
    : await managementRead(
        request,
        auth,
        "/api/vehicles?page_size=100",
        z.object({
          data: z.array(vehicleSchema),
          pagination: paginationSchema,
        }),
      );
  return data(
    {
      context: context.data,
      vehicles: vehicles.data,
      existing:
        existing ??
        (existingCase
          ? { case: existingCase, vehicle: vehicles.data[0] }
          : null),
      session: auth.session,
      requestKey: crypto.randomUUID(),
    },
    { headers: auth.headers },
  );
}
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  return writeCasework(
    request,
    "/api/casework/starts",
    form,
    {
      case_id: form.get("case_id") ?? "",
      store_id: form.get("store_id"),
      vehicle_id: form.get("vehicle_id"),
      case_type: form.get("case_type"),
      configuration_version_id: form.get("configuration_version_id"),
      assignee_id: form.get("assignee_id") || null,
      email: form.get("email"),
      terms: form.get("terms"),
      deadline: formDate(form.get("deadline"), form.get("_timezone_offset")),
      request_key: form.get("request_key"),
    },
    (value) => {
      const result = z.object({ case_id: z.string() }).parse(value);
      return `/casework/${result.case_id}/start`;
    },
  );
}
import { CaseStartForm } from "../features/casework/start-create-page";
export default function CaseworkNew({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <CaseworkLayout session={loaderData.session} title="案件開始の提案">
      <PageHeader title="案件開始の提案" />
      <CaseStartForm
        context={loaderData.context}
        vehicles={loaderData.vehicles}
        existing={loaderData.existing}
        csrf={loaderData.session.csrf_token}
        requestKey={loaderData.requestKey}
        error={
          actionData && "error" in actionData ? actionData.error : undefined
        }
      />
    </CaseworkLayout>
  );
}
