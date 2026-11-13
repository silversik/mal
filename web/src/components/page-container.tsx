import { cn } from "@/lib/utils";

/**
 * 모든 페이지 공용 가로 컨테이너 — DESIGN.md Layout "Max content width 1080px".
 * navbar · footer · 본문이 같은 좌측 시작선을 갖도록 페이지마다 max-w-* 를 따로
 * 굴리지 말고 이걸 쓴다. 세로 여백은 호출부에서 className 으로 지정.
 */
export function PageContainer({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[1080px] px-4 md:px-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}
