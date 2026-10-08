import { readFile } from 'fs/promises';
import { request } from 'http';
import { Client } from 'pg';
import { IProjectRepository } from '../repositories/projectRepository';
import { encryptConnectionInfo, toIbisConnectionInfo } from '../dataSource';
import { DataSourceName } from '../types';
import {
  authorizeQuery,
  canonical,
  digest,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './nativeQueryAdmission';

const unavailable = () =>
  new NativeQueryRefusal(503, 'BINDING_EVIDENCE_UNAVAILABLE');
const denied = () => new NativeQueryRefusal(403, 'BINDING_SCOPE_DENIED');
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// This is deployment metadata for the one existing binding, not a registry or
// caller-selected secret endpoint. No credential value is present in this file.
type BindingDelivery = {
  binding: Record<string, any>;
  componentTypeKey: string;
  artifactDigest: string;
  protocolRange: unknown;
  secretSocket: string;
  secretNamespace: string;
  connectionSecretPath: string;
  connectionSecretKey: string;
  serviceSecretPath: string;
  serviceSecretKey: string;
};

async function loadBindingDelivery(
  config: NativeQueryDelivery,
): Promise<BindingDelivery> {
  const path = process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
  if (!path?.startsWith('/')) throw unavailable();
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (
    !value ||
    Object.keys(value).sort().join(',') !==
      'artifactDigest,binding,componentTypeKey,connectionSecretKey,connectionSecretPath,protocolRange,secretNamespace,secretSocket,serviceSecretKey,serviceSecretPath' ||
    !value.secretSocket?.startsWith('/') ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value.connectionSecretPath) ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value.serviceSecretPath) ||
    !value.connectionSecretKey ||
    !value.serviceSecretKey ||
    value.connectionSecretKey === value.serviceSecretKey ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value.secretNamespace) ||
    value.secretNamespace.replace(/\/$/, '') !== `tenants/${config.tenantId}` ||
    typeof value.componentTypeKey !== 'string' ||
    !value.componentTypeKey ||
    !/^[a-f0-9]{64}$/.test(value.artifactDigest)
  )
    throw unavailable();
  const binding = value.binding;
  if (
    !binding ||
    binding.bindingId !== config.bindingId ||
    binding.tenantId !== config.tenantId ||
    binding.workspaceId !== config.workspaceId ||
    binding.nativeInstanceRef !== config.nativeInstanceRef ||
    binding.nativeScopeRef !== config.nativeScopeRef ||
    binding.isolationMode !== 'DEDICATED_INSTANCE' ||
    !uuid.test(binding.componentReleaseId) ||
    !Array.isArray(binding.secretRefs) ||
    binding.secretRefs.length !== 2 ||
    binding.configDigest !== digest(binding.normalizedConfig)
  )
    throw unavailable();
  for (const key of [value.connectionSecretKey, value.serviceSecretKey]) {
    const matches = binding.secretRefs.filter(
      (reference) => reference.secretKey === key,
    );
    const reference = matches[0];
    if (
      matches.length !== 1 ||
      Object.keys(reference).sort().join(',') !==
        'audience,locator,secretKey,version' ||
      !Number.isSafeInteger(reference.version) ||
      reference.version <= 0 ||
      ['audience', 'locator', 'secretKey'].some(
        (key) => typeof reference[key] !== 'string' || !reference[key],
      )
    )
      throw unavailable();
  }
  return value;
}

// No cache or token sink: the original Agent's Unix API proxy performs a fresh,
// version-pinned KV read under its exact AppRole. Core verifies this request_id
// against the original OpenBao audit log and lifecycle AE time before ACTIVE.
async function bindingSecret(
  delivery: BindingDelivery,
  config: NativeQueryDelivery,
  secretKey: string,
  secretPath: string,
) {
  const reference = delivery.binding.secretRefs.find(
    (entry) => entry.secretKey === secretKey,
  );
  const value: any = await new Promise((resolve, reject) => {
    const pending = request(
      {
        socketPath: delivery.secretSocket,
        path: `/v1/${secretPath}?version=${reference.version}`,
        method: 'GET',
        headers: { 'X-Vault-Namespace': delivery.secretNamespace },
        timeout: config.requestTimeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > config.responseMaxBytes) pending.destroy(unavailable());
          else chunks.push(chunk);
        });
        response.on('error', () => reject(unavailable()));
        response.on('end', () => {
          try {
            if (response.statusCode !== 200) throw unavailable();
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(unavailable());
          }
        });
      },
    );
    pending.on('timeout', () => pending.destroy(unavailable()));
    pending.on('error', () => reject(unavailable()));
    pending.end();
  });
  if (
    !uuid.test(value.request_id) ||
    value.data?.metadata?.version !== reference.version ||
    value.data.metadata.destroyed !== false ||
    value.data.metadata.deletion_time !== '' ||
    !value.data.data ||
    typeof value.data.data !== 'object'
  )
    throw unavailable();
  return {
    value: value.data.data,
    read: {
      secretKey: reference.secretKey,
      version: reference.version,
      audience: reference.audience,
      requestId: value.request_id,
    },
  };
}

// Read native PostgreSQL privileges for every role the account can assume, not
// merely a UI readOnly flag or default_transaction_read_only (which users can
// reset). The native database remains the final permission authority.
export async function verifyPostgresReader(
  connectionString: string,
  timeout: number,
) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeout,
    query_timeout: timeout,
    statement_timeout: timeout,
  });
  try {
    await client.connect();
    const result = await client.query(`
      with reachable as (
        select * from pg_roles where rolname=current_user or rolname=session_user
          or pg_has_role(current_user,oid,'MEMBER') or pg_has_role(session_user,oid,'MEMBER')
      ) select current_user as principal, current_database() as database,
        exists(select 1 from reachable r where
          r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls
          or r.rolname in ('pg_write_all_data','pg_write_server_files','pg_execute_server_program')
          or has_database_privilege(r.oid,current_database(),'CREATE,TEMPORARY')
          or exists(select 1 from pg_namespace n where has_schema_privilege(r.oid,n.oid,'CREATE'))
          or exists(select 1 from pg_class c where c.relkind in ('r','p','v','m','f')
            and c.oid <> 'pg_catalog.pg_settings'::regclass
            and (c.relowner=r.oid or has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
          or exists(select 1 from pg_class c where c.relkind='S'
            and (c.relowner=r.oid or has_sequence_privilege(r.oid,c.oid,'USAGE,UPDATE')))
          or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname not in ('pg_catalog','information_schema')
            and has_function_privilege(r.oid,p.oid,'EXECUTE'))
        ) as writable`);
    if (
      result.rows.length !== 1 ||
      result.rows[0].writable !== false ||
      !result.rows[0].principal ||
      !result.rows[0].database
    )
      throw denied();
  } finally {
    await client.end();
  }
}

export class NativeBindingService {
  constructor(
    private readonly config: NativeQueryDelivery,
    private readonly projects: IProjectRepository,
  ) {}

  async call(
    token: string,
    operation: 'handshake' | 'validate_binding',
    key: string,
    raw: unknown,
  ) {
    const args = raw as Record<string, any>;
    if (!uuid.test(key) || !args || args.idempotencyKey !== key) throw denied();
    const claims = await authorizeQuery(this.config, token, operation, args);
    if (
      claims.action_key !== 'application_binding.create' ||
      claims.target_type !== 'APPLICATION_BINDING' ||
      claims.target_id !== this.config.bindingId
    )
      throw denied();
    const delivery = await loadBindingDelivery(this.config);
    if (operation === 'handshake') {
      if (
        canonical(args) !==
        canonical({
          idempotencyKey: key,
          componentReleaseId: delivery.binding.componentReleaseId,
          componentTypeKey: delivery.componentTypeKey,
          protocolRange: delivery.protocolRange,
        })
      )
        throw denied();
      return { protocolVersion: '1', artifactDigest: delivery.artifactDigest };
    }
    if (
      canonical(args) !==
      canonical({ ...delivery.binding, idempotencyKey: key })
    )
      throw denied();
    // GenBI's original UI selects the first native project. The governed
    // binding must address that same project in this dedicated instance,
    // not an otherwise-valid hidden project selected only by the adapter.
    const project = await this.projects.getCurrentProject();
    if (
      !project ||
      project.id !== this.config.projectId ||
      project.type !== DataSourceName.POSTGRES ||
      digest({
        type: project.type,
        connectionInfo: project.connectionInfo,
        catalog: project.catalog,
        schema: project.schema,
      }) !== this.config.projectConnectionDigest
    )
      throw denied();
    const secret = await bindingSecret(
      delivery,
      this.config,
      delivery.connectionSecretKey,
      delivery.connectionSecretPath,
    );
    const service = await bindingSecret(
      delivery,
      this.config,
      delivery.serviceSecretKey,
      delivery.serviceSecretPath,
    );
    const serviceValue = await readFile(
      this.config.serviceClientSecretFile,
      'utf8',
    );
    if (
      !secret.value.connectionInfo ||
      typeof service.value.value !== 'string' ||
      !serviceValue ||
      serviceValue.trim() !== serviceValue ||
      service.value.value !== serviceValue ||
      service.read.requestId === secret.read.requestId
    )
      throw denied();
    const actual = toIbisConnectionInfo(project.type, project.connectionInfo);
    const delivered = toIbisConnectionInfo(
      project.type,
      encryptConnectionInfo(project.type, secret.value.connectionInfo),
    );
    if (canonical(actual) !== canonical(delivered)) throw denied();
    await verifyPostgresReader(
      actual.connectionUrl,
      this.config.requestTimeoutMs,
    );
    await authorizeQuery(this.config, token, operation, args);
    const currentProject = await this.projects.getCurrentProject();
    if (
      !currentProject ||
      currentProject.id !== project.id ||
      digest({
        type: currentProject.type,
        connectionInfo: currentProject.connectionInfo,
        catalog: currentProject.catalog,
        schema: currentProject.schema,
      }) !== this.config.projectConnectionDigest ||
      canonical(await loadBindingDelivery(this.config)) !==
        canonical(delivery) ||
      (await readFile(this.config.serviceClientSecretFile, 'utf8')) !==
        serviceValue
    )
      throw denied();
    return {
      bindingId: this.config.bindingId,
      tenantId: this.config.tenantId,
      workspaceId: this.config.workspaceId,
      nativeInstanceRef: this.config.nativeInstanceRef,
      nativeScopeRef: this.config.nativeScopeRef,
      isolationMode: delivery.binding.isolationMode,
      configDigest: delivery.binding.configDigest,
      secretRefDigest: digest(delivery.binding.secretRefs),
      artifactDigest: delivery.artifactDigest,
      secretReads: [secret.read, service.read],
      executionMappings: [
        'data_query.query@v1',
        'data_query.dry_run@v1',
        'data_query.describe@v1',
      ].map((actionKey) => ({
        actionKey,
        actionVersion: 1,
        nativeType: 'wren.api_history',
        cancelCapability: 'UNSUPPORTED',
      })),
    };
  }
}
