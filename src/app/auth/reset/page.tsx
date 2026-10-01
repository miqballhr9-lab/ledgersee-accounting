import ResetPasswordForm from "@/components/account/ResetPasswordForm";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tokenValue = params.token;
  const errorValue = params.error;
  const token = Array.isArray(tokenValue) ? tokenValue[0] ?? "" : tokenValue ?? "";
  const invalid = Array.isArray(errorValue) ? errorValue.includes("INVALID_TOKEN") : errorValue === "INVALID_TOKEN";

  return <ResetPasswordForm token={token} invalid={invalid} />;
}
