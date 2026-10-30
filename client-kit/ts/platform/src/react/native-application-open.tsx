// DD-164(10) (design 07 §4.6 entry topology): a top-level visit to a component origin is
// answered by the Kailo gateway with `/app/applications/open?origin=&path=`. Kailo finds the
// native page this user may open from that origin and opens it in the content area at the
// same path; when there is none it shows a definite Kailo state instead of going back.
import { useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { useBffClient, useT } from "./context";
import { exactOrigin, resolveNativeOrigin } from "./native-application-entries";
import { validComponentPath } from "./native-deep-link";
import { Button, Notice } from "./ui";

export function NativeApplicationOpen({ origin, path, onResolved, onHome }: {
  origin: string | undefined;
  path: string | undefined;
  onResolved: (bindingId: string, workspaceId: string | undefined, path: string | undefined) => void;
  onHome: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    const target = exactOrigin(origin);
    if (!target) { setMissing(true); return; }
    resolveNativeOrigin(client, target).then((found) => {
      if (cancelled) return;
      if (found) onResolved(found.bindingId, found.workspaceId, validComponentPath(path) ? path : undefined);
      else setMissing(true);
    }, () => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [client, origin, path, onResolved]);
  return missing
    ? <Notice role="alert" icon={Compass}><span>{t("nativeOpen.notFound")}</span><Button onClick={onHome}>{t("nativeOpen.home")}</Button></Notice>
    : <Notice role="status">{t("nativeOpen.loading")}</Notice>;
}
