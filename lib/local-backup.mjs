const keys = ['gaubretrail-organization-v3', 'gaubretrail-management-v2', 'gaubretrail-management-v1'];

// Recovery only: never use this data as an implicit replacement for server state.
export function readLocalBackup(storage) {
  for (const key of keys) {
    const value = storage.getItem(key);
    if (value) return { key, data: JSON.parse(value) };
  }
  return null;
}
