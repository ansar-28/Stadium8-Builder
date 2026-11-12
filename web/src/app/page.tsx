import { redirect } from 'next/navigation';

import { HOME_PATH } from '@/lib/auth/session-constants';

/** The front page is not a screen of its own: it opens the protected app. */
export default function HomePage() {
  redirect(HOME_PATH);
}
