// Buzz 779af8886caae1317b4de962082429867ab61503: original search presentation; host reads remain transport-specific.
import * as React from "react";

import { splitSearchMatches } from "./searchMatch";
import { SEARCH_MATCH_HIGHLIGHT_CLASS } from "./searchHighlightStyle";

export function HighlightedSearchText({
  query,
  text,
}: {
  query: string;
  text: string;
}) {
  return splitSearchMatches(text, query).map((part) =>
    part.isMatch ? (
      <mark
        className={SEARCH_MATCH_HIGHLIGHT_CLASS}
        data-search-match="true"
        key={part.key}
      >
        {part.text}
      </mark>
    ) : (
      <React.Fragment key={part.key}>{part.text}</React.Fragment>
    ),
  );
}
