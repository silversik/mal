import { FORM_HUB_PATH, formEditionPath } from "@/lib/racing_form-shared";

import { EditionSwitcher, type EditionOption } from "./edition-switcher";

/**
 * 지면(PaperSheet) 바깥 오른쪽 위에 "다른 경마지" 드롭다운을 놓는다.
 * 지면 틀이 `relative` 라 그 위쪽(bottom-full)에 붙는다 — 지면 레이아웃이 그만큼 위 여백을 둔다.
 * 목록은 페이지가 읽어서 넘긴다 (레이아웃은 DB 를 읽지 않는다).
 */
export function PaperSwitcher({
  date,
  meet,
  options,
}: {
  date: string;
  meet: string;
  options: readonly EditionOption[];
}) {
  return (
    <div className="absolute right-0 bottom-full mb-2 flex justify-end px-4 md:px-0">
      <EditionSwitcher
        options={options}
        current={formEditionPath(date, meet)}
        hubHref={FORM_HUB_PATH}
      />
    </div>
  );
}
