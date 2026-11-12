import type { UserInfoRead } from '@/types/api-generated';

export const FILE_IMPORTER_ROLE_NAME = 'File Importer';
export const APPROVER_ROLE_NAME = 'Approver';

/** Role names exactly as the userinfo response lists them, in its order. */
export function roleNamesOf(user: UserInfoRead): string[] {
  return (user.Roles ?? [])
    .map((role) => role.Name?.trim() ?? '')
    .filter((roleName) => roleName.length > 0);
}

/**
 * Whether the signed-in user holds a role. Hiding an action by role is a
 * usability measure only — the backend stays the authority on permissions.
 */
export function hasRole(user: UserInfoRead, roleName: string): boolean {
  return roleNamesOf(user).includes(roleName);
}

/** Display name: userinfo has no single name field, so FirstName + LastName. */
export function displayNameOf(user: UserInfoRead): string {
  return [user.FirstName, user.LastName]
    .map((namePart) => namePart?.trim() ?? '')
    .filter((namePart) => namePart.length > 0)
    .join(' ');
}
