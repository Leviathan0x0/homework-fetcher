import { useCurrentUser } from "../../src/auth/AuthProvider";
import { ComingSoonScreen } from "../../src/design/ComingSoonScreen";

export default function RequestsScreen() {
  const user = useCurrentUser();
  return (
    <ComingSoonScreen
      title="Requests"
      subtitle={user.section ?? undefined}
      icon="requests"
      detail="The help board for your section: post a request, mark it complete, and delete your own."
    />
  );
}
