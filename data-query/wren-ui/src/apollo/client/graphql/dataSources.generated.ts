import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type DataSourcesQueryVariables = Types.Exact<{
  filter?: Types.InputMaybe<Types.DataSourceListFilter>;
  offset?: Types.InputMaybe<Types.Scalars['Int']>;
  limit?: Types.InputMaybe<Types.Scalars['Int']>;
}>;

export type DataSourcesQuery = {
  __typename?: 'Query';
  dataSources: {
    __typename?: 'DataSourceList';
    total: number;
    defaultId?: number | null;
    governed: boolean;
    kailoCustody: boolean;
    items: Array<{
      __typename?: 'DataSourceSummary';
      id: number;
      displayName: string;
      type: Types.DataSourceName;
      status: Types.DataSourceStatus;
      modelCount: number;
      credentialStorage?: Types.DataSourceCredentialStorage | null;
    }>;
  };
};

export type DataSourceQueryVariables = Types.Exact<{
  id: Types.Scalars['Int'];
}>;

export type DataSourceQuery = {
  __typename?: 'Query';
  dataSource: {
    __typename?: 'DataSourceDetail';
    id: number;
    displayName: string;
    type: Types.DataSourceName;
    properties: any;
    credentialFields: Array<string>;
    credentialStorage: Types.DataSourceCredentialStorage;
    status: Types.DataSourceStatus;
    modelCount: number;
    lastDeployedAt?: string | null;
  };
};

export type CreateDataSourceMutationVariables = Types.Exact<{
  data: Types.DataSourceInput;
}>;

export type CreateDataSourceMutation = {
  __typename?: 'Mutation';
  createDataSource: {
    __typename?: 'DataSource';
    id?: number | null;
    type: Types.DataSourceName;
    properties: any;
  };
};

export type UpdateDataSourceConnectionMutationVariables = Types.Exact<{
  id: Types.Scalars['Int'];
  data: Types.DataSourceInput;
}>;

export type UpdateDataSourceConnectionMutation = {
  __typename?: 'Mutation';
  updateDataSourceConnection: {
    __typename?: 'DataSource';
    id?: number | null;
    type: Types.DataSourceName;
    properties: any;
  };
};

export type TestDataSourceConnectionMutationVariables = Types.Exact<{
  data: Types.DataSourceInput;
  id?: Types.InputMaybe<Types.Scalars['Int']>;
}>;

export type TestDataSourceConnectionMutation = {
  __typename?: 'Mutation';
  testDataSourceConnection: {
    __typename?: 'DataSourceTestResult';
    ok: boolean;
    deferred: boolean;
    tableCount?: number | null;
    error?: string | null;
  };
};

export type DeleteDataSourceMutationVariables = Types.Exact<{
  id: Types.Scalars['Int'];
}>;

export type DeleteDataSourceMutation = {
  __typename?: 'Mutation';
  deleteDataSource: boolean;
};

export type MigrateDataSourceCredentialsMutationVariables = Types.Exact<{
  [key: string]: never;
}>;

export type MigrateDataSourceCredentialsMutation = {
  __typename?: 'Mutation';
  migrateDataSourceCredentials: {
    __typename?: 'DataSourceCredentialMigration';
    migrated: number;
    pending: number;
  };
};

export const DataSourcesDocument = gql`
  query DataSources($filter: DataSourceListFilter, $offset: Int, $limit: Int) {
    dataSources(filter: $filter, offset: $offset, limit: $limit) {
      items {
        id
        displayName
        type
        status
        modelCount
        credentialStorage
      }
      total
      defaultId
      governed
      kailoCustody
    }
  }
`;
export function useDataSourcesQuery(
  baseOptions?: Apollo.QueryHookOptions<
    DataSourcesQuery,
    DataSourcesQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useQuery<DataSourcesQuery, DataSourcesQueryVariables>(
    DataSourcesDocument,
    options,
  );
}
export function useDataSourcesLazyQuery(
  baseOptions?: Apollo.LazyQueryHookOptions<
    DataSourcesQuery,
    DataSourcesQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useLazyQuery<DataSourcesQuery, DataSourcesQueryVariables>(
    DataSourcesDocument,
    options,
  );
}
export type DataSourcesQueryHookResult = ReturnType<typeof useDataSourcesQuery>;
export type DataSourcesLazyQueryHookResult = ReturnType<
  typeof useDataSourcesLazyQuery
>;
export type DataSourcesQueryResult = Apollo.QueryResult<
  DataSourcesQuery,
  DataSourcesQueryVariables
>;
export const DataSourceDocument = gql`
  query DataSource($id: Int!) {
    dataSource(id: $id) {
      id
      displayName
      type
      properties
      credentialFields
      credentialStorage
      status
      modelCount
      lastDeployedAt
    }
  }
`;
export function useDataSourceQuery(
  baseOptions?: Apollo.QueryHookOptions<
    DataSourceQuery,
    DataSourceQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useQuery<DataSourceQuery, DataSourceQueryVariables>(
    DataSourceDocument,
    options,
  );
}
export function useDataSourceLazyQuery(
  baseOptions?: Apollo.LazyQueryHookOptions<
    DataSourceQuery,
    DataSourceQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useLazyQuery<DataSourceQuery, DataSourceQueryVariables>(
    DataSourceDocument,
    options,
  );
}
export type DataSourceQueryHookResult = ReturnType<typeof useDataSourceQuery>;
export type DataSourceLazyQueryHookResult = ReturnType<
  typeof useDataSourceLazyQuery
>;
export type DataSourceQueryResult = Apollo.QueryResult<
  DataSourceQuery,
  DataSourceQueryVariables
>;
export const CreateDataSourceDocument = gql`
  mutation CreateDataSource($data: DataSourceInput!) {
    createDataSource(data: $data) {
      id
      type
      properties
    }
  }
`;
export type CreateDataSourceMutationFn = Apollo.MutationFunction<
  CreateDataSourceMutation,
  CreateDataSourceMutationVariables
>;
export function useCreateDataSourceMutation(
  baseOptions?: Apollo.MutationHookOptions<
    CreateDataSourceMutation,
    CreateDataSourceMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useMutation<
    CreateDataSourceMutation,
    CreateDataSourceMutationVariables
  >(CreateDataSourceDocument, options);
}
export type CreateDataSourceMutationHookResult = ReturnType<
  typeof useCreateDataSourceMutation
>;
export type CreateDataSourceMutationResult =
  Apollo.MutationResult<CreateDataSourceMutation>;
export type CreateDataSourceMutationOptions = Apollo.BaseMutationOptions<
  CreateDataSourceMutation,
  CreateDataSourceMutationVariables
>;
export const UpdateDataSourceConnectionDocument = gql`
  mutation UpdateDataSourceConnection($id: Int!, $data: DataSourceInput!) {
    updateDataSourceConnection(id: $id, data: $data) {
      id
      type
      properties
    }
  }
`;
export type UpdateDataSourceConnectionMutationFn = Apollo.MutationFunction<
  UpdateDataSourceConnectionMutation,
  UpdateDataSourceConnectionMutationVariables
>;
export function useUpdateDataSourceConnectionMutation(
  baseOptions?: Apollo.MutationHookOptions<
    UpdateDataSourceConnectionMutation,
    UpdateDataSourceConnectionMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useMutation<
    UpdateDataSourceConnectionMutation,
    UpdateDataSourceConnectionMutationVariables
  >(UpdateDataSourceConnectionDocument, options);
}
export type UpdateDataSourceConnectionMutationHookResult = ReturnType<
  typeof useUpdateDataSourceConnectionMutation
>;
export type UpdateDataSourceConnectionMutationResult =
  Apollo.MutationResult<UpdateDataSourceConnectionMutation>;
export type UpdateDataSourceConnectionMutationOptions =
  Apollo.BaseMutationOptions<
    UpdateDataSourceConnectionMutation,
    UpdateDataSourceConnectionMutationVariables
  >;
export const TestDataSourceConnectionDocument = gql`
  mutation TestDataSourceConnection($data: DataSourceInput!, $id: Int) {
    testDataSourceConnection(data: $data, id: $id) {
      ok
      deferred
      tableCount
      error
    }
  }
`;
export type TestDataSourceConnectionMutationFn = Apollo.MutationFunction<
  TestDataSourceConnectionMutation,
  TestDataSourceConnectionMutationVariables
>;
export function useTestDataSourceConnectionMutation(
  baseOptions?: Apollo.MutationHookOptions<
    TestDataSourceConnectionMutation,
    TestDataSourceConnectionMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useMutation<
    TestDataSourceConnectionMutation,
    TestDataSourceConnectionMutationVariables
  >(TestDataSourceConnectionDocument, options);
}
export type TestDataSourceConnectionMutationHookResult = ReturnType<
  typeof useTestDataSourceConnectionMutation
>;
export type TestDataSourceConnectionMutationResult =
  Apollo.MutationResult<TestDataSourceConnectionMutation>;
export type TestDataSourceConnectionMutationOptions =
  Apollo.BaseMutationOptions<
    TestDataSourceConnectionMutation,
    TestDataSourceConnectionMutationVariables
  >;
export const DeleteDataSourceDocument = gql`
  mutation DeleteDataSource($id: Int!) {
    deleteDataSource(id: $id)
  }
`;
export type DeleteDataSourceMutationFn = Apollo.MutationFunction<
  DeleteDataSourceMutation,
  DeleteDataSourceMutationVariables
>;
export function useDeleteDataSourceMutation(
  baseOptions?: Apollo.MutationHookOptions<
    DeleteDataSourceMutation,
    DeleteDataSourceMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useMutation<
    DeleteDataSourceMutation,
    DeleteDataSourceMutationVariables
  >(DeleteDataSourceDocument, options);
}
export type DeleteDataSourceMutationHookResult = ReturnType<
  typeof useDeleteDataSourceMutation
>;
export type DeleteDataSourceMutationResult =
  Apollo.MutationResult<DeleteDataSourceMutation>;
export type DeleteDataSourceMutationOptions = Apollo.BaseMutationOptions<
  DeleteDataSourceMutation,
  DeleteDataSourceMutationVariables
>;
export const MigrateDataSourceCredentialsDocument = gql`
  mutation MigrateDataSourceCredentials {
    migrateDataSourceCredentials {
      migrated
      pending
    }
  }
`;
export type MigrateDataSourceCredentialsMutationFn = Apollo.MutationFunction<
  MigrateDataSourceCredentialsMutation,
  MigrateDataSourceCredentialsMutationVariables
>;
export function useMigrateDataSourceCredentialsMutation(
  baseOptions?: Apollo.MutationHookOptions<
    MigrateDataSourceCredentialsMutation,
    MigrateDataSourceCredentialsMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useMutation<
    MigrateDataSourceCredentialsMutation,
    MigrateDataSourceCredentialsMutationVariables
  >(MigrateDataSourceCredentialsDocument, options);
}
export type MigrateDataSourceCredentialsMutationHookResult = ReturnType<
  typeof useMigrateDataSourceCredentialsMutation
>;
export type MigrateDataSourceCredentialsMutationResult =
  Apollo.MutationResult<MigrateDataSourceCredentialsMutation>;
export type MigrateDataSourceCredentialsMutationOptions =
  Apollo.BaseMutationOptions<
    MigrateDataSourceCredentialsMutation,
    MigrateDataSourceCredentialsMutationVariables
  >;
