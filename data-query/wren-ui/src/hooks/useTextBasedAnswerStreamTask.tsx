import { useCallback, useEffect, useRef, useState } from 'react';
import { withDataSourceParam } from '@/utils/dataSourceSelection';

type TextBasedAnswerStreamTaskReturn = [
  (responseId: number, queryId: string) => void,
  {
    responseId: number | null;
    queryId: string | null;
    data: string;
    loading: boolean;
    completed: boolean;
    onReset: () => void;
  },
];

export default function useTextBasedAnswerStreamTask() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeKey = useRef<string | null>(null);
  const attempted = useRef(new Set<string>());
  const [identity, setIdentity] = useState<{
    responseId: number;
    queryId: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [data, setData] = useState('');

  const closeStream = useCallback(() => {
    const source = eventSourceRef.current;
    eventSourceRef.current = null;
    source?.close();
  }, []);

  const onReset = useCallback(() => {
    closeStream();
    activeKey.current = null;
    setIdentity(null);
    setLoading(false);
    setCompleted(false);
    setData('');
  }, [closeStream]);

  useEffect(() => closeStream, [closeStream]);

  const fetchAnswerStreamingTask = useCallback(
    (responseId: number, queryId: string) => {
      if (!Number.isSafeInteger(responseId) || responseId <= 0 || !queryId)
        return;
      const key = JSON.stringify([responseId, queryId]);
      if (activeKey.current === key) return;
      onReset();
      activeKey.current = key;
      setIdentity({ responseId, queryId });
      // The original native queue is consumed once. A render, locale change,
      // reset or earlier response selection cannot replay that same queue.
      if (attempted.current.has(key)) return;
      attempted.current.add(key);
      setLoading(true);

      let eventSource: EventSource;
      try {
        eventSource = new EventSource(
          withDataSourceParam(
            `/api/ask_task/streaming_answer?responseId=${responseId}&queryId=${encodeURIComponent(queryId)}`,
          ),
        );
      } catch (error) {
        console.error(error);
        setLoading(false);
        return;
      }
      eventSourceRef.current = eventSource;
      const stop = () => {
        closeStream();
        setLoading(false);
      };
      eventSource.onmessage = (event) => {
        if (eventSourceRef.current !== eventSource) return;
        try {
          const value = JSON.parse(event.data);
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            stop();
            return;
          }
          const keys = Object.keys(value);
          if (keys.length === 1 && value.done === true) {
            stop();
            setCompleted(true);
          } else if (keys.length === 1 && typeof value.message === 'string') {
            setData((state) => state + value.message);
          } else {
            stop();
          }
        } catch (error) {
          console.error(error);
          stop();
        }
      };
      eventSource.onerror = (error) => {
        if (eventSourceRef.current !== eventSource) return;
        console.error(error);
        stop();
        // Transport closure is not proof of a finished answer.
      };
    },
    [closeStream, onReset],
  );

  return [
    fetchAnswerStreamingTask,
    {
      responseId: identity?.responseId ?? null,
      queryId: identity?.queryId ?? null,
      data,
      loading,
      completed,
      onReset,
    },
  ] as TextBasedAnswerStreamTaskReturn;
}
