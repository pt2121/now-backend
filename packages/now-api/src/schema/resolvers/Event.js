import { ChronoUnit, Instant, ZoneId } from 'js-joda';
import uuid from 'uuid';

import { userIdFromContext, sqlPaginatify } from '../util';
import { getEventRsvps, userDidRsvp } from './Rsvp';
import { getMessages } from './Message';
import { getPubSub } from '../../subscriptions';
import { Event } from '../../db/repos';

// Resolvers
const activityResolver = ({ activityId }, args, { loaders }) =>
  loaders.activities.load(activityId);

const rsvpsResolver = (root, args) =>
  getEventRsvps({
    eventId: root.id,
    ...args,
  });

const messagesResolver = (root, args) =>
  getMessages(root, {
    eventId: root.id,
    ...args,
  });

const isAttendingResolver = ({ id }, { userId }, ctx) =>
  userDidRsvp({ eventId: id, userId: userId || userIdFromContext(ctx) });

// one day, this will be fancier.
const stateResolver = ({ time }) => {
  const eventTime = time.toInstant();
  const now = Instant.now();

  if (now.isBefore(eventTime)) return 'FUTURE';
  else if (eventTime.until(now, ChronoUnit.HOURS) < 2) return 'PRESENT';
  return 'PAST';
};

const locationResolver = ({ locationId }, args, { loaders }) =>
  loaders.locations.load(locationId);

const timeResolver = ({ time, timezone }) =>
  time
    .withZoneSameInstant(ZoneId.of(timezone))
    .truncatedTo(ChronoUnit.SECONDS)
    .withFixedOffsetZone();

export const resolvers = {
  activity: activityResolver,
  rsvps: rsvpsResolver,
  messages: messagesResolver,
  isAttending: isAttendingResolver,
  state: stateResolver,
  location: locationResolver,
  time: timeResolver,
};

// Queries
const allEvents = (root, { input }) => {
  const { orderBy = 'id', ...pageParams } = input || {};
  return sqlPaginatify(orderBy, Event.all({}), pageParams);
};

const manyEvents = (root, { ids }, { loaders }) => loaders.events.loadMany(ids);

const eventQuery = (root, { id }, { loaders }) => loaders.events.load(id);

export const queries = { event: eventQuery, allEvents, manyEvents };

const createEvent = (
  root,
  { input: { time, activityId, limit, location } },
  { loaders }
) => {
  const newId = uuid.v1();
  const ISOString = new Date().toISOString();
  const newEvent = {
    id: newId,
    limit,
    activityId,
    createdAt: ISOString,
    updatedAt: ISOString,
    rsvps: [],
    time: time.toISOString(),
    location,
  };

  loaders.events.clear(newId);

  return Event.update(newEvent).then(() => ({
    event: loaders.events.load(newId),
  }));
};

export const mutations = {
  createEvent,
};

const topicName = eventId => `event-changes-${eventId}`;

export const notifyEventChange = eventId =>
  getPubSub().publish(topicName(eventId), true);

const eventSubscription = {
  subscribe: (root, { id }) => getPubSub().asyncIterator(topicName(id)),
  resolve: (payload, { id }, { loaders }) => loaders.events(id),
};

export const subscriptions = { event: eventSubscription };
