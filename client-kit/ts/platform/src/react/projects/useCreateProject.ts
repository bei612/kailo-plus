import { useEffect, useMemo, useRef, useState } from "react";
import { CreateActionKey, WorkspaceVisibility } from "@client-kit/contracts";
import { TransportError } from "../../transport";
import { useBffClient, useUiT } from "../context";
import { prepareProjectCreation, resumeProjectCreation, ProjectCreationRejected, type CreateProjectInput, type ProjectCreationIntent } from "./createProject";
import type { ProjectsHost } from "./projectEnumeration";

/** Local recovery references are not authorization or a second project store. */
function readIntent(key: string): ProjectCreationIntent | null {
  const text = sessionStorage.getItem(key);
  if (text === null) return null;
  const value: ProjectCreationIntent = JSON.parse(text);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const eventId = /^[0-9a-f]{64}$/;
  if (!value || !value.input || typeof value.input.name !== "string" || !value.input.name.trim()
    || (value.input.description !== undefined && typeof value.input.description !== "string")
    || !Object.values(WorkspaceVisibility).includes(value.input.channelVisibility)
    || !["listed", "unlisted"].includes(value.input.projectVisibility)
    || !eventId.test(value.owner) || value.channel?.actionKey !== CreateActionKey.WorkspaceCreate
    || !uuid.test(value.channel.idempotencyKey) || value.channel.slug !== value.channel.idempotencyKey
    || value.channel.name !== value.input.name || value.channel.workspaceVisibility !== value.input.channelVisibility
    || value.channel.workspaceChannel?.channelType !== "stream"
    || value.channel.workspaceChannel.description !== value.input.description
    || (value.channelAttempted !== undefined && typeof value.channelAttempted !== "boolean")
    || (value.workspaceId !== undefined && !uuid.test(value.workspaceId))
    || (value.submission !== undefined && (value.submission.actionKey !== CreateActionKey.WorkspaceCreate
      || !uuid.test(value.submission.actionExecutionId) || !uuid.test(value.submission.operationId)))
    || [value.project, value.repository].some(step => !step || !uuid.test(step.key)
      || step.attempted !== undefined && typeof step.attempted !== "boolean"
      || step.eventId !== undefined && !eventId.test(step.eventId)
      || step.acceptedEventId !== undefined && !eventId.test(step.acceptedEventId)
      || step.eventId !== undefined && step.acceptedEventId !== undefined && step.eventId !== step.acceptedEventId))
    throw new TransportError("Project recovery intent unavailable");
  return value;
}

export function useCreateProject(host: ProjectsHost) {
  const client = useBffClient();
  const t = useUiT();
  const storageKey = JSON.stringify(["project-create-intent", host.scopeKey]);
  const lifetime = useMemo(() => ({ active: true }), [client, host.scopeKey]);
  useEffect(() => { lifetime.active = true; return () => { lifetime.active = false; }; }, [lifetime]);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<ProjectCreationIntent | null>(() => {
    try { return readIntent(storageKey); } catch { return null; }
  });
  const check = () => { if (!lifetime.active) throw new TransportError("Project scope changed"); };
  const save = (next: ProjectCreationIntent) => {
    check();
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    setIntent({ ...next });
  };
  const create = async (input: CreateProjectInput) => {
    if (busyRef.current) throw new TransportError(t("platform.loading"));
    check(); busyRef.current = true; setBusy(true);
    try {
      const scopedHost: ProjectsHost = { ...host,
        query: async request => { check(); const value = await host.query(request); check(); return value; },
        publish: host.publish ? async (...args) => { check(); const value = await host.publish!(...args); check(); return value; } : undefined,
        completePublication: (...args) => { check(); host.completePublication?.(...args); },
      };
      const current = readIntent(storageKey) ?? await prepareProjectCreation(scopedHost, input);
      save(current);
      const scopedClient = {
        submitAction: async (...args: Parameters<typeof client.submitAction>) => { check(); const value = await client.submitAction(...args); check(); return value; },
        task: async (...args: Parameters<typeof client.task>) => { check(); const value = await client.task(...args); check(); return value; },
        workspaces: async () => { check(); const value = await client.workspaces(); check(); return value; },
      };
      let project;
      try { project = await resumeProjectCreation(scopedClient, scopedHost, current, save); }
      catch (error) {
        if (lifetime.active && (error instanceof ProjectCreationRejected || !current.submission && current.channelAttempted === false)) {
          sessionStorage.removeItem(storageKey); setIntent(null);
        }
        throw error;
      }
      check();
      sessionStorage.removeItem(storageKey);
      setIntent(null);
      return project;
    } finally {
      busyRef.current = false;
      if (lifetime.active) setBusy(false);
    }
  };
  return { busy, intent, create };
}
