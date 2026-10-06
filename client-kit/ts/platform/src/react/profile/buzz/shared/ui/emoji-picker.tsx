// Original @emoji-mart/react 1.1.1 react.tsx from dist/module.js.map.
// npm integrity: sha512-NMlFNeWgv1//uPsvLxvGQoIerPuVdXwK/EUek8OOkJ6wVOWPUizRBJU0hDqWZCOROVpfBgCemaC3m6jDOXi03g==
// Source map SHA256: 76c117bb7a182cb276871ce213c13f9f0e631e6afeb1681627b87d540c47a57d
// See EMOJI-MART-LICENSE. The published wrapper declares only React <=18.
// Local adaptation adds types and explicit effect cleanup for React 19;
// the original Emoji Mart custom element owns all picker behavior and UI.
import React, { useEffect, useRef } from "react";
import { Picker } from "emoji-mart";

export default function EmojiPicker(props: Record<string, unknown>) {
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<Picker | null>(null);
  if (instance.current) instance.current.update(props);

  useEffect(() => {
    const parent = ref.current;
    const picker = new Picker({ ...props, ref });
    instance.current = picker;
    return () => {
      if (instance.current === picker) {
        // Removing the real custom element invokes its disconnectedCallback,
        // which unregisters native picker listeners. StrictMode may remount.
        parent?.replaceChildren();
        instance.current = null;
      }
    };
  }, []);

  return React.createElement("div", { ref });
}
