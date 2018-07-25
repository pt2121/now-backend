/* eslint-disable no-await-in-loop */
import { ZonedDateTime, LocalDate, LocalDateTime } from 'js-joda';
import leftPad from 'left-pad';
import randomNumber from 'random-number-csprng';
import uuid from 'uuid/v4';

import sql from '../../db/sql';
import { Invitation } from '../../db/repos';
import { userQuery } from './User';
import { createRsvp } from './Rsvp';
import { sqlPaginatify, userIdFromContext } from '../util';
import {
  hasInvitedToEvent,
  notifyEventChange,
  visibleEventsQuery,
} from './Event';
import { EARLY_AVAILABILITY_HOUR, AVAILABILITY_HOUR, NYC_TZ } from './Activity';

const MAX_CODE_RETRIES = 6;

export const APP_INVITE_TYPE = 'AppInvitation';
export const EVENT_INVITE_TYPE = 'EventInvitation';

// given a partial knex query, add some WHERE clauses to make sure the token
// is currently redeemable
const valid = builder =>
  builder
    .whereNull('usedAt')
    .whereRaw('(?? >= now() or ?? is null)', ['expiresAt', 'expiresAt']);

export const findValidCode = (code, trx, ...fields) =>
  valid(Invitation.withTransaction(trx).all({ code })).first(...fields);

const canInviteNow = date => {
  const now = LocalDateTime.now(NYC_TZ);
  const today = now.toLocalDate();
  const tomorrowBegin = today.plusDays(1).atStartOfDay();
  const tomorrowEnd = today.plusDays(2).atStartOfDay();
  const earlyAvailabilityTime = today.atTime(EARLY_AVAILABILITY_HOUR);
  const availabilityTime = today.atTime(AVAILABILITY_HOUR);

  return (
    date.isAfter(tomorrowBegin) &&
    date.isBefore(tomorrowEnd) &&
    !now.isBefore(earlyAvailabilityTime) &&
    now.isBefore(availabilityTime)
  );
};

const resolveType = ({ type }) => type;

const resolveInviter = (invitation, args, context) =>
  userQuery(invitation, { id: invitation.inviterId }, context);

const resolveEvent = ({ eventId }, args, { loaders }) =>
  loaders.events.load(eventId);

export const resolvers = {
  __resolveType: resolveType,
  inviter: resolveInviter,
  event: resolveEvent,
};

const invitationQuery = (root, { code, id }) => {
  if (code) {
    return findValidCode(code).then(
      candidate => (id && candidate.id !== id ? null : candidate)
    );
  }
  if (id) {
    return Invitation.byId(id);
  }
  return null;
};

const openAppInvitations = (root, { input }) => {
  const { orderBy = 'id', ...pageParams } = input || {};
  return sqlPaginatify(
    orderBy,
    valid(Invitation.all({ type: APP_INVITE_TYPE })),
    pageParams
  );
};

export const queries = { invitation: invitationQuery, openAppInvitations };

// regex which matches a string with all the same character, like 444444
const allTheSame = /^(.)\1*$/;

export const generateCode = async trx => {
  for (let i = 0; i < MAX_CODE_RETRIES; i += 1) {
    const num = await randomNumber(0, 999999);
    const trialCode = leftPad(String(num), 6, '0');
    const existing = await findValidCode(trialCode, trx, 'id');
    if (!existing && !allTheSame.test(trialCode)) {
      return trialCode;
    }
  }
  throw new Error("Couldn't generate code.");
};

const createEventInvitation = async (root, { input: { eventId } }, context) =>
  sql.transaction(async trx => {
    const event = await visibleEventsQuery()
      .where({ id: eventId })
      .transacting(trx)
      .forUpdate()
      .first();

    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    const inviterId = userIdFromContext(context);

    if (event.limit - event.going < 2) {
      throw new Error("Sorry, there aren't enough spots left now");
    }

    if (!canInviteNow(event.time.toLocalDateTime())) {
      throw new Error("You can't invite a friend to this Meetup at this time.");
    }

    if (await hasInvitedToEvent(eventId, inviterId)) {
      throw new Error("You're only allowed to invite one person to a Meetup.");
    }

    const id = uuid();
    const code = await generateCode();
    const expiresAt = LocalDate.now(NYC_TZ)
      .atTime(AVAILABILITY_HOUR)
      .atZone(NYC_TZ);

    const newInvitation = {
      id,
      code,
      type: EVENT_INVITE_TYPE,
      inviterId,
      eventId,
      notes: '',
      expiresAt: expiresAt.toInstant().toString(),
      message: `You've been invited to a Meetup Now! Get the app here: https://now.meetup.com/. Your invite code is ${code}`,
    };

    await Invitation.insert(newInvitation).transacting(trx);
    const invitation = await Invitation.byId(id).transacting(trx);

    // Inviter rsvp
    await createRsvp(
      trx,
      { eventId: invitation.eventId, userId: inviterId },
      'add',
      context.loaders
    );
    // Invited rsvp placeholder
    await createRsvp(
      trx,
      { eventId: invitation.eventId, inviteId: id },
      'add',
      context.loaders
    );

    notifyEventChange(eventId);
    return {
      invitation,
    };
  });

const makeAppInvitation = async (trx, expiresAt, inviterId, notes) => {
  const id = uuid();
  const code = await generateCode();
  const newInvitation = {
    id,
    code,
    type: APP_INVITE_TYPE,
    inviterId,
    expiresAt: (expiresAt || ZonedDateTime.now().plusWeeks(1))
      .toInstant()
      .toString(),
    notes,
    eventId: null,
  };
  await Invitation.withTransaction(trx).insert(newInvitation);

  return id;
};

const createAppInvitation = (
  root,
  { input: { notes, expiresAt } },
  context
) => {
  const inviterId = userIdFromContext(context);
  return makeAppInvitation(undefined, expiresAt, inviterId, notes).then(id => ({
    invitation: Invitation.byId(id),
  }));
};

const createManyAppInvitations = (
  root,
  { input: { notes, expiresAt } },
  context
) => {
  const inviterId = userIdFromContext(context);
  return sql
    .transaction(trx =>
      Promise.all(
        notes.map(note => makeAppInvitation(trx, expiresAt, inviterId, note))
      )
    )
    .then(Invitation.batch)
    .then(invitations => ({
      invitations,
      codes: invitations.map(({ code }) => code),
    }));
};

export const consumeInvitation = (id, userId, trx) =>
  valid(Invitation.withTransaction(trx).all({ id }))
    .update({
      inviteeId: userId,
      usedAt: trx.raw('now()'),
      updatedAt: trx.raw('now()'),
    })
    .then(
      count =>
        count === 1
          ? Promise.resolve()
          : Promise.reject(new Error('Invalid invitation'))
    );

export const mutations = {
  createAppInvitation,
  createManyAppInvitations,
  createEventInvitation,
};
