const TYPABLE_INPUT_TYPES = new Set(["email", "number", "password", "search", "tel", "text", "url"]);

export function isTypingTarget(event: KeyboardEvent) {
  if (event.isComposing) return true;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return TYPABLE_INPUT_TYPES.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
