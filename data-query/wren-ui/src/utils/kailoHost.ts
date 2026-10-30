// DD-157 (`07` §4.8.7, `20` §13): Kailo owns the page shell around this
// component — header (title, breadcrumbs, tabs, actions), toasts and
// confirmation dialogs. Inside the Kailo frame these go through the
// presentation runtime (kailo-embed.js); on a top-level visit the runtime
// declines and the page shows its own, styled per 20 §13 (overlay.less
// `.kailo-toast` / `.kailo-confirm`).
import { createElement } from 'react';
import Modal from 'antd/lib/modal';
import notification from 'antd/lib/notification';
import type {
  KailoConfirm,
  KailoPage,
  KailoPrompt,
  KailoToast,
} from '../../../../client-kit/embed/kailo-embed';
import { kailoRuntime, presentation } from './kailoEmbed';
import { kailoT } from './kailoI18n';

export type {
  KailoPage,
  KailoPageAction,
  KailoPageItem,
  KailoNavigateTarget,
} from '../../../../client-kit/embed/kailo-embed';

type Tone = NonNullable<KailoToast['tone']>;

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 280;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Toast shape: a short title, and the reason as description. A message
 * longer than a title becomes the description under a neutral title.
 */
export function toastShape(
  tone: Tone,
  title: string,
  description?: string,
): KailoToast {
  const head = String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const detail = description
    ? String(description).replace(/\s+/g, ' ').trim()
    : undefined;
  if (head.length <= TITLE_MAX) {
    return detail
      ? { tone, title: head, description: clip(detail, DESCRIPTION_MAX) }
      : { tone, title: head };
  }
  return {
    tone,
    title: kailoT('actionFailed'),
    description: clip(detail ? `${head} ${detail}` : head, DESCRIPTION_MAX),
  };
}

function show(tone: Tone, title: string, description?: string) {
  if (!title) return;
  const toast = toastShape(tone, title, description);
  try {
    if (kailoRuntime()?.toast(toast) === true) return;
  } catch (error) {
    console.error(error);
  }
  if (typeof window === 'undefined') return;
  // Top level: one Kailo-styled stack, bottom right (20 §13 Toast).
  notification.open({
    type: tone,
    message: toast.title,
    description: toast.description,
    placement: 'bottomRight',
    className: `kailo-toast kailo-toast--${tone}`,
    duration: tone === 'error' ? 6 : 3,
  });
}

/** One notification surface: success short, failure with the reason. */
export const notify = {
  success: (title: string, description?: string) =>
    show('success', title, description),
  info: (title: string, description?: string) =>
    show('info', title, description),
  warning: (title: string, description?: string) =>
    show('warning', title, description),
  error: (title: string, description?: string) =>
    show('error', title, description),
};

/**
 * Kailo's confirmation dialog; resolves true when the user confirmed.
 * Top level: the page's own dialog with the same wording and tone.
 */
export function confirm(options: KailoConfirm): Promise<boolean> {
  const cancelLabel = options.cancelLabel || kailoT('cancel');
  const confirmLabel =
    options.confirmLabel ||
    (options.tone === 'danger' ? kailoT('delete') : kailoT('confirm'));
  try {
    const hosted = kailoRuntime()?.confirm({
      ...options,
      confirmLabel,
      cancelLabel,
    });
    if (hosted) return hosted;
  } catch (error) {
    console.error(error);
  }
  return new Promise<boolean>((resolve) => {
    Modal.confirm({
      className: `kailo-confirm kailo-confirm--${options.tone || 'default'}`,
      title: options.title,
      content: options.description,
      icon: null,
      width: 480,
      centered: true,
      autoFocusButton: null,
      okText: confirmLabel,
      cancelText: cancelLabel,
      okButtonProps: { danger: options.tone === 'danger' },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * DD-167 (`07` §4.8.10): one line of text from the user (a new name) in
 * Kailo's dialog; resolves the trimmed text, or null when cancelled. At top
 * level (or a host without "prompt") the page's own dialog with the same
 * wording and the Kailo dialog style.
 */
export function prompt(options: KailoPrompt): Promise<string | null> {
  const maxLength = options.maxLength || 255;
  const request: KailoPrompt = {
    ...options,
    maxLength,
    value: (options.value || '').slice(0, maxLength),
    confirmLabel: options.confirmLabel || kailoT('confirm'),
    cancelLabel: options.cancelLabel || kailoT('cancel'),
  };
  try {
    const runtime = kailoRuntime();
    const hosted =
      runtime &&
      typeof runtime.prompt === 'function' &&
      (!runtime.getState().hostConnected || runtime.hostSupports('prompt'))
        ? runtime.prompt(request)
        : null;
    if (hosted) return hosted;
  } catch (error) {
    console.error(error);
  }
  return new Promise<string | null>((resolve) => {
    let value = request.value || '';
    const clean = () => value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
    const dialog = Modal.confirm({
      className: 'kailo-confirm kailo-prompt',
      title: request.title,
      icon: null,
      width: 480,
      centered: true,
      autoFocusButton: null,
      okText: request.confirmLabel,
      cancelText: request.cancelLabel,
      okButtonProps: { disabled: !clean() },
      content: createElement(
        'label',
        { className: 'kailo-prompt__field' },
        createElement('span', { className: 'kailo-prompt__label' }, request.label),
        request.description &&
          createElement(
            'span',
            { className: 'kailo-prompt__description' },
            request.description,
          ),
        createElement('input', {
          className: 'ant-input kailo-prompt__input',
          defaultValue: value,
          maxLength,
          placeholder: request.placeholder,
          autoFocus: true,
          onFocus: (event: { target: HTMLInputElement }) =>
            event.target.select(),
          onChange: (event: { target: HTMLInputElement }) => {
            value = event.target.value;
            dialog.update({ okButtonProps: { disabled: !clean() } });
          },
          onKeyDown: (event: { key: string; nativeEvent: KeyboardEvent }) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            if (!clean()) return;
            dialog.destroy();
            resolve(clean());
          },
        }),
      ),
      onOk: () => resolve(clean() || null),
      onCancel: () => resolve(null),
    });
  });
}

/** Ask to confirm a destructive action, then run it (DeleteModal and others). */
export async function confirmDanger(
  options: Omit<KailoConfirm, 'tone'>,
  action: () => unknown,
) {
  if (await confirm({ ...options, tone: 'danger' })) await action();
}

/** True when Kailo renders this page's header (page feature, in the frame). */
export function hostRendersPage(): boolean {
  const runtime = kailoRuntime();
  if (
    !runtime ||
    !presentation().embedded ||
    !Array.isArray(runtime.features) ||
    !runtime.features.includes('page')
  )
    return false;
  // DD-157: before Kailo answers, its skeleton covers the page; once it has
  // answered, only a host that announced "page" draws the header.
  return (
    !runtime.getState().hostConnected ||
    (typeof runtime.hostSupports === 'function' && runtime.hostSupports('page'))
  );
}

/**
 * Hand the page header to Kailo. Returns true when Kailo renders it; an
 * invalid shape is a programming error and is logged, not shown.
 */
export function setPage(page: KailoPage | null): boolean {
  try {
    return kailoRuntime()?.setPage(page) === true;
  } catch (error) {
    console.error(error);
    return false;
  }
}
