import { graphiqlExpress, graphqlExpress } from 'apollo-server-express';
import { apolloUploadExpress } from 'apollo-upload-server';
import bodyParser from 'body-parser';

import express from 'express';
import jwt from 'express-jwt';
import { execute, subscribe } from 'graphql';
import { createServer } from 'http';
import { use as jsJodaUse } from 'js-joda';
import jsJodaTimezone from 'js-joda-timezone';
import jwksRsa from 'jwks-rsa';
import { get } from 'lodash';
import morgan from 'morgan';
import sharp from 'sharp';
import { SubscriptionServer } from 'subscriptions-transport-ws';
import url from 'url';

import schema from './schema';
import { getByAuth0Id } from './schema/resolvers/User';
import resizer from './resizer';
import loaders from './db/loaders';

jsJodaUse(jsJodaTimezone);

// http://sharp.pixelplumbing.com/en/stable/install/#alpine-linux
sharp.cache(false);

const PORT = 3000;

const app = express();

const loaderContext = options => loaders(options);

// We're behind a proxy and it will read the right data
app.enable('trust proxy');

app.use(morgan('tiny'));

const buildUserForContext = (req, otherContext = {}) => {
  const currentUserAuth0Id = get(req, ['user', 'sub']);
  const context = {
    ...otherContext,
    currentUserAuth0Id,
    user: undefined,
    loaders: loaderContext({ currentUserId: null }),
  };
  if (!currentUserAuth0Id) {
    return Promise.resolve(context);
  }
  return getByAuth0Id(currentUserAuth0Id).then(user => {
    if (user) {
      const loadersWithContext = loaderContext({ currentUserId: user.id });
      loadersWithContext.members.prime(user.id, user);
      return {
        ...context,
        user,
        loaders: loadersWithContext,
      };
    }
    return context;
  });
};

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: 'https://meetupnow.auth0.com/.well-known/jwks.json',
  }),
  credentialsRequired: true,
  audience: 'https://now.meetup.com/graphql',
  issuer: 'https://meetupnow.auth0.com/',
  algorithms: ['RS256'],
});

app.use(
  '/graphql',
  checkJwt,
  bodyParser.json(),
  apolloUploadExpress({ maxFileSize: 10 * 1024 * 1024, maxFiles: 10 }),
  graphqlExpress((req, res) => {
    if (!req.user) {
      return res.send(401);
    }
    return buildUserForContext(req, { http: true }).then(context => ({
      schema,
      context,
    }));
  })
);

app.get(
  '/graphiql',
  graphiqlExpress(req => {
    const token = get(req, ['query', 'token']);
    return {
      endpointURL: '/graphql',
      passHeader: `'Authorization': 'Bearer ${token}'`,
      subscriptionsEndpoint: url.format({
        host: req.get('host'),
        protocol: req.protocol === 'https' ? 'wss' : 'ws',
        pathname: '/subscriptions',
      }),
      websocketConnectionParams: {
        token,
      },
    };
  })
);

app.get('/images/:width(\\d+)x:height(\\d+)/:originalKey(*)', resizer);

const graphQLServer = createServer(app);
graphQLServer.listen(PORT, () => {
  console.log(`Server initialized -- ${process.env.NODE_ENV}`);
});

SubscriptionServer.create(
  {
    schema,
    execute,
    subscribe,
    onConnect: ({ token }) =>
      new Promise((resolve, reject) => {
        const req = { headers: { authorization: `Bearer ${token}` } };
        checkJwt(req, null, err => {
          if (err) {
            reject(new Error('error authorizing'));
          } else {
            resolve(buildUserForContext(req, { websocket: true }));
          }
        });
      }),
  },
  {
    server: graphQLServer,
    path: '/subscriptions',
  }
);
