import type { ReactNode } from "react";
import { Form, Link, useNavigation } from "react-router";
import { AuthenticatedLayout } from "../../components/templates/authenticated-layout";
import {
  Button,
  Field,
  Select,
  Textarea,
} from "../../components/ui/primitives";
import type { SessionView } from "../../lib/auth.server";
import uiStyles from "../../components/ui/ui.module.css";
export function CaseworkLayout({
  session,
  caseID,
  title,
  children,
}: {
  session: SessionView;
  caseID?: string;
  title: string;
  children: ReactNode;
}) {
  const base = caseID ? `/casework/${caseID}` : "/casework";
  return (
    <AuthenticatedLayout
      session={session}
      title={title}
      groups={[
        {
          id: "cases",
          label: "案件",
          items: [
            { id: "list", label: "案件一覧", to: "/casework" },
            { id: "inbox", label: "開始条件の受信履歴", to: "/casework/inbox" },
            ...(session.user.account_type === "business"
              ? [{ id: "new", label: "案件開始の提案", to: "/casework/new" }]
              : []),
            { id: "records", label: "車両の記録・写真", to: "/transactions" },
            { id: "account", label: "アカウント", to: "/account" },
          ],
        },
        ...(caseID
          ? [
              {
                id: "case",
                label: "この案件",
                items: [
                  { id: "start", label: "開始条件・承認", to: base + "/start" },
                  {
                    id: "timeline",
                    label: "進行・対応履歴",
                    to: base + "/timeline",
                  },
                  {
                    id: "verification",
                    label: "登録・検証",
                    to: base + "/verification",
                  },
                ],
              },
            ]
          : []),
      ]}
    >
      <div className={uiStyles["ui-stack"]}>{children}</div>
    </AuthenticatedLayout>
  );
}
export function CaseworkForm({
  intent,
  csrf,
  requestKey,
  label,
  children,
}: {
  intent: string;
  csrf: string;
  requestKey: string;
  label: string;
  children: ReactNode;
}) {
  const busy = useNavigation().state !== "idle";
  return (
    <Form
      method="post"
      className={uiStyles["ui-form"]}
      onSubmit={(event) => {
        const input =
          event.currentTarget.elements.namedItem("_timezone_offset");
        if (input instanceof HTMLInputElement)
          input.value = String(new Date().getTimezoneOffset());
      }}
    >
      <input type="hidden" name="_timezone_offset" defaultValue="0" />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="_csrf" value={csrf} />
      <input type="hidden" name="request_key" value={requestKey} />
      <fieldset
        disabled={busy}
        className={uiStyles["ui-stack"]}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        {children}
        <Button type="submit">{busy ? "処理中…" : label}</Button>
      </fieldset>
    </Form>
  );
}
export function ReviewFields({
  allowReturn = false,
  prefix = "review",
}: {
  allowReturn?: boolean;
  prefix?: string;
}) {
  return (
    <>
      <Field id={`${prefix}-decision`} label="回答">
        <Select id={`${prefix}-decision`} name="decision">
          <option value="approved">承認・受理する</option>
          <option value="rejected">拒否する</option>
          <option value="held">保留する</option>
          {allowReturn && <option value="returned">差し戻す</option>}
        </Select>
      </Field>
      <Field id={`${prefix}-detail`} label="回答理由・補足（差戻し時は必須）">
        <Textarea id={`${prefix}-detail`} name="detail" maxLength={8000} />
      </Field>
      <label>
        <input type="checkbox" name="confirmed" value="1" required />
        対象の内容と条件を確認しました
      </label>
    </>
  );
}
export function CaseworkBack({ caseID }: { caseID: string }) {
  return <Link to={`/casework/${caseID}/timeline`}>進行・対応履歴へ戻る</Link>;
}
