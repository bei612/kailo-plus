import { useCallback, useEffect, useRef, useState } from 'react';

type useAskingStreamTaskReturn = [
  (queryId: string) => void,
  { data: string; loading: boolean; completed: boolean; reset: () => void },
];

export default function useAskingStreamTask() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const attemptedQueryId = useRef<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [completed, setCompleted] = useState(false);
  const [data, setData] = useState<string>('');

  const closeStream = useCallback(() => {
    const source = eventSourceRef.current;
    eventSourceRef.current = null;
    source?.close();
  }, []);

  const reset = useCallback(() => {
    closeStream();
    setLoading(false);
    setCompleted(false);
    setData('');
  }, [closeStream]);

  useEffect(() => closeStream, [closeStream]);

  const fetchAskingStreamingTask = useCallback(
    (queryId: string) => {
      // The native queue is consumed once. An empty or interrupted stream is
      // observed through the original askingTask, never reopened automatically.
      if (!queryId || attemptedQueryId.current === queryId) return;
      attemptedQueryId.current = queryId;
      reset();
      setLoading(true);

      let eventSource: EventSource;
      try {
        eventSource = new EventSource(
          `/api/ask_task/streaming?queryId=${encodeURIComponent(queryId)}`,
        );
      } catch (error) {
        console.error(error);
        return;
      }
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        if (eventSourceRef.current !== eventSource) return;
        try {
          const eventData = JSON.parse(event.data);
          if (!eventData || typeof eventData !== 'object') {
            closeStream();
            return;
          }
          const keys = Object.keys(eventData);
          if (keys.length === 1 && eventData.done === true) {
            closeStream();
            setCompleted(true);
            setLoading(false);
          } else if (
            keys.length === 1 &&
            typeof eventData.message === 'string'
          ) {
            setData((state) => state + eventData.message);
          } else {
            closeStream();
          }
        } catch (error) {
          console.error(error);
          closeStream();
        }
      };

      eventSource.onerror = (error) => {
        if (eventSourceRef.current !== eventSource) return;
        console.error(error);
        closeStream();
        // EOF, timeout and transport failure do not prove native completion.
      };
    },
    [closeStream, reset],
  );

  return [
    fetchAskingStreamingTask,
    { data, loading, completed, reset },
  ] as useAskingStreamTaskReturn;
}
