import { DatabaseSidebar } from "@/components/database-sidebar";
import { SectionLayout } from "@/components/section-layout";

export default function DatabaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout nav={<DatabaseSidebar />}>{children}</SectionLayout>;
}
