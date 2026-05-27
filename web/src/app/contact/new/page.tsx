import type { Metadata } from "next";
import { auth } from "@/auth";
import ContactNewForm from "./form";

export const metadata: Metadata = {
  title: "새 문의 작성",
  description: "mal.kr 서비스 문의, 데이터 오류 신고, 기능 제안을 남겨주세요.",
  alternates: { canonical: "/contact/new" },
};

export default async function ContactNewPage() {
  const session = await auth();
  return <ContactNewForm userName={session?.user?.name ?? null} />;
}
