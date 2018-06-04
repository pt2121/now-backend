import DataLoader from 'dataloader';
import { getUserBatch } from '../schema/resolvers/User';
import { Event, Activity, Rsvp, Location } from './repos';

const maxBatchSize = 100;
export default ({ currentUserId }) => ({
  members: new DataLoader(ids => getUserBatch(ids, currentUserId), {
    maxBatchSize,
  }),
  events: new DataLoader(ids => Event.batch(ids), {
    maxBatchSize,
  }),
  locations: new DataLoader(ids => Location.batch(ids), {
    maxBatchSize,
  }),
  activities: new DataLoader(ids => Activity.batch(ids), {
    maxBatchSize,
  }),
  rsvps: new DataLoader(ids => Rsvp.batch(ids), {
    maxBatchSize,
  }),
});
