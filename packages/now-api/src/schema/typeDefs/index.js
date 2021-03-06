import { mergeTypes } from 'merge-graphql-schemas';

import base from './typeDefs.graphql';
import activity from './activity.graphql';
import event from './event.graphql';
import rsvp from './rsvp.graphql';
import location from './location.graphql';
import invitation from './invitation.graphql';
import user from './user.graphql';
import message from './message.graphql';
import jobs from './jobs.graphql';
import servermessages from './servermessages.graphql';
import templates from './templates.graphql';
import community from './community.graphql';

export default mergeTypes(
  [
    base,
    activity,
    community,
    event,
    rsvp,
    location,
    invitation,
    user,
    message,
    jobs,
    servermessages,
    templates,
  ],
  {
    all: true,
  }
);
