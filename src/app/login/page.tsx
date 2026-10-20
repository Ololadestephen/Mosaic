import { AuthForm } from "@/components/auth-form";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  return (
    <AuthForm initialRegister={(await searchParams).mode === "register"} />
  );
}
