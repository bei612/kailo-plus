import {describe, expect, it} from 'vitest';
import {DOCS_API_CONFIG, editorLocale, launchAction} from './launch';

const origin = 'http://ds.example:58096';
const selected = `${origin}/hosting/wopi/word/edit?wopisrc=http%3A%2F%2Fcells.example%2Fwopi%2Ffiles%2Fu&ui=en-US&lang=en-US&dchat=1`;

describe('native ONLYOFFICE launch (DD-132)', () => {
    it('closes macros and plugins in the posted editor configuration', () => {
        expect(JSON.parse(DOCS_API_CONFIG)).toEqual({editorConfig: {customization: {macros: false, plugins: false}}});
    });

    it('maps the Cells language preference to a DocumentServer locale', () => {
        expect(editorLocale('zh-cn')).toBe('zh-CN');
        expect(editorLocale('en-us')).toBe('en-US');
        expect(editorLocale('fr')).toBe('fr');
        expect(editorLocale(undefined)).toBe('en-US');
        expect(editorLocale('<script>')).toBe('en-US');
    });

    it('only sets the locale on the server-selected action', () => {
        const action = new URL(launchAction(selected, origin, 'zh-CN'));
        expect(action.origin).toBe(origin);
        expect(action.searchParams.get('ui')).toBe('zh-CN');
        expect(action.searchParams.get('lang')).toBe('zh-CN');
        expect(action.searchParams.get('dchat')).toBe('1');
        expect(action.searchParams.get('wopisrc')).toBe('http://cells.example/wopi/files/u');
    });

    it('refuses actions that are not the configured fixed WOPI action', () => {
        for (const url of [
            selected.replace(origin, 'http://evil.example'),
            selected.replace('/hosting/wopi/word/edit', '/hosting/other'),
            `${selected}&access_token=x`,
            selected.replace('dchat=1', 'dchat=0'),
            selected.replace(/wopisrc=[^&]*&/, ''),
        ]) {
            expect(() => launchAction(url, origin, 'en-US')).toThrow();
        }
    });
});
