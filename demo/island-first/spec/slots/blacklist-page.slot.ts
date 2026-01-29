// 🥟 Mandu Filling - blacklist-page
// Pattern: /blacklist

import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({
      title: "블랙리스트 관리",
      description: "렌트카 도난/미납 기록 관리 시스템",
    });
  });
