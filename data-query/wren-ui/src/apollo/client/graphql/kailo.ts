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
    }
  }
`;
