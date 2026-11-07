import { InviteClient } from "./invite-client";

export const instant = false;

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  return <InviteClient token={token} />;
}
