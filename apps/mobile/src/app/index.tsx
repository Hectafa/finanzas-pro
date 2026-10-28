import { Redirect } from 'expo-router';
import { useSession } from '../lib/session';

export default function Index() {
  const status = useSession((s) => s.status);
  return <Redirect href={status === 'signedIn' ? '/inicio' : '/login'} />;
}
