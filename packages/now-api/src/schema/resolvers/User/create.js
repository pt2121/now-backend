import uuid from 'uuid/v4';

import { pick } from 'lodash';

import { getUser } from './index';
import { CURRENT_TOS_VERSION } from './tos';
import RunTimeFlags from '../../../RunTimeFlags';
import sql from '../../../db/sql';
import { consumeInvitation, findValidCode } from '../Invitation';
import { userIdFromContext } from '../../util';
import { SQL_TABLES } from '../../../db/constants';
import { updatePref as updateFcmPref } from '../../../fcm';

const PRE_LOGGED_IN_AUTH0_ID = 'CUV6mTWPcyKmfHTw0DppzuVkb45RRCVN@clients';

const maybeUpdateFcm = (preferences, userId, force = false) => {
  const havePref = preferences && 'newEventNotification' in preferences;
  const pref = havePref ? preferences.newEventNotification : true;
  if (havePref || force) {
    updateFcmPref(pref, userId);
  }
};

const putUser = ({ id, ...otherFields }) =>
  sql(SQL_TABLES.USERS)
    .where({ id })
    .update(otherFields);

export const createUserMutation = async (
  root,
  {
    input: {
      email,
      firstName,
      lastName,
      bio,
      location,
      preferences = {},
      birthday,
      invitationCode,
    },
  },
  context
) => {
  if (context.currentUserAuth0Id === PRE_LOGGED_IN_AUTH0_ID) {
    throw new Error('No.');
  }
  if (userIdFromContext(context)) {
    throw new Error('User has already been created.');
  }

  const invitation = invitationCode
    ? await findValidCode(invitationCode)
    : null;
  if (!invitation) {
    const required = await RunTimeFlags.get('require-invite');
    if (required) {
      throw new Error('A valid invitation code is required.');
    }
  }

  const newId = uuid();
  const newUser = {
    id: newId,
    email,
    firstName,
    lastName,
    bio,
    location,
    preferences,
    birthday: birthday.toString(),
    auth0Id: context.currentUserAuth0Id,
    createdAt: sql.raw('now()'),
    updatedAt: sql.raw('now()'),
    tosVersion: CURRENT_TOS_VERSION,
  };

  await sql.transaction(async trx => {
    await trx(SQL_TABLES.USERS).insert(newUser);
    if (invitation) {
      await consumeInvitation(invitation.id, newId, trx);
      // TODO: any invitation-type-specific stuff, like maybe RSVPing the new
      // user to the Meetup they were invited to.
    }
  });

  maybeUpdateFcm(preferences, newId, true);
  return { user: getUser(newId, newId) };
};

export const updateCurrentUser = (root, { input }, context) => {
  const id = userIdFromContext(context);
  if (!id) {
    throw new Error('User must be authenticated in order to edit profile');
  }

  const { birthday } = input;

  const newUser = {
    id,
    ...pick(input, ['firstName', 'lastName', 'bio', 'preferences']),
    ...(birthday ? { birthday: birthday.toString() } : {}),
    updatedAt: sql.raw('now()'),
  };

  context.loaders.members.clear(id);
  return putUser(newUser)
    .then(() => context.loaders.members.load(id))
    .then(u => {
      maybeUpdateFcm(input.preferences, id);
      return {
        user: u,
      };
    });
};
