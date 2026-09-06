export type ComposerEnterContext = {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  mobileInput: boolean;
};

export function shouldSubmitComposerOnEnter(context: ComposerEnterContext) {
  return context.key === "Enter"
    && !context.shiftKey
    && !context.isComposing
    && !context.mobileInput;
}

export function hasMobileComposerInput(windowObject: Window, userAgent: string) {
  return windowObject.matchMedia("(hover: none) and (pointer: coarse)").matches
    || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}
