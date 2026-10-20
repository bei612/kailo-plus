// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/useAddProjectRepository.ts::addProjectRepository,
// useAttachProjectRepository.ts::attachProjectRepository,
// useBindProjectRepositoryChannel.ts::bindProjectRepositoryChannel and the link step of
// useAddProjectChannel.ts::addProjectChannel. Each write is the signer's own announcement through the
// existing Projects publication host (REQ-24, DD-80, DD-118): Web asks Core to patch the verified
// current head, Desktop CLIENT signs the same original template. The original owner-agent branch
// (publishOwnedAgentProjectAnnouncements) has no Kailo signer: Agents never sign for a Human.
// A publication that may have been sent keeps its frozen request and Idempotency-Key until the
// accepted event is read back; it is never resent under a new key or as a different request.
import { ProjectPublicationOperation, type ProjectsPublishRequest } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import type { PlatformMessageKey } from "../../i18n";
import { BffError, isOutcomeUnknown, TransportError, writeFailure, type WriteFailure } from "../../transport";
import type { Translate } from "../context";
import type { PulseEvent } from "../pulse/host";
import { KIND_PROJECT_ANNOUNCEMENT, KIND_REPO_ANNOUNCEMENT } from "./kinds";
import { buildProjectRelatedChannelPatchTemplate } from "./projectChannelCreation";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import type { Project, Repository } from "./projectModels";
import {
  buildAddedRepositoryEventTemplatesFromHead,
  buildProjectPatchTemplate,
  buildRepositoryChannelBindingTemplate,
  repositoryDtagFromName,
} from "./projectRepositoryCreation";
import { homeRepositoriesToBind } from "./lib/projectCollection";

/** A publication of this change may have been sent and is not yet read back. */
export class ProjectManagementPending extends Error {}

/** A definite refusal before anything was sent; `key` names the original message in the catalog. */
export class ProjectManagementError extends Error {
  readonly key: PlatformMessageKey;
  readonly variables?: Record<string, string>;
  constructor(key: PlatformMessageKey, variables?: Record<string, string>) {
    super(key);
    this.name = "ProjectManagementError";
    this.key = key;
    this.variables = variables;
  }
}

type ProjectDirectory = Awaited<ReturnType<typeof loadProjectDirectory>>;

/** One frozen announcement publication and the exact event it must read back as. */
type PublicationStep = {
  key: string;
  request: ProjectsPublishRequest;
  kind: number;
  content: string;
  tags: string[][];
  attempted?: boolean;
  eventId?: string;
  acceptedEventId?: string;
};
type ManagementIntent = { steps: PublicationStep[] };

const EVENT_ID = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function recovery<T>(action: () => T): T {
  try { return action(); } catch { throw new ProjectManagementPending("Project change awaits confirmation"); }
}

function definitelyNotSent(error: unknown): boolean {
  return error instanceof Error && error.name === "RelayPublishNotSentError"
    || error instanceof BffError && error.errorClass !== undefined && error.errorClass !== "UNKNOWN";
}

function validStep(value: unknown): value is PublicationStep {
  const step = value as PublicationStep | null;
  return Boolean(step && typeof step === "object" && typeof step.key === "string" && UUID.test(step.key)
    && step.request && typeof step.request === "object" && typeof step.request.operation === "string"
    && (step.kind === KIND_PROJECT_ANNOUNCEMENT || step.kind === KIND_REPO_ANNOUNCEMENT)
    && typeof step.content === "string" && Array.isArray(step.tags)
    && step.tags.every(tag => Array.isArray(tag) && tag.every(part => typeof part === "string"))
    && (step.attempted === undefined || typeof step.attempted === "boolean")
    && (step.eventId === undefined || EVENT_ID.test(step.eventId))
    && (step.acceptedEventId === undefined || EVENT_ID.test(step.acceptedEventId))
    && !(step.eventId && step.acceptedEventId && step.eventId !== step.acceptedEventId));
}

/** Local recovery references only: never authorization or a second announcement store. */
function readIntent(slot: string): ManagementIntent | null {
  const text = recovery(() => sessionStorage.getItem(slot));
  if (text === null) return null;
  const value = recovery(() => JSON.parse(text) as ManagementIntent);
  if (!value || !Array.isArray(value.steps) || value.steps.length === 0 || !value.steps.every(validStep))
    throw new ProjectManagementPending("Project change recovery intent unavailable");
  return value;
}

function saveIntent(slot: string, intent: ManagementIntent) {
  recovery(() => sessionStorage.setItem(slot, JSON.stringify(intent)));
}

function dtagOf(event: PulseEvent) {
  return event.tags.find(tag => tag[0] === "d")?.[1];
}

/** The same winning replaceable event as projectModels: newest, then lowest event ID. */
export function currentAnnouncementHead(events: readonly PulseEvent[], kind: number, owner: string, dtag: string) {
  return events.filter(event => event.kind === kind && event.pubkey === owner.toLowerCase() && dtagOf(event) === dtag)
    .sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))[0];
}

function memberAddresses(head: PulseEvent) {
  return head.tags.filter(tag => tag[0] === "a" && tag[1]).map(tag => tag[1] as string);
}

async function publishStep(host: ProjectsHost, slot: string, intent: ManagementIntent, step: PublicationStep) {
  if (!host.publish) throw new TransportError("Project publication unavailable");
  if (step.acceptedEventId) return;
  const observeOnly = step.attempted === true;
  step.attempted = true;
  saveIntent(slot, intent);
  let receipt: { eventId: string };
  try {
    receipt = await host.publish(step.request, step.key, observeOnly, { eventId: step.eventId, onPrepared: eventId => {
      if (!EVENT_ID.test(eventId) || step.eventId && step.eventId !== eventId) throw new TransportError("Project event unavailable");
      step.eventId = eventId;
      saveIntent(slot, intent);
    } });
  } catch (error) {
    if (!observeOnly && !step.eventId && definitelyNotSent(error)) {
      step.attempted = false;
      if (intent.steps.every(candidate => !candidate.attempted && !candidate.acceptedEventId)) recovery(() => sessionStorage.removeItem(slot));
      else saveIntent(slot, intent);
      throw error;
    }
    throw new ProjectManagementPending("Project change awaits confirmation");
  }
  if (!EVENT_ID.test(receipt?.eventId ?? "") || step.eventId && step.eventId !== receipt.eventId)
    throw new ProjectManagementPending("Project change awaits confirmation");
  step.acceptedEventId = receipt.eventId;
  saveIntent(slot, intent);
}

/** Read the accepted events back as the exact original templates, then release the intent. */
async function confirmIntent(host: ProjectsHost, slot: string, intent: ManagementIntent, signal: AbortSignal,
  settled: (directory: ProjectDirectory) => boolean) {
  let directory: ProjectDirectory;
  try { directory = await loadProjectDirectory(host, signal); }
  catch { throw new ProjectManagementPending("Project change awaits authorized confirmation"); }
  const events = [...directory.projectEvents, ...directory.repositoryEvents];
  const confirmed = intent.steps.every(step => events.some(event => event.id === step.acceptedEventId
    && event.kind === step.kind && event.pubkey === directory.viewerPubkey && event.content === step.content
    && JSON.stringify(event.tags) === JSON.stringify(step.tags)));
  if (!confirmed || !settled(directory)) throw new ProjectManagementPending("Project change awaits confirmation");
  for (const step of intent.steps) host.completePublication?.(step.key, step.acceptedEventId!);
  recovery(() => sessionStorage.removeItem(slot));
  return directory;
}

async function runIntent(host: ProjectsHost, slot: string, prepare: () => Promise<ManagementIntent | null>, signal: AbortSignal,
  settled: (directory: ProjectDirectory) => boolean, sameChange: (intent: ManagementIntent) => boolean = () => true) {
  let intent = readIntent(slot);
  // An unconfirmed earlier change of this target is re-checked as it was sent, never replaced.
  if (intent && !sameChange(intent)) throw new ProjectManagementPending("Another change awaits confirmation");
  if (!intent) {
    intent = await prepare();
    signal.throwIfAborted();
    if (!intent) return null;
    saveIntent(slot, intent);
  }
  for (const step of intent.steps) {
    signal.throwIfAborted();
    await publishStep(host, slot, intent, step);
  }
  return confirmIntent(host, slot, intent, signal, settled);
}

function stepFor(request: ProjectsPublishRequest, template: { kind: number; content: string; tags: string[][] }): PublicationStep {
  return { key: newIdempotencyKey(), request, kind: template.kind, content: template.content, tags: template.tags.map(tag => [...tag]) };
}

function ownedProject(directory: ProjectDirectory, project: Pick<Project, "owner">) {
  if (project.owner.toLowerCase() !== directory.viewerPubkey) throw new ProjectManagementError("projects.manage.notOwnerRepositories");
}

function liveProjectHead(directory: ProjectDirectory, project: Pick<Project, "owner" | "dtag">) {
  const head = currentAnnouncementHead(directory.projectEvents, KIND_PROJECT_ANNOUNCEMENT, project.owner, project.dtag);
  if (!head) throw new ProjectManagementError("projects.manage.projectMissing");
  return head;
}

function projectIn(directory: ProjectDirectory, project: Pick<Project, "projectAddress">) {
  return directory.projects.find(candidate => candidate.projectAddress === project.projectAddress);
}

/** Original useAttachProjectRepository: add an existing repository to the owner's live project head. */
export async function attachProjectRepository(host: ProjectsHost, project: Project, repository: Pick<Repository, "repoAddress">, signal: AbortSignal) {
  const slot = JSON.stringify(["project-repository-attach", host.scopeKey, project.projectAddress, repository.repoAddress]);
  return runIntent(host, slot, async () => {
    const directory = await loadProjectDirectory(host, signal);
    ownedProject(directory, project);
    const liveHead = liveProjectHead(directory, project);
    // Dominated-write guard.
    if (liveHead.created_at > project.createdAt)
      throw new ProjectManagementError("projects.manage.projectChanged");
    const liveAddresses = memberAddresses(liveHead);
    if (liveAddresses.includes(repository.repoAddress)) throw new ProjectManagementError("projects.manage.alreadyAttached");
    const template = buildProjectPatchTemplate({ liveHead, ownerPubkey: project.owner.toLowerCase(),
      repositoryAddresses: [...liveAddresses, repository.repoAddress] });
    return { steps: [stepFor({ operation: ProjectPublicationOperation.AttachRepository, targetEventId: liveHead.id,
      repositoryAddress: repository.repoAddress }, template)] };
  }, signal, directory => Boolean(projectIn(directory, project)?.repositoryAddresses.includes(repository.repoAddress)));
}

/** An admitted member stream: the Workspace the request names and the Channel the tag carries (DD-80). */
export type ProjectChannelRef = { workspaceId: string; channelId: string };

export type AddProjectRepositoryInput = {
  /** The admitted Workspace whose Channel grants repository access. */
  access: ProjectChannelRef;
  cloneUrl?: string;
  name: string;
  project: Project;
};

/**
 * Original useAddProjectRepository: the live project head gains the new coordinate first (so an older
 * relay cannot leave a standalone repository behind), then the repository announcement follows. A
 * dangling member from an earlier partial publish resumes with only the repository event.
 */
export async function addProjectRepository(host: ProjectsHost, { access, cloneUrl, name, project }: AddProjectRepositoryInput, signal: AbortSignal) {
  const normalizedName = name.trim();
  const repositoryDtag = repositoryDtagFromName(normalizedName);
  if (!normalizedName) throw new ProjectManagementError("projects.manage.nameRequired");
  if (!repositoryDtag) throw new ProjectManagementError("projects.manage.nameInvalid");
  // Contract cloneUrl: an https announcement tag only, never fetched by Kailo (DD-118).
  if (cloneUrl?.trim() && !/^https:\/\/\S+$/.test(cloneUrl.trim())) throw new ProjectManagementError("projects.manage.cloneUrlInvalid");
  const repositoryAddress = `${KIND_REPO_ANNOUNCEMENT}:${project.owner.toLowerCase()}:${repositoryDtag}`;
  const slot = JSON.stringify(["project-repository-add", host.scopeKey, project.projectAddress, repositoryAddress]);
  return runIntent(host, slot, async () => {
    const directory = await loadProjectDirectory(host, signal);
    ownedProject(directory, project);
    const liveHead = liveProjectHead(directory, project);
    const repositoryHeadExists = Boolean(currentAnnouncementHead(directory.repositoryEvents, KIND_REPO_ANNOUNCEMENT, project.owner, repositoryDtag));
    const normalizedCloneUrl = cloneUrl?.trim() || undefined;
    const templates = buildAddedRepositoryEventTemplatesFromHead({ accessChannelId: access.channelId, cloneUrl: normalizedCloneUrl,
      existingRepositoryAddresses: project.repositoryAddresses, liveHead, name: normalizedName,
      ownerPubkey: project.owner.toLowerCase(), repositoryHeadExists });
    // Cross-project d-tag clobber guard.
    if (repositoryHeadExists)
      throw new ProjectManagementError("projects.manage.repositoryExists", { name: templates.repositoryDtag });
    const liveAddresses = memberAddresses(liveHead);
    const resume = liveAddresses.includes(repositoryAddress);
    if (!resume && liveHead.created_at > project.createdAt)
      throw new ProjectManagementError("projects.manage.projectChanged");
    const steps: PublicationStep[] = [];
    if (!resume) {
      const patch = buildProjectPatchTemplate({ liveHead, ownerPubkey: project.owner.toLowerCase(),
        repositoryAddresses: [...liveAddresses, repositoryAddress] });
      steps.push(stepFor({ operation: ProjectPublicationOperation.AttachRepository, targetEventId: liveHead.id, repositoryAddress }, patch));
    }
    steps.push(stepFor({ operation: ProjectPublicationOperation.CreateRepository, workspaceId: access.workspaceId, name: normalizedName,
      ...(normalizedCloneUrl ? { cloneUrl: normalizedCloneUrl } : {}) }, templates.repository));
    return { steps };
  }, signal, directory => Boolean(projectIn(directory, project)?.repositories.some(candidate => candidate.repoAddress === repositoryAddress)),
  intent => {
    const creation = intent.steps.at(-1)?.request;
    return creation?.workspaceId === access.workspaceId && creation.cloneUrl === (cloneUrl?.trim() || undefined);
  }).then(directory => ({ directory, repositoryId: `${project.owner.toLowerCase()}:${repositoryDtag}` }));
}

/** Original useBindProjectRepositoryChannel: the repository owner moves its access Channel. */
export async function bindProjectRepositoryChannel(host: ProjectsHost, repository: Repository, { workspaceId, channelId }: ProjectChannelRef, signal: AbortSignal) {
  const slot = JSON.stringify(["project-repository-bind", host.scopeKey, repository.repoAddress]);
  return runIntent(host, slot, async () => {
    const directory = await loadProjectDirectory(host, signal);
    if (repository.owner.toLowerCase() !== directory.viewerPubkey) throw new ProjectManagementError("projects.manage.notRepositoryOwner");
    const head = currentAnnouncementHead(directory.repositoryEvents, KIND_REPO_ANNOUNCEMENT, repository.owner, repository.dtag);
    if (!head) throw new ProjectManagementError("projects.manage.repositoryMetadataMissing");
    if (head.tags.find(tag => tag[0] === "buzz-channel")?.[1] === channelId) return null;
    const template = buildRepositoryChannelBindingTemplate({ channelId, ownerPubkey: directory.viewerPubkey,
      repository: { ...repository, eventContent: head.content, eventTags: head.tags } });
    return { steps: [stepFor({ operation: ProjectPublicationOperation.BindRepositoryChannel, targetEventId: head.id, workspaceId }, template)] };
  }, signal, directory => directory.projects.some(project => project.repositories.some(candidate =>
    candidate.repoAddress === repository.repoAddress && candidate.channelId === channelId)),
  intent => intent.steps[0]?.request.workspaceId === workspaceId);
}

/** Original useAddProjectChannel link step: the created stream becomes a related project channel. */
export async function linkProjectChannel(host: ProjectsHost, project: Project, { workspaceId, channelId }: ProjectChannelRef, signal: AbortSignal) {
  const slot = JSON.stringify(["project-channel-link", host.scopeKey, project.projectAddress, workspaceId, channelId]);
  return runIntent(host, slot, async () => {
    const directory = await loadProjectDirectory(host, signal);
    if (project.owner.toLowerCase() !== directory.viewerPubkey) throw new ProjectManagementError("projects.manage.notOwnerChannels");
    const liveHead = liveProjectHead(directory, project);
    const templates = buildProjectRelatedChannelPatchTemplate({ channelId, liveHead, ownerPubkey: directory.viewerPubkey });
    if (templates.alreadyBound) return null;
    return { steps: [stepFor({ operation: ProjectPublicationOperation.AddProjectChannel, targetEventId: liveHead.id, workspaceId }, templates.project)] };
  }, signal, directory => Boolean(projectIn(directory, project)?.relatedChannelIds.includes(channelId)));
}

/** The channel of an earlier link of this project that still waits for read-back. */
export function pendingProjectChannelLink(host: ProjectsHost, project: Project): ProjectChannelRef | null {
  const prefix = JSON.stringify(["project-channel-link", host.scopeKey, project.projectAddress]).slice(0, -1);
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const [, , , workspaceId, channelId] = JSON.parse(key) as unknown[];
      if (typeof workspaceId === "string" && typeof channelId === "string") return { workspaceId, channelId };
    }
  } catch { return null; }
  return null;
}

/** Allows automatic healing only from relay-validated owner project data. */
export function canHealProjectHomeRepositories({ identityPubkey, project, projectDataIsAuthoritative }: {
  identityPubkey?: string; project: Pick<Project, "owner" | "repositories">; projectDataIsAuthoritative: boolean;
}): boolean {
  return Boolean(projectDataIsAuthoritative && identityPubkey
    && identityPubkey.toLowerCase() === project.owner.toLowerCase() && project.repositories.length > 0);
}

/**
 * Original useHealProjectHomeRepositories: the owner binds absorbed home-channel repositories onto
 * the signed 30621 so Overview, other clients and NIP-MP agree. One attempt per repository and
 * session; an unconfirmed attach stops the pass and resumes from its own intent later.
 */
export async function healProjectHomeRepositories(host: ProjectsHost, project: Project, attempted: Set<string>, signal: AbortSignal) {
  let attached = 0;
  const directory = await loadProjectDirectory(host, signal);
  const current = projectIn(directory, project);
  if (!current || !canHealProjectHomeRepositories({ identityPubkey: directory.viewerPubkey, project: current, projectDataIsAuthoritative: true })) return attached;
  const liveHead = currentAnnouncementHead(directory.projectEvents, KIND_PROJECT_ANNOUNCEMENT, current.owner, current.dtag);
  if (!liveHead) return attached;
  for (const repository of homeRepositoriesToBind(current, memberAddresses(liveHead))) {
    const key = `${current.projectAddress}:${repository.repoAddress}`;
    if (attempted.has(key)) continue;
    attempted.add(key);
    signal.throwIfAborted();
    // Each attach reads its own fresh head; the next one starts from the updated project.
    const fresh = projectIn(await loadProjectDirectory(host, signal), project);
    if (!fresh) return attached;
    try {
      await attachProjectRepository(host, fresh, repository, signal);
      attached += 1;
    } catch (error) {
      if (error instanceof ProjectManagementPending) return attached;
      // Already bound, raced, or not owner-writable this session.
    }
  }
  return attached;
}

/** Catalog text for a repository/channel management failure; never an unknown result as a refusal. */
export function projectManagementErrorText(t: Translate, failureText: (failure: WriteFailure & { kind: "rejected" }) => string,
  error: unknown, fallback: PlatformMessageKey) {
  if (error instanceof ProjectManagementError) return t(error.key, error.variables);
  if (error instanceof ProjectManagementPending || isOutcomeUnknown(error)) return t("projects.manage.unknown");
  const failure = writeFailure(error);
  if (error instanceof BffError && failure.kind === "rejected") return t("projects.manage.rejected", { reason: failureText(failure) });
  return t(fallback);
}
