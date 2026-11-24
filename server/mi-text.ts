// MI uses Python str.strip(), which includes U+001C..U+001F but not U+FEFF.
export function miText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.replace(/[\p{White_Space}\u001c-\u001f]/gu, "") ||
    Buffer.from(value).toString("utf8") !== value
  )
    throw new Error("invalid");
  return value;
}

export function miInstance(value: unknown): string {
  const instance = miText(value);
  if (Buffer.byteLength(instance) > 256) throw new Error("invalid");
  return instance;
}
