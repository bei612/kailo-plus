import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  from,
} from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import errorHandler from '@/utils/errorHandler';
import { kailoFetch } from '@/utils/kailoEmbed';
import { dataSourceHeaders } from '@/utils/dataSourceSelection';

const apolloErrorLink = onError((error) => errorHandler(error));

const httpLink = new HttpLink({
  uri: '/api/graphql',
  // DD-133 §2: an expired gateway session is renewed silently once.
  fetch: kailoFetch,
});

// DD-169(2)①: every operation names the tab's current data source.
const dataSourceLink = new ApolloLink((operation, forward) => {
  operation.setContext(({ headers = {} }) => ({
    headers: { ...headers, ...dataSourceHeaders() },
  }));
  return forward(operation);
});

const client = new ApolloClient({
  link: from([apolloErrorLink, dataSourceLink, httpLink]),
  cache: new InMemoryCache(),
});

export default client;
