import { gql } from '@apollo/client';

// DD-169: data source management (one data source = one native project).

export const DATA_SOURCES = gql`
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

export const DATA_SOURCE = gql`
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

export const CREATE_DATA_SOURCE = gql`
  mutation CreateDataSource($data: DataSourceInput!) {
    createDataSource(data: $data) {
      id
      type
      properties
    }
  }
`;

export const UPDATE_DATA_SOURCE_CONNECTION = gql`
  mutation UpdateDataSourceConnection($id: Int!, $data: DataSourceInput!) {
    updateDataSourceConnection(id: $id, data: $data) {
      id
      type
      properties
    }
  }
`;

export const TEST_DATA_SOURCE_CONNECTION = gql`
  mutation TestDataSourceConnection($data: DataSourceInput!, $id: Int) {
    testDataSourceConnection(data: $data, id: $id) {
      ok
      deferred
      tableCount
      error
    }
  }
`;

export const DELETE_DATA_SOURCE = gql`
  mutation DeleteDataSource($id: Int!) {
    deleteDataSource(id: $id)
  }
`;

export const MIGRATE_DATA_SOURCE_CREDENTIALS = gql`
  mutation MigrateDataSourceCredentials {
    migrateDataSourceCredentials {
      migrated
      pending
    }
  }
`;
