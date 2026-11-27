import { FORM_HUB_PATH, formEditionPath, type EditionPickerGroup } from "@/lib/racing_form-shared";

import { BetaBadge } from "./beta-notice";
import { EditionPicker } from "./edition-picker";

/**
 * 지면(PaperSheet) 바깥 위 줄 — 왼쪽에 베타 뱃지, 오른쪽에 "경마지 선택"(팝업).
 * 지면 틀이 `relative` 라 그 위쪽(bottom-full)에 붙는다 — 지면 레이아웃이 그만큼 위 여백을 둔다.
 * 목록은 페이지가 읽어서 넘긴다 (레이아웃은 DB 를 읽지 않는다).
 */
export function PaperSwitcher({
  date,
  meet,
  groups,
}: {
  date: string;
  meet: string;
  groups: readonly EditionPickerGroup[];
}) {
  return (
    <div className="absolute inset-x-0 bottom-full mb-2 flex items-center justify-between gap-3 px-4 md:px-0">
      <span className="flex min-w-0 items-center">
        <BetaBadge date={date} />
      </span>
      <EditionPicker groups={groups} currentHref={formEditionPath(date, meet)} hubHref={FORM_HUB_PATH} />
    </div>
  );
}
