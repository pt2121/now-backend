import gql from 'graphql-tag';

import { client, USER_ID } from '../db/mock';
import { SQL_TABLES } from '../db/constants';
import sql from '../db/sql';
import factory from '../db/factory';
import { Rsvp } from '../db/repos';

const activity = factory.build('activity');
const location = factory.build('location');
const event = factory.build('event', {}, { activity, location });
const user = factory.build('user', { id: USER_ID });

const truncateTables = () =>
  Promise.all([
    sql(SQL_TABLES.ACTIVITIES).truncate(),
    sql(SQL_TABLES.LOCATIONS).truncate(),
    sql(SQL_TABLES.EVENTS).truncate(),
    sql(SQL_TABLES.RSVPS).truncate(),
    sql(SQL_TABLES.USERS).truncate(),
  ]);

beforeEach(() =>
  truncateTables().then(() =>
    Promise.all([
      sql(SQL_TABLES.ACTIVITIES).insert(activity),
      sql(SQL_TABLES.EVENTS).insert(event),
      sql(SQL_TABLES.LOCATIONS).insert(location),
      sql(SQL_TABLES.USERS).insert(user),
    ])
  )
);
afterEach(() => truncateTables());

describe('Rsvp', () => {
  it('rsvp to event', async () => {
    const results = await client.mutate({
      mutation: gql`
        mutation rsvp($input: CreateRsvpInput!) {
          addRsvp(input: $input) {
            rsvp {
              id
              user {
                id
              }
              event {
                id
                isAttending
              }
            }
            event {
              id
            }
          }
        }
      `,
      variables: { input: { eventId: event.id } },
    });
    const { data } = results;
    expect(data).toMatchObject({
      addRsvp: {
        __typename: 'CreateRsvpPayload',
        event: {
          __typename: 'Event',
          id: event.id,
        },
        rsvp: {
          __typename: 'Rsvp',
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          ),
          event: {
            __typename: 'Event',
            id: event.id,
            isAttending: true,
          },
          user: {
            __typename: 'User',
            id: USER_ID,
          },
        },
      },
    });

    const dbRsvp = await Rsvp.byId(data.addRsvp.rsvp.id);

    expect(dbRsvp).toMatchObject({
      id: data.addRsvp.rsvp.id,
      userId: USER_ID,
      eventId: event.id,
      action: 'add',
    });
  });

  it('unrsvp from event', async () => {
    const rsvp = factory.build('rsvp', { eventId: event.id, userId: USER_ID });
    await Rsvp.insert(rsvp);

    const results = await client.mutate({
      mutation: gql`
        mutation rsvp($input: CreateRsvpInput!) {
          removeRsvp(input: $input) {
            rsvp {
              id
            }
            event {
              id
            }
          }
        }
      `,
      variables: { input: { eventId: event.id } },
    });
    const { data } = results;
    expect(data).toMatchObject({
      removeRsvp: {
        __typename: 'CreateRsvpPayload',
        event: {
          __typename: 'Event',
          id: event.id,
        },
        rsvp: {
          __typename: 'Rsvp',
          id: rsvp.id,
        },
      },
    });

    const dbRsvp = await Rsvp.byId(rsvp.id);

    expect(dbRsvp).toMatchObject({
      id: rsvp.id,
      userId: USER_ID,
      eventId: event.id,
      action: 'remove',
    });
  });

  it('get user rsvps', async () => {
    const rsvp = factory.build('rsvp', {
      eventId: event.id,
      userId: USER_ID,
    });
    await Rsvp.insert(rsvp);

    const results = await client.query({
      query: gql`
        query userWithRsvps($id: ID!) {
          user(id: $id) {
            id
            rsvps {
              count
              edges {
                node {
                  id
                  lastReadTs
                }
              }
            }
          }
        }
      `,
      variables: { id: USER_ID },
    });

    const { data } = results;
    expect(data).toMatchObject({
      user: {
        __typename: 'User',
        id: USER_ID,
        rsvps: {
          count: 1,
          edges: [
            {
              node: {
                __typename: 'Rsvp',
                id: rsvp.id,
              },
            },
          ],
        },
      },
    });
  });

  describe('markEventChatRead', () => {
    it('update read time', async () => {
      const rsvp = factory.build('rsvp', {
        eventId: event.id,
        userId: USER_ID,
      });
      await Rsvp.insert(rsvp);

      const results = await client.mutate({
        mutation: gql`
          mutation rsvp($input: MarkEventChatReadInput!) {
            markEventChatRead(input: $input) {
              rsvp {
                id
                lastReadTs
              }
            }
          }
        `,
        variables: { input: { eventId: event.id, ts: '123456' } },
      });
      const { data } = results;
      expect(data).toMatchObject({
        markEventChatRead: {
          __typename: 'MarkEventChatReadPayload',
          rsvp: {
            __typename: 'Rsvp',
            id: rsvp.id,
            lastReadTs: '123456',
          },
        },
      });

      const dbRsvp = await Rsvp.byId(rsvp.id);

      expect(dbRsvp).toMatchObject({
        id: rsvp.id,
        userId: USER_ID,
        eventId: event.id,
        lastReadTs: '123456',
      });
    });

    it('requires ts as number', async () => {
      const rsvp = factory.build('rsvp', {
        eventId: event.id,
        userId: USER_ID,
      });
      await Rsvp.insert(rsvp);
      const results = client.mutate({
        mutation: gql`
          mutation rsvp($input: MarkEventChatReadInput!) {
            markEventChatRead(input: $input) {
              rsvp {
                id
                lastReadTs
              }
            }
          }
        `,
        variables: { input: { eventId: event.id, ts: 'not a number' } },
        errorPolicy: 'none',
      });

      expect.assertions(1);
      return expect(results).rejects.toEqual(
        new Error('GraphQL error: ts must be an integer as a string')
      );
    });

    it('rsvp must exist', async () => {
      const rsvp = factory.build('rsvp', {
        eventId: event.id,
        userId: USER_ID,
      });
      await Rsvp.insert(rsvp);
      const results = client.mutate({
        mutation: gql`
          mutation rsvp($input: MarkEventChatReadInput!) {
            markEventChatRead(input: $input) {
              rsvp {
                id
                lastReadTs
              }
            }
          }
        `,
        variables: {
          input: {
            eventId: 'd6053268-593c-11e8-87f3-f7f40ede39cf',
            ts: '123456',
          },
        },
        errorPolicy: 'none',
      });

      expect.assertions(1);
      return expect(results).rejects.toEqual(
        new Error('GraphQL error: Rsvp not found')
      );
    });
  });
});
