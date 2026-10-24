// DD-152 (20 §13.8): knowledge strings. Keys are prefixed "knowledge." and the en table
// must carry exactly the zh-CN keys (enforced by the type below).
const zh = {} as const;

const en: Record<keyof typeof zh, string> = {};

const messages = { 'zh-CN': zh, en };
export default messages;
