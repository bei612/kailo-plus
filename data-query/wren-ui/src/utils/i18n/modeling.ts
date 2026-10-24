// DD-152 (20 §13.8): modeling strings. Keys are prefixed "modeling." and the en table
// must carry exactly the zh-CN keys (enforced by the type below).
const zh = {} as const;

const en: Record<keyof typeof zh, string> = {};

const messages = { 'zh-CN': zh, en };
export default messages;
