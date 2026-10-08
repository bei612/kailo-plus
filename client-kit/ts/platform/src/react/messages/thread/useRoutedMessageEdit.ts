// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/useRoutedMessageEdit.ts::useRoutedMessageEdit.
import * as React from "react";
import { toast } from "sonner";
import { useUiT } from "../../context";
import { isThreadReply } from "../threading";
import type { TimelineMessage } from "../types";
import { KIND_SYSTEM_MESSAGE } from "./kinds";

export function useRoutedMessageEdit<Message extends TimelineMessage>({
	activeChannelId,
	channelIsCovered,
	currentPubkey,
	editTarget,
	isSinglePanelView,
	mainMessages,
	onCloseThread,
	onEdit,
	threadHeadMessage,
	threadMessages,
	useFocusThreadDrawer,
}: {
	activeChannelId: string | null;
	channelIsCovered: boolean;
	currentPubkey?: string | null;
	editTarget: { id: string; isThreadReply: boolean } | null;
	isSinglePanelView: boolean;
	mainMessages: readonly Message[];
	onCloseThread: () => void;
	onEdit?: (message: Message) => void;
	// Web's independently admitted thread reader owns the thread shortcut;
	// the main consumer does not manufacture thread rows to satisfy this hook.
	threadHeadMessage?: Message | null;
	threadMessages?: readonly Message[];
	useFocusThreadDrawer: boolean;
}) {
	const t = useUiT();
	const pendingMainEditRef = React.useRef<Message | null>(null);
	const editTargetRef = React.useRef(editTarget);
	editTargetRef.current = editTarget;
	const contextRef = React.useRef({
		channelId: activeChannelId,
		pubkey: currentPubkey,
		threadId: threadHeadMessage?.id,
	});
	const context = {
		channelId: activeChannelId,
		pubkey: currentPubkey,
		threadId: threadHeadMessage?.id,
	};
	if (
		contextRef.current.channelId !== context.channelId ||
		contextRef.current.pubkey !== context.pubkey ||
		(contextRef.current.threadId &&
			context.threadId &&
			contextRef.current.threadId !== context.threadId)
	)
		pendingMainEditRef.current = null;
	contextRef.current = context;

	const findLastOwnEditable = React.useCallback(
		(messages: readonly Message[]) => {
			if (!onEdit || !currentPubkey) return null;
			return messages.reduce<Message | null>(
				(best, message) =>
					message.kind === KIND_SYSTEM_MESSAGE ||
					message.pubkey !== currentPubkey ||
					message.pending ||
					(best && message.createdAt < best.createdAt)
						? best
						: message,
				null,
			);
		},
		[currentPubkey, onEdit],
	);
	const routeEdit = React.useCallback(
		(message: Message) => {
			const current = editTargetRef.current;
			if (
				current &&
				current.id !== message.id &&
				current.isThreadReply !== isThreadReply(message.tags ?? [])
			) {
				pendingMainEditRef.current = null;
				toast.info(t("buzz.finishEdit"));
				return false;
			}
			if (current?.id === message.id) {
				pendingMainEditRef.current = null;
				onEdit?.(message);
				return true;
			}
			if (
				!isThreadReply(message.tags ?? []) &&
				(isSinglePanelView || useFocusThreadDrawer)
			) {
				pendingMainEditRef.current = message;
				onCloseThread();
				return true;
			}
			onEdit?.(message);
			return Boolean(onEdit);
		},
		[isSinglePanelView, onCloseThread, onEdit, t, useFocusThreadDrawer],
	);
	const handleEditLastOwnMainMessage = React.useCallback(() => {
		const target = findLastOwnEditable(mainMessages);
		return target ? routeEdit(target) : false;
	}, [findLastOwnEditable, mainMessages, routeEdit]);
	const handleEditLastOwnThreadMessage = React.useCallback(() => {
		if (!threadHeadMessage && !threadMessages) return false;
		const target = findLastOwnEditable(
			threadHeadMessage
				? [threadHeadMessage, ...(threadMessages ?? [])]
				: threadMessages!,
		);
		return target ? routeEdit(target) : false;
	}, [findLastOwnEditable, routeEdit, threadHeadMessage, threadMessages]);
	React.useEffect(() => {
		const pending = pendingMainEditRef.current;
		if (!pending || isSinglePanelView || channelIsCovered) return;
		pendingMainEditRef.current = null;
		onEdit?.(pending);
	}, [channelIsCovered, isSinglePanelView, onEdit]);
	return {
		handleEditLastOwnMainMessage,
		handleEditLastOwnThreadMessage,
		routeEdit,
	};
}
