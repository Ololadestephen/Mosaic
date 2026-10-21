import { AuthForm } from "@/components/auth-form";
import { registrationOpen } from "@/server/env";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const canRegister = registrationOpen();
  return (
    <AuthForm
      initialRegister={canRegister && (await searchParams).mode === "register"}
      registrationOpen={canRegister}
    />
  );
}
