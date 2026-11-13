import { AnalysisSidebar } from "@/components/analysis-sidebar";
import { SectionLayout } from "@/components/section-layout";

export default function AnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionLayout nav={<AnalysisSidebar />}>{children}</SectionLayout>;
}
