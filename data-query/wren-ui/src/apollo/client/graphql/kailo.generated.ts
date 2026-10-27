import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type KailoSessionQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type KailoSessionQuery = { __typename?: 'Query', kailoSession: { __typename?: 'KailoSession', isAdmin: boolean, productName: string, identityLocale?: string | null, shareAvailable: boolean, user?: { __typename?: 'KailoUser', name?: string | null, username?: string | null, email?: string | null, picture?: string | null } | null } };

export type KailoShareMembersQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type KailoShareMembersQuery = { __typename?: 'Query', kailoShareMembers: Array<{ __typename?: 'KailoShareMember', userKey: string, name?: string | null, picture?: string | null }> };

export type ShareWithMembersMutationVariables = Types.Exact<{
  data: Types.KailoShareInput;
}>;


export type ShareWithMembersMutation = { __typename?: 'Mutation', shareWithMembers: { __typename?: 'KailoShareResult', notified: number } };


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
    shareAvailable
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
export const KailoShareMembersDocument = gql`
    query KailoShareMembers {
  kailoShareMembers {
    userKey
    name
    picture
  }
}
    `;

/**
 * __useKailoShareMembersQuery__
 *
 * To run a query within a React component, call `useKailoShareMembersQuery` and pass it any options that fit your needs.
 * When your component renders, `useKailoShareMembersQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useKailoShareMembersQuery({
 *   variables: {
 *   },
 * });
 */
export function useKailoShareMembersQuery(baseOptions?: Apollo.QueryHookOptions<KailoShareMembersQuery, KailoShareMembersQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<KailoShareMembersQuery, KailoShareMembersQueryVariables>(KailoShareMembersDocument, options);
      }
export function useKailoShareMembersLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<KailoShareMembersQuery, KailoShareMembersQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<KailoShareMembersQuery, KailoShareMembersQueryVariables>(KailoShareMembersDocument, options);
        }
export type KailoShareMembersQueryHookResult = ReturnType<typeof useKailoShareMembersQuery>;
export type KailoShareMembersLazyQueryHookResult = ReturnType<typeof useKailoShareMembersLazyQuery>;
export type KailoShareMembersQueryResult = Apollo.QueryResult<KailoShareMembersQuery, KailoShareMembersQueryVariables>;
export const ShareWithMembersDocument = gql`
    mutation ShareWithMembers($data: KailoShareInput!) {
  shareWithMembers(data: $data) {
    notified
  }
}
    `;
export type ShareWithMembersMutationFn = Apollo.MutationFunction<ShareWithMembersMutation, ShareWithMembersMutationVariables>;

/**
 * __useShareWithMembersMutation__
 *
 * To run a mutation, you first call `useShareWithMembersMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useShareWithMembersMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [shareWithMembersMutation, { data, loading, error }] = useShareWithMembersMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useShareWithMembersMutation(baseOptions?: Apollo.MutationHookOptions<ShareWithMembersMutation, ShareWithMembersMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<ShareWithMembersMutation, ShareWithMembersMutationVariables>(ShareWithMembersDocument, options);
      }
export type ShareWithMembersMutationHookResult = ReturnType<typeof useShareWithMembersMutation>;
export type ShareWithMembersMutationResult = Apollo.MutationResult<ShareWithMembersMutation>;
export type ShareWithMembersMutationOptions = Apollo.BaseMutationOptions<ShareWithMembersMutation, ShareWithMembersMutationVariables>;