import type { UserInfoRead } from '../../types/api-generated';

import {
  APPROVER_ROLE_NAME,
  FILE_IMPORTER_ROLE_NAME,
  createRole,
  createUserInfo,
} from './user-info';

/**
 * Shared identity source for Vitest and Playwright mocks.
 * The app gates navigation and actions on `Roles[].Name` from the userinfo
 * response (project.md §Roles & Permissions); the contract has no `Pages[]` field.
 */

interface MockPersona {
  Id: number;
  Email: string;
  FirstName: string;
  LastName: string;
}

const PERSONA_BY_ROLE: Record<string, MockPersona> = {
  [FILE_IMPORTER_ROLE_NAME]: {
    Id: 101,
    Email: 'carol.mokoena@example.com',
    FirstName: 'Carol',
    LastName: 'Mokoena',
  },
  [APPROVER_ROLE_NAME]: {
    Id: 102,
    Email: 'bob.naidoo@example.com',
    FirstName: 'Bob',
    LastName: 'Naidoo',
  },
};

const BOTH_ROLES_PERSONA: MockPersona = {
  Id: 103,
  Email: 'alice.dlamini@example.com',
  FirstName: 'Alice',
  LastName: 'Dlamini',
};

const UNKNOWN_ROLE_PERSONA: MockPersona = {
  Id: 104,
  Email: 'dan.pillay@example.com',
  FirstName: 'Dan',
  LastName: 'Pillay',
};

function personaFor(roleNames: readonly string[]): MockPersona {
  if (roleNames.length > 1) {
    return BOTH_ROLES_PERSONA;
  }
  return PERSONA_BY_ROLE[roleNames[0] ?? ''] ?? UNKNOWN_ROLE_PERSONA;
}

/**
 * Userinfo response for a signed-in user holding the given role(s).
 * Pass one role name ("File Importer" | "Approver"), an array for a user
 * holding several roles, or an empty array for a user with no roles.
 */
export function userInfoFor(
  roleNameOrNames: string | readonly string[],
  overrides: Partial<UserInfoRead> = {},
): UserInfoRead {
  const roleNames =
    typeof roleNameOrNames === 'string'
      ? [roleNameOrNames]
      : [...roleNameOrNames];
  const persona = personaFor(roleNames);
  return createUserInfo({
    ...persona,
    Roles: roleNames.map((roleName) => createRole({ Name: roleName })),
    ...overrides,
  });
}

export { APPROVER_ROLE_NAME, FILE_IMPORTER_ROLE_NAME };
