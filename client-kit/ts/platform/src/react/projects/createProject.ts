// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/createProject.ts::createProject sequence.
// DD-80 substitutes the existing workspace.create action for createChannel;
// the two announcement writes retain native kinds and one durable intent each.
import { ChannelType, CreateActionKey, ProjectPublicationOperation, TaskStatus, WorkspaceVisibility, type ActionCommand, type ActionSubmission, type ProjectsPublishRequest, type AgentInstallationCandidate } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { newIdempotencyKey, taskPhase } from "../../governance";
import { BffError, TransportError } from "../../transport";
import { getEventHash } from "nostr-tools/pure";
import { buildProjectBootstrapTemplates, conflictingListedProject, projectDtagFromName, type ProjectListingVisibility } from "./projectCreation";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import { installProjectAgent, validProjectAgent, ProjectAgentFailed, ProjectAgentPending, type ProjectAgentIntent } from "./projectAgent";

export type CreateProjectInput = {
  name: string;
  description?: string;
  channelVisibility: WorkspaceVisibility;
  projectVisibility: ProjectListingVisibility;
  agent?: AgentInstallationCandidate;
};
type PublicationIntent = { key: string; attempted?: boolean; eventId?: string; acceptedEventId?: string };
export type ProjectCreationIntent = {
  input: CreateProjectInput;
  owner: string;
  channel: ActionCommand;
  channelAttempted?: boolean;
  submission?: ActionSubmission;
  workspaceId?: string;
  project: PublicationIntent;
  repository: PublicationIntent;
  agent?: ProjectAgentIntent;
};

export class ProjectCreationPending extends Error {}
export class ProjectCreationRejected extends Error {}

function definitelyNotSent(error: unknown): boolean {
  return error instanceof Error && error.name === "RelayPublishNotSentError"
    || error instanceof BffError && error.errorClass !== undefined && error.errorClass !== "UNKNOWN";
}

export async function prepareProjectCreation(host: ProjectsHost, input: CreateProjectInput): Promise<ProjectCreationIntent> {
  const name = input.name.trim();
  const dtag = projectDtagFromName(name);
  if (!name || !dtag || !Object.values(WorkspaceVisibility).includes(input.channelVisibility)
    || !["listed", "unlisted"].includes(input.projectVisibility)
    || input.agent !== undefined && !validProjectAgent(input.agent)) throw new Error("Invalid project input");
  const directory = await loadProjectDirectory(host, new AbortController().signal);
  if (directory.projects.some(project => project.owner === directory.viewerPubkey && project.dtag === dtag)
    || conflictingListedProject(directory.projects, { dtag, name, ownerPubkey: directory.viewerPubkey }))
    throw new Error("Project already exists");
  const key = newIdempotencyKey();
  const normalized = { ...input, name, description: input.description?.trim() || undefined };
  // Run the original envelope validation before creating the home channel.
  buildProjectBootstrapTemplates({ ...normalized, ownerPubkey: directory.viewerPubkey, projectChannelId: key });
  return {
    input: normalized, owner: directory.viewerPubkey,
    channel: { actionKey: CreateActionKey.WorkspaceCreate, idempotencyKey: key, slug: key, name,
      workspaceVisibility: input.channelVisibility,
      workspaceChannel: { channelType: ChannelType.Stream, ...(normalized.description ? { description: normalized.description } : {}) } },
    project: { key: newIdempotencyKey() }, repository: { key: newIdempotencyKey() },
    ...(input.agent ? { agent: { key: newIdempotencyKey() } } : {}),
  };
}

/** Caller persists before any side effect. Pending/rejected receipts never mean complete. */
export async function resumeProjectCreation(
  client: Pick<BffClient, "submitAction" | "task" | "workspaces" | "agentInstallationCandidates" | "agentInstallation">,
  host: ProjectsHost,
  intent: ProjectCreationIntent,
  save: (intent: ProjectCreationIntent) => void,
) {
  if (!host.publish) throw new TransportError("Project publication unavailable");
  let directory: Awaited<ReturnType<typeof loadProjectDirectory>>;
  try { directory = await loadProjectDirectory(host, new AbortController().signal); }
  catch (error) {
    if (intent.channelAttempted || intent.submission) throw new ProjectCreationPending("Original creation awaits authorized observation");
    throw error;
  }
  if (directory.viewerPubkey !== intent.owner) throw new TransportError("Project identity changed");
  if (!intent.submission) {
    const previouslyAttempted = intent.channelAttempted === true;
    intent.channelAttempted = true;
    save(intent);
    let submission: ActionSubmission;
    try { submission = await client.submitAction(intent.channel); }
    catch (error) {
      if (!previouslyAttempted && definitelyNotSent(error)) { intent.channelAttempted = false; save(intent); }
      else if (previouslyAttempted) throw new ProjectCreationPending("Original channel request remains unconfirmed");
      throw error;
    }
    if (submission.actionKey !== CreateActionKey.WorkspaceCreate || !submission.actionExecutionId || !submission.operationId)
      throw new TransportError("Project channel outcome unknown");
    intent.submission = submission;
    save(intent);
  }
  const task = await client.task(intent.submission.actionExecutionId);
  if (task.actionExecutionId !== intent.submission.actionExecutionId || task.operationId !== intent.submission.operationId
    || task.actionKey !== CreateActionKey.WorkspaceCreate) throw new TransportError("Project channel receipt mismatch");
  if (taskPhase(task).tone === "negative") throw new ProjectCreationRejected("Project channel creation rejected");
  if (taskPhase(task).tone !== "positive" || task.taskStatus !== TaskStatus.Completed)
    throw new ProjectCreationPending("Project channel has not completed");
  if (intent.workspaceId && intent.workspaceId !== task.targetId) throw new TransportError("Project channel changed");
  intent.workspaceId = task.targetId;
  save(intent);
  const assertMembership = async () => {
    const channels = await client.workspaces();
    if (!channels.some(channel => channel.id === intent.workspaceId && channel.slug === intent.channel.slug && channel.isMember === true))
      throw new ProjectCreationPending("Project channel is not currently accessible");
  };

  const publish = async (step: PublicationIntent, operation: ProjectPublicationOperation) => {
    if (step.acceptedEventId) return;
    await assertMembership();
    const observeOnly = step.attempted === true;
    step.attempted = true;
    save(intent);
    const request: ProjectsPublishRequest = { operation, workspaceId: intent.workspaceId, name: intent.input.name,
      ...(intent.input.description ? { description: intent.input.description } : {}),
      ...(operation === ProjectPublicationOperation.CreateProject ? { visibility: intent.input.projectVisibility as ProjectsPublishRequest["visibility"] } : {}) };
    let receipt: { eventId: string };
    try { receipt = await host.publish!(request, step.key, observeOnly, { eventId: step.eventId, onPrepared: eventId => {
      if (!/^[0-9a-f]{64}$/.test(eventId) || step.eventId && step.eventId !== eventId)
        throw new TransportError("Project event unavailable");
      step.eventId = eventId;
      save(intent);
    } }); } catch (error) {
      if (!observeOnly && !step.eventId && definitelyNotSent(error)) { step.attempted = false; save(intent); }
      else if (observeOnly || step.eventId) throw new ProjectCreationPending("Original publication remains unconfirmed");
      throw error;
    }
    if (!/^[0-9a-f]{64}$/.test(receipt?.eventId ?? "") || step.eventId && step.eventId !== receipt.eventId)
      throw new TransportError("Project publication outcome unknown");
    step.acceptedEventId = receipt.eventId;
    save(intent);
  };
  await publish(intent.project, ProjectPublicationOperation.CreateProject);
  await publish(intent.repository, ProjectPublicationOperation.CreateRepository);
  await assertMembership();
  let current: Awaited<ReturnType<typeof loadProjectDirectory>>;
  try { current = await loadProjectDirectory(host, new AbortController().signal); }
  catch { throw new ProjectCreationPending("Project publication is awaiting authorized confirmation"); }
  if (current.viewerPubkey !== intent.owner) throw new TransportError("Project identity changed");
  const project = current.projects.find(item => item.owner === intent.owner && item.dtag === projectDtagFromName(intent.input.name));
  const templates = buildProjectBootstrapTemplates({ ...intent.input, ownerPubkey: intent.owner, projectChannelId: intent.workspaceId });
  const matches = (event: (typeof current.projectEvents)[number], id: string | undefined, template: typeof templates.project) =>
    event.id === id && event.pubkey === intent.owner && event.kind === template.kind
    && event.content === template.content && JSON.stringify(event.tags) === JSON.stringify(template.tags)
    && getEventHash(event) === event.id;
  if (!project || !current.projectEvents.some(event => matches(event, intent.project.acceptedEventId, templates.project))
    || !current.repositoryEvents.some(event => matches(event, intent.repository.acceptedEventId, templates.repository))
    || project.projectChannelId !== intent.workspaceId
    || !project.repositories.some(repository => repository.repoAddress === templates.repositoryAddress))
    throw new ProjectCreationPending("Project publication is awaiting confirmation");
  host.completePublication?.(intent.project.key, intent.project.acceptedEventId!);
  host.completePublication?.(intent.repository.key, intent.repository.acceptedEventId!);
  if (intent.input.agent) {
    if (!intent.agent) throw new TransportError("Project Agent recovery intent unavailable");
    try { await installProjectAgent(client, intent.workspaceId, intent.input.agent, intent.agent, () => save(intent)); }
    catch (error) {
      if (error instanceof ProjectAgentFailed || error instanceof ProjectAgentPending) throw error;
      throw new ProjectAgentPending("Project created; original Agent installation awaits authorized confirmation");
    }
  }
  return project;
}
