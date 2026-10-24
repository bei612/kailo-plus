import clsx from 'clsx';
import { Button, Mentions, Typography } from 'antd';
import styled from 'styled-components';
import { useState, useContext, useRef } from 'react';
import ReadOutlined from '@ant-design/icons/ReadOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import { nextTick } from '@/utils/time';
import { Mention } from '@/hooks/useAutoComplete';
import { FormItemInputContext } from 'antd/lib/form/context';
import MarkdownBlock from './MarkdownBlock';
import useKailoText from '@/utils/kailoI18n';

const Wrapper = styled.div`
  /* DD-157 (20 §13 输入): line-strong border, radius 6; hover neutral,
     focus brand ring (token), error danger. */
  border-color: var(--kailo-color-line-strong) !important;
  border-radius: 6px !important;
  background: var(--kailo-color-background);
  transition:
    border-color var(--kailo-duration-fast) var(--kailo-ease-standard),
    box-shadow var(--kailo-duration-fast) var(--kailo-ease-standard);

  &:hover {
    border-color: var(--kailo-color-muted-foreground) !important;
  }

  &.adm-markdown-editor-error {
    border-color: var(--kailo-color-danger) !important;

    .adm-markdown-editor-length {
      color: var(--kailo-color-danger-text) !important;
    }
  }
  &:not(.adm-markdown-editor-error).adm-markdown-editor-focused {
    border-color: var(--kailo-color-brand) !important;
    box-shadow: var(--kailo-focus-ring);
  }

  &.adm-markdown-editor-focused.adm-markdown-editor-error {
    border-color: var(--kailo-color-danger) !important;
    box-shadow: none;
  }
`;

const OverflowContainer = styled.div`
  overflow-y: auto;
  max-height: 318px;
`;

const LinkButton = styled(Button)`
  color: var(--gray-7);
`;

const StyledTextArea = styled(Mentions)`
  border: none;
  border-radius: 0;

  textarea {
    padding: 16px 16px 16px 20px;
  }
`;

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
  autoFocus?: boolean;
  mentions?: Mention[];
}

const MENTION_PREFIX = '@';

const MentionOption = (props: Mention) => {
  return (
    <Mentions.Option key={props.id} value={props.value}>
      <div className="d-flex align-center justify-space-between">
        <div className="d-flex align-center gray-8">
          {props.icon}
          <Typography.Text
            className="gray-8 mr-2"
            style={{ maxWidth: 240 }}
            ellipsis
          >
            {props.label}
          </Typography.Text>
        </div>
        {props.meta && (
          <div className="gray-6">
            <Typography.Text
              className="gray-6 text-sm mr-1"
              style={{ maxWidth: 240 }}
              ellipsis
            >
              ({props.meta})
            </Typography.Text>
            {props.nodeType}
          </div>
        )}
      </div>
    </Mentions.Option>
  );
};

export default function MarkdownEditor(props: Props) {
  const { value, onChange, maxLength, autoFocus, mentions } = props;
  const t = useKailoText();
  const $wrapper = useRef<HTMLDivElement>(null);
  const $textarea = useRef<HTMLElement & { textarea: HTMLTextAreaElement }>(
    null,
  );
  const [focused, setFocused] = useState<boolean>(false);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);

  const formItemContext = useContext(FormItemInputContext);
  const { status } = formItemContext;

  const change = (targetValue: string) => {
    onChange?.(targetValue);
  };

  const select = (option: Mention) => {
    const textarea = $textarea.current?.textarea;
    if (!textarea) return;

    // go to the start of the mention
    const mentionStart = (
      value?.slice(0, textarea.selectionStart) || ''
    ).lastIndexOf(MENTION_PREFIX);
    const start = mentionStart >= 0 ? mentionStart : textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = value?.slice(0, start) + option.value + value?.slice(end);
    // update the value and move the cursor
    onChange?.(newValue || '');
    nextTick().then(() => {
      textarea.selectionStart = textarea.selectionEnd =
        start + option.value.length;
    });
  };

  const keydown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      // Set the value with a tab character or spaces
      const tabCharacter = '  '; // Use '\t' for a tab character or spaces for spaces
      const newValue =
        value?.slice(0, start) + tabCharacter + value?.slice(end);
      // update the value and move the cursor
      onChange?.(newValue || '');
      nextTick().then(() => {
        textarea.selectionStart = textarea.selectionEnd =
          start + tabCharacter.length;
      });
    }
    if (e.key === '`') {
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      if (start !== end) {
        e.preventDefault();
        const selection = `\`${value?.slice(start, end)}\``;
        const newValue = value?.slice(0, start) + selection + value?.slice(end);
        // update the value and move the cursor
        onChange?.(newValue || '');
        nextTick().then(() => {
          textarea.selectionStart = textarea.selectionEnd =
            start + selection.length;
        });
      }
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // check if the mention dropdown menu exist
      const dropdownMenu = $wrapper.current?.querySelector(
        '.ant-mentions-dropdown-menu',
      );
      if (dropdownMenu) {
        // delay to make sure the menu active item is rendered
        nextTick().then(() => {
          const activeItem = dropdownMenu.querySelector(
            '.ant-mentions-dropdown-menu-item-active',
          ) as HTMLLIElement;
          if (activeItem) {
            const menuRect = dropdownMenu.getBoundingClientRect();
            const activeRect = activeItem.getBoundingClientRect();
            // check if active item is outside viewport
            if (activeRect.bottom > menuRect.bottom) {
              // scroll down
              dropdownMenu.scrollTo({
                top:
                  dropdownMenu.scrollTop +
                  (activeRect.bottom - menuRect.bottom),
                behavior: 'smooth',
              });
            } else if (activeRect.top < menuRect.top) {
              // scroll up
              dropdownMenu.scrollTo({
                top: dropdownMenu.scrollTop - (menuRect.top - activeRect.top),
                behavior: 'smooth',
              });
            }
          }
        });
      }
    }
  };

  return (
    <Wrapper
      ref={$wrapper}
      className={clsx(
        'border border-gray-5 rounded overflow-hidden',
        status ? `adm-markdown-editor-${status}` : '',
        focused ? 'adm-markdown-editor-focused' : '',
      )}
      tabIndex={-1}
    >
      <div
        className="px-2 py-1 d-flex align-center justify-space-between"
        style={{
          background: 'var(--kailo-color-canvas)',
          borderBottom: '1px solid var(--kailo-color-border)',
        }}
      >
        <div className="adm-markdown-editor-length gray-7 text-sm mr-2">
          {maxLength
            ? t('home.characterCountMax', {
                count: value?.length || 0,
                max: maxLength,
              })
            : t('home.characterCount', { count: value?.length || 0 })}
        </div>
        <LinkButton
          icon={isPreviewMode ? <EditOutlined /> : <ReadOutlined />}
          type="link"
          size="small"
          onClick={() => setIsPreviewMode(!isPreviewMode)}
        >
          {isPreviewMode ? t('home.editMode') : t('home.readMode')}
        </LinkButton>
      </div>
      <OverflowContainer className={clsx({ 'p-4': isPreviewMode })}>
        {isPreviewMode ? (
          <MarkdownBlock content={value} />
        ) : (
          <StyledTextArea
            ref={$textarea}
            rows={13}
            autoFocus={autoFocus}
            getPopupContainer={() => $wrapper?.current}
            onChange={change}
            onSelect={select}
            onKeyDown={keydown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            value={value}
            prefix={MENTION_PREFIX}
            maxLength={maxLength}
          >
            {(mentions || []).map(MentionOption)}
          </StyledTextArea>
        )}
      </OverflowContainer>
    </Wrapper>
  );
}
