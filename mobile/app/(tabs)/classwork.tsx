import { useCurrentUser } from "../../src/auth/AuthProvider";
import { ComingSoonScreen } from "../../src/design/ComingSoonScreen";

export default function ClassworkScreen() {
  const user = useCurrentUser();
  return (
    <ComingSoonScreen
      title="Classwork"
      subtitle={user.section ?? undefined}
      icon="classwork"
      detail="Your section's shared feed, with camera, photo library and document uploads, inline image previews and a PDF viewer."
    />
  );
}
