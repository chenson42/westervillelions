import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default async function MemberEventDetailPage({ params }: Props) {
  const { id } = await params;
  redirect(`/events/${id}`);
}
