import {
  createContext,
  use,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import type { CommandResult, Role, WorkspaceData } from "./model";
import { executePreview } from "./preview-commands";
import { createPreviewData } from "./preview-data";

type Environment = {
  mode: "live" | "preview";
  base: string;
  snapshot: WorkspaceData;
  csrf: string;
  email: string;
  previewAvailable: boolean;
  execute?: (form: FormData) => CommandResult;
  reset?: () => void;
  changeRole?: (role: Role) => void;
};
const WorkspaceContext = createContext<Environment | null>(null);
export function useWorkspace() {
  const value = use(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider is required");
  return value;
}
export function WorkspaceProvider({
  value,
  children,
}: {
  value: Environment;
  children: ReactNode;
}) {
  return <WorkspaceContext value={value}>{children}</WorkspaceContext>;
}
export function PreviewProvider({
  initial,
  children,
}: {
  initial: WorkspaceData;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const photoUrls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of photoUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const navigate = useNavigate();
  function execute(form: FormData) {
    const file = form.get("photo");
    if (
      form.get("intent") === "photo" &&
      file instanceof File &&
      file.size > 0 &&
      file.size <= 10 * 1024 * 1024 &&
      ["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ) {
      const url = URL.createObjectURL(file);
      photoUrls.current.push(url);
      form.set("photoSource", url);
    }
    const { snapshot: next, result } = executePreview(snapshot, form);
    if (!result.error) {
      setSnapshot(next);
      if (result.redirectTo) void navigate(`/preview/${result.redirectTo}`);
    }
    return result;
  }
  function changeRole(role: Role) {
    setSnapshot((previous) => ({
      ...previous,
      context: {
        ...previous.context,
        principal: {
          ...previous.context.principal,
          roles: [
            {
              role,
              store_id:
                role === "tenant_admin" || role === "auditor"
                  ? null
                  : (previous.context.stores[0]?.id ?? null),
            },
          ],
        },
      },
    }));
  }
  return (
    <WorkspaceProvider
      value={{
        mode: "preview",
        base: "/preview",
        snapshot,
        csrf: "",
        email: "サンプル担当者",
        previewAvailable: true,
        execute,
        reset: () => {
          for (const url of photoUrls.current) URL.revokeObjectURL(url);
          photoUrls.current = [];
          setSnapshot(createPreviewData());
        },
        changeRole,
      }}
    >
      {children}
    </WorkspaceProvider>
  );
}
