import { gql } from '@apollo/client';

// DD-133: current Kailo user, derived component role and naming inputs.
export const KAILO_SESSION = gql`
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

// DD-138(4), `07` §4.8.3: share a thread or the dashboard with Kailo members
// (a Kailo inbox notification each; no access change).
export const KAILO_SHARE_MEMBERS = gql`
  query KailoShareMembers {
    kailoShareMembers {
      userKey
      name
      picture
    }
  }
`;

export const SHARE_WITH_MEMBERS = gql`
  mutation ShareWithMembers($data: KailoShareInput!) {
    shareWithMembers(data: $data) {
      notified
    }
  }
`;
