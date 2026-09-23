/** Reserve about one full-width character before inline text would wrap. */
export const COMPOSER_PREWRAP_RESERVE_PX = 18;

export function shouldExpandComposer(stackedRows: boolean, draft: string, availableWidth: number, measuredTextWidth: number): boolean {
  return stackedRows || draft.includes("\n") || availableWidth < 150 || measuredTextWidth + COMPOSER_PREWRAP_RESERVE_PX >= availableWidth;
}
