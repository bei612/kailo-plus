import * as React from "react";

export function useComposerContentState() {
  const contentRef = React.useRef("");
  const [isContentEmpty, setIsContentEmpty] = React.useState(true);
  const [content, setContent] = React.useState("");
  const [revision, setRevision] = React.useState(0);

  const setComposerContentFromText = React.useCallback((nextText: string) => {
    setContent(nextText);
    setRevision(value => value + 1);
    setIsContentEmpty((wasEmpty) => {
      const isEmpty = nextText.trim().length === 0;
      return wasEmpty === isEmpty ? wasEmpty : isEmpty;
    });
  }, []);

  const setComposerContent = React.useCallback(
    (nextContent: string) => {
      contentRef.current = nextContent;
      setComposerContentFromText(nextContent);
    },
    [setComposerContentFromText],
  );

  const syncContentRefFromEditorRef = React.useRef<() => string>(
    () => contentRef.current,
  );

  const syncComposerContentFromEditor = React.useCallback(
    () => syncContentRefFromEditorRef.current(),
    [],
  );

  return {
    content, revision, contentRef,
    isContentEmpty,
    setComposerContent,
    setComposerContentFromText,
    syncComposerContentFromEditor,
    syncContentRefFromEditorRef,
  };
}
