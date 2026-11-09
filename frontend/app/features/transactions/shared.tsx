import type { ReactNode } from "react";
import { Form, useNavigation } from "react-router";
import { Button } from "../../components/ui/primitives";
import styles from "../../components/ui/ui.module.css";
export function TransactionForm({
  intent,
  csrf,
  children,
  multipart = false,
}: {
  intent: string;
  csrf: string;
  children: ReactNode;
  multipart?: boolean;
}) {
  const navigation = useNavigation();
  const actions: Record<string, string> = {
    photo: "写真を保存する",
    present: "この版を固定して顧客へ提示する",
    respond: "この内容で回答する",
    retry: "登録を再試行する",
    verify: "照合する",
    correct: "訂正版を作成する",
    ownership: "所有者変更を記録する",
    share: "履歴を共有する",
    accept: "共有を受け入れる",
    revoke: "共有を取り消す",
  };
  return (
    <Form
      method="post"
      encType={
        multipart ? "multipart/form-data" : "application/x-www-form-urlencoded"
      }
      className={styles["ui-form"]}
    >
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="_csrf" value={csrf} />
      <fieldset
        disabled={navigation.state !== "idle"}
        style={{ border: 0, padding: 0, margin: 0 }}
        className={styles["ui-stack"]}
      >
        {children}
        <Button type="submit">
          {navigation.state !== "idle"
            ? "処理中…"
            : (actions[intent] ?? "保存する")}
        </Button>
      </fieldset>
    </Form>
  );
}
