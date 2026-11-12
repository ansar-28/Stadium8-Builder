import type { RoleRead, UserInfoRead } from '../../types/api-generated';

export const FILE_IMPORTER_ROLE_NAME = 'File Importer';
export const APPROVER_ROLE_NAME = 'Approver';

const KNOWN_ROLE_IDS: Record<string, number> = {
  [FILE_IMPORTER_ROLE_NAME]: 1,
  [APPROVER_ROLE_NAME]: 2,
};

const CANONICAL_TIMESTAMP = '2026-01-15T09:30:00Z';
const CANONICAL_CHANGED_BY = 'system';

export function createRole(overrides: Partial<RoleRead> = {}): RoleRead {
  const roleName = overrides.Name ?? FILE_IMPORTER_ROLE_NAME;
  return {
    Id: KNOWN_ROLE_IDS[roleName] ?? 99,
    Name: roleName,
    LastChangedUser: CANONICAL_CHANGED_BY,
    LastChangedDate: CANONICAL_TIMESTAMP,
    ...overrides,
  };
}

export function createUserInfo(
  overrides: Partial<UserInfoRead> = {},
): UserInfoRead {
  const roles = overrides.Roles ?? [
    createRole({ Name: FILE_IMPORTER_ROLE_NAME }),
  ];
  return {
    Id: 101,
    Email: 'carol.mokoena@example.com',
    FirstName: 'Carol',
    LastName: 'Mokoena',
    RolesString: roles.map((role) => role.Name).join(', '),
    Roles: roles,
    LastChangedUser: CANONICAL_CHANGED_BY,
    LastChangedDate: CANONICAL_TIMESTAMP,
    ...overrides,
  };
}
