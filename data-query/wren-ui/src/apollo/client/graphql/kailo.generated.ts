import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type KailoSessionQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type KailoSessionQuery = { __typename?: 'Query', kailoSession: { __typename?: 'KailoSession', isAdmin: boolean, productName: string, identityLocale?: string | null, user?: { __typename?: 'KailoUser', name?: string | null, username?: string | null, email?: string | null, picture?: string | null } | null } };


export const KailoSessionDocument = gql`
    query KailoSession {
  kailoSession {
    user {
      name
      username
      email
      picture
    }
    isAdmin
    productName
    identityLocale
  }
}
    `;

/**
 * __useKailoSessionQuery__
 *
 * To run a query within a React component, call `useKailoSessionQuery` and pass it any options that fit your needs.
 * When your component renders, `useKailoSessionQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useKailoSessionQuery({
 *   variables: {
 *   },
 * });
 */
export function useKailoSessionQuery(baseOptions?: Apollo.QueryHookOptions<KailoSessionQuery, KailoSessionQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<KailoSessionQuery, KailoSessionQueryVariables>(KailoSessionDocument, options);
      }
export function useKailoSessionLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<KailoSessionQuery, KailoSessionQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<KailoSessionQuery, KailoSessionQueryVariables>(KailoSessionDocument, options);
        }
export type KailoSessionQueryHookResult = ReturnType<typeof useKailoSessionQuery>;
export type KailoSessionLazyQueryHookResult = ReturnType<typeof useKailoSessionLazyQuery>;
export type KailoSessionQueryResult = Apollo.QueryResult<KailoSessionQuery, KailoSessionQueryVariables>;