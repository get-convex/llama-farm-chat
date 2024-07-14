import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "./components/ui/button";

export function SignIn() {
  const { signIn } = useAuthActions();

  return (
    <Button
      variant={"default"}
      onClick={() =>
        void signIn("github", { redirectTo: window.location.href })
      }
    >
      Sign in
    </Button>
  );
}

export function SignOut() {
  const { signOut } = useAuthActions();

  return <Button onClick={() => void signOut()}>Sign out</Button>;
}
