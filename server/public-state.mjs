import { publicData } from '../domain.js';

// Preserve the former PHP publication consent during backend migration.
// The shared projection strips private fields; consent is enforced here first.
export function publicState(state) {
  const result = publicData({
    ...state,
    volunteers: state.volunteers.filter(volunteer => volunteer.publicVisible === true),
    // Operations and equipment were not exposed by the PHP public endpoint.
    operations: {},
  });
  const postKeys = ['id', 'editionId', 'number', 'name', 'lat', 'lng', 'instructions', 'courseIds', 'publicVisible'];
  result.posts = result.posts.map(post => Object.fromEntries(postKeys.filter(key => post[key] !== undefined).map(key => [key, post[key]])));
  result.equipmentTypes = [];
  return result;
}
